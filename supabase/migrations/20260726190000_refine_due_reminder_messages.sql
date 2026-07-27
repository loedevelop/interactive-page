-- 調整到期提醒訊息內容：學生不看近況三次；標題改班名/進度/區塊；文案去遲交字樣

CREATE OR REPLACE FUNCTION public.build_recent_assignment_status_text(
  p_class_id uuid,
  p_student_id uuid,
  p_limit int DEFAULT 3
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  lines text := '';
  n int := 0;
  due_d date;
  prog text;
  done boolean;
  mark text;
  class_name text;
BEGIN
  SELECT COALESCE(NULLIF(trim(c.name), ''), '未命名班級') INTO class_name
  FROM public.classes c WHERE c.id = p_class_id;

  FOR rec IN
    SELECT a.id, a.title, a.due_date, a.target_date
    FROM public.assignments a
    WHERE a.class_id = p_class_id
      AND a.deleted_at IS NULL
      AND COALESCE(a.is_published, true) = true
    ORDER BY COALESCE(a.due_date::date, a.target_date::date) DESC NULLS LAST, a.id DESC
    LIMIT GREATEST(p_limit, 1)
  LOOP
    n := n + 1;
    due_d := COALESCE(rec.due_date::date, rec.target_date::date);
    prog := COALESCE(to_char(rec.target_date::date, 'YYYY-MM-DD'), '未設定進度日');
    done := public.assignment_has_any_completion(rec.id, p_student_id);
    mark := CASE WHEN done THEN '已有繳交' ELSE '尚未繳交' END;
    lines := lines || n::text || '. ' || class_name || E'\n'
      || '   進度 ' || prog || E'\n'
      || '   ' || COALESCE(NULLIF(trim(rec.title), ''), '未命名作業')
      || '（截止 ' || COALESCE(to_char(due_d, 'YYYY-MM-DD'), '未設定') || '）: '
      || mark || E'\n';
  END LOOP;

  IF lines = '' THEN
    RETURN '（尚無已發布作業）';
  END IF;
  RETURN lines;
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_due_reminders(p_today date DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_due_soon date;
  a_rec record;
  s_rec record;
  p_rec record;
  v_due date;
  v_allow_late boolean;
  v_kind text;
  v_title text;
  v_body_student text;
  v_body_parent text;
  v_status_text text;
  v_dedupe text;
  v_inserted int := 0;
  v_skipped_dup int := 0;
  v_students int := 0;
  v_parents int := 0;
  v_skip_no_email int := 0;
  v_new_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
  v_email text;
  v_class_name text;
  v_progress text;
  v_block text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION '無權限執行到期提醒掃描';
  END IF;

  v_today := COALESCE(p_today, (timezone('Asia/Taipei', now()))::date);
  v_due_soon := v_today + 2;

  FOR a_rec IN
    SELECT a.id, a.class_id, a.title, a.due_date, a.target_date, a.raw_data, c.name AS class_name
    FROM public.assignments a
    JOIN public.classes c ON c.id = a.class_id AND c.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
      AND COALESCE(a.is_published, true) = true
  LOOP
    v_due := COALESCE(a_rec.due_date::date, a_rec.target_date::date);
    IF v_due IS NULL THEN
      CONTINUE;
    END IF;

    v_allow_late := COALESCE((a_rec.raw_data->'late_policy'->>'allow_late')::boolean, false);

    IF v_due = v_due_soon THEN
      v_kind := 'due_soon';
    ELSIF v_due < v_today AND v_allow_late THEN
      v_kind := 'overdue_late';
    ELSE
      CONTINUE;
    END IF;

    v_class_name := COALESCE(NULLIF(trim(a_rec.class_name), ''), '未命名班級');
    v_progress := '進度 ' || COALESCE(to_char(a_rec.target_date::date, 'YYYY-MM-DD'), '未設定');
    v_block := COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業')
      || '（截止 ' || to_char(v_due, 'YYYY-MM-DD') || '）';
    -- 標題＝列表主資訊（與時間軸區塊資訊對齊，不含遲交字樣）
    v_title := v_class_name || E'\n' || v_progress || E'\n' || v_block;

    FOR s_rec IN
      SELECT se.user_id
      FROM public.student_enrollments se
      WHERE se.class_id = a_rec.class_id
        AND se.deleted_at IS NULL
    LOOP
      v_students := v_students + 1;
      -- 學生：不附最近三次（自己最清楚）
      v_body_student := v_title;

      v_dedupe := v_kind || ':' || a_rec.id::text || ':' || s_rec.user_id::text || ':' || to_char(v_due, 'YYYYMMDD');

      INSERT INTO public.user_notifications (
        user_id, class_id, assignment_id, kind, title, body, payload, dedupe_key, email_status
      ) VALUES (
        s_rec.user_id,
        a_rec.class_id,
        a_rec.id,
        v_kind,
        v_title,
        v_body_student,
        jsonb_build_object(
          'assignment_id', a_rec.id,
          'class_id', a_rec.class_id,
          'due_date', to_char(v_due, 'YYYY-MM-DD'),
          'class_name', v_class_name,
          'progress_label', v_progress,
          'block_label', v_block,
          'assignment_title', COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業'),
          'recipient_role', 'student'
        ),
        v_dedupe,
        'pending'
      )
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id INTO v_new_id;

      IF v_new_id IS NULL THEN
        v_skipped_dup := v_skipped_dup + 1;
      ELSE
        v_inserted := v_inserted + 1;
        v_new_ids := array_append(v_new_ids, v_new_id);

        SELECT p.email INTO v_email FROM public.profiles p WHERE p.id = s_rec.user_id;
        IF v_email IS NULL OR trim(v_email) = '' OR position('@' in v_email) = 0 THEN
          UPDATE public.user_notifications
          SET email_status = 'skipped_no_email'
          WHERE id = v_new_id;
          v_skip_no_email := v_skip_no_email + 1;
        END IF;
      END IF;

      -- 家長：附最近三次個人近況
      v_status_text := public.build_recent_assignment_status_text(a_rec.class_id, s_rec.user_id, 3);
      v_body_parent := v_title || E'\n\n最近 3 次繳交近況：' || E'\n' || v_status_text;

      FOR p_rec IN
        SELECT pcm.parent_user_id
        FROM public.parent_child_mappings pcm
        WHERE pcm.child_user_id = s_rec.user_id
      LOOP
        v_parents := v_parents + 1;
        v_dedupe := v_kind || ':' || a_rec.id::text || ':parent:' || p_rec.parent_user_id::text
          || ':child:' || s_rec.user_id::text || ':' || to_char(v_due, 'YYYYMMDD');

        INSERT INTO public.user_notifications (
          user_id, class_id, assignment_id, kind, title, body, payload, dedupe_key, email_status
        ) VALUES (
          p_rec.parent_user_id,
          a_rec.class_id,
          a_rec.id,
          v_kind,
          v_title,
          v_body_parent,
          jsonb_build_object(
            'assignment_id', a_rec.id,
            'class_id', a_rec.class_id,
            'due_date', to_char(v_due, 'YYYY-MM-DD'),
            'class_name', v_class_name,
            'progress_label', v_progress,
            'block_label', v_block,
            'assignment_title', COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業'),
            'recent_status_text', v_status_text,
            'recipient_role', 'parent',
            'child_user_id', s_rec.user_id
          ),
          v_dedupe,
          'pending'
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id INTO v_new_id;

        IF v_new_id IS NULL THEN
          v_skipped_dup := v_skipped_dup + 1;
        ELSE
          v_inserted := v_inserted + 1;
          v_new_ids := array_append(v_new_ids, v_new_id);

          SELECT p.email INTO v_email FROM public.profiles p WHERE p.id = p_rec.parent_user_id;
          IF v_email IS NULL OR trim(v_email) = '' OR position('@' in v_email) = 0 THEN
            UPDATE public.user_notifications
            SET email_status = 'skipped_no_email'
            WHERE id = v_new_id;
            v_skip_no_email := v_skip_no_email + 1;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  INSERT INTO public.reminder_dispatch_logs (today_date, summary)
  VALUES (
    v_today,
    jsonb_build_object(
      'inserted', v_inserted,
      'skipped_dup', v_skipped_dup,
      'student_targets', v_students,
      'parent_targets', v_parents,
      'skipped_no_email', v_skip_no_email,
      'due_soon_date', to_char(v_due_soon, 'YYYY-MM-DD'),
      'new_ids', to_jsonb(v_new_ids)
    )
  );

  RETURN json_build_object(
    'status', 'success',
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'due_soon_date', to_char(v_due_soon, 'YYYY-MM-DD'),
    'inserted', v_inserted,
    'skipped_dup', v_skipped_dup,
    'skipped_no_email', v_skip_no_email,
    'new_notification_ids', v_new_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.build_recent_assignment_status_text(uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_due_reminders(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_due_reminders(date) TO authenticated;

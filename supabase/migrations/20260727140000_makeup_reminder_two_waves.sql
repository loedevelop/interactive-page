-- 補交提醒兩波：
-- 1) 過期當天（截止日翌日）發一次 overdue_late（可補＝提醒補交；不可補＝缺交）
-- 2) 同班有新作業「截止前兩天」時，對仍未完成的可補舊作業再發一則 followup
-- 並略過已全部完成細項的學生

CREATE OR REPLACE FUNCTION public.collect_leaf_task_ids(p_tasks jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t jsonb;
  res text[] := ARRAY[]::text[];
  child text[];
BEGIN
  IF p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' THEN
    RETURN res;
  END IF;

  FOR t IN SELECT value FROM jsonb_array_elements(p_tasks)
  LOOP
    IF COALESCE(t->>'type', '') = 'group' THEN
      child := public.collect_leaf_task_ids(COALESCE(t->'subTasks', '[]'::jsonb));
      res := res || child;
    ELSIF t ? 'id' AND NULLIF(trim(t->>'id'), '') IS NOT NULL THEN
      res := array_append(res, t->>'id');
    END IF;
  END LOOP;

  RETURN res;
END;
$$;

CREATE OR REPLACE FUNCTION public.assignment_is_fully_complete(
  p_assignment_id uuid,
  p_student_id uuid,
  p_tasks jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  leaf_ids text[];
  total int;
  done_count int;
BEGIN
  leaf_ids := public.collect_leaf_task_ids(p_tasks);
  total := COALESCE(array_length(leaf_ids, 1), 0);
  IF total = 0 THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)::int INTO done_count
  FROM public.task_completions tc
  WHERE tc.assignment_id = p_assignment_id
    AND tc.student_id = p_student_id
    AND tc.deleted_at IS NULL
    AND tc.task_id::text = ANY (leaf_ids);

  RETURN done_count >= total;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_assignment_allow_late(
  p_assign_raw jsonb,
  p_class_raw jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_class_allow boolean;
BEGIN
  v_class_allow := COALESCE(
    (p_class_raw->'late_submission_defaults'->>'allow_late')::boolean,
    false
  );

  IF p_assign_raw ? 'late_policy'
     AND jsonb_typeof(p_assign_raw->'late_policy') = 'object' THEN
    RETURN COALESCE((p_assign_raw->'late_policy'->>'allow_late')::boolean, false);
  ELSIF p_assign_raw ? 'allow_late' THEN
    RETURN COALESCE((p_assign_raw->>'allow_late')::boolean, false);
  END IF;

  RETURN v_class_allow;
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
  v_overdue_first date;
  a_rec record;
  old_rec record;
  s_rec record;
  p_rec record;
  v_due date;
  v_old_due date;
  v_allow_late boolean;
  v_old_allow_late boolean;
  v_kind text;
  v_title text;
  v_body_student text;
  v_body_parent text;
  v_status_text text;
  v_dedupe text;
  v_wave text;
  v_inserted int := 0;
  v_skipped_dup int := 0;
  v_skipped_done int := 0;
  v_students int := 0;
  v_parents int := 0;
  v_skip_no_email int := 0;
  v_followups int := 0;
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
  v_overdue_first := v_today - 1; -- 截止日翌日＝第一則過期／補交提醒日

  FOR a_rec IN
    SELECT a.id, a.class_id, a.title, a.due_date, a.target_date, a.tasks, a.raw_data,
           c.name AS class_name, c.raw_data AS class_raw
    FROM public.assignments a
    JOIN public.classes c ON c.id = a.class_id AND c.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
      AND COALESCE(a.is_published, true) = true
  LOOP
    v_due := a_rec.due_date::date;
    IF v_due IS NULL THEN
      CONTINUE;
    END IF;

    v_allow_late := public.resolve_assignment_allow_late(
      COALESCE(a_rec.raw_data, '{}'::jsonb),
      COALESCE(a_rec.class_raw, '{}'::jsonb)
    );

    v_class_name := COALESCE(NULLIF(trim(a_rec.class_name), ''), '未命名班級');
    v_progress := '進度 ' || COALESCE(to_char(a_rec.target_date::date, 'YYYY-MM-DD'), '未設定');
    v_block := COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業')
      || '（截止 ' || to_char(v_due, 'YYYY-MM-DD') || '）';
    v_title := v_class_name || E'\n' || v_progress || E'\n' || v_block;

    -- ── 波次 A：截止前兩天 → due_soon；並對同班舊的可補未補發 followup ──
    IF v_due = v_due_soon THEN
      FOR s_rec IN
        SELECT se.user_id
        FROM public.student_enrollments se
        WHERE se.class_id = a_rec.class_id
          AND se.deleted_at IS NULL
      LOOP
        v_students := v_students + 1;

        IF NOT public.assignment_is_fully_complete(a_rec.id, s_rec.user_id, a_rec.tasks) THEN
          v_kind := 'due_soon';
          v_wave := 'due_soon';
          v_dedupe := v_kind || ':' || a_rec.id::text || ':' || s_rec.user_id::text
            || ':' || to_char(v_due, 'YYYYMMDD');

          INSERT INTO public.user_notifications (
            user_id, class_id, assignment_id, kind, title, body, payload, dedupe_key, email_status
          ) VALUES (
            s_rec.user_id,
            a_rec.class_id,
            a_rec.id,
            v_kind,
            v_title,
            v_title,
            jsonb_build_object(
              'assignment_id', a_rec.id,
              'class_id', a_rec.class_id,
              'due_date', to_char(v_due, 'YYYY-MM-DD'),
              'class_name', v_class_name,
              'progress_label', v_progress,
              'block_label', v_block,
              'assignment_title', COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業'),
              'allow_late', v_allow_late,
              'reminder_wave', v_wave,
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
              UPDATE public.user_notifications SET email_status = 'skipped_no_email' WHERE id = v_new_id;
              v_skip_no_email := v_skip_no_email + 1;
            END IF;
          END IF;

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
                'allow_late', v_allow_late,
                'reminder_wave', v_wave,
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
                UPDATE public.user_notifications SET email_status = 'skipped_no_email' WHERE id = v_new_id;
                v_skip_no_email := v_skip_no_email + 1;
              END IF;
            END IF;
          END LOOP;
        ELSE
          v_skipped_done := v_skipped_done + 1;
        END IF;

        -- 第二次補交時機：同班舊作業（已過截止、可補、未完成）
        FOR old_rec IN
          SELECT a2.id, a2.title, a2.due_date, a2.target_date, a2.tasks, a2.raw_data,
                 c2.name AS class_name, c2.raw_data AS class_raw
          FROM public.assignments a2
          JOIN public.classes c2 ON c2.id = a2.class_id AND c2.deleted_at IS NULL
          WHERE a2.class_id = a_rec.class_id
            AND a2.id <> a_rec.id
            AND a2.deleted_at IS NULL
            AND COALESCE(a2.is_published, true) = true
            AND a2.due_date IS NOT NULL
            AND a2.due_date::date < v_today
        LOOP
          v_old_allow_late := public.resolve_assignment_allow_late(
            COALESCE(old_rec.raw_data, '{}'::jsonb),
            COALESCE(old_rec.class_raw, '{}'::jsonb)
          );
          IF NOT v_old_allow_late THEN
            CONTINUE;
          END IF;
          IF public.assignment_is_fully_complete(old_rec.id, s_rec.user_id, old_rec.tasks) THEN
            CONTINUE;
          END IF;

          v_old_due := old_rec.due_date::date;
          v_kind := 'overdue_late';
          v_wave := 'followup_on_due_soon';
          v_class_name := COALESCE(NULLIF(trim(old_rec.class_name), ''), '未命名班級');
          v_progress := '進度 ' || COALESCE(to_char(old_rec.target_date::date, 'YYYY-MM-DD'), '未設定');
          v_block := COALESCE(NULLIF(trim(old_rec.title), ''), '未命名作業')
            || '（截止 ' || to_char(v_old_due, 'YYYY-MM-DD') || '）';
          v_title := v_class_name || E'\n' || v_progress || E'\n' || v_block;

          -- 同一天同一舊作業只發一則（即使同班有多份將到作業）
          v_dedupe := 'overdue_late_followup:' || old_rec.id::text || ':' || s_rec.user_id::text
            || ':' || to_char(v_today, 'YYYYMMDD');

          INSERT INTO public.user_notifications (
            user_id, class_id, assignment_id, kind, title, body, payload, dedupe_key, email_status
          ) VALUES (
            s_rec.user_id,
            a_rec.class_id,
            old_rec.id,
            v_kind,
            v_title,
            v_title,
            jsonb_build_object(
              'assignment_id', old_rec.id,
              'class_id', a_rec.class_id,
              'due_date', to_char(v_old_due, 'YYYY-MM-DD'),
              'class_name', v_class_name,
              'progress_label', v_progress,
              'block_label', v_block,
              'assignment_title', COALESCE(NULLIF(trim(old_rec.title), ''), '未命名作業'),
              'allow_late', true,
              'reminder_wave', v_wave,
              'trigger_assignment_id', a_rec.id,
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
            v_followups := v_followups + 1;
            v_new_ids := array_append(v_new_ids, v_new_id);
            SELECT p.email INTO v_email FROM public.profiles p WHERE p.id = s_rec.user_id;
            IF v_email IS NULL OR trim(v_email) = '' OR position('@' in v_email) = 0 THEN
              UPDATE public.user_notifications SET email_status = 'skipped_no_email' WHERE id = v_new_id;
              v_skip_no_email := v_skip_no_email + 1;
            END IF;
          END IF;

          v_status_text := public.build_recent_assignment_status_text(a_rec.class_id, s_rec.user_id, 3);
          v_body_parent := v_title || E'\n\n最近 3 次繳交近況：' || E'\n' || v_status_text;

          FOR p_rec IN
            SELECT pcm.parent_user_id
            FROM public.parent_child_mappings pcm
            WHERE pcm.child_user_id = s_rec.user_id
          LOOP
            v_parents := v_parents + 1;
            v_dedupe := 'overdue_late_followup:' || old_rec.id::text || ':parent:' || p_rec.parent_user_id::text
              || ':child:' || s_rec.user_id::text || ':' || to_char(v_today, 'YYYYMMDD');

            INSERT INTO public.user_notifications (
              user_id, class_id, assignment_id, kind, title, body, payload, dedupe_key, email_status
            ) VALUES (
              p_rec.parent_user_id,
              a_rec.class_id,
              old_rec.id,
              v_kind,
              v_title,
              v_body_parent,
              jsonb_build_object(
                'assignment_id', old_rec.id,
                'class_id', a_rec.class_id,
                'due_date', to_char(v_old_due, 'YYYY-MM-DD'),
                'class_name', v_class_name,
                'progress_label', v_progress,
                'block_label', v_block,
                'assignment_title', COALESCE(NULLIF(trim(old_rec.title), ''), '未命名作業'),
                'allow_late', true,
                'reminder_wave', v_wave,
                'trigger_assignment_id', a_rec.id,
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
              v_followups := v_followups + 1;
              v_new_ids := array_append(v_new_ids, v_new_id);
              SELECT p.email INTO v_email FROM public.profiles p WHERE p.id = p_rec.parent_user_id;
              IF v_email IS NULL OR trim(v_email) = '' OR position('@' in v_email) = 0 THEN
                UPDATE public.user_notifications SET email_status = 'skipped_no_email' WHERE id = v_new_id;
                v_skip_no_email := v_skip_no_email + 1;
              END IF;
            END IF;
          END LOOP;
        END LOOP;
      END LOOP;

    -- ── 波次 B：截止日翌日 → 第一則過期／補交（只此一天，不天天發）──
    ELSIF v_due = v_overdue_first THEN
      v_kind := 'overdue_late';
      v_wave := 'first_day_after_due';

      FOR s_rec IN
        SELECT se.user_id
        FROM public.student_enrollments se
        WHERE se.class_id = a_rec.class_id
          AND se.deleted_at IS NULL
      LOOP
        v_students := v_students + 1;

        IF public.assignment_is_fully_complete(a_rec.id, s_rec.user_id, a_rec.tasks) THEN
          v_skipped_done := v_skipped_done + 1;
          CONTINUE;
        END IF;

        v_body_student := v_title;
        v_dedupe := v_kind || ':' || a_rec.id::text || ':' || s_rec.user_id::text
          || ':' || to_char(v_due, 'YYYYMMDD');

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
            'allow_late', v_allow_late,
            'reminder_wave', v_wave,
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
            UPDATE public.user_notifications SET email_status = 'skipped_no_email' WHERE id = v_new_id;
            v_skip_no_email := v_skip_no_email + 1;
          END IF;
        END IF;

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
              'allow_late', v_allow_late,
              'reminder_wave', v_wave,
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
              UPDATE public.user_notifications SET email_status = 'skipped_no_email' WHERE id = v_new_id;
              v_skip_no_email := v_skip_no_email + 1;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.reminder_dispatch_logs (today_date, summary)
  VALUES (
    v_today,
    jsonb_build_object(
      'inserted', v_inserted,
      'skipped_dup', v_skipped_dup,
      'skipped_done', v_skipped_done,
      'followups', v_followups,
      'student_targets', v_students,
      'parent_targets', v_parents,
      'skipped_no_email', v_skip_no_email,
      'due_soon_date', to_char(v_due_soon, 'YYYY-MM-DD'),
      'overdue_first_date', to_char(v_overdue_first, 'YYYY-MM-DD'),
      'new_ids', to_jsonb(v_new_ids)
    )
  );

  RETURN json_build_object(
    'status', 'success',
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'due_soon_date', to_char(v_due_soon, 'YYYY-MM-DD'),
    'overdue_first_date', to_char(v_overdue_first, 'YYYY-MM-DD'),
    'inserted', v_inserted,
    'skipped_dup', v_skipped_dup,
    'skipped_done', v_skipped_done,
    'followups', v_followups,
    'skipped_no_email', v_skip_no_email,
    'new_notification_ids', v_new_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.collect_leaf_task_ids(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_is_fully_complete(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_assignment_allow_late(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_due_reminders(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_due_reminders(date) TO authenticated;

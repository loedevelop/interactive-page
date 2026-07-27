-- 站內訊息／到期提醒（T-2、可遲交已過期）+ 防重複 + 掃描 RPC

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE SET NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_kind_check CHECK (kind IN ('due_soon', 'overdue_late')),
  CONSTRAINT user_notifications_email_status_check CHECK (
    email_status IN ('pending', 'sent', 'skipped', 'failed', 'skipped_no_email', 'skipped_no_provider')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_dedupe_key_uidx
  ON public.user_notifications (dedupe_key);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON public.user_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_email_pending_idx
  ON public.user_notifications (email_status)
  WHERE email_status = 'pending';

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_select_own_notifications" ON public.user_notifications;
CREATE POLICY "user_select_own_notifications"
  ON public.user_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "user_update_own_notifications" ON public.user_notifications;
CREATE POLICY "user_update_own_notifications"
  ON public.user_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.reminder_dispatch_logs (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  today_date date NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.reminder_dispatch_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_reminder_logs" ON public.reminder_dispatch_logs;
CREATE POLICY "admin_select_reminder_logs"
  ON public.reminder_dispatch_logs FOR SELECT TO authenticated
  USING (public.is_admin());

-- 作業是否「已有繳交紀錄」（粗規則：任一 task_completion 且未軟刪）
CREATE OR REPLACE FUNCTION public.assignment_has_any_completion(p_assignment_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_completions tc
    WHERE tc.assignment_id = p_assignment_id
      AND tc.student_id = p_student_id
      AND tc.deleted_at IS NULL
      AND tc.status IS DISTINCT FROM 'ai_error'
      AND tc.status IS DISTINCT FROM 'ai_failed'
  );
$$;

-- 學生最近 N 次作業文字近況
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
  done boolean;
  mark text;
BEGIN
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
    done := public.assignment_has_any_completion(rec.id, p_student_id);
    mark := CASE WHEN done THEN '已有繳交' ELSE '尚未繳交' END;
    lines := lines || n::text || '. '
      || COALESCE(NULLIF(trim(rec.title), ''), '未命名作業')
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
  v_body text;
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
BEGIN
  -- 允許 service_role（auth.uid 為 null）或 admin 手動觸發
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION '無權限執行到期提醒掃描';
  END IF;

  v_today := COALESCE(p_today, (timezone('Asia/Taipei', now()))::date);
  v_due_soon := v_today + 2;

  FOR a_rec IN
    SELECT a.id, a.class_id, a.title, a.due_date, a.target_date, a.raw_data
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
      v_title := '作業即將到期（剩 2 天）';
    ELSIF v_due < v_today AND v_allow_late THEN
      v_kind := 'overdue_late';
      v_title := '作業已過截止日（仍可遲交）';
    ELSE
      CONTINUE;
    END IF;

    FOR s_rec IN
      SELECT se.user_id
      FROM public.student_enrollments se
      WHERE se.class_id = a_rec.class_id
        AND se.deleted_at IS NULL
    LOOP
      v_students := v_students + 1;
      v_status_text := public.build_recent_assignment_status_text(a_rec.class_id, s_rec.user_id, 3);
      v_body := v_title || E'\n'
        || '作業：' || COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業') || E'\n'
        || '截止日：' || to_char(v_due, 'YYYY-MM-DD') || E'\n\n'
        || '最近 3 次繳交近況：' || E'\n' || v_status_text
        || E'\n請至學生端「訊息」點本則通知，可前往該作業。';

      v_dedupe := v_kind || ':' || a_rec.id::text || ':' || s_rec.user_id::text || ':' || to_char(v_due, 'YYYYMMDD');

      INSERT INTO public.user_notifications (
        user_id, class_id, assignment_id, kind, title, body, payload, dedupe_key, email_status
      ) VALUES (
        s_rec.user_id,
        a_rec.class_id,
        a_rec.id,
        v_kind,
        v_title,
        v_body,
        jsonb_build_object(
          'assignment_id', a_rec.id,
          'class_id', a_rec.class_id,
          'due_date', to_char(v_due, 'YYYY-MM-DD'),
          'assignment_title', COALESCE(NULLIF(trim(a_rec.title), ''), '未命名作業'),
          'recent_status_text', v_status_text,
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

      -- 家長：同一則提醒（個人近況，非全班）
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
          v_title || '（子女）',
          v_body,
          jsonb_build_object(
            'assignment_id', a_rec.id,
            'class_id', a_rec.class_id,
            'due_date', to_char(v_due, 'YYYY-MM-DD'),
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

GRANT EXECUTE ON FUNCTION public.assignment_has_any_completion(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_recent_assignment_status_text(uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_due_reminders(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_due_reminders(date) TO authenticated;

GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;
GRANT SELECT ON public.reminder_dispatch_logs TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
GRANT ALL ON public.reminder_dispatch_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.reminder_dispatch_logs_id_seq TO service_role;

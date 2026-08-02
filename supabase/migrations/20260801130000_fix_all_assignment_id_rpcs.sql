-- =============================================================================
-- 一次修好：所有 p_assignment_id 寫死 uuid 的 RPC
-- 鐵律：一律用 public.assignments.id%TYPE（或 task_completions.assignment_id%TYPE）
-- 勿再手寫 uuid／bigint
-- =============================================================================

-- 0) 對齊欄位（僅在型別不一致時）
DO $$
DECLARE
  a_udt text;
  tc_udt text;
  un_udt text;
  r record;
BEGIN
  SELECT c.udt_name INTO a_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'assignments' AND c.column_name = 'id';

  SELECT c.udt_name INTO tc_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'task_completions' AND c.column_name = 'assignment_id';

  SELECT c.udt_name INTO un_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'user_notifications' AND c.column_name = 'assignment_id';

  IF a_udt IS NULL THEN
    RAISE EXCEPTION '找不到 public.assignments.id';
  END IF;

  -- task_completions.assignment_id
  IF tc_udt IS NOT NULL AND tc_udt IS DISTINCT FROM a_udt THEN
    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'task_completions'
        AND con.contype = 'f'
        AND pg_get_constraintdef(con.oid) ILIKE '%assignment_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.task_completions DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    IF a_udt = 'int8' THEN
      ALTER TABLE public.task_completions
        ALTER COLUMN assignment_id TYPE bigint
        USING (
          CASE
            WHEN assignment_id IS NULL THEN NULL
            WHEN assignment_id::text ~ '^[0-9]+$' THEN assignment_id::text::bigint
            ELSE NULL
          END
        );
    ELSIF a_udt = 'uuid' THEN
      ALTER TABLE public.task_completions
        ALTER COLUMN assignment_id TYPE uuid
        USING (
          CASE
            WHEN assignment_id IS NULL THEN NULL
            WHEN assignment_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN assignment_id::text::uuid
            ELSE NULL
          END
        );
    END IF;

    BEGIN
      ALTER TABLE public.task_completions
        ADD CONSTRAINT task_completions_assignment_id_fkey
        FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;

  -- user_notifications.assignment_id（若存在）
  IF un_udt IS NOT NULL AND un_udt IS DISTINCT FROM a_udt THEN
    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'user_notifications'
        AND con.contype = 'f'
        AND pg_get_constraintdef(con.oid) ILIKE '%assignment_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    IF a_udt = 'int8' THEN
      ALTER TABLE public.user_notifications
        ALTER COLUMN assignment_id TYPE bigint
        USING (
          CASE
            WHEN assignment_id IS NULL THEN NULL
            WHEN assignment_id::text ~ '^[0-9]+$' THEN assignment_id::text::bigint
            ELSE NULL
          END
        );
    ELSIF a_udt = 'uuid' THEN
      ALTER TABLE public.user_notifications
        ALTER COLUMN assignment_id TYPE uuid
        USING (
          CASE
            WHEN assignment_id IS NULL THEN NULL
            WHEN assignment_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN assignment_id::text::uuid
            ELSE NULL
          END
        );
    END IF;

    BEGIN
      ALTER TABLE public.user_notifications
        ADD CONSTRAINT user_notifications_assignment_id_fkey
        FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- 1) 清掉所有相關多載（簽名一變必須 DROP，否則 overload 地獄）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'student_set_task_completion',
        'submit_audio_task_atomic',
        'assignment_is_fully_complete',
        'assignment_has_any_completion'
      )
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.f || ' CASCADE';
  END LOOP;
END $$;

-- 2) student_set_task_completion
CREATE OR REPLACE FUNCTION public.student_set_task_completion(
  p_assignment_id public.assignments.id%TYPE,
  p_task_id text,
  p_class_id uuid,
  p_completed boolean,
  p_raw_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_id public.task_completions.id%TYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_enrolled_student(p_class_id) THEN
    RAISE EXCEPTION 'Not enrolled in class';
  END IF;

  IF p_completed THEN
    UPDATE public.task_completions
    SET
      assignment_id = p_assignment_id,
      status = 'completed',
      deleted_at = NULL,
      raw_data = CASE
        WHEN p_raw_data IS NULL THEN COALESCE(raw_data, '{}'::jsonb)
        ELSE COALESCE(raw_data, '{}'::jsonb) || p_raw_data
      END,
      updated_at = v_now
    WHERE task_id = p_task_id
      AND student_id = v_uid
      AND class_id = p_class_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      INSERT INTO public.task_completions (
        assignment_id, task_id, student_id, class_id, status, raw_data, deleted_at
      ) VALUES (
        p_assignment_id, p_task_id, v_uid, p_class_id, 'completed',
        COALESCE(p_raw_data, '{}'::jsonb), NULL
      )
      RETURNING id INTO v_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'completed', true);
  END IF;

  UPDATE public.task_completions
  SET
    status = 'incomplete',
    deleted_at = NULL,
    updated_at = v_now
  WHERE task_id = p_task_id
    AND student_id = v_uid
    AND class_id = p_class_id
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'completed', false);
END;
$$;

-- 3) submit_audio_task_atomic（多段版；唯一多載）
CREATE OR REPLACE FUNCTION public.submit_audio_task_atomic(
  p_assignment_id public.assignments.id%TYPE,
  p_task_id text,
  p_student_id uuid,
  p_class_id uuid,
  p_file_id text DEFAULT NULL,
  p_audio_url text DEFAULT NULL,
  p_segments jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id public.task_completions.id%TYPE;
  v_raw_data JSONB;
  v_file_ids text[];
  v_first_url text;
  v_segments jsonb;
  v_submitted jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_student_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_admin()
     AND NOT public.is_class_staff(p_class_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_student_id = auth.uid() AND NOT public.is_enrolled_student(p_class_id) THEN
    RAISE EXCEPTION 'Student is not enrolled in this class';
  END IF;

  IF p_segments IS NOT NULL AND jsonb_typeof(p_segments) = 'array' AND jsonb_array_length(p_segments) > 0 THEN
    v_segments := (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'file_id', COALESCE(seg->>'file_id', seg->>'id'),
          'audio_url', COALESCE(seg->>'audio_url', seg->>'url', ''),
          'unit_key', COALESCE(seg->>'unit_key', ''),
          'stem', COALESCE(seg->>'stem', ''),
          'page', seg->'page',
          'label', COALESCE(seg->>'label', ''),
          'original_script', COALESCE(seg->>'original_script', ''),
          'name', COALESCE(seg->>'name', ''),
          'status', 'pending'
        )
        ORDER BY ord
      ), '[]'::jsonb)
      FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS t(seg, ord)
      WHERE COALESCE(seg->>'file_id', seg->>'id', '') <> ''
    );
    SELECT ARRAY(
      SELECT COALESCE(s->>'file_id', '')
      FROM jsonb_array_elements(v_segments) AS s
      WHERE COALESCE(s->>'file_id', '') <> ''
    ) INTO v_file_ids;
    v_first_url := COALESCE(v_segments->0->>'audio_url', p_audio_url, '');
    v_submitted := (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', s->>'file_id',
          'mime', 'audio/wav',
          'name', COALESCE(NULLIF(s->>'name', ''), 'recording.wav'),
          'unit_key', s->>'unit_key',
          'label', s->>'label'
        )
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_segments) AS s
    );
  ELSE
    IF p_file_id IS NULL OR btrim(p_file_id) = '' THEN
      RAISE EXCEPTION 'p_file_id or p_segments required';
    END IF;
    v_file_ids := ARRAY[p_file_id];
    v_first_url := COALESCE(p_audio_url, '');
    v_segments := jsonb_build_array(
      jsonb_build_object(
        'file_id', p_file_id,
        'audio_url', v_first_url,
        'unit_key', '',
        'label', '',
        'original_script', '',
        'name', 'recording.wav',
        'status', 'pending'
      )
    );
    v_submitted := jsonb_build_array(
      jsonb_build_object('id', p_file_id, 'mime', 'audio/wav', 'name', 'recording.wav')
    );
  END IF;

  SELECT id, raw_data INTO v_existing_id, v_raw_data
  FROM public.task_completions
  WHERE student_id = p_student_id
    AND task_id = p_task_id
    AND class_id = p_class_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.task_completions
    SET
      status = 'ai_processing',
      raw_data = COALESCE(v_raw_data, '{}'::jsonb) || jsonb_build_object(
        'drive_file_ids', to_jsonb(v_file_ids),
        'student_audio_url', v_first_url,
        'audio_url', v_first_url,
        'audio_segments', v_segments,
        'submitted_files', v_submitted,
        'submitted_at', (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
        'ai_segment_cursor', 0
      ) - 'ai_error_log' - 'failed_at' - 'ai_skip_reason' - 'ai_skipped_at',
      updated_at = NOW()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.task_completions (
      assignment_id,
      task_id,
      student_id,
      class_id,
      status,
      raw_data
    )
    VALUES (
      p_assignment_id,
      p_task_id,
      p_student_id,
      p_class_id,
      'ai_processing',
      jsonb_build_object(
        'drive_file_ids', to_jsonb(v_file_ids),
        'student_audio_url', v_first_url,
        'audio_url', v_first_url,
        'audio_segments', v_segments,
        'submitted_files', v_submitted,
        'submitted_at', (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
        'ai_segment_cursor', 0
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ai_processing',
    'segment_count', COALESCE(jsonb_array_length(v_segments), 0),
    'message', '任務已成功提交，AI 大腦已接管'
  );
END;
$$;

-- 4) assignment_is_fully_complete
CREATE OR REPLACE FUNCTION public.assignment_is_fully_complete(
  p_assignment_id public.assignments.id%TYPE,
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
    AND tc.status IS DISTINCT FROM 'incomplete'
    AND tc.task_id::text = ANY (leaf_ids);

  RETURN done_count >= total;
END;
$$;

-- 5) assignment_has_any_completion
CREATE OR REPLACE FUNCTION public.assignment_has_any_completion(
  p_assignment_id public.assignments.id%TYPE,
  p_student_id uuid
)
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
      AND tc.status IS DISTINCT FROM 'incomplete'
      AND tc.status IS DISTINCT FROM 'ai_error'
      AND tc.status IS DISTINCT FROM 'ai_failed'
  );
$$;

-- 6) GRANT（依實際展開後的簽名）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'student_set_task_completion',
        'submit_audio_task_atomic',
        'assignment_is_fully_complete',
        'assignment_has_any_completion'
      )
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
      r.proname,
      r.sig
    );
  END LOOP;
END $$;

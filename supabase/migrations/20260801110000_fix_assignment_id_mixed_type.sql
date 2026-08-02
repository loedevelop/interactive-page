-- 混血型別雷區：assignments.id 可能是 BIGINT，不可把 p_assignment_id 寫死成 uuid
-- （否則學生繳交會出現：invalid input syntax for type uuid: "155"）

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'student_set_task_completion'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.f || ' CASCADE';
  END LOOP;
END $$;

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

DO $$
DECLARE
  sig text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid)
  INTO sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'student_set_task_completion'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF sig IS NOT NULL THEN
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.student_set_task_completion(%s) TO authenticated',
      sig
    );
  END IF;
END $$;

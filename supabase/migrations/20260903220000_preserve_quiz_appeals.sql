-- 申訴紀錄不准用空陣列蓋掉。
-- jsonb || 遇到 p_raw_data.quiz_appeals = [] 會整包取代既有列；
-- 老師端 saveCompletionRawData 也曾把重批後的空陣列整份寫回。
-- 有紀錄就留下：只能追加新題、或把 pending 改成 accepted／rejected。

CREATE OR REPLACE FUNCTION public.quiz_appeal_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_status, '')))
    WHEN 'accepted' THEN 3
    WHEN 'rejected' THEN 2
    WHEN 'pending' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.merge_quiz_appeals(p_existing jsonb, p_incoming jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_existing jsonb;
  v_incoming jsonb;
  v_out jsonb := '[]'::jsonb;
  v_by_id jsonb := '{}'::jsonb;
  v_noid jsonb := '[]'::jsonb;
  v_order text[] := ARRAY[]::text[];
  v_item jsonb;
  v_id text;
  v_kept jsonb;
  v_merged jsonb;
  v_key text;
BEGIN
  v_existing := CASE WHEN jsonb_typeof(p_existing) = 'array' THEN p_existing ELSE '[]'::jsonb END;
  v_incoming := CASE WHEN jsonb_typeof(p_incoming) = 'array' THEN p_incoming ELSE '[]'::jsonb END;

  IF jsonb_typeof(p_existing) IS DISTINCT FROM 'array'
     AND p_existing IS NOT NULL
     AND p_existing <> 'null'::jsonb
     AND jsonb_array_length(v_incoming) = 0 THEN
    RETURN p_existing;
  END IF;

  IF jsonb_array_length(v_existing) > 0 AND jsonb_array_length(v_incoming) = 0 THEN
    RETURN v_existing;
  END IF;

  IF jsonb_array_length(v_existing) = 0 AND jsonb_array_length(v_incoming) > 0 THEN
    RETURN v_incoming;
  END IF;

  IF jsonb_array_length(v_existing) = 0 AND jsonb_array_length(v_incoming) = 0 THEN
    IF jsonb_typeof(p_existing) = 'array' THEN RETURN v_existing; END IF;
    IF jsonb_typeof(p_incoming) = 'array' THEN RETURN v_incoming; END IF;
    RETURN COALESCE(p_existing, '[]'::jsonb);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_existing)
  LOOP
    v_id := NULLIF(btrim(COALESCE(v_item->>'item_id', '')), '');
    IF v_id IS NULL THEN
      v_noid := v_noid || jsonb_build_array(v_item);
    ELSIF NOT (v_by_id ? v_id) THEN
      v_by_id := jsonb_set(v_by_id, ARRAY[v_id], v_item);
      v_order := v_order || v_id;
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_incoming)
  LOOP
    v_id := NULLIF(btrim(COALESCE(v_item->>'item_id', '')), '');
    IF v_id IS NULL THEN
      v_noid := v_noid || jsonb_build_array(v_item);
    ELSIF v_by_id ? v_id THEN
      v_kept := v_by_id -> v_id;
      v_merged := v_kept || v_item;
      IF public.quiz_appeal_status_rank(v_kept->>'status') > public.quiz_appeal_status_rank(v_item->>'status') THEN
        v_merged := jsonb_set(v_merged, '{status}', to_jsonb(v_kept->>'status'));
      END IF;
      v_by_id := jsonb_set(v_by_id, ARRAY[v_id], v_merged);
    ELSE
      v_by_id := jsonb_set(v_by_id, ARRAY[v_id], v_item);
      v_order := v_order || v_id;
    END IF;
  END LOOP;

  v_out := v_noid;
  FOREACH v_key IN ARRAY v_order
  LOOP
    v_out := v_out || jsonb_build_array(v_by_id -> v_key);
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_task_completion_raw_data(p_existing jsonb, p_incoming jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_existing jsonb := COALESCE(p_existing, '{}'::jsonb);
  v_incoming jsonb := COALESCE(p_incoming, '{}'::jsonb);
BEGIN
  IF p_incoming IS NULL THEN
    RETURN v_existing;
  END IF;
  IF v_incoming ? 'quiz_appeals' THEN
    RETURN (v_existing || (v_incoming - 'quiz_appeals'))
      || jsonb_build_object(
        'quiz_appeals',
        public.merge_quiz_appeals(v_existing -> 'quiz_appeals', v_incoming -> 'quiz_appeals')
      );
  END IF;
  RETURN v_existing || v_incoming;
END;
$$;

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
      raw_data = public.merge_task_completion_raw_data(raw_data, p_raw_data),
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
    assignment_id = p_assignment_id,
    status = 'incomplete',
    deleted_at = NULL,
    raw_data = public.merge_task_completion_raw_data(raw_data, p_raw_data),
    updated_at = v_now
  WHERE task_id = p_task_id
    AND student_id = v_uid
    AND class_id = p_class_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.task_completions (
      assignment_id, task_id, student_id, class_id, status, raw_data, deleted_at
    ) VALUES (
      p_assignment_id, p_task_id, v_uid, p_class_id, 'incomplete',
      COALESCE(p_raw_data, '{}'::jsonb), NULL
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'completed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_set_task_completion(uuid, text, uuid, boolean, jsonb) TO authenticated;

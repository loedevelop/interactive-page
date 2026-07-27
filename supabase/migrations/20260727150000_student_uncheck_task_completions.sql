-- 取消勾選 = 標記「未完成」(status = incomplete)，不是刪除列
-- 並提供學生可靠的勾選／取消 RPC

DROP POLICY IF EXISTS "student_update_own_completions" ON public.task_completions;
DROP POLICY IF EXISTS "student_delete_own_completions" ON public.task_completions;
DROP POLICY IF EXISTS "student_select_own_completions_including_deleted" ON public.task_completions;

CREATE POLICY "student_update_own_completions"
  ON public.task_completions
  FOR UPDATE
  USING (
    student_id = auth.uid()
    AND public.is_enrolled_student(class_id)
  )
  WITH CHECK (
    student_id = auth.uid()
    AND public.is_enrolled_student(class_id)
  );

-- 允許學生看到自己含舊 soft-delete 列（便於重新勾選時復活）
CREATE POLICY "student_select_own_completions_including_deleted"
  ON public.task_completions
  FOR SELECT
  USING (student_id = auth.uid());

-- 完成判定：未刪除，且不是「取消勾選後的未完成」
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
    AND tc.status IS DISTINCT FROM 'incomplete'
    AND tc.task_id::text = ANY (leaf_ids);

  RETURN done_count >= total;
END;
$$;

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
      AND tc.status IS DISTINCT FROM 'incomplete'
      AND tc.status IS DISTINCT FROM 'ai_error'
      AND tc.status IS DISTINCT FROM 'ai_failed'
  );
$$;

-- 勾選／取消：只改狀態，不刪列
CREATE OR REPLACE FUNCTION public.student_set_task_completion(
  p_assignment_id uuid,
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
  v_id uuid;
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

  -- 取消勾選：標記未完成（保留紀錄，不刪除）
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

GRANT EXECUTE ON FUNCTION public.student_set_task_completion(uuid, text, uuid, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_is_fully_complete(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_has_any_completion(uuid, uuid) TO authenticated;

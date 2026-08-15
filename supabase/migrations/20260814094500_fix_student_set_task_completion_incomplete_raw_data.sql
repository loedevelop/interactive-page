-- 修正 student_set_task_completion：p_completed = false 分支完全沒有合併 p_raw_data
--
-- 雷區說明（2026-08-14）：✍️ 輸入練習／🔧 輸入改正每打對一次，都會呼叫
-- persistResult(..., false)（因為這一題還沒「完成」，只是多打對一次），前端以為
-- 這樣就會把最新進度存進 task_completions.raw_data.input_practice_progress。
-- 但 20260801140000_unify_assignments_id_to_uuid.sql 裡的 p_completed=false 分支
-- 只有：
--   UPDATE task_completions SET status='incomplete', deleted_at=NULL, updated_at=v_now
-- 完全沒有動 raw_data，導致這一整類「還在進行中、但想順手存一點進度」的呼叫
-- 永遠存不進資料庫——RPC 回傳成功（沒有 error），前端以為存好了，但下次續打／
-- 重新整理回來看到的其實是最舊的一份，看起來像「沒有真的續打」。
--
-- 這個舊分支同時也完全沒有 INSERT 備援：如果這個任務從來沒有 task_completions
-- 資料列（學生第一次打開就直接進輸入練習，還沒有任何 completed=true 的紀錄），
-- UPDATE 會找不到列、什麼都不會發生，第一批打對的進度就直接消失。
--
-- 修正：p_completed=false 分支改成跟 p_completed=true 分支同一套語意——
-- 用 shallow merge（COALESCE(raw_data,'{}') || p_raw_data）合併 raw_data，
-- 找不到既有列時 INSERT 一筆 status='incomplete' 的新列。status 依然照
-- p_completed 決定（false → incomplete），不影響「取消打勾」原本要的效果。

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

  -- p_completed = false：跟上面同一套 shallow merge，只有 status 改成 incomplete。
  UPDATE public.task_completions
  SET
    assignment_id = p_assignment_id,
    status = 'incomplete',
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
      p_assignment_id, p_task_id, v_uid, p_class_id, 'incomplete',
      COALESCE(p_raw_data, '{}'::jsonb), NULL
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'completed', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_set_task_completion(uuid, text, uuid, boolean, jsonb) TO authenticated;

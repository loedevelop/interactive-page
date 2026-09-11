-- 申訴審核即時同步：學生端「全班申訴審核進度」彙總 RPC。
-- task_completions 的 RLS 只允許 student_id = auth.uid() 讀自己那一列，學生不能直接查表拿到
-- 全班的 quiz_appeals；這支 RPC 只回傳 pending/accepted/rejected/total 四個數字（不含任何
-- 學生姓名、答案內容），讓已送過申訴的學生也能看到老師目前審核到第幾筆。

CREATE OR REPLACE FUNCTION public.get_quiz_appeal_progress(
  p_assignment_id uuid,
  p_task_id text,
  p_class_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending integer := 0;
  v_accepted integer := 0;
  v_rejected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.is_enrolled_student(p_class_id) OR public.is_class_staff(p_class_id)) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE lower(btrim(COALESCE(appeal->>'status', ''))) = 'pending'),
    COUNT(*) FILTER (WHERE lower(btrim(COALESCE(appeal->>'status', ''))) = 'accepted'),
    COUNT(*) FILTER (WHERE lower(btrim(COALESCE(appeal->>'status', ''))) = 'rejected')
  INTO v_pending, v_accepted, v_rejected
  FROM public.task_completions tc
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(tc.raw_data -> 'quiz_appeals') = 'array' THEN tc.raw_data -> 'quiz_appeals'
      ELSE '[]'::jsonb
    END
  ) AS appeal
  WHERE tc.assignment_id = p_assignment_id
    AND tc.task_id = p_task_id
    AND tc.class_id = p_class_id
    AND tc.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'pending', v_pending,
    'accepted', v_accepted,
    'rejected', v_rejected,
    'total', v_pending + v_accepted + v_rejected,
    'checked_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_quiz_appeal_progress(uuid, text, uuid) TO authenticated;

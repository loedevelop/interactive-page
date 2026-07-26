-- Enable RLS on previously unrestricted tables.
-- task_completions: full role-based policies for students, staff, parents, admin.
-- resource_mappings / student_progress / test_results: legacy or unused via client; admin-only.

CREATE OR REPLACE FUNCTION public.is_class_staff(target_cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_staff cs
    WHERE cs.class_id = target_cid
      AND cs.user_id = auth.uid()
      AND cs.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_enrolled_student(target_cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_enrollments se
    WHERE se.class_id = target_cid
      AND se.user_id = auth.uid()
      AND se.deleted_at IS NULL
  );
$$;

-- ---------------------------------------------------------------------------
-- task_completions
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_task_completions" ON public.task_completions;
DROP POLICY IF EXISTS "student_select_own_completions" ON public.task_completions;
DROP POLICY IF EXISTS "student_insert_own_completions" ON public.task_completions;
DROP POLICY IF EXISTS "student_update_own_completions" ON public.task_completions;
DROP POLICY IF EXISTS "staff_select_class_completions" ON public.task_completions;
DROP POLICY IF EXISTS "staff_update_class_completions" ON public.task_completions;
DROP POLICY IF EXISTS "parent_select_child_completions" ON public.task_completions;

CREATE POLICY "admin_all_task_completions"
  ON public.task_completions
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "student_select_own_completions"
  ON public.task_completions
  FOR SELECT
  USING (
    student_id = auth.uid()
    AND deleted_at IS NULL
  );

CREATE POLICY "student_insert_own_completions"
  ON public.task_completions
  FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND public.is_enrolled_student(class_id)
  );

CREATE POLICY "student_update_own_completions"
  ON public.task_completions
  FOR UPDATE
  USING (
    student_id = auth.uid()
    AND public.is_enrolled_student(class_id)
  )
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "staff_select_class_completions"
  ON public.task_completions
  FOR SELECT
  USING (public.is_class_staff(class_id));

CREATE POLICY "staff_update_class_completions"
  ON public.task_completions
  FOR UPDATE
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

CREATE POLICY "parent_select_child_completions"
  ON public.task_completions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.parent_child_mappings pcm
      WHERE pcm.child_user_id = task_completions.student_id
        AND pcm.parent_user_id = auth.uid()
        AND pcm.deleted_at IS NULL
    )
  );

-- Harden RPC: student self-submit or class staff backfill on behalf of student.
CREATE OR REPLACE FUNCTION public.submit_audio_task_atomic(
  p_assignment_id uuid,
  p_task_id text,
  p_student_id uuid,
  p_class_id uuid,
  p_file_id text,
  p_audio_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id task_completions.id%TYPE;
  v_raw_data JSONB;
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

  SELECT id, raw_data INTO v_existing_id, v_raw_data
  FROM task_completions
  WHERE student_id = p_student_id
    AND task_id = p_task_id
    AND class_id = p_class_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE task_completions
    SET
      status = 'ai_processing',
      raw_data = COALESCE(v_raw_data, '{}'::jsonb) || jsonb_build_object(
        'drive_file_ids', ARRAY[p_file_id],
        'student_audio_url', p_audio_url,
        'submitted_at', (EXTRACT(EPOCH FROM now()) * 1000)::bigint
      ),
      updated_at = NOW()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO task_completions (
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
        'drive_file_ids', ARRAY[p_file_id],
        'student_audio_url', p_audio_url,
        'submitted_at', (EXTRACT(EPOCH FROM now()) * 1000)::bigint
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ai_processing',
    'message', '任務已成功提交，AI 大腦已接管'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Legacy / unused client tables: lock down (admin + service role only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.resource_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_resource_mappings" ON public.resource_mappings;
DROP POLICY IF EXISTS "admin_all_student_progress" ON public.student_progress;
DROP POLICY IF EXISTS "admin_all_test_results" ON public.test_results;

CREATE POLICY "admin_all_resource_mappings"
  ON public.resource_mappings
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_all_student_progress"
  ON public.student_progress
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "admin_all_test_results"
  ON public.test_results
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

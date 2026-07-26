-- Fix: restore must bring back soft-deleted enrollments / staff / student profiles

CREATE OR REPLACE FUNCTION public.restore_class_atomic(target_class_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enroll_restored int := 0;
  staff_restored int := 0;
  assign_restored int := 0;
  profile_restored int := 0;
BEGIN
  IF NOT (public.is_admin() OR public.is_primary_teacher_of_class(target_class_id)) THEN
    RAISE EXCEPTION '無權限恢復此班級';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = target_class_id) THEN
    RAISE EXCEPTION '找不到班級';
  END IF;

  -- 若仍在封存中，先恢復班級本體（已恢復的班級此句影響 0 列）
  UPDATE public.classes
  SET deleted_at = NULL
  WHERE id = target_class_id AND deleted_at IS NOT NULL;

  UPDATE public.assignments
  SET deleted_at = NULL
  WHERE class_id = target_class_id
    AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS assign_restored = ROW_COUNT;

  UPDATE public.student_enrollments
  SET deleted_at = NULL
  WHERE class_id = target_class_id
    AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS enroll_restored = ROW_COUNT;

  UPDATE public.class_staff
  SET deleted_at = NULL
  WHERE class_id = target_class_id
    AND deleted_at IS NOT NULL;
  GET DIAGNOSTICS staff_restored = ROW_COUNT;

  -- 封存時若勾選「連同學生帳號軟刪除」，一併恢復本班相關 profile
  UPDATE public.profiles p
  SET deleted_at = NULL
  WHERE p.deleted_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.student_enrollments se
      WHERE se.class_id = target_class_id
        AND se.user_id = p.id
    );
  GET DIAGNOSTICS profile_restored = ROW_COUNT;

  IF NOT EXISTS (
    SELECT 1 FROM public.classes
    WHERE id = target_class_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '找不到可恢復的封存班級';
  END IF;

  RETURN json_build_object(
    'status', 'success',
    'class_id', target_class_id,
    'assignments_restored', assign_restored,
    'enrollments_restored', enroll_restored,
    'staff_restored', staff_restored,
    'profiles_restored', profile_restored
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_class_atomic(uuid) TO authenticated;

-- 老師可更新本班成員的 profiles 姓名（繞過「只能改自己」的 RLS）

CREATE OR REPLACE FUNCTION public.staff_update_member_profile(
  target_user_id uuid,
  target_class_id uuid,
  new_display_name text,
  p_name_en text DEFAULT NULL,
  p_passport_last text DEFAULT NULL,
  p_passport_first text DEFAULT NULL,
  p_last_cn text DEFAULT NULL,
  p_first_cn text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_raw jsonb;
  new_raw jsonb;
  updated_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登入';
  END IF;

  IF NOT (public.is_admin() OR public.is_class_staff(target_class_id)) THEN
    RAISE EXCEPTION '無權限修改此班級成員資料';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.student_enrollments se
    WHERE se.class_id = target_class_id
      AND se.user_id = target_user_id
      AND se.deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.class_staff cs
    WHERE cs.class_id = target_class_id
      AND cs.user_id = target_user_id
      AND cs.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '該成員不在此班級中';
  END IF;

  SELECT COALESCE(raw_data, '{}'::jsonb) INTO old_raw
  FROM public.profiles
  WHERE id = target_user_id;

  IF old_raw IS NULL THEN
    RAISE EXCEPTION '找不到該使用者主檔';
  END IF;

  new_raw := old_raw
    || jsonb_build_object(
      'nameEN', COALESCE(p_name_en, ''),
      'passportLast', COALESCE(p_passport_last, ''),
      'passportFirst', COALESCE(p_passport_first, ''),
      'lastNameCN', COALESCE(p_last_cn, ''),
      'firstNameCN', COALESCE(p_first_cn, '')
    );

  UPDATE public.profiles
  SET
    name = COALESCE(NULLIF(trim(new_display_name), ''), name),
    raw_data = new_raw
  WHERE id = target_user_id
  RETURNING id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION '寫入 profiles 失敗（0 列更新）';
  END IF;

  RETURN json_build_object(
    'status', 'success',
    'user_id', updated_id,
    'name', COALESCE(NULLIF(trim(new_display_name), ''), '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_update_member_profile(uuid, uuid, text, text, text, text, text, text) TO authenticated;

-- 出作業／出題範圍卡的 statistics：這個班已指派的套餐＋這本活頁。
-- 不是 class_review_catalog（那是學生練習專區）。

CREATE OR REPLACE VIEW public.class_combo_statistics
WITH (security_invoker = true)
AS
SELECT
  cmc.class_id,
  c.id AS combination_id,
  COALESCE(NULLIF(BTRIM(c.label), ''), '') AS combo_label,
  c.material_folder_id,
  f.folder_name,
  f.root_kind,
  s.id AS material_sheet_id,
  s.sheet_stem,
  s.meta_file_name,
  COALESCE(s.is_group, false) AS is_group,
  s.available_count,
  c.extraction_template_id,
  t.name AS extraction_template_name,
  c.student_pdf_file_id,
  c.student_pdf_file_name,
  c.student_pdf_page_map,
  COALESCE((
    SELECT jsonb_agg(e.exam_template_id)
    FROM public.material_combination_exam_templates e
    WHERE e.material_combination_id = c.id
  ), '[]'::jsonb) AS exam_template_ids
FROM public.class_material_combinations cmc
JOIN public.material_combinations c ON c.id = cmc.material_combination_id
JOIN public.material_folders f ON f.id = c.material_folder_id
LEFT JOIN public.material_templates t ON t.id = c.extraction_template_id
LEFT JOIN public.material_combination_sheets cs ON cs.combination_id = c.id
LEFT JOIN public.material_sheets s ON s.id = cs.material_sheet_id;

COMMENT ON VIEW public.class_combo_statistics IS
  '出作業範圍 statistics。一列＝一班＋一份已指派套餐＋這份自己的一本活頁。不是複習目錄。';

GRANT SELECT ON public.class_combo_statistics TO authenticated;

CREATE OR REPLACE FUNCTION public.fetch_class_combo_stats(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not class staff';
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(v) ORDER BY v.combo_label, v.sheet_stem),
    '[]'::jsonb
  )
  INTO v_out
  FROM public.class_combo_statistics v
  WHERE v.class_id = p_class_id;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.fetch_class_combo_stats(uuid) IS
  '一次載入這個班出作業範圍所需的 statistics（已指派套餐＋活頁）。來源是 class_combo_statistics，不是複習目錄。';

GRANT EXECUTE ON FUNCTION public.fetch_class_combo_stats(uuid) TO authenticated;

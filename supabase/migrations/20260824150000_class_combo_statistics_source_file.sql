-- 出作業套餐鑰匙＝資料夾＋來源檔＋擷取範本。statistics 要帶來源檔，才能把沒勾群組時
-- 「一本活頁一份 combination」收成一份套餐，不准跟另一個 Excel 併在一起。

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
  s.source_file_name,
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
  '出作業範圍 statistics。一列＝一班＋一份已指派套餐＋這份自己的一本活頁。套餐鑰匙＝資料夾＋來源檔＋擷取範本。不是複習目錄。';

-- 範本庫（material_templates）第二步：把三個 FK 改接到新表。
--
-- id 值在上一個 migration（20260814170000）搬資料時原樣保留，所以這裡不用改任何欄位資料，
-- 只需要把約束（constraint）指到 material_templates 而已。
--
-- material_sheets.extraction_template_id → material_templates(id)
-- material_combinations.extraction_template_id → material_templates(id)
-- material_combination_exam_templates.exam_template_id → material_templates(id)

ALTER TABLE public.material_sheets
  DROP CONSTRAINT IF EXISTS material_sheets_layout_template_id_fkey;
ALTER TABLE public.material_sheets
  ADD CONSTRAINT material_sheets_extraction_template_id_fkey
  FOREIGN KEY (extraction_template_id) REFERENCES public.material_templates(id) ON DELETE SET NULL;

ALTER TABLE public.material_combinations
  DROP CONSTRAINT IF EXISTS material_combinations_layout_template_id_fkey;
ALTER TABLE public.material_combinations
  ADD CONSTRAINT material_combinations_extraction_template_id_fkey
  FOREIGN KEY (extraction_template_id) REFERENCES public.material_templates(id) ON DELETE SET NULL;

ALTER TABLE public.material_combination_exam_templates
  DROP CONSTRAINT IF EXISTS material_combination_exam_templates_exam_template_id_fkey;
ALTER TABLE public.material_combination_exam_templates
  ADD CONSTRAINT material_combination_exam_templates_exam_template_id_fkey
  FOREIGN KEY (exam_template_id) REFERENCES public.material_templates(id) ON DELETE CASCADE;

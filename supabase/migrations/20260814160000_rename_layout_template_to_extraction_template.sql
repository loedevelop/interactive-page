-- 分離「擷取範本」與「考卷範本」第一步：material_layout_templates → material_extraction_templates。
--
-- 背景（老師 2026-08-14 明確指出）：「Layout」這個字被同時用在兩個本質不同的概念上——
--   1) Excel 欄位 → meta.json 的 semantic_key 對應規則（這張表，決定怎麼「截取資料」）
--   2) meta.json 的列 → 考題呈現方式（layout_profile_id／LAYOUT_CATALOG，決定怎麼「出考題」，
--      之後改叫「考卷範本」material_exam_templates，見同一輪後續 migration）
-- 兩者共用「layout」一詞是這輪一連串誤解（把每個擷取範本自動當成考卷範本套用到底）的根源
-- 之一。這裡把「擷取」這一側的命名全面改成 extraction_template，之後「layout」這個字只留給
-- 考卷範本那一側使用，不再混用。

ALTER TABLE public.material_layout_templates RENAME TO material_extraction_templates;

ALTER TABLE public.material_sheets RENAME COLUMN layout_template_id TO extraction_template_id;
ALTER TABLE public.material_combinations RENAME COLUMN layout_template_id TO extraction_template_id;

ALTER INDEX IF EXISTS idx_material_layout_templates_teacher RENAME TO idx_material_extraction_templates_teacher;
ALTER INDEX IF EXISTS uq_material_layout_templates_legacy RENAME TO uq_material_extraction_templates_legacy;
ALTER INDEX IF EXISTS idx_material_sheets_template RENAME TO idx_material_sheets_extraction_template;

-- RLS policy 改名（內容不變，只是名稱跟著新表名一致，避免之後查 pg_policies 誤會是舊表殘留）
ALTER POLICY "admin_all_material_layout_templates" ON public.material_extraction_templates
  RENAME TO "admin_all_material_extraction_templates";
ALTER POLICY "teacher_all_own_material_layout_templates" ON public.material_extraction_templates
  RENAME TO "teacher_all_own_material_extraction_templates";

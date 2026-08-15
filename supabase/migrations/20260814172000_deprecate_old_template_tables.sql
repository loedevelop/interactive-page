-- 範本庫合併第三步（收尾）：material_extraction_templates／material_exam_templates 兩張表
-- 的資料已經在 20260814170000 完整搬進 material_templates（保留原 id），三個 FK 也已在
-- 20260814171000 改接過去，前端（feature-material-layout-pairing.js／feature-exam-job.js／
-- feature-exam-template-editor.js／feature-class-material-combinations.js）也都已經改成呼叫
-- feature-template-library.js（FeatureTemplateLibrary）讀寫 material_templates，不再讀寫這兩張表。
--
-- 這裡先只標記 deprecated（COMMENT ON TABLE），暫不 DROP——留一段觀察期，若之後發現有漏改的
-- 呼叫端（或需要核對遷移前後資料是否一致），這兩張表還在，可以直接查。等穩定確認沒有任何前端
-- 程式碼還在讀寫這兩張表之後，再另開一個 migration 真正 DROP。

COMMENT ON TABLE public.material_extraction_templates IS
  'DEPRECATED 2026-08-14：已併入 public.material_templates（is_extraction_role=true），
   資料與原 id 已搬移過去，三個 FK（material_sheets/material_combinations.extraction_template_id）
   也已改接 material_templates。前端不再讀寫這張表，只是暫留備份，觀察穩定後另開 migration DROP。
   見 supabase/migrations/20260814170000_create_material_templates_unified.sql。';

COMMENT ON TABLE public.material_exam_templates IS
  'DEPRECATED 2026-08-14：已併入 public.material_templates（is_exam_role=true），
   資料與原 id（含已軟刪除的內建種子範本）已搬移過去，material_combination_exam_templates.exam_template_id
   也已改接 material_templates。前端不再讀寫這張表，只是暫留備份，觀察穩定後另開 migration DROP。
   見 supabase/migrations/20260814170000_create_material_templates_unified.sql。';

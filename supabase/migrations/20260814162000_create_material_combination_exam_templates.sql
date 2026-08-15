-- 分離「擷取範本」與「考卷範本」第三步：material_combination_exam_templates。
--
-- 記錄「這個教材組合（資料夾＋擷取範本＋一組活頁）要搭配哪個/哪些考卷範本」——這是老師
-- 在「🏫 班級教材組合」Step 2 明確勾選的結果，不是系統自動推算。一個組合可以搭配多個
-- 考卷範本（同一份 meta 可以用不同排版方式出題），is_default 標記這幾個裡老師預設想用哪一個。

CREATE TABLE IF NOT EXISTS public.material_combination_exam_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_combination_id uuid NOT NULL REFERENCES public.material_combinations(id) ON DELETE CASCADE,
  exam_template_id uuid NOT NULL REFERENCES public.material_exam_templates(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_combination_id, exam_template_id)
);

CREATE INDEX IF NOT EXISTS idx_material_combination_exam_templates_combo
  ON public.material_combination_exam_templates (material_combination_id);
CREATE INDEX IF NOT EXISTS idx_material_combination_exam_templates_exam
  ON public.material_combination_exam_templates (exam_template_id);

ALTER TABLE public.material_combination_exam_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_combination_exam_templates" ON public.material_combination_exam_templates;
DROP POLICY IF EXISTS "access_own_material_combination_exam_templates" ON public.material_combination_exam_templates;
CREATE POLICY "admin_all_material_combination_exam_templates"
  ON public.material_combination_exam_templates FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- 沿用既有 can_access_material_combination()（見 20260814150000），組合的擁有者／班級 staff
-- 才能讀寫這個組合搭配了哪些考卷範本
CREATE POLICY "access_own_material_combination_exam_templates"
  ON public.material_combination_exam_templates FOR ALL
  USING (public.can_access_material_combination(material_combination_id))
  WITH CHECK (public.can_access_material_combination(material_combination_id));

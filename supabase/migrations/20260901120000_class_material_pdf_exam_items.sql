-- PDF 套餐跟 Excel／JSON／課本同層：有套餐名、可勾採用班級。
-- 出作業下拉只列這個班有勾的。不碰 material_combinations／combo_statistics。

ALTER TABLE public.material_pdf_exam_items
  ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.material_pdf_exam_items.label IS
  '套餐名稱。出作業下拉走 comboLabelText；沒填＝PDF 檔名。';

CREATE TABLE IF NOT EXISTS public.class_material_pdf_exam_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  pdf_exam_item_id uuid NOT NULL REFERENCES public.material_pdf_exam_items(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, pdf_exam_item_id)
);

CREATE INDEX IF NOT EXISTS idx_class_material_pdf_exam_items_class
  ON public.class_material_pdf_exam_items (class_id);

COMMENT ON TABLE public.class_material_pdf_exam_items IS
  'PDF 套餐勾給哪些班。出作業下拉只列這個班有勾的。';

ALTER TABLE public.class_material_pdf_exam_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_class_material_pdf_exam_items" ON public.class_material_pdf_exam_items;
DROP POLICY IF EXISTS "staff_class_material_pdf_exam_items" ON public.class_material_pdf_exam_items;
CREATE POLICY "admin_all_class_material_pdf_exam_items"
  ON public.class_material_pdf_exam_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_class_material_pdf_exam_items"
  ON public.class_material_pdf_exam_items FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_material_pdf_exam_items TO authenticated;
GRANT ALL ON public.class_material_pdf_exam_items TO service_role;

-- PDF 考卷在教材區的套用紀錄＋每份 PDF 自己的 txt 答案。
-- 不碰 material_combinations／material_sheets／combo_statistics（Excel／JSON 套餐表）。

CREATE TABLE IF NOT EXISTS public.material_pdf_exam_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_folder_id uuid REFERENCES public.material_folders(id) ON DELETE SET NULL,
  folder_name text NOT NULL DEFAULT '',
  pdf_file_id text NOT NULL,
  pdf_file_name text NOT NULL DEFAULT '',
  exam_template_key text NOT NULL,
  answer_text_raw text NOT NULL DEFAULT '',
  parsed_bank jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_page_hints jsonb NOT NULL DEFAULT '{}'::jsonb,
  split_review jsonb,
  is_group boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, pdf_file_id, exam_template_key)
);

CREATE INDEX IF NOT EXISTS idx_material_pdf_exam_items_teacher
  ON public.material_pdf_exam_items (teacher_id);
CREATE INDEX IF NOT EXISTS idx_material_pdf_exam_items_folder
  ON public.material_pdf_exam_items (teacher_id, folder_name);

COMMENT ON TABLE public.material_pdf_exam_items IS
  '教材區 PDF 來源＋試卷範本。一列＝一份 PDF＋一種試卷範本＋這份自己的 txt 答案。不是 Excel／JSON 套餐。';
COMMENT ON COLUMN public.material_pdf_exam_items.exam_template_key IS
  '目前內建 detect-sections-student-locate（自動偵測大題、學生定位答案）。之後會有很多種。';

ALTER TABLE public.material_pdf_exam_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_pdf_exam_items" ON public.material_pdf_exam_items;
DROP POLICY IF EXISTS "own_material_pdf_exam_items" ON public.material_pdf_exam_items;
CREATE POLICY "admin_all_material_pdf_exam_items"
  ON public.material_pdf_exam_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "own_material_pdf_exam_items"
  ON public.material_pdf_exam_items FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_pdf_exam_items TO authenticated;
GRANT ALL ON public.material_pdf_exam_items TO service_role;

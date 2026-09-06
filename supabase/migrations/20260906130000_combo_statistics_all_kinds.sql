-- 三種套餐同等地位：combo_statistics 含 Excel/JSON、PDF、目錄。
-- Excel 畫卡／出作業 sheet 開口仍只認 kind=sheet。不准把 PDF／目錄拿去走 ensureCombination。

ALTER TABLE public.combo_statistics
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sheet',
  ADD COLUMN IF NOT EXISTS pdf_item_id uuid REFERENCES public.material_pdf_exam_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS book_combo_id uuid REFERENCES public.material_book_combos(id) ON DELETE CASCADE;

ALTER TABLE public.combo_statistics
  ALTER COLUMN combination_id DROP NOT NULL;

ALTER TABLE public.combo_statistics
  DROP CONSTRAINT IF EXISTS combo_statistics_combination_id_material_sheet_id_key;
DROP INDEX IF EXISTS combo_statistics_combination_id_material_sheet_id_key;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.combo_statistics'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.combo_statistics DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_statistics_sheet
  ON public.combo_statistics (combination_id, material_sheet_id)
  NULLS NOT DISTINCT
  WHERE kind = 'sheet';

CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_statistics_pdf
  ON public.combo_statistics (pdf_item_id)
  WHERE kind = 'pdf';

CREATE UNIQUE INDEX IF NOT EXISTS uq_combo_statistics_book
  ON public.combo_statistics (book_combo_id)
  WHERE kind = 'book';

CREATE INDEX IF NOT EXISTS idx_combo_statistics_kind
  ON public.combo_statistics (kind);
CREATE INDEX IF NOT EXISTS idx_combo_statistics_pdf_item
  ON public.combo_statistics (pdf_item_id);
CREATE INDEX IF NOT EXISTS idx_combo_statistics_book_combo
  ON public.combo_statistics (book_combo_id);

ALTER TABLE public.combo_statistics
  DROP CONSTRAINT IF EXISTS combo_statistics_kind_keys_check;

ALTER TABLE public.combo_statistics
  ADD CONSTRAINT combo_statistics_kind_keys_check CHECK (
    (kind = 'sheet' AND combination_id IS NOT NULL AND pdf_item_id IS NULL AND book_combo_id IS NULL)
    OR (kind = 'pdf' AND pdf_item_id IS NOT NULL AND combination_id IS NULL AND book_combo_id IS NULL)
    OR (kind = 'book' AND book_combo_id IS NOT NULL AND combination_id IS NULL AND pdf_item_id IS NULL)
  );

COMMENT ON TABLE public.combo_statistics IS
  '套餐 statistics 維護型表。三種套餐同等地位。kind=sheet／pdf／book。教材區 Excel 畫卡只認 sheet；PDF／目錄仍由獨立模組畫卡。寫入由各來源表 trigger 同步。';
COMMENT ON COLUMN public.combo_statistics.kind IS
  'sheet＝Excel/JSON；pdf＝PDF 套餐；book＝目錄套餐。';

CREATE OR REPLACE FUNCTION public.refresh_combo_statistics(p_combination_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_combination_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.combo_statistics
  WHERE combination_id = p_combination_id
    AND kind = 'sheet';

  INSERT INTO public.combo_statistics (
    teacher_id,
    combination_id,
    kind,
    pdf_item_id,
    book_combo_id,
    combo_label,
    material_folder_id,
    folder_name,
    root_kind,
    folder_class_id,
    material_sheet_id,
    sheet_stem,
    meta_file_name,
    script_file_name,
    source_file_name,
    is_group,
    available_count,
    extraction_template_id,
    extraction_template_name,
    exam_template_ids,
    class_ids,
    class_assignments,
    source_labels,
    student_pdf_file_id,
    student_pdf_file_name,
    student_pdf_page_map,
    updated_at
  )
  SELECT
    f.teacher_id,
    c.id,
    'sheet',
    NULL,
    NULL,
    COALESCE(NULLIF(BTRIM(c.label), ''), ''),
    c.material_folder_id,
    COALESCE(f.folder_name, ''),
    CASE WHEN f.root_kind = 'class' THEN 'class' ELSE 'teacher' END,
    f.class_id,
    s.id,
    COALESCE(s.sheet_stem, ''),
    COALESCE(s.meta_file_name, ''),
    COALESCE(s.script_file_name, ''),
    COALESCE(s.source_file_name, ''),
    COALESCE(s.is_group, false),
    s.available_count,
    c.extraction_template_id,
    COALESCE(t.name, ''),
    COALESCE((
      SELECT jsonb_agg(e.exam_template_id ORDER BY e.exam_template_id)
      FROM public.material_combination_exam_templates e
      WHERE e.material_combination_id = c.id
    ), '[]'::jsonb),
    COALESCE((
      SELECT array_agg(cmc.class_id ORDER BY cmc.class_id)
      FROM public.class_material_combinations cmc
      WHERE cmc.material_combination_id = c.id
    ), '{}'::uuid[]),
    COALESCE((
      SELECT jsonb_object_agg(cmc.class_id::text, cmc.id::text)
      FROM public.class_material_combinations cmc
      WHERE cmc.material_combination_id = c.id
    ), '{}'::jsonb),
    COALESCE(c.source_labels, '{}'::jsonb),
    COALESCE(c.student_pdf_file_id, ''),
    COALESCE(c.student_pdf_file_name, ''),
    COALESCE(c.student_pdf_page_map, '[]'::jsonb),
    now()
  FROM public.material_combinations c
  JOIN public.material_folders f ON f.id = c.material_folder_id
  LEFT JOIN public.material_templates t ON t.id = c.extraction_template_id
  LEFT JOIN public.material_combination_sheets cs ON cs.combination_id = c.id
  LEFT JOIN public.material_sheets s ON s.id = cs.material_sheet_id
  WHERE c.id = p_combination_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_combo_statistics(uuid) IS
  '重算這一份 Excel/JSON 套餐的 statistics（kind=sheet）。只給 trigger／回填用，前端不准寫 combo_statistics。';

CREATE OR REPLACE FUNCTION public.refresh_pdf_combo_statistics(p_pdf_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_pdf_item_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.combo_statistics
  WHERE pdf_item_id = p_pdf_item_id
    AND kind = 'pdf';

  INSERT INTO public.combo_statistics (
    teacher_id,
    combination_id,
    kind,
    pdf_item_id,
    book_combo_id,
    combo_label,
    material_folder_id,
    folder_name,
    root_kind,
    folder_class_id,
    material_sheet_id,
    sheet_stem,
    meta_file_name,
    script_file_name,
    source_file_name,
    is_group,
    available_count,
    extraction_template_id,
    extraction_template_name,
    exam_template_ids,
    class_ids,
    class_assignments,
    source_labels,
    student_pdf_file_id,
    student_pdf_file_name,
    student_pdf_page_map,
    updated_at
  )
  SELECT
    p.teacher_id,
    NULL,
    'pdf',
    p.id,
    NULL,
    COALESCE(NULLIF(BTRIM(p.label), ''), COALESCE(p.pdf_file_name, '')),
    p.material_folder_id,
    COALESCE(p.folder_name, ''),
    CASE WHEN f.root_kind = 'class' THEN 'class' ELSE 'teacher' END,
    f.class_id,
    NULL,
    '',
    '',
    '',
    COALESCE(p.pdf_file_name, ''),
    COALESCE(p.is_group, false),
    NULL,
    NULL,
    '',
    jsonb_build_array(p.exam_template_key),
    COALESCE((
      SELECT array_agg(c.class_id ORDER BY c.class_id)
      FROM public.class_material_pdf_exam_items c
      WHERE c.pdf_exam_item_id = p.id
    ), '{}'::uuid[]),
    COALESCE((
      SELECT jsonb_object_agg(c.class_id::text, c.id::text)
      FROM public.class_material_pdf_exam_items c
      WHERE c.pdf_exam_item_id = p.id
    ), '{}'::jsonb),
    '{}'::jsonb,
    '',
    '',
    '[]'::jsonb,
    now()
  FROM public.material_pdf_exam_items p
  LEFT JOIN public.material_folders f ON f.id = p.material_folder_id
  WHERE p.id = p_pdf_item_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_pdf_combo_statistics(uuid) IS
  '重算這一份 PDF 套餐的 statistics（kind=pdf）。只給 trigger／回填用。';

CREATE OR REPLACE FUNCTION public.refresh_book_combo_statistics(p_book_combo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_book_combo_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.combo_statistics
  WHERE book_combo_id = p_book_combo_id
    AND kind = 'book';

  INSERT INTO public.combo_statistics (
    teacher_id,
    combination_id,
    kind,
    pdf_item_id,
    book_combo_id,
    combo_label,
    material_folder_id,
    folder_name,
    root_kind,
    folder_class_id,
    material_sheet_id,
    sheet_stem,
    meta_file_name,
    script_file_name,
    source_file_name,
    is_group,
    available_count,
    extraction_template_id,
    extraction_template_name,
    exam_template_ids,
    class_ids,
    class_assignments,
    source_labels,
    student_pdf_file_id,
    student_pdf_file_name,
    student_pdf_page_map,
    updated_at
  )
  SELECT
    b.teacher_id,
    NULL,
    'book',
    NULL,
    b.id,
    COALESCE(NULLIF(BTRIM(b.label), ''), COALESCE(b.folder_name, '')),
    b.material_folder_id,
    COALESCE(b.folder_name, ''),
    CASE WHEN f.root_kind = 'class' THEN 'class' ELSE 'teacher' END,
    f.class_id,
    NULL,
    '',
    '',
    '',
    '',
    false,
    NULL,
    NULL,
    '',
    '[]'::jsonb,
    COALESCE((
      SELECT array_agg(c.class_id ORDER BY c.class_id)
      FROM public.class_material_book_combos c
      WHERE c.book_combo_id = b.id
    ), '{}'::uuid[]),
    COALESCE((
      SELECT jsonb_object_agg(c.class_id::text, c.id::text)
      FROM public.class_material_book_combos c
      WHERE c.book_combo_id = b.id
    ), '{}'::jsonb),
    '{}'::jsonb,
    '',
    '',
    '[]'::jsonb,
    now()
  FROM public.material_book_combos b
  LEFT JOIN public.material_folders f ON f.id = b.material_folder_id
  WHERE b.id = p_book_combo_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_book_combo_statistics(uuid) IS
  '重算這一份目錄套餐的 statistics（kind=book）。只給 trigger／回填用。';

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_pdf_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_pdf_combo_statistics(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_pdf_combo_statistics(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_pdf_class()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_pdf_combo_statistics(OLD.pdf_exam_item_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_pdf_combo_statistics(NEW.pdf_exam_item_id);
  IF TG_OP = 'UPDATE' AND OLD.pdf_exam_item_id IS DISTINCT FROM NEW.pdf_exam_item_id THEN
    PERFORM public.refresh_pdf_combo_statistics(OLD.pdf_exam_item_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_book_combo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_book_combo_statistics(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_book_combo_statistics(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_book_class()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_book_combo_statistics(OLD.book_combo_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_book_combo_statistics(NEW.book_combo_id);
  IF TG_OP = 'UPDATE' AND OLD.book_combo_id IS DISTINCT FROM NEW.book_combo_id THEN
    PERFORM public.refresh_book_combo_statistics(OLD.book_combo_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_combo_statistics_pdf_items ON public.material_pdf_exam_items;
CREATE TRIGGER trg_combo_statistics_pdf_items
  AFTER INSERT OR UPDATE ON public.material_pdf_exam_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_pdf_item();

DROP TRIGGER IF EXISTS trg_combo_statistics_pdf_items_del ON public.material_pdf_exam_items;
CREATE TRIGGER trg_combo_statistics_pdf_items_del
  AFTER DELETE ON public.material_pdf_exam_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_pdf_item();

DROP TRIGGER IF EXISTS trg_combo_statistics_pdf_class ON public.class_material_pdf_exam_items;
CREATE TRIGGER trg_combo_statistics_pdf_class
  AFTER INSERT OR UPDATE OR DELETE ON public.class_material_pdf_exam_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_pdf_class();

DROP TRIGGER IF EXISTS trg_combo_statistics_book_combos ON public.material_book_combos;
CREATE TRIGGER trg_combo_statistics_book_combos
  AFTER INSERT OR UPDATE ON public.material_book_combos
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_book_combo();

DROP TRIGGER IF EXISTS trg_combo_statistics_book_combos_del ON public.material_book_combos;
CREATE TRIGGER trg_combo_statistics_book_combos_del
  AFTER DELETE ON public.material_book_combos
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_book_combo();

DROP TRIGGER IF EXISTS trg_combo_statistics_book_class ON public.class_material_book_combos;
CREATE TRIGGER trg_combo_statistics_book_class
  AFTER INSERT OR UPDATE OR DELETE ON public.class_material_book_combos
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_book_class();

GRANT EXECUTE ON FUNCTION public.refresh_pdf_combo_statistics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_book_combo_statistics(uuid) TO authenticated;

DROP VIEW IF EXISTS public.class_combo_statistics;
CREATE OR REPLACE VIEW public.class_combo_statistics
WITH (security_invoker = true)
AS
SELECT
  cid AS class_id,
  s.kind,
  s.combination_id,
  s.pdf_item_id,
  s.book_combo_id,
  s.combo_label,
  s.material_folder_id,
  s.folder_name,
  s.root_kind,
  s.material_sheet_id,
  s.sheet_stem,
  s.meta_file_name,
  s.source_file_name,
  s.is_group,
  s.available_count,
  s.extraction_template_id,
  s.extraction_template_name,
  s.student_pdf_file_id,
  s.student_pdf_file_name,
  s.student_pdf_page_map,
  s.exam_template_ids
FROM public.combo_statistics s
CROSS JOIN LATERAL unnest(s.class_ids) AS cid;

COMMENT ON VIEW public.class_combo_statistics IS
  '出作業範圍：combo_statistics 裡已指派給這個班的列。三種套餐都在。一列＝一班＋一份套餐。';

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
  FROM (
    SELECT
      cid AS class_id,
      s.kind,
      s.combination_id,
      s.pdf_item_id,
      s.book_combo_id,
      s.combo_label,
      s.material_folder_id,
      s.folder_name,
      s.root_kind,
      s.material_sheet_id,
      s.sheet_stem,
      s.meta_file_name,
      s.source_file_name,
      s.is_group,
      s.available_count,
      s.extraction_template_id,
      s.extraction_template_name,
      s.student_pdf_file_id,
      s.student_pdf_file_name,
      s.student_pdf_page_map,
      s.exam_template_ids
    FROM public.combo_statistics s
    CROSS JOIN LATERAL unnest(s.class_ids) AS cid
    WHERE cid = p_class_id
  ) v;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.fetch_class_combo_stats(uuid) IS
  '這個班出作業範圍 statistics。三種套餐都在。只讀 combo_statistics。';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.material_pdf_exam_items
  LOOP
    PERFORM public.refresh_pdf_combo_statistics(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.material_book_combos
  LOOP
    PERFORM public.refresh_book_combo_statistics(r.id);
  END LOOP;
END;
$$;

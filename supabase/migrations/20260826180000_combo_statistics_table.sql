-- 套餐 statistics 改成維護型表。
-- 讀：教材區／出作業只讀這張表。寫：來源表變動時 trigger 重算該份套餐。
-- 一列＝一份套餐＋這本活頁。沒連活頁＝該套餐一列、活頁欄空。
-- 不是 class_review_catalog。不是現場 join 來源表。
-- 來源欄若舊庫還沒套過先前 migration，這裡先補齊，trigger／回填才讀得到。

ALTER TABLE public.material_combinations
  ADD COLUMN IF NOT EXISTS source_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS student_pdf_file_id text,
  ADD COLUMN IF NOT EXISTS student_pdf_file_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS student_pdf_page_map jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.material_sheets
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_count integer,
  ADD COLUMN IF NOT EXISTS script_file_name text,
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS meta_file_name text;

DROP VIEW IF EXISTS public.class_combo_statistics;

CREATE TABLE IF NOT EXISTS public.combo_statistics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  combination_id uuid NOT NULL REFERENCES public.material_combinations(id) ON DELETE CASCADE,
  combo_label text NOT NULL DEFAULT '',
  material_folder_id uuid,
  folder_name text NOT NULL DEFAULT '',
  root_kind text NOT NULL DEFAULT 'teacher',
  folder_class_id uuid,
  material_sheet_id uuid REFERENCES public.material_sheets(id) ON DELETE CASCADE,
  sheet_stem text NOT NULL DEFAULT '',
  meta_file_name text NOT NULL DEFAULT '',
  script_file_name text NOT NULL DEFAULT '',
  source_file_name text NOT NULL DEFAULT '',
  is_group boolean NOT NULL DEFAULT false,
  available_count integer,
  extraction_template_id uuid,
  extraction_template_name text NOT NULL DEFAULT '',
  exam_template_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  class_ids uuid[] NOT NULL DEFAULT '{}',
  class_assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  student_pdf_file_id text NOT NULL DEFAULT '',
  student_pdf_file_name text NOT NULL DEFAULT '',
  student_pdf_page_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (combination_id, material_sheet_id)
);

CREATE INDEX IF NOT EXISTS idx_combo_statistics_teacher
  ON public.combo_statistics (teacher_id);
CREATE INDEX IF NOT EXISTS idx_combo_statistics_combination
  ON public.combo_statistics (combination_id);
CREATE INDEX IF NOT EXISTS idx_combo_statistics_class_ids
  ON public.combo_statistics USING GIN (class_ids);

COMMENT ON TABLE public.combo_statistics IS
  '套餐 statistics 維護型表。一列＝一份套餐＋這本活頁。教材區／出作業只讀這裡。寫入由來源表 trigger 同步。';

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
  WHERE combination_id = p_combination_id;

  INSERT INTO public.combo_statistics (
    teacher_id,
    combination_id,
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
  '重算這一份套餐的 statistics。只給 trigger／回填用，前端不准寫 combo_statistics。';

CREATE OR REPLACE FUNCTION public.refresh_combo_statistics_for_sheet(p_sheet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF p_sheet_id IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT DISTINCT combination_id
    FROM public.material_combination_sheets
    WHERE material_sheet_id = p_sheet_id
  LOOP
    PERFORM public.refresh_combo_statistics(r.combination_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_combination()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_combo_statistics(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_combo_statistics(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_combination_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_combo_statistics(OLD.combination_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_combo_statistics(NEW.combination_id);
  IF TG_OP = 'UPDATE' AND OLD.combination_id IS DISTINCT FROM NEW.combination_id THEN
    PERFORM public.refresh_combo_statistics(OLD.combination_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_exam_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_combo_statistics(OLD.material_combination_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_combo_statistics(NEW.material_combination_id);
  IF TG_OP = 'UPDATE' AND OLD.material_combination_id IS DISTINCT FROM NEW.material_combination_id THEN
    PERFORM public.refresh_combo_statistics(OLD.material_combination_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_class_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_combo_statistics(OLD.material_combination_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_combo_statistics(NEW.material_combination_id);
  IF TG_OP = 'UPDATE' AND OLD.material_combination_id IS DISTINCT FROM NEW.material_combination_id THEN
    PERFORM public.refresh_combo_statistics(OLD.material_combination_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_combo_statistics_for_sheet(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_combo_statistics_for_sheet(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.material_combinations WHERE material_folder_id = NEW.id
  LOOP
    PERFORM public.refresh_combo_statistics(r.id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.material_combinations WHERE extraction_template_id = NEW.id
  LOOP
    PERFORM public.refresh_combo_statistics(r.id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_combo_statistics_combinations ON public.material_combinations;
CREATE TRIGGER trg_combo_statistics_combinations
  AFTER INSERT OR UPDATE OF label, extraction_template_id, material_folder_id, source_labels,
    student_pdf_file_id, student_pdf_file_name, student_pdf_page_map
  ON public.material_combinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_combination();

DROP TRIGGER IF EXISTS trg_combo_statistics_combinations_del ON public.material_combinations;
CREATE TRIGGER trg_combo_statistics_combinations_del
  AFTER DELETE ON public.material_combinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_combination();

DROP TRIGGER IF EXISTS trg_combo_statistics_combination_sheets ON public.material_combination_sheets;
CREATE TRIGGER trg_combo_statistics_combination_sheets
  AFTER INSERT OR UPDATE OR DELETE ON public.material_combination_sheets
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_combination_sheet();

DROP TRIGGER IF EXISTS trg_combo_statistics_exam_links ON public.material_combination_exam_templates;
CREATE TRIGGER trg_combo_statistics_exam_links
  AFTER INSERT OR UPDATE OR DELETE ON public.material_combination_exam_templates
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_exam_link();

DROP TRIGGER IF EXISTS trg_combo_statistics_class_links ON public.class_material_combinations;
CREATE TRIGGER trg_combo_statistics_class_links
  AFTER INSERT OR UPDATE OR DELETE ON public.class_material_combinations
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_class_link();

DROP TRIGGER IF EXISTS trg_combo_statistics_sheets ON public.material_sheets;
CREATE TRIGGER trg_combo_statistics_sheets
  AFTER INSERT OR UPDATE OF sheet_stem, meta_file_name, script_file_name, source_file_name,
    is_group, available_count, extraction_template_id
  ON public.material_sheets
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_sheet();

DROP TRIGGER IF EXISTS trg_combo_statistics_sheets_del ON public.material_sheets;
CREATE TRIGGER trg_combo_statistics_sheets_del
  AFTER DELETE ON public.material_sheets
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_sheet();

DROP TRIGGER IF EXISTS trg_combo_statistics_folders ON public.material_folders;
CREATE TRIGGER trg_combo_statistics_folders
  AFTER UPDATE OF folder_name, root_kind, class_id, teacher_id
  ON public.material_folders
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_folder();

DROP TRIGGER IF EXISTS trg_combo_statistics_templates ON public.material_templates;
CREATE TRIGGER trg_combo_statistics_templates
  AFTER UPDATE OF name
  ON public.material_templates
  FOR EACH ROW EXECUTE FUNCTION public.trg_combo_statistics_from_template();

-- 回填現有套餐
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.material_combinations
  LOOP
    PERFORM public.refresh_combo_statistics(r.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW public.class_combo_statistics
WITH (security_invoker = true)
AS
SELECT
  cid AS class_id,
  s.combination_id,
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
  '出作業範圍：combo_statistics 裡已指派給這個班的列。一列＝一班＋一份套餐＋這本活頁。不是現場 join 來源表。';

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
      s.combination_id,
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
  '這個班出作業範圍 statistics。只讀 combo_statistics，不是現場 join，不是複習目錄。';

GRANT EXECUTE ON FUNCTION public.fetch_class_combo_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fetch_teacher_combo_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(s) ORDER BY s.folder_name, s.combo_label, s.sheet_stem),
    '[]'::jsonb
  )
  INTO v_out
  FROM public.combo_statistics s
  WHERE s.teacher_id = v_uid;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.fetch_teacher_combo_stats() IS
  '這位老師教材區全部套餐 statistics。只讀 combo_statistics。含尚未指派的套餐。';

GRANT EXECUTE ON FUNCTION public.fetch_teacher_combo_stats() TO authenticated;

ALTER TABLE public.combo_statistics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_combo_statistics" ON public.combo_statistics;
DROP POLICY IF EXISTS "teacher_select_own_combo_statistics" ON public.combo_statistics;
DROP POLICY IF EXISTS "staff_select_assigned_combo_statistics" ON public.combo_statistics;

CREATE POLICY "admin_all_combo_statistics"
  ON public.combo_statistics FOR SELECT
  USING (public.is_admin());

CREATE POLICY "teacher_select_own_combo_statistics"
  ON public.combo_statistics FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "staff_select_assigned_combo_statistics"
  ON public.combo_statistics FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM unnest(class_ids) AS cid
      WHERE public.is_class_staff(cid)
    )
  );

GRANT SELECT ON public.combo_statistics TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.combo_statistics FROM authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.refresh_combo_statistics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_combo_statistics_for_sheet(uuid) TO authenticated;

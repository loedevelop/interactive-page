-- 課本套餐：跟 Excel／JSON／PDF 同階層，在教材資料夾裡有卡。
-- 資料由老師出作業一點一點提供，系統收集成書。不碰 material_combinations／combo_statistics。

CREATE TABLE IF NOT EXISTS public.material_book_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_folder_id uuid REFERENCES public.material_folders(id) ON DELETE SET NULL,
  folder_name text NOT NULL DEFAULT '',
  drive_folder_id text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_book_combos_teacher
  ON public.material_book_combos (teacher_id);
CREATE INDEX IF NOT EXISTS idx_material_book_combos_folder
  ON public.material_book_combos (teacher_id, folder_name);

COMMENT ON TABLE public.material_book_combos IS
  '教材區課本套餐卡。夾裡可有 text／PDF；這張卡的範圍目錄由出作業收集，不是從檔自動產生。';

CREATE TABLE IF NOT EXISTS public.class_material_book_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  book_combo_id uuid NOT NULL REFERENCES public.material_book_combos(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, book_combo_id)
);

CREATE INDEX IF NOT EXISTS idx_class_material_book_combos_class
  ON public.class_material_book_combos (class_id);

COMMENT ON TABLE public.class_material_book_combos IS
  '課本套餐勾給哪些班。出作業下拉只列這個班有勾的。';

CREATE TABLE IF NOT EXISTS public.material_book_range_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_combo_id uuid NOT NULL REFERENCES public.material_book_combos(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  major text NOT NULL DEFAULT '',
  secondary text NOT NULL DEFAULT '',
  minor text NOT NULL DEFAULT '',
  script text NOT NULL DEFAULT '',
  source_assignment_id uuid REFERENCES public.assignments(id) ON DELETE SET NULL,
  source_task_id text NOT NULL DEFAULT '',
  progress_date date,
  drive_file_id text NOT NULL DEFAULT '',
  drive_file_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_book_range_items_combo
  ON public.material_book_range_items (book_combo_id, major, secondary, minor);

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_book_range_items_source
  ON public.material_book_range_items (book_combo_id, source_assignment_id, source_task_id)
  WHERE source_assignment_id IS NOT NULL AND BTRIM(source_task_id) <> '';

COMMENT ON TABLE public.material_book_range_items IS
  '課本套餐已收集的範圍。大題／次題／小題都可空（這次填到哪由老師定）。有文稿才寫進教材資料夾 txt。';

ALTER TABLE public.material_book_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_material_book_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_book_range_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_book_combos" ON public.material_book_combos;
DROP POLICY IF EXISTS "own_material_book_combos" ON public.material_book_combos;
CREATE POLICY "admin_all_material_book_combos"
  ON public.material_book_combos FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "own_material_book_combos"
  ON public.material_book_combos FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "admin_all_class_material_book_combos" ON public.class_material_book_combos;
DROP POLICY IF EXISTS "staff_class_material_book_combos" ON public.class_material_book_combos;
CREATE POLICY "admin_all_class_material_book_combos"
  ON public.class_material_book_combos FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_class_material_book_combos"
  ON public.class_material_book_combos FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

DROP POLICY IF EXISTS "admin_all_material_book_range_items" ON public.material_book_range_items;
DROP POLICY IF EXISTS "own_material_book_range_items" ON public.material_book_range_items;
CREATE POLICY "admin_all_material_book_range_items"
  ON public.material_book_range_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "own_material_book_range_items"
  ON public.material_book_range_items FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_book_combos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_material_book_combos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_book_range_items TO authenticated;
GRANT ALL ON public.material_book_combos TO service_role;
GRANT ALL ON public.class_material_book_combos TO service_role;
GRANT ALL ON public.material_book_range_items TO service_role;

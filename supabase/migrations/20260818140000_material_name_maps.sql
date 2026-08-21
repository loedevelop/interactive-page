-- 教材檔名 mapping：實體主鍵仍是 material_sheets.id／material_folders.id。
-- 改名只改現用欄位，舊名寫進這張表，查找時舊名仍對回同一筆。

CREATE TABLE IF NOT EXISTS public.material_name_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  material_folder_id uuid REFERENCES public.material_folders(id) ON DELETE CASCADE,
  material_sheet_id uuid REFERENCES public.material_sheets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('folder', 'source_file', 'sheet_stem', 'meta_file', 'script_file')),
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_name_maps_sheet_kind_chk CHECK (
    (kind IN ('sheet_stem', 'meta_file', 'script_file') AND material_sheet_id IS NOT NULL AND material_folder_id IS NOT NULL)
    OR (kind IN ('folder', 'source_file') AND material_folder_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_name_maps_folder_kind_alias
  ON public.material_name_maps (material_folder_id, kind, upper(alias));

CREATE INDEX IF NOT EXISTS idx_material_name_maps_sheet
  ON public.material_name_maps (material_sheet_id);

CREATE INDEX IF NOT EXISTS idx_material_name_maps_teacher
  ON public.material_name_maps (teacher_id);

COMMENT ON TABLE public.material_name_maps IS
  '教材改名別名。現用檔名在 material_sheets／material_folders；這裡只存舊名與其他仍要能對回的別名。';

ALTER TABLE public.material_name_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_name_maps" ON public.material_name_maps;
DROP POLICY IF EXISTS "access_own_material_name_maps" ON public.material_name_maps;
CREATE POLICY "admin_all_material_name_maps"
  ON public.material_name_maps FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "access_own_material_name_maps"
  ON public.material_name_maps FOR ALL
  USING (public.can_access_material_folder(material_folder_id))
  WITH CHECK (public.can_access_material_folder(material_folder_id));

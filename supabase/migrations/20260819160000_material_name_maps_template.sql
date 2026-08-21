-- 對照中心擴充：範本改名也走 material_name_maps。
-- 既有 20260818140000 只涵蓋資料夾／活頁／檔名；範本列沒有 folder_id，
-- 舊 CHECK 與「只認 can_access_material_folder」的 RLS 會擋掉。
-- 不改寫已套用的 18140000，只在這支補欄、放寬約束、加獨立唯一索引。

ALTER TABLE public.material_name_maps
  ADD COLUMN IF NOT EXISTS material_template_id uuid REFERENCES public.material_templates(id) ON DELETE CASCADE;

ALTER TABLE public.material_name_maps
  ADD COLUMN IF NOT EXISTS current_label text;

ALTER TABLE public.material_name_maps
  DROP CONSTRAINT IF EXISTS material_name_maps_kind_check;

ALTER TABLE public.material_name_maps
  DROP CONSTRAINT IF EXISTS material_name_maps_sheet_kind_chk;

ALTER TABLE public.material_name_maps
  ADD CONSTRAINT material_name_maps_kind_check
  CHECK (kind IN ('folder', 'source_file', 'sheet_stem', 'meta_file', 'script_file', 'template'));

ALTER TABLE public.material_name_maps
  ADD CONSTRAINT material_name_maps_target_chk CHECK (
    (kind = 'template' AND material_template_id IS NOT NULL)
    OR (kind IN ('sheet_stem', 'meta_file', 'script_file')
        AND material_sheet_id IS NOT NULL
        AND material_folder_id IS NOT NULL)
    OR (kind IN ('folder', 'source_file') AND material_folder_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_name_maps_template_kind_alias
  ON public.material_name_maps (teacher_id, kind, upper(alias))
  WHERE kind = 'template';

CREATE INDEX IF NOT EXISTS idx_material_name_maps_template
  ON public.material_name_maps (material_template_id)
  WHERE material_template_id IS NOT NULL;

DROP POLICY IF EXISTS "access_own_material_name_maps" ON public.material_name_maps;
CREATE POLICY "access_own_material_name_maps"
  ON public.material_name_maps FOR ALL
  USING (
    teacher_id = auth.uid()
    OR (material_folder_id IS NOT NULL AND public.can_access_material_folder(material_folder_id))
  )
  WITH CHECK (
    teacher_id = auth.uid()
    OR (material_folder_id IS NOT NULL AND public.can_access_material_folder(material_folder_id))
  );

COMMENT ON COLUMN public.material_name_maps.current_label IS
  '這個別名目前對到的現用名稱。改名時一併更新同一 UUID 的其他舊別名。';
COMMENT ON COLUMN public.material_name_maps.material_template_id IS
  'kind=template 時必填；對回 material_templates.id。';

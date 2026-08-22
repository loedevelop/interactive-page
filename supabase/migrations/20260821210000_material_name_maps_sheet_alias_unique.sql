-- 活頁別稱跟活頁列走：同一資料夾、同一個活頁名、不同擷取範本＝兩列，
-- 各有自己的別名。舊唯一鍵 (folder, kind, alias) 會讓兩張卡搶同一筆。

DROP INDEX IF EXISTS public.uq_material_name_maps_folder_kind_alias;

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_name_maps_folder_kind_alias
  ON public.material_name_maps (material_folder_id, kind, upper(alias))
  WHERE kind IN ('folder', 'source_file');

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_name_maps_sheet_kind_alias
  ON public.material_name_maps (material_sheet_id, kind, upper(alias))
  WHERE kind IN ('sheet_stem', 'meta_file', 'script_file');

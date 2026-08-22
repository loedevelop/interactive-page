-- 活頁名可在同一資料夾重複。
-- 唯一鍵＝資料夾＋活頁名＋擷取範本。舊索引只認資料夾＋活頁名，圖／字兩張卡無法同名。

DROP INDEX IF EXISTS public.uq_material_sheets_folder_stem;

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_sheets_folder_stem_template
  ON public.material_sheets (material_folder_id, upper(sheet_stem), extraction_template_id)
  WHERE extraction_template_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_material_sheets_folder_stem_untemplated
  ON public.material_sheets (material_folder_id, upper(sheet_stem))
  WHERE extraction_template_id IS NULL;

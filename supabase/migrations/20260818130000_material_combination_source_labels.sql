-- 教材區一列＝來源檔（同一資料夾可有多本教材的 meta）。
-- 班級組合仍是資料夾＋擷取範本；各來源檔的顯示名稱記在 source_labels，不佔用 label。

ALTER TABLE public.material_combinations
  ADD COLUMN IF NOT EXISTS source_labels jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.material_combinations.source_labels IS
  '教材區：來源檔名 → 老師自訂顯示名稱。鍵為 material_sheets.source_file_name。';

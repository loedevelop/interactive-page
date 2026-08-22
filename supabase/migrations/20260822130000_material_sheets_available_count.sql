-- 活頁基本資料：這本 meta 整本列數。產生上傳成功時寫入。
-- 出作業用總題數＋每頁行數算範圍內可用題，不靠當下再讀 Drive。

ALTER TABLE public.material_sheets
  ADD COLUMN IF NOT EXISTS available_count integer;

COMMENT ON COLUMN public.material_sheets.available_count IS
  '這本 meta 整本列數（產生上傳時寫入）。沒再上傳過的舊列可為空。';

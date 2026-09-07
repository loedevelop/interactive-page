-- 目錄範圍列自己的頁碼。沒填＝沒有。不准拿大題／標題去猜。

ALTER TABLE public.material_book_range_items
  ADD COLUMN IF NOT EXISTS page text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.material_book_range_items.page IS
  '這一列自己的頁碼。沒填＝沒有。不准借大題／標題／口說答案。';

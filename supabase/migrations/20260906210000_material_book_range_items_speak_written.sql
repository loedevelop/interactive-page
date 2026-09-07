-- 目錄套餐卡要分開留下這一列的口說答案、書寫答案。
-- 不准借口說／書寫去填目錄文稿（script），也不准拿目錄文稿去填這兩欄。

ALTER TABLE public.material_book_range_items
  ADD COLUMN IF NOT EXISTS speak_script text NOT NULL DEFAULT '';

ALTER TABLE public.material_book_range_items
  ADD COLUMN IF NOT EXISTS written_script text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.material_book_range_items.speak_script IS
  '這一列自己的口說答案。來自該範圍列對應的 paste_windows.script。沒填＝沒有。不准借目錄文稿／書寫答案。';

COMMENT ON COLUMN public.material_book_range_items.written_script IS
  '這一列自己的書寫答案。來自該範圍列對應的 paste_windows.student。沒填＝沒有。不准借口說答案／目錄文稿。';

COMMENT ON COLUMN public.material_book_range_items.script IS
  '這一列自己的目錄文稿（book_script）。有才寫進教材資料夾 txt。不准借口說／書寫答案。';

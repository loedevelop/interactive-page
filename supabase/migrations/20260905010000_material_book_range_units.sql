-- 目錄範圍：主單元／次單元在大題前面。舊列這兩欄空白，既有大題／次題／小題不動。

ALTER TABLE public.material_book_range_items
  ADD COLUMN IF NOT EXISTS primary_unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS secondary_unit text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_material_book_range_items_combo;
CREATE INDEX IF NOT EXISTS idx_material_book_range_items_combo
  ON public.material_book_range_items (book_combo_id, primary_unit, secondary_unit, major, secondary, minor);

COMMENT ON TABLE public.material_book_range_items IS
  '課本套餐已收集的範圍。主單元／次單元／大題／次題／小題都可空（這次填到哪由老師定）。有文稿才寫進教材資料夾 txt。';

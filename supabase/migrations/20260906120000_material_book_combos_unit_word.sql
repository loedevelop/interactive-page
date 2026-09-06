-- 目錄套餐：這本主單元的單位（Unit／Ch／Lesson，或老師手打的字）。沒填＝仍顯示「主單元」。

ALTER TABLE public.material_book_combos
  ADD COLUMN IF NOT EXISTS primary_unit_word text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.material_book_combos.primary_unit_word IS
  '主單元單位。這本自己的字（Unit／Ch／Lesson 或手打）。沒填＝沒有，畫面上仍用「主單元」。不准借別本。';

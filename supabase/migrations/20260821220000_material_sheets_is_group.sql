-- 群組開關跟活頁列走：這本是否與同一次套用的其他活頁當成一組（出作業再選活頁）。
-- 沒勾＝各自獨立。舊列預設 false，老師重跑套用後才會是 true。

ALTER TABLE public.material_sheets
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.material_sheets.is_group IS
  'true＝這本與同一次套用的其他活頁當成一組；false＝各自獨立。';

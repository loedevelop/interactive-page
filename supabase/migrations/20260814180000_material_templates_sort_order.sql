-- 範本庫：老師要求範本可以手動上下調整順序（2026-08-14）。
--
-- 新增 sort_order（每位老師底下的排序，數字小排前面）。backfill 用目前的 created_at 順序
-- 當初始值（跟現有清單顯示順序一致，不會讓老師一開啟畫面就發現順序被打亂）。
--
-- 兩個角色勾選框（is_extraction_role／is_exam_role）篩選出來的「擷取範本清單」跟「試卷範本
-- 清單」共用同一個 sort_order——這是同一份範本庫的同一個順序，兩邊清單只是不同角色的篩選視角，
-- 不是各自獨立的順序。

ALTER TABLE public.material_templates ADD COLUMN IF NOT EXISTS sort_order integer;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY teacher_id ORDER BY created_at ASC) - 1 AS rn
  FROM public.material_templates
)
UPDATE public.material_templates mt
SET sort_order = ranked.rn
FROM ranked
WHERE mt.id = ranked.id AND mt.sort_order IS NULL;

ALTER TABLE public.material_templates ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE public.material_templates ALTER COLUMN sort_order SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_material_templates_teacher_sort
  ON public.material_templates (teacher_id, sort_order);

-- 收集文稿：班級教材區塊。文稿是複製進區塊，不回寫作業。
-- 來源鑰匙（assignment + task）同一班只准進一個區塊。

CREATE TABLE IF NOT EXISTS public.class_script_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_script_blocks_class
  ON public.class_script_blocks (class_id, sort_order);

CREATE TABLE IF NOT EXISTS public.class_script_block_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.class_script_blocks(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  progress_date date,
  source_assignment_id uuid REFERENCES public.assignments(id) ON DELETE SET NULL,
  source_task_id text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_class_script_block_items_block
  ON public.class_script_block_items (block_id, progress_date DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_script_block_items_source
  ON public.class_script_block_items (class_id, source_assignment_id, source_task_id)
  WHERE source_assignment_id IS NOT NULL AND BTRIM(source_task_id) <> '';

COMMENT ON TABLE public.class_script_blocks IS
  '收集文稿的教材區塊。跟班級走，跨進度日期。';
COMMENT ON TABLE public.class_script_block_items IS
  '搬入區塊的文稿複本。不改原始作業。同一來源鑰匙同一班只准一筆。';

ALTER TABLE public.class_script_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_script_block_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_class_script_blocks" ON public.class_script_blocks;
DROP POLICY IF EXISTS "staff_all_class_script_blocks" ON public.class_script_blocks;
CREATE POLICY "admin_all_class_script_blocks"
  ON public.class_script_blocks FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_all_class_script_blocks"
  ON public.class_script_blocks FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

DROP POLICY IF EXISTS "admin_all_class_script_block_items" ON public.class_script_block_items;
DROP POLICY IF EXISTS "staff_all_class_script_block_items" ON public.class_script_block_items;
CREATE POLICY "admin_all_class_script_block_items"
  ON public.class_script_block_items FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_all_class_script_block_items"
  ON public.class_script_block_items FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_script_blocks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_script_block_items TO authenticated;

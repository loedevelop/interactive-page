-- 💣 雷區（2026-09-11 老師：教材就是教材，跟班級有沒有封存不應該有關係）：
-- class_script_blocks／class_script_block_items 是「由下往上收集文稿」把舊作業文稿複製一份
-- 準備搬進全域教材的暫存表。舊版政策沿用 is_class_staff()，該函式要求 class_staff.deleted_at
-- IS NULL，班級一封存，老師對這兩張表就完全沒有寫入權限——但這兩張表的用途正是「把已經封存
-- 班級的舊內容整理搬出來」，被同一條規則卡住等於這個工具的核心用途整個失效。
--
-- 修法：沿用專案既有、已經在用的「曾任教＝可管理封存班」判斷（can_manage_archived_class /
-- is_primary_teacher_of_class，見 20260726120000_archived_classes_rpc.sql），不是另外發明。
-- 只加寬這兩張表的政策；其餘所有用 is_class_staff() 的地方（作業本身、成績等）完全不動，
-- 封存班級仍然不能被一般編輯動到。

DROP POLICY IF EXISTS "staff_all_class_script_blocks" ON public.class_script_blocks;
CREATE POLICY "staff_all_class_script_blocks"
  ON public.class_script_blocks FOR ALL
  USING (public.is_class_staff(class_id) OR public.can_manage_archived_class(class_id))
  WITH CHECK (public.is_class_staff(class_id) OR public.can_manage_archived_class(class_id));

DROP POLICY IF EXISTS "staff_all_class_script_block_items" ON public.class_script_block_items;
CREATE POLICY "staff_all_class_script_block_items"
  ON public.class_script_block_items FOR ALL
  USING (public.is_class_staff(class_id) OR public.can_manage_archived_class(class_id))
  WITH CHECK (public.is_class_staff(class_id) OR public.can_manage_archived_class(class_id));

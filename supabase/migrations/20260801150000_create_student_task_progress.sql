-- 修復死寫入路徑：ApiService.syncProgress（教師「課程進度」手動打勾）一直寫入不存在的
-- public.student_task_progress，PostgREST 回 42P01 被前端 catch 吞掉，UI 從不告知失敗，
-- 老師以為手動打勾已存住，重新整理後其實全部消失。
--
-- 確認過程（2026-08-01，supabase db query --linked）：
--   to_regclass('public.student_task_progress') → null（不存在）
--   名稱相近的 public.student_progress 存在但 0 筆、且已於 20260726070000 標記 legacy/unused
--   兩者是不同的表，不可混用；本次補建的是「每個小項×每個學生」的手動完成旗標，
--   不是「每個作業一列」的 student_progress。
--
-- 設計對齊本專案側表慣例：assignment_id 為必填 FK（cascade），class_id 冗欄供 RLS／查詢，
-- task_id 沿用 task.id（text，不隨拖曳排序改變），與 task_completions 用同一組自然鍵語意。

CREATE TABLE IF NOT EXISTS public.student_task_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL,
  task_id text NOT NULL,
  student_id uuid NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, task_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_task_progress_assignment_task
  ON public.student_task_progress (assignment_id, task_id);
CREATE INDEX IF NOT EXISTS idx_student_task_progress_student
  ON public.student_task_progress (student_id);

ALTER TABLE public.student_task_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_student_task_progress" ON public.student_task_progress;
DROP POLICY IF EXISTS "staff_all_class_student_task_progress" ON public.student_task_progress;

-- 目前只有教師端「課程進度」格子會讀寫這張表；學生無對應 UI，暫不開放學生 RLS，
-- 之後若要讓學生也能看到／自行勾選，再補 is_enrolled_student 的 SELECT／UPDATE 政策。
CREATE POLICY "admin_all_student_task_progress"
  ON public.student_task_progress
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "staff_all_class_student_task_progress"
  ON public.student_task_progress
  FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

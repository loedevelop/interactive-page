-- 可接受答案跟教材題走（這位老師、這本活頁、這頁、這題號），不是只這份考卷。
-- 送分／不計分不在這張表；那兩項只寫 quiz_paper / parsed_bank 這份卷。

CREATE TABLE IF NOT EXISTS public.quiz_item_accepted_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_folder text NOT NULL DEFAULT '',
  sheet_id text NOT NULL DEFAULT '',
  page text NOT NULL DEFAULT '',
  item_no text NOT NULL DEFAULT '',
  answer_text text NOT NULL DEFAULT '',
  answer_norm text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quiz_item_accepted_answers
  DROP CONSTRAINT IF EXISTS uq_quiz_item_accepted_answers_key;
ALTER TABLE public.quiz_item_accepted_answers
  ADD CONSTRAINT uq_quiz_item_accepted_answers_key
  UNIQUE (teacher_id, material_folder, sheet_id, page, item_no, answer_norm);

CREATE INDEX IF NOT EXISTS idx_quiz_item_accepted_answers_item
  ON public.quiz_item_accepted_answers (material_folder, sheet_id, page, item_no);

COMMENT ON TABLE public.quiz_item_accepted_answers IS
  '可接受答案＝這題教材列自己的寫法。鑰匙＝老師＋資料夾＋活頁＋頁＋題號。不准只留在一份考卷快照。';

ALTER TABLE public.quiz_item_accepted_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_quiz_item_accepted_answers" ON public.quiz_item_accepted_answers;
DROP POLICY IF EXISTS "own_write_quiz_item_accepted_answers" ON public.quiz_item_accepted_answers;
DROP POLICY IF EXISTS "auth_read_quiz_item_accepted_answers" ON public.quiz_item_accepted_answers;

CREATE POLICY "admin_all_quiz_item_accepted_answers"
  ON public.quiz_item_accepted_answers FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "own_write_quiz_item_accepted_answers"
  ON public.quiz_item_accepted_answers FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "auth_read_quiz_item_accepted_answers"
  ON public.quiz_item_accepted_answers FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_item_accepted_answers TO authenticated;
GRANT ALL ON public.quiz_item_accepted_answers TO service_role;

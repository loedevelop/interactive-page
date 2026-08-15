-- 分離「擷取範本」與「考卷範本」第二步：新增 material_exam_templates（考卷範本），取代寫死
-- 在 110_teacher_core/feature-exam-job.js 的 LAYOUT_CATALOG 常數。
--
-- 背景：老師指出 LAYOUT_CATALOG 6 個選項寫死在程式碼裡是錯的——考卷怎麼呈現（fields／
-- fields_answer／quiz_prompt／quiz_answer 公式）應該是老師可以自己建立、編輯、刪除的資料，
-- 不該是程式碼常數。這張表就是「考卷範本」的正式歸屬。
--
-- backfill 策略：把 LAYOUT_CATALOG 6 個選項，對「每一位已經用過教材系統的老師」
-- （在 material_folders 或 material_extraction_templates 出現過）各造一份種子資料
-- （is_builtin_seed=true，legacy_profile_id 記舊字串 id），讓老師既有、已經存過
-- exam_job.layout_profile_id 的考卷歷史紀錄可以照舊解析到位；之後這些種子資料跟老師
-- 自建的考卷範本一樣可以自由編輯／刪除，不再是唯讀常數。
--
-- 其中 sentence-translate-4col／sentence-cloze-4col／gept-translate-5col 三個舊 id 原本就有
-- 實際公式（LAYOUT_FIELD_HINTS，出考卷時當 fallback 用），這裡原樣搬進 fields／fields_answer；
-- vocab-no-image／vocab-with-image／v2-extended 三個原本就是「🚧 占位」、從來沒有實際公式
-- （layoutFieldHint() 對這三個 id 只回傳提示字串「（依 layout_profile）」，不是合法公式），
-- 這裡照實留空，不假裝有公式，老師之後要用的話要自己填。

CREATE TABLE IF NOT EXISTS public.material_exam_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  legacy_profile_id text,
  name text NOT NULL,
  fields text NOT NULL DEFAULT '',
  fields_answer text NOT NULL DEFAULT '',
  quiz_prompt text NOT NULL DEFAULT '',
  quiz_answer text NOT NULL DEFAULT '',
  lines_per_page int NOT NULL DEFAULT 10,
  is_builtin_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_material_exam_templates_teacher
  ON public.material_exam_templates (teacher_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_exam_templates_legacy
  ON public.material_exam_templates (teacher_id, legacy_profile_id)
  WHERE legacy_profile_id IS NOT NULL;

ALTER TABLE public.material_exam_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_exam_templates" ON public.material_exam_templates;
DROP POLICY IF EXISTS "teacher_all_own_material_exam_templates" ON public.material_exam_templates;
CREATE POLICY "admin_all_material_exam_templates"
  ON public.material_exam_templates FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "teacher_all_own_material_exam_templates"
  ON public.material_exam_templates FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Backfill：LAYOUT_CATALOG 六個選項 → 每位已用過教材系統老師的種子考卷範本
-- ---------------------------------------------------------------------------
WITH teachers AS (
  SELECT DISTINCT teacher_id FROM public.material_folders
  UNION
  SELECT DISTINCT teacher_id FROM public.material_extraction_templates
),
catalog (legacy_profile_id, name, fields, fields_answer) AS (
  VALUES
    ('sentence-translate-4col', '整句翻譯（sentence-translate-4col）', 'STACK(D,E,C), FONTSIZE(Y,-1), X', 'X'),
    ('sentence-cloze-4col', '句子填空（sentence-cloze-4col）', 'STACK(D,E,C), FONTSIZE(Y,-1), X', 'X'),
    ('gept-translate-5col', 'GEPT 翻譯五欄（舊 id）', 'STACK(D,E,C), FONTSIZE(Y,-1), X', 'X'),
    ('vocab-no-image', '單字無圖（vocab-no-image）', '', ''),
    ('vocab-with-image', '單字帶圖（vocab-with-image，🚧 占位，尚無圖片渲染）', '', ''),
    ('v2-extended', '新版擴充（v2-extended，🚧 占位）', '', '')
)
INSERT INTO public.material_exam_templates (
  teacher_id, legacy_profile_id, name, fields, fields_answer, lines_per_page, is_builtin_seed
)
SELECT t.teacher_id, c.legacy_profile_id, c.name, c.fields, c.fields_answer, 10, true
FROM teachers t
CROSS JOIN catalog c
ON CONFLICT (teacher_id, legacy_profile_id) WHERE legacy_profile_id IS NOT NULL DO NOTHING;

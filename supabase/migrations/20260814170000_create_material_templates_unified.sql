-- 範本庫（material_templates）：把「擷取範本」（material_extraction_templates）與
-- 「考卷範本」（material_exam_templates）合併成一張表，用兩個角色勾選框
-- （is_extraction_role／is_exam_role）取代「兩張表、兩個編輯器」的切法。
--
-- 背景（老師 2026-08-14 提出）：現在的切法遇到「有的教材截取範本也能當考題範本」時，
-- 只能靠「從擷取範本開始」複製一份公式到另一張表，變成兩筆各自獨立、要手動保持同步的紀錄。
-- 改成同一筆範本、兩個角色勾選框：只勾「擷取範本」＝純擷取；只勾「試卷範本」＝純考卷；
-- 兩個都勾＝雙用（同一筆，不用維護兩份）。角色是老師自己勾的，不是系統自動判斷／自動雙用。
--
-- 遷移策略（保留原 id，不重新產生）：
--   1) material_extraction_templates 全部搬進來，is_extraction_role=true, is_exam_role=false
--   2) material_exam_templates 全部搬進來（含已軟刪除的 6 個內建範本，deleted_at 原樣保留，
--      不復活），is_exam_role=true, is_extraction_role=false
--   3) 目前被 'tpl:{legacy_id}' 引用過的擷取範本（exam_job.layout_profile_id 或
--      sections[].layout_profile_id 已經在用），自動也勾選 is_exam_role=true，並用跟前端
--      buildProfileFromTemplate() 完全相同的演算法（STACK 資訊欄＋題目欄；TEXTJOIN 答案欄）
--      算出 fields／fields_answer 當「一次性預填」——保留現在的雙用結果，之後老師可自行修改，
--      不會再因為改了欄位對應就自動連動改公式。
--
-- 舊表 material_extraction_templates／material_exam_templates 暫不刪除（先當備份保留），
-- 確認新表穩定後再另開 migration 下架。

CREATE TABLE IF NOT EXISTS public.material_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,

  -- 兩個角色勾選框：三種角色＝只勾一個（單用）／兩個都勾（雙用）；都不勾＝草稿、暫不出現在任何清單
  is_extraction_role boolean NOT NULL DEFAULT true,
  is_exam_role boolean NOT NULL DEFAULT false,

  -- 擷取角色欄位（is_extraction_role=true 才有意義；沿用 material_extraction_templates 形狀）
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  designed_from jsonb,
  answer_mode text,
  answer_combine_note text,
  speak_mode text,
  speak_formula text,
  legacy_id text,          -- 遷移前（JSON blob 時代）字串 id，如 mft_xxx；'tpl:' 相容層要用

  -- 試卷角色欄位（is_exam_role=true 才有意義；沿用 material_exam_templates 形狀）
  fields text NOT NULL DEFAULT '',
  fields_answer text NOT NULL DEFAULT '',
  quiz_prompt text NOT NULL DEFAULT '',
  quiz_answer text NOT NULL DEFAULT '',
  lines_per_page int NOT NULL DEFAULT 10,
  legacy_profile_id text,  -- 舊 LAYOUT_CATALOG 字串 id，供回溯比對
  is_builtin_seed boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_material_templates_teacher
  ON public.material_templates (teacher_id);
CREATE INDEX IF NOT EXISTS idx_material_templates_extraction_role
  ON public.material_templates (teacher_id) WHERE is_extraction_role AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_material_templates_exam_role
  ON public.material_templates (teacher_id) WHERE is_exam_role AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_templates_legacy_id
  ON public.material_templates (teacher_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_templates_legacy_profile_id
  ON public.material_templates (teacher_id, legacy_profile_id) WHERE legacy_profile_id IS NOT NULL;

ALTER TABLE public.material_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_templates" ON public.material_templates;
DROP POLICY IF EXISTS "teacher_all_own_material_templates" ON public.material_templates;
CREATE POLICY "admin_all_material_templates"
  ON public.material_templates FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "teacher_all_own_material_templates"
  ON public.material_templates FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 1) 搬 material_extraction_templates（保留 id）
-- ---------------------------------------------------------------------------
INSERT INTO public.material_templates (
  id, teacher_id, name, is_extraction_role, is_exam_role,
  columns, designed_from, answer_mode, answer_combine_note, speak_mode, speak_formula, legacy_id,
  created_at, updated_at, deleted_at
)
SELECT
  id, teacher_id, name, true, false,
  columns, designed_from, answer_mode, answer_combine_note, speak_mode, speak_formula, legacy_id,
  created_at, updated_at, deleted_at
FROM public.material_extraction_templates
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) 搬 material_exam_templates（保留 id，含已軟刪除的 6 個內建範本，deleted_at 原樣保留）
-- ---------------------------------------------------------------------------
INSERT INTO public.material_templates (
  id, teacher_id, name, is_extraction_role, is_exam_role,
  fields, fields_answer, quiz_prompt, quiz_answer, lines_per_page, legacy_profile_id, is_builtin_seed,
  created_at, updated_at, deleted_at
)
SELECT
  id, teacher_id, name, false, true,
  fields, fields_answer, quiz_prompt, quiz_answer, lines_per_page, legacy_profile_id, is_builtin_seed,
  created_at, updated_at, deleted_at
FROM public.material_exam_templates
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) 目前被 'tpl:{legacy_id}' 引用過的擷取範本：自動也勾選試卷角色＋一次性預填公式
--    （跟 110_teacher_core/feature-material-layout-pairing.js 的 buildProfileFromTemplate() 同演算法）
-- ---------------------------------------------------------------------------
WITH referenced_legacy_ids AS (
  SELECT DISTINCT substring(t->'raw_data'->'exam_job'->>'layout_profile_id' FROM 5) AS legacy_id
  FROM public.assignments a, jsonb_array_elements(a.tasks) t
  WHERE t->'raw_data'->'exam_job'->>'layout_profile_id' LIKE 'tpl:%'
  UNION
  SELECT DISTINCT substring(s->>'layout_profile_id' FROM 5) AS legacy_id
  FROM public.assignments a,
       jsonb_array_elements(a.tasks) t,
       jsonb_array_elements(t->'raw_data'->'exam_job'->'sections') s
  WHERE s->>'layout_profile_id' LIKE 'tpl:%'
),
cols AS (
  SELECT
    mt.id,
    mt.answer_mode,
    ord.idx,
    ord.elem
  FROM public.material_templates mt
  JOIN referenced_legacy_ids r ON r.legacy_id = mt.legacy_id
  CROSS JOIN LATERAL jsonb_array_elements(mt.columns) WITH ORDINALITY AS ord(elem, idx)
),
agg AS (
  SELECT
    id,
    answer_mode,
    array_agg(elem->>'semantic_key' ORDER BY idx) FILTER (
      WHERE (elem->>'is_info')::boolean AND coalesce(elem->>'semantic_key', '') <> ''
    ) AS info_keys,
    array_agg(elem->>'semantic_key' ORDER BY idx) FILTER (
      WHERE (elem->>'is_question')::boolean AND coalesce(elem->>'semantic_key', '') <> ''
    ) AS question_keys,
    array_agg(elem->>'semantic_key' ORDER BY idx) FILTER (
      WHERE (elem->>'is_answer')::boolean AND coalesce(elem->>'semantic_key', '') <> ''
    ) AS answer_keys
  FROM cols
  GROUP BY id, answer_mode
),
computed AS (
  SELECT
    id,
    trim(
      concat_ws(', ',
        CASE WHEN info_keys IS NOT NULL AND array_length(info_keys, 1) > 0
          THEN 'STACK(' || array_to_string(info_keys, ',') || ')' END,
        CASE WHEN question_keys IS NOT NULL AND array_length(question_keys, 1) > 0
          THEN array_to_string(question_keys, ', ') END
      )
    ) AS computed_fields,
    CASE WHEN answer_keys IS NOT NULL AND array_length(answer_keys, 1) > 0
      THEN 'TEXTJOIN("' || (CASE WHEN answer_mode = 'separate' THEN ' / ' ELSE ' ' END) || '", ' || array_to_string(answer_keys, ', ') || ')'
      ELSE '""'
    END AS computed_fields_answer
  FROM agg
)
UPDATE public.material_templates mt
SET is_exam_role = true,
    fields = COALESCE(c.computed_fields, ''),
    fields_answer = c.computed_fields_answer,
    lines_per_page = 10,
    updated_at = now()
FROM computed c
WHERE mt.id = c.id;

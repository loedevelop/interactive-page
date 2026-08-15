-- 教材 → Layout → 班級組合 → 出題紀錄 正規化重構（Phase 1：①單字/句型教材套用線）
--
-- 背景：目前「檔案＋layout→meta/script」「meta＋layout→組合」「組合＋班級→班級組合」
-- 「班級組合→出題紀錄」四層關係全部活在 profiles.raw_data（material_field_templates[]／
-- material_template_applications[]，其中 sheet_ids 是陣列，任一活頁改名/搬移會連坐其他活頁）
-- 或 assignments.tasks[].raw_data.quiz_paper（每次重產覆寫，無歷史）裡的 JSON blob，
-- 沒有 FK、沒有出題歷史，本輪對話一路在修的「孤兒紀錄」「儲存互相洗掉」都源自這個資料模型。
--
-- 本 migration：
--   1) 新建 6 張正規化表（material_layout_templates／material_folders／material_sheets／
--      material_combinations／material_combination_sheets／class_material_combinations／
--      exam_generation_events，共 7 張，含 RLS）
--   2) 把 profiles.raw_data.material_field_templates［］backfill 進 material_layout_templates
--      （legacy_id 保留舊字串 id 供比對，之後前端可用 legacy_id 找回舊參照）
--   3) 把 profiles.raw_data.material_template_applications[] 展開：sheet_ids[] 陣列拆成
--      material_sheets 一筆一活頁；template_id 對不到就留 layout_template_id = null，
--      並把舊 template_name 記在 legacy_template_name 供人工核對
--   4) 舊 profiles.raw_data 欄位保留不刪（source of truth 暫時並存），待人工核對 backfill
--      結果無誤後，另開後續 PR 移除前端對舊欄位的讀寫
--
-- material_folders.material_type 預留給 Phase 2（②錄音教材 audio_record）沿用同一批表，
-- 本次不做，只確保欄位設計不擋路。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) material_layout_templates：取代 profiles.raw_data.material_field_templates[]
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_layout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  legacy_id text,
  name text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  designed_from jsonb,
  answer_mode text,
  answer_combine_note text,
  speak_mode text,
  speak_formula text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_material_layout_templates_teacher
  ON public.material_layout_templates (teacher_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_layout_templates_legacy
  ON public.material_layout_templates (teacher_id, legacy_id)
  WHERE legacy_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) material_folders：把 root_kind + class_id + material_folder 字串三元組變成可 FK 的實體
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  root_kind text NOT NULL CHECK (root_kind IN ('teacher', 'class')),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  folder_name text NOT NULL,
  drive_folder_id text,
  material_type text NOT NULL DEFAULT 'vocab_sentence',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (root_kind = 'class' AND class_id IS NOT NULL)
    OR (root_kind = 'teacher' AND class_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_material_folders_teacher
  ON public.material_folders (teacher_id);
CREATE INDEX IF NOT EXISTS idx_material_folders_class
  ON public.material_folders (class_id);
-- 資料夾名稱比對在前端一律大小寫不敏感（見 naturalAppKey 的 .toUpperCase()），
-- 用運算式唯一索引擋掉「同一老師/同一範圍同名資料夾」重複建立。
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_folders_scope_name
  ON public.material_folders (
    teacher_id,
    root_kind,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    upper(folder_name)
  );

-- ---------------------------------------------------------------------------
-- 3) material_sheets：取代 material_template_applications 裡的 sheet_ids[] 陣列
--    ——一筆＝一個活頁，是本次重構的核心
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_folder_id uuid NOT NULL REFERENCES public.material_folders(id) ON DELETE CASCADE,
  -- 故意 ON DELETE SET NULL 不 cascade：Template 被刪除，活頁紀錄還在，只是失去 layout
  -- 關聯，畫面可以明確顯示「這個活頁的 Template 已被刪除」而不是變成孤兒字串比對失敗
  layout_template_id uuid REFERENCES public.material_layout_templates(id) ON DELETE SET NULL,
  legacy_template_name text,
  sheet_stem text NOT NULL,
  meta_file_name text,
  meta_file_id text,
  script_file_name text,
  script_file_id text,
  source_kind text CHECK (source_kind IS NULL OR source_kind IN ('local_excel', 'drive', 'local')),
  source_file_name text,
  row_start text,
  row_end text,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_sheets_folder
  ON public.material_sheets (material_folder_id);
CREATE INDEX IF NOT EXISTS idx_material_sheets_template
  ON public.material_sheets (layout_template_id);
-- 直接靠 DB 擋掉「同資料夾同活頁重複紀錄」（大小寫不敏感）
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_sheets_folder_stem
  ON public.material_sheets (material_folder_id, upper(sheet_stem));

-- ---------------------------------------------------------------------------
-- 4) material_combinations：顯式、可命名、可重複使用的「一組活頁」——供班級套用
--    （這是新概念，不從舊 JSON backfill；由老師之後透過新 UI 建立）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_folder_id uuid NOT NULL REFERENCES public.material_folders(id) ON DELETE CASCADE,
  layout_template_id uuid REFERENCES public.material_layout_templates(id) ON DELETE SET NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_combinations_folder
  ON public.material_combinations (material_folder_id);

CREATE TABLE IF NOT EXISTS public.material_combination_sheets (
  combination_id uuid NOT NULL REFERENCES public.material_combinations(id) ON DELETE CASCADE,
  material_sheet_id uuid NOT NULL REFERENCES public.material_sheets(id) ON DELETE CASCADE,
  PRIMARY KEY (combination_id, material_sheet_id)
);

CREATE INDEX IF NOT EXISTS idx_material_combination_sheets_sheet
  ON public.material_combination_sheets (material_sheet_id);

-- ---------------------------------------------------------------------------
-- 5) class_material_combinations：組合＋班級→班級組合（目前完全空缺的一層）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_material_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  material_combination_id uuid NOT NULL REFERENCES public.material_combinations(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES public.profiles(id),
  UNIQUE (class_id, material_combination_id)
);

CREATE INDEX IF NOT EXISTS idx_class_material_combinations_class
  ON public.class_material_combinations (class_id);

-- ---------------------------------------------------------------------------
-- 6) exam_generation_events：班級組合→出題紀錄，append-only，取代覆寫式 quiz_paper
--    assignments.tasks[].raw_data.quiz_paper 繼續存「目前這份考卷」給學生端讀取用，
--    歷史查詢改讀這張表（不 upsert，每次「產生線上卷」INSERT 新一列）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_generation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  -- nullable：尚未建立班級組合連結時仍可產卷，只是查不到來源
  class_material_combination_id uuid REFERENCES public.class_material_combinations(id) ON DELETE SET NULL,
  bank_id text,
  layout_profile_id text,
  sections_snapshot jsonb,
  row_start text,
  row_end text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_exam_generation_events_assignment_task
  ON public.exam_generation_events (assignment_id, task_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_generation_events_combination
  ON public.exam_generation_events (class_material_combination_id);

-- ---------------------------------------------------------------------------
-- RLS：比照 assignments／profiles 現有 policy 風格（admin 全開，其餘依歸屬判斷）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_material_folder(target_folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.material_folders mf
    WHERE mf.id = target_folder_id
      AND (
        mf.teacher_id = auth.uid()
        OR (mf.class_id IS NOT NULL AND public.is_class_staff(mf.class_id))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_material_combination(target_combination_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.material_combinations mc
    WHERE mc.id = target_combination_id
      AND public.can_access_material_folder(mc.material_folder_id)
  );
$$;

ALTER TABLE public.material_layout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_combination_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_material_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_generation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_material_layout_templates" ON public.material_layout_templates;
DROP POLICY IF EXISTS "teacher_all_own_material_layout_templates" ON public.material_layout_templates;
CREATE POLICY "admin_all_material_layout_templates"
  ON public.material_layout_templates FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "teacher_all_own_material_layout_templates"
  ON public.material_layout_templates FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "admin_all_material_folders" ON public.material_folders;
DROP POLICY IF EXISTS "teacher_all_own_material_folders" ON public.material_folders;
DROP POLICY IF EXISTS "staff_select_class_material_folders" ON public.material_folders;
CREATE POLICY "admin_all_material_folders"
  ON public.material_folders FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "teacher_all_own_material_folders"
  ON public.material_folders FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "staff_select_class_material_folders"
  ON public.material_folders FOR SELECT
  USING (class_id IS NOT NULL AND public.is_class_staff(class_id));

DROP POLICY IF EXISTS "admin_all_material_sheets" ON public.material_sheets;
DROP POLICY IF EXISTS "access_own_material_sheets" ON public.material_sheets;
CREATE POLICY "admin_all_material_sheets"
  ON public.material_sheets FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "access_own_material_sheets"
  ON public.material_sheets FOR ALL
  USING (public.can_access_material_folder(material_folder_id))
  WITH CHECK (public.can_access_material_folder(material_folder_id));

DROP POLICY IF EXISTS "admin_all_material_combinations" ON public.material_combinations;
DROP POLICY IF EXISTS "access_own_material_combinations" ON public.material_combinations;
CREATE POLICY "admin_all_material_combinations"
  ON public.material_combinations FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "access_own_material_combinations"
  ON public.material_combinations FOR ALL
  USING (public.can_access_material_folder(material_folder_id))
  WITH CHECK (public.can_access_material_folder(material_folder_id));

DROP POLICY IF EXISTS "admin_all_material_combination_sheets" ON public.material_combination_sheets;
DROP POLICY IF EXISTS "access_own_material_combination_sheets" ON public.material_combination_sheets;
CREATE POLICY "admin_all_material_combination_sheets"
  ON public.material_combination_sheets FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "access_own_material_combination_sheets"
  ON public.material_combination_sheets FOR ALL
  USING (public.can_access_material_combination(combination_id))
  WITH CHECK (public.can_access_material_combination(combination_id));

DROP POLICY IF EXISTS "admin_all_class_material_combinations" ON public.class_material_combinations;
DROP POLICY IF EXISTS "staff_all_class_material_combinations" ON public.class_material_combinations;
CREATE POLICY "admin_all_class_material_combinations"
  ON public.class_material_combinations FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_all_class_material_combinations"
  ON public.class_material_combinations FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

DROP POLICY IF EXISTS "admin_all_exam_generation_events" ON public.exam_generation_events;
DROP POLICY IF EXISTS "staff_all_class_exam_generation_events" ON public.exam_generation_events;
CREATE POLICY "admin_all_exam_generation_events"
  ON public.exam_generation_events FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_all_class_exam_generation_events"
  ON public.exam_generation_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = exam_generation_events.assignment_id
        AND public.is_class_staff(a.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = exam_generation_events.assignment_id
        AND public.is_class_staff(a.class_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill：只搬「檔案＋layout→meta/script」這條既有資料（① material_field_templates／
-- ② material_template_applications）。material_combinations／class_material_combinations／
-- exam_generation_events 是新概念，沒有對應舊資料，留給老師之後用新 UI 建立。
-- ---------------------------------------------------------------------------

-- ① material_field_templates[] → material_layout_templates
INSERT INTO public.material_layout_templates (
  id, teacher_id, legacy_id, name, columns, designed_from,
  answer_mode, answer_combine_note, speak_mode, speak_formula,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  p.id,
  NULLIF(elem->>'id', ''),
  COALESCE(NULLIF(elem->>'name', ''), '未命名 Template'),
  COALESCE(elem->'columns', '[]'::jsonb),
  elem->'designed_from',
  NULLIF(elem->>'answerMode', ''),
  NULLIF(elem->>'answerCombineNote', ''),
  NULLIF(elem->>'speakMode', ''),
  NULLIF(elem->>'speakFormula', ''),
  now(),
  now()
FROM public.profiles p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.raw_data->'material_field_templates') = 'array'
    THEN p.raw_data->'material_field_templates'
    ELSE '[]'::jsonb
  END
) AS elem
ON CONFLICT (teacher_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- 攤平 material_template_applications[]，供②③ backfill 共用（避免重複展開陣列的巢狀查詢）
CREATE TEMP TABLE _mlp_backfill_apps ON COMMIT DROP AS
SELECT
  p.id AS teacher_id,
  NULLIF(elem->>'id', '') AS legacy_app_id,
  COALESCE(NULLIF(elem->>'root_kind', ''), 'teacher') AS root_kind,
  NULLIF(elem->>'class_id', '')::uuid AS class_id,
  trim(elem->>'material_folder') AS folder_name,
  NULLIF(elem->>'template_id', '') AS legacy_template_id,
  NULLIF(elem->>'template_name', '') AS legacy_template_name,
  NULLIF(elem->>'source_kind', '') AS source_kind,
  NULLIF(elem->>'source_file_name', '') AS source_file_name,
  NULLIF(elem->>'row_start', '') AS row_start,
  NULLIF(elem->>'row_end', '') AS row_end,
  elem AS raw_elem
FROM public.profiles p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.raw_data->'material_template_applications') = 'array'
    THEN p.raw_data->'material_template_applications'
    ELSE '[]'::jsonb
  END
) AS elem
WHERE trim(coalesce(elem->>'material_folder', '')) <> '';

-- ②a 先 upsert 出 material_folders（依 teacher/root_kind/class_id/folder_name 去重，大小寫不敏感）
INSERT INTO public.material_folders (id, teacher_id, root_kind, class_id, folder_name, material_type, created_at, updated_at)
SELECT gen_random_uuid(), d.teacher_id, d.root_kind, d.class_id, d.folder_name, 'vocab_sentence', now(), now()
FROM (
  SELECT DISTINCT teacher_id, root_kind, class_id, folder_name
  FROM _mlp_backfill_apps
) d
ON CONFLICT (teacher_id, root_kind, COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(folder_name))
  DO NOTHING;

-- ②b 每個 sheet_ids[] 元素各自 insert 一筆 material_sheets；template_id 對得到就填
-- layout_template_id，對不到（孤兒紀錄）留 null 並把舊 template_name 記在 legacy_template_name
INSERT INTO public.material_sheets (
  id, material_folder_id, layout_template_id, legacy_template_name,
  sheet_stem, source_kind, source_file_name, row_start, row_end,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  s.material_folder_id,
  mlt.id,
  CASE WHEN mlt.id IS NULL THEN s.legacy_template_name ELSE NULL END,
  s.sheet_stem,
  s.source_kind,
  s.source_file_name,
  s.row_start,
  s.row_end,
  now(),
  now()
FROM (
  SELECT DISTINCT
    b.teacher_id,
    mf.id AS material_folder_id,
    trim(sheet_txt) AS sheet_stem,
    b.legacy_template_id,
    b.legacy_template_name,
    b.source_kind,
    b.source_file_name,
    b.row_start,
    b.row_end
  FROM _mlp_backfill_apps b
  JOIN public.material_folders mf
    ON mf.teacher_id = b.teacher_id
    AND mf.root_kind = b.root_kind
    AND (mf.class_id = b.class_id OR (mf.class_id IS NULL AND b.class_id IS NULL))
    AND upper(mf.folder_name) = upper(b.folder_name)
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(b.raw_elem->'sheet_ids') = 'array'
      THEN b.raw_elem->'sheet_ids'
      ELSE '[]'::jsonb
    END
  ) AS sheet_txt
  WHERE trim(coalesce(sheet_txt, '')) <> ''
) s
LEFT JOIN public.material_layout_templates mlt
  ON mlt.teacher_id = s.teacher_id AND mlt.legacy_id = s.legacy_template_id
ON CONFLICT (material_folder_id, upper(sheet_stem)) DO NOTHING;

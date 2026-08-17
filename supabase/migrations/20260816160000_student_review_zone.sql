-- 學生端「複習專區」：班級目錄快照、出卷用 meta、練習／測試場次
-- 學生不直讀整本題庫；目錄只回安全欄位；出卷走 SECURITY DEFINER RPC。

-- ---------------------------------------------------------------------------
-- 1) 目錄（學生可經 RPC 看到活頁／頁碼／可用題，看不到答案）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_review_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  folder_name text NOT NULL,
  sheet_stem text NOT NULL,
  page_min integer,
  page_max integer,
  available_count integer,
  has_template boolean NOT NULL DEFAULT false,
  exam_template_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_review_catalog_class_folder_stem
  ON public.class_review_catalog (class_id, upper(folder_name), upper(sheet_stem));

CREATE INDEX IF NOT EXISTS idx_class_review_catalog_class
  ON public.class_review_catalog (class_id);

-- ---------------------------------------------------------------------------
-- 2) 出卷用 meta（預先算好的 quiz items）。學生不可直接 SELECT。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_review_catalog_meta (
  catalog_id uuid PRIMARY KEY REFERENCES public.class_review_catalog(id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  layout jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3) 練習／測試場次（不是 assignments，不進時間軸）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('practice', 'test')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'abandoned')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiz_paper jsonb,
  answers jsonb,
  result jsonb,
  practice_progress jsonb,
  practice_required_count integer,
  counts_as_score boolean NOT NULL DEFAULT false,
  teacher_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_review_sessions_class_student
  ON public.review_sessions (class_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_sessions_class_score
  ON public.review_sessions (class_id, counts_as_score, status)
  WHERE counts_as_score = true;

ALTER TABLE public.class_review_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_review_catalog_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_sessions ENABLE ROW LEVEL SECURITY;

-- 目錄表：老師可直接維護；學生只能走 RPC（不開 SELECT policy 給 enrolled）
DROP POLICY IF EXISTS "admin_all_class_review_catalog" ON public.class_review_catalog;
DROP POLICY IF EXISTS "staff_all_class_review_catalog" ON public.class_review_catalog;
CREATE POLICY "admin_all_class_review_catalog"
  ON public.class_review_catalog FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_all_class_review_catalog"
  ON public.class_review_catalog FOR ALL
  USING (public.is_class_staff(class_id))
  WITH CHECK (public.is_class_staff(class_id));

DROP POLICY IF EXISTS "admin_all_class_review_catalog_meta" ON public.class_review_catalog_meta;
DROP POLICY IF EXISTS "staff_all_class_review_catalog_meta" ON public.class_review_catalog_meta;
CREATE POLICY "admin_all_class_review_catalog_meta"
  ON public.class_review_catalog_meta FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "staff_all_class_review_catalog_meta"
  ON public.class_review_catalog_meta FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.class_review_catalog c
      WHERE c.id = class_review_catalog_meta.catalog_id
        AND public.is_class_staff(c.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.class_review_catalog c
      WHERE c.id = class_review_catalog_meta.catalog_id
        AND public.is_class_staff(c.class_id)
    )
  );

DROP POLICY IF EXISTS "admin_all_review_sessions" ON public.review_sessions;
DROP POLICY IF EXISTS "student_own_review_sessions" ON public.review_sessions;
DROP POLICY IF EXISTS "staff_visible_review_sessions" ON public.review_sessions;
CREATE POLICY "admin_all_review_sessions"
  ON public.review_sessions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "student_own_review_sessions"
  ON public.review_sessions FOR SELECT
  USING (student_id = auth.uid() AND public.is_enrolled_student(class_id));
CREATE POLICY "staff_visible_review_sessions"
  ON public.review_sessions FOR SELECT
  USING (
    public.is_class_staff(class_id)
    AND teacher_visible = true
  );

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.class_review_zone(p_class_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(c.raw_data->'review_zone', '{}'::jsonb)
  FROM public.classes c
  WHERE c.id = p_class_id;
$$;

CREATE OR REPLACE FUNCTION public.review_item_page(p_item jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_item->'source'->>'page' ~ '^-?[0-9]+$' THEN (p_item->'source'->>'page')::integer
    WHEN p_item->>'page' ~ '^-?[0-9]+$' THEN (p_item->>'page')::integer
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- 老師整批覆寫本班複習目錄
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_class_review_catalog(
  p_class_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not class staff';
  END IF;

  DELETE FROM public.class_review_catalog WHERE class_id = p_class_id;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    INSERT INTO public.class_review_catalog (
      class_id, folder_name, sheet_stem, page_min, page_max,
      available_count, has_template, exam_template_id, updated_at
    ) VALUES (
      p_class_id,
      COALESCE(v_row->>'folder_name', ''),
      COALESCE(v_row->>'sheet_stem', ''),
      NULLIF(v_row->>'page_min', '')::integer,
      NULLIF(v_row->>'page_max', '')::integer,
      NULLIF(v_row->>'available_count', '')::integer,
      COALESCE((v_row->>'has_template')::boolean, false),
      NULLIF(v_row->>'exam_template_id', '')::uuid,
      now()
    )
    RETURNING id INTO v_id;

    INSERT INTO public.class_review_catalog_meta (catalog_id, items, layout, updated_at)
    VALUES (
      v_id,
      COALESCE(v_row->'items', '[]'::jsonb),
      v_row->'layout',
      now()
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- 學生安全目錄
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_review_catalog_for_class(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone jsonb;
  v_enabled boolean;
  v_folders jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_enrolled_student(p_class_id) AND NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not enrolled in class';
  END IF;

  v_zone := public.class_review_zone(p_class_id);
  v_enabled := COALESCE((v_zone->>'enabled')::boolean, false);

  SELECT COALESCE(jsonb_agg(folder_obj ORDER BY folder_name), '[]'::jsonb)
  INTO v_folders
  FROM (
    SELECT
      c.folder_name,
      jsonb_build_object(
        'folder_name', c.folder_name,
        'sheets', COALESCE(jsonb_agg(
          jsonb_build_object(
            'sheet_stem', c.sheet_stem,
            'page_min', c.page_min,
            'page_max', c.page_max,
            'available_count', c.available_count,
            'has_template', c.has_template
          ) ORDER BY c.sheet_stem
        ), '[]'::jsonb)
      ) AS folder_obj
    FROM public.class_review_catalog c
    WHERE c.class_id = p_class_id
    GROUP BY c.folder_name
  ) t;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'allow_practice', COALESCE((v_zone->>'allow_practice')::boolean, true),
    'allow_test', COALESCE((v_zone->>'allow_test')::boolean, true),
    'teacher_can_view', COALESCE((v_zone->>'teacher_can_view')::boolean, false),
    'test_counts_as_score', COALESCE((v_zone->>'test_counts_as_score')::boolean, false),
    'catalog_updated_at', v_zone->>'catalog_updated_at',
    'folders', COALESCE(v_folders, '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 範圍內真實可用題（不回傳題目內容）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_review_available(
  p_class_id uuid,
  p_folder_name text,
  p_sheet_stems text[],
  p_page_start integer,
  p_page_end integer
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lo integer := LEAST(COALESCE(p_page_start, 0), COALESCE(p_page_end, 0));
  v_hi integer := GREATEST(COALESCE(p_page_start, 0), COALESCE(p_page_end, 0));
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_enrolled_student(p_class_id) AND NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not enrolled in class';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_n
  FROM public.class_review_catalog c
  JOIN public.class_review_catalog_meta m ON m.catalog_id = c.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.items, '[]'::jsonb)) item
  WHERE c.class_id = p_class_id
    AND upper(c.folder_name) = upper(trim(p_folder_name))
    AND upper(c.sheet_stem) = ANY (
      SELECT upper(trim(x)) FROM unnest(COALESCE(p_sheet_stems, ARRAY[]::text[])) x
    )
    AND (
      public.review_item_page(item) IS NULL
      OR (v_lo = 0 AND v_hi = 0)
      OR public.review_item_page(item) BETWEEN v_lo AND v_hi
    );

  RETURN COALESCE(v_n, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 出卷：抽題寫入 review_sessions，只回這一場
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_review_paper(
  p_class_id uuid,
  p_mode text,
  p_folder_name text,
  p_sheet_stems text[],
  p_page_start integer,
  p_page_end integer,
  p_count integer,
  p_practice_count integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_zone jsonb;
  v_mode text := lower(trim(COALESCE(p_mode, '')));
  v_lo integer := LEAST(COALESCE(p_page_start, 0), COALESCE(p_page_end, 0));
  v_hi integer := GREATEST(COALESCE(p_page_start, 0), COALESCE(p_page_end, 0));
  v_want integer := GREATEST(1, COALESCE(p_count, 0));
  v_avail integer;
  v_items jsonb;
  v_id uuid;
  v_teacher_view boolean;
  v_counts boolean;
  v_seq int := 0;
  v_numbered jsonb := '[]'::jsonb;
  v_el jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_enrolled_student(p_class_id) THEN
    RAISE EXCEPTION 'Not enrolled in class';
  END IF;

  v_zone := public.class_review_zone(p_class_id);
  IF NOT COALESCE((v_zone->>'enabled')::boolean, false) THEN
    RAISE EXCEPTION '老師尚未開放複習專區';
  END IF;
  IF v_mode NOT IN ('practice', 'test') THEN
    RAISE EXCEPTION '無效的模式';
  END IF;
  IF v_mode = 'practice' AND NOT COALESCE((v_zone->>'allow_practice')::boolean, true) THEN
    RAISE EXCEPTION '此班未開放練習模式';
  END IF;
  IF v_mode = 'test' AND NOT COALESCE((v_zone->>'allow_test')::boolean, true) THEN
    RAISE EXCEPTION '此班未開放測試模式';
  END IF;
  IF p_folder_name IS NULL OR trim(p_folder_name) = '' THEN
    RAISE EXCEPTION '請選擇教材';
  END IF;
  IF p_sheet_stems IS NULL OR array_length(p_sheet_stems, 1) IS NULL THEN
    RAISE EXCEPTION '請選擇活頁';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_avail
  FROM public.class_review_catalog c
  JOIN public.class_review_catalog_meta m ON m.catalog_id = c.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.items, '[]'::jsonb)) item
  WHERE c.class_id = p_class_id
    AND upper(c.folder_name) = upper(trim(p_folder_name))
    AND upper(c.sheet_stem) = ANY (
      SELECT upper(trim(x)) FROM unnest(p_sheet_stems) x
    )
    AND (
      public.review_item_page(item) IS NULL
      OR (v_lo = 0 AND v_hi = 0)
      OR public.review_item_page(item) BETWEEN v_lo AND v_hi
    );

  IF COALESCE(v_avail, 0) = 0 THEN
    RAISE EXCEPTION '範圍內沒有可用題（需老師更新複習目錄，或改頁碼範圍）';
  END IF;
  IF v_want > v_avail THEN
    RAISE EXCEPTION '題數超過可用題（可用 % 題）', v_avail;
  END IF;

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT item
    FROM public.class_review_catalog c
    JOIN public.class_review_catalog_meta m ON m.catalog_id = c.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.items, '[]'::jsonb)) item
    WHERE c.class_id = p_class_id
      AND upper(c.folder_name) = upper(trim(p_folder_name))
      AND upper(c.sheet_stem) = ANY (
        SELECT upper(trim(x)) FROM unnest(p_sheet_stems) x
      )
      AND (
        public.review_item_page(item) IS NULL
        OR (v_lo = 0 AND v_hi = 0)
        OR public.review_item_page(item) BETWEEN v_lo AND v_hi
      )
    ORDER BY random()
    LIMIT v_want
  ) sampled;

  FOR v_el IN SELECT jsonb_array_elements(v_items)
  LOOP
    v_seq := v_seq + 1;
    v_numbered := v_numbered || jsonb_build_array(v_el || jsonb_build_object('seq', v_seq));
  END LOOP;

  v_teacher_view := COALESCE((v_zone->>'teacher_can_view')::boolean, false)
    OR (v_mode = 'test' AND COALESCE((v_zone->>'test_counts_as_score')::boolean, false));
  v_counts := (v_mode = 'test' AND COALESCE((v_zone->>'test_counts_as_score')::boolean, false));

  INSERT INTO public.review_sessions (
    class_id, student_id, mode, status, config, quiz_paper,
    practice_required_count, counts_as_score, teacher_visible
  ) VALUES (
    p_class_id,
    v_uid,
    v_mode,
    'active',
    jsonb_build_object(
      'folder_name', trim(p_folder_name),
      'sheet_stems', to_jsonb(p_sheet_stems),
      'page_start', v_lo,
      'page_end', v_hi,
      'count', v_want,
      'practice_count', GREATEST(1, COALESCE(p_practice_count, 1))
    ),
    jsonb_build_object(
      'kind', 'quiz_paper',
      'generated_at', now(),
      'items', v_numbered,
      'notices', '[]'::jsonb
    ),
    CASE WHEN v_mode = 'practice' THEN GREATEST(1, COALESCE(p_practice_count, 1)) ELSE NULL END,
    v_counts,
    v_teacher_view
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_id,
    'mode', v_mode,
    'practice_required_count', GREATEST(1, COALESCE(p_practice_count, 1)),
    'quiz_paper', jsonb_build_object(
      'kind', 'quiz_paper',
      'generated_at', now(),
      'items', v_numbered,
      'notices', '[]'::jsonb
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 學生交卷／練習進度
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review_session(
  p_session_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.review_sessions%ROWTYPE;
  v_done boolean := COALESCE((p_payload->>'done')::boolean, false);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row
  FROM public.review_sessions
  WHERE id = p_session_id AND student_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這場複習';
  END IF;

  UPDATE public.review_sessions
  SET
    answers = CASE WHEN p_payload ? 'answers' THEN p_payload->'answers' ELSE answers END,
    result = CASE WHEN p_payload ? 'result' THEN p_payload->'result' ELSE result END,
    practice_progress = CASE WHEN p_payload ? 'practice_progress' THEN p_payload->'practice_progress' ELSE practice_progress END,
    status = CASE WHEN v_done THEN 'submitted' ELSE status END,
    submitted_at = CASE WHEN v_done THEN now() ELSE submitted_at END,
    updated_at = now()
  WHERE id = p_session_id AND student_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'done', v_done);
END;
$$;

-- ---------------------------------------------------------------------------
-- 老師看本班紀錄（B／C）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_review_sessions_for_class(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone jsonb;
  v_can_view boolean;
  v_score_only boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not class staff';
  END IF;

  v_zone := public.class_review_zone(p_class_id);
  v_can_view := COALESCE((v_zone->>'teacher_can_view')::boolean, false);
  v_score_only := COALESCE((v_zone->>'test_counts_as_score')::boolean, false);
  IF NOT v_can_view AND NOT v_score_only THEN
    RETURN jsonb_build_object('ok', true, 'visible', false, 'sessions', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'student_id', s.student_id,
      'student_name', COALESCE(p.name, ''),
      'mode', s.mode,
      'status', s.status,
      'config', s.config,
      'result', s.result,
      'counts_as_score', s.counts_as_score,
      'created_at', s.created_at,
      'submitted_at', s.submitted_at,
      'updated_at', s.updated_at
    ) AS row_obj,
    s.created_at
    FROM public.review_sessions s
    LEFT JOIN public.profiles p ON p.id = s.student_id
    WHERE s.class_id = p_class_id
      AND s.teacher_visible = true
      AND (
        v_can_view
        OR (v_score_only AND s.mode = 'test')
      )
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'visible', true,
    'teacher_can_view', v_can_view,
    'test_counts_as_score', v_score_only,
    'sessions', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.class_review_zone(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_class_review_catalog(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_review_catalog_for_class(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_review_available(uuid, text, text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.build_review_paper(uuid, text, text, text[], integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review_session(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_review_sessions_for_class(uuid) TO authenticated;

-- =============================================================================
-- 建構初期根治：assignments.id 統一為 UUID
-- （若已是 uuid → 略過主鍵換血，仍會檢查子表＋重建 RPC）
--
-- 影響：assignments.id，以及所有 FK 指向它的子欄（預檢曾見：
--   task_completions / user_notifications / student_progress）
-- 執行後：所有人強制重新整理（舊數字作業 id 失效）
--
-- 注意：整段請一次跑完；第一個 DO 失敗會整段回滾（資料安全）
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  a_udt text;
  child_udt text;
  r record;
  n_map int;
  tmp_col text;
BEGIN
  SELECT c.udt_name INTO a_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'assignments'
    AND c.column_name = 'id';

  IF a_udt IS NULL THEN
    RAISE EXCEPTION '找不到 public.assignments.id';
  END IF;

  -- -------------------------------------------------------------------------
  -- A) assignments.id 若為整數 → 換成 uuid
  -- -------------------------------------------------------------------------
  IF a_udt IN ('int8', 'int4', 'int2') THEN
    RAISE NOTICE '開始將 assignments.id（%）遷移為 uuid…', a_udt;

    CREATE TEMP TABLE _assign_id_map (
      old_id bigint PRIMARY KEY,
      new_id uuid NOT NULL UNIQUE
    ) ON COMMIT DROP;

    -- 先記下所有指向 assignments 的 FK（含欄位），再卸除
    CREATE TEMP TABLE _assign_fks (
      sch name NOT NULL,
      tbl name NOT NULL,
      col name NOT NULL,
      con name NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO _assign_fks (sch, tbl, col, con)
    SELECT
      nsp.nspname,
      rel.relname,
      att.attname,
      con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class ref ON ref.oid = con.confrelid
    JOIN pg_namespace rnsp ON rnsp.oid = ref.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ck.attnum
     AND NOT att.attisdropped
    WHERE con.contype = 'f'
      AND rnsp.nspname = 'public'
      AND ref.relname = 'assignments'
      -- 只處理單欄 FK（多欄複合 FK 需人工處理）
      AND array_length(con.conkey, 1) = 1;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace rnsp ON rnsp.oid = ref.relnamespace
      WHERE con.contype = 'f'
        AND rnsp.nspname = 'public'
        AND ref.relname = 'assignments'
        AND array_length(con.conkey, 1) > 1
    ) THEN
      RAISE EXCEPTION '存在指向 assignments 的複合 FK，請人工處理後再跑';
    END IF;

    INSERT INTO _assign_id_map (old_id, new_id)
    SELECT a.id::bigint, gen_random_uuid()
    FROM public.assignments a;

    SELECT COUNT(*)::int INTO n_map FROM _assign_id_map;

    FOR r IN SELECT DISTINCT sch, tbl, con FROM _assign_fks
    LOOP
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
        r.sch, r.tbl, r.con
      );
      RAISE NOTICE '已卸除 FK %.%.%', r.sch, r.tbl, r.con;
    END LOOP;

    -- 清掉上次失敗殘留
    ALTER TABLE public.assignments DROP COLUMN IF EXISTS id_uuid;
    ALTER TABLE public.assignments ADD COLUMN id_uuid uuid;

    UPDATE public.assignments a
    SET id_uuid = m.new_id
    FROM _assign_id_map m
    WHERE a.id::bigint = m.old_id;

    IF EXISTS (SELECT 1 FROM public.assignments WHERE id_uuid IS NULL) THEN
      RAISE EXCEPTION 'assignments.id_uuid 仍有 NULL，中止（對照表未蓋滿）';
    END IF;

    ALTER TABLE public.assignments ALTER COLUMN id_uuid SET NOT NULL;
    ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_pkey;
    ALTER TABLE public.assignments DROP COLUMN id;
    ALTER TABLE public.assignments RENAME COLUMN id_uuid TO id;
    ALTER TABLE public.assignments ADD PRIMARY KEY (id);
    ALTER TABLE public.assignments ALTER COLUMN id SET DEFAULT gen_random_uuid();

    -- 依預檢清單：逐表把參照欄換成 uuid 並掛回 FK
    -- （含 student_progress / task_completions / user_notifications）
    FOR r IN SELECT sch, tbl, col, con FROM _assign_fks
    LOOP
      SELECT c.udt_name INTO child_udt
      FROM information_schema.columns c
      WHERE c.table_schema = r.sch
        AND c.table_name = r.tbl
        AND c.column_name = r.col;

      IF child_udt IS NULL THEN
        RAISE EXCEPTION '找不到子欄 %.%.%', r.sch, r.tbl, r.col;
      END IF;

      tmp_col := r.col || '_uuid_mig';

      EXECUTE format(
        'ALTER TABLE %I.%I DROP COLUMN IF EXISTS %I',
        r.sch, r.tbl, tmp_col
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD COLUMN %I uuid',
        r.sch, r.tbl, tmp_col
      );

      IF child_udt IN ('int8', 'int4', 'int2') THEN
        EXECUTE format(
          $q$
            UPDATE %I.%I t
            SET %I = m.new_id
            FROM _assign_id_map m
            WHERE t.%I IS NOT NULL
              AND t.%I::bigint = m.old_id
          $q$,
          r.sch, r.tbl, tmp_col, r.col, r.col
        );
      ELSE
        EXECUTE format(
          $q$
            UPDATE %I.%I t
            SET %I = m.new_id
            FROM _assign_id_map m
            WHERE t.%I IS NOT NULL
              AND t.%I::text ~ '^[0-9]+$'
              AND t.%I::text::bigint = m.old_id
          $q$,
          r.sch, r.tbl, tmp_col, r.col, r.col, r.col
        );
      END IF;

      EXECUTE format(
        'ALTER TABLE %I.%I DROP COLUMN %I',
        r.sch, r.tbl, r.col
      );
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME COLUMN %I TO %I',
        r.sch, r.tbl, tmp_col, r.col
      );

      BEGIN
        EXECUTE format(
          $q$
            ALTER TABLE %I.%I
              ADD CONSTRAINT %I
              FOREIGN KEY (%I) REFERENCES public.assignments(id) ON DELETE SET NULL
          $q$,
          r.sch, r.tbl, r.con, r.col
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;

      RAISE NOTICE '已遷移子欄 %.%.%（原型別 %）', r.sch, r.tbl, r.col, child_udt;
    END LOOP;

    RAISE NOTICE 'assignments.id 已遷移為 uuid，共 % 筆；子 FK % 條', n_map, (SELECT COUNT(*) FROM _assign_fks);

  ELSIF a_udt = 'uuid' THEN
    RAISE NOTICE 'assignments.id 已是 uuid，略過主鍵換血';

    -- 仍檢查：指向 assignments 的子欄不可還是整數
    FOR r IN
      SELECT
        nsp.nspname AS sch,
        rel.relname AS tbl,
        att.attname AS col
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN pg_class ref ON ref.oid = con.confrelid
      JOIN pg_namespace rnsp ON rnsp.oid = ref.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ck.attnum
       AND NOT att.attisdropped
      WHERE con.contype = 'f'
        AND rnsp.nspname = 'public'
        AND ref.relname = 'assignments'
        AND array_length(con.conkey, 1) = 1
    LOOP
      SELECT c.udt_name INTO child_udt
      FROM information_schema.columns c
      WHERE c.table_schema = r.sch
        AND c.table_name = r.tbl
        AND c.column_name = r.col;

      IF child_udt IN ('int8', 'int4', 'int2') THEN
        RAISE EXCEPTION
          'assignments.id 已是 uuid，但 %.%.% 仍是 %——狀態不一致',
          r.sch, r.tbl, r.col, child_udt;
      END IF;
    END LOOP;

  ELSE
    RAISE EXCEPTION '未支援的 assignments.id 型別：%', a_udt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 重建 RPC（%TYPE 綁 assignments.id；並清掉舊多載）
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS f
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'student_set_task_completion',
        'submit_audio_task_atomic',
        'assignment_is_fully_complete',
        'assignment_has_any_completion'
      )
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.f || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.student_set_task_completion(
  p_assignment_id public.assignments.id%TYPE,
  p_task_id text,
  p_class_id uuid,
  p_completed boolean,
  p_raw_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_id public.task_completions.id%TYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_enrolled_student(p_class_id) THEN
    RAISE EXCEPTION 'Not enrolled in class';
  END IF;

  IF p_completed THEN
    UPDATE public.task_completions
    SET
      assignment_id = p_assignment_id,
      status = 'completed',
      deleted_at = NULL,
      raw_data = CASE
        WHEN p_raw_data IS NULL THEN COALESCE(raw_data, '{}'::jsonb)
        ELSE COALESCE(raw_data, '{}'::jsonb) || p_raw_data
      END,
      updated_at = v_now
    WHERE task_id = p_task_id
      AND student_id = v_uid
      AND class_id = p_class_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      INSERT INTO public.task_completions (
        assignment_id, task_id, student_id, class_id, status, raw_data, deleted_at
      ) VALUES (
        p_assignment_id, p_task_id, v_uid, p_class_id, 'completed',
        COALESCE(p_raw_data, '{}'::jsonb), NULL
      )
      RETURNING id INTO v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'completed', true);
  END IF;

  UPDATE public.task_completions
  SET status = 'incomplete', deleted_at = NULL, updated_at = v_now
  WHERE task_id = p_task_id AND student_id = v_uid AND class_id = p_class_id
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'completed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_audio_task_atomic(
  p_assignment_id public.assignments.id%TYPE,
  p_task_id text,
  p_student_id uuid,
  p_class_id uuid,
  p_file_id text DEFAULT NULL,
  p_audio_url text DEFAULT NULL,
  p_segments jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id public.task_completions.id%TYPE;
  v_raw_data JSONB;
  v_file_ids text[];
  v_first_url text;
  v_segments jsonb;
  v_submitted jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_student_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_admin()
     AND NOT public.is_class_staff(p_class_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_student_id = auth.uid() AND NOT public.is_enrolled_student(p_class_id) THEN
    RAISE EXCEPTION 'Student is not enrolled in this class';
  END IF;

  IF p_segments IS NOT NULL AND jsonb_typeof(p_segments) = 'array' AND jsonb_array_length(p_segments) > 0 THEN
    v_segments := (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'file_id', COALESCE(seg->>'file_id', seg->>'id'),
          'audio_url', COALESCE(seg->>'audio_url', seg->>'url', ''),
          'unit_key', COALESCE(seg->>'unit_key', ''),
          'stem', COALESCE(seg->>'stem', ''),
          'page', seg->'page',
          'label', COALESCE(seg->>'label', ''),
          'original_script', COALESCE(seg->>'original_script', ''),
          'name', COALESCE(seg->>'name', ''),
          'status', 'pending'
        )
        ORDER BY ord
      ), '[]'::jsonb)
      FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS t(seg, ord)
      WHERE COALESCE(seg->>'file_id', seg->>'id', '') <> ''
    );
    SELECT ARRAY(
      SELECT COALESCE(s->>'file_id', '')
      FROM jsonb_array_elements(v_segments) AS s
      WHERE COALESCE(s->>'file_id', '') <> ''
    ) INTO v_file_ids;
    v_first_url := COALESCE(v_segments->0->>'audio_url', p_audio_url, '');
    v_submitted := (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', s->>'file_id',
          'mime', 'audio/wav',
          'name', COALESCE(NULLIF(s->>'name', ''), 'recording.wav'),
          'unit_key', s->>'unit_key',
          'label', s->>'label'
        )
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_segments) AS s
    );
  ELSE
    IF p_file_id IS NULL OR btrim(p_file_id) = '' THEN
      RAISE EXCEPTION 'p_file_id or p_segments required';
    END IF;
    v_file_ids := ARRAY[p_file_id];
    v_first_url := COALESCE(p_audio_url, '');
    v_segments := jsonb_build_array(
      jsonb_build_object(
        'file_id', p_file_id, 'audio_url', v_first_url, 'unit_key', '', 'label', '',
        'original_script', '', 'name', 'recording.wav', 'status', 'pending'
      )
    );
    v_submitted := jsonb_build_array(
      jsonb_build_object('id', p_file_id, 'mime', 'audio/wav', 'name', 'recording.wav')
    );
  END IF;

  SELECT id, raw_data INTO v_existing_id, v_raw_data
  FROM public.task_completions
  WHERE student_id = p_student_id AND task_id = p_task_id AND class_id = p_class_id AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.task_completions
    SET
      status = 'ai_processing',
      raw_data = COALESCE(v_raw_data, '{}'::jsonb) || jsonb_build_object(
        'drive_file_ids', to_jsonb(v_file_ids),
        'student_audio_url', v_first_url,
        'audio_url', v_first_url,
        'audio_segments', v_segments,
        'submitted_files', v_submitted,
        'submitted_at', (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
        'ai_segment_cursor', 0
      ) - 'ai_error_log' - 'failed_at' - 'ai_skip_reason' - 'ai_skipped_at',
      updated_at = NOW()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.task_completions (
      assignment_id, task_id, student_id, class_id, status, raw_data
    ) VALUES (
      p_assignment_id, p_task_id, p_student_id, p_class_id, 'ai_processing',
      jsonb_build_object(
        'drive_file_ids', to_jsonb(v_file_ids),
        'student_audio_url', v_first_url,
        'audio_url', v_first_url,
        'audio_segments', v_segments,
        'submitted_files', v_submitted,
        'submitted_at', (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
        'ai_segment_cursor', 0
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'ai_processing',
    'segment_count', COALESCE(jsonb_array_length(v_segments), 0),
    'message', '任務已成功提交，AI 大腦已接管'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assignment_is_fully_complete(
  p_assignment_id public.assignments.id%TYPE,
  p_student_id uuid,
  p_tasks jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  leaf_ids text[];
  total int;
  done_count int;
BEGIN
  leaf_ids := public.collect_leaf_task_ids(p_tasks);
  total := COALESCE(array_length(leaf_ids, 1), 0);
  IF total = 0 THEN RETURN false; END IF;

  SELECT COUNT(*)::int INTO done_count
  FROM public.task_completions tc
  WHERE tc.assignment_id = p_assignment_id
    AND tc.student_id = p_student_id
    AND tc.deleted_at IS NULL
    AND tc.status IS DISTINCT FROM 'incomplete'
    AND tc.task_id::text = ANY (leaf_ids);

  RETURN done_count >= total;
END;
$$;

CREATE OR REPLACE FUNCTION public.assignment_has_any_completion(
  p_assignment_id public.assignments.id%TYPE,
  p_student_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_completions tc
    WHERE tc.assignment_id = p_assignment_id
      AND tc.student_id = p_student_id
      AND tc.deleted_at IS NULL
      AND tc.status IS DISTINCT FROM 'incomplete'
      AND tc.status IS DISTINCT FROM 'ai_error'
      AND tc.status IS DISTINCT FROM 'ai_failed'
  );
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'student_set_task_completion',
        'submit_audio_task_atomic',
        'assignment_is_fully_complete',
        'assignment_has_any_completion'
      )
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
      r.proname, r.sig
    );
  END LOOP;
END $$;

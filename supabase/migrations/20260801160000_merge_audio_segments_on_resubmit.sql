-- 修復：多段錄音（一頁一檔）分批提交時，第二批會整批覆寫第一批
--
-- 症狀：作業應交 12 個音檔（12 頁），學生先傳 6 個成功；下次再傳剩下 6 個，
-- 原本的 submit_audio_task_atomic 會把 raw_data.audio_segments／drive_file_ids／
-- submitted_files 整組「覆寫」成這次的 6 筆，導致第一批的 6 筆（含可能已完成的
-- AI 批改結果）全部消失，且被覆寫後 task_completions 只剩第二批 6 筆。
--
-- 根因：舊版無論是否已有既有 raw_data.audio_segments，一律用本次 p_segments
-- 整批取代，沒有依 unit_key 與舊資料合併。
--
-- 修法：改為「依 unit_key 合併」——
--   1. 本次提交的段（v_new_segments）一律採用（老師／學生要重傳某一頁時，
--      新版本應該蓋過該頁舊版本，屬預期行為）
--   2. 舊資料中「unit_key 不在本次提交範圍內」的段，原樣保留（不遺失前一批）
--   3. 舊資料若沒有 unit_key（舊式單檔任務，unit_key 均為空字串）維持原「整批取代」
--      行為，因為單檔任務本來就只有一個語意上的音檔，沒有「合併」的必要
--   4. drive_file_ids／submitted_files 依合併後的 v_segments 重新推導，
--      不再只反映「這次提交」的檔案
--
-- 💣 雷區（見 .cursor/rules/ai-grading-pipeline-invariants.mdc）：
-- 本次僅修改「資料合併」邏輯，不改動 status 轉換／webhook 觸發方式，
-- 避免引入雙 webhook 或自動延遲重試等已知風險。

CREATE OR REPLACE FUNCTION public.submit_audio_task_atomic(
  p_assignment_id uuid,
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
  v_new_segments jsonb;
  v_segments jsonb;
  v_submitted jsonb;
  v_old_has_unit_key boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_student_id IS DISTINCT FROM auth.uid()
     AND NOT public.is_admin()
     AND NOT public.is_class_staff(p_class_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_student_id = auth.uid() AND NOT public.is_enrolled_student(p_class_id) THEN
    RAISE EXCEPTION 'Student is not enrolled in this class';
  END IF;

  -- 正規化本次提交的 segments 或單檔相容
  IF p_segments IS NOT NULL AND jsonb_typeof(p_segments) = 'array' AND jsonb_array_length(p_segments) > 0 THEN
    v_new_segments := (
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
  ELSE
    IF p_file_id IS NULL OR btrim(p_file_id) = '' THEN
      RAISE EXCEPTION 'p_file_id or p_segments required';
    END IF;
    v_new_segments := jsonb_build_array(
      jsonb_build_object(
        'file_id', p_file_id,
        'audio_url', COALESCE(p_audio_url, ''),
        'unit_key', '',
        'label', '',
        'original_script', '',
        'name', 'recording.wav',
        'status', 'pending'
      )
    );
  END IF;

  SELECT id, raw_data INTO v_existing_id, v_raw_data
  FROM public.task_completions
  WHERE student_id = p_student_id
    AND task_id = p_task_id
    AND class_id = p_class_id
    AND deleted_at IS NULL
  LIMIT 1;

  -- 舊資料是否為「有 unit_key 的多段任務」——只有這種才需要合併，
  -- 舊式單檔任務（unit_key 一律空字串）維持整批取代，語意上本來就只有一份。
  v_old_has_unit_key := (
    v_raw_data IS NOT NULL
    AND jsonb_typeof(v_raw_data->'audio_segments') = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_raw_data->'audio_segments') s
      WHERE COALESCE(s->>'unit_key', '') <> ''
    )
  );

  IF v_old_has_unit_key THEN
    -- 合併：本次提交的段一律採用；舊段中 unit_key 不在本次範圍內的原樣保留，
    -- 依 page（可解析為數字時）排序，無法解析則排在後面但保持原提交順序。
    v_segments := (
      SELECT COALESCE(jsonb_agg(seg ORDER BY ord_key, ord_seq), '[]'::jsonb)
      FROM (
        SELECT
          new_seg AS seg,
          CASE WHEN (new_seg->>'page') ~ '^-?[0-9]+(\.[0-9]+)?$'
            THEN (new_seg->>'page')::numeric ELSE 999999 END AS ord_key,
          (row_number() OVER ()) AS ord_seq
        FROM jsonb_array_elements(v_new_segments) new_seg
        UNION ALL
        SELECT
          old_seg,
          CASE WHEN (old_seg->>'page') ~ '^-?[0-9]+(\.[0-9]+)?$'
            THEN (old_seg->>'page')::numeric ELSE 999999 END,
          1000000 + (row_number() OVER ())
        FROM jsonb_array_elements(v_raw_data->'audio_segments') old_seg
        WHERE COALESCE(old_seg->>'unit_key', '') <> ''
          AND COALESCE(old_seg->>'unit_key', '') NOT IN (
            SELECT COALESCE(s->>'unit_key', '') FROM jsonb_array_elements(v_new_segments) s
          )
      ) t
    );
  ELSE
    v_segments := v_new_segments;
  END IF;

  -- drive_file_ids／submitted_files／首張音檔網址：一律依「合併後」的 v_segments 重新推導，
  -- 確保分批提交會累加而不是只反映最後一批
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
      assignment_id,
      task_id,
      student_id,
      class_id,
      status,
      raw_data
    )
    VALUES (
      p_assignment_id,
      p_task_id,
      p_student_id,
      p_class_id,
      'ai_processing',
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

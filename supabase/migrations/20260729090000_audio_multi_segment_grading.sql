-- 錄音任務支援複選多音檔：以 grading_units（一頁一檔）對應 AI 批改
--
-- 重要：舊版簽名為 (uuid, text, uuid, uuid, text, text)，新版多了 p_segments。
-- CREATE OR REPLACE 對「不同簽名」不會取代舊函式，而是產生多載（overload），
-- 導致既有呼叫（老師補批改 / 學生手動喚醒 AI，皆只傳 6 個具名參數）同時匹配
-- 新舊兩個版本，PostgREST 會回傳 "function is not unique" 錯誤。
-- 因此必須先明確 DROP 舊版本，再建立新版本，確保全庫只有一個多載。
DROP FUNCTION IF EXISTS public.submit_audio_task_atomic(uuid, text, uuid, uuid, text, text);

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
  v_existing_id task_completions.id%TYPE;
  v_raw_data JSONB;
  v_file_ids text[];
  v_first_url text;
  v_segments jsonb;
  v_submitted jsonb;
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

  -- 正規化 segments 或單檔相容
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
        'file_id', p_file_id,
        'audio_url', v_first_url,
        'unit_key', '',
        'label', '',
        'original_script', '',
        'name', 'recording.wav',
        'status', 'pending'
      )
    );
    v_submitted := jsonb_build_array(
      jsonb_build_object('id', p_file_id, 'mime', 'audio/wav', 'name', 'recording.wav')
    );
  END IF;

  SELECT id, raw_data INTO v_existing_id, v_raw_data
  FROM task_completions
  WHERE student_id = p_student_id
    AND task_id = p_task_id
    AND class_id = p_class_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE task_completions
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
    INSERT INTO task_completions (
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

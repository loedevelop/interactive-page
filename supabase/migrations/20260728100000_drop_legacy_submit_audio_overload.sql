-- 移除舊版 submit_audio_task_atomic(bigint, text)，避免 PostgREST 多載混淆
DROP FUNCTION IF EXISTS public.submit_audio_task_atomic(bigint, text);

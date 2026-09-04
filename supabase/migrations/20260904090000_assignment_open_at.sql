-- 作業開放時刻：區塊 open_at；due_date 改文字以便存「日＋時」。
-- 沒填開放＝已發佈就可見。已填且尚未到＝學生看不到，提醒也不發。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assignments'
      AND column_name = 'due_date' AND data_type = 'date'
  ) THEN
    ALTER TABLE public.assignments
      ALTER COLUMN due_date TYPE text
      USING CASE WHEN due_date IS NULL THEN NULL ELSE due_date::text END;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'assignments'
      AND column_name = 'due_date'
      AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
  ) THEN
    ALTER TABLE public.assignments
      ALTER COLUMN due_date TYPE text
      USING CASE
        WHEN due_date IS NULL THEN NULL
        ELSE to_char(due_date AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD"T"HH24:MI')
      END;
  END IF;
END $$;

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS open_at text;

COMMENT ON COLUMN public.assignments.open_at IS '區塊開放：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm（台灣）。空＝已發佈即可見。';
COMMENT ON COLUMN public.assignments.due_date IS '區塊期限：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm（台灣）。';

CREATE OR REPLACE FUNCTION public.assignment_is_visible_now(p_open_at text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_open_at IS NULL OR btrim(p_open_at) = '' THEN true
    WHEN p_open_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN
      ((substring(p_open_at from 1 for 10) || ' ' || substring(p_open_at from 12 for 5))::timestamp
        AT TIME ZONE 'Asia/Taipei') <= now()
    WHEN p_open_at ~ '^\d{4}-\d{2}-\d{2}' THEN
      ((left(p_open_at, 10)::date)::timestamp AT TIME ZONE 'Asia/Taipei') <= now()
    ELSE true
  END;
$$;

GRANT EXECUTE ON FUNCTION public.assignment_is_visible_now(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_is_visible_now(text) TO service_role;

CREATE OR REPLACE FUNCTION public.assignment_stamp_label(p_stamp text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stamp IS NULL OR btrim(p_stamp) = '' THEN ''
    WHEN p_stamp ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN
      replace(substring(p_stamp from 1 for 16), 'T', ' ')
    ELSE left(p_stamp, 10)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.assignment_stamp_label(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_stamp_label(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fetch_archived_class_assignments(target_class_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT public.can_manage_archived_class(target_class_id) THEN
    RAISE EXCEPTION '無權限讀取此封存班級';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = target_class_id AND c.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '找不到封存班級';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(a)), '[]'::json) INTO result
  FROM (
    SELECT id, class_id, title, description, target_date, due_date, open_at, is_published, tasks, raw_data, created_at, deleted_at
    FROM public.assignments
    WHERE class_id = target_class_id
    ORDER BY target_date ASC NULLS LAST, created_at ASC
  ) a;

  RETURN result;
END;
$$;

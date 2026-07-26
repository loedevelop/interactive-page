-- Fix: archived class browse shows no assignments when archive soft-deleted them

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

  -- Include soft-deleted rows: assignments are often marked deleted_at on class archive
  SELECT COALESCE(json_agg(row_to_json(a)), '[]'::json) INTO result
  FROM (
    SELECT id, class_id, title, description, target_date, due_date, tasks, raw_data, created_at, deleted_at
    FROM public.assignments
    WHERE class_id = target_class_id
    ORDER BY target_date ASC NULLS LAST, created_at ASC
  ) a;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_class_atomic(target_class_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_archived_class(target_class_id) THEN
    RAISE EXCEPTION '無權限恢復此班級';
  END IF;

  UPDATE public.classes
  SET deleted_at = NULL
  WHERE id = target_class_id AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到可恢復的封存班級';
  END IF;

  UPDATE public.assignments
  SET deleted_at = NULL
  WHERE class_id = target_class_id
    AND deleted_at IS NOT NULL;

  RETURN json_build_object('status', 'success', 'class_id', target_class_id);
END;
$$;

-- Archived classes: list, assignments, restore, admin purge

CREATE OR REPLACE FUNCTION public.is_primary_teacher_of_class(target_cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_staff cs
    WHERE cs.class_id = target_cid
      AND cs.user_id = auth.uid()
      AND cs.deleted_at IS NULL
      AND cs.staff_role IN ('primary_teacher', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_archived_class(target_cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR public.is_primary_teacher_of_class(target_cid);
$$;

CREATE OR REPLACE FUNCTION public.list_archived_classes()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF public.is_admin() THEN
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO result
    FROM (
      SELECT c.id, c.name, c.icon, c.deleted_at, c.created_at, c.raw_data
      FROM public.classes c
      WHERE c.deleted_at IS NOT NULL
        AND COALESCE(c.raw_data->>'purged_permanent', 'false') <> 'true'
      ORDER BY c.deleted_at DESC
    ) t;
  ELSE
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO result
    FROM (
      SELECT c.id, c.name, c.icon, c.deleted_at, c.created_at, c.raw_data
      FROM public.classes c
      INNER JOIN public.class_staff cs
        ON cs.class_id = c.id
       AND cs.user_id = auth.uid()
       AND cs.deleted_at IS NULL
       AND cs.staff_role IN ('primary_teacher', 'admin')
      WHERE c.deleted_at IS NOT NULL
        AND COALESCE(c.raw_data->>'purged_permanent', 'false') <> 'true'
      ORDER BY c.deleted_at DESC
    ) t;
  END IF;
  RETURN result;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.purge_class_permanent(target_class_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '僅 Admin 可永久刪除班級';
  END IF;

  UPDATE public.classes
  SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('purged_permanent', true, 'purged_at', now())
  WHERE id = target_class_id AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到可永久刪除的封存班級';
  END IF;

  RETURN json_build_object('status', 'success', 'class_id', target_class_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_archived_classes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_archived_class_assignments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_class_atomic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_class_permanent(uuid) TO authenticated;

-- Fix: archived classes invisible when class_staff was soft-deleted on archive

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
      AND cs.staff_role IN ('primary_teacher', 'admin')
  );
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
      WHERE c.deleted_at IS NOT NULL
        AND COALESCE(c.raw_data->>'purged_permanent', 'false') <> 'true'
        AND EXISTS (
          SELECT 1
          FROM public.class_staff cs
          WHERE cs.class_id = c.id
            AND cs.user_id = auth.uid()
            AND cs.staff_role IN ('primary_teacher', 'admin')
        )
      ORDER BY c.deleted_at DESC
    ) t;
  END IF;
  RETURN result;
END;
$$;

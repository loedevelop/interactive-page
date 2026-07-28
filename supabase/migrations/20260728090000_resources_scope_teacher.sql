-- 資源三層 scope：global（全校）／teacher（班群＝老師名下所有班）／class（指定班）
-- teacher：讀取時若 owner_id 為該班 class_staff，則自動適用（含未來新班）

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'resources'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%scope%'
  LOOP
    EXECUTE format('ALTER TABLE public.resources DROP CONSTRAINT %I', r.conname);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'resources table missing — skip scope constraint';
END $$;

ALTER TABLE public.resources
  ADD CONSTRAINT resources_scope_check
  CHECK (scope IS NULL OR scope IN ('global', 'teacher', 'class'));

COMMENT ON COLUMN public.resources.scope IS
  'global=全校; teacher=班群(owner 所屬 staff 班級自動適用); class=指定班級';

CREATE OR REPLACE FUNCTION public.fetch_resources_for_class(p_class_id uuid)
RETURNS SETOF public.resources
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT (
    public.is_admin()
    OR public.is_class_staff(p_class_id)
    OR public.is_enrolled_student(p_class_id)
  ) THEN
    RAISE EXCEPTION 'not allowed to read resources for this class';
  END IF;

  RETURN QUERY
  SELECT r.*
  FROM public.resources r
  WHERE r.deleted_at IS NULL
    AND (
      r.scope = 'global'
      OR (r.scope = 'class' AND r.target_class_id = p_class_id)
      OR (
        r.scope = 'teacher'
        AND EXISTS (
          SELECT 1
          FROM public.class_staff cs
          WHERE cs.class_id = p_class_id
            AND cs.user_id = r.owner_id
            AND cs.deleted_at IS NULL
        )
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_resources_for_class(uuid) TO authenticated;

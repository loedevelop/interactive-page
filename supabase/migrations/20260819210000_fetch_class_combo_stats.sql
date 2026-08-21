-- 開班進度時一次載入套組統計（每頁題數），考試加片段不再打 DB／Drive 撈整份 meta。
CREATE OR REPLACE FUNCTION public.fetch_class_combo_stats(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not class staff';
  END IF;

  SELECT COALESCE(jsonb_agg(sheet_obj ORDER BY folder_name, sheet_stem), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      c.folder_name,
      c.sheet_stem,
      jsonb_build_object(
        'folder_name', c.folder_name,
        'sheet_stem', c.sheet_stem,
        'page_min', c.page_min,
        'page_max', c.page_max,
        'available_count', c.available_count,
        'page_counts', COALESCE((
          SELECT jsonb_object_agg(p.page::text, p.cnt)
          FROM (
            SELECT public.review_item_page(item) AS page, COUNT(*)::integer AS cnt
            FROM jsonb_array_elements(COALESCE(m.items, '[]'::jsonb)) item
            WHERE public.review_item_page(item) IS NOT NULL
            GROUP BY 1
          ) p
        ), '{}'::jsonb)
      ) AS sheet_obj
    FROM public.class_review_catalog c
    LEFT JOIN public.class_review_catalog_meta m ON m.catalog_id = c.id
    WHERE c.class_id = p_class_id
  ) t;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_class_combo_stats(uuid) TO authenticated;

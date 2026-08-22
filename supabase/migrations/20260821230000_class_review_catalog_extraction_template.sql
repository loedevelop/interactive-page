-- 統計表對稱：已有「有沒有試卷範本」，補「有沒有擷取範本」。
-- 值跟活頁列走（material_sheets.extraction_template_id），重抓目錄時寫入。

ALTER TABLE public.class_review_catalog
  ADD COLUMN IF NOT EXISTS has_extraction_template boolean NOT NULL DEFAULT false;

ALTER TABLE public.class_review_catalog
  ADD COLUMN IF NOT EXISTS extraction_template_id uuid;

COMMENT ON COLUMN public.class_review_catalog.has_extraction_template IS
  '這本活頁有沒有擷取範本（跟活頁列 extraction_template_id 走）';
COMMENT ON COLUMN public.class_review_catalog.extraction_template_id IS
  '擷取範本 id；沒有則空';

CREATE OR REPLACE FUNCTION public.replace_class_review_catalog(
  p_class_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not class staff';
  END IF;

  DELETE FROM public.class_review_catalog WHERE class_id = p_class_id;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    INSERT INTO public.class_review_catalog (
      class_id, folder_name, sheet_stem, page_min, page_max,
      available_count, has_template, exam_template_id,
      has_extraction_template, extraction_template_id, updated_at
    ) VALUES (
      p_class_id,
      COALESCE(v_row->>'folder_name', ''),
      COALESCE(v_row->>'sheet_stem', ''),
      NULLIF(v_row->>'page_min', '')::integer,
      NULLIF(v_row->>'page_max', '')::integer,
      NULLIF(v_row->>'available_count', '')::integer,
      COALESCE((v_row->>'has_template')::boolean, false),
      NULLIF(v_row->>'exam_template_id', '')::uuid,
      COALESCE((v_row->>'has_extraction_template')::boolean, false),
      NULLIF(v_row->>'extraction_template_id', '')::uuid,
      now()
    )
    RETURNING id INTO v_id;

    INSERT INTO public.class_review_catalog_meta (catalog_id, items, layout, updated_at)
    VALUES (
      v_id,
      COALESCE(v_row->'items', '[]'::jsonb),
      v_row->'layout',
      now()
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.fetch_review_catalog_for_class(p_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone jsonb;
  v_enabled boolean;
  v_folders jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_enrolled_student(p_class_id) AND NOT public.is_class_staff(p_class_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not enrolled in class';
  END IF;

  v_zone := public.class_review_zone(p_class_id);
  v_enabled := COALESCE((v_zone->>'enabled')::boolean, false);

  SELECT COALESCE(jsonb_agg(folder_obj ORDER BY folder_name), '[]'::jsonb)
  INTO v_folders
  FROM (
    SELECT
      c.folder_name,
      jsonb_build_object(
        'folder_name', c.folder_name,
        'sheets', COALESCE(jsonb_agg(
          jsonb_build_object(
            'sheet_stem', c.sheet_stem,
            'page_min', c.page_min,
            'page_max', c.page_max,
            'available_count', c.available_count,
            'has_template', c.has_template,
            'has_extraction_template', c.has_extraction_template
          ) ORDER BY c.sheet_stem
        ), '[]'::jsonb)
      ) AS folder_obj
    FROM public.class_review_catalog c
    WHERE c.class_id = p_class_id
    GROUP BY c.folder_name
  ) t;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'allow_practice', COALESCE((v_zone->>'allow_practice')::boolean, true),
    'allow_test', COALESCE((v_zone->>'allow_test')::boolean, true),
    'teacher_can_view', COALESCE((v_zone->>'teacher_can_view')::boolean, false),
    'test_counts_as_score', COALESCE((v_zone->>'test_counts_as_score')::boolean, false),
    'catalog_updated_at', v_zone->>'catalog_updated_at',
    'folders', COALESCE(v_folders, '[]'::jsonb)
  );
END;
$$;

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
        'has_template', c.has_template,
        'exam_template_id', c.exam_template_id,
        'has_extraction_template', c.has_extraction_template,
        'extraction_template_id', c.extraction_template_id,
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

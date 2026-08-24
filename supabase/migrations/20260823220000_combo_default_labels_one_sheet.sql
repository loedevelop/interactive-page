-- 套餐名預設＝活頁名.擷取範本［.試卷範本］
-- 一份套餐一本活頁。擷取對不上的連結刪掉。

DELETE FROM public.material_combination_sheets cs
USING public.material_combinations c, public.material_sheets s
WHERE cs.combination_id = c.id
  AND cs.material_sheet_id = s.id
  AND s.extraction_template_id IS NOT NULL
  AND c.extraction_template_id IS NOT NULL
  AND s.extraction_template_id IS DISTINCT FROM c.extraction_template_id;

DO $$
DECLARE
  r RECORD;
  new_id uuid;
BEGIN
  FOR r IN
    SELECT old_id, material_sheet_id, material_folder_id, extraction_template_id,
           student_pdf_file_id, student_pdf_file_name, student_pdf_page_map
    FROM (
      SELECT
        cs.combination_id AS old_id,
        cs.material_sheet_id,
        c.material_folder_id,
        c.extraction_template_id,
        c.student_pdf_file_id,
        c.student_pdf_file_name,
        c.student_pdf_page_map,
        ROW_NUMBER() OVER (PARTITION BY cs.combination_id ORDER BY s.sheet_stem, s.id) AS rn
      FROM public.material_combination_sheets cs
      JOIN public.material_combinations c ON c.id = cs.combination_id
      JOIN public.material_sheets s ON s.id = cs.material_sheet_id
    ) ranked
    WHERE rn > 1
  LOOP
    INSERT INTO public.material_combinations (
      material_folder_id,
      extraction_template_id,
      student_pdf_file_id,
      student_pdf_file_name,
      student_pdf_page_map
    ) VALUES (
      r.material_folder_id,
      r.extraction_template_id,
      r.student_pdf_file_id,
      COALESCE(r.student_pdf_file_name, ''),
      COALESCE(r.student_pdf_page_map, '[]'::jsonb)
    ) RETURNING id INTO new_id;

    INSERT INTO public.material_combination_sheets (combination_id, material_sheet_id)
    VALUES (new_id, r.material_sheet_id);

    DELETE FROM public.material_combination_sheets
    WHERE combination_id = r.old_id
      AND material_sheet_id = r.material_sheet_id;

    INSERT INTO public.material_combination_exam_templates (
      material_combination_id, exam_template_id, is_default
    )
    SELECT new_id, e.exam_template_id, e.is_default
    FROM public.material_combination_exam_templates e
    WHERE e.material_combination_id = r.old_id;

    INSERT INTO public.class_material_combinations (
      class_id, material_combination_id, assigned_by
    )
    SELECT cmc.class_id, new_id, cmc.assigned_by
    FROM public.class_material_combinations cmc
    WHERE cmc.material_combination_id = r.old_id
    ON CONFLICT (class_id, material_combination_id) DO NOTHING;
  END LOOP;
END $$;

UPDATE public.material_combinations c
SET
  label = n.next_label,
  updated_at = now()
FROM (
  SELECT
    cs.combination_id,
    CASE
      WHEN NULLIF(BTRIM(exam.exam_name), '') IS NULL
        THEN BTRIM(s.sheet_stem) || '.' || BTRIM(t.name)
      ELSE BTRIM(s.sheet_stem) || '.' || BTRIM(t.name) || '.' || BTRIM(exam.exam_name)
    END AS next_label
  FROM public.material_combination_sheets cs
  JOIN public.material_sheets s ON s.id = cs.material_sheet_id
  JOIN public.material_combinations cx ON cx.id = cs.combination_id
  JOIN public.material_templates t ON t.id = cx.extraction_template_id
  LEFT JOIN LATERAL (
    SELECT mt.name AS exam_name
    FROM public.material_combination_exam_templates e
    JOIN public.material_templates mt ON mt.id = e.exam_template_id
    WHERE e.material_combination_id = cs.combination_id
    ORDER BY e.is_default DESC NULLS LAST, mt.name
    LIMIT 1
  ) exam ON true
  WHERE NULLIF(BTRIM(s.sheet_stem), '') IS NOT NULL
    AND NULLIF(BTRIM(t.name), '') IS NOT NULL
) n
WHERE c.id = n.combination_id;

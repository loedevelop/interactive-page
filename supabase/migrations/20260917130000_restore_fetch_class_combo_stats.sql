-- 2026-09-17（緊急修復：老師出作業套餐下拉，Excel/JSON 套餐全部消失，只剩目錄套餐）
--
-- 根因：public.fetch_class_combo_stats(uuid) 這個函式，線上實際部署的版本是
-- combo_statistics 表出現之前的舊版（讀 class_review_catalog / class_review_catalog_meta，
-- 回傳格式沒有 kind／combo_label／material_sheet_id／class_ids 等新欄位）。
-- 20260906130000_combo_statistics_all_kinds.sql 這份 migration 裡雖然已經寫好正確版本
-- （改讀 combo_statistics），但線上資料庫從未真的换成這一版——combo_statistics 表本身
-- 資料是完整的（老師的 Excel/JSON 套餐都在），只是這支讀取函式沒有真的指到這張表。
--
-- 症狀：前端 listAssignedCombosForHomework／applyHomeworkCombosFromStats 拿到舊格式（無
-- combo_label／kind）資料，storedCardLabelFromStats 算不出套餐名，整份套餐被判定「沒有名字」
-- 而靜默跳過——出作業套餐下拉只剩目錄套餐（走別的表，不受影響），Excel/JSON 套餐全部消失。
--
-- 這裡原樣重新套用 20260906130000 那份 migration 裡的函式定義（純函式覆蓋，不動任何資料列，
-- 可再覆蓋回去；combo_statistics 表結構與資料未受影響）。

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

  SELECT COALESCE(
    jsonb_agg(to_jsonb(v) ORDER BY v.combo_label, v.sheet_stem),
    '[]'::jsonb
  )
  INTO v_out
  FROM (
    SELECT
      cid AS class_id,
      s.kind,
      s.combination_id,
      s.pdf_item_id,
      s.book_combo_id,
      s.combo_label,
      s.material_folder_id,
      s.folder_name,
      s.root_kind,
      s.material_sheet_id,
      s.sheet_stem,
      s.meta_file_name,
      s.source_file_name,
      s.is_group,
      s.available_count,
      s.extraction_template_id,
      s.extraction_template_name,
      s.student_pdf_file_id,
      s.student_pdf_file_name,
      s.student_pdf_page_map,
      s.exam_template_ids
    FROM public.combo_statistics s
    CROSS JOIN LATERAL unnest(s.class_ids) AS cid
    WHERE cid = p_class_id
  ) v;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.fetch_class_combo_stats(uuid) IS
  '這個班出作業範圍 statistics。三種套餐都在。只讀 combo_statistics。';

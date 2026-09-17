-- 2026-09-16（雷區修復：Excel/JSON 套餐撈到 0 本活頁 / GEPT-2 整句翻譯這類多活頁套餐）
--
-- 根因：ensureCombination（110_teacher_core/feature-class-material-combinations.js）過去只有
-- 「剛建立套餐、且這次剛好只有 1 本活頁」才會寫入 material_combination_sheets；套餐已存在的
-- 分支從來沒補寫過。多本活頁的套餐因此永遠沒有正確的關聯表紀錄。combo_statistics／
-- fetch_class_combo_stats 是用 LEFT JOIN material_combination_sheets 撈套餐底下活頁，關聯表
-- 是空的就會撈到 0 本——不是活頁被刪除，是套餐建立當下就沒寫對。JS 端已經修好（見同一天的
-- feature-class-material-combinations.js 變更：ensureCombination 現在無論新建或重用都會呼叫
-- syncComboSheetLinks 補寫關聯）。這支負責把「已經存在、但關聯表沒補齊」的歷史資料一次補回去。
--
-- 精準原則（不准瞎猜）：
--   material_combinations 沒有自己的 source_file_name 欄位，活頁的來源檔身分只能從
--   material_sheets.source_file_name 判斷。如果同一個 (material_folder_id, extraction_template_id)
--   底下同時存在「不只一份套餐」，代表這個資料夾＋範本組合本來就有多個不同來源檔的套餐彼此區分，
--   這種情況下光靠 folder+template 對不到「這批活頁該歸哪一份套餐」，一律跳過、不猜、不補。
--   只有「這個 folder+template 組合全資料庫剛好只有一份套餐」時，才能安全地把所有比對得上的
--   活頁（folder_id + extraction_template_id 相同）通通補進這一份套餐的關聯表。

DO $$
DECLARE
  v_combo record;
  v_inserted integer := 0;
  v_skipped_ambiguous integer := 0;
  v_combos_touched integer := 0;
BEGIN
  FOR v_combo IN
    SELECT
      c.id,
      c.material_folder_id,
      c.extraction_template_id,
      c.label,
      (
        SELECT count(*)
        FROM public.material_combinations c2
        WHERE c2.material_folder_id = c.material_folder_id
          AND c2.extraction_template_id = c.extraction_template_id
      ) AS sibling_combo_count
    FROM public.material_combinations c
  LOOP
    IF v_combo.sibling_combo_count > 1 THEN
      -- 同一個資料夾＋擷取範本底下不只一份套餐，光靠 folder+template 對不到該歸哪一份，跳過不猜。
      v_skipped_ambiguous := v_skipped_ambiguous + 1;
      CONTINUE;
    END IF;

    WITH missing AS (
      SELECT s.id AS material_sheet_id
      FROM public.material_sheets s
      WHERE s.material_folder_id = v_combo.material_folder_id
        AND s.extraction_template_id = v_combo.extraction_template_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.material_combination_sheets cs
          WHERE cs.combination_id = v_combo.id
            AND cs.material_sheet_id = s.id
        )
    ),
    ins AS (
      INSERT INTO public.material_combination_sheets (combination_id, material_sheet_id)
      SELECT v_combo.id, m.material_sheet_id FROM missing m
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;

    IF v_inserted > 0 THEN
      v_combos_touched := v_combos_touched + 1;
      RAISE NOTICE '套餐 % (label=%) 補上 % 筆活頁關聯', v_combo.id, v_combo.label, v_inserted;
      PERFORM public.refresh_combo_statistics(v_combo.id);
    END IF;
  END LOOP;

  RAISE NOTICE '補完：% 份套餐補上關聯；% 份套餐因同資料夾＋範本有多份套餐、對不到歸屬而跳過（需人工核對）。',
    v_combos_touched, v_skipped_ambiguous;
END;
$$;

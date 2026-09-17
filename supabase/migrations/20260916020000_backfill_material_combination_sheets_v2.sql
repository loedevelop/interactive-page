-- 2026-09-16（接續 20260916010000，修正過保守的「對不到歸屬」判斷）
--
-- 20260916010000 那版用「同資料夾＋擷取範本底下套餐筆數 >1」當作「對不到歸屬，跳過」的條件，
-- 結果實測 93 份套餐全部被跳過、0 份補上。查證後發現：這批套餐絕大多數是「同一批活頁，只是
-- 試卷範本（exam template）不同」而各自一份 material_combinations——這是老師規格裡本來就允許
-- 的正常狀況（套餐＝活頁＋擷取範本＋試卷範本；同一批活頁可以對到很多份試卷範本＝很多份套餐），
-- 不是真的「對不到該歸誰」。用「套餐筆數」判斷歸屬是錯的鑰匙。
--
-- 精準原則要對的鑰匙其實是「這個資料夾＋擷取範本底下的活頁，來源檔名是否只有一種」：
--   - 只有一種來源檔（或全部沒填來源檔）→ 這批活頁本來就是同一批，不管掛在幾份套餐（不同試卷
--     範本）底下，通通都該連到同一批活頁。可以安全補。
--   - 有兩種以上不同來源檔 → 這才是真的對不到「這批活頁該歸哪一份套餐」，不猜、跳過、留給人工核對。
--
-- 實測（2026-09-16）：全庫只有 8 組 (folder, extraction_template) 組合，全部 8 組都只有單一
-- 來源檔、0 組是真正多來源檔、0 組完全沒有活頁。所以這版預期會把全部套餐都補上。

DO $$
DECLARE
  v_combo record;
  v_distinct_src integer;
  v_inserted integer := 0;
  v_combos_touched integer := 0;
  v_skipped_multi_source integer := 0;
  v_skipped_no_sheets integer := 0;
BEGIN
  FOR v_combo IN
    SELECT c.id, c.material_folder_id, c.extraction_template_id, c.label
    FROM public.material_combinations c
  LOOP
    SELECT count(DISTINCT COALESCE(NULLIF(BTRIM(s.source_file_name), ''), E'\\x00NONE'))
    INTO v_distinct_src
    FROM public.material_sheets s
    WHERE s.material_folder_id = v_combo.material_folder_id
      AND s.extraction_template_id = v_combo.extraction_template_id;

    IF v_distinct_src = 0 THEN
      v_skipped_no_sheets := v_skipped_no_sheets + 1;
      CONTINUE;
    ELSIF v_distinct_src > 1 THEN
      -- 這個資料夾＋擷取範本底下的活頁來源檔不只一種，對不到這份套餐該歸哪一批，跳過不猜。
      v_skipped_multi_source := v_skipped_multi_source + 1;
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

  RAISE NOTICE '補完（v2）：% 份套餐補上關聯；% 份套餐因來源檔不只一種而跳過（需人工核對）；% 份套餐底下完全沒有活頁。',
    v_combos_touched, v_skipped_multi_source, v_skipped_no_sheets;
END;
$$;

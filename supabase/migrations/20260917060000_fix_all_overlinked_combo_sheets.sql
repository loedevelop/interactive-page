-- 2026-09-17（修正範圍擴大：20260917020000 誤把「is_group=true」當成豁免條件）
--
-- 查到 20260823220000_combo_default_labels_one_sheet.sql 早就明文訂下資料庫層的鐵律：
-- 「套餐名預設＝活頁名.擷取範本［.試卷範本］。一份套餐一本活頁」，且不分是否勾群組，
-- 一律把 material_combination_sheets 裡 >1 本活頁的套餐拆成多筆各自 1 本活頁的
-- material_combinations（見該檔 rn>1 的搬移邏輯，沒有排除 is_group）。
--
-- 「群組」是顯示層的事：bucketStatsByGroupDisplay 對 is_group=true 的列用
-- ['g', folder, template, source] 當 key，把多筆「各自 1 本活頁」的套餐統計列合併成一張卡
-- （combo.siblingIds 收集這些各自 1 本的 combination_id）。資料庫層 material_combinations
-- 永遠是 1 套餐＝1 活頁，不因為 is_group 就允許多本連一個 combination_id。
--
-- 20260917020000 那版誤把「這份套餐目前連到的活頁裡，有沒有任一本 is_group=true」當成
-- 「這份套餐本來就該連很多本」的豁免條件而跳過——這是錯的，等於放過了另外 88 份也被
-- 20260916020000 誤連到同資料夾＋範本底下所有活頁的套餐（例如 A～Z 那批 *.meta-sentence／
-- *.sentence-translation／*.sentence-fill-in-the-blank，各自都該只連自己那一本）。
--
-- 這次不分 is_group，一律用同一套精準反推（defaultComboLabel 反推：活頁 stem +'.'+ 擷取範本名
-- ［+'.'+ 試卷範本名］是否剛好等於這份套餐現在的 label）修正到只留自己那一本。
-- 永不丟資料：反推對不到任何一本（matched 是空的）就整份跳過、不刪、只警示，留給人工核對。

DO $$
DECLARE
  v_combo record;
  v_link_count integer;
  v_ext_name text;
  v_matched_count integer;
  v_removed integer;
  v_total_removed integer := 0;
  v_total_fixed_combos integer := 0;
  v_unresolved integer := 0;
BEGIN
  FOR v_combo IN
    SELECT c.id, c.label, c.extraction_template_id
    FROM public.material_combinations c
  LOOP
    SELECT count(*) INTO v_link_count
    FROM public.material_combination_sheets cs
    WHERE cs.combination_id = v_combo.id;

    IF v_link_count <= 1 THEN
      CONTINUE;
    END IF;

    SELECT t.name INTO v_ext_name
    FROM public.material_templates t
    WHERE t.id = v_combo.extraction_template_id;

    CREATE TEMP TABLE IF NOT EXISTS tmp_matched_sheet2 (material_sheet_id uuid) ON COMMIT DROP;
    DELETE FROM tmp_matched_sheet2;
    INSERT INTO tmp_matched_sheet2
      SELECT cs.material_sheet_id
      FROM public.material_combination_sheets cs
      JOIN public.material_sheets s ON s.id = cs.material_sheet_id
      WHERE cs.combination_id = v_combo.id
        AND (
          v_combo.label = (s.sheet_stem || '.' || v_ext_name)
          OR EXISTS (
            SELECT 1
            FROM public.material_combination_exam_templates mcet
            JOIN public.material_templates et ON et.id = mcet.exam_template_id
            WHERE mcet.material_combination_id = v_combo.id
              AND v_combo.label = (s.sheet_stem || '.' || v_ext_name || '.' || et.name)
          )
        );

    SELECT count(*) INTO v_matched_count FROM tmp_matched_sheet2;

    IF v_matched_count = 0 THEN
      v_unresolved := v_unresolved + 1;
      RAISE WARNING '套餐 % (label=%) 連到 % 本活頁，但反推不到哪一本對得上這個 label，本次不動，需要人工核對！',
        v_combo.id, v_combo.label, v_link_count;
      CONTINUE;
    END IF;

    DELETE FROM public.material_combination_sheets cs
    WHERE cs.combination_id = v_combo.id
      AND cs.material_sheet_id NOT IN (SELECT material_sheet_id FROM tmp_matched_sheet2);
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    IF v_removed > 0 THEN
      v_total_removed := v_total_removed + v_removed;
      v_total_fixed_combos := v_total_fixed_combos + 1;
      RAISE NOTICE '套餐 % (label=%) 移除 % 筆不屬於自己的活頁連結，剩下 % 筆',
        v_combo.id, v_combo.label, v_removed, v_matched_count;
      PERFORM public.refresh_combo_statistics(v_combo.id);
    END IF;
  END LOOP;

  RAISE NOTICE '修正完成：% 份套餐共移除 % 筆過度連結；% 份套餐反推不到任何活頁對得上（維持現況，需人工核對）。',
    v_total_fixed_combos, v_total_removed, v_unresolved;
END;
$$;

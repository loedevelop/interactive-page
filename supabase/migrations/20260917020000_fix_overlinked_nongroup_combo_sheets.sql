-- 2026-09-17（修正 20260916020000 造成的過度連結）
--
-- 20260916020000 那版回填，只用「這個資料夾＋擷取範本底下的活頁來源檔是否單一」當安全條件，
-- 對「沒勾群組」的套餐（一本活頁一顆套餐，例如 Jessie-vBK-2.vocab-word.vocab-word）沒有另外
-- 限制成只連自己那一本——結果把同資料夾＋範本底下其他不相關的活頁也一起連上了。
-- 勾了群組的套餐（A～Z 那批 *.meta-sentence／*.sentence-translation／*.sentence-fill-in-the-blank）
-- 本來就該連到資料夾底下全部活頁，那批是對的，不受這次影響。
--
-- 精準修正：對「沒勾群組」且目前連結數 >1 的套餐，只留下「這一本活頁的 stem +'.'+ 擷取範本名
-- （+'.'+ 試卷範本名）」剛好等於這份套餐 label 的那一筆（defaultComboLabel 的反推，跟
-- ensureCombination／defaultComboLabel 用同一個組字規則）。
--
-- 永不丟資料原則：反推對不到任何一本（matched 是空的）就整份跳過、不刪、只警示，留給人工核對——
-- 不准因為對不到就把現有連結（可能剛好是對的那一筆）也清空，那樣會製造新的「查無活頁」。

DO $$
DECLARE
  v_combo record;
  v_link_count integer;
  v_is_group boolean;
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

    SELECT bool_or(s.is_group) INTO v_is_group
    FROM public.material_combination_sheets cs
    JOIN public.material_sheets s ON s.id = cs.material_sheet_id
    WHERE cs.combination_id = v_combo.id;

    IF v_is_group IS TRUE THEN
      CONTINUE; -- 勾了群組，本來就該連全部活頁，不動
    END IF;

    SELECT t.name INTO v_ext_name
    FROM public.material_templates t
    WHERE t.id = v_combo.extraction_template_id;

    -- 反推：哪一本活頁的 stem 套進 defaultComboLabel 的組字規則，剛好等於這份套餐現在的 label
    CREATE TEMP TABLE IF NOT EXISTS tmp_matched_sheet (material_sheet_id uuid) ON COMMIT DROP;
    DELETE FROM tmp_matched_sheet;
    INSERT INTO tmp_matched_sheet
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

    SELECT count(*) INTO v_matched_count FROM tmp_matched_sheet;

    IF v_matched_count = 0 THEN
      -- 對不到任何一本，不猜、不刪，留現況給人工核對
      v_unresolved := v_unresolved + 1;
      RAISE WARNING '套餐 % (label=%) 連到 % 本活頁，但反推不到哪一本對得上這個 label，本次不動，需要人工核對！',
        v_combo.id, v_combo.label, v_link_count;
      CONTINUE;
    END IF;

    DELETE FROM public.material_combination_sheets cs
    WHERE cs.combination_id = v_combo.id
      AND cs.material_sheet_id NOT IN (SELECT material_sheet_id FROM tmp_matched_sheet);
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

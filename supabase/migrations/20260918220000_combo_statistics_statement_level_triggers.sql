-- 2026-09-18（雷區修復：GEPT-2 這類「一個資料夾、多種擷取範本、每種 A~Z 26 本活頁」的教材，
-- 存一次檔／回填一次就把 combo_statistics 重算幾十倍，是登入／存檔異常慢的根因之一）。
--
-- 根因：trg_combo_statistics_combination_sheets／trg_combo_statistics_exam_links／
-- trg_combo_statistics_class_links 這三個 trigger 原本是 FOR EACH ROW——同一個動作只要牽涉
-- 好幾列（例如一次補寫 26 本活頁關聯、一次指派 3 個班），就對同一份套餐重算好幾十次，而不是
-- 這個動作完成後只重算一次。GEPT-2 資料夾實測：3 份套餐 × 26 本活頁一次補寫 = 78 次觸發，
-- 應該只要 3 次。
--
-- 修法：三個 trigger 改成 FOR EACH STATEMENT + transition table（REFERENCING OLD TABLE／
-- NEW TABLE），一次 SQL 陳述式（不管牽涉幾列）只收集這次異動涉及的 combination_id，去重後
-- 各自呼叫一次 refresh_combo_statistics。最終算出來的 combo_statistics 內容不變，只是重算
-- 次數從「每列一次」改成「每個陳述式裡的每個不同套餐一次」。
--
-- Postgres 限制：「transition tables cannot be specified for triggers with more than one
-- event」——REFERENCING OLD/NEW TABLE 不能掛在同一個 AFTER INSERT OR UPDATE OR DELETE
-- 的單一 CREATE TRIGGER 上。改成每個事件各自一個 CREATE TRIGGER（INSERT／UPDATE／DELETE
-- 分開），但共用同一個 function，函式內用 TG_OP 判斷這次是哪個事件、只讀該事件真正有的
-- transition table（INSERT 只有 new_tbl；DELETE 只有 old_tbl；UPDATE 兩個都有）。
--
-- 沒有動 refresh_combo_statistics() 本身的邏輯，也沒有動 material_combinations／
-- material_folders／material_templates 這三個 trigger（它們本來就是單列觸發、後果可控，
-- 這次不動，範圍只限老師已核准的三個）。

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_combination_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT DISTINCT combination_id FROM new_tbl WHERE combination_id IS NOT NULL LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN SELECT DISTINCT combination_id FROM old_tbl WHERE combination_id IS NOT NULL LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  ELSE
    FOR r IN
      SELECT DISTINCT combination_id FROM (
        SELECT combination_id FROM old_tbl
        UNION
        SELECT combination_id FROM new_tbl
      ) ids
      WHERE combination_id IS NOT NULL
    LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_exam_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT DISTINCT material_combination_id AS combination_id FROM new_tbl WHERE material_combination_id IS NOT NULL LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN SELECT DISTINCT material_combination_id AS combination_id FROM old_tbl WHERE material_combination_id IS NOT NULL LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  ELSE
    FOR r IN
      SELECT DISTINCT material_combination_id AS combination_id FROM (
        SELECT material_combination_id FROM old_tbl
        UNION
        SELECT material_combination_id FROM new_tbl
      ) ids
      WHERE material_combination_id IS NOT NULL
    LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_combo_statistics_from_class_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT DISTINCT material_combination_id AS combination_id FROM new_tbl WHERE material_combination_id IS NOT NULL LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN SELECT DISTINCT material_combination_id AS combination_id FROM old_tbl WHERE material_combination_id IS NOT NULL LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  ELSE
    FOR r IN
      SELECT DISTINCT material_combination_id AS combination_id FROM (
        SELECT material_combination_id FROM old_tbl
        UNION
        SELECT material_combination_id FROM new_tbl
      ) ids
      WHERE material_combination_id IS NOT NULL
    LOOP
      PERFORM public.refresh_combo_statistics(r.combination_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- material_combination_sheets：三個事件各自一個 trigger，共用上面同一個 function。
DROP TRIGGER IF EXISTS trg_combo_statistics_combination_sheets ON public.material_combination_sheets;
DROP TRIGGER IF EXISTS trg_combo_statistics_combination_sheets_ins ON public.material_combination_sheets;
DROP TRIGGER IF EXISTS trg_combo_statistics_combination_sheets_upd ON public.material_combination_sheets;
DROP TRIGGER IF EXISTS trg_combo_statistics_combination_sheets_del ON public.material_combination_sheets;

CREATE TRIGGER trg_combo_statistics_combination_sheets_ins
  AFTER INSERT ON public.material_combination_sheets
  REFERENCING NEW TABLE AS new_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_combination_sheet();

CREATE TRIGGER trg_combo_statistics_combination_sheets_upd
  AFTER UPDATE ON public.material_combination_sheets
  REFERENCING OLD TABLE AS old_tbl NEW TABLE AS new_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_combination_sheet();

CREATE TRIGGER trg_combo_statistics_combination_sheets_del
  AFTER DELETE ON public.material_combination_sheets
  REFERENCING OLD TABLE AS old_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_combination_sheet();

-- material_combination_exam_templates
DROP TRIGGER IF EXISTS trg_combo_statistics_exam_links ON public.material_combination_exam_templates;
DROP TRIGGER IF EXISTS trg_combo_statistics_exam_links_ins ON public.material_combination_exam_templates;
DROP TRIGGER IF EXISTS trg_combo_statistics_exam_links_upd ON public.material_combination_exam_templates;
DROP TRIGGER IF EXISTS trg_combo_statistics_exam_links_del ON public.material_combination_exam_templates;

CREATE TRIGGER trg_combo_statistics_exam_links_ins
  AFTER INSERT ON public.material_combination_exam_templates
  REFERENCING NEW TABLE AS new_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_exam_link();

CREATE TRIGGER trg_combo_statistics_exam_links_upd
  AFTER UPDATE ON public.material_combination_exam_templates
  REFERENCING OLD TABLE AS old_tbl NEW TABLE AS new_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_exam_link();

CREATE TRIGGER trg_combo_statistics_exam_links_del
  AFTER DELETE ON public.material_combination_exam_templates
  REFERENCING OLD TABLE AS old_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_exam_link();

-- class_material_combinations
DROP TRIGGER IF EXISTS trg_combo_statistics_class_links ON public.class_material_combinations;
DROP TRIGGER IF EXISTS trg_combo_statistics_class_links_ins ON public.class_material_combinations;
DROP TRIGGER IF EXISTS trg_combo_statistics_class_links_upd ON public.class_material_combinations;
DROP TRIGGER IF EXISTS trg_combo_statistics_class_links_del ON public.class_material_combinations;

CREATE TRIGGER trg_combo_statistics_class_links_ins
  AFTER INSERT ON public.class_material_combinations
  REFERENCING NEW TABLE AS new_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_class_link();

CREATE TRIGGER trg_combo_statistics_class_links_upd
  AFTER UPDATE ON public.class_material_combinations
  REFERENCING OLD TABLE AS old_tbl NEW TABLE AS new_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_class_link();

CREATE TRIGGER trg_combo_statistics_class_links_del
  AFTER DELETE ON public.class_material_combinations
  REFERENCING OLD TABLE AS old_tbl
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_combo_statistics_from_class_link();

COMMENT ON FUNCTION public.trg_combo_statistics_from_combination_sheet() IS
  '2026-09-18 改 statement-level：同一個陳述式不管改幾列，每個不同套餐只重算一次，不再每列各重算一次。INSERT/UPDATE/DELETE 各自一個 trigger（Postgres 不允許多事件共用 transition table），共用這支函式，內部依 TG_OP 只讀該事件實際存在的 transition table。';
COMMENT ON FUNCTION public.trg_combo_statistics_from_exam_link() IS
  '2026-09-18 改 statement-level：同上，避免一次寫入多筆試卷範本配對時重算好幾次。';
COMMENT ON FUNCTION public.trg_combo_statistics_from_class_link() IS
  '2026-09-18 改 statement-level：同上，避免一次指派多個班級時重算好幾次。';

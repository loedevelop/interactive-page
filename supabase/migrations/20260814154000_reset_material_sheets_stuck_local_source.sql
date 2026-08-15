-- 清空已經卡住的「本機 Excel」來源標記（老師回報「畫面老是卡在本機 Excel，清空清空都沒用」）。
--
-- 根因：110_teacher_core/feature-material-layout-pairing.js 的「產生 meta / script 並上傳」
-- 成功後會自動記錄配對紀錄，但先前漏了把 source_kind／source_file_name 一併改成 'drive'——
-- 檔案明明真的上傳到 Drive 了，紀錄卻永遠標成「本機」來源，導致每次重新整理都被打回
-- 「🖥️ 改用本機 Excel」模式、卡著舊檔名（例如 GEPT-2.xlsx）。前端邏輯已在同一輪修正
-- （上傳成功後強制寫回 source_kind='drive'），這裡只是把「已經卡住」的既有資料一次性清掉，
-- 讓已上傳成功的活頁（有 layout_template_id，代表已經解析出對應 Layout，不是空殼佔位列）
-- 恢復成乾淨的 Drive 來源狀態。

UPDATE public.material_sheets
SET
  source_kind = 'drive',
  source_file_name = NULL,
  updated_at = now()
WHERE source_kind = 'local'
  AND layout_template_id IS NOT NULL;

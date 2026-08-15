-- 修正上一版「修正」（20260814151500）造成的新回歸問題。
--
-- 20260814151500 把 sheet_stem 的 ".<layout 名稱>" 尾碼當成舊資料瑕疵剝除（例如
-- "A.sentance-meta" → "A"），理由是「現在有 layout_template_id 這個 FK 了，不需要再靠
-- 字串尾碼記住 layout」——這個理由只對「資料庫內部怎麼存」成立，但完全忽略了
-- feature-material-layout-pairing.js 既有、本次沒有改動的「已配對好的 meta + layout 組合」
-- 卡片（renderOverviewAppsHtml）：那段邏輯至今仍是把 sheet_ids 的字串，直接跟 Drive 上
-- 真實檔名（activity.meta-sentence.meta.json 這種「活頁名.Layout 名」規則，見程式裡
-- 2026-08-13 的「v51 起實際上傳的檔名已經變成」註解）逐字比對，不是透過 FK。
--
-- 結果：20260814151500 把 sheet_stem 剝成純活頁名後，這批活頁在畫面上全部被判定成
-- 「Drive 找不到對應 meta.json」而標成紅色⚠️過期警示（2026-08-14 老師回報並附截圖，
-- 截圖裡「🔍依檔名推斷」那些列——直接掃描 Drive 真實檔名長出來的——證實真正檔名
-- 確實是「活頁名.meta-sentence」，不是純活頁名）。
--
-- 這裡把尾碼加回來，用「目前存的 layout_template_id 所指向的 Template 現在的名稱」
-- 組回 sheet_stem（不是用舊快取的 template_name 字串，因為 Template 可能改名過，
-- 現在 Drive 上的真檔名是用改名後的新名稱產生的，這也是截圖證實的那個名稱）。
-- 只處理「目前 sheet_stem 還不含任何句點、且有解析出 layout_template_id」的列，
-- 不會動到本來就是完整字串（例如另一個資料夾的 "AvaLiu-vBK-2.vocab-word"）的資料。

UPDATE public.material_sheets ms
SET
  sheet_stem = ms.sheet_stem || '.' || mlt.name,
  updated_at = now()
FROM public.material_layout_templates mlt
WHERE ms.layout_template_id = mlt.id
  AND ms.sheet_stem !~ '\.'
  AND mlt.name IS NOT NULL
  AND trim(mlt.name) <> '';

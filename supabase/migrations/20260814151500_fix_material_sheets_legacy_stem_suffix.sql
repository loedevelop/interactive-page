-- 修正上一版 backfill（20260814150000）把 sheet_stem 誤帶入舊 template_name 尾碼的問題。
--
-- 根因：profiles.raw_data.material_template_applications[].sheet_ids 舊資料本身就存了
-- 像 "A.sentance-meta"（而不是純活頁名 "A"）——這是舊版 inferredAppsFromMetaCatalog 解析
-- Drive meta 檔名（sheetName.layoutName.meta.json）時，只切掉 ".meta.json"，把
-- ".layoutName" 一併留在 stem 裡造成的舊資料瑕疵。backfill 當時忠實搬遷了這個瑕疵。
-- 現在 layout_template_id 已經是正規化 FK（本例透過 template_id 對到，即使 Template
-- 後來被改名為「meta-sentence」也對得到），不再需要靠字串尾碼記住 layout 名稱，
-- 故把這段誤帶入的尾碼從 sheet_stem 剝除，還原成單純的活頁名（如 "A"）。
--
-- 只精準比對「sheet_stem 結尾＝ '.' + 該筆舊 application 記錄的 template_name」才動，
-- 不影響其他正常資料。

WITH apps AS (
  SELECT
    p.id AS teacher_id,
    COALESCE(NULLIF(elem->>'root_kind', ''), 'teacher') AS root_kind,
    NULLIF(elem->>'class_id', '')::uuid AS class_id,
    trim(elem->>'material_folder') AS folder_name,
    NULLIF(elem->>'template_name', '') AS legacy_template_name,
    elem AS raw_elem
  FROM public.profiles p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.raw_data->'material_template_applications') = 'array'
      THEN p.raw_data->'material_template_applications'
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE trim(coalesce(elem->>'material_folder', '')) <> ''
    AND NULLIF(elem->>'template_name', '') IS NOT NULL
),
bad_sheets AS (
  SELECT DISTINCT
    a.teacher_id, a.root_kind, a.class_id, a.folder_name, a.legacy_template_name,
    sheet_txt AS raw_sheet_id
  FROM apps a
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(a.raw_elem->'sheet_ids') = 'array'
      THEN a.raw_elem->'sheet_ids'
      ELSE '[]'::jsonb
    END
  ) AS sheet_txt
  WHERE right(sheet_txt, length(a.legacy_template_name) + 1) = '.' || a.legacy_template_name
)
UPDATE public.material_sheets ms
SET
  sheet_stem = left(bs.raw_sheet_id, length(bs.raw_sheet_id) - length(bs.legacy_template_name) - 1),
  updated_at = now()
FROM bad_sheets bs
JOIN public.material_folders mf
  ON mf.teacher_id = bs.teacher_id
  AND mf.root_kind = bs.root_kind
  AND (mf.class_id = bs.class_id OR (mf.class_id IS NULL AND bs.class_id IS NULL))
  AND upper(mf.folder_name) = upper(bs.folder_name)
WHERE ms.material_folder_id = mf.id
  AND upper(ms.sheet_stem) = upper(bs.raw_sheet_id);

-- 老師確認：6 個從 LAYOUT_CATALOG backfill 出來的內建考卷範本（sentence-translate-4col／
-- sentence-cloze-4col／gept-translate-5col／vocab-no-image／vocab-with-image／v2-extended）
-- 目前沒有任何現行 exam_job.layout_profile_id／sections[].layout_profile_id 在使用
-- （唯一一筆歷史 quiz_paper 快取用過 sentence-translate-4col，但其即時設定已改成
-- tpl:{擷取範本id}，且該快取排版公式已烘焙進 quiz_paper JSON，不受這裡影響）。
--
-- 軟刪除（跟編輯器「🗑️ 刪除」按鈕同做法）：保留歷史稽核紀錄，但不再出現在清單／出題下拉。
UPDATE public.material_exam_templates
SET deleted_at = now(), updated_at = now()
WHERE is_builtin_seed = true
  AND deleted_at IS NULL
  AND legacy_profile_id IN (
    'sentence-translate-4col',
    'sentence-cloze-4col',
    'gept-translate-5col',
    'vocab-no-image',
    'vocab-with-image',
    'v2-extended'
  );

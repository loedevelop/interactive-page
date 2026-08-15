-- 修正上一版 backfill（20260814150000）讀錯 JSON 鍵名的問題。
--
-- profiles.raw_data.material_field_templates[] 實際存的是 snake_case
-- （answer_mode／answer_combine_note／speak_mode／speak_formula——跟畫面上儲存的
-- record 欄位一致，見 feature-material-layout-pairing.js handleSaveTemplateFromEditor），
-- 但上一版 backfill 誤寫成 camelCase（answerMode／speakMode／speakFormula，那其實是
-- Template 編輯器「記憶體中」的欄位名，不是存進 JSON 之後的鍵名），導致這四欄全部背
-- backfill 成 null。這裡用正確鍵名重新回填，只補這幾欄，不動其他已經正確的欄位。

WITH src AS (
  SELECT
    p.id AS teacher_id,
    NULLIF(elem->>'id', '') AS legacy_id,
    NULLIF(elem->>'answer_mode', '') AS answer_mode,
    NULLIF(elem->>'answer_combine_note', '') AS answer_combine_note,
    NULLIF(elem->>'speak_mode', '') AS speak_mode,
    NULLIF(elem->>'speak_formula', '') AS speak_formula
  FROM public.profiles p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.raw_data->'material_field_templates') = 'array'
      THEN p.raw_data->'material_field_templates'
      ELSE '[]'::jsonb
    END
  ) AS elem
  WHERE NULLIF(elem->>'id', '') IS NOT NULL
)
UPDATE public.material_layout_templates mlt
SET
  answer_mode = COALESCE(src.answer_mode, mlt.answer_mode),
  answer_combine_note = COALESCE(src.answer_combine_note, mlt.answer_combine_note),
  speak_mode = COALESCE(src.speak_mode, mlt.speak_mode),
  speak_formula = COALESCE(src.speak_formula, mlt.speak_formula),
  updated_at = now()
FROM src
WHERE mlt.teacher_id = src.teacher_id
  AND mlt.legacy_id = src.legacy_id;

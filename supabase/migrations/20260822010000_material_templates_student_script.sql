-- 擷取範本「學生文稿 特殊排版」：跟訊息／題目同一套公式欄，老師自己編輯。
-- 預設空字串；前端沒填時套 _answer_combined_text（書寫答案結合結果）。

ALTER TABLE public.material_templates
  ADD COLUMN IF NOT EXISTS student_script text NOT NULL DEFAULT '';

# 🚀 [LogOn Web 系統開發交接文檔 - Task: 自建後端 AI 批改大腦 (Backend AI Pipeline)]

## 👨‍💻 你的角色與行為準則 (Persona & Directives)
請你扮演一位具備「軟體工匠精神 (Software Craftsmanship)」的 Modern SaaS 全端架構師與後端工程師。
1. **絕對完整 (Zero-Placeholder Rule)：** 每次提供程式碼時，必須給出 **100% 完整、無省略、可直接複製貼上覆蓋原檔** 的程式碼。絕對禁止使用 `// ... remaining code` 等偷懶佔位符。**絕對禁止隨意刪減原有程式內容，禁止進行自以為是的優化！**
2. **精準快取破除與入口檔連動 (Cache Busting & Index Sync)：** 若動到前端 `110_teacher_core` 內的任何程式，必須一併附上完整的 `teacher/index.html`，並將對應 `<script>` 的 `?v=` 版本號 +1。動到 `120_student_core` 同理更新 `student/index.html`。
3. **自動 GitHub 推播指令 (Auto Git Push)：** 在每次輸出完所有程式碼後，必須在回覆的最末端，自動附上 VS Code terminal 可用的 GitHub 推播指令碼 (`git add .`, `git commit -m "..."`, `git push`)。
4. **排版鐵律：** 輸出長篇 Markdown 文件或 JSON 時，若有內嵌 Code Block，外層請強制使用四個反引號 ` ```` ` 封裝，絕對避免因內部範例導致排版崩潰。
5. **嚴格 Git 操作限制： git add 後面絕對禁止加上檔案名稱！！！
6. **高效推進原則： 禁止鬼打牆，禁止重複抓著一個已處理過的舊問題不放！！！！！
7. **程式與文件封裝： 所有的程式及文件，都要放在 Code Block 裡面給我，確保可以直接全選與複製。

---

## 🏗️ 專案總覽與底層鐵律 (Project Overview & Iron Rules)
本專案為 **LogOn Web 多模態 AI 自適應學習系統**，採用 `Vanilla JS (前端) ↔ Supabase (資料庫/Auth/Webhooks) ↔ 自有獨立後端 API` 的架構。

**三大資料庫鐵律：**
1. **情境身分制 & RLS：** 廢除全域布林值判定，全面依賴 `class_staff` 表的 `staff_role` 進行權限閘門管控。
2. **軟刪除 & RPC：** 絕對禁止物理刪除。刪除動作必須寫入 `deleted_at`。讀取必加 `.is('deleted_at', null)`。
3. **JSONB (`raw_data`) 無限擴充制：** 所有未知欄位、客製設定、AI 非結構化回傳值 (`ai_evaluation`)，一律寫入 `raw_data` JSONB 中。

---

## 📍 近期已完成里程碑 (Frontend is Ready)
前端「批改中樞 (Gradebook)」與「出作業端 (Assignment Builder)」皆已開發完畢並完美解耦：
1. **出作業端 (Builder) AI 雙開關防呆機制：** 已在 UI 與 Store 中，針對錄音作業加入「AI 語音批改 (預設 true)」與「AI 文法糾正 (預設 false)」開關，設定已成功寫入 `task.raw_data`。
2. **教師批改中樞 (Gradebook) UI 革命：** 實作核彈級空間壓縮的三明治 UI、歷史紀錄懸浮選單。
3. **AI 渲染與一鍵採用：** 已實裝動態的 AI 綜合評語與文法糾正紫底面板，支援「一鍵採用 AI 評語」無縫寫入輸入框與 Store 存回資料庫。

---

## 🚀 當前焦點戰線 (Current Mission: Route B - Backend AI Pipeline)
我們現在要進入 **「路線 B：後端 AI 自動化批改閉環 (Backend AI Pipeline)」**。我們要開發一支名為 **`ai-grade-audio`** 的後端 API。

**⚠️ 重大架構轉向 (Architecture Pivot) - 必讀：**
1. **捨棄 Supabase Edge Functions**：使用者的 API 與金鑰皆統一管理在專案的「上一層資料夾」中（自有伺服器 / Local 環境）。因此我們**不使用** Edge Functions，轉而要在使用者自有的後端環境實作這支接收 Webhook 的 API。
2. **Google Drive 私有權限對接 (The 403 Problem)**：學生的音檔存放在系統自動建立的 Drive 資料夾中，且**並未對外公開**。後端程式必須利用 **Google Service Account (服務帳戶 JSON 金鑰)** 進行 OAuth 驗證，才能成功將私有音檔下載回來交給 Gemini 處理。
3. **動態 Prompt 與計分鐵律**：
   * **發音分數**：採絕對扣分制 (100 - 錯字數，由 API 程式計算，不讓 AI 算數學)。
   * **流暢度分數**：採明確的溝通困難度四級量表 (90/80/70/60) 強制給分。
   * **動態文稿**：若作業沒附上 `original_script`，AI 必須改為先聽寫 (Transcribe) 再評估。
   * **客製化偏好**：支援將老師的「口音標準（如美式）」與「音標格式（如 KK/Phonics）」動態寫入 Prompt。
4. **強型別 JSON 合約 (Structured Outputs)**：強制 Gemini 使用 `response_schema` 吐出包含 `pronunciation_score`, `fluency_score`, `comprehensive_feedback`, `word_errors`, `grammar_corrections` 的嚴格 JSON 格式，然後透過 Service Role Key 寫回 Supabase 的 `raw_data.ai_evaluation`。

---

## 🎯 接手後的第一步指示 (Action Items)
請你閱讀完上述所有資訊後，**不要急著寫程式碼**，請回覆以下內容：
1. 簡短確認你已完全理解目前的架構轉向（不使用 Edge Functions，改用 Local API）、Google Drive 私有下載限制，以及「四大絕對守則」。
2. 針對接下來要開發的 `ai-grade-audio` API，主動向我（使用者）提問：
   * **API 伺服器語言與框架：** 請詢問我上一層資料夾的 API 伺服器是用什麼語言寫的？（例如：Node.js + Express，還是 Python + FastAPI / Flask？）
   * **Google Drive 授權：** 請確認我是否了解如何申請 GCP 的 Google Service Account JSON 憑證，並將其放入伺服器中？
3. 進入 Standby 狀態，等待我回答後端的語言環境後，再開始產出對應的後端程式碼。








🚀 系統開發交接規格書 (Handoff Prompt)
專案: LogOnEnglish SaaS 老師控制台 - 錄音作業 (Audio Record) 編輯器模組
當前狀態: 需重構 UI 介面選項與底層 JSONB 狀態綁定，徹底對齊「Drive/Local 雙軌支援 PDF & Excel」邏輯，並新增 AI 雙重評分機制。

🎯 核心需求 1：AI 雙重評分與回饋機制 (Backend / Prompting 預備)
當學生繳交錄音檔後，AI 批改引擎必須同時輸出以下兩種評分與說明：

扣分制評分 (Rule-based Deduction): 依據原先設定的嚴格扣分標準（例如發音錯誤扣幾分、遺漏字扣幾分）進行計算。

AI 總體給分 (Holistic AI Score): AI 基於語調、流暢度、文法綜合評估出的獨立分數。

詳細回饋 (Reasoning Feedback): AI 必須強制輸出「給分原因」與「具體扣分原因」的文字說明。
(註：前端介面需保留對應的開關 use_ai_grading 與 use_ai_grammar，後端 Prompt 需依此規則改寫。)

🎯 核心需求 2：批改文稿區塊 (AI 評分基準 / The Golden Anchor)
此區塊的用途是產生 100% 純淨的文字 (original_script) 供 AI 比對。
UI 需提供一個下拉選單 (Source Type)，包含以下三個選項：

選項 A：貼上文字 (Text)

UI 呈現： 僅顯示純文字輸入框 (Textarea)。

選項 B：Drive 連結萃取 (Drive)

邏輯： 必須同時相容 PDF 與 Excel 網址。

UI 呈現：

欄位 1：Drive 網址輸入框 (URL)。

欄位 2：工作表/活頁 (Sheet) - 若為 Excel 則填寫，PDF 則忽略。

欄位 3：指定範圍 (Range) - Excel 填 A1:B20，PDF 填 pp.3~4。

按鈕：[執行萃取] (呼叫 GAS API，回傳文字至 Textarea)。

選項 C：Local 本機檔案 (Local)

邏輯： 必須同時支援上傳 PDF (.pdf) 與 Excel (.xlsx, .csv)。

UI 呈現：

欄位 1：選擇檔案按鈕 (File Input)。

欄位 2：工作表/活頁 (Sheet) - 若上傳 Excel 則填寫。

欄位 3：指定範圍 (Range) - 若上傳 Excel 則填寫。

按鈕：[執行萃取] (前端利用 PDF.js 或 SheetJS 進行本地解析，回傳文字至 Textarea)。

🎯 核心需求 3：學生端文稿區塊 (錄音視覺教材)
此區塊的用途是提供學生在錄音時觀看的畫面。
UI 需提供一個下拉選單 (Source Type)，包含以下三個選項（文字標籤需與截圖完全一致）：

選項 A：貼上文字

UI 呈現： 僅顯示純文字輸入框 (Textarea)。

選項 B：Drive 連結 / 雲端

邏輯： 必須同時支援 PDF 與 Excel。

UI 呈現：

欄位 1：Drive 網址輸入框 (URL)。

欄位 2：指定範圍/說明 (Range/Description)。

下拉選單：[📚 從資源庫選擇] (連動班級/全域資源)。

選項 C：Local 本機檔案

邏輯： 必須同時支援 PDF 與 Excel。

UI 呈現：

欄位 1：選擇檔案按鈕 (File Input)。

欄位 2：指定範圍/說明 (Range/Description)。

(註：此區塊的檔案最終需透過後端機制上傳至雲端並轉為視覺 URL 供學生讀取)。

🎯 核心需求 4：資料結構綁定 (Store Layer)
store-assignment-builder.js 必須嚴格同步上述所有欄位至 bState.tasks[x].raw_data 的 JSONB 結構中，不允許任何欄位遺漏。必須涵蓋：

AI 開關狀態 (use_ai_grading, use_ai_grammar)

AI 來源狀態 (ai_source_type, ai_drive_url, ai_sheet, ai_range, ai_local_file_name...)

最終純淨文稿 (original_script - 需經過無情淨化引擎清洗)

學生來源狀態 (student_source_type, student_drive_url, student_range, student_text...)

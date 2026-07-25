# 📘 LogOn Web 終極系統架構與工程規範白皮書 (Architecture Blueprint)
*(Timestamp: 2026-07-25 12:00:00 CST)*
*(Document Status: Finalized | Architecture: JSONB-Driven Array V2 & AI Pipeline)*

## 🎯 壹、 總綱與計畫核心願景 (The Vision)
建立一套從 「教師產出純淨文稿」 ➡️ 「學生防斷線與防跑版錄音」 ➡️ 「Webhook 靜默觸發 Edge Function」 ➡️ 「Gemini 多模態強制對齊分析」 ➡️ 「Gradebook 極限空間壓縮與瞬間對齊紅黑字」 的零人工介入自動化大閉環。
系統架構將從傳統的「絕對/全域身分制」升級為高彈性的**「情境身分制 (Contextual Multi-Persona)」**，並強制導入**「軟刪除 (Soft Deletes)」、「RPC 原子化寫入 (Atomic RPC)」、「JSONB 動態擴充」與「網頁端背景同步 (Web Sync Queue)」**四大標準。

## 🗄️ 貳、 資料庫單元化與 JSONB 歷史追蹤 (DB Schema & Versioning Strategy)
為避免物理 INSERT 造成資料庫膨脹，全面轉向 「單筆紀錄 + JSONB 陣列溯源」 策略。

1. **確立標準父節點 (The Golden Anchor)：**
   * 當教師在 assignments 內建立 audio_record 任務時，強制寫入 original_script (標準文稿)。
   * 此文稿為該單元唯一真理。AI 的強制對齊與前端紅黑字渲染，絕對只能基於這段字串進行。
2. **單一更新與 JSONB 歷史疊代 (History Array)：**
   * 學生針對同一個 Task ID 無論繳交幾次，task_completions 永遠只維持一筆紀錄 (UPDATE 絕不 INSERT)。
   * 每次重新繳交或教師發布成績時，舊成績、AI 評估與評語會打包成 Object，推入 raw_data.grading_history 陣列中。

## 👨‍🏫 參、 教師端：標準派發、文稿淨化與客製化設定 (Teacher Pipeline)
1. **教師專屬評估偏好 (Teacher Preferences)：**
   * 目標口音標準：允許教師設定批改基準（預設：美式英文 / 可自訂英式或其他）。
   * 音標顯示格式：允許教師設定介面顯示的音標系統（KK, IPA, 或自然發音 Phonics）。
2. **編輯器 UI 擴充與多源文稿匯入引擎：** 
   * 實作 GAS 試算表引擎，支援自 Google Sheets / Excel 指定範圍精準匯入純淨文字。保留「快速匯入 PDF 取字」按鈕，但強制掛載「⚠️ 萃取後請務必人工核對與清除亂碼」警告。

## 📱 肆、 學生端：防斷線錄音艙與離線防護佇列 (Student Studio & Offline Defense)
1. **真・懸浮面板與光學反追蹤引擎 (60fps VisualViewport Tracker)：** 
   * **終極解法：** 改用每秒 60 幀的 `VisualViewport API` 逆向追蹤。偵測到縮放 (`scale > 1.01`) 時，執行反向縮小、精準實體座標定位、暴力拋錨（斷開原生 CSS 鎖鏈），永遠死釘在螢幕最下方。
   * **💣 絕對不能踩的雷區：** 嚴禁依賴純 CSS (`position: fixed`) 定位、嚴禁依賴 Meta 鎖定、嚴禁刪除數學跟蹤公式。
2. **真正前端轉碼器 (Native WAV Encoder)：**
   * **正面對決 WebM：** 針對 Chrome 錄出來缺乏 Metadata 的 WebM，透過前端 C++ `AudioContext` 實時轉碼為「16kHz 單聲道標準 WAV 格式」。確保所有播放器與 Google Drive 都能抓到長度，實現 100% 完美的進度條拉動與切片定位。
3. **Iframe 跨域登入牆防禦機制 (Zero-Trust Iframe Rendering)：**
   * 接收 Google Drive 網址時，**絕對禁止直接使用或簡單 replace**。必須透過正則表達式精準提煉出唯一的 `File ID`，重組為純淨的預覽格式：`https://drive.google.com/file/d/{File_ID}/preview`。嚴禁殘留 Hash 標籤 (`#`)。

## ☁️ 伍、 雲端隔離儲存與中轉引擎 (Cloud Storage & GAS Middleware)
1. **安全上傳通道：** 前端將 Blob 轉 Base64 送給 GAS，GAS 解析 student_drive_folder_id 存入學生專屬資料夾。
2. **絕對檔名正規化：** 強制命名為 {ClassID}_{StudentID}_{TaskID}_{Timestamp}.wav。
3. **🛡️ 極限 MIME Type 裝甲：** 攔截 `.pdf`，若偵測到空值或 `text/plain`，一律鎖死為 `application/pdf`，根絕 Drive 誤判 TXT 災難。

## 🤖 陸、 邊緣運算與 Gemini AI 批改大腦 (Supabase Webhooks & Edge Functions)
1. **防彈 RPC 發射器 (Atomic Operations)：** 呼叫 `supabase.rpc('submit_audio_task_atomic')` 實現防併發寫入，瞬間將 `status` 改為 `ai_processing` 扣下扳機。**必須精準對齊內部混血型別 (BIGINT 與 UUID)**。
2. **Webhook 靜默觸發：** 監聽器偵測到 status === 'ai_processing' 自動觸發 Edge Function。(已透過 SQL 建立 `http_request` 觸發器修復官方 Bug)。
3. **強型別 JSON 合約 (Strict Data Contract)：** 全面導入 Gemini 1.5 `responseSchema` 強制鎖死輸出神經元，確保 100% 純淨 JSON。使用 Deno 原生 `encode` 處理 Base64 轉換避免記憶體溢出。

## 📈 柒、 教師批改艙：極限空間壓縮與無佔位視覺化 (The Ultra-Compact Gradebook)
1. **核彈級空間壓縮：** 廢除巨大 AI 分數卡，與音檔控制列合併為頂部 Sticky 導覽列。
2. **字音互動與 Click-Outside 防呆：** 點擊波浪線跳轉音檔，全域 Click-Outside 確保氣泡瞬間關閉。
3. **智慧評語詞庫 (Feedback Phrase Bank)：** 透過 Selection API 瞬間安插句子至輸入框游標處，達成「套用、客製、自製」。

## 🛡️ 捌、 歷史雷區與系統開發 AI 協作鐵律 (The Minefields & Directives)
為了防止 AI 或開發者在協助開發時引發不可預期的災難，確立以下不可逾越的鐵律：

1. **混血型別地雷 (Mixed-Type DB Schema)：** 
   系統中存在混血型別（例如 `assignments.id` 為 `BIGINT`，但 `classes.id` 為 `UUID`）。撰寫 SQL 函數或 RPC 時，接收變數必須嚴格區分與對齊，內部主鍵變數必須使用 `%TYPE`（如 `task_completions.id%TYPE`）自動綁定，**絕對禁止自作聰明盲目推測統一型別**。
2. **🚫 絕對禁止「自作聰明的優化」(The Zero-Tampering Rule)：**
   * **鐵律：禁止去動不需動的地方！**
   * 只要不是明確要求修改的功能、變數或區塊，**絕對禁止**以「優化、整理、重構」為由，隨意更動、刪減或調整原有的程式碼、業務邏輯，甚至特殊的空白字元與排版。確保每次輸出的程式碼都能 **100% 無損覆蓋**原檔。
3. **🚫 AI 介面 LaTeX 渲染災難 (The UI OR-Operator Bug) —— 終極免疫指令：**
   * **歷史血淚：** AI 聊天介面的底層 Markdown/LaTeX 渲染引擎，會自作聰明將 JavaScript 中的雙直豎線 (OR 運算子 `||`) 強制轉譯為 `\vert{}\vert{}` 絕對值符號，導致引發 `Uncaught SyntaxError` 模組死當。
   * **防禦標準：** 在撰寫或修改 UI 模板字串、事件綁定或純字串拼接時，**嚴格禁止使用雙直豎線 (||) 作預設值判定或正則表達式。** 必須全面改用「三元運算子 (`A ? A : B`)」、「`if/else` 條件式」，物理性消滅該符號。
4. **🚫 絕對完整輸出 (Zero-Placeholder Rule)：**
   * 每次提供程式碼或文件時，必須給出 **100% 完整、無省略** 的內容。
   * 嚴禁使用 `// ... remaining code` 等偷懶佔位符。
5. **🚫 狀態同步優先級 (Source of Truth Priority)：**
   * UI 渲染批改報告與分數前，**必須嚴格判斷 `status` 欄位**。若狀態為 `ai_error`, `failed`, `submitted`, `ai_processing` 等非完成狀態，絕對不准渲染 `raw_data.ai_evaluation` 內的舊成績假資料。

## 📝 玖、 待辦任務 (Next Action Items)
* **📍 戰線 A：打通 AI 批改後端閉環** (Edge Function 解析 16kHz WAV 並強制對齊 Gemini JSON 輸出)。
* **📍 戰線 B：導入 IndexedDB 離線防護佇列** (實作斷線暫存與背景自動重試上傳機制)。
# Handoff Prompt（2026-08-12 20:48）

> 貼到新對話開頭用。這份文件是給下一個 agent session 看的背景交接，不是給老師（使用者）看的說明文件。

## 0. 你是誰、專案是什麼

這是「PDF 處理工具箱 / interactive-page」——一個給老師出作業、學生寫作業（錄音、上傳檔案、線上考試）的網頁系統。前端純 JS（無框架），後端 Supabase（Postgres + RPC + Edge Functions）＋ Google Apps Script（GAS，代理 Google Drive 讀寫）。

- 老師頁：`teacher/index.html` + `110_teacher_core/*.js`
- 學生頁：`student/index.html` + `120_student_core/*.js`
- 共用：`020_js_core/*.js`
- GAS 後端：`gas/Code.gs`（部署為 Web App，前端用 `fetch(GAS_WEB_APP_URL)` 呼叫）
- 本機測試：`python3 -m http.server 8765`，開 `http://localhost:8765/teacher/index.html` 或 `/student/index.html`

**務必先讀** `.cursor/rules/*.mdc`（尤其 `drive-folder-upload-invariants.mdc`、`material-snapshot-refs-invariant.mdc`、`exam-available-count-invariant.mdc`、`assignment-id-uuid-invariant.mdc`、`ai-grading-pipeline-invariants.mdc`、`page-refresh-perf-invariant.mdc`、`modal-overlay-tiers.mdc`）。這些是「反覆踩過的坑」，改對應區域前必看，改完後要能通過裡面列的「實測」清單。

## 1. 目前最緊急、老師正在等的事

老師剛才在測「教材/Layout 搭配」頁的「確認上傳到 Drive」，遇到：

```
❌ 上傳失敗：Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

**根因**：`110_teacher_core/api-gas-service.js` 裡有一半函式（含造成這次錯誤的 `uploadMaterialFile`）是各自 `fetch(...).then(r=>r.json())`，GAS 若回傳 HTML（部署過期／權限跑掉／暫時性錯誤頁）就會噴出這種看不懂的原生 JS 錯誤，而不是有意義的訊息。

**已完成的修正**：把 `api-gas-service.js` 全部函式改走既有的共用 `postGasJson()`（它會先讀文字、判斷是不是 HTML，給出「請重新部署 GAS」等明確訊息）。已 bump `teacher/index.html` 的 `api-gas-service.js?v=64`。**尚未 commit。**

**老師接下來要做、但還沒回報結果的事**：
1. 依 `.cursor/rules/drive-folder-upload-invariants.mdc` 底部「改完 Code.gs 後：必須重新部署 GAS」的步驟，把最新 `gas/Code.gs`（已含 `delete_material_stem` action，見下方 §3）貼到 script.google.com 的 GAS 專案、存檔、部署新版本。
2. 重新整理老師頁面（拿到 `api-gas-service.js?v=64`）。
3. 再測一次「確認上傳到 Drive」，回報新的錯誤訊息（如果還有）或是否成功。

**下一個 session 一進來，如果使用者說「還是失敗」，先問清楚新的錯誤文字是什麼**，多半會是 postGasJson 給的其中一種明確訊息（doGet 健康檢查／HTML／找不到網頁），照訊息內容指路即可，不要再猜。

## 2. 尚未 commit 的變更（git status，2026-08-12 20:48）

```
 M 110_teacher_core/api-gas-service.js         ← 見 §1，全面改走 postGasJson
 M 110_teacher_core/feature-material-layout-pairing.js  ← 見 §3
 M 110_teacher_core/feature-timeline.js        ← 見 §3（removeMetaCatalogFileOption）
 M gas/Code.gs                                  ← 見 §3（deleteMaterialStateFiles + doPost 分支）
 M teacher/index.html                           ← 版本戳記 bump
```

另外還有一堆**更早、跟本輪 session 無關**的未 commit 變更（.cursor/rules 新檔、supabase migrations、student/index.html 等），是之前的工作留下的，不要誤刪，也不要跟本輪工作混在一起 commit（除非使用者要求把全部一起 commit）。

## 3.「教材/Layout 搭配」頁最新架構（本輪剛做完）

這是這幾天工作量最大的一塊，很容易搞混，仔細讀：

### 3.1 頁面最上方新增「📊 總覽」卡片
`renderOverviewHtml`（在 `feature-material-layout-pairing.js`）畫三張卡：
- 📁 教材資料夾（既有 meta／script）——每個 stem 後面有 🗑️ 刪除按鈕
- 🧩 Layout Templates（老師已存的樣板）
- 🔗 已配對組合（教材＋Layout 的 applications）

### 3.2 刪除 meta/script（🗑️ 按鈕）
- 前端：`handleOverviewStemDelete` → 呼叫 `GasService.deleteMaterialStem(targetFolderId, materialFolder, stem, rootKind)`
- GAS：`Code.gs` 新增 `deleteMaterialStemFiles()`，`doPost` 加 `action === 'delete_material_stem'` 分支，把 `.meta.json`／`.script.txt` 移進 Google Drive 垃圾桶（`setTrashed(true)`，非永久刪除）。
- **⚠️ 這個 GAS 新 action 需要重新部署才會生效**（跟 §1 是同一次部署）。
- 刪除成功後做「樂觀更新」：`window.FeatureTimeline.removeMetaCatalogFileOption(...)` 先把本地快取的那個檔案選項移除、立刻 `refreshOverviewFolders()` 重繪，不等 GAS 的背景重新整理（背景仍會 `ensureMetaCatalog({force:true})` 做最終一致性）。這是為了修「刪除後畫面沒更新，要手動 reload」的問題。

### 3.3 Excel 工具（🧾 從本機 Excel 讀取活頁／欄位）拆成兩條路
使用者原話：「產生 meta/script 時，可以直接套用現有的 layout，不用再勾選欄位等；若需要產生新的 layout 才需要目前這套方法」。

現在的結構（每個 Excel「segment」卡片內）：
1. **⚡ 已有現成 Layout？直接套用產生 meta/script**（`renderQuickApplyAreaHtml`）：選一個既有 template → `handleApplyExistingTemplate` 直接在「套用到教材」區塊生一筆新的 application row（帶入這個 Excel 檔的資料與所選 sheets），不用勾欄位、不用存 template。
2. **🆕 設計新 Layout（現有都不適用時才需要）**（`renderDesignToggleHtml` 包住原本整套勾欄位/存 template 流程）：預設收合（如果老師已經有至少一個 template），沒有任何 template 時自動展開。

`newExcelSegment` 多了兩個 state：`quickApplyTemplateName`、`designExpanded`。

**這部分是全新架構，還沒被使用者實測過，下一個 session 如果使用者說「Excel 工具怎麼跟以前不一樣了／找不到 XXX」，先看這裡，很可能是這次重構動到的。**

### 3.4「套用到教材」區塊的角色分工（更早之前定案，仍然有效）
- **來源檔案**（本機 Excel 或 Drive 皆可，可多活頁）→ 決定 meta/script 的內容從哪來
- **歸屬檔案**（只能是 Drive 上「教材資料夾」）→ 決定 meta.json/script.txt 最終寫到哪個資料夾

不要把兩者搞混，也不要把「來源」限制成只能 Drive（本機 Excel 是主要使用情境）。

## 4. 考試（Exam）相關：本輪 session 之前已完成、且已驗證的一大批修正

這些都已經處理完、使用者也確認過，**不是本輪待辦**，但下一個 session 若被問到考試相關問題，要知道現況：

- **「產生線上卷」按鈕已移除**。存作業（儲存作業／新增作業）時會自動偵測考試設定是否變更（`quiz_paper_signature` + `needsExamRegeneration`）並自動重新產生／保存 `quiz_paper`，不用老師手動點按鈕。
- **安全閂**：若考試已有學生作答（`taskHasSubmittedAnswers`）又偵測到設定變了，**不會**自動重出考卷（會打壞學生已交的分數），改成跳出警告＋在 inline 編輯器提供「🔁 立即重新產生」手動按鈕（有二次確認）。
- 區段（section）已可刪除，刪除按鈕在最右欄、`position:sticky; right:0`（這個位置是使用者明確要求改回的版本，**不要再搬到最左邊**，之前搬過去被打回票）。
- `bank_id`：只有一個選項時自動選、不強制、不再誤導性寫死。
- 新增「📋 套用上次設定（本班）」：記住同班上次教材＋layout＋出題設定。
- 學生端：
  - 「再做一次」／錯題重考都是**空白重來**，不會帶入上次答案。
  - 題目顯示會 shuffle（若考試設定開啟），且**用顯示順序重新編號**（不是用內部固定 `seq`），這樣題號跟解答對照才會一致（之前有「解答根本對不起來」的重大 bug，已修）。
  - 檢討／整體報告開啟前一定重新從 DB 拉最新 completion（不會用 page load 時的舊快取）。
  - 空白多字答案只顯示一個「（未作答）」，不會出現一堆 `[缺]`。
- 「書寫答案」多欄合併（`_answer_mode==='combine'`）時，`_answer_combined_text` 優先於舊公式，修掉「正確答案顯示不完整」的 bug。
- 新增可接受答案白名單機制：`EQUIVALENCE_PAIRS`、`expandWithEquivalents`、`isAcceptableAnswer`，教師端即時分數計算／學生端 review 都已改用這套比對，取代單純 `indexOf`。
- Regrade：`regradeCompletionRawData` 會同步更新 `quiz_retake.combined`，且保留 `wrong_items[].headline`。

## 5. 使用者溝通風格（重要，務必遵守）

- **一律繁體中文（台灣）**。
- 使用者很容易因為「同一個問題被說沒修好」而生氣（會打很多驚嘆號、全大寫），**遇到這種情況先老實承認、直接去看程式碼找根因，不要重複之前失敗的假設**。
- 使用者常常「先給截圖，再補一句話」——**收到圖但沒有文字說明時，先仔細看圖裡的所有文字/按鈕/錯誤訊息，自己判斷這是回報什麼問題**，不要空等文字說明。
- 使用者不喜歡「治標」的 UI 補丁（例如用 radio button 硬做 checkbox 的效果），發現架構有問題會直接要求「屏棄之前的做法」重新設計，要順著他去做架構性修正，不要只在表面上打補丁。
- 涉及 GAS（`gas/Code.gs`）的修改，**永遠要提醒使用者需要重新部署**才會生效（git push 不會更新線上 Web App），這是這個專案最容易被忘記、也最容易讓使用者以為「程式碼修好了但沒用」的地雷。

## 6. Pending / 下一步

- [ ] 等使用者回報：重新部署 GAS 後，「確認上傳到 Drive」是否成功、或出現什麼新的明確錯誤訊息。
- [ ] 等使用者實測本輪重構的「教材/Layout 搭配」頁（總覽卡、刪除按鈕、Excel 工具兩軌流程）。
- [ ] 目前沒有其他已知未解決的 bug；上面列的都是**已完成待驗證**，不是還在做。
- [ ] 使用者尚未要求 commit 本輪變更——**不要主動 commit**，除非使用者明確要求（規則：只有使用者要求才 commit）。

## 7. 快速檔案地圖（常用）

| 主題 | 檔案 |
|---|---|
| GAS 後端 | `gas/Code.gs` |
| GAS 前端 wrapper | `110_teacher_core/api-gas-service.js` |
| 教材/Layout 搭配頁 | `110_teacher_core/feature-material-layout-pairing.js` |
| 老師時間軸／作業存檔／meta 快取 | `110_teacher_core/feature-timeline.js` |
| 老師考試設定（inline editor） | `110_teacher_core/feature-exam-job.js` |
| 老師考卷檢討／regrade | `110_teacher_core/feature-exam-review.js` |
| 考卷產生／評分核心邏輯（前後端共用） | `020_js_core/quiz-paper-builder.js` |
| 學生作答／檢討／重考 UI | `120_student_core/feature-student-quiz.js` |
| 學生時間軸 UI（含檔案列表、頁碼標籤） | `120_student_core/ui-student-timeline-templates.js` |
| 範圍字串解析（`p.1`、`#11~16`） | `020_js_core/material-snapshot.js`（`parseRangeSpec`） |

## 8. 過去對話全文（供追溯細節用）

`/Users/glorias/.cursor/projects/Users-glorias-Desktop-PDF-interactive-page/agent-transcripts/3c87e834-2fae-4f2f-91c1-b09fd42ad73f/3c87e834-2fae-4f2f-91c1-b09fd42ad73f.jsonl`

內容非常長，**不要整份線性讀**，先用關鍵字（檔名、錯誤訊息、功能名稱）搜尋再讀附近幾行還原脈絡。

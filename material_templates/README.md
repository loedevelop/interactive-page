# GEPT-2 Material Excel 設定頁說明

## 活頁簿結構（同一個 .xlsx）

| 活頁名稱 | 用途 |
|----------|------|
| `_Config` | 全域設定（輸出資料夾名稱等） |
| `_Schema` | 欄位映射（語意 → Excel 欄、是否送 AI） |
| `_Publish` | 發布規則（最大可用範圍，不含 #11～15） |
| `A` … `Z` | 教材內容（phrase / vocab 等） |

## 快速開始

1. 開啟 Excel，建立活頁 `_Config`、`_Schema`、`_Publish`
2. 將本資料夾內 CSV **分別複製貼上**到對應活頁（或由「資料 → 自文字」匯入）
3. 依您的 GEPT-2 版面調整 `_Schema` 的 `excel_col`
4. 在 `_Publish` 填要發布的來源活頁（如 `C`）、列範圍、`LAST`
5. 存檔後上傳至 Google Drive（建議：班級 `00_Class_Materials/_draft/` 或老師 `01_My_Materials/_draft/`）
6. 在 LogOn 老師端 **📦 教材發布** 選擇目標（🏫 班級 00 或 👤 老師個人 01）→ 貼 Drive 檔案 ID／網址 → **發布**
7. 出錄音作業時在 Material Snapshot 選相同來源 → 載入 meta → 切片 → **套用 Snapshot**（寫入 AI 批改文稿）

## `_Config` 欄位

| key | 範例 | 說明 |
|-----|------|------|
| material_folder | GEPT-2_vocab | 寫入 00／01 母稿根下的子資料夾名 |
| last_row_column | A | 計算 `LAST` 時以哪一欄為準 |

## `_Schema` 欄位

| 欄 | 說明 |
|----|------|
| schema_id | 模板 id，與 `_Publish.schema_id` 對應 |
| semantic_key | 語意：`script`（必填）、`item_no`、`page`、`display_zh`… |
| excel_col | Excel 欄字母，如 `A`、`F`；可留空若暫不使用 |
| send_to_ai | `Y` / `N` — 是否併入 AI 稿（國語請填 N） |
| display | `Y` / `N` — 是否給學生顯示 |
| note | 備註 |

## `_Publish` 欄位

| 欄 | 說明 |
|----|------|
| enabled | `Y` 才執行 |
| source_sheet | 來源活頁名，如 `C` |
| row_start | 起始列（通常 `2`，跳過標題） |
| row_end | 結束列，或 `LAST` |
| output_meta | 如 `C.meta.json` |
| output_txt | 如 `C.script.txt`（可留空则不產 txt） |
| schema_id | 使用哪一套 `_Schema` 映射 |

**注意：`_Publish` 只定「最大發布範圍」，不出現 #11～15 或「作業第 3 頁」。**

## GAS 部署

`Code.gs` 新增 `publish_material` 動作。若上傳的是 `.xlsx`，請在 GAS 專案啟用 **進階 Google 服務 → Drive API**，或先將檔案在 Drive **以 Google 試算表開啟**後再發布。

# GEPT-2 Material Excel 設定頁說明

## 活頁簿結構（同一個 .xlsx）

| 活頁名稱 | 用途 |
|----------|------|
| `_Config` | 全域設定（輸出資料夾名稱等） |
| `_Schema` | 欄位映射（語意 → Excel 欄、是否送 AI） |
| `_Publish` | 發布規則（最大可用範圍，不含 #11～15） |
| `A` … `Z` | 教材內容（phrase / vocab 等） |

## 正確發布路徑（本機）

**不要**把 Excel 上傳到 Drive 發布，**不要**轉成 Google Sheets。

```
本機 Excel（_Config / _Schema / _Publish + A～Z）
        ↓  publish_local（本機腳本）
本機產出 .meta.json + .script.txt（+ _manifest.json）
        ↓  （之後若要給 Snapshot 用）只上傳這些 json/txt 到 00／01 Materials
LogOn 出作業 Material Snapshot
```

## 快速開始

1. 在 Excel 建好 `_Config`、`_Schema`、`_Publish` 與內容活頁（可把本資料夾 CSV 貼上當模板）
2. 依版面調 `_Schema` 的 `excel_col`；`_Publish` 設要發布的活頁（`enabled=Y`）
3. **本機產出 json／txt**（在 Terminal）：

```bash
cd "/Users/glorias/Desktop/PDF處理工具箱/interactive-page/material_templates"
chmod +x publish_local.sh   # 首次
./publish_local.sh "/你的路徑/教材.xlsx"
```

預設輸出到：Excel 同層的 `published/<material_folder>/`  
也可指定：`./publish_local.sh 教材.xlsx --out /某資料夾`

4. 若 `_Publish` 的檔名用了公式（如 `=B2&".meta.json"`），請先用 Excel **開啟並存檔一次**，讓公式結果寫入快取，再跑腳本。
5. 出錄音作業時：Material Snapshot 載入已發布的 meta → 切片 → **套用 Snapshot**

## `_Config` 欄位

| key | 範例 | 說明 |
|-----|------|------|
| material_folder | GEPT-2_vocab | 本機輸出子資料夾名（亦供之後放到 00／01 時使用） |
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
| output_meta | 如 `C.meta.json`（可用公式 `=B2&".meta.json"`） |
| output_txt | 如 `C.script.txt`（可留空則不產 txt） |
| schema_id | 使用哪一套 `_Schema` 映射 |

**注意：`_Publish` 只定「最大發布範圍」，不出現 #11～15 或「作業第 3 頁」。**

# GEPT-2 Material Excel 設定頁說明

## 活頁簿結構（同一個 .xlsx）——兩種設定格式皆支援

設定資料（`_Config`／`_Schema`／`_Publish`／`_Layout`）可以用**兩種格式**其中一種，`publish_local.py` 會自動偵測：

| 格式 | 長什麼樣子 | 何時用 |
|------|-----------|--------|
| **①合併活頁（建議，新教材用）** | 只有 1 個活頁叫 `_Setup`，裡面用 `#_Config`／`#_Schema`／`#_Publish`／`#_Layout` 標記把 4 小表疊在同一頁（見下方 [`_Setup` 合併格式](#_setup-合併活頁格式-建議) 一節） | 新教材、或欄位常跨表對照容易打錯時 |
| **②四個獨立活頁（舊格式，仍支援）** | `_Config`、`_Schema`、`_Publish`、`_Layout` 各自獨立分頁 | 已用這格式發布過的舊教材，不用強制轉 |

無論哪種格式，剩下的內容活頁（`A`…`Z`、`V`… 教材內容）都一樣獨立、不受影響。

**偵測邏輯：** Excel 裡有 `_Setup` 分頁 → 用①；否則找 `_Config`／`_Schema`／`_Publish`／`_Layout` → 用②。**兩種格式產出的 `.meta.json`／`.script.txt`／`_layout.json` 內容完全一樣**，已發布、已派給學生的作業完全不受影響（老師端 Snapshot 讀的是產出後的 json/txt，不會回頭讀 Excel）。

### 把舊格式轉成新格式（可選，需要重編輯已發布教材時才有必要）

```bash
cd "/Users/glorias/Desktop/PDF處理工具箱/interactive-page/material_templates"
chmod +x convert_to_setup.sh   # 首次
./convert_to_setup.sh "/你的路徑/舊教材.xlsx"
# 輸出：/你的路徑/舊教材.xlsx.setup.xlsx（新檔，不覆蓋原檔，其他活頁／公式原樣保留）
```

打開新檔確認 `_Setup` 分頁內容、其他活頁都沒跑掉，再決定要不要取代原檔。

## 舊格式：4 個獨立活頁

| 活頁名稱 | 用途 |
|----------|------|
| `_Config` | 全域設定（輸出資料夾名稱等） |
| `_Schema` | 欄位映射（語意 → Excel 欄、是否送 AI） |
| `_Publish` | 發布規則（最大可用範圍，不含 #11～15） |
| `_Layout` | 同教材共用的排版／欄位（可多列＝多種狀況可選） |
| `A` … `Z` | 教材內容（phrase / vocab 等） |

## `_Setup` 合併活頁格式（建議）

新教材建議只開 1 個活頁叫 `_Setup`（名稱固定，`publish_local.py` 靠這個名稱判斷用哪種格式），裡面用標記列把 4 小表疊起來。標記列**第一格**寫 `#_Config`／`#_Schema`／`#_Publish`／`#_Layout`（前面的 `#` 可留可不留、大小寫不拘），**下一列當表頭**，欄位名稱跟舊格式的表頭完全一樣，往下讀到下一個標記列或空白列為止：

```
#_Config
key,value
material_folder,GEPT-2_vocab
last_row_column,AB

#_Schema
schema_id,semantic_key,excel_col,send_to_ai,display,note
vocab-set1,display_zh,AK,N,Y,中文
vocab-set1,pos,AM,N,Y,詞性
vocab-set1,article,AN,N,Y,前置詞a/an（沒有就留空）
vocab-set1,script,AO,Y,N,英文

#_Publish
enabled,source_sheet,row_start,row_end,output_meta,output_txt,schema_id
Y,V,2,840,Vocab_Set1.meta.json,Vocab_Set1.script.txt,vocab-set1

#_Layout
enabled,profile_id,label,fields,fields_answer,lines_per_page,is_default,note
...
```

範本：`material_templates/_Setup.csv`（含下面「同一活頁、多區塊」的完整範例，可直接貼進 Excel 當起點）。

### 同一活頁、多區塊（欄位不同的情況）

如果同一份內容活頁（例如單字表 `V`）裡，不同題號範圍用的**欄位語意不一樣**（例如前半段用 AK/AM/AN/AO，後半段用 AL/AN/AO/AP），做法是：

1. **`_Schema` 開兩個 `schema_id`**（各自宣告自己那組 excel_col 對應），不用改活頁結構。
2. **`_Publish` 開兩列，`source_sheet` 填同一個活頁名**，`row_start`／`row_end` 各自框住自己的範圍，`schema_id` 各指向對應那組，`output_meta`／`output_txt` 各取不同檔名（下游會把每個 `output_meta` 檔名當成獨立單元，不是靠活頁名稱分）。

⚠️ **`row_end = LAST` 只能給同一活頁裡「最後一段」用**——`LAST` 是抓 `last_row_column` 那一欄整張表最底下有值的那一列，前面幾段若也填 `LAST` 會一路吃到後面段落的資料。前面每一段都要填明確的結束列數字，只有最下面那一段可以用 `LAST`。

## 正確發布路徑（本機）

**不要**把 Excel 上傳到 Drive 發布，**不要**轉成 Google Sheets。

```
本機 Excel（_Setup 合併活頁，或舊格式 _Config/_Schema/_Publish/_Layout + A～Z 內容活頁）
        ↓  publish_local（本機腳本，自動偵測格式）
本機產出 .meta.json + .script.txt + _manifest.json + _layout.json
        ↓  （之後若要給 Snapshot 用）只上傳這些 json/txt 到 00／01 Materials
LogOn 出作業 Material Snapshot
```

## 快速開始

1. 在 Excel 建好 `_Setup`（建議，見上）或舊格式 4 個獨立分頁，與內容活頁（可把本資料夾 CSV 貼上當模板）
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
| last_row_column | A | 計算 `LAST` 時以哪一欄為準；**務必指到真的有資料一路到最底列的欄**（例如題號欄），不是隨便填 A |

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

## `_Layout` 欄位（→ `_layout.json`）

同一份教材**所有活頁共用一份** `_layout.json`；表上可列多種排版，出考試時再依狀況選。

| 欄 | 說明 |
|----|------|
| enabled | `Y` 才寫進 `_layout.json` |
| profile_id | 對齊 Python `layout_profile_id`（如 `gept-translate-5col`） |
| label | 給老師看的名稱 |
| fields | 題卷欄位公式（頂層逗號＝輸出欄；支援 STACK／FONTSIZE／SUBSTITUTE／&／欄字母） |
| fields_answer | 答卷／提示版公式（可空） |
| lines_per_page | 每頁行數（考試區段預設題數估算用） |
| is_default | `Y`＝預設選這組；多列都 Y 時取第一個 |
| note | 備註 |

產出 `_layout.json` 另含 `col_map`／`col_maps`（由 `_Schema` 的 excel_col→semantic_key 產生），供線上卷求值。

沒有 `_Layout` 活頁、或沒有 `enabled=Y` 時：略過 `_layout.json`，不影響 meta 發布。

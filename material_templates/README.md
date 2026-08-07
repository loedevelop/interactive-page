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

同一份教材**所有活頁／所有 schema_id 共用一份** `_layout.json`；表上可列多種排版，出考試時再依狀況選。

| 欄 | 說明 |
|----|------|
| enabled | `Y` 才寫進 `_layout.json` |
| profile_id | 對齊 Python `layout_profile_id`（如 `gept-translate-5col`） |
| label | 給老師看的名稱 |
| fields | **印刷排版**欄位公式（頂層逗號＝輸出欄，並排多欄；支援 STACK／FONTSIZE／SUBSTITUTE／TEXTJOIN／&） |
| fields_answer | **印刷排版**答卷／提示版公式（可空） |
| quiz_prompt | **線上卷**題目提示公式（單一輸出，不是多欄並排；可空） |
| quiz_answer | **線上卷**正確答案公式（單一輸出；可空） |
| lines_per_page | 每頁行數（考試區段預設題數估算用） |
| is_default | `Y`＝預設選這組；多列都 Y 時取第一個 |
| note | 備註 |

產出 `_layout.json` 另含 `col_map`／`col_maps`（由 `_Schema` 的 excel_col→semantic_key 產生），供線上卷求值。

沒有 `_Layout` 活頁、或沒有 `enabled=Y` 時：略過 `_layout.json`，不影響 meta 發布。

### `fields` vs. `quiz_prompt`／`quiz_answer`：印刷排版跟線上卷是兩件不同的事，不能共用一套欄位猜

> 💣 雷區（曾發生：vocab 教材 `fields` 是 5 欄印刷排版，線上卷程式硬猜「第2欄＝提示、第3欄＝答案」，
> 結果提示變成頁碼、答案變成題號，整份考卷內容全錯）。見 `.cursor/rules/material-publish-setup-format.mdc`。

`fields`／`fields_answer` 是給**印刷／PDF 排版**用的：可以有任意欄數，各欄並排印在紙上（例如
vocab 需要書名、頁碼、題號、中文、詞性五欄都印出來）。

`quiz_prompt`／`quiz_answer` 是給**線上互動考卷**用的：每個各自只需要算出**一個**字串——
「這一題要顯示的提示」跟「這一題的正確答案」。兩者語意完全不同，欄數也常常不一樣，所以
拆成獨立欄位，不要共用 `fields`／`fields_answer`。

沒有填 `quiz_prompt`／`quiz_answer` 時，線上卷會退回舊慣例（`fields` 第2欄當提示、第3欄當答案），
只為相容舊的 GEPT 句子翻譯教材（那種剛好是3欄、順序也剛好對得上）；**新教材（尤其欄數不是3、
或欄位語意不是「提示在第2欄」）務必自己填 `quiz_prompt`／`quiz_answer`，不要依賴這個退回機制。**

範例（vocab，見 `_Setup.csv`）：

```
fields          = vBK_name, page, item_no, display_zh, pos      ← 印在紙上的 5 欄
fields_answer   = pre, script

quiz_prompt     = display_zh & " (" & pos & ")"                  ← 線上卷顯示「蘋果 (n.)」
quiz_answer     = TEXTJOIN(" ", pre, script)                     ← 正確答案「an apple」
                                                                     （pre 空時自動只留 script，
                                                                      不會被 & 的防呆規則吃成空字串）
```

`TEXTJOIN(分隔符, 欄位1, 欄位2, ...)` 用法跟 Excel 一樣：自動跳過空值再用分隔符接起來，
適合「有些列這欄是空的」的情境（例如不需要 a/an 的名詞），比 `&` 更安全。

### `fields`／`fields_answer` 裡的欄位要怎麼寫：semantic_key（建議）vs. Excel 欄字母（僅單一 schema 安全）

`_Schema` 的 `semantic_key` 就是設計來當「跨 schema 共用的詞彙」的——同一個語意（例如「中文」）在
`vocab-set1` 可能是 `AK` 欄，在 `vocab-set2` 卻是 `AL` 欄，但兩邊的 `semantic_key` 都叫
`display_zh`。**`_Layout.fields` 應該直接寫 `semantic_key`**（大小寫不拘），才能讓同一組排版真正
「所有段落共用」，不管實際 Excel 欄位在哪裡都能對到正確的資料：

```
✅ 建議（跨 schema 都通用）：
fields = display_zh, pos, article
fields_answer = script

❌ 別再用 Excel 欄字母（只對「寫的時候心裡想的那個 schema」是對的，換一個 schema 就會對錯欄）：
fields = AL, AN        ← 對 vocab-set2 是「中文,詞性」，但對 vocab-set1 卻是「（無)，前置詞」
```

**唯一例外**：教材整份只有 **一個** `schema_id`（沒有同活頁多區塊）時，直接寫 Excel 欄字母
（像 `material_templates/_Layout.csv` 的 `D,E,C,Y,X,BA,BB,BC,BD` 那組舊例）仍然安全——因為
沒有第二個 schema 會對同一個字母有不同解讀。一旦這份教材未來新增第二個 `schema_id`，
就要把 `fields` 改回 semantic_key，否則舊的 schema 會被新 schema 的欄位定義悄悄拖垮。

### `schema_id` 跟 `profile_id` 差在哪裡？

兩者是完全不同層次、互相獨立的東西，常被搞混：

| | `_Schema.schema_id` | `_Layout.profile_id` |
|---|---|---|
| 回答什麼問題 | 這一列資料，各語意欄位對到 Excel 的**哪一欄**（資料怎麼「讀進來」） | 印出來／線上卷要顯示**哪些**語意欄位、怎麼排（資料怎麼「秀出去」） |
| 什麼時候要開新的一組 | 同一份教材裡，不同區塊（同活頁或不同活頁）的欄位物理位置不同時 | 同一批資料想要有不同的呈現方式時（例如「單字卡」vs.「填空版」） |
| 是否跟 schema 綁定 | 是（一個區塊只能對應一個 `schema_id`） | **不是**——只要 `fields` 用 `semantic_key`，一個 `profile_id` 就能同時服務多個 `schema_id` |

因此「有兩個 `schema_id`（vocab-set1／vocab-set2），要不要也開兩個 `profile_id`？」——**不需要**。
只要 `fields`／`fields_answer` 改用 `semantic_key`，一個 `profile_id`（如 `vocab-basic`）就能兩邊共用，
這也是當初設計 `semantic_key` 這一層抽象的目的。

# LogOn Material 發布與出作業規格（討論結論）

> 狀態：產品規格／待實作  
> 更新：2026-07-25  
> 不上傳 GitHub（本地規格）

---

## 一、策略總覽

### 1.1 核心共識

| 項目 | 結論 |
|------|------|
| 文稿來源 | **班級 00_Class_Materials** 或 **老師 01_My_Materials**（母稿）；AI 不讀 PDF、不讀 Sheets URL |
| 01_Materials | 整本 PDF 給學生對照用，**可選**；主流程可很少用 |
| Excel → 發布 | **本機** Excel → `.meta.json` + 可選 `.script.txt`（不上傳 Excel、不轉 Sheets）；之後可只把 json/txt 放到 Drive 00／01 |
| GEPT-2 + Recording | 文稿從 00 已發布母稿來；**出作業時 snapshot**，錄音／AI 不每次讀 Drive |
| 歷史補 AI 批改 | **教師端**觸發，非學生端 |
| audio link 任務 | 過渡做法；長期由 00 母稿 + snapshot 取代 |
| 語言 | 文件與 UI 優先繁體中文 |

### 1.2 三層管道（不可混淆）

```
【層 1】Excel 編輯 + _Schema / _Publish（本機）
         ↓ material_templates/publish_local.sh
【層 2】本機產出 meta.json / script.txt
         ↓ （可選）只上傳 json/txt 到班級 00 或老師 01 Materials
【層 3】LogOn 出作業（GEPT-2 + Recording）Snapshot
         ↓
【層 4】學生錄音 / AI 批改（只讀作業 snapshot）
```

~~舊誤路徑：上傳 Excel → GAS 轉 Sheets 再發布。已廢棄。~~

**發布** = 公佈最大可用範圍（本機產出；可選再放到班級 00 或老師個人 01）。  
**出作業** = 從已發布 meta 中切片。  
**#11～15、第 N 頁** 只出現在【層 3】，不出現在【層 1～2】。

---

## 二、Drive 資料夾約定

```
{ClassDriveFolder}/
└── 00_Class_Materials/
    └── GEPT-2_vocab/              （名稱可配置）
        ├── C.meta.json            ← 發布：活頁 C 最大範圍
        ├── C.script.txt           ← 可選：純英文稿彙整
        ├── Vocab.meta.json
        └── _manifest.json

{_Teachers/{email前綴}_{uid後4}/}
└── 01_My_Materials/               ← 老師個人母稿（跨班共用）
    └── GEPT-2_vocab/
        ├── C.meta.json
        ├── C.script.txt
        └── _manifest.json
```

---

## 三、Excel 結構：`_Schema` + `_Publish`

### 3.1 `_Schema`（欄位映射，可重用、高靈活度）

每位老師／每份教材可不同；**不綁死 A 欄 = page**，改綁**語意 + Excel 欄位字母**。

#### 系統必要語意（minimum）

| 語意鍵 | 必填規則 | 用途 |
|--------|----------|------|
| `script` | ✅ 必填 | AI 朗讀對照稿（英文） |
| `item_no` | 若支援「#11～15」出作業 | 題號篩選 |
| `page` | 若支援「第 N 頁」出作業 | 整頁篩選 |
| `row_id` | 若無 item_no 時的備選 | 穩定列識別 |

至少需能支援兩種出作業方式之一；**建議 phrase 頁同時有 page + item_no + script**。

#### 欄位屬性：`send_to_ai`（重要）

每個映射欄位可設定：

| 屬性 | 說明 | 範例 |
|------|------|------|
| `send_to_ai: true` | 併入 Speechace `text` / 評分稿 | `script` |
| `send_to_ai: false` | 帶進 meta、可顯示給學生，**不送 AI** | `display_zh`（國語／中文釋義） |
| `display: true` | 學生錄音艙可顯示 | 中文句、詞性、備註 |
| `display: false` | 僅後台／報表用 | 內部標記 |

**例：國語欄必要但不送 AI** → `display_zh`：`send_to_ai: false`, `display: true`。

#### 自由欄位（extensions）

透過 `_Schema` 的 `include` 增設，例如：

```
include: display_zh:G, pos:C, teacher_note:H, unit:B
```

- 全部寫入 `*.meta.json`
- LogOn 不認識的鍵**保留**，供未來功能使用
- 是否送 AI 由各自 `send_to_ai` 決定，預設 **false**

#### Preset 模板（起點，可覆寫）

| template id | 用途 |
|-------------|------|
| `gept_phrase` | 左中文、右英文句；page + item_no |
| `gept_vocab` | 題號、中文、詞性、英文詞形變化 |
| `custom` | 老師自訂映射 |

### 3.2 `_Publish`（每次發布：最大可用範圍）

**不出現** #11～15 或「作業用第 3 頁」。

| 欄 | 說明 |
|----|------|
| 啟用 | Y/N |
| 來源活頁 | Excel sheet 名，如 `C` |
| 列起 / 列迄 | 如 `2` / `LAST` |
| 輸出檔 | 如 `C.meta.json` |
| schema | 如 `gept_phrase` |

發布程式：本機 `material_templates/publish_local.sh` 讀 `_Publish` → 依 `_Schema` 抽列 → 寫出 json/txt。

---

## 四、出作業（LogOn）

### 4.1 條件

- 作業含 **GEPT-2 + Recording**（或同策略之 drive / audio_record）
- 讀已發布 `C.meta.json`（非 Excel、非即時 Drive 重 parse）

### 4.2 老師選範圍（二選一）

| 模式 | 範例 | 篩選 |
|------|------|------|
| 依頁 | 活頁 C、第 3 頁 | `page = 3` 全部列 |
| 依題號 | 活頁 C、#11～15 | `item_no` 11–15 |

### 4.3 Snapshot（必做）

出作業儲存時寫入 Recording 任務（或 task.raw_data）：

```json
{
  "material_ref": {
    "material_id": "gept2-vocab",
    "published_file": "C.meta.json",
    "published_at": "ISO8601",
    "select_mode": "page | item_range",
    "page": 3,
    "item_from": 11,
    "item_to": 15
  },
  "original_script": "…僅 send_to_ai=true 的欄位合成…",
  "student_display": "…display=true 的欄位，供錄音艙…",
  "snapshot_at": "ISO8601"
}
```

- **已繳交作業**不因 00 再發布而自動改稿
- 錄音／AI **只讀 snapshot**

---

## 五、單字唸法規則系統（待補細節）

> ⚠️ 老師有一套**單字唸法／詞形變化**規則，實作 AI 評分前必須讀懂此節。  
> 以下為已記錄之方向，**細則待老師補充**。

### 5.1 背景

- Vocab 表（如題號 421–440）含：`stroke(s) - stroked - stroked - stroking` 等詞形串
- 評分時不能只用「整串丟 Speechace」，需依**老師規則**展開或比對學生實際應念形式

### 5.2 降維模式（fallback）

| 模式 | 說明 |
|------|------|
| **完整規則模式** | 依老師詞形系統展開 reference（待規則文件） |
| **降維：只念原生單字** | 僅以**原形／詞幹**為 AI reference，不評變化形（設定可 per 作業或 per 班級） |

出作業或 task 設定需有：`pronunciation_mode: "full_rules" | "lemma_only"`。

### 5.3 待補文件（TBD）

- [ ] 詞形欄位 parse 規則（`-` 分隔、括號、s/es 等）
- [ ] 哪些時態／單複數必念、哪些可省略
- [ ] 與 `script` / `send_to_ai` 合成邏輯
- [ ] Speechace reference 字串生成範例

---

## 六、與現有程式差距（實作前必讀）

| 已有 | 尚缺 |
|------|------|
| GAS `extract_sheet` | Excel→meta.json 發布管線 |
| `process-audio-ai` 要 `original_script` | 出作業 snapshot、send_to_ai 合成 |
| 教師端補批（過渡） | GEPT-2+Recording 綁 00 |
| `task-script-resolver` sibling link | 改為讀 00 已發布 meta |
| Material Phase1 文件 | 本規格取代 Sheets 主線 |

---

## 七、已繳交作業與孤兒

- `task_completions` 以 `assignment_id + task_id` 掛勾
- **刪 task 節點**或**換 task id** → UI 孤兒（DB 仍在）
- **改 snapshot 來源之母稿** → 不影響已 snapshot 之作業（正確行為）
- 大改結構宜新開作業、舊作業封存

---

## 八、決策紀錄（簡表）

1. 00 為 AI 母稿；01 可選  
2. Excel → TXT/meta 直接發布，不強依 Sheets  
3. 發布 = 最大範圍；出作業 = 切片  
4. minimum 語意欄 + 自由欄 + `send_to_ai` 開關  
5. 國語等：必要顯示、不送 AI  
6. 單字唸法：完整規則 TBD + 降維 `lemma_only`  
7. 教師端補批；學生端不補歷史  
8. 一律繁體中文  

---

## 修訂紀錄

| 日期 | 說明 |
|------|------|
| 2026-07-25 | 初版：匯整 Cursor 對話結論 |

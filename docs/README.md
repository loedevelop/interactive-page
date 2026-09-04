# docs／規格與備忘目錄

本地規格與交接文件（不上傳／不強制進版控流程，依專案習慣處理）。

| 檔案 | 說明 |
|------|------|
| [班級預設與派發規格.md](./班級預設與派發規格.md) | 資源／訊息模板／老師班級預設組合：三層派發與入口建議（2026-07 討論整理） |
| [AGENT_PROMPT_Material_Phase1.md](./AGENT_PROMPT_Material_Phase1.md) | Material Phase 1 代理提示與規劃 |
| [AGENT_Material_Publish.md](./AGENT_Material_Publish.md) | Material 發布相關代理說明 |
| [Material_Publish_Spec.md](./Material_Publish_Spec.md) | Material 發布規格（自專案根目錄移入） |
| [hand-off_prompt.md](./hand-off_prompt.md) | 交接用提示（自專案根目錄移入） |
| [feature-prompt_quiz-fill-blank.md](./feature-prompt_quiz-fill-blank.md) | 測驗活頁「填空題型」功能需求彙整（2026-07-30，尚未實作） |
| [quiz-json-contract-v0.1.md](./quiz-json-contract-v0.1.md) | interactive-page ↔ Python 出題系統 JSON 合約 v0.1 |
| [quiz-json-contract-v0.2.md](./quiz-json-contract-v0.2.md) | 同上合約 v0.2（`exam_job` 取代 `quiz_spec`，排版交給 Python `layout_profile_id`） |
| [雷區撰寫規範.md](./雷區撰寫規範.md) | `.cursor/rules/*.mdc` 雷區規則的撰寫模板與 globs／alwaysApply 使用規範 |
| [活頁總題數與可用題.md](./活頁總題數與可用題.md) | 出作業可用題：活頁記總題數、用每頁行數算範圍；超出 popup 並改起迄（2026-08-22，曾解過又回來） |
| [標題範圍處理規則.md](./標題範圍處理規則.md) | 大標題＝套餐名；小標題＝表名＋範圍。挑選目標、分匣融合、表名收納。只准 combinePackRangeLabel（2026-08-24） |
| [組合作業範圍與套餐.md](./組合作業範圍與套餐.md) | 三種套餐同一層：Excel/JSON 類、PDF、目錄。Excel 與 JSON 不是兩種。套餐＝來源＋試卷範本（Excel/JSON 另加擷取）。目錄＝老師提供範圍、收集成書。產生分三區；教材區只顯示。下拉只列該班套餐名。同一坑超過十回（2026-08-24；下拉綁死 2026-08-27；來源／試卷範本 2026-08-29；目錄收集 2026-08-29；三種正名 2026-09-01） |

相關但留在功能目錄：

- `material_templates/README.md` — 教材模板包說明（隨模板目錄）

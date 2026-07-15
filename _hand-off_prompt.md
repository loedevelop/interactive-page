### 📋 系統重構交接文件 (Handoff Prompt)

**【專案背景與核心理念】**
本專案為 LogOnTeacher (SaaS 升級版) 班級管理系統。系統遵循**「情境身分制 (Contextual Multi-Persona)」**架構設計：全域身分 (`default_role`) 僅作為登入後的首頁導航依據，使用者在各班級的實際權限應由 `student_enrollments` 與 `class_staff` 關聯表動態決定。

**【本次解決的核心痛點】**
1. **防衝突機制的誤判 (500 錯誤當機)：** 舊版 Edge Function 會擅自「通靈」，遇到已存在的信箱就強制啟動帳號變異 (加 `+` 號)，導致舊生續報或教職員轉學生時發生二次碰撞當機。
2. **歷史技術債 (Legacy Data) 導致解析失敗：** 早期帳號的 `raw_data` 為空物件 `{}` 或缺少 `nameEN`，導致後端存取時發生 `TypeError`。
3. **歷史遺留身分 (`user`) 導致路由卡死：** 部分舊帳號 `default_role` 停留在無效的 `user`，導致前端登入後無法判別導向。

**【✅ 已完成的架構重構與修改模組】**

**1. 前端邏輯重構：變異決策權下放 UI (`110_teacher_core/feature-member-management.js`)**
* **實作內容：** 拔除後端的猜測邏輯。在新增成員表單的 Email 欄位下方，加入明確的選項 `[ ] 此為共用信箱 (系統將結合姓名自動變異生成獨立的分身帳號)`。
* **邏輯解耦：** 由前端 JS 負責判斷。若打勾，前端直接組合出變異後的 Email (如 Gmail 加 `+英文名` 或轉內部網域) 並傳送；若未打勾，則傳送原始 Email。

**2. 後端邊緣函數純粹化與防護網 (`supabase/functions/admin_create_user/index.ts`)**
* **純粹化建檔引擎：** 移除所有 Email 變異判斷，無腦信任前端傳來的 `targetEmail`。若信箱不存在，則直接建立全新的 Supabase Auth 與 Profiles。
* **舊資料救援 (Legacy Patch)：** 若 `targetEmail` 已存在，攔截錯誤並啟動無痛合併。安全地將前端傳入的新姓名資料 (`nameEN`, `firstNameCN` 等) Deep Merge 進舊有的 `raw_data` 中，且保證不覆蓋舊有的 `drive_url`。
* **動態身分升級：** 偵測舊帳號的 `default_role`。若為 `user` 或 `null`，自動將其升級為本次指派的對應身分 (`student`, `staff` 等)；若已是有效身分則絕對不覆蓋，保障多重身分彈性。

**3. 資料庫層級清洗 (SQL Editor 手動執行完畢)**
* 將 `profiles` 資料表的 `default_role` 預設值改為 `student`。
* 執行批量 Update，將所有歷史遺毒 `default_role = 'user'` 強制校正為 `student`，徹底消滅登入路由卡死的未爆彈。*(註：資料庫中殘留的 `raw_data: {}` 已被前端防呆與後端 Legacy Patch 完美防禦，無須手動清理)*。

**【📝 給後續文件更新 (Documentation) 的 Action Items】**
在更新《系統架構白皮書》或 API 文件時，請確保寫入以下三點新原則：
1. **Email 變異規則的歸屬：** 聲明 Email 變異 (Alias/LogOn Domain) 屬於「前端 View 層」的業務邏輯，Edge Function API 僅作為「接收最終 Email 並建檔」的底層基礎設施。
2. **`default_role` 的降級宣告：** 明確定義 `profiles.default_role` 僅作為「Landing Portal (登入後首頁導向)」使用，不可用於判斷班級內的實質操作權限。
3. **無痛升級 (Graceful Degradation) 規範：** 未來任何針對 `profiles` 的讀寫，都必須考量舊有 `{}` 資料的相容性，必須套用類似 `raw_data || {}` 的容錯解析。

---
*(請以這個狀態作為 Context，我們接下來要進行什麼開發或文件撰寫？)*

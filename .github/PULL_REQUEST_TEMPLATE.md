## Summary
<!-- 1～3 點說明為何改、影響誰 -->

## Test plan
- [ ] 已手動驗證相關流程（或說明為何無法測）

## 雷區規則（每個 PR 必勾）
- [ ] 已檢查 [.cursor/rules/00-pitfall-index.mdc](../.cursor/rules/00-pitfall-index.mdc) 列出的規則，確認本次改動有無命中
- [ ] 若本次修的是「同一問題第二次出現」，已依 [docs/雷區撰寫規範.md](../docs/雷區撰寫規範.md) 新增或更新對應規則（否則說明為何不需要）

## Drive／上傳（動到 `gas/Code.gs` 或學生上傳時必勾）
- [ ] `upload_file`：空／未傳 `subFolderName` 時仍**直接寫入 `folderId`**（未誤呼叫 `resolveClassResourcesFolder`）
- [ ] 學生繳交目標仍為 `01_Submissions`；未在 `02_Students/姓名_短ID/` 下新建 `01_Class_Resources`
- [ ] 已依規則重新部署 GAS（部署 → 管理部署 → 編輯 → **新版本** → 部署）並用學生上傳實測

## Notes
<!-- 選填：遷移、風險、需老師手動操作 -->

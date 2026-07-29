## Summary
<!-- 1～3 點說明為何改、影響誰 -->

## Test plan
- [ ] 已手動驗證相關流程（或說明為何無法測）

## Drive／上傳（動到 `gas/Code.gs` 或學生上傳時必勾）
- [ ] `upload_file`：空／未傳 `subFolderName` 時仍**直接寫入 `folderId`**（未誤呼叫 `resolveClassResourcesFolder`）
- [ ] 學生繳交目標仍為 `01_Submissions`；未在 `02_Students/姓名_短ID/` 下新建 `01_Class_Resources`
- [ ] 已依規則重新部署 GAS（部署 → 管理部署 → 編輯 → **新版本** → 部署）並用學生上傳實測

## Notes
<!-- 選填：遷移、風險、需老師手動操作 -->

🚀 系統升級說明書：全自動化雲端資料夾隔離架構與歷史資料淨化
版本更新日期：2026-07-18
核心目標：解決雲端硬碟檔案混亂與 HTML 檔名污染問題，導入具備 SaaS 級別的「班級 ➡️ 學生」雙層全自動資料夾隔離架構，並完成歷史資料的無痛遷徙。

一、 核心功能升級 (New Features)
1. 班級主資料夾全自動生成
變更前：建立班級後，缺乏統一的專屬作業收件匣，資料夾結構鬆散。

變更後：當老師在後台建立新班級時，系統會自動在 Google Drive 的 /_LOE/_std/ 目錄下，建立名為 [班級名稱]_作業收件匣 的主資料夾。

資料庫連動：系統會將生成的 Folder ID 寫入 Supabase 的 classes 資料表中的 raw_data.drive_folder_id，確保資料庫與雲端硬碟精準綁定。

2. 學生專屬子資料夾自動隔離
變更前：學生上傳作業容易混雜在同一個大公海中，或需依賴容易失效的全域連結。

變更後：當老師將學生加入某個班級（或綁定身分）時，系統會自動在該班級的母資料夾底下，建立 [學生姓名]_[帳號末4碼] 的專屬子資料夾。

資料庫連動：生成的子 Folder ID 會精準寫入 student_enrollments 的 raw_data.drive_folder_id。未來該名學生在此班級的上傳，將 100% 獨立隔離，不會與其他學生或班級混淆。

二、 歷史資料大遷徙與淨化 (Migration & Purification)
為了解決系統上線前的「歷史共業」，本次更新設計了強大的後台遷徙引擎（God Mode Migration），達成以下創舉：

1. 終極檔名正名引擎 (File Name Purification)
針對過去帶有 <span style="..."> HTML 標籤、URL 亂碼（如 %20）或非法字元的舊作業檔案，GAS 雲端引擎導入了強制的洗白機制。在搬運檔案的瞬間，系統會殘忍剝除所有程式碼與亂碼，將檔名還原為乾淨、純文字的格式。

2. 無痛化自動搬運 (Automated Legacy Migration)
透過前端 Snippets 觸發，系統已自動掃描所有舊班級與舊學生，完成了以下任務：

自動為舊班級在根目錄（後續手動移入 _LOE/_std）補建班級資料夾。

自動潛入學生舊有的網址/資料夾，將舊作業全數「正名」並「實體移動」至全新的雙層隔離架構中。

將所有新生成的 ID 同步覆寫回 Supabase，舊學生與新系統完美接軌。

三、 底層架構與防禦性設計 (Architecture & Defense)
1. 智慧路徑導航引擎 (Smart Path Routing)
在 Google Apps Script (GAS) 中加入了 getOrCreatePath 邏輯。

防呆機制：系統不再依賴「絕對存在的資料夾」。未來新建班級時，系統會自動偵測 _LOE 與 _std 資料夾是否存在。如果被人為誤刪或更名，系統會自動在背景默默重建地基，確保開班流程與檔案上傳永遠不會因為「找不到路徑 (404)」而當機。

2. JSONB 資料庫彈性擴充
全面利用 Supabase 的 raw_data (JSONB) 欄位來儲存新的 drive_folder_id。

向後相容性：讀取邏輯設定為「優先讀取新版 Folder ID ➡️ 若無則降級讀取舊版 Drive Link」。這種雙軌並行的設計，確保了在任何極端情況下，系統都不會發生斷鏈錯誤。

四、 涉及變更的系統檔案清單
本次架構升級共深度修改了以下 4 支核心檔案：

Code.gs (Google Apps Script)

新增 migrate_student_data 大遷徙與洗檔名邏輯。

新增 getOrCreatePath 智慧路徑導航。

升級 create_folder 支援巢狀子資料夾建立。

020_js_core/api.js

擴充 createGASFolder API 模組，使其支援傳遞 parentFolderId 參數至雲端。

110_teacher_core/feature-class.js

攔截「建立新班級」流程，強制呼叫 API 生成雲端資料夾，並將 ID 封裝寫入資料庫。

110_teacher_core/feature-member-management.js

攔截「加入班級成員」流程，判斷若為學生身分，則自動提取班級 Folder ID，並呼叫 API 建立該學生的專屬子資料夾。

/**
 * 📂 檔案：110_teacher_core/api-gas-service.js
 * 🌟 職責：與 Google Apps Script (GAS) 中繼站通訊，專職處理 Excel/Sheets 解析與檔案上傳。
 * ⚠️ 依賴：無。掛載於全域 window.GasService
 */

window.GasService = (function() {
  // 這是你已部署且剛更新完畢的 GAS 網頁應用程式網址
  const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec';

  return {
    /**
     * 🔍 內部工具：解析 Google Drive / Sheets URL 以取得真正的 File ID
     * @param {string} url - 使用者貼上的網址
     * @returns {string|null} - 萃取出的 File ID，若格式錯誤則回傳 null
     */
    extractFileIdFromUrl(url) {
      if (!url || typeof url !== 'string') return null;
      // 利用 Regex 精準捕捉 Drive 網址中的 25+ 字元唯一 ID
      const match = url.match(/[-\w]{25,}/);
      return match ? match[0] : null;
    },

    /**
     * 🚀 核心功能：呼叫 GAS 萃取 Excel / Google Sheets 指定範圍的文字
     * @param {string} driveUrl - Google Drive 或 Sheets 的網址
     * @param {string} sheetName - 活頁簿名稱 (例如：'GEPT-2')
     * @param {string} range - 萃取範圍 (例如：'A1:B20')
     * @returns {Promise<string>} - 萃取後且合併完畢的純淨字串
     */
    async extractSheetData(driveUrl, sheetName = 'Sheet1', range = 'A1:B20') {
      try {
        const fileId = this.extractFileIdFromUrl(driveUrl);
        if (!fileId) {
          throw new Error('無法解析網址：請確認是否為有效的 Google Drive 或 Google Sheets 連結。');
        }

        const payload = {
          action: 'extract_sheet',
          fileId: fileId,
          sheetName: sheetName,
          range: range
        };

        // 發送 POST 請求至 GAS 中繼站
        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          // 註解：GAS 處理跨域請求時，採用 text/plain 作為預設 payload 最穩定
          headers: {
            'Content-Type': 'text/plain', 
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        // 攔截並拋出 GAS 內部回傳的業務邏輯錯誤
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器解析失敗，請確認檔案權限與活頁簿名稱。');
        }

        return result.extractedText;

      } catch (error) {
        console.error('[GasService] Excel 萃取發生嚴重錯誤:', error);
        throw error; // 將錯誤往上拋，交由 UI 層的 Try-Catch 攔截並渲染防禦彈窗
      }
    },

    /**
     * 🚀 擴充功能：呼叫 GAS 上傳學生端 Local 檔案 (防 CORS 封鎖版)
     * @param {string} base64 - 檔案的 Base64 編碼字串 (不含 mime type 開頭)
     * @param {string} fileName - 檔案名稱
     * @param {string} mimeType - 檔案的 MIME Type
     * @param {string} folderId - 欲存入的 Google Drive 資料夾 ID
     * @param {string} assignId - 紀錄用的作業 ID (可選)
     * @param {string} taskId - 紀錄用的任務 ID (可選)
     * @returns {Promise<string>} - 回傳上傳成功後的 Drive File URL
     */
    async uploadStudentLocalFile(base64, fileName, mimeType, folderId, assignId = '', taskId = '') {
      try {
        const payload = {
          action: 'upload_file',
          fileData: base64,
          fileName: fileName,
          mimeType: mimeType,
          folderId: folderId,
          assignmentId: assignId,
          taskId: taskId
        };

        // 發送 POST 請求至 GAS 中繼站
        const response = await fetch(GAS_WEB_APP_URL, { 
          method: 'POST', 
          // 必須維持 text/plain 鐵律以繞過 CORS Preflight
          headers: { 
            'Content-Type': 'text/plain' 
          }, 
          body: JSON.stringify(payload) 
        });
        
        const result = await response.json();
        
        // 攔截並拋出 GAS 內部回傳的業務邏輯錯誤
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器上傳失敗');
        }
        
        return result.fileUrl;

      } catch (error) {
        console.error('[GasService] 檔案上傳發生嚴重錯誤:', error);
        throw error; // 將錯誤往上拋，交由 feature-timeline 攔截
      }
    }
  };
})();
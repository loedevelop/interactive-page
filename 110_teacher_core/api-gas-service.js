/**
 * 📂 檔案：110_teacher_core/api-gas-service.js
 * 🌟 職責：與 Google Apps Script (GAS) 中繼站通訊，專職處理 Excel/Sheets 解析、資料夾建立、歷史轉移與檔案上傳。
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
     * 🚀 核心功能 1：呼叫 GAS 萃取 Excel / Google Sheets 指定範圍的文字
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

        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器解析失敗，請確認檔案權限與活頁簿名稱。');
        }

        return result.extractedText;

      } catch (error) {
        console.error('[GasService] Excel 萃取發生嚴重錯誤:', error);
        throw error;
      }
    },

    /**
     * 📂 核心功能 2：呼叫 GAS 建立資料夾
     * (對接 Code.gs 的 create_folder 路由)
     */
    async createFolder(folderName, parentFolderId = null, requireShare = false, shareEmails = null) {
      try {
        const payload = {
          action: 'create_folder',
          folderName: folderName,
          parentFolderId: parentFolderId,
          requireShare: requireShare
        };
        if (shareEmails) {
          payload.shareEmails = Array.isArray(shareEmails) ? shareEmails : [shareEmails];
        }

        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器建立資料夾失敗');
        }

        return {
          folderId: result.folderId,
          folderUrl: result.folderUrl
        };

      } catch (error) {
        console.error('[GasService] 建立資料夾發生錯誤:', error);
        throw error;
      }
    },

    /**
     * 🔄 核心功能 3：呼叫 GAS 進行學生歷史資料夾轉移
     * (對接 Code.gs 的 migrate_student_data 路由)
     */
    async migrateStudentData(parentFolderId, studentName, studentShortId, oldFolderId) {
      try {
        const payload = {
          action: 'migrate_student_data',
          parentFolderId: parentFolderId,
          studentName: studentName,
          studentShortId: studentShortId,
          oldFolderId: oldFolderId
        };

        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器資料夾轉移失敗');
        }

        return {
          folderId: result.folderId,
          folderUrl: result.folderUrl,
          movedCount: result.movedCount
        };

      } catch (error) {
        console.error('[GasService] 轉移學生資料夾發生錯誤:', error);
        throw error;
      }
    },

    /**
     * 🚀 擴充功能 4：呼叫 GAS 上傳學生端 Local 檔案 (強制收納 01_Class_Resources)
     * (對接 Code.gs 的 upload_file 路由)
     */
    async uploadStudentLocalFile(base64, fileName, mimeType, folderId, assignId = '', taskId = '', subFolderName = '01_Class_Resources') {
      try {
        const payload = {
          action: 'upload_file',
          fileData: base64,
          fileName: fileName,
          mimeType: mimeType,
          folderId: folderId,
          subFolderName: subFolderName,
          assignmentId: assignId,
          taskId: taskId
        };

        const response = await fetch(GAS_WEB_APP_URL, { 
          method: 'POST', 
          headers: { 'Content-Type': 'text/plain' }, 
          body: JSON.stringify(payload) 
        });
        
        const result = await response.json();
        
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器上傳失敗');
        }
        
        return result.fileUrl;

      } catch (error) {
        console.error('[GasService] 檔案上傳發生嚴重錯誤:', error);
        throw error;
      }
    },

    /**
     * 🔐 確保資料夾為「知道連結可編輯」，並可選加入學生 Google 信箱
     */
    async ensureFolderSharing(folderId, options = {}) {
      try {
        const payload = {
          action: 'ensure_folder_sharing',
          folderId: folderId,
          permission: options.permission || 'edit'
        };
        const emails = options.shareEmails || options.shareEmail || [];
        if (emails && emails.length) {
          payload.shareEmails = Array.isArray(emails) ? emails : [emails];
        }

        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 資料夾權限設定失敗');
        }
        return result;
      } catch (error) {
        console.error('[GasService] 資料夾權限設定錯誤:', error);
        throw error;
      }
    },

    /**
     * 📦 核心功能 5：Excel(_Schema/_Publish) → 00_Class_Materials
     */
    async publishMaterial(sourceFileId, targetFolderId) {
      try {
        const payload = {
          action: 'publish_material',
          sourceFileId: sourceFileId,
          targetFolderId: targetFolderId
        };

        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 教材發布失敗');
        }
        return result;
      } catch (error) {
        console.error('[GasService] 教材發布錯誤:', error);
        throw error;
      }
    },

    async listMaterialMasters(targetFolderId) {
      const payload = {
        action: 'list_material_masters',
        targetFolderId: targetFolderId
      };
      const response = await fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.status !== 'success') {
        throw new Error(result.message || '無法列出 00_Class_Materials');
      }
      return result.materials || [];
    },

    async readMaterialFile(targetFolderId, materialFolder, fileName) {
      const payload = {
        action: 'read_material_file',
        targetFolderId: targetFolderId,
        materialFolder: materialFolder || '',
        fileName: fileName
      };
      const response = await fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.status !== 'success') {
        throw new Error(result.message || '無法讀取 meta 檔');
      }
      return result;
    },

    async ensureTeacherWorkspace(teacherName, teacherShortId) {
      const payload = {
        action: 'ensure_teacher_workspace',
        teacherName: teacherName,
        teacherShortId: teacherShortId
      };
      const response = await fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.status !== 'success') {
        throw new Error(result.message || '無法建立老師工作區');
      }
      return result;
    }
  };
})();
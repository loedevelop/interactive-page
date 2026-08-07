/**
 * 📂 檔案：110_teacher_core/api-gas-service.js
 * 🌟 職責：與 Google Apps Script (GAS) 中繼站通訊，專職處理 Excel/Sheets 解析、資料夾建立、歷史轉移與檔案上傳。
 * ⚠️ 依賴：無。掛載於全域 window.GasService
 */

window.GasService = (function() {
  // 這是你已部署且剛更新完畢的 GAS 網頁應用程式網址
  const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec';

  /**
   * 統一 POST：辨識「打到 doGet 健康檢查」與「回 HTML」兩種常見部署故障。
   */
  async function postGasJson(payload) {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    var result;
    try {
      result = JSON.parse(text);
    } catch (_parseErr) {
      if (/^\s*</.test(text)) {
        if (/找不到網頁|Moved Temporarily|Page not found/i.test(text)) {
          throw new Error(
            'GAS Web App 網址已失效（回傳「找不到網頁」）。'
            + '請在 script.google.com → 部署 → 管理部署作業 → 編輯 → 選「新版本」→ 對象「任何人」後部署；'
            + '若網址變了，請同步更新 api-gas-service.js 與 api.js 的 GAS URL。'
          );
        }
        throw new Error(
          'GAS 回傳 HTML 而非 JSON（常見：Web App 權限不是「任何人」、或部署網址過期）。'
          + '請重新部署：執行身分＝我、誰可以存取＝任何人，並核對前端 GAS_WEB_APP_URL。'
        );
      }
      throw new Error('GAS 回應不是 JSON：' + String(text || '').slice(0, 160));
    }
    // doGet 預設：{ status:'ok', message:'LogOn GAS Online' } —— 代表 POST 被轉成 GET，action 沒進 doPost
    if (result && result.status === 'ok' && /LogOn GAS Online/i.test(String(result.message || ''))) {
      throw new Error(
        'GAS 只回應了健康檢查（doGet），沒有執行 doPost action「'
        + (payload && payload.action ? payload.action : '?')
        + '」。請重新部署 Web App（務必選「新版本」），確認對象為「任何人」。'
      );
    }
    if (!result || result.status !== 'success') {
      throw new Error((result && result.message) || 'GAS 呼叫失敗');
    }
    return result;
  }

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
     * 📥 下載 Drive 檔案（POST download_file → Base64）
     * 給音檔切割工具／備援用：不走公開 uc 連結，也不走 GET 二進位（redirect 易壞）。
     * @returns {{ arrayBuffer: ArrayBuffer, mimeType: string, fileName: string, fileId: string, byteLength: number }}
     */
    async downloadFile(fileId) {
      try {
        if (!fileId) throw new Error('缺少 fileId');
        const payload = { action: 'download_file', fileId: String(fileId).trim() };
        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.status !== 'success' || !result.fileData) {
          throw new Error(result.message || 'GAS 下載失敗');
        }
        const binary = atob(result.fileData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return {
          arrayBuffer: bytes.buffer,
          mimeType: result.mimeType || 'application/octet-stream',
          fileName: result.fileName || '',
          fileId: result.fileId || String(fileId),
          byteLength: result.byteLength || bytes.length
        };
      } catch (error) {
        console.error('[GasService] 檔案下載發生錯誤:', error);
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
     * 📤「教材/Layout 搭配」的「產生並上傳」專用：把瀏覽器現算出來的 meta.json／script.txt
     * 直接寫進「已知 folderId」的那個教材資料夾本身——刻意**不**傳 subFolderName（留空／不傳），
     * 對接 Code.gs upload_file 的「else：不動 folder」直寫分支（跟學生 ApiService.uploadToGAS
     * 直寫 01_Submissions 同一套語意）。⚠️ 不要沿用 uploadStudentLocalFile 的預設參數呼叫這裡——
     * 它的 subFolderName 預設是 '01_Class_Resources'，若疏忽沒覆寫會把教材檔案寫進資料夾
     * 底下多一層 01_Class_Resources 子夾，而不是直接寫進該教材資料夾本身。
     */
    async uploadMaterialFile(base64, fileName, mimeType, folderId) {
      try {
        const payload = {
          action: 'upload_file',
          fileData: base64,
          fileName: fileName,
          mimeType: mimeType,
          folderId: folderId
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
        return { fileId: result.fileId, fileUrl: result.fileUrl, finalFileName: result.finalFileName };
      } catch (error) {
        console.error('[GasService] 教材檔案上傳發生錯誤:', error);
        throw error;
      }
    },

    /**
     * 📁「教材/Layout 搭配」的「產生並上傳」專用：確保「教材根／某個教材資料夾名稱」這條路徑
     * 存在（不存在就沿路建立），對接既有 create_folder 路由的 folderPath 陣列參數
     * （resolveFolderPath：從 parentFolderId 開始，依序 getOrCreateSubFolder 每一段）。
     * rootFolderId 必須是「老師個人 Drive 根」或「班級 Drive 根」（FeatureTimeline.
     * resolveMaterialsRootFolderId 拿到的那一層，不是 01_My_Materials/00_Class_Materials 本身）；
     * materialsRootName 決定中間那一層是 01_My_Materials 還是 00_Class_Materials。
     */
    async ensureMaterialFolder(rootFolderId, materialsRootName, materialFolderName) {
      try {
        const payload = {
          action: 'create_folder',
          folderName: materialFolderName,
          parentFolderId: rootFolderId,
          folderPath: [materialsRootName]
        };
        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.message || 'GAS 伺服器建立教材資料夾失敗');
        }
        return { folderId: result.folderId, folderUrl: result.folderUrl };
      } catch (error) {
        console.error('[GasService] 建立教材資料夾發生錯誤:', error);
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
     * 📦 核心功能 5：Excel(_Schema/_Publish) → 班級 00 或老師 01
     * @param {string} rootKind 'class' | 'teacher'
     */
    async publishMaterial(sourceFileId, targetFolderId, rootKind = 'class') {
      try {
        const payload = {
          action: 'publish_material',
          sourceFileId: sourceFileId,
          targetFolderId: targetFolderId,
          rootKind: rootKind === 'teacher' ? 'teacher' : 'class'
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

    /**
     * 回傳值刻意仍是「陣列」（相容既有呼叫端 collectMaterialMetaOptions(materials, kind) 直接
     * forEach 用），但額外把除錯欄位（debugVersion/resolvedRootId/resolvedRootName/
     * subFolderCount）掛在陣列物件本身上（JS 陣列本質是物件，掛額外屬性不影響
     * forEach/map/length 等陣列語意）——2026-08-06：老師連續回報「教材資料夾下拉是空的」，
     * 但看不到 GAS 執行環境，前端只能猜。這幾個欄位讓「清單是空的」變成可驗證、可回報的
     * 具體線索：debugVersion 沒出現＝GAS 網頁應用程式還在跑舊部署（要重新部署，不是程式碼問題）；
     * resolvedRootId 可直接貼進 drive.google.com/drive/folders/<ID> 比對系統到底看到哪個資料夾。
     */
    async listMaterialMasters(targetFolderId, rootKind = 'class') {
      const result = await postGasJson({
        action: 'list_material_masters',
        targetFolderId: targetFolderId,
        rootKind: rootKind === 'teacher' ? 'teacher' : 'class'
      });
      const materials = result.materials || [];
      materials.debugVersion = result.debugVersion || '';
      materials.resolvedRootId = result.resolvedRootId || '';
      materials.resolvedRootName = result.resolvedRootName || '';
      materials.subFolderCount = (typeof result.subFolderCount === 'number') ? result.subFolderCount : materials.length;
      return materials;
    },

    /**
     * 讀單一教材檔。優先 fileId（不依賴資料夾名）；否則走 targetFolderId + materialFolder + fileName。
     * opts: { fileId } 或第四參之後相容舊呼叫。
     */
    async readMaterialFile(targetFolderId, materialFolder, fileName, rootKind = 'class', opts) {
      const options = opts || {};
      const payload = {
        action: 'read_material_file',
        rootKind: rootKind === 'teacher' ? 'teacher' : 'class'
      };
      if (options.fileId) {
        payload.fileId = String(options.fileId).trim();
      } else {
        payload.targetFolderId = targetFolderId;
        payload.materialFolder = materialFolder || '';
        payload.fileName = fileName;
      }
      return postGasJson(payload);
    },

    /** 一批讀多個 meta／layout（一次 GAS 往返） */
    async readMaterialFiles(targetFolderId, items, rootKind = 'class') {
      const result = await postGasJson({
        action: 'read_material_files',
        targetFolderId: targetFolderId,
        rootKind: rootKind === 'teacher' ? 'teacher' : 'class',
        items: (items || []).map(function (it) {
          return {
            materialFolder: (it && (it.materialFolder || it.material_folder)) || '',
            fileName: (it && it.fileName) || '',
            fileId: (it && it.fileId) || ''
          };
        })
      });
      return result.files || [];
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
    },

    async listChildFolders(parentFolderId) {
      const payload = {
        action: 'list_child_folders',
        parentFolderId: parentFolderId
      };
      const response = await fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.status !== 'success') {
        throw new Error(result.message || '無法列出子資料夾');
      }
      return result;
    }
  };
})();
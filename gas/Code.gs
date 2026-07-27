/**
 * 📂 檔案：gas/Code.gs (Google Apps Script)
 * 🌟 SaaS 隱私隔離與單點權限開放版 + stream_audio 音檔代理 + extract_sheet + publish_material
 * ⚠️ 部署：貼至 GAS 專案 → 部署為網路應用程式 → 「任何人」可存取
 * ⚠️ Drive 鐵律：所有自動建立的路徑必須在 _LogOnEnglish 底下（單一根目錄）
 */

var DRIVE_ROOT = '_LogOnEnglish';

/** 正規化並強制所有路徑落在 _LogOnEnglish 下；缺省為 _LogOnEnglish/_std */
function normalizeDrivePath(pathArray) {
  if (!pathArray || !pathArray.length) {
    return [DRIVE_ROOT, '_std'];
  }
  var parts = pathArray.slice();
  if (parts[0] === 'LogOnEnglish' || parts[0] === '_LOE') {
    parts[0] = DRIVE_ROOT;
  }
  if (parts[0] !== DRIVE_ROOT) {
    throw new Error('系統僅允許在 _LogOnEnglish 資料夾下建立內容');
  }
  return parts;
}

/** 解析 Drive 根資料夾：優先 _LogOnEnglish，其次沿用既有 _LOE，否則新建 _LogOnEnglish */
function resolveDriveRootFolder() {
  var parent = DriveApp.getRootFolder();
  var preferred = parent.getFoldersByName(DRIVE_ROOT);
  if (preferred.hasNext()) return preferred.next();
  var legacy = parent.getFoldersByName('_LOE');
  if (legacy.hasNext()) return legacy.next();
  return parent.createFolder(DRIVE_ROOT);
}

function getOrCreateSubFolder(parentFolder, subFolderName) {
  if (!subFolderName) return parentFolder;
  var cleanName = String(subFolderName).replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!cleanName) return parentFolder;
  var subFolders = parentFolder.getFoldersByName(cleanName);
  if (subFolders.hasNext()) {
    return subFolders.next();
  }
  return parentFolder.createFolder(cleanName);
}

/**
 * 學生專屬資料夾：需「知道連結可編輯」才能自行上傳；僅 VIEW 會出現要求存取。
 * 若提供 Google 信箱，一併加入編輯者（適用 Workspace 禁止公開連結的學校）。
 */
function ensureFolderPublicAccess(folderId, options) {
  options = options || {};
  var permission = options.permission ? String(options.permission).toLowerCase() : 'edit';
  var emails = options.shareEmails || options.shareEmail || [];
  if (typeof emails === 'string') emails = [emails];

  var folder = DriveApp.getFolderById(folderId);
  var drivePerm = permission === 'view'
    ? DriveApp.Permission.VIEW
    : DriveApp.Permission.EDIT;
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, drivePerm);

  var addedEditors = [];
  for (var i = 0; i < emails.length; i++) {
    var email = String(emails[i] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;
    try {
      folder.addEditor(email);
      addedEditors.push(email);
    } catch (editorErr) {
      // 非 Google 帳號或網域限制時略過
    }
  }

  return {
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    permission: permission,
    addedEditors: addedEditors
  };
}

function extractSheetText(fileId, sheetName, rangeStr) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(fileId);
  } catch (openErr) {
    throw new Error('無法開啟試算表。請確認為 Google Sheets，或已將 Excel 匯入試算表。');
  }

  var targetSheetName = sheetName ? String(sheetName) : 'Sheet1';
  var targetRange = rangeStr ? String(rangeStr) : 'A1:Z2000';
  var sheet = ss.getSheetByName(targetSheetName);
  if (!sheet) {
    throw new Error('找不到活頁：' + targetSheetName);
  }

  var values = sheet.getRange(targetRange).getValues();
  var lines = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var parts = [];
    var hasContent = false;
    for (var j = 0; j < row.length; j++) {
      var cell = row[j];
      if (cell === null || cell === undefined) {
        parts.push('');
      } else {
        parts.push(String(cell));
        if (String(cell).trim() !== '') hasContent = true;
      }
    }
    if (hasContent) {
      lines.push(parts.join('\t'));
    }
  }

  return {
    extractedText: lines.join('\n'),
    rowCount: lines.length
  };
}

function getOrCreatePath(pathArray) {
  var parts = normalizeDrivePath(pathArray);
  var currentFolder = resolveDriveRootFolder();
  for (var i = 1; i < parts.length; i++) {
    currentFolder = getOrCreateSubFolder(currentFolder, parts[i]);
  }
  return currentFolder;
}

function findSubFolder(parentFolder, subFolderName) {
  if (!parentFolder || !subFolderName) return null;
  var subFolders = parentFolder.getFoldersByName(String(subFolderName));
  if (subFolders.hasNext()) return subFolders.next();
  return null;
}

/** 班級教材母稿夾：標準名 00_Class_Materials；若仍為舊名 00_Material_Masters 則自動改名對齊 */
var CLASS_MATERIALS_FOLDER = '00_Class_Materials';
var CLASS_MATERIALS_FOLDER_LEGACY = '00_Material_Masters';

/** 班級資源夾：標準名 01_Class_Resources；舊名 01_Materials 自動改名合併 */
var CLASS_RESOURCES_FOLDER = '01_Class_Resources';
var CLASS_RESOURCES_FOLDER_LEGACY = '01_Materials';

function resolveClassMaterialsFolder(classFolder, createIfMissing) {
  if (!classFolder) return null;
  var preferred = findSubFolder(classFolder, CLASS_MATERIALS_FOLDER);
  if (preferred) return preferred;
  var legacy = findSubFolder(classFolder, CLASS_MATERIALS_FOLDER_LEGACY);
  if (legacy) {
    try {
      legacy.setName(CLASS_MATERIALS_FOLDER);
    } catch (_renameErr) {}
    return legacy;
  }
  if (createIfMissing) {
    return getOrCreateSubFolder(classFolder, CLASS_MATERIALS_FOLDER);
  }
  return null;
}

function resolveClassResourcesFolder(classFolder, createIfMissing) {
  if (!classFolder) return null;
  var preferred = findSubFolder(classFolder, CLASS_RESOURCES_FOLDER);
  if (preferred) {
    // 若舊夾還在，不再自動搬檔（避免重複）；僅使用標準夾
    return preferred;
  }
  var legacy = findSubFolder(classFolder, CLASS_RESOURCES_FOLDER_LEGACY);
  if (legacy) {
    try {
      legacy.setName(CLASS_RESOURCES_FOLDER);
    } catch (_renameErr) {}
    return legacy;
  }
  if (createIfMissing) {
    return getOrCreateSubFolder(classFolder, CLASS_RESOURCES_FOLDER);
  }
  return null;
}

function resolveFolderPath(parentFolder, pathArray) {
  var current = parentFolder;
  if (!pathArray || !pathArray.length) return current;
  for (var i = 0; i < pathArray.length; i++) {
    current = getOrCreateSubFolder(current, pathArray[i]);
  }
  return current;
}

function listMaterialMasters(classFolderId) {
  var classFolder = DriveApp.getFolderById(classFolderId);
  var mastersRoot = resolveClassMaterialsFolder(classFolder, false);
  if (!mastersRoot) {
    return { materials: [] };
  }

  var materials = [];
  var subFolders = mastersRoot.getFolders();
  while (subFolders.hasNext()) {
    var sub = subFolders.next();
    var manifest = null;
    var manifestFiles = sub.getFilesByName('_manifest.json');
    if (manifestFiles.hasNext()) {
      try {
        manifest = JSON.parse(manifestFiles.next().getBlob().getDataAsString('UTF-8'));
      } catch (manifestErr) {
        manifest = null;
      }
    }

    var metaFiles = [];
    var files = sub.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var fileName = file.getName();
      if (fileName.indexOf('.meta.json') !== -1) {
        metaFiles.push({ name: fileName, fileId: file.getId() });
      }
    }

    materials.push({
      folderName: sub.getName(),
      folderId: sub.getId(),
      manifest: manifest,
      metaFiles: metaFiles
    });
  }

  return { materials: materials };
}

function readMaterialFile(classFolderId, materialFolderName, fileName) {
  var classFolder = DriveApp.getFolderById(classFolderId);
  var mastersRoot = resolveClassMaterialsFolder(classFolder, false);
  if (!mastersRoot) {
    throw new Error('找不到 00_Class_Materials，請先發布教材。');
  }

  var targetFolder = mastersRoot;
  if (materialFolderName) {
    var named = findSubFolder(mastersRoot, materialFolderName);
    if (!named) throw new Error('找不到教材子資料夾：' + materialFolderName);
    targetFolder = named;
  }

  var cleanName = String(fileName || '').trim();
  if (!cleanName) throw new Error('缺少 fileName');

  var matches = targetFolder.getFilesByName(cleanName);
  if (!matches.hasNext()) {
    throw new Error('找不到檔案：' + cleanName);
  }

  var file = matches.next();
  return {
    fileName: cleanName,
    fileId: file.getId(),
    content: file.getBlob().getDataAsString('UTF-8'),
    mimeType: file.getMimeType()
  };
}

/** 老師工作區根目錄：統一 _Teachers（若有舊名 Teachers 則改名對齊） */
function resolveTeachersRootFolder() {
  var root = resolveDriveRootFolder();
  var preferred = root.getFoldersByName('_Teachers');
  if (preferred.hasNext()) return preferred.next();
  var legacy = root.getFoldersByName('Teachers');
  if (legacy.hasNext()) {
    var oldFolder = legacy.next();
    oldFolder.setName('_Teachers');
    return oldFolder;
  }
  return root.createFolder('_Teachers');
}

function ensureTeacherWorkspace(teacherName, teacherShortId) {
  var teachersRoot = resolveTeachersRootFolder();
  var safeName = String(teacherName || 'Teacher').replace(/[\\/:*?"<>|]/g, '_').trim();
  var shortId = String(teacherShortId || '0000').slice(-4);
  var teacherFolder = getOrCreateSubFolder(teachersRoot, safeName + '_' + shortId);
  getOrCreateSubFolder(teacherFolder, '00_My_Resources');
  getOrCreateSubFolder(teacherFolder, '01_My_Materials');
  return {
    folderId: teacherFolder.getId(),
    folderUrl: teacherFolder.getUrl()
  };
}

function doGet(e) {
  try {
    var params = e ? e.parameter : {};
    var action = params.action ? String(params.action) : '';

    if (action === 'stream_audio') {
      var fileId = params.fileId ? String(params.fileId).trim() : '';
      if (!fileId) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Missing fileId' }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var mimeType = blob.getContentType();
      if (!mimeType) mimeType = 'audio/wav';
      if (mimeType === 'text/plain') mimeType = 'audio/wav';

      return ContentService.createBinaryOutput(blob.getBytes()).setMimeType(mimeType);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'LogOn GAS Online' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("沒有收到任何資料");
    }

    var data = JSON.parse(e.postData.contents);
    var action = data.action ? data.action : 'upload_file';

    if (action === 'create_folder') {
      var folderName = data.folderName;
      var parentFolderId = data.parentFolderId;
      var requireShare = data.requireShare ? data.requireShare : false;

      var cleanFolderName = folderName.replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!cleanFolderName) cleanFolderName = "未命名資料夾";

      var folderPath = data.folderPath || data.relativePath || null;
      var rootPath = data.rootPath || null;
      var newFolder;

      if (parentFolderId) {
        var parentFolder = DriveApp.getFolderById(parentFolderId);
        if (folderPath && folderPath.length) {
          var chainParent = resolveFolderPath(parentFolder, folderPath);
          newFolder = getOrCreateSubFolder(chainParent, cleanFolderName);
        } else {
          newFolder = parentFolder.createFolder(cleanFolderName);
        }
        if (requireShare) {
          ensureFolderPublicAccess(newFolder.getId(), {
            permission: 'edit',
            shareEmails: data.shareEmails || data.shareEmail || []
          });
        }
      } else if (rootPath && rootPath.length) {
        var rootFolder = getOrCreatePath(rootPath);
        if (folderPath && folderPath.length) {
          var nestedParent = resolveFolderPath(rootFolder, folderPath);
          newFolder = getOrCreateSubFolder(nestedParent, cleanFolderName);
        } else {
          newFolder = getOrCreateSubFolder(rootFolder, cleanFolderName);
        }
      } else {
        var targetRootFolder = getOrCreatePath(null);
        newFolder = getOrCreateSubFolder(targetRootFolder, cleanFolderName);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: newFolder.getId(),
        folderUrl: newFolder.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'rename_folder') {
      var renameFolderId = data.folderId ? String(data.folderId).trim() : '';
      var renameFolderName = data.folderName ? String(data.folderName) : '';
      if (!renameFolderId || !renameFolderName) {
        throw new Error('缺少 folderId 或 folderName');
      }
      var cleanRename = renameFolderName.replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!cleanRename) cleanRename = '未命名資料夾';
      var renameTarget = DriveApp.getFolderById(renameFolderId);
      if (renameTarget.isTrashed()) {
        throw new Error('資料夾已在垃圾桶，無法重新命名');
      }
      renameTarget.setName(cleanRename);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: renameTarget.getId(),
        folderName: renameTarget.getName(),
        folderUrl: renameTarget.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 學生 v2：drive_folder_id 指向 01_Submissions，改名應改父層「姓名_短ID」
    if (action === 'rename_parent_folder') {
      var childFolderId = data.folderId ? String(data.folderId).trim() : '';
      var parentNewName = data.folderName ? String(data.folderName) : '';
      if (!childFolderId || !parentNewName) {
        throw new Error('缺少 folderId 或 folderName');
      }
      var cleanParentName = parentNewName.replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!cleanParentName) cleanParentName = '未命名資料夾';
      var childFolder = DriveApp.getFolderById(childFolderId);
      if (childFolder.isTrashed()) {
        throw new Error('資料夾已在垃圾桶，無法重新命名');
      }
      var parents = childFolder.getParents();
      if (!parents.hasNext()) {
        throw new Error('找不到上層資料夾，無法重新命名');
      }
      var parentFolder = parents.next();
      parentFolder.setName(cleanParentName);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: parentFolder.getId(),
        folderName: parentFolder.getName(),
        folderUrl: parentFolder.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'migrate_student_data') {
      var pFolderId = data.parentFolderId;
      var studentName = data.studentName ? data.studentName : "學生";
      var studentShortId = data.studentShortId ? data.studentShortId : "0000";
      var oldFolderId = data.oldFolderId;

      var cleanName = studentName.replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
      var targetFolderName = cleanName + "_" + studentShortId;
      var parentFolder = DriveApp.getFolderById(pFolderId);
      var studentsRoot = findSubFolder(parentFolder, '02_Students');
      var newStudentFolder;

      if (studentsRoot) {
        var studentDir = getOrCreateSubFolder(studentsRoot, targetFolderName);
        newStudentFolder = getOrCreateSubFolder(studentDir, '01_Submissions');
      } else {
        newStudentFolder = getOrCreateSubFolder(parentFolder, targetFolderName);
      }

      ensureFolderPublicAccess(newStudentFolder.getId(), {
        permission: 'edit',
        shareEmails: data.shareEmails || data.shareEmail || []
      });

      var movedCount = 0;
      var actualOldId = oldFolderId;
      if (oldFolderId && oldFolderId.indexOf('folders/') !== -1) {
        actualOldId = oldFolderId.split('folders/')[1].split('?')[0].split('/')[0];
      }

      if (actualOldId && actualOldId.length > 10) {
        try {
          var oldFolder = DriveApp.getFolderById(actualOldId);
          if (!oldFolder.isTrashed()) {
            var files = oldFolder.getFiles();
            while (files.hasNext()) {
              var file = files.next();
              var oldName = file.getName();

              var cleanFileName = oldName.replace(/<[^>]*>?/gm, '');
              try { cleanFileName = decodeURIComponent(cleanFileName); } catch(e2) {}
              cleanFileName = cleanFileName.replace(/[\\/:*?"<>|]/g, '_');
              cleanFileName = cleanFileName.replace(/\s+/g, ' ').trim();

              if (!cleanFileName) cleanFileName = studentName + "_已修復作業_" + new Date().getTime();

              if (cleanFileName !== oldName) file.setName(cleanFileName);
              file.moveTo(newStudentFolder);
              movedCount++;
            }
          }
        } catch(e3) {}
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: newStudentFolder.getId(),
        folderUrl: newStudentFolder.getUrl(),
        movedCount: movedCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'extract_sheet') {
      var extractFileId = data.fileId ? String(data.fileId).trim() : '';
      if (!extractFileId) {
        throw new Error('缺少 fileId');
      }
      var extractSheetName = data.sheetName ? data.sheetName : 'Sheet1';
      var extractRange = data.range ? data.range : 'A1:Z2000';
      var extractResult = extractSheetText(extractFileId, extractSheetName, extractRange);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        extractedText: extractResult.extractedText,
        rowCount: extractResult.rowCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'publish_material') {
      var sourceFileId = data.sourceFileId ? String(data.sourceFileId).trim() : '';
      var targetFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      if (!sourceFileId || !targetFolderId) {
        throw new Error('缺少 sourceFileId 或 targetFolderId');
      }
      var pubResult = publishMaterialFromWorkbook(sourceFileId, targetFolderId);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: pubResult.folderId,
        folderUrl: pubResult.folderUrl,
        manifest: pubResult.manifest
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'ensure_folder_sharing') {
      var shareFolderId = data.folderId ? String(data.folderId).trim() : '';
      if (!shareFolderId) {
        throw new Error('缺少 folderId');
      }
      var shareResult = ensureFolderPublicAccess(shareFolderId, {
        permission: data.permission || 'edit',
        shareEmails: data.shareEmails || data.shareEmail || []
      });
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: shareResult.folderId,
        folderUrl: shareResult.folderUrl,
        permission: shareResult.permission,
        addedEditors: shareResult.addedEditors
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'list_material_masters') {
      var listFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      if (!listFolderId) throw new Error('缺少 targetFolderId');
      var listResult = listMaterialMasters(listFolderId);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        materials: listResult.materials
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'read_material_file') {
      var readClassFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      var readMaterialFolder = data.materialFolder ? String(data.materialFolder).trim() : '';
      var readFileName = data.fileName ? String(data.fileName).trim() : '';
      if (!readClassFolderId || !readFileName) {
        throw new Error('缺少 targetFolderId 或 fileName');
      }
      var readResult = readMaterialFile(readClassFolderId, readMaterialFolder, readFileName);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileName: readResult.fileName,
        fileId: readResult.fileId,
        content: readResult.content
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'ensure_teacher_workspace') {
      var teacherName = data.teacherName ? String(data.teacherName) : 'Teacher';
      var teacherShortId = data.teacherShortId ? String(data.teacherShortId) : '0000';
      var teacherWs = ensureTeacherWorkspace(teacherName, teacherShortId);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: teacherWs.folderId,
        folderUrl: teacherWs.folderUrl
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'upload_file') {
      var fileData = data.fileData;
      var rawFileName = data.fileName;
      var mimeType = data.mimeType;
      var folderId = data.folderId;
      var subFolderName = data.subFolderName ? data.subFolderName : '';
      var assignmentId = data.assignmentId ? data.assignmentId : "";
      var taskId = data.taskId ? data.taskId : "";

      var cleanFileName = rawFileName.replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!cleanFileName) cleanFileName = "未命名上傳檔案";

      var folder;
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (folderErr) {
        throw new Error("找不到指定的資料夾，或權限不足 (Folder ID: " + folderId + ")");
      }

      // 班級資源／舊 01_Materials：統一收納到 01_Class_Resources
      if (!subFolderName
          || subFolderName === CLASS_RESOURCES_FOLDER
          || subFolderName === CLASS_RESOURCES_FOLDER_LEGACY) {
        folder = resolveClassResourcesFolder(folder, true);
      } else {
        folder = getOrCreateSubFolder(folder, subFolderName);
      }

      var existingFiles = folder.getFilesByName(cleanFileName);
      while (existingFiles.hasNext()) {
        existingFiles.next().setTrashed(true);
      }

      var decodedData = Utilities.base64Decode(fileData);
      var blob = Utilities.newBlob(decodedData, mimeType, cleanFileName);
      var file = folder.createFile(blob);

      var lowerName = cleanFileName.toLowerCase();
      var isAudio = mimeType.indexOf('audio/') === 0
        || lowerName.indexOf('.wav') > -1
        || lowerName.indexOf('.mp3') > -1
        || lowerName.indexOf('.m4a') > -1;
      if (isAudio) {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }

      if (assignmentId && taskId) {
        file.setDescription(JSON.stringify({
          assignment_id: assignmentId,
          task_id: taskId
        }));
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileId: file.getId(),
        fileUrl: file.getUrl(),
        finalFileName: cleanFileName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    throw new Error("未知的操作指令 (action: " + action + ")");

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

// ==========================================
// Material 發布：Excel(_Schema/_Publish) → meta.json + script.txt
// ==========================================

function colLetterToIndex(col) {
  if (!col) return -1;
  var s = String(col).trim().toUpperCase();
  if (!s) return -1;
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n - 1;
}

function isTruthyYN(val) {
  var s = String(val === undefined || val === null ? '' : val).trim().toUpperCase();
  return s === 'Y' || s === 'YES' || s === '1' || s === '是';
}

function normalizeHeaderKey(str) {
  return String(str || '').trim().toLowerCase();
}

function readSheetAsMap(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error('找不到活頁：' + sheetName);
  }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function(h) { return normalizeHeaderKey(h); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = values[r][c];
      if (v !== '' && v !== null && v !== undefined) empty = false;
      obj[headers[c]] = v;
    }
    if (!empty) rows.push(obj);
  }
  return rows;
}

function readMaterialConfig(ss) {
  var rows = readSheetAsMap(ss, '_Config');
  var cfg = { material_folder: 'GEPT-2_vocab', last_row_column: 'A' };
  rows.forEach(function(r) {
    var k = String(r.key || '').trim();
    var v = r.value;
    if (k === 'material_folder' && v) cfg.material_folder = String(v).trim();
    if (k === 'last_row_column' && v) cfg.last_row_column = String(v).trim();
  });
  return cfg;
}

function readSchemaDefinitions(ss) {
  var rows = readSheetAsMap(ss, '_Schema');
  var bySchema = {};
  rows.forEach(function(r) {
    var sid = String(r.schema_id || '').trim();
    if (!sid) return;
    if (!bySchema[sid]) bySchema[sid] = [];
    bySchema[sid].push({
      semantic_key: String(r.semantic_key || '').trim(),
      excel_col: String(r.excel_col || '').trim(),
      send_to_ai: isTruthyYN(r.send_to_ai),
      display: isTruthyYN(r.display)
    });
  });
  return bySchema;
}

function readPublishRules(ss) {
  return readSheetAsMap(ss, '_Publish').filter(function(r) {
    return isTruthyYN(r.enabled);
  });
}

function getLastDataRow(sheet, colLetter) {
  var col = colLetterToIndex(colLetter);
  if (col < 0) col = 0;
  var last = sheet.getLastRow();
  for (var r = last; r >= 1; r--) {
    var v = sheet.getRange(r, col + 1).getValue();
    if (v !== '' && v !== null && v !== undefined) return r;
  }
  return 1;
}

function openSpreadsheetForPublish(sourceFileId) {
  var file = DriveApp.getFileById(sourceFileId);
  var mime = file.getMimeType();
  if (mime === 'application/vnd.google-apps.spreadsheet') {
    return { ss: SpreadsheetApp.openById(sourceFileId), tempId: null };
  }
  if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.insert) {
    var blob = file.getBlob();
    var resource = {
      title: '_temp_publish_' + new Date().getTime(),
      mimeType: 'application/vnd.google-apps.spreadsheet'
    };
    var inserted = Drive.Files.insert(resource, blob, { convert: true });
    return { ss: SpreadsheetApp.openById(inserted.id), tempId: inserted.id };
  }
  throw new Error('此檔案不是 Google 試算表。請在 Drive 以 Google 試算表開啟 Excel，或在 GAS 啟用進階服務 Drive API。');
}

function buildMaterialRowsFromSource(ss, rule, schemaFields, cfg) {
  var sheetName = String(rule.source_sheet || '').trim();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到來源活頁：' + sheetName);

  var startRow = parseInt(rule.row_start, 10);
  if (isNaN(startRow) || startRow < 1) startRow = 2;

  var endRaw = String(rule.row_end || 'LAST').trim().toUpperCase();
  var endRow = endRaw === 'LAST'
    ? getLastDataRow(sheet, cfg.last_row_column)
    : parseInt(endRaw, 10);
  if (isNaN(endRow) || endRow < startRow) {
    throw new Error('列範圍無效：' + sheetName + ' (' + startRow + '-' + endRaw + ')');
  }

  var hasScriptMapping = false;
  schemaFields.forEach(function(f) {
    if (f.semantic_key === 'script' && f.excel_col) hasScriptMapping = true;
  });
  if (!hasScriptMapping) throw new Error('schema 缺少 script 欄位映射');

  var out = [];
  for (var r = startRow; r <= endRow; r++) {
    var rowObj = { _source_row: r };
    var hasScript = false;

    schemaFields.forEach(function(f) {
      if (!f.semantic_key || !f.excel_col) return;
      var ci = colLetterToIndex(f.excel_col);
      if (ci < 0) return;
      var val = sheet.getRange(r, ci + 1).getValue();
      if (val === '' || val === null || val === undefined) return;
      rowObj[f.semantic_key] = val;
      if (f.semantic_key === 'script') hasScript = true;
    });

    if (hasScript) out.push(rowObj);
  }
  return out;
}

function writeDriveTextFile(folder, fileName, content, mimeType) {
  var mt = mimeType ? mimeType : MimeType.PLAIN_TEXT;
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  folder.createFile(fileName, content, mt);
}

function publishMaterialFromWorkbook(sourceFileId, targetFolderId) {
  var opened = openSpreadsheetForPublish(sourceFileId);
  var ss = opened.ss;

  try {
    var cfg = readMaterialConfig(ss);
    var schemas = readSchemaDefinitions(ss);
    var rules = readPublishRules(ss);
    if (rules.length === 0) {
      throw new Error('_Publish 沒有 enabled=Y 的規則');
    }

    var root = DriveApp.getFolderById(targetFolderId);
    var materialRoot = resolveClassMaterialsFolder(root, true);
    var materialFolder = getOrCreateSubFolder(materialRoot, cfg.material_folder);

    var outputs = [];
    var now = new Date().toISOString();

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var sid = String(rule.schema_id || '').trim();
      var fields = schemas[sid];
      if (!fields || fields.length === 0) {
        throw new Error('找不到 schema_id：' + sid);
      }

      var rows = buildMaterialRowsFromSource(ss, rule, fields, cfg);
      var metaName = String(rule.output_meta || '').trim();
      var txtName = String(rule.output_txt || '').trim();

      var cleanRows = rows.map(function(row) {
        var copy = {};
        Object.keys(row).forEach(function(k) {
          if (k.indexOf('_') === 0) return;
          copy[k] = row[k];
        });
        return copy;
      });

      if (metaName) {
        writeDriveTextFile(materialFolder, metaName, JSON.stringify(cleanRows, null, 2), MimeType.PLAIN_TEXT);
      }
      if (txtName) {
        var lines = rows.map(function(row) {
          return String(row.script || '').trim();
        }).filter(function(line) { return line !== ''; });
        writeDriveTextFile(materialFolder, txtName, lines.join('\n'), MimeType.PLAIN_TEXT);
      }

      outputs.push({
        source_sheet: rule.source_sheet,
        meta: metaName,
        txt: txtName,
        rowCount: rows.length,
        schema_id: sid
      });
    }

    var manifest = {
      published_at: now,
      source_file_id: sourceFileId,
      material_folder: cfg.material_folder,
      outputs: outputs
    };
    writeDriveTextFile(materialFolder, '_manifest.json', JSON.stringify(manifest, null, 2), MimeType.PLAIN_TEXT);

    return {
      folderId: materialFolder.getId(),
      folderUrl: materialFolder.getUrl(),
      manifest: manifest
    };
  } finally {
    if (opened.tempId) {
      try {
        DriveApp.getFileById(opened.tempId).setTrashed(true);
      } catch (cleanupErr) {}
    }
  }
}

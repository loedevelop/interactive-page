/**
 * 📂 檔案：gas/Code.gs (Google Apps Script)
 * 🌟 SaaS 隱私隔離與單點權限開放版 + stream_audio 音檔代理
 * ⚠️ 部署：貼至 GAS 專案 → 部署為網路應用程式 → 「任何人」可存取
 */

function getOrCreatePath(pathArray) {
  var currentFolder = DriveApp.getRootFolder();
  for (var i = 0; i < pathArray.length; i++) {
    var folderName = pathArray[i];
    var folders = currentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      currentFolder = folders.next();
    } else {
      currentFolder = currentFolder.createFolder(folderName);
    }
  }
  return currentFolder;
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

      var newFolder;
      if (parentFolderId) {
        newFolder = DriveApp.getFolderById(parentFolderId).createFolder(cleanFolderName);
        if (requireShare) {
          newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        }
      } else {
        var targetRootFolder = getOrCreatePath(["_LOE", "_std"]);
        newFolder = targetRootFolder.createFolder(cleanFolderName);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: newFolder.getId(),
        folderUrl: newFolder.getUrl()
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
      var newStudentFolder = parentFolder.createFolder(targetFolderName);

      newStudentFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

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

    if (action === 'upload_file') {
      var fileData = data.fileData;
      var rawFileName = data.fileName;
      var mimeType = data.mimeType;
      var folderId = data.folderId;
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

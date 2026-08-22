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

/**
 * 短時間內連續對同一資料夾寫入（例如學生一次複選多檔上傳）時，
 * Drive 偶爾會丟出暫時性的「存取遭拒／速率限制」例外；對這類錯誤自動重試，
 * 其餘（如真的權限不足、資料夾不存在）維持原樣直接拋出。
 */
function retryDriveWrite(fn, maxAttempts, baseDelayMs) {
  maxAttempts = maxAttempts || 3;
  baseDelayMs = baseDelayMs || 800;
  var lastErr;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      var msg = String((err && err.message) ? err.message : err);
      var isTransient = /存取遭拒|拒絕存取|rate limit|too many requests|internal error|temporarily|請稍後再試/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw err;
      Utilities.sleep(baseDelayMs * attempt);
    }
  }
  throw lastErr;
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

/** 老師個人教材母稿夾（工作區根下） */
var TEACHER_MATERIALS_FOLDER = '01_My_Materials';

/** 班級資源夾：標準名 01_Class_Resources；舊名 01_Materials 自動改名合併 */
var CLASS_RESOURCES_FOLDER = '01_Class_Resources';
var CLASS_RESOURCES_FOLDER_LEGACY = '01_Materials';

function normalizeMaterialsRootKind(rootKind) {
  var k = String(rootKind || 'class').trim().toLowerCase();
  if (k === 'teacher' || k === 'teacher_workspace' || k === '01' || k === 'my_materials') return 'teacher';
  return 'class';
}

function resolveClassMaterialsFolder(classFolder, createIfMissing) {
  if (!classFolder) return null;
  var preferred = findSubFolderInsensitive(classFolder, CLASS_MATERIALS_FOLDER);
  if (preferred) return preferred;
  var legacy = findSubFolderInsensitive(classFolder, CLASS_MATERIALS_FOLDER_LEGACY);
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

/**
 * rootKind=class → 00_Class_Materials；rootKind=teacher → 01_My_Materials
 *
 * 💣 2026-08-06 雷區：老師實測回報「教材資料夾下拉一直是空的」，即使已經在 Drive 裡真的建好
 * 子資料夾。追查後這裡至少有兩個會讓「明明有資料夾卻查不到」的脆弱點（跟 listMaterialMasters
 * 本身「不要求要有 .meta.json 才列出」是兩件不同的事，那部分已經沒問題）：
 * 1. findSubFolder 用 getFoldersByName 是「精確比對」——老師手動在 Drive 網頁上建資料夾時，
 *    只要打錯一個空格、大小寫跟系統期待的 "01_My_Materials" 不完全一樣，就永遠找不到，
 *    後面 subFolders.getFolders() 根本沒機會執行到，等於整層資料夾都消失。
 * 2. createIfMissing 舊行為是「找不到就回 null」——只要 01_My_Materials 這一層本身還沒被
 *    任何流程建立過（例如老師是全新帳號，第一次用這個功能），listMaterialMasters 會直接回
 *    空陣列，即使老師已經在 Drive 別的地方手動建了子資料夾，也完全看不到、無從除錯。
 * 修法：一律用不分大小寫比對（findSubFolderInsensitive）+ 一律 createIfMissing（找不到就現場
 * 建立，getOrCreateSubFolder 天生 idempotent，不會重複建立、不會動到既有資料）。
 */
function resolveMaterialsRoot(rootFolder, rootKind, createIfMissing) {
  if (!rootFolder) return null;
  var kind = normalizeMaterialsRootKind(rootKind);
  var rootName = '';
  try { rootName = String(rootFolder.getName() || ''); } catch (_nameErr) { rootName = ''; }

  // 若傳進來的已經是教材根（綁定到子夾時），不要再往下找一層
  if (kind === 'teacher' && rootName === TEACHER_MATERIALS_FOLDER) return rootFolder;
  if (kind !== 'teacher' && (rootName === CLASS_MATERIALS_FOLDER || rootName === CLASS_MATERIALS_FOLDER_LEGACY)) {
    return rootFolder;
  }

  if (kind === 'teacher') {
    var teacherMats = findSubFolderInsensitive(rootFolder, TEACHER_MATERIALS_FOLDER);
    if (teacherMats) return teacherMats;
    if (createIfMissing) return getOrCreateSubFolder(rootFolder, TEACHER_MATERIALS_FOLDER);
    return null;
  }
  return resolveClassMaterialsFolder(rootFolder, createIfMissing);
}

/** 不分大小寫找子資料夾 */
function findSubFolderInsensitive(parentFolder, subFolderName) {
  if (!parentFolder || !subFolderName) return null;
  var exact = findSubFolder(parentFolder, subFolderName);
  if (exact) return exact;
  var want = String(subFolderName).trim().toLowerCase();
  if (!want) return null;
  var iter = parentFolder.getFolders();
  while (iter.hasNext()) {
    var f = iter.next();
    if (String(f.getName() || '').trim().toLowerCase() === want) return f;
  }
  return null;
}

/** 列出教材根下一層資料夾名（錯誤訊息用） */
function listImmediateFolderNames(parentFolder, limit) {
  var names = [];
  if (!parentFolder) return names;
  var max = limit > 0 ? limit : 30;
  var iter = parentFolder.getFolders();
  while (iter.hasNext() && names.length < max) {
    names.push(iter.next().getName());
  }
  return names;
}

/**
 * 在教材根找檔：先指定子夾，找不到再掃所有子夾／根目錄（修「明明有檔卻說找不到子夾」）。
 */
function locateMaterialFile(mastersRoot, materialFolderName, fileName) {
  var cleanName = String(fileName || '').trim();
  if (!mastersRoot || !cleanName) return null;

  var folderHint = String(materialFolderName || '').trim();
  if (folderHint) {
    var named = findSubFolderInsensitive(mastersRoot, folderHint);
    if (named) {
      var inNamed = named.getFilesByName(cleanName);
      if (inNamed.hasNext()) {
        return { file: inNamed.next(), folderName: named.getName(), folderId: named.getId() };
      }
    }
  }

  // 掃子夾：同檔名優先選資料夾名相符者
  var hits = [];
  var subs = mastersRoot.getFolders();
  while (subs.hasNext()) {
    var sub = subs.next();
    var files = sub.getFilesByName(cleanName);
    if (files.hasNext()) {
      hits.push({ file: files.next(), folderName: sub.getName(), folderId: sub.getId() });
    }
  }
  var top = mastersRoot.getFilesByName(cleanName);
  if (top.hasNext()) {
    hits.push({ file: top.next(), folderName: '', folderId: mastersRoot.getId() });
  }

  if (!hits.length) return null;
  if (folderHint) {
    var want = folderHint.toLowerCase();
    for (var i = 0; i < hits.length; i++) {
      if (String(hits[i].folderName || '').toLowerCase() === want) return hits[i];
    }
  }
  return hits[0];
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

/**
 * 列出教材根（01_My_Materials／00_Class_Materials）底下「所有」子資料夾——不論裡面有沒有
 * .meta.json、有沒有任何檔案，一律列出（老師 2026-08-06 明確要求：進去資料夾建資料，系統
 * 不能因為「還沒有資料」就不列出資料夾，這是先有雞先有蛋的問題——教材資料夾下拉本來就是要
 * 給老師選「還沒有 meta 檔的空資料夾」來產生第一份 meta.json）。
 * createIfMissing 傳 true：教材根本身若還不存在（例如全新帳號第一次用），現場建立再列一次
 * （這時當然還是空的，但至少之後老師在裡面手動建的子資料夾就找得到，不會一路回傳空陣列到
 * 老師以為系統故障；getOrCreateSubFolder／resolveMaterialsRoot 內部都是 idempotent，
 * 不會重複建立也不會動到既有資料）。
 */
/**
 * 🔍 2026-08-06：老師連續多輪回報「教材資料夾下拉是空的」，但實際去 Drive 看資料夾都存在。
 * 在完全看不到 GAS 執行環境（Apps Script 執行紀錄、實際部署版本）的情況下，前端只能猜——
 * 於是在回應裡固定夾帶這串除錯資訊，讓「清單是空的」這件事本身變成可驗證、可回報的具體線索
 * （而不是老師只能截圖「就是空的」，我方只能繼續猜資料夾結構或部署版本）：
 * - debugVersion：寫死的字串戳記。若老師之後回報的畫面上完全沒有出現這個戳記（甚至沒有這個
 *   欄位），代表 GAS 網頁應用程式還在跑「更舊的部署版本」，不是這次程式碼的問題——一定要先
 *   照 .cursor/rules/drive-folder-upload-invariants.mdc 的「改完 Code.gs 後必須重新部署」
 *   走完整套流程（存檔→管理部署作業→編輯→版本選「新版本」→部署），git push 不會自動更新。
 * - resolvedRootId/resolvedRootName：這次呼叫實際解析到、拿去 getFolders() 列子資料夾的
 *   那個資料夾本身是誰。老師可以直接拿這個 ID 貼到瀏覽器網址列 drive.google.com/drive/folders/<ID>
 *   打開，跟自己在 Drive 裡看到的 01_My_Materials 網址比對，一秒判斷「系統到底是不是在看
 *   我以為的那個資料夹」（例如帳號綁錯、Drive 捷徑 vs 真實資料夾等，肉眼比 ID 最準）。
 * - subFolderCount：GAS 這次真的數到幾個子資料夾（在套用任何 .meta.json 或其他前端過濾之前）。
 */
var LIST_MATERIAL_MASTERS_DEBUG_VERSION = 'lm-2026-08-21-scriptfiles';

/**
 * 2026-08-13（老師回報「資料夾內容出不來，很容易出問題」）：舊版對「每一個子資料夾」各打
 * 2 次 Drive API（sub.getFilesByName('_manifest.json') + sub.getFiles() 全量列舉再逐一比對
 * 檔名），子資料夾一多（教材資料夾隨使用自然會越積越多），這裡就變成 N*2 次真實網路往返，
 * 實測 20+ 個資料夾就常常卡到 20 秒以上甚至逾時——這才是「教材資料夾清單載入很容易出問題」
 * 的根本原因，不是 Web App 網址失效（見 api-gas-service.js postGasJson 的錯誤訊息也常常
 * 誤導成「網址已失效」，其實是這裡真的太慢）。
 *
 * 改法：先用 mastersRoot.getFolders() 列出全部子資料夾（本來就是單一 lazy iterator，便宜），
 * 再用 DriveApp.searchFiles 以「這批子資料夾 id 的 OR 條件」批次查一次 .meta.json／
 * _manifest.json，把 N*2 次往返降到 ceil(N/CHUNK_SIZE) 次。CHUNK_SIZE 是為了避免單次查詢
 * 字串太長被 Drive 拒絕，不是效能考量。
 */
function listMaterialMasters(rootFolderId, rootKind) {
  var rootFolder = DriveApp.getFolderById(rootFolderId);
  var kind = normalizeMaterialsRootKind(rootKind);
  var mastersRoot = resolveMaterialsRoot(rootFolder, kind, true);
  if (!mastersRoot) {
    return {
      materials: [],
      rootKind: kind,
      debugVersion: LIST_MATERIAL_MASTERS_DEBUG_VERSION,
      resolvedRootId: '',
      resolvedRootName: '（解析失敗，連教材根都建不出來，請檢查 rootFolderId／權限）',
      subFolderCount: 0
    };
  }

  var materialsList = [];
  var bucketByFolderId = {};
  var subFolders = mastersRoot.getFolders();
  while (subFolders.hasNext()) {
    var sub = subFolders.next();
    var bucket = { folderName: sub.getName(), folderId: sub.getId(), manifest: null, metaFiles: [], scriptFiles: [] };
    materialsList.push(bucket);
    bucketByFolderId[bucket.folderId] = bucket;
  }

  var CHUNK_SIZE = 40;
  for (var start = 0; start < materialsList.length; start += CHUNK_SIZE) {
    var chunk = materialsList.slice(start, start + CHUNK_SIZE);
    var parentClauses = chunk.map(function (f) { return "'" + f.folderId + "' in parents"; }).join(' or ');
    var query = '(' + parentClauses + ") and trashed = false and (title contains '.meta.json' or title contains '.script.txt' or title = '_manifest.json')";
    var found = DriveApp.searchFiles(query);
    while (found.hasNext()) {
      var file = found.next();
      var fileName = file.getName();
      var isManifest = fileName === '_manifest.json';
      var isMeta = fileName.indexOf('.meta.json') !== -1;
      var isScript = fileName.indexOf('.script.txt') !== -1;
      if (!isManifest && !isMeta && !isScript) continue;
      var parents = file.getParents();
      while (parents.hasNext()) {
        var parentBucket = bucketByFolderId[parents.next().getId()];
        if (!parentBucket) continue;
        if (isManifest) {
          try {
            parentBucket.manifest = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
          } catch (manifestErr) {
            parentBucket.manifest = null;
          }
        } else if (isMeta) {
          parentBucket.metaFiles.push({ name: fileName, fileId: file.getId() });
        } else {
          parentBucket.scriptFiles.push({ name: fileName, fileId: file.getId() });
        }
      }
    }
  }

  return {
    materials: materialsList,
    rootKind: kind,
    debugVersion: LIST_MATERIAL_MASTERS_DEBUG_VERSION,
    resolvedRootId: mastersRoot.getId(),
    resolvedRootName: mastersRoot.getName(),
    subFolderCount: materialsList.length
  };
}

function readMaterialFile(rootFolderId, materialFolderName, fileName, rootKind) {
  var rootFolder = DriveApp.getFolderById(rootFolderId);
  var kind = normalizeMaterialsRootKind(rootKind);
  var mastersRoot = resolveMaterialsRoot(rootFolder, kind, false);
  if (!mastersRoot) {
    throw new Error(kind === 'teacher'
      ? '找不到 01_My_Materials，請先將教材發布到老師個人資料夾。'
      : '找不到 00_Class_Materials，請先發布教材。');
  }

  var cleanName = String(fileName || '').trim();
  if (!cleanName) throw new Error('缺少 fileName');

  var located = locateMaterialFile(mastersRoot, materialFolderName, cleanName);
  if (!located) {
    var kids = listImmediateFolderNames(mastersRoot, 20);
    throw new Error(
      '找不到檔案：' + (materialFolderName ? (materialFolderName + '/') : '') + cleanName
      + '（教材根「' + mastersRoot.getName() + '」下現有資料夾：'
      + (kids.length ? kids.join(', ') : '（空）') + '）'
    );
  }

  var file = located.file;
  return {
    fileName: cleanName,
    fileId: file.getId(),
    content: file.getBlob().getDataAsString('UTF-8'),
    mimeType: file.getMimeType(),
    rootKind: kind,
    materialFolder: located.folderName || String(materialFolderName || '')
  };
}

/** 一次讀多個教材檔（大幅減少 Web App 冷啟動來回） */
function readMaterialFiles(rootFolderId, items, rootKind) {
  var list = items || [];
  var out = [];
  var kind = normalizeMaterialsRootKind(rootKind);
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var fileName = String(it.fileName || '').trim();
    var materialFolder = String(it.materialFolder || it.material_folder || '').trim();
    var byId = String(it.fileId || '').trim();
    try {
      var one;
      if (byId) {
        try {
          one = readDriveTextFileById(byId);
          out.push({
            ok: true,
            fileName: one.fileName || fileName,
            fileId: one.fileId,
            content: one.content,
            mimeType: one.mimeType,
            materialFolder: materialFolder,
            rootKind: kind
          });
          continue;
        } catch (_byIdErr) {
          // 老師重新上傳後舊 fileId 會失效；有檔名就改走資料夾＋檔名，不要整批讀不到。
          if (!fileName) {
            throw _byIdErr;
          }
        }
      }
      if (!fileName) {
        out.push({ ok: false, fileName: '', message: '缺少 fileName' });
        continue;
      }
      one = readMaterialFile(rootFolderId, materialFolder, fileName, kind);
      out.push({
        ok: true,
        fileName: one.fileName,
        fileId: one.fileId,
        content: one.content,
        mimeType: one.mimeType,
        materialFolder: one.materialFolder,
        rootKind: one.rootKind
      });
    } catch (err) {
      out.push({
        ok: false,
        fileName: fileName,
        materialFolder: materialFolder,
        fileId: byId,
        message: String(err && err.message ? err.message : err)
      });
    }
  }
  return { files: out, rootKind: kind };
}

/** 直接用 Drive fileId 讀文字（清單已有 fileId 時最快、不依賴資料夾名） */
function readDriveTextFileById(fileId) {
  var id = String(fileId || '').trim();
  if (!id) throw new Error('缺少 fileId');
  var file = DriveApp.getFileById(id);
  if (file.isTrashed()) throw new Error('檔案已在垃圾桶');
  return {
    fileName: file.getName(),
    fileId: file.getId(),
    content: file.getBlob().getDataAsString('UTF-8'),
    mimeType: file.getMimeType()
  };
}

/**
 * 🗑️ 刪除某教材資料夾底下「一個活頁（stem）」的 meta.json／script.txt（送進垂圾桶，非永久刪除）。
 * 用「資料夾名稱＋stem」查找（跟 readMaterialFile／locateMaterialFile 同一套解析邏輯），
 * 兩個檔案只要找到就都刪，其中一個不存在不算錯誤（老師可能只上傳過其中一種）；
 * 兩個都找不到才視為錯誤，避免老師誤以為刪除成功、下拉卻還是看得到舊活頁。
 */
function deleteMaterialStemFiles(rootFolderId, materialFolderName, stem, rootKind) {
  var rootFolder = DriveApp.getFolderById(rootFolderId);
  var kind = normalizeMaterialsRootKind(rootKind);
  var mastersRoot = resolveMaterialsRoot(rootFolder, kind, false);
  if (!mastersRoot) {
    throw new Error(kind === 'teacher'
      ? '找不到 01_My_Materials，請先確認老師個人資料夾已綁定。'
      : '找不到 00_Class_Materials，請先確認班級資料夾已設定。');
  }
  var cleanStem = String(stem || '').trim();
  if (!cleanStem) throw new Error('缺少活頁代號（stem）');
  var cleanFolderName = String(materialFolderName || '').trim();
  if (!cleanFolderName) throw new Error('缺少教材資料夾名稱');
  var targetSub = findSubFolderInsensitive(mastersRoot, cleanFolderName);
  if (!targetSub) {
    throw new Error('找不到教材資料夾：' + cleanFolderName);
  }
  var deleted = [];
  [cleanStem + '.meta.json', cleanStem + '.script.txt'].forEach(function (name) {
    var files = targetSub.getFilesByName(name);
    while (files.hasNext()) {
      var f = files.next();
      f.setTrashed(true);
      deleted.push(name);
    }
  });
  if (!deleted.length) {
    throw new Error('在「' + cleanFolderName + '」找不到 ' + cleanStem + '.meta.json 或 ' + cleanStem + '.script.txt');
  }
  return { deleted: deleted, folderName: targetSub.getName(), stem: cleanStem };
}

function sanitizeDriveFileName(name) {
  var clean = String(name || '').replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return clean;
}

/**
 * 教材子資料夾內批次改檔名（meta／文稿）。兩段改名避免 A→B、B→A 互撞。
 * 找不到的檔記 missing，不整批失敗。
 */
function renameMaterialFiles(rootFolderId, materialFolderName, items, rootKind) {
  var rootFolder = DriveApp.getFolderById(rootFolderId);
  var kind = normalizeMaterialsRootKind(rootKind);
  var mastersRoot = resolveMaterialsRoot(rootFolder, kind, false);
  if (!mastersRoot) {
    throw new Error(kind === 'teacher'
      ? '找不到 01_My_Materials，請先確認老師個人資料夾已綁定。'
      : '找不到 00_Class_Materials，請先確認班級資料夾已設定。');
  }
  var cleanFolderName = String(materialFolderName || '').trim();
  if (!cleanFolderName) throw new Error('缺少教材資料夾名稱');
  var targetSub = findSubFolderInsensitive(mastersRoot, cleanFolderName);
  if (!targetSub) throw new Error('找不到教材資料夾：' + cleanFolderName);

  var list = items || [];
  var pairs = [];
  var i;
  for (i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var oldName = String(it.oldName || '').trim();
    var newName = sanitizeDriveFileName(it.newName);
    if (!oldName || !newName || oldName === newName) continue;
    pairs.push({ oldName: oldName, newName: newName, file: null });
  }

  var TMP = '__mzren__';
  var renamed = [];
  var missing = [];
  var errors = [];

  function stripTmp(name) {
    var n = String(name || '');
    return n.indexOf(TMP) === 0 ? n.slice(TMP.length) : n;
  }

  function findOne(name) {
    var want = String(name || '').trim();
    if (!want) return null;
    var files = targetSub.getFilesByName(want);
    if (files.hasNext()) return files.next();
    var stripped = stripTmp(want);
    if (stripped && stripped !== want) {
      files = targetSub.getFilesByName(stripped);
      if (files.hasNext()) return files.next();
    }
    files = targetSub.getFilesByName(TMP + stripped);
    if (files.hasNext()) return files.next();
    return null;
  }

  // 上一輪若卡在 __mzren__ 前綴，findOne 會找到暫存檔，下面直接改成目標名（不再先拆前綴再改一次）。
  for (i = 0; i < pairs.length; i++) {
    var found = findOne(pairs[i].oldName);
    if (!found) {
      missing.push(pairs[i].oldName);
      continue;
    }
    var dest = findOne(pairs[i].newName);
    if (dest && dest.getId() === found.getId()) {
      renamed.push({
        oldName: pairs[i].oldName,
        newName: pairs[i].newName,
        fileId: found.getId()
      });
      continue;
    }
    try {
      if (!dest) {
        found.setName(pairs[i].newName);
      } else {
        found.setName(TMP + pairs[i].newName);
        found.setName(pairs[i].newName);
      }
      renamed.push({
        oldName: pairs[i].oldName,
        newName: pairs[i].newName,
        fileId: found.getId()
      });
    } catch (e1) {
      errors.push(pairs[i].oldName + ' → ' + pairs[i].newName + '：' + String(e1 && e1.message ? e1.message : e1));
    }
  }
  return {
    renamed: renamed,
    missing: missing,
    errors: errors,
    folderName: targetSub.getName()
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

/** 列出指定資料夾下一層：子資料夾（可進入）＋檔案（可選為派發目標） */
function listChildFolders(parentFolderId) {
  if (!parentFolderId) throw new Error('缺少 parentFolderId');
  var parent = DriveApp.getFolderById(String(parentFolderId).trim());
  var folderIter = parent.getFolders();
  var folders = [];
  while (folderIter.hasNext()) {
    var f = folderIter.next();
    folders.push({
      id: f.getId(),
      name: f.getName(),
      url: f.getUrl()
    });
  }
  folders.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), 'zh-Hant');
  });

  var fileIter = parent.getFiles();
  var files = [];
  while (fileIter.hasNext()) {
    var file = fileIter.next();
    files.push({
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      mimeType: file.getMimeType()
    });
  }
  files.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), 'zh-Hant');
  });

  return {
    parentId: parent.getId(),
    parentName: parent.getName(),
    parentUrl: parent.getUrl(),
    folders: folders,
    files: files
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

    // 健康檢查：前端若誤拿到這包（status=ok），代表 POST 被轉成 GET、doPost 沒跑到
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'LogOn GAS Online',
      hint: 'list_material_masters / read_material_file 必須用 POST 打 doPost；若前端看到此訊息請重新部署 Web App（新版本＋任何人）'
    })).setMimeType(ContentService.MimeType.JSON);
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
      var publishRootKind = data.rootKind || data.materialsRootKind || 'class';
      if (!sourceFileId || !targetFolderId) {
        throw new Error('缺少 sourceFileId 或 targetFolderId');
      }
      var pubResult = publishMaterialFromWorkbook(sourceFileId, targetFolderId, publishRootKind);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        folderId: pubResult.folderId,
        folderUrl: pubResult.folderUrl,
        rootKind: pubResult.rootKind,
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
      var listRootKind = data.rootKind || data.materialsRootKind || 'class';
      if (!listFolderId) throw new Error('缺少 targetFolderId');
      var listResult = listMaterialMasters(listFolderId, listRootKind);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        materials: listResult.materials,
        rootKind: listResult.rootKind,
        debugVersion: listResult.debugVersion,
        resolvedRootId: listResult.resolvedRootId,
        resolvedRootName: listResult.resolvedRootName,
        subFolderCount: listResult.subFolderCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'read_material_file') {
      var readClassFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      var readMaterialFolder = data.materialFolder ? String(data.materialFolder).trim() : '';
      var readFileName = data.fileName ? String(data.fileName).trim() : '';
      var readRootKind = data.rootKind || data.materialsRootKind || 'class';
      var readByFileId = data.fileId ? String(data.fileId).trim() : '';
      if (readByFileId) {
        var byId = readDriveTextFileById(readByFileId);
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          fileName: byId.fileName,
          fileId: byId.fileId,
          content: byId.content,
          rootKind: normalizeMaterialsRootKind(readRootKind)
        })).setMimeType(ContentService.MimeType.JSON);
      }
      if (!readClassFolderId || !readFileName) {
        throw new Error('缺少 targetFolderId 或 fileName');
      }
      var readResult = readMaterialFile(readClassFolderId, readMaterialFolder, readFileName, readRootKind);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileName: readResult.fileName,
        fileId: readResult.fileId,
        content: readResult.content,
        rootKind: readResult.rootKind,
        materialFolder: readResult.materialFolder
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'read_material_files') {
      var batchFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      var batchRootKind = data.rootKind || data.materialsRootKind || 'class';
      var batchItems = data.items || data.files || [];
      if (!batchItems || !batchItems.length) throw new Error('缺少 items');
      var needFolder = false;
      for (var bi = 0; bi < batchItems.length; bi++) {
        if (!batchItems[bi] || !batchItems[bi].fileId) { needFolder = true; break; }
      }
      if (needFolder && !batchFolderId) throw new Error('缺少 targetFolderId');
      var batchResult = readMaterialFiles(batchFolderId || 'unused', batchItems, batchRootKind);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        files: batchResult.files,
        rootKind: batchResult.rootKind
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'delete_material_stem') {
      var delFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      var delMaterialFolder = data.materialFolder ? String(data.materialFolder).trim() : '';
      var delStem = data.stem ? String(data.stem).trim() : '';
      var delRootKind = data.rootKind || data.materialsRootKind || 'class';
      if (!delFolderId) throw new Error('缺少 targetFolderId');
      var delResult = deleteMaterialStemFiles(delFolderId, delMaterialFolder, delStem, delRootKind);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        deleted: delResult.deleted,
        folderName: delResult.folderName,
        stem: delResult.stem
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'rename_material_files') {
      var rnFolderId = data.targetFolderId ? String(data.targetFolderId).trim() : '';
      var rnMaterialFolder = data.materialFolder ? String(data.materialFolder).trim() : '';
      var rnRootKind = data.rootKind || data.materialsRootKind || 'teacher';
      var rnItems = data.items || data.files || [];
      if (!rnFolderId) throw new Error('缺少 targetFolderId');
      if (!rnMaterialFolder) throw new Error('缺少 materialFolder');
      var rnResult = renameMaterialFiles(rnFolderId, rnMaterialFolder, rnItems, rnRootKind);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        renamed: rnResult.renamed,
        missing: rnResult.missing,
        errors: rnResult.errors,
        folderName: rnResult.folderName
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

    if (action === 'list_child_folders') {
      var listParentId = data.parentFolderId ? String(data.parentFolderId).trim() : '';
      if (!listParentId) throw new Error('缺少 parentFolderId');
      var listed = listChildFolders(listParentId);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        parentId: listed.parentId,
        parentName: listed.parentName,
        parentUrl: listed.parentUrl,
        folders: listed.folders,
        files: listed.files
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 下載音檔／檔案為 Base64（給 stream-audio Edge Function 與老師端切割工具備援）。
    // 不用 GET createBinaryOutput：經 Web App redirect 後二進位常壞掉或變空回應；
    // POST + JSON 與 upload_file 同一條路，較穩。單檔上限約 40MB（GAS 記憶體／回應限制）。
    if (action === 'download_file') {
      var downloadFileId = data.fileId ? String(data.fileId).trim() : '';
      if (!downloadFileId) throw new Error('缺少 fileId');

      var downloadFile;
      try {
        downloadFile = DriveApp.getFileById(downloadFileId);
      } catch (dlErr) {
        throw new Error('找不到檔案或 GAS 無權限讀取（fileId: ' + downloadFileId + '）：' + String(dlErr));
      }
      if (downloadFile.isTrashed()) {
        throw new Error('檔案已在垃圾桶，無法下載');
      }

      var downloadBlob = downloadFile.getBlob();
      var downloadBytes = downloadBlob.getBytes();
      var maxBytes = 40 * 1024 * 1024;
      if (downloadBytes.length > maxBytes) {
        throw new Error(
          '檔案過大（約 ' + Math.round(downloadBytes.length / 1024 / 1024) +
          ' MB），超過 GAS 下載上限 40MB。請先在 Drive 手動切開，或改用較短錄音。'
        );
      }

      var downloadMime = downloadBlob.getContentType() || downloadFile.getMimeType() || 'application/octet-stream';
      if (downloadMime === 'text/plain') downloadMime = 'audio/wav';

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        fileId: downloadFile.getId(),
        fileName: downloadFile.getName(),
        mimeType: downloadMime,
        byteLength: downloadBytes.length,
        fileData: Utilities.base64Encode(downloadBytes)
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
      // 「取代特定已上傳檔」：學生指定要覆蓋的舊檔 fileId（非檔名比對），
      // 見 .cursor/rules/drive-folder-upload-invariants.mdc「取代特定已上傳檔」一節。
      var oldFileId = data.oldFileId ? String(data.oldFileId).trim() : '';

      var cleanFileName = rawFileName.replace(/<[^>]*>?/gm, '').replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!cleanFileName) cleanFileName = "未命名上傳檔案";

      var folder;
      try {
        folder = retryDriveWrite(function () {
          return DriveApp.getFolderById(folderId);
        });
      } catch (folderErr) {
        throw new Error("找不到指定的資料夾，或權限不足 (Folder ID: " + folderId + ")");
      }

      // 僅在明確指定時才導向班級資源夾。
      // 學生繳交（不傳 subFolderName）必須直接寫入 folderId（通常為 01_Submissions），
      // 否則檔案會被誤丟進資料夾內的 01_Class_Resources，老師在學生夾根目錄會看到「零檔案」。
      if (subFolderName === CLASS_RESOURCES_FOLDER
          || subFolderName === CLASS_RESOURCES_FOLDER_LEGACY) {
        folder = resolveClassResourcesFolder(folder, true);
      } else if (subFolderName) {
        folder = getOrCreateSubFolder(folder, subFolderName);
      } else {
        // 🛡️ 保險絲：直寫模式下，folderId 理應「就是」01_Submissions 本身。
        // 曾發生老師端誤把「姓名_短ID」上一層資料夾的連結存成 drive_folder_id，
        // 導致明明程式邏輯正確，繳交檔案卻寫到 01_Submissions 外面、跟它同一層。
        // 這裡自動偵測：若目前資料夾底下剛好有一個 01_Submissions 子夾，且自己不是 01_Submissions，
        // 就自動改寫進子夾，避免單一筆資料設定錯誤就讓檔案「消失在老師視線外」。
        var autoSubmissions = findSubFolder(folder, '01_Submissions');
        if (autoSubmissions && folder.getName() !== '01_Submissions') {
          folder = autoSubmissions;
        }
      }

      var file = retryDriveWrite(function () {
        var existingFiles = folder.getFilesByName(cleanFileName);
        while (existingFiles.hasNext()) {
          existingFiles.next().setTrashed(true);
        }
        var decodedData = Utilities.base64Decode(fileData);
        var blob = Utilities.newBlob(decodedData, mimeType, cleanFileName);
        return folder.createFile(blob);
      });

      var lowerName = cleanFileName.toLowerCase();
      var isAudio = mimeType.indexOf('audio/') === 0
        || lowerName.indexOf('.wav') > -1
        || lowerName.indexOf('.mp3') > -1
        || lowerName.indexOf('.m4a') > -1;
      // 「設定公開檢視連結」是錦上添花（方便老師直接開檔），不是繳交成功的必要條件；
      // 這個 ACL 變更動作在 Drive 上的速率限制比建立檔案本身嚴格很多，
      // 連續多檔上傳時很容易撞到「存取遭拒：DriveApp」。絕不可讓它擋下已經成功建立的檔案。
      if (isAudio) {
        try {
          retryDriveWrite(function () {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          }, 4, 1500);
        } catch (shareErr) {
          Logger.log('音檔分享設定失敗（檔案仍已成功上傳）：' + shareErr);
        }
      }

      if (assignmentId && taskId) {
        file.setDescription(JSON.stringify({
          assignment_id: assignmentId,
          task_id: taskId
        }));
      }

      // 「取代特定已上傳檔」：新檔已成功建立後才 trash 舊檔（by fileId），
      // 絕不能先刪舊檔再上傳新檔——上傳中途失敗會讓學生連舊檔都不見。
      // trash 失敗只記錄，不影響本次上傳「成功」的結果。
      if (oldFileId && oldFileId !== file.getId()) {
        try {
          retryDriveWrite(function () {
            DriveApp.getFileById(oldFileId).setTrashed(true);
          });
        } catch (trashErr) {
          Logger.log('取代上傳：舊檔 trash 失敗（新檔已成功上傳，不影響本次結果，oldFileId=' + oldFileId + '）：' + trashErr);
        }
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

/** 讀 _Layout：同教材共用；多列＝多種可選排版。活頁不存在則 []。 */
function readLayoutProfiles(ss) {
  var sh = ss.getSheetByName('_Layout');
  if (!sh) return [];
  var rows = readSheetAsMap(ss, '_Layout');
  var profiles = [];
  rows.forEach(function(r) {
    if (!isTruthyYN(r.enabled)) return;
    var pid = String(r.profile_id || '').trim();
    if (!pid) return;
    var lpp = Number(r.lines_per_page);
    if (isNaN(lpp) || lpp <= 0) lpp = 10;
    profiles.push({
      profile_id: pid,
      label: String(r.label || pid).trim(),
      fields: String(r.fields || '').trim(),
      fields_answer: String(r.fields_answer || r.answer_fields || '').trim(),
      lines_per_page: lpp,
      is_default: isTruthyYN(r.is_default),
      note: String(r.note || '').trim()
    });
  });
  return profiles;
}

function buildColMaps(schemas) {
  var out = {};
  Object.keys(schemas || {}).forEach(function(sid) {
    var m = {};
    (schemas[sid] || []).forEach(function(f) {
      var col = String(f.excel_col || '').trim().toUpperCase();
      var key = String(f.semantic_key || '').trim();
      if (col && key) m[col] = key;
    });
    if (Object.keys(m).length) out[sid] = m;
  });
  return out;
}

function buildLayoutPayload(cfg, profiles, publishedAt, schemas) {
  if (!profiles || !profiles.length) return null;
  var defaultId = '';
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].is_default) {
      defaultId = profiles[i].profile_id;
      break;
    }
  }
  if (!defaultId) defaultId = profiles[0].profile_id;
  var colMaps = buildColMaps(schemas || {});
  var flat = {};
  Object.keys(colMaps).forEach(function(sid) {
    var m = colMaps[sid];
    Object.keys(m).forEach(function(k) { flat[k] = m[k]; });
  });
  return {
    published_at: publishedAt,
    material_folder: (cfg && cfg.material_folder) || '',
    default_profile_id: defaultId,
    col_map: flat,
    col_maps: colMaps,
    profiles: profiles.map(function(p) {
      return {
        profile_id: p.profile_id,
        label: p.label,
        fields: p.fields,
        fields_answer: p.fields_answer || '',
        lines_per_page: p.lines_per_page,
        note: p.note || ''
      };
    })
  };
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

function publishMaterialFromWorkbook(sourceFileId, targetFolderId, rootKind) {
  var opened = openSpreadsheetForPublish(sourceFileId);
  var ss = opened.ss;
  var kind = normalizeMaterialsRootKind(rootKind);

  try {
    var cfg = readMaterialConfig(ss);
    var schemas = readSchemaDefinitions(ss);
    var rules = readPublishRules(ss);
    var layoutProfiles = readLayoutProfiles(ss);
    if (rules.length === 0) {
      throw new Error('_Publish 沒有 enabled=Y 的規則');
    }

    var root = DriveApp.getFolderById(targetFolderId);
    var materialRoot = resolveMaterialsRoot(root, kind, true);
    if (!materialRoot) {
      throw new Error(kind === 'teacher'
        ? '無法建立 01_My_Materials'
        : '無法建立 00_Class_Materials');
    }
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

    var layoutPayload = buildLayoutPayload(cfg, layoutProfiles, now, schemas);
    if (layoutPayload) {
      writeDriveTextFile(materialFolder, '_layout.json', JSON.stringify(layoutPayload, null, 2), MimeType.PLAIN_TEXT);
    }

    var manifest = {
      published_at: now,
      source_file_id: sourceFileId,
      material_folder: cfg.material_folder,
      root_kind: kind,
      outputs: outputs,
      layout: layoutPayload ? '_layout.json' : null
    };
    writeDriveTextFile(materialFolder, '_manifest.json', JSON.stringify(manifest, null, 2), MimeType.PLAIN_TEXT);

    return {
      folderId: materialFolder.getId(),
      folderUrl: materialFolder.getUrl(),
      rootKind: kind,
      manifest: manifest,
      layout: layoutPayload
    };
  } finally {
    if (opened.tempId) {
      try {
        DriveApp.getFileById(opened.tempId).setTrashed(true);
      } catch (cleanupErr) {}
    }
  }
}

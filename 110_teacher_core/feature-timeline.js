/**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js
 * 🌟 v69 方案 A 收納版：
 * 1. 確保學生端上傳的教材絕對存入 01_Class_Resources 子資料夾。
 * 2. 貫徹鐵律：學生的教材 PDF 絕對只做 Base64 轉換，不做任何文字解析。
 */

console.log("🚀 FeatureTimeline v69 載入成功！(強制收納 01_Class_Resources 與無解析上傳鐵律)");

window.FeatureTimeline = (() => {
    const db = window.TeacherDB;
    function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
    if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
        window.MaterialNameMap.ensureLoaded(false).catch(function () {});
    }
    
    if (db && db.assignments) {
        const originalLength = db.assignments.length;
        db.assignments = db.assignments.filter(a => a.target_date !== undefined && a.target_date !== null);
        if (db.assignments.length !== originalLength && typeof db.save === 'function') db.save(); 
    }

    let dragAssignId = null; 

    function getClassDriveFolderId(classId) {
        if (!db || !Array.isArray(db.classes)) return '';
        const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return '';
        let raw = cls.raw_data || cls.rawData || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        return raw.drive_folder_id || raw.class_folder_id || '';
    }

    function normalizeMaterialsRootKind(rootKind) {
        return String(rootKind || 'class').trim().toLowerCase() === 'teacher' ? 'teacher' : 'class';
    }

    function readMaterialsRootKind(pathStr) {
        const el = document.getElementById('node-material-root-' + pathStr);
        return normalizeMaterialsRootKind(el ? el.value : 'class');
    }

    async function resolveMaterialsRootFolderId(classId, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        if (kind === 'teacher') {
            if (!window.FeatureResource || typeof window.FeatureResource.getTeacherPersonalDriveFolderId !== 'function') {
                throw new Error('FeatureResource 未載入');
            }
            let folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(true);
            if (!folderId && typeof window.FeatureResource.ensureAndBindTeacherPersonalDrive === 'function') {
                await window.FeatureResource.ensureAndBindTeacherPersonalDrive();
                folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(false);
            }
            if (!folderId) throw new Error('尚未綁定老師個人資料夾');
            return folderId;
        }
        const classFolderId = getClassDriveFolderId(classId);
        if (!classFolderId) throw new Error('此班級尚未設定 Drive 資料夾');
        return classFolderId;
    }

    /**
     * 💣 雷區（2026-08-06）：以前這裡只在 pack.metaFiles 有內容時才推進 options——導致「還沒有
     * 任何 .meta.json 的資料夾」永遠不會出現在任何教材資料夾下拉（教材/Layout 搭配、套用到教材、
     * 獨立考試）。這在「產生 meta/script 並上傳」這個新功能裡是致命的雞生蛋問題：老師要選的
     * 目標資料夾，正是「還沒有 meta 檔」的那個空資料夾（要對著它寫入第一份 meta.json），
     * 但下拉卻因為它是空的而永遠看不到它，逼老師只能手動輸入資料夾全名（正是要根除的壞流程）。
     * 修法：資料夾即使 0 個 .meta.json 也要推進一筆佔位 option（fileName 留空），讓
     * uniqueFolderNamesFromEntry（只看 folderName）能撈到它；只依賴 fileName 算「活頁 stem」
     * 的函式（examSheetStemsForFolder／getRawFileNamesForFolder）本來就會 filter 掉空字串，
     * 不會因此長出假的活頁。同時每筆都夾帶 folderId，供「產生並上傳」直接指定 Drive 寫入目標，
     * 不用再多一次「用資料夾名稱反查 ID」的 GAS 往返。
     */
    function collectMaterialMetaOptions(materials, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        const prefix = kind === 'teacher' ? '👤老師 ' : '🏫班級 ';
        const options = [];
        (materials || []).forEach(function (pack) {
            if (!pack.metaFiles || !pack.metaFiles.length) {
                options.push({
                    rootKind: kind,
                    folderName: pack.folderName,
                    folderId: pack.folderId || '',
                    fileName: '',
                    fileId: '',
                    label: prefix + (pack.folderName || '（未命名）') + '（尚無 .meta.json）'
                });
                return;
            }
            (pack.metaFiles || []).forEach(function (mf) {
                options.push({
                    rootKind: kind,
                    folderName: pack.folderName,
                    folderId: pack.folderId || '',
                    fileName: mf.name,
                    fileId: mf.fileId || '',
                    label: prefix + (pack.folderName ? pack.folderName + ' / ' : '') + mf.name
                });
            });
        });
        return options;
    }

    /** 從已載入的 options 找回 fileId（避免再靠資料夾名找檔） */
    function resolveStoredFolderName(name) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        if (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function') {
            return window.MaterialNameMap.resolveFolderName(raw) || raw;
        }
        return raw;
    }

    function lookupMetaFileId(pathStr, materialFolder, fileName) {
        const opts = _materialMetaOptionsCache[pathStr] || [];
        const folder = resolveStoredFolderName(materialFolder);
        const name = String(fileName || '');
        const aliases = (window.MaterialNameMap && typeof window.MaterialNameMap.lookupKeys === 'function')
            ? window.MaterialNameMap.lookupKeys('meta_file', name).concat(window.MaterialNameMap.lookupKeys('sheet_stem', name))
            : [name];
        const wantSet = {};
        aliases.forEach(function (k) {
            const t = String(k || '').trim();
            if (t) wantSet[t.toUpperCase()] = true;
        });
        for (let i = 0; i < opts.length; i++) {
            const o = opts[i];
            if (!o || !o.fileId) continue;
            if (String(o.folderName || '').trim().toUpperCase() !== folder.toUpperCase()) continue;
            const fn = String(o.fileName || '');
            if (fn === name || wantSet[fn.toUpperCase()]) return o.fileId;
        }
        return '';
    }

    /**
     * 回傳 { options, debug } 而不是單純 options 陣列——2026-08-06 老師連續回報「教材資料夾
     * 下拉是空的」，但看不到 GAS 執行環境，前端只能猜。debug 帶著 GasService.listMaterialMasters
     * 掛在陣列上的 debugVersion/resolvedRootId/resolvedRootName/subFolderCount，讓「清單是空的」
     * 這件事變成可驗證、可回報的具體線索（見 ensureMetaCatalog／getMetaCatalogDebugText）。
     */
    async function loadMaterialMetaOptionsWithDebug(classId, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        if (!window.GasService || typeof window.GasService.listMaterialMasters !== 'function') {
            throw new Error('GasService 尚未載入');
        }
        const folderId = await resolveMaterialsRootFolderId(classId, kind);
        const materials = await window.GasService.listMaterialMasters(folderId, kind);
        return {
            options: collectMaterialMetaOptions(materials, kind),
            debug: {
                queriedFolderId: folderId,
                debugVersion: materials.debugVersion || '',
                resolvedRootId: materials.resolvedRootId || '',
                resolvedRootName: materials.resolvedRootName || '',
                subFolderCount: (typeof materials.subFolderCount === 'number') ? materials.subFolderCount : materials.length
            }
        };
    }

    // 班級級 meta 清單快取（依 classId + 根目錄），避免每個節點／每次重繪都手動載
    const _metaCatalog = {};
    const _metaCatalogPromises = {};
    /** 各錄音節點目前下拉用的 options（由 catalog 灌入） */
    const _materialMetaOptionsCache = {};

    /**
     * 💣 雷區（2026-08-16 老師回報「教材資料夾下拉『其他可用』亂說沒有」）：resolveMaterialsRootFolderId
     * 對 rootKind='teacher' 完全不看 classId（永遠是老師個人 Drive 根，跟哪個班級無關），但這裡
     * 以前無論 teacher／class 都把 classId 併進 key，導致同一份「老師個人教材」清單依呼叫時的
     * classId 被快取成好幾份互不相通的副本——例如「設計新擷取範本」卡片上傳成功後用 classId=''
     * 強制重抓一次，只更新了 ''::teacher 那一份，某個實際班級頁面（key 是 該班classId::teacher）
     * 讀到的還是更早、可能不含新資料夾的舊快取，老師剛上傳好的教材資料夾在那個班的「其他可用」
     * 下拉完全看不到，變成「亂說沒有」。修法：rootKind='teacher' 一律收斂成同一個 key，
     * 不管從哪個 classId 觸發的重新整理都會更新到同一份、大家都讀得到最新結果；
     * rootKind='class' 資料真的依 classId 不同（00_Class_Materials 是各班獨立資料夾），維持原樣。
     */
    function metaCatalogKey(classId, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        if (kind === 'teacher') return '__teacher__::teacher';
        return String(classId || '') + '::' + kind;
    }

    function getMetaCatalogEntry(classId, rootKind) {
        return _metaCatalog[metaCatalogKey(classId, rootKind)] || null;
    }

    /**
     * 💣 雷區（2026-08-12 老師回報「刪除 meta/script 後，畫面停留在舊畫面，要手動 reload」）：
     * 刪除後緊接著呼叫 ensureMetaCatalog({force:true}) 重新打一次 list_material_masters，
     * 但那是「剛才 trash 檔案」跟「這次重新列表」兩次獨立的 Drive API 往返，偶爾會遇到極短暫的
     * 列表未即時反映（trash 生效但下一秒的 list 還沒同步），畫面看起來像完全沒更新，只能等老師
     * 手動整頁重新整理（那時已經過了足夠時間，自然抓到最新狀態）。
     * 修法：刪除成功那一刻先直接把這幾個檔名從既有快取裡樂觀移除（不等 Drive 重新確認），
     * 畫面立刻反映；背景仍照舊強制重抓一次校正（見呼叫端 feature-material-layout-pairing.js），
     * 但不依賴它才能看到變化。
     */
    function removeMetaCatalogFileOption(classId, rootKind, folderName, fileNames) {
        const key = metaCatalogKey(classId, rootKind);
        const entry = _metaCatalog[key];
        if (!entry || !Array.isArray(entry.options)) return;
        const folderClean = String(folderName || '');
        const namesSet = {};
        (fileNames || []).forEach(function (n) { if (n) namesSet[n] = true; });
        entry.options = entry.options.filter(function (o) {
            if (!o || String(o.folderName || '') !== folderClean) return true;
            return !namesSet[o.fileName];
        });
    }

    /**
     * 把 ensureMetaCatalog 存的 debug 資訊格式化成一行文字，給「教材資料夾清單是空的」的警告
     * 訊息附加在後面——2026-08-06 老師連續回報「明明有資料夾，下拉還是空的」，這行字讓老師
     * 下次遇到同樣狀況時，可以直接把畫面上這段文字複製貼給我，不用再靠截圖互相猜測：
     * - 沒有出現 v= 版本戳記＝GAS Web App 還在跑舊部署，要先重新部署，不是程式碼問題
     * - resolvedRootId 可以直接貼進 drive.google.com/drive/folders/<ID> 打開，跟自己在
     *   Drive 裡看到的資料夾網址比對，一秒判斷系統是不是真的在看老師以為的那個資料夾
     */
    function getMetaCatalogDebugText(classId, rootKind) {
        const entry = getMetaCatalogEntry(classId, rootKind);
        const debug = entry && entry.debug;
        if (!debug) return '（🔍 尚未取得除錯資訊，可能是連線失敗或還在載入中——若一直是這樣，代表 GAS 還在跑舊部署，未回傳除錯欄位）';
        return '🔍 v=' + (debug.debugVersion || '未知') + '｜查詢資料夾ID=' + (debug.queriedFolderId || '未知')
            + '｜實際解析到=' + (debug.resolvedRootName || '未知') + '（' + (debug.resolvedRootId || '未知') + '）'
            + '｜GAS 數到 ' + (typeof debug.subFolderCount === 'number' ? debug.subFolderCount : '未知') + ' 個子資料夾';
    }

    /**
     * 確保某根目錄的 meta 清單已載入（可 force 重抓）。
     * 雷區：失敗時不可把 [] 當成功快取，否則之後永遠 0 檔、重整也像沒作用。
     *
     * 💣 2026-08-06 補（老師實測回報「明明 Drive 裡真的有子資料夾，下拉還是空的」）：
     * 「成功但清單是空的」（ok:true, options:[]）以前跟「有真內容」用同一條件永久信任快取——
     * 只要曾經有一次（不管什麼原因）真的查到空清單，之後任何非 force 呼叫都會直接吃這個空
     * 快取，永遠不會再真的打一次 GAS，即使 Drive 裡後來真的有資料夾也一樣，老師感覺就是
     * 「怎麼樣都救不回來，只能整頁重新整理甚至也沒用」。修法：只有「有真內容」（options.length>0）
     * 才長期信任快取；「成功但空」只在 5 秒內免重複打 GAS（擋同一批畫面在極短時間連續問好幾次），
     * 超過 5 秒的任何一次詢問都會自動再查一次，直到查到真內容或明確失敗為止。
     */
    async function ensureMetaCatalog(classId, rootKind, opts) {
        const options = opts || {};
        const kind = normalizeMaterialsRootKind(rootKind);
        const key = metaCatalogKey(classId, kind);
        if (options.force) {
            delete _metaCatalog[key];
            delete _metaCatalogPromises[key];
        }
        const cached = _metaCatalog[key];
        const cacheHasRealContent = cached && cached.ok === true && Array.isArray(cached.options) && cached.options.length > 0;
        const cacheIsFreshEmpty = cached && cached.ok === true && Array.isArray(cached.options) && cached.options.length === 0
            && (Date.now() - (cached.loadedAt || 0) < 5000);
        if (!options.force && (cacheHasRealContent || cacheIsFreshEmpty)) {
            return cached.options;
        }
        if (_metaCatalogPromises[key]) {
            return _metaCatalogPromises[key];
        }
        _metaCatalogPromises[key] = loadMaterialMetaOptionsWithDebug(classId, kind).then(function (result) {
            _metaCatalog[key] = { options: result.options || [], error: null, ok: true, loadedAt: Date.now(), debug: result.debug || null };
            return _metaCatalog[key].options;
        }).catch(function (err) {
            _metaCatalog[key] = {
                options: [],
                error: err,
                ok: false,
                loadedAt: Date.now(),
                debug: null
            };
            throw err;
        }).finally(function () {
            delete _metaCatalogPromises[key];
        });
        return _metaCatalogPromises[key];
    }

    /** 雷區：無論 API 成敗，畫面上都必須先有 meta 列（不可 0 列） */
    function seedMaterialMetaRowsForAllAudioNodes() {
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState) return;
        walkAudioRecordNodes(bState.tasks || [], [], function (task, pathStr) {
            const rowsEl = document.getElementById('node-material-rows-' + pathStr);
            if (!rowsEl) return;
            if (rowsEl.querySelector('.material-meta-row')) return;
            const packed = readSavedMetaRowsForPath(pathStr, task);
            const seed = packed.savedRows.length
                ? packed.savedRows
                : [{ value: '', range_spec: 'pp. 1~2' }];
            renderMaterialMetaRows(pathStr, _materialMetaOptionsCache[pathStr] || [], seed);
            const statusEl = document.getElementById('node-material-status-' + pathStr);
            if (statusEl && !String(statusEl.textContent || '').trim()) {
                statusEl.textContent = '⏳ 準備載入 meta 清單…';
                statusEl.style.color = '#3B82F6';
            }
        });
    }

    /** 預載老師＋班級兩套（切換根目錄不必再手動載） */
    async function prefetchMetaCatalogs(classId) {
        const results = await Promise.all([
            ensureMetaCatalog(classId, 'teacher').then(function (o) { return { kind: 'teacher', options: o, error: null }; })
                .catch(function (err) { return { kind: 'teacher', options: [], error: err }; }),
            ensureMetaCatalog(classId, 'class').then(function (o) { return { kind: 'class', options: o, error: null }; })
                .catch(function (err) { return { kind: 'class', options: [], error: err }; })
        ]);
        return results;
    }

    function readSavedMetaRowsForPath(pathStr, task) {
        let savedRows = [];
        const hidden = document.getElementById('node-material-selected-json-' + pathStr);
        if (hidden && hidden.value) {
            try {
                const parsed = JSON.parse(hidden.value);
                if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
                    savedRows = parsed;
                }
            } catch (_e) {}
        }
        const raw = (task && task.raw_data) || {};
        let refs = Array.isArray(raw.material_refs) && raw.material_refs.length
            ? raw.material_refs
            : (raw.material_ref && raw.material_ref.published_file ? [raw.material_ref] : []);
        refs = ensureMaterialRefsMatchUnits(refs, raw.grading_units, refs[0] || raw.material_ref || {});
        const restoredFromRefs = refsToSavedRows(refs);
        if (restoredFromRefs.length > savedRows.length) savedRows = restoredFromRefs;
        else if (!savedRows.length && restoredFromRefs.length) savedRows = restoredFromRefs;

        // DOM 上若已有列（含範圍），優先保留使用者正在編的內容
        const fromDom = readMaterialMetaRows(pathStr).map(function (m) {
            return {
                value: (m.material_folder || '') + '::' + (m.published_file || ''),
                range_spec: m.range_spec || '',
                label: m.label || ''
            };
        }).filter(function (r) { return r.value; });
        if (fromDom.length >= savedRows.length && fromDom.length) savedRows = fromDom;

        return { savedRows: savedRows, refs: refs, raw: raw };
    }

    /**
     * 開編輯器／加錄音後自動灌入 meta 下拉（無需手動按「載入」）。
     * 新建與修改走同一條路。
     */
    async function autoPrimeMaterialMetaUI() {
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState || !bState.classId) return;

        // 雷區：先同步畫列，再打 API（API 失敗也不能變 0 列）
        seedMaterialMetaRowsForAllAudioNodes();

        const nodes = [];
        walkAudioRecordNodes(bState.tasks || [], [], function (task, pathStr) {
            if (!document.getElementById('node-material-rows-' + pathStr)) return;
            nodes.push({ task: task, pathStr: pathStr });
        });
        if (!nodes.length) return;

        nodes.forEach(function (n) {
            const statusEl = document.getElementById('node-material-status-' + n.pathStr);
            if (statusEl) {
                statusEl.textContent = '⏳ 自動載入 meta 清單（老師＋班級）…';
                statusEl.style.color = '#3B82F6';
            }
        });

        let prefetch = [];
        try {
            prefetch = await prefetchMetaCatalogs(bState.classId);
        } catch (err) {
            console.warn('[FeatureTimeline] prefetchMetaCatalogs', err);
            prefetch = [];
        }

        nodes.forEach(function (n) {
            try {
                const pathStr = n.pathStr;
                // 重繪後 DOM 可能已換：列若不在，再補一次
                const rowsEl = document.getElementById('node-material-rows-' + pathStr);
                if (!rowsEl) return;

                const statusEl = document.getElementById('node-material-status-' + pathStr);
                const rootEl = document.getElementById('node-material-root-' + pathStr);
                const packed = readSavedMetaRowsForPath(pathStr, n.task);
                const primary = (packed.refs && packed.refs[0]) || (n.task.raw_data && n.task.raw_data.material_ref);
                if (rootEl && primary && primary.materials_root_kind) {
                    rootEl.value = normalizeMaterialsRootKind(primary.materials_root_kind);
                }

                const kind = readMaterialsRootKind(pathStr);
                const entry = getMetaCatalogEntry(bState.classId, kind);
                const options = (entry && entry.options) || [];
                _materialMetaOptionsCache[pathStr] = options;

                const rangeEl = document.getElementById('node-material-range-' + pathStr);
                if (rangeEl && !String(rangeEl.value || '').trim()) {
                    const fromRefs = buildMaterialRangeLabelFromRows(packed.refs);
                    const fromTitle = String(n.task.title || '').replace(/<[^>]*>?/gm, '').trim();
                    rangeEl.value = fromRefs || fromTitle || '';
                }

                const rowsToShow = packed.savedRows.length
                    ? packed.savedRows
                    : [{ value: '', range_spec: 'pp. 1~2' }];
                // 無論 options 是否為空都要 render（雷區）
                renderMaterialMetaRows(pathStr, options, rowsToShow);

                if (statusEl) {
                    const teacherEntry = getMetaCatalogEntry(bState.classId, 'teacher');
                    const classEntry = getMetaCatalogEntry(bState.classId, 'class');
                    const tCount = (teacherEntry && teacherEntry.options) ? teacherEntry.options.length : 0;
                    const cCount = (classEntry && classEntry.options) ? classEntry.options.length : 0;
                    const kindErr = entry && entry.error ? (entry.error.message || String(entry.error)) : '';
                    const kindFailed = entry && entry.ok === false;
                    if ((kindFailed || kindErr) && !options.length) {
                        // 初次開啟常因 GAS 冷啟動失敗，勿用刺眼粉紅；提示可重試
                        statusEl.textContent = 'ℹ️ meta 清單暫時連不上（' + (kindErr || 'GAS 忙碌')
                            + '）。列已保留；稍候會自動再試，或按「重新整理清單」。';
                        statusEl.style.color = '#64748B';
                    } else if (!options.length) {
                        statusEl.textContent = 'ℹ️ 目前 0 個 meta。請確認 Drive 有 '
                            + (kind === 'teacher' ? '01_My_Materials' : '00_Class_Materials')
                            + '，或按「重新整理清單」';
                        statusEl.style.color = '#64748B';
                    } else {
                        statusEl.textContent = '✅ meta 清單已自動載入｜目前根目錄 '
                            + options.length + ' 個檔｜老師合計 ' + tCount + '／班級合計 ' + cCount
                            + '｜列 ' + rowsToShow.length
                            + (packed.raw.snapshot_at ? ('｜snapshot ' + packed.raw.snapshot_at) : '');
                        statusEl.style.color = '#059669';
                    }
                }
            } catch (nodeErr) {
                console.warn('[FeatureTimeline] autoPrime node', n.pathStr, nodeErr);
                // 保底：該節點至少一列
                const rowsEl = document.getElementById('node-material-rows-' + n.pathStr);
                if (rowsEl && !rowsEl.querySelector('.material-meta-row')) {
                    renderMaterialMetaRows(n.pathStr, [], [{ value: '', range_spec: 'pp. 1~2' }]);
                }
            }
        });

        return prefetch;
    }

    function metaStemFromFileName(fileName) {
        const base = String(fileName || '').replace(/\.meta\.json$/i, '').replace(/\.json$/i, '');
        const parts = base.split(/[\/_]/);
        return parts[parts.length - 1] || base || '?';
    }

    function escapeAttr(str) {
        return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function buildFallbackSelectedOptionHtml(selectedVal) {
        // 清單載入失敗／過期找不到已選檔案時，仍保留該列的選取值，
        // 避免 hydrate 或存檔時因 <select> 找不到對應 <option> 而被判定為空，
        // 導致該筆 meta（連同其 base 範圍）在存檔時被靜默刪除。
        if (!selectedVal) return '';
        const parts = String(selectedVal).split('::');
        const fallbackLabel = '⚠️ ' + (parts[1] || selectedVal) + '（清單中找不到，保留原選取）';
        return '<option value="' + escapeAttr(selectedVal) + '" selected>' + escapeAttr(fallbackLabel) + '</option>';
    }

    function buildMetaOptionsHtml(options, selectedVal) {
        const opts = options || [];
        if (!opts.length) {
            const fallback = buildFallbackSelectedOptionHtml(selectedVal);
            if (fallback) return '<option value="">— 選 meta —</option>' + fallback;
            return '<option value="">（尚無 meta，請先發布教材或按重新整理）</option>';
        }
        let matched = false;
        const optionsHtml = opts.map(function (opt) {
            const val = opt.folderName + '::' + opt.fileName;
            const sel = val === selectedVal ? ' selected' : '';
            if (sel) matched = true;
            return '<option value="' + escapeAttr(val) + '"' + sel + '>' + escapeAttr(opt.label) + '</option>';
        }).join('');
        const fallback = (!matched) ? buildFallbackSelectedOptionHtml(selectedVal) : '';
        return '<option value="">— 選 meta —</option>' + optionsHtml + fallback;
    }

    function createMaterialMetaRowEl(pathStr, options, rowData) {
        rowData = rowData || {};
        const safePath = String(pathStr || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const wrap = document.createElement('div');
        wrap.className = 'material-meta-row';
        wrap.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:white; border:1px solid #DDD6FE; border-radius:8px; padding:8px;';
        wrap.innerHTML =
            '<select class="form-control material-meta-file" style="flex:1.2; min-width:180px; padding:6px; font-size:0.85rem; font-weight:700;">'
            + buildMetaOptionsHtml(options, rowData.value || '')
            + '</select>'
            + '<input type="text" class="form-control material-meta-range" style="flex:1.4; min-width:200px; padding:6px; font-size:0.85rem; font-weight:700;" '
            + 'placeholder="pp. 1~2, 5, 10 或 #11-16, 26" '
            + 'title="頁碼請用 p. 或 pp. 開頭，題號請用 # 開頭；範圍可用 - 或 ~ 分隔（例：p. 1、pp. 1~2 或 #11-16）。不接受單獨數字。" '
            + 'value="' + escapeAttr(rowData.range_spec || '') + '">'
            + '<button type="button" class="btn-action" style="padding:6px 10px; background:#FEE2E2; color:#B91C1C; border:none; border-radius:6px; font-weight:900; cursor:pointer;" '
            + 'onclick="window.FeatureTimeline.removeMaterialMetaRow(this, \'' + safePath + '\')">×</button>';

        const fileEl = wrap.querySelector('.material-meta-file');
        const rangeEl = wrap.querySelector('.material-meta-range');
        if (fileEl) {
            fileEl.addEventListener('change', function () {
                refreshMaterialRangeLabel(pathStr);
                scheduleAutoSnapshot(pathStr);
            });
        }
        if (rangeEl) {
            rangeEl.addEventListener('input', function () {
                refreshMaterialRangeLabel(pathStr);
                scheduleAutoSnapshot(pathStr);
            });
        }
        return wrap;
    }

    /** 改 meta／範圍後自動套用 Snapshot（防抖，避免連打 GAS） */
    const _autoSnapshotTimers = {};
    const _autoSnapshotBusy = {};
    /** busy 期間若又改了 meta／範圍，結束後必須再跑一次（否則第二冊永遠不會進 snapshot） */
    const _autoSnapshotPending = {};
    /** applySnapshotToNode 世代：避免舊的 async 重繪把剛加的第 2 列 meta 蓋掉 */
    const _snapshotApplyGen = {};

    function scheduleAutoSnapshot(pathStr) {
        if (_autoSnapshotTimers[pathStr]) clearTimeout(_autoSnapshotTimers[pathStr]);
        const statusEl = document.getElementById('node-material-status-' + pathStr);
        if (statusEl) {
            statusEl.textContent = '⏳ 範圍已變更，即將自動套用 Snapshot…';
            statusEl.style.color = '#3B82F6';
        }
        _autoSnapshotTimers[pathStr] = setTimeout(function () {
            autoApplyMaterialSnapshot(pathStr).catch(function (err) {
                console.warn('[FeatureTimeline] autoApplyMaterialSnapshot', err);
            });
        }, 900);
    }

    function metaRowsReadyForSnapshot(pathStr) {
        const rowsEl = document.getElementById('node-material-rows-' + pathStr);
        if (!rowsEl) return { ok: false, reason: '找不到 meta 列' };
        const rowEls = rowsEl.querySelectorAll('.material-meta-row');
        if (!rowEls.length) return { ok: false, reason: '請先新增 meta 列' };
        let filled = 0;
        for (let i = 0; i < rowEls.length; i++) {
            const fileEl = rowEls[i].querySelector('.material-meta-file');
            const rangeEl = rowEls[i].querySelector('.material-meta-range');
            const val = fileEl ? String(fileEl.value || '').trim() : '';
            const range = rangeEl ? String(rangeEl.value || '').trim() : '';
            if (!val && !range) continue; // 空列略過
            if (!val || !range) {
                return { ok: false, reason: '第 ' + (i + 1) + ' 列請選 meta 並填範圍' };
            }
            filled += 1;
        }
        if (!filled) return { ok: false, reason: '請先選 meta 並填範圍' };
        return { ok: true };
    }

    async function autoApplyMaterialSnapshot(pathStr) {
        // 第一冊 GAS 還在跑時，第二冊的 change 不能直接 return 丢掉——標記 pending，結束後重跑
        if (_autoSnapshotBusy[pathStr]) {
            _autoSnapshotPending[pathStr] = true;
            return;
        }
        const ready = metaRowsReadyForSnapshot(pathStr);
        const statusEl = document.getElementById('node-material-status-' + pathStr);
        const previewEl = document.getElementById('node-material-preview-' + pathStr);
        if (!ready.ok) {
            if (statusEl) {
                statusEl.textContent = 'ℹ️ ' + ready.reason + '（填妥後會自動套用）';
                statusEl.style.color = '#64748B';
            }
            return;
        }
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState || !window.MaterialSnapshot) return;
        _autoSnapshotBusy[pathStr] = true;
        _autoSnapshotPending[pathStr] = false;
        try {
            if (statusEl) {
                statusEl.textContent = '⏳ 自動套用 Snapshot…';
                statusEl.style.color = '#3B82F6';
            }
            const snapshot = await buildMergedMaterialSnapshot(pathStr, bState.classId);
            // 💣 雷區修復（2026-08-03）：buildMergedMaterialSnapshot 讀 GAS 可能要好幾秒；
            // 若這段等待期間老師又改了任一列的 meta／範圍，busy-guard 會把 _autoSnapshotPending
            // 設為 true，但這一輪手上的 snapshot 仍是「用舊 DOM 值」算出來的過期結果。
            // 若照常套用：① 會把老師剛打好的新範圍蓋回舊值（單列 input 與下方 base 範圍都會跑掉），
            // ② 更糟的是 finally 的立即重跑會讀到「被這輪覆寫過的」DOM，等於把過期值鎖死，
            // 永遠回不到老師真正想要的值。這正是「明明填對了，過一會兒又自己跑掉」的根因。
            // 正確作法：一旦偵測到 pending 已經被設起來，這一輪結果直接捨棄不套用，
            // 交給 finally 立即重跑那一輪讀「當下最新」DOM 算出正確結果。
            if (_autoSnapshotPending[pathStr]) {
                if (statusEl) {
                    statusEl.textContent = '⏳ 套用期間偵測到範圍又被修改，捨棄這輪結果，改用最新內容重算…';
                    statusEl.style.color = '#3B82F6';
                }
            } else {
                applySnapshotToNode(pathStr, snapshot);
                refreshMaterialRangeLabel(pathStr);
                if (previewEl) {
                    previewEl.innerHTML = '<div style="font-weight:900;margin-bottom:6px;">📍 '
                        + String(snapshot.material_range || '').replace(/</g, '&lt;')
                        + '</div><strong>AI 稿預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 10px;">'
                        + (snapshot.original_script || '').replace(/</g, '&lt;')
                        + '</pre><strong>學生顯示預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 0;">'
                        + (snapshot.student_display || '').replace(/</g, '&lt;') + '</pre>';
                }
                if (statusEl) {
                    statusEl.textContent = '✅ 已自動套用 Snapshot｜' + (snapshot.material_range || '')
                        + '（請記得儲存作業）';
                    statusEl.style.color = '#059669';
                }
                // 同層考試可用題跟著刷新
                if (window.FeatureExamJob && typeof window.FeatureExamJob._refreshAfterAudioSnapshot === 'function') {
                    try { window.FeatureExamJob._refreshAfterAudioSnapshot(pathStr); } catch (_e) {}
                }
            }
        } catch (err) {
            if (statusEl) {
                statusEl.textContent = '⚠️ 自動 Snapshot 失敗：' + (err.message || err)
                    + '（可再改範圍重試，或按「套用 Snapshot」）';
                statusEl.style.color = '#D97706';
            }
            if (previewEl) previewEl.textContent = '❌ ' + (err.message || err);
        } finally {
            _autoSnapshotBusy[pathStr] = false;
            if (_autoSnapshotPending[pathStr]) {
                _autoSnapshotPending[pathStr] = false;
                // 直接重跑，不要再走 900ms 防抖：busy 期間累積的變更已經等過一次，
                // 若這裡又排一次全新防抖，老師常在第二輪 GAS 還沒跑完前就以為「只有第一冊」是最終結果
                // （曾發生 C~F 四冊、老師等完第一輪 C 就離開，沒等到含 D/E/F 的第二輪）。
                if (statusEl) {
                    statusEl.textContent = '⏳ 偵測到套用中又有變更，正在重新套用完整範圍…';
                    statusEl.style.color = '#3B82F6';
                }
                autoApplyMaterialSnapshot(pathStr).catch(function (err) {
                    console.warn('[FeatureTimeline] autoApplyMaterialSnapshot(pending retry)', err);
                });
            }
        }
    }

    function renderMaterialMetaRows(pathStr, options, rows) {
        const container = document.getElementById('node-material-rows-' + pathStr);
        if (!container) return;
        _materialMetaOptionsCache[pathStr] = options || [];
        container.innerHTML = '';
        const list = Array.isArray(rows) && rows.length ? rows : [{ value: '', range_spec: '' }];
        list.forEach(function (row) {
            container.appendChild(createMaterialMetaRowEl(pathStr, _materialMetaOptionsCache[pathStr], row));
        });
        refreshMaterialRangeLabel(pathStr);
    }

    function readMaterialMetaRows(pathStr) {
        const container = document.getElementById('node-material-rows-' + pathStr);
        if (!container) return [];
        const rootKind = readMaterialsRootKind(pathStr);
        const out = [];
        container.querySelectorAll('.material-meta-row').forEach(function (rowEl) {
            const fileEl = rowEl.querySelector('.material-meta-file');
            const rangeEl = rowEl.querySelector('.material-meta-range');
            const value = fileEl ? String(fileEl.value || '').trim() : '';
            const rangeSpec = rangeEl ? String(rangeEl.value || '').trim() : '';
            if (!value) return;
            const parts = value.split('::');
            out.push({
                materials_root_kind: rootKind,
                material_folder: parts[0] || '',
                published_file: parts[1] || '',
                metaFile: parts[1] || '',
                label: metaStemFromFileName(parts[1] || ''),
                range_spec: rangeSpec,
                select_mode: 'range_spec'
            });
        });
        return out;
    }

    function buildMaterialRangeLabelFromRows(rows) {
        const MS = window.MaterialSnapshot;
        return (rows || []).map(function (m) {
            const stem = m.label || metaStemFromFileName(m.published_file || '');
            if (MS && typeof MS.formatRangeLabel === 'function') {
                return MS.formatRangeLabel(stem, m.range_spec || '');
            }
            return stem + (m.range_spec ? (' ' + m.range_spec) : '');
        }).filter(Boolean).join('；');
    }

    /** 從 DOM 讀骨架單元列（E 選項），回傳 grading_units[]（供存檔／即時重算 base 範圍共用） */
    function collectSkeletonUnitsFromDom(pathStr) {
        const container = document.getElementById('node-skeleton-units-' + pathStr);
        if (!container) return [];
        const units = [];
        const seenKeys = {};
        container.querySelectorAll('.skeleton-unit-row').forEach(function (row) {
            const pathInput = row.querySelector('.skeleton-unit-path');
            const scriptInput = row.querySelector('.skeleton-unit-script');
            const pathLabel = pathInput ? String(pathInput.value || '').trim() : '';
            if (!pathLabel) return; // 空路徑列不存
            const segments = pathLabel.split('/').map(function (s) { return s.trim(); }).filter(Boolean);
            const stem = segments[0] || pathLabel;
            const subPath = segments.slice(1);
            const unitKey = stem + ':' + subPath.join('/');
            const pageGuess = subPath.length ? Number(String(subPath[0]).replace(/[^\d]/g, '')) : NaN;
            if (seenKeys[unitKey]) {
                window.showFlash('單元路徑重複：「' + pathLabel + '」，請確認每列路徑不同', 'warning');
            }
            seenKeys[unitKey] = true;
            units.push({
                unit_key: unitKey,
                stem: stem,
                sub_path: subPath,
                page: isNaN(pageGuess) ? null : pageGuess,
                path_label: pathLabel,
                label: pathLabel,
                original_script: scriptInput ? String(scriptInput.value || '').trim() : '',
                item_count: 1,
                item_nos: []
            });
        });
        return units;
    }

    /** 骨架單元（stem 分組＋sub_path 列出）→ base 範圍摘要文字，跟 A 的 buildMaterialRangeLabelFromRows 同角色 */
    function buildSkeletonRangeLabelFromRows(units) {
        const order = [];
        const groups = {};
        (units || []).forEach(function (u) {
            const stem = String((u && u.stem) || '').trim();
            if (!stem) return;
            if (!groups[stem]) { groups[stem] = []; order.push(stem); }
            const sub = Array.isArray(u.sub_path) && u.sub_path.length ? u.sub_path.join('/') : '';
            if (sub) groups[stem].push(sub);
        });
        return order.map(function (stem) {
            const subs = groups[stem];
            return subs.length ? (stem + '（' + subs.join('、') + '）') : stem;
        }).join('；');
    }

    /**
     * 💣 雷區（曾發生「base 範圍設好後會自己消失」）：base 範圍在骨架模式下預設是
     * 「依路徑自動整理」的計算結果，但老師可以手動微調覆寫（欄位 placeholder 也這樣寫）。
     * 舊版每次路徑列異動（包含老師正在修改某一列路徑、中途出現空字串的過渡狀態）都會
     * 無條件用最新算出來的字串覆寫欄位，導致：
     *   1) 老師手動打的覆寫值，只要任何一列路徑再變動就被蓋掉。
     *   2) 只有一列單元、老師刪字重打時，中途出現「路徑暫時是空的」，算出來的 label 是
     *      空字串，欄位就被清空，看起來像是「跑掉不見」。
     * 修法：
     *   - 用 data-range-auto 旗標（見 onSkeletonRangeManualInput）記錄「這欄還是不是自動追蹤」，
     *     老師手動打過字（且沒清空）之後就不再自動覆寫，除非按「🔄 依路徑重算」（force）。
     *   - 非 force 情況下，算出來的 label 是空字串時絕不覆寫既有內容（避免中途過渡狀態清空欄位）。
     *   - force（老師主動按重算鈕）才允許把欄位覆寫成當下算出的值，即使是空字串，
     *     並把旗標重設回自動追蹤，因為這是老師自己要求重新對齊路徑。
     */
    function refreshSkeletonRangeLabel(pathStr, opts) {
        const force = !!(opts && opts.force);
        const units = collectSkeletonUnitsFromDom(pathStr);
        const label = buildSkeletonRangeLabelFromRows(units);
        const rangeEl = document.getElementById('node-material-range-manual-' + pathStr);
        if (rangeEl) {
            const isManual = !force && rangeEl.getAttribute('data-range-auto') === '0';
            if (force || (!isManual && label)) {
                rangeEl.value = label;
                if (force) rangeEl.setAttribute('data-range-auto', '1');
            }
            // else：非 force 且（老師已手動覆寫，或這次算出來是空字串）→ 保留欄位目前內容，不覆寫
        }
        const rangeTextNow = rangeEl ? String(rangeEl.value || '').trim() : label;
        if (rangeTextNow) {
            applyInheritedTitleFromRange(pathStr, rangeTextNow);
            syncSiblingExamTitleFromRange(pathStr, rangeTextNow);
        }
        return label;
    }

    /**
     * 老師直接在骨架模式的 base 範圍欄位打字：有字＝標記手動覆寫（之後路徑異動不再自動蓋掉）；
     * 刪光＝立刻恢復自動追蹤並重新依路徑整理一次（跟標題 onNodeTitleInput 同一套邏輯）。
     */
    function onSkeletonRangeManualInput(pathStr, el) {
        const rangeEl = el || document.getElementById('node-material-range-manual-' + pathStr);
        if (!rangeEl) return;
        const current = String(rangeEl.value || '').trim();
        if (current) {
            rangeEl.setAttribute('data-range-auto', '0');
        } else {
            rangeEl.setAttribute('data-range-auto', '1');
            refreshSkeletonRangeLabel(pathStr, { force: true });
        }
    }

    /** grading_units 裡有幾種 stem（A/B/C…） */
    function uniqueStemsFromGradingUnits(units) {
        const order = [];
        const seen = {};
        (units || []).forEach(function (u) {
            const stem = String((u && u.stem) || '').trim();
            if (!stem || seen[stem]) return;
            seen[stem] = true;
            order.push(stem);
        });
        return order;
    }

    /**
     * 從 grading_units 反推 material_refs（修「存檔後只剩 A 一列」）。
     * templateRef 提供 folder／檔名樣式（例 GEPT-2_sentence / A.meta.json）。
     */
    function rebuildMaterialRefsFromGradingUnits(units, templateRef) {
        const stems = uniqueStemsFromGradingUnits(units);
        if (!stems.length) return [];
        const tpl = templateRef || {};
        const folder = tpl.material_folder || '';
        // 已存過就沿用；沒存過才帶老師個人跨班預設（見 020_js_core/teacher-prefs.js getCachedSync）
        let rootKind;
        if (tpl.materials_root_kind === 'class' || tpl.materials_root_kind === 'teacher') {
            rootKind = tpl.materials_root_kind;
        } else {
            const teacherRootDefaults = window.TeacherPrefs ? window.TeacherPrefs.getCachedSync() : {};
            rootKind = teacherRootDefaults.default_materials_root_kind === 'class' ? 'class' : 'teacher';
        }
        const tplFile = tpl.published_file || (stems[0] + '.meta.json');
        const pageMap = {};
        (units || []).forEach(function (u) {
            const stem = String((u && u.stem) || '').trim();
            if (!stem) return;
            if (!pageMap[stem]) pageMap[stem] = [];
            if (u.page != null && u.page !== '') pageMap[stem].push(u.page);
        });
        return stems.map(function (stem) {
            let published = tplFile;
            if (/^[A-Za-z0-9]+\.meta\.json$/i.test(tplFile)) {
                published = stem + '.meta.json';
            } else if (/[A-Za-z0-9]+(?=\.meta\.json)/i.test(tplFile)) {
                published = tplFile.replace(/[A-Za-z0-9]+(?=\.meta\.json)/i, stem);
            } else {
                published = stem + '.meta.json';
            }
            const pages = (pageMap[stem] || []).slice().sort(function (a, b) {
                return Number(a) - Number(b);
            });
            let rangeSpec = '';
            if (pages.length) {
                const first = pages[0];
                const last = pages[pages.length - 1];
                rangeSpec = 'pp. ' + first + (String(first) !== String(last) ? ('~' + last) : '');
            }
            return {
                materials_root_kind: rootKind,
                material_folder: folder,
                published_file: published,
                select_mode: 'range_spec',
                range_spec: rangeSpec,
                label: stem
            };
        });
    }

    /**
     * 💣 雷區：若 refs 冊數 < grading_units stem 數，用 units 補回。
     * 曾發生存檔後 material_refs 只剩 A、但 grading_units 仍是 A~F 12 頁。
     * 見 .cursor/rules/material-snapshot-refs-invariant.mdc
     */
    function ensureMaterialRefsMatchUnits(refs, units, templateRef) {
        const list = Array.isArray(refs) ? refs.slice() : [];
        const stems = uniqueStemsFromGradingUnits(units);
        if (stems.length <= 1) return list;
        if (list.length >= stems.length) return list;
        const rebuilt = rebuildMaterialRefsFromGradingUnits(units, templateRef || list[0] || {});
        return rebuilt.length ? rebuilt : list;
    }

    function refsToSavedRows(refs) {
        return (refs || []).map(function (r) {
            let rangeSpec = r.range_spec || '';
            if (!rangeSpec) {
                if (r.select_mode === 'item_range' && r.item_from != null) {
                    rangeSpec = '#' + r.item_from + (r.item_to != null ? ('~' + r.item_to) : '');
                } else if ((r.select_mode === 'page_range' || r.select_mode === 'page') && (r.page_from != null || r.page != null)) {
                    const a = r.page_from != null ? r.page_from : r.page;
                    const b = r.page_to != null ? r.page_to : a;
                    rangeSpec = 'pp. ' + a + (String(a) !== String(b) ? ('~' + b) : '');
                } else if (r.select_mode === 'all') {
                    rangeSpec = 'all';
                }
            }
            return {
                value: (r.material_folder || '') + '::' + (r.published_file || ''),
                range_spec: rangeSpec,
                label: r.label || ''
            };
        }).filter(function (r) { return r.value && r.value !== '::'; });
    }

    function refreshMaterialRangeLabel(pathStr) {
        const rows = readMaterialMetaRows(pathStr);
        const label = buildMaterialRangeLabelFromRows(rows);
        const rangeEl = document.getElementById('node-material-range-' + pathStr);
        const hidden = document.getElementById('node-material-selected-json-' + pathStr);
        if (hidden) {
            hidden.value = JSON.stringify(rows.map(function (m) {
                return {
                    value: (m.material_folder || '') + '::' + (m.published_file || ''),
                    range_spec: m.range_spec || '',
                    label: m.label || ''
                };
            }));
        }
        // 若畫面上列數少於已存在的逐頁批改稿冊數，不要用殘缺列去縮水 base 範圍／標題
        const unitsHost = document.getElementById('node-grading-units-' + pathStr);
        let unitStemCount = 0;
        if (unitsHost) {
            const stems = {};
            unitsHost.querySelectorAll('.grading-unit-script').forEach(function (ta) {
                const s = String(ta.getAttribute('data-stem') || '').trim();
                if (s) stems[s] = true;
            });
            unitStemCount = Object.keys(stems).length;
        }
        // 💣 同 refreshSkeletonRangeLabel 的雷區：rows 暫時是 0（老師正在重選 meta，或勾選框
        // 中途全部取消）時，label 會算成空字串；若既有欄位已有值，不可因此清空覆寫。
        const incomplete = unitStemCount > 0 && rows.length < unitStemCount;
        if (!incomplete && rangeEl) {
            rangeEl.value = label;
        }
        const rangeText = (rangeEl && String(rangeEl.value || '').trim()) || label || '';
        if (!incomplete && rangeText) {
            applyInheritedTitleFromRange(pathStr, rangeText);
            // 同層考試標題若仍為自動繼承，一併更新
            syncSiblingExamTitleFromRange(pathStr, rangeText);
        }
        return label;
    }

    /**
     * 標題空白、或先前由 base 範圍自動帶入時 → 同步成最新範圍。
     * 老師手動改過且「仍有字」時不覆寫；若之後把標題刪光，恢復繼承。
     */
    function applyInheritedTitleFromRange(pathStr, rangeText) {
        const titleEl = document.getElementById('node-title-' + pathStr);
        if (!titleEl || !rangeText) return;
        const current = String(titleEl.textContent || '').trim();
        const node = getTaskNodeByPathStr(pathStr);
        // 考試標題：只有空白才能繼承。有字＝老師手改，禁止用下面細節／範圍覆寫。
        if (node && node.type === 'exam') {
            if (current) return;
        } else {
            const autoFlag = titleEl.getAttribute('data-title-auto');
            const prevFrom = String(titleEl.getAttribute('data-title-from-range') || '').trim();
            const shouldAuto = !current || autoFlag === '1' || (prevFrom && current === prevFrom);
            if (!shouldAuto) return;
        }
        titleEl.textContent = rangeText;
        titleEl.setAttribute('data-title-auto', '1');
        titleEl.setAttribute('data-title-from-range', rangeText);
    }

    /** 依 pathStr 取得該任務節點（只讀，不建立），找不到回傳 null */
    function getTaskNodeByPathStr(pathStr) {
        const bStateObj = window.BuilderStore && window.BuilderStore.getState();
        if (!bStateObj || !Array.isArray(bStateObj.tasks)) return null;
        const arr = String(pathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let list = bStateObj.tasks;
        let node = null;
        for (let i = 0; i < arr.length; i++) {
            node = list[arr[i]];
            if (!node) return null;
            list = node.subTasks || [];
        }
        return node;
    }

    /**
     * 標題輸入：有字＝手動；刪光＝立刻恢復從 base 範圍繼承。
     * 💣 雷區：這支是所有葉節點標題（錄音／考試／一般…）共用的 oninput，不能無條件對任何
     * 類型都去抓「同層錄音的 base 範圍」──getSiblingAudioRangeLabel 是為「考試」跟同層錄音
     * 配對設計的，若不先檢查節點類型，會導致「一般」(check) 或其他無關類型的任務，標題被刪光後
     * 立刻被同層錄音的 base 範圍文字蓋回去（老師刪不掉標題）。只有 exam 類型才走這條 fallback；
     * audio_record 有自己的 node-material-range 欄位，會在上面 rangeEl 那段就直接命中，不需要
     * 也不應該再往下 fallback 到別的任務。
     */
    function onNodeTitleInput(pathStr, el) {
        const titleEl = el || document.getElementById('node-title-' + pathStr);
        if (!titleEl) return;
        const current = String(titleEl.textContent || '').trim();
        if (current) {
            titleEl.setAttribute('data-title-auto', '0');
            return;
        }
        titleEl.setAttribute('data-title-auto', '1');
        let rangeText = '';
        const rangeEl = document.getElementById('node-material-range-' + pathStr)
            || document.getElementById('node-material-range-manual-' + pathStr);
        if (rangeEl) rangeText = String(rangeEl.value || '').trim();
        if (!rangeText) {
            const node = getTaskNodeByPathStr(pathStr);
            if (node && node.type === 'exam' && window.FeatureExamJob
                && typeof window.FeatureExamJob.getSiblingAudioRangeLabel === 'function') {
                rangeText = window.FeatureExamJob.getSiblingAudioRangeLabel(pathStr) || '';
            }
        }
        if (rangeText) applyInheritedTitleFromRange(pathStr, rangeText);
    }

    function asMetaFileName(name) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        return /\.meta\.json$/i.test(raw) ? raw : (raw + '.meta.json');
    }

    function displayStemFromMetaFileLocal(fileName) {
        const stem = String(fileName || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        const m = stem.match(/^(.+)\.([A-Za-z][A-Za-z0-9_-]*)$/);
        return m ? m[1] : stem;
    }

    function buildPackRangeSpec(rangeType, start, end) {
        const a = String(start || '').trim();
        const b = String(end || '').trim();
        if (!a) return '';
        const lo = a;
        const hi = b || a;
        if (rangeType === 'qnum') {
            return lo === hi ? ('#' + lo) : ('#' + lo + '~' + hi);
        }
        return lo === hi ? ('p. ' + lo) : ('pp. ' + lo + '~' + hi);
    }

    function readRangePackFromDom(pathStr) {
        const comboEl = document.getElementById('range-pack-combo-' + pathStr);
        const sheetEl = document.getElementById('range-pack-sheet-' + pathStr);
        const rtypeEl = document.getElementById('range-pack-rtype-' + pathStr);
        const startEl = document.getElementById('range-pack-start-' + pathStr);
        const endEl = document.getElementById('range-pack-end-' + pathStr);
        const comboId = comboEl ? String(comboEl.value || '').trim() : '';
        const opt = comboEl && comboEl.options[comboEl.selectedIndex];
        return {
            comboId: comboId,
            comboLabel: (comboId && opt) ? String(opt.text || '').trim() : '',
            metaFile: sheetEl ? String(sheetEl.value || '').trim() : '',
            rangeType: (rtypeEl && rtypeEl.value === 'qnum') ? 'qnum' : 'page',
            start: startEl ? String(startEl.value || '').trim() : '',
            end: endEl ? String(endEl.value || '').trim() : ''
        };
    }

    function resolvePackCombo(classId, comboId) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!comboId || !fcmc || typeof fcmc.getAssignedComboById !== 'function') return null;
        return fcmc.getAssignedComboById(classId, comboId) || null;
    }

    function resolvePackMetaFile(combo, pickedMeta) {
        const metas = (combo && Array.isArray(combo.metaFiles)) ? combo.metaFiles : [];
        if (metas.length === 1) return asMetaFileName(metas[0]);
        const want = String(pickedMeta || '').trim();
        if (!want || !metas.length) return '';
        const hit = metas.find(function (m) {
            return String(m).toUpperCase() === want.toUpperCase()
                || String(m).replace(/\.meta\.json$/i, '').toUpperCase() === want.replace(/\.meta\.json$/i, '').toUpperCase();
        });
        return hit ? asMetaFileName(hit) : '';
    }

    function applyRangePackToAudio(audioTask, pack) {
        if (!audioTask) return '';
        if (!audioTask.raw_data) audioTask.raw_data = {};
        const raw = audioTask.raw_data;
        raw.script_source = raw.script_source || 'meta';
        const combo = pack.combo;
        const metaFile = String(pack.metaFile || '').trim();
        const rangeSpec = pack.rangeSpec || '';
        if (!combo || !metaFile) return String(raw.material_range || '').trim();
        const stem = displayStemFromMetaFileLocal(metaFile);
        const ref = {
            materials_root_kind: combo.rootKind === 'class' ? 'class' : 'teacher',
            material_folder: combo.folderName || '',
            published_file: metaFile,
            metaFile: metaFile,
            label: stem,
            range_spec: rangeSpec,
            select_mode: 'range_spec'
        };
        const prev = Array.isArray(raw.material_refs) ? raw.material_refs.slice() : [];
        if (prev.length > 1) {
            prev[0] = ref;
            raw.material_refs = prev;
        } else {
            raw.material_refs = [ref];
        }
        raw.material_ref = ref;
        let coverage = stem;
        const MS = window.MaterialSnapshot;
        if (rangeSpec && MS && typeof MS.formatRangeLabel === 'function') {
            coverage = MS.formatRangeLabel(stem, rangeSpec);
        } else if (rangeSpec) {
            coverage = stem + ' ' + rangeSpec;
        }
        raw.material_range = coverage;
        return coverage;
    }

    function syncRangePackChildDom(groupPathStr, pack, coverage) {
        const group = getTaskNodeByPathStr(groupPathStr);
        if (!group || !Array.isArray(group.subTasks)) return;
        const audioIdx = group.subTasks.findIndex(function (t) { return t && t.type === 'audio_record'; });
        const examIdx = group.subTasks.findIndex(function (t) { return t && t.type === 'exam'; });
        if (audioIdx >= 0) {
            const audioPath = groupPathStr + '-' + audioIdx;
            const rangeEl = document.getElementById('node-material-range-' + audioPath);
            if (rangeEl && coverage) rangeEl.value = coverage;
            const rowsEl = document.getElementById('node-material-rows-' + audioPath);
            const firstRow = rowsEl && rowsEl.querySelector('.material-meta-row');
            if (firstRow && pack.combo && pack.metaFile) {
                const fileEl = firstRow.querySelector('.material-meta-file');
                const specEl = firstRow.querySelector('.material-meta-range');
                const value = (pack.combo.folderName || '') + '::' + pack.metaFile;
                if (fileEl) fileEl.value = value;
                if (specEl && pack.rangeSpec) specEl.value = pack.rangeSpec;
            }
            const audioTitleEl = document.getElementById('node-title-' + audioPath);
            if (audioTitleEl && coverage && audioTitleEl.getAttribute('data-title-auto') !== '0') {
                audioTitleEl.textContent = coverage;
                audioTitleEl.setAttribute('data-title-auto', '1');
                audioTitleEl.setAttribute('data-title-from-range', coverage);
            }
        }
        if (examIdx >= 0) {
            const examPath = groupPathStr + '-' + examIdx;
            const comboEl = document.getElementById('exam-inline-materialfolder-' + examPath + '-0')
                || document.getElementById('exam-inline-materialfolder-' + examPath);
            if (comboEl && pack.combo) comboEl.value = pack.combo.id;
            const rtypeEl = document.getElementById('exam-inline-rtype-' + examPath + '-0-0');
            const startEl = document.getElementById('exam-inline-start-' + examPath + '-0-0');
            const endEl = document.getElementById('exam-inline-end-' + examPath + '-0-0');
            if (rtypeEl && pack.rangeType) rtypeEl.value = pack.rangeType;
            if (startEl && pack.start !== '') startEl.value = pack.start;
            if (endEl && (pack.end !== '' || pack.start !== '')) endEl.value = pack.end || pack.start;
            const examTitleEl = document.getElementById('node-title-' + examPath);
            if (examTitleEl && coverage && !String(examTitleEl.textContent || '').trim()) {
                examTitleEl.textContent = coverage;
                examTitleEl.setAttribute('data-title-auto', '1');
                examTitleEl.setAttribute('data-title-from-range', coverage);
            }
        }
    }

    /**
     * 範圍層開包：選套餐／活頁／起迄後，寫進組 raw_data，並預設同步到底下錄音與考試。
     * rerender=false 用於起迄輸入，避免數字框失焦。
     */
    function onRangePackChange(pathStr, opts) {
        opts = opts || {};
        const rerender = opts.rerender !== false;
        if (rerender && window.BuilderStore && typeof window.BuilderStore.sync === 'function') {
            window.BuilderStore.sync();
        }
        const group = getTaskNodeByPathStr(pathStr);
        if (!group || group.type !== 'group') return;
        if (!group.raw_data) group.raw_data = {};
        group.raw_data.group_role = 'range';

        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const fromDom = readRangePackFromDom(pathStr);
        const combo = resolvePackCombo(classId, fromDom.comboId);
        const metaFile = resolvePackMetaFile(combo, fromDom.metaFile);
        const rangeSpec = buildPackRangeSpec(fromDom.rangeType, fromDom.start, fromDom.end);

        group.raw_data.pack_combo_id = combo ? combo.id : '';
        group.raw_data.pack_combo_label = combo ? String(combo.label || fromDom.comboLabel || '').trim() : '';
        group.raw_data.pack_meta_file = metaFile;
        group.raw_data.pack_range_type = fromDom.rangeType;
        group.raw_data.pack_start = fromDom.start;
        group.raw_data.pack_end = fromDom.end;

        const titleEl = document.getElementById('node-title-' + pathStr);
        const groupAuto = !titleEl || titleEl.getAttribute('data-title-auto') !== '0';
        if (groupAuto) {
            const derived = window.BuilderStore && typeof window.BuilderStore.deriveRangeTitleFromGroup === 'function'
                ? window.BuilderStore.deriveRangeTitleFromGroup(group)
                : (group.raw_data.pack_combo_label || '');
            if (derived) {
                group.title = derived;
                group.raw_data.title_auto_from_range = true;
                if (titleEl) {
                    titleEl.textContent = derived;
                    titleEl.setAttribute('data-title-auto', '1');
                }
            }
        }

        const audio = (group.subTasks || []).find(function (t) { return t && t.type === 'audio_record'; });
        const exam = (group.subTasks || []).find(function (t) { return t && t.type === 'exam'; });
        const pack = {
            combo: combo,
            metaFile: metaFile,
            rangeType: fromDom.rangeType,
            start: fromDom.start,
            end: fromDom.end,
            rangeSpec: rangeSpec
        };
        const coverage = applyRangePackToAudio(audio, pack);
        if (exam && window.FeatureExamJob && typeof window.FeatureExamJob.applyRangePackToExam === 'function') {
            window.FeatureExamJob.applyRangePackToExam(exam, pack);
        }

        if (rerender) {
            if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
                window.FeatureTimeline.refreshBuilder({ skipSync: true });
            }
            const audioIdx = (group.subTasks || []).findIndex(function (t) { return t && t.type === 'audio_record'; });
            if (audioIdx >= 0 && combo && metaFile && rangeSpec) {
                scheduleAutoSnapshot(pathStr + '-' + audioIdx);
            }
            return;
        }
        syncRangePackChildDom(pathStr, pack, coverage);
        const audioIdx = (group.subTasks || []).findIndex(function (t) { return t && t.type === 'audio_record'; });
        if (audioIdx >= 0 && combo && metaFile && rangeSpec) {
            scheduleAutoSnapshot(pathStr + '-' + audioIdx);
        }
    }

    let _rangePackComboRefreshBusy = false;
    function maybeRefreshRangePackCombos() {
        if (_rangePackComboRefreshBusy) return;
        if (!document.querySelector('.range-pack-combo')) return;
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.isOfficialPairingCacheReady !== 'function') return;
        if (fcmc.isOfficialPairingCacheReady()) return;
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        if (!bState || !bState.classId || typeof fcmc.prefetchForClass !== 'function') return;
        _rangePackComboRefreshBusy = true;
        fcmc.prefetchForClass(bState.classId).then(function () {
            _rangePackComboRefreshBusy = false;
            if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
                window.FeatureTimeline.refreshBuilder({ skipSync: true });
            }
        }).catch(function () {
            _rangePackComboRefreshBusy = false;
        });
    }

    /**
     * 範圍層（group_role==='range'）標題輸入：有字＝手動、關掉自動旗標；刪光＝立刻恢復從
     * 套餐名稱（舊作業則從錄音範圍）繼承。跟 onNodeTitleInput 分開一支，因為範圍層的來源是
     * deriveRangeTitleFromGroup（讀整個 group 節點）。
     */
    function onGroupTitleInput(pathStr, el) {
        const titleEl = el || document.getElementById('node-title-' + pathStr);
        if (!titleEl) return;
        const current = String(titleEl.textContent || '').trim();
        if (current) {
            titleEl.setAttribute('data-title-auto', '0');
            return;
        }
        titleEl.setAttribute('data-title-auto', '1');
        const bStateObj = window.BuilderStore && window.BuilderStore.getState();
        if (!bStateObj || !Array.isArray(bStateObj.tasks)) return;
        const arr = String(pathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let list = bStateObj.tasks;
        let node = null;
        for (let i = 0; i < arr.length; i++) {
            node = list[arr[i]];
            if (!node) return;
            list = node.subTasks || [];
        }
        if (node && window.BuilderStore && typeof window.BuilderStore.deriveRangeTitleFromGroup === 'function') {
            const derived = window.BuilderStore.deriveRangeTitleFromGroup(node);
            if (derived) titleEl.textContent = derived;
        }
    }

    function syncSiblingExamTitleFromRange(audioPathStr, rangeText) {
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks) || !rangeText) return;
        const arr = String(audioPathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let list = bState.tasks;
        const base = [];
        for (let i = 0; i < arr.length - 1; i++) {
            const node = list[arr[i]];
            if (!node) return;
            base.push(arr[i]);
            list = node.subTasks || [];
        }
        for (let i = 0; i < (list || []).length; i++) {
            const t = list[i];
            if (!t || t.type !== 'exam') continue;
            applyInheritedTitleFromRange(base.concat([i]).join('-'), rangeText);
        }
    }

    function readSelectedMaterialMetas(pathStr) {
        return readMaterialMetaRows(pathStr);
    }

    async function buildMergedMaterialSnapshot(pathStr, classId) {
        // 🌟 曾發生：畫面上明明排了 3 列 meta（例如 C、D、E），但其中一列的下拉選單
        // 因非同步選項清單還沒載完、或該檔案不在清單裡，導致 <select> 實際值是空字串；
        // readMaterialMetaRows() 會把空值的列「靜默略過」，snapshot 就少了一頁，
        // 老師卻毫無所覺地存檔，事後才發現 base 範圍跟批改稿都對不上。
        // 這裡改成：一發現「畫面上的列數」跟「成功讀到值的列數」不一致，就直接擋下、
        // 明確告知哪裡沒選好，而不是悄悄丟掉那一列。
        const rowsEl = document.getElementById('node-material-rows-' + pathStr);
        const actualRowCount = rowsEl ? rowsEl.querySelectorAll('.material-meta-row').length : 0;
        const selected = readMaterialMetaRows(pathStr);
        if (!selected.length) throw new Error('請至少新增一列 meta');
        if (selected.length < actualRowCount) {
            throw new Error(
                '有 ' + (actualRowCount - selected.length) + ' 列尚未選擇 meta 檔案（下拉選單是空的），'
                + '請補選檔案後再套用 Snapshot；否則該列會被整段忽略，造成 base 範圍與批改稿數量對不上。'
            );
        }
        for (let i = 0; i < selected.length; i++) {
            if (!selected[i].range_spec) {
                throw new Error('第 ' + (i + 1) + ' 列請填範圍（例：pp. 1~2, 5, 10 或 #11~16, 26）');
            }
        }
        const rootKind = readMaterialsRootKind(pathStr);
        const folderId = await resolveMaterialsRootFolderId(classId, rootKind);
        const scriptParts = [];
        const displayParts = [];
        const gradingUnits = [];
        const metaItems = [];
        const refs = [];
        const metaRowsByStem = {};

        // 一批讀完（含 fileId），避免 N 次 GAS 冷啟動
        const batchItems = selected.map(function (picker) {
            const fid = lookupMetaFileId(pathStr, picker.material_folder, picker.published_file);
            return {
                materialFolder: resolveStoredFolderName(picker.material_folder),
                fileName: picker.published_file || '',
                fileId: fid || ''
            };
        });
        let batchFiles = null;
        if (typeof window.GasService.readMaterialFiles === 'function') {
            try {
                batchFiles = await window.GasService.readMaterialFiles(folderId, batchItems, rootKind);
            } catch (batchErr) {
                console.warn('[FeatureTimeline] batch read 失敗，改逐檔', batchErr);
                batchFiles = null;
            }
        }

        // 逐檔讀取（含重試 1 次）：多冊一次送出批次讀取時，GAS／Drive 偶發對「某一冊」
        // 逾時或速率限制很常見（曾發生 C~F 四冊只有 C 成功，D/E/F 失敗就整批 throw，
        // 結果畫面停在舊的「只有 C」快取，老師以為自動套用壞了）。
        // 單檔失敗不可直接讓整批 throw：先重試，仍失敗才真正視為錯誤中斷。
        async function readOneWithRetry(picker) {
            const fid = lookupMetaFileId(pathStr, picker.material_folder, picker.published_file);
            let lastErr = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    return await window.GasService.readMaterialFile(
                        folderId, resolveStoredFolderName(picker.material_folder), picker.published_file, rootKind,
                        fid ? { fileId: fid } : undefined
                    );
                } catch (err) {
                    lastErr = err;
                    if (attempt === 0) await delay(600);
                }
            }
            throw lastErr;
        }

        for (let i = 0; i < selected.length; i++) {
            const picker = selected[i];
            let fileResult = null;
            if (batchFiles && batchFiles[i] && batchFiles[i].ok) {
                fileResult = batchFiles[i];
            } else {
                // batch 沒回這筆、或這筆 ok:false（例如速率限制／逾時）：改走單檔＋重試，
                // 而不是讓「一冊失敗」拖累其他已成功的冊一起被丟棄。
                try {
                    fileResult = await readOneWithRetry(picker);
                } catch (singleErr) {
                    const batchMsg = (batchFiles && batchFiles[i] && batchFiles[i].message) || '';
                    throw new Error(
                        '讀取「' + (picker.material_folder || '') + '/' + (picker.published_file || '') + '」失敗：'
                        + (singleErr.message || batchMsg || '未知錯誤')
                        + '（已自動重試 1 次仍失敗；請稍候再改動任一列範圍以重新觸發，或按「套用 Snapshot」）'
                    );
                }
            }
            const rows = window.MaterialSnapshot.parseMetaContent(fileResult.content);
            const sliceOpts = { range_spec: picker.range_spec, select_mode: 'range_spec' };
            const ctx = Object.assign({}, picker, sliceOpts, {
                materials_root_kind: rootKind,
                label: picker.label,
                range_spec: picker.range_spec
            });
            const snapshot = window.MaterialSnapshot.sliceAndBuild(rows, sliceOpts, ctx);
            const stem = picker.label || metaStemFromFileName(picker.published_file);
            // 完整 meta 列快取：考試「產生線上卷」可離線抽題，不必再打 GAS
            metaRowsByStem[String(stem || '').toUpperCase()] = rows;
            if (snapshot.original_script) {
                scriptParts.push('【' + stem + '】\n' + snapshot.original_script);
            }
            if (snapshot.student_display) {
                // student_display 已含 【A】[1] 頁首，勿再包一層
                displayParts.push(snapshot.student_display);
            }
            if (Array.isArray(snapshot.grading_units) && snapshot.grading_units.length) {
                snapshot.grading_units.forEach(function (u) {
                    gradingUnits.push(u);
                });
            }
            if (Array.isArray(snapshot.meta_items) && snapshot.meta_items.length) {
                snapshot.meta_items.forEach(function (it) {
                    metaItems.push(it);
                });
            }
            refs.push(Object.assign({}, snapshot.material_ref, {
                range_spec: picker.range_spec,
                label: stem,
                fileId: fileResult.fileId || lookupMetaFileId(pathStr, picker.material_folder, picker.published_file) || ''
            }));
        }

        const rangeLabel = buildMaterialRangeLabelFromRows(selected);
        const hint = (window.MaterialSnapshot && window.MaterialSnapshot.RECORDING_UNIT_HINT)
            ? window.MaterialSnapshot.RECORDING_UNIT_HINT
            : '錄音時以「一頁」為唯一錄音單位：每一頁請錄成一支音檔上傳。';
        return {
            material_refs: refs,
            material_ref: refs[0] || null,
            material_range: rangeLabel,
            original_script: scriptParts.join('\n\n'),
            student_display: displayParts.join('\n\n'),
            student_display_text: displayParts.join('\n\n'),
            grading_units: gradingUnits,
            meta_items: metaItems,
            meta_rows_by_stem: metaRowsByStem,
            recording_unit: 'page',
            recording_unit_hint: hint,
            snapshot_at: new Date().toISOString()
        };
    }

    /** 讀取「逐頁」批改稿編輯框目前的值（老師微調後的最新版本）；沒有逐頁框時回傳 null。 */
    function collectGradingUnitsFromDom(pathStr) {
        const container = document.getElementById('node-grading-units-' + pathStr);
        if (!container) return null;
        const rows = Array.from(container.querySelectorAll('.grading-unit-script'));
        if (!rows.length) return null;
        return rows.map(function (el) {
            const page = el.getAttribute('data-page');
            return {
                unit_key: el.getAttribute('data-unit-key') || '',
                stem: el.getAttribute('data-stem') || '',
                page: page === '' ? null : (isNaN(Number(page)) ? page : Number(page)),
                label: el.getAttribute('data-label') || '',
                original_script: String(el.value || '').trim(),
                item_count: Number(el.getAttribute('data-item-count')) || 0
            };
        });
    }

    /** 依逐頁批改稿重算合併預覽框內容（唯讀，僅供人眼核對，不影響實際批改）。 */
    function rebuildMergedScriptFromUnits(units) {
        return units.map(function (u) {
            const label = u.label || u.stem || '';
            const script = u.original_script || '';
            return label ? ('【' + label + '】\n' + script) : script;
        }).join('\n\n');
    }

    function toggleMaterialSliceFields(pathStr) {
        // 新版以每列 range_spec 為準，無需切換共用頁碼／題號欄
        refreshMaterialRangeLabel(pathStr);
    }

    function walkAudioRecordNodes(tasks, parentPath, visitor) {
        if (!Array.isArray(tasks)) return;
        tasks.forEach(function (t, idx) {
            const pathArray = parentPath.concat([idx]);
            const pathStr = pathArray.join('-');
            if (t.type === 'audio_record') visitor(t, pathStr);
            if (t.type === 'group' && Array.isArray(t.subTasks)) {
                walkAudioRecordNodes(t.subTasks, pathArray, visitor);
            }
        });
    }

    function refreshMaterialSliceFieldVisibility() {
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState || !Array.isArray(bState.tasks)) return;
        walkAudioRecordNodes(bState.tasks, [], function (_task, pathStr) {
            toggleMaterialSliceFields(pathStr);
        });
    }

    /** 開啟編輯器時，骨架模式（E）base 範圍也要跟 A 一樣自動依現有單元路徑整理一次，不留給老師手動觸發才看得到 */
    function refreshAllSkeletonRangeLabels() {
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState || !Array.isArray(bState.tasks)) return;
        walkAudioRecordNodes(bState.tasks, [], function (task, pathStr) {
            const raw = task.raw_data || {};
            if (raw.script_source !== 'skeleton') return;
            if (!document.getElementById('node-skeleton-units-' + pathStr)) return;
            refreshSkeletonRangeLabel(pathStr);
        });
    }

    function hydrateMaterialSnapshotUI() {
        // 與新建作業同一條：自動預載老師＋班級清單並灌入各錄音節點
        autoPrimeMaterialMetaUI().catch(function (err) {
            console.warn('[FeatureTimeline] autoPrimeMaterialMetaUI', err);
        });
    }

    function applySnapshotToNode(pathStr, snapshot) {
        const scriptEl = document.getElementById('node-script-' + pathStr);
        const studentTextEl = document.getElementById('node-student-text-' + pathStr);
        const scriptPasteEl = document.getElementById('node-script-paste-' + pathStr);
        const studentPasteEl = document.getElementById('node-student-text-paste-' + pathStr);
        const previewEl = document.getElementById('node-material-preview-' + pathStr);
        const snapshotJsonEl = document.getElementById('node-material-snapshot-json-' + pathStr);
        const scriptSourceEl = document.getElementById('node-script-source-' + pathStr);
        const materialRangeEl = document.getElementById('node-material-range-' + pathStr);

        const displayText = snapshot.student_display || snapshot.student_display_text || '';
        if (scriptEl) scriptEl.value = snapshot.original_script || '';
        if (studentTextEl) studentTextEl.value = displayText;
        if (scriptPasteEl) scriptPasteEl.value = snapshot.original_script || '';
        if (studentPasteEl) studentPasteEl.value = displayText;

        // 一頁一批改稿：重新套用 Snapshot 時，逐頁編輯框也要跟著重繪，否則舊頁數的框會殘留或對不上新內容
        const gradingUnitsWrap = scriptEl ? scriptEl.parentElement : null;
        const scriptLabelEl = document.getElementById('node-script-label-' + pathStr);
        let unitsHost = document.getElementById('node-grading-units-' + pathStr);
        if (unitsHost && unitsHost.parentElement) unitsHost.parentElement.remove();
        const units = Array.isArray(snapshot.grading_units) ? snapshot.grading_units : [];
        if (scriptEl) {
            if (units.length > 1) {
                scriptEl.setAttribute('readonly', 'readonly');
                scriptEl.style.background = '#F1F5F9';
                scriptEl.style.color = '#64748B';
            } else {
                scriptEl.removeAttribute('readonly');
                scriptEl.style.background = '';
                scriptEl.style.color = '';
            }
        }
        if (scriptLabelEl) {
            scriptLabelEl.textContent = '🎯 AI 批改文稿' + (units.length > 1 ? '（合併預覽，唯讀）' : '（可微調）');
        }
        if (units.length > 1 && gradingUnitsWrap) {
            const wrap = document.createElement('div');
            wrap.style.marginTop = '4px';
            const hint = document.createElement('div');
            hint.style.cssText = 'font-size:0.78rem; color:#7C3AED; font-weight:800; margin-bottom:6px;';
            hint.textContent = '⚠️ 偵測到 ' + units.length + ' 頁，AI 批改已依頁拆分；請在下方「逐頁」微調（上面合併框僅供預覽，不會用於批改）';
            const rowsHost = document.createElement('div');
            rowsHost.id = 'node-grading-units-' + pathStr;
            rowsHost.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
            units.forEach(function (u, uIdx) {
                const row = document.createElement('div');
                row.className = 'grading-unit-row';
                row.style.cssText = 'background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px;';
                const label = u.label || (u.stem ? (u.stem + ' p.' + (u.page != null ? u.page : '?')) : ('第 ' + (uIdx + 1) + ' 頁'));
                const title = document.createElement('div');
                title.style.cssText = 'font-weight:900; color:#4338CA; font-size:0.8rem; margin-bottom:4px;';
                title.textContent = '📄 ' + label;
                const ta = document.createElement('textarea');
                ta.className = 'form-control grading-unit-script';
                ta.setAttribute('data-unit-key', u.unit_key || label);
                ta.setAttribute('data-stem', u.stem || '');
                ta.setAttribute('data-page', u.page != null ? String(u.page) : '');
                ta.setAttribute('data-label', label);
                ta.setAttribute('data-item-count', u.item_count != null ? String(u.item_count) : '');
                ta.style.cssText = 'width:100%; min-height:56px; padding:8px; font-size:0.88rem; border-radius:6px; border:1px solid #CBD5E1;';
                ta.value = u.original_script || '';
                ta.addEventListener('input', function () {
                    window.FeatureTimeline.onGradingUnitScriptInput(pathStr);
                });
                row.appendChild(title);
                row.appendChild(ta);
                rowsHost.appendChild(row);
            });
            wrap.appendChild(hint);
            wrap.appendChild(rowsHost);
            gradingUnitsWrap.appendChild(wrap);
        }

        if (scriptSourceEl) {
            scriptSourceEl.value = 'meta';
            if (window.FeatureTimeline && window.FeatureTimeline.onScriptSourceChange) {
                window.FeatureTimeline.onScriptSourceChange(pathStr);
            }
        }

        if (materialRangeEl) {
            if (snapshot.material_range) {
                materialRangeEl.value = snapshot.material_range;
            } else if (snapshot.material_refs && snapshot.material_refs.length) {
                materialRangeEl.value = buildMaterialRangeLabelFromRows(snapshot.material_refs);
            }
        }

        if (previewEl) {
            const refCount = (snapshot.material_refs && snapshot.material_refs.length) || (snapshot.material_ref ? 1 : 0);
            const unitCount = Array.isArray(snapshot.grading_units) ? snapshot.grading_units.length : 0;
            previewEl.textContent = '已合併 ' + refCount + ' 個 meta｜批改單位 '
                + unitCount + ' 頁（一頁一檔）｜AI 稿 '
                + (snapshot.original_script || '').length + ' 字；學生顯示 '
                + displayText.length + ' 字；凍結於 ' + (snapshot.snapshot_at || '')
                + (snapshot.material_range ? ('｜' + snapshot.material_range) : '')
                + (snapshot.recording_unit_hint ? ('｜' + snapshot.recording_unit_hint) : '');
        }
        if (snapshotJsonEl) snapshotJsonEl.value = JSON.stringify(snapshot);

        // 同步寫回 BuilderStore state，避免中途任何重繪把剛套用的 snapshot 蓋回舊值
        if (window.BuilderStore && typeof window.BuilderStore.updateNodeMaterialSnapshot === 'function') {
            window.BuilderStore.updateNodeMaterialSnapshot(pathStr, snapshot);
        }

        // rows 是「套用 Snapshot」的輸入來源，理論上應與 snapshot.material_refs 一致；
        // 這裡強制用 snapshot 的結果重繪一次 rows，避免任何時序差導致存檔時讀到不同筆數的 rows。
        // 💣 雷區：ensureMetaCatalog 是 async；若 A 套用後老師立刻 +B，舊 callback 會把 B 列蓋掉。
        // 用世代號 +「DOM 已比 snapshot 多冊則不縮水」雙保險。
        const rowsEl = document.getElementById('node-material-rows-' + pathStr);
        if (rowsEl && Array.isArray(snapshot.material_refs) && snapshot.material_refs.length) {
            const kind = readMaterialsRootKind(pathStr);
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            const applyGen = (_snapshotApplyGen[pathStr] = (_snapshotApplyGen[pathStr] || 0) + 1);
            const snapRows = snapshot.material_refs.map(function (r) {
                return {
                    value: (r.material_folder || '') + '::' + (r.published_file || ''),
                    range_spec: r.range_spec || '',
                    label: r.label || ''
                };
            });
            function shouldApplySnapRows() {
                if (_snapshotApplyGen[pathStr] !== applyGen) return false;
                // 已有更新的一輪排隊等著重跑（老師在這輪套用完成後、清單載入完成前又改了東西）→
                // 讓那一輪讀「當下最新」DOM 重繪即可，這裡不要用已經過期的 snapRows 蓋一次。
                if (_autoSnapshotPending[pathStr]) return false;
                const live = readMaterialMetaRows(pathStr);
                // 畫面已比這次 snapshot 多冊（老師剛加了下一列）→ 禁止用舊 snapshot 縮水
                if (live.length > snapRows.length) return false;
                return true;
            }
            if (bState) {
                ensureMetaCatalog(bState.classId, kind).then(function (options) {
                    if (!shouldApplySnapRows()) return;
                    _materialMetaOptionsCache[pathStr] = options;
                    renderMaterialMetaRows(pathStr, options, snapRows);
                }).catch(function () {
                    if (!shouldApplySnapRows()) return;
                    renderMaterialMetaRows(pathStr, _materialMetaOptionsCache[pathStr] || [], snapRows);
                });
            }
        }
    }

    function checkCanEditTimeline(classId) {
        if (!db || !db.classes) return false;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return false;
        const userRole = cls.staff_role || (window.TeacherUI && window.TeacherUI.getCurrentUserRole ? window.TeacherUI.getCurrentUserRole(classId) : 'primary_teacher');
        return ['admin', 'primary_teacher', 'co_teacher', 'ta_senior'].includes(userRole);
    }

    const scrollToCurrentWeek = () => {
        if (window.BuilderStore && window.BuilderStore.getState()) return; 
        const targetNode = document.querySelector('.timeline-node[data-is-current="true"]');
        const container = document.querySelector('.view-section.active');
        if (targetNode && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = targetNode.getBoundingClientRect();
            const scrollAmount = nodeRect.top - containerRect.top - 15;
            container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }
    };

    function parseClassRaw(cls) {
        let raw = (cls && (cls.raw_data || cls.rawData)) || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        return raw && typeof raw === 'object' ? raw : {};
    }

    function getTimelineSessions(cls, DateUtils) {
        if (!cls) return [];
        const DU = DateUtils || window.UtilsDate;
        if (!DU) return [];
        let raw = parseClassRaw(cls);
        
        let sessions = [];
        // 已寫入 custom_sessions（含空陣列）即以它為準，避免刪光後又被規則推算加回來
        if (Array.isArray(raw.custom_sessions)) {
            sessions = [...raw.custom_sessions];
        } else if (db && db.sessions && db.sessions[cls.id] && db.sessions[cls.id].length > 0) {
            sessions = [...db.sessions[cls.id]];
        } else {
            let rawMeet = cls.meetDays || cls.meet_days || raw.meet_days || [];
            if (typeof rawMeet === 'string') {
                if (rawMeet.startsWith('[')) {
                    try { rawMeet = JSON.parse(rawMeet); } catch(e) { rawMeet = []; }
                } else {
                    rawMeet = rawMeet.split(',');
                }
            }
            let meetDays = Array.isArray(rawMeet) ? rawMeet.map(Number).filter(n => !isNaN(n)) : [];
            let startDateStr = cls.startDate || cls.start_date || raw.start_date;
            let endDateStr = cls.endDate || cls.end_date || raw.end_date;

            if (startDateStr && endDateStr && meetDays.length > 0) {
                sessions = DU.generateDates(startDateStr, endDateStr, meetDays);
            }
        }
        
        return sessions.map(d => DU.normalizeDateString(d)).filter(Boolean);
    }

    /** 進度日清單（不含「僅因作業而出現」的幽靈日），供改期下拉使用 */
    function listProgressDates(classId) {
        const DateUtils = window.UtilsDate;
        if (!db || !db.classes || !DateUtils) return [];
        const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return [];
        return getTimelineSessions(cls, DateUtils).slice().sort();
    }

    function getSemesterBounds(cls) {
        const DateUtils = window.UtilsDate;
        const raw = parseClassRaw(cls);
        const start = DateUtils.normalizeDateString(cls.startDate || cls.start_date || raw.start_date || '');
        const end = DateUtils.normalizeDateString(cls.endDate || cls.end_date || raw.end_date || '');
        return { start: start || '', end: end || '' };
    }

    async function persistCustomSessions(classId, sessions, scrollMode) {
        const DateUtils = window.UtilsDate;
        if (!db || !db.classes || !DateUtils) throw new Error('系統資料尚未就緒');
        const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) throw new Error('找不到班級');

        const normalized = [...new Set((sessions || []).map(function (d) {
            return DateUtils.normalizeDateString(d);
        }).filter(Boolean))].sort();

        const raw = parseClassRaw(cls);
        const mergedRaw = Object.assign({}, raw, { custom_sessions: normalized });

        const { data: updatedRows, error } = await window.supabaseClient
            .from('classes')
            .update({ raw_data: mergedRaw })
            .eq('id', classId)
            .select('id');
        if (error) throw error;
        if (!updatedRows || updatedRows.length === 0) throw new Error('資料庫拒絕寫入排程');

        cls.raw_data = mergedRaw;
        cls.rawData = mergedRaw;
        if (!db.sessions) db.sessions = {};
        db.sessions[classId] = normalized;
        if (typeof db.save === 'function') db.save();

        renderTimeline(classId, scrollMode || 'none');
        return normalized;
    }

    async function ensureCustomSessionsList(classId) {
        const DateUtils = window.UtilsDate;
        const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) throw new Error('找不到班級');
        const raw = parseClassRaw(cls);
        if (Array.isArray(raw.custom_sessions)) {
            return raw.custom_sessions.map(function (d) {
                return DateUtils.normalizeDateString(d);
            }).filter(Boolean).sort();
        }
        const materialized = getTimelineSessions(cls, DateUtils);
        return persistCustomSessions(classId, materialized, 'none');
    }

    function renderTimeline(classId, scrollMode = 'current', targetId = null) {
        const container = document.getElementById('timeline-container');
        if (!container) return;
        if (window.FeatureClassMaterialCombinations
            && typeof window.FeatureClassMaterialCombinations.prefetchForClass === 'function') {
            window.FeatureClassMaterialCombinations.prefetchForClass(classId).catch(function () {});
        }

        try {
            const TPL = window.TimelineTemplates; 
            const DateUtils = window.UtilsDate;   

            if (!TPL || !DateUtils) {
                container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 系統錯誤：核心依賴模組遺失。</div>`;
                return;
            }
            
            container.className = '';
            const cls = (db && db.classes) ? db.classes.find(c => c.id === classId) : null;
            if (!cls) {
                container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 找不到該班級的主檔資料</div>`;
                return;
            }
            
            const canEditTimeline = checkCanEditTimeline(classId);
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            const classAssignments = (db && db.assignments) ? db.assignments : [];
            let sessions = getTimelineSessions(cls, DateUtils);

            const assignmentDates = classAssignments
                .filter(a => a.class_id === classId && a.target_date)
                .map(a => DateUtils.normalizeDateString(a.target_date));
            
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            if (sessions.length === 0) {
                container.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px;">無排程資料。請至「⚙️ 課程基本資料」設定學期起訖日與上課日。</p>';
                return;
            }

            const weekStartSetting = raw.week_start_day || 'sunday';
            const todayStr = DateUtils.getTaiwanTodayString();
            const currentWeekStart = DateUtils.getWeekStartStr(todayStr, weekStartSetting);
            
            const mode = cls.calcMode || cls.calc_mode || 'single';

            let timelineNodes = [];
            if (mode === 'single') {
                timelineNodes = sessions.map(d => ({ title: d, dates: [d] }));
            } else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = DateUtils.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => {
                    timelineNodes.push({ title: chunk.length > 1 ? `${chunk[0]} ~ ${chunk[chunk.length-1]}` : chunk[0], dates: chunk });
                });
            }

            let html = '';
            timelineNodes.forEach((node, index) => {
                const nodeWeekStart = DateUtils.getWeekStartStr(node.dates[0], weekStartSetting);
                let isCurrent = (nodeWeekStart === currentWeekStart);
                let isFuture = node.dates[0] > todayStr;
                const nodeDate = node.dates[0];
                const nodeAssignments = classAssignments.filter(a => a.class_id === classId && node.dates.includes(DateUtils.normalizeDateString(a.target_date)));
                
                let assignmentsHtml = '';
                if (nodeAssignments.length > 0) {
                    nodeAssignments.forEach(a => {
                        let effectiveBlockDueDate = a.due_date;
                        let aRaw = a.raw_data || {};
                        if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
                        
                        let blockLateMode = 'infinite', blockPenalty = 0, blockGrace = 0;
                        if (aRaw.late_policy) {
                            if (!aRaw.late_policy.allow_late) blockLateMode = 'no_late';
                            else if (aRaw.late_policy.grace_period_hours > 0) { blockLateMode = 'custom'; blockGrace = aRaw.late_policy.grace_period_hours; }
                            blockPenalty = aRaw.late_policy.penalty_percentage || 0;
                        }
                        const effectiveBlockLatePolicy = { mode: blockLateMode, penalty: blockPenalty, grace: blockGrace };
                        let tasksHtml = TPL.renderReadOnlyTree(a.tasks || [], effectiveBlockDueDate, effectiveBlockLatePolicy, 0);
                        assignmentsHtml += TPL.getAssignmentBlockHtml(a, classId, canEditTimeline, effectiveBlockDueDate, blockLateMode, blockPenalty, blockGrace, tasksHtml);
                    });
                }
                const builderContainerId = `builder-container-${index}`;
                // 單堂刪一日；週模式刪該節點內全部上課日（有作業時在 handler 擋下）
                const canDeleteSession = !!canEditTimeline;
                html += TPL.getTimelineNodeHtml(index, mode, node.title, isCurrent, isFuture, nodeDate, classId, canEditTimeline, assignmentsHtml, builderContainerId, canDeleteSession, node.dates);
                // 兩節之間的灰線上可加新日期／進度（加入後週模式會自動歸入對應週）
                if (canEditTimeline && index < timelineNodes.length - 1 && typeof TPL.getTimelineRailAddHtml === 'function') {
                    html += TPL.getTimelineRailAddHtml(classId);
                }
            });
            // 最後一節之後也可加（方便補在尾端）
            if (canEditTimeline && timelineNodes.length > 0 && typeof TPL.getTimelineRailAddHtml === 'function') {
                html += TPL.getTimelineRailAddHtml(classId);
            }

            const toolbarHtml = canEditTimeline
                ? `<div style="display:flex; justify-content:flex-end; align-items:center; gap:10px; margin:0 0 12px 20px; flex-wrap:wrap;">
                    <span style="font-size:0.85rem; color:#64748B; font-weight:600;">客製化堂次會寫入排程；若再按「自動鋪設」可能被規則重算覆蓋。</span>
                    <button type="button" class="btn btn-action" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-weight:800;"
                        onclick="window.FeatureTimeline.openAddSessionModal('${classId}')">＋ 加堂</button>
                   </div>`
                : '';
            
            container.innerHTML = TPL.getTimelineStyleBlock() + toolbarHtml;
            const timelineWrapper = document.createElement('div');
            timelineWrapper.style.borderLeft = '3px solid #E2E8F0';
            timelineWrapper.style.marginLeft = '20px';
            timelineWrapper.style.paddingLeft = '50px'; 
            timelineWrapper.innerHTML = html;
            container.appendChild(timelineWrapper);

            if (scrollMode === 'current') {
                setTimeout(scrollToCurrentWeek, 250);
            } else if (scrollMode === 'target' && targetId) {
                setTimeout(() => {
                    const targetEl = document.getElementById(targetId);
                    const viewContainer = document.querySelector('.view-section.active');
                    if (targetEl && viewContainer) {
                        const cRect = viewContainer.getBoundingClientRect();
                        const nRect = targetEl.getBoundingClientRect();
                        viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                    }
                }, 300);
            }

            const viewProgress = document.getElementById('timeline-container').closest('.view-content') || document.getElementById('view-progress');
            if (viewProgress && !window._timelineObserverAttached) {
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                            const style = window.getComputedStyle(viewProgress);
                            if (style.display !== 'none' && viewProgress.classList.contains('active')) {
                                if (!window.BuilderStore || !window.BuilderStore.getState()) setTimeout(scrollToCurrentWeek, 100); 
                            }
                        }
                    });
                });
                observer.observe(viewProgress, { attributes: true });
                window._timelineObserverAttached = true;
            }

        } catch (error) {
            console.error("Timeline Render Crashed:", error);
            container.innerHTML = `<div style="padding:20px; background:#FEE2E2; border:2px solid #EF4444; border-radius:10px; margin: 20px;"><h3 style="color:#B91C1C; margin-top:0;">⚠️ 進度軸渲染失敗</h3><p style="color:#7F1D1D;">錯誤原因：${error.message}</p></div>`;
        }
    }

    async function renderBuilderUI() {
        const TPL = window.TimelineTemplates;
        if (!window.BuilderStore) return;
        const bState = window.BuilderStore.getState();
        if (!bState || !TPL) return;
        const container = document.getElementById(bState.containerId);
        if (!container) return;

        let classResOpts = '';
        const FR = window.FeatureResource;
        let allResList = (db && db.resourceLibrary) || [];
        let staffIds = [];
        if (FR && typeof FR.fetchClassStaffUserIds === 'function') {
            const staffCacheKey = '_resStaff_' + bState.classId;
            if (!window[staffCacheKey]) {
                window[staffCacheKey] = await FR.fetchClassStaffUserIds(bState.classId);
            }
            staffIds = window[staffCacheKey] || [];
        }
        if (FR && typeof FR.resourceAppliesToClass === 'function') {
            allResList = allResList.filter(function (r) {
                return FR.resourceAppliesToClass(r, bState.classId, staffIds);
            });
        } else {
            allResList = allResList.filter(function (r) {
                return r.scope === 'global' || (r.scope === 'class' && r.target_class_id === bState.classId);
            });
        }

        if (allResList.length > 0) {
            const uniqueResList = (FR && FR.mergeResourcesByUrl)
                ? FR.mergeResourcesByUrl(allResList)
                : allResList;

            classResOpts = uniqueResList.map(function (r) {
                const scopeIcon = r.scope === 'global' ? '🌍' : (r.scope === 'teacher' ? '👥' : '🏷️');
                return '<option value="' + r.id + '">' + r.icon + ' ' + r.name + ' (' + scopeIcon + ')</option>';
            }).join('');
        }

        let tasksHtml = bState.tasks && bState.tasks.length > 0 ? TPL.renderBuilderTree(bState.tasks, [], classResOpts) : '';
        let tasksContainerHtml = tasksHtml ? `<div style="margin-bottom: 15px;">${tasksHtml}</div>` : '';
        const allAssignsForHistory = (db && db.assignments || []).filter(a => a.class_id === bState.classId);
        let historyHtml = (bState.editId) ? `<div style="color:var(--primary); font-weight:900; margin-bottom:15px; font-size:1rem;">「修改模式」</div>` : TPL.getHistoryDropdownHtml(allAssignsForHistory, bState.containerId);

        container.innerHTML = TPL.getBuilderFormHtml(bState, classResOpts, tasksContainerHtml, historyHtml);
        // 雷區：innerHTML 重繪後立刻補 meta 列（不要等 API），避免畫面 0 列
        try { seedMaterialMetaRowsForAllAudioNodes(); } catch (_seedErr) {}
        setTimeout(function () {
            refreshMaterialSliceFieldVisibility();
            refreshAllSkeletonRangeLabels();
            maybeRefreshRangePackCombos();
            // 再自動灌清單進下拉
            autoPrimeMaterialMetaUI().catch(function (err) {
                console.warn('[FeatureTimeline] autoPrime after renderBuilderUI', err);
                try { seedMaterialMetaRowsForAllAudioNodes(); } catch (_e2) {}
                if (window.showFlash) {
                    window.showFlash('自動載入 meta 清單失敗：' + (err && err.message ? err.message : err)
                        + '（列應仍在，可按重新整理清單）', 'error');
                }
            });
        }, 0);
    }

    return {
        renderTimeline,
        scrollToCurrentWeek,
        
        getTaskParentArray: (pathArray) => window.BuilderStore.getTaskParentArray(pathArray),
        
        openBuilder: (classId, date, containerId) => {
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法新增或修改作業。', 'error');
            window.BuilderStore.initNew(classId, date, containerId);
            renderBuilderUI();
            setTimeout(() => { 
                const titleEl = document.getElementById(`builder-title-${containerId}`);
                if (titleEl) {
                    titleEl.focus(); 
                    const cRect = document.querySelector('.view-section.active').getBoundingClientRect();
                    const nRect = titleEl.getBoundingClientRect();
                    document.querySelector('.view-section.active').scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 50);
        },
        editAssignment: (assignId) => {
            if (!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(a.class_id)) return window.showFlash('權限不足：您的身分無法修改此作業。', 'error');
            
            const cls = db.classes.find(c => c.id === a.class_id) || {};
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            let sessions = getTimelineSessions(cls, window.UtilsDate);
            const assignmentDates = db.assignments.filter(ast => ast.class_id === a.class_id).map(ast => window.UtilsDate.normalizeDateString(ast.target_date));
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            const mode = cls.calcMode || 'single';
            const weekStartSetting = raw.week_start_day || 'sunday';
            let timelineNodes = [];
            if (mode === 'single') timelineNodes = sessions.map(d => ({ dates: [d] }));
            else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = window.UtilsDate.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => timelineNodes.push({ dates: chunk }));
            }

            const targetDateStr = window.UtilsDate.normalizeDateString(a.target_date);
            const nodeIndex = timelineNodes.findIndex(node => node.dates.includes(targetDateStr));
            const cId = `builder-container-${nodeIndex >= 0 ? nodeIndex : 0}`; 

            window.BuilderStore.initEdit(a, cId);
            renderTimeline(a.class_id, 'none');
            // renderBuilderUI 已 seed＋autoPrime；勿再 hydrateMaterialSnapshotUI（會 double-prime／卡頓）
            renderBuilderUI();
            
            setTimeout(() => {
                const editorEl = document.getElementById(`${cId}-editor`);
                const viewContainer = document.querySelector('.view-section.active');
                if (editorEl && viewContainer) {
                    const cRect = viewContainer.getBoundingClientRect();
                    const nRect = editorEl.getBoundingClientRect();
                    viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 300);
        },

        applyResourceUrl: (pathStr, resId, targetInputId = null) => {
            if (!resId || !db || !db.resourceLibrary) return;
            const res = db.resourceLibrary.find(r => r.id === resId);
            if (!res) return;
            
            const realUrl = res.url || ''; 
            
            if (targetInputId) {
                const el = document.getElementById(targetInputId);
                if (el) {
                    el.value = realUrl;
                    window.BuilderStore.sync(); 
                }
            } else if (pathStr) {
                window.BuilderStore.updateNodeUrl(pathStr, realUrl);
                renderBuilderUI();
            }
        },

        // 🌟 鐵律實作：學生教材專用，純 Base64 轉換，絕不呼叫 PDF 解析！
        handleStudentLocalFileChange: (inputEl, pathStr) => {
            const file = inputEl.files[0];
            if (!file) {
                document.getElementById(`node-student-local-b64-${pathStr}`).value = '';
                document.getElementById(`node-student-local-mime-${pathStr}`).value = '';
                document.getElementById(`node-student-local-filename-${pathStr}`).value = '';
                return;
            }
            if (file.size > 15 * 1024 * 1024) { 
                window.showFlash('檔案過大，請選擇 15MB 以下的檔案', 'error');
                inputEl.value = '';
                return;
            }
            
            const containerId = window.BuilderStore.getState().containerId;
            const btn = document.getElementById(`btn-save-block-${containerId}`);
            if(btn) { btn.disabled = true; btn.innerHTML = '⏳ 讀取檔案中...'; }

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                document.getElementById(`node-student-local-b64-${pathStr}`).value = base64;
                document.getElementById(`node-student-local-mime-${pathStr}`).value = file.type;
                document.getElementById(`node-student-local-filename-${pathStr}`).value = file.name;
                window.BuilderStore.sync();
                if(btn) { btn.disabled = false; btn.innerHTML = `💾 ${window.BuilderStore.getState().editId ? '儲存修改' : '完成並儲存區塊'}`; }
            };
            reader.readAsDataURL(file);
        },

        // 這是給 AI 批改基準 (original_script) 使用的，跟學生畫面的 PDF 完全無關
        handlePDFUpload: async (inputEl, pathStr) => {
            const file = inputEl.files[0];
            if (!file) return;
            const textarea = document.getElementById(`node-script-${pathStr}`);
            if (!textarea) return;

            const originalText = textarea.value;
            textarea.value = '⏳ 正在解析 PDF 文字，請稍候...';

            try {
                let pdfjsCore = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                if (!pdfjsCore) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('PDF.js 網路載入失敗'));
                        document.head.appendChild(script);
                    });
                    
                    pdfjsCore = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                    if (!pdfjsCore) throw new Error('無法取得 PDF.js 核心物件');
                }

                pdfjsCore.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsCore.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n\n';
                }

                textarea.value = fullText.trim();
                window.showFlash('PDF 文字萃取成功，請檢查並修飾排版');

            } catch (error) {
                console.error("PDF 解析失敗:", error);
                textarea.value = originalText;
                window.showFlash('PDF 解析失敗：' + error.message, 'error');
            } finally {
                inputEl.value = ''; 
                window.BuilderStore.sync(); 
            }
        },

        addNode: (pathStr, type) => { window.BuilderStore.addNode(pathStr, type); renderBuilderUI(); },
        addRangeBundle: (pathStr) => { window.BuilderStore.addRangeBundle(pathStr); renderBuilderUI(); },
        removeNode: (pathStr) => { window.BuilderStore.removeNode(pathStr); renderBuilderUI(); },
        moveNodeUp: (pathStr) => { window.BuilderStore.moveNodeUp(pathStr); renderBuilderUI(); },
        moveNodeDown: (pathStr) => { window.BuilderStore.moveNodeDown(pathStr); renderBuilderUI(); },
        moveNodeLeft: (pathStr) => { window.BuilderStore.moveNodeLeft(pathStr); renderBuilderUI(); },
        moveNodeRight: (pathStr) => { window.BuilderStore.moveNodeRight(pathStr); renderBuilderUI(); },
        changeNodeType: (pathStr, newType) => { window.BuilderStore.changeNodeType(pathStr, newType); renderBuilderUI(); },
        /**
         * @param {object} [opts]
         * @param {boolean} [opts.skipSync] 已寫入 BuilderStore、DOM 尚為舊畫面時必須 skip，
         *   否則 sync 會用舊 DOM 覆寫剛寫入的 exam sections／quiz_paper 相關狀態。
         */
        refreshBuilder: (opts) => {
            if (!window.BuilderStore) return;
            if (!(opts && opts.skipSync)) window.BuilderStore.sync();
            renderBuilderUI();
        },
        updateNodeUrl: (pathStr, val) => { window.BuilderStore.updateNodeUrl(pathStr, val); renderBuilderUI(); },
        copyPrevNodeUrl: (pathStr) => { window.BuilderStore.copyPrevNodeUrl(pathStr); renderBuilderUI(); },
        addResourceTaskAsLink: (pathStr, resId) => {
            if(!db || !db.resourceLibrary) return;
            const res = db.resourceLibrary.find(r => r.id === resId);
            if (res) { window.BuilderStore.addResourceTaskAsLink(pathStr, res); renderBuilderUI(); }
        },
        copyHistory: (historyId) => {
            if(!historyId || !db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === historyId);
            if (a) { window.BuilderStore.copyHistory(a); renderBuilderUI(); }
        },

        saveBlock: async (btnEl) => {
            window.BuilderStore.sync(); 
            const bState = window.BuilderStore.getState();
            const titleText = bState.title.replace(/<[^>]*>?/gm, '').trim();
            if (!titleText) return window.showFlash('⚠️ 請填寫大區塊標題！', 'error');
            if (!db.assignments) db.assignments = [];
            
            const originalText = btnEl.innerHTML;
            btnEl.innerHTML = '⏳ 處理中...'; btnEl.disabled = true;

            try {
                // 🌟 雲端上傳攔截器：掃描並上傳所有 Student Local File 到 GAS
                const processTasksForUpload = async (tasks) => {
                    for (let t of tasks) {
                        if (t.type === 'group' && t.subTasks) {
                            await processTasksForUpload(t.subTasks);
                        } else if (t.type === 'audio_record' && t.raw_data) {
                            const raw = t.raw_data;
                            if ((raw.student_source_type === 'local' || raw.script_source === 'resource') && raw.student_local_b64) {
                                btnEl.innerHTML = `⏳ 上傳教材: ${raw.student_local_filename}...`;
                                
                                const cls = window.TeacherDB.classes.find(c => c.id === bState.classId);
                                let clsRaw = {};
                                if (cls && cls.raw_data) {
                                    try { clsRaw = typeof cls.raw_data === 'string' ? JSON.parse(cls.raw_data) : cls.raw_data; } catch(e){}
                                }
                                const targetFolderId = clsRaw.drive_folder_id || clsRaw.class_folder_id || '';
                                
                                if (!targetFolderId) throw new Error('該班級尚未綁定雲端資料夾，無法自動上傳檔案');
                                
                                if (typeof window.GasService === 'undefined' || !window.GasService.uploadStudentLocalFile) {
                                    throw new Error('系統錯誤：找不到 GasService 模組或函數');
                                }

                                // 🌟 強制收納至 01_Class_Resources（舊名 01_Materials 由 GAS 自動改名）
                                const fileUrl = await window.GasService.uploadStudentLocalFile(
                                    raw.student_local_b64,
                                    raw.student_local_filename,
                                    raw.student_local_mime,
                                    targetFolderId,
                                    bState.editId || '',
                                    t.id,
                                    '01_Class_Resources'
                                );

                                // 🚀 上傳成功，轉化為 Drive 模式存檔
                                raw.student_source_type = 'drive';
                                raw.student_drive_url = fileUrl;
                                raw.material_url = fileUrl;
                                raw.student_drive_desc = raw.student_local_desc || raw.material_range || '';
                                if (raw.script_source !== 'resource') raw.script_source = 'resource';
                                
                                delete raw.student_local_b64;
                                delete raw.student_local_mime;
                                delete raw.student_local_filename;
                                delete raw.student_local_desc;
                            }
                        }
                    }
                };

                await processTasksForUpload(bState.tasks);

                /**
                 * 2026-08-16：儲存作業只存作業。線上卷只在老師按「產生試卷」時產生。
                 * 這裡最多補寫舊卷缺的簽章，絕不重抽出卷。
                 */
                const backfillExamSignatures = function (tasks) {
                    (tasks || []).forEach(function (t) {
                        if (t.type === 'group' && t.subTasks) backfillExamSignatures(t.subTasks);
                        else if (t.type === 'exam' && window.FeatureExamJob
                            && typeof window.FeatureExamJob.ensureExamPaperSignatureBackfilled === 'function') {
                            window.FeatureExamJob.ensureExamPaperSignatureBackfilled(t);
                        }
                    });
                };
                backfillExamSignatures(bState.tasks);

                btnEl.innerHTML = '⏳ 儲存至雲端...';

                let mergedRawData = bState.raw_data || {};
                if (typeof mergedRawData === 'string') { try { mergedRawData = JSON.parse(mergedRawData); } catch(e) { mergedRawData = {}; } }
                
                let mode = bState.late_mode || 'infinite';
                let allowLate = (mode === 'infinite' || mode === 'custom');
                let grace = (mode === 'custom') ? (parseInt(bState.late_grace) || 0) : 0;
                let penalty = (mode !== 'no_late') ? (parseInt(bState.late_penalty) || 0) : 0;

                mergedRawData.late_policy = { allow_late: allowLate, grace_period_hours: grace, penalty_percentage: penalty };
                delete mergedRawData.allow_late; delete mergedRawData.late_policy.is_inherited; 
                
                const payload = {
                    class_id: bState.classId, target_date: window.UtilsDate.normalizeDateString(bState.target_date), title: bState.title, description: bState.description,
                    due_date: bState.due_date || null, is_published: bState.is_published, tasks: [...bState.tasks], raw_data: mergedRawData
                };

                let savedId = bState.editId;

                if (bState.editId) {
                    const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update(payload).eq('id', bState.editId).is('deleted_at', null).select(); 
                    if (error) throw new Error(error.message);
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    const idx = db.assignments.findIndex(a => a.id === bState.editId);
                    if(idx !== -1) db.assignments[idx] = { id: bState.editId, ...payload };
                } else {
                    const { data, error } = await window.supabaseClient.from('assignments').insert([payload]).select().single();
                    if (error) throw new Error(error.message);
                    if (!data) throw new Error("資料庫拒絕了請求");
                    db.assignments.push(data); savedId = data.id; 
                }
                const savedClassId = bState.classId; 
                window.BuilderStore.clear();
                renderTimeline(savedClassId, 'target', `assign-block-${savedId}`);
            } catch (err) {
                window.showFlash('作業儲存失敗：' + err.message, 'error');
                btnEl.innerHTML = originalText; btnEl.disabled = false;
            }
        },
        /**
         * 💣 雷區（2026-08-11 老師回報「明明產生過線上卷，學生端卻顯示尚未產生」）：
         * 「產生線上卷」跟「儲存作業」以前是兩個獨立步驟——按了產生只是寫進瀏覽器記憶體裡的
         * bState.tasks，沒有另外按「完成並儲存區塊」，一離開／被別的操作蓋掉就整份不見，
         * 老師很容易誤以為「產生」＝「已存檔」。
         * 這裡給一個只寫 tasks 欄位的輕量存檔（不動 title／due_date／late_policy 等），只在
         * 「這個作業區塊本來就已經存在資料庫」（bState.editId 有值）才能用；全新、還沒按過
         * 「完成並儲存區塊」的區塊沒有 assignment id 可以 update，仍必須維持舊提示叫老師手動存。
         * 目前只接在「產生線上卷」成功之後（見 feature-exam-job.js inlineGeneratePaper），
         * 讓「產生」當下就直接落地，不再依賴老師記得再按一次存檔。
         */
        quickSaveTasksOnly: async () => {
            if (!window.BuilderStore || typeof window.BuilderStore.getState !== 'function') {
                return { ok: false, error: '找不到 BuilderStore' };
            }
            const bState = window.BuilderStore.getState();
            if (!bState) return { ok: false, error: '找不到目前編輯狀態' };
            if (!bState.editId) return { ok: false, error: 'not_saved_yet' };
            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ tasks: [...bState.tasks] })
                    .eq('id', bState.editId)
                    .is('deleted_at', null)
                    .select();
                if (error) throw new Error(error.message);
                if (!updatedRows || updatedRows.length === 0) throw new Error('資料庫拒絕了修改');
                const idx = db.assignments.findIndex(a => a.id === bState.editId);
                if (idx !== -1) db.assignments[idx].tasks = updatedRows[0].tasks;
                return { ok: true };
            } catch (err) {
                console.warn('[FeatureTimeline] quickSaveTasksOnly failed', err);
                return { ok: false, error: (err && err.message) || String(err) };
            }
        },
        cancelBuilder: () => {
            const cid = window.BuilderStore.getState().classId;
            window.BuilderStore.clear();
            renderTimeline(cid, 'none');
        },
        deleteHistoryTemplate: async () => {
            const state = window.BuilderStore.getState();
            if (!state) return;
            const selectEl = document.getElementById(`history-select-${state.containerId}`);
            if (!selectEl) return;
            const historyId = selectEl.value;
            if (!historyId) return window.showFlash('⚠️ 請先選擇要刪除的歷史紀錄！', 'error');
            if (!(await window.ModalOverlay.confirm('確定要封存這個歷史作業模板嗎？'))) return;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ deleted_at: window.UtilsDate.getTaiwanIsoTimestamp() }).eq('id', historyId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                db.assignments = db.assignments.filter(a => a.id !== historyId);
                window.showFlash('已成功封存');
                renderBuilderUI();
            } catch (err) { window.showFlash('封存失敗：' + err.message, 'error'); }
        },
        deleteAssignment: async (assignId, classId) => {
            if(!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法封存作業。', 'error');
            if (!(await window.ModalOverlay.confirm('確定要封存此作業區塊嗎？\n(注意：這將會隱藏作業，學生的打勾紀錄仍會保存在系統中)'))) return;
            
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳'; btn.disabled = true;

            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ deleted_at: window.UtilsDate.getTaiwanIsoTimestamp() }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕請求");

                db.assignments = db.assignments.filter(a => a.id !== assignId);
                renderTimeline(classId, 'none');
            } catch (err) {
                window.showFlash('封存失敗：' + err.message, 'error');
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        confirmLinePush: (assignId, classId) => {
            const TPL = window.TimelineTemplates;
            if(!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a || !TPL) return;

            const cls = db.classes.find(c => c.id === classId);
            let raw = cls?.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }
            if (!raw.line_notify_token) return window.showFlash('⚠️ 此班級尚未綁定 LINE Notify Token！\n請先至「⚙️ 班級設定」中進行綁定。', 'error');

            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            const overlayId = 'line-push-modal';
            let existing = document.getElementById(overlayId);
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            overlay.innerHTML = TPL.getLinePushModalHtml(cleanTitle, assignId, classId, overlayId);
            document.body.appendChild(overlay);
        },
        executeLinePush: async (assignId, classId) => {
            const btn = document.getElementById('btn-confirm-push');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 發送中...'; btn.disabled = true;

            try {
                if (!window.ServiceLineNotify || typeof window.ServiceLineNotify.pushAssignment !== 'function') throw new Error("系統提示：LINE 推播微服務尚未載入。");
                await window.ServiceLineNotify.pushAssignment(classId, assignId);
                document.getElementById('line-push-modal').remove();
                window.showFlash('已成功發送至 LINE 群組');
            } catch (err) {
                window.showFlash('推播失敗：' + err.message, 'error');
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        dragAssignStart: (e, id) => { dragAssignId = id; e.dataTransfer.effectAllowed = 'move'; },
        dropAssign: async (e, targetId, classId) => {
            e.preventDefault(); e.stopPropagation(); 
            if (!dragAssignId || dragAssignId === targetId || !db || !db.assignments) return;

            const arr = db.assignments;
            const fromIdx = arr.findIndex(a => a.id === dragAssignId);
            const toIdx = arr.findIndex(a => a.id === targetId);

            if (fromIdx > -1 && toIdx > -1) {
                const targetDate = arr[toIdx].target_date;
                const [dragged] = arr.splice(fromIdx, 1);
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate; 
                arr.splice(toIdx, 0, dragged);
                renderTimeline(classId, 'none'); 
                
                if (oldDate !== targetDate) {
                    try {
                        const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
                        if (error) throw error;
                        if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    } catch (err) {
                        dragged.target_date = oldDate; 
                        renderTimeline(classId, 'none');
                        window.showFlash('排序更新失敗：' + err.message, 'error');
                    }
                }
            }
            dragAssignId = null;
        },
        dropAssignToNode: async (e, targetDate, classId) => {
            e.preventDefault();
            if (!dragAssignId || !db || !db.assignments) return;
            const dragged = db.assignments.find(a => a.id === dragAssignId);
            
            if (dragged && dragged.target_date !== targetDate) {
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate;
                renderTimeline(classId, 'none'); 

                try {
                    const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
                    if (error) throw error;
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                } catch (err) {
                    dragged.target_date = oldDate; 
                    renderTimeline(classId, 'none');
                    window.showFlash('拖曳更新失敗：' + err.message, 'error');
                }
            }
            dragAssignId = null;
        },
        openAddSessionModal: (classId) => {
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法調整堂次。', 'error');
            if (!window.ModalOverlay) return window.showFlash('彈窗模組尚未載入', 'error');
            const TPL = window.TimelineTemplates;
            if (!TPL || typeof TPL.getAddSessionModalHtml !== 'function') return;

            window.ModalOverlay.open({
                id: 'add-session-modal',
                tier: 'B',
                isDirty: function () {
                    const el = document.getElementById('add-session-date');
                    return !!(el && el.value);
                },
                unsavedMessage: '尚未加堂，確定要關閉嗎？',
                contentHtml: TPL.getAddSessionModalHtml(classId)
            });
        },

        submitAddSession: async (classId) => {
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足', 'error');
            const DateUtils = window.UtilsDate;
            const input = document.getElementById('add-session-date');
            const newDate = input ? DateUtils.normalizeDateString(input.value) : '';
            if (!newDate) return window.showFlash('請選擇要加的日期', 'error');

            const btn = document.getElementById('btn-confirm-add-session');
            const originalText = btn ? btn.innerHTML : '';
            if (btn) { btn.innerHTML = '⏳ 處理中...'; btn.disabled = true; }

            try {
                let list = await ensureCustomSessionsList(classId);
                if (list.indexOf(newDate) > -1) {
                    window.showFlash('這個日期已在進度中', 'error');
                    return;
                }

                const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
                const bounds = getSemesterBounds(cls);
                if (bounds.start && bounds.end && (newDate < bounds.start || newDate > bounds.end)) {
                    const ok = await window.ModalOverlay.confirm(
                        '此日期（' + newDate + '）不在學期區間（' + bounds.start + ' ~ ' + bounds.end + '）內。\n\n仍要加進進度嗎？'
                    );
                    if (!ok) return;
                }

                list = list.concat([newDate]);
                await persistCustomSessions(classId, list, 'none');
                if (window.ModalOverlay) window.ModalOverlay.close('add-session-modal');
                window.showFlash('已加堂：' + newDate, 'success');
            } catch (err) {
                window.showFlash('加堂失敗：' + (err.message || err), 'error');
            } finally {
                if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
            }
        },

        removeSessionDate: async (classId, dateStr) => {
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法調整堂次。', 'error');
            const DateUtils = window.UtilsDate;
            // 支援單日，或週模式一次刪多日（逗號分隔）
            const days = String(dateStr || '').split(',').map(function (d) {
                return DateUtils.normalizeDateString(String(d || '').trim());
            }).filter(Boolean);
            if (days.length === 0) return;

            const daySet = {};
            days.forEach(function (d) { daySet[d] = true; });

            const hasHw = (db.assignments || []).some(function (a) {
                if (String(a.class_id) !== String(classId) || a.deleted_at) return false;
                const t = DateUtils.normalizeDateString(a.target_date);
                return !!daySet[t];
            });
            if (hasHw) {
                return window.showFlash(
                    days.length > 1
                        ? '這一週還有作業，請先用「📅 改期」把作業搬到別天，再刪空白週。'
                        : '這一天還有作業，請先用「📅 改期」把作業搬到別天，再刪空白日。',
                    'error'
                );
            }

            const label = days.length > 1 ? (days[0] + ' ~ ' + days[days.length - 1]) : days[0];
            const unit = days.length > 1 ? '週' : '堂';
            if (!(await window.ModalOverlay.confirm('確定要從進度中移除「' + label + '」這一' + unit + '嗎？（不會刪除任何作業）'))) return;

            try {
                let list = await ensureCustomSessionsList(classId);
                list = list.filter(function (d) { return !daySet[d]; });
                await persistCustomSessions(classId, list, 'none');
                window.showFlash('已移除該' + unit + '：' + label, 'success');
            } catch (err) {
                window.showFlash('刪除堂次失敗：' + (err.message || err), 'error');
            }
        },

        moveAssignment: (assignId, classId) => {
            const TPL = window.TimelineTemplates;
            if (!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a || !TPL) return;
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法搬移此作業。', 'error');
            if (!window.ModalOverlay) return window.showFlash('彈窗模組尚未載入', 'error');

            const currentDate = window.UtilsDate.normalizeDateString(a.target_date);
            let sessionDates = listProgressDates(classId);
            if (currentDate && sessionDates.indexOf(currentDate) === -1) {
                sessionDates = sessionDates.concat([currentDate]).sort();
            }
            if (sessionDates.length === 0) {
                return window.showFlash('目前沒有進度日期可選。請先至「課程基本資料」鋪設排程，或按「＋ 加堂」。', 'error');
            }

            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            window.ModalOverlay.open({
                id: 'move-assign-modal',
                tier: 'A',
                contentHtml: TPL.getMoveAssignModalHtml(cleanTitle, currentDate, a.id, classId, sessionDates)
            });
        },
        submitMove: async (assignId, classId, oldDate) => {
            const newDate = document.getElementById('move-target-date')
                ? window.UtilsDate.normalizeDateString(document.getElementById('move-target-date').value)
                : '';
            if (!newDate) return window.showFlash('⚠️ 請選擇目標日期', 'error');
            if (newDate === oldDate) {
                if (window.ModalOverlay) window.ModalOverlay.close('move-assign-modal');
                return;
            }

            const allowed = listProgressDates(classId);
            if (allowed.indexOf(newDate) === -1 && newDate !== oldDate) {
                return window.showFlash('目標日不在進度清單中。請先按「＋ 加堂」再改期。', 'error');
            }
            
            const btn = document.getElementById('btn-confirm-move');
            const originalText = btn ? btn.innerHTML : '';
            if (btn) { btn.innerHTML = '⏳ 處理中...'; btn.disabled = true; }
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: newDate }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                
                const idx = db.assignments.findIndex(a => a.id === assignId);
                if(idx > -1) db.assignments[idx].target_date = newDate;
                
                if (window.ModalOverlay) window.ModalOverlay.close('move-assign-modal');
                window.FeatureTimeline.renderTimeline(classId, 'target', `assign-block-${assignId}`);
            } catch (err) {
                window.showFlash('改期失敗：' + err.message, 'error');
                if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
            }
        },

        loadMaterialMetaSelect: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return window.showFlash('請先開啟作業編輯器', 'error');
            const rowsEl = document.getElementById('node-material-rows-' + pathStr);
            const statusEl = document.getElementById('node-material-status-' + pathStr);
            if (!rowsEl) {
                return window.showFlash('找不到 meta 列容器（請確認文稿來源是 A. meta）', 'error');
            }
            const rootKind = readMaterialsRootKind(pathStr);
            const destLabel = rootKind === 'teacher' ? '01_My_Materials' : '00_Class_Materials';
            // 雷區：先保證畫面上有列，再打 GAS
            const packed0 = readSavedMetaRowsForPath(pathStr, null);
            const seedRows = packed0.savedRows.length
                ? packed0.savedRows
                : [{ value: '', range_spec: 'pp. 1~2' }];
            if (!rowsEl.querySelector('.material-meta-row')) {
                renderMaterialMetaRows(pathStr, _materialMetaOptionsCache[pathStr] || [], seedRows);
            }
            if (statusEl) {
                statusEl.textContent = '⏳ 重新整理 ' + destLabel + '…';
                statusEl.style.color = '#3B82F6';
            }
            try {
                const options = await ensureMetaCatalog(bState.classId, rootKind, { force: true });
                prefetchMetaCatalogs(bState.classId).catch(function () {});
                const packed = readSavedMetaRowsForPath(pathStr, null);
                const savedRows = packed.savedRows.length
                    ? packed.savedRows
                    : seedRows;
                _materialMetaOptionsCache[pathStr] = options;
                renderMaterialMetaRows(pathStr, options, savedRows);
                if (statusEl) {
                    statusEl.textContent = options.length
                        ? ('✅ 已重新整理｜' + options.length + ' 個 meta｜' + destLabel)
                        : ('⚠️ 已連線但 0 個 meta｜請確認 ' + destLabel + ' 下有教材資料夾與 *.meta.json');
                    statusEl.style.color = options.length ? '#059669' : '#D97706';
                }
                if (!options.length) {
                    window.showFlash('重新整理完成，但 ' + destLabel + ' 沒有找到 meta 檔', 'warning');
                }
            } catch (err) {
                // 失敗仍保留列
                if (!rowsEl.querySelector('.material-meta-row')) {
                    renderMaterialMetaRows(pathStr, [], seedRows);
                }
                const msg = (err && err.message) ? err.message : String(err);
                if (statusEl) {
                    statusEl.textContent = '❌ 重新整理失敗：' + msg;
                    statusEl.style.color = '#DC2626';
                }
                window.showFlash('無法載入 Material：' + msg, 'error');
                try { window.alert('無法載入 meta 清單：\n' + msg); } catch (_e) {}
            }
        },

        addMaterialMetaRow: async function (pathStr) {
            const container = document.getElementById('node-material-rows-' + pathStr);
            if (!container) return;
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            let options = _materialMetaOptionsCache[pathStr] || [];
            if (!options.length && bState) {
                try {
                    options = await ensureMetaCatalog(bState.classId, readMaterialsRootKind(pathStr));
                    _materialMetaOptionsCache[pathStr] = options;
                } catch (err) {
                    return window.showFlash('無法載入 meta 清單：' + (err.message || err), 'error');
                }
            }
            if (!options.length) {
                return window.showFlash('此根目錄尚無 meta 檔。請先發布教材，或按「重新整理清單」。', 'error');
            }
            container.appendChild(createMaterialMetaRowEl(pathStr, options, { value: '', range_spec: '' }));
            refreshMaterialRangeLabel(pathStr);
        },

        removeMaterialMetaRow: function (btnEl, pathStr) {
            const row = btnEl && btnEl.closest ? btnEl.closest('.material-meta-row') : null;
            const container = document.getElementById('node-material-rows-' + pathStr);
            if (row && container) {
                if (container.querySelectorAll('.material-meta-row').length <= 1) {
                    const fileEl = row.querySelector('.material-meta-file');
                    const rangeEl = row.querySelector('.material-meta-range');
                    if (fileEl) fileEl.value = '';
                    if (rangeEl) rangeEl.value = '';
                } else {
                    row.remove();
                }
            }
            refreshMaterialRangeLabel(pathStr);
        },

        ensureMaterialRefsMatchUnits: ensureMaterialRefsMatchUnits,
        rebuildMaterialRefsFromGradingUnits: rebuildMaterialRefsFromGradingUnits,
        uniqueStemsFromGradingUnits: uniqueStemsFromGradingUnits,
        buildMaterialRangeLabelFromRows: buildMaterialRangeLabelFromRows,

        // 供其他模組（如獨立考試教材資料夾下拉）重用同一套「老師個人／班級資源」清單快取，
        // 避免各自各刻一份 GasService.listMaterialMasters 呼叫（見 exam-standalone-material-invariant.mdc）
        ensureMetaCatalog: ensureMetaCatalog,
        getMetaCatalogEntry: getMetaCatalogEntry,
        removeMetaCatalogFileOption: removeMetaCatalogFileOption,
        // 2026-08-06：教材資料夾清單「查到空的」時的除錯文字（GAS 版本戳記／實際解析到的
        // 資料夾 ID／子資料夾數），給 MaterialFolderPicker 等下拉的 emptyMessage 用
        getMetaCatalogDebugText: getMetaCatalogDebugText,
        // 供「教材/Layout 搭配」的「產生並上傳」功能取得教材根目錄（01_My_Materials／00_Class_Materials
        // 的上一層）的 Drive folderId，才能在目標資料夾還不存在時用 GAS create_folder 的
        // folderPath 建出來，不用另寫一份「怎麼找到教材根」的邏輯
        resolveMaterialsRootFolderId: resolveMaterialsRootFolderId,

        previewMaterialSnapshot: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return window.showFlash('請先開啟作業編輯器', 'error');
            if (!window.MaterialSnapshot) return window.showFlash('MaterialSnapshot 模組未載入', 'error');
            const previewEl = document.getElementById('node-material-preview-' + pathStr);
            try {
                const snapshot = await buildMergedMaterialSnapshot(pathStr, bState.classId);
                refreshMaterialRangeLabel(pathStr);
                if (previewEl) {
                    previewEl.innerHTML = '<div style="font-weight:900;margin-bottom:6px;">📍 '
                        + String(snapshot.material_range || '').replace(/</g, '&lt;')
                        + '</div><strong>AI 稿預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 10px;">'
                        + (snapshot.original_script || '').replace(/</g, '&lt;')
                        + '</pre><strong>學生顯示預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 0;">'
                        + (snapshot.student_display || '').replace(/</g, '&lt;') + '</pre>';
                }
            } catch (err) {
                if (previewEl) previewEl.textContent = '❌ ' + err.message;
                window.showFlash('預覽失敗：' + err.message, 'error');
            }
        },

        applyMaterialSnapshot: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return window.showFlash('請先開啟作業編輯器', 'error');
            if (!window.MaterialSnapshot) return window.showFlash('MaterialSnapshot 模組未載入', 'error');
            try {
                const snapshot = await buildMergedMaterialSnapshot(pathStr, bState.classId);
                applySnapshotToNode(pathStr, snapshot);
                const previewEl = document.getElementById('node-material-preview-' + pathStr);
                if (previewEl) {
                    previewEl.innerHTML = '<div style="font-weight:900;margin-bottom:6px;">📍 '
                        + String(snapshot.material_range || '').replace(/</g, '&lt;')
                        + '</div><strong>AI 稿預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 10px;">'
                        + (snapshot.original_script || '').replace(/</g, '&lt;')
                        + '</pre><strong>學生顯示預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 0;">'
                        + (snapshot.student_display || '').replace(/</g, '&lt;') + '</pre>';
                }
                window.showFlash('已寫入 Snapshot：' + (snapshot.material_range || '') + '（請記得儲存作業）');
                if (window.FeatureExamJob && typeof window.FeatureExamJob._refreshAfterAudioSnapshot === 'function') {
                    try { window.FeatureExamJob._refreshAfterAudioSnapshot(pathStr); } catch (_e) {}
                }
            } catch (err) {
                window.showFlash('套用 Snapshot 失敗：' + err.message, 'error');
            }
        },

        onMaterialModeChange: function (pathStr) {
            toggleMaterialSliceFields(pathStr);
        },

        onMaterialRootChange: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return;
            const kind = readMaterialsRootKind(pathStr);
            const statusEl = document.getElementById('node-material-status-' + pathStr);
            // 不清空已選列／範圍；只換該根目錄的下拉清單
            const packed = readSavedMetaRowsForPath(pathStr, null);
            const savedRows = packed.savedRows.length
                ? packed.savedRows
                : [{ value: '', range_spec: 'pp. 1~2' }];
            if (statusEl) {
                statusEl.textContent = '⏳ 切換根目錄，載入清單…';
                statusEl.style.color = '#3B82F6';
            }
            try {
                const options = await ensureMetaCatalog(bState.classId, kind);
                _materialMetaOptionsCache[pathStr] = options;
                renderMaterialMetaRows(pathStr, options, savedRows);
                if (statusEl) {
                    statusEl.textContent = '✅ 已切換｜' + (kind === 'teacher' ? '老師' : '班級')
                        + ' ' + options.length + ' 個 meta｜列 ' + savedRows.length;
                    statusEl.style.color = '#059669';
                }
            } catch (err) {
                _materialMetaOptionsCache[pathStr] = [];
                renderMaterialMetaRows(pathStr, [], savedRows);
                if (statusEl) {
                    statusEl.textContent = '⚠️ 切換後清單載入失敗：' + (err.message || err);
                    statusEl.style.color = '#D97706';
                }
            }
        },

        onMaterialMetaCheckChange: function (pathStr) {
            refreshMaterialRangeLabel(pathStr);
        },

        onGradingUnitScriptInput: function (pathStr) {
            const units = collectGradingUnitsFromDom(pathStr);
            if (!units) return;
            const scriptEl = document.getElementById('node-script-' + pathStr);
            if (scriptEl) scriptEl.value = rebuildMergedScriptFromUnits(units);
        },

        collectGradingUnitsFromDom: function (pathStr) {
            return collectGradingUnitsFromDom(pathStr);
        },

        refreshMaterialRangeLabel: function (pathStr) {
            return refreshMaterialRangeLabel(pathStr);
        },

        onNodeTitleInput: onNodeTitleInput,
        onGroupTitleInput: onGroupTitleInput,
        onRangePackChange: onRangePackChange,

        onScriptSourceChange: function (pathStr) {
            const sourceEl = document.getElementById('node-script-source-' + pathStr);
            const source = sourceEl ? sourceEl.value : 'meta';
            const panels = ['meta', 'range_only', 'paste', 'skeleton'];
            panels.forEach(function (key) {
                const el = document.getElementById('script-source-panel-' + key + '-' + pathStr);
                if (el) el.style.display = (source === key) ? 'block' : 'none';
            });
            // 資源／PDF 面板：D 專用，E 骨架模式下當「選填對照」共用同一組欄位
            const resourceEl = document.getElementById('script-source-panel-resource-' + pathStr);
            if (resourceEl) resourceEl.style.display = (source === 'resource' || source === 'skeleton') ? 'block' : 'none';
            const baseWrap = document.getElementById('node-base-range-wrap-' + pathStr);
            if (baseWrap) baseWrap.style.display = (source === 'meta') ? 'none' : 'flex';
            // 骨架模式：至少給一個空白列，避免老師誤以為要先按別的按鈕才能開始
            if (source === 'skeleton') {
                const listEl = document.getElementById('node-skeleton-units-' + pathStr);
                if (listEl && !listEl.querySelector('.skeleton-unit-row')) {
                    window.FeatureTimeline.addSkeletonUnitRow(pathStr);
                } else {
                    refreshSkeletonRangeLabel(pathStr);
                }
            }
        },

        addSkeletonUnitRow: function (pathStr) {
            const container = document.getElementById('node-skeleton-units-' + pathStr);
            if (!container) return;
            const idx = container.querySelectorAll('.skeleton-unit-row').length;
            const row = document.createElement('div');
            row.className = 'skeleton-unit-row';
            row.setAttribute('data-idx', String(idx));
            row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px; margin-bottom:8px;';
            row.innerHTML = `
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
                    <input type="text" class="form-control skeleton-unit-path" style="padding:6px; font-size:0.85rem; font-weight:800; color:#4338CA;" placeholder="單元路徑，如 Ch2/p15/Ex3/#1">
                    <textarea class="form-control skeleton-unit-script" style="width:100%; min-height:48px; padding:8px; font-size:0.85rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="批改文稿（可留空，之後再補）"></textarea>
                </div>
                <button type="button" class="btn" style="padding:6px 8px; background:white; color:#B91C1C; border:1px solid #FCA5A5;" onclick="window.FeatureTimeline.removeSkeletonUnitRow(this, '${pathStr}')" title="刪除此列">🗑</button>
            `;
            const pathInputEl = row.querySelector('.skeleton-unit-path');
            if (pathInputEl) {
                pathInputEl.addEventListener('input', function () { refreshSkeletonRangeLabel(pathStr); });
            }
            container.appendChild(row);
            refreshSkeletonRangeLabel(pathStr);
        },

        // 用 btnEl.closest() 找到實際被點擊的那一列，避免 data-idx 在多次新增／刪除後重複造成刪錯列
        removeSkeletonUnitRow: function (btnEl, pathStr) {
            const row = btnEl && btnEl.closest ? btnEl.closest('.skeleton-unit-row') : null;
            const container = document.getElementById('node-skeleton-units-' + pathStr);
            if (!row || !container) return;
            if (container.querySelectorAll('.skeleton-unit-row').length <= 1) {
                // 至少留一列（清空即可，避免存檔時整個骨架消失又要重按「加一列」）
                const pathInput = row.querySelector('.skeleton-unit-path');
                const scriptInput = row.querySelector('.skeleton-unit-script');
                if (pathInput) pathInput.value = '';
                if (scriptInput) scriptInput.value = '';
            } else {
                row.remove();
            }
            refreshSkeletonRangeLabel(pathStr);
        },

        /** 從 DOM 讀骨架單元列，回傳 grading_units[]（供存檔時寫入 t.raw_data.grading_units） */
        collectSkeletonUnitsFromDom: function (pathStr) {
            return collectSkeletonUnitsFromDom(pathStr);
        },

        /**
         * C. 自行貼上：➕ 增加視窗。每個視窗＝一段（可標頁碼／exercise），存檔時會合併成
         * raw_data.paste_windows[]（供「📥 由下往上收集文稿」直接讀取結構化分段）＋
         * 合併後的 original_script／student_display（供既有 AI 批改管線讀取，格式不變）。
         */
        addPasteWindowRow: function (pathStr) {
            const container = document.getElementById('node-paste-windows-' + pathStr);
            if (!container || !window.TimelineTemplates || typeof window.TimelineTemplates.renderPasteWindowRowHtml !== 'function') return;
            const idx = container.querySelectorAll('.paste-window-row').length;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = window.TimelineTemplates.renderPasteWindowRowHtml(pathStr, idx, { label: '', script: '', student: '' }, idx + 1);
            const row = wrapper.firstElementChild;
            container.appendChild(row);
            // 剛加的新視窗一定會讓總數變成 >=2，補回第一列本來沒顯示的刪除鈕
            if (container.querySelectorAll('.paste-window-row').length === 2) {
                const firstRow = container.querySelector('.paste-window-row');
                if (firstRow && !firstRow.querySelector('.btn')) {
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'btn';
                    delBtn.style.cssText = 'padding:6px 8px; color:#B91C1C; flex-shrink:0;';
                    delBtn.title = '刪除此視窗';
                    delBtn.textContent = '🗑';
                    delBtn.onclick = function () { window.FeatureTimeline.removePasteWindowRow(delBtn, pathStr); };
                    firstRow.appendChild(delBtn);
                }
            }
        },

        removePasteWindowRow: function (btnEl, pathStr) {
            const row = btnEl && btnEl.closest ? btnEl.closest('.paste-window-row') : null;
            const container = document.getElementById('node-paste-windows-' + pathStr);
            if (!row || !container) return;
            if (container.querySelectorAll('.paste-window-row').length <= 1) return; // 至少留一個視窗
            row.remove();
            // 只剩 1 個視窗時，拿掉它的刪除鈕（回到最單純的單視窗外觀）
            const rows = container.querySelectorAll('.paste-window-row');
            if (rows.length === 1) {
                const onlyBtn = rows[0].querySelector('.btn');
                if (onlyBtn) onlyBtn.remove();
            }
        },

        /** 依目前路徑列重新整理 base 範圍（跟 A 的「依列重算」同角色，供 SSR 模板 oninput／重算鈕呼叫） */
        refreshSkeletonRangeLabel: function (pathStr, opts) {
            return refreshSkeletonRangeLabel(pathStr, opts);
        },

        /** base 範圍欄位手動輸入：有字＝標記手動覆寫，刪光＝恢復自動依路徑整理 */
        onSkeletonRangeManualInput: function (pathStr, el) {
            return onSkeletonRangeManualInput(pathStr, el);
        }
    };
})();
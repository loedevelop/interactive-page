/**
 * 📂 110_teacher_core/feature-exam-job.js
 * 🌟 教師端：匯出考試出題單 exam_job JSON（對齊 Python 出題系統必填欄位）
 *
 * 只收集意圖：job_id + bank + sheet/range/count + layout + outputs。
 * 不發明卷面公式；不呼叫 Python API。
 */
window.FeatureExamJob = (function () {
    'use strict';
    try {

    /** 兩邊約定的題庫清單（可之後改設定檔／DB） */
    const BANK_CATALOG = [
        { id: 'gept2-v1', label: 'GEPT-2 v1', aliases: ['GEPT-2', 'GEPT2', 'gept-2', 'gept2'] }
    ];

    const SHEET_SUGGESTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    const DEFAULT_LINES_PER_PAGE = 10;
    if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
        window.MaterialNameMap.ensureLoaded(false).catch(function () {});
    }

    /** 舊作業資料夾名（如 GEPT-2_sentence）對到現用夾。上傳到未套用雲端夾時不要用這個。 */
    function resolveStoredFolderName(name) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        if (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function') {
            return window.MaterialNameMap.resolveFolderName(raw) || raw;
        }
        return raw;
    }

    const _availAutoFetchKey = {};
    const _availAutoFetchBusy = {};
    const _rangeClampNotified = {};
    const _genStatusByPath = {};

    /**
     * 試卷 → 段落 → 片段。舊 exam_job.sections 是平的抽題列（現在的片段），
     * 讀取時升成「一個段落包住所有舊列」。
     */
    function newSectionId() {
        return 'sec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    function emptySegment(prev) {
        const last = prev || {};
        const endRaw = String(last.end || '').trim();
        const startRaw = String(last.start || '').trim();
        const lastEnd = Number(endRaw);
        const lastStart = Number(startRaw);
        let nextStart = '';
        if (endRaw !== '' && !isNaN(lastEnd)) nextStart = lastEnd + 1;
        else if (startRaw !== '' && !isNaN(lastStart)) nextStart = lastStart;
        else if (!prev) nextStart = 1;
        return {
            sheet_id: String(last.sheet_id || ''),
            meta_file_name: last.meta_file_name || '',
            meta_file_id: last.meta_file_id || '',
            range_type: last.range_type || 'page',
            start: nextStart,
            end: '',
            count: prev ? 10 : 10,
            lines_per_page: last.lines_per_page || DEFAULT_LINES_PER_PAGE,
            layout_profile_id: last.layout_profile_id || '',
            difficulty: '',
            include_nums: '',
            exclude_nums: ''
        };
    }

    function emptySection(defaults) {
        defaults = defaults || {};
        return {
            id: defaults.id || newSectionId(),
            material_folder: defaults.material_folder || '',
            material_root_kind: defaults.material_root_kind === 'class' ? 'class' : 'teacher',
            combination_id: defaults.combination_id || '',
            shuffle: defaults.shuffle !== false,
            allow_answer_appeal: defaults.allow_answer_appeal !== false,
            segments: (Array.isArray(defaults.segments) && defaults.segments.length)
                ? defaults.segments.map(function (g) { return Object.assign({}, g); })
                : [emptySegment()]
        };
    }

    function isNestedExamSection(s) {
        return !!(s && Array.isArray(s.segments));
    }

    function defaultSectionProps(defaults) {
        defaults = defaults || {};
        return {
            material_folder: defaults.material_folder || '',
            material_root_kind: defaults.material_root_kind === 'class' ? 'class' : 'teacher',
            combination_id: defaults.combination_id || '',
            shuffle: defaults.shuffle !== false,
            allow_answer_appeal: defaults.allow_answer_appeal !== false
        };
    }

    function normalizeExamSections(rawSections, defaults) {
        const props = defaultSectionProps(defaults);
        const list = Array.isArray(rawSections) ? rawSections : [];
        if (!list.length) return [emptySection(props)];
        if (list.some(isNestedExamSection)) {
            return list.map(function (s) {
                if (isNestedExamSection(s)) {
                    const segs = (s.segments && s.segments.length)
                        ? s.segments.map(function (g) { return Object.assign({}, g); })
                        : [emptySegment()];
                    return Object.assign({}, emptySection(props), s, { segments: segs });
                }
                return emptySection(Object.assign({}, props, { segments: [Object.assign({}, s)] }));
            });
        }
        return [emptySection(Object.assign({}, props, {
            segments: list.map(function (s) { return Object.assign({}, s); })
        }))];
    }

    function asLoadSection(secOrId) {
        if (secOrId && typeof secOrId === 'object') {
            return {
                sheet_id: String(secOrId.sheet_id || '').trim(),
                meta_file_name: String(secOrId.meta_file_name || '').trim(),
                combination_id: String(secOrId.combination_id || '').trim()
            };
        }
        return {
            sheet_id: String(secOrId || '').trim(),
            meta_file_name: '',
            combination_id: ''
        };
    }

    function flattenExamSegments(sections) {
        const out = [];
        (sections || []).forEach(function (sec, si) {
            (sec && sec.segments ? sec.segments : []).forEach(function (seg, gi) {
                out.push(Object.assign({}, seg, {
                    combination_id: seg.combination_id || sec.combination_id || '',
                    _section_id: sec.id || ('sec-' + si),
                    _section_index: si,
                    _segment_index: gi,
                    _section_folder: sec.material_folder || '',
                    _section_root_kind: sec.material_root_kind || 'teacher',
                    _section_shuffle: sec.shuffle !== false,
                    _section_appeal: sec.allow_answer_appeal !== false
                }));
            });
        });
        return out;
    }

    function groupFlatRowsIntoSections(flatRows, defaults) {
        const props = defaultSectionProps(defaults);
        const groups = [];
        const keyToIdx = {};
        (flatRows || []).forEach(function (row) {
            if (!row) return;
            const comboKey = String(row.combination_id || props.combination_id || '');
            const key = comboKey + '::' + String(row.sheet_id || row.meta_file_name || '') + '::' + String(row.layout_profile_id || '');
            if (keyToIdx[key] == null) {
                keyToIdx[key] = groups.length;
                groups.push(emptySection(Object.assign({}, props, {
                    combination_id: comboKey || props.combination_id,
                    material_folder: row.material_folder || props.material_folder,
                    material_root_kind: row.material_root_kind || props.material_root_kind,
                    segments: []
                })));
            }
            groups[keyToIdx[key]].segments.push(Object.assign({}, row));
        });
        if (!groups.length) return [emptySection(props)];
        groups.forEach(function (g) {
            if (!g.segments.length) g.segments.push(emptySegment());
        });
        return groups;
    }

    function sumSegmentCounts(segments) {
        let n = 0;
        (segments || []).forEach(function (s) {
            const c = Number(s && s.count);
            if (!isNaN(c)) n += c;
        });
        return n;
    }

    /** 複製／套用上次＝只繼承輸入。產出數字不准跟走。 */
    function stripExamInputOnlySections(sections) {
        return (Array.isArray(sections) ? sections : []).map(function (sec) {
            const next = Object.assign({}, sec);
            delete next.available_count;
            delete next.meta_missing_page;
            next.segments = (Array.isArray(sec && sec.segments) ? sec.segments : []).map(function (seg) {
                const row = Object.assign({}, seg);
                delete row.available_count;
                delete row.meta_missing_page;
                return row;
            });
            return next;
        });
    }

    /**
     * 📋「同一班級記住上次出題設定」（2026-08-11 老師要求）：老師出題很雜，每次都要重新設定
     * bank_id／layout_profile_id／各活頁區段。這裡把「上次成功產生線上卷」那次的設定記下來，
     * 之後在同一班開新的考試任務時，可以按「套用上次設定」一次帶入，而不是從零開始。
     *
     * 儲存位置：沿用老師 profiles.raw_data（不新增資料表，跟 material_layout_pairs／
     * teacher-prefs.js 同一個既有作法），鍵是 exam_last_config_by_class = { [classId]: {...} }。
     *
     * 💣 雷區：這是「老師主動按才套用」的建議，不是自動預設──這份對話裡已經因為「自動預設卻選錯」
     * 被罵過很多次（bank_id／layout_profile_id 都曾經因為偷偷預設第一項而搞錯）。絕對不要在渲染時
     * 靜默把這份上次設定塞進新任務，只能透過老師明確點擊的按鈕套用。
     */
    let _lastConfigCache = null;
    let _lastConfigLoadPromise = null;

    async function fetchLastConfigByClass(force) {
        if (_lastConfigCache && !force) return _lastConfigCache;
        if (_lastConfigLoadPromise && !force) return _lastConfigLoadPromise;
        _lastConfigLoadPromise = (async function () {
            if (!window.supabaseClient) { _lastConfigCache = _lastConfigCache || {}; return _lastConfigCache; }
            const { data: authData } = await window.supabaseClient.auth.getUser();
            const user = authData && authData.user;
            if (!user) { _lastConfigCache = {}; return _lastConfigCache; }
            const { data: profile, error } = await window.supabaseClient
                .from('profiles')
                .select('raw_data')
                .eq('id', user.id)
                .maybeSingle();
            if (error) {
                console.warn('[FeatureExamJob] 讀取上次出題設定失敗', error);
                _lastConfigCache = _lastConfigCache || {};
                return _lastConfigCache;
            }
            const raw = (profile && profile.raw_data) || {};
            _lastConfigCache = (raw.exam_last_config_by_class && typeof raw.exam_last_config_by_class === 'object')
                ? raw.exam_last_config_by_class : {};
            return _lastConfigCache;
        })().finally(function () { _lastConfigLoadPromise = null; });
        return _lastConfigLoadPromise;
    }

    /** 同步讀「目前已知」的上次設定（跟 getSuggestedLayoutIds 同精神：第一次呼叫順便觸發背景載入） */
    function getCachedLastConfigForClass(classId) {
        if (_lastConfigCache === null && !_lastConfigLoadPromise) fetchLastConfigByClass(false).catch(function () {});
        return (classId && _lastConfigCache) ? (_lastConfigCache[classId] || null) : null;
    }

    /** 產生線上卷成功後呼叫：把這次的教材＋layout＋出題設定記下來，供同班下次出題時套用 */
    async function saveLastConfigForClass(classId, config) {
        if (!classId || !window.supabaseClient) return;
        try {
            const { data: authData } = await window.supabaseClient.auth.getUser();
            const user = authData && authData.user;
            if (!user) return;
            const current = await fetchLastConfigByClass(false);
            const byClass = Object.assign({}, current);
            const stored = Object.assign({}, config, {
                sections: stripExamInputOnlySections(config && config.sections),
                updated_at: new Date().toISOString()
            });
            delete stored.job_id;
            delete stored.exam_job_id;
            delete stored.quiz_paper;
            delete stored.quiz_paper_no;
            byClass[classId] = stored;
            const { data: profile, error: readErr } = await window.supabaseClient
                .from('profiles')
                .select('raw_data')
                .eq('id', user.id)
                .maybeSingle();
            if (readErr) { console.warn('[FeatureExamJob] 記錄上次出題設定：讀取 profile 失敗', readErr); return; }
            const mergedRawData = Object.assign({}, (profile && profile.raw_data) || {}, { exam_last_config_by_class: byClass });
            const { error: updateErr } = await window.supabaseClient
                .from('profiles')
                .update({ raw_data: mergedRawData })
                .eq('id', user.id);
            if (updateErr) { console.warn('[FeatureExamJob] 記錄上次出題設定失敗', updateErr); return; }
            _lastConfigCache = byClass;
        } catch (err) {
            console.warn('[FeatureExamJob] saveLastConfigForClass 例外', err);
        }
    }

    /** 老師按「套用上次設定」：把記下來的 bank_id／layout_profile_id／sections 寫回目前任務並重繪 */
    function applyLastConfigForClass(pathStr) {
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return;
        const cfg = getCachedLastConfigForClass(bState.classId);
        if (!cfg) return window.showFlash('這個班級還沒有可套用的上次出題設定', 'warning');
        if (!task.raw_data) task.raw_data = {};
        if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
        const job = task.raw_data.exam_job;
        job.bank_id = cfg.bank_id || job.bank_id || '';
        job.layout_profile_id = cfg.layout_profile_id || job.layout_profile_id || '';
        if (Array.isArray(cfg.sections) && cfg.sections.length) {
            job.sections = stripExamInputOnlySections(normalizeExamSections(cfg.sections, {
                material_folder: cfg.material_folder || '',
                material_root_kind: cfg.root_kind || 'teacher'
            }));
        }
        job.options = Object.assign({}, job.options, cfg.options);
        if (window.AssignmentClone && typeof window.AssignmentClone.stripExamTaskOutputs === 'function') {
            window.AssignmentClone.stripExamTaskOutputs(task.raw_data);
        } else {
            delete job.job_id;
            delete task.raw_data.exam_job_id;
            delete task.raw_data.quiz_paper;
            delete task.raw_data.quiz_paper_no;
            delete task.raw_data.quiz_paper_signature;
            delete task.raw_data.last_generate_error;
            delete task.raw_data.meta_rows_by_stem;
        }
        setGenerateStatus(pathStr, '✅ 已套用本班上次出題設定（只帶範圍／範本，這是新卷、尚未產生）。請確認後按「產生試卷」。', 'success');
        refreshExamBuilder();
        setGenerateStatus(pathStr, '✅ 已套用本班上次出題設定（只帶範圍／範本，這是新卷、尚未產生）。請確認後按「產生試卷」。', 'success');
    }

    /**
     * 2026-08-14（範本庫合併）：考卷範本跟擷取範本現在是同一張表 material_templates
     * （見 feature-template-library.js），用 is_exam_role 角色勾選框篩選，不再是各自獨立的
     * material_exam_templates。這裡全部改成呼叫共用資料層，不自己直接查資料庫——避免這裡跟
     * feature-material-layout-pairing.js 各自維護一份取資料邏輯，之後改一邊漏一邊。
     * 試卷範本只讀範本庫。庫找不到就回 null，不准退回舊 LAYOUT_CATALOG。
     */
    async function fetchExamTemplates(force) {
        await window.FeatureTemplateLibrary.fetchTemplates(force);
        return window.FeatureTemplateLibrary.getExamTemplates();
    }

    /** 同步讀「目前已知」的考卷範本清單，第一次呼叫順便觸發背景載入（跟其他 CachedSync helper 同精神） */
    let _examTplRefreshPending = false;
    function getExamTemplatesCachedSync() {
        const list = window.FeatureTemplateLibrary.getExamTemplates();
        if (!list.length && !_examTplRefreshPending && window.FeatureTemplateLibrary
            && typeof window.FeatureTemplateLibrary.fetchTemplates === 'function') {
            _examTplRefreshPending = true;
            window.FeatureTemplateLibrary.fetchTemplates(false).then(function () {
                _examTplRefreshPending = false;
                if (window.FeatureTemplateLibrary.getExamTemplates().length) refreshExamBuilder();
            }).catch(function () { _examTplRefreshPending = false; });
        }
        return list;
    }

    /** 新增純考卷範本（不勾擷取角色）；若要讓既有擷取範本「加開」試卷角色，改用
     * FeatureTemplateLibrary.addRole(id,'exam')（見 feature-material-layout-pairing.js
     * 「✏️ 編輯」表單裡的「🧾 考卷範本」checkbox，2026-08-15 起搬進編輯表單，不再放在清單），
     * 不要走這裡新增一筆重複的資料。 */
    async function createExamTemplate(fields) {
        const payload = Object.assign({ is_extraction_role: false, is_exam_role: true }, fields || {});
        return window.FeatureTemplateLibrary.createTemplate(payload);
    }

    async function updateExamTemplate(id, fields) {
        return window.FeatureTemplateLibrary.updateTemplate(id, fields);
    }

    /** 角色感知刪除：若這筆範本也勾了擷取角色（雙用），只關掉試卷角色，不會波及擷取範本那一側資料 */
    async function deleteExamTemplate(id) {
        return window.FeatureTemplateLibrary.removeRole(id, 'exam');
    }

    /**
     * 統一考卷範本解析：只讀範本庫（uuid／legacy_profile_id／legacy_id／'tpl:{id}'）。
     * 庫找不到就回 null，不准退回舊內建 6 個 id。
     */
    function resolveExamTemplateProfile(pid) {
        const id = String(pid || '').trim();
        if (!id) return null;
        if (!window.FeatureTemplateLibrary || typeof window.FeatureTemplateLibrary.resolveTemplateProfile !== 'function') {
            return null;
        }
        return window.FeatureTemplateLibrary.resolveTemplateProfile(id) || null;
    }

    function findExamTemplateByAnyId(id) {
        const want = String(id || '').trim();
        if (!want) return null;
        const templates = getExamTemplatesCachedSync();
        return templates.find(function (t) {
            return t.id === want
                || (t.legacy_profile_id && t.legacy_profile_id === want)
                || (t.legacy_id && t.legacy_id === want);
        }) || null;
    }

    /**
     * 出題下拉：只列這個 meta 的官方認證試卷範本。
     * allowedIds 空＝這份 meta 沒有官方配對，不准列出整庫。
     */
    function buildExamTemplateSelectOptionsHtml(selectedId, allowedIds) {
        const allowed = [];
        const seen = {};
        (allowedIds || []).forEach(function (id) {
            const t = findExamTemplateByAnyId(id);
            const key = t ? t.id : String(id || '').trim();
            if (!key || seen[key]) return;
            seen[key] = true;
            allowed.push(t || { id: key, name: '' });
        });
        if (!allowed.length) {
            return '<option value="" disabled>此 meta 尚未官方搭配試卷範本，無法出卷</option>';
        }
        return allowed.map(function (t) {
            const isSelected = selectedId === t.id
                || (!!t.legacy_profile_id && selectedId === t.legacy_profile_id)
                || (!!t.legacy_id && selectedId === t.legacy_id);
            const label = t.name || '（找不到這筆試卷範本）';
            return '<option value="' + esc(t.id) + '"' + (isSelected ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
    }

    function officialPairingCacheReady() {
        const fcmc = window.FeatureClassMaterialCombinations;
        return !!(fcmc && typeof fcmc.isOfficialPairingCacheReady === 'function' && fcmc.isOfficialPairingCacheReady());
    }

    function officialExamTemplateIdsForCombo(combo) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (fcmc && typeof fcmc.listOfficialExamTemplateIdsForCombo === 'function') {
            return fcmc.listOfficialExamTemplateIdsForCombo(combo) || [];
        }
        if (combo && combo.examTemplateId) return [String(combo.examTemplateId)];
        return [];
    }

    function officialExamTemplateIdsForMeta(rootKind, classId, folderName, sheetHint) {
        return [];
    }

    function folderHasOfficialExamPairing(rootKind, classId, folderName) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.folderHasOfficialExamPairing !== 'function') return false;
        return !!fcmc.folderHasOfficialExamPairing(rootKind, classId, folderName);
    }

    function officialPairedMetaOptions(classId, rootKind, materialFolder) {
        if (!officialPairingCacheReady()) return [];
        const folder = String(materialFolder || '').trim();
        if (!folder) return [];
        const catalog = catalogMetaOptionsForFolder(classId, rootKind, folder);
        const fcmc = window.FeatureClassMaterialCombinations;
        const officialStems = (fcmc && typeof fcmc.listOfficialMetaStemsForFolder === 'function')
            ? (fcmc.listOfficialMetaStemsForFolder(rootKind, classId, folder) || [])
            : [];
        const byKey = {};
        function addOpt(opt) {
            if (!opt || !opt.fileName) return;
            const key = String(opt.fileName).replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
            if (!key) return;
            if (!byKey[key]) byKey[key] = opt;
            else if (opt.fileId && !byKey[key].fileId) byKey[key] = opt;
        }
        function fileKey(name) {
            return String(name || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
        }
        function asMetaJson(raw) {
            const s = String(raw || '').trim();
            if (/\.meta\.json$/i.test(s)) return s;
            if (/\.meta$/i.test(s)) return s.replace(/\.meta$/i, '.meta.json');
            return s + '.meta.json';
        }
        // 活頁下拉唯一來源：資料庫官方配對的產出 meta。Drive 清單只用來補 fileId／大小寫，不准發明檔名。
        officialStems.forEach(function (stem) {
            const raw = String(stem || '').trim();
            if (!raw) return;
            const fromCatalog = catalog.find(function (o) { return fileKey(o && o.fileName) === fileKey(raw); });
            addOpt(fromCatalog || {
                fileName: asMetaJson(raw),
                folderName: folder,
                rootKind: rootKind,
                fileId: '',
                label: raw
            });
        });
        return Object.keys(byKey).sort(function (a, b) {
            return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
        }).map(function (k) { return byKey[k]; });
    }

    function isComboId(raw) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(raw || '').trim());
    }

    function listAssignedCombos(classId) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.listAssignedCombosForClass !== 'function') return [];
        return fcmc.listAssignedCombosForClass(classId) || [];
    }

    function lookupAssignedCombo(classId, comboId) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.getAssignedComboById !== 'function') return null;
        return fcmc.getAssignedComboById(classId, comboId);
    }

    /** 本班套餐裡只有一份 meta 完全同名才認。對不到或兩份都叫這名＝沒有。 */
    function comboByExactPublishedMeta(classId, fileName) {
        const want = fullMetaStem(fileName).toUpperCase();
        if (!want) return null;
        const list = listAssignedCombos(classId);
        const hits = list.filter(function (c) {
            return (c.metaFiles || []).some(function (m) {
                return fullMetaStem(m).toUpperCase() === want;
            });
        });
        return hits.length === 1 ? hits[0] : null;
    }

    function resolveSectionCombo(classId, sec) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.findAssignedComboForSection !== 'function') return null;
        const firstSeg = (sec && Array.isArray(sec.segments) && sec.segments[0]) || {};
        return fcmc.findAssignedComboForSection(classId, {
            combinationId: sec && sec.combination_id,
            folderName: sec && sec.material_folder,
            examTemplateId: firstSeg.layout_profile_id
        });
    }

    /** 這份套餐自己的 meta（combo.metaFiles 已是這份的列）。不准再拿檔名有沒有範本當第二套過濾。 */
    function comboOwnMetaFiles(combo) {
        const names = Array.isArray(combo && combo.metaFiles) ? combo.metaFiles : [];
        return names.filter(function (n) { return !!String(n || '').trim(); });
    }

    function comboIsGrouped(combo) {
        if (combo && combo.isGroup === true) return true;
        const fcmc = window.FeatureClassMaterialCombinations;
        return !!(fcmc && typeof fcmc.comboIsGrouped === 'function' && fcmc.comboIsGrouped(combo));
    }

    function looksLikeAutoListedAllSheets(segments, own) {
        if (!own || own.length < 2 || !segments || segments.length !== own.length) return false;
        const ownU = {};
        own.forEach(function (n) { ownU[fullMetaStem(n).toUpperCase()] = true; });
        const seen = {};
        for (let i = 0; i < segments.length; i++) {
            const k = fullMetaStem(segments[i] && (segments[i].meta_file_name || segments[i].sheet_id)).toUpperCase();
            if (!k || !ownU[k] || seen[k]) return false;
            seen[k] = true;
        }
        return Object.keys(seen).length === own.length;
    }

    function matchOwnSheetForFile(combo, fileName) {
        const want = fullMetaStem(fileName).toUpperCase();
        if (!want) return null;
        const own = (combo && Array.isArray(combo.ownSheets)) ? combo.ownSheets : [];
        for (let i = 0; i < own.length; i++) {
            const s = own[i];
            if (!s) continue;
            const meta = String(s.meta || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
            const stem = String(s.stem || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
            if (meta === want || stem === want) return s;
        }
        return null;
    }

    /** 區塊格子：查這一本活頁列的活頁別稱。對不到才秀活頁名。不准寫「沒有別名」。 */
    function examBlockLabel(combo, fileName) {
        const sheet = matchOwnSheetForFile(combo, fileName);
        const stem = (sheet && sheet.stem)
            || displayStemFromMetaFile(fileName)
            || fullMetaStem(fileName);
        if (window.MaterialFileNames && typeof window.MaterialFileNames.currentAlias === 'function') {
            return window.MaterialFileNames.currentAlias(stem, sheet && sheet.id, combo && combo.extractionTemplateName);
        }
        return displayStemFromMetaFile(fileName) || stem;
    }

    function examBlockCellHtml(pathStr, idx, secIdx, segIdx, segment, combo) {
        const ownFile = String((segment && segment.meta_file_name) || '').trim()
            || asMetaFileName(segment && segment.sheet_id);
        const files = comboOwnMetaFiles(combo);
        if (comboIsGrouped(combo) && files.length) {
            const cur = fullMetaStem(ownFile).toUpperCase();
            let html = '<select id="exam-inline-sheet-' + pathStr + '-' + idx + '" class="form-control"'
                + ' onchange="window.FeatureExamJob._inlineOnSheetSelectChange(\'' + pathStr + '\', ' + secIdx + ', ' + segIdx + '); window.FeatureExamJob._inlineRefreshAvail(\'' + pathStr + '\')">'
                + '<option value="">— 選區塊 —</option>';
            files.forEach(function (file) {
                const fn = asMetaFileName(file);
                const label = examBlockLabel(combo, fn) || fn;
                const sel = fullMetaStem(fn).toUpperCase() === cur ? ' selected' : '';
                html += '<option value="' + esc(fn) + '"' + sel + '>' + esc(label) + '</option>';
            });
            html += '</select>';
            return html;
        }
        const blockName = examBlockLabel(combo, ownFile || (segment && segment.sheet_id) || '');
        return '<input type="hidden" id="exam-inline-sheet-' + pathStr + '-' + idx + '" value="'
            + esc(ownFile) + '">'
            + (blockName
                ? ('<div title="' + esc((segment && segment.meta_file_name) || blockName) + '">' + esc(blockName) + '</div>')
                : '<div style="color:#94A3B8;">選套餐後會自動列出區塊</div>');
    }

    function applyComboToSection(sec, combo) {
        if (!sec || !combo) return;
        sec.combination_id = combo.id;
        sec.material_folder = combo.folderName || '';
        sec.material_root_kind = combo.rootKind === 'class' ? 'class' : 'teacher';
        const metas = comboOwnMetaFiles(combo);
        (sec.segments || []).forEach(function (seg) {
            if (!seg) return;
            seg.material_folder = combo.folderName || '';
            let stemChanged = false;
            if (metas.length === 1) {
                const nextFile = asMetaFileName(metas[0]);
                const nextStem = fullMetaStem(nextFile);
                const prevStem = fullMetaStem(seg.meta_file_name || seg.sheet_id);
                stemChanged = prevStem.toUpperCase() !== nextStem.toUpperCase();
                seg.meta_file_name = nextFile;
                seg.sheet_id = nextStem;
                if (stemChanged) {
                    delete seg.available_count;
                    delete seg.meta_missing_page;
                }
            } else {
                const cur = fullMetaStem(seg.meta_file_name || seg.sheet_id);
                if (cur) {
                    const still = metas.some(function (m) {
                        return fullMetaStem(m).toUpperCase() === cur.toUpperCase();
                    });
                    if (!still) {
                        delete seg.meta_file_name;
                        delete seg.meta_file_id;
                        seg.sheet_id = '';
                        delete seg.available_count;
                        delete seg.meta_missing_page;
                        stemChanged = true;
                    }
                }
            }
            seg.combination_id = combo.id;
            const nextTpl = examTemplateIdForCombo(combo, stemChanged ? '' : seg.layout_profile_id);
            if (nextTpl) seg.layout_profile_id = nextTpl;
        });
    }

    /** 畫面／舊作業留下的區塊只准留這份套餐自己的檔。沒有＝一列空白，不准留隔壁套餐的列。 */
    function syncSectionSegmentsToOwnFiles(sec, combo) {
        if (!sec || !combo) return;
        const own = comboOwnMetaFiles(combo);
        if (!own.length) {
            sec.segments = [emptySegment()];
            return;
        }
        const ownU = {};
        own.forEach(function (n) {
            ownU[fullMetaStem(n).toUpperCase()] = true;
        });
        const grouped = comboIsGrouped(combo);
        const kept = (sec.segments || []).filter(function (seg) {
            const k = fullMetaStem(seg && (seg.meta_file_name || seg.sheet_id)).toUpperCase();
            if (!k) return grouped;
            return !!ownU[k];
        });
        if (grouped && looksLikeAutoListedAllSheets(kept, own)) {
            sec.segments = [seedGroupedEmptySegment(combo, own)];
            return;
        }
        if (kept.length) {
            sec.segments = kept;
            return;
        }
        if (grouped) {
            sec.segments = [seedGroupedEmptySegment(combo, own)];
            return;
        }
        expandExamSegmentsForCombo(sec, combo);
    }

    function seedGroupedEmptySegment(combo, metas) {
        const one = emptySegment();
        if (combo && combo.id) one.combination_id = combo.id;
        const files = metas || comboOwnMetaFiles(combo);
        if (files.length === 1) {
            one.meta_file_name = asMetaFileName(files[0]);
            one.sheet_id = fullMetaStem(files[0]);
        }
        const nextTpl = examTemplateIdForCombo(combo, '');
        if (nextTpl) one.layout_profile_id = nextTpl;
        return one;
    }

    /** 沒勾群組＝該套餐活頁自動列成區塊。勾了群組＝一列下拉，老師自己選這份套餐的哪一本。 */
    function expandExamSegmentsForCombo(sec, combo) {
        if (!sec || !combo) return;
        applyComboToSection(sec, combo);
        const metas = comboOwnMetaFiles(combo);
        const prev = Array.isArray(sec.segments) ? sec.segments : [];
        if (!metas.length) {
            sec.segments = [emptySegment()];
            return;
        }
        if (comboIsGrouped(combo)) {
            const ownU = {};
            metas.forEach(function (n) {
                ownU[fullMetaStem(n).toUpperCase()] = true;
            });
            const kept = prev.filter(function (seg) {
                const k = fullMetaStem(seg && (seg.meta_file_name || seg.sheet_id)).toUpperCase();
                if (!k) return true;
                return !!ownU[k];
            }).map(function (seg) {
                const next = Object.assign(emptySegment(), seg);
                next.combination_id = combo.id;
                const nextTpl = examTemplateIdForCombo(combo, next.layout_profile_id);
                if (nextTpl) next.layout_profile_id = nextTpl;
                return next;
            });
            if (looksLikeAutoListedAllSheets(kept, metas)) {
                sec.segments = [seedGroupedEmptySegment(combo, metas)];
                return;
            }
            sec.segments = kept.length ? kept : [seedGroupedEmptySegment(combo, metas)];
            return;
        }
        sec.segments = metas.map(function (file) {
            const stem = fullMetaStem(file);
            const hit = prev.find(function (seg) {
                return fullMetaStem(seg && (seg.meta_file_name || seg.sheet_id)).toUpperCase() === stem.toUpperCase();
            }) || emptySegment();
            const next = Object.assign(emptySegment(), hit);
            next.combination_id = combo.id;
            next.meta_file_name = asMetaFileName(file);
            next.sheet_id = stem;
            const nextTpl = examTemplateIdForCombo(combo, next.layout_profile_id);
            if (nextTpl) next.layout_profile_id = nextTpl;
            if (fullMetaStem(hit.meta_file_name || hit.sheet_id).toUpperCase() !== stem.toUpperCase()) {
                delete next.available_count;
                delete next.meta_missing_page;
            }
            return next;
        });
    }

    /**
     * 範圍層開包：一套餐一段落、一區塊一片段。畫面有幾列就寫幾列。
     * 對不到套餐物件仍保留該列（comboId／活頁／起迄），不准默默丟掉套餐二。
     */
    function applyRangePackToExam(examTask, pack) {
        pack = pack || {};
        if (!examTask) return [];
        if (!examTask.raw_data) examTask.raw_data = {};
        const job = ensureNestedExamJob(examTask);
        const prevSecs = normalizeExamSections(job.sections, {});
        const packRows = Array.isArray(pack.rows) && pack.rows.length
            ? pack.rows
            : [{ combo: pack.combo, comboId: pack.comboId, metaFile: pack.metaFile, rangeType: pack.rangeType, start: pack.start, end: pack.end }];
        const notes = Array.isArray(pack.notes) ? pack.notes.slice() : [];
        const groups = [];
        packRows.forEach(function (row, ri) {
            const rowCombo = (row && row.combo) || pack.combo || null;
            const comboId = String((rowCombo && rowCombo.id) || (row && row.comboId) || '').trim();
            const metaFile = String((row && row.metaFile) || '').trim();
            const start = row && row.start != null ? String(row.start).trim() : '';
            const end = row && row.end != null ? String(row.end).trim() : '';
            if (!comboId && !metaFile && !start) return;
            if (!start || !end) return;
            if (!comboId) notes.push('第 ' + (ri + 1) + ' 列沒有套餐');
            if (!metaFile) notes.push('第 ' + (ri + 1) + ' 列沒有活頁');
            const last = groups[groups.length - 1];
            if (!last || String(last.comboId || '') !== comboId) {
                groups.push({ combo: rowCombo, comboId: comboId, rows: [row] });
            } else {
                last.rows.push(row);
            }
        });
        const sections = groups.map(function (g, gi) {
            const prev = prevSecs.find(function (s) {
                return String((s && s.combination_id) || '') === String(g.comboId || '') && !!g.comboId;
            }) || emptySection({
                shuffle: (prevSecs[gi] && prevSecs[gi].shuffle) !== false,
                allow_answer_appeal: (prevSecs[gi] && prevSecs[gi].allow_answer_appeal) !== false
            });
            const sec = emptySection({
                shuffle: prev.shuffle !== false,
                allow_answer_appeal: prev.allow_answer_appeal !== false,
                combination_id: g.comboId || ''
            });
            if (g.combo) applyComboToSection(sec, g.combo);
            else sec.combination_id = g.comboId;
            sec.segments = g.rows.map(function (row) {
                const metaFile = String((row && row.metaFile) || '').trim();
                const startN = (row && row.start !== '' && row.start != null && !isNaN(Number(row.start)))
                    ? Number(row.start) : '';
                const endN = (row && row.end !== '' && row.end != null && !isNaN(Number(row.end)))
                    ? Number(row.end) : '';
                const prevSeg = (prev.segments || []).find(function (s) {
                    return fullMetaStem(s && (s.meta_file_name || s.sheet_id)) === fullMetaStem(metaFile)
                        && Number(s && s.start) === Number(startN)
                        && Number(s && s.end) === Number(endN);
                });
                const seg = emptySegment();
                seg.meta_file_name = metaFile;
                seg.sheet_id = String(metaFile).replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
                delete seg.available_count;
                delete seg.meta_missing_page;
                if (g.combo && g.combo.examTemplateId) seg.layout_profile_id = g.combo.examTemplateId;
                if (row.rangeType === 'qnum' || row.rangeType === 'page') {
                    seg.range_type = row.rangeType;
                }
                if (startN !== '') seg.start = startN;
                if (endN !== '') seg.end = endN;
                if (row.count !== '' && row.count != null && !isNaN(Number(row.count))) {
                    seg.count = Number(row.count);
                }
                if (row.lines_per_page !== '' && row.lines_per_page != null && Number(row.lines_per_page) > 0) {
                    seg.lines_per_page = Number(row.lines_per_page);
                }
                seg.difficulty = String(row.difficulty || '').trim();
                seg.include_nums = String(row.include_nums || row.includeNums || '').trim();
                seg.exclude_nums = String(row.exclude_nums || row.excludeNums || '').trim();
                return seg;
            });
            if (!sec.segments.length) sec.segments = [emptySegment()];
            return sec;
        });
        if (!sections.length) {
            notes.push('組合包沒有可帶入的套餐／區塊');
            sections.push(emptySection());
        }
        const folderNames = [];
        groups.forEach(function (g) {
            const fn = String((g.combo && g.combo.folderName) || '').trim();
            const key = fn.toUpperCase();
            if (fn && folderNames.indexOf(key) === -1) folderNames.push(key);
        });
        if (folderNames.length === 1 && groups[0] && groups[0].combo) {
            examTask.raw_data.exam_material = {
                material_folder: groups[0].combo.folderName || '',
                root_kind: groups[0].combo.rootKind === 'class' ? 'class' : 'teacher'
            };
        }
        job.sections = sections;
        examTask.raw_data.exam_job = job;
        clampExamJobRanges(examTask, { notify: false });
        return notes;
    }

    function examHasOwnCombo(sections) {
        return (sections || []).some(function (sec) {
            return !!String((sec && sec.combination_id) || '').trim();
        });
    }

    function isExamUnderComboPack(pathStr, task) {
        if (task && task.raw_data && task.raw_data.exam_force_standalone) return false;
        const FT = window.FeatureTimeline;
        return !!(FT && typeof FT.parentRangeGroupPathOf === 'function' && FT.parentRangeGroupPathOf(pathStr));
    }

    /**
     * 組合層是範圍＋選題的唯一來源。考試只讀這份。獨立考試＝不動。
     */
    function syncExamFromParentPack(pathStr, task) {
        if (!task || !isExamUnderComboPack(pathStr, task)) return false;
        const FT = window.FeatureTimeline;
        if (!FT || typeof FT.buildRangePackForApply !== 'function') return false;
        const parentPath = FT.parentRangeGroupPathOf(pathStr);
        if (!parentPath) return false;
        const pack = FT.buildRangePackForApply(parentPath, { clamp: false, notify: false, useState: true });
        applyRangePackToExam(task, pack);
        return true;
    }

    function inheritRangePackIntoExamIfEmpty(pathStr, task) {
        return syncExamFromParentPack(pathStr, task);
    }

    function metaOptionsForCombo(classId, combo) {
        if (!combo) return [];
        const folder = String(combo.folderName || '').trim();
        const kind = combo.rootKind === 'class' ? 'class' : 'teacher';
        const catalog = catalogMetaOptionsForFolder(classId, kind, folder);
        const names = comboOwnMetaFiles(combo);
        function fileKey(name) {
            return String(name || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
        }
        return names.map(function (name) {
            const raw = String(name || '').trim();
            if (!raw) return null;
            const hit = catalog.find(function (o) { return fileKey(o && o.fileName) === fileKey(raw); });
            return hit || {
                fileName: /\.meta\.json$/i.test(raw) ? raw : (raw + '.meta.json'),
                folderName: folder,
                rootKind: kind,
                fileId: '',
                label: raw
            };
        }).filter(Boolean).sort(function (a, b) {
            const la = String((a && a.fileName) || '').replace(/\.meta\.json$/i, '');
            const lb = String((b && b.fileName) || '').replace(/\.meta\.json$/i, '');
            return la.localeCompare(lb, 'en', { numeric: true, sensitivity: 'base' });
        });
    }

    function buildExamComboOptionsHtml(classId, section) {
        const list = officialPairingCacheReady() ? listAssignedCombos(classId) : [];
        const currentId = String((section && section.combination_id) || '').trim();
        let matched = !currentId;
        let html = '<option value="">— 請選擇套餐 —</option>';
        if (!officialPairingCacheReady()) {
            if (currentId) {
                html += '<option value="' + esc(currentId) + '" selected>' + esc((section && section.material_folder) || '目前套餐') + '</option>';
            }
            html += '<option value="" disabled>⏳ 載入套餐…</option>';
            return html;
        }
        list.forEach(function (c) {
            if (!c || !c.id) return;
            const selected = String(c.id) === currentId;
            if (selected) matched = true;
            html += '<option value="' + esc(c.id) + '"' + (selected ? ' selected' : '') + '>' + esc(c.label) + '</option>';
        });
        if (!matched && currentId) {
            const orphan = (section && section.material_folder) ? String(section.material_folder) : currentId;
            html += '<option value="' + esc(currentId) + '" selected>' + esc(orphan) + '</option>';
        }
        if (!list.length) {
            html += '<option value="" disabled>（這個班還沒有已指派且搭配試卷範本的套餐）</option>';
        }
        return html;
    }

    function officialExamTemplateDefaultId(combo) {
        const ids = officialExamTemplateIdsForCombo(combo);
        return ids[0] || '';
    }

    /**
     * 這份套餐自己的官方試卷範本。公式／col_map 只屬於那一筆。
     * 不准再用資料夾＋活頁 hint 去對同夾另一套餐（PIC／WORD）。
     */
    function examTemplateIdForCombo(combo, currentId) {
        const officialIds = officialExamTemplateIdsForCombo(combo);
        if (!officialIds.length) return '';
        if (isIdInOfficialList(currentId, officialIds)) return currentId;
        return officialIds[0] || '';
    }

    function examTemplateIdForMeta(rootKind, classId, folderName, sheetHint, currentId, comboPreferredId) {
        return '';
    }

    function isIdInOfficialList(pid, officialIds) {
        const want = String(pid || '').trim();
        if (!want || !officialIds || !officialIds.length) return false;
        if (officialIds.indexOf(want) !== -1) return true;
        const t = findExamTemplateByAnyId(want);
        return !!(t && officialIds.indexOf(t.id) !== -1);
    }

    function layoutFieldHint(layoutId) {
        const profile = resolveExamTemplateProfile(layoutId);
        if (profile) return profile.fields + (profile.fields_answer ? ('｜答案：' + profile.fields_answer) : '');
        if (String(layoutId || '').indexOf('tpl:') === 0) return '（擷取範本已被刪除，請重選 layout_profile_id）';
        return layoutId ? '（找不到這個試卷範本，可能已被刪除）' : '（依 layout_profile）';
    }

    function metaStemFromFileName(fileName) {
        const name = String(fileName || '').trim();
        const m = name.match(/^(.+?)\.meta\.json$/i);
        if (m) return m[1];
        return name.replace(/\.[^.]+$/, '') || '';
    }

    /** 完整 stem（含擷取範本後綴）。比對／可用題只用這個，不准縮成活頁短名去套另一本。 */
    function fullMetaStem(fileName) {
        return String(fileName || '').trim().replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
    }

    function asMetaFileName(fileName) {
        const raw = String(fileName || '').trim();
        if (!raw) return '';
        return /\.meta\.json$/i.test(raw) ? raw : (fullMetaStem(raw) + '.meta.json');
    }

    /** 畫面短名：去掉 .meta.json 與範本後綴（A.vocab-word → A）。資料鍵不准用這個。 */
    function displayStemFromMetaFile(fileName) {
        const stem = metaStemFromFileName(fileName);
        const m = String(stem || '').match(/^(.+)\.([A-Za-z][A-Za-z0-9_+-]*)$/);
        return m ? m[1] : stem;
    }

    /** 去掉誤黏在範圍前的活頁字母（例：A pp. 1~2 → pp. 1~2） */
    function stripSheetPrefixFromRangeSpec(rangeSpec, sheet) {
        let text = String(rangeSpec || '').trim();
        if (!text || !sheet) return text;
        const re = new RegExp('^' + String(sheet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]?\\s*', 'i');
        return text.replace(re, '').trim();
    }

    /**
     * 用 MaterialSnapshot.parseRangeSpec 解析（支援 pp. 1~2, 5 與 #11~16, 26）。
     * @returns {{ range_type, start, end, pages?, items? }|null}
     */
    function parseSectionRangeFromSpec(rangeSpec, sheetHint) {
        const sheet = String(sheetHint || '').trim().toUpperCase();
        let raw = stripSheetPrefixFromRangeSpec(rangeSpec, sheet);
        if (!raw) return null;

        if (window.MaterialSnapshot && typeof window.MaterialSnapshot.parseRangeSpec === 'function') {
            try {
                const spec = window.MaterialSnapshot.parseRangeSpec(raw);
                if (spec.kind === 'all') {
                    return { range_type: 'page', start: 1, end: 9999, pages: null, items: null, all: true };
                }
                if (spec.kind === 'item') {
                    const items = spec.items || [];
                    if (!items.length) return null;
                    return {
                        range_type: 'qnum',
                        start: items[0],
                        end: items[items.length - 1],
                        pages: null,
                        items: items.slice()
                    };
                }
                const pages = spec.pages || [];
                if (!pages.length) return null;
                return {
                    range_type: 'page',
                    start: pages[0],
                    end: pages[pages.length - 1],
                    pages: pages.slice(),
                    items: null
                };
            } catch (_e) { /* fall through */ }
        }

        // 後備：僅連續起迄
        let m = raw.match(/^pp?\.?\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/i);
        if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Number(m[2]) : start;
            if (isNaN(start) || isNaN(end)) return null;
            const lo = Math.min(start, end);
            const hi = Math.max(start, end);
            const pages = [];
            for (let p = lo; p <= hi; p++) pages.push(p);
            return { range_type: 'page', start: lo, end: hi, pages: pages, items: null };
        }
        m = raw.match(/^#\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/);
        if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Number(m[2]) : start;
            if (isNaN(start) || isNaN(end)) return null;
            const lo = Math.min(start, end);
            const hi = Math.max(start, end);
            const items = [];
            for (let n = lo; n <= hi; n++) items.push(n);
            return { range_type: 'qnum', start: lo, end: hi, pages: null, items: items };
        }
        return null;
    }

    /**
     * 從錄音 material_refs 列（A.meta.json + pp. 1~2）→ exam sections
     * 圖二 meta 列的活頁字母在檔名／label，範圍在 range_spec（常不含字母）
     */
    function sheetLetterFromRangeSpec(rangeSpec) {
        const m = String(rangeSpec || '').match(/^\s*([A-Za-z][A-Za-z0-9._-]{0,60})\s+pp?\.?/i);
        if (!m) return '';
        const sheet = m[1];
        if (isPagePrefixMisreadAsSheet(sheet)) return '';
        return sheet;
    }

    function sectionsFromMaterialRefs(refs, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        if (!Array.isArray(refs) || !refs.length) return [];
        const sections = [];
        const seen = {};
        refs.forEach(function (r) {
            if (!r) return;
            let published = String(r.published_file || r.metaFile || '').trim();
            const label = String(r.label || r.stem || '').trim();
            const rangeSheet = sheetLetterFromRangeSpec(r.range_spec || r.range || '');
            let sheet = published ? fullMetaStem(published) : '';
            if (!sheet && rangeSheet && !/^[A-Za-z0-9]{1,4}$/i.test(rangeSheet)) {
                sheet = fullMetaStem(rangeSheet);
            } else if (!sheet && label && !/^[A-Za-z0-9]{1,4}$/i.test(label)) {
                sheet = fullMetaStem(label);
            } else if (!sheet && rangeSheet) {
                sheet = rangeSheet.toUpperCase();
            } else if (!sheet && label) {
                sheet = label.toUpperCase();
            }
            const parsed = parseSectionRangeFromSpec(r.range_spec || r.range || '', sheet);
            if (!sheet || !parsed) return;
            const key = sheet + ':' + parsed.range_type + ':' + parsed.start + ':' + parsed.end
                + ':' + (parsed.pages ? parsed.pages.join(',') : '')
                + ':' + (parsed.items ? parsed.items.join(',') : '');
            if (seen[key]) return;
            seen[key] = true;
            const span = parsed.range_type === 'page'
                ? (parsed.pages && parsed.pages.length ? parsed.pages.length : Math.max(1, parsed.end - parsed.start + 1))
                : (parsed.items && parsed.items.length ? parsed.items.length : Math.max(1, parsed.end - parsed.start + 1));
            sections.push({
                combination_id: String(r.combo_id || r.combination_id || '').trim(),
                material_folder: String(r.material_folder || '').trim(),
                material_root_kind: r.materials_root_kind === 'class' ? 'class' : 'teacher',
                sheet_id: sheet,
                meta_file_name: published || '',
                meta_file_id: r.fileId || r.file_id || '',
                range_type: parsed.range_type,
                start: parsed.start,
                end: parsed.end,
                pages: parsed.pages || null,
                items: parsed.items || null,
                count: parsed.range_type === 'page' ? span * lpp : span,
                lines_per_page: lpp,
                difficulty: '',
                include_nums: '',
                exclude_nums: '',
                range_spec: String(r.range_spec || r.range || '').trim()
            });
        });
        return sections;
    }

    /** 從單一錄音任務組出 sections（優先 material_refs） */
    function sectionsFromAudioTask(audioTask, linesPerPage) {
        if (!audioTask) return [];
        const raw = audioTask.raw_data || {};
        let refs = Array.isArray(raw.material_refs) && raw.material_refs.length
            ? raw.material_refs
            : (raw.material_ref && (raw.material_ref.published_file || raw.material_ref.range_spec)
                ? [raw.material_ref] : []);
        let sections = rejectBogusPagePrefixSections(sectionsFromMaterialRefs(refs, linesPerPage));
        if (sections.length) return sections;

        let rangeText = String(raw.material_range || '').trim();
        if (!rangeText && window.FeatureTimeline && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
            rangeText = window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '';
        }
        if (!rangeText) rangeText = stripHtml(audioTask.title || '');
        sections = rejectBogusPagePrefixSections(parseMaterialRangeToSections(rangeText, linesPerPage));
        if (sections.length) return sections;

        if (Array.isArray(raw.grading_units) && raw.grading_units.length) {
            return rejectBogusPagePrefixSections(sectionsFromGradingUnits(raw.grading_units, linesPerPage));
        }
        return [];
    }

    /** 找與考試任務「同層」的錄音任務（只看同一個 subTasks 陣列，不跨區塊） */
    function findPreferredAudioTask(tasksRoot, examPathStr) {
        const hit = findPreferredAudioHit(tasksRoot, examPathStr);
        return hit ? hit.task : null;
    }

    /**
     * 💣 雷區（2026-08-14 老師回報「獨立的小考，怎麼一直有問題，為什麼只能選 layout，
     * 不用選 meta」）：這裡原本「同層找不到才 walkTasks 整棵樹（全部作業區塊）找第一個
     * audio_record」——這完全違反 exam-standalone-material-invariant.mdc 明訂的
     * 「同層有 audio_record 才維持 combo，同層沒有才顯示教材來源下拉」。一個作業裡通常
     * 有好幾個單元（各自一組錄音＋考試），這個考試任務只要「同層」沒有錄音任務（老師故意
     * 只放一個獨立小考，不放錄音），就會被這個 walkTasks 誤抓到「整份作業裡任何一個、
     * 完全不相關單元」的錄音任務，被系統偷偷當成 combo 配對——於是 isStandaloneExam
     * 變成 false，「🗂 教材來源」＋「教材資料夾」下拉整個不顯示，老師想選 meta（活頁）
     * 卻連選項都看不到，只能看到 layout。改成同層真的沒有就直接回 null，不要跨區塊亂配對。
     */
    function findPreferredAudioHit(tasksRoot, examPathStr) {
        const hits = findAllSiblingAudioHits(tasksRoot, examPathStr);
        return hits.length ? hits[0] : null;
    }

    /**
     * 同層「所有」錄音任務（不是只回第一個）：一個作業裡如果同層放了不只一個單元的錄音
     * （老師回報「有兩個呢？」），「從同作業錄音範圍帶入」需要知道有幾個才能輪流套用，
     * 不能只偷偷抓第一個交差。
     */
    function findAllSiblingAudioHits(tasksRoot, examPathStr) {
        const arr = String(examPathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let siblingList = tasksRoot;
        let siblingBasePath = [];
        if (arr.length >= 2) {
            let list = tasksRoot;
            const base = [];
            for (let i = 0; i < arr.length - 1; i++) {
                const node = list[arr[i]];
                if (!node) { list = null; break; }
                base.push(arr[i]);
                list = node.subTasks || [];
            }
            if (list) {
                siblingList = list;
                siblingBasePath = base;
            }
        }
        const hits = [];
        for (let i = 0; i < (siblingList || []).length; i++) {
            const t = siblingList[i];
            if (t && t.type === 'audio_record') {
                hits.push({ task: t, pathStr: siblingBasePath.concat([i]).join('-') });
            }
        }
        return hits;
    }

    /** 從錄音節點 DOM 讀 meta 列（比 raw_data 新：加第 3 筆後尚未 Snapshot 也能帶入） */
    function readDomMaterialRefs(audioPathStr, rootKind) {
        const container = document.getElementById('node-material-rows-' + audioPathStr);
        if (!container) return [];
        const refs = [];
        container.querySelectorAll('.material-meta-row').forEach(function (row) {
            const fileEl = row.querySelector('.material-meta-file');
            const rangeEl = row.querySelector('.material-meta-range');
            const val = fileEl ? String(fileEl.value || '').trim() : '';
            if (!val || val.indexOf('::') === -1) return;
            const parts = val.split('::');
            const folder = String(parts[0] || '').trim();
            const fileName = String(parts.slice(1).join('::') || '').trim();
            if (!fileName) return;
            const stem = metaStemFromFileName(fileName);
            refs.push({
                material_folder: folder,
                published_file: fileName,
                range_spec: rangeEl ? String(rangeEl.value || '').trim() : '',
                label: stem,
                stem: stem,
                materials_root_kind: rootKind || (window.TeacherPrefs && window.TeacherPrefs.getCachedSync().default_materials_root_kind === 'class' ? 'class' : 'teacher'),
                schema_id: 'gept-2_sentence'
            });
        });
        return refs;
    }

    function refreshExamBuilder() {
        if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder({ skipSync: true });
        }
    }

    function sectionsLookEmpty(sections) {
        if (!Array.isArray(sections) || !sections.length) return true;
        if (sections.length === 1) {
            const s = sections[0] || {};
            if (!String(s.sheet_id || '').trim()) return true;
        }
        return false;
    }

    /**
     * 可用題優先吃活頁 available_count＋每頁行數＋起迄（最後一頁餘數）。
     * 沒有總題數才退回考試任務 meta 列。禁止用錄音 Snapshot／複習目錄。
     */

    function buildPageSetForSection(section) {
        if (Array.isArray(section.pages) && section.pages.length) {
            const set = {};
            section.pages.forEach(function (p) {
                const n = Number(p);
                if (!isNaN(n)) set[n] = true;
            });
            return set;
        }
        // 若帶原始 range_spec，用完整解析（含不連續頁）
        if (section.range_spec && window.MaterialSnapshot
            && typeof window.MaterialSnapshot.parseRangeSpec === 'function') {
            try {
                const raw = stripSheetPrefixFromRangeSpec(section.range_spec, section.sheet_id);
                const spec = window.MaterialSnapshot.parseRangeSpec(raw);
                if (spec.kind === 'page' && spec.pages && spec.pages.length) {
                    const set = {};
                    spec.pages.forEach(function (p) { set[Number(p)] = true; });
                    return set;
                }
            } catch (_e) {}
        }
        const start = Number(section.start);
        const end = Number(section.end);
        if (isNaN(start) || isNaN(end)) return null;
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        const set = {};
        for (let p = lo; p <= hi; p++) set[p] = true;
        return set;
    }

    function buildItemSetForSection(section) {
        if (Array.isArray(section.items) && section.items.length) {
            const set = {};
            section.items.forEach(function (n) {
                const v = Number(n);
                if (!isNaN(v)) set[v] = true;
            });
            return set;
        }
        if (section.range_spec && window.MaterialSnapshot
            && typeof window.MaterialSnapshot.parseRangeSpec === 'function') {
            try {
                const raw = stripSheetPrefixFromRangeSpec(section.range_spec, section.sheet_id);
                const spec = window.MaterialSnapshot.parseRangeSpec(raw);
                if (spec.kind === 'item' && spec.items && spec.items.length) {
                    const set = {};
                    spec.items.forEach(function (n) { set[Number(n)] = true; });
                    return set;
                }
            } catch (_e) {}
        }
        const start = Number(section.start);
        const end = Number(section.end);
        if (isNaN(start) || isNaN(end)) return null;
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        const set = {};
        for (let n = lo; n <= hi; n++) set[n] = true;
        return set;
    }

    function parseNumListLocal(raw) {
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.parseNumList === 'function') {
            return window.QuizPaperBuilder.parseNumList(raw);
        }
        // Fallback（QuizPaperBuilder 未載入時）：與其 parseNumList 同邏輯，支援半形 "-" 範圍
        const text = String(raw || '').trim();
        if (!text) return null;
        const normalized = text.replace(/[～〜－—–]/g, '~').replace(/(\d)\s*-\s*(\d)/g, '$1~$2');
        const set = {};
        normalized.split(/[,，、\s]+/).forEach(function (part) {
            const p = String(part || '').trim();
            if (!p) return;
            const m = p.match(/^(\d+)\s*~\s*(\d+)$/);
            if (m) {
                let a = Number(m[1]);
                let b = Number(m[2]);
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) set[i] = true;
                return;
            }
            const n = Number(p);
            if (!isNaN(n)) set[n] = true;
        });
        return set;
    }

    /**
     * 「可用題」＝範圍（start～end／pages／items）內、扣除 exclude_nums 後的 meta 筆數。
     * 💣 雷區：include_nums（必考#）不可再拿來篩選／縮小這個數字──它的語意是
     * 「這幾題保證出現」，範圍外的題號本來就抽不到；用它篩可用題會讓老師誤以為
     * 「範圍內沒題」（曾發生：範圍與必考題號對不齊時可用題直接掉成 0）。
     * 與 020_js_core/quiz-paper-builder.js 的 filterRowsForSection 同語意，
     * 見 .cursor/rules/exam-available-count-invariant.mdc。
     */
    function countAvailableFromMetaRows(section, rows) {
        if (!section || !Array.isArray(rows) || !rows.length) return null;
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.filterRowsForSection === 'function') {
            return window.QuizPaperBuilder.filterRowsForSection(rows, section).length;
        }
        const rtype = section.range_type || 'page';
        const excludeSet = parseNumListLocal(section.exclude_nums);
        const pageKey = resolveMetaPageKey(rows);

        let pageSet = null;
        let itemSet = null;
        if (rtype === 'qnum') itemSet = buildItemSetForSection(section);
        else if (rtype === 'page') pageSet = buildPageSetForSection(section);

        let sum = 0;
        rows.forEach(function (row) {
            if (!row) return;
            const itemNo = toMetaNum(row.item_no != null ? row.item_no : row.itemNo);
            const pages = rowPageNums(row, pageKey);
            if (excludeSet && !isNaN(itemNo) && excludeSet[itemNo]) return;
            if (rtype === 'qnum') {
                if (!itemSet || isNaN(itemNo) || !itemSet[itemNo]) return;
                sum += 1;
                return;
            }
            if (rtype === 'page') {
                if (!pageSet || !pages.some(function (p) { return pageSet[p]; })) return;
                sum += 1;
                return;
            }
            sum += 1;
        });
        return sum;
    }

    /**
     * 檢查 include_nums（必考#）裡的題號，是否都能在該區段的 meta 筆數／範圍內找到。
     * 找不到 → 回傳缺的題號陣列（UI 用來標紅提示，避免老師以為必考已生效）。
     */
    function missingIncludeNums(section, rows) {
        const includeSet = parseNumListLocal(section && section.include_nums);
        if (!includeSet) return [];
        const wantNos = Object.keys(includeSet).map(Number);
        if (!wantNos.length) return [];
        if (!Array.isArray(rows) || !rows.length) return wantNos;
        const rtype = (section.range_type || 'page');
        const pageKey = resolveMetaPageKey(rows);
        let pageSet = null;
        let itemSet = null;
        if (rtype === 'qnum') itemSet = buildItemSetForSection(section);
        else if (rtype === 'page') pageSet = buildPageSetForSection(section);
        const found = {};
        rows.forEach(function (row) {
            if (!row) return;
            const itemNo = Number(row.item_no != null ? row.item_no : row.itemNo);
            const pages = rowPageNums(row, pageKey);
            if (isNaN(itemNo) || !includeSet[itemNo]) return;
            if (rtype === 'qnum' && (!itemSet || !itemSet[itemNo])) return;
            if (rtype === 'page' && (!pageSet || !pages.some(function (p) { return pageSet[p]; }))) return;
            found[itemNo] = true;
        });
        return wantNos.filter(function (n) { return !found[n]; });
    }

    /**
     * 可用題：只讀考試任務自己的 raw_data.meta_rows_by_stem（來自「讀取可用題數」讀進的 .meta.json）。
     * 不要傳錄音任務、不要看 grading_units。
     */
    function pageNumsFromCell(val) {
        const MS = window.MaterialSnapshot;
        if (MS && typeof MS.pageNumsFromCell === 'function') return MS.pageNumsFromCell(val);
        if (val == null || val === '') return [];
        const n = toMetaNum(val);
        return isNaN(n) ? [] : [n];
    }

    function rowPageNum(row, pageKey) {
        const MS = window.MaterialSnapshot;
        if (MS && typeof MS.rowPageNum === 'function') return MS.rowPageNum(row, pageKey);
        if (!row) return NaN;
        if (pageKey && row[pageKey] != null && row[pageKey] !== '') {
            const n = toMetaNum(row[pageKey]);
            if (!isNaN(n)) return n;
        }
        const preferred = ['page', 'Page', 'pg', '頁碼', 'page_no', 'E'];
        for (let i = 0; i < preferred.length; i++) {
            if (row[preferred[i]] == null || row[preferred[i]] === '') continue;
            const n = toMetaNum(row[preferred[i]]);
            if (!isNaN(n)) return n;
        }
        return NaN;
    }

    function rowPageNums(row, pageKey) {
        if (!row) return [];
        if (pageKey && row[pageKey] != null && row[pageKey] !== '') {
            const nums = pageNumsFromCell(row[pageKey]);
            if (nums.length) return nums;
        }
        const n = rowPageNum(row, pageKey);
        return isNaN(n) ? [] : [n];
    }

    /** 找出 meta 列真正記課本頁的欄（不一定叫 page）。不要把 item_no 1～20 誤當成頁碼。 */
    function resolveMetaPageKey(rows) {
        const MS = window.MaterialSnapshot;
        if (MS && typeof MS.resolveMetaPageKey === 'function') return MS.resolveMetaPageKey(rows);
        const list = rows || [];
        const first = list.find(Boolean);
        if (!first) return '';
        const named = Object.keys(first).filter(function (k) {
            return k && k.charAt(0) !== '_' && (/^(page|Page|pg|頁碼|page_no|E)$/.test(k) || /page|頁碼/.test(k));
        });
        for (let i = 0; i < named.length; i++) {
            if (pageNumsFromCell(first[named[i]]).length) return named[i];
        }
        return '';
    }

    function describeMetaRowKeys(rows) {
        const MS = window.MaterialSnapshot;
        if (MS && typeof MS.describeMetaRowKeys === 'function') return MS.describeMetaRowKeys(rows);
        const row = (rows || []).find(Boolean);
        if (!row) return '';
        return Object.keys(row).filter(function (k) { return k && k.charAt(0) !== '_'; }).join(', ');
    }

    function canonicalizeFetchedRows(rows, layout) {
        const MS = window.MaterialSnapshot;
        if (MS && typeof MS.canonicalizeMetaRows === 'function') {
            return MS.canonicalizeMetaRows(rows, layout);
        }
        return rows || [];
    }

    function lookupSectionMetaRows(byStem, section) {
        if (!section) return null;
        return lookupRowsBySheetId(byStem, section.meta_file_name)
            || lookupRowsBySheetId(byStem, section.sheet_id)
            || lookupRowsBySheetId(byStem, fullMetaStem(section.meta_file_name || section.sheet_id || ''));
    }

    function rememberMetaRows(byStem, section, rows) {
        if (!byStem || !Array.isArray(rows) || !rows.length) return;
        // 💣 之前這裡把同一份 rows 陣列同時存進 4 個 key 別名（sheet_id／meta_file_name／
        // displayStem／metaStem），原意是「不管之後用哪種格式查都找得到」。這 4 個字串在記憶體裡
        // 通常會是同一個 stem 的不同寫法，但如果檔名帶了額外的範本後綴（例如 "AvaLiu-vBK-2.vocab-
        // word.meta.json"），這 4 種寫法會彼此不同，存成資料庫 JSON 時每個 key 底下都會把整份陣列
        // 內容完整複製一份——實測有一筆作業因此被炸到 4.6MB（同一份 5045 列 meta 存了 3 份）。
        // lookupRowsBySheetId 讀取端本身已經有完整的模糊比對（大小寫、去 .meta.json、去連字號比對
        // stemCore），只存 1 個 key 一樣找得到，不需要也不該重複存多份。
        const candidates = [
            fullMetaStem((section && (section.meta_file_name || section.sheet_id)) || ''),
            section && section.meta_file_name,
            section && section.sheet_id
        ].map(function (k) { return String(k || '').trim(); }).filter(Boolean);
        const key = candidates[0];
        if (key) byStem[key] = rows;
    }

    function summarizeMetaPages(rows) {
        const MS = window.MaterialSnapshot;
        if (MS && typeof MS.summarizeMetaPages === 'function') return MS.summarizeMetaPages(rows);
        const pageKey = resolveMetaPageKey(rows);
        const pages = [];
        (rows || []).forEach(function (row) {
            rowPageNums(row, pageKey).forEach(function (p) {
                if (!isNaN(p) && pages.indexOf(p) === -1) pages.push(p);
            });
        });
        pages.sort(function (a, b) { return a - b; });
        if (!pages.length) return '';
        return pages[0] + '～' + pages[pages.length - 1] + '（' + pages.length + ' 頁）';
    }

    function metaCannotFilterByPage(section, rows) {
        if ((section && section.range_type && section.range_type !== 'page')) return false;
        if (!Array.isArray(rows) || !rows.length) return false;
        return !resolveMetaPageKey(rows);
    }

    function countAvailableFromPageCounts(section, pageCounts) {
        if (!section || !pageCounts || typeof pageCounts !== 'object') return null;
        const keys = Object.keys(pageCounts);
        if (!keys.length) return null;
        if ((section.range_type || 'page') !== 'page') return null;
        const pageSet = buildPageSetForSection(section);
        if (!pageSet) return null;
        let sum = 0;
        let hits = 0;
        Object.keys(pageSet).forEach(function (p) {
            const n = pageCounts[p] != null ? pageCounts[p] : pageCounts[String(p)];
            if (n != null && !isNaN(Number(n))) {
                hits += 1;
                sum += Number(n);
            }
        });
        if (!hits) return null;
        return sum;
    }

    function rangeCoversFullSheet(section, stats) {
        if (!section || !stats) return false;
        if ((section.range_type || 'page') !== 'page') return false;
        if (stats.pageMin == null || stats.pageMax == null || isNaN(stats.pageMin) || isNaN(stats.pageMax)) return false;
        const lo = Math.min(Number(section.start) || 0, Number(section.end) || 0);
        const hi = Math.max(Number(section.start) || 0, Number(section.end) || 0);
        return lo <= stats.pageMin && hi >= stats.pageMax;
    }

    function lookupComboSheetStats(section, examTask, folderHint) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.lookupSheetStats !== 'function') return null;
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        let folder = String(folderHint || '').trim()
            || (section && section.material_folder)
            || (examTask && examTask.raw_data && examTask.raw_data.exam_material
                && examTask.raw_data.exam_material.material_folder)
            || '';
        if (!folder && section && section.combination_id && typeof fcmc.getAssignedComboById === 'function') {
            const combo = fcmc.getAssignedComboById(classId, section.combination_id);
            if (combo) folder = combo.folderName || '';
        }
        const hint = fullMetaStem((section && (section.meta_file_name || section.sheet_id)) || '');
        return fcmc.lookupSheetStats(classId, folder, hint, section && section.combination_id);
    }

    function pageCountsFromMetaRows(rows) {
        if (!Array.isArray(rows) || !rows.length) return {};
        const pageKey = resolveMetaPageKey(rows);
        const out = {};
        rows.forEach(function (row) {
            rowPageNums(row, pageKey).forEach(function (p) {
                if (isNaN(p)) return;
                out[p] = (out[p] || 0) + 1;
            });
        });
        return out;
    }

    function rememberComboPageCounts(section, examTask, rows) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.rememberSheetPageCounts !== 'function') return;
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const folder = (section && section.material_folder)
            || (examTask && examTask.raw_data && examTask.raw_data.exam_material
                && examTask.raw_data.exam_material.material_folder)
            || '';
        const hint = (section && (section.meta_file_name || section.sheet_id)) || '';
        const counts = pageCountsFromMetaRows(rows);
        if (!classId || !folder || !hint || !Object.keys(counts).length) return;
        fcmc.rememberSheetPageCounts(classId, folder, hint, counts);
    }

    function currentClassId() {
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        return (bState && bState.classId) || '';
    }

    function comboForExamSection(section, examTask) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!fcmc || typeof fcmc.getAssignedComboById !== 'function') return null;
        const classId = currentClassId();
        const ownId = String((section && section.combination_id) || '').trim();
        if (ownId) {
            const byId = fcmc.getAssignedComboById(classId, ownId);
            if (byId) return byId;
        }
        if (!examTask || !examTask.raw_data || !examTask.raw_data.exam_job) return null;
        const wantSecId = String((section && section._section_id) || '').trim();
        const wantSheet = fullMetaStem((section && (section.meta_file_name || section.sheet_id)) || '').toUpperCase();
        let found = null;
        (examTask.raw_data.exam_job.sections || []).forEach(function (sec) {
            if (found || !sec || !sec.combination_id) return;
            if (wantSecId && String(sec.id || '') === wantSecId) {
                found = fcmc.getAssignedComboById(classId, sec.combination_id);
                return;
            }
            if (!wantSheet) return;
            const hit = (sec.segments || []).some(function (seg) {
                return fullMetaStem(seg && (seg.meta_file_name || seg.sheet_id)).toUpperCase() === wantSheet;
            });
            if (hit) found = fcmc.getAssignedComboById(classId, sec.combination_id);
        });
        return found;
    }

    function totalFromMetaRows(rows) {
        if (window.SheetRangeBounds && typeof window.SheetRangeBounds.totalFromMetaRows === 'function') {
            return window.SheetRangeBounds.totalFromMetaRows(rows);
        }
        if (!Array.isArray(rows) || !rows.length) return null;
        let maxNo = 0;
        let hasNo = false;
        rows.forEach(function (row) {
            if (!row) return;
            const n = Number(row.item_no != null ? row.item_no : row.itemNo);
            if (isNaN(n) || n <= 0) return;
            hasNo = true;
            if (n > maxNo) maxNo = n;
        });
        return hasNo ? maxNo : rows.length;
    }

    function sheetTotalForSection(section, examTask) {
        const fcmc = window.FeatureClassMaterialCombinations;
        const classId = currentClassId();
        const combo = comboForExamSection(section, examTask);
        const hint = section && (section.meta_file_name || section.sheet_id);
        if (fcmc && typeof fcmc.lookupSheetAvailableCount === 'function') {
            const fromDb = fcmc.lookupSheetAvailableCount(classId, combo, hint);
            if (fromDb != null) return fromDb;
        }
        const byStem = (examTask && examTask.raw_data && examTask.raw_data.meta_rows_by_stem) || {};
        const rows = lookupSectionMetaRows(byStem, section);
        const fromRows = totalFromMetaRows(rows);
        if (fromRows != null && fcmc && typeof fcmc.rememberSheetAvailableCount === 'function') {
            fcmc.rememberSheetAvailableCount(classId, combo, hint, fromRows);
        }
        return fromRows;
    }

    function sectionLppForBounds(section) {
        const rowLayoutId = String((section && section.layout_profile_id) || '').trim();
        const profile = rowLayoutId ? resolveExamTemplateProfile(rowLayoutId) : null;
        const templateLpp = (profile && Number(profile.lines_per_page) > 0)
            ? Number(profile.lines_per_page) : 0;
        return resolveSectionLpp(section, templateLpp);
    }

    function countAvailableFromSheetTotal(section, examTask) {
        const SR = window.SheetRangeBounds;
        if (!SR || typeof SR.countAvailable !== 'function') return null;
        const total = sheetTotalForSection(section, examTask);
        if (total == null) return null;
        const lpp = sectionLppForBounds(section);
        if (!(lpp > 0)) return null;
        return SR.countAvailable({
            total: total,
            lpp: lpp,
            rangeType: (section && section.range_type) || 'page',
            start: section && section.start,
            end: section && section.end,
            excludeNums: section && section.exclude_nums
        });
    }

    function clampSectionRange(section, examTask) {
        const SR = window.SheetRangeBounds;
        if (!SR || typeof SR.clampRange !== 'function' || !section) return null;
        const total = sheetTotalForSection(section, examTask);
        if (total == null) return null;
        const result = SR.clampRange({
            total: total,
            lpp: sectionLppForBounds(section),
            rangeType: section.range_type || 'page',
            start: section.start,
            end: section.end
        });
        if (result && result.overflow) {
            section.start = result.start;
            section.end = result.end;
        }
        return result;
    }

    function clampExamJobRanges(task, opts) {
        opts = opts || {};
        const notes = [];
        const job = task && task.raw_data && task.raw_data.exam_job;
        (job && job.sections || []).forEach(function (sec) {
            (sec.segments || []).forEach(function (seg) {
                const r = clampSectionRange(seg, task);
                if (r && r.overflow) {
                    notes.push({
                        overflow: true,
                        label: seg.meta_file_name || seg.sheet_id || '活頁',
                        lastPage: r.lastPage,
                        lastItem: r.lastItem,
                        start: r.start,
                        end: r.end
                    });
                }
            });
        });
        if (notes.length && opts.notify !== false && window.SheetRangeBounds
            && typeof window.SheetRangeBounds.notifyOverflow === 'function') {
            window.SheetRangeBounds.notifyOverflow(notes);
        }
        return notes;
    }

    function countAvailableFromMeta(section, examTask, folderHint) {
        if (!section || !examTask) return null;
        if (section.meta_missing_page) return null;
        const fromSheet = countAvailableFromSheetTotal(section, examTask);
        if (fromSheet != null) return fromSheet;
        // 沒有活頁總題數＝需讀取。不准用舊 meta 篩頁碼得出 0 假裝沒題。
        return null;
    }

    function sectionHasRealMeta(s) {
        if (!s) return false;
        if (s.meta_file_id) return true;
        if (s.meta_file_name && /\.meta\.json$/i.test(String(s.meta_file_name))) return true;
        return false;
    }

    function maybeAutoFetchAvail() {
        // 加片段／重畫不再自動打 Drive／DB。可用題改吃開班時載入的套組統計，
        // 或缺統計時顯示「需讀取」，由老師按「讀取可用題數」。
    }

    /** 範圍內每一頁的實際 meta 列數加總。最後一頁常不滿行，禁止用「頁數 × 每頁行數」。 */
    function countAvailableFromAnyStemRows(byStem, section) {
        const keyed = lookupSectionMetaRows(byStem || {}, section);
        if (!Array.isArray(keyed) || !keyed.length) return 0;
        return countAvailableFromMetaRows(section, keyed) || 0;
    }

    function formatDisplayPercent(count, avail) {
        if (avail == null) return '—';
        if (!(avail > 0)) return 'N/A';
        const q = Number(count);
        if (isNaN(q)) return 'N/A';
        return ((q / avail) * 100).toFixed(1) + '%';
    }

    /**
     * @param {object} section
     * @param {number} [fallbackLpp] 這一列沒手動設過每頁行數時的退回值——老師強烈回報「範本裡都有
     * 每頁行數，算不出來嗎」：這裡的 fallback 應該優先用「這一列實際套用的考卷範本」自己的
     * lines_per_page（呼叫端傳入 resolveExamTemplateProfile(...).lines_per_page），只有連範本都
     * 解析不到時才退回全站預設 DEFAULT_LINES_PER_PAGE，不可一律用寫死的 10 蓋過範本設定的值。
     */
    function resolveSectionLpp(section, templateLpp) {
        const stored = Number(section && section.lines_per_page);
        const fromTpl = Number(templateLpp);
        if (stored > 0 && stored !== DEFAULT_LINES_PER_PAGE) return stored;
        if (fromTpl > 0) return fromTpl;
        if (stored > 0) return stored;
        return DEFAULT_LINES_PER_PAGE;
    }

    function examJobTemplateLpp(task) {
        const job = task && task.raw_data && task.raw_data.exam_job;
        const id = String((job && job.layout_profile_id) || '').trim();
        const profile = id ? resolveExamTemplateProfile(id) : null;
        const n = profile && Number(profile.lines_per_page);
        return (n > 0) ? n : DEFAULT_LINES_PER_PAGE;
    }

    function expectedSlotsForSection(section, fallbackLpp) {
        const start = Number(section && section.start);
        const end = Number(section && section.end);
        if (isNaN(start) || isNaN(end)) return null;
        const span = Math.max(1, Math.abs(end - start) + 1);
        const rtype = (section && section.range_type) || 'page';
        if (rtype === 'qnum' || rtype === 'row') return span;
        return span * resolveSectionLpp(section, fallbackLpp);
    }

    let cachedContext = null; // { classId, className, assignments }

    const state = {
        jobId: '',
        examTitle: '',
        bankId: BANK_CATALOG[0] ? BANK_CATALOG[0].id : '',
        // 💣 雷區：不可再偷偷退回內建考卷範本第一項——逼老師自己在下拉挑，避免選錯排版公式
        layoutProfileId: '',
        assignmentId: '',
        taskId: '', // 空＝儲存時新建 exam 任務
        sections: [
            { sheet_id: 'K', range_type: 'page', start: 1, end: 2, count: 20, lines_per_page: DEFAULT_LINES_PER_PAGE }
        ],
        outputs: { pdf: true, answer: true },
        options: {
            shuffle: true,
            force_qnum: true,
            separate_pages: false,
            header_left: '',
            header_center: '',
            header_right: '',
            include_nums: '',
            exclude_nums: '',
            difficulty: ''
        },
        lastPayload: null,
        dirty: false,
        importNote: '' // 從作業帶入時的說明
    };

    function stripHtml(str) {
        return String(str == null ? '' : str).replace(/<[^>]*>?/gm, '').trim();
    }

    function inferBankId(className) {
        const hay = String(className || '');
        for (let i = 0; i < BANK_CATALOG.length; i++) {
            const b = BANK_CATALOG[i];
            if (hay.indexOf(b.label) !== -1 || hay.toLowerCase().indexOf(b.id) !== -1) return b.id;
            const aliases = b.aliases || [];
            for (let j = 0; j < aliases.length; j++) {
                if (hay.toUpperCase().indexOf(String(aliases[j]).toUpperCase()) !== -1) return b.id;
            }
        }
        return BANK_CATALOG[0] ? BANK_CATALOG[0].id : '';
    }

    /** 「pp. 238」的 p 不是活頁。舊 regex 會把頁碼前綴拆成 sheet_id = P。 */
    function isPagePrefixMisreadAsSheet(sheet) {
        return /^pp?$/i.test(String(sheet || '').trim());
    }

    function rejectBogusPagePrefixSections(sections) {
        return (sections || []).filter(function (s) {
            return s && !isPagePrefixMisreadAsSheet(s.sheet_id);
        });
    }

    /** 假活頁 P 清掉；這個資料夾若只有一個 meta，直接帶入。多份 meta 不准猜。 */
    function healExamSectionSheet(section, metaOpts) {
        if (!section) return;
        if (isPagePrefixMisreadAsSheet(section.sheet_id)) {
            section.sheet_id = '';
            if (!section.meta_file_name || /^pp?(\.meta\.json)?$/i.test(String(section.meta_file_name))) {
                delete section.meta_file_name;
                delete section.meta_file_id;
            }
        }
        if (section.meta_file_name || section.sheet_id) return;
    }

    /** 片段還沒選 meta 時，用同層錄音同一頁碼範圍的那一列還原（一個資料夾可有多份 meta）。 */
    function healSegmentMetaFromAudio(section, audioTask) {
        if (!section || !audioTask) return;
        if (String(section.meta_file_name || '').trim()) return;
        const alreadySheet = String(section.sheet_id || '').trim();
        const raw = audioTask.raw_data || {};
        const refs = Array.isArray(raw.material_refs) ? raw.material_refs : [];
        const start = Number(section.start);
        const end = Number(section.end);
        if (!refs.length || isNaN(start) || isNaN(end)) return;
        let best = null;
        refs.forEach(function (r) {
            if (section.combination_id && String(r.combo_id || r.combination_id || '') !== String(section.combination_id)) return;
            const published = String((r && (r.published_file || r.metaFile)) || '').trim();
            if (!published) return;
            if (alreadySheet) {
                const pubStem = fullMetaStem(published);
                const haveStem = fullMetaStem(alreadySheet);
                if (pubStem.toUpperCase() !== haveStem.toUpperCase()) return;
            }
            const parsed = parseSectionRangeFromSpec((r.range_spec || r.range || ''), '');
            if (!parsed) return;
            if (start > parsed.end || end < parsed.start) return;
            const overlap = Math.min(end, parsed.end) - Math.max(start, parsed.start) + 1;
            if (!best || overlap > best.overlap) {
                best = { published: published, fileId: r.fileId || r.file_id || '', overlap: overlap };
            }
        });
        if (!best) return;
        if (section.combination_id) {
            const combo = lookupAssignedCombo(currentClassId(), section.combination_id);
            const own = comboOwnMetaFiles(combo);
            const want = fullMetaStem(best.published).toUpperCase();
            const ok = own.some(function (n) { return fullMetaStem(n).toUpperCase() === want; });
            if (!ok) return;
        }
        section.meta_file_name = best.published;
        if (best.fileId) section.meta_file_id = best.fileId;
        if (!String(section.sheet_id || '').trim()) {
            section.sheet_id = fullMetaStem(best.published);
        }
    }

    /** 只取頁碼，不把 pp. 當成活頁。 */
    function parsePageRangeOnly(rangeText) {
        const m = String(rangeText || '').match(/pp?\.?\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/i);
        if (!m) return null;
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : start;
        if (isNaN(start) || isNaN(end)) return null;
        return { start: start, end: end };
    }

    function seedSectionsAfterFolderReady(sections, audioTask, metaOpts, assignedTemplateId) {
        const cleaned = rejectBogusPagePrefixSections(sections || []).filter(function (s) {
            return s && (s.sheet_id || s.meta_file_name || s.meta_file_id
                || Number(s.start) > 1 || Number(s.end) > 1);
        });
        if (cleaned.length) return cleaned;
        let start = 1;
        let end = 1;
        const audioRaw = (audioTask && audioTask.raw_data) || {};
        const rangeOnly = parsePageRangeOnly(audioRaw.material_range || '')
            || parsePageRangeOnly(stripHtml((audioTask && audioTask.title) || ''));
        if (rangeOnly) {
            start = rangeOnly.start;
            end = rangeOnly.end;
        }
        const sec = {
            sheet_id: '',
            range_type: 'page',
            start: start,
            end: end,
            count: 10,
            lines_per_page: DEFAULT_LINES_PER_PAGE,
            difficulty: '',
            include_nums: '',
            exclude_nums: ''
        };
        healExamSectionSheet(sec, metaOpts);
        return [sec];
    }

    /**
     * 解析「A pp. 1~2 ; B pp. 1~2」→ sections（尚未分配 count）
     * 活頁與 pp. 之間必須有空白；禁止把「pp. 238」誤讀成活頁 P。
     */
    function parseMaterialRangeToSections(rangeText, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        const text = String(rangeText || '').trim();
        if (!text) return [];
        const parts = text.split(/[;；]/);
        const sections = [];
        const seen = {};
        const re = /^\s*([A-Za-z][A-Za-z0-9._-]{0,60})\s+pp?\.?\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/i;
        for (let i = 0; i < parts.length; i++) {
            const m = String(parts[i]).trim().match(re);
            if (!m) continue;
            const sheet = m[1].toUpperCase();
            if (isPagePrefixMisreadAsSheet(sheet)) continue;
            const start = Number(m[2]);
            const end = m[3] ? Number(m[3]) : start;
            if (!sheet || isNaN(start) || isNaN(end)) continue;
            const key = sheet + ':' + start + ':' + end;
            if (seen[key]) continue;
            seen[key] = true;
            const pageSpan = Math.max(1, end - start + 1);
            sections.push({
                sheet_id: sheet,
                range_type: 'page',
                start: start,
                end: end,
                count: pageSpan * lpp,
                lines_per_page: lpp,
                difficulty: '',
                include_nums: '',
                exclude_nums: ''
            });
        }
        return sections;
    }

    /** 從 grading_units（優先 stem+page 欄位）合併成 sections */
    function sectionsFromGradingUnits(units, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        if (!Array.isArray(units) || !units.length) return [];
        const bySheet = {};
        const order = [];
        units.forEach(function (u) {
            if (!u) return;
            let sheet = String(u.stem || '').trim().toUpperCase();
            let page = Number(u.page);
            if (!sheet || isNaN(page)) {
                const label = String(u.label || u.unit_key || '').trim();
                const m = label.match(/^([A-Za-z][A-Za-z0-9._-]{0,60})\s+p(?:p)?\.?\s*(\d+)/i);
                if (!m) return;
                sheet = m[1].toUpperCase();
                page = Number(m[2]);
            }
            if (!sheet || isNaN(page) || isPagePrefixMisreadAsSheet(sheet)) return;
            let itemCount = (u.item_count != null && u.item_count !== '') ? Number(u.item_count) : NaN;
            if (isNaN(itemCount) && Array.isArray(u.item_nos)) itemCount = u.item_nos.length;
            if (isNaN(itemCount)) itemCount = 0;
            if (!bySheet[sheet]) {
                bySheet[sheet] = {
                    sheet_id: sheet,
                    start: page,
                    end: page,
                    pages: [page],
                    avail: itemCount
                };
                order.push(sheet);
            } else {
                const s = bySheet[sheet];
                s.start = Math.min(s.start, page);
                s.end = Math.max(s.end, page);
                if (s.pages.indexOf(page) === -1) s.pages.push(page);
                s.avail += itemCount;
            }
        });
        return order.map(function (sheet) {
            const s = bySheet[sheet];
            s.pages.sort(function (a, b) { return a - b; });
            const pageSpan = s.pages.length || Math.max(1, s.end - s.start + 1);
            // 💣 老師回報「每頁行數，算不出來嗎」：grading_units 本身就記著每頁真實題數
            // （item_count／item_nos），算得出來就不要一律塞固定的 10，直接用真實平均值。
            const realLpp = (pageSpan > 0 && s.avail > 0) ? Math.max(1, Math.round(s.avail / pageSpan)) : lpp;
            return {
                sheet_id: s.sheet_id,
                range_type: 'page',
                start: s.start,
                end: s.end,
                pages: s.pages.slice(),
                count: s.avail > 0 ? s.avail : (pageSpan * lpp),
                lines_per_page: realLpp
            };
        });
    }

    function distributeTotalCount(sections, totalCount) {
        if (!sections.length || !totalCount || totalCount <= 0) return sections;
        const n = sections.length;
        const base = Math.floor(totalCount / n);
        let rem = totalCount % n;
        return sections.map(function (s, i) {
            const copy = Object.assign({}, s);
            copy.count = base + (i < rem ? 1 : 0);
            return copy;
        });
    }

    /**
     * 從作業既有任務讀：錄音範圍、抽考題數、考試標題
     */
    function extractHintsFromAssignment(assignment) {
        const hints = {
            rangeText: '',
            gradingUnits: null,
            materialRefs: null,
            audioTask: null,
            totalCount: 0,
            examTitle: '',
            sourceNotes: []
        };
        if (!assignment) return hints;

        walkTasks(assignment.tasks || [], function (t) {
            if (!t) return;
            if (t.type === 'audio_record') {
                const raw = t.raw_data || {};
                if (!hints.audioTask) {
                    hints.audioTask = t;
                    hints.sourceNotes.push('錄音任務');
                }
                const range = String(raw.material_range || '').trim() || stripHtml(t.title || '');
                if (range && /[A-Za-z]+\s*pp?\.?/i.test(range) && !hints.rangeText) {
                    hints.rangeText = range;
                }
                if (!hints.gradingUnits && Array.isArray(raw.grading_units) && raw.grading_units.length) {
                    hints.gradingUnits = raw.grading_units;
                }
                if (!hints.materialRefs || !hints.materialRefs.length) {
                    if (Array.isArray(raw.material_refs) && raw.material_refs.length) {
                        hints.materialRefs = raw.material_refs;
                    } else if (raw.material_ref && raw.material_ref.published_file) {
                        hints.materialRefs = [raw.material_ref];
                    }
                }
            }
            if (t.type === 'check' || t.type === 'exam') {
                const blob = stripHtml(t.title || '') + ' ' + stripHtml(t.description || '');
                const countMatch = blob.match(/(\d+)\s*題/);
                if (countMatch) {
                    hints.totalCount = Number(countMatch[1]);
                    hints.sourceNotes.push('題數「' + countMatch[1] + ' 題」');
                }
                if (/抽考|考試|test/i.test(blob)) {
                    const tTitle = stripHtml(t.title || '');
                    if (tTitle) hints.examTitle = tTitle;
                }
            }
        });
        return hints;
    }

    function applyHintsFromAssignment(assignment, opts) {
        const options = opts || {};
        const hints = extractHintsFromAssignment(assignment);
        let sections = [];
        if (hints.audioTask) {
            sections = sectionsFromAudioTask(hints.audioTask, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('material_refs／錄音範圍');
        }
        if (!sections.length) {
            sections = parseMaterialRangeToSections(hints.rangeText, DEFAULT_LINES_PER_PAGE);
        }
        if (!sections.length && hints.materialRefs) {
            sections = sectionsFromMaterialRefs(hints.materialRefs, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('material_refs');
        }
        if (!sections.length && hints.gradingUnits) {
            sections = sectionsFromGradingUnits(hints.gradingUnits, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('grading_units');
        }
        if (hints.totalCount > 0 && sections.length) {
            sections = distributeTotalCount(sections, hints.totalCount);
        }
        if (sections.length) {
            state.sections = sections;
        }
        if (hints.examTitle && (options.forceTitle || !state.examTitle)) {
            state.examTitle = hints.examTitle;
        }
        if (cachedContext && cachedContext.className) {
            state.bankId = inferBankId(cachedContext.className);
        }
        if (sections.length || hints.totalCount) {
            const bits = [];
            if (sections.length) bits.push(sections.length + ' 個活頁區段');
            if (hints.totalCount) bits.push('共 ' + hints.totalCount + ' 題（均分到各區段）');
            if (hints.sourceNotes.length) bits.push('來源：' + hints.sourceNotes.join('、'));
            state.importNote = '已從作業帶入：' + bits.join('；');
        } else {
            state.importNote = '此作業找不到可解析的錄音範圍（例如 A pp. 1~2），請手動填區段。';
        }
        return hints;
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function newJobId() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const rand = Math.random().toString(36).slice(2, 6);
        return 'exam-' + y + m + day + '-' + rand;
    }

    function walkTasks(tasks, visitor, parentPath) {
        if (!Array.isArray(tasks)) return;
        const path = parentPath || [];
        tasks.forEach(function (t, idx) {
            visitor(t, path.concat(idx));
            if (t && Array.isArray(t.subTasks)) walkTasks(t.subTasks, visitor, path.concat(idx));
        });
    }

    function findTaskById(tasks, taskId) {
        let found = null;
        walkTasks(tasks, function (t) {
            if (t && String(t.id) === String(taskId)) found = t;
        });
        return found;
    }

    function listExamTasks(assignment) {
        const out = [];
        if (!assignment) return out;
        walkTasks(assignment.tasks || [], function (t) {
            if (t && t.type === 'exam') {
                const raw = t.raw_data || {};
                out.push({
                    id: t.id,
                    title: t.title || raw.exam_title || '(未命名考試)',
                    jobId: raw.exam_job_id || (raw.exam_job && raw.exam_job.job_id) || ''
                });
            }
        });
        return out;
    }

    function getSelectedAssignment() {
        if (!cachedContext || !state.assignmentId) return null;
        return (cachedContext.assignments || []).find(function (a) {
            return String(a.id) === String(state.assignmentId);
        }) || null;
    }

    function markDirty() {
        state.dirty = true;
    }

    function isDirty() {
        return state.dirty;
    }

    function syncSectionsFromDom() {
        const rows = document.querySelectorAll('[data-exam-section]');
        if (!rows.length) return;
        const next = [];
        rows.forEach(function (row) {
            const idx = Number(row.getAttribute('data-exam-section'));
            const sheet = (document.getElementById('exam-sheet-' + idx) || {}).value || '';
            const rangeType = (document.getElementById('exam-range-type-' + idx) || {}).value || 'page';
            const start = Number((document.getElementById('exam-start-' + idx) || {}).value);
            const end = Number((document.getElementById('exam-end-' + idx) || {}).value);
            const count = Number((document.getElementById('exam-count-' + idx) || {}).value);
            const lines = Number((document.getElementById('exam-lpp-' + idx) || {}).value);
            const sec = {
                sheet_id: String(sheet).trim(),
                range_type: rangeType,
                start: start,
                end: end,
                count: count
            };
            if (rangeType === 'page') {
                sec.lines_per_page = isNaN(lines) || lines <= 0 ? 10 : lines;
            }
            next.push(sec);
        });
        state.sections = next;
    }

    function syncFormFromDom() {
        const titleEl = document.getElementById('exam-title');
        const bankEl = document.getElementById('exam-bank');
        const layoutEl = document.getElementById('exam-layout');
        const assignEl = document.getElementById('exam-assignment');
        const taskEl = document.getElementById('exam-task');
        if (titleEl) state.examTitle = String(titleEl.value || '').trim();
        if (bankEl) state.bankId = bankEl.value;
        if (layoutEl) state.layoutProfileId = layoutEl.value;
        if (assignEl) state.assignmentId = assignEl.value;
        if (taskEl) state.taskId = taskEl.value;

        state.outputs.pdf = !!(document.getElementById('exam-out-pdf') || {}).checked;
        state.outputs.answer = !!(document.getElementById('exam-out-answer') || {}).checked;

        const opt = state.options;
        opt.shuffle = !!(document.getElementById('exam-opt-shuffle') || {}).checked;
        opt.force_qnum = !!(document.getElementById('exam-opt-force-qnum') || {}).checked;
        opt.separate_pages = !!(document.getElementById('exam-opt-separate-pages') || {}).checked;
        ['header_left', 'header_center', 'header_right', 'include_nums', 'exclude_nums', 'difficulty'].forEach(function (key) {
            const el = document.getElementById('exam-opt-' + key.replace(/_/g, '-'));
            if (el) opt[key] = String(el.value || '').trim();
        });

        syncSectionsFromDom();
    }

    function validateAndBuildPayload() {
        syncFormFromDom();

        if (!state.jobId) state.jobId = newJobId();
        if (!state.bankId) throw new Error('請選擇 bank_id（題庫）');
        if (!state.layoutProfileId) throw new Error('請選擇 layout_profile_id（卷面模板）');
        if (!state.sections.length) throw new Error('至少需要一個出題區段');

        const sections = [];
        for (let i = 0; i < state.sections.length; i++) {
            const s = state.sections[i];
            if (!s.sheet_id) throw new Error('區段 ' + (i + 1) + '：缺少 sheet_id');
            if (['page', 'qnum', 'row'].indexOf(s.range_type) === -1) {
                throw new Error('區段 ' + (i + 1) + '：range_type 必須是 page／qnum／row');
            }
            if (isNaN(s.start) || isNaN(s.end) || isNaN(s.count)) {
                throw new Error('區段 ' + (i + 1) + '：start／end／count 必須是數字');
            }
            if (s.count <= 0) throw new Error('區段 ' + (i + 1) + '：count 必須 > 0');
            if (s.end < s.start) throw new Error('區段 ' + (i + 1) + '：end 不可小於 start');
            const sec = {
                sheet_id: s.sheet_id,
                range_type: s.range_type,
                start: s.start,
                end: s.end,
                count: s.count
            };
            if (s.range_type === 'page') {
                const lpp = s.lines_per_page > 0 ? s.lines_per_page : 10;
                sec.lines_per_page = lpp;
            }
            if (s.difficulty) sec.difficulty = s.difficulty;
            if (s.include_nums) sec.include_nums = s.include_nums;
            if (s.exclude_nums) sec.exclude_nums = s.exclude_nums;
            // 同一活頁可在不同區段各自覆蓋 layout_profile_id（見 material-layout-pairing-invariant.mdc）
            if (s.layout_profile_id) sec.layout_profile_id = s.layout_profile_id;
            sections.push(sec);
        }

        const outputs = [];
        if (state.outputs.pdf) outputs.push('pdf');
        if (state.outputs.answer) outputs.push('answer');
        if (!outputs.length) throw new Error('outputs 至少選一項（pdf 或 answer）');

        const options = {
            shuffle: !!state.options.shuffle,
            force_qnum: !!state.options.force_qnum,
            separate_pages: !!state.options.separate_pages
        };
        ['header_left', 'header_center', 'header_right', 'include_nums', 'exclude_nums', 'difficulty'].forEach(function (key) {
            if (state.options[key]) options[key] = state.options[key];
        });

        const payload = {
            job_id: state.jobId,
            bank_id: state.bankId,
            layout_profile_id: state.layoutProfileId,
            sections: sections,
            outputs: outputs,
            options: options
        };

        const a = getSelectedAssignment();
        payload.context = {
            class_id: cachedContext ? cachedContext.classId : '',
            class_name: cachedContext ? (cachedContext.className || '') : '',
            assignment_id: state.assignmentId || '',
            task_id: state.taskId || '',
            exam_title: state.examTitle || ''
        };
        if (a) {
            payload.context.assignment_title = a.title || '';
            payload.context.target_date = a.target_date || '';
        }

        return payload;
    }

    function downloadJson(payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exam_job_' + payload.job_id + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    async function copyJson(payload) {
        const text = JSON.stringify(payload, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    /**
     * 把 exam_job 寫進指定作業的 exam 任務 raw_data（新建或更新）
     */
    async function persistToAssignment(payload) {
        if (!state.assignmentId) {
            throw new Error('請先選擇要綁定的作業，才能寫入任務 raw_data');
        }
        if (!window.supabaseClient) throw new Error('Supabase 尚未就緒');

        const { data: row, error } = await window.supabaseClient
            .from('assignments')
            .select('id, tasks, title')
            .eq('id', state.assignmentId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error) throw error;
        if (!row) throw new Error('找不到作業');

        let tasks = Array.isArray(row.tasks) ? JSON.parse(JSON.stringify(row.tasks)) : [];
        const title = state.examTitle || ('考試 ' + payload.job_id);
        const rawPatch = {
            exam_job_id: payload.job_id,
            exam_job: payload,
            exam_title: title
        };

        let target = null;
        if (state.taskId) {
            target = findTaskById(tasks, state.taskId);
            if (!target) throw new Error('找不到選定的考試任務');
            if (target.type !== 'exam') throw new Error('選定的任務不是考試類型');
        } else {
            // 若已有同 job_id 的任務則覆寫
            walkTasks(tasks, function (t) {
                if (!t || t.type !== 'exam') return;
                const rid = (t.raw_data && t.raw_data.exam_job_id) ||
                    (t.raw_data && t.raw_data.exam_job && t.raw_data.exam_job.job_id);
                if (rid && String(rid) === String(payload.job_id)) target = t;
            });
        }

        if (target) {
            target.title = title || target.title;
            target.type = 'exam';
            target.raw_data = Object.assign({}, target.raw_data || {}, rawPatch);
            state.taskId = target.id;
            if (payload.context) payload.context.task_id = target.id;
            target.raw_data.exam_job = payload;
        } else {
            const newId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            if (payload.context) payload.context.task_id = newId;
            tasks.push({
                id: newId,
                type: 'exam',
                title: title,
                url: '',
                url_text: '',
                description: '',
                due_date: '',
                late_mode: 'infinite',
                grace_period_hours: 0,
                penalty_percentage: 0,
                raw_data: Object.assign({}, rawPatch, { exam_job: payload })
            });
            state.taskId = newId;
        }

        // 同步 cached assignment
        const { data: updated, error: upErr } = await window.supabaseClient
            .from('assignments')
            .update({ tasks: tasks })
            .eq('id', state.assignmentId)
            .is('deleted_at', null)
            .select('id, tasks')
            .maybeSingle();
        if (upErr) throw upErr;

        const nextTasks = updated && updated.tasks ? updated.tasks : tasks;
        if (cachedContext && Array.isArray(cachedContext.assignments)) {
            const a = cachedContext.assignments.find(function (x) {
                return String(x.id) === String(state.assignmentId);
            });
            if (a) a.tasks = nextTasks;
        }
        if (window.TeacherDB && Array.isArray(window.TeacherDB.assignments)) {
            const dbA = window.TeacherDB.assignments.find(function (x) {
                return String(x.id) === String(state.assignmentId);
            });
            if (dbA) dbA.tasks = nextTasks;
        }

        return state.taskId;
    }

    // ============ UI ============

    function renderSectionRow(sec, idx) {
        const sheetOpts = SHEET_SUGGESTIONS.map(function (s) {
            return '<option value="' + esc(s) + '"></option>';
        }).join('');
        const showLpp = sec.range_type === 'page';
        return `
            <div data-exam-section="${idx}" style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:10px; background:#F8FAFC;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="color:#334155;">區段 ${idx + 1}</strong>
                    <button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem; background:white; color:#B91C1C; border:1px solid #FCA5A5;"
                        onclick="window.FeatureExamJob._removeSection(${idx})" ${state.sections.length <= 1 ? 'disabled' : ''}>刪除</button>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:8px;">
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">sheet_id
                        <input id="exam-sheet-${idx}" list="exam-sheet-list-${idx}" type="text" class="form-control"
                            value="${esc(sec.sheet_id)}" placeholder="例如 K"
                            style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">
                        <datalist id="exam-sheet-list-${idx}">${sheetOpts}</datalist>
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">range_type
                        <select id="exam-range-type-${idx}" class="form-control" style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onRangeTypeChange(${idx}, this.value)">
                            <option value="page" ${sec.range_type === 'page' ? 'selected' : ''}>page（頁）</option>
                            <option value="qnum" ${sec.range_type === 'qnum' ? 'selected' : ''}>qnum（題號）</option>
                            <option value="row" ${sec.range_type === 'row' ? 'selected' : ''}>row（資料列）</option>
                        </select>
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">start
                        <input id="exam-start-${idx}" type="number" class="form-control" value="${esc(sec.start)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">end
                        <input id="exam-end-${idx}" type="number" class="form-control" value="${esc(sec.end)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">count（題數）
                        <input id="exam-count-${idx}" type="number" class="form-control" value="${esc(sec.count)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700; ${showLpp ? '' : 'opacity:0.4;'}">lines_per_page
                        <input id="exam-lpp-${idx}" type="number" class="form-control" value="${esc(sec.lines_per_page || 10)}"
                            style="width:100%; padding:6px; margin-top:2px;" ${showLpp ? '' : 'disabled'}
                            onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                </div>
            </div>
        `;
    }

    function renderModalContentHtml() {
        const bankOpts = BANK_CATALOG.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (state.bankId === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>';
        }).join('');
        const layoutOpts = '<option value=""' + (state.layoutProfileId ? '' : ' selected') + '>請選擇試卷範本</option>'
            + buildExamTemplateSelectOptionsHtml(state.layoutProfileId, '');

        const assignOpts = (cachedContext.assignments || []).map(function (a) {
            return '<option value="' + esc(a.id) + '"' + (String(state.assignmentId) === String(a.id) ? ' selected' : '') + '>'
                + esc((a.target_date || '') + ' · ' + (a.title || a.id)) + '</option>';
        }).join('');

        const examTasks = listExamTasks(getSelectedAssignment());
        const taskOpts = '<option value="">＋ 新建考試任務</option>' + examTasks.map(function (t) {
            return '<option value="' + esc(t.id) + '"' + (String(state.taskId) === String(t.id) ? ' selected' : '') + '>'
                + esc(t.title + (t.jobId ? '（' + t.jobId + '）' : '')) + '</option>';
        }).join('');

        const sectionsHtml = state.sections.map(renderSectionRow).join('');
        const preview = state.lastPayload
            ? '<pre id="exam-json-preview" style="margin:0; max-height:180px; overflow:auto; font-size:0.75rem; background:#0F172A; color:#E2E8F0; padding:10px; border-radius:8px;">'
                + esc(JSON.stringify(state.lastPayload, null, 2)) + '</pre>'
            : '<div id="exam-json-preview" style="color:#94A3B8; font-size:0.85rem;">儲存或預覽後會顯示 JSON。</div>';

        return `
            <div style="background:white; border-radius:14px; padding:24px; max-width:820px; width:100%; max-height:92vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                    <h2 style="margin:0; color:#0F766E;">📝 考試出題單（匯出 exam_job）</h2>
                    <button type="button" onclick="window.FeatureExamJob._close()" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:#94A3B8;">✕</button>
                </div>
                <p style="margin:0 0 14px; color:#64748B; font-size:0.88rem; line-height:1.5;">
                    選作業後會<strong>自動帶入</strong>該作業錄音範圍（如 A pp. 1~2）與「N 題」說明；再補卷面模板即可匯出給 Python。
                    排版公式不在這裡設定。
                </p>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">綁定作業（寫入任務 raw_data）*
                        <select id="exam-assignment" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onAssignmentChange(this.value)">
                            <option value="">請選擇作業</option>
                            ${assignOpts}
                        </select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">考試任務
                        <select id="exam-task" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onTaskChange(this.value)">
                            ${taskOpts}
                        </select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">job_id（自動產生）
                        <input id="exam-job-id" type="text" class="form-control" value="${esc(state.jobId)}" readonly
                            style="width:100%; padding:8px; margin-top:2px; background:#F1F5F9;">
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">考試名稱（寫入 context／任務標題）
                        <input id="exam-title" type="text" class="form-control" value="${esc(state.examTitle)}"
                            placeholder="例如 Test／抽考" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">bank_id *
                        <select id="exam-bank" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">${bankOpts}</select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">layout_profile_id *
                        <select id="exam-layout" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">${layoutOpts}</select>
                    </label>
                </div>

                ${state.importNote
                    ? '<div style="background:#F0FDFA; border:1px solid #99F6E4; color:#0F766E; padding:8px 12px; border-radius:8px; margin-bottom:12px; font-size:0.85rem; font-weight:700;">' + esc(state.importNote) + '</div>'
                    : ''}

                <div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                    <strong style="color:#334155;">出題區段 sections *</strong>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-action" style="padding:4px 10px; font-size:0.8rem; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;"
                            onclick="window.FeatureExamJob._importFromAssignment()" ${state.assignmentId ? '' : 'disabled'}>↻ 重新從作業帶入</button>
                        <button type="button" class="btn btn-action" style="padding:4px 10px; font-size:0.8rem; background:#CCFBF1; color:#0F766E; border:1px solid #99F6E4;"
                            onclick="window.FeatureExamJob._addSection()">＋ 加區段</button>
                    </div>
                </div>
                <div id="exam-sections">${sectionsHtml}</div>

                <div style="display:flex; gap:16px; flex-wrap:wrap; margin:12px 0; font-size:0.85rem; font-weight:700; color:#334155;">
                    <label><input id="exam-out-pdf" type="checkbox" ${state.outputs.pdf ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> outputs: pdf</label>
                    <label><input id="exam-out-answer" type="checkbox" ${state.outputs.answer ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> outputs: answer</label>
                    <label><input id="exam-opt-shuffle" type="checkbox" ${state.options.shuffle ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> shuffle</label>
                    <label><input id="exam-opt-force-qnum" type="checkbox" ${state.options.force_qnum ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> force_qnum</label>
                    <label><input id="exam-opt-separate-pages" type="checkbox" ${state.options.separate_pages ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> separate_pages</label>
                </div>

                <details style="margin-bottom:12px;">
                    <summary style="cursor:pointer; color:#64748B; font-weight:700; font-size:0.85rem;">進階 options（表頭／含題／難度…）</summary>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:8px;">
                        <input id="exam-opt-header-left" class="form-control" placeholder="header_left" value="${esc(state.options.header_left)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-header-center" class="form-control" placeholder="header_center" value="${esc(state.options.header_center)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-header-right" class="form-control" placeholder="header_right" value="${esc(state.options.header_right)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-include-nums" class="form-control" placeholder="include_nums" value="${esc(state.options.include_nums)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-exclude-nums" class="form-control" placeholder="exclude_nums" value="${esc(state.options.exclude_nums)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-difficulty" class="form-control" placeholder="difficulty" value="${esc(state.options.difficulty)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                    </div>
                </details>

                <div style="margin-bottom:12px;">${preview}</div>

                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" class="btn btn-action" style="background:#0F766E; color:white; border:none; font-weight:800;"
                        onclick="window.FeatureExamJob._preview()">👁 預覽 JSON</button>
                    <button type="button" class="btn btn-action" style="background:#059669; color:white; border:none; font-weight:800;"
                        onclick="window.FeatureExamJob._saveAndExport()">💾 儲存任務並下載 JSON</button>
                    <button type="button" class="btn" style="font-weight:700;"
                        onclick="window.FeatureExamJob._copyOnly()">📋 複製 JSON</button>
                    <button type="button" class="btn" style="font-weight:700;"
                        onclick="window.FeatureExamJob._newJobId()">🔄 換新 job_id</button>
                </div>
            </div>
        `;
    }

    function renderBody() {
        const el = document.getElementById('exam-job-modal');
        if (!el) return;
        el.innerHTML = renderModalContentHtml();
    }

    function onFieldChange() {
        markDirty();
        syncFormFromDom();
    }

    function onRangeTypeChange(idx, value) {
        syncFormFromDom();
        if (state.sections[idx]) state.sections[idx].range_type = value;
        markDirty();
        renderBody();
    }

    function onAssignmentChange(id) {
        syncFormFromDom();
        state.assignmentId = id;
        state.taskId = '';
        state.importNote = '';
        const a = getSelectedAssignment();
        if (a) {
            applyHintsFromAssignment(a, { forceTitle: true });
            window.showFlash(state.importNote || '已選作業', state.sections.length ? 'success' : 'warning');
        }
        markDirty();
        renderBody();
    }

    function importFromAssignment() {
        syncFormFromDom();
        const a = getSelectedAssignment();
        if (!a) {
            window.showFlash('請先選擇作業', 'error');
            return;
        }
        applyHintsFromAssignment(a, { forceTitle: false });
        markDirty();
        renderBody();
        window.showFlash(state.importNote || '已重新帶入', state.sections.length ? 'success' : 'warning');
    }

    function onTaskChange(id) {
        syncFormFromDom();
        state.taskId = id;
        const a = getSelectedAssignment();
        const t = a && id ? findTaskById(a.tasks || [], id) : null;
        if (t && t.raw_data && t.raw_data.exam_job) {
            loadFromPayload(t.raw_data.exam_job, t.title || t.raw_data.exam_title || '');
            state.importNote = '已載入此考試任務既有的 exam_job。';
        }
        markDirty();
        renderBody();
    }

    function loadFromPayload(payload, title) {
        if (!payload) return;
        state.jobId = payload.job_id || state.jobId || newJobId();
        state.examTitle = title || (payload.context && payload.context.exam_title) || state.examTitle;
        state.bankId = payload.bank_id || state.bankId;
        state.layoutProfileId = payload.layout_profile_id || state.layoutProfileId;
        state.sections = Array.isArray(payload.sections) && payload.sections.length
            ? payload.sections.map(function (s) {
                return {
                    sheet_id: s.sheet_id || '',
                    range_type: s.range_type || 'page',
                    start: s.start,
                    end: s.end,
                    count: s.count,
                    lines_per_page: s.lines_per_page || 10
                };
            })
            : state.sections;
        const outs = payload.outputs || [];
        state.outputs.pdf = outs.indexOf('pdf') !== -1;
        state.outputs.answer = outs.indexOf('answer') !== -1;
        if (payload.options) {
            Object.keys(state.options).forEach(function (k) {
                if (payload.options[k] !== undefined) state.options[k] = payload.options[k];
            });
        }
        state.lastPayload = payload;
    }

    function addSection() {
        syncFormFromDom();
        state.sections.push({
            sheet_id: 'K',
            range_type: 'page',
            start: 1,
            end: 1,
            count: 10,
            lines_per_page: 10
        });
        markDirty();
        renderBody();
    }

    function removeSection(idx) {
        syncFormFromDom();
        if (state.sections.length <= 1) return;
        state.sections.splice(idx, 1);
        markDirty();
        renderBody();
    }

    function preview() {
        try {
            const payload = validateAndBuildPayload();
            state.lastPayload = payload;
            renderBody();
            window.showFlash('JSON 預覽已更新', 'success');
        } catch (err) {
            window.showFlash(err.message || String(err), 'error');
        }
    }

    async function saveAndExport() {
        try {
            const payload = validateAndBuildPayload();
            await persistToAssignment(payload);
            state.lastPayload = payload;
            state.dirty = false;
            downloadJson(payload);
            renderBody();
            window.showFlash('已寫入考試任務並下載 exam_job（job_id: ' + payload.job_id + '）', 'success');
            if (window.FeatureProgress && cachedContext && typeof window.FeatureProgress.refresh === 'function') {
                // 不強制刷新進度表，避免打斷；老師可自行重整
            }
        } catch (err) {
            console.error('[FeatureExamJob]', err);
            window.showFlash('儲存／匯出失敗：' + (err.message || err), 'error');
        }
    }

    async function copyOnly() {
        try {
            const payload = validateAndBuildPayload();
            state.lastPayload = payload;
            await copyJson(payload);
            renderBody();
            window.showFlash('已複製 JSON（尚未寫入任務；若要對回請按「儲存任務並下載」）', 'success');
        } catch (err) {
            window.showFlash(err.message || String(err), 'error');
        }
    }

    function rotateJobId() {
        state.jobId = newJobId();
        state.taskId = '';
        markDirty();
        renderBody();
    }

    function closeModal() {
        window.ModalOverlay.close('exam-job-modal');
    }

    function resetState() {
        state.jobId = newJobId();
        state.examTitle = '';
        state.bankId = BANK_CATALOG[0] ? BANK_CATALOG[0].id : '';
        state.layoutProfileId = '';
        state.assignmentId = '';
        state.taskId = '';
        state.sections = [
            { sheet_id: 'K', range_type: 'page', start: 1, end: 2, count: 20, lines_per_page: 10 }
        ];
        state.outputs = { pdf: true, answer: true };
        state.options = {
            shuffle: true,
            force_qnum: true,
            separate_pages: false,
            header_left: '',
            header_center: '',
            header_right: '',
            include_nums: '',
            exclude_nums: '',
            difficulty: ''
        };
        state.lastPayload = null;
        state.dirty = false;
        state.importNote = '';
        if (cachedContext && cachedContext.className) {
            state.bankId = inferBankId(cachedContext.className) || state.bankId;
        }
    }

    function renderEntryButton(classId, assignments, className) {
        cachedContext = {
            classId: classId,
            className: className || '',
            assignments: assignments || []
        };
        return `
            <button type="button" class="btn btn-action" onclick="window.FeatureExamJob.openModal()"
                style="background:#F0FDFA; color:#0F766E; border:1px solid #99F6E4; font-weight:800;">
                📝 考試出題單（快捷）
            </button>
        `;
    }

    function openModal() {
        if (!cachedContext) {
            window.showFlash('請先開啟班級進度總表再使用出題單', 'error');
            return;
        }
        resetState();
        window.ModalOverlay.open({
            id: 'exam-job-modal',
            tier: 'B',
            isDirty: isDirty,
            unsavedMessage: '出題單尚未儲存，確定要關閉嗎？',
            contentHtml: renderModalContentHtml()
        });
    }

    /**
     * 作業編輯器內嵌：考試任務卡片上的出題區段表（對齊 Python 出題列欄位）
     */
    function renderInlineEditorHtml(pathStr, task) {
        if (task) {
            inheritRangePackIntoExamIfEmpty(pathStr, task);
            const overflow = clampExamJobRanges(task, { notify: false });
            if (overflow.length && !_rangeClampNotified[pathStr]) {
                _rangeClampNotified[pathStr] = true;
                if (window.SheetRangeBounds && typeof window.SheetRangeBounds.notifyOverflow === 'function') {
                    window.SheetRangeBounds.notifyOverflow(overflow);
                }
            }
        }
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.fetchOfficialPairings === 'function') {
            if (!officialPairingCacheReady()) {
                window.FeatureClassMaterialCombinations.fetchOfficialPairings(false);
            }
        }
        const raw = (task && task.raw_data) || {};
        const job = raw.exam_job || {};
        const jobId = raw.exam_job_id || job.job_id || '';
        // 試卷範本：選了 meta 之後只列官方認證組合。沒配對就不能出卷，不准列出整庫。
        // bank_id：老師反覆回報這個欄位沒用、看不懂放著幹嘛（只是原樣寫進匯出給 Python 排版
        // 系統的 spec_ref.bank_id 標籤，不影響線上卷實際抽哪些題），已拿掉 UI，改成存檔時
        // 固定寫入唯一值（見 syncInlineEditor），這裡不用再算。
        // 💣 老師按過「🔓 改成獨立教材來源」（exam_force_standalone）之後，就不能再自動從
        // 同層錄音帶入區段了，否則清空的區段下一次重繪又會被這裡偷偷填回去，老師的覆蓋選擇形同沒用。
        const _forcedStandaloneForFill = !!(task.raw_data && task.raw_data.exam_force_standalone);
        let sections = normalizeExamSections(job.sections, {
            material_folder: '',
            material_root_kind: 'teacher',
            shuffle: !(job.options && job.options.shuffle === false),
            allow_answer_appeal: raw.allow_answer_appeal !== false
        });
        const paperItemCount = (raw.quiz_paper && Array.isArray(raw.quiz_paper.items))
            ? raw.quiz_paper.items.length
            : 0;
        const paperNo = raw.quiz_paper_no || '';
        const paperAt = (raw.quiz_paper && raw.quiz_paper.generated_at)
            ? String(raw.quiz_paper.generated_at).replace('T', ' ').slice(0, 16)
            : '';
        const paperStaleReason = paperItemCount
            ? (raw.last_generate_error
                ? '這次產生失敗'
                : (needsExamRegeneration(task) ? '設定已改尚未重產' : ''))
            : '';
        const paperCountHint = !paperItemCount
            ? '｜尚未產生線上卷'
            : (paperStaleReason
                ? ('｜舊卷 ' + paperItemCount + ' 題'
                    + (paperNo ? ('｜' + paperNo) : '')
                    + (paperAt ? ('｜' + paperAt) : '')
                    + '｜' + paperStaleReason)
                : ('｜線上卷 ' + paperItemCount + ' 題'
                    + (paperNo ? ('｜卷號 ' + paperNo) : '')
                    + (paperAt ? ('｜' + paperAt) : '')));
        const paperHintColor = paperItemCount && !paperStaleReason ? '#134E4A' : '#92400E';
        const savedGenStatus = _genStatusByPath[pathStr] || null;

        let siblingAudio = null;
        let siblingAudioCount = 0;
        let currentClassId = '';
        if (window.BuilderStore && typeof window.BuilderStore.getState === 'function') {
            const bState = window.BuilderStore.getState();
            const allSiblingHits = findAllSiblingAudioHits((bState && bState.tasks) || [], pathStr);
            siblingAudioCount = allSiblingHits.length;
            siblingAudio = allSiblingHits[0] ? allSiblingHits[0].task : null;
            currentClassId = (bState && bState.classId) || '';
        }
        if (currentClassId && window.FeatureClassMaterialCombinations
            && typeof window.FeatureClassMaterialCombinations.isComboStatsReady === 'function'
            && !window.FeatureClassMaterialCombinations.isComboStatsReady(currentClassId)
            && typeof window.FeatureClassMaterialCombinations.prefetchForClass === 'function') {
            window.FeatureClassMaterialCombinations.prefetchForClass(currentClassId).then(function () {
                refreshExamBuilder();
            }).catch(function () {});
        }
        // 獨立考試（無同層錄音）：有沒有設定過自己的教材資料夾，決定「需讀取」提示要不要出現
        const examMaterialSelf = getExamMaterialSelf(task);
        // 💣 雷區（2026-08-14 老師回報「拿掉整棵樹亂配對後還是一模一樣，選不到 meta」）：
        // 「同層」對一個一路平鋪、好幾個單元＋各自考試都放在同一層 tasks 陣列的作業來說，
        // 範圍還是太大——同層只要「有任何一個」錄音任務，不管是不是這份考試真正要用的那個，
        // 都會被抓來當 combo。這種情況光憑程式自動判斷分不出「老師是真的要配這個錄音」還是
        // 「這份考試其實跟它無關」，所以加一個老師自己可切換的旗標，讓老師能明確覆蓋判斷。
        const forcedStandalone = !!(task && task.raw_data && task.raw_data.exam_force_standalone);
        const underComboPack = isExamUnderComboPack(pathStr, task);
        const isStandaloneExam = !underComboPack && (!siblingAudio || forcedStandalone);

        // 試卷範本下拉只列該 meta 的官方認證組合（material_combination_exam_templates）。
        const layoutMaterialFolder = isStandaloneExam
            ? examMaterialSelf.material_folder
            : ((siblingAudio && siblingAudio.raw_data && Array.isArray(siblingAudio.raw_data.material_refs)
                && siblingAudio.raw_data.material_refs[0] && siblingAudio.raw_data.material_refs[0].material_folder) || '');
        const layoutComboFirstRef = (siblingAudio && siblingAudio.raw_data && Array.isArray(siblingAudio.raw_data.material_refs))
            ? siblingAudio.raw_data.material_refs[0] : null;
        const layoutRootKind = isStandaloneExam
            ? (examMaterialSelf.root_kind || 'teacher')
            : ((layoutComboFirstRef && layoutComboFirstRef.materials_root_kind === 'class') ? 'class' : 'teacher');
        const previewFolderForAssign = examMaterialSelf.material_folder || layoutMaterialFolder;
        const folderIsAssigned = !!(previewFolderForAssign && isExamFolderAssignedToClass(currentClassId, previewFolderForAssign));
        const assignedTemplateId = '';
        const layoutId = job.layout_profile_id || assignedTemplateId || '';

        // 💣 雷區（2026-08-14 老師強烈回報「活頁根本沒有可選 meta，只給一個手打格子」＋
        // 「不會改成這個班級用過的教材 meta 嗎」）：這裡原本「教材資料夾」這個下拉只有獨立考試
        // 才顯示，combo（有同層錄音）永遠鎖死成一個手打文字格，逼老師自己猜活頁檔名（猜錯也沒
        // 驗證）。改成不管 combo／獨立，「教材資料夾」下拉一律顯示（列出這個老師／班級曾經
        // 發布過、有 meta 的所有教材資料夾——也就是「這個班級用過的教材」），預設值猜同層錄音
        // 用的那個資料夾（若抓得到），老師隨時可以自己改選；「活頁」欄位一律依這個選定的資料夾
        // 查真正的 meta 檔名清單做下拉，不再讓老師手打。
        const comboFirstRef = (siblingAudio && siblingAudio.raw_data && Array.isArray(siblingAudio.raw_data.material_refs))
            ? siblingAudio.raw_data.material_refs[0] : null;
        // 💣 materials_root_kind 是存在每一筆 material_refs[i] 裡（不是 task.raw_data 底下直接一個欄位，
        // 曾經因為讀錯位置永遠拿到 undefined 而整組判斷失效，見 feature-timeline.js 的存放方式）
        const comboRootKind = (comboFirstRef && comboFirstRef.materials_root_kind === 'class') ? 'class' : 'teacher';
        const comboMaterialFolder = layoutMaterialFolder;
        // examMaterialSelf 是老師「明確選過」的值（存在 task.raw_data.exam_material）；沒選過時
        // 才退回同層錄音猜的資料夾當預設顯示值（純顯示用的猜測，老師一改選就會變成明確值）。
        const effectiveMaterialFolder = examMaterialSelf.material_folder || comboMaterialFolder;
        const effectiveRootKind = examMaterialSelf.material_folder ? examMaterialSelf.root_kind : comboRootKind;
        const effectiveMaterialSelf = { material_folder: effectiveMaterialFolder, root_kind: effectiveRootKind };

        // 教材資料夾下拉：優先吃 FeatureTimeline 已快取的清單（跟錄音 Material Snapshot 共用同一份快取，
        // 見 exam-standalone-material-invariant.mdc），沒快取才在渲染後非同步補抓，避免老師手打資料夾名稱
        let materialFolderTeacherEntry = null;
        let materialFolderClassEntry = null;
        if (window.FeatureTimeline && typeof window.FeatureTimeline.getMetaCatalogEntry === 'function') {
            materialFolderTeacherEntry = window.FeatureTimeline.getMetaCatalogEntry(currentClassId, 'teacher');
            materialFolderClassEntry = window.FeatureTimeline.getMetaCatalogEntry(currentClassId, 'class');
        }
        const materialFolderCatalogLoaded = !!(materialFolderTeacherEntry || materialFolderClassEntry);
        if (!materialFolderCatalogLoaded) {
            // 渲染函式只回字串，DOM 還沒插入；下一輪事件圈再補抓＋補畫，避免抓到不存在的元素
            setTimeout(function () { ensureExamMaterialFolderCatalog(pathStr, currentClassId, false); }, 0);
        }
        // 選了教材資料夾才能推出「活頁」候選清單；還沒選或清單未載入時 examSheetStems 是空陣列，
        // 退回原本的文字輸入（見下方 rows 組裝），避免顯示一個永遠空的下拉
        sections.forEach(function (sec) {
            const resolvedCombo = resolveSectionCombo(currentClassId, sec);
            if (resolvedCombo) {
                applyComboToSection(sec, resolvedCombo);
                if (!underComboPack) syncSectionSegmentsToOwnFiles(sec, resolvedCombo);
            }
            const secCombo = resolveSectionCombo(currentClassId, sec);
            const secFolder = String((secCombo && secCombo.folderName) || sec.material_folder || '').trim();
            const secKind = (secCombo && secCombo.rootKind === 'class')
                ? 'class'
                : (sec.material_root_kind === 'class' ? 'class' : 'teacher');
            const secMetaOpts = secCombo ? metaOptionsForCombo(currentClassId, secCombo) : [];
            const secFolderReady = !!secFolder;
            if (secFolderReady && !underComboPack) {
                sec.segments = seedSectionsAfterFolderReady(
                    sec.segments,
                    _forcedStandaloneForFill ? null : siblingAudio,
                    secMetaOpts,
                    assignedTemplateId
                );
            }
            (sec.segments || []).forEach(function (s) {
                if (sec.combination_id && !s.combination_id) s.combination_id = sec.combination_id;
                if (!underComboPack) healExamSectionSheet(s, secMetaOpts);
                if (!_forcedStandaloneForFill && !underComboPack) healSegmentMetaFromAudio(s, siblingAudio);
                attachCatalogMetaToSection(currentClassId, secKind, secFolder, s);
                if (s && (s.sheet_id || s.meta_file_name) && officialPairingCacheReady()) {
                    const nextTpl = examTemplateIdForCombo(secCombo, s.layout_profile_id);
                    s.layout_profile_id = nextTpl;
                    const pairProfile = nextTpl ? resolveExamTemplateProfile(nextTpl) : null;
                    if (pairProfile && Number(pairProfile.lines_per_page) > 0) {
                        if (!underComboPack || !(Number(s.lines_per_page) > 0)) {
                            s.lines_per_page = Number(pairProfile.lines_per_page);
                        }
                    }
                }
            });
        });
        if (task.raw_data && task.raw_data.exam_job) {
            task.raw_data.exam_job.sections = sections;
        }

        let totalCountSum = 0;
        const sectionCardsHtml = sections.map(function (sec, secIdx) {
            const secCombo = resolveSectionCombo(currentClassId, sec);
            const secFolder = String((secCombo && secCombo.folderName) || sec.material_folder || effectiveMaterialFolder || '').trim();
            const secKind = (secCombo && secCombo.rootKind === 'class')
                ? 'class'
                : (sec.material_folder
                    ? (sec.material_root_kind === 'class' ? 'class' : 'teacher')
                    : effectiveRootKind);
            const secMetaOpts = secCombo ? metaOptionsForCombo(currentClassId, secCombo) : [];
            const secFolderReady = !!secCombo;
            const secComboOptsHtml = buildExamComboOptionsHtml(currentClassId, sec);
            let secCountSum = 0;
            const rows = (sec.segments || []).map(function (s, segIdx) {
            const idx = secIdx + '-' + segIdx;
            const rowLayoutId = String(s.layout_profile_id || '').trim();
            const rowProfileForLpp = rowLayoutId ? resolveExamTemplateProfile(rowLayoutId) : null;
            const rowTemplateLpp = (rowProfileForLpp && Number(rowProfileForLpp.lines_per_page) > 0)
                ? Number(rowProfileForLpp.lines_per_page) : DEFAULT_LINES_PER_PAGE;
            const displayLpp = resolveSectionLpp(s, rowTemplateLpp);
            const expected = expectedSlotsForSection(s, rowTemplateLpp);
            let avail = countAvailableFromMeta(s, task, secFolder);
            // 可用題＝範圍內每一頁的實際題數加總（最後一頁常不滿行）。
            // 禁止用「頁數 × 每頁行數」充當可用題。
            const availIsEstimate = false;
            const countVal = Number(s.count);
            if (!isNaN(countVal)) {
                totalCountSum += countVal;
                secCountSum += countVal;
            }
            const cachedRowsEarly = lookupSectionMetaRows((task && task.raw_data && task.raw_data.meta_rows_by_stem) || {}, s);
            const missingPage = !!(s.meta_missing_page) || metaCannotFilterByPage(s, cachedRowsEarly);
            if (missingPage) avail = null;
            const availStr = missingPage ? '無page欄' : ((avail != null && avail >= 0) ? String(avail) : '需讀取');
            const pctStr = missingPage ? '—' : formatDisplayPercent(s.count, avail);
            const overAvail = !missingPage && (avail != null && avail >= 0 && !isNaN(countVal) && countVal > avail);

            // 必考#（include_nums）：範圍內找不到的題號要標紅，避免老師以為已生效
            let missingInc = [];
            if (!availIsEstimate && String(s.include_nums || '').trim()) {
                const metaByStem = (task && task.raw_data && task.raw_data.meta_rows_by_stem) || null;
                const rowsForSheet = metaByStem
                    ? (lookupRowsBySheetId(metaByStem, s.sheet_id) || lookupRowsBySheetId(metaByStem, s.meta_file_name))
                    : null;
                if (Array.isArray(rowsForSheet) && rowsForSheet.length) {
                    missingInc = missingIncludeNums(s, rowsForSheet);
                }
            }
            const incStyle = missingInc.length
                ? 'width:64px; padding:4px; border-color:#EF4444; color:#B91C1C; font-weight:800;'
                : 'width:64px; padding:4px;';
            const incTitle = missingInc.length
                ? ('必考題號 ' + missingInc.join(',') + ' 在此範圍內找不到對應 meta，不會出現在考卷中，請確認題號或起迄範圍')
                : '必考題號（範圍內一定會出現；用逗號或~區隔，如 141~145,150）。剩餘題數才從範圍內隨機抽。';
            const incSet = parseNumListLocal(s.include_nums);
            const mandatoryCount = incSet ? Object.keys(incSet).length : 0;
            const mandatoryOverCount = mandatoryCount > 0 && !isNaN(countVal) && mandatoryCount > countVal;
            const countStyle = overAvail
                ? 'width:56px; padding:4px; border-color:#EF4444; color:#B91C1C; font-weight:800;'
                : (mandatoryOverCount
                    ? 'width:56px; padding:4px; border-color:#D97706; color:#92400E; font-weight:800;'
                    : 'width:56px; padding:4px;');
            const countTitle = overAvail
                ? '題數超過可用題數'
                : (mandatoryOverCount
                    ? ('必考題號共 ' + mandatoryCount + ' 題，超過此處設定的題數，產生時會自動全部納入（實際題數＝' + mandatoryCount + '）')
                    : '');

            const rtypeHint = s.range_type || 'page';
            const loHint = Math.min(Number(s.start) || 0, Number(s.end) || 0);
            const hiHint = Math.max(Number(s.start) || 0, Number(s.end) || 0);
            const cachedRows = cachedRowsEarly;
            const filePages = summarizeMetaPages(cachedRows);
            const fileKeys = describeMetaRowKeys(cachedRows);
            const availTitle = missingPage
                ? ('這份 meta 發布時沒有帶入 page（現有欄位：' + (fileKeys || '—') + '；共 ' + ((cachedRows && cachedRows.length) || 0) + ' 列）。請到教材發布把 Excel 的頁碼欄對成 page 後重新上傳，才能用 238～242 這種頁碼篩題。')
                : ((avail != null && avail >= 0)
                    ? ((avail === 0 && filePages)
                        ? ('範圍 ' + loHint + '～' + hiHint + ' 沒有列。這個 meta 檔內的頁碼是 ' + filePages)
                        : ((rtypeHint === 'qnum')
                            ? ('題號 ' + loHint + '~' + hiHint + ' 內的實際題數＝' + avail)
                            : ('範圍內每一頁實際題數加總＝' + avail + '（最後一頁可能不滿 ' + displayLpp + ' 行）')))
                    : '還沒讀到各頁實際題數；選好活頁後會自動讀，或按「🔄 讀取可用題數」');
            const availColor = missingPage ? '#B45309' : ((avail == null) ? '#D97706' : (avail === 0 ? '#B91C1C' : '#0F766E'));
            const refreshAttr = ' onchange="window.FeatureExamJob._inlineRefreshAvail(\'' + pathStr + '\')"';
            const sheetCell = examBlockCellHtml(pathStr, idx, secIdx, segIdx, s, secCombo);
            const delSeg = (sec.segments || []).length > 1
                ? ('<button type="button" class="btn" style="padding:4px 8px; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5;" title="刪這個區塊"'
                    + ' onclick="window.FeatureExamJob._inlineRemoveSegment(\'' + pathStr + '\', ' + secIdx + ', ' + segIdx + ')">刪</button>')
                : '';
            return '<div class="exam-inline-row" data-exam-inline-row="' + idx + '">'
                + '<div>' + sheetCell
                + '<input type="hidden" id="exam-inline-sectionlayout-' + pathStr + '-' + idx + '" value="' + esc(rowLayoutId) + '">'
                + '</div>'
                + '<select id="exam-inline-rtype-' + pathStr + '-' + idx + '" class="form-control"' + refreshAttr + '>'
                + '<option value="page"' + ((s.range_type || 'page') === 'page' ? ' selected' : '') + '>頁碼</option>'
                + '<option value="qnum"' + (s.range_type === 'qnum' ? ' selected' : '') + '>題號</option>'
                + '<option value="row"' + (s.range_type === 'row' ? ' selected' : '') + '>資料列</option>'
                + '</select>'
                + '<input id="exam-inline-start-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + esc(s.start) + '"' + refreshAttr + '>'
                + '<input id="exam-inline-end-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + esc(s.end) + '"' + refreshAttr + '>'
                + '<input id="exam-inline-lpp-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + esc(displayLpp) + '" title="沿用這一列試卷範本的每頁行數"' + refreshAttr + '>'
                + '<input id="exam-inline-diff-' + pathStr + '-' + idx + '" class="form-control asg-num" value="' + esc(s.difficulty || '') + '" placeholder="—">'
                + '<input id="exam-inline-inc-' + pathStr + '-' + idx + '" class="form-control asg-num" value="' + esc(s.include_nums || '') + '" style="' + incStyle + '" placeholder="—" title="' + esc(incTitle) + '"' + refreshAttr + '>'
                + '<input id="exam-inline-exc-' + pathStr + '-' + idx + '" class="form-control asg-num" value="' + esc(s.exclude_nums || '') + '" placeholder="—" title="排除題號：範圍內這些題號一定不會出現"' + refreshAttr + '>'
                + '<input id="exam-inline-count-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + esc(s.count) + '" style="' + countStyle + '" title="' + esc(countTitle) + '"' + refreshAttr + '>'
                + '<div style="color:' + availColor + '; font-weight:800;" title="' + esc(availTitle) + '">' + esc(availStr) + '</div>'
                + '<div style="color:#64748B;">' + esc(pctStr) + '</div>'
                + '<div>' + delSeg + '</div>'
                + '</div>';
            }).join('');
            const comboName = (secCombo && secCombo.label)
                || String((sec && sec.combination_id) || '').trim()
                || '（上方組合尚未選套餐）';
            const comboPickerHtml = underComboPack
                ? ('<div style="flex:1 1 240px; min-width:200px;">'
                    + '<label style="display:block; font-size:0.85rem; font-weight:800; color:#334155; margin-bottom:4px;">套餐</label>'
                    + '<div style="font-weight:800; color:#1E3A8A; padding:6px 0;">' + esc(comboName) + '</div></div>')
                : ('<div style="flex:1 1 240px; min-width:200px;">'
                    + '<label style="display:block; font-size:0.85rem; font-weight:800; color:#334155; margin-bottom:4px;">套餐'
                    + (secIdx === 0 && isStandaloneExam ? '（獨立考試）' : '') + '</label>'
                    + '<select id="exam-inline-materialfolder-' + pathStr + '-' + secIdx + '" class="form-control" style="width:100%; padding:6px;"'
                    + ' onchange="window.FeatureExamJob._inlineOnExamMaterialFolderSelectChange(\'' + pathStr + '\', ' + secIdx + ')">'
                    + secComboOptsHtml + '</select></div>');
            return `
                <div class="exam-section-card" data-exam-section="${secIdx}" style="margin-top:10px; padding:10px; border:1px dashed #93C5FD; border-radius:8px; background:#F8FAFC;">
                    <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">
                        ${comboPickerHtml}
                        <span style="font-weight:800; color:#134E4A; padding-bottom:6px;">考題 ${secCountSum}</span>
                        ${underComboPack ? '' : `
                        <button type="button" class="btn" style="padding:4px 8px; font-size:0.72rem; background:#EFF6FF; border:1px solid #93C5FD; border-radius:4px; color:#1D4ED8; font-weight:800;"
                            onclick="window.FeatureExamJob._inlineReloadMaterialFolders('${pathStr}')"
                            title="剛建立的套餐沒看到就按這個重新整理">🔄 重新整理清單</button>
                        ${sections.length > 1 ? `
                        <button type="button" class="btn" style="padding:4px 8px; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; font-weight:800;"
                            title="刪這份套餐" onclick="window.FeatureExamJob._inlineRemoveExamSection('${pathStr}', ${secIdx})">刪套餐</button>
                        ` : ''}
                        `}
                    </div>
                    ${(siblingAudio && forcedStandalone && secIdx === 0) ? `
                    <div style="margin-top:8px; font-size:0.72rem; color:#9A3412;">
                        （已忽略同層錄音任務「${esc(stripHtml((siblingAudio.title || '')) || '（未命名）')}」，改用下面自訂的教材來源。
                        <button type="button" class="btn" style="padding:1px 6px; font-size:0.72rem; background:white; border:1px solid #FDBA74; border-radius:4px; color:#9A3412; margin-left:2px;"
                            onclick="window.FeatureExamJob._inlineToggleForceStandalone('${pathStr}', false)">↩️ 改回沿用同層錄音</button>）
                    </div>
                    ` : ''}
                    <div id="exam-inline-materialfolder-status-${pathStr}-${secIdx}" style="min-height:1.1em; font-size:0.72rem; color:#64748B;">${officialPairingCacheReady() ? '' : '⏳ 載入套餐…'}</div>
                    <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:4px; font-weight:700; align-items:center; color:#334155;">
                        <label><input id="exam-inline-shuffle-${pathStr}-${secIdx}" type="checkbox" ${sec.shuffle === false ? '' : 'checked'}> 題目洗牌</label>
                        <label title="學生對錯題可以勾選「申訴答案」。此段可與其他段落不同。">
                            <input id="exam-inline-allow-appeal-${pathStr}-${secIdx}" type="checkbox" ${sec.allow_answer_appeal === false ? '' : 'checked'}>
                            🚩 允許申訴答案
                        </label>
                    </div>
                    ${underComboPack ? `
                    <div style="margin-top:8px; color:#64748B; font-weight:700;">範圍與選題在上方組合。這裡只做考試自己的事。</div>
                    ` : (!secFolderReady ? `
                    <div style="margin-top:8px; color:#9A3412; font-weight:700;">選套餐後會自動列出區塊</div>
                    ` : ('<div class="exam-seg-table">'
                    + '<div class="exam-seg-head">'
                    + '<div>區塊</div><div>基準</div><div>起</div><div>迄</div><div>每頁行數</div><div>難度</div><div>必考#</div><div>排除#</div><div>題數</div><div>可用題</div><div>顯示%</div><div></div>'
                    + '</div>'
                    + rows
                    + '</div>'
                    + '<div style="margin-top:8px;">'
                    + '<button type="button" class="btn" style="padding:4px 10px; background:#ECFDF5; color:#047857; border:1px solid #6EE7B7; font-weight:800;"'
                    + ' onclick="window.FeatureExamJob._inlineAddSegment(\'' + pathStr + '\', ' + secIdx + ')"'
                    + ' title="同一套餐要另一段範圍就按這個">＋ 增加區塊</button>'
                    + '</div>'))}
                </div>
            `;
        }).join('');

        const html = `
            <div id="exam-inline-wrap-${pathStr}" class="exam-inline-wrap asg-unify" style="margin-top:8px; padding:12px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; color:#0F766E;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                    <strong>📝 考試出題</strong>
                    ${(!isStandaloneExam && !underComboPack) ? `
                    <button type="button" class="btn" style="padding:4px 12px; background:#EFF6FF; color:#1D4ED8; border:1px solid #93C5FD; font-weight:800;"
                        title="把上面組合包的套餐、區塊、基準、起迄帶到這份試卷"
                        onclick="window.FeatureExamJob._inlineImportFromRangePack('${pathStr}')">帶入</button>
                    ` : ''}
                    <span style="color:#64748B;">job_id：<code id="exam-inline-jobid-${pathStr}">${esc(jobId || '（儲存作業時產生）')}</code></span>
                </div>
                ${(siblingAudio && !forcedStandalone) ? `
                <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:0.78rem; color:#1E40AF;">
                    🔗 偵測到同層有錄音任務「${esc(stripHtml((siblingAudio.title || '')) || '（未命名）')}」，這份考試預設會沿用它的教材／活頁。
                    如果這份考試其實跟它無關（例如另開的獨立小考）：
                    <button type="button" class="btn" style="padding:2px 8px; font-size:0.72rem; background:#DBEAFE; border:1px solid #93C5FD; border-radius:4px; color:#1E40AF; margin-left:4px;"
                        onclick="window.FeatureExamJob._inlineToggleForceStandalone('${pathStr}', true)">🔓 改成獨立教材來源</button>
                </div>
                ` : ''}
                <input type="hidden" id="exam-inline-layout-${pathStr}" value="${esc(layoutId)}">
                <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:8px; font-weight:700; align-items:center;">
                    <label title="整份卷全部打散，PIC／WORD、各區塊都不要成塊。沒勾＝各段仍照你排的順序，段內才看「題目洗牌」。">
                        <input id="exam-inline-shuffle-sections-${pathStr}" type="checkbox" ${(job.options && job.options.shuffle_sections) ? 'checked' : ''}> 整卷洗牌
                    </label>
                    <label title="學生交卷後，若有錯題，可自己選擇要不要當下或之後重考一次錯的題目（原題原答案，只能重考一次），交卷後會產生合併正確率的整體報告。">
                        <input id="exam-inline-allow-retake-${pathStr}" type="checkbox" ${raw.allow_wrong_retake ? 'checked' : ''}>
                        🔁 允許重考錯題（僅一次）
                    </label>
                </div>
                <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:8px; font-weight:700; align-items:center; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:8px 10px;">
                    <label title="整份考卷變成打字練習：答案直接顯示（紅字），學生照打，逐字比對，打錯無法往下一字，需連續打對指定次數才算完成該題（沒有另外的一般作答步驟）。">
                        <input id="exam-inline-input-practice-${pathStr}" type="checkbox" ${raw.input_practice_enabled ? 'checked' : ''}
                            onchange="window.FeatureExamJob._inlineToggleInputPracticeCount && window.FeatureExamJob._inlineToggleInputPracticeCount('${pathStr}')">
                        ✍️ 輸入練習
                    </label>
                    <span id="exam-inline-input-practice-count-wrap-${pathStr}" style="${raw.input_practice_enabled ? '' : 'display:none;'}">
                        次數：<input id="exam-inline-input-practice-count-${pathStr}" type="number" min="1" step="1"
                            value="${Number(raw.input_practice_count) > 0 ? Number(raw.input_practice_count) : 1}"
                            style="width:56px; padding:2px 4px;">
                    </span>
                    <label title="交卷後，針對答錯的題目做打字改正練習：答案顯示（紅字），學生逐字打對指定次數才算完成該題改正（與重考錯題／申訴答案互不影響）。">
                        <input id="exam-inline-input-correction-${pathStr}" type="checkbox" ${raw.input_correction_enabled ? 'checked' : ''}
                            onchange="window.FeatureExamJob._inlineToggleInputPracticeCount && window.FeatureExamJob._inlineToggleInputPracticeCount('${pathStr}')">
                        🔧 輸入改正（錯題）
                    </label>
                    <span id="exam-inline-input-correction-count-wrap-${pathStr}" style="${raw.input_correction_enabled ? '' : 'display:none;'}">
                        次數：<input id="exam-inline-input-correction-count-${pathStr}" type="number" min="1" step="1"
                            value="${Number(raw.input_correction_count) > 0 ? Number(raw.input_correction_count) : 1}"
                            style="width:56px; padding:2px 4px;">
                    </span>
                </div>
                ${sectionCardsHtml}
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center;">
                    ${underComboPack ? '' : `
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#A7F3D0; color:#065F46; border:1px solid #6EE7B7;"
                        onclick="window.FeatureExamJob._inlineAddExamSection('${pathStr}')"
                        title="不同擷取請另加一套餐">＋ 增加套餐</button>
                    ${getCachedLastConfigForClass(currentClassId) ? `
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#EDE9FE; color:#5B21B6; border:1px solid #DDD6FE;"
                        onclick="window.FeatureExamJob._inlineApplyLastConfig('${pathStr}')"
                        title="只帶入上次的套餐／範圍／範本。這是新卷，不會沿用舊卷號；確認後請按「產生試卷」。">📋 套用上次設定（本班）</button>
                    ` : ''}
                    `}
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;"
                        onclick="window.FeatureExamJob._inlineRefreshStandaloneMeta('${pathStr}')">🔄 讀取可用題數</button>
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#059669; color:white; border:none;"
                        onclick="window.FeatureExamJob._inlineExport('${pathStr}')">⬇ JSON</button>
                    <span style="margin-left:auto; font-weight:800; color:${paperHintColor}; font-size:0.85rem;">總計考題 ${totalCountSum}${paperCountHint}</span>
                </div>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button type="button" class="btn btn-action" style="flex:1; box-sizing:border-box; padding:4px 10px; background:#B91C1C; color:white; border:none;"
                        title="依目前活頁／範圍／範本重新抽題出卷。會換題，舊作答可能對不上。"
                        onclick="window.FeatureExamJob._inlineGeneratePaperNow('${pathStr}')">📝 產生試卷</button>
                    <button type="button" class="btn btn-action" style="flex:1; box-sizing:border-box; padding:4px 10px; background:#0369A1; color:white; border:none;"
                        title="維持現有題目與順序，只依目前試卷範本重算標準答案，再重批已交卷學生。"
                        onclick="window.FeatureExamJob._inlineRegradeExistingPaper('${pathStr}')">🔄 重新批改</button>
                </div>
                <div id="exam-inline-gen-status-${pathStr}" style="${generateStatusBoxStyle(savedGenStatus && savedGenStatus.text ? savedGenStatus.tone : '')}">${esc((savedGenStatus && savedGenStatus.text) || '')}</div>
            </div>
        `;
        maybeAutoFetchAvail(pathStr, task, flattenExamSegments(sections));
        return html;
    }

    function readFolderSelectValue(pathStr, secIdx, fallback) {
        fallback = fallback || {};
        const selectEl = document.getElementById('exam-inline-materialfolder-' + pathStr + '-' + secIdx)
            || (secIdx === 0 ? document.getElementById('exam-inline-materialfolder-' + pathStr) : null);
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        if (!selectEl) {
            return {
                folder: String(fallback.material_folder || '').trim(),
                kind: fallback.material_root_kind === 'class' ? 'class' : 'teacher',
                combinationId: String(fallback.combination_id || '').trim()
            };
        }
        const selVal = String(selectEl.value || '');
        let folder = '';
        let kind = fallback.material_root_kind === 'class' ? 'class' : 'teacher';
        let combinationId = '';
        if (selVal === '__manual__') {
            const manualEl = document.getElementById('exam-inline-materialfolder-manual-' + pathStr + '-' + secIdx)
                || document.getElementById('exam-inline-materialfolder-manual-' + pathStr);
            folder = manualEl ? String(manualEl.value || '').trim() : '';
        } else if (isComboId(selVal)) {
            combinationId = selVal;
            const combo = lookupAssignedCombo(classId, selVal);
            if (combo) {
                folder = String(combo.folderName || '').trim();
                kind = combo.rootKind === 'class' ? 'class' : 'teacher';
            } else {
                folder = String(fallback.material_folder || '').trim();
            }
        } else if (selVal) {
            const sep = selVal.indexOf('::');
            if (sep >= 0) {
                kind = selVal.slice(0, sep) === 'class' ? 'class' : 'teacher';
                folder = selVal.slice(sep + 2).trim();
            }
        }
        return { folder: folder, kind: kind, combinationId: combinationId };
    }

    function readInlineSegmentFromDom(pathStr, idx, prev, folderForMeta, kindForMeta, combo) {
        const task = getBuilderTaskByPath(pathStr);
        const sheetEl = document.getElementById('exam-inline-sheet-' + pathStr + '-' + idx);
        let sheet = sheetEl ? sheetEl.value : '';
        if (sheet === '__manual__') {
            const sheetManualEl = document.getElementById('exam-inline-sheet-manual-' + pathStr + '-' + idx);
            sheet = sheetManualEl ? sheetManualEl.value : '';
        }
        const lpp = Number((document.getElementById('exam-inline-lpp-' + pathStr + '-' + idx) || {}).value);
        const rtype = (document.getElementById('exam-inline-rtype-' + pathStr + '-' + idx) || {}).value || 'page';
        const start = Number((document.getElementById('exam-inline-start-' + pathStr + '-' + idx) || {}).value);
        const end = Number((document.getElementById('exam-inline-end-' + pathStr + '-' + idx) || {}).value);
        const count = Number((document.getElementById('exam-inline-count-' + pathStr + '-' + idx) || {}).value);
        const difficulty = String((document.getElementById('exam-inline-diff-' + pathStr + '-' + idx) || {}).value || '').trim();
        const include_nums = String((document.getElementById('exam-inline-inc-' + pathStr + '-' + idx) || {}).value || '').trim();
        const exclude_nums = String((document.getElementById('exam-inline-exc-' + pathStr + '-' + idx) || {}).value || '').trim();
        const sectionLayoutId = String((document.getElementById('exam-inline-sectionlayout-' + pathStr + '-' + idx) || {}).value || '').trim();
        const bStateForMeta = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classIdForMeta = (bStateForMeta && bStateForMeta.classId) || '';
        const pickedOpt = metaOptionFromCombo(classIdForMeta, combo, sheet)
            || resolvePickedMetaOption(classIdForMeta, kindForMeta, folderForMeta, sheet, prev);
        let sheetId = String(sheet).trim();
        if (pickedOpt) {
            const sameFile = prev && (
                String(prev.meta_file_name || '') === String(pickedOpt.fileName || '')
                || String(prev.sheet_id || '').trim() === sheetId
            );
            if (sameFile && prev.sheet_id) {
                sheetId = String(prev.sheet_id).trim();
            } else if (/\.meta\.json$/i.test(sheetId) || sheetId === pickedOpt.fileName) {
                sheetId = fullMetaStem(pickedOpt.fileName);
            }
        } else if (/\.meta\.json$/i.test(sheetId)) {
            sheetId = fullMetaStem(sheetId);
        }
        const sec = {
            sheet_id: sheetId,
            range_type: rtype,
            start: start,
            end: end,
            count: count,
            lines_per_page: isNaN(lpp) || lpp <= 0 ? DEFAULT_LINES_PER_PAGE : lpp
        };
        if (pickedOpt) {
            sec.meta_file_name = pickedOpt.fileName || '';
            sec.meta_file_id = pickedOpt.fileId || '';
        } else if (/\.meta\.json$/i.test(String(sheet || '').trim())) {
            sec.meta_file_name = String(sheet).trim();
        } else if (prev && (prev.meta_file_name || prev.meta_file_id)
            && String(prev.sheet_id || '').toUpperCase() === String(sec.sheet_id || '').toUpperCase()) {
            if (prev.meta_file_name) sec.meta_file_name = prev.meta_file_name;
            if (prev.meta_file_id) sec.meta_file_id = prev.meta_file_id;
        }
        if (difficulty) sec.difficulty = difficulty;
        if (include_nums) sec.include_nums = include_nums;
        if (exclude_nums) sec.exclude_nums = exclude_nums;
        if (sectionLayoutId) sec.layout_profile_id = sectionLayoutId;
        delete sec.available_count;
        delete sec.meta_missing_page;
        if (prev
            && String(prev.sheet_id || '').toUpperCase() === String(sec.sheet_id || '').toUpperCase()
            && (prev.range_type || 'page') === rtype
            && Number(prev.start) === start
            && Number(prev.end) === end) {
            if (Array.isArray(prev.pages) && prev.pages.length) sec.pages = prev.pages.slice();
            if (Array.isArray(prev.items) && prev.items.length) sec.items = prev.items.slice();
            if (prev.range_spec) sec.range_spec = prev.range_spec;
        }
        return sec;
    }

    function readInlineSections(pathStr) {
        const task = getBuilderTaskByPath(pathStr);
        const prevJob = (task && task.raw_data && task.raw_data.exam_job) || {};
        const prevSecs = normalizeExamSections(prevJob.sections, {
            material_folder: (task && task.raw_data && task.raw_data.exam_material && task.raw_data.exam_material.material_folder) || '',
            material_root_kind: (task && task.raw_data && task.raw_data.exam_material && task.raw_data.exam_material.root_kind) || 'teacher'
        });
        const cards = document.querySelectorAll('#exam-inline-wrap-' + pathStr + ' .exam-section-card');
        if (!cards.length) return prevSecs;
        if (isExamUnderComboPack(pathStr, task)) {
            syncExamFromParentPack(pathStr, task);
            const synced = normalizeExamSections((task.raw_data && task.raw_data.exam_job && task.raw_data.exam_job.sections) || prevSecs, {
                material_folder: (task && task.raw_data && task.raw_data.exam_material && task.raw_data.exam_material.material_folder) || '',
                material_root_kind: (task && task.raw_data && task.raw_data.exam_material && task.raw_data.exam_material.root_kind) || 'teacher'
            });
            cards.forEach(function (card) {
                const secIdx = Number(card.getAttribute('data-exam-section'));
                const sec = synced[secIdx];
                if (!sec) return;
                const shuffleEl = document.getElementById('exam-inline-shuffle-' + pathStr + '-' + secIdx);
                const appealEl = document.getElementById('exam-inline-allow-appeal-' + pathStr + '-' + secIdx);
                if (shuffleEl) sec.shuffle = !!shuffleEl.checked;
                if (appealEl) sec.allow_answer_appeal = !!appealEl.checked;
            });
            return synced;
        }
        const sections = [];
        const bStateRead = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classIdRead = (bStateRead && bStateRead.classId) || '';
        cards.forEach(function (card) {
            const secIdx = Number(card.getAttribute('data-exam-section'));
            const folderInfo = readFolderSelectValue(pathStr, secIdx, prevSecs[secIdx] || emptySection());
            const prevSec = (folderInfo.combinationId
                && prevSecs.find(function (s) {
                    return String((s && s.combination_id) || '') === String(folderInfo.combinationId);
                }))
                || prevSecs[secIdx]
                || emptySection();
            const combo = folderInfo.combinationId
                ? lookupAssignedCombo(classIdRead, folderInfo.combinationId)
                : null;
            const shuffleEl = document.getElementById('exam-inline-shuffle-' + pathStr + '-' + secIdx);
            const appealEl = document.getElementById('exam-inline-allow-appeal-' + pathStr + '-' + secIdx);
            const rows = card.querySelectorAll('[data-exam-inline-row]');
            const segments = [];
            rows.forEach(function (row) {
                const idx = row.getAttribute('data-exam-inline-row');
                const parts = String(idx || '').split('-');
                const segIdx = Number(parts[parts.length - 1]);
                const prevSeg = (prevSec.segments || [])[segIdx];
                segments.push(readInlineSegmentFromDom(pathStr, idx, prevSeg, folderInfo.folder, folderInfo.kind, combo));
            });
            sections.push({
                id: prevSec.id || newSectionId(),
                material_folder: folderInfo.folder,
                material_root_kind: folderInfo.kind,
                combination_id: folderInfo.combinationId || prevSec.combination_id || '',
                shuffle: shuffleEl ? !!shuffleEl.checked : prevSec.shuffle !== false,
                allow_answer_appeal: appealEl ? !!appealEl.checked : prevSec.allow_answer_appeal !== false,
                segments: segments.length ? segments : [emptySegment()]
            });
        });
        return sections;
    }

    function syncInlineEditor(pathStr, task) {
        if (!task) return;
        if (!task.raw_data) task.raw_data = {};
        const layoutEl = document.getElementById('exam-inline-layout-' + pathStr);
        if (!layoutEl) return; // 非 exam 或尚未渲染

        const prevJob = task.raw_data.exam_job || {};
        const jobId = task.raw_data.exam_job_id || prevJob.job_id || '';

        // 輸出管道之後再做 UI；目前固定線上卷，只暴露 shuffle
        const outputs = Array.isArray(prevJob.outputs) && prevJob.outputs.length
            ? prevJob.outputs.filter(function (o) { return o && o !== 'answer'; })
            : ['online'];
        if (outputs.indexOf('online') === -1) outputs.unshift('online');

        const hasCards = !!document.querySelector('#exam-inline-wrap-' + pathStr + ' .exam-section-card');
        const sections = hasCards
            ? readInlineSections(pathStr)
            : normalizeExamSections(prevJob.sections, {
                material_folder: (task.raw_data.exam_material && task.raw_data.exam_material.material_folder) || '',
                material_root_kind: (task.raw_data.exam_material && task.raw_data.exam_material.root_kind) || 'teacher'
            });
        const shuffleSectionsEl = document.getElementById('exam-inline-shuffle-sections-' + pathStr);
        const shuffleSections = shuffleSectionsEl
            ? !!shuffleSectionsEl.checked
            : !!(prevJob.options && prevJob.options.shuffle_sections);
        const payload = {
            job_id: jobId,
            bank_id: prevJob.bank_id || (BANK_CATALOG[0] ? BANK_CATALOG[0].id : ''),
            layout_profile_id: layoutEl ? layoutEl.value : '',
            sections: sections,
            outputs: outputs,
            options: { shuffle_sections: shuffleSections, force_qnum: true, separate_pages: false }
        };
        if (!payload.layout_profile_id) {
            const firstSeg = flattenExamSegments(sections).find(function (s) { return s && s.layout_profile_id; });
            if (firstSeg) payload.layout_profile_id = firstSeg.layout_profile_id;
        }
        task.raw_data.exam_job_id = jobId;
        task.raw_data.exam_title = String(task.title || '').replace(/<[^>]*>?/gm, '').trim() || task.raw_data.exam_title || '';
        task.raw_data.exam_job = payload;
        const allowRetakeEl = document.getElementById('exam-inline-allow-retake-' + pathStr);
        if (allowRetakeEl) task.raw_data.allow_wrong_retake = !!allowRetakeEl.checked;
        task.raw_data.allow_answer_appeal = sections.some(function (s) { return s && s.allow_answer_appeal !== false; });
        // ✍️ 輸入練習／🔧 輸入改正：整份考卷設定，見 docs 對話紀錄「逐字要求完全一致」。
        const inputPracticeEl = document.getElementById('exam-inline-input-practice-' + pathStr);
        if (inputPracticeEl) task.raw_data.input_practice_enabled = !!inputPracticeEl.checked;
        const inputPracticeCountEl = document.getElementById('exam-inline-input-practice-count-' + pathStr);
        if (inputPracticeCountEl) task.raw_data.input_practice_count = Math.max(1, parseInt(inputPracticeCountEl.value, 10) || 1);
        const inputCorrectionEl = document.getElementById('exam-inline-input-correction-' + pathStr);
        if (inputCorrectionEl) task.raw_data.input_correction_enabled = !!inputCorrectionEl.checked;
        const inputCorrectionCountEl = document.getElementById('exam-inline-input-correction-count-' + pathStr);
        if (inputCorrectionCountEl) task.raw_data.input_correction_count = Math.max(1, parseInt(inputCorrectionCountEl.value, 10) || 1);
        const jobIdEl = document.getElementById('exam-inline-jobid-' + pathStr);
        if (jobIdEl) jobIdEl.textContent = jobId;

        if (sections[0] && sections[0].material_folder) {
            task.raw_data.exam_material = {
                material_folder: sections[0].material_folder,
                root_kind: sections[0].material_root_kind === 'class' ? 'class' : 'teacher'
            };
        }
        applyExamTitleFromRange(pathStr, task);
        return payload;
    }

    function getBuilderTaskByPath(pathStr) {
        if (!window.BuilderStore || typeof window.BuilderStore.getState !== 'function') return null;
        const bState = window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks)) return null;
        const arr = String(pathStr).split('-').map(Number);
        let list = bState.tasks;
        let node = null;
        for (let i = 0; i < arr.length; i++) {
            node = list[arr[i]];
            if (!node) return null;
            if (i < arr.length - 1) list = node.subTasks || [];
        }
        return node;
    }

    function packRowsFromExamRange(seg, sec) {
        const start = String(seg && seg.start != null ? seg.start : '').trim();
        const end = String(seg && seg.end != null ? seg.end : '').trim();
        if (!start || !end) return null;
        const rtype = (seg && seg.range_type) || 'page';
        if (rtype !== 'page' && rtype !== 'qnum') return null;
        const metaFile = String((seg && (seg.meta_file_name || '')) || '').trim()
            || asMetaFileName((seg && seg.sheet_id) || '');
        if (!metaFile) return null;
        const comboId = String((seg && (seg.combination_id || seg.combo_id))
            || (sec && (sec.combination_id || sec.combo_id)) || '').trim();
        return {
            start: start,
            end: end,
            rangeType: rtype,
            range_type: rtype,
            metaFile: metaFile,
            meta_file: metaFile,
            comboId: comboId,
            combo_id: comboId,
            comboLabel: '',
            combo_label: ''
        };
    }

    /** 小標題＝表名＋範圍。只准 combinePackRangeLabel。函式不在＝沒有。 */
    function buildExamRangeLabelFromTask(task) {
        const FT = window.FeatureTimeline;
        if (!FT || typeof FT.combinePackRangeLabel !== 'function') return '';
        if (!task || !task.raw_data) return '';
        const job = task.raw_data.exam_job || {};
        const sections = Array.isArray(job.sections) ? job.sections : [];
        const rows = [];
        sections.forEach(function (sec) {
            const segs = (sec && Array.isArray(sec.segments) && sec.segments.length)
                ? sec.segments
                : (sec ? [sec] : []);
            segs.forEach(function (seg) {
                const row = packRowsFromExamRange(seg, sec);
                if (row) rows.push(row);
            });
        });
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        return FT.combinePackRangeLabel(rows, (bState && bState.classId) || '');
    }

    function getExamRangeLabel(examPathStr, task) {
        const node = task || getBuilderTaskByPath(examPathStr);
        if (isExamUnderComboPack(examPathStr, node)) {
            const FT = window.FeatureTimeline;
            const parentPath = (FT && typeof FT.parentRangeGroupPathOf === 'function')
                ? FT.parentRangeGroupPathOf(examPathStr)
                : '';
            const packLabel = (parentPath && FT && typeof FT.packRangeLabelForAudio === 'function')
                ? FT.packRangeLabelForAudio(parentPath)
                : '';
            if (packLabel) return packLabel;
        }
        const own = buildExamRangeLabelFromTask(node);
        if (own) return own;
        return getSiblingAudioRangeLabel(examPathStr) || '';
    }

    function applyExamTitleFromRange(pathStr, task) {
        const label = getExamRangeLabel(pathStr, task);
        if (!label) return;
        if (window.FeatureTimeline && typeof window.FeatureTimeline.applyInheritedTitleFromRange === 'function') {
            window.FeatureTimeline.applyInheritedTitleFromRange(pathStr, label);
        }
        const titleEl = document.getElementById('node-title-' + pathStr);
        if (task && titleEl && titleEl.getAttribute('data-title-auto') === '1') {
            task.title = label;
            if (!task.raw_data) task.raw_data = {};
            task.raw_data.title_auto_from_range = true;
            task.raw_data.exam_title = label;
        }
    }

    /**
     * 考試繼承同層錄音要用的標題文字。💣 老師回報「考試標題應該繼承錄音『標題』，不應該是
     * base 範圍」：原本這裡優先抓 material_range（例如「pp. 18, pp. 19, pp. 20」），錄音任務
     * 自己取的標題（例如「單字：pp.18~20」）反而只是找不到範圍時的後備。改成錄音自己的標題
     * 優先──那才是老師真正想看到的名字；只有錄音標題是空的或還是預設字樣（沒改過）時，才退回
     * 用 base 範圍／material_refs 拼出來的範圍文字頂替，至少比完全沒有標題好。
     * 這份考試自己已有區塊＋起迄時，請走 getExamRangeLabel，不要用這支蓋掉。
     */
    function getSiblingAudioRangeLabel(examPathStr) {
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!bState) return '';
        const audio = findPreferredAudioTask((bState.tasks || []), examPathStr);
        if (!audio || !audio.raw_data) return '';
        let label = String(audio.title || '').replace(/<[^>]*>?/gm, '').trim();
        if (!label || label === '錄音' || label === '未命名任務') {
            label = String(audio.raw_data.material_range || '').trim();
            if (!label && window.FeatureTimeline
                && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
                const refs = Array.isArray(audio.raw_data.material_refs) ? audio.raw_data.material_refs : [];
                label = String(window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '').trim();
            }
        }
        if (label === '錄音' || label === '考試') return '';
        return label;
    }

    function ensureNestedExamJob(task) {
        if (!task.raw_data) task.raw_data = {};
        if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
        const job = task.raw_data.exam_job;
        const mat = task.raw_data.exam_material || {};
        job.sections = normalizeExamSections(job.sections, {
            material_folder: mat.material_folder || '',
            material_root_kind: mat.root_kind || 'teacher'
        });
        return job;
    }

    function inlineAddExamSection(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = ensureNestedExamJob(task);
        const last = job.sections.length ? job.sections[job.sections.length - 1] : null;
        job.sections.push(emptySection({
            material_folder: last ? last.material_folder : '',
            material_root_kind: last ? last.material_root_kind : 'teacher',
            shuffle: last ? last.shuffle !== false : true,
            allow_answer_appeal: last ? last.allow_answer_appeal !== false : true,
            segments: [emptySegment(last && last.segments && last.segments[0])]
        }));
        task.raw_data.exam_job = job;
        refreshExamBuilder();
        window.showFlash('已加一個段落', 'success');
    }

    function inlineRemoveExamSection(pathStr, secIdx) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = ensureNestedExamJob(task);
        if (job.sections.length <= 1) {
            return window.showFlash('至少要保留一個段落', 'warning');
        }
        job.sections.splice(secIdx, 1);
        refreshExamBuilder();
    }

    function inlineAddSegment(pathStr, secIdx) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = ensureNestedExamJob(task);
        const sec = job.sections[secIdx];
        if (!sec) return;
        if (!Array.isArray(sec.segments)) sec.segments = [];
        const last = sec.segments.length ? sec.segments[sec.segments.length - 1] : null;
        sec.segments.push(emptySegment(last));
        task.raw_data.exam_job = job;
        refreshExamBuilder();
        window.showFlash(
            last && last.sheet_id
                ? ('已加一個片段（預填活頁 ' + last.sheet_id + '，請改起迄／題數）')
                : '已加空白片段：請選活頁',
            last && last.sheet_id ? 'success' : 'warning'
        );
    }

    function inlineInheritSegment(pathStr, secIdx, segIdx) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = ensureNestedExamJob(task);
        const sec = job.sections[secIdx];
        if (!sec || !Array.isArray(sec.segments)) return;
        const i = Number(segIdx);
        const prev = sec.segments[i - 1];
        const cur = sec.segments[i];
        if (!prev || !cur) return;
        const next = emptySegment(prev);
        sec.segments[i] = Object.assign({}, cur, {
            sheet_id: cur.sheet_id || next.sheet_id,
            meta_file_name: cur.meta_file_name || next.meta_file_name,
            meta_file_id: cur.meta_file_id || next.meta_file_id,
            range_type: next.range_type,
            start: next.start,
            end: next.end,
            lines_per_page: cur.lines_per_page || next.lines_per_page,
            layout_profile_id: cur.layout_profile_id || next.layout_profile_id
        });
        task.raw_data.exam_job = job;
        refreshExamBuilder();
    }

    function inlineRemoveSegment(pathStr, secIdx, segIdx) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = ensureNestedExamJob(task);
        const sec = job.sections[secIdx];
        if (!sec || !Array.isArray(sec.segments)) return;
        if (sec.segments.length <= 1) {
            return window.showFlash('每個段落至少要保留一個片段', 'warning');
        }
        sec.segments.splice(segIdx, 1);
        refreshExamBuilder();
    }

    function inlineAddSection(pathStr) {
        inlineAddExamSection(pathStr);
    }

    function inlineRemoveSection(pathStr, idx) {
        inlineRemoveExamSection(pathStr, idx);
    }

    function clampTotalInput(el) {
        if (!el) return;
        const raw = String(el.value || '').trim();
        if (raw === '') return;
        let n = Number(raw);
        if (isNaN(n) || n < 1) {
            el.value = '';
            return;
        }
        el.value = String(Math.floor(n));
    }

    function inlineDistribute(pathStr) {
        const totalEl = document.getElementById('exam-inline-total-' + pathStr);
        clampTotalInput(totalEl);
        const total = Number(totalEl && totalEl.value);
        if (!total || total <= 0) {
            window.showFlash('請先填「希望總題數」（正整數，例如 60），再按均分', 'error');
            return;
        }
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = ensureNestedExamJob(task);
        const flat = flattenExamSegments(job.sections);
        const distributed = distributeTotalCount(flat, total);
        let i = 0;
        job.sections.forEach(function (sec) {
            (sec.segments || []).forEach(function (seg) {
                if (distributed[i]) {
                    seg.count = distributed[i].count;
                }
                i++;
            });
        });
        refreshExamBuilder();
        window.showFlash('已將 ' + total + ' 題均分到各片段（可再逐列修改）', 'success');
    }

    function mergeMaterialRefsPreserveMeta(domRefs, existingRefs) {
        const byKey = {};
        (existingRefs || []).forEach(function (r) {
            if (!r) return;
            const k = String(r.material_folder || '') + '::' + String(r.published_file || '');
            if (k !== '::') byKey[k] = r;
        });
        return (domRefs || []).map(function (d) {
            const k = String(d.material_folder || '') + '::' + String(d.published_file || '');
            const old = byKey[k];
            if (!old) return d;
            return Object.assign({}, old, d, {
                fileId: d.fileId || old.fileId || '',
                schema_id: d.schema_id || old.schema_id || '',
                materials_root_kind: d.materials_root_kind || old.materials_root_kind || (window.TeacherPrefs && window.TeacherPrefs.getCachedSync().default_materials_root_kind === 'class' ? 'class' : 'teacher')
            });
        });
    }

    function inlineImportFromRangePack(pathStr) {
        const FT = window.FeatureTimeline;
        const parentPath = (FT && typeof FT.parentRangeGroupPathOf === 'function')
            ? FT.parentRangeGroupPathOf(pathStr)
            : '';
        if (!parentPath) {
            window.showFlash('上面沒有組合包範圍，無法帶入', 'warning');
            return;
        }
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        if (typeof FT.buildRangePackForApply !== 'function') {
            window.showFlash('範圍卡尚未載入，無法帶入', 'warning');
            return;
        }
        // 先讀組合包畫面再寫試卷。禁止先 sync 舊試卷 DOM（會把套餐二蓋成只剩第一塊）。
        const pack = FT.buildRangePackForApply(parentPath, { clamp: true, notify: true });
        const contentRows = (pack.rows || []).filter(function (r) {
            return !!(r && (r.comboId || r.metaFile || String(r.start || '').trim()));
        });
        if (!contentRows.length) {
            window.showFlash('組合包還沒選套餐、或區塊還沒填起迄，沒有可帶入的範圍', 'warning');
            return;
        }
        const notes = applyRangePackToExam(task, pack) || [];
        if (typeof FT.applyRangePackToAudioOf === 'function') {
            FT.applyRangePackToAudioOf(parentPath, pack);
        }
        refreshExamBuilder();
        const job = ensureNestedExamJob(task);
        const segs = flattenExamSegments(job.sections || []);
        const nSec = (job.sections || []).length;
        if (segs.length < contentRows.length) {
            window.showFlash(
                '帶入不完整：組合包 ' + contentRows.length + ' 個區塊，試卷只有 ' + segs.length
                + (notes.length ? ('。' + notes.join('；')) : ''),
                'error'
            );
            return;
        }
        window.showFlash(
            '已把上面組合包帶到試卷（' + nSec + ' 套餐、' + segs.length + ' 個區塊）'
            + (notes.length ? '。注意：' + notes.join('；') : ''),
            notes.length ? 'warning' : 'success'
        );
        if (typeof FT.scheduleAutoSnapshotForRange === 'function') {
            FT.scheduleAutoSnapshotForRange(parentPath);
        }
    }

    function inlineImportFromSiblingAudio(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return;
        syncInlineEditor(pathStr, task);

        // 💣 老師回報「同層有兩個錄音任務呢？你打算怎麼處理？」：原本永遠只抓同層第一個，
        // 老師完全沒辦法選第二個。改成同層有不只一個時，每按一次「從同作業錄音範圍帶入」
        // 就輪流換下一個（存在 task.raw_data._import_audio_cycle_idx，跨次渲染記得目前輪到哪個）。
        const allHits = findAllSiblingAudioHits(bState.tasks || [], pathStr);
        let audioHit = null;
        if (allHits.length > 1) {
            const prevIdx = Number(task.raw_data._import_audio_cycle_idx);
            const nextIdx = (isNaN(prevIdx) ? -1 : prevIdx) + 1 >= allHits.length ? 0 : (isNaN(prevIdx) ? 0 : prevIdx + 1);
            task.raw_data._import_audio_cycle_idx = nextIdx;
            audioHit = allHits[nextIdx];
        } else {
            audioHit = allHits[0] || null;
        }
        const audio = audioHit ? audioHit.task : null;
        const audioPath = audioHit ? audioHit.pathStr : '';
        const rootEl = audioPath ? document.getElementById('node-material-root-' + audioPath) : null;
        const teacherRootDefaultForImport = (window.TeacherPrefs && window.TeacherPrefs.getCachedSync().default_materials_root_kind === 'class') ? 'class' : 'teacher';
        const rootKind = rootEl ? (String(rootEl.value || '').toLowerCase() === 'class' ? 'class' : 'teacher') : teacherRootDefaultForImport;

        const existingRefs = (audio && audio.raw_data && Array.isArray(audio.raw_data.material_refs))
            ? audio.raw_data.material_refs
            : [];
        const domRefs = audioPath ? readDomMaterialRefs(audioPath, rootKind) : [];
        // DOM 有值優先（老師剛改的範圍）；否則用已 Snapshot 的 refs
        const sourceRefs = domRefs.length
            ? mergeMaterialRefsPreserveMeta(domRefs, existingRefs)
            : existingRefs;

        const importLpp = examJobTemplateLpp(task);
        let sections = [];
        if (sourceRefs.length) {
            sections = sectionsFromMaterialRefs(sourceRefs, importLpp);
        }
        if (!sections.length) {
            sections = sectionsFromAudioTask(audio, importLpp);
        }
        if (!sections.length && audio && Array.isArray(audio.raw_data && audio.raw_data.grading_units)) {
            sections = sectionsFromGradingUnits(audio.raw_data.grading_units, importLpp);
        }
        if (!sections.length) {
            const fakeAssignment = { tasks: bState.tasks || [], title: bState.title || '' };
            const hints = extractHintsFromAssignment(fakeAssignment);
            sections = sectionsFromAudioTask(hints.audioTask, importLpp);
            if (!sections.length) sections = parseMaterialRangeToSections(hints.rangeText, importLpp);
            if (!sections.length && hints.materialRefs) {
                sections = sectionsFromMaterialRefs(hints.materialRefs, importLpp);
            }
            if (!sections.length && hints.gradingUnits) {
                sections = sectionsFromGradingUnits(hints.gradingUnits, importLpp);
            }
        }

        sections = rejectBogusPagePrefixSections(sections);
        const importClassId = (bState && bState.classId) || '';
        const keptImport = [];
        (sections || []).forEach(function (sec) {
            if (!sec) return;
            const combo = lookupAssignedCombo(importClassId, sec.combination_id)
                || comboByExactPublishedMeta(importClassId, sec.meta_file_name || sec.sheet_id);
            if (!combo) return;
            sec.combination_id = combo.id;
            sec.material_folder = combo.folderName || sec.material_folder || '';
            sec.material_root_kind = combo.rootKind === 'class' ? 'class' : 'teacher';
            keptImport.push(sec);
        });
        sections = keptImport;
        if (!sections.length) {
            window.showFlash('錄音還沒對到本班套餐。請先在錄音選套餐，不要用手選活頁補', 'warning');
            return;
        }

        // 只帶範圍。可用題必須等老師按「讀取可用題數」從選中的 meta 檔算，禁止用錄音 Snapshot。
        sections = sections.map(function (sec) {
            const next = Object.assign({}, sec);
            applyPairedTemplateToSection(next, pathStr, task);
            const avail = countAvailableFromMeta(next, task);
            if (avail != null && avail >= 0) next.count = avail;
            return next;
        });

        if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
        const importFolder = (sourceRefs[0] && sourceRefs[0].material_folder)
            || ((task.raw_data.exam_material && task.raw_data.exam_material.material_folder) || '');
        const importKind = (sourceRefs[0] && sourceRefs[0].materials_root_kind === 'class')
            ? 'class'
            : ((task.raw_data.exam_material && task.raw_data.exam_material.root_kind) || rootKind || 'teacher');
        task.raw_data.exam_job.sections = groupFlatRowsIntoSections(sections, {
            material_folder: importFolder,
            material_root_kind: importKind,
            shuffle: true,
            allow_answer_appeal: true
        });
        if (audio && sourceRefs.length) {
            if (!audio.raw_data) audio.raw_data = {};
            audio.raw_data.material_refs = sourceRefs;
        }
        // 不可一般 refreshBuilder：會 sync 舊 DOM 把剛寫入的區段蓋掉
        refreshExamBuilder();
        const missing = sections.filter(function (s) {
            return countAvailableFromMeta(s, task) == null;
        }).map(function (s) { return s.sheet_id; });
        let msg = '已帶入 ' + sections.length + ' 個區段的範圍';
        if (allHits.length > 1) {
            const idx1 = task.raw_data._import_audio_cycle_idx + 1;
            msg = '（同層第 ' + idx1 + '/' + allHits.length + ' 個錄音「' + stripHtml(audio && audio.title || '') + '」）' + msg
                + '；再按一次會換下一個同層錄音';
        }
        if (missing.length) {
            msg += '。這些活頁還沒有總題數（現有 .meta.json 尚未寫入）。請硬重整讓系統補齊，或到教材範本管理再產生上傳';
        }
        window.showFlash(msg, missing.length ? 'warning' : 'success');
    }

    function inlineRefreshAvail(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        clampExamJobRanges(task, { notify: true });
        refreshExamBuilder();
    }

    function examInlineMaterialContext(pathStr, task) {
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const examMaterialSelf = getExamMaterialSelf(task);
        const siblingHits = findAllSiblingAudioHits((bState && bState.tasks) || [], pathStr);
        const siblingAudio = siblingHits[0] ? siblingHits[0].task : null;
        const comboFirstRef = (siblingAudio && siblingAudio.raw_data && Array.isArray(siblingAudio.raw_data.material_refs))
            ? siblingAudio.raw_data.material_refs[0] : null;
        const comboFolder = (comboFirstRef && comboFirstRef.material_folder) || '';
        const comboRootKind = (comboFirstRef && comboFirstRef.materials_root_kind === 'class') ? 'class' : 'teacher';
        return {
            classId: classId,
            folderName: examMaterialSelf.material_folder || comboFolder,
            rootKind: examMaterialSelf.material_folder ? (examMaterialSelf.root_kind || 'teacher') : comboRootKind
        };
    }

    function sheetIdForTemplateLookup(raw) {
        const s = String(raw || '').trim();
        if (!s || s === '__manual__') return '';
        if (/\.meta\.json$/i.test(s)) return fullMetaStem(s);
        return s;
    }

    /** 套餐選定後帶入該套餐官方認證試卷範本的預設項。沒套餐就不帶。 */
    function lookupPairedExamTemplateId(pathStr, task, sec) {
        const classId = ((window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState()) || {}).classId || '';
        const combo = (sec && sec.combination_id ? lookupAssignedCombo(classId, sec.combination_id) : null)
            || comboByExactPublishedMeta(classId, sec && (sec.meta_file_name || sec.sheet_id))
            || resolveSectionCombo(classId, sec);
        return examTemplateIdForCombo(combo, '');
    }

    function applyPairedTemplateToSection(sec, pathStr, task) {
        if (!sec) return;
        const tplId = lookupPairedExamTemplateId(pathStr, task, sec);
        if (!tplId) return;
        sec.layout_profile_id = tplId;
        const profile = resolveExamTemplateProfile(tplId);
        if (profile && Number(profile.lines_per_page) > 0) {
            sec.lines_per_page = Number(profile.lines_per_page);
        }
    }

    /** 獨立考試「活頁」下拉選了「✏️ 其他（手動輸入）」才顯示手動輸入框 */
    function inlineOnSheetSelectChange(pathStr, secIdx, segIdx) {
        const idx = (segIdx == null) ? String(secIdx) : (secIdx + '-' + segIdx);
        const selectEl = document.getElementById('exam-inline-sheet-' + pathStr + '-' + idx);
        const manualEl = document.getElementById('exam-inline-sheet-manual-' + pathStr + '-' + idx);
        if (manualEl) manualEl.style.display = (selectEl && selectEl.value === '__manual__') ? 'block' : 'none';
        if (selectEl && selectEl.value === '__manual__') return;
        const task = getBuilderTaskByPath(pathStr);
        const sheetVal = selectEl ? selectEl.value : '';
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const jobForCombo = task ? ensureNestedExamJob(task) : null;
        const secForCombo = jobForCombo && jobForCombo.sections && jobForCombo.sections[secIdx];
        const combo = resolveSectionCombo(classId, secForCombo);
        const tplId = examTemplateIdForCombo(combo, '')
            || (task ? lookupPairedExamTemplateId(pathStr, task, {
                combination_id: combo && combo.id,
                meta_file_name: sheetVal,
                sheet_id: fullMetaStem(sheetVal)
            }) : '');
        if (task && sheetVal) {
            const job = jobForCombo;
            const sec = secForCombo;
            const seg = sec && sec.segments && sec.segments[segIdx == null ? 0 : segIdx];
            if (seg) {
                seg.meta_file_name = sheetVal;
                seg.sheet_id = fullMetaStem(sheetVal);
                delete seg.meta_file_id;
                delete seg.available_count;
                delete seg.meta_missing_page;
                if (tplId) seg.layout_profile_id = tplId;
            }
        }
        const layoutEl = document.getElementById('exam-inline-sectionlayout-' + pathStr + '-' + idx);
        if (layoutEl) layoutEl.value = tplId || '';
        if (tplId) {
            const profile = resolveExamTemplateProfile(tplId);
            const lppEl = document.getElementById('exam-inline-lpp-' + pathStr + '-' + idx);
            if (lppEl && profile && Number(profile.lines_per_page) > 0) {
                lppEl.value = String(profile.lines_per_page);
            }
        }
        if (selectEl && selectEl.value && task) {
            const job = ensureNestedExamJob(task);
            const sec = job.sections && job.sections[secIdx];
            const seg = sec && sec.segments && sec.segments[segIdx == null ? 0 : segIdx];
            if (seg && countAvailableFromMeta(seg, task) == null) {
                inlineRefreshStandaloneMeta(pathStr, { silent: true });
                return;
            }
        }
        inlineRefreshAvail(pathStr);
    }

    async function inlineGeneratePaperNow(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        if (!task.raw_data) task.raw_data = {};
        if (!examJobLooksReady(task.raw_data.exam_job)) {
            setGenerateStatus(pathStr, '❌ 請先選套餐並填好範圍與試卷範本，再按「產生試卷」。', 'error');
            return;
        }
        const hasPaper = !!(task.raw_data.quiz_paper
            && Array.isArray(task.raw_data.quiz_paper.items)
            && task.raw_data.quiz_paper.items.length);
        if (hasPaper) {
            const ok = await window.ModalOverlay.confirm(
                '「產生試卷」＝這份作業的新卷，會發今天的新卷號，並重新抽題。\n'
                + '只覆蓋現在正在編輯的這份作業，不會改到其他已出過的作業。\n'
                + '題目要維持不變、只改標準答案，請改按「重新批改」（舊卷、舊卷號）。\n'
                + '確定要出新卷？'
            );
            if (!ok) return;
        }
        inlineGeneratePaper(pathStr, { forceRefreshMeta: true });
    }

    function colMapFromTemplate(t) {
        const map = {};
        (t && Array.isArray(t.columns) ? t.columns : []).forEach(function (c) {
            const letter = (c && (c.letter || c.col)) ? String(c.letter || c.col).trim() : '';
            if (!c || !letter || !c.semantic_key) return;
            map[letter.toUpperCase()] = String(c.semantic_key).trim();
        });
        return map;
    }

    function hasCachedMetaRows(rowsByStem) {
        if (!rowsByStem || typeof rowsByStem !== 'object') return false;
        return Object.keys(rowsByStem).some(function (k) {
            return Array.isArray(rowsByStem[k]) && rowsByStem[k].length;
        });
    }

    function mergeExamProfilesIntoLayout(layout, examJob) {
        const out = layout && typeof layout === 'object' ? layout : {};
        const examProfiles = buildEnrichedProfiles(examJob);
        const byId = {};
        (out.profiles || []).forEach(function (p) {
            if (p && p.profile_id) byId[String(p.profile_id)] = Object.assign({}, p);
        });
        examProfiles.forEach(function (p) {
            if (!p || !p.profile_id) return;
            const id = String(p.profile_id);
            const prev = byId[id] || {};
            byId[id] = Object.assign({}, prev, p, {
                quiz_answer: p.quiz_answer || prev.quiz_answer || '',
                quiz_prompt: p.quiz_prompt || prev.quiz_prompt || '',
                col_map: Object.assign({}, prev.col_map || {}, p.col_map || {})
            });
        });
        out.profiles = Object.keys(byId).map(function (k) { return byId[k]; });
        if (examJob && examJob.layout_profile_id) out.default_profile_id = examJob.layout_profile_id;
        // 禁止把各範本 col_map 合成一份。PIC 的 AN=pos、WORD 的 AN=pre，合成後全卷用錯欄。
        return out;
    }

    function findTemplateForProfile(profile) {
        const list = (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getTemplatesCachedSync === 'function')
            ? window.FeatureTemplateLibrary.getTemplatesCachedSync()
            : [];
        const pid = profile && profile.profile_id;
        return list.find(function (x) {
            return String(x.id) === String(pid)
                || (x.legacy_id && String(x.legacy_id) === String(pid))
                || (x.legacy_profile_id && String(x.legacy_profile_id) === String(pid));
        }) || null;
    }

    function enrichProfileQuizAnswer(profile) {
        if (!profile) return profile;
        const t = findTemplateForProfile(profile);
        if (!t) return profile;
        const out = Object.assign({}, profile);
        if (t.is_extraction_role) {
            out.quiz_answer = String(t.answer_combine_note || '').trim();
        } else {
            out.quiz_answer = String(t.quiz_answer || '').trim();
        }
        out.col_map = Object.assign({}, out.col_map || {}, colMapFromTemplate(t));
        return out;
    }

    function collectSheetIdsFromPaper(paper) {
        const sheetIds = [];
        ((paper && paper.items) || []).forEach(function (it) {
            const sid = String((it.source && it.source.sheet_id) || '').trim();
            if (sid && sheetIds.indexOf(sid) === -1) sheetIds.push(sid);
        });
        return sheetIds;
    }

    function collectLayoutProfileIds(examJob) {
        const ids = [examJob && examJob.layout_profile_id];
        flattenExamSegments(normalizeExamSections((examJob && examJob.sections) || [], {})).forEach(function (s) {
            if (s && s.layout_profile_id) ids.push(s.layout_profile_id);
        });
        return ids.filter(Boolean);
    }

    function buildEnrichedProfiles(examJob) {
        const idsNeeded = collectLayoutProfileIds(examJob);
        const seenIds = {};
        const profiles = [];
        idsNeeded.forEach(function (pid) {
            if (seenIds[pid]) return;
            seenIds[pid] = true;
            const resolved = resolveExamTemplateProfile(pid);
            if (resolved) profiles.push(enrichProfileQuizAnswer(resolved));
        });
        return profiles;
    }

    function resolveCtxFromTask(task) {
        const self = getExamMaterialSelf(task);
        const examJob = (task && task.raw_data && task.raw_data.exam_job) || {};
        if (self.material_folder) {
            return {
                refs: [],
                materialFolder: self.material_folder,
                rootKind: self.root_kind,
                schemaId: '',
                audioPath: '',
                sections: examJob.sections || []
            };
        }
        const paper = task && task.raw_data && task.raw_data.quiz_paper;
        const item0 = paper && paper.items && paper.items[0];
        const src = (item0 && item0.source) || {};
        if (src.material_folder) {
            return {
                refs: [],
                materialFolder: resolveStoredFolderName(src.material_folder),
                rootKind: String(src.materials_root_kind || 'teacher').toLowerCase() === 'class' ? 'class' : 'teacher',
                schemaId: String(src.schema_id || ''),
                audioPath: '',
                sections: examJob.sections || []
            };
        }
        return null;
    }

    /**
     * 維持現有題目與順序，依目前試卷範本公式重算標準答案（不抽新題）。
     * 作業編輯「重新批改」與批改畫面「重新批閱」共用。
     */
    async function refreshTaskPaperFromTemplate(task, classId, opts) {
        opts = opts || {};
        if (!task || !task.raw_data || !task.raw_data.quiz_paper) {
            throw new Error('找不到線上卷');
        }
        if (!window.QuizPaperBuilder || typeof window.QuizPaperBuilder.refreshPaperAnswersKeepItems !== 'function') {
            throw new Error('批改模組未載入，請硬重新整理老師頁');
        }
        await fetchExamTemplates(true);
        const paper = task.raw_data.quiz_paper;
        const examJob = task.raw_data.exam_job || {};
        const localRowsByStem = Object.assign({}, task.raw_data.meta_rows_by_stem || {});
        const sheetIds = collectSheetIdsFromPaper(paper);
        const ctx = opts.ctx || resolveCtxFromTask(task);
        let usedCacheOnly = false;
        if (classId && ctx && ctx.materialFolder) {
            try {
                const fetched = await fetchLayoutAndMetaForSheets(
                    classId, ctx, sheetIds, localRowsByStem, { forceRefreshMeta: !!opts.forceRefreshMeta }
                );
                if (fetched && fetched.rowsByStem) {
                    Object.assign(localRowsByStem, fetched.rowsByStem);
                    if (!task.raw_data.meta_rows_by_stem) task.raw_data.meta_rows_by_stem = {};
                    Object.assign(task.raw_data.meta_rows_by_stem, fetched.rowsByStem);
                }
                if (fetched && fetched.error && !hasCachedMetaRows(localRowsByStem)) {
                    throw fetched.error;
                }
                if (fetched && fetched.error) usedCacheOnly = true;
            } catch (err) {
                if (!hasCachedMetaRows(localRowsByStem)) throw err;
                usedCacheOnly = true;
            }
        } else if (!hasCachedMetaRows(localRowsByStem)) {
            throw new Error('沒有教材 meta 可以重算標準答案。請先套用 Snapshot，或確認考試已選教材資料夾。');
        } else {
            usedCacheOnly = true;
        }
        const layout = mergeExamProfilesIntoLayout({
            material_folder: (ctx && ctx.materialFolder) || '',
            default_profile_id: examJob.layout_profile_id,
            col_map: {},
            profiles: []
        }, examJob);

        const result = await window.QuizPaperBuilder.refreshPaperAnswersKeepItems({
            paper: paper,
            examJob: examJob,
            layout: layout,
            loadSheetMeta: async function (secOrId) {
                const hint = asLoadSection(secOrId);
                const sid = hint.sheet_id || fullMetaStem(hint.meta_file_name);
                return {
                    rows: lookupRowsBySheetId(localRowsByStem, hint.meta_file_name)
                        || lookupRowsBySheetId(localRowsByStem, sid) || [],
                    schemaId: (ctx && ctx.schemaId) || '',
                    materialFolder: (ctx && ctx.materialFolder) || ''
                };
            }
        });
        task.raw_data.quiz_paper = result.paper;
        result.usedCacheOnly = usedCacheOnly;
        result.sampleAnswers = (result.paper.items || []).slice(0, 3).map(function (it) {
            return String(it.answer_en || '').trim();
        }).filter(Boolean);
        return result;
    }

    /**
     * 維持現有卷（不抽新題），依目前試卷範本重算標準答案，再重批已交卷學生。
     */
    async function inlineRegradeExistingPaper(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return setGenerateStatus(pathStr, '❌ 找不到任務', 'error');
        syncInlineEditor(pathStr, task);
        const paper = task.raw_data && task.raw_data.quiz_paper;
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return setGenerateStatus(pathStr, '❌ 還沒有線上卷。要出新題請按「產生試卷」。', 'error');
        }
        const examJob = syncInlineEditor(pathStr, task) || task.raw_data.exam_job;
        if (examJob) task.raw_data.exam_job = examJob;
        const audioHit = findPreferredAudioHit(bState.tasks || [], pathStr);
        let ctx = null;
        try {
            ctx = resolveExamMaterialContext(pathStr, bState, audioHit);
        } catch (_err) {
            ctx = resolveCtxFromTask(task);
        }
        setGenerateStatus(pathStr, '⏳ 維持現有題目，依試卷範本重算標準答案…', 'busy');
        try {
            const result = await refreshTaskPaperFromTemplate(task, bState.classId, {
                ctx: ctx,
                forceRefreshMeta: !!ctx
            });

            let autoSaved = false;
            if (window.FeatureTimeline && typeof window.FeatureTimeline.quickSaveTasksOnly === 'function') {
                setGenerateStatus(pathStr, '⏳ 儲存更新後的標準答案…', 'busy');
                const saveResult = await window.FeatureTimeline.quickSaveTasksOnly();
                autoSaved = !!(saveResult && saveResult.ok);
            }

            let regradeTxt = '';
            if (bState.editId && window.FeatureExamReview && typeof window.FeatureExamReview.regradeTaskPaper === 'function') {
                setGenerateStatus(pathStr, '⏳ 重批已交卷學生…', 'busy');
                const rg = await window.FeatureExamReview.regradeTaskPaper(bState.editId, task.id, result.paper);
                regradeTxt = '｜已重批 ' + (rg && rg.okCount != null ? rg.okCount : 0) + ' 位學生';
            }

            const sample = (result.sampleAnswers && result.sampleAnswers.length)
                ? ('｜例：' + result.sampleAnswers.slice(0, 2).join('、'))
                : '';
            const cacheNote = result.usedCacheOnly ? '（用已套用的 Snapshot 重算）' : '';
            const msg = '✅ 已維持原卷 ' + result.updated + ' 題，依試卷範本更新標準答案'
                + sample
                + cacheNote
                + (result.missing ? ('（' + result.missing + ' 題對不到 meta）') : '')
                + regradeTxt
                + (autoSaved ? '，並已存到雲端。' : '。請按「儲存作業」。');
            setGenerateStatus(pathStr, msg, result.missing ? 'warn' : 'success');
            refreshExamBuilder();
            setGenerateStatus(pathStr, msg, result.missing ? 'warn' : 'success');
        } catch (err) {
            console.error('[FeatureExamJob] regrade existing paper', err);
            const msg = '重新批改失敗：' + (err.message || err);
            setGenerateStatus(pathStr, '❌ ' + msg, 'error');
        }
    }

    /** 錄音 Snapshot 後：標題若為自動繼承則同步。可用題不從 Snapshot 重算。 */
    function refreshAfterAudioSnapshot(audioPathStr) {
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks)) return;
        const arr = String(audioPathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let list = bState.tasks;
        const base = [];
        for (let i = 0; i < arr.length - 1; i++) {
            const node = list[arr[i]];
            if (!node) return;
            base.push(arr[i]);
            list = node.subTasks || [];
        }
        const audioNode = list[arr[arr.length - 1]];
        let rangeLabel = (audioNode && audioNode.raw_data)
            ? String(audioNode.raw_data.material_range || '').trim()
            : '';
        if (!rangeLabel && audioNode && window.FeatureTimeline
            && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
            const refs = (audioNode.raw_data && Array.isArray(audioNode.raw_data.material_refs))
                ? audioNode.raw_data.material_refs : [];
            rangeLabel = String(window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '').trim();
        }
        for (let i = 0; i < (list || []).length; i++) {
            const t = list[i];
            if (!t || t.type !== 'exam') continue;
            const examPath = base.concat([i]).join('-');
            if (rangeLabel) {
                const titleEl = document.getElementById('node-title-' + examPath);
                const plain = titleEl
                    ? String(titleEl.textContent || '').trim()
                    : String(t.title || '').replace(/<[^>]*>/g, '').trim();
                if (!plain) {
                    t.title = rangeLabel;
                    // 見 .cursor/rules/assignment-title-auto-inherit-invariant.mdc：
                    // 這個旗標才是跨 reload 持久判斷「自動繼承中」的來源，不能只靠 DOM 的 data-title-auto
                    if (!t.raw_data) t.raw_data = {};
                    t.raw_data.title_auto_from_range = true;
                    if (titleEl) {
                        titleEl.textContent = rangeLabel;
                        titleEl.setAttribute('data-title-auto', '1');
                        titleEl.setAttribute('data-title-from-range', rangeLabel);
                    }
                }
            }
        }
        refreshExamBuilder();
    }

    function inlineExport(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        const payload = syncInlineEditor(pathStr, task);
        const pickRows = flattenExamSegments(normalizeExamSections((payload && payload.sections) || [], {}));
        if (!pickRows.length) {
            window.showFlash('請至少填一個片段', 'error');
            return;
        }
        for (let i = 0; i < pickRows.length; i++) {
            if (!pickRows[i].sheet_id) {
                window.showFlash('段落 ' + (pickRows[i]._section_index + 1) + ' 片段 ' + (pickRows[i]._segment_index + 1) + ' 缺少活頁', 'error');
                return;
            }
        }
        downloadJson(payload);
        window.showFlash('已下載 exam_job（請記得按「儲存作業」把設定寫進資料庫）', 'success');
    }

    /** 考試任務自己設定的教材來源（獨立考試：沒有配對錄音時用這個，見 exam-standalone-material-invariant.mdc） */
    function getExamMaterialSelf(task) {
        const em = (task && task.raw_data && task.raw_data.exam_material) || {};
        let rootKind;
        if (em.root_kind) {
            rootKind = String(em.root_kind).toLowerCase() === 'class' ? 'class' : 'teacher';
        } else {
            // 還沒設過（新的獨立考試任務）才帶老師個人跨班預設
            rootKind = (window.TeacherPrefs && window.TeacherPrefs.getCachedSync().default_materials_root_kind === 'class') ? 'class' : 'teacher';
        }
        return {
            material_folder: resolveStoredFolderName(em.material_folder),
            root_kind: rootKind
        };
    }

    /** 從 FeatureTimeline 的 meta 快取項目中取不重複的資料夾名稱（一個資料夾常對應多個 .meta.json 檔） */
    function uniqueFolderNamesFromEntry(entry) {
        const seen = {};
        const out = [];
        ((entry && entry.options) || []).forEach(function (o) {
            const name = String((o && o.folderName) || '').trim();
            if (!name || seen[name]) return;
            seen[name] = true;
            out.push(name);
        });
        return out;
    }

    function listAssignedExamFolders(classId) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (fcmc && typeof fcmc.listAssignedFoldersForClass === 'function') {
            return fcmc.listAssignedFoldersForClass(classId) || [];
        }
        return [];
    }

    function isExamFolderAssignedToClass(classId, folderName) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (fcmc && typeof fcmc.isFolderAssignedToClass === 'function') {
            return !!fcmc.isFolderAssignedToClass(classId, folderName);
        }
        return false;
    }

    /**
     * 教材資料夾下拉：上面「已指派給本班」（已知考卷範本），下面「其他可用」。
     * value 格式固定 "teacher::資料夾名" 或 "class::資料夾名"；"__manual__" 為手動輸入的特殊值。
     */
    function buildExamMaterialFolderOptionsHtml(examMaterialSelf, teacherEntry, classEntry, classId) {
        const teacherFolders = uniqueFolderNamesFromEntry(teacherEntry);
        const classFolders = uniqueFolderNamesFromEntry(classEntry);
        const assigned = listAssignedExamFolders(classId);
        const assignedNames = {};
        assigned.forEach(function (a) {
            const n = String((a && a.folderName) || '').trim();
            if (n) assignedNames[n.toUpperCase()] = a;
        });
        const currentValue = examMaterialSelf.material_folder
            ? (examMaterialSelf.root_kind + '::' + examMaterialSelf.material_folder)
            : '';
        let matchedCurrent = !currentValue;

        function optionHtml(kind, folderName) {
            const v = kind + '::' + folderName;
            if (v === currentValue) matchedCurrent = true;
            return '<option value="' + esc(v) + '"' + (v === currentValue ? ' selected' : '') + '>' + esc(folderName) + '</option>';
        }

        const assignedOpts = [];
        const seenAssigned = {};
        assigned.forEach(function (a) {
            const name = String((a && a.folderName) || '').trim();
            if (!name || seenAssigned[name.toUpperCase()]) return;
            seenAssigned[name.toUpperCase()] = true;
            const kind = (a.rootKind === 'class') ? 'class' : 'teacher';
            assignedOpts.push(optionHtml(kind, name));
        });
        teacherFolders.forEach(function (f) {
            if (assignedNames[String(f).toUpperCase()] && !seenAssigned[String(f).toUpperCase()]) {
                seenAssigned[String(f).toUpperCase()] = true;
                assignedOpts.push(optionHtml('teacher', f));
            }
        });
        classFolders.forEach(function (f) {
            if (assignedNames[String(f).toUpperCase()] && !seenAssigned[String(f).toUpperCase()]) {
                seenAssigned[String(f).toUpperCase()] = true;
                assignedOpts.push(optionHtml('class', f));
            }
        });

        const pairingReady = officialPairingCacheReady();
        const otherOpts = [];
        teacherFolders.forEach(function (f) {
            if (seenAssigned[String(f).toUpperCase()]) return;
            if (!pairingReady || !folderHasOfficialExamPairing('teacher', classId, f)) return;
            otherOpts.push(optionHtml('teacher', f));
        });
        classFolders.forEach(function (f) {
            if (seenAssigned[String(f).toUpperCase()]) return;
            if (!pairingReady || !folderHasOfficialExamPairing('class', classId, f)) return;
            otherOpts.push(optionHtml('class', f));
        });

        let html = '<option value="">— 請選擇教材資料夾 —</option>';
        if (!matchedCurrent && examMaterialSelf.material_folder) {
            html += optionHtml(examMaterialSelf.root_kind || 'teacher', examMaterialSelf.material_folder);
        }
        html += '<optgroup label="已指派給本班">'
            + (assignedOpts.length ? assignedOpts.join('') : '<option value="" disabled>（尚未指派教材給這個班級）</option>')
            + '</optgroup>';
        html += '<optgroup label="其他可用">'
            + (pairingReady
                ? (otherOpts.length ? otherOpts.join('') : '<option value="" disabled>（沒有其他已搭配試卷範本的教材）</option>')
                : '<option value="" disabled>⏳ 載入官方搭配…</option>')
            + '</optgroup>';
        html += '<option value="__manual__">✏️ 其他（手動輸入資料夾名稱）</option>';
        return html;
    }

    function catalogAllOptionsForFolder(classId, rootKind, materialFolder) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMetaCatalogEntry !== 'function') return [];
        const folder = resolveStoredFolderName(materialFolder);
        if (!folder) return [];
        const folderU = folder.toUpperCase();
        const kinds = rootKind === 'class' ? ['class', 'teacher'] : ['teacher', 'class'];
        const out = [];
        const seen = {};
        kinds.forEach(function (k) {
            const entry = window.FeatureTimeline.getMetaCatalogEntry(classId, k);
            ((entry && entry.options) || []).forEach(function (o) {
                if (String((o && o.folderName) || '').trim().toUpperCase() !== folderU) return;
                const name = o && o.fileName;
                if (!name || seen[name]) return;
                seen[name] = true;
                out.push(o);
            });
        });
        return out;
    }

    function catalogOptionIsMeta(o) {
        const name = String((o && o.fileName) || '');
        if (!name) return false;
        if (o.fileKind === 'script') return false;
        if (window.MaterialFileNames && typeof window.MaterialFileNames.isMetaFileName === 'function') {
            return window.MaterialFileNames.isMetaFileName(name);
        }
        return /\.meta\.json$/i.test(name);
    }

    function catalogMetaOptionsForFolder(classId, rootKind, materialFolder) {
        return catalogAllOptionsForFolder(classId, rootKind, materialFolder).filter(catalogOptionIsMeta);
    }

    function rawMetaFileNamesForFolder(classId, rootKind, materialFolder) {
        return catalogAllOptionsForFolder(classId, rootKind, materialFolder).map(function (o) { return o.fileName; }).filter(Boolean);
    }

    function catalogMetaOptionForSheet(classId, rootKind, materialFolder, sheetId) {
        const sid = String(sheetId || '').trim();
        if (!sid) return null;
        const opts = catalogMetaOptionsForFolder(classId, rootKind, materialFolder);
        if (!opts.length) return null;
        const wantFile = /\.meta\.json$/i.test(sid) ? sid : (sid.replace(/\.meta\.json$/i, '') + '.meta.json');
        const exactFile = opts.find(function (o) {
            return String(o.fileName).toUpperCase() === wantFile.toUpperCase()
                || String(o.fileName).toUpperCase() === sid.toUpperCase();
        });
        if (exactFile) return exactFile;
        const wantStem = fullMetaStem(sid).toUpperCase();
        const exactStem = opts.filter(function (o) {
            return fullMetaStem(o.fileName).toUpperCase() === wantStem;
        });
        return exactStem.length === 1 ? exactStem[0] : null;
    }

    /** 這份套餐自己的 meta。不准拿同資料夾另一套餐（PIC／WORD）的檔。 */
    function metaOptionFromCombo(classId, combo, pickedValue) {
        const own = comboOwnMetaFiles(combo);
        if (!combo || !own.length) return null;
        const raw = String(pickedValue || '').trim();
        const want = fullMetaStem(raw).toUpperCase();
        let hit = '';
        if (want) {
            own.forEach(function (m) {
                if (hit) return;
                const stem = fullMetaStem(m).toUpperCase();
                const file = String(m || '').toUpperCase();
                if (stem === want || file === raw.toUpperCase() || file === (want + '.META.JSON')) hit = m;
            });
        }
        if (!hit) return null;
        const fileName = asMetaFileName(hit);
        const kind = combo.rootKind === 'class' ? 'class' : 'teacher';
        return catalogMetaOptionForSheet(classId, kind, combo.folderName, fileName)
            || { fileName: fileName, fileId: '', folderName: combo.folderName, rootKind: kind };
    }

    /** 下拉選到的是真實 .meta.json 檔名時，直接對回清單那一筆（含 fileId）。 */
    function resolvePickedMetaOption(classId, rootKind, materialFolder, pickedValue, prevSec) {
        const raw = String(pickedValue || '').trim();
        if (!raw) return null;
        const opts = catalogMetaOptionsForFolder(classId, rootKind, materialFolder);
        const byName = opts.find(function (o) { return String(o.fileName) === raw; });
        if (byName) return byName;
        const byFull = opts.find(function (o) {
            return fullMetaStem(o.fileName).toUpperCase() === fullMetaStem(raw).toUpperCase();
        });
        if (byFull) return byFull;
        return null;
    }

    function attachCatalogMetaToSection(classId, rootKind, materialFolder, sec) {
        if (!sec) return sec;
        const combo = sec.combination_id ? lookupAssignedCombo(classId, sec.combination_id) : null;
        if (!combo) return sec;
        const fromCombo = metaOptionFromCombo(classId, combo, sec.meta_file_name || sec.sheet_id);
        if (fromCombo && fromCombo.fileName) {
            sec.meta_file_name = fromCombo.fileName;
            if (fromCombo.fileId) sec.meta_file_id = fromCombo.fileId;
        }
        return sec;
    }

    function normMetaStem(s) {
        return stemCore(s);
    }

    /** 去掉 .meta.json 與最後一段範本後綴，再忽略連字號。A ≠ AvaLiu-vBK-2 */
    function stemCore(s) {
        let t = String(s || '').trim().replace(/\.meta\.json$/i, '');
        const m = t.match(/^(.+)\.([A-Za-z][A-Za-z0-9_+-]*)$/);
        if (m) t = m[1];
        return t.replace(/-/g, '').toUpperCase();
    }

    function templateSuffixOfStem(s) {
        const t = String(s || '').trim().replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        const m = t.match(/^(.+)\.([A-Za-z][A-Za-z0-9_+-]*)$/);
        return m ? String(m[2] || '').toUpperCase() : '';
    }

    function stemsLooselyMatch(a, b) {
        const na = stemCore(a);
        const nb = stemCore(b);
        if (!na || !nb || na !== nb) return false;
        const ta = templateSuffixOfStem(a);
        const tb = templateSuffixOfStem(b);
        if (ta || tb) return ta === tb;
        return true;
    }

    /** 重抓 Drive meta 前，清掉同一活頁的舊快取 key（含檔名／stem 別名），避免舊列蓋住新檔。 */
    function dropMatchingMetaKeys(byStem, sheetIds) {
        if (!byStem) return;
        (sheetIds || []).forEach(function (sid) {
            const target = String(sid || '').trim();
            if (!target) return;
            const tu = target.toUpperCase();
            Object.keys(byStem).forEach(function (k) {
                const ku = String(k || '').toUpperCase();
                if (!ku) return;
                if (ku === tu || stemsLooselyMatch(k, target)
                    || fullMetaStem(k).toUpperCase() === fullMetaStem(target).toUpperCase()) {
                    delete byStem[k];
                }
            });
        });
    }

    function toMetaNum(v) {
        if (v == null || v === '') return NaN;
        const n = Number(String(v).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? NaN : n;
    }

    /**
     * 活頁欄可能是字母 C，實際檔卻是 C.vocab-word.meta.json。
     * 只找 C.meta.json、或把檔名改成全大寫，Drive 都找不到，學生端就變成「老師尚未產生線上卷」。
     * 一律回傳清單裡的真實檔名（含大小寫／範本後綴）。
     */
    function resolveMetaFileNameForSheet(classId, rootKind, materialFolder, sheetId) {
        const sid = String(sheetId || '').trim();
        if (!sid) return '';
        const opt = catalogMetaOptionForSheet(classId, rootKind, materialFolder, sid);
        if (opt && opt.fileName) return opt.fileName;
        return sid.replace(/\.meta\.json$/i, '') + '.meta.json';
    }

    function lookupRowsBySheetId(rowsByStem, sheetId) {
        const map = rowsByStem || {};
        const sid = String(sheetId || '').trim();
        if (!sid) return null;
        const keys = Object.keys(map);
        const wantFull = fullMetaStem(sid).toUpperCase();
        if (Array.isArray(map[sid]) && map[sid].length) return map[sid];
        const upper = sid.toUpperCase();
        if (Array.isArray(map[upper]) && map[upper].length) return map[upper];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (!Array.isArray(map[k]) || !map[k].length) continue;
            if (k.toUpperCase() === upper) return map[k];
            if (fullMetaStem(k).toUpperCase() === wantFull) return map[k];
        }
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (Array.isArray(map[k]) && map[k].length && stemsLooselyMatch(k, sid)) return map[k];
        }
        return null;
    }

    /** 從已快取的 meta 清單中，取出某資料夾底下不重複的「活頁」stem（去掉 .meta.json） */
    function examSheetStemsForFolder(classId, rootKind, materialFolder) {
        return examSheetMetaOptionsForFolder(classId, rootKind, materialFolder).map(function (o) {
            return metaStemFromFileName(o.fileName);
        }).filter(Boolean);
    }

    /** 某資料夾底下真實存在的 .meta.json（含 fileId），不是只推活頁字母。 */
    function examSheetMetaOptionsForFolder(classId, rootKind, materialFolder) {
        return catalogMetaOptionsForFolder(classId, rootKind, materialFolder);
    }

    function optionMatchesExamSection(opt, section) {
        if (!opt || !opt.fileName) return false;
        const fileName = String(opt.fileName);
        const fileU = fileName.toUpperCase();
        const wantFile = String((section && section.meta_file_name) || '').trim();
        const sheet = String((section && section.sheet_id) || '').trim();
        const fileStem = fullMetaStem(fileName);
        const wantStem = wantFile ? fullMetaStem(wantFile) : '';
        const sheetStem = sheet ? fullMetaStem(sheet) : '';
        if (wantStem && sheetStem && wantStem.toUpperCase() !== sheetStem.toUpperCase()) {
            if (fileStem.toUpperCase() === sheetStem.toUpperCase()) return true;
            return false;
        }
        if (wantFile) {
            const wantU = wantFile.toUpperCase();
            if (fileName === wantFile || fileU === wantU) return true;
            if (fileU === (wantFile.replace(/\.meta\.json$/i, '') + '.META.JSON')) return true;
            if (stemsLooselyMatch(fileName, wantFile)) return true;
        }
        if (!sheet) return false;
        if (fileU === sheet.toUpperCase()) return true;
        if (fileU === (sheet.replace(/\.meta\.json$/i, '') + '.META.JSON')) return true;
        return stemsLooselyMatch(fileName, sheet);
    }

    /** 活頁下拉：value＝這個教材資料夾裡真實的 .meta.json 檔名。 */
    function buildExamSheetOptionsHtml(metaOpts, section, flags) {
        flags = flags || {};
        if (!flags.folderSelected) {
            return '<option value="">— 請先選教材資料夾 —</option>';
        }
        if (!flags.catalogLoaded && !(metaOpts || []).length) {
            const cur = String((section && (section.meta_file_name || section.sheet_id)) || '').trim();
            if (cur) {
                return '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>'
                    + '<option value="" disabled>⏳ 載入活頁清單…</option>';
            }
            return '<option value="">⏳ 載入活頁清單…</option>';
        }
        if (!flags.pairingReady) {
            const cur = String((section && (section.meta_file_name || section.sheet_id)) || '').trim();
            if (cur) {
                return '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>'
                    + '<option value="" disabled>⏳ 載入官方搭配…</option>';
            }
            return '<option value="">⏳ 載入官方搭配…</option>';
        }
        const sec = section || {};
        const curFile = String(sec.meta_file_name || '').trim();
        const curSheet = String(sec.sheet_id || '').trim();
        const hits = (metaOpts || []).filter(function (opt) { return optionMatchesExamSection(opt, sec); });
        hits.sort(function (a, b) { return String(a.fileName).length - String(b.fileName).length; });
        let chosenName = '';
        if (curFile) {
            const exactFile = (metaOpts || []).find(function (o) {
                return String(o && o.fileName) === curFile;
            });
            if (exactFile) chosenName = exactFile.fileName;
        }
        if (!chosenName && hits.length) {
            const preferSheet = curSheet
                ? hits.find(function (o) {
                    return fullMetaStem(o.fileName).toUpperCase() === fullMetaStem(curSheet).toUpperCase();
                })
                : null;
            chosenName = (preferSheet && preferSheet.fileName) || hits[0].fileName;
        }
        const listed = {};
        let html = '<option value="">— 選活頁（meta）—</option>';
        html += (metaOpts || []).map(function (opt) {
            const name = opt && opt.fileName;
            if (!name) return '';
            listed[String(name).replace(/\.meta\.json$/i, '').toUpperCase()] = true;
            const isCur = !!chosenName && name === chosenName;
            return '<option value="' + esc(name) + '"' + (isCur ? ' selected' : '') + '>' + esc(name) + '</option>';
        }).join('');
        const orphan = curFile || curSheet;
        if (orphan && !listed[String(orphan).replace(/\.meta\.json$/i, '').toUpperCase()]) {
            html += '<option value="' + esc(orphan) + '" selected>' + esc(orphan) + '</option>';
            chosenName = orphan;
        }
        if (!(metaOpts || []).length && !orphan) {
            html += '<option value="" disabled>（這個資料夾沒有已搭配試卷範本的 meta）</option>';
        }
        return html;
    }

    /**
     * 確保獨立考試的教材資料夾下拉有清單可選：優先用 FeatureTimeline 已快取的（跟錄音 Snapshot 共用），
     * 沒有才打 GAS。渲染函式本身只回字串，這裡在下一輪事件圈補畫，DOM 才會存在。
     */
    function ensureExamMaterialFolderCatalog(pathStr, classId, force) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.ensureMetaCatalog !== 'function') return;
        const statusEl = document.getElementById('exam-inline-materialfolder-status-' + pathStr + '-0')
            || document.getElementById('exam-inline-materialfolder-status-' + pathStr);
        if (statusEl && !String(statusEl.textContent || '').trim()) {
            statusEl.textContent = '背景更新資料夾清單…';
            statusEl.style.color = '#9A3412';
        }
        const opts = force ? { force: true } : undefined;
        Promise.all([
            window.FeatureTimeline.ensureMetaCatalog(classId, 'teacher', opts).catch(function () { return null; }),
            window.FeatureTimeline.ensureMetaCatalog(classId, 'class', opts).catch(function () { return null; })
        ]).then(function () {
            // 段落／片段 DOM id 已改成 path-secIdx／path-secIdx-segIdx；
            // 清單回來後一定整卡重畫，不能再找舊 id 然後直接 return（會永遠停在載入中）。
            refreshExamBuilder();
        }).catch(function () {
            refreshExamBuilder();
        });
    }

    function resolveExamMaterialContext(pathStr, bState, audioHit) {
        const audioTask = audioHit && audioHit.task;
        const audioPath = audioHit && audioHit.pathStr;
        const rootEl = audioPath ? document.getElementById('node-material-root-' + audioPath) : null;
        const teacherRootDefault = (window.TeacherPrefs && window.TeacherPrefs.getCachedSync().default_materials_root_kind === 'class') ? 'class' : 'teacher';
        const uiRootKind = rootEl ? (String(rootEl.value || '').toLowerCase() === 'class' ? 'class' : 'teacher') : teacherRootDefault;

        let refs = audioPath ? readDomMaterialRefs(audioPath, uiRootKind) : [];
        if (!refs.length && audioTask && audioTask.raw_data) {
            if (Array.isArray(audioTask.raw_data.material_refs) && audioTask.raw_data.material_refs.length) {
                refs = audioTask.raw_data.material_refs;
            } else if (audioTask.raw_data.material_ref && audioTask.raw_data.material_ref.published_file) {
                refs = [audioTask.raw_data.material_ref];
            }
        }
        if (refs.length) {
            const primary = refs[0] || {};
            const materialFolder = String(primary.material_folder || '').trim();
            if (!materialFolder) throw new Error('找不到 material_folder（meta 下拉值應為 資料夾::檔名）');
            const rootKind = String(primary.materials_root_kind || uiRootKind || 'teacher').trim().toLowerCase() === 'class'
                ? 'class'
                : 'teacher';
            const schemaId = String(primary.schema_id || 'gept-2_sentence').trim();
            return {
                refs: refs,
                materialFolder: materialFolder,
                rootKind: rootKind,
                schemaId: schemaId,
                audioPath: audioPath || ''
            };
        }

        // 獨立考試（同層沒有已選 meta 的錄音任務）：退回考試任務自己填的「教材資料夾」
        const examTask = getBuilderTaskByPath(pathStr);
        const self = getExamMaterialSelf(examTask);
        if (self.material_folder) {
            return {
                refs: [],
                materialFolder: self.material_folder,
                rootKind: self.root_kind,
                schemaId: '',
                audioPath: ''
            };
        }
        const nested = examTask && examTask.raw_data && examTask.raw_data.exam_job
            ? normalizeExamSections(examTask.raw_data.exam_job.sections, {})
            : [];
        if (nested[0] && nested[0].material_folder) {
            return {
                refs: [],
                materialFolder: nested[0].material_folder,
                rootKind: nested[0].material_root_kind === 'class' ? 'class' : 'teacher',
                schemaId: '',
                audioPath: ''
            };
        }
        throw new Error('尚未設定教材來源：同層沒有已選 meta 的錄音，也還沒在段落裡選「教材資料夾」');
    }

    async function readMaterialFileWithFallback(folderIdTeacher, folderIdClass, materialFolder, fileName, preferredKind) {
        const folder = resolveStoredFolderName(materialFolder);
        const order = preferredKind === 'class' ? ['class', 'teacher'] : ['teacher', 'class'];
        let lastErr = null;
        for (let i = 0; i < order.length; i++) {
            const kind = order[i];
            const folderId = kind === 'teacher' ? folderIdTeacher : folderIdClass;
            if (!folderId) continue;
            try {
                const fileResult = await window.GasService.readMaterialFile(
                    folderId, folder, fileName, kind
                );
                return { fileResult: fileResult, rootKind: kind, folderId: folderId };
            } catch (err) {
                lastErr = err;
            }
        }
                throw new Error(
            'GAS 無法讀取「' + folder + '/' + fileName + '」：'
            + ((lastErr && lastErr.message) ? lastErr.message : lastErr)
            + '（已試老師／班級根目錄）'
        );
    }

    async function resolveRootFolderId(classId, rootKind) {
        if (rootKind === 'teacher') {
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
        const db = window.TeacherDB;
        const cls = db && Array.isArray(db.classes)
            ? db.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        let raw = (cls && (cls.raw_data || cls.rawData)) || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        const classFolderId = raw.drive_folder_id || raw.class_folder_id || '';
        if (!classFolderId) throw new Error('此班級尚未設定 Drive 資料夾');
        return classFolderId;
    }

    /**
     * 從 Drive 讀取一批活頁 .meta.json（本地已快取的活頁跳過遠端抓取）。
     * 每一段用該段套餐的資料夾／檔名／fileId。不准讀 _layout.json，不准拿第一份套餐去套第二份。
     * @param {string} classId
     * @param {object} ctx resolveExamMaterialContext() 的回傳值
     * @param {string[]} sheetIds 大寫 sheet_id 陣列
     * @param {object} [localRowsByStem] 已有的本地快取（有值就不重抓該活頁）
     * @param {{forceRefreshMeta?:boolean}} [fetchOpts] 強制重抓 Drive，忽略本地快取
     * @returns {Promise<{rowsByStem:object, layout:object|null, rootKindUsed:string, missingMeta:string[], error:Error|null}>}
     */
    async function fetchLayoutAndMetaForSheets(classId, ctx, sheetIds, localRowsByStem, fetchOpts) {
        const forceRefresh = !!(fetchOpts && fetchOpts.forceRefreshMeta);
        const localByStem = forceRefresh ? {} : (localRowsByStem || {});
        const fileIdByStem = {};
        (ctx.refs || []).forEach(function (r) {
            const full = fullMetaStem(r.published_file || '').toUpperCase();
            if (full && r.fileId) fileIdByStem[full] = r.fileId;
        });

        let folderIdTeacher = '';
        let folderIdClass = '';
        try { folderIdTeacher = await resolveRootFolderId(classId, 'teacher'); } catch (_e) {}
        try { folderIdClass = await resolveRootFolderId(classId, 'class'); } catch (_e) {}

        const needRemote = [];
        const fileNameBySid = {};
        const sectionHint = {};
        const fetchSecs = (ctx.sections || []).some(function (s) { return s && Array.isArray(s.segments); })
            ? flattenExamSegments(ctx.sections)
            : (ctx.sections || []);
        fetchSecs.forEach(function (sec) {
            const key = String((sec && sec.sheet_id) || '').trim();
            if (!key) return;
            sectionHint[key] = sec;
            sectionHint[key.toUpperCase()] = sec;
        });
        function hintForSid(sid) {
            const key = String(sid || '').trim();
            return sectionHint[key] || sectionHint[key.toUpperCase()] || {};
        }
        sheetIds.forEach(function (sid) {
            const hint = hintForSid(sid);
            const local = lookupRowsBySheetId(localByStem, hint.meta_file_name)
                || lookupRowsBySheetId(localByStem, sid);
            const combo = hint.combination_id ? lookupAssignedCombo(classId, hint.combination_id) : null;
            const folderName = resolveStoredFolderName(
                (combo && combo.folderName) || hint._section_folder || ctx.materialFolder
            );
            const opt = combo
                ? metaOptionFromCombo(classId, combo, hint.meta_file_name || sid)
                : null;
            const fileName = hint.meta_file_name || (opt && opt.fileName) || '';
            const fileId = hint.meta_file_id || (opt && opt.fileId) || '';
            if (!fileName) return;
            fileNameBySid[sid] = fileName;
            if (!(Array.isArray(local) && local.length) || !resolveMetaPageKey(local)) {
                const fullKey = fullMetaStem(fileName || sid).toUpperCase();
                const resolvedId = fileId || fileIdByStem[fullKey] || '';
                needRemote.push({
                    materialFolder: folderName,
                    fileName: fileName,
                    fileId: resolvedId,
                    sheetId: sid
                });
            }
        });

        const remoteByName = {};
        const remoteBySid = {};
        function rememberRemote(it, f) {
            if (!f || !f.ok) return;
            const name = (it && it.fileName) || (f && f.fileName) || '';
            if (name) remoteByName[name] = f;
            if (it && it.sheetId && it.sheetId !== '__LAYOUT__') remoteBySid[it.sheetId] = f;
        }
        function hasRemoteForSid(sid) {
            return !!(remoteBySid[sid] || remoteByName[fileNameBySid[sid] || '']);
        }
        let rootKindUsed = ctx.rootKind;
        let lastBatchErr = null;
        const order = ctx.rootKind === 'class'
            ? [{ id: folderIdClass, kind: 'class' }, { id: folderIdTeacher, kind: 'teacher' }]
            : [{ id: folderIdTeacher, kind: 'teacher' }, { id: folderIdClass, kind: 'class' }];
        for (let oi = 0; oi < order.length; oi++) {
            const root = order[oi];
            if (!root.id) continue;
            try {
                let usedBatch = false;
                if (typeof window.GasService.readMaterialFiles === 'function') {
                    try {
                        const files = await window.GasService.readMaterialFiles(root.id, needRemote, root.kind);
                        (files || []).forEach(function (f, idx) {
                            rememberRemote(needRemote[idx], f);
                        });
                        usedBatch = true;
                    } catch (batchUnsupported) {
                        console.warn('[FeatureExamJob] batch 讀檔不可用，改逐檔', batchUnsupported);
                    }
                }
                if (!usedBatch) {
                    for (let ri = 0; ri < needRemote.length; ri++) {
                        const it = needRemote[ri];
                        if ((it.fileName && remoteByName[it.fileName]) || (it.sheetId && remoteBySid[it.sheetId])) continue;
                        if (!it.fileName && !it.fileId) continue;
                        try {
                            const one = await window.GasService.readMaterialFile(
                                root.id, it.materialFolder, it.fileName, root.kind,
                                it.fileId ? { fileId: it.fileId } : undefined
                            );
                            rememberRemote(it, Object.assign({ ok: true }, one));
                        } catch (_oneErr) {
                            if (it.fileId && it.fileName) {
                                try {
                                    const byName = await window.GasService.readMaterialFile(
                                        root.id, it.materialFolder, it.fileName, root.kind
                                    );
                                    rememberRemote(it, Object.assign({ ok: true }, byName));
                                } catch (_nameErr) {}
                            }
                        }
                    }
                }
                const retryByName = needRemote.filter(function (it) {
                    if (!it || it.sheetId === '__LAYOUT__' || !it.fileName) return false;
                    if (it.sheetId && remoteBySid[it.sheetId]) return false;
                    if (remoteByName[it.fileName]) return false;
                    return true;
                });
                for (let rbi = 0; rbi < retryByName.length; rbi++) {
                    const it = retryByName[rbi];
                    try {
                        const byName = await window.GasService.readMaterialFile(
                            root.id, it.materialFolder, it.fileName, root.kind
                        );
                        rememberRemote(it, Object.assign({ ok: true }, byName));
                    } catch (_nameErr) {}
                }
                const stillMissing = sheetIds.filter(function (sid) {
                    return !lookupRowsBySheetId(localByStem, sid) && !hasRemoteForSid(sid);
                });
                if (!stillMissing.length) {
                    rootKindUsed = root.kind;
                    break;
                }
                lastBatchErr = new Error('缺 meta：' + stillMissing.join(', ')
                    + '（請重選該活頁的 .meta.json，不要只選資料夾）');
            } catch (batchErr) {
                lastBatchErr = batchErr;
            }
        }

        const missingMeta = sheetIds.filter(function (sid) {
            return !lookupRowsBySheetId(localByStem, sid) && !hasRemoteForSid(sid);
        });

        const rowsByStem = Object.assign({}, localByStem);
        sheetIds.forEach(function (sid) {
            const existing = lookupRowsBySheetId(rowsByStem, sid);
            if (existing && resolveMetaPageKey(existing)) return;
            const f = remoteBySid[sid] || remoteByName[fileNameBySid[sid] || ''];
            if (f && f.content) {
                try {
                    const parsed = window.MaterialSnapshot
                        ? window.MaterialSnapshot.parseMetaContent(f.content)
                        : JSON.parse(f.content);
                    const rows = Array.isArray(parsed) ? parsed : [];
                    // 💣 同 rememberMetaRows 的雷區：這裡以前會把同一份 rows 存進 sid／檔名／stem／
                    // displayStem 4 個 key，存進資料庫的 meta_rows_by_stem 就會整份複製多份（實測有
                    // 一筆作業被炸到 4.6MB）。lookupRowsBySheetId 讀取端本身已有模糊比對（大小寫、去
                    // .meta.json、去連字號比對 stemCore），只存 sid 這 1 個 key 一樣找得到。
                    rowsByStem[sid] = rows;
                } catch (_e) {}
            }
        });

        Object.keys(rowsByStem).forEach(function (k) {
            if (!Array.isArray(rowsByStem[k]) || !rowsByStem[k].length) return;
            const hint = hintForSid(k);
            const pid = String((hint && hint.layout_profile_id) || '').trim();
            const profile = pid ? resolveExamTemplateProfile(pid) : null;
            // 每一段只套該段已選範本的 col_map。不准拿資料夾 _layout.json／第一份套餐去改第二份。
            rowsByStem[k] = canonicalizeFetchedRows(rowsByStem[k], profile ? { col_map: profile.col_map || {} } : null);
        });

        return {
            rowsByStem: rowsByStem,
            layout: null,
            rootKindUsed: rootKindUsed,
            remoteByName: remoteByName,
            missingMeta: missingMeta,
            error: missingMeta.length
                ? (lastBatchErr || new Error('無法讀取 meta：' + missingMeta.join(', ')
                    + '（資料夾 ' + ctx.materialFolder
                    + ' 裡找不到對應的 .meta.json，請重選活頁的 meta 檔，不要只選資料夾）'))
                : null
        };
    }

    /** 產卷／重批／讀取可用題：從開始到結束只寫這一個固定欄。重繪後照樣還原。 */
    function generateStatusBoxStyle(tone) {
        const map = {
            error: { color: '#B91C1C', bg: '#FEF2F2', border: '#FECACA' },
            success: { color: '#047857', bg: '#ECFDF5', border: '#A7F3D0' },
            warn: { color: '#92400E', bg: '#FFFBEB', border: '#FDE68A' },
            busy: { color: '#0F766E', bg: '#F0FDFA', border: '#99F6E4' }
        };
        const c = map[tone] || { color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0' };
        return 'margin-top:8px; padding:10px 12px; font-size:0.82rem; font-weight:800; line-height:1.5; border-radius:8px; border:1px solid '
            + c.border + '; background:' + c.bg + '; color:' + c.color + '; min-height:2.6em; white-space:pre-wrap;';
    }

    function setGenerateStatus(pathStr, text, tone) {
        _genStatusByPath[pathStr] = { text: String(text || ''), tone: tone || '' };
        const el = document.getElementById('exam-inline-gen-status-' + pathStr);
        if (!el) return;
        el.textContent = _genStatusByPath[pathStr].text;
        el.style.cssText = generateStatusBoxStyle(_genStatusByPath[pathStr].text ? _genStatusByPath[pathStr].tone : '');
    }

    /**
     * 依 examJob 的內容算一個簽章，用來判斷「設定有沒有變」——存檔時只有簽章跟上次產生時不一樣
     * （或根本還沒產生過）才需要重新抽題排版，避免老師隨便改個截止日期、加個備註，
     * 每次「儲存作業」都白白重打一次 Drive／重新抽題（見 page-refresh-perf-invariant 鐵律）。
     */
    function examJobSignature(examJob) {
        if (!examJob) return '';
        try {
            return JSON.stringify({
                bank_id: examJob.bank_id || '',
                layout_profile_id: examJob.layout_profile_id || '',
                shuffle_sections: !!(examJob.options && examJob.options.shuffle_sections),
                sections: normalizeExamSections(examJob.sections, {}).map(function (sec) {
                    sec = sec || {};
                    return {
                        id: sec.id || '',
                        material_folder: sec.material_folder || '',
                        shuffle: sec.shuffle !== false,
                        allow_answer_appeal: sec.allow_answer_appeal !== false,
                        segments: (sec.segments || []).map(function (s) {
                            s = s || {};
                            return {
                                sheet_id: s.sheet_id || '', layout_profile_id: s.layout_profile_id || '',
                                range_type: s.range_type || '', start: s.start != null ? s.start : '', end: s.end != null ? s.end : '',
                                count: s.count != null ? s.count : '', lines_per_page: s.lines_per_page || '',
                                difficulty: s.difficulty || '', include_nums: s.include_nums || '', exclude_nums: s.exclude_nums || ''
                            };
                        })
                    };
                })
            });
        } catch (_e) { return ''; }
    }

    /** 這個考試任務的區段設定是否「填得夠完整、值得嘗試產生」（至少一個區段填了活頁 sheet_id）。 */
    function examJobLooksReady(examJob) {
        if (!examJob || !Array.isArray(examJob.sections) || !examJob.sections.length) return false;
        return flattenExamSegments(normalizeExamSections(examJob.sections, {})).some(function (s) {
            return s && String(s.sheet_id || '').trim();
        });
    }

    /**
     * 存檔前判斷：這個考試任務需不需要（重新）產生線上卷。
     * 💣 雷區（2026-08-12 老師／學生回報「解答根本對不起來」）：這個簽章機制是後來才加的，
     * 在此之前就已經產生、可能已經有學生作答過的考卷，`quiz_paper_signature` 一定是空的——
     * 如果「沒有簽章」也算「跟目前設定不一致」，等於每一份既有考試第一次被存檔（哪怕只是
     * 改個完全無關的欄位）都會被強制重新抽題／重新排序。區段若有設定 `count`（隨機抽題），
     * 重新抽的結果幾乎不可能跟原本一樣，會讓已經在考／已經交卷的學生看到的題目跟新的
     * quiz_paper 對不起來（有些原本考過的題目消失、換成沒考過的新題目）。
     * 正確做法：沒有舊簽章時，視為「現有這份就是最新版，只是還沒補寫簽章」，不觸發重新產生，
     * 交給呼叫端（generatePaperForSave／saveBlock）之後直接補寫簽章即可，之後設定真的改了
     * 才會偵測到差異。
     */
    /**
     * @param {object} task
     * @param {string} [pathStr] 有給就先強制用目前畫面上（如果這個考試節點目前是展開狀態）的
     * 值同步一次 task.raw_data.exam_job，不要只信賴之前每個欄位各自的 change 事件有沒有漏接
     * （2026-08-13 老師回報「明明填了，儲存後學生端還是說沒產生線上卷」：懷疑是某些欄位互動
     * 沒觸發 syncInlineEditor，讓這裡讀到的 exam_job 是存檔前一刻的舊資料，"看起來"沒填好，
     * 直接被 examJobLooksReady 判定不值得產生，全程沒有任何警告，老師完全不會發現）。
     */
    function needsExamRegeneration(task, pathStr) {
        if (!task || task.type !== 'exam' || !task.raw_data) return false;
        if (pathStr) syncInlineEditor(pathStr, task);
        const examJob = task.raw_data.exam_job;
        if (!examJobLooksReady(examJob)) return false;
        if (task.raw_data.exam_reset_pending) return true;
        const paper = task.raw_data.quiz_paper;
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) return true;
        if (!task.raw_data.quiz_paper_signature) return false;
        return examJobSignature(examJob) !== task.raw_data.quiz_paper_signature;
    }

    /** 既有卷缺簽章時，只補寫、不重新產生（見 needsExamRegeneration 的雷區說明）。 */
    function ensureExamPaperSignatureBackfilled(task) {
        if (!task || task.type !== 'exam' || !task.raw_data) return;
        const paper = task.raw_data.quiz_paper;
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) return;
        if (task.raw_data.quiz_paper_signature) return;
        const examJob = task.raw_data.exam_job;
        if (!examJobLooksReady(examJob)) return;
        task.raw_data.quiz_paper_signature = examJobSignature(examJob);
    }

    /**
     * 額外防呆（2026-08-12 老師提問「即便不是針對考卷做改變，儲存作業時是否也會強迫重出考卷」）：
     * needsExamRegeneration 用簽章比對，理論上設定沒變就不會誤觸發——但這份考卷一旦已經有
     * 學生作答過，任何「誤判成設定變了」的情況（不管是簽章機制本身的邊界案例，還是之後改動
     * 這段程式又不小心引入新的判斷錯誤）代價都很高，重新抽題會讓已作答的題目對不起來。
     * 這裡加一道最後防線：只要這個考試任務已經有學生交過答案，一律不自動靜默重新產生，
     * 交回老師自己在畫面上手動確認、按下才會真的重跑（見 renderInlineEditorHtml 的
     * 「🔁 立即重新產生」按鈕，只在 needsExamRegeneration 為 true 時才會出現）。
     * 查詢失敗（離線／RLS）時保守放行（回 false），不要因為連線問題就卡住整份作業存檔。
     */
    async function taskHasSubmittedAnswers(assignmentId, taskId) {
        if (!assignmentId || !taskId) return false;
        if (!window.ApiQuizReview || typeof window.ApiQuizReview.fetchCompletionsForTask !== 'function') return false;
        try {
            const list = await window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId);
            return (list || []).some(function (c) {
                return c && c.raw_data && c.raw_data.quiz_answers && Object.keys(c.raw_data.quiz_answers).length > 0;
            });
        } catch (_e) {
            return false;
        }
    }

    /**
     * 教材-Layout-班級-出題紀錄正規化重構：append-only 出題歷史，不 upsert，每次「產生線上卷」
     * 都 insert 新一列（跟 task.raw_data.quiz_paper 每次覆寫不同，這張表是用來回答「這份考卷
     * 上次是什麼時候、用什麼範圍產生的」）。純記錄用，失敗不影響已經產生好的線上卷，故意
     * 不 await 呼叫端、只在背景記警告。
     * @param {string} assignmentId
     * @param {string} taskId
     * @param {object} examJob
     */
    async function recordExamGenerationEvent(assignmentId, taskId, examJob) {
        if (!assignmentId || !taskId || !window.supabaseClient) return;
        try {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            const payload = {
                assignment_id: assignmentId,
                task_id: String(taskId),
                bank_id: (examJob && examJob.bank_id) || null,
                layout_profile_id: (examJob && examJob.layout_profile_id) || null,
                sections_snapshot: (examJob && Array.isArray(examJob.sections)) ? examJob.sections : [],
                generated_by: user ? user.id : null
            };
            const { error } = await window.supabaseClient.from('exam_generation_events').insert(payload);
            if (error) console.warn('[FeatureExamJob] 記錄出題歷史失敗（不影響已產生的線上卷）', error);
        } catch (err) {
            console.warn('[FeatureExamJob] 記錄出題歷史失敗（不影響已產生的線上卷）', err);
        }
    }

    /**
     * 💣 雷區（2026-08-11 老師回報「產生線上卷按鈕是廢物功能」）：拿掉手動「📝 產生線上卷」
     * 按鈕，改成「儲存作業」時自動偵測每個考試任務設定有沒有變（見 needsExamRegeneration），
     * 有變才自動重新產生＋排版。這個函式因此多了 opts 參數，讓 saveBlock 可以用「靜音批次」
     * 模式呼叫（不彈 showFlash／alert，回傳結果讓外層彙整成一句訊息），跟老師直接觸發（例如
     * 之後若還有除錯用途）共用同一套邏輯，避免兩份程式碼分岔。
     * @param {string} pathStr
     * @param {{silent?:boolean, skipAutoSave?:boolean, forceRefreshMeta?:boolean, skipRefresh?:boolean}} [opts]
     * @returns {Promise<{ok:boolean, error?:string, itemCount?:number, skipped?:boolean}>}
     */
    async function inlineGeneratePaper(pathStr, opts) {
        opts = opts || {};
        const silent = !!opts.silent;
        const skipAutoSave = !!opts.skipAutoSave;
        const skipRefresh = opts.skipRefresh != null ? !!opts.skipRefresh : skipAutoSave;
        const forceRefreshMeta = opts.forceRefreshMeta !== false;
        function fail(msg) {
            setGenerateStatus(pathStr, '❌ ' + msg, 'error');
            return { ok: false, error: msg };
        }
        if (!window.QuizPaperBuilder || typeof window.QuizPaperBuilder.buildQuizPaper !== 'function') {
            return fail('QuizPaperBuilder 未載入，請硬重新整理老師頁');
        }
        if (!window.LayoutFieldsEval) {
            return fail('LayoutFieldsEval 未載入，請硬重新整理老師頁');
        }
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return { ok: false, error: '找不到任務' };
        // 這個考試節點若目前沒展開（手風琴收合），DOM 讀不到值，syncInlineEditor 會直接回
        // undefined——這時退回讀 task.raw_data.exam_job（上次它有展開、有編輯時就已經同步過）。
        const examJob = syncInlineEditor(pathStr, task) || task.raw_data.exam_job;
        if (!examJob) return fail('請至少填一個段落');
        const jobId = newJobId();
        examJob.job_id = jobId;
        task.raw_data.exam_job_id = jobId;
        examJob.sections = normalizeExamSections(examJob.sections, {
            material_folder: (task.raw_data.exam_material && task.raw_data.exam_material.material_folder) || '',
            material_root_kind: (task.raw_data.exam_material && task.raw_data.exam_material.root_kind) || 'teacher'
        });
        const pickRows = flattenExamSegments(examJob.sections);
        if (!pickRows.length) {
            return fail('請至少填一個片段');
        }
        for (let i = 0; i < pickRows.length; i++) {
            if (!pickRows[i].sheet_id) {
                return fail('段落 ' + (pickRows[i]._section_index + 1) + ' 片段 ' + (pickRows[i]._segment_index + 1) + ' 缺少 sheet_id');
            }
        }

        const audioHit = findPreferredAudioHit(bState.tasks || [], pathStr);
        let ctx;
        try {
            ctx = resolveExamMaterialContext(pathStr, bState, audioHit);
        } catch (err) {
            return fail(err.message || String(err));
        }

        setGenerateStatus(pathStr, '⏳ 正在產生線上卷（卷號 ' + jobId + '）…'
            + (forceRefreshMeta ? '重新從 Drive 讀取最新 meta' : '讀取已選的 meta 檔'), 'busy');
        try {
            setGenerateStatus(pathStr, '⏳ 載入試卷範本…', 'busy');
            await fetchExamTemplates(true);
            const localRowsByStem = forceRefreshMeta
                ? {}
                : Object.assign({}, (task.raw_data && task.raw_data.meta_rows_by_stem) || {});

            const sheetIds = [];
            pickRows.forEach(function (sec) {
                const sid = String(sec.sheet_id || '').trim();
                if (sid && sheetIds.indexOf(sid) === -1) sheetIds.push(sid);
            });

            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                setGenerateStatus(pathStr, '⏳ 載入教材 meta 清單…', 'busy');
                try {
                    await window.FeatureTimeline.ensureMetaCatalog(bState.classId, ctx.rootKind || 'teacher', { force: true });
                    await window.FeatureTimeline.ensureMetaCatalog(bState.classId, (ctx.rootKind === 'class') ? 'teacher' : 'class', { force: true });
                } catch (_catErr) {}
            }
            pickRows.forEach(function (sec) {
                const folder = sec._section_folder || ctx.materialFolder;
                const kind = sec._section_root_kind || ctx.rootKind;
                attachCatalogMetaToSection(bState.classId, kind, folder, sec);
            });
            if (task.raw_data && task.raw_data.exam_job) task.raw_data.exam_job.sections = examJob.sections;

            const fcmcPair = window.FeatureClassMaterialCombinations;
            if (fcmcPair && typeof fcmcPair.fetchOfficialPairings === 'function') {
                await fcmcPair.fetchOfficialPairings(false);
            }
            for (let pi = 0; pi < pickRows.length; pi++) {
                const psec = pickRows[pi];
                const hint = (psec && (psec.meta_file_name || psec.sheet_id)) || '';
                const combo = comboForExamSection(psec, task)
                    || lookupAssignedCombo(bState.classId, psec && psec.combination_id);
                if (!combo) {
                    throw new Error('段落 ' + (psec._section_index + 1) + ' 片段 ' + (psec._segment_index + 1)
                        + ' 還沒選套餐，無法出卷');
                }
                const officialIds = officialExamTemplateIdsForCombo(combo);
                if (!officialIds.length) {
                    throw new Error('段落 ' + (psec._section_index + 1) + ' 片段 ' + (psec._segment_index + 1)
                        + ' 的 meta「' + (hint || '（未選）') + '」尚未官方搭配試卷範本，無法出卷');
                }
                if (!isIdInOfficialList(psec && psec.layout_profile_id, officialIds)) {
                    throw new Error('段落 ' + (psec._section_index + 1) + ' 片段 ' + (psec._segment_index + 1)
                        + ' 請從官方認證的試卷範本裡選擇');
                }
            }

            setGenerateStatus(pathStr, '⏳ 讀取 Drive meta…', 'busy');
            ctx.sections = pickRows;
            const fetched = await fetchLayoutAndMetaForSheets(
                bState.classId, ctx, sheetIds, localRowsByStem, { forceRefreshMeta: forceRefreshMeta }
            );
            if (fetched.error) throw fetched.error;
            ctx.rootKind = fetched.rootKindUsed;
            Object.assign(localRowsByStem, fetched.rowsByStem);
            const remoteByName = fetched.remoteByName || {};
            if (!task.raw_data) task.raw_data = {};
            if (!task.raw_data.meta_rows_by_stem) task.raw_data.meta_rows_by_stem = {};
            if (forceRefreshMeta) dropMatchingMetaKeys(task.raw_data.meta_rows_by_stem, sheetIds);
            Object.assign(task.raw_data.meta_rows_by_stem, fetched.rowsByStem);

            /**
             * 💣 雷區：一份考卷可能好幾個區段各自覆蓋不同 layout_profile_id。
             * 每一段只套該段已選的範本庫那一筆。不准讀資料夾 _layout.json、
             * 不准拿第一份套餐的 profile 去套第二份。
             */
            const idsNeeded = collectLayoutProfileIds(examJob);
            const seenIds = {};
            const profiles = [];
            idsNeeded.forEach(function (pid) {
                if (seenIds[pid]) return;
                seenIds[pid] = true;
                const resolved = resolveExamTemplateProfile(pid);
                if (resolved) profiles.push(resolved);
            });
            const layout = mergeExamProfilesIntoLayout({
                material_folder: ctx.materialFolder,
                default_profile_id: examJob.layout_profile_id,
                col_map: {},
                profiles: profiles
            }, examJob);

            const schemaBySheet = {};
            (ctx.refs || []).forEach(function (r) {
                const stem = String(r.label || '').trim().toUpperCase()
                    || String(r.published_file || '').replace(/\.meta\.json$/i, '').toUpperCase();
                if (stem) schemaBySheet[stem] = String(r.schema_id || ctx.schemaId || '').trim();
            });

            setGenerateStatus(pathStr, '⏳ 抽題排版中…', 'busy');
            const paper = await window.QuizPaperBuilder.buildQuizPaper({
                examJob: examJob,
                layout: layout,
                loadSheetMeta: async function (secOrId) {
                    const hint = asLoadSection(secOrId);
                    const sid = hint.sheet_id || fullMetaStem(hint.meta_file_name);
                    let rows = lookupRowsBySheetId(localRowsByStem, hint.meta_file_name)
                        || lookupRowsBySheetId(localRowsByStem, sid);
                    if (!(Array.isArray(rows) && rows.length)) {
                        const wantStem = fullMetaStem(sid || hint.meta_file_name).toUpperCase();
                        const secHit = flattenExamSegments(examJob.sections || []).find(function (s) {
                            if (hint.combination_id && String(s.combination_id || '') !== hint.combination_id) return false;
                            return fullMetaStem(s && (s.meta_file_name || s.sheet_id)).toUpperCase() === wantStem;
                        });
                        const remoteName = (secHit && secHit.meta_file_name) || '';
                        const remote = remoteByName[remoteName] || remoteByName[sid + '.meta.json'];
                        if (!remote || !remote.content) {
                            throw new Error('沒有活頁 ' + sid + ' 的 meta（請重選該列的 .meta.json，不要只選資料夾）');
                        }
                        rows = window.MaterialSnapshot
                            ? window.MaterialSnapshot.parseMetaContent(remote.content)
                            : JSON.parse(remote.content);
                        if (!task.raw_data) task.raw_data = {};
                        if (!task.raw_data.meta_rows_by_stem) task.raw_data.meta_rows_by_stem = {};
                        task.raw_data.meta_rows_by_stem[sid] = rows;
                    }
                    return {
                        rows: rows,
                        schemaId: schemaBySheet[sid.toUpperCase()] || schemaBySheet[sid] || ctx.schemaId || '',
                        materialFolder: ctx.materialFolder
                    };
                }
            });

            if (!task.raw_data) task.raw_data = {};
            task.raw_data.quiz_paper = paper;
            task.raw_data.quiz_paper_no = examJob.job_id || jobId || '';
            task.raw_data.quiz_paper_signature = examJobSignature(examJob);
            task.raw_data.exam_job = examJob;
            task.raw_data.exam_job_id = examJob.job_id;
            delete task.raw_data.exam_reset_pending;
            delete task.raw_data.last_generate_error;
            if (audioHit && audioHit.task && ctx.refs.length) {
                if (!audioHit.task.raw_data) audioHit.task.raw_data = {};
                audioHit.task.raw_data.material_refs = ctx.refs;
            }

            // 教材-Layout-班級-出題紀錄正規化重構（append-only 出題歷史）：task.raw_data.quiz_paper
            // 繼續是「目前這份考卷」給學生端讀取用，不動；這裡額外 insert 一筆 exam_generation_events
            // 記錄「這次產生」的快照，取代以前完全沒有歷史、每次重產只能覆寫的問題。只有這個任務
            // 節點已經存過（bState.editId 有值）才記，避免記到還沒真正落地的暫存任務 id。
            recordExamGenerationEvent(bState.editId, task.id, examJob);

            // 產生成功＝這套設定至少是可用的，記下來讓老師之後在同班出題可以「套用上次設定」
            saveLastConfigForClass(bState.classId, {
                material_folder: ctx.materialFolder || '',
                root_kind: ctx.rootKind || '',
                bank_id: examJob.bank_id || '',
                layout_profile_id: examJob.layout_profile_id || '',
                sections: examJob.sections,
                options: examJob.options || {}
            }).catch(function () {});

            if (!skipRefresh) refreshExamBuilder();
            const noticeTxt = (Array.isArray(paper.notices) && paper.notices.length)
                ? ('｜⚠ ' + paper.notices.join('；'))
                : '';

            // 💣 雷區（2026-08-11 老師回報「明明產生過線上卷，學生端卻顯示尚未產生」）：以前
            // 只把 quiz_paper 寫進瀏覽器記憶體，還要老師另外記得按「儲存作業」才會真的落地，
            // 中間任何一次忘記按、或被別的操作蓋掉，學生端就永遠看不到。現在「產生線上卷」已經
            // 沒有獨立按鈕，一律是「儲存作業」流程裡自動觸發，所以這裡只在「這個作業區塊本來
            // 就已經存過」（bState.editId 有值）且不是被 saveBlock 批次呼叫（skipAutoSave）時，
            // 才順手多存一次；saveBlock 批次呼叫時它自己接下來就會整包存檔，不用這裡重複寫。
            let autoSaved = false;
            let autoSaveErr = '';
            if (!skipAutoSave && window.FeatureTimeline && typeof window.FeatureTimeline.quickSaveTasksOnly === 'function') {
                setGenerateStatus(pathStr, '⏳ 自動儲存中…', 'busy');
                const saveResult = await window.FeatureTimeline.quickSaveTasksOnly();
                if (saveResult && saveResult.ok) {
                    autoSaved = true;
                } else if (saveResult && saveResult.error !== 'not_saved_yet') {
                    autoSaveErr = saveResult.error || '';
                }
            }

            const paperNoTxt = (examJob.job_id || jobId) ? ('｜卷號 ' + (examJob.job_id || jobId)) : '';
            const msg = skipAutoSave
                ? ('✅ 已產生線上卷 ' + (paper.items || []).length + ' 題' + paperNoTxt + noticeTxt)
                : autoSaved
                    ? ('✅ 已產生線上卷 ' + (paper.items || []).length + ' 題' + paperNoTxt + '，並已自動儲存到雲端，學生端可直接看到。' + noticeTxt)
                    : autoSaveErr
                        ? ('✅ 已產生線上卷 ' + (paper.items || []).length + ' 題' + paperNoTxt + '，但自動儲存失敗（' + autoSaveErr + '），請務必立刻按「儲存作業」！' + noticeTxt)
                        : ('✅ 已產生線上卷 ' + (paper.items || []).length + ' 題' + paperNoTxt + '。請立刻按「儲存作業」，學生端才看得到。' + noticeTxt);
            setGenerateStatus(pathStr, msg, (noticeTxt || (!autoSaved && autoSaveErr && !skipAutoSave)) ? 'warn' : 'success');
            return { ok: true, itemCount: (paper.items || []).length, notices: paper.notices || [] };
        } catch (err) {
            console.error('[FeatureExamJob] generate paper', err);
            const msg = '產生線上卷失敗：' + (err.message || err);
            if (!task.raw_data) task.raw_data = {};
            task.raw_data.last_generate_error = err.message || String(err);
            if (!skipRefresh) refreshExamBuilder();
            setGenerateStatus(pathStr, '❌ ' + msg, 'error');
            return { ok: false, error: err.message || String(err) };
        }
    }

    /** 獨立考試：教材資料夾輸入變更時，先存進 task.raw_data（不重抓，等老師按「讀取可用題數」） */
    function inlineOnExamMaterialChange(pathStr, secIdx) {
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
    }

    /**
     * 老師手動覆蓋「同層有錄音任務＝combo」的自動判斷：這份考試明明跟同層那個錄音任務無關
     * （例如作業裡多個單元平鋪在同一層，各自的錄音／考試混在一起），系統自動偵測的「同層」
     * 抓不出「哪一個才是真的要配的」，只能由老師自己明確指定。force=true 時清空舊區段
     * （沿用同層錄音帶入的區段對獨立教材沒有意義），讓老師從空白開始重新選教材資料夾／活頁；
     * force=false（改回沿用）不清空，老師自己決定要不要「從同作業錄音範圍帶入」。
     */
    function inlineToggleForceStandalone(pathStr, force) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        if (!task.raw_data) task.raw_data = {};
        if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
        task.raw_data.exam_force_standalone = !!force;
        if (force && Array.isArray(task.raw_data.exam_job.sections) && task.raw_data.exam_job.sections.length) {
            task.raw_data.exam_job.sections = [];
        }
        refreshExamBuilder();
    }

    /**
     * ✍️ 輸入練習／🔧 輸入改正勾選框只是切換「次數」輸入框的顯示與否，不需要整體重繪
     * （重繪會打斷老師正在編輯的其他欄位），純 DOM 切換即可。
     */
    function inlineToggleInputPracticeCount(pathStr) {
        const practiceEl = document.getElementById('exam-inline-input-practice-' + pathStr);
        const practiceWrap = document.getElementById('exam-inline-input-practice-count-wrap-' + pathStr);
        if (practiceWrap) practiceWrap.style.display = (practiceEl && practiceEl.checked) ? '' : 'none';
        const correctionEl = document.getElementById('exam-inline-input-correction-' + pathStr);
        const correctionWrap = document.getElementById('exam-inline-input-correction-count-wrap-' + pathStr);
        if (correctionWrap) correctionWrap.style.display = (correctionEl && correctionEl.checked) ? '' : 'none';
    }

    /**
     * 選了「✏️ 其他（手動輸入）」才顯示手動輸入框，其餘情況維持隱藏。
     * 換教材資料夾＝可選的「活頁」清單整個換了，所以要整體重繪（refreshExamBuilder），
     * 不能只 sync 狀態，否則各區段的活頁下拉還停在舊資料夾的清單。
     */
    function inlineOnExamMaterialFolderSelectChange(pathStr, secIdx) {
        const suffix = (secIdx == null) ? '' : ('-' + secIdx);
        const selectEl = document.getElementById('exam-inline-materialfolder-' + pathStr + suffix)
            || document.getElementById('exam-inline-materialfolder-' + pathStr);
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        if (task) {
            syncInlineEditor(pathStr, task);
            const job = task.raw_data && task.raw_data.exam_job;
            if (job) {
                const sections = normalizeExamSections(job.sections, {});
                const target = (secIdx != null && sections[secIdx]) ? sections[secIdx] : null;
                const comboId = selectEl ? String(selectEl.value || '').trim() : '';
                const combo = isComboId(comboId) ? lookupAssignedCombo(classId, comboId) : null;
                if (target && combo) {
                    expandExamSegmentsForCombo(target, combo);
                } else if (target && !comboId) {
                    target.combination_id = '';
                    target.material_folder = '';
                    (target.segments || []).forEach(function (seg) {
                        if (!seg) return;
                        delete seg.layout_profile_id;
                        delete seg.meta_file_name;
                        delete seg.meta_file_id;
                        seg.sheet_id = '';
                    });
                }
                job.sections = sections;
            }
        }
        delete _availAutoFetchKey[pathStr];
        refreshExamBuilder();
    }

    /** 「🔄 重新整理清單」：重載官方套餐＋教材資料夾清單 */
    function inlineReloadMaterialFolders(pathStr) {
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!bState) return;
        const fcmc = window.FeatureClassMaterialCombinations;
        if (fcmc && typeof fcmc.fetchOfficialPairings === 'function') {
            fcmc.fetchOfficialPairings(true).then(function () {
                ensureExamMaterialFolderCatalog(pathStr, bState.classId, true);
            }).catch(function () {
                ensureExamMaterialFolderCatalog(pathStr, bState.classId, true);
            });
            return;
        }
        ensureExamMaterialFolderCatalog(pathStr, bState.classId, true);
    }

    /**
     * 依目前選的教材資料夾＋各列 meta 檔，向 Drive 讀取 .meta.json，快取到考試任務自己的
     * raw_data.meta_rows_by_stem。可用題只看這個快取，不看錄音 Snapshot。
     */
    async function inlineRefreshStandaloneMeta(pathStr, opts) {
        opts = opts || {};
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return;
        const examJob = syncInlineEditor(pathStr, task);
        if (!examJob) {
            if (opts.silent) return;
            return setGenerateStatus(pathStr, '❌ 請先選套餐', 'error');
        }
        examJob.sections = normalizeExamSections(examJob.sections, {
            material_folder: (task.raw_data.exam_material && task.raw_data.exam_material.material_folder) || '',
            material_root_kind: (task.raw_data.exam_material && task.raw_data.exam_material.root_kind) || 'teacher'
        });
        const sheetIds = [];
        examJob.sections.forEach(function (sec) {
            (sec.segments || []).forEach(function (seg) {
                const sid = String(seg.sheet_id || '').trim();
                if (sid && !isPagePrefixMisreadAsSheet(sid) && sheetIds.indexOf(sid) === -1) sheetIds.push(sid);
            });
        });
        if (!sheetIds.length) {
            if (opts.silent) return;
            return setGenerateStatus(pathStr, '❌ 請先選套餐，套餐裡的區塊會自動列出', 'error');
        }

        const audioHit = findPreferredAudioHit(bState.tasks || [], pathStr);
        let ctx;
        try {
            ctx = resolveExamMaterialContext(pathStr, bState, audioHit);
        } catch (err) {
            return setGenerateStatus(pathStr, '❌ ' + (err.message || err), 'error');
        }

        setGenerateStatus(pathStr, '⏳ 讀取可用題數…', 'busy');
        try {
            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                try {
                    await window.FeatureTimeline.ensureMetaCatalog(bState.classId, ctx.rootKind || 'teacher', { force: !opts.silent });
                    await window.FeatureTimeline.ensureMetaCatalog(bState.classId, (ctx.rootKind === 'class') ? 'teacher' : 'class', { force: !opts.silent });
                } catch (_catErr) {}
            }
            (examJob.sections || []).forEach(function (sec) {
                const folder = sec.material_folder || ctx.materialFolder;
                const kind = sec.material_root_kind || ctx.rootKind;
                (sec.segments || []).forEach(function (seg) {
                    attachCatalogMetaToSection(bState.classId, kind, folder, seg);
                });
            });
            if (task.raw_data && task.raw_data.exam_job) task.raw_data.exam_job.sections = examJob.sections;
            const forceRefreshMeta = !opts.silent;
            const localRowsByStem = forceRefreshMeta
                ? {}
                : ((task.raw_data && task.raw_data.meta_rows_by_stem) || {});
            ctx.sections = flattenExamSegments(examJob.sections || []);
            const fetched = await fetchLayoutAndMetaForSheets(
                bState.classId, ctx, sheetIds, localRowsByStem, { forceRefreshMeta: forceRefreshMeta }
            );
            if (!task.raw_data) task.raw_data = {};
            if (!task.raw_data.meta_rows_by_stem) task.raw_data.meta_rows_by_stem = {};
            if (forceRefreshMeta) dropMatchingMetaKeys(task.raw_data.meta_rows_by_stem, sheetIds);
            Object.assign(task.raw_data.meta_rows_by_stem, fetched.rowsByStem);
            const persistTotals = {};
            (examJob.sections || []).forEach(function (sec) {
                (sec.segments || []).forEach(function (seg) {
                    const rowsForSec = lookupSectionMetaRows(task.raw_data.meta_rows_by_stem, seg)
                        || lookupRowsBySheetId(fetched.rowsByStem, seg.sheet_id)
                        || lookupRowsBySheetId(fetched.rowsByStem, seg.meta_file_name);
                    const total = totalFromMetaRows(rowsForSec);
                    const stem = String((seg && (seg.sheet_id || seg.meta_file_name)) || '').trim();
                    if (total == null || !stem) return;
                    persistTotals[stem] = total;
                    const combo = comboForExamSection(seg, task) || (sec && sec.combination_id
                        ? lookupAssignedCombo(bState.classId, sec.combination_id) : null);
                    if (window.FeatureClassMaterialCombinations
                        && typeof window.FeatureClassMaterialCombinations.rememberSheetAvailableCount === 'function') {
                        window.FeatureClassMaterialCombinations.rememberSheetAvailableCount(
                            bState.classId, combo, stem, total
                        );
                    }
                });
            });
            if (Object.keys(persistTotals).length
                && window.FeatureClassMaterialCombinations
                && typeof window.FeatureClassMaterialCombinations.writeSheetAvailableCounts === 'function') {
                const byCombo = {};
                (examJob.sections || []).forEach(function (sec) {
                    const combo = sec && sec.combination_id
                        ? lookupAssignedCombo(bState.classId, sec.combination_id)
                        : null;
                    const folderName = (combo && combo.folderName)
                        || (sec && sec.material_folder)
                        || (ctx && ctx.materialFolder)
                        || '';
                    const tpl = (combo && combo.extractionTemplateId) || '';
                    const key = String(combo && combo.id || '') + '|' + folderName + '|' + tpl;
                    if (!byCombo[key]) byCombo[key] = { folderName: folderName, templateId: tpl, counts: {} };
                    (sec.segments || []).forEach(function (seg) {
                        const stem = String((seg && (seg.sheet_id || seg.meta_file_name)) || '').trim();
                        if (!stem || persistTotals[stem] == null) return;
                        byCombo[key].counts[stem] = persistTotals[stem];
                    });
                });
                Object.keys(byCombo).forEach(function (k) {
                    const g = byCombo[k];
                    if (!g.folderName || !Object.keys(g.counts).length) return;
                    window.FeatureClassMaterialCombinations.writeSheetAvailableCounts(
                        g.folderName,
                        g.templateId,
                        g.counts
                    ).catch(function () {});
                });
            }
            const availNotes = [];
            let anyInRange = false;
            let anyMissingPage = false;
            (examJob.sections || []).forEach(function (sec) {
                (sec.segments || []).forEach(function (seg) {
                    const rowsForSec = lookupSectionMetaRows(task.raw_data.meta_rows_by_stem, seg)
                        || lookupRowsBySheetId(fetched.rowsByStem, seg.sheet_id)
                        || lookupRowsBySheetId(fetched.rowsByStem, seg.meta_file_name);
                    if (Array.isArray(rowsForSec) && rowsForSec.length) {
                        rememberMetaRows(task.raw_data.meta_rows_by_stem, seg, rowsForSec);
                        rememberComboPageCounts(seg, task, rowsForSec);
                        if (metaCannotFilterByPage(seg, rowsForSec)) {
                            delete seg.available_count;
                            seg.meta_missing_page = true;
                            anyMissingPage = true;
                            const keys = describeMetaRowKeys(rowsForSec);
                            availNotes.push(
                                (seg.meta_file_name || seg.sheet_id || '活頁')
                                + ' 有 ' + rowsForSec.length + ' 列，但沒有 page 欄（現有：'
                                + (keys || '—')
                                + '）。請到教材發布把 Excel 頁碼欄對成 page 後重新上傳'
                            );
                        } else {
                            delete seg.meta_missing_page;
                            const n = countAvailableFromMetaRows(seg, rowsForSec);
                            seg.available_count = (n == null ? 0 : n);
                            if (seg.available_count > 0) anyInRange = true;
                            const pages = summarizeMetaPages(rowsForSec);
                            availNotes.push(
                                (seg.meta_file_name || seg.sheet_id || '活頁')
                                + ' 範圍內 ' + seg.available_count + ' 題'
                                + (pages ? '（檔內頁碼 ' + pages + '）' : '')
                            );
                        }
                    } else {
                        delete seg.available_count;
                        delete seg.meta_missing_page;
                        availNotes.push((seg.meta_file_name || seg.sheet_id || '活頁') + ' 讀到的檔沒有列');
                    }
                });
            });
            if (task.raw_data.exam_job) task.raw_data.exam_job.sections = examJob.sections;
            refreshExamBuilder();
            if (fetched.missingMeta && fetched.missingMeta.length) {
                setGenerateStatus(pathStr, '⚠️ 部分區塊讀不到 meta：' + fetched.missingMeta.join('/') + '（請確認該套餐的 meta 檔）', 'warn');
            } else if (anyMissingPage) {
                setGenerateStatus(pathStr, '⚠️ ' + availNotes.join('；'), 'warn');
            } else if (!anyInRange) {
                setGenerateStatus(pathStr, '⚠️ 檔有讀到，但這個範圍沒有題：' + availNotes.join('；'), 'warn');
            } else {
                setGenerateStatus(pathStr, '✅ 可用題：' + availNotes.join('；'), 'success');
            }
        } catch (err) {
            setGenerateStatus(pathStr, '❌ 讀取失敗：' + (err.message || err), 'error');
        }
    }

    return {
        renderEntryButton: renderEntryButton,
        openModal: openModal,
        renderInlineEditorHtml: renderInlineEditorHtml,
        syncInlineEditor: syncInlineEditor,
        listExamTasks: listExamTasks,
        findTaskById: findTaskById,
        _close: closeModal,
        _onFieldChange: onFieldChange,
        _onRangeTypeChange: onRangeTypeChange,
        _onAssignmentChange: onAssignmentChange,
        _importFromAssignment: importFromAssignment,
        _onTaskChange: onTaskChange,
        _addSection: addSection,
        _removeSection: removeSection,
        _preview: preview,
        _saveAndExport: saveAndExport,
        _copyOnly: copyOnly,
        _newJobId: rotateJobId,
        _inlineAddSection: inlineAddSection,
        _inlineRemoveSection: inlineRemoveSection,
        _inlineAddExamSection: inlineAddExamSection,
        _inlineRemoveExamSection: inlineRemoveExamSection,
        _inlineAddSegment: inlineAddSegment,
        _inlineInheritSegment: inlineInheritSegment,
        _inlineImportFromRangePack: inlineImportFromRangePack,
        _inlineRemoveSegment: inlineRemoveSegment,
        _inlineDistribute: inlineDistribute,
        _inlineImportFromSiblingAudio: inlineImportFromSiblingAudio,
        _inlineRefreshAvail: inlineRefreshAvail,
        _inlineOnSheetSelectChange: inlineOnSheetSelectChange,
        _inlineResetPaper: inlineGeneratePaperNow,
        _inlineGeneratePaperNow: inlineGeneratePaperNow,
        _inlineRegradeExistingPaper: inlineRegradeExistingPaper,
        refreshTaskPaperFromTemplate: refreshTaskPaperFromTemplate,
        _refreshAfterAudioSnapshot: refreshAfterAudioSnapshot,
        getSiblingAudioRangeLabel: getSiblingAudioRangeLabel,
        getExamRangeLabel: getExamRangeLabel,
        buildExamRangeLabelFromTask: buildExamRangeLabelFromTask,
        applyRangePackToExam: applyRangePackToExam,
        _inlineExport: inlineExport,
        _inlineGeneratePaper: inlineGeneratePaper,
        /** 手動逃生口：只在 needsExamRegeneration 為 true 時才會出現的按鈕用（見上方雷區說明） */
        _inlineForceGeneratePaper: inlineGeneratePaperNow,
        _inlineOnExamMaterialChange: inlineOnExamMaterialChange,
        _inlineOnExamMaterialFolderSelectChange: inlineOnExamMaterialFolderSelectChange,
        _inlineToggleForceStandalone: inlineToggleForceStandalone,
        _inlineToggleInputPracticeCount: inlineToggleInputPracticeCount,
        _inlineReloadMaterialFolders: inlineReloadMaterialFolders,
        _inlineRefreshStandaloneMeta: inlineRefreshStandaloneMeta,
        _inlineOnLayoutChange: function (pathStr) {
            if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
            const task = getBuilderTaskByPath(pathStr);
            if (!task) return;
            syncInlineEditor(pathStr, task);
            refreshExamBuilder();
        },
        refreshExamBuilder: refreshExamBuilder,
        _inlineApplyLastConfig: applyLastConfigForClass,
        getCachedLastConfigForClass: getCachedLastConfigForClass,
        /** 給「儲存作業」批次流程用：這個考試任務的設定是否需要（重新）產生線上卷 */
        needsExamRegeneration: needsExamRegeneration,
        examJobLooksReady: examJobLooksReady,
        ensureExamPaperSignatureBackfilled: ensureExamPaperSignatureBackfilled,
        taskHasSubmittedAnswers: taskHasSubmittedAnswers,
        /** 給「儲存作業」批次流程用：靜音產生（不彈 flash/alert），並跳過內部自動存檔（外層會整包存） */
        generatePaperForSave: function (pathStr) {
            return inlineGeneratePaper(pathStr, { silent: true, skipAutoSave: true });
        },
        /** 舊內建 6 個 id 已刪，搭配頁那塊不再有選項。 */
        getLayoutCatalog: function () { return []; },
        // 2026-08-14（分離「擷取範本」與「考卷範本」）：考卷範本 CRUD／快取，給
        // feature-exam-template-editor.js 的編輯器 UI 用；resolveExamTemplateProfile 給任何
        // 需要「依 layout_profile_id 換算實際排版公式」的地方共用（新格式／舊字串／tpl: 都吃）。
        fetchExamTemplates: fetchExamTemplates,
        getExamTemplatesCachedSync: getExamTemplatesCachedSync,
        createExamTemplate: createExamTemplate,
        updateExamTemplate: updateExamTemplate,
        deleteExamTemplate: deleteExamTemplate,
        resolveExamTemplateProfile: resolveExamTemplateProfile,
        /** 給「🧩 教材/Layout 搭配」central 頁用：某根目錄下不重複的教材資料夾名稱清單（跟獨立考試教材資料夾下拉共用同一份快取） */
        getUniqueFolderNames: function (classId, rootKind) {
            const entry = window.FeatureTimeline && typeof window.FeatureTimeline.getMetaCatalogEntry === 'function'
                ? window.FeatureTimeline.getMetaCatalogEntry(classId, rootKind) : null;
            return uniqueFolderNamesFromEntry(entry);
        },
        /** 給「🧩 教材/Layout 搭配」central 頁用：某資料夾底下不重複的「活頁」stem 清單 */
        getSheetStemsForFolder: function (classId, rootKind, materialFolder) {
            return examSheetStemsForFolder(classId, rootKind, materialFolder);
        },
        /**
         * 給「🧩 教材/Layout 搭配」central 頁用：某資料夾底下偵測到的原始檔名（未去除 .meta.json），
         * 供老師自行核對「活頁清單是不是真的抓對檔案」，不用猜系統怎麼推導出 stem。
         */
        getRawFileNamesForFolder: function (classId, rootKind, materialFolder) {
            return rawMetaFileNamesForFolder(classId, rootKind, materialFolder);
        },
        /**
         * 給「教材/Layout 搭配」的「產生並上傳」功能用：某資料夾名稱對應的實際 Drive folderId
         * （來自 GAS list_material_masters 回的 pack.folderId，見 feature-timeline.js
         * collectMaterialMetaOptions 2026-08-06 補的欄位）。資料夾即使 0 個 .meta.json
         * 也查得到（該情境正是這個新功能的主要使用場景：對著空資料夾寫入第一份 meta.json）。
         * 查不到回空字串，呼叫端要自行判斷「這個資料夾在 Drive 上還不存在」並走建立資料夾流程。
         */
        getFolderIdForFolder: function (classId, rootKind, materialFolder) {
            if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMetaCatalogEntry !== 'function') return '';
            const folder = String(materialFolder || '').trim();
            if (!folder) return '';
            const entry = window.FeatureTimeline.getMetaCatalogEntry(classId, rootKind);
            const opts = (entry && entry.options) || [];
            for (let i = 0; i < opts.length; i++) {
                if (String((opts[i] && opts[i].folderName) || '').trim() === folder && opts[i].folderId) {
                    return opts[i].folderId;
                }
            }
            return '';
        }
    };
    } catch (loadErr) {
        console.error('[FeatureExamJob] 載入失敗', loadErr);
        return { _loadError: (loadErr && loadErr.message) ? loadErr.message : String(loadErr) };
    }
})();

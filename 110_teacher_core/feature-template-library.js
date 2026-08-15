/**
 * 📂 檔案路徑：110_teacher_core/feature-template-library.js
 * 🎯 職責：「範本庫」共用資料層——material_templates 這張表的唯一存取入口。
 *
 * 2026-08-14（老師提出）：原本切成兩張表（material_extraction_templates／material_exam_templates）
 * ＋兩個各自獨立的編輯器，遇到「同一份教材，擷取範本也能當考題範本」時，只能靠複製一份公式到
 * 另一張表，變成兩筆各自獨立、要手動保持同步的紀錄。改成一張表＋兩個角色勾選框
 * （is_extraction_role／is_exam_role）：只勾一個＝單用；兩個都勾＝雙用（同一筆，不用維護兩份）；
 * 角色是老師自己勾的，不是系統自動判斷、不是自動雙用。
 *
 * 這個檔案是「單一資料來源」──`110_teacher_core/feature-material-layout-pairing.js`（擷取範本
 * 那一側 UI／欄位對應設計）跟 `110_teacher_core/feature-exam-job.js`（考卷範本那一側 UI／出題
 * 下拉）都改成呼叫這裡的 CRUD／快取／角色篩選，不再各自直接讀寫資料庫。
 *
 * 見 supabase/migrations/20260814170000_create_material_templates_unified.sql（建表＋搬資料）、
 * 20260814171000_refk_material_templates.sql（三個 FK 改接到這張表）。
 */
window.FeatureTemplateLibrary = (function () {
    'use strict';

    const DEFAULT_LINES_PER_PAGE = 10;

    let _cache = null;
    let _loadPromise = null;

    async function getCurrentUserId() {
        if (!window.supabaseClient) return null;
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        return user ? user.id : null;
    }

    async function requireUserId() {
        const id = await getCurrentUserId();
        if (!id) throw new Error('尚未登入');
        return id;
    }

    function mapRow(row) {
        return {
            id: row.id,
            name: row.name || '',
            is_extraction_role: !!row.is_extraction_role,
            is_exam_role: !!row.is_exam_role,
            sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
            // 擷取角色欄位
            columns: Array.isArray(row.columns) ? row.columns : [],
            designed_from: row.designed_from || null,
            answer_mode: row.answer_mode || 'combine',
            answer_combine_note: row.answer_combine_note || '',
            speak_mode: row.speak_mode || 'formula',
            speak_formula: row.speak_formula || '',
            legacy_id: row.legacy_id || '',
            // 試卷角色欄位
            fields: row.fields || '',
            fields_answer: row.fields_answer || '',
            quiz_prompt: row.quiz_prompt || '',
            quiz_answer: row.quiz_answer || '',
            lines_per_page: row.lines_per_page || DEFAULT_LINES_PER_PAGE,
            legacy_profile_id: row.legacy_profile_id || '',
            is_builtin_seed: !!row.is_builtin_seed,
            updated_at: row.updated_at
        };
    }

    const SELECT_COLUMNS = 'id, name, is_extraction_role, is_exam_role, sort_order, columns, designed_from, '
        + 'answer_mode, answer_combine_note, speak_mode, speak_formula, legacy_id, '
        + 'fields, fields_answer, quiz_prompt, quiz_answer, lines_per_page, legacy_profile_id, '
        + 'is_builtin_seed, created_at, updated_at';

    async function fetchTemplates(force) {
        if (_cache && !force) return _cache;
        if (_loadPromise && !force) return _loadPromise;
        _loadPromise = (async function () {
            const userId = await getCurrentUserId();
            if (!userId) { _cache = _cache || []; return _cache; }
            const { data, error } = await window.supabaseClient
                .from('material_templates')
                .select(SELECT_COLUMNS)
                .eq('teacher_id', userId)
                .is('deleted_at', null)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });
            if (error) {
                console.warn('[FeatureTemplateLibrary] 讀取範本庫失敗', error);
                _cache = _cache || [];
                return _cache;
            }
            _cache = (data || []).map(mapRow);
            return _cache;
        })().finally(function () { _loadPromise = null; });
        return _loadPromise;
    }

    /** 供渲染用（無法 await）：還沒載入過就背景觸發一次，先回目前已知的（可能是空陣列） */
    function getTemplatesCachedSync() {
        if (_cache === null && !_loadPromise) fetchTemplates(false).catch(function () {});
        return _cache || [];
    }

    function getExtractionTemplates() {
        return getTemplatesCachedSync().filter(function (t) { return t.is_extraction_role; });
    }

    function getExamTemplates() {
        return getTemplatesCachedSync().filter(function (t) { return t.is_exam_role; });
    }

    function sanitizePayload(fields) {
        const f = fields || {};
        const out = {};
        if (f.name !== undefined) out.name = String(f.name || '').trim() || '未命名範本';
        if (f.is_extraction_role !== undefined) out.is_extraction_role = !!f.is_extraction_role;
        if (f.is_exam_role !== undefined) out.is_exam_role = !!f.is_exam_role;
        if (f.columns !== undefined) out.columns = Array.isArray(f.columns) ? f.columns : [];
        if (f.designed_from !== undefined) out.designed_from = f.designed_from || null;
        if (f.answer_mode !== undefined) out.answer_mode = f.answer_mode === 'separate' ? 'separate' : 'combine';
        if (f.answer_combine_note !== undefined) out.answer_combine_note = f.answer_combine_note || '';
        if (f.speak_mode !== undefined) out.speak_mode = ['formula', 'complex', 'paste'].indexOf(f.speak_mode) !== -1 ? f.speak_mode : 'formula';
        if (f.speak_formula !== undefined) out.speak_formula = f.speak_formula || '';
        if (f.fields !== undefined) out.fields = f.fields || '';
        if (f.fields_answer !== undefined) out.fields_answer = f.fields_answer || '';
        if (f.quiz_prompt !== undefined) out.quiz_prompt = f.quiz_prompt || '';
        if (f.quiz_answer !== undefined) out.quiz_answer = f.quiz_answer || '';
        if (f.lines_per_page !== undefined) out.lines_per_page = Number(f.lines_per_page) || DEFAULT_LINES_PER_PAGE;
        if (f.sort_order !== undefined) out.sort_order = Number(f.sort_order) || 0;
        return out;
    }

    /**
     * 新增一筆範本（呼叫端決定角色；不指定角色時交給資料庫預設值：is_extraction_role=true）。
     * 沒有明確指定 sort_order 就排在目前清單最後面，不會插到老師已經排好順序的中間。
     */
    async function createTemplate(fields) {
        const teacherId = await requireUserId();
        const payload = Object.assign({ teacher_id: teacherId }, sanitizePayload(fields));
        if (payload.sort_order === undefined) payload.sort_order = getTemplatesCachedSync().length;
        const { data, error } = await window.supabaseClient
            .from('material_templates').insert(payload).select('id').single();
        if (error) throw error;
        await fetchTemplates(true);
        return data.id;
    }

    /** 局部更新——只寫呼叫端明確給的欄位，不會不小心洗掉另一個角色的資料（雙用範本安全關鍵） */
    async function updateTemplate(id, fields) {
        const payload = Object.assign(sanitizePayload(fields), { updated_at: new Date().toISOString() });
        const { error } = await window.supabaseClient.from('material_templates').update(payload).eq('id', id);
        if (error) throw error;
        await fetchTemplates(true);
    }

    /**
     * 角色感知的移除：只關掉「這個角色」的勾選，不會動到另一個角色的資料。
     * 兩個角色都關掉之後才真的軟刪除（deleted_at）——避免雙用範本被其中一邊的「刪除」
     * 按鈕整筆砍掉，波及另一邊還在用的資料／FK 參照（material_combination_exam_templates 等）。
     * @param {string} id
     * @param {'extraction'|'exam'} role
     */
    async function removeRole(id, role) {
        const list = getTemplatesCachedSync();
        let t = list.find(function (x) { return x.id === id; });
        if (!t) {
            await fetchTemplates(true);
            t = getTemplatesCachedSync().find(function (x) { return x.id === id; });
        }
        if (!t) return;
        const nextExtraction = role === 'extraction' ? false : t.is_extraction_role;
        const nextExam = role === 'exam' ? false : t.is_exam_role;
        const payload = { is_extraction_role: nextExtraction, is_exam_role: nextExam, updated_at: new Date().toISOString() };
        if (!nextExtraction && !nextExam) payload.deleted_at = new Date().toISOString();
        const { error } = await window.supabaseClient.from('material_templates').update(payload).eq('id', id);
        if (error) throw error;
        await fetchTemplates(true);
    }

    /**
     * 幫某一筆已存在的範本「加開」一個角色（勾選試卷範本／擷取範本 checkbox 那一刻呼叫）。
     * 若加開的是試卷角色，且目前 fields／fields_answer 都是空的，用欄位對應現算一次當草稿
     * 預填（不是每次都重算，只在這裡「加開角色」這一次性動作發生）。
     * 2026-08-14（老師回報）：每頁行數（lines_per_page）不在這裡預填／覆寫——它本質是「擷取範本」
     * 自己的排版設定（見 feature-material-layout-pairing.js 的編輯表單），只有一個欄位、沒有
     * 分「擷取版」「試卷版」兩份，加開試卷角色時這筆範本原本的 lines_per_page（無論是預設值還是
     * 老師已經自訂過的值）直接沿用，不要在這裡動它，否則會把老師在擷取範本編輯器裡填好的數字蓋回預設 10。
     * @param {string} id
     * @param {'extraction'|'exam'} role
     */
    async function addRole(id, role) {
        const list = getTemplatesCachedSync();
        const t = list.find(function (x) { return x.id === id; });
        if (!t) throw new Error('找不到範本');
        const payload = { updated_at: new Date().toISOString() };
        if (role === 'exam') {
            payload.is_exam_role = true;
            if (!t.fields && !t.fields_answer) {
                const draft = computeExamDraftFromColumns(t);
                payload.fields = draft.fields;
                payload.fields_answer = draft.fields_answer;
            }
        } else {
            payload.is_extraction_role = true;
        }
        const { error } = await window.supabaseClient.from('material_templates').update(payload).eq('id', id);
        if (error) throw error;
        await fetchTemplates(true);
    }

    /**
     * 把某一筆範本，在「目前畫面上這份清單」（例如篩選過 is_extraction_role 的清單，已經是排好
     * 順序的陣列）裡往上／下移一格。實際落地是重新分配全域 sort_order——只把這一筆範本移動跨過
     * 牠在這份清單裡的相鄰那一筆，兩者之間如果夾著「這份清單看不到、但角色不同的其他範本」，
     * 會被自然一起往前/後帶，不影響那些範本彼此的相對順序，也不影響它們在自己那個角色清單裡的
     * 相對位置。擷取範本清單跟試卷範本清單共用同一個全域順序，這裡是唯一改順序的入口。
     * @param {string} id
     * @param {'up'|'down'} direction
     * @param {Array<{id:string}>} visibleList 呼叫端目前畫面上顯示的（已篩選＋已排序）陣列
     */
    async function moveTemplateInVisibleList(id, direction, visibleList) {
        const list = Array.isArray(visibleList) ? visibleList : [];
        const visIdx = list.findIndex(function (t) { return t.id === id; });
        if (visIdx === -1) return;
        const neighborIdx = direction === 'up' ? visIdx - 1 : visIdx + 1;
        if (neighborIdx < 0 || neighborIdx >= list.length) return; // 已經在這份清單的邊界，不用動
        const neighborId = list[neighborIdx].id;

        const full = getTemplatesCachedSync();
        const ids = full.map(function (t) { return t.id; });
        const withoutId = ids.filter(function (x) { return x !== id; });
        const neighborPos = withoutId.indexOf(neighborId);
        const insertAt = direction === 'up' ? neighborPos : neighborPos + 1;
        withoutId.splice(insertAt, 0, id);
        await persistSortOrder(withoutId);
    }

    /** 依給定的完整 id 順序，只更新真的變動過 sort_order 的那些列（減少不必要的寫入） */
    async function persistSortOrder(idsInOrder) {
        const current = getTemplatesCachedSync();
        const currentSortById = {};
        current.forEach(function (t) { currentSortById[t.id] = t.sort_order; });
        for (let i = 0; i < idsInOrder.length; i++) {
            const id = idsInOrder[i];
            if (currentSortById[id] === i) continue;
            const { error } = await window.supabaseClient
                .from('material_templates').update({ sort_order: i }).eq('id', id);
            if (error) throw error;
        }
        await fetchTemplates(true);
    }

    /**
     * 依擷取角色的欄位對應（is_info／is_question／is_answer＋semantic_key），算出「一次性預填」
     * 的考卷公式草稿——跟舊版 buildProfileFromTemplate() 完全同一套演算法，只是現在是這裡的
     * 唯一實作，其他地方都改成呼叫這個函式，不再各自重寫一份。只在「加開試卷角色」那一刻呼叫
     * 一次；呼叫完之後這筆範本的 fields／fields_answer 就是獨立存的值，不會因為欄位對應改變
     * 就自動重算連動——這是跟「自動雙用」的關鍵差異。
     * @param {{columns: Array, answer_mode?: string}} template
     * @returns {{fields:string, fields_answer:string, lines_per_page:number}}
     */
    function computeExamDraftFromColumns(template) {
        const cols = Array.isArray(template && template.columns) ? template.columns : [];
        const infoKeys = cols.filter(function (c) { return c && c.is_info && c.semantic_key; }).map(function (c) { return c.semantic_key; });
        const questionKeys = cols.filter(function (c) { return c && c.is_question && c.semantic_key; }).map(function (c) { return c.semantic_key; });
        const answerKeys = cols.filter(function (c) { return c && c.is_answer && c.semantic_key; }).map(function (c) { return c.semantic_key; });

        const segments = [];
        if (infoKeys.length) segments.push('STACK(' + infoKeys.join(',') + ')');
        questionKeys.forEach(function (k) { segments.push(k); });
        const fields = segments.join(', ');

        const sep = (template && template.answer_mode === 'separate') ? ' / ' : ' ';
        const fieldsAnswer = answerKeys.length ? ('TEXTJOIN("' + sep + '", ' + answerKeys.join(', ') + ')') : '""';

        // 每頁行數不是「考卷角色」現算的東西——它是這筆範本（擷取角色）本來就有的排版設定，
        // 這裡直接沿用範本自己的值，沒有就退回預設 10，不要另外算一個跟範本本身不一致的數字。
        return { fields: fields, fields_answer: fieldsAnswer, lines_per_page: (template && template.lines_per_page) || DEFAULT_LINES_PER_PAGE };
    }

    /**
     * 統一考卷排版解析：新格式 uuid／legacy_profile_id（舊 LAYOUT_CATALOG 字串）／
     * legacy_id（遷移前 mft_xxx 字串）／'tpl:{uuid或字串id}'（唯讀相容前綴，歷史上已經存過
     * 的舊 exam_job／quiz_paper 紀錄用）四種來源統一解析成同一份 profile 形狀，取代原本分散在
     * feature-material-layout-pairing.js（resolveTemplateProfile）跟 feature-exam-job.js
     * （resolveExamTemplateProfile）的兩份邏輯。
     * @returns {{profile_id, label, fields, fields_answer, quiz_prompt, quiz_answer, lines_per_page}|null}
     */
    function resolveTemplateProfile(pid) {
        const raw = String(pid || '').trim();
        if (!raw) return null;
        const id = raw.indexOf('tpl:') === 0 ? raw.slice(4) : raw;
        if (!id) return null;
        const list = getTemplatesCachedSync();
        const t = list.find(function (x) { return x.id === id; })
            || list.find(function (x) { return x.legacy_id && x.legacy_id === id; })
            || list.find(function (x) { return x.legacy_profile_id && x.legacy_profile_id === id; });
        if (!t) return null;
        // 有勾試卷角色且已存公式才直接用；否則（例如只勾了擷取角色，走舊版 tpl: 相容路徑）
        // 現算一次當唯讀預覽，不寫回資料庫
        const hasStoredExamFormula = t.is_exam_role && (t.fields || t.fields_answer);
        const draft = hasStoredExamFormula
            ? { fields: t.fields, fields_answer: t.fields_answer, lines_per_page: t.lines_per_page }
            : computeExamDraftFromColumns(t);
        return {
            profile_id: t.id,
            label: t.name,
            fields: draft.fields || '',
            fields_answer: draft.fields_answer || '""',
            quiz_prompt: t.quiz_prompt || '',
            quiz_answer: t.quiz_answer || '',
            lines_per_page: draft.lines_per_page || t.lines_per_page || DEFAULT_LINES_PER_PAGE
        };
    }

    return {
        fetchTemplates: fetchTemplates,
        getTemplatesCachedSync: getTemplatesCachedSync,
        getExtractionTemplates: getExtractionTemplates,
        getExamTemplates: getExamTemplates,
        createTemplate: createTemplate,
        updateTemplate: updateTemplate,
        removeRole: removeRole,
        addRole: addRole,
        moveTemplateInVisibleList: moveTemplateInVisibleList,
        computeExamDraftFromColumns: computeExamDraftFromColumns,
        resolveTemplateProfile: resolveTemplateProfile
    };
})();

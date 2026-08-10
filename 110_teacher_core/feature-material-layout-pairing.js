/**
 * 📂 檔案路徑：110_teacher_core/feature-material-layout-pairing.js
 * 🎯 職責：老師個人「教材↔️考試 layout 搭配」中央管理端。
 *
 * 只是「建議清單」，不是強制規則：
 * - 老師在這裡登記「某教材資料夾（可選：某個活頁）通常搭配哪些 layout_profile_id」
 * - 出題畫面（feature-exam-job.js）選好教材資料夾／活頁後，layout_profile_id 下拉會把
 *   這裡登記過的選項標「⭐建議」排到最前面，但老師仍可自由選其他 layout
 * - 同一活頁需要兩份不同 layout（例如「整句翻譯」＋「句子填空」都要）→ 分別建立兩個考試任務，
 *   各自的 exam_job.layout_profile_id 各設一個即可，不是在同一個 exam_job 裡混兩種
 *   （exam_job 的 layout_profile_id 是「整份考卷」層級，這是既有對外 Python 排版契約，不可拆成逐區段）
 *
 * 儲存位置：沿用老師 profiles.raw_data.material_layout_pairs（不新增資料表，見
 * 020_js_core/teacher-prefs.js 的既有作法）。
 *
 * 💣 雷區（2026-08-04）：教材資料夾／活頁絕對不能是純文字輸入框要老師手打
 * （跟 exam-standalone-material-invariant.mdc 同精神）。清單來源重用
 * FeatureTimeline.ensureMetaCatalog／FeatureExamJob.getUniqueFolderNames／
 * getSheetStemsForFolder，不得自己另寫一份 Drive 讀檔邏輯。
 */
window.FeatureMaterialLayoutPairing = (function () {
    'use strict';

    /** @type {Array<object>|null} 目前已知的搭配清單（登入後背景載入一次） */
    let _cache = null;
    let _loadPromise = null;

    /**
     * 「從本機 Excel 讀取活頁／欄位」小工具的暫存狀態（只存在記憶體，不上傳；「確定選取」的
     * 內容要按「儲存」才會落地到 profiles.raw_data.material_field_templates）。
     *
     * 2026-08-05 第七輪修正（老師明確更正）：每一「組」（segment）本身就是一份獨立的 Template——
     * 各自有自己要套用的活頁（checkedSheets）、自己的名字（name）、自己的儲存按鈕，
     * 不是全部組共用同一份活頁清單、共用同一顆區塊層級的儲存鈕。「＋新增一組」＝再建一份獨立 Template。
     * 2026-08-08：這裡原本寫「layout」，老師明確指出誤導——存的不只是欄位排版，還有題目/答案/
     * 訊息角色與答案／口說答案批改標準，統一正名「Template」（跟畫面上的用字一致）。
     *
     * _excelSegments = [ segment, segment, ... ]（每一組都是獨立的一份 Template）
     * segment = { id, name, checkedSheets:{活頁名稱:布林}, checks:{欄位字母:布林}, gridCollapsed, confirmed,
     *             mapping:{rowStart, rowEnd, colSemantic:{欄位字母:資料項名稱}} }
     * _excelMaterialFolder／_excelFileName：這個 Excel 檔案歸屬的教材資料夾／來源檔名（所有組共用同一個檔案）
     */
    /**
     * 效能雷區（2026-08-05）：老師的 Excel 常常有一堆用不到的分頁（錯題本／列印範本／DB 舊資料…），
     * 若一次 XLSX.read() 整份解析，活頁越多、資料越大就越慢。改成兩階段：
     * 1) 選檔時只用 { bookSheets: true } 拿活頁名稱（極快，不解析任何欄位資料）
     * 2) 老師勾選某活頁、要預覽欄位時，才針對「那一個活頁」用 { sheets: [name] } 單獨解析＋快取，
     *    不會因為其他分頁而變慢；同一個活頁不會重複解析第二次。
     */
    let _excelWb = null;
    /** @type {Uint8Array|null} 原始檔案位元組，留著供之後單獨解析某個活頁用 */
    let _excelRawData = null;
    let _excelFileName = '';
    let _excelMaterialFolder = '';
    /** @type {Array<object>} */
    let _excelSegments = [];
    /** @type {Object<string, Array<object>>} 活頁名稱 → 已解析出的欄位清單（避免重複解析） */
    let _excelSheetColumnsCache = {};
    /** @type {Object<string, Array<Array<*>>>} 活頁名稱 → 逐列矩陣（供「設計 Template」卡片內的即時 meta 預覽用，跟套用到教材各自 appId 的快取分開） */
    let _excelSegPreviewMatrixCache = {};

    function ensureExcelSegments() {
        if (!_excelSegments.length) _excelSegments = [newExcelSegment()];
        return _excelSegments;
    }

    /**
     * 已知「資料項名稱」（semantic_key）清單種子，來自 material_templates/_Setup.csv／README
     * 已經在用的名稱。老師在下拉選「✏️ 其他（手動輸入）」新打的名稱，也會併入這份清單，
     * 讓同一次操作裡（切換活頁／欄位）不用重打第二次。
     * image_url：連結圖片用的路徑（Google Drive 或外部網址皆可）；日後實際套用時再處理怎麼顯示圖片。
     *
     * 2026-08-08：舊種子清單裡原本有 'script'，老師明確要求改掉——這個名字撞了兩個不同時期、
     * 不同意義的用法：(1) 舊版 GEPT 教材慣例，指「書寫答案（英文）」欄位；(2) 這次新增的
     * 「口說答案」概念（is_ai_ref，見上方角色勾選），輸出檔案固定叫 script.txt。兩者疊在
     * 同一個字上，老師選欄位時很容易誤以為選了「口說答案」實際卻是「書寫答案」。改成
     * 'answer_en'（書寫答案／英文內容），跟 SEMANTIC_KEY_SEED 其它命名風格（blank_1_zh、
     * display_zh 都是「角色_語言」）一致，也不再跟 is_ai_ref／script.txt 的概念撞名。
     * 這只是「下拉建議清單」，不影響已經發布、已經真的用 'script' 當 semantic_key 的舊教材
     * ——那些檔案的資料照樣讀得到（semantic_key 本身是自由字串，不是列舉），也不影響
     * quiz-paper-builder.js 那份給「沒有 quiz_prompt/quiz_answer 公式」舊教材用的
     * FALLBACK_COL_MAP／row.script 相容 fallback（那是刻意保留給舊資料的相容路徑，不是
     * 這次要修的東西，見該檔案的說明）。
     */
    const SEMANTIC_KEY_SEED = ['vBK_name', 'page', 'item_no', 'display_zh', 'pos', 'pre', 'answer_en', 'article', 'sheet_id', 'blank_1', 'blank_2', 'blank_1_zh', 'blank_2_zh', 'image_url'];
    let _sessionSemanticKeys = [];

    function newExcelSegment() {
        return {
            id: 'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            /** 這組（＝一份 Template）自己的活頁選擇，不同組可以套用到不同活頁（見 2026-08-05 第七輪修正） */
            checkedSheets: {},
            name: '',
            checks: {},
            gridCollapsed: false,
            confirmed: false,
            /** savedOnce：這組有沒有成功存過至少一次 Template。用來擋「＋新增一組」——
             * 上一組還沒存就先開新的一組，畫面會同時有兩組半成品，老師容易搞混（2026-08-05 第九輪） */
            savedOnce: false,
            /**
             * colRole：{question, answer, info} 三個完全獨立的布林值，互不連動、可任意組合。
             * 2026-08-05 第十輪雷區：曾經把「訊息」做成「題目＋答案的別名」（勾訊息＝自動勾題目+答案），
             * 結果資料跟老師自己手動勾兩個一模一樣，訊息這個標記毫無意義（老師怒斥「這當然是bug」）。
             * 正解：訊息（info）是完全獨立的第三軸——「這欄是不是被考的內容」，跟「印在哪張紙上」
             * （question/answer）是兩件不同的事。vBK_name／page／item_no 這類參考資訊只勾 info，
             * 不該被標成 question/answer=true，否則批改/算題數邏輯會誤把它們算成一道題目或一個答案。
             *
             * 2026-08-05 第十三輪雷區（架構修正）：這裡本來還有 rowStart/rowEnd——是錯的。
             * Layout Template 是「規則」（欄位代號→資料項名稱＋題目/答案/訊息），跟任何一個
             * 實際檔案脫鉤、可重複套用；行數起迄是「把 Template 套用到某個實際檔案」才有意義的
             * 產物（不同檔案資料筆數不同），屬於下面新增的「套用（Application）」區塊，
             * 不該寫死存在 Template 本身裡面。
             *
             * 2026-08-07（老師澄清「答案」跟「AI對照稿」正名＋批改標準）：
             * - 答案 → 正名「書寫答案」；AI對照稿 → 正名「口說答案」。兩者不一定相同
             *   （例如書寫答案 to/a park，口說答案 to park a park）。
             * - 書寫答案欄數 > 1 時，須指明「答案批改標準」：分開比對 或 結合（可留公式備註）。
             * - 口說答案欄數與批改標準無直接關係，是獨立的第三種內容：帶入公式／之後會寫的
             *   複雜規則（先當貼上處理）／直接貼上多筆（標注起始題號），且一律允許逐列個別修正
             *   （見「📎 套用到教材」區塊的 speakOverrides）。
             */
            answerMode: 'combine',
            answerCombineNote: '',
            speakMode: 'formula',
            speakFormula: '',
            /**
             * 2026-08-07：rowStart／rowEnd 純粹是「設計 Template 時，用目前這個本機檔案立刻
             * 測試產生 meta 預覽」用的暫存值——不會存進 Template 本身（handleSaveSegment 的
             * record 沒有這兩個欄位），也不影響上面「行數起迄跟任何一個實際檔案脫鉤」的規則。
             * 正式產生／上傳仍然是「📎 套用到教材」區塊各自的 row_start／row_end 才算數。
             */
            rowStart: '2',
            rowEnd: '',
            mapping: { colSemantic: {}, colRole: {} }
        };
    }

    /** 書寫答案欄數（is_answer=true 的欄位數），決定要不要顯示「答案／口說答案批改標準」設定區塊 */
    function countAnswerColsFromRole(colRole) {
        return Object.keys(colRole || {}).filter(function (k) { return colRole[k] && colRole[k].answer; }).length;
    }

    function countAnswerColsFromColumns(columns) {
        return (Array.isArray(columns) ? columns : []).filter(function (c) { return c && c.is_answer; }).length;
    }

    /**
     * 「答案批改標準」＋「口說答案批改標準」共用設定區塊。cfg 需要有 answerMode／answerCombineNote／
     * speakMode／speakFormula 四個欄位（Excel 小工具的 seg 或 Template 編輯器的 _templateEditorState
     * 都符合）。只有書寫答案欄數 > 1 才顯示——欄數 ≤1 沒有「多欄怎麼合併／分開比對」的問題。
     */
    function renderAnswerGradingSettingsHtml(prefix, cfg, aCount) {
        if (aCount <= 1) return '';
        const answerMode = cfg.answerMode === 'separate' ? 'separate' : 'combine';
        const speakMode = ['formula', 'complex', 'paste'].indexOf(cfg.speakMode) !== -1 ? cfg.speakMode : 'formula';
        return `
            <div style="background:#FFF7ED; border:1px solid #FED7AA; border-radius:8px; padding:10px 12px; margin-top:10px;">
                <div style="font-size:0.76rem; font-weight:800; color:#B45309; margin-bottom:8px;">⚖️ 書寫答案共 ${aCount} 欄，請指明批改標準</div>
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.74rem; font-weight:800; color:#475569; margin-bottom:4px;">📝 書寫答案批改標準</div>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:pointer; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-answer-mode-${esc(cfg.id || '')}" class="${prefix}-answer-mode-opt" value="separate" ${answerMode === 'separate' ? 'checked' : ''}>
                        分開比對（每欄各自獨立比對，例如 AN、AO 各一個空格分開判定）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:pointer;">
                        <input type="radio" name="${prefix}-answer-mode-${esc(cfg.id || '')}" class="${prefix}-answer-mode-opt" value="combine" ${answerMode === 'combine' ? 'checked' : ''}>
                        結合成一個答案（用公式組合多欄，例如 AN&amp;" "&amp;AO）
                    </label>
                    <input type="text" class="form-control ${prefix}-answer-combine-note" value="${esc(cfg.answerCombineNote || '')}" placeholder='公式備註，例如 AN&amp;" "&amp;AO 或 pre&amp;" "&amp;script（僅供參考記錄，實際組合仍以 Layout Profile 的 quiz_answer 公式為準）' style="width:100%; padding:6px; margin-top:4px; font-size:0.78rem; display:${answerMode === 'combine' ? 'block' : 'none'};">
                </div>
                <div>
                    <div style="font-size:0.74rem; font-weight:800; color:#475569; margin-bottom:4px;">🎤 口說答案批改標準</div>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:pointer; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="formula" ${speakMode === 'formula' ? 'checked' : ''}>
                        帶入公式（可再逐列個別修正）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:pointer; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="complex" ${speakMode === 'complex' ? 'checked' : ''}>
                        之後會寫複雜規則（規則還沒定，先整批留白讓老師逐列輸入／修正）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:pointer;">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="paste" ${speakMode === 'paste' ? 'checked' : ''}>
                        直接貼上多筆資料（標注起始題號，可再逐列個別修正）
                    </label>
                    <input type="text" class="form-control ${prefix}-speak-formula" value="${esc(cfg.speakFormula || '')}" placeholder='例如 AN&amp;" "&amp;AO，可用資料項名稱或欄位代號' style="width:100%; padding:6px; margin-top:4px; font-size:0.78rem; display:${speakMode === 'formula' ? 'block' : 'none'};">
                </div>
                <div style="font-size:0.68rem; color:#92400E; margin-top:8px;">💡 這裡先記錄批改標準／預設公式；實際口說答案內容（含公式算出來的值／貼上的值）可以到下方「📎 套用到教材」→「產生預覽」後逐列個別修正，修正後的值才是最終寫入 meta.json／script.txt 的內容。</div>
            </div>
        `;
    }

    /** 對應 renderAnswerGradingSettingsHtml：把畫面上的選擇同步回 cfg，並處理公式輸入框顯示/隱藏 */
    function bindAnswerGradingSettingsEvents(wrapEl, prefix, cfg) {
        if (!wrapEl) return;
        wrapEl.querySelectorAll('.' + prefix + '-answer-mode-opt').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (!this.checked) return;
                cfg.answerMode = this.value;
                const noteEl = wrapEl.querySelector('.' + prefix + '-answer-combine-note');
                if (noteEl) noteEl.style.display = this.value === 'combine' ? 'block' : 'none';
            });
        });
        const noteEl = wrapEl.querySelector('.' + prefix + '-answer-combine-note');
        if (noteEl) noteEl.addEventListener('change', function () { cfg.answerCombineNote = this.value; });
        wrapEl.querySelectorAll('.' + prefix + '-speak-mode-opt').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (!this.checked) return;
                cfg.speakMode = this.value;
                const fEl = wrapEl.querySelector('.' + prefix + '-speak-formula');
                if (fEl) fEl.style.display = this.value === 'formula' ? 'block' : 'none';
            });
        });
        const fEl = wrapEl.querySelector('.' + prefix + '-speak-formula');
        if (fEl) fEl.addEventListener('change', function () { cfg.speakFormula = this.value; });
    }

    /** 書寫答案勾選狀態改變（欄數可能跨過 1↔2 這條門檻）時，重畫這個獨立小區塊，不用整塊欄位對應重繪 */
    function refreshAnswerGradingBlock(containerEl, prefix, cfg, aCount) {
        if (!containerEl) return;
        const wrap = containerEl.querySelector('.' + prefix + '-answer-grading-wrap');
        if (!wrap) return;
        wrap.innerHTML = renderAnswerGradingSettingsHtml(prefix, cfg, aCount);
        bindAnswerGradingSettingsEvents(wrap, prefix, cfg);
    }

    /** 欄位選取／欄位對應設定要「看」哪個活頁的欄位當預覽——現在活頁選擇是每組（Template）各自的 */
    function getReferenceSheetNameForSegment(seg) {
        const names = (_excelWb && Array.isArray(_excelWb.SheetNames)) ? _excelWb.SheetNames : [];
        for (let i = 0; i < names.length; i++) {
            if (seg.checkedSheets[names[i]]) return names[i];
        }
        return '';
    }

    /** @type {Array<object>|null} 老師已存的欄位設定 Template（見「大區塊」儲存功能） */
    let _fieldTemplatesCache = null;
    let _fieldTemplatesLoadPromise = null;

    /**
     * 2026-08-05 第十三輪（架構修正）：Layout Template 管理區塊自己的編輯狀態，跟 Excel 小工具的
     * _excelSegments 完全獨立——Template 管理不需要任何 Excel 檔案就能新增/編輯/刪除。
     * null＝目前沒在編輯（只顯示清單）；有值＝正在新增或編輯某一筆：
     * { id: string|null（null＝新增，有值＝編輯既有那一筆）, isNew: boolean, name: string,
     *   columns: [{letter, semantic_key, is_question, is_answer, is_info}], designed_from: object|null }
     */
    let _templateEditorState = null;

    /** @type {Array<object>|null} 老師已存的「Template 套用到教材」紀錄（profiles.raw_data.material_template_applications） */
    let _appCache = null;
    let _appLoadPromise = null;

    /**
     * 2026-08-06（老師更正套用區塊的規劃邏輯）：每一列套用（Application）自己的暫存 UI 狀態——
     * 「活頁來源」（本機 Excel 或 Google Drive 教材資料夾）＋「活頁可複選」的勾選狀態，
     * 跟持久化的 apps[] 分開放，存檔（collectAppsFromDom）時才收斂成 sheet_ids[] 寫回
     * profiles.raw_data。用 checkbox 而不是單選下拉，因為同一份 Template＋同一段行數範圍
     * 常常要一次套用到好幾個活頁（跟 Excel 設計小工具 seg.checkedSheets 同精神）。
     * { [appId]: { sourceKind:'drive'|'local', checkedSheets:{活頁名稱:bool}, localSheetNames:[], localFileName } }
     */
    let _appRowState = {};

    async function fetchFieldTemplates(force) {
        if (_fieldTemplatesCache && !force) return _fieldTemplatesCache;
        if (_fieldTemplatesLoadPromise && !force) return _fieldTemplatesLoadPromise;
        _fieldTemplatesLoadPromise = (async function () {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) { _fieldTemplatesCache = []; return _fieldTemplatesCache; }
            const { data: profile, error } = await window.supabaseClient
                .from('profiles')
                .select('raw_data')
                .eq('id', user.id)
                .maybeSingle();
            if (error) {
                console.warn('[FeatureMaterialLayoutPairing] 讀取欄位設定 Template 清單失敗', error);
                _fieldTemplatesCache = _fieldTemplatesCache || [];
                return _fieldTemplatesCache;
            }
            const raw = (profile && profile.raw_data) || {};
            _fieldTemplatesCache = Array.isArray(raw.material_field_templates) ? raw.material_field_templates : [];
            return _fieldTemplatesCache;
        })().finally(function () { _fieldTemplatesLoadPromise = null; });
        return _fieldTemplatesLoadPromise;
    }

    /** 供渲染用（無法 await）：還沒載入過就背景觸發一次，先回目前已知的（可能是空陣列） */
    function getFieldTemplatesCachedSync() {
        if (_fieldTemplatesCache === null && !_fieldTemplatesLoadPromise) fetchFieldTemplates(false).catch(function () {});
        return _fieldTemplatesCache || [];
    }

    async function saveFieldTemplates(list) {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) throw new Error('尚未登入');
        const { data: profile, error: readErr } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', user.id)
            .maybeSingle();
        if (readErr) throw readErr;
        const mergedRawData = Object.assign({}, (profile && profile.raw_data) || {}, { material_field_templates: list });
        const { error: updateErr } = await window.supabaseClient
            .from('profiles')
            .update({ raw_data: mergedRawData })
            .eq('id', user.id);
        if (updateErr) throw updateErr;
        _fieldTemplatesCache = list;
    }

    async function fetchTemplateApplications(force) {
        if (_appCache && !force) return _appCache;
        if (_appLoadPromise && !force) return _appLoadPromise;
        _appLoadPromise = (async function () {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) { _appCache = []; return _appCache; }
            const { data: profile, error } = await window.supabaseClient
                .from('profiles')
                .select('raw_data')
                .eq('id', user.id)
                .maybeSingle();
            if (error) {
                console.warn('[FeatureMaterialLayoutPairing] 讀取 Template 套用清單失敗', error);
                _appCache = _appCache || [];
                return _appCache;
            }
            const raw = (profile && profile.raw_data) || {};
            const list = Array.isArray(raw.material_template_applications) ? raw.material_template_applications : [];
            // 相容舊資料：2026-08-05 第十三輪存的是單選 sheet_id（字串），2026-08-06 改成可複選
            // sheet_ids（陣列）——讀取時把舊格式併成新格式的單元素陣列，不用寫遷移腳本
            _appCache = list.map(function (a) {
                return Object.assign({}, a, {
                    sheet_ids: Array.isArray(a.sheet_ids) ? a.sheet_ids : (a.sheet_id ? [a.sheet_id] : [])
                });
            });
            return _appCache;
        })().finally(function () { _appLoadPromise = null; });
        return _appLoadPromise;
    }

    function getTemplateApplicationsCachedSync() {
        if (_appCache === null && !_appLoadPromise) fetchTemplateApplications(false).catch(function () {});
        return _appCache || [];
    }

    async function saveTemplateApplications(list) {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) throw new Error('尚未登入');
        const { data: profile, error: readErr } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', user.id)
            .maybeSingle();
        if (readErr) throw readErr;
        const mergedRawData = Object.assign({}, (profile && profile.raw_data) || {}, { material_template_applications: list });
        const { error: updateErr } = await window.supabaseClient
            .from('profiles')
            .update({ raw_data: mergedRawData })
            .eq('id', user.id);
        if (updateErr) throw updateErr;
        _appCache = list;
    }

    function getKnownSemanticKeys() {
        const seen = {};
        const out = [];
        SEMANTIC_KEY_SEED.concat(_sessionSemanticKeys).forEach(function (k) {
            const key = String(k || '').trim();
            if (!key || seen[key]) return;
            seen[key] = true;
            out.push(key);
        });
        return out;
    }

    function rememberSemanticKey(key) {
        const clean = String(key || '').trim();
        if (!clean || getKnownSemanticKeys().indexOf(clean) !== -1) return;
        _sessionSemanticKeys.push(clean);
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    async function fetchPairs(force) {
        if (_cache && !force) return _cache;
        if (_loadPromise && !force) return _loadPromise;
        _loadPromise = (async function () {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) { _cache = []; return _cache; }
            const { data: profile, error } = await window.supabaseClient
                .from('profiles')
                .select('raw_data')
                .eq('id', user.id)
                .maybeSingle();
            if (error) {
                console.warn('[FeatureMaterialLayoutPairing] 讀取搭配清單失敗', error);
                _cache = _cache || [];
                return _cache;
            }
            const raw = (profile && profile.raw_data) || {};
            _cache = Array.isArray(raw.material_layout_pairs) ? raw.material_layout_pairs : [];
            return _cache;
        })().finally(function () { _loadPromise = null; });
        return _loadPromise;
    }

    /** 供出題畫面同步查詢用（無法 await 的渲染函式）；還沒載入過就回空陣列，不擋畫面 */
    function getCachedSync() {
        if (_cache === null && !_loadPromise) fetchPairs(false).catch(function () {});
        return _cache || [];
    }

    /**
     * 依教材資料夾（+可選活頁）找建議 layout_profile_id 清單，活頁完全比對優先於資料夾萬用比對，去重。
     * @param {string} materialFolder
     * @param {string[]} [sheetIds]
     * @returns {string[]}
     */
    function getSuggestedLayoutIds(materialFolder, sheetIds) {
        const folder = String(materialFolder || '').trim();
        if (!folder) return [];
        const sids = (sheetIds || []).map(function (s) { return String(s || '').trim().toUpperCase(); }).filter(Boolean);
        const pairs = getCachedSync().filter(function (p) { return p && String(p.material_folder || '').trim() === folder; });
        const exact = [];
        const wildcard = [];
        pairs.forEach(function (p) {
            const sid = String(p.sheet_id || '').trim().toUpperCase();
            const target = (!sid || sids.indexOf(sid) !== -1) ? (sid ? exact : wildcard) : null;
            if (!target) return;
            (Array.isArray(p.layout_profile_ids) ? p.layout_profile_ids : []).forEach(function (id) {
                if (id) target.push(id);
            });
        });
        const seen = {};
        return exact.concat(wildcard).filter(function (id) {
            if (seen[id]) return false;
            seen[id] = true;
            return true;
        });
    }

    async function savePairs(pairs) {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) throw new Error('尚未登入');
        const { data: profile, error: readErr } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', user.id)
            .maybeSingle();
        if (readErr) throw readErr;
        const mergedRawData = Object.assign({}, (profile && profile.raw_data) || {}, { material_layout_pairs: pairs });
        const { error: updateErr } = await window.supabaseClient
            .from('profiles')
            .update({ raw_data: mergedRawData })
            .eq('id', user.id);
        if (updateErr) throw updateErr;
        _cache = pairs;
    }

    function getLayoutCatalog() {
        return (window.FeatureExamJob && typeof window.FeatureExamJob.getLayoutCatalog === 'function')
            ? window.FeatureExamJob.getLayoutCatalog()
            : [];
    }

    /** 某根目錄（老師個人或指定班級）不重複的教材資料夾名稱，重用 FeatureExamJob 已暴露的 helper */
    function uniqueFolderNames(classId, rootKind) {
        return (window.FeatureExamJob && typeof window.FeatureExamJob.getUniqueFolderNames === 'function')
            ? window.FeatureExamJob.getUniqueFolderNames(classId, rootKind)
            : [];
    }

    /** 某資料夾底下不重複的「活頁」stem，重用 FeatureExamJob 已暴露的 helper */
    function sheetStemsForFolder(classId, rootKind, folder) {
        return (window.FeatureExamJob && typeof window.FeatureExamJob.getSheetStemsForFolder === 'function')
            ? window.FeatureExamJob.getSheetStemsForFolder(classId, rootKind, folder)
            : [];
    }

    /**
     * 某資料夾底下偵測到的原始檔名（未去除 .meta.json）。目的是讓老師能自己核對
     * 「系統抓到的活頁清單，是不是真的對應 Drive 裡實際存在的檔案」，不用猜系統怎麼推導。
     */
    function rawFileNamesForFolder(classId, rootKind, folder) {
        return (window.FeatureExamJob && typeof window.FeatureExamJob.getRawFileNamesForFolder === 'function')
            ? window.FeatureExamJob.getRawFileNamesForFolder(classId, rootKind, folder)
            : [];
    }

    function allClasses() {
        return (window.TeacherDB && Array.isArray(window.TeacherDB.classes)) ? window.TeacherDB.classes : [];
    }

    /**
     * 下拉選項 HTML：目前值找不到也保留（避免清單還沒載入就把已存值洗掉）；固定含「✏️ 其他（手動輸入）」逃生口。
     *
     * 2026-08-07 修正：呼叫端常常故意傳 `'__manual__'` 這個保留字當 currentValue，語意是
     * 「還沒有值、預設落到手動輸入」（例如第一次建立 Template，還沒有任何已存名稱可比對）。
     * 舊版把 `'__manual__'` 當成一般值去跟 items 比對，比對不到就誤判成「這個值曾經存在、
     * 現在清單裡找不到了」，多生出一個 `value="__manual__"` 的「⚠️ 找不到」選項、還把
     * selected 標在那顆假警告上，跟後面真正的「✏️ 其他（手動輸入）」選項同一個 value 互相打架
     * ——瀏覽器最後選中的是那顆假警告，老師會誤以為系統出錯，其實只是第一次建立、什麼都還沒選。
     * 修法：`__manual__` 一律當保留字看待，不進「找不到」判斷，直接把 selected 標在真正的
     * 手動輸入選項上。
     */
    function buildSelectOptionsHtml(items, currentValue, placeholderLabel) {
        const cur = String(currentValue || '');
        const isManualSentinel = cur === '__manual__';
        let matched = !cur || isManualSentinel;
        let html = '<option value="">' + esc(placeholderLabel) + '</option>';
        html += (items || []).map(function (item) {
            const isCur = item === cur;
            if (isCur) matched = true;
            return '<option value="' + esc(item) + '"' + (isCur ? ' selected' : '') + '>' + esc(item) + '</option>';
        }).join('');
        if (cur && !isManualSentinel && !matched) {
            html += '<option value="' + esc(cur) + '" selected>⚠️ ' + esc(cur) + '（清單中找不到）</option>';
        }
        html += '<option value="__manual__"' + (isManualSentinel ? ' selected' : '') + '>✏️ 其他（手動輸入）</option>';
        return html;
    }

    function classOptionsHtml(currentClassId) {
        const cur = String(currentClassId || '');
        let html = '<option value="">— 選班級 —</option>';
        html += allClasses().map(function (c) {
            const id = String(c.id || '');
            return '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' + esc(c.name || id) + '</option>';
        }).join('');
        return html;
    }

    /** 活頁下拉下方的核對用小字：老師可以自己比對「系統偵測到的原始檔名」跟 Drive 裡實際有的檔案是否一致 */
    function sheetHintText(classId, rootKind, folder) {
        const clean = String(folder || '').trim();
        if (!clean) return '';
        const files = rawFileNamesForFolder(classId, rootKind, clean);
        if (!files.length) return '⚠️ 目前在「' + clean + '」偵測到 0 個 .meta.json 檔（清單可能還沒載入，或該資料夾底下真的沒有活頁檔）';
        return '偵測到 ' + files.length + ' 個活頁檔案：' + files.join('、');
    }

    function renderRow(pair, layoutCatalog) {
        const rootKind = pair.root_kind === 'class' ? 'class' : 'teacher';
        const classFolders = rootKind === 'class' && pair.class_id ? uniqueFolderNames(pair.class_id, 'class') : [];
        const teacherFolders = rootKind === 'teacher' ? uniqueFolderNames('', 'teacher') : [];
        const folderOptions = rootKind === 'class' ? classFolders : teacherFolders;
        const folderSelectDisabled = rootKind === 'class' && !pair.class_id;
        const sheetOptions = pair.material_folder ? sheetStemsForFolder(pair.class_id || '', rootKind, pair.material_folder) : [];

        const layoutChips = layoutCatalog.map(function (l) {
            const checked = Array.isArray(pair.layout_profile_ids) && pair.layout_profile_ids.indexOf(l.id) !== -1;
            return '<label style="display:inline-flex; align-items:center; gap:4px; margin:2px 10px 2px 0; font-weight:700; font-size:0.82rem;">'
                + '<input type="checkbox" class="mlp-layout-chk" value="' + esc(l.id) + '" ' + (checked ? 'checked' : '') + '> ' + esc(l.label)
                + '</label>';
        }).join('');

        return `
            <div class="mlp-row" data-id="${esc(pair.id)}" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-bottom:10px;">
                <div class="mlp-row-fields" style="display:grid; grid-template-columns:100px 1fr 1fr 1fr auto; gap:8px; margin-bottom:6px; align-items:end;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;">歸屬
                        <select class="form-control mlp-rootkind" style="width:100%; padding:6px; margin-top:2px;">
                            <option value="teacher" ${rootKind === 'class' ? '' : 'selected'}>👤 老師個人</option>
                            <option value="class" ${rootKind === 'class' ? 'selected' : ''}>🏫 班級</option>
                        </select>
                    </label>
                    <label class="mlp-class-wrap" style="font-size:0.78rem; font-weight:800; color:#475569; ${rootKind === 'class' ? '' : 'display:none;'}">班級
                        <select class="form-control mlp-class" style="width:100%; padding:6px; margin-top:2px;">${classOptionsHtml(pair.class_id)}</select>
                    </label>
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;">教材資料夾
                        <select class="form-control mlp-folder" style="width:100%; padding:6px; margin-top:2px;" ${folderSelectDisabled ? 'disabled' : ''}>${buildSelectOptionsHtml(folderOptions, pair.material_folder, folderSelectDisabled ? '請先選班級' : '— 選教材資料夾 —')}</select>
                        <input type="text" class="form-control mlp-folder-manual" value="${esc(pair.material_folder || '')}" placeholder="手動輸入資料夾名稱" style="width:100%; padding:6px; margin-top:2px; display:none;">
                    </label>
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;">活頁（留空＝整個資料夾）
                        <select class="form-control mlp-sheet" style="width:100%; padding:6px; margin-top:2px;">${buildSelectOptionsHtml(sheetOptions, pair.sheet_id, '— 整個資料夾 —')}</select>
                        <input type="text" class="form-control mlp-sheet-manual" value="${esc(pair.sheet_id || '')}" placeholder="手動輸入活頁檔名" style="width:100%; padding:6px; margin-top:2px; display:none;">
                    </label>
                    <button type="button" class="btn mlp-remove" style="padding:6px 10px; color:#B91C1C; border:1px solid #FCA5A5; border-radius:6px; background:white;">刪除</button>
                </div>
                <div class="mlp-folder-status" style="font-size:0.75rem; color:#94A3B8; min-height:1em; margin-bottom:2px;"></div>
                <div class="mlp-sheet-hint" style="font-size:0.75rem; color:#94A3B8; min-height:1em; margin-bottom:4px;">${sheetHintText(pair.class_id || '', rootKind, pair.material_folder)}</div>
                <div style="font-size:0.78rem; font-weight:800; color:#475569; margin-bottom:4px;">建議搭配的 layout_profile_id（可多選）</div>
                <div>${layoutChips || '<span style="color:#94A3B8;">尚無可選 layout（FeatureExamJob 未載入）</span>'}</div>
            </div>
        `;
    }

    /** 換教材資料夾＝活頁清單整個換了，重畫該列的活頁下拉（不動其他列） */
    function refreshSheetSelect(rowEl) {
        const rootKind = rowEl.querySelector('.mlp-rootkind').value === 'class' ? 'class' : 'teacher';
        const classId = rowEl.querySelector('.mlp-class') ? rowEl.querySelector('.mlp-class').value : '';
        const folderSelectEl = rowEl.querySelector('.mlp-folder');
        const folder = folderSelectEl.value === '__manual__'
            ? rowEl.querySelector('.mlp-folder-manual').value.trim()
            : folderSelectEl.value;
        const sheetSelectEl = rowEl.querySelector('.mlp-sheet');
        const currentSheet = sheetSelectEl.value === '__manual__' ? '' : sheetSelectEl.value;
        const stems = folder ? sheetStemsForFolder(classId, rootKind, folder) : [];
        sheetSelectEl.innerHTML = buildSelectOptionsHtml(stems, currentSheet, '— 整個資料夾 —');
        const hintEl = rowEl.querySelector('.mlp-sheet-hint');
        if (hintEl) hintEl.textContent = sheetHintText(classId, rootKind, folder);
    }

    /**
     * 換歸屬／班級＝可選教材資料夾清單整個換了，重畫該列的資料夾＋活頁下拉。
     * 2026-08-06：載入／空清單／失敗重試這套流程已抽到共用模組 window.MaterialFolderPicker
     * （見 020_js_core/material-folder-picker.js），跟 refreshAppFolderSelect／
     * refreshExcelFolderSelect／feature-exam-job.js 的獨立考試教材資料夾下拉共用同一份實作，
     * 這裡只負責「這一列的畫面形狀」（分離的歸屬/教材資料夾下拉）。
     */
    function refreshFolderSelect(rowEl, forceRetry) {
        const rootKind = rowEl.querySelector('.mlp-rootkind').value === 'class' ? 'class' : 'teacher';
        const classSelectEl = rowEl.querySelector('.mlp-class');
        const classId = classSelectEl ? classSelectEl.value : '';
        const folderSelectEl = rowEl.querySelector('.mlp-folder');
        const statusEl = rowEl.querySelector('.mlp-folder-status');
        if (rootKind === 'class' && !classId) {
            folderSelectEl.disabled = true;
            folderSelectEl.innerHTML = buildSelectOptionsHtml([], '', '請先選班級');
            if (statusEl) statusEl.innerHTML = '';
            refreshSheetSelect(rowEl);
            return;
        }
        folderSelectEl.disabled = false;
        if (!window.MaterialFolderPicker) return;
        const catalogClassId = rootKind === 'class' ? classId : '';
        window.MaterialFolderPicker.refreshDropdown({
            classId: catalogClassId,
            rootKind: rootKind,
            force: !!forceRetry,
            getSelectEl: function () { return rowEl.querySelector('.mlp-folder'); },
            getStatusEl: function () { return rowEl.querySelector('.mlp-folder-status'); },
            listCurrentOptions: function () { return uniqueFolderNames(catalogClassId, rootKind); },
            renderOptionsHtml: function (list, currentValue) { return buildSelectOptionsHtml(list, currentValue, '— 選教材資料夾 —'); },
            onAfterUpdate: function () { refreshSheetSelect(rowEl); }
        });
    }

    function bindRowEvents(rowEl) {
        rowEl.querySelector('.mlp-remove').addEventListener('click', function () { rowEl.remove(); });

        rowEl.querySelector('.mlp-rootkind').addEventListener('change', function () {
            const isClass = this.value === 'class';
            rowEl.querySelector('.mlp-class-wrap').style.display = isClass ? '' : 'none';
            refreshFolderSelect(rowEl);
        });

        const classSelectEl = rowEl.querySelector('.mlp-class');
        if (classSelectEl) classSelectEl.addEventListener('change', function () { refreshFolderSelect(rowEl); });

        rowEl.querySelector('.mlp-folder').addEventListener('change', function () {
            rowEl.querySelector('.mlp-folder-manual').style.display = this.value === '__manual__' ? 'block' : 'none';
            refreshSheetSelect(rowEl);
        });
        rowEl.querySelector('.mlp-folder-manual').addEventListener('change', function () { refreshSheetSelect(rowEl); });

        rowEl.querySelector('.mlp-sheet').addEventListener('change', function () {
            rowEl.querySelector('.mlp-sheet-manual').style.display = this.value === '__manual__' ? 'block' : 'none';
        });
    }

    function collectPairsFromDom(container) {
        return Array.from(container.querySelectorAll('.mlp-row')).map(function (rowEl) {
            const rootKind = rowEl.querySelector('.mlp-rootkind').value === 'class' ? 'class' : 'teacher';
            const classId = rootKind === 'class' ? (rowEl.querySelector('.mlp-class') || {}).value || '' : '';
            const folderSelectEl = rowEl.querySelector('.mlp-folder');
            const folder = (folderSelectEl.value === '__manual__'
                ? rowEl.querySelector('.mlp-folder-manual').value
                : folderSelectEl.value).trim();
            const sheetSelectEl = rowEl.querySelector('.mlp-sheet');
            const sheetId = (sheetSelectEl.value === '__manual__'
                ? rowEl.querySelector('.mlp-sheet-manual').value
                : sheetSelectEl.value).trim();
            const layoutIds = Array.from(rowEl.querySelectorAll('.mlp-layout-chk:checked')).map(function (chk) { return chk.value; });
            return {
                id: rowEl.getAttribute('data-id'),
                material_folder: folder,
                root_kind: rootKind,
                class_id: classId,
                sheet_id: sheetId,
                layout_profile_ids: layoutIds
            };
        }).filter(function (p) { return p.material_folder; });
    }

    /** 讀本機 Excel 檔案（純前端 SheetJS 解析，不上傳），列出所有活頁分頁 */
    function handleExcelFileChange(inputEl) {
        const file = inputEl.files && inputEl.files[0];
        const statusEl = document.getElementById('mlp-excel-status');
        const folderFileWrap = document.getElementById('mlp-excel-folderfile');
        const blockWrap = document.getElementById('mlp-excel-block');
        _excelWb = null;
        _excelRawData = null;
        _excelSheetColumnsCache = {};
        _excelSegPreviewMatrixCache = {};
        _excelFileName = file ? file.name : '';
        _excelMaterialFolder = '';
        _excelSegments = [];
        if (folderFileWrap) folderFileWrap.innerHTML = '';
        if (blockWrap) blockWrap.innerHTML = '';
        if (statusEl) statusEl.textContent = '';
        if (!file) return;
        if (!window.XLSX || typeof window.XLSX.read !== 'function') {
            if (statusEl) statusEl.textContent = '❌ Excel 解析套件（XLSX）未載入，請硬重新整理老師頁';
            return;
        }
        if (statusEl) { statusEl.style.color = '#0F766E'; statusEl.textContent = '⏳ 讀取中…'; }
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                _excelRawData = data;
                // 第一階段只拿活頁名稱（不解析任何欄位資料），不管這份檔案有多少分頁都很快
                _excelWb = window.XLSX.read(data, { type: 'array', bookSheets: true });
                if (statusEl) statusEl.textContent = '';
                renderExcelFolderFileHtml();
                renderExcelBlock();
            } catch (err) {
                _excelWb = null;
                _excelRawData = null;
                if (statusEl) { statusEl.style.color = '#EF4444'; statusEl.textContent = '❌ 讀取失敗：' + (err.message || err); }
            }
        };
        reader.onerror = function () {
            if (statusEl) { statusEl.style.color = '#EF4444'; statusEl.textContent = '❌ 檔案讀取失敗，請重新選擇檔案'; }
        };
        reader.readAsArrayBuffer(file);
    }

    /**
     * 每一「組」（Template）自己的活頁勾選清單（可多選）——不同組可以套用到不同活頁，
     * 不是整份 Excel 共用同一個活頁清單（2026-08-05 第七輪修正，見上方資料模型說明）。
     */
    function renderSegmentSheetChecklistHtml(seg) {
        const names = (_excelWb && Array.isArray(_excelWb.SheetNames)) ? _excelWb.SheetNames : [];
        if (!names.length) return '';
        return '<div style="font-size:0.76rem; font-weight:800; color:#475569; margin-bottom:6px;">這組（Template）要套用到哪些活頁？偵測到 ' + names.length + ' 個活頁，可多選：'
            + ' <span class="mlp-excel-sheets-status" style="font-weight:700; color:#0F766E;"></span></div>'
            + '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">'
            + names.map(function (name) {
                const checked = !!seg.checkedSheets[name];
                return '<label class="mlp-excel-sheet-chk-label" style="display:inline-flex; align-items:center; gap:5px; padding:5px 12px; border-radius:6px; font-size:0.8rem; font-weight:700; cursor:pointer; '
                    + (checked ? 'background:#0F766E; color:white; border:1px solid #0F766E;' : 'background:#F1F5F9; color:#334155; border:1px solid #E2E8F0;') + '">'
                    + '<input type="checkbox" class="mlp-excel-sheet-chk" data-sheet="' + esc(name) + '" ' + (checked ? 'checked' : '') + ' style="margin:0;">'
                    + esc(name) + '</label>';
            }).join('')
            + '</div>';
    }

    /**
     * 兩輪 defer（rAF → setTimeout），確保瀏覽器有機會先把「勾選框變色」「⏳ 處理中」畫出來，
     * 才執行真正耗時的工作。單純 setTimeout(fn,0) 不保證瀏覽器一定會先畫一次畫面才執行 callback，
     * rAF 先等到下一次畫面繪製時機、再排一個 setTimeout(0)，才是比較可靠的「先畫再做」寫法。
     */
    function deferHeavyWork(fn) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () { setTimeout(fn, 0); });
        } else {
            setTimeout(fn, 0);
        }
    }

    /**
     * 雷區（2026-08-05 第十二輪）：勾選活頁後畫面「呆住一陣子才顯示打勾」——不是 bug，是真的在等
     * parseSheetColumns() 對這個活頁做第一次解析（XLSX.read 要重新讀整份原始檔案位元組），
     * 28 個活頁、檔案不小時這段解析是同步、會卡住主執行緒，卡住期間瀏覽器不會重繪，
     * 老師會覺得「勾了但沒反應」。真正原因是「快取沒命中」，不是「打勾這個動作」本身慢。
     * 解法：
     * 1) 勾選框自己的顏色立刻用 DOM 直接改（不等重繪），打勾動作本身要秒回
     * 2) 判斷這組目前的參考活頁欄位是否已快取：命中就直接重繪（很快）；沒命中才顯示「⏳ 處理中…」，
     *    並用 deferHeavyWork 把真正的（慢的）解析＋重繪排到下一次畫面繪製之後，
     *    讓老師至少先看到「打勾生效＋處理中」，不是整段時間畫面完全靜止
     */
    function bindSegmentSheetChecklistEvents(seg, cardEl) {
        cardEl.querySelectorAll('.mlp-excel-sheet-chk').forEach(function (chk) {
            chk.addEventListener('change', function () {
                const sheetName = this.getAttribute('data-sheet');
                const checked = this.checked;
                seg.checkedSheets[sheetName] = checked;

                const label = this.closest('.mlp-excel-sheet-chk-label');
                if (label) {
                    label.style.background = checked ? '#0F766E' : '#F1F5F9';
                    label.style.color = checked ? 'white' : '#334155';
                    label.style.borderColor = checked ? '#0F766E' : '#E2E8F0';
                }

                const referenceSheet = getReferenceSheetNameForSegment(seg);
                const alreadyCached = !referenceSheet || !!_excelSheetColumnsCache[referenceSheet];
                if (alreadyCached) {
                    renderExcelSegments();
                    return;
                }

                const statusEl = cardEl.querySelector('.mlp-excel-sheets-status');
                if (statusEl) statusEl.textContent = '⏳ 處理中…（第一次讀取這個活頁，請稍候）';
                deferHeavyWork(function () { renderExcelSegments(); });
            });
        });
    }

    /**
     * 列出某活頁的所有欄位（依 Excel 使用範圍逐欄），附上表頭文字＋第一列樣本值方便老師辨認。
     * 第一階段 handleExcelFileChange() 只用 bookSheets 拿活頁名稱，這裡才第一次真正解析
     * 「這一個」活頁的資料（用 { sheets: [sheetName] } 只解析這頁，不會拖到其他不相關的分頁），
     * 解析結果快取起來，同一個活頁不會重複解析。
     */
    function parseSheetColumns(sheetName) {
        if (!sheetName) return [];
        if (_excelSheetColumnsCache[sheetName]) return _excelSheetColumnsCache[sheetName];
        if (!_excelRawData || !window.XLSX || typeof window.XLSX.read !== 'function') return [];
        let sheet = null;
        try {
            const wbForSheet = window.XLSX.read(_excelRawData, { type: 'array', sheets: [sheetName] });
            sheet = wbForSheet && wbForSheet.Sheets ? wbForSheet.Sheets[sheetName] : null;
        } catch (err) {
            console.warn('[FeatureMaterialLayoutPairing] 解析活頁「' + sheetName + '」失敗', err);
            return [];
        }
        if (!sheet || !sheet['!ref']) { _excelSheetColumnsCache[sheetName] = []; return []; }
        const range = window.XLSX.utils.decode_range(sheet['!ref']);
        const cols = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
            const letter = window.XLSX.utils.encode_col(c);
            const headerAddr = window.XLSX.utils.encode_cell({ r: range.s.r, c: c });
            const headerCell = sheet[headerAddr];
            const header = headerCell && headerCell.v != null ? String(headerCell.v).trim() : '';
            const sampleAddr = window.XLSX.utils.encode_cell({ r: range.s.r + 1, c: c });
            const sampleCell = sheet[sampleAddr];
            const sample = sampleCell && sampleCell.v != null ? String(sampleCell.v).trim() : '';
            cols.push({ letter: letter, header: header, sample: sample });
        }
        _excelSheetColumnsCache[sheetName] = cols;
        return cols;
    }

    /**
     * 跟 parseSheetColumns 同一份 _excelRawData，但回傳「逐列矩陣」（array of arrays，含表頭列，
     * row 1 = matrix[0]），給「設計 Template」卡片內的即時 meta 預覽用（見 buildGenerationFromMatrix）。
     * 跟「📎 套用到教材」各自 appId 的 parseAppSheetMatrix 是同一套解析邏輯、分開的快取，
     * 因為來源不同（這裡固定用目前選檔的 _excelRawData，套用到教材可能各列各自選了不同本機檔案）。
     */
    function parseExcelSegmentMatrix(sheetName) {
        if (!sheetName) return null;
        if (_excelSegPreviewMatrixCache[sheetName]) return _excelSegPreviewMatrixCache[sheetName];
        if (!_excelRawData || !window.XLSX || typeof window.XLSX.read !== 'function') return null;
        let matrix = null;
        try {
            const wb = window.XLSX.read(_excelRawData, { type: 'array', sheets: [sheetName] });
            const sheet = wb && wb.Sheets && wb.Sheets[sheetName];
            if (sheet) {
                matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
            }
        } catch (_e) {
            matrix = null;
        }
        if (matrix) _excelSegPreviewMatrixCache[sheetName] = matrix;
        return matrix;
    }

    /** seg.mapping（colRole/colSemantic 依欄位字母）→ buildGenerationFromMatrix 需要的 template.columns[]；跟 handleSaveSegment 存檔時的 record.columns 同一套轉換規則 */
    function segColumnsToTemplateColumns(seg) {
        const cols = Object.keys(seg.checks || {}).filter(function (k) { return seg.checks[k]; }).sort();
        return cols.map(function (letter) {
            const role = seg.mapping.colRole[letter] || {};
            return {
                letter: letter,
                semantic_key: seg.mapping.colSemantic[letter] || '',
                is_question: !!role.question,
                is_answer: !!role.answer,
                is_info: !!role.info,
                is_ai_ref: !!role.ai_ref
            };
        });
    }

    /** seg 目前的欄位對應＋批改標準，包成 buildGenerationFromMatrix 認得的 template 物件（僅供即時預覽，不落地存檔） */
    function segToPreviewTemplate(seg) {
        return {
            columns: segColumnsToTemplateColumns(seg),
            answer_mode: seg.answerMode === 'separate' ? 'separate' : 'combine',
            speak_mode: ['formula', 'complex', 'paste'].indexOf(seg.speakMode) !== -1 ? seg.speakMode : 'formula',
            speak_formula: seg.speakFormula || ''
        };
    }

    /**
     * Drive 教材資料夾／檔案：整份 Excel 只有一組（所有 Template 共用同一個來源檔案）。
     * 2026-08-07：改放在「選擇檔案」的右邊（同一列並排），不再放在下方——老師要求跟左邊
     * Choose File 的檔名視覺對齊；正名「教材資料夾」為「Drive 教材資料夾」，避免跟左邊本機
     * 選的檔案搞混（這裡選的是之後 meta/script 要上傳去的 Google Drive 目的地資料夾，
     * 跟左邊「本機讀取用來設計 Template」的來源檔案是兩件不同的事）。
     */
    function renderExcelFolderFileHtml() {
        const wrap = document.getElementById('mlp-excel-folderfile');
        if (!wrap) return;
        if (!_excelWb) { wrap.innerHTML = ''; return; }
        const folderOptions = uniqueFolderNames('', 'teacher');
        // flex:1 + box-sizing:border-box：跟左邊「本機來源檔案」卡片是同一個 flex row 的兩個
        // 子項，父層 #mlp-excel-folderfile 是 display:flex（見 paint()），這裡的卡片本身也要
        // flex:1 才會被撐到跟左邊一樣高（align-items:stretch 只決定「flex item」的高度，
        // 這個 wrap.innerHTML 塞進去的卡片是 flex item 的子節點，不會自動繼承那個高度）。
        wrap.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; justify-content:center; background:#FAFAFA; border:2px solid #E2E8F0; border-radius:10px; padding:14px; box-sizing:border-box;">
                <label style="font-size:0.78rem; font-weight:800; color:#475569; display:block;">☁️ Drive 教材資料夾
                    <select id="mlp-excel-folder-select" class="form-control" style="width:100%; padding:6px; margin-top:2px;">${buildSelectOptionsHtml(folderOptions, _excelMaterialFolder, '— 選教材資料夾 —')}</select>
                    <input type="text" id="mlp-excel-folder-manual" class="form-control" value="${esc(_excelMaterialFolder)}" placeholder="手動輸入資料夾名稱" style="width:100%; padding:6px; margin-top:2px; display:none;">
                    <div id="mlp-excel-folder-status" style="font-size:0.72rem; color:#94A3B8; min-height:1.1em; margin-top:2px;"></div>
                </label>
            </div>
        `;
        // force=true：這是老師選好本機檔案後第一次看到這個下拉的時刻，寧可多打一次 GAS
        // 也要保證看到的是最新資料，不要吃到任何可能過期的快取（2026-08-06 老師連續回報
        // 「明明 Drive 裡有資料夾，下拉還是空的」，這裡是最直接會被檢視的第一個下拉）
        refreshExcelFolderSelect(true);
        const folderSelectEl = document.getElementById('mlp-excel-folder-select');
        const folderManualEl = document.getElementById('mlp-excel-folder-manual');
        folderSelectEl.addEventListener('change', function () {
            folderManualEl.style.display = this.value === '__manual__' ? 'block' : 'none';
            _excelMaterialFolder = this.value === '__manual__' ? folderManualEl.value.trim() : this.value;
        });
        folderManualEl.addEventListener('change', function () { _excelMaterialFolder = this.value.trim(); });
    }

    /**
     * 每一組（Template）各自獨立：自己的活頁勾選＋欄位勾選＋欄位對應＋儲存按鈕，
     * 「＋新增一組」＝再建一份獨立的 Template（不是同一份設定套用到更多活頁）。
     */
    /** 目前這組（陣列最後一組）有沒有存過至少一次——沒存過就不給開新的一組（第九輪，見 newExcelSegment 註解） */
    function canAddMoreSegments() {
        const segments = ensureExcelSegments();
        if (!segments.length) return false;
        return !!segments[segments.length - 1].savedOnce;
    }

    /** 存 Template 成功後呼叫：只切換這顆按鈕的顯示/隱藏，不整塊重繪（避免捲動位置跳走） */
    function refreshAddSegmentButtonVisibility() {
        const wrap = document.getElementById('mlp-excel-add-segment-wrap');
        if (wrap) wrap.style.display = canAddMoreSegments() ? 'block' : 'none';
    }

    function renderExcelBlock() {
        const wrap = document.getElementById('mlp-excel-block');
        if (!wrap) return;
        if (!_excelWb) { wrap.innerHTML = ''; return; }
        ensureExcelSegments();
        wrap.innerHTML = `
            <div id="mlp-excel-segments"></div>
            <div id="mlp-excel-add-segment-wrap" style="margin-top:6px; display:${canAddMoreSegments() ? 'block' : 'none'};">
                <button type="button" id="mlp-excel-add-segment" class="btn" style="padding:6px 14px; font-size:0.8rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">
                    ＋ 新增一組欄位設定（再建一份獨立的 Template，可套用到不同活頁）
                </button>
            </div>
        `;
        renderExcelSegments();

        document.getElementById('mlp-excel-add-segment').addEventListener('click', function () {
            ensureExcelSegments().push(newExcelSegment());
            renderExcelSegments();
            refreshAddSegmentButtonVisibility();
        });
    }

    /**
     * 教材資料夾下拉：載入／空清單／失敗重試這套流程已抽到共用模組 window.MaterialFolderPicker
     * （跟 refreshFolderSelect／refreshAppFolderSelect／feature-exam-job.js 的獨立考試教材資料夾
     * 下拉共用同一份實作），這裡只負責 Excel 小工具固定只用「老師個人」這一種歸屬。
     */
    function refreshExcelFolderSelect(forceRetry) {
        const folderSelectEl = document.getElementById('mlp-excel-folder-select');
        if (!folderSelectEl || !window.MaterialFolderPicker) return;
        window.MaterialFolderPicker.refreshDropdown({
            classId: '',
            rootKind: 'teacher',
            force: !!forceRetry,
            getSelectEl: function () { return document.getElementById('mlp-excel-folder-select'); },
            getStatusEl: function () { return document.getElementById('mlp-excel-folder-status'); },
            listCurrentOptions: function () { return uniqueFolderNames('', 'teacher'); },
            renderOptionsHtml: function (list, currentValue) { return buildSelectOptionsHtml(list, currentValue, '— 選教材資料夾 —'); },
            emptyMessage: '⚠️ 這個帳號目前抓不到任何教材資料夾（不是連線錯誤）'
        });
    }

    function renderExcelSegments() {
        const wrap = document.getElementById('mlp-excel-segments');
        if (!wrap) return;
        const segments = ensureExcelSegments();
        wrap.innerHTML = segments.map(function (seg, idx) { return renderSegmentCardHtml(seg, idx, segments.length); }).join('');
        segments.forEach(function (seg) { bindSegmentEvents(seg); });
    }

    function renderSegmentCardHtml(seg, idx, total) {
        const referenceSheet = getReferenceSheetNameForSegment(seg);
        const cols = parseSheetColumns(referenceSheet);
        return `
            <div class="mlp-excel-segment" data-seg-id="${esc(seg.id)}" style="background:white; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="font-size:0.82rem; color:#0F766E;">第 ${idx + 1} 組欄位設定（一份獨立的 Template）</strong>
                    ${total > 1 ? '<button type="button" class="mlp-excel-remove-segment btn" style="padding:2px 8px; font-size:0.72rem; color:#B91C1C; border:1px solid #FCA5A5; border-radius:4px; background:white;">刪除這組</button>' : ''}
                </div>
                <div class="mlp-excel-sheets-area">${renderSegmentSheetChecklistHtml(seg)}</div>
                <div class="mlp-excel-cols-area">${renderColsAreaHtml(seg, cols)}</div>
                <div class="mlp-excel-mapping-area">${seg.confirmed ? renderMappingAreaHtml(seg) : ''}</div>
                <div class="mlp-excel-save-area">${seg.confirmed ? renderSegmentSaveAreaHtml(seg) : ''}</div>
            </div>
        `;
    }

    function colsSummaryText(seg) {
        const selected = Object.keys(seg.checks).filter(function (k) { return seg.checks[k]; }).sort();
        return selected.length ? ('已勾選：' + selected.join('、') + '（' + selected.length + ' 欄）') : '尚未勾選任何欄位';
    }

    /**
     * 雷區（2026-08-05・第一輪）：舊版「▲收起／▼展開」跟「✅確定選取」兩顆按鈕並排，長得很像但語意完全不同——
     * 「收起」只會藏起格線、不會設定 seg.confirmed，按錯這顆就永遠看不到下面的欄位對應設定，
     * 而且畫面上沒有任何提示告訴老師按錯了。第一輪修法是「確認前不給收合」，但活頁欄位動輒 194 欄，
     * 勾選時要一路往下滑很不方便，老師仍然要求「欄位選項要能收合」。
     *
     * 雷區（2026-08-05・第二輪）：改成「收合」永遠存在（確認前後都有），但跟「確定選取」用完全不同的
     * 視覺語言，不可能誤觸：
     * - 「✅ 確定選取」＝大顆、實心主色按鈕，只在確認前出現，放在整列最右邊
     * - 「▲收起／▼展開欄位清單」＝純文字連結（無底色、無框線），確認前後都在，且文案直接寫明
     *   「僅收合畫面，不影響已勾選」，跟確定選取用不同視覺／不同位置，降低混淆
     * 另外：194 欄的格線一收合／展開，卡片高度大幅變化，若不把捲動位置帶著走，
     * 老師會覺得「按了沒反應」（其實是內容跑到捲動位置以外了）→ 一律搭配 scrollSegmentIntoView。
     *
     * 雷區（2026-08-05・第六輪）：確認後那顆按鈕整個消失、只留一段文字「✅已確定選取」——
     * 老師問「如何取消選取？按鍵不應該選完就消失」。改成同一個位置永遠都有一顆按鈕（不消失），
     * 只是文字／動作依 confirmed 狀態切換：
     * - 未確認：「確定選取」（淺色、像已勾選的樣子）→ 點下去 confirmed=true
     * - 已確認：「↩️ 取消選取（可重新編輯欄位）」（灰色外框）→ 點下去 confirmed=false，
     *   自動展開格線方便重新勾選，勾選內容／已填的行數與資料項名稱都保留，不會被清空，
     *   重新按「確定選取」就會用回同一份資料
     *
     * 雷區（2026-08-05・第九輪）：橘色實心＋✅ 綠色勾勾的「確定選取」，老師覺得那顆✅太像
     * 「已經確認過」的狀態，反而跟語意（要按了才算確認）衝突；改成拿掉✅、用跟已確認狀態同色系的
     * 淺色（跟下面「✅ 已確定選取」用一樣的薄荷綠），視覺上柔和、不再像警示用的橘色按鈕。
     * 同時因為格線很長，這顆按鈕在格線上方跟下方各放一個（同一個 class，見 bindSegmentEvents
     * 用 querySelectorAll 兩顆都綁），格線收合時下方按鈕不需要重複出現。
     */
    function renderConfirmColsButtonHtml() {
        return '<button type="button" class="mlp-excel-confirm-cols" style="padding:5px 14px; font-size:0.78rem; font-weight:800; '
            + 'background:#ECFDF5; color:#0F766E; border:1px solid #6EE7B7; border-radius:6px; cursor:pointer;">確定選取</button>';
    }

    function renderColsAreaHtml(seg, cols) {
        if (!cols.length) {
            return '<div style="color:#94A3B8; font-size:0.82rem;">這個活頁沒有偵測到任何欄位（可能是空白活頁）</div>';
        }
        const checks = seg.checks;
        const gridHtml = '<div class="mlp-excel-cols-grid" style="display:' + (seg.gridCollapsed ? 'none' : 'grid') + '; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:6px;">'
            + cols.map(function (col) {
                const checked = !!checks[col.letter];
                const headerLabel = col.header ? esc(col.header) : '<span style="color:#CBD5E1;">（無表頭）</span>';
                const sampleLabel = col.sample ? ('例：' + esc(col.sample)) : '（此欄第一列是空的）';
                return '<label style="display:flex; gap:6px; align-items:flex-start; font-size:0.78rem; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:6px 8px; cursor:pointer;">'
                    + '<input type="checkbox" class="mlp-excel-col-chk" data-col="' + esc(col.letter) + '" ' + (checked ? 'checked' : '') + ' style="margin-top:2px;">'
                    + '<span><strong>' + esc(col.letter) + '</strong>：' + headerLabel + '<br><span style="color:#94A3B8;">' + sampleLabel + '</span></span>'
                    + '</label>';
            }).join('')
            + '</div>';
        const summaryHtml = '<div class="mlp-excel-cols-summary" style="font-size:0.76rem; font-weight:700; color:' + (seg.confirmed ? '#0F766E' : (Object.keys(checks).some(function (k) { return checks[k]; }) ? '#0F766E' : '#94A3B8')) + '; margin-bottom:6px;">' + esc(colsSummaryText(seg)) + '</div>';
        // 純文字連結樣式，跟主色實心的確定選取／取消選取按鈕明顯不同、不會誤觸；
        // 2026-08-05 第七輪修正：改跟確定選取／取消選取放同一行、在它左邊（老師要求），不再另起一行
        const toggleBtnHtml = '<button type="button" class="mlp-excel-cols-toggle" style="background:none; border:none; padding:0 6px; font-size:0.72rem; color:#64748B; text-decoration:underline; cursor:pointer; white-space:nowrap;">'
            + (seg.gridCollapsed ? '▼ 展開欄位清單' : '▲ 收起欄位清單（僅收合畫面，不影響已勾選）')
            + '</button>';

        if (!seg.confirmed) {
            return '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">'
                + '<div style="font-size:0.78rem; font-weight:800; color:#475569;">共 ' + cols.length + ' 欄，勾選需要用到的欄位：</div>'
                + '<div style="display:flex; align-items:center;">' + toggleBtnHtml + renderConfirmColsButtonHtml() + '</div>'
                + '</div>'
                + summaryHtml
                + gridHtml
                + (seg.gridCollapsed ? '' : '<div style="display:flex; justify-content:flex-end; margin-top:8px;">' + renderConfirmColsButtonHtml() + '</div>');
        }

        return '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">'
            + '<div style="font-size:0.78rem; font-weight:800; color:#0F766E;">✅ 已確定選取（共 ' + cols.length + ' 欄可選）</div>'
            + '<div style="display:flex; align-items:center;">' + toggleBtnHtml
            + '<button type="button" class="mlp-excel-cancel-confirm btn" style="padding:4px 12px; font-size:0.78rem; font-weight:800; background:white; color:#475569; border:1px solid #CBD5E1;">↩️ 取消選取（可重新編輯欄位）</button></div>'
            + '</div>'
            + summaryHtml
            + gridHtml;
    }

    /** 「確定選取」後顯示的欄位對應設定：行數起迄＋每個已勾選欄位各自的「資料項名稱」下拉 */
    function renderMappingAreaHtml(seg) {
        const selectedCols = Object.keys(seg.checks).filter(function (k) { return seg.checks[k]; }).sort();
        if (!selectedCols.length) {
            return '<div style="color:#94A3B8; font-size:0.82rem; margin-top:6px;">尚未勾選任何欄位，請往上勾選後再按「確定選取」</div>';
        }
        const mapping = seg.mapping;
        const knownKeys = getKnownSemanticKeys();
        return `
            <div style="background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; padding:12px; margin-top:6px;">
                <div style="font-size:0.72rem; color:#64748B; margin-bottom:10px;">
                    每個欄位的資料項名稱／題目／答案／訊息設定好之後，按下面「儲存這個 Template」。
                    下方「行數起／行數末」只是用目前這個本機檔案立刻測試產生 meta 預覽（不會存進 Template、也不會上傳）；
                    Template 本身仍然跟任何一個實際檔案脫鉤，可重複套用到「欄位結構相同」的其他檔案——正式產生／上傳到
                    Google Drive，請到「📎 套用到教材」區塊（同一份 Template 可以套用到多個檔案、各自登記不同的行數）。
                </div>
                <div style="display:grid; grid-template-columns:1fr; gap:8px;">
                    ${selectedCols.map(function (col) {
                        const val = mapping.colSemantic[col] || '';
                        const isKnown = val && knownKeys.indexOf(val) !== -1;
                        const selectCur = val ? (isKnown ? val : '__manual__') : '';
                        const role = mapping.colRole[col] || {};
                        return `
                            <div class="mlp-excel-col-role-row" data-col="${esc(col)}" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:6px 8px;">
                                <strong style="min-width:28px; text-align:center; color:#0F766E;">${esc(col)}</strong>
                                <select class="form-control mlp-excel-semantic-select" data-col="${esc(col)}" style="flex:1; min-width:110px; padding:5px; font-size:0.8rem;">${buildSelectOptionsHtml(knownKeys, selectCur, '— 選資料項名稱 —')}</select>
                                <input type="text" class="form-control mlp-excel-semantic-manual" data-col="${esc(col)}" value="${esc(isKnown ? '' : val)}" placeholder="手動輸入" style="flex:1; min-width:90px; padding:5px; font-size:0.8rem; display:${selectCur === '__manual__' ? 'block' : 'none'};">
                                <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#334155; white-space:nowrap; cursor:pointer;">
                                    <input type="checkbox" class="mlp-excel-role-question" data-col="${esc(col)}" ${role.question ? 'checked' : ''}>題目
                                </label>
                                <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#334155; white-space:nowrap; cursor:pointer;">
                                    <input type="checkbox" class="mlp-excel-role-answer" data-col="${esc(col)}" ${role.answer ? 'checked' : ''}>書寫答案
                                </label>
                                <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#B45309; white-space:nowrap; cursor:pointer; padding-left:6px; border-left:1px dashed #CBD5E1;" title="獨立的第三種標記：這欄是參考資訊（例如活頁名／頁碼／題號），不是被考的題目或答案內容；跟題目／答案互不連動，可任意搭配勾選">
                                    <input type="checkbox" class="mlp-excel-role-info" data-col="${esc(col)}" ${role.info ? 'checked' : ''}>🏷️ 訊息
                                </label>
                                <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#6D28D9; white-space:nowrap; cursor:pointer; padding-left:6px; border-left:1px dashed #CBD5E1;" title="可複選、可留空：這欄放的是專門給 AI 口語批改用的口說答案文字，跟「書寫答案」（印在考卷上的答案）不一定相同——例如書寫答案是 to/a park（答案欄組合），口說答案卻是 to park a park。可以勾多欄（例如同時勾 pre、script 兩欄），系統會把勾選的欄依序組合成一句口說答案；允許整批留白，不影響其他列進 meta.json；勾了可以再點自己一次直接取消，或用上面的「✕」清除">
                                    <input type="checkbox" class="mlp-excel-role-airef" data-col="${esc(col)}" ${role.ai_ref ? 'checked' : ''}>🎤 口說答案
                                </label>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div style="margin-top:6px;">
                    <button type="button" class="mlp-excel-clear-airef" style="font-size:0.72rem; font-weight:700; color:#6D28D9; background:none; border:1px solid #DDD6FE; border-radius:6px; padding:3px 10px; cursor:pointer;">✕ 清除所有已選的口說答案欄（允許不指定）</button>
                </div>
                <div style="font-size:0.7rem; color:#94A3B8; margin-top:8px;">💡 image_url＝連結圖片的路徑（Google Drive 或外部網址皆可），日後實際套用時再處理怎麼顯示。「題目」「書寫答案」「🏷️ 訊息」是三個完全獨立、互不連動的勾選（不是勾一個自動連動另外兩個）：題目＝被考的內容、書寫答案＝核對用的內容（印在考卷上）、訊息＝活頁名／頁碼／題號這類參考資訊（不是被考的內容），三者可以任意組合，也可以都不勾。「🎤 口說答案」是另一件事——它是口語批改基準文字，跟「書寫答案」不一定相同，**可複選（不是單選）**、可留空，可以同時勾多欄讓系統組合成一句，留空不會擋「產生 meta/script」，只是 script.txt 那幾行會是空行。</div>
                <div class="mlp-excel-answer-grading-wrap">${renderAnswerGradingSettingsHtml('mlp-excel', seg, countAnswerColsFromRole(mapping.colRole))}</div>
                ${renderSegmentGenPreviewAreaHtml(seg)}
            </div>
        `;
    }

    /**
     * 「設計 Template」卡片內的即時 meta 預覽：行數起／行數末＋「產生 meta 預覽」按鈕，直接用目前
     * 這個本機檔案＋這組已勾選的活頁測試算出 meta.json／script.txt 會長什麼樣子，不用先存 Template
     * 再跳到「📎 套用到教材」才能看結果。純預覽，不會存檔／不會上傳（正式產生／上傳仍在套用到教材做）。
     */
    function renderSegmentGenPreviewAreaHtml(seg) {
        const sheetName = getReferenceSheetNameForSegment(seg);
        return `
            <div class="mlp-excel-gen-preview-wrap" style="background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:8px; padding:10px 12px; margin-top:10px;">
                <div style="font-size:0.76rem; font-weight:800; color:#334155; margin-bottom:6px;">
                    🔍 用「${sheetName ? esc(sheetName) : '（請先在上面勾選一個活頁）'}」立刻測試產生 meta（僅預覽，不會存檔／不會上傳）
                </div>
                <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-bottom:8px;">
                    <label style="font-size:0.76rem; font-weight:700; color:#334155;">行數起
                        <input type="text" class="form-control mlp-excel-seg-rowstart" value="${esc(seg.rowStart || '2')}" style="width:90px; padding:6px; margin-top:2px;">
                    </label>
                    <label style="font-size:0.76rem; font-weight:700; color:#334155;">行數末
                        <input type="text" class="form-control mlp-excel-seg-rowend" value="${esc(seg.rowEnd || '')}" placeholder="留空＝到最後一列，或 LAST／LAST(欄位)" style="width:170px; padding:6px; margin-top:2px;">
                    </label>
                    <button type="button" class="mlp-excel-seg-gen-preview btn" style="padding:7px 14px; font-weight:800; background:#0F766E; color:white; border:none; border-radius:6px; cursor:pointer;">🔍 產生 meta 預覽</button>
                </div>
                <div class="mlp-excel-seg-gen-result" style="font-size:0.78rem; color:#475569;"></div>
            </div>
        `;
    }

    /** 產生 meta 預覽按鈕：讀目前欄位對應＋行數起迄，跑 buildGenerationFromMatrix，畫出結果／警告／前幾列預覽 */
    function handleSegmentGenPreview(seg, cardEl) {
        const resultEl = cardEl.querySelector('.mlp-excel-seg-gen-result');
        if (!resultEl) return;
        const sheetName = getReferenceSheetNameForSegment(seg);
        if (!sheetName) {
            resultEl.innerHTML = '<span style="color:#EF4444; font-weight:800;">❌ 請先在上面勾選一個活頁</span>';
            return;
        }
        const rowStartEl = cardEl.querySelector('.mlp-excel-seg-rowstart');
        const rowEndEl = cardEl.querySelector('.mlp-excel-seg-rowend');
        seg.rowStart = rowStartEl ? rowStartEl.value.trim() : '';
        seg.rowEnd = rowEndEl ? rowEndEl.value.trim() : '';
        const template = segToPreviewTemplate(seg);
        if (!template.columns.length) {
            resultEl.innerHTML = '<span style="color:#EF4444; font-weight:800;">❌ 尚未設定任何欄位的資料項名稱，請先完成上面的欄位對應</span>';
            return;
        }
        resultEl.innerHTML = '<span style="color:#0F766E;">⏳ 計算中…</span>';
        deferHeavyWork(function () {
            const matrix = parseExcelSegmentMatrix(sheetName);
            const result = buildGenerationFromMatrix(matrix, template, seg.rowStart, seg.rowEnd, {});
            if (!result.ok) {
                resultEl.innerHTML = '<span style="color:#EF4444; font-weight:800;">❌ ' + esc(result.error) + '</span>';
                return;
            }
            const warningsHtml = result.warnings.length
                ? '<div style="margin-top:6px;">' + result.warnings.map(function (w) {
                    return '<div style="color:#B45309;">' + esc(w) + '</div>';
                }).join('') + '</div>'
                : '';
            resultEl.innerHTML = `
                <div style="color:#0F766E; font-weight:800;">✅ 產出 ${result.rows.length} 列（實際讀取第 ${result.rowStart}～${result.rowEnd} 列）</div>
                ${warningsHtml}
                <details style="margin-top:6px;"><summary style="cursor:pointer; font-weight:700; color:#334155;">meta.json 預覽（前 5 列，共 ${result.rows.length} 列）</summary>
                    <pre style="max-height:220px; overflow:auto; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px; font-size:0.72rem; white-space:pre-wrap; word-break:break-all;">${esc(JSON.stringify(result.rows.slice(0, 5), null, 2))}</pre>
                </details>
                <details style="margin-top:6px;"><summary style="cursor:pointer; font-weight:700; color:#334155;">script.txt 預覽（前 5 行，共 ${result.scriptLines.length} 行）</summary>
                    <pre style="max-height:160px; overflow:auto; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px; font-size:0.72rem; white-space:pre-wrap; word-break:break-all;">${esc(result.scriptLines.slice(0, 5).join('\n')) || '（空白）'}</pre>
                </details>
            `;
        });
    }

    /** 對應 renderSegmentGenPreviewAreaHtml：行數輸入框存回 seg，按鈕觸發預覽 */
    function bindSegmentGenPreviewEvents(seg, cardEl) {
        const rowStartEl = cardEl.querySelector('.mlp-excel-seg-rowstart');
        if (rowStartEl) rowStartEl.addEventListener('change', function () { seg.rowStart = this.value.trim(); });
        const rowEndEl = cardEl.querySelector('.mlp-excel-seg-rowend');
        if (rowEndEl) rowEndEl.addEventListener('change', function () { seg.rowEnd = this.value.trim(); });
        const btn = cardEl.querySelector('.mlp-excel-seg-gen-preview');
        if (btn) btn.addEventListener('click', function () { handleSegmentGenPreview(seg, cardEl); });
    }

    /**
     * 雷區（2026-08-05）：194 欄的格線一收合，卡片高度瞬間大幅縮短，捲動位置（像素）沒跟著走的話，
     * 原本畫面上那個位置現在對應到頁面完全不同的地方（甚至捲到底、跑到別的區塊），
     * 老師會以為「按了確定選取／收起，畫面卻沒反應」——這正是使用者回報「修正一全數失敗」的真正原因，
     * 不是欄位對應設定真的不見了，是版面跳走、螢幕上已經看不到它。收合／展開／確認後都要呼叫這個。
     */
    function scrollSegmentIntoView(seg) {
        const cardEl = document.querySelector('.mlp-excel-segment[data-seg-id="' + seg.id + '"]');
        if (cardEl && typeof cardEl.scrollIntoView === 'function') {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function bindSegmentEvents(seg) {
        const cardEl = document.querySelector('.mlp-excel-segment[data-seg-id="' + seg.id + '"]');
        if (!cardEl) return;

        bindSegmentSheetChecklistEvents(seg, cardEl);
        bindSegmentSaveAreaEvents(seg, cardEl);

        cardEl.querySelectorAll('.mlp-excel-col-chk').forEach(function (chk) {
            chk.addEventListener('change', function () {
                seg.checks[this.getAttribute('data-col')] = this.checked;
                const summaryEl = cardEl.querySelector('.mlp-excel-cols-summary');
                if (summaryEl) {
                    summaryEl.textContent = colsSummaryText(seg);
                    const hasAny = Object.keys(seg.checks).some(function (k) { return seg.checks[k]; });
                    summaryEl.style.color = (seg.confirmed || hasAny) ? '#0F766E' : '#94A3B8';
                }
                // 已確定過的組別，再改勾選要讓下面「欄位對應設定」的欄位清單跟著變（不用再按一次確定選取）
                if (seg.confirmed) {
                    const mappingAreaEl = cardEl.querySelector('.mlp-excel-mapping-area');
                    if (mappingAreaEl) mappingAreaEl.innerHTML = renderMappingAreaHtml(seg);
                    bindMappingEvents(seg, cardEl);
                }
            });
        });

        // 純文字連結，確認前後都在，只單純收合/展開格線，不會設定 seg.confirmed、
        // 也不會影響已經顯示的「欄位對應設定」區塊（見 renderColsAreaHtml 的說明）
        const toggleBtn = cardEl.querySelector('.mlp-excel-cols-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', function () {
            seg.gridCollapsed = !seg.gridCollapsed;
            const grid = cardEl.querySelector('.mlp-excel-cols-grid');
            if (grid) grid.style.display = seg.gridCollapsed ? 'none' : 'grid';
            this.textContent = seg.gridCollapsed ? '▼ 展開欄位清單' : '▲ 收起欄位清單（僅收合畫面，不影響已勾選）';
            scrollSegmentIntoView(seg);
        });

        // 這顆按鈕只有在「尚未確定選取」時才會出現（見 renderColsAreaHtml），是唯一一條往下走的路，
        // 不會再有另一顆長得很像、按了卻看不到欄位對應設定的按鈕。
        // 2026-08-05 第九輪：194 欄的格線很長，勾到最下面還要滑回最上面才能按到確定選取，
        // 老師要求格線「下面」也要有一顆一樣的按鈕——所以這裡是 querySelectorAll，兩顆（上/下）都要綁
        cardEl.querySelectorAll('.mlp-excel-confirm-cols').forEach(function (confirmBtn) {
            confirmBtn.addEventListener('click', function () {
                seg.confirmed = true;
                seg.gridCollapsed = true;
                renderExcelSegments();
                scrollSegmentIntoView(seg);
            });
        });

        // 「取消選取」＝confirmBtn 的另一種狀態（同一個位置，按鍵永遠不消失，見雷區第六輪）。
        // 只是把 confirmed 撥回 false，勾選內容／已填的行數與資料項名稱維持原樣（不清空），
        // 自動展開格線方便重新勾選；下面的「欄位對應設定」會因為 confirmed=false 而收起，
        // 再按一次「確定選取」就會用回同一份資料，不用重打
        const cancelBtn = cardEl.querySelector('.mlp-excel-cancel-confirm');
        if (cancelBtn) cancelBtn.addEventListener('click', function () {
            seg.confirmed = false;
            seg.gridCollapsed = false;
            renderExcelSegments();
            scrollSegmentIntoView(seg);
        });

        const removeBtn = cardEl.querySelector('.mlp-excel-remove-segment');
        if (removeBtn) removeBtn.addEventListener('click', function () {
            const segments = ensureExcelSegments();
            const idx = segments.indexOf(seg);
            if (idx !== -1 && segments.length > 1) segments.splice(idx, 1);
            renderExcelSegments();
            refreshAddSegmentButtonVisibility();
        });

        if (seg.confirmed) bindMappingEvents(seg, cardEl);
    }

    function bindMappingEvents(seg, cardEl) {
        const mapping = seg.mapping;
        cardEl.querySelectorAll('.mlp-excel-semantic-select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                const col = this.getAttribute('data-col');
                const manualInput = cardEl.querySelector('.mlp-excel-semantic-manual[data-col="' + col + '"]');
                if (this.value === '__manual__') {
                    if (manualInput) { manualInput.style.display = 'block'; mapping.colSemantic[col] = manualInput.value; }
                } else {
                    if (manualInput) manualInput.style.display = 'none';
                    mapping.colSemantic[col] = this.value;
                }
            });
        });
        cardEl.querySelectorAll('.mlp-excel-semantic-manual').forEach(function (inp) {
            inp.addEventListener('change', function () {
                const col = this.getAttribute('data-col');
                mapping.colSemantic[col] = this.value;
                rememberSemanticKey(this.value);
            });
        });
        /**
         * 題目／答案／🏷️訊息 三顆勾選框「完全獨立、互不連動」（2026-08-05 第十一輪修正）：
         * 上一版把訊息做成「勾了自動連動題目+答案」，結果訊息＝題目+答案的別名、資料一模一樣，
         * 老師直接開罵「這當然是bug，兩個都要勾我自己勾就行，幹嘛要一個訊息」——說得對，
         * 別名沒有任何存在意義。訊息是獨立的第三軸語意（這欄是不是被考的內容），
         * 不該連動另外兩個；每個勾選框只改自己那個布林值，互不影響。
         */
        cardEl.querySelectorAll('.mlp-excel-role-question').forEach(function (chk) {
            chk.addEventListener('change', function () {
                const col = this.getAttribute('data-col');
                mapping.colRole[col] = Object.assign({}, mapping.colRole[col], { question: this.checked });
            });
        });
        cardEl.querySelectorAll('.mlp-excel-role-answer').forEach(function (chk) {
            chk.addEventListener('change', function () {
                const col = this.getAttribute('data-col');
                mapping.colRole[col] = Object.assign({}, mapping.colRole[col], { answer: this.checked });
                refreshAnswerGradingBlock(cardEl, 'mlp-excel', seg, countAnswerColsFromRole(mapping.colRole));
            });
        });
        cardEl.querySelectorAll('.mlp-excel-role-info').forEach(function (chk) {
            chk.addEventListener('change', function () {
                const col = this.getAttribute('data-col');
                mapping.colRole[col] = Object.assign({}, mapping.colRole[col], { info: this.checked });
            });
        });
        /**
         * 🎤 口說答案：checkbox＝可複選（老師 2026-08-08 再次明確強調：「勾選的意思是可以
         * 複選！不能夠是互斥！」）。每個欄位的勾選狀態完全獨立，勾這一欄**不會**影響其他欄，
         * 不做任何互斥/單選邏輯——跟「題目」「書寫答案」「🏷️ 訊息」三個勾選一樣單純只切換
         * 自己這一格。多欄被勾選時，buildGenerationFromMatrix 會把這些欄的內容依序組合
         * （沒有設定公式時預設用空白串接）算出最終的口說答案／script.txt。
         */
        cardEl.querySelectorAll('.mlp-excel-role-airef').forEach(function (chk) {
            chk.addEventListener('change', function () {
                const col = this.getAttribute('data-col');
                mapping.colRole[col] = Object.assign({}, mapping.colRole[col], { ai_ref: this.checked });
            });
        });
        const clearAirefBtn = cardEl.querySelector('.mlp-excel-clear-airef');
        if (clearAirefBtn) clearAirefBtn.addEventListener('click', function () {
            Object.keys(mapping.colRole).forEach(function (k) {
                if (mapping.colRole[k] && mapping.colRole[k].ai_ref) {
                    mapping.colRole[k] = Object.assign({}, mapping.colRole[k], { ai_ref: false });
                }
            });
            cardEl.querySelectorAll('.mlp-excel-role-airef').forEach(function (chk) { chk.checked = false; });
        });
        const answerGradingWrapEl = cardEl.querySelector('.mlp-excel-answer-grading-wrap');
        if (answerGradingWrapEl) bindAnswerGradingSettingsEvents(answerGradingWrapEl, 'mlp-excel', seg);
        const genPreviewWrapEl = cardEl.querySelector('.mlp-excel-gen-preview-wrap');
        if (genPreviewWrapEl) bindSegmentGenPreviewEvents(seg, cardEl);
    }

    /**
     * 每一組（Template）自己的儲存區塊：放在綠色欄位對應框「外面」，但還在第 N 組欄位設定的白色卡片「裡面」
     * （2026-08-05 第七輪修正，老師明確要求的位置）。名字下拉沿用既有 buildSelectOptionsHtml 的
     * __manual__ 逃生口模式（跟教材資料夾下拉同一套），不用另外發明一種「新增名稱」UI。
     * 2026-08-08：這裡原本標「Layout」，老師明確指出誤導——存的不只是欄位排版（layout），
     * 還包含題目/答案/訊息角色、書寫答案批改標準、口說答案批改標準與公式，統一正名為「Template」，
     * 跟上方「🧩 Layout Template」管理區塊的名稱一致（同一份資料，只是進入點不同）。
     */
    function renderSegmentSaveAreaHtml(seg) {
        const templates = getFieldTemplatesCachedSync();
        const names = templates.map(function (t) { return String(t.name || '').trim(); }).filter(Boolean);
        const uniqueNames = names.filter(function (n, i) { return names.indexOf(n) === i; });
        const curName = seg.name || '';
        const isKnownName = !!curName && uniqueNames.indexOf(curName) !== -1;
        // 跟教材資料夾下拉同一套「已知值選 value，否則落到 __manual__ 顯示手動輸入框」慣例，
        // 不要做成「curName 空字串時兩個都顯示」的混合狀態
        return `
            <div style="margin-top:12px; padding-top:10px; border-top:1px dashed #CBD5E1; display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                <label style="font-size:0.78rem; font-weight:800; color:#475569;">Template 名稱（同名＝覆蓋更新，新名＝新增一筆）
                    <div style="display:flex; gap:6px; margin-top:2px;">
                        <select class="form-control mlp-excel-seg-name-select" style="width:180px; padding:6px;">${buildSelectOptionsHtml(uniqueNames, isKnownName ? curName : '__manual__', '— 選擇已有 Template 名稱 —')}</select>
                        <input type="text" class="form-control mlp-excel-seg-name-manual" value="${esc(isKnownName ? '' : curName)}" placeholder="幫這份 Template 取個名字" style="width:180px; padding:6px; display:${isKnownName ? 'none' : 'block'};">
                    </div>
                </label>
                <button type="button" class="mlp-excel-save-segment btn btn-primary" style="padding:7px 16px; font-weight:800;">💾 儲存這個 Template</button>
                <span class="mlp-excel-save-segment-msg" style="font-size:0.78rem; font-weight:800;"></span>
            </div>
        `;
    }

    function bindSegmentSaveAreaEvents(seg, cardEl) {
        const nameSelectEl = cardEl.querySelector('.mlp-excel-seg-name-select');
        const nameManualEl = cardEl.querySelector('.mlp-excel-seg-name-manual');
        if (nameSelectEl) nameSelectEl.addEventListener('change', function () {
            if (nameManualEl) nameManualEl.style.display = this.value === '__manual__' ? 'block' : 'none';
            seg.name = this.value === '__manual__' ? (nameManualEl ? nameManualEl.value.trim() : '') : this.value;
        });
        if (nameManualEl) nameManualEl.addEventListener('change', function () { seg.name = this.value.trim(); });
        const saveBtn = cardEl.querySelector('.mlp-excel-save-segment');
        if (saveBtn) saveBtn.addEventListener('click', function () { handleSaveSegment(seg, cardEl); });
    }

    /**
     * 存成一筆獨立命名的 Template：名字是這筆記錄的識別鍵——同名＝覆蓋更新同一筆，不同名＝新增一筆
     * （2026-08-05 第七輪修正：老師明確要求「儲存＝存那個 layout，要單獨存，才能給那個 layout 單獨的名字」，
     * 不再是整個大區塊存一筆、不給名字）。教材資料夾／檔名所有組共用，活頁清單／欄位設定是這一組自己的。
     */
    /**
     * 2026-08-05 第十三輪雷區（架構修正）：這裡存的是獨立於檔案的 Layout Template
     * （見 newExcelSegment 的架構註解）。教材資料夾／活頁只是「設計參考」（designed_from，
     * 選填、純資訊性，不影響能不能存），不再是儲存的必要條件——因為 Template 本身就該能脫離
     * 任何檔案獨立存在（老師明確更正：「layout 是被套用的概念，既是套用，本就該獨立存在，
     * 怎麼可以依附在某個檔案裡」）。存好之後會出現在上方「Layout Template」管理區塊，
     * 那裡才是叫出來編輯／刪除的地方；實際套用到某個檔案的行數起迄記在「📎 套用到教材」區塊。
     */
    async function handleSaveSegment(seg, cardEl) {
        const msgEl = cardEl.querySelector('.mlp-excel-save-segment-msg');
        const nameSelectEl = cardEl.querySelector('.mlp-excel-seg-name-select');
        const nameManualEl = cardEl.querySelector('.mlp-excel-seg-name-manual');
        const name = (nameSelectEl && nameSelectEl.value === '__manual__' ? nameManualEl.value : (nameSelectEl ? nameSelectEl.value : '') || '').trim();
        if (!name) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請幫這份 Template 取個名字'; }
            return;
        }
        if (!seg.confirmed) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請先「確定選取」欄位後才能儲存'; }
            return;
        }
        const cols = Object.keys(seg.checks).filter(function (k) { return seg.checks[k]; }).sort();
        if (!cols.length) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少勾選一個欄位'; }
            return;
        }
        seg.name = name;
        const sheetIds = Object.keys(seg.checkedSheets).filter(function (k) { return seg.checkedSheets[k]; }).sort();
        const folderSelectEl = document.getElementById('mlp-excel-folder-select');
        const folderManualEl = document.getElementById('mlp-excel-folder-manual');
        const materialFolder = (folderSelectEl && folderSelectEl.value === '__manual__' ? (folderManualEl ? folderManualEl.value : '') : (folderSelectEl ? folderSelectEl.value : '') || '').trim();
        if (materialFolder) _excelMaterialFolder = materialFolder;
        const record = {
            name: name,
            columns: cols.map(function (letter) {
                const role = seg.mapping.colRole[letter] || {};
                return {
                    letter: letter,
                    semantic_key: seg.mapping.colSemantic[letter] || '',
                    is_question: !!role.question,
                    is_answer: !!role.answer,
                    is_info: !!role.info,
                    is_ai_ref: !!role.ai_ref
                };
            }),
            // 2026-08-07：書寫答案／口說答案批改標準（只有書寫答案欄數>1才有意義，見
            // renderAnswerGradingSettingsHtml），欄數≤1 時維持預設值即可，不影響既有單答案教材
            answer_mode: seg.answerMode === 'separate' ? 'separate' : 'combine',
            answer_combine_note: seg.answerCombineNote || '',
            speak_mode: ['formula', 'complex', 'paste'].indexOf(seg.speakMode) !== -1 ? seg.speakMode : 'formula',
            speak_formula: seg.speakFormula || '',
            // designed_from：純資訊性的「設計參考」，跟能不能存無關，方便老師日後回頭核對這份
            // Template 是照哪個檔案設計的；沒有檔案／沒選資料夾／沒勾活頁也完全可以存
            designed_from: (materialFolder || _excelFileName || sheetIds.length)
                ? { material_folder: materialFolder, file_name: _excelFileName, sheet_ids: sheetIds }
                : null
        };
        const btn = cardEl.querySelector('.mlp-excel-save-segment');
        if (btn) btn.disabled = true;
        if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
        try {
            const templates = await fetchFieldTemplates(true);
            const existingIdx = templates.findIndex(function (t) { return String(t.name || '').trim() === name; });
            record.id = existingIdx !== -1 ? templates[existingIdx].id : ('mft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
            record.updated_at = new Date().toISOString();
            const nextList = templates.slice();
            if (existingIdx !== -1) nextList[existingIdx] = record; else nextList.push(record);
            await saveFieldTemplates(nextList);
            if (msgEl) { msgEl.style.color = '#059669'; msgEl.textContent = (existingIdx !== -1 ? '✅ 已覆蓋更新「' : '✅ 已新增「') + name + '」，可到上方「Layout Template」區塊查看'; }
            window.showFlash && window.showFlash('已儲存 Template「' + name + '」');
            seg.savedOnce = true;
            refreshAddSegmentButtonVisibility();
            renderTemplateList();
            refreshAppTemplateSelectOptions();
        } catch (err) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 儲存失敗：' + (err.message || err); }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ------------------------------------------------------------------
    // 🧩 Layout Template 管理（獨立區塊，2026-08-05 第十三輪新增）
    //
    // 雷區（2026-08-05）：舊版「儲存好的 layout」只能透過 Excel 小工具的存檔動作間接看到，
    // 沒有選檔案／沒有活頁清單時整個清單是隱藏的，老師問「儲存好的 layout 如何叫出來，並修改」，
    // 答案是「叫不出來」——這是設計缺陷，不是操作問題。Template 本質是「規則」，跟任何檔案脫鉤，
    // 這個區塊永遠顯示（不需要選 Excel 檔案），提供完整的新增／編輯／刪除。
    // ------------------------------------------------------------------

    function openTemplateEditorForNew() {
        _templateEditorState = { id: null, isNew: true, name: '', columns: [], designed_from: null, answerMode: 'combine', answerCombineNote: '', speakMode: 'formula', speakFormula: '' };
        renderTemplateEditor();
        renderTemplateList();
        const editorEl = document.getElementById('mlp-template-editor');
        if (editorEl && typeof editorEl.scrollIntoView === 'function') editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function openTemplateEditorForExisting(t) {
        _templateEditorState = {
            id: t.id,
            isNew: false,
            name: t.name || '',
            columns: (Array.isArray(t.columns) ? t.columns : []).map(function (c) {
                return {
                    letter: (c && c.letter) || '',
                    semantic_key: (c && c.semantic_key) || '',
                    is_question: !!(c && c.is_question),
                    is_answer: !!(c && c.is_answer),
                    is_info: !!(c && c.is_info),
                    is_ai_ref: !!(c && c.is_ai_ref)
                };
            }),
            designed_from: (t && t.designed_from) || null,
            answerMode: (t && t.answer_mode === 'separate') ? 'separate' : 'combine',
            answerCombineNote: (t && t.answer_combine_note) || '',
            speakMode: (t && ['formula', 'complex', 'paste'].indexOf(t.speak_mode) !== -1) ? t.speak_mode : 'formula',
            speakFormula: (t && t.speak_formula) || ''
        };
        renderTemplateEditor();
        renderTemplateList();
        const editorEl = document.getElementById('mlp-template-editor');
        if (editorEl && typeof editorEl.scrollIntoView === 'function') editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderTemplateEditor() {
        const wrap = document.getElementById('mlp-template-editor');
        if (!wrap) return;
        if (!_templateEditorState) { wrap.innerHTML = ''; return; }
        const st = _templateEditorState;
        const designed = st.designed_from;
        const designedText = designed
            ? ('設計參考：' + esc(designed.material_folder || '（未指定資料夾）') + (designed.file_name ? '｜' + esc(designed.file_name) : '') + (Array.isArray(designed.sheet_ids) && designed.sheet_ids.length ? '｜活頁：' + esc(designed.sheet_ids.join('、')) : ''))
            : '';
        wrap.innerHTML = `
            <div style="background:#F8FAFC; border:2px solid #C7D2FE; border-radius:10px; padding:14px; margin-bottom:14px;">
                <div style="font-size:0.85rem; font-weight:800; color:#4338CA; margin-bottom:8px;">${st.isNew ? '➕ 新增 Layout Template' : '✏️ 編輯 Layout Template'}</div>
                <label style="font-size:0.78rem; font-weight:800; color:#475569;">Layout 名稱
                    <input type="text" id="mlp-tpl-name" class="form-control" value="${esc(st.name)}" style="width:260px; padding:6px; margin-top:2px; display:block;" placeholder="幫這份 Template 取個名字">
                </label>
                ${designedText ? '<div style="font-size:0.72rem; color:#94A3B8; margin-top:6px;">' + designedText + '（純參考資訊，不影響套用）</div>' : ''}
                <div style="margin-top:12px;">
                    <div style="font-size:0.78rem; font-weight:800; color:#475569; margin-bottom:6px;">欄位設定（欄位代號自己打，可自由新增／刪除列）</div>
                    <div id="mlp-tpl-cols"></div>
                    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" id="mlp-tpl-add-col" class="btn" style="padding:5px 12px; font-size:0.78rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">＋ 新增欄位列</button>
                        <button type="button" id="mlp-tpl-clear-airef" class="btn" style="padding:5px 12px; font-size:0.78rem; font-weight:800; background:white; color:#6D28D9; border:1px solid #DDD6FE; border-radius:6px;">✕ 清除所有已選的口說答案欄（允許不指定）</button>
                    </div>
                </div>
                <div class="mlp-tpl-answer-grading-wrap">${renderAnswerGradingSettingsHtml('mlp-tpl', st, countAnswerColsFromColumns(st.columns))}</div>
                <div style="margin-top:14px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <button type="button" id="mlp-tpl-save" class="btn btn-primary" style="padding:7px 16px; font-weight:800;">💾 儲存這個 Template</button>
                    <button type="button" id="mlp-tpl-cancel" class="btn" style="padding:7px 16px; font-weight:800; background:white; border:1px solid #CBD5E1; color:#475569;">取消</button>
                    ${(!st.isNew && st.id) ? '<button type="button" id="mlp-tpl-delete-inline" class="btn" style="padding:7px 16px; font-weight:800; background:white; border:1px solid #FCA5A5; color:#B91C1C; margin-left:auto;">🗑️ 刪除這個 Template</button>' : ''}
                    <span id="mlp-tpl-msg" style="font-size:0.78rem; font-weight:800;"></span>
                </div>
            </div>
        `;
        renderTemplateEditorCols();
        bindTemplateEditorEvents();
    }

    function renderTemplateEditorCols() {
        const wrap = document.getElementById('mlp-tpl-cols');
        if (!wrap || !_templateEditorState) return;
        const knownKeys = getKnownSemanticKeys();
        const st = _templateEditorState;
        wrap.innerHTML = st.columns.length ? st.columns.map(function (c, idx) {
            const isKnown = c.semantic_key && knownKeys.indexOf(c.semantic_key) !== -1;
            const selectCur = c.semantic_key ? (isKnown ? c.semantic_key : '__manual__') : '';
            return `
                <div class="mlp-tpl-col-row" data-idx="${idx}" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:6px 8px; margin-bottom:6px;">
                    <input type="text" class="form-control mlp-tpl-col-letter" value="${esc(c.letter)}" placeholder="欄位代號" style="width:90px; padding:5px; font-size:0.8rem;">
                    <select class="form-control mlp-tpl-col-semantic-select" style="flex:1; min-width:110px; padding:5px; font-size:0.8rem;">${buildSelectOptionsHtml(knownKeys, selectCur, '— 選資料項名稱 —')}</select>
                    <input type="text" class="form-control mlp-tpl-col-semantic-manual" value="${esc(isKnown ? '' : c.semantic_key)}" placeholder="手動輸入" style="flex:1; min-width:90px; padding:5px; font-size:0.8rem; display:${selectCur === '__manual__' ? 'block' : 'none'};">
                    <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#334155; white-space:nowrap; cursor:pointer;">
                        <input type="checkbox" class="mlp-tpl-col-question" ${c.is_question ? 'checked' : ''}>題目
                    </label>
                    <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#334155; white-space:nowrap; cursor:pointer;">
                        <input type="checkbox" class="mlp-tpl-col-answer" ${c.is_answer ? 'checked' : ''}>書寫答案
                    </label>
                    <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#B45309; white-space:nowrap; cursor:pointer; padding-left:6px; border-left:1px dashed #CBD5E1;" title="獨立的第三種標記：這欄是參考資訊，不是被考的題目或答案內容">
                        <input type="checkbox" class="mlp-tpl-col-info" ${c.is_info ? 'checked' : ''}>🏷️訊息
                    </label>
                    <label style="display:flex; align-items:center; gap:3px; font-size:0.74rem; font-weight:700; color:#6D28D9; white-space:nowrap; cursor:pointer; padding-left:6px; border-left:1px dashed #CBD5E1;" title="可複選、可留空：AI 口語批改用的口說答案文字，跟「書寫答案」不一定相同，可以勾多欄讓系統依序組合成一句，允許整批留白；勾了可以再點自己一次直接取消">
                        <input type="checkbox" class="mlp-tpl-col-airef" ${c.is_ai_ref ? 'checked' : ''}>🎤口說答案
                    </label>
                    <button type="button" class="mlp-tpl-col-remove" style="padding:3px 8px; font-size:0.72rem; color:#B91C1C; border:1px solid #FCA5A5; border-radius:4px; background:white; cursor:pointer;">🗑️</button>
                </div>
            `;
        }).join('') : '<div style="color:#94A3B8; font-size:0.8rem;">尚未新增任何欄位，按下面「＋新增欄位列」開始</div>';
        bindTemplateEditorColsEvents();
    }

    function bindTemplateEditorColsEvents() {
        const wrap = document.getElementById('mlp-tpl-cols');
        if (!wrap || !_templateEditorState) return;
        wrap.querySelectorAll('.mlp-tpl-col-row').forEach(function (rowEl) {
            const idx = parseInt(rowEl.getAttribute('data-idx'), 10);
            const col = _templateEditorState.columns[idx];
            if (!col) return;
            const letterEl = rowEl.querySelector('.mlp-tpl-col-letter');
            if (letterEl) letterEl.addEventListener('change', function () { col.letter = this.value.trim(); });
            const selectEl = rowEl.querySelector('.mlp-tpl-col-semantic-select');
            const manualEl = rowEl.querySelector('.mlp-tpl-col-semantic-manual');
            if (selectEl) selectEl.addEventListener('change', function () {
                if (this.value === '__manual__') {
                    if (manualEl) { manualEl.style.display = 'block'; col.semantic_key = manualEl.value.trim(); }
                } else {
                    if (manualEl) manualEl.style.display = 'none';
                    col.semantic_key = this.value;
                }
            });
            if (manualEl) manualEl.addEventListener('change', function () { col.semantic_key = this.value.trim(); rememberSemanticKey(this.value); });
            const qEl = rowEl.querySelector('.mlp-tpl-col-question');
            if (qEl) qEl.addEventListener('change', function () { col.is_question = this.checked; });
            const aEl = rowEl.querySelector('.mlp-tpl-col-answer');
            if (aEl) aEl.addEventListener('change', function () {
                col.is_answer = this.checked;
                refreshAnswerGradingBlock(document.getElementById('mlp-template-editor'), 'mlp-tpl', _templateEditorState, countAnswerColsFromColumns(_templateEditorState.columns));
            });
            const iEl = rowEl.querySelector('.mlp-tpl-col-info');
            if (iEl) iEl.addEventListener('change', function () { col.is_info = this.checked; });
            // 🎤 口說答案：checkbox＝可複選（老師 2026-08-08 再次明確強調不能互斥）。
            // 只切換自己這一欄，不動其他列的 is_ai_ref（跟 Excel 小工具同一份邏輯）。
            const airefEl = rowEl.querySelector('.mlp-tpl-col-airef');
            if (airefEl) airefEl.addEventListener('change', function () { col.is_ai_ref = this.checked; });
            const removeBtn = rowEl.querySelector('.mlp-tpl-col-remove');
            if (removeBtn) removeBtn.addEventListener('click', function () {
                _templateEditorState.columns.splice(idx, 1);
                renderTemplateEditorCols();
            });
        });
    }

    function bindTemplateEditorEvents() {
        const nameEl = document.getElementById('mlp-tpl-name');
        if (nameEl) nameEl.addEventListener('change', function () { _templateEditorState.name = this.value.trim(); });
        const addColBtn = document.getElementById('mlp-tpl-add-col');
        if (addColBtn) addColBtn.addEventListener('click', function () {
            _templateEditorState.columns.push({ letter: '', semantic_key: '', is_question: false, is_answer: false, is_info: false, is_ai_ref: false });
            renderTemplateEditorCols();
        });
        const clearAirefBtn = document.getElementById('mlp-tpl-clear-airef');
        if (clearAirefBtn) clearAirefBtn.addEventListener('click', function () {
            _templateEditorState.columns.forEach(function (c) { c.is_ai_ref = false; });
            renderTemplateEditorCols();
        });
        const saveBtn = document.getElementById('mlp-tpl-save');
        if (saveBtn) saveBtn.addEventListener('click', handleSaveTemplateFromEditor);
        const cancelBtn = document.getElementById('mlp-tpl-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', function () {
            _templateEditorState = null;
            renderTemplateEditor();
            renderTemplateList();
        });
        // 編輯既有 Template 時，直接在編輯區內也能刪除，不用先取消編輯回到清單再找那顆刪除鈕
        // （handleDeleteTemplate 本身已含 confirm() 二次確認 + 刪除後自動關閉編輯器，直接沿用）
        const deleteInlineBtn = document.getElementById('mlp-tpl-delete-inline');
        if (deleteInlineBtn) deleteInlineBtn.addEventListener('click', function () {
            handleDeleteTemplate(_templateEditorState.id);
        });
        const answerGradingWrapEl = document.querySelector('.mlp-tpl-answer-grading-wrap');
        if (answerGradingWrapEl) bindAnswerGradingSettingsEvents(answerGradingWrapEl, 'mlp-tpl', _templateEditorState);
    }

    /**
     * 編輯既有的一筆（st.id 有值）：用 id 找回原本那一筆更新，不管有沒有順便改名字——
     * 用名字比對會在改名時變成「新增一筆」而不是「更新這一筆」，是錯的。
     * 新增（st.id 為 null）：用名字比對，同名＝覆蓋更新（跟舊版 Excel 小工具存檔同一套慣例），
     * 不同名＝新增一筆。
     */
    async function handleSaveTemplateFromEditor() {
        const msgEl = document.getElementById('mlp-tpl-msg');
        const st = _templateEditorState;
        if (!st) return;
        const name = String(st.name || '').trim();
        if (!name) { if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請幫這份 Template 取個名字'; } return; }
        const cols = st.columns.filter(function (c) { return c && String(c.letter || '').trim(); });
        if (!cols.length) { if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少新增一列欄位設定（欄位代號不能空白）'; } return; }
        const record = {
            name: name,
            columns: cols.map(function (c) {
                return {
                    letter: String(c.letter).trim(),
                    semantic_key: c.semantic_key || '',
                    is_question: !!c.is_question,
                    is_answer: !!c.is_answer,
                    is_info: !!c.is_info,
                    is_ai_ref: !!c.is_ai_ref
                };
            }),
            designed_from: st.designed_from || null,
            answer_mode: st.answerMode === 'separate' ? 'separate' : 'combine',
            answer_combine_note: st.answerCombineNote || '',
            speak_mode: ['formula', 'complex', 'paste'].indexOf(st.speakMode) !== -1 ? st.speakMode : 'formula',
            speak_formula: st.speakFormula || ''
        };
        const saveBtn = document.getElementById('mlp-tpl-save');
        if (saveBtn) saveBtn.disabled = true;
        if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
        try {
            const templates = await fetchFieldTemplates(true);
            const existingIdx = st.id
                ? templates.findIndex(function (t) { return t.id === st.id; })
                : templates.findIndex(function (t) { return String(t.name || '').trim() === name; });
            record.id = existingIdx !== -1 ? templates[existingIdx].id : ('mft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
            record.updated_at = new Date().toISOString();
            const nextList = templates.slice();
            if (existingIdx !== -1) nextList[existingIdx] = record; else nextList.push(record);
            await saveFieldTemplates(nextList);
            window.showFlash && window.showFlash((existingIdx !== -1 ? '已覆蓋更新' : '已新增') + ' Template「' + name + '」');
            _templateEditorState = null;
            renderTemplateEditor();
            renderTemplateList();
            refreshAppTemplateSelectOptions();
        } catch (err) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 儲存失敗：' + (err.message || err); }
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function handleDeleteTemplate(id) {
        const templates = getFieldTemplatesCachedSync();
        const t = templates.find(function (x) { return x.id === id; });
        if (!window.confirm('確定要刪除 Layout Template「' + (t ? t.name : '') + '」嗎？此動作無法復原（已套用到教材的紀錄不會自動跟著刪除，請自行到「📎 套用到教材」區塊檢查）。')) return;
        try {
            const latest = await fetchFieldTemplates(true);
            const nextList = latest.filter(function (x) { return x.id !== id; });
            await saveFieldTemplates(nextList);
            window.showFlash && window.showFlash('已刪除 Template「' + (t ? t.name : '') + '」');
            if (_templateEditorState && _templateEditorState.id === id) { _templateEditorState = null; renderTemplateEditor(); }
            renderTemplateList();
            refreshAppTemplateSelectOptions();
        } catch (err) {
            window.alert('刪除失敗：' + (err.message || err));
        }
    }

    /** 已存的 Template 清單：獨立顯示，不需要任何 Excel 檔案即可看到／編輯／刪除 */
    function renderTemplateList() {
        const wrap = document.getElementById('mlp-template-list');
        if (!wrap) return;
        const templates = getFieldTemplatesCachedSync();
        if (!templates.length) {
            wrap.innerHTML = '<div style="font-size:0.8rem; color:#94A3B8; padding:8px 0;">尚未建立任何 Layout Template，按上面「＋ 新增 Template」開始，或用下面「從本機 Excel 讀取活頁／欄位」小工具設計。</div>';
            return;
        }
        wrap.innerHTML = '<ul style="margin:0; padding:0; list-style:none;">'
            + templates.map(function (t) {
                const cols = Array.isArray(t.columns) ? t.columns : [];
                const qCount = cols.filter(function (c) { return c && c.is_question; }).length;
                const aCount = cols.filter(function (c) { return c && c.is_answer; }).length;
                const iCount = cols.filter(function (c) { return c && c.is_info; }).length;
                const airefCols = cols.filter(function (c) { return c && c.is_ai_ref; });
                // 2026-08-06：口說答案（口語批改基準）跟書寫答案欄不一定相同，且現階段
                // 允許整批留空——沒有指定這欄不再擋「產生 meta/script」，只是 script.txt 會整份留白，
                // 這裡用顏色提醒但不是報錯。2026-08-08：改成可複選，這裡要列出全部被勾選的欄，不是只取第一個。
                const airefText = airefCols.length
                    ? ('｜🎤 口說答案：' + airefCols.map(function (c) { return esc(c.semantic_key || c.letter); }).join('、'))
                    : '｜<span style="color:#D97706;">💡 尚未指定口說答案（script.txt 會整份留白，不影響 meta.json）</span>';
                // 2026-08-07：書寫答案欄數>1才有批改標準這個概念，欄數≤1不顯示，避免無意義的雜訊
                const gradingModeText = aCount > 1
                    ? ('｜答案批改：' + (t.answer_mode === 'separate' ? '分開比對' : '結合') + '｜口說批改：' + ({ formula: '公式', complex: '複雜規則', paste: '貼上多筆' }[t.speak_mode] || '公式'))
                    : '';
                const designed = t.designed_from;
                const designedText = designed ? ('｜設計參考：' + esc(designed.material_folder || '') + (designed.file_name ? '／' + esc(designed.file_name) : '')) : '';
                // 2026-08-06 修正：正在被上方編輯器編輯的那一筆，下面清單不該「照常顯示」（看起來像
                // 另一份獨立、可再點編輯/刪除的資料），要 highlight＋標「編輯中」，編輯/刪除按鈕停用，
                // 避免老師誤以為清單那一筆跟編輯器裡是兩份不同的東西、或誤按導致跟編輯器內容打架
                const isBeingEdited = !!(_templateEditorState && !_templateEditorState.isNew && _templateEditorState.id === t.id);
                const liStyle = isBeingEdited
                    ? 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:#FEF3C7; border:2px solid #F59E0B; border-radius:6px; padding:8px 10px; margin-bottom:6px;'
                    : 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px; margin-bottom:6px;';
                const actionsHtml = isBeingEdited
                    ? '<span style="padding:3px 10px; font-size:0.74rem; font-weight:800; border-radius:4px; background:#F59E0B; color:white;">✏️ 編輯中…</span>'
                    : '<button type="button" class="mlp-tpl-edit-btn" data-id="' + esc(t.id) + '" style="padding:3px 10px; font-size:0.74rem; font-weight:800; border:1px solid #93C5FD; border-radius:4px; background:#EFF6FF; color:#1D4ED8; cursor:pointer;">✏️ 編輯</button>'
                        + '<button type="button" class="mlp-tpl-duplicate-btn" data-id="' + esc(t.id) + '" style="padding:3px 10px; font-size:0.74rem; font-weight:800; border:1px solid #C4B5FD; border-radius:4px; background:#F5F3FF; color:#6D28D9; cursor:pointer;">📋 複製</button>'
                        + '<button type="button" class="mlp-tpl-delete-btn" data-id="' + esc(t.id) + '" style="padding:3px 10px; font-size:0.74rem; font-weight:800; border:1px solid #FCA5A5; border-radius:4px; background:white; color:#B91C1C; cursor:pointer;">🗑️ 刪除</button>';
                return '<li data-id="' + esc(t.id) + '" style="' + liStyle + '">'
                    + '<span style="font-size:0.82rem; color:#334155;"><strong>' + esc(t.name || '（未命名）') + '</strong>｜共 ' + cols.length + ' 欄（題目 ' + qCount + '／書寫答案 ' + aCount + '／訊息 ' + iCount + '）' + airefText + gradingModeText + designedText + '</span>'
                    + '<span style="flex:1;"></span>'
                    + actionsHtml
                    + '</li>';
            }).join('')
            + '</ul>';
        wrap.querySelectorAll('.mlp-tpl-edit-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const t = getFieldTemplatesCachedSync().find(function (x) { return x.id === btn.getAttribute('data-id'); });
                if (t) openTemplateEditorForExisting(t);
            });
        });
        wrap.querySelectorAll('.mlp-tpl-duplicate-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const t = getFieldTemplatesCachedSync().find(function (x) { return x.id === btn.getAttribute('data-id'); });
                if (t) openTemplateEditorForDuplicate(t);
            });
        });
        wrap.querySelectorAll('.mlp-tpl-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { handleDeleteTemplate(btn.getAttribute('data-id')); });
        });
    }

    /** 目前已知名稱都不重複的複本名稱：「原名（複製）」，若已存在就再加序號 (2)(3)... */
    function buildDuplicateTemplateName(originalName) {
        const existing = getFieldTemplatesCachedSync().map(function (x) { return String(x.name || '').trim(); });
        const base = String(originalName || '').trim() + '（複製）';
        if (existing.indexOf(base) === -1) return base;
        let n = 2;
        while (existing.indexOf(base + '(' + n + ')') !== -1) n++;
        return base + '(' + n + ')';
    }

    /**
     * 複製＝把既有 Template 的欄位設定整份複製一份，帶進「新增」編輯器（isNew=true、id=null），
     * 讓老師改個名字（或直接沿用自動產生的「（複製）」名稱）調整後再按儲存——複製這個動作本身
     * 不會馬上寫進 Supabase，按「取消」就跟沒發生過一樣，避免手滑點到複製就多一筆垂圾資料。
     * designed_from 也一併帶過去（複製自哪個原始設計參考，對老師來說仍是有用的資訊）。
     */
    function openTemplateEditorForDuplicate(t) {
        _templateEditorState = {
            id: null,
            isNew: true,
            name: buildDuplicateTemplateName(t.name),
            columns: (Array.isArray(t.columns) ? t.columns : []).map(function (c) {
                return {
                    letter: (c && c.letter) || '',
                    semantic_key: (c && c.semantic_key) || '',
                    is_question: !!(c && c.is_question),
                    is_answer: !!(c && c.is_answer),
                    is_info: !!(c && c.is_info),
                    is_ai_ref: !!(c && c.is_ai_ref)
                };
            }),
            designed_from: (t && t.designed_from) ? Object.assign({}, t.designed_from) : null,
            answerMode: (t && t.answer_mode === 'separate') ? 'separate' : 'combine',
            answerCombineNote: (t && t.answer_combine_note) || '',
            speakMode: (t && ['formula', 'complex', 'paste'].indexOf(t.speak_mode) !== -1) ? t.speak_mode : 'formula',
            speakFormula: (t && t.speak_formula) || ''
        };
        renderTemplateEditor();
        renderTemplateList();
        const editorEl = document.getElementById('mlp-template-editor');
        if (editorEl && typeof editorEl.scrollIntoView === 'function') editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.showFlash && window.showFlash('已複製「' + (t.name || '') + '」，確認欄位設定後請記得按「儲存」');
    }

    // ------------------------------------------------------------------
    // 📎 套用到教材（Layout Template ↔ 實際檔案，2026-08-05 第十三輪新增）
    //
    // 跟「教材／考試 Layout 搭配」（material_layout_pairs，決定 layout_profile_id 建議）是兩件
    // 不同的事：這裡是「欄位對應範本」套用到某個實際檔案時的行數起迄，跟 layout_profile_id 無關。
    // ------------------------------------------------------------------

    /**
     * 2026-08-06（老師更正規劃邏輯）：套用（Application）要分清楚兩個不同的「檔案」概念，
     * 不能混在一個「教材資料夾＋活頁單選」裡：
     * - 📁 歸屬檔案：這筆套用紀錄「實際指向哪裡」——一定是 Google Drive（老師個人／班級的
     *   材料夾），因為 feature-exam-job.js／批改系統實際運作時只認 Drive 上的真實檔案，
     *   不會去讀老師電腦裡的本機檔案。
     * - 📄 活頁來源：只是「怎麼知道要套用哪些活頁」的輔助手段，可以直接用上面歸屬資料夾裡
     *   偵測到的活頁清單（Drive），也可以改選一個本機 Excel 檔案掃描活頁名稱（Local，例如
     *   Drive 還沒上傳、或老師手邊只有本機檔案可以先核對活頁名稱）；活頁一定可以複選——
     *   同一個 Template＋同一段行數範圍常常要一次套用到好幾個活頁，不是每個活頁各存一筆。
     */
    function ensureAppRowState(appId, app) {
        if (!_appRowState[appId]) {
            const checked = {};
            (app && Array.isArray(app.sheet_ids) ? app.sheet_ids : []).forEach(function (s) { if (s) checked[s] = true; });
            _appRowState[appId] = {
                sourceKind: (app && app.source_kind === 'local') ? 'local' : 'drive',
                checkedSheets: checked,
                // local 模式下沒有持久化解析結果（本機檔案本身不會存進 Supabase），先用上次存檔時
                // 勾選過的活頁名稱當起始清單，讓老師不用重新選檔案就能看到之前套用的是哪些活頁
                localSheetNames: (app && app.source_kind === 'local' && Array.isArray(app.sheet_ids)) ? app.sheet_ids.slice() : [],
                localFileName: (app && app.source_kind === 'local' && app.source_file_name) || '',
                // 2026-08-06「產生並上傳」新增：本機檔案原始位元組（供之後針對某活頁做完整逐列解析，
                // 跟 handleAppLocalFileChange 目前只做 bookSheets 極速掃活頁名稱不同用途，不能共用
                // Excel 設計小工具那份模組層級 _excelRawData——同一頁可能同時開多列套用，各自檔案不同）
                localRawData: null,
                // 活頁名稱 → 完整逐列矩陣（array of arrays，含表頭列），避免同一活頁重複解析
                sheetMatrixCache: {},
                // 活頁名稱 → 這次「產生預覽」的結果 { rows, scriptLines, warnings, outputMeta, outputScript, uploadStatus }
                gen: {}
            };
        }
        return _appRowState[appId];
    }

    /** 活頁複選格線（歸屬 Drive 資料夾／本機 Excel 通用），跟 Excel 設計小工具的活頁勾選同一套視覺語言 */
    function renderSheetCheckboxGridHtml(names, checkedMap) {
        if (!names.length) return '';
        return '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">'
            + names.map(function (name) {
                const checked = !!checkedMap[name];
                return '<label class="mlp-app-sheet-chk-label" style="display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:6px; font-size:0.76rem; font-weight:700; cursor:pointer; '
                    + (checked ? 'background:#0F766E; color:white; border:1px solid #0F766E;' : 'background:#F1F5F9; color:#334155; border:1px solid #E2E8F0;') + '">'
                    + '<input type="checkbox" class="mlp-app-sheet-chk" data-sheet="' + esc(name) + '" ' + (checked ? 'checked' : '') + ' style="margin:0;">'
                    + esc(name) + '</label>';
            }).join('')
            + '</div>';
    }

    /** 「📄 活頁來源」子區塊：依目前 sourceKind 顯示切換鈕＋（Drive 清單 或 本機檔案選取＋清單） */
    function renderAppSheetsAreaHtml(appId, rootKind, classId, folder) {
        const state = ensureAppRowState(appId);
        const toggleHtml = '<div style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap;">'
            + '<button type="button" class="mlp-app-source-toggle" data-kind="drive" style="padding:4px 10px; font-size:0.74rem; font-weight:800; border-radius:6px; cursor:pointer; '
            + (state.sourceKind !== 'local' ? 'background:#0F766E; color:white; border:1px solid #0F766E;' : 'background:#F1F5F9; color:#334155; border:1px solid #E2E8F0;') + '">☁️ 用上面歸屬資料夾的活頁</button>'
            + '<button type="button" class="mlp-app-source-toggle" data-kind="local" style="padding:4px 10px; font-size:0.74rem; font-weight:800; border-radius:6px; cursor:pointer; '
            + (state.sourceKind === 'local' ? 'background:#0F766E; color:white; border:1px solid #0F766E;' : 'background:#F1F5F9; color:#334155; border:1px solid #E2E8F0;') + '">🖥️ 改用本機 Excel 掃描活頁名稱</button>'
            + '</div>';

        let bodyHtml;
        if (state.sourceKind === 'local') {
            const names = state.localSheetNames || [];
            bodyHtml = '<input type="file" class="form-control mlp-app-local-file" accept=".xlsx,.xls" style="max-width:320px; margin-bottom:6px;">'
                + '<div class="mlp-app-local-status" style="font-size:0.74rem; color:#EF4444; min-height:1.1em; margin-bottom:4px;"></div>'
                + (state.localFileName ? '<div style="font-size:0.72rem; color:#64748B; margin-bottom:4px;">目前參考檔案：' + esc(state.localFileName) + '</div>' : '')
                + (names.length
                    ? ('<div style="font-size:0.74rem; font-weight:800; color:#475569;">活頁（可複選，偵測到 ' + names.length + ' 個）：</div>' + renderSheetCheckboxGridHtml(names, state.checkedSheets))
                    : '<div style="color:#94A3B8; font-size:0.78rem;">請選擇本機 Excel 檔案，讀取後會列出所有活頁</div>');
        } else {
            const stems = folder ? sheetStemsForFolder(classId, rootKind, folder) : [];
            bodyHtml = stems.length
                ? ('<div style="font-size:0.74rem; font-weight:800; color:#475569;">活頁（可複選，偵測到 ' + stems.length + ' 個）：</div>' + renderSheetCheckboxGridHtml(stems, state.checkedSheets))
                : '<div style="color:#94A3B8; font-size:0.78rem;">' + (folder ? '這個資料夾目前偵測不到任何活頁' : '請先在上面選好歸屬檔案的教材資料夾') + '</div>';
        }
        return toggleHtml + bodyHtml;
    }

    /** 重畫「📄 活頁來源」子區塊並重新綁定事件（歸屬資料夾變了／切換來源模式／本機檔案讀取完成時呼叫） */
    function refreshAppSheetsArea(rowEl, appId) {
        const areaEl = rowEl.querySelector('.mlp-app-sheets-area');
        if (!areaEl) return;
        const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
        const classId = rowEl.querySelector('.mlp-app-class') ? rowEl.querySelector('.mlp-app-class').value : '';
        const folderSelectEl = rowEl.querySelector('.mlp-app-folder');
        const folder = folderSelectEl.value === '__manual__' ? rowEl.querySelector('.mlp-app-folder-manual').value.trim() : folderSelectEl.value;
        areaEl.innerHTML = renderAppSheetsAreaHtml(appId, rootKind, classId, folder);
        bindAppSheetsAreaEvents(rowEl, appId);
    }

    /** 歸屬資料夾的核對用小字（跟 sheetHintText 同一套），跟活頁來源模式無關——歸屬永遠是 Drive */
    function refreshAppSheetHint(rowEl) {
        const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
        const classId = rowEl.querySelector('.mlp-app-class') ? rowEl.querySelector('.mlp-app-class').value : '';
        const folderSelectEl = rowEl.querySelector('.mlp-app-folder');
        const folder = folderSelectEl.value === '__manual__' ? rowEl.querySelector('.mlp-app-folder-manual').value.trim() : folderSelectEl.value;
        const hintEl = rowEl.querySelector('.mlp-app-sheet-hint');
        if (hintEl) hintEl.textContent = sheetHintText(classId, rootKind, folder);
    }

    /** 本機 Excel 只需要活頁名稱清單（不需要欄位資料），用跟 Excel 設計小工具一樣的 bookSheets 極速讀取 */
    function handleAppLocalFileChange(appId, inputEl, rowEl) {
        const file = inputEl.files && inputEl.files[0];
        const state = ensureAppRowState(appId);
        const statusEl = rowEl.querySelector('.mlp-app-local-status');
        if (!file) return;
        if (!window.XLSX || typeof window.XLSX.read !== 'function') {
            if (statusEl) { statusEl.style.color = '#EF4444'; statusEl.textContent = '❌ Excel 解析套件（XLSX）未載入，請硬重新整理老師頁'; }
            return;
        }
        if (statusEl) { statusEl.style.color = '#0F766E'; statusEl.textContent = '⏳ 讀取中…'; }
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = window.XLSX.read(data, { type: 'array', bookSheets: true });
                state.localSheetNames = (wb && Array.isArray(wb.SheetNames)) ? wb.SheetNames : [];
                state.localFileName = file.name;
                // 換了本機檔案＝活頁清單整個換了，之前勾的名稱可能對不上新檔案，重置勾選
                state.checkedSheets = {};
                // 2026-08-06：留住原始位元組＋清空舊快取／舊產生結果，供「產生並上傳」針對勾選的
                // 活頁做完整逐列解析（跟這裡的 bookSheets 極速掃活頁名稱是兩個不同解析階段）
                state.localRawData = data;
                state.sheetMatrixCache = {};
                state.gen = {};
                if (statusEl) statusEl.textContent = '';
                refreshAppSheetsArea(rowEl, appId);
                refreshAppGenArea(rowEl, appId);
            } catch (err) {
                if (statusEl) { statusEl.style.color = '#EF4444'; statusEl.textContent = '❌ 讀取失敗：' + (err.message || err); }
            }
        };
        reader.onerror = function () {
            if (statusEl) { statusEl.style.color = '#EF4444'; statusEl.textContent = '❌ 檔案讀取失敗，請重新選擇檔案'; }
        };
        reader.readAsArrayBuffer(file);
    }

    function bindAppSheetsAreaEvents(rowEl, appId) {
        const state = ensureAppRowState(appId);
        rowEl.querySelectorAll('.mlp-app-source-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const kind = this.getAttribute('data-kind');
                if (state.sourceKind === kind) return;
                state.sourceKind = kind;
                refreshAppSheetsArea(rowEl, appId);
                refreshAppGenArea(rowEl, appId);
            });
        });
        const fileEl = rowEl.querySelector('.mlp-app-local-file');
        if (fileEl) fileEl.addEventListener('change', function () { handleAppLocalFileChange(appId, this, rowEl); });
        rowEl.querySelectorAll('.mlp-app-sheet-chk').forEach(function (chk) {
            chk.addEventListener('change', function () {
                const name = this.getAttribute('data-sheet');
                state.checkedSheets[name] = this.checked;
                const label = this.closest('.mlp-app-sheet-chk-label');
                if (label) {
                    label.style.background = this.checked ? '#0F766E' : '#F1F5F9';
                    label.style.color = this.checked ? 'white' : '#334155';
                    label.style.borderColor = this.checked ? '#0F766E' : '#E2E8F0';
                }
                // 勾選變動＝要產生的活頁清單變了，之前若已經跑過預覽，舊的預覽結果不該繼續當真
                // （尤其取消勾選某活頁後，那筆舊結果若還留著，老師按「確認上傳」會上傳到不該上傳的東西）
                delete state.gen[name];
                refreshAppGenArea(rowEl, appId);
            });
        });
    }

    // ========================================================================
    // 🚀「產生 meta / script 並上傳」— 2026-08-06 新增
    // 這是取代 material_templates/publish_local.py 終端機工具的瀏覽器版本：直接讀本機 Excel
    // 勾選的活頁，依 Layout Template 的欄位對應算出 meta.json（array of {semantic_key: value}，
    // 略過空值／未快取公式，只要這列任何一格有值就算有效列——跟 AI對照稿有沒有填無關）跟
    // script.txt（逐列對應 AI對照稿欄的內容，沒填就是空行，保持跟 meta.json 列數一致）。
    // 2026-08-06 澄清（老師明確更正）：🎤 AI對照稿（口語批改基準）跟「答案」欄（書寫解答，
    // 印在考卷上，可能是多欄組合，例如 to/a park）不是同一件事，也不一定 identical——AI對照稿
    // 的組合規則還在整理中，現階段允許整批留空，是完全獨立、選填的一欄，不再是舊版
    // publish_local.py 那種「semantic_key==='script' 才算有效列」的判斷依據。
    // 確認預覽無誤後直接呼叫 GAS upload_file 寫進「📁 歸屬檔案」指定的教材資料夾。
    // ========================================================================

    /** Excel 欄位代號（A、B…AB…）轉 0-based index，優先用 XLSX.utils.decode_col，沒有就手算 */
    function colLetterToIndex0(letter) {
        const s = String(letter || '').trim().toUpperCase();
        if (!s) return -1;
        if (window.XLSX && window.XLSX.utils && typeof window.XLSX.utils.decode_col === 'function') {
            try {
                const idx = window.XLSX.utils.decode_col(s);
                return (typeof idx === 'number' && idx >= 0) ? idx : -1;
            } catch (_e) { /* fall through to manual算 */ }
        }
        let n = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (c < 65 || c > 90) return -1;
            n = n * 26 + (c - 64);
        }
        return n - 1;
    }

    /**
     * 針對某個活頁取得完整逐列矩陣（array of arrays，含表頭列，row 1 = matrix[0]），
     * 每個 appId 各自快取（同一頁可能同時開多列套用，各自本機檔案不同，不能共用單一份快取）。
     * raw:true 保留數字型別、blankrows:true 保留空列——行號才對得上 Excel 真實列號，
     * 跟 row_start／row_end 是「真實列號」而不是「第幾筆非空列」的語意一致。
     */
    function parseAppSheetMatrix(appId, sheetName) {
        const state = ensureAppRowState(appId);
        if (state.sheetMatrixCache[sheetName]) return state.sheetMatrixCache[sheetName];
        if (!state.localRawData || !window.XLSX || typeof window.XLSX.read !== 'function') return null;
        let matrix = null;
        try {
            const wb = window.XLSX.read(state.localRawData, { type: 'array', sheets: [sheetName] });
            const sheet = wb && wb.Sheets && wb.Sheets[sheetName];
            if (sheet) {
                matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
            }
        } catch (_e) {
            matrix = null;
        }
        if (matrix) state.sheetMatrixCache[sheetName] = matrix;
        return matrix;
    }

    /** 找矩陣裡指定欄「最後一個有值」的列號（1-based），對應 LAST(欄位) 語意，跟 publish_local.py 的 get_last_data_row_from_matrix 一致 */
    function getLastDataRowInMatrix(matrix, colLetter) {
        const colIdx = colLetterToIndex0(colLetter);
        const idx = colIdx >= 0 ? colIdx : 0;
        for (let r = matrix.length; r >= 1; r--) {
            const v = (matrix[r - 1] || [])[idx];
            if (v !== null && v !== undefined && String(v).trim() !== '') return r;
        }
        return 1;
    }

    /**
     * 找矩陣裡「fieldMap 裡任何一欄有值」的最後一列（1-based）。
     * 2026-08-06 修正：裸寫 LAST（沒指定欄位）以前是 fallback 到 AI對照稿欄，但 AI對照稿
     * 現在允許整批留空（見 buildGenerationForSheet 的說明），若仍 fallback 到那一欄，
     * AI對照稿還沒填的檔案會被裸 LAST 誤判成「提早結束」，漏掉後面明明有書寫解答的列。
     * 改成看「這個 Template 有對應到的所有欄」，只要任何一欄有值就算這列還算數。
     */
    function getLastDataRowAnyField(matrix, fieldMap) {
        if (!Array.isArray(fieldMap) || !fieldMap.length) return matrix.length;
        for (let r = matrix.length; r >= 1; r--) {
            const rowArr = matrix[r - 1] || [];
            const hasAny = fieldMap.some(function (f) {
                const v = rowArr[f.idx];
                return v !== null && v !== undefined && String(v).trim() !== '';
            });
            if (hasAny) return r;
        }
        return 1;
    }

    /** 行數末：空白＝到最後一列；LAST／LAST(欄位)＝找該欄（或任何有對應欄位）最後有值列；純數字＝直接當列號 */
    function resolveRowEndRow(matrix, rowEndStr, fieldMap) {
        const raw = String(rowEndStr || '').trim();
        if (!raw) return matrix.length;
        const upper = raw.toUpperCase();
        if (upper === 'LAST') return getLastDataRowAnyField(matrix, fieldMap);
        const m = upper.match(/^LAST\(([A-Z]+)\)$/);
        if (m) return getLastDataRowInMatrix(matrix, m[1]);
        const n = parseInt(raw, 10);
        return isNaN(n) ? matrix.length : n;
    }

    /**
     * 依 Template 欄位對應算出某活頁「行數起～行數末」範圍內的 rows／script 行。
     *
     * 2026-08-06 修正（老師明確澄清）：AI對照稿（口語批改基準）跟書寫解答（is_answer，
     * 印在考卷上的答案，可能是 pre+" "+script 這種多欄組合出來的形式，例如書寫解答
     * 「to/a park」對應 AI對照稿「to park a park」）並不 identical，AI對照稿的組合規則
     * 老師還在整理，現階段允許整批留空——所以「這列算不算有效列」不能再靠 AI對照稿欄
     * 有沒有值來判斷（那是舊版 publish_local.py 的邏輯，已淘汰），改成「這列只要任何一個
     * 有對應到欄位的格子有值」就算有效列。AI對照稿欄本身也變成完全選填：
     *   - Template 可以沒有指定 AI對照稿欄（不再擋「產生 meta/script」，只給提示）
     *   - 即使指定了，某一列該欄留白也不影響這列進 meta.json，只是 script.txt 那一行會是空行
     * 空行（而不是整行跳過）是為了保持 script.txt 跟 meta.json rows「逐列對應」的位置關係，
     * 之後老師陸續補上 AI對照稿內容時，行號不會全部錯位。
     *
     * 2026-08-07（正名＋批改標準）：AI對照稿→口說答案；答案→書寫答案。書寫答案欄數>1時，
     * 每列會多寫 _answer_mode／_answer_keys（供線上考卷之後判斷分開比對／結合），口說答案欄數>1
     * 且批改標準為「帶入公式」時，用 LayoutFieldsEval 依公式算出候選值；「複雜規則」／「貼上多筆」
     * 兩種模式先留白，交給老師在畫面上逐列個別修正（overrides，key＝Excel 真實列號 r）。
     * overrides／老師修正值優先於公式算出來的候選值，兩者都會回傳供畫面顯示「計算值」對照。
     *
     * 2026-08-08（口說答案改可複選）：老師強調「口說答案不能互斥」，UI 已經是可勾多欄的
     * checkbox。這裡對應改成 `airefCols`（陣列，不再只取第一個）：
     *   - 0 欄：候選值＝''（維持舊行為，允許整批留空）
     *   - 1 欄：候選值＝該欄原始值（跟改成可複選之前完全一樣，單欄老師不會感覺到任何變化）
     *   - ≥2 欄：候選值＝依欄位順序把這些欄的原始值用空白串接起來（沒有另外設定公式時的
     *     預設組合方式；aCount>1 且 speakMode==='formula' 時仍優先用 speakFormula 算）
     * 最終值只有「剛好 1 欄」時才會覆寫回該欄自己的 semantic_key（維持舊行為：那欄本來就是
     * 「口說答案」欄本身）；≥2 欄時**不**覆寫任何一欄的原始值——因為同一欄可能同時也被勾了
     * 「書寫答案」等其他角色，覆寫會把該欄原本的內容洗掉，最終合併後的口說答案只會出現在
     * script.txt／scriptLines，不會混進 meta.json 個別欄位裡。
     */
    /** 「套用到教材」用：從某個 appId 已選好的本機檔案取矩陣，其餘生成邏輯共用 buildGenerationFromMatrix */
    function buildGenerationForSheet(appId, sheetName, template, rowStartStr, rowEndStr, overrides) {
        const matrix = parseAppSheetMatrix(appId, sheetName);
        return buildGenerationFromMatrix(matrix, template, rowStartStr, rowEndStr, overrides);
    }

    /**
     * 核心生成邏輯：給矩陣（不管來自哪個 appId／哪個本機檔案）＋ template ＋ 行數起迄，算出
     * meta.json rows／script.txt 行。「套用到教材」（buildGenerationForSheet）跟「設計 Template」
     * 卡片內的即時預覽（segment 用 parseExcelSegmentMatrix 取矩陣）共用這一份，避免兩邊各寫一次、
     * 之後改邏輯又要改兩處、漏改一處。
     */
    function buildGenerationFromMatrix(matrix, template, rowStartStr, rowEndStr, overrides) {
        if (!matrix || !matrix.length) {
            return { ok: false, error: '找不到活頁資料或活頁是空的，請確認本機 Excel 檔案已選擇、活頁名稱正確' };
        }
        const cols = Array.isArray(template && template.columns) ? template.columns : [];
        const airefCols = cols.filter(function (c) { return c && c.is_ai_ref && c.letter && c.semantic_key; });
        const answerCols = cols.filter(function (c) { return c && c.is_answer && c.letter && c.semantic_key; });
        const aCount = answerCols.length;
        const answerMode = template && template.answer_mode === 'separate' ? 'separate' : 'combine';
        const speakMode = (template && ['formula', 'complex', 'paste'].indexOf(template.speak_mode) !== -1) ? template.speak_mode : 'formula';
        const speakFormula = (template && template.speak_formula) || '';
        const fieldMap = cols.filter(function (c) { return c && c.letter && c.semantic_key; }).map(function (c) {
            return { key: c.semantic_key, idx: colLetterToIndex0(c.letter), letter: String(c.letter).toUpperCase() };
        }).filter(function (f) { return f.idx >= 0; });
        if (!fieldMap.length) return { ok: false, error: 'Template 沒有任何有效的欄位對應（欄位代號或資料項名稱缺漏）' };
        // 給公式引擎相容用：欄位代號（大寫）→ 資料項名稱，讓「AN&" "&AO」這種寫法也能算
        const letterToSemantic = {};
        fieldMap.forEach(function (f) { letterToSemantic[f.letter] = f.key; });
        const overrideMap = overrides || {};

        let rowStart = parseInt(rowStartStr, 10);
        if (isNaN(rowStart) || rowStart < 1) rowStart = 2;
        const rowEnd = Math.min(resolveRowEndRow(matrix, rowEndStr, fieldMap), matrix.length);
        if (rowEnd < rowStart) {
            return { ok: false, error: '列範圍無效（行數起 ' + rowStart + ' 大於行數末 ' + rowEnd + '，請確認 Excel 是否真的有這麼多列資料）' };
        }

        const rows = [];
        const scriptLines = [];
        const rowNos = [];
        const speakComputed = [];
        const warnings = [];
        let formulaWarned = false;
        let missingAiRefCount = 0;
        let formulaErrorWarned = false;
        for (let r = rowStart; r <= rowEnd; r++) {
            const rowArr = matrix[r - 1] || [];
            const rowObj = {};
            let hasAnyValue = false;
            fieldMap.forEach(function (f) {
                let v = rowArr[f.idx];
                if (typeof v === 'string' && v.trim().charAt(0) === '=') {
                    if (!formulaWarned) {
                        warnings.push('⚠️ 偵測到尚未計算出結果的公式字串（例如第 ' + r + ' 列），該格已略過——請先在 Excel 打開並存檔一次讓公式結果被快取，否則這欄會是空的。');
                        formulaWarned = true;
                    }
                    return;
                }
                if (v === null || v === undefined || String(v).trim() === '') return;
                rowObj[f.key] = v;
                hasAnyValue = true;
            });
            if (!hasAnyValue) continue;

            if (aCount > 1) {
                rowObj._answer_mode = answerMode;
                rowObj._answer_keys = answerCols.map(function (c) { return c.semantic_key; });
            }

            // 候選口說答案值：書寫答案≤1欄＝維持舊行為（口說答案欄原始值，可複選後多欄用空白串接）；
            // >1欄則依批改標準決定（帶公式優先，否則跟口說答案多欄一樣退回空白串接）
            let candidate = '';
            if (aCount > 1 && speakMode === 'formula' && speakFormula && window.LayoutFieldsEval) {
                try {
                    const cells = window.LayoutFieldsEval.evaluateFields(speakFormula, rowObj, letterToSemantic);
                    candidate = (cells && cells[0] && cells[0].text != null) ? String(cells[0].text) : '';
                } catch (_e) {
                    candidate = '';
                    if (!formulaErrorWarned) {
                        warnings.push('⚠️ 口說答案公式「' + speakFormula + '」計算失敗（例如第 ' + r + ' 列），這幾列口說答案先留白，請逐列個別修正或修正公式。');
                        formulaErrorWarned = true;
                    }
                }
            } else if (aCount > 1 && (speakMode === 'complex' || speakMode === 'paste')) {
                // 先留白（candidate=''），交給老師逐列修正／貼上
            } else if (airefCols.length > 1) {
                // 沒有指定公式（或書寫答案≤1欄）時，多欄口說答案的預設組合方式：依欄位順序空白串接
                candidate = airefCols.map(function (c) { return rowObj[c.semantic_key]; })
                    .filter(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; })
                    .map(function (v) { return String(v).trim(); })
                    .join(' ');
            } else {
                const airefVal = airefCols[0] ? rowObj[airefCols[0].semantic_key] : null;
                candidate = (airefVal !== null && airefVal !== undefined) ? String(airefVal).trim() : '';
            }

            const override = overrideMap[r];
            const finalSpeak = (override !== null && override !== undefined) ? String(override) : candidate;
            // 只有「剛好 1 欄」才覆寫回該欄自己的 semantic_key（維持舊行為：那欄本身就代表口說答案）；
            // ≥2 欄時不覆寫任何一欄的原始值——同一欄可能同時兼任「書寫答案」等其他角色，
            // 覆寫會把該欄原始內容洗掉，合併後的結果只會出現在 script.txt／scriptLines
            if (airefCols.length === 1) rowObj[airefCols[0].semantic_key] = finalSpeak;

            rows.push(rowObj);
            rowNos.push(r);
            speakComputed.push(candidate);
            if (!finalSpeak.trim()) missingAiRefCount++;
            scriptLines.push(finalSpeak.trim());
        }
        if (!rows.length) {
            warnings.push('⚠️ 第 ' + rowStart + '～' + rowEnd + ' 列裡每一格都是空的，產出會是 0 列——請確認行數起迄是否正確。');
        } else if (aCount > 1 && (speakMode === 'complex' || speakMode === 'paste')) {
            warnings.push('💡 這個 Template 書寫答案共 ' + aCount + ' 欄，口說答案批改標準為「' + (speakMode === 'paste' ? '直接貼上多筆' : '之後會寫複雜規則') + '」，請在下方逐列表格貼上／輸入口說答案內容（目前 ' + missingAiRefCount + '／' + rows.length + ' 列尚未填）。');
        } else if (!airefCols.length && aCount <= 1) {
            warnings.push('💡 這個 Template 尚未指定「🎤 口說答案」欄位，script.txt 會整份留白（' + rows.length + ' 個空行）——之後在 Layout Template 補上該欄再重新產生即可，不影響 meta.json 這 ' + rows.length + ' 列。');
        } else if (missingAiRefCount > 0) {
            warnings.push('💡 這 ' + rows.length + ' 列裡有 ' + missingAiRefCount + ' 列口說答案留白，script.txt 對應那幾行會是空行——不影響 meta.json，之後補上內容重新產生即可。');
        }
        return {
            ok: true,
            rows: rows,
            scriptLines: scriptLines,
            rowNos: rowNos,
            speakComputed: speakComputed,
            aCount: aCount,
            speakMode: speakMode,
            answerMode: answerMode,
            warnings: warnings,
            rowStart: rowStart,
            rowEnd: rowEnd
        };
    }

    function defaultOutputNames(sheetName) {
        const base = String(sheetName || '').trim() || 'output';
        return { meta: base + '.meta.json', script: base + '.script.txt' };
    }

    /** JS 字串（含中文）轉 base64，供 GAS upload_file 的 fileData（Utilities.base64Decode 之後寫檔）使用 */
    function utf8ToBase64(str) {
        if (window.TextEncoder) {
            const bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        }
        return btoa(unescape(encodeURIComponent(str)));
    }

    function getCurrentAppTemplate(rowEl) {
        const selectEl = rowEl.querySelector('.mlp-app-template');
        const name = selectEl ? selectEl.value : '';
        if (!name) return null;
        return getFieldTemplatesCachedSync().find(function (t) { return t.name === name; }) || null;
    }

    function checkedSheetNames(state) {
        return Object.keys(state.checkedSheets || {}).filter(function (k) { return state.checkedSheets[k]; }).sort();
    }

    function canConfirmUpload(state, sheetNames) {
        return sheetNames.length > 0 && sheetNames.every(function (name) {
            const g = state.gen[name];
            return g && g.previewed && !g.error && g.rows && g.rows.length > 0;
        });
    }

    /**
     * 書寫答案欄數>1 時，口說答案批改標準的逐列確認／修正表格：計算值（唯讀，來自公式或空白）
     * 對照修正後值（可編輯，預填為目前最終值），修正後即為最終寫入 meta.json／script.txt 的內容。
     * speak_mode==='paste' 時額外顯示「貼上多筆」小工具（標注起始題號，依 item_no 比對；沒有
     * item_no 或比對不上的列就依順序 fallback），套用後同樣落到同一份 override 表，仍可再個別修正。
     */
    function renderSpeakOverrideAreaHtml(name, g) {
        if (!g || !g.previewed || g.error || !Array.isArray(g.rows) || !g.rows.length || !(g.aCount > 1)) return '';
        const pasteBlockHtml = g.speakMode === 'paste' ? (
            '<div style="margin-top:6px; padding:8px; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:6px;">'
            + '<div style="font-size:0.72rem; font-weight:800; color:#475569; margin-bottom:4px;">📋 貼上多筆口說答案（一行一筆；若列上有題號會依起始題號比對，否則依順序比對）</div>'
            + '<div style="display:flex; gap:6px; align-items:center; margin-bottom:4px; flex-wrap:wrap;">'
            + '<label style="font-size:0.72rem; color:#64748B;">起始題號<input type="number" class="form-control mlp-app-speak-paste-start" style="width:90px; padding:4px; margin-left:4px;"></label>'
            + '<button type="button" class="mlp-app-speak-paste-apply btn" style="padding:4px 10px; font-size:0.72rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px; cursor:pointer;">套用貼上內容</button>'
            + '</div>'
            + '<textarea class="form-control mlp-app-speak-paste-text" rows="4" style="width:100%; font-size:0.76rem; padding:6px;" placeholder="一行一筆，依序或依題號對應各列"></textarea>'
            + '</div>'
        ) : '';
        const rowsHtml = g.rows.map(function (row, i) {
            const rowNo = g.rowNos ? g.rowNos[i] : (g.rowStart + i);
            const computed = (g.speakComputed && g.speakComputed[i]) || '';
            const finalVal = (g.scriptLines && g.scriptLines[i]) || '';
            const answerPreview = (Array.isArray(row._answer_keys) ? row._answer_keys : []).map(function (k) { return row[k]; }).filter(function (v) { return v != null && v !== ''; }).join(' / ');
            return '<tr>'
                + '<td style="padding:3px 6px; font-size:0.7rem; color:#94A3B8; white-space:nowrap;">第' + rowNo + '列</td>'
                + '<td style="padding:3px 6px; font-size:0.72rem; color:#334155;">' + esc(answerPreview) + '</td>'
                + '<td style="padding:3px 6px; font-size:0.72rem; color:#94A3B8;">' + (computed ? esc(computed) : '（無）') + '</td>'
                + '<td style="padding:3px 6px;"><input type="text" class="form-control mlp-app-speak-override" data-row-no="' + rowNo + '" data-idx="' + i + '" value="' + esc(finalVal) + '" style="width:100%; padding:4px; font-size:0.76rem;"></td>'
                + '</tr>';
        }).join('');
        return `
            <div style="margin-top:8px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; padding:8px;">
                <div style="font-size:0.74rem; font-weight:800; color:#92400E; margin-bottom:4px;">🎤 口說答案逐列確認／修正（共 ${g.rows.length} 列，修正後即為最終寫入內容）</div>
                ${pasteBlockHtml}
                <div style="max-height:260px; overflow-y:auto; margin-top:6px;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead><tr style="text-align:left; font-size:0.68rem; color:#78716C;"><th style="padding:3px 6px;">列號</th><th style="padding:3px 6px;">書寫答案</th><th style="padding:3px 6px;">計算值</th><th style="padding:3px 6px;">最終口說答案（可修正）</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderAppGenAreaHtml(appId) {
        const state = ensureAppRowState(appId);
        if (state.sourceKind !== 'local') {
            return '<div style="color:#78716C; font-size:0.78rem;">目前只支援對「🖥️ 改用本機 Excel 掃描活頁名稱」模式產生檔案——瀏覽器需要讀到真正的表格內容才能算出 meta/script，上面「☁️ 用歸屬資料夾的活頁」只是 Drive 上既有檔名清單，沒有原始儲存格資料可讀。</div>';
        }
        if (!state.localRawData) {
            return '<div style="color:#78716C; font-size:0.78rem;">請先在上面「📄 活頁來源」選擇本機 Excel 檔案。</div>';
        }
        const sheetNames = checkedSheetNames(state);
        if (!sheetNames.length) {
            return '<div style="color:#78716C; font-size:0.78rem;">請先在上面勾選至少一個活頁。</div>';
        }
        const rowsHtml = sheetNames.map(function (name) {
            const g = state.gen[name] || {};
            const defaults = defaultOutputNames(name);
            const metaName = g.outputMeta != null ? g.outputMeta : defaults.meta;
            const scriptName = g.outputScript != null ? g.outputScript : defaults.script;
            let bodyHtml = '';
            if (g.previewed) {
                if (g.error) {
                    bodyHtml = '<div style="color:#DC2626; font-size:0.76rem; margin-top:4px;">❌ ' + esc(g.error) + '</div>';
                } else {
                    const sample = (g.rows || []).slice(0, 3);
                    const sampleHtml = sample.length
                        ? ('<pre style="background:#0F172A; color:#A7F3D0; font-size:0.68rem; padding:8px; border-radius:6px; overflow-x:auto; margin:6px 0 0; max-height:180px;">' + esc(JSON.stringify(sample, null, 2)) + '</pre>')
                        : '';
                    const warnHtml = (g.warnings || []).map(function (w) { return '<div style="color:#B45309; font-size:0.72rem; margin-top:2px;">' + esc(w) + '</div>'; }).join('');
                    bodyHtml = '<div style="font-size:0.76rem; color:#0F766E; font-weight:800; margin-top:4px;">✅ 共 ' + g.rows.length + ' 列（下方預覽前 ' + sample.length + ' 列），script.txt ' + g.scriptLines.length + ' 行</div>'
                        + warnHtml + sampleHtml + renderSpeakOverrideAreaHtml(name, g);
                }
            }
            const uploadHtml = g.uploadStatus
                ? ('<div style="font-size:0.76rem; font-weight:800; margin-top:4px; color:' + (g.uploadStatus.ok ? '#059669' : '#DC2626') + ';">' + esc(g.uploadStatus.text) + '</div>')
                : '';
            return '<div class="mlp-app-gen-sheet" data-sheet="' + esc(name) + '" style="background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px; margin-bottom:8px;">'
                + '<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">'
                + '<strong style="font-size:0.8rem; color:#334155; min-width:90px;">📄 ' + esc(name) + '</strong>'
                + '<label style="font-size:0.72rem; color:#64748B;">meta 檔名<br><input type="text" class="form-control mlp-app-gen-metaname" value="' + esc(metaName) + '" style="width:190px; padding:4px; font-size:0.74rem;"></label>'
                + '<label style="font-size:0.72rem; color:#64748B;">script 檔名<br><input type="text" class="form-control mlp-app-gen-scriptname" value="' + esc(scriptName) + '" style="width:190px; padding:4px; font-size:0.74rem;"></label>'
                + '</div>'
                + bodyHtml + uploadHtml
                + '</div>';
        }).join('');

        return '<div>'
            + rowsHtml
            + '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:4px;">'
            + '<button type="button" class="mlp-app-gen-preview btn" style="padding:6px 14px; font-size:0.78rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px; cursor:pointer;">🔍 產生預覽</button>'
            /**
             * 💣 雷區：這顆按鈕絕對不能再用 canConfirmUpload() 加 disabled——
             * disabled 的 <button> 在瀏覽器裡完全不會發出 click 事件，`bindAppGenAreaEvents`
             * 掛的 addEventListener('click', handleConfirmUpload) 永遠不會被呼叫到，
             * handleConfirmUpload 內部「沒有預覽就自動補跑」的邏輯因此變成死碼——這正是
             * 「沒有看預覽，按了儲存，沒有作用」的真正原因（2026-08-09 使用者回報兩次，
             * 上一輪只修了函式內部邏輯，忘了拿掉這裡的 disabled，等於沒修到）。
             * 一律可點，交給 handleConfirmUpload 自己判斷要不要先補跑預覽、或顯示錯誤訊息。
             */
            + '<button type="button" class="mlp-app-gen-upload btn btn-primary" style="padding:6px 14px; font-size:0.78rem; font-weight:800;">☁️ 確認上傳到 Drive</button>'
            + '<span class="mlp-app-gen-msg" style="font-size:0.76rem; font-weight:800;"></span>'
            + '</div>'
            + '</div>';
    }

    function refreshAppGenArea(rowEl, appId) {
        const areaEl = rowEl.querySelector('.mlp-app-gen-area');
        if (!areaEl) return;
        areaEl.innerHTML = renderAppGenAreaHtml(appId);
        bindAppGenAreaEvents(rowEl, appId);
    }

    function bindAppGenAreaEvents(rowEl, appId) {
        const state = ensureAppRowState(appId);
        rowEl.querySelectorAll('.mlp-app-gen-metaname').forEach(function (input) {
            input.addEventListener('change', function () {
                const name = this.closest('.mlp-app-gen-sheet').getAttribute('data-sheet');
                if (!state.gen[name]) state.gen[name] = {};
                state.gen[name].outputMeta = this.value.trim();
            });
        });
        rowEl.querySelectorAll('.mlp-app-gen-scriptname').forEach(function (input) {
            input.addEventListener('change', function () {
                const name = this.closest('.mlp-app-gen-sheet').getAttribute('data-sheet');
                if (!state.gen[name]) state.gen[name] = {};
                state.gen[name].outputScript = this.value.trim();
            });
        });
        const previewBtn = rowEl.querySelector('.mlp-app-gen-preview');
        if (previewBtn) previewBtn.addEventListener('click', function () { handleGeneratePreview(rowEl, appId); });
        const uploadBtn = rowEl.querySelector('.mlp-app-gen-upload');
        if (uploadBtn) uploadBtn.addEventListener('click', function () { handleConfirmUpload(rowEl, appId); });

        /**
         * 逐列修正輸入框：改一列＝立刻更新這一列的 g.scriptLines／g.speakOverrides（供上傳直接採用）。
         * 只有「Template 剛好只勾了 1 欄口說答案」時，才同步寫回 g.rows 裡那一欄語意鍵的值
         * （跟 buildGenerationFromMatrix 對齊：那欄本身就代表口說答案，維持舊行為）；勾了 2 欄以上
         * 時**不**寫回任何一欄的原始值——同一欄可能同時兼任「書寫答案」等其他角色，寫回會把
         * 該欄原始內容洗掉，修正後的值只會留在 script.txt／scriptLines。
         */
        rowEl.querySelectorAll('.mlp-app-speak-override').forEach(function (input) {
            input.addEventListener('change', function () {
                const sheetEl = this.closest('.mlp-app-gen-sheet');
                const name = sheetEl ? sheetEl.getAttribute('data-sheet') : '';
                const g = state.gen[name];
                if (!g) return;
                const rowNo = parseInt(this.getAttribute('data-row-no'), 10);
                const idx = parseInt(this.getAttribute('data-idx'), 10);
                if (!g.speakOverrides) g.speakOverrides = {};
                g.speakOverrides[rowNo] = this.value;
                if (Array.isArray(g.scriptLines) && idx >= 0) g.scriptLines[idx] = this.value;
                const template = getCurrentAppTemplate(rowEl);
                const airefCols = (template && Array.isArray(template.columns))
                    ? template.columns.filter(function (c) { return c && c.is_ai_ref && c.semantic_key; })
                    : [];
                if (airefCols.length === 1 && g.rows && g.rows[idx]) g.rows[idx][airefCols[0].semantic_key] = this.value;
            });
        });
        rowEl.querySelectorAll('.mlp-app-speak-paste-apply').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const sheetEl = this.closest('.mlp-app-gen-sheet');
                const name = sheetEl ? sheetEl.getAttribute('data-sheet') : '';
                const startEl = sheetEl ? sheetEl.querySelector('.mlp-app-speak-paste-start') : null;
                const textEl = sheetEl ? sheetEl.querySelector('.mlp-app-speak-paste-text') : null;
                handleApplyPasteBlock(rowEl, appId, name, startEl ? startEl.value : '', textEl ? textEl.value : '');
            });
        });
    }

    /**
     * 貼上多筆口說答案：有題號（item_no）就依「起始題號」比對到正確列（跳過中間缺的題號也不會位移），
     * 沒有題號就依貼上內容的行序對應各列。套用結果直接寫進 speakOverrides（跟老師手動逐列修正
     * 是同一份資料），套用完仍可再對單一列個別修正——不是不可逆的批次操作。
     */
    function handleApplyPasteBlock(rowEl, appId, name, startStr, pastedText) {
        const state = ensureAppRowState(appId);
        const g = state.gen[name];
        const msgEl = rowEl.querySelector('.mlp-app-gen-msg');
        if (!g || !Array.isArray(g.rows) || !g.rows.length) return;
        const lines = String(pastedText || '').split(/\r?\n/);
        if (!g.speakOverrides) g.speakOverrides = {};
        const startNo = parseInt(startStr, 10);
        const template = getCurrentAppTemplate(rowEl);
        // 只有剛好 1 欄口說答案時才寫回該欄原始值（理由跟逐列修正輸入框一致，見上方註解）
        const airefCols = (template && Array.isArray(template.columns))
            ? template.columns.filter(function (c) { return c && c.is_ai_ref && c.semantic_key; })
            : [];
        const airefCol = airefCols.length === 1 ? airefCols[0] : null;
        let applied = 0;
        g.rows.forEach(function (row, i) {
            let lineIdx = i;
            if (!isNaN(startNo)) {
                const itemNo = Number(row.item_no);
                if (!isNaN(itemNo)) lineIdx = itemNo - startNo;
            }
            if (lineIdx < 0 || lineIdx >= lines.length) return;
            const val = lines[lineIdx];
            const rowNo = (g.rowNos && g.rowNos[i]) || (g.rowStart + i);
            g.speakOverrides[rowNo] = val;
            if (Array.isArray(g.scriptLines)) g.scriptLines[i] = val;
            if (airefCol) row[airefCol.semantic_key] = val;
            applied += 1;
        });
        if (msgEl) {
            msgEl.style.color = applied === g.rows.length ? '#059669' : '#B45309';
            msgEl.textContent = '✅ 已套用貼上內容（' + applied + '/' + g.rows.length + ' 列對應成功）'
                + (applied < g.rows.length ? '，部分列題號對不上或貼上行數不足，其餘列請個別修正' : '');
        }
        refreshAppGenArea(rowEl, appId);
    }

    /**
     * 核心「算列」邏輯，抽成獨立函式供「🔍 產生預覽」按鈕與「☁️ 確認上傳到 Drive」
     * 自動補跑共用——不要各寫一份，之後改一邊漏改另一邊。只回報成敗，不碰 DOM 訊息／不 refresh，
     * 交給呼叫端決定要不要顯示訊息、要不要重繪。
     */
    function generatePreviewForRow(rowEl, appId) {
        const state = ensureAppRowState(appId);
        const template = getCurrentAppTemplate(rowEl);
        if (!template) return { ok: false, error: '請先在最上面選一個 Layout Template' };
        const sheetNames = checkedSheetNames(state);
        if (!sheetNames.length) return { ok: false, error: '請先勾選至少一個活頁' };
        const rowStartStr = rowEl.querySelector('.mlp-app-rowstart').value;
        const rowEndStr = rowEl.querySelector('.mlp-app-rowend').value;
        sheetNames.forEach(function (name) {
            const prevOutputMeta = state.gen[name] && state.gen[name].outputMeta;
            const prevOutputScript = state.gen[name] && state.gen[name].outputScript;
            // speakOverrides（老師逐列修正／貼上的口說答案）要跨「重新產生預覽」保留下來，
            // 不能因為改了行數起迄或重按一次預覽就整批被公式算出來的候選值蓋掉
            const prevOverrides = (state.gen[name] && state.gen[name].speakOverrides) || {};
            const result = buildGenerationForSheet(appId, name, template, rowStartStr, rowEndStr, prevOverrides);
            state.gen[name] = Object.assign({}, result, {
                previewed: true,
                outputMeta: prevOutputMeta,
                outputScript: prevOutputScript,
                uploadStatus: null,
                speakOverrides: prevOverrides
            });
        });
        return { ok: true, sheetNames: sheetNames };
    }

    function handleGeneratePreview(rowEl, appId) {
        const msgEl = rowEl.querySelector('.mlp-app-gen-msg');
        const res = generatePreviewForRow(rowEl, appId);
        if (!res.ok) {
            if (msgEl) { msgEl.style.color = '#DC2626'; msgEl.textContent = '❌ ' + res.error; }
            return;
        }
        if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '✅ 預覽已更新，請確認內容無誤後再上傳'; }
        refreshAppGenArea(rowEl, appId);
    }

    /** 找不到既有 folderId 就用 GAS create_folder（getOrCreateSubFolder 天生 idempotent）現場建一個，順帶把新 folderId 補回本機 meta 快取供下一輪重用 */
    async function resolveOrCreateAppFolderId(rowEl) {
        const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
        const classSelectEl = rowEl.querySelector('.mlp-app-class');
        const classId = classSelectEl ? classSelectEl.value : '';
        const folderSelectEl = rowEl.querySelector('.mlp-app-folder');
        const folder = folderSelectEl.value === '__manual__' ? rowEl.querySelector('.mlp-app-folder-manual').value.trim() : folderSelectEl.value;
        if (!folder) throw new Error('請先選好「📁 歸屬檔案」的教材資料夾');

        let folderId = (window.FeatureExamJob && typeof window.FeatureExamJob.getFolderIdForFolder === 'function')
            ? window.FeatureExamJob.getFolderIdForFolder(classId, rootKind, folder)
            : '';
        if (folderId) return folderId;

        if (!window.FeatureTimeline || typeof window.FeatureTimeline.resolveMaterialsRootFolderId !== 'function') {
            throw new Error('FeatureTimeline 尚未載入，無法建立教材資料夾');
        }
        if (!window.GasService || typeof window.GasService.ensureMaterialFolder !== 'function') {
            throw new Error('GasService.ensureMaterialFolder 尚未載入');
        }
        const rootFolderId = await window.FeatureTimeline.resolveMaterialsRootFolderId(classId, rootKind);
        const materialsRootName = rootKind === 'teacher' ? '01_My_Materials' : '00_Class_Materials';
        const result = await window.GasService.ensureMaterialFolder(rootFolderId, materialsRootName, folder);
        return result.folderId;
    }

    async function handleConfirmUpload(rowEl, appId) {
        const state = ensureAppRowState(appId);
        // 💣 雷區：msgEl／uploadBtn 不能只在函式開頭查一次就整個 async 流程沿用同一個參考——
        // 迴圈裡每上傳完一個活頁就會呼叫 refreshAppGenArea() 重寫 .mlp-app-gen-area 的 innerHTML，
        // 舊的 DOM 節點會變成「已脫離文件」的孤兒，之後寫 .textContent 老師完全看不到（畫面像沒反應）。
        // 改成每次要用之前都重新從 rowEl 查一次，rowEl 本身不會被整個換掉，永遠查得到目前真正在畫面上的節點。
        const getMsgEl = function () { return rowEl.querySelector('.mlp-app-gen-msg'); };
        const getUploadBtn = function () { return rowEl.querySelector('.mlp-app-gen-upload'); };
        let sheetNames = checkedSheetNames(state);

        // 💣 雷區：老師若沒手動按過「🔍 產生預覽」、直接按「☁️ 確認上傳到 Drive」，這顆按鈕原本會
        // 因為 canConfirmUpload() 為 false 一路維持 disabled，點下去完全沒有任何反應也沒有任何訊息，
        // 看起來像「壞掉」（2026-08-09 使用者回報「沒有看預覽，直接儲存，則沒有作用」）。改成：
        // 沒有有效預覽時，自動先跑一次跟「產生預覽」按鈕一樣的算列邏輯，成功才繼續上傳，
        // 失敗（例如還沒選 Template／Template 缺 is_ai_ref）才提示錯誤擋下來。
        if (!canConfirmUpload(state, sheetNames)) {
            const genRes = generatePreviewForRow(rowEl, appId);
            sheetNames = checkedSheetNames(state);
            if (!genRes.ok || !canConfirmUpload(state, sheetNames)) {
                const msgEl0 = getMsgEl();
                if (msgEl0) {
                    msgEl0.style.color = '#DC2626';
                    msgEl0.textContent = '❌ ' + (genRes.ok ? '自動產生預覽後仍有活頁 0 列或有錯誤，請先手動按「🔍 產生預覽」檢查下方訊息' : genRes.error);
                }
                refreshAppGenArea(rowEl, appId);
                return;
            }
            refreshAppGenArea(rowEl, appId);
        }
        if (getUploadBtn()) { getUploadBtn().disabled = true; getUploadBtn().textContent = '⏳ 上傳中…'; }
        if (getMsgEl()) { getMsgEl().style.color = '#0F766E'; getMsgEl().textContent = '⏳ 正在確認教材資料夾…'; }
        try {
            const folderId = await resolveOrCreateAppFolderId(rowEl);
            for (let i = 0; i < sheetNames.length; i++) {
                const name = sheetNames[i];
                const g = state.gen[name];
                if (getMsgEl()) getMsgEl().textContent = '⏳ 上傳中（' + (i + 1) + '/' + sheetNames.length + '）：' + name + '…';
                try {
                    // 💣 雷區：檔名輸入框只在 change（失焦）時才把值寫回 state.gen[name].outputMeta／
                    // outputScript。老師若接受畫面自動帶出的預設檔名、完全沒點過那個輸入框，change
                    // 永遠不會觸發，g.outputMeta/outputScript 就一路是 undefined——傳給 GAS 的
                    // fileName 是 undefined，Code.gs 對 undefined 呼叫 .replace() 就會炸
                    // 「Cannot read properties of undefined (reading 'replace')」（2026-08-09 回報）。
                    // 上傳前一律用「畫面上實際顯示的檔名」三層 fallback：DOM 現值 → state 快取 → 預設檔名，
                    // 絕不把 undefined 傳給 GAS；同時寫回 state，避免下次重繪又跑掉。
                    let sheetRowEl = null;
                    rowEl.querySelectorAll('.mlp-app-gen-sheet').forEach(function (el) {
                        if (el.getAttribute('data-sheet') === name) sheetRowEl = el;
                    });
                    const metaNameInput = sheetRowEl ? sheetRowEl.querySelector('.mlp-app-gen-metaname') : null;
                    const scriptNameInput = sheetRowEl ? sheetRowEl.querySelector('.mlp-app-gen-scriptname') : null;
                    const defaults = defaultOutputNames(name);
                    const finalMetaName = (metaNameInput && metaNameInput.value.trim()) || g.outputMeta || defaults.meta;
                    const finalScriptName = (scriptNameInput && scriptNameInput.value.trim()) || g.outputScript || defaults.script;
                    g.outputMeta = finalMetaName;
                    g.outputScript = finalScriptName;

                    const metaJson = JSON.stringify(g.rows, null, 2);
                    const scriptTxt = g.scriptLines.join('\n') + (g.scriptLines.length ? '\n' : '');
                    const metaRes = await window.GasService.uploadMaterialFile(utf8ToBase64(metaJson), finalMetaName, 'application/json', folderId);
                    const scriptRes = await window.GasService.uploadMaterialFile(utf8ToBase64(scriptTxt), finalScriptName, 'text/plain', folderId);
                    g.uploadStatus = { ok: true, text: '✅ 已上傳：' + (metaRes.finalFileName || finalMetaName) + '、' + (scriptRes.finalFileName || finalScriptName) };
                } catch (sheetErr) {
                    g.uploadStatus = { ok: false, text: '❌ 上傳失敗：' + (sheetErr.message || sheetErr) };
                }
                refreshAppGenArea(rowEl, appId);
            }
            // 上傳完成後，這個資料夾底下的 .meta.json 清單多了新檔案，逼 FeatureTimeline 的快取
            // 下次重新讀 Drive，其他下拉（獨立考試教材／活頁選單等）才看得到剛產生的新檔案
            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
                const classSelectEl = rowEl.querySelector('.mlp-app-class');
                const classId = classSelectEl ? classSelectEl.value : '';
                window.FeatureTimeline.ensureMetaCatalog(classId, rootKind, { force: true }).catch(function () {});
            }
            // 💣 雷區：這裡曾寫「請看下方」，但每個活頁的上傳結果（uploadHtml）其實 render 在
            // rowsHtml 裡，畫面位置在這顆按鈕列的「上方」，不是下方——方向寫反會讓老師往下找
            // 卻什麼都沒有（2026-08-09 使用者回報「什麼？？沒看到啊」）。
            if (getMsgEl()) { getMsgEl().style.color = '#059669'; getMsgEl().textContent = '✅ 全部處理完畢，請看上方各活頁卡片內的上傳結果'; }
        } catch (err) {
            if (getMsgEl()) { getMsgEl().style.color = '#DC2626'; getMsgEl().textContent = '❌ ' + (err.message || err); }
        } finally {
            const finalBtn = getUploadBtn();
            if (finalBtn) { finalBtn.disabled = !canConfirmUpload(state, sheetNames); finalBtn.textContent = '☁️ 確認上傳到 Drive'; }
        }
    }

    function renderAppRow(app) {
        const rootKind = app.root_kind === 'class' ? 'class' : 'teacher';
        const classFolders = rootKind === 'class' && app.class_id ? uniqueFolderNames(app.class_id, 'class') : [];
        const teacherFolders = rootKind === 'teacher' ? uniqueFolderNames('', 'teacher') : [];
        const folderOptions = rootKind === 'class' ? classFolders : teacherFolders;
        const folderSelectDisabled = rootKind === 'class' && !app.class_id;
        const templateOptions = getFieldTemplatesCachedSync().map(function (t) { return t.name; }).filter(Boolean);
        ensureAppRowState(app.id, app);

        return `
            <div class="mlp-app-row" data-id="${esc(app.id)}" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569; flex:1; min-width:200px;">Layout Template
                        <select class="form-control mlp-app-template" style="width:100%; padding:6px; margin-top:2px;">${buildSelectOptionsHtml(templateOptions, app.template_name, '— 選 Template —')}</select>
                    </label>
                    <button type="button" class="btn mlp-app-remove" style="padding:6px 10px; color:#B91C1C; border:1px solid #FCA5A5; border-radius:6px; background:white; white-space:nowrap;">刪除</button>
                </div>

                <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:10px; margin-bottom:10px;">
                    <div style="font-size:0.76rem; font-weight:800; color:#1D4ED8; margin-bottom:6px;">📁 歸屬檔案（一定是 Google Drive，套用紀錄實際指向哪裡）</div>
                    <div style="display:grid; grid-template-columns:100px 1fr 1fr; gap:8px; align-items:end;">
                        <label style="font-size:0.78rem; font-weight:800; color:#475569;">歸屬
                            <select class="form-control mlp-app-rootkind" style="width:100%; padding:6px; margin-top:2px;">
                                <option value="teacher" ${rootKind === 'class' ? '' : 'selected'}>👤 老師個人</option>
                                <option value="class" ${rootKind === 'class' ? 'selected' : ''}>🏫 班級</option>
                            </select>
                        </label>
                        <label class="mlp-app-class-wrap" style="font-size:0.78rem; font-weight:800; color:#475569; ${rootKind === 'class' ? '' : 'display:none;'}">班級
                            <select class="form-control mlp-app-class" style="width:100%; padding:6px; margin-top:2px;">${classOptionsHtml(app.class_id)}</select>
                        </label>
                        <label style="font-size:0.78rem; font-weight:800; color:#475569;">教材資料夾
                            <select class="form-control mlp-app-folder" style="width:100%; padding:6px; margin-top:2px;" ${folderSelectDisabled ? 'disabled' : ''}>${buildSelectOptionsHtml(folderOptions, app.material_folder, folderSelectDisabled ? '請先選班級' : '— 選教材資料夾 —')}</select>
                            <input type="text" class="form-control mlp-app-folder-manual" value="${esc(app.material_folder || '')}" placeholder="手動輸入資料夾名稱" style="width:100%; padding:6px; margin-top:2px; display:none;">
                        </label>
                    </div>
                    <div class="mlp-app-folder-status" style="font-size:0.75rem; color:#94A3B8; min-height:1em; margin-top:4px;"></div>
                    <div class="mlp-app-sheet-hint" style="font-size:0.75rem; color:#94A3B8; min-height:1em;">${sheetHintText(app.class_id || '', rootKind, app.material_folder)}</div>
                </div>

                <div style="background:white; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:10px;">
                    <div style="font-size:0.76rem; font-weight:800; color:#334155; margin-bottom:6px;">📄 活頁來源（本機 Excel 或上面的 Google Drive 資料夾都可以，活頁可複選）</div>
                    <div class="mlp-app-sheets-area">${renderAppSheetsAreaHtml(app.id, rootKind, app.class_id || '', app.material_folder || '')}</div>
                </div>

                <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
                    <label style="font-size:0.78rem; font-weight:700; color:#334155;">行數起
                        <input type="text" class="form-control mlp-app-rowstart" value="${esc(app.row_start || '')}" style="width:110px; padding:6px; margin-top:2px;">
                    </label>
                    <label style="font-size:0.78rem; font-weight:700; color:#334155;">行數末
                        <input type="text" class="form-control mlp-app-rowend" value="${esc(app.row_end || '')}" placeholder="例如 LAST(AB)" style="width:150px; padding:6px; margin-top:2px;">
                    </label>
                </div>

                <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:10px;">
                    <div style="font-size:0.76rem; font-weight:800; color:#15803D; margin-bottom:4px;">🚀 產生 meta / script 並上傳到 Drive</div>
                    <div style="font-size:0.72rem; color:#4D7C0F; margin-bottom:6px;">直接讀本機 Excel 勾選的活頁，依上面的 Layout Template（欄位對應＋角色）＋行數起迄算出 meta.json／script.txt，確認無誤後上傳到「📁 歸屬檔案」的教材資料夾——取代舊的終端機 publish_local。</div>
                    <div class="mlp-app-gen-area">${renderAppGenAreaHtml(app.id)}</div>
                </div>
            </div>
        `;
    }

    /**
     * 換歸屬／班級＝可選教材資料夾清單整個換了。載入／空清單／失敗重試這套流程已抽到共用模組
     * window.MaterialFolderPicker（跟 refreshFolderSelect／refreshExcelFolderSelect 共用同一份實作），
     * 這裡只負責套用列的畫面形狀（歸屬/教材資料夾下拉 + 換好之後要接著重刷活頁來源子區塊）。
     */
    function refreshAppFolderSelect(rowEl, forceRetry) {
        const appId = rowEl.getAttribute('data-id');
        const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
        const classSelectEl = rowEl.querySelector('.mlp-app-class');
        const classId = classSelectEl ? classSelectEl.value : '';
        const folderSelectEl = rowEl.querySelector('.mlp-app-folder');
        const statusEl = rowEl.querySelector('.mlp-app-folder-status');
        if (rootKind === 'class' && !classId) {
            folderSelectEl.disabled = true;
            folderSelectEl.innerHTML = buildSelectOptionsHtml([], '', '請先選班級');
            if (statusEl) statusEl.innerHTML = '';
            refreshAppSheetsArea(rowEl, appId);
            refreshAppSheetHint(rowEl);
            return;
        }
        folderSelectEl.disabled = false;
        if (!window.MaterialFolderPicker) return;
        const catalogClassId = rootKind === 'class' ? classId : '';
        window.MaterialFolderPicker.refreshDropdown({
            classId: catalogClassId,
            rootKind: rootKind,
            force: !!forceRetry,
            getSelectEl: function () { return rowEl.querySelector('.mlp-app-folder'); },
            getStatusEl: function () { return rowEl.querySelector('.mlp-app-folder-status'); },
            listCurrentOptions: function () { return uniqueFolderNames(catalogClassId, rootKind); },
            renderOptionsHtml: function (list, currentValue) { return buildSelectOptionsHtml(list, currentValue, '— 選教材資料夾 —'); },
            onAfterUpdate: function () { refreshAppSheetsArea(rowEl, appId); refreshAppSheetHint(rowEl); }
        });
    }

    function bindAppRowEvents(rowEl) {
        const appId = rowEl.getAttribute('data-id');
        rowEl.querySelector('.mlp-app-remove').addEventListener('click', function () {
            delete _appRowState[appId];
            rowEl.remove();
        });

        rowEl.querySelector('.mlp-app-rootkind').addEventListener('change', function () {
            const isClass = this.value === 'class';
            rowEl.querySelector('.mlp-app-class-wrap').style.display = isClass ? '' : 'none';
            refreshAppFolderSelect(rowEl);
        });

        const classSelectEl = rowEl.querySelector('.mlp-app-class');
        if (classSelectEl) classSelectEl.addEventListener('change', function () { refreshAppFolderSelect(rowEl); });

        rowEl.querySelector('.mlp-app-folder').addEventListener('change', function () {
            rowEl.querySelector('.mlp-app-folder-manual').style.display = this.value === '__manual__' ? 'block' : 'none';
            refreshAppSheetsArea(rowEl, appId);
            refreshAppSheetHint(rowEl);
        });
        rowEl.querySelector('.mlp-app-folder-manual').addEventListener('change', function () {
            refreshAppSheetsArea(rowEl, appId);
            refreshAppSheetHint(rowEl);
        });

        bindAppSheetsAreaEvents(rowEl, appId);
        bindAppGenAreaEvents(rowEl, appId);
    }

    /** 至少要勾一個活頁才存──套用的意義就是「這個 Template＋這段行數要用在哪些活頁」，一個都沒勾等於沒套用到任何東西 */
    function collectAppsFromDom(container) {
        return Array.from(container.querySelectorAll('.mlp-app-row')).map(function (rowEl) {
            const appId = rowEl.getAttribute('data-id');
            const state = ensureAppRowState(appId);
            const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
            const classId = rootKind === 'class' ? (rowEl.querySelector('.mlp-app-class') || {}).value || '' : '';
            const folderSelectEl = rowEl.querySelector('.mlp-app-folder');
            const folder = (folderSelectEl.value === '__manual__'
                ? rowEl.querySelector('.mlp-app-folder-manual').value
                : folderSelectEl.value).trim();
            const templateSelectEl = rowEl.querySelector('.mlp-app-template');
            const templateName = (templateSelectEl && templateSelectEl.value !== '__manual__' ? templateSelectEl.value : '').trim();
            const template = getFieldTemplatesCachedSync().find(function (t) { return t.name === templateName; });
            const rowStart = rowEl.querySelector('.mlp-app-rowstart').value.trim();
            const rowEnd = rowEl.querySelector('.mlp-app-rowend').value.trim();
            const sheetIds = Object.keys(state.checkedSheets).filter(function (k) { return state.checkedSheets[k]; }).sort();
            return {
                id: appId,
                template_id: template ? template.id : '',
                template_name: templateName,
                root_kind: rootKind,
                class_id: classId,
                material_folder: folder,
                sheet_ids: sheetIds,
                source_kind: state.sourceKind,
                source_file_name: state.sourceKind === 'local' ? (state.localFileName || '') : '',
                row_start: rowStart,
                row_end: rowEnd
            };
        }).filter(function (a) { return a.template_name && a.material_folder && a.sheet_ids.length; });
    }

    /**
     * 效能雷區（2026-08-05）：教材 meta catalog 是 GAS Web App 呼叫（列出 Drive 資料夾），本來就慢。
     * 舊版在這裡 await 完才 paint()，等於整頁卡住等 GAS。改成「先畫、背景補」：
     * paint() 先用目前已知的（可能是空的）catalog 畫出整頁，每一列教材資料夾下拉各自背景載入
     * （沿用既有 refreshFolderSelect 的「⏳ 載入中 → 補清單 → 失敗顯示 ⚠️」模式），不擋整頁出現。
     */
    /** 這一列的歸屬（root_kind/class_id）是否符合某個 meta catalog key，用來決定 catalog 刷新完後要不要重畫這一列 */
    function rowMatchesCatalogKey(rowEl, rootKindSelector, classSelector, info) {
        const rootKindEl = rowEl.querySelector(rootKindSelector);
        const rk = rootKindEl && rootKindEl.value === 'class' ? 'class' : 'teacher';
        if (rk !== info.rootKind) return false;
        if (rk === 'teacher') return true;
        const classEl = rowEl.querySelector(classSelector);
        return !!classEl && classEl.value === info.classId;
    }

    /**
     * 2026-08-06（老師實測回報「讀取的資料不對，應該自動重新讀取最新的資料」）：
     * FeatureTimeline._metaCatalog 只要曾經成功載入過一次就永遠當作有效，不會自己過期——
     * 老師在 Drive 新增/改名教材資料夾後，只要這頁用到的 catalog 快取還「ok」（可能是幾分鐘前
     * 逛別的分頁時就順便載入過），教材資料夾下拉就會一直顯示舊清單，過去只能靠手動按重試按鈕。
     * 這裡改成「每次進這頁，背景自動強制重抓一次」：畫面先用目前已有的快取照常出現（不擋 paint），
     * 抓到最新清單後才悄悄更新各個下拉選單，不用老師自己按重試。
     *
     * 雷區：不可以每一列各自呼叫一次 force:true——ensureMetaCatalog 內部用同一個 key 對應一份
     * promise cache，多個呼叫在同一個 tick 裡都帶 force 會互相刪掉對方剛存的 promise，變成
     * 對同一個 key 重複打好幾次 GAS。必須先把用到的 {classId, rootKind} 去重，一個 key 只 force 一次。
     */
    function refreshMetaCatalogsInBackground(container, pairs, apps) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.ensureMetaCatalog !== 'function') return;
        const keys = { 'teacher::': { classId: '', rootKind: 'teacher' } };
        (pairs || []).concat(apps || []).forEach(function (r) {
            if (r && r.root_kind === 'class' && r.class_id) {
                keys['class::' + r.class_id] = { classId: r.class_id, rootKind: 'class' };
            }
        });
        Object.keys(keys).forEach(function (key) {
            const info = keys[key];
            window.FeatureTimeline.ensureMetaCatalog(info.classId, info.rootKind, { force: true }).then(function () {
                if (!document.body.contains(container)) return;
                container.querySelectorAll('.mlp-row').forEach(function (rowEl) {
                    if (rowMatchesCatalogKey(rowEl, '.mlp-rootkind', '.mlp-class', info)) refreshFolderSelect(rowEl);
                });
                container.querySelectorAll('.mlp-app-row').forEach(function (rowEl) {
                    if (rowMatchesCatalogKey(rowEl, '.mlp-app-rootkind', '.mlp-app-class', info)) refreshAppFolderSelect(rowEl);
                });
                if (info.rootKind === 'teacher') refreshExcelFolderSelect();
            }).catch(function () {
                // 背景刷新失敗不額外報錯——各列既有的「⚠️ 清單載入失敗＋重試」流程會處理，這裡靜默即可
            });
        });
    }

    async function render() {
        const container = document.getElementById('material-layout-pairing-container');
        if (!container) return;
        container.innerHTML = '<div style="padding:30px; text-align:center; color:var(--primary); font-weight:800;">⏳ 載入搭配清單…</div>';
        // 每次重新進這頁都要用剛讀到的持久化資料重畫套用列的暫存 UI 狀態（活頁勾選／來源模式），
        // 不能沿用上一次瀏覽時殘留在記憶體裡、可能還沒存檔的舊狀態
        _appRowState = {};
        let pairs, apps;
        try {
            pairs = await fetchPairs(true);
            apps = await fetchTemplateApplications(true);
        } catch (err) {
            container.innerHTML = '<div style="padding:20px; color:#EF4444; font-weight:800;">❌ 載入失敗：' + esc(err.message || err) + '</div>';
            return;
        }
        const layoutCatalog = getLayoutCatalog();
        paint(container, pairs, apps, layoutCatalog);
        refreshMetaCatalogsInBackground(container, pairs, apps);
        // Template 清單獨立於這一次 render，存好之後才知道要不要重畫，用背景載入＋事後補畫（跟其他
        // 進度式載入同一套模式），不會擋整頁出現
        fetchFieldTemplates(true).then(function () { renderTemplateList(); refreshAppTemplateSelectOptions(); }).catch(function () {});
    }

    function paint(container, pairs, apps, layoutCatalog) {
        container.innerHTML = `
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                    <h3 style="margin:0; color:var(--primary-dark);">🧩 Layout Template（欄位對應範本，可重複套用）</h3>
                    <button type="button" id="mlp-tpl-add-new" class="btn btn-action" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE;">＋ 新增 Template</button>
                </div>
                <p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">
                    Template 是獨立於任何檔案的「規則」：名稱＋一組欄位設定（欄位代號、資料項名稱、題目／答案／訊息）。
                    設計好之後可以重複套用到「欄位結構相同」的任何教材檔案——實際套用時的行數起迄記在下面「📎 套用到教材」區塊，不記在這裡。
                </p>
                <div id="mlp-template-editor"></div>
                <div id="mlp-template-list"></div>
            </div>
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <h3 style="margin:0 0 6px 0; color:var(--primary-dark);">🧾 從本機 Excel 讀取活頁／欄位（設計 Template 小工具）</h3>
                <p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">
                    選擇本機 Excel 檔案（不會上傳，只在瀏覽器裡讀取）輔助設計上面的 Layout Template：
                    勾選要參考的活頁（可多選，欄位結構一樣的活頁可以一次勾好幾個）→ 勾選需要用到的欄位 → 確定選取 →
                    設定每欄的資料項名稱／題目／答案／訊息 → 取個名字分別儲存。存好後會出現在上面「Layout Template」清單，
                    之後不需要這個檔案也能繼續編輯／刪除。同一活頁若需要不同排版，按「＋新增一組」再建一份獨立 Template。
                </p>
                <div style="display:flex; gap:16px; align-items:stretch; flex-wrap:wrap;">
                    <div style="flex:1; min-width:240px; display:flex; flex-direction:column; background:#FAFAFA; border:2px solid #E2E8F0; border-radius:10px; padding:14px; box-sizing:border-box; justify-content:center;">
                        <label style="font-size:0.78rem; font-weight:800; color:#475569; display:block;">📄 本機來源檔案
                            <input type="file" id="mlp-excel-file" accept=".xlsx,.xls" class="form-control" style="width:100%; padding:6px; margin-top:2px;">
                        </label>
                        <div id="mlp-excel-status" style="font-size:0.78rem; color:#EF4444; min-height:1.2em; margin-top:2px;"></div>
                    </div>
                    <div id="mlp-excel-folderfile" style="flex:1; min-width:240px; display:flex; flex-direction:column;"></div>
                </div>
                <div id="mlp-excel-block" style="margin-top:10px;"></div>
            </div>
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h3 style="margin:0; color:var(--primary-dark);">📎 套用到教材（Layout Template ↔ 實際檔案）</h3>
                    <div style="display:flex; gap:8px;">
                        <button type="button" id="mlp-app-add-row" class="btn btn-action" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE;">＋ 新增套用</button>
                        <button type="button" id="mlp-app-save" class="btn btn-primary" style="padding:8px 18px; font-weight:800;">💾 儲存</button>
                    </div>
                </div>
                <p style="color:#64748B; font-size:0.85rem; margin-top:0;">
                    每一列＝一次套用，分三塊填：📁「歸屬檔案」一定是 Google Drive（實際指向哪個教材資料夾，考試／批改系統只認這裡）；
                    📄「活頁來源」用來挑出這次要套用的活頁，可以直接勾歸屬資料夾裡偵測到的活頁，也可以改選一個本機 Excel 檔案掃描活頁名稱，活頁一律可複選；
                    最後選 Layout Template＋填行數起迄（不同檔案資料筆數不同，起迄列可能不一樣，同一份 Template 可以套用到多筆）。
                </p>
                <div id="mlp-app-rows">${apps.map(function (a) { return renderAppRow(a); }).join('') || '<div class="mlp-app-empty-hint" style="color:#94A3B8; padding:12px;">尚未登記任何套用，按「＋ 新增套用」開始。</div>'}</div>
                <div id="mlp-app-save-msg" style="margin-top:8px; font-weight:800;"></div>
            </div>
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h3 style="margin:0; color:var(--primary-dark);">🧩 教材／考試 Layout 搭配</h3>
                    <div style="display:flex; gap:8px;">
                        <button type="button" id="mlp-add-row" class="btn btn-action" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE;">＋ 新增搭配</button>
                        <button type="button" id="mlp-save" class="btn btn-primary" style="padding:8px 18px; font-weight:800;">💾 儲存</button>
                    </div>
                </div>
                <p style="color:#64748B; font-size:0.85rem; margin-top:0;">
                    這裡登記的是「建議」：出題畫面選好教材資料夾／活頁後，符合的 layout 會標「⭐建議」排到最前面，但仍可自由改選其他 layout。
                    同一活頁若真的需要兩種不同排版（例如整句翻譯＋句子填空都要），請建立兩個考試任務分別套用，不是在這裡塞兩個 layout 到同一份考卷。
                </p>
                <div id="mlp-rows">${pairs.map(function (p) { return renderRow(p, layoutCatalog); }).join('') || '<div class="mlp-empty-hint" style="color:#94A3B8; padding:12px;">尚未登記任何搭配，按「＋ 新增搭配」開始。</div>'}</div>
                <div id="mlp-save-msg" style="margin-top:8px; font-weight:800;"></div>
            </div>
        `;

        renderTemplateList();
        document.getElementById('mlp-tpl-add-new').addEventListener('click', openTemplateEditorForNew);

        const excelFileEl = document.getElementById('mlp-excel-file');
        if (excelFileEl) excelFileEl.addEventListener('change', function () { handleExcelFileChange(this); });

        const rowsEl = container.querySelector('#mlp-rows');
        rowsEl.querySelectorAll('.mlp-row').forEach(function (rowEl) {
            bindRowEvents(rowEl);
            // 頁面已經先畫出來了；這裡才背景補教材資料夾清單（GAS 慢也不擋整頁出現）
            refreshFolderSelect(rowEl);
        });

        document.getElementById('mlp-add-row').onclick = function () {
            const empty = rowsEl.querySelector('.mlp-empty-hint');
            if (empty) empty.remove();
            const div = document.createElement('div');
            div.innerHTML = renderRow({ id: 'mlp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), material_folder: '', root_kind: 'teacher', class_id: '', sheet_id: '', layout_profile_ids: [] }, layoutCatalog);
            const newRow = div.firstElementChild;
            rowsEl.appendChild(newRow);
            bindRowEvents(newRow);
        };

        document.getElementById('mlp-save').onclick = async function () {
            const btn = this;
            const msgEl = document.getElementById('mlp-save-msg');
            const collected = collectPairsFromDom(rowsEl);
            btn.disabled = true;
            const original = btn.innerHTML;
            btn.innerHTML = '⏳ 儲存中…';
            try {
                await savePairs(collected);
                msgEl.style.color = '#059669';
                msgEl.textContent = '✅ 已儲存 ' + collected.length + ' 筆搭配';
                window.showFlash && window.showFlash('已儲存教材/Layout 搭配');
            } catch (err) {
                msgEl.style.color = '#EF4444';
                msgEl.textContent = '❌ 儲存失敗：' + (err.message || err);
            } finally {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        };

        const appRowsEl = container.querySelector('#mlp-app-rows');
        appRowsEl.querySelectorAll('.mlp-app-row').forEach(function (rowEl) {
            bindAppRowEvents(rowEl);
            refreshAppFolderSelect(rowEl);
        });

        document.getElementById('mlp-app-add-row').onclick = function () {
            const empty = appRowsEl.querySelector('.mlp-app-empty-hint');
            if (empty) empty.remove();
            const div = document.createElement('div');
            div.innerHTML = renderAppRow({ id: 'mta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), template_name: '', root_kind: 'teacher', class_id: '', material_folder: '', sheet_ids: [], row_start: '', row_end: '' });
            const newRow = div.firstElementChild;
            appRowsEl.appendChild(newRow);
            bindAppRowEvents(newRow);
            refreshAppFolderSelect(newRow);
        };

        document.getElementById('mlp-app-save').onclick = async function () {
            const btn = this;
            const msgEl = document.getElementById('mlp-app-save-msg');
            const collected = collectAppsFromDom(appRowsEl);
            btn.disabled = true;
            const original = btn.innerHTML;
            btn.innerHTML = '⏳ 儲存中…';
            try {
                await saveTemplateApplications(collected);
                msgEl.style.color = '#059669';
                msgEl.textContent = '✅ 已儲存 ' + collected.length + ' 筆套用紀錄';
                window.showFlash && window.showFlash('已儲存 Layout Template 套用紀錄');
            } catch (err) {
                msgEl.style.color = '#EF4444';
                msgEl.textContent = '❌ 儲存失敗：' + (err.message || err);
            } finally {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        };
    }

    /** Template 清單背景補齊後，套用區塊每一列的 Template 下拉也要跟著補上新選項（不用整段重畫） */
    function refreshAppTemplateSelectOptions() {
        const templateOptions = getFieldTemplatesCachedSync().map(function (t) { return t.name; }).filter(Boolean);
        document.querySelectorAll('.mlp-app-template').forEach(function (sel) {
            const cur = sel.value === '__manual__' ? '' : sel.value;
            sel.innerHTML = buildSelectOptionsHtml(templateOptions, cur, '— 選 Template —');
        });
    }

    return {
        render: render,
        getSuggestedLayoutIds: getSuggestedLayoutIds,
        getCachedSync: getCachedSync
    };
})();

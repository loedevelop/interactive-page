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
    /** 雲端來源時，若老師選的是「資料夾底下的某一個檔案」才有值（原始檔名，例如 A.meta.json） */
    let _excelDriveFileName = '';
    /** local＝本機 Excel（圖一：選檔＋目的資料夾）；drive＝雲端教材資料夾／檔案下拉 */
    let _excelSourceMode = 'local';
    /** @type {Array<object>} */
    let _excelSegments = [];
    /** @type {Object<string, Array<object>>} 活頁名稱 → 已解析出的欄位清單（避免重複解析） */
    let _excelSheetColumnsCache = {};
    /** @type {Object<string, Array<Array<*>>>} 活頁名稱 → 逐列矩陣（供「設計 Template」卡片內的即時 meta 預覽用，跟套用到教材各自 appId 的快取分開） */
    let _excelSegPreviewMatrixCache = {};
    let _metaPublishBusy = false;

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
    /** folder|templateId → { classIds, classNames }，給套用區塊即時顯示「哪些班已在用」 */
    let _comboUsageCache = {};

    function newExcelSegment() {
        return {
            id: 'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            /** 這組（＝一份 Template）自己的活頁選擇，不同組可以套用到不同活頁（見 2026-08-05 第七輪修正） */
            checkedSheets: {},
            name: '',
            checks: {},
            gridCollapsed: false,
            confirmed: false,
            /**
             * 2026-08-12（老師明確要求：「產生 meta/script 時，可以直接套用現有的擷取範本，
             * 不用再勾選欄位等；若需要產生新的擷取範本才需要目前這套方法」）：
             * quickApplyTemplateName＝上面「⚡ 已有現成擷取範本」快速套用要用的 Template 名稱，
             * 跟下面「設計新擷取範本」要儲存用的 name 完全獨立，兩邊互不干擾。
             * designExpanded＝「🆕 設計新擷取範本」收合區塊目前是否手動展開（見 renderDesignToggleHtml：
             * 已有現成 Template 時預設收起，一份 Template 都沒有時強制展開，不受這個值影響）。
             */
            /**
             * 2026-08-15（老師要求兩段 radio）：apply＝套用目前範本（圖一）；design＝展開設計新擷取範本（圖二）。
             * 沒有任何範本時預設 design，否則預設 apply。
             */
            workflowMode: '',
            /** extraction＝只當擷取範本；both＝擷取範本與試卷範本。雲端來源固定試卷。 */
            quickApplyRole: isDriveSource() ? 'both' : 'extraction',
            /** 這次套用要指派的班級 id → true */
            quickApplyClassIds: {},
            quickApplyTemplateName: '',
            quickApplyTemplateId: '',
            /** 2026-08-13（老師回報「要產生 meta/script，必須輸入行數起始跟結尾吧」）：快速套用
             * 也要能直接輸入行數起迄，不能讓老師先按「套用產生」、再跑到下面「套用到教材」區塊補填。 */
            quickApplyRowStart: '2',
            quickApplyRowEnd: '',
            /**
             * 2026-08-13（老師回報「流程分割不清楚、一直重複」）：快速套用產生的結果不再另外
             * 塞進下面「📎 套用到教材」的 #mlp-app-rows，改成直接掛在這張 Excel 卡片內部
             * （見 renderSegmentCardHtml 的 .mlp-excel-quickapply-results）。存在 seg 上而不是
             * 只存在 DOM 裡，是因為 renderExcelSegments() 在很多地方會整段重新 innerHTML
             * （例如確定選取欄位／取消確定／刪除某一組），若不記在 seg 上，重繪之後這些已經
             * 產生好的結果會憑空消失。每筆是完整的 app record（跟 material_template_applications
             * 存檔格式一致），移除時同步從這個陣列 splice 掉（見 bindQuickApplyResultEvents）。
             */
            quickApplyResults: [],
            designExpanded: false,
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
             *擷取範本是「規則」（欄位代號→資料項名稱＋題目/答案/訊息），跟任何一個
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
            speakMode: 'direct',
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

    /**
     * 口說批改標準（2026-08-15 老師要求第一個選項要是最基本的「比對口說答案」）：
     * direct＝直接取已勾的口說答案欄（1 欄用原值、多欄空白串接）；formula／complex／paste 維持舊行為。
     * 未知值退回 direct（新範本預設），舊資料若已存 formula／complex／paste 仍照原值。
     */
    const SPEAK_MODES = ['direct', 'formula', 'complex', 'paste'];
    function normalizeSpeakMode(v) {
        return SPEAK_MODES.indexOf(v) !== -1 ? v : 'direct';
    }

    /** 書寫答案欄數（is_answer=true 的欄位數），決定要不要顯示「答案／口說答案批改標準」設定區塊 */
    function countAnswerColsFromRole(colRole) {
        return Object.keys(colRole || {}).filter(function (k) { return colRole[k] && colRole[k].answer; }).length;
    }

    function countAnswerColsFromColumns(columns) {
        return (Array.isArray(columns) ? columns : []).filter(function (c) { return c && c.is_answer; }).length;
    }

    function countSpeakColsFromColumns(columns) {
        return (Array.isArray(columns) ? columns : []).filter(function (c) { return c && c.is_ai_ref; }).length;
    }

    function templateExamGradingOpts(st) {
        return {
            gateByExamRole: true,
            examRoleOn: !!(st && st.isExamRole),
            speakColsOn: countSpeakColsFromColumns(st && st.columns) > 0
        };
    }

    /**
     * 「答案批改標準」＋「口說答案批改標準」共用設定區塊。cfg 需要有 answerMode／answerCombineNote／
     * speakMode／speakFormula 四個欄位（Excel 小工具的 seg 或 Template 編輯器的 _templateEditorState
     * 都符合）。
     * 2026-08-14（老師回報：每個範本都要有、老師都要能修改）：這個區塊本身不再整塊被書寫答案欄數
     * 擋掉——🎤口說答案批改標準跟書寫答案欄數無關（它看的是 is_ai_ref 欄，不是 is_answer 欄），舊版
     * 「欄數≤1 整塊不顯示」等於讓這種範本完全無法設定口說批改模式，是設計缺陷，不是刻意的規則。
     * 只有📝書寫答案批改標準（分開比對／結合成一個答案）在欄數≤1 時沒有意義（沒有「多欄」可選），
     * 才單獨收起來。
     */
    function renderAnswerGradingSettingsHtml(prefix, cfg, aCount, opts) {
        const gateByExamRole = !!(opts && opts.gateByExamRole);
        const examRoleOn = !!(opts && opts.examRoleOn);
        const gradingLocked = gateByExamRole && !examRoleOn;
        const speakLocked = gradingLocked || (gateByExamRole && !(opts && opts.speakColsOn));
        const lockAttr = gradingLocked ? ' disabled' : '';
        const speakLockAttr = speakLocked ? ' disabled' : '';
        const answerMode = cfg.answerMode === 'separate' ? 'separate' : 'combine';
        const speakMode = normalizeSpeakMode(cfg.speakMode);
        const writtenGradingBlock = aCount > 1 ? `
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.74rem; font-weight:800; color:#475569; margin-bottom:4px;">書寫 批改標準（共 ${aCount} 欄）</div>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:pointer; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-answer-mode-${esc(cfg.id || '')}" class="${prefix}-answer-mode-opt" value="separate" ${answerMode === 'separate' ? 'checked' : ''}${lockAttr}>
                        分開比對（每欄各自獨立比對，例如 AN、AO 各一個空格分開判定）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:${gradingLocked ? 'not-allowed' : 'pointer'};">
                        <input type="radio" name="${prefix}-answer-mode-${esc(cfg.id || '')}" class="${prefix}-answer-mode-opt" value="combine" ${answerMode === 'combine' ? 'checked' : ''}${lockAttr}>
                        結合成一個答案（用公式組合多欄，例如 AN&amp;" "&amp;AO）
                    </label>
                    <input type="text" class="form-control ${prefix}-answer-combine-note" value="${esc(cfg.answerCombineNote || '')}" placeholder='結合公式，照欄位代號寫，例如 AO&amp;" "&amp;AP' style="width:100%; padding:6px; margin-top:4px; font-size:0.78rem; display:${answerMode === 'combine' ? 'block' : 'none'};"${lockAttr}>
                </div>` : `
                <div style="margin-bottom:10px; font-size:0.76rem; color:#94A3B8;">書寫 批改標準：書寫答案欄數≤1，沒有「多欄合併／分開比對」的選擇。</div>`;
        const speakHint = gradingLocked
            ? '（未勾試卷範本，不使用）'
            : (speakLocked ? '（要勾選🎤口說答案才可設定）' : '');
        return `
            <div style="background:${gradingLocked ? '#F1F5F9' : '#FFF7ED'}; border:1px solid ${gradingLocked ? '#CBD5E1' : '#FED7AA'}; border-radius:8px; padding:10px 12px; margin-top:10px; opacity:${gradingLocked ? '0.55' : '1'};">
                <div style="font-size:0.76rem; font-weight:800; color:${gradingLocked ? '#94A3B8' : '#B45309'}; margin-bottom:8px;">批改標準${gradingLocked ? '（未勾試卷範本，不使用）' : ''}</div>
                <div style="pointer-events:${gradingLocked ? 'none' : 'auto'};">
                ${writtenGradingBlock}
                </div>
                <div style="opacity:${speakLocked ? '0.55' : '1'}; pointer-events:${speakLocked ? 'none' : 'auto'};">
                    <div style="font-size:0.74rem; font-weight:800; color:${speakLocked ? '#94A3B8' : '#475569'}; margin-bottom:4px;">口說 批改標準${speakHint}</div>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:${speakLocked ? 'not-allowed' : 'pointer'}; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="direct" ${speakMode === 'direct' ? 'checked' : ''}${speakLockAttr}>
                        比對口說答案（直接取已勾的口說答案欄）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:${speakLocked ? 'not-allowed' : 'pointer'}; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="formula" ${speakMode === 'formula' ? 'checked' : ''}${speakLockAttr}>
                        帶入公式（可再逐列個別修正）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:${speakLocked ? 'not-allowed' : 'pointer'}; margin-bottom:3px;">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="complex" ${speakMode === 'complex' ? 'checked' : ''}${speakLockAttr}>
                        之後會寫複雜規則（規則還沒定，先整批留白讓老師逐列輸入／修正）
                    </label>
                    <label style="display:flex; align-items:center; gap:5px; font-size:0.78rem; color:#334155; cursor:${speakLocked ? 'not-allowed' : 'pointer'};">
                        <input type="radio" name="${prefix}-speak-mode-${esc(cfg.id || '')}" class="${prefix}-speak-mode-opt" value="paste" ${speakMode === 'paste' ? 'checked' : ''}${speakLockAttr}>
                        直接貼上多筆資料（標注起始題號，可再逐列個別修正）
                    </label>
                    <input type="text" class="form-control ${prefix}-speak-formula" value="${esc(cfg.speakFormula || '')}" placeholder='例如 AN&amp;" "&amp;AO，可用資料項名稱或欄位代號' style="width:100%; padding:6px; margin-top:4px; font-size:0.78rem; display:${speakMode === 'formula' ? 'block' : 'none'};"${speakLockAttr}>
                </div>
                <div style="font-size:0.68rem; color:${gradingLocked ? '#94A3B8' : '#92400E'}; margin-top:8px;">${gradingLocked ? '批改屬於試卷範本。只勾擷取時這裡不能用。' : '💡 這裡先記錄批改標準／預設公式；實際口說答案內容（含公式算出來的值／貼上的值）可以到「⚡ 快速套用」產生預覽後逐列個別修正，修正後的值才是最終寫入 meta.json／script.txt 的內容。'}</div>
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
    function refreshAnswerGradingBlock(containerEl, prefix, cfg, aCount, opts) {
        if (!containerEl) return;
        const wrap = containerEl.querySelector('.' + prefix + '-answer-grading-wrap');
        if (!wrap) return;
        wrap.innerHTML = renderAnswerGradingSettingsHtml(prefix, cfg, aCount, opts);
        if (!(opts && opts.gateByExamRole && !opts.examRoleOn)) {
            bindAnswerGradingSettingsEvents(wrap, prefix, cfg);
        }
    }

    /** 欄位選取／欄位對應設定要「看」哪個活頁的欄位當預覽——現在活頁選擇是每組（Template）各自的 */
    function isDriveSource() {
        return _excelSourceMode === 'drive';
    }

    function getTeacherMetaOptions() {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMetaCatalogEntry !== 'function') return [];
        const entry = window.FeatureTimeline.getMetaCatalogEntry('', 'teacher');
        return (entry && entry.options) || [];
    }

    function currentDriveFolderFileValue() {
        if (!_excelMaterialFolder) return '';
        if (_excelDriveFileName) return _excelMaterialFolder + '::' + _excelDriveFileName;
        return _excelMaterialFolder;
    }

    function parseDriveFolderFileValue(raw) {
        const v = String(raw || '').trim();
        if (!v || v === '__manual__') return { folder: '', fileName: '' };
        const idx = v.indexOf('::');
        if (idx < 0) return { folder: v, fileName: '' };
        return { folder: v.slice(0, idx), fileName: v.slice(idx + 2) };
    }

    function applyDriveFolderFileSelection(raw) {
        if (raw === '__manual__') {
            _excelDriveFileName = '';
            return;
        }
        const parsed = parseDriveFolderFileValue(raw);
        _excelMaterialFolder = parsed.folder;
        _excelDriveFileName = parsed.fileName;
    }

    function isDriveWholeFolder() {
        return isDriveSource() && !!_excelMaterialFolder && !_excelDriveFileName;
    }

    function seedDriveFileCheck(seg) {
        if (!seg || !isDriveSource()) return;
        if (!seg.checkedSheets) seg.checkedSheets = {};
        if (isDriveWholeFolder()) {
            currentSheetNames().forEach(function (n) { seg.checkedSheets[n] = true; });
            return;
        }
        if (!_excelDriveFileName) return;
        const stem = stemFromMetaFileName(_excelDriveFileName);
        if (!stem) return;
        const already = Object.keys(seg.checkedSheets).some(function (k) { return seg.checkedSheets[k]; });
        if (!already) seg.checkedSheets[stem] = true;
    }

    function buildDriveFolderFileOptionsHtml(currentValue) {
        const cur = String(currentValue || '');
        const byFolder = {};
        const order = [];
        getTeacherMetaOptions().forEach(function (o) {
            const folder = String((o && o.folderName) || '').trim();
            if (!folder) return;
            if (!byFolder[folder]) {
                byFolder[folder] = [];
                order.push(folder);
            }
            if (o.fileName) byFolder[folder].push(String(o.fileName));
        });
        uniqueFolderNames('', 'teacher').forEach(function (f) {
            if (!byFolder[f]) {
                byFolder[f] = [];
                order.push(f);
            }
        });
        let matched = !cur;
        let html = '<option value="">— 選雲端教材資料夾／檔案 —</option>';
        order.forEach(function (folder) {
            const seen = {};
            const files = (byFolder[folder] || []).filter(function (n) {
                if (!n || seen[n]) return false;
                seen[n] = true;
                return true;
            });
            html += '<optgroup label="📁 ' + esc(folder) + '">';
            const folderSelected = cur === folder;
            if (folderSelected) matched = true;
            html += '<option value="' + esc(folder) + '"' + (folderSelected ? ' selected' : '') + '>整個資料夾（'
                + (files.length ? (files.length + ' 個檔案') : '尚無檔案') + '）</option>';
            files.forEach(function (fn) {
                const val = folder + '::' + fn;
                const isCur = cur === val;
                if (isCur) matched = true;
                html += '<option value="' + esc(val) + '"' + (isCur ? ' selected' : '') + '>📄 ' + esc(fn) + '</option>';
            });
            html += '</optgroup>';
        });
        if (cur && cur !== '__manual__' && !matched) {
            html += '<option value="' + esc(cur) + '" selected>⚠️ ' + esc(cur) + '（清單中找不到）</option>';
        }
        html += '<option value="__manual__"' + (cur === '__manual__' ? ' selected' : '') + '>✏️ 其他（手動輸入）</option>';
        return html;
    }

    function isSetupOrSystemSheet(name) {
        return /^_?(Setup|Config|Schema|Publish|Layout)$/i.test(String(name || '').trim());
    }

    function workbookSheetByHint(wb, hint) {
        const want = String(hint || '').replace(/^_/, '').toLowerCase();
        const names = (wb && wb.SheetNames) || [];
        for (let i = 0; i < names.length; i++) {
            if (String(names[i] || '').replace(/^_/, '').toLowerCase() === want) return names[i];
        }
        return '';
    }

    function matrixFromWorkbookSheet(wb, sheetName) {
        const sheet = wb && wb.Sheets && wb.Sheets[sheetName];
        if (!sheet || !window.XLSX || !window.XLSX.utils) return [];
        return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) || [];
    }

    function mapsFromHeaderRows(matrix, headerIdx) {
        const headers = (matrix[headerIdx] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
        const out = [];
        for (let r = headerIdx + 1; r < matrix.length; r++) {
            const row = matrix[r] || [];
            const first = String(row[0] || '').trim();
            if (!first) break;
            if (first.charAt(0) === '#') break;
            const obj = {};
            let empty = true;
            headers.forEach(function (h, i) {
                if (!h) return;
                const v = row[i];
                if (v != null && String(v).trim() !== '') empty = false;
                obj[h] = v;
            });
            if (!empty) out.push(obj);
        }
        return out;
    }

    /**
     * 讀 Excel 的 _Publish／_Setup#Publish。
     * vBK-2 只是來源分頁；真正的 meta 檔名在 output_meta（例如 Vocab_Set1.meta.json）。
     */
    function parsePublishRowsFromWorkbook(wb) {
        if (!wb) return [];
        const setupName = workbookSheetByHint(wb, 'setup');
        if (setupName) {
            const matrix = matrixFromWorkbookSheet(wb, setupName);
            for (let i = 0; i < matrix.length; i++) {
                const cell = String((matrix[i] && matrix[i][0]) || '').trim().replace(/^#/, '');
                if (/^_?Publish$/i.test(cell)) return mapsFromHeaderRows(matrix, i + 1);
            }
            return [];
        }
        const publishName = workbookSheetByHint(wb, 'publish');
        if (!publishName) return [];
        return mapsFromHeaderRows(matrixFromWorkbookSheet(wb, publishName), 0);
    }

    function publishOutputStemsFromWorkbook(wb) {
        return parsePublishRowsFromWorkbook(wb).map(function (row) {
            const enabled = String((row && row.enabled) || '').trim().toUpperCase();
            if (enabled && enabled !== 'Y' && enabled !== 'YES' && enabled !== '1' && enabled !== '是') return '';
            return String((row && row.output_meta) || '').trim().replace(/\.meta\.json$/i, '');
        }).filter(Boolean).filter(function (s, i, arr) {
            return arr.findIndex(function (x) { return x.toUpperCase() === s.toUpperCase(); }) === i;
        });
    }

    /**
     * 產生／預覽用的活頁清單＝老師勾選的 Excel 分頁，原樣保留。
     * 禁止用資料夾裡已有的全部 meta、_Publish 全表、或資料夾名蓋掉勾選
     * （2026-08-17：勾 Jessie-vBK-VerbIrregular-3 卻產出 Jessie-vBK-2，就是這裡把勾選換成資料夾舊檔）。
     * 上傳後真正落地的 stem 由 g.finalStem／defaultOutputNames 決定，不在這裡猜。
     */
    function resolveCanonicalSheetIds(excelSheetNames, folderName) {
        return (excelSheetNames || []).filter(function (n) {
            return String(n || '').trim() && !isSetupOrSystemSheet(n);
        });
    }

    function currentSheetNames() {
        if (isDriveSource()) return sheetStemsForFolder('', 'teacher', _excelMaterialFolder);
        const raw = (_excelWb && Array.isArray(_excelWb.SheetNames)) ? _excelWb.SheetNames : [];
        return raw.filter(function (n) { return !isSetupOrSystemSheet(n); });
    }

    function getReferenceSheetNameForSegment(seg) {
        const names = currentSheetNames();
        for (let i = 0; i < names.length; i++) {
            if (seg.checkedSheets[names[i]]) return names[i];
        }
        return '';
    }

    /** @type {Array<object>|null} 老師已存的欄位設定 Template（見「大區塊」儲存功能） */
    let _fieldTemplatesCache = null;
    let _fieldTemplatesLoadPromise = null;

    /**
     * 2026-08-05 第十三輪（架構修正）：擷取範本管理區塊自己的編輯狀態，跟 Excel 小工具的
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

    /**
     * 2026-08-14（正規化重構）：擷取範本／套用紀錄改存正規化表
     * （material_extraction_templates／material_folders／material_sheets），不再整批覆寫
     * profiles.raw_data 的 JSON 陣列。以下 fetch/save 系列函式是刻意保留的「相容層」——
     * 對外回傳／接收的形狀跟舊版一模一樣（陣列、欄位名不變），是因為整份檔案下面幾千行
     * render／collectFromDom／diff 邏輯全部是基於「陣列 record」在操作，逐一改寫風險極高
     * 且非必要；只有「怎麼落地到資料庫」這一層被替換成單筆 CRUD＋差異比對，不再有
     * 「一次寫整個陣列蓋掉別人剛存的紀錄」這類競態。
     */

    function isUuidLike(v) {
        return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    }

    async function getCurrentUserId() {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        return user ? user.id : null;
    }

    /**
     * 2026-08-14（範本庫合併）：擷取範本跟考卷範本現在是同一張表 material_templates
     * （見 110_teacher_core/feature-template-library.js），用 is_extraction_role／is_exam_role
     * 兩個角色勾選框取代「兩張表」。這裡改成向共用資料層要「有勾擷取角色」的那些，不再自己
     * 直接查資料庫——避免這裡跟 feature-exam-job.js 各自維護一份取資料邏輯，之後改一邊漏一邊。
     * 回傳形狀不變（仍含 id/legacy_id/name/columns/designed_from/answer_mode/...），另外多帶
     * is_exam_role／fields／fields_answer／quiz_prompt／quiz_answer／lines_per_page，供範本清單
     * 顯示「🧾 也當試卷範本」勾選框＋一次性預填用。
     */
    async function fetchFieldTemplates(force) {
        await window.FeatureTemplateLibrary.fetchTemplates(force);
        _fieldTemplatesCache = window.FeatureTemplateLibrary.getExtractionTemplates();
        return _fieldTemplatesCache;
    }

    /** 供渲染用（無法 await）：還沒載入過就背景觸發一次，先回目前已知的（可能是空陣列） */
    function getFieldTemplatesCachedSync() {
        _fieldTemplatesCache = window.FeatureTemplateLibrary.getExtractionTemplates();
        return _fieldTemplatesCache;
    }

    // 💣 雷區（2026-08-15 老師回報「網頁延遲，範本意外被刪除」，已徹底移除舊的 saveFieldTemplates）：
    // 舊版邏輯是「呼叫端抓一份自認完整的範本清單、局部改一筆，整份丟進來跟資料庫現有清單做差集，
    // 清單裡沒出現的全部當成『老師刪掉了』」。前提是「呼叫端拿到的清單一定完整、一定最新」，但
    // fetchFieldTemplates(true) 是一次網路請求，只要遇到延遲／race，拿到的清單可能是不完整的舊
    // 快取，其他明明還存在的範本就會被誤判成要刪除、批次 removeRole 砍掉角色（兩個角色都關掉還會
    // 真的軟刪除）。三個呼叫點（設計新擷取範本存檔／編輯器存檔／刪除）已改成只對「這一筆」直接
    // update／create／removeRole，不比對、不動任何其他範本。不要再新增「整份清單做差集刪除」的函式。

    /**
     * 「配對紀錄」的自然鍵：同一個範圍（老師個人／某班）＋同一個教材資料夾＋同一個擷取範本，
     * 邏輯上就是「同一組配對」，不該因為存檔路徑不同（⚡快速套用每次都會生成新的隨機 id）而被
     * 誤判成兩筆不同紀錄。template_id 有值就用 id 比對（改名不受影響），沒有 template_id
     * 的舊資料才退回用名稱比對。
     */
    function naturalAppKey(a) {
        const rootKind = (a && a.root_kind === 'class') ? 'class' : 'teacher';
        const classId = rootKind === 'class' ? String((a && a.class_id) || '') : '';
        const folder = String((a && a.material_folder) || '').trim().toUpperCase();
        let tplKey;
        if (a && a.template_id) {
            tplKey = 'id:' + a.template_id;
        } else {
            const rawName = String((a && a.template_name) || '').trim();
            const mappedId = (rawName && window.MaterialNameMap && typeof window.MaterialNameMap.resolveTemplateId === 'function')
                ? window.MaterialNameMap.resolveTemplateId(rawName)
                : '';
            tplKey = mappedId ? ('id:' + mappedId) : ('name:' + rawName.toUpperCase());
        }
        return [rootKind, classId, folder, tplKey].join('|');
    }

    /** 活頁 id 陣列取聯集（大小寫不敏感去重，保留原始大小寫寫法） */
    function unionSheetIds(a, b) {
        const raw = [];
        (a || []).concat(b || []).forEach(function (s) {
            const t = String(s || '').trim();
            if (t && !raw.some(function (x) { return String(x).toUpperCase() === t.toUpperCase(); })) raw.push(t);
        });
        return raw.filter(function (s, i) {
            const su = s.toUpperCase();
            return !raw.some(function (other, j) {
                if (i === j) return false;
                const ou = other.toUpperCase();
                return su !== ou && ou.indexOf(su + '.') === 0;
            });
        });
    }

    /**
     * 把一筆配對紀錄合併進既有清單：先用 id 找完全相同那一筆（老師編輯既有列後重新上傳／
     * 存檔＝直接整筆取代成最新狀態，尊重老師這次可能刻意取消勾選某個活頁）；id 找不到才用
     * naturalAppKey 找「同一組配對但 id 不同」（多半是重複套用長出來的重複項）——找到就合併
     * （活頁取聯集，其餘欄位用新值，但保留原本較舊那筆的 id，避免這筆紀錄的 id 每次都在變、
     * 讓其他還存著舊 id 的參照對不上）；都找不到才是真的新增一筆。
     */
    function mergeAppRecordIntoList(list, record) {
        if (!record) return list;
        let matchedIdx = -1;
        for (let i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(record.id)) { matchedIdx = i; break; }
        }
        let sameId = matchedIdx !== -1;
        if (matchedIdx === -1) {
            const key = naturalAppKey(record);
            for (let i = 0; i < list.length; i++) {
                if (naturalAppKey(list[i]) === key) { matchedIdx = i; break; }
            }
        }
        if (matchedIdx === -1) return list.concat([record]);
        const existing = list[matchedIdx];
        const next = list.slice();
        if (sameId) {
            next[matchedIdx] = record;
        } else {
            next[matchedIdx] = Object.assign({}, existing, record, { id: existing.id, sheet_ids: unionSheetIds(existing.sheet_ids, record.sheet_ids) });
        }
        return next;
    }

    /**
     * material_sheets 是「一筆＝一個活頁」，跟舊版「一筆＝一個 Template 套用（含 sheet_ids[] 陣列）」
     * 形狀不同——這裡把同一個（教材資料夾＋擷取範本）的活頁重新群組回舊版的「application
     * record」形狀，維持下面幾千行畫面邏輯不用改。group id 用「資料夾 id＋template id（或找不到
     * template 時退回舊 template 名稱）」組成的穩定字串，同一組配對每次讀出來 id 都一樣
     * ——不像舊版 Date.now()+隨機碼，這順便根治了 2026-08-13「重複套用長出兩筆」那類雷區。
     */
    function groupMaterialSheetsIntoApps(rows) {
        const groups = {};
        const order = [];
        (rows || []).forEach(function (row) {
            const folder = row.material_folders || {};
            const tpl = row.material_templates || null;
            const rootKind = folder.root_kind === 'class' ? 'class' : 'teacher';
            const classId = rootKind === 'class' ? String(folder.class_id || '') : '';
            const templateId = row.extraction_template_id || '';
            const templateName = tpl ? (tpl.name || '') : (row.legacy_template_name || '');
            const groupKey = 'grp|' + folder.id + '|' + (templateId || ('name:' + templateName.trim().toUpperCase()));
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    id: groupKey,
                    template_id: templateId,
                    template_name: templateName,
                    root_kind: rootKind,
                    class_id: classId,
                    material_folder: folder.folder_name || '',
                    sheet_ids: [],
                    source_kind: row.source_kind || '',
                    source_file_name: row.source_file_name || '',
                    row_start: row.row_start || '',
                    row_end: row.row_end || '',
                    _latestUpdatedAt: ''
                };
                order.push(groupKey);
            }
            const g = groups[groupKey];
            g.sheet_ids.push(row.sheet_stem);
            // 同一組裡取「最近一次更新」的那個活頁決定要顯示的行數起迄／來源——這幾個欄位
            // 舊版是整組共用一份，現在改成逐活頁存，用最新那筆當代表值最貼近老師目前的意圖
            if (!g._latestUpdatedAt || (row.updated_at && row.updated_at > g._latestUpdatedAt)) {
                g._latestUpdatedAt = row.updated_at || g._latestUpdatedAt;
                g.source_kind = row.source_kind || '';
                g.source_file_name = row.source_file_name || '';
                g.row_start = row.row_start || '';
                g.row_end = row.row_end || '';
            }
        });
        return order.map(function (k) { return groups[k]; });
    }

    async function fetchTemplateApplications(force) {
        if (_appCache && !force) return _appCache;
        if (_appLoadPromise && !force) return _appLoadPromise;
        _appLoadPromise = (async function () {
            const userId = await getCurrentUserId();
            if (!userId) { _appCache = []; return _appCache; }
            if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
                window.MaterialNameMap.ensureLoaded(false).catch(function () {});
            }
            const { data, error } = await window.supabaseClient
                .from('material_sheets')
                .select(`
                    id,
                    sheet_stem,
                    extraction_template_id,
                    legacy_template_name,
                    source_kind,
                    source_file_name,
                    row_start,
                    row_end,
                    updated_at,
                    material_folders!inner ( id, root_kind, class_id, folder_name, teacher_id ),
                    material_templates ( id, name )
                `)
                .eq('material_folders.teacher_id', userId)
                .order('sheet_stem', { ascending: true });
            if (error) {
                console.warn('[FeatureMaterialLayoutPairing] 讀取 Template 套用清單失敗', error);
                _appCache = _appCache || [];
                return _appCache;
            }
            _appCache = groupMaterialSheetsIntoApps(data);
            return _appCache;
        })().finally(function () { _appLoadPromise = null; });
        return _appLoadPromise;
    }

    function getTemplateApplicationsCachedSync() {
        if (_appCache === null && !_appLoadPromise) fetchTemplateApplications(false).catch(function () {});
        return _appCache || [];
    }

    async function ensureMaterialFolderId(userId, folderList, rootKind, classId, folderName) {
        const upperName = String(folderName || '').trim().toUpperCase();
        const existing = folderList.find(function (f) {
            return f.root_kind === rootKind
                && String(f.class_id || '') === String(classId || '')
                && String(f.folder_name || '').trim().toUpperCase() === upperName;
        });
        if (existing) return existing.id;
        const insertPayload = {
            teacher_id: userId,
            root_kind: rootKind,
            class_id: rootKind === 'class' ? (classId || null) : null,
            folder_name: String(folderName || '').trim(),
            material_type: 'vocab_sentence'
        };
        const { data: inserted, error } = await window.supabaseClient
            .from('material_folders').insert(insertPayload).select('id, root_kind, class_id, folder_name').single();
        if (error) throw error;
        folderList.push(inserted);
        return inserted.id;
    }

    /**
     * list＝這位老師「套用到教材」清單的完整期望狀態（跟舊版整批覆寫語意相同）。落地方式：
     * 每一組（資料夾＋Template）逐活頁 upsert 進 material_sheets；這次存檔前就存在、但沒有
     * 被任何一組「摸到」的活頁（代表被老師刪掉整組，或從 sheet_ids 裡拿掉勾選）才真的刪除
     * ——用單筆 CRUD 取代整批陣列覆寫，不會有「一份存檔蓋掉別的分頁剛存好的紀錄」的競態。
     */
    async function saveTemplateApplications(list) {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error('尚未登入');
        const desired = Array.isArray(list) ? list : [];

        const { data: allFolders, error: folderErr } = await window.supabaseClient
            .from('material_folders')
            .select('id, root_kind, class_id, folder_name')
            .eq('teacher_id', userId);
        if (folderErr) throw folderErr;
        const folderList = allFolders || [];
        const folderIds = folderList.map(function (f) { return f.id; });

        let beforeSheets = [];
        if (folderIds.length) {
            const { data: beforeRows, error: beforeErr } = await window.supabaseClient
                .from('material_sheets')
                .select('id, material_folder_id, sheet_stem')
                .in('material_folder_id', folderIds);
            if (beforeErr) throw beforeErr;
            beforeSheets = beforeRows || [];
        }
        const existingSheetsByFolder = {};
        beforeSheets.forEach(function (s) {
            if (!existingSheetsByFolder[s.material_folder_id]) existingSheetsByFolder[s.material_folder_id] = {};
            existingSheetsByFolder[s.material_folder_id][String(s.sheet_stem || '').trim().toUpperCase()] = s.id;
        });
        if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
            await window.MaterialNameMap.ensureLoaded(false);
        }

        function existingSheetIdForStem(folderId, stem) {
            const map = existingSheetsByFolder[folderId] || {};
            const keys = (window.MaterialNameMap && typeof window.MaterialNameMap.lookupKeys === 'function')
                ? window.MaterialNameMap.lookupKeys('sheet_stem', stem)
                : [stem];
            for (let i = 0; i < keys.length; i++) {
                const id = map[String(keys[i] || '').trim().toUpperCase()];
                if (id) return id;
            }
            const hit = window.MaterialNameMap && window.MaterialNameMap.resolve
                ? window.MaterialNameMap.resolve('sheet_stem', stem)
                : null;
            if (hit && hit.materialSheetId && String(hit.materialFolderId) === String(folderId)) {
                return hit.materialSheetId;
            }
            return null;
        }

        const templates = await fetchFieldTemplates(false);
        const touchedSheetIds = {};

        for (const d of desired) {
            const rootKind = d.root_kind === 'class' ? 'class' : 'teacher';
            const classId = rootKind === 'class' ? String(d.class_id || '') : '';
            const folderName = String(d.material_folder || '').trim();
            const sheetStems = (Array.isArray(d.sheet_ids) ? d.sheet_ids : [])
                .map(function (s) { return String(s || '').trim(); }).filter(Boolean);
            if (!folderName || !sheetStems.length) continue;

            const materialFolderId = await ensureMaterialFolderId(userId, folderList, rootKind, classId, folderName);
            if (!existingSheetsByFolder[materialFolderId]) existingSheetsByFolder[materialFolderId] = {};

            let extractionTemplateId = isUuidLike(d.template_id) ? d.template_id : null;
            if (!extractionTemplateId && d.template_name) {
                const wantName = String(d.template_name).trim();
                const mappedId = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveTemplateId === 'function')
                    ? window.MaterialNameMap.resolveTemplateId(wantName)
                    : '';
                const byName = templates.find(function (t) { return String(t.id) === String(mappedId); })
                    || templates.find(function (t) { return String(t.name || '').trim() === wantName; });
                if (byName) extractionTemplateId = byName.id;
            }
            const legacyTemplateName = extractionTemplateId ? null : (String(d.template_name || '').trim() || null);

            for (const stem of sheetStems) {
                const upperStem = stem.toUpperCase();
                const existingId = existingSheetIdForStem(materialFolderId, stem);
                const payload = {
                    material_folder_id: materialFolderId,
                    extraction_template_id: extractionTemplateId,
                    legacy_template_name: legacyTemplateName,
                    sheet_stem: stem,
                    source_kind: d.source_kind || null,
                    source_file_name: d.source_file_name || null,
                    row_start: d.row_start || null,
                    row_end: d.row_end || null,
                    updated_at: new Date().toISOString()
                };
                if (existingId) {
                    const before = beforeSheets.find(function (s) { return String(s.id) === String(existingId); });
                    const { error } = await window.supabaseClient.from('material_sheets').update(payload).eq('id', existingId);
                    if (error) throw error;
                    if (before && String(before.sheet_stem || '').trim().toUpperCase() !== upperStem
                        && window.MaterialNameMap && typeof window.MaterialNameMap.recordSheetRename === 'function') {
                        await window.MaterialNameMap.recordSheetRename({
                            folderId: materialFolderId,
                            sheetId: existingId,
                            oldStem: before.sheet_stem,
                            newStem: stem
                        });
                    }
                    existingSheetsByFolder[materialFolderId][upperStem] = existingId;
                    touchedSheetIds[String(existingId)] = true;
                } else {
                    const { data: inserted, error } = await window.supabaseClient
                        .from('material_sheets').insert(payload).select('id').single();
                    if (error) throw error;
                    existingSheetsByFolder[materialFolderId][upperStem] = inserted.id;
                    touchedSheetIds[String(inserted.id)] = true;
                }
            }
        }

        const toDelete = beforeSheets
            .map(function (s) { return String(s.id); })
            .filter(function (id) { return !touchedSheetIds[id]; });
        if (toDelete.length) {
            const { error } = await window.supabaseClient.from('material_sheets').delete().in('id', toDelete);
            if (error) throw error;
        }

        _appCache = await fetchTemplateApplications(true);
        return _appCache;
    }

    function getKnownSemanticKeys() {
        const seen = {};
        const out = [];
        const fromTemplates = [];
        // 💣 雷區（2026-08-15 老師回報「手動輸入後儲存，下拉還是顯示✏️其他（手動輸入）」）：
        // 舊版只認 SEMANTIC_KEY_SEED＋這次瀏覽打過的 _sessionSemanticKeys。重新整理或關掉再開
        // 編輯器時 session 清單是空的，已存進範本 columns 的自訂名稱（例如
        // fill-in-the-blank-question）就被當成「未知」，下拉落到「✏️ 其他（手動輸入）」＋旁邊
        // 再多一個輸入框。老師要求：儲存後這個名稱就是正式選項。所以這裡一定要把目前已存
        // 擷取範本的 semantic_key 全部收進來；正在編輯、還沒按儲存的那一筆也一併收，避免
        // 同一份表單重繪時又掉回手動輸入。
        getFieldTemplatesCachedSync().forEach(function (t) {
            (Array.isArray(t.columns) ? t.columns : []).forEach(function (c) {
                if (c && c.semantic_key) fromTemplates.push(c.semantic_key);
            });
        });
        if (_templateEditorState && Array.isArray(_templateEditorState.columns)) {
            _templateEditorState.columns.forEach(function (c) {
                if (c && c.semantic_key) fromTemplates.push(c.semantic_key);
            });
        }
        SEMANTIC_KEY_SEED.concat(fromTemplates).concat(_sessionSemanticKeys).forEach(function (k) {
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

    /**
     * 「＋新增」按鈕加的新列永遠是加在清單最後面——如果清單已經有其他列（例如剛存過一筆），
     * 新列會出現在畫面很下面，老師視線還停在上面剛存好的那一列，看起來就像「按了沒反應」
     * （2026-08-09 使用者回報「新增套用，根本無法再次使用」）。捲動到新列＋短暫外框高亮，
     * 讓「有新增成功」這件事變成看得到的動作，不用老師自己往下找。
     */
    function highlightNewRow(rowEl) {
        if (!rowEl || typeof rowEl.scrollIntoView !== 'function') return;
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevOutline = rowEl.style.outline;
        const prevOffset = rowEl.style.outlineOffset;
        rowEl.style.outline = '3px solid #6366F1';
        rowEl.style.outlineOffset = '2px';
        setTimeout(function () {
            rowEl.style.outline = prevOutline || '';
            rowEl.style.outlineOffset = prevOffset || '';
        }, 1600);
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

    /**
     * 2026-08-14（分離「擷取範本」與「考卷範本」）：這個函式原本被 getTemplateDerivedProfiles()
     * 呼叫，自動把「每一個」擷取範本無條件換算成考卷排版選項塞進出題下拉——沒有老師的明確同意，
     * 系統就自作主張讓所有擷取範本都變成「雙用」，這是被老師明確要求拔掉的核心行為（見
     * .cursor/plans 分離擷取範本與考卷範本）。getTemplateDerivedProfiles() 已刪除，這個函式現在
     * 只服務兩處唯讀相容需求：① resolveTemplateProfile()／'tpl:' 前綴機制，只用來讓歷史上已經
     * 存過 tpl:{uuid} 的舊 exam_job／quiz_paper 紀錄仍能重新產出；② 考卷範本編輯器「從擷取範本
     * 開始」的一次性預填草稿（老師存檔後就是完全獨立的考卷範本，不再跟原擷取範本有任何連動）。
     * 這兩種用法都不會出現在任何新的出題下拉選單裡。
     *
     * LayoutFieldsEval.lookupColumn 本來就會優先拿「識別字」當 row 自己的鍵去找（大小寫不拘），
     * 找不到才退回 Excel 欄字母 colMap；所以 fields 公式直接寫 semantic_key（如 display_zh）
     * 對新版 meta 是完全合法、會正確求值的，不需要额外欄字母對照表。
     * @param {object} template
     * @returns {{profile_id:string, label:string, fields:string, fields_answer:string, lines_per_page:number}|null}
     */
    function buildProfileFromTemplate(template) {
        if (!template || !template.id) return null;
        const draft = window.FeatureTemplateLibrary.computeExamDraftFromColumns(template);
        return {
            profile_id: 'tpl:' + template.id,
            label: template.name,
            fields: draft.fields || ('"（Template「' + String(template.name || '').replace(/"/g, '') + '」沒有勾選任何題目／訊息欄）"'),
            fields_answer: draft.fields_answer,
            lines_per_page: draft.lines_per_page
        };
    }

    /**
     * 2026-08-14（分離「擷取範本」與「考卷範本」，移除自動雙用行為）：這裡原本有一個
     * getSuggestedTemplateProfileId()，依教材資料夾＋活頁「這份 meta 實際是用哪個擷取範本套用
     * 產生的」自動換算成 'tpl:xxx' 考卷排版建議並塞回出題下拉——這正是老師明確指出的「系統
     * 自作主張把擷取範本當考卷範本」問題根源之一，已整個刪除（不再有任何函式把擷取範本自動
     * 換算成考卷排版建議）。出題畫面的建議鏈改讀 material_combinations →
     * material_combination_exam_templates（見 feature-class-material-combinations.js 的
     * getSuggestedExamTemplateId，老師在「🏫 班級教材組合」Step 2 明確勾選過的搭配才會被建議）。
     * resolveTemplateProfile()／'tpl:' 前綴機制仍保留成唯讀相容層，只服務歷史上已經存過
     * tpl:{uuid} 的舊 exam_job／quiz_paper 紀錄，跟這裡刪除的自動建議行為無關。
     */

    /**
     * 依 'tpl:xxx' 反查 Template，換算出排版 profile；不是 tpl: 開頭或找不到都回 null。
     * 💣 雷區（2026-08-14 backfill-verify 抓到）：xxx 可能是新版 uuid，也可能是遷移前
     * （JSON blob 時代）留下的舊字串 id（如 mft_1786028034473_4ew0，現存於老師實際考卷紀錄）
     * ——只比對 t.id 會讓這些舊考卷全部解析失敗，必須同時比對 t.legacy_id。
     */
    function resolveTemplateProfile(profileId) {
        const id = String(profileId || '').trim();
        if (id.indexOf('tpl:') !== 0) return null;
        return window.FeatureTemplateLibrary.resolveTemplateProfile(id);
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
        _excelDriveFileName = '';
        _excelSourceMode = 'local';
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
    function renderDriveSheetAreaHtml(seg) {
        if (!isDriveSource()) return renderSegmentSheetChecklistHtml(seg);
        if (isDriveWholeFolder()) {
            const n = currentSheetNames().length;
            return '<div style="font-size:0.76rem; color:#047857; font-weight:700; margin-bottom:10px;">已選整個資料夾，' + n + ' 個 meta 全部納入，不用再勾選。</div>';
        }
        return renderSegmentSheetChecklistHtml(seg);
    }

    function renderSegmentSheetChecklistHtml(seg) {
        const names = currentSheetNames();
        if (!names.length) {
            return isDriveSource()
                ? '<div style="font-size:0.76rem; color:#B45309; font-weight:800; margin-bottom:10px;">這個雲端教材資料夾目前偵測不到活頁（.meta.json）。清單可能還沒載入，或資料夾是空的。</div>'
                : '';
        }
        const driveFileHint = (isDriveSource() && _excelDriveFileName)
            ? '已自動勾選所選檔案，其餘 meta 可再複選：'
            : '這組（Template）要套用到哪些活頁？偵測到 ' + names.length + ' 個活頁，可多選：';
        return '<div style="font-size:0.76rem; font-weight:800; color:#475569; margin-bottom:6px;">' + driveFileHint
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
                matrix = sheetToMatrixFromColumnA(sheet);
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
            answer_combine_note: seg.answerCombineNote || '',
            speak_mode: normalizeSpeakMode(seg.speakMode),
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
                <label style="font-size:0.78rem; font-weight:800; color:#475569; display:block;">☁️ 目的：Drive 教材資料夾
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
        bindExcelFolderSelectEvents();
    }

    function bindExcelFolderSelectEvents(onFolderChange) {
        const folderSelectEl = document.getElementById('mlp-excel-folder-select');
        const folderManualEl = document.getElementById('mlp-excel-folder-manual');
        if (folderSelectEl) folderSelectEl.addEventListener('change', function () {
            if (folderManualEl) folderManualEl.style.display = this.value === '__manual__' ? 'block' : 'none';
            if (isDriveSource()) {
                applyDriveFolderFileSelection(this.value);
                if (this.value === '__manual__') _excelMaterialFolder = folderManualEl ? folderManualEl.value.trim() : '';
            } else {
                _excelDriveFileName = '';
                _excelMaterialFolder = this.value === '__manual__' ? (folderManualEl ? folderManualEl.value.trim() : '') : this.value;
            }
            if (typeof onFolderChange === 'function') onFolderChange(_excelMaterialFolder);
        });
        if (folderManualEl) folderManualEl.addEventListener('change', function () {
            _excelMaterialFolder = this.value.trim();
            if (isDriveSource()) _excelDriveFileName = '';
            if (typeof onFolderChange === 'function') onFolderChange(_excelMaterialFolder);
        });
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

    function renderExcelSourceWrap() {
        const wrap = document.getElementById('mlp-excel-source-wrap');
        if (!wrap) return;
        const isLocal = !isDriveSource();
        wrap.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
                <div style="font-size:0.78rem; font-weight:800; color:#475569;">來源</div>
                <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; font-weight:800; color:#334155; cursor:pointer;">
                    <input type="radio" name="mlp-excel-source-mode" class="mlp-excel-source-opt" value="local" ${isLocal ? 'checked' : ''}>
                    📄 來源：本機檔案
                </label>
                <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; font-weight:800; color:#334155; cursor:pointer;">
                    <input type="radio" name="mlp-excel-source-mode" class="mlp-excel-source-opt" value="drive" ${!isLocal ? 'checked' : ''}>
                    ☁️ 來源：雲端教材檔案
                </label>
            </div>
            <div id="mlp-excel-source-body"></div>
        `;
        wrap.querySelectorAll('.mlp-excel-source-opt').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (!this.checked) return;
                _excelSourceMode = this.value === 'drive' ? 'drive' : 'local';
                if (_excelSourceMode !== 'drive') _excelDriveFileName = '';
                _excelSegments = [];
                renderExcelSourceWrap();
                renderExcelBlock();
            });
        });
        renderExcelSourceBody();
    }

    function renderExcelSourceBody() {
        const body = document.getElementById('mlp-excel-source-body');
        if (!body) return;
        if (isDriveSource()) {
            body.innerHTML = `
                <div style="background:#FAFAFA; border:2px solid #E2E8F0; border-radius:10px; padding:14px; box-sizing:border-box;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569; display:block;">☁️ 選擇雲端教材資料夾／檔案
                        <select id="mlp-excel-folder-select" class="form-control" style="width:100%; padding:6px; margin-top:2px;">${buildDriveFolderFileOptionsHtml(currentDriveFolderFileValue())}</select>
                        <input type="text" id="mlp-excel-folder-manual" class="form-control" value="${esc(_excelMaterialFolder)}" placeholder="手動輸入資料夾名稱" style="width:100%; padding:6px; margin-top:2px; display:none;">
                        <div id="mlp-excel-folder-status" style="font-size:0.72rem; color:#94A3B8; min-height:1.1em; margin-top:2px;"></div>
                    </label>
                </div>
            `;
            refreshExcelFolderSelect(true);
            bindExcelFolderSelectEvents(function () {
                _excelSegments = [];
                renderExcelBlock();
            });
            return;
        }
        body.innerHTML = `
            <div style="display:flex; gap:16px; align-items:stretch; flex-wrap:wrap;">
                <div style="flex:1; min-width:240px; display:flex; flex-direction:column; background:#FAFAFA; border:2px solid #E2E8F0; border-radius:10px; padding:14px; box-sizing:border-box; justify-content:center;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569; display:block;">📄 來源：本機檔案
                        <input type="file" id="mlp-excel-file" accept=".xlsx,.xls" class="form-control" style="width:100%; padding:6px; margin-top:2px;">
                    </label>
                    <div id="mlp-excel-status" style="font-size:0.78rem; color:#EF4444; min-height:1.2em; margin-top:2px;"></div>
                </div>
                <div id="mlp-excel-folderfile" style="flex:1; min-width:240px; display:flex; flex-direction:column;"></div>
            </div>
        `;
        const excelFileEl = document.getElementById('mlp-excel-file');
        if (excelFileEl) excelFileEl.addEventListener('change', function () { handleExcelFileChange(this); });
        if (_excelWb) renderExcelFolderFileHtml();
    }

    function renderExcelBlock() {
        const wrap = document.getElementById('mlp-excel-block');
        if (!wrap) return;
        const ready = isDriveSource() ? !!_excelMaterialFolder : !!_excelWb;
        if (!ready) { wrap.innerHTML = ''; return; }
        ensureExcelSegments();
        if (isDriveSource()) ensureExcelSegments().forEach(seedDriveFileCheck);
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
            const seg = newExcelSegment();
            seedDriveFileCheck(seg);
            ensureExcelSegments().push(seg);
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
            renderOptionsHtml: function (list, currentValue) {
                if (isDriveSource()) return buildDriveFolderFileOptionsHtml(currentValue || currentDriveFolderFileValue());
                return buildSelectOptionsHtml(list, currentValue, '— 選教材資料夾 —');
            },
            emptyMessage: '⚠️ 這個帳號目前抓不到任何教材資料夾（不是連線錯誤）',
            onAfterUpdate: function () {
                if (isDriveSource() && _excelMaterialFolder) renderExcelBlock();
            }
        });
    }

    function renderExcelSegments() {
        const wrap = document.getElementById('mlp-excel-segments');
        if (!wrap) return;
        const segments = ensureExcelSegments();
        wrap.innerHTML = segments.map(function (seg, idx) { return renderSegmentCardHtml(seg, idx, segments.length); }).join('');
        segments.forEach(function (seg) { bindSegmentEvents(seg); });
    }

    function segmentWorkflowMode(seg) {
        if (seg.workflowMode === 'apply' || seg.workflowMode === 'design') return seg.workflowMode;
        return getAllTemplatesForApply().length ? 'apply' : 'design';
    }

    function getAllTemplatesForApply() {
        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getTemplatesCachedSync === 'function') {
            return window.FeatureTemplateLibrary.getTemplatesCachedSync();
        }
        return getFieldTemplatesCachedSync();
    }

    function templateUsageMap() {
        return (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.getUsageSummaryCachedSync === 'function')
            ? window.FeatureClassMaterialCombinations.getUsageSummaryCachedSync()
            : {};
    }

    function templateRoleLabel(t) {
        if (t && t.is_extraction_role && t.is_exam_role) return '擷取＋試卷';
        if (t && t.is_exam_role) return '僅試卷';
        return '僅擷取';
    }

    function templateUsageLines(t) {
        const u = templateUsageMap()[String(t && t.id)] || {};
        const byFolder = u.byFolder || {};
        const folders = (u.folders && u.folders.length) ? u.folders : Object.keys(byFolder);
        return folders.map(function (fn) {
            const classes = (byFolder[fn] && byFolder[fn].classNames) || [];
            return '教材 ' + fn + (classes.length ? ('｜班級 ' + classes.join('、')) : '｜尚未指派班級');
        });
    }

    function templateUsageText(t) {
        const lines = templateUsageLines(t);
        return lines.length ? lines.join('；') : '尚未套用到任何教材／班級';
    }

    function templateUsageHtml(t) {
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderTemplateUsageHtml === 'function') {
            return window.FeatureClassMaterialCombinations.renderTemplateUsageHtml(t && t.id, { lead: 'extraction' });
        }
        const lines = templateUsageLines(t);
        const body = lines.length
            ? lines.map(function (line) { return '<div style="font-size:0.78rem; color:#047857; font-weight:700;">' + esc(line) + '</div>'; }).join('')
            : '<div style="font-size:0.78rem; color:#047857; font-weight:700;">尚未套用到任何教材／班級</div>';
        return '<div style="font-size:0.78rem; color:#047857; font-weight:700; margin-top:4px;">實際使用：</div>' + body;
    }

    function refreshTemplateUsageCache() {
        if (!window.FeatureClassMaterialCombinations || typeof window.FeatureClassMaterialCombinations.summarizeUsageByTemplate !== 'function') {
            return Promise.resolve();
        }
        return window.FeatureClassMaterialCombinations.summarizeUsageByTemplate().then(function () {
            renderTemplateList();
            if (window.FeatureExamTemplateEditor && typeof window.FeatureExamTemplateEditor.render === 'function') {
                window.FeatureExamTemplateEditor.render();
            }
        }).catch(function (err) {
            console.error('[FeatureMaterialLayoutPairing] 載入範本使用現況失敗', err);
        });
    }

    function templatesForCurrentSource() {
        const all = getAllTemplatesForApply();
        if (isDriveSource()) return all.filter(function (t) { return t && t.is_exam_role; });
        return all.filter(function (t) { return t && t.is_extraction_role; });
    }

    function buildApplyTemplateOptionsHtml(selectedId, selectedName) {
        const applyable = templatesForCurrentSource();
        const usage = templateUsageMap();
        const used = [];
        const unused = [];
        applyable.forEach(function (t) {
            const u = usage[String(t.id)];
            if (u && ((u.folders && u.folders.length) || (u.classNames && u.classNames.length))) used.push(t);
            else unused.push(t);
        });
        function opt(t) {
            const selected = String(t.id) === String(selectedId || '')
                || (!selectedId && selectedName && String(t.name || '').trim() === String(selectedName).trim());
            const label = (t.name || '（未命名）') + '｜' + templateRoleLabel(t);
            return '<option value="' + esc(t.id) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
        }
        let html = '<option value="">— 選擇要套用的範本 —</option>';
        if (used.length) html += '<optgroup label="已套用到教材／班級">' + used.map(opt).join('') + '</optgroup>';
        if (unused.length) html += '<optgroup label="尚未套用">' + unused.map(opt).join('') + '</optgroup>';
        return html;
    }

    function renderSegmentCardHtml(seg, idx, total) {
        const referenceSheet = getReferenceSheetNameForSegment(seg);
        const cols = parseSheetColumns(referenceSheet);
        const mode = segmentWorkflowMode(seg);
        const isApply = mode === 'apply';
        return `
            <div class="mlp-excel-segment" data-seg-id="${esc(seg.id)}" style="background:white; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="font-size:0.82rem; color:#0F766E;">第 ${idx + 1} 組</strong>
                    ${total > 1 ? '<button type="button" class="mlp-excel-remove-segment btn" style="padding:2px 8px; font-size:0.72rem; color:#B91C1C; border:1px solid #FCA5A5; border-radius:4px; background:white;">刪除這組</button>' : ''}
                </div>
                <div class="mlp-excel-workflow-radios" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; font-weight:800; color:#047857; cursor:pointer;">
                        <input type="radio" name="mlp-excel-workflow-${esc(seg.id)}" class="mlp-excel-workflow-opt" value="apply" ${isApply ? 'checked' : ''}>
                        ${isDriveSource() ? '套用目前的試卷範本' : '套用目前的範本'}
                    </label>
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; font-weight:800; color:#0F766E; cursor:pointer;">
                        <input type="radio" name="mlp-excel-workflow-${esc(seg.id)}" class="mlp-excel-workflow-opt" value="design" ${!isApply ? 'checked' : ''}>
                        ${isDriveSource()
                            ? '🆕 設計新試卷範本（現有的試卷範本都不適用時才需要）'
                            : '🆕 設計新擷取範本（現有的擷取範本都不適用，需要重新勾欄位設定時才需要）'}
                    </label>
                </div>
                <div class="mlp-excel-quickapply-area" style="display:${isApply ? 'block' : 'none'};">${renderQuickApplyAreaHtml(seg)}</div>
                <div class="mlp-excel-quickapply-results">${(seg.quickApplyResults || []).map(function (app) { return renderAppRow(app, { collapsedSummary: true }); }).join('')}</div>
                <div class="mlp-excel-design-body" style="display:${isApply ? 'none' : 'block'}; margin-top:8px; padding-top:8px; border-top:1px dashed #CBD5E1;">
                    <div class="mlp-excel-sheets-area">${renderDriveSheetAreaHtml(seg)}</div>
                    ${isDriveSource() ? '<div style="font-size:0.76rem; color:#1D4ED8; font-weight:700; margin-bottom:10px;">雲端教材已是發布後的 meta，這裡是套用或新設計<b>試卷範本</b>並指派班級，不是從 Excel 擷取欄位。要擷取欄位請改選本機檔案。</div>' : ''}
                    <div class="mlp-excel-cols-area">${isDriveSource() ? '' : renderColsAreaHtml(seg, cols)}</div>
                    <div class="mlp-excel-mapping-area">${(!isDriveSource() && seg.confirmed) ? renderMappingAreaHtml(seg) : ''}</div>
                    <div class="mlp-excel-design-assign">${isApply ? '' : renderDesignAssignHtml(seg)}</div>
                    <div class="mlp-excel-save-area">${(!isDriveSource() && seg.confirmed) ? renderSegmentSaveAreaHtml(seg) : ''}</div>
                </div>
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
                    每個欄位的資料項名稱／題目／答案／訊息設定好之後，按下面橘色儲存鈕。
                    橘色按鈕會存範本規則、寫入班級組合，並且（無論「套用為」選上面或下面）把目前勾選活頁的 meta.json／script.txt 上傳到 Drive。
                    下方「行數起／行數末」＋「產生 meta 預覽」只是先看結果，不會單獨上傳。
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
     * 「設計 Template」卡片內的即時 meta 預覽：行數起／行數末＋「產生 meta 預覽」按鈕。
     * 這顆按鈕本身只預覽；真正上傳走橘色儲存鈕（見 handleSaveSegment）。
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
            seg.lastGen = {
                sheetName: sheetName,
                rows: result.rows,
                scriptLines: result.scriptLines || [],
                rowStart: seg.rowStart,
                rowEnd: seg.rowEnd
            };
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

        cardEl.querySelectorAll('.mlp-excel-workflow-opt').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (!this.checked) return;
                seg.workflowMode = this.value === 'design' ? 'design' : 'apply';
                renderExcelSegments();
            });
        });
        bindSegmentSheetChecklistEvents(seg, cardEl);
        bindQuickApplyAreaEvents(seg, cardEl);
        const openExamTplBtn = cardEl.querySelector('.mlp-excel-open-exam-tpl-btn');
        if (openExamTplBtn) openExamTplBtn.addEventListener('click', function () {
            const container = document.getElementById('exam-template-editor-container');
            if (container && typeof container.scrollIntoView === 'function') {
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            if (window.FeatureExamTemplateEditor && typeof window.FeatureExamTemplateEditor.openNewForm === 'function') {
                window.FeatureExamTemplateEditor.openNewForm();
            }
        });
        cardEl.querySelectorAll('.mlp-excel-quickapply-results .mlp-app-row').forEach(function (rowEl) {
            bindQuickApplyResultRowEvents(seg, rowEl);
        });
        bindDesignToggleEvents(seg, cardEl);
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
     * 跟上方「🧩擷取範本」管理區塊的名稱一致（同一份資料，只是進入點不同）。
     */
    /**
     * 2026-08-16 老師要求：同一份 Excel 再次儲存 meta，若這次名字被系統判斷成「新增」
     * （名字沒對到既有範本），但欄位設定／答案批改標準跟某個既有範本完全相同，不該再長出
     * 一筆內容重複、只是名字不同的範本——應該直接蓋過那筆舊範本（保留舊範本的 id，
     * 讓已經指到這個範本 id 的組合／指派班級都不用重新綁）。簽章只比較「內容」：
     * 欄位（依字母排序後逐欄比對）＋答案/口說批改設定，完全不看名字／designed_from。
     */
    function templateContentSignature(t) {
        const cols = (Array.isArray(t && t.columns) ? t.columns : []).slice().sort(function (a, b) {
            return String((a && a.letter) || '').localeCompare(String((b && b.letter) || ''));
        }).map(function (c) {
            return [
                String((c && c.letter) || '').toUpperCase(),
                String((c && c.semantic_key) || '').trim().toLowerCase(),
                (c && c.is_question) ? 1 : 0,
                (c && c.is_answer) ? 1 : 0,
                (c && c.is_info) ? 1 : 0,
                (c && c.is_ai_ref) ? 1 : 0
            ].join(':');
        }).join('|');
        const answerMode = (t && t.answer_mode === 'separate') ? 'separate' : 'combine';
        const answerNote = String((t && t.answer_combine_note) || '').trim();
        const speakMode = normalizeSpeakMode(t && t.speak_mode);
        const speakFormula = String((t && t.speak_formula) || '').trim();
        return [cols, answerMode, answerNote, speakMode, speakFormula].join('##');
    }

    /** 儲存結果訊息開頭：一般覆蓋／一般新增／內容重複被自動蓋成新名字三種情況分開講清楚，不要讓老師誤以為多了一筆重複範本 */
    function saveResultLead(existing, overwroteDuplicate, name) {
        if (overwroteDuplicate) {
            return '✅ 內容跟既有範本「' + overwroteDuplicate.name + '」相同，已直接改名並覆蓋為「' + name + '」';
        }
        return (existing ? '✅ 已覆蓋更新範本「' : '✅ 已新增範本「') + name + '」';
    }

    function designSaveButtonLabel(seg) {
        return (seg && seg.quickApplyRole === 'both')
            ? '💾 儲存    教材檔案＋試卷範本'
            : '💾 儲存   試卷範本';
    }

    function syncDesignSaveButtonLabel(cardEl, seg) {
        const btn = cardEl && cardEl.querySelector('.mlp-excel-save-segment');
        if (btn) btn.textContent = designSaveButtonLabel(seg);
    }

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
                <label style="font-size:0.78rem; font-weight:800; color:#475569;">名稱（同名＝覆蓋更新，新名＝新增一筆）
                    <div style="display:flex; gap:6px; margin-top:2px;">
                        <select class="form-control mlp-excel-seg-name-select" style="width:180px; padding:6px;">${buildSelectOptionsHtml(uniqueNames, isKnownName ? curName : '__manual__', '— 選擇已有名稱 —')}</select>
                        <input type="text" class="form-control mlp-excel-seg-name-manual" value="${esc(isKnownName ? '' : curName)}" placeholder="幫這份取個名字" style="width:180px; padding:6px; display:${isKnownName ? 'none' : 'block'};">
                    </div>
                </label>
                <button type="button" class="mlp-excel-save-segment btn btn-primary" style="padding:7px 16px; font-weight:800;">${esc(designSaveButtonLabel(seg))}</button>
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
            refreshComboUsageForSeg(seg, cardEl);
        });
        if (nameManualEl) nameManualEl.addEventListener('change', function () {
            seg.name = this.value.trim();
            refreshComboUsageForSeg(seg, cardEl);
        });
        const saveBtn = cardEl.querySelector('.mlp-excel-save-segment');
        if (saveBtn) saveBtn.addEventListener('click', function () { handleSaveSegment(seg, cardEl); });
        cardEl.querySelectorAll('.mlp-excel-design-assign .mlp-excel-quickapply-role').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (!this.checked) return;
                seg.quickApplyRole = this.value === 'both' ? 'both' : 'extraction';
                syncDesignSaveButtonLabel(cardEl, seg);
            });
        });
        syncDesignSaveButtonLabel(cardEl, seg);
        bindQuickApplyClassChecks(seg, cardEl.querySelector('.mlp-excel-design-assign'));
        refreshComboUsageForSeg(seg, cardEl);
    }

    /**
     * 快速套用產生出來的結果列，「刪除」鈕除了原本 bindAppRowEvents 已經會做的
     * rowEl.remove() ＋清 _appRowState，還要同步把這筆從 seg.quickApplyResults 陣列
     * splice 掉——否則下次這張卡片整段重繪（例如確定選取欄位／刪除別組），這筆明明已經
     * 被刪除的結果會因為還留在 seg.quickApplyResults 裡而「復活」。
     */
    function bindQuickApplyResultRowEvents(seg, rowEl) {
        bindAppRowEvents(rowEl);
        refreshAppFolderSelect(rowEl);
        const removeBtn = rowEl.querySelector('.mlp-app-remove');
        if (removeBtn) removeBtn.addEventListener('click', function () {
            const appId = rowEl.getAttribute('data-id');
            seg.quickApplyResults = (seg.quickApplyResults || []).filter(function (a) { return a.id !== appId; });
        });
    }

    /**
     * ⚡「套用現成擷取範本」：不碰任何 Template 的儲存（不會覆蓋、不會新增一筆）。
     *
     * 2026-08-13（老師回報「不是產生套用，應該是產生 meta/script 吧」「流程分割不清楚、
     * 一直重複」）：改版前這裡會在下面「📎 套用到教材」（#mlp-app-rows）另外新增一整列，
     * 重新顯示歸屬檔案／活頁來源／行數起迄——這些資訊在上面快速套用區塊都已經填過一次，
     * 老師還要再滑到下面確認一次、按「產生預覽」、再按「確認上傳」，同一批資訊出現兩次、
     * 要按三個按鈕才能完成。改成：直接把結果掛在**這張 Excel 卡片內部**
     * （.mlp-excel-quickapply-results，記在 seg.quickApplyResults 上見該欄位說明），
     * 歸屬檔案／活頁來源／行數起迄收合成一行摘要（renderAppRow 的 collapsedSummary），
     * 且建立後立即自動跑一次「產生預覽」，老師接下來只要看預覽結果、按「☁️ 確認上傳到
     * Drive」即可——從三個按鈕減到兩個，也不會再看到重複的檔案／活頁/行數輸入框。
     */
    function selectedQuickApplyClassIds(seg) {
        return Object.keys(seg.quickApplyClassIds || {}).filter(function (id) {
            return !!seg.quickApplyClassIds[id];
        });
    }

    async function ensureApplyRoles(matchedTpl, includeExam) {
        if (!matchedTpl || !window.FeatureTemplateLibrary || typeof window.FeatureTemplateLibrary.addRole !== 'function') return;
        if (isDriveSource()) {
            if (!matchedTpl.is_exam_role) await window.FeatureTemplateLibrary.addRole(matchedTpl.id, 'exam');
            return;
        }
        if (!matchedTpl.is_extraction_role) {
            await window.FeatureTemplateLibrary.addRole(matchedTpl.id, 'extraction');
        }
        if (includeExam && !matchedTpl.is_exam_role) {
            await window.FeatureTemplateLibrary.addRole(matchedTpl.id, 'exam');
        }
    }

    async function persistApplyComboRecord(seg, appRecord, matchedTpl) {
        const includeExam = isDriveSource() || !!(seg && seg.quickApplyRole === 'both');
        await ensureApplyRoles(matchedTpl, includeExam);
        if (appRecord && appRecord.template_name && appRecord.material_folder && (appRecord.sheet_ids || []).length) {
            const latest = await fetchTemplateApplications(true);
            const merged = mergeAppRecordIntoList(latest, appRecord);
            await saveTemplateApplications(merged);
        }
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.recordApplyFromExcel === 'function' && matchedTpl) {
            await window.FeatureClassMaterialCombinations.recordApplyFromExcel({
                folderName: (appRecord && appRecord.material_folder) || _excelMaterialFolder || '',
                templateId: matchedTpl.id
            });
        }
    }

    function handleApplyExistingTemplate(seg, cardEl) {
        const msgEl = cardEl.querySelector('.mlp-excel-quickapply-msg');
        const matchedEarly = findApplyTemplateForSeg(seg);
        const templateName = (matchedEarly && matchedEarly.name) || (seg.quickApplyTemplateName || '').trim();
        if (!templateName && !seg.quickApplyTemplateId) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = isDriveSource() ? '❌ 請先選一個要套用的試卷範本' : '❌ 請先選一個要套用的現成擷取範本'; }
            return;
        }
        const driveMode = isDriveSource();
        const sheetNames = driveMode
            ? driveTargetSheetNames(seg)
            : Object.keys(seg.checkedSheets).filter(function (k) { return seg.checkedSheets[k]; }).sort();
        if (!driveMode && !sheetNames.length) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請先勾選至少一個活頁'; }
            return;
        }
        if (driveMode && !sheetNames.length) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 這個雲端資料夾目前沒有可套用的活頁檔'; }
            return;
        }
        const rowStart = (seg.quickApplyRowStart || '').trim();
        if (!driveMode && !rowStart) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請先填「行數起」（資料從 Excel 第幾行開始讀）'; }
            return;
        }
        if (!_excelMaterialFolder) {
            if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = driveMode ? '❌ 請先選雲端教材資料夾' : '❌ 請先選「目的：Drive 教材資料夾」'; }
            return;
        }
        const resultsEl = cardEl.querySelector('.mlp-excel-quickapply-results');
        if (!driveMode && !resultsEl) {
            window.showFlash && window.showFlash('❌ 系統錯誤：找不到產生結果容器，請重新整理頁面', 'error');
            return;
        }
        try {
            // template_id 一定要一起存：跟「+新增套用」（collectAppFromRow）用同一套自然鍵比對邏輯
            // （naturalAppKey 優先用 template_id），否則快速套用產生的紀錄跟手動新增列各用不同的鍵
            // （一個用 id、一個用名稱），同一組配對永遠合併不到一起，繼續長出重複項。
            const matchedTpl = matchedEarly || findApplyTemplateByName(templateName);
            if (driveMode) {
                seg.quickApplyRole = 'both';
            } else if (matchedTpl && matchedTpl.is_exam_role) {
                seg.quickApplyRole = 'both';
            }
            const newApp = {
                id: 'mta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                template_name: templateName,
                template_id: matchedTpl ? matchedTpl.id : '',
                root_kind: 'teacher',
                class_id: '',
                material_folder: _excelMaterialFolder || '',
                sheet_ids: sheetNames.slice(),
                row_start: driveMode ? '' : rowStart,
                row_end: driveMode ? '' : (seg.quickApplyRowEnd || '').trim(),
                source_kind: driveMode ? 'drive' : 'local',
                source_file_name: driveMode ? '' : (_excelFileName || '')
            };
            if (driveMode) {
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 正在寫入教材與範本組合…'; }
            persistApplyComboRecord(seg, newApp, matchedTpl).then(function () {
                if (msgEl) { msgEl.style.color = '#059669'; msgEl.textContent = '✅ 已寫入資料庫：這個教材＋範本組合，以及指派的班級'; }
                refreshComboUsageForSeg(seg, cardEl);
                refreshTemplateUsageCache();
                    window.showFlash && window.showFlash('已套用「' + templateName + '」到雲端教材並寫入資料庫', 'success');
                }).catch(function (persistErr) {
                    console.error('[FeatureMaterialLayoutPairing] 寫入教材與範本組合失敗', persistErr);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 寫入組合失敗：' + (persistErr.message || persistErr); }
                });
                return;
            }
            // 雷區：renderAppRow 內部會呼叫 ensureAppRowState 並立刻用它畫出「🚀 產生並上傳」
            // 區塊——若晚一步才補 localRawData，那一輪畫出來的會是「請先選本機檔案」的提示。
            // 必須先建好狀態、把原始位元組塞進去，才呼叫 renderAppRow 畫 HTML。
            const state = ensureAppRowState(newApp.id, newApp);
            state.localRawData = _excelRawData;
            seg.quickApplyResults = (seg.quickApplyResults || []).concat([newApp]);
            const div = document.createElement('div');
            div.innerHTML = renderAppRow(newApp, { collapsedSummary: true });
            const newRow = div.firstElementChild;
            resultsEl.appendChild(newRow);
            bindQuickApplyResultRowEvents(seg, newRow);
            highlightNewRow(newRow);
            // 歸屬檔案／活頁／行數起迄都已經確定，直接自動跑一次「產生預覽」，不用老師再多按一次
            handleGeneratePreview(newRow, newApp.id);
            if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '✅ 已產生預覽。確認無誤後按「☁️ 確認上傳到 Drive」會蓋過資料夾裡已有的同名 meta.json'; }
            window.showFlash && window.showFlash('已套用「' + templateName + '」，請確認下方預覽後上傳（會蓋過現有 meta）', 'success');
        } catch (err) {
            console.error('[FeatureMaterialLayoutPairing] 套用現成擷取範本失敗', err);
            window.showFlash && window.showFlash('❌ 套用失敗：' + (err.message || err), 'error');
        }
    }

    function comboUsageCacheKey(folderName, templateId) {
        return String(folderName || '').trim().toUpperCase() + '|' + String(templateId || '');
    }

    function findApplyTemplateByName(name) {
        const n = String(name || '').trim();
        if (!n) return null;
        const all = getAllTemplatesForApply();
        const byId = all.find(function (t) { return String(t.id) === n; });
        if (byId) return byId;
        const byName = all.find(function (t) { return String(t.name || '').trim() === n; });
        if (byName) return byName;
        const mappedId = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveTemplateId === 'function')
            ? window.MaterialNameMap.resolveTemplateId(n)
            : '';
        return mappedId
            ? (all.find(function (t) { return String(t.id) === String(mappedId); }) || null)
            : null;
    }

    function findApplyTemplateForSeg(seg) {
        if (!seg) return null;
        if (seg.quickApplyTemplateId) {
            const byId = getAllTemplatesForApply().find(function (t) { return String(t.id) === String(seg.quickApplyTemplateId); });
            if (byId) return byId;
        }
        return findApplyTemplateByName(seg.quickApplyTemplateName);
    }

    function renderComboUsageInnerHtml(seg, usage) {
        const usedNames = (usage && usage.classNames) ? usage.classNames : [];
        return '<div style="font-size:0.76rem; color:#334155; margin-bottom:4px;">目前這個教材＋範本'
            + (usedNames.length
                ? ('已指派給：<b>' + usedNames.map(esc).join('、') + '</b>')
                : '尚未指派給任何班級')
            + '</div>'
            + '<div style="font-size:0.74rem; color:#64748B; font-weight:700;">要改套餐名稱、試卷範本或採用班級，請到下方「📁 教材區」儲存。</div>';
    }

    function driveTargetSheetNames(seg) {
        if (!isDriveSource() || !_excelMaterialFolder) return [];
        if (!_excelDriveFileName) return currentSheetNames();
        if (seg) {
            const picked = Object.keys(seg.checkedSheets || {}).filter(function (k) { return seg.checkedSheets[k]; }).sort();
            if (picked.length) return picked;
        }
        const stem = stemFromMetaFileName(_excelDriveFileName);
        return stem ? [stem] : [];
    }

    function renderComboUsageBoxHtml(seg, templateName) {
        const selectedTpl = findApplyTemplateByName(templateName) || findApplyTemplateForSeg(seg);
        const usageKey = selectedTpl ? comboUsageCacheKey(_excelMaterialFolder, selectedTpl.id) : '';
        const usage = usageKey ? (_comboUsageCache[usageKey] || { classIds: [], classNames: [] }) : { classIds: [], classNames: [] };
        return '<div class="mlp-excel-combo-usage" style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:6px; padding:8px 10px; margin-bottom:10px;">'
            + renderComboUsageInnerHtml(seg, usage)
            + '</div>';
    }

    function renderComboAssignBlockHtml(seg, templateName) {
        if (isDriveSource()) {
            seg.quickApplyRole = 'both';
            return (
                '<div style="font-size:0.76rem; font-weight:800; color:#047857; margin-bottom:4px;">套用為</div>'
                + '<div style="font-size:0.78rem; font-weight:800; color:#1D4ED8; margin-bottom:10px;">試卷範本</div>'
                + renderComboUsageBoxHtml(seg, templateName)
            );
        }
        const role = seg.quickApplyRole === 'both' ? 'both' : 'extraction';
        return (
            '<div style="font-size:0.76rem; font-weight:800; color:#047857; margin-bottom:4px;">套用為</div>'
            + '<label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:700; color:#334155; cursor:pointer; margin-bottom:3px;">'
                + '<input type="radio" name="mlp-excel-apply-role-' + esc(seg.id) + '" class="mlp-excel-quickapply-role" value="extraction" ' + (role === 'extraction' ? 'checked' : '') + '>擷取範本'
            + '</label>'
            + '<label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; font-weight:700; color:#334155; cursor:pointer; margin-bottom:10px;">'
                + '<input type="radio" name="mlp-excel-apply-role-' + esc(seg.id) + '" class="mlp-excel-quickapply-role" value="both" ' + (role === 'both' ? 'checked' : '') + '>擷取範本與試卷範本'
            + '</label>'
            + renderComboUsageBoxHtml(seg, templateName)
        );
    }

    function renderDesignAssignHtml(seg) {
        const name = (seg.name || '').trim();
        const examNewBtn = isDriveSource()
            ? '<button type="button" class="mlp-excel-open-exam-tpl-btn btn" style="margin-bottom:8px; padding:6px 12px; font-size:0.78rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE;">➕ 新增試卷範本</button>'
            : '';
        return (
            '<div style="margin-top:10px; padding:10px; background:#ECFDF5; border:1px solid #6EE7B7; border-radius:8px;">'
                + examNewBtn
                + '<div style="font-size:0.8rem; font-weight:800; color:#047857; margin-bottom:6px;">這個教材＋範本組合的班級使用現況（設計新範本也會一併記錄）</div>'
                + renderComboAssignBlockHtml(seg, name)
            + '</div>'
        );
    }

    function renderQuickApplyAreaHtml(seg) {
        const sheetNames = Object.keys(seg.checkedSheets).filter(function (k) { return seg.checkedSheets[k]; }).sort();
        const applyable = templatesForCurrentSource();
        if (!applyable.length) {
            return isDriveSource()
                ? '<div style="margin-bottom:10px; padding:10px; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:8px; color:#94A3B8; font-size:0.8rem;">💡 目前還沒有任何試卷範本，請改選「🆕 設計新試卷範本」先建立一份。</div>'
                : '<div style="margin-bottom:10px; padding:10px; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:8px; color:#94A3B8; font-size:0.8rem;">💡 目前還沒有任何擷取範本，請改選「🆕 設計新擷取範本」先設計一份。</div>';
        }
        const selectedName = (seg.quickApplyTemplateName || '').trim();
        const selectedId = (seg.quickApplyTemplateId || '').trim();
        const driveMode = isDriveSource();
        const driveSheets = driveMode ? driveTargetSheetNames(seg) : [];
        const canConfirm = driveMode ? !!_excelMaterialFolder : !!sheetNames.length;
        const driveTargetHint = driveMode
            ? (_excelDriveFileName
                ? ('已選檔案：' + _excelDriveFileName + '（可再複選同資料夾其他 meta）')
                : ('將套用到整個資料夾「' + _excelMaterialFolder + '」' + (driveSheets.length ? ('（' + driveSheets.length + ' 個 meta，不用再勾選）') : '')))
            : '';
        const afterSelectHtml = (selectedId || selectedName) ? (
            '<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #A7F3D0;">'
                + renderComboAssignBlockHtml(seg, selectedName)
                + '<div class="mlp-excel-sheets-area">' + (driveMode ? renderDriveSheetAreaHtml(seg) : renderSegmentSheetChecklistHtml(seg)) + '</div>'
                + (driveMode && driveTargetHint ? '<div style="font-size:0.76rem; color:#047857; font-weight:700; margin-bottom:8px;">' + esc(driveTargetHint) + '</div>' : '')
                + '<div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">'
                    + (driveMode ? '' : (
                        '<label style="font-size:0.78rem; font-weight:700; color:#334155;">行數起'
                            + '<input type="text" class="form-control mlp-excel-quickapply-rowstart" value="' + esc(seg.quickApplyRowStart || '2') + '" style="width:80px; padding:6px; margin-top:2px;">'
                        + '</label>'
                        + '<label style="font-size:0.78rem; font-weight:700; color:#334155;">行數末<span style="color:#94A3B8; font-weight:600;">（留空＝自動讀到最後一列）</span>'
                            + '<input type="text" class="form-control mlp-excel-quickapply-rowend" value="' + esc(seg.quickApplyRowEnd || '') + '" placeholder="例如 LAST(AB)" style="width:160px; padding:6px; margin-top:2px;">'
                        + '</label>'
                    ))
                    + '<button type="button" class="mlp-excel-quickapply-btn btn" style="padding:7px 16px; font-weight:800; background:#059669; color:white; border:1px solid #059669;" ' + (canConfirm ? '' : 'disabled') + '>'
                        + (driveMode ? '確認套用並寫入資料庫' : '🚀 產生 meta/script')
                    + '</button>'
                    + '<span class="mlp-excel-quickapply-msg" style="font-size:0.78rem; font-weight:800;"></span>'
                + '</div>'
                + (driveMode || sheetNames.length ? '' : '<div style="font-size:0.78rem; color:#B45309; margin-top:4px; font-weight:800;">請先勾選要套用的活頁，這顆按鈕才會變綠色可以按</div>')
            + '</div>'
        ) : '';
        return (
            '<div style="margin-bottom:10px; padding:12px; background:#ECFDF5; border:1px solid #6EE7B7; border-radius:8px;">'
                + '<div style="font-size:0.8rem; font-weight:800; color:#047857; margin-bottom:6px;">' + (driveMode ? '套用目前的試卷範本：選範本後確認並指派班級' : '套用目前的範本：先選範本，再決定套用角色，然後勾活頁') + '</div>'
                + '<label style="font-size:0.78rem; font-weight:700; color:#334155;">選一個範本'
                    + '<select class="form-control mlp-excel-quickapply-select" style="width:100%; max-width:640px; padding:6px; margin-top:2px;">' + buildApplyTemplateOptionsHtml(selectedId, selectedName) + '</select>'
                + '</label>'
                + afterSelectHtml
            + '</div>'
        );
    }

    function bindQuickApplyClassChecks(seg, rootEl) {
        if (!rootEl) return;
        rootEl.querySelectorAll('.mlp-excel-quickapply-class').forEach(function (chk) {
            chk.addEventListener('change', function () {
                if (!seg.quickApplyClassIds) seg.quickApplyClassIds = {};
                const id = this.getAttribute('data-class-id');
                if (this.checked) seg.quickApplyClassIds[id] = true;
                else delete seg.quickApplyClassIds[id];
            });
        });
    }

    function bindQuickApplyAreaEvents(seg, cardEl) {
        const selectEl = cardEl.querySelector('.mlp-excel-quickapply-select');
        if (selectEl) selectEl.addEventListener('change', function () {
            const tpl = findApplyTemplateByName(this.value);
            seg.quickApplyTemplateId = tpl ? tpl.id : this.value;
            seg.quickApplyTemplateName = tpl ? String(tpl.name || '').trim() : '';
            if (tpl && tpl.is_exam_role) seg.quickApplyRole = 'both';
            renderExcelSegments();
        });
        cardEl.querySelectorAll('.mlp-excel-quickapply-role').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (!this.checked) return;
                seg.quickApplyRole = this.value === 'both' ? 'both' : 'extraction';
            });
        });
        bindQuickApplyClassChecks(seg, cardEl);
        const rowStartEl = cardEl.querySelector('.mlp-excel-quickapply-rowstart');
        if (rowStartEl) rowStartEl.addEventListener('change', function () { seg.quickApplyRowStart = this.value.trim(); });
        const rowEndEl = cardEl.querySelector('.mlp-excel-quickapply-rowend');
        if (rowEndEl) rowEndEl.addEventListener('change', function () { seg.quickApplyRowEnd = this.value.trim(); });
        const btn = cardEl.querySelector('.mlp-excel-quickapply-btn');
        if (btn) btn.addEventListener('click', function () { handleApplyExistingTemplate(seg, cardEl); });
        refreshComboUsageForSeg(seg, cardEl);
    }

    function refreshComboUsageForSeg(seg, cardEl) {
        const box = cardEl.querySelector('.mlp-excel-combo-usage');
        const tpl = findApplyTemplateForSeg(seg) || findApplyTemplateByName(seg.quickApplyTemplateName || seg.name);
        if (!box || !tpl || !_excelMaterialFolder) return;
        if (!window.FeatureClassMaterialCombinations || typeof window.FeatureClassMaterialCombinations.lookupUsage !== 'function') return;
        window.FeatureClassMaterialCombinations.lookupUsage(_excelMaterialFolder, tpl.id).then(function (usage) {
            _comboUsageCache[comboUsageCacheKey(_excelMaterialFolder, tpl.id)] = usage;
            const liveBox = cardEl.querySelector('.mlp-excel-combo-usage');
            if (!liveBox) return;
            liveBox.innerHTML = renderComboUsageInnerHtml(seg, usage);
            bindQuickApplyClassChecks(seg, liveBox);
        }).catch(function () {});
    }

    /**
     * 🆕「設計新擷取範本」的可收合外框：已經有現成 Template 可用時預設收起（大部分情況只需要上面
     * 的快速套用），完全沒有任何 Template 時強制展開（不然老師無從下手，畫面上什麼工具都沒有）。
     */
    function renderDesignToggleHtml(seg) {
        const hasTemplates = getFieldTemplatesCachedSync().length > 0;
        const expanded = seg.designExpanded || !hasTemplates;
        return '<button type="button" class="mlp-excel-design-toggle-btn" style="background:none; border:none; padding:4px 0; color:#0F766E; font-weight:800; font-size:0.8rem; cursor:pointer;">'
            + (expanded ? '▾ ' : '▸ ') + '🆕 設計新擷取範本（現有的擷取範本都不適用，需要重新勾欄位設定時才需要）'
            + '</button>';
    }

    function bindDesignToggleEvents(seg, cardEl) {
        const btn = cardEl.querySelector('.mlp-excel-design-toggle-btn');
        if (btn) btn.addEventListener('click', function () {
            const hasTemplates = getFieldTemplatesCachedSync().length > 0;
            const expanded = seg.designExpanded || !hasTemplates;
            seg.designExpanded = !expanded;
            renderExcelSegments();
        });
    }

    /** 設計卡片橘色儲存用：用老師個人 01_My_Materials 底下的教材資料夾名稱拿到／建出 folderId */
    async function resolveOrCreateDesignFolderId(folderName) {
        const folder = String(folderName || '').trim();
        if (!folder) throw new Error('請先選「目的：Drive 教材資料夾」');
        let folderId = (window.FeatureExamJob && typeof window.FeatureExamJob.getFolderIdForFolder === 'function')
            ? window.FeatureExamJob.getFolderIdForFolder('', 'teacher', folder)
            : '';
        if (folderId) return folderId;
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.resolveMaterialsRootFolderId !== 'function') {
            throw new Error('FeatureTimeline 尚未載入，無法建立教材資料夾');
        }
        if (!window.GasService || typeof window.GasService.ensureMaterialFolder !== 'function') {
            throw new Error('GasService.ensureMaterialFolder 尚未載入');
        }
        const rootFolderId = await window.FeatureTimeline.resolveMaterialsRootFolderId('', 'teacher');
        const result = await window.GasService.ensureMaterialFolder(rootFolderId, '01_My_Materials', folder);
        if (!result || !result.folderId) throw new Error('無法建立或找到教材資料夾「' + folder + '」');
        return result.folderId;
    }

    /** 有上次預覽且行數起迄沒改就重用；否則用目前欄位對應重算（跟「產生 meta 預覽」同一套） */
    function generateMetaForDesignSheet(seg, sheetName) {
        if (seg.lastGen && seg.lastGen.sheetName === sheetName
            && Array.isArray(seg.lastGen.rows) && seg.lastGen.rows.length
            && String(seg.lastGen.rowStart || '') === String(seg.rowStart || '')
            && String(seg.lastGen.rowEnd || '') === String(seg.rowEnd || '')) {
            return { ok: true, rows: seg.lastGen.rows, scriptLines: seg.lastGen.scriptLines || [] };
        }
        const template = segToPreviewTemplate(seg);
        if (!template.columns.length) return { ok: false, error: '尚未設定任何欄位的資料項名稱' };
        const matrix = parseExcelSegmentMatrix(sheetName);
        return buildGenerationFromMatrix(matrix, template, seg.rowStart, seg.rowEnd, {});
    }

    /**
     * 雷區（2026-08-16 老師回報：橘色「儲存這個 Template」只寫 DB、不上傳 meta，
     * 圖二「套用為」選上或選下都必須存 meta——這以前修過又被改壞）。
     * 這一步跟 radio 無關：extraction／both 都上傳；both 另外由 persistApplyComboRecord 開試卷角色。
     */
    async function uploadDesignMetaForSegment(seg, templateName, folderName) {
        const sheetIds = Object.keys(seg.checkedSheets || {}).filter(function (k) { return seg.checkedSheets[k]; }).sort();
        if (!sheetIds.length) throw new Error('請先勾選活頁');
        if (!folderName) throw new Error('請先選「目的：Drive 教材資料夾」');
        if (!window.GasService || typeof window.GasService.uploadMaterialFile !== 'function') {
            throw new Error('GasService.uploadMaterialFile 尚未載入');
        }
        if (_metaPublishBusy) throw new Error('正在上傳，請等這次結束');
        _metaPublishBusy = true;
        try {
        const folderId = await resolveOrCreateDesignFolderId(folderName);
        const overwriteTargets = (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.listOverwriteTargets === 'function')
            ? await window.FeatureClassMaterialCombinations.listOverwriteTargets(folderName, null)
            : [];
        let existingFieldCount = null;
        let newFieldCount = null;
        let askedFieldCount = false;
        const uploaded = [];
        const stems = [];
        for (let i = 0; i < sheetIds.length; i++) {
            const sheetName = sheetIds[i];
            const result = generateMetaForDesignSheet(seg, sheetName);
            if (!result.ok) throw new Error(sheetName + '：' + (result.error || '產生失敗'));
            if (!result.rows || !result.rows.length) throw new Error(sheetName + '：產出 0 列，無法上傳');
            if (newFieldCount == null) newFieldCount = publicFieldCount(result.rows[0]);
            const hit = matchOverwriteTarget(sheetName, overwriteTargets);
            const names = hit
                ? { meta: hit.meta, script: hit.script || String(hit.stem || '').replace(/\.meta\.json$/i, '') + '.script.txt' }
                : defaultOutputNames(sheetName, templateName, folderName, sheetIds.length);
            if (hit && existingFieldCount == null) {
                existingFieldCount = await readExistingMetaFieldCount(folderId, folderName, names.meta);
            }
            if (!askedFieldCount && hit && existingFieldCount != null && newFieldCount != null && existingFieldCount !== newFieldCount) {
                askedFieldCount = true;
                if (!await confirmFieldCountMismatch(existingFieldCount, newFieldCount)) {
                    throw new Error('已取消上傳（欄位數不同）');
                }
            }
            const metaJson = JSON.stringify(result.rows, null, 2);
            const scriptTxt = (result.scriptLines || []).join('\n') + ((result.scriptLines && result.scriptLines.length) ? '\n' : '');
            const metaRes = await window.GasService.uploadMaterialFile(utf8ToBase64(metaJson), names.meta, 'application/json', folderId);
            const scriptRes = await window.GasService.uploadMaterialFile(utf8ToBase64(scriptTxt), names.script, 'text/plain', folderId);
            const finalMeta = (metaRes && metaRes.finalFileName) || names.meta;
            const finalScript = (scriptRes && scriptRes.finalFileName) || names.script;
            uploaded.push(finalMeta + '、' + finalScript);
            stems.push(stemFromMetaFileName(finalMeta));
            seg.lastGen = {
                sheetName: sheetName,
                rows: result.rows,
                scriptLines: result.scriptLines || [],
                rowStart: seg.rowStart,
                rowEnd: seg.rowEnd
            };
        }
        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            try {
                await window.FeatureTimeline.ensureMetaCatalog('', 'teacher', { force: true });
                refreshOverviewFolders();
            } catch (_e) { /* 上傳已成功，清單刷新失敗不擋 */ }
        }
        return { uploaded: uploaded, stems: stems };
        } finally {
            _metaPublishBusy = false;
        }
    }

    /**
     * 存成一筆獨立命名的 Template：名字是這筆記錄的識別鍵——同名＝覆蓋更新同一筆，不同名＝新增一筆。
     * 2026-08-16：橘色按鈕必須同時把 meta／script 上傳到 Drive（「套用為」選上或選下都要）。
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
        const rowStartEl = cardEl.querySelector('.mlp-excel-seg-rowstart');
        const rowEndEl = cardEl.querySelector('.mlp-excel-seg-rowend');
        if (rowStartEl) seg.rowStart = rowStartEl.value.trim();
        if (rowEndEl) seg.rowEnd = rowEndEl.value.trim();
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
            speak_mode: normalizeSpeakMode(seg.speakMode),
            speak_formula: seg.speakFormula || '',
            // designed_from：純資訊性的「設計參考」，跟能不能存無關，方便老師日後回頭核對這份
            // Template 是照哪個檔案設計的；沒有檔案／沒選資料夾／沒勾活頁也完全可以存
            designed_from: (materialFolder || _excelFileName || sheetIds.length)
                ? { material_folder: materialFolder, file_name: _excelFileName, sheet_ids: sheetIds }
                : null
        };
        record.columns.forEach(function (c) { rememberSemanticKey(c.semantic_key); });
        const btn = cardEl.querySelector('.mlp-excel-save-segment');
        if (btn) btn.disabled = true;
        if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
        try {
            // 💣 雷區（2026-08-15 老師回報「網頁延遲，範本意外被刪除」）：這裡以前是「抓整份清單→
            // 局部替換其中一筆→整份丟給 saveFieldTemplates 做差集刪除」，一旦 fetchFieldTemplates(true)
            // 因網路延遲／race 拿到不完整的清單，saveFieldTemplates 會把「清單裡沒出現」的其他範本全部
            // 當成「老師刪掉了」而砍掉角色（兩個角色都關掉還會真的軟刪除）。改成只針對「這一筆」直接
            // update／create，完全不去動其他任何範本的資料，徹底消除這整類誤刪風險。
            const templates = await fetchFieldTemplates(true);
            let existing = templates.find(function (t) { return String(t.name || '').trim() === name; });
            let overwroteDuplicate = null;
            // 名字一樣＝一定覆蓋（上面那行就抓到了，不用再問）。名字不同才檢查內容：
            // 若剛好跟某個既有範本內容完全相同，不要自動幫老師改名覆蓋（太隱性、老師看不到
            // 發生了什麼事）——跳出確認視窗，讓老師自己決定「這其實是同一份，蓋過去」還是
            // 「兩份本來就要分開存」，選否就照舊當新範本新增。
            if (!existing) {
                const sig = templateContentSignature(record);
                const dup = templates.find(function (t) { return templateContentSignature(t) === sig; }) || null;
                if (dup) {
                    const wantOverwrite = await window.ModalOverlay.confirm(
                        '這份欄位設定跟既有範本「' + dup.name + '」內容完全相同。\n\n'
                        + '按「確定」＝視為同一份，改名蓋過「' + dup.name + '」（原本套用它的班級／組合都會沿用）。\n'
                        + '按「取消」＝當成新的一筆分開存，不動「' + dup.name + '」。'
                    );
                    if (wantOverwrite) {
                        overwroteDuplicate = dup;
                        existing = dup;
                    }
                }
            }
            if (existing) {
                await window.FeatureTemplateLibrary.updateTemplate(existing.id, record);
                record.id = existing.id;
            } else {
                record.id = await window.FeatureTemplateLibrary.createTemplate(Object.assign({ is_extraction_role: true }, record));
            }
            await fetchFieldTemplates(true);
            const savedTpl = findApplyTemplateByName(name);
            if (_excelMaterialFolder && savedTpl) {
                const appRecord = {
                    id: 'mta_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    template_name: name,
                    template_id: savedTpl.id,
                    root_kind: 'teacher',
                    class_id: '',
                    material_folder: _excelMaterialFolder,
                    sheet_ids: sheetIds.slice(),
                    row_start: seg.rowStart || (seg.mapping && seg.mapping.rowStart) || '',
                    row_end: seg.rowEnd || (seg.mapping && seg.mapping.rowEnd) || '',
                    source_kind: isDriveSource() ? 'drive' : 'local',
                    source_file_name: isDriveSource() ? '' : (_excelFileName || '')
                };
                try {
                    await persistApplyComboRecord(seg, appRecord, savedTpl);
                    refreshComboUsageForSeg(seg, cardEl);
                    refreshTemplateUsageCache();
                } catch (comboErr) {
                    console.error('[FeatureMaterialLayoutPairing] 設計新範本後寫入組合失敗', comboErr);
                    if (msgEl) { msgEl.style.color = '#B45309'; msgEl.textContent = '✅ 範本已存，寫入班級組合失敗，仍繼續上傳 meta…'; }
                }
            }
            let uploadNote = '';
            if (_excelMaterialFolder && sheetIds.length) {
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 範本已存，正在上傳 meta／script 到 Drive…'; }
                try {
                    // 💣 雷區（2026-08-16）：這裡本來在上傳成功後又多寫一筆 source_kind:'drive'、
                    // source_file_name:'' 的組合紀錄，naturalAppKey 只看 root_kind/class_id/
                    // material_folder/template_id，跟上面第一筆（正確的 source_kind:'local'、
                    // source_file_name:_excelFileName）算成「同一組」，mergeAppRecordIntoList 又用
                    // 新記錄整批覆寫舊記錄的欄位——結果把剛剛正確寫好的「本機來源」紀錄覆寫成
                    // 「drive／空檔名」，usageExtractionHtml 判斷 sourceFile 空就直接跳過，
                    // 畫面因此變成「擷取範本：尚未套用到教材」（明明真的上傳成功了）。
                    // 上面第一筆已經記好本機來源＋原始活頁名，不需要也不能再多寫這一筆。
                    const up = await uploadDesignMetaForSegment(seg, name, _excelMaterialFolder);
                    uploadNote = '，並已上傳 Drive：' + up.uploaded.join('；');
                    refreshComboUsageForSeg(seg, cardEl);
                    refreshTemplateUsageCache();
                } catch (upErr) {
                    if (msgEl) {
                        msgEl.style.color = '#B45309';
                        msgEl.textContent = saveResultLead(existing, overwroteDuplicate, name) + '，但上傳 meta 失敗：' + (upErr.message || upErr);
                    }
                    window.showFlash && window.showFlash('範本已存，但上傳 meta 失敗：' + (upErr.message || upErr), 'error');
                    seg.savedOnce = true;
                    refreshAddSegmentButtonVisibility();
                    renderTemplateList();
                    refreshAppTemplateSelectOptions();
                    return;
                }
            } else if (!_excelMaterialFolder) {
                uploadNote = '。尚未選 Drive 教材資料夾，所以沒有上傳 meta';
            } else {
                uploadNote = '。尚未勾選活頁，所以沒有上傳 meta';
            }
            if (msgEl) {
                msgEl.style.color = '#059669';
                msgEl.textContent = saveResultLead(existing, overwroteDuplicate, name) + uploadNote;
            }
            window.showFlash && window.showFlash(
                uploadNote.indexOf('已上傳 Drive') >= 0
                    ? ('已儲存範本「' + name + '」並已上傳 meta')
                    : ('已儲存範本「' + name + '」' + uploadNote),
                uploadNote.indexOf('已上傳 Drive') >= 0 ? 'success' : 'error'
            );
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
    // 🧩擷取範本管理（獨立區塊，2026-08-05 第十三輪新增）
    //
    // 雷區（2026-08-05）：舊版「儲存好的 layout」只能透過 Excel 小工具的存檔動作間接看到，
    // 沒有選檔案／沒有活頁清單時整個清單是隱藏的，老師問「儲存好的 layout 如何叫出來，並修改」，
    // 答案是「叫不出來」——這是設計缺陷，不是操作問題。Template 本質是「規則」，跟任何檔案脫鉤，
    // 這個區塊永遠顯示（不需要選 Excel 檔案），提供完整的新增／編輯／刪除。
    // ------------------------------------------------------------------

    function openTemplateEditorForNew() {
        _templateEditorState = { id: null, isNew: true, name: '', columns: [], designed_from: null, answerMode: 'combine', answerCombineNote: '', speakMode: 'direct', speakFormula: '', linesPerPage: 10, fields: '', quizPrompt: '', isExtractionRole: true, isExamRole: false };
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
            speakMode: normalizeSpeakMode(t && t.speak_mode),
            speakFormula: (t && t.speak_formula) || '',
            // 2026-08-14（老師回報）：每頁行數本質是「擷取範本」自己的排版設定（只在輸出紙本考卷時
            // 才有意義，線上考試不受影響），不該只在勾了「考卷範本」角色時才看得到／改得到。若同一筆
            // 也勾了試卷角色，試卷那邊的公式框直接沿用這裡的值（同一個欄位，不是各自存一份、不用同步）。
            linesPerPage: (t && t.lines_per_page) || 10,
            // 2026-08-14（老師四次強調）：題目排版也是每個擷取範本本來就該有、老師能直接改的值，不是
            // 只有勾了考卷範本才算得出來的唯讀預覽——跟每頁行數一樣放在編輯表單裡，直接讀寫 fields 欄位。
            fields: String((t && t.fields) || ''),
            quizPrompt: String((t && t.quiz_prompt) || ''),
            // 2026-08-15（老師回報意外刪除事件後要求）：角色勾選（擷取範本／考卷範本）只在編輯表單
            // 裡才能改，不放在清單上，見 renderTemplateEditor() 的角色勾選那一行。
            isExtractionRole: t && t.is_extraction_role !== false,
            isExamRole: !!(t && t.is_exam_role)
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
        // 2026-08-14（老師回報）：設計參考（designed_from）純資訊性備忘，老師確認不需要顯示，拿掉。
        // 💣 雷區（2026-08-15 老師回報「網頁延遲，勾『考卷範本』結果把範本意外刪除了；這種勾選為什麼
        // 不是放在編輯裡面才能改」）：角色勾選（擷取範本／考卷範本）只在這個編輯表單裡才能改，不再放在
        // 上面清單那一列——編輯表單是老師主動點「✏️ 編輯」才會展開，不會在清單背景重繪時意外出現在
        // 滑鼠底下被誤觸。新增中（isNew）還沒有 id，角色只能等存檔後才能加開，這裡先不顯示考卷角色
        // 勾選；擷取角色對新範本必定是 true（存檔那一刻就會建立），不用讓老師選。
        const roleRowHtml = st.isNew
            ? '<div style="font-size:0.76rem; color:#64748B; margin-top:6px;">💡 新範本存檔後自動是「擷取範本」；要加開「試卷範本」角色，存檔後回到清單點「✏️ 編輯」即可。</div>'
            : '<div style="display:flex; align-items:center; gap:14px; margin-top:8px; flex-wrap:wrap;">'
                + '<label style="display:flex; align-items:center; gap:4px; font-size:0.78rem; font-weight:700; color:#6D28D9; white-space:nowrap; cursor:pointer;" title="取消勾選＝這筆不再當擷取範本。若同時還有試卷範本角色，只拿掉擷取角色，試卷那一側不受影響。">'
                    + '<input type="checkbox" id="mlp-tpl-role-extraction-cb" ' + (st.isExtractionRole !== false ? 'checked' : '') + '>擷取範本'
                + '</label>'
                + '<label style="display:flex; align-items:center; gap:4px; font-size:0.78rem; font-weight:700; color:#1D4ED8; white-space:nowrap; cursor:pointer;" title="勾選後這筆範本同時可以在出題畫面／班級教材組合的試卷範本清單被選用">'
                    + '<input type="checkbox" id="mlp-tpl-role-exam-cb" ' + (st.isExamRole ? 'checked' : '') + '>🧾 試卷範本'
                + '</label>'
                + '<span id="mlp-tpl-role-msg" style="font-size:0.76rem; font-weight:800;"></span>'
            + '</div>';
        wrap.innerHTML = `
            <div style="background:#F8FAFC; border:2px solid #C7D2FE; border-radius:10px; padding:14px; margin-bottom:14px;">
                <div style="font-size:0.85rem; font-weight:800; color:#4338CA; margin-bottom:8px;">${st.isNew ? '➕ 新增擷取範本' : '✏️ 編輯擷取範本'}</div>
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;">範本名稱
                        <input type="text" id="mlp-tpl-name" class="form-control" value="${esc(st.name)}" style="width:260px; padding:6px; margin-top:2px; display:block;" placeholder="幫這份 Template 取個名字">
                    </label>
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;" title="只影響把這份範本輸出成紙本考卷時一頁排幾行；線上考試不受影響">每頁行數
                        <input type="number" id="mlp-tpl-lines-per-page" class="form-control" min="1" value="${esc(st.linesPerPage || 10)}" style="width:80px; padding:6px; margin-top:2px; display:block;">
                    </label>
                </div>
                ${roleRowHtml}
                <div style="margin-top:12px;">
                    <div style="font-size:0.78rem; font-weight:800; color:#475569; margin-bottom:6px;">欄位設定（欄位代號自己打，可自由新增／刪除列）</div>
                    <div id="mlp-tpl-cols"></div>
                    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" id="mlp-tpl-add-col" class="btn" style="padding:5px 12px; font-size:0.78rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">＋ 新增欄位列</button>
                        <button type="button" id="mlp-tpl-clear-airef" class="btn" style="padding:5px 12px; font-size:0.78rem; font-weight:800; background:white; color:#6D28D9; border:1px solid #DDD6FE; border-radius:6px;">✕ 清除所有已選的口說答案欄（允許不指定）</button>
                    </div>
                </div>
                <div style="margin-top:10px; padding:10px 12px; border-radius:8px; border:1px solid ${st.isExamRole ? '#C7D2FE' : '#CBD5E1'}; background:${st.isExamRole ? '#F8FAFC' : '#F1F5F9'}; opacity:${st.isExamRole ? '1' : '0.55'}; pointer-events:${st.isExamRole ? 'auto' : 'none'};">
                    <div style="font-size:0.76rem; font-weight:800; color:${st.isExamRole ? '#4338CA' : '#94A3B8'}; margin-bottom:8px;">特殊排版${st.isExamRole ? '' : '（未勾試卷範本，不使用）'}</div>
                    <label style="display:block; font-size:0.78rem; font-weight:800; color:#475569;">訊息 特殊排版
                        <textarea id="mlp-tpl-fields" class="form-control" rows="2" style="width:100%; margin-top:2px; padding:6px; font-family:monospace; font-size:0.8rem;" placeholder="（預設空白）" ${st.isExamRole ? '' : 'disabled'}>${esc(st.fields || '')}</textarea>
                    </label>
                    <label style="display:block; font-size:0.78rem; font-weight:800; color:#475569; margin-top:10px;">題目 特殊排版
                        <textarea id="mlp-tpl-quiz-prompt" class="form-control" rows="2" style="width:100%; margin-top:2px; padding:6px; font-family:monospace; font-size:0.8rem;" placeholder="（預設空白）" ${st.isExamRole ? '' : 'disabled'}>${esc(st.quizPrompt || '')}</textarea>
                    </label>
                </div>
                <div class="mlp-tpl-answer-grading-wrap">${renderAnswerGradingSettingsHtml('mlp-tpl', st, countAnswerColsFromColumns(st.columns), templateExamGradingOpts(st))}</div>
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
                refreshAnswerGradingBlock(document.getElementById('mlp-template-editor'), 'mlp-tpl', _templateEditorState, countAnswerColsFromColumns(_templateEditorState.columns), templateExamGradingOpts(_templateEditorState));
            });
            const iEl = rowEl.querySelector('.mlp-tpl-col-info');
            if (iEl) iEl.addEventListener('change', function () { col.is_info = this.checked; });
            // 🎤 口說答案：checkbox＝可複選（老師 2026-08-08 再次明確強調不能互斥）。
            // 只切換自己這一欄，不動其他列的 is_ai_ref（跟 Excel 小工具同一份邏輯）。
            const airefEl = rowEl.querySelector('.mlp-tpl-col-airef');
            if (airefEl) airefEl.addEventListener('change', function () {
                col.is_ai_ref = this.checked;
                refreshAnswerGradingBlock(document.getElementById('mlp-template-editor'), 'mlp-tpl', _templateEditorState, countAnswerColsFromColumns(_templateEditorState.columns), templateExamGradingOpts(_templateEditorState));
            });
            const removeBtn = rowEl.querySelector('.mlp-tpl-col-remove');
            if (removeBtn) removeBtn.addEventListener('click', function () {
                _templateEditorState.columns.splice(idx, 1);
                renderTemplateEditorCols();
                refreshAnswerGradingBlock(document.getElementById('mlp-template-editor'), 'mlp-tpl', _templateEditorState, countAnswerColsFromColumns(_templateEditorState.columns), templateExamGradingOpts(_templateEditorState));
            });
        });
    }

    function bindTemplateEditorEvents() {
        const nameEl = document.getElementById('mlp-tpl-name');
        if (nameEl) nameEl.addEventListener('change', function () { _templateEditorState.name = this.value.trim(); });
        const lppEl = document.getElementById('mlp-tpl-lines-per-page');
        if (lppEl) lppEl.addEventListener('change', function () { _templateEditorState.linesPerPage = parseInt(this.value, 10) || 10; });
        const fieldsEl = document.getElementById('mlp-tpl-fields');
        if (fieldsEl) fieldsEl.addEventListener('change', function () { _templateEditorState.fields = this.value; });
        const quizPromptEl = document.getElementById('mlp-tpl-quiz-prompt');
        if (quizPromptEl) quizPromptEl.addEventListener('change', function () { _templateEditorState.quizPrompt = this.value; });
        const addColBtn = document.getElementById('mlp-tpl-add-col');
        if (addColBtn) addColBtn.addEventListener('click', function () {
            _templateEditorState.columns.push({ letter: '', semantic_key: '', is_question: false, is_answer: false, is_info: false, is_ai_ref: false });
            renderTemplateEditorCols();
        });
        const clearAirefBtn = document.getElementById('mlp-tpl-clear-airef');
        if (clearAirefBtn) clearAirefBtn.addEventListener('click', function () {
            _templateEditorState.columns.forEach(function (c) { c.is_ai_ref = false; });
            renderTemplateEditorCols();
            refreshAnswerGradingBlock(document.getElementById('mlp-template-editor'), 'mlp-tpl', _templateEditorState, countAnswerColsFromColumns(_templateEditorState.columns), templateExamGradingOpts(_templateEditorState));
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
        bindTemplateEditorRoleEvents();
    }

    /**
     * 角色勾選（擷取範本／考卷範本）——2026-08-15 搬進編輯表單；2026-08-15 老師再要求
     * 「擷取範本也要能取消勾選」，不再鎖死。
     * 勾選＝加開角色；取消勾選＝關掉那個角色（先 confirm）。只針對這一筆 addRole／removeRole，
     * 不做整份清單差集。取消擷取角色後，這一筆會離開上面擷取清單；若還有考卷角色，整筆不會刪，
     * 仍留在試卷範本清單。兩個角色都關掉才會軟刪除。
     */
    function bindTemplateEditorRoleEvents() {
        bindOneTemplateEditorRoleCheckbox('mlp-tpl-role-extraction-cb', 'extraction');
        bindOneTemplateEditorRoleCheckbox('mlp-tpl-role-exam-cb', 'exam');
    }

    function bindOneTemplateEditorRoleCheckbox(elId, role) {
        const cb = document.getElementById(elId);
        if (!cb) return;
        cb.addEventListener('change', async function () {
            const st = _templateEditorState;
            if (!st || !st.id) return;
            const roleLabel = role === 'extraction' ? '擷取範本' : '試卷範本';
            const keepOther = role === 'extraction' ? !!st.isExamRole : (st.isExtractionRole !== false);
            cb.disabled = true;
            let flashText = '';
            let leftExtractionList = false;
            try {
                if (cb.checked) {
                    await window.FeatureTemplateLibrary.addRole(st.id, role);
                    if (role === 'exam') st.isExamRole = true;
                    else st.isExtractionRole = true;
                    flashText = '✅ 已加開' + roleLabel + '角色';
                } else {
                    const confirmText = !keepOther
                        ? ('這筆目前沒有另一個角色，取消「' + roleLabel + '」等於刪除整筆。確定嗎？已套用到教材產生的 meta.json／script.txt 不會自動跟著刪除。')
                        : (role === 'extraction'
                            ? '確定要把這筆從擷取範本移除嗎？試卷範本角色不受影響，之後仍可在試卷範本清單看到。'
                            : '確定要取消這筆範本的「試卷範本」角色嗎？若沒有其他地方在用，考題排版公式會一併清除。擷取範本那一側不受影響。');
                    if (!(await window.ModalOverlay.confirm(confirmText))) {
                        cb.checked = true;
                        cb.disabled = false;
                        return;
                    }
                    await window.FeatureTemplateLibrary.removeRole(st.id, role);
                    if (role === 'exam') st.isExamRole = false;
                    else {
                        st.isExtractionRole = false;
                        leftExtractionList = true;
                    }
                    flashText = '已取消' + roleLabel + '角色';
                }
                await fetchFieldTemplates(true);
                if (window.FeatureExamTemplateEditor && typeof window.FeatureExamTemplateEditor.render === 'function') {
                    window.FeatureExamTemplateEditor.render();
                }
                if (leftExtractionList) {
                    _templateEditorState = null;
                    renderTemplateEditor();
                    renderTemplateList();
                    refreshAppTemplateSelectOptions();
                    window.showFlash && window.showFlash(keepOther
                        ? '已從擷取範本移除，試卷範本角色仍保留'
                        : '已刪除 Template「' + (st.name || '') + '」');
                    return;
                }
                const fresh = getFieldTemplatesCachedSync().find(function (x) { return x.id === st.id; });
                if (fresh) st.fields = fresh.fields || '';
                renderTemplateEditor();
                const freshMsgEl = document.getElementById('mlp-tpl-role-msg');
                if (freshMsgEl) { freshMsgEl.style.color = '#0F766E'; freshMsgEl.textContent = flashText; }
                renderTemplateList();
            } catch (err) {
                cb.checked = !cb.checked;
                cb.disabled = false;
                window.alert('更新失敗：' + (err.message || err));
            }
        });
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
            speak_mode: normalizeSpeakMode(st.speakMode),
            speak_formula: st.speakFormula || '',
            lines_per_page: parseInt(st.linesPerPage, 10) || 10,
            fields: st.fields || '',
            quiz_prompt: st.quizPrompt || ''
        };
        record.columns.forEach(function (c) { rememberSemanticKey(c.semantic_key); });
        const saveBtn = document.getElementById('mlp-tpl-save');
        if (saveBtn) saveBtn.disabled = true;
        if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
        try {
            // 💣 雷區（2026-08-15 老師回報「網頁延遲，範本意外被刪除」）：以前這裡也是「抓整份清單→
            // 局部替換→整份丟給 saveFieldTemplates 做差集刪除」，fetchFieldTemplates(true) 一旦因網路
            // 延遲拿到不完整的清單，其他範本會被 saveFieldTemplates 誤判成「老師刪掉了」而砍角色／
            // 軟刪除。改成只對「這一筆」直接 update／create，不去比對、不去動任何其他範本。
            const templates = await fetchFieldTemplates(true);
            const existing = st.id
                ? templates.find(function (t) { return t.id === st.id; })
                : templates.find(function (t) { return String(t.name || '').trim() === name; });
            if (existing) {
                await window.FeatureTemplateLibrary.updateTemplate(existing.id, record);
                record.id = existing.id;
            } else {
                record.id = await window.FeatureTemplateLibrary.createTemplate(Object.assign({ is_extraction_role: true }, record));
            }
            await fetchFieldTemplates(true);
            window.showFlash && window.showFlash((existing ? '已覆蓋更新' : '已新增') + ' Template「' + name + '」');
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
        if (!(await window.ModalOverlay.confirm('確定要刪除擷取範本「' + (t ? t.name : '') + '」嗎？此動作無法復原（已套用到教材產生的 meta.json／script.txt 檔案不會自動跟著刪除）。'))) return;
        try {
            // 💣 雷區（2026-08-15 老師回報「網頁延遲，範本意外被刪除」）：以前是「抓整份清單→濾掉這一筆
            // →整份丟給 saveFieldTemplates 做差集刪除」，fetchFieldTemplates(true) 一旦因網路延遲拿到
            // 不完整的清單，其他範本也會被一起判定成「不在清單裡」而遭砍。改成只針對這一筆呼叫角色感知
            // 的 removeRole，不去比對、不去動任何其他範本的資料。
            await window.FeatureTemplateLibrary.removeRole(id, 'extraction');
            await fetchFieldTemplates(true);
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
            wrap.innerHTML = '<div style="font-size:0.8rem; color:#94A3B8; padding:8px 0;">尚未建立任何擷取範本，按上面「新增範本」開始，或用下面「從本機 Excel 讀取活頁／欄位」小工具設計。</div>';
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
                // 允許整批留空——沒有指定這欄不再擋「產生 meta/script」，只是 script.txt 會整份留白。
                // 2026-08-14（版面調整）：口說答案欄數併進「共 N 欄」那一行的統計裡，這裡只負責
                // 口說批改模式那一行——有勾口說答案才談得上批改模式，沒有就顯示「尚無」。
                const speakModeLabel = airefCols.length
                    ? (({ direct: '比對口說答案', formula: '公式', complex: '複雜規則', paste: '貼上多筆' }[t.speak_mode] || '比對口說答案') + '（取欄：' + airefCols.map(function (c) { return esc(c.semantic_key || c.letter); }).join('、') + '）')
                    : '尚無';
                // 2026-08-14（老師回報）：「設計參考」只是純資訊性備忘（見 designed_from 定義），
                // 老師確認不需要在清單裡佔一行，拿掉，不用維護跟不影響套用的資訊。
                // 2026-08-06 修正：正在被上方編輯器編輯的那一筆，下面清單不該「照常顯示」（看起來像
                // 另一份獨立、可再點編輯/刪除的資料），要 highlight＋標「編輯中」，編輯/刪除按鈕停用，
                // 避免老師誤以為清單那一筆跟編輯器裡是兩份不同的東西、或誤按導致跟編輯器內容打架
                const isBeingEdited = !!(_templateEditorState && !_templateEditorState.isNew && _templateEditorState.id === t.id);
                const liStyle = isBeingEdited
                    ? 'background:#FEF3C7; border:2px solid #F59E0B; border-radius:6px; padding:8px 10px; margin-bottom:6px;'
                    : 'background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px; margin-bottom:6px;';
                const actionsHtml = isBeingEdited
                    ? '<span style="padding:3px 10px; font-size:0.74rem; font-weight:800; border-radius:4px; background:#F59E0B; color:white;">✏️ 編輯中…</span>'
                    : '<button type="button" class="mlp-tpl-edit-btn" data-id="' + esc(t.id) + '" style="padding:3px 10px; font-size:0.74rem; font-weight:800; border:1px solid #93C5FD; border-radius:4px; background:#EFF6FF; color:#1D4ED8; cursor:pointer;">✏️ 編輯</button>'
                        + '<button type="button" class="mlp-tpl-duplicate-btn" data-id="' + esc(t.id) + '" style="padding:3px 10px; font-size:0.74rem; font-weight:800; border:1px solid #C4B5FD; border-radius:4px; background:#F5F3FF; color:#6D28D9; cursor:pointer;">📋 複製</button>'
                        + '<button type="button" class="mlp-tpl-delete-btn" data-id="' + esc(t.id) + '" style="padding:3px 10px; font-size:0.74rem; font-weight:800; border:1px solid #FCA5A5; border-radius:4px; background:white; color:#B91C1C; cursor:pointer;">🗑️ 刪除</button>';
                // 💣 雷區（2026-08-14 老師回報排版問題）：row1 用 flex-wrap:nowrap，左側名稱＋兩個
                // 角色勾選框用 ellipsis 截斷、絕不換行；右側動作按鈕 flex-shrink:0，永遠固定在最右邊，
                // 不會因為名稱太長被擠到下一行。欄位統計／批改模式都搬到 row1 下面各自獨立一行。
                const idx = templates.indexOf(t);
                const moveUpDisabled = (isBeingEdited || idx === 0) ? ' disabled' : '';
                const moveDownDisabled = (isBeingEdited || idx === templates.length - 1) ? ' disabled' : '';
                const moveBtnStyle = 'padding:0 5px; font-size:0.7rem; line-height:1.3; border:1px solid #CBD5E1; border-radius:3px; background:white; color:#475569; cursor:pointer;';
                const moveBtnsHtml = '<div style="display:flex; flex-direction:column; gap:2px; flex-shrink:0;">'
                    + '<button type="button" class="mlp-tpl-move-up-btn" data-id="' + esc(t.id) + '" style="' + moveBtnStyle + '"' + moveUpDisabled + ' title="往上移">▲</button>'
                    + '<button type="button" class="mlp-tpl-move-down-btn" data-id="' + esc(t.id) + '" style="' + moveBtnStyle + '"' + moveDownDisabled + ' title="往下移">▼</button>'
                    + '</div>';
                // 💣 雷區（2026-08-15 老師回報「網頁延遲，勾『考卷範本』結果把範本意外刪除了；
                // 這種勾選為什麼不是放在編輯裡面才能改」）：這兩個角色勾選框以前直接放在清單裡，
                // 每次角色變動都會觸發整份清單重繪（renderTemplateList），清單重繪的同時老師手上
                // 可能還在跟畫面互動（滑鼠位置、下一個點擊），遇到網路延遲時很容易在重繪過程中誤點
                // 到旁邊的按鈕（例如剛好换到「🗑️ 刪除」底下）。改成純文字徽章（不可點擊、不會觸發任何
                // 動作），角色只能到「✏️ 編輯」表單裡面改——編輯表單是老師主動點進去才會出現，不會在
                // 清單重繪時意外出現在滑鼠底下，從根本上降低誤觸機率。
                const extractionBadgeHtml = '<span style="display:inline-flex; align-items:center; padding:1px 8px; font-size:0.74rem; font-weight:800; color:#6D28D9; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:10px; white-space:nowrap; flex-shrink:0;">擷取範本</span>';
                const examBadgeHtml = t.is_exam_role
                    ? '<span style="display:inline-flex; align-items:center; padding:1px 8px; font-size:0.74rem; font-weight:800; color:#1D4ED8; background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px; white-space:nowrap; flex-shrink:0;">🧾 試卷範本</span>'
                    : '<span style="display:inline-flex; align-items:center; padding:1px 8px; font-size:0.74rem; font-weight:700; color:#94A3B8; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; white-space:nowrap; flex-shrink:0;">未開放試卷範本</span>';
                const row1 = '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:nowrap;">'
                    + '<div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1 1 auto; overflow:hidden;">'
                        + moveBtnsHtml
                        + '<strong style="font-size:1.02rem; font-weight:900; color:#1E293B; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:1;" title="' + esc(t.name || '（未命名）') + '">' + esc(t.name || '（未命名）') + '</strong>'
                        + extractionBadgeHtml
                        + examBadgeHtml
                    + '</div>'
                    + '<div style="display:flex; gap:6px; flex-shrink:0; white-space:nowrap;">' + actionsHtml + '</div>'
                    + '</div>';
                // 2026-08-14（老師回報：圖二那一行「沒存在必要」，直接刪除）：正在編輯的這一筆，
                // 上面編輯表單已經完整展開（名稱／角色勾選／欄位設定／書寫批改／口說批改都在那裡），
                // 下面清單完全不再顯示這一筆的任何摘要（連 row1 都不留），避免同一份資料兩處重複、
                // 老師誤以為清單那一筆跟編輯器是兩份不同東西。
                if (isBeingEdited) {
                    return '';
                }
                const row2 = '<div style="font-size:0.8rem; color:#334155; margin-top:4px;">共 ' + cols.length + ' 欄（題目 ' + qCount + '／書寫答案 ' + aCount + '／訊息 ' + iCount + '／口說答案 ' + airefCols.length + '）｜每頁 ' + esc(t.lines_per_page || 10) + ' 行（紙本用）' + '</div>';
                // 2026-08-14（老師四次強調）：題目排版跟書寫批改／口說批改同階層、同一種列樣式，順序
                // 排在書寫批改上面；每一筆擷取範本都要有這一行，且是真的存在 fields 欄位裡、老師到上面
                // 「✏️ 編輯」表單就能直接改的值（跟每頁行數同一個位置），不是只有勾考卷範本才算得出來的
                // 唯讀預覽——老師明確要求「不要有只能系統算、老師不能改」的內容。
                const examOn = !!t.is_exam_role;
                const announceColor = examOn ? '#334155' : '#94A3B8';
                const announceLine = function (label, value) {
                    return '<div style="font-size:0.8rem; color:' + announceColor + '; margin-top:2px;">' + label + '：' + esc(value) + '</div>';
                };
                const rowFields = announceLine('訊息 特殊排版', t.fields || '尚無');
                const rowQuiz = announceLine('題目 特殊排版', t.quiz_prompt || '尚無');
                const row3 = announceLine('書寫 批改標準', aCount > 1 ? (t.answer_mode === 'separate' ? '分開比對' : '結合') : '—（書寫答案欄數≤1）');
                const row4 = announceLine('口說 批改標準', speakModeLabel);
                const rowUsage = templateUsageHtml(t);
                return '<li data-id="' + esc(t.id) + '" style="' + liStyle + '">'
                    + row1 + row2 + rowFields + rowQuiz + row3 + row4 + rowUsage
                    + '</li>';
            }).join('')
            + '</ul>';
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.bindUsageSheetToggles === 'function') {
            window.FeatureClassMaterialCombinations.bindUsageSheetToggles(wrap);
        }
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
        wrap.querySelectorAll('.mlp-tpl-move-up-btn, .mlp-tpl-move-down-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const direction = btn.classList.contains('mlp-tpl-move-up-btn') ? 'up' : 'down';
                btn.disabled = true;
                try {
                    await window.FeatureTemplateLibrary.moveTemplateInVisibleList(btn.getAttribute('data-id'), direction, templates);
                    await fetchFieldTemplates(true);
                    renderTemplateList();
                    if (window.FeatureExamTemplateEditor && typeof window.FeatureExamTemplateEditor.render === 'function') {
                        window.FeatureExamTemplateEditor.render();
                    }
                } catch (err) {
                    window.alert('調整順序失敗：' + (err.message || err));
                    btn.disabled = false;
                }
            });
        });
        // Template 清單本身有變動（新增／編輯／刪除／複製／背景重抓）都順手同步一次總覽卡片，
        // 不用在每個呼叫點各自補一行——renderTemplateList() 是所有變動路徑的共同終點。
        // 「已配對好的組合」卡片的 Template 名稱是即時用 template_id 查目前名字（見
        // resolveTemplateDisplayInfo），改名／刪除後也要一起補畫，否則畫面停在改名前的舊 render，
        // 老師要手動整頁重新整理才看得到新名字（2026-08-13 老師回報的連動問題）。
        refreshOverviewTemplates();
        refreshOverviewApps();
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
            speakMode: normalizeSpeakMode(t && t.speak_mode),
            speakFormula: (t && t.speak_formula) || ''
        };
        renderTemplateEditor();
        renderTemplateList();
        const editorEl = document.getElementById('mlp-template-editor');
        if (editorEl && typeof editorEl.scrollIntoView === 'function') editorEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.showFlash && window.showFlash('已複製「' + (t.name || '') + '」，確認欄位設定後請記得按「儲存」');
    }

    // ------------------------------------------------------------------
    // 📎 套用到教材（擷取範本↔ 實際檔案，2026-08-05 第十三輪新增）
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
    // 勾選的活頁，依擷取範本的欄位對應算出 meta.json（array of {semantic_key: value}，
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
     * 💣 雷區（2026-08-15 老師回報「範本設定 D 欄，抓到的卻是 E 欄的值，整批欄位代號都對不上」）：
     * XLSX.utils.sheet_to_json(sheet, {header:1}) 預設用 sheet['!ref']（活頁「使用範圍」）決定
     * 回傳陣列的起點——如果活頁最左邊幾欄（例如 A 欄）整欄完全沒有任何資料，Excel／Google Sheets
     * 匯出時記錄的使用範圍會直接從第一個「有資料」的欄開始（例如從 B 欄開始），這時
     * matrix[r][0] 對應到的其實是 B 欄，不是 A 欄！但範本欄位代號（colLetterToIndex0）永遠假設
     * A=index0，於是設 D 欄實際讀到 E 欄、設 E 讀到 F、設 C 讀到 D……全部欄位代號一致地錯位一格
     * （或更多格，視留空幾欄），滲進 meta.json 變成完全錯誤的資料，而且不會報錯，因為每一欄依然
     * 有讀到「某個值」，只是讀到隔壁欄。
     * parseSheetColumns()（給老師勾選欄位用的清單）是用 encode_col(c) 算真實絕對欄位代號，不會有
     * 這個問題；只有這裡「真的把整張表轉成陣列」時才會對不上。修法：拿到 sheet 後，強制把要轉換
     * 的範圍起點釘回第 0 欄（A）、第 0 列，讓陣列 index 永遠跟老師畫面上看到的欄位代號一致。
     */
    function sheetToMatrixFromColumnA(sheet) {
        if (!sheet) return null;
        try {
            let range = sheet['!ref'] ? window.XLSX.utils.decode_range(sheet['!ref']) : null;
            if (range && (range.s.c > 0 || range.s.r > 0)) {
                range.s.c = 0;
                range.s.r = 0;
                return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true, range: range });
            }
            return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
        } catch (_e) {
            return null;
        }
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
                matrix = sheetToMatrixFromColumnA(sheet);
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
    function buildGenerationForSheet(appId, sheetName, template, rowStartStr, rowEndStr, overrides, answerOverrides) {
        const matrix = parseAppSheetMatrix(appId, sheetName);
        return buildGenerationFromMatrix(matrix, template, rowStartStr, rowEndStr, overrides, answerOverrides);
    }

    /**
     * 核心生成邏輯：給矩陣（不管來自哪個 appId／哪個本機檔案）＋ template ＋ 行數起迄，算出
     * meta.json rows／script.txt 行。「套用到教材」（buildGenerationForSheet）跟「設計 Template」
     * 卡片內的即時預覽（segment 用 parseExcelSegmentMatrix 取矩陣）共用這一份，避免兩邊各寫一次、
     * 之後改邏輯又要改兩處、漏改一處。
     */
    function buildGenerationFromMatrix(matrix, template, rowStartStr, rowEndStr, overrides, answerOverrides) {
        if (!matrix || !matrix.length) {
            return { ok: false, error: '找不到活頁資料或活頁是空的，請確認本機 Excel 檔案已選擇、活頁名稱正確' };
        }
        const cols = Array.isArray(template && template.columns) ? template.columns : [];
        const airefCols = cols.filter(function (c) { return c && c.is_ai_ref && c.letter && c.semantic_key; });
        const answerCols = cols.filter(function (c) { return c && c.is_answer && c.letter && c.semantic_key; });
        const aCount = answerCols.length;
        const answerMode = template && template.answer_mode === 'separate' ? 'separate' : 'combine';
        const answerCombineNote = (template && template.answer_combine_note) || '';
        const speakMode = normalizeSpeakMode(template && template.speak_mode);
        const speakFormula = (template && template.speak_formula) || '';
        const fieldMap = cols.filter(function (c) { return c && c.letter && c.semantic_key; }).map(function (c) {
            return { key: c.semantic_key, idx: colLetterToIndex0(c.letter), letter: String(c.letter).toUpperCase() };
        }).filter(function (f) { return f.idx >= 0; });
        /** page／item_no／vBK_name 即使這一格是空的也要留下 key——開頭文法定義列常沒頁碼，
         * 若整列省略 page，讀取可用題若只看第一列會誤判「這個 meta 沒有 page 欄」。 */
        const META_ALWAYS_KEYS = { page: true, item_no: true, vBK_name: true, sheet_id: true };
        if (!fieldMap.length) return { ok: false, error: 'Template 沒有任何有效的欄位對應（欄位代號或資料項名稱缺漏）' };
        // 給公式引擎相容用：欄位代號（大寫）→ 資料項名稱，讓「AN&" "&AO」這種寫法也能算
        const letterToSemantic = {};
        fieldMap.forEach(function (f) { letterToSemantic[f.letter] = f.key; });
        const overrideMap = overrides || {};
        const answerOverrideMap = answerOverrides || {};

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
        const answerComputed = [];
        const warnings = [];
        let formulaWarned = false;
        let missingAiRefCount = 0;
        let formulaErrorWarned = false;
        let answerFormulaErrorWarned = false;
        for (let r = rowStart; r <= rowEnd; r++) {
            const rowArr = matrix[r - 1] || [];
            const rowObj = {};
            let hasAnyValue = false;
            fieldMap.forEach(function (f) {
                let v = rowArr[f.idx];
                if (typeof v === 'string' && v.trim().charAt(0) === '=') {
                    if (!formulaWarned) {
                        warnings.push('⚠️ 偵測到尚未計算出結果的公式字串（例如第 ' + r + ' 列 ' + f.letter + '→' + f.key + '）——請先在 Excel 打開並存檔一次讓公式結果被快取。');
                        formulaWarned = true;
                    }
                    rowObj[f.key] = '';
                    return;
                }
                if (v === null || v === undefined) {
                    rowObj[f.key] = '';
                    return;
                }
                rowObj[f.key] = v;
                if (String(v).trim() !== '') hasAnyValue = true;
            });
            if (!hasAnyValue) continue;

            if (aCount > 1) {
                rowObj._answer_mode = answerMode;
                rowObj._answer_keys = answerCols.map(function (c) { return c.semantic_key; });

                /**
                 * 💣 雷區（2026-08-11 老師回報「書寫答案結合沒有按照 layout 設定執行，例如
                 * AN&" "&AO」）：以前完全沒有執行過 answer_combine_note，批改時
                 * quiz-paper-builder.js 只能自己用固定空白 join 猜，公式跟「跳過空欄」的行為
                 * 常常對不上。這裡在產生 meta 的當下把公式真的算一次，結果存進
                 * rowObj._answer_combined_text，批改時直接讀這個值，不用再猜、也不用擔心
                 * 公式跟猜測結果不一致。
                 */
                if (answerMode === 'combine') {
                    let answerCandidate = '';
                    if (answerCombineNote && window.LayoutFieldsEval) {
                        try {
                            const aCells = window.LayoutFieldsEval.evaluateFields(answerCombineNote, rowObj, letterToSemantic);
                            answerCandidate = (aCells && aCells[0] && aCells[0].text != null) ? String(aCells[0].text) : '';
                        } catch (_ae) {
                            answerCandidate = '';
                            if (!answerFormulaErrorWarned) {
                                warnings.push('⚠️ 書寫答案結合公式「' + answerCombineNote + '」計算失敗（例如第 ' + r + ' 列），這幾列先用「跳過空欄、空白接起來」頂著，請確認公式或在下方逐列修正。');
                                answerFormulaErrorWarned = true;
                            }
                        }
                    }
                    if (!answerCandidate) {
                        // 沒填公式、或公式算出空值時的安全預設：跳過空欄，其餘用空白接起來
                        // （語意等同 TEXTJOIN(" ", ...)，跟舊版行為一致，不是新的破壞性改動）
                        answerCandidate = answerCols.map(function (c) { return rowObj[c.semantic_key]; })
                            .filter(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; })
                            .map(function (v) { return String(v).trim(); })
                            .join(' ');
                    }
                    const answerOverride = answerOverrideMap[r];
                    const finalAnswer = (answerOverride !== null && answerOverride !== undefined) ? String(answerOverride) : answerCandidate;
                    rowObj._answer_combined_text = finalAnswer;
                    answerComputed.push(answerCandidate);
                } else {
                    answerComputed.push('');
                }
            } else {
                answerComputed.push('');
            }

            /**
             * 💣 雷區（2026-08-13 老師要求：可接受答案的白名單展開，不能只等到「產生線上考卷」
             * 或批改當下才動態算，必須在 meta 建立當下就先展開好、直接存進 meta.json）：
             * 跟上面 _answer_combined_text 同一個道理——這題的「另外可行答案」在產生 meta 這一刻
             * 就用中央白名單（QuizPaperBuilder.equivalentAcceptedSeed，例如 I am ↔ I'm）算好、
             * 凍結進 rowObj._accepted_answers（separate 模式則逐欄存進
             * rowObj._accepted_answers_by_key），任何之後讀這份 meta 的地方都能直接拿到現成結果，
             * 不用各自重兜白名單邏輯，也不會因為沒有走過 quiz-paper-builder.js 的 buildItemFromRow
             * 就漏了這一步。QuizPaperBuilder 理論上一定比這支檔案先載入（見 teacher/index.html
             * script 順序），拿不到才整段跳過，不讓這個防呆功能反而讓產生 meta 掛掉。
             */
            const seedFn = window.QuizPaperBuilder && window.QuizPaperBuilder.equivalentAcceptedSeed;
            if (typeof seedFn === 'function') {
                if (aCount > 1 && answerMode === 'separate') {
                    const byKey = {};
                    answerCols.forEach(function (c) {
                        const raw = rowObj[c.semantic_key];
                        if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
                            const variants = seedFn(String(raw).trim());
                            if (variants.length) byKey[c.semantic_key] = variants;
                        }
                    });
                    if (Object.keys(byKey).length) rowObj._accepted_answers_by_key = byKey;
                } else {
                    const mainAnswer = (aCount > 1 && answerMode === 'combine')
                        ? rowObj._answer_combined_text
                        : (answerCols[0] ? rowObj[answerCols[0].semantic_key] : null);
                    if (mainAnswer !== null && mainAnswer !== undefined && String(mainAnswer).trim() !== '') {
                        const variants = seedFn(String(mainAnswer).trim());
                        if (variants.length) rowObj._accepted_answers = variants;
                    }
                }
            }

            // 候選口說答案值：
            //   direct（最基本）＝直接取已勾的口說答案欄（1 欄原值、多欄空白串接）
            //   formula＝書寫答案>1 且有公式時用公式；否則退回跟 direct 一樣
            //   complex／paste＝書寫答案>1 時先留白，交給老師逐列修正／貼上
            let candidate = '';
            if (speakMode === 'direct') {
                if (airefCols.length > 1) {
                    candidate = airefCols.map(function (c) { return rowObj[c.semantic_key]; })
                        .filter(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; })
                        .map(function (v) { return String(v).trim(); })
                        .join(' ');
                } else {
                    const airefVal = airefCols[0] ? rowObj[airefCols[0].semantic_key] : null;
                    candidate = (airefVal !== null && airefVal !== undefined) ? String(airefVal).trim() : '';
                }
            } else if (aCount > 1 && speakMode === 'formula' && speakFormula && window.LayoutFieldsEval) {
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
            // 💣 雷區（2026-08-14 老師回報「打開 meta，answer_en 沒有內容」）：這裡的守門條件寫的是
            // airefCols.length===1（口說答案欄「數量」剛好 1 欄），但上面這段註解真正要擋的是
            // 「這欄同時兼任書寫答案（aCount>1 的其中一欄）」──兩者不是同一件事！本案例書寫答案有
            // 3 欄（blank_1／blank_2／answer_en，aCount=3、_answer_mode='separate'），口說答案只勾了
            // answer_en 這一欄（airefCols.length===1）。speakMode 是 complex／paste 時 candidate 故意
            // 留白等老師逐列填，若老師還沒填該列的口說答案覆寫值，finalSpeak 就是空字串——舊條件仍然
            // 成立，直接把這欄「書寫答案」的原始值（來源 Excel 的完整句子）覆寫成空字串，
            // meta.json 打開來 answer_en 就變成 ""，跟原始 Excel 內容對不起來。
            // 修法：只有這欄「不是」aCount>1 時的其中一個書寫答案欄，才允許覆寫回自己的 semantic_key；
            // 兼任書寫答案時，口說答案的最終值只寫進 scriptLines／script.txt，不動 rowObj 裡的書寫答案原值。
            const airefIsAlsoMultiAnswerCol = aCount > 1 && airefCols[0] && !!airefCols[0].is_answer;
            if (airefCols.length === 1 && !airefIsAlsoMultiAnswerCol) rowObj[airefCols[0].semantic_key] = finalSpeak;

            rows.push(rowObj);
            rowNos.push(r);
            speakComputed.push(candidate);
            if (!finalSpeak.trim()) missingAiRefCount++;
            scriptLines.push(finalSpeak.trim());
        }
        const pageMapped = fieldMap.some(function (f) { return f.key === 'page'; });
        if (pageMapped && rows.length) {
            let pageFilled = 0;
            rows.forEach(function (row) {
                if (row && row.page != null && String(row.page).trim() !== '') pageFilled += 1;
            });
            if (!pageFilled) {
                warnings.push('⚠️ 範本有對 page 欄，但這 ' + rows.length + ' 列的 page 全是空的——考試用頁碼篩題會失敗。請確認 Excel 頁碼欄有值（公式請先開啟存檔），不要只看開頭的文法定義列。');
            } else if (pageFilled < rows.length) {
                warnings.push('💡 這 ' + rows.length + ' 列裡有 ' + pageFilled + ' 列有 page（開頭可能是文法定義、沒頁碼），考試可用題會略過沒有頁碼的列。');
            }
        }
        if (!rows.length) {
            warnings.push('⚠️ 第 ' + rowStart + '～' + rowEnd + ' 列裡每一格都是空的，產出會是 0 列——請確認行數起迄是否正確。');
        } else if (aCount > 1 && (speakMode === 'complex' || speakMode === 'paste')) {
            warnings.push('💡 這個 Template 書寫答案共 ' + aCount + ' 欄，口說答案批改標準為「' + (speakMode === 'paste' ? '直接貼上多筆' : '之後會寫複雜規則') + '」，請在下方逐列表格貼上／輸入口說答案內容（目前 ' + missingAiRefCount + '／' + rows.length + ' 列尚未填）。');
        } else if (!airefCols.length && aCount <= 1) {
            warnings.push('💡 這個 Template 尚未指定「🎤 口說答案」欄位，script.txt 會整份留白（' + rows.length + ' 個空行）——之後在擷取範本補上該欄再重新產生即可，不影響 meta.json 這 ' + rows.length + ' 列。');
        } else if (missingAiRefCount > 0) {
            warnings.push('💡 這 ' + rows.length + ' 列裡有 ' + missingAiRefCount + ' 列口說答案留白，script.txt 對應那幾行會是空行——不影響 meta.json，之後補上內容重新產生即可。');
        }
        return {
            ok: true,
            rows: rows,
            scriptLines: scriptLines,
            rowNos: rowNos,
            speakComputed: speakComputed,
            answerComputed: answerComputed,
            answerCombineNote: answerCombineNote,
            aCount: aCount,
            speakMode: speakMode,
            answerMode: answerMode,
            warnings: warnings,
            rowStart: rowStart,
            rowEnd: rowEnd
        };
    }

    /** 檔名裡不適合出現的字元（斜線會被誤認成路徑）換成連字號，其餘（含中文、空格）Drive 都吃得下 */
    function sanitizeForFileNamePart(s) {
        return String(s || '').trim().replace(/[\\/]/g, '-');
    }

    /**
     * 2026-08-13（老師要求：預設檔名要包含擷取範本名稱，格式「活頁名.範本名」）：
     * 原因是同一個活頁（sheet）常常需要套用不同的擷取範本各產生一份 meta（例如同一份單字表，
     * 一種排版給「看圖選字」用、另一種給「填空」用），舊版預設檔名只有活頁名（sheetName.meta.json），
     * 兩個擷取範本套在同一個活頁會撞名、後產生的直接覆蓋前一個，老師完全不會發現。
     * 加上擷取範本名稱之後，「同一活頁套不同擷取範本」與「同一檔案不同活頁」都會各自產生不重複的
     * 檔名——順帶也解決了「從檔名看不出是套用哪個擷取範本產生的」這個可追溯性問題
     * （檔名雖然還是不會記錄原始 Excel 檔案名稱，但至少能看出活頁＋擷取範本的組合）。
     * templateName 留空（例如還沒選擷取範本時）就退回舊行為，只用活頁名，不留多餘的句點。
     */
    function stripTemplateSuffixFromStem(stem, templateName) {
        let s = String(stem || '').trim().replace(/\.meta\.json$/i, '');
        const t = sanitizeForFileNamePart(templateName || '');
        if (t) {
            const re = new RegExp('\\.' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
            s = s.replace(re, '');
        }
        return s || String(stem || '').trim().replace(/\.meta\.json$/i, '');
    }

    function defaultOutputNames(sheetName, templateName, folderName, selectedCount) {
        const layoutPart = sanitizeForFileNamePart(templateName || '');
        // 檔名活頁段＝老師勾的那一頁。禁止「只勾一頁就把活頁名換成資料夾名」
        // （勾 VerbIrregular-3、資料夾叫 Jessie-vBK-2 時會產成錯的 Jessie-vBK-2.vocab-word）。
        const sheetPart = stripTemplateSuffixFromStem(sheetName, templateName) || 'output';
        const base = layoutPart ? (sheetPart + '.' + layoutPart) : sheetPart;
        return { meta: base + '.meta.json', script: base + '.script.txt' };
    }

    /** 老師沒改過檔名時，把舊的「Excel 分頁名」預設升級成資料夾名；手改過的檔名保留。 */
    function resolveOutputNames(sheetName, templateName, folderName, selectedCount, existing) {
        const next = defaultOutputNames(sheetName, templateName, folderName, selectedCount);
        const sheetDefault = defaultOutputNames(sheetName, templateName, '', 0);
        const existingMeta = existing && existing.outputMeta;
        const existingScript = existing && existing.outputScript;
        return {
            meta: (!existingMeta || existingMeta === sheetDefault.meta) ? next.meta : existingMeta,
            script: (!existingScript || existingScript === sheetDefault.script) ? next.script : existingScript
        };
    }

    /** 從 meta 檔名換算「stem」（跟其他地方統一：examSheetStemsForFolder／metaStemFromFileName 都是去掉 .meta.json 尾巴） */
    function stemFromMetaFileName(fileName) {
        return String(fileName || '').trim().replace(/\.meta\.json$/i, '');
    }

    function publicFieldCount(row) {
        if (!row || typeof row !== 'object') return 0;
        return Object.keys(row).filter(function (k) {
            return k && String(k).charAt(0) !== '_';
        }).length;
    }

    function sheetMatchKey(name) {
        let s = String(name || '').trim().replace(/\.meta\.json$/i, '');
        if (!s) return '';
        const dot = s.indexOf('.');
        if (dot > 0) s = s.slice(0, dot);
        return s.toUpperCase();
    }

    function matchOverwriteTarget(excelSheetName, targets) {
        const key = sheetMatchKey(excelSheetName);
        if (!key) return null;
        for (let i = 0; i < (targets || []).length; i++) {
            const t = targets[i];
            if (sheetMatchKey(t.stem) === key || sheetMatchKey(t.meta) === key) return t;
        }
        return null;
    }

    async function readExistingMetaFieldCount(folderId, folderName, metaFileName) {
        if (!window.GasService || typeof window.GasService.readMaterialFiles !== 'function') return null;
        if (!folderId || !metaFileName) return null;
        try {
            const files = await window.GasService.readMaterialFiles(folderId, [{
                materialFolder: folderName,
                fileName: metaFileName
            }], 'teacher');
            const hit = (files || []).find(function (f) { return f && f.ok && f.content; });
            if (!hit) return null;
            let rows = [];
            if (window.MaterialSnapshot && typeof window.MaterialSnapshot.parseMetaContent === 'function') {
                rows = window.MaterialSnapshot.parseMetaContent(hit.content) || [];
            } else {
                const parsed = JSON.parse(hit.content);
                rows = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : []);
            }
            return rows[0] ? publicFieldCount(rows[0]) : null;
        } catch (_e) {
            return null;
        }
    }

    async function confirmFieldCountMismatch(oldCount, newCount) {
        return window.ModalOverlay.confirm(
            '這次產出的欄位數是 ' + newCount + '，現有 meta.json 是 ' + oldCount + ' 欄。\n\n'
            + '欄位數不同。按「確定」會蓋過現有檔案；按「取消」則不上傳。'
        );
    }

    async function refreshStatsAfterPublish(folderName, templateId) {
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.invalidateDisplayCaches === 'function') {
            window.FeatureClassMaterialCombinations.invalidateDisplayCaches();
        }
        const usage = (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.lookupUsage === 'function')
            ? await window.FeatureClassMaterialCombinations.lookupUsage(folderName, templateId)
            : { classIds: [] };
        const ids = (usage && usage.classIds) || [];
        if (window.FeatureReviewCatalog && typeof window.FeatureReviewCatalog.refreshForClass === 'function') {
            for (let i = 0; i < ids.length; i++) {
                try { await window.FeatureReviewCatalog.refreshForClass(ids[i]); } catch (_e) { /* 統計表更新失敗不擋已完成的上傳 */ }
            }
        }
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.invalidateDisplayCaches === 'function') {
            window.FeatureClassMaterialCombinations.invalidateDisplayCaches();
        }
        await refreshTemplateUsageCache();
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

    /**
     * 書寫答案欄數>1 且批改標準為「結合」時，逐列確認／修正表格：計算值（唯讀，來自
     * answer_combine_note 公式，或算不出來時的空白接起來安全值）對照修正後值（可編輯，
     * 預填為目前最終值＝row._answer_combined_text），修正後即為最終寫入 meta.json、
     * 批改時比對用的內容。不影響「分開比對」模式（那種模式本來就逐欄各自比對，不需要
     * 結合成一個字串）。
     */
    function renderAnswerOverrideAreaHtml(name, g) {
        if (!g || !g.previewed || g.error || !Array.isArray(g.rows) || !g.rows.length) return '';
        if (!(g.aCount > 1) || g.answerMode !== 'combine') return '';
        const rowsHtml = g.rows.map(function (row, i) {
            const rowNo = g.rowNos ? g.rowNos[i] : (g.rowStart + i);
            const computed = (g.answerComputed && g.answerComputed[i]) || '';
            const finalVal = row._answer_combined_text != null ? row._answer_combined_text : '';
            const answerPreview = (Array.isArray(row._answer_keys) ? row._answer_keys : []).map(function (k) { return row[k]; }).filter(function (v) { return v != null && v !== ''; }).join(' / ');
            return '<tr>'
                + '<td style="padding:3px 6px; font-size:0.7rem; color:#94A3B8; white-space:nowrap;">第' + rowNo + '列</td>'
                + '<td style="padding:3px 6px; font-size:0.72rem; color:#334155;">' + esc(answerPreview) + '</td>'
                + '<td style="padding:3px 6px; font-size:0.72rem; color:#94A3B8;">' + (computed ? esc(computed) : '（無）') + '</td>'
                + '<td style="padding:3px 6px;"><input type="text" class="form-control mlp-app-answer-override" data-row-no="' + rowNo + '" data-idx="' + i + '" value="' + esc(finalVal) + '" style="width:100%; padding:4px; font-size:0.76rem;"></td>'
                + '</tr>';
        }).join('');
        return `
            <div style="margin-top:8px; background:#EFF6FF; border:1px solid #BFDBFE; border-radius:6px; padding:8px;">
                <div style="font-size:0.74rem; font-weight:800; color:#1D4ED8; margin-bottom:4px;">✍️ 書寫答案（結合）逐列確認／修正（共 ${g.rows.length} 列，修正後即為最終批改比對內容）</div>
                ${g.answerCombineNote ? ('<div style="font-size:0.7rem; color:#3B82F6; margin-bottom:4px;">結合公式：<code>' + esc(g.answerCombineNote) + '</code></div>') : '<div style="font-size:0.7rem; color:#B45309; margin-bottom:4px;">⚠️ 尚未在擷取範本填結合公式，目前用「跳過空欄、空白接起來」安全值，可在下方逐列修正。</div>'}
                <div style="max-height:260px; overflow-y:auto; margin-top:6px;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead><tr style="text-align:left; font-size:0.68rem; color:#78716C;"><th style="padding:3px 6px;">列號</th><th style="padding:3px 6px;">各欄書寫答案</th><th style="padding:3px 6px;">計算值</th><th style="padding:3px 6px;">最終結合答案（可修正）</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderAppGenAreaHtml(appId, templateName) {
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
            const defaults = resolveOutputNames(name, templateName, _excelMaterialFolder, sheetNames.length, g);
            const metaName = defaults.meta;
            const scriptName = defaults.script;
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
                        + warnHtml + sampleHtml + renderAnswerOverrideAreaHtml(name, g) + renderSpeakOverrideAreaHtml(name, g);
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
            /**
             * 💣 雷區（2026-08-14 老師回報「你都強制預覽了，還在下面放一顆產生預覽的按鈕，
             * 這不是廢物按鈕嗎」）：refreshAppGenArea 現在已經改成只要活頁／Template／行數起迄
             * 任一有變動就自動重算一次預覽（見 autoGeneratePreviewIfReady），上面 rowsHtml 顯示的
             * 內容永遠是「目前設定」算出來的最新結果，不需要老師自己再多按一次「產生預覽」——
             * 那顆按鈕在這個新流程下已經是死功能，直接拿掉，只留「☁️ 確認上傳到 Drive」一顆
             * 真正會動作（寫入 Drive）的按鈕。
             *
             * 這顆按鈕絕對不能再用 canConfirmUpload() 加 disabled——disabled 的 <button> 在瀏覽器裡
             * 完全不會發出 click 事件，`bindAppGenAreaEvents` 掛的 addEventListener('click',
             * handleConfirmUpload) 永遠不會被呼叫到，handleConfirmUpload 內部「沒有預覽就自動補跑」
             * 的邏輯因此變成死碼——這正是「沒有看預覽，按了儲存，沒有作用」的真正原因
             * （2026-08-09 使用者回報兩次，上一輪只修了函式內部邏輯，忘了拿掉這裡的 disabled，
             * 等於沒修到）。一律可點，交給 handleConfirmUpload 自己判斷要不要先補跑預覽、
             * 或顯示錯誤訊息。
             */
            + '<button type="button" class="mlp-app-gen-upload btn btn-primary" style="padding:6px 14px; font-size:0.78rem; font-weight:800; flex-shrink:0;">☁️ 確認上傳到 Drive</button>'
            /**
             * 💣 雷區（2026-08-14 老師先回報「上傳中的訊息被截住了，根本看不到」，上一輪改成
             * flex-basis:100%／display:block 逼它永遠自己另起一行——結果老師又回報「不要佔額外
             * 一行，訊息都放在橘色按鈕右邊」，那樣矯枉過正了。真正該修的是「父層 flex-wrap:wrap
             * 已經會在真的放不下時自動換行」這件事本來就夠用，之前會被裁掉是因為這個 span 沒有
             * flex-shrink/min-width，被旁邊按鈕擠爆版面寬度時內容溢出、又被更外層某個 overflow
             * 裁掉。改成 flex:1 1 240px（跟按鈕同一行、佔滿按鈕右邊剩餘空間）＋
             * white-space:normal／word-break 讓文字在這個彈性寬度裡自然換行；真的空間不夠時，
             * 父層 flex-wrap:wrap 才讓它整段移到下一行，不會被裁切、也不會平白多佔一整行。
             */
            + '<span class="mlp-app-gen-msg" style="font-size:0.76rem; font-weight:800; flex:1 1 240px; min-width:0; white-space:normal; word-break:break-word;"></span>'
            + '</div>'
            + '</div>';
    }

    /**
     * 只要活頁／Template／行數起迄任一項已經足夠算出結果，就自動跑一次「產生預覽」的算列邏輯，
     * 老師不用再手動按按鈕才看得到內容——見上面「🔍 產生預覽」按鈕移除處的雷區說明。
     * 只是自動重算，不碰訊息文字／不觸發上傳，失敗（例如還沒選 Template）就靜默跳過，
     * 讓 renderAppGenAreaHtml 走原本「請先…」的提示文案。
     */
    function autoGeneratePreviewIfReady(rowEl, appId) {
        const state = ensureAppRowState(appId);
        if (state.sourceKind !== 'local' || !state.localRawData) return;
        const sheetNames = checkedSheetNames(state);
        if (!sheetNames.length) return;
        const template = getCurrentAppTemplate(rowEl);
        if (!template) return;
        try { generatePreviewForRow(rowEl, appId); } catch (_e) { /* 靜默略過，畫面走原本的錯誤提示 */ }
    }

    function refreshAppGenArea(rowEl, appId) {
        const areaEl = rowEl.querySelector('.mlp-app-gen-area');
        if (!areaEl) return;
        autoGeneratePreviewIfReady(rowEl, appId);
        renderAppGenAreaOnly(rowEl, appId);
    }

    /**
     * 💣 雷區（2026-08-14 老師回報「26 個活頁沒有一個有紅色錯誤訊息，但最後訊息說全部上傳失敗，
     * Drive 裡明明有真的產生檔案」）：真正原因跟這個活頁有沒有真的上傳成功完全無關——
     * handleConfirmUpload 的上傳迴圈裡，每上傳完一個活頁就呼叫 refreshAppGenArea() 想更新畫面
     * 進度，但 refreshAppGenArea 內部的 autoGeneratePreviewIfReady() 會呼叫
     * generatePreviewForRow()，這個函式對「目前勾選的每一個活頁」都無條件重算一次預覽，
     * 並把 state.gen[name] 整個 Object.assign 換掉、**明確把 uploadStatus 設回 null**
     * （見 generatePreviewForRow 裡的 uploadStatus: null）——也就是說，剛剛才幫某個活頁設好的
     * g.uploadStatus（無論成功或失敗）,下一次（甚至同一次）refreshAppGenArea 呼叫就會被
     * 「重新產生預覽」整批洗掉，包括它自己剛設定的那一筆。跑完 26 個活頁的迴圈後，
     * 最後一次 refreshAppGenArea 會把全部 26 筆的 uploadStatus 都洗成 null，導致：
     * (a) 畫面上永遠看不到任何一張活頁卡片的綠色✅或紅色❌（因為狀態永遠被洗掉，不是沒有錯誤，
     *     是錯誤/成功訊息從來沒真的顯示出來過）
     * (b) 迴圈結束後的 anyUploadSucceeded／failedCount 判斷永遠讀到 null，一律判定「全部失敗」，
     *     即使 Drive 上傳其實全部成功。
     * 修法：迴圈裡只需要「重畫目前 state.gen 已有的內容」，不需要也不應該「重新產生預覽」
     * （活頁／Template／行數起迄這次都沒有變動）——改叫這顆不會動 state.gen 的
     * renderAppGenAreaOnly()，只有畫面外的其他觸發點（活頁勾選改變、Template 改變、行數
     * 起迄改變）才需要真的呼叫會重算的 refreshAppGenArea()。
     */
    function renderAppGenAreaOnly(rowEl, appId) {
        const areaEl = rowEl.querySelector('.mlp-app-gen-area');
        if (!areaEl) return;
        const templateSelectEl = rowEl.querySelector('.mlp-app-template');
        const templateName = templateSelectEl ? templateSelectEl.value : '';
        areaEl.innerHTML = renderAppGenAreaHtml(appId, templateName);
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
                // 💣 雷區：跟 buildGenerationFromMatrix 同一個坑——這欄若同時兼任「書寫答案」
                // 多欄之一（aCount>1），逐列手動修正口說答案時也不能覆寫回 g.rows[idx] 的書寫答案
                // 原始值，否則老師在這裡填的口說答案會把 answer_en 的書寫內容洗掉。
                const answerColsCount = (template && Array.isArray(template.columns))
                    ? template.columns.filter(function (c) { return c && c.is_answer && c.letter && c.semantic_key; }).length
                    : 0;
                const airefIsAlsoMultiAnswerCol = answerColsCount > 1 && airefCols[0] && !!airefCols[0].is_answer;
                if (airefCols.length === 1 && !airefIsAlsoMultiAnswerCol && g.rows && g.rows[idx]) g.rows[idx][airefCols[0].semantic_key] = this.value;
            });
        });
        /**
         * 書寫答案（結合）逐列修正輸入框：改一列＝立刻更新 g.answerOverrides 與
         * g.rows[idx]._answer_combined_text（供上傳／批改直接採用），不動任何原始欄位值。
         */
        rowEl.querySelectorAll('.mlp-app-answer-override').forEach(function (input) {
            input.addEventListener('change', function () {
                const sheetEl = this.closest('.mlp-app-gen-sheet');
                const name = sheetEl ? sheetEl.getAttribute('data-sheet') : '';
                const g = state.gen[name];
                if (!g) return;
                const rowNo = parseInt(this.getAttribute('data-row-no'), 10);
                const idx = parseInt(this.getAttribute('data-idx'), 10);
                if (!g.answerOverrides) g.answerOverrides = {};
                g.answerOverrides[rowNo] = this.value;
                if (g.rows && g.rows[idx]) {
                    g.rows[idx]._answer_combined_text = this.value;
                    // 老師手動修正結合答案後，之前在 buildGenerationFromMatrix 當下凍結的
                    // _accepted_answers 是根據「修正前」的答案算的，會變成過期資料——這裡照原本
                    // 那套白名單邏輯重算一次，維持「meta 裡的可接受答案永遠對應目前這個答案」的不變量。
                    const seedFn = window.QuizPaperBuilder && window.QuizPaperBuilder.equivalentAcceptedSeed;
                    const val = String(this.value || '').trim();
                    if (typeof seedFn === 'function' && val) {
                        const variants = seedFn(val);
                        if (variants.length) g.rows[idx]._accepted_answers = variants;
                        else delete g.rows[idx]._accepted_answers;
                    } else {
                        delete g.rows[idx]._accepted_answers;
                    }
                }
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
        if (!template) return { ok: false, error: '請先在最上面選一個擷取範本' };
        const sheetNames = checkedSheetNames(state);
        if (!sheetNames.length) return { ok: false, error: '請先勾選至少一個活頁' };
        const rowStartStr = rowEl.querySelector('.mlp-app-rowstart').value;
        const rowEndStr = rowEl.querySelector('.mlp-app-rowend').value;
        sheetNames.forEach(function (name) {
            const prevOutputMeta = state.gen[name] && state.gen[name].outputMeta;
            const prevOutputScript = state.gen[name] && state.gen[name].outputScript;
            // speakOverrides／answerOverrides（老師逐列修正／貼上的口說答案、書寫答案結合修正）
            // 要跨「重新產生預覽」保留下來，不能因為改了行數起迄或重按一次預覽就整批被
            // 公式算出來的候選值蓋掉
            const prevOverrides = (state.gen[name] && state.gen[name].speakOverrides) || {};
            const prevAnswerOverrides = (state.gen[name] && state.gen[name].answerOverrides) || {};
            const result = buildGenerationForSheet(appId, name, template, rowStartStr, rowEndStr, prevOverrides, prevAnswerOverrides);
            state.gen[name] = Object.assign({}, result, {
                previewed: true,
                outputMeta: prevOutputMeta,
                outputScript: prevOutputScript,
                uploadStatus: null,
                speakOverrides: prevOverrides,
                answerOverrides: prevAnswerOverrides
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
        renderAppGenAreaOnly(rowEl, appId);
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
        if (_metaPublishBusy) return;
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
            renderAppGenAreaOnly(rowEl, appId);
        }
        _metaPublishBusy = true;
        if (getUploadBtn()) { getUploadBtn().disabled = true; getUploadBtn().textContent = '⏳ 上傳中…'; }
        if (getMsgEl()) { getMsgEl().style.color = '#0F766E'; getMsgEl().textContent = '⏳ 正在確認教材資料夾…'; }
        try {
            const folderId = await resolveOrCreateAppFolderId(rowEl);
            const folderSelectEl = rowEl.querySelector('.mlp-app-folder');
            const folderName = folderSelectEl
                ? ((folderSelectEl.value === '__manual__' ? (rowEl.querySelector('.mlp-app-folder-manual') || {}).value : folderSelectEl.value) || '').trim()
                : (_excelMaterialFolder || '');
            const currentTemplate = getCurrentAppTemplate(rowEl);
            const overwriteTargets = (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.listOverwriteTargets === 'function')
                ? await window.FeatureClassMaterialCombinations.listOverwriteTargets(folderName, currentTemplate && currentTemplate.id)
                : [];
            let existingFieldCount = null;
            let newFieldCount = null;
            let overwriteCount = 0;
            for (let i = 0; i < sheetNames.length; i++) {
                const name = sheetNames[i];
                const g = state.gen[name];
                if (!g) continue;
                const hit = matchOverwriteTarget(name, overwriteTargets);
                if (hit) {
                    overwriteCount += 1;
                    g.outputMeta = hit.meta;
                    g.outputScript = hit.script || String(hit.stem || '').replace(/\.meta\.json$/i, '') + '.script.txt';
                    if (existingFieldCount == null) {
                        existingFieldCount = await readExistingMetaFieldCount(folderId, folderName, hit.meta);
                    }
                }
                if (newFieldCount == null && g.rows && g.rows[0]) newFieldCount = publicFieldCount(g.rows[0]);
            }
            if (overwriteCount && existingFieldCount != null && newFieldCount != null && existingFieldCount !== newFieldCount) {
                if (!await confirmFieldCountMismatch(existingFieldCount, newFieldCount)) {
                    if (getMsgEl()) { getMsgEl().style.color = '#B45309'; getMsgEl().textContent = '已取消上傳（欄位數不同）'; }
                    return;
                }
            }
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
                    const currentTemplateName = (rowEl.querySelector('.mlp-app-template') || {}).value || '';
                    const defaults = resolveOutputNames(name, currentTemplateName, _excelMaterialFolder, sheetNames.length, g);
                    const overwriteHit = matchOverwriteTarget(name, overwriteTargets);
                    const finalMetaName = overwriteHit
                        ? overwriteHit.meta
                        : ((metaNameInput && metaNameInput.value.trim()) || defaults.meta);
                    const finalScriptName = overwriteHit
                        ? (overwriteHit.script || String(overwriteHit.stem || '').replace(/\.meta\.json$/i, '') + '.script.txt')
                        : ((scriptNameInput && scriptNameInput.value.trim()) || defaults.script);
                    g.outputMeta = finalMetaName;
                    g.outputScript = finalScriptName;

                    const metaJson = JSON.stringify(g.rows, null, 2);
                    const scriptTxt = g.scriptLines.join('\n') + (g.scriptLines.length ? '\n' : '');
                    const metaRes = await window.GasService.uploadMaterialFile(utf8ToBase64(metaJson), finalMetaName, 'application/json', folderId);
                    const scriptRes = await window.GasService.uploadMaterialFile(utf8ToBase64(scriptTxt), finalScriptName, 'text/plain', folderId);
                    // 真正落地的檔名（GAS 若因撞名自動改名，以它回報的 finalFileName 為準，不能只信
                    // 我們送出去的 finalMetaName）減去 .meta.json 尾巴，才是這個活頁「真正的 stem」——
                    // 從本機 Excel 來源自動記錄配對紀錄時，sheet_ids 必須存這個，不能存勾選時的原始
                    // 活頁名稱（那是套擷取範本前的名字，跟 v51 之後「活頁名.範本名」的實際檔名不一樣，
                    // 兩者對不上會讓「已配對好的組合」卡片永遠判斷成失效，見 2026-08-13 老師回報的
                    // 「靈異現象」根因）。
                    g.finalStem = stemFromMetaFileName(metaRes.finalFileName || finalMetaName);
                    g.uploadStatus = { ok: true, text: '✅ 已上傳：' + (metaRes.finalFileName || finalMetaName) + '、' + (scriptRes.finalFileName || finalScriptName) };
                } catch (sheetErr) {
                    g.uploadStatus = { ok: false, text: '❌ 上傳失敗：' + (sheetErr.message || sheetErr) };
                }
                // 只重畫畫面、不重新產生預覽——見 renderAppGenAreaOnly 上面的雷區說明，這裡絕對不能
                // 呼叫會重算 state.gen 的 refreshAppGenArea，否則剛設好的 uploadStatus 會被立刻洗掉。
                renderAppGenAreaOnly(rowEl, appId);
            }
            // 上傳完成後，這個資料夾底下的 .meta.json 清單多了新檔案，逼 FeatureTimeline 的快取
            // 下次重新讀 Drive，其他下拉（獨立考試教材／活頁選單等）才看得到剛產生的新檔案
            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                const rootKind = rowEl.querySelector('.mlp-app-rootkind').value === 'class' ? 'class' : 'teacher';
                const classSelectEl = rowEl.querySelector('.mlp-app-class');
                const classId = classSelectEl ? classSelectEl.value : '';
                window.FeatureTimeline.ensureMetaCatalog(classId, rootKind, { force: true })
                    .then(function () { refreshOverviewFolders(); })
                    .catch(function () {});
            }
            // 2026-08-13（老師要求：上傳成功後不用再手動去「📎 套用到教材」按「儲存所有套用」，
            // 自動幫他記住這筆配對）：只要至少一個活頁真的上傳成功，就用 collectAppFromRow 讀
            // 目前這一列畫面上的設定，跟資料庫裡「最新」的清單合併存回——一定要先 fetch(force:true)
            // 拿最新清單再合併，絕對不能直接拿本機可能過期的 getTemplateApplicationsCachedSync()
            // 去 saveTemplateApplications()，那是整批覆寫，會把其他老師（或這位老師其他分頁）
            // 剛存的配對紀錄全部洗掉。存失敗只記警告、不擋已經成功的上傳結果。
            const anyUploadSucceeded = sheetNames.some(function (name) {
                return state.gen[name] && state.gen[name].uploadStatus && state.gen[name].uploadStatus.ok;
            });
            const failedCount = sheetNames.filter(function (name) {
                return state.gen[name] && state.gen[name].uploadStatus && !state.gen[name].uploadStatus.ok;
            }).length;
            if (anyUploadSucceeded) {
                try {
                    const appRecord = collectAppFromRow(rowEl);
                    // 💣 雷區（2026-08-13 老師回報三個總覽卡片「連動有問題」，根因在這裡）：
                    // collectAppFromRow 的 sheet_ids 是「勾選時的活頁原始名稱」（例如 vBK-2），
                    // 但 v51 起實際上傳的檔名已經變成「活頁名.layout名」（例如
                    // vBK-2.layout_vocab-pic+word_word.meta.json），兩者不是同一個字串。
                    // 若照舊存回原始活頁名，這筆配對紀錄的 sheet_ids 永遠對不到 Drive 上真正的檔案，
                    // 「已配對好的組合」卡片會一直判斷成「找不到對應 meta.json」而顯示失效警示。
                    // 這裡改成：本機 Excel 來源、且真的上傳成功的活頁，一律換成上傳時真正落地的
                    // stem（g.finalStem，來源見上面上傳迴圈），只有失敗或非本機來源的活頁才退回
                    // 原始勾選名稱。
                    const realSheetIds = sheetNames
                        .filter(function (name) { return state.gen[name] && state.gen[name].uploadStatus && state.gen[name].uploadStatus.ok; })
                        .map(function (name) { return state.gen[name].finalStem || name; });
                    if (realSheetIds.length) appRecord.sheet_ids = realSheetIds;
                    // 💣 雷區（2026-08-14 老師回報「畫面老是卡在本機 Excel」）：上面只修正了 sheet_ids
                    // 的字串內容，卻沒把 source_kind／source_file_name 一併改成 'drive'——這筆配對
                    // 明明真的上傳到 Drive 了，卻永遠被存成「本機」來源，每次重新整理都被打回
                    // 「🖥️ 改用本機 Excel」模式、卡著舊檔名（例如 GEPT-2.xlsx），老師手動切回
                    // 「☁️ 用歸屬資料夾」也沒用，下次程式自己重存又會被打回 local。本機 Excel 只是
                    // 「怎麼知道要套用哪些活頁」的一次性輔助手段（見本檔 2026-08-06 規劃備註），
                    // 一旦真的上傳成功，這筆紀錄的來源就該視為 Drive，不該再記著本機檔名。
                    appRecord.source_kind = 'drive';
                    appRecord.source_file_name = '';
                    if (appRecord.template_name && appRecord.material_folder && appRecord.sheet_ids.length) {
                        const latest = await fetchTemplateApplications(true);
                        const merged = mergeAppRecordIntoList(latest, appRecord);
                        await saveTemplateApplications(merged);
                        // 存檔成功後畫面也要立刻切回 Drive 模式，不能等下次整頁重新整理才對——
                        // 否則老師會覺得「明明存了，畫面還是卡在本機」
                        state.sourceKind = 'drive';
                        state.localFileName = '';
                        state.localSheetNames = [];
                        state.checkedSheets = {};
                        sheetNames.forEach(function (s) { state.checkedSheets[s] = true; });
                        refreshAppSheetsArea(rowEl, appId);
                        refreshOverviewApps();
                        refreshOverviewFolders();
                        const segForApp = ensureExcelSegments().find(function (s) {
                            return (s.quickApplyResults || []).some(function (a) { return a.id === appId; });
                        });
                        if (segForApp) {
                            const tpl = findApplyTemplateByName(appRecord.template_name)
                                || getAllTemplatesForApply().find(function (t) { return String(t.id) === String(appRecord.template_id); })
                                || null;
                            persistApplyComboRecord(segForApp, appRecord, tpl).then(function () {
                                return refreshStatsAfterPublish(appRecord.material_folder, appRecord.template_id);
                            }).catch(function (comboErr) {
                                console.error('[FeatureMaterialLayoutPairing] 上傳後寫入教材與範本組合失敗', comboErr);
                            });
                        }
                    }
                } catch (persistErr) {
                    console.error('[FeatureMaterialLayoutPairing] 自動記錄配對紀錄失敗（不影響已完成的上傳）', persistErr);
                }
            }
            // 💣 雷區：這裡曾寫「請看下方」，但每個活頁的上傳結果（uploadHtml）其實 render 在
            // rowsHtml 裡，畫面位置在這顆按鈕列的「上方」，不是下方——方向寫反會讓老師往下找
            // 卻什麼都沒有（2026-08-09 使用者回報「什麼？？沒看到啊」）。
            // 💣 雷區（2026-08-14 老師回報「圖二到底是成功還是沒成功」）：這裡之前無條件顯示綠色
            // 「✅ 全部處理完畢」，即使每一個活頁都上傳失敗（例如 GAS 部署壞掉，全部 26 個活頁都
            // 回「❌ 上傳失敗」）也一樣顯示成功字樣，跟上面每一張活頁卡片的紅字錯誤矛盾，老師完全
            // 沒辦法從這句話判斷實際結果。改成依 failedCount／anyUploadSucceeded 分三種情況顯示，
            // 顏色與文字都要跟實際結果一致，不能報喜不報憂。
            const finalMsgEl = getMsgEl();
            if (finalMsgEl) {
                if (!anyUploadSucceeded) {
                    finalMsgEl.style.color = '#DC2626';
                    finalMsgEl.textContent = '❌ 全部 ' + sheetNames.length + ' 個活頁都上傳失敗，請看上方各活頁卡片內的錯誤訊息（常見原因：GAS Web App 需要重新部署）';
                } else if (failedCount > 0) {
                    finalMsgEl.style.color = '#B45309';
                    finalMsgEl.textContent = '⚠️ 處理完畢，但有 ' + failedCount + '／' + sheetNames.length + ' 個活頁上傳失敗，請看上方各活頁卡片內的錯誤訊息';
                } else {
                    finalMsgEl.style.color = '#059669';
                    finalMsgEl.textContent = '✅ 全部處理完畢，請看上方各活頁卡片內的上傳結果';
                }
            }
        } catch (err) {
            if (getMsgEl()) { getMsgEl().style.color = '#DC2626'; getMsgEl().textContent = '❌ ' + (err.message || err); }
        } finally {
            _metaPublishBusy = false;
            const finalBtn = getUploadBtn();
            if (finalBtn) { finalBtn.disabled = !canConfirmUpload(state, sheetNames); finalBtn.textContent = '☁️ 確認上傳到 Drive'; }
        }
    }

    /**
     * opts.collapsedSummary（2026-08-13 老師回報「流程分割不清楚、一直重複」新增；
     * 同一天再回報「圖二的內容重複了」——第一版把歸屬檔案／活頁來源／行數起迄收進 <details>，
     * 但 <summary> 摘要文字把 folder／sheet／行數的實際數值又原封不動印了一次，跟上面
     * 「⚡ 快速套用」區塊剛選的內容一字不差——收合了框架，卻沒有真的去掉重複資訊，等於白收合）：
     *
     * 快速套用產生出來的這一列，擷取範本／歸屬檔案／活頁來源／行數起迄在上一步
     * （快速套用卡片）已經決定過一次，這裡**不該再顯示任何一次這些數值**（不管是獨立的
     *擷取範本下拉框、還是收合摘要行）。true 時：
     *   - 原本always顯示的「擷取範本」下拉框搬進 <details> 內（不再單獨佔一整行跟
     *     快速套用的選擇並排重複），<summary> 只放一句不帶任何實際數值的通用提示，
     *     不會再看到跟上面一模一樣的資料夾／活頁/行數文字。
     *   - 刪除鈕獨立成右上角一顆小按鈕（不用靠擷取範本那一行撐版面）。
     *   - 歸屬檔案／活頁來源／行數起迄這三塊本身仍然是「真正的資料來源」（generatePreviewForRow／
     *     collectAppFromRow／handleConfirmUpload 都直接讀這些 DOM 欄位的值，不能整個拔掉，
     *     只是預設收合、不主動秀出目前值），要修改的話展開 <details> 就看得到目前值可以改。
     * false（手動「＋新增套用」那條路，從頭什麼都沒填，沒有「上面已經選過一次」的問題）
     * 維持原本擷取範本下拉框＋三塊都展開顯示，不受影響。
     */
    /**
     * 2026-08-14（老師回報「重新整理，畫面不是應該最乾淨嗎，怎麼套用到教材會卡在一半」）：
     * 這一列不是「還在載入」也不是 GAS 問題——是資料庫裡真實存在的一筆舊套用紀錄
     * （material_template_applications），它的 template_name 是舊流程留下來的字串
     * （例如檔名推斷出來的 "sentance-meta"），現在系統裡已經沒有一個真正叫這個名字、
     * 或 id 對得起來的擷取範本，所以每次重新整理，這筆「真實存在但失效」的紀錄
     * 都會被畫出來、且擷取範本／教材資料夾下拉會一直顯示「找不到」——這是資料
     * 本身壞了，不是重新整理沒載入完成，重整無限次都不會自己變好，必須手動清掉或改配。
     */
    function isAppTemplateOrphaned(app) {
        const templates = getFieldTemplatesCachedSync();
        if (app.template_id) {
            return !templates.some(function (t) { return t.id === app.template_id; });
        }
        const name = String(app.template_name || '').trim();
        if (!name) return false;
        return !templates.some(function (t) { return String(t.name || '').trim() === name; });
    }

    /** 一鍵清掉失效套用紀錄：不只從畫面移除，直接打進資料庫真正刪除，不用再多按一次「儲存」 */
    async function handleRemoveOrphanedAppRow(rowEl, appId) {
        const ok = await window.ModalOverlay.confirm('這筆套用紀錄指向的擷取範本已經找不到（可能是舊流程留下的資料，或 Template 已被刪除／改名），確定要直接刪除這筆紀錄嗎？\n\n（只刪這筆「套用紀錄」，不會動到 Drive 上已經上傳的 meta.json／script.txt 檔案本身）');
        if (!ok) return;
        try {
            const latest = await fetchTemplateApplications(true);
            const filtered = latest.filter(function (a) { return String(a.id) !== String(appId); });
            await saveTemplateApplications(filtered);
            rowEl.remove();
            const appRowsEl = document.getElementById('mlp-app-rows');
            if (appRowsEl && !appRowsEl.querySelector('.mlp-app-row')) {
                appRowsEl.innerHTML = '<div class="mlp-app-empty-hint" style="color:#94A3B8; padding:12px;">尚未登記任何套用，按「＋ 新增套用」開始。</div>';
            }
            window.showFlash && window.showFlash('✅ 已刪除這筆失效的套用紀錄', 'success');
            refreshOverviewApps();
        } catch (err) {
            console.error('[FeatureMaterialLayoutPairing] 刪除失效套用紀錄失敗', err);
            window.showFlash && window.showFlash('❌ 刪除失敗：' + (err.message || err), 'error');
        }
    }

    function renderAppRow(app, opts) {
        const collapsedSummary = !!(opts && opts.collapsedSummary);
        const rootKind = app.root_kind === 'class' ? 'class' : 'teacher';
        const classFolders = rootKind === 'class' && app.class_id ? uniqueFolderNames(app.class_id, 'class') : [];
        const teacherFolders = rootKind === 'teacher' ? uniqueFolderNames('', 'teacher') : [];
        const folderOptions = rootKind === 'class' ? classFolders : teacherFolders;
        const folderSelectDisabled = rootKind === 'class' && !app.class_id;
        const templateOptions = getFieldTemplatesCachedSync().map(function (t) { return t.name; }).filter(Boolean);
        ensureAppRowState(app.id, app);
        const orphaned = isAppTemplateOrphaned(app);

        const templateSelectHtml = `
                <label style="font-size:0.78rem; font-weight:800; color:#475569; flex:1; min-width:200px;">擷取範本
                    <select class="form-control mlp-app-template" style="width:100%; padding:6px; margin-top:2px;">${buildSelectOptionsHtml(templateOptions, app.template_name, '— 選 Template —')}</select>
                </label>
        `;
        const orphanedBannerHtml = orphaned
            ? ('<div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:6px; padding:8px 10px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">'
                + '<span style="font-size:0.78rem; color:#B91C1C; font-weight:700;">⚠️ 這筆套用紀錄的擷取範本「' + esc(app.template_name || '（未命名）') + '」在目前的清單裡找不到（不是重新整理沒載入完成，重整無限次也不會自己變好）——請改選上面清單裡真正存在的 Template，或直接清除這筆舊紀錄。</span>'
                + '<button type="button" class="btn mlp-app-clear-orphan" data-id="' + esc(app.id) + '" style="padding:4px 10px; color:#B91C1C; border:1px solid #FCA5A5; border-radius:4px; background:white; font-weight:800; white-space:nowrap;">🗑️ 清除這筆失效紀錄</button>'
                + '</div>')
            : '';
        const removeButtonHtml = '<button type="button" class="btn mlp-app-remove" style="padding:6px 10px; color:#B91C1C; border:1px solid #FCA5A5; border-radius:6px; background:white; white-space:nowrap;">刪除</button>';

        const detailBlocksHtml = `
                ${collapsedSummary ? templateSelectHtml : ''}
                <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:10px; margin-bottom:10px; margin-top:${collapsedSummary ? '10px' : '0'};">
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

                <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:${collapsedSummary ? '0' : '10px'};">
                    <label style="font-size:0.78rem; font-weight:700; color:#334155;">行數起
                        <input type="text" class="form-control mlp-app-rowstart" value="${esc(app.row_start || '')}" style="width:110px; padding:6px; margin-top:2px;">
                    </label>
                    <label style="font-size:0.78rem; font-weight:700; color:#334155;">行數末
                        <input type="text" class="form-control mlp-app-rowend" value="${esc(app.row_end || '')}" placeholder="例如 LAST(AB)" style="width:150px; padding:6px; margin-top:2px;">
                    </label>
                </div>
        `;

        const headerHtml = collapsedSummary
            ? ('<div style="display:flex; justify-content:flex-end; margin-bottom:6px;">' + removeButtonHtml + '</div>'
                + '<details class="mlp-app-detail-toggle" style="margin-bottom:10px;">'
                + '<summary style="cursor:pointer; font-size:0.72rem; font-weight:700; color:#94A3B8;">🔧 顯示／修改內部設定（已依上面「⚡ 快速套用」的選擇帶入，不用再確認一次）</summary>'
                + detailBlocksHtml + '</details>')
            : ('<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px; flex-wrap:wrap;">'
                + templateSelectHtml + removeButtonHtml + '</div>'
                + detailBlocksHtml);

        return `
            <div class="mlp-app-row" data-id="${esc(app.id)}" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-bottom:10px;">
                ${orphanedBannerHtml}
                ${headerHtml}

                <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:10px;">
                    <div style="font-size:0.76rem; font-weight:800; color:#15803D; margin-bottom:4px;">🚀 產生 meta / script 並上傳到 Drive</div>
                    <div style="font-size:0.72rem; color:#4D7C0F; margin-bottom:6px;">直接讀本機 Excel 勾選的活頁，依上面的擷取範本（欄位對應＋角色）＋行數起迄算出 meta.json／script.txt，確認無誤後上傳到「📁 歸屬檔案」的教材資料夾——取代舊的終端機 publish_local。</div>
                    <div class="mlp-app-gen-area">${renderAppGenAreaHtml(app.id, app.template_name || '')}</div>
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

        const clearOrphanBtn = rowEl.querySelector('.mlp-app-clear-orphan');
        if (clearOrphanBtn) {
            clearOrphanBtn.addEventListener('click', function () { handleRemoveOrphanedAppRow(rowEl, appId); });
        }

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

        // 換擷取範本→ 預設檔名（活頁名.layout名）要立刻跟著換，不用等按「產生預覽」才看到
        const templateSelectEl = rowEl.querySelector('.mlp-app-template');
        if (templateSelectEl) {
            templateSelectEl.addEventListener('change', function () { refreshAppGenArea(rowEl, appId); });
        }
        // 行數起／末改變也要立刻重算預覽（拿掉手動「產生預覽」按鈕後，這是僅剩的兩個會影響
        // 算列結果、但原本沒有掛任何 change 監聽的欄位——之前得靠老師自己按按鈕才會生效）
        const rowStartEl = rowEl.querySelector('.mlp-app-rowstart');
        const rowEndEl = rowEl.querySelector('.mlp-app-rowend');
        if (rowStartEl) rowStartEl.addEventListener('change', function () { refreshAppGenArea(rowEl, appId); });
        if (rowEndEl) rowEndEl.addEventListener('change', function () { refreshAppGenArea(rowEl, appId); });

        bindAppSheetsAreaEvents(rowEl, appId);
        bindAppGenAreaEvents(rowEl, appId);
    }

    /** 從畫面上單一 .mlp-app-row 讀出目前的套用設定（跟存檔格式一致），collectAppsFromDom／
     * 上傳成功後自動記錄配對紀錄共用同一份邏輯，不要各寫一份、之後改一邊漏改另一邊 */
    function collectAppFromRow(rowEl) {
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
        const sheetIds = resolveCanonicalSheetIds(
            Object.keys(state.checkedSheets).filter(function (k) { return state.checkedSheets[k]; }).sort(),
            folder
        );
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
        // 2026-08-13（老師回報「總覽卡片出不來」）：不能只掃「已經配對過」的班級——老師要看的正是
        // 還沒配對過、但 Drive 裡早就存在 meta/script 的舊教材，邏輯上不能要求「先配對才看得到」。
        // 一律把老師目前所有班級都納入背景刷新範圍。
        allClasses().forEach(function (c) {
            if (c && c.id) keys['class::' + c.id] = { classId: c.id, rootKind: 'class' };
        });
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
                refreshOverviewFolders();
                refreshOverviewApps(); // meta catalog 剛載入完成，順便重新判斷「已配對好的組合」裡哪些活頁已經失效
            }).catch(function () {
                // 2026-08-14（老師回報「meta 那邊總是無法出現」）：以前這裡完全靜默，畫面永遠停在
                // 初次進頁那句通用「⏳ 尚未偵測到」，老師根本看不出背景其實已經抓失敗了。改成：
                // 失敗也補畫一次「教材資料夾」卡片——renderOverviewFoldersEmptyStateHtml 會讀到
                // getMetaCatalogEntry 這次存下來的 ok:false／error，直接顯示真正的錯誤原因。
                if (document.body.contains(container)) refreshOverviewFolders();
            });
        });
    }

    // ------------------------------------------------------------------
    // 📊 頁面最上方總覽（2026-08-12 老師要求：一進頁面先看「目前已有哪些教材資料夾＋meta/script、
    // 有哪些擷取範本、已經配對好哪些組合」，不用往下捲一路找散落在各區塊裡的資訊）。
    // 三張卡片都只讀既有快取／同步 helper，不主動打 GAS——資料還沒載入完成時先顯示「⏳ 載入中」，
    // 等 refreshMetaCatalogsInBackground／fetchFieldTemplates 等既有背景刷新完成後，
    // 呼叫 refreshOverview() 補畫，不用整頁重新 paint。
    // ------------------------------------------------------------------

    /**
     * 總覽要看哪些（root_kind, class_id）範圍：老師個人一定看，並把老師目前所有班級都納入——
     * 不能只看「已經配對過」的班級，那樣還沒配對過的舊教材永遠不會出現在總覽裡（雞生蛋問題，
     * 2026-08-13 老師回報「教材資料夾卡片一直顯示尚未偵測到」即為此因）。
     */
    function collectOverviewScopeKeys(pairs, apps) {
        const keys = { 'teacher::': { classId: '', rootKind: 'teacher', label: '👤 老師個人' } };
        allClasses().forEach(function (c) {
            if (c && c.id) {
                keys['class::' + c.id] = { classId: c.id, rootKind: 'class', label: '🏫 ' + (c.name || ('班級 ' + c.id)) };
            }
        });
        (pairs || []).concat(apps || []).forEach(function (r) {
            if (r && r.root_kind === 'class' && r.class_id && !keys['class::' + r.class_id]) {
                const cls = allClasses().find(function (c) { return String(c.id) === String(r.class_id); });
                keys['class::' + r.class_id] = { classId: r.class_id, rootKind: 'class', label: '🏫 ' + (cls && cls.name ? cls.name : ('班級 ' + r.class_id)) };
            }
        });
        return keys;
    }

    /**
     * 「教材資料夾」卡片抓不到任何資料夾時，過去只丟一句通用「⏳ 尚未偵測到」，老師完全看不出
     * 是「還在載入」「GAS 連線失敗」「老師個人資料夾還沒綁定」還是「Drive 裡真的是空的」——
     * refreshMetaCatalogsInBackground 的 .catch 又把真正的錯誤靜默吃掉（見那裡的雷區說明）。
     * 這裡改成直接讀 getMetaCatalogEntry 的真實狀態逐一列出：ok:false 就把 err.message／
     * getMetaCatalogDebugText 印出來，讓老師下次回報時可以直接複製這段文字，不用再靠截圖猜。
     */
    function renderOverviewFoldersEmptyStateHtml(scopeKeys) {
        const FT = window.FeatureTimeline;
        if (!FT || typeof FT.getMetaCatalogEntry !== 'function') {
            return '<div style="color:#94A3B8; padding:4px 0; font-size:0.8rem;">⏳ 尚未偵測到教材資料夾（可能還在載入，或 Drive 裡還沒有教材資料夾）</div>';
        }
        const lines = [];
        let anyLoading = false;
        Object.keys(scopeKeys).forEach(function (k) {
            const info = scopeKeys[k];
            const entry = FT.getMetaCatalogEntry(info.classId, info.rootKind);
            if (!entry) { anyLoading = true; return; }
            if (entry.ok === false) {
                const msg = (entry.error && (entry.error.message || String(entry.error))) || '未知錯誤';
                const debugText = (typeof FT.getMetaCatalogDebugText === 'function') ? FT.getMetaCatalogDebugText(info.classId, info.rootKind) : '';
                lines.push(
                    '<div style="margin-bottom:6px; padding:6px 8px; background:#FEF2F2; border:1px solid #FCA5A5; border-radius:6px;">'
                    + '<div style="font-size:0.78rem; font-weight:800; color:#B91C1C;">❌ ' + esc(info.label) + '：讀取失敗</div>'
                    + '<div style="font-size:0.74rem; color:#991B1B; margin-top:2px;">' + esc(msg) + '</div>'
                    + (debugText ? '<div style="font-size:0.7rem; color:#B45309; margin-top:2px; font-family:monospace; white-space:pre-wrap;">' + esc(debugText) + '</div>' : '')
                    + '</div>'
                );
            } else if (entry.ok === true) {
                lines.push(
                    '<div style="margin-bottom:4px; font-size:0.74rem; color:#94A3B8;">'
                    + esc(info.label) + '：GAS 有回應，但目前偵測到 0 個教材資料夾'
                    + '</div>'
                );
            } else {
                anyLoading = true;
            }
        });
        if (!lines.length) {
            return '<div style="color:#94A3B8; padding:4px 0; font-size:0.8rem;">⏳ 尚未偵測到教材資料夾（' + (anyLoading ? '還在載入中…' : '可能還在載入，或 Drive 裡還沒有教材資料夾') + '）</div>';
        }
        return lines.join('') + (anyLoading ? '<div style="font-size:0.74rem; color:#94A3B8; margin-top:2px;">（其餘範圍仍在載入中…）</div>' : '');
    }

    function renderOverviewFoldersHtml(pairs, apps) {
        const scopeKeys = collectOverviewScopeKeys(pairs, apps);
        const blocks = [];
        Object.keys(scopeKeys).forEach(function (k) {
            const info = scopeKeys[k];
            const folders = uniqueFolderNames(info.classId, info.rootKind);
            folders.forEach(function (folder) {
                blocks.push({
                    scopeLabel: info.label, classId: info.classId, rootKind: info.rootKind,
                    folder: folder, stems: sheetStemsForFolder(info.classId, info.rootKind, folder)
                });
            });
        });
        if (!blocks.length) {
            return renderOverviewFoldersEmptyStateHtml(scopeKeys);
        }
        return blocks.map(function (b) {
            const stemsHtml = b.stems.length
                ? b.stems.map(function (s) {
                    return '<span style="display:inline-flex; align-items:center; gap:4px; background:white; border:1px solid #CBD5E1; border-radius:6px; padding:2px 4px 2px 8px; margin:2px 4px 0 0; font-size:0.74rem; color:#334155;">'
                        + '📄 ' + esc(s)
                        + '<button type="button" class="mlp-overview-stem-delete" data-stem="' + esc(s) + '" title="刪除這個活頁的 meta/script"'
                        + ' style="border:none; background:none; color:#B91C1C; cursor:pointer; font-size:0.78rem; padding:0 2px; line-height:1;">🗑️</button>'
                        + '</span>';
                }).join('')
                : '<span style="color:#CBD5E1; font-size:0.74rem;">（尚無 .meta.json）</span>';
            return '<div class="mlp-overview-folder-block" data-class-id="' + esc(b.classId) + '" data-root-kind="' + esc(b.rootKind) + '" data-folder="' + esc(b.folder) + '" style="margin-bottom:10px;">'
                + '<div style="font-size:0.78rem; font-weight:800; color:#475569;">' + esc(b.scopeLabel) + ' ／ 📁 ' + esc(b.folder)
                + '<span style="color:#94A3B8; font-weight:600;">（' + b.stems.length + ' 個活頁）</span></div>'
                + '<div style="margin-top:2px;">' + stemsHtml + '</div>'
                + '</div>';
        }).join('');
    }

    /**
     * 🗑️ 總覽卡片的活頁刪除鈕：先 confirm（不可復原提醒），成功後強制重抓該範圍的 meta catalog
     * 再局部重畫「教材資料夾」卡，讓被刪掉的活頁馬上從清單消失，不用整頁重新整理。
     * 只送進垂圾桶（GAS setTrashed），Drive 垂圾桶 30 天內都能還原，不是永久刪除。
     *
     * 💣 雷區（2026-08-13 老師回報「按了刪除後，居然要手動 reload 才會顯示最新狀況，這也是
     * 老問題了，之前不是已經修正過了嗎」）：2026-08-12 那次修法（樂觀移除＋背景強制重抓校正）
     * 只解了一半——樂觀移除當下畫面確實立刻是對的，但緊接著背景那次 ensureMetaCatalog(force:true)
     * 打 GAS 重新 list_material_masters，若 Drive 端 trash 生效跟清單重新可見之間還有極短暫的
     * eventual consistency 落差（trash 已送出，但下一次 list 還沒反映），GAS 回來的「最新清單」
     * 其實還是舊的、仍然含有剛刪掉的檔案——那次 refreshOverviewFolders() 就會把樂觀移除的結果
     * 蓋回去，畫面看起來像「剛刪好又自己長回來」，老師必須等更久之後手動整頁重新整理才會抓到
     * 真正最新狀態。2026-08-13 這次把 listMaterialMasters 從逐資料夾 getFiles() 全量列舉改成
     * DriveApp.searchFiles 批次查詢（見 gas/Code.gs），search index 本身的 eventual consistency
     * 又比直接列舉資料夾更容易延遲，這個雷區只會更容易踩到，不是更少。
     *
     * 修法：背景校正那次 fetch 回來之後，**再補一次** removeMetaCatalogFileOption 把「已知確定
     * 剛剛刪除成功」的檔名重新從這次抓回來的清單裡濾掉，不管 GAS 這次回的資料是不是還沒同步——
     * 只要我們自己已經拿到 GAS 明確回報 deleted 的檔名，就不該再讓它們出現在畫面上。
     */
    async function handleOverviewStemDelete(blockEl, stem) {
        const classId = blockEl.getAttribute('data-class-id') || '';
        const rootKind = blockEl.getAttribute('data-root-kind') === 'class' ? 'class' : 'teacher';
        const folder = blockEl.getAttribute('data-folder') || '';
        const ok = await window.ModalOverlay.confirm('確定要刪除「' + folder + '／' + stem + '」的 meta.json／script.txt 嗎？\n\n會送進 Google Drive 垂圾桶（30 天內可還原），但任何已經套用這個活頁的作業／考試之後會抓不到 meta。');
        if (!ok) return;
        try {
            if (!window.FeatureTimeline || typeof window.FeatureTimeline.resolveMaterialsRootFolderId !== 'function') {
                throw new Error('系統錯誤：找不到 FeatureTimeline 模組');
            }
            if (!window.GasService || typeof window.GasService.deleteMaterialStem !== 'function') {
                throw new Error('系統錯誤：找不到 GasService 模組');
            }
            const rootFolderId = await window.FeatureTimeline.resolveMaterialsRootFolderId(classId, rootKind);
            const result = await window.GasService.deleteMaterialStem(rootFolderId, folder, stem, rootKind);
            window.showFlash && window.showFlash('✅ 已刪除：' + (result.deleted || []).join('、'), 'success');
            // 先樂觀地把剛刪掉的檔名從既有快取移除，畫面立刻反映，不用等下面這次重新打 Drive
            // 清單（trash 跟 list 是兩次獨立 API 往返，偶爾會有極短暫的不同步，見雷區說明）
            const deletedNames = (result && result.deleted && result.deleted.length)
                ? result.deleted
                : [stem + '.meta.json', stem + '.script.txt'];
            if (typeof window.FeatureTimeline.removeMetaCatalogFileOption === 'function') {
                window.FeatureTimeline.removeMetaCatalogFileOption(classId, rootKind, folder, deletedNames);
            }
            refreshOverviewFolders();
            // 2026-08-13（老師要求：刪 meta/script 後「🔗 已配對好的 meta＋layout 組合」也要跟著清）：
            // 一筆 material_template_applications 的 sheet_ids 是陣列（一個 Template 可以套用到
            // 好幾個活頁），不能整筆刪掉——只把剛刪除的這個 stem 從 sheet_ids 裡拿掉；拿掉之後
            // 如果這筆配對變成 0 個活頁（代表它套用的活頁已經全部被刪光），才整筆移除。跟
            // handleConfirmUpload 自動記錄配對同一個雷區：saveTemplateApplications(list) 是整批
            // 覆寫，務必先 fetchTemplateApplications(true) 拿最新清單再改，不能拿本機可能過期的
            // getTemplateApplicationsCachedSync() 去存，否則會把其他配對紀錄一起洗掉。失敗只記警告，
            // 不影響已經成功的 meta/script 刪除。
            try {
                const stemUpper = String(stem || '').trim().toUpperCase();
                const folderClean = String(folder || '').trim();
                const latestApps = await fetchTemplateApplications(true);
                let appsChanged = false;
                const updatedApps = [];
                latestApps.forEach(function (a) {
                    const matchesScope = a && a.root_kind === rootKind
                        && String(a.class_id || '') === String(classId || '')
                        && String(a.material_folder || '').trim() === folderClean;
                    if (!matchesScope || !Array.isArray(a.sheet_ids) || !a.sheet_ids.length) {
                        updatedApps.push(a);
                        return;
                    }
                    const filteredSheetIds = a.sheet_ids.filter(function (s) { return String(s || '').trim().toUpperCase() !== stemUpper; });
                    if (filteredSheetIds.length === a.sheet_ids.length) {
                        updatedApps.push(a); // 這筆配對本來就沒用到剛刪除的活頁，不受影響
                        return;
                    }
                    appsChanged = true;
                    if (filteredSheetIds.length) {
                        updatedApps.push(Object.assign({}, a, { sheet_ids: filteredSheetIds }));
                    }
                    // filteredSheetIds 空了：這筆配對已經沒有任何活頁可用，整筆移除（不 push）
                });
                if (appsChanged) {
                    await saveTemplateApplications(updatedApps);
                    refreshOverviewApps();
                }
            } catch (syncAppsErr) {
                console.error('[FeatureMaterialLayoutPairing] 同步移除已配對組合失敗（meta/script 本身已刪除成功，不受影響）', syncAppsErr);
            }
            // 背景校正一次真正的 Drive 現況（例如同時有其他人也在動這個資料夾），完成後再補畫一次；
            // 但 Drive／search index 可能還沒跟上剛才的 trash，回來的清單仍含被刪檔名時，
            // 再補一次樂觀移除蓋掉那筆過期資料，不能直接相信這次「重新抓到」的結果就是對的
            window.FeatureTimeline.ensureMetaCatalog(classId, rootKind, { force: true })
                .then(function () {
                    if (typeof window.FeatureTimeline.removeMetaCatalogFileOption === 'function') {
                        window.FeatureTimeline.removeMetaCatalogFileOption(classId, rootKind, folder, deletedNames);
                    }
                    refreshOverviewFolders();
                })
                .catch(function () {});
        } catch (err) {
            console.error('[FeatureMaterialLayoutPairing] 刪除活頁失敗', err);
            window.showFlash && window.showFlash('❌ 刪除失敗：' + (err.message || err), 'error');
        }
    }

    function bindOverviewFolderDeleteClicks() {
        document.querySelectorAll('#mlp-overview-folders .mlp-overview-stem-delete').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const blockEl = btn.closest('.mlp-overview-folder-block');
                if (blockEl) handleOverviewStemDelete(blockEl, btn.getAttribute('data-stem') || '');
            });
        });
    }

    function renderOverviewTemplatesHtml() {
        const templates = getFieldTemplatesCachedSync();
        if (!templates.length) {
            return '<div style="color:#94A3B8; padding:4px 0; font-size:0.8rem;">尚未建立任何擷取範本</div>';
        }
        return templates.map(function (t) {
            const colCount = Array.isArray(t.columns) ? t.columns.length : 0;
            return '<div class="mlp-overview-tpl-item" data-id="' + esc(t.id) + '" '
                + 'style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:6px 10px; margin-bottom:6px; cursor:pointer;">'
                + '<span style="font-size:0.82rem; font-weight:700; color:#334155;">🧩 ' + esc(t.name || '（未命名）') + '</span>'
                + '<span style="font-size:0.74rem; color:#94A3B8; white-space:nowrap;">' + colCount + ' 欄 ›</span>'
                + '</div>';
        }).join('');
    }

    /**
     * 2026-08-13（老師回報「靈異現象」：右邊組合寫著 vBK-2，左邊教材資料夾卡片裡卻找不到
     * vBK-2 這個活頁，只有 vBK-2.xxx 這種帶擷取範本名稱的新檔名）：material_template_applications
     * 存的是「當初套用時」記錄下來的 sheet_ids 快照，跟 Drive 上實際還有哪些 meta 檔案是
     * **兩份獨立資料**——只要那個活頁的 meta 之後被刪除、改名（含這次改了預設檔名規則後老師
     * 重新產生成新檔名）、或搬到別的資料夾，這筆配對紀錄不會自動跟著變，畫面上就會出現
     * 「講的活頁其實已經不在那個資料夾裡了」的落差。之前只處理「用畫面上的🗑️按鈕刪除」這一種
     * 情境的同步（見 handleOverviewStemDelete），沒有處理「用其他方式（例如改名、直接在
     * Drive 動、重新產生成新檔名）造成的落差」——這裡改成每次畫這張卡片都即時比對現有 meta
     * catalog，找不到就標紅色⚠️，並提供「清除失效活頁」讓老師一鍵把它從這筆配對移除
     * （不用去猜是不是自己眼睛看錯，也不用等下一次刪除才被動清掉）。
     */
    /**
     * 配對紀錄要顯示的 Template 名稱：template_id 有值就一律用它去擷取範本目前的清單
     * 「即時查」現在的名字，不要相信配對紀錄裡存的 template_name 字串快照——那只是建立當下的
     * 名稱，老師事後改了 Template 名字，這裡不即時更新就會跟「擷取範本」卡片顯示的名字不一致
     * （2026-08-13 老師回報「改了範本名字，這裡沒跟著變，要手動 reload」的根因之一）。
     * 找不到（id 對不到任何現存 Template，通常是被刪除了）才退回顯示存檔時的舊名稱，並標記 missing。
     */
    function resolveTemplateDisplayInfo(a) {
        if (a && a.template_id) {
            const t = getFieldTemplatesCachedSync().find(function (x) { return x.id === a.template_id; });
            if (t) return { name: t.name || '（未命名）', missing: false };
            return { name: (a.template_name || '（未選 Template）') + '（已刪除）', missing: true };
        }
        const mappedId = (a && a.template_name && window.MaterialNameMap && typeof window.MaterialNameMap.resolveTemplateId === 'function')
            ? window.MaterialNameMap.resolveTemplateId(a.template_name)
            : '';
        if (mappedId) {
            const t = getFieldTemplatesCachedSync().find(function (x) { return String(x.id) === String(mappedId); });
            if (t) return { name: t.name || '（未命名）', missing: false };
        }
        return { name: (a && a.template_name) || '（未選 Template）', missing: false };
    }

    /**
     * 🔍 補畫「apps（material_template_applications）沒有明確紀錄，但檔名本身已經看得出來」的配對：
     * 左欄「教材資料夾」清單到的 meta 檔名，本來就照 sheetName.layoutName 慣例命名（見
     * defaultOutputNames）；只要是走「Excel 工具快速套用」而不是「📎 套用到教材」那條路產生的
     * meta/script，從來沒有被寫進 material_template_applications，右欄就會空著或漏掉這幾個，
     * 老師會覺得「左邊看得到、右邊卻沒有，兩邊對不起來」。這裡把「apps 沒覆蓋到、但檔名帶
     * 擷取範本名稱」的活頁，依（root_kind, class_id, material_folder, layoutName）分組，補成
     * 一筆一筆「（依檔名推斷）」的顯示列——只用來畫面呈現，不寫回 material_template_applications，
     * 避免把「猜的」當成「明確設定過的」存進真正的紀錄裡。
     */
    function inferredAppsFromMetaCatalog(apps) {
        const scopeKeys = collectOverviewScopeKeys(null, apps);
        const templates = getFieldTemplatesCachedSync();
        const covered = {};
        (apps || []).forEach(function (a) {
            const folderKey = [a.root_kind || 'teacher', a.class_id || '', String(a.material_folder || '').trim()].join('|');
            (Array.isArray(a.sheet_ids) ? a.sheet_ids : []).forEach(function (s) {
                covered[folderKey + '|' + String(s || '').trim().toUpperCase()] = true;
            });
        });

        const groups = {};
        Object.keys(scopeKeys).forEach(function (k) {
            const info = scopeKeys[k];
            const folders = uniqueFolderNames(info.classId, info.rootKind);
            folders.forEach(function (folder) {
                const stems = sheetStemsForFolder(info.classId, info.rootKind, folder);
                const folderKey = [info.rootKind, info.classId || '', String(folder || '').trim()].join('|');
                stems.forEach(function (stem) {
                    const dotIdx = String(stem || '').indexOf('.');
                    if (dotIdx <= 0) return; // 檔名沒有內建擷取範本名稱，無從推斷
                    const layoutPart = stem.slice(dotIdx + 1);
                    if (!layoutPart) return;
                    if (covered[folderKey + '|' + String(stem || '').trim().toUpperCase()]) return; // 已有明確紀錄，不用猜
                    const gKey = folderKey + '|' + layoutPart.toLowerCase();
                    if (!groups[gKey]) {
                        groups[gKey] = {
                            root_kind: info.rootKind, class_id: info.classId, material_folder: folder,
                            sheet_ids: [], inferred: true
                        };
                        const matchedTpl = templates.find(function (t) {
                            return sanitizeForFileNamePart(t.name || '') === layoutPart;
                        });
                        if (matchedTpl) {
                            groups[gKey].template_id = matchedTpl.id;
                        } else {
                            groups[gKey].template_name = layoutPart;
                        }
                    }
                    groups[gKey].sheet_ids.push(stem);
                });
            });
        });
        return Object.keys(groups).map(function (k) { return groups[k]; });
    }

    /**
     * 💣 雷區（2026-08-14 老師回報「第一跟第二？是怎麼回事，被拆成兩個顯示區塊了」）：
     * 舊版把 inferredAppsFromMetaCatalog() 的結果直接 concat 到 apps 後面，結果同一個資料夾、
     * 同一個擷取範本（例如 GEPT-2／sentance-meta），因為 A~Y 這 23 個活頁有明確
     * app 紀錄、Z/W/U 這 3 個沒有，就活生生拆成「真實紀錄卡片」＋「🔍依檔名推斷卡片」兩張，
     * 老師完全看不出這其實是同一組。這裡改成：inferred 分組如果能對到「同資料夾＋同 Template」
     * 的既有 apps 紀錄，就直接把那幾個活頁併進那張真實卡片（畫面顯示用，不寫回
     * material_template_applications），只有真的找不到對得上的既有紀錄（例如 vBK-2 那兩個
     * 擷取範本，資料夾裡完全沒有明確套用過的紀錄）才維持獨立的「🔍依檔名推斷」卡片。
     */
    function mergeInferredIntoRealApps(apps, inferred) {
        const realApps = (apps || []).map(function (a) {
            return Object.assign({}, a, { sheet_ids: (Array.isArray(a.sheet_ids) ? a.sheet_ids : []).slice(), _inferredSheetIds: [] });
        });
        const extraBlocks = [];
        inferred.forEach(function (inf) {
            const target = realApps.find(function (a) {
                if ((a.root_kind || 'teacher') !== (inf.root_kind || 'teacher')) return false;
                if (String(a.class_id || '') !== String(inf.class_id || '')) return false;
                if (String(a.material_folder || '').trim() !== String(inf.material_folder || '').trim()) return false;
                if (inf.template_id) return a.template_id === inf.template_id;
                // inf 沒對到現存 Template（罕見：檔名裡的 layout 字串現在找不到同名 Template）時，
                // 退回比對「這張真實卡片即時查出來的顯示名稱」是否跟推斷出來的原始字串一樣
                return resolveTemplateDisplayInfo(a).name === inf.template_name;
            });
            if (target) {
                target.sheet_ids = target.sheet_ids.concat(inf.sheet_ids);
                target._inferredSheetIds = target._inferredSheetIds.concat(inf.sheet_ids);
            } else {
                extraBlocks.push(inf);
            }
        });
        return realApps.concat(extraBlocks);
    }

    function renderOverviewAppsHtml(apps) {
        const merged = mergeInferredIntoRealApps(apps, inferredAppsFromMetaCatalog(apps));
        if (!merged.length) {
            return '<div style="color:#94A3B8; padding:4px 0; font-size:0.8rem;">尚未套用任何擷取範本到教材，請在下面「🧾 從本機 Excel 讀取活頁／欄位」用「套用目前的範本」新增</div>';
        }
        return merged.map(function (a, idx) {
            const scopeLabel = a.root_kind === 'class'
                ? ('🏫 ' + (function () {
                    const cls = allClasses().find(function (c) { return String(c.id) === String(a.class_id); });
                    return cls && cls.name ? cls.name : ('班級 ' + (a.class_id || '未知'));
                })())
                : '👤 老師個人';
            const storedSheetIds = Array.isArray(a.sheet_ids) ? a.sheet_ids : [];
            const inferredSheetIdsUpper = (Array.isArray(a._inferredSheetIds) ? a._inferredSheetIds : [])
                .map(function (s) { return String(s || '').trim().toUpperCase(); });
            const currentStems = sheetStemsForFolder(a.class_id, a.root_kind, a.material_folder || '');
            const currentStemsUpper = currentStems.map(function (s) { return String(s || '').trim().toUpperCase(); });
            const stemsKnown = currentStems.length > 0; // 目錄還沒載入完成時全部算未知，避免載入中被誤標成失效
            // 舊紀錄常把 Excel 分頁碼（vBK-2）存成 sheet_ids；資料夾裡真正的 meta 是
            // _Publish.output_meta／已發布檔。整批對不到 Drive 時改顯示真檔，不要把分頁碼標紅。
            const storedAllMissing = !!(stemsKnown && storedSheetIds.length && storedSheetIds.every(function (s) {
                return currentStemsUpper.indexOf(String(s || '').trim().toUpperCase()) === -1;
            }));
            const sheetIds = (storedAllMissing && currentStems.length) ? currentStems : storedSheetIds;
            const staleIds = [];
            const sheetsHtml = sheetIds.length ? sheetIds.map(function (s) {
                const sUpper = String(s || '').trim().toUpperCase();
                const isStale = stemsKnown && currentStemsUpper.indexOf(sUpper) === -1;
                if (isStale) staleIds.push(s);
                // 併入的活頁不是明確紀錄裡本來就有的，標個小圖示提醒來源（不算失效，只是來源不同）
                const isInferred = !isStale && inferredSheetIdsUpper.indexOf(sUpper) !== -1;
                if (isStale) {
                    return '<span style="color:#B91C1C; font-weight:800;" title="這個資料夾目前找不到叫這個名字的 meta.json，可能已被刪除／改名／搬移">⚠️ ' + esc(s) + '</span>';
                }
                if (isInferred) {
                    return '<span style="color:#0F766E;" title="這個活頁沒有明確的套用紀錄，是從檔名（活頁名.範本名）反推併入這組的">🔍 ' + esc(s) + '</span>';
                }
                return esc(s);
            }).join('、') : '（未選活頁）';
            const rangeTxt = (a.row_start || a.row_end) ? ('｜第 ' + esc(a.row_start || '?') + '～' + esc(a.row_end || '?') + ' 行') : '';
            const tplInfo = resolveTemplateDisplayInfo(a);
            const tplHtml = tplInfo.missing
                ? ('<span style="color:#B91C1C; font-weight:800;" title="這個擷取範本已經被刪除，配對紀錄可能需要重新指定">⚠️ ' + esc(tplInfo.name) + '</span>')
                : esc(tplInfo.name);
            // 依檔名推斷出來的列（apps 沒有明確紀錄，是從 meta 檔名 sheetName.layoutName 反推的，
            // 且找不到同資料夾＋同 Template 的既有紀錄可以併入），不是老師自己在「📎 套用到教材」
            // 設定過的，標個灰色小字提醒來源，避免跟明確紀錄混淆
            const inferredTag = a.inferred
                ? '<span style="color:#94A3B8; font-weight:600; font-size:0.7rem;" title="這筆是從 meta 檔名（活頁名.範本名）反推出來的，不是明確設定過的套用紀錄">🔍依檔名推斷</span> '
                : '';
            const warnHtml = (!a.inferred && staleIds.length)
                ? ('<div style="margin-top:4px; font-size:0.72rem; color:#B91C1C;">⚠️ 上面標紅的活頁目前在「' + esc(a.material_folder || '') + '」資料夾裡找不到對應 meta.json（可能已被刪除或改名），這筆配對紀錄已經過期。'
                    + '<button type="button" class="mlp-overview-app-clean" data-idx="' + idx + '" style="margin-left:6px; border:1px solid #B91C1C; background:white; color:#B91C1C; border-radius:5px; padding:1px 6px; font-size:0.72rem; cursor:pointer;">🧹 清除失效活頁</button></div>')
                : '';
            return '<div style="background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px 10px; margin-bottom:6px;' + (a.inferred ? ' border-style:dashed;' : '') + '">'
                + '<div style="font-size:0.8rem; font-weight:800; color:#334155;">' + inferredTag + esc(scopeLabel) + ' ／ 📁 ' + esc(a.material_folder || '（未選資料夾）') + '</div>'
                + '<div style="margin-top:2px; font-size:0.78rem; color:#475569;">📄 ' + sheetsHtml + '　→　🧩 ' + tplHtml + rangeTxt + '</div>'
                + warnHtml
                + '</div>';
        }).join('');
    }

    /**
     * 「🧹 清除失效活頁」：重新用最新 meta catalog 判斷一次哪些 sheet_id 已經找不到對應檔案，
     * 從這筆配對紀錄移除；若移除後這筆配對變成 0 個活頁，整筆一併移除。跟 handleOverviewStemDelete
     * 一樣，存檔前務必先 fetchTemplateApplications(true) 拿最新清單，不能拿本機可能過期的
     * cache 去整批覆寫，否則會把其他配對紀錄一起洗掉。
     */
    async function handleOverviewAppCleanStale(idx) {
        const apps = getTemplateApplicationsCachedSync();
        const target = apps[idx];
        if (!target) return;
        if (!target.id) {
            // 極舊資料（早於這筆配對紀錄加上穩定 id 之前）沒有 id 可比對，用 id 比對可能誤傷其他
            // 同樣沒有 id 的舊紀錄——安全起見直接請老師改用「＋新增套用」重建這筆配對再刪掉舊的。
            window.showFlash && window.showFlash('⚠️ 這是一筆很舊的配對紀錄（沒有可靠的識別碼），請改用「⚡ 快速套用」重新設定一次，再手動刪除這筆舊紀錄', 'error');
            return;
        }
        try {
            const currentStems = sheetStemsForFolder(target.class_id, target.root_kind, target.material_folder || '');
            if (!currentStems.length) {
                window.showFlash && window.showFlash('⚠️ 目前還沒載入到這個資料夾的活頁清單，請稍後再試一次', 'error');
                return;
            }
            const currentStemsUpper = currentStems.map(function (s) { return String(s || '').trim().toUpperCase(); });
            const latestApps = await fetchTemplateApplications(true);
            // 每筆配對紀錄都有穩定的 id（見 collectAppFromRow／handleApplyExistingTemplate），
            // 用 id 對應遠比用陣列 index 或猜測其他欄位組合可靠——就算清單順序被背景刷新換過也不會認錯筆。
            const updatedApps = [];
            let changed = false;
            latestApps.forEach(function (a) {
                if (String(a.id) !== String(target.id) || !Array.isArray(a.sheet_ids) || !a.sheet_ids.length) {
                    updatedApps.push(a);
                    return;
                }
                const kept = a.sheet_ids.filter(function (s) { return currentStemsUpper.indexOf(String(s || '').trim().toUpperCase()) !== -1; });
                if (kept.length === a.sheet_ids.length) { updatedApps.push(a); return; } // 沒有真的清到任何東西
                changed = true;
                if (kept.length) updatedApps.push(Object.assign({}, a, { sheet_ids: kept }));
                // kept 空了：這筆配對已經沒有任何有效活頁，整筆移除（不 push）
            });
            if (!changed) {
                window.showFlash && window.showFlash('這筆配對現在看起來已經是最新的了，沒有需要清除的失效活頁', 'info');
                refreshOverviewApps();
                return;
            }
            await saveTemplateApplications(updatedApps);
            window.showFlash && window.showFlash('✅ 已清除失效活頁參照', 'success');
            refreshOverviewApps();
        } catch (err) {
            console.error('[FeatureMaterialLayoutPairing] 清除失效配對失敗', err);
            window.showFlash && window.showFlash('❌ 清除失敗：' + (err.message || err), 'error');
        }
    }

    function bindOverviewAppCleanClicks() {
        document.querySelectorAll('.mlp-overview-app-clean').forEach(function (btn) {
            btn.addEventListener('click', function () {
                handleOverviewAppCleanStale(parseInt(btn.getAttribute('data-idx'), 10));
            });
        });
    }

    function renderOverviewHtml(pairs, apps) {
        return `
            <div style="background:#F8FAFC; padding:20px; border-radius:12px; border:2px solid #CBD5E1; margin-bottom:16px;">
                <h3 style="margin:0 0 4px 0; color:var(--primary-dark);">📊 總覽：目前已有的教材與擷取範本</h3>
                <p style="color:#64748B; font-size:0.8rem; margin:0 0 12px 0;">點擷取範本卡片可直接跳去編輯；其他兩張卡片是現況清單，實際操作在下面各區塊。</p>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px;">
                    <div>
                        <div style="font-size:0.85rem; font-weight:800; color:#1D4ED8; margin-bottom:6px;">📁 教材資料夾（既有 meta／script）</div>
                        <div id="mlp-overview-folders">${renderOverviewFoldersHtml(pairs, apps)}</div>
                    </div>
                    <div>
                        <div style="font-size:0.85rem; font-weight:800; color:#7C3AED; margin-bottom:6px;">🧩 擷取範本</div>
                        <div id="mlp-overview-templates">${renderOverviewTemplatesHtml()}</div>
                    </div>
                    <div>
                        <div style="font-size:0.85rem; font-weight:800; color:#15803D; margin-bottom:6px;">🔗 已配對好的 meta ＋ 擷取範本組合</div>
                        <div id="mlp-overview-apps">${renderOverviewAppsHtml(apps)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function bindOverviewTemplateClicks() {
        document.querySelectorAll('.mlp-overview-tpl-item').forEach(function (el) {
            el.addEventListener('click', function () {
                const t = getFieldTemplatesCachedSync().find(function (x) { return String(x.id) === String(el.getAttribute('data-id')); });
                if (t) openTemplateEditorForExisting(t);
            });
        });
    }

    /** 局部補畫「教材資料夾」卡片（教材資料夾清單／活頁 stem 有變化時呼叫，不用整頁重畫） */
    function refreshOverviewFolders() {
        const wrap = document.getElementById('mlp-overview-folders');
        if (!wrap) return;
        wrap.innerHTML = renderOverviewFoldersHtml(getCachedSync(), getTemplateApplicationsCachedSync());
        bindOverviewFolderDeleteClicks();
    }

    /** 局部補畫「擷取範本」卡片（Template 清單新增／編輯／刪除／複製後呼叫） */
    function refreshOverviewTemplates() {
        const wrap = document.getElementById('mlp-overview-templates');
        if (!wrap) return;
        wrap.innerHTML = renderOverviewTemplatesHtml();
        bindOverviewTemplateClicks();
    }

    /** 局部補畫「已配對好的組合」卡片（套用列存檔後呼叫） */
    function refreshOverviewApps() {
        const wrap = document.getElementById('mlp-overview-apps');
        if (!wrap) return;
        wrap.innerHTML = renderOverviewAppsHtml(getTemplateApplicationsCachedSync());
        bindOverviewAppCleanClicks();
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
            ${renderOverviewHtml(pairs, apps)}
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                    <h3 style="margin:0; color:var(--primary-dark);">📚 範本庫 — 擷取範本／試卷範本</h3>
                    <button type="button" id="mlp-tpl-add-new" class="btn btn-action" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE;">新增範本</button>
                </div>
                <p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">
                    Template 是獨立於任何檔案的「規則」：名稱＋一組欄位設定（欄位代號、資料項名稱、題目／答案／訊息）。
                    設計好之後可以重複套用到「欄位結構相同」的任何教材檔案——實際套用時的行數起迄記在下面「⚡ 快速套用」各自登記，不記在這裡。
                    每一筆範本下方可勾選「🧾 也當試卷範本」，讓同一筆範本同時出現在下方「🧾 試卷範本」清單、出題下拉、班級教材組合裡（雙用）——
                    不勾就只當純擷取範本用，兩者是同一份資料的兩個角色勾選框，不是自動綁定。
                </p>
                <div id="mlp-template-editor"></div>
                <div id="mlp-template-list"></div>
            </div>
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <h3 style="margin:0 0 6px 0; color:var(--primary-dark);">🧾 套用／設計範本</h3>
                <p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">
                    <b>本機檔案</b>＝擷取 Excel 欄位、產生 meta/script。<b>雲端教材</b>＝套用或新設計<b>試卷範本</b>（不是擷取）。
                    雲端選「整個資料夾」就全部 meta 納入、不用再勾；選單一檔案會自動勾該檔，其餘可複選。
                </p>
                <div id="mlp-excel-source-wrap"></div>
                <div id="mlp-excel-block" style="margin-top:10px;"></div>
            </div>
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <h3 style="margin:0; color:var(--primary-dark);">🧩 教材／考試 Layout 搭配（只給「內建 6 種舊版排版」用）</h3>
                    <div style="display:flex; gap:8px;">
                        <button type="button" id="mlp-add-row" class="btn btn-action" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE;">＋ 新增搭配</button>
                        <button type="button" id="mlp-save" class="btn btn-primary" style="padding:8px 18px; font-weight:800;">💾 儲存</button>
                    </div>
                </div>
                <p style="color:#64748B; font-size:0.85rem; margin-top:0;">
                    ⚠️ 如果這個資料夾／活頁是用上面「⚡ 快速套用」套過擷取範本產生的，<b>不需要在這裡另外登記</b>——
                    出題畫面會自動偵測「這份 meta 實際是哪個 Template 套用產生的」，直接標「⭐」帶出對應的 Template 排版，不會用到下面這份清單。
                    這裡登記的「建議」只影響出題畫面下拉裡<b>內建 6 種舊版 GEPT／vocab 排版</b>要不要標星號排到最前面（給沒有用新版 Template 的舊教材用）：
                    出題畫面選好教材資料夾／活頁後，符合的 layout 會標「⭐建議」排到最前面，但仍可自由改選其他 layout。
                    同一活頁若真的需要兩種不同排版（例如整句翻譯＋句子填空都要），請建立兩個考試任務分別套用，不是在這裡塞兩個 layout 到同一份考卷。
                </p>
                <div id="mlp-rows">${pairs.map(function (p) { return renderRow(p, layoutCatalog); }).join('') || '<div class="mlp-empty-hint" style="color:#94A3B8; padding:12px;">尚未登記任何搭配，按「＋ 新增搭配」開始。</div>'}</div>
                <div id="mlp-save-msg" style="margin-top:8px; font-weight:800;"></div>
            </div>
        `;

        renderTemplateList();
        refreshTemplateUsageCache();
        bindOverviewFolderDeleteClicks();
        bindOverviewAppCleanClicks();
        document.getElementById('mlp-tpl-add-new').addEventListener('click', openTemplateEditorForNew);

        renderExcelSourceWrap();
        if (_excelWb || (isDriveSource() && _excelMaterialFolder)) renderExcelBlock();

        const rowsEl = container.querySelector('#mlp-rows');
        rowsEl.querySelectorAll('.mlp-row').forEach(function (rowEl) {
            bindRowEvents(rowEl);
            // 頁面已經先畫出來了；這裡才背景補教材資料夾清單（GAS 慢也不擋整頁出現）
            refreshFolderSelect(rowEl);
        });

        document.getElementById('mlp-add-row').onclick = function () {
            try {
                const empty = rowsEl.querySelector('.mlp-empty-hint');
                if (empty) empty.remove();
                const div = document.createElement('div');
                div.innerHTML = renderRow({ id: 'mlp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), material_folder: '', root_kind: 'teacher', class_id: '', sheet_id: '', layout_profile_ids: [] }, layoutCatalog);
                const newRow = div.firstElementChild;
                rowsEl.appendChild(newRow);
                bindRowEvents(newRow);
                refreshFolderSelect(newRow);
                highlightNewRow(newRow);
            } catch (err) {
                console.error('[FeatureMaterialLayoutPairing] 新增搭配列失敗', err);
                window.showFlash && window.showFlash('❌ 新增搭配列失敗：' + (err.message || err), 'error');
            }
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
        getCachedSync: getCachedSync,
        // 2026-08-14：getTemplateDerivedProfiles()／getSuggestedTemplateProfileId() 已刪除
        // （見上方「移除自動雙用行為」說明），不再對外提供——出題下拉／建議鏈請改用
        // material_exam_templates（FeatureExamJob）與 material_combination_exam_templates
        // （FeatureClassMaterialCombinations），不要重新接回擷取範本自動換算考卷排版的機制。
        resolveTemplateProfile: resolveTemplateProfile,
        getFieldTemplatesCachedSync: getFieldTemplatesCachedSync,
        buildProfileFromTemplate: buildProfileFromTemplate
    };
})();

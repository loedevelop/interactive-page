/**
 * 📂 檔案路徑：020_js_core/teacher-prefs.js
 * 🎯 職責：老師個人跨班預設值的「單一讀取來源」——沿用 profiles.raw_data（不新增資料表），
 * 供「建立新班級」「新增任務」「教材資料夾預設歸屬」等建立流程共用讀取，避免各自各打一次
 * profiles 查詢（見 .cursor/rules/teacher-cross-class-defaults-invariant.mdc）。
 *
 * 💣 雷區：
 * - 這裡的值只是「新建流程的初始值」，不是即時解析鏈（不像姓名顯示模式有「班級→老師→保底」
 *   的即時 fallback）。已存在的班級／任務不會因為老師改了這裡而改變。
 * - 存檔時務必用 Object.assign 合併回 profiles.raw_data，禁止整包覆寫（會把 preferred_name_mode
 *   等既有欄位砍掉）。
 */
window.TeacherPrefs = (function () {
    'use strict';

    const DEFAULT_KEYS = ['default_calc_mode', 'default_week_start_day', 'default_use_ai_grading', 'default_materials_root_kind'];

    /** @type {object|null} 快取的老師跨班預設值 */
    let cachedDefaults = null;
    /** @type {Promise<object>|null} 進行中的讀取請求（避免同時多處呼叫各打一次） */
    let inflightPromise = null;

    function extractDefaults(rawData) {
        const raw = rawData || {};
        return {
            default_calc_mode: raw.default_calc_mode || null,
            default_week_start_day: raw.default_week_start_day || null,
            default_use_ai_grading: raw.default_use_ai_grading === true,
            default_materials_root_kind: raw.default_materials_root_kind || null
        };
    }

    async function fetchFromProfile() {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) return extractDefaults(null);
        const { data: profile, error } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', user.id)
            .maybeSingle();
        if (error) {
            console.warn('[TeacherPrefs] 讀取老師跨班預設值失敗，回退為空', error);
            return extractDefaults(null);
        }
        return extractDefaults(profile && profile.raw_data);
    }

    /**
     * 取得老師跨班預設值（含快取）。
     * @param {{force?:boolean}} [options]
     * @returns {Promise<{default_calc_mode:?string, default_week_start_day:?string, default_use_ai_grading:boolean, default_materials_root_kind:?string}>}
     */
    async function getDefaults(options) {
        options = options || {};
        if (cachedDefaults && !options.force) return cachedDefaults;
        if (inflightPromise && !options.force) return inflightPromise;

        inflightPromise = fetchFromProfile()
            .then(function (result) {
                cachedDefaults = result;
                inflightPromise = null;
                return result;
            })
            .catch(function (err) {
                inflightPromise = null;
                console.warn('[TeacherPrefs] getDefaults 發生例外，回退為空', err);
                return extractDefaults(null);
            });
        return inflightPromise;
    }

    /** 老師在「系統帳號設定」儲存新的跨班預設值後呼叫，避免其他分頁仍拿到舊快取 */
    function invalidate() {
        cachedDefaults = null;
    }

    /**
     * 同步讀取「目前已知」的跨班預設值，供無法 await 的同步渲染函式使用
     * （例如 ui-timeline-templates.js 的模板字串函式、store-assignment-builder.js 的
     * _defaultAudioRaw）。第一次呼叫前若快取還沒抓到，回傳空物件（呼叫端自行保留字面預設）；
     * 呼叫本函式會順便觸發一次背景抓取，之後同分頁內的渲染就會拿到真正的值。
     * @returns {object} 目前快取的跨班預設值，沒抓到過就是 {}
     */
    function getCachedSync() {
        if (!cachedDefaults && !inflightPromise) {
            getDefaults().catch(function () {});
        }
        return cachedDefaults || {};
    }

    return {
        DEFAULT_KEYS: DEFAULT_KEYS,
        getDefaults: getDefaults,
        getCachedSync: getCachedSync,
        invalidate: invalidate
    };
})();

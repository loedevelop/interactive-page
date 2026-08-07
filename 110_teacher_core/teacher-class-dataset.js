/**
 * 📂 檔案路徑：110_teacher_core/teacher-class-dataset.js
 * 🎯 職責：班級進度資料集的「單一撈取來源」——輕量格子資料 + 含 raw_data 的重量級 completions，
 * 供「班級進度總表」與「🧰 Gadget 中心」共用，避免兩個分頁各自重打一次班級全量查詢。
 *
 * 💣 雷區：
 * - 依 classId 快取「最近一次成功的重量級結果」；換班／首次進入才會真的打 API，
 *   同一班在快取有效期間內重複 load() 不會再打 API（見 page-refresh-perf-invariant.mdc）。
 * - 「重新整理資料」按鈕必須呼叫 invalidate(classId) 再 load(classId, {force:true})，
 *   否則會一直沿用舊快取。
 * - 輕量階段失敗視為致命錯誤（throw，由呼叫端決定怎麼顯示）；重量階段失敗視為非致命
 *   （呼叫 onHeavyError，輕量資料仍可用），對齊原 feature-progress.js 的既有行為。
 */
window.TeacherClassDataset = (function () {
    'use strict';

    /** @type {Object<string, {light:any, heavy:any, timestamp:number}>} */
    const cache = {};
    /** @type {Object<string, number>} 每個 classId 目前最新一次請求序號，用於忽略過期回應 */
    const seqByClass = {};

    function buildStudents(enrollments) {
        return (enrollments || [])
            .filter(function (e) { return e.profiles !== null; })
            .map(function (e) {
                return Object.assign({}, e.profiles, {
                    // 附掛 drive_folder_id（指向該生 01_Submissions），供音檔分割上傳等工具使用
                    drive_folder_id: (e.raw_data && e.raw_data.drive_folder_id) || ''
                });
            });
    }

    async function fetchLight(classId) {
        // 雷區：class_id=UUID；assignment_id 可能 BIGINT——查詢參數沿用 DB 原值，勿強轉 uuid
        // student_task_progress：無提交機制小項的手動打勾旗標，與 task_completions 是 OR 關係一起判定完成
        const [enrollRes, assignRes, compLightRes, manualRes] = await Promise.all([
            window.supabaseClient
                .from('student_enrollments')
                .select(`
                    user_id,
                    raw_data,
                    profiles:user_id (id, name)
                `)
                .eq('class_id', classId)
                .is('deleted_at', null)
                .order('created_at', { ascending: true }),
            window.supabaseClient
                .from('assignments')
                .select('id, title, target_date, due_date, tasks, is_published, class_id')
                .eq('class_id', classId)
                .is('deleted_at', null)
                .order('target_date', { ascending: false }),
            window.supabaseClient
                .from('task_completions')
                .select('student_id, task_id, assignment_id, status, deleted_at, updated_at')
                .eq('class_id', classId)
                .is('deleted_at', null)
                .neq('status', 'incomplete'),
            window.supabaseClient
                .from('student_task_progress')
                .select('assignment_id, task_id, student_id, is_completed')
                .eq('class_id', classId)
        ]);

        if (enrollRes.error) throw new Error('讀取選課名單失敗: ' + enrollRes.error.message);
        if (assignRes.error) throw new Error('讀取作業清單失敗: ' + assignRes.error.message);
        if (compLightRes.error) throw new Error('讀取完成紀錄失敗: ' + compLightRes.error.message);
        if (manualRes.error) console.warn('[TeacherClassDataset] 讀取手動打勾旗標失敗，僅顯示真實提交狀態', manualRes.error);

        return {
            classId: classId,
            students: buildStudents(enrollRes.data),
            assignments: assignRes.data || [],
            completions: compLightRes.data || [],
            manualProgress: manualRes.data || []
        };
    }

    async function fetchHeavyCompletions(classId) {
        const heavyRes = await window.supabaseClient
            .from('task_completions')
            .select('student_id, task_id, assignment_id, status, raw_data, deleted_at, updated_at')
            .eq('class_id', classId)
            .is('deleted_at', null)
            .neq('status', 'incomplete');
        if (heavyRes.error) throw heavyRes.error;
        return heavyRes.data || [];
    }

    /**
     * 載入班級進度資料集。
     * @param {string} classId
     * @param {{onLight?:function(any), onHeavy?:function(any), onHeavyError?:function(Error), force?:boolean}} [options]
     *   onLight(light)  — 輕量資料到手（不含 raw_data）
     *   onHeavy(heavy)  — 含 raw_data 的完整資料到手（light 欄位 + completions 換成重量版）
     *   onHeavyError(err) — 重量階段失敗（輕量資料仍可用，非致命）
     *   force — 略過快取，強制重抓（「重新整理資料」用）
     * @returns {Promise<{light:any, heavy:any}|null>} 若中途被更新的請求取代，回傳 null
     */
    async function load(classId, options) {
        options = options || {};
        if (!classId) return null;

        const cached = cache[classId];
        if (cached && !options.force) {
            if (typeof options.onLight === 'function') options.onLight(cached.light);
            if (typeof options.onHeavy === 'function') options.onHeavy(cached.heavy);
            return cached;
        }

        const seq = (seqByClass[classId] || 0) + 1;
        seqByClass[classId] = seq;

        const light = await fetchLight(classId);
        if (seqByClass[classId] !== seq) return null;
        if (typeof options.onLight === 'function') options.onLight(light);

        try {
            const heavyCompletions = await fetchHeavyCompletions(classId);
            if (seqByClass[classId] !== seq) return null;
            const heavy = Object.assign({}, light, { completions: heavyCompletions });
            const entry = { light: light, heavy: heavy, timestamp: Date.now() };
            cache[classId] = entry;
            if (typeof options.onHeavy === 'function') options.onHeavy(heavy);
            return entry;
        } catch (heavyErr) {
            console.warn('[TeacherClassDataset] 補載 raw_data 失敗', heavyErr);
            if (typeof options.onHeavyError === 'function') options.onHeavyError(heavyErr);
            return { light: light, heavy: null, timestamp: Date.now() };
        }
    }

    /** 清除指定班級（或全部）的快取；換班／手動重整資料時呼叫 */
    function invalidate(classId) {
        if (classId) {
            delete cache[classId];
        } else {
            Object.keys(cache).forEach(function (k) { delete cache[k]; });
        }
    }

    return {
        load: load,
        invalidate: invalidate
    };
})();

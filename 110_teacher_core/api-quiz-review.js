/**
 * 📂 110_teacher_core/api-quiz-review.js
 * 🎯 職責：考試批改（查看學生考卷／改標準答案／重新批改）的資料存取薄封裝
 *
 * 只負責 I/O，不做批改邏輯（批改邏輯全部在 020_js_core/quiz-paper-builder.js）。
 * 老師對 task_completions 本來就有 UPDATE 權限（見
 * supabase/migrations/20260726070000_enable_rls_sensitive_tables.sql 的
 * staff_update_class_completions policy），不需要新的 RPC。
 */
window.ApiQuizReview = (function () {
    'use strict';

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (_e) { return {}; }
        }
        return data;
    }

    function db() {
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        return window.supabaseClient;
    }

    /** 取單一作業（優先用 TeacherDB 快取，沒有才打 API），回傳 { id, tasks[] } */
    async function fetchAssignment(assignmentId) {
        const cached = (window.TeacherDB && Array.isArray(window.TeacherDB.assignments))
            ? window.TeacherDB.assignments.find(function (a) { return String(a.id) === String(assignmentId); })
            : null;
        if (cached) return cached;
        const { data, error } = await db().from('assignments').select('*').eq('id', assignmentId).is('deleted_at', null).single();
        if (error) throw new Error('無法讀取作業：' + error.message);
        if (data && typeof data.tasks === 'string') {
            try { data.tasks = JSON.parse(data.tasks); } catch (_e) { data.tasks = []; }
        }
        return data;
    }

    /**
     * 取某一考試任務下、所有學生的 task_completions（含 id，供改分用）。
     * 💣 雷區（2026-08-13）：task_completions 資料表**沒有** score 這個欄位——分數全部存在
     * raw_data.quiz_result.score（JSONB，見 feature-progress.js／feature-exam-review.js 讀分數
     * 都是讀 raw_data.quiz_result.score，不是讀 top-level 欄位）。之前 select 裡多寫了 `score`，
     * PostgREST 會直接報錯「column task_completions.score does not exist」，讓整個「查看／批改
     * 考卷」（從班級進度總表點考試格子）打不開。絕對不要再加回這個欄位，除非真的先用 migration
     * 建出這個欄位。
     */
    async function fetchCompletionsForTask(assignmentId, taskId) {
        const { data, error } = await db()
            .from('task_completions')
            .select('id, student_id, class_id, status, raw_data, updated_at')
            .eq('assignment_id', assignmentId)
            .eq('task_id', taskId)
            .is('deleted_at', null);
        if (error) throw new Error('無法讀取學生作答紀錄：' + error.message);
        return (data || []).map(function (row) {
            row.raw_data = parseJSONB(row.raw_data);
            return row;
        });
    }

    /**
     * 把新的 quiz_paper 寫回 assignments.tasks（只改該任務節點，其餘任務原樣保留）。
     * 用 TaskScriptResolver.patchTaskRawDataInTree 做局部改寫，不需要打開整個作業編輯器。
     */
    async function saveQuizPaperPatch(assignmentId, taskId, paper) {
        const assignment = await fetchAssignment(assignmentId);
        if (!assignment) throw new Error('找不到作業');
        const result = window.TaskScriptResolver.patchTaskRawDataInTree(assignment.tasks, taskId, function (t) {
            t.raw_data.quiz_paper = paper;
        });
        if (!result.patched) throw new Error('在作業裡找不到這個考試任務（id=' + taskId + '）');
        const { error } = await db().from('assignments').update({ tasks: result.tasks }).eq('id', assignmentId);
        if (error) throw new Error('儲存考卷標準答案失敗：' + error.message);
        // 同步更新快取，避免老師端其他畫面讀到舊的 quiz_paper
        assignment.tasks = result.tasks;
        return result.tasks;
    }

    /**
     * 寫回單一學生 completion 的 raw_data。
     * score 參數保留（呼叫端仍會傳，例如 regradeAndSaveTask 算出的 nextScore）只是為了不用動呼叫端，
     * 但**不會**寫進 task_completions.score——那個欄位不存在，分數本來就已經包在 rawData.quiz_result.score
     * 裡面了（regradeCompletionRawData 寫入的），不需要也不能再多寫一個 top-level 欄位。
     */
    async function saveCompletionRawData(completionId, rawData, _scoreUnused) {
        const incoming = rawData && typeof rawData === 'object' ? rawData : {};
        const { data: current, error: readErr } = await db()
            .from('task_completions')
            .select('raw_data')
            .eq('id', completionId)
            .maybeSingle();
        if (readErr) throw new Error('儲存批改結果失敗：' + readErr.message);
        const prevRaw = parseJSONB(current && current.raw_data);
        const merged = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.prepareCompletionRawDataForSave === 'function')
            ? window.QuizPaperBuilder.prepareCompletionRawDataForSave(prevRaw, incoming)
            : incoming;
        const { error } = await db().from('task_completions').update({ raw_data: merged }).eq('id', completionId);
        if (error) throw new Error('儲存批改結果失敗：' + error.message);
        return true;
    }

    /**
     * 批次寫回多筆 completion（重新批改全班同任務時用）。逐筆 try/catch 累計成功/失敗，
     * 仿 feature-ai-backfill.js 的批次模式：不用交易，單筆失敗不影響其他人。
     */
    async function batchSaveCompletions(list) {
        let okCount = 0;
        const errors = [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            try {
                await saveCompletionRawData(item.id, item.rawData, item.score);
                okCount += 1;
            } catch (err) {
                errors.push({ id: item.id, student_id: item.student_id, message: err.message || String(err) });
            }
        }
        return { okCount: okCount, failCount: errors.length, errors: errors };
    }

    /** 該班學生名單（id + name），供考卷批改頁列學生用 */
    async function fetchClassStudents(classId) {
        const { data, error } = await db()
            .from('student_enrollments')
            .select('user_id, profiles:user_id (id, name)')
            .eq('class_id', classId)
            .is('deleted_at', null);
        if (error) throw new Error('無法讀取學生名單：' + error.message);
        return (data || [])
            .filter(function (e) { return e.profiles; })
            .map(function (e) {
                const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
                return { id: p.id || e.user_id, name: (p && p.name) || '未知學生' };
            });
    }

    async function currentTeacherId() {
        const { data, error } = await db().auth.getUser();
        if (error) throw new Error(error.message);
        return (data && data.user && data.user.id) || '';
    }

    function acceptedMapOf(item) {
        const out = {};
        ((item && item.accepted_answers) || []).forEach(function (a) {
            const n = window.QuizPaperBuilder.normalizeAnswer(a);
            if (n && !out[n]) out[n] = String(a).trim();
        });
        return out;
    }

    /**
     * 這次卷面新增／拿掉的可接受寫法，寫進／移出全站這題教材列。
     * 沒有活頁＋頁＋題號＝對不到全站鑰匙，只留這份卷，不准改借。
     */
    async function persistUniversalAcceptedDiff(originalPaper, paper) {
        const Q = window.QuizPaperBuilder;
        if (!Q || typeof Q.sourceFieldsOf !== 'function') return;
        const teacherId = await currentTeacherId();
        if (!teacherId) return;
        const beforeById = {};
        ((originalPaper && originalPaper.items) || []).forEach(function (it) {
            if (it && it.item_id != null) beforeById[String(it.item_id)] = it;
        });
        const adds = [];
        const removes = [];
        ((paper && paper.items) || []).forEach(function (it) {
            const fields = Q.sourceFieldsOf(it);
            if (!fields) return;
            const prev = acceptedMapOf(beforeById[String(it.item_id)]);
            const next = acceptedMapOf(it);
            Object.keys(next).forEach(function (n) {
                if (!prev[n]) adds.push({ fields: fields, answer_text: next[n], answer_norm: n });
            });
            Object.keys(prev).forEach(function (n) {
                if (!next[n]) removes.push({ fields: fields, answer_norm: n });
            });
        });
        for (let i = 0; i < adds.length; i++) {
            const row = adds[i];
            const payload = {
                teacher_id: teacherId,
                material_folder: row.fields.material_folder,
                sheet_id: row.fields.sheet_id,
                page: row.fields.page,
                item_no: row.fields.item_no,
                answer_text: row.answer_text,
                answer_norm: row.answer_norm,
                updated_at: new Date().toISOString()
            };
            const { error } = await db().from('quiz_item_accepted_answers').upsert(payload, {
                onConflict: 'teacher_id,material_folder,sheet_id,page,item_no,answer_norm'
            });
            if (error) throw new Error('寫入全站可接受答案失敗：' + error.message);
        }
        for (let j = 0; j < removes.length; j++) {
            const row = removes[j];
            const { error } = await db().from('quiz_item_accepted_answers')
                .delete()
                .eq('teacher_id', teacherId)
                .eq('material_folder', row.fields.material_folder)
                .eq('sheet_id', row.fields.sheet_id)
                .eq('page', row.fields.page)
                .eq('item_no', row.fields.item_no)
                .eq('answer_norm', row.answer_norm);
            if (error) throw new Error('移除全站可接受答案失敗：' + error.message);
        }
        if ((adds.length || removes.length) && Q.invalidateUniversalAcceptedCache) {
            Q.invalidateUniversalAcceptedCache();
        }
    }

    return {
        fetchAssignment: fetchAssignment,
        fetchCompletionsForTask: fetchCompletionsForTask,
        fetchClassStudents: fetchClassStudents,
        saveQuizPaperPatch: saveQuizPaperPatch,
        saveCompletionRawData: saveCompletionRawData,
        batchSaveCompletions: batchSaveCompletions,
        persistUniversalAcceptedDiff: persistUniversalAcceptedDiff
    };
})();

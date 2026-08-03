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

    /** 取某一考試任務下、所有學生的 task_completions（含 id，供改分用） */
    async function fetchCompletionsForTask(assignmentId, taskId) {
        const { data, error } = await db()
            .from('task_completions')
            .select('id, student_id, class_id, status, score, raw_data, updated_at')
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

    /** 寫回單一學生 completion 的 raw_data（＋分數） */
    async function saveCompletionRawData(completionId, rawData, score) {
        const payload = { raw_data: rawData };
        if (score != null) payload.score = score;
        const { error } = await db().from('task_completions').update(payload).eq('id', completionId);
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

    return {
        fetchAssignment: fetchAssignment,
        fetchCompletionsForTask: fetchCompletionsForTask,
        fetchClassStudents: fetchClassStudents,
        saveQuizPaperPatch: saveQuizPaperPatch,
        saveCompletionRawData: saveCompletionRawData,
        batchSaveCompletions: batchSaveCompletions
    };
})();

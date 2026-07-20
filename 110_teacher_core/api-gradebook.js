/**
 * 📂 110_teacher_core/api-gradebook.js
 * 🎯 職責：老師端批改中樞的 API 網路通訊層 (Tier 4 Network)
 * 🚀 修正：對齊實際資料表名稱 `task_completions`
 */
window.GradebookAPI = (function() {
    'use strict';

    // 🌟 已修正為您的真實資料表名稱
    const TABLE_NAME = 'task_completions'; 
    const RELATION_COLUMN = 'assignment_id'; // ⚠️ 若稍後報錯找不到 assignment_id，請把這裡改成 'task_id'

    async function fetchMatrixData(classId) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        // 1. 取得該班級所有選課學生
        const { data: enrollments, error: stuErr } = await db
            .from('student_enrollments')
            .select(`user_id, profiles (name, raw_data)`)
            .eq('class_id', classId)
            .is('deleted_at', null);

        if (stuErr) throw new Error('無法讀取學生名單: ' + stuErr.message);

        // 2. 取得該班級的錄音作業
        const { data: assignments, error: assignErr } = await db
            .from('assignments')
            .select('id, title, due_date')
            .eq('class_id', classId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (assignErr) throw new Error('無法讀取作業清單: ' + assignErr.message);

        const assignmentIds = assignments.map(a => a.id);
        let completions = [];

        // 3. 取得繳交紀錄 (從正確的 task_completions 抓取)
        if (assignmentIds.length > 0) {
            const { data: subs, error: subErr } = await db
                .from(TABLE_NAME) 
                .select('*')
                .in(RELATION_COLUMN, assignmentIds)
                .is('deleted_at', null);

            if (subErr) {
                console.warn(`無法從 ${TABLE_NAME} 讀取繳交紀錄`, subErr);
                throw new Error('無法讀取繳交紀錄: ' + subErr.message);
            } else {
                completions = subs || [];
            }
        }

        // 4. 重組矩陣
        const matrixData = enrollments.map(en => {
            const studentId = en.user_id;
            const profile = Array.isArray(en.profiles) ? en.profiles[0] : en.profiles;
            const studentName = profile?.name || '未知學生';
            const defectBank = profile?.raw_data?.defect_vocab || {};

            const stuSubs = {};
            completions.filter(s => s.user_id === studentId).forEach(s => {
                stuSubs[s[RELATION_COLUMN]] = s;
            });

            return {
                student_id: studentId,
                student_name: studentName,
                defect_bank: defectBank,
                submissions: stuSubs
            };
        });

        return { matrixData, assignments };
    }

    async function publishGrade(payload) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        // 原子化更新 1：更新 task_completions
        const updateSubPromise = db
            .from(TABLE_NAME) 
            .update({ 
                raw_data: payload.raw_data_to_patch,
                score: payload.score_to_update 
            })
            .eq('id', payload.submission_id);

        // 原子化更新 2：更新學生的歷史缺陷字集 (寫入 profile)
        const { data: profile, error: profErr } = await db
            .from('profiles')
            .select('raw_data')
            .eq('id', payload.user_id)
            .single();

        if (profErr) throw new Error('無法取得學生個人資料以更新缺陷庫');

        const newProfileRaw = {
            ...(profile.raw_data || {}),
            defect_vocab: payload.defect_bank_to_patch
        };

        const updateProfPromise = db
            .from('profiles')
            .update({ raw_data: newProfileRaw })
            .eq('id', payload.user_id);

        const [subResult, profResult] = await Promise.all([updateSubPromise, updateProfPromise]);
        
        if (subResult.error) throw new Error('成績更新失敗: ' + subResult.error.message);
        if (profResult.error) throw new Error('缺陷字集更新失敗: ' + profResult.error.message);

        return true;
    }

    return { fetchMatrixData, publishGrade };
})();
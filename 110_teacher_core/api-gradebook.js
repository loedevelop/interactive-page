/**
 * 📂 110_teacher_core/api-gradebook.js
 * 🎯 職責：老師端批改中樞的 API 網路通訊層 (Tier 4 Network)
 * ⚠️ 鐵律：絕對禁止操作 DOM。只負責回傳 Promise 資料。
 */
window.GradebookAPI = (function() {
    'use strict';

    /**
     * 獲取該班所有資料 (學生名單 + 作業 + 繳交紀錄)，重組為矩陣格式
     */
    async function fetchMatrixData(classId) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        // 1. 取得該班級所有選課學生 (JOIN profiles 取得名字與歷史缺陷字集)
        const { data: enrollments, error: stuErr } = await db
            .from('student_enrollments')
            .select(`user_id, profiles (name, raw_data)`)
            .eq('class_id', classId)
            .is('deleted_at', null);

        if (stuErr) throw new Error('無法讀取學生名單: ' + stuErr.message);

        // 2. 取得該班級的錄音作業 (假設未指定 type，我們撈取該班所有作業以策安全)
        const { data: assignments, error: assignErr } = await db
            .from('assignments')
            .select('id, title, due_date')
            .eq('class_id', classId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (assignErr) throw new Error('無法讀取作業清單: ' + assignErr.message);

        const assignmentIds = assignments.map(a => a.id);
        let submissions = [];

        // 3. 取得這些作業的繳交紀錄 
        // ⚠️ [架構師提醒]: 若您的繳交紀錄表叫做 assignment_submissions，請在此處修改表名
        if (assignmentIds.length > 0) {
            const { data: subs, error: subErr } = await db
                .from('submissions') 
                .select('*')
                .in('assignment_id', assignmentIds)
                .is('deleted_at', null);

            if (subErr) throw new Error('無法讀取繳交紀錄: ' + subErr.message);
            submissions = subs || [];
        }

        // 4. 將資料重組為 Store 期待的二維矩陣格式 (Data Shaping)
        const matrixData = enrollments.map(en => {
            const studentId = en.user_id;
            // 處理 Supabase Join 可能回傳陣列的防呆
            const profile = Array.isArray(en.profiles) ? en.profiles[0] : en.profiles;
            const studentName = profile?.name || '未知學生';
            const defectBank = profile?.raw_data?.defect_vocab || {};

            const stuSubs = {};
            submissions.filter(s => s.user_id === studentId).forEach(s => {
                stuSubs[s.assignment_id] = s;
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

    /**
     * 儲存批改結果 (雙軌原子化寫入：同時更新成績與學生的歷史缺陷字集)
     */
    async function publishGrade(payload) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        // 原子化更新 1：更新繳交紀錄的 raw_data 與分數
        const updateSubPromise = db
            .from('submissions') // ⚠️ [架構師提醒]: 表名若不同請配合修改
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

        // 平行執行雙軌寫入
        const [subResult, profResult] = await Promise.all([updateSubPromise, updateProfPromise]);
        
        if (subResult.error) throw new Error('成績更新失敗: ' + subResult.error.message);
        if (profResult.error) throw new Error('缺陷字集更新失敗: ' + profResult.error.message);

        return true;
    }

    return {
        fetchMatrixData,
        publishGrade
    };
})();
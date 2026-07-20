/**
 * 📂 110_teacher_core/api-gradebook.js
 * 🎯 職責：老師端批改中樞的 API 網路通訊層 (Tier 4 Network)
 * 🚀 修正：實作 JSON 樹狀展開與扁平化 (Data Flattening)，徹底解決維度混淆 Bug
 */
window.GradebookAPI = (function() {
    'use strict';

    const TABLE_NAME = 'task_completions'; 
    const RELATION_COLUMN = 'task_id'; // 🎯 核心修正：精準對齊內層錄音子任務 ID

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

        // 2. 取得外層作業資料夾 (必須拉取 raw_data 以解析內部 tasks)
        const { data: rawAssignments, error: assignErr } = await db
            .from('assignments')
            .select('id, title, due_date, raw_data')
            .eq('class_id', classId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (assignErr) throw new Error('無法讀取作業清單: ' + assignErr.message);

        // 🌟 3. 核心重構：資料扁平化 (Flattening) & 遞迴展開 (Tree Traversal)
        const flatAudioTasks = [];
        
        rawAssignments.forEach(assign => {
            const tasksList = assign.raw_data?.tasks || [];
            
            function traverse(tasks) {
                if (!Array.isArray(tasks)) return;
                
                tasks.forEach(t => {
                    if (t.type === 'audio_record') {
                        // 萃取出具體的錄音任務
                        flatAudioTasks.push({
                            id: t.id, // 這是內部的真實 task_id (例如 task_1720000_123)
                            title: t.title || '未命名錄音',
                            assignment_id: assign.id, // 保留外層作業 ID 備用
                            assignment_title: assign.title, // 組合標題以便 UI 雙層辨識外層容器
                            due_date: t.due_date || assign.due_date
                        });
                    }
                    // 遇到巢狀群組 (group)，遞迴往下展開尋找 subTasks
                    if (t.type === 'group' && Array.isArray(t.subTasks)) {
                        traverse(t.subTasks); 
                    }
                });
            }
            traverse(tasksList);
        });

        // 4. 用「內部真實任務 ID」取得繳交紀錄
        const taskIds = flatAudioTasks.map(t => t.id);
        let completions = [];

        if (taskIds.length > 0) {
            const { data: subs, error: subErr } = await db
                .from(TABLE_NAME) 
                .select('*')
                .in(RELATION_COLUMN, taskIds) // 🌟 拿 task_id 去 IN 查詢
                .is('deleted_at', null);

            if (subErr) {
                console.warn(`無法從 ${TABLE_NAME} 讀取繳交紀錄`, subErr);
                throw new Error('無法讀取繳交紀錄: ' + subErr.message);
            } else {
                completions = subs || [];
            }
        }

        // 5. 重組矩陣 (將成績精準映射至 task_id)
        const matrixData = enrollments.map(en => {
            const studentId = en.user_id;
            const profile = Array.isArray(en.profiles) ? en.profiles[0] : en.profiles;
            const studentName = profile?.name || '未知學生';
            const defectBank = profile?.raw_data?.defect_vocab || {};

            const stuSubs = {};
            completions.filter(s => s.user_id === studentId).forEach(s => {
                stuSubs[s[RELATION_COLUMN]] = s; // 這裡以 task_id 作為 key 存入 dictionary
            });

            return {
                student_id: studentId,
                student_name: studentName,
                defect_bank: defectBank,
                submissions: stuSubs
            };
        });

        // 🌟 巧妙設計：將扁平化後的 flatAudioTasks 取名為 assignments 回傳，實現無痛嫁接 Store
        return { matrixData, assignments: flatAudioTasks };
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
/**
 * 📂 110_teacher_core/api-gradebook.js
 * 🎯 職責：老師端批改中樞的 API 網路通訊層 (Tier 4 Network)
 * 🚀 修正：實作超強健 JSON 解析與欄位兼容，不再因資料格式導致白畫面
 */
window.GradebookAPI = (function() {
    'use strict';

    const TABLE_NAME = 'task_completions'; 
    const RELATION_COLUMN = 'task_id';

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch(e) { return {}; }
        }
        return data;
    }

    async function fetchMatrixData(classId) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        // 1. 取得該班級所有選課學生
        const { data: enrollments, error: stuErr } = await db
            .from('student_enrollments')
            .select(`*, profiles (name, raw_data)`)
            .eq('class_id', classId)
            .is('deleted_at', null);

        if (stuErr) throw new Error('無法讀取學生名單: ' + stuErr.message);

        // 2. 取得外層作業資料夾 (🌟 修正: 讀取所有欄位以防 tasks 為獨立欄位)
        const { data: rawAssignments, error: assignErr } = await db
            .from('assignments')
            .select('*')
            .eq('class_id', classId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (assignErr) throw new Error('無法讀取作業清單: ' + assignErr.message);

        // 3. 資料扁平化 (Flattening) & 防禦性 JSON 解析
        const flatAudioTasks = [];
        
        rawAssignments.forEach(assign => {
            const raw = parseJSONB(assign.raw_data);
            
            // 防禦：相容 tasks 在獨立欄位或 raw_data 中的情況
            let tasksList = assign.tasks || raw.tasks || [];
            if (typeof tasksList === 'string') {
                try { tasksList = JSON.parse(tasksList); } catch (e) { tasksList = []; }
            }
            
            function traverse(tasks) {
                if (!Array.isArray(tasks)) return;
                
                tasks.forEach(t => {
                    if (t.type === 'audio_record' || t.type === 'recording' || t.type === 'audio') {
                        flatAudioTasks.push({
                            id: t.id || t.task_id, 
                            title: t.title || '未命名錄音',
                            assignment_id: assign.id,
                            assignment_title: assign.title || assign.name,
                            due_date: t.due_date || assign.due_date
                        });
                    }
                    if ((t.type === 'group' || t.type === 'folder') && (Array.isArray(t.subTasks) || Array.isArray(t.tasks))) {
                        traverse(t.subTasks || t.tasks); 
                    }
                });
            }
            traverse(tasksList);
        });

        // 4. 用「內部真實任務 ID」取得繳交紀錄
        const taskIds = flatAudioTasks.map(t => t.id).filter(Boolean);
        let completions = [];

        if (taskIds.length > 0) {
            // 切片以防止 in 查詢超過 URL 長度上限
            const chunkSize = 200;
            for (let i = 0; i < taskIds.length; i += chunkSize) {
                const chunk = taskIds.slice(i, i + chunkSize);
                try {
                    const res = await db.from(TABLE_NAME).select('*').in(RELATION_COLUMN, chunk).is('deleted_at', null);
                    if (res.error) throw res.error;
                    if (res.data) completions = completions.concat(res.data);
                } catch (err) {
                    console.warn(`無法從 ${TABLE_NAME} 讀取繳交紀錄`, err);
                }
            }
        }

        // 5. 重組矩陣
        const matrixData = enrollments.map(en => {
            const studentId = en.user_id || en.student_id || en.id;
            const profile = Array.isArray(en.profiles) ? en.profiles[0] : (en.profiles || {});
            const studentName = profile.name || '未知學生';
            
            const pRaw = parseJSONB(profile.raw_data);
            const defectBank = pRaw.defect_vocab || {};

            const stuSubs = {};
            completions.filter(s => String(s.user_id || s.student_id) === String(studentId)).forEach(s => {
                stuSubs[s[RELATION_COLUMN]] = s; 
            });

            return {
                student_id: studentId,
                student_name: studentName,
                defect_bank: defectBank,
                submissions: stuSubs
            };
        });

        return { matrixData, assignments: flatAudioTasks };
    }

    async function publishGrade(payload) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        const updateSubPromise = db
            .from(TABLE_NAME) 
            .update({ 
                raw_data: payload.raw_data_to_patch,
                score: payload.score_to_update 
            })
            .eq('id', payload.submission_id);

        const { data: profile, error: profErr } = await db
            .from('profiles')
            .select('raw_data')
            .eq('id', payload.user_id)
            .single();

        if (profErr) throw new Error('無法取得學生個人資料以更新缺陷庫');
        
        const pRaw = parseJSONB(profile.raw_data);
        const newProfileRaw = {
            ...pRaw,
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
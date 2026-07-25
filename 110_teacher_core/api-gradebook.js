/**
 * 📂 110_teacher_core/api-gradebook.js
 * 🎯 職責：老師端批改中樞的 API 網路通訊層
 */
window.GradebookAPI = (function() {
    'use strict';
    const TABLE_NAME = 'task_completions'; 
    const RELATION_COLUMN = 'task_id';

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') { try { return JSON.parse(data); } catch(e) { return {}; } }
        return data;
    }

    async function fetchMatrixData(classId) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        const { data: enrollments, error: stuErr } = await db.from('student_enrollments').select(`*, profiles (name, raw_data)`).eq('class_id', classId).is('deleted_at', null);
        if (stuErr) throw new Error('無法讀取學生名單: ' + stuErr.message);

        const { data: rawAssignments, error: assignErr } = await db.from('assignments').select('*').eq('class_id', classId).is('deleted_at', null).order('created_at', { ascending: true });
        if (assignErr) throw new Error('無法讀取作業清單: ' + assignErr.message);

        const flatAudioTasks = [];
        
        rawAssignments.forEach(assign => {
            const raw = parseJSONB(assign.raw_data);
            
            // 🌟 第 6 點：遞迴紀錄完整的 Breadcrumb 路徑
            function deepSearch(node, currentPath) {
                if (!node) return;
                if (Array.isArray(node)) {
                    node.forEach(child => deepSearch(child, currentPath));
                    return;
                }
                if (typeof node === 'object') {
                    const typeStr = String(node.type || '').toLowerCase();
                    const nodeTitle = node.title || node.name || '未命名';
                    
                    let nextPath = currentPath;
                    if (typeStr === 'group' || typeStr === 'folder') {
                        nextPath = currentPath ? `${currentPath} > ${nodeTitle}` : nodeTitle;
                    }

                    if (typeStr === 'audio_record' || typeStr.includes('audio') || typeStr.includes('record') || typeStr.includes('speaking')) {
                        const taskId = node.id || node.task_id;
                        if (taskId && !flatAudioTasks.find(t => String(t.id) === String(taskId))) {
                            flatAudioTasks.push({
                                id: taskId, 
                                title: nodeTitle,
                                assignment_id: assign.id,
                                // 🌟 組合包含外層名稱的詳細路徑
                                assignment_title: nextPath ? `${assign.title || assign.name} > ${nextPath}` : (assign.title || assign.name),
                                due_date: node.due_date || assign.due_date
                            });
                        }
                    }
                    
                    Object.keys(node).forEach(key => {
                        if (Array.isArray(node[key])) deepSearch(node[key], nextPath);
                        else if (typeof node[key] === 'object') deepSearch(node[key], nextPath);
                    });
                }
            }
            deepSearch(raw, '');
            let outerTasks = assign.tasks;
            if (typeof outerTasks === 'string') { try { outerTasks = JSON.parse(outerTasks); } catch(e) {} }
            deepSearch(outerTasks, '');
        });

        const taskIds = flatAudioTasks.map(t => t.id).filter(Boolean);
        let completions = [];

        if (taskIds.length > 0) {
            const chunkSize = 200;
            for (let i = 0; i < taskIds.length; i += chunkSize) {
                const chunk = taskIds.slice(i, i + chunkSize);
                try {
                    const res = await db.from(TABLE_NAME).select('*').in(RELATION_COLUMN, chunk).is('deleted_at', null);
                    if (res.error) throw res.error;
                    if (res.data) completions = completions.concat(res.data);
                } catch (err) { console.warn(`無法從 ${TABLE_NAME} 讀取紀錄`, err); }
            }
        }

        const matrixData = enrollments.map(en => {
            const studentId = en.user_id || en.student_id || en.id;
            const profile = Array.isArray(en.profiles) ? en.profiles[0] : (en.profiles || {});
            const studentName = profile.name || '未知學生';
            const pRaw = parseJSONB(profile.raw_data);
            const defectBank = pRaw.defect_vocab || {};

            const stuSubs = {};
            completions.filter(s => String(s.user_id || s.student_id) === String(studentId)).forEach(s => { stuSubs[s[RELATION_COLUMN]] = s; });

            return { student_id: studentId, student_name: studentName, defect_bank: defectBank, submissions: stuSubs };
        });

        return { matrixData, assignments: flatAudioTasks };
    }

    async function publishGrade(payload) {
        if (!window.supabaseClient) throw new Error("Supabase 未載入");
        const db = window.supabaseClient;

        const updatePayload = { raw_data: payload.raw_data_to_patch, score: payload.score_to_update };
        if (payload.status_to_update) updatePayload.status = payload.status_to_update;
        const updateSubPromise = db.from(TABLE_NAME).update(updatePayload).eq('id', payload.submission_id);
        const { data: profile, error: profErr } = await db.from('profiles').select('raw_data').eq('id', payload.user_id).single();
        if (profErr) throw new Error('無法取得學生資料');
        
        const pRaw = parseJSONB(profile.raw_data);
        const newProfileRaw = { ...pRaw, defect_vocab: payload.defect_bank_to_patch };
        const updateProfPromise = db.from('profiles').update({ raw_data: newProfileRaw }).eq('id', payload.user_id);

        const [subResult, profResult] = await Promise.all([updateSubPromise, updateProfPromise]);
        if (subResult.error) throw new Error('成績更新失敗: ' + subResult.error.message);
        if (profResult.error) throw new Error('缺陷字集更新失敗: ' + profResult.error.message);

        return true;
    }

    return { fetchMatrixData, publishGrade };
})();
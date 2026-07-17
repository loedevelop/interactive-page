/**
 * 📂 檔案路徑：020_js_core/api.js
 * 🌟 v6.6 白皮書終極版：GAS 支援子資料夾建立 (Nested Folder Support)
 */

const ApiService = (() => {
    
    const safeParseJSON = (rawData) => {
        if (!rawData) return {};
        if (typeof rawData === 'object') return rawData;
        try {
            return JSON.parse(rawData);
        } catch (error) {
            console.warn("[API Warning] JSONB 解析失敗，已啟動預設空物件保護機制:", rawData);
            return {};
        }
    };

    const fetchClasses = async () => {
        try {
            const sessionStr = localStorage.getItem('LogOnEnglish_Session');
            if (!sessionStr) throw new Error("遺失登入憑證，請重新登入。");
            const session = JSON.parse(sessionStr);
            const userId = session.id;
            const isAdmin = session.activeContext?.role === 'admin' || session.role === 'admin';

            let data, error;

            if (isAdmin) {
                const res = await window.supabaseClient
                    .from('classes')
                    .select('*, class_staff(user_id, staff_role)')
                    .is('deleted_at', null)
                    .order('created_at', { ascending: false });
                data = res.data;
                error = res.error;
            } else {
                const res = await window.supabaseClient
                    .from('classes')
                    .select('*, class_staff!inner(staff_role, user_id)')
                    .eq('class_staff.user_id', userId)
                    .is('deleted_at', null)
                    .order('created_at', { ascending: false });
                data = res.data;
                error = res.error;
            }

            if (error) throw error;
            if (!data) return [];

            return data.map(row => {
                const parsedRaw = safeParseJSON(row.raw_data);
                let role = 'ta_junior'; 
                if (isAdmin) {
                    role = 'admin';
                } else if (row.class_staff && row.class_staff.length > 0) {
                    role = row.class_staff[0].staff_role;
                }

                return {
                    ...row, 
                    startDate: row.start_date || '',
                    endDate: row.end_date || '',
                    meetDays: row.meet_days || [],
                    calcMode: row.calc_mode || 'single',
                    staff_role: role,
                    raw_data: parsedRaw,
                    rawData: parsedRaw
                };
            });
        } catch (error) {
            console.error("[API Error - fetchClasses]", error);
            throw new Error("無法獲取班級列表，請檢查網路連線或資料庫狀態。");
        }
    };

    const fetchStudents = async (classId) => {
        try {
            if (!classId) throw new Error("缺少 classId 參數");

            const { data, error } = await window.supabaseClient
                .from('student_enrollments')
                .select(`
                    user_id,
                    raw_data,
                    profiles:user_id (id, name, email, phone, raw_data)
                `)
                .eq('class_id', classId)
                .is('deleted_at', null);

            if (error) throw error;
            if (!data) return [];
            
            return data.map(row => {
                const parsedRaw = safeParseJSON(row.raw_data);
                let profileRaw = {};
                const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                if (profileObj && profileObj.raw_data) profileRaw = safeParseJSON(profileObj.raw_data);

                return {
                    ...row,
                    raw_data: parsedRaw,
                    rawData: parsedRaw,
                    profiles: {
                        ...(profileObj || {}),
                        raw_data: profileRaw,
                        rawData: profileRaw
                    }
                };
            });
        } catch (error) {
            console.error("[API Error - fetchStudents]", error);
            throw new Error("無法獲取學生名單，請稍後再試。");
        }
    };

    const fetchClassStaff = async (classId) => {
        try {
            if (!classId) throw new Error("缺少 classId 參數");

            const { data, error } = await window.supabaseClient
                .from('class_staff')
                .select(`
                    user_id,
                    staff_role,
                    profiles:user_id (id, name, email, phone, raw_data)
                `)
                .eq('class_id', classId)
                .is('deleted_at', null);

            if (error) throw error;
            if (!data) return [];
            
            return data.map(row => {
                const profileObj = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                let profileRaw = {};
                if (profileObj && profileObj.raw_data) profileRaw = safeParseJSON(profileObj.raw_data);

                return {
                    ...row,
                    profiles: {
                        ...(profileObj || {}),
                        raw_data: profileRaw,
                        rawData: profileRaw
                    }
                };
            });
        } catch (error) {
            console.error("[API Error - fetchClassStaff]", error);
            throw new Error("無法獲取教職員名單，請稍後再試。");
        }
    };

    const fetchAssignments = async (userId) => {
        try {
            if (!userId) throw new Error("缺少 userId 參數");

            const [stdRes, staffRes] = await Promise.all([
                window.supabaseClient.from('student_enrollments').select('class_id').eq('user_id', userId).is('deleted_at', null),
                window.supabaseClient.from('class_staff').select('class_id').eq('user_id', userId).is('deleted_at', null)
            ]);

            let classIds = [];
            if (!stdRes.error && stdRes.data) classIds.push(...stdRes.data.map(e => e.class_id));
            if (!staffRes.error && staffRes.data) classIds.push(...staffRes.data.map(e => e.class_id));

            classIds = [...new Set(classIds)];

            const sessionStr = localStorage.getItem('LogOnEnglish_Session');
            let isAdmin = false;
            if (sessionStr) {
                const session = JSON.parse(sessionStr);
                isAdmin = session.activeContext?.role === 'admin' || session.role === 'admin';
            }

            let query = window.supabaseClient
                .from('assignments')
                .select('*')
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (!isAdmin) {
                if (classIds.length === 0) return [];
                query = query.in('class_id', classIds);
            }

            const { data: assignments, error: assignErr } = await query;

            if (assignErr) throw assignErr;
            
            return (assignments || []).map(task => ({
                ...task,
                raw_data: safeParseJSON(task.raw_data),
                rawData: safeParseJSON(task.raw_data)
            }));

        } catch (error) {
            console.error("[API Error - fetchAssignments]", error);
            throw new Error("無法獲取作業清單，請確認資料庫狀態。");
        }
    };

    const syncProgress = async (studentId, taskId, isCompleted) => {
        try {
            if (!studentId || !taskId) throw new Error("缺少同步進度所需之參數");

            const { error } = await window.supabaseClient
                .from('student_task_progress')
                .upsert({
                    student_id: studentId,
                    task_id: taskId,
                    is_completed: isCompleted,
                    updated_at: new Date().toISOString()
                }, { 
                    onConflict: 'student_id, task_id' 
                });

            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error("[API Error - syncProgress]", error);
            throw new Error("進度同步失敗：" + error.message);
        }
    };

    const archiveClass = async (classId) => {
        try {
            if (!classId) throw new Error("必須提供班級 ID");

            const { error } = await window.supabaseClient.rpc('archive_class_atomic', { target_class_id: classId });
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error("[API Error - archiveClass RPC]", error);
            throw new Error(`班級封存操作失敗。請確認您具備 Admin 或 Primary Teacher 權限。(${error.message})`);
        }
    };

    const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec';

    // 🌟 擴充：支援 parentFolderId 建立嵌套資料夾
    const createGASFolder = async (folderName, parentFolderId = null) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); 

        try {
            const payload = { action: 'create_folder', folderName };
            if (parentFolderId) payload.parentFolderId = parentFolderId;

            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`連線異常 (HTTP ${response.status})`);
            const result = JSON.parse(await response.text());
            
            if (result.status !== 'success') throw new Error(result.message || '雲端無法建立資料夾');
            return result; 
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('建立資料夾逾時，請檢查網路。');
            console.error("[API Error - createGASFolder]", error);
            throw error;
        }
    };

    const uploadToGAS = async (base64Data, fileName, mimeType, folderId, assignmentId = null, taskId = null) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); 

        try {
            const payload = { 
                action: 'upload_file',
                fileData: base64Data, 
                fileName, 
                mimeType, 
                folderId 
            };
            if (assignmentId) payload.assignmentId = assignmentId;
            if (taskId) payload.taskId = taskId;

            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`連線異常 (HTTP ${response.status})`);
            const result = JSON.parse(await response.text());
            
            if (result.status !== 'success') {
                throw new Error(result.message || '雲端儲存空間回報未知錯誤');
            }
            return result; 
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('上傳逾時：檔案可能過大或網路不穩定，請分批上傳或檢查網路連線。');
            }
            console.error("[API Error - uploadToGAS]", error);
            throw error;
        }
    };

    return { 
        fetchClasses, fetchStudents, fetchClassStaff, fetchAssignments, syncProgress, archiveClass, createGASFolder, uploadToGAS
    };
})();

window.ApiService = ApiService;
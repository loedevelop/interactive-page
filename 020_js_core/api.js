/**
 * 📂 檔案路徑：020_js_core/api.js
 * 🌟 v6.2 白皮書終極版：維持嚴格資料分流，新增 fetchClassStaff 教職員獲取邏輯
 * 描述：網路通訊層核心樞紐。純粹負責與 Supabase 進行安全的資料交換。
 */

const ApiService = (() => {
    
    // ==========================================
    // 🛡️ 內部工具函式 (Internal Utilities)
    // ==========================================
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

    // ==========================================
    // 1. 班級與名單獲取 (Class & Roster Fetchers)
    // ==========================================
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

    // 🎓 專職獲取「學生」名單
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
                
                if (profileObj && profileObj.raw_data) {
                    profileRaw = safeParseJSON(profileObj.raw_data);
                }

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

    // 🧑‍🏫 全新加入：專職獲取「教職員/團隊」名單
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
                if (profileObj && profileObj.raw_data) {
                    profileRaw = safeParseJSON(profileObj.raw_data);
                }

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

    // ==========================================
    // 2. 作業與進度管理 
    // ==========================================
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

    // ==========================================
    // 3. 系統破壞性操作 (RPC Atomic Calls)
    // ==========================================
    const archiveClass = async (classId) => {
        try {
            if (!classId) throw new Error("必須提供班級 ID");

            const { error } = await window.supabaseClient.rpc('archive_class_atomic', { 
                target_class_id: classId 
            });

            if (error) throw error;
            return { success: true };
            
        } catch (error) {
            console.error("[API Error - archiveClass RPC]", error);
            throw new Error(`班級封存操作失敗。請確認您具備 Admin 或 Primary Teacher 權限。(${error.message})`);
        }
    };

    return { 
        fetchClasses, 
        fetchStudents, 
        fetchClassStaff,
        fetchAssignments, 
        syncProgress,
        archiveClass
    };
})();

window.ApiService = ApiService;
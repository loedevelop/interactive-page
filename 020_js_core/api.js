/**
 * 📂 檔案路徑：020_js_core/api.js
 * 🌟 v6.8 權限精準控制版：GAS 支援子資料夾建立與動態權限 (setSharing)
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

    const normalizeRpcJsonArray = (data) => {
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') {
            try {
                const parsed = JSON.parse(data);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_e) {
                return [];
            }
        }
        return [];
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
                    const myMembership = row.class_staff.find(function(s) { return s.user_id === userId; });
                    if (myMembership && myMembership.staff_role) {
                        role = myMembership.staff_role;
                    } else {
                        role = row.class_staff[0].staff_role;
                    }
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

    const syncProgress = async (studentId, taskId, isCompleted, assignmentId) => {
        try {
            if (!studentId || !taskId || !assignmentId) throw new Error("缺少同步進度所需之參數（assignmentId／taskId／studentId 缺一不可）");

            // student_task_progress.class_id 為必填欄位；呼叫端（進度格子）目前不便逐層傳遞 classId，
            // 這裡用 assignment_id 反查一次，換取上層呼叫鏈（onclick→toggleTask→enqueueTask）維持單純
            const { data: assignRow, error: assignErr } = await window.supabaseClient
                .from('assignments')
                .select('class_id')
                .eq('id', assignmentId)
                .single();
            if (assignErr || !assignRow) throw new Error("找不到對應作業，無法同步進度：" + (assignErr ? assignErr.message : assignmentId));

            const { error } = await window.supabaseClient
                .from('student_task_progress')
                .upsert({
                    assignment_id: assignmentId,
                    class_id: assignRow.class_id,
                    task_id: taskId,
                    student_id: studentId,
                    is_completed: isCompleted,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'assignment_id,task_id,student_id'
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

    const fetchArchivedClasses = async () => {
        try {
            const { data, error } = await window.supabaseClient.rpc('list_archived_classes');
            if (error) throw error;
            const rows = normalizeRpcJsonArray(data);
            return rows.map(function (row) {
                const parsedRaw = safeParseJSON(row.raw_data);
                return Object.assign({}, row, { raw_data: parsedRaw, rawData: parsedRaw });
            });
        } catch (error) {
            console.error("[API Error - fetchArchivedClasses]", error);
            throw new Error('無法載入封存班級：' + error.message);
        }
    };

    const fetchArchivedClassAssignments = async (classId) => {
        try {
            if (!classId) throw new Error('缺少 classId');
            const { data, error } = await window.supabaseClient.rpc('fetch_archived_class_assignments', { target_class_id: classId });
            if (error) throw error;
            const rows = normalizeRpcJsonArray(data);
            return rows.map(function (task) {
                const parsedRaw = safeParseJSON(task.raw_data);
                let tasks = task.tasks;
                if (typeof tasks === 'string') {
                    try { tasks = JSON.parse(tasks); } catch (_e) { tasks = []; }
                }
                return Object.assign({}, task, {
                    tasks: tasks,
                    raw_data: parsedRaw,
                    rawData: parsedRaw
                });
            });
        } catch (error) {
            console.error("[API Error - fetchArchivedClassAssignments]", error);
            throw new Error('無法載入封存班作業：' + error.message);
        }
    };

    const restoreClass = async (classId) => {
        try {
            const { data, error } = await window.supabaseClient.rpc('restore_class_atomic', { target_class_id: classId });
            if (error) throw error;
            return { success: true, detail: data };
        } catch (error) {
            console.error("[API Error - restoreClass]", error);
            throw new Error('恢復班級失敗：' + error.message);
        }
    };

    const purgeClassPermanent = async (classId) => {
        try {
            const { error } = await window.supabaseClient.rpc('purge_class_permanent', { target_class_id: classId });
            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error("[API Error - purgeClassPermanent]", error);
            throw new Error('永久刪除失敗：' + error.message);
        }
    };

    const insertAssignment = async (payload) => {
        try {
            const { data, error } = await window.supabaseClient.from('assignments').insert([payload]).select().single();
            if (error) throw error;
            return data;
        } catch (error) {
            console.error("[API Error - insertAssignment]", error);
            throw new Error('建立作業失敗：' + error.message);
        }
    };

    const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec';
    const SUPABASE_PROJECT_URL = 'https://ueigcfdpnsohmkavbzmw.supabase.co';
    // 與 supabase-client.js 相同的 publishable key（供 <audio src> 呼叫 Edge Function）
    const SUPABASE_ANON_KEY = 'sb_publishable_Ps-C0ZFw5FlV07GGgFCJfw_jvdXSaRw';

    const getAudioStreamUrl = (fileId) => {
        if (!fileId) return '';
        // 與錄音艙／切片播放同一條路（Supabase stream-audio）。
        // 禁止把 GAS Web App URL 當 <audio src>（會 redirect → 0:00/0:00）。
        return `${SUPABASE_PROJECT_URL}/functions/v1/stream-audio?file_id=${encodeURIComponent(String(fileId))}&apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}`;
    };

    const getGASAudioStreamUrl = (fileId) => {
        if (!fileId) return '';
        return `${GAS_API_URL}?action=stream_audio&fileId=${encodeURIComponent(String(fileId))}`;
    };

    const getDriveFileViewUrl = (fileId) => {
        if (!fileId) return '';
        return `https://drive.google.com/file/d/${encodeURIComponent(String(fileId))}/view`;
    };

    const getDriveFilePreviewUrl = (fileId) => {
        if (!fileId) return '';
        // 圖片縮圖；音檔／文件仍以 view 為主
        return `https://drive.google.com/thumbnail?id=${encodeURIComponent(String(fileId))}&sz=w640`;
    };

    // 🌟 核心擴充修復：新增 requireShare 參數，精準控制是否開放權限
    const createGASFolder = async (folderName, parentFolderId = null, requireShare = false, shareEmails = null, extraOptions = null) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); 

        try {
            const payload = { action: 'create_folder', folderName };
            if (parentFolderId) payload.parentFolderId = parentFolderId;
            if (requireShare) payload.requireShare = true;
            if (shareEmails) {
                payload.shareEmails = Array.isArray(shareEmails) ? shareEmails : [shareEmails];
            }
            if (extraOptions && typeof extraOptions === 'object') {
                if (extraOptions.rootPath) payload.rootPath = extraOptions.rootPath;
                if (extraOptions.folderPath) payload.folderPath = extraOptions.folderPath;
            }

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

    const renameGASFolder = async (folderId, folderName) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const cleanFolderId = String(folderId || '').trim();
            const cleanName = String(folderName || '').trim();
            if (!cleanFolderId || !cleanName) throw new Error('缺少資料夾 ID 或新名稱');

            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'rename_folder',
                    folderId: cleanFolderId,
                    folderName: cleanName
                })
            });

            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`連線異常 (HTTP ${response.status})`);
            const result = JSON.parse(await response.text());
            if (result.status !== 'success') throw new Error(result.message || '雲端無法重新命名資料夾');
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('重新命名逾時，請檢查網路。');
            console.error('[API Error - renameGASFolder]', error);
            throw error;
        }
    };

    const renameGASParentFolder = async (folderId, folderName) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const cleanFolderId = String(folderId || '').trim();
            const cleanName = String(folderName || '').trim();
            if (!cleanFolderId || !cleanName) throw new Error('缺少資料夾 ID 或新名稱');

            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'rename_parent_folder',
                    folderId: cleanFolderId,
                    folderName: cleanName
                })
            });

            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`連線異常 (HTTP ${response.status})`);
            const result = JSON.parse(await response.text());
            if (result.status !== 'success') throw new Error(result.message || '雲端無法重新命名上層資料夾');
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('重新命名逾時，請檢查網路。');
            console.error('[API Error - renameGASParentFolder]', error);
            throw error;
        }
    };

    const ensureGASFolderSharing = async (folderId, options = {}) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const cleanFolderId = String(folderId || '').trim();
            if (!cleanFolderId) throw new Error('缺少資料夾 ID');

            const payload = {
                action: 'ensure_folder_sharing',
                folderId: cleanFolderId,
                permission: options.permission || 'edit'
            };

            const emails = options.shareEmails || options.shareEmail || [];
            if (emails && emails.length) {
                payload.shareEmails = Array.isArray(emails) ? emails : [emails];
            }

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

            if (result.status !== 'success') throw new Error(result.message || '無法設定資料夾權限');
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('設定權限逾時，請檢查網路。');
            console.error("[API Error - ensureGASFolderSharing]", error);
            throw error;
        }
    };

    const extractDriveFolderId = (raw) => {
        if (!raw) return '';
        const trimmed = String(raw).trim();
        let match = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) return match[1];
        match = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) return match[1];
        match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) return match[1];
        if (!/^https?:\/\//i.test(trimmed) && /^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
        return '';
    };

    // GAS 上傳成功時是 200+JSON（含業務錯誤如「找不到資料夾」也是 200）；只有真正的網路層／轉址層
    // 異常（fetch 直接失敗、非 2xx、或回應不是預期的 JSON——常見於 LINE／IG 內建瀏覽器擋掉 Google
    // 302 轉址到 script.googleusercontent.com 的第三方 Cookie）才值得重試一次，業務錯誤重試無意義。
    const uploadToGASOnce = async (payload) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
            const response = await fetch(GAS_API_URL, {
                method: 'POST',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const err = new Error(`連線異常 (HTTP ${response.status})`);
                err.isRetryable = true;
                throw err;
            }
            const rawText = await response.text();
            let result;
            try {
                result = JSON.parse(rawText);
            } catch (_parseErr) {
                const err = new Error('雲端回應格式異常，請稍後再試或通知老師檢查 GAS 部署。');
                err.isRetryable = true;
                throw err;
            }

            if (result.status !== 'success') {
                throw new Error(result.message || '雲端儲存空間回報未知錯誤');
            }
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('上傳逾時：檔案可能過大或網路不穩定，請分批上傳或檢查網路連線。');
            }
            if (error instanceof TypeError) {
                error.isRetryable = true; // fetch 層級直接失敗（離線／DNS／CORS），非業務錯誤
            }
            throw error;
        }
    };

    const uploadToGAS = async (base64Data, fileName, mimeType, folderId, assignmentId = null, taskId = null, oldFileId = null) => {
        try {
            const cleanFolderId = extractDriveFolderId(folderId);
            if (!cleanFolderId) {
                throw new Error('學生專屬資料夾 ID 無效，請請老師重新綁定 Drive 資料夾。');
            }

            const payload = { 
                action: 'upload_file',
                fileData: base64Data, 
                fileName, 
                mimeType, 
                folderId: cleanFolderId
                // 不傳 subFolderName：直接寫入學生繳交夾（見 Code.gs upload_file）
            };
            if (assignmentId) payload.assignmentId = assignmentId;
            if (taskId) payload.taskId = taskId;
            // 「取代特定已上傳檔」：指定要被覆蓋的舊檔 fileId，GAS 會在新檔成功上傳後才 trash 舊檔。
            // 見 .cursor/rules/drive-folder-upload-invariants.mdc「取代特定已上傳檔」一節。
            if (oldFileId) payload.oldFileId = oldFileId;

            try {
                return await uploadToGASOnce(payload);
            } catch (firstError) {
                if (!firstError.isRetryable) throw firstError;
                console.warn("[API Warning - uploadToGAS] 第一次上傳失敗，1.5 秒後自動重試一次：", firstError.message);
                await new Promise(resolve => setTimeout(resolve, 1500));
                try {
                    return await uploadToGASOnce(payload);
                } catch (secondError) {
                    if (secondError.isRetryable) {
                        throw new Error('網路連線不穩定，已自動重試一次仍失敗。請確認網路連線正常，或改用 Chrome／Safari 開啟本頁後再試一次（避免使用 LINE／IG 等 App 內建瀏覽器）。');
                    }
                    throw secondError;
                }
            }
        } catch (error) {
            console.error("[API Error - uploadToGAS]", error);
            throw error;
        }
    };

    return { 
        fetchClasses, fetchArchivedClasses, fetchArchivedClassAssignments,
        fetchStudents, fetchClassStaff, fetchAssignments, syncProgress,
        archiveClass, restoreClass, purgeClassPermanent, insertAssignment,
        createGASFolder, renameGASFolder, renameGASParentFolder, ensureGASFolderSharing, uploadToGAS, getAudioStreamUrl, getGASAudioStreamUrl, getDriveFileViewUrl, getDriveFilePreviewUrl
    };
})();

window.ApiService = ApiService;
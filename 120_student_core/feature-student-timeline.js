/**
 * 📂 檔案路徑：120_student_core/feature-student-timeline.js
 * 🌟 UX 視覺終極打磨版 & API 解耦瘦身版 (v63 完整版)
 * 🚀 核心修復：包含完整 60fps 追蹤、一鍵喚醒 AI，並導入全新的「時間軸切片」與「TTS 播放」引擎！
 */

window.FeatureStudentTimeline = (() => {
    let assignments = [];
    let completedTasks = []; 
    let studentDriveUrl = null; 
    let studentUsername = '學生';
    let currentClassConfig = null; 

    // 🚀 v63 全域音效播放引擎
    let _audioCache = {};
    let _currentPlaying = null;
    let _pauseTimeout = null;

    const scrollToCurrentWeek = () => {
        const targetNode = document.querySelector('.timeline-node[data-is-current="true"]');
        if (targetNode) {
            targetNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    const jumpToAssignment = (assignmentId) => {
        if (!assignmentId) return false;
        const el = document.getElementById('assign-block-' + assignmentId)
            || document.querySelector('.student-assign-block[data-assignment-id="' + assignmentId + '"]');
        if (!el) return false;
        el.style.borderColor = '#F59E0B';
        el.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.35)';
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () {
            el.style.borderColor = '#F1F5F9';
            el.style.boxShadow = '0 2px 5px rgba(0,0,0,0.02)';
        }, 2600);
        return true;
    };

    function extractDriveFolderId(raw) {
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
    }

    function resolveStudentUploadFolderId() {
        const folderId = extractDriveFolderId(studentDriveUrl);
        if (!folderId) {
            throw new Error('老師尚未為您設定專屬資料夾，或資料夾連結無效！');
        }
        return folderId;
    }

    async function getAuthContext() {
        if (!window.supabaseClient) throw new Error("系統連線尚未準備完成");
        const { data: { user }, error } = await window.supabaseClient.auth.getUser();
        if (error || !user) throw new Error("授權無效或已登出");
        const classId = sessionStorage.getItem('currentClassId');
        if (!classId) throw new Error("尚未選擇班級");
        if (!isUuid(classId)) {
            throw new Error('班級 ID 異常（' + classId + '）。請重新選擇班級或清除瀏覽器快取後再登入。');
        }
        return { userId: user.id, classId };
    }

    function sanitizeUploadNamePart(s) {
        return String(s || '')
            .replace(/<[^>]*>?/g, '')
            .replace(/[\\/:*?"<>|#;]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 80) || '任務';
    }

    function taskTitleForUpload(taskConfig) {
        if (!taskConfig) return '任務';
        const title = String(taskConfig.title || '').replace(/<[^>]*>/g, '').trim();
        if (title) return title;
        const range = taskConfig.raw_data && taskConfig.raw_data.material_range
            ? String(taskConfig.raw_data.material_range).trim() : '';
        return range || '任務';
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
    }

    /** 混血型別：classes.id=UUID；assignments.id 可能仍是 BIGINT 或已遷 UUID */
    function isAssignmentId(value) {
        const s = String(value == null ? '' : value).trim();
        if (!s) return false;
        if (isUuid(s)) return true;
        return /^\d+$/.test(s);
    }

    function assertAssignmentUuid(assignmentId, label) {
        if (!isAssignmentId(assignmentId)) {
            throw new Error((label || '作業 ID') + ' 格式錯誤：' + String(assignmentId)
                + '。請強制重新整理頁面後再試；若仍失敗請聯絡老師檢查作業設定。');
        }
    }

    /** BIGINT 作業主鍵傳 Number，UUID 維持字串（給 RPC／寫表用） */
    function coerceAssignmentIdForDb(assignmentId) {
        const s = String(assignmentId == null ? '' : assignmentId).trim();
        if (/^\d+$/.test(s)) return Number(s);
        return s;
    }

    async function ensureJsPDFLoaded() {
        if (window.jspdf) return true;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = () => resolve(true);
            script.onerror = () => reject(new Error('無法載入 PDF 合併模組，請檢查網路連線。'));
            document.head.appendChild(script);
        });
    }

    function isAudioUploadFile(file) {
        if (!file) return false;
        const name = String(file.name ? file.name : '').toLowerCase();
        const mime = String(file.type ? file.type : '').toLowerCase();
        if (mime.indexOf('audio/') === 0) return true;
        if (mime.indexOf('video/mp4') === 0) return true;
        return /\.(mp3|wav|m4a|ogg|aac|webm|flac|amr|3gp|wma|mp4|opus|aiff|caf)$/.test(name);
    }

    function resolveAudioMime(file, ext) {
        let mime = file.type;
        if (!mime || mime === '' || mime === 'text/plain') {
            const lowExt = String(ext ? ext : '').toLowerCase();
            if (lowExt === '.mp3') mime = 'audio/mpeg';
            else if (lowExt === '.wav') mime = 'audio/wav';
            else if (lowExt === '.m4a') mime = 'audio/mp4';
            else if (lowExt === '.ogg') mime = 'audio/ogg';
            else if (lowExt === '.aac') mime = 'audio/aac';
            else if (lowExt === '.webm') mime = 'audio/webm';
            else if (lowExt === '.flac') mime = 'audio/flac';
            else mime = 'audio/mpeg';
        }
        return mime;
    }

    function findTaskConfig(assignmentId, taskId) {
        const assignRecord = assignments.find(a => String(a.id) === String(assignmentId));
        if (!assignRecord) return null;
        let parsedTasks = [];
        if (typeof assignRecord.tasks === 'string') {
            try { parsedTasks = JSON.parse(assignRecord.tasks); } catch (e) { parsedTasks = []; }
        } else if (Array.isArray(assignRecord.tasks)) {
            parsedTasks = assignRecord.tasks;
        }
        let foundTask = null;
        const findTaskRecursive = (taskList) => {
            if (!taskList || !Array.isArray(taskList)) return;
            for (let i = 0; i < taskList.length; i++) {
                const t = taskList[i];
                if (String(t.id) === String(taskId)) {
                    foundTask = t;
                    return;
                }
                if (t.type === 'group' && t.subTasks) findTaskRecursive(t.subTasks);
            }
        };
        findTaskRecursive(parsedTasks);
        return foundTask;
    }

    function findParentRangeGroup(assignmentId, taskId) {
        const assignRecord = assignments.find(a => String(a.id) === String(assignmentId));
        if (!assignRecord) return null;
        let parsedTasks = [];
        if (typeof assignRecord.tasks === 'string') {
            try { parsedTasks = JSON.parse(assignRecord.tasks); } catch (e) { parsedTasks = []; }
        } else if (Array.isArray(assignRecord.tasks)) {
            parsedTasks = assignRecord.tasks;
        }
        let foundParent = null;
        const walk = (taskList, parentRange) => {
            if (!taskList || !Array.isArray(taskList) || foundParent) return;
            for (let i = 0; i < taskList.length; i++) {
                const t = taskList[i];
                if (String(t.id) === String(taskId)) {
                    foundParent = parentRange;
                    return;
                }
                if (t.type === 'group' && t.subTasks) {
                    const isPack = (window.UIStudentTimelineTemplates
                        && typeof window.UIStudentTimelineTemplates.groupIsRangePack === 'function')
                        ? window.UIStudentTimelineTemplates.groupIsRangePack(t)
                        : !!(t.raw_data && (t.raw_data.group_role === 'range' || t.raw_data.pack_combo_id));
                    const next = isPack ? t : parentRange;
                    walk(t.subTasks, next);
                    if (foundParent) return;
                }
            }
        };
        walk(parsedTasks, null);
        return foundParent;
    }

    function taskSupportsAIGrading(task, assignmentId) {
        if (!task) return false;
        if (window.TaskScriptResolver && typeof window.TaskScriptResolver.taskSupportsAIGrading === 'function') {
            const assignRecord = assignments.find(a => String(a.id) === String(assignmentId));
            const parsedTasks = assignRecord
                ? window.TaskScriptResolver.parseTasks(assignRecord.tasks)
                : [];
            return window.TaskScriptResolver.taskSupportsAIGrading(task, parsedTasks);
        }
        const raw = task.raw_data ? task.raw_data : {};
        if (raw.use_ai_grading === false) return false;
        if (raw.use_ai_grading === true) return true;
        // 備援路徑（TaskScriptResolver 未載入時）：只有 audio_record 有勾選框可控，
        // drive 沒有入口讓老師關閉，不可預設開啟。與上方 TaskScriptResolver 版本同步。
        if (task.type === 'audio_record') return true;
        return false;
    }

    function resolveTaskScriptText(assignmentId, taskId, taskConfig) {
        const assignRecord = assignments.find(a => String(a.id) === String(assignmentId));
        const parsedTasks = assignRecord && window.TaskScriptResolver
            ? window.TaskScriptResolver.parseTasks(assignRecord.tasks)
            : [];
        if (window.TaskScriptResolver && typeof window.TaskScriptResolver.resolveScriptSource === 'function') {
            const resolved = window.TaskScriptResolver.resolveScriptSource(parsedTasks, taskId);
            if (resolved && resolved.scriptText) return String(resolved.scriptText).trim();
        }
        const raw = (taskConfig && taskConfig.raw_data) ? taskConfig.raw_data : {};
        return String((taskConfig && taskConfig.original_script) || raw.original_script || '').trim();
    }

    async function ensureFeatureStudentAudioReady() {
        if (window.FeatureStudentAudio && typeof window.FeatureStudentAudio.convertBlobToWav === 'function') {
            return true;
        }
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (window.FeatureStudentAudio && typeof window.FeatureStudentAudio.convertBlobToWav === 'function') {
                return true;
            }
        }
        return false;
    }

    function applyLocalCompletionAfterAudioSubmit(assignmentId, taskId, fileId, audioUrl, extraRaw, markComplete) {
        const compositeKey = `${assignmentId}_${taskId}`;
        if (markComplete !== false) {
            if (!completedTasks.includes(compositeKey)) completedTasks.push(compositeKey);
        } else {
            completedTasks = completedTasks.filter(function (id) { return id !== compositeKey; });
        }
        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
        const audioUrlStr = audioUrl ? String(audioUrl) : '';
        const rawPatch = Object.assign({
            drive_file_ids: fileId ? [String(fileId)] : [],
            student_audio_url: audioUrlStr,
            audio_url: audioUrlStr,
            submitted_files: fileId ? [{ id: String(fileId), mime: 'audio/wav', name: 'recording.wav' }] : []
        }, extraRaw || {});
        let tempRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId));
        if (tempRecord) {
            tempRecord.status = 'ai_processing';
            const prevRaw = tempRecord.raw_data ? tempRecord.raw_data : {};
            // 分批提交（一頁一檔）時，本地樂觀快取也要跟 DB 端合併邏輯一致：
            // 依 unit_key 合併，不能讓第二批直接整組覆寫掉第一批已記錄的頁，
            // 否則同一個分頁還沒重新整理前，第三批又會誤判成「前面都還沒交」。
            const prevSegs = Array.isArray(prevRaw.audio_segments) ? prevRaw.audio_segments : [];
            const newSegs = Array.isArray(rawPatch.audio_segments) ? rawPatch.audio_segments : null;
            let mergedSegs = newSegs;
            if (newSegs && prevSegs.length && prevSegs.some(function (s) { return String((s && s.unit_key) || '').trim(); })) {
                const newKeys = new Set(newSegs.map(function (s) { return String((s && s.unit_key) || '').trim(); }).filter(Boolean));
                const keptOld = prevSegs.filter(function (s) {
                    const key = String((s && s.unit_key) || '').trim();
                    return key && !newKeys.has(key);
                });
                mergedSegs = keptOld.concat(newSegs).sort(function (a, b) {
                    const pa = (a && a.page != null) ? Number(a.page) : 999999;
                    const pb = (b && b.page != null) ? Number(b.page) : 999999;
                    return pa - pb;
                });
            }
            const mergedPatch = Object.assign({}, rawPatch);
            if (mergedSegs) {
                mergedPatch.audio_segments = mergedSegs;
                mergedPatch.drive_file_ids = mergedSegs.map(function (s) { return String((s && s.file_id) || ''); }).filter(Boolean);
                mergedPatch.submitted_files = mergedSegs.map(function (s) {
                    return { id: (s && s.file_id) || '', mime: (s && s.uploadMime) || 'audio/wav', name: (s && s.name) || '', unit_key: (s && s.unit_key) || '', label: (s && s.label) || '' };
                });
            }
            tempRecord.raw_data = Object.assign({}, prevRaw, mergedPatch);
        } else {
            window._studentTaskCompletions.push({
                assignment_id: assignmentId,
                task_id: taskId,
                status: 'ai_processing',
                raw_data: rawPatch
            });
        }
    }

    function getTaskGradingUnits(taskConfig, assignmentId, taskId) {
        const raw = (taskConfig && taskConfig.raw_data) ? taskConfig.raw_data : {};
        const parent = (assignmentId && taskId) ? findParentRangeGroup(assignmentId, taskId) : null;
        if (window.UIStudentTimelineTemplates && typeof window.UIStudentTimelineTemplates.recordingUnitsFromBook === 'function') {
            const bookUnits = window.UIStudentTimelineTemplates.recordingUnitsFromBook(taskConfig, parent);
            if (bookUnits && bookUnits.length) return bookUnits;
        }
        const units = (Array.isArray(raw.grading_units) && raw.grading_units.length)
            ? raw.grading_units.slice()
            : [];
        const rangeText = (window.UIStudentTimelineTemplates
            && typeof window.UIStudentTimelineTemplates.visibleRecordingRange === 'function')
            ? window.UIStudentTimelineTemplates.visibleRecordingRange(taskConfig)
            : (raw.material_range ? String(raw.material_range).trim() : String((taskConfig && taskConfig.title) || '').replace(/<[^>]*>/g, '').trim());
        if (window.UIStudentTimelineTemplates && typeof window.UIStudentTimelineTemplates.alignUnitsToVisibleRange === 'function') {
            return window.UIStudentTimelineTemplates.alignUnitsToVisibleRange(units, rangeText);
        }
        return units;
    }

    function parsePageFromFileName(name) {
        if (window.UIStudentTimelineTemplates && typeof window.UIStudentTimelineTemplates.parseRecordingPageFromName === 'function') {
            return window.UIStudentTimelineTemplates.parseRecordingPageFromName(name);
        }
        const base = String(name || '').replace(/\.[^.]+$/, '').replace(/pp?\.?\s*\d+\s*[~～〜－—–-]\s*\d+/gi, ' ');
        let m = base.match(/第\s*(\d+)\s*頁/);
        if (m) return parseInt(m[1], 10);
        m = base.match(/(?:^|[^0-9a-z])(?:p|page)\s*\.?\s*(\d+)(?:[^0-9]|$)/i);
        if (m) return parseInt(m[1], 10);
        return null;
    }

    function pairItemsToUnits(items, units) {
        const remaining = (units || []).slice();
        const pairs = [];
        const leftover = [];
        (items || []).forEach(function (item) {
            const page = parsePageFromFileName(item && item.name);
            let idx = -1;
            if (page != null) {
                idx = remaining.findIndex(function (u) { return u && Number(u.page) === page; });
            }
            if (idx >= 0) {
                pairs.push({ item: item, unit: remaining[idx] });
                remaining.splice(idx, 1);
            } else {
                leftover.push(item);
            }
        });
        leftover.forEach(function (item) {
            pairs.push({ item: item, unit: remaining.shift() || {} });
        });
        return pairs;
    }

    function getExistingAudioSegments(assignmentId, taskId) {
        const existingCompletion = (window._studentTaskCompletions || []).find(function (c) {
            return String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId);
        });
        return (existingCompletion && existingCompletion.raw_data && Array.isArray(existingCompletion.raw_data.audio_segments))
            ? existingCompletion.raw_data.audio_segments
            : [];
    }

    function markSubmittedKey(map, item) {
        if (!item || !map) return;
        const key = String((item.unit_key) || '').trim();
        if (key) map[key] = true;
        if (item.page != null && item.page !== '') map['range:' + Number(item.page)] = true;
        const label = String(item.label || item.name || '');
        const m = label.match(/(?:p\.?\s*|第\s*)(\d+)/i);
        if (m) map['range:' + parseInt(m[1], 10)] = true;
    }

    function submittedUnitKeyMap(assignmentId, taskId) {
        const taskConfig = findTaskConfig(assignmentId, taskId);
        return Object.assign({}, loadRecordingBoard(assignmentId, taskId, taskConfig).submittedKeys);
    }

    function loadRecordingBoard(assignmentId, taskId, taskConfig) {
        const rec = (window._studentTaskCompletions || []).find(function (c) {
            return String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId);
        });
        if (window.UIStudentTimelineTemplates && typeof window.UIStudentTimelineTemplates.getRecordingBoard === 'function') {
            return window.UIStudentTimelineTemplates.getRecordingBoard(
                taskConfig,
                rec && rec.raw_data,
                findParentRangeGroup(assignmentId, taskId)
            );
        }
        return { pages: [], expectedCount: 0, submittedCount: 0, submittedKeys: {}, players: [] };
    }

    function getStudioRecordingPages(taskConfig, assignmentId, taskId) {
        const board = loadRecordingBoard(assignmentId, taskId, taskConfig);
        return board.pages || [];
    }

    function isStudioPageSubmitted(page, keys) {
        const map = keys || {};
        const k = String((page && page.unit_key) || '').trim();
        if (k && map[k]) return true;
        if (page && page.page != null && page.page !== '' && map['range:' + Number(page.page)]) return true;
        return false;
    }

    function recordingPagesRemaining(taskConfig, assignmentId, taskId, extraKeys) {
        const pages = getStudioRecordingPages(taskConfig, assignmentId, taskId);
        if (pages.length <= 1) return 0;
        const keys = Object.assign({}, submittedUnitKeyMap(assignmentId, taskId), extraKeys || {});
        return pages.filter(function (p) {
            return !isStudioPageSubmitted(p, keys);
        }).length;
    }

    function firstUnsubmittedStudioIndex(pages, submittedKeys, afterIndex) {
        const keys = submittedKeys || {};
        const start = (afterIndex == null ? -1 : afterIndex) + 1;
        for (let i = start; i < pages.length; i++) {
            if (!isStudioPageSubmitted(pages[i], keys)) return i;
        }
        for (let j = 0; j < start && j < pages.length; j++) {
            if (!isStudioPageSubmitted(pages[j], keys)) return j;
        }
        return -1;
    }

    async function submitAudioSegmentsToAIGrading(assignmentId, taskId, segments) {
        assertAssignmentUuid(assignmentId, '作業 ID');
        const taskConfig = findTaskConfig(assignmentId, taskId);
        const units = getTaskGradingUnits(taskConfig, assignmentId, taskId);
        const hasAnyScript = segments.some(s => String(s.original_script || '').trim())
            || !!resolveTaskScriptText(assignmentId, taskId, taskConfig)
            || units.length > 0;
        if (!hasAnyScript) {
            throw new Error('尚未設定批改文稿，略過 AI。請通知老師套用 Snapshot 後再補批改。');
        }
        const { userId, classId } = await getAuthContext();
        if (!window.supabaseClient) throw new Error('系統 API 模組尚未載入');
        const first = segments[0] || {};
        const { error: rpcErr } = await window.supabaseClient.rpc('submit_audio_task_atomic', {
            p_assignment_id: coerceAssignmentIdForDb(assignmentId),
            p_task_id: String(taskId),
            p_student_id: userId,
            p_class_id: classId,
            p_file_id: first.file_id || null,
            p_audio_url: first.audio_url || null,
            p_segments: segments
        });
        if (rpcErr) throw rpcErr;
    }

    async function submitAudioToAIGrading(assignmentId, taskId, fileId, audioUrl) {
        await submitAudioSegmentsToAIGrading(assignmentId, taskId, [{
            file_id: fileId,
            audio_url: audioUrl,
            name: 'recording.wav',
            original_script: '',
            unit_key: '',
            label: ''
        }]);
    }

    async function uploadOneAudioBlob(assignmentId, taskId, safeTitleForJS, fileBlob, originalFileName, canSendAI, oldFileId) {
        let uploadBlob = fileBlob;
        let uploadMime = (fileBlob && fileBlob.type) ? fileBlob.type : 'audio/mpeg';
        let uploadExt = '.mp3';
        if (originalFileName && originalFileName.includes('.')) {
            uploadExt = originalFileName.substring(originalFileName.lastIndexOf('.'));
        }

        if (canSendAI) {
            const audioReady = await ensureFeatureStudentAudioReady();
            if (audioReady && window.FeatureStudentAudio && typeof window.FeatureStudentAudio.convertBlobToWav === 'function') {
                uploadBlob = await window.FeatureStudentAudio.convertBlobToWav(fileBlob);
                uploadMime = 'audio/wav';
                uploadExt = '.wav';
            } else if (!audioReady) {
                console.warn('錄音轉碼模組尚未就緒，將嘗試直接上傳原始音檔');
            }
        }

        const reader = new FileReader();
        const base64Data = await new Promise((resolve, reject) => {
            reader.onloadend = () => {
                const parts = String(reader.result).split(',');
                resolve(parts.length > 1 ? parts[1] : parts[0]);
            };
            reader.onerror = () => reject(new Error('FileReader Error'));
            reader.readAsDataURL(uploadBlob);
        });

        const { classId } = await getAuthContext();
        if (!window.ApiService || !window.ApiService.uploadToGAS) throw new Error('系統 API 模組尚未載入');
        const targetFolderId = resolveStudentUploadFolderId();
        const classPrefix = (classId ? classId : '0000').substring(0, 4);
        const cleanDateKey = window.UtilsDate.getTaiwanTodayString().replace(/[\\/:*?"<>|]/g, '_');
        const baseName = originalFileName ? originalFileName.replace(/\.[^/.]+$/, '') : 'Upload';
        const finalFileName = `${cleanDateKey}_${classPrefix}_${studentUsername}_${sanitizeUploadNamePart(safeTitleForJS)}_${baseName}${uploadExt}`;
        const result = await window.ApiService.uploadToGAS(base64Data, finalFileName, uploadMime, targetFolderId, assignmentId, taskId, oldFileId || null);
        if (!result || !result.fileId) {
            throw new Error('上傳成功但沒有檔案 ID，無法播放。請再試一次或改用「上傳音檔」。');
        }
        return {
            fileId: result.fileId,
            audioUrl: `https://drive.google.com/file/d/${result.fileId}/view`,
            uploadMime,
            finalFileName
        };
    }

    function isTransientDriveUploadError(err) {
        const msg = String((err && err.message) ? err.message : err || '');
        return /存取遭拒|拒絕存取|rate limit|too many requests|temporarily|請稍後再試/i.test(msg);
    }

    async function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * 複選多檔會短時間內連續打同一個 Drive 資料夾，偶爾會撞到暫時性的
     * 「存取遭拒」錯誤；遇到這類錯誤時稍等後自動重試一次，避免整批上傳失敗。
     */
    async function uploadOneAudioBlobWithRetry(assignmentId, taskId, safeTitleForJS, blob, name, canSendAI, oldFileId) {
        try {
            return await uploadOneAudioBlob(assignmentId, taskId, safeTitleForJS, blob, name, canSendAI, oldFileId);
        } catch (err) {
            if (!isTransientDriveUploadError(err)) throw err;
            await delay(1200);
            return await uploadOneAudioBlob(assignmentId, taskId, safeTitleForJS, blob, name, canSendAI, oldFileId);
        }
    }

    async function uploadAudioForGrading(assignmentId, taskId, safeTitleForJS, statusId, fileBlob, originalFileName) {
        await uploadAudioFilesForGrading(assignmentId, taskId, safeTitleForJS, statusId, [
            { blob: fileBlob, name: originalFileName || 'recording.wav' }
        ]);
    }

    async function uploadAudioFilesForGrading(assignmentId, taskId, safeTitleForJS, statusId, fileItems, opts) {
        opts = opts || {};
        const targetUnit = opts.targetUnit || null;
        const statusEl = document.getElementById(statusId);

        if (window._isUploadingAudio) {
            console.warn('正在處理上傳中，請勿重複點擊');
            return null;
        }
        window._isUploadingAudio = true;
        const originalPointerEvents = document.body.style.pointerEvents;
        document.body.style.pointerEvents = 'none';

        try {
            assertAssignmentUuid(assignmentId, '作業 ID');
            const taskConfig = findTaskConfig(assignmentId, taskId);
            const scriptText = resolveTaskScriptText(assignmentId, taskId, taskConfig);
            const gradingUnits = getTaskGradingUnits(taskConfig, assignmentId, taskId);
            const hasScript = !!scriptText || gradingUnits.some(u => String(u.original_script || '').trim())
                || !!(targetUnit && String(targetUnit.original_script || '').trim());
            // 💣 雷區：這裡曾只看「有沒有文稿」決定 canSendAI，完全沒檢查老師有沒有勾選
            // 「AI 批改發音」。導致老師沒勾 AI 批改，只要材料 Snapshot 帶了文稿，
            // 音檔還是會被送進 AI 管線、學生端也會出現「分段進度」批改中訊息。
            // 見 .cursor/rules/ai-grading-pipeline-invariants.mdc。
            const canSendAI = hasScript && taskSupportsAIGrading(taskConfig, assignmentId);

            const items = (fileItems || []).filter(Boolean);
            if (!items.length) throw new Error('未選擇音檔');

            // 💣 雷區：分批上傳（如 12 頁先傳 6、再傳剩下 6）不能每次都從第 1 頁對應，
            // 否則第二批會被誤標成第 1~6 頁（蓋掉真正的第 1~6 頁），且第一批的段會被
            // DB 端合併邏輯判定成「這批沒提交」而清掉。改成：已提交過的頁（不論
            // 批改中或已完成）一律排除，新選的檔案依序對應「尚未提交」的頁。
            // 見 .cursor/rules/ai-grading-pipeline-invariants.mdc。
            const existingCompletion = (window._studentTaskCompletions || []).find(function (c) {
                return String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId);
            });
            const existingSegs = (existingCompletion && existingCompletion.raw_data && Array.isArray(existingCompletion.raw_data.audio_segments))
                ? existingCompletion.raw_data.audio_segments
                : [];
            const existingUnitKeys = new Set(
                existingSegs.map(function (s) { return String((s && s.unit_key) || '').trim(); }).filter(Boolean)
            );
            const remainingUnits = (gradingUnits.length && existingUnitKeys.size > 0)
                ? gradingUnits.filter(function (u) { return !existingUnitKeys.has(String(u.unit_key || '').trim()); })
                : gradingUnits;
            // 所有頁都已提交過（existingUnitKeys 涵蓋全部）→ 視為刻意整份重傳，退回完整 gradingUnits
            // 錄音艙指定某一頁（含重錄已繳頁）時，只對那一頁，不要改走「尚未提交的頁」。
            const effectiveUnits = targetUnit
                ? [targetUnit]
                : (remainingUnits.length ? remainingUnits : gradingUnits);
            const alreadyDoneCount = targetUnit ? 0 : (gradingUnits.length - effectiveUnits.length);

            const pairs = pairItemsToUnits(items, effectiveUnits.length ? effectiveUnits : []);
            const mappedByName = pairs.filter(function (p) {
                return p.unit && p.unit.page != null && parsePageFromFileName(p.item && p.item.name) === Number(p.unit.page);
            }).length;
            const pairCount = effectiveUnits.length
                ? Math.min(pairs.length, effectiveUnits.length)
                : pairs.length;
            if (!targetUnit && effectiveUnits.length && items.length !== effectiveUnits.length) {
                const isBookUnits = !!(gradingUnits[0] && String(gradingUnits[0].unit_key || '').indexOf('book:') === 0);
                const unitWord = isBookUnits ? '段' : '頁';
                window.showFlash(
                    `已選 ${items.length} 檔；此作業共 ${gradingUnits.length} 個錄音${unitWord}單位`
                    + (alreadyDoneCount > 0 ? `（其中 ${alreadyDoneCount} ${unitWord}先前已提交，將接續補上剩下的${unitWord}）` : '')
                    + (mappedByName ? `，其中 ${mappedByName} 檔已依檔名對到頁碼` : '')
                    + `，其餘依選取順序對尚未提交的${unitWord}。`,
                    'warning'
                );
            }

            // 💣 雷區：上面的頁數比對只認「結構化 grading_units」，老師若只是手動在
            // 「base 範圍」貼文字（例：「p. 376 Exercise 28, p. 378 Exercise 29...」）
            // 卻沒有跑過 meta／骨架流程產生 grading_units，學生選錯檔數時完全沒有提示，
            // 只會默默少收幾頁（2026-08-09 使用者回報「為什只有一個檔案」）。
            // 沒有 grading_units 時改用展開 base 範圍文字算出的頁數比對，非阻擋式提醒。
            // 目錄套餐不准走這條：範圍字串裡的 13／8／407 不是錄音頁數。
            const parentForBook = findParentRangeGroup(assignmentId, taskId);
            const bookUnitsNow = (window.UIStudentTimelineTemplates
                && typeof window.UIStudentTimelineTemplates.recordingUnitsFromBook === 'function')
                ? window.UIStudentTimelineTemplates.recordingUnitsFromBook(taskConfig, parentForBook)
                : null;
            if (!effectiveUnits.length && !(bookUnitsNow && bookUnitsNow.length)) {
                const rawMaterialRangeText = (taskConfig && taskConfig.raw_data && taskConfig.raw_data.material_range)
                    ? String(taskConfig.raw_data.material_range).trim()
                    : '';
                const rangePages = (rawMaterialRangeText && window.UIStudentTimelineTemplates
                    && typeof window.UIStudentTimelineTemplates.pagesFromRangeText === 'function')
                    ? window.UIStudentTimelineTemplates.pagesFromRangeText(rawMaterialRangeText)
                    : [];
                if (rangePages.length > 1) {
                    const existingFileCount = (existingCompletion && existingCompletion.raw_data && Array.isArray(existingCompletion.raw_data.drive_file_ids))
                        ? existingCompletion.raw_data.drive_file_ids.length
                        : 0;
                    const totalAfterUpload = existingFileCount + items.length;
                    if (totalAfterUpload !== rangePages.length) {
                        window.showFlash(
                            `已選 ${items.length} 檔`
                            + (existingFileCount > 0 ? `（加上先前已上傳 ${existingFileCount} 檔，共 ${totalAfterUpload} 檔）` : '')
                            + `；範圍顯示應為 ${rangePages.length} 頁（${rawMaterialRangeText}），請確認是否已依頁面順序上傳齊全。`,
                            'warning'
                        );
                    }
                }
            }

            const uploaded = [];
            for (let i = 0; i < pairCount; i++) {
                const pair = pairs[i] || {};
                const item = pair.item || items[i];
                if (statusEl) {
                    statusEl.textContent = canSendAI
                        ? `⚙️ 轉碼／上傳 ${i + 1}/${pairCount}...`
                        : `🚀 上傳 ${i + 1}/${pairCount}...`;
                    statusEl.style.color = '#3B82F6';
                }
                if (!isAudioUploadFile(item.blob || item)) {
                    throw new Error(`「${item.name || '檔案'}」不是支援的音檔格式`);
                }
                const blob = item.blob || item;
                if (blob.size > 25 * 1024 * 1024) {
                    throw new Error(`「${item.name || '檔案'}」超過 25MB`);
                }
                const up = await uploadOneAudioBlobWithRetry(
                    assignmentId, taskId, safeTitleForJS, blob, item.name || `part_${i + 1}.wav`, canSendAI
                );
                const unit = pair.unit || effectiveUnits[i] || {};
                uploaded.push({
                    file_id: up.fileId,
                    audio_url: up.audioUrl,
                    name: up.finalFileName,
                    uploadMime: up.uploadMime,
                    unit_key: unit.unit_key || '',
                    stem: unit.stem || '',
                    page: unit.page != null ? unit.page : null,
                    label: unit.label || (effectiveUnits.length ? `第${i + 1}頁` : ''),
                    original_script: String(unit.original_script || '').trim()
                });
                // 多檔連續上傳同一資料夾時，稍微間隔可降低撞到 Drive 暫時性存取限制的機率
                if (i < pairCount - 1) await delay(350);
            }

            const extraKeys = {};
            uploaded.forEach(function (u) { markSubmittedKey(extraKeys, u); });
            const remainingBeforeSave = recordingPagesRemaining(taskConfig, assignmentId, taskId, extraKeys);
            const allPagesDone = remainingBeforeSave === 0;

            if (canSendAI) {
                if (statusEl) {
                    statusEl.textContent = `🧠 喚醒 AI（${uploaded.length} 段）...`;
                    statusEl.style.color = '#8B5CF6';
                }
                await submitAudioSegmentsToAIGrading(assignmentId, taskId, uploaded);
                if (statusEl) {
                    statusEl.textContent = allPagesDone
                        ? `✅ 已繳交 ${uploaded.length} 檔，AI 依頁批改中`
                        : `✅ 已繳交 ${uploaded.length} 檔，還有 ${remainingBeforeSave} 頁未錄`;
                    statusEl.style.color = '#10B981';
                }
                applyLocalCompletionAfterAudioSubmit(
                    assignmentId,
                    taskId,
                    uploaded[0].file_id,
                    uploaded[0].audio_url,
                    {
                        drive_file_ids: uploaded.map(u => u.file_id),
                        audio_segments: uploaded.map(u => Object.assign({}, u, { status: 'pending' })),
                        submitted_files: uploaded.map(u => ({
                            id: u.file_id,
                            mime: u.uploadMime || 'audio/wav',
                            name: u.name,
                            unit_key: u.unit_key,
                            label: u.label
                        }))
                    },
                    allPagesDone
                );
                const mapHint = uploaded.map((u, i) => `${i + 1}→${u.label || u.unit_key || '段'}`).join('，');
                window.showFlash(allPagesDone
                    ? `已上傳 ${uploaded.length} 音檔（${mapHint}），AI 將逐頁批改。`
                    : `已上傳 ${uploaded.length} 音檔（${mapHint}）。還有 ${remainingBeforeSave} 頁，請繼續錄。`);
            } else {
                await window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, allPagesDone, uploaded.map(u => ({
                    id: u.file_id,
                    mime: u.uploadMime || 'audio/wav',
                    name: u.name,
                    unit_key: u.unit_key,
                    label: u.label,
                    stem: u.stem,
                    page: u.page
                })));
                const skipReason = !hasScript ? '無文稿' : '未勾選 AI 批改';
                if (statusEl) {
                    statusEl.textContent = allPagesDone
                        ? `✅ 已上傳 ${uploaded.length} 檔（${skipReason}，略過 AI）`
                        : `✅ 已上傳 ${uploaded.length} 檔，還有 ${remainingBeforeSave} 頁未錄`;
                    statusEl.style.color = '#10B981';
                }
                window.showFlash(allPagesDone
                    ? ('音檔已上傳到資料夾。此任務' + (!hasScript ? '尚未設定批改文稿' : '未開啟 AI 批改') + '，故未送 AI。')
                    : ('這一頁已上傳。還有 ' + remainingBeforeSave + ' 頁，請繼續錄（不會標成已完成）。'));
            }
            renderCourses();
            const afterKeys = submittedUnitKeyMap(assignmentId, taskId);
            const studioPages = getStudioRecordingPages(taskConfig, assignmentId, taskId);
            const remainingCount = studioPages.length
                ? studioPages.filter(function (p) {
                    const k = String((p && p.unit_key) || '').trim();
                    return k && !afterKeys[k];
                }).length
                : 0;
            return { uploaded: uploaded, remainingCount: remainingCount, submittedKeys: afterKeys };
        } catch (err) {
            window.showFlash('音檔上傳失敗: ' + err.message, 'error');
            if (statusEl) {
                statusEl.textContent = '❌ 上傳失敗';
                statusEl.style.color = '#EF4444';
            }
            return null;
        } finally {
            window._isUploadingAudio = false;
            document.body.style.pointerEvents = originalPointerEvents;
        }
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error(`讀取檔案失敗: ${file.name}`));
            reader.readAsDataURL(file);
        });
    }

    function safeFormatUrl(url) {
        if (!url) return '';
        let trimmedUrl = String(url).replace(/['"]/g, '').trim();
        if (trimmedUrl === '') return '';
        
        if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
            return trimmedUrl;
        }
        
        if (trimmedUrl.length > 20 && !trimmedUrl.includes('/') && !trimmedUrl.includes('.')) {
            return `https://drive.google.com/drive/folders/${trimmedUrl}`;
        }
        
        return `https://${trimmedUrl}`;
    }

    async function fetchData() {
        const container = document.getElementById('course-container');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center; padding: 40px; color:#94A3B8; font-weight:800;">⏳ 正在從雲端載入作業...</div>';

        try {
            const { userId, classId } = await getAuthContext();

            // 並行拉取（舊版串行 5 趟 RTT 是進度頁偏慢主因之一）
            // 雷區：class_id=UUID、assignment_id 可能 BIGINT——此處只做查詢，不強轉型別
            const [profileRes, enrollRes, classRes, assignRes, compRes] = await Promise.all([
                window.supabaseClient
                    .from('profiles')
                    .select('name')
                    .eq('id', userId)
                    .single(),
                window.supabaseClient
                    .from('student_enrollments')
                    .select('raw_data, drive_link, drive_url')
                    .eq('user_id', userId)
                    .eq('class_id', classId)
                    .is('deleted_at', null)
                    .single(),
                window.supabaseClient
                    .from('classes')
                    .select('id, name, calc_mode, meet_days, start_date, end_date, sessions, session_dates, raw_data')
                    .eq('id', classId)
                    .single(),
                window.supabaseClient
                    .from('assignments')
                    // 💣 雷區（2026-08-15 老師回報「細節描述在學生端根本沒顯示」）：這裡以前沒選
                    // description 欄位，導致 ui-student-timeline-templates.js 用到的 course.description
                    // 永遠是 undefined——不是渲染邏輯錯，是這裡的查詢從一開始就沒把這欄抓回來。
                    // 老師端 a.description（見 ui-timeline-templates.js getAssignmentBlockHtml）能顯示，
                    // 是因為老師端載入作業清單走的是別的查詢（select('*') 或含 description 的清單）。
                    .select('id, title, description, target_date, due_date, open_at, tasks, raw_data, is_published, class_id')
                    .eq('class_id', classId)
                    .eq('is_published', true)
                    .is('deleted_at', null),
                window.supabaseClient
                    .from('task_completions')
                    .select('assignment_id, task_id, status, raw_data')
                    .eq('student_id', userId)
                    .eq('class_id', classId)
                    .is('deleted_at', null)
                    .neq('status', 'incomplete')
            ]);

            if (assignRes.error) {
                const msg = String((assignRes.error && assignRes.error.message) || assignRes.error || '');
                if (/open_at/i.test(msg)) {
                    throw new Error('作業資料缺少「開放日期」欄，請老師套用資料庫更新後再請學生重整。');
                }
                throw assignRes.error;
            }
            if (compRes.error) throw compRes.error;

            // classes 精簡欄位若不存在於舊 schema，退回 select *
            let classData = classRes.data;
            if (classRes.error) {
                console.warn('[FeatureStudentTimeline] classes 精簡查詢失敗，改用 *', classRes.error);
                const fallback = await window.supabaseClient
                    .from('classes')
                    .select('*')
                    .eq('id', classId)
                    .single();
                if (fallback.error) throw fallback.error;
                classData = fallback.data;
            }

            studentUsername = (profileRes.data && profileRes.data.name)
                ? profileRes.data.name
                : '學生';

            if (enrollRes.error) console.warn('[DB Warning] 找不到該學生的班級註冊紀錄', enrollRes.error);

            const enrollData = enrollRes.data;
            let enrollRaw = (enrollData && enrollData.raw_data) ? enrollData.raw_data : {};
            if (typeof enrollRaw === 'string') {
                try { enrollRaw = JSON.parse(enrollRaw); } catch (_e) { enrollRaw = {}; }
            }

            studentDriveUrl = (enrollRaw && enrollRaw.drive_folder_id)
                ? enrollRaw.drive_folder_id
                : (enrollData && (enrollData.drive_link || enrollData.drive_url))
                    ? (enrollData.drive_link || enrollData.drive_url)
                    : null;

            currentClassConfig = classData ? classData : {};
            assignments = (assignRes.data ? assignRes.data : []).filter(function (a) {
                return !window.UtilsDate || typeof window.UtilsDate.canStudentSeeAssignment !== 'function'
                    || window.UtilsDate.canStudentSeeAssignment(a);
            });
            window._studentTaskCompletions = compRes.data ? compRes.data : [];
            completedTasks = (compRes.data ? compRes.data : []).filter(function (row) {
                const s = String((row && row.status) || '');
                return s && s !== 'incomplete' && s !== 'pending';
            }).map(function (row) {
                return String(row.assignment_id) + '_' + String(row.task_id);
            });

            // 🚀 效能：預設常停在「訊息」；勿在隱藏的課程進度建整棵時間軸（含 AI 報告 HTML）
            // 切到 progress 時 switchView 會再 renderCourses()
            let activeView = '';
            try { activeView = localStorage.getItem('studentActiveView') || ''; } catch (_e) {}
            if (activeView === 'progress' || sessionStorage.getItem('pendingJumpAssignmentId')) {
                renderCourses();
            }
        } catch (err) {
            console.error("載入學生資料失敗：", err);
            container.innerHTML = `<div style="text-align:center; padding: 40px; color:#EF4444; font-weight:800;">❌ 載入失敗：${err.message}</div>`;
        }
    }

    function renderCourses() {
        const container = document.getElementById('course-container');
        if (!container) return;

        const DateUtils = window.UtilsDate;
        if (!DateUtils || !window.UIStudentTimelineTemplates) {
            container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 系統錯誤：依賴模組遺失 (DateUtils 或 UI Templates)，請重整網頁。</div>`;
            return;
        }
        
        let cls = currentClassConfig || {};
        let raw = cls.raw_data || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        let mode = cls.calc_mode || cls.calcMode || raw.calc_mode || raw.calcMode || 'single';
        let meetDays = (cls.meet_days || cls.meetDays || raw.meet_days || raw.meetDays || []).map(Number).filter(n => !isNaN(n));
        let weekStartSetting = raw.week_start_day || 'sunday';
        
        // 與老師端對齊：已寫入 custom_sessions（含空陣列）即以它為準
        let sessions = [];
        if (Array.isArray(raw.custom_sessions)) {
            sessions = raw.custom_sessions.slice();
        } else if (Array.isArray(cls.sessions) && cls.sessions.length > 0) {
            sessions = cls.sessions;
        } else if (Array.isArray(raw.sessions) && raw.sessions.length > 0) {
            sessions = raw.sessions;
        } else if (Array.isArray(cls.session_dates) && cls.session_dates.length > 0) {
            sessions = cls.session_dates;
        } else if (Array.isArray(raw.session_dates) && raw.session_dates.length > 0) {
            sessions = raw.session_dates;
        } else {
            let startDateStr = cls.start_date || cls.startDate || raw.start_date || raw.startDate;
            let endDateStr = cls.end_date || cls.endDate || raw.end_date || raw.endDate;
            if (startDateStr && endDateStr && meetDays.length > 0) {
                let sNorm = DateUtils.normalizeDateString(startDateStr);
                let eNorm = DateUtils.normalizeDateString(endDateStr);
                sessions = DateUtils.generateDates(sNorm, eNorm, meetDays);
            }
        }

        sessions = sessions.map(d => DateUtils.normalizeDateString(d)).filter(Boolean);
        const assignmentDates = (assignments || [])
            .map(a => DateUtils.normalizeDateString(a.target_date))
            .filter(Boolean);
        sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

        if (sessions.length === 0) {
            container.innerHTML = `
                <div class="card" style="text-align:center; padding:40px;">
                    <span style="font-size:3rem; display:block; margin-bottom:10px;">🎉</span>
                    <h3 style="color:var(--primary-dark); margin:0;">目前沒有排程資料</h3>
                    <p style="color:var(--text-muted); font-weight:600;">老師尚未設定課程日期或發布作業，請稍後再回來看看！</p>
                </div>
            `;
            return;
        }

        let timelineNodes = [];
        if (mode === 'single') timelineNodes = sessions.map(d => ({ title: d, dates: [d] }));
        else if (mode === 'weekly') {
            const weeksMap = new Map();
            sessions.forEach(d => {
                const weekStr = DateUtils.getWeekStartStr(d, weekStartSetting);
                if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                weeksMap.get(weekStr).push(d);
            });
            weeksMap.forEach((chunk) => timelineNodes.push({ title: chunk.length > 1 ? `${chunk[0]} ~${chunk[chunk.length-1]}` : chunk[0], dates: chunk }));
        }

        const todayStr = DateUtils.getTaiwanTodayString();
        const currentWeekStart = DateUtils.getWeekStartStr(todayStr, weekStartSetting);

        let classGradingPolicy = {};
        if (window.GradingPolicy && window.GradingPolicy.parsePolicy) {
            classGradingPolicy = window.GradingPolicy.parsePolicy(raw);
        }

        const htmlString = window.UIStudentTimelineTemplates.renderTimelineNodes(
            timelineNodes, assignments, completedTasks, currentWeekStart, mode, weekStartSetting, DateUtils, studentDriveUrl, safeFormatUrl, classGradingPolicy
        );

        const styleBlock = document.createElement('style');
        styleBlock.innerHTML = `
            .timeline-node, .timeline-node * { box-sizing: border-box !important; max-width: 100%; word-break: break-word; }
            .timeline-node::before { display: none !important; }
            .rt-normalize, .rt-normalize * { font-size: inherit !important; font-family: inherit !important; }
            @keyframes pulse-green { 0% {box-shadow: 0 0 0 0 rgba(16,185,129,0.4);} 70% {box-shadow: 0 0 0 8px rgba(16,185,129,0);} 100% {box-shadow: 0 0 0 0 rgba(16,185,129,0);} }
        `;

        container.innerHTML = '';
        container.appendChild(styleBlock);
        
        const timelineWrapper = document.createElement('div');
        timelineWrapper.style.borderLeft = '3px solid #E2E8F0';
        timelineWrapper.style.marginLeft = '20px';
        timelineWrapper.style.paddingLeft = '50px'; 
        timelineWrapper.innerHTML = htmlString;

        container.appendChild(timelineWrapper);

        setTimeout(scrollToCurrentWeek, 300);

        const viewProgress = container.closest('.view-content') || document.getElementById('view-progress');
        if (viewProgress && !window._timelineObserverAttached) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                        const style = window.getComputedStyle(viewProgress);
                        if (style.display !== 'none' && viewProgress.classList.contains('active')) {
                            setTimeout(scrollToCurrentWeek, 100); 
                        }
                    }
                });
            });
            observer.observe(viewProgress, { attributes: true });
            window._timelineObserverAttached = true;
        }
    }

    return {
        init: () => {
            const tabLinks = document.querySelectorAll('.tab-link');
            if (tabLinks.length > 0) {
                const tabContainer = tabLinks[0].closest('div.tabs') || tabLinks[0].parentElement;
                if (tabContainer) {
                    tabContainer.style.position = 'sticky';
                    tabContainer.style.top = '0';
                    tabContainer.style.zIndex = '999';
                    const bgColor = window.getComputedStyle(document.body).backgroundColor;
                    tabContainer.style.backgroundColor = (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') ? '#FFFDF8' : bgColor;
                    tabContainer.style.paddingTop = '10px';
                    tabContainer.style.paddingBottom = '10px';
                    tabContainer.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05)';
                }
            }
            fetchData().then(function () {
                const pendingId = sessionStorage.getItem('pendingJumpAssignmentId');
                if (pendingId) {
                    sessionStorage.removeItem('pendingJumpAssignmentId');
                    // 跳轉進度時仍更新訊息紅點（不開訊息頁）
                    if (window.FeatureStudentMessages
                        && typeof window.FeatureStudentMessages.refreshBadgeOnly === 'function') {
                        window.FeatureStudentMessages.refreshBadgeOnly();
                    }
                    const progressTab = document.querySelector('.tab-link[data-view="progress"]');
                    if (progressTab && typeof window.FeatureStudentTimeline.switchView === 'function') {
                        window.FeatureStudentTimeline.switchView('progress', progressTab);
                    }
                    setTimeout(function () {
                        if (!jumpToAssignment(pendingId)) scrollToCurrentWeek();
                    }, 150);
                    return;
                }
                const allowed = { progress: 1, 'exam-grades': 1, messages: 1, resources: 1, review: 1 };
                let savedView = '';
                try { savedView = localStorage.getItem('studentActiveView') || ''; } catch (_e) {}
                if (!allowed[savedView]) savedView = 'messages';
                // 開訊息頁時 render() 會自己抓通知；勿先 refreshBadgeOnly 再抓一次
                if (savedView !== 'messages'
                    && window.FeatureStudentMessages
                    && typeof window.FeatureStudentMessages.refreshBadgeOnly === 'function') {
                    window.FeatureStudentMessages.refreshBadgeOnly();
                }
                const tab = document.querySelector('.tab-link[data-view="' + savedView + '"]')
                    || document.getElementById('tab-student-messages');
                if (tab) {
                    window.FeatureStudentTimeline.switchView(savedView, tab);
                }
            });
        },

        // 🚀 v63: 播放 Google 真人發音引擎 (解決機器音問題)
        playTTS: (text) => {
            if (!text) return;
            if (_currentPlaying) _currentPlaying.pause();
            if (_pauseTimeout) clearTimeout(_pauseTimeout);
            
            // 使用 client=tw-ob 規避基礎防盜鏈，原生的 new Audio 即可播放
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(text)}`;
            _currentPlaying = new Audio(url);
            _currentPlaying.play().catch(e => {
                console.warn('TTS Playback blocked', e);
                window.showFlash('播放示範音失敗，您的瀏覽器可能阻擋了自動播放。', 'error');
            });
        },

        // 🚀 v63: 播放學生的原始音檔切片 (透過 Drive uc?export API 串流載入)
        playStudentAudioSlice: (fileId, start, end) => {
            if (_currentPlaying) _currentPlaying.pause();
            if (_pauseTimeout) clearTimeout(_pauseTimeout);
            if (!fileId) {
                window.showFlash('無法取得原始音檔 ID', 'error');
                return;
            }

            const startTime = Number(start) || 0;
            let endTime = Number(end) || 0;
            
            // 容錯機制：如果 AI 沒給 endTime，預設向後播 1.5 秒
            if (endTime <= startTime) endTime = startTime + 1.5;

            // 快取音檔，避免重複下載
            if (!_audioCache[fileId]) {
                const streamUrl = (window.ApiService && typeof window.ApiService.getAudioStreamUrl === 'function')
                    ? window.ApiService.getAudioStreamUrl(fileId)
                    : `https://drive.google.com/uc?export=download&id=${fileId}`;
                _audioCache[fileId] = new Audio(streamUrl);
            }
            const audio = _audioCache[fileId];
            _currentPlaying = audio;

            const playSlice = () => {
                audio.currentTime = startTime;
                audio.play().catch(e => {
                    console.warn('Slice playback blocked', e);
                    window.showFlash('播放您的原音失敗，請先確認瀏覽器允許媒體播放。', 'error');
                });
                const durationMs = Math.max(300, (endTime - startTime) * 1000);
                _pauseTimeout = setTimeout(() => {
                    if (_currentPlaying === audio) audio.pause();
                }, durationMs);
            };

            if (audio.readyState >= 1) playSlice();
            else {
                audio.addEventListener('loadedmetadata', () => playSlice(), { once: true });
                audio.load();
            }
        },

        switchView: (viewId, btnElement) => {
            // 🚀 reload 時 index.html 的同步小腳本已依 localStorage 預先套用正確分頁的
            // active class（見 page-refresh-perf-invariant.mdc）；若這裡目標分頁已經是
            // active，就不要重新 remove/add class，否則會讓 CSS 的 fadeIn 動畫重播一次，
            // 出現「畫面已經對了，卻又閃一下」的殘留感。使用者手動點別的分頁時，
            // viewEl 不會已是 active，仍會走原本的切換＋淡入。
            const viewEl = document.getElementById(`view-${viewId}`);
            const alreadyActive = !!(viewEl && viewEl.classList.contains('active'));
            if (!alreadyActive) {
                document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
                document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
                if (viewEl) viewEl.classList.add('active');
                if (btnElement) btnElement.classList.add('active');
            } else if (btnElement && !btnElement.classList.contains('active')) {
                document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
                btnElement.classList.add('active');
            }
            try { localStorage.setItem('studentActiveView', viewId); } catch (_e) {}
            
            if (viewId === 'progress') {
                renderCourses();
                setTimeout(function () {
                    const pendingId = sessionStorage.getItem('pendingJumpAssignmentId');
                    if (pendingId) {
                        sessionStorage.removeItem('pendingJumpAssignmentId');
                        if (!jumpToAssignment(pendingId)) scrollToCurrentWeek();
                    } else {
                        scrollToCurrentWeek();
                    }
                }, 100);
            } else if (viewId === 'resources') {
                if (window.FeatureStudentResource && currentClassConfig) {
                    window.FeatureStudentResource.init(currentClassConfig);
                }
            } else if (viewId === 'messages') {
                if (window.FeatureStudentMessages && typeof window.FeatureStudentMessages.render === 'function') {
                    window.FeatureStudentMessages.render();
                }
            } else if (viewId === 'analytics') {
                if (window.FeatureStudentAnalytics && typeof window.FeatureStudentAnalytics.render === 'function') {
                    window.FeatureStudentAnalytics.render();
                }
            } else if (viewId === 'review') {
                if (window.FeatureStudentReview && typeof window.FeatureStudentReview.render === 'function') {
                    window.FeatureStudentReview.render();
                }
            } else if (viewId === 'exam-grades') {
                if (window.FeatureStudentExamGrades && typeof window.FeatureStudentExamGrades.render === 'function') {
                    window.FeatureStudentExamGrades.render();
                }
            }
        },

        jumpToAssignment,

        // 供「學習分析」頁籤讀取已載入的作業定義（含 material_ref／grading_units），避免重複打 API。
        getAssignments: () => assignments,
        getAuthContext: getAuthContext,
        getCurrentClassConfig: () => currentClassConfig,

        updateProgress: async (assignmentId, taskId, isChecked, fileIds = null, replaceFileId = null) => {
            const compositeKey = `${assignmentId}_${taskId}`;
            let prevCompletion = null;
            if (window._studentTaskCompletions) {
                prevCompletion = window._studentTaskCompletions.find(c =>
                    String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId)
                ) || null;
            }

            try {
                assertAssignmentUuid(assignmentId, '作業 ID');
                const { userId, classId } = await getAuthContext();
                
                if (isChecked && !completedTasks.includes(compositeKey)) {
                    completedTasks.push(compositeKey);
                    if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                    if (!prevCompletion) {
                        window._studentTaskCompletions.push({
                            assignment_id: assignmentId,
                            task_id: taskId,
                            status: 'completed',
                            raw_data: {}
                        });
                    }
                } else if (!isChecked) {
                    completedTasks = completedTasks.filter(id => id !== compositeKey);
                    // 有檔案的「未交齊」不要清掉本地 raw_data，否則播放器／已交頁會消失
                }
                renderCourses();

                const normalizedFiles = [];
                if (Array.isArray(fileIds)) {
                    fileIds.forEach(function (f) {
                        if (!f) return;
                        if (typeof f === 'string') {
                            normalizedFiles.push({ id: String(f) });
                        } else if (f.id) {
                            const row = {
                                id: String(f.id),
                                mime: f.mime ? String(f.mime) : '',
                                name: f.name ? String(f.name) : ''
                            };
                            if (f.unit_key) row.unit_key = String(f.unit_key);
                            if (f.label) row.label = String(f.label);
                            if (f.stem) row.stem = String(f.stem);
                            if (f.page != null && f.page !== '') row.page = f.page;
                            normalizedFiles.push(row);
                        }
                    });
                }
                // 與既有已繳交檔案合併（去重，依 id），避免「分批上傳」時後一批
                // 覆寫掉前一批已成功的檔案紀錄（前一批實體檔案仍在 Drive，只是 raw_data 記錄要保留）
                const existingFiles = (prevCompletion && prevCompletion.raw_data && Array.isArray(prevCompletion.raw_data.submitted_files))
                    ? prevCompletion.raw_data.submitted_files
                    : [];
                const mergedFilesMap = new Map();
                existingFiles.forEach(function (f) { if (f && f.id) mergedFilesMap.set(String(f.id), f); });
                // 「取代特定已上傳檔」：replaceFileId 有值時，先把該筆從合併結果中移除，
                // 讓本次新檔「換掉」它而不是額外累加一筆。見 drive-folder-upload-invariants.mdc。
                if (replaceFileId) mergedFilesMap.delete(String(replaceFileId));
                normalizedFiles.forEach(function (f) { if (f && f.id) mergedFilesMap.set(String(f.id), f); });
                const mergedFiles = Array.from(mergedFilesMap.values());

                const idList = mergedFiles.map(function (f) { return f.id; });
                let rawData = null;
                if (idList.length > 0) {
                    rawData = {
                        drive_file_ids: idList,
                        submitted_files: mergedFiles
                    };
                    const first = mergedFiles[0];
                    const mime = (first.mime || '').toLowerCase();
                    const name = (first.name || '').toLowerCase();
                    if (mime.indexOf('audio/') === 0 || /\.(wav|mp3|m4a|ogg|aac|webm|flac)$/.test(name)) {
                        rawData.student_audio_url = 'https://drive.google.com/file/d/' + first.id + '/view';
                        rawData.audio_url = rawData.student_audio_url;
                    }
                    const newSegs = mergedFiles.filter(function (f) { return f && f.unit_key; }).map(function (f) {
                        return {
                            file_id: f.id,
                            name: f.name || '',
                            uploadMime: f.mime || '',
                            unit_key: f.unit_key,
                            label: f.label || '',
                            stem: f.stem || '',
                            page: (f.page != null && f.page !== '') ? f.page : null,
                            status: 'submitted'
                        };
                    });
                    if (newSegs.length) {
                        const prevSegs = (prevCompletion && prevCompletion.raw_data && Array.isArray(prevCompletion.raw_data.audio_segments))
                            ? prevCompletion.raw_data.audio_segments
                            : [];
                        const newKeys = new Set(newSegs.map(function (s) { return String(s.unit_key || '').trim(); }).filter(Boolean));
                        const kept = prevSegs.filter(function (s) {
                            const key = String((s && s.unit_key) || '').trim();
                            return key && !newKeys.has(key);
                        });
                        rawData.audio_segments = kept.concat(newSegs);
                    }
                }

                // 優先走 RPC（避開 soft-delete RETURNING 的 RLS 邊角）
                const { error: rpcErr } = await window.supabaseClient.rpc('student_set_task_completion', {
                    p_assignment_id: coerceAssignmentIdForDb(assignmentId),
                    p_task_id: taskId,
                    p_class_id: classId,
                    p_completed: !!isChecked,
                    p_raw_data: rawData
                });

                if (rpcErr) {
                    const rpcMsg = String(rpcErr.message || rpcErr.details || '');
                    const rpcMissing = /Could not find the function|does not exist|PGRST202|404/i.test(rpcMsg);
                    if (!rpcMissing) throw rpcErr;

                    // RPC 尚未部署時，退回直接寫表
                    if (isChecked) {
                        const payload = {
                            assignment_id: assignmentId,
                            task_id: taskId,
                            student_id: userId,
                            class_id: classId,
                            status: 'completed',
                            deleted_at: null
                        };
                        if (rawData) payload.raw_data = rawData;

                        const { data: updatedRows, error: updateErr } = await window.supabaseClient.from('task_completions')
                            .update(payload)
                            .eq('task_id', taskId)
                            .eq('student_id', userId)
                            .eq('class_id', classId)
                            .select();
                        if (updateErr) throw updateErr;

                        if (!updatedRows || updatedRows.length === 0) {
                            const { error: insertErr } = await window.supabaseClient.from('task_completions')
                                .insert([payload]);
                            if (insertErr) throw insertErr;
                        }
                    } else {
                        // 取消勾選／未交齊＝未完成（保留列；有檔就要把 raw_data 一併寫入）
                        const payload = {
                            assignment_id: assignmentId,
                            task_id: taskId,
                            student_id: userId,
                            class_id: classId,
                            status: 'incomplete',
                            deleted_at: null
                        };
                        if (rawData) payload.raw_data = rawData;
                        const { data: updatedIncomplete, error: incompleteErr } = await window.supabaseClient.from('task_completions')
                            .update(payload)
                            .eq('task_id', taskId)
                            .eq('student_id', userId)
                            .eq('class_id', classId)
                            .select();
                        if (incompleteErr) throw incompleteErr;
                        if ((!updatedIncomplete || updatedIncomplete.length === 0) && rawData) {
                            const { error: insertIncompleteErr } = await window.supabaseClient.from('task_completions')
                                .insert([payload]);
                            if (insertIncompleteErr) throw insertIncompleteErr;
                        }
                    }
                }

                // 💣 雷區：寫表成功後，這裡之前完全沒有把 rawData（新上傳／取代的檔案）合併回
                // window._studentTaskCompletions，導致上傳／取代成功後 renderCourses() 用的還是
                // 舊快取——音檔播放器／縮圖要等下次整頁重新整理（fetchData）才會出現新檔案。
                // 依 server 端 student_set_task_completion 的 shallow 合併語意在本地做同樣的事，
                // 讓「上傳成功」與「畫面看到新檔案」是同一次操作，不用重整頁面。
                if (rawData || isChecked) {
                    if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                    let rec = window._studentTaskCompletions.find(c =>
                        String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId)
                    );
                    if (!rec) {
                        rec = { assignment_id: assignmentId, task_id: taskId, status: isChecked ? 'completed' : 'incomplete', raw_data: {} };
                        window._studentTaskCompletions.push(rec);
                    }
                    rec.status = isChecked ? 'completed' : 'incomplete';
                    if (rawData) rec.raw_data = Object.assign({}, rec.raw_data, rawData);
                    renderCourses();
                } else if (!isChecked && window._studentTaskCompletions) {
                    window._studentTaskCompletions = window._studentTaskCompletions.filter(c =>
                        !(String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId))
                    );
                    renderCourses();
                }
            } catch (err) {
                console.error("同步進度失敗：", err);
                if (isChecked) {
                    completedTasks = completedTasks.filter(id => id !== compositeKey);
                    if (window._studentTaskCompletions) {
                        window._studentTaskCompletions = window._studentTaskCompletions.filter(c =>
                            !(String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId))
                        );
                    }
                } else {
                    if (!completedTasks.includes(compositeKey)) completedTasks.push(compositeKey);
                    if (prevCompletion) {
                        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                        const exists = window._studentTaskCompletions.some(c =>
                            String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId)
                        );
                        if (!exists) window._studentTaskCompletions.push(prevCompletion);
                    } else {
                        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                        window._studentTaskCompletions.push({
                            assignment_id: assignmentId,
                            task_id: taskId,
                            status: 'completed',
                            raw_data: {}
                        });
                    }
                }
                renderCourses(); 
                window.showFlash('進度同步失敗：\n' + (err.message || err.details), 'error');
            }
        },
        
        handleFileSelect: async (inputElement, assignmentId, taskId, safeTitleForJS, statusId, dateKey, isLate) => {
            const filesArray = Array.from(inputElement.files || []);
            if (filesArray.length === 0) return;

            const statusEl = document.getElementById(statusId);
            const resetInput = () => { try { inputElement.value = ''; } catch (_e) {} };
            const updateStatus = (msg, color) => {
                if (!statusEl) return;
                statusEl.textContent = msg;
                statusEl.style.color = color;
            };

            updateStatus('⏳ 檢查檔案...', '#F59E0B');

            try {
                const taskConfig = findTaskConfig(assignmentId, taskId);
                const aiGradingEnabled = taskSupportsAIGrading(taskConfig, assignmentId);

                if (aiGradingEnabled && filesArray.length >= 1) {
                    const audioFiles = filesArray.filter(f => isAudioUploadFile(f));
                    if (audioFiles.length === filesArray.length && audioFiles.length > 0) {
                        const targetFile = audioFiles[0];
                        if (targetFile.size > 25 * 1024 * 1024) {
                            throw new Error('音檔超過 25MB，請縮短或壓縮後再上傳。');
                        }
                        resetInput();
                        await uploadAudioForGrading(assignmentId, taskId, safeTitleForJS, statusId, targetFile, targetFile.name);
                        return;
                    }
                }

                let uploadedFileIds = [];
                const { userId, classId } = await getAuthContext();
                if (!window.ApiService || !window.ApiService.uploadToGAS) {
                    throw new Error('系統 API 模組尚未載入完成，請重整網頁。');
                }

                const targetFolderId = resolveStudentUploadFolderId();

                const classPrefix = (classId || '0000').substring(0, 4);
                const cleanDateKey = sanitizeUploadNamePart(dateKey);
                const safeDateStr = (cleanDateKey && cleanDateKey !== '未分類日期') ? `${cleanDateKey}_` : '';
                const lateSuffixStr = isLate ? '_late' : '';
                const titlePart = sanitizeUploadNamePart(safeTitleForJS);
                
                const allImages = filesArray.every(file => file.type && file.type.startsWith('image/'));
                const allAudio = filesArray.every(file => (file.type && file.type.startsWith('audio/')) || file.name.match(/\.(mp3|wav|m4a|ogg|aac)$/i));

                if (filesArray.length > 1 && allAudio) {
                    updateStatus(`⏳ 準備上傳 ${filesArray.length} 個音檔...`, '#F59E0B');
                    // 逐檔 try/catch：單檔失敗只記錄下來，不中斷整批——否則像 6 選 3 成，
                    // 若第 4 個檔案失敗，第 5、6 個永遠不會被嘗試（前 3 個已成功的也無法得知）
                    const failedFiles = [];
                    for (let i = 0; i < filesArray.length; i++) {
                        const file = filesArray[i];
                        try {
                            if (file.size > 25 * 1024 * 1024) throw new Error(`第 ${i+1} 個檔案超過 25MB`);

                            const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                            const finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${titlePart}_${i+1}${lateSuffixStr}${ext}`;

                            let mime = file.type;
                            if (!mime || mime === '' || mime === 'text/plain') {
                                const lowExt = ext.toLowerCase();
                                if (lowExt === '.mp3') mime = 'audio/mpeg';
                                else if (lowExt === '.wav') mime = 'audio/wav';
                                else if (lowExt === '.m4a') mime = 'audio/mp4';
                                else mime = 'audio/mpeg';
                            }
                            const finalMimeType = mime;

                            updateStatus(`🚀 上傳中 (${i+1}/${filesArray.length})...`, '#3B82F6');
                            const base64Data = (await readFileAsDataURL(file)).split(',')[1];

                            const result = await window.ApiService.uploadToGAS(base64Data, finalFileName, finalMimeType, targetFolderId, assignmentId, taskId);
                            uploadedFileIds.push({ id: result.fileId, mime: finalMimeType, name: finalFileName });
                        } catch (fileErr) {
                            console.error(`[handleFileSelect] 第 ${i + 1} 個檔案「${file.name}」上傳失敗`, fileErr);
                            failedFiles.push({ index: i + 1, name: file.name, message: fileErr.message || String(fileErr) });
                        }
                    }

                    if (uploadedFileIds.length > 0) {
                        setTimeout(() => window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true, uploadedFileIds), 500);
                    }

                    if (failedFiles.length === 0) {
                        updateStatus('✅ 上傳成功', '#10B981');
                        window.showFlash('上傳成功！檔案已送到您的專屬資料夾。');
                    } else if (uploadedFileIds.length > 0) {
                        const failedDesc = failedFiles.map(f => `第${f.index}個(${f.name})`).join('、');
                        updateStatus(`⚠️ 成功 ${uploadedFileIds.length}／失敗 ${failedFiles.length}`, '#F59E0B');
                        window.showFlash(`已上傳 ${uploadedFileIds.length} 檔，但 ${failedDesc} 失敗：${failedFiles[0].message}。請只重新選取失敗的檔案再上傳一次。`, 'error');
                    } else {
                        updateStatus('❌ 上傳失敗', '#EF4444');
                        window.showFlash('音檔上傳失敗: ' + failedFiles[0].message, 'error');
                    }
                    resetInput();
                    return;
                }

                let base64Data = '', finalMimeType = '', finalFileName = '';

                if (filesArray.length > 1) {
                    if (!allImages) throw new Error('多檔案上傳目前僅支援「全圖片轉PDF」或「全音檔」。若為混合格式請分次上傳。');
                    updateStatus('⏳ 正在將圖片合併為 PDF...', '#F59E0B');
                    
                    await ensureJsPDFLoaded();
                    const { jsPDF } = window.jspdf;
                    const pdf = new jsPDF(); 

                    for (let i = 0; i < filesArray.length; i++) {
                        const file = filesArray[i];
                        const imgDataUri = await readFileAsDataURL(file);
                        if (i > 0) pdf.addPage(); 
                        const imgProps = pdf.getImageProperties(imgDataUri);
                        const pdfWidth = pdf.internal.pageSize.getWidth(), pdfHeight = pdf.internal.pageSize.getHeight();
                        const ratio = Math.min(pdfWidth / imgProps.width, pdfHeight / imgProps.height);
                        const finalWidth = imgProps.width * ratio, finalHeight = imgProps.height * ratio;
                        pdf.addImage(imgDataUri, 'JPEG', (pdfWidth - finalWidth) / 2, (pdfHeight - finalHeight) / 2, finalWidth, finalHeight);
                    }
                    base64Data = pdf.output('datauristring').split(',')[1];
                    finalMimeType = 'application/pdf';
                    finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${titlePart}${lateSuffixStr}.pdf`;
                } else {
                    const file = filesArray[0];
                    if (file.size > 25 * 1024 * 1024) throw new Error('檔案超過 25MB。');
                    const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                    finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${titlePart}${lateSuffixStr}${ext}`;
                    
                    let mime = file.type;
                    if (!mime || mime === '' || mime === 'text/plain') {
                        const lowExt = ext.toLowerCase();
                        if (lowExt === '.pdf') mime = 'application/pdf';
                        else if (lowExt === '.mp3') mime = 'audio/mpeg';
                        else if (lowExt === '.wav') mime = 'audio/wav';
                        else if (lowExt === '.m4a') mime = 'audio/mp4';
                        else if (lowExt === '.jpg' || lowExt === '.jpeg') mime = 'image/jpeg';
                        else if (lowExt === '.png') mime = 'image/png';
                        else mime = 'application/octet-stream';
                    }
                    finalMimeType = mime;
                    
                    updateStatus('⏳ 處理檔案中...', '#F59E0B');
                    base64Data = (await readFileAsDataURL(file)).split(',')[1];
                }
                
                updateStatus('🚀 上傳雲端中...', '#3B82F6');
                
                const result = await window.ApiService.uploadToGAS(base64Data, finalFileName, finalMimeType, targetFolderId, assignmentId, taskId);
                uploadedFileIds.push({ id: result.fileId, mime: finalMimeType, name: finalFileName }); 

                updateStatus('✅ 上傳成功', '#10B981');
                window.showFlash('上傳成功！檔案已送到您的專屬資料夾。');
                setTimeout(() => window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true, uploadedFileIds), 500);

            } catch (err) {
                console.error('[handleFileSelect]', err);
                const msg = (err && err.message) ? err.message : String(err);
                updateStatus(`❌ 失敗: ${msg}`, '#EF4444');
                window.showFlash('上傳失敗：' + msg, 'error');
            } finally {
                resetInput(); 
            }
        },

        handleAudioFileUpload: async (inputElement, assignmentId, taskId, statusId) => {
            const filesArray = Array.from(inputElement.files || []);
            if (filesArray.length === 0) return;
            inputElement.value = '';

            const taskConfig = findTaskConfig(assignmentId, taskId);
            const items = filesArray.map((f) => ({ blob: f, name: f.name }));
            await uploadAudioFilesForGrading(assignmentId, taskId, sanitizeUploadNamePart(taskTitleForUpload(taskConfig)), statusId, items);
        },

        /**
         * 🔁 取代特定已上傳檔：學生在「已繳交檔案清單」點某一筆的「取代」，
         * 選新檔後直接覆蓋該筆（Drive 舊檔 trash、DB 紀錄換成新檔）。
         * 見 .cursor/rules/drive-folder-upload-invariants.mdc「取代特定已上傳檔」一節。
         *
         * 走哪條路徑由「這個任務是否走 AI 批改」決定（與 uploadAudioFilesForGrading／
         * handleFileSelect 判斷 canSendAI 的邏輯一致），而不是單看 unit_key 有沒有值——
         * 單檔（無分頁）AI 錄音任務的 unit_key 本來就是空字串，仍必須走 AI 覆蓋路徑，
         * 否則替換後不會重新批改，AI 報告會停留在舊音檔的結果。
         */
        handleReplaceFile: async (inputElement, assignmentId, taskId, statusId) => {
            const file = inputElement.files && inputElement.files[0];
            const resetInput = () => { try { inputElement.value = ''; } catch (_e) {} };
            if (!file) { resetInput(); return; }

            const ds = inputElement.dataset || {};
            const oldFileId = ds.oldFileId ? String(ds.oldFileId).trim() : '';
            if (!oldFileId) {
                resetInput();
                window.showFlash('找不到要取代的舊檔案，請重新整理頁面後再試一次。', 'error');
                return;
            }

            const statusEl = document.getElementById(statusId);
            const updateStatus = (msg, color) => {
                if (!statusEl) return;
                statusEl.textContent = msg;
                statusEl.style.color = color;
            };

            if (window._isUploadingAudio) {
                window.showFlash('正在處理上傳中，請稍後再試一次。', 'error');
                resetInput();
                return;
            }
            window._isUploadingAudio = true;
            const originalPointerEvents = document.body.style.pointerEvents;
            document.body.style.pointerEvents = 'none';

            try {
                assertAssignmentUuid(assignmentId, '作業 ID');
                const taskConfig = findTaskConfig(assignmentId, taskId);
                const rawTitle = String((taskConfig && taskConfig.title) || '任務').replace(/<[^>]*>/g, '');
                const safeTitleForJS = rawTitle.replace(/[\\/:*?"<>|]/g, '_') || '任務';
                const scriptText = resolveTaskScriptText(assignmentId, taskId, taskConfig);
                const gradingUnits = getTaskGradingUnits(taskConfig, assignmentId, taskId);
                const unitKey = ds.unitKey ? String(ds.unitKey).trim() : '';
                const hasScript = !!scriptText || gradingUnits.some(u => String(u.original_script || '').trim()) || !!unitKey;
                const canSendAI = hasScript && taskSupportsAIGrading(taskConfig, assignmentId);

                if (canSendAI && isAudioUploadFile(file)) {
                    if (file.size > 25 * 1024 * 1024) throw new Error('檔案超過 25MB。');

                    updateStatus('⚙️ 轉碼／上傳取代檔...', '#3B82F6');
                    const up = await uploadOneAudioBlobWithRetry(
                        assignmentId, taskId, safeTitleForJS, file, file.name || 'recording.wav', true, oldFileId
                    );

                    let originalScript = '';
                    if (ds.scriptB64) {
                        try { originalScript = decodeURIComponent(escape(atob(ds.scriptB64))); } catch (_e) { originalScript = ''; }
                    }
                    const segment = {
                        file_id: up.fileId,
                        audio_url: up.audioUrl,
                        name: up.finalFileName,
                        uploadMime: up.uploadMime,
                        unit_key: unitKey,
                        stem: ds.stem ? String(ds.stem) : '',
                        page: (ds.page !== undefined && ds.page !== '') ? Number(ds.page) : null,
                        label: ds.label ? String(ds.label) : '',
                        original_script: originalScript
                    };

                    updateStatus('🧠 喚醒 AI 重新批改...', '#8B5CF6');
                    await submitAudioSegmentsToAIGrading(assignmentId, taskId, [segment]);
                    const replaceKeys = {};
                    if (unitKey) replaceKeys[unitKey] = true;
                    applyLocalCompletionAfterAudioSubmit(assignmentId, taskId, segment.file_id, segment.audio_url, {
                        drive_file_ids: [segment.file_id],
                        audio_segments: [Object.assign({}, segment, { status: 'pending' })]
                    }, recordingPagesRemaining(taskConfig, assignmentId, taskId, replaceKeys) === 0);

                    updateStatus(`✅ 已取代${segment.label ? '（' + segment.label + '）' : ''}，AI 重新批改中`, '#10B981');
                    window.showFlash('已取代該檔案，AI 將重新批改這一段。');
                } else {
                    const { classId } = await getAuthContext();
                    if (!window.ApiService || !window.ApiService.uploadToGAS) throw new Error('系統 API 模組尚未載入');
                    if (file.size > 25 * 1024 * 1024) throw new Error('檔案超過 25MB。');

                    const targetFolderId = resolveStudentUploadFolderId();
                    const classPrefix = (classId || '0000').substring(0, 4);
                    const cleanDateKey = window.UtilsDate.getTaiwanTodayString().replace(/[\\/:*?"<>|]/g, '_');
                    const ext = file.name && file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                    const finalFileName = `${cleanDateKey}_${classPrefix}_${studentUsername}_${sanitizeUploadNamePart(safeTitleForJS)}_replace${ext}`;

                    let mime = file.type;
                    if (!mime || mime === '' || mime === 'text/plain') {
                        const lowExt = ext.toLowerCase();
                        if (lowExt === '.pdf') mime = 'application/pdf';
                        else if (lowExt === '.mp3') mime = 'audio/mpeg';
                        else if (lowExt === '.wav') mime = 'audio/wav';
                        else if (lowExt === '.m4a') mime = 'audio/mp4';
                        else if (lowExt === '.jpg' || lowExt === '.jpeg') mime = 'image/jpeg';
                        else if (lowExt === '.png') mime = 'image/png';
                        else mime = 'application/octet-stream';
                    }

                    updateStatus('🚀 上傳取代檔...', '#3B82F6');
                    const base64Data = (await readFileAsDataURL(file)).split(',')[1];
                    const result = await window.ApiService.uploadToGAS(base64Data, finalFileName, mime, targetFolderId, assignmentId, taskId, oldFileId);

                    const replaceKeys = {};
                    if (unitKey) replaceKeys[unitKey] = true;
                    await window.FeatureStudentTimeline.updateProgress(
                        assignmentId, taskId,
                        recordingPagesRemaining(taskConfig, assignmentId, taskId, replaceKeys) === 0,
                        [{ id: result.fileId, mime, name: finalFileName, unit_key: unitKey, label: ds.label ? String(ds.label) : '', page: (ds.page !== undefined && ds.page !== '') ? ds.page : null }],
                        oldFileId
                    );

                    updateStatus('✅ 已取代該檔案', '#10B981');
                    window.showFlash('已取代該檔案。');
                }
                renderCourses();
            } catch (err) {
                console.error('[handleReplaceFile]', err);
                const msg = (err && err.message) ? err.message : String(err);
                updateStatus(`❌ 取代失敗: ${msg}`, '#EF4444');
                window.showFlash('取代失敗：' + msg, 'error');
            } finally {
                window._isUploadingAudio = false;
                document.body.style.pointerEvents = originalPointerEvents;
                resetInput();
            }
        },

        openAudioStudio: (assignmentId, taskId) => {
            if (window.FeatureStudentAudio) {
                
                let foundTask = null;
                const findTaskRecursive = (taskList) => {
                    if (!taskList || !Array.isArray(taskList)) return;
                    for (let i = 0; i < taskList.length; i++) {
                        const t = taskList[i];
                        if (String(t.id) === String(taskId)) {
                            foundTask = t;
                            return;
                        }
                        if (t.type === 'group' && t.subTasks) {
                            findTaskRecursive(t.subTasks);
                        }
                    }
                };

                const assignRecord = assignments.find(a => String(a.id) === String(assignmentId));
                if (assignRecord) {
                    let parsedTasks = [];
                    if (typeof assignRecord.tasks === 'string') {
                        try { parsedTasks = JSON.parse(assignRecord.tasks); } catch(e) {}
                    } else if (Array.isArray(assignRecord.tasks)) {
                        parsedTasks = assignRecord.tasks;
                    }
                    findTaskRecursive(parsedTasks);
                }

                const raw = (foundTask && foundTask.raw_data) || {};
                let originalScript = raw.original_script ? String(raw.original_script) : '';
                let studioScript = '';
                if (raw.student_display_text) studioScript = String(raw.student_display_text);
                else if (raw.student_display) studioScript = String(raw.student_display);
                else if (raw.student_text) studioScript = String(raw.student_text);
                else studioScript = originalScript;
                const boothScript = studioScript || originalScript;

                let displayTitle = String((foundTask && foundTask.title) || '').replace(/<[^>]*>/g, '').trim();
                if (!displayTitle && raw.material_range) displayTitle = String(raw.material_range).trim();
                if (!displayTitle) displayTitle = '語音錄製任務';

                let finalMaterialUrl = '';
                if (raw.student_local_b64) {
                    const b64 = raw.student_local_b64;
                    let mime = raw.student_local_mime || 'application/pdf';
                    if (mime === 'text/plain') mime = 'application/pdf';
                    finalMaterialUrl = b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`;
                } else {
                    finalMaterialUrl = raw.student_drive_url || raw.student_local_url || raw.url || raw.material_url || '';
                }

                let finalMaterialRange = raw.material_range || raw.student_drive_desc || raw.student_local_desc || '';

                const board = loadRecordingBoard(assignmentId, taskId, foundTask);
                const studioPages = board.pages;
                const submittedKeys = board.submittedKeys;
                const initialIndex = firstUnsubmittedStudioIndex(studioPages, submittedKeys, -1);
                const uploadTitle = sanitizeUploadNamePart(displayTitle);

                window.FeatureStudentAudio.openStudio(displayTitle, boothScript, finalMaterialUrl, finalMaterialRange, async (audioData) => {
                    const statusId = `upload-status-${assignmentId}-${taskId}`;
                    const bin = atob(audioData.base64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    const wavBlob = new Blob([bytes], { type: audioData.mimeType || 'audio/wav' });
                    const targetUnit = audioData.page || null;
                    const result = await uploadAudioFilesForGrading(
                        assignmentId, taskId, uploadTitle, statusId,
                        [{ blob: wavBlob, name: audioData.fileName || 'recording.wav' }],
                        { targetUnit: targetUnit }
                    );
                    if (!result) return { keepOpen: true };
                    const keys = result.submittedKeys || submittedUnitKeyMap(assignmentId, taskId);
                    const nextIndex = firstUnsubmittedStudioIndex(studioPages, keys, audioData.pageIndex);
                    if (studioPages.length > 1 && nextIndex >= 0) {
                        const nextLabel = studioPages[nextIndex] && (studioPages[nextIndex].label || studioPages[nextIndex].unit_key);
                        window.showFlash('這一頁已繳交。請繼續錄「' + (nextLabel || ('第 ' + (nextIndex + 1) + ' 頁')) + '」。');
                        return { keepOpen: true, nextIndex: nextIndex, submittedKeys: keys };
                    }
                    return { keepOpen: false };
                }, {
                    pages: studioPages,
                    initialIndex: initialIndex < 0 ? 0 : initialIndex,
                    submittedKeys: submittedKeys,
                    pdfFileId: foundTask && foundTask.raw_data && foundTask.raw_data.script_source === 'resource'
                        ? String(foundTask.raw_data.student_pdf_file_id || '')
                        : '',
                    pdfPages: foundTask && foundTask.raw_data && foundTask.raw_data.script_source === 'resource'
                        && Array.isArray(foundTask.raw_data.student_pdf_pages)
                        ? foundTask.raw_data.student_pdf_pages
                        : []
                });
            } else {
                window.showFlash('系統正在載入錄音模組，請稍候重試。', 'error');
            }
        },
        
        openDriveAndCheck: async () => {
            const folderId = extractDriveFolderId(studentDriveUrl);
            if (!folderId) {
                window.showFlash('尚未設定專屬資料夾，請通知老師綁定。', 'error');
                window.open('https://drive.google.com/', '_blank');
                return;
            }
            // 開啟前盡力補上學生編輯權限，避免「需要存取權」假象干擾確認上傳
            try {
                if (window.ApiService && typeof window.ApiService.ensureGASFolderSharing === 'function' && window.supabaseClient) {
                    const { userId } = await getAuthContext();
                    const { data: profileRow } = await window.supabaseClient
                        .from('profiles')
                        .select('email, raw_data')
                        .eq('id', userId)
                        .maybeSingle();
                    let secondary = '';
                    try {
                        let raw = profileRow?.raw_data || {};
                        if (typeof raw === 'string') raw = JSON.parse(raw);
                        secondary = (raw?.emailSecondary || '').trim();
                    } catch (_e) {}
                    const shareEmails = [...new Set(
                        [profileRow?.email, secondary]
                            .map(e => String(e || '').trim().toLowerCase())
                            .filter(e => e && e.indexOf('@') !== -1)
                    )];
                    await window.ApiService.ensureGASFolderSharing(folderId, {
                        permission: 'edit',
                        shareEmails: shareEmails
                    });
                }
            } catch (shareErr) {
                console.warn('[openDriveAndCheck] 補權限失敗', shareErr);
            }
            window.open(safeFormatUrl(folderId), '_blank');
        },

        // 💣 雷區：學生端已拔除「手動提交／重新提交 AI 批改」。
        // 送批只走錄音繳交／上傳成功路徑；勿再掛回 UI（見 .cursor/rules/ai-grading-pipeline-invariants.mdc）。
        retryAIGrading: async function () {
            if (window.showFlash) {
                window.showFlash('學生端已停用手動提交 AI 批改。若需重送，請由老師在進度表補啟／續跑。', 'error');
            }
            return;
        },

        toggleAIReport: (compositeKey) => {
            const body = document.getElementById(`ai-report-body-${compositeKey}`);
            const icon = document.getElementById(`toggle-icon-${compositeKey}`);
            if (!body) return;
            
            if (body.style.display === 'none') {
                body.style.display = 'block';
                if (icon) icon.textContent = '🔽';
                localStorage.setItem(`ai_report_collapsed_${compositeKey}`, 'false');
            } else {
                body.style.display = 'none';
                if (icon) icon.textContent = '◀️';
                localStorage.setItem(`ai_report_collapsed_${compositeKey}`, 'true');
            }
        },

        toggleAIHistoryRow: (compositeKey, rowKey) => {
            const detailRow = document.getElementById(`ai-history-detail-${compositeKey}-${rowKey}`);
            const icon = document.getElementById(`ai-history-icon-${compositeKey}-${rowKey}`);
            if (!detailRow) return;

            const isOpen = detailRow.style.display !== 'none';
            const prefix = `ai-history-detail-${compositeKey}-`;
            document.querySelectorAll(`[id^="${prefix}"]`).forEach(el => {
                el.style.display = 'none';
            });
            document.querySelectorAll(`[id^="ai-history-icon-${compositeKey}-"]`).forEach(el => {
                el.textContent = '▶';
            });

            const toggleBtn = document.getElementById(`ai-history-toggle-all-${compositeKey}`);
            if (toggleBtn) toggleBtn.textContent = '展開全部摘要';

            if (!isOpen) {
                detailRow.style.display = 'table-row';
                if (icon) icon.textContent = '▼';
                localStorage.setItem(`ai_history_open_${compositeKey}`, String(rowKey));
            } else if (rowKey === 'current') {
                localStorage.setItem(`ai_history_open_${compositeKey}`, 'current');
            } else {
                localStorage.setItem(`ai_history_open_${compositeKey}`, '-1');
            }
        },

        toggleAIHistoryFull: (compositeKey, historyIndex) => {
            const full = document.getElementById(`ai-history-full-${compositeKey}-${historyIndex}`);
            const btn = document.getElementById(`ai-history-full-btn-${compositeKey}-${historyIndex}`);
            if (!full) return;
            if (full.style.display === 'none') {
                full.style.display = 'block';
                if (btn) btn.textContent = '收合完整報告';
            } else {
                full.style.display = 'none';
                if (btn) btn.textContent = '查看完整報告';
            }
        },

        toggleAllAIHistorySummaries: (compositeKey) => {
            const toggleBtn = document.getElementById(`ai-history-toggle-all-${compositeKey}`);
            const detailPrefix = `ai-history-detail-${compositeKey}-`;
            const rows = document.querySelectorAll(`[id^="${detailPrefix}"]`);
            let anyOpen = false;
            rows.forEach(el => {
                if (el.style.display !== 'none') anyOpen = true;
            });
            const expand = !anyOpen;

            rows.forEach(el => {
                const rowKey = el.id.replace(detailPrefix, '');
                const icon = document.getElementById(`ai-history-icon-${compositeKey}-${rowKey}`);
                const full = document.getElementById(`ai-history-full-${compositeKey}-${rowKey}`);
                const btn = document.getElementById(`ai-history-full-btn-${compositeKey}-${rowKey}`);
                if (expand) {
                    el.style.display = 'table-row';
                    if (icon) icon.textContent = '▼';
                    if (full) full.style.display = 'none';
                    if (btn) btn.textContent = '查看完整報告';
                } else {
                    el.style.display = 'none';
                    if (icon) icon.textContent = '▶';
                    if (full) full.style.display = 'none';
                    if (btn) btn.textContent = '查看完整報告';
                }
            });

            if (toggleBtn) toggleBtn.textContent = expand ? '收合全部' : '展開全部摘要';
            if (expand) {
                localStorage.setItem(`ai_history_open_${compositeKey}`, 'all');
            } else {
                localStorage.setItem(`ai_history_open_${compositeKey}`, '-1');
            }
        }
    };
})();
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

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
    }

    function assertAssignmentUuid(assignmentId, label) {
        if (!isUuid(assignmentId)) {
            throw new Error((label || '作業 ID') + ' 格式錯誤：' + String(assignmentId)
                + '。請強制重新整理頁面後再試；若仍失敗請聯絡老師檢查作業設定。');
        }
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
        // drive（上傳資料夾）與 audio_record（錄音艙）都可 AI；有無文稿另檢
        if (task.type === 'audio_record' || task.type === 'drive') return true;
        if (raw.use_ai_grading === true) return true;
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

    function applyLocalCompletionAfterAudioSubmit(assignmentId, taskId, fileId, audioUrl) {
        const compositeKey = `${assignmentId}_${taskId}`;
        if (!completedTasks.includes(compositeKey)) completedTasks.push(compositeKey);
        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
        const audioUrlStr = audioUrl ? String(audioUrl) : '';
        const rawPatch = {
            drive_file_ids: fileId ? [String(fileId)] : [],
            student_audio_url: audioUrlStr,
            audio_url: audioUrlStr
        };
        let tempRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId));
        if (tempRecord) {
            tempRecord.status = 'ai_processing';
            const prevRaw = tempRecord.raw_data ? tempRecord.raw_data : {};
            tempRecord.raw_data = Object.assign({}, prevRaw, rawPatch);
        } else {
            window._studentTaskCompletions.push({
                assignment_id: assignmentId,
                task_id: taskId,
                status: 'ai_processing',
                raw_data: rawPatch
            });
        }
    }

    async function submitAudioToAIGrading(assignmentId, taskId, fileId, audioUrl) {
        assertAssignmentUuid(assignmentId, '作業 ID');
        const { userId, classId } = await getAuthContext();
        if (!window.supabaseClient) throw new Error('系統 API 模組尚未載入');
        const { error: rpcErr } = await window.supabaseClient.rpc('submit_audio_task_atomic', {
            p_assignment_id: assignmentId,
            p_task_id: String(taskId),
            p_student_id: userId,
            p_class_id: classId,
            p_file_id: fileId,
            p_audio_url: audioUrl
        });
        if (rpcErr) throw rpcErr;
    }

    async function uploadAudioForGrading(assignmentId, taskId, safeTitleForJS, statusId, fileBlob, originalFileName) {
        const statusEl = document.getElementById(statusId);

        if (window._isUploadingAudio) {
            console.warn('正在處理上傳中，請勿重複點擊');
            return;
        }
        window._isUploadingAudio = true;
        const originalPointerEvents = document.body.style.pointerEvents;
        document.body.style.pointerEvents = 'none';

        try {
            assertAssignmentUuid(assignmentId, '作業 ID');
            const taskConfig = findTaskConfig(assignmentId, taskId);
            const scriptText = resolveTaskScriptText(assignmentId, taskId, taskConfig);
            const canSendAI = !!scriptText;

            if (statusEl) {
                statusEl.textContent = canSendAI ? '⚙️ 音檔轉碼中...' : '🚀 音檔上傳中...';
                statusEl.style.color = '#3B82F6';
            }

            let uploadBlob = fileBlob;
            let uploadMime = (fileBlob && fileBlob.type) ? fileBlob.type : 'audio/mpeg';
            let uploadExt = '.mp3';
            if (originalFileName && originalFileName.includes('.')) {
                uploadExt = originalFileName.substring(originalFileName.lastIndexOf('.'));
            }

            // 有文稿才轉 wav 送 AI；無文稿則原檔上傳到資料夾即可
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

            if (statusEl) {
                statusEl.textContent = '🚀 音檔上傳中...';
                statusEl.style.color = '#3B82F6';
            }

            const { userId, classId } = await getAuthContext();
            if (!studentDriveUrl) throw new Error('老師尚未為您設定專屬資料夾！');
            if (!window.ApiService || !window.ApiService.uploadToGAS) throw new Error('系統 API 模組尚未載入');

            let targetFolderId = studentDriveUrl;
            const folderMatch = targetFolderId.match(/folders\/([a-zA-Z0-9-_]+)/);
            if (folderMatch && folderMatch[1]) targetFolderId = folderMatch[1];

            const classPrefix = (classId ? classId : '0000').substring(0, 4);
            const cleanDateKey = window.UtilsDate.getTaiwanTodayString().replace(/[\\/:*?"<>|]/g, '_');
            const baseName = originalFileName ? originalFileName.replace(/\.[^/.]+$/, '') : 'Upload';
            const finalFileName = `${cleanDateKey}_${classPrefix}_${studentUsername}_${safeTitleForJS}_${baseName}${uploadExt}`;

            const result = await window.ApiService.uploadToGAS(base64Data, finalFileName, uploadMime, targetFolderId, assignmentId, taskId);
            const audioUrl = `https://drive.google.com/file/d/${result.fileId}/view`;

            if (canSendAI) {
                if (statusEl) {
                    statusEl.textContent = '🧠 喚醒 AI 大腦批改中...';
                    statusEl.style.color = '#8B5CF6';
                }
                await submitAudioToAIGrading(assignmentId, taskId, result.fileId, audioUrl);
                if (statusEl) {
                    statusEl.textContent = '✅ 繳交成功！AI 已接管';
                    statusEl.style.color = '#10B981';
                }
                applyLocalCompletionAfterAudioSubmit(assignmentId, taskId, result.fileId, audioUrl);
            } else {
                await window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true, [result.fileId]);
                if (statusEl) {
                    statusEl.textContent = '✅ 已上傳到資料夾（無文稿，略過 AI）';
                    statusEl.style.color = '#10B981';
                }
                window.showFlash('音檔已上傳到資料夾。此任務尚未設定批改文稿，故未送 AI。');
            }
            renderCourses();
        } catch (err) {
            window.showFlash('音檔上傳失敗: ' + err.message, 'error');
            if (statusEl) {
                statusEl.textContent = '❌ 上傳失敗';
                statusEl.style.color = '#EF4444';
            }
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

            const { data: profileData } = await window.supabaseClient
                .from('profiles')
                .select('name')
                .eq('id', userId)
                .single();
                
            studentUsername = profileData?.name || '學生';

            const { data: enrollData, error: enrollErr } = await window.supabaseClient
                .from('student_enrollments')
                .select('raw_data, drive_link, drive_url')
                .eq('user_id', userId)
                .eq('class_id', classId)
                .is('deleted_at', null)
                .single();

            if (enrollErr) console.warn("[DB Warning] 找不到該學生的班級註冊紀錄", enrollErr);

            let enrollRaw = enrollData?.raw_data || {};
            if (typeof enrollRaw === 'string') {
                try { enrollRaw = JSON.parse(enrollRaw); } catch(e) { enrollRaw = {}; }
            }

            studentDriveUrl = enrollRaw.drive_folder_id || enrollData?.drive_link || enrollData?.drive_url || null;

            const { data: classData } = await window.supabaseClient
                .from('classes')
                .select('*')
                .eq('id', classId)
                .single();
            currentClassConfig = classData || {};

            const { data: assignData, error: assignErr } = await window.supabaseClient
                .from('assignments')
                .select('*')
                .eq('class_id', classId)
                .eq('is_published', true) 
                .is('deleted_at', null);

            if (assignErr) throw assignErr;
            assignments = assignData || [];

            const { data: compData, error: compErr } = await window.supabaseClient
                .from('task_completions')
                .select('assignment_id, task_id, status, raw_data')
                .eq('student_id', userId)
                .eq('class_id', classId)
                .is('deleted_at', null)
                .neq('status', 'incomplete');

            if (compErr) throw compErr;
            window._studentTaskCompletions = compData || [];
            completedTasks = (compData || []).map(row => `${row.assignment_id}_${row.task_id}`);

            renderCourses();
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
        let mode = cls.calc_mode || cls.calcMode || raw.calc_mode || raw.calcMode || 'single';
        let meetDays = (cls.meet_days || cls.meetDays || raw.meet_days || raw.meetDays || []).map(Number).filter(n => !isNaN(n));
        let weekStartSetting = raw.week_start_day || 'sunday';
        
        let sessions = [];
        if (Array.isArray(cls.sessions) && cls.sessions.length > 0) sessions = cls.sessions;
        else if (Array.isArray(raw.sessions) && raw.sessions.length > 0) sessions = raw.sessions;
        else if (Array.isArray(cls.session_dates) && cls.session_dates.length > 0) sessions = cls.session_dates;
        else if (Array.isArray(raw.session_dates) && raw.session_dates.length > 0) sessions = raw.session_dates;
        else {
            let startDateStr = cls.start_date || cls.startDate || raw.start_date || raw.startDate;
            let endDateStr = cls.end_date || cls.endDate || raw.end_date || raw.endDate;
            if (startDateStr && endDateStr && meetDays.length > 0) {
                let sNorm = DateUtils.normalizeDateString(startDateStr);
                let eNorm = DateUtils.normalizeDateString(endDateStr);
                sessions = DateUtils.generateDates(sNorm, eNorm, meetDays);
            }
            if (sessions.length === 0) sessions = [...new Set(assignments.map(a => DateUtils.normalizeDateString(a.target_date)))].filter(Boolean).sort();
        }

        sessions = sessions.map(d => DateUtils.normalizeDateString(d)).filter(Boolean);

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
                if (window.FeatureStudentMessages && typeof window.FeatureStudentMessages.refreshBadgeOnly === 'function') {
                    window.FeatureStudentMessages.refreshBadgeOnly();
                }
                const pendingId = sessionStorage.getItem('pendingJumpAssignmentId');
                if (pendingId) {
                    sessionStorage.removeItem('pendingJumpAssignmentId');
                    const progressTab = document.querySelector('.tab-link[data-view="progress"]');
                    if (progressTab && typeof window.FeatureStudentTimeline.switchView === 'function') {
                        window.FeatureStudentTimeline.switchView('progress', progressTab);
                    }
                    setTimeout(function () {
                        if (!jumpToAssignment(pendingId)) scrollToCurrentWeek();
                    }, 150);
                    return;
                }
                const allowed = { progress: 1, messages: 1, resources: 1, personal: 1, class: 1 };
                let savedView = '';
                try { savedView = localStorage.getItem('studentActiveView') || ''; } catch (_e) {}
                if (!allowed[savedView]) savedView = 'messages';
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
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
            const viewEl = document.getElementById(`view-${viewId}`);
            if (viewEl) viewEl.classList.add('active');
            if (btnElement) btnElement.classList.add('active');
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
            }
        },

        jumpToAssignment,

        updateProgress: async (assignmentId, taskId, isChecked, fileIds = null) => {
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
                }
                else if (!isChecked) {
                    completedTasks = completedTasks.filter(id => id !== compositeKey);
                    if (window._studentTaskCompletions) {
                        window._studentTaskCompletions = window._studentTaskCompletions.filter(c =>
                            !(String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId))
                        );
                    }
                }
                renderCourses();

                const rawData = (fileIds && fileIds.length > 0)
                    ? { drive_file_ids: fileIds }
                    : null;

                // 優先走 RPC（避開 soft-delete RETURNING 的 RLS 邊角）
                const { error: rpcErr } = await window.supabaseClient.rpc('student_set_task_completion', {
                    p_assignment_id: assignmentId,
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
                        // 取消勾選＝未完成（保留列，不刪除）
                        const { error } = await window.supabaseClient.from('task_completions')
                            .update({ status: 'incomplete', deleted_at: null })
                            .eq('task_id', taskId)
                            .eq('student_id', userId)
                            .eq('class_id', classId);
                        if (error) throw error;
                    }
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
            const filesArray = Array.from(inputElement.files);
            if (filesArray.length === 0) return;
            const statusEl = document.getElementById(statusId);
            if (!statusEl) return;

            const resetInput = () => { inputElement.value = ''; };
            const updateStatus = (msg, color) => {
                statusEl.textContent = msg;
                statusEl.style.color = color;
            };

            updateStatus('⏳ 檢查檔案...', '#F59E0B');

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

            try {
                const { userId, classId } = await getAuthContext(); 
                if (!studentDriveUrl) throw new Error('老師尚未為您設定專屬資料夾！');

                if (!window.ApiService || !window.ApiService.uploadToGAS) {
                    throw new Error("系統 API 模組尚未載入完成，請重整網頁。");
                }

                let targetFolderId = studentDriveUrl;
                const match = targetFolderId.match(/folders\/([a-zA-Z0-9-_]+)/);
                if (match && match[1]) targetFolderId = match[1];

                const classPrefix = (classId || '0000').substring(0, 4);
                const cleanDateKey = dateKey.replace(/[\\/:*?"<>|]/g, '_');
                const safeDateStr = (cleanDateKey && cleanDateKey !== '未分類日期') ? `${cleanDateKey}_` : '';
                const lateSuffixStr = isLate ? '_late' : '';
                
                const allImages = filesArray.every(file => file.type.startsWith('image/'));
                const allAudio = filesArray.every(file => file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|ogg|aac)$/i));

                if (filesArray.length > 1 && allAudio) {
                    updateStatus(`⏳ 準備上傳 ${filesArray.length} 個音檔...`, '#F59E0B');
                    for (let i = 0; i < filesArray.length; i++) {
                        const file = filesArray[i];
                        if (file.size > 25 * 1024 * 1024) throw new Error(`第 ${i+1} 個檔案超過 25MB。`);
                        
                        const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                        const finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${safeTitleForJS}_${i+1}${lateSuffixStr}${ext}`;
                        
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
                        uploadedFileIds.push(result.fileId); 
                    }
                    
                    updateStatus('✅ 上傳成功', '#10B981');
                    setTimeout(() => window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true, uploadedFileIds), 500);
                    resetInput(); 
                    return; 
                }

                let base64Data = '', finalMimeType = '', finalFileName = '';

                if (filesArray.length > 1) {
                    if (!allImages) throw new Error("多檔案上傳目前僅支援「全圖片轉PDF」或「全音檔」。若為混合格式請分次上傳。");
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
                    finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${safeTitleForJS}${lateSuffixStr}.pdf`;
                } else {
                    const file = filesArray[0];
                    if (file.size > 25 * 1024 * 1024) throw new Error("檔案超過 25MB。");
                    const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '';
                    finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${safeTitleForJS}${lateSuffixStr}${ext}`;
                    
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
                uploadedFileIds.push(result.fileId); 

                updateStatus('✅ 上傳成功', '#10B981');
                setTimeout(() => window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true, uploadedFileIds), 500);

            } catch (err) {
                updateStatus(`❌ 失敗: ${err.message}`, '#EF4444');
            } finally {
                resetInput(); 
            }
        },

        handleAudioFileUpload: async (inputElement, assignmentId, taskId, safeTitleForJS, statusId, isLate) => {
            const filesArray = Array.from(inputElement.files);
            if (filesArray.length === 0) return;
            const file = filesArray[0];
            inputElement.value = '';

            if (!isAudioUploadFile(file)) {
                window.showFlash('請上傳音檔格式（支援 mp3, wav, m4a, ogg, aac, webm, flac 等）', 'error');
                return;
            }
            if (file.size > 25 * 1024 * 1024) {
                window.showFlash('檔案超過 25MB，請縮短錄音或壓縮後再上傳。', 'error');
                return;
            }

            await uploadAudioForGrading(assignmentId, taskId, safeTitleForJS, statusId, file, file.name);
        },

        openAudioStudio: (assignmentId, taskId, safeTitleForJS, safeScriptForJS, safeMatUrl, safeMatRange) => {
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

                let finalMaterialUrl = safeMatUrl;
                if (finalMaterialUrl === 'undefined' || finalMaterialUrl === 'null') finalMaterialUrl = '';
                
                let finalMaterialRange = safeMatRange;
                if (finalMaterialRange === 'undefined' || finalMaterialRange === 'null') finalMaterialRange = '';

                if (foundTask && foundTask.raw_data) {
                    if (!finalMaterialUrl) {
                        if (foundTask.raw_data.student_local_b64) {
                            const b64 = foundTask.raw_data.student_local_b64;
                            let mime = foundTask.raw_data.student_local_mime || 'application/pdf';
                            if (mime === 'text/plain') mime = 'application/pdf'; 
                            finalMaterialUrl = b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`;
                        } else {
                            finalMaterialUrl = foundTask.raw_data.student_drive_url || foundTask.raw_data.student_local_url || foundTask.raw_data.url || '';
                        }
                    }

                    if (!finalMaterialRange) {
                        finalMaterialRange = foundTask.raw_data.student_drive_desc || foundTask.raw_data.student_local_desc || '';
                    }
                }

                window.FeatureStudentAudio.openStudio(safeTitleForJS, safeScriptForJS, finalMaterialUrl, finalMaterialRange, async (audioData) => {
                    const statusId = `upload-status-${assignmentId}-${taskId}`;
                    const statusEl = document.getElementById(statusId);
                    
                    if (window._isUploadingAudio) {
                        console.warn('正在處理上傳中，請勿重複點擊');
                        return;
                    }
                    window._isUploadingAudio = true;
                    const originalPointerEvents = document.body.style.pointerEvents;
                    document.body.style.pointerEvents = 'none';

                    try {
                        assertAssignmentUuid(assignmentId, '作業 ID');
                        const taskConfig = findTaskConfig(assignmentId, taskId);
                        const scriptText = resolveTaskScriptText(assignmentId, taskId, taskConfig);
                        const canSendAI = !!scriptText;

                        if (statusEl) {
                            statusEl.textContent = '🚀 錄音上傳中...';
                            statusEl.style.color = '#3B82F6';
                        }
                        
                        const { userId, classId } = await getAuthContext(); 
                        if (!studentDriveUrl) throw new Error('老師尚未為您設定專屬資料夾！');
                        if (!window.ApiService || !window.ApiService.uploadToGAS) throw new Error("系統 API 模組尚未載入");

                        let targetFolderId = studentDriveUrl;
                        const match = targetFolderId.match(/folders\/([a-zA-Z0-9-_]+)/);
                        if (match && match[1]) targetFolderId = match[1];

                        const classPrefix = (classId || '0000').substring(0, 4);
                        const cleanDateKey = window.UtilsDate.getTaiwanTodayString().replace(/[\\/:*?"<>|]/g, '_');
                        const finalFileName = `${cleanDateKey}_${classPrefix}_${studentUsername}_${safeTitleForJS}_${audioData.fileName}`;

                        const result = await window.ApiService.uploadToGAS(audioData.base64, finalFileName, audioData.mimeType, targetFolderId, assignmentId, taskId);
                        const audioUrl = `https://drive.google.com/file/d/${result.fileId}/view`;

                        if (canSendAI) {
                            if (statusEl) {
                                statusEl.textContent = '🧠 喚醒 AI 大腦批改中...';
                                statusEl.style.color = '#8B5CF6';
                            }
                            await submitAudioToAIGrading(assignmentId, taskId, result.fileId, audioUrl);
                            if (statusEl) {
                                statusEl.textContent = '✅ 繳交成功！AI 已接管';
                                statusEl.style.color = '#10B981';
                            }
                            applyLocalCompletionAfterAudioSubmit(assignmentId, taskId, result.fileId, audioUrl);
                        } else {
                            await window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true, [result.fileId]);
                            if (statusEl) {
                                statusEl.textContent = '✅ 已上傳（無文稿，略過 AI）';
                                statusEl.style.color = '#10B981';
                            }
                            window.showFlash('錄音已上傳。此任務尚未設定批改文稿，故未送 AI。');
                        }
                        renderCourses();

                    } catch (err) {
                        window.showFlash('錄音上傳失敗: ' + err.message, 'error');
                        if (statusEl) {
                            statusEl.textContent = '❌ 上傳失敗';
                            statusEl.style.color = '#EF4444';
                        }
                    } finally {
                        window._isUploadingAudio = false; 
                        document.body.style.pointerEvents = originalPointerEvents;
                    }
                });
            } else {
                window.showFlash('系統正在載入錄音模組，請稍候重試。', 'error');
            }
        },
        
        openDriveAndCheck: async () => {
            if (!studentDriveUrl) {
                window.open("https://drive.google.com/", '_blank');
                return;
            }
            window.open(safeFormatUrl(studentDriveUrl), '_blank');
        },

        retryAIGrading: async (assignmentId, taskId, fileId, audioUrl) => {
            if (window._isUploadingAudio) {
                console.warn('正在處理中，請勿重複點擊');
                return;
            }
            window._isUploadingAudio = true;
            
            const statusId = `upload-status-${assignmentId}-${taskId}`;
            const statusEl = document.getElementById(statusId);

            try {
                assertAssignmentUuid(assignmentId, '作業 ID');
                const taskConfig = findTaskConfig(assignmentId, taskId);
                const scriptText = resolveTaskScriptText(assignmentId, taskId, taskConfig);
                if (!scriptText) {
                    throw new Error('尚未設定批改文稿，無法送 AI。請通知老師先套用 Snapshot 或貼上文稿。');
                }

                if (statusEl) {
                    statusEl.textContent = '🚀 手動喚醒 AI 批改中...';
                    statusEl.style.color = '#3B82F6';
                }
                
                const { userId, classId } = await getAuthContext(); 
                if (!window.supabaseClient) throw new Error("系統 API 模組尚未載入");
                
                if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                let tempRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId));
                if (tempRecord) {
                    tempRecord.status = 'ai_processing';
                }
                renderCourses();

                const { error: rpcErr } = await window.supabaseClient.rpc('submit_audio_task_atomic', {
                    p_assignment_id: assignmentId,
                    p_task_id: taskId,
                    p_student_id: userId,
                    p_class_id: classId,
                    p_file_id: fileId,
                    p_audio_url: audioUrl
                });

                if (rpcErr) throw rpcErr;
                
                if (statusEl) {
                    statusEl.textContent = '✅ 已提交！AI 已接管';
                    statusEl.style.color = '#10B981';
                }

                applyLocalCompletionAfterAudioSubmit(assignmentId, taskId, fileId, audioUrl);
                renderCourses();

            } catch (err) {
                window.showFlash('重新啟動 AI 失敗: ' + err.message, 'error');
                if (statusEl) {
                    statusEl.textContent = '❌ 提交失敗';
                    statusEl.style.color = '#EF4444';
                }
                let tempRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId));
                if (tempRecord) {
                    tempRecord.status = 'ai_error';
                }
                renderCourses();
            } finally {
                window._isUploadingAudio = false; 
            }
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
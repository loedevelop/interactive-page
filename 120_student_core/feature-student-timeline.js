/**
 * 📂 檔案路徑：120_student_core/feature-student-timeline.js
 * 🌟 UX 視覺終極打磨版 & API 解耦瘦身版 (v56 完整版)
 * 🚀 核心修復：找回被我誤拔的 Base64 護城河！導入免重錄重試引擎！
 */

window.FeatureStudentTimeline = (() => {
    let assignments = [];
    let completedTasks = []; 
    let studentDriveUrl = null; 
    let studentUsername = '學生';
    let currentClassConfig = null; 

    const scrollToCurrentWeek = () => {
        const targetNode = document.querySelector('.timeline-node[data-is-current="true"]');
        if (targetNode) {
            targetNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    async function getAuthContext() {
        if (!window.supabaseClient) throw new Error("系統連線尚未準備完成");
        const { data: { user }, error } = await window.supabaseClient.auth.getUser();
        if (error || !user) throw new Error("授權無效或已登出");
        const classId = sessionStorage.getItem('currentClassId');
        if (!classId) throw new Error("尚未選擇班級");
        return { userId: user.id, classId };
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
                .is('deleted_at', null);

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

        const htmlString = window.UIStudentTimelineTemplates.renderTimelineNodes(
            timelineNodes, assignments, completedTasks, currentWeekStart, mode, weekStartSetting, DateUtils, studentDriveUrl, safeFormatUrl
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
            fetchData();
        },

        switchView: (viewId, btnElement) => {
            document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
            document.getElementById(`view-${viewId}`).classList.add('active');
            btnElement.classList.add('active');
            
            if (viewId === 'progress') {
                renderCourses();
                setTimeout(scrollToCurrentWeek, 100);
            } else if (viewId === 'resources') {
                if (window.FeatureStudentResource && currentClassConfig) {
                    window.FeatureStudentResource.init(currentClassConfig);
                }
            }
        },

        updateProgress: async (assignmentId, taskId, isChecked, fileIds = null) => {
            try {
                const { userId, classId } = await getAuthContext();
                const compositeKey = `${assignmentId}_${taskId}`;
                
                if (isChecked && !completedTasks.includes(compositeKey)) {
                    completedTasks.push(compositeKey);
                    if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                    window._studentTaskCompletions.push({ assignment_id: assignmentId, task_id: taskId, status: 'completed', raw_data: {} });
                }
                else if (!isChecked) {
                    completedTasks = completedTasks.filter(id => id !== compositeKey);
                    if (window._studentTaskCompletions) {
                        window._studentTaskCompletions = window._studentTaskCompletions.filter(c => !(String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId)));
                    }
                }
                renderCourses(); 
                
                const nowTimestamp = window.UtilsDate.getTaiwanIsoTimestamp();

                if (isChecked) {
                    const payload = { 
                        assignment_id: assignmentId, 
                        task_id: taskId, 
                        student_id: userId, 
                        class_id: classId,
                        deleted_at: null
                    };
                    if (fileIds && fileIds.length > 0) {
                        payload.raw_data = { drive_file_ids: fileIds };
                    }

                    const { data: updatedRows, error: updateErr } = await window.supabaseClient.from('task_completions')
                        .update(payload)
                        .match({ task_id: taskId, student_id: userId, class_id: classId })
                        .select();
                        
                    if (updateErr) throw updateErr;

                    if (!updatedRows || updatedRows.length === 0) {
                        const { error: insertErr } = await window.supabaseClient.from('task_completions')
                            .insert([payload]);
                        if (insertErr) throw insertErr;
                    }

                } else {
                    const { error } = await window.supabaseClient.from('task_completions')
                        .update({ deleted_at: nowTimestamp })
                        .match({ task_id: taskId, student_id: userId, class_id: classId })
                        .is('deleted_at', null);
                        
                    if (error) throw error;
                }
            } catch (err) {
                console.error("同步進度失敗：", err);
                const compositeKey = `${assignmentId}_${taskId}`;
                if (isChecked) completedTasks = completedTasks.filter(id => id !== compositeKey);
                else completedTasks.push(compositeKey);
                renderCourses(); 
                alert(`❌ 進度同步失敗：\n${err.message || err.details}`);
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
                        
                        if (statusEl) {
                            statusEl.textContent = '🧠 喚醒 AI 大腦批改中...';
                            statusEl.style.color = '#8B5CF6';
                        }

                        const audioUrl = `https://drive.google.com/file/d/${result.fileId}/view`;
                        const { error: rpcErr } = await window.supabaseClient.rpc('submit_audio_task_atomic', {
                            p_assignment_id: assignmentId,
                            p_task_id: taskId,
                            p_student_id: userId,
                            p_class_id: classId,
                            p_file_id: result.fileId,
                            p_audio_url: audioUrl
                        });

                        if (rpcErr) throw rpcErr;
                        
                        if (statusEl) {
                            statusEl.textContent = '✅ 繳交成功！AI 已接管';
                            statusEl.style.color = '#10B981';
                        }
                        
                        const compositeKey = `${assignmentId}_${taskId}`;
                        if (!completedTasks.includes(compositeKey)) {
                            completedTasks.push(compositeKey);
                        }
                        
                        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
                        let tempRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId));
                        if (tempRecord) {
                            tempRecord.status = 'ai_processing';
                        } else {
                            window._studentTaskCompletions.push({
                                assignment_id: assignmentId,
                                task_id: taskId,
                                status: 'ai_processing',
                                raw_data: {}
                            });
                        }
                        
                        renderCourses();

                    } catch (err) {
                        alert(`❌ 錄音上傳失敗: ${err.message}`);
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
                alert('系統正在載入錄音模組，請稍候重試。');
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
                if (statusEl) {
                    statusEl.textContent = '🚀 重新喚醒 AI 大腦批改中...';
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
                    statusEl.textContent = '✅ 已重新喚醒！AI 已接管';
                    statusEl.style.color = '#10B981';
                }

            } catch (err) {
                alert(`❌ 重新啟動 AI 失敗: ${err.message}`);
                if (statusEl) {
                    statusEl.textContent = '❌ 重新啟動失敗';
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
        }
    };
})();
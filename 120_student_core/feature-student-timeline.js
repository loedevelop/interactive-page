/**
 * 📂 檔案路徑：120_student_core/feature-student-timeline.js
 * 描述：學生端專屬的邏輯與進度渲染引擎。
 * 🌟 UX 視覺升級版：
 * 1. 移除垂直導線，改用純縮排呈現。
 * 2. 垂直間距縮減 50%，提升資訊閱讀密度。
 * 3. 實體作業與群組容器共用相同的「粗左邊框 (Left Border Accent)」階層視覺。
 */

window.FeatureStudentTimeline = (() => {
    let assignments = [];
    let completedTasks = []; 
    let studentDriveUrl = null; 
    let studentUsername = '學生';
    let currentClassConfig = null; 

    function toLocalISODate(dateObj) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function parseLocalDate(dateStr) {
        if (!dateStr) return new Date();
        const [y, m, d] = dateStr.split('-');
        return new Date(y, m - 1, d);
    }

    function getWeekStartStr(dateStr, weekStartDay = 'sunday') {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-');
        const dt = new Date(y, m - 1, d);
        let day = dt.getDay(); 

        if (weekStartDay === 'monday') {
            let diff = day === 0 ? 6 : day - 1;
            dt.setDate(dt.getDate() - diff);
        } else {
            dt.setDate(dt.getDate() - day);
        }
        
        return toLocalISODate(dt);
    }

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

    async function fetchData() {
        const container = document.getElementById('course-container');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center; padding: 40px; color:#94A3B8; font-weight:800;">⏳ 正在從雲端載入作業...</div>';

        try {
            const { userId, classId } = await getAuthContext();

            const { data: profileData } = await window.supabaseClient
                .from('profiles')
                .select('name, raw_data')
                .eq('id', userId)
                .single();
                
            studentUsername = profileData?.name || '學生';
            const rawData = profileData?.raw_data || {};
            studentDriveUrl = rawData.drive_url || rawData.driveLink || null;

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
                .select('assignment_id, task_id')
                .eq('student_id', userId)
                .eq('class_id', classId);

            if (compErr) throw compErr;
            completedTasks = (compData || []).map(row => `${row.assignment_id}_${row.task_id}`);

            renderCourses();
        } catch (err) {
            console.error("載入學生資料失敗：", err);
            container.innerHTML = `<div style="text-align:center; padding: 40px; color:#EF4444; font-weight:800;">❌ 載入失敗：${err.message}</div>`;
        }
    }

    // 🌟 系統化階層色碼
    function getLevelStyle(depth) {
        const styles = [
            { border: '#94A3B8', bg: '#F8FAFC', text: '#475569' }, // L1: Gray Default
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, // L2: Blue
            { border: '#8B5CF6', bg: '#F5F3FF', text: '#5B21B6' }, // L3: Purple
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, // L4: Emerald
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }  // L5+: Orange
        ];
        return styles[Math.min(depth, 4)];
    }

    function renderCourses() {
        const container = document.getElementById('course-container');
        if (!container) return;
        
        let cls = currentClassConfig || {};
        let raw = cls.raw_data || {};
        
        let mode = cls.calc_mode || cls.calcMode || raw.calc_mode || raw.calcMode || 'single';
        let meetDays = (cls.meet_days || cls.meetDays || raw.meet_days || raw.meetDays || []).map(Number);
        let weekStartSetting = raw.week_start_day || 'sunday';
        
        let sessions = [];
        
        if (Array.isArray(cls.sessions) && cls.sessions.length > 0) {
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
                let s = parseLocalDate(startDateStr);
                let e = parseLocalDate(endDateStr);
                while (s <= e) {
                    if (meetDays.includes(s.getDay())) sessions.push(toLocalISODate(s));
                    s.setDate(s.getDate() + 1);
                }
            }
            if (sessions.length === 0) {
                sessions = [...new Set(assignments.map(a => a.target_date))].filter(Boolean).sort();
            }
        }

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
        if (mode === 'single') {
            timelineNodes = sessions.map(d => ({ title: d, dates: [d] }));
        } else if (mode === 'weekly') {
            const weeksMap = new Map();
            sessions.forEach(d => {
                const weekStr = getWeekStartStr(d, weekStartSetting);
                if (!weeksMap.has(weekStr)) {
                    weeksMap.set(weekStr, []);
                }
                weeksMap.get(weekStr).push(d);
            });
            
            weeksMap.forEach((chunk) => {
                timelineNodes.push({ 
                    title: chunk.length > 1 ? `${chunk[0]} ~ ${chunk[chunk.length-1]}` : chunk[0], 
                    dates: chunk 
                });
            });
        }

        const todayStr = toLocalISODate(new Date());
        const currentWeekStart = getWeekStartStr(todayStr, weekStartSetting);

        const styleBlock = document.createElement('style');
        styleBlock.innerHTML = `
            .timeline-node, .timeline-node * { box-sizing: border-box !important; max-width: 100%; word-break: break-word; }
            .timeline-node::before { display: none !important; }
            .rt-normalize, .rt-normalize * { font-size: inherit !important; font-family: inherit !important; }
            @keyframes pulse-green { 0% {box-shadow: 0 0 0 0 rgba(16,185,129,0.4);} 70% {box-shadow: 0 0 0 8px rgba(16,185,129,0);} 100% {box-shadow: 0 0 0 0 rgba(16,185,129,0);} }
        `;

        // 🌟 獨立實體任務渲染器 (與群組外觀徹底對齊)
        const renderTaskItem = (task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth) => {
            const lvl = getLevelStyle(depth);
            const canUpload = !(isLateUpload && !allowLateFlag);
            const compositeKey = `${course.id}_${task.id}`;
            const isTaskDone = completedTasks.includes(compositeKey);
            const checked = isTaskDone ? 'checked' : '';

            let iconStr = task.type === 'check' ? '📌' : (task.type === 'link' ? '🔗' : '📁');
            let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.15rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
            let checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px; cursor: pointer;" onchange="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', this.checked)" ${checked}>`;

            let btn = '';
            let taskTitleDisplay = '';
            let linkContent = '';

            if (task.type === 'link') {
                let actualUrlText = (task.url_text || '').trim();
                let actualTitle = (task.title || '').trim();

                if (actualUrlText !== '') {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${actualTitle || '未命名任務'}</span>`;
                    linkContent = task.url ? `<a href="${task.url}" target="_blank" class="btn-action" style="margin-left:10px; font-size:0.85rem; background:#EEF2FF; color:#4F46E5; text-decoration:none; padding:4px 8px; border-radius:6px; font-weight:800;" onclick="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', true)">${actualUrlText}</a>` : '';
                } else {
                    let fallbackText = actualTitle || '未命名連結';
                    if (task.url) {
                        taskTitleDisplay = `<a href="${task.url}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;" onclick="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', true)">${fallbackText}</a>`;
                    } else {
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${fallbackText} (無網址)</span>`;
                    }
                }
            } else if (task.type === 'drive') {
                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${task.title || '未命名任務'}</span>`;

                if (!canUpload) {
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                    btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block; margin-left:10px;">⛔ 已逾期，停止收件</div>`;
                } else if (!studentDriveUrl) {
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                    btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block; margin-left:10px;">⚠️ 您的專屬資料夾尚未設定</div>`;
                } else {
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功或前往雲端硬碟後將自動打勾">`;
                    const uniqueId = `file-input-${course.id}-${task.id}`;
                    const statusId = `upload-status-${course.id}-${task.id}`;
                    const safeTitleForJS = (task.title || '未命名任務').replace(/'/g, "\\'").replace(/"/g, "&quot;");
                    const safeNodeTitle = node.title.replace(/[\\/:*?"<>|]/g, '_');

                    btn = `
                        <div style="display:inline-flex; align-items:center; gap:8px; margin-left:10px; flex-wrap:wrap;">
                            <input type="file" id="${uniqueId}" multiple style="display:none;" onchange="window.FeatureStudentTimeline.handleFileSelect(this, '${course.id}', '${task.id}', '${safeTitleForJS}', '${statusId}', '${safeNodeTitle}', ${isLateUpload})">
                            <button onclick="document.getElementById('${uniqueId}').click()" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📤 上傳檔案</button>
                            <button onclick="window.FeatureStudentTimeline.openDriveAndCheck('${course.id}', '${task.id}')" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📁 檢視 Drive</button>
                            <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                        </div>
                    `;
                }
            } else {
                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${task.title || '未命名任務'}</span>`;
            }

            let cleanTaskDesc = task.description ? task.description.replace(/<[^>]*>?/gm, '').trim() : '';
            let taskDescHtml = cleanTaskDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px;">${task.description}</div>` : '';
            
            let showTaskDue = task.due_date && task.due_date !== effectiveBlockDueDate;
            let localDueHtml = showTaskDue ? `<span style="font-size:0.8rem; color:#EF4444; margin-left:8px; border:1px solid #FECACA; padding:2px 6px; border-radius:4px;">⏰ 期限: ${task.due_date}</span>` : '';

            // 🌟 縮減 50% 垂直間距，外殼樣式與群組完全一致 (粗左邊框)
            const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:8px;';

            return `
                <div style="${marginStyle} padding:10px; background:white; border:1px solid #E2E8F0; border-left:4px solid ${lvl.border}; border-radius:6px;">
                    <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; line-height: 1.2;">
                        ${checkboxHtml}${iconHtml}${taskTitleDisplay}${linkContent}${btn}${localDueHtml}
                    </div>
                    ${taskDescHtml}
                </div>
            `;
        };

        let html = '';
        const reversedNodes = timelineNodes.map((node, index) => ({ node, weekIndex: index + 1 })).reverse();

        reversedNodes.forEach(({ node, weekIndex }) => {
            const nodeWeekStart = getWeekStartStr(node.dates[0], weekStartSetting);
            
            let badge = '';
            let borderColor = '#E2E8F0';
            let dotColor = '#E2E8F0';
            let bgColor = '#FFFFFF';
            let headerTextColor = '#475569';
            let isCurrentWeek = false;
            let isFutureWeek = false;
            
            if (nodeWeekStart === currentWeekStart) {
                badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
                borderColor = '#10B981';
                dotColor = '#10B981';
                bgColor = '#ECFDF5'; 
                headerTextColor = '#065F46';
                isCurrentWeek = true;
            } else if (nodeWeekStart > currentWeekStart) {
                isFutureWeek = true;
            } else {
                dotColor = '#CBD5E1';
                bgColor = '#F8FAFC'; 
                headerTextColor = '#94A3B8';
            }

            const coursesInDate = assignments.filter(a => node.dates.includes(a.target_date));
            if (isFutureWeek && coursesInDate.length === 0) return; 

            let totalTasksInDate = 0;
            let doneTasksInDate = 0;
            let coursesHtml = '';

            if (coursesInDate.length > 0) {
                coursesHtml = coursesInDate.map(course => {
                    let effectiveBlockDueDate = course.due_date;
                    if (!effectiveBlockDueDate && course.tasks && course.tasks.length > 0) {
                        const explicitDates = course.tasks.map(t => t.due_date).filter(d => d);
                        if (explicitDates.length === course.tasks.length && explicitDates.every(d => d === explicitDates[0])) {
                            effectiveBlockDueDate = explicitDates[0];
                        }
                    }
                    
                    let aRaw = course.raw_data || {};
                    if (typeof aRaw === 'string') {
                        try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
                    }
                    
                    let isLateUpload = false;
                    let allowLateFlag = aRaw.allow_late !== false;
                    
                    if (effectiveBlockDueDate) {
                        const t_today = new Date();
                        t_today.setHours(0,0,0,0);
                        const t_due = parseLocalDate(effectiveBlockDueDate);
                        t_due.setHours(0,0,0,0);
                        if (t_today > t_due) {
                            isLateUpload = true;
                        }
                    }

                    const countTasksRecursive = (tasksList) => {
                        if (!tasksList) return;
                        tasksList.forEach(t => {
                            if (t.type === 'group') {
                                countTasksRecursive(t.subTasks);
                            } else {
                                totalTasksInDate += 1;
                                if (completedTasks.includes(`${course.id}_${t.id}`)) {
                                    doneTasksInDate += 1;
                                }
                            }
                        });
                    };
                    if (course.tasks) countTasksRecursive(course.tasks);

                    let cleanBlockDesc = course.description ? course.description.replace(/<[^>]*>?/gm, '').trim() : '';
                    let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.95rem; color:#64748B; margin-top:8px;">${course.description}</div>` : '';
                    
                    let lateBadgeText = (isLateUpload && allowLateFlag) ? ' (允許遲交)' : '';
                    let dueHtml = effectiveBlockDueDate ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 8px; border-radius:4px; margin-left:10px;">⏰ 期限: ${effectiveBlockDueDate}${lateBadgeText}</span>` : '';

                    // 🌟 DFS 深度優先搜尋渲染器 (移除左側直線，縮減間距)
                    const renderTaskTree = (tasksList, depth = 0) => {
                        if (!tasksList || tasksList.length === 0) return '';
                        
                        return tasksList.map(task => {
                            const lvl = getLevelStyle(depth);
                            
                            if (task.type === 'group') {
                                let groupTitle = task.title || '未命名作業群組';
                                let subTasksHtml = '';
                                
                                // 🌟 移除 border-left 直線，純縮排顯示
                                if (task.subTasks && task.subTasks.length > 0) {
                                    subTasksHtml = `<div style="padding-left: 20px; display:flex; flex-direction:column;">` +
                                        renderTaskTree(task.subTasks, depth + 1) +
                                        `</div>`;
                                } else {
                                    subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此作業群組尚無內容)</div>`;
                                }

                                // 🌟 縮減 50% 垂直間距，統一採用與實體任務相同的「粗左邊框」設計
                                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:8px;';

                                return `
                                    <div style="${marginStyle} padding: 12px; background: ${lvl.bg}; border: 1px solid #E2E8F0; border-left: 4px solid ${lvl.border}; border-radius: 6px;">
                                        <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; display:flex; align-items:center; gap:8px;">
                                            <span style="font-size:1.2rem;">🗂️</span> <span class="rt-normalize">${groupTitle}</span>
                                        </div>
                                        ${subTasksHtml}
                                    </div>
                                `;
                            } else {
                                return renderTaskItem(task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth);
                            }
                        }).join('');
                    };

                    let tasksHtml = '';
                    if (course.tasks && course.tasks.length > 0) {
                        tasksHtml = renderTaskTree(course.tasks, 0);
                    }

                    return `
                        <div style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                                <div style="flex: 1; min-width:200px; display:flex; justify-content:space-between; align-items:center;">
                                    <div style="font-weight: 900; color: #334155; font-size: 1rem; display:flex; align-items:center; flex-wrap:wrap;">
                                        📝 <span class="rt-normalize">${course.title}</span>
                                    </div>
                                    <div>${dueHtml}</div>
                                </div>
                            </div>
                            ${blockDescHtml}
                            ${tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : ''}
                        </div>
                    `;
                }).join('');
            } else {
                coursesHtml = ''; 
            }

            let progressBadgeHtml = '';
            if (totalTasksInDate > 0) {
                let isAllDone = (totalTasksInDate === doneTasksInDate);
                let badgeBg = isAllDone ? '#ECFDF5' : '#FFF7ED';
                let badgeColor = isAllDone ? '#059669' : '#EA580C';
                let badgeBorder = isAllDone ? '#D1FAE5' : '#FFEDD5';
                progressBadgeHtml = `
                    <div style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeBorder}; padding:4px 10px; border-radius:20px; font-size:0.85rem; font-weight:800;">
                        完成進度 ${doneTasksInDate} / ${totalTasksInDate}
                    </div>
                `;
            }

            html += `
                <div id="timeline-node-${weekIndex}" class="timeline-node" data-is-current="${isCurrentWeek}" style="scroll-margin-top: 25px; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative;">
                    <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                        <div class="node-date" style="display:flex; align-items:center; position:relative;">
                            <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                            <span style="font-weight: 800; color: ${headerTextColor}; font-size:1.05rem;">📅 第 ${weekIndex} ${mode === 'weekly' ? '週' : '堂'} - ${node.title}</span> ${badge}
                        </div>
                        ${progressBadgeHtml}
                    </div>
                    ${coursesHtml}
                </div>
            `;
        });

        container.innerHTML = '';
        container.appendChild(styleBlock);
        
        const timelineWrapper = document.createElement('div');
        timelineWrapper.style.borderLeft = '3px solid #E2E8F0';
        timelineWrapper.style.marginLeft = '20px';
        timelineWrapper.style.paddingLeft = '50px'; 
        timelineWrapper.innerHTML = html;

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
            if(viewId === 'progress') {
                renderCourses();
                setTimeout(scrollToCurrentWeek, 100);
            }
        },
        updateProgress: async (assignmentId, taskId, isChecked) => {
            try {
                const { userId, classId } = await getAuthContext();
                const compositeKey = `${assignmentId}_${taskId}`;
                if (isChecked && !completedTasks.includes(compositeKey)) completedTasks.push(compositeKey);
                else if (!isChecked) completedTasks = completedTasks.filter(id => id !== compositeKey);
                renderCourses(); 
                
                if (isChecked) {
                    const { error } = await window.supabaseClient.from('task_completions').insert([{ assignment_id: assignmentId, task_id: taskId, student_id: userId, class_id: classId }]);
                    if (error && error.code !== '23505') throw error;
                } else {
                    const { error } = await window.supabaseClient.from('task_completions').delete().match({ task_id: taskId, student_id: userId, class_id: classId });
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
        handleFileSelect: async (inputElement, assignmentId, taskId, taskTitle, statusId, dateKey, isLate) => {
            const filesArray = Array.from(inputElement.files);
            if (filesArray.length === 0) return;
            const statusEl = document.getElementById(statusId);
            if (!statusEl) return;

            statusEl.textContent = '⏳ 檢查檔案...';
            statusEl.style.color = '#F59E0B';

            try {
                const { userId, classId } = await getAuthContext(); 
                if (!studentDriveUrl) throw new Error('老師尚未為您設定專屬資料夾！');

                let targetFolderId = studentDriveUrl;
                const match = targetFolderId.match(/folders\/([a-zA-Z0-9-_]+)/);
                if (match && match[1]) targetFolderId = match[1];

                const safeTitle = taskTitle ? taskTitle.replace(/[\\/:*?"<>|]/g, '') : '未命名作業';
                const classPrefix = (classId || '0000').substring(0, 4);
                const cleanDateKey = dateKey.replace(/[\\/:*?"<>|]/g, '_');
                const safeDateStr = (cleanDateKey && cleanDateKey !== '未分類日期') ? `${cleanDateKey}_` : '';
                
                const lateSuffixStr = isLate ? '_late' : '';
                
                const allImages = filesArray.every(file => file.type.startsWith('image/'));
                const allAudio = filesArray.every(file => file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|ogg|aac)$/i));

                const API_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec'; 

                if (filesArray.length > 1 && allAudio) {
                    statusEl.textContent = `⏳ 準備上傳 ${filesArray.length} 個音檔...`;
                    for (let i = 0; i < filesArray.length; i++) {
                        const file = filesArray[i];
                        if (file.size > 25 * 1024 * 1024) throw new Error(`第 ${i+1} 個檔案超過 25MB。`);
                        
                        const ext = file.name.substring(file.name.lastIndexOf('.'));
                        const finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${safeTitle}_${i+1}${lateSuffixStr}${ext}`;
                        const finalMimeType = file.type || 'audio/mpeg';
                        
                        statusEl.textContent = `🚀 上傳中 (${i+1}/${filesArray.length})...`;
                        const base64Data = (await readFileAsDataURL(file)).split(',')[1];
                        
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 60000);

                        const response = await fetch(API_URL, {
                            method: 'POST', redirect: 'follow', signal: controller.signal,
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({ fileData: base64Data, fileName: finalFileName, mimeType: finalMimeType, folderId: targetFolderId })
                        });
                        clearTimeout(timeoutId);

                        if (!response.ok) throw new Error(`第 ${i+1} 個檔案連線異常`);
                        const result = JSON.parse(await response.text());
                        
                        if (result.status !== 'success') {
                            throw new Error(result.message || `第 ${i+1} 個檔案上傳失敗`);
                        }
                    }
                    
                    statusEl.textContent = '✅ 上傳成功';
                    statusEl.style.color = '#10B981';
                    setTimeout(() => window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true), 500);
                    inputElement.value = ''; 
                    return; 
                }

                let base64Data = '', finalMimeType = '', finalFileName = '';

                if (filesArray.length > 1) {
                    if (!allImages) throw new Error("多檔案上傳目前僅支援「全圖片轉PDF」或「全音檔」。若為混合格式請分次上傳。");
                    statusEl.textContent = '⏳ 合併 PDF...';
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
                    finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${safeTitle}${lateSuffixStr}.pdf`;
                } else {
                    const file = filesArray[0];
                    if (file.size > 25 * 1024 * 1024) throw new Error("檔案超過 25MB。");
                    const ext = file.name.substring(file.name.lastIndexOf('.'));
                    finalFileName = `${safeDateStr}${classPrefix}_${studentUsername}_${safeTitle}${lateSuffixStr}${ext}`;
                    finalMimeType = file.type;
                    statusEl.textContent = '⏳ 轉換...';
                    base64Data = (await readFileAsDataURL(file)).split(',')[1];
                }
                
                statusEl.textContent = '🚀 上傳中...';
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000);

                const response = await fetch(API_URL, {
                    method: 'POST', redirect: 'follow', signal: controller.signal,
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ fileData: base64Data, fileName: finalFileName, mimeType: finalMimeType, folderId: targetFolderId })
                });
                clearTimeout(timeoutId); 

                if (!response.ok) throw new Error(`連線異常 (${response.status})`);
                const result = JSON.parse(await response.text());
                
                if (result.status === 'success') {
                    statusEl.textContent = '✅ 上傳成功';
                    statusEl.style.color = '#10B981';
                    setTimeout(() => window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true), 500);
                } else throw new Error(result.message || '雲端未知錯誤');

            } catch (err) {
                statusEl.textContent = (err.name === 'AbortError') ? '❌ 上傳逾時' : `❌ 失敗: ${err.message}`;
                statusEl.style.color = '#EF4444';
            } finally {
                inputElement.value = ''; 
            }
        },
        openDriveAndCheck: async (assignmentId, taskId) => {
            window.open(studentDriveUrl || "https://drive.google.com/", '_blank');
            window.FeatureStudentTimeline.updateProgress(assignmentId, taskId, true); 
        }
    };
})();
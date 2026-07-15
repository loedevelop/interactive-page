/**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js
 * 🌟 v9.6 專業極簡版：UI 視覺分群、文字極簡正名、實體作業無損類型切換下拉選單
 */

window.FeatureTimeline = (() => {
    const db = window.TeacherDB;
    
    if (db.assignments) {
        const originalLength = db.assignments.length;
        db.assignments = db.assignments.filter(a => a.target_date !== undefined && a.target_date !== null);
        if (db.assignments.length !== originalLength && typeof db.save === 'function') db.save(); 
    }

    let bState = null; 
    let dragTopTaskIndex = null;
    let dragSubTaskData = null; // { parentIdx, subIdx }
    let dragAssignId = null;

    function checkCanEditTimeline(classId) {
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return false;
        const userRole = cls.staff_role || (window.TeacherUI && window.TeacherUI.getCurrentUserRole ? window.TeacherUI.getCurrentUserRole(classId) : 'primary_teacher');
        return ['admin', 'primary_teacher', 'co_teacher', 'ta_senior'].includes(userRole);
    }

    const scrollToCurrentWeek = () => {
        if (bState) return; 
        
        const targetNode = document.querySelector('.timeline-node[data-is-current="true"]');
        const container = document.querySelector('.view-section.active');
        
        if (targetNode && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = targetNode.getBoundingClientRect();
            const scrollAmount = nodeRect.top - containerRect.top - 15;
            
            container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }
    };

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

    function syncState() {
        if (!bState) return;
        const nid = bState.containerId;
        const titleEl = document.getElementById(`builder-title-${nid}`);
        const descEl = document.getElementById(`builder-desc-${nid}`);
        const dueEl = document.getElementById(`builder-due-${nid}`);
        const pubEl = document.getElementById(`builder-pub-${nid}`);
        
        const lateModeEl = document.getElementById(`builder-late-mode-${nid}`);
        const graceEl = document.getElementById(`builder-grace-${nid}`);
        const penaltyEl = document.getElementById(`builder-penalty-${nid}`);
        
        if (titleEl) {
            let text = titleEl.textContent.trim();
            bState.title = (text === '') ? '' : titleEl.innerHTML;
        }
        if (dueEl) bState.due_date = dueEl.value;
        if (pubEl) bState.is_published = pubEl.checked;
        if (descEl) {
            let text = descEl.textContent.trim();
            bState.description = (text === '') ? '' : descEl.innerHTML;
        }

        if (lateModeEl) bState.late_mode = lateModeEl.value;
        if (graceEl) bState.late_grace = parseInt(graceEl.value) || 0;
        if (penaltyEl) bState.late_penalty = parseInt(penaltyEl.value) || 0;

        if (bState.late_mode === 'no_late') { bState.late_grace = 0; bState.late_penalty = 0; }
        if (bState.late_mode === 'infinite') { bState.late_grace = 0; }

        bState.tasks.forEach((t, idx) => {
            if (t.type === 'group') {
                const gTitle = document.getElementById(`group-title-${idx}`);
                const gDue = document.getElementById(`group-due-${idx}`);
                const gLateMode = document.getElementById(`group-late-mode-${idx}`);
                const gGrace = document.getElementById(`group-grace-${idx}`);
                const gPenalty = document.getElementById(`group-penalty-${idx}`);

                if (gTitle) {
                    let text = gTitle.textContent.trim();
                    t.title = (text === '') ? '' : gTitle.innerHTML;
                }
                if (gDue) t.due_date = gDue.value;
                if (gLateMode) {
                    t.late_mode = gLateMode.value;
                    t.grace_period_hours = gGrace ? (parseInt(gGrace.value) || 0) : 0;
                    t.penalty_percentage = gPenalty ? (parseInt(gPenalty.value) || 0) : 0;

                    if (t.late_mode === 'no_late') { t.grace_period_hours = 0; t.penalty_percentage = 0; }
                    if (t.late_mode === 'infinite') { t.grace_period_hours = 0; }
                }
                
                (t.subTasks || []).forEach((sub, sIdx) => {
                    const sTitle = document.getElementById(`sub-title-${idx}-${sIdx}`);
                    const sUrl = document.getElementById(`sub-url-${idx}-${sIdx}`);
                    const sUrlText = document.getElementById(`sub-url-text-${idx}-${sIdx}`);
                    const sDesc = document.getElementById(`sub-desc-${idx}-${sIdx}`);
                    const sDue = document.getElementById(`sub-due-${idx}-${sIdx}`);
                    
                    const sLateMode = document.getElementById(`sub-late-mode-${idx}-${sIdx}`);
                    const sGrace = document.getElementById(`sub-grace-${idx}-${sIdx}`);
                    const sPenalty = document.getElementById(`sub-penalty-${idx}-${sIdx}`);
                    
                    if (sTitle) {
                        let text = sTitle.textContent.trim();
                        sub.title = (text === '') ? '' : sTitle.innerHTML;
                    }
                    if (sUrl) sub.url = sUrl.value;
                    if (sUrlText) sub.url_text = sUrlText.value; 
                    if (sDue) sub.due_date = sDue.value;
                    if (sDesc) {
                        let text = sDesc.textContent.trim();
                        sub.description = (text === '') ? '' : sDesc.innerHTML;
                    }
                    
                    if (sLateMode) {
                        sub.late_mode = sLateMode.value;
                        sub.penalty_percentage = sPenalty ? (parseInt(sPenalty.value) || 0) : 0;
                        sub.grace_period_hours = sGrace ? (parseInt(sGrace.value) || 0) : 0;

                        if (sub.late_mode === 'no_late') { sub.grace_period_hours = 0; sub.penalty_percentage = 0; }
                        if (sub.late_mode === 'infinite') { sub.grace_period_hours = 0; }
                    }
                });
            } else {
                const tTitle = document.getElementById(`task-title-${idx}`);
                const tUrl = document.getElementById(`task-url-${idx}`);
                const tUrlText = document.getElementById(`task-url-text-${idx}`);
                const tDesc = document.getElementById(`task-desc-${idx}`);
                const tDue = document.getElementById(`task-due-${idx}`);
                
                const tLateMode = document.getElementById(`task-late-mode-${idx}`);
                const tGrace = document.getElementById(`task-grace-${idx}`);
                const tPenalty = document.getElementById(`task-penalty-${idx}`);
                
                if (tTitle) {
                    let text = tTitle.textContent.trim();
                    t.title = (text === '') ? '' : tTitle.innerHTML;
                }
                if (tUrl) t.url = tUrl.value;
                if (tUrlText) t.url_text = tUrlText.value; 
                if (tDue) t.due_date = tDue.value;
                if (tDesc) {
                    let text = tDesc.textContent.trim();
                    t.description = (text === '') ? '' : tDesc.innerHTML;
                }

                if (tLateMode) {
                    t.late_mode = tLateMode.value;
                    t.penalty_percentage = tPenalty ? (parseInt(tPenalty.value) || 0) : 0;
                    t.grace_period_hours = tGrace ? (parseInt(tGrace.value) || 0) : 0;

                    if (t.late_mode === 'no_late') { t.grace_period_hours = 0; t.penalty_percentage = 0; }
                    if (t.late_mode === 'infinite') { t.grace_period_hours = 0; }
                }
            }
        });
    }

    function generateReadOnlyTaskHtml(t, effectiveBlockDueDate, effectiveBlockLatePolicy, isSubTask = false) {
        let iconStr = t.type === 'check' ? '📌' : (t.type === 'link' ? '🔗' : (t.type === 'group' ? '🗂️' : '📁'));
        let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.1rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
        
        let extraTag = '';
        if (t.type === 'drive') extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(專屬資料夾)</span>';
        else if (t.type === 'group') extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(內部群組作業)</span>';
        else extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(自行打勾)</span>';

        let taskTitleDisplay = '';
        let linkContent = '';

        if (t.type === 'link') {
            let actualUrlText = (t.url_text || '').trim();
            let actualTitle = (t.title || '').trim();

            if (actualUrlText !== '') {
                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${actualTitle || '未命名任務'}</span>`;
                linkContent = t.url ? `<a href="${t.url}" target="_blank" class="rt-normalize" style="margin-left:10px; font-size:1rem; color:var(--primary); text-decoration:underline; font-weight:800;">${actualUrlText}</a>` : `<span class="rt-normalize" style="margin-left:10px; font-size:1rem; color:#94A3B8;">(未設定網址)</span>`;
            } else {
                let fallbackText = actualTitle || '未命名連結';
                if (t.url) {
                    taskTitleDisplay = `<a href="${t.url}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;">${fallbackText}</a>`;
                } else {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${fallbackText} (未設定網址)</span>`;
                }
            }
        } else {
            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${t.title || '未命名任務'}</span>`;
        }

        let cleanTaskDesc = t.description ? t.description.replace(/<[^>]*>?/gm, '').trim() : '';
        let taskDescHtml = cleanTaskDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:42px;">${t.description}</div>` : '';
        
        let showTaskDue = t.due_date && t.due_date !== effectiveBlockDueDate;
        let dueBadge = showTaskDue ? `<span style="font-size:0.9rem; color:#64748B; margin-left:8px; font-weight:bold;">⏰ 期限: ${t.due_date}</span>` : '';
        
        let taskLateMode = t.late_mode || 'infinite';
        let taskPenalty = t.penalty_percentage || 0;
        let taskGrace = t.grace_period_hours || 0;
        let showLateBadge = true;

        if (effectiveBlockLatePolicy) {
            if (taskLateMode === effectiveBlockLatePolicy.mode && 
                taskPenalty === effectiveBlockLatePolicy.penalty && 
                taskGrace === (effectiveBlockLatePolicy.grace || 0)) {
                showLateBadge = false;
            }
        }

        let taskLateBadge = '';
        if (showLateBadge) {
            if (taskLateMode === 'no_late') {
                taskLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
            } else if (taskLateMode === 'custom') {
                taskLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${taskGrace}h (-${taskPenalty}%)</span>`;
            } else {
                taskLateBadge = taskPenalty > 0 
                    ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${taskPenalty}%</span>`
                    : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 可遲交</span>`;
            }
        }

        const marginStyle = isSubTask ? 'margin-top:10px;' : 'margin-top:14px;';
        
        return `
            <div style="${marginStyle}">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; line-height: 1.2;">
                    <input type="checkbox" disabled style="transform: scale(1.3); margin-right: 8px; cursor: not-allowed;" title="學生端核取方塊">
                    ${iconHtml}${taskTitleDisplay}${linkContent}
                    ${extraTag} ${dueBadge} ${taskLateBadge}
                </div>
                ${taskDescHtml}
            </div>
        `;
    }

    function renderTimeline(classId, scrollMode = 'current', targetId = null) {
        const container = document.getElementById('timeline-container');
        if (!container) return;
        
        container.className = '';

        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;
        
        const canEditTimeline = checkCanEditTimeline(classId);

        let raw = cls.raw_data || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
        }

        const classAssignments = db.assignments || [];
        
        let sessions = [];
        if (raw.custom_sessions && Array.isArray(raw.custom_sessions) && raw.custom_sessions.length > 0) {
            sessions = [...raw.custom_sessions];
        } else {
            sessions = db.sessions[classId] || [];
            if (sessions.length === 0) {
                let meetDays = (cls.meetDays || cls.meet_days || raw.meet_days || []).map(Number);
                let startDateStr = cls.startDate || cls.start_date || raw.start_date;
                let endDateStr = cls.endDate || cls.end_date || raw.end_date;

                if (startDateStr && endDateStr && meetDays.length > 0) {
                    let s = parseLocalDate(startDateStr);
                    let e = parseLocalDate(endDateStr);
                    while (s <= e) {
                        if (meetDays.includes(s.getDay())) sessions.push(toLocalISODate(s));
                        s.setDate(s.getDate() + 1);
                    }
                }
            }
        }

        const assignmentDates = classAssignments.filter(a => a.class_id === classId).map(a => a.target_date);
        sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

        if (sessions.length === 0) {
            container.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px;">無排程資料。請至「⚙️ 課程基本資料」設定學期起訖日與上課日。</p>';
            return;
        }

        const weekStartSetting = raw.week_start_day || 'sunday';
        const now = new Date();
        const todayStr = toLocalISODate(now);
        const currentWeekStart = getWeekStartStr(todayStr, weekStartSetting);
        const mode = cls.calcMode || cls.calc_mode || 'single';

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

        const styleBlock = document.createElement('style');
        styleBlock.innerHTML = `
            .timeline-node, .timeline-node * { box-sizing: border-box !important; max-width: 100%; word-break: break-word; }
            .timeline-node { overflow: visible !important; }
            div.timeline-node::before, div.timeline-node::after { display: none !important; content: none !important; }
            .rte-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; padding: 6px 12px; background: #F1F5F9; border-radius: 8px; border: 1px solid #E2E8F0; }
            .rte-btn { background: white; font-weight: 900; border: 1px solid #CBD5E1; padding: 2px 8px; border-radius: 4px; cursor: pointer; color: #334155; }
            .rte-btn:hover { background: #E2E8F0; }
            .drag-over { border: 2px dashed #10B981 !important; opacity: 0.7; }
            [contenteditable]:empty:before { content: attr(data-placeholder); color: #94A3B8; pointer-events: none; display: block; }
            @keyframes pulse-green { 0% {box-shadow: 0 0 0 0 rgba(16,185,129,0.4);} 70% {box-shadow: 0 0 0 8px rgba(16,185,129,0);} 100% {box-shadow: 0 0 0 0 rgba(16,185,129,0);} }
            .rt-normalize, .rt-normalize * { font-size: inherit !important; font-family: inherit !important; }
        `;

        let html = '';

        timelineNodes.forEach((node, index) => {
            const nodeWeekStart = getWeekStartStr(node.dates[0], weekStartSetting);
            let badge = '';
            let borderColor = '#E2E8F0';
            let dotColor = '#E2E8F0';
            let bgColor = '#FFFFFF';
            let headerTextColor = '#475569';
            let isCurrent = false;
            let isFuture = node.dates[0] > todayStr;
            
            const nodeId = `timeline-node-${index}`;

            if (nodeWeekStart === currentWeekStart) {
                badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.9rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
                borderColor = '#10B981';
                dotColor = '#10B981';
                bgColor = '#ECFDF5'; 
                headerTextColor = '#065F46';
                isCurrent = true; 
            } else if (!isFuture && nodeWeekStart < currentWeekStart) {
                badge = '';
                borderColor = '#E2E8F0';
                dotColor = '#CBD5E1';
                bgColor = '#F8FAFC'; 
                headerTextColor = '#94A3B8';
            } else if (isFuture) {
                badge = '';
                borderColor = '#E2E8F0';
                dotColor = '#E2E8F0';
                bgColor = '#FFFFFF';
                headerTextColor = '#475569';
            }

            const nodeDate = node.dates[0];
            const nodeAssignments = classAssignments.filter(a => a.class_id === classId && node.dates.includes(a.target_date));
            
            let assignmentsHtml = '';
            if (nodeAssignments.length > 0) {
                nodeAssignments.forEach(a => {
                    let effectiveBlockDueDate = a.due_date;
                    if (!effectiveBlockDueDate && a.tasks && a.tasks.length > 0) {
                        const explicitDates = [];
                        a.tasks.forEach(t => {
                            if (t.type === 'group') {
                                (t.subTasks || []).forEach(sub => { if(sub.due_date) explicitDates.push(sub.due_date); });
                            } else {
                                if(t.due_date) explicitDates.push(t.due_date);
                            }
                        });
                        
                        if (explicitDates.length > 0 && explicitDates.every(d => d === explicitDates[0])) {
                            effectiveBlockDueDate = explicitDates[0];
                        }
                    }

                    let aRaw = a.raw_data || {};
                    if (typeof aRaw === 'string') {
                        try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
                    }
                    
                    let blockLateMode = 'infinite';
                    let blockPenalty = 0;
                    let blockGrace = 0;
                    
                    if (aRaw.late_policy) {
                        if (!aRaw.late_policy.allow_late) blockLateMode = 'no_late';
                        else if (aRaw.late_policy.grace_period_hours > 0) {
                            blockLateMode = 'custom';
                            blockGrace = aRaw.late_policy.grace_period_hours;
                        }
                        else blockLateMode = 'infinite';
                        blockPenalty = aRaw.late_policy.penalty_percentage || 0;
                    }
                    
                    const effectiveBlockLatePolicy = { mode: blockLateMode, penalty: blockPenalty, grace: blockGrace };

                    let tasksHtml = '';
                    if (a.tasks && a.tasks.length > 0) {
                        a.tasks.forEach(t => {
                            if (t.type === 'group') {
                                let groupDueDate = t.due_date || effectiveBlockDueDate;
                                let groupPolicy = {
                                    mode: t.late_mode || effectiveBlockLatePolicy.mode,
                                    penalty: t.penalty_percentage !== undefined ? t.penalty_percentage : effectiveBlockLatePolicy.penalty,
                                    grace: t.grace_period_hours !== undefined ? t.grace_period_hours : (effectiveBlockLatePolicy.grace || 0)
                                };

                                let showGroupLateBadge = true;
                                if (groupPolicy.mode === effectiveBlockLatePolicy.mode && 
                                    groupPolicy.penalty === effectiveBlockLatePolicy.penalty && 
                                    groupPolicy.grace === effectiveBlockLatePolicy.grace) {
                                    showGroupLateBadge = false;
                                }

                                let gLateBadge = '';
                                if (showGroupLateBadge) {
                                    if (groupPolicy.mode === 'no_late') gLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
                                    else if (groupPolicy.mode === 'custom') gLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${groupPolicy.grace}h (-${groupPolicy.penalty}%)</span>`;
                                    else gLateBadge = groupPolicy.penalty > 0 ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${groupPolicy.penalty}%</span>` : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 可遲交</span>`;
                                }
                                let gDueBadge = (t.due_date && t.due_date !== effectiveBlockDueDate) ? `<span style="font-size:0.9rem; color:#64748B; margin-left:8px; font-weight:bold;">⏰ 期限: ${t.due_date}</span>` : '';

                                tasksHtml += `
                                    <div style="margin-top:15px; padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
                                        <div style="font-weight:900; color:#3B82F6; font-size:1.05rem; margin-bottom: 10px; display:flex; align-items:center; gap:8px;">
                                            <span style="font-size:1.2rem;">🗂️</span> <span class="rt-normalize">${t.title || '未命名群組作業'}</span>
                                            ${gDueBadge} ${gLateBadge}
                                        </div>
                                `;
                                if (t.subTasks && t.subTasks.length > 0) {
                                    tasksHtml += `<div style="padding-left: 18px; border-left: 3px solid #CBD5E1; margin-left: 8px; display:flex; flex-direction:column; gap:10px;">`;
                                    t.subTasks.forEach(sub => {
                                        tasksHtml += generateReadOnlyTaskHtml(sub, groupDueDate, groupPolicy, true);
                                    });
                                    tasksHtml += `</div>`;
                                } else {
                                    tasksHtml += `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px;">(此群組作業尚無內容)</div>`;
                                }
                                tasksHtml += `</div>`;
                            } else {
                                tasksHtml += generateReadOnlyTaskHtml(t, effectiveBlockDueDate, effectiveBlockLatePolicy, false);
                            }
                        });
                    }

                    let cleanBlockDesc = a.description ? a.description.replace(/<[^>]*>?/gm, '').trim() : '';
                    let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:8px;">${a.description}</div>` : '';
                    
                    let pubBadge = a.is_published ? `<span style="background:#2ECC71; color:white; font-size:0.9rem; padding:2px 6px; border-radius:4px; margin-left:8px;">✅ 發佈</span>` 
                                                  : `<span style="background:#94A3B8; color:white; font-size:0.9rem; padding:2px 6px; border-radius:4px; margin-left:8px;">🙈 未發佈</span>`;

                    let lateBadgeText = '';
                    if (blockLateMode === 'no_late') lateBadgeText = ' (🚫 無遲交)';
                    else if (blockLateMode === 'custom') lateBadgeText = ` (⏳ 寬限 ${blockGrace}h (-${blockPenalty}%))`;
                    else {
                        lateBadgeText = blockPenalty > 0 ? ` (♾️ 遲交扣 ${blockPenalty}%)` : ' (♾️ 可遲交)';
                    }

                    let blockDueBadge = effectiveBlockDueDate ? `<span style="font-size:1rem; color:#475569; margin-left:10px; font-weight:bold;">⏰ 期限: ${effectiveBlockDueDate}${lateBadgeText}</span>` : '';

                    let tasksSectionHtml = tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : '';

                    const dragHandleHtml = canEditTimeline 
                        ? `<span style="cursor: grab; margin-right:8px; color:#94A3B8; display:inline-block; padding: 4px;" title="拖曳排序區塊" onmousedown="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'true')" onmouseup="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'false')" onmouseleave="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'false')">↕️</span>` 
                        : '';
                        
                    const actionButtonsHtml = canEditTimeline 
                        ? `<div style="display:flex; gap:8px; align-items:center;">
                               <button class="btn-icon" style="font-size:1rem; background:#F1F5F9; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.moveAssignment('${a.id}', '${classId}')" title="更換日期">📅 改期</button>
                               <button class="btn-icon" style="font-size:1rem; background:#F1F5F9; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.editAssignment('${a.id}')">✏️ 修改</button>
                               <button class="btn-icon btn-danger" style="font-size:1rem; border:none; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.deleteAssignment('${a.id}', '${classId}')" title="刪除">🗑️</button>
                           </div>` 
                        : '';

                    const dragEventsHtml = canEditTimeline 
                        ? `ondragstart="window.FeatureTimeline.dragAssignStart(event, '${a.id}')" ondragover="event.preventDefault(); this.classList.add('drag-over');" ondragleave="this.classList.remove('drag-over');" ondrop="this.classList.remove('drag-over'); window.FeatureTimeline.dropAssign(event, '${a.id}', '${classId}')" ondragend="this.setAttribute('draggable', 'false');"`
                        : '';

                    assignmentsHtml += `
                        <div id="assign-block-${a.id}" draggable="false" 
                             ${dragEventsHtml}
                             style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                                <div style="font-weight: 900; color: var(--primary-dark); font-size: 1rem; display:flex; align-items:center;">
                                    ${dragHandleHtml} <span style="margin-right:6px;">📝</span> <span class="rt-normalize">${a.title}</span> <span style="margin-left:8px;">${pubBadge}</span>
                                </div>
                                <div style="display:flex; align-items:center; gap:15px; margin-left:auto;">
                                    ${blockDueBadge}
                                    ${actionButtonsHtml}
                                </div>
                            </div>
                            ${blockDescHtml}
                            ${tasksSectionHtml}
                        </div>
                    `;
                });
            } else {
                assignmentsHtml = ''; 
            }

            const builderContainerId = `builder-container-${index}`;

            const addBlockBtn = canEditTimeline 
                ? `<button class="btn btn-primary" onclick="window.FeatureTimeline.openBuilder('${classId}', '${nodeDate}', '${builderContainerId}')">+ 新增區塊</button>` 
                : '';
                
            const nodeDragEvents = canEditTimeline 
                ? `ondragover="event.preventDefault();" ondrop="window.FeatureTimeline.dropAssignToNode(event, '${nodeDate}', '${classId}')"` 
                : '';

            html += `
                <div id="${nodeId}" class="timeline-node" data-is-current="${isCurrent}" style="overflow: visible !important; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative; scroll-margin-top: 25px;"
                     ${nodeDragEvents}>
                    <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                        <div class="node-date" style="display:flex; align-items:center; position:relative;">
                            <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                            <span style="font-weight: 800; color: ${headerTextColor}; font-size: 1rem;">📅 第 ${index + 1} ${mode === 'weekly' ? '週' : '堂'} - ${node.title}</span> ${badge}
                        </div>
                        ${addBlockBtn}
                    </div>
                    ${assignmentsHtml}
                    <div id="${builderContainerId}"></div>
                </div>`;
        });
        
        container.innerHTML = '';
        container.appendChild(styleBlock);
        
        const timelineWrapper = document.createElement('div');
        timelineWrapper.style.borderLeft = '3px solid #E2E8F0';
        timelineWrapper.style.marginLeft = '20px';
        timelineWrapper.style.paddingLeft = '50px'; 
        timelineWrapper.innerHTML = html;

        container.appendChild(timelineWrapper);

        if (scrollMode === 'current') {
            setTimeout(scrollToCurrentWeek, 250);
        } else if (scrollMode === 'target' && targetId) {
            setTimeout(() => {
                const targetEl = document.getElementById(targetId);
                const viewContainer = document.querySelector('.view-section.active');
                if (targetEl && viewContainer) {
                    const cRect = viewContainer.getBoundingClientRect();
                    const nRect = targetEl.getBoundingClientRect();
                    viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 300);
        }

        const viewProgress = document.getElementById('timeline-container').closest('.view-content') || document.getElementById('view-progress');
        if (viewProgress && !window._timelineObserverAttached) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                        const style = window.getComputedStyle(viewProgress);
                        if (style.display !== 'none' && viewProgress.classList.contains('active')) {
                            if (!bState) {
                                setTimeout(scrollToCurrentWeek, 100); 
                            }
                        }
                    }
                });
            });
            observer.observe(viewProgress, { attributes: true });
            window._timelineObserverAttached = true;
        }
    }

    function generateBuilderTaskHtml(t, parentIdx, subIdx = null) {
        let isSub = subIdx !== null;
        let idPrefix = isSub ? `sub` : `task`;
        let htmlIdxStr = isSub ? `${parentIdx}-${subIdx}` : `${parentIdx}`;
        let dragMethod = isSub ? `window.FeatureTimeline.dragSubTaskStart(event, ${parentIdx}, ${subIdx})` : `window.FeatureTimeline.dragTopTaskStart(event, ${parentIdx})`;
        let dropMethod = isSub ? `window.FeatureTimeline.dropSubTask(event, ${parentIdx}, ${subIdx})` : `window.FeatureTimeline.dropTopTask(event, ${parentIdx})`;
        let removeMethod = isSub ? `window.FeatureTimeline.removeSubTask(${parentIdx}, ${subIdx})` : `window.FeatureTimeline.removeTask(${parentIdx})`;
        
        // 🌟 無損類型切換：將靜態圖示替換為動態下拉選單
        let typeSelectorHtml = `
            <select class="form-control" style="width:auto; padding:2px 4px; font-size:1rem; border:1px solid #CBD5E1; border-radius:4px; background:#F8FAFC; cursor:pointer; color:#334155; font-weight:bold; outline:none;" onchange="window.FeatureTimeline.changeTaskType(${parentIdx}, ${subIdx !== null ? subIdx : 'null'}, this.value)">
                <option value="check" ${t.type === 'check' ? 'selected' : ''}>📌 一般</option>
                <option value="link" ${t.type === 'link' ? 'selected' : ''}>🔗 連結</option>
                <option value="drive" ${t.type === 'drive' ? 'selected' : ''}>📁 Drive</option>
            </select>
        `;
        
        let urlInputHtml = '';
        if (t.type === 'link') {
            let sameBtn = '';
            if (isSub) {
                if (subIdx > 0 && bState.tasks[parentIdx].subTasks[subIdx-1].type === 'link') {
                    sameBtn = `<button class="btn-icon" style="font-size:0.9rem; background:#E2E8F0; padding:6px; margin-left:5px;" onclick="window.FeatureTimeline.copyPrevUrlSub(${parentIdx}, ${subIdx})">👇 同上 URL</button>`;
                }
            } else {
                if (parentIdx > 0 && bState.tasks[parentIdx-1].type === 'link') {
                    sameBtn = `<button class="btn-icon" style="font-size:0.9rem; background:#E2E8F0; padding:6px; margin-left:5px;" onclick="window.FeatureTimeline.copyPrevUrlTop(${parentIdx})">👇 同上 URL</button>`;
                }
            }
            
            let resOptsHtml = getResourceDropdownHtmlForBuilder(htmlIdxStr, t.url, isSub, parentIdx, subIdx);

            urlInputHtml = `
                <div style="display:flex; gap:5px; margin-top:8px; width:100%; flex-wrap:wrap;">
                    <input type="text" id="${idPrefix}-url-text-${htmlIdxStr}" class="form-control" placeholder="🔗 顯示文字 (留空則標題變連結)" value="${t.url_text || ''}" style="flex:1; min-width:120px; padding:8px;">
                    <input type="url" id="${idPrefix}-url-${htmlIdxStr}" class="form-control" placeholder="🔗 https://..." value="${t.url || ''}" style="flex:2; min-width:180px; padding:8px;">
                    ${resOptsHtml}
                    ${sameBtn}
                </div>`;
        } else if (t.type === 'drive') {
            urlInputHtml = `
                <div style="margin-top:8px; font-size:0.9rem; color:#4A90E2; background:#E0F0FF; padding:8px 12px; border-radius:6px;">
                    💡 <b>智慧派發模式</b>：學生端將自動讀取專屬 Drive 資料夾，無須填寫網址。
                </div>`;
        }

        let tLateMode = t.late_mode || 'infinite';

        return `
            <div id="${idPrefix}-block-${htmlIdxStr}" draggable="false" 
                 ondragstart="${dragMethod}" 
                 ondragover="event.preventDefault(); this.classList.add('drag-over');" 
                 ondragleave="this.classList.remove('drag-over');"
                 ondrop="this.classList.remove('drag-over'); ${dropMethod}"
                 ondragend="this.setAttribute('draggable', 'false');"
                 style="background: white; padding: 12px; border-radius: 8px; border: 1px solid #E2E8F0; margin-bottom: 12px; transition: border 0.2s;">
                <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom: 8px;">
                    <span style="cursor: grab; font-size:1.2rem; color:#94A3B8; padding:4px 4px 0 0; display:inline-block;" title="拖曳排序"
                          onmousedown="document.getElementById('${idPrefix}-block-${htmlIdxStr}').setAttribute('draggable', 'true')"
                          onmouseup="document.getElementById('${idPrefix}-block-${htmlIdxStr}').setAttribute('draggable', 'false')"
                          onmouseleave="document.getElementById('${idPrefix}-block-${htmlIdxStr}').setAttribute('draggable', 'false')">↕️</span>
                    <div style="padding-top:4px;">${typeSelectorHtml}</div>
                    <div id="${idPrefix}-title-${htmlIdxStr}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題" style="flex:1; min-width:150px; font-size:1rem; padding:8px 12px; background:white; border:1px solid #CBD5E1; border-radius:6px; outline:none; min-height:38px;">${t.title || ''}</div>
                    
                    <div style="display:flex; align-items:center; gap:10px; padding-top:4px; flex-wrap:wrap;">
                        <div style="display:flex; align-items:center; gap:5px;">
                            <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">期限:</label>
                            <input type="date" id="${idPrefix}-due-${htmlIdxStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:130px;" value="${t.due_date || ''}" title="留空則繼承外層">
                        </div>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">遲交:</label>
                            <select id="${idPrefix}-late-mode-${htmlIdxStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:auto;" onchange="
                                const m = this.value;
                                document.getElementById('${idPrefix}-late-custom-${htmlIdxStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                document.getElementById('${idPrefix}-grace-wrapper-${htmlIdxStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                            ">
                                <option value="no_late" ${tLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                <option value="infinite" ${tLateMode === 'infinite' ? 'selected' : ''}>♾️ 允許遲交</option>
                                <option value="custom" ${tLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                            </select>
                        </div>
                        
                        <div id="${idPrefix}-late-custom-${htmlIdxStr}" style="display:${(tLateMode === 'infinite' || tLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:5px; background:#F8FAFC; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0;">
                            <div id="${idPrefix}-grace-wrapper-${htmlIdxStr}" style="display:${tLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                <label style="font-size:0.85rem; color:#64748B;">寬限(時):</label>
                                <input type="number" id="${idPrefix}-grace-${htmlIdxStr}" class="form-control" style="padding:4px; width:50px;" value="${t.grace_period_hours || 0}" min="0">
                            </div>
                            <div style="display:flex; align-items:center; gap:5px;">
                                <label style="font-size:0.85rem; color:#64748B;">扣分(%):</label>
                                <input type="number" id="${idPrefix}-penalty-${htmlIdxStr}" class="form-control" style="padding:4px; width:50px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                            </div>
                        </div>
                    </div>

                    <div style="padding-top:4px;">
                        <button class="btn-danger" style="padding:6px 10px; border-radius:6px; border:none; cursor:pointer;" onclick="${removeMethod}">❌</button>
                    </div>
                </div>
                ${urlInputHtml}
                <div style="margin-top:8px; border-top:1px dashed #E2E8F0; padding-top:8px;">
                    <div id="${idPrefix}-desc-${htmlIdxStr}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="width:100%; min-height: 40px; font-size:0.85rem; padding:8px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; outline:none;">${t.description || ''}</div>
                </div>
            </div>
        `;
    }

    function getResourceDropdownHtmlForBuilder(htmlIdxStr, currentUrl, isSub, parentIdx, subIdx) {
        if (!bState) return '';
        
        const availableResources = (db.resourceLibrary || []).filter(r => 
            r.scope === 'global' || 
            (r.scope === 'class' && r.target_class_id === bState.classId)
        );

        if (availableResources.length === 0) return '';
        
        let opts = availableResources.map(r => {
            const scopeIcon = r.scope === 'global' ? '🌍' : '🏷️';
            return `<option value="${r.url}" ${currentUrl === r.url ? 'selected' : ''}>${r.icon} ${r.name} (${scopeIcon})</option>`;
        }).join('');
        
        let changeAction = isSub 
            ? `window.FeatureTimeline.updateSubTaskUrl(${parentIdx}, ${subIdx}, this.value)` 
            : `window.FeatureTimeline.updateTopTaskUrl(${parentIdx}, this.value)`;

        return `<select class="form-control" style="width:auto; padding:6px; font-size:1rem; flex-shrink:0;" onchange="${changeAction}">
                    <option value="">📚 手動套用資源庫</option>${opts}
                </select>`;
    }

    function getHistoryDropdownHtml() {
        if (!bState) return '';
        const allAssigns = (db.assignments || []).filter(a => a.class_id === bState.classId);
        if (allAssigns.length === 0) return '';
        
        let opts = allAssigns.map(a => `<option value="${a.id}">${a.target_date} - ${a.title.replace(/<[^>]*>?/gm, '')}</option>`).join('');
        return `
            <div style="margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #E2E8F0;">
                <label style="font-size:0.9rem; font-weight:800; color:#64748B;">🔄 快速載入過去的區塊樣板：</label>
                <div style="display:flex; gap:10px; margin-top:5px; align-items:center;">
                    <select id="history-select-${bState.containerId}" class="form-control" style="flex:1;" onchange="window.FeatureTimeline.copyHistory(this.value)">
                        <option value="">-- 選擇歷史紀錄 --</option>
                        ${opts}
                    </select>
                    <button class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.deleteHistoryTemplate()" title="刪除選取的歷史紀錄">🗑️ 刪除紀錄</button>
                </div>
            </div>`;
    }

    function renderBuilderUI() {
        if (!bState) return;
        const container = document.getElementById(bState.containerId);
        if (!container) return;

        let classResOpts = '';
        const classResList = (db.resourceLibrary || []).filter(r => 
            r.scope === 'global' || 
            (r.scope === 'class' && r.target_class_id === bState.classId)
        );
        
        if (classResList.length > 0) {
            classResOpts = classResList.map(r => {
                const scopeIcon = r.scope === 'global' ? '🌍' : '🏷️';
                return `<option value="${r.id}">${r.icon} ${r.name} (${scopeIcon})</option>`;
            }).join('');
        }

        let tasksHtml = bState.tasks.map((t, idx) => {
            if (t.type === 'group') {
                let subTasksHtml = (t.subTasks || []).map((sub, sIdx) => {
                    return generateBuilderTaskHtml(sub, idx, sIdx);
                }).join('');

                let addSubResourceHtml = '';
                if (classResList.length > 0) {
                    addSubResourceHtml = `
                        <select class="form-control" style="width:auto; padding:4px 10px; font-size:0.9rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addSubResourceTaskAsLink(${idx}, this.value); this.value=''; }">
                            <option value="" disabled selected>+ 📚 班級與全域資源</option>
                            ${classResOpts}
                        </select>
                    `;
                } else {
                     addSubResourceHtml = `
                        <button class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:0.9rem; padding:4px 10px;" title="請先至全域資源庫新增並派發資源">+ 📚 尚無任何可用資源</button>
                     `;
                }

                let gLateMode = t.late_mode || 'infinite';

                return `
                    <div id="group-block-${idx}" draggable="false"
                         ondragstart="window.FeatureTimeline.dragTopTaskStart(event, ${idx})" 
                         ondragover="event.preventDefault(); this.classList.add('drag-over');" 
                         ondragleave="this.classList.remove('drag-over');"
                         ondrop="this.classList.remove('drag-over'); window.FeatureTimeline.dropTopTask(event, ${idx})"
                         ondragend="this.setAttribute('draggable', 'false');"
                         style="background: #EFF6FF; padding: 15px; border-radius: 8px; border: 2px solid #93C5FD; margin-bottom: 20px; transition: border 0.2s;">
                        
                        <div style="display:flex; gap:10px; align-items:center; margin-bottom: 10px; padding-bottom: 10px;">
                            <span style="cursor: grab; font-size:1.2rem; color:#60A5FA; padding:4px 4px 0 0; display:inline-block;" title="拖曳整個群組作業"
                                  onmousedown="document.getElementById('group-block-${idx}').setAttribute('draggable', 'true')"
                                  onmouseup="document.getElementById('group-block-${idx}').setAttribute('draggable', 'false')"
                                  onmouseleave="document.getElementById('group-block-${idx}').setAttribute('draggable', 'false')">↕️</span>
                            <span style="font-size:1.4rem;">🗂️</span>
                            <div id="group-title-${idx}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 群組作業標題 (例如：Vocab)" style="flex:1; font-size:1.1rem; font-weight:900; color:#1E3A8A; padding:8px 12px; background:white; border:1px solid #BFDBFE; border-radius:6px; outline:none;">${t.title || ''}</div>
                            <button class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeTask(${idx})" title="刪除整個群組作業">🗑️</button>
                        </div>

                        <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:center; background:white; padding:10px 12px; border-radius:6px; border: 1px solid #BFDBFE; margin-bottom:15px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:#1E3A8A;">群組專屬期限：</label>
                                <input type="date" id="group-due-${idx}" class="form-control" style="width:auto; padding:4px 8px; font-size:0.9rem;" value="${t.due_date || ''}">
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:#1E3A8A;">群組遲交規則：</label>
                                <select id="group-late-mode-${idx}" class="form-control" style="padding:4px 8px; font-size:0.9rem; width:auto;" onchange="
                                    const m = this.value;
                                    document.getElementById('group-late-custom-${idx}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                    document.getElementById('group-grace-wrapper-${idx}').style.display = (m === 'custom') ? 'flex' : 'none';
                                ">
                                    <option value="no_late" ${gLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                    <option value="infinite" ${gLateMode === 'infinite' ? 'selected' : ''}>♾️ 允許遲交</option>
                                    <option value="custom" ${gLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                </select>
                            </div>

                            <div id="group-late-custom-${idx}" style="display:${(gLateMode === 'infinite' || gLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#DBEAFE; padding:4px 10px; border-radius:6px;">
                                <div id="group-grace-wrapper-${idx}" style="display:${gLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:#1E3A8A;">寬限(小時):</label>
                                    <input type="number" id="group-grace-${idx}" class="form-control" style="padding:4px; width:60px;" value="${t.grace_period_hours || 0}" min="0">
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:#1E3A8A;">扣分(%):</label>
                                    <input type="number" id="group-penalty-${idx}" class="form-control" style="padding:4px; width:60px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                </div>
                            </div>
                        </div>
                        
                        <div style="padding-left: 20px; border-left: 3px solid #BFDBFE; margin-left: 10px;">
                            ${subTasksHtml}
                            
                            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top: 10px;">
                                <span style="font-size:0.85rem; color:#60A5FA; font-weight:bold; margin-right:5px;">群組作業類型：</span>
                                <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px;" onclick="window.FeatureTimeline.addSubTask(${idx}, 'check')">+ 📌 一般</button>
                                <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #64748B; color: white;" onclick="window.FeatureTimeline.addSubTask(${idx}, 'link')">+ 🔗 連結</button>
                                <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #10B981; color: white;" onclick="window.FeatureTimeline.addSubTask(${idx}, 'drive')">+ 📁 Drive</button>
                                <div style="width: 1px; height: 20px; background: #BFDBFE; margin: 0 5px;"></div>
                                ${addSubResourceHtml}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                return generateBuilderTaskHtml(t, idx, null);
            }
        }).join('');

        let tasksContainerHtml = tasksHtml ? `
            <div style="margin-bottom: 15px;">
                ${tasksHtml}
            </div>
        ` : '';

        const rteToolbarHtml = `
            <div class="rte-toolbar">
                <span style="font-size:1rem; font-weight:800; color:#64748B; margin-right:5px;">反白選取編輯：</span>
                <button class="rte-btn" onmousedown="event.preventDefault(); document.execCommand('bold', false, null);">B</button>
                <button class="rte-btn" style="font-style:italic;" onmousedown="event.preventDefault(); document.execCommand('italic', false, null);">I</button>
                <button class="rte-btn" style="text-decoration:underline;" onmousedown="event.preventDefault(); document.execCommand('underline', false, null);">U</button>
                
                <select class="rte-btn" onchange="document.execCommand('foreColor', false, this.value); this.selectedIndex=0;" style="padding: 2px 4px; border-radius: 4px; cursor: pointer; font-weight: 800;">
                    <option value="">🎨 顏色</option>
                    <option value="#EF4444" style="color:#EF4444; font-weight:bold;">🔴 紅色</option>
                    <option value="#F59E0B" style="color:#F59E0B; font-weight:bold;">🟠 橘色</option>
                    <option value="#10B981" style="color:#10B981; font-weight:bold;">🟢 綠色</option>
                    <option value="#3B82F6" style="color:#3B82F6; font-weight:bold;">🔵 藍色</option>
                    <option value="#8B5CF6" style="color:#8B5CF6; font-weight:bold;">🟣 紫色</option>
                    <option value="#1E293B" style="color:#1E293B; font-weight:bold;">⚫ 黑色</option>
                </select>
            </div>
        `;

        let historyHtml = (bState.editId) ? `<div style="color:var(--primary); font-weight:900; margin-bottom:15px; font-size:1rem;">「修改模式」</div>` : getHistoryDropdownHtml();

        let addResourceHtml = '';
        if (classResList.length > 0) {
            addResourceHtml = `
                <select class="form-control" style="width:auto; padding:6px 12px; font-size:1rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink(this.value); this.value=''; }">
                    <option value="" disabled selected>+ 📚 班級與全域資源</option>
                    ${classResOpts}
                </select>
            `;
        } else {
             addResourceHtml = `
                <button class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:1rem;" title="請先至全域資源庫新增並派發資源">+ 📚 尚無任何可用資源</button>
             `;
        }

        const bLateMode = bState.late_mode || 'infinite';

        container.innerHTML = `
            <div id="${bState.containerId}-editor" style="border: 2px dashed #10B981; padding: 20px; border-radius: 12px; margin-top: 20px; background: #FFFDF8; overflow:hidden;">
                ${historyHtml}
                ${rteToolbarHtml}
                
                <div style="background: white; border: 1px solid #CBD5E1; border-radius: 8px; padding: 15px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div id="builder-title-${bState.containerId}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題" style="font-weight:900; font-size:1rem; border-bottom:1px solid #E2E8F0; padding-bottom:8px; margin-bottom:10px; outline:none; min-height:30px; color: var(--primary-dark);">${bState.title || ''}</div>
                    
                    <div id="builder-desc-${bState.containerId}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="font-size:0.85rem; outline:none; min-height:50px; margin-bottom:15px; color: #475569;">${bState.description || ''}</div>
                    
                    <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center; background:#F8FAFC; padding:10px 12px; border-radius:6px; border: 1px solid #E2E8F0;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">區塊期限：</label>
                            <input type="date" id="builder-due-${bState.containerId}" class="form-control" style="width:auto; padding:4px 8px; font-size:1rem;" value="${bState.due_date || ''}">
                        </div>
                        
                        <div style="display:flex; align-items:center; gap:8px;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">區塊遲交規則：</label>
                            <select id="builder-late-mode-${bState.containerId}" class="form-control" style="padding:4px 8px; font-size:1rem; width:auto;" onchange="
                                const m = this.value;
                                document.getElementById('builder-late-custom-${bState.containerId}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                document.getElementById('builder-grace-wrapper-${bState.containerId}').style.display = (m === 'custom') ? 'flex' : 'none';
                            ">
                                <option value="no_late" ${bLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                <option value="infinite" ${bLateMode === 'infinite' ? 'selected' : ''}>♾️ 允許遲交</option>
                                <option value="custom" ${bLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                            </select>
                        </div>

                        <div id="builder-late-custom-${bState.containerId}" style="display:${(bLateMode === 'infinite' || bLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#F1F5F9; padding:4px 10px; border-radius:6px; border:1px solid #CBD5E1;">
                            <div id="builder-grace-wrapper-${bState.containerId}" style="display:${bLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                <label style="font-size:0.9rem; font-weight:bold; color:#475569;">寬限(小時):</label>
                                <input type="number" id="builder-grace-${bState.containerId}" class="form-control" style="padding:4px; width:70px;" value="${bState.late_grace || 0}" min="0">
                            </div>
                            <div style="display:flex; align-items:center; gap:5px;">
                                <label style="font-size:0.9rem; font-weight:bold; color:#475569;">扣分(%):</label>
                                <input type="number" id="builder-penalty-${bState.containerId}" class="form-control" style="padding:4px; width:70px;" value="${bState.late_penalty || 0}" min="0" max="100">
                            </div>
                        </div>
                        
                        <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#334155; margin-left: auto;">
                            <input type="checkbox" id="builder-pub-${bState.containerId}" style="transform:scale(1.2);" ${bState.is_published ? 'checked' : ''}>
                            📢 發佈
                        </label>
                    </div>
                </div>

                ${tasksContainerHtml}

                <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; background: #F1F5F9; padding: 12px; border-radius: 8px; border: 1px solid #CBD5E1;">
                    <span style="font-size:0.9rem; font-weight:bold; color:#475569; margin-right:5px;">新增：</span>
                    <button class="btn btn-action" style="font-size:1rem;" onclick="window.FeatureTimeline.addTopTask('check')">+ 📌 一般</button>
                    <button class="btn btn-action" style="font-size:1rem; background: #64748B; color: white;" onclick="window.FeatureTimeline.addTopTask('link')">+ 🔗 連結</button>
                    <button class="btn btn-action" style="font-size:1rem; background: #10B981; color: white;" onclick="window.FeatureTimeline.addTopTask('drive')">+ 📁 Drive</button>
                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    <button class="btn btn-action" style="font-size:1rem; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addTopTask('group')">+ 🗂️ 群組作業</button>
                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    ${addResourceHtml}
                </div>

                <div style="display:flex; gap:10px; margin-top:20px; border-top:1px solid #E2E8F0; padding-top:15px;">
                    <button id="btn-save-block-${bState.containerId}" class="btn btn-primary" style="font-size:1rem;" onclick="window.FeatureTimeline.saveBlock(this)">💾 ${bState.editId ? '儲存修改' : '完成並儲存區塊'}</button>
                    <button class="btn" style="background:#E2E8F0; color:#334155; font-size:1rem;" onclick="window.FeatureTimeline.cancelBuilder()">取消</button>
                </div>
            </div>
        `;
    }

    return {
        renderTimeline,
        scrollToCurrentWeek,
        openBuilder: (classId, date, containerId) => {
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法新增或修改作業。');
            
            bState = { 
                editId: null, 
                classId, 
                target_date: date, 
                containerId, 
                title: '', 
                description: '', 
                due_date: '', 
                is_published: false, 
                late_mode: 'infinite',
                late_grace: 0,
                late_penalty: 0,
                tasks: [] 
            };
            
            renderBuilderUI();
            setTimeout(() => { 
                const titleEl = document.getElementById(`builder-title-${containerId}`);
                if (titleEl) {
                    titleEl.focus(); 
                    const cRect = document.querySelector('.view-section.active').getBoundingClientRect();
                    const nRect = titleEl.getBoundingClientRect();
                    document.querySelector('.view-section.active').scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 50);
        },
        editAssignment: (assignId) => {
            const a = (db.assignments || []).find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(a.class_id)) return alert('權限不足：您的身分無法修改此作業。');
            
            const cls = db.classes.find(c => c.id === a.class_id) || {};
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
            }

            let sessions = [];
            if (raw.custom_sessions && Array.isArray(raw.custom_sessions) && raw.custom_sessions.length > 0) {
                sessions = [...raw.custom_sessions];
            } else {
                sessions = db.sessions[a.class_id] || [];
            }
            
            const assignmentDates = (db.assignments || []).filter(ast => ast.class_id === a.class_id).map(ast => ast.target_date);
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            const mode = cls.calcMode || 'single';
            const weekStartSetting = raw.week_start_day || 'sunday';

            let timelineNodes = [];
            if (mode === 'single') {
                timelineNodes = sessions.map(d => ({ dates: [d] }));
            } else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => timelineNodes.push({ dates: chunk }));
            }

            const nodeIndex = timelineNodes.findIndex(node => node.dates.includes(a.target_date));
            const cId = `builder-container-${nodeIndex >= 0 ? nodeIndex : 0}`; 

            bState = JSON.parse(JSON.stringify(a));
            bState.editId = a.id;
            bState.classId = a.class_id;
            bState.containerId = cId;
            
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') {
                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
            }
            
            if (aRaw.late_policy) {
                if (!aRaw.late_policy.allow_late) {
                    bState.late_mode = 'no_late';
                } else if (aRaw.late_policy.grace_period_hours > 0) {
                    bState.late_mode = 'custom';
                } else {
                    bState.late_mode = 'infinite';
                }
                bState.late_grace = aRaw.late_policy.grace_period_hours || 0;
                bState.late_penalty = aRaw.late_policy.penalty_percentage || 0;
            } else {
                bState.late_mode = 'infinite';
                bState.late_grace = 0;
                bState.late_penalty = 0;
            }
            
            renderTimeline(a.class_id, 'none');
            renderBuilderUI();
            
            setTimeout(() => {
                const editorEl = document.getElementById(`${cId}-editor`);
                const viewContainer = document.querySelector('.view-section.active');
                if (editorEl && viewContainer) {
                    const cRect = viewContainer.getBoundingClientRect();
                    const nRect = editorEl.getBoundingClientRect();
                    viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 300);
        },
        moveAssignment: (assignId, classId) => {
            const a = (db.assignments || []).find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法搬移此作業。');

            const overlay = document.createElement('div');
            overlay.id = 'move-assign-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            
            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';

            overlay.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📅 作業改期 / 搬移</h3>
                    <div style="margin-bottom:20px; font-size:1rem; color:#475569; line-height:1.5;">
                        準備將 <strong>「${cleanTitle}」</strong> 搬移至新日期：
                    </div>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom: 25px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
                        <label style="font-weight:800; color:#334155; white-space:nowrap;">選擇新日期：</label>
                        <input type="date" id="move-target-date" class="form-control" style="flex:1; padding: 8px; font-size: 1rem;" value="${a.target_date}">
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size:1rem;" onclick="document.getElementById('move-assign-modal').remove()">取消</button>
                        <button class="btn btn-primary" id="btn-confirm-move" style="padding: 8px 20px; font-size:1rem;" onclick="window.FeatureTimeline.submitMove('${a.id}', '${classId}', '${a.target_date}')">確認改期</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        },
        submitMove: async (assignId, classId, oldDate) => {
            const newDate = document.getElementById('move-target-date').value;
            if (!newDate) return alert('⚠️ 請選擇目標日期');
            if (newDate === oldDate) return document.getElementById('move-assign-modal').remove(); 
            
            const btn = document.getElementById('btn-confirm-move');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 處理中...';
            btn.disabled = true;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ target_date: newDate })
                    .eq('id', assignId)
                    .is('deleted_at', null)
                    .select();
                    
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                
                const idx = db.assignments.findIndex(a => a.id === assignId);
                if(idx > -1) db.assignments[idx].target_date = newDate;
                
                document.getElementById('move-assign-modal').remove();
                window.FeatureTimeline.renderTimeline(classId, 'target', `assign-block-${assignId}`);
            } catch (err) {
                alert('❌ 改期失敗: ' + err.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        },
        copyHistory: (historyId) => {
            if(!historyId) return;
            const a = (db.assignments || []).find(x => x.id === historyId);
            if (!a) return;
            syncState(); 
            bState.title = a.title; 
            bState.description = a.description;
            bState.due_date = a.due_date;
            bState.is_published = a.is_published;
            
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') {
                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
            }
            
            if (aRaw.late_policy) {
                if (!aRaw.late_policy.allow_late) {
                    bState.late_mode = 'no_late';
                } else if (aRaw.late_policy.grace_period_hours > 0) {
                    bState.late_mode = 'custom';
                } else {
                    bState.late_mode = 'infinite';
                }
                bState.late_grace = aRaw.late_policy.grace_period_hours || 0;
                bState.late_penalty = aRaw.late_policy.penalty_percentage || 0;
            } else {
                bState.late_mode = 'infinite';
                bState.late_grace = 0;
                bState.late_penalty = 0;
            }

            bState.tasks = JSON.parse(JSON.stringify(a.tasks)).map(t => { 
                t.id = `task_${Date.now()}_${Math.random()}`;
                delete t.resource_id;
                if (t.type === 'group' && t.subTasks) {
                    t.subTasks = t.subTasks.map(sub => {
                        sub.id = `task_${Date.now()}_${Math.random()}`;
                        delete sub.resource_id;
                        return sub;
                    });
                }
                return t; 
            });
            renderBuilderUI();
        },
        deleteHistoryTemplate: async () => {
            if (!bState) return;
            const selectEl = document.getElementById(`history-select-${bState.containerId}`);
            if (!selectEl) return;
            const historyId = selectEl.value;
            
            if (!historyId) return alert('⚠️ 請先選擇要刪除的歷史紀錄！');
            if (!confirm('確定要封存這個歷史作業模板嗎？')) return;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ deleted_at: new Date().toISOString() })
                    .eq('id', historyId)
                    .is('deleted_at', null)
                    .select(); 
                    
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了您的修改");

                db.assignments = db.assignments.filter(a => a.id !== historyId);
                alert('✅ 已成功封存！');
                renderBuilderUI();
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
            }
        },
        addResourceTaskAsLink: (resId) => {
            syncState(); 
            const res = (db.resourceLibrary || []).find(r => r.id === resId);
            if (res) {
                bState.tasks.push({
                    id: `task_${Date.now()}_${Math.random()}`,
                    type: 'link', 
                    title: res.name,
                    url: res.url,
                    url_text: '', 
                    description: '',
                    due_date: '',
                    late_mode: 'infinite',
                    grace_period_hours: 0,
                    penalty_percentage: 0,
                    resource_id: res.id
                });
            }
            renderBuilderUI();
        },
        addSubResourceTaskAsLink: (parentIdx, resId) => {
            syncState(); 
            const res = (db.resourceLibrary || []).find(r => r.id === resId);
            if (res) {
                if (!bState.tasks[parentIdx].subTasks) bState.tasks[parentIdx].subTasks = [];
                bState.tasks[parentIdx].subTasks.push({
                    id: `task_${Date.now()}_${Math.random()}`,
                    type: 'link', 
                    title: res.name,
                    url: res.url,
                    url_text: '', 
                    description: '',
                    due_date: '',
                    late_mode: 'infinite',
                    grace_period_hours: 0,
                    penalty_percentage: 0,
                    resource_id: res.id
                });
            }
            renderBuilderUI();
        },
        dragTopTaskStart: (e, idx) => { dragTopTaskIndex = idx; dragSubTaskData = null; e.dataTransfer.effectAllowed = 'move'; },
        dropTopTask: (e, targetIdx) => {
            e.preventDefault(); e.stopPropagation();
            if (dragTopTaskIndex === null || dragTopTaskIndex === targetIdx) return;
            syncState();
            const draggedItem = bState.tasks.splice(dragTopTaskIndex, 1)[0];
            bState.tasks.splice(targetIdx, 0, draggedItem);
            dragTopTaskIndex = null;
            renderBuilderUI();
        },
        dragSubTaskStart: (e, parentIdx, subIdx) => { dragSubTaskData = { parentIdx, subIdx }; dragTopTaskIndex = null; e.dataTransfer.effectAllowed = 'move'; },
        dropSubTask: (e, targetParentIdx, targetSubIdx) => {
            e.preventDefault(); e.stopPropagation();
            if (!dragSubTaskData || dragSubTaskData.parentIdx !== targetParentIdx || dragSubTaskData.subIdx === targetSubIdx) return;
            syncState();
            const parentGroup = bState.tasks[targetParentIdx];
            const draggedItem = parentGroup.subTasks.splice(dragSubTaskData.subIdx, 1)[0];
            parentGroup.subTasks.splice(targetSubIdx, 0, draggedItem);
            dragSubTaskData = null;
            renderBuilderUI();
        },
        dragAssignStart: (e, id) => { dragAssignId = id; e.dataTransfer.effectAllowed = 'move'; },
        dropAssign: async (e, targetId, classId) => {
            e.preventDefault(); e.stopPropagation(); 
            if (!dragAssignId || dragAssignId === targetId) return;

            const arr = db.assignments;
            const fromIdx = arr.findIndex(a => a.id === dragAssignId);
            const toIdx = arr.findIndex(a => a.id === targetId);

            if (fromIdx > -1 && toIdx > -1) {
                const targetDate = arr[toIdx].target_date;
                const [dragged] = arr.splice(fromIdx, 1);
                
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate; 
                arr.splice(toIdx, 0, dragged);
                
                renderTimeline(classId, 'none'); 

                if (oldDate !== targetDate) {
                    try {
                        const { data: updatedRows, error } = await window.supabaseClient
                            .from('assignments')
                            .update({ target_date: targetDate })
                            .eq('id', dragAssignId)
                            .is('deleted_at', null)
                            .select(); 
                        if (error) throw error;
                        if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    } catch (err) {
                        dragged.target_date = oldDate; 
                        renderTimeline(classId, 'none');
                        alert('❌ 排序更新失敗: ' + err.message);
                    }
                }
            }
            dragAssignId = null;
        },
        dropAssignToNode: async (e, targetDate, classId) => {
            e.preventDefault();
            if (!dragAssignId) return;
            const arr = db.assignments;
            const dragged = arr.find(a => a.id === dragAssignId);
            
            if (dragged && dragged.target_date !== targetDate) {
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate;
                renderTimeline(classId, 'none'); 

                try {
                    const { data: updatedRows, error } = await window.supabaseClient
                        .from('assignments')
                        .update({ target_date: targetDate })
                        .eq('id', dragAssignId)
                        .is('deleted_at', null)
                        .select(); 
                    if (error) throw error;
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                } catch (err) {
                    dragged.target_date = oldDate; 
                    renderTimeline(classId, 'none');
                    alert('❌ 拖曳更新失敗: ' + err.message);
                }
            }
            dragAssignId = null;
        },
        addTopTask: (type) => {
            syncState(); 
            if (type === 'group') {
                bState.tasks.push({ id: `group_${Date.now()}`, type: 'group', title: '', due_date: '', late_mode: 'infinite', grace_period_hours: 0, penalty_percentage: 0, subTasks: [] });
            } else {
                bState.tasks.push({ id: `task_${Date.now()}_${Math.random()}`, type, title: '', url: '', url_text: '', description: '', due_date: '', late_mode: 'infinite', grace_period_hours: 0, penalty_percentage: 0 });
            }
            renderBuilderUI();
        },
        addSubTask: (parentIdx, type) => {
            syncState();
            if (!bState.tasks[parentIdx].subTasks) bState.tasks[parentIdx].subTasks = [];
            bState.tasks[parentIdx].subTasks.push({ 
                id: `task_${Date.now()}_${Math.random()}`, 
                type, 
                title: '', 
                url: '', 
                url_text: '', 
                description: '', 
                due_date: '', 
                late_mode: 'infinite', 
                grace_period_hours: 0, 
                penalty_percentage: 0,
                ...(type === 'group' ? { subTasks: [] } : {})
            });
            renderBuilderUI();
        },
        changeTaskType: (parentIdx, subIdx, newType) => {
            syncState();
            let task = subIdx === null ? bState.tasks[parentIdx] : bState.tasks[parentIdx].subTasks[subIdx];
            
            task.type = newType;
            if (newType === 'link' && !task.url) {
                task.url = '';
                task.url_text = '';
            }
            renderBuilderUI();
        },
        removeTask: (idx) => { syncState(); bState.tasks.splice(idx, 1); renderBuilderUI(); },
        removeSubTask: (parentIdx, subIdx) => { syncState(); bState.tasks[parentIdx].subTasks.splice(subIdx, 1); renderBuilderUI(); },
        updateTopTaskUrl: (idx, val) => { syncState(); bState.tasks[idx].url = val; renderBuilderUI(); },
        updateSubTaskUrl: (parentIdx, subIdx, val) => { syncState(); bState.tasks[parentIdx].subTasks[subIdx].url = val; renderBuilderUI(); },
        copyPrevUrlTop: (idx) => {
            syncState();
            if(idx > 0 && bState.tasks[idx-1].url) bState.tasks[idx].url = bState.tasks[idx-1].url;
            renderBuilderUI();
        },
        copyPrevUrlSub: (parentIdx, subIdx) => {
            syncState();
            if(subIdx > 0 && bState.tasks[parentIdx].subTasks[subIdx-1].url) {
                bState.tasks[parentIdx].subTasks[subIdx].url = bState.tasks[parentIdx].subTasks[subIdx-1].url;
            }
            renderBuilderUI();
        },
        saveBlock: async (btnEl) => {
            syncState(); 
            const titleText = bState.title.replace(/<[^>]*>?/gm, '').trim();
            if (!titleText) return alert('⚠️ 請填寫大區塊標題！');
            
            if (!db.assignments) db.assignments = [];
            
            let mergedRawData = bState.raw_data || {};
            if (typeof mergedRawData === 'string') {
                try { mergedRawData = JSON.parse(mergedRawData); } catch(e) { mergedRawData = {}; }
            }
            
            let mode = bState.late_mode || 'infinite';
            let allowLate = (mode === 'infinite' || mode === 'custom');
            let grace = (mode === 'custom') ? (parseInt(bState.late_grace) || 0) : 0;
            let penalty = (mode !== 'no_late') ? (parseInt(bState.late_penalty) || 0) : 0;

            mergedRawData.late_policy = {
                allow_late: allowLate,
                grace_period_hours: grace,
                penalty_percentage: penalty
            };
            
            delete mergedRawData.allow_late; 
            delete mergedRawData.late_policy.is_inherited; 
            
            const payload = {
                class_id: bState.classId,
                target_date: bState.target_date, 
                title: bState.title,
                description: bState.description,
                due_date: bState.due_date || null, 
                is_published: bState.is_published,
                tasks: [...bState.tasks],
                raw_data: mergedRawData
            };

            const originalText = btnEl.innerHTML;
            btnEl.innerHTML = '⏳ 儲存至雲端...';
            btnEl.disabled = true;

            let savedId = bState.editId;

            try {
                if (bState.editId) {
                    const { data: updatedRows, error } = await window.supabaseClient
                        .from('assignments')
                        .update(payload)
                        .eq('id', bState.editId)
                        .is('deleted_at', null)
                        .select(); 
                    if (error) throw new Error(error.message);
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    
                    const idx = db.assignments.findIndex(a => a.id === bState.editId);
                    if(idx !== -1) db.assignments[idx] = { id: bState.editId, ...payload };
                } else {
                    const { data, error } = await window.supabaseClient.from('assignments').insert([payload]).select().single();
                    if (error) throw new Error(error.message);
                    if (!data) throw new Error("資料庫拒絕了請求");
                    db.assignments.push(data); 
                    savedId = data.id; 
                }

                bState = null;
                renderTimeline(payload.class_id, 'target', `assign-block-${savedId}`);
            } catch (err) {
                console.error(err);
                alert('❌ 作業儲存失敗: ' + err.message);
                btnEl.innerHTML = originalText;
                btnEl.disabled = false;
            }
        },
        cancelBuilder: () => {
            const cid = bState.classId;
            bState = null;
            renderTimeline(cid, 'none');
        },
        deleteAssignment: async (assignId, classId) => {
            if(!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法封存作業。');
            if(!confirm('確定要封存此作業區塊嗎？\n(注意：這將會隱藏作業，但學生的打勾紀錄仍會保存在系統中)')) return;
            
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳';
            btn.disabled = true;

            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ deleted_at: new Date().toISOString() })
                    .eq('id', assignId)
                    .is('deleted_at', null)
                    .select(); 
                
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了您的封存請求");

                db.assignments = db.assignments.filter(a => a.id !== assignId);
                renderTimeline(classId, 'none');
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    };
})();
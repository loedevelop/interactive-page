/**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js
 * 🌟 v11.9 全端工匠 UX 升級版：
 * 1. 徹底修復 DOM 結構：排序方向鍵強制置右，與刪除按鈕 (❌/🗑️) 緊密群組。
 * 2. 移除佔版面的 Drive 提示字串，改為按鈕旁的「?」ToolTip 懸浮泡泡。
 * 3. 群組區塊背景套用淺紫色 (Light Purple)，提升視覺層次感。
 * 4. 新增 [📢 推播] 按鈕與防呆確認對話框，準備介接 LINE Notify 微服務。
 */

window.FeatureTimeline = (() => {
    const db = window.TeacherDB;
    
    if (db.assignments) {
        const originalLength = db.assignments.length;
        db.assignments = db.assignments.filter(a => a.target_date !== undefined && a.target_date !== null);
        if (db.assignments.length !== originalLength && typeof db.save === 'function') db.save(); 
    }

    let bState = null; 
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

    function syncTasksState(tasks, parentPathArray = []) {
        tasks.forEach((t, idx) => {
            const pathArray = [...parentPathArray, idx];
            const pathStr = pathArray.join('-');
            
            const titleEl = document.getElementById(`node-title-${pathStr}`);
            if (titleEl) {
                let text = titleEl.textContent.trim();
                t.title = (text === '') ? '' : titleEl.innerHTML;
            }
            
            const dueEl = document.getElementById(`node-due-${pathStr}`);
            const lateModeEl = document.getElementById(`node-late-mode-${pathStr}`);
            const graceEl = document.getElementById(`node-grace-${pathStr}`);
            const penaltyEl = document.getElementById(`node-penalty-${pathStr}`);
            
            if (dueEl) t.due_date = dueEl.value;
            if (lateModeEl) t.late_mode = lateModeEl.value;
            if (graceEl) t.grace_period_hours = parseInt(graceEl.value) || 0;
            if (penaltyEl) t.penalty_percentage = parseInt(penaltyEl.value) || 0;
            
            if (t.late_mode === 'no_late') { t.grace_period_hours = 0; t.penalty_percentage = 0; }
            if (t.late_mode === 'infinite') { t.grace_period_hours = 0; }
            
            if (t.type === 'group') {
                if (t.subTasks) syncTasksState(t.subTasks, pathArray);
            } else {
                const urlEl = document.getElementById(`node-url-${pathStr}`);
                const urlTextEl = document.getElementById(`node-url-text-${pathStr}`);
                const descEl = document.getElementById(`node-desc-${pathStr}`);
                
                if (urlEl) t.url = urlEl.value;
                if (urlTextEl) t.url_text = urlTextEl.value;
                if (descEl) {
                    let text = descEl.textContent.trim();
                    t.description = (text === '') ? '' : descEl.innerHTML;
                }
            }
        });
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

        if (bState.tasks) syncTasksState(bState.tasks);
    }

    function getLevelStyle(depth) {
        const styles = [
            { border: '#D8B4FE', bg: '#F3E8FF', text: '#581C87' }, // L1: 淺紫色
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, // L2
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, // L3
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }, // L4
            { border: '#EF4444', bg: '#FEF2F2', text: '#7F1D1D' }  // L5+
        ];
        return styles[Math.min(depth, 4)];
    }

    function renderReadOnlyTaskItem(t, effectiveBlockDueDate, effectiveBlockLatePolicy, depth) {
        let iconStr = t.type === 'check' ? '📌' : (t.type === 'link' ? '🔗' : '📁');
        let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.1rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
        
        let extraTag = '';
        if (t.type === 'drive') extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(專屬資料夾)</span>';
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
            if (taskLateMode === 'no_late') taskLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
            else if (taskLateMode === 'custom') taskLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${taskGrace}h (-${taskPenalty}%)</span>`;
            else taskLateBadge = taskPenalty > 0 ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${taskPenalty}%</span>` : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 可遲交</span>`;
        }
        
        return `
            <div style="margin-top: 8px; margin-bottom: 8px; padding: 12px; background: white; border: 1px solid #E2E8F0; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); transition: 0.2s;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; line-height: 1.2;">
                    <input type="checkbox" disabled style="transform: scale(1.3); margin-right: 8px; cursor: not-allowed;" title="老師唯讀端核取方塊">
                    ${iconHtml}${taskTitleDisplay}${linkContent}
                    ${extraTag} ${dueBadge} ${taskLateBadge}
                </div>
                ${taskDescHtml}
            </div>
        `;
    }

    function renderReadOnlyTaskTree(tasks, effectiveBlockDueDate, effectiveBlockLatePolicy, depth = 0) {
        if (!tasks || tasks.length === 0) return '';
        let html = '';
        tasks.forEach((t) => {
            const lvl = getLevelStyle(depth);

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

                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                html += `
                    <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background: ${lvl.bg}; border: 1px solid ${lvl.border}; border-radius: 8px;">
                        <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; margin-bottom: ${t.subTasks && t.subTasks.length > 0 ? '5px' : '0'}; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:1.2rem;">🗂️</span> <span class="rt-normalize">${t.title || '未命名群組作業'}</span>
                            ${gDueBadge} ${gLateBadge}
                        </div>
                `;
                
                if (t.subTasks && t.subTasks.length > 0) {
                    html += `<div style="padding-left: 10px; display:flex; flex-direction:column;">`;
                    html += renderReadOnlyTaskTree(t.subTasks, groupDueDate, groupPolicy, depth + 1);
                    html += `</div>`;
                } else {
                    html += `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top: 5px;">(此群組作業尚無內容)</div>`;
                }
                html += `</div>`;
            } else {
                html += renderReadOnlyTaskItem(t, effectiveBlockDueDate, effectiveBlockLatePolicy, depth);
            }
        });
        return html;
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

                    let tasksHtml = renderReadOnlyTaskTree(a.tasks, effectiveBlockDueDate, effectiveBlockLatePolicy, 0);

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
                        
                    // 🌟 新增 [📢 推播] 按鈕
                    const actionButtonsHtml = canEditTimeline 
                        ? `<div style="display:flex; gap:8px; align-items:center;">
                               <button class="btn-icon" style="font-size:1rem; background:#ECFDF5; color:#065F46; padding:4px 10px; border-radius:6px; cursor:pointer; border:1px solid #A7F3D0; font-weight:bold;" onclick="window.FeatureTimeline.confirmLinePush('${a.id}', '${classId}')" title="推播至 LINE 群組">📢 推播</button>
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

    function getTaskParentArray(pathArray) {
        if (!pathArray || pathArray.length <= 1) return bState.tasks;
        let current = bState.tasks[pathArray[0]];
        for (let i = 1; i < pathArray.length - 1; i++) {
            current = current.subTasks[pathArray[i]];
        }
        return current.subTasks;
    }

    function getArrowButtonsHtml(pathStr, idx, arrLength, depth, hasPrevSiblingGroup) {
        const canUp = idx > 0;
        const canDown = idx < arrLength - 1;
        const canLeft = depth > 0;
        const canRight = idx > 0 && hasPrevSiblingGroup;

        return `
            <div style="display:flex; gap:4px;">
                <button class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canUp ? 'white' : '#F1F5F9'}; cursor:${canUp ? 'pointer' : 'not-allowed'}; opacity:${canUp ? '1' : '0.4'}; border-radius:4px;" onclick="${canUp ? `window.FeatureTimeline.moveNodeUp('${pathStr}')` : ''}" ${canUp ? '' : 'disabled'} title="上移">⬆️</button>
                <button class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canDown ? 'white' : '#F1F5F9'}; cursor:${canDown ? 'pointer' : 'not-allowed'}; opacity:${canDown ? '1' : '0.4'}; border-radius:4px;" onclick="${canDown ? `window.FeatureTimeline.moveNodeDown('${pathStr}')` : ''}" ${canDown ? '' : 'disabled'} title="下移">⬇️</button>
                <button class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canLeft ? 'white' : '#F1F5F9'}; cursor:${canLeft ? 'pointer' : 'not-allowed'}; opacity:${canLeft ? '1' : '0.4'}; border-radius:4px;" onclick="${canLeft ? `window.FeatureTimeline.moveNodeLeft('${pathStr}')` : ''}" ${canLeft ? '' : 'disabled'} title="向左 (移出目前群組)">⬅️</button>
                <button class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canRight ? 'white' : '#F1F5F9'}; cursor:${canRight ? 'pointer' : 'not-allowed'}; opacity:${canRight ? '1' : '0.4'}; border-radius:4px;" onclick="${canRight ? `window.FeatureTimeline.moveNodeRight('${pathStr}')` : ''}" ${canRight ? '' : 'disabled'} title="向右 (歸入上方群組)">➡️</button>
            </div>
        `;
    }

    function renderBuilderTree(tasks, parentPathArray = [], classResOpts = '') {
        let treeHtml = tasks.map((t, idx) => {
            const pathArray = [...parentPathArray, idx];
            const pathStr = pathArray.join('-');
            const depth = pathArray.length - 1;
            const lvl = getLevelStyle(depth);
            
            const hasPrevSiblingGroup = idx > 0 && tasks[idx - 1].type === 'group';
            const arrowHtml = getArrowButtonsHtml(pathStr, idx, tasks.length, depth, hasPrevSiblingGroup);

            if (t.type === 'group') {
                let subTasksHtml = '';
                if (t.subTasks && t.subTasks.length > 0) {
                    subTasksHtml = `<div style="padding-left: 10px; display:flex; flex-direction:column;">` +
                                   renderBuilderTree(t.subTasks, pathArray, classResOpts) +
                                   `</div>`;
                } else {
                    subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此群組作業尚無內容)</div>`;
                }

                let addResourceHtml = classResOpts ? `
                    <select class="form-control" style="width:auto; padding:4px 10px; font-size:0.9rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink('${pathStr}', this.value); this.value=''; }">
                        <option value="" disabled selected>+ 📚 班級與全域資源</option>
                        ${classResOpts}
                    </select>
                ` : `<button class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:0.9rem; padding:4px 10px;" title="請先至全域資源庫新增並派發資源">+ 📚 尚無任何可用資源</button>`;

                let gLateMode = t.late_mode || 'infinite';
                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                return `
                    <div id="group-block-${pathStr}"
                         style="${marginStyle} margin-bottom: 10px; background: #F3E8FF; padding: 12px; border-radius: 8px; border: 1px solid #D8B4FE; transition: border 0.2s;">
                        
                        <div style="display:flex; gap:10px; align-items:center; margin-bottom: 10px; padding-bottom: 10px;">
                            <span style="font-size:1.4rem;">🗂️</span>
                            <div id="node-title-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 群組作業標題" style="flex:1; font-size:1.1rem; font-weight:900; color:#581C87; padding:8px 12px; background:white; border:1px solid #D8B4FE; border-radius:6px; outline:none;">${t.title || ''}</div>
                            
                            <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                                ${arrowHtml}
                                <button class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeNode('${pathStr}')" title="刪除此群組">🗑️</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:center; background:white; padding:10px 12px; border-radius:6px; border: 1px solid #CBD5E1; margin-bottom:15px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};">群組期限：</label>
                                <input type="date" id="node-due-${pathStr}" class="form-control" style="width:auto; padding:4px 8px; font-size:0.9rem;" value="${t.due_date || ''}">
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};">遲交規則：</label>
                                <select id="node-late-mode-${pathStr}" class="form-control" style="padding:4px 8px; font-size:0.9rem; width:auto;" onchange="
                                    const m = this.value;
                                    document.getElementById('node-late-custom-${pathStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                    document.getElementById('node-grace-wrapper-${pathStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                                ">
                                    <option value="no_late" ${gLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                    <option value="infinite" ${gLateMode === 'infinite' ? 'selected' : ''}>♾️ 允許遲交</option>
                                    <option value="custom" ${gLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                </select>
                            </div>

                            <div id="node-late-custom-${pathStr}" style="display:${(gLateMode === 'infinite' || gLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#F8FAFC; padding:4px 10px; border-radius:6px; border: 1px solid #E2E8F0;">
                                <div id="node-grace-wrapper-${pathStr}" style="display:${gLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:${lvl.text};">寬限(小時):</label>
                                    <input type="number" id="node-grace-${pathStr}" class="form-control" style="padding:4px; width:60px;" value="${t.grace_period_hours || 0}" min="0">
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:${lvl.text};">扣分(%):</label>
                                    <input type="number" id="node-penalty-${pathStr}" class="form-control" style="padding:4px; width:60px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                </div>
                            </div>
                        </div>
                        
                        <div style="padding-left: 10px;">
                            ${subTasksHtml}
                            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top: 15px; margin-left: 10px;">
                                <span style="font-size:0.85rem; color:${lvl.text}; font-weight:bold; margin-right:5px; opacity:0.8;">子層作業新增：</span>
                                <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'check')">+ 📌 一般</button>
                                <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #64748B; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'link')">+ 🔗 連結</button>
                                
                                <div style="display:inline-flex; align-items:center; gap:4px;">
                                    <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #10B981; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'drive')">+ 📁 Drive</button>
                                    <span title="💡 智慧派發模式：學生端將自動讀取專屬 Drive 資料夾，無須填寫網址。" style="cursor:help; background:#E2E8F0; color:#475569; border-radius:50%; width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold;">?</span>
                                </div>

                                <div style="width: 1px; height: 20px; background: #CBD5E1; margin: 0 5px;"></div>
                                <button class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'group')">+ 🗂️ 群組作業</button>
                                <div style="width: 1px; height: 20px; background: #CBD5E1; margin: 0 5px;"></div>
                                ${addResourceHtml}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                let typeSelectorHtml = `
                    <select class="form-control" style="width:auto; padding:2px 4px; font-size:1rem; border:1px solid #CBD5E1; border-radius:4px; background:#F8FAFC; cursor:pointer; color:#334155; font-weight:bold; outline:none;" onchange="window.FeatureTimeline.changeNodeType('${pathStr}', this.value)">
                        <option value="check" ${t.type === 'check' ? 'selected' : ''}>📌 一般</option>
                        <option value="link" ${t.type === 'link' ? 'selected' : ''}>🔗 連結</option>
                        <option value="drive" ${t.type === 'drive' ? 'selected' : ''}>📁 Drive</option>
                    </select>
                `;

                let urlInputHtml = '';
                if (t.type === 'link') {
                    let sameBtn = '';
                    if (pathArray[pathArray.length-1] > 0) {
                        const parentArr = getTaskParentArray(pathArray);
                        if (parentArr[pathArray[pathArray.length-1]-1].type === 'link') {
                            sameBtn = `<button class="btn-icon" style="font-size:0.9rem; background:#E2E8F0; padding:6px; margin-left:5px;" onclick="window.FeatureTimeline.copyPrevNodeUrl('${pathStr}')">👇 同上 URL</button>`;
                        }
                    }

                    let resOptsHtml = '';
                    if (classResOpts) {
                        resOptsHtml = `<select class="form-control" style="width:auto; padding:6px; font-size:1rem; flex-shrink:0;" onchange="window.FeatureTimeline.updateNodeUrl('${pathStr}', this.value)">
                            <option value="">📚 手動套用資源庫</option>${classResOpts}
                        </select>`;
                    }

                    urlInputHtml = `
                        <div style="display:flex; gap:5px; margin-top:8px; width:100%; flex-wrap:wrap;">
                            <input type="text" id="node-url-text-${pathStr}" class="form-control" placeholder="🔗 顯示文字 (留空則標題變連結)" value="${t.url_text || ''}" style="flex:1; min-width:120px; padding:8px;">
                            <input type="url" id="node-url-${pathStr}" class="form-control" placeholder="🔗 https://..." value="${t.url || ''}" style="flex:2; min-width:180px; padding:8px;">
                            ${resOptsHtml}
                            ${sameBtn}
                        </div>`;
                } else if (t.type === 'drive') {
                    urlInputHtml = '';
                }

                let tLateMode = t.late_mode || 'infinite';

                return `
                    <div id="node-block-${pathStr}"
                         style="margin-top: 10px; margin-bottom: 10px; background: white; padding: 12px; border: 1px solid #CBD5E1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); transition: border 0.2s;">
                        <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom: 8px;">
                            <div style="padding-top:4px;">${typeSelectorHtml}</div>
                            <div id="node-title-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題" style="flex:1; min-width:150px; font-size:1rem; padding:8px 12px; background:white; border:1px solid #CBD5E1; border-radius:6px; outline:none; min-height:38px;">${t.title || ''}</div>
                            
                            <div style="display:flex; align-items:center; gap:10px; padding-top:4px; flex-wrap:wrap;">
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">期限:</label>
                                    <input type="date" id="node-due-${pathStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:130px;" value="${t.due_date || ''}" title="留空則繼承外層">
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">遲交:</label>
                                    <select id="node-late-mode-${pathStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:auto;" onchange="
                                        const m = this.value;
                                        document.getElementById('node-late-custom-${pathStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                        document.getElementById('node-grace-wrapper-${pathStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                                    ">
                                        <option value="no_late" ${tLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                        <option value="infinite" ${tLateMode === 'infinite' ? 'selected' : ''}>♾️ 允許遲交</option>
                                        <option value="custom" ${tLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                    </select>
                                </div>
                                
                                <div id="node-late-custom-${pathStr}" style="display:${(tLateMode === 'infinite' || tLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:5px; background:#F8FAFC; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0;">
                                    <div id="node-grace-wrapper-${pathStr}" style="display:${tLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                        <label style="font-size:0.85rem; color:#64748B;">寬限(時):</label>
                                        <input type="number" id="node-grace-${pathStr}" class="form-control" style="padding:4px; width:50px;" value="${t.grace_period_hours || 0}" min="0">
                                    </div>
                                    <div style="display:flex; align-items:center; gap:5px;">
                                        <label style="font-size:0.85rem; color:#64748B;">扣分(%):</label>
                                        <input type="number" id="node-penalty-${pathStr}" class="form-control" style="padding:4px; width:50px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                    </div>
                                </div>
                            </div>

                            <div style="display:flex; align-items:center; gap:8px; padding-top:4px; margin-left:auto;">
                                ${arrowHtml}
                                <button class="btn-danger" style="padding:6px 10px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeNode('${pathStr}')">❌</button>
                            </div>
                        </div>
                        ${urlInputHtml}
                        <div style="margin-top:8px; border-top:1px dashed #E2E8F0; padding-top:8px;">
                            <div id="node-desc-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="width:100%; min-height: 40px; font-size:0.85rem; padding:8px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; outline:none;">${t.description || ''}</div>
                        </div>
                    </div>
                `;
            }
        });
        return treeHtml.join('');
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

        let tasksHtml = bState.tasks && bState.tasks.length > 0 ? renderBuilderTree(bState.tasks, [], classResOpts) : '';

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

        let addResourceHtml = classResOpts ? `
            <select class="form-control" style="width:auto; padding:6px 12px; font-size:1rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink(null, this.value); this.value=''; }">
                <option value="" disabled selected>+ 📚 班級與全域資源</option>
                ${classResOpts}
            </select>
        ` : `<button class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:1rem;" title="請先至全域資源庫新增並派發資源">+ 📚 尚無任何可用資源</button>`;

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
                    <span style="font-size:0.9rem; font-weight:bold; color:#475569; margin-right:5px;">外層作業新增：</span>
                    <button class="btn btn-action" style="font-size:1rem;" onclick="window.FeatureTimeline.addNode(null, 'check')">+ 📌 一般</button>
                    <button class="btn btn-action" style="font-size:1rem; background: #64748B; color: white;" onclick="window.FeatureTimeline.addNode(null, 'link')">+ 🔗 連結</button>
                    
                    <div style="display:inline-flex; align-items:center; gap:4px;">
                        <button class="btn btn-action" style="font-size:1rem; background: #10B981; color: white;" onclick="window.FeatureTimeline.addNode(null, 'drive')">+ 📁 Drive</button>
                        <span title="💡 智慧派發模式：學生端將自動讀取專屬 Drive 資料夾，無須填寫網址。" style="cursor:help; background:#E2E8F0; color:#475569; border-radius:50%; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center; font-size:0.85rem; font-weight:bold;">?</span>
                    </div>

                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    <button class="btn btn-action" style="font-size:1rem; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addNode(null, 'group')">+ 🗂️ 群組作業</button>
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
        // 🌟 新增：推播防呆確認與委派執行
        confirmLinePush: (assignId, classId) => {
            const a = (db.assignments || []).find(x => x.id === assignId);
            if (!a) return;

            const cls = db.classes.find(c => c.id === classId);
            let raw = cls?.raw_data || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
            }
            if (!raw.line_notify_token) {
                return alert('⚠️ 此班級尚未綁定 LINE Notify Token！\n請先至「⚙️ 班級設定」中進行綁定。');
            }

            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            const overlayId = 'line-push-modal';
            let existing = document.getElementById(overlayId);
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';

            overlay.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <h3 style="margin-top: 0; color: #059669; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📢 推播至 LINE 群組</h3>
                    <div style="margin-bottom:20px; font-size:1rem; color:#475569; line-height:1.5;">
                        準備將 <strong>「${cleanTitle}」</strong> 的作業詳情，傳送至已綁定的 LINE 群組。
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight:bold; font-size:1rem;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                        <button class="btn btn-primary" id="btn-confirm-push" style="padding: 8px 20px; font-weight:bold; font-size:1rem; background:#10B981; border:none;" onclick="window.FeatureTimeline.executeLinePush('${assignId}', '${classId}')">🚀 確認發送</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        },
        executeLinePush: async (assignId, classId) => {
            const btn = document.getElementById('btn-confirm-push');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 發送中...';
            btn.disabled = true;

            try {
                if (!window.ServiceLineNotify || typeof window.ServiceLineNotify.pushAssignment !== 'function') {
                    throw new Error("系統提示：LINE 推播微服務尚未載入。");
                }
                
                await window.ServiceLineNotify.pushAssignment(classId, assignId);
                
                document.getElementById('line-push-modal').remove();
                alert('✅ 已成功發送至 LINE 群組！');
            } catch (err) {
                alert('❌ 推播失敗: ' + err.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
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

            const assignNewIdsRecursive = (tasksList) => {
                return tasksList.map(t => {
                    const cloned = { ...t, id: `task_${Date.now()}_${Math.random()}` };
                    delete cloned.resource_id;
                    if (cloned.type === 'group' && cloned.subTasks) {
                        cloned.subTasks = assignNewIdsRecursive(cloned.subTasks);
                    }
                    return cloned;
                });
            };

            bState.tasks = assignNewIdsRecursive(JSON.parse(JSON.stringify(a.tasks)));
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

        addNode: (pathStr, type) => {
            syncState();
            let targetArr;
            if (!pathStr) targetArr = bState.tasks;
            else {
                const arr = pathStr.split('-').map(Number);
                const parentArr = getTaskParentArray(arr);
                const targetNode = parentArr[arr[arr.length - 1]];
                if (!targetNode.subTasks) targetNode.subTasks = [];
                targetArr = targetNode.subTasks;
            }
            targetArr.push({
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
        removeNode: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const parentArr = getTaskParentArray(arr);
            parentArr.splice(arr[arr.length - 1], 1);
            renderBuilderUI();
        },
        
        moveNodeUp: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                [parentArr[idx - 1], parentArr[idx]] = [parentArr[idx], parentArr[idx - 1]];
            }
            renderBuilderUI();
        },
        moveNodeDown: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            const parentArr = getTaskParentArray(arr);
            if (idx < parentArr.length - 1) {
                [parentArr[idx], parentArr[idx + 1]] = [parentArr[idx + 1], parentArr[idx]];
            }
            renderBuilderUI();
        },
        moveNodeLeft: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            if (arr.length > 1) {
                const parentArr = getTaskParentArray(arr);
                const idx = arr[arr.length - 1];
                const nodeToMove = parentArr.splice(idx, 1)[0]; 

                const grandParentPath = arr.slice(0, -1);
                const grandParentArr = getTaskParentArray(grandParentPath);
                const parentGroupIdx = grandParentPath[grandParentPath.length - 1];

                grandParentArr.splice(parentGroupIdx + 1, 0, nodeToMove);
            }
            renderBuilderUI();
        },
        moveNodeRight: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                const prevSibling = parentArr[idx - 1];
                if (prevSibling.type === 'group') {
                    const nodeToMove = parentArr.splice(idx, 1)[0];
                    if (!prevSibling.subTasks) prevSibling.subTasks = [];
                    prevSibling.subTasks.push(nodeToMove);
                }
            }
            renderBuilderUI();
        },

        changeNodeType: (pathStr, newType) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const parentArr = getTaskParentArray(arr);
            let task = parentArr[arr[arr.length - 1]];
            task.type = newType;
            if (newType === 'link' && !task.url) {
                task.url = '';
                task.url_text = '';
            }
            renderBuilderUI();
        },
        updateNodeUrl: (pathStr, val) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const parentArr = getTaskParentArray(arr);
            parentArr[arr[arr.length - 1]].url = val;
            renderBuilderUI();
        },
        copyPrevNodeUrl: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                if (parentArr[idx - 1].url) {
                    parentArr[idx].url = parentArr[idx - 1].url;
                }
            }
            renderBuilderUI();
        },
        addResourceTaskAsLink: (pathStr, resId) => {
            syncState();
            const res = (db.resourceLibrary || []).find(r => r.id === resId);
            if (!res) return;
            
            let targetArr;
            if (!pathStr) targetArr = bState.tasks;
            else {
                const arr = pathStr.split('-').map(Number);
                const parentArr = getTaskParentArray(arr);
                const targetNode = parentArr[arr[arr.length - 1]];
                if (!targetNode.subTasks) targetNode.subTasks = [];
                targetArr = targetNode.subTasks;
            }
            
            targetArr.push({
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
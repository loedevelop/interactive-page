/**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js
 * 🌟 v13.2 極致解耦版 (DRY 原則落實)：
 * 1. 成功將所有 UI 渲染邏輯抽離至 TimelineTemplates。
 * 2. 成功將所有 日期運算 邏輯抽離，全面改用 window.UtilsDate。
 * 3. 完美保留 LINE Notify 推播功能與底層呼叫邏輯。
 */

console.log("🚀 FeatureTimeline v13.2 載入成功！(日期與 UI 雙解耦完成 + 保留推播功能)");

window.FeatureTimeline = (() => {
    const db = window.TeacherDB;
    const TPL = window.TimelineTemplates; // 引入 UI 模板工廠
    const DateUtils = window.UtilsDate;   // 引入全域日期工具箱
    
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

    function getTaskParentArray(pathArray) {
        if (!pathArray || pathArray.length <= 1) return bState.tasks;
        let current = bState.tasks[pathArray[0]];
        for (let i = 1; i < pathArray.length - 1; i++) {
            current = current.subTasks[pathArray[i]];
        }
        return current.subTasks;
    }

    function renderTimeline(classId, scrollMode = 'current', targetId = null) {
        const container = document.getElementById('timeline-container');
        if (!container || !TPL) return;
        
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
                    let s = DateUtils.parseLocalDate(startDateStr);
                    let e = DateUtils.parseLocalDate(endDateStr);
                    while (s <= e) {
                        if (meetDays.includes(s.getDay())) sessions.push(DateUtils.toLocalISODate(s));
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
        const todayStr = DateUtils.toLocalISODate(now);
        const currentWeekStart = DateUtils.getWeekStartStr(todayStr, weekStartSetting);
        const mode = cls.calcMode || cls.calc_mode || 'single';

        let timelineNodes = [];
        if (mode === 'single') {
            timelineNodes = sessions.map(d => ({ title: d, dates: [d] }));
        } else if (mode === 'weekly') {
            const weeksMap = new Map();
            sessions.forEach(d => {
                const weekStr = DateUtils.getWeekStartStr(d, weekStartSetting);
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

        let html = '';

        timelineNodes.forEach((node, index) => {
            const nodeWeekStart = DateUtils.getWeekStartStr(node.dates[0], weekStartSetting);
            let isCurrent = (nodeWeekStart === currentWeekStart);
            let isFuture = node.dates[0] > todayStr;
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
                    
                    let blockLateMode = 'infinite', blockPenalty = 0, blockGrace = 0;
                    if (aRaw.late_policy) {
                        if (!aRaw.late_policy.allow_late) blockLateMode = 'no_late';
                        else if (aRaw.late_policy.grace_period_hours > 0) {
                            blockLateMode = 'custom';
                            blockGrace = aRaw.late_policy.grace_period_hours;
                        }
                        blockPenalty = aRaw.late_policy.penalty_percentage || 0;
                    }
                    const effectiveBlockLatePolicy = { mode: blockLateMode, penalty: blockPenalty, grace: blockGrace };

                    let tasksHtml = TPL.renderReadOnlyTree(a.tasks, effectiveBlockDueDate, effectiveBlockLatePolicy, 0);
                    assignmentsHtml += TPL.getAssignmentBlockHtml(a, classId, canEditTimeline, effectiveBlockDueDate, blockLateMode, blockPenalty, blockGrace, tasksHtml);
                });
            }

            const builderContainerId = `builder-container-${index}`;
            html += TPL.getTimelineNodeHtml(index, mode, node.title, isCurrent, isFuture, nodeDate, classId, canEditTimeline, assignmentsHtml, builderContainerId);
        });
        
        container.innerHTML = TPL.getTimelineStyleBlock();
        
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
                            if (!bState) setTimeout(scrollToCurrentWeek, 100); 
                        }
                    }
                });
            });
            observer.observe(viewProgress, { attributes: true });
            window._timelineObserverAttached = true;
        }
    }

    function renderBuilderUI() {
        if (!bState || !TPL) return;
        const container = document.getElementById(bState.containerId);
        if (!container) return;

        let classResOpts = '';
        const classResList = (db.resourceLibrary || []).filter(r => r.scope === 'global' || (r.scope === 'class' && r.target_class_id === bState.classId));
        if (classResList.length > 0) {
            classResOpts = classResList.map(r => {
                const scopeIcon = r.scope === 'global' ? '🌍' : '🏷️';
                return `<option value="${r.id}">${r.icon} ${r.name} (${scopeIcon})</option>`;
            }).join('');
        }

        let tasksHtml = bState.tasks && bState.tasks.length > 0 ? TPL.renderBuilderTree(bState.tasks, [], classResOpts) : '';
        let tasksContainerHtml = tasksHtml ? `<div style="margin-bottom: 15px;">${tasksHtml}</div>` : '';
        
        const allAssignsForHistory = (db.assignments || []).filter(a => a.class_id === bState.classId);
        let historyHtml = (bState.editId) ? `<div style="color:var(--primary); font-weight:900; margin-bottom:15px; font-size:1rem;">「修改模式」</div>` : TPL.getHistoryDropdownHtml(allAssignsForHistory, bState.containerId);

        container.innerHTML = TPL.getBuilderFormHtml(bState, classResOpts, tasksContainerHtml, historyHtml);
    }

    return {
        getTaskParentArray, // 必須拋出，供 Templates 調用
        renderTimeline,
        scrollToCurrentWeek,
        openBuilder: (classId, date, containerId) => {
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法新增或修改作業。');
            
            bState = { 
                editId: null, classId, target_date: date, containerId, 
                title: '', description: '', due_date: '', is_published: false, 
                late_mode: 'infinite', late_grace: 0, late_penalty: 0, tasks: [] 
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
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            let sessions = (raw.custom_sessions && Array.isArray(raw.custom_sessions) && raw.custom_sessions.length > 0) ? [...raw.custom_sessions] : (db.sessions[a.class_id] || []);
            const assignmentDates = (db.assignments || []).filter(ast => ast.class_id === a.class_id).map(ast => ast.target_date);
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            const mode = cls.calcMode || 'single';
            const weekStartSetting = raw.week_start_day || 'sunday';
            let timelineNodes = [];
            if (mode === 'single') timelineNodes = sessions.map(d => ({ dates: [d] }));
            else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = DateUtils.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => timelineNodes.push({ dates: chunk }));
            }

            const nodeIndex = timelineNodes.findIndex(node => node.dates.includes(a.target_date));
            const cId = `builder-container-${nodeIndex >= 0 ? nodeIndex : 0}`; 

            bState = JSON.parse(JSON.stringify(a));
            bState.editId = a.id; bState.classId = a.class_id; bState.containerId = cId;
            
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
            
            if (aRaw.late_policy) {
                if (!aRaw.late_policy.allow_late) bState.late_mode = 'no_late';
                else if (aRaw.late_policy.grace_period_hours > 0) bState.late_mode = 'custom';
                else bState.late_mode = 'infinite';
                bState.late_grace = aRaw.late_policy.grace_period_hours || 0;
                bState.late_penalty = aRaw.late_policy.penalty_percentage || 0;
            } else {
                bState.late_mode = 'infinite'; bState.late_grace = 0; bState.late_penalty = 0;
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
        
        // 🌟 LINE 推播邏輯完美回歸！
        confirmLinePush: (assignId, classId) => {
            const a = (db.assignments || []).find(x => x.id === assignId);
            if (!a || !TPL) return;

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

            overlay.innerHTML = TPL.getLinePushModalHtml(cleanTitle, assignId, classId, overlayId);
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
            if (!a || !TPL) return;
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法搬移此作業。');

            const overlay = document.createElement('div');
            overlay.id = 'move-assign-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            overlay.innerHTML = TPL.getMoveAssignModalHtml(cleanTitle, a.target_date, a.id, classId);
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
            bState.title = a.title; bState.description = a.description;
            bState.due_date = a.due_date; bState.is_published = a.is_published;
            
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
            
            if (aRaw.late_policy) {
                if (!aRaw.late_policy.allow_late) bState.late_mode = 'no_late';
                else if (aRaw.late_policy.grace_period_hours > 0) bState.late_mode = 'custom';
                else bState.late_mode = 'infinite';
                bState.late_grace = aRaw.late_policy.grace_period_hours || 0;
                bState.late_penalty = aRaw.late_policy.penalty_percentage || 0;
            } else {
                bState.late_mode = 'infinite'; bState.late_grace = 0; bState.late_penalty = 0;
            }

            const assignNewIdsRecursive = (tasksList) => {
                return tasksList.map(t => {
                    const cloned = { ...t, id: `task_${Date.now()}_${Math.random()}` };
                    delete cloned.resource_id;
                    if (cloned.type === 'group' && cloned.subTasks) cloned.subTasks = assignNewIdsRecursive(cloned.subTasks);
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
                id: `task_${Date.now()}_${Math.random()}`, type, title: '', url: '', url_text: '', description: '',
                due_date: '', late_mode: 'infinite', grace_period_hours: 0, penalty_percentage: 0,
                ...(type === 'group' ? { subTasks: [] } : {})
            });
            renderBuilderUI();
        },
        removeNode: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            getTaskParentArray(arr).splice(arr[arr.length - 1], 1);
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
            if (idx < parentArr.length - 1) [parentArr[idx], parentArr[idx + 1]] = [parentArr[idx + 1], parentArr[idx]];
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
            if (newType === 'link' && !task.url) { task.url = ''; task.url_text = ''; }
            renderBuilderUI();
        },
        updateNodeUrl: (pathStr, val) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            getTaskParentArray(arr)[arr[arr.length - 1]].url = val;
            renderBuilderUI();
        },
        copyPrevNodeUrl: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                if (parentArr[idx - 1].url) parentArr[idx].url = parentArr[idx - 1].url;
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
                const targetNode = getTaskParentArray(arr)[arr[arr.length - 1]];
                if (!targetNode.subTasks) targetNode.subTasks = [];
                targetArr = targetNode.subTasks;
            }
            
            targetArr.push({
                id: `task_${Date.now()}_${Math.random()}`, type: 'link', title: res.name, url: res.url, url_text: '', 
                description: '', due_date: '', late_mode: 'infinite', grace_period_hours: 0, penalty_percentage: 0, resource_id: res.id
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
                            .from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
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
            const dragged = db.assignments.find(a => a.id === dragAssignId);
            
            if (dragged && dragged.target_date !== targetDate) {
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate;
                renderTimeline(classId, 'none'); 

                try {
                    const { data: updatedRows, error } = await window.supabaseClient
                        .from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
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
            if (typeof mergedRawData === 'string') { try { mergedRawData = JSON.parse(mergedRawData); } catch(e) { mergedRawData = {}; } }
            
            let mode = bState.late_mode || 'infinite';
            let allowLate = (mode === 'infinite' || mode === 'custom');
            let grace = (mode === 'custom') ? (parseInt(bState.late_grace) || 0) : 0;
            let penalty = (mode !== 'no_late') ? (parseInt(bState.late_penalty) || 0) : 0;

            mergedRawData.late_policy = { allow_late: allowLate, grace_period_hours: grace, penalty_percentage: penalty };
            delete mergedRawData.allow_late; delete mergedRawData.late_policy.is_inherited; 
            
            const payload = {
                class_id: bState.classId, target_date: bState.target_date, title: bState.title, description: bState.description,
                due_date: bState.due_date || null, is_published: bState.is_published, tasks: [...bState.tasks], raw_data: mergedRawData
            };

            const originalText = btnEl.innerHTML;
            btnEl.innerHTML = '⏳ 儲存至雲端...'; btnEl.disabled = true;
            let savedId = bState.editId;

            try {
                if (bState.editId) {
                    const { data: updatedRows, error } = await window.supabaseClient
                        .from('assignments').update(payload).eq('id', bState.editId).is('deleted_at', null).select(); 
                    if (error) throw new Error(error.message);
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    const idx = db.assignments.findIndex(a => a.id === bState.editId);
                    if(idx !== -1) db.assignments[idx] = { id: bState.editId, ...payload };
                } else {
                    const { data, error } = await window.supabaseClient.from('assignments').insert([payload]).select().single();
                    if (error) throw new Error(error.message);
                    if (!data) throw new Error("資料庫拒絕了請求");
                    db.assignments.push(data); savedId = data.id; 
                }
                bState = null;
                renderTimeline(payload.class_id, 'target', `assign-block-${savedId}`);
            } catch (err) {
                alert('❌ 作業儲存失敗: ' + err.message);
                btnEl.innerHTML = originalText; btnEl.disabled = false;
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
            btn.innerHTML = '⏳'; btn.disabled = true;

            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments').update({ deleted_at: new Date().toISOString() }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了您的封存請求");

                db.assignments = db.assignments.filter(a => a.id !== assignId);
                renderTimeline(classId, 'none');
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
                btn.innerHTML = originalText; btn.disabled = false;
            }
        }
    };
})();
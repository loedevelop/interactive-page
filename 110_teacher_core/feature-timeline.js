/**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js
 * 🌟 v67 終極自動上雲防護版：
 * 導入 handleStudentLocalFileChange 與 saveBlock 攔截器。
 * 老師選取 Local 檔案，存檔時會自動呼叫 GAS 上傳至雲端，神不知鬼不覺轉為 Drive 網址！
 */

console.log("🚀 FeatureTimeline v67 載入成功！(支援學生端 Local 檔案自動上雲)");

window.FeatureTimeline = (() => {
    const db = window.TeacherDB;
    
    if (db && db.assignments) {
        const originalLength = db.assignments.length;
        db.assignments = db.assignments.filter(a => a.target_date !== undefined && a.target_date !== null);
        if (db.assignments.length !== originalLength && typeof db.save === 'function') db.save(); 
    }

    let dragAssignId = null; 

    function checkCanEditTimeline(classId) {
        if (!db || !db.classes) return false;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return false;
        const userRole = cls.staff_role || (window.TeacherUI && window.TeacherUI.getCurrentUserRole ? window.TeacherUI.getCurrentUserRole(classId) : 'primary_teacher');
        return ['admin', 'primary_teacher', 'co_teacher', 'ta_senior'].includes(userRole);
    }

    const scrollToCurrentWeek = () => {
        if (window.BuilderStore && window.BuilderStore.getState()) return; 
        const targetNode = document.querySelector('.timeline-node[data-is-current="true"]');
        const container = document.querySelector('.view-section.active');
        if (targetNode && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = targetNode.getBoundingClientRect();
            const scrollAmount = nodeRect.top - containerRect.top - 15;
            container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }
    };

    function getTimelineSessions(cls, DateUtils) {
        if (!cls) return [];
        let raw = cls.raw_data || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
        }
        
        let sessions = [];
        if (raw.custom_sessions && Array.isArray(raw.custom_sessions) && raw.custom_sessions.length > 0) {
            sessions = [...raw.custom_sessions];
        } else if (db && db.sessions && db.sessions[cls.id] && db.sessions[cls.id].length > 0) {
            sessions = [...db.sessions[cls.id]];
        } else {
            let rawMeet = cls.meetDays || cls.meet_days || raw.meet_days || [];
            if (typeof rawMeet === 'string') {
                if (rawMeet.startsWith('[')) {
                    try { rawMeet = JSON.parse(rawMeet); } catch(e) { rawMeet = []; }
                } else {
                    rawMeet = rawMeet.split(',');
                }
            }
            let meetDays = Array.isArray(rawMeet) ? rawMeet.map(Number).filter(n => !isNaN(n)) : [];
            let startDateStr = cls.startDate || cls.start_date || raw.start_date;
            let endDateStr = cls.endDate || cls.end_date || raw.end_date;

            if (startDateStr && endDateStr && meetDays.length > 0) {
                sessions = DateUtils.generateDates(startDateStr, endDateStr, meetDays);
            }
        }
        
        return sessions.map(d => DateUtils.normalizeDateString(d)).filter(Boolean);
    }

    function renderTimeline(classId, scrollMode = 'current', targetId = null) {
        const container = document.getElementById('timeline-container');
        if (!container) return;

        try {
            const TPL = window.TimelineTemplates; 
            const DateUtils = window.UtilsDate;   

            if (!TPL || !DateUtils) {
                container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 系統錯誤：核心依賴模組遺失。</div>`;
                return;
            }
            
            container.className = '';
            const cls = (db && db.classes) ? db.classes.find(c => c.id === classId) : null;
            if (!cls) {
                container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 找不到該班級的主檔資料</div>`;
                return;
            }
            
            const canEditTimeline = checkCanEditTimeline(classId);
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            const classAssignments = (db && db.assignments) ? db.assignments : [];
            let sessions = getTimelineSessions(cls, DateUtils);

            const assignmentDates = classAssignments
                .filter(a => a.class_id === classId && a.target_date)
                .map(a => DateUtils.normalizeDateString(a.target_date));
            
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            if (sessions.length === 0) {
                container.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px;">無排程資料。請至「⚙️ 課程基本資料」設定學期起訖日與上課日。</p>';
                return;
            }

            const weekStartSetting = raw.week_start_day || 'sunday';
            const todayStr = DateUtils.getTaiwanTodayString();
            const currentWeekStart = DateUtils.getWeekStartStr(todayStr, weekStartSetting);
            
            const mode = cls.calcMode || cls.calc_mode || 'single';

            let timelineNodes = [];
            if (mode === 'single') {
                timelineNodes = sessions.map(d => ({ title: d, dates: [d] }));
            } else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = DateUtils.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => {
                    timelineNodes.push({ title: chunk.length > 1 ? `${chunk[0]} ~ ${chunk[chunk.length-1]}` : chunk[0], dates: chunk });
                });
            }

            let html = '';
            timelineNodes.forEach((node, index) => {
                const nodeWeekStart = DateUtils.getWeekStartStr(node.dates[0], weekStartSetting);
                let isCurrent = (nodeWeekStart === currentWeekStart);
                let isFuture = node.dates[0] > todayStr;
                const nodeDate = node.dates[0];
                const nodeAssignments = classAssignments.filter(a => a.class_id === classId && node.dates.includes(DateUtils.normalizeDateString(a.target_date)));
                
                let assignmentsHtml = '';
                if (nodeAssignments.length > 0) {
                    nodeAssignments.forEach(a => {
                        let effectiveBlockDueDate = a.due_date;
                        let aRaw = a.raw_data || {};
                        if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
                        
                        let blockLateMode = 'infinite', blockPenalty = 0, blockGrace = 0;
                        if (aRaw.late_policy) {
                            if (!aRaw.late_policy.allow_late) blockLateMode = 'no_late';
                            else if (aRaw.late_policy.grace_period_hours > 0) { blockLateMode = 'custom'; blockGrace = aRaw.late_policy.grace_period_hours; }
                            blockPenalty = aRaw.late_policy.penalty_percentage || 0;
                        }
                        const effectiveBlockLatePolicy = { mode: blockLateMode, penalty: blockPenalty, grace: blockGrace };
                        let tasksHtml = TPL.renderReadOnlyTree(a.tasks || [], effectiveBlockDueDate, effectiveBlockLatePolicy, 0);
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
                                if (!window.BuilderStore || !window.BuilderStore.getState()) setTimeout(scrollToCurrentWeek, 100); 
                            }
                        }
                    });
                });
                observer.observe(viewProgress, { attributes: true });
                window._timelineObserverAttached = true;
            }

        } catch (error) {
            console.error("Timeline Render Crashed:", error);
            container.innerHTML = `<div style="padding:20px; background:#FEE2E2; border:2px solid #EF4444; border-radius:10px; margin: 20px;"><h3 style="color:#B91C1C; margin-top:0;">⚠️ 進度軸渲染失敗</h3><p style="color:#7F1D1D;">錯誤原因：${error.message}</p></div>`;
        }
    }

    function renderBuilderUI() {
        const TPL = window.TimelineTemplates;
        if (!window.BuilderStore) return;
        const bState = window.BuilderStore.getState();
        if (!bState || !TPL) return;
        const container = document.getElementById(bState.containerId);
        if (!container) return;

        let classResOpts = '';
        const allResList = (db && db.resourceLibrary || []).filter(r => r.scope === 'global' || (r.scope === 'class' && r.target_class_id === bState.classId));
        
        if (allResList.length > 0) {
            const resMap = new Map();
            allResList.forEach(r => {
                const hasUrl = r.url && r.url.trim() !== '';
                const key = hasUrl ? r.url.trim() : r.id; 
                
                if (!resMap.has(key)) {
                    resMap.set(key, r);
                } else if (hasUrl) {
                    const existing = resMap.get(key);
                    if (existing.scope === 'class' && r.scope === 'global') {
                        resMap.set(key, r);
                    }
                }
            });

            const uniqueResList = Array.from(resMap.values()).sort((a, b) => {
                if (a.scope === 'global' && b.scope === 'class') return -1;
                if (a.scope === 'class' && b.scope === 'global') return 1;
                return 0;
            });

            classResOpts = uniqueResList.map(r => {
                const scopeIcon = r.scope === 'global' ? '🌍' : '🏷️';
                return `<option value="${r.id}">${r.icon} ${r.name} (${scopeIcon})</option>`;
            }).join('');
        }

        let tasksHtml = bState.tasks && bState.tasks.length > 0 ? TPL.renderBuilderTree(bState.tasks, [], classResOpts) : '';
        let tasksContainerHtml = tasksHtml ? `<div style="margin-bottom: 15px;">${tasksHtml}</div>` : '';
        const allAssignsForHistory = (db && db.assignments || []).filter(a => a.class_id === bState.classId);
        let historyHtml = (bState.editId) ? `<div style="color:var(--primary); font-weight:900; margin-bottom:15px; font-size:1rem;">「修改模式」</div>` : TPL.getHistoryDropdownHtml(allAssignsForHistory, bState.containerId);

        container.innerHTML = TPL.getBuilderFormHtml(bState, classResOpts, tasksContainerHtml, historyHtml);
    }

    return {
        renderTimeline,
        scrollToCurrentWeek,
        
        getTaskParentArray: (pathArray) => window.BuilderStore.getTaskParentArray(pathArray),
        
        openBuilder: (classId, date, containerId) => {
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法新增或修改作業。');
            window.BuilderStore.initNew(classId, date, containerId);
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
            if (!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(a.class_id)) return alert('權限不足：您的身分無法修改此作業。');
            
            const cls = db.classes.find(c => c.id === a.class_id) || {};
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            let sessions = getTimelineSessions(cls, window.UtilsDate);
            const assignmentDates = db.assignments.filter(ast => ast.class_id === a.class_id).map(ast => window.UtilsDate.normalizeDateString(ast.target_date));
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            const mode = cls.calcMode || 'single';
            const weekStartSetting = raw.week_start_day || 'sunday';
            let timelineNodes = [];
            if (mode === 'single') timelineNodes = sessions.map(d => ({ dates: [d] }));
            else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = window.UtilsDate.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => timelineNodes.push({ dates: chunk }));
            }

            const targetDateStr = window.UtilsDate.normalizeDateString(a.target_date);
            const nodeIndex = timelineNodes.findIndex(node => node.dates.includes(targetDateStr));
            const cId = `builder-container-${nodeIndex >= 0 ? nodeIndex : 0}`; 

            window.BuilderStore.initEdit(a, cId);
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

        applyResourceUrl: (pathStr, resId, targetInputId = null) => {
            if (!resId || !db || !db.resourceLibrary) return;
            const res = db.resourceLibrary.find(r => r.id === resId);
            if (!res) return;
            
            const realUrl = res.url || ''; 
            
            if (targetInputId) {
                const el = document.getElementById(targetInputId);
                if (el) {
                    el.value = realUrl;
                    window.BuilderStore.sync(); 
                }
            } else if (pathStr) {
                window.BuilderStore.updateNodeUrl(pathStr, realUrl);
                renderBuilderUI();
            }
        },

        handleStudentLocalFileChange: (inputEl, pathStr) => {
            const file = inputEl.files[0];
            if (!file) {
                document.getElementById(`node-student-local-b64-${pathStr}`).value = '';
                document.getElementById(`node-student-local-mime-${pathStr}`).value = '';
                document.getElementById(`node-student-local-filename-${pathStr}`).value = '';
                return;
            }
            if (file.size > 15 * 1024 * 1024) { 
                alert('⚠️ 檔案過大，請選擇 15MB 以下的檔案以確保上傳順暢。');
                inputEl.value = '';
                return;
            }
            
            const containerId = window.BuilderStore.getState().containerId;
            const btn = document.getElementById(`btn-save-block-${containerId}`);
            if(btn) { btn.disabled = true; btn.innerHTML = '⏳ 讀取檔案中...'; }

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                document.getElementById(`node-student-local-b64-${pathStr}`).value = base64;
                document.getElementById(`node-student-local-mime-${pathStr}`).value = file.type;
                document.getElementById(`node-student-local-filename-${pathStr}`).value = file.name;
                window.BuilderStore.sync();
                if(btn) { btn.disabled = false; btn.innerHTML = `💾 ${window.BuilderStore.getState().editId ? '儲存修改' : '完成並儲存區塊'}`; }
            };
            reader.readAsDataURL(file);
        },

        handlePDFUpload: async (inputEl, pathStr) => {
            const file = inputEl.files[0];
            if (!file) return;
            const textarea = document.getElementById(`node-script-${pathStr}`);
            if (!textarea) return;

            const originalText = textarea.value;
            textarea.value = '⏳ 正在解析 PDF 文字，請稍候...';

            try {
                let pdfjsCore = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                if (!pdfjsCore) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('PDF.js 網路載入失敗'));
                        document.head.appendChild(script);
                    });
                    
                    pdfjsCore = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                    if (!pdfjsCore) throw new Error('無法取得 PDF.js 核心物件');
                }

                pdfjsCore.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsCore.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n\n';
                }

                textarea.value = fullText.trim();
                alert('✅ PDF 文字萃取成功！請檢查並手動修飾排版。');

            } catch (error) {
                console.error("PDF 解析失敗:", error);
                textarea.value = originalText;
                alert('❌ PDF 解析失敗: ' + error.message);
            } finally {
                inputEl.value = ''; 
                window.BuilderStore.sync(); 
            }
        },

        addNode: (pathStr, type) => { window.BuilderStore.addNode(pathStr, type); renderBuilderUI(); },
        removeNode: (pathStr) => { window.BuilderStore.removeNode(pathStr); renderBuilderUI(); },
        moveNodeUp: (pathStr) => { window.BuilderStore.moveNodeUp(pathStr); renderBuilderUI(); },
        moveNodeDown: (pathStr) => { window.BuilderStore.moveNodeDown(pathStr); renderBuilderUI(); },
        moveNodeLeft: (pathStr) => { window.BuilderStore.moveNodeLeft(pathStr); renderBuilderUI(); },
        moveNodeRight: (pathStr) => { window.BuilderStore.moveNodeRight(pathStr); renderBuilderUI(); },
        changeNodeType: (pathStr, newType) => { window.BuilderStore.changeNodeType(pathStr, newType); renderBuilderUI(); },
        updateNodeUrl: (pathStr, val) => { window.BuilderStore.updateNodeUrl(pathStr, val); renderBuilderUI(); },
        copyPrevNodeUrl: (pathStr) => { window.BuilderStore.copyPrevNodeUrl(pathStr); renderBuilderUI(); },
        addResourceTaskAsLink: (pathStr, resId) => {
            if(!db || !db.resourceLibrary) return;
            const res = db.resourceLibrary.find(r => r.id === resId);
            if (res) { window.BuilderStore.addResourceTaskAsLink(pathStr, res); renderBuilderUI(); }
        },
        copyHistory: (historyId) => {
            if(!historyId || !db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === historyId);
            if (a) { window.BuilderStore.copyHistory(a); renderBuilderUI(); }
        },

        saveBlock: async (btnEl) => {
            window.BuilderStore.sync(); 
            const bState = window.BuilderStore.getState();
            const titleText = bState.title.replace(/<[^>]*>?/gm, '').trim();
            if (!titleText) return alert('⚠️ 請填寫大區塊標題！');
            if (!db.assignments) db.assignments = [];
            
            const originalText = btnEl.innerHTML;
            btnEl.innerHTML = '⏳ 處理中...'; btnEl.disabled = true;

            try {
                // 🌟 雲端上傳攔截器：掃描並上傳所有 Student Local File 到 GAS
                const processTasksForUpload = async (tasks) => {
                    for (let t of tasks) {
                        if (t.type === 'group' && t.subTasks) {
                            await processTasksForUpload(t.subTasks);
                        } else if (t.type === 'audio_record' && t.raw_data) {
                            const raw = t.raw_data;
                            if (raw.student_source_type === 'local' && raw.student_local_b64) {
                                btnEl.innerHTML = `⏳ 上傳教材: ${raw.student_local_filename}...`;
                                
                                const cls = window.TeacherDB.classes.find(c => c.id === bState.classId);
                                let clsRaw = {};
                                if (cls && cls.raw_data) {
                                    try { clsRaw = typeof cls.raw_data === 'string' ? JSON.parse(cls.raw_data) : cls.raw_data; } catch(e){}
                                }
                                const targetFolderId = clsRaw.drive_folder_id || clsRaw.class_folder_id || '';
                                
                                if (!targetFolderId) throw new Error('該班級尚未綁定雲端資料夾，無法自動上傳檔案');
                                
                                if (typeof window.GasService === 'undefined' || !window.GasService.uploadStudentLocalFile) {
                                    throw new Error('系統錯誤：找不到 GasService 模組或函數');
                                }

                                const fileUrl = await window.GasService.uploadStudentLocalFile(
                                    raw.student_local_b64,
                                    raw.student_local_filename,
                                    raw.student_local_mime,
                                    targetFolderId,
                                    bState.editId || '',
                                    t.id
                                );

                                // 🚀 上傳成功，轉化為 Drive 模式存檔
                                raw.student_source_type = 'drive';
                                raw.student_drive_url = fileUrl;
                                raw.student_drive_desc = raw.student_local_desc; 
                                
                                delete raw.student_local_b64;
                                delete raw.student_local_mime;
                                delete raw.student_local_filename;
                                delete raw.student_local_desc;
                            }
                        }
                    }
                };

                await processTasksForUpload(bState.tasks);
                btnEl.innerHTML = '⏳ 儲存至雲端...';

                let mergedRawData = bState.raw_data || {};
                if (typeof mergedRawData === 'string') { try { mergedRawData = JSON.parse(mergedRawData); } catch(e) { mergedRawData = {}; } }
                
                let mode = bState.late_mode || 'infinite';
                let allowLate = (mode === 'infinite' || mode === 'custom');
                let grace = (mode === 'custom') ? (parseInt(bState.late_grace) || 0) : 0;
                let penalty = (mode !== 'no_late') ? (parseInt(bState.late_penalty) || 0) : 0;

                mergedRawData.late_policy = { allow_late: allowLate, grace_period_hours: grace, penalty_percentage: penalty };
                delete mergedRawData.allow_late; delete mergedRawData.late_policy.is_inherited; 
                
                const payload = {
                    class_id: bState.classId, target_date: window.UtilsDate.normalizeDateString(bState.target_date), title: bState.title, description: bState.description,
                    due_date: bState.due_date || null, is_published: bState.is_published, tasks: [...bState.tasks], raw_data: mergedRawData
                };

                let savedId = bState.editId;

                if (bState.editId) {
                    const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update(payload).eq('id', bState.editId).is('deleted_at', null).select(); 
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
                const savedClassId = bState.classId; 
                window.BuilderStore.clear();
                renderTimeline(savedClassId, 'target', `assign-block-${savedId}`);
            } catch (err) {
                alert('❌ 作業儲存失敗: ' + err.message);
                btnEl.innerHTML = originalText; btnEl.disabled = false;
            }
        },
        cancelBuilder: () => {
            const cid = window.BuilderStore.getState().classId;
            window.BuilderStore.clear();
            renderTimeline(cid, 'none');
        },
        deleteHistoryTemplate: async () => {
            const state = window.BuilderStore.getState();
            if (!state) return;
            const selectEl = document.getElementById(`history-select-${state.containerId}`);
            if (!selectEl) return;
            const historyId = selectEl.value;
            if (!historyId) return alert('⚠️ 請先選擇要刪除的歷史紀錄！');
            if (!confirm('確定要封存這個歷史作業模板嗎？')) return;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ deleted_at: window.UtilsDate.getTaiwanIsoTimestamp() }).eq('id', historyId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                db.assignments = db.assignments.filter(a => a.id !== historyId);
                alert('✅ 已成功封存！');
                renderBuilderUI();
            } catch (err) { alert('❌ 封存失敗: ' + err.message); }
        },
        deleteAssignment: async (assignId, classId) => {
            if(!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法封存作業。');
            if(!confirm('確定要封存此作業區塊嗎？\n(注意：這將會隱藏作業，學生的打勾紀錄仍會保存在系統中)')) return;
            
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳'; btn.disabled = true;

            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ deleted_at: window.UtilsDate.getTaiwanIsoTimestamp() }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕請求");

                db.assignments = db.assignments.filter(a => a.id !== assignId);
                renderTimeline(classId, 'none');
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        confirmLinePush: (assignId, classId) => {
            const TPL = window.TimelineTemplates;
            if(!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a || !TPL) return;

            const cls = db.classes.find(c => c.id === classId);
            let raw = cls?.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }
            if (!raw.line_notify_token) return alert('⚠️ 此班級尚未綁定 LINE Notify Token！\n請先至「⚙️ 班級設定」中進行綁定。');

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
            btn.innerHTML = '⏳ 發送中...'; btn.disabled = true;

            try {
                if (!window.ServiceLineNotify || typeof window.ServiceLineNotify.pushAssignment !== 'function') throw new Error("系統提示：LINE 推播微服務尚未載入。");
                await window.ServiceLineNotify.pushAssignment(classId, assignId);
                document.getElementById('line-push-modal').remove();
                alert('✅ 已成功發送至 LINE 群組！');
            } catch (err) {
                alert('❌ 推播失敗: ' + err.message);
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        dragAssignStart: (e, id) => { dragAssignId = id; e.dataTransfer.effectAllowed = 'move'; },
        dropAssign: async (e, targetId, classId) => {
            e.preventDefault(); e.stopPropagation(); 
            if (!dragAssignId || dragAssignId === targetId || !db || !db.assignments) return;

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
                        const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
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
            if (!dragAssignId || !db || !db.assignments) return;
            const dragged = db.assignments.find(a => a.id === dragAssignId);
            
            if (dragged && dragged.target_date !== targetDate) {
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate;
                renderTimeline(classId, 'none'); 

                try {
                    const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
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
        moveAssignment: (assignId, classId) => {
            const TPL = window.TimelineTemplates;
            if(!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a || !TPL) return;
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法搬移此作業。');

            const overlay = document.createElement('div');
            overlay.id = 'move-assign-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            overlay.innerHTML = TPL.getMoveAssignModalHtml(cleanTitle, window.UtilsDate.normalizeDateString(a.target_date), a.id, classId);
            document.body.appendChild(overlay);
        },
        submitMove: async (assignId, classId, oldDate) => {
            const newDate = document.getElementById('move-target-date').value;
            if (!newDate) return alert('⚠️ 請選擇目標日期');
            if (newDate === oldDate) return document.getElementById('move-assign-modal').remove(); 
            
            const btn = document.getElementById('btn-confirm-move');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 處理中...'; btn.disabled = true;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: newDate }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                
                const idx = db.assignments.findIndex(a => a.id === assignId);
                if(idx > -1) db.assignments[idx].target_date = newDate;
                
                document.getElementById('move-assign-modal').remove();
                window.FeatureTimeline.renderTimeline(classId, 'target', `assign-block-${assignId}`);
            } catch (err) {
                alert('❌ 改期失敗: ' + err.message);
                btn.innerHTML = originalText; btn.disabled = false;
            }
        }
    };
})();
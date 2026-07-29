/**
 * 📂 檔案路徑：110_teacher_core/store-assignment-builder.js
 * 🌟 第三層 (State Store)：作業編輯器狀態管理大腦 v45
 * - 嚴格捕捉 3 大來源 (Drive/Local/Text) 的所有細節狀態，並支援學生端本地檔案 Base64。
 */
window.BuilderStore = (() => {
    'use strict';
    
    let bState = null;

    function sanitizeScript(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]*>?/gm, '') 
            .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) 
            .replace(/\u3000/g, ' ') 
            .replace(/[^\S\r\n]+/g, ' ') 
            .trim();
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

                if (t.type === 'audio_record') {
                    if (!t.raw_data) t.raw_data = {};
                    
                    const useAiEl = document.getElementById(`node-use-ai-${pathStr}`); 
                    const useGrammarEl = document.getElementById(`node-use-grammar-${pathStr}`);
                    if (useAiEl) t.raw_data.use_ai_grading = useAiEl.checked;
                    if (useGrammarEl) t.raw_data.use_ai_grammar = useGrammarEl.checked;

                    const captureStudioEl = document.getElementById(`node-capture-studio-${pathStr}`);
                    const captureUploadEl = document.getElementById(`node-capture-upload-${pathStr}`);
                    if (captureStudioEl) t.raw_data.capture_studio = captureStudioEl.checked;
                    if (captureUploadEl) t.raw_data.capture_upload = captureUploadEl.checked;
                    if (t.raw_data.capture_studio === false && t.raw_data.capture_upload === false) {
                        t.raw_data.capture_studio = true;
                        t.raw_data.capture_upload = true;
                    }

                    const scriptSourceEl = document.getElementById(`node-script-source-${pathStr}`);
                    if (scriptSourceEl) t.raw_data.script_source = scriptSourceEl.value || 'meta';
                    const scriptSource = t.raw_data.script_source || 'meta';

                    const materialRangeEl = document.getElementById(`node-material-range-${pathStr}`);
                    const materialRangeManualEl = document.getElementById(`node-material-range-manual-${pathStr}`);
                    if (scriptSource === 'meta') {
                        if (materialRangeEl) t.raw_data.material_range = String(materialRangeEl.value || '').trim();
                    } else if (materialRangeManualEl) {
                        t.raw_data.material_range = String(materialRangeManualEl.value || '').trim();
                    } else if (materialRangeEl) {
                        t.raw_data.material_range = String(materialRangeEl.value || '').trim();
                    }

                    const materialUrlEl = document.getElementById(`node-material-url-${pathStr}`);
                    if (materialUrlEl) {
                        t.raw_data.material_url = String(materialUrlEl.value || '').trim();
                        if (t.raw_data.material_url && !t.raw_data.student_drive_url) {
                            t.raw_data.student_drive_url = t.raw_data.material_url;
                        }
                    }

                    // A: meta 文稿以 snapshot / meta 面板為準；C: 以 paste 面板為準
                    const scriptEl = document.getElementById(`node-script-${pathStr}`);
                    const studentTextEl = document.getElementById(`node-student-text-${pathStr}`);
                    const scriptPasteEl = document.getElementById(`node-script-paste-${pathStr}`);
                    const studentPasteEl = document.getElementById(`node-student-text-paste-${pathStr}`);

                    if (scriptSource === 'paste') {
                        if (scriptPasteEl) t.raw_data.original_script = sanitizeScript(scriptPasteEl.value);
                        if (studentPasteEl) {
                            const displayText = studentPasteEl.value;
                            t.raw_data.student_text = displayText;
                            t.raw_data.student_display = displayText;
                            t.raw_data.student_display_text = displayText;
                        }
                        if (scriptEl && scriptPasteEl) scriptEl.value = scriptPasteEl.value;
                        if (studentTextEl && studentPasteEl) studentTextEl.value = studentPasteEl.value;
                    } else if (scriptSource === 'range_only') {
                        // 僅範圍：清掉顯示文稿本體（保留 material_range）
                        t.raw_data.student_display = '';
                        t.raw_data.student_display_text = '';
                        t.raw_data.student_text = '';
                        if (scriptEl) t.raw_data.original_script = sanitizeScript(scriptEl.value);
                    } else {
                        if (scriptEl) t.raw_data.original_script = sanitizeScript(scriptEl.value);
                        if (studentTextEl) {
                            t.raw_data.student_text = studentTextEl.value;
                            t.raw_data.student_display = studentTextEl.value;
                            t.raw_data.student_display_text = studentTextEl.value;
                        }
                    }

                    const snapshotJsonEl = document.getElementById(`node-material-snapshot-json-${pathStr}`);
                    if (snapshotJsonEl && snapshotJsonEl.value) {
                        try {
                            const snap = JSON.parse(snapshotJsonEl.value);
                            if (scriptSource === 'meta') {
                                if (snap.original_script) t.raw_data.original_script = sanitizeScript(scriptEl && scriptEl.value ? scriptEl.value : snap.original_script);
                                if (snap.student_display || snap.student_display_text) {
                                    const fromUi = studentTextEl ? studentTextEl.value : '';
                                    const displayText = fromUi || snap.student_display || snap.student_display_text;
                                    t.raw_data.student_display = displayText;
                                    t.raw_data.student_display_text = displayText;
                                    t.raw_data.student_text = displayText;
                                }
                                if (Array.isArray(snap.material_refs) && snap.material_refs.length) {
                                    t.raw_data.material_refs = snap.material_refs;
                                    t.raw_data.material_ref = snap.material_refs[0];
                                } else if (snap.material_ref) {
                                    t.raw_data.material_ref = snap.material_ref;
                                    t.raw_data.material_refs = [snap.material_ref];
                                }
                                if (snap.material_range) t.raw_data.material_range = snap.material_range;
                                if (materialRangeEl && materialRangeEl.value) t.raw_data.material_range = String(materialRangeEl.value).trim();
                                if (snap.snapshot_at) t.raw_data.snapshot_at = snap.snapshot_at;
                            }
                        } catch (_snapErr) {}
                    }

                    if (scriptSource === 'meta') {
                        const rows = [];
                        const listEl = document.getElementById(`node-material-rows-${pathStr}`);
                        const rootEl = document.getElementById(`node-material-root-${pathStr}`);
                        if (listEl) {
                            listEl.querySelectorAll('.material-meta-row').forEach(function (rowEl) {
                                const fileEl = rowEl.querySelector('.material-meta-file');
                                const rangeEl = rowEl.querySelector('.material-meta-range');
                                const value = fileEl ? String(fileEl.value || '').trim() : '';
                                if (!value) return;
                                const parts = value.split('::');
                                const rangeSpec = rangeEl ? String(rangeEl.value || '').trim() : '';
                                const label = (parts[1] || '').replace(/\.meta\.json$/i, '').replace(/\.json$/i, '');
                                const stemParts = label.split(/[\/_]/);
                                rows.push({
                                    materials_root_kind: (rootEl && rootEl.value === 'class') ? 'class' : 'teacher',
                                    material_folder: parts[0] || '',
                                    published_file: parts[1] || '',
                                    select_mode: 'range_spec',
                                    range_spec: rangeSpec,
                                    label: stemParts[stemParts.length - 1] || label
                                });
                            });
                        }
                        if (rows.length) {
                            t.raw_data.material_refs = rows;
                            t.raw_data.material_ref = rows[0];
                        }
                    }

                    const studentSourceTypeEl = document.getElementById(`node-student-source-type-${pathStr}`);
                    if (studentSourceTypeEl) t.raw_data.student_source_type = studentSourceTypeEl.value;
                    else if (scriptSource === 'resource' && t.raw_data.student_local_b64) t.raw_data.student_source_type = 'local';
                    else if (scriptSource === 'resource' && (t.raw_data.material_url || t.raw_data.student_drive_url)) t.raw_data.student_source_type = 'drive';

                    const studentDriveUrlEl = document.getElementById(`node-student-drive-url-${pathStr}`);
                    if (studentDriveUrlEl && studentDriveUrlEl.value) t.raw_data.student_drive_url = studentDriveUrlEl.value;
                    
                    const studentDriveDescEl = document.getElementById(`node-student-drive-desc-${pathStr}`);
                    if (studentDriveDescEl) t.raw_data.student_drive_desc = studentDriveDescEl.value || t.raw_data.material_range || '';

                    const studentLocalDescEl = document.getElementById(`node-student-local-desc-${pathStr}`);
                    if (studentLocalDescEl) t.raw_data.student_local_desc = studentLocalDescEl.value;

                    const studentLocalB64El = document.getElementById(`node-student-local-b64-${pathStr}`);
                    if (studentLocalB64El) t.raw_data.student_local_b64 = studentLocalB64El.value;

                    const studentLocalMimeEl = document.getElementById(`node-student-local-mime-${pathStr}`);
                    if (studentLocalMimeEl) t.raw_data.student_local_mime = studentLocalMimeEl.value;

                    const studentLocalFilenameEl = document.getElementById(`node-student-local-filename-${pathStr}`);
                    if (studentLocalFilenameEl) t.raw_data.student_local_filename = studentLocalFilenameEl.value;

                    // 相容舊欄位
                    if (!t.raw_data.ai_source_type) t.raw_data.ai_source_type = 'text';
                    if (!t.raw_data.student_source_type) t.raw_data.student_source_type = 'text';
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

    return {
        initNew: (classId, date, containerId) => {
            bState = { 
                editId: null, classId, target_date: date, containerId, 
                title: '', description: '', due_date: '', is_published: false, 
                late_mode: 'infinite', late_grace: 0, late_penalty: 0, tasks: [] 
            };
        },
        initEdit: (assignment, containerId) => {
            bState = JSON.parse(JSON.stringify(assignment));
            bState.editId = assignment.id; 
            bState.classId = assignment.class_id; 
            bState.containerId = containerId;
            
            let aRaw = assignment.raw_data || {};
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
        },
        getState: () => bState,
        clear: () => { bState = null; },
        sync: () => syncState(),
        
        getTaskParentArray: getTaskParentArray,

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
                raw_data: type === 'audio_record' ? {
                    use_ai_grading: true,
                    use_ai_grammar: false,
                    capture_studio: true,
                    capture_upload: true,
                    script_source: 'meta',
                    material_range: '',
                    ai_source_type: 'text',
                    student_source_type: 'text'
                } : {}, 
                ...(type === 'group' ? { subTasks: [] } : {})
            });
        },
        removeNode: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            getTaskParentArray(arr).splice(arr[arr.length - 1], 1);
        },
        moveNodeUp: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                [parentArr[idx - 1], parentArr[idx]] = [parentArr[idx], parentArr[idx - 1]];
            }
        },
        moveNodeDown: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            const parentArr = getTaskParentArray(arr);
            if (idx < parentArr.length - 1) [parentArr[idx], parentArr[idx + 1]] = [parentArr[idx + 1], parentArr[idx]];
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
        },
        changeNodeType: (pathStr, newType) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const parentArr = getTaskParentArray(arr);
            let task = parentArr[arr[arr.length - 1]];
            task.type = newType;
            if (newType === 'link' && !task.url) { task.url = ''; task.url_text = ''; }
            
            if (newType === 'audio_record') {
                if (!task.raw_data) task.raw_data = {};
                if (task.raw_data.use_ai_grading === undefined) task.raw_data.use_ai_grading = true;
                if (task.raw_data.use_ai_grammar === undefined) task.raw_data.use_ai_grammar = false;
                if (task.raw_data.capture_studio === undefined) task.raw_data.capture_studio = true;
                if (task.raw_data.capture_upload === undefined) task.raw_data.capture_upload = true;
                if (task.raw_data.script_source === undefined) task.raw_data.script_source = 'meta';
                if (task.raw_data.material_range === undefined) task.raw_data.material_range = '';
                if (task.raw_data.ai_source_type === undefined) task.raw_data.ai_source_type = 'text';
                if (task.raw_data.student_source_type === undefined) task.raw_data.student_source_type = 'text';
            }
        },
        updateNodeUrl: (pathStr, val) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            getTaskParentArray(arr)[arr[arr.length - 1]].url = val;
        },
        copyPrevNodeUrl: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                if (parentArr[idx - 1].url) parentArr[idx].url = parentArr[idx - 1].url;
            }
        },
        addResourceTaskAsLink: (pathStr, res) => {
            syncState();
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
                description: '', due_date: '', late_mode: 'infinite', grace_period_hours: 0, penalty_percentage: 0, resource_id: res.id,
                raw_data: {}
            });
        },
        copyHistory: (historyAssignment) => {
            syncState();
            if (window.AssignmentClone && typeof window.AssignmentClone.cloneAssignmentRecord === 'function') {
                var cloned = window.AssignmentClone.cloneAssignmentRecord(historyAssignment);
                bState.title = cloned.title;
                bState.description = cloned.description;
                bState.due_date = cloned.due_date;
                bState.is_published = false;
                bState.tasks = cloned.tasks;

                var clonedRaw = cloned.raw_data || {};
                if (clonedRaw.late_policy) {
                    if (!clonedRaw.late_policy.allow_late) bState.late_mode = 'no_late';
                    else if (clonedRaw.late_policy.grace_period_hours > 0) bState.late_mode = 'custom';
                    else bState.late_mode = 'infinite';
                    bState.late_grace = clonedRaw.late_policy.grace_period_hours || 0;
                    bState.late_penalty = clonedRaw.late_policy.penalty_percentage || 0;
                } else {
                    bState.late_mode = 'infinite'; bState.late_grace = 0; bState.late_penalty = 0;
                }
                return;
            }

            bState.title = historyAssignment.title; 
            bState.description = historyAssignment.description;
            bState.due_date = historyAssignment.due_date; 
            bState.is_published = historyAssignment.is_published;
            
            let aRaw = historyAssignment.raw_data || {};
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
                return (tasksList || []).map(t => {
                    const cloned = { ...t, id: `task_${Date.now()}_${Math.random()}` };
                    delete cloned.resource_id;
                    if (!cloned.raw_data) cloned.raw_data = {};
                    
                    if (cloned.type === 'audio_record') {
                        if (cloned.raw_data.use_ai_grading === undefined) cloned.raw_data.use_ai_grading = true;
                        if (cloned.raw_data.use_ai_grammar === undefined) cloned.raw_data.use_ai_grammar = false;
                        if (cloned.raw_data.capture_studio === undefined) cloned.raw_data.capture_studio = true;
                        if (cloned.raw_data.capture_upload === undefined) cloned.raw_data.capture_upload = true;
                        if (cloned.raw_data.script_source === undefined) cloned.raw_data.script_source = 'meta';
                        if (cloned.raw_data.ai_source_type === undefined) cloned.raw_data.ai_source_type = 'text';
                        if (cloned.raw_data.student_source_type === undefined) cloned.raw_data.student_source_type = 'text';
                    }
                    if (cloned.type === 'group' && cloned.subTasks) cloned.subTasks = assignNewIdsRecursive(cloned.subTasks);
                    return cloned;
                });
            };
            bState.tasks = assignNewIdsRecursive(JSON.parse(JSON.stringify(historyAssignment.tasks || [])));
        }
    };
})();
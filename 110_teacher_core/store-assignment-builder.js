/**
 * 📂 檔案路徑：110_teacher_core/store-assignment-builder.js
 * 🌟 第三層 (State Store)：作業編輯器狀態管理大腦
 * 職責：管理記憶體內的 bState 樹狀結構、負責節點的增刪改查與 DOM 狀態同步。
 * 升級：實裝「無情淨化引擎」與「三位一體分離架構 (PDF / Excel分離寫入)」。
 */
window.BuilderStore = (() => {
    'use strict';
    
    let bState = null;

    // --- 🛡️ 內部私有輔助：無情淨化引擎 ---
    function sanitizeScript(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]*>?/gm, '') 
            .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) 
            .replace(/\u3000/g, ' ') 
            .replace(/[^\S\r\n]+/g, ' ') 
            .trim();
    }

    // --- 內部私有方法：DOM 狀態同步與樹狀走訪 ---
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

                // 🌟 新增：針對語音錄製任務，捕捉拆分後的三區塊資料
                if (t.type === 'audio_record') {
                    if (!t.raw_data) t.raw_data = {};
                    const scriptEl = document.getElementById(`node-script-${pathStr}`);
                    const matUrlEl = document.getElementById(`node-material-url-${pathStr}`);
                    const excelUrlEl = document.getElementById(`node-excel-url-${pathStr}`);
                    const excelSheetEl = document.getElementById(`node-excel-sheet-${pathStr}`);
                    const excelRangeEl = document.getElementById(`node-excel-range-${pathStr}`);
                    const useAiEl = document.getElementById(`node-use-ai-${pathStr}`); 
                    const useGrammarEl = document.getElementById(`node-use-grammar-${pathStr}`);
                    
                    if (scriptEl) {
                        t.raw_data.original_script = sanitizeScript(scriptEl.value); // 觸發淨化引擎
                    }
                    if (matUrlEl) t.raw_data.material_url = matUrlEl.value; // 學生 PDF 網址
                    if (excelUrlEl) t.raw_data.excel_source_url = excelUrlEl.value; // 教師 Excel 網址
                    if (excelSheetEl) t.raw_data.excel_sheet = excelSheetEl.value; // 教師 Excel 工作表
                    if (excelRangeEl) t.raw_data.excel_range = excelRangeEl.value; // 教師 Excel 範圍

                    if (useAiEl) t.raw_data.use_ai_grading = useAiEl.checked;
                    if (useGrammarEl) t.raw_data.use_ai_grammar = useGrammarEl.checked; 
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

    // --- 暴露的公開 API ---
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

        // --- 節點樹狀操作引擎 ---
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
                raw_data: type === 'audio_record' ? { use_ai_grading: true, use_ai_grammar: false } : {}, 
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
                    }
                    if (cloned.type === 'group' && cloned.subTasks) cloned.subTasks = assignNewIdsRecursive(cloned.subTasks);
                    return cloned;
                });
            };
            bState.tasks = assignNewIdsRecursive(JSON.parse(JSON.stringify(historyAssignment.tasks || [])));
        }
    };
})();
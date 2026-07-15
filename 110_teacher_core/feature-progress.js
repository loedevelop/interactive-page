/**
 * 📂 檔案路徑：110_teacher_core/feature-progress.js
 * 🌟 AST N階展開版：支援深度優先搜尋 (DFS) 展平子任務，完美支援無限嵌套結構
 */

window.FeatureProgress = (() => {
    
    // ==========================================
    // 壹、 離線同步佇列系統 (Sync Queue via IndexedDB)
    // ==========================================
    const DB_NAME = 'LogOn_OfflineDB';
    const STORE_NAME = 'ProgressQueue';
    let localDB = null;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = event => reject("IndexedDB 開啟失敗");
            request.onsuccess = event => { localDB = event.target.result; resolve(); };
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: ['task_id', 'student_id'] });
                }
            };
        });
    }

    async function enqueueTask(studentId, taskId, isCompleted) {
        if (!localDB) await initDB();
        return new Promise((resolve, reject) => {
            const tx = localDB.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const item = { 
                student_id: studentId, 
                task_id: taskId, 
                is_completed: isCompleted,
                status: 'pending',
                timestamp: new Date().getTime() 
            };
            store.put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function processQueue() {
        if (!navigator.onLine || !localDB) return;
        
        const tx = localDB.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = async () => {
            const pendingItems = request.result;
            if (pendingItems.length === 0) return;

            const syncIndicator = document.getElementById('sync-indicator');
            if(syncIndicator) syncIndicator.style.display = 'inline-block';

            for (const item of pendingItems) {
                try {
                    await window.ApiService.syncProgress(item.student_id, item.task_id, item.is_completed);
                    const deleteTx = localDB.transaction(STORE_NAME, 'readwrite');
                    deleteTx.objectStore(STORE_NAME).delete([item.task_id, item.student_id]);
                } catch (err) {
                    console.error("背景同步單筆失敗，將於下次重試:", err);
                }
            }

            if(syncIndicator) syncIndicator.style.display = 'none';
        };
    }

    initDB().then(() => {
        setInterval(processQueue, 5000);
        window.addEventListener('online', processQueue);
    });

    // ==========================================
    // 貳、 畫面渲染與 AST 展平比對邏輯 (AST Flatten & Rendering)
    // ==========================================
    
    async function fetchAndRenderReport(classId) {
        const container = document.getElementById('progress-report-container');
        if (!container) return;

        if (!classId) {
            container.innerHTML = '<div style="padding: 20px; color:#94A3B8;">請先選擇一個班級以檢視進度報表。</div>';
            return;
        }

        container.innerHTML = '<div style="padding: 40px; text-align:center; color: var(--primary); font-weight:800; font-size: 1.2rem;">⏳ 正在交叉比對全班進度資料，請稍候...</div>';

        try {
            const { data: enrollments, error: enrollError } = await window.supabaseClient
                .from('student_enrollments')
                .select(`
                    user_id,
                    profiles:user_id (id, name)
                `)
                .eq('class_id', classId)
                .is('deleted_at', null)
                .order('created_at', { ascending: true });
                
            if (enrollError) throw new Error('讀取選課名單失敗: ' + enrollError.message);

            const students = enrollments ? enrollments.map(e => e.profiles).filter(p => p !== null) : [];

            const { data: assignments, error: assignError } = await window.supabaseClient
                .from('assignments')
                .select('id, title, target_date, tasks')
                .eq('class_id', classId)
                .is('deleted_at', null)
                .order('target_date', { ascending: false });
            if (assignError) throw new Error('讀取作業清單失敗: ' + assignError.message);

            const { data: completions, error: compError } = await window.supabaseClient
                .from('task_completions')
                .select('student_id, task_id')
                .eq('class_id', classId);
            if (compError) throw new Error('讀取完成紀錄失敗: ' + compError.message);

            renderGrid(container, students, assignments || [], completions || [], classId);

        } catch (err) {
            console.error("報表產生失敗：", err);
            container.innerHTML = `<div style="padding: 20px; color:#EF4444; font-weight:800;">❌ 報表產生失敗：${err.message}</div>`;
        }
    }

    function renderGrid(container, students, assignments, completions, classId) {
        if (students.length === 0) {
            container.innerHTML = '<div style="padding: 20px; color:#94A3B8; font-weight:800;">目前班級內沒有有效學生，無法產生進度表。</div>';
            return;
        }

        // 🌟 遞迴穿透 AST，將 N 層群組內的實體任務攤平為一維陣列
        const getActionableTasks = (tasksList) => {
            let res = [];
            if (!tasksList) return res;
            tasksList.forEach(t => {
                if (t.type === 'group') {
                    res = res.concat(getActionableTasks(t.subTasks));
                } else {
                    res.push(t);
                }
            });
            return res;
        };

        const validAssignments = assignments.map(a => {
            return {
                ...a,
                actionableTasks: getActionableTasks(a.tasks || [])
            };
        }).filter(a => a.actionableTasks.length > 0);

        if (validAssignments.length === 0) {
            container.innerHTML = `
                <div style="background:white; padding: 40px; border-radius:12px; border:2px solid #E2E8F0; text-align:center;">
                    <span style="font-size:3rem; margin-bottom:10px; display:block;">📊</span>
                    <h3 style="color:var(--primary-dark); margin:0;">尚無可統計的進度</h3>
                    <p style="color:#64748B;">此班級目前沒有派發任何包含小項的作業。</p>
                </div>
            `;
            return;
        }

        let topHeaderHtml = '';
        let subHeaderHtml = '';
        let allTaskIds = [];

        validAssignments.forEach(a => {
            topHeaderHtml += `<th colspan="${a.actionableTasks.length}" style="border:1px solid #CBD5E1; padding:10px; background:#F8FAFC; color:var(--primary-dark); font-weight:900; text-align:center; min-width:150px;">📅 ${a.target_date}<br>${a.title}</th>`;
            
            a.actionableTasks.forEach((t, idx) => {
                allTaskIds.push(t.id);
                let shortTitle = t.title ? t.title.replace(/<[^>]*>?/gm, '') : '未命名';
                if(shortTitle.length > 15) shortTitle = shortTitle.substring(0, 15) + '...';
                subHeaderHtml += `<th style="border:1px solid #CBD5E1; padding:8px 10px; background:#F1F5F9; color:#475569; font-size:0.85rem; font-weight:800; white-space:nowrap; text-align:center;" title="${t.title}">${idx + 1}. ${shortTitle}</th>`;
            });
        });

        let tbodyHtml = '';
        students.forEach((std, sIndex) => {
            let stdDoneCount = 0;
            const totalTasks = allTaskIds.length;
            let rowHtml = '';
            
            allTaskIds.forEach(taskId => {
                const isDone = completions.some(c => c.student_id === std.id && c.task_id === taskId);
                if (isDone) {
                    stdDoneCount++;
                    rowHtml += `<td id="cell-${std.id}-${taskId}" onclick="window.FeatureProgress.toggleTask('${std.id}', '${taskId}')" style="cursor:pointer; border:1px solid #CBD5E1; text-align:center; font-size:1.2rem; background:#ECFDF5; user-select:none; transition:0.2s;" title="點擊取消">✅</td>`;
                } else {
                    rowHtml += `<td id="cell-${std.id}-${taskId}" onclick="window.FeatureProgress.toggleTask('${std.id}', '${taskId}')" style="cursor:pointer; border:1px solid #CBD5E1; text-align:center; color:#CBD5E1; font-size:0.8rem; background:#FFF; user-select:none; transition:0.2s;" title="點擊打勾">—</td>`;
                }
            });

            const percentage = totalTasks > 0 ? Math.round((stdDoneCount / totalTasks) * 100) : 0;
            let percentColor = percentage >= 80 ? '#10B981' : (percentage >= 50 ? '#F59E0B' : '#EF4444');

            tbodyHtml += `
                <tr>
                    <td style="border:1px solid #CBD5E1; padding:10px; background:white; position:sticky; left:0; z-index:2; font-weight:800; color:#1E293B; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">${sIndex + 1}. ${std.name}</td>
                    <td id="percent-${std.id}" data-done="${stdDoneCount}" data-total="${totalTasks}" style="border:1px solid #CBD5E1; padding:10px; background:white; position:sticky; left:120px; z-index:2; text-align:center; font-weight:900; color:${percentColor}; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">${percentage}%<br><span style="font-size:0.7rem; color:#94A3B8;">(${stdDoneCount}/${totalTasks})</span></td>
                    ${rowHtml}
                </tr>
            `;
        });

        const styleHtml = `
            <style>
                .progress-table-wrapper { overflow-x: auto; overflow-y: auto; max-height: 65vh; border-radius: 8px; border: 1px solid #CBD5E1; box-shadow: 0 4px 6px rgba(0,0,0,0.05); background: white; }
                .progress-table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: max-content; }
                .progress-table th { position: sticky; top: 0; z-index: 3; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                .progress-table th:nth-child(1) { position: sticky; left: 0; z-index: 4; width: 120px; }
                .progress-table th:nth-child(2) { position: sticky; left: 120px; z-index: 4; width: 80px; }
                .progress-table tbody tr:hover td { background: #F8FAFC !important; }
                .progress-table tbody td:nth-child(1), .progress-table tbody td:nth-child(2) { background: white; }
                .progress-table tbody tr:hover td:nth-child(1), .progress-table tbody tr:hover td:nth-child(2) { background: #F1F5F9; }
                .progress-table td:hover { filter: brightness(0.95); }
            </style>
        `;

        container.innerHTML = `
            ${styleHtml}
            <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #E2E8F0; margin-top: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap:wrap; gap:10px;">
                    <h3 style="margin: 0; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                        📈 班級進度總表
                        <span id="sync-indicator" style="display:none; font-size:0.8rem; background:#F59E0B; color:white; padding:2px 8px; border-radius:12px; margin-left:10px; animation: pulse 1.5s infinite;">同步中...</span>
                    </h3>
                    <div style="display:flex; gap:10px;">
                        <button class="btn btn-action" onclick="window.FeatureProgress.refresh('${classId}')" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1;">🔄 重新整理資料</button>
                    </div>
                </div>
                <div class="progress-table-wrapper">
                    <table class="progress-table">
                        <thead>
                            <tr>
                                <th rowspan="2" style="border:1px solid #CBD5E1; padding:10px; background:#F8FAFC; color:#1E293B;">學生姓名</th>
                                <th rowspan="2" style="border:1px solid #CBD5E1; padding:10px; background:#F8FAFC; color:#1E293B;">總達成率</th>
                                ${topHeaderHtml}
                            </tr>
                            <tr>${subHeaderHtml}</tr>
                        </thead>
                        <tbody>${tbodyHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ==========================================
    // 參、 互動式打勾與 Optimistic UI 邏輯
    // ==========================================
    
    function toggleTask(studentId, taskId) {
        const cell = document.getElementById(`cell-${studentId}-${taskId}`);
        const percentCell = document.getElementById(`percent-${studentId}`);
        if (!cell || !percentCell) return;

        const isCurrentlyDone = cell.innerText.includes('✅');
        const willBeDone = !isCurrentlyDone;

        if (willBeDone) {
            cell.innerText = '✅';
            cell.style.background = '#ECFDF5';
            cell.style.fontSize = '1.2rem';
            cell.title = '點擊取消';
        } else {
            cell.innerText = '—';
            cell.style.background = '#FFF';
            cell.style.fontSize = '0.8rem';
            cell.style.color = '#CBD5E1';
            cell.title = '點擊打勾';
        }

        let currentDone = parseInt(percentCell.getAttribute('data-done'));
        let total = parseInt(percentCell.getAttribute('data-total'));
        currentDone = willBeDone ? currentDone + 1 : currentDone - 1;
        percentCell.setAttribute('data-done', currentDone);
        
        const newPercentage = total > 0 ? Math.round((currentDone / total) * 100) : 0;
        let percentColor = newPercentage >= 80 ? '#10B981' : (newPercentage >= 50 ? '#F59E0B' : '#EF4444');
        
        percentCell.style.color = percentColor;
        percentCell.innerHTML = `${newPercentage}%<br><span style="font-size:0.7rem; color:#94A3B8;">(${currentDone}/${total})</span>`;

        enqueueTask(studentId, taskId, willBeDone).catch(err => {
            console.error("無法寫入本地佇列", err);
            window.ApiService.syncProgress(studentId, taskId, willBeDone).catch(e => console.error("同步失敗", e));
        });
    }

    return {
        renderProgressReport: (classId) => fetchAndRenderReport(classId),
        refresh: (classId) => fetchAndRenderReport(classId),
        toggleTask: toggleTask
    };
})();
/**
 * 📂 檔案路徑：110_teacher_core/feature-progress.js
 * 🌟 AST N階展開版：支援深度優先搜尋 (DFS) 展平子任務，完美支援無限嵌套結構
 * 🛠️ 修正版：修復 HTML Injection 破圖漏洞，解除字數截斷限制，支援完整文字自動換行。
 */

window.FeatureProgress = (() => {
    
    // ==========================================
    // 壹、 離線同步佇列系統 (Sync Queue via IndexedDB)
    // ==========================================
    const DB_NAME = 'LogOn_OfflineDB';
    const STORE_NAME = 'ProgressQueue';
    let localDB = null;
    /** 避免快速重抓／切班時，舊的 Phase2 覆寫新畫面 */
    let progressFetchSeq = 0;

    function initDB() {
        return new Promise((resolve, reject) => {
            // v2：鍵改為 [assignment_id, task_id, student_id]，與 student_task_progress 的
            // UNIQUE (assignment_id, task_id, student_id) 對齊；v1 舊佇列一律捨棄重建
            // （反正舊項目一直寫入不存在的表，從未真正同步成功過，捨棄無損失）
            const request = indexedDB.open(DB_NAME, 2);
            request.onerror = event => reject("IndexedDB 開啟失敗");
            request.onsuccess = event => { localDB = event.target.result; resolve(); };
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (db.objectStoreNames.contains(STORE_NAME)) {
                    db.deleteObjectStore(STORE_NAME);
                }
                db.createObjectStore(STORE_NAME, { keyPath: ['assignment_id', 'task_id', 'student_id'] });
            };
        });
    }

    async function enqueueTask(assignmentId, studentId, taskId, isCompleted) {
        if (!localDB) await initDB();
        return new Promise((resolve, reject) => {
            const tx = localDB.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const item = {
                assignment_id: assignmentId,
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
                    await window.ApiService.syncProgress(item.student_id, item.task_id, item.is_completed, item.assignment_id);
                    const deleteTx = localDB.transaction(STORE_NAME, 'readwrite');
                    deleteTx.objectStore(STORE_NAME).delete([item.assignment_id, item.task_id, item.student_id]);
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

        const seq = ++progressFetchSeq;
        try {
            // Phase 1：輕量並行（格子打勾不需要 raw_data；肥大 AI／quiz JSON 是主因）
            // 雷區：class_id=UUID；assignment_id 可能 BIGINT——查詢參數沿用 DB 原值，勿強轉 uuid
            // student_task_progress：無提交機制小項的手動打勾旗標，與 task_completions 是 OR 關係一起判定完成
            const [enrollRes, assignRes, compLightRes, manualRes] = await Promise.all([
                window.supabaseClient
                    .from('student_enrollments')
                    .select(`
                        user_id,
                        raw_data,
                        profiles:user_id (id, name)
                    `)
                    .eq('class_id', classId)
                    .is('deleted_at', null)
                    .order('created_at', { ascending: true }),
                window.supabaseClient
                    .from('assignments')
                    .select('id, title, target_date, due_date, tasks, is_published, class_id')
                    .eq('class_id', classId)
                    .is('deleted_at', null)
                    .order('target_date', { ascending: false }),
                window.supabaseClient
                    .from('task_completions')
                    .select('student_id, task_id, assignment_id, status, deleted_at, updated_at')
                    .eq('class_id', classId)
                    .is('deleted_at', null)
                    .neq('status', 'incomplete'),
                window.supabaseClient
                    .from('student_task_progress')
                    .select('assignment_id, task_id, student_id, is_completed')
                    .eq('class_id', classId)
            ]);

            if (enrollRes.error) throw new Error('讀取選課名單失敗: ' + enrollRes.error.message);
            if (assignRes.error) throw new Error('讀取作業清單失敗: ' + assignRes.error.message);
            if (compLightRes.error) throw new Error('讀取完成紀錄失敗: ' + compLightRes.error.message);
            if (manualRes.error) console.warn('[FeatureProgress] 讀取手動打勾旗標失敗，僅顯示真實提交狀態', manualRes.error);

            const enrollments = enrollRes.data;
            // 附掛 drive_folder_id（指向該生 01_Submissions），供音檔分割上傳等工具使用
            const students = enrollments
                ? enrollments.filter(e => e.profiles !== null).map(e => Object.assign({}, e.profiles, {
                    drive_folder_id: (e.raw_data && e.raw_data.drive_folder_id) || ''
                }))
                : [];

            const assignments = assignRes.data || [];
            const manualProgress = manualRes.data || [];
            if (seq !== progressFetchSeq) return;
            renderGrid(container, students, assignments, compLightRes.data || [], classId, { heavyReady: false }, manualProgress);

            // Phase 2：背景補 raw_data（AI 補批／音檔分割需要）
            const heavyRes = await window.supabaseClient
                .from('task_completions')
                .select('student_id, task_id, assignment_id, status, raw_data, deleted_at, updated_at')
                .eq('class_id', classId)
                .is('deleted_at', null)
                .neq('status', 'incomplete');
            if (seq !== progressFetchSeq) return;
            if (heavyRes.error) {
                console.warn('[FeatureProgress] 補載 raw_data 失敗', heavyRes.error);
                const slot = document.getElementById('progress-heavy-slot');
                if (slot) {
                    slot.innerHTML = '<div style="padding:12px; color:#B45309; font-weight:800;">⚠️ AI／音檔工具載入失敗，進度表仍可使用。可按重新整理重試。</div>';
                }
                return;
            }
            renderGrid(container, students, assignments, heavyRes.data || [], classId, { heavyReady: true }, manualProgress);

        } catch (err) {
            console.error("報表產生失敗：", err);
            container.innerHTML = `<div style="padding: 20px; color:#EF4444; font-weight:800;">❌ 報表產生失敗：${err.message}</div>`;
        }
    }

    function renderGrid(container, students, assignments, completions, classId, options, manualProgress) {
        options = options || {};
        const heavyReady = options.heavyReady !== false;
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

        const parseAssignTasks = (rawTasks) => {
            if (window.TaskScriptResolver && typeof window.TaskScriptResolver.parseTasks === 'function') {
                return window.TaskScriptResolver.parseTasks(rawTasks);
            }
            if (Array.isArray(rawTasks)) return rawTasks;
            if (typeof rawTasks === 'string') {
                try {
                    const parsed = JSON.parse(rawTasks);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (_e) {
                    return [];
                }
            }
            return [];
        };

        // O(1) 查表：避免每格都掃完整 completions（學生×任務×完成紀錄）
        // 鍵含 assignment_id：task.id 雖跨作業幾乎不撞號，但語意上仍應以 (assignment_id, task_id) 複合鍵比對，
        // 與側表一律用 (assignment_id, task_id) 當自然鍵的原則一致，不留隱性耦合風險
        const doneKeys = new Set();
        // 考試任務的分數：Phase 1（輕量）沒有 raw_data，此 Map 會是空的；Phase 2 補 raw_data 後
        // renderGrid 會整個重跑一次，到時才顯示分數。跟 doneKeys 同一輪 completions 建，不額外查詢。
        const examResultByKey = new Map();
        (completions || []).forEach(function (c) {
            if (!c || c.deleted_at) return;
            const key = String(c.assignment_id) + '\t' + String(c.student_id) + '\t' + String(c.task_id);
            doneKeys.add(key);
            const raw = c.raw_data;
            if (raw && raw.quiz_result && raw.quiz_result.total != null) {
                examResultByKey.set(key, raw.quiz_result);
            }
        });
        // 無提交機制的小項：老師手動打勾持久化在 student_task_progress，與真實提交是 OR 關係
        (manualProgress || []).forEach(function (m) {
            if (!m || !m.is_completed) return;
            doneKeys.add(String(m.assignment_id) + '\t' + String(m.student_id) + '\t' + String(m.task_id));
        });

        const validAssignments = assignments.map(a => {
            return {
                ...a,
                actionableTasks: getActionableTasks(parseAssignTasks(a.tasks))
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
            // 安全處理大區塊標題
            let safeGroupTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '未命名';
            // 作業區塊：提醒欄 + 各小項
            const colSpan = a.actionableTasks.length + 1;
            
            topHeaderHtml += `<th colspan="${colSpan}" style="border:1px solid #CBD5E1; padding:10px; background:#F8FAFC; color:var(--primary-dark); font-weight:900; text-align:center; min-width:150px; white-space:normal; word-break:break-word; line-height:1.4;">📅 ${a.target_date || ''}<br>${safeGroupTitle}</th>`;

            // 左側獨立提醒欄（點學生列 → 產出該生該作業提醒圖）
            subHeaderHtml += `<th class="progress-remind-col" style="border:1px solid #BFDBFE; padding:8px 6px; background:#EFF6FF; color:#1D4ED8; font-size:1.35rem; font-weight:800; text-align:center; min-width:56px; width:56px; line-height:1.2;" title="點學生列產出此作業提醒圖">📬</th>`;
            
            a.actionableTasks.forEach((t, idx) => {
                allTaskIds.push({ taskId: t.id, assignmentId: a.id });
                let cleanTitle = t.title ? t.title.replace(/<[^>]*>?/gm, '') : '未命名';
                let safeTitleAttr = cleanTitle.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                // 🌟 同一作業常見多個範圍文字幾乎相同的小項（例如錄音／考試都用同一段 pp. 範圍描述），
                // 標題前加類型圖示分辨，避免老師看表頭猜不出哪欄是哪個作業類型（見雷區 00-pitfall-index）
                const typeIcon = window.TaskScriptResolver ? window.TaskScriptResolver.getTaskTypeIcon(t.type) : '📁';

                subHeaderHtml += `<th style="border:1px solid #CBD5E1; padding:8px 10px; background:#F1F5F9; color:#475569; font-size:0.85rem; font-weight:800; white-space:normal; word-break:break-word; text-align:center; min-width:120px; max-width:200px; line-height:1.4;" title="${safeTitleAttr}">${idx + 1}. ${typeIcon} ${cleanTitle}</th>`;
            });
        });

        let tbodyHtml = '';
        students.forEach((std, sIndex) => {
            let stdDoneCount = 0;
            const totalTasks = allTaskIds.length;
            let rowHtml = '';

            validAssignments.forEach(a => {
                const safeAssignId = String(a.id).replace(/'/g, "\\'");
                const safeStudentId = String(std.id).replace(/'/g, "\\'");
                const safeName = String(std.name || '').replace(/"/g, '&quot;');
                rowHtml += `<td class="progress-remind-col" onclick="event.stopPropagation(); window.FeatureReminderImage.openSingle('${classId}', '${safeAssignId}', '${safeStudentId}')" style="border:1px solid #BFDBFE; text-align:center; background:#EFF6FF; color:#1D4ED8; font-size:1.35rem; padding:8px 6px; min-width:56px; width:56px; user-select:none; cursor:default;" title="產出 ${safeName} 此作業提醒圖">📬</td>`;

                a.actionableTasks.forEach(t => {
                    const key = String(a.id) + '\t' + String(std.id) + '\t' + String(t.id);
                    const isDone = doneKeys.has(key);
                    const cellId = `cell-${safeAssignId}-${std.id}-${t.id}`;
                    if (isDone) stdDoneCount++;

                    if (t.type === 'exam') {
                        // 考試：格子不是手動打勾，是「查看／批改考卷」入口（見 feature-exam-review.js）
                        const openCall = `window.FeatureExamReview && window.FeatureExamReview.openReview('${classId}', '${safeAssignId}', '${t.id}', '${safeStudentId}')`;
                        const qr = examResultByKey.get(key);
                        let cellContent = isDone ? '✅' : '—';
                        let scoreStyle = 'color:#CBD5E1; font-size:0.8rem;';
                        if (qr) {
                            const score = qr.score;
                            const color = score >= 80 ? '#10B981' : (score >= 50 ? '#F59E0B' : '#EF4444');
                            cellContent = score + '%';
                            scoreStyle = `color:${color}; font-size:1rem; font-weight:900;`;
                        } else if (isDone) {
                            scoreStyle = 'font-size:1.2rem;';
                        }
                        rowHtml += `<td id="${cellId}" onclick="${openCall}" style="cursor:pointer; border:1px solid #CBD5E1; text-align:center; background:${isDone ? '#ECFDF5' : '#FFF'}; user-select:none; transition:0.2s; ${scoreStyle}" title="點擊查看／批改考卷">${cellContent}</td>`;
                        return;
                    }

                    const toggleCall = `window.FeatureProgress.toggleTask('${safeAssignId}', '${safeStudentId}', '${t.id}')`;
                    if (isDone) {
                        rowHtml += `<td id="${cellId}" onclick="${toggleCall}" style="cursor:pointer; border:1px solid #CBD5E1; text-align:center; font-size:1.2rem; background:#ECFDF5; user-select:none; transition:0.2s;" title="點擊取消">✅</td>`;
                    } else {
                        rowHtml += `<td id="${cellId}" onclick="${toggleCall}" style="cursor:pointer; border:1px solid #CBD5E1; text-align:center; color:#CBD5E1; font-size:0.8rem; background:#FFF; user-select:none; transition:0.2s;" title="點擊打勾">—</td>`;
                    }
                });
            });

            const percentage = totalTasks > 0 ? Math.round((stdDoneCount / totalTasks) * 100) : 0;
            let percentColor = percentage >= 80 ? '#10B981' : (percentage >= 50 ? '#F59E0B' : '#EF4444');

            tbodyHtml += `
                <tr>
                    <td class="progress-sticky-name" title="${String(std.name || '').replace(/"/g, '&quot;')}" style="border:1px solid #CBD5E1; padding:10px; background:white; font-weight:800; color:#1E293B; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">${sIndex + 1}. ${std.name}</td>
                    <td class="progress-sticky-pct" id="percent-${std.id}" data-done="${stdDoneCount}" data-total="${totalTasks}" style="border:1px solid #CBD5E1; padding:10px; background:white; text-align:center; font-weight:900; color:${percentColor}; box-shadow: 2px 0 5px rgba(0,0,0,0.05);">${percentage}%<br><span style="font-size:0.7rem; color:#94A3B8;">(${stdDoneCount}/${totalTasks})</span></td>
                    ${rowHtml}
                </tr>
            `;
        });

        const styleHtml = `
            <style>
                .progress-table-wrapper { overflow-x: auto; overflow-y: auto; max-height: 65vh; border-radius: 8px; border: 1px solid #CBD5E1; box-shadow: 0 4px 6px rgba(0,0,0,0.05); background: white; }
                .progress-table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: max-content; }
                .progress-table thead tr:first-child th { position: sticky; top: 0; z-index: 3; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                .progress-table thead tr:nth-child(2) th { position: sticky; top: 52px; z-index: 3; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                /* 💣 雷區：左凍結欄（姓名／總達成率）必須「橫向＋縱向雙凍結」都蓋不住。
                   曾發生：下面 .progress-sticky-name/.progress-sticky-pct 想在 thead 內把
                   z-index 覆寫成 6，但選擇器只有 1 個型別選擇器（thead），specificity 反而輸給
                   上面「.progress-table thead tr:first-child th」（3 個型別選擇器），z-index
                   實際仍是 3、跟第二列的 📬 提醒欄／各作業表頭同分，DOM 順序較晚的提醒欄／
                   作業表頭就會蓋過總達成率。這裡用 !important 確保姓名／總達成率永遠最上層，
                   不要再移除或只靠選擇器數 class 賭 specificity。 */
                .progress-table .progress-sticky-name {
                    position: sticky; left: 0; z-index: 20 !important;
                    min-width: 120px; width: 120px; max-width: 120px; background: #F8FAFC;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .progress-table .progress-sticky-pct {
                    position: sticky; left: 120px; z-index: 20 !important;
                    min-width: 92px; width: 92px; background: #F8FAFC;
                }
                .progress-table thead .progress-sticky-name,
                .progress-table thead .progress-sticky-pct { background: #F8FAFC; }
                .progress-table tbody .progress-sticky-name,
                .progress-table tbody .progress-sticky-pct { background: white; }
                .progress-table tbody tr:hover td { background: #F8FAFC !important; }
                .progress-table tbody tr:hover .progress-sticky-name,
                .progress-table tbody tr:hover .progress-sticky-pct { background: #F1F5F9 !important; }
                .progress-table tbody tr:hover .progress-remind-col { background: #DBEAFE !important; }
                .progress-table td:hover { filter: brightness(0.95); }
                .progress-table .progress-remind-col { filter: none !important; }
            </style>
        `;

        let backfillHtml = '';
        let audioSplitEntryHtml = '';
        if (heavyReady) {
            backfillHtml = (window.FeatureAIBackfill && typeof window.FeatureAIBackfill.renderPanel === 'function')
                ? window.FeatureAIBackfill.renderPanel(classId, validAssignments, completions, students)
                : '';
            audioSplitEntryHtml = (window.FeatureAudioSplitUpload && typeof window.FeatureAudioSplitUpload.renderEntryButton === 'function')
                ? window.FeatureAudioSplitUpload.renderEntryButton(classId, validAssignments, completions, students)
                : '';
        } else {
            backfillHtml = '<div id="progress-heavy-slot" style="margin-top:12px; padding:14px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; color:#92400E; font-weight:800;">⏳ 進度表已就緒，正在載入 AI 補批／音檔工具…</div>';
        }

        const classMeta = (window.TeacherDB && Array.isArray(window.TeacherDB.classes))
            ? window.TeacherDB.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        const className = classMeta ? (classMeta.name || classMeta.class_name || '') : '';
        const examJobEntryHtml = (window.FeatureExamJob && typeof window.FeatureExamJob.renderEntryButton === 'function')
            ? window.FeatureExamJob.renderEntryButton(classId, validAssignments, className)
            : '';
        const hasExamTask = validAssignments.some(function (a) {
            return a.actionableTasks.some(function (t) { return t.type === 'exam'; });
        });
        const examReviewEntryHtml = (hasExamTask && window.FeatureExamReview && typeof window.FeatureExamReview.renderEntryButton === 'function')
            ? window.FeatureExamReview.renderEntryButton(classId)
            : '';

        container.innerHTML = `
            ${styleHtml}
            <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #E2E8F0; margin-top: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap:wrap; gap:10px;">
                    <h3 style="margin: 0; color: var(--primary-dark); display: flex; align-items: center; gap: 8px;">
                        📈 班級進度總表
                        <span id="sync-indicator" style="display:none; font-size:0.8rem; background:#F59E0B; color:white; padding:2px 8px; border-radius:12px; margin-left:10px; animation: pulse 1.5s infinite;">同步中...</span>
                    </h3>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <button type="button" id="btn-open-class-reminders" class="btn btn-action" onclick="window.FeatureReminderImage.openPopup('${classId}')" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-weight:800;">📬 家長提醒圖</button>
                        ${examJobEntryHtml}
                        ${examReviewEntryHtml}
                        ${audioSplitEntryHtml}
                        <button class="btn btn-action" onclick="window.FeatureProgress.refresh('${classId}')" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1;">🔄 重新整理資料</button>
                    </div>
                </div>
                <div class="progress-table-wrapper">
                    <table class="progress-table">
                        <thead>
                            <tr>
                                <th rowspan="2" class="progress-sticky-name" style="border:1px solid #CBD5E1; padding:10px; background:#F8FAFC; color:#1E293B;">學生姓名</th>
                                <th rowspan="2" class="progress-sticky-pct" style="border:1px solid #CBD5E1; padding:10px; background:#F8FAFC; color:#1E293B;">總達成率</th>
                                ${topHeaderHtml}
                            </tr>
                            <tr>${subHeaderHtml}</tr>
                        </thead>
                        <tbody>${tbodyHtml}</tbody>
                    </table>
                </div>
            </div>
            ${backfillHtml}
        `;

        if (window.FeatureReminderImage && typeof window.FeatureReminderImage.refreshEntryBadge === 'function') {
            window.FeatureReminderImage.refreshEntryBadge(classId);
        }
    }

    // ==========================================
    // 參、 互動式打勾與 Optimistic UI 邏輯
    // ==========================================
    
    function toggleTask(assignmentId, studentId, taskId) {
        const cell = document.getElementById(`cell-${assignmentId}-${studentId}-${taskId}`);
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

        enqueueTask(assignmentId, studentId, taskId, willBeDone).catch(err => {
            console.error("無法寫入本地佇列", err);
            window.ApiService.syncProgress(studentId, taskId, willBeDone, assignmentId).catch(e => console.error("同步失敗", e));
        });
    }

    return {
        renderProgressReport: (classId) => fetchAndRenderReport(classId),
        refresh: (classId) => fetchAndRenderReport(classId),
        toggleTask: toggleTask
    };
})();
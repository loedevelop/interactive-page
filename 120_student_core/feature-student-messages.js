/**
 * 📂 120_student_core/feature-student-messages.js
 * 學生端訊息活頁：到期／過期提醒；點擊整則導向作業
 */
window.FeatureStudentMessages = (() => {
    /** 優先用即時作業／班級設定；舊訊息 payload 常缺 allow_late */
    function resolveAllowLate(row, progressCtx) {
        const meta = progressCtx && progressCtx.allowLateByAssignment
            ? progressCtx.allowLateByAssignment[row.assignment_id]
            : null;
        if (typeof meta === 'boolean') return meta;

        if (row.payload && typeof row.payload.allow_late === 'boolean') {
            return row.payload.allow_late;
        }
        return false;
    }

    function formatKindBadge(kind, row, progressCtx) {
        if (kind === 'due_soon') {
            return '<span style="background:#FEF3C7;color:#B45309;border:1px solid #FDE68A;padding:2px 8px;border-radius:999px;font-size:1rem;font-weight:700;">即將到期</span>';
        }
        if (kind === 'overdue_late') {
            const allowLate = resolveAllowLate(row, progressCtx);
            const leftBadge = allowLate
                ? '<span style="background:#FEF3C7;color:#B45309;border:1px solid #FDE68A;padding:2px 8px;border-radius:999px;font-size:1rem;font-weight:700;">提醒補交</span>'
                : '<span style="background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA;padding:2px 8px;border-radius:999px;font-size:1rem;font-weight:700;">缺交</span>';
            const rightBadge = '<span style="background:#F1F5F9;color:#475569;border:1px solid #CBD5E1;padding:2px 8px;border-radius:999px;font-size:1rem;font-weight:700;">已過截止日</span>';
            return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${leftBadge}${rightBadge}</div>`;
        }
        return '';
    }

    function formatTime(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        } catch (_e) {
            return String(iso);
        }
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function countLeafTasks(tasksList) {
        let total = 0;
        if (!Array.isArray(tasksList)) return 0;
        tasksList.forEach(function (t) {
            if (t && t.type === 'group') {
                total += countLeafTasks(t.subTasks);
            } else if (t) {
                total += 1;
            }
        });
        return total;
    }

    function countDoneTasks(tasksList, assignmentId, completedSet) {
        let done = 0;
        if (!Array.isArray(tasksList)) return 0;
        tasksList.forEach(function (t) {
            if (t && t.type === 'group') {
                done += countDoneTasks(t.subTasks, assignmentId, completedSet);
            } else if (t && completedSet.has(assignmentId + '_' + t.id)) {
                done += 1;
            }
        });
        return done;
    }

    function getProgressForRow(row, progressCtx) {
        const assignmentId = row.assignment_id;
        if (!assignmentId || !progressCtx) return null;
        const tasks = progressCtx.assignmentTasks[assignmentId];
        if (!tasks) return null;
        const total = countLeafTasks(tasks);
        const done = countDoneTasks(tasks, assignmentId, progressCtx.completedSet);
        return { done: done, total: total };
    }

    /** 標題優先用 payload 三行；進度放在截止日期右邊 */
    function renderTitleBlock(row, progressCtx) {
        const p = row.payload || {};
        const progress = getProgressForRow(row, progressCtx);
        const progressInline = progress
            ? ` <span style="font-weight:700;color:#475569;">目前完成進度 ${progress.done} / ${progress.total}</span>`
            : '';
        const lineStyle = 'font-weight:700;color:#334155;font-size:1rem;line-height:1.5;';

        if (p.class_name || p.progress_label || p.block_label) {
            return `
                <div style="${lineStyle}">
                    📚 ${escapeHtml(p.class_name || '')}
                </div>
                <div style="${lineStyle}margin-top:4px;">
                    ${escapeHtml(p.progress_label || '')}
                </div>
                <div style="${lineStyle}margin-top:4px;">
                    📝 ${escapeHtml(p.block_label || p.assignment_title || '')}${progressInline}
                </div>`;
        }
        return `<div style="${lineStyle}white-space:pre-wrap;">${escapeHtml(row.title || '通知')}</div>`;
    }

    function getDueDateKey(row) {
        const fromPayload = row.payload && row.payload.due_date;
        if (fromPayload) return String(fromPayload);
        // 從 block_label「（截止 YYYY-MM-DD）」兜底
        const block = (row.payload && row.payload.block_label) || row.title || '';
        const m = String(block).match(/截止\s*(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
    }

    function sortRowsByDueDateDesc(rows) {
        return (rows || []).slice().sort(function (a, b) {
            const da = getDueDateKey(a);
            const db = getDueDateKey(b);
            if (da && db && da !== db) return db.localeCompare(da); // 新到舊
            if (da && !db) return -1;
            if (!da && db) return 1;
            // 同截止日：通知時間新到舊
            return String(b.created_at || '').localeCompare(String(a.created_at || ''));
        });
    }

    async function fetchMessages() {
        if (!window.supabaseClient) throw new Error('系統連線尚未準備完成');
        const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
        if (authErr || !user) throw new Error('授權無效或已登出');

        const { data, error } = await window.supabaseClient
            .from('user_notifications')
            .select('id, kind, title, body, payload, read_at, created_at, class_id, assignment_id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        return { rows: data || [], userId: user.id };
    }

    async function fetchProgressContext(rows, userId) {
        const assignmentIds = [...new Set(
            (rows || []).map(function (r) { return r.assignment_id; }).filter(Boolean)
        )];
        const classIds = [...new Set(
            (rows || []).map(function (r) { return r.class_id; }).filter(Boolean)
        )];
        if (!assignmentIds.length) {
            return { assignmentTasks: {}, completedSet: new Set(), allowLateByAssignment: {} };
        }

        const [assignRes, compRes, classRes] = await Promise.all([
            window.supabaseClient
                .from('assignments')
                .select('id, class_id, tasks, raw_data')
                .in('id', assignmentIds),
            window.supabaseClient
                .from('task_completions')
                .select('assignment_id, task_id')
                .eq('student_id', userId)
                .in('assignment_id', assignmentIds)
                .is('deleted_at', null),
            classIds.length
                ? window.supabaseClient
                    .from('classes')
                    .select('id, raw_data')
                    .in('id', classIds)
                : Promise.resolve({ data: [] })
        ]);

        const classAllowLate = {};
        (classRes.data || []).forEach(function (c) {
            let raw = c.raw_data || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
            }
            const defaults = raw.late_submission_defaults || {};
            classAllowLate[c.id] = defaults.allow_late === true;
        });

        const assignmentTasks = {};
        const allowLateByAssignment = {};
        (assignRes.data || []).forEach(function (a) {
            assignmentTasks[a.id] = a.tasks || [];
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') {
                try { aRaw = JSON.parse(aRaw); } catch (_e) { aRaw = {}; }
            }
            // 作業有明確 late_policy 就用作業；否則退回班級預設
            if (aRaw.late_policy && typeof aRaw.late_policy === 'object') {
                allowLateByAssignment[a.id] = aRaw.late_policy.allow_late === true;
            } else if (typeof aRaw.allow_late === 'boolean') {
                allowLateByAssignment[a.id] = aRaw.allow_late === true;
            } else {
                allowLateByAssignment[a.id] = classAllowLate[a.class_id] === true;
            }
        });

        const completedSet = new Set(
            (compRes.data || []).map(function (c) {
                return c.assignment_id + '_' + c.task_id;
            })
        );

        return {
            assignmentTasks: assignmentTasks,
            completedSet: completedSet,
            allowLateByAssignment: allowLateByAssignment
        };
    }

    function renderList(rows, progressCtx) {
        const box = document.getElementById('student-messages-container');
        if (!box) return;

        if (!rows.length) {
            box.innerHTML = `
                <div class="card" style="padding:24px;">
                    <h3 style="margin-top:0;font-size:1.15rem;font-weight:900;color:#334155;">📬 訊息</h3>
                    <p style="color:#64748B;font-weight:600;font-size:1rem;">目前沒有提醒訊息。</p>
                </div>`;
            return;
        }

        const sortedRows = sortRowsByDueDateDesc(rows);
        const unread = sortedRows.filter(function (r) { return !r.read_at; }).length;
        const items = sortedRows.map(function (row) {
            const unreadBar = row.read_at
                ? ''
                : '<div style="position:absolute;top:0;left:0;right:0;height:4px;background:#F59E0B;border-radius:10px 10px 0 0;"></div>';
            return `
                <button type="button"
                    class="student-msg-item"
                    data-msg-id="${row.id}"
                    data-assignment-id="${row.assignment_id || ''}"
                    data-class-id="${row.class_id || ''}"
                    style="display:block;width:100%;text-align:left;position:relative;overflow:hidden;border:2px solid #E2E8F0;background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;cursor:pointer;font-family:inherit;font-size:1rem;">
                    ${unreadBar}
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
                        <div style="flex:1;min-width:200px;">
                            ${renderTitleBlock(row, progressCtx)}
                        </div>
                        ${formatKindBadge(row.kind, row, progressCtx)}
                    </div>
                    <div style="font-size:1rem;color:#64748B;margin-top:10px;font-weight:700;">通知時間：${formatTime(row.created_at)}</div>
                </button>`;
        }).join('');

        box.innerHTML = `
            <div class="card" style="padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
                    <h3 style="margin:0;font-size:1.15rem;font-weight:900;color:#334155;">📬 訊息 ${unread ? `<span style="font-size:0.95rem;color:#B45309;font-weight:800;">（${unread} 則未讀）</span>` : ''}</h3>
                    <button type="button" id="btn-refresh-student-messages" class="btn-profile" style="padding:6px 12px;font-size:0.9rem;">重新整理</button>
                </div>
                ${items}
            </div>`;

        const refreshBtn = document.getElementById('btn-refresh-student-messages');
        if (refreshBtn) {
            refreshBtn.onclick = function () { render(); };
        }

        box.querySelectorAll('.student-msg-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openMessage(btn.getAttribute('data-msg-id'), btn.getAttribute('data-assignment-id'), btn.getAttribute('data-class-id'));
            });
        });
    }

    async function markRead(msgId) {
        if (!msgId || !window.supabaseClient) return;
        await window.supabaseClient
            .from('user_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', msgId)
            .is('read_at', null);
    }

    async function openMessage(msgId, assignmentId, classId) {
        try {
            await markRead(msgId);

            if (classId && sessionStorage.getItem('currentClassId') !== classId) {
                sessionStorage.setItem('currentClassId', classId);
                const sessionData = JSON.parse(localStorage.getItem('LogOnEnglish_Session') || '{}');
                if (sessionData.id && window.PersonaRouting) {
                    const lastKey = window.PersonaRouting.getLastClassKey(sessionData.id, 'student');
                    localStorage.setItem(lastKey, classId);
                }
                sessionStorage.setItem('pendingJumpAssignmentId', String(assignmentId || ''));
                window.location.reload();
                return;
            }

            const progressTab = document.querySelector('.tab-link[data-view="progress"]')
                || Array.from(document.querySelectorAll('.tab-link')).find(function (el) {
                    return (el.textContent || '').indexOf('課程進度') !== -1;
                });

            if (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.switchView === 'function' && progressTab) {
                window.FeatureStudentTimeline.switchView('progress', progressTab);
            }

            if (assignmentId && window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.jumpToAssignment === 'function') {
                setTimeout(function () {
                    window.FeatureStudentTimeline.jumpToAssignment(assignmentId);
                }, 200);
            }

            render();
        } catch (err) {
            console.error(err);
            if (window.showFlash) window.showFlash('開啟訊息失敗：' + err.message, 'error');
        }
    }

    async function render() {
        const box = document.getElementById('student-messages-container');
        if (!box) return;
        box.innerHTML = '<div class="card" style="padding:20px;color:#64748B;font-weight:700;font-size:1rem;">⏳ 載入訊息中…</div>';
        try {
            const { rows, userId } = await fetchMessages();
            const progressCtx = await fetchProgressContext(rows, userId);
            renderList(rows, progressCtx);
            updateTabBadge(rows);
        } catch (err) {
            console.error(err);
            box.innerHTML = `<div class="card" style="padding:20px;color:#B91C1C;font-weight:700;font-size:1rem;">載入失敗：${escapeHtml(err.message || err)}</div>`;
        }
    }

    function updateTabBadge(rows) {
        const tab = document.getElementById('tab-student-messages');
        if (!tab) return;
        const unread = (rows || []).filter(function (r) { return !r.read_at; }).length;
        const base = '📬 訊息';
        tab.textContent = unread > 0 ? `${base} (${unread})` : base;
    }

    async function refreshBadgeOnly() {
        try {
            const { rows } = await fetchMessages();
            updateTabBadge(rows);
        } catch (_e) {}
    }

    return {
        render,
        refreshBadgeOnly,
        openMessage
    };
})();

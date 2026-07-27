/**
 * 📂 120_student_core/feature-student-messages.js
 * 學生端訊息活頁：到期提醒／可遲交已過期，點擊導向作業
 */
window.FeatureStudentMessages = (() => {
    let loaded = false;

    function formatKindBadge(kind) {
        if (kind === 'due_soon') {
            return '<span style="background:#FEF3C7;color:#B45309;border:1px solid #FDE68A;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:800;">即將到期</span>';
        }
        if (kind === 'overdue_late') {
            return '<span style="background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:800;">可遲交催繳</span>';
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
        return data || [];
    }

    function renderList(rows) {
        const box = document.getElementById('student-messages-container');
        if (!box) return;

        if (!rows.length) {
            box.innerHTML = `
                <div class="card" style="padding:24px;">
                    <h3 style="margin-top:0;">📬 訊息</h3>
                    <p style="color:#64748B;font-weight:600;">目前沒有提醒訊息。</p>
                </div>`;
            return;
        }

        const unread = rows.filter(function (r) { return !r.read_at; }).length;
        const items = rows.map(function (row) {
            const unreadDot = row.read_at
                ? ''
                : '<span style="width:8px;height:8px;border-radius:50%;background:#F59E0B;display:inline-block;margin-right:6px;"></span>';
            const title = String(row.title || '通知').replace(/</g, '&lt;');
            const preview = String(row.body || '').replace(/</g, '&lt;').slice(0, 160);
            return `
                <button type="button"
                    class="student-msg-item"
                    data-msg-id="${row.id}"
                    data-assignment-id="${row.assignment_id || ''}"
                    data-class-id="${row.class_id || ''}"
                    style="display:block;width:100%;text-align:left;border:2px solid #E2E8F0;background:${row.read_at ? '#fff' : '#FFFBEB'};border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;">
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
                        <div style="font-weight:900;color:#334155;">${unreadDot}${title}</div>
                        ${formatKindBadge(row.kind)}
                    </div>
                    <div style="font-size:0.8rem;color:#94A3B8;margin-top:4px;">${formatTime(row.created_at)}</div>
                    <div style="font-size:0.9rem;color:#64748B;margin-top:8px;white-space:pre-wrap;line-height:1.45;">${preview}${preview.length >= 160 ? '…' : ''}</div>
                    <div style="font-size:0.8rem;color:#2563EB;font-weight:800;margin-top:8px;">點此前往作業 →</div>
                </button>`;
        }).join('');

        box.innerHTML = `
            <div class="card" style="padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
                    <h3 style="margin:0;">📬 訊息 ${unread ? `<span style="font-size:0.85rem;color:#B45309;">（${unread} 則未讀）</span>` : ''}</h3>
                    <button type="button" id="btn-refresh-student-messages" class="btn-profile" style="padding:6px 12px;">重新整理</button>
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
        box.innerHTML = '<div class="card" style="padding:20px;color:#64748B;font-weight:700;">⏳ 載入訊息中…</div>';
        try {
            const rows = await fetchMessages();
            renderList(rows);
            loaded = true;
            updateTabBadge(rows);
        } catch (err) {
            console.error(err);
            box.innerHTML = `<div class="card" style="padding:20px;color:#B91C1C;font-weight:700;">載入失敗：${String(err.message || err)}</div>`;
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
            const rows = await fetchMessages();
            updateTabBadge(rows);
        } catch (_e) {}
    }

    return {
        render,
        refreshBadgeOnly,
        openMessage
    };
})();

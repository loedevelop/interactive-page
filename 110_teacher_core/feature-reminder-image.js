/**
 * 📂 110_teacher_core/feature-reminder-image.js
 * 老師端：彙整全部班級的家長提醒 PNG（右鍵複製貼至 LINE）
 */
window.FeatureReminderImage = (() => {
    const OVERLAY_ID = 'reminder-image-modal';
    const RENDER_HOST_ID = 'reminder-image-render-host';
    const LIST_ID = 'reminder-image-list';
    const STATUS_ID = 'reminder-image-status';

    function stripHtml(s) {
        return String(s || '').replace(/<[^>]*>?/gm, '').trim();
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseRaw(raw) {
        if (typeof raw === 'string') {
            try { return JSON.parse(raw); } catch (_e) { return {}; }
        }
        return raw || {};
    }

    function collectTaskRows(tasks, depth, out) {
        if (!Array.isArray(tasks)) return;
        tasks.forEach(function (t) {
            if (!t) return;
            if (t.type === 'group') {
                out.push({ kind: 'group', title: stripHtml(t.title) || '未命名群組', depth: depth });
                collectTaskRows(t.subTasks, depth + 1, out);
            } else {
                out.push({ kind: 'task', id: t.id, title: stripHtml(t.title) || '未命名', depth: depth });
            }
        });
    }

    function countLeafTasks(tasks) {
        let n = 0;
        if (!Array.isArray(tasks)) return 0;
        tasks.forEach(function (t) {
            if (t && t.type === 'group') n += countLeafTasks(t.subTasks);
            else if (t) n += 1;
        });
        return n;
    }

    function countDoneForStudent(tasks, assignId, studentId, doneSet) {
        let done = 0;
        if (!Array.isArray(tasks)) return 0;
        tasks.forEach(function (t) {
            if (t && t.type === 'group') {
                done += countDoneForStudent(t.subTasks, assignId, studentId, doneSet);
            } else if (t && doneSet.has(studentId + '_' + assignId + '_' + t.id)) {
                done += 1;
            }
        });
        return done;
    }

    async function resolveGlobalProfNameMode() {
        let mode = 'default';
        try {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (user) {
                const { data: profData } = await window.supabaseClient
                    .from('profiles')
                    .select('raw_data')
                    .eq('id', user.id)
                    .maybeSingle();
                mode = profData?.raw_data?.preferred_name_mode || 'default';
            }
        } catch (_e) { /* 沿用預設 */ }
        return mode;
    }

    function resolveNameModeForClass(classRaw, globalProfMode) {
        const classMode = classRaw?.name_display_mode || 'default';
        if (classMode !== 'default') return classMode;
        if (globalProfMode !== 'default') return globalProfMode;
        return 'en_first';
    }

    function displayNameFromProfile(profile, effectiveMode) {
        if (window.ProfileForm && typeof window.ProfileForm.calculateDisplayName === 'function') {
            return window.ProfileForm.calculateDisplayName(profile.raw_data || profile, effectiveMode);
        }
        return profile.name || '未命名';
    }

    function getAllClasses() {
        const db = window.TeacherDB;
        if (!db || !Array.isArray(db.classes)) return [];
        return db.classes.slice();
    }

    function getPublishedAssignments(classId) {
        const db = window.TeacherDB;
        if (!db || !Array.isArray(db.assignments)) return [];
        return db.assignments.filter(function (a) {
            return a.class_id === classId
                && a.is_published
                && countLeafTasks(a.tasks || []) > 0;
        });
    }

    async function fetchStudentsByClass(classIds, nameModeByClassId) {
        if (!classIds.length) return {};

        const { data: rawStudents, error } = await window.supabaseClient
            .from('student_enrollments')
            .select('class_id, user_id, profiles(*)')
            .in('class_id', classIds)
            .is('deleted_at', null);
        if (error) throw new Error('讀取學生名單失敗：' + error.message);

        const map = {};
        classIds.forEach(function (id) { map[id] = []; });

        (rawStudents || []).forEach(function (s) {
            const p = Array.isArray(s.profiles) ? s.profiles[0] : (s.profiles || {});
            const mode = nameModeByClassId[s.class_id] || 'en_first';
            map[s.class_id].push({
                id: s.user_id,
                name: displayNameFromProfile(p, mode)
            });
        });

        Object.keys(map).forEach(function (cid) {
            map[cid].sort(function (a, b) {
                return a.name.localeCompare(b.name, 'zh-Hant');
            });
        });
        return map;
    }

    async function fetchGlobalDoneSet(classIds) {
        if (!classIds.length) return new Set();

        const { data: completions, error } = await window.supabaseClient
            .from('task_completions')
            .select('student_id, task_id, assignment_id')
            .in('class_id', classIds)
            .is('deleted_at', null);
        if (error) throw new Error('讀取完成紀錄失敗：' + error.message);

        const set = new Set();
        (completions || []).forEach(function (c) {
            set.add(c.student_id + '_' + c.assignment_id + '_' + c.task_id);
        });
        return set;
    }

    async function buildAllReminderItems() {
        const classes = getAllClasses();
        const classIds = classes.map(function (c) { return c.id; });
        if (!classIds.length) return { items: [], classCount: 0, doneSet: new Set() };

        const globalProfMode = await resolveGlobalProfNameMode();
        const nameModeByClassId = {};
        classes.forEach(function (cls) {
            const raw = parseRaw(cls.raw_data || cls.rawData);
            nameModeByClassId[cls.id] = resolveNameModeForClass(raw, globalProfMode);
        });

        const [studentsByClass, doneSet] = await Promise.all([
            fetchStudentsByClass(classIds, nameModeByClassId),
            fetchGlobalDoneSet(classIds)
        ]);

        let items = [];
        classes.forEach(function (cls) {
            const className = cls.name || cls.title || '未命名班級';
            const students = studentsByClass[cls.id] || [];
            const assignments = getPublishedAssignments(cls.id);

            assignments.forEach(function (assignment) {
                const dueDate = assignment.due_date || '未設定';
                students.forEach(function (student) {
                    items.push({
                        student: student,
                        assignment: assignment,
                        className: className,
                        dueDate: dueDate
                    });
                });
            });
        });

        items.sort(function (a, b) {
            const da = a.assignment.due_date || a.assignment.target_date || '';
            const dbd = b.assignment.due_date || b.assignment.target_date || '';
            if (da !== dbd) return dbd.localeCompare(da);
            const ca = a.className.localeCompare(b.className, 'zh-Hant');
            if (ca !== 0) return ca;
            return a.student.name.localeCompare(b.student.name, 'zh-Hant');
        });

        return { items: items, classCount: classes.length, doneSet: doneSet };
    }

    function buildCardHtml(student, assignment, className, dueDate, doneSet) {
        const assignId = assignment.id;
        const lineStyle = 'font-weight:700;color:#334155;font-size:16px;line-height:1.5;';
        const taskRows = [];
        collectTaskRows(assignment.tasks || [], 0, taskRows);
        const total = countLeafTasks(assignment.tasks || []);
        const done = countDoneForStudent(assignment.tasks || [], assignId, student.id, doneSet);
        const assignTitle = stripHtml(assignment.title) || '未命名作業';
        const dueText = dueDate || '未設定';
        const progressHtml = '<span style="font-weight:700;color:#475569;">完成進度 ' + done + ' / ' + total + '</span>';

        let tasksHtml = '';
        if (taskRows.length === 0) {
            tasksHtml = '<div style="color:#94A3B8;font-size:16px;">（此作業尚無細項）</div>';
        } else {
            taskRows.forEach(function (row) {
                if (row.kind === 'group') {
                    const pad = row.depth * 14;
                    tasksHtml += '<div style="margin-top:6px;margin-left:' + pad + 'px;font-weight:800;color:#475569;font-size:16px;">🗂️ ' + escapeHtml(row.title) + '</div>';
                    return;
                }
                const isDone = doneSet.has(student.id + '_' + assignId + '_' + row.id);
                const icon = isDone ? '✅' : '⬜';
                const pad = row.depth * 14;
                const color = isDone ? '#065F46' : '#334155';
                tasksHtml += '<div style="display:flex;align-items:flex-start;gap:8px;margin-top:4px;margin-left:' + pad + 'px;font-size:16px;line-height:1.45;color:' + color + ';">'
                    + '<span style="flex-shrink:0;">' + icon + '</span>'
                    + '<span>' + escapeHtml(row.title) + '</span>'
                    + '</div>';
            });
        }

        return ''
            + '<div class="reminder-card-root" style="width:560px;background:#FFFFFF;border-radius:12px;border:2px solid #E2E8F0;padding:20px 22px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft JhengHei\',sans-serif;box-sizing:border-box;">'
            + '<div style="' + lineStyle + '">📚 ' + escapeHtml(className) + '</div>'
            + '<div style="' + lineStyle + 'margin-top:4px;">👤 ' + escapeHtml(student.name) + '</div>'
            + '<div style="' + lineStyle + 'margin-top:4px;">📝 ' + escapeHtml(assignTitle) + '</div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:16px;font-weight:700;color:#475569;">'
            + '<span>⏰ 截止日：<span style="color:#B45309;">' + escapeHtml(dueText) + '</span></span>'
            + progressHtml
            + '</div>'
            + '<div style="border-top:2px dashed #E2E8F0;padding-top:12px;margin-top:12px;">'
            + '<div style="font-size:16px;font-weight:800;color:#64748B;margin-bottom:6px;">作業細項</div>'
            + tasksHtml
            + '</div>'
            + '</div>';
    }

    function ensureRenderHost() {
        let host = document.getElementById(RENDER_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = RENDER_HOST_ID;
            host.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;opacity:0;';
            document.body.appendChild(host);
        }
        return host;
    }

    async function cardToDataUrl(cardHtml) {
        if (typeof html2canvas !== 'function') {
            throw new Error('html2canvas 尚未載入，請重新整理頁面。');
        }
        const host = ensureRenderHost();
        host.innerHTML = cardHtml;
        const el = host.querySelector('.reminder-card-root');
        if (!el) throw new Error('無法建立提醒卡片');

        await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });

        const canvas = await html2canvas(el, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#FFFFFF',
            logging: false
        });
        host.innerHTML = '';
        return canvas.toDataURL('image/png');
    }

    function closeModal() {
        const el = document.getElementById(OVERLAY_ID);
        if (el) el.remove();
        const host = document.getElementById(RENDER_HOST_ID);
        if (host) host.innerHTML = '';
    }

    function buildShellHtml(classCount, total) {
        return ''
            + '<div style="background:white;padding:24px;border-radius:14px;width:95%;max-width:720px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,0.25);">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;border-bottom:2px solid #F1F5F9;padding-bottom:12px;flex-shrink:0;">'
            + '<div>'
            + '<h3 style="margin:0;color:#334155;font-size:1.15rem;font-weight:900;">📬 家長提醒圖</h3>'
            + '<p style="margin:6px 0 0;color:#64748B;font-size:0.95rem;font-weight:600;">'
            + '全部班級（' + classCount + ' 班）— 共 ' + total + ' 則。右鍵圖片 → <strong>複製圖片</strong>，貼至 LINE 家長群</p>'
            + '<p id="' + STATUS_ID + '" style="margin:4px 0 0;color:#B45309;font-size:0.9rem;font-weight:700;"></p>'
            + '</div>'
            + '<button type="button" onclick="window.FeatureReminderImage.closeModal()" style="border:none;background:#F1F5F9;color:#475569;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:800;flex-shrink:0;">✕ 關閉</button>'
            + '</div>'
            + '<div id="' + LIST_ID + '" style="overflow-y:auto;flex:1;padding-right:4px;"></div>'
            + '</div>';
    }

    function setStatus(text) {
        const el = document.getElementById(STATUS_ID);
        if (el) el.textContent = text || '';
    }

    function renderEmptyList(message) {
        const list = document.getElementById(LIST_ID);
        if (!list) return;
        list.innerHTML = '<div style="padding:32px 16px;text-align:center;color:#64748B;font-weight:700;font-size:1rem;">' + escapeHtml(message) + '</div>';
    }

    function renderLoading() {
        const list = document.getElementById(LIST_ID);
        if (!list) return;
        list.innerHTML = '<div style="padding:40px 16px;text-align:center;color:#64748B;font-weight:700;font-size:1rem;">⏳ 載入並產生提醒圖中…</div>';
    }

    function appendImageItem(dataUrl, caption) {
        const list = document.getElementById(LIST_ID);
        if (!list) return;

        const wrap = document.createElement('div');
        wrap.className = 'reminder-img-item';
        wrap.style.cssText = 'border:2px solid #E2E8F0;border-radius:12px;padding:16px;margin-bottom:14px;background:#fff;';
        wrap.innerHTML = ''
            + '<img src="' + dataUrl + '" alt="' + escapeHtml(caption) + '" draggable="true" '
            + 'style="width:100%;max-width:560px;display:block;border-radius:8px;border:1px solid #E2E8F0;cursor:context-menu;" />'
            + '<div style="font-size:0.85rem;color:#94A3B8;margin-top:8px;font-weight:600;">' + escapeHtml(caption) + ' · 右鍵圖片 → 複製圖片</div>';
        list.appendChild(wrap);
    }

    async function openPopup() {
        closeModal();

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;justify-content:center;align-items:center;z-index:10000;backdrop-filter:blur(2px);padding:16px;';
        overlay.innerHTML = '<div style="color:#64748B;font-weight:800;padding:40px;background:white;border-radius:12px;">⏳ 載入全部班級資料中…</div>';
        document.body.appendChild(overlay);

        try {
            const { items, classCount, doneSet } = await buildAllReminderItems();

            overlay.innerHTML = buildShellHtml(classCount, items.length);
            renderLoading();

            if (items.length === 0) {
                setStatus('');
                renderEmptyList('目前沒有可提醒的作業（需已發佈且含作業細項）。');
                return;
            }

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                setStatus('產生中 ' + (i + 1) + ' / ' + items.length + '…');

                const cardHtml = buildCardHtml(
                    item.student,
                    item.assignment,
                    item.className,
                    item.dueDate,
                    doneSet
                );
                const dataUrl = await cardToDataUrl(cardHtml);
                const caption = item.className + ' · ' + item.student.name + ' · '
                    + (stripHtml(item.assignment.title) || '作業') + ' · 截止 ' + item.dueDate;

                if (i === 0) {
                    const list = document.getElementById(LIST_ID);
                    if (list) list.innerHTML = '';
                }
                appendImageItem(dataUrl, caption);
            }

            setStatus('已全部產生完成');
        } catch (err) {
            closeModal();
            if (window.showFlash) window.showFlash(err.message, 'error');
        }
    }

    return {
        openPopup: openPopup,
        closeModal: closeModal
    };
})();

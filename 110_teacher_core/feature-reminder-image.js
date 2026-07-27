/**
 * 📂 110_teacher_core/feature-reminder-image.js
 * 老師端：彙整全部班級的家長提醒 PNG（右鍵複製貼至 LINE）
 */
window.FeatureReminderImage = (() => {
    const OVERLAY_ID = 'reminder-image-modal';
    const RENDER_HOST_ID = 'reminder-image-render-host';
    const LIST_ID = 'reminder-image-list';
    const STATUS_ID = 'reminder-image-status';
    const SUMMARY_ID = 'reminder-image-summary';
    const READ_STORAGE_PREFIX = 'TeacherReminderRead_';

    let sessionUserId = null;
    let sessionReadMap = null;

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

    function getItemKey(item) {
        return (item.kind || 'due_soon') + '_' + item.student.id + '_' + item.assignment.id;
    }

    function loadReadMap(userId) {
        if (!userId) return {};
        try {
            const raw = localStorage.getItem(READ_STORAGE_PREFIX + userId);
            return raw ? JSON.parse(raw) : {};
        } catch (_e) {
            return {};
        }
    }

    function saveReadMap(userId, map) {
        if (!userId) return;
        try {
            localStorage.setItem(READ_STORAGE_PREFIX + userId, JSON.stringify(map));
        } catch (_e) { /* 忽略容量錯誤 */ }
    }

    function isItemRead(readMap, itemKey) {
        return !!(readMap && readMap[itemKey]);
    }

    function countUnread(items, readMap) {
        if (!items.length) return 0;
        return items.filter(function (item) {
            return !isItemRead(readMap, getItemKey(item));
        }).length;
    }

    async function getCurrentUserId() {
        if (!window.supabaseClient) return null;
        try {
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            return user ? user.id : null;
        } catch (_e) {
            return null;
        }
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

    /** 僅取英文名字（不含姓） */
    function englishFirstNameFromProfile(profile) {
        const raw = parseRaw(profile.raw_data);
        const en = String(raw.nameEN || '').trim();
        if (en) return en;
        const fallback = displayNameFromProfile(profile, 'en_first');
        return String(fallback || '同學').split(/\s+/)[0] || '同學';
    }

    /** 台灣今日 YYYY-MM-DD */
    function getTaiwanTodayStr() {
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Taipei',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(new Date());
        } catch (_e) {
            const d = new Date();
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
    }

    /** 台灣今日加減天數 YYYY-MM-DD */
    function getTaiwanDateOffsetStr(offsetDays) {
        const today = getTaiwanTodayStr();
        const parts = today.split('-').map(Number);
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        dt.setDate(dt.getDate() + (offsetDays || 0));
        return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    }

    /** 截止日前兩日（與 scan_due_reminders 的 due_soon 一致） */
    function getDueSoonDateStr() {
        return getTaiwanDateOffsetStr(2);
    }

    /** 截止日翌日＝第一則補交提醒日 */
    function getOverdueFirstDateStr() {
        return getTaiwanDateOffsetStr(-1);
    }

    function resolveAllowLate(assignment, classRaw) {
        const aRaw = parseRaw(assignment.raw_data || assignment.rawData);
        if (aRaw.late_policy && typeof aRaw.late_policy === 'object') {
            return aRaw.late_policy.allow_late === true;
        }
        if (typeof aRaw.allow_late === 'boolean') return aRaw.allow_late;
        const defaults = (classRaw && classRaw.late_submission_defaults) || {};
        return defaults.allow_late === true;
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
                && a.due_date
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
                name: displayNameFromProfile(p, mode),
                englishFirstName: englishFirstNameFromProfile(p)
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
            .select('student_id, task_id, assignment_id, status')
            .in('class_id', classIds)
            .is('deleted_at', null)
            .neq('status', 'incomplete');
        if (error) throw new Error('讀取完成紀錄失敗：' + error.message);

        const set = new Set();
        (completions || []).forEach(function (c) {
            set.add(c.student_id + '_' + c.assignment_id + '_' + c.task_id);
        });
        return set;
    }

    async function buildAllReminderItems(filterClassId) {
        let classes = getAllClasses();
        if (filterClassId) {
            classes = classes.filter(function (c) { return String(c.id) === String(filterClassId); });
        }
        const classIds = classes.map(function (c) { return c.id; });
        if (!classIds.length) return { items: [], classCount: 0, doneSet: new Set(), scopeLabel: '' };

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

        const todayStr = getTaiwanTodayStr();
        const dueSoonDate = getDueSoonDateStr();
        const overdueFirstDate = getOverdueFirstDateStr(); // 昨日＝過期當天提醒日
        let items = [];

        classes.forEach(function (cls) {
            const className = cls.name || cls.title || '未命名班級';
            const classRaw = parseRaw(cls.raw_data || cls.rawData);
            const students = studentsByClass[cls.id] || [];
            const assignments = getPublishedAssignments(cls.id);
            // 同班今天是否有「將到」作業（作為舊補交第二波的觸發錨點）
            const hasDueSoonToday = assignments.some(function (a) {
                return a.due_date === dueSoonDate;
            });

            assignments.forEach(function (assignment) {
                const dueDate = assignment.due_date;
                if (!dueDate) return;
                const allowLate = resolveAllowLate(assignment, classRaw);

                students.forEach(function (student) {
                    const total = countLeafTasks(assignment.tasks || []);
                    const done = countDoneForStudent(assignment.tasks || [], assignment.id, student.id, doneSet);
                    if (total > 0 && done >= total) return;

                    let kind = null;
                    if (dueDate === dueSoonDate) {
                        kind = 'due_soon';
                    } else if (allowLate && dueDate < todayStr) {
                        // 第一波：截止日翌日；第二波：同班有將到作業的日子
                        if (dueDate === overdueFirstDate || hasDueSoonToday) {
                            kind = 'makeup';
                        }
                    }
                    if (!kind) return;

                    items.push({
                        kind: kind,
                        student: student,
                        assignment: assignment,
                        className: className,
                        dueDate: dueDate
                    });
                });
            });
        });

        items.sort(function (a, b) {
            // 將到在前，補交在後；同類型依截止日新→舊
            if (a.kind !== b.kind) {
                if (a.kind === 'due_soon') return -1;
                if (b.kind === 'due_soon') return 1;
            }
            const da = a.dueDate || '';
            const dbd = b.dueDate || '';
            if (da !== dbd) return dbd.localeCompare(da);
            const ca = a.className.localeCompare(b.className, 'zh-Hant');
            if (ca !== 0) return ca;
            return a.student.name.localeCompare(b.student.name, 'zh-Hant');
        });

        const scopeLabel = filterClassId
            ? (classes[0] ? (classes[0].name || classes[0].title || '本班') : '本班')
            : '';

        return {
            items: items,
            classCount: classes.length,
            doneSet: doneSet,
            dueSoonDate: dueSoonDate,
            scopeLabel: scopeLabel,
            filterClassId: filterClassId || null
        };
    }

    function buildCardHtml(student, assignment, dueDate, doneSet, kind, className) {
        const assignId = assignment.id;
        const lineStyle = 'font-weight:700;color:#334155;font-size:16px;line-height:1.5;';
        const titleStyle = 'font-weight:900;color:#334155;font-size:18px;line-height:1.5;';
        const taskRows = [];
        collectTaskRows(assignment.tasks || [], 0, taskRows);
        const total = countLeafTasks(assignment.tasks || []);
        const done = countDoneForStudent(assignment.tasks || [], assignId, student.id, doneSet);
        const assignTitle = stripHtml(assignment.title) || '未命名作業';
        const clsName = stripHtml(className) || '未命名班級';
        const dueText = dueDate && String(dueDate).trim() ? String(dueDate).trim() : '未設定';
        const firstName = student.englishFirstName || String(student.name || '同學').split(/\s+/)[0] || '同學';
        const progressHtml = '<span style="font-weight:700;color:#475569;">目前完成進度 ' + done + ' / ' + total + '</span>';
        const headline = kind === 'makeup'
            ? ('⏰ 溫馨提醒 ' + escapeHtml(firstName) + ' 記得補交哦！')
            : (kind === 'due_soon'
                ? ('⏰ 溫馨提醒 ' + escapeHtml(firstName) + ' 還有兩天哦！')
                : ('⏰ 溫馨提醒 ' + escapeHtml(firstName) + ' 請記得完成哦！'));

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

        // 與群體提醒同一版型：左截止日、右進度（單則／灰色地帶也一律如此）
        const dueRow = ''
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:16px;font-weight:700;color:#475569;">'
            + '<span>⏰ 截止日：<span style="color:#B45309;">' + escapeHtml(dueText) + '</span></span>'
            + progressHtml
            + '</div>';

        return ''
            + '<div class="reminder-card-root" style="width:560px;background:#FFFFFF;border-radius:12px;border:2px solid #E2E8F0;padding:20px 22px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft JhengHei\',sans-serif;box-sizing:border-box;">'
            + '<div style="' + titleStyle + '">' + headline + '</div>'
            + '<div style="' + lineStyle + 'margin-top:4px;">📝 ' + escapeHtml(clsName) + ' ' + escapeHtml(assignTitle) + '</div>'
            + dueRow
            + '<div style="border-top:2px dashed #E2E8F0;padding-top:12px;margin-top:12px;">'
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

    function cleanupModalState() {
        const host = document.getElementById(RENDER_HOST_ID);
        if (host) host.innerHTML = '';
        sessionUserId = null;
        sessionReadMap = null;
        window._reminderPopupMeta = null;
        refreshEntryBadge();
    }

    function closeModal() {
        if (window.ModalOverlay) {
            window.ModalOverlay.close(OVERLAY_ID);
            return;
        }
        const el = document.getElementById(OVERLAY_ID);
        if (el) el.remove();
        cleanupModalState();
    }

    function openOverlayShell(contentHtml) {
        if (!window.ModalOverlay) {
            if (window.showFlash) window.showFlash('ModalOverlay 未載入，無法開啟提醒圖', 'error');
            return null;
        }
        window.ModalOverlay.open({
            id: OVERLAY_ID,
            tier: 'A',
            contentHtml: contentHtml,
            onClose: cleanupModalState
        });
        return document.getElementById(OVERLAY_ID);
    }

    function buildSummaryText(classCount, total, unread, scopeLabel) {
        let text = scopeLabel
            ? ('本班「' + escapeHtml(scopeLabel) + '」— 將到／補交共 ' + total + ' 則')
            : ('全部班級（' + classCount + ' 班）— 將到／補交共 ' + total + ' 則');
        if (unread > 0) {
            text += '，<span style="color:#B45309;font-weight:800;">' + unread + ' 則未讀</span>';
        }
        text += '。';
        return text;
    }

    function updatePopupSummary(classCount, total, unread, scopeLabel) {
        const el = document.getElementById(SUMMARY_ID);
        if (el) el.innerHTML = buildSummaryText(classCount, total, unread, scopeLabel);
    }

    function buildShellHtml(classCount, total, unread, scopeLabel) {
        return ''
            + '<div style="background:white;padding:24px;border-radius:14px;width:min(720px,95vw);max-width:720px;min-width:min(720px,95vw);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,0.25);cursor:default;box-sizing:border-box;">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;border-bottom:2px solid #F1F5F9;padding-bottom:12px;flex-shrink:0;">'
            + '<div>'
            + '<h3 style="margin:0;color:#334155;font-size:1.15rem;font-weight:900;">📬 家長提醒圖</h3>'
            + '<p id="' + SUMMARY_ID + '" style="margin:6px 0 0;color:#64748B;font-size:0.95rem;font-weight:600;">'
            + buildSummaryText(classCount, total, unread, scopeLabel) + '</p>'
            + '<p style="margin:8px 0 0;color:#475569;font-size:0.9rem;font-weight:600;line-height:1.5;">'
            + '頂部橘色線＝未讀。請<strong>點圖片</strong>標記已讀；<strong>右鍵圖片 → 複製圖片</strong>，貼至 LINE 家長群。'
            + '</p>'
            + '<p id="' + STATUS_ID + '" style="margin:4px 0 0;color:#B45309;font-size:0.9rem;font-weight:700;"></p>'
            + '</div>'
            + '<button type="button" onclick="window.FeatureReminderImage.closeModal()" style="border:none;background:#F1F5F9;color:#475569;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:800;flex-shrink:0;">✕ 關閉</button>'
            + '</div>'
            + '<div id="' + LIST_ID + '" style="overflow-y:auto;flex:1;padding-right:4px;cursor:default;width:100%;"></div>'
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

    function markItemReadDom(wrap) {
        if (!wrap || wrap.dataset.read === '1') return;
        wrap.dataset.read = '1';
        const bar = wrap.querySelector('.reminder-unread-bar');
        if (bar) bar.remove();
    }

    function markItemRead(itemKey) {
        if (!sessionUserId || !itemKey) return;
        if (!sessionReadMap) sessionReadMap = loadReadMap(sessionUserId);
        if (sessionReadMap[itemKey]) return;

        sessionReadMap[itemKey] = new Date().toISOString();
        saveReadMap(sessionUserId, sessionReadMap);

        const wrap = document.querySelector('.reminder-img-item[data-item-key="' + itemKey + '"]');
        markItemReadDom(wrap);

        if (window._reminderPopupMeta) {
            const meta = window._reminderPopupMeta;
            const unread = countUnread(meta.items, sessionReadMap);
            updatePopupSummary(meta.classCount, meta.items.length, unread, meta.scopeLabel);
        }
        refreshEntryBadge(window._reminderPopupMeta && window._reminderPopupMeta.filterClassId);
    }

    function appendImageItem(dataUrl, itemKey, isRead) {
        const list = document.getElementById(LIST_ID);
        if (!list) return;

        const wrap = document.createElement('div');
        wrap.className = 'reminder-img-item';
        wrap.dataset.itemKey = itemKey;
        wrap.dataset.read = isRead ? '1' : '0';
        wrap.style.cssText = 'margin-bottom:18px;background:transparent;cursor:default;';

        const frame = document.createElement('div');
        frame.className = 'reminder-img-frame';
        frame.style.cssText = 'position:relative;display:inline-block;width:560px;max-width:100%;line-height:0;cursor:default;box-sizing:border-box;';

        if (!isRead) {
            const bar = document.createElement('div');
            bar.className = 'reminder-unread-bar';
            bar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:4px;background:#F59E0B;border-radius:12px 12px 0 0;z-index:1;pointer-events:none;';
            frame.appendChild(bar);
        }

        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = '家長提醒圖';
        img.draggable = true;
        img.style.cssText = 'width:560px;max-width:100%;display:block;border-radius:12px;cursor:default;';
        // 唯有圖片區可點選標記已讀（不含周圍空白）
        img.addEventListener('click', function (e) {
            e.stopPropagation();
            markItemRead(itemKey);
        });

        frame.appendChild(img);
        wrap.appendChild(frame);
        list.appendChild(wrap);
    }

    function updateEntryButton(unread, total, filterClassId) {
        const btnId = filterClassId ? 'btn-open-class-reminders' : 'btn-open-all-reminders';
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const base = filterClassId ? '📬 家長提醒圖' : '開啟全部提醒';
        if (total > 0 && unread > 0) {
            btn.textContent = base + '（' + unread + ' 則未讀）';
        } else {
            btn.textContent = base;
        }
    }

    async function refreshEntryBadge(filterClassId) {
        try {
            const userId = await getCurrentUserId();
            if (!userId || !window.TeacherDB) {
                updateEntryButton(0, 0, filterClassId || null);
                updateEntryButton(0, 0, null);
                return;
            }
            // 全域入口
            const all = await buildAllReminderItems();
            const readMap = loadReadMap(userId);
            updateEntryButton(countUnread(all.items, readMap), all.items.length, null);

            // 本班入口（進度總表）
            const classId = filterClassId
                || (window.TeacherUI && typeof window.TeacherUI.getCurrentClassId === 'function'
                    ? window.TeacherUI.getCurrentClassId()
                    : null);
            if (classId) {
                const one = await buildAllReminderItems(classId);
                updateEntryButton(countUnread(one.items, readMap), one.items.length, classId);
            }
        } catch (_e) {
            updateEntryButton(0, 0, filterClassId || null);
        }
    }

    async function openPopup(classId) {
        closeModal();
        sessionUserId = null;
        sessionReadMap = null;

        const overlay = openOverlayShell(
            '<div style="color:#64748B;font-weight:800;padding:40px;background:white;border-radius:12px;">⏳ 載入提醒資料中…</div>'
        );
        if (!overlay) return;

        try {
            sessionUserId = await getCurrentUserId();
            sessionReadMap = loadReadMap(sessionUserId);

            const { items, classCount, doneSet, scopeLabel, filterClassId } = await buildAllReminderItems(classId || null);
            const unread = countUnread(items, sessionReadMap);

            window._reminderPopupMeta = {
                items: items,
                classCount: classCount,
                scopeLabel: scopeLabel,
                filterClassId: filterClassId
            };

            overlay.innerHTML = buildShellHtml(classCount, items.length, unread, scopeLabel);
            renderLoading();

            if (items.length === 0) {
                setStatus('');
                renderEmptyList('目前沒有「將到（截止前兩天）」或「提醒補交」的未完成項目。');
                refreshEntryBadge(filterClassId);
                return;
            }

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemKey = getItemKey(item);
                setStatus('產生中 ' + (i + 1) + ' / ' + items.length + '…');

                const cardHtml = buildCardHtml(
                    item.student,
                    item.assignment,
                    item.dueDate,
                    doneSet,
                    item.kind,
                    item.className
                );
                const dataUrl = await cardToDataUrl(cardHtml);

                if (i === 0) {
                    const list = document.getElementById(LIST_ID);
                    if (list) list.innerHTML = '';
                }
                appendImageItem(dataUrl, itemKey, isItemRead(sessionReadMap, itemKey));
            }

            setStatus('已全部產生完成');
            refreshEntryBadge(filterClassId);
        } catch (err) {
            closeModal();
            if (window.showFlash) window.showFlash(err.message, 'error');
        }
    }

    async function openSingle(classId, assignmentId, studentId) {
        if (!classId || !assignmentId || !studentId) {
            if (window.showFlash) window.showFlash('缺少班級／作業／學生資料', 'error');
            return;
        }

        closeModal();
        sessionUserId = null;
        sessionReadMap = null;

        const overlay = openOverlayShell(
            '<div style="color:#64748B;font-weight:800;padding:40px;background:white;border-radius:12px;">⏳ 產生提醒圖中…</div>'
        );
        if (!overlay) return;

        try {
            sessionUserId = await getCurrentUserId();
            sessionReadMap = loadReadMap(sessionUserId);

            const cls = getAllClasses().find(function (c) { return String(c.id) === String(classId); });
            const className = cls ? (cls.name || cls.title || '未命名班級') : '未命名班級';
            const classRaw = parseRaw(cls && (cls.raw_data || cls.rawData));

            // 單則一律向 DB 拉完整作業（避免 TeacherDB 快取缺 due_date 造成版面與群體不一致）
            let assignment = null;
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient
                    .from('assignments')
                    .select('id, title, due_date, target_date, tasks, raw_data, class_id, is_published')
                    .eq('id', assignmentId)
                    .maybeSingle();
                if (error) throw new Error(error.message);
                assignment = data;
            }
            if (!assignment) {
                const db = window.TeacherDB;
                if (db && Array.isArray(db.assignments)) {
                    assignment = db.assignments.find(function (a) {
                        return String(a.id) === String(assignmentId);
                    }) || null;
                }
            }
            if (!assignment) throw new Error('找不到作業資料');

            const effectiveMode = await resolveGlobalProfNameMode().then(function (globalMode) {
                return resolveNameModeForClass(classRaw, globalMode);
            });

            const { data: enroll, error: enrollErr } = await window.supabaseClient
                .from('student_enrollments')
                .select('user_id, profiles(*)')
                .eq('class_id', classId)
                .eq('user_id', studentId)
                .is('deleted_at', null)
                .maybeSingle();
            if (enrollErr) throw new Error(enrollErr.message);

            const p = enroll && enroll.profiles
                ? (Array.isArray(enroll.profiles) ? enroll.profiles[0] : enroll.profiles)
                : {};
            const student = {
                id: studentId,
                name: displayNameFromProfile(p, effectiveMode),
                englishFirstName: englishFirstNameFromProfile(p)
            };

            const doneSet = await fetchGlobalDoneSet([classId]);
            // 與群體同一欄位優先序：due_date；缺則退 target_date
            const dueDate = assignment.due_date || assignment.target_date || '';
            const todayStr = getTaiwanTodayStr();
            const dueSoonDate = getDueSoonDateStr();

            let kind = 'manual';
            if (dueDate && dueDate < todayStr) {
                kind = 'makeup';
            } else if (dueDate && dueDate === dueSoonDate) {
                kind = 'due_soon';
            }

            const item = {
                kind: kind,
                student: student,
                assignment: assignment,
                className: className,
                dueDate: dueDate || '未設定'
            };
            const itemKey = 'single_' + getItemKey(item);
            const unread = isItemRead(sessionReadMap, itemKey) ? 0 : 1;

            window._reminderPopupMeta = {
                items: [item],
                classCount: 1,
                scopeLabel: className + '（單則）',
                filterClassId: classId
            };

            overlay.innerHTML = buildShellHtml(1, 1, unread, className + '（單則）');
            const list = document.getElementById(LIST_ID);
            if (list) list.innerHTML = '';

            const cardHtml = buildCardHtml(
                student,
                assignment,
                item.dueDate,
                doneSet,
                kind,
                className
            );
            const dataUrl = await cardToDataUrl(cardHtml);
            appendImageItem(dataUrl, itemKey, isItemRead(sessionReadMap, itemKey));
            setStatus('');
            refreshEntryBadge(classId);
        } catch (err) {
            closeModal();
            if (window.showFlash) window.showFlash(err.message, 'error');
        }
    }

    window.addEventListener('DOMContentLoaded', function () {
        setTimeout(refreshEntryBadge, 800);
    });

    return {
        openPopup: openPopup,
        openSingle: openSingle,
        closeModal: closeModal,
        refreshEntryBadge: refreshEntryBadge,
        markItemRead: markItemRead
    };
})();

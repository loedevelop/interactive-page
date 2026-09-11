/**
 * 📂 110_teacher_core/feature-exam-review.js
 * 🎯 職責：老師端「考試批改」——查看學生考卷作答、標示對錯、調整標準答案／分數
 *
 * 💣 雷區（見 .cursor/rules/quiz-accepted-answers-invariant.mdc）：
 * 可接受答案寫進這題教材列（全站）＋這份卷快照；送分／不計分只寫這份卷。
 * 存檔時一律用 QuizPaperBuilder.regradeCompletionRawData 重新算分，不要手動兜分。
 */
window.FeatureExamReview = (function () {
    'use strict';

    const MODAL_ID = 'exam-review-modal';
    const PAGE_MODAL_ID = 'exam-review-page-modal';
    const WHOLE_CLASS_REGRADE_BTN_STYLE = 'padding:6px 12px; border:1px solid #0EA5E9; border-radius:6px; background:white; color:#0369A1; font-weight:800; cursor:pointer; line-height:1.2; text-align:center;';
    const WHOLE_CLASS_REGRADE_BTN_HTML = '<span style="display:block;">重新批閱</span><span style="display:block; font-size:0.82em; font-weight:700;">整個班級</span>';
    /** 重畫後要停在哪一列（qr-row-N／appeal-group-N）。用完即清。 */
    let keepScrollElId = '';

    /**
     * 考試批改所有 popup 共用：innerHTML 重畫不准把捲軸送回第一筆。
     * 單生卷、申訴審查、同一 overlay 之後再加的畫面，都走這條。
     */
    function patchOverlayKeepScroll(overlayId, contentHtml) {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return false;
        const inner = overlay.querySelector('[data-exam-review-scroll]');
        const overlayTop = overlay.scrollTop;
        const innerTop = inner ? inner.scrollTop : 0;
        overlay.innerHTML = contentHtml;
        overlay.scrollTop = overlayTop;
        const innerAfter = overlay.querySelector('[data-exam-review-scroll]');
        if (innerAfter) innerAfter.scrollTop = innerTop;
        const keepId = keepScrollElId;
        keepScrollElId = '';
        if (keepId) {
            const row = document.getElementById(keepId);
            if (row && typeof row.scrollIntoView === 'function') {
                row.scrollIntoView({ block: 'nearest' });
            }
        }
        return true;
    }

    /** @type {any} 目前開著的單生考卷檢視狀態；關閉時清空 */
    let state = null;

    function esc(s) {
        return (window.QuizPaperBuilder && window.QuizPaperBuilder.escHtml)
            ? window.QuizPaperBuilder.escHtml(s)
            : String(s == null ? '' : s);
    }

    function escAttr(s) {
        return esc(s).replace(/'/g, '&#39;');
    }

    /** 任務標題若從 contenteditable 帶進 span，顯示時去掉標籤，不要把 HTML 當正文。 */
    function plainTitle(s) {
        return String(s == null ? '' : s).replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
    }

    function displayTaskTitle(s) {
        return esc(plainTitle(s) || '(未命名考試)');
    }

    function gotPlainOf(item) {
        const raw = state && state.answers ? state.answers[item.item_id] : '';
        return window.QuizPaperBuilder.plainQuizAnswer
            ? window.QuizPaperBuilder.plainQuizAnswer(raw, item)
            : (typeof raw === 'string' ? raw : '');
    }

    /** 學生這筆已經對上主答案 → 不是「也算對」，不畫那格勾選。 */
    function gotMatchesPrimary(item) {
        const gotPlain = gotPlainOf(item);
        if (!String(gotPlain).trim()) return false;
        const Q = window.QuizPaperBuilder;
        if (!Q || typeof Q.normalizeAnswer !== 'function' || typeof Q.isAcceptableAnswer !== 'function') {
            return String(gotPlain) === String((item && item.answer_en) || '');
        }
        const gotN = Q.normalizeAnswer(gotPlain);
        const primaryN = Q.normalizeAnswer(item && item.answer_en);
        if (!gotN || !primaryN) return false;
        return Q.isAcceptableAnswer(gotN, [primaryN]);
    }

    function alignedPairHtml(expected, gotPlain, expectedDiffColor) {
        if (!gotPlain) return '';
        const diff = window.QuizPaperBuilder.analyzeAnswerDiff(expected || '', gotPlain);
        if (typeof window.QuizPaperBuilder.renderAlignedPairHtml === 'function') {
            return window.QuizPaperBuilder.renderAlignedPairHtml((diff && diff.ops) || [], {
                expectedDiffColor: expectedDiffColor || '#DC2626'
            });
        }
        return window.QuizPaperBuilder.renderAnswerDiffHtml((diff && diff.ops) || []);
    }

    function normAns(text) {
        const Q = window.QuizPaperBuilder;
        if (Q && typeof Q.normalizeAnswer === 'function') return Q.normalizeAnswer(text);
        return String(text == null ? '' : text).trim();
    }

    function studentMatchesWriting(studentPlain, writing) {
        const Q = window.QuizPaperBuilder;
        const gotN = normAns(studentPlain);
        const expN = normAns(writing);
        if (!gotN || !expN) return false;
        if (Q && typeof Q.isAcceptableAnswer === 'function') return Q.isAcceptableAnswer(gotN, [expN]);
        return gotN === expN;
    }

    /** 對上了＝正確時的顯示：上下都黑，不再當錯字對照。 */
    function correctPairHtml(gotPlain, writing) {
        return '<span style="display:inline-flex; flex-direction:column; gap:3px; font-weight:800; color:#1E293B; line-height:1.7;">'
            + '<span style="white-space:pre-wrap;">' + esc(gotPlain) + '</span>'
            + '<span style="white-space:pre-wrap;">' + esc(writing) + '</span>'
            + '</span>';
    }

    function pairHtmlVsWriting(writing, studentPlain, diffColor) {
        if (!studentPlain) {
            return '<div style="font-size:1rem; font-weight:800; color:#1E293B; line-height:1.7; white-space:pre-wrap;">' + esc(writing) + '</div>';
        }
        if (studentMatchesWriting(studentPlain, writing)) return correctPairHtml(studentPlain, writing);
        return alignedPairHtml(writing, studentPlain, diffColor || '#2563EB');
    }

    /**
     * 學生答案／其他可接受寫法：單生卷與申訴審查同一把。
     * 跟「正確答案」同時列出；對上學生這筆的，用正確時的顯示。
     */
    function acceptedPairsHtml(item, studentPlain, removeCall) {
        const paperList = (item && item.accepted_answers) || [];
        const extra = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.extraAcceptedForItem === 'function')
            ? (window.QuizPaperBuilder.extraAcceptedForItem(item) || [])
            : [];
        const list = paperList.concat(extra);
        const seen = {};
        const blocks = [];
        list.forEach(function (a) {
            const n = normAns(a);
            if (!n || seen[n]) return;
            seen[n] = true;
            let paperIdx = -1;
            paperList.forEach(function (p, i) {
                if (paperIdx < 0 && normAns(p) === n) paperIdx = i;
            });
            const removeHtml = (removeCall && paperIdx >= 0)
                ? ('<a href="javascript:void(0)" onclick="' + removeCall(paperIdx) + '" style="color:#B91C1C; font-weight:900; text-decoration:none; font-size:0.8rem; white-space:nowrap;" title="從清單拿掉">× 移除</a>')
                : '';
            blocks.push('<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-top:8px;">'
                + '<div style="font-size:1rem; line-height:1.7; flex:1;">' + pairHtmlVsWriting(a, studentPlain, '#2563EB') + '</div>'
                + removeHtml
                + '</div>');
        });
        if (!blocks.length) {
            return '<div style="margin-top:8px; font-size:0.8rem; color:#94A3B8; font-weight:700;">（沒有其他可接受寫法）</div>';
        }
        return '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed #E2E8F0;">'
            + '<div style="font-size:0.75rem; font-weight:800; color:#1E293B; margin-bottom:2px;">學生答案／其他可接受寫法'
            + '<span style="font-weight:700; color:#64748B;">（上排學生＝黑／錯深藍　下排這筆＝黑／差異藍）</span></div>'
            + blocks.join('')
            + '</div>';
    }

    function paperScoreModeBtnsHtml(idx, item, fnName) {
        const mode = (window.QuizPaperBuilder && window.QuizPaperBuilder.paperScoreMode)
            ? window.QuizPaperBuilder.paperScoreMode(item)
            : '';
        function btn(want, label) {
            const on = mode === want;
            const bg = on ? (want === 'award' ? '#047857' : '#57534E') : '#FFFFFF';
            const fg = on ? '#FFFFFF' : (want === 'award' ? '#047857' : '#57534E');
            const bd = on ? bg : (want === 'award' ? '#059669' : '#A8A29E');
            return '<button type="button" class="btn" onclick="window.FeatureExamReview.' + fnName + '(' + idx + ', \'' + want + '\')" '
                + 'style="padding:5px 12px; border:2px solid ' + bd + '; border-radius:8px; background:' + bg + '; color:' + fg + '; font-weight:800; cursor:pointer;">'
                + (on ? '● ' : '○ ') + label + '</button>';
        }
        return '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed #E2E8F0;">'
            + '<div style="font-size:0.75rem; font-weight:800; color:#64748B; margin-bottom:6px;">這份考卷</div>'
            + '<div style="display:flex; gap:8px; flex-wrap:wrap;">'
            + btn('award', '送分')
            + btn('exclude', '不計分')
            + '</div>'
            + '</div>';
    }

    function mergeUniversalAcceptedIntoPaper(paper) {
        const Q = window.QuizPaperBuilder;
        if (!Q || typeof Q.extraAcceptedForItem !== 'function' || typeof Q.addAcceptedAnswer !== 'function') return;
        ((paper && paper.items) || []).forEach(function (it) {
            (Q.extraAcceptedForItem(it) || []).forEach(function (a) { Q.addAcceptedAnswer(it, a); });
        });
    }

    function captureDraftsFromDom(prefix, idx, count) {
        const out = [];
        let i;
        for (i = 0; i < count; i += 1) {
            const el = document.getElementById(prefix + idx + '-' + i);
            out.push(el ? String(el.value || '') : '');
        }
        return out;
    }

    function draftsFor(owner, idx) {
        if (!owner.acceptedDrafts) owner.acceptedDrafts = {};
        if (!Array.isArray(owner.acceptedDrafts[idx]) || !owner.acceptedDrafts[idx].length) {
            owner.acceptedDrafts[idx] = [''];
        }
        return owner.acceptedDrafts[idx];
    }

    function addOtherAcceptedRowHtml(prefix, idx, addFn, extraFn, drafts) {
        const rows = (drafts && drafts.length) ? drafts : [''];
        const lines = rows.map(function (val, row) {
            const id = prefix + idx + '-' + row;
            const addCall = 'window.FeatureExamReview.' + addFn + '(' + idx + ',' + row + ')';
            return '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:' + (row ? '6px' : '0') + ';">'
                + '<input id="' + id + '" type="text" placeholder="輸入另一種寫法…" value="' + escAttr(val) + '" '
                + 'style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #CBD5E1; border-radius:6px; font-size:0.85rem;" '
                + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();' + addCall + ';}">'
                + '<button type="button" class="btn btn-action" onclick="' + addCall + '" '
                + 'style="padding:5px 12px; border:none; border-radius:6px; background:#0EA5E9; color:white; font-weight:800; cursor:pointer; white-space:nowrap;">加入清單</button>'
                + '</div>';
        }).join('');
        return '<div style="margin-top:8px; padding-top:10px; border-top:1px dashed #E2E8F0;">'
            + lines
            + '<button type="button" class="btn" onclick="window.FeatureExamReview.' + extraFn + '(' + idx + ')" '
            + 'style="margin-top:6px; padding:5px 12px; background:#FFFFFF; color:#0F766E; border:2px solid #0F766E; font-weight:800; cursor:pointer;">再加一筆</button>'
            + '</div>';
    }

    function wasHiddenOnOpen(item) {
        return !!(state && state.hideWhenWrongOnly && state.hideWhenWrongOnly[String(item.item_id)]);
    }

    function itemHeadline(item, displayNo) {
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.formatItemHeadline === 'function') {
            return window.QuizPaperBuilder.formatItemHeadline(item, displayNo != null ? displayNo : (item && item.seq));
        }
        const seq = displayNo != null ? displayNo : (item && item.seq);
        return (seq != null && seq !== '') ? (String(seq) + '.') : '';
    }

    function dateKey(value) {
        if (window.UtilsDate && typeof window.UtilsDate.normalizeDateString === 'function') {
            return String(window.UtilsDate.normalizeDateString(value) || '').trim();
        }
        const s = String(value == null ? '' : value).trim();
        const m = s.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
    }

    function stampLabel(value) {
        if (window.UtilsDate && typeof window.UtilsDate.formatStampLabel === 'function') {
            return String(window.UtilsDate.formatStampLabel(value) || '').trim();
        }
        return dateKey(value);
    }

    /** 有截止日＝用截止日比新舊；同一天再用開放時間。沒有日期的排後面。最新在最上方。 */
    function sortExamTasksNewestFirst(list) {
        return (list || []).slice().sort(function (a, b) {
            const da = dateKey(a.dueDate);
            const db = dateKey(b.dueDate);
            if (da && db && da !== db) return db.localeCompare(da);
            if (db && !da) return 1;
            if (da && !db) return -1;
            const ua = dateKey(a.openAt);
            const ub = dateKey(b.openAt);
            if (ua && ub && ua !== ub) return ub.localeCompare(ua);
            if (ub && !ua) return 1;
            if (ua && !ub) return -1;
            return 0;
        });
    }

    /**
     * 這裡顯示的是「這個考試自己」的開放／截止（已含往上層繼承），不是整份作業排週用的 target_date。
     * target_date 只是老師把作業拖放到哪一週的排位日期，跟這題考試何時開放／截止無關，不准拿來當這行的日期。
     */
    function examTaskTimeHtml(t) {
        const open = stampLabel(t && t.openAt);
        const due = stampLabel(t && t.dueDate);
        const parts = [];
        if (open) parts.push('🟢 開放 ' + open);
        if (due) parts.push('⏰ 截止日 ' + due);
        if (!parts.length) return '';
        return '<div style="font-size:0.78rem; color:#0F766E; font-weight:800; margin-top:4px;">' + esc(parts.join('　')) + '</div>';
    }

    function renderEntryButton(classId) {
        const safeClassId = String(classId).replace(/'/g, "\\'");
        return '<button type="button" class="btn btn-action" onclick="window.FeatureExamReview.renderReviewPage(\'' + safeClassId + '\')" '
            + 'style="background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; font-weight:800;">🖊️ 考試批改</button>';
    }

    // ==========================================
    // 壹、獨立「考試批改」清單頁：選任務 → 選學生
    // ==========================================

    async function renderReviewPage(classId) {
        window.ModalOverlay.open({
            id: PAGE_MODAL_ID,
            tier: 'A',
            contentHtml: wrapPageShell('⏳ 載入考試任務清單…')
        });
        try {
            const assignments = (window.TeacherDB && Array.isArray(window.TeacherDB.assignments))
                ? window.TeacherDB.assignments.filter(function (a) { return String(a.class_id) === String(classId); })
                : [];
            const examTasks = [];
            assignments.forEach(function (a) {
                const list = (window.FeatureExamJob && typeof window.FeatureExamJob.listExamTasks === 'function')
                    ? window.FeatureExamJob.listExamTasks(a)
                    : [];
                list.forEach(function (t) {
                    examTasks.push({
                        assignmentId: a.id,
                        assignmentTitle: a.title || '未命名作業',
                        openAt: t.openAt || '',
                        dueDate: t.dueDate || '',
                        taskId: t.id,
                        taskTitle: t.title || '(未命名考試)'
                    });
                });
            });
            renderTaskListHtml(classId, sortExamTasksNewestFirst(examTasks));
        } catch (err) {
            console.error('[FeatureExamReview] renderReviewPage', err);
            window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('❌ 載入失敗：' + esc(err.message || err)) });
        }
    }

    function wrapPageShell(innerHtml, maxWidth) {
        const width = maxWidth || 640;
        return '<div data-exam-review-scroll style="background:white; border-radius:14px; max-width:' + width + 'px; width:100%; max-height:85vh; overflow-y:auto; padding:24px;">'
            + '<h3 style="margin:0 0 16px; color:var(--primary-dark);">🖊️ 考試批改</h3>'
            + innerHtml
            + '</div>';
    }

    /** 讀 window.TeacherDB.classes 現有的班級名稱／學生人數，只讀不重查 API。 */
    function classInfoOf(classId) {
        const cls = (window.TeacherDB && Array.isArray(window.TeacherDB.classes))
            ? window.TeacherDB.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        return {
            name: (cls && cls.name) || '',
            studentCount: (cls && Array.isArray(cls.students)) ? cls.students.length : 0
        };
    }

    function classHeaderHtml(classId) {
        const info = classInfoOf(classId);
        if (!info.name && !info.studentCount) return '';
        return '<div style="margin-bottom:12px; padding:8px 12px; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">'
            + '<span style="font-weight:900; color:#6D28D9;">🏫 ' + esc(info.name || '(未命名班級)') + '</span>'
            + '<span style="font-weight:800; color:#7C3AED; font-size:0.85rem;">👥 ' + esc(info.studentCount) + ' 位學生</span>'
            + '</div>';
    }

    function renderTaskListHtml(classId, examTasks) {
        const safeClassId = String(classId).replace(/'/g, "\\'");
        const classHeader = classHeaderHtml(classId);
        let body;
        if (!examTasks.length) {
            body = classHeader + '<div style="padding:20px; text-align:center; color:#94A3B8; font-weight:700;">目前這個班級沒有考試任務。</div>';
        } else {
            body = classHeader + '<div style="display:flex; flex-direction:column; gap:8px;">' + examTasks.map(function (t) {
                const safeAssignId = String(t.assignmentId).replace(/'/g, "\\'");
                const safeTaskId = String(t.taskId).replace(/'/g, "\\'");
                return '<button type="button" onclick="window.FeatureExamReview._openTaskStudentList(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" '
                    + 'style="text-align:left; padding:12px 14px; border:1px solid #E2E8F0; border-radius:10px; background:#F8FAFC; cursor:pointer; font-weight:800; color:#1E293B;">'
                    + '📝 ' + displayTaskTitle(t.taskTitle)
                    + examTaskTimeHtml(t)
                    + '<div style="font-size:0.78rem; color:#94A3B8; font-weight:700; margin-top:2px;">' + esc(t.assignmentTitle) + '</div>'
                    + '</button>';
            }).join('') + '</div>';
        }
        window.ModalOverlay.open({
            id: PAGE_MODAL_ID,
            tier: 'A',
            contentHtml: wrapPageShell(body) + closeFooterHtml(PAGE_MODAL_ID)
        });
    }

    function liveQuizScore(paper, completion) {
        const raw = completion && completion.raw_data;
        if (!raw || !raw.quiz_answers) return null;
        if (paper && window.QuizPaperBuilder && typeof window.QuizPaperBuilder.gradeAnswers === 'function') {
            return window.QuizPaperBuilder.gradeAnswers(paper, raw.quiz_answers, raw);
        }
        return raw.quiz_result || null;
    }

    /**
     * 讀出學生自己作答時累積的 raw_data.quiz_stats（離開次數／用時／中途退出次數），
     * 欄位名稱對照 [120_student_core/feature-student-quiz.js] 的 readStats，只讀不寫、不新建欄位。
     */
    function studentQuizStatsOf(raw) {
        const src = (raw && raw.quiz_stats) ? raw.quiz_stats : {};
        return {
            complete_count: Number(src.complete_count) || 0,
            quit_count: Number(src.quit_count) || 0,
            leave_count_total: Number(src.leave_count_total) || 0,
            last_duration_ms: Number(src.last_duration_ms) || 0,
            total_time_ms: Number(src.total_time_ms) || 0
        };
    }

    /**
     * 讀出「錯題改正練習」完成度。只在老師這個任務有勾 input_correction_enabled 才有意義；
     * 沒勾＝這個任務沒有這個功能，回 null（不是「還沒完成」）。
     * 對照 [120_student_core/feature-student-quiz.js] 的 getInputCorrectionSummary：
     * 錯題清單讀 raw.quiz_stats.wrong_items（overlayWrongItemsExpected 只補顯示用欄位，
     * 不影響題數，這裡不需要），每題要求次數固定為 task.raw_data.input_correction_count
     * （該函式呼叫 summarizePracticeProgress 時沒傳 difficultyMap，所以每題同一個次數，
     * 不分難度），進度讀 raw.input_correction_progress[item_id]._single。只讀不寫。
     */
    function correctionStatusOf(raw, task) {
        const enabled = !!(task && task.raw_data && task.raw_data.input_correction_enabled);
        if (!enabled) return null;
        const wrongItems = (raw && raw.quiz_stats && Array.isArray(raw.quiz_stats.wrong_items)) ? raw.quiz_stats.wrong_items : [];
        if (!wrongItems.length) return { total: 0, done: 0, allDone: true, noWrong: true };
        const requiredCount = Math.max(1, Number(task.raw_data.input_correction_count) || 1);
        const progress = (raw && raw.input_correction_progress && typeof raw.input_correction_progress === 'object') ? raw.input_correction_progress : {};
        let done = 0;
        wrongItems.forEach(function (it) {
            const rec = progress[String(it && it.item_id)];
            const reps = (rec && rec._single) ? Number(rec._single) || 0 : 0;
            if (reps >= requiredCount) done += 1;
        });
        return { total: wrongItems.length, done: done, allDone: done === wrongItems.length, noWrong: false };
    }

    /** 對照 [120_student_core/feature-student-quiz.js] 的 formatDurationMs，文字要一致。 */
    function formatDurationMsLabel(ms) {
        const n = Math.max(0, Math.floor(Number(ms) || 0));
        if (n < 1000) return '不到 1 秒';
        const totalSec = Math.round(n / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return h + ' 小時 ' + m + ' 分';
        if (m > 0) return m + ' 分 ' + s + ' 秒';
        return s + ' 秒';
    }

    function countAcceptedAppeals(raw) {
        const list = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.readQuizAppeals === 'function')
            ? window.QuizPaperBuilder.readQuizAppeals(raw)
            : ((raw && Array.isArray(raw.quiz_appeals)) ? raw.quiz_appeals : []);
        let n = 0;
        list.forEach(function (a) {
            if (a && String(a.status || '').trim().toLowerCase() === 'accepted') n += 1;
        });
        return n;
    }

    async function openTaskStudentList(classId, assignmentId, taskId) {
        window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('⏳ 載入學生作答狀況…') });
        try {
            const [students, completions, assignment] = await Promise.all([
                window.ApiQuizReview.fetchClassStudents(classId),
                window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId),
                window.ApiQuizReview.fetchAssignment(assignmentId)
            ]);
            const task = window.TaskScriptResolver.findTaskInTree(assignment.tasks, taskId);
            const paper = task && task.raw_data && task.raw_data.quiz_paper;
            const byStudent = new Map();
            completions.forEach(function (c) { byStudent.set(String(c.student_id), c); });

            const safeClassId = String(classId).replace(/'/g, "\\'");
            const safeAssignId = String(assignmentId).replace(/'/g, "\\'");
            const safeTaskId = String(taskId).replace(/'/g, "\\'");

            // 沿用這裡已經抓好的 completions 算待審申訴數，不額外查詢（見 page-refresh-perf-invariant 精神）
            const pendingAppealCount = countPendingAppeals(completions);
            const appealBtnHtml = '<button type="button" onclick="window.FeatureExamReview._openAppealReview(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" '
                + 'style="width:100%; text-align:left; padding:10px 14px; margin-bottom:10px; border:1px solid '
                + (pendingAppealCount > 0 ? '#FDBA74' : '#E2E8F0') + '; border-radius:10px; background:'
                + (pendingAppealCount > 0 ? '#FFF7ED' : '#F8FAFC') + '; color:'
                + (pendingAppealCount > 0 ? '#B45309' : '#64748B') + '; font-weight:900; cursor:pointer;">'
                + (pendingAppealCount > 0
                    ? ('🚩 申訴題　' + pendingAppealCount + ' 筆待審')
                    : '🚩 申訴題　目前沒有待審')
                + '</button>';

            const rows = students.map(function (s) {
                const c = byStudent.get(String(s.id));
                const raw = c && c.raw_data;
                const live = liveQuizScore(paper, c);
                const qr = live || (raw && raw.quiz_result);
                const retake = raw && raw.quiz_retake;
                const acceptedN = countAcceptedAppeals(raw);
                let scoreHtml;
                if (qr && qr.total != null) {
                    const color = qr.score >= 80 ? '#10B981' : (qr.score >= 50 ? '#F59E0B' : '#EF4444');
                    scoreHtml = '<span style="color:' + color + '; font-weight:900;">' + qr.score + '%</span>'
                        + ' <span style="color:#94A3B8; font-size:0.78rem;">(' + qr.correct + '/' + qr.total + ')</span>';
                } else {
                    scoreHtml = '<span style="color:#CBD5E1;">尚未作答</span>';
                }
                // 依同質性分行列出（老師要求，2026-09-10）：申訴／訂正結果、作答歷程、用時、批改明細
                // 各自一行，不要擠成一整條長字串。每行是否顯示各自看該類是否有資料，跟別行無關。
                const appealParts = [];
                if (acceptedN > 0) appealParts.push('<span style="color:#047857; font-weight:800;">申訴成功 ' + acceptedN + ' 題</span>');
                // 🔁 錯題重考已完成：附上合併正確率（原始＋訂正），方便老師一眼看訂正後結果
                if (retake && retake.done && retake.combined) {
                    appealParts.push('<span style="color:#B45309; font-weight:800;">→ 訂正後 '
                        + retake.combined.rate + '% (' + retake.combined.correct + '/' + retake.combined.total + ')</span>');
                } else if (retake && !retake.done && Array.isArray(retake.item_ids) && retake.item_ids.length) {
                    appealParts.push('<span style="color:#D97706;">（待重考錯題）</span>');
                }
                const appealLineHtml = appealParts.length
                    ? ('<div style="margin-top:4px; font-size:0.78rem; font-weight:700;">' + appealParts.join('　') + '</div>')
                    : '';
                // 學生端這幾個資料（離開次數／花費時間／空白題）跟學生自己看到的同一份 raw_data.quiz_stats，
                // 不重算、不另建欄位；欄位讀法對照 [120_student_core/feature-student-quiz.js] 的 readStats／formatDurationMs，
                // 那些是學生自己作答時累積寫進去的，這裡只讀出來顯示，不改寫。
                const stStats = studentQuizStatsOf(raw);
                const attemptParts = [];
                if (stStats.complete_count > 0) attemptParts.push('已作答過 ' + stStats.complete_count + ' 次');
                if (stStats.quit_count > 0) attemptParts.push('中途退出 ' + stStats.quit_count + ' 次');
                if (stStats.leave_count_total > 0) attemptParts.push('嘗試離開 ' + stStats.leave_count_total + ' 次');
                const attemptLineHtml = attemptParts.length
                    ? ('<div style="margin-top:4px; font-size:0.75rem; color:#64748B; font-weight:700;">' + esc(attemptParts.join(' · ')) + '</div>')
                    : '';
                const timeParts = [];
                if (stStats.last_duration_ms > 0) timeParts.push('本次用時 ' + formatDurationMsLabel(stStats.last_duration_ms));
                if (stStats.total_time_ms > 0) timeParts.push('累計 ' + formatDurationMsLabel(stStats.total_time_ms));
                const timeLineHtml = timeParts.length
                    ? ('<div style="margin-top:2px; font-size:0.75rem; color:#64748B; font-weight:700;">' + esc(timeParts.join(' · ')) + '</div>')
                    : '';
                // 批改明細：空白題永遠顯示（含 0 題，讓老師一眼看到「全部有寫」，不是沒資料）；
                // 錯題修正只在這個任務有勾 input_correction_enabled 才顯示（沒勾＝這功能不存在，不是「未完成」）。
                const gradingParts = [];
                if (qr && qr.total != null) {
                    const blankN = Array.isArray(qr.details)
                        ? qr.details.filter(function (d) { return d && !d.excluded && !String(d.answer || '').trim(); }).length
                        : 0;
                    gradingParts.push('空白 ' + blankN + ' 題');
                }
                const correction = correctionStatusOf(raw, task);
                if (correction && !correction.noWrong) {
                    gradingParts.push(correction.allDone
                        ? ('<span style="color:#047857;">✅ 錯題修正已完成 (' + correction.done + '/' + correction.total + ')</span>')
                        : ('<span style="color:#D97706;">🔧 錯題修正進行中 (' + correction.done + '/' + correction.total + ')</span>'));
                }
                const gradingLineHtml = gradingParts.length
                    ? ('<div style="margin-top:2px; font-size:0.75rem; color:#64748B; font-weight:700;">' + gradingParts.join(' · ') + '</div>')
                    : '';
                const safeStudentId = String(s.id).replace(/'/g, "\\'");
                return '<button type="button" onclick="window.FeatureExamReview.openReview(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\', \'' + safeStudentId + '\')" '
                    + 'style="display:flex; flex-direction:column; align-items:stretch; text-align:left; padding:10px 14px; border:1px solid #E2E8F0; border-radius:10px; background:white; cursor:pointer; width:100%;">'
                    + '<div style="display:flex; justify-content:space-between; align-items:center; width:100%;">'
                    + '<span style="font-weight:800; color:#1E293B;">' + esc(s.name) + '</span>'
                    + '<span>' + scoreHtml + '</span>'
                    + '</div>'
                    + appealLineHtml
                    + attemptLineHtml
                    + timeLineHtml
                    + gradingLineHtml
                    + '</button>';
            }).join('');

            const body = '<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                + '<button type="button" onclick="window.FeatureExamReview.renderReviewPage(\'' + safeClassId + '\')" style="background:none; border:none; color:#6D28D9; font-weight:800; cursor:pointer; padding:0;">← 返回任務清單</button>'
                + '<button type="button" id="regrade-whole-task-btn" onclick="window.FeatureExamReview._regradeWholeTask(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" '
                    + 'style="' + WHOLE_CLASS_REGRADE_BTN_STYLE + '" '
                    + 'title="依目前試卷範本重算標準答案（維持原題），再重批全班已交卷學生。">'
                    + WHOLE_CLASS_REGRADE_BTN_HTML + '</button>'
                + '</div>'
                + '<div id="exam-review-page-error" style="display:none; margin-bottom:10px; padding:8px 10px; background:#FEF2F2; color:#B91C1C; font-weight:800; border-radius:8px;"></div>'
                + appealBtnHtml
                + '<div style="display:flex; flex-direction:column; gap:8px;">' + (rows || '<div style="color:#94A3B8;">此班級沒有學生。</div>') + '</div>';

            window.ModalOverlay.open({
                id: PAGE_MODAL_ID,
                tier: 'A',
                contentHtml: wrapPageShell(body) + closeFooterHtml(PAGE_MODAL_ID)
            });
        } catch (err) {
            console.error('[FeatureExamReview] openTaskStudentList', err);
            window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('❌ 載入失敗：' + esc(err.message || err)) });
        }
    }

    function closeFooterHtml(modalId) {
        return '<div style="margin-top:16px; text-align:right;">'
            + '<button type="button" onclick="window.ModalOverlay.close(\'' + modalId + '\')" style="padding:8px 16px; border:1px solid #CBD5E1; border-radius:8px; background:#F1F5F9; font-weight:800; cursor:pointer;">關閉</button>'
            + '</div>';
    }

    // ==========================================
    // 共用：批次重批 helper
    // ==========================================

    /**
     * 抓某任務全部 completions，用「目前 paper」逐一重新批改，只寫入真的有變動（或被強制）
     * 的那些。三個用途共用同一份邏輯：(a) 老師改考卷存檔（_save）、(b) 獨立「重新批閱」
     * 按鈕（單生 or 整任務）、(c) 申訴「可接受」時的整任務重批＋標記申訴狀態。
     * @param {string} assignmentId
     * @param {string} taskId
     * @param {object} paper 目前的 quiz_paper（含老師剛編輯過的 accepted_answers）
     * @param {object} [opts]
     * @param {string[]} [opts.onlyCompletionIds] 只處理這些 completion id（單生重批用）；不給就是整任務
     * @param {string[]} [opts.forceIds] 這些 completion id 即使 regrade 判定沒變動也強制寫入
     * @param {boolean} [opts.forceAll] 整批都強制寫入，不管有沒有變動（「重新批閱整任務」用）
     * @param {function} [opts.beforeRegrade] (completion) => boolean，重批前可先修改
     *   completion.raw_data（例如標記申訴狀態）；回傳 true 代表這筆要強制存檔
     * @returns {Promise<{ okCount: number, failCount: number, errors: object[], allCompletions: object[], savedIds: string[] }>}
     */
    async function regradeAndSaveTask(assignmentId, taskId, paper, opts) {
        opts = opts || {};
        const all = await window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId);
        const mutatedById = {};
        all.forEach(function (c) {
            if (typeof opts.beforeRegrade === 'function') {
                mutatedById[String(c.id)] = !!opts.beforeRegrade(c);
            }
        });
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.applyAcceptedAppealsToPaper === 'function') {
            const paperChanged = window.QuizPaperBuilder.applyAcceptedAppealsToPaper(paper, all);
            if (paperChanged) {
                await window.ApiQuizReview.saveQuizPaperPatch(assignmentId, taskId, paper);
            }
        }
        const onlyIds = opts.onlyCompletionIds ? opts.onlyCompletionIds.map(String) : null;
        const forceIds = opts.forceIds ? opts.forceIds.map(String) : [];
        const toSave = [];
        all.forEach(function (c) {
            if (onlyIds && onlyIds.indexOf(String(c.id)) === -1) return;
            const mutated = !!mutatedById[String(c.id)];
            const forceThis = !!opts.forceAll || mutated || forceIds.indexOf(String(c.id)) !== -1;
            if (!c.raw_data || !c.raw_data.quiz_answers) {
                if (forceThis) {
                    toSave.push({
                        id: c.id,
                        student_id: c.student_id,
                        rawData: c.raw_data || {},
                        score: (c.raw_data && c.raw_data.quiz_result && c.raw_data.quiz_result.score != null) ? c.raw_data.quiz_result.score : null
                    });
                }
                return;
            }
            const r = window.QuizPaperBuilder.regradeCompletionRawData(paper, c.raw_data);
            if (r.changed || forceThis) {
                toSave.push({ id: c.id, student_id: c.student_id, rawData: r.rawData, score: r.nextScore });
            }
        });
        const result = toSave.length
            ? await window.ApiQuizReview.batchSaveCompletions(toSave)
            : { okCount: 0, failCount: 0, errors: [] };
        return Object.assign({}, result, { allCompletions: all, savedIds: toSave.map(function (t) { return String(t.id); }) });
    }

    // ==========================================
    // 貳、單生考卷檢視／改答案／重批 Modal
    // ==========================================

    async function openReview(classId, assignmentId, taskId, studentId) {
        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: 'B',
            contentHtml: wrapModalShell('⏳ 載入考卷內容…'),
            isDirty: function () { return isDirty(); },
            unsavedMessage: '這份考卷的批改結果尚未儲存，確定要關閉嗎？',
            onClose: function () { state = null; }
        });
        try {
            const [assignment, completions, students] = await Promise.all([
                window.ApiQuizReview.fetchAssignment(assignmentId),
                window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId),
                window.ApiQuizReview.fetchClassStudents(classId)
            ]);
            const task = window.TaskScriptResolver.findTaskInTree(assignment.tasks, taskId);
            if (!task || !task.raw_data || !task.raw_data.quiz_paper) {
                throw new Error('找不到這個考試任務的線上卷內容（可能還沒產生線上卷）');
            }
            const completion = completions.find(function (c) { return String(c.student_id) === String(studentId); }) || null;
            const studentInfo = students.find(function (s) { return String(s.id) === String(studentId); });
            if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.loadUniversalAcceptedAnswers === 'function') {
                await window.QuizPaperBuilder.loadUniversalAcceptedAnswers();
            }
            const paper = JSON.parse(JSON.stringify(task.raw_data.quiz_paper));
            mergeUniversalAcceptedIntoPaper(paper);

            state = {
                classId: classId,
                assignmentId: assignmentId,
                taskId: taskId,
                studentId: studentId,
                studentName: studentInfo ? studentInfo.name : '未知學生',
                taskTitle: task.title || task.raw_data.exam_title || '(未命名考試)',
                paper: paper,
                originalPaperJson: JSON.stringify(paper),
                completion: completion,
                answers: (completion && completion.raw_data && completion.raw_data.quiz_answers) || {},
                showWrongOnly: true,
                editingPrimaryIdx: null,
                hideWhenWrongOnly: {},
                liveGrade: null,
                acceptedDrafts: {}
            };
            state.liveGrade = gradeCurrentStudent();
            (state.paper.items || []).forEach(function (it) {
                if (itemIsCorrectOrEmpty(it)) state.hideWhenWrongOnly[String(it.item_id)] = true;
            });
            renderModal();
        } catch (err) {
            console.error('[FeatureExamReview] openReview', err);
            window.ModalOverlay.open({ id: MODAL_ID, tier: 'B', contentHtml: wrapModalShell('❌ 載入失敗：' + esc(err.message || err)) + footerHtml() });
        }
    }

    function isDirty() {
        if (!state || !state.paper) return false;
        return JSON.stringify(state.paper) !== state.originalPaperJson;
    }

    function wrapModalShell(innerHtml) {
        return '<div id="qr-modal-body" data-exam-review-scroll style="background:white; border-radius:14px; max-width:820px; width:100%; max-height:90vh; overflow-y:auto; padding:24px;">'
            + innerHtml
            + '</div>';
    }

    /** 對錯只讀 QuizPaperBuilder.gradeCompletion，不在這頁再判一次申訴。 */
    function gradeCurrentStudent() {
        const empty = { correct: 0, total: 0, score: 0, detailsById: {} };
        if (!state || !state.paper || !window.QuizPaperBuilder) return empty;
        const raw = Object.assign({}, (state.completion && state.completion.raw_data) || {}, {
            quiz_answers: state.answers || {}
        });
        const result = window.QuizPaperBuilder.gradeAnswers(state.paper, raw.quiz_answers, raw);
        const detailsById = {};
        (result.details || []).forEach(function (d) {
            if (d && d.item_id != null) detailsById[String(d.item_id)] = d;
        });
        return {
            correct: result.correct || 0,
            total: result.total || 0,
            score: result.score || 0,
            detailsById: detailsById
        };
    }

    function itemOkFromGrade(it) {
        const g = (state && state.liveGrade) || gradeCurrentStudent();
        const d = g.detailsById[String(it && it.item_id)];
        return !!(d && d.ok === true);
    }

    function computeLiveScore() {
        const items = (state && state.paper && state.paper.items) || [];
        const g = state.liveGrade || gradeCurrentStudent();
        let attempted = 0;
        items.forEach(function (it) {
            if (String(gotPlainOf(it) || '').trim()) attempted += 1;
        });
        return { correct: g.correct, total: (g.total != null ? g.total : items.length), attempted: attempted };
    }

    function renderModal() {
        state.liveGrade = gradeCurrentStudent();
        const items = state.paper.items || [];
        const live = computeLiveScore();
        const denom = live.total;
        const scorePct = denom ? Math.round((live.correct / denom) * 1000) / 10 : 0;
        const scoreColor = scorePct >= 80 ? '#10B981' : (scorePct >= 50 ? '#F59E0B' : '#EF4444');

        const rowsHtml = items.map(function (_, idx) { return renderItemRow(idx); }).join('');

        const savedQr = state.completion && state.completion.raw_data && state.completion.raw_data.quiz_result;
        const savedStats = state.completion && state.completion.raw_data && state.completion.raw_data.quiz_stats;
        let savedScoreHtml = '<span style="color:#94A3B8; font-size:0.8rem;">（尚未作答，以下僅供預覽／編輯標準答案）</span>';
        if (savedQr) {
            const durMs = Number(savedQr.duration_ms) || Number(savedStats && savedStats.last_duration_ms) || 0;
            const totalMs = Number(savedStats && savedStats.total_time_ms) || 0;
            const durParts = [];
            if (durMs > 0) {
                const sec = Math.round(durMs / 1000);
                const m = Math.floor(sec / 60);
                const s = sec % 60;
                durParts.push('本次 ' + (m ? (m + ' 分 ' + s + ' 秒') : (s + ' 秒')));
            }
            if (totalMs > 0 && totalMs !== durMs) {
                const sec = Math.round(totalMs / 1000);
                const m = Math.floor(sec / 60);
                const s = sec % 60;
                durParts.push('累計 ' + (m ? (m + ' 分' + (s ? (' ' + s + ' 秒') : '')) : (s + ' 秒')));
            }
            savedScoreHtml = '<span style="color:#94A3B8; font-size:0.8rem;">（已存檔分數：' + savedQr.score + '%'
                + (durParts.length ? '　' + durParts.join('　') : '')
                + '）</span>';
        }

        const header = '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; flex-wrap:wrap; gap:8px;">'
            + '<div>'
                + '<h3 style="margin:0; color:var(--primary-dark);">🖊️ ' + esc(state.studentName) + '</h3>'
                + '<div style="color:#64748B; font-weight:700; font-size:0.85rem; margin-top:2px;">' + displayTaskTitle(state.taskTitle) + '</div>'
            + '</div>'
            + '<div style="text-align:right;">'
                + '<div style="font-size:1.6rem; font-weight:900; color:' + scoreColor + ';">' + scorePct + '%</div>'
                + '<div style="font-size:0.78rem; color:#64748B;">' + live.correct + ' / ' + items.length + ' 題　' + savedScoreHtml + '</div>'
            + '</div>'
            + '</div>';

        const pendingHere = countPendingAppeals(state.completion ? [state.completion] : []);
        const appealEntryHtml = '<button type="button" onclick="window.FeatureExamReview._openAppealsFromStudentPaper()" '
            + 'style="padding:6px 12px; border:1px solid ' + (pendingHere > 0 ? '#FDBA74' : '#E2E8F0')
            + '; border-radius:6px; background:' + (pendingHere > 0 ? '#FFF7ED' : '#F8FAFC')
            + '; color:' + (pendingHere > 0 ? '#B45309' : '#64748B')
            + '; font-weight:800; cursor:pointer;">🚩 申訴題'
            + (pendingHere > 0 ? ('　' + pendingHere + ' 筆待審') : '')
            + '</button>';
        const toggleHtml = '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">'
            + '<label style="display:inline-flex; align-items:center; gap:6px; font-size:0.85rem; font-weight:700; color:#475569; cursor:pointer;">'
            + '<input type="checkbox" ' + (state.showWrongOnly ? 'checked' : '') + ' onchange="window.FeatureExamReview._toggleShowWrongOnly(this.checked)"> 只顯示錯題／未作答'
            + '</label>'
            + appealEntryHtml
            + '</div>';

        const emptyMsg = state.showWrongOnly && !hasAnyVisibleRow(items)
            ? '<div style="padding:16px; text-align:center; color:#047857; font-weight:800; background:#ECFDF5; border-radius:10px;">本次全對，沒有錯題／缺答。</div>'
            : '';

        const errHtml = state.saveError
            ? '<div style="margin-bottom:10px; padding:8px 10px; background:#FEF2F2; color:#B91C1C; font-weight:800; border-radius:8px;">' + esc(state.saveError) + '</div>'
            : '';
        const contentHtml = wrapModalShell(header + toggleHtml + errHtml + '<div id="qr-rows">' + emptyMsg + rowsHtml + '</div>') + footerHtml();
        mountOrPatchModal(contentHtml);
    }

    /**
     * 💣 雷區：ModalOverlay.open 對同一個 id 再次呼叫時，會先 close(activeId) 觸發舊的
     * onClose（這裡是 state=null）才 open 新的——如果每次互動都重新呼叫 open()，狀態會在
     * 重繪過程中被自己的舊 onClose 清空。所以「開新 modal」只在第一次呼叫 ModalOverlay.open，
     * 之後互動觸發的重繪都直接改 DOM innerHTML，不要再呼叫 ModalOverlay.open。
     */
    function mountOrPatchModal(contentHtml) {
        if (patchOverlayKeepScroll(MODAL_ID, contentHtml)) return;
        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: 'B',
            contentHtml: contentHtml,
            isDirty: function () { return isDirty(); },
            unsavedMessage: '這份考卷的批改結果尚未儲存，確定要關閉嗎？',
            onClose: function () { state = null; }
        });
    }

    function hasAnyVisibleRow(items) {
        return items.some(function (it) { return !itemIsCorrectOrEmpty(it); });
    }

    function itemIsCorrectOrEmpty(it) {
        const gotPlain = gotPlainOf(it);
        if (!String(gotPlain).trim()) return false; // 未作答仍算「要看」
        return itemOkFromGrade(it);
    }

    function renderItemRow(idx) {
        const item = state.paper.items[idx];
        const gotPlain = gotPlainOf(item);
        const hasAnswer = !!String(gotPlain).trim();
        const appeal = appealForItem(item.item_id);
        const isCorrect = hasAnswer && itemOkFromGrade(item);

        if (state.showWrongOnly && wasHiddenOnOpen(item)) {
            return '<div id="qr-row-' + idx + '" style="display:none;"></div>';
        }

        const primaryPair = hasAnswer
            ? alignedPairHtml(item.answer_en, gotPlain, '#DC2626')
            : '';
        const primaryEditing = state.editingPrimaryIdx === idx;
        const expectedEditHtml = primaryEditing
            ? '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin:6px 0 10px;">'
                + '<input id="qr-primary-input-' + idx + '" type="text" value="' + escAttr(item.answer_en) + '" '
                + 'style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #A78BFA; border-radius:6px; font-size:0.95rem; font-weight:800; color:#1E293B;">'
                + '<button type="button" onclick="window.FeatureExamReview._confirmEditPrimary(' + idx + ')" style="padding:4px 8px; border:none; border-radius:6px; background:#7C3AED; color:white; font-weight:800; cursor:pointer;">✓</button>'
                + '<button type="button" onclick="window.FeatureExamReview._cancelEditPrimary(' + idx + ')" style="padding:4px 8px; border:1px solid #CBD5E1; border-radius:6px; background:white; cursor:pointer;">✕</button>'
                + '</div>'
            : '';

        const showAlsoCorrect = hasAnswer && !wasHiddenOnOpen(item) && !(appeal && appeal.status === 'accepted') && !gotMatchesPrimary(item);
        const alsoCorrectHtml = showAlsoCorrect
            ? '<label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:0.85rem; font-weight:700; color:#475569; cursor:pointer;">'
                + '<input type="checkbox" ' + (isCorrect ? 'checked' : '') + ' onchange="window.FeatureExamReview._toggleAlsoCorrect(' + idx + ', this.checked)"> '
                + '可接受答案'
                + '<span style="font-weight:700; color:#64748B;">（這題以後都算，不限這份考卷）</span>'
                + '</label>'
            : '';
        const addAnswerHtml = addOtherAcceptedRowHtml(
            'qr-new-ans-',
            idx,
            '_addAccepted',
            '_addAcceptedInputRow',
            draftsFor(state, idx)
        );

        const pendingAccept = showAlsoCorrect && isCorrect;
        const scoreMode = (window.QuizPaperBuilder && window.QuizPaperBuilder.paperScoreMode)
            ? window.QuizPaperBuilder.paperScoreMode(item)
            : '';
        const scoreMark = scoreMode === 'award'
            ? ' <span style="color:#047857;">送分</span>'
            : (scoreMode === 'exclude' ? ' <span style="color:#57534E;">不計分</span>' : '');
        const statusBadge = !hasAnswer
            ? '<span style="color:#94A3B8;">⚠ 未作答</span>' + scoreMark
            : ((appeal && appeal.status === 'accepted')
                ? '<span style="color:#047857;">申訴成功</span>' + scoreMark
                : (pendingAccept
                    ? '<span style="color:#B45309;">待確認算對（未儲存）</span>' + scoreMark
                    : (isCorrect ? '<span style="color:#047857;">✅ 正確</span>' : '<span style="color:#DC2626;">❌ 錯誤</span>') + scoreMark));
        const appealHtml = appeal
            ? (appeal.status === 'accepted'
                ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#047857;">✅ 申訴已被接受</div>'
                : (appeal.status === 'rejected'
                    ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#DC2626;">❌ 申訴未通過</div>'
                    : '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B45309;">🚩 申訴審核中</div>'))
            : '';

        const cardBorder = pendingAccept ? '#FDBA74' : (isCorrect ? '#D1FAE5' : '#FECACA');
        const cardBg = pendingAccept ? '#FFFBEB' : (isCorrect ? '#F0FDF4' : '#FFF7F7');
        return '<div id="qr-row-' + idx + '" style="border:1px solid ' + cardBorder + '; border-radius:10px; padding:12px 14px; margin-bottom:10px; background:' + cardBg + ';">'
            + '<div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:900; color:#64748B; margin-bottom:4px;">'
                + '<span>' + esc(itemHeadline(item, item.seq)) + '</span>' + statusBadge
            + '</div>'
            + '<div style="font-size:0.92rem; font-weight:800; color:#1E293B; margin-bottom:8px; white-space:pre-wrap;">' + esc(item.prompt_zh || '') + '</div>'
            + '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:2px;">'
            + '<div style="font-size:0.75rem; font-weight:800; color:#1E293B;">學生答案／正確答案'
            + '<span style="font-weight:700; color:#64748B;">（上排學生＝黑／錯深藍　下排解答＝黑／差異紅）</span></div>'
            + (primaryEditing ? '' : '<button type="button" onclick="window.FeatureExamReview._startEditPrimary(' + idx + ')" title="修改正確答案" style="border:none; background:none; cursor:pointer; font-size:0.85rem;">✏️</button>')
            + '</div>'
            + (hasAnswer
                ? ('<div style="font-size:1rem; line-height:1.7; margin-bottom:6px;">' + (primaryPair || '<span style="color:#94A3B8; font-weight:700;">（尚未作答）</span>') + '</div>')
                : ('<div style="margin-bottom:6px;"><div style="color:#94A3B8; font-weight:700; margin-bottom:4px;">（尚未作答）</div>'
                    + '<div style="font-size:1rem; font-weight:800; color:#1E293B; line-height:1.7; white-space:pre-wrap;">' + esc(item.answer_en || '') + '</div></div>'))
            + expectedEditHtml
            + alsoCorrectHtml
            + paperScoreModeBtnsHtml(idx, item, '_togglePaperScore')
            + appealHtml
            + acceptedPairsHtml(item, gotPlain, function (ai) {
                return 'window.FeatureExamReview._removeAccepted(' + idx + ',' + ai + ')';
            })
            + addAnswerHtml
            + '</div>';
    }

    /**
     * 每次互動後整個 modal 重繪一次：分數／存檔按鈕都要跟著變動變化，且所有互動都是
     * 「點擊後才觸發」（新增答案／確認修改都是按按鈕才讀 input 值），不是邊打字邊重繪，
     * 所以直接整個重繪不會打斷使用者輸入。
     */
    function captureAllPaperDrafts() {
        if (!state || !state.paper) return;
        (state.paper.items || []).forEach(function (_it, idx) {
            const cur = (state.acceptedDrafts && state.acceptedDrafts[idx]) || [''];
            if (!document.getElementById('qr-new-ans-' + idx + '-0')) return;
            state.acceptedDrafts[idx] = captureDraftsFromDom('qr-new-ans-', idx, cur.length);
        });
    }

    function rerenderAll(keepElId) {
        captureAllPaperDrafts();
        keepScrollElId = keepElId || '';
        renderModal();
    }

    function footerHtml() {
        const dirty = isDirty();
        // 「重新批閱」跟 isDirty 無關：即使沒改任何 accepted_answers（例如中央白名單之後
        // 又更新了），老師也可以強制重批這位學生一次，不需要先動一下考卷才能按存檔。
        const regradeBtnHtml = state && state.completion
            ? '<button type="button" id="qr-regrade-btn" onclick="window.FeatureExamReview._regradeThisStudent()" '
                + 'title="依目前試卷範本重算標準答案（維持原題），再重新批改這位學生" '
                + 'style="padding:9px 18px; border:1px solid #0EA5E9; border-radius:8px; background:white; color:#0369A1; font-weight:800; cursor:pointer;">🔄 重新批閱</button>'
            : '';
        return '<div style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px; position:sticky; bottom:0; background:white; padding-top:8px;">'
            + '<button type="button" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')" style="padding:9px 18px; border:1px solid #CBD5E1; border-radius:8px; background:#F1F5F9; font-weight:800; cursor:pointer;">關閉</button>'
            + regradeBtnHtml
            + '<button type="button" id="qr-save-btn" onclick="window.FeatureExamReview._save()" ' + (dirty ? '' : 'disabled') + ' '
                + 'style="padding:9px 18px; border:none; border-radius:8px; background:' + (dirty ? '#7C3AED' : '#CBD5E1') + '; color:white; font-weight:900; cursor:' + (dirty ? 'pointer' : 'not-allowed') + ';">'
                + (dirty ? '💾 儲存並重新批改' : '沒有變更')
            + '</button>'
            + '</div>';
    }

    // ------- 互動事件 -------

    function _toggleShowWrongOnly(checked) {
        if (!state) return;
        state.showWrongOnly = !!checked;
        rerenderAll();
    }

    function _addAccepted(idx, row) {
        if (!state) return;
        captureAllPaperDrafts();
        row = Number(row) || 0;
        const drafts = draftsFor(state, idx);
        const val = drafts[row] || '';
        if (!String(val).trim()) return;
        const item = state.paper.items[idx];
        const changed = window.QuizPaperBuilder.addAcceptedAnswer(item, val);
        if (!changed) {
            window.showFlash && window.showFlash('這個答案已經在標準答案裡了', 'warning');
            return;
        }
        drafts[row] = '';
        rerenderAll('qr-row-' + idx);
    }

    function _addAcceptedInputRow(idx) {
        if (!state) return;
        captureAllPaperDrafts();
        draftsFor(state, idx).push('');
        rerenderAll('qr-row-' + idx);
        const n = draftsFor(state, idx).length;
        const el = document.getElementById('qr-new-ans-' + idx + '-' + (n - 1));
        if (el) el.focus();
    }

    function _removeAccepted(idx, ai) {
        if (!state) return;
        const item = state.paper.items[idx];
        const val = (item.accepted_answers || [])[ai];
        if (val == null) return;
        window.QuizPaperBuilder.removeAcceptedAnswer(item, val);
        rerenderAll('qr-row-' + idx);
    }

    function _toggleAlsoCorrect(idx, checked) {
        if (!state) return;
        const item = state.paper.items[idx];
        const gotPlain = gotPlainOf(item);
        if (!gotPlain) return;
        if (checked) window.QuizPaperBuilder.addAcceptedAnswer(item, gotPlain);
        else window.QuizPaperBuilder.removeAcceptedAnswer(item, gotPlain);
        rerenderAll('qr-row-' + idx);
    }

    function _togglePaperScore(idx, mode) {
        if (!state) return;
        const item = state.paper.items[idx];
        if (!item || !window.QuizPaperBuilder || typeof window.QuizPaperBuilder.setPaperScoreMode !== 'function') return;
        window.QuizPaperBuilder.setPaperScoreMode(item, mode);
        rerenderAll('qr-row-' + idx);
    }

    function _toggleAppealPaperScore(idx, mode) {
        if (!appealState || appealState._loading) return;
        const group = appealState.groups[idx];
        if (!group || !group.item || !window.QuizPaperBuilder || typeof window.QuizPaperBuilder.setPaperScoreMode !== 'function') return;
        window.QuizPaperBuilder.setPaperScoreMode(group.item, mode);
        renderAppealReviewHtml('appeal-group-' + idx);
    }

    function _startEditPrimary(idx) {
        if (!state) return;
        state.editingPrimaryIdx = idx;
        rerenderAll('qr-row-' + idx);
        const input = document.getElementById('qr-primary-input-' + idx);
        if (input) { input.focus(); input.select(); }
    }

    function _cancelEditPrimary(idx) {
        if (!state) return;
        state.editingPrimaryIdx = null;
        rerenderAll('qr-row-' + idx);
    }

    function _confirmEditPrimary(idx) {
        if (!state) return;
        const input = document.getElementById('qr-primary-input-' + idx);
        const val = input ? input.value : '';
        window.QuizPaperBuilder.setPrimaryAnswer(state.paper.items[idx], val);
        state.editingPrimaryIdx = null;
        rerenderAll('qr-row-' + idx);
    }

    async function _save() {
        if (!state || !isDirty()) return;
        const saveBtn = document.getElementById('qr-save-btn');
        window.ModalOverlay.setBusy(MODAL_ID, true);
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '儲存中…'; }
        try {
            const originalPaper = JSON.parse(state.originalPaperJson || '{}');
            if (window.ApiQuizReview && typeof window.ApiQuizReview.persistUniversalAcceptedDiff === 'function') {
                await window.ApiQuizReview.persistUniversalAcceptedDiff(originalPaper, state.paper);
            }
            await window.ApiQuizReview.saveQuizPaperPatch(state.assignmentId, state.taskId, state.paper);

            // 目前這位學生一律強制寫入（即使 regrade 判定沒變動，維持跟以前一樣的行為），
            // 其他同任務學生只寫入真的有變動的——都靠共用 helper 一次搞定。
            const forceIds = state.completion ? [state.completion.id] : [];
            const result = await regradeAndSaveTask(state.assignmentId, state.taskId, state.paper, { forceIds: forceIds });

            if (state.completion) {
                const regradedCurrent = window.QuizPaperBuilder.regradeCompletionRawData(state.paper, state.completion.raw_data);
                state.completion.raw_data = regradedCurrent.rawData;
            }

            const otherCount = Math.max(0, (result.savedIds || []).length - (state.completion ? 1 : 0));
            const otherSummary = otherCount > 0
                ? '，並重新批改了其他 ' + otherCount + ' 位學生的分數' + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : '')
                : '';

            state.originalPaperJson = JSON.stringify(state.paper);
            state.saveError = '';
            window.showFlash && window.showFlash('✅ 已儲存批改結果' + otherSummary, 'success');
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(state.classId);
            }
            window.ModalOverlay.close(MODAL_ID);
        } catch (err) {
            console.error('[FeatureExamReview] save', err);
            window.ModalOverlay.setBusy(MODAL_ID, false);
            state.saveError = '儲存失敗：' + (err.message || err);
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 儲存並重新批改'; }
            rerenderAll();
        }
    }

    /**
     * 依目前試卷範本重算卷上標準答案、寫回作業，再回傳更新後的 paper。
     * 批改畫面的「重新批閱」必須走這條，否則只會對舊快照重算分、畫面標準答案不變。
     * 有作業上的 meta 快取就用快取；沒有才去 Drive。禁止為了重批而強制重抓全部活頁。
     */
    async function refreshPaperAnswersFromTemplate(assignmentId, taskId, classId) {
        if (!window.FeatureExamJob || typeof window.FeatureExamJob.refreshTaskPaperFromTemplate !== 'function') {
            throw new Error('作業模組未載入，請硬重新整理老師頁');
        }
        const assignment = await window.ApiQuizReview.fetchAssignment(assignmentId);
        const task = window.TaskScriptResolver.findTaskInTree(assignment.tasks, taskId);
        if (!task || !task.raw_data || !task.raw_data.quiz_paper) {
            throw new Error('找不到這個考試任務的線上卷');
        }
        const result = await window.FeatureExamJob.refreshTaskPaperFromTemplate(task, classId, {
            forceRefreshMeta: false
        });
        const completions = await window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId);
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.applyAcceptedAppealsToPaper === 'function') {
            window.QuizPaperBuilder.applyAcceptedAppealsToPaper(result.paper, completions);
        }
        await window.ApiQuizReview.saveQuizPaperPatch(assignmentId, taskId, result.paper);
        return result;
    }

    /**
     * 獨立「重新批閱」：先依試卷範本重算標準答案（維持原題），再強制重批這位學生。
     */
    async function _regradeThisStudent() {
        if (!state || !state.completion) {
            window.showFlash && window.showFlash('這位學生還沒有作答紀錄，無法重新批閱', 'warning');
            return;
        }
        const btn = document.getElementById('qr-regrade-btn');
        if (btn) { btn.disabled = true; btn.textContent = '重新批閱中…'; }
        try {
            const refreshed = await refreshPaperAnswersFromTemplate(state.assignmentId, state.taskId, state.classId);
            state.paper = refreshed.paper;
            await regradeAndSaveTask(state.assignmentId, state.taskId, state.paper, {
                onlyCompletionIds: [state.completion.id],
                forceAll: true
            });
            const fresh = await window.ApiQuizReview.fetchCompletionsForTask(state.assignmentId, state.taskId);
            const freshC = fresh.find(function (c) { return String(c.id) === String(state.completion.id); });
            if (freshC) {
                state.completion = freshC;
                state.answers = (freshC.raw_data && freshC.raw_data.quiz_answers) || {};
            }
            state.originalPaperJson = JSON.stringify(state.paper);
            const miss = refreshed.missing ? '（' + refreshed.missing + ' 題對不到 meta）' : '';
            const sample = (refreshed.sampleAnswers && refreshed.sampleAnswers.length)
                ? '｜例：' + refreshed.sampleAnswers.slice(0, 2).join('、')
                : '';
            window.showFlash && window.showFlash('✅ 已依試卷範本更新標準答案並重新批閱這位學生' + sample + miss, refreshed.missing ? 'warning' : 'success');
            rerenderAll();
        } catch (err) {
            console.error('[FeatureExamReview] regradeThisStudent', err);
            if (state) {
                state.saveError = '重新批閱失敗：' + (err.message || err);
                rerenderAll();
            }
        } finally {
            const btnAgain = document.getElementById('qr-regrade-btn');
            if (btnAgain) { btnAgain.disabled = false; btnAgain.textContent = '🔄 重新批閱'; }
        }
    }

    // ==========================================
    // 參、申訴審核（依「題目＋申訴內容」分組）
    // ==========================================

    /** @type {any} 目前開著的申訴審核畫面狀態；跟單生檢視的 state 是分開的，互不影響 */
    let appealState = null;

    /**
     * 逐組決定存檔成功後，廣播一個「純信號」到 appeal-progress:{assignmentId}:{taskId} 頻道，
     * 讓學生端（AppealProgressSync）立刻重新查詢，不用等 15 秒輪詢保底才看到。
     * 只送信號，不帶任何學生個資／答案內容；頻道是純轉發，不落地資料庫。
     */
    function broadcastAppealProgress(assignmentId, taskId) {
        if (!window.supabaseClient || typeof window.supabaseClient.channel !== 'function') return;
        try {
            const channel = window.supabaseClient.channel('appeal-progress:' + assignmentId + ':' + taskId);
            const sendPromise = (typeof channel.httpSend === 'function')
                ? channel.httpSend('appeal_reviewed', {})
                : channel.send({ type: 'broadcast', event: 'appeal_reviewed', payload: {} });
            Promise.resolve(sendPromise)
                .catch(function (err) { console.warn('[FeatureExamReview] broadcastAppealProgress send failed', err); })
                .finally(function () {
                    if (window.supabaseClient.removeChannel) window.supabaseClient.removeChannel(channel);
                });
        } catch (err) {
            console.warn('[FeatureExamReview] broadcastAppealProgress failed', err);
        }
    }

    function appealForItem(itemId) {
        const list = (state && state.completion && state.completion.raw_data && state.completion.raw_data.quiz_appeals) || [];
        return list.find(function (a) { return a && String(a.item_id) === String(itemId); }) || null;
    }

    function _openAppealsFromStudentPaper() {
        if (!state) return;
        const classId = state.classId;
        const assignmentId = state.assignmentId;
        const taskId = state.taskId;
        window.ModalOverlay.close(MODAL_ID);
        openAppealReview(classId, assignmentId, taskId);
    }

    function countPendingAppeals(completions) {
        let n = 0;
        (completions || []).forEach(function (c) {
            const list = c.raw_data && c.raw_data.quiz_appeals;
            if (Array.isArray(list)) n += list.filter(function (a) { return a && a.status === 'pending'; }).length;
        });
        return n;
    }

    /** 依 item_id + normalizeAnswer(申訴文字) 分組所有 pending 申訴，回傳陣列（依題號排序） */
    function buildAppealGroups(paper, completions, studentsById) {
        const itemsById = {};
        (paper.items || []).forEach(function (it) { itemsById[String(it.item_id)] = it; });
        const groups = {};
        completions.forEach(function (c) {
            const list = c.raw_data && c.raw_data.quiz_appeals;
            if (!Array.isArray(list)) return;
            list.forEach(function (a) {
                if (!a || a.status !== 'pending' || a.item_id == null) return;
                const norm = window.QuizPaperBuilder.normalizeAnswer(a.answer);
                const key = String(a.item_id) + '||' + norm;
                if (!groups[key]) {
                    groups[key] = {
                        key: key,
                        itemId: a.item_id,
                        answerText: a.answer,
                        answerNorm: norm,
                        item: itemsById[String(a.item_id)] || null,
                        students: []
                    };
                }
                groups[key].students.push({
                    completionId: c.id,
                    studentId: c.student_id,
                    studentName: (studentsById[String(c.student_id)] && studentsById[String(c.student_id)].name) || '未知學生',
                    studentNote: String(a.student_note || '')
                });
            });
        });
        return Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
            const sa = (a.item && a.item.seq) || 0;
            const sb = (b.item && b.item.seq) || 0;
            return sa - sb;
        });
    }

    /** 白名單命中提示：申訴文字若跟主答案或任一已接受答案是中央白名單的等價形式，顯示提示（仍需老師手動按可接受） */
    function whitelistHintForGroup(group) {
        if (!group.item || !window.QuizPaperBuilder || typeof window.QuizPaperBuilder.expandWithEquivalents !== 'function') return '';
        const QB = window.QuizPaperBuilder;
        const candidates = [group.item.answer_en].concat(group.item.accepted_answers || []);
        for (let i = 0; i < candidates.length; i++) {
            const variants = QB.expandWithEquivalents(QB.normalizeAnswer(candidates[i]));
            if (variants.indexOf(group.answerNorm) !== -1) {
                return '<span style="color:#7C3AED; font-weight:800; font-size:0.76rem;">💡 常見縮寫等價形式</span>';
            }
        }
        return '';
    }

    /**
     * 按下「可接受／不可接受」會立刻存檔，不再是「未儲存」狀態，所以這裡不再看
     * group.decision。唯一還會殘留在畫面、沒隨決定一起存檔的，是老師在「加入清單」
     * 打的其他可接受答案草稿（見 _addOtherAcceptedForGroup 的說明：這個動作只改畫面，
     * 要等同一組按下決定才會一起送出）——只有這種情況才算「尚未儲存」。
     */
    function isAppealDirty() {
        if (!appealState || appealState._loading) return false;
        if (appealState.paper && appealState.originalPaperJson
            && JSON.stringify(appealState.paper) !== appealState.originalPaperJson) {
            return true;
        }
        return false;
    }

    function mountOrPatchAppeal(contentHtml) {
        if (appealState && appealState._overlayBound && patchOverlayKeepScroll(PAGE_MODAL_ID, contentHtml)) {
            return;
        }
        window.ModalOverlay.open({
            id: PAGE_MODAL_ID,
            tier: 'B',
            contentHtml: contentHtml,
            isDirty: function () { return isAppealDirty(); },
            unsavedMessage: '有新增的可接受答案還沒隨審核決定存檔，確定要關閉嗎？',
            onClose: function () { appealState = null; }
        });
        if (appealState) appealState._overlayBound = true;
    }

    async function openAppealReview(classId, assignmentId, taskId) {
        const alreadyBound = !!(appealState && appealState._overlayBound && document.getElementById(PAGE_MODAL_ID));
        appealState = {
            classId: classId,
            assignmentId: assignmentId,
            taskId: taskId,
            groups: [],
            paper: null,
            originalPaperJson: '',
            _loading: true,
            _overlayBound: alreadyBound,
            errorText: ''
        };
        mountOrPatchAppeal(wrapPageShell('⏳ 載入申訴清單…', 820));
        appealState._overlayBound = true;
        try {
            const [assignment, completions, students] = await Promise.all([
                window.ApiQuizReview.fetchAssignment(assignmentId),
                window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId),
                window.ApiQuizReview.fetchClassStudents(classId)
            ]);
            const task = window.TaskScriptResolver.findTaskInTree(assignment.tasks, taskId);
            if (!task || !task.raw_data || !task.raw_data.quiz_paper) {
                throw new Error('找不到這個考試任務的線上卷內容');
            }
            const studentsById = {};
            students.forEach(function (s) { studentsById[String(s.id)] = s; });
            const paper = JSON.parse(JSON.stringify(task.raw_data.quiz_paper));
            if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.loadUniversalAcceptedAnswers === 'function') {
                await window.QuizPaperBuilder.loadUniversalAcceptedAnswers();
            }
            mergeUniversalAcceptedIntoPaper(paper);
            const groups = buildAppealGroups(paper, completions, studentsById);
            groups.forEach(function (g) {
                g.decision = null;
                g.addedByAccept = false;
            });
            appealState = {
                classId: classId,
                assignmentId: assignmentId,
                taskId: taskId,
                taskTitle: task.title || task.raw_data.exam_title || '(未命名考試)',
                paper: paper,
                originalPaperJson: JSON.stringify(paper),
                groups: groups,
                errorText: '',
                acceptedDrafts: {},
                _loading: false,
                _overlayBound: true
            };
            renderAppealReviewHtml();
        } catch (err) {
            console.error('[FeatureExamReview] openAppealReview', err);
            appealState = null;
            window.ModalOverlay.open({
                id: PAGE_MODAL_ID,
                tier: 'A',
                contentHtml: wrapPageShell('❌ 載入失敗：' + esc(err.message || err), 820) + closeFooterHtml(PAGE_MODAL_ID)
            });
        }
    }

    function appealChoiceBtnHtml(idx, decision, current, saving) {
        const selected = current === decision;
        const isAccept = decision === 'accepted';
        const label = isAccept ? '可接受' : '不可接受';
        const icon = isAccept ? '✅' : '❌';
        const onBg = isAccept ? '#059669' : '#DC2626';
        const offFg = isAccept ? '#047857' : '#B91C1C';
        const cursor = saving ? 'wait' : 'pointer';
        const style = selected
            ? 'padding:8px 16px; border:2px solid ' + onBg + '; border-radius:8px; background:' + onBg + '; color:#fff; font-weight:900; cursor:' + cursor + '; min-width:8em;' + (saving ? ' opacity:0.7;' : '')
            : 'padding:8px 16px; border:2px solid ' + onBg + '; border-radius:8px; background:#fff; color:' + offFg + '; font-weight:800; cursor:' + cursor + '; min-width:8em;' + (saving ? ' opacity:0.7;' : '');
        return '<button type="button" aria-pressed="' + (selected ? 'true' : 'false') + '" ' + (saving ? 'disabled ' : '')
            + 'onclick="window.FeatureExamReview._decideAppeal(' + idx + ', \'' + decision + '\')" style="' + style + '">'
            + (selected ? '● ' : '○ ') + icon + ' ' + label + '</button>';
    }

    function appealNotesHtml(group) {
        const rows = (group.students || []).map(function (s) {
            return { name: s.studentName, note: String(s.studentNote || '').trim() };
        }).filter(function (r) { return r.note; });
        if (!rows.length) return '';
        const body = (rows.length === 1 && (group.students || []).length === 1)
            ? '<div style="white-space:pre-wrap; color:#1E293B; font-weight:700;">' + esc(rows[0].note) + '</div>'
            : rows.map(function (r) {
                return '<div style="margin-top:4px; white-space:pre-wrap; color:#1E293B; font-weight:700;"><span style="font-weight:900;">' + esc(r.name) + '</span>：' + esc(r.note) + '</div>';
            }).join('');
        return '<div style="margin:6px 0 10px; padding:8px 10px; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px;">'
            + '<div style="font-size:0.75rem; font-weight:800; color:#6D28D9; margin-bottom:4px;">學生說明</div>'
            + body
            + '</div>';
    }

    function renderAppealGroupHtml(group, idx) {
        const item = group.item;
        const promptHtml = item ? esc(item.prompt_zh || '') : '（找不到這一題，可能考卷已改版）';
        const studentNames = group.students.map(function (s) { return esc(s.studentName); }).join('、');
        const hint = whitelistHintForGroup(group);
        const gotPlain = String(group.answerText || '').trim();
        const acceptedHtml = item
            ? acceptedPairsHtml(item, gotPlain, function (ai) {
                return 'window.FeatureExamReview._removeAcceptedForGroup(' + idx + ',' + ai + ')';
            })
            : '';
        const pairHtml = (item && gotPlain)
            ? alignedPairHtml(item.answer_en || '', gotPlain, '#DC2626')
            : '';
        const decided = group.decision;
        const saving = !!group._saving;
        const saveError = String(group._saveError || '').trim();
        // 按下「可接受／不可接受」會立刻存檔＋重批全班，不再是「先記畫面、最後才儲存提交」。
        const decisionNote = saving
            ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#7C3AED;">⏳ 儲存中…</div>'
            : (saveError
                ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B91C1C;">❌ ' + esc(saveError) + '（請重新點選一次）</div>'
                : (decided === 'accepted'
                    ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#047857;">✅ 已儲存：可接受</div>'
                    : (decided === 'rejected'
                        ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B91C1C;">✅ 已儲存：不可接受</div>'
                        : '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#7C3AED;">尚未選擇　請點選其中一顆（按下就會立刻存檔）</div>')));
        const cardBorder = decided === 'accepted' ? '#86EFAC' : (decided === 'rejected' ? '#FECACA' : '#DDD6FE');
        const cardBg = decided === 'accepted' ? '#F0FDF4' : (decided === 'rejected' ? '#FEF2F2' : '#FAF5FF');
        return '<div id="appeal-group-' + idx + '" style="border:1px solid ' + cardBorder + '; border-radius:10px; padding:12px 14px; margin-bottom:10px; background:' + cardBg + ';">'
            + '<div style="font-size:0.76rem; color:#7C3AED; font-weight:900; margin-bottom:4px;">' + esc(itemHeadline(item, item ? item.seq : '?')) + '　🚩 ' + group.students.length + ' 人申訴</div>'
            + '<div style="font-weight:800; color:#1E293B; margin-bottom:6px; white-space:pre-wrap;">' + promptHtml + '</div>'
            + '<div style="font-size:0.75rem; font-weight:800; color:#1E293B; margin-bottom:2px;">學生答案／正確答案'
            + '<span style="font-weight:700; color:#64748B;">（上排學生＝黑／錯深藍　下排解答＝黑／差異紅）</span> ' + hint + '</div>'
            + (pairHtml
                ? ('<div style="font-size:1rem; line-height:1.7; margin-bottom:6px;">' + pairHtml + '</div>')
                : ('<div style="font-size:1rem; font-weight:900; color:#B45309; margin-bottom:6px;">' + esc(group.answerText || '') + '</div>'
                    + '<div style="font-size:1rem; font-weight:800; color:#DC2626; line-height:1.7; white-space:pre-wrap; margin-bottom:6px;">' + (item ? esc(item.answer_en || '') : '') + '</div>'))
            + '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">'
                + appealChoiceBtnHtml(idx, 'accepted', decided, saving)
                + appealChoiceBtnHtml(idx, 'rejected', decided, saving)
            + '</div>'
            + (item ? paperScoreModeBtnsHtml(idx, item, '_toggleAppealPaperScore') : '')
            + decisionNote
            + '<div style="font-size:0.75rem; color:#94A3B8; margin:8px 0;">申訴學生：' + studentNames + '</div>'
            + appealNotesHtml(group)
            + acceptedHtml
            + addOtherAcceptedRowHtml(
                'appeal-other-ans-',
                idx,
                '_addOtherAcceptedForGroup',
                '_addAppealAcceptedInputRow',
                draftsFor(appealState, idx)
            )
            + '</div>';
    }

    /**
     * 決定已經逐組即決即存（見 _decideAppeal），這裡不再需要「儲存提交」——
     * 只留「關閉」；有未隨決定存檔的其他可接受答案草稿仍靠 isAppealDirty／unsavedMessage 擋一次。
     */
    function appealFooterHtml() {
        return '<div style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px; position:sticky; bottom:0; background:white; padding-top:8px;">'
            + '<button type="button" onclick="window.ModalOverlay.requestClose(\'' + PAGE_MODAL_ID + '\')" style="padding:9px 18px; border:1px solid #CBD5E1; border-radius:8px; background:#F1F5F9; font-weight:800; cursor:pointer;">關閉</button>'
            + '</div>';
    }

    function captureAllAppealDrafts() {
        if (!appealState || !Array.isArray(appealState.groups)) return;
        appealState.groups.forEach(function (_g, idx) {
            const cur = (appealState.acceptedDrafts && appealState.acceptedDrafts[idx]) || [''];
            if (!document.getElementById('appeal-other-ans-' + idx + '-0')) return;
            appealState.acceptedDrafts[idx] = captureDraftsFromDom('appeal-other-ans-', idx, cur.length);
        });
    }

    function renderAppealReviewHtml(keepElId) {
        captureAllAppealDrafts();
        if (keepElId) keepScrollElId = keepElId;
        const groupsHtml = appealState.groups.length
            ? appealState.groups.map(function (g, idx) { return renderAppealGroupHtml(g, idx); }).join('')
            : '<div style="padding:20px; text-align:center; color:#94A3B8; font-weight:700;">目前沒有待審申訴。</div>';
        const errHtml = appealState.errorText
            ? '<div style="margin-bottom:10px; padding:8px 10px; background:#FEF2F2; color:#B91C1C; font-weight:800; border-radius:8px;">' + esc(appealState.errorText) + '</div>'
            : '';
        const body = '<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                + '<button type="button" onclick="window.FeatureExamReview._backFromAppealReview()" style="background:none; border:none; color:#6D28D9; font-weight:800; cursor:pointer; padding:0;">← 返回學生清單</button>'
                + '<button type="button" onclick="window.FeatureExamReview._regradeWholeTaskFromAppealReview()" style="' + WHOLE_CLASS_REGRADE_BTN_STYLE + '" title="依目前試卷範本重算標準答案（維持原題），再重批全班已交卷學生。">' + WHOLE_CLASS_REGRADE_BTN_HTML + '</button>'
            + '</div>'
            + '<div style="font-size:0.8rem; color:#64748B; font-weight:700; margin-bottom:6px;">' + displayTaskTitle(appealState.taskTitle) + '</div>'
            + '<div style="font-size:0.78rem; color:#6D28D9; font-weight:700; margin-bottom:10px;">按下「可接受／不可接受」會立刻存檔並重批全班，學生端會同步看到審核進度，不用再按儲存。</div>'
            + errHtml
            + groupsHtml;
        mountOrPatchAppeal(wrapPageShell(body, 820) + appealFooterHtml());
    }

    /**
     * 按下「可接受／不可接受」立刻存檔＋重批全班，不再等最後一次「儲存提交」。
     * 存檔範圍維持全班掃描（regradeAndSaveTask 不加 onlyCompletionIds）：新增可接受答案後，
     * 其他寫一樣答案但沒申訴過的學生也要一起重批，縮小範圍會漏改（quiz-accepted-answers-invariant）。
     * 這一組目前累積的其他可接受答案草稿（_addOtherAcceptedForGroup 只改畫面，不隨自己單獨即存）
     * 也會跟著這次存檔一起送出，因為送的是整份 appealState.paper 快照。
     */
    async function _decideAppeal(idx, decision) {
        if (!appealState || appealState._loading) return;
        const group = appealState.groups[idx];
        if (!group || group._saving) return;
        if (decision === 'accepted' && !group.item) {
            appealState.errorText = '找不到這一題（可能考卷已改版），無法接受這個申訴';
            renderAppealReviewHtml('appeal-group-' + idx);
            return;
        }
        if (group.decision === 'accepted' && decision !== 'accepted' && group.addedByAccept && group.item) {
            window.QuizPaperBuilder.removeAcceptedAnswer(group.item, group.answerText);
            group.addedByAccept = false;
        }
        if (decision === 'accepted' && group.decision !== 'accepted' && group.item) {
            group.addedByAccept = !!window.QuizPaperBuilder.addAcceptedAnswer(group.item, group.answerText);
        }
        captureAllAppealDrafts();
        group.decision = decision;
        group._saving = true;
        group._saveError = '';
        appealState.errorText = '';
        renderAppealReviewHtml('appeal-group-' + idx);
        try {
            const paperChanged = JSON.stringify(appealState.paper) !== appealState.originalPaperJson;
            if (paperChanged) {
                const originalPaper = JSON.parse(appealState.originalPaperJson || '{}');
                if (window.ApiQuizReview && typeof window.ApiQuizReview.persistUniversalAcceptedDiff === 'function') {
                    await window.ApiQuizReview.persistUniversalAcceptedDiff(originalPaper, appealState.paper);
                }
                await window.ApiQuizReview.saveQuizPaperPatch(appealState.assignmentId, appealState.taskId, appealState.paper);
            }
            const result = await regradeAndSaveTask(appealState.assignmentId, appealState.taskId, appealState.paper, {
                beforeRegrade: function (c) {
                    const list = Array.isArray(c.raw_data && c.raw_data.quiz_appeals) ? c.raw_data.quiz_appeals : null;
                    if (!list) return false;
                    let mutated = false;
                    list.forEach(function (a) {
                        if (!a || a.status !== 'pending' || a.item_id == null) return;
                        const norm = window.QuizPaperBuilder.normalizeAnswer(a.answer);
                        if (String(a.item_id) === String(group.itemId) && norm === group.answerNorm) {
                            a.status = decision;
                            mutated = true;
                        }
                    });
                    return mutated;
                }
            });
            appealState.originalPaperJson = JSON.stringify(appealState.paper);
            group._saving = false;
            group._saveError = '';
            broadcastAppealProgress(appealState.assignmentId, appealState.taskId);
            window.showFlash && window.showFlash(
                '✅ 已儲存' + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : ''),
                result.failCount ? 'warning' : 'success'
            );
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(appealState.classId);
            }
            renderAppealReviewHtml('appeal-group-' + idx);
        } catch (err) {
            console.error('[FeatureExamReview] decideAppeal save', err);
            group._saving = false;
            group._saveError = '儲存失敗：' + (err.message || err);
            renderAppealReviewHtml('appeal-group-' + idx);
        }
    }

    /**
     * 「加入清單」跟這組申訴決定互相獨立：不會動任何申訴的 status，
     * 純粹是老師想到還有其他寫法也該算對時的捷徑。只先改畫面，等這組（或任一組）
     * 按下「可接受／不可接受」即決即存時，才跟著那次存檔一起送出（見 _decideAppeal）。
     */
    function _addOtherAcceptedForGroup(idx, row) {
        if (!appealState || appealState._loading) return;
        const group = appealState.groups[idx];
        if (!group || !group.item) return;
        captureAllAppealDrafts();
        row = Number(row) || 0;
        const drafts = draftsFor(appealState, idx);
        const val = drafts[row] || '';
        if (!String(val).trim()) return;
        const changed = window.QuizPaperBuilder.addAcceptedAnswer(group.item, val);
        if (!changed) {
            appealState.errorText = '這個答案已經在標準答案裡了';
            renderAppealReviewHtml('appeal-group-' + idx);
            return;
        }
        drafts[row] = '';
        appealState.errorText = '';
        renderAppealReviewHtml('appeal-group-' + idx);
    }

    function _addAppealAcceptedInputRow(idx) {
        if (!appealState || appealState._loading) return;
        captureAllAppealDrafts();
        draftsFor(appealState, idx).push('');
        renderAppealReviewHtml('appeal-group-' + idx);
        const n = draftsFor(appealState, idx).length;
        const el = document.getElementById('appeal-other-ans-' + idx + '-' + (n - 1));
        if (el) el.focus();
    }

    function _removeAcceptedForGroup(idx, ai) {
        if (!appealState || appealState._loading) return;
        const group = appealState.groups[idx];
        if (!group || !group.item) return;
        const val = (group.item.accepted_answers || [])[ai];
        if (val == null) return;
        window.QuizPaperBuilder.removeAcceptedAnswer(group.item, val);
        if (group.addedByAccept && normAns(val) === normAns(group.answerText)) {
            group.addedByAccept = false;
        }
        appealState.errorText = '';
        renderAppealReviewHtml('appeal-group-' + idx);
    }

    async function _backFromAppealReview() {
        if (!appealState) return;
        if (isAppealDirty()) {
            const ok = await window.ModalOverlay.confirm('有新增的可接受答案還沒隨審核決定存檔，確定要離開嗎？');
            if (!ok) return;
        }
        const classId = appealState.classId;
        const assignmentId = appealState.assignmentId;
        const taskId = appealState.taskId;
        appealState = null;
        await openTaskStudentList(classId, assignmentId, taskId);
    }

    /**
     * 「考試批改」學生清單頁的通用「重新批閱／整個班級」。
     * 先依目前試卷範本重算標準答案（維持原題），再重批全班；不必先「產生試卷」。
     * 標準答案優先用作業已存 meta，不強制重抓 Drive（120 題多活頁會在 GAS 上等到像卡住）。
     */
    async function _regradeWholeTask(classId, assignmentId, taskId) {
        function setBtn(label, disabled) {
            const el = document.getElementById('regrade-whole-task-btn');
            if (!el) return;
            el.disabled = !!disabled;
            if (label == null) {
                el.innerHTML = WHOLE_CLASS_REGRADE_BTN_HTML;
            } else {
                el.textContent = label;
            }
        }
        try {
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, true);
            setBtn('重算標準答案…', true);
            const refreshed = await refreshPaperAnswersFromTemplate(assignmentId, taskId, classId);
            setBtn('重批學生作答…', true);
            const result = await regradeAndSaveTask(assignmentId, taskId, refreshed.paper, { forceAll: true });
            window.showFlash && window.showFlash('✅ 已依試卷範本更新標準答案並重新批閱 ' + (result.savedIds || []).length + ' 位學生'
                + (refreshed.missing ? '（' + refreshed.missing + ' 題對不到 meta）' : '')
                + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : ''),
                (refreshed.missing || result.failCount) ? 'warning' : 'success');
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(classId);
            }
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, false);
            await openTaskStudentList(classId, assignmentId, taskId);
        } catch (err) {
            console.error('[FeatureExamReview] regradeWholeTask', err);
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, false);
            const status = document.getElementById('exam-review-page-error');
            if (status) {
                status.style.display = 'block';
                status.textContent = '重新批閱失敗：' + (err.message || err);
            }
        } finally {
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, false);
            setBtn(null, false);
        }
    }

    async function _regradeWholeTaskFromAppealReview() {
        if (!appealState) return;
        if (isAppealDirty()) {
            appealState.errorText = '還有新增的可接受答案沒有隨審核決定存檔，請先點選其中一組的可接受／不可接受';
            renderAppealReviewHtml();
            return;
        }
        try {
            appealState.errorText = '';
            renderAppealReviewHtml();
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, true);
            const result = await regradeAndSaveTask(appealState.assignmentId, appealState.taskId, appealState.paper, { forceAll: true });
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, false);
            window.showFlash && window.showFlash('✅ 已重新批閱 ' + (result.savedIds || []).length + ' 位學生'
                + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : ''), 'success');
        } catch (err) {
            console.error('[FeatureExamReview] regradeWholeTaskFromAppealReview', err);
            window.ModalOverlay.setBusy(PAGE_MODAL_ID, false);
            appealState.errorText = '重新批閱失敗：' + (err.message || err);
            renderAppealReviewHtml();
        }
    }

    return {
        renderEntryButton: renderEntryButton,
        renderReviewPage: renderReviewPage,
        openReview: openReview,
        _openTaskStudentList: openTaskStudentList,
        regradeTaskPaper: function (assignmentId, taskId, paper) {
            return regradeAndSaveTask(assignmentId, taskId, paper, { forceAll: true });
        },
        _regradeWholeTask: _regradeWholeTask,
        _toggleShowWrongOnly: _toggleShowWrongOnly,
        _addAccepted: _addAccepted,
        _addAcceptedInputRow: _addAcceptedInputRow,
        _removeAccepted: _removeAccepted,
        _toggleAlsoCorrect: _toggleAlsoCorrect,
        _togglePaperScore: _togglePaperScore,
        _toggleAppealPaperScore: _toggleAppealPaperScore,
        _startEditPrimary: _startEditPrimary,
        _cancelEditPrimary: _cancelEditPrimary,
        _confirmEditPrimary: _confirmEditPrimary,
        _save: _save,
        _regradeThisStudent: _regradeThisStudent,
        _openAppealReview: openAppealReview,
        _openAppealsFromStudentPaper: _openAppealsFromStudentPaper,
        _decideAppeal: _decideAppeal,
        _addOtherAcceptedForGroup: _addOtherAcceptedForGroup,
        _addAppealAcceptedInputRow: _addAppealAcceptedInputRow,
        _removeAcceptedForGroup: _removeAcceptedForGroup,
        _backFromAppealReview: _backFromAppealReview,
        _regradeWholeTaskFromAppealReview: _regradeWholeTaskFromAppealReview
    };
})();

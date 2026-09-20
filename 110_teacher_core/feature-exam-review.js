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

    /**
     * 💣 雷區（2026-09-19 老師回報「答案一跟答案二，禁止直接結合在一起」，附圖 7.1-6：
     * 兩排看起來一字不差卻標示❌錯誤）：一題多空格（分開比對，item.sub_answers.length > 1）
     * 舊版把每個空格的答案／標準答案各自 join(' ') 接成一整條字串，才丟給 alignedPairHtml
     * 逐字對齊——這樣做有兩個問題：①老師看不出「這一段」是第幾格的答案，空格 1 尾巴跟
     * 空格 2 開頭黏在一起，肉眼分不出邊界；②真正決定對錯的 isAcceptableAnswer 是逐格
     * 精準比對（見 gradeSubAnswerItem），但用來畫面顯示的字詞對齊（tokenizeWords 用
     * /\s+/ 切詞、丟掉空字串）會把「純粹接在字串尾端的空白」直接吃掉、兩排完全看不出差異
     * ——等於畫面能顯示的資訊量小於真正拿去判定對錯的資訊量，才會出現「兩排一模一樣卻
     * 判錯」。修法：每一格各自獨立跑一次 alignedPairHtml（自己跟自己比，不跟別格接起來），
     * 每一格中間強制換行，讓老師至少能對到「是哪一格」；至於「純空白差異在對齊畫面上仍是
     * 看不出來」這件事，屬於比對規則本身要不要對每格答案做頭尾空白 trim 的另一個決定，
     * 這裡不擅自決定，維持現有 normalizeAnswer 不動。
     */
    function subAnswerPrimaryPairsHtml(item, rawAnswer, expectedDiffColor) {
        const subAnswers = (item && Array.isArray(item.sub_answers)) ? item.sub_answers : [];
        const gotObj = (rawAnswer && typeof rawAnswer === 'object') ? rawAnswer : {};
        // 💣 雷區（2026-09-20「圖二根本沒有 blank 2」）：這一格自己的 answer_en／accepted_answers
        // 都是空的＝這一列教材根本沒有這個空格的標準答案。只認 QuizPaperBuilder.isRealSubAnswer
        // 這一把鑰匙（跟 gradeSubAnswerItem／renderItemRow／getItemExpectedParts 同一份，不各寫
        // 各的），整格不顯示——不是「尚未作答」，是這一格本來就不存在。
        const Q = window.QuizPaperBuilder;
        const isReal = (Q && typeof Q.isRealSubAnswer === 'function') ? Q.isRealSubAnswer : function (sa) {
            return !!(sa && (String(sa.answer_en || '').trim() || (Array.isArray(sa.accepted_answers) && sa.accepted_answers.length)));
        };
        const realSubAnswers = subAnswers.filter(isReal);
        return realSubAnswers.map(function (sa, i) {
            const subGotRaw = gotObj[sa.key];
            const subGot = (subGotRaw == null || typeof subGotRaw === 'object') ? '' : String(subGotRaw);
            const label = '第 ' + (i + 1) + ' 格（' + esc(sa.label || sa.key) + '）';
            const body = subGot
                ? ('<div style="font-size:1rem; line-height:1.7;">' + alignedPairHtml(sa.answer_en, subGot, expectedDiffColor) + '</div>')
                : '<span style="color:#94A3B8; font-weight:700;">（這格尚未作答）</span>';
            const marginBottom = (i < realSubAnswers.length - 1) ? '10px' : '0';
            return '<div style="margin-bottom:' + marginBottom + ';">'
                + '<div style="font-size:0.7rem; font-weight:800; color:#94A3B8; margin-bottom:2px;">' + label + '</div>'
                + body
                + '</div>';
        }).join('');
    }

    function normAns(text) {
        const Q = window.QuizPaperBuilder;
        if (Q && typeof Q.normalizeAnswer === 'function') return Q.normalizeAnswer(text);
        return String(text == null ? '' : text).trim();
    }

    /**
     * 學生答案／其他可接受寫法：單生卷與申訴審查同一把。
     *
     * 💣 雷區（2026-09-12 老師回報「下方答案是重複的兩筆？？？這是給我看還是給你看？」）：
     * 舊版「學生這次答案」對上「這筆可接受寫法」完全相同時（申訴接受多半就是直接照學生寫法
     * 收錄，兩者本來就會一模一樣），還是硬塞成上下兩排——印出兩行一字不差的文字，對老師
     * 沒有任何資訊量，只是版面雜訊。且完全沒有交代「這筆可接受寫法」跟「正確答案」之間的
     * 關係，老師看不出這筆寫法是正確答案的哪個變化（例如少了 (s)）。
     *
     * 改成兩層、由近到遠一層一層列出，跟老師要求的「應該要能一層一層地往回看」對齊：
     * ①學生答案／這筆——只有學生這次實際打的文字跟這筆逐字不同才顯示（完全相同時沒有
     *   資訊量，不重複印一次一模一樣的字）；
     * ②這筆／正確答案——一律顯示（除非這筆本身文字就跟正確答案完全相同，那也沒有差異
     *   可看，改顯示一句說明，不是印兩排一樣的字）。
     */
    function acceptedPairsHtml(item, studentPlain, removeCall) {
        const paperList = (item && item.accepted_answers) || [];
        const extra = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.extraAcceptedForItem === 'function')
            ? (window.QuizPaperBuilder.extraAcceptedForItem(item) || [])
            : [];
        const list = paperList.concat(extra);
        const primary = (item && item.answer_en) || '';
        const primaryN = normAns(primary);
        const studentTrim = String(studentPlain || '').trim();
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
            // ①學生答案／這筆：文字逐字相同就沒有資訊量，不印
            const aTrim = String(a || '').trim();
            const vsStudentHtml = (studentTrim && studentTrim !== aTrim)
                ? ('<div style="margin-bottom:6px;">'
                    + '<div style="font-size:0.72rem; font-weight:800; color:#64748B;">學生答案／這筆'
                    + '<span style="font-weight:700;">（上排學生＝黑／不同深藍　下排這筆＝黑／不同藍）</span></div>'
                    + '<div style="font-size:1rem; line-height:1.7;">' + alignedPairHtml(a, studentPlain, '#2563EB') + '</div>'
                    + '</div>')
                : '';
            // ②這筆／正確答案：往回看這筆跟官方標準答案差在哪，跟學生這次答案是什麼無關
            const isDupOfPrimary = !!(primaryN && n === primaryN);
            const vsPrimaryHtml = isDupOfPrimary
                ? '<div style="font-size:0.85rem; font-weight:700; color:#94A3B8;">（跟正確答案文字相同）</div>'
                : (primary
                    ? ('<div style="font-size:1rem; line-height:1.7;">' + alignedPairHtml(primary, a, '#B45309') + '</div>')
                    : ('<div style="font-size:1rem; font-weight:800; color:#1E293B; line-height:1.7; white-space:pre-wrap;">' + esc(a) + '</div>'));
            blocks.push('<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-top:8px; padding:8px 10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px;">'
                + '<div style="flex:1;">'
                    + vsStudentHtml
                    + '<div style="font-size:0.72rem; font-weight:800; color:#64748B;">這筆／正確答案'
                    + '<span style="font-weight:700;">（上排這筆＝黑／不同深藍　下排正確答案＝黑／不同橙）</span></div>'
                    + vsPrimaryHtml
                + '</div>'
                + removeHtml
                + '</div>');
        });
        if (!blocks.length) {
            return '<div style="margin-top:8px; font-size:0.8rem; color:#94A3B8; font-weight:700;">（沒有其他可接受寫法）</div>';
        }
        return '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed #E2E8F0;">'
            + '<div style="font-size:0.75rem; font-weight:800; color:#1E293B; margin-bottom:2px;">其他可接受寫法</div>'
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
                        taskTitle: t.title || '(未命名考試)',
                        allowWrongRetake: !!t.allowWrongRetake,
                        inputCorrectionEnabled: !!t.inputCorrectionEnabled
                    });
                });
            });
            // 班級人數＝該班真實學生名單（student_enrollments），跟考卷批改列學生同一份，
            // 不准借用 window.TeacherDB.classes[].students（那個欄位 classes 資料表沒有這欄，永遠是 []）。
            // 「▲批改標準待審核」（任務清單層級）：跟 openTaskStudentList 同一把鑰匙，只是這裡要
            // 一次涵蓋這個班級所有考試任務，用單一查詢（只選兩個布林旗標，不整份 raw_data）算出
            // 哪些任務有這個狀況，避免逐一任務各打一次查詢（見 page-refresh-perf-invariant 精神）。
            const assignmentIdsForWs = Array.from(new Set(examTasks.map(function (t) { return t.assignmentId; })));
            let wsIssueTaskKeys = new Set();
            try {
                wsIssueTaskKeys = await window.ApiQuizReview.fetchWhitespaceBoundaryIssueTaskKeys(assignmentIdsForWs);
            } catch (wsErr) {
                console.error('[FeatureExamReview] fetchWhitespaceBoundaryIssueTaskKeys', wsErr);
            }
            examTasks.forEach(function (t) {
                t.hasWhitespaceBoundaryIssue = wsIssueTaskKeys.has(String(t.assignmentId) + ':' + String(t.taskId));
            });
            const students = await window.ApiQuizReview.fetchClassStudents(classId);
            renderTaskListHtml(classId, sortExamTasksNewestFirst(examTasks), students.length);
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

    /** 讀 window.TeacherDB.classes 現有的班級名稱（只讀不重查 API；名稱這欄是真的，人數另外查真實名單）。 */
    function classNameOf(classId) {
        const cls = (window.TeacherDB && Array.isArray(window.TeacherDB.classes))
            ? window.TeacherDB.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        return (cls && cls.name) || '';
    }

    function classHeaderHtml(classId, studentCount) {
        const name = classNameOf(classId);
        if (!name && !studentCount) return '';
        return '<div style="margin-bottom:12px; padding:8px 12px; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">'
            + '<span style="font-weight:900; color:#6D28D9;">🏫 ' + esc(name || '(未命名班級)') + '</span>'
            + '<span style="font-weight:800; color:#7C3AED; font-size:0.85rem;">👥 ' + esc(studentCount || 0) + ' 位學生</span>'
            + '</div>';
    }

    /** 這個考試任務老師是否開了「重考錯題（僅一次）」／「錯題改正練習」，跟該任務自己的 raw_data 同一把鑰匙。 */
    function examTaskFeatureBadgesHtml(t) {
        const parts = [];
        if (t && t.allowWrongRetake) parts.push('<span style="color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; padding:1px 7px; border-radius:6px; font-size:0.72rem; font-weight:800;">🔁 錯題重考</span>');
        if (t && t.inputCorrectionEnabled) parts.push('<span style="color:#9A3412; background:#FFF7ED; border:1px solid #FDBA74; padding:1px 7px; border-radius:6px; font-size:0.72rem; font-weight:800;">🔧 錯題練習</span>');
        if (!parts.length) return '';
        return '<div style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap;">' + parts.join('') + '</div>';
    }

    function renderTaskListHtml(classId, examTasks, studentCount) {
        const safeClassId = String(classId).replace(/'/g, "\\'");
        const classHeader = classHeaderHtml(classId, studentCount);
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
                    + examTaskFeatureBadgesHtml(t)
                    + (t.hasWhitespaceBoundaryIssue
                        ? '<div style="margin-top:4px; font-size:0.78rem; color:#B45309; font-weight:900;">▲批改標準待審核</div>'
                        : '')
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
    /**
     * 💣 雷區（Phase 3｜考試批改邏輯修復）：wrongItems 原本只讀 raw.quiz_stats.wrong_items——
     * 那是交卷當下（或上次 regrade 存檔那一刻）凍結的名單。老師事後接受申訴／改標準答案／
     * 加可接受答案，這裡卻沒有跟著重算，會讓已經算對的題目仍然卡在「還要訂正」的清單裡，
     * 總題數／已完成題數對不上真正的批改結果。改成：傳入 live（liveQuizScore 現場重算的
     * gradeAnswers 結果，含最新 wrong_items），跟凍結名單取交集——只會讓題目「變少」（已經
     * 修好的題目退出清單），不會無故「變多」（沒 live 資料，或某題本來不在凍結名單，就算現在
     * 判定是錯的也不會被加進來——訂正練習的對象本來就該是交卷當下那批錯題，不是新錯題）。
     * @param {object|null} live liveQuizScore(paper, completion) 的回傳值，沒有（例如還沒作答）就退回凍結名單。
     */
    function correctionStatusOf(raw, task, live) {
        const enabled = !!(task && task.raw_data && task.raw_data.input_correction_enabled);
        if (!enabled) return null;
        const frozenWrongItems = (raw && raw.quiz_stats && Array.isArray(raw.quiz_stats.wrong_items)) ? raw.quiz_stats.wrong_items : [];
        if (!frozenWrongItems.length) return { total: 0, done: 0, allDone: true, noWrong: true };
        const liveWrongIds = (live && Array.isArray(live.wrong_items))
            ? new Set(live.wrong_items.map(function (d) { return String(d && d.item_id); }))
            : null;
        const wrongItems = liveWrongIds
            ? frozenWrongItems.filter(function (it) { return liveWrongIds.has(String(it && it.item_id)); })
            : frozenWrongItems;
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

    // 跟 countAcceptedAppeals 同一把鑰匙，只換 status（'rejected'＝申訴駁回）
    function countRejectedAppeals(raw) {
        const list = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.readQuizAppeals === 'function')
            ? window.QuizPaperBuilder.readQuizAppeals(raw)
            : ((raw && Array.isArray(raw.quiz_appeals)) ? raw.quiz_appeals : []);
        let n = 0;
        list.forEach(function (a) {
            if (a && String(a.status || '').trim().toLowerCase() === 'rejected') n += 1;
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
            // 💣 雷區（Phase 3｜考試批改邏輯修復）：跟 openReview／openAppealReview 同一把鑰匙——
            // 學生清單的分數也要先合併全站可接受答案（老師在別份考卷／教材庫接受過的答案，這份
            // 卷面尚未 bake 進去），否則這裡看到的分數會比實際批改（openReview 開下去）更低，
            // 兩邊對不起來。fetchAssignment 可能回傳 TeacherDB 快取的共用物件，quiz_paper 不能
            // 直接原地 mutate（會把 mergeUniversalAcceptedIntoPaper 加的答案意外寫進共用快取），
            // 這裡只是讀清單用的分數，跟 openReview 一樣先深拷貝一份再合併。
            const rawPaper = task && task.raw_data && task.raw_data.quiz_paper;
            let paper = rawPaper ? JSON.parse(JSON.stringify(rawPaper)) : null;
            if (paper) {
                if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.loadUniversalAcceptedAnswers === 'function') {
                    await window.QuizPaperBuilder.loadUniversalAcceptedAnswers();
                }
                mergeUniversalAcceptedIntoPaper(paper);
            }
            const byStudent = new Map();
            // 💣 雷區（Phase 5｜考試批改邏輯修復）：同一個學生同一個任務理論上只該有一筆
            // completion；若資料庫裡意外出現兩筆以上（例如兩台裝置搶著寫、後台補資料），
            // 舊版靜默用陣列裡「後面那筆」蓋掉「前面那筆」，老師完全看不出來、也不知道自己
            // 看到的是不是正確那筆。改成：兩筆都留著記錄，畫面顯示 updated_at 較新那筆（比較
            // 可能是最新作答結果），並在該學生列標紅字明確警示「這裡有 N 筆作答紀錄」，不再
            // 靜默覆蓋。
            const duplicateCompletionsByStudent = new Map();
            completions.forEach(function (c) {
                const key = String(c.student_id);
                const existing = byStudent.get(key);
                if (!existing) {
                    byStudent.set(key, c);
                    return;
                }
                const existingTime = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
                const currentTime = c.updated_at ? new Date(c.updated_at).getTime() : 0;
                const keep = currentTime >= existingTime ? c : existing;
                const other = currentTime >= existingTime ? existing : c;
                byStudent.set(key, keep);
                const list = duplicateCompletionsByStudent.get(key) || [];
                list.push(other);
                duplicateCompletionsByStudent.set(key, list);
            });

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
            // 「▲批改標準待審核」：跟申訴題同一個位置，但只在真的有這個狀況時才顯示
            // （不像申訴題永遠顯示「目前沒有待審」，老師要求這裡沒事就不要多一條）。
            const wsIssueStudentCount = countWhitespaceBoundaryIssueStudents(completions);
            const wsIssueBarHtml = wsIssueStudentCount > 0
                ? ('<div style="width:100%; padding:10px 14px; margin-bottom:10px; border:1px solid #FDE68A; border-radius:10px; background:#FFFBEB; color:#B45309; font-weight:900;">'
                    + '▲批改標準待審核　' + wsIssueStudentCount + ' 位學生</div>')
                : '';

            const rows = students.map(function (s) {
                const c = byStudent.get(String(s.id));
                const raw = c && c.raw_data;
                const live = liveQuizScore(paper, c);
                const qr = live || (raw && raw.quiz_result);
                const retake = raw && raw.quiz_retake;
                const acceptedN = countAcceptedAppeals(raw);
                const rejectedN = countRejectedAppeals(raw);
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
                if (rejectedN > 0) appealParts.push('<span style="color:#DC2626; font-weight:800;">申訴駁回 ' + rejectedN + ' 題</span>');
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
                // 空白題數：qr 是 live（regrade 出來，有 .details 但沒 .blank_count）或存好的
                // raw.quiz_result（有 .blank_count，這次修復之後才存的欄，舊資料沒有）。兩個都是
                // 這筆資料自己的正確來源，不是借別筆；兩個都沒有（regrade 失敗＋舊資料）才不顯示。
                const gradingParts = [];
                if (qr && qr.total != null) {
                    const blankN = Array.isArray(qr.details)
                        ? qr.details.filter(function (d) { return d && !d.excluded && !String(d.answer || '').trim(); }).length
                        : (raw && raw.quiz_result && raw.quiz_result.blank_count != null ? raw.quiz_result.blank_count : null);
                    if (blankN != null) gradingParts.push('空白 ' + blankN + ' 題');
                }
                const correction = correctionStatusOf(raw, task, live);
                if (correction && !correction.noWrong) {
                    gradingParts.push(correction.allDone
                        ? ('<span style="color:#047857;">✅ 錯題修正已完成 (' + correction.done + '/' + correction.total + ')</span>')
                        : ('<span style="color:#D97706;">🔧 錯題修正進行中 (' + correction.done + '/' + correction.total + ')</span>'));
                }
                const gradingLineHtml = gradingParts.length
                    ? ('<div style="margin-top:2px; font-size:0.75rem; color:#64748B; font-weight:700;">' + gradingParts.join(' · ') + '</div>')
                    : '';
                // 「▲批改標準待審核」：這位學生的作答卷裡有沒有頭尾空白差異、待老師決定是否過關。
                const wsIssueLineHtml = wsIssueOfCompletion(qr, raw)
                    ? '<div style="margin-top:2px; font-size:0.75rem; color:#B45309; font-weight:800;">▲批改標準待審核</div>'
                    : '';
                // Phase 5：這個學生底下如果有其他被蓋掉的重複 completion，明確標紅字警示，
                // 不要靜默用較新那筆蓋過去、讓老師完全不知道資料有異常。
                const dupList = duplicateCompletionsByStudent.get(String(s.id));
                const dupWarningHtml = (dupList && dupList.length)
                    ? ('<div style="margin-top:4px; font-size:0.75rem; color:#DC2626; font-weight:800;">⚠️ 這位學生有 '
                        + (dupList.length + 1) + ' 筆作答紀錄（可能是重複繳交／資料異常），畫面只顯示最新一筆，請人工確認。</div>')
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
                    + wsIssueLineHtml
                    + dupWarningHtml
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
                + wsIssueBarHtml
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
     * 2026-09-12 老師確認：全站可接受答案庫（quiz_item_accepted_answers，跨作業共用）跟這份
     * 考卷自己的 quiz_paper patch，兩個都是「存卷面」的一部分，但重要性不同──quiz_paper
     * patch 直接決定這位／這些學生的分數對錯，是必須成功的；全站庫只是輔助快取（下次出題
     * 時的建議清單），失敗不影響這份考卷已經生效的結果。原本兩者依序 await、沒有任何一方
     * 失敗時的處理，若後者（saveQuizPaperPatch）失敗，前者（persistUniversalAcceptedDiff）
     * 已經寫入 DB 卻無法回滾，會出現「全站庫已更新，這份考卷卻沒存到」的落差。
     * 改成：先存 quiz_paper（失敗就整個丟出去，跟以前一樣讓呼叫端的 catch 處理、不視為
     * 已存檔）；成功後才嘗試同步全站庫，全站庫若失敗只回傳警告文字，不影響已經成功的
     * quiz_paper（不能因為這個輔助動作失敗，就讓老師以為整個存檔都失敗、重按一次又重複
     * 寫入 quiz_paper patch）。
     * @returns {Promise<{ universalWarning: string }>} universalWarning 非空代表全站庫同步失敗，
     *   但 quiz_paper 本身已經存檔成功，呼叫端要把這段文字附加告知老師，不能吞掉。
     */
    async function savePaperWithUniversalDiff(assignmentId, taskId, originalPaper, nextPaper) {
        await window.ApiQuizReview.saveQuizPaperPatch(assignmentId, taskId, nextPaper);
        let universalWarning = '';
        if (window.ApiQuizReview && typeof window.ApiQuizReview.persistUniversalAcceptedDiff === 'function') {
            try {
                await window.ApiQuizReview.persistUniversalAcceptedDiff(originalPaper, nextPaper);
            } catch (err) {
                console.error('[FeatureExamReview] persistUniversalAcceptedDiff', err);
                universalWarning = '（這份考卷已存檔，但全站可接受答案庫同步失敗：' + (err.message || err) + '，下次出題可能少列這個建議答案，不影響這份考卷已生效的結果）';
            }
        }
        return { universalWarning: universalWarning };
    }

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
     * @param {object} [opts.authoritativeAppealItemIds] {itemIdString:true}，這次是老師剛剛在
     *   畫面上明確做的申訴決定（見 QuizPaperBuilder.mergeQuizAppeals 說明，2026-09-12）：這幾個
     *   item_id 的申訴狀態允許跳過等級保護、真正改判（例如已接受改回不可接受）。
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
            ? await window.ApiQuizReview.batchSaveCompletions(toSave, opts.authoritativeAppealItemIds)
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
            // Phase 5：跟 openTaskStudentList 同一把鑰匙——同一學生理論上只會有一筆 completion，
            // 萬一資料庫裡意外有兩筆以上，一律取 updated_at 較新那筆（跟清單畫面顯示的那筆一致），
            // 不要讓「清單上看到的分數」跟「點進去看到的這份」是兩筆不同的資料。
            const sameStudentCompletions = completions.filter(function (c) { return String(c.student_id) === String(studentId); });
            const completion = sameStudentCompletions.length
                ? sameStudentCompletions.reduce(function (best, c) {
                    if (!best) return c;
                    const bestTime = best.updated_at ? new Date(best.updated_at).getTime() : 0;
                    const cTime = c.updated_at ? new Date(c.updated_at).getTime() : 0;
                    return cTime >= bestTime ? c : best;
                }, null)
                : null;
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
                // Phase 4：這份任務全班學生名單（跟其他資料一起抓好，見上面 Promise.all），
                // 存檔失敗要列出「誰」失敗，不只顯示數字，共用 describeFailedStudents。
                students: students,
                taskTitle: task.title || task.raw_data.exam_title || '(未命名考試)',
                paper: paper,
                originalPaperJson: JSON.stringify(paper),
                completion: completion,
                answers: (completion && completion.raw_data && completion.raw_data.quiz_answers) || {},
                // 分頁篩選（完整考卷／全部錯題／書寫錯題／空白未填題／申訴成功／申訴駁回），取代原本
                // 單一的「只顯示錯題／未作答」checkbox；預設落在 'wrong'，等同原 checkbox 打勾的畫面。
                listKind: 'wrong',
                editingPrimaryIdx: null,
                // 開窗當下凍結「本來就對／已排除計分」的題目 id 集合，'wrong'／'wrong_answered'／'blank'
                // 三個分頁共用，避免老師編輯過程中題目在畫面上跳出跳入（wasHiddenOnOpen 讀這份）。
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

    /**
     * 💣 雷區（Phase 3｜考試批改邏輯修復）：QuizPaperBuilder.gradeAnswers 對 `award`（送分）
     * 模式一律 ok=true（不管有沒有作答），對 `exclude`（不計分）模式標 excluded=true——這兩件
     * 事都已經算在這裡回傳的 detail 裡。舊版 renderItemRow／itemIsCorrectOrEmpty 卻自己另外
     * 用 `hasAnswer &&` 把這個已經算好的 ok 蓋掉，讓「已送分但沒作答」的題目在畫面上仍顯示
     * 「⚠ 未作答」（該顯示「✅ 正確（送分）」），也讓「只顯示錯題／未作答」把送分題／不計分題
     * 誤判成需要複查的錯題。統一改讀這裡回傳的完整 detail（含 ok／excluded），不要再另外用
     * hasAnswer 二次判斷對錯。
     */
    function itemGradeDetail(it) {
        const g = (state && state.liveGrade) || gradeCurrentStudent();
        return g.detailsById[String(it && it.item_id)] || {};
    }

    function itemOkFromGrade(it) {
        return !!(itemGradeDetail(it).ok === true);
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
                + '<div style="font-size:0.78rem; color:#64748B;">' + live.correct + ' / ' + denom + ' 題　' + savedScoreHtml + '</div>'
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
        const toggleHtml = teacherAppealSummaryHtml(state.completion && state.completion.raw_data)
            + '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">'
            + renderListKindToggleHtml(items, state.listKind)
            + appealEntryHtml
            + '</div>';

        const emptyMsg = (LIST_KIND_EMPTY_HTML[state.listKind] && !hasAnyVisibleRow(items, state.listKind))
            ? LIST_KIND_EMPTY_HTML[state.listKind]
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

    /** 「只顯示錯題／未作答」要隱藏的列：真的答對，或這題不計分（exclude）／已送分（award，
     * detail.ok 已被 gradeAnswers 強制設 true）。沒作答但沒被排除計分、也沒送分才算「要看」。 */
    function itemIsCorrectOrEmpty(it) {
        const d = itemGradeDetail(it);
        return !!(d.excluded || d.ok === true);
    }

    /**
     * 分頁篩選鑰匙（跟 [120_student_core/feature-student-quiz.js] 的 REVIEW_LIST_KINDS 同一組
     * 分頁名稱與涵義，兩端用詞統一，只是這裡是老師編輯視角）：
     * - full：一律顯示
     * - wrong：開窗當下不是「本來就對／已排除計分」的題（沿用 wasHiddenOnOpen 凍結判斷，等同原本
     *   「只顯示錯題／未作答」checkbox 打勾的效果，不因老師編輯途中改變而跳出跳入）
     * - wrong_answered：wrong 再篩「有作答」
     * - blank：wrong 再篩「沒作答」
     * - appealed_accepted／appealed_rejected：這題的申訴分別是「已接受」／「已駁回」
     *   （跟開窗當下是否算錯無關，appealForItem 讀最新狀態）
     */
    function matchesListKind(item, kind) {
        if (kind === 'full') return true;
        if (kind === 'appealed_accepted') {
            const a = appealForItem(item.item_id);
            return !!(a && a.status === 'accepted');
        }
        if (kind === 'appealed_rejected') {
            const a = appealForItem(item.item_id);
            return !!(a && a.status === 'rejected');
        }
        const isWrongAtOpen = !wasHiddenOnOpen(item);
        if (kind === 'wrong') return isWrongAtOpen;
        const hasAnswer = !!String(gotPlainOf(item)).trim();
        if (kind === 'wrong_answered') return isWrongAtOpen && hasAnswer;
        if (kind === 'blank') return isWrongAtOpen && !hasAnswer;
        return true;
    }

    function hasAnyVisibleRow(items, kind) {
        return items.some(function (it) { return matchesListKind(it, kind); });
    }

    // 用詞統一（2026-09-12 老師要求，跟學生端 REVIEW_LIST_KINDS 同一組名稱）：
    // 「只看錯題」→「全部錯題」；「只看寫錯題」→「書寫錯題」；「只看空白未填題」→「空白未填題」；
    // 「只看申訴題」拆成兩顆連體按鈕：「申訴成功」／「申訴駁回」。
    const LIST_KIND_ORDER = ['full', 'wrong', 'wrong_answered', 'blank', 'appealed_accepted', 'appealed_rejected'];
    const LIST_KIND_LABEL = {
        full: '完整考卷',
        wrong: '全部錯題',
        wrong_answered: '書寫錯題',
        blank: '空白未填題',
        appealed_accepted: '申訴成功',
        appealed_rejected: '申訴駁回'
    };
    const LIST_KIND_EMPTY_HTML = {
        wrong: '<div style="padding:16px; text-align:center; color:#047857; font-weight:800; background:#ECFDF5; border-radius:10px;">本次全對，沒有錯題／缺答。</div>',
        wrong_answered: '<div style="padding:16px; text-align:center; color:#047857; font-weight:800; background:#ECFDF5; border-radius:10px;">沒有「寫了但答錯」的題目。</div>',
        blank: '<div style="padding:16px; text-align:center; color:#047857; font-weight:800; background:#ECFDF5; border-radius:10px;">沒有空白未填的題目。</div>',
        appealed_accepted: '<div style="padding:16px; text-align:center; color:#7C3AED; font-weight:800; background:#F5F3FF; border-radius:10px;">目前沒有申訴成功的題目。</div>',
        appealed_rejected: '<div style="padding:16px; text-align:center; color:#7C3AED; font-weight:800; background:#F5F3FF; border-radius:10px;">目前沒有申訴駁回的題目。</div>'
    };
    // 連體按鈕組（畫面上緊貼在一起顯示，見 renderListKindToggleHtml）；學生端
    // REVIEW_LIST_KIND_CONJOINED_PAIRS 同一把鑰匙，兩端配對一致。
    const LIST_KIND_CONJOINED_PAIRS = [['appealed_accepted', 'appealed_rejected']];

    /** 每顆分頁鈕的主色：申訴成功／申訴駁回沿用全站對錯配色（綠／紅），其餘維持原本 teal。
     * 跟學生端 reviewKindButtonColor 同一把鑰匙，兩端配色一致。 */
    function listKindButtonColor(id) {
        if (id === 'appealed_accepted') return { base: '#047857', offBorder: '#86EFAC' };
        if (id === 'appealed_rejected') return { base: '#DC2626', offBorder: '#FECACA' };
        return { base: '#0F766E', offBorder: '#99F6E4' };
    }

    /** 按鈕內文兩行：上面標籤、下面題數。跟學生端 reviewKindButtonInnerHtml 同一把鑰匙。 */
    function listKindButtonInnerHtml(label, count) {
        return '<span style="display:block; line-height:1.15;">' + esc(label) + '</span>'
            + '<span style="display:block; line-height:1.15; font-size:0.72em; font-weight:700; margin-top:2px;">' + count + ' 題</span>';
    }

    /**
     * 五分頁＋一組連體按鈕（申訴成功／申訴駁回，中間無縫接、只有最外側圓角），題數直接讀
     * matchesListKind 對這份 paper.items 的篩選結果，跟畫面上真正會列出的題目同一份，不會
     * 跟切換後看到的清單對不起來。跟學生端 renderReviewListKindToggleHtml 同一套版式。
     */
    function renderListKindToggleHtml(items, currentKind) {
        const countFor = function (kind) { return (items || []).filter(function (it) { return matchesListKind(it, kind); }).length; };
        const singleButtonHtml = function (id) {
            const on = id === currentKind;
            const colors = listKindButtonColor(id);
            const bg = on ? colors.base : '#FFFFFF';
            const color = on ? '#FFFFFF' : colors.base;
            const border = on ? ('1px solid ' + colors.base) : ('1px solid ' + colors.offBorder);
            return '<button type="button" onclick="window.FeatureExamReview._setListKind(\'' + id + '\')" '
                + 'style="background:' + bg + '; color:' + color + '; border:' + border
                + '; border-radius:8px; padding:6px 12px; font-weight:800; cursor:pointer; text-align:center;">'
                + listKindButtonInnerHtml(LIST_KIND_LABEL[id], countFor(id)) + '</button>';
        };
        const conjoinedIds = {};
        LIST_KIND_CONJOINED_PAIRS.forEach(function (pair) { pair.forEach(function (id) { conjoinedIds[id] = pair; }); });
        const done = {};
        const parts = LIST_KIND_ORDER.map(function (id) {
            if (done[id]) return '';
            const pair = conjoinedIds[id];
            if (!pair) {
                done[id] = true;
                return singleButtonHtml(id);
            }
            pair.forEach(function (pid) { done[pid] = true; });
            const pairHtml = pair.map(function (pid, idx) {
                const on = pid === currentKind;
                const colors = listKindButtonColor(pid);
                const bg = on ? colors.base : '#FFFFFF';
                const color = on ? '#FFFFFF' : colors.base;
                const border = on ? ('1px solid ' + colors.base) : ('1px solid ' + colors.offBorder);
                const radius = idx === 0 ? '8px 0 0 8px' : '0 8px 8px 0';
                const trim = idx === 0 ? ' border-right-width:0;' : '';
                return '<button type="button" onclick="window.FeatureExamReview._setListKind(\'' + pid + '\')" '
                    + 'style="background:' + bg + '; color:' + color + '; border:' + border + ';' + trim
                    + ' border-radius:' + radius + '; padding:6px 12px; font-weight:800; cursor:pointer; text-align:center;">'
                    + listKindButtonInnerHtml(LIST_KIND_LABEL[pid], countFor(pid)) + '</button>';
            }).join('');
            return '<div style="display:inline-flex;">' + pairHtml + '</div>';
        }).join('');
        return '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:stretch;">' + parts + '</div>';
    }

    /**
     * 申訴進度摘要列（對照 [120_student_core/feature-student-quiz.js] 的 renderAppealSummaryHtml，
     * 只取第一段——這位學生自己的 pending/accepted/rejected 計數，不含全班進度，那是另一個概念）。
     * 沒有任何申訴紀錄就回空字串，跟學生端同一把鑰匙：有資料才顯示。
     */
    function teacherAppealSummaryHtml(raw) {
        const list = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.readQuizAppeals === 'function')
            ? window.QuizPaperBuilder.readQuizAppeals(raw)
            : ((raw && Array.isArray(raw.quiz_appeals)) ? raw.quiz_appeals : []);
        if (!list.length) return '';
        let pending = 0, accepted = 0, rejected = 0;
        list.forEach(function (a) {
            const s = a && String(a.status || '').trim().toLowerCase();
            if (s === 'accepted') accepted += 1;
            else if (s === 'rejected') rejected += 1;
            else if (s === 'pending') pending += 1;
        });
        return '<div style="margin-bottom:10px; padding:10px 12px; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; font-weight:800; color:#5B21B6; font-size:0.85rem;">'
            + '🚩 申訴進度：審核中 ' + pending + ' · 已接受 ' + accepted + ' · 已駁回 ' + rejected + '</div>';
    }

    function renderItemRow(idx) {
        const item = state.paper.items[idx];
        const gotPlain = gotPlainOf(item);
        const hasAnswer = !!String(gotPlain).trim();
        const appeal = appealForItem(item.item_id);
        // 2026-09-12（Phase 3）：不再用 hasAnswer 蓋掉 itemOkFromGrade——送分（award）模式
        // gradeAnswers 已經強制 ok=true，不管有沒有作答；這裡直接沿用那個結果，畫面才會跟
        // 真正的批改邏輯一致。checkbox（也算對）只在 hasAnswer 時出現，不受影響。
        const isCorrect = itemOkFromGrade(item);

        if (!matchesListKind(item, state.listKind)) {
            return '<div id="qr-row-' + idx + '" style="display:none;"></div>';
        }

        // 一題多空格（分開比對）：每一格各自對齊顯示、中間換行，禁止把答案一／答案二
        // 直接結合成一整條字串再一起比對／顯示（見 subAnswerPrimaryPairsHtml 上方雷區說明）。
        const isSubAnswerItem = Array.isArray(item.sub_answers) && item.sub_answers.length > 1;
        const primaryPair = isSubAnswerItem
            ? subAnswerPrimaryPairsHtml(item, state && state.answers ? state.answers[item.item_id] : null, '#DC2626')
            : (hasAnswer ? alignedPairHtml(item.answer_en, gotPlain, '#DC2626') : '');
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
        const scoreExcluded = scoreMode === 'exclude';
        const scoreMark = scoreMode === 'award'
            ? ' <span style="color:#047857;">送分</span>'
            : (scoreExcluded ? ' <span style="color:#57534E;">不計分</span>' : '');
        // 2026-09-12（Phase 3）：未作答分兩種——①不計分（exclude）：這題根本不算進分數，
        // 顯示中性的「不計分」，不要跟著喊「⚠ 未作答」；②沒被排除、也沒送分：維持原本
        // 「⚠ 未作答」警示。送分（award）題已經讓 isCorrect 強制 true，走下面一般分支就會
        // 顯示「✅ 正確（送分）」，不用再另外判斷 hasAnswer。
        const statusBadge = (!hasAnswer && scoreExcluded)
            ? '<span style="color:#94A3B8;">－ 不計分</span>'
            : ((!hasAnswer && !isCorrect)
                ? '<span style="color:#94A3B8;">⚠ 未作答</span>' + scoreMark
                : ((appeal && appeal.status === 'accepted')
                    ? '<span style="color:#047857;">申訴成功</span>' + scoreMark
                    : (pendingAccept
                        ? '<span style="color:#B45309;">待確認算對（未儲存）</span>' + scoreMark
                        : (isCorrect ? '<span style="color:#047857;">✅ 正確</span>' : '<span style="color:#DC2626;">❌ 錯誤</span>') + scoreMark)));
        const appealHtml = appeal
            ? (appeal.status === 'accepted'
                ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#047857;">✅ 申訴成功</div>'
                : (appeal.status === 'rejected'
                    ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#DC2626;">❌ 申訴駁回</div>'
                    : '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B45309;">🚩 申訴審核中</div>'))
            : '';

        const cardBorder = pendingAccept ? '#FDBA74' : ((!hasAnswer && scoreExcluded) ? '#E2E8F0' : (isCorrect ? '#D1FAE5' : '#FECACA'));
        const cardBg = pendingAccept ? '#FFFBEB' : ((!hasAnswer && scoreExcluded) ? '#F8FAFC' : (isCorrect ? '#F0FDF4' : '#FFF7F7'));
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

    function _setListKind(kind) {
        if (!state || !LIST_KIND_LABEL[kind]) return;
        state.listKind = kind;
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
        // 老師點了送分切換＝對這一題明確確認，之後任一組決定都可以帶著這題一起送出。
        if (!appealState._confirmedItemIds) appealState._confirmedItemIds = {};
        appealState._confirmedItemIds[String(group.itemId)] = true;
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
            const paperSaveResult = await savePaperWithUniversalDiff(state.assignmentId, state.taskId, originalPaper, state.paper);

            // 目前這位學生一律強制寫入（即使 regrade 判定沒變動，維持跟以前一樣的行為），
            // 其他同任務學生只寫入真的有變動的——都靠共用 helper 一次搞定。
            const forceIds = state.completion ? [state.completion.id] : [];
            const result = await regradeAndSaveTask(state.assignmentId, state.taskId, state.paper, { forceIds: forceIds });

            // 💣 雷區（Phase 4｜考試批改邏輯修復）：目前這位學生已經用 forceIds 強制排進這次
            // batchSaveCompletions，但強制排進去 ≠ 保證寫入成功——batchSaveCompletions 逐筆
            // try/catch，這位學生自己那筆也可能失敗。舊版完全沒檢查，直接當作「這位學生已存」
            // 關 modal＋顯示 ✅，把失敗誤報成功。這裡先確認這位學生的 completion id 不在
            // result.errors 裡才能視為成功；在裡面就要留在畫面上顯示錯誤，不能關窗。
            const myError = state.completion
                ? (result.errors || []).find(function (e) { return String(e.id) === String(state.completion.id); })
                : null;
            if (myError) {
                state.saveError = '儲存失敗：' + (myError.message || '寫入失敗，請重試') + '（試卷標準答案已存檔，只有這位學生的批改結果沒存到，可再按一次儲存重試）';
                window.ModalOverlay.setBusy(MODAL_ID, false);
                const saveBtnAgain = document.getElementById('qr-save-btn');
                if (saveBtnAgain) { saveBtnAgain.disabled = false; saveBtnAgain.textContent = '💾 儲存並重新批改'; }
                rerenderAll();
                return;
            }

            if (state.completion) {
                const regradedCurrent = window.QuizPaperBuilder.regradeCompletionRawData(state.paper, state.completion.raw_data);
                state.completion.raw_data = regradedCurrent.rawData;
            }

            const otherErrors = (result.errors || []).filter(function (e) {
                return !state.completion || String(e.id) !== String(state.completion.id);
            });
            // otherOkCount 用 result.okCount（真正成功數）扣掉這位學生自己（已確認成功），
            // 不用 savedIds.length——savedIds 其實是「嘗試」數，包含寫入失敗的那幾筆。
            const otherOkCount = Math.max(0, (result.okCount || 0) - (state.completion ? 1 : 0));
            const otherSummary = (otherOkCount > 0
                ? '，並重新批改了其他 ' + otherOkCount + ' 位學生的分數'
                : '') + (otherErrors.length ? '（' + describeFailedStudents(otherErrors, state.students) + '，請重試）' : '') + paperSaveResult.universalWarning;

            state.originalPaperJson = JSON.stringify(state.paper);
            state.saveError = '';
            window.showFlash && window.showFlash(
                '✅ 已儲存批改結果' + otherSummary,
                (otherErrors.length || paperSaveResult.universalWarning) ? 'warning' : 'success'
            );
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(state.classId);
            }
            // 2026-09-12 老師確認（Phase 2.1）：老師「任何存檔」都要廣播全班，不限申訴過的
            // 學生——這裡跟改標準答案／accepted_answers 直接相關，最該廣播的一次存檔。
            broadcastAppealProgress(state.assignmentId, state.taskId);
            // 💣 雷區（2026-09-18 老師回報「申訴儲存後會自動關閉，應該要留在原來的畫面，
            // 老師可能還要看啊」）：這裡以前存檔成功就直接 ModalOverlay.close(MODAL_ID)，
            // 老師剛看著這位學生的申訴題、想順便再核對別題或繼續看批改明細，畫面卻被強制
            // 關掉。改成跟「整班申訴審查」畫面（_decideAppeal）同一套做法：存檔成功留在
            // 原本的畫面，只把 busy 解除＋局部重繪（isDirty 已經因為 originalPaperJson 剛
            // 更新過變成 false，footerHtml 會自動把「儲存並重新批改」按鈕換成灰色「沒有
            // 變更」，不會讓老師誤以為還能重按）。要離開由老師自己按「關閉」或點灰色背景。
            window.ModalOverlay.setBusy(MODAL_ID, false);
            rerenderAll();
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
            const result = await regradeAndSaveTask(state.assignmentId, state.taskId, state.paper, {
                onlyCompletionIds: [state.completion.id],
                forceAll: true
            });
            // 💣 雷區（Phase 4）：只重批這一位學生，onlyCompletionIds 只會有這一筆，但仍要真的
            // 檢查有沒有寫入失敗——舊版完全不看 result，寫入失敗也一律顯示 ✅ 成功。
            const myError = (result.errors || []).find(function (e) { return String(e.id) === String(state.completion.id); });
            if (myError) {
                state.saveError = '重新批閱失敗：' + (myError.message || '寫入失敗，請重試') + '（標準答案已依範本更新，只有這位學生的批改結果沒存到，可再按一次重新批閱重試）';
                rerenderAll();
                return;
            }
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
            broadcastAppealProgress(state.assignmentId, state.taskId);
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

    /**
     * 「▲批改標準待審核」（頭尾空白差異，見 QuizPaperBuilder.isWhitespaceBoundaryOnlyMismatch）：
     * 這位學生是否存在這個狀況。qr 可能是 liveQuizScore 現場重批的結果（帶
     * has_whitespace_boundary_issue，跟存好的 raw.quiz_result 同一把鑰匙算出來的），也可能就是
     * 存好的 raw.quiz_result 本身；quiz_retake 目前不做現場重批（跟這支檔案其他地方一致），
     * 只讀存好的 raw.quiz_retake.result。
     */
    function wsIssueOfCompletion(qr, raw) {
        return !!(qr && qr.has_whitespace_boundary_issue)
            || !!(raw && raw.quiz_retake && raw.quiz_retake.result && raw.quiz_retake.result.has_whitespace_boundary_issue);
    }

    /** 跟 countPendingAppeals 同一把鑰匙：算這個任務裡有幾位學生存在「▲批改標準待審核」。 */
    function countWhitespaceBoundaryIssueStudents(completions) {
        let n = 0;
        (completions || []).forEach(function (c) {
            const raw = c && c.raw_data;
            if (wsIssueOfCompletion(raw && raw.quiz_result, raw)) n += 1;
        });
        return n;
    }

    function countPendingAppeals(completions) {
        let n = 0;
        (completions || []).forEach(function (c) {
            const list = c.raw_data && c.raw_data.quiz_appeals;
            // 跟 countAcceptedAppeals 同一把鑰匙：status 一律先 toLowerCase() 再比對，避免資料裡
            // 混進大小寫不同的 'Pending'／'PENDING' 被漏算（老師端待審數跟真正 pending 筆數對不起來）。
            if (Array.isArray(list)) n += list.filter(function (a) { return a && String(a.status || '').trim().toLowerCase() === 'pending'; }).length;
        });
        return n;
    }

    /**
     * Phase 4（考試批改邏輯修復）：批次寫入失敗要看得到「誰」失敗，不能只顯示一個數字讓
     * 老師自己猜。統一在 _save／_regradeThisStudent／整班重批／申訴決定共用這支，把
     * errors[].student_id 對班級名冊換成姓名；名冊裡找不到（理論上不該發生，但不准假裝
     * 沒有這個人）才退回顯示 student_id 本身，不丟資料。
     * @param {Array<{id:string, student_id:string, message?:string}>} errors
     * @param {Array<{id:string, name:string}>|Object} studentsSource 班級學生名單陣列，或已經
     *   建好的 { [studentId]: {name} } 對照表（兩種都接受，呼叫端手上有哪種就傳哪種）
     * @returns {string} 空字串代表沒有失敗；否則回「N 位寫入失敗：姓名、姓名」
     */
    function describeFailedStudents(errors, studentsSource) {
        if (!errors || !errors.length) return '';
        const byId = {};
        if (Array.isArray(studentsSource)) {
            studentsSource.forEach(function (s) { if (s && s.id != null) byId[String(s.id)] = s.name; });
        } else if (studentsSource && typeof studentsSource === 'object') {
            Object.keys(studentsSource).forEach(function (k) {
                const s = studentsSource[k];
                byId[String(k)] = (s && s.name) || s;
            });
        }
        const names = errors.map(function (e) {
            return byId[String(e.student_id)] || ('學生 ' + e.student_id);
        });
        return errors.length + ' 位寫入失敗：' + names.join('、');
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
                // Phase 4：整班重批（_regradeWholeTaskFromAppealReview）寫入失敗時要列姓名，
                // 沿用這裡已經抓好的班級名冊對照表，不重新查一次。
                studentsById: studentsById,
                errorText: '',
                acceptedDrafts: {},
                // 2026-09-12 老師確認（Phase 1.6）：這一開一開就要清空的「這一題已經被老師明確
                // 確認過（送分切換／加入清單／移除清單）」名單。任一組按下決定時，只把
                // 這組自己的 item＋這個名單裡的 item 一起送出，其餘題目即使 paper 物件裡有
                // 差異（理論上不該有，這裡再做一次保險過濾）都不送，避免「順便」存到老師
                // 還沒明確確認過的東西。
                _confirmedItemIds: {},
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

    // 2026-09-12 修：停用態原本用 opacity:0.7 調暗（button-opacity-readability-invariant
    // 禁止），選中的按鈕在停用時文字會變得不夠清楚。改成停用態維持原本文字色，只用邊框／
    // 背景轉灰＋游標樣式表示忙碌中，不靠調暗傳達狀態。
    function appealChoiceBtnHtml(idx, decision, current, disabled) {
        const selected = current === decision;
        const isAccept = decision === 'accepted';
        const label = isAccept ? '可接受' : '不可接受';
        const icon = isAccept ? '✅' : '❌';
        const onBg = isAccept ? '#059669' : '#DC2626';
        const offFg = isAccept ? '#047857' : '#B91C1C';
        const cursor = disabled ? 'wait' : 'pointer';
        const style = selected
            ? 'padding:8px 16px; border:2px solid ' + (disabled ? '#94A3B8' : onBg) + '; border-radius:8px; background:' + (disabled ? '#94A3B8' : onBg) + '; color:#fff; font-weight:900; cursor:' + cursor + '; min-width:8em;'
            : 'padding:8px 16px; border:2px solid ' + (disabled ? '#CBD5E1' : onBg) + '; border-radius:8px; background:#fff; color:' + (disabled ? '#94A3B8' : offFg) + '; font-weight:800; cursor:' + cursor + '; min-width:8em;';
        return '<button type="button" aria-pressed="' + (selected ? 'true' : 'false') + '" ' + (disabled ? 'disabled ' : '')
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

    function renderAppealGroupHtml(group, idx, siblingInfo) {
        const item = group.item;
        const sibling = siblingInfo || { total: 1, pending: 0 };
        const siblingNoteHtml = sibling.total > 1
            ? ('　<span style="color:#B45309;">本題共 ' + sibling.total + ' 組不同措辭申訴'
                + (sibling.pending > 0 ? '，尚有 ' + sibling.pending + ' 組待審' : '，已全部決定')
                + '</span>')
            : '';
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
        // 2026-09-12 老師確認：不同申訴群組不可同時送出（appealState._savingAny 是頁面層級
        // 鎖，見 _decideAppeal）——這裡不是自己在存但別組在存時，按鈕一樣要停用，避免兩組
        // 同時改 appealState.paper 互相覆寫。
        const blockedByOther = !!(appealState._savingAny && !saving);
        const disabled = saving || blockedByOther;
        const saveError = String(group._saveError || '').trim();
        // 2026-09-12 老師確認：部分批次失敗要看得到失敗名單，不能顯示成「已儲存」；
        // 提供「重試失敗的學生」按鈕——重按同一個決定即可，beforeRegrade 只挑目前狀態
        // 還不是這個決定的那幾筆（見 _decideAppeal），已經成功的學生不會被重複寫入。
        const retryBtnHtml = decided
            ? '<button type="button" onclick="window.FeatureExamReview._decideAppeal(' + idx + ',\'' + decided + '\')" '
                + 'style="margin-left:8px; padding:3px 10px; border:1px solid #B91C1C; border-radius:6px; background:#FEF2F2; color:#B91C1C; font-weight:800; font-size:0.75rem; cursor:pointer;">重試失敗的學生</button>'
            : '';
        // 按下「可接受／不可接受」會立刻存檔＋重批全班，不再是「先記畫面、最後才儲存提交」。
        const universalWarningHtml = String(group._universalWarning || '').trim()
            ? '<div style="margin-top:4px; font-size:0.72rem; font-weight:700; color:#B45309;">' + esc(group._universalWarning) + '</div>'
            : '';
        const decisionNote = saving
            ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#7C3AED;">⏳ 儲存中…</div>'
            : (blockedByOther
                ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#94A3B8;">⏳ 另一組正在儲存，請稍候…</div>'
            : (saveError
                ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B91C1C;">⚠ ' + esc(saveError) + retryBtnHtml + '</div>'
                : (decided === 'accepted'
                    ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#047857;">✅ 已儲存：可接受</div>' + universalWarningHtml
                    : (decided === 'rejected'
                        ? '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B91C1C;">✅ 已儲存：不可接受</div>' + universalWarningHtml
                        : '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#7C3AED;">尚未選擇　請點選其中一顆（按下就會立刻存檔）</div>'))));
        const cardBorder = decided === 'accepted' ? '#86EFAC' : (decided === 'rejected' ? '#FECACA' : '#DDD6FE');
        const cardBg = decided === 'accepted' ? '#F0FDF4' : (decided === 'rejected' ? '#FEF2F2' : '#FAF5FF');
        return '<div id="appeal-group-' + idx + '" style="border:1px solid ' + cardBorder + '; border-radius:10px; padding:12px 14px; margin-bottom:10px; background:' + cardBg + ';">'
            + '<div style="font-size:0.76rem; color:#7C3AED; font-weight:900; margin-bottom:4px;">' + esc(itemHeadline(item, item ? item.seq : '?')) + '　🚩 ' + group.students.length + ' 人申訴' + siblingNoteHtml + '</div>'
            + '<div style="font-weight:800; color:#1E293B; margin-bottom:6px; white-space:pre-wrap;">' + promptHtml + '</div>'
            + '<div style="font-size:0.75rem; font-weight:800; color:#1E293B; margin-bottom:2px;">學生答案／正確答案'
            + '<span style="font-weight:700; color:#64748B;">（上排學生＝黑／錯深藍　下排解答＝黑／差異紅）</span> ' + hint + '</div>'
            + (pairHtml
                ? ('<div style="font-size:1rem; line-height:1.7; margin-bottom:6px;">' + pairHtml + '</div>')
                : ('<div style="font-size:1rem; font-weight:900; color:#B45309; margin-bottom:6px;">' + esc(group.answerText || '') + '</div>'
                    + '<div style="font-size:1rem; font-weight:800; color:#DC2626; line-height:1.7; white-space:pre-wrap; margin-bottom:6px;">' + (item ? esc(item.answer_en || '') : '') + '</div>'))
            + '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">'
                + appealChoiceBtnHtml(idx, 'accepted', decided, disabled)
                + appealChoiceBtnHtml(idx, 'rejected', decided, disabled)
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

    /**
     * Phase 1.6（2026-09-12 老師確認）：決定某一組時，只把「這組自己的 item」＋
     * 「appealState._confirmedItemIds 裡已經被老師明確確認過（送分切換／加入清單／
     * 移除清單）的 item」一起送出；其餘題目一律用 originalPaper 裡的舊值蓋掉，即使
     * currentPaper 物件裡剛好有差異也不送——不能因為老師決定了 A 組，就順便把老師
     * 還沒對 B 組表態的東西也存進去。
     * 回傳的物件裡，「確認過」的 item 跟 currentPaper 是同一個物件參照（後續
     * regradeAndSaveTask 內部若再修改它，會直接反映回 currentPaper，不會分岔）；
     * 「未確認」的 item 是 originalPaper 的複本，跟 currentPaper 的物件無關。
     */
    function buildConfirmedPaperSnapshot(currentPaper, originalPaper, confirmedItemIds, extraItemId) {
        const originalById = {};
        (originalPaper.items || []).forEach(function (it) {
            if (it && it.item_id != null) originalById[String(it.item_id)] = it;
        });
        const snapshot = Object.assign({}, currentPaper);
        snapshot.items = (currentPaper.items || []).map(function (it) {
            if (!it || it.item_id == null) return it;
            const idKey = String(it.item_id);
            const isConfirmed = idKey === String(extraItemId) || !!(confirmedItemIds && confirmedItemIds[idKey]);
            return isConfirmed ? it : (originalById[idKey] || it);
        });
        return snapshot;
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
        // 2026-09-12 老師確認：同一題若因為學生寫法不同拆成好幾組申訴卡，buildAppealGroups
        // 已經依 item.seq 排序，同題的組本來就會排在一起（不是另開一套排序邏輯）——這裡只
        // 額外算出「這一題總共幾組、還有幾組尚未決定」，讓老師在卡片上就看得到還有幾組沒審，
        // 不用自己往下數。純展示聚合，不動 buildAppealGroups 本身的分組／批改嚴格性。
        const siblingCountByItemId = {};
        const siblingPendingByItemId = {};
        appealState.groups.forEach(function (g) {
            const key = String(g.itemId);
            siblingCountByItemId[key] = (siblingCountByItemId[key] || 0) + 1;
            if (!g.decision) siblingPendingByItemId[key] = (siblingPendingByItemId[key] || 0) + 1;
        });
        const groupsHtml = appealState.groups.length
            ? appealState.groups.map(function (g, idx) {
                return renderAppealGroupHtml(g, idx, {
                    total: siblingCountByItemId[String(g.itemId)] || 1,
                    pending: siblingPendingByItemId[String(g.itemId)] || 0
                });
            }).join('')
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
     * 2026-09-12 老師確認（Phase 1.6）：這組決定只帶著「這組自己的題」＋「老師已經明確
     * 確認過的其他題」（送分切換／加入清單／移除清單，見 appealState._confirmedItemIds）
     * 一起送出——用 buildConfirmedPaperSnapshot 過濾，其他還沒表態的題目維持原值，
     * 不會因為老師先按了 A 組就順便存到 B 組還在編輯中的東西。
     */
    async function _decideAppeal(idx, decision) {
        if (!appealState || appealState._loading) return;
        const group = appealState.groups[idx];
        // 2026-09-12 老師確認：不同申訴群組不可同時送出——appealState._savingAny 是頁面層級
        // 鎖，擋下「A 組還在存、老師又去按 B 組」；跟原本 group._saving（同一組自己重複點擊）
        // 的鎖各管各的，兩個都要過才能真的送出。
        if (!group || group._saving || appealState._savingAny) return;
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
        if (!appealState._confirmedItemIds) appealState._confirmedItemIds = {};
        appealState._confirmedItemIds[String(group.itemId)] = true;
        captureAllAppealDrafts();
        group.decision = decision;
        group._saving = true;
        appealState._savingAny = true;
        group._saveError = '';
        appealState.errorText = '';
        renderAppealReviewHtml('appeal-group-' + idx);
        try {
            const originalPaperForFilter = JSON.parse(appealState.originalPaperJson || '{}');
            const paperToSave = buildConfirmedPaperSnapshot(
                appealState.paper, originalPaperForFilter, appealState._confirmedItemIds, group.itemId
            );
            const paperChanged = JSON.stringify(paperToSave) !== appealState.originalPaperJson;
            let universalWarning = '';
            if (paperChanged) {
                const paperSaveResult = await savePaperWithUniversalDiff(appealState.assignmentId, appealState.taskId, originalPaperForFilter, paperToSave);
                universalWarning = paperSaveResult.universalWarning;
            }
            // 💣 雷區（2026-09-12 老師回報「老師有拒絕，但學生端顯示審核中」）：這裡原本靠
            // 「item_id + normalizeAnswer(a.answer) 重新比對」找出這個 group 底下該改的申訴列，
            // 但 normalizeAnswer 只轉智慧引號／省略號，不動大小寫／空白，任何細微差異
            // （或這支重新 fetch 到的 completions 跟 buildAppealGroups 當初分組時的資料有落差）
            // 都會讓某個學生比對不到、被靜默漏改──畫面卻只回報整體「✅ 已儲存」，老師完全
            // 看不出「這個群組裡其實有人沒被改到」。group.students[].completionId 是
            // buildAppealGroups 當初分組時，老師在畫面上實際看到、決定要一起處理的那份
            // 學生名單（精準；不再重新比對字串去猜）——改用它當白名單，只在名單內的
            // completion 才處理，名單內只要 item_id 對得上就一定改掉，不再要求 norm 也相同。
            const targetCompletionIds = {};
            (group.students || []).forEach(function (s) {
                if (s && s.completionId != null) targetCompletionIds[String(s.completionId)] = true;
            });
            // 2026-09-12 老師確認：申訴決定要能真正反悔（可接受→不可接受、或反過來，可以
            // 來回改判）。以前這裡只改 status==='pending' 的列，第二次改判時 DB 已經不是
            // pending，會被原地跳過；即使改掉了，寫回 DB 那一關（saveCompletionRawData→
            // prepareCompletionRawDataForSave→mergeQuizAppeals）還有一層「已接受不准被舊
            // 快取降回 pending」的等級保護，會把老師這次刻意的降級決定也當舊快取擋回去。
            // 這裡拿掉 pending-only 限制（名單內、這個 item_id，不管目前是什麼狀態都能改），
            // 並把 authoritativeAppealItemIds 傳給 regradeAndSaveTask／batchSaveCompletions，
            // 讓等級保護對「這次老師剛決定的這個 item_id」例外，真正把新狀態寫進 DB；
            // 其他 item_id、其他情境的等級保護維持不變（不是全域拿掉保護）。
            const authoritativeAppealItemIds = {};
            authoritativeAppealItemIds[String(group.itemId)] = true;
            const result = await regradeAndSaveTask(appealState.assignmentId, appealState.taskId, paperToSave, {
                authoritativeAppealItemIds: authoritativeAppealItemIds,
                beforeRegrade: function (c) {
                    if (!targetCompletionIds[String(c.id)]) return false;
                    const list = Array.isArray(c.raw_data && c.raw_data.quiz_appeals) ? c.raw_data.quiz_appeals : null;
                    if (!list) return false;
                    let mutated = false;
                    list.forEach(function (a) {
                        if (!a || a.item_id == null) return;
                        if (String(a.item_id) === String(group.itemId) && a.status !== decision) {
                            a.status = decision;
                            mutated = true;
                        }
                    });
                    return mutated;
                }
            });
            // paperToSave 裡「已確認」的題目跟 appealState.paper 是同一個物件參照，本來就會
            // 同步；「未確認」的題目是獨立複本，regradeAndSaveTask 內部的
            // applyAcceptedAppealsToPaper 若順便同步了別的已接受申訴到那些題目，這裡要把
            // 結果寫回 appealState.paper，讓畫面上的 paper 跟剛剛真正存進 DB 的內容一致
            // （不然老師接下來如果去編輯那一題，會是從舊值繼續編輯）。
            const paperToSaveById = {};
            (paperToSave.items || []).forEach(function (it) {
                if (it && it.item_id != null) paperToSaveById[String(it.item_id)] = it;
            });
            appealState.paper.items = (appealState.paper.items || []).map(function (it) {
                if (!it || it.item_id == null) return it;
                const idKey = String(it.item_id);
                const isConfirmed = idKey === String(group.itemId) || !!(appealState._confirmedItemIds && appealState._confirmedItemIds[idKey]);
                return isConfirmed ? it : (paperToSaveById[idKey] || it);
            });
            appealState.originalPaperJson = JSON.stringify(paperToSave);
            group._saving = false;
            appealState._savingAny = false;
            // 2026-09-12 老師確認：部分批次失敗不能靜默清空錯誤、看起來像全部成功——這裡
            // 對照 result.errors（{id, student_id, message}）跟這個群組自己的學生名單
            // （group.students，buildAppealGroups 當初記錄的精準名單），標出「這個群組裡
            // 哪幾位還沒存到」，卡片上要看得到姓名，不是只顯示一個失敗人數。
            const failedIds = {};
            (result.errors || []).forEach(function (e) { if (e && e.id != null) failedIds[String(e.id)] = true; });
            group._failedStudents = (group.students || []).filter(function (s) {
                return s && s.completionId != null && failedIds[String(s.completionId)];
            });
            group._saveError = group._failedStudents.length
                ? ('這個群組有 ' + group._failedStudents.length + ' 位學生寫入失敗：'
                    + group._failedStudents.map(function (s) { return s.studentName; }).join('、')
                    + '（其他人已存成功，可以按「重試失敗的學生」）')
                : '';
            // universalWarning 不是「這個決定沒存成功」，只是全站庫這個輔助快取沒同步，
            // 所以獨立存一欄，跟卡片上的「已儲存」文字一起顯示（不觸發重試按鈕）。
            group._universalWarning = universalWarning;
            broadcastAppealProgress(appealState.assignmentId, appealState.taskId);
            window.showFlash && window.showFlash(
                '✅ 已儲存' + (group._saveError ? '（' + group._saveError + '）' : '') + universalWarning,
                (result.failCount || universalWarning) ? 'warning' : 'success'
            );
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(appealState.classId);
            }
            renderAppealReviewHtml('appeal-group-' + idx);
        } catch (err) {
            console.error('[FeatureExamReview] decideAppeal save', err);
            group._saving = false;
            appealState._savingAny = false;
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
        // 老師按了「加入清單」＝對這一題明確確認，之後任一組決定都可以帶著這題一起送出。
        if (!appealState._confirmedItemIds) appealState._confirmedItemIds = {};
        appealState._confirmedItemIds[String(group.itemId)] = true;
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
        // 老師按了「移除」＝對這一題明確確認，之後任一組決定都可以帶著這題一起送出。
        if (!appealState._confirmedItemIds) appealState._confirmedItemIds = {};
        appealState._confirmedItemIds[String(group.itemId)] = true;
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
            // 💣 雷區（Phase 4）：result.savedIds 其實是「這次嘗試寫入的全部 id」（forceAll 底下
            // toSave 全部塞進去，不管最後成不成功），不是「成功」的數量——舊文案直接拿它當
            // 成功人數講「已重新批閱 N 位」，寫入失敗的人也被算進那個 N，讓老師誤以為全部都好了。
            // 改成明確拆開「嘗試／成功／失敗」三個數字，失敗的再列出姓名（不只顯示數字）。
            const attempted = (result.savedIds || []).length;
            const okCount = result.okCount || 0;
            const failCount = result.failCount || 0;
            let failStudentsText = '';
            if (failCount > 0) {
                const classStudents = await window.ApiQuizReview.fetchClassStudents(classId).catch(function () { return []; });
                failStudentsText = describeFailedStudents(result.errors, classStudents);
            }
            window.showFlash && window.showFlash('✅ 已依試卷範本更新標準答案，重新批閱嘗試 ' + attempted + ' 位、成功 ' + okCount + ' 位'
                + (refreshed.missing ? '（' + refreshed.missing + ' 題對不到 meta）' : '')
                + (failCount ? '（' + failStudentsText + '，請重試）' : ''),
                (refreshed.missing || failCount) ? 'warning' : 'success');
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(classId);
            }
            broadcastAppealProgress(assignmentId, taskId);
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
            broadcastAppealProgress(appealState.assignmentId, appealState.taskId);
            // 💣 雷區（Phase 4）：同 _regradeWholeTask——result.savedIds 是「嘗試」數，不是
            // 「成功」數；拆開顯示，失敗的列姓名。
            const attempted = (result.savedIds || []).length;
            const okCount = result.okCount || 0;
            const failCount = result.failCount || 0;
            const failStudentsText = failCount > 0 ? describeFailedStudents(result.errors, appealState.studentsById) : '';
            window.showFlash && window.showFlash('✅ 已重新批閱，嘗試 ' + attempted + ' 位、成功 ' + okCount + ' 位'
                + (failCount ? '（' + failStudentsText + '，請重試）' : ''),
                failCount ? 'warning' : 'success');
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
            return regradeAndSaveTask(assignmentId, taskId, paper, { forceAll: true }).then(function (result) {
                broadcastAppealProgress(assignmentId, taskId);
                return result;
            });
        },
        _regradeWholeTask: _regradeWholeTask,
        _setListKind: _setListKind,
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

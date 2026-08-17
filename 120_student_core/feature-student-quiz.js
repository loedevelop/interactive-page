/**
 * 📂 120_student_core/feature-student-quiz.js
 * 學生端線上卷：全螢幕、離開／quit／完成統計、錯題與錯字分析
 *
 * 設計決定（2026-08-02 與老師確認）：允許學生「無限次重考」，沒有次數上限或鎖定機制；
 * 每次開啟（attempt_count）與每次繳交（complete_count／history）都會記錄，不會互相覆蓋。
 * 老師畫面看到的分數＝最新一次，但完整歷程（含每次分數、離開次數、時間）保留在
 * quiz_stats.history（上限 40 筆）與 spelling_history／spelling_ledger（上限 250 筆）。
 * 見 docs/quiz-json-contract-v0.2.md「學生端作答語意」一節。若要改成限制次數，
 * 需同時更新該文件與此處註解，避免下次改動的人以為現狀是「只能考一次」。
 */
window.FeatureStudentQuiz = (function () {
    'use strict';

    const MODAL_ID = 'student-quiz-paper';
    const LEAVE_MSG = '考試進行中。離開或重新整理將中斷作答，確定要離開嗎？';
    const TAB_RETURN_MSG = '偵測到您曾離開考試畫面（已計入離開次數）。是否繼續作答？\n按「取消」將關閉考卷。';
    const FS_EXIT_MSG = '您已離開全螢幕（已計入離開次數）。是否重新進入全螢幕繼續作答？\n按「取消」將關閉考卷。';
    const HISTORY_CAP = 40;
    const SPELLING_HISTORY_CAP = 250;
    const REVIEW_MODAL_ID = 'student-quiz-review';
    /**
     * 重考錯題（僅一次）：老師出題時勾選 raw_data.allow_wrong_retake 才會啟用。
     * 交卷時若有錯題，凍結該次 wrong_items 的 item_id 清單成 task_completions.raw_data.quiz_retake
     * ={ item_ids, done, answers, result, combined }；學生可當下或之後回來重考「原題」（同一批 item_id，
     * 答案標準不變），只能考一次。重考只用一般 Tier B 彈窗＋isDirty，不套用整份考試的全螢幕／離開次數
     * 防作弊機制（那套是給正式整卷考試用的，錯題訂正沒有必要一樣重）。
     * 見 docs/quiz-json-contract-v0.2.md 與 exam-available-count-invariant.mdc。
     */
    const RETAKE_MODAL_ID = 'student-quiz-retake';
    const RETAKE_REPORT_MODAL_ID = 'student-quiz-retake-report';
    /** ✍️ 輸入練習／🔧 輸入改正（見下方對應函式區塊的說明註解） */
    const INPUT_PRACTICE_MODAL_ID = 'student-input-practice';
    const INPUT_CORRECTION_MODAL_ID = 'student-input-correction';

    let examGuardOn = false;
    let allowUnload = false;
    let allowFsExit = false;
    let leftWhileHidden = false;
    let leaveCount = 0;
    let leaveLog = [];
    let lastLeaveAt = 0;
    let visibilityHandler = null;
    let beforeUnloadHandler = null;
    let fullscreenHandler = null;

    /** 本次作答 session */
    let sessionAssignmentId = null;
    let sessionTaskId = null;
    let sessionSubmitted = false;
    let sessionQuitSaved = false;
    let sessionBaseRaw = {};
    /**
     * 💣 雷區（2026-08-12 老師回報「解答根本對不起來」）：openQuiz／openRetakeQuiz 顯示的
     * 題目順序是「這次打開才洗牌」的結果（見 displayOrderItems），只存在畫面／這次
     * session 裡，`paper.items` 本身的固定順序完全是另一組。submit()／submitRetake()
     * 如果自己重新照 `paper.items`（或又呼叫一次 displayOrderItems 重新洗牌）算編號，
     * 算出來的號碼會跟學生剛剛在畫面上實際看到的號碼「兩份不同的洗牌結果」，於是繳交
     * 後的錯題報告上「第 5 題」跟學生剛剛作答時看到的「第 5 題」是不同題目，看起來就像
     * 「解答跟考卷根本對不起來」。修正：openQuiz／openRetakeQuiz 顯示時，把這次實際排出
     * 來的 item_id 順序記下來，submit／submitRetake 一律照這份記錄算編號，不要重新洗牌
     * 或改用其他順序。
     */
    let sessionDisplayOrder = [];
    let sessionRetakeDisplayOrder = [];

    function orderIndexMap(idList) {
        const map = {};
        (idList || []).forEach(function (id, idx) { map[String(id)] = idx + 1; });
        return map;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(value || '').trim());
    }

    function isAssignmentId(value) {
        const s = String(value == null ? '' : value).trim();
        if (!s) return false;
        if (isUuid(s)) return true;
        return /^\d+$/.test(s);
    }

    function getPaper(task) {
        return task && task.raw_data && task.raw_data.quiz_paper
            ? task.raw_data.quiz_paper
            : null;
    }

    function walkFindTask(tasks, taskId) {
        let found = null;
        (tasks || []).forEach(function (t) {
            if (found || !t) return;
            if (String(t.id) === String(taskId)) found = t;
            else if (t.subTasks) found = walkFindTask(t.subTasks, taskId);
        });
        return found;
    }

    function findTaskInAssignments(assignmentId, taskId) {
        const list = (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAssignments === 'function')
            ? window.FeatureStudentTimeline.getAssignments()
            : [];
        const assign = (list || []).find(function (a) {
            return String(a.id) === String(assignmentId);
        });
        if (!assign) return null;
        let tasks = assign.tasks;
        if (typeof tasks === 'string') {
            try { tasks = JSON.parse(tasks); } catch (_e) { tasks = []; }
        }
        if (window.TaskScriptResolver && typeof window.TaskScriptResolver.parseTasks === 'function') {
            tasks = window.TaskScriptResolver.parseTasks(assign.tasks);
        }
        return walkFindTask(tasks || [], taskId);
    }

    function findCompletion(assignmentId, taskId) {
        const comps = window._studentTaskCompletions || [];
        return comps.find(function (c) {
            return String(c.task_id) === String(taskId) && String(c.assignment_id) === String(assignmentId);
        }) || null;
    }

    function emptyStats() {
        return {
            attempt_count: 0,
            quit_count: 0,
            leave_count_total: 0,
            complete_count: 0,
            last_leave_count: 0,
            last_leave_log: [],
            wrong_items: [],
            spelling_history: [],
            spelling_ledger: {},
            history: []
        };
    }

    function readStats(raw) {
        const base = emptyStats();
        const src = (raw && raw.quiz_stats) ? raw.quiz_stats : {};
        base.attempt_count = Number(src.attempt_count) || 0;
        base.quit_count = Number(src.quit_count) || 0;
        base.leave_count_total = Number(src.leave_count_total) || 0;
        base.complete_count = Number(src.complete_count) || 0;
        base.last_leave_count = Number(src.last_leave_count) || 0;
        base.last_leave_log = Array.isArray(src.last_leave_log) ? src.last_leave_log.slice() : [];
        base.wrong_items = Array.isArray(src.wrong_items) ? src.wrong_items.slice() : [];
        base.spelling_history = Array.isArray(src.spelling_history) ? src.spelling_history.slice() : [];
        base.spelling_ledger = (src.spelling_ledger && typeof src.spelling_ledger === 'object')
            ? JSON.parse(JSON.stringify(src.spelling_ledger))
            : {};
        base.history = Array.isArray(src.history) ? src.history.slice() : [];
        if (!base.leave_count_total && raw && raw.quiz_result && raw.quiz_result.leave_count) {
            base.leave_count_total = Number(raw.quiz_result.leave_count) || 0;
            base.last_leave_count = base.leave_count_total;
        }
        if (!base.complete_count && raw && raw.quiz_result && raw.quiz_result.total != null) {
            base.complete_count = 1;
        }
        if (!base.wrong_items.length && raw && raw.quiz_result && Array.isArray(raw.quiz_result.wrong_items)) {
            base.wrong_items = raw.quiz_result.wrong_items.slice();
        }
        return base;
    }

    function pushHistory(stats, entry) {
        const list = Array.isArray(stats.history) ? stats.history : [];
        list.push(entry);
        while (list.length > HISTORY_CAP) list.shift();
        stats.history = list;
    }

    /**
     * 💣 雷區（2026-08-12 老師回報「題目/解答編號 35、21、36…根本對不起來」）：`d.seq` 是這題在
     * 出卷當下「產生順序」的固定編號，跟畫面上實際排第幾題完全無關——尤其現在 openQuiz／
     * openRetakeQuiz 每次重做都會重新洗牌顯示順序（見 displayOrderItems），如果編號還是印
     * 原始 seq，學生／老師看到「35. ...」「21. ...」這種跳號會誤以為卷子亂掉或對不起來。
     * 這裡改成一律用「這題在目前列表中排第幾個」（displayNo，1-based）當標籤，seq 只在
     * 沒給 displayNo 時（相容舊資料）當退路。
     */
    function displaySheetName(sheetId) {
        let s = String(sheetId || '').trim().replace(/\.meta\.json$/i, '');
        if (!s) return '';
        const dot = s.indexOf('.');
        if (dot > 0) s = s.slice(0, dot);
        return s.toUpperCase();
    }

    function headlineFromWrongItem(d, displayNo) {
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.formatItemHeadline === 'function') {
            const shared = window.QuizPaperBuilder.formatItemHeadline(d, displayNo);
            if (shared) return shared;
        }
        const seq = displayNo != null ? String(displayNo) : (d && d.seq != null ? String(d.seq) : '');
        const src = (d && d.source) || {};
        const vbk = String(src.vbk_name || src.vBK_name || '').trim();
        const sheet = vbk || displaySheetName(src.sheet_id);
        const page = src.page != null && src.page !== '' ? String(src.page) : '';
        const itemNo = String(src.item_no_label != null && src.item_no_label !== ''
            ? src.item_no_label
            : (src.item_no != null && src.item_no !== '' ? src.item_no : '')).trim();
        let meta = '';
        if (sheet && page && itemNo) meta = sheet + ' - ' + page + ' - ' + itemNo;
        else if (sheet && itemNo) meta = sheet + ' - ' + itemNo;
        if (seq && meta) return seq + '. ' + meta;
        if (seq) return seq + '.';
        return meta || (d.item_id || '');
    }

    function appendSpellingHistory(stats, wrongItems, completeN, atIso) {
        const hist = Array.isArray(stats.spelling_history) ? stats.spelling_history : [];
        const ledger = stats.spelling_ledger && typeof stats.spelling_ledger === 'object'
            ? stats.spelling_ledger
            : {};
        (wrongItems || []).forEach(function (item) {
            const pairs = (item.diff && item.diff.spelling_pairs) || item.spelling_pairs || [];
            const headline = item.headline || headlineFromWrongItem(item);
            pairs.forEach(function (p) {
                const expectedWord = String(p.expected_word || '');
                const gotWord = String(p.got_word || '');
                const kind = p.kind || 'wrong';
                // 歷史錯字：至少要有「應打」或「誤打」之一
                if (!expectedWord && !gotWord) return;
                const event = {
                    at: atIso,
                    complete_n: completeN,
                    item_id: item.item_id || '',
                    seq: item.seq,
                    headline: headline,
                    prompt_zh: item.prompt_zh || '',
                    expected_word: expectedWord,
                    got_word: gotWord,
                    kind: kind,
                    expected_sentence: item.expected || '',
                    answer_sentence: item.answer || ''
                };
                hist.push(event);

                const key = expectedWord || ('__extra__:' + gotWord);
                if (!ledger[key]) {
                    ledger[key] = {
                        expected_word: expectedWord,
                        total: 0,
                        variants: {}
                    };
                }
                ledger[key].total += 1;
                const vk = gotWord || '(未寫)';
                ledger[key].variants[vk] = (ledger[key].variants[vk] || 0) + 1;
            });
        });
        while (hist.length > SPELLING_HISTORY_CAP) hist.shift();
        stats.spelling_history = hist;
        stats.spelling_ledger = ledger;
    }

    /**
     * 學生句 diff 上色／拼錯紀錄：改呼叫 QuizPaperBuilder 共用渲染（師生兩端同一份，
     * 避免各自維護一份、之後長歪）。這兩個函式名保留給下方既有呼叫點沿用。
     */
    function renderStudentStrikeHtml(ops) {
        return window.QuizPaperBuilder.renderAnswerDiffHtml(ops);
    }

    function renderSpellingPairsHtml(pairs) {
        return window.QuizPaperBuilder.renderSpellingPairsHtml(pairs);
    }

    /**
     * 💣 雷區（2026-08-13 老師回報「改了對齊演算法／配色，畫面還是舊的，句號還是不見、
     * 還是有那個空格」）：這裡原本「已經有 item.diff.ops 就直接用，不重算」——但
     * item.diff 是很久以前交卷當下用「當時那一版」演算法算好、存進 task_completions.raw_data
     * 的舊結果，之後不管怎麼修 analyzeAnswerDiff／alignTokens 的邏輯，畫面看到的都還是
     * 交卷當時凍結的舊 ops，等於改了程式却看不到效果，老師還以為沒修好。
     * 這裡的對齊只是「顯示用」，不是評分依據（對錯早在 gradeAnswers 時就已經用
     * isAcceptableAnswer 判定好、寫進 item.ok，不會因為重新算 diff 而改變），所以永遠用
     * 目前這一版演算法「即時重新計算」顯示用的逐字對齊，不要沿用交卷當下凍結的舊結果。
     */
    function ensureItemDiff(item) {
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.analyzeAnswerDiff === 'function') {
            const diff = window.QuizPaperBuilder.analyzeAnswerDiff(item.expected || '', item.answer || '');
            item.diff = diff;
            item.spelling_pairs = diff.spelling_pairs || [];
        } else if (!item.diff) {
            item.diff = { ops: [], spelling_pairs: [] };
        }
        return item;
    }

    /**
     * 申訴狀態→顯示（見「錯題申訴」規劃）：沒有 opts.allowAppeal（老師沒開這個功能）
     * 完全不顯示任何申訴相關 UI。已申訴過（不論 pending/accepted/rejected）不再顯示
     * checkbox——申訴僅一次，要調整由老師端逐題編輯，不提供學生重送介面。
     */
    function appealsByItemIdFromRaw(raw) {
        const list = (raw && Array.isArray(raw.quiz_appeals)) ? raw.quiz_appeals : [];
        const map = {};
        list.forEach(function (a) { if (a && a.item_id != null) map[String(a.item_id)] = a; });
        return map;
    }

    function renderAppealAreaHtml(item, opts) {
        if (!opts || !opts.allowAppeal) return '';
        const appeal = (opts.appealsByItemId || {})[String(item.item_id)];
        if (!appeal) {
            return '<label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:0.78rem; font-weight:700; color:#7C3AED; cursor:pointer;">'
                + '<input type="checkbox" class="quiz-appeal-checkbox" data-item-id="' + esc(item.item_id) + '" data-seq="' + esc(item.seq) + '" data-answer="' + esc(item.answer || '') + '" data-expected="' + esc(item.expected || '') + '">'
                + '🚩 申訴這個答案（送出後老師/助教會審核）'
                + '</label>';
        }
        if (appeal.status === 'accepted') {
            return '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#047857;">✅ 申訴已被接受，成績已更新（重新整理／重新打開檢討可看到最新結果）</div>';
        }
        if (appeal.status === 'rejected') {
            return '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#DC2626;">❌ 申訴未通過審核</div>';
        }
        return '<div style="margin-top:8px; font-size:0.78rem; font-weight:800; color:#B45309;">🕐 申訴審核中，請等候老師/助教處理</div>';
    }

    function renderWrongItemCard(item, opts) {
        ensureItemDiff(item);
        const headline = item.headline || headlineFromWrongItem(item);
        const ops = (item.diff && item.diff.ops) || item.ops || [];
        // 2026-08-13 老師要求先關掉「拼錯紀錄」：目前逐字對齊機制抓出來的拼錯配對還不夠準確、
        // 對學生／老師來說沒有參考意義，先不顯示（renderAnswerDiffHtml 本身的上下對齊已經夠用），
        // 之後演算法夠準了再考慮恢復 renderSpellingPairsHtml(pairs)。
        return (
            '<div style="border:1px solid #FECACA; border-radius:10px; padding:12px; margin-bottom:10px; background:#FFF7F7;">' +
                '<div style="font-size:0.85rem; color:#B91C1C; font-weight:900; margin-bottom:4px;">' + esc(headline) + '</div>' +
                '<div style="font-size:0.92rem; font-weight:800; color:#1E293B; margin-bottom:8px; white-space:pre-wrap;">' + esc(item.prompt_zh || '') + '</div>' +
                '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:2px;">你的答案</div>' +
                '<div style="font-size:1rem; line-height:1.7; margin-bottom:6px;">' + renderStudentStrikeHtml(ops) + '</div>' +
                '<div style="font-size:0.75rem; color:#DC2626; font-weight:800; margin-bottom:2px;">正確答案</div>' +
                '<div style="font-size:1rem; font-weight:800; color:#DC2626; line-height:1.7; white-space:pre-wrap;">' + esc(item.expected || '') + '</div>' +
                renderAppealAreaHtml(item, opts) +
            '</div>'
        );
    }

    function renderSpellingLedgerHtml(ledger) {
        const keys = Object.keys(ledger || {});
        if (!keys.length) {
            return '<div style="color:#94A3B8; font-weight:700; font-size:0.85rem;">尚無歷史錯字</div>';
        }
        const rows = keys.map(function (k) {
            return { key: k, row: ledger[k] };
        }).filter(function (x) {
            return x.row && Number(x.row.total) > 0;
        });
        rows.sort(function (a, b) {
            return (Number(b.row.total) || 0) - (Number(a.row.total) || 0);
        });
        return rows.map(function (x) {
            const expected = x.row.expected_word
                ? esc(x.row.expected_word)
                : '（多打）';
            const variants = x.row.variants || {};
            const vHtml = Object.keys(variants).map(function (g) {
                return '<span style="display:inline-block; margin:2px 4px 2px 0; padding:2px 6px; border-radius:6px; background:#FEF2F2; border:1px solid #FECACA; color:#B91C1C; font-weight:800; font-size:0.75rem;">'
                    + esc(g) + ' ×' + variants[g] + '</span>';
            }).join('');
            return (
                '<div style="border-bottom:1px solid #F1F5F9; padding:8px 0;">' +
                    '<div style="font-weight:900; color:#0F766E; font-size:0.9rem;">應打：' + expected
                        + ' <span style="color:#94A3B8; font-size:0.75rem;">（累計 ' + esc(x.row.total) + ' 次）</span></div>' +
                    '<div style="margin-top:4px;">學生曾寫成：' + vHtml + '</div>' +
                '</div>'
            );
        }).join('');
    }

    /** 供進度列摘要 */
    function formatStatsSummaryHtml(raw) {
        const st = readStats(raw || {});
        if (!st.attempt_count && !st.complete_count && !st.quit_count) return '';
        const parts = [];
        if (st.complete_count > 0) parts.push('已作答過 ' + st.complete_count + ' 次');
        else if (st.attempt_count > 0) parts.push('已開啟 ' + st.attempt_count + ' 次');
        if (st.quit_count > 0) parts.push('中途退出 ' + st.quit_count + ' 次');
        if (st.leave_count_total > 0) parts.push('嘗試離開 ' + st.leave_count_total + ' 次');
        const qr = (raw && raw.quiz_result) ? raw.quiz_result : null;
        if (qr && qr.total != null) {
            parts.push('最近 ' + qr.correct + '/' + qr.total + '（' + qr.score + '%）');
        }
        const wrongN = (st.wrong_items && st.wrong_items.length) ? st.wrong_items.length : 0;
        if (wrongN > 0) parts.push('最近錯題 ' + wrongN);
        // 2026-08-13 老師要求先關掉「歷史錯字」相關顯示（目前抓錯機制還不夠準確、沒有參考
        // 意義）：這裡也一併拿掉，不要讓「歷史錯字 N 組」還留在進度列摘要裡（spelling_ledger
        // 底層仍照常累積記錄，只是先不顯示出來）。
        return '<div style="font-size:0.78rem; font-weight:800; color:#334155; line-height:1.45;">'
            + esc(parts.join(' · '))
            + '</div>';
    }

    function buildReviewHtml(title, result, stats, opts) {
        opts = opts || {};
        const wrongItems = stats.wrong_items || [];
        const appealsByItemId = opts.appealsByItemId || {};
        const cardOpts = { allowAppeal: opts.allowAppeal, appealsByItemId: appealsByItemId };
        const wrongCardsBodyId = REVIEW_MODAL_ID + '-wrongcards';
        const wrongCards = wrongItems.length
            ? wrongItems.map(function (item) { return renderWrongItemCard(item, cardOpts); }).join('')
            : '<div style="color:#047857; font-weight:800; padding:12px;">本次全對，沒有錯題。</div>';
        const closeAction = opts.reloadOnClose
            ? "window.FeatureStudentQuiz.closeReview(true)"
            : "window.FeatureStudentQuiz.closeReview(false)";
        // 這裡是塞進 onclick="...('safeAssign','safeTask')" 的 JS 字串常值，要跳單引號，不是 HTML escape（esc 只處理 &<>"）
        const safeAssign = String(opts.assignmentId == null ? '' : opts.assignmentId).replace(/'/g, "\\'");
        const safeTask = String(opts.taskId == null ? '' : opts.taskId).replace(/'/g, "\\'");
        const hasAppealable = opts.allowAppeal && wrongItems.some(function (item) { return !appealsByItemId[String(item.item_id)]; });
        const appealSubmitHtml = hasAppealable
            ? ('<div style="display:flex; justify-content:flex-end; margin:6px 0 12px;">'
                + '<button type="button" class="btn btn-action" style="background:#7C3AED; color:white; border:none; padding:6px 12px; font-weight:800;" onclick="window.FeatureStudentQuiz.submitAppeals(\'' + safeAssign + '\',\'' + safeTask + '\',\'' + wrongCardsBodyId + '\',\'review\')">📮 送出申訴</button>'
                + '</div>')
            : '';
        const retakeBannerHtml = opts.retakeEligible
            ? ('<div style="margin-bottom:12px; padding:10px 12px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                + '<span style="font-weight:800; color:#92400E; font-size:0.85rem;">🔁 這次有錯題，可以馬上重考一次（僅一次），也可以之後再回來考。</span>'
                + '<button type="button" class="btn btn-action" style="background:#B45309; color:white; border:none; padding:6px 12px; font-weight:800;" onclick="window.FeatureStudentQuiz.startRetakeFromReview(\'' + safeAssign + '\',\'' + safeTask + '\')">立刻重考錯題</button>'
                + '</div>')
            : (opts.retakeReportReady
                ? ('<div style="margin-bottom:12px; padding:10px 12px; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                    + '<span style="font-weight:800; color:#047857; font-size:0.85rem;">✅ 錯題重考已完成。</span>'
                    + '<button type="button" class="btn btn-action" style="background:#059669; color:white; border:none; padding:6px 12px; font-weight:800;" onclick="window.FeatureStudentQuiz.openRetakeReportFromRaw(\'' + safeAssign + '\',\'' + safeTask + '\')">查看整體報告</button>'
                    + '</div>')
                : '');
        // 🔧 輸入改正（獨立於重考錯題／申訴答案）：老師開啟且這次有錯題才顯示入口。
        const inputCorrectionBannerHtml = (opts.inputCorrectionEnabled && wrongItems.length)
            ? ('<div style="margin-bottom:12px; padding:10px 12px; background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                + '<span style="font-weight:800; color:#9A3412; font-size:0.85rem;">🔧 這次有錯題，可以做打字改正練習（照打正確答案）。</span>'
                + '<button type="button" class="btn btn-action" style="background:#B45309; color:white; border:none; padding:6px 12px; font-weight:800;" onclick="window.FeatureStudentQuiz.openInputCorrection(\'' + safeAssign + '\',\'' + safeTask + '\')">開始錯題改正練習</button>'
                + '</div>')
            : '';
        return (
            '<div style="max-width:760px; width:94vw; background:white; border-radius:14px; padding:18px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                    '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📋 ' + esc(title) + '</h3>' +
                    '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="' + closeAction + '">關閉</button>' +
                '</div>' +
                '<div style="margin-bottom:12px; padding:10px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-weight:800; color:#134E4A; font-size:0.88rem;">'
                    + '得分 ' + esc(result.correct) + ' / ' + esc(result.total) + '（' + esc(result.score) + '%）'
                    + ' · 已作答過 ' + esc(stats.complete_count) + ' 次'
                    + ' · 中途退出 ' + esc(stats.quit_count) + ' 次'
                    + ' · 嘗試離開累計 ' + esc(stats.leave_count_total) + ' 次'
                + '</div>' +
                retakeBannerHtml +
                inputCorrectionBannerHtml +
                '<div style="font-weight:900; color:#B91C1C; margin:10px 0 6px;">① 錯題本（本次）</div>' +
                '<div id="' + wrongCardsBodyId + '" style="max-height:32vh; overflow:auto; margin-bottom:12px;">' + wrongCards + '</div>' +
                appealSubmitHtml +
                // 2026-08-13 老師要求先關掉「歷史錯字紀錄」：目前抓錯機制（逐字對齊）還不夠準確，
                // 累積出來的 spelling_ledger 對老師／學生沒有參考意義，先不顯示這一區塊，之後
                // 演算法夠準了再考慮恢復（ledgerHtml／renderSpellingLedgerHtml 保留，沒有刪掉邏輯）。
                '<div style="display:flex; justify-content:flex-end; margin-top:12px;">' +
                    '<button type="button" class="btn btn-action" style="background:#0F766E; color:white; border:none; padding:8px 14px; font-weight:800;" onclick="'
                        + closeAction + '">知道了</button>' +
                '</div>' +
            '</div>'
        );
    }

    function closeReview(reload) {
        if (window.ModalOverlay) window.ModalOverlay.close(REVIEW_MODAL_ID);
        if (reload) window.location.reload();
    }

    async function openReviewFromRaw(assignmentId, taskId) {
        if (!window.ModalOverlay) return;
        window.ModalOverlay.open({
            id: REVIEW_MODAL_ID,
            tier: 'A',
            contentHtml: '<div style="max-width:760px; width:94vw; background:white; border-radius:14px; padding:24px; text-align:center; color:#64748B; font-weight:700;">⏳ 讀取最新批改結果…</div>'
        });
        await refreshCompletionFromDb(assignmentId, taskId);
        renderReviewFromCache(assignmentId, taskId, false);
    }

    function renderReviewFromCache(assignmentId, taskId, reloadOnClose) {
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const stats = readStats(raw);
        const qr = raw.quiz_result || {};
        const result = {
            correct: qr.correct != null ? qr.correct : '—',
            total: qr.total != null ? qr.total : '—',
            score: qr.score != null ? qr.score : '—'
        };
        const retake = raw.quiz_retake || null;
        const retakeEligible = !!(retake && !retake.done && Array.isArray(retake.item_ids) && retake.item_ids.length);
        const retakeReportReady = !!(retake && retake.done);
        const task = findTaskInAssignments(assignmentId, taskId);
        const allowAppeal = !!(task && task.raw_data && task.raw_data.allow_answer_appeal !== false);
        window.ModalOverlay.open({
            id: REVIEW_MODAL_ID,
            tier: 'A',
            contentHtml: buildReviewHtml('作答檢討與錯字紀錄', result, stats, {
                reloadOnClose: !!reloadOnClose,
                assignmentId: assignmentId,
                taskId: taskId,
                retakeEligible: retakeEligible,
                retakeReportReady: retakeReportReady,
                allowAppeal: allowAppeal,
                inputCorrectionEnabled: !!(task && task.raw_data && task.raw_data.input_correction_enabled),
                appealsByItemId: appealsByItemIdFromRaw(raw)
            })
        });
    }

    /** 同 headlineFromWrongItem 的雷區說明：displayNo（畫面上排第幾題）優先於 it.seq。 */
    function formatItemHeadline(it, displayNo) {
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.formatItemHeadline === 'function') {
            const shared = window.QuizPaperBuilder.formatItemHeadline(it, displayNo);
            if (shared) return shared;
        }
        const seq = displayNo != null ? String(displayNo) : (it && it.seq != null ? String(it.seq) : '');
        const src = (it && it.source) || {};
        const vbk = String(src.vbk_name || src.vBK_name || '').trim();
        const sheet = vbk || displaySheetName(src.sheet_id);
        const page = src.page != null && src.page !== '' ? String(src.page) : '';
        const itemNo = String(src.item_no_label != null && src.item_no_label !== ''
            ? src.item_no_label
            : (src.item_no != null && src.item_no !== '' ? src.item_no : '')).trim();
        let meta = '';
        if (sheet && page && itemNo) meta = sheet + ' - ' + page + ' - ' + itemNo;
        else if (sheet && itemNo) meta = sheet + ' - ' + itemNo;
        else {
            const stack = (it.cells && it.cells[0] && it.cells[0].text) || '';
            const parts = String(stack).split(/\s+/).map(function (p) {
                return String(p || '').trim();
            }).filter(Boolean);
            if (parts.length >= 3) meta = displaySheetName(parts[0]) + ' - ' + parts[1] + ' - ' + parts[2];
            else if (parts.length) meta = parts.map(function (p, i) { return i === 0 ? displaySheetName(p) : p; }).join(' - ');
        }
        if (seq && meta) return seq + '. ' + meta;
        if (seq) return seq + '.';
        return meta || '';
    }

    function answerInputAttrs(itemId, prevAnswer) {
        return 'class="form-control quiz-answer-input" data-item-id="' + esc(itemId) + '" '
            + 'type="text" lang="en" inputmode="text" '
            + 'name="quiz-ans-' + esc(itemId) + '" '
            + 'autocomplete="off" autocorrect="off" autocapitalize="off" '
            + 'spellcheck="false" '
            + 'data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" '
            + 'data-lt-active="false" '
            + 'placeholder="請輸入英文答案" value="' + esc(prevAnswer || '') + '" '
            + 'style="width:100%; margin-top:8px; padding:8px 10px; border:1px solid #CBD5E1; border-radius:8px; font-size:0.95rem;"';
    }

    /** 一題多空格（分開比對，見 QuizPaperBuilder 的 sub_answers）：每個空格各自一個輸入框，用 data-sub-key 區分 */
    function subAnswerInputAttrs(itemId, subKey, prevValue) {
        return 'class="form-control quiz-answer-input quiz-sub-answer-input" data-item-id="' + esc(itemId) + '" data-sub-key="' + esc(subKey) + '" '
            + 'type="text" lang="en" inputmode="text" '
            + 'name="quiz-ans-' + esc(itemId) + '-' + esc(subKey) + '" '
            + 'autocomplete="off" autocorrect="off" autocapitalize="off" '
            + 'spellcheck="false" '
            + 'data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" '
            + 'data-lt-active="false" '
            + 'placeholder="請輸入英文答案" value="' + esc(prevValue || '') + '" '
            + 'style="width:100%; margin-top:6px; padding:8px 10px; border:1px solid #CBD5E1; border-radius:8px; font-size:0.95rem;"';
    }

    function hardenAnswerInputs(root) {
        if (!root) return;
        root.querySelectorAll('.quiz-answer-input').forEach(function (el) {
            el.setAttribute('spellcheck', 'false');
            el.setAttribute('autocomplete', 'off');
            el.setAttribute('autocorrect', 'off');
            el.setAttribute('autocapitalize', 'off');
            el.setAttribute('data-gramm', 'false');
            el.setAttribute('data-gramm_editor', 'false');
            el.setAttribute('data-enable-grammarly', 'false');
            el.setAttribute('data-lt-active', 'false');
            try { el.spellcheck = false; } catch (_e) { /* ignore */ }
        });
    }

    function renderItemRow(it, prevAnswer, displayNo) {
        const prompt = it.prompt_zh || (it.cells && it.cells[1] && it.cells[1].text) || '';
        const fontDelta = (it.cells && it.cells[1] && it.cells[1].fontDelta) || 0;
        const fontSize = Math.max(0.75, 1 + (fontDelta * 0.08));
        const headline = formatItemHeadline(it, displayNo);
        const cloze = it.quiz_mode === 'cloze' && it.cloze_stem
            ? '<div style="margin-top:4px; color:#0F766E; font-weight:700; white-space:pre-wrap;">' + esc(it.cloze_stem) + '</div>'
            : '';
        // 一題多空格（分開比對）：每個空格各自一個輸入框＋小標籤；prevAnswer 這時是 {sub_key: value} 物件
        let inputsHtml;
        if (Array.isArray(it.sub_answers) && it.sub_answers.length > 1) {
            const prevObj = (prevAnswer && typeof prevAnswer === 'object') ? prevAnswer : {};
            inputsHtml = it.sub_answers.map(function (sa, idx) {
                return '<div style="margin-top:2px;">'
                    + '<label style="font-size:0.7rem; color:#64748B; font-weight:700;">空格 ' + (idx + 1) + '</label>'
                    + '<input ' + subAnswerInputAttrs(it.item_id, sa.key, prevObj[sa.key]) + '>'
                    + '</div>';
            }).join('');
        } else {
            inputsHtml = '<input ' + answerInputAttrs(it.item_id, (typeof prevAnswer === 'string' ? prevAnswer : '')) + '>';
        }
        return (
            '<div data-quiz-item="' + esc(it.item_id) + '" style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:10px; background:#F8FAFC;">' +
                '<div style="font-size:0.85rem; color:#0F766E; font-weight:900; margin-bottom:6px;">' + esc(headline) + '</div>' +
                '<div style="font-size:' + fontSize + 'rem; font-weight:800; color:#1E293B; white-space:pre-wrap;">' + esc(prompt) + '</div>' +
                cloze +
                inputsHtml +
            '</div>'
        );
    }

    function collectAnswers(bodyId) {
        const scope = bodyId || (MODAL_ID + '-body');
        const map = {};
        document.querySelectorAll('#' + scope + ' .quiz-sub-answer-input').forEach(function (el) {
            const id = el.getAttribute('data-item-id');
            const key = el.getAttribute('data-sub-key');
            if (!id || !key) return;
            if (!map[id] || typeof map[id] !== 'object') map[id] = {};
            map[id][key] = el.value;
        });
        document.querySelectorAll('#' + scope + ' .quiz-answer-input:not(.quiz-sub-answer-input)').forEach(function (el) {
            const id = el.getAttribute('data-item-id');
            if (id) map[id] = el.value;
        });
        return map;
    }

    function updateLeaveBadge() {
        const el = document.getElementById(MODAL_ID + '-leave-count');
        if (el) el.textContent = String(leaveCount);
        const wrap = document.getElementById(MODAL_ID + '-leave-badge');
        if (wrap) {
            wrap.style.background = leaveCount > 0 ? '#FEF2F2' : '#F1F5F9';
            wrap.style.borderColor = leaveCount > 0 ? '#FECACA' : '#E2E8F0';
            wrap.style.color = leaveCount > 0 ? '#B91C1C' : '#64748B';
        }
    }

    function recordLeave(reason) {
        if (!examGuardOn) return;
        const now = Date.now();
        if (now - lastLeaveAt < 900) return;
        lastLeaveAt = now;
        leaveCount += 1;
        leaveLog.push({
            at: new Date().toISOString(),
            reason: String(reason || 'unknown')
        });
        updateLeaveBadge();
    }

    function isFullscreen() {
        return !!(document.fullscreenElement
            || document.webkitFullscreenElement
            || document.msFullscreenElement);
    }

    function requestExamFullscreen(el) {
        const target = el || document.documentElement;
        const req = target.requestFullscreen
            || target.webkitRequestFullscreen
            || target.msRequestFullscreen;
        if (!req) return Promise.resolve(false);
        return Promise.resolve(req.call(target)).then(function () {
            return true;
        }).catch(function () {
            return false;
        });
    }

    function exitExamFullscreen() {
        if (!isFullscreen()) return Promise.resolve();
        allowFsExit = true;
        const exit = document.exitFullscreen
            || document.webkitExitFullscreen
            || document.msExitFullscreen;
        if (!exit) {
            allowFsExit = false;
            return Promise.resolve();
        }
        return Promise.resolve(exit.call(document)).catch(function () {
            /* ignore */
        }).then(function () {
            setTimeout(function () { allowFsExit = false; }, 400);
        });
    }

    function patchLocalCompletion(assignmentId, taskId, rawPayload, completed) {
        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
        let row = findCompletion(assignmentId, taskId);
        if (!row) {
            row = {
                assignment_id: assignmentId,
                task_id: String(taskId),
                status: completed ? 'completed' : 'incomplete',
                raw_data: {}
            };
            window._studentTaskCompletions.push(row);
        }
        row.raw_data = Object.assign({}, row.raw_data || {}, rawPayload);
        if (completed) row.status = 'completed';
    }

    /**
     * 💣 雷區（2026-08-11 老師回報「再做一次，題目順序跟第一次一模一樣」）：`quiz_paper.items`
     * 是老師產生線上卷時「只排序一次」存下來的固定順序，不管哪個學生、第幾次打開都是同一份
     * 靜態陣列，老師勾的 shuffle 只在「產生線上卷」那一刻生效，之後每次重新打開都是同一個
     * 順序——這樣重做／重考完全失去「打亂順序」的意義。
     * 修正：只影響「畫面顯示順序」，不動 paper.items 本身（批改／檢討仍以 item_id 對應，跟
     * 順序無關，見 gradeAnswers／collectAnswers），每次開始作答／重做都重新洗牌一次，
     * 老師若在出題設定關掉 shuffle 才維持固定順序。
     */
    function displayOrderItems(paper, task) {
        const items = (paper && paper.items) || [];
        const opts = task && task.raw_data && task.raw_data.exam_job && task.raw_data.exam_job.options;
        const shuffleOn = !(opts && opts.shuffle === false);
        if (!shuffleOn || !window.QuizPaperBuilder || typeof window.QuizPaperBuilder.shuffleInPlace !== 'function') {
            return items;
        }
        return window.QuizPaperBuilder.shuffleInPlace(items.slice());
    }

    function replaceLocalCompletion(assignmentId, taskId, row) {
        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
        const idx = window._studentTaskCompletions.findIndex(function (c) {
            return String(c.task_id) === String(taskId) && String(c.assignment_id) === String(assignmentId);
        });
        if (idx === -1) window._studentTaskCompletions.push(row);
        else window._studentTaskCompletions[idx] = row;
    }

    /**
     * 💣 雷區（2026-08-11 學生回報「點錯題檢討，分數沒有重算」）：`window._studentTaskCompletions`
     * 只在整頁載入（`fetchData`）時抓過一次；老師端「考試批改」／申訴審核接受後是直接改資料庫，
     * 學生瀏覽器裡的舊快取不會自動跟著變。開「檢討」／「整體報告」前先跟資料庫要一次最新的
     * completion，不要只信任 page load 時的快取。失敗（離線／RLS）就靜默退回舊快取，不擋開啟。
     */
    async function refreshCompletionFromDb(assignmentId, taskId) {
        try {
            if (!window.supabaseClient || !isAssignmentId(assignmentId)) return findCompletion(assignmentId, taskId);
            const auth = await getAuthContext();
            const { data, error } = await window.supabaseClient
                .from('task_completions')
                .select('id, assignment_id, task_id, status, raw_data')
                .eq('assignment_id', assignmentId)
                .eq('task_id', String(taskId))
                .eq('student_id', auth.userId)
                .is('deleted_at', null)
                .maybeSingle();
            if (error || !data) return findCompletion(assignmentId, taskId);
            let rawData = data.raw_data;
            if (typeof rawData === 'string') {
                try { rawData = JSON.parse(rawData); } catch (_e) { rawData = {}; }
            }
            const row = { id: data.id, assignment_id: data.assignment_id, task_id: String(data.task_id), status: data.status, raw_data: rawData || {} };
            replaceLocalCompletion(assignmentId, taskId, row);
            return row;
        } catch (err) {
            console.warn('[FeatureStudentQuiz] refreshCompletionFromDb', err);
            return findCompletion(assignmentId, taskId);
        }
    }

    async function getAuthContext() {
        if (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAuthContext === 'function') {
            return window.FeatureStudentTimeline.getAuthContext();
        }
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        const { data: { user }, error } = await window.supabaseClient.auth.getUser();
        if (error || !user) throw new Error('尚未登入');
        const classId = sessionStorage.getItem('currentClassId') || '';
        if (!classId) throw new Error('找不到班級');
        if (!isUuid(classId)) {
            throw new Error('班級 ID 異常（' + classId + '）。請重新選擇班級後再繳交。');
        }
        return { userId: user.id, classId: classId };
    }

    async function persistResult(assignmentId, taskId, rawPayload, completed) {
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        if (!isAssignmentId(assignmentId)) {
            throw new Error('作業 ID 格式錯誤（' + assignmentId + '）。請強制重新整理後再試。');
        }
        const auth = await getAuthContext();
        const assignmentKey = (/^\d+$/.test(String(assignmentId).trim()))
            ? Number(assignmentId)
            : assignmentId;
        const { error: rpcErr } = await window.supabaseClient.rpc('student_set_task_completion', {
            p_assignment_id: assignmentKey,
            p_task_id: String(taskId),
            p_class_id: auth.classId,
            p_completed: !!completed,
            p_raw_data: rawPayload
        });
        if (rpcErr) {
            const rpcMsg = String(rpcErr.message || rpcErr.details || '');
            const rpcMissing = /Could not find the function|does not exist|PGRST202|404/i.test(rpcMsg);
            if (!rpcMissing) throw rpcErr;
            const payload = {
                assignment_id: assignmentId,
                task_id: String(taskId),
                student_id: auth.userId,
                class_id: auth.classId,
                status: completed ? 'completed' : 'submitted',
                deleted_at: null,
                raw_data: rawPayload
            };
            const { data: updatedRows, error: updateErr } = await window.supabaseClient.from('task_completions')
                .update(payload)
                .eq('task_id', String(taskId))
                .eq('student_id', auth.userId)
                .eq('class_id', auth.classId)
                .select();
            if (updateErr) throw updateErr;
            if (!updatedRows || !updatedRows.length) {
                const { error: insertErr } = await window.supabaseClient.from('task_completions')
                    .insert([payload]);
                if (insertErr) throw insertErr;
            }
        }
        patchLocalCompletion(assignmentId, taskId, rawPayload, completed);
    }

    async function persistQuitIfNeeded() {
        if (sessionSubmitted || sessionQuitSaved) return;
        if (!sessionAssignmentId || !sessionTaskId) return;
        sessionQuitSaved = true;
        const prevRaw = sessionBaseRaw || {};
        const stats = readStats(prevRaw);
        stats.quit_count += 1;
        stats.leave_count_total += leaveCount;
        stats.last_leave_count = leaveCount;
        stats.last_leave_log = leaveLog.slice();
        pushHistory(stats, {
            at: new Date().toISOString(),
            type: 'quit',
            leave_count: leaveCount
        });
        const keepCompleted = stats.complete_count > 0;
        // 注意：Postgres jsonb || 若帶 null 會蓋掉舊值；quit 時只更新 quiz_stats
        const rawPayload = { quiz_stats: stats };
        if (prevRaw.quiz_result) rawPayload.quiz_result = prevRaw.quiz_result;
        if (prevRaw.quiz_answers) rawPayload.quiz_answers = prevRaw.quiz_answers;
        try {
            await persistResult(sessionAssignmentId, sessionTaskId, rawPayload, keepCompleted);
        } catch (err) {
            console.warn('[FeatureStudentQuiz] persist quit', err);
            sessionQuitSaved = false;
        }
    }

    function closeQuizNow() {
        allowUnload = true;
        const doClose = function () {
            detachExamGuards();
            exitExamFullscreen().then(function () {
                if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
            });
        };
        // 先寫 quit，再關（不阻塞太久）
        persistQuitIfNeeded().then(doClose).catch(doClose);
    }

    function detachExamGuards() {
        examGuardOn = false;
        leftWhileHidden = false;
        if (beforeUnloadHandler) {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            beforeUnloadHandler = null;
        }
        if (visibilityHandler) {
            document.removeEventListener('visibilitychange', visibilityHandler);
            visibilityHandler = null;
        }
        if (fullscreenHandler) {
            document.removeEventListener('fullscreenchange', fullscreenHandler);
            document.removeEventListener('webkitfullscreenchange', fullscreenHandler);
            fullscreenHandler = null;
        }
    }

    function attachExamGuards(overlayEl) {
        detachExamGuards();
        examGuardOn = true;
        allowUnload = false;
        allowFsExit = false;
        leaveCount = 0;
        leaveLog = [];
        lastLeaveAt = 0;
        leftWhileHidden = false;
        updateLeaveBadge();

        beforeUnloadHandler = function (e) {
            if (!examGuardOn || allowUnload) return;
            // 盡力寫 quit（不等待）
            persistQuitIfNeeded();
            e.preventDefault();
            e.returnValue = LEAVE_MSG;
            return LEAVE_MSG;
        };
        window.addEventListener('beforeunload', beforeUnloadHandler);

        visibilityHandler = function () {
            if (!examGuardOn) return;
            if (document.visibilityState === 'hidden') {
                leftWhileHidden = true;
                recordLeave('tab_hidden');
                return;
            }
            if (leftWhileHidden && document.visibilityState === 'visible') {
                leftWhileHidden = false;
                const keepGoing = window.confirm(TAB_RETURN_MSG + '\n目前離開次數：' + leaveCount);
                if (!keepGoing) {
                    closeQuizNow();
                    return;
                }
                if (!isFullscreen()) {
                    requestExamFullscreen(overlayEl || document.documentElement);
                }
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        fullscreenHandler = function () {
            if (!examGuardOn || allowFsExit) return;
            if (isFullscreen()) return;
            recordLeave('fullscreen_exit');
            const keepGoing = window.confirm(FS_EXIT_MSG + '\n目前離開次數：' + leaveCount);
            if (!keepGoing) {
                closeQuizNow();
                return;
            }
            requestExamFullscreen(overlayEl || document.documentElement).then(function (ok) {
                if (!ok) {
                    window.showFlash('無法恢復全螢幕，請手動按 F11 或允許全螢幕後繼續', 'warning');
                }
            });
        };
        document.addEventListener('fullscreenchange', fullscreenHandler);
        document.addEventListener('webkitfullscreenchange', fullscreenHandler);
    }

    function requestCloseQuiz() {
        if (!examGuardOn) {
            closeQuizNow();
            return;
        }
        if (!window.confirm('作答尚未繳交，確定要中斷考試並關閉？\n目前離開次數：' + leaveCount)) return;
        closeQuizNow();
    }

    function openQuiz(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        const paper = getPaper(task);
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return window.showFlash('老師尚未產生線上卷（請先按「產生線上卷」並儲存作業）', 'warning');
        }

        const prev = findCompletion(assignmentId, taskId);
        const prevRaw = (prev && prev.raw_data) ? prev.raw_data : {};
        sessionBaseRaw = JSON.parse(JSON.stringify(prevRaw || {}));
        sessionAssignmentId = assignmentId;
        sessionTaskId = taskId;
        sessionSubmitted = false;
        sessionQuitSaved = false;

        const stats = readStats(prevRaw);
        stats.attempt_count += 1;
        pushHistory(stats, { at: new Date().toISOString(), type: 'open' });
        sessionBaseRaw.quiz_stats = stats;
        // 開啟即寫入 attempt（失敗不擋作答）
        persistResult(assignmentId, taskId, { quiz_stats: stats }, stats.complete_count > 0).catch(function (err) {
            console.warn('[FeatureStudentQuiz] persist open', err);
        });

        const statsHtml = formatStatsSummaryHtml(sessionBaseRaw);
        const prevScoreHtml = statsHtml
            ? ('<div style="margin-bottom:10px; padding:8px 10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px;">' + statsHtml + '</div>')
            : '';

        // 💣 雷區（2026-08-11 老師回報「重做又把上次答案帶進來」）：這裡不能拿 prevRaw.quiz_answers
        // 幫每格 input 帶預設值。這個 app 沒有「作答中途暫存」機制，quiz_answers 只會在 submit()
        // 成功繳交後才寫入——換句話說，只要 prevRaw.quiz_answers 有值，就一定代表學生已經交過
        // 一次，現在是重新開始作答（不是「還沒交、續寫上次沒填完的」），所以一律要空白，跟
        // openRetakeQuiz 的錯題重做同精神，不要用「上次交的答案」預先幫學生填好。
        // 💣 雷區（2026-08-12 老師回報「題號 35、21、36…看起來亂掉」）：洗牌只能動「顯示順序」，
        // 標題編號要跟著畫面上排第幾題（idx+1）走，不能繼續印 it.seq（那是出卷時的固定編號，
        // 洗牌後跟畫面位置對不上，看起來像是卷子壞了）。這裡順便把這次實際顯示的順序記下來
        // （sessionDisplayOrder），submit() 交卷時要用同一份順序算編號，不能再重新洗牌一次。
        const displayItems = displayOrderItems(paper, task);
        sessionDisplayOrder = displayItems.map(function (it) { return it.item_id; });
        const itemsHtml = displayItems.map(function (it, idx) {
            return renderItemRow(it, undefined, idx + 1);
        }).join('');

        const title = String(task.title || (task.raw_data && task.raw_data.exam_title) || '線上考試')
            .replace(/<[^>]*>?/gm, '');

        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') {
            return window.showFlash('ModalOverlay 未載入', 'error');
        }

        const safeAssign = String(assignmentId).replace(/'/g, "\\'");
        const safeTask = String(taskId).replace(/'/g, "\\'");

        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: 'B',
            isDirty: function () { return examGuardOn && !sessionSubmitted; },
            unsavedMessage: '作答尚未繳交，確定要中斷考試並關閉？',
            onCancel: function () {
                // backdrop 確認關閉：記 quit
                persistQuitIfNeeded();
            },
            onClose: function () {
                detachExamGuards();
                exitExamFullscreen();
                if (!sessionSubmitted && !sessionQuitSaved) {
                    persistQuitIfNeeded();
                }
            },
            onMount: function (overlay) {
                hardenAnswerInputs(overlay);
                overlay.style.padding = '0';
                overlay.style.alignItems = 'stretch';
                overlay.style.justifyContent = 'stretch';
                const panel = overlay.firstElementChild;
                if (panel) {
                    panel.style.maxWidth = 'none';
                    panel.style.width = '100%';
                    panel.style.minHeight = '100vh';
                    panel.style.borderRadius = '0';
                    panel.style.boxSizing = 'border-box';
                }
                const body = document.getElementById(MODAL_ID + '-body');
                if (body) body.style.maxHeight = 'calc(100vh - 180px)';

                attachExamGuards(overlay);
                requestExamFullscreen(overlay).then(function (ok) {
                    if (!ok) {
                        window.showFlash('瀏覽器未允許全螢幕。請允許後再試，或按 F11；離開仍會被記錄。', 'warning');
                    }
                });
            },
            contentHtml:
                '<div style="max-width:720px; width:92vw; background:white; border-radius:14px; padding:18px 18px 14px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">' +
                        '<h3 style="margin:0; font-size:1.15rem; font-weight:900; color:#0F766E;">📝 ' + esc(title) + '</h3>' +
                        '<div style="display:flex; align-items:center; gap:8px;">' +
                            '<span id="' + MODAL_ID + '-leave-badge" style="font-size:0.8rem; font-weight:900; padding:4px 10px; border-radius:999px; border:1px solid #E2E8F0; background:#F1F5F9; color:#64748B;">離開 <span id="' + MODAL_ID + '-leave-count">0</span> 次</span>' +
                            '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="window.FeatureStudentQuiz.requestCloseQuiz()">關閉</button>' +
                        '</div>' +
                    '</div>' +
                    prevScoreHtml +
                    '<div style="font-size:0.8rem; color:#64748B; margin-bottom:10px;">共 ' + paper.items.length
                        + ' 題 · 全螢幕考試 · 切頁／離開全螢幕會計次 · 已關閉瀏覽器拼字建議</div>' +
                    '<div id="' + MODAL_ID + '-body" style="max-height:60vh; overflow:auto;">' + itemsHtml + '</div>' +
                    '<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">' +
                        '<button type="button" class="btn btn-action" style="background:#0F766E; color:white; border:none; padding:8px 14px; font-weight:800;" ' +
                            "onclick=\"window.FeatureStudentQuiz.submit('" + safeAssign + "','" + safeTask + "')\">繳交並看分數</button>" +
                    '</div>' +
                '</div>'
        });
    }

    async function submit(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        const paper = getPaper(task);
        if (!paper) return window.showFlash('找不到考卷', 'error');
        if (!window.QuizPaperBuilder) return window.showFlash('評分模組未載入', 'error');

        const answers = collectAnswers();
        const result = window.QuizPaperBuilder.gradeAnswers(paper, answers);
        const gradedAt = new Date().toISOString();

        const prevRaw = sessionBaseRaw || {};
        const stats = readStats(prevRaw);
        stats.complete_count += 1;
        stats.leave_count_total += leaveCount;
        stats.last_leave_count = leaveCount;
        stats.last_leave_log = leaveLog.slice();
        // 錯題本編號＝這題在「這次作答畫面上」排第幾題（sessionDisplayOrder），不是錯題清單裡
        // 排第幾個、也不是出卷時的固定 seq——用畫面順序才能讓學生對得起來「剛剛看到的第幾題」。
        // 💣 雷區（2026-08-13 老師回報「編號還是 7,1,6,4 這樣亂跳」）：上面這段只修到「每一張
        // 卡片標籤該寫哪個數字」，從來沒有修到「這些卡片本身要照哪個順序排」——result.wrong_items
        // 本來是照 gradeAnswers 內部走 paper.items 的固有順序（不是畫面洗牌後的順序），只把
        // headline 換算成畫面順序、卻沒有把陣列本身也重新排序，於是卡片還是照舊順序一張一張
        // 排出來，只是每張卡片頭上印的號碼變成了畫面順序，兩者對不起來就會看到號碼跳來跳去。
        // 這裡在算完每張卡片的 displayNo 之後，一定要連陣列順序一起重新排序，號碼跟排列順序
        // 才會一致（1、4、6、7 這樣照順序排，不是 7、1、6、4）。
        const displayOrderIdx = orderIndexMap(sessionDisplayOrder);
        stats.wrong_items = (result.wrong_items || []).map(function (d, idx) {
            const item = {
                item_id: d.item_id,
                seq: d.seq,
                prompt_zh: d.prompt_zh || '',
                expected: d.expected || '',
                answer: d.answer || '',
                source: d.source || null,
                diff: d.diff || null,
                spelling_pairs: (d.diff && d.diff.spelling_pairs) || []
            };
            const displayNo = displayOrderIdx[String(d.item_id)] || (idx + 1);
            item.headline = headlineFromWrongItem(item, displayNo);
            item._sortDisplayNo = displayNo;
            return item;
        });
        stats.wrong_items.sort(function (a, b) { return a._sortDisplayNo - b._sortDisplayNo; });
        stats.wrong_items.forEach(function (item) { delete item._sortDisplayNo; });
        appendSpellingHistory(stats, stats.wrong_items, stats.complete_count, gradedAt);
        pushHistory(stats, {
            at: gradedAt,
            type: 'complete',
            leave_count: leaveCount,
            score: result.score,
            correct: result.correct,
            total: result.total,
            wrong_count: stats.wrong_items.length
        });

        // 不把全卷 details 塞進 DB（避免 task_completions 過肥）
        const rawPayload = {
            quiz_answers: answers,
            quiz_stats: stats,
            quiz_result: {
                score: result.score,
                correct: result.correct,
                total: result.total,
                wrong_items: stats.wrong_items,
                graded_at: gradedAt,
                leave_count: leaveCount,
                leave_log: leaveLog.slice(),
                complete_count: stats.complete_count,
                quit_count: stats.quit_count,
                leave_count_total: stats.leave_count_total
            }
        };

        // 老師勾了「允許重考錯題」才凍結這次的錯題 item_id 清單；每次整卷重考都會覆蓋成最新一次的錯題，
        // 重考本身仍是「僅一次」（quiz_retake.done）。沒錯題就清空舊的重考狀態，避免留著上次的殘影。
        const allowRetake = !!(task && task.raw_data && task.raw_data.allow_wrong_retake);
        let retakeEligible = false;
        if (allowRetake) {
            if (stats.wrong_items.length) {
                rawPayload.quiz_retake = {
                    item_ids: stats.wrong_items.map(function (w) { return w.item_id; }),
                    done: false,
                    answers: {},
                    result: null,
                    combined: null,
                    based_on_graded_at: gradedAt
                };
                retakeEligible = true;
            } else {
                rawPayload.quiz_retake = null;
            }
        }

        try {
            sessionSubmitted = true;
            sessionQuitSaved = true;
            await persistResult(assignmentId, taskId, rawPayload, true);
            allowUnload = true;
            detachExamGuards();
            await exitExamFullscreen();
            if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);

            window.ModalOverlay.open({
                id: REVIEW_MODAL_ID,
                tier: 'A',
                contentHtml: buildReviewHtml('繳交結果・錯題與錯字', result, stats, {
                    reloadOnClose: true,
                    assignmentId: assignmentId,
                    taskId: taskId,
                    retakeEligible: retakeEligible,
                    allowAppeal: !!(task && task.raw_data && task.raw_data.allow_answer_appeal !== false),
                    inputCorrectionEnabled: !!(task && task.raw_data && task.raw_data.input_correction_enabled),
                    appealsByItemId: appealsByItemIdFromRaw(rawPayload)
                })
            });
        } catch (err) {
            sessionSubmitted = false;
            sessionQuitSaved = false;
            console.error('[FeatureStudentQuiz] submit', err);
            window.showFlash('繳交失敗：' + (err.message || err), 'error');
        }
    }

    function startRetakeFromReview(assignmentId, taskId) {
        // 直接關閉，不走 closeReview(reload)：馬上重考不用整頁重整，重考完的報告關閉才 reload
        if (window.ModalOverlay) window.ModalOverlay.close(REVIEW_MODAL_ID);
        openRetakeQuiz(assignmentId, taskId);
    }

    function openRetakeQuiz(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        const paper = getPaper(task);
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return window.showFlash('找不到考卷內容', 'error');
        }
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const retake = raw.quiz_retake;
        if (!retake || !Array.isArray(retake.item_ids) || !retake.item_ids.length) {
            return window.showFlash('目前沒有可重考的錯題', 'warning');
        }
        if (retake.done) {
            return openRetakeReportFromRaw(assignmentId, taskId);
        }
        const idSet = {};
        retake.item_ids.forEach(function (id) { idSet[String(id)] = true; });
        const retakeItems = displayOrderItems(paper, task).filter(function (it) { return idSet[String(it.item_id)]; });
        if (!retakeItems.length) {
            return window.showFlash('找不到對應的錯題內容（考卷可能已更動），無法重考', 'error');
        }
        // 同 openQuiz：記下這次重考實際顯示的順序，submitRetake 交卷時要用同一份順序算編號。
        sessionRetakeDisplayOrder = retakeItems.map(function (it) { return it.item_id; });
        const title = String(task.title || (task.raw_data && task.raw_data.exam_title) || '線上考試')
            .replace(/<[^>]*>?/gm, '');

        // 💣 雷區（2026-08-11 老師回報「錯題重做直接帶入第一次答案」）：這裡故意不傳
        // 第二個參數——錯題重做要讓學生看著空白重寫，不能把「當初寫錯的答案」直接帶入
        // input（那樣等於叫學生重新照抄一次錯的答案）。openQuiz 整份重做同理也已經拿掉
        // 同樣的 prevAnswers 帶入邏輯，兩邊行為現在是一致的。
        const itemsHtml = retakeItems.map(function (it, idx) {
            return renderItemRow(it, undefined, idx + 1);
        }).join('');

        const safeAssign = String(assignmentId).replace(/'/g, "\\'");
        const safeTask = String(taskId).replace(/'/g, "\\'");

        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') {
            return window.showFlash('ModalOverlay 未載入', 'error');
        }

        window.ModalOverlay.open({
            id: RETAKE_MODAL_ID,
            tier: 'B',
            isDirty: function () { return true; },
            unsavedMessage: '錯題重考尚未繳交，確定要關閉？',
            onMount: function (overlay) { hardenAnswerInputs(overlay); },
            contentHtml:
                '<div style="max-width:720px; width:92vw; max-height:90vh; display:flex; flex-direction:column; background:white; border-radius:14px; padding:18px 18px 14px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#B45309;">🔁 錯題重考・' + esc(title) + '</h3>' +
                        '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'' + RETAKE_MODAL_ID + '\')">關閉</button>' +
                    '</div>' +
                    '<div style="font-size:0.8rem; color:#92400E; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:8px 10px; margin-bottom:10px;">' +
                        '本次只重考上次答錯的 ' + retakeItems.length + ' 題，僅能重考一次，交卷後會產生整體報告（原始成績＋訂正後成績）。</div>' +
                    '<div id="' + RETAKE_MODAL_ID + '-body" style="overflow:auto; flex:1;">' + itemsHtml + '</div>' +
                    '<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">' +
                        '<button type="button" class="btn btn-action" style="background:#B45309; color:white; border:none; padding:8px 14px; font-weight:800;" ' +
                            "onclick=\"window.FeatureStudentQuiz.submitRetake('" + safeAssign + "','" + safeTask + "')\">繳交錯題重考</button>" +
                    '</div>' +
                '</div>'
        });
    }

    async function submitRetake(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        const paper = getPaper(task);
        if (!paper) return window.showFlash('找不到考卷', 'error');
        if (!window.QuizPaperBuilder) return window.showFlash('評分模組未載入', 'error');

        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const retake = raw.quiz_retake;
        if (!retake || !Array.isArray(retake.item_ids) || !retake.item_ids.length) {
            return window.showFlash('找不到重考範圍，請關閉後重新整理再試', 'error');
        }
        const idSet = {};
        retake.item_ids.forEach(function (id) { idSet[String(id)] = true; });
        const retakeItems = paper.items.filter(function (it) { return idSet[String(it.item_id)]; });
        const retakePaper = Object.assign({}, paper, { items: retakeItems });

        const answers = collectAnswers(RETAKE_MODAL_ID + '-body');
        const result = window.QuizPaperBuilder.gradeAnswers(retakePaper, answers);
        const gradedAt = new Date().toISOString();

        // 同 submit()：編號要照這次重考畫面實際顯示的順序（sessionRetakeDisplayOrder），
        // 不是重批清單裡排第幾個。同一個雷區：算完 displayNo 後，陣列本身也要照 displayNo
        // 重新排序，不能只換算號碼卻維持舊順序（見 submit() 裡的說明）。
        const retakeDisplayOrderIdx = orderIndexMap(sessionRetakeDisplayOrder);
        const retakeWrongItems = (result.wrong_items || []).map(function (d, idx) {
            const item = {
                item_id: d.item_id,
                seq: d.seq,
                prompt_zh: d.prompt_zh || '',
                expected: d.expected || '',
                answer: d.answer || '',
                source: d.source || null,
                diff: d.diff || null,
                spelling_pairs: (d.diff && d.diff.spelling_pairs) || []
            };
            const displayNo = retakeDisplayOrderIdx[String(d.item_id)] || (idx + 1);
            item.headline = headlineFromWrongItem(item, displayNo);
            item._sortDisplayNo = displayNo;
            return item;
        });
        retakeWrongItems.sort(function (a, b) { return a._sortDisplayNo - b._sortDisplayNo; });
        retakeWrongItems.forEach(function (item) { delete item._sortDisplayNo; });

        const originalResult = raw.quiz_result || {};
        const originalTotal = Number(originalResult.total) || 0;
        const originalCorrect = Number(originalResult.correct) || 0;
        // 合併正確率＝（原始答對＋錯題重考答對）/ 原始總題數（分母不變，重考題只是原始錯題的子集訂正）
        const combinedCorrect = originalCorrect + result.correct;
        const combinedRate = originalTotal > 0 ? Math.round((combinedCorrect / originalTotal) * 1000) / 10 : null;

        const updatedRetake = {
            item_ids: retake.item_ids.slice(),
            done: true,
            answers: answers,
            graded_at: gradedAt,
            result: {
                score: result.score,
                correct: result.correct,
                total: result.total,
                wrong_items: retakeWrongItems
            },
            combined: {
                correct: combinedCorrect,
                total: originalTotal,
                rate: combinedRate
            }
        };

        try {
            await persistResult(assignmentId, taskId, { quiz_retake: updatedRetake }, true);
            if (window.ModalOverlay) window.ModalOverlay.close(RETAKE_MODAL_ID);
            openRetakeReportModal(assignmentId, taskId, originalResult, updatedRetake, appealsByItemIdFromRaw(raw));
        } catch (err) {
            console.error('[FeatureStudentQuiz] submitRetake', err);
            window.showFlash('重考繳交失敗：' + (err.message || err), 'error');
        }
    }

    function buildRetakeReportHtml(title, originalResult, retake, opts) {
        opts = opts || {};
        const combined = retake.combined || {};
        const wrongItems = (retake.result && retake.result.wrong_items) || [];
        const totalRetake = Array.isArray(retake.item_ids) ? retake.item_ids.length : 0;
        const fixedCount = Math.max(0, totalRetake - wrongItems.length);
        const appealsByItemId = opts.appealsByItemId || {};
        const cardOpts = { allowAppeal: opts.allowAppeal, appealsByItemId: appealsByItemId };
        const wrongCardsBodyId = RETAKE_REPORT_MODAL_ID + '-wrongcards';
        const wrongCards = wrongItems.length
            ? wrongItems.map(function (item) { return renderWrongItemCard(item, cardOpts); }).join('')
            : '<div style="color:#047857; font-weight:800; padding:12px;">重考的題目全部訂正成功！</div>';
        // 這裡是塞進 onclick="...('safeAssign','safeTask')" 的 JS 字串常值，要跳單引號，不是 HTML escape
        const safeAssign = String(opts.assignmentId == null ? '' : opts.assignmentId).replace(/'/g, "\\'");
        const safeTask = String(opts.taskId == null ? '' : opts.taskId).replace(/'/g, "\\'");
        const hasAppealable = opts.allowAppeal && wrongItems.some(function (item) { return !appealsByItemId[String(item.item_id)]; });
        const appealSubmitHtml = hasAppealable
            ? ('<div style="display:flex; justify-content:flex-end; margin:6px 0 8px;">'
                + '<button type="button" class="btn btn-action" style="background:#7C3AED; color:white; border:none; padding:6px 12px; font-weight:800;" onclick="window.FeatureStudentQuiz.submitAppeals(\'' + safeAssign + '\',\'' + safeTask + '\',\'' + wrongCardsBodyId + '\',\'retake\')">📮 送出申訴</button>'
                + '</div>')
            : '';
        return (
            '<div style="max-width:760px; width:94vw; background:white; border-radius:14px; padding:18px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                    '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#B45309;">📊 ' + esc(title) + '・整體報告</h3>' +
                    '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="window.FeatureStudentQuiz.closeRetakeReport(true)">關閉</button>' +
                '</div>' +
                '<div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">' +
                    '<div style="flex:1 1 200px; padding:10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px;">' +
                        '<div style="font-size:0.75rem; color:#64748B; font-weight:800;">原始成績</div>' +
                        '<div style="font-size:1.3rem; font-weight:900; color:#334155;">' + esc(originalResult.correct) + ' / ' + esc(originalResult.total) + '（' + esc(originalResult.score) + '%）</div>' +
                    '</div>' +
                    '<div style="flex:1 1 200px; padding:10px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px;">' +
                        '<div style="font-size:0.75rem; color:#92400E; font-weight:800;">錯題重考訂正</div>' +
                        '<div style="font-size:1.3rem; font-weight:900; color:#92400E;">' + esc(fixedCount) + ' / ' + esc(totalRetake) + ' 題訂正成功</div>' +
                    '</div>' +
                    '<div style="flex:1 1 200px; padding:10px; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:8px;">' +
                        '<div style="font-size:0.75rem; color:#047857; font-weight:800;">訂正後合併正確率</div>' +
                        '<div style="font-size:1.3rem; font-weight:900; color:#047857;">' + esc(combined.correct) + ' / ' + esc(combined.total) + '（' + esc(combined.rate) + '%）</div>' +
                    '</div>' +
                '</div>' +
                (wrongItems.length ? '<div style="font-weight:900; color:#B91C1C; margin:10px 0 6px;">重考後仍錯的題目</div>' : '') +
                '<div id="' + wrongCardsBodyId + '" style="max-height:38vh; overflow:auto; margin-bottom:8px;">' + wrongCards + '</div>' +
                appealSubmitHtml +
                '<div style="display:flex; justify-content:flex-end; margin-top:12px;">' +
                    '<button type="button" class="btn btn-action" style="background:#0F766E; color:white; border:none; padding:8px 14px; font-weight:800;" onclick="window.FeatureStudentQuiz.closeRetakeReport(true)">知道了</button>' +
                '</div>' +
            '</div>'
        );
    }

    function openRetakeReportModal(assignmentId, taskId, originalResult, retake, appealsByItemId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        const title = String((task && task.title) || '線上考試').replace(/<[^>]*>?/gm, '');
        const allowAppeal = !!(task && task.raw_data && task.raw_data.allow_answer_appeal !== false);
        if (!window.ModalOverlay) return;
        window.ModalOverlay.open({
            id: RETAKE_REPORT_MODAL_ID,
            tier: 'A',
            contentHtml: buildRetakeReportHtml(title, originalResult, retake, {
                assignmentId: assignmentId,
                taskId: taskId,
                allowAppeal: allowAppeal,
                appealsByItemId: appealsByItemId || {}
            })
        });
    }

    async function openRetakeReportFromRaw(assignmentId, taskId) {
        // 跟 openReviewFromRaw 同理：老師端接受申訴／重新批閱是直接改資料庫，這裡開報告
        // 前也要先跟資料庫要一次最新資料，不要只信任 page load 時的舊快取。
        if (window.ModalOverlay) {
            window.ModalOverlay.open({
                id: RETAKE_REPORT_MODAL_ID,
                tier: 'A',
                contentHtml: '<div style="max-width:760px; width:94vw; background:white; border-radius:14px; padding:24px; text-align:center; color:#64748B; font-weight:700;">⏳ 讀取最新批改結果…</div>'
            });
        }
        await refreshCompletionFromDb(assignmentId, taskId);
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const retake = raw.quiz_retake;
        if (!retake || !retake.done) {
            if (window.ModalOverlay) window.ModalOverlay.close(RETAKE_REPORT_MODAL_ID);
            return window.showFlash('尚未完成錯題重考', 'warning');
        }
        openRetakeReportModal(assignmentId, taskId, raw.quiz_result || {}, retake, appealsByItemIdFromRaw(raw));
    }

    function closeRetakeReport(reload) {
        if (window.ModalOverlay) window.ModalOverlay.close(RETAKE_REPORT_MODAL_ID);
        if (reload) window.location.reload();
    }

    /**
     * 送出申訴（見「錯題申訴」規劃）：批次送出，勾了才送，不邊勾邊存。同一 item_id 若已經
     * 有申訴紀錄（不論 pending/accepted/rejected）就跳過，不重複加——申訴僅一次，要調整
     * 由老師端逐題編輯。source 只是決定送出後要重新渲染哪個畫面（review 或 retake 報告），
     * 不影響寫入的資料結構（quiz_appeals 是同一個扁平陣列，不分來源）。
     */
    async function submitAppeals(assignmentId, taskId, scopeBodyId, source) {
        const scopeEl = document.getElementById(scopeBodyId);
        if (!scopeEl) return window.showFlash('找不到申訴範圍，請重新整理再試', 'error');
        const checked = Array.prototype.slice.call(scopeEl.querySelectorAll('.quiz-appeal-checkbox:checked'));
        if (!checked.length) return window.showFlash('請先勾選要申訴的題目', 'warning');

        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const existing = Array.isArray(raw.quiz_appeals) ? raw.quiz_appeals.slice() : [];
        const existingIds = {};
        existing.forEach(function (a) { if (a && a.item_id != null) existingIds[String(a.item_id)] = true; });

        const appealedAt = new Date().toISOString();
        const newAppeals = [];
        checked.forEach(function (el) {
            const itemId = el.getAttribute('data-item-id');
            if (itemId == null || existingIds[String(itemId)]) return;
            newAppeals.push({
                item_id: itemId,
                seq: Number(el.getAttribute('data-seq')) || null,
                answer: el.getAttribute('data-answer') || '',
                expected: el.getAttribute('data-expected') || '',
                status: 'pending',
                appealed_at: appealedAt
            });
            existingIds[String(itemId)] = true;
        });
        if (!newAppeals.length) return window.showFlash('這些題目已經送出過申訴了', 'warning');

        const merged = existing.concat(newAppeals);
        try {
            await persistResult(assignmentId, taskId, { quiz_appeals: merged }, true);
            window.showFlash('已送出 ' + newAppeals.length + ' 筆申訴，等候老師/助教審核', 'success');
            const freshPrev = findCompletion(assignmentId, taskId);
            const freshRaw = (freshPrev && freshPrev.raw_data) ? freshPrev.raw_data : {};
            if (source === 'retake') {
                const retake = freshRaw.quiz_retake;
                if (retake && retake.done) {
                    openRetakeReportModal(assignmentId, taskId, freshRaw.quiz_result || {}, retake, appealsByItemIdFromRaw(freshRaw));
                }
            } else {
                openReviewFromRaw(assignmentId, taskId);
            }
        } catch (err) {
            console.error('[FeatureStudentQuiz] submitAppeals', err);
            window.showFlash('申訴送出失敗：' + (err.message || err), 'error');
        }
    }

    /**
     * ✍️ 輸入練習／🔧 輸入改正（2026-08-14 老師確認規格）：
     * - 輸入練習：整份考卷變成打字練習，答案本來就顯示（紅字），沒有另外的「一般作答」步驟，
     *   逐字比對＋逐字擋錯，連續打對指定次數才算完成該題；完成後答案消失、輸入框鎖住。
     * - 輸入改正：交卷批改後，針對「答錯」的題目做同樣的打字改正練習，跟重考錯題／申訴答案
     *   互相獨立（不共用資料，也不影響彼此的完成狀態）。
     * - 兩者共用逐字比對引擎（QuizPaperBuilder.attachStrictRetypeInput，含 IME 組字感知），
     *   共用同一套渲染／掛載邏輯（kind='practice'|'correction' 只影響 DOM id 前綴與資料來源）。
     * - 進度可續打：每打對一次就即時存進 task_completions.raw_data（input_practice_progress／
     *   input_correction_progress，形狀是 { [item_id]: { [part_key]: 已打對次數 } }），重開題目
     *   時從這裡還原，不會讓已經打對的次數歸零。
     */
    function getItemExpectedParts(it) {
        if (Array.isArray(it.sub_answers) && it.sub_answers.length > 1) {
            return it.sub_answers.map(function (sa, idx) {
                return { key: String(sa.key || ('sub' + idx)), expected: String(sa.answer_en || ''), label: sa.label || ('空格 ' + (idx + 1)) };
            });
        }
        return [{ key: '_single', expected: String(it.answer_en || ''), label: null }];
    }

    /**
     * 建立統一格式的練習題清單。kind='practice' 時 rawList 是 paper.items（完整題目，全部練習）；
     * kind='correction' 時 rawList 是 quiz_stats.wrong_items（壓縮後的錯題紀錄，只有合併後的單一
     * expected 字串——多空格分開比對的細節在批改當下已經合併，這裡不逐空格拆開，整段一起改正）。
     */
    function buildPracticeNormItems(kind, rawList) {
        return (rawList || []).map(function (src, idx) {
            if (kind === 'practice') {
                return {
                    item_id: String(src.item_id),
                    headline: formatItemHeadline(src, idx + 1),
                    prompt: src.prompt_zh || (src.cells && src.cells[1] && src.cells[1].text) || '',
                    parts: getItemExpectedParts(src)
                };
            }
            return {
                item_id: String(src.item_id),
                headline: src.headline || headlineFromWrongItem(src, idx + 1),
                prompt: src.prompt_zh || '',
                parts: [{ key: '_single', expected: String(src.expected || ''), label: null }]
            };
        });
    }

    function practiceProgressReps(progressMap, itemId, partKey) {
        return (progressMap[itemId] && progressMap[itemId][partKey]) || 0;
    }

    function summarizePracticeProgress(normItems, requiredCount, progressMap, difficultyMap, levelCounts) {
        let done = 0;
        normItems.forEach(function (it) {
            const need = requiredForPracticeItem(it.item_id, difficultyMap, levelCounts, requiredCount);
            const itemDone = it.parts.every(function (p) { return practiceProgressReps(progressMap, it.item_id, p.key) >= need; });
            if (itemDone) done += 1;
        });
        return { total: normItems.length, done: done, allDone: normItems.length > 0 && done === normItems.length };
    }

    function defaultPracticeLevelCounts(teacherDefault) {
        const easy = Math.max(1, Number(teacherDefault) || 1);
        return { easy: easy, mid: Math.max(easy, 3), hard: Math.max(easy, 5) };
    }

    function requiredForPracticeItem(itemId, difficultyMap, levelCounts, fallbackCount) {
        if (!difficultyMap) return Math.max(1, Number(fallbackCount) || 1);
        const lv = difficultyMap[itemId] || 'easy';
        const counts = levelCounts || {};
        return Math.max(1, Number(counts[lv]) || (lv === 'hard' ? 5 : (lv === 'mid' ? 3 : 1)));
    }

    function practiceLevelChipHtml(itemId, current, i) {
        return ['easy', 'mid', 'hard'].map(function (lv) {
            const label = lv === 'easy' ? '易' : (lv === 'mid' ? '中' : '難');
            const on = current === lv;
            return '<button type="button" class="btn pi-level-btn" data-item-id="' + esc(itemId) + '" data-level="' + lv + '" data-card="' + i + '" style="padding:2px 8px; font-size:0.72rem; border-radius:999px; '
                + (on ? 'background:#0F766E; color:white;' : 'background:#F1F5F9; color:#334155;') + '">' + label + '</button>';
        }).join('');
    }

    function renderPracticeSessionHtml(kind, normItems, requiredCount, progressMap, difficultyMap, levelCounts) {
        const useLevels = kind === 'practice' && difficultyMap;
        return normItems.map(function (it, i) {
            const need = useLevels
                ? requiredForPracticeItem(it.item_id, difficultyMap, levelCounts, requiredCount)
                : requiredCount;
            const partsHtml = it.parts.map(function (p, j) {
                const reps = practiceProgressReps(progressMap, it.item_id, p.key);
                const rowId = 'pi-row-' + kind + '-' + i + '-' + j;
                const labelHtml = p.label ? ('<div style="font-size:0.7rem; color:#64748B; font-weight:700;">' + esc(p.label) + '</div>') : '';
                // 💣 老師要求（2026-08-14）：完成後紅字答案不要消失——完成只是拿掉輸入框，
                // 答案本身仍留著給學生對照，不要整段被「✅ 已完成」取代掉。
                if (reps >= need) {
                    return '<div id="' + rowId + '" style="margin-top:6px;">' + labelHtml
                        + '<div style="color:#DC2626; font-weight:900; font-size:1em; white-space:pre-wrap; margin-bottom:4px;">' + esc(p.expected) + '</div>'
                        + '<div style="color:#047857; font-weight:800; font-size:0.85rem;">✅ 已完成（' + need + '/' + need + ' 次）</div></div>';
                }
                return (
                    '<div id="' + rowId + '" style="margin-top:6px;">' + labelHtml +
                        '<div id="pi-answer-' + kind + '-' + i + '-' + j + '" style="color:#DC2626; font-weight:900; font-size:1em; white-space:pre-wrap; margin-bottom:4px;">' + esc(p.expected) + '</div>' +
                        '<input id="pi-input-' + kind + '-' + i + '-' + j + '" class="quiz-answer-input" type="text" lang="en" inputmode="text" ' +
                            'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
                            'data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" data-lt-active="false" ' +
                            'placeholder="請照打上方紅字答案" ' +
                            'style="width:100%; padding:8px 10px; border:1px solid #CBD5E1; border-radius:8px; font-size:0.95rem;">' +
                        '<div id="pi-counter-' + kind + '-' + i + '-' + j + '" style="font-size:0.72rem; color:#94A3B8; font-weight:700; margin-top:2px;">第 ' + (reps + 1) + '/' + need + ' 次</div>' +
                    '</div>'
                );
            }).join('');
            const allDone = it.parts.every(function (p) { return practiceProgressReps(progressMap, it.item_id, p.key) >= need; });
            const levelHtml = useLevels
                ? '<div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">' + practiceLevelChipHtml(it.item_id, difficultyMap[it.item_id] || 'easy', i) + '</div>'
                : '';
            return (
                '<div id="pi-card-' + kind + '-' + i + '" style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:10px; background:' + (allDone ? '#F0FDF4' : '#F8FAFC') + ';">' +
                    '<div id="pi-head-' + kind + '-' + i + '" style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">' +
                        '<div style="font-size:0.85rem; color:#0F766E; font-weight:900;">' + esc(it.headline) + '</div>' +
                        levelHtml +
                        (allDone ? '<span class="pi-done-badge" style="font-size:0.75rem; color:#047857; font-weight:900;">✅ 完成</span>' : '') +
                    '</div>' +
                    '<div style="font-size:1rem; font-weight:800; color:#1E293B; white-space:pre-wrap; margin:4px 0;">' + esc(it.prompt) + '</div>' +
                    partsHtml +
                '</div>'
            );
        }).join('');
    }

    /**
     * 游標自動跳下一欄位（2026-08-14 老師要求）：某個空格打對達到指定次數（該欄位不用再打）後，
     * 自動把焦點移到「目前這個空格之後、還沒完成的下一個輸入框」——可能是同一題的下一個
     * sub_answer 空格，也可能是下一題的第一個空格；找不到（代表全部都完成了）就不做事。
     */
    function focusNextPracticeInput(kind, normItems, requiredCount, progressMap, fromI, fromJ, difficultyMap, levelCounts) {
        for (let i = fromI; i < normItems.length; i++) {
            const it = normItems[i];
            const need = requiredForPracticeItem(it.item_id, difficultyMap, levelCounts, requiredCount);
            const startJ = (i === fromI) ? fromJ + 1 : 0;
            for (let j = startJ; j < it.parts.length; j++) {
                if (practiceProgressReps(progressMap, it.item_id, it.parts[j].key) >= need) continue;
                const nextInput = document.getElementById('pi-input-' + kind + '-' + i + '-' + j);
                if (nextInput) {
                    nextInput.focus();
                    return true;
                }
            }
        }
        return false;
    }

    /** 掛上逐字比對引擎；已完成的空格不掛（避免完成後還被誤觸發）。回傳 detachAll()。 */
    function wirePracticeSession(kind, normItems, requiredCount, progressMap, onProgress, onAllDone, difficultyMap, levelCounts) {
        const detachers = [];
        normItems.forEach(function (it, i) {
            it.parts.forEach(function (p, j) {
                const need0 = requiredForPracticeItem(it.item_id, difficultyMap, levelCounts, requiredCount);
                if (practiceProgressReps(progressMap, it.item_id, p.key) >= need0) return;
                const inputEl = document.getElementById('pi-input-' + kind + '-' + i + '-' + j);
                if (!inputEl || !window.QuizPaperBuilder || typeof window.QuizPaperBuilder.attachStrictRetypeInput !== 'function') return;
                const handle = window.QuizPaperBuilder.attachStrictRetypeInput(inputEl, p.expected, function () {
                    if (!progressMap[it.item_id]) progressMap[it.item_id] = {};
                    const nowReps = (progressMap[it.item_id][p.key] || 0) + 1;
                    progressMap[it.item_id][p.key] = nowReps;
                    const need = requiredForPracticeItem(it.item_id, difficultyMap, levelCounts, requiredCount);
                    if (typeof onProgress === 'function') onProgress(progressMap);
                    if (nowReps >= need) {
                        const rowEl = document.getElementById('pi-row-' + kind + '-' + i + '-' + j);
                        if (rowEl) {
                            const labelHtml = p.label ? ('<div style="font-size:0.7rem; color:#64748B; font-weight:700;">' + esc(p.label) + '</div>') : '';
                            // 紅字答案不要消失，只是拿掉輸入框（見上方 renderPracticeSessionHtml 同一份規則）
                            rowEl.innerHTML = labelHtml
                                + '<div style="color:#DC2626; font-weight:900; font-size:1em; white-space:pre-wrap; margin-bottom:4px;">' + esc(p.expected) + '</div>'
                                + '<div style="color:#047857; font-weight:800; font-size:0.85rem;">✅ 已完成（' + need + '/' + need + ' 次）</div>';
                        }
                        handle.detach();
                        // 這個欄位不用再打了，游標自動移到下一個還沒完成的欄位，不用學生自己去點
                        focusNextPracticeInput(kind, normItems, requiredCount, progressMap, i, j, difficultyMap, levelCounts);
                        const itemAllDone = it.parts.every(function (pp) { return practiceProgressReps(progressMap, it.item_id, pp.key) >= need; });
                        if (itemAllDone) {
                            const cardEl = document.getElementById('pi-card-' + kind + '-' + i);
                            const headEl = document.getElementById('pi-head-' + kind + '-' + i);
                            if (cardEl) cardEl.style.background = '#F0FDF4';
                            if (headEl && !headEl.querySelector('.pi-done-badge')) {
                                const span = document.createElement('span');
                                span.className = 'pi-done-badge';
                                span.style.fontSize = '0.75rem';
                                span.style.color = '#047857';
                                span.style.fontWeight = '900';
                                span.textContent = '✅ 完成';
                                headEl.appendChild(span);
                            }
                        }
                        const allSessionDone = normItems.every(function (oit) {
                            const oNeed = requiredForPracticeItem(oit.item_id, difficultyMap, levelCounts, requiredCount);
                            return oit.parts.every(function (pp) { return practiceProgressReps(progressMap, oit.item_id, pp.key) >= oNeed; });
                        });
                        if (allSessionDone && typeof onAllDone === 'function') onAllDone();
                    } else {
                        inputEl.value = '';
                        const counterEl = document.getElementById('pi-counter-' + kind + '-' + i + '-' + j);
                        if (counterEl) counterEl.textContent = '第 ' + (nowReps + 1) + '/' + need + ' 次';
                    }
                });
                detachers.push(handle.detach);
            });
        });
        return function detachAll() { detachers.forEach(function (fn) { fn(); }); };
    }

    function practiceLevelCountsBarHtml(levelCounts) {
        return '<div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:10px; font-size:0.8rem; font-weight:800; color:#334155;">'
            + '<span>各難度次數</span>'
            + '<label>易 <input id="pi-count-easy" type="number" min="1" value="' + esc(levelCounts.easy) + '" style="width:52px; padding:2px 4px;"></label>'
            + '<label>中 <input id="pi-count-mid" type="number" min="1" value="' + esc(levelCounts.mid) + '" style="width:52px; padding:2px 4px;"></label>'
            + '<label>難 <input id="pi-count-hard" type="number" min="1" value="' + esc(levelCounts.hard) + '" style="width:52px; padding:2px 4px;"></label>'
            + '</div>';
    }

    function mountPracticeModal(opts) {
        const modalId = opts.modalId;
        const kind = opts.kind || 'practice';
        const normItems = opts.normItems;
        const requiredCount = opts.requiredCount;
        const progressMap = opts.progressMap;
        const difficultyMap = opts.difficultyMap || {};
        const levelCounts = opts.levelCounts || defaultPracticeLevelCounts(requiredCount);
        let detachAll = null;

        function persistMeta(done) {
            if (typeof opts.persist !== 'function') return Promise.resolve();
            return opts.persist(done ? { input_practice_done: true } : {}, !!done);
        }

        function remountBody() {
            if (detachAll) { detachAll(); detachAll = null; }
            const body = document.getElementById(modalId + '-body');
            if (body) body.innerHTML = renderPracticeSessionHtml(kind, normItems, requiredCount, progressMap, difficultyMap, levelCounts);
            bindLevelChips();
            detachAll = wirePracticeSession(kind, normItems, requiredCount, progressMap, function () {
                persistMeta(false).catch(function (err) {
                    console.warn('[FeatureStudentQuiz] practice persist', err);
                });
            }, function () {
                persistMeta(true).then(function () {
                    window.showFlash('🎉 輸入練習全部完成！', 'success');
                }).catch(function (err) {
                    console.warn('[FeatureStudentQuiz] practice done', err);
                });
            }, difficultyMap, levelCounts);
            focusNextPracticeInput(kind, normItems, requiredCount, progressMap, 0, -1, difficultyMap, levelCounts);
        }

        function bindLevelChips() {
            document.querySelectorAll('#' + modalId + ' .pi-level-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const itemId = btn.getAttribute('data-item-id');
                    difficultyMap[itemId] = btn.getAttribute('data-level') || 'easy';
                    persistMeta(false).catch(function () {});
                    remountBody();
                });
            });
        }

        function bindCountInputs() {
            ['easy', 'mid', 'hard'].forEach(function (lv) {
                const el = document.getElementById('pi-count-' + lv);
                if (!el) return;
                el.addEventListener('change', function () {
                    levelCounts[lv] = Math.max(1, parseInt(el.value, 10) || 1);
                    persistMeta(false).catch(function () {});
                    remountBody();
                });
            });
        }

        window.ModalOverlay.open({
            id: modalId,
            tier: 'B',
            isDirty: function () { return false; },
            onClose: function () { if (detachAll) { detachAll(); detachAll = null; } },
            onMount: function () {
                remountBody();
                bindCountInputs();
            },
            contentHtml:
                '<div style="max-width:720px; width:92vw; max-height:90vh; display:flex; flex-direction:column; background:white; border-radius:14px; padding:18px 18px 14px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">✍️ 輸入練習・' + esc(opts.title || '') + '</h3>' +
                        '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'' + modalId + '\')">暫存並離開</button>' +
                    '</div>' +
                    '<div style="font-size:0.8rem; color:#64748B; margin-bottom:10px;">上方紅字是答案，請照打（不能改答案）。打錯會被擋住並發出提示音。每個字可自設易／中／難，次數依難度。可按「暫存並離開」，下次從中斷處繼續。</div>' +
                    practiceLevelCountsBarHtml(levelCounts) +
                    '<div id="' + modalId + '-body" style="overflow:auto; flex:1;"></div>' +
                '</div>'
        });
    }

    function openInputPractice(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        if (!task.raw_data || !task.raw_data.input_practice_enabled) return window.showFlash('這份考卷沒有開啟輸入練習', 'warning');
        const paper = getPaper(task);
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return window.showFlash('老師尚未產生線上卷（請先按「產生線上卷」並儲存作業）', 'warning');
        }
        if (!window.QuizPaperBuilder) return window.showFlash('作答模組未載入', 'error');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return window.showFlash('ModalOverlay 未載入', 'error');

        const requiredCount = Math.max(1, Number(task.raw_data.input_practice_count) || 1);
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const progressMap = JSON.parse(JSON.stringify(raw.input_practice_progress || {}));
        const difficultyMap = JSON.parse(JSON.stringify(raw.input_practice_difficulty || {}));
        const levelCounts = Object.assign(defaultPracticeLevelCounts(requiredCount), raw.input_practice_level_counts || {});
        const normItems = buildPracticeNormItems('practice', paper.items);
        const title = String(task.title || task.raw_data.exam_title || '線上考試').replace(/<[^>]*>?/gm, '');

        mountPracticeModal({
            modalId: INPUT_PRACTICE_MODAL_ID,
            title: title,
            kind: 'practice',
            normItems: normItems,
            requiredCount: requiredCount,
            progressMap: progressMap,
            difficultyMap: difficultyMap,
            levelCounts: levelCounts,
            persist: function (extra, done) {
                return persistResult(assignmentId, taskId, Object.assign({
                    input_practice_progress: progressMap,
                    input_practice_difficulty: difficultyMap,
                    input_practice_level_counts: levelCounts
                }, extra || {}), !!done);
            }
        });
    }

    function openInputCorrection(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        if (!task.raw_data || !task.raw_data.input_correction_enabled) return window.showFlash('這份考卷沒有開啟輸入改正', 'warning');
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const stats = readStats(raw);
        const wrongItems = stats.wrong_items || [];
        if (!wrongItems.length) return window.showFlash('目前沒有錯題可以改正', 'warning');
        if (!window.QuizPaperBuilder) return window.showFlash('作答模組未載入', 'error');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return window.showFlash('ModalOverlay 未載入', 'error');

        const requiredCount = Math.max(1, Number(task.raw_data.input_correction_count) || 1);
        const progressMap = JSON.parse(JSON.stringify(raw.input_correction_progress || {}));
        const normItems = buildPracticeNormItems('correction', wrongItems);
        const title = String(task.title || task.raw_data.exam_title || '線上考試').replace(/<[^>]*>?/gm, '');

        let detachAll = null;
        window.ModalOverlay.open({
            id: INPUT_CORRECTION_MODAL_ID,
            tier: 'B',
            isDirty: function () { return false; },
            onClose: function () { if (detachAll) { detachAll(); detachAll = null; } },
            onMount: function () {
                detachAll = wirePracticeSession('correction', normItems, requiredCount, progressMap, function (pm) {
                    persistResult(assignmentId, taskId, { input_correction_progress: pm }, true).catch(function (err) {
                        console.warn('[FeatureStudentQuiz] persist input_correction_progress', err);
                    });
                }, function () {
                    persistResult(assignmentId, taskId, { input_correction_progress: progressMap, input_correction_done: true }, true).then(function () {
                        window.showFlash('🎉 錯題改正練習全部完成！', 'success');
                    }).catch(function (err) {
                        console.warn('[FeatureStudentQuiz] persist input_correction_done', err);
                    });
                });
                focusNextPracticeInput('correction', normItems, requiredCount, progressMap, 0, -1);
            },
            contentHtml:
                '<div style="max-width:720px; width:92vw; max-height:90vh; display:flex; flex-direction:column; background:white; border-radius:14px; padding:18px 18px 14px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#B45309;">🔧 錯題改正練習・' + esc(title) + '</h3>' +
                        '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'' + INPUT_CORRECTION_MODAL_ID + '\')">關閉</button>' +
                    '</div>' +
                    '<div style="font-size:0.8rem; color:#64748B; margin-bottom:10px;">正確答案已直接顯示在上方（紅字），請照打；打錯會被立刻擋下，需連續打對 '
                        + requiredCount + ' 次才算完成該題改正。可隨時關閉，進度自動儲存。</div>' +
                    '<div style="overflow:auto; flex:1;">' + renderPracticeSessionHtml('correction', normItems, requiredCount, progressMap) + '</div>' +
                '</div>'
        });
    }

    function getInputPracticeSummary(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task || !task.raw_data || !task.raw_data.input_practice_enabled) return null;
        const paper = getPaper(task);
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) return { total: 0, done: 0, allDone: false, requiredCount: 1 };
        const requiredCount = Math.max(1, Number(task.raw_data.input_practice_count) || 1);
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const normItems = buildPracticeNormItems('practice', paper.items);
        const summary = summarizePracticeProgress(
            normItems,
            requiredCount,
            raw.input_practice_progress || {},
            raw.input_practice_difficulty || {},
            Object.assign(defaultPracticeLevelCounts(requiredCount), raw.input_practice_level_counts || {})
        );
        summary.requiredCount = requiredCount;
        return summary;
    }

    function getInputCorrectionSummary(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task || !task.raw_data || !task.raw_data.input_correction_enabled) return null;
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const stats = readStats(raw);
        const wrongItems = stats.wrong_items || [];
        const requiredCount = Math.max(1, Number(task.raw_data.input_correction_count) || 1);
        if (!wrongItems.length) return { total: 0, done: 0, allDone: true, requiredCount: requiredCount, noWrong: true };
        const normItems = buildPracticeNormItems('correction', wrongItems);
        const summary = summarizePracticeProgress(normItems, requiredCount, raw.input_correction_progress || {});
        summary.requiredCount = requiredCount;
        return summary;
    }

    /**
     * 複習專區練習：不綁 assignment_id，進度回呼 onPersist(progressMap, allDone)。
     */
    function openStandalonePractice(opts) {
        const paper = opts && opts.paper;
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return window.showFlash('沒有題目可以練習', 'warning');
        }
        if (!window.QuizPaperBuilder) return window.showFlash('作答模組未載入', 'error');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') {
            return window.showFlash('ModalOverlay 未載入', 'error');
        }
        const requiredCount = Math.max(1, Number(opts.requiredCount) || 1);
        const rawProgress = JSON.parse(JSON.stringify((opts.progressMap) || {}));
        const savedMeta = rawProgress.__meta && typeof rawProgress.__meta === 'object' ? rawProgress.__meta : {};
        delete rawProgress.__meta;
        const progressMap = rawProgress;
        const difficultyMap = JSON.parse(JSON.stringify(opts.difficultyMap || savedMeta.difficulty || {}));
        const levelCounts = Object.assign(defaultPracticeLevelCounts(requiredCount), opts.levelCounts || savedMeta.level_counts || {});
        const normItems = buildPracticeNormItems('practice', paper.items);
        mountPracticeModal({
            modalId: INPUT_PRACTICE_MODAL_ID,
            title: String((opts && opts.title) || '複習練習').replace(/<[^>]*>?/gm, ''),
            kind: 'practice',
            normItems: normItems,
            requiredCount: requiredCount,
            progressMap: progressMap,
            difficultyMap: difficultyMap,
            levelCounts: levelCounts,
            persist: function (_extra, done) {
                if (typeof opts.onPersist !== 'function') return Promise.resolve();
                const packed = Object.assign({}, progressMap, {
                    __meta: { difficulty: difficultyMap, level_counts: levelCounts }
                });
                return opts.onPersist(packed, !!done);
            }
        });
    }

    /**
     * 複習專區測試：不綁 assignment_id，不走全螢幕防作弊；交卷回呼 onSubmit(answers, result)。
     */
    function openStandaloneQuiz(opts) {
        const paper = opts && opts.paper;
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return window.showFlash('沒有題目可以測試', 'warning');
        }
        if (!window.QuizPaperBuilder) return window.showFlash('評分模組未載入', 'error');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') {
            return window.showFlash('ModalOverlay 未載入', 'error');
        }
        const title = String((opts && opts.title) || '複習測試').replace(/<[^>]*>?/gm, '');
        const bodyId = 'student-review-test-body';
        const itemsHtml = paper.items.map(function (it, idx) {
            return renderItemRow(it, undefined, idx + 1);
        }).join('');
        window.ModalOverlay.open({
            id: 'student-review-test',
            tier: 'B',
            isDirty: function () { return true; },
            unsavedMessage: '作答尚未繳交，確定要關閉？',
            onMount: function (overlay) { hardenAnswerInputs(overlay); },
            contentHtml:
                '<div style="max-width:720px; width:92vw; max-height:90vh; display:flex; flex-direction:column; background:white; border-radius:14px; padding:18px 18px 14px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#EA580C;">📝 ' + esc(title) + '</h3>' +
                        '<button type="button" class="btn btn-close" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'student-review-test\')">關閉</button>' +
                    '</div>' +
                    '<div style="font-size:0.8rem; color:#64748B; margin-bottom:10px;">共 ' + paper.items.length + ' 題 · 交卷後會顯示正確率（不進課程進度作業格）</div>' +
                    '<div id="' + bodyId + '" style="overflow:auto; flex:1;">' + itemsHtml + '</div>' +
                    '<div style="display:flex; justify-content:flex-end; margin-top:12px;">' +
                        '<button type="button" class="btn" id="student-review-test-submit" style="background:#EA580C; color:white; border:none; padding:8px 14px; font-weight:800;">繳交並看分數</button>' +
                    '</div>' +
                '</div>'
        });
        const btn = document.getElementById('student-review-test-submit');
        if (btn) {
            btn.addEventListener('click', function () {
                const answers = collectAnswers(bodyId);
                const graded = window.QuizPaperBuilder.gradeAnswers(paper, answers);
                const result = {
                    score: graded && graded.score != null ? graded.score : 0,
                    correct: graded && graded.correct != null ? graded.correct : 0,
                    total: graded && graded.total != null ? graded.total : paper.items.length,
                    details: graded && graded.details ? graded.details : []
                };
                const done = (typeof opts.onSubmit === 'function')
                    ? opts.onSubmit(answers, result)
                    : Promise.resolve();
                Promise.resolve(done).then(function () {
                    window.ModalOverlay.close('student-review-test');
                    const color = result.score >= 80 ? '#10B981' : (result.score >= 50 ? '#F59E0B' : '#EF4444');
                    window.ModalOverlay.open({
                        id: 'student-review-test-result',
                        tier: 'A',
                        contentHtml:
                            '<div style="background:white; padding:24px; border-radius:14px; max-width:420px; width:90vw; text-align:center;">'
                            + '<h3 style="margin:0 0 8px; color:#9A3412;">測試結果</h3>'
                            + '<div style="font-size:2rem; font-weight:900; color:' + color + ';">' + esc(String(result.score)) + '%</div>'
                            + '<div style="color:#64748B; font-weight:700; margin:8px 0 16px;">' + result.correct + ' / ' + result.total + ' 題正確</div>'
                            + '<button type="button" class="btn" style="background:#EA580C; color:white; border:none; padding:8px 16px; font-weight:800;" onclick="window.ModalOverlay.close(\'student-review-test-result\')">關閉</button>'
                            + '</div>'
                    });
                }).catch(function (err) {
                    window.showFlash('繳交失敗：' + (err && err.message ? err.message : err), 'error');
                });
            });
        }
    }

    return {
        openQuiz: openQuiz,
        submit: submit,
        requestCloseQuiz: requestCloseQuiz,
        closeReview: closeReview,
        openReviewFromRaw: openReviewFromRaw,
        startRetakeFromReview: startRetakeFromReview,
        openRetakeQuiz: openRetakeQuiz,
        submitRetake: submitRetake,
        openRetakeReportFromRaw: openRetakeReportFromRaw,
        closeRetakeReport: closeRetakeReport,
        submitAppeals: submitAppeals,
        openInputPractice: openInputPractice,
        openStandalonePractice: openStandalonePractice,
        openStandaloneQuiz: openStandaloneQuiz,
        openInputCorrection: openInputCorrection,
        getInputPracticeSummary: getInputPracticeSummary,
        getInputCorrectionSummary: getInputCorrectionSummary,
        getLeaveStats: function () {
            return { leave_count: leaveCount, leave_log: leaveLog.slice() };
        },
        formatStatsSummaryHtml: formatStatsSummaryHtml,
        readStats: readStats
    };
})();

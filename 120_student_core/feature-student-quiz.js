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

    function headlineFromWrongItem(d) {
        const seq = d && d.seq != null ? String(d.seq) : '';
        const src = (d && d.source) || {};
        const sheet = String(src.sheet_id || '').trim().toUpperCase();
        const page = src.page != null && src.page !== '' ? String(src.page) : '';
        const itemNo = src.item_no != null && src.item_no !== '' ? String(src.item_no) : '';
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

    function ensureItemDiff(item) {
        if (item && item.diff && Array.isArray(item.diff.ops)) return item;
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.analyzeAnswerDiff === 'function') {
            const diff = window.QuizPaperBuilder.analyzeAnswerDiff(item.expected || '', item.answer || '');
            item.diff = diff;
            item.spelling_pairs = diff.spelling_pairs || [];
        }
        return item;
    }

    function renderWrongItemCard(item) {
        ensureItemDiff(item);
        const headline = item.headline || headlineFromWrongItem(item);
        const ops = (item.diff && item.diff.ops) || item.ops || [];
        const pairs = (item.diff && item.diff.spelling_pairs) || item.spelling_pairs || [];
        return (
            '<div style="border:1px solid #FECACA; border-radius:10px; padding:12px; margin-bottom:10px; background:#FFF7F7;">' +
                '<div style="font-size:0.85rem; color:#B91C1C; font-weight:900; margin-bottom:4px;">' + esc(headline) + '</div>' +
                '<div style="font-size:0.92rem; font-weight:800; color:#1E293B; margin-bottom:8px; white-space:pre-wrap;">' + esc(item.prompt_zh || '') + '</div>' +
                '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:2px;">你的答案</div>' +
                '<div style="font-size:1rem; line-height:1.7; margin-bottom:6px;">' + renderStudentStrikeHtml(ops) + '</div>' +
                '<div style="font-size:0.75rem; color:#047857; font-weight:800; margin-bottom:2px;">正確答案</div>' +
                '<div style="font-size:1rem; font-weight:800; color:#047857; line-height:1.7; white-space:pre-wrap;">' + esc(item.expected || '') + '</div>' +
                renderSpellingPairsHtml(pairs) +
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
        const spellN = Object.keys(st.spelling_ledger || {}).length;
        if (spellN > 0) parts.push('歷史錯字 ' + spellN + ' 組');
        return '<div style="font-size:0.78rem; font-weight:800; color:#334155; line-height:1.45;">'
            + esc(parts.join(' · '))
            + '</div>';
    }

    function buildReviewHtml(title, result, stats, opts) {
        opts = opts || {};
        const wrongItems = stats.wrong_items || [];
        const wrongCards = wrongItems.length
            ? wrongItems.map(renderWrongItemCard).join('')
            : '<div style="color:#047857; font-weight:800; padding:12px;">本次全對，沒有錯題。</div>';
        const ledgerHtml = renderSpellingLedgerHtml(stats.spelling_ledger);
        const closeAction = opts.reloadOnClose
            ? "window.FeatureStudentQuiz.closeReview(true)"
            : "window.FeatureStudentQuiz.closeReview(false)";
        return (
            '<div style="max-width:760px; width:94vw; background:white; border-radius:14px; padding:18px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                    '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📋 ' + esc(title) + '</h3>' +
                    '<button type="button" class="btn" style="padding:4px 10px;" onclick="' + closeAction + '">關閉</button>' +
                '</div>' +
                '<div style="margin-bottom:12px; padding:10px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-weight:800; color:#134E4A; font-size:0.88rem;">'
                    + '得分 ' + esc(result.correct) + ' / ' + esc(result.total) + '（' + esc(result.score) + '%）'
                    + ' · 已作答過 ' + esc(stats.complete_count) + ' 次'
                    + ' · 中途退出 ' + esc(stats.quit_count) + ' 次'
                    + ' · 嘗試離開累計 ' + esc(stats.leave_count_total) + ' 次'
                + '</div>' +
                '<div style="font-weight:900; color:#B91C1C; margin:10px 0 6px;">① 錯題本（本次）</div>' +
                '<div style="max-height:32vh; overflow:auto; margin-bottom:12px;">' + wrongCards + '</div>' +
                '<div style="font-weight:900; color:#0F766E; margin:10px 0 6px;">④ 歷史錯字紀錄（應打 → 曾寫成）</div>' +
                '<div style="max-height:22vh; overflow:auto; border:1px solid #E2E8F0; border-radius:8px; padding:8px 12px;">'
                    + ledgerHtml + '</div>' +
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

    function openReviewFromRaw(assignmentId, taskId) {
        const prev = findCompletion(assignmentId, taskId);
        const raw = (prev && prev.raw_data) ? prev.raw_data : {};
        const stats = readStats(raw);
        const qr = raw.quiz_result || {};
        const result = {
            correct: qr.correct != null ? qr.correct : '—',
            total: qr.total != null ? qr.total : '—',
            score: qr.score != null ? qr.score : '—'
        };
        if (!window.ModalOverlay) return;
        window.ModalOverlay.open({
            id: REVIEW_MODAL_ID,
            tier: 'A',
            contentHtml: buildReviewHtml('作答檢討與錯字紀錄', result, stats, { reloadOnClose: false })
        });
    }

    function formatItemHeadline(it) {
        const seq = it && it.seq != null ? String(it.seq) : '';
        const src = (it && it.source) || {};
        const sheet = String(src.sheet_id || '').trim().toUpperCase();
        const page = src.page != null && src.page !== '' ? String(src.page) : '';
        const itemNo = src.item_no != null && src.item_no !== '' ? String(src.item_no) : '';
        let meta = '';
        if (sheet && page && itemNo) meta = sheet + ' - ' + page + ' - ' + itemNo;
        else if (sheet && itemNo) meta = sheet + ' - ' + itemNo;
        else {
            const stack = (it.cells && it.cells[0] && it.cells[0].text) || '';
            const parts = String(stack).split(/\s+/).map(function (p) {
                return String(p || '').trim();
            }).filter(Boolean);
            if (parts.length >= 3) meta = parts[0] + ' - ' + parts[1] + ' - ' + parts[2];
            else if (parts.length) meta = parts.join(' - ');
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

    function renderItemRow(it, prevAnswer) {
        const prompt = it.prompt_zh || (it.cells && it.cells[1] && it.cells[1].text) || '';
        const fontDelta = (it.cells && it.cells[1] && it.cells[1].fontDelta) || 0;
        const fontSize = Math.max(0.75, 1 + (fontDelta * 0.08));
        const headline = formatItemHeadline(it);
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

    function collectAnswers() {
        const map = {};
        document.querySelectorAll('#' + MODAL_ID + '-body .quiz-sub-answer-input').forEach(function (el) {
            const id = el.getAttribute('data-item-id');
            const key = el.getAttribute('data-sub-key');
            if (!id || !key) return;
            if (!map[id] || typeof map[id] !== 'object') map[id] = {};
            map[id][key] = el.value;
        });
        document.querySelectorAll('#' + MODAL_ID + '-body .quiz-answer-input:not(.quiz-sub-answer-input)').forEach(function (el) {
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

        let prevAnswers = {};
        if (prevRaw.quiz_answers) prevAnswers = prevRaw.quiz_answers;

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

        const itemsHtml = paper.items.map(function (it) {
            return renderItemRow(it, prevAnswers[it.item_id]);
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
                            '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeatureStudentQuiz.requestCloseQuiz()">關閉</button>' +
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
        stats.wrong_items = (result.wrong_items || []).map(function (d) {
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
            item.headline = headlineFromWrongItem(item);
            return item;
        });
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
                contentHtml: buildReviewHtml('繳交結果・錯題與錯字', result, stats, { reloadOnClose: true })
            });
        } catch (err) {
            sessionSubmitted = false;
            sessionQuitSaved = false;
            console.error('[FeatureStudentQuiz] submit', err);
            window.showFlash('繳交失敗：' + (err.message || err), 'error');
        }
    }

    return {
        openQuiz: openQuiz,
        submit: submit,
        requestCloseQuiz: requestCloseQuiz,
        closeReview: closeReview,
        openReviewFromRaw: openReviewFromRaw,
        getLeaveStats: function () {
            return { leave_count: leaveCount, leave_log: leaveLog.slice() };
        },
        formatStatsSummaryHtml: formatStatsSummaryHtml,
        readStats: readStats
    };
})();

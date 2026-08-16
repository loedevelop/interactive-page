/**
 * 📂 120_student_core/feature-student-pdf-quiz.js
 * 🆕 PDF 考卷（task.type === 'pdf_exam'）學生端：跟現有 feature-student-quiz.js（meta 出題的線上考試）
 * 完全獨立，這裡不做全螢幕防作弊／離開次數統計／重考錯題／申訴等進階機制（MVP 範圍）。
 *
 * 💣 空格在 PDF 上的位置不是老師畫的、也不是程式用電腦視覺猜的（實測對掃描稿常常誤判，見討論
 * 記錄）——改成**由學生作答時自己依「答案清單的順序」逐一點出作答位置**：
 * - 一大題（section）一個畫面，該大題橫跨的每一頁 PDF 都會顯示出來，學生自己找到底線／空格，
 *   點一下就會長出一個小輸入框讓他打字，不用逐題彈窗提示「請點第幾題」。
 * - 「文字匡建立的順序」＝跟答案清單（老師貼的解答文字，已依大題內題號由小到大排好——見
 *   020_js_core/pdf-exam-paper.js 的 parseAnswerText 排序說明）逐一配對的依據，不是座標。
 *   陣列 push 的順序本身就等於時間先後，不用額外記時間戳記。
 * - 即使有題不會寫，也必須點出一個（可以留空的）作答框佔位，否則後面全部題目對位會錯掉——
 *   畫面上會擋著不給送出/換大題，直到這一大題的作答框數量跟題數一致。
 *
 * 💣 批改時機＝**每大題各自提交**，不是等整份考卷都寫完才一次送出：這一大題的作答框都點滿了，
 * 按「提交這一大題並批改」就立刻批改、鎖定這一大題（不能再改），並馬上顯示這一大題的對錯格數／
 * 百分比（不顯示正確答案）。要換下一大題前必須先提交目前這大題。最後一大題提交完，才彈出整份
 * 考卷的總結。
 * - 每提交一大題都會即時存檔（含 pdf_quiz_boxes_by_section／pdf_quiz_section_results），老師端
 *   可以看到部分完成度，不用等整份交完才有資料。
 * - 中途關閉視窗、之後重新打開：若上次「還在作答中」（沒交完），會自動接續已批改的大題，從第一個
 *   還沒批改的大題繼續；若上次已經整份交完，重新打開＝重新開始全新一份作答（不影響已存檔的舊成績，
 *   最後交卷時才會整份覆蓋）。
 */
window.FeatureStudentPdfQuiz = (function () {
    'use strict';

    var MODAL_ID = 'student-pdf-quiz';
    var RESULT_MODAL_ID = 'student-pdf-quiz-result';
    var CLICK_MERGE_THRESHOLD_PCT = 2.2; // 點擊離既有作答框多近，視為「點到同一個框」去聚焦而不是新增
    var DEFAULT_FONT_PX = 14;
    var MIN_FONT_PX = 10;
    var MAX_FONT_PX = 28;
    var MIN_INPUT_WIDTH_PX = 44;
    var INPUT_WIDTH_PADDING_PX = 14; // 量出來的文字寬度再加一點緩衝，避免游標貼邊

    var _quizState = null;
    var _drag = null; // 拖曳中的作答框狀態：{ boxId, pageBlockEl, boxEl }
    var _measureCanvas = document.createElement('canvas');
    var _measureCtx = _measureCanvas.getContext('2d');

    function _fontFamilyForMeasure() {
        return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    }

    function _measureTextWidthPx(text, fontPx) {
        _measureCtx.font = fontPx + 'px ' + _fontFamilyForMeasure();
        return _measureCtx.measureText(String(text || '')).width;
    }

    /** 文字匡寬度隨輸入內容自動變長（不夠寬會被游標擋住，太寬又佔畫面，量文字寬度剛好） */
    function _autoSizeInput(inputEl) {
        if (!inputEl) return;
        var fontPx = (_quizState && _quizState.fontSizePx) || DEFAULT_FONT_PX;
        var w = _measureTextWidthPx(inputEl.value || '', fontPx) + INPUT_WIDTH_PADDING_PX;
        inputEl.style.width = Math.max(MIN_INPUT_WIDTH_PX, w) + 'px';
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
    }

    function isAssignmentId(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return false;
        if (isUuid(s)) return true;
        return /^\d+$/.test(s);
    }

    function walkFindTask(tasks, taskId) {
        var found = null;
        (tasks || []).forEach(function (t) {
            if (found || !t) return;
            if (String(t.id) === String(taskId)) found = t;
            else if (t.subTasks) found = walkFindTask(t.subTasks, taskId);
        });
        return found;
    }

    function findTaskInAssignments(assignmentId, taskId) {
        var list = (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAssignments === 'function')
            ? window.FeatureStudentTimeline.getAssignments()
            : [];
        var assign = (list || []).find(function (a) { return String(a.id) === String(assignmentId); });
        if (!assign) return null;
        var tasks = assign.tasks;
        if (typeof tasks === 'string') {
            try { tasks = JSON.parse(tasks); } catch (_e) { tasks = []; }
        }
        if (window.TaskScriptResolver && typeof window.TaskScriptResolver.parseTasks === 'function') {
            tasks = window.TaskScriptResolver.parseTasks(assign.tasks);
        }
        return walkFindTask(tasks || [], taskId);
    }

    function findCompletion(assignmentId, taskId) {
        var comps = window._studentTaskCompletions || [];
        return comps.find(function (c) {
            return String(c.task_id) === String(taskId) && String(c.assignment_id) === String(assignmentId);
        }) || null;
    }

    function patchLocalCompletion(assignmentId, taskId, rawPayload, completed) {
        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
        var row = findCompletion(assignmentId, taskId);
        if (!row) {
            row = { assignment_id: assignmentId, task_id: String(taskId), status: completed ? 'completed' : 'incomplete', raw_data: {} };
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
        var res = await window.supabaseClient.auth.getUser();
        if (res.error || !res.data || !res.data.user) throw new Error('尚未登入');
        var classId = sessionStorage.getItem('currentClassId') || '';
        if (!classId) throw new Error('找不到班級');
        if (!isUuid(classId)) throw new Error('班級 ID 異常（' + classId + '）。請重新選擇班級後再繳交。');
        return { userId: res.data.user.id, classId: classId };
    }

    async function persistResult(assignmentId, taskId, rawPayload, completed) {
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        if (!isAssignmentId(assignmentId)) throw new Error('作業 ID 格式錯誤（' + assignmentId + '）。請強制重新整理後再試。');
        var auth = await getAuthContext();
        var assignmentKey = (/^\d+$/.test(String(assignmentId).trim())) ? Number(assignmentId) : assignmentId;
        var rpcRes = await window.supabaseClient.rpc('student_set_task_completion', {
            p_assignment_id: assignmentKey,
            p_task_id: String(taskId),
            p_class_id: auth.classId,
            p_completed: !!completed,
            p_raw_data: rawPayload
        });
        if (rpcRes.error) {
            var rpcMsg = String(rpcRes.error.message || rpcRes.error.details || '');
            var rpcMissing = /Could not find the function|does not exist|PGRST202|404/i.test(rpcMsg);
            if (!rpcMissing) throw rpcRes.error;
            var payload = {
                assignment_id: assignmentId,
                task_id: String(taskId),
                student_id: auth.userId,
                class_id: auth.classId,
                status: completed ? 'completed' : 'submitted',
                deleted_at: null,
                raw_data: rawPayload
            };
            var updRes = await window.supabaseClient.from('task_completions').update(payload)
                .eq('task_id', String(taskId)).eq('student_id', auth.userId).eq('class_id', auth.classId).select();
            if (updRes.error) throw updRes.error;
            if (!updRes.data || !updRes.data.length) {
                var insRes = await window.supabaseClient.from('task_completions').insert([payload]);
                if (insRes.error) throw insRes.error;
            }
        }
        patchLocalCompletion(assignmentId, taskId, rawPayload, completed);
    }

    // ------------------------------------------------------------------
    // 畫面渲染：一大題＝該 section 橫跨的每一頁 PDF 疊在一起，各自有可點擊的 overlay
    // ------------------------------------------------------------------

    function _pageIdAttr(sectionIdx, pageNum) {
        return 'pdf-quiz-page-' + sectionIdx + '-' + pageNum;
    }

    async function _renderPageImage(pdfDoc, pageNum) {
        var page = await pdfDoc.getPage(pageNum);
        var viewport = page.getViewport({ scale: 1.4 });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        return canvas.toDataURL('image/png');
    }

    function _boxHtml(sectionIdx, box, orderIdx, locked) {
        var fontPx = (_quizState && _quizState.fontSizePx) || DEFAULT_FONT_PX;
        var initialW = Math.max(MIN_INPUT_WIDTH_PX, _measureTextWidthPx(box.text || '', fontPx) + INPUT_WIDTH_PADDING_PX);
        var accent = locked ? '#94A3B8' : '#0EA5E9';
        var removeBtnHtml = locked ? '' : (
            '<button type="button" class="pdf-quiz-box-remove" data-box-id="' + esc(box.id) + '" title="刪除這個作答框" ' +
                'style="border:none; background:#FEE2E2; color:#B91C1C; width:16px; height:16px; border-radius:50%; font-size:0.65rem; line-height:1; cursor:pointer; flex-shrink:0;">×</button>'
        );
        return (
            '<div class="pdf-quiz-box" data-box-id="' + esc(box.id) + '" ' +
                'style="position:absolute; left:' + box.xPct + '%; top:' + box.yPct + '%; transform:translate(-6px,-50%); display:flex; align-items:center; gap:2px;">' +
                '<span class="pdf-quiz-box-handle" data-box-id="' + esc(box.id) + '" title="' + (locked ? '這一大題已批改鎖定' : '按住拖曳可移動位置') + '" ' +
                    'style="font-size:0.65rem; font-weight:900; color:' + accent + '; background:white; border:1px solid ' + accent + '; border-radius:50%; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; cursor:' + (locked ? 'default' : 'grab') + '; touch-action:none; user-select:none;">' + (orderIdx + 1) + '</span>' +
                '<input type="text" class="pdf-quiz-answer-input" data-box-id="' + esc(box.id) + '" value="' + esc(box.text || '') + '" ' + (locked ? 'disabled' : '') + ' ' +
                    'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-gramm="false" ' +
                    'style="width:' + initialW + 'px; border:2px solid ' + accent + '; background:' + (locked ? '#F1F5F9' : 'rgba(255,255,255,0.95)') + '; font-size:' + fontPx + 'px; padding:2px 4px; box-sizing:border-box; border-radius:3px; font-family:' + _fontFamilyForMeasure() + ';">' +
                removeBtnHtml +
            '</div>'
        );
    }

    function _isSectionSubmitted(idx) {
        var st = _quizState;
        return !!(st && st.sectionResults && st.sectionResults[idx]);
    }

    function _isSectionComplete(idx) {
        var st = _quizState;
        var sec = st.sections[idx];
        var boxes = st.boxesBySection[idx] || [];
        return boxes.length === sec.items.length;
    }

    function _allSectionsSubmitted() {
        var st = _quizState;
        return st.sectionResults.every(function (r) { return !!r; });
    }

    /** 依目前每大題已批改的結果，算出「目前為止」的總分／各大題明細，供存檔與結果彈窗共用 */
    function _aggregateResults() {
        var st = _quizState;
        var correct = 0, total = 0, submittedCount = 0;
        var wrongItems = [];
        var sectionStats = st.sections.map(function (sec, idx) {
            var r = st.sectionResults[idx];
            if (!r) return { section: sec.section, total: sec.items.length, correct: null, wrong_count: null, score: null, submitted: false };
            submittedCount++;
            correct += r.correct;
            total += r.total;
            wrongItems = wrongItems.concat(r.wrong_items || []);
            return { section: r.section, total: r.total, correct: r.correct, wrong_count: (r.total - r.correct), score: r.score, submitted: true };
        });
        return {
            correct: correct,
            total: total,
            score: total ? Math.round((correct / total) * 1000) / 10 : 0,
            wrong_items: wrongItems,
            section_stats: sectionStats,
            submitted_sections: submittedCount,
            total_sections: st.sections.length,
            all_submitted: submittedCount === st.sections.length,
            graded_at: new Date().toISOString()
        };
    }

    function _updateActionButton() {
        var st = _quizState;
        var btn = document.getElementById('pdf-quiz-main-action-btn');
        if (!st || !btn) return;
        var idx = st.currentIdx;
        if (_isSectionSubmitted(idx)) {
            if (_allSectionsSubmitted()) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.textContent = '🏁 查看總成績';
                btn.onclick = function () { _showResultModal(_aggregateResults()); };
            } else {
                var r = st.sectionResults[idx];
                btn.disabled = true;
                btn.style.opacity = '0.65';
                btn.style.cursor = 'not-allowed';
                btn.textContent = '✅ 已批改 ' + r.correct + ' / ' + r.total;
                btn.onclick = null;
            }
        } else if (_isSectionComplete(idx)) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.textContent = '提交這一大題並批改';
            btn.onclick = submitSection;
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.65';
            btn.style.cursor = 'not-allowed';
            btn.textContent = '先點出每一格再提交';
            btn.onclick = null;
        }
    }

    function _renderSectionCounter() {
        var st = _quizState;
        var idx = st.currentIdx;
        var sec = st.sections[idx];
        var boxes = st.boxesBySection[idx] || [];
        var need = sec.items.length;
        var got = boxes.length;
        var el = document.getElementById('pdf-quiz-counter');
        if (el) {
            if (_isSectionSubmitted(idx)) {
                el.innerHTML = '';
            } else {
                var ok = got === need;
                el.innerHTML = '目前這大題：<b style="color:' + (ok ? '#047857' : '#B45309') + ';">已建立 ' + got + ' / ' + need + ' 個作答框</b>'
                    + (ok ? ' ✅ 可以提交這一大題' : ' ⚠ 請照題目順序，把每一題（不會寫也留空）都點出作答框');
            }
        }
        _updateActionButton();
    }

    function _pageBlockHtml(dataUrl, pageNum, sectionIdx, boxesOnPage, orderOffsetByBox, locked) {
        var boxesHtml = boxesOnPage.map(function (b) {
            var orderIdx = orderOffsetByBox(b);
            return _boxHtml(sectionIdx, b, orderIdx, locked);
        }).join('');
        return '<div class="pdf-quiz-page-block" data-page="' + pageNum + '" ' +
                'style="position:relative; display:inline-block; margin-bottom:14px; max-width:100%; cursor:' + (locked ? 'default' : 'crosshair') + ';">' +
            '<img src="' + dataUrl + '" style="display:block; max-width:100%; height:auto; user-select:none;" draggable="false">' +
            boxesHtml +
        '</div>';
    }

    async function _renderSection() {
        var st = _quizState;
        if (!st) return;
        var idx = st.currentIdx;
        var sec = st.sections[idx];
        var locked = _isSectionSubmitted(idx);
        var indicatorEl = document.getElementById('pdf-quiz-section-indicator');
        if (indicatorEl) indicatorEl.textContent = '大題 ' + (idx + 1) + ' / ' + st.sections.length + '：' + sec.section + (locked ? '（已批改）' : '');
        var body = document.getElementById(MODAL_ID + '-body');
        if (!body) return;
        body.innerHTML = '<div style="padding:30px; text-align:center; color:#94A3B8;">⏳ 載入頁面…</div>';
        try {
            var range = st.pageRanges[idx] || { startPage: 1, endPage: 1 };
            var pages = [];
            for (var p = range.startPage; p <= range.endPage; p++) pages.push(p);
            var boxes = st.boxesBySection[idx] || [];
            var htmlParts = [];
            for (var i = 0; i < pages.length; i++) {
                var pageNum = pages[i];
                var dataUrl = await _renderPageImage(st.pdfDoc, pageNum);
                var boxesOnPage = boxes.filter(function (b) { return b.page === pageNum; });
                htmlParts.push(_pageBlockHtml(dataUrl, pageNum, idx, boxesOnPage, function (b) { return boxes.indexOf(b); }, locked));
            }
            var bannerHtml = locked
                ? ('<div style="margin-bottom:8px; padding:8px 10px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-size:0.82rem; color:#134E4A; font-weight:700;">'
                    + '✅ 這一大題已批改：' + st.sectionResults[idx].correct + ' / ' + st.sectionResults[idx].total + '（' + st.sectionResults[idx].score + '%），不能再修改（只鎖這一大題，其他大題不受影響）。'
                    + '</div>')
                : ('<div style="margin-bottom:8px; padding:8px 10px; background:#F0F9FF; border:1px solid #BAE6FD; border-radius:8px; font-size:0.82rem; color:#0369A1;">'
                    + '💡 這一大題共 ' + sec.items.length + ' 格要填。在下面 PDF 圖片上，找到底線／空格的地方點一下，就會出現一個可以打字的框（框上數字＝這是你第幾個建立的），不會寫也要點一下留空，不要跳過。填完後按下面「提交這一大題並批改」，這一大題會馬上批改，之後不能再改這一大題。'
                    + '</div>');
            body.innerHTML = bannerHtml + htmlParts.join('');
            _renderSectionCounter();
        } catch (err) {
            console.error('[FeatureStudentPdfQuiz] renderSection', err);
            body.innerHTML = '<div style="padding:30px; color:#DC2626;">頁面載入失敗：' + esc(err.message || String(err)) + '</div>';
        }
        _updateNavButtons();
    }

    function _updateNavButtons() {
        var st = _quizState;
        if (!st) return;
        var prevBtn = document.getElementById('pdf-quiz-prev-btn');
        var nextBtn = document.getElementById('pdf-quiz-next-btn');
        if (prevBtn) prevBtn.style.visibility = st.currentIdx === 0 ? 'hidden' : 'visible';
        if (nextBtn) nextBtn.style.visibility = st.currentIdx === st.sections.length - 1 ? 'hidden' : 'visible';
    }

    function _goToSection(delta) {
        var st = _quizState;
        if (!st) return;
        if (delta > 0 && !_isSectionSubmitted(st.currentIdx)) {
            window.showFlash('請先提交這一大題並完成批改，才能換下一大題', 'warning');
            return;
        }
        var next = st.currentIdx + delta;
        if (next < 0 || next >= st.sections.length) return;
        st.currentIdx = next;
        _renderSection();
    }

    function requestClose() {
        var st = _quizState;
        var hasUnsavedWork = st && st.sections.some(function (sec, idx) {
            return !_isSectionSubmitted(idx) && (st.boxesBySection[idx] || []).length > 0;
        });
        if (hasUnsavedWork) {
            if (!window.confirm('目前這大題還沒提交批改，這部分作答不會被存檔，確定要關閉？')) return;
        }
        if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
    }

    // ------------------------------------------------------------------
    // 點擊 PDF 頁面圖片 → 建立／聚焦作答框
    // ------------------------------------------------------------------

    function _onPageBlockClick(e) {
        var block = e.target.closest ? e.target.closest('.pdf-quiz-page-block') : null;
        if (!block) return;
        if (e.target.closest('.pdf-quiz-box')) return; // 點到既有的框/輸入框/刪除鈕，不要在這裡新增
        var st = _quizState;
        if (!st) return;
        if (_isSectionSubmitted(st.currentIdx)) return; // 這一大題已批改鎖定，不能再新增作答框
        var rect = block.getBoundingClientRect();
        var xPct = ((e.clientX - rect.left) / rect.width) * 100;
        var yPct = ((e.clientY - rect.top) / rect.height) * 100;
        var pageNum = Number(block.getAttribute('data-page'));

        var boxes = st.boxesBySection[st.currentIdx] || (st.boxesBySection[st.currentIdx] = []);
        var nearest = boxes.filter(function (b) { return b.page === pageNum; }).find(function (b) {
            return Math.abs(b.xPct - xPct) <= CLICK_MERGE_THRESHOLD_PCT && Math.abs(b.yPct - yPct) <= CLICK_MERGE_THRESHOLD_PCT;
        });
        if (nearest) {
            var inputEl = document.querySelector('.pdf-quiz-answer-input[data-box-id="' + nearest.id + '"]');
            if (inputEl) inputEl.focus();
            return;
        }

        var box = { id: 'b' + Date.now() + '_' + Math.floor(Math.random() * 10000), page: pageNum, xPct: xPct, yPct: yPct, text: '' };
        boxes.push(box);
        var boxHtml = _boxHtml(st.currentIdx, box, boxes.length - 1);
        block.insertAdjacentHTML('beforeend', boxHtml);
        _renderSectionCounter();
        var newInput = document.querySelector('.pdf-quiz-answer-input[data-box-id="' + box.id + '"]');
        if (newInput) newInput.focus();
    }

    function _onBodyInput(e) {
        if (!(e.target && e.target.classList && e.target.classList.contains('pdf-quiz-answer-input'))) return;
        var st = _quizState;
        if (!st) return;
        var boxId = e.target.getAttribute('data-box-id');
        var boxes = st.boxesBySection[st.currentIdx] || [];
        var b = boxes.find(function (x) { return x.id === boxId; });
        if (b) b.text = e.target.value;
        _autoSizeInput(e.target);
    }

    function _onBodyClick(e) {
        var removeBtn = e.target.closest ? e.target.closest('.pdf-quiz-box-remove') : null;
        if (removeBtn) {
            e.stopPropagation();
            var st = _quizState;
            if (!st || _isSectionSubmitted(st.currentIdx)) return;
            var boxId = removeBtn.getAttribute('data-box-id');
            var boxes = st.boxesBySection[st.currentIdx] || [];
            var idx = boxes.findIndex(function (x) { return x.id === boxId; });
            if (idx >= 0) boxes.splice(idx, 1);
            _renderSection(); // 重新編號＋重繪，避免殘留錨點
            return;
        }
        _onPageBlockClick(e);
    }

    // ------------------------------------------------------------------
    // 拖曳移動作答框：抓著框上的圓形編號（handle）拖，放開就固定在新位置
    // ------------------------------------------------------------------

    function _clientXY(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function _onBodyMouseDown(e) {
        var handle = e.target.closest ? e.target.closest('.pdf-quiz-box-handle') : null;
        if (!handle) return;
        var stChk = _quizState;
        if (stChk && _isSectionSubmitted(stChk.currentIdx)) return; // 已批改鎖定，不能再拖曳
        e.preventDefault();
        e.stopPropagation();
        var boxEl = handle.closest('.pdf-quiz-box');
        var pageBlockEl = handle.closest('.pdf-quiz-page-block');
        if (!boxEl || !pageBlockEl) return;
        _drag = { boxId: handle.getAttribute('data-box-id'), boxEl: boxEl, pageBlockEl: pageBlockEl };
        handle.style.cursor = 'grabbing';
        document.addEventListener('mousemove', _onDragMove);
        document.addEventListener('mouseup', _onDragEnd);
        document.addEventListener('touchmove', _onDragMove, { passive: false });
        document.addEventListener('touchend', _onDragEnd);
        document.addEventListener('touchcancel', _onDragEnd);
    }

    function _onDragMove(e) {
        if (!_drag) return;
        e.preventDefault();
        var pos = _clientXY(e);
        var rect = _drag.pageBlockEl.getBoundingClientRect();
        var xPct = Math.min(100, Math.max(0, ((pos.x - rect.left) / rect.width) * 100));
        var yPct = Math.min(100, Math.max(0, ((pos.y - rect.top) / rect.height) * 100));
        _drag.boxEl.style.left = xPct + '%';
        _drag.boxEl.style.top = yPct + '%';
        var st = _quizState;
        if (st) {
            var boxes = st.boxesBySection[st.currentIdx] || [];
            var b = boxes.find(function (x) { return x.id === _drag.boxId; });
            if (b) { b.xPct = xPct; b.yPct = yPct; }
        }
    }

    function _onDragEnd() {
        if (_drag && _drag.boxEl) {
            var handle = _drag.boxEl.querySelector('.pdf-quiz-box-handle');
            if (handle) handle.style.cursor = 'grab';
        }
        _drag = null;
        document.removeEventListener('mousemove', _onDragMove);
        document.removeEventListener('mouseup', _onDragEnd);
        document.removeEventListener('touchmove', _onDragMove);
        document.removeEventListener('touchend', _onDragEnd);
        document.removeEventListener('touchcancel', _onDragEnd);
    }

    // ------------------------------------------------------------------
    // 統一文字大小（影響目前畫面上所有作答框，之後新建的框也套用同一個大小）
    // ------------------------------------------------------------------

    function _applyFontSizeToVisibleInputs() {
        var st = _quizState;
        if (!st) return;
        var fontPx = st.fontSizePx;
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-answer-input')).forEach(function (el) {
            el.style.fontSize = fontPx + 'px';
            _autoSizeInput(el);
        });
        var display = document.getElementById('pdf-quiz-fontsize-display');
        if (display) display.textContent = fontPx + 'px';
    }

    function changeFontSize(delta) {
        var st = _quizState;
        if (!st) return;
        st.fontSizePx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, (st.fontSizePx || DEFAULT_FONT_PX) + delta));
        _applyFontSizeToVisibleInputs();
    }

    // ------------------------------------------------------------------
    // 開啟考卷
    // ------------------------------------------------------------------

    async function openQuiz(assignmentId, taskId) {
        var task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        var job = task.raw_data && task.raw_data.pdf_exam_job;
        if (!job || !job.pdf_file_id) return window.showFlash('老師尚未設定這份 PDF 考卷', 'warning');
        var bank = (job.parsed_bank || []).filter(function (b) { return b.key; });
        if (!bank.length) return window.showFlash('老師尚未確認這份考卷的答案清單', 'warning');
        if (!window.PdfExamPaper) return window.showFlash('PdfExamPaper 模組未載入', 'error');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return window.showFlash('ModalOverlay 未載入', 'error');

        window.showFlash('⏳ 讀取考卷…', 'info');
        var pdfDoc;
        try {
            pdfDoc = await window.PdfExamPaper.loadPdfDocumentFromDrive(job.pdf_file_id);
        } catch (err) {
            console.error('[FeatureStudentPdfQuiz] loadPdfDocumentFromDrive', err);
            return window.showFlash('考卷讀取失敗：' + (err.message || err), 'error');
        }

        var sections = window.PdfExamPaper.groupItemsBySection(bank);
        var pageRanges;
        try {
            pageRanges = await window.PdfExamPaper.detectSectionPageRanges(pdfDoc, bank);
        } catch (err) {
            console.error('[FeatureStudentPdfQuiz] detectSectionPageRanges', err);
            pageRanges = sections.map(function () { return { startPage: 1, endPage: pdfDoc.numPages }; });
        }
        // detectSectionPageRanges 回傳的順序跟 sections 一樣（都來自同一份 bank 的大題出現順序），
        // 保險起見用 section 名稱對應一次，避免任何排序差異害頁碼配錯大題。
        var rangeBySection = {};
        (pageRanges || []).forEach(function (r) { rangeBySection[r.section] = r; });
        var orderedRanges = sections.map(function (s) {
            return rangeBySection[s.section] || { startPage: 1, endPage: pdfDoc.numPages };
        });

        var prev = findCompletion(assignmentId, taskId);
        var prevRaw = (prev && prev.raw_data) || {};
        var prevResult = prevRaw.pdf_quiz_result;

        // 💣 只有「上次還在作答中（沒交完）」才續寫；上次已經整份交完的話，「再作一次」＝重新開始一份
        // 全新的作答（不去動舊資料，重批就整份重來），避免把已批改鎖定的大題硬凹成可以續寫。
        var prevBoxesRaw = prevRaw.pdf_quiz_boxes_by_section;
        var prevSectionResultsRaw = prevRaw.pdf_quiz_section_results;
        var canResume = !!(prevResult && prevResult.all_submitted === false
            && Array.isArray(prevBoxesRaw) && prevBoxesRaw.length === sections.length
            && Array.isArray(prevSectionResultsRaw) && prevSectionResultsRaw.length === sections.length);

        var boxesBySection = canResume
            ? sections.map(function (s, idx) { return Array.isArray(prevBoxesRaw[idx]) ? prevBoxesRaw[idx] : []; })
            : sections.map(function () { return []; });
        var sectionResults = canResume
            ? sections.map(function (s, idx) { return prevSectionResultsRaw[idx] || null; })
            : sections.map(function () { return null; });
        var startIdx = 0;
        if (canResume) {
            var firstUnsubmittedIdx = sectionResults.findIndex(function (r) { return !r; });
            startIdx = firstUnsubmittedIdx >= 0 ? firstUnsubmittedIdx : (sections.length - 1);
        }

        _quizState = {
            assignmentId: assignmentId,
            taskId: taskId,
            task: task,
            job: job,
            pdfDoc: pdfDoc,
            sections: sections,
            pageRanges: orderedRanges,
            boxesBySection: boxesBySection,
            sectionResults: sectionResults,
            currentIdx: startIdx,
            fontSizePx: DEFAULT_FONT_PX
        };

        var title = String(task.title || 'PDF 考卷').replace(/<[^>]*>?/gm, '');
        var prevScoreHtml = '';
        if (canResume) {
            prevScoreHtml = '<div style="margin-bottom:8px; padding:6px 10px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; font-size:0.8rem; color:#92400E; font-weight:700;">'
                + '↩️ 繼續上次的作答：已批改 ' + esc(prevResult.submitted_sections) + ' / ' + esc(prevResult.total_sections) + ' 大題，接著完成剩下的大題。'
                + '</div>';
        } else if (prevResult) {
            prevScoreHtml = '<div style="margin-bottom:8px; padding:6px 10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; font-size:0.8rem; color:#334155; font-weight:700;">'
                + '上次成績：' + esc(prevResult.correct) + ' / ' + esc(prevResult.total) + '（' + esc(prevResult.score) + '%）'
                + '</div>';
        }

        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: 'B',
            isDirty: function () {
                var s = _quizState;
                return !!(s && s.sections.some(function (sec, idx) {
                    return !_isSectionSubmitted(idx) && (s.boxesBySection[idx] || []).length > 0;
                }));
            },
            unsavedMessage: '目前這大題還沒提交批改，這部分作答不會被存檔，確定要關閉？',
            onMount: function (overlay) {
                overlay.addEventListener('input', _onBodyInput);
                overlay.addEventListener('click', _onBodyClick);
                overlay.addEventListener('mousedown', _onBodyMouseDown);
                overlay.addEventListener('touchstart', _onBodyMouseDown, { passive: false });
                _renderSection();
            },
            contentHtml:
                '<div style="max-width:900px; width:95vw; height:92vh; background:white; border-radius:14px; padding:16px; box-shadow:0 20px 50px rgba(15,23,42,0.2); display:flex; flex-direction:column; box-sizing:border-box;">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📄 ' + esc(title) + '</h3>' +
                        '<div style="display:flex; align-items:center; gap:10px;">' +
                            '<div style="display:flex; align-items:center; gap:4px; background:#F1F5F9; border-radius:8px; padding:3px 6px;">' +
                                '<span style="font-size:0.75rem; color:#64748B;">文字大小</span>' +
                                '<button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem;" onclick="window.FeatureStudentPdfQuiz.changeFontSize(-2)">－</button>' +
                                '<span id="pdf-quiz-fontsize-display" style="font-size:0.78rem; font-weight:700; color:#334155; min-width:34px; text-align:center;">' + DEFAULT_FONT_PX + 'px</span>' +
                                '<button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem;" onclick="window.FeatureStudentPdfQuiz.changeFontSize(2)">＋</button>' +
                            '</div>' +
                            '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeatureStudentPdfQuiz.requestClose()">關閉</button>' +
                        '</div>' +
                    '</div>' +
                    prevScoreHtml +
                    '<div id="pdf-quiz-section-indicator" style="font-size:0.85rem; font-weight:800; color:#0369A1; margin-bottom:4px;"></div>' +
                    '<div id="pdf-quiz-counter" style="font-size:0.8rem; margin-bottom:6px;"></div>' +
                    '<div id="' + MODAL_ID + '-body" style="flex:1; overflow:auto; border:1px solid #E2E8F0; border-radius:8px; background:#F8FAFC; padding:10px;"></div>' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; gap:8px;">' +
                        '<button type="button" class="btn" id="pdf-quiz-prev-btn" onclick="window.FeatureStudentPdfQuiz._goToSection(-1)">◀ 上一大題</button>' +
                        '<button type="button" class="btn btn-action" id="pdf-quiz-main-action-btn" style="background:#0F766E; color:white; border:none; padding:8px 14px; font-weight:800;">提交這一大題並批改</button>' +
                        '<button type="button" class="btn" id="pdf-quiz-next-btn" onclick="window.FeatureStudentPdfQuiz._goToSection(1)">下一大題 ▶</button>' +
                    '</div>' +
                '</div>'
        });
    }

    // 💣 學生結果頁**不顯示正確答案**（只標出哪些格錯了），避免直接洩題給還沒交卷的同學。
    // 老師複核畫面（feature-pdf-exam-job.js）不受影響，仍讀得到 wrong_items.expected 供批改用。
    function _showResultModal(result) {
        var sectionStatsHtml = (result.section_stats || []).map(function (s) {
            if (s.submitted === false) {
                return '<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 2px; border-bottom:1px solid #E2E8F0; font-size:0.85rem;">' +
                    '<span style="color:#334155; font-weight:600;">' + esc(s.section) + '</span>' +
                    '<span style="font-weight:700; color:#94A3B8;">尚未提交</span>' +
                '</div>';
            }
            var color = s.wrong_count > 0 ? '#B45309' : '#047857';
            return '<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 2px; border-bottom:1px solid #E2E8F0; font-size:0.85rem;">' +
                '<span style="color:#334155; font-weight:600;">' + esc(s.section) + '</span>' +
                '<span style="font-weight:800; color:' + color + ';">' + esc(s.correct) + ' / ' + esc(s.total) + '（' + esc(s.score) + '%）' +
                    (s.wrong_count > 0 ? '　錯 ' + esc(s.wrong_count) + ' 格' : '') +
                '</span>' +
            '</div>';
        }).join('');
        var wrongHtml = (result.wrong_items || []).map(function (w) {
            return '<div style="border:1px solid #FECACA; background:#FFF7F7; border-radius:8px; padding:10px; margin-bottom:8px;">' +
                '<div style="font-size:0.8rem; font-weight:800; color:#B91C1C;">' + esc(w.prompt_zh || '') + '</div>' +
                '<div style="font-size:0.85rem; margin-top:4px;">你的答案：<b>' + esc(w.answer || '(未填)') + '</b></div>' +
            '</div>';
        }).join('');
        window.ModalOverlay.open({
            id: RESULT_MODAL_ID,
            tier: 'A',
            contentHtml:
                '<div style="max-width:600px; width:92vw; max-height:86vh; overflow:auto; background:white; border-radius:14px; padding:18px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📊 繳交結果</h3>' +
                        '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeatureStudentPdfQuiz.closeResult()">知道了</button>' +
                    '</div>' +
                    '<div style="margin-bottom:12px; padding:10px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-weight:800; color:#134E4A;">' +
                        '總分 ' + esc(result.correct) + ' / ' + esc(result.total) + '（' + esc(result.score) + '%）' +
                    '</div>' +
                    (sectionStatsHtml ? ('<div style="font-weight:900; color:#0F766E; margin-bottom:4px;">各大題結果</div><div style="margin-bottom:12px;">' + sectionStatsHtml + '</div>') : '') +
                    (wrongHtml
                        ? ('<div style="font-weight:900; color:#B91C1C; margin-bottom:6px;">錯題（只標出錯在哪格，不顯示正確答案）</div>' + wrongHtml)
                        : '<div style="color:#047857; font-weight:800;">全部答對！</div>') +
                '</div>'
        });
    }

    function closeResult() {
        if (window.ModalOverlay) window.ModalOverlay.close(RESULT_MODAL_ID);
        window.location.reload();
    }

    function openPastResult(assignmentId, taskId) {
        var prev = findCompletion(assignmentId, taskId);
        var raw = (prev && prev.raw_data) || {};
        var result = raw.pdf_quiz_result;
        if (!result) return window.showFlash('尚未作答', 'warning');
        _showResultModal(result);
    }

    /**
     * 把每一大題的作答框（依建立順序）跟該大題的答案清單（已依題號排好序）一一對齊，
     * 組成 { bankKey: 學生輸入文字 } 給 QuizPaperBuilder.gradeAnswers。順序才是配對依據，
     * 座標只是畫面參考用，不參與比對。
     */
    function _buildAnswersFromBoxes() {
        var st = _quizState;
        var answers = {};
        st.sections.forEach(function (sec, idx) {
            var boxes = st.boxesBySection[idx] || [];
            var n = Math.min(boxes.length, sec.items.length);
            for (var i = 0; i < n; i++) {
                answers[sec.items[i].key] = boxes[i].text || '';
            }
        });
        return answers;
    }

    /** 只把「這一大題」的作答框跟這一大題的答案清單對齊，供單獨批改這一大題用 */
    function _buildSectionAnswers(idx) {
        var st = _quizState;
        var sec = st.sections[idx];
        var boxes = st.boxesBySection[idx] || [];
        var answers = {};
        var n = Math.min(boxes.length, sec.items.length);
        for (var i = 0; i < n; i++) {
            answers[sec.items[i].key] = boxes[i].text || '';
        }
        return answers;
    }

    /**
     * 提交「目前這一大題」並立刻批改（不用等整份考卷寫完）：批改完鎖定這一大題、顯示這一大題的
     * 對錯格數／百分比（不顯示正確答案），同時把目前為止的整份考卷進度存檔，讓老師端也能看到
     * 部分完成度。最後一大題批改完才彈出整份考卷的總結。
     */
    async function submitSection() {
        var st = _quizState;
        if (!st) return;
        var idx = st.currentIdx;
        if (_isSectionSubmitted(idx)) return;
        if (!_isSectionComplete(idx)) {
            window.showFlash('這一大題還沒把每一題的作答框都點出來（不會寫也要點一下留空），才能提交批改', 'warning');
            return;
        }
        var sec = st.sections[idx];
        if (!window.confirm('確定要提交「' + sec.section + '」嗎？提交後會立刻批改，這一大題就不能再修改了。')) return;

        var sectionAnswers = _buildSectionAnswers(idx);
        var fullPaper = window.PdfExamPaper.buildGradingPaper(st.job);
        var sectionKeySet = {};
        sec.items.forEach(function (it) { sectionKeySet[it.key] = true; });
        var sectionPaper = { items: fullPaper.items.filter(function (it) { return sectionKeySet[it.item_id]; }) };
        var gradeResult = window.QuizPaperBuilder.gradeAnswers(sectionPaper, sectionAnswers);

        st.sectionResults[idx] = {
            section: sec.section,
            correct: gradeResult.correct,
            total: gradeResult.total,
            score: gradeResult.score,
            wrong_items: gradeResult.wrong_items,
            graded_at: new Date().toISOString()
        };

        var aggregate = _aggregateResults();
        var rawPayload = {
            pdf_quiz_answers: _buildAnswersFromBoxes(),
            // 💣 現階段完整保留學生整份卷子（每個作答框的頁碼／位置／文字），不只存扁平化的答案，
            // 之後若要重現「學生當時到底怎麼點、怎麼寫」都還原得出來，不會因為只存 key→text 而失真。
            pdf_quiz_boxes_by_section: st.boxesBySection,
            // 每一大題各自的批改結果（含 wrong_items），中途關閉重開時要靠這個復原已批改的大題，
            // 不然只用扁平化的 pdf_quiz_result 兜不出「哪些大題已批改、內容是什麼」。
            pdf_quiz_section_results: st.sectionResults,
            pdf_quiz_result: aggregate
        };
        try {
            await persistResult(st.assignmentId, st.taskId, rawPayload, aggregate.all_submitted);
            var r = st.sectionResults[idx];
            window.showFlash('✅「' + sec.section + '」已批改：' + r.correct + ' / ' + r.total + '（' + r.score + '%）', 'success');
            if (aggregate.all_submitted) {
                if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
                _showResultModal(aggregate);
            } else {
                _renderSection();
            }
        } catch (err) {
            st.sectionResults[idx] = null; // 沒存到就別讓畫面顯示已批改，避免跟資料庫狀態兜不起來
            console.error('[FeatureStudentPdfQuiz] submitSection', err);
            window.showFlash('提交失敗：' + (err.message || err), 'error');
        }
    }

    return {
        openQuiz: openQuiz,
        requestClose: requestClose,
        submitSection: submitSection,
        _goToSection: _goToSection,
        closeResult: closeResult,
        openPastResult: openPastResult,
        changeFontSize: changeFontSize
    };
})();

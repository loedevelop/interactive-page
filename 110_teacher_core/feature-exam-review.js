/**
 * 📂 110_teacher_core/feature-exam-review.js
 * 🎯 職責：老師端「考試批改」——查看學生考卷作答、標示對錯、調整標準答案／分數
 *
 * 💣 雷區（見 .cursor/rules/quiz-accepted-answers-invariant.mdc）：
 * 多標準答案一律改在 quiz_paper.items[].accepted_answers（考卷快照層），
 * 不要另開「只改這個學生分數」的旁路開關；存檔時一律用
 * QuizPaperBuilder.regradeCompletionRawData 重新算分，不要手動兜分數字串。
 */
window.FeatureExamReview = (function () {
    'use strict';

    const MODAL_ID = 'exam-review-modal';
    const PAGE_MODAL_ID = 'exam-review-page-modal';

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
                        taskId: t.id,
                        taskTitle: t.title || '(未命名考試)'
                    });
                });
            });
            renderTaskListHtml(classId, examTasks);
        } catch (err) {
            console.error('[FeatureExamReview] renderReviewPage', err);
            window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('❌ 載入失敗：' + esc(err.message || err)) });
        }
    }

    function wrapPageShell(innerHtml) {
        return '<div style="background:white; border-radius:14px; max-width:640px; width:100%; max-height:85vh; overflow-y:auto; padding:24px;">'
            + '<h3 style="margin:0 0 16px; color:var(--primary-dark);">🖊️ 考試批改</h3>'
            + innerHtml
            + '</div>';
    }

    function renderTaskListHtml(classId, examTasks) {
        const safeClassId = String(classId).replace(/'/g, "\\'");
        let body;
        if (!examTasks.length) {
            body = '<div style="padding:20px; text-align:center; color:#94A3B8; font-weight:700;">目前這個班級沒有考試任務。</div>';
        } else {
            body = '<div style="display:flex; flex-direction:column; gap:8px;">' + examTasks.map(function (t) {
                const safeAssignId = String(t.assignmentId).replace(/'/g, "\\'");
                const safeTaskId = String(t.taskId).replace(/'/g, "\\'");
                return '<button type="button" onclick="window.FeatureExamReview._openTaskStudentList(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" '
                    + 'style="text-align:left; padding:12px 14px; border:1px solid #E2E8F0; border-radius:10px; background:#F8FAFC; cursor:pointer; font-weight:800; color:#1E293B;">'
                    + '📝 ' + esc(t.taskTitle)
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

    async function openTaskStudentList(classId, assignmentId, taskId) {
        window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('⏳ 載入學生作答狀況…') });
        try {
            const [students, completions] = await Promise.all([
                window.ApiQuizReview.fetchClassStudents(classId),
                window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId)
            ]);
            const byStudent = new Map();
            completions.forEach(function (c) { byStudent.set(String(c.student_id), c); });

            const safeClassId = String(classId).replace(/'/g, "\\'");
            const safeAssignId = String(assignmentId).replace(/'/g, "\\'");
            const safeTaskId = String(taskId).replace(/'/g, "\\'");

            const rows = students.map(function (s) {
                const c = byStudent.get(String(s.id));
                const qr = c && c.raw_data && c.raw_data.quiz_result;
                const retake = c && c.raw_data && c.raw_data.quiz_retake;
                let statusHtml;
                if (qr && qr.total != null) {
                    const color = qr.score >= 80 ? '#10B981' : (qr.score >= 50 ? '#F59E0B' : '#EF4444');
                    statusHtml = '<span style="color:' + color + '; font-weight:900;">' + qr.score + '%</span>'
                        + ' <span style="color:#94A3B8; font-size:0.78rem;">(' + qr.correct + '/' + qr.total + ')</span>';
                    // 🔁 錯題重考已完成：附上合併正確率（原始＋訂正），方便老師一眼看訂正後結果
                    if (retake && retake.done && retake.combined) {
                        statusHtml += ' <span style="color:#B45309; font-size:0.78rem; font-weight:800;">→ 訂正後 '
                            + retake.combined.rate + '% (' + retake.combined.correct + '/' + retake.combined.total + ')</span>';
                    } else if (retake && !retake.done && Array.isArray(retake.item_ids) && retake.item_ids.length) {
                        statusHtml += ' <span style="color:#D97706; font-size:0.72rem;">（待重考錯題）</span>';
                    }
                } else {
                    statusHtml = '<span style="color:#CBD5E1;">尚未作答</span>';
                }
                const safeStudentId = String(s.id).replace(/'/g, "\\'");
                return '<button type="button" onclick="window.FeatureExamReview.openReview(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\', \'' + safeStudentId + '\')" '
                    + 'style="display:flex; justify-content:space-between; align-items:center; text-align:left; padding:10px 14px; border:1px solid #E2E8F0; border-radius:10px; background:white; cursor:pointer; width:100%;">'
                    + '<span style="font-weight:800; color:#1E293B;">' + esc(s.name) + '</span>'
                    + '<span>' + statusHtml + '</span>'
                    + '</button>';
            }).join('');

            const body = '<div style="margin-bottom:10px;">'
                + '<button type="button" onclick="window.FeatureExamReview.renderReviewPage(\'' + safeClassId + '\')" style="background:none; border:none; color:#6D28D9; font-weight:800; cursor:pointer; padding:0;">← 返回任務清單</button>'
                + '</div>'
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

            state = {
                classId: classId,
                assignmentId: assignmentId,
                taskId: taskId,
                studentId: studentId,
                studentName: studentInfo ? studentInfo.name : '未知學生',
                taskTitle: task.title || task.raw_data.exam_title || '(未命名考試)',
                paper: JSON.parse(JSON.stringify(task.raw_data.quiz_paper)),
                originalPaperJson: JSON.stringify(task.raw_data.quiz_paper),
                completion: completion,
                answers: (completion && completion.raw_data && completion.raw_data.quiz_answers) || {},
                showWrongOnly: true,
                editingPrimaryIdx: null
            };
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
        return '<div id="qr-modal-body" style="background:white; border-radius:14px; max-width:820px; width:100%; max-height:90vh; overflow-y:auto; padding:24px;">'
            + innerHtml
            + '</div>';
    }

    function computeLiveScore() {
        const items = state.paper.items || [];
        let correct = 0;
        let attempted = 0;
        items.forEach(function (it) {
            const got = state.answers[it.item_id];
            if (got == null || String(got).trim() === '') return;
            attempted += 1;
            const n = window.QuizPaperBuilder.normalizeAnswer(got);
            const list = [it.answer_en].concat(it.accepted_answers || []).map(window.QuizPaperBuilder.normalizeAnswer);
            if (list.indexOf(n) !== -1) correct += 1;
        });
        return { correct: correct, total: items.length, attempted: attempted };
    }

    function renderModal() {
        const items = state.paper.items || [];
        const live = computeLiveScore();
        const scorePct = items.length ? Math.round((live.correct / items.length) * 1000) / 10 : 0;
        const scoreColor = scorePct >= 80 ? '#10B981' : (scorePct >= 50 ? '#F59E0B' : '#EF4444');

        const rowsHtml = items.map(function (_, idx) { return renderItemRow(idx); }).join('');

        const savedScoreHtml = (state.completion && state.completion.raw_data && state.completion.raw_data.quiz_result)
            ? '<span style="color:#94A3B8; font-size:0.8rem;">（已存檔分數：' + state.completion.raw_data.quiz_result.score + '%）</span>'
            : '<span style="color:#94A3B8; font-size:0.8rem;">（尚未作答，以下僅供預覽／編輯標準答案）</span>';

        const header = '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; flex-wrap:wrap; gap:8px;">'
            + '<div>'
                + '<h3 style="margin:0; color:var(--primary-dark);">🖊️ ' + esc(state.studentName) + '</h3>'
                + '<div style="color:#64748B; font-weight:700; font-size:0.85rem; margin-top:2px;">' + esc(state.taskTitle) + '</div>'
            + '</div>'
            + '<div style="text-align:right;">'
                + '<div style="font-size:1.6rem; font-weight:900; color:' + scoreColor + ';">' + scorePct + '%</div>'
                + '<div style="font-size:0.78rem; color:#64748B;">' + live.correct + ' / ' + items.length + ' 題　' + savedScoreHtml + '</div>'
            + '</div>'
            + '</div>';

        const toggleHtml = '<label style="display:inline-flex; align-items:center; gap:6px; font-size:0.85rem; font-weight:700; color:#475569; margin-bottom:12px; cursor:pointer;">'
            + '<input type="checkbox" ' + (state.showWrongOnly ? 'checked' : '') + ' onchange="window.FeatureExamReview._toggleShowWrongOnly(this.checked)"> 只顯示錯題／未作答'
            + '</label>';

        const emptyMsg = state.showWrongOnly && !hasAnyVisibleRow(items)
            ? '<div style="padding:16px; text-align:center; color:#047857; font-weight:800; background:#ECFDF5; border-radius:10px;">本次全對，沒有錯題／缺答。</div>'
            : '';

        const contentHtml = wrapModalShell(header + toggleHtml + '<div id="qr-rows">' + emptyMsg + rowsHtml + '</div>') + footerHtml();
        mountOrPatchModal(contentHtml);
    }

    /**
     * 💣 雷區：ModalOverlay.open 對同一個 id 再次呼叫時，會先 close(activeId) 觸發舊的
     * onClose（這裡是 state=null）才 open 新的——如果每次互動都重新呼叫 open()，狀態會在
     * 重繪過程中被自己的舊 onClose 清空。所以「開新 modal」只在第一次呼叫 ModalOverlay.open，
     * 之後互動觸發的重繪都直接改 DOM innerHTML，不要再呼叫 ModalOverlay.open。
     */
    function mountOrPatchModal(contentHtml) {
        const existing = document.getElementById(MODAL_ID);
        if (existing) {
            existing.innerHTML = contentHtml;
            return;
        }
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
        const got = state.answers[it.item_id];
        if (got == null || String(got).trim() === '') return false; // 未作答仍算「要看」
        const n = window.QuizPaperBuilder.normalizeAnswer(got);
        const list = [it.answer_en].concat(it.accepted_answers || []).map(window.QuizPaperBuilder.normalizeAnswer);
        return list.indexOf(n) !== -1;
    }

    function renderItemRow(idx) {
        const item = state.paper.items[idx];
        const got = state.answers[item.item_id];
        const hasAnswer = got != null && String(got).trim() !== '';
        const normGot = hasAnswer ? window.QuizPaperBuilder.normalizeAnswer(got) : '';
        const acceptedNorm = [item.answer_en].concat(item.accepted_answers || []).map(window.QuizPaperBuilder.normalizeAnswer);
        const isCorrect = hasAnswer && acceptedNorm.indexOf(normGot) !== -1;

        if (state.showWrongOnly && hasAnswer && isCorrect) {
            return '<div id="qr-row-' + idx + '" style="display:none;"></div>';
        }

        let studentAnsHtml;
        if (!hasAnswer) {
            studentAnsHtml = '<span style="color:#94A3B8; font-weight:700;">（尚未作答）</span>';
        } else if (isCorrect) {
            studentAnsHtml = '<span style="color:#047857; font-weight:800;">' + esc(got) + '</span>';
        } else {
            const best = window.QuizPaperBuilder.bestDiffForAnswer(item, got);
            studentAnsHtml = window.QuizPaperBuilder.renderAnswerDiffHtml(best.diff.ops)
                + window.QuizPaperBuilder.renderSpellingPairsHtml(best.diff.spelling_pairs);
        }

        const primaryEditing = state.editingPrimaryIdx === idx;
        const primaryHtml = primaryEditing
            ? '<input id="qr-primary-input-' + idx + '" type="text" value="' + escAttr(item.answer_en) + '" '
                + 'style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #A78BFA; border-radius:6px; font-size:0.85rem;">'
                + ' <button type="button" onclick="window.FeatureExamReview._confirmEditPrimary(' + idx + ')" style="padding:4px 8px; border:none; border-radius:6px; background:#7C3AED; color:white; font-weight:800; cursor:pointer;">✓</button>'
                + ' <button type="button" onclick="window.FeatureExamReview._cancelEditPrimary(' + idx + ')" style="padding:4px 8px; border:1px solid #CBD5E1; border-radius:6px; background:white; cursor:pointer;">✕</button>'
            : '<span style="display:inline-block; padding:3px 10px; border-radius:6px; background:#EEF2FF; color:#3730A3; font-weight:800; font-size:0.85rem;">★ ' + esc(item.answer_en) + '</span>'
                + ' <button type="button" onclick="window.FeatureExamReview._startEditPrimary(' + idx + ')" title="修改主要標準答案" style="border:none; background:none; cursor:pointer; font-size:0.85rem;">✏️</button>';

        const acceptedChips = (item.accepted_answers || []).map(function (a, ai) {
            return '<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:6px; background:#F0FDF4; color:#166534; font-weight:800; font-size:0.85rem; margin-right:4px;">'
                + esc(a)
                + ' <a href="javascript:void(0)" onclick="window.FeatureExamReview._removeAccepted(' + idx + ',' + ai + ')" style="color:#B91C1C; font-weight:900; text-decoration:none;" title="移除這個可接受答案">×</a>'
                + '</span>';
        }).join('');

        const alsoCorrectHtml = (hasAnswer && !isCorrect)
            ? '<label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:0.85rem; font-weight:700; color:#475569; cursor:pointer;">'
                + '<input type="checkbox" onchange="window.FeatureExamReview._toggleAlsoCorrect(' + idx + ', this.checked)"> '
                + '✅ 學生這個答案也算對（加入標準答案，全班同任務會自動重新批改）'
                + '</label>'
            : '';

        const addAnswerHtml = '<div style="display:flex; gap:6px; margin-top:8px;">'
            + '<input id="qr-new-ans-' + idx + '" type="text" placeholder="輸入另一個可接受答案…" style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #CBD5E1; border-radius:6px; font-size:0.85rem;">'
            + '<button type="button" onclick="window.FeatureExamReview._addAccepted(' + idx + ')" style="padding:5px 12px; border:none; border-radius:6px; background:#0EA5E9; color:white; font-weight:800; cursor:pointer; white-space:nowrap;">+ 新增可接受答案</button>'
            + '</div>';

        const statusBadge = !hasAnswer
            ? '<span style="color:#94A3B8;">⚠ 未作答</span>'
            : (isCorrect ? '<span style="color:#047857;">✅ 正確</span>' : '<span style="color:#DC2626;">❌ 錯誤</span>');

        return '<div id="qr-row-' + idx + '" style="border:1px solid ' + (isCorrect ? '#D1FAE5' : '#FECACA') + '; border-radius:10px; padding:12px 14px; margin-bottom:10px; background:' + (isCorrect ? '#F0FDF4' : '#FFF7F7') + ';">'
            + '<div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:900; color:#64748B; margin-bottom:4px;">'
                + '<span>第 ' + esc(item.seq) + ' 題</span>' + statusBadge
            + '</div>'
            + '<div style="font-weight:800; color:#1E293B; margin-bottom:8px; white-space:pre-wrap;">' + esc(item.prompt_zh || '') + '</div>'
            + '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:2px;">學生答案</div>'
            + '<div style="font-size:1rem; line-height:1.6; margin-bottom:8px;">' + studentAnsHtml + '</div>'
            + '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:4px;">標準答案（可多個）</div>'
            + '<div>' + primaryHtml + ' ' + acceptedChips + '</div>'
            + alsoCorrectHtml
            + addAnswerHtml
            + '</div>';
    }

    /**
     * 每次互動後整個 modal 重繪一次：分數／存檔按鈕都要跟著變動變化，且所有互動都是
     * 「點擊後才觸發」（新增答案／確認修改都是按按鈕才讀 input 值），不是邊打字邊重繪，
     * 所以直接整個重繪不會打斷使用者輸入。
     */
    function rerenderAll() {
        renderModal();
    }

    function footerHtml() {
        const dirty = isDirty();
        return '<div style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px; position:sticky; bottom:0; background:white; padding-top:8px;">'
            + '<button type="button" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')" style="padding:9px 18px; border:1px solid #CBD5E1; border-radius:8px; background:#F1F5F9; font-weight:800; cursor:pointer;">關閉</button>'
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
        renderModal();
    }

    function _addAccepted(idx) {
        if (!state) return;
        const input = document.getElementById('qr-new-ans-' + idx);
        if (!input) return;
        const val = input.value;
        const item = state.paper.items[idx];
        const changed = window.QuizPaperBuilder.addAcceptedAnswer(item, val);
        if (!changed && val.trim()) {
            window.showFlash && window.showFlash('這個答案已經在標準答案裡了', 'warning');
            return;
        }
        rerenderAll();
    }

    function _removeAccepted(idx, ai) {
        if (!state) return;
        const item = state.paper.items[idx];
        const val = (item.accepted_answers || [])[ai];
        if (val == null) return;
        window.QuizPaperBuilder.removeAcceptedAnswer(item, val);
        rerenderAll();
    }

    function _toggleAlsoCorrect(idx, checked) {
        if (!state) return;
        const item = state.paper.items[idx];
        const got = state.answers[item.item_id];
        if (got == null) return;
        if (checked) window.QuizPaperBuilder.addAcceptedAnswer(item, got);
        else window.QuizPaperBuilder.removeAcceptedAnswer(item, got);
        rerenderAll();
    }

    function _startEditPrimary(idx) {
        if (!state) return;
        state.editingPrimaryIdx = idx;
        rerenderAll();
        const input = document.getElementById('qr-primary-input-' + idx);
        if (input) { input.focus(); input.select(); }
    }

    function _cancelEditPrimary(idx) {
        if (!state) return;
        state.editingPrimaryIdx = null;
        rerenderAll();
    }

    function _confirmEditPrimary(idx) {
        if (!state) return;
        const input = document.getElementById('qr-primary-input-' + idx);
        const val = input ? input.value : '';
        window.QuizPaperBuilder.setPrimaryAnswer(state.paper.items[idx], val);
        state.editingPrimaryIdx = null;
        rerenderAll();
    }

    async function _save() {
        if (!state || !isDirty()) return;
        const saveBtn = document.getElementById('qr-save-btn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '儲存中…'; }
        try {
            await window.ApiQuizReview.saveQuizPaperPatch(state.assignmentId, state.taskId, state.paper);

            if (state.completion) {
                const regraded = window.QuizPaperBuilder.regradeCompletionRawData(state.paper, state.completion.raw_data);
                await window.ApiQuizReview.saveCompletionRawData(state.completion.id, regraded.rawData, regraded.nextScore);
                state.completion.raw_data = regraded.rawData;
            }

            let otherSummary = '';
            const all = await window.ApiQuizReview.fetchCompletionsForTask(state.assignmentId, state.taskId);
            const toSave = [];
            all.forEach(function (c) {
                if (state.completion && String(c.id) === String(state.completion.id)) return;
                if (!c.raw_data || !c.raw_data.quiz_answers) return;
                const r = window.QuizPaperBuilder.regradeCompletionRawData(state.paper, c.raw_data);
                if (r.changed) toSave.push({ id: c.id, student_id: c.student_id, rawData: r.rawData, score: r.nextScore });
            });
            if (toSave.length) {
                const result = await window.ApiQuizReview.batchSaveCompletions(toSave);
                otherSummary = '，並重新批改了其他 ' + result.okCount + ' 位學生的分數'
                    + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : '');
            }

            state.originalPaperJson = JSON.stringify(state.paper);
            window.showFlash && window.showFlash('✅ 已儲存批改結果' + otherSummary, 'success');
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(state.classId);
            }
            window.ModalOverlay.close(MODAL_ID);
        } catch (err) {
            console.error('[FeatureExamReview] save', err);
            window.alert('儲存失敗：' + (err.message || err));
        } finally {
            if (saveBtn) { saveBtn.disabled = false; }
        }
    }

    return {
        renderEntryButton: renderEntryButton,
        renderReviewPage: renderReviewPage,
        openReview: openReview,
        _openTaskStudentList: openTaskStudentList,
        _toggleShowWrongOnly: _toggleShowWrongOnly,
        _addAccepted: _addAccepted,
        _removeAccepted: _removeAccepted,
        _toggleAlsoCorrect: _toggleAlsoCorrect,
        _startEditPrimary: _startEditPrimary,
        _cancelEditPrimary: _cancelEditPrimary,
        _confirmEditPrimary: _confirmEditPrimary,
        _save: _save
    };
})();

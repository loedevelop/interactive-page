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

    function itemHeadline(item, displayNo) {
        if (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.formatItemHeadline === 'function') {
            return window.QuizPaperBuilder.formatItemHeadline(item, displayNo != null ? displayNo : (item && item.seq));
        }
        const seq = displayNo != null ? displayNo : (item && item.seq);
        return (seq != null && seq !== '') ? (String(seq) + '.') : '';
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

            // 沿用這裡已經抓好的 completions 算待審申訴數，不額外查詢（見 page-refresh-perf-invariant 精神）
            const pendingAppealCount = countPendingAppeals(completions);
            const appealBtnHtml = pendingAppealCount > 0
                ? '<button type="button" onclick="window.FeatureExamReview._openAppealReview(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" '
                    + 'style="width:100%; text-align:left; padding:10px 14px; margin-bottom:10px; border:1px solid #FDBA74; border-radius:10px; background:#FFF7ED; color:#B45309; font-weight:900; cursor:pointer;">'
                    + '🚩 ' + pendingAppealCount + ' 筆待審申訴</button>'
                : '';

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

            const body = '<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                + '<button type="button" onclick="window.FeatureExamReview.renderReviewPage(\'' + safeClassId + '\')" style="background:none; border:none; color:#6D28D9; font-weight:800; cursor:pointer; padding:0;">← 返回任務清單</button>'
                + '<button type="button" id="regrade-whole-task-btn" onclick="window.FeatureExamReview._regradeWholeTask(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" '
                    + 'style="padding:6px 12px; border:1px solid #0EA5E9; border-radius:6px; background:white; color:#0369A1; font-weight:800; cursor:pointer;" '
                    + 'title="依目前試卷範本重算標準答案（維持原題），再重批全班已交卷學生。">🔄 重新批閱本任務所有學生</button>'
                + '</div>'
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
        const onlyIds = opts.onlyCompletionIds ? opts.onlyCompletionIds.map(String) : null;
        const forceIds = opts.forceIds ? opts.forceIds.map(String) : [];
        const toSave = [];
        all.forEach(function (c) {
            if (onlyIds && onlyIds.indexOf(String(c.id)) === -1) return;
            const mutated = typeof opts.beforeRegrade === 'function' ? !!opts.beforeRegrade(c) : false;
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
            if (window.QuizPaperBuilder.isAcceptableAnswer(n, list)) correct += 1;
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
        return window.QuizPaperBuilder.isAcceptableAnswer(n, list);
    }

    function renderItemRow(idx) {
        const item = state.paper.items[idx];
        const got = state.answers[item.item_id];
        const hasAnswer = got != null && String(got).trim() !== '';
        const normGot = hasAnswer ? window.QuizPaperBuilder.normalizeAnswer(got) : '';
        const acceptedNorm = [item.answer_en].concat(item.accepted_answers || []).map(window.QuizPaperBuilder.normalizeAnswer);
        const isCorrect = hasAnswer && window.QuizPaperBuilder.isAcceptableAnswer(normGot, acceptedNorm);

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
            // 2026-08-13 老師要求先關掉「拼錯紀錄」：目前逐字對齊機制抓出來的拼錯配對還不夠
            // 準確、對老師來說沒有參考意義，先不顯示（renderAnswerDiffHtml 本身的上下對齊已經
            // 夠用），之後演算法夠準了再考慮恢復 renderSpellingPairsHtml。
            studentAnsHtml = window.QuizPaperBuilder.renderAnswerDiffHtml(best.diff.ops);
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
                + '<span>' + esc(itemHeadline(item, item.seq)) + '</span>' + statusBadge
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

    /**
     * 依目前試卷範本重算卷上標準答案、寫回作業，再回傳更新後的 paper。
     * 批改畫面的「重新批閱」必須走這條，否則只會對舊快照重算分、畫面標準答案不變。
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
        const result = await window.FeatureExamJob.refreshTaskPaperFromTemplate(task, classId, { forceRefreshMeta: true });
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
            window.alert('重新批閱失敗：' + (err.message || err));
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
                    studentName: (studentsById[String(c.student_id)] && studentsById[String(c.student_id)].name) || '未知學生'
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

    async function openAppealReview(classId, assignmentId, taskId) {
        window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('⏳ 載入申訴清單…') });
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
            const groups = buildAppealGroups(task.raw_data.quiz_paper, completions, studentsById);
            appealState = {
                classId: classId,
                assignmentId: assignmentId,
                taskId: taskId,
                taskTitle: task.title || task.raw_data.exam_title || '(未命名考試)',
                paper: task.raw_data.quiz_paper,
                groups: groups
            };
            renderAppealReviewHtml();
        } catch (err) {
            console.error('[FeatureExamReview] openAppealReview', err);
            window.ModalOverlay.open({ id: PAGE_MODAL_ID, tier: 'A', contentHtml: wrapPageShell('❌ 載入失敗：' + esc(err.message || err)) + closeFooterHtml(PAGE_MODAL_ID) });
        }
    }

    function renderAppealGroupHtml(group, idx) {
        const item = group.item;
        const promptHtml = item ? esc(item.prompt_zh || '') : '（找不到這一題，可能考卷已改版）';
        const primaryHtml = item
            ? '<span style="display:inline-block; padding:2px 8px; border-radius:6px; background:#EEF2FF; color:#3730A3; font-weight:800; font-size:0.82rem; margin-right:4px;">★ ' + esc(item.answer_en) + '</span>'
            : '';
        const acceptedHtml = item
            ? (item.accepted_answers || []).map(function (a) {
                return '<span style="display:inline-block; padding:2px 8px; border-radius:6px; background:#F0FDF4; color:#166534; font-weight:800; font-size:0.82rem; margin-right:4px;">' + esc(a) + '</span>';
            }).join('')
            : '';
        const studentNames = group.students.map(function (s) { return esc(s.studentName); }).join('、');
        const hint = whitelistHintForGroup(group);
        return '<div id="appeal-group-' + idx + '" style="border:1px solid #DDD6FE; border-radius:10px; padding:12px 14px; margin-bottom:10px; background:#FAF5FF;">'
            + '<div style="font-size:0.76rem; color:#7C3AED; font-weight:900; margin-bottom:4px;">' + esc(itemHeadline(item, item ? item.seq : '?')) + '　🚩 ' + group.students.length + ' 人申訴</div>'
            + '<div style="font-weight:800; color:#1E293B; margin-bottom:6px; white-space:pre-wrap;">' + promptHtml + '</div>'
            + '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:2px;">申訴內容</div>'
            + '<div style="font-size:1rem; font-weight:900; color:#B45309; margin-bottom:6px;">' + esc(group.answerText) + ' ' + hint + '</div>'
            + '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:2px;">目前標準答案</div>'
            + '<div style="margin-bottom:6px;">' + primaryHtml + acceptedHtml + '</div>'
            + '<div style="font-size:0.75rem; color:#94A3B8; margin-bottom:8px;">申訴學生：' + studentNames + '</div>'
            + '<div style="display:flex; gap:8px; flex-wrap:wrap;">'
                + '<button type="button" onclick="window.FeatureExamReview._decideAppeal(' + idx + ', \'accepted\')" style="padding:6px 12px; border:none; border-radius:6px; background:#059669; color:white; font-weight:800; cursor:pointer;">✅ 可接受</button>'
                + '<button type="button" onclick="window.FeatureExamReview._decideAppeal(' + idx + ', \'rejected\')" style="padding:6px 12px; border:1px solid #CBD5E1; border-radius:6px; background:white; color:#475569; font-weight:800; cursor:pointer;">❌ 不可接受</button>'
            + '</div>'
            + '<div style="display:flex; gap:6px; margin-top:8px;">'
                + '<input id="appeal-other-ans-' + idx + '" type="text" placeholder="輸入其他可接受答案（跟這組申訴決定互相獨立）…" style="flex:1; min-width:160px; padding:5px 8px; border:1px solid #CBD5E1; border-radius:6px; font-size:0.85rem;">'
                + '<button type="button" onclick="window.FeatureExamReview._addOtherAcceptedForGroup(' + idx + ')" style="padding:5px 12px; border:none; border-radius:6px; background:#0EA5E9; color:white; font-weight:800; cursor:pointer; white-space:nowrap;">+ 新增其他可接受答案</button>'
            + '</div>'
            + '</div>';
    }

    function renderAppealReviewHtml() {
        const safeClassId = String(appealState.classId).replace(/'/g, "\\'");
        const safeAssignId = String(appealState.assignmentId).replace(/'/g, "\\'");
        const safeTaskId = String(appealState.taskId).replace(/'/g, "\\'");
        const groupsHtml = appealState.groups.length
            ? appealState.groups.map(function (g, idx) { return renderAppealGroupHtml(g, idx); }).join('')
            : '<div style="padding:20px; text-align:center; color:#94A3B8; font-weight:700;">目前沒有待審申訴。</div>';
        const body = '<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
                + '<button type="button" onclick="window.FeatureExamReview._openTaskStudentList(\'' + safeClassId + '\', \'' + safeAssignId + '\', \'' + safeTaskId + '\')" style="background:none; border:none; color:#6D28D9; font-weight:800; cursor:pointer; padding:0;">← 返回學生清單</button>'
                + '<button type="button" onclick="window.FeatureExamReview._regradeWholeTaskFromAppealReview()" style="padding:6px 12px; border:1px solid #0EA5E9; border-radius:6px; background:white; color:#0369A1; font-weight:800; cursor:pointer;">🔄 重新批閱本任務所有學生</button>'
            + '</div>'
            + '<div style="font-size:0.8rem; color:#64748B; font-weight:700; margin-bottom:10px;">' + esc(appealState.taskTitle) + '</div>'
            + groupsHtml;
        window.ModalOverlay.open({
            id: PAGE_MODAL_ID,
            tier: 'A',
            contentHtml: wrapPageShell(body) + closeFooterHtml(PAGE_MODAL_ID)
        });
    }

    async function _decideAppeal(idx, decision) {
        if (!appealState) return;
        const group = appealState.groups[idx];
        if (!group) return;
        if (decision === 'accepted' && !group.item) {
            window.alert('找不到這一題（可能考卷已改版），無法接受這個申訴');
            return;
        }
        try {
            if (decision === 'accepted') {
                window.QuizPaperBuilder.addAcceptedAnswer(group.item, group.answerText);
                await window.ApiQuizReview.saveQuizPaperPatch(appealState.assignmentId, appealState.taskId, appealState.paper);
            }
            const itemId = group.itemId;
            const answerNorm = group.answerNorm;
            await regradeAndSaveTask(appealState.assignmentId, appealState.taskId, appealState.paper, {
                beforeRegrade: function (c) {
                    const list = Array.isArray(c.raw_data && c.raw_data.quiz_appeals) ? c.raw_data.quiz_appeals : null;
                    if (!list) return false;
                    let mutated = false;
                    list.forEach(function (a) {
                        if (a && a.status === 'pending' && String(a.item_id) === String(itemId)
                            && window.QuizPaperBuilder.normalizeAnswer(a.answer) === answerNorm) {
                            a.status = decision;
                            mutated = true;
                        }
                    });
                    return mutated;
                }
            });
            window.showFlash && window.showFlash(
                decision === 'accepted' ? '✅ 已接受申訴，全班同任務已重新批改' : '已標記為不可接受',
                'success'
            );
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(appealState.classId);
            }
            await openAppealReview(appealState.classId, appealState.assignmentId, appealState.taskId);
        } catch (err) {
            console.error('[FeatureExamReview] decideAppeal', err);
            window.alert('處理申訴失敗：' + (err.message || err));
        }
    }

    /**
     * 「+ 新增其他可接受答案」跟這組申訴決定互相獨立：不會動任何申訴的 status，
     * 純粹是老師/助教想到還有其他寫法也該算對時的捷徑。
     */
    async function _addOtherAcceptedForGroup(idx) {
        if (!appealState) return;
        const group = appealState.groups[idx];
        if (!group || !group.item) return;
        const input = document.getElementById('appeal-other-ans-' + idx);
        const val = input ? input.value : '';
        if (!val || !val.trim()) return;
        const changed = window.QuizPaperBuilder.addAcceptedAnswer(group.item, val);
        if (!changed) {
            window.showFlash && window.showFlash('這個答案已經在標準答案裡了', 'warning');
            return;
        }
        try {
            await window.ApiQuizReview.saveQuizPaperPatch(appealState.assignmentId, appealState.taskId, appealState.paper);
            await regradeAndSaveTask(appealState.assignmentId, appealState.taskId, appealState.paper, {});
            window.showFlash && window.showFlash('✅ 已新增可接受答案並重新批改', 'success');
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(appealState.classId);
            }
            await openAppealReview(appealState.classId, appealState.assignmentId, appealState.taskId);
        } catch (err) {
            console.error('[FeatureExamReview] addOtherAcceptedForGroup', err);
            window.alert('新增失敗：' + (err.message || err));
        }
    }

    /**
     * 「考試批改」學生清單頁的通用「重新批閱本任務所有學生」。
     * 先依目前試卷範本重算標準答案（維持原題），再重批全班；不必先「產生試卷」。
     */
    async function _regradeWholeTask(classId, assignmentId, taskId) {
        const btn = document.getElementById('regrade-whole-task-btn');
        try {
            if (btn) { btn.disabled = true; btn.textContent = '重新批閱中…'; }
            const refreshed = await refreshPaperAnswersFromTemplate(assignmentId, taskId, classId);
            const result = await regradeAndSaveTask(assignmentId, taskId, refreshed.paper, { forceAll: true });
            window.showFlash && window.showFlash('✅ 已依試卷範本更新標準答案並重新批閱 ' + (result.savedIds || []).length + ' 位學生'
                + (refreshed.missing ? '（' + refreshed.missing + ' 題對不到 meta）' : '')
                + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : ''),
                (refreshed.missing || result.failCount) ? 'warning' : 'success');
            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(classId);
            }
            await openTaskStudentList(classId, assignmentId, taskId);
        } catch (err) {
            console.error('[FeatureExamReview] regradeWholeTask', err);
            window.alert('重新批閱失敗：' + (err.message || err));
            if (btn) { btn.disabled = false; btn.textContent = '🔄 重新批閱本任務所有學生'; }
        }
    }

    async function _regradeWholeTaskFromAppealReview() {
        if (!appealState) return;
        try {
            window.showFlash && window.showFlash('重新批閱中…', 'info');
            const result = await regradeAndSaveTask(appealState.assignmentId, appealState.taskId, appealState.paper, { forceAll: true });
            window.showFlash && window.showFlash('✅ 已重新批閱 ' + (result.savedIds || []).length + ' 位學生'
                + (result.failCount ? '（' + result.failCount + ' 位寫入失敗，請重試）' : ''), 'success');
        } catch (err) {
            console.error('[FeatureExamReview] regradeWholeTaskFromAppealReview', err);
            window.alert('重新批閱失敗：' + (err.message || err));
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
        _removeAccepted: _removeAccepted,
        _toggleAlsoCorrect: _toggleAlsoCorrect,
        _startEditPrimary: _startEditPrimary,
        _cancelEditPrimary: _cancelEditPrimary,
        _confirmEditPrimary: _confirmEditPrimary,
        _save: _save,
        _regradeThisStudent: _regradeThisStudent,
        _openAppealReview: openAppealReview,
        _decideAppeal: _decideAppeal,
        _addOtherAcceptedForGroup: _addOtherAcceptedForGroup,
        _regradeWholeTaskFromAppealReview: _regradeWholeTaskFromAppealReview
    };
})();

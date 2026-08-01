/**
 * 📂 120_student_core/feature-student-quiz.js
 * 學生端線上卷：作答、對答案、寫入 task_completions
 */
window.FeatureStudentQuiz = (function () {
    'use strict';

    const MODAL_ID = 'student-quiz-paper';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function renderItemRow(it, prevAnswer) {
        const prompt = it.prompt_zh || (it.cells && it.cells[1] && it.cells[1].text) || '';
        const stack = (it.cells && it.cells[0] && it.cells[0].text) || '';
        const fontDelta = (it.cells && it.cells[1] && it.cells[1].fontDelta) || 0;
        const fontSize = Math.max(0.75, 1 + (fontDelta * 0.08));
        const cloze = it.quiz_mode === 'cloze' && it.cloze_stem
            ? '<div style="margin-top:4px; color:#0F766E; font-weight:700; white-space:pre-wrap;">' + esc(it.cloze_stem) + '</div>'
            : '';
        return (
            '<div data-quiz-item="' + esc(it.item_id) + '" style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:10px; background:#F8FAFC;">' +
                '<div style="font-size:0.75rem; color:#64748B; font-weight:800; margin-bottom:4px;">#' + esc(it.seq) +
                    (stack ? (' · <span style="white-space:pre-line;">' + esc(stack) + '</span>') : '') +
                '</div>' +
                '<div style="font-size:' + fontSize + 'rem; font-weight:800; color:#1E293B; white-space:pre-wrap;">' + esc(prompt) + '</div>' +
                cloze +
                '<input class="form-control quiz-answer-input" data-item-id="' + esc(it.item_id) + '" ' +
                    'placeholder="請輸入英文答案" value="' + esc(prevAnswer || '') + '" ' +
                    'style="width:100%; margin-top:8px; padding:8px 10px; border:1px solid #CBD5E1; border-radius:8px; font-size:0.95rem;">' +
            '</div>'
        );
    }

    function collectAnswers() {
        const map = {};
        document.querySelectorAll('#' + MODAL_ID + '-body .quiz-answer-input').forEach(function (el) {
            const id = el.getAttribute('data-item-id');
            if (id) map[id] = el.value;
        });
        return map;
    }

    async function getAuthContext() {
        const session = JSON.parse(localStorage.getItem('LogOnEnglish_Session') || '{}');
        const userId = session.id || session.user_id;
        let classId = sessionStorage.getItem('currentClassId') || '';
        if (!classId && window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getCurrentClassConfig === 'function') {
            const cfg = window.FeatureStudentTimeline.getCurrentClassConfig();
            classId = (cfg && (cfg.id || cfg.class_id)) || '';
        }
        if (!userId) throw new Error('尚未登入');
        if (!classId) throw new Error('找不到班級');
        return { userId: userId, classId: classId };
    }

    async function persistResult(assignmentId, taskId, rawPayload, completed) {
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        const auth = await getAuthContext();
        const { error: rpcErr } = await window.supabaseClient.rpc('student_set_task_completion', {
            p_assignment_id: assignmentId,
            p_task_id: taskId,
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
                task_id: taskId,
                student_id: auth.userId,
                class_id: auth.classId,
                status: completed ? 'completed' : 'submitted',
                deleted_at: null,
                raw_data: rawPayload
            };
            const { data: updatedRows, error: updateErr } = await window.supabaseClient.from('task_completions')
                .update(payload)
                .eq('task_id', taskId)
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
    }

    function openQuiz(assignmentId, taskId) {
        const task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        const paper = getPaper(task);
        if (!paper || !Array.isArray(paper.items) || !paper.items.length) {
            return window.showFlash('老師尚未產生線上卷（請先按「產生線上卷」並儲存作業）', 'warning');
        }

        let prevAnswers = {};
        let prevScoreHtml = '';
        const comps = window._studentTaskCompletions || [];
        const prev = comps.find(function (c) {
            return String(c.task_id) === String(taskId) && String(c.assignment_id) === String(assignmentId);
        });
        if (prev && prev.raw_data) {
            if (prev.raw_data.quiz_answers) prevAnswers = prev.raw_data.quiz_answers;
            if (prev.raw_data.quiz_result) {
                const r = prev.raw_data.quiz_result;
                prevScoreHtml = '<div style="margin-bottom:10px; padding:8px 10px; background:#ECFDF5; border:1px solid #A7F3D0; border-radius:8px; color:#047857; font-weight:800; font-size:0.85rem;">上次成績：'
                    + esc(r.correct) + ' / ' + esc(r.total) + '（' + esc(r.score) + '%）</div>';
            }
        }

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
            isDirty: function () { return true; },
            unsavedMessage: '作答尚未繳交，確定關閉？',
            contentHtml:
                '<div style="max-width:720px; width:92vw; background:white; border-radius:14px; padding:18px 18px 14px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.15rem; font-weight:900; color:#0F766E;">📝 ' + esc(title) + '</h3>' +
                        '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')">關閉</button>' +
                    '</div>' +
                    prevScoreHtml +
                    '<div style="font-size:0.8rem; color:#64748B; margin-bottom:10px;">共 ' + paper.items.length + ' 題 · 送出後自動對答案計分</div>' +
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
        const rawPayload = {
            quiz_answers: answers,
            quiz_result: {
                score: result.score,
                correct: result.correct,
                total: result.total,
                details: result.details,
                graded_at: new Date().toISOString()
            }
        };

        try {
            await persistResult(assignmentId, taskId, rawPayload, true);
            if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
            window.showFlash('已繳交：' + result.correct + ' / ' + result.total + '（' + result.score + '%）', 'success');
            window.location.reload();
        } catch (err) {
            console.error('[FeatureStudentQuiz] submit', err);
            window.showFlash('繳交失敗：' + (err.message || err), 'error');
        }
    }

    return {
        openQuiz: openQuiz,
        submit: submit,
        getPaper: getPaper
    };
})();

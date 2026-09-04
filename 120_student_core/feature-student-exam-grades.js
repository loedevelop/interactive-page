/**
 * 📂 120_student_core/feature-student-exam-grades.js
 * 學生端「考試成績」活頁：列出本班所有考試任務的成績。
 * 只在 switchView('exam-grades') 才 render（page-refresh-perf）。
 * 資料沿用 FeatureStudentTimeline 已載入的作業／作答，不另打 API。
 *
 * 套餐／範圍只讀作業裡已存的 combo_label、material_range、title，不准現場組字。
 * 線上考對錯走 QuizPaperBuilder.gradeAnswers（含已接受申訴）；PDF 考讀 pdf_quiz_result。
 */
window.FeatureStudentExamGrades = (function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function stripHtml(s) {
        return String(s == null ? '' : s).replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
    }

    function dateKey(value) {
        if (window.UtilsDate && typeof window.UtilsDate.normalizeDateString === 'function') {
            return String(window.UtilsDate.normalizeDateString(value) || '').trim();
        }
        const s = String(value == null ? '' : value).trim();
        const m = s.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
    }

    function formatDurationMs(ms) {
        const n = Math.max(0, Math.floor(Number(ms) || 0));
        if (!n) return '';
        const totalSec = Math.round(n / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        if (m > 0) return m + ' 分' + (s ? (' ' + s + ' 秒') : '');
        return s + ' 秒';
    }

    function parseTasks(raw) {
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_e) { return []; }
        }
        return [];
    }

    function walkExamTasks(assignments) {
        const out = [];
        const U = window.UtilsDate;
        (assignments || []).forEach(function (assignment) {
            if (U && typeof U.canStudentSeeAssignment === 'function' && !U.canStudentSeeAssignment(assignment)) return;
            function walk(list, parentOpen) {
                (list || []).forEach(function (task) {
                    if (!task) return;
                    const eff = U && typeof U.inheritStamp === 'function'
                        ? U.inheritStamp(task.open_at, parentOpen)
                        : (task.open_at || parentOpen);
                    if (U && typeof U.isOpenYet === 'function' && !U.isOpenYet(eff)) return;
                    if (task.type === 'group' && Array.isArray(task.subTasks)) {
                        walk(task.subTasks, eff);
                        return;
                    }
                    if (task.type === 'exam' || task.type === 'pdf_exam') {
                        out.push({ assignment: assignment, task: task });
                    }
                });
            }
            walk(parseTasks(assignment && assignment.tasks), assignment && assignment.open_at);
        });
        return out;
    }

    function addStoredLabel(names, seen, value) {
        const text = String(value == null ? '' : value).trim();
        if (!text || seen[text]) return;
        seen[text] = true;
        names.push(text);
    }

    /** 只讀已存 combo_label，不准 comboLabelText／現場組名。 */
    function storedComboLabels(task) {
        const names = [];
        const seen = {};
        const raw = (task && task.raw_data) || {};
        addStoredLabel(names, seen, raw.combo_label || raw.comboLabel);
        addStoredLabel(names, seen, raw.pack_combo_label);
        (raw.pack_rows || []).forEach(function (row) {
            addStoredLabel(names, seen, row && (row.combo_label || row.comboLabel));
        });
        const job = raw.exam_job || {};
        (job.sections || []).forEach(function (sec) {
            if (!sec) return;
            addStoredLabel(names, seen, sec.combo_label || sec.comboLabel);
            (sec.rows || []).forEach(function (row) {
                addStoredLabel(names, seen, row && (row.combo_label || row.comboLabel));
            });
        });
        const paper = raw.quiz_paper || {};
        (paper.sections || []).forEach(function (sec) {
            addStoredLabel(names, seen, sec && (sec.combo_label || sec.comboLabel));
        });
        (paper.items || []).forEach(function (it) {
            addStoredLabel(names, seen, it && (it.combo_label || it.comboLabel));
            addStoredLabel(names, seen, it && it.source && (it.source.combo_label || it.source.comboLabel));
        });
        const pdfJob = raw.pdf_exam_job || {};
        addStoredLabel(names, seen, pdfJob.combo_label || pdfJob.comboLabel);
        return names;
    }

    /** 只讀已存 material_range／title。 */
    function storedRange(task) {
        const raw = (task && task.raw_data) || {};
        const range = String(raw.material_range || '').trim();
        if (range) return range;
        return stripHtml(task.title || raw.exam_title || '');
    }

    function findCompletion(assignmentId, taskId) {
        const list = window._studentTaskCompletions || [];
        return list.find(function (c) {
            return String(c.assignment_id) === String(assignmentId) && String(c.task_id) === String(taskId);
        }) || null;
    }

    function parseRaw(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try { return JSON.parse(raw) || {}; } catch (_e) { return {}; }
        }
        return raw;
    }

    function acceptedAppealCount(raw) {
        const list = (window.QuizPaperBuilder && typeof window.QuizPaperBuilder.readQuizAppeals === 'function')
            ? window.QuizPaperBuilder.readQuizAppeals(raw)
            : (Array.isArray(raw && raw.quiz_appeals) ? raw.quiz_appeals : []);
        let n = 0;
        list.forEach(function (a) {
            if (a && String(a.status || '').trim().toLowerCase() === 'accepted') n += 1;
        });
        return n;
    }

    function formatWhen(iso) {
        const s = String(iso == null ? '' : iso).trim();
        if (!s) return '';
        return s.replace('T', ' ').slice(0, 16);
    }

    /** 已交卷才算分。有作答＋paper 就現場重算（申訴成功計入），否則讀凍結 quiz_result。 */
    function onlineGrade(task, raw) {
        const submitted = !!(raw && (
            (raw.quiz_result && raw.quiz_result.total != null)
            || (raw.quiz_stats && Number(raw.quiz_stats.complete_count) > 0)
        ));
        if (!submitted) return null;
        const paper = task && task.raw_data && task.raw_data.quiz_paper;
        if (paper && raw && raw.quiz_answers && window.QuizPaperBuilder
            && typeof window.QuizPaperBuilder.gradeAnswers === 'function') {
            return window.QuizPaperBuilder.gradeAnswers(paper, raw.quiz_answers, raw);
        }
        return raw && raw.quiz_result ? raw.quiz_result : null;
    }

    function paperItemCount(task) {
        const paper = task && task.raw_data && task.raw_data.quiz_paper;
        return paper && Array.isArray(paper.items) ? paper.items.length : 0;
    }

    function pdfReady(task) {
        const job = task && task.raw_data && task.raw_data.pdf_exam_job;
        if (!job || !job.pdf_file_id) return false;
        const bank = Array.isArray(job.parsed_bank) ? job.parsed_bank : [];
        return bank.some(function (it) { return it && it.key; });
    }

    function scoreColor(score) {
        const n = Number(score);
        if (!(n >= 0)) return '#94A3B8';
        if (n >= 80) return '#047857';
        if (n >= 50) return '#B45309';
        return '#B91C1C';
    }

    function buildRow(entry) {
        const assignment = entry.assignment;
        const task = entry.task;
        const kind = task.type === 'pdf_exam' ? 'pdf' : 'online';
        const completion = findCompletion(assignment.id, task.id);
        const raw = parseRaw(completion && completion.raw_data);
        const combos = storedComboLabels(task);
        const range = storedRange(task);
        const examDate = dateKey(assignment.target_date);
        const dueDate = (window.UtilsDate && typeof window.UtilsDate.formatStampLabel === 'function')
            ? window.UtilsDate.formatStampLabel(assignment.due_date)
            : dateKey(assignment.due_date);
        const practiceOn = !!(task.raw_data && task.raw_data.input_practice_enabled);

        let correct = null;
        let total = null;
        let score = null;
        let status = '尚未作答';
        let durationMs = 0;
        let appealN = 0;
        let retakeCombined = null;
        let retakePending = false;
        let action = '';
        let kindLabel = kind === 'pdf' ? 'PDF 考卷' : '線上考試';
        let extras = [];
        let scoreIsPractice = false;
        let submittedAt = '';
        let completeCount = 0;
        let pdfProgress = '';

        if (kind === 'pdf') {
            if (!pdfReady(task)) {
                status = '尚未設定';
            } else {
                const pdf = raw.pdf_quiz_result;
                if (pdf && pdf.all_submitted === false) {
                    status = '作答中';
                    action = 'continue-pdf';
                    if (pdf.total_sections != null) {
                        pdfProgress = (pdf.submitted_sections || 0) + '/' + pdf.total_sections + ' 大題';
                    }
                } else if (pdf && pdf.total != null) {
                    status = '已交卷';
                    correct = Number(pdf.correct) || 0;
                    total = Number(pdf.total) || 0;
                    score = pdf.score;
                    action = 'review-pdf';
                    submittedAt = formatWhen(pdf.graded_at);
                } else {
                    action = 'start-pdf';
                }
            }
        } else if (practiceOn && window.FeatureStudentQuiz
            && typeof window.FeatureStudentQuiz.getInputPracticeSummary === 'function') {
            kindLabel = '輸入練習';
            const itemN = paperItemCount(task);
            if (!itemN) {
                status = '尚未出卷';
            } else {
                const summary = window.FeatureStudentQuiz.getInputPracticeSummary(assignment.id, task.id);
                if (summary && summary.total) {
                    correct = Number(summary.done) || 0;
                    total = Number(summary.total) || 0;
                    scoreIsPractice = true;
                    status = summary.allDone ? '練習完成' : (correct > 0 ? '練習中' : '尚未作答');
                    durationMs = Number(summary.total_time_ms || summary.last_duration_ms || 0);
                }
                action = 'practice';
            }
        } else {
            const itemN = paperItemCount(task);
            if (!itemN) {
                status = '尚未出卷';
            } else {
                const graded = onlineGrade(task, raw);
                appealN = acceptedAppealCount(raw);
                durationMs = Number((raw.quiz_result && raw.quiz_result.duration_ms)
                    || (raw.quiz_stats && raw.quiz_stats.last_duration_ms) || 0);
                completeCount = Number((raw.quiz_stats && raw.quiz_stats.complete_count)
                    || (raw.quiz_result && raw.quiz_result.complete_count) || 0);
                submittedAt = formatWhen(raw.quiz_result && raw.quiz_result.graded_at);
                if (graded && graded.total != null) {
                    status = '已交卷';
                    correct = Number(graded.correct) || 0;
                    total = Number(graded.total) || 0;
                    score = graded.score;
                    action = 'review-online';
                } else {
                    action = 'start-online';
                }
                const retake = raw.quiz_retake;
                if (retake && retake.done && retake.combined) retakeCombined = retake.combined;
                else if (retake && !retake.done && Array.isArray(retake.item_ids) && retake.item_ids.length) {
                    retakePending = true;
                }
            }
        }

        if (appealN > 0) extras.push('申訴成功 ' + appealN + ' 題');
        if (retakeCombined && retakeCombined.total) {
            extras.push('重考後 ' + retakeCombined.correct + '/' + retakeCombined.total
                + '（' + retakeCombined.rate + '%）');
        }
        if (retakePending) extras.push('待重考錯題');
        if (completeCount > 1) extras.push('已作答 ' + completeCount + ' 次');
        if (durationMs > 0) extras.push('本次 ' + formatDurationMs(durationMs));
        if (submittedAt) extras.push('繳交 ' + submittedAt);
        if (pdfProgress) extras.push('已交 ' + pdfProgress);

        return {
            assignmentId: assignment.id,
            taskId: task.id,
            kind: kind,
            examDate: examDate,
            dueDate: dueDate,
            combos: combos,
            range: range,
            correct: correct,
            total: total,
            score: score,
            status: status,
            durationMs: durationMs,
            appealN: appealN,
            retakeCombined: retakeCombined,
            action: action,
            sortDate: examDate || dueDate || '',
            kindLabel: kindLabel,
            extras: extras,
            scoreIsPractice: scoreIsPractice
        };
    }

    function sortRows(rows) {
        return rows.slice().sort(function (a, b) {
            if (a.sortDate && b.sortDate && a.sortDate !== b.sortDate) return b.sortDate.localeCompare(a.sortDate);
            if (b.sortDate && !a.sortDate) return 1;
            if (a.sortDate && !b.sortDate) return -1;
            return String(a.range || '').localeCompare(String(b.range || ''), 'zh-Hant');
        });
    }

    function actionLabel(row) {
        if (row.action === 'review-online' || row.action === 'review-pdf') return '作答結果';
        if (row.action === 'continue-pdf') return '繼續作答';
        if (row.action === 'practice') return '輸入練習';
        if (row.action === 'start-online' || row.action === 'start-pdf') return '開始作答';
        return '';
    }

    function renderCard(row) {
        const comboText = row.combos.length ? row.combos.join('、') : '—';
        const rangeText = row.range || '—';
        const dateText = row.examDate || '—';
        const ratioKey = row.scoreIsPractice ? '進度' : '對錯';
        const scoreKey = row.scoreIsPractice ? '完成' : '分數';
        let ratioHtml = '<span class="exam-grade-empty">—</span>';
        let scoreHtml = '<span class="exam-grade-empty">—</span>';
        if (row.total != null && row.total > 0 && row.correct != null) {
            if (row.scoreIsPractice) {
                ratioHtml = esc(row.correct) + '/' + esc(row.total) + ' 題';
            } else {
                const wrong = Math.max(0, row.total - row.correct);
                ratioHtml = '對 ' + esc(row.correct) + '　錯 ' + esc(wrong)
                    + '　<span class="exam-grade-muted">(' + esc(row.correct) + '/' + esc(row.total) + ')</span>';
                scoreHtml = '<span class="exam-grade-score" style="color:' + scoreColor(row.score) + ';">'
                    + esc(row.score) + '%</span>';
            }
        }
        const extraHtml = (row.extras && row.extras.length)
            ? '<div class="exam-grade-extra">' + esc(row.extras.join('　')) + '</div>'
            : '';
        const btnLabel = actionLabel(row);
        const btnClass = (row.action === 'review-online' || row.action === 'review-pdf')
            ? 'task-btn task-btn--ghost exam-grade-btn'
            : 'task-btn exam-grade-btn';
        const btnHtml = btnLabel
            ? ('<button type="button" class="' + btnClass + '" data-exam-grade-action="' + esc(row.action)
                + '" data-assignment-id="' + esc(row.assignmentId) + '" data-task-id="' + esc(row.taskId) + '">'
                + esc(btnLabel) + '</button>')
            : '';
        const dueHtml = (row.dueDate && row.dueDate !== row.examDate)
            ? '<span class="exam-grade-due">截止 ' + esc(row.dueDate) + '</span>'
            : '';
        return '<article class="exam-grade-card">'
            + '<div class="exam-grade-head">'
                + '<div class="exam-grade-date">' + esc(dateText) + dueHtml + '</div>'
                + '<div class="exam-grade-meta">'
                    + '<span class="exam-grade-kind">' + esc(row.kindLabel) + '</span>'
                    + '<span class="exam-grade-status">' + esc(row.status) + '</span>'
                + '</div>'
            + '</div>'
            + '<div class="exam-grade-grid">'
                + '<div><span class="exam-grade-k">套餐</span><span class="exam-grade-v">' + esc(comboText) + '</span></div>'
                + '<div><span class="exam-grade-k">範圍</span><span class="exam-grade-v">' + esc(rangeText) + '</span></div>'
                + '<div><span class="exam-grade-k">' + ratioKey + '</span><span class="exam-grade-v">' + ratioHtml + '</span></div>'
                + '<div><span class="exam-grade-k">' + scoreKey + '</span><span class="exam-grade-v">' + scoreHtml + '</span></div>'
            + '</div>'
            + extraHtml
            + (btnHtml ? '<div class="exam-grade-actions">' + btnHtml + '</div>' : '')
            + '</article>';
    }

    function runAction(action, assignmentId, taskId) {
        if (action === 'review-online' && window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.openReviewFromRaw === 'function') {
            window.FeatureStudentQuiz.openReviewFromRaw(assignmentId, taskId);
            return;
        }
        if (action === 'start-online' && window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.openQuiz === 'function') {
            window.FeatureStudentQuiz.openQuiz(assignmentId, taskId);
            return;
        }
        if (action === 'practice' && window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.openInputPractice === 'function') {
            window.FeatureStudentQuiz.openInputPractice(assignmentId, taskId);
            return;
        }
        if ((action === 'review-pdf' || action === 'continue-pdf' || action === 'start-pdf')
            && window.FeatureStudentPdfQuiz) {
            if (action === 'review-pdf' && typeof window.FeatureStudentPdfQuiz.openPastResult === 'function') {
                window.FeatureStudentPdfQuiz.openPastResult(assignmentId, taskId);
                return;
            }
            if (typeof window.FeatureStudentPdfQuiz.openQuiz === 'function') {
                window.FeatureStudentPdfQuiz.openQuiz(assignmentId, taskId);
            }
        }
    }

    function bind(container) {
        container.onclick = function (e) {
            const btn = e.target && e.target.closest ? e.target.closest('[data-exam-grade-action]') : null;
            if (!btn) return;
            runAction(
                btn.getAttribute('data-exam-grade-action'),
                btn.getAttribute('data-assignment-id'),
                btn.getAttribute('data-task-id')
            );
        };
    }

    function render() {
        const container = document.getElementById('exam-grades-container');
        if (!container) return;
        const assignments = (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAssignments === 'function')
            ? window.FeatureStudentTimeline.getAssignments()
            : [];
        const rows = sortRows(walkExamTasks(assignments).map(buildRow));
        if (!rows.length) {
            container.innerHTML = '<div class="std-card" style="text-align:center;">目前沒有考試</div>';
            return;
        }
        container.innerHTML = '<div class="exam-grades-list">' + rows.map(renderCard).join('') + '</div>';
        bind(container);
    }

    return { render: render };
})();

/**
 * 📂 110_teacher_core/store-gradebook.js
 * 🎯 職責：老師端批改中樞的記憶體狀態機
 */
window.GradebookStore = (function() {
    'use strict';

    let _state = { matrixData: [], assignments: [], activeContext: null };

    function initMatrix(matrixData, assignments) {
        _state.matrixData = matrixData || [];
        _state.assignments = assignments || [];
    }

    function getMatrixState() { return { matrixData: _state.matrixData, assignments: _state.assignments }; }

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') { try { return JSON.parse(data); } catch(e) { return {}; } }
        return data;
    }

    function setActiveSubmission(submission, studentName, defectBank) {
        const raw = parseJSONB(submission?.raw_data);
        const override = raw.teacher_override || {};
        const aiEval = raw.ai_evaluation || {};

        // 🌟 第 2 點：AI 總分平均公式計算
        let defaultScore = null;
        if (override.final_score !== undefined && override.final_score !== null) {
            defaultScore = override.final_score;
        } else if (aiEval.pronunciation_score && aiEval.fluency_score) {
            defaultScore = Math.round((Number(aiEval.pronunciation_score) + Number(aiEval.fluency_score)) / 2);
        } else {
            defaultScore = aiEval.pronunciation_score || null;
        }

        _state.activeContext = {
            submission: submission,
            studentName: studentName || '未知學生',
            defectBank: defectBank || {},
            gradingHistory: Array.isArray(raw.grading_history) ? raw.grading_history : [], // 🌟 載入歷史
            draft: {
                final_score: defaultScore,
                manual_feedback: override.manual_feedback || '',
                manual_defects_added: Array.isArray(override.manual_defects_added) ? [...override.manual_defects_added] : [],
                ai_defects_removed: Array.isArray(override.ai_defects_removed) ? [...override.ai_defects_removed] : []
            }
        };
    }

    function getActiveContext() { return _state.activeContext; }

    function toggleManualDefect(word) {
        if (!_state.activeContext) return;
        const cleanWord = word.toLowerCase().replace(/[^a-z']/g, '');
        if (!cleanWord) return;
        const draft = _state.activeContext.draft;
        const idx = draft.manual_defects_added.indexOf(cleanWord);
        if (idx > -1) draft.manual_defects_added.splice(idx, 1);
        else draft.manual_defects_added.push(cleanWord);
    }

    function toggleAiDefectRemoval(word) {
        if (!_state.activeContext) return;
        const cleanWord = word.toLowerCase().replace(/[^a-z']/g, '');
        if (!cleanWord) return;
        const draft = _state.activeContext.draft;
        const idx = draft.ai_defects_removed.indexOf(cleanWord);
        if (idx > -1) draft.ai_defects_removed.splice(idx, 1);
        else draft.ai_defects_removed.push(cleanWord);
    }

    function updateDraftScore(score) {
        if (_state.activeContext) _state.activeContext.draft.final_score = (score === '' || score === null) ? null : Number(score);
    }

    function updateDraftFeedback(feedback) {
        if (_state.activeContext) _state.activeContext.draft.manual_feedback = feedback || '';
    }

    function generateSavePayload() {
        if (!_state.activeContext || !_state.activeContext.submission) return null;
        const ctx = _state.activeContext;
        const sub = ctx.submission;
        const newRawData = parseJSONB(sub.raw_data);
        const timestamp = new Date().toISOString();
        
        // 🌟 第 4 點：抓取當前批改者名稱，寫入歷史軌跡
        let graderName = '教師';
        try {
            const sessionStr = localStorage.getItem('LogOnEnglish_Session');
            if (sessionStr) {
                const session = JSON.parse(sessionStr);
                graderName = session.name || session.email || '教師';
            }
        } catch(e) {}

        const history = Array.isArray(newRawData.grading_history) ? newRawData.grading_history : [];
        history.unshift({
            grader: graderName,
            score: ctx.draft.final_score,
            feedback: ctx.draft.manual_feedback,
            timestamp: timestamp
        });

        newRawData.grading_history = history;
        newRawData.teacher_override = {
            final_score: ctx.draft.final_score,
            manual_feedback: ctx.draft.manual_feedback,
            manual_defects_added: ctx.draft.manual_defects_added,
            ai_defects_removed: ctx.draft.ai_defects_removed,
            overridden_at: timestamp
        };

        const newDefectBank = JSON.parse(JSON.stringify(ctx.defectBank || {}));
        ctx.draft.manual_defects_added.forEach(w => { newDefectBank[w] = (newDefectBank[w] || 0) + 1; });
        const aiErrors = newRawData.ai_evaluation?.word_errors || [];
        aiErrors.forEach(e => {
            const cw = (e.word || '').toLowerCase().replace(/[^a-z']/g, '');
            if (cw && !ctx.draft.ai_defects_removed.includes(cw)) newDefectBank[cw] = (newDefectBank[cw] || 0) + 1;
        });

        return {
            submission_id: sub.id, user_id: sub.user_id || sub.student_id, 
            score_to_update: ctx.draft.final_score, raw_data_to_patch: newRawData, defect_bank_to_patch: newDefectBank
        };
    }

    return { initMatrix, getMatrixState, setActiveSubmission, getActiveContext, toggleManualDefect, toggleAiDefectRemoval, updateDraftScore, updateDraftFeedback, generateSavePayload };
})();
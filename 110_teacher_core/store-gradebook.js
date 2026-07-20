/**
 * 📂 110_teacher_core/store-gradebook.js
 * 🎯 職責：老師端批改中樞的記憶體狀態機 (Tier 3 State Brain)
 */
window.GradebookStore = (function() {
    'use strict';

    let _state = {
        matrixData: [],
        assignments: [],
        activeContext: null // { submission, taskMeta, role, draft, defectBank }
    };

    // ⚡ 評語模句庫
    const COMMENT_BANK = [
        "發音非常清晰！", "注意母音飽滿度", "連音不夠自然", "語調抓得很好", "重音位置需微調"
    ];

    function initMatrix(matrixData, assignments) {
        _state.matrixData = matrixData || [];
        _state.assignments = assignments || [];
    }

    function getMatrixState() { return { matrixData: _state.matrixData, assignments: _state.assignments }; }
    function getCommentBank() { return COMMENT_BANK; }

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch(e) { return {}; }
        }
        return data;
    }

    function setActiveSubmission(submission, taskMeta, defectBank, currentRole) {
        const raw = parseJSONB(submission?.raw_data);
        const override = raw.teacher_override || {};
        const aiEval = raw.ai_evaluation || {};

        // 分數採用嚴格優先順序：教師 > 助教 > 舊版定案 > AI
        let currentScore = aiEval.pronunciation_score || null;
        if (override.final_score !== undefined) currentScore = override.final_score;
        if (override.ta_score !== undefined) currentScore = override.ta_score;
        if (override.teacher_score !== undefined) currentScore = override.teacher_score;

        _state.activeContext = {
            submission: submission,
            taskMeta: taskMeta || {},
            defectBank: defectBank || {},
            role: currentRole || 'primary_teacher',
            draft: {
                current_score: currentScore,
                feedback: override.manual_feedback || '',
                manual_defects_added: Array.isArray(override.manual_defects_added) ? [...override.manual_defects_added] : [],
                ai_defects_removed: Array.isArray(override.ai_defects_removed) ? [...override.ai_defects_removed] : []
            }
        };
    }

    function getActiveContext() { return _state.activeContext; }

    function updateDraftScore(score) {
        if (_state.activeContext) _state.activeContext.draft.current_score = (score === '' || score === null) ? null : Number(score);
    }

    function updateDraftFeedback(feedback) {
        if (_state.activeContext) _state.activeContext.draft.feedback = feedback || '';
    }

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

    function generateSavePayload() {
        if (!_state.activeContext || !_state.activeContext.submission) return null;
        const ctx = _state.activeContext;
        const sub = ctx.submission;
        const role = ctx.role;

        const newRawData = parseJSONB(sub.raw_data);
        const override = newRawData.teacher_override || {};

        // 🛡️ 階層覆寫邏輯防護 (Role-Based Overrides)
        if (role === 'primary_teacher' || role === 'admin') {
            override.teacher_score = ctx.draft.current_score;
            override.locked_by_role = 'primary_teacher';
        } else if (role === 'ta_senior') {
            if (override.locked_by_role === 'primary_teacher' || override.locked_by_role === 'admin') {
                throw new Error("🔒 此成績已由教師定案，助教無法覆寫。");
            }
            override.ta_score = ctx.draft.current_score;
            override.locked_by_role = 'ta_senior';
        } else if (role === 'ta_junior') {
            throw new Error("一般助教無發布成績權限。");
        }

        override.final_score = ctx.draft.current_score; // 為了向下兼容保留
        override.manual_feedback = ctx.draft.feedback;
        override.manual_defects_added = ctx.draft.manual_defects_added;
        override.ai_defects_removed = ctx.draft.ai_defects_removed;
        override.overridden_at = new Date().toISOString();

        if (!newRawData.override_history) newRawData.override_history = [];
        newRawData.override_history.push({ role: role, timestamp: override.overridden_at, score: ctx.draft.current_score });
        
        newRawData.teacher_override = override;

        // 結算缺陷字庫
        const newDefectBank = JSON.parse(JSON.stringify(ctx.defectBank || {}));
        ctx.draft.manual_defects_added.forEach(w => { newDefectBank[w] = (newDefectBank[w] || 0) + 1; });
        const aiErrors = newRawData.ai_evaluation?.word_errors || [];
        aiErrors.forEach(e => {
            const cw = (e.word || '').toLowerCase().replace(/[^a-z']/g, '');
            if (cw && !ctx.draft.ai_defects_removed.includes(cw)) newDefectBank[cw] = (newDefectBank[cw] || 0) + 1;
        });

        return {
            submission_id: sub.id,
            user_id: sub.student_id || sub.user_id,
            score_to_update: ctx.draft.current_score,
            raw_data_to_patch: newRawData,
            defect_bank_to_patch: newDefectBank
        };
    }

    return {
        initMatrix, getMatrixState, setActiveSubmission, getActiveContext, getCommentBank,
        updateDraftScore, updateDraftFeedback, toggleManualDefect, toggleAiDefectRemoval, generateSavePayload
    };
})();
/**
 * 📂 110_teacher_core/store-gradebook.js
 * 🎯 職責：老師端批改中樞的狀態大腦 (Tier 3)
 * ⚠️ 鐵律：絕對禁止操作 DOM、絕對禁止呼叫 API。只負責維護記憶體狀態與產出乾淨 DTO Payload。
 */
window.GradebookStore = (function() {
    'use strict';

    // 內部封閉狀態 (Single Source of Truth)
    let state = {
        matrixData: [],         // 成績單矩陣資料
        assignments: [],        // 該班作業清單
        activeSubmission: null, // 當前正在側邊欄批改的單筆作業物件
        defectWordBank: {},     // 該生歷史缺陷字集 (從 profiles raw_data 提取) { "apple": 2, "park": 1 }
        
        // 老師暫存的修改 (Draft)
        draftOverride: {
            final_score: null,
            manual_feedback: "",
            manual_defects_added: [], // 老師手動標記的漏抓單字 (補刀)
            ai_defects_removed: []    // 老師標記為誤判的單字 (防誤判)
        }
    };

    /**
     * 載入成績單矩陣與作業欄位
     */
    function initMatrix(matrixData, assignments) {
        state.matrixData = Array.isArray(matrixData) ? matrixData : [];
        state.assignments = Array.isArray(assignments) ? assignments : [];
    }

    function getMatrixState() {
        return {
            matrixData: state.matrixData,
            assignments: state.assignments
        };
    }

    /**
     * 開啟批改面板，載入單一作業狀態與歷史病歷
     */
    function setActiveSubmission(submission, studentDefectBank = {}) {
        // 深拷貝，避免污染原始矩陣資料
        state.activeSubmission = JSON.parse(JSON.stringify(submission)); 
        state.defectWordBank = JSON.parse(JSON.stringify(studentDefectBank));
        
        // 載入歷史覆寫紀錄，若無則預設帶入 AI 總分
        const rawData = state.activeSubmission.raw_data || {};
        const override = rawData.teacher_override || {};
        const aiScore = rawData.ai_evaluation?.pronunciation_score || null;

        state.draftOverride = {
            final_score: override.final_score !== undefined ? override.final_score : aiScore,
            manual_feedback: override.manual_feedback || "",
            manual_defects_added: override.manual_defects_added || [],
            ai_defects_removed: override.ai_defects_removed || []
        };
    }

    /**
     * 更新老師手動評分草稿
     */
    function updateDraftScore(score) {
        if (score === "" || score === null) {
            state.draftOverride.final_score = null;
        } else {
            state.draftOverride.final_score = Number(score);
        }
    }

    /**
     * 更新老師手動評語草稿
     */
    function updateDraftFeedback(feedback) {
        state.draftOverride.manual_feedback = feedback;
    }

    /**
     * 老師手動標記/取消標記 AI 漏抓的錯誤單字 (補刀機制)
     */
    function toggleManualDefect(word) {
        const cleanWord = word.toLowerCase().replace(/[^a-z']/g, '');
        if (!cleanWord) return;

        const idx = state.draftOverride.manual_defects_added.indexOf(cleanWord);
        if (idx > -1) {
            state.draftOverride.manual_defects_added.splice(idx, 1);
        } else {
            state.draftOverride.manual_defects_added.push(cleanWord);
            // 若該字先前被標為誤判，則從誤判清單中自動移除
            const remIdx = state.draftOverride.ai_defects_removed.indexOf(cleanWord);
            if (remIdx > -1) state.draftOverride.ai_defects_removed.splice(remIdx, 1);
        }
    }

    /**
     * 老師手動移除 AI 抓錯 (防誤判)
     */
    function toggleAiDefectRemoval(word) {
        const cleanWord = word.toLowerCase().replace(/[^a-z']/g, '');
        if (!cleanWord) return;

        const idx = state.draftOverride.ai_defects_removed.indexOf(cleanWord);
        if (idx > -1) {
            state.draftOverride.ai_defects_removed.splice(idx, 1); // 再次點擊取消移除
        } else {
            state.draftOverride.ai_defects_removed.push(cleanWord);
            // 若該字先前被標為手動補刀，則移除補刀
            const manIdx = state.draftOverride.manual_defects_added.indexOf(cleanWord);
            if (manIdx > -1) state.draftOverride.manual_defects_added.splice(manIdx, 1);
        }
    }

    /**
     * 取得當前批改上下文 (提供給 UI Template 渲染使用)
     */
    function getActiveContext() {
        return {
            submission: state.activeSubmission,
            draft: state.draftOverride,
            defectBank: state.defectWordBank
        };
    }

    /**
     * 產出即將寫入資料庫的 DTO Payload (準備給 Feature / API 執行 RPC 原子化寫入)
     */
    function generateSavePayload() {
        if (!state.activeSubmission) return null;

        // 🌟 完美銜接您的 utils-date，取得台灣時區 ISO Timestamp
        const currentTimestamp = window.UtilsDate.getTaiwanIsoTimestamp();

        const baseRawData = state.activeSubmission.raw_data || {};
        const aiEval = baseRawData.ai_evaluation || {};
        const aiErrors = aiEval.word_errors || [];
        
        // 1. 隔離組合最新狀態 (確保絕對不覆蓋 ai_evaluation 原始草稿)
        const finalRawData = {
            ...baseRawData,
            teacher_override: {
                ...state.draftOverride,
                overridden_at: currentTimestamp
            }
        };

        // 2. 結算並更新學生的歷史缺陷字集 (Defect Word Bank)
        let updatedDefectBank = { ...state.defectWordBank };
        
        // 納入 AI 抓出的錯誤 (且未被老師標記為誤判的)
        aiErrors.forEach(err => {
            const w = (err.word || "").toLowerCase().replace(/[^a-z']/g, '');
            if (w && !state.draftOverride.ai_defects_removed.includes(w)) {
                updatedDefectBank[w] = (updatedDefectBank[w] || 0) + 1;
            }
        });
        
        // 納入老師手動補刀的錯誤
        state.draftOverride.manual_defects_added.forEach(w => {
            if (w) updatedDefectBank[w] = (updatedDefectBank[w] || 0) + 1;
        });

        return {
            submission_id: state.activeSubmission.id,
            user_id: state.activeSubmission.user_id,
            class_id: state.activeSubmission.class_id,
            assignment_id: state.activeSubmission.assignment_id,
            score_to_update: state.draftOverride.final_score,
            raw_data_to_patch: finalRawData,
            defect_bank_to_patch: updatedDefectBank
        };
    }

    return {
        initMatrix,
        getMatrixState,
        setActiveSubmission,
        updateDraftScore,
        updateDraftFeedback,
        toggleManualDefect,
        toggleAiDefectRemoval,
        getActiveContext,
        generateSavePayload
    };
})();
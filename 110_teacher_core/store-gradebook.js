/**
 * 📂 110_teacher_core/feature-gradebook.js
 * 🎯 職責：老師端批改中樞的輕量指揮官 (Tier 4 Orchestrator)
 * 🚀 修正：導入 Capture 捕獲機制，徹底解決左側班級切換無反應的問題！
 */
window.FeatureGradebook = (function() {
    'use strict';

    const SELECTORS = {
        matrixContainer: '#gradebook-matrix-container',
        sidebarMount: '#grading-sidebar-mount-point',
        popoverMount: '#grading-popover-mount-point'
    };

    let _currentRole = 'primary_teacher';
    let _currentClassId = null;

    /**
     * 🌟 智慧載入：自動抓取當前班級，並呼叫 API 渲染矩陣
     */
    function loadDataForCurrentClass() {
        let classId = null;
        let role = 'primary_teacher';

        // 優先嘗試從全域 UI 模組獲取
        if (window.TeacherUI) {
            if (typeof window.TeacherUI.getCurrentClassId === 'function') classId = window.TeacherUI.getCurrentClassId();
            if (typeof window.TeacherUI.getCurrentUserRole === 'function') role = window.TeacherUI.getCurrentUserRole() || 'primary_teacher';
        }
        
        // 備案：從 localStorage 獲取
        if (!classId) classId = localStorage.getItem('lastClassId');

        if (classId) {
            initMatrixView(classId, role);
        } else {
            const container = document.querySelector(SELECTORS.matrixContainer);
            if (container) {
                container.innerHTML = `<div class="p-10 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">請先從左側選擇一個班級</div>`;
            }
        }
    }

    async function initMatrixView(classId, userRole) {
        if (!classId) return;
        _currentClassId = classId;
        _currentRole = userRole || 'primary_teacher';
        
        const container = document.querySelector(SELECTORS.matrixContainer);
        if (!container) return;

        container.innerHTML = `<div class="p-10 text-center text-blue-600 animate-pulse font-bold bg-white rounded-xl shadow-sm border border-gray-200">📡 正在從資料庫拉取成績單矩陣與作業數據...</div>`;

        try {
            const { matrixData, assignments } = await window.GradebookAPI.fetchMatrixData(classId);
            window.GradebookStore.initMatrix(matrixData, assignments);
            renderMatrixUI();
        } catch (err) {
            console.error('[Gradebook Error]', err);
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl shadow-sm border border-red-200">❌ 載入失敗：${err.message}</div>`;
        }
    }

    function renderMatrixUI() {
        const state = window.GradebookStore.getMatrixState();
        const html = window.GradebookTemplates.renderMatrix(state.matrixData, state.assignments);
        document.querySelector(SELECTORS.matrixContainer).innerHTML = html;
    }

    function reRenderSidebarContentOnly() {
        document.querySelector(SELECTORS.popoverMount).innerHTML = ''; 
        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;

        const context = window.GradebookStore.getActiveContext();
        mount.innerHTML = window.GradebookTemplates.renderSidebar(context, _currentRole);
        
        const panel = mount.querySelector('#grading-sidebar-panel');
        const overlay = mount.querySelector('#grading-sidebar-overlay');
        if (panel) panel.classList.remove('translate-x-full');
        if (overlay) overlay.classList.remove('hidden');
    }

    function closeSidebar() {
        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;

        const panel = mount.querySelector('#grading-sidebar-panel');
        const overlay = mount.querySelector('#grading-sidebar-overlay');
        
        if (panel) panel.classList.add('translate-x-full');
        if (overlay) overlay.classList.add('hidden');

        document.querySelector(SELECTORS.popoverMount).innerHTML = '';
        setTimeout(() => { mount.innerHTML = ''; }, 300);
    }

    // =========================================================
    // 🌟 跨模組事件綁定 (Capture Phase)
    // =========================================================
    document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-btn[data-target="view-gradebook"]');
        const classItemBtn = e.target.closest('.class-item'); // 左側班級列表
        
        if (tabBtn) {
            setTimeout(() => { loadDataForCurrentClass(); }, 50); 
            return;
        }

        if (classItemBtn) {
            setTimeout(() => {
                const gradebookView = document.getElementById('view-gradebook');
                if (gradebookView && gradebookView.classList.contains('active')) {
                    loadDataForCurrentClass();
                }
            }, 100); // 延遲確保舊系統已將 localStorage 更新
            return;
        }
    }, true);


    // =========================================================
    // 介面互動委派 (DOM Event Delegation)
    // =========================================================
    document.addEventListener('click', async (e) => {
        const openBtn = e.target.closest('[data-action="open-grading"]');
        if (openBtn) {
            const subId = openBtn.getAttribute('data-submission-id');
            const stuId = openBtn.getAttribute('data-student-id');
            
            const state = window.GradebookStore.getMatrixState();
            const row = state.matrixData.find(r => String(r.student_id) === String(stuId));
            if (row && row.submissions) {
                const submission = row.submissions[subId] || Object.values(row.submissions).find(s => String(s.id) === String(subId));
                if (submission) {
                    window.GradebookStore.setActiveSubmission(submission, row.defect_bank);
                    reRenderSidebarContentOnly();
                }
            }
            return;
        }

        if (e.target.closest('[data-action="close-sidebar"]')) { closeSidebar(); return; }

        const wordEl = e.target.closest('[data-action="word-click"]');
        if (wordEl) {
            const word = wordEl.getAttribute('data-word');
            const type = wordEl.getAttribute('data-type');
            
            if (type === 'ai' || type === 'manual') {
                const rect = wordEl.getBoundingClientRect();
                const posX = rect.left + (rect.width / 2);
                const posY = rect.bottom;
                
                const html = window.GradebookTemplates.renderWordPopover(
                    word, wordEl.getAttribute('data-kk-std'), wordEl.getAttribute('data-kk-stu'), 
                    wordEl.getAttribute('data-time'), wordEl.getAttribute('data-issue'), 
                    type === 'manual', posX, posY
                );
                document.querySelector(SELECTORS.popoverMount).innerHTML = html;
            } else {
                const selection = window.getSelection();
                if (selection.toString().length === 0) {
                    window.GradebookStore.toggleManualDefect(word);
                    reRenderSidebarContentOnly();
                }
            }
            return;
        }

        const intonation = e.target.closest('[data-action="intonation-click"]');
        if (intonation) {
            const time = parseFloat(intonation.getAttribute('data-time') || 0);
            const audio = document.getElementById('student-audio');
            if (audio) { audio.currentTime = time; audio.play(); }
            return;
        }

        if (e.target.closest('[data-action="close-popover"]')) {
            document.querySelector(SELECTORS.popoverMount).innerHTML = ''; return;
        }

        const playStuBtn = e.target.closest('[data-action="play-student"]');
        if (playStuBtn) {
            const time = parseFloat(playStuBtn.getAttribute('data-time') || 0);
            const audio = document.getElementById('student-audio');
            if (audio) { audio.currentTime = time > 0.5 ? time - 0.5 : 0; audio.play(); }
            return;
        }

        const playTtsBtn = e.target.closest('[data-action="play-tts"]');
        if (playTtsBtn) {
            const word = playTtsBtn.getAttribute('data-word');
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US'; utterance.rate = 0.85;
            window.speechSynthesis.speak(utterance);
            return;
        }

        const removeAiBtn = e.target.closest('[data-action="remove-ai"]');
        if (removeAiBtn) {
            window.GradebookStore.toggleAiDefectRemoval(removeAiBtn.getAttribute('data-word'));
            reRenderSidebarContentOnly(); return;
        }

        const removeManBtn = e.target.closest('[data-action="remove-manual"]');
        if (removeManBtn) {
            window.GradebookStore.toggleManualDefect(removeManBtn.getAttribute('data-word'));
            reRenderSidebarContentOnly(); return;
        }

        const saveBtn = e.target.closest('[data-action="save-publish"]');
        if (saveBtn) {
            saveBtn.disabled = true;
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '🔄 資料寫入中...';
            
            const scoreInput = document.getElementById('input-draft-score');
            const feedbackInput = document.getElementById('input-draft-feedback');
            if (scoreInput) window.GradebookStore.updateDraftScore(scoreInput.value);
            if (feedbackInput) window.GradebookStore.updateDraftFeedback(feedbackInput.value);

            const payload = window.GradebookStore.generateSavePayload();
            if (!payload) return;

            try {
                await window.GradebookAPI.publishGrade(payload);
                alert("🎉 批改已成功發布，學生歷史病歷已更新！");
                closeSidebar();
                loadDataForCurrentClass(); // 刷新矩陣
            } catch (err) {
                alert('❌ 儲存失敗：' + err.message);
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
            return;
        }
    });

    document.addEventListener('mouseup', () => {
        const sidebarPanel = document.getElementById('grading-sidebar-panel');
        if (!sidebarPanel || sidebarPanel.classList.contains('translate-x-full')) return;

        const selection = window.getSelection();
        const text = selection.toString().trim();
        if (text && text.length > 0 && text.length < 20 && /^[a-zA-Z']+$/.test(text)) {
            if (confirm(`是否將 [ ${text} ] 手動標記為發音錯誤？`)) {
                window.GradebookStore.toggleManualDefect(text);
                reRenderSidebarContentOnly();
            }
            selection.removeAllRanges();
        }
    });

    return { loadDataForCurrentClass };
})();
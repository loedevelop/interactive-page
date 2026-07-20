/**
 * 📂 110_teacher_core/feature-gradebook.js
 * 🎯 職責：老師端批改中樞的輕量指揮官 (Tier 4 Orchestrator)
 */
window.FeatureGradebook = (function() {
    'use strict';

    const SELECTORS = {
        matrixContainer: '#gradebook-matrix-container',
        sidebarMount: '#grading-sidebar-mount-point',
        popoverMount: '#grading-popover-mount-point'
    };

    let _currentRole = 'primary_teacher';

    function ensureMountPoints() {
        if (!document.querySelector(SELECTORS.sidebarMount)) document.body.insertAdjacentHTML('beforeend', '<div id="grading-sidebar-mount-point"></div>');
        if (!document.querySelector(SELECTORS.popoverMount)) document.body.insertAdjacentHTML('beforeend', '<div id="grading-popover-mount-point"></div>');
    }

    function loadDataForCurrentClass() {
        ensureMountPoints();
        if (!window.GradebookStore) return;

        let classId = window.TeacherUI?.getCurrentClassId() || localStorage.getItem('lastClassId');
        _currentRole = window.TeacherUI?.getCurrentUserRole() || 'primary_teacher';
        
        if (classId) initMatrixView(classId);
    }

    async function initMatrixView(classId) {
        const container = document.querySelector(SELECTORS.matrixContainer);
        if (!container) return;
        container.innerHTML = `<div class="p-10 text-center text-blue-600 font-bold bg-white rounded-xl shadow-sm border border-gray-200 animate-pulse">📡 正在解析維度與拉取成績單...</div>`;

        try {
            const { matrixData, assignments } = await window.GradebookAPI.fetchMatrixData(classId);
            window.GradebookStore.initMatrix(matrixData, assignments);
            container.innerHTML = window.GradebookTemplates.renderMatrix(matrixData, assignments);
        } catch (err) {
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl border border-red-200">❌ ${err.message}</div>`;
        }
    }

    function reRenderSidebarContentOnly() {
        document.querySelector(SELECTORS.popoverMount).innerHTML = ''; 
        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;

        const context = window.GradebookStore.getActiveContext();
        const bank = window.GradebookStore.getCommentBank();
        mount.innerHTML = window.GradebookTemplates.renderSidebar(context, bank);
        
        setTimeout(() => {
            mount.querySelector('#grading-sidebar-panel')?.classList.remove('translate-x-full');
            mount.querySelector('#grading-sidebar-overlay')?.classList.remove('hidden');
        }, 10);
    }

    function closeSidebar() {
        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;
        mount.querySelector('#grading-sidebar-panel')?.classList.add('translate-x-full');
        mount.querySelector('#grading-sidebar-overlay')?.classList.add('hidden');
        document.querySelector(SELECTORS.popoverMount).innerHTML = '';
        setTimeout(() => { mount.innerHTML = ''; }, 300);
    }

    // 🌟 全域事件委派 (Event Delegation)
    document.addEventListener('click', async (e) => {
        // 切換班級重新載入
        if (e.target.closest('.tab-btn[data-target="view-gradebook"]') || e.target.closest('.class-item')) {
            setTimeout(() => {
                const gb = document.getElementById('view-gradebook');
                if (gb && gb.classList.contains('active')) loadDataForCurrentClass();
            }, 100); 
            return;
        }

        // 打開批改艙 (精準傳入 meta)
        const openBtn = e.target.closest('[data-action="open-grading"]');
        if (openBtn) {
            const subId = openBtn.getAttribute('data-submission-id');
            const stuId = openBtn.getAttribute('data-student-id');
            const taskId = openBtn.getAttribute('data-task-id');
            
            const state = window.GradebookStore.getMatrixState();
            const row = state.matrixData.find(r => String(r.student_id) === String(stuId));
            const meta = state.assignments.find(a => String(a.id) === String(taskId));

            if (row && row.submissions) {
                const submission = row.submissions[subId] || Object.values(row.submissions).find(s => String(s.id) === String(subId));
                if (submission) {
                    window.GradebookStore.setActiveSubmission(submission, meta, row.defect_bank, _currentRole);
                    reRenderSidebarContentOnly();
                }
            }
            return;
        }

        if (e.target.closest('[data-action="close-sidebar"]')) { closeSidebar(); return; }

        // 🚫 Click Outside: 點擊彈窗外部自動關閉
        const popover = document.querySelector(SELECTORS.popoverMount);
        if (popover && popover.innerHTML !== '') {
            const isInside = e.target.closest('[data-popover-content="true"]');
            const isWord = e.target.closest('[data-action="word-click"]');
            if (!isInside && !isWord) popover.innerHTML = '';
        }

        // 點擊紅黑字彈出 Popover
        const wordEl = e.target.closest('[data-action="word-click"]');
        if (wordEl) {
            const word = wordEl.getAttribute('data-word');
            const type = wordEl.getAttribute('data-type');
            
            if (type === 'ai' || type === 'manual') {
                const rect = wordEl.getBoundingClientRect();
                // 📍 座標計算：定錨於單字的正上方 (rect.top)
                const posX = rect.left + (rect.width / 2);
                const posY = rect.top; 
                
                const html = window.GradebookTemplates.renderWordPopover(
                    word, wordEl.getAttribute('data-kk-std'), wordEl.getAttribute('data-kk-stu'), 
                    wordEl.getAttribute('data-issue'), type === 'manual', posX, posY
                );
                document.querySelector(SELECTORS.popoverMount).innerHTML = html;
            } else {
                // 黑字：直接新增手動標記
                window.GradebookStore.toggleManualDefect(word);
                reRenderSidebarContentOnly();
            }
            return;
        }

        // ⚡ 詞庫無縫穿插游標位置
        const appendBtn = e.target.closest('[data-action="append-template"]');
        if (appendBtn) {
            e.preventDefault();
            const text = appendBtn.getAttribute('data-text');
            const textarea = document.getElementById('input-draft-feedback');
            if (textarea) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const val = textarea.value;
                // 若游標前方有字且不是空白，自動補空白防沾黏
                const prefix = (start === 0 || val.charAt(start - 1) === '\n' || val.charAt(start - 1) === ' ') ? '' : ' ';
                const insertStr = prefix + text;
                
                textarea.value = val.substring(0, start) + insertStr + val.substring(end);
                textarea.focus();
                textarea.selectionStart = textarea.selectionEnd = start + insertStr.length;
                window.GradebookStore.updateDraftFeedback(textarea.value);
            }
            return;
        }

        if (e.target.closest('[data-action="remove-ai"]')) {
            window.GradebookStore.toggleAiDefectRemoval(e.target.closest('button').getAttribute('data-word'));
            reRenderSidebarContentOnly(); return;
        }
        if (e.target.closest('[data-action="remove-manual"]')) {
            window.GradebookStore.toggleManualDefect(e.target.closest('button').getAttribute('data-word'));
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

            try {
                const payload = window.GradebookStore.generateSavePayload();
                if (!payload) throw new Error("無效的資料載荷");
                
                await window.GradebookAPI.publishGrade(payload);
                closeSidebar();
                loadDataForCurrentClass(); 
            } catch (err) {
                alert('❌ 儲存失敗：' + err.message);
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
        }
    });

    return { loadDataForCurrentClass };
})();
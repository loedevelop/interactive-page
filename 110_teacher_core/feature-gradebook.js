/**
 * 📂 110_teacher_core/feature-gradebook.js
 * 🎯 職責：老師端批改中樞的輕量指揮官 (v23: 新增採用 AI 評語一鍵寫入機制)
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

    function ensureMountPoints() {
        if (!document.querySelector(SELECTORS.sidebarMount)) document.body.insertAdjacentHTML('beforeend', '<div id="grading-sidebar-mount-point"></div>');
        if (!document.querySelector(SELECTORS.popoverMount)) document.body.insertAdjacentHTML('beforeend', '<div id="grading-popover-mount-point"></div>');
    }

    function makePopoverDraggable() {
        const popover = document.getElementById('active-word-popover');
        const handle = popover ? popover.querySelector('.popover-drag-handle') : null;
        if (!popover || !handle) return;

        let isDragging = false, startX, startY, initX, initY;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = popover.getBoundingClientRect();
            popover.style.transform = 'none';
            popover.style.left = rect.left + 'px';
            popover.style.top = rect.top + 'px';
            initX = rect.left;
            initY = rect.top;
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            popover.style.left = (initX + e.clientX - startX) + 'px';
            popover.style.top = (initY + e.clientY - startY) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            document.body.style.userSelect = '';
        });
    }

    function loadDataForCurrentClass() {
        ensureMountPoints();
        if (!window.GradebookStore) return;
        let classId = null;
        if (window.TeacherUI) {
            if (typeof window.TeacherUI.getCurrentClassId === 'function') classId = window.TeacherUI.getCurrentClassId();
            if (typeof window.TeacherUI.getCurrentUserRole === 'function') _currentRole = window.TeacherUI.getCurrentUserRole() || 'primary_teacher';
        }
        if (!classId) classId = localStorage.getItem('lastClassId');

        if (classId) { initMatrixView(classId, _currentRole); }
        else {
            const container = document.querySelector(SELECTORS.matrixContainer);
            if (container) container.innerHTML = `<div class="p-10 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">請先從左側選擇一個班級</div>`;
        }
    }

    async function initMatrixView(classId, userRole) {
        if (!classId) return;
        _currentClassId = classId;
        const container = document.querySelector(SELECTORS.matrixContainer);
        if (!container) return;

        container.innerHTML = `<div class="p-10 text-center text-blue-600 animate-pulse font-bold bg-white rounded-xl shadow-sm border border-gray-200">📡 正在從資料庫拉取成績單矩陣與作業數據...</div>`;

        try {
            const { matrixData, assignments } = await window.GradebookAPI.fetchMatrixData(classId);
            window.GradebookStore.initMatrix(matrixData, assignments);
            renderMatrixUI();
        } catch (err) {
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl shadow-sm border border-red-200">❌ 載入失敗：${err.message}</div>`;
        }
    }

    function renderMatrixUI() {
        if (!window.GradebookStore) return;
        const state = window.GradebookStore.getMatrixState();
        document.querySelector(SELECTORS.matrixContainer).innerHTML = window.GradebookTemplates.renderMatrix(state.matrixData, state.assignments);
    }

    function reRenderSidebarContentOnly() {
        const popoverEl = document.querySelector(SELECTORS.popoverMount);
        if (popoverEl) popoverEl.innerHTML = '';

        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;

        const context = window.GradebookStore.getActiveContext();
        mount.innerHTML = window.GradebookTemplates.renderSidebar(context, _currentRole);
        const panel = mount.querySelector('#grading-sidebar-panel');
        const overlay = mount.querySelector('#grading-sidebar-overlay');
        setTimeout(() => { if (panel) panel.classList.remove('translate-x-full'); if (overlay) overlay.classList.remove('hidden'); }, 10);
    }

    function closeSidebar() {
        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;
        const panel = mount.querySelector('#grading-sidebar-panel');
        const overlay = mount.querySelector('#grading-sidebar-overlay');
        if (panel) panel.classList.add('translate-x-full');
        if (overlay) overlay.classList.add('hidden');
        const popoverEl = document.querySelector(SELECTORS.popoverMount);
        if (popoverEl) popoverEl.innerHTML = '';
        setTimeout(() => { mount.innerHTML = ''; }, 300);
    }

    // Tab 切換
    document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-btn[data-target="view-gradebook"]');
        const classItemBtn = e.target.closest('.class-item');
        if (tabBtn) { setTimeout(() => { loadDataForCurrentClass(); }, 50); return; }
        if (classItemBtn) {
            setTimeout(() => {
                const gradebookView = document.getElementById('view-gradebook');
                if (gradebookView && gradebookView.classList.contains('active')) loadDataForCurrentClass();
            }, 100);
            return;
        }
    }, true);

    document.addEventListener('DOMContentLoaded', () => {
        const gradebookView = document.getElementById('view-gradebook');
        if (gradebookView && !gradebookView.classList.contains('hidden')) setTimeout(() => { loadDataForCurrentClass(); }, 300);
    });

    // 核心事件處理
    document.addEventListener('click', async (e) => {
        // 🌟 關鍵修復：Click-Outside 自動關閉 Popover 氣泡
        const popoverMount = document.querySelector(SELECTORS.popoverMount);
        if (popoverMount && popoverMount.innerHTML.trim() !== '') {
            const isInsidePopover = e.target.closest('#active-word-popover');
            const isWordClick = e.target.closest('[data-action="word-click"]');
            // 若點擊不在氣泡內，且點擊的不是單字，則清空氣泡
            if (!isInsidePopover && !isWordClick) {
                popoverMount.innerHTML = '';
            }
        }

        const openBtn = e.target.closest('[data-action="open-grading"]');
        if (openBtn) {
            const subId = openBtn.getAttribute('data-submission-id');
            const stuId = openBtn.getAttribute('data-student-id');
            const state = window.GradebookStore.getMatrixState();
            const row = state.matrixData.find(r => String(r.student_id) === String(stuId));
            let gradingPolicy = {};
            if (window.GradingPolicy && window.GradingPolicy.parsePolicy) {
                const cls = window.TeacherDB && window.TeacherDB.classes ? window.TeacherDB.classes.find(c => String(c.id) === String(_currentClassId)) : null;
                if (cls) gradingPolicy = window.GradingPolicy.parsePolicy(cls.raw_data || cls.rawData || {});
            }
            if (row && row.submissions) {
                const submission = row.submissions[subId] || Object.values(row.submissions).find(s => String(s.id) === String(subId));
                if (submission) { window.GradebookStore.setActiveSubmission(submission, row.student_name, row.defect_bank, gradingPolicy); reRenderSidebarContentOnly(); }
            }
            return;
        }

        if (e.target.closest('[data-action="close-sidebar"]')) { closeSidebar(); return; }

        // 🌟 新增：一鍵採用 AI 評語
        const applyAiBtn = e.target.closest('[data-action="apply-ai-feedback"]');
        if (applyAiBtn) {
            const aiFeedback = applyAiBtn.getAttribute('data-feedback');
            const feedbackInput = document.getElementById('input-draft-feedback');
            if (feedbackInput && aiFeedback) {
                feedbackInput.value = aiFeedback;
                if (window.GradebookStore && window.GradebookStore.updateDraftFeedback) {
                    window.GradebookStore.updateDraftFeedback(aiFeedback);
                }
            }
            return;
        }

        const wordEl = e.target.closest('[data-action="word-click"]');
        if (wordEl) {
            const word = wordEl.getAttribute('data-word');
            const type = wordEl.getAttribute('data-type');
            if (type === 'ai' || type === 'manual') {
                const rect = wordEl.getBoundingClientRect();
                const popoverHeight = 180;
                let posX = rect.left + (rect.width / 2);
                let posY = rect.bottom + 8;
                let isTop = false;

                if (window.innerHeight - rect.bottom < popoverHeight && rect.top > popoverHeight) {
                    posY = rect.top - 8;
                    isTop = true;
                }
                const html = window.GradebookTemplates.renderWordPopover(
                    word, wordEl.getAttribute('data-kk-std'), wordEl.getAttribute('data-kk-stu'),
                    wordEl.getAttribute('data-time'), wordEl.getAttribute('data-issue'),
                    type === 'manual', posX, posY, isTop
                );
                if (popoverMount) {
                    popoverMount.innerHTML = html;
                    makePopoverDraggable();
                }
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
            if (popoverMount) popoverMount.innerHTML = '';
            return;
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
        if (removeAiBtn) { window.GradebookStore.toggleAiDefectRemoval(removeAiBtn.getAttribute('data-word')); reRenderSidebarContentOnly(); return; }

        const removeManBtn = e.target.closest('[data-action="remove-manual"]');
        if (removeManBtn) { window.GradebookStore.toggleManualDefect(removeManBtn.getAttribute('data-word')); reRenderSidebarContentOnly(); return; }

        const saveBtn = e.target.closest('[data-action="save-publish"]');
        if (saveBtn) {
            if (window.GradingPolicy && window.GradingPolicy.roleCanPublish) {
                const ctx = window.GradebookStore.getActiveContext();
                const policy = ctx ? ctx.gradingPolicy : null;
                if (!window.GradingPolicy.roleCanPublish(policy, _currentRole)) {
                    window.showFlash('您目前的角色無權發布／定案成績。請聯絡主老師調整班級 AI 批改設定。', 'error');
                    return;
                }
            }
            saveBtn.disabled = true;
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '🔄 寫入中...';
            const scoreInput = document.getElementById('input-draft-score');
            const feedbackInput = document.getElementById('input-draft-feedback');
            if (scoreInput) window.GradebookStore.updateDraftScore(scoreInput.value);
            if (feedbackInput) window.GradebookStore.updateDraftFeedback(feedbackInput.value);

            const payload = window.GradebookStore.generateSavePayload();
            if (!payload) return;

            try {
                await window.GradebookAPI.publishGrade(payload);
                const saveIcon = saveBtn.innerHTML;
                saveBtn.innerHTML = '✅ 已發布';
                saveBtn.classList.replace('bg-blue-600', 'bg-green-600');
                saveBtn.classList.replace('hover:bg-blue-700', 'hover:bg-green-700');
                setTimeout(() => {
                    closeSidebar();
                    loadDataForCurrentClass();
                }, 800);
            } catch (err) {
                window.showFlash('儲存失敗：' + err.message, 'error');
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
            const context = window.GradebookStore.getActiveContext();
            const isAlreadyDefect = context && context.draft.manual_defects_added.includes(text.toLowerCase());
            if (!isAlreadyDefect && confirm(`是否將 [ ${text} ] 手動標記為發音錯誤？`)) {
                window.GradebookStore.toggleManualDefect(text);
                reRenderSidebarContentOnly();
            }
            selection.removeAllRanges();
        }
    });

    return { loadDataForCurrentClass };
})();
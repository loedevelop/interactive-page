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

    // 🛡️ 防禦 1: 確保 DOM 節點存在，防止 innerHTML 拋錯
    function ensureMountPoints() {
        if (!document.querySelector(SELECTORS.sidebarMount)) {
            document.body.insertAdjacentHTML('beforeend', '<div id="grading-sidebar-mount-point"></div>');
        }
        if (!document.querySelector(SELECTORS.popoverMount)) {
            document.body.insertAdjacentHTML('beforeend', '<div id="grading-popover-mount-point"></div>');
        }
    }

    // 🛡️ 防禦 2: 嚴格的 typeof 安全檢查
    function loadDataForCurrentClass() {
        ensureMountPoints();
        if (!window.GradebookStore) {
            console.error("GradebookStore 遺失，請檢查載入順序");
            return;
        }

        let classId = null;
        if (window.TeacherUI && typeof window.TeacherUI.getCurrentClassId === 'function') {
            classId = window.TeacherUI.getCurrentClassId();
        }
        if (!classId) classId = localStorage.getItem('lastClassId');
        
        if (window.TeacherUI && typeof window.TeacherUI.getCurrentUserRole === 'function') {
            _currentRole = window.TeacherUI.getCurrentUserRole() || 'primary_teacher';
        }
        
        if (classId) {
            initMatrixView(classId);
        } else {
            const container = document.querySelector(SELECTORS.matrixContainer);
            if (container) {
                container.innerHTML = `<div class="p-10 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">請先從左側選擇一個班級</div>`;
            }
        }
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
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl border border-red-200">❌ 載入失敗：${err.message}</div>`;
        }
    }

    function reRenderSidebarContentOnly() {
        const popoverEl = document.querySelector(SELECTORS.popoverMount);
        if (popoverEl) popoverEl.innerHTML = ''; 

        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;

        const context = window.GradebookStore.getActiveContext();
        const bank = window.GradebookStore.getCommentBank(); // 提取詞庫
        mount.innerHTML = window.GradebookTemplates.renderSidebar(context, bank);
        
        setTimeout(() => {
            const panel = mount.querySelector('#grading-sidebar-panel');
            const overlay = mount.querySelector('#grading-sidebar-overlay');
            if (panel) panel.classList.remove('translate-x-full');
            if (overlay) overlay.classList.remove('hidden');
        }, 10);
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

    // ==========================================
    // 🛡️ 事件攔截與生命週期復原區 (The Guardians)
    // ==========================================

    // 防禦 3: 跨模組事件攔截 (原汁原味的 true 參數，確保優先捕獲)
    document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-btn[data-target="view-gradebook"]');
        const classItemBtn = e.target.closest('.class-item');
        
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
            }, 100); 
            return;
        }
    }, true);

    // 防禦 4: 初始載入處理 (重新整理網頁時的防呆)
    document.addEventListener('DOMContentLoaded', () => {
        const gradebookView = document.getElementById('view-gradebook');
        if (gradebookView && !gradebookView.classList.contains('hidden')) {
            setTimeout(() => { loadDataForCurrentClass(); }, 300);
        }
    });

    // ==========================================
    // 介面內部互動委派 (無 true，正常冒泡處理)
    // ==========================================
    document.addEventListener('click', async (e) => {
        
        // 1. 開啟批改艙
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

        // 2. 關閉批改艙
        if (e.target.closest('[data-action="close-sidebar"]')) { closeSidebar(); return; }

        // 3. Click Outside: 點擊彈窗外部自動關閉
        const popover = document.querySelector(SELECTORS.popoverMount);
        if (popover && popover.innerHTML.trim() !== '') {
            const isInside = e.target.closest('[data-popover-content="true"]');
            const isWord = e.target.closest('[data-action="word-click"]');
            if (!isInside && !isWord) {
                popover.innerHTML = '';
            }
        }

        // 4. 點擊單字呼叫彈窗或標記
        const wordEl = e.target.closest('[data-action="word-click"]');
        if (wordEl) {
            const word = wordEl.getAttribute('data-word');
            const type = wordEl.getAttribute('data-type');
            
            if (type === 'ai' || type === 'manual') {
                const rect = wordEl.getBoundingClientRect();
                const posX = rect.left + (rect.width / 2);
                const posY = rect.top; // 精準定錨於單字正上方
                
                const html = window.GradebookTemplates.renderWordPopover(
                    word, wordEl.getAttribute('data-kk-std'), wordEl.getAttribute('data-kk-stu'), 
                    wordEl.getAttribute('data-time'), wordEl.getAttribute('data-issue'), 
                    type === 'manual', posX, posY
                );
                const pMount = document.querySelector(SELECTORS.popoverMount);
                if (pMount) pMount.innerHTML = html;
            } else {
                const selection = window.getSelection();
                if (selection.toString().length === 0) {
                    window.GradebookStore.toggleManualDefect(word);
                    reRenderSidebarContentOnly();
                }
            }
            return;
        }

        // 5. 音檔播放系列 (語調、學生音、TTS)
        const intonation = e.target.closest('[data-action="intonation-click"]');
        if (intonation) {
            const time = parseFloat(intonation.getAttribute('data-time') || 0);
            const audio = document.getElementById('student-audio');
            if (audio) { audio.currentTime = time; audio.play(); }
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

        // 6. ⚡ 詞庫無縫穿插技術
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

        // 7. 移除標記與儲存發布
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
                alert("🎉 批改已成功發布！");
                closeSidebar();
                loadDataForCurrentClass(); 
            } catch (err) {
                alert('❌ 儲存失敗：' + err.message);
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
        }
    });

    // 🛡️ 防禦 5: 找回反白選取文字自動加入標記的機制
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
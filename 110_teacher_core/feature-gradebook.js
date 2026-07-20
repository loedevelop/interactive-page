/**
 * 📂 110_teacher_core/feature-gradebook.js
 * 🎯 職責：老師端批改中樞的輕量指揮官 (Tier 4 Orchestrator)
 * ⚠️ 鐵律：將 DOM 事件委派給 Store 處理狀態，再呼叫 Template 渲染。
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
     * 初始化整個批改頁籤 (外部呼叫入口)
     */
    async function initMatrixView(classId, userRole) {
        if (!classId) return;
        _currentClassId = classId;
        _currentRole = userRole || 'primary_teacher';
        
        const container = document.querySelector(SELECTORS.matrixContainer);
        if (!container) return;

        container.innerHTML = `<div class="p-10 text-center text-blue-600 animate-pulse font-bold bg-white rounded-xl shadow-sm border border-gray-200">📡 正在從資料庫拉取成績單矩陣與 AI 分析數據...</div>`;

        try {
            const { matrixData, assignments } = await window.GradebookAPI.fetchMatrixData(classId);
            window.GradebookStore.initMatrix(matrixData, assignments);
            renderMatrixUI();
        } catch (err) {
            console.error(err);
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold bg-red-50 rounded-xl shadow-sm border border-red-200">❌ 載入失敗：${err.message}</div>`;
        }
    }

    function renderMatrixUI() {
        const state = window.GradebookStore.getMatrixState();
        const html = window.GradebookTemplates.renderMatrix(state.matrixData, state.assignments);
        document.querySelector(SELECTORS.matrixContainer).innerHTML = html;
    }

    function reRenderSidebarContentOnly() {
        // 僅重繪側邊欄內容，不觸發滑入滑出動畫 (防閃爍)
        document.querySelector(SELECTORS.popoverMount).innerHTML = ''; 
        const mount = document.querySelector(SELECTORS.sidebarMount);
        if (!mount) return;

        const context = window.GradebookStore.getActiveContext();
        mount.innerHTML = window.GradebookTemplates.renderSidebar(context, _currentRole);
        
        // 確保強制維持開啟狀態
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

        // 等待 CSS 動畫結束後清空 DOM
        setTimeout(() => {
            mount.innerHTML = '';
        }, 300);
    }

    // =========================================================
    // 全域事件委派 (Event Delegation) 統一接管所有點擊
    // =========================================================
    document.addEventListener('click', async (e) => {
        // --- 1. 攔截頁籤切換事件，自動初始化 ---
        const tabBtn = e.target.closest('.tab-btn[data-target="view-gradebook"]');
        if (tabBtn) {
            // 從全域模組取得目前的 ClassId
            const classId = window.TeacherUI ? window.TeacherUI.getCurrentClassId() : localStorage.getItem('lastClassId') || null;
            const role = window.TeacherUI ? window.TeacherUI.getCurrentUserRole() : 'primary_teacher';
            
            if (classId) {
                initMatrixView(classId, role);
            } else {
                document.querySelector(SELECTORS.matrixContainer).innerHTML = 
                    `<div class="p-10 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">請先從左側選擇一個班級</div>`;
            }
            return;
        }

        // --- 2. 矩陣上的點擊 (打開批改艙) ---
        const openBtn = e.target.closest('[data-action="open-grading"]');
        if (openBtn) {
            const subId = openBtn.getAttribute('data-submission-id');
            const stuId = openBtn.getAttribute('data-student-id');
            
            const state = window.GradebookStore.getMatrixState();
            const row = state.matrixData.find(r => String(r.student_id) === String(stuId));
            if (row && row.submissions) {
                // 容錯查找
                const submission = row.submissions[subId] || Object.values(row.submissions).find(s => String(s.id) === String(subId));
                if (submission) {
                    window.GradebookStore.setActiveSubmission(submission, row.defect_bank);
                    reRenderSidebarContentOnly(); // 渲染並強制滑出
                }
            }
            return;
        }

        // --- 3. 關閉按鈕與遮罩 ---
        if (e.target.closest('[data-action="close-sidebar"]')) {
            closeSidebar();
            return;
        }

        // --- 4. 點擊文稿單字 ---
        const wordEl = e.target.closest('[data-action="word-click"]');
        if (wordEl) {
            const word = wordEl.getAttribute('data-word');
            const type = wordEl.getAttribute('data-type');
            
            if (type === 'ai' || type === 'manual') {
                const rect = wordEl.getBoundingClientRect();
                // 計算氣泡絕對座標，針對 fixed 定位
                const posX = rect.left + (rect.width / 2);
                const posY = rect.bottom;
                
                const html = window.GradebookTemplates.renderWordPopover(
                    word, 
                    wordEl.getAttribute('data-kk-std'), 
                    wordEl.getAttribute('data-kk-stu'), 
                    wordEl.getAttribute('data-time'), 
                    wordEl.getAttribute('data-issue'), 
                    type === 'manual',
                    posX, 
                    posY
                );
                document.querySelector(SELECTORS.popoverMount).innerHTML = html;
            } else {
                // 點擊黑字，若沒有在反白，則加入手動標記
                const selection = window.getSelection();
                if (selection.toString().length === 0) {
                    window.GradebookStore.toggleManualDefect(word);
                    reRenderSidebarContentOnly();
                }
            }
            return;
        }

        // --- 5. 點擊語調波浪線 ---
        const intonation = e.target.closest('[data-action="intonation-click"]');
        if (intonation) {
            const time = parseFloat(intonation.getAttribute('data-time') || 0);
            const audio = document.getElementById('student-audio');
            if (audio) {
                audio.currentTime = time;
                audio.play();
            }
            return;
        }

        // --- 6. 氣泡框 (Popover) 內部按鈕 ---
        if (e.target.closest('[data-action="close-popover"]')) {
            document.querySelector(SELECTORS.popoverMount).innerHTML = '';
            return;
        }

        const playStuBtn = e.target.closest('[data-action="play-student"]');
        if (playStuBtn) {
            const time = parseFloat(playStuBtn.getAttribute('data-time') || 0);
            const audio = document.getElementById('student-audio');
            if (audio) {
                audio.currentTime = time > 0.5 ? time - 0.5 : 0; // 推前 0.5 秒
                audio.play();
            }
            return;
        }

        const playTtsBtn = e.target.closest('[data-action="play-tts"]');
        if (playTtsBtn) {
            const word = playTtsBtn.getAttribute('data-word');
            // 回退機制：目前呼叫瀏覽器原生 Web Speech API
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';
            utterance.rate = 0.85;
            window.speechSynthesis.speak(utterance);
            return;
        }

        const removeAiBtn = e.target.closest('[data-action="remove-ai"]');
        if (removeAiBtn) {
            window.GradebookStore.toggleAiDefectRemoval(removeAiBtn.getAttribute('data-word'));
            reRenderSidebarContentOnly();
            return;
        }

        const removeManBtn = e.target.closest('[data-action="remove-manual"]');
        if (removeManBtn) {
            window.GradebookStore.toggleManualDefect(removeManBtn.getAttribute('data-word'));
            reRenderSidebarContentOnly();
            return;
        }

        // --- 7. 發布成績與儲存 ---
        const saveBtn = e.target.closest('[data-action="save-publish"]');
        if (saveBtn) {
            saveBtn.disabled = true;
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '🔄 資料寫入與缺陷庫同步中...';
            
            // 強制同步輸入框至 Store
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
                // 重新載入矩陣刷新分數與燈號
                initMatrixView(_currentClassId, _currentRole);
            } catch (err) {
                alert('❌ 儲存失敗：' + err.message);
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
            return;
        }
    });

    // =========================================================
    // 文字反白防呆補刀機制 (滑鼠放開時觸發)
    // =========================================================
    document.addEventListener('mouseup', () => {
        const sidebarPanel = document.getElementById('grading-sidebar-panel');
        // 確保是在批改艙開啟時才觸發
        if (!sidebarPanel || sidebarPanel.classList.contains('translate-x-full')) return;

        const selection = window.getSelection();
        const text = selection.toString().trim();
        // 條件：必須是長度小於20的純英文字母/撇號組合
        if (text && text.length > 0 && text.length < 20 && /^[a-zA-Z']+$/.test(text)) {
            if (confirm(`是否將 [ ${text} ] 手動標記為發音錯誤？`)) {
                window.GradebookStore.toggleManualDefect(text);
                reRenderSidebarContentOnly();
            }
            selection.removeAllRanges(); // 清除反白
        }
    });

    return {
        initMatrixView
    };
})();
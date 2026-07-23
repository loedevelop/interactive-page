/**
 * 📂 檔案路徑：120_student_core/feature-student-audio.js
 * 🌟 學生端輕量指揮官：硬體授權、狀態機切換、5 分鐘防護與 Base64 轉換
 * 🚀 v55 逆向追蹤引擎版：導入 VisualViewport 數學計算，徹底讓 Dock 免疫 Android 全局縮放！
 */

window.FeatureStudentAudio = (function() {
    let mediaRecorder = null;
    let audioChunks = [];
    let audioBlob = null;
    let timerInterval = null;
    const MAX_SECONDS = 300; 
    let remainingSeconds = MAX_SECONDS;
    
    let el = {};
    let onSubmitCallback = null;

    // --- 🚀 核心武裝：Visual Viewport 追蹤引擎 ---
    let vvHandler = null;
    let rafId = null;

    function setupVisualViewport() {
        const dock = document.getElementById('audio-dock-section');
        if (!dock || !window.visualViewport) return;

        const stabilize = () => {
            if (window.innerWidth > 768) {
                dock.style.cssText = '';
                return;
            }

            const vv = window.visualViewport;
            const scale = vv.scale;

            // 只要有縮放，引擎就接管
            if (scale > 1.01) {
                const invScale = 1 / scale;
                const vw = vv.width;
                const vh = vv.height;
                
                // Dock 視覺寬度設定為螢幕的 92%
                const targetWidthVisual = vw * 0.92;
                // 反推在 Layout Viewport 中的實體寬度
                const layoutWidth = targetWidthVisual * scale; 
                
                // 必須先設置寬度，才能讀取正確的物理高度
                dock.style.setProperty('width', `${layoutWidth}px`, 'important');
                const layoutHeight = dock.offsetHeight;
                const targetHeightVisual = layoutHeight * invScale;
                
                // 安全邊緣 (15px padding)
                const paddingBottomVisual = 15 * invScale;
                
                // 🌟 絕對座標計算 (左上角為 0,0 基準，根絕下沉 Bug)
                const x = vv.offsetLeft + (vw - targetWidthVisual) / 2;
                const y = vv.offsetTop + vh - targetHeightVisual - paddingBottomVisual;
                
                // 暴力寫入：斷開原始 CSS 鎖鏈，以實體螢幕座標強制繪製
                dock.style.cssText = `
                    position: fixed !important;
                    left: ${x}px !important;
                    top: ${y}px !important;
                    bottom: auto !important;
                    right: auto !important;
                    width: ${layoutWidth}px !important;
                    transform-origin: 0 0 !important;
                    transform: scale(${invScale}) !important;
                    z-index: 2147483647 !important;
                    transition: none !important;
                `;
            } else {
                // 無縮放時，歸還給純 CSS 處理
                dock.style.cssText = '';
            }
        };

        vvHandler = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(stabilize);
        };

        // 綁定事件：不管是雙指縮放(resize)還是單指拖曳滑動(scroll)，Dock 永遠死死跟隨
        window.visualViewport.addEventListener('resize', vvHandler);
        window.visualViewport.addEventListener('scroll', vvHandler);
        
        // 初次校準
        setTimeout(vvHandler, 100);
    }

    function cleanupVisualViewport() {
        if (vvHandler && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', vvHandler);
            window.visualViewport.removeEventListener('scroll', vvHandler);
            vvHandler = null;
            if (rafId) cancelAnimationFrame(rafId);
        }
    }
    // ---------------------------------------------

    function initDOM() {
        el = {
            modal: document.getElementById('audio-studio-modal'),
            btnClose: document.getElementById('btn-audio-close'),
            statusDot: document.getElementById('audio-status-dot'),
            statusText: document.getElementById('audio-status-text'),
            timerDisplay: document.getElementById('audio-timer-display'),
            btnStart: document.getElementById('btn-audio-start'),
            btnPause: document.getElementById('btn-audio-pause'),
            btnResume: document.getElementById('btn-audio-resume'),
            btnStop: document.getElementById('btn-audio-stop'),
            previewSection: document.getElementById('audio-preview-section'),
            audioPlayback: document.getElementById('audio-playback'),
            btnRetry: document.getElementById('btn-audio-retry'),
            btnSubmit: document.getElementById('btn-audio-submit')
        };

        el.btnClose.addEventListener('click', closeStudio);
        el.btnStart.addEventListener('click', startRecording);
        el.btnPause.addEventListener('click', pauseRecording);
        el.btnResume.addEventListener('click', resumeRecording);
        el.btnStop.addEventListener('click', stopRecording);
        el.btnRetry.addEventListener('click', resetStudio);
        el.btnSubmit.addEventListener('click', submitAudio);
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function tickTimer() {
        if (remainingSeconds <= 0) {
            stopRecording(); 
            return;
        }
        remainingSeconds--;
        el.timerDisplay.textContent = formatTime(remainingSeconds);
        
        if (remainingSeconds <= 30) {
            el.timerDisplay.style.color = '#ef4444';
        }
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            let mimeType = '';
            const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
            for (let type of types) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }
            
            mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = handleRecordingStop;
            mediaRecorder.start(200); 

            el.btnStart.style.display = 'none';
            el.btnPause.style.display = 'flex';
            el.btnStop.style.display = 'flex';
            
            el.statusDot.style.backgroundColor = '#ef4444';
            el.statusText.textContent = '錄音中...';
            el.statusText.style.color = '#ef4444';
            
            remainingSeconds = MAX_SECONDS;
            el.timerDisplay.textContent = formatTime(remainingSeconds);
            el.timerDisplay.style.color = '#0f172a';
            timerInterval = setInterval(tickTimer, 1000);

        } catch (err) {
            console.error('[FeatureStudentAudio] 麥克風存取錯誤:', err);
            alert('無法存取麥克風，請檢查瀏覽器隱私權與硬體設定。');
        }
    }

    function pauseRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
            clearInterval(timerInterval);
            
            el.btnPause.style.display = 'none';
            el.btnResume.style.display = 'flex';
            el.statusDot.style.backgroundColor = '#f59e0b';
            el.statusText.textContent = '已暫停';
            el.statusText.style.color = '#f59e0b';
        }
    }

    function resumeRecording() {
        if (mediaRecorder && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
            timerInterval = setInterval(tickTimer, 1000);
            
            el.btnResume.style.display = 'none';
            el.btnPause.style.display = 'flex';
            el.statusDot.style.backgroundColor = '#ef4444';
            el.statusText.textContent = '錄音中...';
            el.statusText.style.color = '#ef4444';
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            clearInterval(timerInterval);
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    function handleRecordingStop() {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        audioBlob = new Blob(audioChunks, { type: mimeType });
        
        el.audioPlayback.src = URL.createObjectURL(audioBlob);
        
        el.btnStart.style.display = 'none';
        el.btnPause.style.display = 'none';
        el.btnResume.style.display = 'none';
        el.btnStop.style.display = 'none';
        el.previewSection.style.display = 'flex';
        
        el.statusDot.style.backgroundColor = '#10b981';
        el.statusText.textContent = '錄音完成';
        el.statusText.style.color = '#10b981';
    }

    function resetStudio() {
        if (el.audioPlayback.src) {
            URL.revokeObjectURL(el.audioPlayback.src); 
        }
        audioChunks = [];
        audioBlob = null;
        remainingSeconds = MAX_SECONDS;
        clearInterval(timerInterval);
        
        el.previewSection.style.display = 'none';
        el.btnStart.style.display = 'flex';
        el.timerDisplay.textContent = formatTime(remainingSeconds);
        el.timerDisplay.style.color = '#0f172a';
        
        el.statusDot.style.backgroundColor = '#cbd5e1';
        el.statusText.textContent = '準備就緒';
        el.statusText.style.color = '#64748b';
    }

    function closeStudio() {
        stopRecording();
        if (timerInterval) clearInterval(timerInterval);
        cleanupVisualViewport(); // 🧹 關閉時清空追蹤引擎
        if (el.modal) el.modal.remove(); 
        onSubmitCallback = null;
    }

    async function submitAudio() {
        if (!audioBlob) return;
        
        el.btnSubmit.disabled = true;
        el.btnSubmit.innerHTML = '📦 處理中...';
        
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result.split(',')[1];
                const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
                
                const getIsoTs = window.DateUtils ? window.DateUtils.getTaiwanIsoTimestamp : 
                               (window.UtilsDate ? window.UtilsDate.getTaiwanIsoTimestamp : () => new Date().toISOString());
                const timestamp = getIsoTs().replace(/[:.]/g, '-');
                const fileName = `Audio_${timestamp}.${ext}`;
                
                if (typeof onSubmitCallback === 'function') {
                    await onSubmitCallback({
                        base64: base64Data,
                        fileName: fileName,
                        mimeType: audioBlob.type
                    });
                }
                
                closeStudio();
            };
            reader.onerror = () => { throw new Error('FileReader Error'); };
            reader.readAsDataURL(audioBlob);
            
        } catch (error) {
            console.error('[FeatureStudentAudio] 繳交封裝失敗:', error);
            alert('系統處理錯誤，請稍後再試。');
            el.btnSubmit.disabled = false;
            el.btnSubmit.innerHTML = '🚀 繳交';
        }
    }

    return {
        openStudio: function(taskTitle, transcriptText, materialUrl, materialRange, submitCallback) {
            closeStudio(); 
            onSubmitCallback = submitCallback;
            
            const htmlString = window.UIAudioTemplates.getRecordingStudioHTML(transcriptText, taskTitle, materialUrl, materialRange);
            document.body.insertAdjacentHTML('beforeend', htmlString);
            
            initDOM();
            setupVisualViewport(); // 🚀 啟動追蹤引擎
        }
    };
})();
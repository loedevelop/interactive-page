window.FeatureStudentAudio = (function() {
    let mediaRecorder = null;
    let audioChunks = [];
    let audioBlob = null;
    let timerInterval = null;
    const MAX_SECONDS = 300; // 5分鐘硬極限
    let remainingSeconds = MAX_SECONDS;
    
    let el = {};
    let onSubmitCallback = null;

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
            stopRecording(); // 強制煞車，保護記憶體
            return;
        }
        remainingSeconds--;
        el.timerDisplay.textContent = formatTime(remainingSeconds);
        
        // 剩餘 30 秒警告色
        if (remainingSeconds <= 30) {
            el.timerDisplay.style.color = '#ef4444';
        }
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // 嘗試取得跨平台支援的 MIME Type
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
            mediaRecorder.start(200); // 確保斷線不掉檔

            // UI 狀態機 -> recording
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
            
            // UI 狀態機 -> paused
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
            
            // UI 狀態機 -> recording
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
        
        // UI 狀態機 -> review
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
            URL.revokeObjectURL(el.audioPlayback.src); // 釋放舊記憶體防 OOM
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
        if (el.modal) el.modal.remove(); // 徹底摧毀 DOM
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
                
                // [架構鐵律] 唯一允許的 UtilsDate 呼叫，確保時間戳記標準化
                const timestamp = window.UtilsDate.getTaiwanIsoTimestamp().replace(/[:.]/g, '-');
                const fileName = `Audio_${timestamp}.${ext}`;
                
                if (typeof onSubmitCallback === 'function') {
                    // 將封裝好的資料回傳，交由 Timeline / API 層處理 GAS 上傳
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
            el.btnSubmit.innerHTML = '🚀 一鍵繳交';
        }
    }

    return {
        /**
         * Timeline 外部呼叫點，無縫開啟錄音艙
         * @param {string} taskTitle 任務標題
         * @param {string} transcriptText 純文字原稿 (直接從 JSONB 中撈取)
         * @param {Function} submitCallback 封裝完成後的回傳函式
         */
        openStudio: function(taskTitle, transcriptText, submitCallback) {
            closeStudio(); 
            onSubmitCallback = submitCallback;
            
            const htmlString = window.UIAudioTemplates.getRecordingStudioHTML(transcriptText, taskTitle);
            document.body.insertAdjacentHTML('beforeend', htmlString);
            
            initDOM();
        }
    };
})();
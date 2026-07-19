/**
 * 📂 檔案路徑：120_student_core/feature-student-audio.js
 * 🌟 學生端輕量指揮官：硬體授權、狀態機切換、5 分鐘防護與 Base64 轉換
 * 🔄 v25 沉浸式錄音艙更新版：完美配合 Dock 響應式佈局切換
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
                
                const timestamp = window.UtilsDate.getTaiwanIsoTimestamp().replace(/[:.]/g, '-');
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
        }
    };
})();
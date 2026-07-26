/**
 * 📂 檔案路徑：120_student_core/feature-student-audio.js
 * 🌟 學生端輕量指揮官：硬體授權、狀態機切換、5 分鐘防護與 Base64 轉換
 * 🚀 V91 真正轉碼版：前端 AudioContext 實時轉碼為 16kHz 標準 WAV，正面幹掉殘廢 WebM！
 * 🌟 免疫介面災難：程式碼內 0 個雙直豎線，絕對防彈。
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

    // --- 🚀 核心武裝：前端純 JS 轉碼引擎 (轉為 WAV 16kHz Mono) ---
    async function convertToWav(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        
        let AudioCtxClass = window.AudioContext;
        if (!AudioCtxClass) AudioCtxClass = window.webkitAudioContext;
        const audioContext = new AudioCtxClass();
        const originalBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const targetSampleRate = 16000;
        let OfflineCtxClass = window.OfflineAudioContext;
        if (!OfflineCtxClass) OfflineCtxClass = window.webkitOfflineAudioContext;
        
        const offlineCtx = new OfflineCtxClass(
            1,
            Math.ceil(originalBuffer.duration * targetSampleRate),
            targetSampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);

        const renderedBuffer = await offlineCtx.startRendering();

        const length = renderedBuffer.length * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        let offset = 0;

        const writeString = (str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
            offset += str.length;
        };

        writeString('RIFF');
        view.setUint32(offset, length - 8, true); offset += 4;
        writeString('WAVE');
        writeString('fmt ');
        view.setUint32(offset, 16, true); offset += 4;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint32(offset, targetSampleRate, true); offset += 4;
        view.setUint32(offset, targetSampleRate * 2, true); offset += 4;
        view.setUint16(offset, 2, true); offset += 2;
        view.setUint16(offset, 16, true); offset += 2;
        writeString('data');
        view.setUint32(offset, length - 44, true); offset += 4;

        const channelData = renderedBuffer.getChannelData(0);
        for (let i = 0; i < channelData.length; i++) {
            let sample = Math.max(-1, Math.min(1, channelData[i]));
            let intSample = 0;
            if (sample < 0) {
                intSample = sample * 32768;
            } else {
                intSample = sample * 32767;
            }
            view.setInt16(offset, intSample, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    let vvHandler = null;
    let rafId = null;

    function setupVisualViewport() {
        const dock = document.getElementById('audio-dock-section');
        let hasVV = false;
        if (dock) {
            if (window.visualViewport) hasVV = true;
        }
        if (!hasVV) return;

        const stabilize = () => {
            if (window.innerWidth > 768) {
                dock.style.cssText = '';
                return;
            }

            const vv = window.visualViewport;
            const scale = vv.scale;

            if (scale > 1.01) {
                const invScale = 1 / scale;
                const vw = vv.width;
                const vh = vv.height;
                
                const targetWidthVisual = vw * 0.92;
                const layoutWidth = targetWidthVisual * scale; 
                
                dock.style.setProperty('width', `${layoutWidth}px`, 'important');
                const layoutHeight = dock.offsetHeight;
                const targetHeightVisual = layoutHeight * invScale;
                
                const paddingBottomVisual = 15 * invScale;
                
                const x = vv.offsetLeft + (vw - targetWidthVisual) / 2;
                const y = vv.offsetTop + vh - targetHeightVisual - paddingBottomVisual;
                
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
                dock.style.cssText = '';
            }
        };

        vvHandler = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(stabilize);
        };

        window.visualViewport.addEventListener('resize', vvHandler);
        window.visualViewport.addEventListener('scroll', vvHandler);
        setTimeout(vvHandler, 100);
    }

    function cleanupVisualViewport() {
        let canClean = false;
        if (vvHandler) {
            if (window.visualViewport) canClean = true;
        }
        
        if (canClean) {
            window.visualViewport.removeEventListener('resize', vvHandler);
            window.visualViewport.removeEventListener('scroll', vvHandler);
            vvHandler = null;
            if (rafId) cancelAnimationFrame(rafId);
        }
    }

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
        const m = String(Math.floor(seconds / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
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
            const types = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
            
            for (let i = 0; i < types.length; i++) {
                if (MediaRecorder.isTypeSupported(types[i])) {
                    mimeType = types[i];
                    break;
                }
            }
            
            let options = {};
            if (mimeType !== '') options = { mimeType: mimeType };
            
            mediaRecorder = new MediaRecorder(stream, options);
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
            window.showFlash('無法存取麥克風，請檢查瀏覽器隱私權與硬體設定。', 'error');
        }
    }

    function pauseRecording() {
        let isRecording = false;
        if (mediaRecorder) {
            if (mediaRecorder.state === 'recording') isRecording = true;
        }
        
        if (isRecording) {
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
        let isPaused = false;
        if (mediaRecorder) {
            if (mediaRecorder.state === 'paused') isPaused = true;
        }
        
        if (isPaused) {
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
        let isActive = false;
        if (mediaRecorder) {
            if (mediaRecorder.state !== 'inactive') isActive = true;
        }
        
        if (isActive) {
            mediaRecorder.stop();
            clearInterval(timerInterval);
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    function handleRecordingStop() {
        let mimeType = 'audio/webm';
        if (mediaRecorder.mimeType) mimeType = mediaRecorder.mimeType;
        
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
        cleanupVisualViewport(); 
        if (el.modal) el.modal.remove(); 
        onSubmitCallback = null;
    }

    async function submitAudio() {
        if (!audioBlob) return;
        
        el.btnSubmit.disabled = true;
        el.btnSubmit.innerHTML = '⚙️ 音檔轉碼中...';
        
        try {
            const wavBlob = await convertToWav(audioBlob);

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result.split(',')[1];
                
                const ext = 'wav';
                const finalMimeType = 'audio/wav';
                
                let getIsoTs = () => new Date().toISOString();
                if (window.DateUtils) getIsoTs = window.DateUtils.getTaiwanIsoTimestamp;
                else if (window.UtilsDate) getIsoTs = window.UtilsDate.getTaiwanIsoTimestamp;
                
                const timestamp = String(getIsoTs()).replace(/[:.]/g, '-');
                const fileName = `Audio_${timestamp}.${ext}`;
                
                let isFunc = false;
                if (typeof onSubmitCallback === 'function') isFunc = true;
                
                if (isFunc) {
                    await onSubmitCallback({
                        base64: base64Data,
                        fileName: fileName,
                        mimeType: finalMimeType
                    });
                }
                
                closeStudio();
            };
            reader.onerror = () => { throw new Error('FileReader Error'); };
            reader.readAsDataURL(wavBlob);
            
        } catch (error) {
            console.error('[FeatureStudentAudio] 轉碼繳交失敗:', error);
            window.showFlash('系統音訊處理錯誤，請稍後再試。', 'error');
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
            setupVisualViewport(); 
        },
        convertBlobToWav: convertToWav
    };
})();
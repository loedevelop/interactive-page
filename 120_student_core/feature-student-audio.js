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
    let studioPages = [];
    let studioPageIndex = 0;
    let studioSubmittedKeys = {};
    let fallbackTranscript = '';

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
        renderPagePicker();
    }

    function currentStudioPage() {
        return studioPages[studioPageIndex] || null;
    }

    function pageLabel(unit, idx) {
        if (!unit) return '第 ' + (idx + 1) + ' 頁';
        return String(unit.label || unit.unit_key || ('第 ' + (idx + 1) + ' 頁'));
    }

    function escapeTranscriptHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '<br>');
    }

    function currentTranscriptText() {
        const page = currentStudioPage();
        const perPage = page && String(page.student_display || page.original_script || '').trim();
        if (perPage) return String(page.student_display || page.original_script);
        if (studioPages.length > 1) return '';
        return fallbackTranscript;
    }

    function updateTranscript() {
        const box = document.getElementById('audio-studio-transcript');
        if (!box) return;
        const text = currentTranscriptText();
        box.innerHTML = text
            ? escapeTranscriptHtml(text)
            : '<span style="color:#94A3B8;font-style:italic;">（這一頁沒有文稿）</span>';
    }

    function renderPagePicker() {
        const box = document.getElementById('audio-page-picker');
        if (!box) return;
        if (!studioPages.length || studioPages.length < 2) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }
        const opts = studioPages.map(function (u, i) {
            const key = String((u && u.unit_key) || '').trim();
            const pageKey = (u && u.page != null && u.page !== '') ? ('range:' + Number(u.page)) : '';
            const done = !!(key && studioSubmittedKeys[key]) || !!(pageKey && studioSubmittedKeys[pageKey]);
            const sel = i === studioPageIndex ? ' selected' : '';
            return '<option value="' + i + '"' + sel + '>'
                + (i + 1) + '/' + studioPages.length + '　' + pageLabel(u, i)
                + (done ? '　（已繳，重錄會蓋掉）' : '　（尚未繳）')
                + '</option>';
        }).join('');
        box.style.display = 'flex';
        box.innerHTML = '<label style="font-size:0.78rem; font-weight:800; color:rgba(255,255,255,0.9); white-space:nowrap;">本頁</label>'
            + '<select id="audio-page-select" style="max-width:260px; padding:3px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.35); background:rgba(255,255,255,0.95); color:#1e293b; font-weight:800; font-size:0.78rem;">'
            + opts + '</select>';
        const sel = document.getElementById('audio-page-select');
        if (sel) {
            sel.addEventListener('change', async function () {
                const next = Number(sel.value);
                if (next === studioPageIndex) return;
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    if (!(await window.ModalOverlay.confirm('正在錄音中，要改錄另一頁嗎？目前這段不會繳交。'))) {
                        sel.value = String(studioPageIndex);
                        return;
                    }
                    mediaRecorder.onstop = null;
                    try { mediaRecorder.stop(); } catch (_e) {}
                    if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(function (t) { t.stop(); });
                    mediaRecorder = null;
                    clearInterval(timerInterval);
                }
                studioPageIndex = next;
                resetStudio();
                updateTranscript();
            });
        }
        updateTranscript();
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
        studioPages = [];
        studioPageIndex = 0;
        studioSubmittedKeys = {};
        fallbackTranscript = '';
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
                const page = currentStudioPage();
                const pageTag = (page && page.page != null && page.page !== '')
                    ? ('p.' + page.page)
                    : (page && page.unit_key ? String(page.unit_key).replace(/[^\w.-]+/g, '_') : 'page');
                const fileName = `Audio_${pageTag}_${timestamp}.${ext}`;
                
                let isFunc = false;
                if (typeof onSubmitCallback === 'function') isFunc = true;
                
                if (isFunc) {
                    const submitResult = await onSubmitCallback({
                        base64: base64Data,
                        fileName: fileName,
                        mimeType: finalMimeType,
                        page: currentStudioPage(),
                        pageIndex: studioPageIndex
                    });
                    if (submitResult && submitResult.keepOpen) {
                        if (submitResult.submittedKeys) studioSubmittedKeys = submitResult.submittedKeys;
                        if (typeof submitResult.nextIndex === 'number' && submitResult.nextIndex >= 0) {
                            studioPageIndex = submitResult.nextIndex;
                        }
                        resetStudio();
                        renderPagePicker();
                        el.btnSubmit.disabled = false;
                        el.btnSubmit.innerHTML = '🚀 繳交';
                        return;
                    }
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

    async function renderMappedPdfPages(fileId, pages) {
        const host = document.getElementById('audio-mapped-pdf');
        if (!host) return;
        const id = String(fileId || '').trim();
        const list = Array.isArray(pages) ? pages.filter(function (n) { return Number(n) > 0; }) : [];
        if (!id || !list.length) return;
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.loadPdfDocumentFromDrive !== 'function') {
            host.textContent = '無法載入對照 PDF（PdfExamPaper 尚未載入）';
            return;
        }
        host.textContent = '載入對照頁…';
        try {
            const pdfDoc = await window.PdfExamPaper.loadPdfDocumentFromDrive(id);
            host.innerHTML = '';
            for (let i = 0; i < list.length; i++) {
                const pageNum = Number(list[i]);
                if (pageNum < 1 || pageNum > pdfDoc.numPages) {
                    const miss = document.createElement('div');
                    miss.style.cssText = 'margin:8px 0; color:#B91C1C; font-weight:800;';
                    miss.textContent = '對照到的檔案頁 ' + pageNum + ' 超出這份 PDF（共 ' + pdfDoc.numPages + ' 頁）';
                    host.appendChild(miss);
                    continue;
                }
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.4 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.cssText = 'width:100%; height:auto; display:block; margin-bottom:10px; background:white; box-shadow:0 1px 4px rgba(15,23,42,0.12);';
                await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
                const cap = document.createElement('div');
                cap.style.cssText = 'font-size:0.78rem; font-weight:800; color:#64748B; margin:8px 0 4px;';
                cap.textContent = '檔案頁 ' + pageNum;
                host.appendChild(cap);
                host.appendChild(canvas);
            }
        } catch (err) {
            host.textContent = '無法載入對照 PDF：' + ((err && err.message) || err);
        }
    }

    return {
        openStudio: function(taskTitle, transcriptText, materialUrl, materialRange, submitCallback, studioOpts) {
            closeStudio(); 
            onSubmitCallback = submitCallback;
            studioOpts = studioOpts || {};
            studioPages = Array.isArray(studioOpts.pages) ? studioOpts.pages : [];
            studioPageIndex = studioOpts.initialIndex != null ? Number(studioOpts.initialIndex) : 0;
            if (studioPageIndex < 0 || studioPageIndex >= studioPages.length) studioPageIndex = 0;
            studioSubmittedKeys = studioOpts.submittedKeys && typeof studioOpts.submittedKeys === 'object'
                ? Object.assign({}, studioOpts.submittedKeys)
                : {};
            fallbackTranscript = String(transcriptText || '');
            const initialPage = studioPages[studioPageIndex];
            const initialText = (initialPage && String(initialPage.student_display || initialPage.original_script || '').trim())
                ? String(initialPage.student_display || initialPage.original_script)
                : (studioPages.length > 1 ? '' : fallbackTranscript);
            const htmlString = window.UIAudioTemplates.getRecordingStudioHTML(initialText, taskTitle, materialUrl, materialRange, studioOpts);
            document.body.insertAdjacentHTML('beforeend', htmlString);
            
            initDOM();
            setupVisualViewport();
            renderMappedPdfPages(studioOpts.pdfFileId, studioOpts.pdfPages);
        },
        convertBlobToWav: convertToWav
    };
})();
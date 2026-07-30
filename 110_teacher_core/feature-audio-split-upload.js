/**
 * 📂 110_teacher_core/feature-audio-split-upload.js
 * 🌟 教師端：把「舊制一次錄完好幾頁」的學生繳交音檔，直接在瀏覽器裡切成一頁一檔，
 *    上傳回同一位學生的 01_Submissions，讓既有的「一頁一檔」AI 批改管線可以逐頁批改。
 *
 * 設計重點（勿再翻案，見對話紀錄）：
 * - 直接抓「學生已經繳交」的音檔（Supabase stream-audio），不需老師另外下載再上傳。
 * - 原始檔案「不會」被刪除或搬動，只在同一個 01_Submissions 資料夾內新增切好的檔案。
 * - 上傳前一定驗證目標資料夾就是該生的 01_Submissions，驗證失敗就整批擋下來。
 * - 切完＋上傳成功後，直接呼叫 submit_audio_task_atomic 帶 p_segments 補進資料庫，
 *   讓學生端與「補啟 AI 批改」看到的都是最新分頁結果。
 */
window.FeatureAudioSplitUpload = (function () {
    'use strict';

    let cachedContext = null; // { classId, assignTaskMap, students, completions }

    const state = {
        assignmentId: '',
        taskId: '',
        studentId: '',
        audioBuffer: null,
        audioDuration: 0,
        sourceFileId: '',
        boundaries: [], // 內部切點（不含頭尾），秒數
        folderCheck: null, // { ok: boolean, name: string, autoFixed?: boolean }
        effectiveFolderId: '', // 實際會上傳的資料夾（可能是自動修正後的 01_Submissions 子資料夾）
        loadingAudio: false,
        uploading: false,
        uploadLog: []
    };

    // ============ 小工具 ============

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function sanitizeFileName(str) {
        return String(str || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .trim() || 'segment';
    }

    function formatMMSS(totalSeconds) {
        const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
        const mm = Math.floor(s / 60);
        const ss = s % 60;
        return mm + ':' + String(ss).padStart(2, '0');
    }

    function parseMMSS(text) {
        const str = String(text || '').trim();
        if (!str) return NaN;
        if (str.indexOf(':') === -1) return Number(str);
        const parts = str.split(':').map(function (p) { return Number(p); });
        if (parts.some(isNaN)) return NaN;
        let seconds = 0;
        for (let i = 0; i < parts.length; i++) seconds = seconds * 60 + parts[i];
        return seconds;
    }

    function todayKey() {
        const d = new Date();
        return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    }

    function getGradingUnits(task) {
        return (task && task.raw_data && Array.isArray(task.raw_data.grading_units)) ? task.raw_data.grading_units : [];
    }

    function getMaterialFolder(task) {
        const raw = (task && task.raw_data) ? task.raw_data : {};
        const ref = raw.material_ref || (Array.isArray(raw.material_refs) && raw.material_refs[0]) || {};
        return String(ref.material_folder || '').trim();
    }

    function flattenRecordingTasks(tasks) {
        const res = [];
        if (!Array.isArray(tasks)) return res;
        tasks.forEach(function (t) {
            if (t.type === 'group' && Array.isArray(t.subTasks)) {
                res.push.apply(res, flattenRecordingTasks(t.subTasks));
            } else if (window.TaskScriptResolver && window.TaskScriptResolver.isRecordingTaskType(t)) {
                res.push(t);
            }
        });
        return res;
    }

    function getSourceFileId(comp) {
        if (!comp) return null;
        const raw = comp.raw_data || {};
        if (Array.isArray(raw.drive_file_ids) && raw.drive_file_ids.length) return String(raw.drive_file_ids[0]);
        const url = raw.student_audio_url || raw.audio_url;
        if (url && window.GasService && typeof window.GasService.extractFileIdFromUrl === 'function') {
            return window.GasService.extractFileIdFromUrl(url);
        }
        return null;
    }

    function isTransientDriveUploadError(err) {
        const msg = String((err && err.message) || err || '').toLowerCase();
        return msg.indexOf('timeout') > -1
            || msg.indexOf('rate') > -1
            || msg.indexOf('quota') > -1
            || msg.indexOf('backend error') > -1
            || msg.indexOf('internal error') > -1
            || msg.indexOf('503') > -1
            || msg.indexOf('500') > -1
            || msg.indexOf('連線異常') > -1
            || msg.indexOf('failed to fetch') > -1;
    }

    function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

    async function uploadSegmentWithRetry(base64, fileName, mimeType, folderId, assignmentId, taskId, maxRetries) {
        maxRetries = maxRetries || 3;
        let lastErr = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const fileUrl = await window.GasService.uploadStudentLocalFile(base64, fileName, mimeType, folderId, assignmentId, taskId, '');
                return fileUrl;
            } catch (err) {
                lastErr = err;
                if (attempt < maxRetries && isTransientDriveUploadError(err)) {
                    await sleep(1500 * attempt);
                    continue;
                }
                throw err;
            }
        }
        throw lastErr;
    }

    // ============ WAV 編碼（瀏覽器端切割） ============

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function sliceToWavBase64(audioBuffer, startSec, endSec) {
        const sampleRate = audioBuffer.sampleRate;
        const startSample = Math.max(0, Math.floor(startSec * sampleRate));
        const endSample = Math.min(audioBuffer.length, Math.ceil(endSec * sampleRate));
        const frameCount = Math.max(0, endSample - startSample);
        const numChannels = audioBuffer.numberOfChannels;

        const mono = new Float32Array(frameCount);
        for (let ch = 0; ch < numChannels; ch++) {
            const data = audioBuffer.getChannelData(ch);
            for (let i = 0; i < frameCount; i++) {
                mono[i] += data[startSample + i] / numChannels;
            }
        }

        const buffer = new ArrayBuffer(44 + frameCount * 2);
        const view = new DataView(buffer);
        function writeString(offset, str) {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        }
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + frameCount * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, frameCount * 2, true);

        let offset = 44;
        for (let i = 0; i < frameCount; i++) {
            const s = Math.max(-1, Math.min(1, mono[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }

        return arrayBufferToBase64(buffer);
    }

    // ============ 資料整理 ============

    function buildAssignTaskMap(assignments) {
        const map = {};
        (assignments || []).forEach(function (a) {
            const tasks = window.TaskScriptResolver
                ? window.TaskScriptResolver.parseTasks(a.tasks)
                : (a.tasks || []);
            const recordingTasks = flattenRecordingTasks(tasks).filter(function (t) {
                return getGradingUnits(t).length > 1;
            });
            if (!recordingTasks.length) return;

            map[a.id] = {
                id: a.id,
                title: a.title || '未命名作業',
                targetDate: a.target_date || '',
                tasks: {}
            };
            recordingTasks.forEach(function (t) {
                map[a.id].tasks[t.id] = {
                    id: t.id,
                    title: t.title ? String(t.title).replace(/<[^>]*>?/gm, '') : '未命名任務',
                    gradingUnits: getGradingUnits(t),
                    materialFolder: getMaterialFolder(t)
                };
            });
        });
        return map;
    }

    function getSelectedAssignment() {
        return cachedContext ? cachedContext.assignTaskMap[state.assignmentId] : null;
    }

    function getSelectedTask() {
        const a = getSelectedAssignment();
        return a ? a.tasks[state.taskId] : null;
    }

    function getSelectedStudent() {
        if (!cachedContext) return null;
        return cachedContext.students.find(function (s) { return String(s.id) === String(state.studentId); }) || null;
    }

    function getSelectedCompletion() {
        if (!cachedContext) return null;
        return cachedContext.completions.find(function (c) {
            return String(c.assignment_id) === String(state.assignmentId)
                && String(c.task_id) === String(state.taskId)
                && String(c.student_id) === String(state.studentId);
        }) || null;
    }

    function getEligibleStudentsForTask() {
        if (!cachedContext || !state.assignmentId || !state.taskId) return [];
        return cachedContext.completions.filter(function (c) {
            return String(c.assignment_id) === String(state.assignmentId)
                && String(c.task_id) === String(state.taskId)
                && !c.deleted_at
                && getSourceFileId(c);
        }).map(function (c) {
            const student = cachedContext.students.find(function (s) { return String(s.id) === String(c.student_id); });
            return { completion: c, student: student || { id: c.student_id, name: '未知學生' } };
        });
    }

    // ============ 資料夾驗證 ============

    async function checkTargetFolder() {
        state.folderCheck = { ok: null, name: '驗證中…' };
        state.effectiveFolderId = '';
        renderBody();

        const student = getSelectedStudent();
        if (!student || !student.drive_folder_id) {
            state.folderCheck = { ok: false, name: '（此學生尚未設定 Drive 資料夾，請先到「班級成員管理」設定）' };
            renderBody();
            return;
        }
        try {
            const result = await window.GasService.listChildFolders(student.drive_folder_id);
            const name = result.parentName || '';
            if (name === '01_Submissions') {
                state.effectiveFolderId = student.drive_folder_id;
                state.folderCheck = { ok: true, name: name };
            } else {
                // 🛡️ 常見誤設：enrollment.drive_folder_id 存成學生根目錄（姓名_短ID）而非其下的
                // 01_Submissions。與 gas/Code.gs 的 upload_file 保險絲同一邏輯：
                // 若能在子資料夾找到 01_Submissions，自動改用它，不強迫老師先去資料庫修欄位。
                const submissionsChild = (result.folders || []).find(function (f) { return f.name === '01_Submissions'; });
                if (submissionsChild) {
                    state.effectiveFolderId = submissionsChild.id;
                    state.folderCheck = { ok: true, name: name, autoFixed: true };
                } else {
                    state.folderCheck = { ok: false, name: name };
                }
            }
        } catch (err) {
            state.folderCheck = { ok: false, name: '（驗證失敗：' + (err.message || err) + '）' };
        }
        renderBody();
    }

    // ============ 音檔載入 ============

    async function loadAudio() {
        const comp = getSelectedCompletion();
        const fileId = comp ? getSourceFileId(comp) : null;
        if (!fileId) {
            window.showFlash('這位學生在此任務找不到可切割的已繳交音檔', 'error');
            return;
        }
        state.sourceFileId = fileId;
        state.loadingAudio = true;
        renderBody();

        try {
            const streamUrl = window.ApiService.getAudioStreamUrl(fileId);
            const res = await fetch(streamUrl);
            if (!res.ok) throw new Error('下載音檔失敗（HTTP ' + res.status + '）');
            const arrayBuffer = await res.arrayBuffer();
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioCtx();
            const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
            state.audioBuffer = decoded;
            state.audioDuration = decoded.duration;

            const task = getSelectedTask();
            const pageCount = task ? task.gradingUnits.length : 2;
            state.boundaries = [];
            for (let i = 1; i < pageCount; i++) {
                state.boundaries.push(Math.round((decoded.duration * i) / pageCount * 10) / 10);
            }
        } catch (err) {
            window.showFlash('載入音檔失敗：' + (err.message || err), 'error');
            state.audioBuffer = null;
        } finally {
            state.loadingAudio = false;
            renderBody();
        }
    }

    // ============ 切割＋上傳 ============

    function getBoundaryFromInput(idx) {
        const el = document.getElementById('asu-cut-' + idx);
        if (!el) return state.boundaries[idx];
        const v = parseMMSS(el.value);
        return isNaN(v) ? state.boundaries[idx] : v;
    }

    function syncBoundariesFromInputs() {
        state.boundaries = state.boundaries.map(function (b, idx) { return getBoundaryFromInput(idx); });
    }

    function useCurrentPlaybackTime(idx) {
        const player = document.getElementById('asu-audio-player');
        const input = document.getElementById('asu-cut-' + idx);
        if (!player || !input) return;
        input.value = formatMMSS(player.currentTime);
        state.boundaries[idx] = player.currentTime;
        updatePagePreview();
    }

    function previewBoundary(idx) {
        const player = document.getElementById('asu-audio-player');
        if (!player) return;
        syncBoundariesFromInputs();
        player.currentTime = state.boundaries[idx];
        player.play();
    }

    function updatePagePreview() {
        syncBoundariesFromInputs();
        const task = getSelectedTask();
        if (!task) return;
        const bounds = [0].concat(state.boundaries, [state.audioDuration]);
        const el = document.getElementById('asu-page-preview');
        if (!el) return;
        el.innerHTML = task.gradingUnits.map(function (u, i) {
            const dur = Math.max(0, bounds[i + 1] - bounds[i]);
            return '<div style="padding:4px 0;color:#475569;">📄 ' + esc(u.label || u.unit_key || ('第 ' + (i + 1) + ' 頁'))
                + ' ：' + formatMMSS(bounds[i]) + ' ~ ' + formatMMSS(bounds[i + 1])
                + '（約 ' + dur.toFixed(1) + ' 秒）</div>';
        }).join('');
    }

    function validateBoundaries() {
        syncBoundariesFromInputs();
        const bounds = [0].concat(state.boundaries, [state.audioDuration]);
        for (let i = 0; i < bounds.length; i++) {
            if (isNaN(bounds[i])) return '切點格式錯誤，請用 分:秒（例如 0:47）';
        }
        for (let i = 1; i < bounds.length; i++) {
            if (bounds[i] <= bounds[i - 1]) return '切點必須依序遞增，且不可超過音檔總長 ' + formatMMSS(state.audioDuration);
        }
        return null;
    }

    async function submitSplitUpload() {
        if (state.uploading) return;
        if (!state.audioBuffer) {
            window.showFlash('請先載入音檔', 'error');
            return;
        }
        if (!state.folderCheck || state.folderCheck.ok !== true || !state.effectiveFolderId) {
            window.showFlash('目標資料夾驗證未通過，為了安全不會上傳。請確認學生的 Drive 資料夾設定是否正確（應指向或包含 01_Submissions）。', 'error');
            return;
        }
        const errMsg = validateBoundaries();
        if (errMsg) {
            window.showFlash(errMsg, 'error');
            return;
        }

        const task = getSelectedTask();
        const student = getSelectedStudent();
        if (!task || !student) return;

        const ok = confirm(
            '確定要把「' + student.name + '」的音檔切成 ' + task.gradingUnits.length + ' 段並上傳嗎？\n\n'
            + '原始檔案不會被刪除或搬動，只會在同一個資料夾新增切好的檔案；\n'
            + '資料庫紀錄會更新為這 ' + task.gradingUnits.length + ' 段，並自動觸發逐頁 AI 批改。'
        );
        if (!ok) return;

        state.uploading = true;
        state.uploadLog = [];
        renderBody(); // 這裡才需要整段重畫一次（鎖住送出鈕）；之後只更新 log 文字，避免播放器被重建

        const bounds = [0].concat(state.boundaries, [state.audioDuration]);
        const dateKey = todayKey();
        const uploadedSegments = [];

        try {
            for (let i = 0; i < task.gradingUnits.length; i++) {
                const unit = task.gradingUnits[i];
                appendLog('✂️ 切割第 ' + (i + 1) + '/' + task.gradingUnits.length + ' 段…');

                const base64 = sliceToWavBase64(state.audioBuffer, bounds[i], bounds[i + 1]);
                const pageTag = (unit.page !== null && unit.page !== undefined && unit.page !== '') ? ('p' + unit.page) : '';
                const scriptTag = [task.materialFolder, unit.stem, pageTag].filter(Boolean).join('_') || unit.label || ('part' + (i + 1));
                const fileName = dateKey + '_' + sanitizeFileName(scriptTag) + '_' + sanitizeFileName(student.name) + '.wav';

                appendLog('☁️ 上傳 ' + fileName + ' …');

                const fileUrl = await uploadSegmentWithRetry(base64, fileName, 'audio/wav', state.effectiveFolderId, state.assignmentId, state.taskId, 3);
                const fileId = window.GasService.extractFileIdFromUrl(fileUrl) || fileUrl;

                uploadedSegments.push({
                    file_id: fileId,
                    audio_url: 'https://drive.google.com/file/d/' + fileId + '/view',
                    unit_key: unit.unit_key || '',
                    stem: unit.stem || '',
                    page: unit.page,
                    label: unit.label || '',
                    original_script: unit.original_script || '',
                    name: fileName
                });

                appendLog('✅ 完成（' + (i + 1) + '/' + task.gradingUnits.length + '）');

                if (i < task.gradingUnits.length - 1) await sleep(600);
            }

            appendLog('📝 寫回資料庫並啟動 AI 批改…');

            const { error: rpcErr } = await window.supabaseClient.rpc('submit_audio_task_atomic', {
                p_assignment_id: state.assignmentId,
                p_task_id: state.taskId,
                p_student_id: state.studentId,
                p_class_id: cachedContext.classId,
                p_segments: uploadedSegments
            });
            if (rpcErr) throw rpcErr;

            appendLog('🎉 全部完成！已切成 ' + uploadedSegments.length + ' 段並送出 AI 批改。');
            window.showFlash('切割＋上傳完成，已啟動 AI 批改。', 'success');

            if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
                window.FeatureProgress.refresh(cachedContext.classId);
            }
        } catch (err) {
            appendLog('❌ 失敗：' + (err.message || err) + '（已成功上傳的 ' + uploadedSegments.length + ' 個檔案仍保留在 Drive，不會遺失）');
            window.showFlash('切割上傳失敗：' + (err.message || err), 'error');
        } finally {
            state.uploading = false;
            renderBody();
        }
    }

    // ============ 渲染 ============

    function renderSelectorsHtml() {
        const assignmentOptions = Object.keys(cachedContext.assignTaskMap).map(function (id) {
            const a = cachedContext.assignTaskMap[id];
            return '<option value="' + esc(id) + '"' + (id === state.assignmentId ? ' selected' : '') + '>'
                + esc(a.targetDate) + ' · ' + esc(a.title) + '</option>';
        }).join('');

        let taskOptions = '<option value="">請先選作業</option>';
        const assignment = getSelectedAssignment();
        if (assignment) {
            taskOptions = '<option value="">請選擇任務</option>' + Object.keys(assignment.tasks).map(function (id) {
                const t = assignment.tasks[id];
                return '<option value="' + esc(id) + '"' + (id === state.taskId ? ' selected' : '') + '>'
                    + esc(t.title) + '（' + t.gradingUnits.length + ' 頁）</option>';
            }).join('');
        }

        let studentOptions = '<option value="">請先選任務</option>';
        const eligible = getEligibleStudentsForTask();
        if (state.taskId) {
            studentOptions = '<option value="">請選擇學生</option>' + eligible.map(function (e) {
                const segCount = Array.isArray(e.completion.raw_data && e.completion.raw_data.audio_segments)
                    ? e.completion.raw_data.audio_segments.length : 1;
                const note = segCount > 1 ? '（目前已是 ' + segCount + ' 段，通常不需再切）' : '';
                return '<option value="' + esc(e.student.id) + '"' + (String(e.student.id) === String(state.studentId) ? ' selected' : '') + '>'
                    + esc(e.student.name) + note + '</option>';
            }).join('');
        }

        return `
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px; margin-bottom:14px;">
                <div>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">作業</label>
                    <select id="asu-select-assignment" style="width:100%; padding:8px; border-radius:8px; border:1px solid #CBD5E1;" onchange="window.FeatureAudioSplitUpload._onSelectAssignment(this.value)">
                        <option value="">請選擇作業</option>
                        ${assignmentOptions}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">任務（僅列出多頁錄音任務）</label>
                    <select id="asu-select-task" style="width:100%; padding:8px; border-radius:8px; border:1px solid #CBD5E1;" onchange="window.FeatureAudioSplitUpload._onSelectTask(this.value)">
                        ${taskOptions}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">學生（僅列出已繳交者）</label>
                    <select id="asu-select-student" style="width:100%; padding:8px; border-radius:8px; border:1px solid #CBD5E1;" onchange="window.FeatureAudioSplitUpload._onSelectStudent(this.value)">
                        ${studentOptions}
                    </select>
                </div>
            </div>
        `;
    }

    function renderFolderCheckHtml() {
        if (!state.studentId) return '';
        if (!state.folderCheck) return '';
        const ok = state.folderCheck.ok;
        const bg = ok === true ? '#F0FDF4' : (ok === false ? '#FEF2F2' : '#F8FAFC');
        const border = ok === true ? '#BBF7D0' : (ok === false ? '#FECACA' : '#E2E8F0');
        const color = ok === true ? '#166534' : (ok === false ? '#B91C1C' : '#64748B');
        const icon = ok === true ? '✅' : (ok === false ? '⛔' : '⏳');
        let note = '';
        if (ok === true && state.folderCheck.autoFixed) {
            note = '（此欄位存的是學生根目錄，已自動改用其下的 01_Submissions 子資料夾上傳，不影響本次操作；'
                + '建議之後有空到「班級成員管理」把該生的 Drive 資料夾連結修正為 01_Submissions 本身）';
        } else if (ok === true) {
            note = '（確認為 01_Submissions，可以上傳）';
        } else if (ok === false) {
            note = '（找不到 01_Submissions 子資料夾，已擋下上傳，請先到「班級成員管理」修正該生的 Drive 資料夾設定）';
        }
        return `
            <div style="background:${bg}; border:1px solid ${border}; color:${color}; padding:10px 14px; border-radius:8px; margin-bottom:14px; font-weight:700; font-size:0.9rem;">
                ${icon} 目標資料夾：${esc(state.folderCheck.name)}
                ${note}
            </div>
        `;
    }

    function renderAudioSectionHtml() {
        if (!state.taskId || !state.studentId) return '';
        if (!getSelectedCompletion() || !getSourceFileId(getSelectedCompletion())) {
            return '<div style="color:#94A3B8; padding:10px 0;">這位學生在此任務找不到可切割的已繳交音檔。</div>';
        }

        if (state.loadingAudio) {
            return '<div style="padding:20px; text-align:center; color:#7C3AED; font-weight:800;">⏳ 下載並解碼音檔中，請稍候…</div>';
        }

        if (!state.audioBuffer) {
            return `
                <button type="button" class="btn btn-action" style="background:#7C3AED; color:white; border:none; font-weight:800;"
                    onclick="window.FeatureAudioSplitUpload._loadAudio()">📥 載入此學生的已繳交音檔</button>
            `;
        }

        const task = getSelectedTask();
        const streamUrl = window.ApiService.getAudioStreamUrl(state.sourceFileId);
        const cutRowsHtml = state.boundaries.map(function (b, idx) {
            return `
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    <span style="font-size:0.85rem; color:#64748B; min-width:70px;">切點 ${idx + 1}</span>
                    <input id="asu-cut-${idx}" type="text" value="${esc(formatMMSS(b))}" style="width:80px; padding:6px; border-radius:6px; border:1px solid #CBD5E1;"
                        onchange="window.FeatureAudioSplitUpload._updatePreview()">
                    <button type="button" class="btn" style="padding:4px 10px; font-size:0.8rem;" onclick="window.FeatureAudioSplitUpload._useCurrentTime(${idx})">🎧 用目前播放位置</button>
                    <button type="button" class="btn" style="padding:4px 10px; font-size:0.8rem;" onclick="window.FeatureAudioSplitUpload._previewBoundary(${idx})">▶️ 從這裡播放</button>
                </div>
            `;
        }).join('');

        const disableSubmit = !state.folderCheck || state.folderCheck.ok !== true || state.uploading;

        return `
            <div style="margin-top:10px;">
                <audio id="asu-audio-player" controls src="${esc(streamUrl)}" style="width:100%; margin-bottom:12px;"></audio>
                <div style="color:#64748B; font-size:0.85rem; margin-bottom:10px;">
                    音檔總長 ${formatMMSS(state.audioDuration)}，需切成 ${task ? task.gradingUnits.length : 0} 段。
                    先播放音檔找到每一頁之間的空檔，按「🎧 用目前播放位置」把切點抓下來即可，不用手動輸入秒數。
                </div>
                ${cutRowsHtml}
                <div id="asu-page-preview" style="margin-top:10px; padding:10px; background:#F8FAFC; border-radius:8px; font-size:0.85rem;"></div>
                <button id="asu-submit-btn" type="button" class="btn btn-action" style="margin-top:14px; background:${disableSubmit ? '#CBD5E1' : '#059669'}; color:white; border:none; font-weight:800;"
                    ${disableSubmit ? 'disabled' : ''}
                    onclick="window.FeatureAudioSplitUpload._submit()">✂️ 切割並上傳（不刪除原檔）</button>
                <div id="asu-log-container" style="margin-top:10px; font-family:monospace; font-size:0.82rem; color:#475569; white-space:pre-wrap;">${state.uploadLog.map(esc).join('\n')}</div>
            </div>
        `;
    }

    function appendLog(msg) {
        state.uploadLog.push(msg);
        const el = document.getElementById('asu-log-container');
        if (el) {
            el.textContent = state.uploadLog.join('\n');
        } else {
            renderBody();
        }
    }

    function renderModalContentHtml() {
        return `
            <div style="background:white; border-radius:14px; padding:24px; max-width:760px; width:100%; max-height:90vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                    <h2 style="margin:0; color:#5B21B6;">🔪 音檔切割工具（教師端）</h2>
                    <button type="button" onclick="window.FeatureAudioSplitUpload._close()" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:#94A3B8;">✕</button>
                </div>
                <p style="margin:0 0 16px; color:#64748B; font-size:0.9rem; line-height:1.5;">
                    僅用於處理<strong>舊制一次錄完好幾頁</strong>的既有繳交檔。直接使用學生已上傳的音檔切割、上傳回原資料夾，
                    <strong>不會刪除原始檔案</strong>，完成後自動觸發逐頁 AI 批改。
                </p>
                ${renderSelectorsHtml()}
                ${renderFolderCheckHtml()}
                <div id="asu-audio-section">${renderAudioSectionHtml()}</div>
            </div>
        `;
    }

    function renderBody() {
        const el = document.getElementById('audio-split-modal');
        if (!el) return;
        el.innerHTML = renderModalContentHtml();
        updatePagePreview();
    }

    // ============ 對外事件 ============

    function onSelectAssignment(id) {
        state.assignmentId = id;
        state.taskId = '';
        state.studentId = '';
        resetAudioState();
        renderBody();
    }

    function onSelectTask(id) {
        state.taskId = id;
        state.studentId = '';
        resetAudioState();
        renderBody();
    }

    function onSelectStudent(id) {
        state.studentId = id;
        resetAudioState();
        renderBody();
        if (id) checkTargetFolder();
    }

    function resetAudioState() {
        state.audioBuffer = null;
        state.audioDuration = 0;
        state.sourceFileId = '';
        state.boundaries = [];
        state.folderCheck = null;
        state.effectiveFolderId = '';
        state.loadingAudio = false;
        state.uploading = false;
        state.uploadLog = [];
    }

    function closeModal() {
        window.ModalOverlay.close('audio-split-modal');
    }

    function isDirty() {
        return !!state.audioBuffer || state.uploading;
    }

    // ============ 入口 ============

    function renderEntryButton(classId, assignments, completions, students) {
        cachedContext = {
            classId: classId,
            assignTaskMap: buildAssignTaskMap(assignments),
            completions: completions || [],
            students: students || []
        };
        if (Object.keys(cachedContext.assignTaskMap).length === 0) return '';
        return `
            <button type="button" class="btn btn-action" onclick="window.FeatureAudioSplitUpload.openModal()"
                style="background:#FDF4FF; color:#86198F; border:1px solid #F5D0FE; font-weight:800;">
                🔪 音檔切割工具
            </button>
        `;
    }

    function openModal() {
        if (!cachedContext) {
            window.showFlash('資料尚未載入，請重新整理進度表', 'error');
            return;
        }
        state.assignmentId = '';
        state.taskId = '';
        state.studentId = '';
        resetAudioState();

        window.ModalOverlay.open({
            id: 'audio-split-modal',
            tier: 'B',
            isDirty: isDirty,
            unsavedMessage: '音檔已載入或正在上傳中，確定要關閉嗎？',
            contentHtml: renderModalContentHtml()
        });
    }

    return {
        renderEntryButton: renderEntryButton,
        openModal: openModal,
        _close: closeModal,
        _onSelectAssignment: onSelectAssignment,
        _onSelectTask: onSelectTask,
        _onSelectStudent: onSelectStudent,
        _loadAudio: loadAudio,
        _useCurrentTime: useCurrentPlaybackTime,
        _previewBoundary: previewBoundary,
        _updatePreview: updatePagePreview,
        _submit: submitSplitUpload
    };
})();

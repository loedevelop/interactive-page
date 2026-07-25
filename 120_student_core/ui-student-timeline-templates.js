/**
 * 📂 檔案路徑：120_student_core/ui-student-timeline-templates.js
 * 🌟 純粹視覺模板層 (V96 有道發音回歸版：接通 Supabase Stream API，徹底摧毀 Drive 播放阻擋)
 * 🌟 免疫介面災難：程式碼內 0 個雙直豎線，絕對防彈。
 */

window.UIStudentTimelineTemplates = (() => {
    
    // 🔊 1. 有道字典真人發音引擎 (帶有原生備用防線)
    let sharedTTS = null;
    const playGoogleTTS = (text) => {
        try {
            const safeText = text ? text : '';
            if (safeText === '') return;

            const fallbackTTS = () => {
                let hasSpeech = false;
                if ('speechSynthesis' in window) hasSpeech = true;
                
                if (hasSpeech) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(safeText);
                    utterance.lang = 'en-US';
                    utterance.rate = 0.9; 
                    window.speechSynthesis.speak(utterance);
                } else {
                    alert("您的瀏覽器不支援語音播放功能。");
                }
            };

            if (!sharedTTS) {
                sharedTTS = document.createElement('audio');
                sharedTTS.id = 'rt-hidden-tts';
                document.body.appendChild(sharedTTS);
            }
            sharedTTS.pause();
            
            // 🌟 回歸有道字典 API，type=2 代表美式發音
            sharedTTS.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(safeText)}&type=2`;
            
            const playPromise = sharedTTS.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.warn("有道字典 TTS 播放被阻擋，無縫切換至原生語音引擎:", e);
                    fallbackTTS();
                });
            }
        } catch (e) { 
            console.error("TTS 發音發生錯誤:", e); 
        }
    };

    // 🎧 2. 錯音切片連動引擎
    let sliceTimerInterval = null;
    const playStudentAudioSlice = (playerId, startTime, endTime) => {
        try {
            const player = document.getElementById(playerId);
            if (!player) {
                alert("找不到音檔播放器，請確認作業是否已繳交。");
                return;
            }
            
            if (sliceTimerInterval) clearInterval(sliceTimerInterval);
            player.pause();
            
            const executePlay = () => {
                player.currentTime = startTime; 
                const playPromise = player.play();
                
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        if (Math.abs(player.currentTime - startTime) > 0.5) {
                            player.currentTime = startTime;
                        }
                        
                        sliceTimerInterval = setInterval(() => {
                            let shouldStop = false;
                            if (player.currentTime >= endTime) shouldStop = true;
                            if (player.paused) shouldStop = true;
                            
                            if (shouldStop) {
                                player.pause();
                                clearInterval(sliceTimerInterval);
                            }
                        }, 50);
                    }).catch(e => {
                        console.warn("切片播放被阻擋:", e);
                        alert("⚠️ 瀏覽器阻擋了自動播放，請手動點擊上方播放器播放。");
                    });
                }
            };

            if (player.readyState >= 1) {
                executePlay();
            } else {
                const onReady = () => {
                    executePlay();
                    player.removeEventListener('loadedmetadata', onReady);
                };
                player.addEventListener('loadedmetadata', onReady);
                player.load(); 
            }
        } catch (e) { console.error("切片定位錯誤:", e); }
    };

    function getLevelStyle(depth) {
        const styles = [
            { border: '#94A3B8', bg: '#F8FAFC', text: '#475569' }, 
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, 
            { border: '#8B5CF6', bg: '#F5F3FF', text: '#5B21B6' }, 
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, 
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }  
        ];
        return styles[Math.min(depth, 4)];
    }

    console.log("🚀 [LogOn Web] UIStudentTimelineTemplates V96 模組已成功載入！");

    return {
        playGoogleTTS,
        playStudentAudioSlice, 
        
        renderTimelineNodes: (timelineNodes, assignments, completedTasks, currentWeekStart, mode, weekStartSetting, DateUtils, studentDriveUrl, safeFormatUrl) => {
            try {
                let html = '';
                
                const safeTimelineNodes = Array.isArray(timelineNodes) ? timelineNodes : [];
                const safeAssignments = Array.isArray(assignments) ? assignments : [];
                const safeCompletedTasks = Array.isArray(completedTasks) ? completedTasks : [];

                const reversedNodes = safeTimelineNodes.map((node, index) => ({ node, weekIndex: index + 1 })).reverse();

                const renderTaskItem = (task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth, isFirstLeaf, isLastLeaf) => {
                    let canUpload = true;
                    if (isLateUpload) {
                        if (!allowLateFlag) {
                            canUpload = false;
                        }
                    }
                    
                    const compositeKey = `${course.id}_${task.id}`;
                    const isTaskDone = safeCompletedTasks.includes(compositeKey);
                    const checked = isTaskDone ? 'checked' : '';
                    
                    let aiFeedbackHtml = '';
                    let statusBadgeHtml = '';
                    
                    let hasValidAudioFile = false; 
                    let retryAudioId = '';
                    let retryAudioUrl = '';
                    let taskStatus = '';
                    let directAudioUrl = ''; 
                    
                    let inlinePlayerId = '';
                    if (course.id) {
                        if (task.id) {
                            inlinePlayerId = `inline-player-${course.id}-${task.id}`;
                        }
                    }

                    if (window._studentTaskCompletions) {
                        if (Array.isArray(window._studentTaskCompletions)) {
                            const compRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id));
                            if (compRecord) {
                                taskStatus = String(compRecord.status ? compRecord.status : '');
                                
                                if (compRecord.raw_data) {
                                    let url1 = compRecord.raw_data.student_audio_url;
                                    let url2 = compRecord.raw_data.audio_url;
                                    retryAudioUrl = String(url1 ? url1 : (url2 ? url2 : ''));
                                    
                                    let hasDriveIds = false;
                                    if (Array.isArray(compRecord.raw_data.drive_file_ids)) {
                                        if (compRecord.raw_data.drive_file_ids.length > 0) {
                                            hasDriveIds = true;
                                        }
                                    }

                                    if (!retryAudioUrl) {
                                        if (hasDriveIds) {
                                            retryAudioId = String(compRecord.raw_data.drive_file_ids[0]);
                                            retryAudioUrl = `https://drive.google.com/file/d/${retryAudioId}/view`;
                                        }
                                    } else if (retryAudioUrl) {
                                        let driveIdMatch = retryAudioUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                                        
                                        if (driveIdMatch) retryAudioId = driveIdMatch[1];
                                    }
                                    
                                    if (retryAudioId) {
                                        hasValidAudioFile = true;
                                        let sUrl = '';
                                        if (window.supabaseClient) {
                                            if (window.supabaseClient.supabaseUrl) {
                                                sUrl = window.supabaseClient.supabaseUrl;
                                            }
                                        }
                                        if (sUrl !== '') {
                                            directAudioUrl = `${sUrl}/functions/v1/stream-audio?file_id=${retryAudioId}`;
                                        } else {
                                            directAudioUrl = `https://drive.google.com/uc?export=download&id=${retryAudioId}`;
                                        }
                                    } else if (retryAudioUrl) {
                                        hasValidAudioFile = true;
                                        directAudioUrl = retryAudioUrl;
                                    }
                                }

                                if (taskStatus === 'ai_processing') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#EDE9FE; color:#8B5CF6; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #DDD6FE;">🤖 AI 批改中...</span>`;
                                } else if (taskStatus === 'graded') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#ECFDF5; color:#10B981; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #A7F3D0;">✅ 已批改</span>`;
                                } else if (taskStatus === 'completed') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#ECFDF5; color:#10B981; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #A7F3D0;">✅ 已批改</span>`;
                                } else if (taskStatus === 'ai_error') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF2F2; color:#EF4444; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FECACA;">⚠️ AI 分析失敗</span>`;
                                } else if (taskStatus === 'failed') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF2F2; color:#EF4444; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FECACA;">⚠️ AI 分析失敗</span>`;
                                } else if (taskStatus === 'submitted') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#EFF6FF; color:#3B82F6; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #BFDBFE;">⏳ 已繳交</span>`;
                                }

                                let showAIReport = false;
                                if (taskStatus === 'graded') showAIReport = true;
                                else if (taskStatus === 'completed') showAIReport = true;

                                if (showAIReport) {
                                    if (compRecord.raw_data) {
                                        if (compRecord.raw_data.ai_evaluation) {
                                            const ai = compRecord.raw_data.ai_evaluation;
                                            
                                            let pScore = 'N/A';
                                            if (ai.pronunciation_score !== undefined) {
                                                if (ai.pronunciation_score !== null) pScore = ai.pronunciation_score;
                                            }
                                            if (pScore === 'N/A') {
                                                if (ai.score !== undefined) {
                                                    if (ai.score !== null) pScore = ai.score;
                                                }
                                            }

                                            let fluency = 'N/A';
                                            if (ai.fluency_score !== undefined) {
                                                if (ai.fluency_score !== null) fluency = ai.fluency_score;
                                            }

                                            let feedback = '無綜合評語';
                                            if (ai.comprehensive_feedback) feedback = ai.comprehensive_feedback;
                                            else if (ai.feedback) feedback = ai.feedback;
                                            
                                            let pScoreColor = '#10B981';
                                            if (pScore !== 'N/A') {
                                                const numScore = Number(pScore);
                                                if (numScore < 80) pScoreColor = '#F59E0B';
                                                if (numScore < 60) pScoreColor = '#EF4444';
                                            }

                                            let wordErrorsHtml = '';
                                            if (ai.word_errors) {
                                                if (Array.isArray(ai.word_errors)) {
                                                    if (ai.word_errors.length > 0) {
                                                        wordErrorsHtml = `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #E2E8F0;">
                                                            <div style="font-weight: 900; color: #EF4444; font-size: 0.9rem; margin-bottom: 8px;">🔍 單字發音診斷：</div>
                                                            <div style="overflow-x: auto;">
                                                                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                                                                    <thead>
                                                                        <tr style="background: #FEF2F2; color: #991B1B;">
                                                                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">目標單字</th>
                                                                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">您的錯誤發音</th>
                                                                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">正確音標</th>
                                                                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">錯誤類型</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        ${ai.word_errors.map(err => {
                                                                            const safeErrWord = err.word ? err.word : '';
                                                                            const safeWord = String(safeErrWord).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                                                                            
                                                                            let sTime = 0;
                                                                            if (err.start_time !== undefined) {
                                                                                if (err.start_time !== null) sTime = Number(err.start_time);
                                                                            }
                                                                            
                                                                            let eTime = sTime + 1.5;
                                                                            if (err.end_time !== undefined) {
                                                                                if (err.end_time !== null) eTime = Number(err.end_time);
                                                                            }

                                                                            let safeStuPron = err.student_pronunciation ? err.student_pronunciation : '';
                                                                            let safeExpPhonetic = err.expected_phonetic ? err.expected_phonetic : '';
                                                                            let safeErrType = err.error_type ? err.error_type : '';

                                                                            let playSliceHtml = '';
                                                                            if (hasValidAudioFile) {
                                                                                playSliceHtml = `<span onclick="window.UIStudentTimelineTemplates.playStudentAudioSlice('${inlinePlayerId}', ${sTime}, ${eTime})" style="cursor:pointer; font-size:1.2rem; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.1)); transition:transform 0.1s; margin-left: 8px;" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'" title="定位並播放錯誤發音">🎧</span>`;
                                                                            }

                                                                            return `
                                                                            <tr style="background: white;">
                                                                                <td style="padding: 6px 10px; border: 1px solid #FECACA; font-weight: 800; color: #334155;">${String(safeErrWord)}</td>
                                                                                <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #EF4444; font-weight: bold;">
                                                                                    <div style="display:flex; align-items:center; flex-wrap:nowrap;">
                                                                                        <span>${String(safeStuPron)}</span>${playSliceHtml}
                                                                                    </div>
                                                                                </td>
                                                                                <td style="padding: 6px 10px; border: 1px solid #FECACA; font-family: monospace; color: #10B981;">
                                                                                    <div style="display:flex; align-items:center; flex-wrap:nowrap;">
                                                                                        <span>${String(safeExpPhonetic)}</span>
                                                                                        <span onclick="window.UIStudentTimelineTemplates.playGoogleTTS('${safeWord}')" style="cursor:pointer; font-size:1.2rem; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.1)); transition:transform 0.1s; margin-left: 8px;" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'" title="聆聽有道示範發音">🔊</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #64748B;">${String(safeErrType)}</td>
                                                                            </tr>`;
                                                                        }).join('')}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>`;
                                                    }
                                                }
                                            }

                                            const isCollapsed = localStorage.getItem(`ai_report_collapsed_${compositeKey}`) === 'true';
                                            const reportDisplay = isCollapsed ? 'none' : 'block';
                                            const toggleIcon = isCollapsed ? '◀️' : '🔽';

                                            aiFeedbackHtml = `
                                                <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FAF5FF; border-left: 4px solid #8B5CF6; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                                        <div style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;" onclick="window.FeatureStudentTimeline.toggleAIReport('${compositeKey}')">
                                                            <span style="font-size:1.1rem;">🤖</span>
                                                            <span style="font-weight: 900; color: #6D28D9; font-size: 0.95rem;">AI 批改報告</span>
                                                            <span id="toggle-icon-${compositeKey}" style="font-size: 0.8rem; margin-left: 4px; color: #8B5CF6;">${toggleIcon}</span>
                                                        </div>
                                                        <div style="display: flex; gap: 8px;">
                                                            <span style="background: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 900; color: ${pScoreColor}; border: 1px solid #E2E8F0;">發音: ${pScore}</span>
                                                            <span style="background: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 900; color: #3B82F6; border: 1px solid #E2E8F0;">流暢度: ${fluency}</span>
                                                        </div>
                                                    </div>
                                                    <div id="ai-report-body-${compositeKey}" style="display: ${reportDisplay}; margin-top: 12px;">
                                                        <div class="rt-normalize" style="font-size: 0.95rem; color: #334155; line-height: 1.6; background: white; padding: 12px; border-radius: 6px; border: 1px solid #E2E8F0; max-height: 400px; overflow-y: auto;">
                                                            <div style="font-weight: 900; color: #4F46E5; margin-bottom: 6px;">📝 綜合評語：</div>
                                                            ${String(feedback).replace(/\n/g, '<br>')}${wordErrorsHtml}
                                                        </div>
                                                    </div>
                                                </div>
                                            `;
                                        }
                                    }
                                }

                                let showAIError = false;
                                if (taskStatus === 'ai_error') showAIError = true;
                                else if (taskStatus === 'failed') showAIError = true;

                                if (showAIError) {
                                    let errorLogText = '系統尚未完成此作業的 AI 分析。';
                                    if (compRecord.raw_data) {
                                        if (compRecord.raw_data.ai_error_log) {
                                            errorLogText = String(compRecord.raw_data.ai_error_log);
                                        }
                                    }
                                    
                                    aiFeedbackHtml = `
                                        <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FEF2F2; border-left: 4px solid #EF4444; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                            <div style="font-weight: 900; color: #B91C1C; font-size: 0.95rem; margin-bottom: 8px;">❌ AI 分析發生錯誤</div>
                                            <div style="font-size: 0.85rem; color: #7F1D1D; word-break: break-word; background: #FECACA; padding: 8px; border-radius: 4px;">${errorLogText.replace(/\n/g, '<br>')}</div>
                                        </div>
                                    `;
                                }
                            }
                        }
                    }

                    let iconStr = '📁';
                    if (task.type === 'check') iconStr = '📌';
                    if (task.type === 'link') iconStr = '🔗';
                    if (task.type === 'audio_record') iconStr = '🎙️';
                    
                    let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.15rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
                    let checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px; cursor: pointer;" onchange="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', this.checked)" ${checked}>`;

                    let btn = '';
                    let taskTitleDisplay = '';
                    let linkContent = '';

                    const formattedTaskUrl = safeFormatUrl ? String(safeFormatUrl(task.url) ? safeFormatUrl(task.url) : '') : '';

                    if (task.type === 'link') {
                        let safeUrlText = task.url_text ? task.url_text : '';
                        let actualUrlText = String(safeUrlText).trim();
                        let safeTitleVal = task.title ? task.title : '';
                        let actualTitle = String(safeTitleVal).trim();

                        if (actualUrlText !== '') {
                            let displayTitle = actualTitle ? actualTitle : '未命名任務';
                            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${displayTitle}</span>`;
                            linkContent = formattedTaskUrl ? `<a href="${formattedTaskUrl}" target="_blank" class="btn-action" style="font-size:0.85rem; background:#EEF2FF; color:#4F46E5; text-decoration:none; padding:4px 10px; border-radius:6px; font-weight:800;" onclick="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', true)">${actualUrlText}</a>` : '';
                        } else {
                            let fallbackText = actualTitle ? actualTitle : '未命名連結';
                            if (formattedTaskUrl) {
                                taskTitleDisplay = `<a href="${formattedTaskUrl}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;" onclick="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', true)">${fallbackText}</a>`;
                            } else {
                                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${fallbackText} (無網址)</span>`;
                            }
                        }
                    } else if (task.type === 'audio_record') {
                        
                        let originalScript = '';
                        let materialUrl = '';
                        let materialRange = '';
                        if (task.raw_data) {
                            if (task.raw_data.original_script) originalScript = String(task.raw_data.original_script);
                            if (task.raw_data.material_url) materialUrl = String(task.raw_data.material_url);
                            if (task.raw_data.material_range) materialRange = String(task.raw_data.material_range);
                        }

                        let displayTitle = task.title ? task.title : '語音錄製任務';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; vertical-align:middle; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${String(displayTitle)}</span>`;

                        if (!canUpload) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⛔ 已逾期，停止收件</div>`;
                        } else if (!studentDriveUrl) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⚠️ 您的專屬資料夾尚未設定</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功後將自動打勾">`;
                            
                            let pureTaskTitleVal = task.title ? task.title : '未命名任務';
                            const pureTaskTitle = String(pureTaskTitleVal).replace(/<[^>]*>?/gm, '').trim();
                            const statusId = `upload-status-${course.id}-${task.id}`;
                            
                            const safeTitleForJS = pureTaskTitle.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            const safeScriptForJS = String(originalScript).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n");
                            const safeUrlForJS = String(safeFormatUrl ? safeFormatUrl(materialUrl) : materialUrl).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            const safeRangeForJS = String(materialRange).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");

                            const recordBtnText = hasValidAudioFile ? '重新錄製' : '🎙️ 開啟錄音艙';
                            const recordBtnStyle = hasValidAudioFile ? 
                                'background:white; color:#94A3B8; border:1px solid #CBD5E1;' : 
                                'background:#EF4444; color:white; border:none; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';

                            let audioPlayerHtml = '';
                            let manualSubmitBtnHtml = '';

                            if (hasValidAudioFile) {
                                if (directAudioUrl !== '') {
                                    audioPlayerHtml = `<audio id="${inlinePlayerId}" controls src="${directAudioUrl}" preload="metadata" style="height: 36px; max-width: 250px; outline: none; border-radius: 8px; vertical-align: middle; box-shadow: 0 1px 3px rgba(0,0,0,0.1);"></audio>`;
                                }
                                
                                let showManualSubmit = false;
                                if (taskStatus === 'submitted') showManualSubmit = true;
                                else if (taskStatus === 'failed') showManualSubmit = true;
                                else if (taskStatus === 'ai_error') showManualSubmit = true;

                                if (showManualSubmit) {
                                    const rawRetryUrl = retryAudioUrl ? retryAudioUrl : '';
                                    const safeRetryAudioUrl = String(rawRetryUrl).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                                    manualSubmitBtnHtml = `<button onclick="window.FeatureStudentTimeline.retryAIGrading('${course.id}', '${task.id}', '${retryAudioId}', '${safeRetryAudioUrl}')" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:6px 12px; border-radius:6px; font-weight:800; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4);">🤖 手動提交批改</button>`;
                                }
                            }

                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${audioPlayerHtml}
                                    <button onclick="window.FeatureStudentTimeline.openAudioStudio('${course.id}', '${task.id}', '${safeTitleForJS}', '${safeScriptForJS}', '${safeUrlForJS}', '${safeRangeForJS}')" class="btn-action" style="${recordBtnStyle} cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">${recordBtnText}</button>
                                    <button onclick="window.FeatureStudentTimeline.openDriveAndCheck()" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📁 Drive</button>
                                    ${manualSubmitBtnHtml}
                                    <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                                </div>
                            `;
                        }
                    } else if (task.type === 'drive') {
                        let displayTitle = task.title ? task.title : '未命名任務';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${String(displayTitle)}</span>`;

                        if (!canUpload) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⛔ 已逾期，停止收件</div>`;
                        } else if (!studentDriveUrl) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⚠️ 您的專屬資料夾尚未設定</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功後將自動打勾">`;
                            
                            let pureTaskTitleVal = task.title ? task.title : '未命名任務';
                            const pureTaskTitle = String(pureTaskTitleVal).replace(/<[^>]*>?/gm, '').trim();
                            const safeTitleForJS = pureTaskTitle.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            
                            let safeNodeTitleStr = node.title ? node.title : '';
                            const safeNodeTitle = String(safeNodeTitleStr).replace(/[\/\\:*?"<>\x7C]/g, '_').replace(/'/g, "\\'").replace(/"/g, "&quot;");

                            const uniqueId = `file-input-${course.id}-${task.id}`;
                            const statusId = `upload-status-${course.id}-${task.id}`;

                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    <input type="file" id="${uniqueId}" multiple style="display:none;" onchange="window.FeatureStudentTimeline.handleFileSelect(this, '${course.id}', '${task.id}', '${safeTitleForJS}', '${statusId}', '${safeNodeTitle}',${isLateUpload})">
                                    <button onclick="document.getElementById('${uniqueId}').click()" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📤 上傳檔案</button>
                                    <button onclick="window.FeatureStudentTimeline.openDriveAndCheck()" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📁 Drive</button>
                                    <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                                </div>
                            `;
                        }
                    } else {
                        let displayTitle = task.title ? task.title : '未命名任務';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${String(displayTitle)}</span>`;
                    }

                    let cleanTaskDesc = '';
                    if (task.description) {
                        cleanTaskDesc = String(task.description).replace(/<[^>]*>?/gm, '').trim();
                    }
                    
                    let materialRangeText = '';
                    if (task.type === 'audio_record') {
                        if (task.raw_data) {
                            if (task.raw_data.material_range) {
                                materialRangeText = String(task.raw_data.material_range).trim();
                            }
                        }
                    }

                    let finalDescText = cleanTaskDesc;
                    if (materialRangeText !== '') {
                        const rangeStr = `(範圍：${materialRangeText})`;
                        if (finalDescText !== '') {
                            finalDescText = `${finalDescText} ${rangeStr}`;
                        } else {
                            finalDescText = rangeStr;
                        }
                    }

                    let taskDescHtml = '';
                    if (finalDescText !== '') {
                        taskDescHtml = `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px;">${finalDescText}</div>`;
                    }
                    
                    let showTaskDue = false;
                    if (task.due_date) {
                        if (task.due_date !== effectiveBlockDueDate) showTaskDue = true;
                    }
                    let localDueHtml = showTaskDue ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 6px; border-radius:4px;">⏰ 期限: ${task.due_date}</span>` : '';

                    let borderBottom = isLastLeaf ? 'none' : '1px solid rgba(0,0,0,0.08)';

                    return `
                        <div style="padding:10px 5px; background:transparent; border-bottom:${borderBottom}; transition: 0.2s;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; line-height: 1.2;">
                                    ${checkboxHtml}${iconHtml}${taskTitleDisplay}${statusBadgeHtml}${localDueHtml}${linkContent}
                                </div>
                                ${btn}
                            </div>
                            ${taskDescHtml}${aiFeedbackHtml}
                        </div>
                    `;
                };

                reversedNodes.forEach(({ node, weekIndex }) => {
                    if (!node) return;
                    if (!Array.isArray(node.dates)) return;
                    if (node.dates.length === 0) return;
                    
                    const nodeWeekStart = DateUtils ? DateUtils.getWeekStartStr(node.dates[0], weekStartSetting) : '';
                    
                    let badge = '';
                    let borderColor = '#E2E8F0';
                    let dotColor = '#E2E8F0';
                    let bgColor = '#FFFFFF';
                    let headerTextColor = '#475569';
                    let isCurrentWeek = false;
                    let isFutureWeek = false;
                    
                    if (nodeWeekStart === currentWeekStart) {
                        badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
                        borderColor = '#10B981';
                        dotColor = '#10B981';
                        bgColor = '#ECFDF5'; 
                        headerTextColor = '#065F46';
                        isCurrentWeek = true;
                    } else if (nodeWeekStart > currentWeekStart) {
                        isFutureWeek = true;
                    } else {
                        dotColor = '#CBD5E1';
                        bgColor = '#F8FAFC'; 
                        headerTextColor = '#94A3B8';
                    }

                    const coursesInDate = safeAssignments.filter(a => {
                        if (!a) return false;
                        if (!a.target_date) return false;
                        if (!DateUtils) return false;
                        return node.dates.includes(DateUtils.normalizeDateString(a.target_date));
                    });
                    
                    if (isFutureWeek && coursesInDate.length === 0) return; 

                    let totalTasksInDate = 0;
                    let doneTasksInDate = 0;
                    let coursesHtml = '';

                    if (coursesInDate.length > 0) {
                        coursesHtml = coursesInDate.map(course => {
                            let effectiveBlockDueDate = course.due_date;
                            if (!effectiveBlockDueDate && Array.isArray(course.tasks) && course.tasks.length > 0) {
                                const explicitDates = course.tasks.map(t => t.due_date).filter(d => d);
                                if (explicitDates.length === course.tasks.length && explicitDates.every(d => d === explicitDates[0])) {
                                    effectiveBlockDueDate = explicitDates[0];
                                }
                            }
                            
                            let aRaw = course.raw_data ? course.raw_data : {};
                            if (typeof aRaw === 'string') {
                                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
                            }
                            
                            let isLateUpload = false;
                            let allowLateFlag = aRaw.allow_late !== false;
                            
                            if (effectiveBlockDueDate && DateUtils) {
                                isLateUpload = DateUtils.isPastDue(effectiveBlockDueDate);
                            }

                            const countTasksRecursive = (tasksList) => {
                                if (!Array.isArray(tasksList)) return;
                                tasksList.forEach(t => {
                                    if (t && t.type === 'group') {
                                        countTasksRecursive(t.subTasks);
                                    } else if (t) {
                                        totalTasksInDate += 1;
                                        if (safeCompletedTasks.includes(`${course.id}_${t.id}`)) {
                                            doneTasksInDate += 1;
                                        }
                                    }
                                });
                            };
                            if (course.tasks) countTasksRecursive(course.tasks);

                            let cleanBlockDesc = course.description ? String(course.description).replace(/<[^>]*>?/gm, '').trim() : '';
                            let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.95rem; color:#64748B; margin-top:8px;">${course.description}</div>` : '';
                            
                            let lateBadgeText = (isLateUpload && allowLateFlag) ? ' (允許遲交)' : '';
                            let dueHtml = effectiveBlockDueDate ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 8px; border-radius:4px; margin-left:10px;">⏰ 期限: ${effectiveBlockDueDate}${lateBadgeText}</span>` : '';

                            const renderTaskTree = (tasksList, depth = 0) => {
                                if (!Array.isArray(tasksList)) return '';
                                if (tasksList.length === 0) return '';
                                
                                return tasksList.map((task, idx) => {
                                    if (!task) return '';
                                    const lvl = getLevelStyle(depth);
                                    
                                    let isFirstLeaf = (idx === 0);
                                    if (!isFirstLeaf && tasksList[idx - 1] && tasksList[idx - 1].type === 'group') isFirstLeaf = true;
                                    
                                    let isLastLeaf = (idx === tasksList.length - 1);
                                    if (!isLastLeaf && tasksList[idx + 1] && tasksList[idx + 1].type === 'group') isLastLeaf = true;
                                    
                                    if (task.type === 'group') {
                                        let groupTitle = String(task.title ? task.title : '未命名作業群組');
                                        let subTasksHtml = '';
                                        
                                        if (Array.isArray(task.subTasks) && task.subTasks.length > 0) {
                                            subTasksHtml = `<div style="display:flex; flex-direction:column;">` +
                                                renderTaskTree(task.subTasks, depth + 1) +
                                                `</div>`;
                                        } else {
                                            subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此作業群組尚無內容)</div>`;
                                        }

                                        const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                                        return `
                                            <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background:${lvl.bg}; border: 1px solid #E2E8F0; border-radius: 8px;">
                                                <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; display:flex; align-items:center; gap:8px; margin-bottom: 8px;">
                                                    <span style="font-size:1.2rem;">🗂️</span> <span class="rt-normalize">${groupTitle}</span>
                                                </div>
                                                ${subTasksHtml}
                                            </div>
                                        `;
                                    } else {
                                        return renderTaskItem(task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth, isFirstLeaf, isLastLeaf);
                                    }
                                }).join('');
                            };

                            let tasksHtml = '';
                            if (Array.isArray(course.tasks) && course.tasks.length > 0) {
                                tasksHtml = renderTaskTree(course.tasks, 0);
                            }
                            
                            let safeCourseTitle = course.title ? course.title : '';

                            return `
                                <div style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s;">
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                                        <div style="flex: 1; min-width:200px; display:flex; justify-content:space-between; align-items:center;">
                                            <div style="font-weight: 900; color: #334155; font-size: 1rem; display:flex; align-items:center; flex-wrap:wrap;">
                                                📝 <span class="rt-normalize">${String(safeCourseTitle)}</span>
                                            </div>
                                            <div>${dueHtml}</div>
                                        </div>
                                    </div>
                                    ${blockDescHtml}
                                    ${tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : ''}
                                </div>
                            `;
                        }).join('');
                    }

                    let progressBadgeHtml = '';
                    if (totalTasksInDate > 0) {
                        let isAllDone = (totalTasksInDate === doneTasksInDate);
                        let badgeBg = isAllDone ? '#ECFDF5' : '#FFF7ED';
                        let badgeColor = isAllDone ? '#059669' : '#EA580C';
                        let badgeBorder = isAllDone ? '#D1FAE5' : '#FFEDD5';
                        progressBadgeHtml = `
                            <div style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeBorder}; padding:4px 10px; border-radius:20px; font-size:0.85rem; font-weight:800;">
                                完成進度 ${doneTasksInDate} / ${totalTasksInDate}
                            </div>
                        `;
                    }
                    
                    let safeNodeTitleStr = node.title ? node.title : '';

                    html += `
                        <div id="timeline-node-${weekIndex}" class="timeline-node" data-is-current="${isCurrentWeek}" style="scroll-margin-top: 25px; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative;">
                            <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                                <div class="node-date" style="display:flex; align-items:center; position:relative;">
                                    <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                                    <span style="font-weight: 800; color: ${headerTextColor}; font-size:1.05rem;">📅 第 ${weekIndex} ${mode === 'weekly' ? '週' : '堂'} - ${String(safeNodeTitleStr)}</span> ${badge}
                                </div>
                                ${progressBadgeHtml}
                            </div>
                            ${coursesHtml}
                        </div>
                    `;
                });

                return html;
            } catch (error) {
                console.error("🚨 學生時間軸渲染層發生致命錯誤:", error);
                return `
                    <div style="padding:20px; margin:20px; background:#FEF2F2; border:2px solid #EF4444; border-radius:8px; font-family:sans-serif;">
                        <h3 style="color:#991B1B; margin-top:0;">🚨 渲染引擎發生崩潰 (Runtime Error)</h3>
                        <p style="color:#7F1D1D; font-size:0.9rem;">系統已攔截到死當點，請將以下紅色文字截圖給工程師修復，不用重整網頁了！</p>
                        <div style="background:#FECACA; padding:10px; border-radius:4px; font-family:monospace; font-size:0.85rem; color:#EF4444; font-weight:bold; overflow-x:auto;">
                            錯誤訊息：${error.message}
                        </div>
                        <pre style="margin-top:10px; font-size:0.75rem; color:#7F1D1D; overflow-x:auto;">${error.stack}</pre>
                    </div>
                `;
            }
        }
    };
})();
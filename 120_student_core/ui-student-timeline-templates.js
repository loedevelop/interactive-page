/**
 * 📂 檔案路徑：120_student_core/ui-student-timeline-templates.js
 * 🌟 純粹視覺模板層：負責將作業 JSON 轉化為 HTML 字串
 * 🚀 核心更新：iframe 微型播放器、Google TTS 正確發音功能！
 */

window.UIStudentTimelineTemplates = (() => {
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

    return {
        renderTimelineNodes: (timelineNodes, assignments, completedTasks, currentWeekStart, mode, weekStartSetting, DateUtils, studentDriveUrl, safeFormatUrl) => {
            let html = '';
            const reversedNodes = timelineNodes.map((node, index) => ({ node, weekIndex: index + 1 })).reverse();

            const renderTaskItem = (task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth, isFirstLeaf, isLastLeaf) => {
                const canUpload = !(isLateUpload && !allowLateFlag);
                const compositeKey = `${course.id}_${task.id}`;
                const isTaskDone = completedTasks.includes(compositeKey);
                const checked = isTaskDone ? 'checked' : '';
                
                let aiFeedbackHtml = '';
                let statusBadgeHtml = '';
                
                let hasValidAudioFile = false; 
                let retryAudioId = '';
                let retryAudioUrl = '';
                let taskStatus = '';

                if (window._studentTaskCompletions) {
                    const compRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id));
                    if (compRecord) {
                        taskStatus = compRecord.status;
                        
                        if (compRecord.raw_data) {
                            retryAudioUrl = compRecord.raw_data.student_audio_url || compRecord.raw_data.audio_url || '';
                            if (!retryAudioUrl && compRecord.raw_data.drive_file_ids && compRecord.raw_data.drive_file_ids.length > 0) {
                                retryAudioId = compRecord.raw_data.drive_file_ids[0];
                                retryAudioUrl = `https://drive.google.com/file/d/${retryAudioId}/view`;
                            } else if (retryAudioUrl) {
                                const driveIdMatch = retryAudioUrl.match(/\/(?:d|file\/d)\/([a-zA-Z0-9_-]+)/);
                                if (driveIdMatch) retryAudioId = driveIdMatch[1];
                            }
                            
                            if (retryAudioId) {
                                hasValidAudioFile = true;
                            }
                        }

                        if (taskStatus === 'ai_processing') {
                            statusBadgeHtml = `<span style="font-size:0.75rem; background:#EDE9FE; color:#8B5CF6; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:bold; box-shadow: 0 0 0 1px #DDD6FE;">🤖 AI 批改中...</span>`;
                        } else if (taskStatus === 'graded' || taskStatus === 'completed') {
                            statusBadgeHtml = `<span style="font-size:0.75rem; background:#ECFDF5; color:#10B981; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:bold; box-shadow: 0 0 0 1px #A7F3D0;">✅ 已批改</span>`;
                        } else if (taskStatus === 'ai_error' || taskStatus === 'failed') {
                            statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF2F2; color:#EF4444; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:bold; box-shadow: 0 0 0 1px #FECACA;">⚠️ AI 分析失敗</span>`;
                        } else if (taskStatus === 'submitted') {
                            statusBadgeHtml = `<span style="font-size:0.75rem; background:#EFF6FF; color:#3B82F6; padding:2px 6px; border-radius:4px; margin-left:8px; font-weight:bold; box-shadow: 0 0 0 1px #BFDBFE;">⏳ 已繳交 (未批改)</span>`;
                        }

                        if (compRecord.raw_data && compRecord.raw_data.ai_evaluation) {
                            const ai = compRecord.raw_data.ai_evaluation;
                            const pScore = ai.pronunciation_score ?? ai.score ?? 'N/A';
                            const fluency = ai.fluency_score ?? 'N/A';
                            const feedback = ai.comprehensive_feedback ?? ai.feedback ?? '無綜合評語';
                            
                            let pScoreColor = '#10B981';
                            if (pScore !== 'N/A') {
                                const numScore = Number(pScore);
                                if (numScore < 80) pScoreColor = '#F59E0B';
                                if (numScore < 60) pScoreColor = '#EF4444';
                            }

                            // 🚀 核心渲染：發音錯誤表格與 TTS 語音發音按鈕
                            let wordErrorsHtml = '';
                            if (ai.word_errors && Array.isArray(ai.word_errors) && ai.word_errors.length > 0) {
                                wordErrorsHtml = `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #E2E8F0;">
                                    <div style="font-weight: 900; color: #EF4444; font-size: 0.9rem; margin-bottom: 8px;">🔍 單字發音診斷：</div>
                                    <div style="overflow-x: auto;">
                                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                                            <thead>
                                                <tr style="background: #FEF2F2; color: #991B1B;">
                                                    <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">目標單字 (點擊聽正確發音)</th>
                                                    <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">您的錯誤發音</th>
                                                    <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">正確音標</th>
                                                    <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">錯誤類型</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${ai.word_errors.map(err => `
                                                <tr style="background: white;">
                                                    <td style="padding: 6px 10px; border: 1px solid #FECACA; font-weight: 800; color: #334155;">
                                                        ${err.word}
                                                        <button onclick="new Audio('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=${encodeURIComponent(err.word)}').play()" style="background: #EEF2FF; border: 1px solid #BFDBFE; color: #3B82F6; cursor: pointer; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: bold; transition: 0.2s;" onmouseover="this.style.background='#DBEAFE'" onmouseout="this.style.background='#EEF2FF'">🔊 聽正確唸法</button>
                                                    </td>
                                                    <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #EF4444; font-weight: bold;">${err.student_pronunciation}</td>
                                                    <td style="padding: 6px 10px; border: 1px solid #FECACA; font-family: monospace; color: #10B981;">${err.expected_phonetic}</td>
                                                    <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #64748B;">${err.error_type}</td>
                                                </tr>`).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>`;
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
                                            ${String(feedback).replace(/\n/g, '<br>')}
                                            ${wordErrorsHtml}
                                        </div>
                                    </div>
                                </div>
                            `;
                        } else if (taskStatus === 'ai_error' || taskStatus === 'failed') {
                            const errorLogText = compRecord.raw_data?.ai_error_log || '系統尚未完成此作業的 AI 分析。';
                            aiFeedbackHtml = `
                                <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FEF2F2; border-left: 4px solid #EF4444; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                    <div style="font-weight: 900; color: #B91C1C; font-size: 0.95rem; margin-bottom: 8px;">❌ AI 分析發生錯誤</div>
                                    <div style="font-size: 0.85rem; color: #7F1D1D; word-break: break-word; background: #FECACA; padding: 8px; border-radius: 4px;">${errorLogText.replace(/\n/g, '<br>')}</div>
                                </div>
                            `;
                        }
                    }
                }

                let iconStr = task.type === 'check' ? '📌' : (task.type === 'link' ? '🔗' : (task.type === 'audio_record' ? '🎙️' : '📁'));
                let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.15rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
                let checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px; cursor: pointer;" onchange="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', this.checked)" ${checked}>`;

                let btn = '';
                let taskTitleDisplay = '';
                let linkContent = '';

                const formattedTaskUrl = safeFormatUrl(task.url);

                if (task.type === 'link') {
                    let actualUrlText = (task.url_text || '').trim();
                    let actualTitle = (task.title || '').trim();

                    if (actualUrlText !== '') {
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${actualTitle || '未命名任務'}</span>`;
                        linkContent = formattedTaskUrl ? `<a href="${formattedTaskUrl}" target="_blank" class="btn-action" style="margin-left:10px; font-size:0.85rem; background:#EEF2FF; color:#4F46E5; text-decoration:none; padding:4px 8px; border-radius:6px; font-weight:800;" onclick="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', true)">${actualUrlText}</a>` : '';
                    } else {
                        let fallbackText = actualTitle || '未命名連結';
                        if (formattedTaskUrl) {
                            taskTitleDisplay = `<a href="${formattedTaskUrl}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;" onclick="window.FeatureStudentTimeline.updateProgress('${course.id}', '${task.id}', true)">${fallbackText}</a>`;
                        } else {
                            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${fallbackText} (無網址)</span>`;
                        }
                    }
                } else if (task.type === 'audio_record') {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${task.title || '語音錄製任務'}</span>`;

                    if (!canUpload) {
                        checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                        btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block; margin-left:10px;">⛔ 已逾期，停止收件</div>`;
                    } else if (!studentDriveUrl) {
                        checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                        btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block; margin-left:10px;">⚠️ 您的專屬資料夾尚未設定</div>`;
                    } else {
                        checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功後將自動打勾">`;
                        
                        const pureTaskTitle = (task.title || '未命名任務').replace(/<[^>]*>?/gm, '').trim();
                        const safeTitleForJS = pureTaskTitle.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                        const statusId = `upload-status-${course.id}-${task.id}`;

                        let originalScript = '';
                        let materialUrl = '';
                        let materialRange = '';
                        if (task.raw_data) {
                            originalScript = task.raw_data.original_script || '';
                            materialUrl = task.raw_data.material_url || '';
                            materialRange = task.raw_data.material_range || '';
                        }
                        
                        const safeScriptForJS = originalScript.replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n");
                        const safeUrlForJS = safeFormatUrl(materialUrl).replace(/'/g, "\\'").replace(/"/g, "&quot;");
                        const safeRangeForJS = materialRange.replace(/'/g, "\\'").replace(/"/g, "&quot;");

                        const recordBtnText = hasValidAudioFile ? '重新錄製' : '🎙️ 開啟錄音艙';
                        const recordBtnStyle = hasValidAudioFile ? 
                            'background:white; color:#94A3B8; border:1px solid #CBD5E1;' : 
                            'background:#EF4444; color:white; border:none; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';

                        let audioPlayerHtml = '';
                        let manualSubmitBtnHtml = '';

                        if (hasValidAudioFile) {
                            // 🚀 核心突破：不另開視窗的 iframe 微型播放器！徹底繞過 Drive 的 CORS 封鎖
                            audioPlayerHtml = `
                                <div style="height: 55px; width: 260px; border-radius: 8px; overflow: hidden; border: 1px solid #CBD5E1; display: inline-block; vertical-align: middle; background: #F8FAFC; box-shadow: inset 0 1px 3px rgba(0,0,0,0.05);">
                                    <iframe src="https://drive.google.com/file/d/${retryAudioId}/preview" width="100%" height="100%" frameborder="0" allow="autoplay" style="margin-top: -5px;"></iframe>
                                </div>
                            `;
                            
                            if (['submitted', 'failed', 'ai_error'].includes(taskStatus)) {
                                manualSubmitBtnHtml = `<button onclick="window.FeatureStudentTimeline.retryAIGrading('${course.id}', '${task.id}', '${retryAudioId}', '${retryAudioUrl}')" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4);">🤖 手動提交批改</button>`;
                            }
                        }

                        // 排版順序：[微型 iframe 播放器] -> [重新錄製] -> [檢視 Drive] -> [手動提交批改]
                        btn = `
                            <div style="display:inline-flex; align-items:center; gap:8px; margin-left:10px; flex-wrap:wrap; margin-top:8px;">
                                ${audioPlayerHtml}
                                <button onclick="window.FeatureStudentTimeline.openAudioStudio('${course.id}', '${task.id}', '${safeTitleForJS}', '${safeScriptForJS}', '${safeUrlForJS}', '${safeRangeForJS}')" class="btn-action" style="${recordBtnStyle} cursor:pointer; font-size:0.85rem; padding:6px 12px; border-radius:6px; font-weight:800;">${recordBtnText}</button>
                                <button onclick="window.FeatureStudentTimeline.openDriveAndCheck()" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:6px 12px; border-radius:6px; font-weight:800;">📁 檢視 Drive</button>
                                ${manualSubmitBtnHtml}
                                <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                            </div>
                        `;
                    }
                } else if (task.type === 'drive') {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${task.title || '未命名任務'}</span>`;

                    if (!canUpload) {
                        checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                        btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block; margin-left:10px;">⛔ 已逾期，停止收件</div>`;
                    } else if (!studentDriveUrl) {
                        checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                        btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block; margin-left:10px;">⚠️ 您的專屬資料夾尚未設定</div>`;
                    } else {
                        checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功後將自動打勾">`;
                        
                        const pureTaskTitle = (task.title || '未命名任務').replace(/<[^>]*>?/gm, '').trim();
                        const safeTitleForJS = pureTaskTitle.replace(/'/g, "\\'").replace(/"/g, "&quot;");
                        const safeNodeTitle = node.title.replace(/[\\/:*?"<>|]/g, '_');

                        const uniqueId = `file-input-${course.id}-${task.id}`;
                        const statusId = `upload-status-${course.id}-${task.id}`;

                        btn = `
                            <div style="display:inline-flex; align-items:center; gap:8px; margin-left:10px; flex-wrap:wrap;">
                                <input type="file" id="${uniqueId}" multiple style="display:none;" onchange="window.FeatureStudentTimeline.handleFileSelect(this, '${course.id}', '${task.id}', '${safeTitleForJS}', '${statusId}', '${safeNodeTitle}', ${isLateUpload})">
                                <button onclick="document.getElementById('${uniqueId}').click()" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📤 上傳檔案</button>
                                <button onclick="window.FeatureStudentTimeline.openDriveAndCheck()" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📁 檢視 Drive</button>
                                <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                            </div>
                        `;
                    }
                } else {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; ${isTaskDone ? 'text-decoration:line-through; color:#94A3B8;' : ''}">${task.title || '未命名任務'}</span>`;
                }

                let cleanTaskDesc = task.description ? task.description.replace(/<[^>]*>?/gm, '').trim() : '';
                let taskDescHtml = cleanTaskDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px;">${task.description}</div>` : '';
                
                let showTaskDue = task.due_date && task.due_date !== effectiveBlockDueDate;
                let localDueHtml = showTaskDue ? `<span style="font-size:0.8rem; color:#EF4444; margin-left:8px; border:1px solid #FECACA; padding:2px 6px; border-radius:4px;">⏰ 期限: ${task.due_date}</span>` : '';

                let borderBottom = isLastLeaf ? 'none' : '1px solid rgba(0,0,0,0.08)';

                return `
                    <div style="padding:10px 5px; background:transparent; border-bottom:${borderBottom}; transition: 0.2s;">
                        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; line-height: 1.2;">
                            ${checkboxHtml}${iconHtml}${taskTitleDisplay}${statusBadgeHtml}${linkContent}${localDueHtml}
                        </div>
                        ${btn}
                        ${taskDescHtml}
                        ${aiFeedbackHtml}
                    </div>
                `;
            };

            reversedNodes.forEach(({ node, weekIndex }) => {
                const nodeWeekStart = DateUtils.getWeekStartStr(node.dates[0], weekStartSetting);
                
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

                const coursesInDate = assignments.filter(a => node.dates.includes(DateUtils.normalizeDateString(a.target_date)));
                if (isFutureWeek && coursesInDate.length === 0) return; 

                let totalTasksInDate = 0;
                let doneTasksInDate = 0;
                let coursesHtml = '';

                if (coursesInDate.length > 0) {
                    coursesHtml = coursesInDate.map(course => {
                        let effectiveBlockDueDate = course.due_date;
                        if (!effectiveBlockDueDate && course.tasks && course.tasks.length > 0) {
                            const explicitDates = course.tasks.map(t => t.due_date).filter(d => d);
                            if (explicitDates.length === course.tasks.length && explicitDates.every(d => d === explicitDates[0])) {
                                effectiveBlockDueDate = explicitDates[0];
                            }
                        }
                        
                        let aRaw = course.raw_data || {};
                        if (typeof aRaw === 'string') {
                            try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
                        }
                        
                        let isLateUpload = false;
                        let allowLateFlag = aRaw.allow_late !== false;
                        
                        if (effectiveBlockDueDate) {
                            isLateUpload = DateUtils.isPastDue(effectiveBlockDueDate);
                        }

                        const countTasksRecursive = (tasksList) => {
                            if (!tasksList) return;
                            tasksList.forEach(t => {
                                if (t.type === 'group') {
                                    countTasksRecursive(t.subTasks);
                                } else {
                                    totalTasksInDate += 1;
                                    if (completedTasks.includes(`${course.id}_${t.id}`)) {
                                        doneTasksInDate += 1;
                                    }
                                }
                            });
                        };
                        if (course.tasks) countTasksRecursive(course.tasks);

                        let cleanBlockDesc = course.description ? course.description.replace(/<[^>]*>?/gm, '').trim() : '';
                        let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.95rem; color:#64748B; margin-top:8px;">${course.description}</div>` : '';
                        
                        let lateBadgeText = (isLateUpload && allowLateFlag) ? ' (允許遲交)' : '';
                        let dueHtml = effectiveBlockDueDate ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 8px; border-radius:4px; margin-left:10px;">⏰ 期限: ${effectiveBlockDueDate}${lateBadgeText}</span>` : '';

                        const renderTaskTree = (tasksList, depth = 0) => {
                            if (!tasksList || tasksList.length === 0) return '';
                            
                            return tasksList.map((task, idx) => {
                                const lvl = getLevelStyle(depth);
                                const isFirstLeaf = idx === 0 || tasksList[idx - 1].type === 'group';
                                const isLastLeaf = idx === tasksList.length - 1 || tasksList[idx + 1].type === 'group';
                                
                                if (task.type === 'group') {
                                    let groupTitle = task.title || '未命名作業群組';
                                    let subTasksHtml = '';
                                    
                                    if (task.subTasks && task.subTasks.length > 0) {
                                        subTasksHtml = `<div style="display:flex; flex-direction:column;">` +
                                            renderTaskTree(task.subTasks, depth + 1) +
                                            `</div>`;
                                    } else {
                                        subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此作業群組尚無內容)</div>`;
                                    }

                                    const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                                    return `
                                        <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background: ${lvl.bg}; border: 1px solid #E2E8F0; border-radius: 8px;">
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
                        if (course.tasks && course.tasks.length > 0) {
                            tasksHtml = renderTaskTree(course.tasks, 0);
                        }

                        return `
                            <div style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s;">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                                    <div style="flex: 1; min-width:200px; display:flex; justify-content:space-between; align-items:center;">
                                        <div style="font-weight: 900; color: #334155; font-size: 1rem; display:flex; align-items:center; flex-wrap:wrap;">
                                            📝 <span class="rt-normalize">${course.title}</span>
                                        </div>
                                        <div>${dueHtml}</div>
                                    </div>
                                </div>
                                ${blockDescHtml}
                                ${tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : ''}
                            </div>
                        `;
                    }).join('');
                } else {
                    coursesHtml = ''; 
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

                html += `
                    <div id="timeline-node-${weekIndex}" class="timeline-node" data-is-current="${isCurrentWeek}" style="scroll-margin-top: 25px; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative;">
                        <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                            <div class="node-date" style="display:flex; align-items:center; position:relative;">
                                <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                                <span style="font-weight: 800; color: ${headerTextColor}; font-size:1.05rem;">📅 第 ${weekIndex} ${mode === 'weekly' ? '週' : '堂'} - ${node.title}</span> ${badge}
                            </div>
                            ${progressBadgeHtml}
                        </div>
                        ${coursesHtml}
                    </div>
                `;
            });

            return html;
        }
    };
})();
/**
 * 📂 110_teacher_core/ui-gradebook-templates.js
 * 🎯 職責：老師端批改中樞的純視覺模板工廠 (Tier 2)
 */
window.GradebookTemplates = (function() {
    'use strict';

    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch(e) { return {}; }
        }
        return data;
    }

    function renderMatrix(matrixData, assignments) {
        if (!matrixData || matrixData.length === 0) return `<div class="p-8 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">目前無學生資料</div>`;
        if (!assignments || assignments.length === 0) return `<div class="p-8 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">該班級目前無錄音作業</div>`;

        let thead = `<tr class="bg-gray-50 text-gray-700 text-sm border-b border-gray-200"><th class="p-4 text-left font-black sticky left-0 z-10 bg-gray-50 border-r border-gray-200">學生姓名</th>`;
        
        assignments.forEach(a => {
            thead += `<th class="p-4 text-center font-bold min-w-[140px] align-top">
                        <div class="text-[10px] text-gray-400 font-bold mb-1 truncate max-w-[140px] mx-auto uppercase tracking-wide" title="${escapeHtml(a.assignment_title)}">📂 ${escapeHtml(a.assignment_title)}</div>
                        <div class="text-sm text-gray-800">${escapeHtml(a.title)}</div>
                      </th>`;
        });
        thead += `</tr>`;

        let tbody = '';
        matrixData.forEach(row => {
            tbody += `<tr class="hover:bg-blue-50 border-b border-gray-100 transition-colors group">`;
            tbody += `<td class="p-4 font-bold text-gray-800 sticky left-0 z-10 bg-white group-hover:bg-blue-50 border-r border-gray-200">${escapeHtml(row.student_name)}</td>`;
            
            assignments.forEach(a => {
                const sub = row.submissions ? row.submissions[a.id] : null;
                if (!sub) {
                    tbody += `<td class="p-4 text-center text-gray-300 font-bold">-</td>`;
                } else {
                    const raw = parseJSONB(sub.raw_data);
                    const override = raw.teacher_override || {};
                    const aiScore = raw.ai_evaluation?.pronunciation_score;
                    
                    // 🛡️ 加入階層分數判斷，向下相容
                    let displayScore = '待批';
                    let marker = '';
                    if (override.teacher_score !== undefined) { displayScore = override.teacher_score; marker = '🧑‍🏫'; }
                    else if (override.ta_score !== undefined) { displayScore = override.ta_score; marker = '🛡️'; }
                    else if (override.final_score !== undefined) { displayScore = override.final_score; } 
                    else if (aiScore !== undefined) { displayScore = aiScore; marker = '🤖'; }

                    const isGraded = displayScore !== '待批';
                    const scoreClass = isGraded ? (Number(displayScore) < 60 ? 'text-red-700 bg-red-100 border-red-200' : 'text-green-700 bg-green-100 border-green-200') : 'text-yellow-700 bg-yellow-100 border-yellow-200 animate-pulse';

                    tbody += `<td class="p-4 text-center">
                                <button data-action="open-grading" data-submission-id="${escapeHtml(sub.id)}" data-student-id="${escapeHtml(row.student_id)}" data-task-id="${escapeHtml(a.id)}" class="px-5 py-1.5 rounded-full font-black transition-transform hover:scale-110 shadow-sm border cursor-pointer ${scoreClass} hover:brightness-95 flex items-center justify-center gap-1 mx-auto min-w-[70px]">
                                    ${escapeHtml(displayScore)} <span class="text-[10px] opacity-70">${marker}</span>
                                </button>
                              </td>`;
                }
            });
            tbody += `</tr>`;
        });

        return `<div class="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
                    <table class="w-full whitespace-nowrap text-sm border-collapse">
                        <thead>${thead}</thead>
                        <tbody>${tbody}</tbody>
                    </table>
                </div>`;
    }

    function renderInteractiveTranscript(textContent, aiErrors, intonationIssues, draft, defectBank) {
        if (!textContent) return `<div class="text-gray-400 italic p-4 text-center border-2 border-dashed border-gray-200 rounded-lg">無指定文稿內容</div>`;

        const manualDefects = draft?.manual_defects_added || [];
        const removedDefects = draft?.ai_defects_removed || [];
        const tokens = textContent.split(/([a-zA-Z']+)/);
        let html = `<div class="leading-relaxed text-[22px] text-gray-800 font-serif break-words" style="line-height: 2.2;">`;

        tokens.forEach(token => {
            if (!/^[a-zA-Z']+$/.test(token)) {
                html += escapeHtml(token).replace(/\n/g, '<br>');
                return;
            }

            const cleanWord = token.toLowerCase().replace(/[^a-z']/g, '');
            const aiErrorData = (aiErrors || []).find(e => (e.word || "").toLowerCase().replace(/[^a-z']/g, '') === cleanWord);
            const isAiDefect = !!aiErrorData && !removedDefects.includes(cleanWord);
            const isManualDefect = manualDefects.includes(cleanWord);
            const isHistoryDefect = defectBank && defectBank[cleanWord] > 0;

            let classes = "inline-block px-1 mx-[1px] rounded transition-colors cursor-pointer relative ";
            let attributes = `data-word="${escapeHtml(cleanWord)}" data-action="word-click" `;
            let iconHtml = "";

            if (isAiDefect) {
                classes += "bg-red-100 text-red-700 border-b-[3px] border-red-500 hover:bg-red-200 font-bold ";
                // 🛡️ 找回：確保 start_time 被正確填入，避免播放功能死機
                attributes += `data-kk-std="${escapeHtml(aiErrorData.kk_standard || '')}" data-kk-stu="${escapeHtml(aiErrorData.kk_student || '')}" data-time="${aiErrorData.start_time || 0}" data-issue="${escapeHtml(aiErrorData.issue_type || '發音需加強')}" data-type="ai"`;
            } else if (isManualDefect) {
                classes += "bg-orange-100 text-orange-700 border-b-[3px] border-orange-500 border-dashed hover:bg-orange-200 font-bold ";
                attributes += `data-type="manual" data-time="0"`;
            } else {
                classes += "hover:bg-gray-200 ";
                if (isHistoryDefect) {
                    classes += "text-green-700 font-bold border-b-[3px] border-green-500 ";
                    iconHtml = `<span class="absolute -top-3 -right-2 text-[14px]" title="歷史缺陷，本次已修正！">📈</span>`;
                }
            }
            html += `<span class="${classes}" ${attributes}>${escapeHtml(token)}${iconHtml}</span>`;
        });
        html += `</div>`;

        // 🛡️ 找回：完全保留您的語調與連音建議區塊
        if (intonationIssues && intonationIssues.length > 0) {
            html += `<div class="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-200">
                        <h4 class="text-sm font-bold text-blue-800 mb-3 flex items-center m-0">
                            <span class="mr-2">〰️</span> 語調與連音建議
                        </h4>
                        <div class="space-y-4">`;
            intonationIssues.forEach(issue => {
                html += `<div class="cursor-pointer group block bg-white p-3 rounded-lg shadow-sm border border-blue-100 hover:border-blue-300 transition-colors" data-action="intonation-click" data-time="${issue.start_time || 0}">
                            <span class="text-lg text-gray-800 underline decoration-blue-500 decoration-wavy decoration-2 group-hover:bg-blue-50 transition-colors rounded px-1">${escapeHtml(issue.phrase)}</span>
                            <div class="text-sm text-blue-600 mt-2 pl-2 font-medium border-l-4 border-blue-400">👉 ${escapeHtml(issue.suggestion)}</div>
                         </div>`;
            });
            html += `</div></div>`;
        }
        return html;
    }

    function renderSidebar(context, currentRole, commentBank) {
        if (!context || !context.submission) return '';

        const sub = context.submission;
        const meta = context.taskMeta || {};
        const raw = parseJSONB(sub.raw_data);
        const aiData = raw.ai_evaluation || {};
        const draft = context.draft || {};
        const textContent = meta.textContent || raw.assignment_text || "";
        const isTaJunior = currentRole === 'ta_junior';
        
        const override = raw.teacher_override || {};
        const isLockedByTeacher = (override.locked_by_role === 'primary_teacher' || override.locked_by_role === 'admin') && currentRole === 'ta_senior';

        let lockMsg = '';
        if (isTaJunior) lockMsg = `<div class="text-[11px] text-red-600 mb-2 font-bold bg-red-50 border border-red-200 p-1.5 rounded text-center">⚠️ 一般助教僅限檢視，無發布權限。</div>`;
        else if (isLockedByTeacher) lockMsg = `<div class="text-[11px] text-yellow-700 mb-2 font-bold bg-yellow-50 border border-yellow-200 p-1.5 rounded text-center">🔒 此成績已由教師定案，助教無法覆寫。</div>`;

        return `
        <!-- Overlay (點選外部關閉) -->
        <div id="grading-sidebar-overlay" class="fixed inset-0 bg-gray-900 bg-opacity-60 z-[9998] transition-opacity backdrop-blur-sm cursor-pointer" data-action="close-sidebar" title="點擊外部關閉"></div>
        
        <!-- Sidebar Panel (三明治壓縮版面) -->
        <div id="grading-sidebar-panel" class="fixed right-0 top-0 h-screen bg-gray-50 shadow-[0_0_40px_rgba(0,0,0,0.2)] w-full max-w-[650px] border-l border-gray-200 flex flex-col z-[9999] transform translate-x-full transition-transform duration-300">
            
            <!-- 🥪 頂部：廢除巨大分數區，改為極簡橫列 -->
            <div class="px-6 py-4 bg-white border-b border-gray-200 flex justify-between items-center shadow-sm shrink-0 gap-4">
                <audio id="google-tts-audio" class="hidden"></audio>
                <audio id="student-audio" src="${escapeHtml(sub.audio_url || raw.audio_url || '')}" controls class="w-full h-10 outline-none flex-1 bg-white rounded-full border border-gray-200"></audio>
                
                <div class="flex gap-2 shrink-0">
                    <div class="bg-blue-50 text-blue-800 px-3 py-1 rounded-lg border border-blue-100 flex flex-col items-center">
                        <span class="text-[10px] font-bold opacity-70 uppercase tracking-wider">AI 發音</span>
                        <span class="text-lg font-black">${escapeHtml(aiData.pronunciation_score || '--')}</span>
                    </div>
                    <div class="bg-gray-100 text-gray-700 px-3 py-1 rounded-lg border border-gray-200 flex flex-col items-center">
                        <span class="text-[10px] font-bold opacity-70 uppercase tracking-wider">流暢度</span>
                        <span class="text-lg font-black">${escapeHtml(aiData.fluency_score || '--')}</span>
                    </div>
                </div>
            </div>

            <!-- 🥪 中間：獨立捲軸，空間全還給文稿 -->
            <div class="flex-1 overflow-y-auto p-6 bg-white relative">
                <div class="flex justify-between items-end mb-6 border-b border-gray-100 pb-3">
                    <div class="text-base font-black text-gray-700 m-0 truncate max-w-[60%]">📂 ${escapeHtml(meta.title)}</div>
                    <div class="text-[11px] bg-blue-100 text-blue-800 px-3 py-1.5 rounded font-bold shadow-sm">💡 點擊紅字對比 / 黑字標記</div>
                </div>
                ${renderInteractiveTranscript(textContent, aiData.word_errors, aiData.intonation_issues, draft, context.defectBank)}
            </div>

            <!-- 🥪 底部：決策與詞庫，永遠貼底可見 -->
            <div class="p-6 bg-white border-t border-gray-200 shadow-[0_-10px_20px_-5px_rgba(0,0,0,0.1)] shrink-0 z-30">
                ${lockMsg}
                <div class="flex gap-4 mb-4">
                    <div class="w-1/4">
                        <label class="block text-xs font-bold text-gray-500 mb-1">最終總分</label>
                        <input type="number" id="input-draft-score" ${isTaJunior || isLockedByTeacher ? 'disabled' : ''} class="w-full p-2 border border-gray-300 rounded-xl font-black text-3xl text-blue-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition text-center shadow-inner" value="${escapeHtml(draft.current_score !== null ? draft.current_score : '')}">
                    </div>
                    <div class="w-3/4 flex flex-col min-w-0">
                        <div class="flex justify-between items-end mb-1">
                            <label class="block text-xs font-bold text-gray-500">決策評語</label>
                            <!-- ⚡ 詞庫快捷按鈕 -->
                            <div class="flex gap-1 overflow-x-auto no-scrollbar pb-1">
                                ${(commentBank || []).map(txt => `<button data-action="append-template" data-text="${escapeHtml(txt)}" class="text-[10px] bg-white border border-gray-200 text-gray-600 hover:text-blue-600 px-2 py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors shadow-sm">${escapeHtml(txt)}</button>`).join('')}
                            </div>
                        </div>
                        <textarea id="input-draft-feedback" ${isTaJunior || isLockedByTeacher ? 'disabled' : ''} rows="2" class="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm transition shadow-inner resize-none" placeholder="給予發音建議或點擊上方詞庫安插...">${escapeHtml(draft.feedback)}</textarea>
                    </div>
                </div>

                <button data-action="save-publish" ${isTaJunior || isLockedByTeacher ? 'disabled' : ''} class="w-full bg-blue-600 text-white font-black py-4 rounded-xl hover:bg-blue-700 shadow-lg hover:shadow-xl transition disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.98] border-0 cursor-pointer text-lg flex justify-center items-center gap-2">
                    🚀 發布正式成績並更新缺陷庫
                </button>
            </div>
        </div>
        `;
    }

    // 🚀 取消 X 按鈕，依靠 Click-Outside 關閉，並定位於文字正上方 (posY, posX)
    function renderWordPopover(word, kkStandard, kkStudent, startTime, issueType, isManualType, posX, posY) {
        return `
            <div id="active-word-popover" data-popover-content="true" class="fixed z-[10000] bg-white border border-gray-200 shadow-2xl rounded-2xl p-5 w-72 transform -translate-x-1/2 -translate-y-full transition-opacity mt-[-10px]"
                 style="top: ${posY}px; left: ${posX}px;">
                <div class="absolute bottom-[-8px] left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white border-b border-r border-gray-200 rotate-45"></div>
                
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 relative z-10">
                    <span class="font-black text-2xl text-gray-800 capitalize tracking-tight m-0 text-center w-full">${escapeHtml(word)}</span>
                </div>

                <div class="text-sm bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4 relative z-10 shadow-inner text-center">
                    <span class="text-gray-800 font-bold">${escapeHtml(issueType || '手動標記')}</span>
                </div>
                
                ${!isManualType ? `
                <div class="space-y-3 mb-5 relative z-10">
                    <div class="flex justify-between items-center bg-blue-50 p-3 rounded-xl border border-blue-100 shadow-sm">
                        <div>
                            <span class="block text-[10px] font-black text-blue-600 mb-1 uppercase tracking-wider">標準美式音</span>
                            <span class="font-mono text-gray-900 font-bold text-lg">${escapeHtml(kkStandard || '[N/A]')}</span>
                        </div>
                        <!-- 🛡️ 找回：TTS 播放按鈕 -->
                        <button data-action="play-tts" data-word="${escapeHtml(word)}" class="bg-blue-500 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-600 shadow transition border-0 cursor-pointer text-lg">🔊</button>
                    </div>
                    <div class="flex justify-between items-center bg-red-50 p-3 rounded-xl border border-red-100 shadow-sm">
                        <div>
                            <span class="block text-[10px] font-black text-red-600 mb-1 uppercase tracking-wider">學生實際音</span>
                            <span class="font-mono text-gray-900 font-bold text-lg">${escapeHtml(kkStudent || '[N/A]')}</span>
                        </div>
                        <!-- 🛡️ 找回：學生音檔播放按鈕 -->
                        <button data-action="play-student" data-time="${startTime}" class="bg-red-500 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-red-600 shadow transition border-0 cursor-pointer text-lg">🎧</button>
                    </div>
                </div>
                ` : ''}
                
                <div class="pt-1 text-center relative z-10">
                    ${isManualType 
                        ? `<button data-action="remove-manual" data-word="${escapeHtml(word)}" class="w-full text-sm font-bold py-3 border-2 border-gray-200 text-gray-600 rounded-xl hover:bg-gray-100 transition cursor-pointer bg-white">取消手動標記</button>`
                        : `<button data-action="remove-ai" data-word="${escapeHtml(word)}" class="w-full text-sm font-bold py-3 border-2 border-red-200 text-red-600 rounded-xl hover:bg-red-50 transition cursor-pointer bg-white">🗑️ 移除標記 (防誤判)</button>`
                    }
                </div>
            </div>
        `;
    }

    return { renderMatrix, renderSidebar, renderWordPopover };
})();
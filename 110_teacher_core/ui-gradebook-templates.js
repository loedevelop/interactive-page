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
                    const finalScore = override.final_score ?? aiScore ?? '待批';
                    const isGraded = finalScore !== '待批' && override.overridden_at;
                    
                    const scoreClass = isGraded ? (Number(finalScore) < 60 ? 'text-red-700 bg-red-100 border-red-200' : 'text-green-700 bg-green-100 border-green-200') : 'text-yellow-700 bg-yellow-100 border-yellow-200 animate-pulse';

                    tbody += `<td class="p-4 text-center">
                                <button data-action="open-grading" data-submission-id="${escapeHtml(sub.id)}" data-student-id="${escapeHtml(row.student_id)}" class="px-5 py-1.5 rounded-full font-black transition-transform hover:scale-110 shadow-sm border cursor-pointer ${scoreClass} hover:brightness-95">
                                    ${escapeHtml(finalScore)}
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
        let html = `<div class="leading-relaxed text-2xl text-gray-800 font-serif break-words" style="line-height: 2;">`;

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
                classes += "bg-red-100 text-red-700 border-b-4 border-red-500 hover:bg-red-200 font-bold ";
                attributes += `data-kk-std="${escapeHtml(aiErrorData.kk_standard || '')}" data-kk-stu="${escapeHtml(aiErrorData.kk_student || '')}" data-time="${aiErrorData.start_time || 0}" data-issue="${escapeHtml(aiErrorData.issue_type || '發音需加強')}" data-type="ai"`;
            } else if (isManualDefect) {
                classes += "bg-orange-100 text-orange-700 border-b-4 border-orange-500 border-dashed hover:bg-orange-200 font-bold ";
                attributes += `data-type="manual" data-time="0"`;
            } else {
                classes += "hover:bg-gray-200 ";
                if (isHistoryDefect) {
                    classes += "text-green-700 font-bold border-b-4 border-green-500 ";
                    iconHtml = `<span class="absolute -top-3 -right-2 text-[14px]" title="歷史缺陷，本次已修正！">📈</span>`;
                }
            }
            html += `<span class="${classes}" ${attributes}>${escapeHtml(token)}${iconHtml}</span>`;
        });
        html += `</div>`;

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

    function renderSidebar(context, currentRole) {
        if (!context || !context.submission) return '';

        const sub = context.submission;
        const raw = parseJSONB(sub.raw_data);
        const aiData = raw.ai_evaluation || {};
        const draft = context.draft || {};
        const textContent = raw.assignment_text || "";
        const isTaJunior = currentRole === 'ta_junior';

        return `
        <!-- Overlay -->
        <div id="grading-sidebar-overlay" class="fixed inset-0 bg-gray-900 bg-opacity-60 z-[9998] transition-opacity backdrop-blur-sm" data-action="close-sidebar"></div>
        
        <!-- Sidebar Panel -->
        <div id="grading-sidebar-panel" class="fixed right-0 top-0 h-screen bg-gray-50 shadow-[0_0_40px_rgba(0,0,0,0.2)] w-full max-w-[650px] border-l border-gray-200 flex flex-col z-[9999] transform translate-x-full transition-transform duration-300">
            
            <div class="px-6 py-4 bg-white border-b border-gray-200 flex justify-between items-center shadow-sm shrink-0">
                <h3 class="text-xl font-black text-gray-800 flex items-center gap-2 m-0">
                    <span class="text-blue-600">🎙️ 語音教練</span> 批改艙
                </h3>
                <button data-action="close-sidebar" class="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full w-10 h-10 flex items-center justify-center transition font-bold text-2xl border-0 bg-transparent cursor-pointer">&times;</button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-6 pb-48">
                <audio id="google-tts-audio" class="hidden"></audio>

                <div class="sticky top-[-24px] bg-white/95 backdrop-blur z-20 p-4 rounded-xl shadow-sm border border-gray-200 -mx-2">
                    <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">🎧 學生原始錄音</div>
                    <audio id="student-audio" src="${escapeHtml(sub.audio_url || raw.audio_url || '')}" controls class="w-full h-12 outline-none rounded-full"></audio>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-white p-5 rounded-xl border border-gray-200 text-center shadow-sm">
                        <div class="text-xs text-gray-500 font-bold uppercase tracking-wide">發音準確度</div>
                        <div class="text-5xl font-black text-blue-600 mt-2">${escapeHtml(aiData.pronunciation_score || '--')}</div>
                    </div>
                    <div class="bg-white p-5 rounded-xl border border-gray-200 text-center shadow-sm">
                        <div class="text-xs text-gray-500 font-bold uppercase tracking-wide">流暢度</div>
                        <div class="text-5xl font-black text-blue-600 mt-2">${escapeHtml(aiData.fluency_score || '--')}</div>
                    </div>
                </div>

                <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div class="flex justify-between items-end mb-6 border-b border-gray-100 pb-3">
                        <div class="text-base font-black text-gray-700 m-0">文稿對齊分析 (Text-Aligned)</div>
                        <div class="text-[11px] bg-blue-100 text-blue-800 px-3 py-1.5 rounded font-bold shadow-sm">💡 點擊紅字聽對比 / 反白黑字可新增標記</div>
                    </div>
                    ${renderInteractiveTranscript(textContent, aiData.word_errors, aiData.intonation_issues, draft, context.defectBank)}
                </div>
            </div>

            <div class="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-200 shadow-[0_-10px_20px_-5px_rgba(0,0,0,0.1)] z-30">
                <h4 class="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2 mt-0">👨‍🏫 教師決策覆寫 (Manual Override)</h4>
                
                ${isTaJunior ? `<div class="text-xs text-red-600 mb-3 font-bold bg-red-50 border border-red-200 p-3 rounded-lg text-center">⚠️ 一般助教權限：僅供檢視與標記發音，無法發布成績。</div>` : ''}

                <div class="flex gap-4 mb-4">
                    <div class="w-1/4">
                        <label class="block text-xs font-bold text-gray-500 mb-1">最終總分</label>
                        <input type="number" id="input-draft-score" ${isTaJunior ? 'disabled' : ''} class="w-full p-2 border border-gray-300 rounded-xl font-black text-3xl text-blue-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition text-center shadow-inner" value="${escapeHtml(draft.final_score !== null ? draft.final_score : '')}">
                    </div>
                    <div class="w-3/4">
                        <label class="block text-xs font-bold text-gray-500 mb-1">暖心評語</label>
                        <textarea id="input-draft-feedback" ${isTaJunior ? 'disabled' : ''} rows="2" class="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm transition shadow-inner resize-none" placeholder="給予發音建議或鼓勵...">${escapeHtml(draft.manual_feedback)}</textarea>
                    </div>
                </div>

                <button data-action="save-publish" ${isTaJunior ? 'disabled' : ''} class="w-full bg-blue-600 text-white font-black py-4 rounded-xl hover:bg-blue-700 shadow-lg hover:shadow-xl transition disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.98] border-0 cursor-pointer text-lg flex justify-center items-center gap-2">
                    🚀 發布正式成績並更新缺陷庫
                </button>
            </div>
        </div>
        `;
    }

    function renderWordPopover(word, kkStandard, kkStudent, startTime, issueType, isManualType, posX, posY) {
        return `
            <div id="active-word-popover" class="fixed z-[10000] bg-white border border-gray-200 shadow-2xl rounded-2xl p-5 w-72 transform -translate-x-1/2 mt-3 transition-opacity"
                 style="top: ${posY}px; left: ${posX}px;">
                <div class="absolute top-[-8px] left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white border-l border-t border-gray-200 rotate-45"></div>
                
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 relative z-10">
                    <span class="font-black text-2xl text-gray-800 capitalize tracking-tight m-0">${escapeHtml(word)}</span>
                    <button data-action="close-popover" class="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center transition font-bold text-xl border-0 bg-transparent cursor-pointer">&times;</button>
                </div>

                <div class="text-sm bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4 relative z-10 shadow-inner">
                    <span class="font-bold text-gray-500">AI 診斷：</span><span class="text-gray-800 font-bold ml-1">${escapeHtml(issueType || '手動標記')}</span>
                </div>
                
                <div class="space-y-3 mb-5 relative z-10">
                    <div class="flex justify-between items-center bg-blue-50 p-3 rounded-xl border border-blue-100 shadow-sm">
                        <div>
                            <span class="block text-[10px] font-black text-blue-600 mb-1 uppercase tracking-wider">標準美式音</span>
                            <span class="font-mono text-gray-900 font-bold text-lg">${escapeHtml(kkStandard || '[N/A]')}</span>
                        </div>
                        <button data-action="play-tts" data-word="${escapeHtml(word)}" class="bg-blue-500 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-600 shadow transition border-0 cursor-pointer text-lg">🔊</button>
                    </div>
                    <div class="flex justify-between items-center bg-red-50 p-3 rounded-xl border border-red-100 shadow-sm">
                        <div>
                            <span class="block text-[10px] font-black text-red-600 mb-1 uppercase tracking-wider">學生實際音</span>
                            <span class="font-mono text-gray-900 font-bold text-lg">${escapeHtml(kkStudent || '[N/A]')}</span>
                        </div>
                        <button data-action="play-student" data-time="${startTime}" class="bg-red-500 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-red-600 shadow transition border-0 cursor-pointer text-lg">🎧</button>
                    </div>
                </div>
                
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
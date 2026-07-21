/**
 * 📂 110_teacher_core/ui-gradebook-templates.js
 * 🎯 職責：老師端批改中樞的純視覺模板工廠 (極限空間壓縮版 + AI 評語擴充)
 */
window.GradebookTemplates = (function() {
    'use strict';

    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function parseJSONB(data) {
        if (!data) return {};
        if (typeof data === 'string') { try { return JSON.parse(data); } catch(e) { return {}; } }
        return data;
    }

    function renderMatrix(matrixData, assignments) {
        if (!matrixData || matrixData.length === 0) return `<div class="p-8 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">目前無學生資料</div>`;
        if (!assignments || assignments.length === 0) return `<div class="p-8 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">該班級目前無錄音作業</div>`;

        let thead = `<tr class="bg-gray-50 text-gray-700 text-sm border-b border-gray-200"><th class="p-4 text-left font-black sticky left-0 z-10 bg-gray-50 border-r border-gray-200">學生姓名</th>`;
        
        assignments.forEach(a => {
            thead += `<th class="p-4 text-center font-bold min-w-[200px] align-top whitespace-normal">
                        <div class="text-[10px] text-gray-400 font-bold mb-1 mx-auto uppercase tracking-wide leading-tight">📂 ${escapeHtml(a.assignment_title)}</div>
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
                    const aiEval = raw.ai_evaluation || {};
                    
                    let defaultScore = aiEval.pronunciation_score || null;
                    if (aiEval.pronunciation_score && aiEval.fluency_score) {
                        defaultScore = Math.round((Number(aiEval.pronunciation_score) + Number(aiEval.fluency_score)) / 2);
                    }

                    const finalScore = override.final_score ?? defaultScore ?? '待批';
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

        return `<div class="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200"><table class="w-full whitespace-nowrap text-sm border-collapse"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
    }

    function renderInteractiveTranscript(textContent, aiErrors, intonationIssues, draft, defectBank) {
        if (!textContent) return `<div class="text-gray-400 italic p-3 text-center border border-dashed border-gray-200 rounded-lg">無指定文稿內容</div>`;
        const manualDefects = draft?.manual_defects_added || [];
        const removedDefects = draft?.ai_defects_removed || [];
        
        const intonationWords = new Set();
        (intonationIssues || []).forEach(issue => {
            const words = (issue.phrase || '').toLowerCase().match(/[a-z']+/g) || [];
            words.forEach(w => intonationWords.add(w));
        });

        const tokens = textContent.split(/([a-zA-Z']+)/);
        let html = `<div class="leading-relaxed text-[17px] text-gray-800 font-serif break-words mt-1" style="line-height: 1.8;">`;

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
            const isInIntonation = intonationWords.has(cleanWord);

            let classes = "inline-block px-0.5 mx-[1px] rounded transition-colors cursor-pointer relative ";
            let attributes = `data-word="${escapeHtml(cleanWord)}" data-action="word-click" `;
            let iconHtml = "";

            if (isInIntonation) {
                classes += "underline decoration-blue-500 decoration-wavy decoration-2 ";
            }

            if (isAiDefect) {
                classes += "bg-red-100 text-red-700 border-b-2 border-red-500 hover:bg-red-200 font-bold ";
                attributes += `data-kk-std="${escapeHtml(aiErrorData.kk_standard || '')}" data-kk-stu="${escapeHtml(aiErrorData.kk_student || '')}" data-time="${aiErrorData.start_time || 0}" data-issue="${escapeHtml(aiErrorData.issue_type || '發音需加強')}" data-type="ai"`;
            } else if (isManualDefect) {
                classes += "bg-orange-100 text-orange-700 border-b-2 border-orange-500 border-dashed hover:bg-orange-200 font-bold ";
                attributes += `data-type="manual" data-time="0"`;
            } else {
                classes += "hover:bg-gray-200 ";
                if (isHistoryDefect) {
                    classes += "text-green-700 font-bold border-b-2 border-green-500 ";
                    iconHtml = `<span class="absolute -top-1.5 -right-1 text-[10px]" title="歷史弱點">🎯</span>`;
                }
            }

            if (isInIntonation && !isAiDefect && !isManualDefect) {
                const matchIssue = intonationIssues.find(i => i.phrase.toLowerCase().includes(cleanWord));
                if (matchIssue) attributes = `data-action="intonation-click" data-time="${matchIssue.start_time}"`;
            }

            html += `<span class="${classes}" ${attributes}>${escapeHtml(token)}${iconHtml}</span>`;
        });
        html += `</div>`;

        if (intonationIssues && intonationIssues.length > 0) {
            html += `<div class="mt-3 p-2 bg-blue-50/50 rounded-lg border border-blue-100">
                        <h4 class="text-[11px] font-bold text-blue-800 mb-1 flex items-center m-0">
                            <span class="mr-1">〰️</span> 語調建議 <span class="text-[9px] ml-1 text-blue-500">(點波浪處播放)</span>
                        </h4>
                        <div class="space-y-1">`;
            intonationIssues.forEach(issue => {
                html += `<div class="cursor-pointer group block bg-white px-2 py-1.5 rounded shadow-sm border border-blue-50 hover:border-blue-200 transition-colors flex items-center" data-action="intonation-click" data-time="${issue.start_time || 0}">
                            <span class="text-sm text-gray-800 underline decoration-blue-500 decoration-wavy decoration-1 group-hover:bg-blue-50 transition-colors rounded px-1 shrink-0">${escapeHtml(issue.phrase)}</span>
                            <span class="text-[11px] text-blue-600 ml-2 font-medium truncate">👉 ${escapeHtml(issue.suggestion)}</span>
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

        let historyHtml = '';
        if (context.gradingHistory && context.gradingHistory.length > 0) {
            historyHtml = `
            <details class="mb-1.5 bg-white border border-gray-200 rounded group">
                <summary class="p-1 px-2 cursor-pointer font-bold text-[10px] text-gray-600 flex justify-between items-center outline-none hover:bg-gray-50 transition">
                    <span>📜 歷史紀錄 (${context.gradingHistory.length})</span>
                    <span class="text-gray-400 text-[9px]">▼</span>
                </summary>
                <div class="p-1.5 space-y-1 max-h-20 overflow-y-auto bg-gray-50 border-t border-gray-100">
                    ${context.gradingHistory.map(h => {
                        const dStr = new Date(h.timestamp).toLocaleString('zh-TW', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
                        return `
                        <div class="border-l-2 border-blue-400 pl-1.5 py-0.5">
                            <div class="flex justify-between items-center mb-0.5">
                                <span class="text-[9px] font-bold text-gray-500">${escapeHtml(h.grader || '教師')} @ ${dStr}</span>
                                <span class="text-[9px] bg-blue-100 text-blue-800 px-1 rounded font-black">Score: ${escapeHtml(h.score)}</span>
                            </div>
                            <div class="text-[10px] text-gray-700 italic truncate">${escapeHtml(h.feedback || '無評語')}</div>
                        </div>`;
                    }).join('')}
                </div>
            </details>`;
        }

        let defectHtml = '';
        const defectEntries = Object.entries(context.defectBank || {}).sort((a,b) => b[1] - a[1]);
        if (defectEntries.length > 0) {
            defectHtml = `<div class="mb-1.5 flex items-center gap-1.5">
                <span class="text-[10px] font-bold text-gray-500 whitespace-nowrap">🎯 歷史弱點:</span>
                <div class="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                    ${defectEntries.map(([w, c]) => `<span class="px-1 py-0 bg-red-50 text-red-600 border border-red-100 rounded text-[9px] font-bold shadow-sm">${escapeHtml(w)} <span class="bg-red-500 text-white px-1 rounded-full ml-0.5">${c}</span></span>`).join('')}
                </div>
            </div>`;
        }

        // 🌟 新增：AI 綜合分析與文法建議區塊 (依照 JSONB 動態渲染)
        let aiFeedbackHtml = '';
        if (aiData.comprehensive_feedback || (aiData.grammar_corrections && aiData.grammar_corrections.length > 0)) {
            aiFeedbackHtml = `
            <div class="mb-4 bg-indigo-50/80 rounded-xl border border-indigo-100 p-3 shadow-sm relative">
                <h4 class="text-[12px] font-black text-indigo-800 mb-2 flex items-center gap-1 m-0">
                    <span>✨</span> AI 綜合分析與建議
                </h4>`;

            if (aiData.comprehensive_feedback) {
                aiFeedbackHtml += `<p class="text-[11.5px] text-indigo-900 leading-relaxed mb-2 font-medium">${escapeHtml(aiData.comprehensive_feedback)}</p>`;
            }

            if (aiData.grammar_corrections && aiData.grammar_corrections.length > 0) {
                aiFeedbackHtml += `<div class="mt-2 space-y-1.5">
                    <div class="text-[10px] font-bold text-indigo-700 mb-1">📝 文法與用詞建議：</div>
                    ${aiData.grammar_corrections.map(gc => `
                        <div class="bg-white p-2 rounded-lg border border-indigo-100 text-[11px] shadow-sm">
                            <div class="text-red-500 line-through decoration-red-500/40 mb-0.5">${escapeHtml(gc.original)}</div>
                            <div class="text-green-700 font-bold mb-1">${escapeHtml(gc.corrected)}</div>
                            ${gc.explanation ? `<div class="text-gray-500 text-[10px] leading-tight border-t border-gray-50 pt-1 mt-1">${escapeHtml(gc.explanation)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>`;
            }

            aiFeedbackHtml += `
                <div class="mt-2.5 flex justify-end">
                    <button data-action="apply-ai-feedback" data-feedback="${escapeHtml(aiData.comprehensive_feedback || '')}" class="text-[10px] bg-white hover:bg-indigo-600 text-indigo-700 hover:text-white px-2.5 py-1 rounded-md font-bold transition-colors shadow-sm border border-indigo-200 cursor-pointer flex items-center gap-1">
                        ⬇️ 採用 AI 評語
                    </button>
                </div>
            </div>`;
        }

        return `
        <div id="grading-sidebar-overlay" class="fixed inset-0 bg-gray-900 bg-opacity-60 z-[9998] transition-opacity backdrop-blur-sm" data-action="close-sidebar"></div>
        <div id="grading-sidebar-panel" class="fixed right-0 top-0 h-screen bg-gray-50 shadow-[0_0_40px_rgba(0,0,0,0.2)] w-full max-w-[95vw] border-l border-gray-200 flex flex-col z-[9999] transform translate-x-full transition-transform duration-300" style="width: 850px; resize: horizontal; overflow-x: hidden; direction: rtl;">
            <div style="direction: ltr; height: 100%; display: flex; flex-direction: column;">
                
                <!-- 🌟 頂部超薄 Header + 錄音 + AI分數 (三合一, Sticky) -->
                <div class="px-3 py-1.5 bg-white border-b border-gray-200 shadow-sm shrink-0 flex items-center justify-between gap-3 sticky top-0 z-40">
                    <div class="flex items-center gap-1.5">
                        <h3 class="text-sm font-black text-gray-800 m-0 whitespace-nowrap"><span class="text-blue-600">🎙️</span> 批改</h3>
                        <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold border whitespace-nowrap shadow-sm">${escapeHtml(context.studentName)}</span>
                    </div>
                    
                    <div class="flex-1 flex items-center justify-center gap-2">
                        <audio id="student-audio" src="${escapeHtml(sub.audio_url || raw.audio_url || '')}" controls class="h-8 w-full max-w-xs outline-none"></audio>
                        <div class="flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 shadow-sm whitespace-nowrap">
                            <span class="text-[9px] font-bold text-gray-500">發音</span><span class="text-sm font-black text-blue-700 leading-none">${escapeHtml(aiData.pronunciation_score || '--')}</span>
                            <div class="w-px h-3 bg-blue-200"></div>
                            <span class="text-[9px] font-bold text-gray-500">流暢</span><span class="text-sm font-black text-blue-700 leading-none">${escapeHtml(aiData.fluency_score || '--')}</span>
                        </div>
                    </div>

                    <button data-action="close-sidebar" class="text-gray-400 hover:text-red-500 rounded w-6 h-6 flex items-center justify-center transition font-bold text-lg border-0 bg-transparent cursor-pointer leading-none">&times;</button>
                </div>

                <!-- 🌟 文稿區 (包含 AI 分析建議) -->
                <div class="flex-1 overflow-y-auto px-4 py-3 pb-[180px] bg-white">
                    ${aiFeedbackHtml}
                    
                    <audio id="google-tts-audio" class="hidden"></audio>
                    
                    <div class="flex justify-between items-end mb-2 border-b border-gray-100 pb-1 pt-1">
                        <div class="text-[11px] font-black text-gray-400 uppercase m-0">Text-Aligned Analysis</div>
                        <div class="text-[9px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">💡 點藍線聽連音 / 反白黑字可標記</div>
                    </div>
                    
                    ${renderInteractiveTranscript(textContent, aiData.word_errors, aiData.intonation_issues, draft, context.defectBank)}
                </div>

                <!-- 🌟 底部決策區 (單行壓扁) -->
                <div class="absolute bottom-0 left-0 right-0 p-3 bg-gray-50 border-t border-gray-200 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] z-30">
                    ${historyHtml}
                    ${defectHtml}
                    
                    <div class="flex gap-2 items-center mt-1">
                        <label class="text-[10px] font-bold text-gray-500 whitespace-nowrap">總分</label>
                        <input type="number" id="input-draft-score" ${isTaJunior ? 'disabled' : ''} class="w-14 h-8 px-1 border border-gray-300 rounded font-black text-lg text-blue-700 focus:ring-1 focus:ring-blue-500 focus:outline-none text-center shadow-inner bg-white" value="${escapeHtml(draft.final_score !== null ? draft.final_score : '')}">
                        
                        <label class="text-[10px] font-bold text-gray-500 whitespace-nowrap ml-1">評語</label>
                        <input type="text" id="input-draft-feedback" ${isTaJunior ? 'disabled' : ''} class="flex-1 h-8 px-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:outline-none text-[12px] shadow-inner bg-white" placeholder="給予建議..." value="${escapeHtml(draft.manual_feedback)}">
                        
                        <button data-action="save-publish" ${isTaJunior ? 'disabled' : ''} class="bg-blue-600 text-white font-bold h-8 px-3 rounded hover:bg-blue-700 shadow-sm transition disabled:opacity-50 border-0 cursor-pointer text-[12px] whitespace-nowrap">🚀 發布成績</button>
                    </div>
                    ${isTaJunior ? `<div class="text-[9px] text-red-600 mt-1 font-bold text-center">⚠️ 一般助教僅供檢視</div>` : ''}
                </div>
            </div>
        </div>`;
    }

    function renderWordPopover(word, kkStandard, kkStudent, startTime, issueType, isManualType, posX, posY, isTop) {
        const arrowHtml = isTop 
            ? `<div class="absolute bottom-[-6px] left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-r border-b border-gray-200 rotate-45"></div>` 
            : `<div class="absolute top-[-6px] left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45"></div>`;
        const transformClass = isTop ? 'transform -translate-x-1/2 -translate-y-full' : 'transform -translate-x-1/2';

        return `
            <div id="active-word-popover" class="fixed z-[10000] bg-white border border-gray-200 shadow-xl rounded-xl w-60 flex flex-col ${transformClass} transition-opacity" style="top: ${posY}px; left: ${posX}px;">
                ${arrowHtml}
                
                <div class="popover-drag-handle bg-gray-50 rounded-t-xl py-1 cursor-move flex justify-center items-center border-b border-gray-200 active:bg-gray-100 transition" title="按住拖曳">
                    <div class="w-8 h-1 bg-gray-300 rounded-full pointer-events-none"></div>
                </div>

                <div class="p-2 space-y-1.5 relative z-10">
                    <div class="flex justify-between items-center mb-0.5">
                        <span class="font-black text-lg text-gray-800 capitalize tracking-tight m-0">${escapeHtml(word)}</span>
                        <button data-action="close-popover" class="text-gray-400 hover:text-red-500 rounded text-lg w-5 h-5 flex items-center justify-center font-bold border-0 bg-transparent cursor-pointer leading-none">&times;</button>
                    </div>
                    <div class="text-[10px] bg-gray-50 p-1 rounded border border-gray-100 shadow-inner text-center"><span class="font-bold text-gray-500">診斷：</span><span class="text-gray-800 font-bold ml-1">${escapeHtml(issueType || '手動標記')}</span></div>
                    
                    <div class="flex justify-between items-center bg-blue-50 p-1.5 rounded border border-blue-100">
                        <div><span class="block text-[8px] font-black text-blue-600 mb-0.5 uppercase">標準美式音</span><span class="font-mono text-gray-900 font-bold text-xs">${escapeHtml(kkStandard || '[N/A]')}</span></div>
                        <button data-action="play-tts" data-word="${escapeHtml(word)}" class="bg-blue-500 text-white w-6 h-6 rounded flex items-center justify-center hover:bg-blue-600 shadow-sm border-0 cursor-pointer text-xs">🔊</button>
                    </div>
                    <div class="flex justify-between items-center bg-red-50 p-1.5 rounded border border-red-100">
                        <div><span class="block text-[8px] font-black text-red-600 mb-0.5 uppercase">學生實際音</span><span class="font-mono text-gray-900 font-bold text-xs">${escapeHtml(kkStudent || '[N/A]')}</span></div>
                        <button data-action="play-student" data-time="${startTime}" class="bg-red-500 text-white w-6 h-6 rounded flex items-center justify-center hover:bg-red-600 shadow-sm border-0 cursor-pointer text-xs">🎧</button>
                    </div>
                    
                    <div class="pt-1 text-center relative z-10">
                        ${isManualType 
                            ? `<button data-action="remove-manual" data-word="${escapeHtml(word)}" class="w-full text-[11px] font-bold py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-100 bg-white cursor-pointer">取消標記</button>` 
                            : `<button data-action="remove-ai" data-word="${escapeHtml(word)}" class="w-full text-[11px] font-bold py-1 border border-red-200 text-red-600 rounded hover:bg-red-50 bg-white cursor-pointer">🗑️ 移除標記 (防誤判)</button>`
                        }
                    </div>
                </div>
            </div>
        `;
    }

    return { renderMatrix, renderSidebar, renderWordPopover };
})();
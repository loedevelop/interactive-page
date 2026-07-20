/**
 * 110_teacher_core/ui-gradebook-templates.js
 * 職責：老師端批改中樞的純視覺模板工廠 (Tier 2)
 * 鐵律：僅接收 JSON，回傳 HTML 字串。絕對禁止綁定 DOM 事件。
 */
window.GradebookTemplates = (function() {
    'use strict';

    // XSS 防禦字串處理
    function escapeHtml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    /**
     * 模組 A: 產出成績單二維矩陣 (Gradebook Matrix)
     */
    function renderMatrix(matrixData, assignments) {
        if (!matrixData || matrixData.length === 0) return `<div class="p-8 text-center text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">目前無學生資料</div>`;
        if (!assignments || assignments.length === 0) return `<div class="p-8 text-center text-gray-500 bg-white rounded-xl shadow-sm border border-gray-200">目前無作業資料</div>`;

        let thead = `<tr class="bg-gray-50 text-gray-700 text-sm border-b"><th class="p-4 text-left font-bold sticky left-0 z-10 bg-gray-50">學生姓名</th>`;
        assignments.forEach(a => {
            thead += `<th class="p-4 text-center font-bold min-w-[120px]">${escapeHtml(a.title)}</th>`;
        });
        thead += `</tr>`;

        let tbody = '';
        matrixData.forEach(row => {
            tbody += `<tr class="hover:bg-blue-50 border-b transition-colors group">`;
            tbody += `<td class="p-4 font-bold text-gray-800 sticky left-0 z-10 bg-white group-hover:bg-blue-50 border-r">${escapeHtml(row.student_name)}</td>`;
            
            assignments.forEach(a => {
                const sub = row.submissions[a.id];
                if (!sub) {
                    tbody += `<td class="p-4 text-center text-gray-300">-</td>`;
                } else {
                    const finalScore = sub.raw_data?.teacher_override?.final_score ?? sub.raw_data?.ai_evaluation?.pronunciation_score ?? '批改';
                    const isGraded = !!sub.raw_data?.teacher_override?.overridden_at;
                    const scoreClass = isGraded ? (finalScore < 60 ? 'text-red-600' : 'text-green-600') : 'text-blue-600';
                    const bgClass = isGraded ? 'bg-transparent' : 'bg-yellow-100 animate-pulse';

                    tbody += `<td class="p-4 text-center cursor-pointer font-bold transition-transform hover:scale-110" 
                                  data-action="open-grading" data-submission-id="${escapeHtml(sub.id)}" data-student-id="${escapeHtml(row.student_id)}">
                                <span class="px-3 py-1 rounded-full ${scoreClass} ${bgClass}">${escapeHtml(finalScore)}</span>
                              </td>`;
                }
            });
            tbody += `</tr>`;
        });

        return `<div class="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
                    <table class="w-full whitespace-nowrap text-sm">
                        <thead>${thead}</thead>
                        <tbody>${tbody}</tbody>
                    </table>
                </div>`;
    }

    /**
     * 模組 B: 產出互動式批改文稿 (Interactive Transcript)
     */
    function renderInteractiveTranscript(textContent, aiErrors, intonationIssues, draft, defectBank) {
        if (!textContent) return `<div class="text-gray-400 italic p-4 text-center border-2 border-dashed border-gray-200 rounded-lg">無指定文稿內容</div>`;

        const manualDefects = draft.manual_defects_added || [];
        const removedDefects = draft.ai_defects_removed || [];

        // 利用正則切分單字，保留標點符號與空格，確保組裝時完全對齊原稿
        const tokens = textContent.split(/([a-zA-Z]+)/);
        let html = `<div class="leading-relaxed text-xl text-gray-800 font-serif break-words">`;

        tokens.forEach(token => {
            if (!/^[a-zA-Z]+$/.test(token)) {
                html += escapeHtml(token);
                return;
            }

            const cleanWord = token.toLowerCase();
            const aiErrorData = (aiErrors || []).find(e => e.word.toLowerCase() === cleanWord);
            const isAiDefect = !!aiErrorData && !removedDefects.includes(cleanWord);
            const isManualDefect = manualDefects.includes(cleanWord);
            const isHistoryDefect = defectBank && defectBank[cleanWord] > 0;

            let classes = "inline-block px-1 mx-[1px] rounded transition-colors cursor-pointer ";
            let attributes = `data-word="${escapeHtml(cleanWord)}" data-action="word-click" `;
            let iconHtml = "";

            if (isAiDefect) {
                // AI 抓出的錯誤 (紅字)
                classes += "bg-red-100 text-red-700 border-b-2 border-red-500 hover:bg-red-200 font-bold ";
                attributes += `data-kk-std="${escapeHtml(aiErrorData.kk_standard || '')}" data-kk-stu="${escapeHtml(aiErrorData.kk_student || '')}" data-time="${aiErrorData.start_time || 0}" data-issue="${escapeHtml(aiErrorData.issue_type || '發音需加強')}" data-type="ai"`;
            } else if (isManualDefect) {
                // 老師手動補刀標記 (橘色虛線)
                classes += "bg-orange-100 text-orange-700 border-b-2 border-orange-500 border-dashed hover:bg-orange-200 font-bold ";
                attributes += `data-type="manual" data-time="0"`;
            } else {
                // 正常單字
                classes += "hover:bg-gray-200 ";
                if (isHistoryDefect) {
                    // 【歷史進步標記】：曾錯過，但這次沒錯！
                    classes += "text-green-600 font-bold border-b-2 border-green-400 ";
                    iconHtml = `<span class="text-[10px] ml-1 align-top" title="歷史缺陷，本次已修正！">📈</span>`;
                }
            }

            html += `<span class="${classes}" ${attributes}>${escapeHtml(token)}${iconHtml}</span>`;
        });
        html += `</div>`;

        // 渲染語調/連音錯誤 (藍色波浪線)
        if (intonationIssues && intonationIssues.length > 0) {
            html += `<div class="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200">
                        <h4 class="text-sm font-bold text-blue-800 mb-3 flex items-center">
                            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> 
                            語調與連音建議 (Intonation & Liaison)
                        </h4>
                        <div class="space-y-3">`;
            intonationIssues.forEach(issue => {
                html += `<div class="cursor-pointer group block" data-action="intonation-click" data-time="${issue.start_time}">
                            <span class="text-lg text-gray-800 underline decoration-blue-500 decoration-wavy decoration-2 group-hover:bg-blue-100 transition-colors rounded px-1">${escapeHtml(issue.phrase)}</span>
                            <div class="text-sm text-blue-600 mt-1 pl-1 font-medium">👉 ${escapeHtml(issue.suggestion)}</div>
                         </div>`;
            });
            html += `</div></div>`;
        }

        return html;
    }

    /**
     * 模組 C: 產出右側滑出批改艙面板主體 (Off-canvas Sidebar)
     */
    function renderSidebar(context, currentRole) {
        if (!context || !context.submission) return '';

        const sub = context.submission;
        const aiData = sub.raw_data?.ai_evaluation || {};
        const draft = context.draft;
        const textContent = sub.raw_data?.assignment_text || "";
        const isTaJunior = currentRole === 'ta_junior';

        return `
        <div id="grading-sidebar-panel" class="fixed right-0 top-0 h-screen bg-gray-50 shadow-2xl w-[600px] border-l border-gray-200 flex flex-col z-50 transform translate-x-full transition-transform duration-300">
            
            <!-- Header -->
            <div class="px-6 py-4 bg-white border-b flex justify-between items-center shadow-sm shrink-0">
                <h3 class="text-xl font-black text-gray-800 flex items-center gap-2">
                    <span class="text-blue-600">🎙️ 語音教練</span> 批改艙
                </h3>
                <button data-action="close-sidebar" class="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full w-8 h-8 flex items-center justify-center transition font-bold text-xl">&times;</button>
            </div>

            <!-- Scrollable Body -->
            <div class="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
                <!-- 隱藏的 Google TTS 播放器 (掛載快取音軌用) -->
                <audio id="google-tts-audio" class="hidden"></audio>

                <!-- 學生錄音播放器 -->
                <div class="sticky top-0 bg-white/90 backdrop-blur z-20 p-4 rounded-xl shadow-sm border border-gray-200">
                    <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">🎧 學生原始錄音</div>
                    <audio id="student-audio" src="${escapeHtml(sub.audio_url || '')}" controls class="w-full h-10 outline-none rounded-full"></audio>
                </div>

                <!-- AI 分數儀表板 -->
                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-white p-5 rounded-xl border border-gray-200 text-center shadow-sm">
                        <div class="text-xs text-gray-500 font-bold uppercase tracking-wide">發音準確度</div>
                        <div class="text-4xl font-black text-blue-600 mt-1">${escapeHtml(aiData.pronunciation_score || '--')}</div>
                    </div>
                    <div class="bg-white p-5 rounded-xl border border-gray-200 text-center shadow-sm">
                        <div class="text-xs text-gray-500 font-bold uppercase tracking-wide">流暢度</div>
                        <div class="text-4xl font-black text-blue-600 mt-1">${escapeHtml(aiData.fluency_score || '--')}</div>
                    </div>
                </div>

                <!-- 互動式文稿 -->
                <div class="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div class="flex justify-between items-end mb-4 border-b pb-2">
                        <div class="text-sm font-bold text-gray-700">文稿對齊分析 (Text-Aligned)</div>
                        <div class="text-[10px] bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold">💡 點擊紅字聽對比 / 反白黑字可新增標記</div>
                    </div>
                    ${renderInteractiveTranscript(textContent, aiData.word_errors, aiData.intonation_issues, draft, context.defectBank)}
                </div>
            </div>

            <!-- Footer (教師手動覆寫區，固定於底部) -->
            <div class="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-200 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-30">
                <h4 class="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">👨‍🏫 教師決策覆寫 (Manual Override)</h4>
                
                ${isTaJunior ? `<div class="text-xs text-red-600 mb-3 font-bold bg-red-50 border border-red-200 p-2 rounded">⚠️ 一般助教權限：僅供檢視與標記發音，無法發布成績。</div>` : ''}

                <div class="flex gap-4 mb-4">
                    <div class="w-1/4">
                        <label class="block text-xs font-bold text-gray-500 mb-1">最終總分</label>
                        <input type="number" id="input-draft-score" ${isTaJunior ? 'disabled' : ''} class="w-full p-2 border border-gray-300 rounded-lg font-black text-2xl text-blue-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition text-center" value="${escapeHtml(draft.final_score !== null ? draft.final_score : '')}">
                    </div>
                    <div class="w-3/4">
                        <label class="block text-xs font-bold text-gray-500 mb-1">暖心評語</label>
                        <textarea id="input-draft-feedback" ${isTaJunior ? 'disabled' : ''} rows="2" class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm transition" placeholder="給予發音建議或鼓勵...">${escapeHtml(draft.manual_feedback)}</textarea>
                    </div>
                </div>

                <button data-action="save-publish" ${isTaJunior ? 'disabled' : ''} class="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.98]">
                    🚀 發布正式成績並更新缺陷庫
                </button>
            </div>
        </div>
        
        <!-- 遮罩 -->
        <div id="grading-sidebar-overlay" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-40 hidden transition-opacity backdrop-blur-sm" data-action="close-sidebar"></div>
        `;
    }

    /**
     * 模組 D: 產出點擊紅字後的「KK音標與雙向播放」氣泡 (Popover)
     */
    function renderWordPopover(word, kkStandard, kkStudent, startTime, issueType, isManualType) {
        return `
            <div class="absolute z-50 bg-white border border-gray-200 shadow-2xl rounded-xl p-4 w-72 transform -translate-x-1/2 mt-2 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)]">
                <div class="absolute top-[-6px] left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45"></div>
                
                <div class="flex justify-between items-center mb-3 pb-2 border-b relative z-10">
                    <span class="font-black text-xl text-gray-800 capitalize">${escapeHtml(word)}</span>
                    <button data-action="close-popover" class="text-gray-400 hover:text-red-500 font-bold text-lg leading-none">&times;</button>
                </div>

                <div class="text-xs bg-gray-50 p-2 rounded border border-gray-100 mb-3 relative z-10">
                    <span class="font-bold text-gray-500">AI 診斷：</span><span class="text-gray-700 font-medium">${escapeHtml(issueType || '手動標記')}</span>
                </div>
                
                <div class="space-y-2 mb-3 relative z-10">
                    <!-- Google TTS -->
                    <div class="flex justify-between items-center bg-blue-50 p-2 rounded-lg border border-blue-100">
                        <div>
                            <span class="block text-[10px] font-bold text-blue-600 mb-0.5 uppercase">標準美式音</span>
                            <span class="font-mono text-gray-800 font-bold">${escapeHtml(kkStandard || '[N/A]')}</span>
                        </div>
                        <button data-action="play-tts" data-word="${escapeHtml(word)}" class="bg-blue-500 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-blue-600 shadow-sm transition">🔊</button>
                    </div>
                    <!-- Student Audio -->
                    <div class="flex justify-between items-center bg-red-50 p-2 rounded-lg border border-red-100">
                        <div>
                            <span class="block text-[10px] font-bold text-red-600 mb-0.5 uppercase">學生實際音</span>
                            <span class="font-mono text-gray-800 font-bold">${escapeHtml(kkStudent || '[N/A]')}</span>
                        </div>
                        <button data-action="play-student" data-time="${startTime}" class="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-600 shadow-sm transition">🎧</button>
                    </div>
                </div>
                
                <div class="pt-2 text-center relative z-10">
                    ${isManualType 
                        ? `<button data-action="remove-manual" data-word="${escapeHtml(word)}" class="w-full text-xs font-bold py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-100 transition">取消手動標記</button>`
                        : `<button data-action="remove-ai" data-word="${escapeHtml(word)}" class="w-full text-xs font-bold py-2 border border-red-200 text-red-500 rounded hover:bg-red-50 transition">🗑️ 移除標記 (防誤判)</button>`
                    }
                </div>
            </div>
        `;
    }

    return {
        renderMatrix,
        renderSidebar,
        renderWordPopover
    };
})();
/**
 * 📂 110_teacher_core/ui-gradebook-templates.js
 * 🎯 職責：老師端批改中樞的純視覺模板工廠 (Tier 2)
 */
window.GradebookTemplates = (function() {
    'use strict';

    function escapeHtml(u) { return (u == null) ? '' : u.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
    function parseJSONB(d) { if (!d) return {}; if (typeof d === 'string') { try { return JSON.parse(d); } catch(e) { return {}; } } return d; }

    function renderMatrix(matrixData, assignments) {
        if (!matrixData || matrixData.length === 0) return `<div class="p-8 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">目前無學生資料</div>`;
        if (!assignments || assignments.length === 0) return `<div class="p-8 text-center text-gray-500 font-bold bg-white rounded-xl shadow-sm border border-gray-200">該班級目前無錄音作業</div>`;

        let thead = `<tr class="bg-gray-50 text-gray-700 text-sm border-b border-gray-200"><th class="p-4 text-left font-black sticky left-0 z-10 bg-gray-50 border-r border-gray-200 shadow-[1px_0_0_0_#e5e7eb]">學生姓名</th>`;
        assignments.forEach(a => {
            thead += `<th class="p-4 text-center font-bold min-w-[140px] align-top"><div class="text-[10px] text-gray-400 font-bold mb-1 truncate max-w-[140px] mx-auto uppercase tracking-wide" title="${escapeHtml(a.assignment_title)}">📂 ${escapeHtml(a.assignment_title)}</div><div class="text-sm text-gray-800">${escapeHtml(a.title)}</div></th>`;
        });
        thead += `</tr>`;

        let tbody = '';
        matrixData.forEach(row => {
            tbody += `<tr class="hover:bg-blue-50 border-b border-gray-100 transition-colors group">`;
            tbody += `<td class="p-4 font-bold text-gray-800 sticky left-0 z-10 bg-white group-hover:bg-blue-50 border-r border-gray-200 shadow-[1px_0_0_0_#e5e7eb]">${escapeHtml(row.student_name)}</td>`;
            
            assignments.forEach(a => {
                const sub = row.submissions ? row.submissions[a.id] : null;
                if (!sub) { tbody += `<td class="p-4 text-center text-gray-300 font-bold">-</td>`; } 
                else {
                    const raw = parseJSONB(sub.raw_data);
                    const override = raw.teacher_override || {};
                    const aiScore = raw.ai_evaluation?.pronunciation_score;
                    
                    let displayScore = '待批';
                    let marker = '';
                    if (override.teacher_score !== undefined) { displayScore = override.teacher_score; marker = '🧑‍🏫'; }
                    else if (override.ta_score !== undefined) { displayScore = override.ta_score; marker = '🛡️'; }
                    else if (override.final_score !== undefined) { displayScore = override.final_score; }
                    else if (aiScore !== undefined) { displayScore = aiScore; marker = '🤖'; }

                    const isGraded = displayScore !== '待批';
                    const scoreClass = isGraded ? (Number(displayScore) < 60 ? 'text-red-700 bg-red-100 border-red-200' : 'text-green-700 bg-green-100 border-green-200') : 'text-yellow-700 bg-yellow-100 border-yellow-200 animate-pulse';

                    tbody += `<td class="p-4 text-center"><button data-action="open-grading" data-submission-id="${escapeHtml(sub.id)}" data-student-id="${escapeHtml(row.student_id)}" data-task-id="${escapeHtml(a.id)}" class="px-4 py-1.5 rounded-full font-black transition-transform hover:scale-105 shadow-sm border cursor-pointer ${scoreClass} flex items-center justify-center gap-1 mx-auto min-w-[70px]">${escapeHtml(displayScore)} <span class="text-[10px] opacity-70">${marker}</span></button></td>`;
                }
            });
            tbody += `</tr>`;
        });
        return `<div class="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200"><table class="w-full whitespace-nowrap text-sm border-collapse"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
    }

    function renderInteractiveTranscript(textContent, aiErrors, draft, defectBank) {
        if (!textContent) return `<div class="text-gray-400 italic p-4 text-center border-2 border-dashed border-gray-200 rounded-lg">無指定文稿</div>`;
        const manual = draft?.manual_defects_added || [], removed = draft?.ai_defects_removed || [];
        let html = `<div class="leading-relaxed text-[22px] text-gray-800 font-serif break-words" style="line-height: 2.2;">`;
        textContent.split(/([a-zA-Z']+)/).forEach(token => {
            if (!/^[a-zA-Z']+$/.test(token)) { html += escapeHtml(token).replace(/\n/g, '<br>'); return; }
            const cw = token.toLowerCase().replace(/[^a-z']/g, '');
            const err = (aiErrors || []).find(e => (e.word || "").toLowerCase().replace(/[^a-z']/g, '') === cw);
            
            let cls = "inline-block px-[2px] rounded transition-colors cursor-pointer relative ";
            let attrs = `data-word="${escapeHtml(cw)}" data-action="word-click" `;
            let icon = defectBank?.[cw] > 0 && (!err || removed.includes(cw)) && !manual.includes(cw) ? `<span class="absolute -top-3 -right-2 text-[12px]" title="歷史已修正">📈</span>` : "";

            if (err && !removed.includes(cw)) {
                cls += "bg-red-100 text-red-700 border-b-2 border-red-500 font-bold ";
                attrs += `data-kk-std="${escapeHtml(err.kk_standard || '')}" data-kk-stu="${escapeHtml(err.kk_student || '')}" data-issue="${escapeHtml(err.issue_type || '發音偏誤')}" data-type="ai"`;
            } else if (manual.includes(cw)) {
                cls += "bg-orange-100 text-orange-700 border-b-2 border-orange-500 border-dashed font-bold ";
                attrs += `data-type="manual"`;
            } else {
                cls += "hover:bg-gray-200 ";
                if(defectBank?.[cw] > 0) cls += "text-green-700 font-bold border-b-2 border-green-500 ";
            }
            html += `<span class="${cls}" ${attrs}>${escapeHtml(token)}${icon}</span>`;
        });
        return html + `</div>`;
    }

    // 🥪 核心：三明治版面 (頭尾固定，中間獨立 Scroll，廢除巨型空間)
    function renderSidebar(context, commentBank) {
        if (!context || !context.submission) return '';
        const sub = context.submission, meta = context.taskMeta || {}, raw = parseJSONB(sub.raw_data);
        const aiData = raw.ai_evaluation || {}, draft = context.draft || {}, override = raw.teacher_override || {};
        const isTaJunior = context.role === 'ta_junior';
        const isLockedByTeacher = (override.locked_by_role === 'primary_teacher' || override.locked_by_role === 'admin') && context.role === 'ta_senior';
        
        let lockMsg = '';
        if (isTaJunior) lockMsg = `<div class="text-[11px] text-red-600 bg-red-50 p-1.5 rounded text-center font-bold mb-2">⚠️ 一般助教僅限檢視，無發布權限</div>`;
        else if (isLockedByTeacher) lockMsg = `<div class="text-[11px] text-yellow-700 bg-yellow-50 p-1.5 rounded text-center font-bold mb-2">🔒 此成績已由教師定案，助教無法覆寫</div>`;

        return `
        <div id="grading-sidebar-overlay" class="fixed inset-0 bg-gray-900/60 z-[9998] backdrop-blur-sm cursor-pointer" data-action="close-sidebar" title="點擊外部關閉"></div>
        
        <div id="grading-sidebar-panel" class="fixed right-0 top-0 h-screen w-full max-w-[550px] bg-white shadow-2xl flex flex-col z-[9999] transform translate-x-full transition-transform duration-300">
            
            <!-- 🥪 1. 頂部固定區 (極致壓縮) -->
            <div class="px-5 py-3 bg-gray-50 border-b border-gray-200 shadow-sm shrink-0 flex items-center justify-between gap-4">
                <audio id="student-audio" src="${escapeHtml(sub.audio_url || raw.audio_url || '')}" controls class="w-full h-9 outline-none flex-1 bg-white rounded-full border border-gray-200"></audio>
                <div class="flex gap-2 shrink-0">
                    <div class="bg-blue-50 text-blue-800 px-2 py-1 rounded-lg border border-blue-100 flex flex-col items-center">
                        <span class="text-[9px] font-bold opacity-70 uppercase tracking-wider">AI 發音</span>
                        <span class="text-sm font-black">${escapeHtml(aiData.pronunciation_score || '--')}</span>
                    </div>
                    <div class="bg-gray-100 text-gray-700 px-2 py-1 rounded-lg border border-gray-200 flex flex-col items-center">
                        <span class="text-[9px] font-bold opacity-70 uppercase tracking-wider">流暢度</span>
                        <span class="text-sm font-black">${escapeHtml(aiData.fluency_score || '--')}</span>
                    </div>
                </div>
            </div>

            <!-- 🥪 2. 中間獨立捲軸區 (將空間還給文稿) -->
            <div class="flex-1 overflow-y-auto p-6 bg-white relative">
                <div class="text-xs font-bold text-gray-400 mb-4 border-b border-gray-100 pb-2 flex justify-between items-end">
                    <span class="truncate max-w-[65%]">📂 ${escapeHtml(meta.title)}</span>
                    <span class="text-[10px] text-blue-500 bg-blue-50 px-2 py-1 rounded">💡 點紅字對比 / 黑字標記</span>
                </div>
                ${renderInteractiveTranscript(meta.standard_text || raw.assignment_text, aiData.word_errors, draft, context.defectBank)}
            </div>

            <!-- 🥪 3. 底部固定操作區 (評語與發布，永遠貼底可見) -->
            <div class="p-5 bg-gray-50 border-t border-gray-200 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.05)] shrink-0 z-30">
                ${lockMsg}
                <div class="flex gap-4 mb-4">
                    <div class="w-20 shrink-0 flex flex-col">
                        <label class="text-[10px] font-black text-gray-500 uppercase mb-1">最終分數</label>
                        <input type="number" id="input-draft-score" ${isTaJunior || isLockedByTeacher ? 'disabled' : ''} class="w-full flex-1 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 font-black text-2xl text-blue-600 text-center shadow-inner" value="${escapeHtml(draft.current_score !== null ? draft.current_score : '')}">
                    </div>
                    <div class="flex-1 flex flex-col min-w-0">
                        <div class="flex justify-between items-end mb-1">
                            <label class="text-[10px] font-black text-gray-500 uppercase">決策評語</label>
                            <div class="flex gap-1 overflow-x-auto no-scrollbar pb-1">
                                ${commentBank.map(txt => `<button data-action="append-template" data-text="${escapeHtml(txt)}" class="text-[10px] bg-white border border-gray-200 text-gray-600 hover:text-blue-600 px-2 py-0.5 rounded cursor-pointer whitespace-nowrap transition-colors shadow-sm">${escapeHtml(txt)}</button>`).join('')}
                            </div>
                        </div>
                        <textarea id="input-draft-feedback" ${isTaJunior || isLockedByTeacher ? 'disabled' : ''} class="w-full flex-1 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-inner" placeholder="輸入或點擊上方詞庫安插...">${escapeHtml(draft.feedback)}</textarea>
                    </div>
                </div>
                <button data-action="save-publish" ${isTaJunior || isLockedByTeacher ? 'disabled' : ''} class="w-full bg-blue-600 text-white font-black py-3.5 rounded-xl hover:bg-blue-700 shadow-sm transition active:scale-[0.98] border-0 cursor-pointer text-base disabled:opacity-50">
                    🚀 發布正式成績並更新病歷
                </button>
            </div>
        </div>
        `;
    }

    // 🚫 無 X 按鈕彈窗 (靠 Click Outside 關閉，並定位於文字正上方)
    function renderWordPopover(word, kkStandard, kkStudent, issueType, isManualType, posX, posY) {
        return `
            <div id="active-word-popover" data-popover-content="true" class="fixed z-[10000] bg-white border border-gray-200 shadow-2xl rounded-xl p-3 w-56 transform -translate-x-1/2 -translate-y-full transition-opacity mt-[-10px]" style="top: ${posY}px; left: ${posX}px;">
                <!-- 底部倒三角指標 -->
                <div class="absolute bottom-[-6px] left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-200 rotate-45"></div>
                
                <div class="font-black text-xl text-gray-800 capitalize tracking-tight text-center mb-1">${escapeHtml(word)}</div>
                <div class="text-[10px] bg-gray-50 p-1 rounded border border-gray-100 mb-2 text-center text-gray-600 font-bold">${escapeHtml(issueType || '教師手動標記')}</div>
                
                ${!isManualType ? `
                <div class="flex justify-between items-center text-sm mb-1 px-1">
                    <span class="text-gray-400 text-[10px] font-bold">標準</span>
                    <span class="font-mono font-bold text-gray-800">${escapeHtml(kkStandard || '-')}</span>
                </div>
                <div class="flex justify-between items-center text-sm mb-3 px-1">
                    <span class="text-red-400 text-[10px] font-bold">實際</span>
                    <span class="font-mono font-bold text-red-600">${escapeHtml(kkStudent || '-')}</span>
                </div>
                ` : ''}
                
                ${isManualType 
                    ? `<button data-action="remove-manual" data-word="${escapeHtml(word)}" class="w-full text-xs font-bold py-1.5 bg-gray-100 text-gray-600 rounded cursor-pointer border-0 hover:bg-gray-200">取消標記</button>`
                    : `<button data-action="remove-ai" data-word="${escapeHtml(word)}" class="w-full text-xs font-bold py-1.5 bg-red-50 text-red-600 rounded cursor-pointer border-0 hover:bg-red-100">🗑️ 移除標記 (防誤判)</button>`
                }
            </div>
        `;
    }

    return { renderMatrix, renderSidebar, renderWordPopover };
})();
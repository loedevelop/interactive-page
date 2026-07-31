/**
 * 📂 檔案路徑：110_teacher_core/ui-timeline-templates.js
 * 🌟 純視覺模板工廠 v48：
 * - 實裝真實的前端 Excel (.xlsx, .xls) 解析，結合 SheetJS，支援指定活頁與範圍。
 * - 徹底對齊「Drive / Local / 貼上文字」三大資料來源結構，並擴充學生教材的「範圍/說明」欄位。
 */

window.TimelineTemplates = (() => {

    function getTimelineStyleBlock() {
        return `
            <style>
                .timeline-node, .timeline-node * { box-sizing: border-box !important; max-width: 100%; word-break: break-word; }
                .timeline-node { overflow: visible !important; }
                div.timeline-node::before, div.timeline-node::after { display: none !important; content: none !important; }
                .rte-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; padding: 6px 12px; background: #F1F5F9; border-radius: 8px; border: 1px solid #E2E8F0; }
                .rte-btn { background: white; font-weight: 900; border: 1px solid #CBD5E1; padding: 2px 8px; border-radius: 4px; cursor: pointer; color: #334155; }
                .rte-btn:hover { background: #E2E8F0; }
                .drag-over { border: 2px dashed #10B981 !important; opacity: 0.7; }
                [contenteditable]:empty:before { content: attr(data-placeholder); color: #94A3B8; pointer-events: none; display: block; }
                @keyframes pulse-green { 0% {box-shadow: 0 0 0 0 rgba(16,185,129,0.4);} 70% {box-shadow: 0 0 0 8px rgba(16,185,129,0);} 100% {box-shadow: 0 0 0 0 rgba(16,185,129,0);} }
                .rt-normalize, .rt-normalize * { font-size: inherit !important; font-family: inherit !important; }
                details > summary::-webkit-details-marker { display: none; }
            </style>
        `;
    }

    function getLevelStyle(depth) {
        const styles = [
            { border: '#D8B4FE', bg: '#F3E8FF', text: '#581C87' }, 
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, 
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, 
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }, 
            { border: '#EF4444', bg: '#FEF2F2', text: '#7F1D1D' }  
        ];
        return styles[Math.min(depth, 4)];
    }

    function renderReadOnlyTaskItem(t, effectiveBlockDueDate, effectiveBlockLatePolicy, depth, isLastLeaf) {
        let iconStr = t.type === 'check' ? '📌'
            : (t.type === 'link' ? '🔗'
            : (t.type === 'audio_record' ? '🎙️'
            : (t.type === 'exam' ? '📝' : '📁')));
        let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.1rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
        
        let extraTag = '';
        if (t.type === 'drive') extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(專屬資料夾)</span>';
        else if (t.type === 'audio_record') {
            const useAi = t.raw_data?.use_ai_grading !== false;
            const useGrammar = t.raw_data?.use_ai_grammar === true; 
            const aiBadge = useAi ? `<span style="font-size:0.8rem; background:#DBEAFE; color:#1D4ED8; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">✨ 發音</span>` : ``;
            const grammarBadge = useGrammar ? `<span style="font-size:0.8rem; background:#FEF3C7; color:#D97706; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">📝 文法</span>` : '';
            extraTag = `<span style="font-size:0.9rem; color:#EF4444; margin-left:8px; font-weight:bold;">(語音錄製)</span>${aiBadge}${grammarBadge}`;
        } else if (t.type === 'exam') {
            const jobId = (t.raw_data && (t.raw_data.exam_job_id || (t.raw_data.exam_job && t.raw_data.exam_job.job_id))) || '';
            extraTag = '<span style="font-size:0.9rem; color:#0F766E; margin-left:8px; font-weight:bold;">(考試出題單)</span>'
                + (jobId ? `<span style="font-size:0.8rem; background:#CCFBF1; color:#0F766E; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">job: ${jobId}</span>` : '');
        }
        else extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(自行打勾)</span>';

        let taskTitleDisplay = '';
        let linkContent = '';

        if (t.type === 'link') {
            let actualUrlText = (t.url_text || '').trim();
            let actualTitle = (t.title || '').trim();

            if (actualUrlText !== '') {
                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${actualTitle || '未命名任務'}</span>`;
                linkContent = t.url ? `<a href="${t.url}" target="_blank" class="rt-normalize" style="margin-left:10px; font-size:1rem; color:var(--primary); text-decoration:underline; font-weight:800;">${actualUrlText}</a>` : `<span class="rt-normalize" style="margin-left:10px; font-size:1rem; color:#94A3B8;">(未設定網址)</span>`;
            } else {
                let fallbackText = actualTitle || '未命名連結';
                if (t.url) {
                    taskTitleDisplay = `<a href="${t.url}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;">${fallbackText}</a>`;
                } else {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${fallbackText} (未設定網址)</span>`;
                }
            }
        } else {
            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${t.title || '未命名任務'}</span>`;
        }

        let cleanTaskDesc = t.description ? t.description.replace(/<[^>]*>?/gm, '').trim() : '';
        let taskDescHtml = cleanTaskDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px;">${t.description}</div>` : '';
        
        let showTaskDue = t.due_date && t.due_date !== effectiveBlockDueDate;
        let dueBadge = showTaskDue ? `<span style="font-size:0.9rem; color:#64748B; margin-left:8px; font-weight:bold;">⏰ 期限: ${t.due_date}</span>` : '';
        
        let taskLateMode = t.late_mode || 'infinite';
        let taskPenalty = t.penalty_percentage || 0;
        let taskGrace = t.grace_period_hours || 0;
        let showLateBadge = true;

        if (effectiveBlockLatePolicy) {
            if (taskLateMode === effectiveBlockLatePolicy.mode && 
                taskPenalty === effectiveBlockLatePolicy.penalty && 
                taskGrace === (effectiveBlockLatePolicy.grace || 0)) {
                showLateBadge = false;
            }
        }

        let taskLateBadge = '';
        if (showLateBadge) {
            if (taskLateMode === 'no_late') taskLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
            else if (taskLateMode === 'custom') taskLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${taskGrace}h (-${taskPenalty}%)</span>`;
            else taskLateBadge = taskPenalty > 0 ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${taskPenalty}%</span>` : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 接受遲交</span>`;
        }
        
        let borderBottom = isLastLeaf ? 'none' : '1px solid rgba(0,0,0,0.08)';

        return `
            <div style="padding: 10px 5px; background: transparent; border-bottom: ${borderBottom}; transition: 0.2s;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; line-height: 1.2;">
                    <input type="checkbox" disabled style="transform: scale(1.3); margin-right: 8px; cursor: not-allowed; opacity: 0.5;" title="老師唯讀端核取方塊">
                    ${iconHtml}${taskTitleDisplay}${linkContent}
                    ${extraTag} ${dueBadge} ${taskLateBadge}
                </div>
                ${taskDescHtml}
            </div>
        `;
    }

    function renderReadOnlyTree(tasks, effectiveBlockDueDate, effectiveBlockLatePolicy, depth = 0) {
        if (!tasks || tasks.length === 0) return '';
        let html = '';
        tasks.forEach((t, idx) => {
            const isLastLeaf = idx === tasks.length - 1 || tasks[idx + 1].type === 'group';
            const lvl = getLevelStyle(depth);

            if (t.type === 'group') {
                let groupDueDate = t.due_date || effectiveBlockDueDate;
                let groupPolicy = {
                    mode: t.late_mode || effectiveBlockLatePolicy.mode,
                    penalty: t.penalty_percentage !== undefined ? t.penalty_percentage : effectiveBlockLatePolicy.penalty,
                    grace: t.grace_period_hours !== undefined ? t.grace_period_hours : (effectiveBlockLatePolicy.grace || 0)
                };

                let showGroupLateBadge = true;
                if (groupPolicy.mode === effectiveBlockLatePolicy.mode && 
                    groupPolicy.penalty === effectiveBlockLatePolicy.penalty && 
                    groupPolicy.grace === effectiveBlockLatePolicy.grace) {
                    showGroupLateBadge = false;
                }

                let gLateBadge = '';
                if (showGroupLateBadge) {
                    if (groupPolicy.mode === 'no_late') gLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
                    else if (groupPolicy.mode === 'custom') gLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${groupPolicy.grace}h (-${groupPolicy.penalty}%)</span>`;
                    else gLateBadge = groupPolicy.penalty > 0 ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${groupPolicy.penalty}%</span>` : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 接受遲交</span>`;
                }
                let gDueBadge = (t.due_date && t.due_date !== effectiveBlockDueDate) ? `<span style="font-size:0.9rem; color:#64748B; margin-left:8px; font-weight:bold;">⏰ 期限: ${t.due_date}</span>` : '';

                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                html += `
                    <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background: ${lvl.bg}; border: 1px solid ${lvl.border}; border-radius: 8px;">
                        <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; margin-bottom: ${t.subTasks && t.subTasks.length > 0 ? '5px' : '0'}; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:1.2rem;">🗂️</span> <span class="rt-normalize">${t.title || '未命名群組作業'}</span>
                            ${gDueBadge} ${gLateBadge}
                        </div>
                `;
                
                if (t.subTasks && t.subTasks.length > 0) {
                    html += `<div style="display:flex; flex-direction:column;">`;
                    html += renderReadOnlyTree(t.subTasks, groupDueDate, groupPolicy, depth + 1);
                    html += `</div>`;
                } else {
                    html += `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top: 5px;">(此群組作業尚無內容)</div>`;
                }
                html += `</div>`;
            } else {
                html += renderReadOnlyTaskItem(t, effectiveBlockDueDate, effectiveBlockLatePolicy, depth, isLastLeaf);
            }
        });
        return html;
    }

    function getArrowButtonsHtml(pathStr, idx, arrLength, depth, hasPrevSiblingGroup) {
        const canUp = idx > 0;
        const canDown = idx < arrLength - 1;
        const canLeft = depth > 0;
        const canRight = idx > 0 && hasPrevSiblingGroup;

        return `
            <div style="display:flex; gap:4px;">
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canUp ? 'white' : '#F1F5F9'}; cursor:${canUp ? 'pointer' : 'not-allowed'}; opacity:${canUp ? '1' : '0.4'}; border-radius:4px;" onclick="${canUp ? `window.FeatureTimeline.moveNodeUp('${pathStr}')` : ''}" ${canUp ? '' : 'disabled'} title="上移">⬆️</button>
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canDown ? 'white' : '#F1F5F9'}; cursor:${canDown ? 'pointer' : 'not-allowed'}; opacity:${canDown ? '1' : '0.4'}; border-radius:4px;" onclick="${canDown ? `window.FeatureTimeline.moveNodeDown('${pathStr}')` : ''}" ${canDown ? '' : 'disabled'} title="下移">⬇️</button>
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canLeft ? 'white' : '#F1F5F9'}; cursor:${canLeft ? 'pointer' : 'not-allowed'}; opacity:${canLeft ? '1' : '0.4'}; border-radius:4px;" onclick="${canLeft ? `window.FeatureTimeline.moveNodeLeft('${pathStr}')` : ''}" ${canLeft ? '' : 'disabled'} title="向左 (移出目前群組)">⬅️</button>
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canRight ? 'white' : '#F1F5F9'}; cursor:${canRight ? 'pointer' : 'not-allowed'}; opacity:${canRight ? '1' : '0.4'}; border-radius:4px;" onclick="${canRight ? `window.FeatureTimeline.moveNodeRight('${pathStr}')` : ''}" ${canRight ? '' : 'disabled'} title="向右 (歸入上方群組)">➡️</button>
            </div>
        `;
    }

    function renderBuilderTree(tasks, parentPathArray = [], classResOpts = '') {
        let treeHtml = tasks.map((t, idx) => {
            const pathArray = [...parentPathArray, idx];
            const pathStr = pathArray.join('-');
            const depth = pathArray.length - 1;
            const lvl = getLevelStyle(depth);
            
            const hasPrevSiblingGroup = idx > 0 && tasks[idx - 1].type === 'group';
            const arrowHtml = getArrowButtonsHtml(pathStr, idx, tasks.length, depth, hasPrevSiblingGroup);

            if (t.type === 'group') {
                let subTasksHtml = '';
                if (t.subTasks && t.subTasks.length > 0) {
                    subTasksHtml = `<div style="padding-left: 10px; display:flex; flex-direction:column;">` +
                                   renderBuilderTree(t.subTasks, pathArray, classResOpts) +
                                   `</div>`;
                } else {
                    subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此群組作業尚無內容)</div>`;
                }

                let addResourceHtml = classResOpts ? `
                    <select class="form-control" style="width:auto; padding:4px 10px; font-size:0.9rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink('${pathStr}', this.value); this.value=''; }">
                        <option value="" disabled selected>+ 📚 全域／班群／班級資源</option>
                        ${classResOpts}
                    </select>
                ` : `<button type="button" class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:0.9rem; padding:4px 10px;" title="請先至資源管理新增並派發資源">+ 📚 尚無任何可用資源</button>`;

                let gLateMode = t.late_mode || 'infinite';
                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                return `
                    <div id="group-block-${pathStr}"
                         style="${marginStyle} margin-bottom: 10px; background: #F3E8FF; padding: 12px; border-radius: 8px; border: 1px solid #D8B4FE; transition: border 0.2s;">
                        
                        <div style="display:flex; gap:10px; align-items:center; margin-bottom: 10px; padding-bottom: 10px;">
                            <span style="font-size:1.4rem;">🗂️</span>
                            <div id="node-title-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 群組作業標題" style="flex:1; font-size:1.1rem; font-weight:900; color:#581C87; padding:8px 12px; background:white; border:1px solid #D8B4FE; border-radius:6px; outline:none;">${t.title || ''}</div>
                            
                            <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                                ${arrowHtml}
                                <button type="button" class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeNode('${pathStr}')" title="刪除此群組">🗑️</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:center; background:white; padding:10px 12px; border-radius:6px; border: 1px solid #CBD5E1; margin-bottom:15px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};">群組期限：</label>
                                <input type="date" id="node-due-${pathStr}" class="form-control" style="width:auto; padding:4px 8px; font-size:0.9rem;" value="${t.due_date || ''}">
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};">遲交規則：</label>
                                <select id="node-late-mode-${pathStr}" class="form-control" style="padding:4px 8px; font-size:0.9rem; width:auto;" onchange="
                                    const m = this.value;
                                    document.getElementById('node-late-custom-${pathStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                    document.getElementById('node-grace-wrapper-${pathStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                                ">
                                    <option value="no_late" ${gLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                    <option value="infinite" ${gLateMode === 'infinite' ? 'selected' : ''}>♾️ 接受遲交</option>
                                    <option value="custom" ${gLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                </select>
                            </div>

                            <div id="node-late-custom-${pathStr}" style="display:${(gLateMode === 'infinite' || gLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#F8FAFC; padding:4px 10px; border-radius:6px; border: 1px solid #E2E8F0;">
                                <div id="node-grace-wrapper-${pathStr}" style="display:${gLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:${lvl.text};">寬限(小時):</label>
                                    <input type="number" id="node-grace-${pathStr}" class="form-control" style="padding:4px; width:60px;" value="${t.grace_period_hours || 0}" min="0">
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:${lvl.text};">扣分(%):</label>
                                    <input type="number" id="node-penalty-${pathStr}" class="form-control" style="padding:4px; width:60px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                </div>
                            </div>
                        </div>
                        
                        <div style="padding-left: 10px;">
                            ${subTasksHtml}
                            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top: 15px; margin-left: 10px;">
                                <span style="font-size:0.85rem; color:${lvl.text}; font-weight:bold; margin-right:5px; opacity:0.8;">子層作業新增：</span>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'check')">+ 📌 一般</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #64748B; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'link')">+ 🔗 連結</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #EF4444; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'audio_record')">+ 🎙️ 錄音</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #0F766E; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'exam')">+ 📝 考試</button>
                                
                                <div style="display:inline-flex; align-items:center; gap:4px;">
                                    <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #10B981; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'drive')">+ 📁 Drive</button>
                                </div>

                                <div style="width: 1px; height: 20px; background: #CBD5E1; margin: 0 5px;"></div>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'group')">+ 🗂️ 群組作業</button>
                                <div style="width: 1px; height: 20px; background: #CBD5E1; margin: 0 5px;"></div>
                                ${addResourceHtml}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                let typeSelectorHtml = `
                    <select class="form-control" style="width:auto; padding:2px 4px; font-size:1rem; border:1px solid #CBD5E1; border-radius:4px; background:#F8FAFC; cursor:pointer; color:#334155; font-weight:bold; outline:none;" onchange="window.FeatureTimeline.changeNodeType('${pathStr}', this.value)">
                        <option value="check" ${t.type === 'check' ? 'selected' : ''}>📌 一般</option>
                        <option value="link" ${t.type === 'link' ? 'selected' : ''}>🔗 連結</option>
                        <option value="drive" ${t.type === 'drive' ? 'selected' : ''}>📁 Drive</option>
                        <option value="audio_record" ${t.type === 'audio_record' ? 'selected' : ''}>🎙️ 錄音</option>
                        <option value="exam" ${t.type === 'exam' ? 'selected' : ''}>📝 考試</option>
                    </select>
                `;

                let urlInputHtml = '';
                if (t.type === 'link') {
                    let sameBtn = '';
                    if (pathArray[pathArray.length-1] > 0) {
                        const parentArr = window.FeatureTimeline.getTaskParentArray(pathArray);
                        if (parentArr[pathArray[pathArray.length-1]-1].type === 'link') {
                            sameBtn = `<button type="button" class="btn-icon" style="font-size:0.9rem; background:#E2E8F0; padding:6px; margin-left:5px;" onclick="window.FeatureTimeline.copyPrevNodeUrl('${pathStr}')">👇 同上 URL</button>`;
                        }
                    }

                    let resOptsHtml = '';
                    if (classResOpts) {
                        resOptsHtml = `<select class="form-control" style="width:auto; padding:6px; font-size:1rem; flex-shrink:0;" onchange="window.FeatureTimeline.applyResourceUrl('${pathStr}', this.value);">
                            <option value="" disabled selected>📚 手動套用資源庫</option>${classResOpts}
                        </select>`;
                    }

                    urlInputHtml = `
                        <div style="display:flex; gap:5px; margin-top:8px; width:100%; flex-wrap:wrap;">
                            <input type="text" id="node-url-text-${pathStr}" class="form-control" placeholder="🔗 顯示文字 (留空則標題變連結)" value="${t.url_text || ''}" style="flex:1; min-width:120px; padding:8px;">
                            <input type="url" id="node-url-${pathStr}" class="form-control" placeholder="🔗 https://..." value="${t.url || ''}" style="flex:2; min-width:180px; padding:8px;">
                            ${resOptsHtml}
                            ${sameBtn}
                        </div>`;
                }

                let audioInputHtml = '';
                if (t.type === 'audio_record') {
                    const raw = t.raw_data || {};
                    const useAi = raw.use_ai_grading !== false;
                    const useAiGrammar = raw.use_ai_grammar === true;
                    const captureStudio = raw.capture_studio !== false;
                    const captureUpload = raw.capture_upload !== false;

                    let scriptSource = raw.script_source || '';
                    if (!scriptSource) {
                        if (raw.snapshot_at || (raw.material_ref && raw.material_ref.published_file)) scriptSource = 'meta';
                        else if (raw.material_url || raw.student_drive_url) scriptSource = 'resource';
                        else if (raw.original_script || raw.student_display || raw.student_display_text || raw.student_text) scriptSource = 'paste';
                        else scriptSource = 'meta';
                    }

                    const safeScript = (raw.original_script || '').replace(/"/g, '&quot;');
                    const safeStudentText = (raw.student_display_text || raw.student_display || raw.student_text || '').replace(/"/g, '&quot;');
                    // 標題（麥克風右側）空白時，改用 base 範圍顯示
                    const plainTaskTitle = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
                    let materialRefs = Array.isArray(raw.material_refs) && raw.material_refs.length
                        ? raw.material_refs.slice()
                        : (raw.material_ref && raw.material_ref.published_file ? [raw.material_ref] : []);
                    const gradingUnitsForRefs = Array.isArray(raw.grading_units) ? raw.grading_units : [];
                    if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMaterialRefsMatchUnits === 'function') {
                        materialRefs = window.FeatureTimeline.ensureMaterialRefsMatchUnits(
                            materialRefs,
                            gradingUnitsForRefs,
                            materialRefs[0] || raw.material_ref || {}
                        );
                    }
                    let resolvedMaterialRange = raw.material_range || raw.student_drive_desc || '';
                    if (!resolvedMaterialRange && window.FeatureTimeline && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
                        resolvedMaterialRange = window.FeatureTimeline.buildMaterialRangeLabelFromRows(materialRefs) || '';
                    }
                    if (!resolvedMaterialRange) resolvedMaterialRange = plainTaskTitle;
                    const safeMaterialRange = String(resolvedMaterialRange || '').replace(/"/g, '&quot;');
                    const safeMaterialUrl = (raw.material_url || raw.student_drive_url || '').replace(/"/g, '&quot;');
                    const safeStudentDriveUrl = (raw.student_drive_url || raw.material_url || '').replace(/"/g, '&quot;');
                    const safeStudentDriveDesc = (raw.student_drive_desc || resolvedMaterialRange || '').replace(/"/g, '&quot;');
                    const titleFromRange = String(raw.material_range || raw.student_drive_desc || '').trim();
                    if (!plainTaskTitle && titleFromRange) {
                        t.title = titleFromRange;
                    }
                    const safeStudentLocalDesc = (raw.student_local_desc || '').replace(/"/g, '&quot;');
                    const safeStudentLocalB64 = raw.student_local_b64 || '';
                    const safeStudentLocalMime = raw.student_local_mime || '';
                    const safeStudentLocalFilename = (raw.student_local_filename || '').replace(/"/g, '&quot;');
                    const studentSourceTypeHidden = raw.student_local_b64
                        ? 'local'
                        : ((raw.student_drive_url || raw.material_url) ? 'drive' : 'text');

                    let snapshotJsonAttr = '';
                    if (raw.snapshot_at) {
                        try {
                            snapshotJsonAttr = JSON.stringify({
                                material_ref: materialRefs[0] || raw.material_ref || null,
                                material_refs: materialRefs,
                                material_range: resolvedMaterialRange || '',
                                original_script: raw.original_script || '',
                                student_display: raw.student_display || raw.student_display_text || '',
                                student_display_text: raw.student_display_text || raw.student_display || '',
                                grading_units: Array.isArray(raw.grading_units) ? raw.grading_units : [],
                                snapshot_at: raw.snapshot_at
                            }).replace(/"/g, '&quot;');
                        } catch (_snapErr) {
                            snapshotJsonAttr = '';
                        }
                    }

                    // 一頁一批改稿：有多頁 grading_units 時，逐頁提供可微調文字框，
                    // 避免老師以為改了上面合併框就能改到單頁批改稿（實際批改讀的是 grading_units[i]）。
                    const gradingUnits = Array.isArray(raw.grading_units) ? raw.grading_units : [];
                    let gradingUnitsHtml = '';
                    if (gradingUnits.length > 1) {
                        const unitRows = gradingUnits.map(function (u, uIdx) {
                            const uScript = String(u.original_script || '').replace(/"/g, '&quot;');
                            const uLabelRaw = String(u.label || (u.stem ? (u.stem + ' p.' + (u.page != null ? u.page : '?')) : ('第 ' + (uIdx + 1) + ' 頁')));
                            const uLabel = uLabelRaw.replace(/"/g, '&quot;');
                            const uKey = String(u.unit_key || uLabelRaw).replace(/"/g, '&quot;');
                            const uStem = String(u.stem || '').replace(/"/g, '&quot;');
                            const uPage = u.page != null ? String(u.page) : '';
                            const uItemCount = u.item_count != null ? String(u.item_count) : '';
                            return `
                                <div class="grading-unit-row" style="background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px;">
                                    <div style="font-weight:900; color:#4338CA; font-size:0.8rem; margin-bottom:4px;">📄 ${uLabelRaw}</div>
                                    <textarea class="form-control grading-unit-script" data-unit-key="${uKey}" data-stem="${uStem}" data-page="${uPage}" data-label="${uLabel}" data-item-count="${uItemCount}" style="width:100%; min-height:56px; padding:8px; font-size:0.88rem; border-radius:6px; border:1px solid #CBD5E1;" oninput="window.FeatureTimeline.onGradingUnitScriptInput('${pathStr}')">${uScript}</textarea>
                                </div>`;
                        }).join('');
                        gradingUnitsHtml = `
                            <div style="margin-top:4px;">
                                <div style="font-size:0.78rem; color:#7C3AED; font-weight:800; margin-bottom:6px;">⚠️ 偵測到 ${gradingUnits.length} 頁，AI 批改已依頁拆分；請在下方「逐頁」微調（上面合併框僅供預覽，不會用於批改）</div>
                                <div id="node-grading-units-${pathStr}" style="display:flex; flex-direction:column; gap:8px;">${unitRows}</div>
                            </div>`;
                    }

                    const primaryRef = materialRefs[0] || raw.material_ref || {};
                    const selectedMetaRows = materialRefs.map(function (r) {
                        return {
                            value: (r.material_folder || '') + '::' + (r.published_file || ''),
                            range_spec: r.range_spec || '',
                            label: r.label || ''
                        };
                    }).filter(function (r) { return r.value && r.value !== '::'; });
                    const materialRootKind = primaryRef.materials_root_kind === 'class' ? 'class' : 'teacher';
                    const selectedMetaJson = JSON.stringify(selectedMetaRows).replace(/"/g, '&quot;');
                    const snapshotPreview = raw.snapshot_at
                        ? ('已凍結 snapshot：' + raw.snapshot_at + (safeMaterialRange ? ('｜' + safeMaterialRange) : ''))
                        : '尚未套用 Material snapshot';

                    let resOptsHtmlForResource = '';
                    if (classResOpts) {
                        resOptsHtmlForResource = `<select class="form-control" style="width:auto; padding:6px; font-size:0.85rem; border-radius:4px; border:1px solid #CBD5E1;" onchange="window.FeatureTimeline.applyResourceUrl('${pathStr}', this.value, 'node-material-url-${pathStr}');">
                            <option value="" disabled selected>📚 從班級 01 資源庫選擇</option>${classResOpts}
                        </select>`;
                    }

                    const showMeta = scriptSource === 'meta';
                    const showRangeOnly = scriptSource === 'range_only';
                    const showPaste = scriptSource === 'paste';
                    const showResource = scriptSource === 'resource';

                    audioInputHtml = `
                        <div style="margin-top:15px; width:100%; background:#F8FAFC; padding:15px; border-radius:8px; border:1px solid #E2E8F0;">

                            <div style="display:flex; gap:20px; align-items:center; margin-bottom:14px; padding-bottom:12px; border-bottom:1px dashed #CBD5E1; flex-wrap:wrap;">
                                <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#4338CA;">
                                    <input type="checkbox" id="node-use-ai-${pathStr}" style="transform:scale(1.2); accent-color:#4338CA;" ${useAi ? 'checked' : ''}> ✨ AI 批改發音
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#D97706;">
                                    <input type="checkbox" id="node-use-grammar-${pathStr}" style="transform:scale(1.2); accent-color:#D97706;" ${useAiGrammar ? 'checked' : ''}> 📝 AI 批改文法
                                </label>
                            </div>

                            <div style="margin-bottom:14px; padding:12px; background:white; border:1px solid #E2E8F0; border-radius:8px;">
                                <div style="font-weight:900; color:#0F172A; margin-bottom:8px;">🎙️ 學生繳交方式</div>
                                <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:center;">
                                    <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; color:#334155;">
                                        <input type="checkbox" id="node-capture-studio-${pathStr}" style="transform:scale(1.15);" ${captureStudio ? 'checked' : ''}> 錄音艙
                                    </label>
                                    <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; color:#334155;">
                                        <input type="checkbox" id="node-capture-upload-${pathStr}" style="transform:scale(1.15);" ${captureUpload ? 'checked' : ''}> 上傳音檔
                                    </label>
                                    <span style="font-size:0.8rem; color:#64748B;">預設兩者都開；可只留其一</span>
                                </div>
                            </div>

                            <div style="margin-bottom:14px; padding:12px; background:white; border:1px solid #E2E8F0; border-radius:8px;">
                                <div style="font-weight:900; color:#0F172A; margin-bottom:8px;">📄 文稿來源</div>
                                <select id="node-script-source-${pathStr}" class="form-control" style="width:100%; max-width:560px; padding:8px; font-size:0.9rem; font-weight:800;" onchange="window.FeatureTimeline.onScriptSourceChange('${pathStr}')">
                                    <option value="meta" ${scriptSource === 'meta' ? 'selected' : ''}>A. meta + base 範圍（套用 Snapshot；一定有顯示文稿）</option>
                                    <option value="range_only" ${scriptSource === 'range_only' ? 'selected' : ''}>B. 無 meta + base 範圍（僅範圍，無文稿本體）</option>
                                    <option value="paste" ${scriptSource === 'paste' ? 'selected' : ''}>C. 無 meta + 自行貼上 + base 範圍</option>
                                    <option value="resource" ${scriptSource === 'resource' ? 'selected' : ''}>D. 無 meta + 資源（如 PDF）+ base 範圍 → 班級 01</option>
                                </select>
                                <div style="font-size:0.78rem; color:#64748B; margin-top:6px;">老師指哪裡就讀哪裡；班級真相是 Snapshot。有 meta 時學生可收起文稿，只留錄音鍵。</div>
                            </div>

                            <div id="node-base-range-wrap-${pathStr}" style="display:${showMeta ? 'none' : 'flex'}; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:14px; padding:12px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px;">
                                <span style="font-weight:900; color:#92400E; font-size:0.9rem;">📍 base 範圍（必填）</span>
                                <input type="text" id="node-material-range-manual-${pathStr}" class="form-control" style="flex:1; min-width:200px; padding:8px;" value="${safeMaterialRange}" placeholder="例：A pp. 1~2 B pp. 1~2">
                            </div>

                            <div id="script-source-panel-meta-${pathStr}" style="display:${showMeta ? 'block' : 'none'}; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; padding:12px; margin-bottom:14px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                                    <div style="font-weight:900; color:#5B21B6;">📦 Material Snapshot（＋新增 meta 列）</div>
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#7C3AED; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.loadMaterialMetaSelect('${pathStr}')">🔄 載入 meta 清單</button>
                                </div>
                                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px;">
                                    <select id="node-material-root-${pathStr}" class="form-control" style="width:auto; padding:6px; font-size:0.85rem; font-weight:800;" onchange="window.FeatureTimeline.onMaterialRootChange('${pathStr}')">
                                        <option value="teacher" ${materialRootKind === 'teacher' ? 'selected' : ''}>👤 老師個人母稿</option>
                                        <option value="class" ${materialRootKind === 'class' ? 'selected' : ''}>🏫 班級 00（若有）</option>
                                    </select>
                                    <span style="font-size:0.78rem; color:#64748B;">每列一個 meta；範圍例：<code>pp. 1~2, 5, 10</code> 或 <code>#11~16, 26</code></span>
                                </div>
                                <div id="node-material-rows-${pathStr}" style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px;"></div>
                                <input type="hidden" id="node-material-selected-json-${pathStr}" value="${selectedMetaJson}">
                                <div style="margin-bottom:8px;">
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#4F46E5; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.addMaterialMetaRow('${pathStr}')">＋ 新增 meta</button>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; padding:10px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px;">
                                    <span style="font-weight:900; color:#92400E; font-size:0.85rem;">📍 base 範圍</span>
                                    <input type="text" id="node-material-range-${pathStr}" class="form-control" style="flex:1; min-width:220px; padding:8px; font-weight:800;" value="${safeMaterialRange}" placeholder="例：A pp. 1~2, 5, 10；D #11~16, 26">
                                    <button type="button" class="btn-action" style="font-size:0.8rem; padding:6px 10px; background:#F59E0B; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.refreshMaterialRangeLabel('${pathStr}')">依列重算</button>
                                </div>
                                <div style="margin-bottom:8px; padding:10px 12px; background:#EEF2FF; border:1px solid #C7D2FE; border-radius:6px; font-size:0.82rem; color:#3730A3; font-weight:700; line-height:1.45;">
                                    🎙 錄音單位提示：以「一頁」為唯一錄音單位。學生同一作業可複選多檔上傳；Snapshot 會依頁準備 AI 批改稿（一頁一份）。
                                </div>
                                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#6366F1; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.previewMaterialSnapshot('${pathStr}')">👁 預覽</button>
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#059669; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.applyMaterialSnapshot('${pathStr}')">📌 套用 Snapshot</button>
                                </div>
                                <div id="node-material-status-${pathStr}" style="font-size:0.8rem; color:#64748B; margin-bottom:6px;"></div>
                                <div id="node-material-preview-${pathStr}" style="font-size:0.8rem; color:#475569; background:white; border:1px dashed #CBD5E1; border-radius:6px; padding:8px; max-height:160px; overflow:auto;">${snapshotPreview}</div>
                                <input type="hidden" id="node-material-snapshot-json-${pathStr}" value="${snapshotJsonAttr}">
                                <div style="margin-top:12px; display:flex; flex-direction:column; gap:10px;">
                                    <div>
                                        <div id="node-script-label-${pathStr}" style="font-weight:800; font-size:0.85rem; color:#4338CA; margin-bottom:4px;">🎯 AI 批改文稿${gradingUnits.length > 1 ? '（合併預覽，唯讀）' : '（可微調）'}</div>
                                        <textarea id="node-script-${pathStr}" class="form-control" style="width:100%; min-height:70px; padding:10px; font-size:0.9rem; border-radius:6px; border:1px solid #CBD5E1; ${gradingUnits.length > 1 ? 'background:#F1F5F9; color:#64748B;' : ''}" placeholder="套用 Snapshot 後會填入；可再微調" ${gradingUnits.length > 1 ? 'readonly' : ''}>${safeScript}</textarea>
                                        ${gradingUnitsHtml}
                                    </div>
                                    <div>
                                        <div style="font-weight:800; font-size:0.85rem; color:#065F46; margin-bottom:4px;">👀 學生顯示文稿（有 meta 必有；學生端可收起）</div>
                                        <textarea id="node-student-text-${pathStr}" class="form-control" style="width:100%; min-height:70px; padding:10px; font-size:0.9rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="套用 Snapshot 後會填入">${safeStudentText}</textarea>
                                    </div>
                                </div>
                            </div>

                            <div id="script-source-panel-range_only-${pathStr}" style="display:${showRangeOnly ? 'block' : 'none'}; margin-bottom:14px; padding:12px; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:8px; font-size:0.85rem; color:#475569;">
                                僅交代學生念哪一段（上方 base 範圍）。無顯示文稿本體；若要 AI 請改選 C 貼上或 A meta。
                            </div>

                            <div id="script-source-panel-paste-${pathStr}" style="display:${showPaste ? 'block' : 'none'}; margin-bottom:14px;">
                                <div style="display:flex; flex-direction:column; gap:12px;">
                                    <div style="background:white; border:1px solid #CBD5E1; border-radius:8px; padding:12px;">
                                        <div style="font-weight:900; color:#334155; margin-bottom:8px;">🎯 批改文稿（AI 基準）</div>
                                        <textarea id="node-script-paste-${pathStr}" class="form-control" style="width:100%; min-height:80px; padding:10px; font-size:0.9rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="貼上 AI 評分用英文稿…">${safeScript}</textarea>
                                    </div>
                                    <div style="background:white; border:1px solid #CBD5E1; border-radius:8px; padding:12px;">
                                        <div style="font-weight:900; color:#334155; margin-bottom:8px;">👀 學生顯示文稿</div>
                                        <textarea id="node-student-text-paste-${pathStr}" class="form-control" style="width:100%; min-height:80px; padding:10px; font-size:0.9rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="貼上學生錄音艙看到的內容…">${safeStudentText}</textarea>
                                    </div>
                                    <div style="font-size:0.78rem; color:#64748B;">內容寫入作業 Snapshot 欄位；建議歸檔本班 01_Class_Resources。</div>
                                </div>
                            </div>

                            <div id="script-source-panel-resource-${pathStr}" style="display:${showResource ? 'block' : 'none'}; margin-bottom:14px; background:white; border:1px solid #CBD5E1; border-radius:8px; padding:12px;">
                                <div style="font-weight:900; color:#334155; margin-bottom:8px;">📁 資源（PDF 等）→ 班級 01_Class_Resources</div>
                                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
                                    <input type="url" id="node-material-url-${pathStr}" class="form-control" style="flex:2; min-width:180px; padding:8px; font-size:0.85rem;" placeholder="Drive／資源網址" value="${safeMaterialUrl}">
                                    ${resOptsHtmlForResource}
                                </div>
                                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; background:#F8FAFC; padding:10px; border-radius:6px; border:1px solid #E2E8F0;">
                                    <input type="file" id="node-student-local-file-${pathStr}" accept=".pdf,.xlsx,.xls,.csv,image/*" class="form-control" style="flex:2; min-width:150px; font-size:0.85rem; padding:4px;" onchange="window.FeatureTimeline.handleStudentLocalFileChange(this, '${pathStr}')">
                                    <input type="text" id="node-student-local-desc-${pathStr}" class="form-control" style="flex:1; min-width:80px; padding:6px; font-size:0.85rem;" placeholder="說明（選填）" value="${safeStudentLocalDesc}">
                                    <span style="font-size:0.78rem; color:#64748B; width:100%;">選本機檔後，儲存作業時會上傳到本班 01_Class_Resources。</span>
                                    <input type="hidden" id="node-student-local-b64-${pathStr}" value="${safeStudentLocalB64}">
                                    <input type="hidden" id="node-student-local-mime-${pathStr}" value="${safeStudentLocalMime}">
                                    <input type="hidden" id="node-student-local-filename-${pathStr}" value="${safeStudentLocalFilename}">
                                    <input type="hidden" id="node-student-drive-url-${pathStr}" value="${safeStudentDriveUrl}">
                                    <input type="hidden" id="node-student-drive-desc-${pathStr}" value="${safeStudentDriveDesc}">
                                    <input type="hidden" id="node-student-source-type-${pathStr}" value="${studentSourceTypeHidden}">
                                </div>
                            </div>
                        </div>
                    `;
                }

                let examInputHtml = '';
                if (t.type === 'exam') {
                    examInputHtml = (window.FeatureExamJob && typeof window.FeatureExamJob.renderInlineEditorHtml === 'function')
                        ? window.FeatureExamJob.renderInlineEditorHtml(pathStr, t)
                        : '<div style="margin-top:8px; color:#B91C1C;">FeatureExamJob 未載入</div>';
                }

                let tLateMode = t.late_mode || 'infinite';

                return `
                    <div id="node-block-${pathStr}"
                         style="margin-top: 10px; margin-bottom: 10px; background: white; padding: 12px; border: 1px solid #CBD5E1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); transition: border 0.2s;">
                        <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom: 8px;">
                            <div style="padding-top:4px;">${typeSelectorHtml}</div>
                            <div id="node-title-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題" style="flex:1; min-width:150px; font-size:1rem; padding:8px 12px; background:white; border:1px solid #CBD5E1; border-radius:6px; outline:none; min-height:38px;">${t.title || ''}</div>
                            
                            <div style="display:flex; align-items:center; gap:10px; padding-top:4px; flex-wrap:wrap;">
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">期限:</label>
                                    <input type="date" id="node-due-${pathStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:130px;" value="${t.due_date || ''}" title="留空則繼承外層">
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">遲交:</label>
                                    <select id="node-late-mode-${pathStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:auto;" onchange="
                                        const m = this.value;
                                        document.getElementById('node-late-custom-${pathStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                        document.getElementById('node-grace-wrapper-${pathStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                                    ">
                                        <option value="no_late" ${tLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                        <option value="infinite" ${tLateMode === 'infinite' ? 'selected' : ''}>♾️ 接受遲交</option>
                                        <option value="custom" ${tLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                    </select>
                                </div>
                                
                                <div id="node-late-custom-${pathStr}" style="display:${(tLateMode === 'infinite' || tLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:5px; background:#F8FAFC; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0;">
                                    <div id="node-grace-wrapper-${pathStr}" style="display:${tLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                        <label style="font-size:0.85rem; color:#64748B;">寬限(時):</label>
                                        <input type="number" id="node-grace-${pathStr}" class="form-control" style="padding:4px; width:50px;" value="${t.grace_period_hours || 0}" min="0">
                                    </div>
                                    <div style="display:flex; align-items:center; gap:5px;">
                                        <label style="font-size:0.85rem; color:#64748B;">扣分(%):</label>
                                        <input type="number" id="node-penalty-${pathStr}" class="form-control" style="padding:4px; width:50px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                    </div>
                                </div>
                            </div>

                            <div style="display:flex; align-items:center; gap:8px; padding-top:4px; margin-left:auto;">
                                ${arrowHtml}
                                <button type="button" class="btn-danger" style="padding:6px 10px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeNode('${pathStr}')">❌</button>
                            </div>
                        </div>
                        ${urlInputHtml}
                        ${audioInputHtml}
                        ${examInputHtml}
                        <div style="margin-top:8px; border-top:1px dashed #E2E8F0; padding-top:8px;">
                            <div id="node-desc-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="width:100%; min-height: 40px; font-size:0.85rem; padding:8px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; outline:none;">${t.description || ''}</div>
                        </div>
                    </div>
                `;
            }
        });
        return treeHtml.join('');
    }

    function getHistoryDropdownHtml(allAssigns, containerId) {
        if (!allAssigns || allAssigns.length === 0) return '';
        let opts = allAssigns.map(a => `<option value="${a.id}">${a.target_date} - ${a.title.replace(/<[^>]*>?/gm, '')}</option>`).join('');
        return `
            <div style="margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #E2E8F0;">
                <label style="font-size:0.9rem; font-weight:800; color:#64748B;">🔄 快速載入過去的區塊樣板：</label>
                <div style="display:flex; gap:10px; margin-top:5px; align-items:center;">
                    <select id="history-select-${containerId}" class="form-control" style="flex:1;" onchange="window.FeatureTimeline.copyHistory(this.value)">
                        <option value="">-- 選擇歷史紀錄 --</option>
                        ${opts}
                    </select>
                    <button type="button" class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.deleteHistoryTemplate()" title="刪除選取的歷史紀錄">🗑️ 刪除紀錄</button>
                </div>
            </div>`;
    }

    function getBuilderFormHtml(bState, classResOpts, tasksContainerHtml, historyHtml) {
        const bLateMode = bState.late_mode || 'infinite';
        const rteToolbarHtml = `
            <div class="rte-toolbar">
                <span style="font-size:1rem; font-weight:800; color:#64748B; margin-right:5px;">反白選取編輯：</span>
                <button type="button" class="rte-btn" onmousedown="event.preventDefault(); document.execCommand('bold', false, null);">B</button>
                <button type="button" class="rte-btn" style="font-style:italic;" onmousedown="event.preventDefault(); document.execCommand('italic', false, null);">I</button>
                <button type="button" class="rte-btn" style="text-decoration:underline;" onmousedown="event.preventDefault(); document.execCommand('underline', false, null);">U</button>
                <select class="rte-btn" onchange="document.execCommand('foreColor', false, this.value); this.selectedIndex=0;" style="padding: 2px 4px; border-radius: 4px; cursor: pointer; font-weight: 800;">
                    <option value="">🎨 顏色</option>
                    <option value="#EF4444" style="color:#EF4444; font-weight:bold;">🔴 紅色</option>
                    <option value="#F59E0B" style="color:#F59E0B; font-weight:bold;">🟠 橘色</option>
                    <option value="#10B981" style="color:#10B981; font-weight:bold;">🟢 綠色</option>
                    <option value="#3B82F6" style="color:#3B82F6; font-weight:bold;">🔵 藍色</option>
                    <option value="#8B5CF6" style="color:#8B5CF6; font-weight:bold;">🟣 紫色</option>
                    <option value="#1E293B" style="color:#1E293B; font-weight:bold;">⚫ 黑色</option>
                </select>
            </div>
        `;

        let addResourceHtml = classResOpts ? `
            <select class="form-control" style="width:auto; padding:6px 12px; font-size:1rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink(null, this.value); this.value=''; }">
                <option value="" disabled selected>+ 📚 全域／班群／班級資源</option>
                ${classResOpts}
            </select>
        ` : `<button type="button" class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:1rem;" title="請先至資源管理新增並派發資源">+ 📚 尚無任何可用資源</button>`;

        return `
            <div id="${bState.containerId}-editor" style="border: 2px dashed #10B981; padding: 20px; border-radius: 12px; margin-top: 20px; background: #FFFDF8; overflow:hidden;">
                ${historyHtml}
                ${rteToolbarHtml}
                <div style="background: white; border: 1px solid #CBD5E1; border-radius: 8px; padding: 15px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div id="builder-title-${bState.containerId}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題" style="font-weight:900; font-size:1rem; border-bottom:1px solid #E2E8F0; padding-bottom:8px; margin-bottom:10px; outline:none; min-height:30px; color: var(--primary-dark);">${bState.title || ''}</div>
                    <div id="builder-desc-${bState.containerId}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="font-size:0.85rem; outline:none; min-height:50px; margin-bottom:15px; color: #475569;">${bState.description || ''}</div>
                    
                    <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center; background:#F8FAFC; padding:10px 12px; border-radius:6px; border: 1px solid #E2E8F0;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">區塊期限：</label>
                            <input type="date" id="builder-due-${bState.containerId}" class="form-control" style="width:auto; padding:4px 8px; font-size:1rem;" value="${bState.due_date || ''}">
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">區塊遲交規則：</label>
                            <select id="builder-late-mode-${bState.containerId}" class="form-control" style="padding:4px 8px; font-size:1rem; width:auto;" onchange="
                                const m = this.value;
                                document.getElementById('builder-late-custom-${bState.containerId}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                document.getElementById('builder-grace-wrapper-${bState.containerId}').style.display = (m === 'custom') ? 'flex' : 'none';
                            ">
                                <option value="no_late" ${bLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                <option value="infinite" ${bLateMode === 'infinite' ? 'selected' : ''}>♾️ 接受遲交</option>
                                <option value="custom" ${bLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                            </select>
                        </div>
                        <div id="builder-late-custom-${bState.containerId}" style="display:${(bLateMode === 'infinite' || bLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#F1F5F9; padding:4px 10px; border-radius:6px; border:1px solid #CBD5E1;">
                            <div id="builder-grace-wrapper-${bState.containerId}" style="display:${bLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                <label style="font-size:0.9rem; font-weight:bold; color:#475569;">寬限(小時):</label>
                                <input type="number" id="builder-grace-${bState.containerId}" class="form-control" style="padding:4px; width:70px;" value="${bState.late_grace || 0}" min="0">
                            </div>
                            <div style="display:flex; align-items:center; gap:5px;">
                                <label style="font-size:0.9rem; font-weight:bold; color:#475569;">扣分(%):</label>
                                <input type="number" id="builder-penalty-${bState.containerId}" class="form-control" style="padding:4px; width:70px;" value="${bState.late_penalty || 0}" min="0" max="100">
                            </div>
                        </div>
                        <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#334155; margin-left: auto;">
                            <input type="checkbox" id="builder-pub-${bState.containerId}" style="transform:scale(1.2);" ${bState.is_published ? 'checked' : ''}>
                            📢 發佈
                        </label>
                    </div>
                </div>

                ${tasksContainerHtml}

                <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; background: #F1F5F9; padding: 12px; border-radius: 8px; border: 1px solid #CBD5E1;">
                    <span style="font-size:0.9rem; font-weight:bold; color:#475569; margin-right:5px;">外層作業新增：</span>
                    <button type="button" class="btn btn-action" style="font-size:1rem;" onclick="window.FeatureTimeline.addNode(null, 'check')">+ 📌 一般</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #64748B; color: white;" onclick="window.FeatureTimeline.addNode(null, 'link')">+ 🔗 連結</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #EF4444; color: white;" onclick="window.FeatureTimeline.addNode(null, 'audio_record')">+ 🎙️ 錄音</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #0F766E; color: white;" onclick="window.FeatureTimeline.addNode(null, 'exam')">+ 📝 考試</button>
                    <div style="display:inline-flex; align-items:center; gap:4px;">
                        <button type="button" class="btn btn-action" style="font-size:1rem; background: #10B981; color: white;" onclick="window.FeatureTimeline.addNode(null, 'drive')">+ 📁 Drive</button>
                    </div>
                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addNode(null, 'group')">+ 🗂️ 群組作業</button>
                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    ${addResourceHtml}
                </div>

                <div style="display:flex; gap:10px; margin-top:20px; border-top:1px solid #E2E8F0; padding-top:15px;">
                    <button type="button" id="btn-save-block-${bState.containerId}" class="btn btn-primary" style="font-size:1rem;" onclick="window.FeatureTimeline.saveBlock(this)">💾 ${bState.editId ? '儲存修改' : '完成並儲存區塊'}</button>
                    <button type="button" class="btn" style="background:#E2E8F0; color:#334155; font-size:1rem;" onclick="window.FeatureTimeline.cancelBuilder()">取消</button>
                </div>
            </div>
        `;
    }

    function getAssignmentBlockHtml(a, classId, canEditTimeline, effectiveBlockDueDate, blockLateMode, blockPenalty, blockGrace, tasksHtml) {
        let cleanBlockDesc = a.description ? a.description.replace(/<[^>]*>?/gm, '').trim() : '';
        let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:8px;">${a.description}</div>` : '';
        let pubBadge = a.is_published ? `<span style="background:#2ECC71; color:white; font-size:0.9rem; padding:2px 6px; border-radius:4px; margin-left:8px;">✅ 發佈</span>` : `<span style="background:#94A3B8; color:white; font-size:0.9rem; padding:2px 6px; border-radius:4px; margin-left:8px;">🙈 未發佈</span>`;
        
        let lateBadgeText = '';
        if (blockLateMode === 'no_late') lateBadgeText = ' (🚫 無遲交)';
        else if (blockLateMode === 'custom') lateBadgeText = ` (⏳ 寬限 ${blockGrace}h (-${blockPenalty}%))`;
        else lateBadgeText = blockPenalty > 0 ? ` (♾️ 遲交扣 ${blockPenalty}%)` : ' (♾️ 接受遲交)';

        let blockDueBadge = effectiveBlockDueDate ? `<span style="font-size:1rem; color:#475569; margin-left:10px; font-weight:bold;">⏰ 期限: ${effectiveBlockDueDate}${lateBadgeText}</span>` : '';
        let tasksSectionHtml = tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : '';

        const dragHandleHtml = canEditTimeline ? `<span style="cursor: grab; margin-right:8px; color:#94A3B8; display:inline-block; padding: 4px;" title="拖曳排序區塊" onmousedown="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'true')" onmouseup="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'false')" onmouseleave="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'false')">↕️</span>` : '';
            
        const actionButtonsHtml = canEditTimeline ? `<div style="display:flex; gap:8px; align-items:center;">
                   <button type="button" class="btn-icon" style="font-size:1rem; background:#F1F5F9; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.moveAssignment('${a.id}', '${classId}')" title="更換日期">📅 改期</button>
                   <button type="button" class="btn-icon" style="font-size:1rem; background:#F1F5F9; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.editAssignment('${a.id}')">✏️ 修改</button>
                   <button type="button" class="btn-icon btn-danger" style="font-size:1rem; border:none; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.deleteAssignment('${a.id}', '${classId}')" title="刪除">🗑️</button>
               </div>` : '';

        const dragEventsHtml = canEditTimeline ? `ondragstart="window.FeatureTimeline.dragAssignStart(event, '${a.id}')" ondragover="event.preventDefault(); this.classList.add('drag-over');" ondragleave="this.classList.remove('drag-over');" ondrop="this.classList.remove('drag-over'); window.FeatureTimeline.dropAssign(event, '${a.id}', '${classId}')" ondragend="this.setAttribute('draggable', 'false');"` : '';

        return `
            <div id="assign-block-${a.id}" draggable="false" ${dragEventsHtml} style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                    <div style="font-weight: 900; color: var(--primary-dark); font-size: 1rem; display:flex; align-items:center;">
                        ${dragHandleHtml} <span style="margin-right:6px;">📝</span> <span class="rt-normalize">${a.title}</span> <span style="margin-left:8px;">${pubBadge}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:15px; margin-left:auto;">
                        ${blockDueBadge}
                        ${actionButtonsHtml}
                    </div>
                </div>
                ${blockDescHtml}
                ${tasksSectionHtml}
            </div>
        `;
    }

    function getTimelineNodeHtml(index, mode, nodeTitle, isCurrent, isFuture, nodeDate, classId, canEditTimeline, assignmentsHtml, builderContainerId, canDeleteSession) {
        let badge = '', borderColor = '#E2E8F0', dotColor = '#E2E8F0', bgColor = '#FFFFFF', headerTextColor = '#475569';

        if (isCurrent) {
            badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.9rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
            borderColor = '#10B981'; dotColor = '#10B981'; bgColor = '#ECFDF5'; headerTextColor = '#065F46';
        } else if (!isFuture) {
            dotColor = '#CBD5E1'; bgColor = '#F8FAFC'; headerTextColor = '#94A3B8';
        }

        const addBlockBtn = canEditTimeline ? `<button type="button" class="btn btn-primary" onclick="window.FeatureTimeline.openBuilder('${classId}', '${nodeDate}', '${builderContainerId}')">+ 新增區塊</button>` : '';
        const deleteSessionBtn = canDeleteSession
            ? `<button type="button" class="btn" title="刪除空白堂次" style="background:#FEF2F2; color:#B91C1C; border:1px solid #FECACA; font-weight:800; padding:6px 12px;" onclick="window.FeatureTimeline.removeSessionDate('${classId}', '${nodeDate}')">刪此日</button>`
            : '';
        const headerActions = (addBlockBtn || deleteSessionBtn)
            ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">${deleteSessionBtn}${addBlockBtn}</div>`
            : '';
        const nodeDragEvents = canEditTimeline ? `ondragover="event.preventDefault();" ondrop="window.FeatureTimeline.dropAssignToNode(event, '${nodeDate}', '${classId}')"` : '';

        return `
            <div id="timeline-node-${index}" class="timeline-node" data-is-current="${isCurrent}" style="overflow: visible !important; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative; scroll-margin-top: 25px;" ${nodeDragEvents}>
                <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                    <div class="node-date" style="display:flex; align-items:center; position:relative;">
                        <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                        <span style="font-weight: 800; color: ${headerTextColor}; font-size: 1rem;">📅 第 ${index + 1} ${mode === 'weekly' ? '週' : '堂'} - ${nodeTitle}</span> ${badge}
                    </div>
                    ${headerActions}
                </div>
                ${assignmentsHtml}
                <div id="${builderContainerId}"></div>
            </div>`;
    }

    function getAddSessionModalHtml(classId) {
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">＋ 加堂</h3>
                <p style="margin:0 0 16px; color:#64748B; font-size:0.95rem; line-height:1.5;">
                    將日期加入進度軸。若超出學期起訖日，確認後仍可加（例如補課）。
                </p>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom: 25px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
                    <label style="font-weight:800; color:#334155; white-space:nowrap;">日期：</label>
                    <input type="date" id="add-session-date" class="form-control" style="flex:1; padding: 8px; font-size: 1rem;">
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size:1rem;" onclick="window.ModalOverlay.close('add-session-modal')">取消</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-add-session" style="padding: 8px 20px; font-size:1rem;" onclick="window.FeatureTimeline.submitAddSession('${classId}')">確認加堂</button>
                </div>
            </div>
        `;
    }

    function getMoveAssignModalHtml(cleanTitle, targetDate, assignId, classId, sessionDates) {
        const dates = Array.isArray(sessionDates) ? sessionDates : [];
        const optionsHtml = dates.map(function (d) {
            const selected = d === targetDate ? ' selected' : '';
            return '<option value="' + d + '"' + selected + '>' + d + '</option>';
        }).join('');

        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📅 作業改期 / 搬移</h3>
                <div style="margin-bottom:12px; font-size:1rem; color:#475569; line-height:1.5;">
                    準備將 <strong>「${cleanTitle}」</strong> 搬移至新日期：
                </div>
                <p style="margin:0 0 14px; font-size:0.88rem; color:#64748B; line-height:1.45;">
                    若清單沒有目標日，請先在進度軸按「＋ 加堂」。
                </p>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom: 25px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
                    <label style="font-weight:800; color:#334155; white-space:nowrap;">選擇新日期：</label>
                    <select id="move-target-date" class="form-control" style="flex:1; padding: 8px; font-size: 1rem;">
                        ${optionsHtml}
                    </select>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size:1rem;" onclick="window.ModalOverlay.close('move-assign-modal')">取消</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-move" style="padding: 8px 20px; font-size:1rem;" onclick="window.FeatureTimeline.submitMove('${assignId}', '${classId}', '${targetDate}')">確認改期</button>
                </div>
            </div>
        `;
    }

    function getLinePushModalHtml(cleanTitle, assignId, classId, overlayId) {
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #059669; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📢 推播至 LINE 群組</h3>
                <div style="margin-bottom:20px; font-size:1rem; color:#475569; line-height:1.5;">
                    準備將 <strong>「${cleanTitle}」</strong> 的作業詳情，傳送至已綁定的 LINE 群組。
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight:bold; font-size:1rem;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-push" style="padding: 8px 20px; font-weight:bold; font-size:1rem; background:#10B981; border:none;" onclick="window.FeatureTimeline.executeLinePush('${assignId}', '${classId}')">🚀 確認發送</button>
                </div>
            </div>
        `;
    }

    return {
        getTimelineStyleBlock,
        renderReadOnlyTree,
        renderBuilderTree,
        getHistoryDropdownHtml,
        getBuilderFormHtml,
        getAssignmentBlockHtml,
        getTimelineNodeHtml,
        getAddSessionModalHtml,
        getMoveAssignModalHtml,
        getLinePushModalHtml
    };
})();
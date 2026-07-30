/**
 * 📂 檔案路徑：120_student_core/feature-student-analytics.js
 * 🌟 職責：「學習分析」頁籤 —「電視」概念：左側是選台器（教材資料夾 → 字母 → 頁），
 *          右側「螢幕」顯示選到的那一頁：分數趨勢在最上方，下面是「日期頻道」，
 *          背景文稿不變，切換日期只換文稿上標示的錯字／分數／評語。
 * 🌟 與「課程進度」頁籤分工：
 *    - 課程進度：依時間軸排列，回答「這一次交的作業，AI 怎麼看」（原地查看，預設收合）。
 *    - 學習分析：依教材／字母／頁分層瀏覽，回答「這個範圍練了幾次，有沒有進步」。
 * ⚠️ 目前範圍：僅彙整「目前所在班級」（沿用 FeatureStudentTimeline 已載入的資料，不重打 API）。
 *    之後若要跨班級彙整，只需把 buildGroups() 的輸入來源改成多班資料即可，
 *    分組／畫面邏輯不需要動。
 */
window.FeatureStudentAnalytics = (() => {
    'use strict';

    // 選台器目前選到哪裡（教材資料夾 → 字母 → 頁），跨次 render() 保留，直到使用者換頁籤重新整理。
    const state = { folderKey: null, fileKey: null, groupKey: null };

    function escapeAttr(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /** 給 onclick="...('這裡')" 用的 JS 字串跳脫（不同於 HTML 屬性跳脫）。 */
    function escapeJsArg(str) {
        return String(str == null ? '' : str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '');
    }

    /** 把分組 key 轉成可以當 DOM id 用的安全字串。 */
    function sanitizeId(str) {
        return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /** 從 grading_history 每筆紀錄自帶的 audio_url 反推 Drive fileId（沒有就交給呼叫端 fallback）。 */
    function extractDriveFileId(url) {
        if (!url) return '';
        const str = String(url);
        let m = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!m) m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        return m ? m[1] : '';
    }

    /** 遞迴展平 group，只留下 audio_record 任務，並帶上所屬作業資訊。 */
    function flattenAudioTasks(tasks, assignment, out) {
        (tasks || []).forEach(function (t) {
            if (!t) return;
            if (t.type === 'group' && Array.isArray(t.subTasks)) {
                flattenAudioTasks(t.subTasks, assignment, out);
            } else if (t.type === 'audio_record') {
                out.push({ task: t, assignment: assignment });
            }
        });
        return out;
    }

    function getMaterialRefs(task) {
        const raw = (task && task.raw_data) || {};
        if (Array.isArray(raw.material_refs) && raw.material_refs.length) return raw.material_refs;
        if (raw.material_ref && raw.material_ref.published_file) return [raw.material_ref];
        return [];
    }

    function refGroupKey(ref) {
        return [
            ref.materials_root_kind || 'class',
            ref.material_folder || '',
            ref.published_file || '',
            ref.range_spec || ''
        ].join('|');
    }

    /** 「字母」層：例如 Excel 活頁 A／B／C 發布出來的 A.meta.json → 字母 = A。 */
    function refFileStem(ref) {
        return ref.label || (ref.published_file || '').replace(/\.meta\.json$/i, '').replace(/\.json$/i, '') || '未命名';
    }

    /** 「頁」層：例如 pp.1~2；沒有範圍限定（整份都算一頁）時顯示「全篇」。 */
    function refRangeLabel(ref) {
        return ref.range_spec || '';
    }

    /**
     * 把一筆 task_completion 的 AI 評分（可能是多頁 ai_evaluations，也可能單一 ai_evaluation，
     * 再加上歷次重錄的 grading_history）對應回該 task 底下「是哪一個 material_ref」。
     * 多頁時用 unit_key/label 的字首（stem）比對；比對不到就退回：只有一個 ref 就都算它的，
     * 否則算「未指定教材」。
     *
     * grading_history 目前只存「合併後」的 ai_evaluation（沒有逐頁陣列），
     * 所以歷史重錄只在任務只對應「單一教材 ref」時才展開歸類，避免多教材合併的舊資料誤植到某一頁。
     */
    function attributeEvaluations(task, completion) {
        const refs = getMaterialRefs(task);
        const raw = (completion && completion.raw_data) || {};
        const perPage = Array.isArray(raw.ai_evaluations) && raw.ai_evaluations.length > 1
            ? raw.ai_evaluations
            : (raw.ai_evaluation ? [raw.ai_evaluation] : []);

        const T = window.UIStudentTimelineTemplates;
        const audioCtx = (T && typeof T.resolveAudioContextFromCompletion === 'function')
            ? T.resolveAudioContextFromCompletion(completion)
            : { retryAudioId: '', hasValidAudioFile: false };

        const out = [];
        perPage.forEach(function (ev) {
            if (!ev) return;
            const stem = ev.unit_key ? String(ev.unit_key).split(':')[0] : (ev.label ? String(ev.label).split(' ')[0] : '');
            let ref = refs.find(function (r) { return r.label && stem && r.label === stem; });
            if (!ref) ref = refs.length === 1 ? refs[0] : null;
            if (!ref) ref = { material_folder: '', published_file: '', range_spec: '', label: '未指定教材（多教材合併）' };
            out.push({
                ref: ref,
                evaluation: ev,
                ts: ev.graded_at || null,
                fileId: audioCtx.retryAudioId,
                hasValidAudioFile: audioCtx.hasValidAudioFile
            });
        });

        if (refs.length === 1 && Array.isArray(raw.grading_history)) {
            raw.grading_history.forEach(function (h) {
                if (!h || !h.ai_evaluation) return;
                const historyFileId = extractDriveFileId(h.audio_url);
                out.push({
                    ref: refs[0],
                    evaluation: h.ai_evaluation,
                    ts: h.timestamp || h.ai_evaluation.graded_at || null,
                    fileId: historyFileId || audioCtx.retryAudioId,
                    hasValidAudioFile: historyFileId ? true : audioCtx.hasValidAudioFile
                });
            });
        }

        return out;
    }

    function scoreColor(score) {
        const n = Number(score);
        if (!Number.isFinite(n)) return '#94A3B8';
        if (n < 60) return '#EF4444';
        if (n < 80) return '#F59E0B';
        return '#10B981';
    }

    function formatDate(ts) {
        if (!ts) return '未知時間';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return String(ts);
        const pad = function (n) { return String(n).padStart(2, '0'); };
        return (d.getMonth() + 1) + '/' + pad(d.getDate());
    }

    function buildGroups() {
        const assignments = (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAssignments === 'function')
            ? (window.FeatureStudentTimeline.getAssignments() || [])
            : [];
        const completions = Array.isArray(window._studentTaskCompletions) ? window._studentTaskCompletions : [];

        const audioTasks = [];
        assignments.forEach(function (a) {
            const tasks = (window.TaskScriptResolver && typeof window.TaskScriptResolver.parseTasks === 'function')
                ? window.TaskScriptResolver.parseTasks(a.tasks)
                : (Array.isArray(a.tasks) ? a.tasks : []);
            flattenAudioTasks(tasks, a, audioTasks);
        });

        const groups = {};
        function ensureGroup(ref) {
            const key = refGroupKey(ref);
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    folder: ref.material_folder || '未分類教材',
                    fileStem: refFileStem(ref),
                    rangeLabel: refRangeLabel(ref),
                    attempts: []
                };
            }
            return groups[key];
        }

        audioTasks.forEach(function (entry) {
            const task = entry.task;
            const assignment = entry.assignment;
            const refs = getMaterialRefs(task);
            if (!refs.length) return; // 沒有教材來源（例如純貼上文字）暫不分類，避免全部塞進「未指定」

            const completion = completions.find(function (c) {
                return String(c.assignment_id) === String(assignment.id) && String(c.task_id) === String(task.id);
            });

            // 就算尚未繳交／批改，也先把教材分組建立起來，讓學生知道「這個範圍還沒有記錄」。
            refs.forEach(function (ref) { ensureGroup(ref); });

            if (!completion) return;
            const compositeKey = assignment.id + '_' + task.id;
            const inlinePlayerId = 'analytics-audio-' + compositeKey;
            const attributed = attributeEvaluations(task, completion);
            attributed.forEach(function (pair) {
                const group = ensureGroup(pair.ref);
                const ev = pair.evaluation;
                if (!ev || (ev.pronunciation_score == null && ev.fluency_score == null)) return;
                group.attempts.push({
                    assignmentTitle: assignment.title || '未命名作業',
                    taskTitle: (task.title || '').replace(/<[^>]*>/g, '') || '',
                    ts: pair.ts,
                    pronunciation_score: ev.pronunciation_score,
                    fluency_score: ev.fluency_score,
                    completeness_score: ev.completeness_score,
                    errorCount: Array.isArray(ev.word_errors) ? ev.word_errors.length : 0,
                    evaluation: ev,
                    compositeKey: compositeKey,
                    inlinePlayerId: inlinePlayerId,
                    fileId: pair.fileId,
                    hasValidAudioFile: pair.hasValidAudioFile
                });
            });
        });

        const list = Object.keys(groups).map(function (k) { return groups[k]; });
        list.forEach(function (g) {
            g.attempts.sort(function (a, b) {
                const ta = a.ts ? new Date(a.ts).getTime() : 0;
                const tb = b.ts ? new Date(b.ts).getTime() : 0;
                return ta - tb;
            });
        });
        // 有記錄的排前面，且以「最新一次記錄時間」倒序，越近期活動的教材越先看到；
        // 這個順序也用來決定選台器裡「教材資料夾／字母」預設帶出哪一個（最近有動靜的那個）。
        list.sort(function (a, b) {
            const la = a.attempts.length ? a.attempts[a.attempts.length - 1] : null;
            const lb = b.attempts.length ? b.attempts[b.attempts.length - 1] : null;
            const ta = la && la.ts ? new Date(la.ts).getTime() : -1;
            const tb = lb && lb.ts ? new Date(lb.ts).getTime() : -1;
            if (tb !== ta) return tb - ta;
            return (a.folder + a.fileStem + a.rangeLabel).localeCompare(b.folder + b.fileStem + b.rangeLabel);
        });
        return list;
    }

    /** 「頁」在同一個字母底下的顯示順序：照頁碼數字排，方便照順序瀏覽（不是照最近活動排）。 */
    function pageSortKey(rangeLabel) {
        const m = String(rangeLabel || '').match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 999999;
    }

    /** 把扁平的 groups 組成「教材資料夾 → 字母 → 頁」三層樹，供左側選台器使用。 */
    function buildTree(groups) {
        const folderOrder = [];
        const folders = {};
        groups.forEach(function (g) {
            if (!folders[g.folder]) {
                folders[g.folder] = { key: g.folder, fileOrder: [], files: {} };
                folderOrder.push(g.folder);
            }
            const folderNode = folders[g.folder];
            if (!folderNode.files[g.fileStem]) {
                folderNode.files[g.fileStem] = { key: g.fileStem, pages: [] };
                folderNode.fileOrder.push(g.fileStem);
            }
            folderNode.files[g.fileStem].pages.push(g);
        });
        folderOrder.forEach(function (fKey) {
            const folderNode = folders[fKey];
            folderNode.fileOrder.forEach(function (fileKey) {
                folderNode.files[fileKey].pages.sort(function (a, b) {
                    return pageSortKey(a.rangeLabel) - pageSortKey(b.rangeLabel);
                });
            });
        });
        return folderOrder.map(function (fKey) {
            const folderNode = folders[fKey];
            return {
                key: fKey,
                files: folderNode.fileOrder.map(function (fileKey) { return folderNode.files[fileKey]; })
            };
        });
    }

    function countAttemptsInFolder(folderNode) {
        return folderNode.files.reduce(function (sum, file) {
            return sum + file.pages.reduce(function (s, p) { return s + p.attempts.length; }, 0);
        }, 0);
    }
    function countAttemptsInFile(fileNode) {
        return fileNode.pages.reduce(function (s, p) { return s + p.attempts.length; }, 0);
    }

    function chipButtonHtml(opts) {
        const active = !!opts.active;
        const countHtml = opts.count > 0
            ? '<span style="font-size:0.68rem;font-weight:900;flex-shrink:0;">' + opts.count + '</span>'
            : '<span style="font-size:0.68rem;color:#CBD5E1;flex-shrink:0;">—</span>';
        return '<button type="button" onclick="' + opts.onclick + '" style="display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;font-size:0.82rem;padding:6px 10px;border-radius:8px;border:1px solid ' + (active ? '#6366F1' : '#E2E8F0') + ';background:' + (active ? '#EEF2FF' : 'white') + ';color:' + (active ? '#4338CA' : '#334155') + ';font-weight:' + (active ? '900' : '700') + ';cursor:pointer;width:100%;">'
            + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeAttr(opts.label) + '</span>'
            + countHtml
            + '</button>';
    }

    function sidebarSectionHtml(icon, title, chipsHtml) {
        if (!chipsHtml) return '';
        return '<div>'
            + '<div style="font-size:0.72rem;font-weight:900;color:#94A3B8;letter-spacing:0.05em;margin-bottom:6px;">' + icon + ' ' + escapeAttr(title) + '</div>'
            + '<div style="display:flex;flex-direction:column;gap:4px;">' + chipsHtml + '</div>'
            + '</div>';
    }

    /** 選台器（左側／頂端）：教材資料夾 → 字母 → 頁，三層依序往下篩。 */
    function renderSidebarHtml(tree) {
        const folderNode = tree.find(function (f) { return f.key === state.folderKey; }) || tree[0];
        const fileNode = folderNode
            ? (folderNode.files.find(function (f) { return f.key === state.fileKey; }) || folderNode.files[0])
            : null;

        const folderChips = tree.map(function (f) {
            const isActive = !!(folderNode && f.key === folderNode.key);
            return chipButtonHtml({
                label: f.key || '未分類教材',
                count: countAttemptsInFolder(f),
                active: isActive,
                onclick: "window.FeatureStudentAnalytics.selectFolder('" + escapeJsArg(f.key) + "')"
            });
        }).join('');

        const fileChips = folderNode ? folderNode.files.map(function (file) {
            const isActive = !!(fileNode && file.key === fileNode.key);
            return chipButtonHtml({
                label: file.key || '未命名',
                count: countAttemptsInFile(file),
                active: isActive,
                onclick: "window.FeatureStudentAnalytics.selectFile('" + escapeJsArg(folderNode.key) + "', '" + escapeJsArg(file.key) + "')"
            });
        }).join('') : '';

        const pageChips = fileNode ? fileNode.pages.map(function (g) {
            const isActive = g.key === state.groupKey;
            return chipButtonHtml({
                label: g.rangeLabel || '全篇',
                count: g.attempts.length,
                active: isActive,
                onclick: "window.FeatureStudentAnalytics.selectPage('" + escapeJsArg(g.key) + "')"
            });
        }).join('') : '';

        return '<div style="flex:0 0 220px;min-width:190px;display:flex;flex-direction:column;gap:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px;">'
            + sidebarSectionHtml('📂', '教材', folderChips)
            + sidebarSectionHtml('🔤', '字母', fileChips)
            + sidebarSectionHtml('📄', '頁', pageChips)
            + '</div>';
    }

    function renderTrendDotsHtml(attempts) {
        if (!attempts.length) return '';
        return attempts.map(function (a, i) {
            const score = a.pronunciation_score;
            const color = scoreColor(score);
            const isLast = i === attempts.length - 1;
            const size = isLast ? 14 : 10;
            const tip = formatDate(a.ts) + '｜' + a.assignmentTitle + '\n發音 ' + (score == null ? 'N/A' : score)
                + '｜流暢 ' + (a.fluency_score == null ? 'N/A' : a.fluency_score)
                + (a.errorCount ? ('｜错音 ' + a.errorCount) : '');
            const dot = '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;" title="' + escapeAttr(tip) + '">'
                + '<span style="display:inline-block;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';border:2px solid white;box-shadow:0 0 0 1px ' + color + ';"></span>'
                + '<span style="font-size:0.68rem;color:#94A3B8;white-space:nowrap;">' + formatDate(a.ts) + '</span>'
                + '<span style="font-size:0.78rem;font-weight:900;color:' + color + ';">' + (score == null ? '—' : score) + '</span>'
                + '</div>';
            const line = isLast ? '' : '<div style="flex:1;height:2px;background:linear-gradient(90deg,#E2E8F0,#E2E8F0);min-width:16px;margin-bottom:20px;"></div>';
            return dot + line;
        }).join('');
    }

    /** 單一批改次數的完整內容：分數徽章＋文稿標錯字＋综合評語＋错音表，供日期頻道使用。 */
    function renderAttemptDetailHtml(attempt) {
        const T = window.UIStudentTimelineTemplates;
        const ev = attempt.evaluation;
        if (!ev) return '<div style="font-size:0.82rem;color:#94A3B8;">無資料</div>';

        const scores = (T && typeof T.getScoresFromAi === 'function')
            ? T.getScoresFromAi(ev)
            : {
                pScore: ev.pronunciation_score != null ? ev.pronunciation_score : 'N/A',
                fluency: ev.fluency_score != null ? ev.fluency_score : 'N/A',
                pScoreColor: scoreColor(ev.pronunciation_score)
            };
        const feedback = ev.comprehensive_feedback ? ev.comprehensive_feedback : (ev.feedback ? ev.feedback : '無綜合評語');

        const highlightHtml = (T && typeof T.renderScriptWithErrorHighlightsHtml === 'function')
            ? T.renderScriptWithErrorHighlightsHtml(ev.effective_script, ev.word_errors, ev, attempt.inlinePlayerId, attempt.fileId, attempt.hasValidAudioFile)
            : '';
        const errorsHtml = (T && typeof T.renderWordErrorsHtml === 'function')
            ? T.renderWordErrorsHtml(ev, attempt.inlinePlayerId, attempt.fileId, attempt.hasValidAudioFile)
            : '';

        return '<div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">'
            + '<span style="font-size:0.78rem;color:#64748B;font-weight:800;">' + escapeAttr(attempt.assignmentTitle) + '</span>'
            + '<span style="background:white;padding:2px 8px;border-radius:4px;font-size:0.82rem;font-weight:900;color:' + scores.pScoreColor + ';border:1px solid #E2E8F0;">發音 ' + scores.pScore + '</span>'
            + '<span style="background:white;padding:2px 8px;border-radius:4px;font-size:0.82rem;font-weight:900;color:#3B82F6;border:1px solid #E2E8F0;">流暢 ' + scores.fluency + '</span>'
            + '</div>'
            + (highlightHtml ? '<div style="margin-bottom:8px;">' + highlightHtml + '</div>' : '')
            + '<div class="rt-normalize" style="font-size:0.85rem;color:#475569;line-height:1.6;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:8px 10px;margin-bottom:8px;">' + String(feedback).replace(/\n/g, '<br>') + '</div>'
            + errorsHtml
            + '</div>';
    }

    /**
     * 日期頻道切換器：背景文稿內容一樣，切換日期只換文稿上標示的錯字／分數／評語。
     * 每個日期的內容都預先渲染成隱藏區塊，點日期只切換 display，不需要動態重組 HTML
     * （沿用專案裡 toggleAIHistoryRow 已用過的隱藏/顯示模式）。
     */
    function renderScriptDateSwitcherHtml(group) {
        const attempts = group.attempts;
        if (!attempts.length) return '';
        const slug = sanitizeId(group.key);
        const total = attempts.length;
        const latestIdx = total - 1;

        const buttonsHtml = attempts.map(function (a, i) {
            const isActive = i === latestIdx;
            return '<button type="button" id="analytics-date-btn-' + slug + '-' + i + '" '
                + 'onclick="window.FeatureStudentAnalytics.selectAttempt(\'' + slug + '\', ' + i + ', ' + total + ')" '
                + 'style="font-size:0.78rem;padding:4px 12px;border-radius:999px;border:1px solid ' + (isActive ? '#6366F1' : '#C7D2FE') + ';'
                + 'background:' + (isActive ? '#6366F1' : 'white') + ';color:' + (isActive ? 'white' : '#4338CA') + ';font-weight:800;cursor:pointer;white-space:nowrap;flex-shrink:0;">'
                + escapeAttr(formatDate(a.ts)) + '</button>';
        }).join('');

        const detailsHtml = attempts.map(function (a, i) {
            return '<div id="analytics-detail-' + slug + '-' + i + '" style="display:' + (i === latestIdx ? 'block' : 'none') + ';">'
                + renderAttemptDetailHtml(a)
                + '</div>';
        }).join('');

        return '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #E2E8F0;">'
            + '<div style="font-weight:900;color:#6366F1;font-size:0.85rem;margin-bottom:6px;">📻 選擇批改日期（頻道），查看該次錯音字／評語</div>'
            + '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px;">' + buttonsHtml + '</div>'
            + detailsHtml
            + '</div>';
    }

    /** 螢幕（右側／主畫面）：目前選到的那一頁 — 分數趨勢在最上方，下面是日期頻道。 */
    function renderScreenHtml(group) {
        if (!group) {
            return '<div style="flex:1 1 360px;min-width:280px;text-align:center;padding:40px;color:#94A3B8;font-weight:800;">📺 請從左側選擇教材／頁面</div>';
        }
        const count = group.attempts.length;
        const breadcrumbHtml = '<div style="font-size:0.78rem;color:#94A3B8;margin-bottom:6px;">'
            + escapeAttr(group.folder) + ' <span style="margin:0 4px;color:#CBD5E1;">›</span> '
            + escapeAttr(group.fileStem) + ' <span style="margin:0 4px;color:#CBD5E1;">›</span> '
            + '<span style="color:#4338CA;font-weight:900;">' + escapeAttr(group.rangeLabel || '全篇') + '</span>'
            + '</div>';

        let bodyHtml;
        let insightHtml = '';
        let switcherHtml = '';
        if (!count) {
            bodyHtml = '<div style="font-size:0.85rem;color:#94A3B8;padding:20px 0;">尚無批改紀錄，完成錄音並經 AI／老師批改後會顯示在這裡。</div>';
        } else {
            bodyHtml = '<div style="display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:8px 4px 4px;">' + renderTrendDotsHtml(group.attempts) + '</div>';
            if (count > 1) {
                const first = group.attempts[0].pronunciation_score;
                const last = group.attempts[count - 1].pronunciation_score;
                if (first != null && last != null) {
                    const d = Number(last) - Number(first);
                    if (d > 0) insightHtml = '💡 發音從 ' + first + ' 進步到 ' + last + '（<span style="color:#059669;">+' + d + '</span>），持續保持！';
                    else if (d < 0) insightHtml = '💡 發音從 ' + first + ' 降到 ' + last + '（<span style="color:#DC2626;">' + d + '</span>），可以再多練這一頁。';
                    else insightHtml = '💡 共 ' + count + ' 次記錄，發音維持在 ' + last + ' 分，穩定中。';
                }
            }
            switcherHtml = renderScriptDateSwitcherHtml(group);
        }

        return '<div style="flex:1 1 360px;min-width:280px;background:white;border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;">'
            + breadcrumbHtml
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:2px;">'
            + '<span style="font-weight:900;color:#334155;font-size:1rem;">📺 ' + escapeAttr(group.rangeLabel || group.fileStem) + '</span>'
            + '<span style="font-size:0.75rem;color:#64748B;">共 ' + count + ' 次記錄</span>'
            + '</div>'
            + bodyHtml
            + (insightHtml ? '<div style="font-size:0.8rem;color:#4338CA;font-weight:700;margin-top:2px;padding-top:6px;border-top:1px dashed #EDE9FE;">' + insightHtml + '</div>' : '')
            + switcherHtml
            + '</div>';
    }

    function render() {
        const container = document.getElementById('analytics-container');
        if (!container) return;

        const assignmentsReady = window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAssignments === 'function';
        if (!assignmentsReady) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;font-weight:800;">⏳ 資料尚未載入完成，請稍後或切換到「課程進度」頁籤再回來。</div>';
            return;
        }

        const groups = buildGroups();
        if (!groups.length) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;font-weight:800;">📭 目前沒有可分析的錄音教材（老師出的作業需先套用 Material Snapshot，才能依教材分類）。</div>';
            return;
        }

        // 選台狀態失效（第一次進來，或選到的頁已經不存在）時，預設帶到「最近有活動」的那一頁。
        if (!state.groupKey || !groups.some(function (g) { return g.key === state.groupKey; })) {
            state.groupKey = groups[0].key;
            state.folderKey = groups[0].folder;
            state.fileKey = groups[0].fileStem;
        }

        const tree = buildTree(groups);
        const selectedGroup = groups.find(function (g) { return g.key === state.groupKey; });

        let html = '<div style="max-width:920px;margin:0 auto;padding:4px 4px 24px;">';
        html += '<div style="font-size:0.85rem;color:#64748B;margin-bottom:14px;line-height:1.6;">📺 像轉電視頻道一樣：左邊先選教材資料夾、字母、頁，右邊「螢幕」顯示這一頁的分數趨勢；下面可以再切換批改日期，同一段文稿隨你選的日期換標示的錯字。</div>';
        html += '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">'
            + renderSidebarHtml(tree)
            + renderScreenHtml(selectedGroup)
            + '</div>';
        html += '</div>';

        container.innerHTML = html;
    }

    function selectFolder(folderKey) {
        const groups = buildGroups();
        state.folderKey = folderKey;
        const firstMatch = groups.find(function (g) { return g.folder === folderKey; });
        if (firstMatch) {
            state.fileKey = firstMatch.fileStem;
            state.groupKey = firstMatch.key;
        }
        render();
    }

    function selectFile(folderKey, fileKey) {
        const groups = buildGroups();
        state.folderKey = folderKey;
        state.fileKey = fileKey;
        const firstMatch = groups.find(function (g) { return g.folder === folderKey && g.fileStem === fileKey; });
        if (firstMatch) state.groupKey = firstMatch.key;
        render();
    }

    function selectPage(groupKey) {
        const groups = buildGroups();
        const g = groups.find(function (gr) { return gr.key === groupKey; });
        if (g) {
            state.folderKey = g.folder;
            state.fileKey = g.fileStem;
        }
        state.groupKey = groupKey;
        render();
    }

    /** 日期頻道按鈕的點擊處理：切換對應區塊的顯示／隱藏與按鈕樣式。 */
    function selectAttempt(slug, idx, total) {
        for (let i = 0; i < total; i++) {
            const detail = document.getElementById('analytics-detail-' + slug + '-' + i);
            const btn = document.getElementById('analytics-date-btn-' + slug + '-' + i);
            if (detail) detail.style.display = (i === idx) ? 'block' : 'none';
            if (btn) {
                const isActive = i === idx;
                btn.style.background = isActive ? '#6366F1' : 'white';
                btn.style.color = isActive ? 'white' : '#4338CA';
                btn.style.borderColor = isActive ? '#6366F1' : '#C7D2FE';
            }
        }
    }

    return { render, selectFolder, selectFile, selectPage, selectAttempt };
})();

/**
 * 📂 120_student_core/feature-student-pdf-quiz.js
 * 🆕 PDF 考卷（task.type === 'pdf_exam'）學生端：跟現有 feature-student-quiz.js（meta 出題的線上考試）
 * 完全獨立，這裡不做全螢幕防作弊／離開次數統計／重考錯題／申訴等進階機制（MVP 範圍）。
 *
 * 💣 空格在 PDF 上的位置不是老師畫的、也不是程式用電腦視覺猜的（實測對掃描稿常常誤判，見討論
 * 記錄）——改成**由學生作答時自己依「答案清單的順序」逐一點出作答位置**：
 * - 「文字匡建立的順序」＝跟答案清單（老師貼的解答文字，已依大題內題號由小到大排好——見
 *   020_js_core/pdf-exam-paper.js 的 parseAnswerText 排序說明）逐一配對的依據，不是座標。
 *   陣列 push 的順序本身就等於時間先後，不用額外記時間戳記。
 * - 即使有題不會寫，也可以直接送出（不強制作答框數量要跟程式判斷的格數一致，見 submitSection）。
 *
 * 🆕 2026-08-16 改版：畫面從「一大題一個獨立畫面（只顯示該大題頁碼範圍）」改成「整份 PDF 連續
 * 捲動、每一頁只畫一次」——因為同一張紙常常印了兩個不同大題（例如 Quiz5 結尾＋Quiz6 開頭疊在
 * 同一頁），舊設計會讓那一頁在兩個大題各自的畫面裡各出現一次。新設計：
 * - 畫面上方是一排大題按鈕（`_renderSectionTabsHtml`），每顆按鈕兩行：上面大題名、下面頁碼
 *   （例如「QUIZ 11」／「p.57~58」）。按下＝呼叫 `_jumpToSection`，把 `st.currentIdx` 設成那個
 *   大題，並用 `scrollIntoView({block:'start'})` 把該大題的錨點頁碼精準捲到畫面最上方（不是讓
 *   學生自己上下滑找）。
 * - 點 PDF 圖片建立作答框，永遠記到「目前選中的大題」（`st.currentIdx`），跟捲到第幾頁無關——
 *   所以即使畫面同時看得到兩個大題的內容，點哪個空格永遠算「目前選中的那個大題」。
 * - 每頁只會渲染一次（lazy render，捲到視窗附近才用 pdf.js 畫圖＋快取），頁面上疊的作答框來自
 *   **所有**大題（不只是目前選中的），每個框自己的鎖定狀態依它自己所屬大題的批改狀態決定——
 *   靠框上的 `data-section-idx` 反查，不能假設「畫面上看到的框都是目前選中的大題」。
 * - `detectSectionPageRanges` 算出的頁碼範圍，現在只當作「按鈕捲動的錨點」，不再是「畫面顯示
 *   範圍」的硬邊界——就算它判斷有些微誤差，最差情況只是錨點捲過去差一兩頁，不會再造成內容
 *   顯示錯誤或重複（見 .cursor/rules/pdf-quiz-section-page-detection-invariant.mdc）。
 *
 * 💣 批改時機＝**每大題各自提交**，不是等整份考卷都寫完才一次送出：這一大題的作答框都點滿了，
 * 按「提交這一大題並批改」就立刻批改、鎖定這一大題（不能再改），並馬上顯示這一大題的對錯格數／
 * 百分比（不顯示正確答案）。要換下一大題前必須先提交目前這大題。最後一大題提交完，才彈出整份
 * 考卷的總結。
 * - 每提交一大題都會即時存檔（含 pdf_quiz_boxes_by_section／pdf_quiz_section_results／畫筆筆記），
 *   老師端可以看到部分完成度，不用等整份交完才有資料。
 * - 「暫存並離開」／點外面關閉：把目前作答框＋畫筆筆記一併寫進 task_completions（status 仍是未完成）。
 *   下次打開若上次還沒整份交完，會接續已批改的大題、未提交的作答框、以及各頁筆記。
 * - 若上次已經整份交完，重新打開＝重新開始全新一份作答（不覆蓋舊成績，直到這次有大題真正提交）。
 */
window.FeatureStudentPdfQuiz = (function () {
    'use strict';

    var MODAL_ID = 'student-pdf-quiz';
    var RESULT_MODAL_ID = 'student-pdf-quiz-result';
    var CLICK_MERGE_THRESHOLD_PCT = 2.2; // 點擊離既有作答框多近，視為「點到同一個框」去聚焦而不是新增
    var DEFAULT_FONT_PX = 14;
    var MIN_FONT_PX = 10;
    var MAX_FONT_PX = 28;
    var MIN_INPUT_WIDTH_PX = 44;
    var INPUT_WIDTH_PADDING_PX = 14; // 量出來的文字寬度再加一點緩衝，避免游標貼邊

    var _quizState = null;
    var _drag = null; // 拖曳中的作答框狀態：{ boxId, sectionIdx, pageBlockEl, boxEl }
    var _pageObserver = null; // IntersectionObserver：捲到視窗附近才渲染該頁 PDF 圖片（lazy render）
    var _ink = null; // 正在畫的一筆：{ pageNum, canvas, points }
    var _measureCanvas = document.createElement('canvas');
    var _measureCtx = _measureCanvas.getContext('2d');
    var PEN_COLORS = ['#0F172A', '#DC2626', '#2563EB', '#16A34A'];
    var TOOL_PEN_WIDTH = 2.4;
    var TOOL_HIGHLIGHT_WIDTH = 14;
    var TOOL_ERASER_WIDTH = 18;

    function _fontFamilyForMeasure() {
        return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    }

    function _measureTextWidthPx(text, fontPx) {
        _measureCtx.font = fontPx + 'px ' + _fontFamilyForMeasure();
        return _measureCtx.measureText(String(text || '')).width;
    }

    /** 文字匡寬度隨輸入內容自動變長（不夠寬會被游標擋住，太寬又佔畫面，量文字寬度剛好） */
    function _autoSizeInput(inputEl) {
        if (!inputEl) return;
        var fontPx = (_quizState && _quizState.fontSizePx) || DEFAULT_FONT_PX;
        var w = _measureTextWidthPx(inputEl.value || '', fontPx) + INPUT_WIDTH_PADDING_PX;
        inputEl.style.width = Math.max(MIN_INPUT_WIDTH_PX, w) + 'px';
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
    }

    function isAssignmentId(value) {
        var s = String(value == null ? '' : value).trim();
        if (!s) return false;
        if (isUuid(s)) return true;
        return /^\d+$/.test(s);
    }

    function walkFindTask(tasks, taskId) {
        var found = null;
        (tasks || []).forEach(function (t) {
            if (found || !t) return;
            if (String(t.id) === String(taskId)) found = t;
            else if (t.subTasks) found = walkFindTask(t.subTasks, taskId);
        });
        return found;
    }

    function findTaskInAssignments(assignmentId, taskId) {
        var list = (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAssignments === 'function')
            ? window.FeatureStudentTimeline.getAssignments()
            : [];
        var assign = (list || []).find(function (a) { return String(a.id) === String(assignmentId); });
        if (!assign) return null;
        var tasks = assign.tasks;
        if (typeof tasks === 'string') {
            try { tasks = JSON.parse(tasks); } catch (_e) { tasks = []; }
        }
        if (window.TaskScriptResolver && typeof window.TaskScriptResolver.parseTasks === 'function') {
            tasks = window.TaskScriptResolver.parseTasks(assign.tasks);
        }
        return walkFindTask(tasks || [], taskId);
    }

    function findCompletion(assignmentId, taskId) {
        var comps = window._studentTaskCompletions || [];
        return comps.find(function (c) {
            return String(c.task_id) === String(taskId) && String(c.assignment_id) === String(assignmentId);
        }) || null;
    }

    function patchLocalCompletion(assignmentId, taskId, rawPayload, completed) {
        if (!window._studentTaskCompletions) window._studentTaskCompletions = [];
        var row = findCompletion(assignmentId, taskId);
        if (!row) {
            row = { assignment_id: assignmentId, task_id: String(taskId), status: completed ? 'completed' : 'incomplete', raw_data: {} };
            window._studentTaskCompletions.push(row);
        }
        row.raw_data = Object.assign({}, row.raw_data || {}, rawPayload);
        if (completed) row.status = 'completed';
    }

    async function getAuthContext() {
        if (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getAuthContext === 'function') {
            return window.FeatureStudentTimeline.getAuthContext();
        }
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        var res = await window.supabaseClient.auth.getUser();
        if (res.error || !res.data || !res.data.user) throw new Error('尚未登入');
        var classId = sessionStorage.getItem('currentClassId') || '';
        if (!classId) throw new Error('找不到班級');
        if (!isUuid(classId)) throw new Error('班級 ID 異常（' + classId + '）。請重新選擇班級後再繳交。');
        return { userId: res.data.user.id, classId: classId };
    }

    async function persistResult(assignmentId, taskId, rawPayload, completed) {
        if (!window.supabaseClient) throw new Error('Supabase 未載入');
        if (!isAssignmentId(assignmentId)) throw new Error('作業 ID 格式錯誤（' + assignmentId + '）。請強制重新整理後再試。');
        var auth = await getAuthContext();
        var assignmentKey = (/^\d+$/.test(String(assignmentId).trim())) ? Number(assignmentId) : assignmentId;
        var rpcRes = await window.supabaseClient.rpc('student_set_task_completion', {
            p_assignment_id: assignmentKey,
            p_task_id: String(taskId),
            p_class_id: auth.classId,
            p_completed: !!completed,
            p_raw_data: rawPayload
        });
        if (rpcRes.error) {
            var rpcMsg = String(rpcRes.error.message || rpcRes.error.details || '');
            var rpcMissing = /Could not find the function|does not exist|PGRST202|404/i.test(rpcMsg);
            if (!rpcMissing) throw rpcRes.error;
            var payload = {
                assignment_id: assignmentId,
                task_id: String(taskId),
                student_id: auth.userId,
                class_id: auth.classId,
                status: completed ? 'completed' : 'submitted',
                deleted_at: null,
                raw_data: rawPayload
            };
            var updRes = await window.supabaseClient.from('task_completions').update(payload)
                .eq('task_id', String(taskId)).eq('student_id', auth.userId).eq('class_id', auth.classId).select();
            if (updRes.error) throw updRes.error;
            if (!updRes.data || !updRes.data.length) {
                var insRes = await window.supabaseClient.from('task_completions').insert([payload]);
                if (insRes.error) throw insRes.error;
            }
        }
        patchLocalCompletion(assignmentId, taskId, rawPayload, completed);
    }

    function _hasAnyDrawings(map) {
        if (!map || typeof map !== 'object') return false;
        return Object.keys(map).some(function (k) {
            return Array.isArray(map[k]) && map[k].length > 0;
        });
    }

    function _canPersistDraft() {
        var st = _quizState;
        if (!st) return false;
        if (st.loading) return false;
        if (st.allowDraftPersist) return true;
        return (st.sectionResults || []).some(function (r) { return !!r; });
    }

    function _buildRawPayload() {
        var st = _quizState;
        var aggregate = _aggregateResults();
        return {
            pdf_quiz_answers: _buildAnswersFromBoxes(),
            pdf_quiz_boxes_by_section: st.boxesBySection,
            pdf_quiz_section_results: st.sectionResults,
            pdf_quiz_result: aggregate,
            pdf_quiz_drawings_by_page: st.drawingsByPage || {}
        };
    }

    async function saveDraft() {
        var st = _quizState;
        if (!st) return false;
        if (!_canPersistDraft()) return false;
        await persistResult(st.assignmentId, st.taskId, _buildRawPayload(), false);
        return true;
    }

    // ------------------------------------------------------------------
    // 畫面渲染：一大題＝該 section 橫跨的每一頁 PDF 疊在一起，各自有可點擊的 overlay
    // ------------------------------------------------------------------

    async function _renderPageImage(pdfDoc, pageNum) {
        var page = await pdfDoc.getPage(pageNum);
        var viewport = page.getViewport({ scale: 1.4 });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        return canvas.toDataURL('image/png');
    }

    function _boxHtml(sectionIdx, box, orderIdx, locked, isWrong) {
        var fontPx = (_quizState && _quizState.fontSizePx) || DEFAULT_FONT_PX;
        var initialW = Math.max(MIN_INPUT_WIDTH_PX, _measureTextWidthPx(box.text || '', fontPx) + INPUT_WIDTH_PADDING_PX);
        // 批改鎖定後：錯的格子背景改紅色，讓學生一看就知道錯在哪格（不顯示正確答案，只標位置）
        var accent = locked ? (isWrong ? '#DC2626' : '#94A3B8') : '#0EA5E9';
        var inputBg = locked ? (isWrong ? '#FEE2E2' : '#F1F5F9') : 'rgba(255,255,255,0.95)';
        var removeBtnHtml = locked ? '' : (
            '<button type="button" class="pdf-quiz-box-remove" data-box-id="' + esc(box.id) + '" title="刪除這個作答框" ' +
                'style="border:none; background:#FEE2E2; color:#B91C1C; width:16px; height:16px; border-radius:50%; font-size:0.65rem; line-height:1; cursor:pointer; flex-shrink:0;">×</button>'
        );
        return (
            '<div class="pdf-quiz-box" data-box-id="' + esc(box.id) + '" data-section-idx="' + sectionIdx + '" ' +
                'style="position:absolute; left:' + box.xPct + '%; top:' + box.yPct + '%; transform:translate(-6px,-50%); display:flex; align-items:center; gap:2px;">' +
                '<span class="pdf-quiz-box-handle" data-box-id="' + esc(box.id) + '" title="' + (locked ? (isWrong ? '這格答錯了（已批改鎖定）' : '這格答對了（已批改鎖定）') : '按住拖曳可移動位置') + '" ' +
                    'style="font-size:0.65rem; font-weight:900; color:' + accent + '; background:white; border:1px solid ' + accent + '; border-radius:50%; width:16px; height:16px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; cursor:' + (locked ? 'default' : 'grab') + '; touch-action:none; user-select:none;">' + (orderIdx + 1) + '</span>' +
                '<input type="text" class="pdf-quiz-answer-input" data-box-id="' + esc(box.id) + '" value="' + esc(box.text || '') + '" ' + (locked ? 'disabled' : '') + ' ' +
                    'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-gramm="false" ' +
                    'style="width:' + initialW + 'px; border:2px solid ' + accent + '; background:' + inputBg + '; font-size:' + fontPx + 'px; padding:2px 4px; box-sizing:border-box; border-radius:3px; font-family:' + _fontFamilyForMeasure() + ';">' +
                removeBtnHtml +
            '</div>'
        );
    }

    function _isSectionSubmitted(idx) {
        var st = _quizState;
        return !!(st && st.sectionResults && st.sectionResults[idx]);
    }

    function _isSectionComplete(idx) {
        var st = _quizState;
        var sec = st.sections[idx];
        var boxes = st.boxesBySection[idx] || [];
        return boxes.length === sec.items.length;
    }

    function _allSectionsSubmitted() {
        var st = _quizState;
        return st.sectionResults.every(function (r) { return !!r; });
    }

    /** 依目前每大題已批改的結果，算出「目前為止」的總分／各大題明細，供存檔與結果彈窗共用 */
    function _aggregateResults() {
        var st = _quizState;
        var correct = 0, total = 0, submittedCount = 0;
        var wrongItems = [];
        var sectionStats = st.sections.map(function (sec, idx) {
            var r = st.sectionResults[idx];
            if (!r) return { section: sec.section, total: sec.items.length, correct: null, wrong_count: null, score: null, submitted: false };
            submittedCount++;
            correct += r.correct;
            total += r.total;
            wrongItems = wrongItems.concat(r.wrong_items || []);
            return { section: r.section, total: r.total, correct: r.correct, wrong_count: (r.total - r.correct), score: r.score, submitted: true };
        });
        return {
            correct: correct,
            total: total,
            score: total ? Math.round((correct / total) * 1000) / 10 : 0,
            wrong_items: wrongItems,
            section_stats: sectionStats,
            submitted_sections: submittedCount,
            total_sections: st.sections.length,
            all_submitted: submittedCount === st.sections.length,
            graded_at: new Date().toISOString()
        };
    }

    function _updateActionButton() {
        var st = _quizState;
        var btn = document.getElementById('pdf-quiz-main-action-btn');
        if (!st || !btn) return;
        var idx = st.currentIdx;
        if (_isSectionSubmitted(idx)) {
            if (_allSectionsSubmitted()) {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.background = '#0F766E';
                btn.style.color = 'white';
                btn.style.cursor = 'pointer';
                btn.textContent = '🏁 查看總成績';
                btn.onclick = function () { _showResultModal(_aggregateResults()); };
            } else {
                var r = st.sectionResults[idx];
                btn.disabled = true;
                // 💣 之前這裡用 opacity:0.65 讓按鈕看起來「變灰」，但底色是深色（#0F766E）配白字，
                // opacity 是整顆按鈕（背景＋文字）一起往頁面背景淡化，深色淡化後文字也一起被淡化，
                // 結果變成「淡色配淡色」，字幾乎看不清楚。改成直接換一組本來就低對比的「已完成」配色
                // （淺灰底＋深灰字），全不透明，不管頁面背景是什麼都看得清楚。
                btn.style.opacity = '1';
                btn.style.background = '#E2E8F0';
                btn.style.color = '#334155';
                btn.style.cursor = 'not-allowed';
                btn.textContent = '✅ 已批改 ' + r.correct + ' / ' + r.total;
                btn.onclick = null;
            }
        } else {
            // 💣 不強制學生點出的作答框數量一定要等於程式判斷的格數（程式判斷可能算錯）——
            // 隨時都能提交這一大題，送出後就依學生當時實際點的作答框批改。
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = '#0F766E';
            btn.style.color = 'white';
            btn.style.cursor = 'pointer';
            btn.textContent = '提交這一大題並批改';
            btn.onclick = submitSection;
        }
    }

    function _renderSectionCounter() {
        var st = _quizState;
        var idx = st.currentIdx;
        var sec = st.sections[idx];
        var boxes = st.boxesBySection[idx] || [];
        var need = sec.items.length;
        var got = boxes.length;
        var el = document.getElementById('pdf-quiz-counter');
        if (el) {
            if (_isSectionSubmitted(idx)) {
                el.innerHTML = '';
            } else {
                // 💣 這只是提示，不是強制門檻——程式判斷的格數可能算錯，數量不符仍然可以直接提交，
                // 送出後會依你實際點出的作答框批改。
                var ok = got === need;
                el.innerHTML = '目前這大題：<b style="color:' + (ok ? '#047857' : '#B45309') + ';">已建立 ' + got + ' / ' + need + ' 個作答框</b>'
                    + (ok ? ' ✅' : '（提示：請照題目順序把每一題都點出來，不會寫也留空；數量不符也可以直接提交）');
            }
        }
        _updateActionButton();
    }

    function _pagePlaceholderHtml(pageNum) {
        return '<div class="pdf-quiz-page-block" data-page="' + pageNum + '" data-rendered="0" ' +
                'style="min-height:360px; background:#F1F5F9; border-radius:6px; margin:0 auto 14px; max-width:100%; display:flex; align-items:center; justify-content:center; color:#94A3B8; font-size:0.8rem;">' +
            '第 ' + pageNum + ' 頁　⏳ 捲到附近時載入…' +
        '</div>';
    }

    function _toolStrokeStyle(tool, color) {
        if (tool === 'highlighter') return { color: color || '#EAB308', width: TOOL_HIGHLIGHT_WIDTH, alpha: 0.38, eraser: false };
        if (tool === 'eraser') return { color: 'rgba(0,0,0,1)', width: TOOL_ERASER_WIDTH, alpha: 1, eraser: true };
        return { color: color || '#0F172A', width: TOOL_PEN_WIDTH, alpha: 1, eraser: false };
    }

    function _pageStrokes(pageNum) {
        var st = _quizState;
        if (!st) return [];
        if (!st.drawingsByPage) st.drawingsByPage = {};
        var key = String(pageNum);
        if (!Array.isArray(st.drawingsByPage[key])) st.drawingsByPage[key] = [];
        return st.drawingsByPage[key];
    }

    function _syncDrawCanvas(block) {
        if (!block) return;
        var img = block.querySelector('img');
        var canvas = block.querySelector('canvas.pdf-quiz-draw-layer');
        if (!img || !canvas) return;
        var cssW = img.clientWidth || img.naturalWidth || 0;
        var cssH = img.clientHeight || img.naturalHeight || 0;
        if (cssW < 8 || cssH < 8) return;
        var dpr = window.devicePixelRatio || 1;
        var pxW = Math.max(1, Math.round(cssW * dpr));
        var pxH = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pxW || canvas.height !== pxH) {
            canvas.width = pxW;
            canvas.height = pxH;
        }
        _redrawPageDrawings(Number(block.getAttribute('data-page')));
    }

    function _redrawPageDrawings(pageNum) {
        var block = document.querySelector('.pdf-quiz-page-block[data-page="' + pageNum + '"]');
        if (!block) return;
        var canvas = block.querySelector('canvas.pdf-quiz-draw-layer');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var cssW = canvas.clientWidth || 1;
        var cssH = canvas.clientHeight || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        (_pageStrokes(pageNum) || []).forEach(function (stroke) {
            if (!stroke || !stroke.points || stroke.points.length < 1) return;
            var style = _toolStrokeStyle(stroke.tool, stroke.color);
            ctx.save();
            ctx.globalCompositeOperation = style.eraser ? 'destination-out' : 'source-over';
            ctx.globalAlpha = style.alpha;
            ctx.strokeStyle = style.color;
            ctx.lineWidth = style.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            stroke.points.forEach(function (pt, i) {
                var x = pt.x * cssW;
                var y = pt.y * cssH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            if (stroke.points.length === 1) {
                ctx.lineTo(stroke.points[0].x * cssW + 0.01, stroke.points[0].y * cssH);
            }
            ctx.stroke();
            ctx.restore();
        });
    }

    function _applyToolCursor() {
        var st = _quizState;
        var drawing = !!(st && st.tool && st.tool !== 'select');
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-page-block')).forEach(function (el) {
            if (drawing) {
                el.classList.add('is-drawing');
                el.setAttribute('data-tool', st.tool);
            } else {
                el.classList.remove('is-drawing');
                el.removeAttribute('data-tool');
            }
        });
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-box')).forEach(function (boxEl) {
            boxEl.style.pointerEvents = drawing ? 'none' : '';
        });
        _refreshToolButtons();
    }

    function _refreshToolButtons() {
        var st = _quizState;
        if (!st) return;
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-tool-btn')).forEach(function (btn) {
            var on = btn.getAttribute('data-tool') === st.tool;
            if (on) btn.classList.add('is-active');
            else btn.classList.remove('is-active');
        });
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-color-dot')).forEach(function (btn) {
            var on = String(btn.getAttribute('data-color')).toLowerCase() === String(st.penColor || '').toLowerCase();
            if (on) btn.classList.add('is-active');
            else btn.classList.remove('is-active');
        });
    }

    function setTool(tool) {
        var st = _quizState;
        if (!st) return;
        st.tool = (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') ? tool : 'select';
        _applyToolCursor();
        if (st.tool === 'select') {
            var banner = document.getElementById('pdf-quiz-active-banner');
            if (banner) _renderActiveBanner();
        } else {
            _renderActiveBanner();
        }
    }

    function setPenColor(color) {
        var st = _quizState;
        if (!st) return;
        st.penColor = color || PEN_COLORS[0];
        if (st.tool === 'select' || st.tool === 'eraser') st.tool = 'pen';
        _applyToolCursor();
    }

    function _normPointFromEvent(e, canvas) {
        var rect = canvas.getBoundingClientRect();
        var pos = _clientXY(e);
        return {
            x: Math.min(1, Math.max(0, (pos.x - rect.left) / (rect.width || 1))),
            y: Math.min(1, Math.max(0, (pos.y - rect.top) / (rect.height || 1)))
        };
    }

    function _onDrawPointerDown(e) {
        var canvas = e.target && e.target.closest ? e.target.closest('canvas.pdf-quiz-draw-layer') : null;
        if (!canvas) return;
        var st = _quizState;
        if (!st || st.tool === 'select') return;
        e.preventDefault();
        e.stopPropagation();
        var pageNum = Number(canvas.getAttribute('data-page'));
        var pt = _normPointFromEvent(e, canvas);
        var stroke = { tool: st.tool, color: st.penColor, points: [pt] };
        _pageStrokes(pageNum).push(stroke);
        _ink = { pageNum: pageNum, canvas: canvas, last: pt };
        _redrawPageDrawings(pageNum);
        document.addEventListener('pointermove', _onDrawPointerMove);
        document.addEventListener('pointerup', _onDrawPointerUp);
        document.addEventListener('pointercancel', _onDrawPointerUp);
    }

    function _onDrawPointerMove(e) {
        if (!_ink || !_quizState) return;
        e.preventDefault();
        var pt = _normPointFromEvent(e, _ink.canvas);
        var last = _ink.last;
        var dx = (pt.x - last.x) * _ink.canvas.clientWidth;
        var dy = (pt.y - last.y) * _ink.canvas.clientHeight;
        if ((dx * dx + dy * dy) < 4) return;
        var strokes = _pageStrokes(_ink.pageNum);
        var stroke = strokes[strokes.length - 1];
        if (!stroke) return;
        stroke.points.push(pt);
        _ink.last = pt;
        _redrawPageDrawings(_ink.pageNum);
    }

    function _onDrawPointerUp() {
        _ink = null;
        document.removeEventListener('pointermove', _onDrawPointerMove);
        document.removeEventListener('pointerup', _onDrawPointerUp);
        document.removeEventListener('pointercancel', _onDrawPointerUp);
    }

    function _onDrawResize() {
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-page-block[data-rendered="1"]')).forEach(_syncDrawCanvas);
    }

    function _visiblePageNum() {
        var body = document.getElementById(MODAL_ID + '-body');
        if (!body) return 1;
        var mid = body.getBoundingClientRect();
        var centerY = (mid.top + mid.bottom) / 2;
        var best = 1;
        var bestDist = Infinity;
        Array.prototype.slice.call(body.querySelectorAll('.pdf-quiz-page-block[data-rendered="1"]')).forEach(function (el) {
            var r = el.getBoundingClientRect();
            var d = Math.abs(((r.top + r.bottom) / 2) - centerY);
            if (d < bestDist) {
                bestDist = d;
                best = Number(el.getAttribute('data-page')) || 1;
            }
        });
        return best;
    }

    async function clearPageDrawings() {
        var st = _quizState;
        if (!st) return;
        var pageNum = _visiblePageNum();
        if (!(await window.ModalOverlay.confirm('確定清除第 ' + pageNum + ' 頁的畫筆筆記？作答框不會被刪。'))) return;
        st.drawingsByPage[String(pageNum)] = [];
        _redrawPageDrawings(pageNum);
    }

    function _drawToolsHtml() {
        var st = _quizState;
        var color = (st && st.penColor) || PEN_COLORS[0];
        var tool = (st && st.tool) || 'select';
        var colors = PEN_COLORS.map(function (c) {
            return '<button type="button" class="pdf-quiz-color-dot' + (c.toLowerCase() === color.toLowerCase() ? ' is-active' : '') + '" data-color="' + c + '" title="筆色" style="background:' + c + ';" onclick="window.FeatureStudentPdfQuiz.setPenColor(\'' + c + '\')"></button>';
        }).join('');
        function toolBtn(id, label) {
            return '<button type="button" class="btn pdf-quiz-tool-btn' + (tool === id ? ' is-active' : '') + '" data-tool="' + id + '" onclick="window.FeatureStudentPdfQuiz.setTool(\'' + id + '\')">' + label + '</button>';
        }
        return '<div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap; background:#F1F5F9; border-radius:8px; padding:3px 6px;">' +
            toolBtn('select', '作答') +
            toolBtn('pen', '畫筆') +
            toolBtn('highlighter', '螢光') +
            toolBtn('eraser', '擦掉') +
            '<span style="display:inline-flex; align-items:center; gap:4px; margin-left:4px;">' + colors + '</span>' +
            '<button type="button" class="btn pdf-quiz-tool-btn" style="margin-left:4px;" onclick="window.FeatureStudentPdfQuiz.clearPageDrawings()">清除本頁筆記</button>' +
        '</div>';
    }

    function _teardownQuiz() {
        if (_pageObserver) { _pageObserver.disconnect(); _pageObserver = null; }
        _onDrawPointerUp();
        window.removeEventListener('resize', _onDrawResize);
        _quizState = null;
    }

    /**
     * 這一頁疊上「所有大題」中屬於這一頁的作答框（不只是目前選中的大題）——因為同一頁常常
     * 同時看得到好幾個大題的內容（見檔案頂端說明）。每個框的鎖定／標紅狀態依它自己所屬大題
     * 的批改結果判斷，不能假設畫面上的框都是目前選中的大題。
     */
    function _renderBoxOverlayForPage(pageNum) {
        var st = _quizState;
        if (!st) return;
        var block = document.querySelector('.pdf-quiz-page-block[data-page="' + pageNum + '"]');
        if (!block || block.getAttribute('data-rendered') !== '1') return; // 圖片還沒載入，不用疊框
        Array.prototype.slice.call(block.querySelectorAll('.pdf-quiz-box')).forEach(function (el) { el.remove(); });
        st.sections.forEach(function (sec, secIdx) {
            var boxes = st.boxesBySection[secIdx] || [];
            var locked = _isSectionSubmitted(secIdx);
            var wrongKeySet = null;
            if (locked) {
                wrongKeySet = {};
                (st.sectionResults[secIdx].wrong_items || []).forEach(function (w) { wrongKeySet[w.item_id] = true; });
            }
            boxes.forEach(function (b, orderIdx) {
                if (b.page !== pageNum) return;
                var isWrong = false;
                if (locked && wrongKeySet) {
                    var it = sec.items[orderIdx];
                    isWrong = !!(it && wrongKeySet[it.key]);
                }
                block.insertAdjacentHTML('beforeend', _boxHtml(secIdx, b, orderIdx, locked, isWrong));
            });
        });
    }

    /** 捲到這一頁附近才真的用 pdf.js 畫圖（lazy render）＋快取，避免整份 PDF 一次全部渲染卡頓。
     * 每一頁只會被渲染一次，即使好幾個大題共用同一頁也不會重複畫。 */
    async function _ensurePageRendered(pageNum) {
        var st = _quizState;
        if (!st) return;
        var block = document.querySelector('.pdf-quiz-page-block[data-page="' + pageNum + '"]');
        if (!block || block.getAttribute('data-rendered') === '1') return;
        block.setAttribute('data-rendered', '1'); // 先標記，避免 observer 短時間內重複觸發同一頁
        try {
            var dataUrl = st.pageImageCache[pageNum];
            if (!dataUrl) {
                dataUrl = await _renderPageImage(st.pdfDoc, pageNum);
                st.pageImageCache[pageNum] = dataUrl;
            }
            block.style.cssText = 'position:relative; display:inline-block; margin:0 auto 14px; max-width:100%; cursor:crosshair;';
            block.innerHTML = '<img src="' + dataUrl + '" alt="第 ' + pageNum + ' 頁" style="display:block; max-width:100%; height:auto; user-select:none; position:relative; z-index:0;" draggable="false">' +
                '<canvas class="pdf-quiz-draw-layer" data-page="' + pageNum + '"></canvas>';
            var img = block.querySelector('img');
            var sync = function () {
                try { _syncDrawCanvas(block); } catch (_syncErr) { console.warn('[FeatureStudentPdfQuiz] sync draw', _syncErr); }
            };
            if (img) {
                img.addEventListener('load', sync);
                if (img.complete) requestAnimationFrame(sync);
            }
            if (st.tool && st.tool !== 'select') {
                block.classList.add('is-drawing');
                block.setAttribute('data-tool', st.tool);
            }
            _renderBoxOverlayForPage(pageNum);
        } catch (err) {
            console.error('[FeatureStudentPdfQuiz] _ensurePageRendered', pageNum, err);
            block.setAttribute('data-rendered', '0'); // 失敗了讓下次捲進視窗還能重試
            block.textContent = '第 ' + pageNum + ' 頁載入失敗，請捲動離開再捲回來重試';
        }
    }

    function _setupLazyPageObserver() {
        var body = document.getElementById(MODAL_ID + '-body');
        if (!body) return;
        if (_pageObserver) { _pageObserver.disconnect(); _pageObserver = null; }
        if (typeof IntersectionObserver !== 'function') {
            // 沒有 IntersectionObserver 的舊瀏覽器：退回全部立即渲染，不做 lazy load。
            Array.prototype.slice.call(body.querySelectorAll('.pdf-quiz-page-block')).forEach(function (el) {
                _ensurePageRendered(Number(el.getAttribute('data-page')));
            });
            return;
        }
        _pageObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) _ensurePageRendered(Number(entry.target.getAttribute('data-page')));
            });
        }, { root: body, rootMargin: '600px 0px 600px 0px' });
        Array.prototype.slice.call(body.querySelectorAll('.pdf-quiz-page-block')).forEach(function (el) {
            _pageObserver.observe(el);
        });
    }

    /** 開卷時一次把整份 PDF 的頁面區塊（先放占位）建好，捲到附近才實際畫圖。每一頁只建立一次
     * DOM，即使好幾個大題共用同一頁也只會出現一次（取代舊版「一大題一畫面、各自只畫自己的
     * 頁碼範圍」的 _renderSection，那樣共用頁會在兩個大題的畫面裡各出現一次）。 */
    function _renderAllPages() {
        var st = _quizState;
        if (!st || !st.pdfDoc) return;
        var body = document.getElementById(MODAL_ID + '-body');
        if (!body) return;
        var htmlParts = [];
        for (var p = 1; p <= st.pdfDoc.numPages; p++) htmlParts.push(_pagePlaceholderHtml(p));
        body.innerHTML = htmlParts.join('');
        _setupLazyPageObserver();
        _renderSectionTabs();
        _jumpToSection(st.currentIdx, true);
        var anchorPage = (st.pageRanges[st.currentIdx] || {}).startPage || 1;
        _ensurePageRendered(anchorPage);
        if (anchorPage > 1) _ensurePageRendered(anchorPage - 1);
        _ensurePageRendered(anchorPage + 1);
    }

    /** 大題狀態有變動（提交批改）後，只重繪它自己作答框所在的那幾頁 overlay＋籤／提示條，
     * 不動整份 PDF 的捲動位置——跟舊版整頁重繪不同，那樣做會把學生正在看的位置整個打亂。 */
    function _refreshSectionRender(idx) {
        var st = _quizState;
        if (!st) return;
        var boxes = st.boxesBySection[idx] || [];
        var pages = {};
        boxes.forEach(function (b) { pages[b.page] = true; });
        Object.keys(pages).forEach(function (p) { _renderBoxOverlayForPage(Number(p)); });
        _renderSectionTabs();
        if (idx === st.currentIdx) { _renderActiveBanner(); _renderSectionCounter(); }
        _updateNavButtons();
    }

    /** 畫面上方常駐提示條（不在可捲動區域內，捲頁面時一直看得到）：目前選中哪個大題、
     * 該怎麼作答／已批改鎖定的說明。跟頁面內容分開更新，不用整份 PDF 重繪。 */
    function _renderActiveBanner() {
        var st = _quizState;
        if (!st) return;
        var el = document.getElementById('pdf-quiz-active-banner');
        if (!el) return;
        var idx = st.currentIdx;
        var sec = st.sections[idx];
        var locked = _isSectionSubmitted(idx);
        if (st.tool && st.tool !== 'select') {
            var toolLabel = st.tool === 'highlighter' ? '螢光筆' : (st.tool === 'eraser' ? '橡皮擦' : '畫筆');
            el.innerHTML = '<div style="padding:8px 10px; background:#FEF3C7; border:1px solid #FCD34D; border-radius:8px; font-size:0.82rem; color:#92400E; font-weight:700;">'
                + '✏️ 筆記模式（' + toolLabel + '）：可在考卷上畫重點。筆記不算分數。要點作答框請先按「作答」。'
                + '</div>';
            return;
        }
        el.innerHTML = locked
            ? ('<div style="padding:8px 10px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-size:0.82rem; color:#134E4A; font-weight:700;">'
                + '✅ 目前選中「' + esc(sec.section) + '」，已批改：' + st.sectionResults[idx].correct + ' / ' + st.sectionResults[idx].total + '（' + st.sectionResults[idx].score + '%），不能再修改（只鎖這一大題，其他大題不受影響）。'
                + '</div>')
            : ('<div style="padding:8px 10px; background:#F0F9FF; border:1px solid #BAE6FD; border-radius:8px; font-size:0.82rem; color:#0369A1;">'
                + '💡 目前選中「' + esc(sec.section) + '」（共 ' + sec.items.length + ' 格）。在下面 PDF 圖片上找到底線／空格點一下，就會出現作答框（框上數字＝第幾個建立的），不會寫也要點一下留空。填完按下面「提交這一大題並批改」，之後不能再改這一大題。'
                + '</div>');
    }

    function _updateNavButtons() {
        var st = _quizState;
        if (!st) return;
        var prevBtn = document.getElementById('pdf-quiz-prev-btn');
        var nextBtn = document.getElementById('pdf-quiz-next-btn');
        if (prevBtn) prevBtn.style.visibility = st.currentIdx === 0 ? 'hidden' : 'visible';
        if (nextBtn) nextBtn.style.visibility = st.currentIdx === st.sections.length - 1 ? 'hidden' : 'visible';
    }

    function _scrollPageIntoQuizBody(block) {
        var body = document.getElementById(MODAL_ID + '-body');
        var overlay = document.getElementById(MODAL_ID);
        if (overlay) overlay.scrollTop = 0;
        if (!body || !block) return;
        var bodyRect = body.getBoundingClientRect();
        var blockRect = block.getBoundingClientRect();
        body.scrollTop = body.scrollTop + (blockRect.top - bodyRect.top);
        if (overlay) overlay.scrollTop = 0;
    }

    /**
     * 設定「目前選中的大題」＋把它的錨點頁碼捲到考卷區最上方。
     * 不能用 scrollIntoView：灰色 overlay 自己也 overflow 可捲，會把整張考卷視窗捲出畫面（點後面的大題例如 Quiz 8 就像跳開）。
     */
    function _jumpToSection(idx, skipAnim) {
        var st = _quizState;
        if (!st) return;
        if (idx < 0 || idx >= st.sections.length) return;
        st.currentIdx = idx;
        _renderActiveBanner();
        _renderSectionCounter();
        _updateNavButtons();
        var anchorPage = (st.pageRanges[idx] || {}).startPage || 1;
        var block = document.querySelector('.pdf-quiz-page-block[data-page="' + anchorPage + '"]');
        _scrollPageIntoQuizBody(block);
        _paintSectionTabs();
    }

    function _goToSection(delta) {
        var st = _quizState;
        if (!st) return;
        _jumpToSection(st.currentIdx + delta);
    }

    function _sectionTabLook(idx) {
        var st = _quizState;
        var submitted = _isSectionSubmitted(idx);
        var isCurrent = !!(st && idx === st.currentIdx);
        var range = (st && st.pageRanges[idx]) || {};
        var pageLabel = range.startPage
            ? ('p.' + range.startPage + (range.endPage && range.endPage !== range.startPage ? ('~' + range.endPage) : ''))
            : '';
        return {
            submitted: submitted,
            isCurrent: isCurrent,
            pageLabel: pageLabel,
            bg: submitted ? '#ECFDF5' : (isCurrent ? '#E0F2FE' : '#F8FAFC'),
            border: submitted ? '#6EE7B7' : (isCurrent ? '#7DD3FC' : '#E2E8F0'),
            color: submitted ? '#047857' : (isCurrent ? '#0369A1' : '#64748B')
        };
    }

    function _applySectionTabLook(btn, idx) {
        var look = _sectionTabLook(idx);
        btn.style.cssText = 'border:2px solid ' + look.border + '; background:' + look.bg + '; color:' + look.color + '; font-weight:800; padding:4px 10px; border-radius:10px; cursor:pointer; flex-shrink:0; display:flex; flex-direction:column; align-items:center; line-height:1.3; gap:1px;' +
            (look.isCurrent ? ' box-shadow:0 0 0 2px rgba(3,105,161,0.25);' : '');
        var nameEl = btn.querySelector('[data-tab-name]');
        var pageEl = btn.querySelector('[data-tab-page]');
        var st = _quizState;
        var sec = st && st.sections[idx];
        if (nameEl && sec) nameEl.textContent = sec.section + (look.submitted ? ' ✓' : '');
        if (pageEl) {
            pageEl.textContent = look.pageLabel;
            pageEl.style.display = look.pageLabel ? '' : 'none';
        }
    }

    // 💣 上方是大題名稱、下方是頁碼。籤必須跟「上一大題」一樣是固定按鈕，
    // 點了只改顏色，不准 innerHTML 整排拆掉——拆掉會讓這次 click 落到灰色層而跳出。
    function _renderSectionTabs() {
        var el = document.getElementById('pdf-quiz-section-tabs');
        var st = _quizState;
        if (!el || !st) return;
        var existing = el.querySelectorAll('.pdf-quiz-section-tab');
        if (existing.length !== st.sections.length) {
            el.innerHTML = st.sections.map(function (sec, idx) {
                return '<button type="button" class="pdf-quiz-section-tab" data-idx="' + idx + '">' +
                    '<span data-tab-name style="font-size:0.78rem;"></span>' +
                    '<span data-tab-page style="font-size:0.66rem; font-weight:700; opacity:0.8;"></span>' +
                '</button>';
            }).join('');
            existing = el.querySelectorAll('.pdf-quiz-section-tab');
        }
        Array.prototype.forEach.call(existing, function (btn) {
            _applySectionTabLook(btn, Number(btn.getAttribute('data-idx')));
        });
    }

    function _paintSectionTabs() {
        var el = document.getElementById('pdf-quiz-section-tabs');
        if (!el) return;
        Array.prototype.forEach.call(el.querySelectorAll('.pdf-quiz-section-tab'), function (btn) {
            _applySectionTabLook(btn, Number(btn.getAttribute('data-idx')));
        });
    }

    function _onSectionTabsEvent(e) {
        e.stopPropagation();
        if (e.type !== 'click') return;
        var btn = e.target.closest ? e.target.closest('.pdf-quiz-section-tab') : null;
        if (!btn) return;
        _jumpToSection(Number(btn.getAttribute('data-idx')));
    }

    function _bindSectionTabs(overlay) {
        var el = overlay.querySelector('#pdf-quiz-section-tabs');
        if (!el || el.getAttribute('data-tabs-bound') === '1') return;
        el.setAttribute('data-tabs-bound', '1');
        ['pointerdown', 'mousedown', 'click'].forEach(function (type) {
            el.addEventListener(type, _onSectionTabsEvent);
        });
    }

    async function requestClose() {
        var st = _quizState;
        if (!st) {
            if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
            return;
        }
        if (window.ModalOverlay) window.ModalOverlay.setBusy(MODAL_ID, true);
        try {
            var saved = await saveDraft();
            st._draftSaved = true;
            if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
            if (saved) window.showFlash('已暫存作答與筆記，下次可接續', 'success');
        } catch (err) {
            console.error('[FeatureStudentPdfQuiz] requestClose', err);
            window.showFlash('暫存失敗：' + (err.message || err), 'error');
        } finally {
            if (window.ModalOverlay) window.ModalOverlay.setBusy(MODAL_ID, false);
        }
    }

    // ------------------------------------------------------------------
    // 點擊 PDF 頁面圖片 → 建立／聚焦作答框
    // ------------------------------------------------------------------

    function _onPageBlockClick(e) {
        var block = e.target.closest ? e.target.closest('.pdf-quiz-page-block') : null;
        if (!block) return;
        if (e.target.closest('.pdf-quiz-box')) return; // 點到既有的框/輸入框/刪除鈕，不要在這裡新增
        if (e.target.closest && e.target.closest('canvas.pdf-quiz-draw-layer')) return;
        var st = _quizState;
        if (!st) return;
        if (st.tool && st.tool !== 'select') return;
        if (_isSectionSubmitted(st.currentIdx)) return; // 這一大題已批改鎖定，不能再新增作答框
        var rect = block.getBoundingClientRect();
        var xPct = ((e.clientX - rect.left) / rect.width) * 100;
        var yPct = ((e.clientY - rect.top) / rect.height) * 100;
        var pageNum = Number(block.getAttribute('data-page'));

        var boxes = st.boxesBySection[st.currentIdx] || (st.boxesBySection[st.currentIdx] = []);
        var nearest = boxes.filter(function (b) { return b.page === pageNum; }).find(function (b) {
            return Math.abs(b.xPct - xPct) <= CLICK_MERGE_THRESHOLD_PCT && Math.abs(b.yPct - yPct) <= CLICK_MERGE_THRESHOLD_PCT;
        });
        if (nearest) {
            var inputEl = document.querySelector('.pdf-quiz-answer-input[data-box-id="' + nearest.id + '"]');
            if (inputEl) inputEl.focus();
            return;
        }

        var box = { id: 'b' + Date.now() + '_' + Math.floor(Math.random() * 10000), page: pageNum, xPct: xPct, yPct: yPct, text: '' };
        boxes.push(box);
        var boxHtml = _boxHtml(st.currentIdx, box, boxes.length - 1);
        block.insertAdjacentHTML('beforeend', boxHtml);
        _renderSectionCounter();
        var newInput = document.querySelector('.pdf-quiz-answer-input[data-box-id="' + box.id + '"]');
        if (newInput) newInput.focus();
    }

    // 💣 輸入框所屬大題一律看 .pdf-quiz-box 自己的 data-section-idx，不能假設是 st.currentIdx——
    // 改版後同一頁畫面上同時看得到「所有大題」的框（不只是目前選中的），學生可能直接點旁邊
    // 那大題已建立的框繼續打字，不用先切籤。
    function _onBodyInput(e) {
        if (!(e.target && e.target.classList && e.target.classList.contains('pdf-quiz-answer-input'))) return;
        var st = _quizState;
        if (!st) return;
        var boxEl = e.target.closest('.pdf-quiz-box');
        var secIdx = boxEl ? Number(boxEl.getAttribute('data-section-idx')) : st.currentIdx;
        var boxId = e.target.getAttribute('data-box-id');
        var boxes = st.boxesBySection[secIdx] || [];
        var b = boxes.find(function (x) { return x.id === boxId; });
        if (b) b.text = e.target.value;
        _autoSizeInput(e.target);
    }

    function _onBodyClick(e) {
        var removeBtn = e.target.closest ? e.target.closest('.pdf-quiz-box-remove') : null;
        if (removeBtn) {
            e.stopPropagation();
            var st = _quizState;
            if (!st) return;
            var boxEl = removeBtn.closest('.pdf-quiz-box');
            var secIdx = boxEl ? Number(boxEl.getAttribute('data-section-idx')) : st.currentIdx;
            if (_isSectionSubmitted(secIdx)) return;
            var boxId = removeBtn.getAttribute('data-box-id');
            var boxes = st.boxesBySection[secIdx] || [];
            var idx = boxes.findIndex(function (x) { return x.id === boxId; });
            if (idx >= 0) {
                // 同一大題的框可能分散在跨頁的好幾張頁面上（見檔案頂端跨頁說明），刪除後其他
                // 框的序號會往前移，所以要重繪「這個大題所有框所在」的每一頁，不只是被刪的那頁。
                var affectedPages = {};
                boxes.forEach(function (b) { affectedPages[b.page] = true; });
                boxes.splice(idx, 1);
                Object.keys(affectedPages).forEach(function (p) { _renderBoxOverlayForPage(Number(p)); });
                if (secIdx === st.currentIdx) _renderSectionCounter();
            }
            return;
        }
        _onPageBlockClick(e);
    }

    // ------------------------------------------------------------------
    // 拖曳移動作答框：抓著框上的圓形編號（handle）拖，放開就固定在新位置
    // ------------------------------------------------------------------

    function _clientXY(e) {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function _onBodyMouseDown(e) {
        var handle = e.target.closest ? e.target.closest('.pdf-quiz-box-handle') : null;
        if (!handle) return;
        var boxEl = handle.closest('.pdf-quiz-box');
        // 💣 鎖定狀態一律看這個框自己的 data-section-idx，不是目前選中的大題（st.currentIdx）——
        // 同一頁畫面上可能同時看得到已鎖定大題的框跟還沒鎖定大題的框。
        var secIdx = boxEl ? Number(boxEl.getAttribute('data-section-idx')) : NaN;
        if (isNaN(secIdx) || _isSectionSubmitted(secIdx)) return; // 已批改鎖定，不能再拖曳
        e.preventDefault();
        e.stopPropagation();
        var pageBlockEl = handle.closest('.pdf-quiz-page-block');
        if (!boxEl || !pageBlockEl) return;
        _drag = { boxId: handle.getAttribute('data-box-id'), sectionIdx: secIdx, boxEl: boxEl, pageBlockEl: pageBlockEl };
        handle.style.cursor = 'grabbing';
        document.addEventListener('mousemove', _onDragMove);
        document.addEventListener('mouseup', _onDragEnd);
        document.addEventListener('touchmove', _onDragMove, { passive: false });
        document.addEventListener('touchend', _onDragEnd);
        document.addEventListener('touchcancel', _onDragEnd);
    }

    function _onDragMove(e) {
        if (!_drag) return;
        e.preventDefault();
        var pos = _clientXY(e);
        var rect = _drag.pageBlockEl.getBoundingClientRect();
        var xPct = Math.min(100, Math.max(0, ((pos.x - rect.left) / rect.width) * 100));
        var yPct = Math.min(100, Math.max(0, ((pos.y - rect.top) / rect.height) * 100));
        _drag.boxEl.style.left = xPct + '%';
        _drag.boxEl.style.top = yPct + '%';
        var st = _quizState;
        if (st) {
            var boxes = st.boxesBySection[_drag.sectionIdx] || [];
            var b = boxes.find(function (x) { return x.id === _drag.boxId; });
            if (b) { b.xPct = xPct; b.yPct = yPct; }
        }
    }

    function _onDragEnd() {
        if (_drag && _drag.boxEl) {
            var handle = _drag.boxEl.querySelector('.pdf-quiz-box-handle');
            if (handle) handle.style.cursor = 'grab';
        }
        _drag = null;
        document.removeEventListener('mousemove', _onDragMove);
        document.removeEventListener('mouseup', _onDragEnd);
        document.removeEventListener('touchmove', _onDragMove);
        document.removeEventListener('touchend', _onDragEnd);
        document.removeEventListener('touchcancel', _onDragEnd);
    }

    // ------------------------------------------------------------------
    // 統一文字大小（影響目前畫面上所有作答框，之後新建的框也套用同一個大小）
    // ------------------------------------------------------------------

    function _applyFontSizeToVisibleInputs() {
        var st = _quizState;
        if (!st) return;
        var fontPx = st.fontSizePx;
        Array.prototype.slice.call(document.querySelectorAll('.pdf-quiz-answer-input')).forEach(function (el) {
            el.style.fontSize = fontPx + 'px';
            _autoSizeInput(el);
        });
        var display = document.getElementById('pdf-quiz-fontsize-display');
        if (display) display.textContent = fontPx + 'px';
    }

    function changeFontSize(delta) {
        var st = _quizState;
        if (!st) return;
        st.fontSizePx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, (st.fontSizePx || DEFAULT_FONT_PX) + delta));
        _applyFontSizeToVisibleInputs();
    }

    function _loadingHtml(msg) {
        return '<div style="min-height:240px; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:10px; padding:24px; text-align:center;">'
            + '<div style="font-size:1.05rem; font-weight:900; color:#0F766E;">⏳ ' + esc(msg) + '</div>'
            + '<div style="font-size:0.8rem; color:#64748B; font-weight:700;">大檔案可能需要十幾秒，請不要關閉視窗</div>'
            + '</div>';
    }

    function _applyDetectedRanges(pageRanges) {
        var st = _quizState;
        if (!st || !st.pdfDoc) return;
        var rangeBySection = {};
        (pageRanges || []).forEach(function (r) { rangeBySection[r.section] = r; });
        st.pageRanges = st.sections.map(function (s) {
            return rangeBySection[s.section] || { startPage: 1, endPage: st.pdfDoc.numPages };
        });
        _renderSectionTabs();
    }

    async function _loadQuizDocument() {
        var st = _quizState;
        if (!st) return;
        var body = document.getElementById(MODAL_ID + '-body');
        var job = st.job;
        try {
            if (body) body.innerHTML = _loadingHtml('正在下載考卷…');
            var pdfDoc = await window.PdfExamPaper.loadPdfDocumentFromDrive(job.pdf_file_id);
            if (_quizState !== st) return;
            st.pdfDoc = pdfDoc;
            st.pageRanges = st.sections.map(function () {
                return { startPage: 1, endPage: pdfDoc.numPages };
            });
            st.loading = false;
            _renderAllPages();
            window.PdfExamPaper.detectSectionPageRanges(pdfDoc, st.bank, job.section_page_hints).then(function (pageRanges) {
                if (_quizState !== st) return;
                _applyDetectedRanges(pageRanges);
            }).catch(function (err) {
                console.warn('[FeatureStudentPdfQuiz] detectSectionPageRanges', err);
            });
        } catch (err) {
            console.error('[FeatureStudentPdfQuiz] loadPdfDocumentFromDrive', err);
            if (_quizState !== st) return;
            st.loading = false;
            if (body) {
                body.innerHTML = '<div style="padding:24px; text-align:center;">'
                    + '<div style="font-weight:900; color:#B91C1C; margin-bottom:8px;">考卷讀取失敗</div>'
                    + '<div style="font-size:0.85rem; color:#334155; font-weight:700; white-space:pre-wrap;">' + esc(err.message || err) + '</div>'
                    + '</div>';
            }
            window.showFlash('考卷讀取失敗：' + (err.message || err), 'error');
        }
    }

    // ------------------------------------------------------------------
    // 開啟考卷
    // ------------------------------------------------------------------

    async function openQuiz(assignmentId, taskId) {
        var task = findTaskInAssignments(assignmentId, taskId);
        if (!task) return window.showFlash('找不到考試任務', 'error');
        var job = task.raw_data && task.raw_data.pdf_exam_job;
        if (!job || !job.pdf_file_id) return window.showFlash('老師尚未設定這份 PDF 考卷', 'warning');
        var bank = (job.parsed_bank || []).filter(function (b) { return b.key; });
        if (!bank.length) return window.showFlash('老師尚未確認這份考卷的答案清單', 'warning');
        if (!window.PdfExamPaper) return window.showFlash('PdfExamPaper 模組未載入', 'error');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return window.showFlash('ModalOverlay 未載入', 'error');

        var sections = window.PdfExamPaper.groupItemsBySection(bank);
        var prev = findCompletion(assignmentId, taskId);
        var prevRaw = (prev && prev.raw_data) || {};
        var prevResult = prevRaw.pdf_quiz_result;
        var prevBoxesRaw = prevRaw.pdf_quiz_boxes_by_section;
        var prevSectionResultsRaw = prevRaw.pdf_quiz_section_results;
        var canResume = !!(prevResult && prevResult.all_submitted === false
            && Array.isArray(prevBoxesRaw) && prevBoxesRaw.length === sections.length
            && Array.isArray(prevSectionResultsRaw) && prevSectionResultsRaw.length === sections.length);
        var boxesBySection = canResume
            ? sections.map(function (s, idx) { return Array.isArray(prevBoxesRaw[idx]) ? prevBoxesRaw[idx] : []; })
            : sections.map(function () { return []; });
        var sectionResults = canResume
            ? sections.map(function (s, idx) { return prevSectionResultsRaw[idx] || null; })
            : sections.map(function () { return null; });
        var drawingsByPage = {};
        if (canResume && prevRaw.pdf_quiz_drawings_by_page && typeof prevRaw.pdf_quiz_drawings_by_page === 'object') {
            drawingsByPage = prevRaw.pdf_quiz_drawings_by_page;
        }
        var startIdx = 0;
        if (canResume) {
            var firstUnsubmittedIdx = sectionResults.findIndex(function (r) { return !r; });
            startIdx = firstUnsubmittedIdx >= 0 ? firstUnsubmittedIdx : (sections.length - 1);
        }

        _quizState = {
            assignmentId: assignmentId,
            taskId: taskId,
            task: task,
            job: job,
            bank: bank,
            pdfDoc: null,
            sections: sections,
            pageRanges: sections.map(function () { return { startPage: 1, endPage: 1 }; }),
            boxesBySection: boxesBySection,
            sectionResults: sectionResults,
            drawingsByPage: drawingsByPage,
            tool: 'select',
            penColor: PEN_COLORS[0],
            allowDraftPersist: canResume || !prevResult,
            loading: true,
            currentIdx: startIdx,
            fontSizePx: DEFAULT_FONT_PX,
            pageImageCache: {}
        };

        var title = String(task.title || 'PDF 考卷').replace(/<[^>]*>?/gm, '');
        var prevScoreHtml = '';
        if (canResume) {
            prevScoreHtml = '<div style="margin-bottom:8px; padding:6px 10px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; font-size:0.8rem; color:#92400E; font-weight:700;">'
                + '↩️ 繼續上次的作答：已批改 ' + esc(prevResult.submitted_sections) + ' / ' + esc(prevResult.total_sections) + ' 大題，接著完成剩下的大題。'
                + '</div>';
        } else if (prevResult) {
            prevScoreHtml = '<div style="margin-bottom:8px; padding:6px 10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; font-size:0.8rem; color:#334155; font-weight:700;">'
                + '上次成績：' + esc(prevResult.correct) + ' / ' + esc(prevResult.total) + '（' + esc(prevResult.score) + '%）'
                + '</div>';
        }

        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: 'B',
            isDirty: function () {
                var s = _quizState;
                if (!s || s.loading) return false;
                var hasBoxes = s.sections.some(function (sec, idx) {
                    return !_isSectionSubmitted(idx) && (s.boxesBySection[idx] || []).length > 0;
                });
                return hasBoxes || _hasAnyDrawings(s.drawingsByPage);
            },
            unsavedMessage: '要暫存目前作答與筆記後離開嗎？',
            onMount: function (overlay) {
                overlay.style.overflow = 'hidden';
                overlay.style.overscrollBehavior = 'none';
                overlay.style.alignItems = 'flex-start';
                overlay.style.paddingTop = '2vh';
                _bindSectionTabs(overlay);
                overlay.addEventListener('input', _onBodyInput);
                overlay.addEventListener('click', _onBodyClick);
                overlay.addEventListener('mousedown', _onBodyMouseDown);
                overlay.addEventListener('touchstart', _onBodyMouseDown, { passive: false });
                overlay.addEventListener('pointerdown', _onDrawPointerDown);
                window.addEventListener('resize', _onDrawResize);
                _loadQuizDocument();
            },
            onClose: function () {
                var st = _quizState;
                var pending = null;
                if (st && !st._draftSaved && _canPersistDraft()) {
                    pending = {
                        assignmentId: st.assignmentId,
                        taskId: st.taskId,
                        payload: _buildRawPayload()
                    };
                }
                _teardownQuiz();
                if (pending) {
                    persistResult(pending.assignmentId, pending.taskId, pending.payload, false).catch(function (err) {
                        console.error('[FeatureStudentPdfQuiz] onClose persist', err);
                    });
                }
            },
            contentHtml:
                '<div data-mo-panel style="max-width:900px; width:95vw; height:92vh; max-height:92vh; overflow:hidden; background:white; border-radius:14px; padding:16px; box-shadow:0 20px 50px rgba(15,23,42,0.2); display:flex; flex-direction:column; box-sizing:border-box;">' +
                    '<div style="flex-shrink:0;">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📄 ' + esc(title) + '</h3>' +
                        '<div style="display:flex; align-items:center; gap:8px;">' +
                            '<div style="display:flex; align-items:center; gap:4px; background:#F1F5F9; border-radius:8px; padding:3px 6px;">' +
                                '<span style="font-size:0.75rem; color:#64748B;">文字大小</span>' +
                                '<button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem;" onclick="window.FeatureStudentPdfQuiz.changeFontSize(-2)">－</button>' +
                                '<span id="pdf-quiz-fontsize-display" style="font-size:0.78rem; font-weight:700; color:#334155; min-width:34px; text-align:center;">' + DEFAULT_FONT_PX + 'px</span>' +
                                '<button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem;" onclick="window.FeatureStudentPdfQuiz.changeFontSize(2)">＋</button>' +
                            '</div>' +
                            '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeatureStudentPdfQuiz.requestClose()">暫存並離開</button>' +
                        '</div>' +
                    '</div>' +
                    '<div style="margin-bottom:6px;">' + _drawToolsHtml() + '</div>' +
                    prevScoreHtml +
                    '<div id="pdf-quiz-section-tabs" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;"></div>' +
                    '<div id="pdf-quiz-active-banner" style="margin-bottom:6px;"></div>' +
                    '<div id="pdf-quiz-counter" style="font-size:0.8rem; margin-bottom:6px;"></div>' +
                    '</div>' +
                    '<div id="' + MODAL_ID + '-body" style="flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; border:1px solid #E2E8F0; border-radius:8px; background:#F8FAFC; padding:10px;">' + _loadingHtml('正在下載考卷…') + '</div>' +
                    '<div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; margin-top:10px; gap:8px;">' +
                        '<button type="button" class="btn" id="pdf-quiz-prev-btn" onclick="window.FeatureStudentPdfQuiz._goToSection(-1)">◀ 上一大題</button>' +
                        '<button type="button" class="btn btn-action" id="pdf-quiz-main-action-btn" style="background:#0F766E; color:white; border:none; padding:8px 14px; font-weight:800;">提交這一大題並批改</button>' +
                        '<button type="button" class="btn" id="pdf-quiz-next-btn" onclick="window.FeatureStudentPdfQuiz._goToSection(1)">下一大題 ▶</button>' +
                    '</div>' +
                '</div>'
        });
    }

    // 💣 學生結果頁**不顯示正確答案**（只標出哪些格錯了），避免直接洩題給還沒交卷的同學。
    // 老師複核畫面（feature-pdf-exam-job.js）不受影響，仍讀得到 wrong_items.expected 供批改用。
    function _showResultModal(result) {
        var sectionStatsHtml = (result.section_stats || []).map(function (s) {
            if (s.submitted === false) {
                return '<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 2px; border-bottom:1px solid #E2E8F0; font-size:0.85rem;">' +
                    '<span style="color:#334155; font-weight:600;">' + esc(s.section) + '</span>' +
                    '<span style="font-weight:700; color:#94A3B8;">尚未提交</span>' +
                '</div>';
            }
            var color = s.wrong_count > 0 ? '#B45309' : '#047857';
            return '<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 2px; border-bottom:1px solid #E2E8F0; font-size:0.85rem;">' +
                '<span style="color:#334155; font-weight:600;">' + esc(s.section) + '</span>' +
                '<span style="font-weight:800; color:' + color + ';">' + esc(s.correct) + ' / ' + esc(s.total) + '（' + esc(s.score) + '%）' +
                    (s.wrong_count > 0 ? '　錯 ' + esc(s.wrong_count) + ' 格' : '') +
                '</span>' +
            '</div>';
        }).join('');
        var wrongHtml = (result.wrong_items || []).map(function (w) {
            return '<div style="border:1px solid #FECACA; background:#FFF7F7; border-radius:8px; padding:10px; margin-bottom:8px;">' +
                '<div style="font-size:0.8rem; font-weight:800; color:#B91C1C;">' + esc(w.prompt_zh || '') + '</div>' +
                '<div style="font-size:0.85rem; margin-top:4px;">你的答案：<b>' + esc(w.answer || '(未填)') + '</b></div>' +
            '</div>';
        }).join('');
        window.ModalOverlay.open({
            id: RESULT_MODAL_ID,
            tier: 'A',
            contentHtml:
                '<div style="max-width:600px; width:92vw; max-height:86vh; overflow:auto; background:white; border-radius:14px; padding:18px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📊 繳交結果</h3>' +
                        '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeatureStudentPdfQuiz.closeResult()">知道了</button>' +
                    '</div>' +
                    '<div style="margin-bottom:12px; padding:10px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-weight:800; color:#134E4A;">' +
                        '總分 ' + esc(result.correct) + ' / ' + esc(result.total) + '（' + esc(result.score) + '%）' +
                    '</div>' +
                    (sectionStatsHtml ? ('<div style="font-weight:900; color:#0F766E; margin-bottom:4px;">各大題結果</div><div style="margin-bottom:12px;">' + sectionStatsHtml + '</div>') : '') +
                    (wrongHtml
                        ? ('<div style="font-weight:900; color:#B91C1C; margin-bottom:6px;">錯題（只標出錯在哪格，不顯示正確答案）</div>' + wrongHtml)
                        : '<div style="color:#047857; font-weight:800;">全部答對！</div>') +
                '</div>'
        });
    }

    function closeResult() {
        if (window.ModalOverlay) window.ModalOverlay.close(RESULT_MODAL_ID);
        window.location.reload();
    }

    function openPastResult(assignmentId, taskId) {
        var prev = findCompletion(assignmentId, taskId);
        var raw = (prev && prev.raw_data) || {};
        var result = raw.pdf_quiz_result;
        if (!result) return window.showFlash('尚未作答', 'warning');
        _showResultModal(result);
    }

    /**
     * 把每一大題的作答框（依建立順序）跟該大題的答案清單（已依題號排好序）一一對齊，
     * 組成 { bankKey: 學生輸入文字 } 給 QuizPaperBuilder.gradeAnswers。順序才是配對依據，
     * 座標只是畫面參考用，不參與比對。
     */
    function _buildAnswersFromBoxes() {
        var st = _quizState;
        var answers = {};
        st.sections.forEach(function (sec, idx) {
            var boxes = st.boxesBySection[idx] || [];
            Object.assign(answers, window.PdfExamPaper.buildSectionAnswersFromBoxes(sec.items, boxes));
        });
        return answers;
    }

    /** 只把「這一大題」的作答框跟這一大題的答案清單對齊，供單獨批改這一大題用 */
    function _buildSectionAnswers(idx) {
        var st = _quizState;
        var sec = st.sections[idx];
        var boxes = st.boxesBySection[idx] || [];
        return window.PdfExamPaper.buildSectionAnswersFromBoxes(sec.items, boxes);
    }

    /**
     * 提交「目前這一大題」並立刻批改（不用等整份考卷寫完）：批改完鎖定這一大題、顯示這一大題的
     * 對錯格數／百分比（不顯示正確答案），同時把目前為止的整份考卷進度存檔，讓老師端也能看到
     * 部分完成度。最後一大題批改完才彈出整份考卷的總結。
     */
    async function submitSection() {
        var st = _quizState;
        if (!st) return;
        var idx = st.currentIdx;
        if (_isSectionSubmitted(idx)) return;
        // 💣 不強制作答框數量一定要等於程式判斷的格數（程式判斷可能算錯）——數量不符也能直接送出，
        // 送出後就依學生當時實際點的作答框批改；不會作答的題也不會擋在這裡，是學生自己的選擇。
        var sec = st.sections[idx];
        if (!(await window.ModalOverlay.confirm('確定要提交「' + sec.section + '」嗎？提交後會立刻批改，這一大題就不能再修改了。'))) return;

        var sectionAnswers = _buildSectionAnswers(idx);
        var fullPaper = window.PdfExamPaper.buildGradingPaper(st.job);
        var sectionKeySet = {};
        sec.items.forEach(function (it) { sectionKeySet[it.key] = true; });
        var sectionPaper = { items: fullPaper.items.filter(function (it) { return sectionKeySet[it.item_id]; }) };
        var gradeResult = window.QuizPaperBuilder.gradeAnswers(sectionPaper, sectionAnswers);

        st.sectionResults[idx] = {
            section: sec.section,
            correct: gradeResult.correct,
            total: gradeResult.total,
            score: gradeResult.score,
            wrong_items: gradeResult.wrong_items,
            graded_at: new Date().toISOString()
        };

        var aggregate = _aggregateResults();
        var rawPayload = _buildRawPayload();
        try {
            await persistResult(st.assignmentId, st.taskId, rawPayload, aggregate.all_submitted);
            var r = st.sectionResults[idx];
            window.showFlash('✅「' + sec.section + '」已批改：' + r.correct + ' / ' + r.total + '（' + r.score + '%）', 'success');
            if (aggregate.all_submitted) {
                st._draftSaved = true;
                if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
                _showResultModal(aggregate);
            } else {
                _refreshSectionRender(idx);
            }
        } catch (err) {
            st.sectionResults[idx] = null; // 沒存到就別讓畫面顯示已批改，避免跟資料庫狀態兜不起來
            console.error('[FeatureStudentPdfQuiz] submitSection', err);
            window.showFlash('提交失敗：' + (err.message || err), 'error');
        }
    }

    return {
        openQuiz: openQuiz,
        requestClose: requestClose,
        submitSection: submitSection,
        setTool: setTool,
        setPenColor: setPenColor,
        clearPageDrawings: clearPageDrawings,
        _goToSection: _goToSection,
        _jumpToSection: _jumpToSection,
        closeResult: closeResult,
        openPastResult: openPastResult,
        changeFontSize: changeFontSize
    };
})();

/**
 * 📂 檔案路徑：110_teacher_core/feature-script-collector.js
 * 🎯 職責：「📥 由下往上收集文稿」——教材／meta 的另一個資料來源方向。
 *
 * 背景（2026-08-08 老師明確提出）：教材補齊 meta／script 目前只有「由上到下」一條路
 * （老師先準備好 Excel → 教材／Layout 搭配 → 產生 meta.json／script.txt）。但老師實際上
 * 常常是先出作業時用「C. 自行貼上」（或「E. 單元骨架」）直接貼文字稿，這些文字稿目前只
 * 綁在單一份作業的 raw_data 裡，不會流回教材庫。老師要的是「由下往上」：把這些已經貼過
 * 的文稿，掃出來、整理、匯出，供之後人工搬進 Excel／Layout 搭配工具，把教材補齊。
 *
 * 設計決定（老師 2026-08-08 選項）：
 * - 來源：C 自行貼上／D 資源／E 單元骨架 全部收（all_sources）
 * - 粒度：貼上模式常常一次貼好幾頁／好幾個 exercise 在同一個大文字框裡 → 先用「自動分段」
 *   （偵測 Page/Unit/Ex/#題號/【label】等標記，抓不到才 fallback 用空行分段），老師可在畫面上
 *   手動調整每一段的標籤／內容；配合 feature-timeline.js 新增的「➕ 增加視窗」，往後貼的內容
 *   會直接帶結構化 raw_data.paste_windows，這裡就不用再猜。
 * - 產出：老師明確說「不適合用 Excel，建議用 txt」→ 這裡只做「勾選＋匯出成 .txt」，不生成
 *   meta.json（那一步仍是老師人工把 txt 內容搬進 Excel，走既有「教材／Layout 搭配」產線）。
 * - 範圍：掃這位老師名下「所有班級」的「所有作業」（真正的「由下往上」，不是只看目前這個班）。
 *
 * 資料來源：window.TeacherDB.assignments（登入時已經整批載入，含 .tasks 遞迴樹）／
 * window.TeacherDB.classes（班級名稱對照）。這裡完全唯讀，不會回寫任何一份原始作業。
 */
window.FeatureScriptCollector = (function () {
    'use strict';

    const SOURCE_LABELS = {
        paste: 'C. 自行貼上',
        resource: 'D. 資源（PDF等）',
        skeleton: 'E. 單元骨架'
    };

    /** @type {Array<object>} 目前掃描到、可勾選的候選清單（含每筆目前的分段狀態，只存在記憶體） */
    let _candidates = [];
    let _classFilter = '';

    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function plainTitle(html) {
        return String(html || '').replace(/<[^>]*>?/gm, '').trim();
    }

    function formatDate(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleDateString('zh-TW'); } catch (_e) { return String(iso).slice(0, 10); }
    }

    /**
     * 自動分段：偵測「整段獨立一行」的標記（Page 2／Ex.3／Unit 5／#12~16／第3頁／【Page 2】），
     * 遇到標記就切一段新的；完全沒偵測到標記時，fallback 用「兩個以上換行」（空行）分段。
     * 這是 best-effort 的輔助，切錯／切太細都預期老師會在畫面上手動調整，不強求完美。
     */
    function autoSegmentText(text) {
        const t = String(text || '');
        if (!t.trim()) return [];
        const lines = t.split(/\r?\n/);
        const markerRe = /^\s*(?:[-•*]\s*)?(?:【([^】]+)】|((?:page|pp?\.?)\s*\d+[\d,~\-–、\s]*|unit\s*\d+|ex(?:ercise)?\.?\s*\d+|#\d+[\d,~\-–、\s]*|第\s*\d+\s*(?:頁|回|單元|課|篇)))\s*[:：]?\s*$/i;
        const segs = [];
        let current = null;
        lines.forEach(function (line) {
            const m = line.match(markerRe);
            if (m) {
                const label = (m[1] || m[2] || '').trim();
                current = { label: label, lines: [] };
                segs.push(current);
                return;
            }
            if (!current) { current = { label: '', lines: [] }; segs.push(current); }
            current.lines.push(line);
        });
        let result = segs
            .map(function (s) { return { label: s.label, text: s.lines.join('\n').trim() }; })
            .filter(function (s) { return s.text || s.label; });
        if (result.length <= 1) {
            const paragraphs = t.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
            if (paragraphs.length > 1) {
                result = paragraphs.map(function (p) { return { label: '', text: p }; });
            } else if (!result.length) {
                result = [{ label: '', text: t.trim() }];
            }
        }
        return result;
    }

    /** 給某一筆候選算出「初始分段」：有結構化資料就直接用，沒有才跑自動分段 */
    function computeInitialSegments(cand) {
        const raw = cand.rawData || {};
        if (cand.scriptSource === 'skeleton') {
            const units = Array.isArray(raw.grading_units) ? raw.grading_units : [];
            return units.map(function (u) {
                const label = u.label || (u.stem ? (u.stem + (Array.isArray(u.sub_path) && u.sub_path.length ? '/' + u.sub_path.join('/') : '')) : '');
                return { label: label || '', script: u.original_script || '', student: '' };
            });
        }
        if (cand.scriptSource === 'resource') return [];
        // paste：優先用結構化 paste_windows（新版「➕ 增加視窗」存的），沒有才對舊的整段文字跑自動分段
        if (Array.isArray(raw.paste_windows) && raw.paste_windows.length) {
            return raw.paste_windows.map(function (w) {
                return { label: (w && w.label) || '', script: (w && w.script) || '', student: (w && w.student) || '' };
            });
        }
        const scriptText = raw.original_script || '';
        const studentText = raw.student_display_text || raw.student_display || raw.student_text || '';
        const scriptSegs = autoSegmentText(scriptText);
        const studentSegs = autoSegmentText(studentText);
        const n = Math.max(scriptSegs.length, studentSegs.length, (scriptText || studentText) ? 1 : 0);
        const out = [];
        for (let i = 0; i < n; i++) {
            const sSeg = scriptSegs[i];
            const stSeg = studentSegs[i];
            out.push({
                label: (sSeg && sSeg.label) || (stSeg && stSeg.label) || '',
                script: sSeg ? sSeg.text : (i === 0 && scriptSegs.length <= 1 ? scriptText : ''),
                student: stSeg ? stSeg.text : (i === 0 && studentSegs.length <= 1 ? studentText : '')
            });
        }
        return out;
    }

    /** 遞迴掃 tasks 樹，找出 audio_record 且 script_source 為 paste/resource/skeleton 的節點 */
    function walkTasks(list, cls, assignment, out) {
        (list || []).forEach(function (node) {
            if (node && node.type === 'audio_record') {
                const raw = node.raw_data || {};
                const src = raw.script_source || '';
                if (src === 'paste' || src === 'resource' || src === 'skeleton') {
                    const cand = {
                        key: assignment.id + '_' + (node.id || Math.random().toString(36).slice(2)),
                        classId: assignment.class_id,
                        className: cls ? cls.name : ('班級 ' + (assignment.class_id || '?')),
                        assignmentId: assignment.id,
                        assignmentTitle: assignment.title || '(未命名作業)',
                        nodeTitle: plainTitle(node.title),
                        scriptSource: src,
                        rangeLabel: raw.material_range || '',
                        rawData: raw,
                        targetDate: assignment.target_date,
                        createdAt: assignment.created_at
                    };
                    cand.segments = computeInitialSegments(cand);
                    out.push(cand);
                }
            }
            if (node && Array.isArray(node.subTasks) && node.subTasks.length) {
                walkTasks(node.subTasks, cls, assignment, out);
            }
        });
    }

    function collectCandidates() {
        const classesById = {};
        (window.TeacherDB && window.TeacherDB.classes || []).forEach(function (c) { classesById[c.id] = c; });
        const out = [];
        (window.TeacherDB && window.TeacherDB.assignments || []).forEach(function (a) {
            const cls = classesById[a.class_id];
            const tasks = Array.isArray(a.tasks) ? a.tasks : (Array.isArray(a.raw_data && a.raw_data.tasks) ? a.raw_data.tasks : []);
            walkTasks(tasks, cls, a, out);
        });
        out.sort(function (x, y) {
            return new Date(y.targetDate || y.createdAt || 0) - new Date(x.targetDate || x.createdAt || 0);
        });
        return out;
    }

    function segmentRowHtml(key, segIdx, seg) {
        return `
            <div class="sc-seg-row" data-idx="${segIdx}" style="display:flex; gap:8px; align-items:flex-start; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px; margin-bottom:6px;">
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
                    <input type="text" class="form-control sc-seg-label" style="padding:5px; font-size:0.8rem; font-weight:800; color:#7C3AED; max-width:220px;" placeholder="標籤（如 Page 2／Ex.3）" value="${esc(seg.label)}">
                    <textarea class="form-control sc-seg-script" style="width:100%; min-height:52px; padding:6px; font-size:0.82rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="AI 批改文稿">${esc(seg.script)}</textarea>
                    <textarea class="form-control sc-seg-student" style="width:100%; min-height:40px; padding:6px; font-size:0.8rem; border-radius:6px; border:1px solid #E2E8F0; color:#475569;" placeholder="學生顯示文稿（若跟批改文稿不同才需要另外填）">${esc(seg.student)}</textarea>
                </div>
                <button type="button" class="btn sc-seg-del" style="padding:5px 7px; color:#B91C1C;" title="刪除此段">🗑</button>
            </div>`;
    }

    function cardHtml(cand) {
        const srcLabel = SOURCE_LABELS[cand.scriptSource] || cand.scriptSource;
        const rangeBadge = cand.rangeLabel ? `<span style="font-size:0.72rem; background:#FFFBEB; color:#92400E; padding:2px 8px; border-radius:999px; font-weight:800;">${esc(cand.rangeLabel)}</span>` : '';
        let bodyHtml;
        if (cand.scriptSource === 'resource') {
            const url = cand.rawData.student_drive_url || cand.rawData.material_url || '';
            const desc = cand.rawData.student_drive_desc || cand.rangeLabel || '';
            bodyHtml = `<div style="font-size:0.82rem; color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; padding:8px;">
                ⚠️ 這筆是「資源連結」，沒有文字稿可收集：${esc(desc)}
                ${url ? ` — <a href="${esc(url)}" target="_blank" rel="noopener">開啟連結</a>` : ''}
            </div>`;
        } else {
            const segsHtml = cand.segments.map(function (seg, idx) { return segmentRowHtml(cand.key, idx, seg); }).join('')
                || '<div style="font-size:0.8rem; color:#94A3B8;">（尚無文稿內容）</div>';
            bodyHtml = `
                <div class="sc-segs" id="sc-segs-${cand.key}">${segsHtml}</div>
                <div style="display:flex; gap:8px; margin-top:6px;">
                    <button type="button" class="btn sc-seg-add" style="font-size:0.78rem; padding:4px 10px; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">➕ 新增分段</button>
                    <button type="button" class="btn sc-seg-resplit" style="font-size:0.78rem; padding:4px 10px; background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:6px;">🔀 重新自動分段</button>
                    <button type="button" class="btn sc-card-copy" style="font-size:0.78rem; padding:4px 10px; background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; border-radius:6px;">📋 複製這筆</button>
                </div>`;
        }
        return `
            <div class="sc-card" data-key="${cand.key}" data-source="${cand.scriptSource}" style="background:white; border:2px solid #E2E8F0; border-radius:10px; padding:14px; margin-bottom:12px;">
                <div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
                    <input type="checkbox" class="sc-card-check" checked style="transform:scale(1.3); margin-top:4px;">
                    <div style="flex:1; min-width:200px;">
                        <div style="font-weight:900; color:#0F172A;">${esc(cand.className)} — ${esc(cand.assignmentTitle)}</div>
                        <div style="font-size:0.82rem; color:#64748B;">${esc(cand.nodeTitle || '(未命名節點)')} ・ ${formatDate(cand.targetDate || cand.createdAt)}</div>
                    </div>
                    <span style="font-size:0.72rem; background:#EEF2FF; color:#4338CA; padding:2px 8px; border-radius:999px; font-weight:800;">${esc(srcLabel)}</span>
                    ${rangeBadge}
                </div>
                ${bodyHtml}
            </div>`;
    }

    function paint(container) {
        const classesUsed = {};
        _candidates.forEach(function (c) { classesUsed[c.classId] = c.className; });
        const classOptionsHtml = Object.keys(classesUsed).map(function (id) {
            return `<option value="${esc(id)}" ${_classFilter === id ? 'selected' : ''}>${esc(classesUsed[id])}</option>`;
        }).join('');

        const visible = _classFilter ? _candidates.filter(function (c) { return c.classId === _classFilter; }) : _candidates;

        container.innerHTML = `
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <h3 style="margin:0 0 6px 0; color:var(--primary-dark);">📥 由下往上收集文稿</h3>
                <p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0; line-height:1.6;">
                    掃出您名下所有班級、所有作業裡「錄音」任務用「C. 自行貼上」／「D. 資源」／「E. 單元骨架」貼過的文字稿，
                    幫您自動依 Page／Unit／Ex／題號等標記先分段（抓不到標記才用空行分段，切錯請直接在下面調整）。
                    這裡完全唯讀，不會改到任何一份原始作業；勾選要用的段落，按下方「⬇️ 匯出成 txt」下載，
                    再自己搬進 Excel、跑「教材／Layout 搭配」補齊正式 meta。
                </p>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
                    <button type="button" id="sc-rescan" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#7C3AED; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;">🔄 重新掃描</button>
                    <select id="sc-class-filter" class="form-control" style="width:auto; padding:6px; font-size:0.85rem;">
                        <option value="">全部班級（共 ${_candidates.length} 筆）</option>
                        ${classOptionsHtml}
                    </select>
                    <button type="button" id="sc-select-all" class="btn" style="font-size:0.8rem; padding:5px 10px;">全選</button>
                    <button type="button" id="sc-select-none" class="btn" style="font-size:0.8rem; padding:5px 10px;">全不選</button>
                    <span style="flex:1;"></span>
                    <button type="button" id="sc-export" class="btn btn-primary" style="padding:8px 18px; font-weight:800;">⬇️ 匯出成 txt</button>
                </div>
                <div id="sc-status" style="font-size:0.8rem; color:#059669; min-height:1.2em;"></div>
            </div>
            <div id="sc-card-list">
                ${visible.length ? visible.map(cardHtml).join('') : '<div style="padding:30px; text-align:center; color:#94A3B8;">目前沒有偵測到符合條件的貼上／骨架／資源文稿。</div>'}
            </div>
        `;
        bindEvents(container);
    }

    function readSegmentsFromCard(cardEl) {
        return Array.prototype.map.call(cardEl.querySelectorAll('.sc-seg-row'), function (row) {
            return {
                label: (row.querySelector('.sc-seg-label') || {}).value || '',
                script: (row.querySelector('.sc-seg-script') || {}).value || '',
                student: (row.querySelector('.sc-seg-student') || {}).value || ''
            };
        });
    }

    function formatCardAsText(cardEl) {
        const key = cardEl.getAttribute('data-key');
        const cand = _candidates.find(function (c) { return c.key === key; });
        if (!cand) return '';
        const srcLabel = SOURCE_LABELS[cand.scriptSource] || cand.scriptSource;
        const lines = [];
        lines.push('=====================================================');
        lines.push('班級：' + cand.className);
        lines.push('作業：' + cand.assignmentTitle + (cand.targetDate ? '（' + formatDate(cand.targetDate) + '）' : ''));
        lines.push('節點／範圍：' + (cand.nodeTitle || '(未命名)') + (cand.rangeLabel ? '　base 範圍：' + cand.rangeLabel : ''));
        lines.push('來源：' + srcLabel);
        lines.push('=====================================================');
        if (cand.scriptSource === 'resource') {
            const url = cand.rawData.student_drive_url || cand.rawData.material_url || '';
            lines.push('⚠️ 資源連結（無文字稿）：' + (cand.rawData.student_drive_desc || cand.rangeLabel || ''));
            if (url) lines.push(url);
        } else {
            const segs = readSegmentsFromCard(cardEl);
            segs.forEach(function (seg, idx) {
                lines.push('');
                lines.push('【段 ' + (idx + 1) + (seg.label ? '：' + seg.label : '') + '】');
                if (seg.script) {
                    lines.push('--- AI 批改文稿 ---');
                    lines.push(seg.script);
                }
                if (seg.student && seg.student !== seg.script) {
                    lines.push('--- 學生顯示文稿 ---');
                    lines.push(seg.student);
                }
            });
        }
        lines.push('');
        return lines.join('\n');
    }

    function downloadTextFile(filename, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    function bindEvents(container) {
        const rescanBtn = container.querySelector('#sc-rescan');
        if (rescanBtn) rescanBtn.addEventListener('click', function () { render(); });

        const filterEl = container.querySelector('#sc-class-filter');
        if (filterEl) filterEl.addEventListener('change', function () { _classFilter = this.value || ''; paint(container); });

        const selAll = container.querySelector('#sc-select-all');
        if (selAll) selAll.addEventListener('click', function () {
            container.querySelectorAll('.sc-card-check').forEach(function (chk) { chk.checked = true; });
        });
        const selNone = container.querySelector('#sc-select-none');
        if (selNone) selNone.addEventListener('click', function () {
            container.querySelectorAll('.sc-card-check').forEach(function (chk) { chk.checked = false; });
        });

        const exportBtn = container.querySelector('#sc-export');
        if (exportBtn) exportBtn.addEventListener('click', function () {
            const checkedCards = Array.prototype.filter.call(container.querySelectorAll('.sc-card'), function (card) {
                const chk = card.querySelector('.sc-card-check');
                return chk && chk.checked;
            });
            if (!checkedCards.length) {
                const statusEl = container.querySelector('#sc-status');
                if (statusEl) statusEl.textContent = '⚠️ 請先勾選至少一筆';
                return;
            }
            const combined = checkedCards.map(formatCardAsText).join('\n\n');
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile('文稿收集_' + stamp + '.txt', combined);
            const statusEl = container.querySelector('#sc-status');
            if (statusEl) statusEl.textContent = '✅ 已匯出 ' + checkedCards.length + ' 筆到 txt';
        });

        container.querySelectorAll('.sc-card').forEach(function (cardEl) {
            const addBtn = cardEl.querySelector('.sc-seg-add');
            if (addBtn) addBtn.addEventListener('click', function () {
                const segsEl = cardEl.querySelector('.sc-segs');
                if (!segsEl) return;
                const idx = segsEl.querySelectorAll('.sc-seg-row').length;
                const wrapper = document.createElement('div');
                wrapper.innerHTML = segmentRowHtml(cardEl.getAttribute('data-key'), idx, { label: '', script: '', student: '' });
                segsEl.appendChild(wrapper.firstElementChild);
                bindSegRowDelete(segsEl.lastElementChild);
            });
            const resplitBtn = cardEl.querySelector('.sc-seg-resplit');
            if (resplitBtn) resplitBtn.addEventListener('click', function () {
                const key = cardEl.getAttribute('data-key');
                const cand = _candidates.find(function (c) { return c.key === key; });
                if (!cand) return;
                cand.segments = computeInitialSegments(cand);
                const segsEl = cardEl.querySelector('.sc-segs');
                if (segsEl) {
                    segsEl.innerHTML = cand.segments.map(function (seg, idx) { return segmentRowHtml(key, idx, seg); }).join('')
                        || '<div style="font-size:0.8rem; color:#94A3B8;">（尚無文稿內容）</div>';
                    segsEl.querySelectorAll('.sc-seg-row').forEach(bindSegRowDelete);
                }
            });
            const copyBtn = cardEl.querySelector('.sc-card-copy');
            if (copyBtn) copyBtn.addEventListener('click', function () {
                const text = formatCardAsText(cardEl);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        window.showFlash && window.showFlash('已複製這一筆文稿內容');
                    }).catch(function () {
                        window.showFlash && window.showFlash('複製失敗，請手動選取文字', 'error');
                    });
                }
            });
            cardEl.querySelectorAll('.sc-seg-row').forEach(bindSegRowDelete);
        });
    }

    function bindSegRowDelete(rowEl) {
        if (!rowEl || rowEl.dataset.delBound === '1') return;
        rowEl.dataset.delBound = '1';
        const delBtn = rowEl.querySelector('.sc-seg-del');
        if (delBtn) delBtn.addEventListener('click', function () { rowEl.remove(); });
    }

    function render() {
        const container = document.getElementById('script-collector-container');
        if (!container) return;
        container.innerHTML = '<div style="padding:30px; text-align:center; color:var(--primary); font-weight:800;">⏳ 掃描中…</div>';
        // TeacherDB.assignments 是登入時已整批載入的資料（見 page-refresh-perf-invariant），
        // 這裡純讀取記憶體、不會另外打 API，掃描全班全作業也不會拖慢重整。
        setTimeout(function () {
            _candidates = collectCandidates();
            paint(container);
        }, 0);
    }

    return {
        render: render
    };
})();

/**
 * 📂 檔案路徑：110_teacher_core/feature-script-collector.js
 * 🎯 職責：「📥 由下往上收集文稿」——教材／meta 的另一個資料來源方向。
 *
 * 掃描作業文稿（C／D／E）不回寫原始作業。
 * 排列：班級 → 教材區塊（跨日期）→ 區塊內按進度日期。
 * 搬入＝複製一份進 class_script_block_items，並記下來源鑰匙。
 */
window.FeatureScriptCollector = (function () {
    'use strict';

    const SOURCE_LABELS = {
        paste: 'C. 自行貼上',
        resource: 'D. 資源（PDF等）',
        skeleton: 'E. 單元骨架'
    };
    const BLOCK_MODAL_ID = 'sc-block-form';

    let _candidates = [];
    let _blocksByClass = {};
    let _itemsByClass = {};
    let _cardsByKey = {};
    let _status = '';

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

    function dateKey(iso) {
        const s = String(iso || '').trim();
        if (!s) return '';
        return s.slice(0, 10);
    }

    function dateGroupLabel(key) {
        return key ? formatDate(key + 'T00:00:00') : '未設定進度日';
    }

    function uuidKey(id) {
        return String(id || '').trim().toLowerCase();
    }

    function sourceKey(assignmentId, taskId) {
        const a = uuidKey(assignmentId);
        const t = String(taskId || '').trim();
        if (!a || !t) return '';
        return a + '|' + t;
    }

    function client() {
        return window.supabaseClient || null;
    }

    function dbErr(err) {
        const msg = String((err && err.message) || err || '');
        if (msg.indexOf('schema cache') !== -1 || /Could not find the table .*class_script_block/.test(msg)) {
            return '教材區塊表尚未就緒。請等幾秒再存一次；若一直失敗，請先跑 migration 20260824140000_class_script_blocks.sql';
        }
        return msg;
    }

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

    function normalizeSeg(seg) {
        seg = seg || {};
        return {
            label: seg.label || '',
            unit: seg.unit || '',
            section: seg.section || '',
            subsection: seg.subsection || '',
            page: seg.page || '',
            script: seg.script || '',
            student: seg.student || ''
        };
    }

    function missingInner(segs) {
        return '';
    }

    function computeInitialSegments(cand) {
        const raw = cand.rawData || {};
        if (cand.scriptSource === 'skeleton') {
            const units = Array.isArray(raw.grading_units) ? raw.grading_units : [];
            return units.map(function (u) {
                const label = u.label || (u.stem ? (u.stem + (Array.isArray(u.sub_path) && u.sub_path.length ? '/' + u.sub_path.join('/') : '')) : '');
                return normalizeSeg({ label: label || '', script: u.original_script || '', student: '' });
            });
        }
        if (cand.scriptSource === 'resource') return [];
        if (Array.isArray(raw.paste_windows) && raw.paste_windows.length) {
            return raw.paste_windows.map(function (w) {
                return normalizeSeg({ label: (w && w.label) || '', script: (w && w.script) || '', student: (w && w.student) || '' });
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
            out.push(normalizeSeg({
                label: (sSeg && sSeg.label) || (stSeg && stSeg.label) || '',
                script: sSeg ? sSeg.text : (i === 0 && scriptSegs.length <= 1 ? scriptText : ''),
                student: stSeg ? stSeg.text : (i === 0 && studentSegs.length <= 1 ? studentText : '')
            }));
        }
        return out;
    }

    function walkTasks(list, cls, assignment, out) {
        (list || []).forEach(function (node) {
            if (node && node.type === 'audio_record') {
                const raw = node.raw_data || {};
                const src = raw.script_source || '';
                if (src === 'paste' || src === 'resource' || src === 'skeleton') {
                    const taskId = String((node && node.id) || '').trim();
                    const cand = {
                        key: sourceKey(assignment.id, taskId) || (String(assignment.id) + '|_'),
                        classId: assignment.class_id,
                        className: cls ? cls.name : ('班級 ' + (assignment.class_id || '?')),
                        assignmentId: assignment.id,
                        taskId: taskId,
                        assignmentTitle: assignment.title || '(未命名作業)',
                        nodeTitle: plainTitle(node.title),
                        scriptSource: src,
                        rangeLabel: raw.material_range || '',
                        rawData: raw,
                        targetDate: assignment.target_date,
                        createdAt: assignment.created_at,
                        canMove: !!sourceKey(assignment.id, taskId)
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
        (window.TeacherDB && window.TeacherDB.classes || []).forEach(function (c) {
            if (c && c.id != null) classesById[String(c.id)] = c;
        });
        const out = [];
        (window.TeacherDB && window.TeacherDB.assignments || []).forEach(function (a) {
            const cls = a && a.class_id != null ? classesById[String(a.class_id)] : null;
            if (!cls) return;
            const tasks = Array.isArray(a.tasks) ? a.tasks : (Array.isArray(a.raw_data && a.raw_data.tasks) ? a.raw_data.tasks : []);
            walkTasks(tasks, cls, a, out);
        });
        return out;
    }

    function listTeacherClasses() {
        return (window.TeacherDB && window.TeacherDB.classes) ? window.TeacherDB.classes.slice() : [];
    }

    async function loadBlocks() {
        _blocksByClass = {};
        _itemsByClass = {};
        const classes = listTeacherClasses();
        const allowed = {};
        classes.forEach(function (c) {
            const k = uuidKey(c.id);
            if (!k) return;
            allowed[k] = true;
            _blocksByClass[k] = [];
            _itemsByClass[k] = [];
        });
        const sb = client();
        if (!sb || !Object.keys(allowed).length) return;
        const { data: blocks, error: bErr } = await sb
            .from('class_script_blocks')
            .select('id, class_id, label, sort_order')
            .order('sort_order', { ascending: true });
        if (bErr) throw bErr;
        (blocks || []).forEach(function (b) {
            const k = uuidKey(b.class_id);
            if (!allowed[k]) return;
            _blocksByClass[k].push(b);
        });
        const blockIds = [];
        Object.keys(_blocksByClass).forEach(function (k) {
            (_blocksByClass[k] || []).forEach(function (b) {
                if (b && b.id) blockIds.push(b.id);
            });
        });
        if (!blockIds.length) return;
        const { data: items, error: iErr } = await sb
            .from('class_script_block_items')
            .select('id, block_id, class_id, progress_date, source_assignment_id, source_task_id, snapshot')
            .in('block_id', blockIds);
        if (iErr) throw iErr;
        (items || []).forEach(function (it) {
            const k = uuidKey(it.class_id);
            if (!allowed[k]) return;
            _itemsByClass[k].push(it);
        });
    }

    function blocksOf(classId) {
        return _blocksByClass[uuidKey(classId)] || [];
    }

    function itemsOf(classId) {
        return _itemsByClass[uuidKey(classId)] || [];
    }

    function filedKeySet(classId) {
        const set = {};
        itemsOf(classId).forEach(function (it) {
            const k = sourceKey(it.source_assignment_id, it.source_task_id);
            if (k) set[k] = true;
        });
        return set;
    }

    function isCandFiled(filed, cand) {
        if (!cand) return false;
        if (filed[cand.key]) return true;
        const k = sourceKey(cand.assignmentId, cand.taskId);
        return !!(k && filed[k]);
    }

    function itemToCard(it, className) {
        const snap = (it && it.snapshot && typeof it.snapshot === 'object') ? it.snapshot : {};
        const segs = (Array.isArray(snap.segments) ? snap.segments : []).map(normalizeSeg);
        return {
            key: 'item:' + it.id,
            itemId: it.id,
            filed: true,
            classId: it.class_id,
            className: className || '',
            assignmentId: it.source_assignment_id,
            taskId: it.source_task_id,
            assignmentTitle: snap.assignmentTitle || '(未命名作業)',
            nodeTitle: snap.nodeTitle || '',
            scriptSource: snap.scriptSource || 'paste',
            rangeLabel: snap.rangeLabel || '',
            rawData: {
                student_drive_url: snap.resourceUrl || '',
                material_url: snap.resourceUrl || '',
                student_drive_desc: snap.resourceDesc || ''
            },
            segments: segs,
            targetDate: it.progress_date || '',
            canMove: true
        };
    }

    function snapshotFromCand(cand, segs) {
        const raw = (cand && cand.rawData) || {};
        return {
            segments: segs || cand.segments || [],
            assignmentTitle: cand.assignmentTitle || '',
            nodeTitle: cand.nodeTitle || '',
            scriptSource: cand.scriptSource || '',
            rangeLabel: cand.rangeLabel || '',
            resourceUrl: raw.student_drive_url || raw.material_url || '',
            resourceDesc: raw.student_drive_desc || cand.rangeLabel || ''
        };
    }

    async function createBlock(classId, label) {
        const name = String(label || '').trim();
        if (!name) throw new Error('請填區塊名稱');
        const sb = client();
        if (!sb) throw new Error('資料庫尚未連線');
        const existing = blocksOf(classId);
        const sort = existing.length ? (Number(existing[existing.length - 1].sort_order) || 0) + 1 : 0;
        const { data, error } = await sb
            .from('class_script_blocks')
            .insert({ class_id: classId, label: name, sort_order: sort })
            .select('id, class_id, label, sort_order')
            .single();
        if (error) throw error;
        return data;
    }

    async function renameBlock(blockId, label) {
        const name = String(label || '').trim();
        if (!name) throw new Error('請填區塊名稱');
        const sb = client();
        if (!sb) throw new Error('資料庫尚未連線');
        const { error } = await sb.from('class_script_blocks').update({ label: name }).eq('id', blockId);
        if (error) throw error;
    }

    async function deleteBlock(blockId) {
        const sb = client();
        if (!sb) throw new Error('資料庫尚未連線');
        const { error } = await sb.from('class_script_blocks').delete().eq('id', blockId);
        if (error) throw error;
    }

    async function moveCandToBlock(cand, segs, blockId, classId) {
        const key = sourceKey(cand.assignmentId, cand.taskId);
        if (!key) throw new Error('這筆沒有作業／任務 id，不能搬入');
        if (uuidKey(cand.classId) !== uuidKey(classId)) throw new Error('不能跨班搬入');
        const blocks = blocksOf(classId);
        const hit = blocks.find(function (b) { return String(b.id) === String(blockId); });
        if (!hit) throw new Error('請選這一班的區塊');
        const miss = missingInner(segs);
        if (miss) throw new Error(miss);
        const sb = client();
        if (!sb) throw new Error('資料庫尚未連線');
        const payload = {
            block_id: blockId,
            class_id: classId,
            progress_date: dateKey(cand.targetDate) || null,
            source_assignment_id: cand.assignmentId,
            source_task_id: cand.taskId,
            snapshot: snapshotFromCand(cand, segs)
        };
        const existing = itemsOf(classId).find(function (it) {
            return sourceKey(it.source_assignment_id, it.source_task_id) === key;
        });
        if (existing) {
            const { error } = await sb.from('class_script_block_items').update({
                block_id: blockId,
                progress_date: payload.progress_date,
                snapshot: payload.snapshot
            }).eq('id', existing.id);
            if (error) throw error;
            return;
        }
        const { error } = await sb.from('class_script_block_items').insert(payload);
        if (error) throw error;
    }

    async function persistFiledCard(cardEl, opts) {
        const itemId = cardEl.getAttribute('data-item-id');
        if (!itemId) return;
        const sb = client();
        if (!sb) return;
        const key = cardEl.getAttribute('data-key');
        const cand = _cardsByKey[key];
        if (!cand) return;
        const segs = readSegmentsFromCard(cardEl);
        if (opts && opts.requireInner) {
            const miss = missingInner(segs);
            if (miss) throw new Error(miss);
        }
        cand.segments = segs;
        const { error } = await sb.from('class_script_block_items').update({
            snapshot: snapshotFromCand(cand, segs)
        }).eq('id', itemId);
        if (error) throw error;
    }

    function groupByProgressDate(list) {
        const buckets = {};
        const order = [];
        (list || []).forEach(function (c) {
            const k = dateKey(c.targetDate);
            if (!buckets[k]) {
                buckets[k] = [];
                order.push(k);
            }
            buckets[k].push(c);
        });
        order.sort(function (a, b) {
            if (!a) return 1;
            if (!b) return -1;
            return b.localeCompare(a);
        });
        return order.map(function (k) { return { dateKey: k, items: buckets[k] }; });
    }

    function cardInnerKeys(card) {
        const segs = Array.isArray(card && card.segments) ? card.segments : [];
        const s = segs[0] || {};
        return {
            unit: String(s.unit || '').trim(),
            section: String(s.section || '').trim(),
            sub: String(s.subsection || '').trim()
        };
    }

    function bookCardsHtml(list, classId, currentBlockId) {
        const cards = (list || []).slice();
        if (!cards.length) return '<div style="font-size:0.8rem; color:#94A3B8; padding:8px 0;">（沒有文稿）</div>';
        cards.sort(function (a, b) {
            const ka = cardInnerKeys(a);
            const kb = cardInnerKeys(b);
            const ua = ka.unit || '\uffff';
            const ub = kb.unit || '\uffff';
            if (ua !== ub) return ua.localeCompare(ub, 'zh-Hant');
            const sa = ka.section || '\uffff';
            const sb = kb.section || '\uffff';
            if (sa !== sb) return sa.localeCompare(sb, 'zh-Hant');
            const suba = ka.sub;
            const subb = kb.sub;
            if (suba !== subb) return suba.localeCompare(subb, 'zh-Hant');
            const da = dateKey(a.targetDate);
            const db = dateKey(b.targetDate);
            if (!da && db) return 1;
            if (da && !db) return -1;
            return db.localeCompare(da);
        });
        let html = '';
        let lastU = null;
        let lastS = null;
        let lastSub = null;
        let lastD = null;
        cards.forEach(function (c) {
            const k = cardInnerKeys(c);
            if (k.unit !== lastU) {
                lastU = k.unit;
                lastS = null;
                lastSub = null;
                lastD = null;
                html += '<div style="font-size:0.86rem; font-weight:900; color:#1E3A8A; margin:12px 0 6px;">📘 ' + esc(k.unit ? ('大題 ' + k.unit) : '未填大題') + '</div>';
            }
            if (k.section !== lastS) {
                lastS = k.section;
                lastSub = null;
                lastD = null;
                html += '<div style="font-size:0.82rem; font-weight:800; color:#334155; margin:8px 0 4px 10px;">📝 ' + esc(k.section ? ('次題 ' + k.section) : '未填次題') + '</div>';
            }
            if (k.sub) {
                if (k.sub !== lastSub) {
                    lastSub = k.sub;
                    lastD = null;
                    html += '<div style="font-size:0.78rem; font-weight:800; color:#64748B; margin:6px 0 4px 20px;">▫️ 小題 ' + esc(k.sub) + '</div>';
                }
            } else {
                lastSub = '';
            }
            const d = dateKey(c.targetDate);
            if (d !== lastD) {
                lastD = d;
                html += '<div style="font-size:0.78rem; font-weight:800; color:#64748B; margin:6px 0 4px 20px;">📅 ' + esc(dateGroupLabel(d)) + '</div>';
            }
            html += cardHtml(c, classId, currentBlockId);
        });
        return html;
    }

    function segmentRowHtml(key, segIdx, seg) {
        seg = normalizeSeg(seg);
        return `
            <div class="sc-seg-row" data-idx="${segIdx}" style="display:flex; gap:8px; align-items:flex-start; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:8px; margin-bottom:6px;">
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
                    <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:6px;">
                        <label style="font-size:0.72rem; font-weight:800; color:#334155;">大題
                            <input type="text" class="form-control sc-seg-unit" style="width:100%; padding:5px; font-size:0.8rem; font-weight:800; color:#1E3A8A;" placeholder="這次填到哪由老師定" value="${esc(seg.unit)}">
                        </label>
                        <label style="font-size:0.72rem; font-weight:800; color:#334155;">次題
                            <input type="text" class="form-control sc-seg-section" style="width:100%; padding:5px; font-size:0.8rem; font-weight:800; color:#1E3A8A;" placeholder="可空" value="${esc(seg.section)}">
                        </label>
                        <label style="font-size:0.72rem; font-weight:800; color:#334155;">小題
                            <input type="text" class="form-control sc-seg-sub" style="width:100%; padding:5px; font-size:0.8rem;" placeholder="可空" value="${esc(seg.subsection)}">
                        </label>
                        <label style="font-size:0.72rem; font-weight:800; color:#334155;">頁碼
                            <input type="text" class="form-control sc-seg-page" style="width:100%; padding:5px; font-size:0.8rem;" placeholder="可空" value="${esc(seg.page)}">
                        </label>
                    </div>
                    <input type="text" class="form-control sc-seg-label" style="padding:5px; font-size:0.8rem; font-weight:800; color:#7C3AED; max-width:220px;" placeholder="標籤（如 Page 2／Ex.3）" value="${esc(seg.label)}">
                    <textarea class="form-control sc-seg-script" style="width:100%; min-height:52px; padding:6px; font-size:0.82rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="口說答案">${esc(seg.script)}</textarea>
                    <textarea class="form-control sc-seg-student" style="width:100%; min-height:40px; padding:6px; font-size:0.8rem; border-radius:6px; border:1px solid #E2E8F0; color:#475569;" placeholder="書寫答案（若跟口說答案不同才需要另外填）">${esc(seg.student)}</textarea>
                </div>
                <button type="button" class="btn sc-seg-del" style="padding:5px 7px; color:#B91C1C;" title="刪除此段">🗑</button>
            </div>`;
    }

    function moveSelectHtml(classId, cand, currentBlockId) {
        const blocks = blocksOf(classId);
        if (!cand.canMove) {
            return '<span style="font-size:0.75rem; color:#94A3B8;">沒有任務 id，不能搬入</span>';
        }
        if (!blocks.length) {
            return '<span style="font-size:0.75rem; color:#94A3B8;">請先新增教材區塊</span>';
        }
        const opts = blocks.map(function (b) {
            const sel = String(b.id) === String(currentBlockId || '') ? ' selected' : '';
            return '<option value="' + esc(b.id) + '"' + sel + '>' + esc(b.label || '（未命名）') + '</option>';
        }).join('');
        const verb = currentBlockId ? '改區塊' : '搬入';
        return '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">'
            + '<select class="form-control sc-move-block" style="width:auto; padding:4px 8px; font-size:0.8rem;">'
            + '<option value="">' + verb + '…</option>'
            + opts
            + '</select>'
            + '<button type="button" class="btn sc-move-go" style="font-size:0.78rem; padding:4px 10px; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">確定</button>'
            + '</div>';
    }

    function cardHtml(cand, classId, currentBlockId) {
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
                <div class="sc-segs" id="sc-segs-${esc(cand.key)}">${segsHtml}</div>
                <div style="display:flex; gap:8px; margin-top:6px; flex-wrap:wrap;">
                    <button type="button" class="btn sc-seg-add" style="font-size:0.78rem; padding:4px 10px; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">➕ 新增分段</button>
                    ${cand.filed ? '' : '<button type="button" class="btn sc-seg-resplit" style="font-size:0.78rem; padding:4px 10px; background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; border-radius:6px;">🔀 重新自動分段</button>'}
                    <button type="button" class="btn sc-card-copy" style="font-size:0.78rem; padding:4px 10px; background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; border-radius:6px;">📋 複製這筆</button>
                    ${cand.filed ? '<button type="button" class="btn sc-card-save" style="font-size:0.78rem; padding:4px 10px; background:#2563EB; color:white; border:none; border-radius:6px; font-weight:800;">儲存這筆</button><span class="sc-card-save-status" style="font-size:0.78rem; color:#059669; font-weight:800;"></span>' : ''}
                </div>`;
        }
        _cardsByKey[cand.key] = cand;
        return `
            <div class="sc-card" data-key="${esc(cand.key)}" data-source="${esc(cand.scriptSource)}" data-class="${esc(classId)}" data-filed="${cand.filed ? '1' : '0'}"${cand.itemId ? ' data-item-id="' + esc(cand.itemId) + '"' : ''} style="background:white; border:2px solid #E2E8F0; border-radius:10px; padding:14px; margin-bottom:12px;">
                <div style="display:flex; align-items:flex-start; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
                    <input type="checkbox" class="sc-card-check" checked style="transform:scale(1.3); margin-top:4px;">
                    <div style="flex:1; min-width:200px;">
                        <div style="font-weight:900; color:#0F172A;">${esc(cand.assignmentTitle)}</div>
                        <div style="font-size:0.82rem; color:#64748B;">${esc(cand.nodeTitle || '(未命名節點)')}</div>
                    </div>
                    <span style="font-size:0.72rem; background:#EEF2FF; color:#4338CA; padding:2px 8px; border-radius:999px; font-weight:800;">${esc(srcLabel)}</span>
                    ${rangeBadge}
                </div>
                ${bodyHtml}
                <div style="margin-top:8px;">${moveSelectHtml(classId, cand, currentBlockId)}</div>
            </div>`;
    }

    function dateGroupsHtml(groups, classId, currentBlockId) {
        if (!groups.length) return '<div style="font-size:0.8rem; color:#94A3B8; padding:8px 0;">（沒有文稿）</div>';
        return groups.map(function (g) {
            return '<div style="margin-bottom:10px;">'
                + '<div style="font-size:0.78rem; font-weight:800; color:#64748B; margin:8px 0 6px;">📅 ' + esc(dateGroupLabel(g.dateKey)) + '</div>'
                + g.items.map(function (c) { return cardHtml(c, classId, currentBlockId); }).join('')
                + '</div>';
        }).join('');
    }

    function classPanelHtml(cls) {
        const classId = cls.id;
        const className = cls.name || ('班級 ' + classId);
        const blocks = blocksOf(classId);
        const items = itemsOf(classId);
        const filed = filedKeySet(classId);
        const unfiled = _candidates.filter(function (c) {
            return uuidKey(c.classId) === uuidKey(classId) && !isCandFiled(filed, c);
        });
        const blockHtml = blocks.map(function (b) {
            const mine = items.filter(function (it) { return String(it.block_id) === String(b.id); })
                .map(function (it) { return itemToCard(it, className); });
            return '<div class="sc-block" data-block-id="' + esc(b.id) + '" data-class="' + esc(classId) + '" style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:10px; padding:12px; margin-bottom:12px;">'
                + '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px;">'
                + '<div style="font-weight:900; color:#1E3A8A; flex:1;">📦 ' + esc(b.label || '（未命名）') + '</div>'
                + '<button type="button" class="btn sc-block-rename" style="font-size:0.78rem; padding:4px 10px;">改名</button>'
                + '<button type="button" class="btn sc-block-del" style="font-size:0.78rem; padding:4px 10px; color:#B91C1C;">刪區塊</button>'
                + '</div>'
                + bookCardsHtml(mine, classId, b.id)
                + '</div>';
        }).join('');
        return '<div class="sc-class" data-class="' + esc(classId) + '" style="background:white; padding:16px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">'
            + '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">'
            + '<h3 style="margin:0; color:var(--primary-dark); flex:1;">🏫 ' + esc(className) + '</h3>'
            + '<button type="button" class="btn sc-block-add" style="font-size:0.82rem; padding:5px 12px; background:#2563EB; color:white; border:none; border-radius:6px; font-weight:800;">＋ 新增教材區塊</button>'
            + '</div>'
            + (blockHtml || '<div style="font-size:0.8rem; color:#94A3B8; margin-bottom:10px;">尚未建立教材區塊。</div>')
            + (unfiled.length
                ? '<div style="font-weight:800; color:#334155; margin:12px 0 6px;">尚未搬入</div>' + dateGroupsHtml(groupByProgressDate(unfiled), classId, '')
                : '')
            + '</div>';
    }

    function paint(container) {
        _cardsByKey = {};
        const classes = listTeacherClasses();
        container.innerHTML = `
            <div style="background:white; padding:20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">
                <h3 style="margin:0 0 6px 0; color:var(--primary-dark);">📥 由下往上收集文稿</h3>
                <p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0; line-height:1.6;">
                    目錄套餐在教材範本管理獨立區塊新增、教材區顯示已有卡，跟 Excel/JSON／PDF 同階層。出作業選書＋填大題／次題／小題＝收集成書（有文稿才寫 txt 進該教材資料夾）。
                    下面班級區仍可掃描 C／D／E 文稿。三層都提供，這次填到哪由老師定。不改原始作業。
                </p>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
                    <button type="button" id="sc-rescan" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#7C3AED; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;">🔄 重新掃描</button>
                    <button type="button" id="sc-select-all" class="btn" style="font-size:0.8rem; padding:5px 10px;">全選</button>
                    <button type="button" id="sc-select-none" class="btn" style="font-size:0.8rem; padding:5px 10px;">全不選</button>
                    <span style="flex:1;"></span>
                    <button type="button" id="sc-export" class="btn btn-primary" style="padding:8px 18px; font-weight:800;">⬇️ 匯出成 txt</button>
                </div>
                <div id="sc-status" style="font-size:0.8rem; color:#059669; min-height:1.2em;">${esc(_status)}</div>
            </div>
            ${(window.FeatureMaterialBook && typeof window.FeatureMaterialBook.renderCollectorHtml === 'function') ? window.FeatureMaterialBook.renderCollectorHtml() : ''}
            <div id="sc-class-list">
                ${classes.length ? classes.map(classPanelHtml).join('') : '<div style="padding:30px; text-align:center; color:#94A3B8;">沒有班級。</div>'}
            </div>
        `;
        bindEvents(container);
    }

    function readSegmentsFromCard(cardEl) {
        return Array.prototype.map.call(cardEl.querySelectorAll('.sc-seg-row'), function (row) {
            return normalizeSeg({
                label: (row.querySelector('.sc-seg-label') || {}).value || '',
                unit: (row.querySelector('.sc-seg-unit') || {}).value || '',
                section: (row.querySelector('.sc-seg-section') || {}).value || '',
                subsection: (row.querySelector('.sc-seg-sub') || {}).value || '',
                page: (row.querySelector('.sc-seg-page') || {}).value || '',
                script: (row.querySelector('.sc-seg-script') || {}).value || '',
                student: (row.querySelector('.sc-seg-student') || {}).value || ''
            });
        });
    }

    function formatCardAsText(cardEl) {
        const key = cardEl.getAttribute('data-key');
        const cand = _cardsByKey[key];
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
                if (seg.unit) lines.push('大題：' + seg.unit);
                if (seg.section) lines.push('次題：' + seg.section);
                if (seg.subsection) lines.push('小題：' + seg.subsection);
                if (seg.page) lines.push('頁碼：' + seg.page);
                if (seg.script) {
                    lines.push('--- 口說答案 ---');
                    lines.push(seg.script);
                }
                if (seg.student && seg.student !== seg.script) {
                    lines.push('--- 書寫答案 ---');
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

    function setStatus(container, msg, isErr) {
        _status = msg || '';
        const statusEl = container.querySelector('#sc-status');
        if (statusEl) {
            statusEl.style.color = isErr ? '#B91C1C' : '#059669';
            statusEl.textContent = _status;
        }
    }

    function setCardSaveState(cardEl, msg, isErr) {
        if (!cardEl) return;
        const el = cardEl.querySelector('.sc-card-save-status');
        if (!el) return;
        el.style.color = isErr ? '#B91C1C' : '#059669';
        el.textContent = msg || '';
    }

    function persistIfFiled(cardEl) {
        if (!cardEl || cardEl.getAttribute('data-filed') !== '1') return;
        setCardSaveState(cardEl, '儲存中…');
        persistFiledCard(cardEl).then(function () {
            setCardSaveState(cardEl, '已儲存');
        }).catch(function (err) {
            const container = document.getElementById('script-collector-container');
            setCardSaveState(cardEl, '儲存失敗：' + dbErr(err), true);
            if (container) setStatus(container, '儲存複本失敗：' + dbErr(err), true);
        });
    }

    function openBlockNameModal(opts) {
        const title = opts.title || '教材區塊';
        const initial = String(opts.initial || '');
        let started = initial;
        const html = '<div class="modal-panel" style="background:white; border-radius:12px; padding:20px; max-width:420px; width:100%;">'
            + '<h3 style="margin:0 0 12px; color:#1E3A8A;">' + esc(title) + '</h3>'
            + '<input id="sc-block-name" type="text" class="form-control" style="width:100%; padding:8px; box-sizing:border-box;" value="' + esc(initial) + '" placeholder="區塊名稱">'
            + '<div id="sc-block-form-err" style="min-height:1.2em; margin-top:8px; color:#B91C1C; font-weight:800; font-size:0.82rem;"></div>'
            + '<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">'
            + '<button type="button" class="btn" id="sc-block-cancel">取消</button>'
            + '<button type="button" class="btn btn-primary" id="sc-block-save" style="font-weight:800;">儲存</button>'
            + '</div></div>';
        window.ModalOverlay.open({
            id: BLOCK_MODAL_ID,
            tier: 'B',
            prompt: true,
            contentHtml: html,
            isDirty: function () {
                const el = document.getElementById('sc-block-name');
                return !!(el && String(el.value || '') !== started);
            },
            onMount: function (overlay) {
                const input = overlay.querySelector('#sc-block-name');
                const saveBtn = overlay.querySelector('#sc-block-save');
                const cancelBtn = overlay.querySelector('#sc-block-cancel');
                const errEl = overlay.querySelector('#sc-block-form-err');
                if (input) input.focus();
                if (cancelBtn) cancelBtn.addEventListener('click', function () {
                    window.ModalOverlay.requestClose(BLOCK_MODAL_ID);
                });
                if (saveBtn) saveBtn.addEventListener('click', async function () {
                    const name = input ? String(input.value || '').trim() : '';
                    window.ModalOverlay.setBusy(BLOCK_MODAL_ID, true);
                    saveBtn.textContent = '儲存中…';
                    saveBtn.disabled = true;
                    try {
                        await opts.onSave(name);
                        started = name;
                        window.ModalOverlay.close(BLOCK_MODAL_ID);
                    } catch (err) {
                        window.ModalOverlay.setBusy(BLOCK_MODAL_ID, false);
                        saveBtn.textContent = '儲存';
                        saveBtn.disabled = false;
                        if (errEl) errEl.textContent = '儲存失敗：' + dbErr(err);
                    }
                });
            }
        });
    }

    async function refreshAndPaint(container) {
        _candidates = collectCandidates();
        await loadBlocks();
        if (window.FeatureMaterialBook && typeof window.FeatureMaterialBook.ensureLoaded === 'function') {
            await window.FeatureMaterialBook.ensureLoaded();
        }
        paint(container);
    }

    function bindEvents(container) {
        const rescanBtn = container.querySelector('#sc-rescan');
        if (rescanBtn) rescanBtn.addEventListener('click', function () { render(); });

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
                setStatus(container, '⚠️ 請先勾選至少一筆', true);
                return;
            }
            const combined = checkedCards.map(formatCardAsText).join('\n\n');
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile('文稿收集_' + stamp + '.txt', combined);
            setStatus(container, '✅ 已匯出 ' + checkedCards.length + ' 筆到 txt');
        });

        container.querySelectorAll('.sc-block-add').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const panel = btn.closest('.sc-class');
                const classId = panel ? panel.getAttribute('data-class') : '';
                if (!classId) return;
                openBlockNameModal({
                    title: '新增教材區塊',
                    initial: '',
                    onSave: async function (name) {
                        await createBlock(classId, name);
                        await refreshAndPaint(container);
                    }
                });
            });
        });

        container.querySelectorAll('.sc-block-rename').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const blockEl = btn.closest('.sc-block');
                const blockId = blockEl ? blockEl.getAttribute('data-block-id') : '';
                const classId = blockEl ? blockEl.getAttribute('data-class') : '';
                const cur = (blocksOf(classId).find(function (b) { return String(b.id) === String(blockId); }) || {}).label || '';
                if (!blockId) return;
                openBlockNameModal({
                    title: '區塊改名',
                    initial: cur,
                    onSave: async function (name) {
                        await renameBlock(blockId, name);
                        await refreshAndPaint(container);
                    }
                });
            });
        });

        container.querySelectorAll('.sc-block-del').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const blockEl = btn.closest('.sc-block');
                const blockId = blockEl ? blockEl.getAttribute('data-block-id') : '';
                if (!blockId) return;
                const ok = await window.ModalOverlay.confirm('刪掉這個區塊後，裡面已搬入的文稿複本也會一起刪。原始作業不會改。確定刪？');
                if (!ok) return;
                try {
                    await deleteBlock(blockId);
                    await refreshAndPaint(container);
                } catch (err) {
                    setStatus(container, '刪除失敗：' + dbErr(err), true);
                }
            });
        });

        container.querySelectorAll('.sc-card').forEach(function (cardEl) {
            const addBtn = cardEl.querySelector('.sc-seg-add');
            if (addBtn) addBtn.addEventListener('click', function () {
                const segsEl = cardEl.querySelector('.sc-segs');
                if (!segsEl) return;
                const idx = segsEl.querySelectorAll('.sc-seg-row').length;
                const wrapper = document.createElement('div');
                wrapper.innerHTML = segmentRowHtml(cardEl.getAttribute('data-key'), idx, normalizeSeg({}));
                segsEl.appendChild(wrapper.firstElementChild);
                bindSegRowDelete(segsEl.lastElementChild);
                persistIfFiled(cardEl);
            });
            const resplitBtn = cardEl.querySelector('.sc-seg-resplit');
            if (resplitBtn) resplitBtn.addEventListener('click', function () {
                const key = cardEl.getAttribute('data-key');
                const cand = _cardsByKey[key];
                if (!cand || cand.filed) return;
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
            const saveBtn = cardEl.querySelector('.sc-card-save');
            if (saveBtn) saveBtn.addEventListener('click', async function () {
                saveBtn.disabled = true;
                saveBtn.textContent = '儲存中…';
                setCardSaveState(cardEl, '儲存中…');
                try {
                    await persistFiledCard(cardEl, { requireInner: true });
                    setCardSaveState(cardEl, '已儲存');
                    setStatus(container, '已儲存這筆複本');
                } catch (err) {
                    setCardSaveState(cardEl, '儲存失敗：' + dbErr(err), true);
                    setStatus(container, '儲存複本失敗：' + dbErr(err), true);
                }
                saveBtn.disabled = false;
                saveBtn.textContent = '儲存這筆';
            });
            const goBtn = cardEl.querySelector('.sc-move-go');
            if (goBtn) goBtn.addEventListener('click', async function () {
                const sel = cardEl.querySelector('.sc-move-block');
                const blockId = sel ? String(sel.value || '').trim() : '';
                const classId = cardEl.getAttribute('data-class');
                const cand = _cardsByKey[cardEl.getAttribute('data-key')];
                if (!cand || !classId) return;
                if (!blockId) {
                    setStatus(container, '請先選這一班的區塊', true);
                    return;
                }
                goBtn.disabled = true;
                try {
                    const segs = readSegmentsFromCard(cardEl);
                    await moveCandToBlock(cand, segs, blockId, classId);
                    await refreshAndPaint(container);
                    setStatus(container, '已搬入區塊');
                } catch (err) {
                    goBtn.disabled = false;
                    setStatus(container, '搬入失敗：' + dbErr(err), true);
                }
            });
            cardEl.querySelectorAll('.sc-seg-row').forEach(bindSegRowDelete);
            if (cardEl.getAttribute('data-filed') === '1') {
                cardEl.addEventListener('change', function () {
                    persistIfFiled(cardEl);
                });
            }
        });
    }

    function bindSegRowDelete(rowEl) {
        if (!rowEl || rowEl.dataset.delBound === '1') return;
        rowEl.dataset.delBound = '1';
        const delBtn = rowEl.querySelector('.sc-seg-del');
        if (delBtn) delBtn.addEventListener('click', function () {
            const cardEl = rowEl.closest('.sc-card');
            rowEl.remove();
            persistIfFiled(cardEl);
        });
    }

    function render() {
        const container = document.getElementById('script-collector-container');
        if (!container) return;
        container.innerHTML = '<div style="padding:30px; text-align:center; color:var(--primary); font-weight:800;">⏳ 掃描中…</div>';
        setTimeout(function () {
            refreshAndPaint(container).catch(function (err) {
                _candidates = collectCandidates();
                paint(container);
                setStatus(container, '區塊讀取失敗：' + dbErr(err), true);
            });
        }, 0);
    }

    return {
        render: render
    };
})();

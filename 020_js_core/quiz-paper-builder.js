/**
 * 📂 020_js_core/quiz-paper-builder.js
 * 依 exam_job 區段 + meta 列 + _layout.fields 公式 → 產生線上卷 quiz_paper
 */
window.QuizPaperBuilder = (function () {
    'use strict';

    /** 尚未寫入 _layout.col_map 時的保守預設（GEPT sentence 常見） */
    const FALLBACK_COL_MAP = {
        D: 'sheet_id',
        E: 'page',
        C: 'item_no',
        Y: 'display_zh',
        X: 'script',
        BA: 'blank_1',
        BB: 'blank_2',
        BC: 'blank_1_zh',
        BD: 'blank_2_zh'
    };

    function toNum(v) {
        if (v == null || v === '') return NaN;
        const n = Number(String(v).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? NaN : n;
    }

    function normalizeAnswer(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[’‘]/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/[.,!?;:]+$/g, '')
            .trim();
    }

    function parseNumList(raw) {
        const text = String(raw || '').trim();
        if (!text) return null;
        const set = {};
        text.replace(/[～〜－—–]/g, '~').split(/[,，、\s]+/).forEach(function (part) {
            const p = String(part || '').trim();
            if (!p) return;
            const m = p.match(/^(\d+)\s*~\s*(\d+)$/);
            if (m) {
                let a = Number(m[1]);
                let b = Number(m[2]);
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) set[i] = true;
                return;
            }
            const n = toNum(p);
            if (!isNaN(n)) set[n] = true;
        });
        return set;
    }

    function shuffleInPlace(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    }

    function resolveColMap(layout, schemaId) {
        if (!layout) return Object.assign({}, FALLBACK_COL_MAP);
        if (schemaId && layout.col_maps && layout.col_maps[schemaId]) {
            return Object.assign({}, FALLBACK_COL_MAP, layout.col_maps[schemaId]);
        }
        if (layout.col_map && typeof layout.col_map === 'object') {
            return Object.assign({}, FALLBACK_COL_MAP, layout.col_map);
        }
        return Object.assign({}, FALLBACK_COL_MAP);
    }

    function pickProfile(layout, profileId) {
        const profiles = (layout && Array.isArray(layout.profiles)) ? layout.profiles : [];
        if (!profiles.length) return null;
        const want = String(profileId || '').trim();
        if (want) {
            const hit = profiles.find(function (p) {
                return String(p.profile_id || '') === want;
            });
            if (hit) return hit;
        }
        const defId = layout.default_profile_id;
        if (defId) {
            const hit2 = profiles.find(function (p) {
                return String(p.profile_id || '') === String(defId);
            });
            if (hit2) return hit2;
        }
        return profiles[0];
    }

    function filterRowsForSection(rows, section) {
        const rtype = section.range_type || 'page';
        const lo = Math.min(Number(section.start), Number(section.end));
        const hi = Math.max(Number(section.start), Number(section.end));
        const include = parseNumList(section.include_nums);
        const exclude = parseNumList(section.exclude_nums);
        const sheet = String(section.sheet_id || '').trim().toUpperCase();

        return (rows || []).filter(function (row) {
            if (!row) return false;
            // 若列上有 sheet_id，與區段不一致則略過
            const rowSheet = String(row.sheet_id || row.stem || '').trim().toUpperCase();
            if (rowSheet && sheet && rowSheet !== sheet) return false;

            const itemNo = toNum(row.item_no);
            const page = toNum(row.page);

            if (include && (isNaN(itemNo) || !include[itemNo])) return false;
            if (exclude && !isNaN(itemNo) && exclude[itemNo]) return false;

            if (rtype === 'qnum') {
                if (isNaN(itemNo)) return false;
                return itemNo >= lo && itemNo <= hi;
            }
            if (rtype === 'row') {
                // 尚無穩定 row_id 時：先不篩（由 count 抽）
                return true;
            }
            // page
            if (isNaN(page)) return false;
            return page >= lo && page <= hi;
        });
    }

    function inferQuizMode(profileId, fieldsAnswer) {
        const id = String(profileId || '').toLowerCase();
        if (id.indexOf('cloze') !== -1 || id.indexOf('fill') !== -1) return 'cloze';
        if (fieldsAnswer && /SUBSTITUTE/i.test(fieldsAnswer)) return 'cloze';
        return 'full_sentence';
    }

    function cellsToPlain(cells) {
        return (cells || []).map(function (c) {
            return {
                text: c && c.text != null ? String(c.text) : '',
                fontDelta: c && c.fontDelta ? Number(c.fontDelta) || 0 : 0
            };
        });
    }

    function buildItemFromRow(row, opts) {
        const Eval = window.LayoutFieldsEval;
        if (!Eval) throw new Error('LayoutFieldsEval 未載入');
        const sheet = String(opts.sheetId || row.sheet_id || '').trim().toUpperCase() || '?';
        const page = toNum(row.page);
        const itemNo = toNum(row.item_no);
        const folder = opts.materialFolder || '';
        const itemId = [folder || 'bank', sheet, isNaN(page) ? 'p' : page, isNaN(itemNo) ? 'i' : itemNo].join(':');

        const cells = cellsToPlain(Eval.evaluateFields(opts.fields || '', row, opts.colMap));
        let cellsAnswer = null;
        if (opts.fieldsAnswer) {
            cellsAnswer = cellsToPlain(Eval.evaluateFields(opts.fieldsAnswer, row, opts.colMap));
        }

        // 題卷慣例：第2欄提示（Y）、第3欄英文答案（X）；不足時退回 semantic
        const promptZh = (cells[1] && cells[1].text) || String(row.display_zh || '').trim();
        const answerEn = (cells[2] && cells[2].text) || String(row.script || '').trim();
        let clozeStem = '';
        if (opts.quizMode === 'cloze' && cellsAnswer && cellsAnswer[1]) {
            clozeStem = cellsAnswer[1].text || '';
        }

        return {
            item_id: itemId,
            seq: 0,
            quiz_mode: opts.quizMode || 'full_sentence',
            prompt_zh: promptZh,
            answer_en: answerEn,
            cloze_stem: clozeStem,
            accepted_answers: [],
            cells: cells,
            cells_answer: cellsAnswer,
            source: {
                material_folder: folder,
                sheet_id: sheet,
                page: isNaN(page) ? null : page,
                item_no: isNaN(itemNo) ? null : itemNo,
                schema_id: opts.schemaId || ''
            }
        };
    }

    /**
     * @param {object} args
     * @param {object} args.examJob
     * @param {object} args.layout  _layout.json 物件
     * @param {function(sheetId):Promise<{rows:array, schemaId?:string, materialFolder?:string}>} args.loadSheetMeta
     * @returns {Promise<object>} quiz_paper
     */
    async function buildQuizPaper(args) {
        const examJob = args.examJob || {};
        const layout = args.layout || {};
        const loadSheetMeta = args.loadSheetMeta;
        if (typeof loadSheetMeta !== 'function') throw new Error('缺少 loadSheetMeta');

        const profile = pickProfile(layout, examJob.layout_profile_id);
        const fields = (profile && profile.fields) || args.fields || '';
        if (!fields) throw new Error('layout 缺少 fields 公式（請確認 _layout.json）');
        const fieldsAnswer = (profile && (profile.fields_answer || profile.answer_fields)) || args.fieldsAnswer || '';
        const quizMode = inferQuizMode(profile && profile.profile_id, fieldsAnswer);
        const shuffle = !(examJob.options && examJob.options.shuffle === false);

        const sections = Array.isArray(examJob.sections) ? examJob.sections : [];
        if (!sections.length) throw new Error('exam_job 沒有區段');

        const picked = [];
        const metaCache = {};

        for (let sIdx = 0; sIdx < sections.length; sIdx++) {
            const sec = sections[sIdx] || {};
            const sheetId = String(sec.sheet_id || '').trim().toUpperCase();
            if (!sheetId) throw new Error('區段 ' + (sIdx + 1) + ' 缺少 sheet_id');

            if (!metaCache[sheetId]) {
                metaCache[sheetId] = await loadSheetMeta(sheetId);
            }
            const pack = metaCache[sheetId] || {};
            const rows = Array.isArray(pack.rows) ? pack.rows : [];
            const schemaId = pack.schemaId || '';
            const materialFolder = pack.materialFolder || layout.material_folder || '';
            const colMap = resolveColMap(layout, schemaId);

            let pool = filterRowsForSection(rows, sec);
            if (!pool.length) {
                throw new Error('活頁 ' + sheetId + ' 在範圍內沒有可用題（' +
                    (sec.range_type || 'page') + ' ' + sec.start + '~' + sec.end + '）');
            }
            if (shuffle) pool = shuffleInPlace(pool.slice());
            const want = Math.max(0, Number(sec.count) || 0);
            const take = want > 0 ? pool.slice(0, Math.min(want, pool.length)) : pool;

            take.forEach(function (row) {
                // 確保 sheet_id 在列上（若 Excel 有 D 欄會已有；否則補上）
                const row2 = Object.assign({}, row);
                if (!row2.sheet_id) row2.sheet_id = sheetId;
                picked.push(buildItemFromRow(row2, {
                    sheetId: sheetId,
                    materialFolder: materialFolder,
                    schemaId: schemaId,
                    fields: fields,
                    fieldsAnswer: fieldsAnswer,
                    colMap: colMap,
                    quizMode: quizMode
                }));
            });
        }

        if (shuffle) shuffleInPlace(picked);
        picked.forEach(function (it, idx) {
            it.seq = idx + 1;
        });

        return {
            kind: 'quiz_paper',
            generated_at: new Date().toISOString(),
            spec_ref: {
                job_id: examJob.job_id || '',
                bank_id: examJob.bank_id || '',
                layout_profile_id: (profile && profile.profile_id) || examJob.layout_profile_id || ''
            },
            layout: {
                profile_id: (profile && profile.profile_id) || '',
                label: (profile && profile.label) || '',
                fields: fields,
                fields_answer: fieldsAnswer || '',
                lines_per_page: (profile && profile.lines_per_page) || 10
            },
            items: picked
        };
    }

    function gradeAnswers(paper, answersByItemId) {
        const items = (paper && paper.items) || [];
        const map = answersByItemId || {};
        let correct = 0;
        const details = items.map(function (it) {
            const got = map[it.item_id];
            const gotN = normalizeAnswer(got);
            const okList = [it.answer_en].concat(it.accepted_answers || []).map(normalizeAnswer).filter(Boolean);
            const ok = gotN !== '' && okList.indexOf(gotN) !== -1;
            if (ok) correct += 1;
            return {
                item_id: it.item_id,
                seq: it.seq,
                ok: ok,
                answer: got == null ? '' : String(got),
                expected: it.answer_en || ''
            };
        });
        return {
            total: items.length,
            correct: correct,
            score: items.length ? Math.round((correct / items.length) * 1000) / 10 : 0,
            details: details
        };
    }

    return {
        buildQuizPaper: buildQuizPaper,
        gradeAnswers: gradeAnswers,
        normalizeAnswer: normalizeAnswer,
        FALLBACK_COL_MAP: FALLBACK_COL_MAP
    };
})();

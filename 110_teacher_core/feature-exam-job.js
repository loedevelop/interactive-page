/**
 * 📂 110_teacher_core/feature-exam-job.js
 * 🌟 教師端：匯出考試出題單 exam_job JSON（對齊 Python 出題系統必填欄位）
 *
 * 只收集意圖：job_id + bank + sheet/range/count + layout + outputs。
 * 不發明卷面公式；不呼叫 Python API。
 */
window.FeatureExamJob = (function () {
    'use strict';

    /** 兩邊約定的題庫清單（可之後改設定檔／DB） */
    const BANK_CATALOG = [
        { id: 'gept2-v1', label: 'GEPT-2 v1', aliases: ['GEPT-2', 'GEPT2', 'gept-2', 'gept2'] }
    ];

    /** 兩邊約定的卷面模板（優先以教材 _layout.json 為準） */
    const LAYOUT_CATALOG = [
        { id: 'sentence-translate-4col', label: '翻譯四欄（sentence-translate-4col）' },
        { id: 'sentence-cloze-4col', label: '填空四欄（sentence-cloze-4col）' },
        { id: 'gept-translate-5col', label: 'GEPT 翻譯五欄（舊 id）' }
    ];

    /** 卷面「欄位」公式提示（無 _layout 時的後備；正式以 _layout.json fields 為準） */
    const LAYOUT_FIELD_HINTS = {
        'sentence-translate-4col': 'STACK(D,E,C), FONTSIZE(Y,-1), X',
        'sentence-cloze-4col': 'STACK(D,E,C), FONTSIZE(Y,-1), X',
        'gept-translate-5col': 'STACK(D,E,C), FONTSIZE(Y,-1), X'
    };

    const SHEET_SUGGESTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    const DEFAULT_LINES_PER_PAGE = 10;

    function layoutFieldHint(layoutId) {
        return LAYOUT_FIELD_HINTS[layoutId] || '（依 layout_profile）';
    }

    function metaStemFromFileName(fileName) {
        const name = String(fileName || '').trim();
        const m = name.match(/^(.+?)\.meta\.json$/i);
        if (m) return m[1];
        return name.replace(/\.[^.]+$/, '') || '';
    }

    /** 去掉誤黏在範圍前的活頁字母（例：A pp. 1~2 → pp. 1~2） */
    function stripSheetPrefixFromRangeSpec(rangeSpec, sheet) {
        let text = String(rangeSpec || '').trim();
        if (!text || !sheet) return text;
        const re = new RegExp('^' + String(sheet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]?\\s*', 'i');
        return text.replace(re, '').trim();
    }

    /**
     * 用 MaterialSnapshot.parseRangeSpec 解析（支援 pp. 1~2, 5 與 #11~16, 26）。
     * @returns {{ range_type, start, end, pages?, items? }|null}
     */
    function parseSectionRangeFromSpec(rangeSpec, sheetHint) {
        const sheet = String(sheetHint || '').trim().toUpperCase();
        let raw = stripSheetPrefixFromRangeSpec(rangeSpec, sheet);
        if (!raw) return null;

        if (window.MaterialSnapshot && typeof window.MaterialSnapshot.parseRangeSpec === 'function') {
            try {
                const spec = window.MaterialSnapshot.parseRangeSpec(raw);
                if (spec.kind === 'all') {
                    return { range_type: 'page', start: 1, end: 9999, pages: null, items: null, all: true };
                }
                if (spec.kind === 'item') {
                    const items = spec.items || [];
                    if (!items.length) return null;
                    return {
                        range_type: 'qnum',
                        start: items[0],
                        end: items[items.length - 1],
                        pages: null,
                        items: items.slice()
                    };
                }
                const pages = spec.pages || [];
                if (!pages.length) return null;
                return {
                    range_type: 'page',
                    start: pages[0],
                    end: pages[pages.length - 1],
                    pages: pages.slice(),
                    items: null
                };
            } catch (_e) { /* fall through */ }
        }

        // 後備：僅連續起迄
        let m = raw.match(/^pp?\.?\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/i);
        if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Number(m[2]) : start;
            if (isNaN(start) || isNaN(end)) return null;
            const lo = Math.min(start, end);
            const hi = Math.max(start, end);
            const pages = [];
            for (let p = lo; p <= hi; p++) pages.push(p);
            return { range_type: 'page', start: lo, end: hi, pages: pages, items: null };
        }
        m = raw.match(/^#\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/);
        if (m) {
            const start = Number(m[1]);
            const end = m[2] ? Number(m[2]) : start;
            if (isNaN(start) || isNaN(end)) return null;
            const lo = Math.min(start, end);
            const hi = Math.max(start, end);
            const items = [];
            for (let n = lo; n <= hi; n++) items.push(n);
            return { range_type: 'qnum', start: lo, end: hi, pages: null, items: items };
        }
        return null;
    }

    /**
     * 從錄音 material_refs 列（A.meta.json + pp. 1~2）→ exam sections
     * 圖二 meta 列的活頁字母在檔名／label，範圍在 range_spec（常不含字母）
     */
    function sectionsFromMaterialRefs(refs, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        if (!Array.isArray(refs) || !refs.length) return [];
        const sections = [];
        const seen = {};
        refs.forEach(function (r) {
            if (!r) return;
            let sheet = '';
            const label = String(r.label || r.stem || '').trim();
            if (/^[A-Za-z0-9]{1,4}$/i.test(label)) {
                sheet = label.toUpperCase();
            } else {
                const fromFile = metaStemFromFileName(r.published_file || r.metaFile || '');
                sheet = String(fromFile || label || '').trim().toUpperCase();
            }
            const parsed = parseSectionRangeFromSpec(r.range_spec || r.range || '', sheet);
            if (!sheet || !parsed) return;
            const key = sheet + ':' + parsed.range_type + ':' + parsed.start + ':' + parsed.end
                + ':' + (parsed.pages ? parsed.pages.join(',') : '')
                + ':' + (parsed.items ? parsed.items.join(',') : '');
            if (seen[key]) return;
            seen[key] = true;
            const span = parsed.range_type === 'page'
                ? (parsed.pages && parsed.pages.length ? parsed.pages.length : Math.max(1, parsed.end - parsed.start + 1))
                : (parsed.items && parsed.items.length ? parsed.items.length : Math.max(1, parsed.end - parsed.start + 1));
            sections.push({
                sheet_id: sheet,
                range_type: parsed.range_type,
                start: parsed.start,
                end: parsed.end,
                pages: parsed.pages || null,
                items: parsed.items || null,
                count: parsed.range_type === 'page' ? span * lpp : span,
                lines_per_page: lpp,
                difficulty: '',
                include_nums: '',
                exclude_nums: '',
                range_spec: String(r.range_spec || r.range || '').trim()
            });
        });
        return sections;
    }

    /** 從單一錄音任務組出 sections（優先 material_refs） */
    function sectionsFromAudioTask(audioTask, linesPerPage) {
        if (!audioTask) return [];
        const raw = audioTask.raw_data || {};
        let refs = Array.isArray(raw.material_refs) && raw.material_refs.length
            ? raw.material_refs
            : (raw.material_ref && (raw.material_ref.published_file || raw.material_ref.range_spec)
                ? [raw.material_ref] : []);
        let sections = sectionsFromMaterialRefs(refs, linesPerPage);
        if (sections.length) return sections;

        let rangeText = String(raw.material_range || '').trim();
        if (!rangeText && window.FeatureTimeline && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
            rangeText = window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '';
        }
        if (!rangeText) rangeText = stripHtml(audioTask.title || '');
        sections = parseMaterialRangeToSections(rangeText, linesPerPage);
        if (sections.length) return sections;

        if (Array.isArray(raw.grading_units) && raw.grading_units.length) {
            return sectionsFromGradingUnits(raw.grading_units, linesPerPage);
        }
        return [];
    }

    /** 找與考試任務同層（或整棵樹）的錄音任務，同層優先 */
    function findPreferredAudioTask(tasksRoot, examPathStr) {
        const hit = findPreferredAudioHit(tasksRoot, examPathStr);
        return hit ? hit.task : null;
    }

    /** @returns {{ task: object, pathStr: string }|null} */
    function findPreferredAudioHit(tasksRoot, examPathStr) {
        const arr = String(examPathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let siblingList = tasksRoot;
        let siblingBasePath = [];
        if (arr.length >= 2) {
            let list = tasksRoot;
            const base = [];
            for (let i = 0; i < arr.length - 1; i++) {
                const node = list[arr[i]];
                if (!node) { list = null; break; }
                base.push(arr[i]);
                list = node.subTasks || [];
            }
            if (list) {
                siblingList = list;
                siblingBasePath = base;
            }
        }
        for (let i = 0; i < (siblingList || []).length; i++) {
            const t = siblingList[i];
            if (t && t.type === 'audio_record') {
                return { task: t, pathStr: siblingBasePath.concat([i]).join('-') };
            }
        }
        let found = null;
        walkTasks(tasksRoot || [], function (t, pathArr) {
            if (!found && t && t.type === 'audio_record') {
                found = { task: t, pathStr: pathArr.join('-') };
            }
        });
        return found;
    }

    /** 從錄音節點 DOM 讀 meta 列（比 raw_data 新：加第 3 筆後尚未 Snapshot 也能帶入） */
    function readDomMaterialRefs(audioPathStr, rootKind) {
        const container = document.getElementById('node-material-rows-' + audioPathStr);
        if (!container) return [];
        const refs = [];
        container.querySelectorAll('.material-meta-row').forEach(function (row) {
            const fileEl = row.querySelector('.material-meta-file');
            const rangeEl = row.querySelector('.material-meta-range');
            const val = fileEl ? String(fileEl.value || '').trim() : '';
            if (!val || val.indexOf('::') === -1) return;
            const parts = val.split('::');
            const folder = String(parts[0] || '').trim();
            const fileName = String(parts.slice(1).join('::') || '').trim();
            if (!fileName) return;
            const stem = metaStemFromFileName(fileName);
            refs.push({
                material_folder: folder,
                published_file: fileName,
                range_spec: rangeEl ? String(rangeEl.value || '').trim() : '',
                label: stem,
                stem: stem,
                materials_root_kind: rootKind || 'teacher',
                schema_id: 'gept-2_sentence'
            });
        });
        return refs;
    }

    function refreshExamBuilder() {
        if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder({ skipSync: true });
        }
    }

    function sectionsLookEmpty(sections) {
        if (!Array.isArray(sections) || !sections.length) return true;
        if (sections.length === 1) {
            const s = sections[0] || {};
            if (!String(s.sheet_id || '').trim()) return true;
        }
        return false;
    }

    /**
     * 可用題數（與產生線上卷同一套篩選語意）：
     * 1) 優先 meta_rows_by_stem（完整 meta 列數＝真正可抽題數）
     * 2) 題號：meta_items / grading_units.item_nos
     * 3) 頁碼：grading_units.item_count（僅 Snapshot 過的頁）
     */
    function collectMetaItemsFromAudio(audioTask) {
        if (!audioTask || !audioTask.raw_data) return [];
        const raw = audioTask.raw_data;
        if (Array.isArray(raw.meta_items) && raw.meta_items.length) {
            return raw.meta_items;
        }
        const units = Array.isArray(raw.grading_units) ? raw.grading_units : [];
        const out = [];
        units.forEach(function (u) {
            if (!u) return;
            const stem = String(u.stem || '').trim();
            const page = u.page;
            const nos = Array.isArray(u.item_nos) ? u.item_nos : [];
            nos.forEach(function (n) {
                const itemNo = Number(n);
                if (isNaN(itemNo)) return;
                out.push({ stem: stem, page: page, item_no: itemNo });
            });
        });
        return out;
    }

    function buildPageSetForSection(section) {
        if (Array.isArray(section.pages) && section.pages.length) {
            const set = {};
            section.pages.forEach(function (p) {
                const n = Number(p);
                if (!isNaN(n)) set[n] = true;
            });
            return set;
        }
        // 若帶原始 range_spec，用完整解析（含不連續頁）
        if (section.range_spec && window.MaterialSnapshot
            && typeof window.MaterialSnapshot.parseRangeSpec === 'function') {
            try {
                const raw = stripSheetPrefixFromRangeSpec(section.range_spec, section.sheet_id);
                const spec = window.MaterialSnapshot.parseRangeSpec(raw);
                if (spec.kind === 'page' && spec.pages && spec.pages.length) {
                    const set = {};
                    spec.pages.forEach(function (p) { set[Number(p)] = true; });
                    return set;
                }
            } catch (_e) {}
        }
        const start = Number(section.start);
        const end = Number(section.end);
        if (isNaN(start) || isNaN(end)) return null;
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        const set = {};
        for (let p = lo; p <= hi; p++) set[p] = true;
        return set;
    }

    function buildItemSetForSection(section) {
        if (Array.isArray(section.items) && section.items.length) {
            const set = {};
            section.items.forEach(function (n) {
                const v = Number(n);
                if (!isNaN(v)) set[v] = true;
            });
            return set;
        }
        if (section.range_spec && window.MaterialSnapshot
            && typeof window.MaterialSnapshot.parseRangeSpec === 'function') {
            try {
                const raw = stripSheetPrefixFromRangeSpec(section.range_spec, section.sheet_id);
                const spec = window.MaterialSnapshot.parseRangeSpec(raw);
                if (spec.kind === 'item' && spec.items && spec.items.length) {
                    const set = {};
                    spec.items.forEach(function (n) { set[Number(n)] = true; });
                    return set;
                }
            } catch (_e) {}
        }
        const start = Number(section.start);
        const end = Number(section.end);
        if (isNaN(start) || isNaN(end)) return null;
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        const set = {};
        for (let n = lo; n <= hi; n++) set[n] = true;
        return set;
    }

    function countAvailableFromMetaRows(section, rows) {
        if (!section || !Array.isArray(rows) || !rows.length) return null;
        const rtype = section.range_type || 'page';
        const include = String(section.include_nums || '').trim();
        const exclude = String(section.exclude_nums || '').trim();
        const includeSet = include
            ? include.split(/[,，\s]+/).reduce(function (acc, x) {
                const n = Number(x);
                if (!isNaN(n)) acc[n] = true;
                return acc;
            }, {})
            : null;
        const excludeSet = exclude
            ? exclude.split(/[,，\s]+/).reduce(function (acc, x) {
                const n = Number(x);
                if (!isNaN(n)) acc[n] = true;
                return acc;
            }, {})
            : null;

        let pageSet = null;
        let itemSet = null;
        if (rtype === 'qnum') itemSet = buildItemSetForSection(section);
        else if (rtype === 'page') pageSet = buildPageSetForSection(section);
        // row：不篩頁／題

        let sum = 0;
        rows.forEach(function (row) {
            if (!row) return;
            // 與抽題一致：空 script 仍可能有 display；以「有 script 或 display」算一題
            const hasBody = String(row.script || '').trim()
                || String(row.display_zh || row.display || '').trim();
            if (!hasBody) return;
            const itemNo = Number(row.item_no != null ? row.item_no : row.itemNo);
            const page = Number(row.page != null ? row.page : row.Page);
            if (includeSet && (isNaN(itemNo) || !includeSet[itemNo])) return;
            if (excludeSet && !isNaN(itemNo) && excludeSet[itemNo]) return;
            if (rtype === 'qnum') {
                if (!itemSet || isNaN(itemNo) || !itemSet[itemNo]) return;
                sum += 1;
                return;
            }
            if (rtype === 'page') {
                if (!pageSet || isNaN(page) || !pageSet[page]) return;
                sum += 1;
                return;
            }
            // row
            sum += 1;
        });
        return sum;
    }

    /** 錄音 material_refs／range 是否已點名該活頁（有點名但無快取＝需再 Snapshot） */
    function sectionSheetMentionedInAudio(section, audioTask) {
        const sheet = String((section && section.sheet_id) || '').trim().toUpperCase();
        if (!sheet || !audioTask || !audioTask.raw_data) return false;
        const raw = audioTask.raw_data;
        const refs = Array.isArray(raw.material_refs) ? raw.material_refs : [];
        for (let i = 0; i < refs.length; i++) {
            const r = refs[i] || {};
            const stem = String(r.label || '').trim().toUpperCase()
                || String(r.published_file || '').replace(/\.meta\.json$/i, '').toUpperCase();
            if (stem === sheet) return true;
        }
        const range = String(raw.material_range || '').toUpperCase();
        if (range) {
            // 「A PP. 1~2；B PP.…」或開頭即該活頁
            const re = new RegExp('(?:^|[;；,，\\s])' + sheet + '\\s*PP?\\.?\\s*\\d', 'i');
            if (re.test(range)) return true;
        }
        return false;
    }

    function countAvailableFromMeta(section, audioTask) {
        if (!section || !audioTask) return null;
        const sheet = String(section.sheet_id || '').trim().toUpperCase();
        if (!sheet) return null;
        const raw = audioTask.raw_data || {};

        // 1) 完整 meta 快取（與產生線上卷同源）
        const byStem = raw.meta_rows_by_stem || {};
        const rows = byStem[sheet] || byStem[String(section.sheet_id || '').trim()];
        if (Array.isArray(rows) && rows.length) {
            return countAvailableFromMetaRows(section, rows);
        }

        const start = Number(section.start);
        const end = Number(section.end);
        if (isNaN(start) || isNaN(end)) return null;
        const rtype = section.range_type || 'page';

        // 2) 題號：meta_items
        if (rtype === 'qnum') {
            const itemSet = buildItemSetForSection(section);
            const items = collectMetaItemsFromAudio(audioTask);
            if (!items.length || !itemSet) return null;
            let sum = 0;
            items.forEach(function (it) {
                const stem = String((it && it.stem) || '').trim().toUpperCase();
                if (stem !== sheet) return;
                const itemNo = Number(it.item_no);
                if (isNaN(itemNo) || !itemSet[itemNo]) return;
                sum += 1;
            });
            return sum;
        }

        // 3) 頁碼：grading_units（僅 Snapshot 切過的頁）
        const units = Array.isArray(raw.grading_units) ? raw.grading_units : [];
        if (!units.length) return null;
        const pageSet = buildPageSetForSection(section);
        if (!pageSet) return null;

        let sum = 0;
        let hit = false;
        units.forEach(function (u) {
            if (!u) return;
            const stem = String(u.stem || '').trim().toUpperCase();
            if (stem !== sheet) return;
            const page = Number(u.page);
            if (isNaN(page) || !pageSet[page]) return;
            hit = true;
            let itemCount = (u.item_count != null && u.item_count !== '')
                ? Number(u.item_count)
                : NaN;
            if (isNaN(itemCount) && Array.isArray(u.item_nos)) itemCount = u.item_nos.length;
            if (isNaN(itemCount)) itemCount = 0;
            sum += itemCount;
        });

        return hit ? sum : null;
    }

    function formatDisplayPercent(count, avail) {
        if (avail == null) return '—';
        if (!(avail > 0)) return 'N/A';
        const q = Number(count);
        if (isNaN(q)) return 'N/A';
        return ((q / avail) * 100).toFixed(1) + '%';
    }

    function expectedSlotsForSection(section) {
        const start = Number(section && section.start);
        const end = Number(section && section.end);
        const lpp = Number(section && section.lines_per_page) || DEFAULT_LINES_PER_PAGE;
        if (isNaN(start) || isNaN(end)) return null;
        if ((section.range_type || 'page') !== 'page') return null;
        return Math.max(1, end - start + 1) * lpp;
    }

    let cachedContext = null; // { classId, className, assignments }

    const state = {
        jobId: '',
        examTitle: '',
        bankId: BANK_CATALOG[0] ? BANK_CATALOG[0].id : '',
        layoutProfileId: LAYOUT_CATALOG[0] ? LAYOUT_CATALOG[0].id : '',
        assignmentId: '',
        taskId: '', // 空＝儲存時新建 exam 任務
        sections: [
            { sheet_id: 'K', range_type: 'page', start: 1, end: 2, count: 20, lines_per_page: DEFAULT_LINES_PER_PAGE }
        ],
        outputs: { pdf: true, answer: true },
        options: {
            shuffle: true,
            force_qnum: true,
            separate_pages: false,
            header_left: '',
            header_center: '',
            header_right: '',
            include_nums: '',
            exclude_nums: '',
            difficulty: ''
        },
        lastPayload: null,
        dirty: false,
        importNote: '' // 從作業帶入時的說明
    };

    function stripHtml(str) {
        return String(str == null ? '' : str).replace(/<[^>]*>?/gm, '').trim();
    }

    function inferBankId(className) {
        const hay = String(className || '');
        for (let i = 0; i < BANK_CATALOG.length; i++) {
            const b = BANK_CATALOG[i];
            if (hay.indexOf(b.label) !== -1 || hay.toLowerCase().indexOf(b.id) !== -1) return b.id;
            const aliases = b.aliases || [];
            for (let j = 0; j < aliases.length; j++) {
                if (hay.toUpperCase().indexOf(String(aliases[j]).toUpperCase()) !== -1) return b.id;
            }
        }
        return BANK_CATALOG[0] ? BANK_CATALOG[0].id : '';
    }

    /**
     * 解析「A pp. 1~2 ; B pp. 1~2」→ sections（尚未分配 count）
     */
    function parseMaterialRangeToSections(rangeText, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        const text = String(rangeText || '').trim();
        if (!text) return [];
        const parts = text.split(/[;；]/);
        const sections = [];
        const seen = {};
        const re = /^\s*([A-Za-z]+)\s*pp?\.?\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/i;
        for (let i = 0; i < parts.length; i++) {
            const m = String(parts[i]).trim().match(re);
            if (!m) continue;
            const sheet = m[1].toUpperCase();
            const start = Number(m[2]);
            const end = m[3] ? Number(m[3]) : start;
            if (!sheet || isNaN(start) || isNaN(end)) continue;
            const key = sheet + ':' + start + ':' + end;
            if (seen[key]) continue;
            seen[key] = true;
            const pageSpan = Math.max(1, end - start + 1);
            sections.push({
                sheet_id: sheet,
                range_type: 'page',
                start: start,
                end: end,
                count: pageSpan * lpp,
                lines_per_page: lpp,
                difficulty: '',
                include_nums: '',
                exclude_nums: ''
            });
        }
        return sections;
    }

    /** 從 grading_units（優先 stem+page 欄位）合併成 sections */
    function sectionsFromGradingUnits(units, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        if (!Array.isArray(units) || !units.length) return [];
        const bySheet = {};
        const order = [];
        units.forEach(function (u) {
            if (!u) return;
            let sheet = String(u.stem || '').trim().toUpperCase();
            let page = Number(u.page);
            if (!sheet || isNaN(page)) {
                const label = String(u.label || u.unit_key || '').trim();
                const m = label.match(/^([A-Za-z0-9]+)\s*p(?:p)?\.?\s*(\d+)/i);
                if (!m) return;
                sheet = m[1].toUpperCase();
                page = Number(m[2]);
            }
            if (!sheet || isNaN(page)) return;
            let itemCount = (u.item_count != null && u.item_count !== '') ? Number(u.item_count) : NaN;
            if (isNaN(itemCount) && Array.isArray(u.item_nos)) itemCount = u.item_nos.length;
            if (isNaN(itemCount)) itemCount = 0;
            if (!bySheet[sheet]) {
                bySheet[sheet] = {
                    sheet_id: sheet,
                    start: page,
                    end: page,
                    pages: [page],
                    avail: itemCount
                };
                order.push(sheet);
            } else {
                const s = bySheet[sheet];
                s.start = Math.min(s.start, page);
                s.end = Math.max(s.end, page);
                if (s.pages.indexOf(page) === -1) s.pages.push(page);
                s.avail += itemCount;
            }
        });
        return order.map(function (sheet) {
            const s = bySheet[sheet];
            s.pages.sort(function (a, b) { return a - b; });
            const pageSpan = s.pages.length || Math.max(1, s.end - s.start + 1);
            return {
                sheet_id: s.sheet_id,
                range_type: 'page',
                start: s.start,
                end: s.end,
                pages: s.pages.slice(),
                count: s.avail > 0 ? s.avail : (pageSpan * lpp),
                lines_per_page: lpp
            };
        });
    }

    function distributeTotalCount(sections, totalCount) {
        if (!sections.length || !totalCount || totalCount <= 0) return sections;
        const n = sections.length;
        const base = Math.floor(totalCount / n);
        let rem = totalCount % n;
        return sections.map(function (s, i) {
            const copy = Object.assign({}, s);
            copy.count = base + (i < rem ? 1 : 0);
            return copy;
        });
    }

    /**
     * 從作業既有任務讀：錄音範圍、抽考題數、考試標題
     */
    function extractHintsFromAssignment(assignment) {
        const hints = {
            rangeText: '',
            gradingUnits: null,
            materialRefs: null,
            audioTask: null,
            totalCount: 0,
            examTitle: '',
            sourceNotes: []
        };
        if (!assignment) return hints;

        walkTasks(assignment.tasks || [], function (t) {
            if (!t) return;
            if (t.type === 'audio_record') {
                const raw = t.raw_data || {};
                if (!hints.audioTask) {
                    hints.audioTask = t;
                    hints.sourceNotes.push('錄音任務');
                }
                const range = String(raw.material_range || '').trim() || stripHtml(t.title || '');
                if (range && /[A-Za-z]+\s*pp?\.?/i.test(range) && !hints.rangeText) {
                    hints.rangeText = range;
                }
                if (!hints.gradingUnits && Array.isArray(raw.grading_units) && raw.grading_units.length) {
                    hints.gradingUnits = raw.grading_units;
                }
                if (!hints.materialRefs || !hints.materialRefs.length) {
                    if (Array.isArray(raw.material_refs) && raw.material_refs.length) {
                        hints.materialRefs = raw.material_refs;
                    } else if (raw.material_ref && raw.material_ref.published_file) {
                        hints.materialRefs = [raw.material_ref];
                    }
                }
            }
            if (t.type === 'check' || t.type === 'exam') {
                const blob = stripHtml(t.title || '') + ' ' + stripHtml(t.description || '');
                const countMatch = blob.match(/(\d+)\s*題/);
                if (countMatch) {
                    hints.totalCount = Number(countMatch[1]);
                    hints.sourceNotes.push('題數「' + countMatch[1] + ' 題」');
                }
                if (/抽考|考試|test/i.test(blob)) {
                    const tTitle = stripHtml(t.title || '');
                    if (tTitle) hints.examTitle = tTitle;
                }
            }
        });
        return hints;
    }

    function applyHintsFromAssignment(assignment, opts) {
        const options = opts || {};
        const hints = extractHintsFromAssignment(assignment);
        let sections = [];
        if (hints.audioTask) {
            sections = sectionsFromAudioTask(hints.audioTask, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('material_refs／錄音範圍');
        }
        if (!sections.length) {
            sections = parseMaterialRangeToSections(hints.rangeText, DEFAULT_LINES_PER_PAGE);
        }
        if (!sections.length && hints.materialRefs) {
            sections = sectionsFromMaterialRefs(hints.materialRefs, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('material_refs');
        }
        if (!sections.length && hints.gradingUnits) {
            sections = sectionsFromGradingUnits(hints.gradingUnits, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('grading_units');
        }
        if (hints.totalCount > 0 && sections.length) {
            sections = distributeTotalCount(sections, hints.totalCount);
        }
        if (sections.length) {
            state.sections = sections;
        }
        if (hints.examTitle && (options.forceTitle || !state.examTitle)) {
            state.examTitle = hints.examTitle;
        }
        if (cachedContext && cachedContext.className) {
            state.bankId = inferBankId(cachedContext.className);
        }
        if (sections.length || hints.totalCount) {
            const bits = [];
            if (sections.length) bits.push(sections.length + ' 個活頁區段');
            if (hints.totalCount) bits.push('共 ' + hints.totalCount + ' 題（均分到各區段）');
            if (hints.sourceNotes.length) bits.push('來源：' + hints.sourceNotes.join('、'));
            state.importNote = '已從作業帶入：' + bits.join('；');
        } else {
            state.importNote = '此作業找不到可解析的錄音範圍（例如 A pp. 1~2），請手動填區段。';
        }
        return hints;
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function newJobId() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const rand = Math.random().toString(36).slice(2, 6);
        return 'exam-' + y + m + day + '-' + rand;
    }

    function walkTasks(tasks, visitor, parentPath) {
        if (!Array.isArray(tasks)) return;
        const path = parentPath || [];
        tasks.forEach(function (t, idx) {
            visitor(t, path.concat(idx));
            if (t && Array.isArray(t.subTasks)) walkTasks(t.subTasks, visitor, path.concat(idx));
        });
    }

    function findTaskById(tasks, taskId) {
        let found = null;
        walkTasks(tasks, function (t) {
            if (t && String(t.id) === String(taskId)) found = t;
        });
        return found;
    }

    function listExamTasks(assignment) {
        const out = [];
        if (!assignment) return out;
        walkTasks(assignment.tasks || [], function (t) {
            if (t && t.type === 'exam') {
                const raw = t.raw_data || {};
                out.push({
                    id: t.id,
                    title: t.title || raw.exam_title || '(未命名考試)',
                    jobId: raw.exam_job_id || (raw.exam_job && raw.exam_job.job_id) || ''
                });
            }
        });
        return out;
    }

    function getSelectedAssignment() {
        if (!cachedContext || !state.assignmentId) return null;
        return (cachedContext.assignments || []).find(function (a) {
            return String(a.id) === String(state.assignmentId);
        }) || null;
    }

    function markDirty() {
        state.dirty = true;
    }

    function isDirty() {
        return state.dirty;
    }

    function syncSectionsFromDom() {
        const rows = document.querySelectorAll('[data-exam-section]');
        if (!rows.length) return;
        const next = [];
        rows.forEach(function (row) {
            const idx = Number(row.getAttribute('data-exam-section'));
            const sheet = (document.getElementById('exam-sheet-' + idx) || {}).value || '';
            const rangeType = (document.getElementById('exam-range-type-' + idx) || {}).value || 'page';
            const start = Number((document.getElementById('exam-start-' + idx) || {}).value);
            const end = Number((document.getElementById('exam-end-' + idx) || {}).value);
            const count = Number((document.getElementById('exam-count-' + idx) || {}).value);
            const lines = Number((document.getElementById('exam-lpp-' + idx) || {}).value);
            const sec = {
                sheet_id: String(sheet).trim(),
                range_type: rangeType,
                start: start,
                end: end,
                count: count
            };
            if (rangeType === 'page') {
                sec.lines_per_page = isNaN(lines) || lines <= 0 ? 10 : lines;
            }
            next.push(sec);
        });
        state.sections = next;
    }

    function syncFormFromDom() {
        const titleEl = document.getElementById('exam-title');
        const bankEl = document.getElementById('exam-bank');
        const layoutEl = document.getElementById('exam-layout');
        const assignEl = document.getElementById('exam-assignment');
        const taskEl = document.getElementById('exam-task');
        if (titleEl) state.examTitle = String(titleEl.value || '').trim();
        if (bankEl) state.bankId = bankEl.value;
        if (layoutEl) state.layoutProfileId = layoutEl.value;
        if (assignEl) state.assignmentId = assignEl.value;
        if (taskEl) state.taskId = taskEl.value;

        state.outputs.pdf = !!(document.getElementById('exam-out-pdf') || {}).checked;
        state.outputs.answer = !!(document.getElementById('exam-out-answer') || {}).checked;

        const opt = state.options;
        opt.shuffle = !!(document.getElementById('exam-opt-shuffle') || {}).checked;
        opt.force_qnum = !!(document.getElementById('exam-opt-force-qnum') || {}).checked;
        opt.separate_pages = !!(document.getElementById('exam-opt-separate-pages') || {}).checked;
        ['header_left', 'header_center', 'header_right', 'include_nums', 'exclude_nums', 'difficulty'].forEach(function (key) {
            const el = document.getElementById('exam-opt-' + key.replace(/_/g, '-'));
            if (el) opt[key] = String(el.value || '').trim();
        });

        syncSectionsFromDom();
    }

    function validateAndBuildPayload() {
        syncFormFromDom();

        if (!state.jobId) state.jobId = newJobId();
        if (!state.bankId) throw new Error('請選擇 bank_id（題庫）');
        if (!state.layoutProfileId) throw new Error('請選擇 layout_profile_id（卷面模板）');
        if (!state.sections.length) throw new Error('至少需要一個出題區段');

        const sections = [];
        for (let i = 0; i < state.sections.length; i++) {
            const s = state.sections[i];
            if (!s.sheet_id) throw new Error('區段 ' + (i + 1) + '：缺少 sheet_id');
            if (['page', 'qnum', 'row'].indexOf(s.range_type) === -1) {
                throw new Error('區段 ' + (i + 1) + '：range_type 必須是 page／qnum／row');
            }
            if (isNaN(s.start) || isNaN(s.end) || isNaN(s.count)) {
                throw new Error('區段 ' + (i + 1) + '：start／end／count 必須是數字');
            }
            if (s.count <= 0) throw new Error('區段 ' + (i + 1) + '：count 必須 > 0');
            if (s.end < s.start) throw new Error('區段 ' + (i + 1) + '：end 不可小於 start');
            const sec = {
                sheet_id: s.sheet_id,
                range_type: s.range_type,
                start: s.start,
                end: s.end,
                count: s.count
            };
            if (s.range_type === 'page') {
                const lpp = s.lines_per_page > 0 ? s.lines_per_page : 10;
                sec.lines_per_page = lpp;
            }
            if (s.difficulty) sec.difficulty = s.difficulty;
            if (s.include_nums) sec.include_nums = s.include_nums;
            if (s.exclude_nums) sec.exclude_nums = s.exclude_nums;
            sections.push(sec);
        }

        const outputs = [];
        if (state.outputs.pdf) outputs.push('pdf');
        if (state.outputs.answer) outputs.push('answer');
        if (!outputs.length) throw new Error('outputs 至少選一項（pdf 或 answer）');

        const options = {
            shuffle: !!state.options.shuffle,
            force_qnum: !!state.options.force_qnum,
            separate_pages: !!state.options.separate_pages
        };
        ['header_left', 'header_center', 'header_right', 'include_nums', 'exclude_nums', 'difficulty'].forEach(function (key) {
            if (state.options[key]) options[key] = state.options[key];
        });

        const payload = {
            job_id: state.jobId,
            bank_id: state.bankId,
            layout_profile_id: state.layoutProfileId,
            sections: sections,
            outputs: outputs,
            options: options
        };

        const a = getSelectedAssignment();
        payload.context = {
            class_id: cachedContext ? cachedContext.classId : '',
            class_name: cachedContext ? (cachedContext.className || '') : '',
            assignment_id: state.assignmentId || '',
            task_id: state.taskId || '',
            exam_title: state.examTitle || ''
        };
        if (a) {
            payload.context.assignment_title = a.title || '';
            payload.context.target_date = a.target_date || '';
        }

        return payload;
    }

    function downloadJson(payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exam_job_' + payload.job_id + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    async function copyJson(payload) {
        const text = JSON.stringify(payload, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    /**
     * 把 exam_job 寫進指定作業的 exam 任務 raw_data（新建或更新）
     */
    async function persistToAssignment(payload) {
        if (!state.assignmentId) {
            throw new Error('請先選擇要綁定的作業，才能寫入任務 raw_data');
        }
        if (!window.supabaseClient) throw new Error('Supabase 尚未就緒');

        const { data: row, error } = await window.supabaseClient
            .from('assignments')
            .select('id, tasks, title')
            .eq('id', state.assignmentId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error) throw error;
        if (!row) throw new Error('找不到作業');

        let tasks = Array.isArray(row.tasks) ? JSON.parse(JSON.stringify(row.tasks)) : [];
        const title = state.examTitle || ('考試 ' + payload.job_id);
        const rawPatch = {
            exam_job_id: payload.job_id,
            exam_job: payload,
            exam_title: title
        };

        let target = null;
        if (state.taskId) {
            target = findTaskById(tasks, state.taskId);
            if (!target) throw new Error('找不到選定的考試任務');
            if (target.type !== 'exam') throw new Error('選定的任務不是考試類型');
        } else {
            // 若已有同 job_id 的任務則覆寫
            walkTasks(tasks, function (t) {
                if (!t || t.type !== 'exam') return;
                const rid = (t.raw_data && t.raw_data.exam_job_id) ||
                    (t.raw_data && t.raw_data.exam_job && t.raw_data.exam_job.job_id);
                if (rid && String(rid) === String(payload.job_id)) target = t;
            });
        }

        if (target) {
            target.title = title || target.title;
            target.type = 'exam';
            target.raw_data = Object.assign({}, target.raw_data || {}, rawPatch);
            state.taskId = target.id;
            if (payload.context) payload.context.task_id = target.id;
            target.raw_data.exam_job = payload;
        } else {
            const newId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            if (payload.context) payload.context.task_id = newId;
            tasks.push({
                id: newId,
                type: 'exam',
                title: title,
                url: '',
                url_text: '',
                description: '',
                due_date: '',
                late_mode: 'infinite',
                grace_period_hours: 0,
                penalty_percentage: 0,
                raw_data: Object.assign({}, rawPatch, { exam_job: payload })
            });
            state.taskId = newId;
        }

        // 同步 cached assignment
        const { data: updated, error: upErr } = await window.supabaseClient
            .from('assignments')
            .update({ tasks: tasks })
            .eq('id', state.assignmentId)
            .is('deleted_at', null)
            .select('id, tasks')
            .maybeSingle();
        if (upErr) throw upErr;

        const nextTasks = updated && updated.tasks ? updated.tasks : tasks;
        if (cachedContext && Array.isArray(cachedContext.assignments)) {
            const a = cachedContext.assignments.find(function (x) {
                return String(x.id) === String(state.assignmentId);
            });
            if (a) a.tasks = nextTasks;
        }
        if (window.TeacherDB && Array.isArray(window.TeacherDB.assignments)) {
            const dbA = window.TeacherDB.assignments.find(function (x) {
                return String(x.id) === String(state.assignmentId);
            });
            if (dbA) dbA.tasks = nextTasks;
        }

        return state.taskId;
    }

    // ============ UI ============

    function renderSectionRow(sec, idx) {
        const sheetOpts = SHEET_SUGGESTIONS.map(function (s) {
            return '<option value="' + esc(s) + '"></option>';
        }).join('');
        const showLpp = sec.range_type === 'page';
        return `
            <div data-exam-section="${idx}" style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:10px; background:#F8FAFC;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="color:#334155;">區段 ${idx + 1}</strong>
                    <button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem; color:#B91C1C;"
                        onclick="window.FeatureExamJob._removeSection(${idx})" ${state.sections.length <= 1 ? 'disabled' : ''}>刪除</button>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:8px;">
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">sheet_id
                        <input id="exam-sheet-${idx}" list="exam-sheet-list-${idx}" type="text" class="form-control"
                            value="${esc(sec.sheet_id)}" placeholder="例如 K"
                            style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">
                        <datalist id="exam-sheet-list-${idx}">${sheetOpts}</datalist>
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">range_type
                        <select id="exam-range-type-${idx}" class="form-control" style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onRangeTypeChange(${idx}, this.value)">
                            <option value="page" ${sec.range_type === 'page' ? 'selected' : ''}>page（頁）</option>
                            <option value="qnum" ${sec.range_type === 'qnum' ? 'selected' : ''}>qnum（題號）</option>
                            <option value="row" ${sec.range_type === 'row' ? 'selected' : ''}>row（資料列）</option>
                        </select>
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">start
                        <input id="exam-start-${idx}" type="number" class="form-control" value="${esc(sec.start)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">end
                        <input id="exam-end-${idx}" type="number" class="form-control" value="${esc(sec.end)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">count（題數）
                        <input id="exam-count-${idx}" type="number" class="form-control" value="${esc(sec.count)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700; ${showLpp ? '' : 'opacity:0.4;'}">lines_per_page
                        <input id="exam-lpp-${idx}" type="number" class="form-control" value="${esc(sec.lines_per_page || 10)}"
                            style="width:100%; padding:6px; margin-top:2px;" ${showLpp ? '' : 'disabled'}
                            onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                </div>
            </div>
        `;
    }

    function renderModalContentHtml() {
        const bankOpts = BANK_CATALOG.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (state.bankId === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>';
        }).join('');
        const layoutOpts = LAYOUT_CATALOG.map(function (l) {
            return '<option value="' + esc(l.id) + '"' + (state.layoutProfileId === l.id ? ' selected' : '') + '>' + esc(l.label) + '</option>';
        }).join('');

        const assignOpts = (cachedContext.assignments || []).map(function (a) {
            return '<option value="' + esc(a.id) + '"' + (String(state.assignmentId) === String(a.id) ? ' selected' : '') + '>'
                + esc((a.target_date || '') + ' · ' + (a.title || a.id)) + '</option>';
        }).join('');

        const examTasks = listExamTasks(getSelectedAssignment());
        const taskOpts = '<option value="">＋ 新建考試任務</option>' + examTasks.map(function (t) {
            return '<option value="' + esc(t.id) + '"' + (String(state.taskId) === String(t.id) ? ' selected' : '') + '>'
                + esc(t.title + (t.jobId ? '（' + t.jobId + '）' : '')) + '</option>';
        }).join('');

        const sectionsHtml = state.sections.map(renderSectionRow).join('');
        const preview = state.lastPayload
            ? '<pre id="exam-json-preview" style="margin:0; max-height:180px; overflow:auto; font-size:0.75rem; background:#0F172A; color:#E2E8F0; padding:10px; border-radius:8px;">'
                + esc(JSON.stringify(state.lastPayload, null, 2)) + '</pre>'
            : '<div id="exam-json-preview" style="color:#94A3B8; font-size:0.85rem;">儲存或預覽後會顯示 JSON。</div>';

        return `
            <div style="background:white; border-radius:14px; padding:24px; max-width:820px; width:100%; max-height:92vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                    <h2 style="margin:0; color:#0F766E;">📝 考試出題單（匯出 exam_job）</h2>
                    <button type="button" onclick="window.FeatureExamJob._close()" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:#94A3B8;">✕</button>
                </div>
                <p style="margin:0 0 14px; color:#64748B; font-size:0.88rem; line-height:1.5;">
                    選作業後會<strong>自動帶入</strong>該作業錄音範圍（如 A pp. 1~2）與「N 題」說明；再補卷面模板即可匯出給 Python。
                    排版公式不在這裡設定。
                </p>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">綁定作業（寫入任務 raw_data）*
                        <select id="exam-assignment" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onAssignmentChange(this.value)">
                            <option value="">請選擇作業</option>
                            ${assignOpts}
                        </select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">考試任務
                        <select id="exam-task" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onTaskChange(this.value)">
                            ${taskOpts}
                        </select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">job_id（自動產生）
                        <input id="exam-job-id" type="text" class="form-control" value="${esc(state.jobId)}" readonly
                            style="width:100%; padding:8px; margin-top:2px; background:#F1F5F9;">
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">考試名稱（寫入 context／任務標題）
                        <input id="exam-title" type="text" class="form-control" value="${esc(state.examTitle)}"
                            placeholder="例如 Test／抽考" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">bank_id *
                        <select id="exam-bank" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">${bankOpts}</select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">layout_profile_id *
                        <select id="exam-layout" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">${layoutOpts}</select>
                    </label>
                </div>

                ${state.importNote
                    ? '<div style="background:#F0FDFA; border:1px solid #99F6E4; color:#0F766E; padding:8px 12px; border-radius:8px; margin-bottom:12px; font-size:0.85rem; font-weight:700;">' + esc(state.importNote) + '</div>'
                    : ''}

                <div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                    <strong style="color:#334155;">出題區段 sections *</strong>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-action" style="padding:4px 10px; font-size:0.8rem; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;"
                            onclick="window.FeatureExamJob._importFromAssignment()" ${state.assignmentId ? '' : 'disabled'}>↻ 重新從作業帶入</button>
                        <button type="button" class="btn btn-action" style="padding:4px 10px; font-size:0.8rem; background:#CCFBF1; color:#0F766E; border:1px solid #99F6E4;"
                            onclick="window.FeatureExamJob._addSection()">＋ 加區段</button>
                    </div>
                </div>
                <div id="exam-sections">${sectionsHtml}</div>

                <div style="display:flex; gap:16px; flex-wrap:wrap; margin:12px 0; font-size:0.85rem; font-weight:700; color:#334155;">
                    <label><input id="exam-out-pdf" type="checkbox" ${state.outputs.pdf ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> outputs: pdf</label>
                    <label><input id="exam-out-answer" type="checkbox" ${state.outputs.answer ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> outputs: answer</label>
                    <label><input id="exam-opt-shuffle" type="checkbox" ${state.options.shuffle ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> shuffle</label>
                    <label><input id="exam-opt-force-qnum" type="checkbox" ${state.options.force_qnum ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> force_qnum</label>
                    <label><input id="exam-opt-separate-pages" type="checkbox" ${state.options.separate_pages ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> separate_pages</label>
                </div>

                <details style="margin-bottom:12px;">
                    <summary style="cursor:pointer; color:#64748B; font-weight:700; font-size:0.85rem;">進階 options（表頭／含題／難度…）</summary>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:8px;">
                        <input id="exam-opt-header-left" class="form-control" placeholder="header_left" value="${esc(state.options.header_left)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-header-center" class="form-control" placeholder="header_center" value="${esc(state.options.header_center)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-header-right" class="form-control" placeholder="header_right" value="${esc(state.options.header_right)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-include-nums" class="form-control" placeholder="include_nums" value="${esc(state.options.include_nums)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-exclude-nums" class="form-control" placeholder="exclude_nums" value="${esc(state.options.exclude_nums)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-difficulty" class="form-control" placeholder="difficulty" value="${esc(state.options.difficulty)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                    </div>
                </details>

                <div style="margin-bottom:12px;">${preview}</div>

                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" class="btn btn-action" style="background:#0F766E; color:white; border:none; font-weight:800;"
                        onclick="window.FeatureExamJob._preview()">👁 預覽 JSON</button>
                    <button type="button" class="btn btn-action" style="background:#059669; color:white; border:none; font-weight:800;"
                        onclick="window.FeatureExamJob._saveAndExport()">💾 儲存任務並下載 JSON</button>
                    <button type="button" class="btn" style="font-weight:700;"
                        onclick="window.FeatureExamJob._copyOnly()">📋 複製 JSON</button>
                    <button type="button" class="btn" style="font-weight:700;"
                        onclick="window.FeatureExamJob._newJobId()">🔄 換新 job_id</button>
                </div>
            </div>
        `;
    }

    function renderBody() {
        const el = document.getElementById('exam-job-modal');
        if (!el) return;
        el.innerHTML = renderModalContentHtml();
    }

    function onFieldChange() {
        markDirty();
        syncFormFromDom();
    }

    function onRangeTypeChange(idx, value) {
        syncFormFromDom();
        if (state.sections[idx]) state.sections[idx].range_type = value;
        markDirty();
        renderBody();
    }

    function onAssignmentChange(id) {
        syncFormFromDom();
        state.assignmentId = id;
        state.taskId = '';
        state.importNote = '';
        const a = getSelectedAssignment();
        if (a) {
            applyHintsFromAssignment(a, { forceTitle: true });
            window.showFlash(state.importNote || '已選作業', state.sections.length ? 'success' : 'warning');
        }
        markDirty();
        renderBody();
    }

    function importFromAssignment() {
        syncFormFromDom();
        const a = getSelectedAssignment();
        if (!a) {
            window.showFlash('請先選擇作業', 'error');
            return;
        }
        applyHintsFromAssignment(a, { forceTitle: false });
        markDirty();
        renderBody();
        window.showFlash(state.importNote || '已重新帶入', state.sections.length ? 'success' : 'warning');
    }

    function onTaskChange(id) {
        syncFormFromDom();
        state.taskId = id;
        const a = getSelectedAssignment();
        const t = a && id ? findTaskById(a.tasks || [], id) : null;
        if (t && t.raw_data && t.raw_data.exam_job) {
            loadFromPayload(t.raw_data.exam_job, t.title || t.raw_data.exam_title || '');
            state.importNote = '已載入此考試任務既有的 exam_job。';
        }
        markDirty();
        renderBody();
    }

    function loadFromPayload(payload, title) {
        if (!payload) return;
        state.jobId = payload.job_id || state.jobId || newJobId();
        state.examTitle = title || (payload.context && payload.context.exam_title) || state.examTitle;
        state.bankId = payload.bank_id || state.bankId;
        state.layoutProfileId = payload.layout_profile_id || state.layoutProfileId;
        state.sections = Array.isArray(payload.sections) && payload.sections.length
            ? payload.sections.map(function (s) {
                return {
                    sheet_id: s.sheet_id || '',
                    range_type: s.range_type || 'page',
                    start: s.start,
                    end: s.end,
                    count: s.count,
                    lines_per_page: s.lines_per_page || 10
                };
            })
            : state.sections;
        const outs = payload.outputs || [];
        state.outputs.pdf = outs.indexOf('pdf') !== -1;
        state.outputs.answer = outs.indexOf('answer') !== -1;
        if (payload.options) {
            Object.keys(state.options).forEach(function (k) {
                if (payload.options[k] !== undefined) state.options[k] = payload.options[k];
            });
        }
        state.lastPayload = payload;
    }

    function addSection() {
        syncFormFromDom();
        state.sections.push({
            sheet_id: 'K',
            range_type: 'page',
            start: 1,
            end: 1,
            count: 10,
            lines_per_page: 10
        });
        markDirty();
        renderBody();
    }

    function removeSection(idx) {
        syncFormFromDom();
        if (state.sections.length <= 1) return;
        state.sections.splice(idx, 1);
        markDirty();
        renderBody();
    }

    function preview() {
        try {
            const payload = validateAndBuildPayload();
            state.lastPayload = payload;
            renderBody();
            window.showFlash('JSON 預覽已更新', 'success');
        } catch (err) {
            window.showFlash(err.message || String(err), 'error');
        }
    }

    async function saveAndExport() {
        try {
            const payload = validateAndBuildPayload();
            await persistToAssignment(payload);
            state.lastPayload = payload;
            state.dirty = false;
            downloadJson(payload);
            renderBody();
            window.showFlash('已寫入考試任務並下載 exam_job（job_id: ' + payload.job_id + '）', 'success');
            if (window.FeatureProgress && cachedContext && typeof window.FeatureProgress.refresh === 'function') {
                // 不強制刷新進度表，避免打斷；老師可自行重整
            }
        } catch (err) {
            console.error('[FeatureExamJob]', err);
            window.showFlash('儲存／匯出失敗：' + (err.message || err), 'error');
        }
    }

    async function copyOnly() {
        try {
            const payload = validateAndBuildPayload();
            state.lastPayload = payload;
            await copyJson(payload);
            renderBody();
            window.showFlash('已複製 JSON（尚未寫入任務；若要對回請按「儲存任務並下載」）', 'success');
        } catch (err) {
            window.showFlash(err.message || String(err), 'error');
        }
    }

    function rotateJobId() {
        state.jobId = newJobId();
        state.taskId = '';
        markDirty();
        renderBody();
    }

    function closeModal() {
        window.ModalOverlay.close('exam-job-modal');
    }

    function resetState() {
        state.jobId = newJobId();
        state.examTitle = '';
        state.bankId = BANK_CATALOG[0] ? BANK_CATALOG[0].id : '';
        state.layoutProfileId = LAYOUT_CATALOG[0] ? LAYOUT_CATALOG[0].id : '';
        state.assignmentId = '';
        state.taskId = '';
        state.sections = [
            { sheet_id: 'K', range_type: 'page', start: 1, end: 2, count: 20, lines_per_page: 10 }
        ];
        state.outputs = { pdf: true, answer: true };
        state.options = {
            shuffle: true,
            force_qnum: true,
            separate_pages: false,
            header_left: '',
            header_center: '',
            header_right: '',
            include_nums: '',
            exclude_nums: '',
            difficulty: ''
        };
        state.lastPayload = null;
        state.dirty = false;
        state.importNote = '';
        if (cachedContext && cachedContext.className) {
            state.bankId = inferBankId(cachedContext.className) || state.bankId;
        }
    }

    function renderEntryButton(classId, assignments, className) {
        cachedContext = {
            classId: classId,
            className: className || '',
            assignments: assignments || []
        };
        return `
            <button type="button" class="btn btn-action" onclick="window.FeatureExamJob.openModal()"
                style="background:#F0FDFA; color:#0F766E; border:1px solid #99F6E4; font-weight:800;">
                📝 考試出題單（快捷）
            </button>
        `;
    }

    function openModal() {
        if (!cachedContext) {
            window.showFlash('請先開啟班級進度總表再使用出題單', 'error');
            return;
        }
        resetState();
        window.ModalOverlay.open({
            id: 'exam-job-modal',
            tier: 'B',
            isDirty: isDirty,
            unsavedMessage: '出題單尚未儲存，確定要關閉嗎？',
            contentHtml: renderModalContentHtml()
        });
    }

    /**
     * 作業編輯器內嵌：考試任務卡片上的出題區段表（對齊 Python 出題列欄位）
     */
    function renderInlineEditorHtml(pathStr, task) {
        const raw = (task && task.raw_data) || {};
        const job = raw.exam_job || {};
        const jobId = raw.exam_job_id || job.job_id || '';
        const bankId = job.bank_id || (BANK_CATALOG[0] && BANK_CATALOG[0].id) || '';
        const layoutId = job.layout_profile_id || (LAYOUT_CATALOG[0] && LAYOUT_CATALOG[0].id) || '';
        let sections = Array.isArray(job.sections) ? job.sections.slice() : [];

        // 區段空白時，自動從同層錄音 meta（圖二）繼承 A/B/C…＋pp. 範圍
        if (sectionsLookEmpty(sections) && window.BuilderStore && typeof window.BuilderStore.getState === 'function') {
            const bState = window.BuilderStore.getState();
            const audio = findPreferredAudioTask((bState && bState.tasks) || [], pathStr);
            const autoSecs = sectionsFromAudioTask(audio, DEFAULT_LINES_PER_PAGE);
            if (autoSecs.length) {
                sections = autoSecs;
                // 寫回 state，避免每次重繪都以為是空的又重算蓋掉老師微調
                if (!task.raw_data) task.raw_data = {};
                if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
                task.raw_data.exam_job.sections = sections;
            }
        }
        if (!sections.length) {
            sections = [{
                sheet_id: '',
                range_type: 'page',
                start: 1,
                end: 1,
                count: 10,
                lines_per_page: DEFAULT_LINES_PER_PAGE,
                difficulty: '',
                include_nums: '',
                exclude_nums: ''
            }];
        }
        const bankOpts = BANK_CATALOG.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (bankId === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>';
        }).join('');
        const layoutOpts = LAYOUT_CATALOG.map(function (l) {
            return '<option value="' + esc(l.id) + '"' + (layoutId === l.id ? ' selected' : '') + '>' + esc(l.label) + '</option>';
        }).join('');
        const fieldHint = layoutFieldHint(layoutId);
        const paperItemCount = (raw.quiz_paper && Array.isArray(raw.quiz_paper.items))
            ? raw.quiz_paper.items.length
            : 0;
        const paperCountHint = paperItemCount
            ? ('｜線上卷 ' + paperItemCount + ' 題')
            : '';

        let siblingAudio = null;
        if (window.BuilderStore && typeof window.BuilderStore.getState === 'function') {
            const bState = window.BuilderStore.getState();
            siblingAudio = findPreferredAudioTask((bState && bState.tasks) || [], pathStr);
        }

        let totalCountSum = 0;
        const rows = sections.map(function (s, idx) {
            let avail = countAvailableFromMeta(s, siblingAudio);
            const expected = expectedSlotsForSection(s);
            // 💣 雷區：已選 B.meta 但 Snapshot 只凍結到 A 時，不可用「~頁數×行數」粉飾成好像有題
            // （老師會以為 B 也 OK，顯示%卻是 —）。有點名該活頁 → 明示「需Snapshot」。
            let availIsEstimate = false;
            let availNeedsSnap = false;
            if (avail == null) {
                if (sectionSheetMentionedInAudio(s, siblingAudio)) {
                    availNeedsSnap = true;
                } else if (expected != null) {
                    // 手加空區段、尚未對到錄音 meta：才用預計格位
                    avail = expected;
                    availIsEstimate = true;
                } else {
                    availNeedsSnap = true;
                }
            }
            const countVal = Number(s.count);
            if (!isNaN(countVal)) totalCountSum += countVal;
            const availStr = availNeedsSnap
                ? '需Snapshot'
                : (avail == null ? '需Snapshot' : (availIsEstimate ? ('~' + avail) : String(avail)));
            const pctStr = formatDisplayPercent(
                s.count,
                (availIsEstimate || availNeedsSnap) ? null : avail
            );
            const overAvail = (!availIsEstimate && !availNeedsSnap && avail != null && avail >= 0
                && !isNaN(countVal) && countVal > avail);
            const countStyle = overAvail
                ? 'width:56px; padding:4px; border-color:#EF4444; color:#B91C1C; font-weight:800;'
                : 'width:56px; padding:4px;';
            const rtypeHint = s.range_type || 'page';
            const loHint = Math.min(Number(s.start) || 0, Number(s.end) || 0);
            const hiHint = Math.max(Number(s.start) || 0, Number(s.end) || 0);
            const availTitle = availNeedsSnap
                ? ('活頁 ' + (s.sheet_id || '') + ' 已在錄音 meta／範圍中，但尚未進入 Snapshot 快取；請等自動套用完成或按「套用 Snapshot」')
                : (availIsEstimate
                    ? ('尚未對到錄音 meta；暫以頁數×每頁行數＝' + expected)
                    : ((rtypeHint === 'qnum')
                        ? ('題號 ' + loHint + '~' + hiHint + ' 內的 meta 筆數' + (avail != null ? ('＝' + avail) : '（請先 Snapshot）'))
                        : ((avail != null && expected != null)
                            ? ('meta 筆數 ' + avail + '；預計格位 ' + expected)
                            : '範圍內 meta 實際筆數')));
            const availColor = (availIsEstimate || availNeedsSnap) ? '#D97706' : '#0F766E';
            const refreshAttr = ' onchange="window.FeatureExamJob._inlineRefreshAvail(\'' + pathStr + '\')"';
            return `
                <tr data-exam-inline-row="${idx}">
                    <td style="padding:4px;"><input id="exam-inline-sheet-${pathStr}-${idx}" class="form-control" value="${esc(s.sheet_id || '')}" style="width:52px; padding:4px;" placeholder="C"${refreshAttr}></td>
                    <td style="padding:4px;"><input id="exam-inline-lpp-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.lines_per_page || DEFAULT_LINES_PER_PAGE)}" style="width:56px; padding:4px;"${refreshAttr}></td>
                    <td style="padding:4px; max-width:160px;" title="由 layout_profile 決定；可之後改為可編輯帶入">
                        <div style="font-size:0.7rem; color:#475569; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(fieldHint)}</div>
                    </td>
                    <td style="padding:4px;">
                        <select id="exam-inline-rtype-${pathStr}-${idx}" class="form-control" style="padding:4px; min-width:72px;"${refreshAttr}>
                            <option value="page" ${(s.range_type || 'page') === 'page' ? 'selected' : ''}>頁碼</option>
                            <option value="qnum" ${s.range_type === 'qnum' ? 'selected' : ''}>題號</option>
                            <option value="row" ${s.range_type === 'row' ? 'selected' : ''}>資料列</option>
                        </select>
                    </td>
                    <td style="padding:4px;"><input id="exam-inline-start-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.start)}" style="width:56px; padding:4px;"${refreshAttr}></td>
                    <td style="padding:4px;"><input id="exam-inline-end-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.end)}" style="width:56px; padding:4px;"${refreshAttr}></td>
                    <td style="padding:4px;"><input id="exam-inline-diff-${pathStr}-${idx}" class="form-control" value="${esc(s.difficulty || '')}" style="width:64px; padding:4px;" placeholder="—"></td>
                    <td style="padding:4px;"><input id="exam-inline-inc-${pathStr}-${idx}" class="form-control" value="${esc(s.include_nums || '')}" style="width:64px; padding:4px;" placeholder="—"></td>
                    <td style="padding:4px;"><input id="exam-inline-exc-${pathStr}-${idx}" class="form-control" value="${esc(s.exclude_nums || '')}" style="width:64px; padding:4px;" placeholder="—"></td>
                    <td style="padding:4px;"><input id="exam-inline-count-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.count)}" style="${countStyle}" title="${overAvail ? '題數超過可用題數' : ''}"${refreshAttr}></td>
                    <td style="padding:4px; color:${availColor}; font-size:0.78rem; font-weight:800; text-align:center;" title="${esc(availTitle)}">${esc(availStr)}</td>
                    <td style="padding:4px; color:#64748B; font-size:0.75rem; text-align:center;">${esc(pctStr)}</td>
                    <td style="padding:4px;"><button type="button" class="btn" style="padding:2px 6px; color:#B91C1C;" onclick="window.FeatureExamJob._inlineRemoveSection('${pathStr}', ${idx})">刪</button></td>
                </tr>
            `;
        }).join('');

        return `
            <div id="exam-inline-wrap-${pathStr}" style="margin-top:8px; padding:12px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-size:0.82rem; color:#0F766E;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                    <strong>📝 考試出題區段</strong>
                    <span style="font-size:0.75rem; color:#64748B;">job_id：<code id="exam-inline-jobid-${pathStr}">${esc(jobId || '（儲存作業時產生）')}</code></span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <label style="font-weight:700;">bank_id
                        <select id="exam-inline-bank-${pathStr}" class="form-control" style="width:100%; padding:6px; margin-top:2px;">${bankOpts}</select>
                    </label>
                    <label style="font-weight:700;">layout_profile_id
                        <select id="exam-inline-layout-${pathStr}" class="form-control" style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._inlineOnLayoutChange && window.FeatureExamJob._inlineOnLayoutChange('${pathStr}')">${layoutOpts}</select>
                    </label>
                </div>
                <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:8px; font-weight:700; align-items:center;">
                    <label><input id="exam-inline-shuffle-${pathStr}" type="checkbox" ${(job.options && job.options.shuffle === false) ? '' : 'checked'}> shuffle</label>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.78rem; min-width:980px;">
                        <thead>
                            <tr style="background:#CCFBF1; color:#134E4A; text-align:left;">
                                <th style="padding:4px;">活頁</th>
                                <th style="padding:4px;">每頁行數</th>
                                <th style="padding:4px;">欄位</th>
                                <th style="padding:4px;">基準</th>
                                <th style="padding:4px;">起始</th>
                                <th style="padding:4px;">結束</th>
                                <th style="padding:4px;">難度</th>
                                <th style="padding:4px;">指定#</th>
                                <th style="padding:4px;">排除#</th>
                                <th style="padding:4px;">題數</th>
                                <th style="padding:4px;">可用題</th>
                                <th style="padding:4px;">顯示%</th>
                                <th style="padding:4px;"></th>
                            </tr>
                        </thead>
                        <tbody id="exam-inline-tbody-${pathStr}">${rows}</tbody>
                    </table>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center;">
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#CCFBF1; color:#0F766E; border:1px solid #99F6E4;"
                        onclick="window.FeatureExamJob._inlineAddSection('${pathStr}')"
                        title="在已帶入的基礎上再加一列（常用於同活頁另一段範圍）。日常請先按「從錄音範圍帶入」。">＋ 加區段</button>
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;"
                        onclick="window.FeatureExamJob._inlineImportFromSiblingAudio('${pathStr}')">↻ 從同作業錄音範圍帶入</button>
                    <button type="button" id="exam-inline-gen-btn-${pathStr}" class="btn btn-action" style="padding:4px 10px; background:#0F766E; color:white; border:none;"
                        onclick="window.FeatureExamJob._inlineGeneratePaper('${pathStr}')">📝 產生線上卷</button>
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#059669; color:white; border:none;"
                        onclick="window.FeatureExamJob._inlineExport('${pathStr}')">⬇ JSON</button>
                    <span style="margin-left:auto; font-weight:800; color:#134E4A; font-size:0.85rem;">總計考題 ${totalCountSum}${paperCountHint}</span>
                </div>
                <div id="exam-inline-gen-status-${pathStr}" style="margin-top:8px; min-height:1.2em; font-size:0.8rem; font-weight:800; color:#0F766E;"></div>
                <div style="margin-top:6px; color:#64748B; font-size:0.75rem;">請先「從錄音範圍帶入」。加區段＝再拆一列（例如同活頁另一頁碼範圍）。</div>
            </div>
        `;
    }

    function readInlineSections(pathStr) {
        const rows = document.querySelectorAll('#exam-inline-tbody-' + pathStr + ' tr[data-exam-inline-row]');
        const task = getBuilderTaskByPath(pathStr);
        const prevSecs = (task && task.raw_data && task.raw_data.exam_job
            && Array.isArray(task.raw_data.exam_job.sections))
            ? task.raw_data.exam_job.sections
            : [];
        const sections = [];
        rows.forEach(function (row) {
            const idx = row.getAttribute('data-exam-inline-row');
            const sheet = (document.getElementById('exam-inline-sheet-' + pathStr + '-' + idx) || {}).value || '';
            const lpp = Number((document.getElementById('exam-inline-lpp-' + pathStr + '-' + idx) || {}).value);
            const rtype = (document.getElementById('exam-inline-rtype-' + pathStr + '-' + idx) || {}).value || 'page';
            const start = Number((document.getElementById('exam-inline-start-' + pathStr + '-' + idx) || {}).value);
            const end = Number((document.getElementById('exam-inline-end-' + pathStr + '-' + idx) || {}).value);
            const count = Number((document.getElementById('exam-inline-count-' + pathStr + '-' + idx) || {}).value);
            const difficulty = String((document.getElementById('exam-inline-diff-' + pathStr + '-' + idx) || {}).value || '').trim();
            const include_nums = String((document.getElementById('exam-inline-inc-' + pathStr + '-' + idx) || {}).value || '').trim();
            const exclude_nums = String((document.getElementById('exam-inline-exc-' + pathStr + '-' + idx) || {}).value || '').trim();
            const sec = {
                sheet_id: String(sheet).trim(),
                range_type: rtype,
                start: start,
                end: end,
                count: count,
                lines_per_page: isNaN(lpp) || lpp <= 0 ? DEFAULT_LINES_PER_PAGE : lpp
            };
            if (difficulty) sec.difficulty = difficulty;
            if (include_nums) sec.include_nums = include_nums;
            if (exclude_nums) sec.exclude_nums = exclude_nums;
            // 起迄未改時保留不連續 pages/items（來自 range_spec）
            const prev = prevSecs[Number(idx)];
            if (prev
                && String(prev.sheet_id || '').toUpperCase() === String(sec.sheet_id || '').toUpperCase()
                && (prev.range_type || 'page') === rtype
                && Number(prev.start) === start
                && Number(prev.end) === end) {
                if (Array.isArray(prev.pages) && prev.pages.length) sec.pages = prev.pages.slice();
                if (Array.isArray(prev.items) && prev.items.length) sec.items = prev.items.slice();
                if (prev.range_spec) sec.range_spec = prev.range_spec;
            }
            sections.push(sec);
        });
        return sections;
    }

    function syncInlineEditor(pathStr, task) {
        if (!task) return;
        if (!task.raw_data) task.raw_data = {};
        const bankEl = document.getElementById('exam-inline-bank-' + pathStr);
        const layoutEl = document.getElementById('exam-inline-layout-' + pathStr);
        if (!bankEl && !layoutEl) return; // 非 exam 或尚未渲染

        const prevJob = task.raw_data.exam_job || {};
        let jobId = task.raw_data.exam_job_id || prevJob.job_id || '';
        if (!jobId) jobId = newJobId();

        // 輸出管道之後再做 UI；目前固定線上卷，只暴露 shuffle
        const outputs = Array.isArray(prevJob.outputs) && prevJob.outputs.length
            ? prevJob.outputs.filter(function (o) { return o && o !== 'answer'; })
            : ['online'];
        if (outputs.indexOf('online') === -1) outputs.unshift('online');

        const sections = readInlineSections(pathStr);
        const shuffle = !!(document.getElementById('exam-inline-shuffle-' + pathStr) || {}).checked;
        const payload = {
            job_id: jobId,
            bank_id: bankEl ? bankEl.value : '',
            layout_profile_id: layoutEl ? layoutEl.value : '',
            sections: sections,
            outputs: outputs,
            options: { shuffle: shuffle, force_qnum: true, separate_pages: false }
        };
        task.raw_data.exam_job_id = jobId;
        task.raw_data.exam_title = String(task.title || '').replace(/<[^>]*>?/gm, '').trim() || task.raw_data.exam_title || '';
        task.raw_data.exam_job = payload;
        const jobIdEl = document.getElementById('exam-inline-jobid-' + pathStr);
        if (jobIdEl) jobIdEl.textContent = jobId;
        return payload;
    }

    function getBuilderTaskByPath(pathStr) {
        if (!window.BuilderStore || typeof window.BuilderStore.getState !== 'function') return null;
        const bState = window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks)) return null;
        const arr = String(pathStr).split('-').map(Number);
        let list = bState.tasks;
        let node = null;
        for (let i = 0; i < arr.length; i++) {
            node = list[arr[i]];
            if (!node) return null;
            if (i < arr.length - 1) list = node.subTasks || [];
        }
        return node;
    }

    function getSiblingAudioRangeLabel(examPathStr) {
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!bState) return '';
        const audio = findPreferredAudioTask((bState.tasks || []), examPathStr);
        if (!audio || !audio.raw_data) return '';
        let label = String(audio.raw_data.material_range || '').trim();
        if (!label && window.FeatureTimeline
            && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
            const refs = Array.isArray(audio.raw_data.material_refs) ? audio.raw_data.material_refs : [];
            label = String(window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '').trim();
        }
        if (!label) {
            label = String(audio.title || '').replace(/<[^>]*>?/gm, '').trim();
        }
        if (label === '錄音' || label === '考試') return '';
        return label;
    }

    function inlineAddSection(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = task.raw_data.exam_job || { sections: [] };
        if (!Array.isArray(job.sections)) job.sections = [];

        // 日常應先「從錄音範圍帶入」；加區段＝同一活頁再拆一列（例：同活頁另一頁碼／題號範圍）
        const last = job.sections.length ? job.sections[job.sections.length - 1] : null;
        job.sections.push({
            sheet_id: last ? String(last.sheet_id || '') : '',
            range_type: (last && last.range_type) || 'page',
            start: last ? Number(last.end) + 1 || 1 : 1,
            end: last ? Number(last.end) + 1 || 1 : 1,
            count: 10,
            lines_per_page: (last && last.lines_per_page) || DEFAULT_LINES_PER_PAGE,
            difficulty: '',
            include_nums: '',
            exclude_nums: ''
        });
        task.raw_data.exam_job = job;
        refreshExamBuilder();
        window.showFlash(
            last && last.sheet_id
                ? ('已加一列（預填活頁 ' + last.sheet_id + '，請改起迄／題數）')
                : '已加空白區段：請先「從錄音範圍帶入」，或自行填活頁字母',
            last && last.sheet_id ? 'success' : 'warning'
        );
    }

    function inlineRemoveSection(pathStr, idx) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = task.raw_data.exam_job;
        if (!job || !Array.isArray(job.sections) || job.sections.length <= 1) return;
        job.sections.splice(idx, 1);
        refreshExamBuilder();
    }

    function clampTotalInput(el) {
        if (!el) return;
        const raw = String(el.value || '').trim();
        if (raw === '') return;
        let n = Number(raw);
        if (isNaN(n) || n < 1) {
            el.value = '';
            return;
        }
        el.value = String(Math.floor(n));
    }

    function inlineDistribute(pathStr) {
        const totalEl = document.getElementById('exam-inline-total-' + pathStr);
        clampTotalInput(totalEl);
        const total = Number(totalEl && totalEl.value);
        if (!total || total <= 0) {
            window.showFlash('請先填「希望總題數」（正整數，例如 60），再按均分', 'error');
            return;
        }
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = task.raw_data.exam_job;
        if (!job || !job.sections || !job.sections.length) return;
        job.sections = distributeTotalCount(job.sections, total);
        refreshExamBuilder();
        window.showFlash('已將 ' + total + ' 題均分到各區段（可再逐列修改）', 'success');
    }

    function mergeMaterialRefsPreserveMeta(domRefs, existingRefs) {
        const byKey = {};
        (existingRefs || []).forEach(function (r) {
            if (!r) return;
            const k = String(r.material_folder || '') + '::' + String(r.published_file || '');
            if (k !== '::') byKey[k] = r;
        });
        return (domRefs || []).map(function (d) {
            const k = String(d.material_folder || '') + '::' + String(d.published_file || '');
            const old = byKey[k];
            if (!old) return d;
            return Object.assign({}, old, d, {
                fileId: d.fileId || old.fileId || '',
                schema_id: d.schema_id || old.schema_id || '',
                materials_root_kind: d.materials_root_kind || old.materials_root_kind || 'teacher'
            });
        });
    }

    function inlineImportFromSiblingAudio(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return;
        syncInlineEditor(pathStr, task);

        const audioHit = findPreferredAudioHit(bState.tasks || [], pathStr);
        const audio = audioHit ? audioHit.task : null;
        const audioPath = audioHit ? audioHit.pathStr : '';
        const rootEl = audioPath ? document.getElementById('node-material-root-' + audioPath) : null;
        const rootKind = rootEl && String(rootEl.value || '').toLowerCase() === 'class' ? 'class' : 'teacher';

        const existingRefs = (audio && audio.raw_data && Array.isArray(audio.raw_data.material_refs))
            ? audio.raw_data.material_refs
            : [];
        const domRefs = audioPath ? readDomMaterialRefs(audioPath, rootKind) : [];
        // DOM 有值優先（老師剛改的範圍）；否則用已 Snapshot 的 refs
        const sourceRefs = domRefs.length
            ? mergeMaterialRefsPreserveMeta(domRefs, existingRefs)
            : existingRefs;

        let sections = [];
        if (sourceRefs.length) {
            sections = sectionsFromMaterialRefs(sourceRefs, DEFAULT_LINES_PER_PAGE);
        }
        if (!sections.length) {
            sections = sectionsFromAudioTask(audio, DEFAULT_LINES_PER_PAGE);
        }
        if (!sections.length && audio && Array.isArray(audio.raw_data && audio.raw_data.grading_units)) {
            sections = sectionsFromGradingUnits(audio.raw_data.grading_units, DEFAULT_LINES_PER_PAGE);
        }
        if (!sections.length) {
            const fakeAssignment = { tasks: bState.tasks || [], title: bState.title || '' };
            const hints = extractHintsFromAssignment(fakeAssignment);
            sections = sectionsFromAudioTask(hints.audioTask, DEFAULT_LINES_PER_PAGE);
            if (!sections.length) sections = parseMaterialRangeToSections(hints.rangeText, DEFAULT_LINES_PER_PAGE);
            if (!sections.length && hints.materialRefs) {
                sections = sectionsFromMaterialRefs(hints.materialRefs, DEFAULT_LINES_PER_PAGE);
            }
            if (!sections.length && hints.gradingUnits) {
                sections = sectionsFromGradingUnits(hints.gradingUnits, DEFAULT_LINES_PER_PAGE);
            }
        }

        if (!sections.length) {
            window.showFlash('同作業找不到錄音 meta／範圍可帶入（請先在錄音任務設好 meta 列）', 'warning');
            return;
        }

        // 題數預設＝實際可用題
        sections = sections.map(function (sec) {
            const next = Object.assign({}, sec);
            const avail = countAvailableFromMeta(next, audio);
            if (avail != null && avail >= 0) {
                next.count = avail;
            } else if (!(Number(next.count) > 0)) {
                const expected = expectedSlotsForSection(next);
                if (expected != null) next.count = expected;
            }
            return next;
        });

        if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
        task.raw_data.exam_job.sections = sections;
        if (audio && sourceRefs.length) {
            if (!audio.raw_data) audio.raw_data = {};
            audio.raw_data.material_refs = sourceRefs;
        }
        // 不可一般 refreshBuilder：會 sync 舊 DOM 把剛寫入的區段蓋掉
        refreshExamBuilder();
        const missing = sections.filter(function (s) {
            return countAvailableFromMeta(s, audio) == null;
        }).map(function (s) { return s.sheet_id; });
        let msg = '已帶入 ' + sections.length + ' 個區段；可用題已依 Snapshot／meta 重算';
        if (missing.length) {
            msg += '（活頁 ' + missing.join('/') + ' 尚無 Snapshot，顯示為預估）';
        }
        window.showFlash(msg, missing.length ? 'warning' : 'success');
    }

    function inlineRefreshAvail(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        refreshExamBuilder();
    }

    /** 錄音 Snapshot 後：重算同層考試可用題；標題若為自動繼承則同步 */
    function refreshAfterAudioSnapshot(audioPathStr) {
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks)) return;
        const arr = String(audioPathStr || '').split('-').map(Number).filter(function (n) { return !isNaN(n); });
        let list = bState.tasks;
        const base = [];
        for (let i = 0; i < arr.length - 1; i++) {
            const node = list[arr[i]];
            if (!node) return;
            base.push(arr[i]);
            list = node.subTasks || [];
        }
        const audioNode = list[arr[arr.length - 1]];
        let rangeLabel = (audioNode && audioNode.raw_data)
            ? String(audioNode.raw_data.material_range || '').trim()
            : '';
        if (!rangeLabel && audioNode && window.FeatureTimeline
            && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
            const refs = (audioNode.raw_data && Array.isArray(audioNode.raw_data.material_refs))
                ? audioNode.raw_data.material_refs : [];
            rangeLabel = String(window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '').trim();
        }
        for (let i = 0; i < (list || []).length; i++) {
            const t = list[i];
            if (!t || t.type !== 'exam') continue;
            const examPath = base.concat([i]).join('-');
            if (rangeLabel) {
                const titleEl = document.getElementById('node-title-' + examPath);
                const plain = titleEl
                    ? String(titleEl.textContent || '').trim()
                    : String(t.title || '').replace(/<[^>]*>/g, '').trim();
                const autoFlag = titleEl ? titleEl.getAttribute('data-title-auto') : null;
                const prevFrom = titleEl
                    ? String(titleEl.getAttribute('data-title-from-range') || '').trim()
                    : '';
                if (!plain || autoFlag === '1' || (prevFrom && plain === prevFrom) || plain === '考試') {
                    t.title = rangeLabel;
                    if (titleEl) {
                        titleEl.textContent = rangeLabel;
                        titleEl.setAttribute('data-title-auto', '1');
                        titleEl.setAttribute('data-title-from-range', rangeLabel);
                    }
                }
            }
            if (!t.raw_data) t.raw_data = {};
            if (!t.raw_data.exam_job || !Array.isArray(t.raw_data.exam_job.sections)) continue;
            const audio = findPreferredAudioTask(bState.tasks, examPath);
            t.raw_data.exam_job.sections = t.raw_data.exam_job.sections.map(function (sec) {
                const next = Object.assign({}, sec);
                const avail = countAvailableFromMeta(next, audio);
                if (avail != null && avail >= 0) {
                    const c = Number(next.count);
                    if (isNaN(c) || c > avail || !(c > 0)) next.count = avail;
                }
                return next;
            });
        }
        refreshExamBuilder();
    }

    function inlineExport(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        const payload = syncInlineEditor(pathStr, task);
        if (!payload || !payload.sections || !payload.sections.length) {
            window.showFlash('請至少填一個區段', 'error');
            return;
        }
        for (let i = 0; i < payload.sections.length; i++) {
            if (!payload.sections[i].sheet_id) {
                window.showFlash('區段 ' + (i + 1) + ' 缺少活頁 sheet_id', 'error');
                return;
            }
        }
        downloadJson(payload);
        window.showFlash('已下載 exam_job（請記得按「儲存作業」把設定寫進資料庫）', 'success');
    }

    function resolveExamMaterialContext(pathStr, bState, audioHit) {
        const audioTask = audioHit && audioHit.task;
        const audioPath = audioHit && audioHit.pathStr;
        const rootEl = audioPath ? document.getElementById('node-material-root-' + audioPath) : null;
        const uiRootKind = rootEl && String(rootEl.value || '').toLowerCase() === 'class' ? 'class' : 'teacher';

        let refs = audioPath ? readDomMaterialRefs(audioPath, uiRootKind) : [];
        if (!refs.length && audioTask && audioTask.raw_data) {
            if (Array.isArray(audioTask.raw_data.material_refs) && audioTask.raw_data.material_refs.length) {
                refs = audioTask.raw_data.material_refs;
            } else if (audioTask.raw_data.material_ref && audioTask.raw_data.material_ref.published_file) {
                refs = [audioTask.raw_data.material_ref];
            }
        }
        if (!refs.length) {
            throw new Error('同層錄音尚未設定 material meta（請先選 meta；建議再按一次套用 Snapshot）');
        }
        const primary = refs[0] || {};
        const materialFolder = String(primary.material_folder || '').trim();
        if (!materialFolder) throw new Error('找不到 material_folder（meta 下拉值應為 資料夾::檔名）');
        const rootKind = String(primary.materials_root_kind || uiRootKind || 'teacher').trim().toLowerCase() === 'class'
            ? 'class'
            : 'teacher';
        const schemaId = String(primary.schema_id || 'gept-2_sentence').trim();
        return {
            refs: refs,
            materialFolder: materialFolder,
            rootKind: rootKind,
            schemaId: schemaId,
            audioPath: audioPath || ''
        };
    }

    async function readMaterialFileWithFallback(folderIdTeacher, folderIdClass, materialFolder, fileName, preferredKind) {
        const order = preferredKind === 'class' ? ['class', 'teacher'] : ['teacher', 'class'];
        let lastErr = null;
        for (let i = 0; i < order.length; i++) {
            const kind = order[i];
            const folderId = kind === 'teacher' ? folderIdTeacher : folderIdClass;
            if (!folderId) continue;
            try {
                const fileResult = await window.GasService.readMaterialFile(
                    folderId, materialFolder, fileName, kind
                );
                return { fileResult: fileResult, rootKind: kind, folderId: folderId };
            } catch (err) {
                lastErr = err;
            }
        }
        throw new Error(
            'GAS 無法讀取「' + materialFolder + '/' + fileName + '」：'
            + ((lastErr && lastErr.message) ? lastErr.message : lastErr)
            + '（已試老師／班級根目錄）'
        );
    }

    async function resolveRootFolderId(classId, rootKind) {
        if (rootKind === 'teacher') {
            if (!window.FeatureResource || typeof window.FeatureResource.getTeacherPersonalDriveFolderId !== 'function') {
                throw new Error('FeatureResource 未載入');
            }
            let folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(true);
            if (!folderId && typeof window.FeatureResource.ensureAndBindTeacherPersonalDrive === 'function') {
                await window.FeatureResource.ensureAndBindTeacherPersonalDrive();
                folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(false);
            }
            if (!folderId) throw new Error('尚未綁定老師個人資料夾');
            return folderId;
        }
        const db = window.TeacherDB;
        const cls = db && Array.isArray(db.classes)
            ? db.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        let raw = (cls && (cls.raw_data || cls.rawData)) || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        const classFolderId = raw.drive_folder_id || raw.class_folder_id || '';
        if (!classFolderId) throw new Error('此班級尚未設定 Drive 資料夾');
        return classFolderId;
    }

    function setGenerateStatus(pathStr, text, tone) {
        const el = document.getElementById('exam-inline-gen-status-' + pathStr);
        const btn = document.getElementById('exam-inline-gen-btn-' + pathStr);
        if (el) {
            el.textContent = text || '';
            el.style.color = tone === 'error' ? '#B91C1C'
                : (tone === 'success' ? '#059669'
                    : (tone === 'warn' ? '#D97706' : '#0F766E'));
        }
        if (btn) {
            const busy = tone === 'busy';
            btn.disabled = !!busy;
            btn.style.opacity = busy ? '0.65' : '1';
            btn.textContent = busy ? '⏳ 產生中…' : '📝 產生線上卷';
        }
    }

    async function inlineGeneratePaper(pathStr) {
        if (!window.QuizPaperBuilder || typeof window.QuizPaperBuilder.buildQuizPaper !== 'function') {
            return window.showFlash('QuizPaperBuilder 未載入，請硬重新整理老師頁', 'error');
        }
        if (!window.LayoutFieldsEval) {
            return window.showFlash('LayoutFieldsEval 未載入，請硬重新整理老師頁', 'error');
        }
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return;
        const examJob = syncInlineEditor(pathStr, task);
        if (!examJob || !examJob.sections || !examJob.sections.length) {
            return window.showFlash('請至少填一個區段', 'error');
        }
        for (let i = 0; i < examJob.sections.length; i++) {
            if (!examJob.sections[i].sheet_id) {
                return window.showFlash('區段 ' + (i + 1) + ' 缺少 sheet_id', 'error');
            }
        }

        const audioHit = findPreferredAudioHit(bState.tasks || [], pathStr);
        let ctx;
        try {
            ctx = resolveExamMaterialContext(pathStr, bState, audioHit);
        } catch (err) {
            setGenerateStatus(pathStr, '❌ ' + (err.message || err), 'error');
            return window.showFlash(err.message || String(err), 'error');
        }

        setGenerateStatus(pathStr, '⏳ 正在產生線上卷…（優先用 Snapshot 快取）', 'busy');
        window.showFlash('正在產生線上卷…', 'info');
        try {
            const audioRaw = (audioHit && audioHit.task && audioHit.task.raw_data) || {};
            const localRowsByStem = audioRaw.meta_rows_by_stem || {};
            const fileIdByStem = {};
            (ctx.refs || []).forEach(function (r) {
                const stem = String(r.label || '').trim().toUpperCase()
                    || String(r.published_file || '').replace(/\.meta\.json$/i, '').toUpperCase();
                if (stem && r.fileId) fileIdByStem[stem] = r.fileId;
            });

            let folderIdTeacher = '';
            let folderIdClass = '';
            try { folderIdTeacher = await resolveRootFolderId(bState.classId, 'teacher'); } catch (_e) {}
            try { folderIdClass = await resolveRootFolderId(bState.classId, 'class'); } catch (_e) {}

            const needRemote = [];
            const sheetIds = [];
            (examJob.sections || []).forEach(function (sec) {
                const sid = String(sec.sheet_id || '').trim().toUpperCase();
                if (!sid || sheetIds.indexOf(sid) >= 0) return;
                sheetIds.push(sid);
                const local = localRowsByStem[sid];
                if (!(Array.isArray(local) && local.length)) {
                    needRemote.push({
                        materialFolder: ctx.materialFolder,
                        fileName: sid + '.meta.json',
                        fileId: fileIdByStem[sid] || '',
                        sheetId: sid
                    });
                }
            });
            needRemote.push({
                materialFolder: ctx.materialFolder,
                fileName: '_layout.json',
                fileId: '',
                sheetId: '__LAYOUT__'
            });

            const remoteByName = {};
            if (needRemote.length) {
                setGenerateStatus(pathStr, '⏳ 讀取 Drive（一批 ' + needRemote.length + ' 檔）…', 'busy');
                const order = ctx.rootKind === 'class'
                    ? [{ id: folderIdClass, kind: 'class' }, { id: folderIdTeacher, kind: 'teacher' }]
                    : [{ id: folderIdTeacher, kind: 'teacher' }, { id: folderIdClass, kind: 'class' }];
                let lastBatchErr = null;
                for (let oi = 0; oi < order.length; oi++) {
                    const root = order[oi];
                    if (!root.id) continue;
                    try {
                        let usedBatch = false;
                        if (typeof window.GasService.readMaterialFiles === 'function') {
                            try {
                                const files = await window.GasService.readMaterialFiles(root.id, needRemote, root.kind);
                                (files || []).forEach(function (f, idx) {
                                    const key = needRemote[idx] ? needRemote[idx].fileName : (f && f.fileName);
                                    if (f && f.ok && key) remoteByName[key] = f;
                                });
                                usedBatch = true;
                            } catch (batchUnsupported) {
                                console.warn('[FeatureExamJob] batch 讀檔不可用，改逐檔', batchUnsupported);
                            }
                        }
                        if (!usedBatch) {
                            for (let ri = 0; ri < needRemote.length; ri++) {
                                const it = needRemote[ri];
                                if (remoteByName[it.fileName]) continue;
                                try {
                                    const one = await window.GasService.readMaterialFile(
                                        root.id, it.materialFolder, it.fileName, root.kind,
                                        it.fileId ? { fileId: it.fileId } : undefined
                                    );
                                    remoteByName[it.fileName] = Object.assign({ ok: true }, one);
                                } catch (_oneErr) {}
                            }
                        }
                        const stillMissing = sheetIds.filter(function (sid) {
                            return !(Array.isArray(localRowsByStem[sid]) && localRowsByStem[sid].length)
                                && !remoteByName[sid + '.meta.json'];
                        });
                        if (!stillMissing.length) {
                            ctx.rootKind = root.kind;
                            break;
                        }
                        lastBatchErr = new Error('缺 meta：' + stillMissing.join(', '));
                    } catch (batchErr) {
                        lastBatchErr = batchErr;
                    }
                }
                const missingMeta = sheetIds.filter(function (sid) {
                    return !(Array.isArray(localRowsByStem[sid]) && localRowsByStem[sid].length)
                        && !remoteByName[sid + '.meta.json'];
                });
                if (missingMeta.length) {
                    throw lastBatchErr || new Error(
                        '無法讀取 meta：' + missingMeta.join(', ')
                        + '（請確認 Drive 有 ' + ctx.materialFolder
                        + '，或先對錄音套用含該活頁的 Snapshot）'
                    );
                }
            }

            let layout = null;
            const layoutFile = remoteByName['_layout.json'];
            if (layoutFile && layoutFile.content) {
                try { layout = JSON.parse(layoutFile.content); } catch (_pe) { layout = null; }
            }
            if (!layout) {
                layout = {
                    material_folder: ctx.materialFolder,
                    default_profile_id: examJob.layout_profile_id,
                    col_map: (window.QuizPaperBuilder && window.QuizPaperBuilder.FALLBACK_COL_MAP) || {},
                    profiles: [{
                        profile_id: examJob.layout_profile_id,
                        label: examJob.layout_profile_id,
                        fields: layoutFieldHint(examJob.layout_profile_id),
                        fields_answer: 'X',
                        lines_per_page: DEFAULT_LINES_PER_PAGE
                    }]
                };
            }

            const schemaBySheet = {};
            (ctx.refs || []).forEach(function (r) {
                const stem = String(r.label || '').trim().toUpperCase()
                    || String(r.published_file || '').replace(/\.meta\.json$/i, '').toUpperCase();
                if (stem) schemaBySheet[stem] = String(r.schema_id || ctx.schemaId || '').trim();
            });

            setGenerateStatus(pathStr, '⏳ 抽題排版中…', 'busy');
            const paper = await window.QuizPaperBuilder.buildQuizPaper({
                examJob: examJob,
                layout: layout,
                loadSheetMeta: async function (sheetId) {
                    const sid = String(sheetId || '').trim().toUpperCase();
                    let rows = localRowsByStem[sid];
                    if (!(Array.isArray(rows) && rows.length)) {
                        const remote = remoteByName[sid + '.meta.json'];
                        if (!remote || !remote.content) {
                            throw new Error('沒有活頁 ' + sid + ' 的 meta（請先 Snapshot 或確認 Drive 檔案）');
                        }
                        rows = window.MaterialSnapshot
                            ? window.MaterialSnapshot.parseMetaContent(remote.content)
                            : JSON.parse(remote.content);
                        if (audioHit && audioHit.task) {
                            if (!audioHit.task.raw_data) audioHit.task.raw_data = {};
                            if (!audioHit.task.raw_data.meta_rows_by_stem) {
                                audioHit.task.raw_data.meta_rows_by_stem = {};
                            }
                            audioHit.task.raw_data.meta_rows_by_stem[sid] = rows;
                        }
                    }
                    return {
                        rows: rows,
                        schemaId: schemaBySheet[sid] || ctx.schemaId || '',
                        materialFolder: ctx.materialFolder
                    };
                }
            });

            if (!task.raw_data) task.raw_data = {};
            task.raw_data.quiz_paper = paper;
            task.raw_data.exam_job = examJob;
            task.raw_data.exam_job_id = examJob.job_id;
            if (audioHit && audioHit.task && ctx.refs.length) {
                if (!audioHit.task.raw_data) audioHit.task.raw_data = {};
                audioHit.task.raw_data.material_refs = ctx.refs;
            }

            refreshExamBuilder();
            const msg = '✅ 已產生線上卷 ' + (paper.items || []).length
                + ' 題。請立刻按「儲存作業」，學生端才看得到。';
            setGenerateStatus(pathStr, msg, 'success');
            window.showFlash(msg, 'success');
        } catch (err) {
            console.error('[FeatureExamJob] generate paper', err);
            const msg = '產生線上卷失敗：' + (err.message || err);
            setGenerateStatus(pathStr, '❌ ' + msg, 'error');
            window.showFlash(msg, 'error');
            try { window.alert(msg); } catch (_e) {}
        }
    }

    return {
        renderEntryButton: renderEntryButton,
        openModal: openModal,
        renderInlineEditorHtml: renderInlineEditorHtml,
        syncInlineEditor: syncInlineEditor,
        _close: closeModal,
        _onFieldChange: onFieldChange,
        _onRangeTypeChange: onRangeTypeChange,
        _onAssignmentChange: onAssignmentChange,
        _importFromAssignment: importFromAssignment,
        _onTaskChange: onTaskChange,
        _addSection: addSection,
        _removeSection: removeSection,
        _preview: preview,
        _saveAndExport: saveAndExport,
        _copyOnly: copyOnly,
        _newJobId: rotateJobId,
        _inlineAddSection: inlineAddSection,
        _inlineRemoveSection: inlineRemoveSection,
        _inlineDistribute: inlineDistribute,
        _inlineImportFromSiblingAudio: inlineImportFromSiblingAudio,
        _inlineRefreshAvail: inlineRefreshAvail,
        _refreshAfterAudioSnapshot: refreshAfterAudioSnapshot,
        getSiblingAudioRangeLabel: getSiblingAudioRangeLabel,
        _inlineExport: inlineExport,
        _inlineGeneratePaper: inlineGeneratePaper,
        _inlineOnLayoutChange: function (pathStr) {
            if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
            const task = getBuilderTaskByPath(pathStr);
            if (!task) return;
            syncInlineEditor(pathStr, task);
            refreshExamBuilder();
        }
    };
})();

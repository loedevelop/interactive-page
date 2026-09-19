/**
 * 套餐名＋範圍字串共用計算——teacher／student 兩端同一把鑰匙。
 *
 * 來源：110_teacher_core/feature-timeline.js 的 combinePackRangeLabel／groupPackSummaryHtml
 * 一整條計算鏈（pickPackComboName、isBookPackRow、mergePickedIntervals…）忠實搬過來，供
 * student 端即時計算「組合層（範圍套餐群組）自己的說明」，不依賴 teacher 才會存的
 * task.description（舊資料還沒被老師重新開過 builder 存檔前，那欄可能是空的或舊 dump）。
 *
 * 2026-09-15 老師定案：組合層底下子任務標題／說明一律留空，套餐名＋範圍只在群組層的說明顯示
 * 一次。student 端沒有載入 feature-timeline.js（那支是 teacher 建構器專用、綁了大量 DOM／
 * BuilderStore 狀態），所以這份計算鏈另外抽成這支純函式共用檔，兩端都能載。
 *
 * 💣 雷區：這份跟 feature-timeline.js 裡對應同名函式是「刻意保留兩份」，不是疏漏──
 * feature-timeline.js 內部還有十幾個別的函式（sheetPackDescriptionLines／
 * packRangeDescriptionHtml…）也在用這條計算鏈的中間函式，直接刪掉改成呼叫這支共用檔
 * 風險太高（教材建構器已經上線、測過的行為可能被牽動）。若之後要改這條計算邏輯
 * （combinePackRangeLabel／pickPackComboName…算法本身），兩份要一起改，不准只改一份。
 *
 * 每個函式都依賴的教材／套餐快取（window.FeatureClassMaterialCombinations、
 * window.FeatureMaterialBook、window.MaterialFileNames）只在 teacher 端有載入；student 端
 * 這些全域變數不存在時，各函式都會自動退回讀 row 上已存的欄位（combo_label／comboLabel、
 * primary_unit…），不會噴錯、也不會借用別筆資料——精準是第一條，對不到就是沒有活頁別名可用，
 * 不影響範圍數字本身的正確性。
 */
(function () {
    'use strict';

    /** 舊標題把活頁別名當標題（J.sentence-translation pp. 1~2 ; …）。同一區段連續範圍卻一行一行分號，也是自動稿，要重算。 */
    function titleLooksLikeSheetAliasDump(text) {
        const s = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!s) return false;
        if (/[A-Za-z0-9]+\.[A-Za-z0-9_-]+\s*pp?\./i.test(s)) return true;
        if (/[A-Za-z0-9]+\.[A-Za-z0-9_-]+\s*#/i.test(s)) return true;
        const parts = s.split(/\s*;\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.length < 2) return false;
        const labels = {};
        let i;
        for (i = 0; i < parts.length; i++) {
            const m = parts[i].match(/^(.+?)\s+(?:pp?\.\s*\d+(?:\s*[~\-]\s*\d+)?|#\s*\d+(?:\s*[~\-]\s*\d+)?)$/i);
            if (!m) return false;
            const lab = m[1].replace(/\s+/g, ' ').trim().toUpperCase();
            labels[lab] = (labels[lab] || 0) + 1;
        }
        return Object.keys(labels).some(function (k) { return labels[k] > 1; });
    }

    function comboNameLooksLikeSheetAlias(name) {
        const s = String(name || '').trim();
        if (!s) return false;
        if (/^[A-Za-z0-9]+\.[A-Za-z0-9_-]+$/i.test(s)) return true;
        return titleLooksLikeSheetAliasDump(s);
    }

    /**
     * 這個群組節點是不是「範圍套餐群組」──teacher／student 兩端唯一一把鑰匙，2026-09-15
     * 從各自檔案裡的重複實作搬進這支共用檔（student 端原本漏比對 meta_file／metaFile，
     * 兩邊各寫一份已經走樣，統一到這裡改一次兩端都套用，不准再各自留一份）。
     */
    function groupIsRangePack(group) {
        if (!group || group.type !== 'group' || !group.raw_data) return false;
        if (group.raw_data.group_role === 'range') return true;
        if (String(group.raw_data.pack_combo_id || '').trim()) return true;
        const rows = Array.isArray(group.raw_data.pack_rows) ? group.raw_data.pack_rows : [];
        return rows.some(function (r) {
            return !!(String((r && (r.combo_id || r.comboId)) || '').trim()
                || String((r && (r.primary_unit || r.primaryUnit)) || '').trim()
                || String((r && (r.secondary_unit || r.secondaryUnit)) || '').trim()
                || String((r && r.page) || '').trim()
                || String((r && (r.meta_file || r.metaFile)) || '').trim());
        });
    }

    /**
     * 目錄小標題曾被 combinePackRangeLabel 寫成
     * 「Azar-1-4th 13 / 8 / … ; Azar-1-4th 13 / 3 / …」。套餐名就是每段開頭重複的那串。
     * teacher／student 同一把鑰匙，2026-09-15 從各自檔案搬進這支共用檔。
     */
    function comboNameFromBookConcatTitle(text) {
        const s = String(text || '').replace(/<[^>]*>/g, '').trim();
        if (!s) return '';
        const segs = s.split(/\s*[;；]\s*/).filter(Boolean);
        if (!segs.length) return '';
        const m = segs[0].match(/^(.+?)\s+\d+\s*\/\s*/);
        if (!m) return '';
        const name = String(m[1] || '').trim();
        if (!name) return '';
        const ok = segs.every(function (seg) {
            return seg === name || seg.indexOf(name + ' ') === 0;
        });
        return ok ? name : '';
    }

    /** teacher 端才有的已指派套餐快取；student 端沒有這個全域就回 null（不猜、不借）。 */
    function resolvePackCombo(classId, comboId) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (!comboId || !fcmc || typeof fcmc.getAssignedComboById !== 'function') return null;
        return fcmc.getAssignedComboById(classId, comboId) || null;
    }

    function comboLabelText(src) {
        const fcmc = window.FeatureClassMaterialCombinations;
        if (fcmc && typeof fcmc.comboLabelText === 'function') return fcmc.comboLabelText(src);
        if (src == null) return '';
        if (typeof src === 'string') return String(src).trim();
        return String(src.combo_label || src.comboLabel || src.rawLabel || '').trim();
    }

    /** 套餐名：teacher 端優先讀已指派套餐快取的即時名稱；沒有快取（student 端）就讀這一列已存的 combo_label。 */
    function pickPackComboName(classId, row) {
        const comboId = String((row && (row.comboId || row.combo_id)) || '').trim();
        const combo = (row && row.combo) || resolvePackCombo(classId, comboId);
        if (combo) {
            const named = comboLabelText(combo);
            if (named && !comboNameLooksLikeSheetAlias(named)) return named;
        }
        const fallback = String((row && (row.comboLabel || row.combo_label)) || '').trim();
        if (comboNameLooksLikeSheetAlias(fallback)) return '';
        return fallback;
    }

    /** 活頁別名：teacher 端才能對到即時檔名；student 端沒有套餐快取就退回這一列已存的 comboLabel。 */
    function pickPackSheetLabel(classId, row) {
        const comboId = String((row && (row.comboId || row.combo_id)) || '').trim();
        const combo = (row && row.combo) || resolvePackCombo(classId, comboId);
        const metaFile = String((row && (row.metaFile || row.meta_file)) || '').trim();
        if (!metaFile) return String((row && (row.comboLabel || row.combo_label)) || '').trim();
        const stem = metaFile.replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        const sheets = (combo && Array.isArray(combo.ownSheets)) ? combo.ownSheets : [];
        const want = stem.toUpperCase();
        let sheet = null;
        for (let i = 0; i < sheets.length; i++) {
            const s = sheets[i];
            const a = String((s && s.stem) || '').replace(/\.meta\.json$/i, '').toUpperCase();
            const b = String((s && s.meta) || '').replace(/\.meta\.json$/i, '').toUpperCase();
            if (a === want || b === want) {
                sheet = s;
                break;
            }
        }
        const liveStem = (sheet && sheet.stem) || stem;
        const FN = window.MaterialFileNames;
        if (FN && typeof FN.currentAlias === 'function') {
            return FN.currentAlias(liveStem, sheet && sheet.id, combo && combo.extractionTemplateName);
        }
        return liveStem;
    }

    function mergePickedIntervals(intervals) {
        const sorted = (intervals || []).slice().sort(function (a, b) { return a.start - b.start; });
        const out = [];
        sorted.forEach(function (cur) {
            const last = out[out.length - 1];
            if (last && cur.start <= last.end + 1) {
                if (cur.end > last.end) last.end = cur.end;
                return;
            }
            out.push({ start: cur.start, end: cur.end });
        });
        return out;
    }

    function formatPickedIntervalBits(intervals) {
        return (intervals || []).map(function (iv) {
            return iv.start === iv.end ? String(iv.start) : (iv.start + '~' + iv.end);
        });
    }

    function formatPickedPageIntervals(intervals) {
        if (!intervals || !intervals.length) return '';
        const bits = formatPickedIntervalBits(intervals);
        if (intervals.length === 1 && intervals[0].start === intervals[0].end) return 'p. ' + bits[0];
        return 'pp. ' + bits.join(', ');
    }

    function formatPickedQnumIntervals(intervals) {
        if (!intervals || !intervals.length) return '';
        return '#' + formatPickedIntervalBits(intervals).join(', ');
    }

    function pickNameCollapseInfo(label) {
        const s = String(label || '').trim();
        if (!s) return null;
        if (/^[A-Za-z]$/.test(s)) {
            return { kind: 'atom', letter: true, n: s.toUpperCase().charCodeAt(0), lastToken: s.toUpperCase(), full: s };
        }
        if (/^\d+$/.test(s)) {
            return { kind: 'atom', letter: false, n: Number(s), lastToken: s, full: s };
        }
        const lastSpace = s.lastIndexOf(' ');
        if (lastSpace === -1) {
            const m = s.match(/^(.*?)(\d+)$/);
            if (!m) return null;
            return { kind: 'tailnum', n: Number(m[2]), prefix: m[1], lastToken: s, full: s };
        }
        const head = s.slice(0, lastSpace + 1);
        const token = s.slice(lastSpace + 1);
        const m = token.match(/^(.*?)(\d+)$/);
        if (!m) return null;
        return { kind: 'tailnum', n: Number(m[2]), prefix: head, lastToken: token, full: s };
    }

    function pickSuccessorLabel(info) {
        if (!info || info.n == null) return '';
        if (info.kind === 'atom') {
            if (info.letter) {
                if (info.n >= 90) return '';
                return String.fromCharCode(info.n + 1);
            }
            return String(info.n + 1);
        }
        if (info.kind === 'tailnum') {
            return info.prefix + String(info.lastToken).replace(/\d+$/, String(info.n + 1));
        }
        return '';
    }

    function pickCollapsedSheetName(run) {
        if (!run || !run.length) return '';
        if (run.length === 1) return run[0].label;
        const first = pickNameCollapseInfo(run[0].label);
        const last = pickNameCollapseInfo(run[run.length - 1].label);
        if (first && last && first.kind === 'atom' && last.kind === 'atom') {
            return first.lastToken + '~' + last.lastToken;
        }
        if (first && last && first.kind === 'tailnum' && last.kind === 'tailnum') {
            return first.full + ' ~' + last.lastToken;
        }
        return run[0].label;
    }

    function collapseSheetLabelList(labels) {
        const items = (labels || []).map(function (lab) {
            return { label: lab, info: pickNameCollapseInfo(lab) };
        });
        const parts = [];
        let run = [];
        function flush() {
            if (!run.length) return;
            parts.push(pickCollapsedSheetName(run));
            run = [];
        }
        items.forEach(function (item) {
            if (!run.length) {
                run.push(item);
                return;
            }
            const prev = run[run.length - 1];
            const want = pickSuccessorLabel(prev.info);
            if (want && item.label === want) {
                run.push(item);
                return;
            }
            flush();
            run.push(item);
        });
        flush();
        return parts.join('~');
    }

    /**
     * 「區段以外」的判斷鑰匙——起迄本身的數值不放進來比對（那正是要融合／串接的東西，
     * 本來就允許不同）。只留基準／每頁行數／難度／必考／排除／題數要一致。跟 teacher 端
     * feature-timeline.js 的 packRowExamKey 同一把鑰匙，2026-09-15 一起修。
     */
    function packRowExamKey(r) {
        return [
            ((r && (r.rangeType || r.range_type)) === 'qnum') ? 'qnum' : 'page',
            String((r && r.lines_per_page) || '').trim(),
            String((r && r.difficulty) || '').trim(),
            String((r && (r.include_nums || r.includeNums)) || '').trim(),
            String((r && (r.exclude_nums || r.excludeNums)) || '').trim(),
            String((r && r.count) || '').trim()
        ].join('\t');
    }

    function packRowsHaveStartEnd(r) {
        return !!(String((r && r.start) || '').trim() && String((r && r.end) || '').trim());
    }

    /** 區段以外（基準／起迄／每頁行數／難度／必考／排除／題數）同一把鑰匙。 */
    function packRowsConsistentExceptSheet(rows) {
        const filled = (rows || []).filter(packRowsHaveStartEnd);
        if (!filled.length) return false;
        const key0 = packRowExamKey(filled[0]);
        return filled.every(function (r) { return packRowExamKey(r) === key0; });
    }

    /**
     * 2026-09-18 老師定案：區段名字（活頁字母）該不該列進說明，改成看「這個套餐當初是不是
     * 下拉選單」（isGroup 或可選活頁數 >1，跟 ui-timeline-templates.js renderSheetPackTableHtml
     * 判斷是否畫 <select> 同一把鑰匙），不是看「這幾列實際選到的字母種類數」。
     * 是下拉 → 不管選到幾種（哪怕只選了同一種、或只有一列）都要顯示選到的是哪一個。
     * 不是下拉（只有一本固定活頁）→ 永遠不顯示，沒有可選就沒有需要標示的資訊。
     * 回傳 true／false＝精準判斷出來；回傳 null＝這個環境拿不到套餐快取（例如 student 端
     * 舊資料救援用的即時算法），沒有這筆資訊可用，交給呼叫端退回舊 heuristic，不可猜。
     */
    function isDropdownComboForGroupRows(classId, rows) {
        const first = (rows || [])[0];
        if (!first) return null;
        const comboId = String((first.comboId || first.combo_id) || '').trim();
        const combo = first.combo || resolvePackCombo(classId, comboId);
        if (!combo) return null;
        return !!(combo.isGroup === true || (Array.isArray(combo.ownSheets) && combo.ownSheets.length > 1));
    }

    function uniqueSheetLabelsForRows(rows, classId) {
        const seen = {};
        const labels = [];
        (rows || []).forEach(function (r) {
            const lab = pickPackSheetLabel(classId, r);
            const k = String(lab || '').trim().toUpperCase();
            if (!k || seen[k]) return;
            seen[k] = true;
            labels.push(lab);
        });
        return labels;
    }

    /** 區段＝範圍表那一欄顯示的字母／數字：A.sentence-translation → A。標題與說明同一把。不准用完整活頁別名。 */
    function sheetHeadForTitle(label) {
        const FN = window.MaterialFileNames;
        if (FN && typeof FN.sheetRangeHead === 'function') return FN.sheetRangeHead(label);
        const s = String(label || '').trim().replace(/\.meta\.json$/i, '');
        if (!s) return '';
        const dot = s.indexOf('.');
        return dot > 0 ? s.slice(0, dot) : s;
    }

    function uniqueSheetHeadsForRows(rows, classId) {
        const seen = {};
        const heads = [];
        uniqueSheetLabelsForRows(rows, classId).forEach(function (lab) {
            const head = sheetHeadForTitle(lab);
            const k = String(head || '').trim().toUpperCase();
            if (!k || seen[k]) return;
            seen[k] = true;
            heads.push(head);
        });
        return heads;
    }

    function isBookPackRow(r) {
        if (!r) return false;
        if (window.FeatureMaterialBook && typeof window.FeatureMaterialBook.isBookCombo === 'function') {
            if (window.FeatureMaterialBook.isBookCombo(r.combo || r)) return true;
            const cid = String((r.comboId || r.combo_id) || '').trim();
            if (cid && typeof window.FeatureMaterialBook.getCombo === 'function' && window.FeatureMaterialBook.getCombo(cid)) {
                return true;
            }
        }
        return !!(String((r && (r.primary_unit || r.primaryUnit)) || '').trim()
            || String((r && (r.secondary_unit || r.secondaryUnit)) || '').trim()
            || String((r && (r.heading || r.range_heading)) || '').trim()
            || String((r && r.major) || '').trim()
            || String((r && r.secondary) || '').trim()
            || String((r && r.minor) || '').trim()
            || String((r && r.page) || '').trim());
    }

    /**
     * 獨立作業小標題＝套餐名＋（區段以外一致時納入區段）＋範圍。
     * 區段以外很亂＝標題只留套餐名，明細進說明（區段＋範圍，例：A pp. 1~2 ; J pp. 1~2）。
     * omitComboName＝true 時（組合層底下的子任務用）不重複套餐名，只留範圍。
     */
    function combinePackRangeLabel(rows, classId, omitComboName) {
        const bookParts = [];
        const pageRows = [];
        (rows || []).forEach(function (r) {
            if (isBookPackRow(r)) {
                const lab = (window.FeatureMaterialBook && typeof window.FeatureMaterialBook.rangeLabel === 'function')
                    ? window.FeatureMaterialBook.rangeLabel(r)
                    : [String((r && (r.primary_unit || r.primaryUnit)) || '').trim(), String((r && (r.secondary_unit || r.secondaryUnit)) || '').trim(), String((r && (r.heading || r.range_heading)) || '').trim(), String((r && r.major) || '').trim(), String((r && r.secondary) || '').trim(), String((r && r.minor) || '').trim()]
                        .filter(Boolean).join(' / ');
                const comboName = pickPackComboName(classId, r);
                if (lab && comboName && !omitComboName) bookParts.push(comboName + ' ' + lab);
                else if (lab) bookParts.push(lab);
                return;
            }
            pageRows.push(r);
        });
        const groups = [];
        const groupIndex = {};
        pageRows.forEach(function (r) {
            const label = pickPackComboName(classId, r);
            const comboId = String((r && (r.comboId || r.combo_id)) || '').trim();
            const key = comboId ? ('combo:' + comboId) : ('name:' + String(label || '').toUpperCase());
            if (groupIndex[key] == null) {
                groupIndex[key] = groups.length;
                groups.push({ label: label, rows: [] });
            }
            groups[groupIndex[key]].rows.push(r);
        });
        const parts = groups.map(function (g) {
            const filled = g.rows.filter(packRowsHaveStartEnd);
            const page = [];
            const qnum = [];
            filled.forEach(function (r) {
                const startN = Number(r.start);
                const endN = Number(r.end);
                if (isNaN(startN) || isNaN(endN)) return;
                const rec = { start: Math.min(startN, endN), end: Math.max(startN, endN) };
                if ((r.rangeType || r.range_type) === 'qnum') qnum.push(rec);
                else page.push(rec);
            });
            const rangeStr = [
                formatPickedPageIntervals(mergePickedIntervals(page)),
                formatPickedQnumIntervals(mergePickedIntervals(qnum))
            ].filter(Boolean).join(', ');
            // 2026-09-15 老師定案：範圍合併只看範圍本身（頁碼／題號連貫與否），跟每頁行數／
            // 難度／必考／排除／題數這些出考卷專用設定完全無關——這些設定不一致，不准把範圍
            // 吞掉、只剩套餐名（違反永遠不准丟資料）。相連就合併，不相連就逗號分開列，範圍永遠列出來。
            // 只有一本活頁＝區段固定，不是老師選出來的區分資訊，不准把活頁別名寫進標題／說明；
            // 2026-09-18 老師再定案：是否列出區段字母，改看「這個套餐當初是不是下拉選單」
            // （isDropdownComboForGroupRows），不是看「這幾列實際選到的字母種類數」。是下拉→
            // 不管選到幾種都顯示；不是下拉→永遠不顯示。拿不到套餐快取（student 端舊資料救援）
            // 才退回舊 heuristic（看實際種類數 >1），不可用來覆蓋老師端已經算得出來的精準結果。
            const sheetHeads = uniqueSheetHeadsForRows(filled, classId);
            const isDropdown = isDropdownComboForGroupRows(classId, filled);
            const sheetStr = isDropdown === true ? collapseSheetLabelList(sheetHeads)
                : isDropdown === false ? ''
                    : (sheetHeads.length > 1 ? collapseSheetLabelList(sheetHeads) : '');
            if (rangeStr) {
                const bits = omitComboName
                    ? [sheetStr, rangeStr]
                    : [g.label, sheetStr, rangeStr];
                return bits.filter(Boolean).join(' ');
            }
            if (omitComboName) return '';
            return g.label || '';
        }).filter(Boolean);
        return bookParts.concat(parts).join('；');
    }

    /**
     * 組合層（範圍群組）自己的「說明」：套餐名＋範圍，只在這裡自動產出一次。
     * 不管群組標題有沒有被老師改成自訂名稱，這裡都固定顯示套餐名＋範圍，讓底下子任務不用各自重複。
     * 跟獨立作業標題同一把 combinePackRangeLabel（omitComboName=false，永遠帶套餐名）。
     */
    function groupPackSummaryPlain(rows, classId) {
        return combinePackRangeLabel(rows, classId, false);
    }

    function groupPackSummaryHtml(rows, classId) {
        return String(groupPackSummaryPlain(rows, classId) || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    window.PackRangeLabel = {
        combinePackRangeLabel: combinePackRangeLabel,
        groupPackSummaryPlain: groupPackSummaryPlain,
        groupPackSummaryHtml: groupPackSummaryHtml,
        titleLooksLikeSheetAliasDump: titleLooksLikeSheetAliasDump,
        isBookPackRow: isBookPackRow,
        pickPackComboName: pickPackComboName,
        groupIsRangePack: groupIsRangePack,
        comboNameFromBookConcatTitle: comboNameFromBookConcatTitle
    };
})();

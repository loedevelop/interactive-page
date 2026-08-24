/**
 * 📂 020_js_core/material-snapshot.js
 * 從 00_Class_Materials 或老師 01_My_Materials 的 *.meta.json 切片並合成 assignment snapshot
 */
window.MaterialSnapshot = (function () {
    'use strict';

    var DISPLAY_KEYS = ['display_zh', 'pos', 'page', 'item_no', 'unit', 'note', 'teacher_note'];
    var SKIP_DISPLAY_KEYS = { script: true };

    function firstNonEmptyCell(row, keys) {
        if (!row) return '';
        var i;
        for (i = 0; i < keys.length; i++) {
            var v = row[keys[i]];
            if (v != null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    }

    /**
     * 口說答案：資料項正式家在 .script.txt（產檔 scriptLines）。
     * meta 列上的 script／「口說答案」只有單欄口說、且沒兼任書寫時才會寫回。
     * 禁止拿 display_zh／answer_en 充當口說。
     */
    function spokenAnswerFromRow(row) {
        return firstNonEmptyCell(row, ['script', '口說答案']);
    }

    var DEFAULT_STUDENT_SCRIPT = '_answer_combined_text';
    var STUDENT_SCRIPT_TAG_RE = /^<\s*(page\s*title|data|blank)\s*>\s*/i;

    function studentScriptHasTags(raw) {
        return /<\s*(page\s*title|data|blank)\s*>/i.test(String(raw || ''));
    }

    function stripStudentScriptTag(raw) {
        return String(raw == null ? '' : raw).replace(STUDENT_SCRIPT_TAG_RE, '');
    }

    /**
     * 學生文稿公式＝由上往下的標記列。
     * 沒有任何標記＝整份當 <data>（相容舊的單行公式）。
     * 有標記：<page title>／其前的 <blank> 每頁一次；第一個 <data> 起（含其後 <blank>）每列一次。
     */
    function parseStudentScriptTemplate(raw) {
        var text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!studentScriptHasTags(text)) {
            var lines = text.split('\n');
            var nonempty = lines.filter(function (l) { return String(l || '').trim(); });
            // 多行無標記：一行一個公式。不准整份當一個運算式（只算出第一行，或尾端多餘整段失敗）。
            if (nonempty.length > 1) {
                return {
                    tagged: true,
                    pageParts: [],
                    itemParts: lines.map(function (l) {
                        if (!String(l || '').trim()) return { kind: 'blank', formula: '' };
                        return { kind: 'data', formula: String(l).trim() };
                    })
                };
            }
            var plain = text.trim() || DEFAULT_STUDENT_SCRIPT;
            return { tagged: false, pageParts: [], itemParts: [{ kind: 'data', formula: plain }] };
        }
        var parts = [];
        text.split('\n').forEach(function (line) {
            var s = String(line || '');
            var m = s.match(STUDENT_SCRIPT_TAG_RE);
            if (!m) {
                if (!s.trim()) return;
                parts.push({ kind: 'data', formula: s.trim() });
                return;
            }
            var tag = String(m[1] || '').toLowerCase().replace(/\s+/g, ' ');
            if (tag === 'blank') {
                parts.push({ kind: 'blank', formula: '' });
                return;
            }
            parts.push({
                kind: tag === 'page title' ? 'page_title' : 'data',
                formula: s.slice(m[0].length)
            });
        });
        var pageParts = [];
        var itemParts = [];
        var seenData = false;
        parts.forEach(function (p) {
            if (!seenData && p.kind !== 'data') {
                pageParts.push(p);
                return;
            }
            seenData = true;
            itemParts.push(p);
        });
        if (!itemParts.length && !pageParts.length) {
            itemParts = [{ kind: 'data', formula: DEFAULT_STUDENT_SCRIPT }];
        }
        return { tagged: true, pageParts: pageParts, itemParts: itemParts };
    }

    function evalLayoutFormulaToText(formula, row, colMap, opts) {
        opts = opts || {};
        var src = String(formula || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        src = src.replace(/＆/g, '&');
        src = stripStudentScriptTag(src).trim();
        if (!src) {
            if (opts.errorBox) opts.errorBox.err = '空公式';
            return '';
        }
        // 多行＝一行一個公式。整份丟進 evaluateFields 會只算出第一行或「運算式尾端多餘」整段空。
        if (src.indexOf('\n') !== -1) {
            return src.split('\n').map(function (line) {
                return evalLayoutFormulaToText(line, row, colMap, opts);
            }).join('\n');
        }
        if (!window.LayoutFieldsEval || typeof window.LayoutFieldsEval.evaluateFields !== 'function') {
            return firstNonEmptyCell(row, [src]);
        }
        try {
            var cells = window.LayoutFieldsEval.evaluateFields(src, row, colMap || {}, opts);
            return (cells || []).map(function (c) {
                return window.LayoutFieldsEval.cellText(c);
            }).map(function (t) {
                return String(t || '').trim();
            }).filter(Boolean).join(' ');
        } catch (e) {
            if (opts.errorBox) opts.errorBox.err = (e && e.message) ? e.message : String(e);
            return '';
        }
    }

    /** 學生文稿每一行公式：空欄（如 pre）跳過，不准把該行整段吃掉。 */
    function evalStudentScriptFormulaToText(formula, row, colMap, errorBox) {
        return evalLayoutFormulaToText(formula, row, colMap, {
            skipBlankConcat: true,
            errorBox: errorBox || null
        });
    }

    /**
     * 書寫答案：結合結果在 _answer_combined_text；否則依 _answer_keys 各欄；
     * 單欄正式語意鍵是 answer_en。禁止拿 display_zh（題目）或口說稿充當書寫。
     */
    function writtenAnswerFromRow(row) {
        if (!row) return '';
        var combined = firstNonEmptyCell(row, ['_answer_combined_text', '書寫答案']);
        if (combined) return combined;
        var keys = row._answer_keys;
        if (Array.isArray(keys) && keys.length) {
            var parts = [];
            keys.forEach(function (k) {
                var v = row[k];
                if (v != null && String(v).trim() !== '') parts.push(String(v).trim());
            });
            if (parts.length) return parts.join(' ');
        }
        return firstNonEmptyCell(row, ['answer_en']);
    }

    /**
     * 擷取範本公式套到 meta 列：col_map 對欄，answer_combine_note 寫進 _answer_combined_text。
     * 沒填結合公式＝不寫、不准拿別欄合成。學生文稿公式另外用 student_script。
     */
    function applyExtractionFormulasToRows(rows, context) {
        context = context || {};
        var colMap = context.col_map || {};
        var formula = String(context.answer_combine_note || context.answerCombineNote || '').trim();
        return (rows || []).map(function (row) {
            if (!row || typeof row !== 'object') return row;
            var out = Object.assign({}, row);
            Object.keys(colMap).forEach(function (letter) {
                var sem = colMap[letter];
                if (!sem) return;
                if ((out[sem] == null || out[sem] === '') && out[letter] != null && out[letter] !== '') {
                    out[sem] = out[letter];
                }
            });
            if (formula) {
                var combined = evalLayoutFormulaToText(formula, out, colMap);
                out._answer_combined_text = combined || '';
            }
            return out;
        });
    }

    function siblingScriptFileName(metaFile) {
        var name = String(metaFile || '').trim();
        if (!name) return '';
        if (/\.meta\.json$/i.test(name)) return name.replace(/\.meta\.json$/i, '.script.txt');
        if (/\.json$/i.test(name)) return name.replace(/\.json$/i, '.script.txt');
        return '';
    }

    function scriptLinesFromText(raw) {
        var text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (text.slice(-1) === '\n') text = text.slice(0, -1);
        if (text === '') return [];
        return text.split('\n');
    }

    /**
     * 把同 stem 的 .script.txt 依列序貼回口說答案。行數對不上＝不猜、不套。
     */
    function attachSpokenAnswersFromScript(rows, scriptText) {
        var list = rows || [];
        if (!list.length) return list;
        var lines = scriptLinesFromText(scriptText);
        if (lines.length !== list.length) return list;
        return list.map(function (row, i) {
            var spoken = String(lines[i] || '').trim();
            if (!spoken) return row;
            var out = Object.assign({}, row);
            out.script = spoken;
            return out;
        });
    }

    function parseMetaContent(raw) {
        if (!raw) return [];
        var data = raw;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (_e) { return []; }
        }
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') {
            if (Array.isArray(data.rows)) return data.rows;
            if (Array.isArray(data.items)) return data.items;
            if (Array.isArray(data.data)) return data.data;
            if (data.sheets && typeof data.sheets === 'object') {
                var acc = [];
                Object.keys(data.sheets).forEach(function (k) {
                    if (Array.isArray(data.sheets[k])) acc = acc.concat(data.sheets[k]);
                });
                if (acc.length) return acc;
            }
        }
        return [];
    }

    function collectMetaRowKeys(rows) {
        var seen = {};
        var out = [];
        var list = rows || [];
        var idxs = [];
        var i;
        var head = list.length > 40 ? 40 : list.length;
        for (i = 0; i < head; i++) idxs.push(i);
        if (list.length > 40) {
            idxs.push(Math.floor(list.length / 2));
            idxs.push(list.length - 1);
        }
        idxs.forEach(function (idx) {
            var row = list[idx];
            if (!row || typeof row !== 'object') return;
            Object.keys(row).forEach(function (k) {
                if (!k || String(k).charAt(0) === '_') return;
                if (seen[k]) return;
                seen[k] = true;
                out.push(k);
            });
        });
        return out;
    }

    function describeMetaRowKeys(rows) {
        return collectMetaRowKeys(rows).join(', ');
    }

    function pageNumsFromCell(val) {
        if (val == null || val === '') return [];
        var s = String(val).trim();
        var m = s.match(/(\d+)\s*[-~～至到\/]\s*(\d+)/);
        if (m) {
            var lo = Number(m[1]);
            var hi = Number(m[2]);
            if (isNaN(lo) || isNaN(hi)) return [];
            if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
            if (hi - lo > 200) return [lo, hi];
            var span = [];
            for (var i = lo; i <= hi; i++) span.push(i);
            return span;
        }
        var n = toNumber(val);
        return isNaN(n) ? [] : [n];
    }

    function rowPageNum(row, pageKey) {
        if (!row) return NaN;
        if (pageKey && row[pageKey] != null && row[pageKey] !== '') {
            var fromKey = pageNumsFromCell(row[pageKey]);
            if (fromKey.length) return fromKey[0];
        }
        var preferred = ['page', 'Page', 'pg', '頁碼', 'page_no', 'E'];
        for (var i = 0; i < preferred.length; i++) {
            if (row[preferred[i]] == null || row[preferred[i]] === '') continue;
            var nums = pageNumsFromCell(row[preferred[i]]);
            if (nums.length) return nums[0];
        }
        var keys = Object.keys(row);
        for (var j = 0; j < keys.length; j++) {
            var k = keys[j];
            if (!k || k.charAt(0) === '_') continue;
            if (!/page|頁/i.test(k)) continue;
            var found = pageNumsFromCell(row[k]);
            if (found.length) return found[0];
        }
        return NaN;
    }

    /** 找出 meta 列真正記課本頁的欄。不要只看第一列（開頭常是文法定義、沒有 page）。不要把 item_no 1～20 誤當成頁碼。 */
    function resolveMetaPageKey(rows) {
        var list = rows || [];
        if (!list.length) return '';
        var keys = collectMetaRowKeys(list);
        var named = keys.filter(function (k) {
            return /^(page|Page|pg|頁碼|page_no|E)$/.test(k) || /page|頁碼/.test(k);
        });
        var take = list.length > 400 ? 400 : list.length;
        var step = list.length > 400 ? Math.ceil(list.length / 400) : 1;
        var ni, i;
        for (ni = 0; ni < named.length; ni++) {
            for (i = 0; i < list.length; i += step) {
                if (pageNumsFromCell(list[i] && list[i][named[ni]]).length) return named[ni];
            }
            if (step > 1) {
                for (i = Math.max(0, list.length - 20); i < list.length; i++) {
                    if (pageNumsFromCell(list[i] && list[i][named[ni]]).length) return named[ni];
                }
            }
        }
        var best = '';
        var bestHits = 0;
        keys.forEach(function (k) {
            if (/item_no|itemNo|題號/i.test(k)) return;
            var hits = 0;
            var sample = take;
            for (i = 0; i < list.length && i < sample * step; i += step) {
                var nums = pageNumsFromCell(list[i] && list[i][k]);
                if (nums.some(function (n) { return n >= 50 && n <= 900; })) hits += 1;
            }
            if (hits > bestHits && hits >= 3) {
                best = k;
                bestHits = hits;
            }
        });
        return best;
    }

    function normalizeMetaRows(rows, layout) {
        var colMap = {};
        if (window.QuizPaperBuilder && window.QuizPaperBuilder.FALLBACK_COL_MAP) {
            Object.keys(window.QuizPaperBuilder.FALLBACK_COL_MAP).forEach(function (letter) {
                colMap[letter] = window.QuizPaperBuilder.FALLBACK_COL_MAP[letter];
            });
        } else {
            colMap.E = 'page';
            colMap.C = 'item_no';
        }
        if (layout && layout.col_map && typeof layout.col_map === 'object') {
            Object.keys(layout.col_map).forEach(function (letter) {
                if (layout.col_map[letter]) colMap[letter] = layout.col_map[letter];
            });
        }
        return (rows || []).map(function (row) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
            var out = Object.assign({}, row);
            Object.keys(colMap).forEach(function (letter) {
                var sem = colMap[letter];
                if (!sem) return;
                if ((out[sem] == null || out[sem] === '') && out[letter] != null && out[letter] !== '') {
                    out[sem] = out[letter];
                }
            });
            return out;
        });
    }

    function canonicalizeMetaRows(rows, layout) {
        var list = normalizeMetaRows(rows, layout);
        var key = resolveMetaPageKey(list);
        if (key && key !== 'page') {
            list = list.map(function (row) {
                if (!row) return row;
                if (row.page != null && row.page !== '') return row;
                if (row[key] == null || row[key] === '') return row;
                var out = Object.assign({}, row);
                out.page = row[key];
                return out;
            });
        }
        return list;
    }

    function summarizeMetaPages(rows) {
        var pageKey = resolveMetaPageKey(rows);
        var pages = [];
        (rows || []).forEach(function (row) {
            var nums = pageKey
                ? pageNumsFromCell(row && row[pageKey])
                : (isNaN(rowPageNum(row)) ? [] : [rowPageNum(row)]);
            nums.forEach(function (p) {
                if (!isNaN(p) && pages.indexOf(p) === -1) pages.push(p);
            });
        });
        pages.sort(function (a, b) { return a - b; });
        if (!pages.length) return '';
        return pages[0] + '～' + pages[pages.length - 1] + '（' + pages.length + ' 頁）';
    }

    /** 題號後面加點：原始資料已有句點就不再加。 */
    function itemNoWithDot(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return '';
        if (/\.\s*$/.test(s)) return s.replace(/\s+$/, '');
        return s + '.';
    }

    function toNumber(val) {
        if (val === null || val === undefined || val === '') return NaN;
        var n = Number(String(val).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? NaN : n;
    }

    /**
     * 解析範圍字串：
     *   "pp. 1~2, 5, 10"  → 頁 1–2、5、10（p./pp./p/pp 皆可，大小寫不拘）
     *   "#11~16, 26"      → 題 #11–16、#26
     *   "all"             → 全部
     * 分隔距離："-"／"~" 皆可（含全形變體）。
     * 雷區：不接受裸數字（如單獨的 "1"）——沒有 p./pp./# 前綴無法判斷是頁碼還是題號，
     * 曾經被默默當頁碼解析，老師完全不知道自己選錯了，故意在此明確拒絕並要求補前綴。
     *
     * 2026-08-08：容忍「活頁代號＋空白＋範圍」這種格式（例：「G p. 1」）——這種格式在
     * 別處（多冊合併摘要，例：「A pp. 1~2；B pp. 3~4」、輸入框 placeholder「A pp. 1~2 B pp. 1~2」）
     * 本來就是合法、隨處可見的寫法，老師看多了自然會把同一種寫法套用到單列範圍輸入框，
     * 這不是老師打錯格式，是介面本身讓兩種輸入框（單列 vs 合併摘要）看起來該用同一種語法。
     * 開頭那一段代號其實跟這一列真正的活頁是透過下拉選單決定的，文字本身是多餘、可以
     * 直接忽略的資訊——只要代號後面接的是合法的 p./pp./# 前綴，就把代號那一段拿掉再繼續解析，
     * 不要直接拒絕。
     */
    function stripLeadingStemLabel(text) {
        var m = text.match(/^([^\s#]+)\s+(?=#|pp?\.?\s*\d)/i);
        if (m && !/^pp?\.?$/i.test(m[1])) {
            return text.slice(m[0].length);
        }
        return text;
    }

    function parseRangeSpec(raw) {
        var text = String(raw || '').trim();
        if (!text) throw new Error('請填寫範圍（例：p. 1、pp. 1~2, 5, 10 或 #11~16, 26）');
        if (/^all$/i.test(text) || text === '全部' || text === '全部列') {
            return { kind: 'all', pages: null, items: null, label: 'all' };
        }
        text = stripLeadingStemLabel(text);

        // 前綴只認開頭那一個：# → 題號；p./pp.（含無點、大小寫）→ 頁碼。裸數字一律拒絕。
        var itemPrefixMatch = text.match(/^\s*#\s*/);
        var pagePrefixMatch = !itemPrefixMatch ? text.match(/^\s*pp?\.?\s*(?=\d)/i) : null;
        if (!itemPrefixMatch && !pagePrefixMatch) {
            throw new Error('範圍請加註前綴：頁碼用 p. 或 pp.，題號用 #（例：p. 1、pp. 1~2, 5 或 #11~16, 26）；不接受單獨數字，避免頁碼／題號不清');
        }
        var kind = itemPrefixMatch ? 'item' : 'page';
        var body = text.slice((itemPrefixMatch || pagePrefixMatch)[0].length);

        // 混用檢查放在去前綴之後，訊息才準確（例："pp. 1~2, #5" 拆到 body 還留著 #5）
        if (kind === 'page' && /#/.test(body)) {
            throw new Error('同一列請勿混用頁碼（pp.）與題號（#），請拆成兩列');
        }
        if (kind === 'item' && /pp?\.?\s*\d/i.test(body)) {
            throw new Error('同一列請勿混用頁碼（pp.）與題號（#），請拆成兩列');
        }

        var cleaned = body
            .replace(/[～〜－—–-]/g, '~')
            .replace(/\s+/g, ' ')
            .trim();

        var parts = cleaned.split(/[,，、]+/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.length === 0) throw new Error('範圍格式不正確：' + text);

        var pages = {};
        var items = {};
        parts.forEach(function (part) {
            var m = part.match(/^(\d+)\s*~\s*(\d+)$/);
            if (m) {
                var a = Number(m[1]);
                var b = Number(m[2]);
                if (a > b) { var tmp = a; a = b; b = tmp; }
                for (var i = a; i <= b; i++) {
                    if (kind === 'item') items[i] = true;
                    else pages[i] = true;
                }
                return;
            }
            // 只接受純數字片段；混了殘留文字（例如前綴沒抓乾淨）一律明確報錯，不可靜默轉成奇怪的小數
            if (!/^\d+$/.test(part)) throw new Error('無法解析範圍片段：' + part);
            var n = toNumber(part);
            if (isNaN(n)) throw new Error('無法解析範圍片段：' + part);
            if (kind === 'item') items[n] = true;
            else pages[n] = true;
        });

        var pageList = Object.keys(pages).map(Number).sort(function (a, b) { return a - b; });
        var itemList = Object.keys(items).map(Number).sort(function (a, b) { return a - b; });
        return {
            kind: kind,
            pages: kind === 'page' ? pageList : null,
            items: kind === 'item' ? itemList : null,
            label: text.replace(/\s+/g, ' ').trim()
        };
    }

    /**
     * parseRangeSpec 的反寫。同一種範圍、同一串數字：
     *   頁碼 → p. 1 ／ pp. 1~2, 5, 10
     *   題號 → #1 ／ #11~16, 26
     * 連續數字收成一段，不連續用逗號。不准各段再各自加前綴再用分號黏。
     */
    function compactNumberRuns(nums) {
        var seen = {};
        var sorted = [];
        (nums || []).forEach(function (n) {
            var v = Number(n);
            if (isNaN(v) || seen[v]) return;
            seen[v] = true;
            sorted.push(v);
        });
        sorted.sort(function (a, b) { return a - b; });
        var parts = [];
        var runStart = null;
        var runEnd = null;
        sorted.forEach(function (v) {
            if (runStart == null) {
                runStart = v;
                runEnd = v;
                return;
            }
            if (v === runEnd + 1) {
                runEnd = v;
                return;
            }
            parts.push(runStart === runEnd ? String(runStart) : (runStart + '~' + runEnd));
            runStart = v;
            runEnd = v;
        });
        if (runStart != null) {
            parts.push(runStart === runEnd ? String(runStart) : (runStart + '~' + runEnd));
        }
        return parts;
    }

    function formatRangeSpecFromNums(kind, nums) {
        var parts = compactNumberRuns(nums);
        if (!parts.length) return '';
        if (kind === 'item' || kind === 'qnum') return '#' + parts.join(', ');
        if (parts.length === 1 && parts[0].indexOf('~') === -1) return 'p. ' + parts[0];
        return 'pp. ' + parts.join(', ');
    }

    function formatRangeLabel(stem, rangeSpecOrRaw) {
        var stemStr = String(stem || '').trim() || '?';
        if (typeof rangeSpecOrRaw === 'string') {
            var raw = String(rangeSpecOrRaw || '').trim();
            if (!raw) return stemStr;
            if (/^all$/i.test(raw) || raw === '全部' || raw === '全部列') return stemStr + ' all';
            // 已含 pp./# 則直接接在 stem 後
            if (/^(pp\.|#)/i.test(raw)) return stemStr + ' ' + raw;
            return stemStr + ' ' + raw;
        }
        var spec = rangeSpecOrRaw || {};
        if (spec.kind === 'all') return stemStr + ' all';
        if (spec.label) {
            var lab = String(spec.label).trim();
            if (/^(pp\.|#)/i.test(lab)) return stemStr + ' ' + lab;
            return stemStr + ' ' + lab;
        }
        return stemStr;
    }

    /**
     * 找不到列時，把這份 meta 實際偵測到的頁碼／題號列出來，老師才能立刻判斷是「選錯檔案」
     * 還是「範圍打錯」——原本只丟「此範圍找不到任何列：pp. 1~2」，老師完全看不出這份檔案
     * 實際內容是從第幾頁開始，只能自己開 meta.json 或 Excel 逐行核對。
     */
    function describeAvailableForKind(rows, kind) {
        var seen = {};
        var pageKey = kind === 'page' ? resolveMetaPageKey(rows) : '';
        (rows || []).forEach(function (row) {
            if (kind === 'item') {
                var v = toNumber(row.item_no != null ? row.item_no : row.itemNo);
                if (!isNaN(v)) seen[v] = true;
                return;
            }
            var nums = pageKey
                ? pageNumsFromCell(row && row[pageKey])
                : (isNaN(toNumber(row && row.page)) ? [] : [toNumber(row.page)]);
            nums.forEach(function (n) { if (!isNaN(n)) seen[n] = true; });
        });
        var nums = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
        if (!nums.length) return '這份 meta 完全沒有可辨識的' + (kind === 'item' ? '題號' : '頁碼') + '（可能欄位對應設錯，或該欄整批留白）';
        var preview = nums.length > 12 ? (nums.slice(0, 12).join(', ') + '…共 ' + nums.length + ' 個') : nums.join(', ');
        return '這份 meta 實際偵測到的' + (kind === 'item' ? '題號' : '頁碼') + '有：' + preview;
    }

    function filterRowsByRangeSpec(rows, rangeSpec) {
        var spec = typeof rangeSpec === 'string' ? parseRangeSpec(rangeSpec) : rangeSpec;
        if (!spec) throw new Error('缺少範圍');
        if (spec.kind === 'all') {
            if (!rows || rows.length === 0) throw new Error('meta 沒有任何列');
            return rows.slice();
        }
        var list;
        if (spec.kind === 'page') {
            var pageSet = {};
            (spec.pages || []).forEach(function (p) { pageSet[p] = true; });
            var pageKey = resolveMetaPageKey(rows);
            list = (rows || []).filter(function (row) {
                var nums = pageKey
                    ? pageNumsFromCell(row && row[pageKey])
                    : (isNaN(toNumber(row && row.page)) ? [] : [toNumber(row.page)]);
                return nums.some(function (p) { return !!pageSet[p]; });
            });
        } else if (spec.kind === 'item') {
            var itemSet = {};
            (spec.items || []).forEach(function (n) { itemSet[n] = true; });
            list = (rows || []).filter(function (row) {
                var itemNo = toNumber(row.item_no != null ? row.item_no : row.itemNo);
                return !isNaN(itemNo) && itemSet[itemNo];
            });
        } else {
            throw new Error('未知範圍類型');
        }
        if (list.length === 0) {
            throw new Error('此範圍找不到任何列：' + (spec.label || '') + '。' + describeAvailableForKind(rows, spec.kind));
        }
        return list;
    }

    function filterRows(rows, options) {
        options = options || {};
        if (options.range_spec || options.rangeSpec) {
            return filterRowsByRangeSpec(rows, options.range_spec || options.rangeSpec);
        }

        var mode = options.select_mode || options.mode || 'item_range';
        var list = rows.slice();

        if (mode === 'page' || mode === 'page_range') {
            var pageFrom = toNumber(
                options.page_from != null ? options.page_from
                    : (options.pageFrom != null ? options.pageFrom : options.page)
            );
            var pageTo = toNumber(
                options.page_to != null ? options.page_to
                    : (options.pageTo != null ? options.pageTo : options.page)
            );
            if (isNaN(pageFrom) || isNaN(pageTo)) throw new Error('請輸入有效的頁次範圍');
            if (pageFrom > pageTo) {
                var tmpP = pageFrom;
                pageFrom = pageTo;
                pageTo = tmpP;
            }
            list = list.filter(function (row) {
                var pageNum = toNumber(row.page);
                return !isNaN(pageNum) && pageNum >= pageFrom && pageNum <= pageTo;
            });
        } else if (mode === 'item_range') {
            var from = toNumber(options.item_from != null ? options.item_from : options.itemFrom);
            var to = toNumber(options.item_to != null ? options.item_to : options.itemTo);
            if (isNaN(from) || isNaN(to)) throw new Error('請輸入有效的題號範圍');
            if (from > to) {
                var tmp = from;
                from = to;
                to = tmp;
            }
            list = list.filter(function (row) {
                var itemNo = toNumber(row.item_no != null ? row.item_no : row.itemNo);
                return !isNaN(itemNo) && itemNo >= from && itemNo <= to;
            });
        } else if (mode === 'all') {
            // keep all
        } else {
            throw new Error('未知的切片模式：' + mode);
        }

        if (list.length === 0) {
            var kindForHint = mode === 'item_range' ? 'item' : 'page';
            throw new Error('此範圍找不到任何列，請確認 meta 內容與篩選條件。' + describeAvailableForKind(rows, kindForHint));
        }
        return list;
    }

    function formatDisplayLine(row) {
        var parts = [];
        var itemNo = row.item_no != null ? row.item_no : row.itemNo;
        if (itemNo !== undefined && itemNo !== null && String(itemNo).trim() !== '') {
            parts.push('#' + String(itemNo).trim());
        }
        DISPLAY_KEYS.forEach(function (key) {
            if (SKIP_DISPLAY_KEYS[key]) return;
            if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
                parts.push(String(row[key]).trim());
            }
        });
        Object.keys(row).forEach(function (key) {
            if (key.indexOf('display_') === 0 && DISPLAY_KEYS.indexOf(key) === -1) {
                var val = row[key];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    parts.push(String(val).trim());
                }
            }
        });
        if (row.script && String(row.script).trim() !== '') {
            parts.push(String(row.script).trim());
        }
        return parts.join('  ');
    }

    function studentLineFromRow(row, context) {
        context = context || {};
        var formulaRaw = String(context.student_script || context.studentScript || '').trim() || DEFAULT_STUDENT_SCRIPT;
        var tpl = parseStudentScriptTemplate(formulaRaw);
        var colMap = context.col_map || {};
        var parts = (tpl.itemParts && tpl.itemParts.length)
            ? tpl.itemParts
            : [{ kind: 'data', formula: formulaRaw }];
        var lines = [];
        parts.forEach(function (p) {
            if (p.kind === 'blank') {
                lines.push('');
                return;
            }
            if (p.kind !== 'data') return;
            var text = evalStudentScriptFormulaToText(p.formula, row, colMap);
            if (text) lines.push(text);
        });
        return lines.join('\n');
    }

    /** 有 stamp 的 sheet_page＝這本第 N 頁；沒有才看 Excel page。 */
    function rowGroupPageKey(row) {
        if (row && row.sheet_page != null && String(row.sheet_page).trim() !== '') {
            return String(row.sheet_page);
        }
        if (row && row.page != null && String(row.page).trim() !== '') return String(row.page);
        if (row && row.Page != null && String(row.Page).trim() !== '') return String(row.Page);
        return '_';
    }

    function stampSheetPage(rows, lpp) {
        var lines = Number(lpp);
        if (!(lines > 0)) return rows;
        return (rows || []).map(function (row) {
            if (!row) return row;
            var n = toNumber(row.item_no != null ? row.item_no : row.itemNo);
            if (isNaN(n) || n < 1) return row;
            var out = Object.assign({}, row);
            out.sheet_page = Math.ceil(n / lines);
            return out;
        });
    }

    /**
     * 學生文稿＝該擷取範本「學生文稿 特殊排版」。
     * 有 <page title>／<data>／<blank>＝只套公式（不再加【檔名】[頁] 與題號.）。
     * 沒標記＝整份當資料列，仍加系統頁首（舊公式相容）。
     */
    function formatStudentDisplayBlock(rows, context) {
        context = context || {};
        var stem = String(context.label || context.stem || '').trim();
        if (!stem) {
            var file = context.published_file || context.metaFile || '';
            stem = String(file).replace(/\.meta\.json$/i, '').replace(/\.json$/i, '');
            var parts = stem.split(/[\/_]/);
            stem = parts[parts.length - 1] || stem || '?';
        }

        var byPage = {};
        var pageOrder = [];
        (rows || []).forEach(function (row) {
            var pageKey = rowGroupPageKey(row);
            if (!byPage[pageKey]) {
                byPage[pageKey] = [];
                pageOrder.push(pageKey);
            }
            byPage[pageKey].push(row);
        });

        var formulaRaw = String((context && (context.student_script || context.studentScript)) || '').trim()
            || DEFAULT_STUDENT_SCRIPT;
        var tpl = parseStudentScriptTemplate(formulaRaw);
        var colMap = (context && context.col_map) || {};

        function emitTaggedParts(partList, row, into, errorBox) {
            var wrote = false;
            (partList || []).forEach(function (p) {
                if (p.kind === 'blank') {
                    into.push('');
                    return;
                }
                var text = evalStudentScriptFormulaToText(p.formula, row, colMap, errorBox);
                if (!text) return;
                into.push(text);
                wrote = true;
            });
            return wrote;
        }

        var blocks = [];
        pageOrder.forEach(function (pageKey) {
            var pageRows = byPage[pageKey].slice().sort(function (a, b) {
                var ai = toNumber(a.item_no != null ? a.item_no : a.itemNo);
                var bi = toNumber(b.item_no != null ? b.item_no : b.itemNo);
                if (isNaN(ai) && isNaN(bi)) return 0;
                if (isNaN(ai)) return 1;
                if (isNaN(bi)) return -1;
                return ai - bi;
            });
            if (!pageRows.length) return;
            var headerPage = pageKey === '_' ? '?' : pageKey;
            var lines = [];
            var localIdx = 1;

            var dataErr = { err: '' };
            var dataEmitted = 0;
            if (tpl.tagged) {
                emitTaggedParts(tpl.pageParts, pageRows[0], lines);
                pageRows.forEach(function (row) {
                    var chunk = [];
                    if (emitTaggedParts(tpl.itemParts, row, chunk, dataErr)) {
                        dataEmitted += 1;
                        chunk.forEach(function (ln) { lines.push(ln); });
                    }
                });
                if (context && !context._studentDataDiag) {
                    var dataFormula = '';
                    (tpl.itemParts || []).forEach(function (p) {
                        if (p.kind === 'data' && String(p.formula || '').trim()) dataFormula = p.formula;
                    });
                    context._studentDataDiag = {
                        dataFormula: dataFormula,
                        dataEmitted: dataEmitted,
                        dataErr: dataErr.err || ''
                    };
                } else if (context && context._studentDataDiag) {
                    context._studentDataDiag.dataEmitted += dataEmitted;
                    if (!context._studentDataDiag.dataErr && dataErr.err) {
                        context._studentDataDiag.dataErr = dataErr.err;
                    }
                }
            } else {
                lines.push('【' + stem + '】[' + headerPage + ']');
                var dataFormula = (tpl.itemParts[0] && tpl.itemParts[0].formula) || DEFAULT_STUDENT_SCRIPT;
                pageRows.forEach(function (row) {
                    var written = evalStudentScriptFormulaToText(dataFormula, row, colMap);
                    if (!written) return;
                    var itemNo = row.item_no != null ? row.item_no : row.itemNo;
                    var num = !isNaN(toNumber(itemNo)) ? String(itemNo) : String(localIdx);
                    lines.push(itemNoWithDot(num) + '  ' + written);
                    localIdx += 1;
                });
            }
            if (lines.some(function (ln) { return String(ln || '') !== ''; })) {
                blocks.push(lines.join('\n'));
            }
        });
        return blocks.join('\n\n');
    }

    /** 書寫答案：只取該列書寫欄，不加學生文稿公式。沒有就跳過該列，不准抄口說／題目。 */
    function formatWrittenAnswerBlock(rows, context) {
        context = context || {};
        var stem = String(context.label || context.stem || '').trim();
        if (!stem) {
            var file = context.published_file || context.metaFile || '';
            stem = String(file).replace(/\.meta\.json$/i, '').replace(/\.json$/i, '');
            var parts = stem.split(/[\/_]/);
            stem = parts[parts.length - 1] || stem || '?';
        }
        var byPage = {};
        var pageOrder = [];
        (rows || []).forEach(function (row) {
            var pageKey = rowGroupPageKey(row);
            if (!byPage[pageKey]) {
                byPage[pageKey] = [];
                pageOrder.push(pageKey);
            }
            byPage[pageKey].push(row);
        });
        var blocks = [];
        pageOrder.forEach(function (pageKey) {
            var pageRows = byPage[pageKey].slice().sort(function (a, b) {
                var ai = toNumber(a.item_no != null ? a.item_no : a.itemNo);
                var bi = toNumber(b.item_no != null ? b.item_no : b.itemNo);
                if (isNaN(ai) && isNaN(bi)) return 0;
                if (isNaN(ai)) return 1;
                if (isNaN(bi)) return -1;
                return ai - bi;
            });
            var lines = [];
            var localIdx = 1;
            pageRows.forEach(function (row) {
                var written = writtenAnswerFromRow(row);
                if (!written) return;
                var itemNo = row.item_no != null ? row.item_no : row.itemNo;
                var num = !isNaN(toNumber(itemNo)) ? String(itemNo) : String(localIdx);
                lines.push(itemNoWithDot(num) + '  ' + written);
                localIdx += 1;
            });
            if (!lines.length) return;
            var headerPage = pageKey === '_' ? '?' : pageKey;
            blocks.push('【' + stem + '】[' + headerPage + ']\n' + lines.join('\n'));
        });
        return blocks.join('\n\n');
    }

    function rowsHaveSpoken(rows) {
        return (rows || []).some(function (row) {
            return !!spokenAnswerFromRow(row);
        });
    }

    var RECORDING_UNIT = 'page';
    var RECORDING_UNIT_HINT = '錄音時以「一頁」為唯一錄音單位：每一頁請錄成一支音檔，同一作業可複選多檔上傳；AI 亦按頁對應批改。';

    /**
     * 依頁切分 AI 批改單位（一頁一份英文稿）。
     * unit_key 例：A:1
     */
    function buildGradingUnits(rows, context) {
        context = context || {};
        var stem = String(context.label || context.stem || '').trim();
        if (!stem && (context.published_file || context.metaFile)) {
            stem = String(context.published_file || context.metaFile)
                .replace(/\.meta\.json$/i, '')
                .replace(/\.json$/i, '');
            var parts = stem.split(/[\/_]/);
            stem = parts[parts.length - 1] || stem;
        }
        if (!stem) stem = 'M';

        var byPage = {};
        var pageOrder = [];
        (rows || []).forEach(function (row) {
            var pageKey = rowGroupPageKey(row);
            if (!byPage[pageKey]) {
                byPage[pageKey] = [];
                pageOrder.push(pageKey);
            }
            byPage[pageKey].push(row);
        });

        var units = [];
        pageOrder.forEach(function (pageKey) {
            var pageRows = byPage[pageKey].slice().sort(function (a, b) {
                var ai = toNumber(a.item_no != null ? a.item_no : a.itemNo);
                var bi = toNumber(b.item_no != null ? b.item_no : b.itemNo);
                if (isNaN(ai) && isNaN(bi)) return 0;
                if (isNaN(ai)) return 1;
                if (isNaN(bi)) return -1;
                return ai - bi;
            });
            var scriptLines = [];
            var itemNos = [];
            pageRows.forEach(function (row) {
                var line = spokenAnswerFromRow(row);
                if (line === '') return;
                scriptLines.push(line);
                var itemNo = toNumber(row.item_no != null ? row.item_no : row.itemNo);
                if (!isNaN(itemNo)) itemNos.push(itemNo);
            });
            if (!scriptLines.length) return;
            var pageLabel = pageKey === '_' ? '?' : pageKey;
            units.push({
                unit_key: stem + ':' + pageLabel,
                stem: stem,
                page: pageKey === '_' ? null : (isNaN(toNumber(pageKey)) ? pageKey : toNumber(pageKey)),
                label: stem + ' p.' + pageLabel,
                original_script: scriptLines.join('\n'),
                item_count: scriptLines.length,
                // 題號清單：考試「#16~18」可用題數要靠這個跟出題範圍對齊
                item_nos: itemNos
            });
        });
        return units;
    }

    /** 扁平題號索引：[{ stem, page, item_no }]，供考試區段依 # 範圍計算可用題數 */
    function buildMetaItems(rows, context) {
        context = context || {};
        var stem = String(context.label || context.stem || '').trim();
        if (!stem && (context.published_file || context.metaFile)) {
            stem = String(context.published_file || context.metaFile)
                .replace(/\.meta\.json$/i, '')
                .replace(/\.json$/i, '');
            var parts = stem.split(/[\/_]/);
            stem = parts[parts.length - 1] || stem;
        }
        if (!stem) stem = 'M';
        var out = [];
        (rows || []).forEach(function (row) {
            var itemNo = toNumber(row.item_no != null ? row.item_no : row.itemNo);
            if (isNaN(itemNo)) return;
            var pageNum = toNumber(row.page != null ? row.page : row.Page);
            out.push({
                stem: stem,
                page: isNaN(pageNum) ? null : pageNum,
                item_no: itemNo
            });
        });
        return out;
    }

    function buildSnapshot(rows, context) {
        context = context || {};
        var scriptLines = rows.map(function (row) {
            return spokenAnswerFromRow(row);
        }).filter(function (line) { return line !== ''; });

        var displayText = formatStudentDisplayBlock(rows, context);
        var writtenText = formatWrittenAnswerBlock(rows, context);

        var gradingUnits = buildGradingUnits(rows, context);
        var metaItems = buildMetaItems(rows, context);

        return {
            material_ref: {
                materials_root_kind: context.materials_root_kind || context.rootKind || 'class',
                material_folder: context.material_folder || '',
                published_file: context.published_file || context.metaFile || '',
                published_at: context.published_at || null,
                schema_id: context.schema_id || null,
                select_mode: context.select_mode || context.mode || (context.range_spec ? 'range_spec' : 'item_range'),
                range_spec: context.range_spec || context.rangeSpec || null,
                page: context.page != null ? context.page : null,
                page_from: context.page_from != null ? context.page_from : null,
                page_to: context.page_to != null ? context.page_to : null,
                item_from: context.item_from != null ? context.item_from : null,
                item_to: context.item_to != null ? context.item_to : null,
                label: context.label || null
            },
            original_script: scriptLines.join('\n'),
            written_display: writtenText,
            student_display: displayText,
            student_display_text: displayText,
            grading_units: gradingUnits,
            meta_items: metaItems,
            recording_unit: RECORDING_UNIT,
            recording_unit_hint: RECORDING_UNIT_HINT,
            snapshot_at: new Date().toISOString()
        };
    }

    function sliceAndBuild(rows, sliceOptions, context) {
        context = context || {};
        var notes = [];
        var ready = applyExtractionFormulasToRows(
            canonicalizeMetaRows(rows, context.layout),
            context
        );
        var scriptText = context.script_text || '';
        var fullLines = scriptText ? scriptLinesFromText(scriptText) : [];
        if (scriptText && !rowsHaveSpoken(ready) && fullLines.length === ready.length) {
            ready = attachSpokenAnswersFromScript(ready, scriptText);
        }
        var filtered = filterRows(ready, sliceOptions);
        if (context.sheet_lpp > 0) {
            filtered = stampSheetPage(filtered, context.sheet_lpp);
        }
        if (scriptText && !rowsHaveSpoken(filtered)) {
            var sliceLines = scriptLinesFromText(scriptText);
            if (sliceLines.length === filtered.length) {
                filtered = attachSpokenAnswersFromScript(filtered, scriptText);
            } else {
                notes.push('口說未帶入：.script.txt 有 ' + sliceLines.length + ' 行，切片後 meta 有 '
                    + filtered.length + ' 列（整份 ' + ready.length + ' 列），對不上所以不猜');
            }
        } else if (!scriptText && !rowsHaveSpoken(filtered)) {
            notes.push('口說未帶入：找不到同 stem 的 .script.txt，列上也沒有 script');
        }
        var snapCtx = Object.assign({}, context, sliceOptions);
        var snap = buildSnapshot(filtered, snapCtx);
        if (!String(snap.written_display || '').trim()) {
            notes.push('書寫未帶入：列上沒有 _answer_combined_text／_answer_keys／answer_en');
        }
        if (!String(snap.student_display || '').trim()) {
            notes.push('學生文稿未帶入：擷取範本公式沒對到欄');
        } else if (snapCtx._studentDataDiag && snapCtx._studentDataDiag.dataEmitted === 0) {
            var diag = snapCtx._studentDataDiag;
            if (!String(diag.dataFormula || '').trim()) {
                notes.push('學生文稿只有標題：<data> 後面沒有公式');
            } else if (diag.dataErr) {
                notes.push('學生文稿 <data> 算不出：' + diag.dataErr + '｜公式 ' + diag.dataFormula);
            } else {
                notes.push('學生文稿 <data> 沒對到欄｜公式 ' + diag.dataFormula);
            }
        }
        snap.import_notes = notes;
        return snap;
    }

    return {
        parseMetaContent: parseMetaContent,
        parseRangeSpec: parseRangeSpec,
        formatRangeSpecFromNums: formatRangeSpecFromNums,
        formatRangeLabel: formatRangeLabel,
        filterRows: filterRows,
        filterRowsByRangeSpec: filterRowsByRangeSpec,
        spokenAnswerFromRow: spokenAnswerFromRow,
        writtenAnswerFromRow: writtenAnswerFromRow,
        applyExtractionFormulasToRows: applyExtractionFormulasToRows,
        siblingScriptFileName: siblingScriptFileName,
        attachSpokenAnswersFromScript: attachSpokenAnswersFromScript,
        buildSnapshot: buildSnapshot,
        buildGradingUnits: buildGradingUnits,
        formatStudentDisplayBlock: formatStudentDisplayBlock,
        studentLineFromRow: studentLineFromRow,
        formatWrittenAnswerBlock: formatWrittenAnswerBlock,
        parseStudentScriptTemplate: parseStudentScriptTemplate,
        sliceAndBuild: sliceAndBuild,
        collectMetaRowKeys: collectMetaRowKeys,
        describeMetaRowKeys: describeMetaRowKeys,
        pageNumsFromCell: pageNumsFromCell,
        rowPageNum: rowPageNum,
        resolveMetaPageKey: resolveMetaPageKey,
        normalizeMetaRows: normalizeMetaRows,
        canonicalizeMetaRows: canonicalizeMetaRows,
        summarizeMetaPages: summarizeMetaPages,
        RECORDING_UNIT: RECORDING_UNIT,
        RECORDING_UNIT_HINT: RECORDING_UNIT_HINT,
        DEFAULT_STUDENT_SCRIPT: DEFAULT_STUDENT_SCRIPT
    };
})();

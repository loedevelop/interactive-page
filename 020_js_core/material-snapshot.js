/**
 * 📂 020_js_core/material-snapshot.js
 * 從 00_Class_Materials 或老師 01_My_Materials 的 *.meta.json 切片並合成 assignment snapshot
 */
window.MaterialSnapshot = (function () {
    'use strict';

    var DISPLAY_KEYS = ['display_zh', 'pos', 'page', 'item_no', 'unit', 'note', 'teacher_note'];
    var SKIP_DISPLAY_KEYS = { script: true };

    function parseMetaContent(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        if (typeof raw === 'object') return Array.isArray(raw.rows) ? raw.rows : [];
        return [];
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
        (rows || []).forEach(function (row) {
            var v = kind === 'item'
                ? toNumber(row.item_no != null ? row.item_no : row.itemNo)
                : toNumber(row.page);
            if (!isNaN(v)) seen[v] = true;
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
            list = (rows || []).filter(function (row) {
                var pageNum = toNumber(row.page);
                return !isNaN(pageNum) && pageSet[pageNum];
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

    /**
     * 學生顯示輸出模板（存於 meta 資料夾 _Student_Display_Template.txt）：
     * 【A】[1]
     * 1.  中文。  English.
     * 2.  ...
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
            var pageKey = row.page != null && String(row.page).trim() !== '' ? String(row.page) : '_';
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
            var headerPage = pageKey === '_' ? '?' : pageKey;
            var lines = ['【' + stem + '】[' + headerPage + ']'];
            var localIdx = 1;
            pageRows.forEach(function (row) {
                var zh = String(row.display_zh || row.display || '').trim();
                var en = String(row.script || '').trim();
                if (!zh && !en) return;
                var itemNo = row.item_no != null ? row.item_no : row.itemNo;
                // 編號須採用 meta JSON 的 item_no（教材原始題號），缺值才退回頁內序號
                var num = !isNaN(toNumber(itemNo)) ? String(itemNo) : String(localIdx);
                var body = (zh ? zh : '') + (zh && en ? '  ' : '') + (en ? en : '');
                lines.push(num + '.  ' + body);
                localIdx += 1;
            });
            if (lines.length > 1) blocks.push(lines.join('\n'));
        });
        return blocks.join('\n\n');
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
            var pageKey = String(row.page != null ? row.page : (row.Page != null ? row.Page : '_'));
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
                var line = String(row.script || '').trim();
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
            if (!String(row.script || '').trim()) return;
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
            return String(row.script || '').trim();
        }).filter(function (line) { return line !== ''; });

        var displayText = formatStudentDisplayBlock(rows, context);
        if (!displayText) {
            displayText = rows.map(formatDisplayLine).filter(function (line) { return line !== ''; }).join('\n');
        }

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
        var filtered = filterRows(rows, sliceOptions);
        return buildSnapshot(filtered, Object.assign({}, context, sliceOptions));
    }

    return {
        parseMetaContent: parseMetaContent,
        parseRangeSpec: parseRangeSpec,
        formatRangeLabel: formatRangeLabel,
        filterRows: filterRows,
        filterRowsByRangeSpec: filterRowsByRangeSpec,
        buildSnapshot: buildSnapshot,
        buildGradingUnits: buildGradingUnits,
        formatStudentDisplayBlock: formatStudentDisplayBlock,
        sliceAndBuild: sliceAndBuild,
        RECORDING_UNIT: RECORDING_UNIT,
        RECORDING_UNIT_HINT: RECORDING_UNIT_HINT
    };
})();

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
     *   "pp. 1~2, 5, 10"  → 頁 1–2、5、10
     *   "#11~16, 26"      → 題 #11–16、#26
     *   "all"             → 全部
     */
    function parseRangeSpec(raw) {
        var text = String(raw || '').trim();
        if (!text) throw new Error('請填寫範圍（例：pp. 1~2, 5, 10 或 #11~16, 26）');
        if (/^all$/i.test(text) || text === '全部' || text === '全部列') {
            return { kind: 'all', pages: null, items: null, label: 'all' };
        }

        var hasPageHint = /pp\.?/i.test(text);
        var hasItemHint = /#/.test(text);
        var kind = hasItemHint && !hasPageHint ? 'item' : 'page';
        if (hasItemHint && hasPageHint) {
            throw new Error('同一列請勿混用頁碼（pp.）與題號（#），請拆成兩列');
        }

        var cleaned = text
            .replace(/pp\.?/ig, ' ')
            .replace(/#/g, ' ')
            .replace(/[～〜－—–]/g, '~')
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
            throw new Error('此範圍找不到任何列：' + (spec.label || ''));
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
            throw new Error('此範圍找不到任何列，請確認 meta 內容與篩選條件');
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
                var num = !isNaN(toNumber(itemNo)) ? String(itemNo) : String(localIdx);
                // 頁內顯示用 1. 2. 3. 連續編號（依該頁列序）
                num = String(localIdx);
                var body = (zh ? zh : '') + (zh && en ? '  ' : '') + (en ? en : '');
                lines.push(num + '.  ' + body);
                localIdx += 1;
            });
            if (lines.length > 1) blocks.push(lines.join('\n'));
        });
        return blocks.join('\n\n');
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
        formatStudentDisplayBlock: formatStudentDisplayBlock,
        sliceAndBuild: sliceAndBuild
    };
})();

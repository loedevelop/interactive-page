/**
 * 📂 020_js_core/material-snapshot.js
 * 從 00_Class_Materials 的 *.meta.json 切片並合成 assignment snapshot
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

    function filterRows(rows, options) {
        options = options || {};
        var mode = options.select_mode || options.mode || 'item_range';
        var list = rows.slice();

        if (mode === 'page') {
            var pageNum = toNumber(options.page);
            if (isNaN(pageNum)) throw new Error('請輸入有效的頁次');
            list = list.filter(function (row) {
                return toNumber(row.page) === pageNum;
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

    function buildSnapshot(rows, context) {
        context = context || {};
        var scriptLines = rows.map(function (row) {
            return String(row.script || '').trim();
        }).filter(function (line) { return line !== ''; });

        var displayLines = rows.map(formatDisplayLine).filter(function (line) { return line !== ''; });

        return {
            material_ref: {
                material_folder: context.material_folder || '',
                published_file: context.published_file || context.metaFile || '',
                published_at: context.published_at || null,
                schema_id: context.schema_id || null,
                select_mode: context.select_mode || context.mode || 'item_range',
                page: context.page != null ? context.page : null,
                item_from: context.item_from != null ? context.item_from : null,
                item_to: context.item_to != null ? context.item_to : null
            },
            original_script: scriptLines.join('\n'),
            student_display: displayLines.join('\n'),
            student_display_text: displayLines.join('\n'),
            snapshot_at: new Date().toISOString()
        };
    }

    function sliceAndBuild(rows, sliceOptions, context) {
        var filtered = filterRows(rows, sliceOptions);
        return buildSnapshot(filtered, Object.assign({}, context, sliceOptions));
    }

    return {
        parseMetaContent: parseMetaContent,
        filterRows: filterRows,
        buildSnapshot: buildSnapshot,
        sliceAndBuild: sliceAndBuild
    };
})();

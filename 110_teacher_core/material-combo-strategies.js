/**
 * 教材套餐同層多型：Excel/JSON、PDF、目錄平起平坐（三種，不是四種）。
 * 出作業下拉、教材區資料夾卡、依 id 取套餐，只准走這份註冊，不准 Excel 主檔再 concat 旁支。
 */
window.MaterialComboStrategies = (function () {
    'use strict';

    var _list = [];

    function byOrder() {
        return _list.slice().sort(function (a, b) {
            return (Number(a.order) || 0) - (Number(b.order) || 0);
        });
    }

    function register(strategy) {
        if (!strategy || !strategy.kind) return;
        var i;
        for (i = 0; i < _list.length; i++) {
            if (_list[i].kind === strategy.kind) {
                _list[i] = strategy;
                return;
            }
        }
        _list.push(strategy);
    }

    function ensureLoaded() {
        return Promise.all(byOrder().map(function (s) {
            return (typeof s.ensureLoaded === 'function') ? s.ensureLoaded() : Promise.resolve();
        }));
    }

    function listAssignedForHomework(classId) {
        var out = [];
        byOrder().forEach(function (s) {
            if (typeof s.listAssignedForHomework !== 'function') return;
            out.push.apply(out, s.listAssignedForHomework(classId) || []);
        });
        return out;
    }

    function getAssignedById(classId, comboId) {
        var want = String(comboId || '').trim();
        if (!want || want === '__manual__') return null;
        var i;
        var list = byOrder();
        for (i = 0; i < list.length; i++) {
            var s = list[i];
            if (typeof s.getAssignedById !== 'function') continue;
            var hit = s.getAssignedById(classId, want);
            if (hit) return hit;
        }
        return null;
    }

    function renderFolderHtml(folderName, ctx) {
        return byOrder().map(function (s) {
            return (typeof s.renderFolderHtml === 'function') ? (s.renderFolderHtml(folderName, ctx) || '') : '';
        }).join('');
    }

    function bind(wrap) {
        byOrder().forEach(function (s) {
            if (typeof s.bind === 'function') s.bind(wrap);
        });
    }

    function forCombo(combo) {
        if (!combo) return null;
        var list = byOrder();
        var i;
        for (i = 0; i < list.length; i++) {
            if (typeof list[i].matches === 'function' && list[i].matches(combo)) return list[i];
        }
        return null;
    }

    function kindOf(combo) {
        if (!combo) return '';
        var k = String(combo.kind || '').trim();
        if (k === 'excel' || k === 'json' || k === 'sheet') return 'sheet';
        if (k === 'pdf' || k === 'book') return k;
        var s = forCombo(combo);
        return s ? String(s.recordKind || s.kind || '') : '';
    }

    function forKind(kind) {
        var want = String(kind || '');
        var list = byOrder();
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i].kind === want) return list[i];
        }
        return null;
    }

    function packModeOf(combo) {
        var s = forCombo(combo);
        return (s && s.packMode) ? s.packMode : 'sheet';
    }

    function usesMetaRange(combo) {
        var s = forCombo(combo);
        if (s && typeof s.usesMetaRange === 'boolean') return s.usesMetaRange;
        return packModeOf(combo) === 'sheet';
    }

    /** 出作業範圍表：已選套餐走該模組；手動輸入／尚未選＝Excel/JSON 那張表。 */
    function strategyForPack(combo, comboId) {
        if (String(comboId || '') === '__manual__') return forKind('sheet');
        var s = forCombo(combo);
        if (s) return s;
        return forKind('sheet');
    }

    function renderPackTableHtml(ctx) {
        var s = strategyForPack(ctx && ctx.blockCombo, ctx && ctx.comboId);
        if (s && typeof s.renderPackTableHtml === 'function') return s.renderPackTableHtml(ctx);
        return { html: '', rowCount: 0, showsExamStats: false };
    }

    function expandPackRows(classId, combo, prevRows, helpers) {
        var s = forCombo(combo);
        if (s && typeof s.expandPackRows === 'function') {
            return s.expandPackRows(classId, combo, prevRows, helpers);
        }
        if (helpers && typeof helpers.expandSheetPackRows === 'function') {
            return helpers.expandSheetPackRows(classId, combo, prevRows);
        }
        return (prevRows && prevRows.length) ? prevRows : [];
    }

    function nextSectionRow(combo, last, helpers) {
        var s = strategyForPack(combo, last && last.combo_id);
        if ((!combo || !s || s.kind === 'sheet') && last) {
            var book = forKind('book');
            if (book && typeof book.rowLooksLike === 'function' && book.rowLooksLike(last)) s = book;
            var pdf = forKind('pdf');
            if (pdf && typeof pdf.rowLooksLike === 'function' && pdf.rowLooksLike(last)) s = pdf;
        }
        if (s && typeof s.nextSectionRow === 'function') return s.nextSectionRow(combo, last, helpers);
        return null;
    }

    function copyAllRangeFields(r) {
        var extra = {};
        byOrder().forEach(function (s) {
            if (typeof s.copyRangeFields === 'function') Object.assign(extra, s.copyRangeFields(r));
        });
        return extra;
    }

    function readAllRowFields(pathStr, idx, rowEl) {
        var extra = {};
        byOrder().forEach(function (s) {
            if (typeof s.readRowFields === 'function') Object.assign(extra, s.readRowFields(pathStr, idx, rowEl));
        });
        return extra;
    }

    function showsExamStats(combo, comboId) {
        var s = strategyForPack(combo, comboId);
        if (!s) return false;
        if (typeof s.showsExamStats === 'boolean') return s.showsExamStats;
        return usesMetaRange(combo);
    }

    return {
        register: register,
        ensureLoaded: ensureLoaded,
        listAssignedForHomework: listAssignedForHomework,
        getAssignedById: getAssignedById,
        renderFolderHtml: renderFolderHtml,
        bind: bind,
        forCombo: forCombo,
        forKind: forKind,
        strategyForPack: strategyForPack,
        kindOf: kindOf,
        packModeOf: packModeOf,
        usesMetaRange: usesMetaRange,
        renderPackTableHtml: renderPackTableHtml,
        expandPackRows: expandPackRows,
        nextSectionRow: nextSectionRow,
        copyAllRangeFields: copyAllRangeFields,
        readAllRowFields: readAllRowFields,
        showsExamStats: showsExamStats
    };
})();

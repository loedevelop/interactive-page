/**
 * 教材套餐同層多型：Excel/JSON、PDF、目錄平起平坐（三種，不是四種）。
 *
 * 產生：三個獨立區塊（來源不同，不是主從）。
 * 使用：同一就緒、同一清單、同一窗口。教材區一個夾一個窗口，三種卡平排。
 * 出作業下拉、依 id 取套餐、就緒閘門，只准走這份註冊。
 * 不准 Excel 當宿主再 concat／append 旁支，不准「只等其中一種」。
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
            var p = (typeof s.ensureLoaded === 'function') ? s.ensureLoaded() : Promise.resolve();
            return p.catch(function (err) {
                console.warn('[MaterialComboStrategies] ' + s.kind + ' 載入失敗', err);
                return null;
            });
        }));
    }

    function isReady() {
        return byOrder().every(function (s) {
            if (typeof s.isReady === 'function') return !!s.isReady();
            return true;
        });
    }

    function listAssignedForHomework(classId) {
        var out = [];
        byOrder().forEach(function (s) {
            if (typeof s.listAssignedForHomework !== 'function') return;
            out.push.apply(out, s.listAssignedForHomework(classId) || []);
        });
        return out;
    }

    function folderNames() {
        var seen = {};
        var out = [];
        byOrder().forEach(function (s) {
            if (typeof s.folderNames !== 'function') return;
            (s.folderNames() || []).forEach(function (name) {
                var n = String(name || '').trim();
                var u = n.toUpperCase();
                if (!n || seen[u]) return;
                seen[u] = true;
                out.push(n);
            });
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

    /** 這份 id 是哪個模組的套餐。有這把鑰匙才認，不准對不到就改套 Excel 表。 */
    function strategyOwningId(comboId) {
        var want = String(comboId || '').trim();
        if (!want || want === '__manual__') return null;
        var list = byOrder();
        var i;
        for (i = 0; i < list.length; i++) {
            if (typeof list[i].ownsComboId === 'function' && list[i].ownsComboId(want)) return list[i];
        }
        return null;
    }

    /** 出作業範圍表：已選套餐走該模組；手動輸入＝目錄表；尚未選＝Excel/JSON 那張表。 */
    function strategyForPack(combo, comboId) {
        if (String(comboId || '') === '__manual__') return forKind('book');
        var s = forCombo(combo);
        if (s) return s;
        s = strategyOwningId(comboId);
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
        var comboId = (combo && (combo.id || combo.combo_id)) || (last && last.combo_id);
        var s = strategyForPack(combo, comboId);
        if ((!combo || !s || s.kind === 'sheet') && last) {
            var book = forKind('book');
            if (book && (
                (typeof book.ownsComboId === 'function' && book.ownsComboId(last.combo_id))
                || (typeof book.rowLooksLike === 'function' && book.rowLooksLike(last))
            )) s = book;
            var pdf = forKind('pdf');
            if (pdf && (
                (typeof pdf.ownsComboId === 'function' && pdf.ownsComboId(last.combo_id))
                || (typeof pdf.rowLooksLike === 'function' && pdf.rowLooksLike(last))
            )) s = pdf;
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
        isReady: isReady,
        listAssignedForHomework: listAssignedForHomework,
        folderNames: folderNames,
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

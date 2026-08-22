/**
 * 活頁總題數 → 範圍內可用題／超出時修正起迄。
 * 除最後一頁外每頁滿行；頁碼從這本第 1 頁起算。
 */
window.SheetRangeBounds = (function () {
    'use strict';

    function toInt(v) {
        const n = Number(v);
        return (!isNaN(n) && n > 0) ? Math.floor(n) : 0;
    }

    function parseNumList(text) {
        const raw = String(text == null ? '' : text).trim();
        if (!raw) return [];
        const norm = raw.replace(/[～〜－—–]/g, '~').replace(/(\d)\s*-\s*(\d)/g, '$1~$2');
        const out = [];
        const seen = {};
        norm.split(/[,，、\s]+/).forEach(function (part) {
            const bit = String(part || '').trim();
            if (!bit) return;
            const m = bit.match(/^(\d+)\s*~\s*(\d+)$/);
            if (m) {
                let a = Number(m[1]);
                let b = Number(m[2]);
                if (isNaN(a) || isNaN(b)) return;
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) {
                    if (seen[i]) continue;
                    seen[i] = true;
                    out.push(i);
                }
                return;
            }
            const n = Number(bit);
            if (isNaN(n) || seen[n]) return;
            seen[n] = true;
            out.push(n);
        });
        return out;
    }

    function bounds(total, lpp) {
        const t = toInt(total);
        const lines = toInt(lpp);
        if (!t || !lines) return null;
        const lastPage = Math.ceil(t / lines);
        const lastItem = t;
        const lastPageStartItem = (lastPage - 1) * lines + 1;
        const lastPageCount = t - (lastPage - 1) * lines;
        return {
            total: t,
            lpp: lines,
            lastPage: lastPage,
            lastItem: lastItem,
            lastPageStartItem: lastPageStartItem,
            lastPageCount: lastPageCount
        };
    }

    function countOnPage(b, page) {
        const p = Number(page);
        if (isNaN(p) || p < 1 || p > b.lastPage) return 0;
        return p === b.lastPage ? b.lastPageCount : b.lpp;
    }

    function countAvailable(opts) {
        opts = opts || {};
        const b = bounds(opts.total, opts.lpp);
        if (!b) return null;
        const rtype = opts.rangeType === 'qnum' ? 'qnum' : 'page';
        const lo = Number(opts.start);
        const hi = Number(opts.end);
        if (isNaN(lo) || isNaN(hi)) return null;
        const a = Math.min(lo, hi);
        const z = Math.max(lo, hi);
        const exclude = {};
        parseNumList(opts.excludeNums).forEach(function (n) { exclude[n] = true; });
        let sum = 0;
        if (rtype === 'qnum') {
            const from = Math.max(1, a);
            const to = Math.min(b.lastItem, z);
            if (from > to) return 0;
            for (let i = from; i <= to; i++) {
                if (exclude[i]) continue;
                sum += 1;
            }
            return sum;
        }
        const fromP = Math.max(1, a);
        const toP = Math.min(b.lastPage, z);
        if (fromP > toP) return 0;
        for (let p = fromP; p <= toP; p++) {
            const pageLo = (p - 1) * b.lpp + 1;
            const pageHi = pageLo + countOnPage(b, p) - 1;
            for (let i = pageLo; i <= pageHi; i++) {
                if (exclude[i]) continue;
                sum += 1;
            }
        }
        return sum;
    }

    function clampRange(opts) {
        opts = opts || {};
        const b = bounds(opts.total, opts.lpp);
        const rtype = opts.rangeType === 'qnum' ? 'qnum' : 'page';
        const startRaw = opts.start;
        const endRaw = opts.end;
        const startN = startRaw === '' || startRaw == null ? NaN : Number(startRaw);
        const endN = endRaw === '' || endRaw == null ? NaN : Number(endRaw);
        const empty = {
            start: startRaw,
            end: endRaw,
            overflow: false,
            overflowStart: false,
            overflowEnd: false,
            lastPage: b ? b.lastPage : null,
            lastItem: b ? b.lastItem : null,
            lastPageStartItem: b ? b.lastPageStartItem : null
        };
        if (!b || isNaN(startN) || isNaN(endN)) return empty;
        let start = startN;
        let end = endN;
        if (start > end) { const t = start; start = end; end = t; }
        let overflowStart = false;
        let overflowEnd = false;
        if (rtype === 'qnum') {
            if (end > b.lastItem) {
                end = b.lastItem;
                overflowEnd = true;
            }
            if (start > b.lastItem) {
                start = b.lastPageStartItem;
                end = b.lastItem;
                overflowStart = true;
                overflowEnd = true;
            }
        } else {
            if (end > b.lastPage) {
                end = b.lastPage;
                overflowEnd = true;
            }
            if (start > b.lastPage) {
                start = b.lastPage;
                end = b.lastPage;
                overflowStart = true;
                overflowEnd = true;
            }
        }
        return {
            start: start,
            end: end,
            overflow: overflowStart || overflowEnd,
            overflowStart: overflowStart,
            overflowEnd: overflowEnd,
            lastPage: b.lastPage,
            lastItem: b.lastItem,
            lastPageStartItem: b.lastPageStartItem
        };
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function notifyOverflow(notes) {
        const list = (notes || []).filter(function (n) { return n && n.overflow; });
        if (!list.length) return Promise.resolve();
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return Promise.resolve();
        const lines = list.map(function (n) {
            const name = n.label || '活頁';
            return name
                + '：超出範圍。最後一頁第 '
                + n.lastPage
                + ' 頁、最後題號 '
                + n.lastItem
                + '。起迄已改為 '
                + n.start
                + '～'
                + n.end
                + '。';
        });
        return new Promise(function (resolve) {
            const id = 'sheet-range-overflow-' + Date.now();
            let settled = false;
            function finish() {
                if (settled) return;
                settled = true;
                resolve();
            }
            window.ModalOverlay.open({
                id: id,
                tier: 'A',
                prompt: true,
                replace: false,
                zIndex: 10050,
                contentHtml: (
                    '<div data-mo-panel role="dialog" aria-modal="true" class="modal-overlay-card">'
                    + '<div class="modal-overlay-card__msg">' + escapeHtml(lines.join('\n')).replace(/\n/g, '<br>') + '</div>'
                    + '<div class="modal-overlay-card__actions">'
                    + '<button type="button" data-mo-overflow-ok class="modal-overlay-card__ok">知道了</button>'
                    + '</div></div>'
                ),
                onClose: finish,
                onMount: function (el) {
                    const btn = el.querySelector('[data-mo-overflow-ok]');
                    if (btn) {
                        btn.addEventListener('click', function () {
                            window.ModalOverlay.close(id);
                        });
                        btn.focus();
                    }
                }
            });
        });
    }

    function examLppForCombo(combo) {
        const id = combo && combo.examTemplateId;
        if (!id || !window.FeatureTemplateLibrary || typeof window.FeatureTemplateLibrary.resolveTemplateProfile !== 'function') {
            return 0;
        }
        const profile = window.FeatureTemplateLibrary.resolveTemplateProfile(id);
        const n = profile && Number(profile.lines_per_page);
        return (n > 0) ? n : 0;
    }

    return {
        bounds: bounds,
        countAvailable: countAvailable,
        clampRange: clampRange,
        notifyOverflow: notifyOverflow,
        examLppForCombo: examLppForCombo
    };
})();

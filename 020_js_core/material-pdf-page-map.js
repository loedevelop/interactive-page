/**
 * 學生文稿 PDF：檔案頁 ≠ 課本頁／題號。
 * 鑰匙：對照列＝基準（頁碼／題號）＋課本起迄＋PDF 檔案頁起迄。
 * 重疊的課本範圍才換算；對不到就不猜、不顯示整份。
 */
(function (global) {
    function toNum(v) {
        const n = Number(v);
        return isFinite(n) ? n : null;
    }

    function normalize(raw) {
        const list = Array.isArray(raw) ? raw : [];
        const rows = list.map(function (r) {
            return {
                range_type: (r && (r.range_type || r.rangeType) === 'qnum') ? 'qnum' : 'page',
                book_start: r && r.book_start != null ? String(r.book_start) : (r && r.bookStart != null ? String(r.bookStart) : ''),
                book_end: r && r.book_end != null ? String(r.book_end) : (r && r.bookEnd != null ? String(r.bookEnd) : ''),
                pdf_start: r && r.pdf_start != null ? String(r.pdf_start) : (r && r.pdfStart != null ? String(r.pdfStart) : ''),
                pdf_end: r && r.pdf_end != null ? String(r.pdf_end) : (r && r.pdfEnd != null ? String(r.pdfEnd) : '')
            };
        }).filter(function (r) {
            return r.book_start || r.book_end || r.pdf_start || r.pdf_end;
        });
        return rows.length ? rows : [{ range_type: 'page', book_start: '', book_end: '', pdf_start: '', pdf_end: '' }];
    }

    function mapOverlap(bookStart, bookEnd, pdfStart, pdfEnd, wantStart, wantEnd) {
        const b0 = toNum(bookStart);
        const b1 = toNum(bookEnd != null && String(bookEnd).trim() !== '' ? bookEnd : bookStart);
        const p0 = toNum(pdfStart);
        const p1 = toNum(pdfEnd != null && String(pdfEnd).trim() !== '' ? pdfEnd : pdfStart);
        const w0 = toNum(wantStart);
        const w1 = toNum(wantEnd != null && String(wantEnd).trim() !== '' ? wantEnd : wantStart);
        if (b0 == null || b1 == null || p0 == null || p1 == null || w0 == null || w1 == null) return [];
        const bLo = Math.min(b0, b1);
        const bHi = Math.max(b0, b1);
        const wLo = Math.min(w0, w1);
        const wHi = Math.max(w0, w1);
        const overlapLo = Math.max(bLo, wLo);
        const overlapHi = Math.min(bHi, wHi);
        if (overlapLo > overlapHi) return [];
        const bookSpan = bHi - bLo;
        const pdfSpan = Math.abs(p1 - p0);
        const dir = p1 >= p0 ? 1 : -1;
        const pages = [];
        for (let b = overlapLo; b <= overlapHi; b++) {
            const t = bookSpan === 0 ? 0 : (b - bLo) / bookSpan;
            const p = Math.round(p0 + dir * t * pdfSpan);
            if (pages.indexOf(p) === -1) pages.push(p);
        }
        return pages;
    }

    function resolvePages(map, rangeType, bookStart, bookEnd) {
        const wantType = rangeType === 'qnum' ? 'qnum' : 'page';
        const rows = normalize(map).filter(function (r) {
            return (r.range_type === 'qnum' ? 'qnum' : 'page') === wantType;
        });
        const pages = [];
        rows.forEach(function (r) {
            mapOverlap(r.book_start, r.book_end, r.pdf_start, r.pdf_end, bookStart, bookEnd).forEach(function (p) {
                if (pages.indexOf(p) === -1) pages.push(p);
            });
        });
        pages.sort(function (a, b) { return a - b; });
        return { pages: pages, missing: pages.length === 0 };
    }

    global.MaterialPdfPageMap = {
        normalize: normalize,
        resolvePages: resolvePages
    };
})(typeof window !== 'undefined' ? window : this);

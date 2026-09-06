/**
 * 📂 020_js_core/pdf-exam-paper.js
 * 🆕 PDF 考卷（task.type === 'pdf_exam'）共用模組：跟現有 exam／meta 出題管線（quiz-paper-builder.js）
 * 完全獨立、互不影響，只是「借用」QuizPaperBuilder.gradeAnswers 做字串比對評分。
 *
 * 職責：
 * 1. 動態載入 pdf.js、從 Drive 下載 PDF 檔（GAS download_file）
 * 2. 老師貼上的解答原始文字 → 寬鬆解析成結構化答案清單（老師仍需在畫面上確認/修正，見
 *    feature-pdf-exam-job.js 的「答案清單」區塊）
 * 3. 把老師畫好框、確認好答案的 pdf_exam_job.items[] 轉成 QuizPaperBuilder.gradeAnswers
 *    看得懂的 paper 結構
 *
 * 老師端／學生端都會載入這個檔案（共用同一份解析／批改邏輯，避免兩邊各自維護一份漂移）。
 */
window.PdfExamPaper = (function () {
    'use strict';

    var PDFJS_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    // 與 020_js_core/api.js 的 GAS_API_URL、110_teacher_core/api-gas-service.js 的
    // GAS_WEB_APP_URL 必須是同一支 GAS 部署（見 drive-folder-upload-invariants.mdc）。
    var GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec';
    var TPL_ORDER_LTR_TTB = 'detect-sections-student-locate';
    var TPL_TEACHER_LOCATE = 'teacher-locate';
    var PDF_EXAM_TEMPLATES = [
        { key: TPL_ORDER_LTR_TTB, name: '左到右、上到下（預設）' },
        { key: TPL_TEACHER_LOCATE, name: '老師定位' }
    ];

    var _pdfJsLoadPromise = null;

    function ensurePdfJsLoaded() {
        var core = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (core) {
            core.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            return Promise.resolve(core);
        }
        if (_pdfJsLoadPromise) return _pdfJsLoadPromise;
        _pdfJsLoadPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = PDFJS_SCRIPT;
            script.onload = function () {
                var lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                if (!lib) { reject(new Error('pdf.js 載入失敗')); return; }
                lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
                resolve(lib);
            };
            script.onerror = function () {
                _pdfJsLoadPromise = null;
                reject(new Error('pdf.js 載入失敗（CDN 無法連線，請檢查網路後重試）'));
            };
            document.head.appendChild(script);
        });
        return _pdfJsLoadPromise;
    }

    /** 透過 GAS download_file 動作把 Drive 檔案下載成 ArrayBuffer（學生端沒有載入 GasService，這裡直接打 GAS） */
    function downloadDriveFileAsArrayBuffer(fileId) {
        if (!fileId) return Promise.reject(new Error('缺少 fileId'));
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 55000) : null;
        var opts = {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'download_file', fileId: String(fileId).trim() })
        };
        if (controller) opts.signal = controller.signal;
        return fetch(GAS_API_URL, opts).then(function (resp) {
            return resp.text();
        }).then(function (text) {
            if (timeoutId) clearTimeout(timeoutId);
            var result;
            try { result = JSON.parse(text); } catch (_e) {
                throw new Error('GAS 下載回應格式錯誤（可能逾時或伺服器忙碌，請重試）');
            }
            if (!result || !result.fileData) throw new Error((result && result.message) || 'GAS 下載失敗');
            var binary = atob(result.fileData);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return { arrayBuffer: bytes.buffer, mimeType: result.mimeType || 'application/pdf', fileName: result.fileName || '' };
        }).catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            throw err;
        });
    }

    function loadPdfDocumentFromDrive(fileId) {
        return ensurePdfJsLoaded().then(function (pdfjsLib) {
            return downloadDriveFileAsArrayBuffer(fileId).then(function (file) {
                return pdfjsLib.getDocument({ data: file.arrayBuffer }).promise;
            });
        });
    }

    // ------------------------------------------------------------------
    // 🤖 自動定位答案框：定位是程式的工作，不是老師的工作。
    // 做法：用 pdf.js 讀出每一頁文字的座標，找出「底線／空格」當作可填答案的位置。
    // 多欄排版（例如同一頁左欄 1~5 題、右欄 6~10 題）光靠座標順序不保證跟解答清單順序
    // 一致，所以每個空格會先「往左找印在考卷上最近的題號文字」（例如 "6."），直接跟解答
    // 清單同一題號配對——不管畫在哪一欄都對得到正確題目。真的找不到題號文字的空格，
    // 才退回用「同高度左到右、再由上到下」的座標順序，跟剩下的答案依序配對當保險。
    // ------------------------------------------------------------------

    // 💣 掃描稿＋OCR（例如 ABBYY FineReader）常常把底線／填空線誤讀成別的字元（實測過某份考卷
    // 「＿＿＿＿」被 OCR 成一長串同一個字母，不是真的底線符號），所以不能只認文字 "_"。改成
    // 「同一個字元連續重複 5 次以上」都視為空格候選——不管 OCR 把它讀成什麼字元，正常英文/
    // 中文內容幾乎不會有單一字元連續重複這麼多次，這樣判斷才不會被 OCR 的錯誤字元騙過去。
    var REPEATED_CHAR_RUN_RE = /^(.)\1{4,}$/;
    var UNDERSCORE_ITEM_RE = /_/;
    var UNDERSCOREISH_RE = /^[_\-\s]*$/;
    var ROW_Y_TOLERANCE_PCT = 1.2;
    var MERGE_GAP_PCT = 1.5;

    function _isBlankishToken(str) {
        var s = String(str || '').replace(/\s+/g, '');
        if (!s) return false;
        if (UNDERSCOREISH_RE.test(str) && UNDERSCORE_ITEM_RE.test(str)) return true; // 真的是底線字元
        return REPEATED_CHAR_RUN_RE.test(s); // OCR 誤讀出來的同字元重複長串，也當空格候選
    }

    /** 把一頁的 textContent 轉成百分比座標（相對頁面寬高，yPct 以頂端為 0） */
    function _pageItemsPct(page) {
        return page.getTextContent().then(function (tc) {
            var view = page.view || [0, 0, page.width || 612, page.height || 792];
            var pageW = view[2] - view[0];
            var pageH = view[3] - view[1];
            return (tc.items || []).map(function (ti) {
                var fontSize = Math.abs(ti.transform[3]) || Math.abs(ti.transform[0]) || 10;
                var baseline = ti.transform[5];
                var topPdf = baseline + fontSize * 0.88;
                var botPdf = baseline - fontSize * 0.28;
                var xPdf = ti.transform[4];
                var wPdf = ti.width || (fontSize * 0.55 * String(ti.str || '').length);
                return {
                    str: ti.str || '',
                    xPct: ((xPdf - view[0]) / pageW) * 100,
                    wPct: (wPdf / pageW) * 100,
                    yPct: ((view[3] - topPdf) / pageH) * 100,
                    hPct: ((topPdf - botPdf) / pageH) * 100
                };
            }).filter(function (it) { return it.str; });
        });
    }

    /** 依 yPct 相近程度把文字項目分行（容忍度內視為同一行），行內再依 xPct 排序 */
    function _groupLines(items) {
        var lines = [];
        items.forEach(function (it) {
            var line = lines.find(function (l) { return Math.abs(l.yPct - it.yPct) <= ROW_Y_TOLERANCE_PCT; });
            if (!line) { line = { yPct: it.yPct, items: [] }; lines.push(line); }
            line.items.push(it);
        });
        lines.forEach(function (l) { l.items.sort(function (a, b) { return a.xPct - b.xPct; }); });
        lines.sort(function (a, b) { return a.yPct - b.yPct; });
        return lines;
    }

    /** 在同一行的文字項目裡找出「底線／空格」的連續片段，相鄰間距很小就合併成同一個空格 */
    function _underscoreRunsInLine(lineItems) {
        var runs = [];
        var current = null;
        lineItems.forEach(function (it) {
            var isBlankish = _isBlankishToken(it.str);
            if (!isBlankish) { if (current) { runs.push(current); current = null; } return; }
            if (current && (it.xPct - (current.xPct + current.wPct)) <= MERGE_GAP_PCT) {
                current.wPct = (it.xPct + it.wPct) - current.xPct;
                current.hPct = Math.max(current.hPct, it.hPct);
            } else {
                if (current) runs.push(current);
                current = { xPct: it.xPct, yPct: it.yPct, wPct: it.wPct, hPct: it.hPct };
            }
        });
        if (current) runs.push(current);
        return runs;
    }

    /**
     * 💣 多欄排版（例如同一頁左欄 1~5 題、右欄 6~10 題，見老師附圖）：光靠座標順序沒辦法
     * 保證跟解答清單的順序一致（答案是照 OCR/謄打順序，欄位配置卻可能是任何順序）。
     * 所以每個空格都會先「往左找印在考卷上的題號文字」（例如空格前面最近的 "6."），
     * 只要找到題號，就直接跟解答清單裡同一題號配對——不管這個空格畫在左欄還右欄，
     * 都能對到正確題目，不是單純依賴視覺順序猜。找不到題號文字的空格，才退回用座標順序
     * （同高度左到右、再由上到下）跟剩下的答案依序配對當保險。
     */
    function _labelBeforeBlank(lineItems, blankStartXPct) {
        var candidates = lineItems
            .filter(function (it) {
                return (it.xPct + it.wPct) <= blankStartXPct + 0.3
                    && !_isBlankishToken(it.str);
            })
            .sort(function (a, b) { return b.xPct - a.xPct; }); // 離空格最近的優先比對
        for (var i = 0; i < candidates.length; i++) {
            var s = String(candidates[i].str || '').trim();
            var numMatch = s.match(/^\(?(\d{1,3})\s*[.\)]/);
            if (numMatch) return { itemNo: numMatch[1], part: null };
            var abMatch = s.match(/^([A-Za-z])\s*[:.]/);
            if (abMatch) return { itemNo: null, part: abMatch[1].toUpperCase() };
        }
        return null;
    }

    /**
     * 💣 掃描紙本＋OCR 的考卷（例如老師附的 Azar 練習卷，Creator 是 ABBYY FineReader）常見一種
     * 更麻煩的狀況：整條「給學生手寫的空白底線」在 OCR 文字圖層裡完全沒有任何文字（不是誤讀成
     * 別的字元，是「什麼都沒有」），因為那一段對 OCR 來說就是空白像素，沒東西可辨識。這種空格
     * 用文字座標（_pageItemsPct／_underscoreRunsInLine）永遠找不到，因為 pdf.js 的文字圖層在
     * 那個位置就是空的。唯一辦法是把該頁「畫」成圖片，直接在像素上找「一條細長的水平黑線」
     * （印刷底線的樣子：夠寬、但很薄，不是文字、也不是表格粗框線／色塊）。
     *
     * 回傳每頁偵測到的底線方框（xPct/yPct/wPct/hPct），純座標，不含題號判斷（圖片沒有文字可讀）。
     */
    function _detectImageBlankLines(page) {
        var scale = 2;
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        var ctx = canvas.getContext('2d');
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
            var w = canvas.width, h = canvas.height;
            var data = ctx.getImageData(0, 0, w, h).data;
            var minWidthPx = Math.max(w * 0.035, 18);

            function isDarkAt(x, y) {
                var idx = (y * w + x) * 4;
                return (data[idx] + data[idx + 1] + data[idx + 2]) < 460;
            }

            // 逐行找「連續深色 pixel」的長條（容忍 <=3px 的小縫隙，避免虛線／掃描雜訊誤判成中斷）
            var runs = [];
            for (var y = 0; y < h; y++) {
                var runStart = -1, gap = 0;
                for (var x = 0; x < w; x++) {
                    var dark = isDarkAt(x, y);
                    if (dark) {
                        if (runStart === -1) runStart = x;
                        gap = 0;
                    } else if (runStart !== -1) {
                        gap++;
                        if (gap > 3) {
                            var x2 = x - gap;
                            if (x2 - runStart >= minWidthPx) runs.push({ y: y, x1: runStart, x2: x2 });
                            runStart = -1; gap = 0;
                        }
                    }
                }
                if (runStart !== -1 && (w - 1 - runStart) >= minWidthPx) runs.push({ y: y, x1: runStart, x2: w - 1 });
            }

            // 把相鄰行、x 範圍重疊的 run 合併成同一條線（掃描出來的底線常常跨 1~3 個 pixel row）
            runs.sort(function (a, b) { return a.y - b.y; });
            var merged = [];
            runs.forEach(function (r) {
                var found = null;
                for (var i = merged.length - 1; i >= 0; i--) {
                    var m = merged[i];
                    if (r.y - m.y2 > 2) continue;
                    if (r.x2 < m.x1 - 4 || r.x1 > m.x2 + 4) continue;
                    found = m; break;
                }
                if (found) {
                    found.y2 = r.y;
                    found.x1 = Math.min(found.x1, r.x1);
                    found.x2 = Math.max(found.x2, r.x2);
                } else {
                    merged.push({ y1: r.y, y2: r.y, x1: r.x1, x2: r.x2 });
                }
            });

            // 太厚（跨太多 pixel row）代表可能是表格粗框線／色塊／圖片，不是手寫底線，濾掉
            var lines = merged.filter(function (m) { return (m.y2 - m.y1) <= 5; });

            return lines.map(function (m) {
                return {
                    xPct: (m.x1 / w) * 100,
                    yPct: Math.max(0, (m.y1 / h) * 100 - 1.4),
                    wPct: ((m.x2 - m.x1) / w) * 100,
                    hPct: 2.6
                };
            });
        });
    }

    /**
     * 掃整份 PDF，找出每一個底線／空格，並嘗試判斷它前面印的題號（跨欄／跨排都適用）。
     * 回傳依「同高度左到右、再由上到下」排序的清單：
     * [{ page, section, itemNo（可能是 null）, part（可能是 null）, box }]
     * 只能偵測 PDF 本身有文字圖層的情況；掃描圖片（無文字圖層）該頁會是 0 個空格，
     * 這種頁面沒辦法自動定位，只能靠老師手動補畫框。
     */
    function _detectLabeledBlanks(pdfDoc) {
        var numPages = pdfDoc.numPages;
        var pageNums = [];
        for (var p = 1; p <= numPages; p++) pageNums.push(p);
        var currentSection = '(未分類)';
        var currentItemNo = null;
        var pdfTestCtx = null;
        return pageNums.reduce(function (chain, pageNum) {
            return chain.then(function (acc) {
                return pdfDoc.getPage(pageNum).then(function (page) {
                    return _pageItemsPct(page).then(function (items) {
                        var lines = _groupLines(items);
                        var pageBlanks = [];
                        lines.forEach(function (line) {
                            var lineText = line.items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim();
                            var collapsed = _collapseLetterSpacedTokens(lineText);
                            var secMatch = collapsed.match(SECTION_HEADER_ANYWHERE_RE) || lineText.match(SECTION_HEADER_ANYWHERE_RE);
                            if (secMatch && !/^\d+[.\)]/.test(collapsed) && !/^\d+[.\)]/.test(lineText)) {
                                var composed = _composeSectionLabel(pdfTestCtx, secMatch[1]);
                                pdfTestCtx = composed.testCtx;
                                if (composed.isTestHeader) {
                                    currentSection = composed.label || composed.testCtx;
                                    currentItemNo = null;
                                    return;
                                }
                                if (!composed.label) return;
                                currentSection = composed.label;
                                currentItemNo = null;
                                return; // 標頭本身不是空格所在行，不用再找底線
                            }
                            _underscoreRunsInLine(line.items).forEach(function (r) {
                                var label = _labelBeforeBlank(line.items, r.xPct);
                                var itemNo = null, part = null;
                                if (label) {
                                    if (label.itemNo != null) { itemNo = label.itemNo; currentItemNo = label.itemNo; }
                                    else if (label.part) { part = label.part; itemNo = currentItemNo; }
                                }
                                pageBlanks.push({
                                    page: pageNum,
                                    section: currentSection,
                                    itemNo: itemNo,
                                    part: part,
                                    box: {
                                        xPct: r.xPct,
                                        yPct: r.yPct,
                                        wPct: Math.max(r.wPct, 3),
                                        hPct: Math.max(r.hPct * 1.3, 2.2)
                                    }
                                });
                            });
                        });

                        // 💣 掃描稿常有整條「完全沒有文字」的空白底線（文字圖層找不到，見
                        // _detectImageBlankLines 說明），這裡另外用畫面像素抓一次，把跟上面文字型
                        // 空格明顯重疊的去掉重複，剩下的當「圖片偵測到、但讀不到題號」的空格併入。
                        return _detectImageBlankLines(page).then(function (imageLines) {
                            imageLines.forEach(function (ib) {
                                var overlaps = pageBlanks.some(function (tb) {
                                    var yClose = Math.abs(tb.box.yPct - ib.yPct) <= 2.5;
                                    var xOverlap = !(ib.xPct + ib.wPct < tb.box.xPct - 1 || ib.xPct > tb.box.xPct + tb.box.wPct + 1);
                                    return yClose && xOverlap;
                                });
                                if (overlaps) return;
                                // 💣 「範例已示範」的那一行（例如第1題印好的 wanted、Have you ever eaten）
                                // 底下通常也印了同一條底線（版面統一），但那格已經有答案、不是空格。
                                // 若這條線正上方有「非空格樣式」的真實文字貼著線，代表這行已經被印好
                                // 答案，直接排除，不然會把「已示範」那一格也當空格塞進位置保險配對，
                                // 害後面所有題目對位全部錯位一格。
                                var alreadyFilled = items.some(function (it) {
                                    if (_isBlankishToken(it.str)) return false;
                                    if (String(it.str || '').trim().length < 2) return false;
                                    var textBottom = it.yPct + it.hPct;
                                    var sitsAboveLine = (ib.yPct - textBottom) >= -1.2 && (ib.yPct - textBottom) <= 1.8;
                                    var xOverlap2 = !(it.xPct + it.wPct < ib.xPct - 1 || it.xPct > ib.xPct + ib.wPct + 1);
                                    return sitsAboveLine && xOverlap2;
                                });
                                if (alreadyFilled) return;
                                // 嘗試借用同高度那一行的文字，猜猜空格前面有沒有印題號（掃描 OCR
                                // 若把數字讀對，這裡就能跟文字型空格一樣享有題號比對；讀不到就是
                                // null，交給位置保險配對）
                                var nearLine = lines.find(function (l) { return Math.abs(l.yPct - ib.yPct) <= ROW_Y_TOLERANCE_PCT * 1.5; });
                                var label = nearLine ? _labelBeforeBlank(nearLine.items, ib.xPct) : null;
                                var itemNo = null, part = null;
                                if (label) {
                                    if (label.itemNo != null) { itemNo = label.itemNo; currentItemNo = label.itemNo; }
                                    else if (label.part) { part = label.part; itemNo = currentItemNo; }
                                }
                                pageBlanks.push({
                                    page: pageNum,
                                    section: currentSection,
                                    itemNo: itemNo,
                                    part: part,
                                    box: ib,
                                    _fromImage: true
                                });
                            });
                            pageBlanks.sort(function (a, b) { return a.box.yPct - b.box.yPct || a.box.xPct - b.box.xPct; });
                            pageBlanks.forEach(function (b) { acc.push(b); });
                            return acc;
                        });
                    });
                });
            });
        }, Promise.resolve([]));
    }

    /** 對外保留的簡化版：只回傳空格座標（不含題號判斷），供除錯／未來擴充使用 */
    function detectBlankCandidates(pdfDoc) {
        return _detectLabeledBlanks(pdfDoc).then(function (blanks) {
            return blanks.map(function (b) { return { page: b.page, box: b.box }; });
        });
    }

    /**
     * 💣 逗號拆格判斷用：不是要畫框，只是要「數」考卷上某一題（題號＋A/B子項）到底印了幾條空格線，
     * 用來判斷解答文字裡的逗號是「同一格的替代寫法」還是「依序的多個空格」（見 parseAnswerText）。
     * 只統計「有找到題號」的空格（`_labelBeforeBlank` 判斷得到），完全比對不到題號的空格不列入，
     * 避免污染統計、也避免這個「數空格」的用途跟「畫框」用途一樣被 OCR 誤差牽著走太多。
     * 回傳 { "itemNo::part" -> 空格數量 }（part 可能是空字串）。
     */
    function detectBlankCountsByLabel(pdfDoc) {
        return _detectLabeledBlanks(pdfDoc).then(function (blanks) {
            var counts = {};
            blanks.forEach(function (bl) {
                if (bl.itemNo == null) return;
                var loose = String(bl.itemNo) + '::' + (bl.part || '');
                counts[loose] = (counts[loose] || 0) + 1;
            });
            return counts;
        });
    }

    function _sectionReviewKey(s) {
        return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    /**
     * 掃 PDF 空格線，依大題＋題號統計格數，給答案清單做交叉檢查（只提醒、不自動改拆格）。
     * 回傳 { total, bySection: { reviewKey: { section, total, byLoose: { "1::B": 2 } } } }
     */
    function detectBlankReviewStats(pdfDoc) {
        return _detectLabeledBlanks(pdfDoc).then(function (blanks) {
            var bySection = {};
            (blanks || []).forEach(function (bl) {
                var sec = bl.section || '(未分類)';
                var sk = _sectionReviewKey(sec);
                if (!bySection[sk]) bySection[sk] = { section: sec, total: 0, byLoose: {} };
                bySection[sk].total++;
                if (bl.itemNo == null) return;
                var loose = String(bl.itemNo) + '::' + (bl.part || '');
                bySection[sk].byLoose[loose] = (bySection[sk].byLoose[loose] || 0) + 1;
            });
            return { total: (blanks || []).length, bySection: bySection };
        });
    }

    function _quizNumberOfLabel(section) {
        var m = String(section || '').match(/quiz\s*(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    }

    /**
     * 解答兩欄接續：右欄最上沒有 Quiz 標頭、下方是 Quiz N+1、題號接上 Quiz N
     * → 那串題號屬 Quiz N。
     * 鑰匙＝較早的大題裡同一題號出現第二次（左欄自己的題 + 右欄接續），且接上 Quiz N 最後一題。
     * 有第二次才搬；不是去別組「借」唯一的那題。
     */
    function reattachColumnContinuations(items) {
        var log = [];
        if (!items || !items.length) return log;
        var quizNums = [];
        var labelByNum = {};
        items.forEach(function (it) {
            var n = _quizNumberOfLabel(it.section);
            if (n == null) return;
            if (quizNums.indexOf(n) === -1) quizNums.push(n);
            if (!labelByNum[n]) labelByNum[n] = it.section;
        });
        quizNums.sort(function (a, b) { return a - b; });
        quizNums.forEach(function (n, qi) {
            var next = quizNums[qi + 1];
            if (next !== n + 1) return;
            var ofN = items.filter(function (it) { return _quizNumberOfLabel(it.section) === n; });
            var lastNo = -1;
            ofN.forEach(function (it) {
                var no = parseInt(it.itemNo, 10);
                if (!isNaN(no) && no > lastNo) lastNo = no;
            });
            if (lastNo < 0) return;
            var movedNos = [];
            var need = lastNo + 1;
            while (true) {
                var extras = [];
                items.forEach(function (it) {
                    var q = _quizNumberOfLabel(it.section);
                    if (q == null || q >= n) return;
                    if (parseInt(it.itemNo, 10) !== need) return;
                    extras.push(it);
                });
                var byBucket = {};
                extras.forEach(function (it) {
                    var gk = String(it.section) + '|' + String(it.group || '') + '|' + String(it.part || '');
                    (byBucket[gk] = byBucket[gk] || []).push(it);
                });
                var bucketKeys = Object.keys(byBucket).sort(function (a, b) {
                    var qa = _quizNumberOfLabel(byBucket[a][0].section) || 0;
                    var qb = _quizNumberOfLabel(byBucket[b][0].section) || 0;
                    return qa - qb;
                });
                var picked = null;
                bucketKeys.forEach(function (gk) {
                    if (picked) return;
                    if (byBucket[gk].length >= 2) picked = byBucket[gk][byBucket[gk].length - 1];
                });
                if (!picked) break;
                picked.section = labelByNum[n];
                picked.group = ofN[0] ? ofN[0].group : picked.group;
                movedNos.push(need);
                need += 1;
            }
            if (movedNos.length) {
                log.push({
                    to: labelByNum[n],
                    next: labelByNum[next],
                    itemNos: movedNos
                });
            }
        });
        return log;
    }

    function _answerSectionOrder(bank) {
        var order = [];
        var seen = {};
        (bank || []).forEach(function (it) {
            if (!it) return;
            var s = it.section || '(未分類)';
            var k = _sectionReviewKey(s);
            if (seen[k]) return;
            seen[k] = true;
            order.push(s);
        });
        return order;
    }

    /**
     * 解答裡缺的 Quiz 編號（從 1 連續到解答／題目出現過的最大號）。
     * 第一組解答是 Quiz 2 → Quiz 1 仍要列出。中間跳號（6 然後 8）→ Quiz 7 仍要列出。
     * 禁止因為題目掃不到標題、或不知怎麼處理，就把這一組丟掉。
     */
    function listMissingQuizSections(bank, paperLabels) {
        var presentNums = {};
        var paperByNum = {};
        _answerSectionOrder(bank).forEach(function (s) {
            var n = _quizNumberOfLabel(s);
            if (n != null) presentNums[n] = true;
        });
        (paperLabels || []).forEach(function (s) {
            var n = _quizNumberOfLabel(s);
            if (n != null) paperByNum[n] = s;
        });
        var max = 0;
        Object.keys(presentNums).forEach(function (k) {
            var n = parseInt(k, 10);
            if (n > max) max = n;
        });
        Object.keys(paperByNum).forEach(function (k) {
            var n = parseInt(k, 10);
            if (n > max) max = n;
        });
        if (!max) return [];
        var missing = [];
        var n;
        for (n = 1; n <= max; n++) {
            if (presentNums[n]) continue;
            missing.push({ section: paperByNum[n] || ('Quiz ' + n), num: n });
        }
        return missing;
    }

    function groupItemsBySectionWithMissing(bank, missingSections) {
        var groups = groupItemsBySection(bank);
        var seen = {};
        groups.forEach(function (g) { seen[_sectionReviewKey(g.section)] = true; });
        var extras = [];
        (missingSections || []).forEach(function (m) {
            if (!m || !m.section) return;
            if (seen[_sectionReviewKey(m.section)]) return;
            seen[_sectionReviewKey(m.section)] = true;
            extras.push({ section: m.section, items: [], missing: true });
        });
        var all = groups.concat(extras);
        all.sort(function (a, b) {
            var na = _quizNumberOfLabel(a.section);
            var nb = _quizNumberOfLabel(b.section);
            if (na != null && nb != null && na !== nb) return na - nb;
            if (na != null && nb == null) return -1;
            if (na == null && nb != null) return 1;
            return 0;
        });
        return all;
    }

    function buildQuizGroupWarnings(bank, paperLabels, reattachLog, extraLabels) {
        var warnings = [];
        var answerSecs = _answerSectionOrder(bank);
        var paperList = paperLabels || [];
        var paperKeys = {};
        paperList.forEach(function (s) { paperKeys[_sectionReviewKey(s)] = s; });
        var answerKeys = {};
        answerSecs.forEach(function (s) { answerKeys[_sectionReviewKey(s)] = s; });

        if (paperList.length && answerSecs.length) {
            var paperN = paperList.length;
            var answerN = answerSecs.filter(function (s) { return s !== '(未分類)'; }).length;
            if (paperN !== answerN) {
                warnings.push({
                    kind: 'group_mismatch',
                    section: '',
                    message: '題目有 ' + paperN + ' 組大題，解答有 ' + answerN + ' 組，對不上'
                });
            }
        }
        var warnedMissing = {};
        paperList.forEach(function (ps) {
            var k = _sectionReviewKey(ps);
            if (!answerKeys[k]) {
                warnedMissing[k] = true;
                warnings.push({
                    kind: 'group_mismatch',
                    section: ps,
                    message: '題目有「' + ps + '」，解答沒有（這一組答案消失了；沒有從畫面拿掉）'
                });
            }
        });
        listMissingQuizSections(bank, (paperList || []).concat(extraLabels || [])).forEach(function (m) {
            var k = _sectionReviewKey(m.section);
            if (answerKeys[k] || warnedMissing[k]) return;
            warnedMissing[k] = true;
            warnings.push({
                kind: 'group_mismatch',
                section: m.section,
                message: '解答編號缺「' + m.section + '」（這一組沒有從畫面拿掉）'
            });
        });
        answerSecs.forEach(function (as) {
            if (as === '(未分類)') return;
            if (!paperList.length) return;
            var k = _sectionReviewKey(as);
            if (!paperKeys[k]) {
                warnings.push({
                    kind: 'group_mismatch',
                    section: as,
                    message: '解答有「' + as + '」，題目沒掃到這一組'
                });
            }
        });

        var quizSecs = answerSecs.map(function (s) {
            return { section: s, num: _quizNumberOfLabel(s) };
        }).filter(function (x) { return x.num != null; }).sort(function (a, b) { return a.num - b.num; });
        quizSecs.forEach(function (q) {
            var nos = [];
            (bank || []).forEach(function (it) {
                if (_sectionReviewKey(it.section) !== _sectionReviewKey(q.section)) return;
                var no = parseInt(it.item_no, 10);
                if (!isNaN(no) && nos.indexOf(no) === -1) nos.push(no);
            });
            nos.sort(function (a, b) { return a - b; });
            var j;
            for (j = 1; j < nos.length; j++) {
                if (nos[j] !== nos[j - 1] + 1) {
                    warnings.push({
                        kind: 'item_gap',
                        section: q.section,
                        message: '「' + q.section + '」題號不連續（' + nos[j - 1] + ' 之後是 ' + nos[j] + '）'
                    });
                    break;
                }
            }
        });

        (reattachLog || []).forEach(function (note) {
            if (!note || !note.to) return;
            warnings.push({
                kind: 'column_wrap',
                section: note.to,
                message: '已把無標頭、題號接續的第 ' + (note.itemNos || []).join('、') + ' 題收進「' + note.to + '」（下一標頭是「' + (note.next || '') + '」）。請核對'
            });
        });
        return warnings;
    }

    /**
     * 交叉檢查：① 解答大題組 vs 題目 PDF 掃到的大題組 ② 清單格數 vs PDF 空格線。
     * 對不上列進 warnings。禁止因為某一組沒解析到就當成沒有、從畫面拿掉。
     * extra.paperLabels＝掃題目 PDF 得到的大題名（依出現順序）。
     * extra.reattachLog＝欄位接續已收進哪一大題。
     * extra.section_template_overrides／teacher_located_boxes＝老師已選的第二份範本，重跑解析要保留。
     */
    function buildSplitReview(bank, blankStats, extra) {
        extra = extra || {};
        var flagged = {};
        var statsBySec = (blankStats && blankStats.bySection) || {};
        var extraLabels = (extra.paperLabels || []).slice();
        Object.keys(statsBySec).forEach(function (sk) {
            if (statsBySec[sk] && statsBySec[sk].section) extraLabels.push(statsBySec[sk].section);
        });
        var sectionWarnings = buildQuizGroupWarnings(bank, extra.paperLabels, extra.reattachLog, extraLabels);
        var missingSections = listMissingQuizSections(bank, extraLabels);
        var groups = {};
        (bank || []).forEach(function (it) {
            if (!it) return;
            var sk = _sectionReviewKey(it.section);
            if (!groups[sk]) groups[sk] = { section: it.section, items: [], byLoose: {} };
            groups[sk].items.push(it);
            var loose = String(it.item_no || '') + '::' + (it.part || '');
            (groups[sk].byLoose[loose] = groups[sk].byLoose[loose] || []).push(it);
        });
        Object.keys(groups).forEach(function (sk) {
            var g = groups[sk];
            var st = statsBySec[sk];
            if (st && st.total > 0 && st.total !== g.items.length) {
                sectionWarnings.push({
                    kind: 'blank_count',
                    section: g.section,
                    parsed: g.items.length,
                    blanks: st.total,
                    message: '「' + g.section + '」清單 ' + g.items.length + ' 格，空格線偵測到 ' + st.total + ' 格，請人工核對'
                });
            }
            Object.keys(g.byLoose).forEach(function (loose) {
                var items = g.byLoose[loose];
                var hintN = st && st.byLoose ? st.byLoose[loose] : null;
                if (hintN == null || hintN <= 0 || hintN === items.length) return;
                var label = (items[0].item_no || '') + (items[0].part ? ('-' + items[0].part) : '');
                var reason = '「' + g.section + '」第 ' + label + ' 題：清單 ' + items.length + ' 格，空格線 ' + hintN + ' 格';
                items.forEach(function (it) { flagged[it.key] = reason; });
            });
        });
        missingSections.forEach(function (m) {
            if (!m || !m.section) return;
            var st = statsBySec[_sectionReviewKey(m.section)];
            if (!st || !st.total) return;
            if (groups[_sectionReviewKey(m.section)]) return;
            sectionWarnings.push({
                kind: 'blank_count',
                section: m.section,
                parsed: 0,
                blanks: st.total,
                message: '「' + m.section + '」清單 0 格，空格線偵測到 ' + st.total + ' 格（這一組沒有從畫面拿掉）'
            });
        });
        var unclassified = statsBySec[_sectionReviewKey('(未分類)')];
        if (unclassified && unclassified.total > 0 && !groups[_sectionReviewKey('(未分類)')]) {
            sectionWarnings.push({
                kind: 'group_mismatch',
                section: '(未分類)',
                message: '有 ' + unclassified.total + ' 格空格線還沒對上大題標頭（沒有捨棄）'
            });
        }
        return {
            pdf_checked: !!(blankStats && blankStats.total > 0),
            paper_labels: extra.paperLabels || [],
            missing_sections: missingSections,
            section_warnings: sectionWarnings,
            flagged_keys: flagged,
            section_template_overrides: extra.section_template_overrides || {},
            teacher_located_boxes: extra.teacher_located_boxes || {},
            confirmed_sections: extra.confirmed_sections || {}
        };
    }

    /**
     * 自動定位主流程，三層比對（信心程度由高到低）：
     * ① 空格前面的題號文字 + 大題完全對上解答清單的 key → 直接配對（多欄／跳頁都適用）
     * ② 題號對上，但大題文字沒對上（老師答案沒抄大題標頭）——只要整份解答清單裡這個題號
     *    是唯一一筆（不會跟別的大題撞號），一樣直接配對；撞號就不猜，退到③
     * ③ 完全沒偵測到題號文字的空格，跟還沒配對到的答案，依「同高度左到右、再上到下」
     *    的座標順序依序配對，當最後保險
     * 回傳 { items, unmatchedBank, extraBlanks, totalBlanks, totalBank }
     */
    function autoAssignBoxesInOrder(pdfDoc, parsedBank) {
        return _detectLabeledBlanks(pdfDoc).then(function (blanks) {
            var bank = parsedBank || [];
            var bankByKey = {};
            bank.forEach(function (b) { bankByKey[b.key] = b; });
            var byItemNoPart = {};
            bank.forEach(function (b) {
                var loose = String(b.item_no || '') + '::' + (b.part || '');
                (byItemNoPart[loose] = byItemNoPart[loose] || []).push(b);
            });

            var usedKeys = {};
            var items = [];
            var leftoverBlanks = [];

            blanks.forEach(function (bl) {
                if (bl.itemNo == null) { leftoverBlanks.push(bl); return; }
                var exactKey = makeKey(bl.section, bl.itemNo, bl.part);
                var bk = bankByKey[exactKey];
                var method = 'label-section';
                if (!bk || usedKeys[bk.key]) {
                    var loose = String(bl.itemNo) + '::' + (bl.part || '');
                    var candidates = (byItemNoPart[loose] || []).filter(function (b) { return !usedKeys[b.key]; });
                    if (candidates.length === 1) { bk = candidates[0]; method = 'label-loose'; }
                    else bk = null;
                }
                if (bk) {
                    usedKeys[bk.key] = true;
                    items.push({
                        key: bk.key, section: bk.section, item_no: bk.item_no, part: bk.part,
                        page: bl.page, box: bl.box,
                        answer_text: bk.answer_text, accepted_answers: bk.accepted_answers,
                        _auto: true, _auto_method: method
                    });
                } else {
                    leftoverBlanks.push(bl);
                }
            });

            var remainingBank = bank.filter(function (b) { return !usedKeys[b.key]; });
            var n = Math.min(leftoverBlanks.length, remainingBank.length);
            for (var i = 0; i < n; i++) {
                var bk2 = remainingBank[i];
                var bl2 = leftoverBlanks[i];
                usedKeys[bk2.key] = true;
                items.push({
                    key: bk2.key, section: bk2.section, item_no: bk2.item_no, part: bk2.part,
                    page: bl2.page, box: bl2.box,
                    answer_text: bk2.answer_text, accepted_answers: bk2.accepted_answers,
                    _auto: true, _auto_method: 'position'
                });
            }

            items.sort(function (a, b) { return a.page - b.page || a.box.yPct - b.box.yPct || a.box.xPct - b.box.xPct; });

            return {
                items: items,
                unmatchedBank: bank.filter(function (b) { return !usedKeys[b.key]; }),
                extraBlanks: leftoverBlanks.slice(n),
                totalBlanks: blanks.length,
                totalBank: bank.length
            };
        });
    }

    // ------------------------------------------------------------------
    // 解答文字解析（老師貼原始格式，不用先手動整理成一行一題；解析結果一定要經過老師
    // 在畫面上確認/修正才會真正用於批改——見 docs 規劃：寬鬆解析＋人工確認是最後一道防線）
    // ------------------------------------------------------------------

    function isQuestionLike(s) {
        return /\?\s*$/.test(String(s || '').trim());
    }

    function normalizeSectionLabel(raw) {
        return String(raw || '').replace(/\s+/g, ' ').trim();
    }

    // Part\s+[A-Za-z0-9]+ 也接受「Part A」「Part B」這種字母大題（不只 Part 1/2/3），對應老師附圖那種
    // 「Part A：1~10 題（左右兩欄）」排版；用 \s+（要求至少一個空白）避免誤吃到 "Participants"／
    // "Partial" 之類單字（那些字緊接著小寫字母、沒有空白）。同一份 regex 供解答文字解析與 PDF
    // 標頭偵測共用。
    // 💣 2026-08-16：加入 Test\s*\d+（例如「TEST 1」「TEST 2」）——這種整份文件裡會出現「多次
    // 同名 Part A~F」的複習測驗（TEST 1 跟 TEST 2 底下都各有一組 Part A~F）。沒有 Test 這一層，
    // parseAnswerText／detectSectionPageRanges 會把兩份測驗同名的 Part 直接當成「同一個大題」
    // 合併在一起（見 _composeSectionLabel 說明），造成大題數量、頁碼、學生作答框全部對不起來。
    // Test(?:\s*\d+)?：解答／題目都有「TEST」（不一定帶數字）。後面只能是結尾、逗號／頁碼，不准吃到 Tested／TEST YOURSELF。
    var SECTION_HEADER_RE = /^(Quiz\s*\d+|Test(?:\s*\d+)?(?=\s*$|[,;:]|\s+p\.)|Chapter\s*\d+|Unit\s*\d+|Part\s+[A-Za-z0-9]+|Section\s*\d+|Lesson\s*\d+|第\s*[一二三四五六七八九十\d]+\s*[大課單元部分節])/i;
    // detectSectionPageRanges 專用：跟 SECTION_HEADER_RE 同一組關鍵字，但不要求一定要在整行最前面
    // （PDF 掃描頁上偶爾會有頁碼／裝飾文字混在同一行），避免因為位置沒對齊就整頁判定找不到標題。
    var SECTION_HEADER_ANYWHERE_RE = /(Quiz\s*\d+|Test(?:\s*\d+)?(?=\s*$|[,;:]|\s+p\.)|Chapter\s*\d+|Unit\s*\d+|Part\s+[A-Za-z0-9]+|Section\s*\d+|Lesson\s*\d+|第\s*[一二三四五六七八九十\d]+\s*[大課單元部分節])/i;
    // 用來判斷一個大題標題屬於哪個「家族」（quiz/test/part/…），供 _composeSectionLabel 判斷
    // 是否要把 Part 這一層跟目前的 Test 上下文組合起來（見下方說明）。
    var SECTION_FAMILY_OF_LABEL_RE = /^(quiz|test|chapter|unit|part|section|lesson)/i;
    function sectionFamily(rawLabel) {
        var m = String(rawLabel || '').match(SECTION_FAMILY_OF_LABEL_RE);
        return m ? m[1].toLowerCase() : null;
    }
    /**
     * 💣 「Part A」「Part B」…這種字母大題，在題庫課本裡常常是「附屬在某個 Test 底下」的子大題
     * （例如 TEST 1 跟 TEST 2 各自都有一組 Part A~F），同一個「Part D」字串在文件裡出現兩次，
     * 兩次代表的是完全不同的 10 題。若只用裸字串 "Part D" 當大題 key，會把兩份測驗的 Part D
     * 直接合併成同一大題（實測事故：24 個大題裡 6 個 Part 大題各混了兩份測驗的題目，位置序全部
     * 對不起來）。這裡在真正組出「大題 key」前，維護一個「目前是在哪個 Test 底下」的狀態
     * （testCtx，可為 null）：遇到 Test 家族的標頭，TEST／TEST 1 本身就是大題
     * （Azar：Quiz 1… 然後 TEST，底下直接 1. 2.）。後面若出現 Part，再組成「TEST 1 - Part D」。
     * 遇到其他家族（quiz/chapter/unit/section/lesson）一律清空 testCtx（那些不會附屬在 Test 底下）。
     * parseAnswerText（解答文字）跟 detectSectionPageRanges（掃 PDF 標題文字）兩處都要維持
     * 同一份 testCtx 狀態機、用同一個函式組 key，兩邊組出來的大題名才會一致、才能互相比對定位。
     * 禁止把 TEST 標頭略過、把底下題號收進前一個 Quiz，再在警示裡寫成「第 2 題」假裝那是大題。
     */
    function _composeSectionLabel(testCtx, rawLabel) {
        var family = sectionFamily(rawLabel);
        var normalized = normalizeSectionLabel(rawLabel);
        if (family === 'test') {
            return { testCtx: normalized, label: normalized, isTestHeader: true };
        }
        if (family === 'part' && testCtx) {
            return { testCtx: testCtx, label: testCtx + ' - ' + normalized, isTestHeader: false };
        }
        return { testCtx: null, label: normalized, isTestHeader: false };
    }
    // 💣 2026-08-16：實測掃描 PDF（ABBYY 產生的文字層）偶爾會把標題裡的數字 OCR 壞掉，例如
    // 「QUIZ 7」被讀成「QUIZ?」（問號取代 7，中間連空格都不見了）。此時 SECTION_HEADER_ANYWHERE_RE
    // 完全配不到「Quiz\s*\d+」，這個大題就會被判定「找不到標題」，退回沿用前一個大題的頁碼——
    // 結果 Quiz 6／Quiz 7 兩大題都顯示成 Quiz 5 那頁，往後 Quiz 8 又因為前面漂移而對齊到錯的頁。
    // 沒辦法從壞掉的符號還原出正確數字，但可以利用「大題一定依序出現」這個已知順序來補：
    // 抓出「關鍵字＋一段被 OCR 壞掉的短符號（不是字母也不是完整數字）」的候選行，記下頁碼；
    // 真的找不到某大題的精確數字比對時，才在「前一個已確定大題」跟「下一個已確定大題」的
    // 頁碼範圍內，找同一種關鍵字（quiz/chapter/…）的候選行來補這個大題，而不是照樣往前沿用。
    var SECTION_KEYWORD_FAMILY_RE = /^(quiz|test|chapter|unit|part|section|lesson)/i;
    var SECTION_HEADER_GARBLED_RE = /(Quiz|Test|Chapter|Unit|Part|Section|Lesson)\s*([0-9]+|[^\sA-Za-z0-9]{1,3})\s/i;
    // 更弱的一層候選：letter-spacing 太誇張時，標題數字有時會被 _groupLines 依 y 座標分到
    // 「下一行」去（例如「Q U I Z」跟「1 1」的 baseline 差一點點就被切成兩行），這一行本身
    // 完全沒有數字可比對，只有關鍵字。只在整行「開頭」比對（避免吃到頁尾 "58 CHAPTER 4" 之類
    // 每頁都有的裝飾文字，那種通常不會出現在整行最前面，而是在行尾或整行只有那幾個字）。
    var SECTION_HEADER_BARE_KEYWORD_RE = /^\s*(Quiz|Test|Chapter|Unit|Part|Section|Lesson)\b/i;

    /**
     * 💣 印刷排版常見的「大題標題」字體會加 letter-spacing（每個字母間都撐開一點距離），PDF 內部
     * 文字圖層對這種排版常常直接把每個字母存成獨立字串、字母間還真的塞了一個空白字元進去——例如
     * 實測 Azar 課本考卷裡「QUIZ 16」在文字圖層其實是兩個 token："Q U I Z"、"1 6"，字母/數字之間
     * 都各自帶一個空白。這種情況下 lineText 組出來會變成 "Q U I Z 1 6"，Quiz\s*\d+ 這種正規表達式
     * 完全配不到（regex 找的是連續的 QUIZ 四個字母，不是中間插了空白的 Q、U、I、Z）。
     * 這裡在比對大題標題前，先把「連續一串都只有單個字母/數字的 token」黏回去（"Q U I Z 1 6" -> "QUIZ16"），
     * 一般語句裡幾乎不會連續出現兩個以上的單字元詞（"I"、"a" 這種單字通常不會連續相鄰），所以這個
     * 黏合對其他內容影響很小，但能讓大題標題重新配對成功。
     */
    function _collapseLetterSpacedTokens(lineText) {
        var tokens = String(lineText || '').split(' ');
        var out = [];
        var buf = '';
        tokens.forEach(function (tok) {
            if (tok.length === 1 && /[A-Za-z0-9]/.test(tok)) {
                buf += tok;
            } else {
                if (buf) { out.push(buf); buf = ''; }
                if (tok) out.push(tok);
            }
        });
        if (buf) out.push(buf);
        return out.join(' ');
    }
    var ITEM_MARKER_RE = /(\d+)\.\s*/g;
    var AB_LINE_RE = /^([A-Za-z]):\s*(.*)$/;
    var OR_LEAD_RE = /^OR\b[\s:]*\s*(.*)$/i;
    // 💣 A/B 有兩層，不能一律當大題：
    // ① 練習分組（大題裡先 A 再 1~，後 B 再 1~）：「A.」「B. Directions」「A. 1. xxx」
    // ② 同一題底下的小題／對白（1 下面的 A/B）：「1. A: …」「B: …」或「A. 答案文字」
    var SUBSECTION_DOTTED_RE = /^([A-Z])\.\s*(.*)$/;
    var SUBSECTION_BARE_RE = /^([A-Z])$/;
    var SUBSECTION_SKIP_REST_RE = /^(directions|example|examples|exercise)\b/i;

    function _peelAbPart(text) {
        var raw = String(text || '').trim();
        var colon = raw.match(AB_LINE_RE);
        if (colon) return { part: colon[1].toUpperCase(), text: colon[2] };
        var dotted = raw.match(/^([A-Za-z])\.\s+(.*)$/);
        if (dotted && !SUBSECTION_SKIP_REST_RE.test(dotted[2]) && !/^\d+\.\s*/.test(dotted[2])) {
            return { part: dotted[1].toUpperCase(), text: dotted[2] };
        }
        return { part: null, text: raw };
    }

    /** 回傳 { kind:'group'|'part', letter, rest|text } 或 null */
    function _classifyAbLine(line, hasLastItem) {
        var s = String(line || '').trim();
        var colon = s.match(AB_LINE_RE);
        if (colon) {
            return hasLastItem
                ? { kind: 'part', letter: colon[1].toUpperCase(), text: colon[2] }
                : null;
        }
        var dotted = s.match(SUBSECTION_DOTTED_RE);
        if (dotted) {
            var letter = dotted[1].toUpperCase();
            var rest = String(dotted[2] || '').trim();
            if (!rest || SUBSECTION_SKIP_REST_RE.test(rest)) {
                return { kind: 'group', letter: letter, rest: '' };
            }
            if (/^\d+\.\s*/.test(rest)) {
                return { kind: 'group', letter: letter, rest: rest };
            }
            if (hasLastItem) return { kind: 'part', letter: letter, text: rest };
            return { kind: 'group', letter: letter, rest: rest };
        }
        var bare = s.match(SUBSECTION_BARE_RE);
        if (bare) return { kind: 'group', letter: bare[1].toUpperCase(), rest: '' };
        return null;
    }

    function stripTrailingOr(text) {
        var t = String(text || '').trim();
        var endsWithOr = /(?:^|\s)OR\s*$/i.test(t);
        return { text: endsWithOr ? t.replace(/(?:^|\s)OR\s*$/i, '').trim() : t, endsWithOr: endsWithOr };
    }

    function _nextPartLetter(part) {
        var ch = String(part || 'A').toUpperCase().charCodeAt(0);
        if (ch >= 65 && ch < 90) return String.fromCharCode(ch + 1);
        return 'B';
    }

    /**
     * 💣 Quiz 3：「2. Has Miriam … yet?」換行接「No, she hasn't …」＝同一題號底下的兩小題
     * （2-A 問句、2-B 答句），不是「一個答案 + 問句當其他可接受答案」。
     * 禁止再把問句 unshift／塞進 accepted_answers。
     */
    function _splitQuestionThenAnswer(text) {
        var raw = String(text || '').trim();
        var m = raw.match(/^(.*?[?？])\s+(.+)$/);
        if (!m) return null;
        var q = m[1].trim();
        var a = m[2].trim();
        if (!q || !a) return null;
        if (!isQuestionLike(q) || isQuestionLike(a)) return null;
        if (/^OR\b/i.test(a)) return null;
        return { question: q, answer: a };
    }

    function _normalizeAltSlashes(s) {
        return String(s || '').replace(/[\uFF0F\u2044\u2215]/g, '/');
    }

    function _hasLatinLetter(s) {
        return /[A-Za-z]/.test(String(s || ''));
    }

    function _keepSlashAsOneToken(left, right) {
        var L = String(left || '').trim();
        var R = String(right || '').trim();
        if (!L || !R) return true;
        if (/^and$/i.test(L) && /^or\b/i.test(R)) return true;
        if (/^\d+$/.test(L) && /^\d+/.test(R)) return true;
        if (!_hasLatinLetter(L) || !_hasLatinLetter(R)) return true;
        return false;
    }

    /**
     * 完整形／縮寫對上，一邊少了後面的字＝共用。
     * do not / don't call → do not call || don't call
     * is not / isn't studying → is not studying || isn't studying
     * 兩邊後面的字不一樣＝不是這把鑰匙，不准猜。
     */
    var CONTRACTION_PAIRS = [
        ['i am', "i'm"], ['i will', "i'll"], ['i have', "i've"], ['i had', "i'd"], ['i would', "i'd"],
        ['you are', "you're"], ['you will', "you'll"], ['you have', "you've"], ['you would', "you'd"],
        ['he is', "he's"], ['he will', "he'll"], ['he has', "he's"],
        ['she is', "she's"], ['she will', "she'll"], ['she has', "she's"],
        ['it is', "it's"], ['it will', "it'll"], ['it has', "it's"],
        ['we are', "we're"], ['we will', "we'll"], ['we have', "we've"], ['we would', "we'd"],
        ['they are', "they're"], ['they will', "they'll"], ['they have', "they've"], ['they would', "they'd"],
        ['that is', "that's"], ['there is', "there's"], ['what is', "what's"], ['who is', "who's"],
        ['let us', "let's"],
        ['is not', "isn't"], ['are not', "aren't"], ['was not', "wasn't"], ['were not', "weren't"],
        ['do not', "don't"], ['does not', "doesn't"], ['did not', "didn't"],
        ['have not', "haven't"], ['has not', "hasn't"], ['had not', "hadn't"],
        ['will not', "won't"], ['would not', "wouldn't"], ['can not', "can't"], ['cannot', "can't"],
        ['could not', "couldn't"], ['should not', "shouldn't"], ['must not', "mustn't"]
    ];

    function _normApos(s) {
        return String(s || '').replace(/[\u2018\u2019]/g, "'");
    }

    function _wordTokens(s) {
        return _normApos(s).trim().split(/\s+/).filter(Boolean);
    }

    function _tokenEq(a, b) {
        return _normApos(a).toLowerCase() === _normApos(b).toLowerCase();
    }

    function _matchPhrasePrefix(tokens, phrase) {
        var pt = _wordTokens(phrase);
        if (!pt.length || tokens.length < pt.length) return null;
        var i;
        for (i = 0; i < pt.length; i++) {
            if (!_tokenEq(tokens[i], pt[i])) return null;
        }
        return tokens.slice(pt.length);
    }

    function _shareContractionRemainder(left, right) {
        var L = _wordTokens(left);
        var R = _wordTokens(right);
        if (!L.length || !R.length) return null;
        var i;
        var t;
        for (i = 0; i < CONTRACTION_PAIRS.length; i++) {
            var tries = [
                { a: CONTRACTION_PAIRS[i][0], b: CONTRACTION_PAIRS[i][1] },
                { a: CONTRACTION_PAIRS[i][1], b: CONTRACTION_PAIRS[i][0] }
            ];
            for (t = 0; t < tries.length; t++) {
                var leftRest = _matchPhrasePrefix(L, tries[t].a);
                var rightRest = _matchPhrasePrefix(R, tries[t].b);
                if (!leftRest || !rightRest) continue;
                if (!leftRest.length && rightRest.length) {
                    return { left: String(left).trim() + ' ' + rightRest.join(' '), right: String(right).trim() };
                }
                if (!rightRest.length && leftRest.length) {
                    return { left: String(left).trim(), right: String(right).trim() + ' ' + leftRest.join(' ') };
                }
            }
        }
        return null;
    }

    function _shareAdjacentContractionParts(parts) {
        var out = (parts || []).map(function (p) { return String(p || '').trim(); }).filter(Boolean);
        var i;
        for (i = 0; i < out.length - 1; i++) {
            var shared = _shareContractionRemainder(out[i], out[i + 1]);
            if (shared) {
                out[i] = shared.left;
                out[i + 1] = shared.right;
            }
        }
        return out;
    }

    /**
     * `/` 切開：兩邊都有英文字＝其他可接受答案（does not/doesn't eat、does not / doesn't eat）。
     * 有這把鑰匙才拆。1/2、and/or、沒有英文字的片段不拆。
     * 切開後若是完整形／縮寫＋共用後面的字，把少的那邊補上（do not / don't call → do not call || don't call）。
     */
    function splitSlashParts(text) {
        var raw = _normalizeAltSlashes(text);
        if (raw.indexOf('/') === -1) return [raw];
        var segs = raw.split('/');
        var acc = segs[0];
        var pieces = [];
        var k;
        for (k = 1; k < segs.length; k++) {
            if (_keepSlashAsOneToken(acc, segs[k])) {
                acc = acc + '/' + segs[k];
            } else {
                pieces.push(acc);
                acc = segs[k];
            }
        }
        pieces.push(acc);
        return pieces.map(function (p) { return String(p || '').trim(); }).filter(Boolean);
    }

    /**
     * 其他可接受答案的分隔：or／OR／/／||。可多於一組。
     * 畫面編輯格用 || 接起來（／不易用）。
     * 禁止用逗號、分號、頓號去拆——英文句子裡本來就常有逗號（No, she hasn't）。
     */
    function splitAcceptedAnswerParts(text) {
        var raw = String(text || '').trim();
        if (!raw) return [];
        var parts = [];
        raw.split(/\s*\|\|\s*/).forEach(function (pipePart) {
            String(pipePart || '').split(/\s+\bOR\b\s+/i).forEach(function (orPart) {
                splitSlashParts(orPart).forEach(function (slashPart) {
                    var s = String(slashPart || '').trim();
                    if (s) parts.push(s);
                });
            });
        });
        return parts;
    }

    function applyAcceptedSplitsToItem(item) {
        if (!item) return item;
        var parts = splitAcceptedAnswerParts(item.answer_text);
        var extra = [];
        (item.accepted_answers || []).forEach(function (a) {
            splitAcceptedAnswerParts(a).forEach(function (p) { extra.push(p); });
        });
        var primary = (parts[0] != null && String(parts[0]).trim()) ? String(parts[0]).trim() : String(item.answer_text || '').trim();
        item.answer_text = primary;
        var seen = {};
        var out = [];
        parts.slice(1).concat(extra).forEach(function (p) {
            var k = String(p || '').trim();
            if (!k || k === primary || seen[k]) return;
            seen[k] = true;
            out.push(k);
        });
        var shared = _shareAdjacentContractionParts([primary].concat(out));
        item.answer_text = shared[0] || primary;
        seen = {};
        out = [];
        shared.slice(1).forEach(function (p) {
            var k = String(p || '').trim();
            if (!k || k === item.answer_text || seen[k]) return;
            seen[k] = true;
            out.push(k);
        });
        item.accepted_answers = out;
        return item;
    }

    function formatAcceptedAnswerList(list) {
        return (list || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(' || ');
    }

    function parseAcceptedAnswerList(text) {
        return splitAcceptedAnswerParts(text);
    }

    /**
     * 可行答案（accepted_answers）：解答裡的 or／OR、/（兩邊都有英文字）、以及 ||。
     * 沒有這些標記＝不是替代寫法。禁止把換行、問句、小題、逗號當成其他可接受答案。
     */
    function _splitOrAlternatives(text) {
        var raw = String(text || '').trim();
        if (!raw) return { primary: '', accepted: [] };
        var parts = _shareAdjacentContractionParts(splitAcceptedAnswerParts(raw));
        if (parts.length <= 1) return { primary: raw, accepted: [] };
        return { primary: parts[0], accepted: parts.slice(1) };
    }

    function _shouldBeNewPart(item, newText) {
        if (!item || item._pendingOr) return false;
        var existing = (item.fragments || []).filter(Boolean);
        if (!existing.length) return false;
        return existing.every(isQuestionLike) && !isQuestionLike(newText);
    }

    /**
     * 💣 逗號拆格：純文字分不出「依序多格」跟「答案本身含逗號」（例如 "No, she hasn’t…"）。
     * 自動決策只靠句首語氣詞／代詞這種高把握規則；空格線數量只拿來交叉檢查、紅字提醒老師，
     * 不再拿來偷偷改拆或不拆（2026-08-16 實測：Quiz 2 第1題 B 的空格線 hint 誤判成 1，
     * 若照 hint 降級會害後面整排錯位）。
     */
    function _looksLikeSentenceComma(pieces) {
        if (!pieces || pieces.length < 2) return false;
        var first = String(pieces[0] || '').trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
        if (/^(yes|no|yeah|yep|ok|okay|well|oh|sorry|please)$/.test(first)) return true;
        if (!/\s/.test(String(pieces[0] || '').trim()) && /^(she|he|i|they|we|it|the|you)\b/i.test(pieces[1] || '')) return true;
        return false;
    }

    function _splitFragmentIntoBlanks(text) {
        if (!text || text.indexOf(',') === -1) return { mode: 'single', pieces: [text] };
        var pieces = text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (pieces.length < 2) return { mode: 'single', pieces: [text] };
        if (_looksLikeSentenceComma(pieces)) return { mode: 'single', pieces: [text] };
        return { mode: 'sequential', pieces: pieces };
    }

    /**
     * 依「拆格判斷」結果，把一段（題號行或 A:/B: 行）的文字轉成 1 個或多個 item 物件。
     * `sequential` 模式會把逗號分段各自變成一個新 item（帶 blankIndex 1..N，各自成一格）。
     * 可行答案只從 OR 拆出，寫進 item.accepted；fragments 只留主答案。
     */
    function _makeAnswerItem(section, itemNo, part, group, blankIndex, text, endsWithOr) {
        var or = _splitOrAlternatives(text);
        return {
            section: section, itemNo: itemNo, part: part, group: group || null,
            blankIndex: blankIndex || null,
            fragments: [or.primary],
            accepted: or.accepted.slice(),
            _pendingOr: !!endsWithOr
        };
    }

    function _buildFragmentItems(section, itemNo, part, strippedFirst, group) {
        var qa = !part ? _splitQuestionThenAnswer(strippedFirst.text) : null;
        if (qa) {
            return _buildFragmentItems(section, itemNo, 'A', { text: qa.question, endsWithOr: false }, group)
                .concat(_buildFragmentItems(section, itemNo, 'B', { text: qa.answer, endsWithOr: strippedFirst.endsWithOr }, group));
        }
        var split = _splitFragmentIntoBlanks(strippedFirst.text);
        if (split.mode === 'sequential' && split.pieces.length > 1) {
            return split.pieces.map(function (piece, i) {
                var isLast = i === split.pieces.length - 1;
                return _makeAnswerItem(section, itemNo, part, group, i + 1, piece, isLast ? strippedFirst.endsWithOr : false);
            });
        }
        var text = (split.pieces.filter(Boolean)[0]) || strippedFirst.text || '';
        return [_makeAnswerItem(section, itemNo, part, group, null, text, strippedFirst.endsWithOr)];
    }

    function addContinuationFragment(item, rawText) {
        var stripped = stripTrailingOr(String(rawText || '').trim());
        var text = stripped.text;
        if (!item.accepted) item.accepted = [];
        if (!text) { item._pendingOr = item._pendingOr || stripped.endsWithOr; return; }
        var or = _splitOrAlternatives(text);
        if (item._pendingOr) {
            if (or.primary) item.accepted.push(or.primary);
            item.accepted = item.accepted.concat(or.accepted);
        } else {
            var cur = String(item.fragments[0] || '').trim();
            item.fragments[0] = cur ? (cur + ' ' + or.primary) : or.primary;
            item.accepted = item.accepted.concat(or.accepted);
        }
        item._pendingOr = stripped.endsWithOr;
    }

    // 老師貼的解答文字常見「Quiz 1, p. 50」這種課本印刷頁碼，跟考卷 PDF 頁尾印的頁碼是同一套
    // （課本自己的頁碼，不是 PDF 檔案的頁數）。用來輔助 detectSectionPageRanges 定位大題頁碼——
    // 跟掃 PDF 裡「QUIZ N」標題文字是兩個獨立的資訊來源，其中一個被 OCR 讀壞時另一個還能用。
    var SECTION_PAGE_HINT_RE = /pp?\.?\s*(\d{1,4})/i;

    /**
     * 寬鬆解析老師貼的解答原始文字，回傳扁平陣列：
     * [{ key, section, item_no, part, group, blank_index, answer_text, accepted_answers[] }]
     * key = "section::group::item_no::part::blankIndex"（group／part／blankIndex 可省略）
     *
     * 💣 同一大題裡常有 A 練習 1~n、接著 B 練習又從 1 開始（Azar：A. Directions… 然後 B. Directions…）。
     * 若只依題號數字排序，A 的 1 會跟 B 的 1 排在一起，答案順序就錯了。必須先依練習分組（A／B），
     * 組內再依題號排。group（練習分組 A／B）跟同一題底下的 A:／B:（part）不是同一層：
     * 有「Directions／後面接著 1.」才當練習分組；已經在某一題底下、後面是答案文字，就當該題小題。
     *
     * 回傳的陣列另外附掛一個 sectionPageHints 屬性（{ section -> 課本印刷頁碼 }），從「Quiz N, p. NN」
     * 這種標頭旁的頁碼擷取而來；呼叫端要自己在存檔時把它複製到 job.section_page_hints（陣列的額外
     * 屬性存進資料庫 JSONB 會被 JSON.stringify 丟掉，只有陣列本身的索引元素會留下）。
     */
    function parseAnswerText(raw) {
        var lines = String(raw || '').split(/\r?\n/);
        var items = [];
        var currentSection = '(未分類)';
        var testCtx = null; // 目前在哪個 Test 底下（見 _composeSectionLabel），非 Test/Part 大題時清空
        var currentGroup = null; // 大題內 A／B 練習分組
        var last = null;
        var sectionPageHints = {};

        function nextGroupLetter(letter) {
            var ch = String(letter || 'A').toUpperCase().charCodeAt(0);
            if (ch >= 65 && ch < 90) return String.fromCharCode(ch + 1);
            return 'B';
        }

        function advanceGroupOnNumberRestart(itemNo) {
            var n = parseInt(itemNo, 10);
            if (n !== 1) return;
            var prevN = -1;
            for (var i = items.length - 1; i >= 0; i--) {
                if (items[i].section !== currentSection) continue;
                if ((items[i].group || '') !== (currentGroup || '')) continue;
                prevN = parseInt(items[i].itemNo, 10);
                break;
            }
            if (isNaN(prevN) || prevN <= 1) return;
            if (!currentGroup) {
                items.forEach(function (it) {
                    if (it.section === currentSection && !it.group) it.group = 'A';
                });
                currentGroup = 'B';
            } else {
                currentGroup = nextGroupLetter(currentGroup);
            }
        }

        function leftoverAfterHeader(fullLine, secMatch, hintSection) {
            var rest = fullLine.slice(secMatch[0].length);
            var pageHintMatch = rest.match(SECTION_PAGE_HINT_RE);
            if (pageHintMatch) {
                var idx = rest.search(SECTION_PAGE_HINT_RE);
                if (idx >= 0 && idx <= 4) {
                    if (hintSection && sectionPageHints[hintSection] == null) {
                        var printedPage = parseInt(pageHintMatch[1], 10);
                        if (!isNaN(printedPage)) sectionPageHints[hintSection] = printedPage;
                    }
                    rest = rest.slice(idx + pageHintMatch[0].length);
                }
            }
            return rest.replace(/^[\s,;:\-–]+/, '').trim();
        }

        function ingestUnnumbered(text) {
            text = String(text || '').trim();
            if (!text) return;
            var orOnly = text.match(OR_LEAD_RE);
            if (orOnly && last) {
                var orRest = stripTrailingOr(orOnly[1].trim());
                var orAlt = _splitOrAlternatives(orRest.text);
                if (!last.accepted) last.accepted = [];
                if (orAlt.primary) last.accepted.push(orAlt.primary);
                last.accepted = last.accepted.concat(orAlt.accepted);
                last._pendingOr = orRest.endsWithOr;
                return;
            }
            // 沒有「1.」題號＝這一組依出現順序的下一題。禁止因為沒題號／不知怎麼處理就丟掉。
            if (!last || last._fromBareLine) {
                var nextBareNo = 1;
                var jb;
                for (jb = items.length - 1; jb >= 0; jb--) {
                    if (items[jb].section !== currentSection) continue;
                    if ((items[jb].group || '') !== (currentGroup || '')) continue;
                    var prevBare = parseInt(items[jb].itemNo, 10);
                    if (!isNaN(prevBare)) nextBareNo = prevBare + 1;
                    break;
                }
                var strippedBare = stripTrailingOr(text);
                var bareItems = _buildFragmentItems(currentSection, String(nextBareNo), null, strippedBare, currentGroup);
                bareItems.forEach(function (it) {
                    it._fromBareLine = true;
                    items.push(it);
                    last = it;
                });
                return;
            }
            var cont = stripTrailingOr(text);
            if (_shouldBeNewPart(last, cont.text)) {
                if (!last.part) last.part = 'A';
                var nextPart = _nextPartLetter(last.part);
                var partItems = _buildFragmentItems(last.section, last.itemNo, nextPart, cont, last.group || currentGroup);
                partItems.forEach(function (it) { items.push(it); last = it; });
                return;
            }
            addContinuationFragment(last, text);
        }

        lines.forEach(function (rawLine) {
            var line = rawLine.trim();
            if (!line) return;

            // 同一行可能是「Quiz 1, p. 1 Quiz 2, p. 2」或標頭後面直接接答案。
            // 吃掉標頭之後，剩下的字一律繼續當答案／下一個標頭，不准 return 丟掉。
            while (line) {
                var secMatch = line.match(SECTION_HEADER_RE);
                if (!secMatch || /^\d+\./.test(line)) break;
                var composed = _composeSectionLabel(testCtx, secMatch[1]);
                testCtx = composed.testCtx;
                last = null;
                var fam = sectionFamily(secMatch[1]);
                if (fam === 'quiz' || fam === 'chapter' || fam === 'unit' || fam === 'lesson') {
                    currentGroup = null;
                }
                if (fam === 'part') {
                    var partToken = String(secMatch[1] || '').match(/part\s+([A-Za-z0-9]+)/i);
                    if (partToken && /^quiz\s*\d+/i.test(currentSection)) {
                        currentGroup = String(partToken[1]).toUpperCase();
                        line = leftoverAfterHeader(line, secMatch, null);
                        continue;
                    }
                }
                if (composed.isTestHeader) {
                    currentSection = composed.label || composed.testCtx;
                    currentGroup = null;
                    line = leftoverAfterHeader(line, secMatch, currentSection);
                    continue;
                }
                currentSection = composed.label;
                currentGroup = null;
                line = leftoverAfterHeader(line, secMatch, currentSection);
            }
            if (!line) return;

            var abClass = _classifyAbLine(line, !!last);
            if (abClass && !/^\d+\./.test(line)) {
                if (abClass.kind === 'group') {
                    currentGroup = abClass.letter;
                    last = null;
                    if (!abClass.rest) return;
                    line = abClass.rest;
                } else if (abClass.kind === 'part' && last) {
                    var strippedAb = stripTrailingOr(String(abClass.text || '').trim());
                    var newItems2 = _buildFragmentItems(last.section, last.itemNo, abClass.letter, strippedAb, last.group || currentGroup);
                    newItems2.forEach(function (it) { items.push(it); last = it; });
                    return;
                }
            }

            if (/^(directions|example|examples)\s*:?\s*$/i.test(line)) return;
            var dirLead = line.match(/^(directions|example|examples)\s*:\s*(.+)$/i);
            if (dirLead) line = String(dirLead[2] || '').trim();
            if (!line) return;

            ITEM_MARKER_RE.lastIndex = 0;
            var matches = [];
            var m;
            while ((m = ITEM_MARKER_RE.exec(line))) {
                matches.push({ no: m[1], start: m.index, textStart: m.index + m[0].length });
            }

            if (matches.length) {
                var prefix = line.slice(0, matches[0].start).trim();
                if (prefix) ingestUnnumbered(prefix);
                advanceGroupOnNumberRestart(matches[0].no);
                var i;
                for (i = 0; i < matches.length; i++) {
                    var seg = matches[i];
                    var endIdx = (i + 1 < matches.length) ? matches[i + 1].start : line.length;
                    var text = line.slice(seg.textStart, endIdx).trim();
                    var peeled = _peelAbPart(text);
                    var part = peeled.part;
                    text = peeled.text;
                    var strippedFirst = stripTrailingOr(text);
                    var newItems = _buildFragmentItems(currentSection, seg.no, part, strippedFirst, currentGroup);
                    newItems.forEach(function (it) { items.push(it); last = it; });
                }
                return;
            }

            ingestUnnumbered(line);
        });

        var columnReattach = reattachColumnContinuations(items);

        var flat = items.map(function (it) {
            var primary = (it.fragments && it.fragments[0]) || '';
            var accepted = (it.accepted || []).filter(function (f) { return f && f !== primary; });
            return {
                key: makeKey(it.section, it.itemNo, it.part, it.blankIndex, it.group),
                section: it.section,
                item_no: it.itemNo,
                part: it.part,
                group: it.group || null,
                blank_index: it.blankIndex || null,
                answer_text: primary,
                accepted_answers: accepted
            };
        });

        // 💣 老師/OCR 常把答案「一行擠兩題」抄寫（例如 "2. been 10. stopped"），純粹是為了省紙／
        // 省空間，不代表考卷本身的版面順序——考卷通常還是單欄由上到下 1,2,3...N。若照文字出現
        // 順序直接拿去跟考卷上偵測到的空格做「位置保險配對」，會整批對錯（空格#2 對到「第10題」的
        // 答案）。排序必須是：大題 → 練習分組 A/B（不是只看數字）→ 組內題號 → 對白 A:/B: → 拆格。
        var sectionOrder = [];
        var groupOrderBySection = {};
        flat.forEach(function (it) {
            if (sectionOrder.indexOf(it.section) === -1) sectionOrder.push(it.section);
            if (!groupOrderBySection[it.section]) groupOrderBySection[it.section] = [];
            var g = it.group || '';
            if (groupOrderBySection[it.section].indexOf(g) === -1) groupOrderBySection[it.section].push(g);
        });
        flat.sort(function (a, b) {
            var sa = sectionOrder.indexOf(a.section), sb = sectionOrder.indexOf(b.section);
            if (sa !== sb) return sa - sb;
            var ga = groupOrderBySection[a.section].indexOf(a.group || '');
            var gb = groupOrderBySection[b.section].indexOf(b.group || '');
            if (ga !== gb) return ga - gb;
            var na = parseInt(a.item_no, 10), nb = parseInt(b.item_no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            if (a.item_no !== b.item_no) return String(a.item_no).localeCompare(String(b.item_no));
            var pa = String(a.part || ''), pb = String(b.part || '');
            if (pa !== pb) return pa.localeCompare(pb);
            return (a.blank_index || 0) - (b.blank_index || 0);
        });
        flat.sectionPageHints = sectionPageHints;
        flat.column_reattach = columnReattach;
        return flat;
    }

    /**
     * 把「舊版混合式拆格」存進資料庫的清單，對照目前的 parseAnswerText 結果補拆。
     * 實測事故：Quiz 2 第1題 B: "haven't, have never done" 被舊邏輯收成單列
     * （answer_text=haven't、accepted_answers=["have never done"]），後面每一格作答框全部錯位。
     * 老師只要打開編輯器或按重新批改，就會用原始解答文字重跑，把缺的 ::1 / ::2 列補回來。
     * 回傳 true＝清單有變，呼叫端應標記 needs_regrade。
     */
    function repairStaleCommaSplits(job) {
        if (!job || typeof job.answer_text_raw !== 'string' || !job.answer_text_raw.trim()) return false;
        var fresh = parseAnswerText(job.answer_text_raw);
        if (!fresh.length) return false;
        var prev = Array.isArray(job.parsed_bank) ? job.parsed_bank : [];
        var next = mergeParsedBankKeepingOrder(prev, fresh);
        var sig = function (bank) {
            return (bank || []).map(function (b) {
                return [b.key, b.answer_text || '', (b.accepted_answers || []).join('|')].join('\t');
            }).join('\n');
        };
        if (sig(next) === sig(prev)) return false;
        job.parsed_bank = next;
        if (fresh.sectionPageHints) {
            job.section_page_hints = Object.assign({}, job.section_page_hints || {}, fresh.sectionPageHints);
        }
        return true;
    }

    function makeKey(section, itemNo, part, blankIndex, group) {
        var g = group ? (String(group).toUpperCase() + '::') : '';
        return String(section || '') + '::' + g + String(itemNo || '') + (part ? ('::' + part) : '') + (blankIndex ? ('::' + blankIndex) : '');
    }

    function applyItemNoToBankRow(bank, idx, newNo) {
        var row = bank && bank[idx];
        if (!row) return row;
        var no = String(newNo || '').trim();
        if (!no) return row;
        var before = {
            section: row.section,
            item_no: row.item_no,
            part: row.part,
            group: row.group
        };
        row.item_no = no;
        row._manual = true;
        row._manuallyEdited = true;
        numberItemBlanks(bank, before);
        numberItemBlanks(bank, row);
        return row;
    }

    function sameItemBlankFamily(a, b) {
        return !!(a && b
            && String(a.section || '') === String(b.section || '')
            && String(a.item_no || '') === String(b.item_no || '')
            && String(a.part || '') === String(b.part || '')
            && String(a.group || '') === String(b.group || ''));
    }

    function retargetBankRowKey(row) {
        if (!row) return row;
        row.key = makeKey(row.section, row.item_no, row.part, row.blank_index, row.group);
        return row;
    }

    /** 同一題號的各格依畫面順序編成 1、2、3…；只剩一格就不標格號。只編相鄰的那一串，底下另有一個 2 不算同一題的第 2 格。 */
    function numberItemBlanks(bank, template) {
        if (!template || !bank || !bank.length) return;
        var idx = -1;
        var i;
        for (i = 0; i < bank.length; i++) {
            if (bank[i] === template) { idx = i; break; }
        }
        if (idx < 0) {
            for (i = 0; i < bank.length; i++) {
                if (sameItemBlankFamily(bank[i], template)) { idx = i; break; }
            }
        }
        if (idx < 0) return;
        var start = idx;
        var end = idx;
        while (start > 0 && sameItemBlankFamily(bank[start - 1], bank[idx])) start--;
        while (end < bank.length - 1 && sameItemBlankFamily(bank[end + 1], bank[idx])) end++;
        var n = end - start + 1;
        var j;
        for (j = start; j <= end; j++) {
            bank[j].blank_index = n <= 1 ? null : (j - start + 1);
            retargetBankRowKey(bank[j]);
        }
    }

    function normalizeAllItemBlanks(bank) {
        var i = 0;
        while (i < (bank || []).length) {
            numberItemBlanks(bank, bank[i]);
            var end = i;
            while (end < bank.length - 1 && sameItemBlankFamily(bank[end + 1], bank[i])) end++;
            i = end + 1;
        }
        return bank;
    }

    /**
     * ＋上／＋下＝同一題號加一格。原列與新列編成 2-1、2-2。
     * 不是新題號，也不是 2-A／2-B 小題。
     */
    function insertBlankRow(bank, idx, after) {
        bank = bank || [];
        var template = bank[idx];
        if (!template) return { insertAt: -1, row: null };
        var insertAt = Number(idx) + (after ? 1 : 0);
        var row = {
            key: '',
            section: template.section || '(未分類)',
            item_no: String(template.item_no || '').trim() || '?',
            part: template.part || null,
            group: template.group || null,
            blank_index: null,
            answer_text: '',
            accepted_answers: [],
            _manual: true
        };
        bank.splice(insertAt, 0, row);
        numberItemBlanks(bank, row);
        return { insertAt: insertAt, row: row };
    }

    /**
     * 手動新增一題＝這份 PDF 答案清單裡的一列（你填的大題＋題號）。
     * 加在該大題現有列的最後面。不是＋下那種同一題加一格，也不是整份清單最底。
     * 這個大題還沒有列＝接到整份清單最後（新大題）。
     */
    function insertManualBankRow(bank, row) {
        bank = bank || [];
        row = row || {};
        var sec = row.section || '(未分類)';
        var last = -1;
        var i;
        for (i = 0; i < bank.length; i++) {
            if ((bank[i].section || '(未分類)') === sec) last = i;
        }
        var insertAt = last >= 0 ? last + 1 : bank.length;
        if (!row.key) {
            row.key = makeKey(row.section, row.item_no, row.part);
        }
        bank.splice(insertAt, 0, row);
        return { insertAt: insertAt, row: row };
    }

    function openAddManualBankRowModal(opts) {
        opts = opts || {};
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return;
        var getBank = typeof opts.getBank === 'function' ? opts.getBank : function () { return []; };
        var onCommit = opts.onCommit;
        var dirty = false;
        var modalId = 'pdf-exam-add-manual-row';
        window.ModalOverlay.open({
            id: modalId,
            tier: 'B',
            prompt: true,
            isDirty: function () { return dirty; },
            contentHtml: '<div style="background:white; padding:20px; border-radius:10px; min-width:420px; max-width:560px;">'
                + '<div style="font-weight:800; color:#0F766E; margin-bottom:6px;">手動新增一題</div>'
                + '<p style="font-size:0.82rem; color:#64748B; margin:0 0 10px 0; line-height:1.45;">加在這份 PDF 答案清單裡、你填的那個大題的最後面。不是＋下那種同一題加一格。</p>'
                + '<label style="display:block; font-weight:700; font-size:0.82rem; margin-bottom:8px;">大題（例如 Quiz 1；留空＝未分類）'
                + '<input id="pdf-exam-add-sec" type="text" style="width:100%; margin-top:4px; padding:6px; box-sizing:border-box;"></label>'
                + '<label style="display:block; font-weight:700; font-size:0.82rem; margin-bottom:8px;">題號（例如 12）'
                + '<input id="pdf-exam-add-no" type="text" style="width:100%; margin-top:4px; padding:6px; box-sizing:border-box;"></label>'
                + '<label style="display:block; font-weight:700; font-size:0.82rem; margin-bottom:8px;">子項（若這題有 A/B 兩格才填，否則留空）'
                + '<input id="pdf-exam-add-part" type="text" style="width:100%; margin-top:4px; padding:6px; box-sizing:border-box;"></label>'
                + '<div style="margin-top:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">'
                + '<button type="button" class="btn btn-primary" id="pdf-exam-add-ok" style="background:#0F766E; color:white; border:1px solid #0F766E; font-weight:800;">新增</button>'
                + '<button type="button" class="btn" id="pdf-exam-add-cancel" style="background:white; color:#134E4A; border:1px solid #CBD5E1; font-weight:800;">取消</button>'
                + '<span id="pdf-exam-add-err" style="font-weight:700; color:#B91C1C;"></span>'
                + '</div></div>',
            onMount: function (overlay) {
                overlay.querySelectorAll('input').forEach(function (inp) {
                    inp.addEventListener('input', function () { dirty = true; });
                });
                overlay.querySelector('#pdf-exam-add-cancel').addEventListener('click', function () {
                    window.ModalOverlay.requestClose(modalId);
                });
                overlay.querySelector('#pdf-exam-add-ok').addEventListener('click', function () {
                    var section = String((overlay.querySelector('#pdf-exam-add-sec') || {}).value || '(未分類)').replace(/\s+/g, ' ').trim() || '(未分類)';
                    var itemNo = String((overlay.querySelector('#pdf-exam-add-no') || {}).value || '').trim();
                    var err = overlay.querySelector('#pdf-exam-add-err');
                    if (!itemNo) {
                        if (err) err.textContent = '請填題號';
                        return;
                    }
                    var part = String((overlay.querySelector('#pdf-exam-add-part') || {}).value || '').trim().toUpperCase() || null;
                    var bank = getBank() || [];
                    var key = makeKey(section, itemNo, part);
                    if (bank.some(function (b) { return b.key === key; })) {
                        if (err) err.textContent = '這個題號已經存在，請改用清單裡的欄位直接修改';
                        return;
                    }
                    var row = {
                        key: key,
                        section: section,
                        item_no: itemNo,
                        part: part,
                        answer_text: '',
                        accepted_answers: [],
                        _manual: true
                    };
                    var ins = insertManualBankRow(bank, row);
                    dirty = false;
                    window.ModalOverlay.close(modalId);
                    if (typeof onCommit === 'function') onCommit(ins);
                });
            }
        });
    }

    /**
     * 再解析時維持畫面上的列順序。手動加的列留在原位，不准接到最後。
     * 第一次解析（清單還是空的）才用解析器排出來的順序。
     */
    function mergeParsedBankKeepingOrder(prev, fresh) {
        prev = prev || [];
        fresh = fresh || [];
        if (!prev.length) return fresh.slice();
        var freshByKey = {};
        fresh.forEach(function (b) { if (b && b.key) freshByKey[b.key] = b; });
        var used = {};
        var out = [];
        prev.forEach(function (old) {
            if (!old) return;
            var hit = old.key ? freshByKey[old.key] : null;
            if (hit) {
                used[old.key] = true;
                if (old._manuallyEdited) {
                    var kept = {
                        key: hit.key,
                        section: hit.section,
                        item_no: hit.item_no,
                        part: hit.part,
                        group: hit.group,
                        blank_index: hit.blank_index,
                        answer_text: old.answer_text,
                        accepted_answers: old.accepted_answers,
                        _manuallyEdited: true,
                        _manual: old._manual || false
                    };
                    applyAcceptedSplitsToItem(kept);
                    out.push(kept);
                } else {
                    out.push(hit);
                }
                return;
            }
            if (old._manual) {
                if (freshByKey[String(old.key) + '::1']) return;
                out.push(old);
                return;
            }
            var prefix = String(old.key || '') + '::';
            fresh.forEach(function (b) {
                if (b && b.key && !used[b.key] && b.key.indexOf(prefix) === 0) {
                    used[b.key] = true;
                    out.push(b);
                }
            });
        });
        fresh.forEach(function (b) {
            if (!b || !b.key || used[b.key]) return;
            var already = out.some(function (x) { return sameItemBlankFamily(x, b); });
            if (already) {
                used[b.key] = true;
                return;
            }
            out.push(b);
            used[b.key] = true;
        });
        normalizeAllItemBlanks(out);
        return out;
    }

    function itemLabel(it) {
        return String((it && it.section) || '')
            + (it && it.group ? (' ' + String(it.group)) : '')
            + ' 第' + String((it && it.item_no) || '') + '題' + ((it && it.part) ? ('-' + it.part) : '')
            + ((it && it.blank_index) ? ('（第' + it.blank_index + '格）') : '');
    }

    /** 供批改重用：把 pdf_exam_job.parsed_bank[]（老師確認過的答案清單）轉成
     * QuizPaperBuilder.gradeAnswers 看得懂的 paper 結構。改版後定位由學生自己點，
     * 不再需要老師畫框的 items[]，批改只看答案清單本身。 */
    function buildGradingPaper(job) {
        var list = (job && Array.isArray(job.parsed_bank)) ? job.parsed_bank : [];
        return {
            items: list.map(function (it, idx) {
                return {
                    item_id: it.key || makeKey(it.section, it.item_no, it.part, it.blank_index, it.group),
                    seq: idx,
                    answer_en: it.answer_text || '',
                    accepted_answers: Array.isArray(it.accepted_answers) ? it.accepted_answers : [],
                    prompt_zh: itemLabel(it)
                };
            })
        };
    }

    /** 依 section 分組（保留第一次出現的順序），供學生端「一畫面一大題」使用 */
    function groupItemsBySection(items) {
        var order = [];
        var map = {};
        (items || []).forEach(function (it) {
            var sec = it.section || '(未分類)';
            if (!map[sec]) { map[sec] = []; order.push(sec); }
            map[sec].push(it);
        });
        return order.map(function (sec) { return { section: sec, items: map[sec] }; });
    }

    /**
     * 把「這一大題」的作答框（依建立順序）跟「這一大題」的答案清單（已依題號排好序）一一對齊，
     * 組成 { bankKey: 學生輸入文字 } 給 QuizPaperBuilder.gradeAnswers。順序才是配對依據，座標只是
     * 畫面參考用。框數跟題數不一定相等（程式判斷格數可能算錯，或學生自己點的數量不同）——用
     * Math.min 截斷，多出來的框先忽略（原始內容還在 pdf_quiz_boxes_by_section 不會不見）、
     * 少掉的格視為沒作答。學生第一次送出、老師之後重新批改都呼叫這個共用函式，不要各寫一份。
     */
    function buildSectionAnswersFromBoxes(sectionItems, boxes) {
        var answers = {};
        var items = sectionItems || [];
        var list = boxes || [];
        var n = Math.min(list.length, items.length);
        for (var i = 0; i < n; i++) answers[items[i].key] = list[i].text || '';
        return answers;
    }

    /**
     * 把整份 pdf_quiz_boxes_by_section（學生原始作答框，永久保留、不管答案清單後來怎麼改都還在）
     * 依「目前」的答案清單（bank）重新配對成完整的 { key: 文字 }。特別重要的是：**不要**去讀舊的
     * `pdf_quiz_answers`（那是繳交當時、用舊答案清單 key 存下來的），因為老師後來修正答案清單
     * （拆格／合併／增刪）會讓 key 變掉，舊表就對不到新 key、把學生填過的內容判定成沒作答。
     * 這個函式永遠用「現在」的 bank 分組 + 學生原始作答框位置重新配對，才不會因為答案清單改版
     * 而遺失已經填過的內容——老師重新批改一定要走這裡，不能直接吃 pdf_quiz_answers。
     */
    function buildAnswersFromBoxesBySection(bank, boxesBySection) {
        var sections = groupItemsBySection(bank);
        var list = boxesBySection || [];
        var answers = {};
        sections.forEach(function (sec, idx) {
            Object.assign(answers, buildSectionAnswersFromBoxes(sec.items, list[idx] || []));
        });
        return answers;
    }

    /**
     * 依大題把 QuizPaperBuilder.gradeAnswers 的批改結果重新分組：這大題錯了哪幾格（key）、
     * 錯幾格，並用「這大題對的格數 / 這大題總格數」算出這一大題自己的百分比分數
     * （不是拿全卷分數硬套在每個大題上）。學生繳交、老師重新批改都共用這份邏輯，避免兩邊算法兜不起來。
     */
    function computeSectionStats(bank, gradeResult) {
        var detailByKey = {};
        ((gradeResult && gradeResult.details) || []).forEach(function (d) { detailByKey[d.item_id] = d; });
        var sections = groupItemsBySection(bank);
        return sections.map(function (sec) {
            var total = sec.items.length;
            var wrongKeys = [];
            sec.items.forEach(function (it) {
                var d = detailByKey[it.key];
                if (!d || !d.ok) wrongKeys.push(it.key);
            });
            var correct = total - wrongKeys.length;
            return {
                section: sec.section,
                total: total,
                correct: correct,
                wrong_count: wrongKeys.length,
                wrong_keys: wrongKeys,
                score: total ? Math.round((correct / total) * 1000) / 10 : 0
            };
        });
    }

    /**
     * 💣 老師不用畫框、也不用手動指定「這大題在第幾頁」——大題標題（QUIZ 1／Chapter 4…）字體大、
     * 印刷清楚，OCR 幾乎都讀得對（不像小題號或底線那麼容易被掃描雜訊搞爛），所以改成程式自動
     * 掃過整份 PDF 的文字圖層，找每個大題標題第一次出現在第幾頁，完全不用人工介入。
     *
     * 找不到某個大題的標題（例如那頁 OCR 剛好把標題讀壞了）時，不會整個放棄——退回「沿用前一個
     * 已定位大題的頁碼」，讓學生至少能看到「差不多在那附近」的頁面，而不是完全没東西可看。
     *
     * `sectionPageHints`（可選）＝ parseAnswerText() 附掛的 { section -> 課本印刷頁碼 }（從「Quiz 1,
     * p. 50」這種標頭旁的頁碼擷取）。跟掃 PDF 裡「QUIZ N」標題文字是兩個獨立來源：課本印刷頁碼會
     * 印在每頁頁尾（例如「50 CHAPTER 4」），只要抓到幾頁頁尾的印刷頁碼、算出跟 PDF 頁碼的固定
     * 落差（offset），就能把「p. 50」直接換算成 PDF 頁碼，不需要再靠容易被 OCR 讀壞的大題標題文字。
     *
     * 回傳：[{ section, startPage, endPage }, ...]（依 bank 裡大題第一次出現的順序）
     */
    function detectSectionPageRanges(pdfDoc, bank, sectionPageHints) {
        var sectionOrder = [];
        (bank || []).forEach(function (it) {
            var sec = it.section || '(未分類)';
            if (sectionOrder.indexOf(sec) === -1) sectionOrder.push(sec);
        });
        if (!sectionOrder.length) return Promise.resolve([]);

        var numPages = pdfDoc.numPages;
        var pageNums = [];
        for (var p = 1; p <= numPages; p++) pageNums.push(p);

        function normFuzzy(s) {
            return String(s || '').replace(/\s+/g, '').toLowerCase();
        }
        var fuzzyTargets = sectionOrder.map(normFuzzy);

        var foundPage = {}; // section -> 第一次出現的頁碼
        var foundYPct = {}; // section -> 該頁標題列的 yPct（頂端=0）；同一頁上下兩大題必須靠這個捲到下面那題
        var allHeaders = []; // { label, pageNum, yPct } 精確比對到的標題，給只有頁碼沒有 y 的補位用
        var looseCandidates = []; // { family, pageNum, yPct } - 關鍵字配到但數字被 OCR 壞掉的候選行
        var bareCandidates = []; // { family, pageNum, yPct } - 只比對到行首關鍵字，連數字都配不到（更弱，最後才用）
        var footerOffsetVotes = {}; // offset(印刷頁碼-PDF頁碼) -> 出現次數，用來推算全篇一致的落差
        var pdfTestCtx = null; // 掃 PDF 時目前在哪個 Test 底下（跟 parseAnswerText 的 testCtx 同一套邏輯，見 _composeSectionLabel）
        return pageNums.reduce(function (chain, pageNum) {
            return chain.then(function () {
                return pdfDoc.getPage(pageNum).then(function (page) {
                    // 💣 之前這裡自己另外兜了一份「依 y 分行」的邏輯，但只是照 tc.items 原始順序
                    // （content stream 順序，不一定是視覺上的左到右）直接 join 文字，沒有像
                    // _groupLines 那樣依 x 座標排序——如果大題標題那一行裡，其他文字（例如頁碼、
                    // 版面裝飾）在 content stream 裡排在標題文字「之前」，join 出來的字串就會變成
                    // 「別的字 QUIZ 5 ...」，標題不在字串最前面，SECTION_HEADER_RE 的 ^ 就配不到，
                    // 這一頁就會被判定「找不到標題」，害這個大題（甚至連帶後面幾個大題）誤套用
                    // 前一個大題的頁碼。改成跟 _detectLabeledBlanks 共用同一套「先算座標、再依 x
                    // 排序」的 _pageItemsPct/_groupLines，兩處分行邏輯只維護一份，不會各自漂移。
                    return _pageItemsPct(page).then(function (items) {
                        var lines = _groupLines(items);
                        // 課本印刷頁碼通常印在頁尾（最靠下的那一兩行），跟其他文字混在一起
                        // （例如「50 CHAPTER 4」「Present Perfect and Past Perfect 51」），
                        // 找裡面「單獨一個 1~4 位數字」的 token 當候選印刷頁碼。
                        for (var li = lines.length - 1; li >= 0 && li >= lines.length - 2; li--) {
                            lines[li].items.forEach(function (it) {
                                var tok = String(it.str || '').trim();
                                if (/^\d{1,4}$/.test(tok)) {
                                    var printedNum = parseInt(tok, 10);
                                    var offset = printedNum - pageNum;
                                    footerOffsetVotes[offset] = (footerOffsetVotes[offset] || 0) + 1;
                                }
                            });
                        }
                        lines.forEach(function (line) {
                            var lineText = line.items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim();
                            var collapsed = _collapseLetterSpacedTokens(lineText);
                            // 標題通常是整行最前面的文字，但保險起見不要求一定要在字串最開頭：
                            // 只要這一行「有出現」大題標題就算數，不用 ^ 錯位就整頁判定找不到。
                            // 比對前先復原 letter-spacing（見 _collapseLetterSpacedTokens 說明），
                            // 否則「Q U I Z 1 6」這種標題永遠配不到 Quiz\s*\d+。
                            var secMatch = collapsed.match(SECTION_HEADER_ANYWHERE_RE);
                            var candidate = secMatch ? normalizeSectionLabel(secMatch[1]) : null;
                            if (candidate) allHeaders.push({ label: candidate, pageNum: pageNum, yPct: line.yPct });
                            sectionOrder.forEach(function (sec, idx) {
                                if (foundPage[sec] != null) return; // 只記第一次出現
                                if (candidate && normFuzzy(candidate) === fuzzyTargets[idx]) {
                                    foundPage[sec] = pageNum;
                                    foundYPct[sec] = line.yPct;
                                }
                            });
                            // 數字被 OCR 壞掉（例如「QUIZ 7」變成「QUIZ?」）時上面精確比對永遠配不到，
                            // 先把「關鍵字家族＋頁碼」記下來，等全部頁面掃完、確定哪些大題真的還沒找到
                            // 之後，再用大題一定依序出現的順序去比對這些候選行（見迴圈外的補位邏輯）。
                            // 💣 只有在 secMatch（精確、真的比對到數字）失敗時才收集候選——
                            // SECTION_HEADER_GARBLED_RE 的 [0-9]+ 分支本來就會連正常「QUIZ 5」也配到，
                            // 若不排除已經精確比對成功的行，候選清單會混進一堆「其實已經解決」的頁碼，
                            // 補位時反而搶走真正缺的那個大題該用的候選（實測 Quiz 7 就是這樣被 Quiz 5
                            // 那筆候選頂替掉，補到錯的頁）。
                            if (!secMatch) {
                                var garbledMatch = collapsed.match(SECTION_HEADER_GARBLED_RE);
                                if (garbledMatch) {
                                    var famMatch = garbledMatch[1].match(SECTION_KEYWORD_FAMILY_RE);
                                    if (famMatch) looseCandidates.push({ family: famMatch[1].toLowerCase(), pageNum: pageNum, yPct: line.yPct });
                                } else {
                                    // 連「關鍵字＋壞掉的短符號」都配不到，才退而比對「行首只有關鍵字」——
                                    // 標題數字可能被分到別的視覺行去了，這一行只剩關鍵字本身。
                                    var bareMatch = collapsed.match(SECTION_HEADER_BARE_KEYWORD_RE);
                                    if (bareMatch) bareCandidates.push({ family: bareMatch[1].toLowerCase(), pageNum: pageNum, yPct: line.yPct });
                                }
                            }
                        });
                    });
                });
            });
        }, Promise.resolve()).then(function () {
            // 印刷頁碼落差：全篇取「票數最多」的 offset，至少要有 2 頁同意才採信，避免單一頁碼
            // 誤判（例如頁尾裝飾數字、章節編號）就套用到整份 PDF，反而幫倒忙。
            var printedPageOffset = null;
            var bestVoteCount = 0;
            Object.keys(footerOffsetVotes).forEach(function (k) {
                if (footerOffsetVotes[k] > bestVoteCount) { bestVoteCount = footerOffsetVotes[k]; printedPageOffset = parseInt(k, 10); }
            });
            if (bestVoteCount < 2) printedPageOffset = null;

            // 補位第一層：解答文字裡「Quiz N, p. NN」的印刷頁碼，換算成 PDF 頁碼。跟掃 PDF 標題文字
            // 是兩個獨立來源，任何一個被 OCR 讀壞都還有另一個可用；已經靠標題文字精確比對到的
            // 大題不會被這裡覆蓋（只補「還沒找到」的）。
            // 💣 大題本來就該依序出現在課本裡——換算出來的候選頁碼必須落在「前一個已確定大題」跟
            // 「下一個已確定大題」的頁碼之間（跟下面 loose/bare 候選補位用同一套雙向邊界檢查），
            // 不然一旦這個 p.NN 本身抄錄有誤，會把候選頁推到比後面已確定大題還後面，反而製造出
            // 順序顛倒的離譜範圍（實測 Quiz 7 沒有這個邊界檢查時被推到 Quiz 8、9、10 後面的頁碼）。
            // 落在邊界外就跳過，留給後面幾層候選機制去補。
            if (sectionPageHints && printedPageOffset != null) {
                sectionOrder.forEach(function (sec, idx) {
                    if (foundPage[sec] != null) return;
                    var printedPage = sectionPageHints[sec];
                    if (printedPage == null) return;
                    var candidatePage = printedPage - printedPageOffset;
                    var prevPage = 1;
                    for (var b = idx - 1; b >= 0; b--) { if (foundPage[sectionOrder[b]] != null) { prevPage = foundPage[sectionOrder[b]]; break; } }
                    var nextPage = numPages;
                    for (var a = idx + 1; a < sectionOrder.length; a++) { if (foundPage[sectionOrder[a]] != null) { nextPage = foundPage[sectionOrder[a]]; break; } }
                    if (candidatePage >= prevPage && candidatePage <= nextPage) {
                        foundPage[sec] = candidatePage;
                    }
                });
            }
            // 補位：還沒找到的大題，優先在「前一個已確定大題」跟「下一個已確定大題」的頁碼範圍內，
            // 找同一種關鍵字家族（quiz/chapter/…）的候選行（數字被 OCR 壞掉但關鍵字還讀得到），
            // 依序消耗候選行，不會被其他大題重複用到。真的連候選行都沒有才退回沿用前一個大題頁碼。
            var usedCandidateIdx = {};
            var usedBareIdx = {};
            sectionOrder.forEach(function (sec, idx) {
                if (foundPage[sec] != null) return;
                var family = String(sec || '').toLowerCase().match(SECTION_KEYWORD_FAMILY_RE);
                if (!family) return;
                family = family[1];
                var prevPage = 1;
                for (var b = idx - 1; b >= 0; b--) { if (foundPage[sectionOrder[b]] != null) { prevPage = foundPage[sectionOrder[b]]; break; } }
                var nextPage = numPages;
                for (var a = idx + 1; a < sectionOrder.length; a++) { if (foundPage[sectionOrder[a]] != null) { nextPage = foundPage[sectionOrder[a]]; break; } }
                for (var c = 0; c < looseCandidates.length; c++) {
                    if (usedCandidateIdx[c]) continue;
                    var cand = looseCandidates[c];
                    if (cand.family === family && cand.pageNum >= prevPage && cand.pageNum <= nextPage) {
                        foundPage[sec] = cand.pageNum;
                        if (cand.yPct != null) foundYPct[sec] = cand.yPct;
                        usedCandidateIdx[c] = true;
                        break;
                    }
                }
                if (foundPage[sec] != null) return;
                // 連「關鍵字＋壞掉的短符號」候選都沒有——退到最弱的一層：行首只有關鍵字，
                // 數字大概被分到別的視覺行去了。
                for (var d = 0; d < bareCandidates.length; d++) {
                    if (usedBareIdx[d]) continue;
                    var bc = bareCandidates[d];
                    if (bc.family === family && bc.pageNum >= prevPage && bc.pageNum <= nextPage) {
                        foundPage[sec] = bc.pageNum;
                        if (bc.yPct != null) foundYPct[sec] = bc.yPct;
                        usedBareIdx[d] = true;
                        break;
                    }
                }
            });
            // 找不到的大題：沿用前一個已定位大題的頁碼（至少能看到差不多的頁面，不會整片空白）；
            // 第一個大題還是找不到就預設第 1 頁。
            // 只有頁碼、沒有 y（例如只靠解答 p.NN 換算）時，用同一頁上精確掃到的同名標題列補 y。
            // 找不到就不填，不准猜中間高度——同一頁下面那題沒有 y 就仍會停在頁頂。
            sectionOrder.forEach(function (sec, idx) {
                if (foundYPct[sec] != null || foundPage[sec] == null) return;
                var page = foundPage[sec];
                var hit = allHeaders.find(function (h) {
                    return h.pageNum === page && normFuzzy(h.label) === fuzzyTargets[idx];
                });
                if (hit && hit.yPct != null) foundYPct[sec] = hit.yPct;
            });
            var lastKnown = 1;
            var starts = sectionOrder.map(function (sec) {
                if (foundPage[sec] != null) { lastKnown = foundPage[sec]; return foundPage[sec]; }
                return lastKnown;
            });
            return sectionOrder.map(function (sec, idx) {
                var start = starts[idx];
                var nextStart = (idx + 1 < starts.length) ? starts[idx + 1] : (numPages + 1);
                var end = Math.max(start, nextStart - 1);
                var yPct = foundYPct[sec];
                return {
                    section: sec,
                    startPage: start,
                    endPage: Math.min(end, numPages),
                    startYPct: (yPct != null && isFinite(yPct)) ? yPct : 0
                };
            });
        });
    }

    /**
     * 只掃題目 PDF 上實際出現的大題標頭（依第一次出現順序）。不看解答清單。
     * 用來跟解析出來的 Quiz 組對帳：題目有、解答沒有 → 警示，不准當成沒有這組。
     */
    function scanPaperSectionLabels(pdfDoc) {
        if (!pdfDoc) return Promise.resolve([]);
        var numPages = pdfDoc.numPages;
        var pageNums = [];
        var p;
        for (p = 1; p <= numPages; p++) pageNums.push(p);
        var labels = [];
        var seen = {};
        var pdfTestCtx = null;
        var pendingTest = null;

        function addScanLabel(label) {
            var key = _sectionReviewKey(label);
            if (!label || seen[key]) return;
            seen[key] = true;
            labels.push(label);
        }

        return pageNums.reduce(function (chain, pageNum) {
            return chain.then(function () {
                return pdfDoc.getPage(pageNum).then(function (page) {
                    return _pageItemsPct(page).then(function (items) {
                        var lines = _groupLines(items);
                        lines.forEach(function (line) {
                            var lineText = line.items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim();
                            var collapsed = _collapseLetterSpacedTokens(lineText);
                            var secMatch = collapsed.match(SECTION_HEADER_ANYWHERE_RE);
                            if (!secMatch) return;
                            var composed = _composeSectionLabel(pdfTestCtx, secMatch[1]);
                            pdfTestCtx = composed.testCtx;
                            var fam = sectionFamily(secMatch[1]);
                            if (composed.isTestHeader) {
                                if (pendingTest) addScanLabel(pendingTest);
                                pendingTest = composed.label || composed.testCtx;
                                return;
                            }
                            if (fam === 'part') {
                                pendingTest = null;
                            } else if (pendingTest) {
                                addScanLabel(pendingTest);
                                pendingTest = null;
                            }
                            if (composed.label) addScanLabel(composed.label);
                        });
                    });
                });
            });
        }, Promise.resolve()).then(function () {
            if (pendingTest) addScanLabel(pendingTest);
            return labels;
        });
    }

    function sectionOverrideKey(review, section) {
        var o = (review && review.section_template_overrides) || {};
        if (o[section]) return o[section];
        var k = _sectionReviewKey(section);
        var hit = Object.keys(o).filter(function (s) { return _sectionReviewKey(s) === k; })[0];
        return hit ? o[hit] : '';
    }

    function isSectionConfirmed(review, section) {
        var map = (review && review.confirmed_sections) || {};
        var k = _sectionReviewKey(section);
        if (map[section] || map[k]) return true;
        var hit = Object.keys(map).filter(function (s) { return _sectionReviewKey(s) === k; })[0];
        return !!(hit && map[hit]);
    }

    function setSectionConfirmed(review, section, on) {
        review = review || {};
        if (!review.confirmed_sections) review.confirmed_sections = {};
        var k = _sectionReviewKey(section);
        if (on) {
            review.confirmed_sections[section] = true;
        } else {
            delete review.confirmed_sections[section];
            delete review.confirmed_sections[k];
            Object.keys(review.confirmed_sections).forEach(function (s) {
                if (_sectionReviewKey(s) === k) delete review.confirmed_sections[s];
            });
        }
        return review;
    }

    function sectionConfirmButtonHtml(section, review, opts) {
        opts = opts || {};
        var on = isSectionConfirmed(review, section);
        var cls = opts.btnClass || 'pdf-exam-confirm-section';
        if (on) {
            return '<span class="pdf-exam-confirmed-label" data-section="' + _escLocate(section)
                + '" style="margin-left:8px; padding:2px 8px; font-size:0.72rem; font-weight:800; display:inline-block; background:#CCFBF1; color:#0F766E; border:1px solid #5EEAD4; border-radius:6px;">已確認</span>';
        }
        var clickAttr = '';
        if (opts.pathStr) {
            clickAttr = ' onclick="window.FeaturePdfExamJob.confirmSection(\'' + _escLocate(opts.pathStr) + '\', this.getAttribute(\'data-section\'))"';
        }
        var label = opts.confirmLabel || '確認並儲存';
        return '<button type="button" class="' + cls + ' btn" data-section="' + _escLocate(section) + '"' + clickAttr
            + ' style="margin-left:8px; padding:2px 8px; font-size:0.72rem; font-weight:800; cursor:pointer; height:auto; background:#FFFFFF; color:#0F766E; border:1px solid #0F766E; border-radius:6px;">'
            + _escLocate(label) + '</button>';
    }

    function _isBankScroller(el) {
        if (!el || !el.classList) return false;
        if (el.classList.contains('mz-pdf-exam-bank')) return true;
        var id = String(el.id || '');
        return id.indexOf('pdf-exam-bank-') === 0;
    }

    function snapshotScroller(fromEl) {
        var list = [];
        var el = fromEl;
        var first = true;
        while (el && el !== document.documentElement) {
            list.push({
                el: el,
                top: el.scrollTop || 0,
                left: el.scrollLeft || 0,
                wasBank: first && _isBankScroller(el)
            });
            first = false;
            el = el.parentElement;
        }
        list.push({
            win: true,
            top: window.pageYOffset || document.documentElement.scrollTop || 0,
            left: window.pageXOffset || 0
        });
        return list;
    }

    function restoreScroller(list, newBank) {
        (list || []).forEach(function (s) {
            if (s.win) {
                window.scrollTo(s.left, s.top);
                return;
            }
            if (s.el && s.el.isConnected) {
                s.el.scrollTop = s.top;
                s.el.scrollLeft = s.left;
                return;
            }
            if (s.wasBank && newBank) newBank.scrollTop = s.top;
        });
    }

    function revealBankAnchor(root, anchor) {
        if (!root || !anchor) return;
        var bank = (root.querySelector && (
            root.querySelector('.mz-pdf-exam-bank')
            || root.querySelector('[id^="pdf-exam-bank-"]')
        )) || (_isBankScroller(root) ? root : null);
        var scope = bank || root;
        var node = null;
        if (typeof anchor.idx === 'number' && !isNaN(anchor.idx)) {
            node = scope.querySelector('.pdf-exam-bank-row[data-idx="' + String(anchor.idx) + '"]')
                || scope.querySelector('[data-idx="' + String(anchor.idx) + '"]');
        }
        if (!node && anchor.section) {
            var sec = String(anchor.section);
            var nodes = scope.querySelectorAll('[data-section]');
            var i;
            for (i = 0; i < nodes.length; i++) {
                if (nodes[i].getAttribute('data-section') === sec) {
                    node = nodes[i];
                    break;
                }
            }
        }
        if (!node) return;
        var scroller = (node.closest && (node.closest('.mz-pdf-exam-bank') || node.closest('[id^="pdf-exam-bank-"]'))) || bank;
        if (!scroller) return;
        var s = scroller.getBoundingClientRect();
        var n = node.getBoundingClientRect();
        if (n.top < s.top) scroller.scrollTop += (n.top - s.top - 8);
        else if (n.bottom > s.bottom) scroller.scrollTop += (n.bottom - s.bottom + 8);
    }

    function containBankWheel(e) {
        var t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        if (!t.closest('.mz-pdf-exam-bank')) return;
        e.stopPropagation();
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('wheel', containBankWheel, { capture: true, passive: true });
        document.addEventListener('touchmove', containBankWheel, { capture: true, passive: true });
    }

    function afterBankRedraw(root, snap, anchor) {
        function apply() {
            var bank = root && root.querySelector
                ? (root.querySelector('.mz-pdf-exam-bank') || (_isBankScroller(root) ? root : null))
                : null;
            restoreScroller(snap, bank);
            revealBankAnchor(root, anchor);
        }
        apply();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                apply();
                requestAnimationFrame(apply);
            });
        }
        setTimeout(apply, 0);
    }

    function teacherBoxesForSection(review, section) {
        var loc = (review && review.teacher_located_boxes) || {};
        if (Array.isArray(loc[section])) return loc[section];
        var k = _sectionReviewKey(section);
        var hit = Object.keys(loc).filter(function (s) { return _sectionReviewKey(s) === k; })[0];
        return hit && Array.isArray(loc[hit]) ? loc[hit] : [];
    }

    function setSectionTeacherLocate(review, section, boxes) {
        review = review || {};
        if (!review.section_template_overrides) review.section_template_overrides = {};
        if (!review.teacher_located_boxes) review.teacher_located_boxes = {};
        review.section_template_overrides[section] = TPL_TEACHER_LOCATE;
        if (boxes) review.teacher_located_boxes[section] = boxes;
        return review;
    }

    function _escLocate(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 老師定位：在 PDF 上依解答順序點空格。學生那一大題只填字，不再自己點位置。
     */
    function openTeacherLocateEditor(opts) {
        opts = opts || {};
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') {
            return Promise.reject(new Error('ModalOverlay 未載入'));
        }
        var modalId = 'pdf-exam-teacher-locate';
        var boxes = (opts.boxes || []).map(function (b) {
            return {
                id: b.id || ('tb' + Date.now() + '_' + Math.floor(Math.random() * 10000)),
                page: b.page,
                xPct: b.xPct,
                yPct: b.yPct,
                text: ''
            };
        });
        var dirty = false;
        var expected = Number(opts.expectedCount) || 0;
        var saved = false;

        function countLabel() {
            return '已點 ' + boxes.length + ' 格' + (expected > 0 ? ('（這一組解答 ' + expected + ' 格）') : '（這一組解答尚未解析出格數，仍可點空格存座標）');
        }

        function paintMarks(root) {
            var countEl = root.querySelector('#pdf-locate-count');
            if (countEl) countEl.textContent = countLabel();
            Array.prototype.slice.call(root.querySelectorAll('.pdf-locate-page')).forEach(function (wrap) {
                var pageNum = Number(wrap.getAttribute('data-page'));
                var layer = wrap.querySelector('.pdf-locate-marks');
                if (!layer) return;
                layer.innerHTML = boxes.filter(function (b) { return Number(b.page) === pageNum; }).map(function (b, idx) {
                    var order = boxes.indexOf(b) + 1;
                    return '<div class="pdf-locate-mark" data-box-id="' + _escLocate(b.id) + '" style="position:absolute; left:' + b.xPct + '%; top:' + b.yPct + '%; transform:translate(-50%,-50%); width:22px; height:22px; border-radius:50%; background:#0F766E; color:white; font-size:0.7rem; font-weight:900; display:flex; align-items:center; justify-content:center; pointer-events:none;">' + order + '</div>';
                }).join('');
            });
        }

        window.ModalOverlay.open({
            id: modalId,
            tier: 'B',
            zIndex: 80,
            isDirty: function () { return dirty && !saved; },
            unsavedMessage: '定位尚未儲存，確定要關閉嗎？',
            contentHtml: '<div data-mo-panel style="background:white; border-radius:10px; width:min(920px,96vw); height:min(90vh,900px); display:flex; flex-direction:column; overflow:hidden; box-sizing:border-box;">'
                + '<div style="flex-shrink:0; padding:12px 16px; border-bottom:1px solid #99F6E4;">'
                + '<div style="font-weight:900; color:#0F766E;">老師定位　' + _escLocate(opts.sectionLabel || '') + '</div>'
                + '<div style="font-size:0.82rem; font-weight:700; color:#134E4A; margin-top:4px;">依解答順序點空格。學生這一組只填字。</div>'
                + '<div id="pdf-locate-count" style="font-size:0.8rem; font-weight:800; color:#0F766E; margin-top:6px;">' + countLabel() + '</div>'
                + '</div>'
                + '<div id="pdf-locate-pages" style="flex:1; overflow:auto; padding:12px; background:#F8FAFC;"></div>'
                + '<div style="flex-shrink:0; padding:10px 16px; border-top:1px solid #E2E8F0; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">'
                + '<button type="button" class="btn btn-primary" id="pdf-locate-save" style="background:#0F766E; color:white; border:1px solid #0F766E; font-weight:800;">儲存定位</button>'
                + '<button type="button" class="btn" id="pdf-locate-undo" style="background:white; color:#134E4A; border:1px solid #CBD5E1; font-weight:800;">刪最後一格</button>'
                + '<button type="button" class="btn" id="pdf-locate-cancel" style="background:white; color:#134E4A; border:1px solid #CBD5E1; font-weight:800;">取消</button>'
                + '<span id="pdf-locate-err" style="font-weight:700; color:#B91C1C;"></span>'
                + '</div></div>',
            onMount: function (overlay) {
                var pagesEl = overlay.querySelector('#pdf-locate-pages');
                var errEl = overlay.querySelector('#pdf-locate-err');
                var saveBtn = overlay.querySelector('#pdf-locate-save');
                overlay.querySelector('#pdf-locate-cancel').addEventListener('click', function () {
                    window.ModalOverlay.requestClose(modalId);
                });
                overlay.querySelector('#pdf-locate-undo').addEventListener('click', function () {
                    if (!boxes.length) return;
                    boxes.pop();
                    dirty = true;
                    paintMarks(overlay);
                });
                saveBtn.addEventListener('click', function () {
                    if (expected > 0 && boxes.length !== expected) {
                        if (errEl) errEl.textContent = '點的格數（' + boxes.length + '）跟這一組解答（' + expected + '）不同，請對齊後再儲存';
                        return;
                    }
                    window.ModalOverlay.setBusy(modalId, true);
                    saveBtn.textContent = '儲存中…';
                    saved = true;
                    if (typeof opts.onSaved === 'function') opts.onSaved(boxes.slice());
                    window.ModalOverlay.close(modalId);
                });
                pagesEl.textContent = '載入 PDF…';
                loadPdfDocumentFromDrive(opts.pdfFileId).then(function (pdfDoc) {
                    pagesEl.innerHTML = '';
                    var chain = Promise.resolve();
                    var pi;
                    for (pi = 1; pi <= pdfDoc.numPages; pi++) {
                        (function (pageNum) {
                            chain = chain.then(function () {
                                return pdfDoc.getPage(pageNum).then(function (page) {
                                    var viewport = page.getViewport({ scale: 1.15 });
                                    var canvas = document.createElement('canvas');
                                    canvas.width = viewport.width;
                                    canvas.height = viewport.height;
                                    canvas.style.width = '100%';
                                    canvas.style.height = 'auto';
                                    canvas.style.display = 'block';
                                    return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
                                        var wrap = document.createElement('div');
                                        wrap.className = 'pdf-locate-page';
                                        wrap.setAttribute('data-page', String(pageNum));
                                        wrap.style.position = 'relative';
                                        wrap.style.margin = '0 auto 12px';
                                        wrap.style.maxWidth = '100%';
                                        wrap.appendChild(canvas);
                                        var layer = document.createElement('div');
                                        layer.className = 'pdf-locate-marks';
                                        layer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
                                        wrap.appendChild(layer);
                                        canvas.addEventListener('click', function (ev) {
                                            var rect = canvas.getBoundingClientRect();
                                            boxes.push({
                                                id: 'tb' + Date.now() + '_' + Math.floor(Math.random() * 10000),
                                                page: pageNum,
                                                xPct: ((ev.clientX - rect.left) / rect.width) * 100,
                                                yPct: ((ev.clientY - rect.top) / rect.height) * 100,
                                                text: ''
                                            });
                                            dirty = true;
                                            if (errEl) errEl.textContent = '';
                                            paintMarks(overlay);
                                        });
                                        pagesEl.appendChild(wrap);
                                    });
                                });
                            });
                        })(pi);
                    }
                    return chain.then(function () { paintMarks(overlay); });
                }).catch(function (err) {
                    if (pagesEl) pagesEl.textContent = '載入失敗：' + (err.message || err);
                });
            }
        });
    }

    function splitReviewPanelHtml(review, opts) {
        opts = opts || {};
        var btnClass = opts.locateBtnClass || 'pdf-exam-use-locate';
        if (!review) return '';
        var warnings = (review.section_warnings || []).filter(function (w) {
            return w && !isSectionConfirmed(review, w.section);
        });
        var flagged = review.flagged_keys || {};
        var flaggedReasons = [];
        Object.keys(flagged).forEach(function (k) {
            var r = flagged[k];
            if (!r) return;
            var bk = (opts.bank || []).filter(function (it) { return it && it.key === k; })[0];
            if (bk && isSectionConfirmed(review, bk.section)) return;
            if (flaggedReasons.indexOf(r) === -1) flaggedReasons.push(r);
        });
        // 頂列只列大題組（Quiz／TEST）。題號格數對不上寫在該列紅字，不准在頂列假裝有「第 2 題」這種大題。
        var offerSeen = {};
        var offerBtns = [];
        function addOffer(sec) {
            sec = String(sec || '').trim();
            if (!sec) return;
            var seenKey = sec.replace(/\s+/g, ' ').toLowerCase();
            if (offerSeen[seenKey]) return;
            offerSeen[seenKey] = true;
            var already = sectionOverrideKey(review, sec) === TPL_TEACHER_LOCATE;
            var label = already ? ('重新定位「' + sec + '」') : ('「' + sec + '」改用老師定位');
            var clickAttr = '';
            if (opts.pathStr) {
                clickAttr = ' onclick="window.FeaturePdfExamJob.useTeacherLocate(\'' + _escLocate(opts.pathStr) + '\', this.getAttribute(\'data-section\'))"';
            }
            offerBtns.push('<button type="button" class="' + btnClass + ' btn" data-section="' + _escLocate(sec) + '"' + clickAttr + ' style="margin:4px 4px 0 0; padding:4px 8px; background:#FFFFFF; color:#9A3412; border:1px solid #FDBA74; border-radius:6px; font-weight:800; cursor:pointer; height:auto;">' + _escLocate(label) + '</button>');
        }
        warnings.forEach(function (w) { addOffer(w && w.section); });
        (review.missing_sections || []).forEach(function (m) {
            if (m && isSectionConfirmed(review, m.section)) return;
            addOffer(m && m.section);
        });
        if (opts.examTemplateKey === TPL_TEACHER_LOCATE) {
            _answerSectionOrder(opts.bank || []).forEach(function (sec) { addOffer(sec); });
        }
        var hasProblem = warnings.length || flaggedReasons.length;
        if (!hasProblem && !offerBtns.length) {
            if (review.pdf_checked) return '';
            return '<div style="margin-bottom:6px; padding:6px 8px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; font-size:0.76rem; color:#92400E; font-weight:700;">尚未跟考卷空格線交叉檢查（沒 PDF 或偵測不到底線）。逗號可能是多格、也可能是答案裡的逗號，請人工核對。</div>';
        }
        var head = hasProblem
            ? '⚠ 解答跟題目的大題組／格數對不上。預設仍是「左到右、上到下」。有問題的那一組可改用「老師定位」。'
            : '這一份套用「老師定位」。請依解答順序點每一組的空格。';
        var bg = hasProblem ? '#FEF2F2' : '#ECFDF5';
        var bd = hasProblem ? '#FECACA' : '#99F6E4';
        var col = hasProblem ? '#B91C1C' : '#0F766E';
        var lines = warnings.map(function (w) { return '• ' + _escLocate(w.message); });
        return '<div style="margin-bottom:6px; padding:8px 10px; background:' + bg + '; border:1px solid ' + bd + '; border-radius:6px; font-size:0.78rem; color:' + col + '; font-weight:800;">'
            + head
            + (lines.length ? ('<br>' + lines.join('<br>')) : '')
            + (offerBtns.length ? ('<div style="margin-top:6px;">' + offerBtns.join('') + '</div>') : '')
            + '</div>';
    }

    function pickBankSection(groups, want) {
        var w = String(want || '');
        var i;
        for (i = 0; i < (groups || []).length; i++) {
            if (String((groups[i] && groups[i].section) || '') === w) return groups[i];
        }
        return (groups && groups[0]) || null;
    }

    function bankSectionTabsHtml(groups, activeSection, opts) {
        opts = opts || {};
        var tabClass = opts.tabClass || 'pdf-exam-quiz-tab';
        var review = opts.review;
        var warned = opts.warnedSections || {};
        return '<div class="pdf-exam-quiz-tabs" style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px;">'
            + (groups || []).map(function (g) {
                var sec = g.section || '(未分類)';
                var on = String(g.section || '') === String(activeSection || '');
                var confirmed = isSectionConfirmed(review, g.section);
                var warn = !confirmed && (!!warned[g.section] || !!g.missing);
                var bg = on ? (warn ? '#FEF2F2' : '#CCFBF1') : '#FFFFFF';
                var bd = on ? (warn ? '#F87171' : '#0F766E') : '#CBD5E1';
                var col = warn ? '#B91C1C' : (on ? '#0F766E' : '#334155');
                var clickAttr = '';
                if (opts.pathStr) {
                    clickAttr = ' onclick="window.FeaturePdfExamJob.selectBankSection(\'' + _escLocate(opts.pathStr) + '\', this.getAttribute(\'data-section\'))"';
                }
                return '<button type="button" class="' + tabClass + ' btn" data-section="' + _escLocate(g.section || '') + '"' + clickAttr
                    + ' style="padding:5px 12px; font-size:0.78rem; font-weight:800; cursor:pointer; height:auto; background:' + bg + '; color:' + col + '; border:1px solid ' + bd + '; border-radius:6px;">'
                    + _escLocate(sec) + (warn ? ' ⚠' : '') + (confirmed ? ' ✓' : '')
                    + '</button>';
            }).join('')
            + '</div>';
    }

    return {
        TPL_ORDER_LTR_TTB: TPL_ORDER_LTR_TTB,
        TPL_TEACHER_LOCATE: TPL_TEACHER_LOCATE,
        PDF_EXAM_TEMPLATES: PDF_EXAM_TEMPLATES,
        ensurePdfJsLoaded: ensurePdfJsLoaded,
        downloadDriveFileAsArrayBuffer: downloadDriveFileAsArrayBuffer,
        loadPdfDocumentFromDrive: loadPdfDocumentFromDrive,
        detectBlankCandidates: detectBlankCandidates,
        detectBlankCountsByLabel: detectBlankCountsByLabel,
        detectBlankReviewStats: detectBlankReviewStats,
        scanPaperSectionLabels: scanPaperSectionLabels,
        buildSplitReview: buildSplitReview,
        autoAssignBoxesInOrder: autoAssignBoxesInOrder,
        detectSectionPageRanges: detectSectionPageRanges,
        parseAnswerText: parseAnswerText,
        repairStaleCommaSplits: repairStaleCommaSplits,
        makeKey: makeKey,
        itemLabel: itemLabel,
        buildGradingPaper: buildGradingPaper,
        groupItemsBySection: groupItemsBySection,
        groupItemsBySectionWithMissing: groupItemsBySectionWithMissing,
        listMissingQuizSections: listMissingQuizSections,
        computeSectionStats: computeSectionStats,
        buildSectionAnswersFromBoxes: buildSectionAnswersFromBoxes,
        buildAnswersFromBoxesBySection: buildAnswersFromBoxesBySection,
        sectionOverrideKey: sectionOverrideKey,
        teacherBoxesForSection: teacherBoxesForSection,
        setSectionTeacherLocate: setSectionTeacherLocate,
        isSectionConfirmed: isSectionConfirmed,
        setSectionConfirmed: setSectionConfirmed,
        sectionConfirmButtonHtml: sectionConfirmButtonHtml,
        snapshotScroller: snapshotScroller,
        restoreScroller: restoreScroller,
        revealBankAnchor: revealBankAnchor,
        afterBankRedraw: afterBankRedraw,
        applyAcceptedSplitsToItem: applyAcceptedSplitsToItem,
        mergeParsedBankKeepingOrder: mergeParsedBankKeepingOrder,
        applyItemNoToBankRow: applyItemNoToBankRow,
        numberItemBlanks: numberItemBlanks,
        normalizeAllItemBlanks: normalizeAllItemBlanks,
        insertBlankRow: insertBlankRow,
        insertManualBankRow: insertManualBankRow,
        openAddManualBankRowModal: openAddManualBankRowModal,
        openTeacherLocateEditor: openTeacherLocateEditor,
        splitReviewPanelHtml: splitReviewPanelHtml,
        pickBankSection: pickBankSection,
        bankSectionTabsHtml: bankSectionTabsHtml,
        formatAcceptedAnswerList: formatAcceptedAnswerList,
        parseAcceptedAnswerList: parseAcceptedAnswerList
    };
})();

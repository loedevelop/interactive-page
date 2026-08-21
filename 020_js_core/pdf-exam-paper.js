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
        return pageNums.reduce(function (chain, pageNum) {
            return chain.then(function (acc) {
                return pdfDoc.getPage(pageNum).then(function (page) {
                    return _pageItemsPct(page).then(function (items) {
                        var lines = _groupLines(items);
                        var pageBlanks = [];
                        lines.forEach(function (line) {
                            var lineText = line.items.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim();
                            var secMatch = lineText.match(SECTION_HEADER_RE);
                            if (secMatch && !/^\d+[.\)]/.test(lineText)) {
                                currentSection = normalizeSectionLabel(secMatch[1]);
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

    /**
     * 交叉檢查：清單格數 vs PDF 空格線。不一致的大題／題號列進 warnings，對應 key 列進 flagged_keys。
     * 空格線偵測不到（該大題 total=0）不視為衝突，避免掃描稿誤報整份都紅。
     */
    function buildSplitReview(bank, blankStats) {
        var flagged = {};
        var sectionWarnings = [];
        var groups = {};
        (bank || []).forEach(function (it) {
            if (!it) return;
            var sk = _sectionReviewKey(it.section);
            if (!groups[sk]) groups[sk] = { section: it.section, items: [], byLoose: {} };
            groups[sk].items.push(it);
            var loose = String(it.item_no || '') + '::' + (it.part || '');
            (groups[sk].byLoose[loose] = groups[sk].byLoose[loose] || []).push(it);
        });
        var statsBySec = (blankStats && blankStats.bySection) || {};
        Object.keys(groups).forEach(function (sk) {
            var g = groups[sk];
            var st = statsBySec[sk];
            if (st && st.total > 0 && st.total !== g.items.length) {
                sectionWarnings.push({
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
                var reason = '第 ' + label + ' 題：清單 ' + items.length + ' 格，空格線 ' + hintN + ' 格';
                items.forEach(function (it) { flagged[it.key] = reason; });
            });
        });
        return {
            pdf_checked: !!(blankStats && blankStats.total > 0),
            section_warnings: sectionWarnings,
            flagged_keys: flagged
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
    var SECTION_HEADER_RE = /^(Quiz\s*\d+|Test\s*\d+|Chapter\s*\d+|Unit\s*\d+|Part\s+[A-Za-z0-9]+|Section\s*\d+|Lesson\s*\d+|第\s*[一二三四五六七八九十\d]+\s*[大課單元部分節])/i;
    // detectSectionPageRanges 專用：跟 SECTION_HEADER_RE 同一組關鍵字，但不要求一定要在整行最前面
    // （PDF 掃描頁上偶爾會有頁碼／裝飾文字混在同一行），避免因為位置沒對齊就整頁判定找不到標題。
    var SECTION_HEADER_ANYWHERE_RE = /(Quiz\s*\d+|Test\s*\d+|Chapter\s*\d+|Unit\s*\d+|Part\s+[A-Za-z0-9]+|Section\s*\d+|Lesson\s*\d+|第\s*[一二三四五六七八九十\d]+\s*[大課單元部分節])/i;
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
     * （testCtx，可為 null）：遇到 Test 家族的標頭就更新 testCtx、標頭本身不當成獨立大題；
     * 遇到 Part 家族的標頭，若 testCtx 有值就組成「TEST 1 - Part D」這種帶上下文的大題名；
     * 遇到其他家族（quiz/chapter/unit/section/lesson）一律清空 testCtx（那些不會附屬在 Test 底下）。
     * parseAnswerText（解答文字）跟 detectSectionPageRanges（掃 PDF 標題文字）兩處都要維持
     * 同一份 testCtx 狀態機、用同一個函式組 key，兩邊組出來的大題名才會一致、才能互相比對定位。
     */
    function _composeSectionLabel(testCtx, rawLabel) {
        var family = sectionFamily(rawLabel);
        var normalized = normalizeSectionLabel(rawLabel);
        if (family === 'test') {
            return { testCtx: normalized, label: null, isTestHeader: true };
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
    var TRAILING_OR_RE = /\bOR\s*$/i;
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
            return { kind: 'group', letter: letter, rest: '' };
        }
        var bare = s.match(SUBSECTION_BARE_RE);
        if (bare) return { kind: 'group', letter: bare[1].toUpperCase(), rest: '' };
        return null;
    }

    function stripTrailingOr(text) {
        var endsWithOr = TRAILING_OR_RE.test(text);
        return { text: endsWithOr ? text.replace(TRAILING_OR_RE, '').trim() : text, endsWithOr: endsWithOr };
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

    /**
     * 💣 可行答案（accepted_answers）只認解答裡的 OR。沒有 OR＝不是替代寫法。
     * 禁止把換行、問句、小題當成其他可接受答案。
     */
    function _splitOrAlternatives(text) {
        var raw = String(text || '').trim();
        if (!raw) return { primary: '', accepted: [] };
        var parts = raw.split(/\s*\bOR\b\s*/i).map(function (s) { return s.trim(); }).filter(Boolean);
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

        lines.forEach(function (rawLine) {
            var line = rawLine.trim();
            if (!line) return;

            var secMatch = line.match(SECTION_HEADER_RE);
            if (secMatch && !/^\d+\./.test(line)) {
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
                        return;
                    }
                }
                if (composed.isTestHeader) return;
                currentSection = composed.label;
                currentGroup = null;
                if (sectionPageHints[currentSection] == null) {
                    var pageHintMatch = line.slice(secMatch[0].length).match(SECTION_PAGE_HINT_RE);
                    if (pageHintMatch) {
                        var printedPage = parseInt(pageHintMatch[1], 10);
                        if (!isNaN(printedPage)) sectionPageHints[currentSection] = printedPage;
                    }
                }
                return;
            }

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

            if (/^(directions|example|examples)\s*:/i.test(line)) return;

            ITEM_MARKER_RE.lastIndex = 0;
            var matches = [];
            var m;
            while ((m = ITEM_MARKER_RE.exec(line))) {
                matches.push({ no: m[1], start: m.index, textStart: m.index + m[0].length });
            }

            if (matches.length) {
                advanceGroupOnNumberRestart(matches[0].no);
                for (var i = 0; i < matches.length; i++) {
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

            var orOnly = line.match(OR_LEAD_RE);
            if (orOnly && last) {
                var orRest = stripTrailingOr(orOnly[1].trim());
                var orAlt = _splitOrAlternatives(orRest.text);
                if (!last.accepted) last.accepted = [];
                if (orAlt.primary) last.accepted.push(orAlt.primary);
                last.accepted = last.accepted.concat(orAlt.accepted);
                last._pendingOr = orRest.endsWithOr;
                return;
            }

            if (last) {
                var cont = stripTrailingOr(line);
                if (_shouldBeNewPart(last, cont.text)) {
                    if (!last.part) last.part = 'A';
                    var nextPart = _nextPartLetter(last.part);
                    var partItems = _buildFragmentItems(last.section, last.itemNo, nextPart, cont, last.group || currentGroup);
                    partItems.forEach(function (it) { items.push(it); last = it; });
                    return;
                }
                addContinuationFragment(last, line);
            }
        });

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
        var prevByKey = {};
        prev.forEach(function (b) { if (b && b.key) prevByKey[b.key] = b; });
        var freshKeys = {};
        fresh.forEach(function (b) { freshKeys[b.key] = true; });
        var merged = fresh.map(function (b) {
            var p = prevByKey[b.key];
            if (p && p._manuallyEdited) {
                return {
                    key: b.key, section: b.section, item_no: b.item_no, part: b.part, group: b.group,
                    blank_index: b.blank_index,
                    answer_text: p.answer_text, accepted_answers: p.accepted_answers, _manuallyEdited: true
                };
            }
            return b;
        });
        var preservedManual = prev.filter(function (b) {
            if (!b || !b._manual || freshKeys[b.key]) return false;
            // 舊的未拆格 key（Quiz 2::1::B）已被 Quiz 2::1::B::1 取代時，不要再留那一列
            return !freshKeys[String(b.key) + '::1'];
        });
        var next = merged.concat(preservedManual);
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
        var looseCandidates = []; // { family, pageNum } - 關鍵字配到但數字被 OCR 壞掉的候選行
        var bareCandidates = []; // { family, pageNum } - 只比對到行首關鍵字，連數字都配不到（更弱，最後才用）
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
                            sectionOrder.forEach(function (sec, idx) {
                                if (foundPage[sec] != null) return; // 只記第一次出現
                                if (candidate && normFuzzy(candidate) === fuzzyTargets[idx]) {
                                    foundPage[sec] = pageNum;
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
                                    if (famMatch) looseCandidates.push({ family: famMatch[1].toLowerCase(), pageNum: pageNum });
                                } else {
                                    // 連「關鍵字＋壞掉的短符號」都配不到，才退而比對「行首只有關鍵字」——
                                    // 標題數字可能被分到別的視覺行去了，這一行只剩關鍵字本身。
                                    var bareMatch = collapsed.match(SECTION_HEADER_BARE_KEYWORD_RE);
                                    if (bareMatch) bareCandidates.push({ family: bareMatch[1].toLowerCase(), pageNum: pageNum });
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
                        usedBareIdx[d] = true;
                        break;
                    }
                }
            });
            // 找不到的大題：沿用前一個已定位大題的頁碼（至少能看到差不多的頁面，不會整片空白）；
            // 第一個大題還是找不到就預設第 1 頁。
            var lastKnown = 1;
            var starts = sectionOrder.map(function (sec) {
                if (foundPage[sec] != null) { lastKnown = foundPage[sec]; return foundPage[sec]; }
                return lastKnown;
            });
            return sectionOrder.map(function (sec, idx) {
                var start = starts[idx];
                var nextStart = (idx + 1 < starts.length) ? starts[idx + 1] : (numPages + 1);
                var end = Math.max(start, nextStart - 1);
                return { section: sec, startPage: start, endPage: Math.min(end, numPages) };
            });
        });
    }

    return {
        ensurePdfJsLoaded: ensurePdfJsLoaded,
        downloadDriveFileAsArrayBuffer: downloadDriveFileAsArrayBuffer,
        loadPdfDocumentFromDrive: loadPdfDocumentFromDrive,
        detectBlankCandidates: detectBlankCandidates,
        detectBlankCountsByLabel: detectBlankCountsByLabel,
        detectBlankReviewStats: detectBlankReviewStats,
        buildSplitReview: buildSplitReview,
        autoAssignBoxesInOrder: autoAssignBoxesInOrder,
        detectSectionPageRanges: detectSectionPageRanges,
        parseAnswerText: parseAnswerText,
        repairStaleCommaSplits: repairStaleCommaSplits,
        makeKey: makeKey,
        itemLabel: itemLabel,
        buildGradingPaper: buildGradingPaper,
        groupItemsBySection: groupItemsBySection,
        computeSectionStats: computeSectionStats,
        buildSectionAnswersFromBoxes: buildSectionAnswersFromBoxes,
        buildAnswersFromBoxesBySection: buildAnswersFromBoxesBySection
    };
})();

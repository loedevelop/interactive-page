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
    var SECTION_HEADER_RE = /^(Quiz\s*\d+|Chapter\s*\d+|Unit\s*\d+|Part\s+[A-Za-z0-9]+|Section\s*\d+|Lesson\s*\d+|第\s*[一二三四五六七八九十\d]+\s*[大課單元部分節])/i;
    var ITEM_MARKER_RE = /(\d+)\.\s*/g;
    var AB_LINE_RE = /^([A-Za-z]):\s*(.*)$/;
    var OR_LEAD_RE = /^OR\b[\s:]*\s*(.*)$/i;
    var TRAILING_OR_RE = /\bOR\s*$/i;

    function stripTrailingOr(text) {
        var endsWithOr = TRAILING_OR_RE.test(text);
        return { text: endsWithOr ? text.replace(TRAILING_OR_RE, '').trim() : text, endsWithOr: endsWithOr };
    }

    /**
     * 💣 這裡的「question-swap」是解析器唯一的特殊判斷：像 Quiz 3 那種「問句換行接答句」的格式，
     * 第一個抓到的片段常常其實是題目（以「?」結尾），緊接著才是真正的答案。若目前所有已收集的
     * 片段都像問句、而新片段不是問句，就把新片段挪到最前面當「主答案」（answer_text），問句本身
     * 留在 accepted_answers 當無害的殘留（老師確認清單時可以刪掉）。上一行若以 OR 結尾，代表下一行
     * 是「同一個答案的另一種說法」，直接併入，不要再套用這個問句判斷。
     */
    function addContinuationFragment(item, rawText) {
        var stripped = stripTrailingOr(String(rawText || '').trim());
        var text = stripped.text;
        if (!text) { item._pendingOr = stripped.endsWithOr; return; }
        if (item._pendingOr) {
            item.fragments.push(text);
        } else {
            var allQuestion = item.fragments.length > 0 && item.fragments.every(isQuestionLike);
            if (allQuestion && !isQuestionLike(text)) item.fragments.unshift(text);
            else item.fragments.push(text);
        }
        item._pendingOr = stripped.endsWithOr;
    }

    /**
     * 寬鬆解析老師貼的解答原始文字，回傳扁平陣列：
     * [{ key, section, item_no, part, answer_text, accepted_answers[] }]
     * key = "section::item_no::part"（part 可為 null），用來跟畫框時選的題目一一對應。
     */
    function parseAnswerText(raw) {
        var lines = String(raw || '').split(/\r?\n/);
        var items = [];
        var currentSection = '(未分類)';
        var last = null;

        lines.forEach(function (rawLine) {
            var line = rawLine.trim();
            if (!line) return; // 空行不中斷 continuation（同大題內常見排版空行）

            var secMatch = line.match(SECTION_HEADER_RE);
            if (secMatch && !/^\d+\./.test(line)) {
                currentSection = normalizeSectionLabel(secMatch[1]);
                last = null;
                return;
            }

            ITEM_MARKER_RE.lastIndex = 0;
            var matches = [];
            var m;
            while ((m = ITEM_MARKER_RE.exec(line))) {
                matches.push({ no: m[1], start: m.index, textStart: m.index + m[0].length });
            }

            if (matches.length) {
                for (var i = 0; i < matches.length; i++) {
                    var seg = matches[i];
                    var endIdx = (i + 1 < matches.length) ? matches[i + 1].start : line.length;
                    var text = line.slice(seg.textStart, endIdx).trim();
                    var part = null;
                    var abMatch = text.match(AB_LINE_RE);
                    if (abMatch) { part = abMatch[1].toUpperCase(); text = abMatch[2]; }
                    var strippedFirst = stripTrailingOr(text);
                    var item = {
                        section: currentSection,
                        itemNo: seg.no,
                        part: part,
                        fragments: strippedFirst.text ? [strippedFirst.text] : [],
                        _pendingOr: strippedFirst.endsWithOr
                    };
                    items.push(item);
                    last = item;
                }
                return;
            }

            var abOnly = line.match(AB_LINE_RE);
            if (abOnly && last) {
                var strippedAb = stripTrailingOr(abOnly[2].trim());
                var newItem = {
                    section: last.section,
                    itemNo: last.itemNo,
                    part: abOnly[1].toUpperCase(),
                    fragments: strippedAb.text ? [strippedAb.text] : [],
                    _pendingOr: strippedAb.endsWithOr
                };
                items.push(newItem);
                last = newItem;
                return;
            }

            var orOnly = line.match(OR_LEAD_RE);
            if (orOnly && last) {
                last.fragments.push(orOnly[1].trim());
                last._pendingOr = false;
                return;
            }

            if (last) addContinuationFragment(last, line);
        });

        var flat = items.map(function (it) {
            var fragments = it.fragments.length ? it.fragments : [''];
            return {
                key: makeKey(it.section, it.itemNo, it.part),
                section: it.section,
                item_no: it.itemNo,
                part: it.part,
                answer_text: fragments[0],
                accepted_answers: fragments.slice(1).filter(function (f) { return f && f !== fragments[0]; })
            };
        });

        // 💣 老師/OCR 常把答案「一行擠兩題」抄寫（例如 "2. been 10. stopped"），純粹是為了省紙／
        // 省空間，不代表考卷本身的版面順序——考卷通常還是單欄由上到下 1,2,3...N。若照文字出現
        // 順序直接拿去跟考卷上偵測到的空格做「位置保險配對」，會整批對錯（空格#2 對到「第10題」的
        // 答案）。這裡依「大題第一次出現的順序」為主排序、大題內再依題號數字＋子項字母排序，
        // 讓 bank 的順序回到考卷最常見的「由上到下、由小到大」排列，位置配對才準。
        var sectionOrder = [];
        flat.forEach(function (it) { if (sectionOrder.indexOf(it.section) === -1) sectionOrder.push(it.section); });
        flat.sort(function (a, b) {
            var sa = sectionOrder.indexOf(a.section), sb = sectionOrder.indexOf(b.section);
            if (sa !== sb) return sa - sb;
            var na = parseInt(a.item_no, 10), nb = parseInt(b.item_no, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            if (a.item_no !== b.item_no) return String(a.item_no).localeCompare(String(b.item_no));
            return String(a.part || '').localeCompare(String(b.part || ''));
        });
        return flat;
    }

    function makeKey(section, itemNo, part) {
        return String(section || '') + '::' + String(itemNo || '') + (part ? ('::' + part) : '');
    }

    function itemLabel(it) {
        return String((it && it.section) || '') + ' 第' + String((it && it.item_no) || '') + '題' + ((it && it.part) ? ('-' + it.part) : '');
    }

    /** 供批改重用：把 pdf_exam_job.parsed_bank[]（老師確認過的答案清單）轉成
     * QuizPaperBuilder.gradeAnswers 看得懂的 paper 結構。改版後定位由學生自己點，
     * 不再需要老師畫框的 items[]，批改只看答案清單本身。 */
    function buildGradingPaper(job) {
        var list = (job && Array.isArray(job.parsed_bank)) ? job.parsed_bank : [];
        return {
            items: list.map(function (it, idx) {
                return {
                    item_id: it.key || makeKey(it.section, it.item_no, it.part),
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
     * 回傳：[{ section, startPage, endPage }, ...]（依 bank 裡大題第一次出現的順序）
     */
    function detectSectionPageRanges(pdfDoc, bank) {
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
        return pageNums.reduce(function (chain, pageNum) {
            return chain.then(function () {
                return pdfDoc.getPage(pageNum).then(function (page) {
                    return page.getTextContent().then(function (tc) {
                        var lines = {};
                        (tc.items || []).forEach(function (ti) {
                            var y = Math.round(ti.transform[5] / 3) * 3; // 粗略分行，容忍小數點誤差
                            (lines[y] = lines[y] || []).push(ti.str);
                        });
                        Object.keys(lines).forEach(function (y) {
                            var lineText = lines[y].join(' ').replace(/\s+/g, ' ').trim();
                            var secMatch = lineText.match(SECTION_HEADER_RE);
                            var candidate = secMatch ? normalizeSectionLabel(secMatch[1]) : null;
                            sectionOrder.forEach(function (sec, idx) {
                                if (foundPage[sec] != null) return; // 只記第一次出現
                                if (candidate && normFuzzy(candidate) === fuzzyTargets[idx]) {
                                    foundPage[sec] = pageNum;
                                }
                            });
                        });
                    });
                });
            });
        }, Promise.resolve()).then(function () {
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
        autoAssignBoxesInOrder: autoAssignBoxesInOrder,
        detectSectionPageRanges: detectSectionPageRanges,
        parseAnswerText: parseAnswerText,
        makeKey: makeKey,
        itemLabel: itemLabel,
        buildGradingPaper: buildGradingPaper,
        groupItemsBySection: groupItemsBySection,
        computeSectionStats: computeSectionStats
    };
})();

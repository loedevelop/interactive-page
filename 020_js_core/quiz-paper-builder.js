/**
 * 📂 020_js_core/quiz-paper-builder.js
 * 依 exam_job 區段 + meta 列 + _layout.fields 公式 → 產生線上卷 quiz_paper
 */
window.QuizPaperBuilder = (function () {
    'use strict';

    /**
     * 尚未寫入 _layout.col_map 時的保守預設（GEPT sentence 常見）。
     * 2026-08-08：這裡的 `X: 'script'` 故意保留不改——這是舊教材（沒有 col_map／沒有
     * quiz_prompt/quiz_answer 公式）的相容 fallback，已經發布的舊 meta.json 真的用
     * 'script' 當 semantic_key，改掉這裡會讀不到那些舊教材的答案欄。新教材的欄位名稱
     * 建議清單已經在 feature-material-layout-pairing.js 的 SEMANTIC_KEY_SEED 改成
     * 'answer_en'（避免跟「口說答案」/script.txt 概念撞名），但那只影響「新教材選什麼
     * 名字」，不影響這裡讀舊資料的相容邏輯。
     */
    const FALLBACK_COL_MAP = {
        D: 'sheet_id',
        E: 'page',
        C: 'item_no',
        Y: 'display_zh',
        X: 'script',
        BA: 'blank_1',
        BB: 'blank_2',
        BC: 'blank_1_zh',
        BD: 'blank_2_zh'
    };

    function toNum(v) {
        if (v == null || v === '') return NaN;
        const n = Number(String(v).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? NaN : n;
    }

    function normalizeAnswer(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[’‘]/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/[.,!?;:]+$/g, '')
            .trim();
    }

    /**
     * 中央可接受答案白名單（2026-08-11 新增，見「錯題申訴」規劃）：常見英文縮寫等價形式，
     * 雙向都算對——寫 "I am" 或 "I'm" 都不該被判錯，不需要老師/助教一個個手動加
     * accepted_answers 或等學生申訴才補。每組 [完整形式, 縮寫形式]，皆為已 normalizeAnswer
     * 過的小寫字串。之後如需擴充，直接在這個陣列加一組即可（尚未開放老師自行增補）。
     */
    const EQUIVALENCE_PAIRS = [
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

    /**
     * 對一個（已 normalizeAnswer 過的）字串，套用中央白名單雙向整詞替換，回傳所有算出來
     * 的等價變體（不含輸入本身、去重）。用整字邊界 \b 避免誤傷（例如 "isn't" 不該影響
     * "wasn't"），且只針對每組配對各替換一次、不做多組疊加排列組合——答案通常很短，
     * 這樣已經夠涵蓋常見情境，也避免變體數量爆炸。
     */
    function expandWithEquivalents(normalized) {
        const src = String(normalized || '');
        if (!src) return [];
        const variants = {};
        EQUIVALENCE_PAIRS.forEach(function (pair) {
            const full = pair[0];
            const short = pair[1];
            const fullRe = new RegExp('\\b' + full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
            const shortRe = new RegExp('\\b' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]") + '\\b', 'g');
            if (fullRe.test(src)) {
                const v = src.replace(fullRe, short);
                if (v !== src) variants[v] = true;
            }
            if (shortRe.test(src)) {
                const v = src.replace(shortRe, full);
                if (v !== src) variants[v] = true;
            }
        });
        delete variants[src];
        return Object.keys(variants);
    }

    /**
     * 💣 雷區（2026-08-11 老師回報「to/a 顯示成 to a」「say(s) - said - said - saying 被拆散」）：
     * 只用來給答錯時的對比顯示（analyzeAnswerDiff／alignTokens／renderAnswerDiffHtml）分詞，
     * 不影響對錯判定本身（判定是 normalizeAnswer 整串比對，不拆字）。以前用
     * `[^a-z0-9']+` 排除法分詞，會把 `/`、`-`、`(`、`)` 這些答案裡常見的合法符號也當成
     * 斷詞邊界切開，重組顯示時符號就消失了，讓老師誤以為系統連對錯都判斷錯了。
     * 改成只依「空白」分詞，符號留在單字裡（跟 normalizeAnswer 一致，只做小寫／壓空白）。
     */
    function tokenizeWords(s) {
        const n = normalizeAnswer(s);
        if (!n) return [];
        return n.split(/\s+/).filter(Boolean);
    }

    /**
     * LCS 對齊後合併相鄰 del+ins → sub
     * @returns {{ type: 'match'|'sub'|'del'|'ins', expected: string, got: string }[]}
     */
    function alignTokens(expTokens, actTokens) {
        const exp = expTokens || [];
        const act = actTokens || [];
        const m = exp.length;
        const n = act.length;
        const dp = [];
        for (let i = 0; i <= m; i++) {
            dp[i] = [];
            for (let j = 0; j <= n; j++) dp[i][j] = 0;
        }
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = exp[i - 1] === act[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
        const raw = [];
        let i = m;
        let j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && exp[i - 1] === act[j - 1]) {
                raw.push({ type: 'match', expected: exp[i - 1], got: act[j - 1] });
                i -= 1;
                j -= 1;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                raw.push({ type: 'ins', expected: '', got: act[j - 1] });
                j -= 1;
            } else {
                raw.push({ type: 'del', expected: exp[i - 1], got: '' });
                i -= 1;
            }
        }
        raw.reverse();
        const ops = [];
        for (let k = 0; k < raw.length; k++) {
            if (raw[k].type === 'del' && raw[k + 1] && raw[k + 1].type === 'ins') {
                ops.push({ type: 'sub', expected: raw[k].expected, got: raw[k + 1].got });
                k += 1;
            } else {
                ops.push(raw[k]);
            }
        }
        return ops;
    }

    /**
     * 錯題分析：拼錯對（應打／誤打）+ 對齊 ops（供紅線刪除顯示）
     */
    function analyzeAnswerDiff(expected, got) {
        const exp = tokenizeWords(expected);
        const act = tokenizeWords(got);
        const ops = alignTokens(exp, act);
        const spelling_pairs = [];
        ops.forEach(function (op) {
            if (op.type === 'sub') {
                spelling_pairs.push({
                    expected_word: op.expected,
                    got_word: op.got,
                    kind: 'wrong'
                });
            } else if (op.type === 'del') {
                spelling_pairs.push({
                    expected_word: op.expected,
                    got_word: '',
                    kind: 'missing'
                });
            } else if (op.type === 'ins') {
                spelling_pairs.push({
                    expected_word: '',
                    got_word: op.got,
                    kind: 'extra'
                });
            }
        });
        return {
            expected_tokens: exp,
            answer_tokens: act,
            ops: ops,
            spelling_pairs: spelling_pairs
        };
    }

    /** @deprecated 保留舊名，轉呼叫 analyzeAnswerDiff */
    function analyzeWrongWords(expected, got) {
        return analyzeAnswerDiff(expected, got);
    }

    /**
     * 解析「141~145,150」「141-145, 150」這類題號清單／範圍字串。
     * 💣 雷區：ASCII 半形 "-" 曾未被當範圍分隔符號，"141-160" 會整段解析失敗
     * 變成「有填但沒抽到任何題號」的空集合，害「可用題」誤判為 0（老師分不出
     * 是真的沒題，還是輸入格式沒吃到）。這裡把數字與數字之間的 "-" 也視同 "~"。
     */
    function parseNumList(raw) {
        const text = String(raw || '').trim();
        if (!text) return null;
        const normalized = text
            .replace(/[～〜－—–]/g, '~')
            .replace(/(\d)\s*-\s*(\d)/g, '$1~$2');
        const set = {};
        normalized.split(/[,，、\s]+/).forEach(function (part) {
            const p = String(part || '').trim();
            if (!p) return;
            const m = p.match(/^(\d+)\s*~\s*(\d+)$/);
            if (m) {
                let a = Number(m[1]);
                let b = Number(m[2]);
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) set[i] = true;
                return;
            }
            const n = toNum(p);
            if (!isNaN(n)) set[n] = true;
        });
        return set;
    }

    function shuffleInPlace(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    }

    function resolveColMap(layout, schemaId) {
        if (!layout) return Object.assign({}, FALLBACK_COL_MAP);
        if (schemaId && layout.col_maps && layout.col_maps[schemaId]) {
            return Object.assign({}, FALLBACK_COL_MAP, layout.col_maps[schemaId]);
        }
        if (layout.col_map && typeof layout.col_map === 'object') {
            return Object.assign({}, FALLBACK_COL_MAP, layout.col_map);
        }
        return Object.assign({}, FALLBACK_COL_MAP);
    }

    function pickProfile(layout, profileId) {
        const profiles = (layout && Array.isArray(layout.profiles)) ? layout.profiles : [];
        if (!profiles.length) return null;
        const want = String(profileId || '').trim();
        if (want) {
            const hit = profiles.find(function (p) {
                return String(p.profile_id || '') === want;
            });
            if (hit) return hit;
        }
        const defId = layout.default_profile_id;
        if (defId) {
            const hit2 = profiles.find(function (p) {
                return String(p.profile_id || '') === String(defId);
            });
            if (hit2) return hit2;
        }
        return profiles[0];
    }

    /**
     * 範圍（pool）只由 start／end（或 pages／items／range_spec）決定。
     * 💣 雷區：include_nums（必考#）不可再拿來「縮小範圍」──它的語意是
     * 「這幾題保證出現」，範圍外的題號本來就抽不到，不該影響 pool 大小。
     * 見 .cursor/rules/exam-available-count-invariant.mdc。
     */
    function filterRowsForSection(rows, section) {
        const rtype = section.range_type || 'page';
        const lo = Math.min(Number(section.start), Number(section.end));
        const hi = Math.max(Number(section.start), Number(section.end));
        const exclude = parseNumList(section.exclude_nums);
        const sheet = String(section.sheet_id || '').trim().toUpperCase();

        // 不連續頁／題（來自 range_spec pp. 1~2, 5）時優先用明確集合
        let pageSet = null;
        let itemSet = null;
        if (rtype === 'page' && Array.isArray(section.pages) && section.pages.length) {
            pageSet = {};
            section.pages.forEach(function (p) {
                const n = Number(p);
                if (!isNaN(n)) pageSet[n] = true;
            });
        }
        if (rtype === 'qnum' && Array.isArray(section.items) && section.items.length) {
            itemSet = {};
            section.items.forEach(function (n) {
                const v = Number(n);
                if (!isNaN(v)) itemSet[v] = true;
            });
        }

        return (rows || []).filter(function (row) {
            if (!row) return false;
            // 若列上有 sheet_id，與區段不一致則略過
            const rowSheet = String(row.sheet_id || row.stem || '').trim().toUpperCase();
            if (rowSheet && sheet && rowSheet !== sheet) return false;

            const itemNo = toNum(row.item_no);
            const page = toNum(row.page);

            if (exclude && !isNaN(itemNo) && exclude[itemNo]) return false;

            if (rtype === 'qnum') {
                if (isNaN(itemNo)) return false;
                if (itemSet) return !!itemSet[itemNo];
                return itemNo >= lo && itemNo <= hi;
            }
            if (rtype === 'row') {
                // 尚無穩定 row_id 時：先不篩（由 count 抽）
                return true;
            }
            // page
            if (isNaN(page)) return false;
            if (pageSet) return !!pageSet[page];
            return page >= lo && page <= hi;
        });
    }

    function inferQuizMode(profileId, fieldsAnswer) {
        const id = String(profileId || '').toLowerCase();
        if (id.indexOf('cloze') !== -1 || id.indexOf('fill') !== -1) return 'cloze';
        if (fieldsAnswer && /SUBSTITUTE/i.test(fieldsAnswer)) return 'cloze';
        return 'full_sentence';
    }

    function cellsToPlain(cells) {
        return (cells || []).map(function (c) {
            return {
                text: c && c.text != null ? String(c.text) : '',
                fontDelta: c && c.fontDelta ? Number(c.fontDelta) || 0 : 0
            };
        });
    }

    /**
     * 中央白名單 bake-in：產生線上卷當下，把「完整形式／縮寫」等價變體直接寫進
     * accepted_answers（而不是每次批改都動態展開），老師在「考試批改」畫面本來就能
     * 看到這些是白名單自動加入的（跟老師自己按「+ 新增可接受答案」加的長一樣，沒有
     * 特殊標記——這是刻意的，維持既有 UI 不用另外分辨來源）。answerEn 開頭若是大寫，
     * 變體也跟著首字大寫，避免全部變成小寫看起來不像正常英文。
     */
    function equivalentAcceptedSeed(answerEn) {
        const norm = normalizeAnswer(answerEn);
        if (!norm) return [];
        const variants = expandWithEquivalents(norm);
        const wasCapitalized = /^[A-Z]/.test(String(answerEn || '').trim());
        return variants.map(function (v) {
            return (wasCapitalized && v) ? (v.charAt(0).toUpperCase() + v.slice(1)) : v;
        });
    }

    function buildItemFromRow(row, opts) {
        const Eval = window.LayoutFieldsEval;
        if (!Eval) throw new Error('LayoutFieldsEval 未載入');
        const sheet = String(opts.sheetId || row.sheet_id || '').trim().toUpperCase() || '?';
        const page = toNum(row.page);
        const itemNo = toNum(row.item_no);
        const folder = opts.materialFolder || '';
        const itemId = [folder || 'bank', sheet, isNaN(page) ? 'p' : page, isNaN(itemNo) ? 'i' : itemNo].join(':');

        /**
         * 💣 雷區：fields／fields_answer／quizPrompt／quizAnswer 公式字串來自
         * layout_profile（可能是沒填過的占位公式，例如 LAYOUT_CATALOG 的
         * vocab-no-image／vocab-with-image 目前還沒有真正的公式，見 feature-exam-job.js
         * 的 LAYOUT_FIELD_HINTS 註解）。這裡不能讓 evaluateFields 對這種占位/壞公式
         * 直接丟例外——那會讓「沒有 _layout.json、也沒設定過公式」的教材整份考卷產生
         * 失敗，而不是「這題排版空一點但至少有題目跟答案」。所以全部包 try/catch，
         * 失敗就當作沒算出東西（cells=[]／promptZh／answerEn 留空），交給下面的
         * 具名欄位 fallback 補上。
         */
        function safeEvalFields(formula) {
            if (!formula) return [];
            try { return cellsToPlain(Eval.evaluateFields(formula, row, opts.colMap)); }
            catch (_evalErr) { return []; }
        }

        const cells = safeEvalFields(opts.fields || '');
        let cellsAnswer = null;
        if (opts.fieldsAnswer) cellsAnswer = safeEvalFields(opts.fieldsAnswer);

        /**
         * 💣 雷區（見 .cursor/rules/material-publish-setup-format.mdc）：
         * fields／fields_answer 是「印刷排版」多欄並排公式（欄位數與順序依教材而定，
         * 例如 vocab 五欄：書名/頁/題號/中文/詞性），不能拿 cells[1]/cells[2] 位置去
         * 猜「線上卷的提示／答案」——那只對 GEPT 句子翻譯（固定3欄）恰好成立，換成
         * 其他教材（如 vocab）位置一換就整份考卷內容全錯（曾發生：提示變頁碼、答案變題號）。
         * 正確做法：_Layout 另開 quiz_prompt／quiz_answer（單一輸出公式，用 semantic_key），
         * 專門給線上卷用；沒填才退回舊的 cells[1]/cells[2] 慣例（相容舊 GEPT 教材）。
         */
        let promptZh;
        let answerEn;
        if (opts.quizPrompt) {
            const promptCells = safeEvalFields(opts.quizPrompt);
            promptZh = promptCells.map(function (c) { return c.text; }).filter(Boolean).join(' ');
        }

        /**
         * 💣 雷區（2026-08-11 老師回報「正確答案只有前置詞，沒有英文單字那欄」——答案結合
         * 公式形同虛設）：`_answer_mode === 'combine'` 是老師在 Layout Template 明確設定過
         * 「書寫答案有多欄，要用 answer_combine_note 公式（例如 AN&" "&AO）結合」，算出來、
         * 也允許逐列修正的最終值（row._answer_combined_text），**優先權必須最高**。
         * 之前這段寫在 `opts.quizAnswer` / cells[2] 舊慣例 fallback 之後，且用 `if (!answerEn)`
         * 卡門——只要舊版 quiz_answer／fields 公式（通常只認得單一欄，例如只挑到 AN 這欄）
         * 先算出任何非空字串，answerEn 就已經「有值」，下面整段 combine 判斷直接被跳過，
         * 導致學生看到／用來批改的「正確答案」只有 AN（前置詞），完全漏掉 AO（動詞變化）。
         * 現在改成：combine 模式一律優先讀 _answer_combined_text，其餘 quiz_answer／cells[2]／
         * row.answer_en 都退到後面當 fallback，且只在「非 combine 模式」或「combine 但沒算出
         * 結合值」時才會用到。
         */
        if (row._answer_mode === 'combine' && row._answer_combined_text != null && String(row._answer_combined_text).trim() !== '') {
            answerEn = String(row._answer_combined_text).trim();
        } else if (row._answer_mode === 'combine' && Array.isArray(row._answer_keys) && row._answer_keys.length > 1) {
            answerEn = row._answer_keys.map(function (key) { return String(row[key] || '').trim(); })
                .filter(Boolean).join(' ');
        }
        if (!answerEn && opts.quizAnswer) {
            const answerCells = safeEvalFields(opts.quizAnswer);
            answerEn = answerCells.map(function (c) { return c.text; }).filter(Boolean).join(' ');
        }
        // 舊慣例（相容無 quiz_prompt／quiz_answer 的教材）：第2欄提示（Y）、第3欄英文答案（X）
        if (!promptZh) promptZh = (cells[1] && cells[1].text) || String(row.display_zh || '').trim();
        if (!answerEn) answerEn = (cells[2] && cells[2].text) || String(row.script || '').trim();
        let clozeStem = '';
        if (opts.quizMode === 'cloze' && cellsAnswer && cellsAnswer[1]) {
            clozeStem = cellsAnswer[1].text || '';
        }

        // 'separate' 模式的合併預覽字串要靠下面 subAnswers 那段算（逐欄各自的值），這裡先不要
        // 用單欄 row.answer_en 卡位，否則下面 `if (!answerEn)` 會被誤判成「已經有了」而跳過。
        if (!answerEn && row._answer_mode !== 'separate') answerEn = String(row.answer_en || '').trim();

        /**
         * 「分開比對」多空格：書寫答案欄數>1且老師選「分開比對」時，_answer_keys 各自
         * 獨立比對——這裡把每個 _answer_keys 各自的原始值拆成一個 sub_answers 元素，
         * 一題多個空格、各自獨立比對，跟上面「單一 answer_en 整句比對」是兩條並存的路徑，
         * 不影響既有教材（沒有 _answer_mode 的列完全走舊路徑）。answer_en 仍會補上一個
         * 「合併預覽」字串，供舊版只認 answer_en 的畫面（例如老師端答案訂正列表）當退路
         * 顯示，但實際批改一律用 sub_answers。
         */
        let subAnswers = null;
        if (row._answer_mode === 'separate' && Array.isArray(row._answer_keys) && row._answer_keys.length > 1) {
            subAnswers = row._answer_keys.map(function (key) {
                const subAnswerEn = String(row[key] || '').trim();
                return { key: key, label: key, answer_en: subAnswerEn, accepted_answers: equivalentAcceptedSeed(subAnswerEn) };
            });
            if (!answerEn) answerEn = subAnswers.map(function (sa) { return sa.answer_en; }).filter(Boolean).join(' ');
        }

        return {
            item_id: itemId,
            seq: 0,
            quiz_mode: opts.quizMode || 'full_sentence',
            prompt_zh: promptZh,
            answer_en: answerEn,
            cloze_stem: clozeStem,
            accepted_answers: equivalentAcceptedSeed(answerEn),
            sub_answers: subAnswers,
            cells: cells,
            cells_answer: cellsAnswer,
            source: {
                material_folder: folder,
                sheet_id: sheet,
                page: isNaN(page) ? null : page,
                item_no: isNaN(itemNo) ? null : itemNo,
                schema_id: opts.schemaId || '',
                layout_profile_id: opts.layoutProfileId || ''
            }
        };
    }

    /**
     * @param {object} args
     * @param {object} args.examJob
     * @param {object} args.layout  _layout.json 物件
     * @param {function(sheetId):Promise<{rows:array, schemaId?:string, materialFolder?:string}>} args.loadSheetMeta
     * @returns {Promise<object>} quiz_paper
     */
    async function buildQuizPaper(args) {
        const examJob = args.examJob || {};
        const layout = args.layout || {};
        const loadSheetMeta = args.loadSheetMeta;
        if (typeof loadSheetMeta !== 'function') throw new Error('缺少 loadSheetMeta');

        // 整份考卷的預設 layout（多數情況所有區段都用這個，維持既有行為／既有匯出格式不變）
        const defaultProfile = pickProfile(layout, examJob.layout_profile_id);
        // 2026-08-07 修正：下面 return 組「整份考卷摘要」用的 layout 欄位必須用這幾個
        // defaultXxx（作用域在函式頂層，迴圈結束後仍存在）——不能用迴圈內每個區段自己算的
        // profile/fields/fieldsAnswer/quizPrompt/quizAnswer（那幾個是 for 迴圈內的 const，
        // 迴圈跑完就脫離作用域，return 裡引用會直接丟 ReferenceError: profile is not defined，
        // 每個區段成功跑完都會炸，跟是否「沿用上方預設」無關）。每題實際用的 profile 早就
        // 正確存在 item.source.layout_profile_id（迴圈內算的，見下面 buildItemFromRow 呼叫）。
        const defaultFields = (defaultProfile && defaultProfile.fields) || args.fields || '';
        const defaultFieldsAnswer = (defaultProfile && (defaultProfile.fields_answer || defaultProfile.answer_fields)) || args.fieldsAnswer || '';
        const defaultQuizPrompt = (defaultProfile && defaultProfile.quiz_prompt) || args.quizPrompt || '';
        const defaultQuizAnswer = (defaultProfile && defaultProfile.quiz_answer) || args.quizAnswer || '';
        const shuffle = !(examJob.options && examJob.options.shuffle === false);

        const sections = Array.isArray(examJob.sections) ? examJob.sections : [];
        if (!sections.length) throw new Error('exam_job 沒有區段');

        const picked = [];
        const metaCache = {};
        const notices = [];

        for (let sIdx = 0; sIdx < sections.length; sIdx++) {
            const sec = sections[sIdx] || {};
            const sheetId = String(sec.sheet_id || '').trim().toUpperCase();
            if (!sheetId) throw new Error('區段 ' + (sIdx + 1) + ' 缺少 sheet_id');

            if (!metaCache[sheetId]) {
                metaCache[sheetId] = await loadSheetMeta(sheetId);
            }
            const pack = metaCache[sheetId] || {};
            const rows = Array.isArray(pack.rows) ? pack.rows : [];
            const schemaId = pack.schemaId || '';
            const materialFolder = pack.materialFolder || layout.material_folder || '';
            const colMap = resolveColMap(layout, schemaId);

            /**
             * 💣 雷區（見 material-layout-pairing-invariant.mdc）：同一活頁（同一份 meta 檔）
             * 可能需要套用不只一個 layout（例如同一份單字表同時要「整句翻譯」＋「單字無圖」）。
             * 正確做法：1 個 meta 檔＋2 個區段，各自的 sec.layout_profile_id 各設一個；
             * 不是複製 meta 檔、也不是在同一個區段塞兩個 layout_profile_id。
             * 這裡改成逐區段解析 profile（沒設就沿用 examJob.layout_profile_id），
             * 讓同一活頁的兩個區段各自吃到自己的 fields／quiz_prompt／quiz_answer。
             */
            const profile = sec.layout_profile_id ? pickProfile(layout, sec.layout_profile_id) : defaultProfile;
            const fields = (profile && profile.fields) || args.fields || '';
            if (!fields) throw new Error('區段 ' + (sIdx + 1) + '（活頁 ' + sheetId + '）的 layout 缺少 fields 公式（請確認 _layout.json 或該區段的 layout_profile_id）');
            const fieldsAnswer = (profile && (profile.fields_answer || profile.answer_fields)) || args.fieldsAnswer || '';
            const quizPrompt = (profile && profile.quiz_prompt) || args.quizPrompt || '';
            const quizAnswer = (profile && profile.quiz_answer) || args.quizAnswer || '';
            const quizMode = inferQuizMode(profile && profile.profile_id, fieldsAnswer);

            let pool = filterRowsForSection(rows, sec);
            if (!pool.length) {
                throw new Error('活頁 ' + sheetId + ' 在範圍內沒有可用題（' +
                    (sec.range_type || 'page') + ' ' + sec.start + '~' + sec.end + '）');
            }

            // 必考題（include_nums）：從 pool 內挑出保證入選，其餘題數才隨機補。
            const includeSet = parseNumList(sec.include_nums);
            let mandatoryRows = [];
            let restPool = pool;
            if (includeSet) {
                mandatoryRows = pool.filter(function (row) {
                    const n = toNum(row.item_no);
                    return !isNaN(n) && includeSet[n];
                });
                restPool = pool.filter(function (row) {
                    const n = toNum(row.item_no);
                    return isNaN(n) || !includeSet[n];
                });
                const foundNos = {};
                mandatoryRows.forEach(function (row) { foundNos[toNum(row.item_no)] = true; });
                const missingNos = Object.keys(includeSet).filter(function (n) { return !foundNos[n]; });
                if (missingNos.length) {
                    throw new Error('活頁 ' + sheetId + ' 指定必考題號 ' + missingNos.join(',') +
                        ' 不在範圍 ' + (sec.range_type || 'page') + ' ' + sec.start + '~' + sec.end + ' 內，請確認');
                }
            }

            if (shuffle) restPool = shuffleInPlace(restPool.slice());
            const want = Math.max(0, Number(sec.count) || 0);
            const fillWant = want > 0 ? Math.max(0, want - mandatoryRows.length) : restPool.length;
            const filled = restPool.slice(0, Math.min(fillWant, restPool.length));
            const take = mandatoryRows.concat(filled);
            if (want > 0 && mandatoryRows.length > want) {
                notices.push('活頁 ' + sheetId + ' 必考題號共 ' + mandatoryRows.length +
                    ' 題，已超過設定題數 ' + want + '，已自動全部納入（實際 ' + mandatoryRows.length + ' 題）');
            }

            take.forEach(function (row) {
                // 確保 sheet_id 在列上（若 Excel 有 D 欄會已有；否則補上）
                const row2 = Object.assign({}, row);
                if (!row2.sheet_id) row2.sheet_id = sheetId;
                picked.push(buildItemFromRow(row2, {
                    sheetId: sheetId,
                    materialFolder: materialFolder,
                    schemaId: schemaId,
                    fields: fields,
                    fieldsAnswer: fieldsAnswer,
                    quizPrompt: quizPrompt,
                    quizAnswer: quizAnswer,
                    colMap: colMap,
                    quizMode: quizMode,
                    layoutProfileId: (profile && profile.profile_id) || examJob.layout_profile_id || ''
                }));
            });
        }

        if (shuffle) shuffleInPlace(picked);
        picked.forEach(function (it, idx) {
            it.seq = idx + 1;
        });

        return {
            kind: 'quiz_paper',
            generated_at: new Date().toISOString(),
            spec_ref: {
                job_id: examJob.job_id || '',
                bank_id: examJob.bank_id || '',
                layout_profile_id: (defaultProfile && defaultProfile.profile_id) || examJob.layout_profile_id || ''
            },
            layout: {
                profile_id: (defaultProfile && defaultProfile.profile_id) || '',
                label: (defaultProfile && defaultProfile.label) || '',
                fields: defaultFields,
                fields_answer: defaultFieldsAnswer || '',
                quiz_prompt: defaultQuizPrompt || '',
                quiz_answer: defaultQuizAnswer || '',
                lines_per_page: (defaultProfile && defaultProfile.lines_per_page) || 10
            },
            items: picked,
            notices: notices
        };
    }

    /**
     * 對錯判定的「動態白名單防呆」：直接比對沒過，再展開中央白名單（EQUIVALENCE_PAIRS）
     * 雙向比對一次。涵蓋兩種情況：(1) 舊考卷產生時還沒有 bake-in accepted_answers；
     * (2) 白名單之後又新增了配對，但這份線上卷還沒重新產生——都不必逼老師重新出考卷。
     * 一般情況（已 bake-in）直接命中 okList，不會走到這裡，效能沒有額外負擔。
     */
    function isAcceptableAnswer(gotN, okList) {
        if (gotN === '') return false;
        if (okList.indexOf(gotN) !== -1) return true;
        const gotVariants = expandWithEquivalents(gotN);
        for (let i = 0; i < gotVariants.length; i++) {
            if (okList.indexOf(gotVariants[i]) !== -1) return true;
        }
        for (let j = 0; j < okList.length; j++) {
            if (expandWithEquivalents(okList[j]).indexOf(gotN) !== -1) return true;
        }
        return false;
    }

    /**
     * 一題多空格（分開比對）：got 是 { [sub_key]: string } 物件，每個空格各自跟自己的
     * answer_en／accepted_answers 比對，全部空格都對才算這一題對。回傳形狀跟單答案題一致
     * （answer/expected 是合併後字串，供既有畫面顯示／diff），另外多帶 sub_results 給之後
     * 要做逐空格顯示的畫面用（目前先沿用合併 diff，不逐空格標色）。
     */
    function gradeSubAnswerItem(it, got) {
        const gotObj = (got && typeof got === 'object') ? got : {};
        let allOk = true;
        const subResults = it.sub_answers.map(function (sa) {
            const g = normalizeAnswer(gotObj[sa.key]);
            const okList = [sa.answer_en].concat(sa.accepted_answers || []).map(normalizeAnswer).filter(Boolean);
            const ok = isAcceptableAnswer(g, okList);
            if (!ok) allOk = false;
            return { key: sa.key, label: sa.label, answer: gotObj[sa.key] == null ? '' : String(gotObj[sa.key]), expected: sa.answer_en, ok: ok };
        });
        return {
            ok: allOk,
            answer: subResults.map(function (r) { return r.answer; }).filter(Boolean).join(' '),
            expected: it.sub_answers.map(function (sa) { return sa.answer_en; }).filter(Boolean).join(' '),
            sub_results: subResults
        };
    }

    function gradeAnswers(paper, answersByItemId) {
        const items = (paper && paper.items) || [];
        const map = answersByItemId || {};
        let correct = 0;
        const details = items.map(function (it) {
            const got = map[it.item_id];
            const isSubAnswer = Array.isArray(it.sub_answers) && it.sub_answers.length > 1;
            const subGrade = isSubAnswer ? gradeSubAnswerItem(it, got) : null;
            const ok = isSubAnswer ? subGrade.ok : (function () {
                const gotN = normalizeAnswer(got);
                const okList = [it.answer_en].concat(it.accepted_answers || []).map(normalizeAnswer).filter(Boolean);
                return isAcceptableAnswer(gotN, okList);
            })();
            if (ok) correct += 1;
            const expected = isSubAnswer ? subGrade.expected : (it.answer_en || '');
            const answer = isSubAnswer ? subGrade.answer : (got == null ? '' : String(got));
            const row = {
                item_id: it.item_id,
                seq: it.seq,
                ok: ok,
                answer: answer,
                expected: expected,
                prompt_zh: it.prompt_zh || '',
                source: it.source || null
            };
            if (isSubAnswer) row.sub_results = subGrade.sub_results;
            if (!ok) {
                row.diff = analyzeAnswerDiff(expected, answer);
            }
            return row;
        });
        const wrongItems = details.filter(function (d) { return !d.ok; });
        return {
            total: items.length,
            correct: correct,
            score: items.length ? Math.round((correct / items.length) * 1000) / 10 : 0,
            details: details,
            wrong_items: wrongItems
        };
    }

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 學生句：對的黑字；錯的／多打的紅線刪除；缺漏顯示淡紅〔缺〕。
     * 師生兩端共用同一份渲染，避免各自維護一份、之後長歪（曾發生過）。
     */
    function renderAnswerDiffHtml(ops) {
        if (!ops || !ops.length) return '<span style="color:#94A3B8;">（未作答）</span>';
        // 💣 雷區（2026-08-11 老師回報「你的答案一排全是〔缺〕很白痴」）：完全沒作答時，
        // 逐字對齊會把「正確答案」的每一個字都各自標成一個 del（缺漏），排出一整排〔缺〕〔缺〕
        // 〔缺〕……對老師／學生來說毫無資訊量，只要看得出「整題都沒寫」就好，不需要重複每個字都
        // 標一次。只有當「至少有一個字是真的打錯／多打」時，才逐字顯示 del／sub／ins 的完整對齊。
        if (ops.every(function (op) { return op.type === 'del'; })) {
            return '<span style="color:#94A3B8;">（未作答）</span>';
        }
        return ops.map(function (op) {
            if (op.type === 'match') {
                return '<span style="color:#1E293B; font-weight:700;">' + escHtml(op.got) + '</span>';
            }
            if (op.type === 'sub' || op.type === 'ins') {
                return '<span style="color:#DC2626; font-weight:800; text-decoration:line-through; text-decoration-thickness:2px;">'
                    + escHtml(op.got) + '</span>';
            }
            return '<span style="color:#F87171; font-weight:700; font-size:0.85em;">〔缺〕</span>';
        }).join(' ');
    }

    function renderSpellingPairsHtml(pairs) {
        if (!pairs || !pairs.length) return '';
        return '<div style="margin-top:6px; font-size:0.78rem; color:#9A3412; font-weight:700; line-height:1.5;">拼錯紀錄：'
            + pairs.map(function (p) {
                const should = p.expected_word ? escHtml(p.expected_word) : '（無）';
                const wrote = p.got_word ? escHtml(p.got_word) : '（未寫）';
                return '<span style="display:inline-block; margin:2px 6px 2px 0; padding:2px 8px; border-radius:6px; background:#FFF7ED; border:1px solid #FED7AA;">應打 <b>'
                    + should + '</b> → 寫成 <b style="color:#DC2626;">' + wrote + '</b></span>';
            }).join('')
            + '</div>';
    }

    /**
     * 找出「跟學生答案最接近」的候選正確答案（含 accepted_answers），供標紅顯示用。
     * ties 時偏好主答案（answer_en），因為它排第一個。
     */
    function bestDiffForAnswer(item, got) {
        const candidates = [item.answer_en].concat(item.accepted_answers || []).filter(function (s) {
            return s != null && String(s).trim() !== '';
        });
        if (!candidates.length) candidates.push(item.answer_en || '');
        let best = null;
        candidates.forEach(function (cand) {
            const diff = analyzeAnswerDiff(cand, got);
            const cost = diff.ops.reduce(function (n, op) {
                return n + (op.type === 'match' ? 0 : 1);
            }, 0);
            if (!best || cost < best.cost) best = { expected: cand, diff: diff, cost: cost };
        });
        return best;
    }

    /**
     * 💣 雷區（見 .cursor/rules/quiz-accepted-answers-invariant.mdc）：
     * 多標準答案只改考卷快照層 items[].accepted_answers，不要另開「只改這個學生分數」的
     * 旁路開關——否則分數會跟 gradeAnswers 的重算結果不一致，之後重考/重批又會被打回原狀。
     */

    /** 新增一個可接受答案（不含主答案本身；去重以 normalizeAnswer 比對）。回傳是否有變動。 */
    function addAcceptedAnswer(item, text) {
        const val = String(text || '').trim();
        if (!val) return false;
        const n = normalizeAnswer(val);
        if (!n) return false;
        const existing = [item.answer_en].concat(item.accepted_answers || []).map(normalizeAnswer);
        if (existing.indexOf(n) !== -1) return false;
        if (!Array.isArray(item.accepted_answers)) item.accepted_answers = [];
        item.accepted_answers.push(val);
        return true;
    }

    /** 移除一個可接受答案（只能移除 accepted_answers 裡的，不能移除主答案）。回傳是否有變動。 */
    function removeAcceptedAnswer(item, text) {
        if (!Array.isArray(item.accepted_answers) || !item.accepted_answers.length) return false;
        const n = normalizeAnswer(text);
        const before = item.accepted_answers.length;
        item.accepted_answers = item.accepted_answers.filter(function (a) {
            return normalizeAnswer(a) !== n;
        });
        return item.accepted_answers.length !== before;
    }

    /**
     * 修改主答案（訂正錯字用）。舊主答案會自動併入 accepted_answers（除非已存在），
     * 確保已經照舊寫法寫對的學生不會因為老師訂正主答案而變成錯的。回傳是否有變動。
     */
    function setPrimaryAnswer(item, text) {
        const val = String(text || '').trim();
        if (!val) return false;
        const oldVal = String(item.answer_en || '').trim();
        if (normalizeAnswer(val) === normalizeAnswer(oldVal)) {
            if (val !== oldVal) { item.answer_en = val; return true; }
            return false;
        }
        if (oldVal) addAcceptedAnswer(item, oldVal);
        item.answer_en = val;
        removeAcceptedAnswer(item, val); // 若新答案原本就在 accepted_answers 裡，升格為主答案後移除重複
        return true;
    }

    /**
     * 用「目前」的 paper（含老師剛編輯過的 accepted_answers／answer_en）重新批改一份
     * 學生 completion 的 raw_data。只動 quiz_result／quiz_stats 裡跟批改直接相關的欄位，
     * 其餘（leave_log、spelling_history 等）原樣保留。
     * @returns {{ rawData: object, changed: boolean, prevScore: number|null, nextScore: number }}
     */
    function regradeCompletionRawData(paper, rawData) {
        const src = rawData || {};
        const answers = src.quiz_answers || {};
        const result = gradeAnswers(paper, answers);
        const prevResult = src.quiz_result || null;
        const prevScore = prevResult ? prevResult.score : null;
        const prevCorrect = prevResult ? prevResult.correct : null;
        const changed = prevScore !== result.score || prevCorrect !== result.correct;

        const wrongItemsCompact = result.wrong_items.map(function (d) {
            return {
                item_id: d.item_id,
                seq: d.seq,
                answer: d.answer,
                expected: d.expected,
                prompt_zh: d.prompt_zh,
                ops: (d.diff && d.diff.ops) || [],
                spelling_pairs: (d.diff && d.diff.spelling_pairs) || [],
                sub_results: d.sub_results || null
            };
        });

        const nextRawData = Object.assign({}, src);
        nextRawData.quiz_result = Object.assign({}, prevResult || {}, {
            score: result.score,
            correct: result.correct,
            total: result.total,
            wrong_items: wrongItemsCompact,
            regraded_at: new Date().toISOString()
        });

        const stats = Object.assign({}, src.quiz_stats || {});
        stats.wrong_items = wrongItemsCompact;
        if (changed) {
            const history = Array.isArray(stats.history) ? stats.history.slice() : [];
            history.push({
                at: new Date().toISOString(),
                type: 'regrade',
                score: result.score,
                correct: result.correct,
                total: result.total
            });
            while (history.length > 40) history.shift();
            stats.history = history;
        }
        nextRawData.quiz_stats = stats;

        /**
         * 💣 雷區（2026-08-11「重考後對比歷史資料」規劃）：quiz_retake.combined 是老師端
         * 「合併正確率」報告用的（原始 correct + 重考 correct）／原始 total。以前這裡完全
         * 不會動 quiz_retake，若學生已完成重考（done=true）之後，老師才接受某題申訴／改了
         * accepted_answers 導致這次重批的 correct 變動，歷史重考報告會留著重批前的舊數字，
         * 跟新分數對不起來。這裡只在 quiz_retake.done 且結果真的變動時才重算 combined；
         * item_ids（重考凍結的題號集合）維持不動，不屬於這次要處理的範圍。
         */
        if (src.quiz_retake && src.quiz_retake.done && src.quiz_retake.result && changed) {
            const retake = Object.assign({}, src.quiz_retake);
            const retakeCorrect = Number(retake.result.correct) || 0;
            const combinedCorrect = result.correct + retakeCorrect;
            const combinedTotal = result.total;
            retake.combined = {
                correct: combinedCorrect,
                total: combinedTotal,
                rate: combinedTotal > 0 ? Math.round((combinedCorrect / combinedTotal) * 1000) / 10 : 0
            };
            nextRawData.quiz_retake = retake;
        }

        return {
            rawData: nextRawData,
            changed: changed,
            prevScore: prevScore,
            nextScore: result.score
        };
    }

    return {
        buildQuizPaper: buildQuizPaper,
        gradeAnswers: gradeAnswers,
        normalizeAnswer: normalizeAnswer,
        tokenizeWords: tokenizeWords,
        alignTokens: alignTokens,
        analyzeAnswerDiff: analyzeAnswerDiff,
        analyzeWrongWords: analyzeWrongWords,
        parseNumList: parseNumList,
        FALLBACK_COL_MAP: FALLBACK_COL_MAP,
        escHtml: escHtml,
        renderAnswerDiffHtml: renderAnswerDiffHtml,
        renderSpellingPairsHtml: renderSpellingPairsHtml,
        bestDiffForAnswer: bestDiffForAnswer,
        addAcceptedAnswer: addAcceptedAnswer,
        removeAcceptedAnswer: removeAcceptedAnswer,
        setPrimaryAnswer: setPrimaryAnswer,
        regradeCompletionRawData: regradeCompletionRawData,
        EQUIVALENCE_PAIRS: EQUIVALENCE_PAIRS,
        expandWithEquivalents: expandWithEquivalents,
        isAcceptableAnswer: isAcceptableAnswer,
        equivalentAcceptedSeed: equivalentAcceptedSeed,
        shuffleInPlace: shuffleInPlace
    };
})();

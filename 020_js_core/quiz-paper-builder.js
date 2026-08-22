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

    function fieldAlias(row, key) {
        if (!row || !key) return '';
        const k = String(key);
        let v = String(row[k] != null ? row[k] : '').trim();
        if (v) return v;
        const lower = k.toLowerCase();
        if (lower === 'answer_en') return String(row.script || '').trim();
        if (lower === 'script') return String(row.answer_en || '').trim();
        if (lower === 'pre') return String(row.article || '').trim();
        if (lower === 'article') return String(row.pre || '').trim();
        return '';
    }

    function joinAnswerKeys(row) {
        if (!row || !Array.isArray(row._answer_keys) || !row._answer_keys.length) return '';
        return row._answer_keys.map(function (key) { return fieldAlias(row, key); })
            .filter(Boolean).join(' ');
    }

    function wordFromRow(row) {
        return fieldAlias(row, 'answer_en') || fieldAlias(row, 'script');
    }

    function preFromRow(row) {
        return fieldAlias(row, 'pre') || fieldAlias(row, 'article');
    }

    /**
     * 公式 AN&" "&AO 因 AO 空而整段空、或 _answer_keys 只勾了 pre 時，
     * join／cells[2] 會卡在冠詞「a」。列上若已有英文單字，依老師公式接回 pre + 字。
     * 禁止用詞性啟發式改公式；這裡只做舊鍵相容與不完整結合的補齊。
     */
    function finalizeWrittenAnswer(answerEn, row) {
        const pre = preFromRow(row);
        const word = wordFromRow(row);
        const cur = String(answerEn || '').trim();
        if (!word) return cur;
        if (!cur || (pre && normalizeAnswer(cur) === normalizeAnswer(pre))) {
            if (pre && normalizeAnswer(pre) !== normalizeAnswer(word)) {
                return (pre + ' ' + word).trim();
            }
            return word;
        }
        return cur;
    }

    function rowsFromMetaPack(pack) {
        return (pack && Array.isArray(pack.rows)) ? pack.rows : [];
    }

    function pairedSheetId(sheetId) {
        const s = String(sheetId || '').trim();
        if (/_PIC$/i.test(s)) return s.replace(/_PIC$/i, '_WORD');
        if (/_WORD$/i.test(s)) return s.replace(/_WORD$/i, '_PIC');
        return '';
    }

    function findPairedMetaRow(metaCache, sheetId, row) {
        const want = pairedSheetId(sheetId);
        if (!want || !metaCache) return null;
        const page = toNum(row && row.page);
        const itemNo = toNum(row && row.item_no);
        if (isNaN(page) || isNaN(itemNo)) return null;
        const keys = Object.keys(metaCache);
        for (let i = 0; i < keys.length; i++) {
            if (String(keys[i]).toUpperCase() !== want.toUpperCase()) continue;
            const rows = rowsFromMetaPack(metaCache[keys[i]]);
            const hit = rows.find(function (r) {
                return toNum(r && r.page) === page && toNum(r && r.item_no) === itemNo;
            });
            if (hit) return hit;
        }
        return null;
    }

    function rowWithPairedWord(row, sibling) {
        if (!row) return row || {};
        const out = Object.assign({}, row);
        if (!wordFromRow(out) && sibling) {
            const w = wordFromRow(sibling);
            if (w) {
                if (!String(out.answer_en || '').trim()) out.answer_en = String(sibling.answer_en || sibling.script || w).trim();
                if (!String(out.script || '').trim()) out.script = String(sibling.script || sibling.answer_en || w).trim();
            }
        }
        return out;
    }

    function vbkNameOf(row, sheetId) {
        const direct = String((row && (row.vBK_name || row.vbk_name)) || '').trim();
        if (direct) return direct;
        const s = String(sheetId || (row && row.sheet_id) || '').trim();
        const m = s.match(/vBK-\d+/i);
        return m ? m[0] : '';
    }

    function formatItemSourceLabel(item) {
        const src = (item && item.source) || {};
        const fromTpl = String(src.info_label || '').trim();
        if (fromTpl) return fromTpl;
        const vbk = String(src.vbk_name || src.vBK_name || '').trim() || vbkNameOf(src, src.sheet_id);
        const page = src.page != null && src.page !== '' ? String(src.page) : '';
        const itemNo = String(src.item_no_label != null && src.item_no_label !== ''
            ? src.item_no_label
            : (src.item_no != null && src.item_no !== '' ? src.item_no : '')).trim();
        const parts = [];
        if (vbk) parts.push(vbk);
        if (page) parts.push(page);
        if (itemNo) parts.push(itemNo);
        return parts.join(' - ');
    }

    function formatItemHeadline(item, displayNo) {
        const seq = displayNo != null ? String(displayNo) : (item && item.seq != null ? String(item.seq) : '');
        const meta = formatItemSourceLabel(item);
        const seqDot = seq && /\.\s*$/.test(seq) ? seq.replace(/\s+$/, '') : (seq ? seq + '.' : '');
        if (seqDot && meta) return seqDot + ' ' + meta;
        if (seqDot) return seqDot;
        return meta || '';
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
     * 💣 雷區（2026-08-13 老師回報「學生明明有打句號／大寫字，程式完全沒有如實記錄」）：
     * 對錯判定／逐字對齊（alignTokens）本來就該用 normalizeAnswer 過的版本比對（小寫、
     * 去掉句尾標點），不然大小寫或句尾標點不同就會誤判成拼錯；但顯示給師生看的「你的
     * 答案」必須「如實記錄」學生打的每一個字元——包括大小寫、句尾標點（. , ! ? 等）、
     * 學生自己打的引號樣式，一個都不能因為「拿去比對用」的正規化而被畫面上跟著吃掉。
     * 之前這裡誤把 normalizeAnswer 那套「去尾標點／轉直式引號」的正規化也複製過來，
     * 只差沒轉小寫，結果句尾的句號、學生打的引號樣式一樣被這裡吃掉——這是錯的：這份
     * 陣列唯一的功能是「跟 tokenizeWords 逐字對應、換回畫面顯示用的原始文字」，除了
     * 用空白分詞（純粹是為了跟比對用陣列的斷詞數量對齊，不是要動內容）之外，不應該對
     * 學生輸入的內容做任何字元層級的修改。
     */
    function tokenizeWordsOriginalCase(s) {
        const n = String(s || '').replace(/\s+/g, ' ').trim();
        if (!n) return [];
        return n.split(/\s+/).filter(Boolean);
    }

    /**
     * LCS 對齊後合併相鄰 del+ins → sub。
     * expTokens／actTokens 是用來「判斷是否相等」的正規化（小寫）版本；expOrig／actOrig
     * 是跟前面兩個陣列逐字對應、但保留原始大小寫的版本——沒給時退回用正規化版本本身
     * （相容舊呼叫端）。輸出的 expected／got 一律用原始大小寫版本，不是比對用的小寫版本。
     * @returns {{ type: 'match'|'sub'|'del'|'ins', expected: string, got: string }[]}
     */
    function alignTokens(expTokens, actTokens, expOrig, actOrig) {
        const exp = expTokens || [];
        const act = actTokens || [];
        const expO = expOrig || exp;
        const actO = actOrig || act;
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
                raw.push({ type: 'match', expected: expO[i - 1], got: actO[j - 1] });
                i -= 1;
                j -= 1;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                raw.push({ type: 'ins', expected: '', got: actO[j - 1] });
                j -= 1;
            } else {
                raw.push({ type: 'del', expected: expO[i - 1], got: '' });
                i -= 1;
            }
        }
        raw.reverse();
        // 💣 雷區（2026-08-13 老師回報「I 後面留白很怪，don't/recognize 各自標示看不懂，
        // 明明就是 can't read/recognize 被寫成 don't recognize，應該當『一整段』的錯誤」）：
        // 舊邏輯只合併「剛好一個 del 緊接著一個 ins」這一組，兩個字以上的替換（expected 2 個字
        // vs got 2 個字，兩邊完全不重疊）會被拆成 del＋ins 分開顯示（一個留白缺字、一個標成
        // 多打），對老師／學生來說完全看不出這其實是「同一段話被整段寫錯」。
        // 改成：兩個 match 之間，只要中間有一整串連續的 del／ins（不管順序、不管幾個），
        // 一律當成同一個區塊——只要區塊裡同時有 del 又有 ins，就整段合併成一個 sub
        // （expected＝這段裡所有 del 的字依序接起來，got＝這段裡所有 ins 的字依序接起來）；
        // 若整段只有 del（真的整段沒寫）才維持 del，只有 ins（真的整段多打）才維持 ins。
        // 這樣「can't read/recognize」對「don't recognize」就會變成一個紅色區塊、正下方
        // 一次補上完整的正確片語，不會再切成一個留白＋一個看不懂色碼的字。
        const ops = [];
        let bufDel = [];
        let bufIns = [];
        function flushBuf() {
            if (!bufDel.length && !bufIns.length) return;
            if (bufDel.length && bufIns.length) {
                ops.push({ type: 'sub', expected: bufDel.join(' '), got: bufIns.join(' ') });
            } else if (bufDel.length) {
                ops.push({ type: 'del', expected: bufDel.join(' '), got: '' });
            } else {
                ops.push({ type: 'ins', expected: '', got: bufIns.join(' ') });
            }
            bufDel = [];
            bufIns = [];
        }
        raw.forEach(function (op) {
            if (op.type === 'del') { bufDel.push(op.expected); return; }
            if (op.type === 'ins') { bufIns.push(op.got); return; }
            flushBuf();
            ops.push(op);
        });
        flushBuf();
        return ops;
    }

    /**
     * 錯題分析：拼錯對（應打／誤打）+ 對齊 ops（供紅線刪除顯示）
     */
    function analyzeAnswerDiff(expected, got) {
        const exp = tokenizeWords(expected);
        const act = tokenizeWords(got);
        const expOrig = tokenizeWordsOriginalCase(expected);
        const actOrig = tokenizeWordsOriginalCase(got);
        const ops = alignTokens(exp, act, expOrig, actOrig);
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

    function resolveFromTemplateLibrary(pid) {
        if (!pid) return null;
        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.resolveTemplateProfile === 'function') {
            return window.FeatureTemplateLibrary.resolveTemplateProfile(pid);
        }
        return null;
    }

    /**
     * 試卷範本只認區段／該題已選的那一筆（範本庫）。
     * 沒選＝不管。不准讀 _layout.json、不准改套 job 預設、不准合併舊 profile。
     */
    function resolveSectionProfile(_layout, section, _examJob, itemSource) {
        const pid = String((itemSource && itemSource.layout_profile_id)
            || (section && section.layout_profile_id) || '').trim();
        if (!pid) return null;
        return resolveFromTemplateLibrary(pid);
    }

    /** 只信這一筆範本自己的欄位對應。禁止用全卷合成的 layout.col_map（PIC 的 AN=pos，WORD 的 AN=pre）。 */
    function colMapForProfile(profile) {
        return Object.assign({}, (profile && profile.col_map) || {});
    }

    function flattenJobPickRows(examJob) {
        const raw = (examJob && Array.isArray(examJob.sections)) ? examJob.sections : [];
        if (raw.some(function (s) { return s && Array.isArray(s.segments); })) {
            const out = [];
            raw.forEach(function (sec) {
                (sec.segments || []).forEach(function (seg) { out.push(seg); });
            });
            return out;
        }
        return raw;
    }

    function findSectionForItem(examJob, item) {
        const sections = flattenJobPickRows(examJob);
        const src = (item && item.source) || {};
        const sheetId = String(src.sheet_id || '').trim().toUpperCase();
        const itemPid = String(src.layout_profile_id || '').trim();
        if (itemPid) {
            const byBoth = sections.find(function (s) {
                return String((s && s.layout_profile_id) || '') === itemPid
                    && (!sheetId || String((s && s.sheet_id) || '').toUpperCase() === sheetId);
            });
            if (byBoth) return byBoth;
            const byPid = sections.find(function (s) {
                return String((s && s.layout_profile_id) || '') === itemPid;
            });
            if (byPid) return byPid;
        }
        if (sheetId) {
            return sections.find(function (s) {
                return String((s && s.sheet_id) || '').toUpperCase() === sheetId;
            }) || {};
        }
        return {};
    }

    /**
     * 這批 rows 已是該 meta 檔讀出來的。列上 stem／sheet_id 可能帶資料夾前綴、
     * 或少了範本後綴，不准因此整批丟掉。只有兩邊都有擷取後綴且不一樣
     * （PIC vs WORD）才當另一本活頁。
     */
    function rowIsOtherTemplateSheet(rowSheet, sectionSheet) {
        function suffix(s) {
            const t = String(s || '').trim().replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
            const m = t.match(/^(.+)\.([A-Z][A-Z0-9_+-]*)$/);
            return m ? String(m[2] || '') : '';
        }
        const ta = suffix(rowSheet);
        const tb = suffix(sectionSheet);
        return !!(ta && tb && ta !== tb);
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

        const MS = window.MaterialSnapshot;
        const pageKey = (MS && typeof MS.resolveMetaPageKey === 'function')
            ? MS.resolveMetaPageKey(rows)
            : 'page';

        return (rows || []).filter(function (row) {
            if (!row) return false;
            // 列上的 stem／sheet_id 可能是 A、AvaLiu-vBK-2，區段卻被寫成 AvaLiu-vBK-2.vocab-word
            // 或連字號不同。這批 rows 已是該 meta 檔讀出來的，只在「明顯是另一本活頁」時才略過。
            const rowSheet = String(row.sheet_id || row.stem || '').trim();
            if (rowSheet && sheet && rowIsOtherTemplateSheet(rowSheet, sheet)) return false;

            const itemNo = toNum(row.item_no != null ? row.item_no : row.itemNo);
            const pageNums = (MS && typeof MS.pageNumsFromCell === 'function')
                ? MS.pageNumsFromCell(pageKey && row[pageKey] != null ? row[pageKey] : row.page)
                : (isNaN(toNum(row.page)) ? [] : [toNum(row.page)]);

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
            if (!pageNums.length) return false;
            if (pageSet) return pageNums.some(function (p) { return !!pageSet[p]; });
            return pageNums.some(function (p) { return p >= lo && p <= hi; });
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

    /**
     * 2026-08-13（老師要求：白名單展開不能只在「產生線上考卷」當下才算，meta 建立當下
     * 〔feature-material-layout-pairing.js 的 buildGenerationFromMatrix〕就該先展開凍結進
     * row._accepted_answers／row._accepted_answers_by_key）：這裡把「meta 裡已經凍結好的
     * 變體」跟「用目前 answerEn 現場重算一次」的結果聯集起來，兩邊都要——凍結值是給其他不會
     * 走 buildItemFromRow 這條路徑的消費者用（例如日後有別的工具直接讀 meta.json），現場重算
     * 是為了保護沒有凍結值的舊教材、以及 answerEn 來源是公式／老師事後修正而跟凍結值不同步的
     * 情況（雙重保險，兩邊有差異取聯集，不會漏掉任何一邊算出來的變體）。
     */
    function mergeAcceptedAnswers(computed, precomputed) {
        const seen = {};
        const out = [];
        (computed || []).concat(precomputed || []).forEach(function (v) {
            const key = normalizeAnswer(v);
            if (!key || seen[key]) return;
            seen[key] = true;
            out.push(v);
        });
        return out;
    }

    function applyColMapAliases(row, colMap) {
        if (!row) return {};
        const out = Object.assign({}, row);
        if (!String(out.answer_en || '').trim() && String(out.script || '').trim()) out.answer_en = out.script;
        if (!String(out.script || '').trim() && String(out.answer_en || '').trim()) out.script = out.answer_en;
        if (!String(out.pre || '').trim() && String(out.article || '').trim()) out.pre = out.article;
        if (!String(out.article || '').trim() && String(out.pre || '').trim()) out.article = out.pre;
        if (!colMap) return out;
        Object.keys(colMap).forEach(function (letter) {
            const sem = colMap[letter];
            if (!sem) return;
            const L = String(letter).toUpperCase();
            if (out[L] != null && String(out[L]).trim() !== '') return;
            const v = fieldAlias(out, sem);
            if (v) out[L] = v;
        });
        return out;
    }

    function buildItemFromRow(row, opts) {
        const Eval = window.LayoutFieldsEval;
        if (!Eval) throw new Error('LayoutFieldsEval 未載入');
        const sheet = String(opts.sheetId || row.sheet_id || '').trim().toUpperCase() || '?';
        const page = toNum(row.page);
        const itemNo = toNum(row.item_no);
        const folder = opts.materialFolder || '';
        const itemId = [folder || 'bank', sheet, isNaN(page) ? 'p' : page, isNaN(itemNo) ? 'i' : itemNo].join(':');
        const evalRow = applyColMapAliases(row, opts.colMap);

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
            try { return cellsToPlain(Eval.evaluateFields(formula, evalRow, opts.colMap)); }
            catch (_evalErr) { return []; }
        }

        const cells = safeEvalFields(opts.fields || '');
        const infoLabel = cells.map(function (c) { return String(c.text || '').trim(); }).filter(Boolean).join('');
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
         * 💣 雷區（2026-08-17）：老師填的結合公式死套（opts.quizAnswer 已是該範本
         * 實際公式，例如 PIC 的 AO&" "&AP）。禁止發明 quiz_answer／answer_combine_note
         * 優先序，也禁止用別份範本的 AN&" "&AO 來猜。
         * skipStoredCombined（重新批改）跳過過期 `_answer_combined_text`。
         * 禁止用詞性啟發式去改公式。
         */
        if (opts.quizAnswer) {
            const tplCells = safeEvalFields(opts.quizAnswer);
            answerEn = tplCells.map(function (c) { return String(c.text || '').trim(); }).filter(Boolean).join(' ').trim();
        }
        if (!answerEn && opts.skipStoredCombined) {
            if (row._answer_mode === 'combine' && Array.isArray(row._answer_keys) && row._answer_keys.length) {
                answerEn = joinAnswerKeys(evalRow);
            }
        } else if (!answerEn && row._answer_mode === 'combine' && row._answer_combined_text != null && String(row._answer_combined_text).trim() !== '') {
            answerEn = String(row._answer_combined_text).trim();
        } else if (!answerEn && row._answer_mode === 'combine' && Array.isArray(row._answer_keys) && row._answer_keys.length) {
            answerEn = joinAnswerKeys(evalRow);
        }
        if (!promptZh) promptZh = '';
        if (!answerEn) answerEn = wordFromRow(evalRow) || String(row.script || '').trim();
        let clozeStem = '';
        if (opts.quizMode === 'cloze' && cellsAnswer && cellsAnswer[1]) {
            clozeStem = cellsAnswer[1].text || '';
        }

        // 'separate' 模式的合併預覽字串要靠下面 subAnswers 那段算（逐欄各自的值），這裡先不要
        // 用單欄 row.answer_en 卡位，否則下面 `if (!answerEn)` 會被誤判成「已經有了」而跳過。
        if (!answerEn && row._answer_mode !== 'separate') answerEn = wordFromRow(evalRow) || String(row.answer_en || '').trim();
        if (row._answer_mode !== 'separate') answerEn = finalizeWrittenAnswer(answerEn, evalRow);

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
                const precomputed = (row._accepted_answers_by_key && row._accepted_answers_by_key[key]) || [];
                return { key: key, label: key, answer_en: subAnswerEn, accepted_answers: mergeAcceptedAnswers(equivalentAcceptedSeed(subAnswerEn), precomputed) };
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
            accepted_answers: mergeAcceptedAnswers(equivalentAcceptedSeed(answerEn), row._accepted_answers),
            sub_answers: subAnswers,
            cells: cells,
            cells_answer: cellsAnswer,
            source: {
                material_folder: folder,
                sheet_id: sheet,
                vbk_name: vbkNameOf(row, sheet),
                page: isNaN(page) ? null : page,
                item_no: isNaN(itemNo) ? null : itemNo,
                item_no_label: String(row.item_no != null ? row.item_no : (isNaN(itemNo) ? '' : itemNo)).trim(),
                schema_id: opts.schemaId || '',
                layout_profile_id: opts.layoutProfileId || '',
                info_label: infoLabel
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

        function normalizeJobSections(job) {
            const raw = Array.isArray(job.sections) ? job.sections : [];
            if (raw.some(function (s) { return s && Array.isArray(s.segments); })) return raw;
            return [{
                id: 'sec-legacy',
                shuffle: !(job.options && job.options.shuffle === false),
                allow_answer_appeal: true,
                segments: raw
            }];
        }

        const jobSections = normalizeJobSections(examJob);
        if (!jobSections.length) throw new Error('exam_job 沒有段落');
        const shuffleSections = !!(examJob.options && examJob.options.shuffle_sections);
        const orderedSections = shuffleSections ? shuffleInPlace(jobSections.slice()) : jobSections.slice();
        const sections = [];
        orderedSections.forEach(function (sec) {
            (sec && sec.segments ? sec.segments : []).forEach(function (seg) {
                sections.push(Object.assign({}, seg, {
                    _section_id: sec.id || '',
                    _section_shuffle: sec.shuffle !== false,
                    _section_appeal: sec.allow_answer_appeal !== false
                }));
            });
        });
        if (!sections.length) throw new Error('exam_job 沒有片段');

        const picked = [];
        const metaCache = {};
        const notices = [];

        for (let pIdx = 0; pIdx < sections.length; pIdx++) {
            const preloadId = String((sections[pIdx] || {}).sheet_id || '').trim().toUpperCase();
            if (preloadId && !metaCache[preloadId]) metaCache[preloadId] = await loadSheetMeta(preloadId);
        }

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

            /**
             * 💣 雷區：一份卷可有多個試卷範本。每一區段只套該列下拉選中的那一筆
             * （fields／col_map／結合公式）。禁止找不到就改套 profiles[0]、
             * 禁止 || args.quizAnswer 讓空區段吃到另一份範本的公式。
             */
            const pid = String(sec.layout_profile_id || '').trim();
            const profile = resolveSectionProfile(layout, sec, examJob);
            if (!pid) {
                throw new Error('區段 ' + (sIdx + 1) + '（活頁 ' + sheetId + '）尚未選擇試卷範本');
            }
            if (!profile) {
                throw new Error('區段 ' + (sIdx + 1) + '（活頁 ' + sheetId + '）找不到試卷範本 ' + pid
                    + '（請硬重新整理後再產生，或確認該範本未被刪除）。禁止改套其他區段的範本。');
            }
            const colMap = colMapForProfile(profile);
            const fields = String(profile.fields || '').trim();
            if (!fields) {
                throw new Error('區段 ' + (sIdx + 1) + '（活頁 ' + sheetId + '／範本 '
                    + (profile.label || pid) + '）缺少題目排版 fields（請到範本管理補上這一筆，不要改套其他範本）');
            }
            const fieldsAnswer = (profile.fields_answer || profile.answer_fields) || '';
            const quizPrompt = profile.quiz_prompt || '';
            const quizAnswer = profile.quiz_answer || '';
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

            restPool = shuffleInPlace(restPool.slice());
            // 💣 雷區（2026-08-17）：題數填 0 以前被當成「沒填＝抽範圍內全部」，
            // 三列各 20 可用、其中兩列題數 0，會產出 60 題。明確的 0＝不出這列；
            // 只有空白／未填才沿用「抽全部」舊語意。
            const countRaw = sec.count;
            const countMissing = countRaw === '' || countRaw == null
                || (typeof countRaw === 'string' && !String(countRaw).trim());
            const want = countMissing ? restPool.length : Math.max(0, Number(countRaw) || 0);
            if (!countMissing && want === 0 && !includeSet) {
                continue;
            }
            const fillWant = Math.max(0, want - mandatoryRows.length);
            const filled = restPool.slice(0, Math.min(fillWant, restPool.length));
            const take = mandatoryRows.concat(filled);
            if (want > 0 && mandatoryRows.length > want) {
                notices.push('活頁 ' + sheetId + ' 必考題號共 ' + mandatoryRows.length +
                    ' 題，已超過設定題數 ' + want + '，已自動全部納入（實際 ' + mandatoryRows.length + ' 題）');
            }

            take.forEach(function (row) {
                const row2 = rowWithPairedWord(Object.assign({}, row, row.sheet_id ? {} : { sheet_id: sheetId }), findPairedMetaRow(metaCache, sheetId, row));
                const item = buildItemFromRow(row2, {
                    sheetId: sheetId,
                    materialFolder: materialFolder,
                    schemaId: schemaId,
                    fields: fields,
                    fieldsAnswer: fieldsAnswer,
                    quizPrompt: quizPrompt,
                    quizAnswer: quizAnswer,
                    colMap: colMap,
                    quizMode: quizMode,
                    layoutProfileId: (profile && profile.profile_id) || pid
                });
                item.section_id = sec._section_id || ('sec-' + sIdx);
                item.section_shuffle = sec._section_shuffle !== false;
                item.allow_answer_appeal = sec._section_appeal !== false;
                item.segment_id = String(sec.sheet_id || '') + ':' + String(sec.start || '') + '-' + String(sec.end || '');
                picked.push(item);
            });
        }

        const grouped = [];
        const groupBy = {};
        picked.forEach(function (it) {
            const sid = String(it.section_id || '');
            if (!groupBy[sid]) {
                groupBy[sid] = { shuffle: it.section_shuffle !== false, items: [] };
                grouped.push(groupBy[sid]);
            }
            groupBy[sid].items.push(it);
        });
        const orderedItems = [];
        grouped.forEach(function (g) {
            const part = g.shuffle ? shuffleInPlace(g.items.slice()) : g.items;
            part.forEach(function (it) { orderedItems.push(it); });
        });
        orderedItems.forEach(function (it, idx) {
            it.seq = idx + 1;
        });

        return {
            kind: 'quiz_paper',
            generated_at: new Date().toISOString(),
            spec_ref: {
                job_id: examJob.job_id || '',
                bank_id: examJob.bank_id || ''
            },
            layout: {
                section_templates: sections.map(function (sec) {
                    return {
                        sheet_id: String((sec && sec.sheet_id) || '').trim(),
                        layout_profile_id: String((sec && sec.layout_profile_id) || '').trim()
                    };
                }).filter(function (s) { return s.layout_profile_id; })
            },
            items: orderedItems,
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
                source: it.source || null,
                allow_answer_appeal: it.allow_answer_appeal,
                section_id: it.section_id || ''
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
     * 學生句：對的黑字；錯的／多打的純藍字（2026-08-13 老師回報「cross out 的線擋住了字，
     * 看不清楚學生的答案」，改成只用顏色標示，不再加刪除線；同一天老師又要求「學生答案用
     * 黑色，錯的部分用藍色，解答的部分用紅色」，把原本「錯的用紅、解答用綠」的配色對調＋
     * 換色——這裡的「藍」專指學生寫錯／多寫的那個字，「紅」專指正下方補上的正確解答）。
     * 💣 雷區（2026-08-13 老師再次明確要求「不要用那個 stupid〔缺〕了」）：缺漏／打錯／多打
     * 都不再用文字標記或整句重複顯示正確答案，改成「逐字對齊、上下兩行」——上排是學生寫的
     * （對的黑字／錯的或多打的紅字／缺漏處留白只用底線佔位），**正下方**直接補上「這一個字
     * 該有的正確部分」（綠字，只補這一個字，不是整句話重複一次）；對的字下面不重複顯示。
     * 師生兩端共用同一份渲染，避免各自維護一份、之後長歪（曾發生過）。
     */
    function renderAnswerDiffHtml(ops) {
        if (!ops || !ops.length) return '<span style="color:#94A3B8;">（未作答）</span>';
        // 💣 雷區（2026-08-11 老師回報「你的答案一排全是〔缺〕很白痴」）：完全沒作答時，
        // 逐字對齊會把「正確答案」的每一個字都各自標成一個 del（缺漏），排出一整排缺漏標記，
        // 對老師／學生來說毫無資訊量，只要看得出「整題都沒寫」就好，不需要重複每個字都
        // 標一次。只有當「至少有一個字是真的打錯／多打」時，才逐字顯示 del／sub／ins 的完整對齊。
        if (ops.every(function (op) { return op.type === 'del'; })) {
            return '<span style="color:#94A3B8;">（未作答）</span>';
        }
        const cells = ops.map(function (op) {
            if (op.type === 'match') {
                return '<span style="display:inline-flex; flex-direction:column; align-items:center;">'
                    + '<span style="color:#1E293B; font-weight:700;">' + escHtml(op.got) + '</span>'
                    + '</span>';
            }
            // sub／ins：學生真的寫了字，但是錯的／多寫的，上排藍字顯示學生寫的內容，且底下
            // 加底線（老師要求「藍色的部分也要畫底線」，跟 del 缺字佔位的底線樣式一致，
            // 才看得出「這裡有問題」是同一種標記，不是顏色一種、底線又是另一種樣式）；
            // del：學生這裡什麼都沒寫，上排不放任何文字標記，只用一條底線佔位示意「這裡缺一個字」。
            const topHtml = op.type === 'del'
                ? '<span style="display:inline-block; min-width:1.4em; border-bottom:3px solid #93C5FD;">&nbsp;</span>'
                : '<span style="color:#2563EB; font-weight:800; border-bottom:3px solid #93C5FD; padding-bottom:1px;">' + escHtml(op.got) + '</span>';
            // 正下方只補「這一個字」該有的正確部分（op.expected），不是整句答案——ins（多打，
            // 完全沒有對應的正確字）expected 是空字串，這時下面不顯示任何東西。
            // 2026-08-13 老師問「紅字比較小是不是怕跟旁邊重疊」：不是，每個字本來就已經是
            // 上下兩排（column）各自一個獨立的 cell，紅字本來就已經在「下一行」，寬度不夠時
            // 瀏覽器會把這個 cell 撐寬、不會跟旁邊的字重疊——所以字體大小可以放心跟藍字一樣大。
            const bottomHtml = op.expected
                ? ('<span style="color:#DC2626; font-weight:800; margin-top:1px;">' + escHtml(op.expected) + '</span>')
                : '';
            return '<span style="display:inline-flex; flex-direction:column; align-items:center;">' + topHtml + bottomHtml + '</span>';
        });
        return '<span style="display:inline-flex; flex-wrap:wrap; gap:8px; align-items:flex-start;">' + cells.join('') + '</span>';
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

    function normVbkName(s) {
        return String(s || '').trim().toUpperCase();
    }

    function rowMatchesItem(row, item) {
        const src = (item && item.source) || {};
        const itemNo = toNum(src.item_no);
        const ri = toNum(row && row.item_no);
        if (isNaN(itemNo) || isNaN(ri) || itemNo !== ri) return false;
        const page = toNum(src.page);
        const rp = toNum(row && row.page);
        if (isNaN(page) || isNaN(rp) || page !== rp) return false;
        const itemVbk = normVbkName(src.vbk_name || src.vBK_name || vbkNameOf(src, src.sheet_id));
        const rowVbk = normVbkName(vbkNameOf(row, row.sheet_id || src.sheet_id));
        if (!itemVbk || !rowVbk || itemVbk !== rowVbk) return false;
        return true;
    }

    function findMetaRowForItem(metaCache, sheetId, item) {
        const pack = metaCache[sheetId] || {};
        const rows = Array.isArray(pack.rows) ? pack.rows : [];
        const hit = rows.find(function (r) { return rowMatchesItem(r, item); });
        if (!hit) return null;
        return { row: hit, pack: pack, sheetId: sheetId };
    }

    /**
     * 維持現有題目與順序，只依目前試卷範本公式重算每題標準答案。
     * 不抽新題、不改 item_id。給「重新批改」用，不要跟「產生試卷」混在一起。
     */
    async function refreshPaperAnswersKeepItems(args) {
        const paper = args && args.paper;
        const items = (paper && Array.isArray(paper.items)) ? paper.items : [];
        if (!items.length) throw new Error('沒有現有卷可以重批');
        const loadSheetMeta = args.loadSheetMeta;
        const layout = args.layout || {};
        const examJob = args.examJob || {};
        const metaCache = {};
        let updated = 0;
        let missing = 0;
        const sheetIdsToLoad = [];
        items.forEach(function (it) {
            const sid = String((it.source && it.source.sheet_id) || '').trim().toUpperCase();
            if (sid && sheetIdsToLoad.indexOf(sid) === -1) sheetIdsToLoad.push(sid);
            const pair = pairedSheetId(sid);
            if (pair && sheetIdsToLoad.indexOf(pair.toUpperCase()) === -1) sheetIdsToLoad.push(pair.toUpperCase());
        });
        for (let p = 0; p < sheetIdsToLoad.length; p++) {
            if (typeof loadSheetMeta !== 'function') break;
            if (!metaCache[sheetIdsToLoad[p]]) {
                try { metaCache[sheetIdsToLoad[p]] = await loadSheetMeta(sheetIdsToLoad[p]); }
                catch (_preloadErr) { metaCache[sheetIdsToLoad[p]] = { rows: [] }; }
            }
        }
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const src = it.source || {};
            const sheetId = String(src.sheet_id || '').trim().toUpperCase();
            if (!sheetId || typeof loadSheetMeta !== 'function') { missing += 1; continue; }
            if (!metaCache[sheetId]) metaCache[sheetId] = await loadSheetMeta(sheetId);
            const found = findMetaRowForItem(metaCache, sheetId, it);
            if (!found) { missing += 1; continue; }
            const pack = found.pack || {};
            const row = found.row;
            const rowForBuild = rowWithPairedWord(row, findPairedMetaRow(metaCache, found.sheetId || sheetId, row));
            const sec = findSectionForItem(examJob, it);
            const profile = resolveSectionProfile(layout, sec, examJob, src);
            const rebuilt = buildItemFromRow(rowForBuild, {
                sheetId: sheetId,
                materialFolder: pack.materialFolder || layout.material_folder || src.material_folder || '',
                schemaId: pack.schemaId || src.schema_id || '',
                fields: (profile && profile.fields) || '',
                fieldsAnswer: (profile && (profile.fields_answer || profile.answer_fields)) || '',
                quizPrompt: (profile && profile.quiz_prompt) || '',
                quizAnswer: (profile && profile.quiz_answer) || '',
                colMap: colMapForProfile(profile),
                quizMode: it.quiz_mode || 'full_sentence',
                layoutProfileId: (profile && profile.profile_id) || src.layout_profile_id || '',
                skipStoredCombined: true
            });
            it.answer_en = rebuilt.answer_en;
            it.accepted_answers = rebuilt.accepted_answers;
            it.sub_answers = rebuilt.sub_answers;
            if (!it.source) it.source = {};
            it.source.info_label = (rebuilt.source && rebuilt.source.info_label) || '';
            updated += 1;
        }
        paper.answers_refreshed_at = new Date().toISOString();
        return { paper: paper, updated: updated, missing: missing };
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

        /**
         * 💣 雷區（2026-08-12 老師回報「重新批閱之後，錯題編號又對不起來」）：`headline`
         * 是學生實際交卷那一刻，依「畫面上真正看到的題目順序」算出來的顯示編號（見
         * feature-student-quiz.js 的 sessionDisplayOrder／displayNo 說明），跟這裡
         * `gradeAnswers` 內部固定的 `paper.items` 順序完全無關。重新批閱只是要更新
         * 對錯／accepted_answers 比對結果，不該連帶把 headline 也重算掉——重算的話會
         * 用回 `d.seq`（出卷當下的內部編號）當退路，讓編號跟學生當時看到的畫面又對不起來，
         * 造成「改好又壞掉」的錯覺。同一題（item_id 相同）一律沿用舊 headline；只有
         * 全新出現的錯題（例如老師改了主答案讓原本對的變錯）才沒有舊 headline 可用。
         */
        const prevWrongByItemId = {};
        const prevWrongList = (src.quiz_stats && Array.isArray(src.quiz_stats.wrong_items))
            ? src.quiz_stats.wrong_items
            : ((prevResult && Array.isArray(prevResult.wrong_items)) ? prevResult.wrong_items : []);
        prevWrongList.forEach(function (w) {
            if (w && w.item_id != null && w.headline) prevWrongByItemId[String(w.item_id)] = w.headline;
        });

        const wrongItemsCompact = result.wrong_items.map(function (d) {
            const prevHeadline = prevWrongByItemId[String(d.item_id)];
            const row = {
                item_id: d.item_id,
                seq: d.seq,
                answer: d.answer,
                expected: d.expected,
                prompt_zh: d.prompt_zh,
                ops: (d.diff && d.diff.ops) || [],
                spelling_pairs: (d.diff && d.diff.spelling_pairs) || [],
                sub_results: d.sub_results || null
            };
            if (prevHeadline) row.headline = prevHeadline;
            return row;
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

    /**
     * ✍️ 輸入練習／🔧 輸入改正共用：逐字元比對輸入框，附加在既有 <input> 上。
     *
     * 老師確認的規則（2026-08-14）：
     * - 逐字要求完全一致（大小寫、空格、標點都算）；打錯字當下就要擋掉，不能繼續往下打。
     * - 中文注音／拼音輸入法是「打完一整個字才確定」，所以打字中（IME 組字階段）完全不比對，
     *   只在 compositionend（該字確定送出）才驗證剛剛送出的那一段是否吃得下去；不對的話
     *   直接把那一段吐回去（回復到上一個仍相符的字首）。
     * - 允許刪除（往回打）：任何比 expectedText 短的合法字首都算合法，不會被擋。
     * - 打對「完整」expectedText 的那一刻算完成一次，呼叫 onComplete()，由外部決定要清空
     *   繼續下一次還是鎖住輸入框（達到次數）。
     *
     * @param {HTMLInputElement} inputEl
     * @param {string} expectedText 這次要逐字比對的目標字串（已經是最終呈現字串，不重新正規化）
     * @param {function} onComplete 每次「完整打對一次」都會呼叫；由呼叫端負責清空/鎖定
     * @returns {{ detach: function }} 可呼叫 detach() 移除監聽（例如切換題目、關閉視窗時）
     */
    function playRetypeErrorBeep() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!playRetypeErrorBeep._ctx) playRetypeErrorBeep._ctx = new AC();
            const ctx = playRetypeErrorBeep._ctx;
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = 240;
            gain.gain.setValueAtTime(0.07, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.09);
        } catch (_e) {}
    }

    function attachStrictRetypeInput(inputEl, expectedText, onComplete) {
        const expected = String(expectedText == null ? '' : expectedText);

        function longestValidPrefix(val) {
            let i = 0;
            while (i < val.length && i < expected.length && val[i] === expected[i]) i++;
            return val.slice(0, i);
        }

        function validate() {
            const val = inputEl.value;
            if (!expected.startsWith(val)) {
                const fixed = longestValidPrefix(val);
                if (fixed !== val) {
                    inputEl.value = fixed;
                    // 短暫閃紅色邊框，提示「這個字錯了、被擋掉」
                    inputEl.style.borderColor = '#DC2626';
                    inputEl.style.boxShadow = '0 0 0 2px rgba(220,38,38,0.25)';
                    clearTimeout(inputEl._retypeFlashTimer);
                    inputEl._retypeFlashTimer = setTimeout(function () {
                        inputEl.style.borderColor = '';
                        inputEl.style.boxShadow = '';
                    }, 350);
                    playRetypeErrorBeep();
                }
            }
            if (expected && inputEl.value === expected) {
                if (typeof onComplete === 'function') onComplete();
            }
        }

        function onInput(e) {
            // 組字中（例如注音／拼音選字階段）不比對，等 compositionend 再驗證整段結果
            if (e && (e.isComposing || inputEl.dataset.retypeComposing === '1')) return;
            validate();
        }
        function onCompositionStart() { inputEl.dataset.retypeComposing = '1'; }
        function onCompositionEnd() {
            inputEl.dataset.retypeComposing = '0';
            validate();
        }

        inputEl.addEventListener('input', onInput);
        inputEl.addEventListener('compositionstart', onCompositionStart);
        inputEl.addEventListener('compositionend', onCompositionEnd);

        return {
            detach: function () {
                inputEl.removeEventListener('input', onInput);
                inputEl.removeEventListener('compositionstart', onCompositionStart);
                inputEl.removeEventListener('compositionend', onCompositionEnd);
                clearTimeout(inputEl._retypeFlashTimer);
            }
        };
    }

    return {
        buildQuizPaper: buildQuizPaper,
        filterRowsForSection: filterRowsForSection,
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
        mergeAcceptedAnswers: mergeAcceptedAnswers,
        shuffleInPlace: shuffleInPlace,
        attachStrictRetypeInput: attachStrictRetypeInput,
        formatItemSourceLabel: formatItemSourceLabel,
        formatItemHeadline: formatItemHeadline,
        refreshPaperAnswersKeepItems: refreshPaperAnswersKeepItems,
        resolveSectionProfile: resolveSectionProfile
    };
})();

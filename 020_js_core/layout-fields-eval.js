/**
 * 📂 020_js_core/layout-fields-eval.js
 * 購物車「欄位」公式求值：頂層逗號＝輸出網格欄；支援 STACK / FONTSIZE / SUBSTITUTE / TEXTJOIN / & / Excel 欄代號。
 */
window.LayoutFieldsEval = (function () {
    'use strict';

    function cellText(v) {
        if (v == null) return '';
        if (typeof v === 'object' && v && typeof v.text === 'string') return v.text;
        return String(v);
    }

    function isBlank(v) {
        return String(cellText(v) || '').trim() === '';
    }

    function asRich(v, fontDelta) {
        if (v && typeof v === 'object' && typeof v.text === 'string') {
            return {
                text: v.text,
                fontDelta: fontDelta != null ? fontDelta : (v.fontDelta || 0)
            };
        }
        return { text: cellText(v), fontDelta: fontDelta || 0 };
    }

    /** 頂層逗號切開（忽略括號／字串內的逗號） */
    function splitTopLevel(formula) {
        const src = String(formula || '').trim();
        if (!src) return [];
        const parts = [];
        let buf = '';
        let depth = 0;
        let inStr = false;
        let strQuote = '';
        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            if (inStr) {
                buf += ch;
                if (ch === strQuote && src[i - 1] !== '\\') inStr = false;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inStr = true;
                strQuote = ch;
                buf += ch;
                continue;
            }
            if (ch === '(') {
                depth += 1;
                buf += ch;
                continue;
            }
            if (ch === ')') {
                depth = Math.max(0, depth - 1);
                buf += ch;
                continue;
            }
            if (ch === ',' && depth === 0) {
                parts.push(buf.trim());
                buf = '';
                continue;
            }
            buf += ch;
        }
        if (buf.trim()) parts.push(buf.trim());
        return parts;
    }

    function resolveColMap(colMap) {
        const map = {};
        if (!colMap || typeof colMap !== 'object') return map;
        Object.keys(colMap).forEach(function (k) {
            map[String(k).trim().toUpperCase()] = String(colMap[k] || '').trim();
        });
        return map;
    }

    /**
     * 💣 雷區（見 .cursor/rules/material-publish-setup-format.mdc）：
     * 同一份教材若有多個 schema_id（同活頁不同區塊，各自 excel_col 位置不同，例如
     * vocab-set1 用 AK=中文，vocab-set2 用 AL=中文），`_Layout.fields` 若寫「Excel 欄字母」
     * （如 `AL, AN`），這串字母對其中一個 schema 是對的，對另一個 schema 卻會對到
     * 完全不同的語意欄位（曾經 `AN` 在 set1 是 article、在 set2 卻是 pos）——
     * 「同教材所有段落共用一份 _Layout」的設計，靠欄字母做不到真正共用。
     *
     * 正確做法：`fields`／`fields_answer` 一律優先用 `_Schema.semantic_key`
     * （例如 `display_zh, pos, article`，大小寫不拘）——這才是跨 schema 都通用的
     * 「共同詞彙」，不管實際 Excel 欄位在哪裡都能正確對應。Excel 欄字母僅保留給
     * 「單一 schema、沒有多區塊」的舊教材相容用，多 schema 教材不要再用欄字母寫 `_Layout`。
     */
    /**
     * 舊教材／新教材欄名相容（不是猜詞性）：
     * answer_en ↔ script（書寫英文單字）；pre ↔ article（冠詞／前置）。
     * 試卷公式 AN&" "&AO 若 AO 對到 answer_en、列上卻只剩舊鍵 script，必須能讀到字。
     */
    const FIELD_ALIASES = {
        ANSWER_EN: ['script'],
        SCRIPT: ['answer_en'],
        PRE: ['article'],
        ARTICLE: ['pre']
    };

    function lookupDirect(row, name) {
        if (!row || !name) return '';
        const upper = String(name).toUpperCase();
        const rowKeys = Object.keys(row);
        for (let i = 0; i < rowKeys.length; i++) {
            if (rowKeys[i].toUpperCase() === upper) {
                const v = row[rowKeys[i]];
                if (v != null && String(v).trim() !== '') return v;
            }
        }
        return '';
    }

    function lookupColumn(row, name, colMap) {
        const raw = String(name || '').trim();
        if (!raw) return '';
        const upper = raw.toUpperCase();
        // ① 優先當作語意欄位鍵（semantic_key，大小寫不拘）：跨 schema 皆可共用，建議寫法
        let v = lookupDirect(row, upper);
        if (v !== '') return v;
        // ② 相容：把「Excel 欄字母」透過 colMap 轉成語意欄位再查（僅單一 schema 教材安全）
        const map = resolveColMap(colMap);
        const semantic = map[upper];
        if (semantic) {
            v = lookupDirect(row, semantic);
            if (v !== '') return v;
        }
        // ③ 舊鍵相容：answer_en↔script、pre↔article
        const aliasFrom = semantic ? String(semantic).toUpperCase() : upper;
        const aliases = FIELD_ALIASES[aliasFrom] || FIELD_ALIASES[upper] || [];
        for (let i = 0; i < aliases.length; i++) {
            v = lookupDirect(row, aliases[i]);
            if (v !== '') return v;
        }
        return '';
    }

    function tokenize(expr) {
        const s = String(expr || '').trim();
        const tokens = [];
        let i = 0;
        while (i < s.length) {
            const ch = s[i];
            if (/\s/.test(ch)) {
                i += 1;
                continue;
            }
            if (ch === '"' || ch === "'") {
                const q = ch;
                let j = i + 1;
                let lit = '';
                while (j < s.length) {
                    if (s[j] === '\\' && j + 1 < s.length) {
                        lit += s[j + 1];
                        j += 2;
                        continue;
                    }
                    if (s[j] === q) break;
                    lit += s[j];
                    j += 1;
                }
                tokens.push({ type: 'str', value: lit });
                i = j + 1;
                continue;
            }
            if (ch === '(' || ch === ')' || ch === ',' || ch === '&') {
                tokens.push({ type: ch });
                i += 1;
                continue;
            }
            if (/[+\-0-9.]/.test(ch)) {
                let j = i;
                if (s[j] === '+' || s[j] === '-') j += 1;
                while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
                const num = s.slice(i, j);
                if (/^[+\-]?\d+(\.\d+)?$/.test(num)) {
                    tokens.push({ type: 'num', value: Number(num) });
                    i = j;
                    continue;
                }
            }
            if (/[A-Za-z_]/.test(ch)) {
                let j = i + 1;
                while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
                const word = s.slice(i, j);
                tokens.push({ type: 'ident', value: word });
                i = j;
                continue;
            }
            throw new Error('無法解析字元：' + ch + '（於：' + s + '）');
        }
        return tokens;
    }

    function parseExpression(tokens) {
        let pos = 0;

        function peek() {
            return tokens[pos] || null;
        }

        function consume(type, value) {
            const t = peek();
            if (!t) return null;
            if (type && t.type !== type) return null;
            if (value != null && t.value !== value && t.type !== value) return null;
            pos += 1;
            return t;
        }

        function parsePrimary() {
            const t = peek();
            if (!t) throw new Error('運算式不完整');
            if (t.type === 'str') {
                pos += 1;
                return { kind: 'str', value: t.value };
            }
            if (t.type === 'num') {
                pos += 1;
                return { kind: 'num', value: t.value };
            }
            if (t.type === 'ident') {
                const name = t.value;
                pos += 1;
                if (peek() && peek().type === '(') {
                    pos += 1; // (
                    const args = [];
                    if (peek() && peek().type !== ')') {
                        args.push(parseConcat());
                        while (peek() && peek().type === ',') {
                            pos += 1;
                            args.push(parseConcat());
                        }
                    }
                    if (!consume(')')) throw new Error('函式 ' + name + ' 缺少 )');
                    return { kind: 'call', name: name.toUpperCase(), args: args };
                }
                return { kind: 'col', name: name.toUpperCase() };
            }
            if (t.type === '(') {
                pos += 1;
                const inner = parseConcat();
                if (!consume(')')) throw new Error('缺少 )');
                return inner;
            }
            throw new Error('非預期 token：' + JSON.stringify(t));
        }

        function parseConcat() {
            let left = parsePrimary();
            while (peek() && peek().type === '&') {
                pos += 1;
                const right = parsePrimary();
                left = { kind: 'concat', left: left, right: right };
            }
            return left;
        }

        const ast = parseConcat();
        if (pos < tokens.length) {
            throw new Error('運算式尾端多餘：' + tokens.slice(pos).map(function (t) {
                return t.value != null ? t.value : t.type;
            }).join(' '));
        }
        return ast;
    }

    function evalAst(ast, row, colMap) {
        if (!ast) return asRich('');
        if (ast.kind === 'str') return asRich(ast.value);
        if (ast.kind === 'num') return asRich(String(ast.value));
        if (ast.kind === 'col') return asRich(lookupColumn(row, ast.name, colMap));
        if (ast.kind === 'concat') {
            const a = evalAst(ast.left, row, colMap);
            const b = evalAst(ast.right, row, colMap);
            // 防呆：中間某個「非字面」結果為空 → 整段空
            const leftWasLiteral = ast.left && ast.left.kind === 'str';
            const rightWasLiteral = ast.right && ast.right.kind === 'str';
            if (!leftWasLiteral && isBlank(a)) return asRich('');
            if (!rightWasLiteral && isBlank(b)) return asRich('');
            return asRich(cellText(a) + cellText(b));
        }
        if (ast.kind === 'call') {
            const fn = ast.name;
            const args = (ast.args || []).map(function (a) {
                return evalAst(a, row, colMap);
            });
            if (fn === 'STACK') {
                const lines = args.map(cellText).map(function (t) {
                    return String(t || '').trim();
                }).filter(Boolean);
                return asRich(lines.join('\n'));
            }
            if (fn === 'FONTSIZE') {
                const content = args[0] || asRich('');
                const n = Number(cellText(args[1]));
                const delta = isNaN(n) ? 0 : n;
                return asRich(cellText(content), delta);
            }
            if (fn === 'SUBSTITUTE') {
                const text = cellText(args[0]);
                const oldS = cellText(args[1]);
                const newS = cellText(args[2]);
                if (!oldS) return asRich(text);
                // 全取代（類似 Excel SUBSTITUTE 未指定 instance）
                return asRich(text.split(oldS).join(newS));
            }
            if (fn === 'TEXTJOIN') {
                // 用法同 Excel TEXTJOIN(分隔符, 欄位1, 欄位2, ...)：自動跳過空值，
                // 避免 pre 沒填（如名詞不需要 a/an）時整段答案被 & 的防呆規則吃成空字串。
                const sep = cellText(args[0]);
                const parts = args.slice(1).map(cellText).map(function (t) {
                    return String(t || '').trim();
                }).filter(Boolean);
                return asRich(parts.join(sep));
            }
            throw new Error('未知函式：' + fn);
        }
        throw new Error('未知 AST：' + ast.kind);
    }

    function evalSegment(segment, row, colMap) {
        const tokens = tokenize(segment);
        if (!tokens.length) return asRich('');
        const ast = parseExpression(tokens);
        return evalAst(ast, row, colMap);
    }

    /**
     * @param {string} fieldsFormula 例如 STACK(D,E,C), FONTSIZE(Y,-1), X
     * @param {object} row meta 列（semantic keys）
     * @param {object} colMap { D: 'sheet_id', Y: 'display_zh', ... }
     * @returns {{ text: string, fontDelta: number }[]}
     */
    function evaluateFields(fieldsFormula, row, colMap) {
        return splitTopLevel(fieldsFormula).map(function (seg) {
            return evalSegment(seg, row || {}, colMap || {});
        });
    }

    return {
        splitTopLevel: splitTopLevel,
        evaluateFields: evaluateFields,
        lookupColumn: lookupColumn,
        cellText: cellText
    };
})();

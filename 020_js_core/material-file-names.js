/**
 * 教材活頁／檔名：全站同一套格式，各 popup 只換資料。
 *
 * 四欄：活頁名＝{活頁}（老師不能手改；短名遺毒由系統強制改成現檔推的值）
 *       活頁別稱＝{別稱}（能改；跟活頁列走，鑰匙＝sheet id／資料夾＋活頁名＋擷取範本）
 *       meta／文稿
 * 公式：活頁名＝{活頁}（鎖死）；別稱＝{別稱}；meta／文稿預設＝{活頁}.{範本}（沒有擷取範本才是 {活頁}）
 * 鎖住的附檔名：.meta.json／.script.txt
 */
window.MaterialFileNames = (function () {
    var META_EXT = '.meta.json';
    var SCRIPT_EXT = '.script.txt';
    var COLS = 'minmax(10rem, 0.9fr) minmax(12rem, 1fr) minmax(14rem, 1.2fr) minmax(14rem, 1.2fr)';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function typed(name) {
        return String(name || '').replace(/^__mzren__/i, '').trim();
    }

    /** 套用／出題下拉只認這個。文稿 .script.txt 不准進這份清單。 */
    function isMetaFileName(name) {
        return /\.meta\.json$/i.test(typed(name));
    }

    function isScriptFileName(name) {
        return /\.script\.txt$/i.test(typed(name));
    }

    function suffixFamily(ext) {
        var e = String(ext || '').toLowerCase();
        if (e === '.meta.json') return ['.meta.json', '.json'];
        if (e === '.script.txt') return ['.script.txt', '.txt'];
        return [ext];
    }

    function stripExt(name, ext) {
        var raw = typed(name);
        if (!raw) return raw;
        var extras = suffixFamily(ext);
        var i;
        for (i = 0; i < extras.length; i++) {
            var x = extras[i];
            if (!x) continue;
            if (raw.length >= x.length && raw.slice(-x.length).toLowerCase() === x.toLowerCase()) {
                raw = raw.slice(0, raw.length - x.length);
            }
        }
        return raw;
    }

    function withExt(base, ext) {
        var body = stripExt(base, ext);
        return body ? (body + ext) : '';
    }

    function templateToken(name) {
        return String(name || '').trim().replace(/[\\/]/g, '-');
    }

    function fileFormula(templateName) {
        return templateToken(templateName) ? '{活頁}.{範本}' : '{活頁}';
    }

    /** 預設跟 fileFormula 同一把：有擷取範本＝{活頁}.{範本}。現檔長什麼不改預設。 */
    function inferFileFormula(templateName, fileName, ext) {
        return fileFormula(templateName);
    }

    function stripTemplateSuffix(body, templateName) {
        var b = String(body || '').trim();
        var tpl = templateToken(templateName);
        if (!b || !tpl) return b;
        var re = new RegExp('\\.' + tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
        var next = b.replace(re, '');
        return next || b;
    }

    /** 長名尾巴剛好是短名，且前面用 -／_ 接＝帶班級的同一本（AvaLiu-vBK-2 ⊃ vBK-2）。 */
    function isClassPrefixed(longName, shortName) {
        var a = String(longName || '');
        var b = String(shortName || '');
        if (!a || !b || a.length <= b.length) return false;
        if (a.slice(a.length - b.length).toUpperCase() !== b.toUpperCase()) return false;
        var sep = a.charAt(a.length - b.length - 1);
        return sep === '-' || sep === '_';
    }

    /**
     * {活頁}＝現檔主體去掉附檔名與 .{範本}。
     * 兩邊一致就用；一邊空用另一邊；一邊是另一邊的班級前綴用長的。
     * 對不上＝不猜，才退回資料庫短名。
     */
    function resolveLiveSheet(poisonStem, meta, script, templateName) {
        var poison = String(poisonStem || '').trim();
        var metaBody = stripTemplateSuffix(stripExt(meta, META_EXT), templateName);
        var scriptBody = stripTemplateSuffix(stripExt(script, SCRIPT_EXT), templateName);
        if (metaBody && scriptBody) {
            if (metaBody.toUpperCase() === scriptBody.toUpperCase()) return metaBody;
            if (isClassPrefixed(metaBody, scriptBody)) return metaBody;
            if (isClassPrefixed(scriptBody, metaBody)) return scriptBody;
            return poison;
        }
        var one = metaBody || scriptBody;
        if (one && poison && isClassPrefixed(poison, one)) return poison;
        if (one && poison && isClassPrefixed(one, poison)) return one;
        return one || poison;
    }

    function currentAlias(stem, sheetId) {
        var raw = String(stem || '').trim();
        if (sheetId && window.MaterialNameMap && typeof window.MaterialNameMap.currentLabelForSheet === 'function') {
            var lab = String(window.MaterialNameMap.currentLabelForSheet('sheet_stem', raw, sheetId) || '').trim();
            if (lab) return lab;
        }
        return raw;
    }

    function applyFormula(pattern, liveSheet, alias, templateName) {
        var locked = String(liveSheet || '');
        var nick = String(alias || '');
        var tpl = templateToken(templateName);
        return String(pattern || '')
            .replace(/\{活頁\}/g, locked)
            .replace(/\{別稱\}/g, nick)
            .replace(/\{範本\}/g, tpl)
            .replace(/\{template\}/gi, tpl)
            .replace(/\{sheet\}/gi, locked)
            .replace(/\{letter\}/gi, locked)
            .replace(/\{stem\}/gi, nick || locked);
    }

    function inputHtml(className, bodyValue, ext, inputStyle) {
        var field = String(inputStyle || 'padding:5px 6px; font-size:0.78rem;');
        return (
            '<div style="display:flex; align-items:stretch; width:100%; border:1px solid #99F6E4; border-radius:6px; overflow:hidden; box-sizing:border-box; background:white;">'
            + '<input class="' + className + '" value="' + esc(bodyValue) + '" style="flex:1; min-width:0; border:0; border-radius:0; box-sizing:border-box; background:white; ' + field + '">'
            + '<span aria-hidden="true" style="flex:none; display:flex; align-items:center; padding:0 8px; background:#F1F5F9; color:#64748B; font-size:0.74rem; font-weight:800; user-select:none;">' + esc(ext) + '</span>'
            + '</div>'
        );
    }

    function sortSheetNames(names) {
        var list = [];
        var seen = {};
        (names || []).forEach(function (raw) {
            var n = String(raw || '').trim();
            var u = n.toUpperCase();
            if (!n || seen[u]) return;
            seen[u] = true;
            list.push(n);
        });
        list.sort(function (a, b) {
            return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
        });
        return list;
    }

    function consecutiveRangeLabel(list) {
        if (!list || list.length < 2) return '';
        var i;
        var letters = true;
        var nums = true;
        var codes = [];
        var values = [];
        for (i = 0; i < list.length; i++) {
            var s = String(list[i] || '');
            if (!/^[A-Za-z]$/.test(s)) letters = false;
            if (!/^(0|[1-9]\d*)$/.test(s)) nums = false;
            if (letters) codes.push(s.toUpperCase().charCodeAt(0));
            if (nums) values.push(Number(s));
        }
        if (letters && codes.length === list.length) {
            codes.sort(function (a, b) { return a - b; });
            for (i = 1; i < codes.length; i++) {
                if (codes[i] !== codes[i - 1] + 1) return '';
            }
            return String.fromCharCode(codes[0]) + '～' + String.fromCharCode(codes[codes.length - 1]);
        }
        if (nums && values.length === list.length) {
            values.sort(function (a, b) { return a - b; });
            for (i = 1; i < values.length; i++) {
                if (values[i] !== values[i - 1] + 1) return '';
            }
            return String(values[0]) + '～' + String(values[values.length - 1]);
        }
        return '';
    }

    /** 勾了群組才統整：連續單字母／連續數字用 A～J；其他用、接。沒勾不准收成一筆。 */
    function formatSheetNames(names) {
        var list = sortSheetNames(names);
        if (!list.length) return '';
        if (list.length === 1) return list[0];
        return consecutiveRangeLabel(list) || list.join('、');
    }

    /**
     * 鑰匙：isGroup＝true 的列共一顆標籤（同一擷取＋同一試卷收成一組）；
     * isGroup＝false 各一顆。沒勾＝false，不准猜成群組。
     */
    function groupRoleTagItems(items) {
        var grouped = {};
        var groupedOrder = [];
        var singles = [];
        (items || []).forEach(function (it) {
            if (!it) return;
            var rec = {
                name: String(it.name || '').trim(),
                extract: String(it.extract || '').trim(),
                exam: String(it.exam || '').trim(),
                isGroup: it.isGroup === true
            };
            if (!rec.isGroup) {
                singles.push(rec);
                return;
            }
            var key = rec.extract + '\0' + rec.exam;
            if (!grouped[key]) {
                grouped[key] = { names: [], extract: rec.extract, exam: rec.exam, isGroup: true };
                groupedOrder.push(key);
            }
            if (rec.name) grouped[key].names.push(rec.name);
        });
        var out = [];
        groupedOrder.forEach(function (k) { out.push(grouped[k]); });
        singles.forEach(function (rec) {
            out.push({
                names: rec.name ? [rec.name] : [],
                extract: rec.extract,
                exam: rec.exam,
                isGroup: false
            });
        });
        return out;
    }

    function roleTagHtml(sheetName, extractName, examName) {
        var sheet = String(sheetName || '').trim();
        var extract = String(extractName || '').trim();
        var exam = String(examName || '').trim();
        return (
            '<div class="mf-role-tags" style="font-weight:800; font-size:0.74rem; line-height:1.4; text-align:left;">'
            + '<span style="display:block;">' + esc(sheet) + '</span>'
            + '<span style="display:block;">擷取範本' + (extract ? ' ' + esc(extract) : '') + '</span>'
            + '<span style="display:block;">試卷範本' + (exam ? ' ' + esc(exam) : '') + '</span>'
            + '</div>'
        );
    }

    function roleTagHtmlFromGroup(group) {
        var g = group || {};
        return roleTagHtml(formatSheetNames(g.names), g.extract, g.exam);
    }

    /** 沒勾＝一本一顆；勾了才共一顆。不准把未勾的名字用頓號接成一顆。 */
    function roleTagsHtml(items) {
        return groupRoleTagItems(items).map(roleTagHtmlFromGroup).join('');
    }

    /**
     * 一顆標籤＝一份套餐。三行固定：活頁名／擷取範本／試卷範本。
     * 勾了群組才把連續單字母收成 A～Z；沒勾＝一本一顆，不准 join。
     */
    function packageTagHtml(opts) {
        opts = opts || {};
        var names = sortSheetNames(opts.names || []);
        var extract = opts.extract;
        var exam = opts.exam;
        if (!names.length) return roleTagHtml('', extract, exam);
        return roleTagsHtml(names.map(function (n) {
            return {
                name: n,
                extract: extract,
                exam: exam,
                isGroup: opts.allGrouped === true
            };
        }));
    }

    function introHtml() {
        return (
            '<p style="margin:0 0 10px 0; color:#64748B; font-size:0.8rem; line-height:1.6;">'
            + '全站同一格式：標籤固定三行＝活頁名／擷取範本／試卷範本；沒有的格式名字留白，不准抄對面。一顆標籤＝一份套餐。勾了群組＝教材區共一顆標籤，方便套公式（例如 A～J）；出作業仍一本活頁一列，各自選頁，不准綁成一筆。沒勾＝一本一顆，不准收成一筆。灰色活頁名＝<code>{活頁}</code>，老師不能手改。能改的是活頁別稱（跟那一列走）。meta／文稿公式預設 <code>{活頁}.{範本}</code>（沒有擷取範本才是 <code>{活頁}</code>），右邊灰字是鎖住的附檔名。按「套用公式到全部」才會改下面別稱與檔名。'
            + '</p>'
        );
    }

    function headerHtml() {
        return (
            '<div class="mf-sheet-head" style="display:grid; grid-template-columns:' + COLS + '; gap:8px; font-size:0.72rem; font-weight:800; color:#0F766E; margin-bottom:4px;">'
            + '<div>活頁名</div><div>活頁別稱</div><div>meta 檔名</div><div>文稿檔名</div></div>'
        );
    }

    function readRow(block) {
        var row = block;
        if (block && block.querySelector && !(block.classList && block.classList.contains('mf-sheet-row'))) {
            row = block.querySelector('.mf-sheet-row') || block;
        }
        if (!row) return { id: '', sheet: '', live: '', alias: '', meta: '', script: '' };
        return {
            id: row.getAttribute('data-sheet-id') || '',
            sheet: row.getAttribute('data-sheet') || '',
            live: String(row.getAttribute('data-locked') || '').trim(),
            alias: String((row.querySelector('input.mf-alias') || {}).value || '').trim(),
            meta: withExt((row.querySelector('input.mf-meta') || {}).value || '', META_EXT),
            script: withExt((row.querySelector('input.mf-script') || {}).value || '', SCRIPT_EXT)
        };
    }

    function setLiveName(block, next) {
        if (!block) return;
        var name = String(next || '').trim();
        block.setAttribute('data-locked', name);
        var el = block.querySelector('.mf-locked-name');
        if (el) {
            el.textContent = name;
            el.setAttribute('title', name);
        }
    }

    function rowHtml(opts) {
        opts = opts || {};
        var field = opts.inputStyle || 'padding:5px 6px; font-size:0.78rem;';
        return (
            '<div class="mf-sheet-row" data-sheet-id="' + esc(opts.id || '') + '" data-sheet="' + esc(opts.sheetName || '') + '" data-locked="' + esc(opts.lockedName || '') + '" style="display:grid; grid-template-columns:' + COLS + '; gap:8px; align-items:center; margin-bottom:6px;">'
            + '<div class="mf-locked-name" title="' + esc(opts.lockedName || '') + '" style="font-size:0.78rem; font-weight:800; color:#64748B; background:#F1F5F9; border:1px solid #E2E8F0; border-radius:6px; padding:5px 6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(opts.lockedName || '') + '</div>'
            + '<input class="mf-alias" value="' + esc(opts.alias || '') + '" title="活頁別稱" style="width:100%; padding:5px 6px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box; font-size:0.78rem;">'
            + inputHtml('mf-meta', stripExt(opts.meta || '', META_EXT), META_EXT, field)
            + inputHtml('mf-script', stripExt(opts.script || '', SCRIPT_EXT), SCRIPT_EXT, field)
            + '</div>'
        );
    }

    function formulaBlockHtml(opts) {
        opts = opts || {};
        var metaF = opts.metaFormula || opts.fileFormula || fileFormula(opts.templateName);
        var scriptF = opts.scriptFormula || opts.fileFormula || fileFormula(opts.templateName);
        var sheetF = opts.sheetFormula || '{活頁}';
        var aliasF = opts.aliasFormula || '{別稱}';
        var field = 'padding:6px 8px; font-size:0.84rem; margin-top:2px;';
        return (
            '<div class="mf-formula-box" style="background:#F0FDFA; border:1px dashed #99F6E4; border-radius:8px; padding:10px; margin-bottom:12px;">'
            + '<div style="font-size:0.76rem; font-weight:800; color:#0F766E; margin-bottom:6px;">公式（改一處，套用到全部活頁）</div>'
            + '<div style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:4px;">活頁名'
            + '<div title="活頁名固定 {活頁}，老師不能改公式" style="margin-top:2px; padding:6px 8px; border:1px solid #E2E8F0; border-radius:6px; background:#F1F5F9; color:#64748B; font-weight:800; box-sizing:border-box;">{活頁}</div>'
            + '<input type="hidden" class="mf-formula-sheet" value="' + esc(sheetF || '{活頁}') + '">'
            + '</div>'
            + '<label style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:4px;">活頁別稱'
            + '<input class="mf-formula-alias" value="' + esc(aliasF) + '" style="display:block; width:100%; margin-top:2px; padding:6px 8px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box;"></label>'
            + '<label style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:4px;">meta 檔名'
            + inputHtml('mf-formula-meta', metaF, META_EXT, field) + '</label>'
            + '<label style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:6px;">文稿檔名'
            + inputHtml('mf-formula-script', scriptF, SCRIPT_EXT, field) + '</label>'
            + '<button type="button" class="mf-apply-formula btn" style="padding:5px 10px; border-radius:6px; border:1px solid #5EEAD4; background:#CCFBF1; color:#115E59; font-weight:800; font-size:0.78rem; cursor:pointer;">套用公式到全部</button>'
            + '</div>'
        );
    }

    function applyFormulaToRows(container, templateName) {
        if (!container) return;
        var sheetPat = String((container.querySelector('.mf-formula-sheet') || {}).value || '').trim();
        var aliasPat = String((container.querySelector('.mf-formula-alias') || {}).value || '').trim();
        var metaPat = String((container.querySelector('.mf-formula-meta') || {}).value || '').trim();
        var scriptPat = String((container.querySelector('.mf-formula-script') || {}).value || '').trim();
        var rows = container.querySelectorAll('.mf-sheet-row');
        var i;
        for (i = 0; i < rows.length; i++) {
            var block = rows[i];
            var poison = block.getAttribute('data-locked') || '';
            var aliasInput = block.querySelector('input.mf-alias');
            var metaInput = block.querySelector('input.mf-meta');
            var scriptInput = block.querySelector('input.mf-script');
            var aliasNow = String((aliasInput && aliasInput.value) || poison).trim();
            var live = resolveLiveSheet(
                poison,
                withExt((metaInput && metaInput.value) || '', META_EXT),
                withExt((scriptInput && scriptInput.value) || '', SCRIPT_EXT),
                templateName
            );
            if (sheetPat) {
                live = applyFormula(sheetPat, live, aliasNow, templateName);
                setLiveName(block, live);
            }
            if (aliasPat && aliasInput) aliasInput.value = applyFormula(aliasPat, live, aliasNow, templateName);
            var liveAlias = String((aliasInput && aliasInput.value) || aliasNow).trim();
            if (metaPat && metaInput) metaInput.value = stripExt(applyFormula(metaPat, live, liveAlias, templateName), META_EXT);
            if (scriptPat && scriptInput) scriptInput.value = stripExt(applyFormula(scriptPat, live, liveAlias, templateName), SCRIPT_EXT);
        }
    }

    return {
        META_EXT: META_EXT,
        SCRIPT_EXT: SCRIPT_EXT,
        typed: typed,
        isMetaFileName: isMetaFileName,
        isScriptFileName: isScriptFileName,
        stripExt: stripExt,
        withExt: withExt,
        bodyMeta: function (name) { return stripExt(name, META_EXT); },
        bodyScript: function (name) { return stripExt(name, SCRIPT_EXT); },
        fullMeta: function (base) { return withExt(base, META_EXT); },
        fullScript: function (base) { return withExt(base, SCRIPT_EXT); },
        readMetaInput: function (el) { return withExt((el && el.value) || '', META_EXT); },
        readScriptInput: function (el) { return withExt((el && el.value) || '', SCRIPT_EXT); },
        inputHtml: inputHtml,
        templateToken: templateToken,
        fileFormula: fileFormula,
        inferFileFormula: inferFileFormula,
        stripTemplateSuffix: stripTemplateSuffix,
        resolveLiveSheet: resolveLiveSheet,
        currentAlias: currentAlias,
        applyFormula: applyFormula,
        setLiveName: setLiveName,
        formatSheetNames: formatSheetNames,
        groupRoleTagItems: groupRoleTagItems,
        roleTagHtml: roleTagHtml,
        roleTagHtmlFromGroup: roleTagHtmlFromGroup,
        roleTagsHtml: roleTagsHtml,
        packageTagHtml: packageTagHtml,
        introHtml: introHtml,
        headerHtml: headerHtml,
        readRow: readRow,
        rowHtml: rowHtml,
        formulaBlockHtml: formulaBlockHtml,
        applyFormulaToRows: applyFormulaToRows
    };
})();

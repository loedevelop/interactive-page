/**
 * 目錄套餐。跟 Excel/JSON／PDF 同階層、在教材資料夾裡有卡。
 * 產生在教材範本管理獨立區塊（選夾後＋新增）；教材區窗口只顯示已有卡。
 * 範圍由老師出作業提供（主單元／次單元／標題／大題／次題／小題），系統收集成書。
 * 目錄文稿與這次錄音口說答案是兩把鑰匙，不准互抄。
 * 不碰 ensureCombination／pickComboForCard／Excel 畫卡。
 * combo_statistics 含三種套餐；目錄列由 trigger 寫入，不准拿來走 Excel 畫卡。
 */
window.FeatureMaterialBook = (function () {
    'use strict';

    var _combos = [];
    var _assigns = [];
    var _items = [];
    var _hintsByFolder = {};
    var _loaded = false;
    var _loadPromise = null;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function trim(s) {
        return String(s == null ? '' : s).trim();
    }

    function folderKey(name) {
        return trim(name).toUpperCase();
    }

    function folderAliasKeys(name) {
        var seen = {};
        var out = [];
        function add(n) {
            var k = folderKey(n);
            if (!k || seen[k]) return;
            seen[k] = true;
            out.push(k);
        }
        add(name);
        if (window.MaterialNameMap && typeof window.MaterialNameMap.lookupKeys === 'function') {
            (window.MaterialNameMap.lookupKeys('folder', name) || []).forEach(add);
        }
        if (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function') {
            add(window.MaterialNameMap.resolveFolderName(name));
        }
        return out;
    }

    function snapshotObject(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { return {}; }
        }
        return (raw && typeof raw === 'object') ? raw : {};
    }

    function segmentsOfSnapshot(raw) {
        var snap = snapshotObject(raw);
        if (Array.isArray(snap.segments)) return snap.segments;
        if (Array.isArray(snap)) return snap;
        if (snap.primary_unit || snap.primaryUnit || snap.secondary_unit || snap.secondaryUnit
            || snap.heading || snap.unit || snap.major || snap.page) {
            return [snap];
        }
        return [];
    }

    function hintRowFromSeg(seg) {
        return {
            primary_unit: trim(seg && (seg.primary_unit || seg.primaryUnit)),
            secondary_unit: trim(seg && (seg.secondary_unit || seg.secondaryUnit)),
            heading: trim(seg && (seg.heading || seg.range_heading)),
            major: trim(seg && (seg.unit || seg.major)),
            secondary: trim(seg && (seg.section || seg.secondary)),
            minor: trim(seg && (seg.subsection || seg.minor)),
            page: trim(seg && seg.page)
        };
    }

    async function getCurrentUserId() {
        if (!window.supabaseClient || !window.supabaseClient.auth) return null;
        if (typeof window.supabaseClient.auth.getSession === 'function') {
            var sess = await window.supabaseClient.auth.getSession();
            var session = sess && sess.data && sess.data.session;
            if (session && session.user && session.user.id) return session.user.id;
        }
        var res = await window.supabaseClient.auth.getUser();
        return res && res.data && res.data.user ? res.data.user.id : null;
    }

    function allClasses() {
        return (window.TeacherDB && window.TeacherDB.classes) || [];
    }

    function isBookCombo(combo) {
        return !!(combo && (combo.isBook === true || combo.kind === 'book'));
    }

    function comboLabel(combo) {
        if (window.FeatureClassMaterialCombinations
            && typeof window.FeatureClassMaterialCombinations.comboLabelText === 'function') {
            return window.FeatureClassMaterialCombinations.comboLabelText(combo);
        }
        return trim((combo && (combo.combo_label || combo.comboLabel || combo.label)) || '');
    }

    function rangeParts(row) {
        return [
            trim(row && (row.primary_unit || row.primaryUnit)),
            trim(row && (row.secondary_unit || row.secondaryUnit)),
            trim(row && (row.heading || row.range_heading)),
            trim(row && row.major),
            trim(row && row.secondary),
            trim(row && row.minor)
        ].filter(Boolean);
    }

    function rangeLabel(row) {
        return rangeParts(row).join(' / ');
    }

    /** 口說／書寫／說明那一格的標籤＝上面那一列。格式：13-8: p. 407 Exercise 37 - Returning an Item to a Store。沒填＝區段 N。不准借口說當目錄文稿。 */
    function pasteWindowLabel(row, idx) {
        var pair = unitPairLabel(
            trim(row && (row.primary_unit || row.primaryUnit)),
            trim(row && (row.secondary_unit || row.secondaryUnit))
        );
        var page = trim(row && row.page);
        var heading = trim(row && (row.heading || row.range_heading));
        var major = trim(row && row.major);
        var secondary = trim(row && row.secondary);
        var minor = trim(row && row.minor);
        var mid = [];
        if (page) mid.push('p. ' + page);
        if (major) mid.push(major);
        if (secondary) mid.push(secondary);
        if (minor) mid.push(minor);
        var body = mid.join(' ');
        if (heading) body = body ? (body + ' - ' + heading) : heading;
        if (pair && body) return pair + ': ' + body;
        if (pair) return pair;
        if (body) return body;
        return '區段 ' + (Number(idx) + 1);
    }

    function fileNameFromRange(row) {
        var parts = rangeParts(row).map(function (p) { return p.replace(/[\\/:*?"<>|]/g, '_'); });
        if (!parts.length) return '';
        return parts.join('.') + '.txt';
    }

    function utf8ToBase64(str) {
        var bytes = new TextEncoder().encode(String(str == null ? '' : str));
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    function driveFolderIdForFolderName(folderName) {
        var u = folderKey(folderName);
        if (!u || !window.FeatureTimeline) return '';
        function idFromPdf(classId, rootKind) {
            if (typeof window.FeatureTimeline.getMaterialPdfOptions !== 'function') return '';
            var pdf = window.FeatureTimeline.getMaterialPdfOptions(classId, rootKind) || [];
            var i;
            for (i = 0; i < pdf.length; i++) {
                if (folderKey(pdf[i] && pdf[i].folderName) === u && pdf[i].folderId) return String(pdf[i].folderId);
            }
            return '';
        }
        function idFromEntry(classId, rootKind) {
            if (typeof window.FeatureTimeline.getMetaCatalogEntry !== 'function') return '';
            var entry = window.FeatureTimeline.getMetaCatalogEntry(classId, rootKind);
            var opts = (entry && Array.isArray(entry.options)) ? entry.options : [];
            var i;
            for (i = 0; i < opts.length; i++) {
                if (folderKey(opts[i] && opts[i].folderName) === u && opts[i].folderId) return String(opts[i].folderId);
            }
            return '';
        }
        var hit = idFromPdf('', 'teacher') || idFromEntry('', 'teacher');
        if (hit) return hit;
        var classes = allClasses();
        var c;
        for (c = 0; c < classes.length; c++) {
            if (!classes[c] || !classes[c].id) continue;
            hit = idFromPdf(classes[c].id, 'class') || idFromEntry(classes[c].id, 'class');
            if (hit) return hit;
        }
        return '';
    }

    function folderNames() {
        return uniqueValues(_combos.map(function (c) { return c.folder_name; }));
    }

    function combosForFolder(folderName) {
        var u = folderKey(folderName);
        return _combos.filter(function (c) { return folderKey(c.folder_name) === u; });
    }

    function itemsForCombo(comboId) {
        var id = String(comboId || '');
        return _items.filter(function (it) { return String(it.book_combo_id) === id; });
    }

    function assignsForCombo(comboId) {
        var id = String(comboId || '');
        return _assigns.filter(function (a) { return String(a.book_combo_id) === id; })
            .map(function (a) { return String(a.class_id); });
    }

    function compareMenuDesc(a, b) {
        var na = String(a).match(/\d+/g) || [];
        var nb = String(b).match(/\d+/g) || [];
        var i;
        var len = Math.max(na.length, nb.length);
        for (i = 0; i < len; i++) {
            var va = i < na.length ? Number(na[i]) : -1;
            var vb = i < nb.length ? Number(nb[i]) : -1;
            if (va !== vb) return vb - va;
        }
        return String(b).localeCompare(String(a), 'zh-Hant', { numeric: true, sensitivity: 'base' });
    }

    function uniqueMenuValues(list) {
        var seen = {};
        var out = [];
        (list || []).forEach(function (v) {
            var t = trim(v);
            var k = t.toUpperCase();
            if (!t || seen[k]) return;
            seen[k] = true;
            out.push(t);
        });
        out.sort(compareMenuDesc);
        return out;
    }

    function uniqueValues(list) {
        var seen = {};
        var out = [];
        (list || []).forEach(function (v) {
            var t = trim(v);
            var k = t.toUpperCase();
            if (!t || seen[k]) return;
            seen[k] = true;
            out.push(t);
        });
        out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
        return out;
    }

    function uniqueUnitValues(list) {
        var out = uniqueValues(list);
        out.sort(function (a, b) { return compareMenuDesc(b, a); });
        return out;
    }

    function treeSourceItems(combo) {
        var db = itemsForCombo(combo && combo.id);
        return catalogRows(combo).map(function (rec) {
            var hit = db.filter(function (it) {
                return sameText(it.primary_unit, rec.primary_unit)
                    && sameText(it.secondary_unit, rec.secondary_unit)
                    && sameText(it.heading, rec.heading)
                    && sameText(it.major, rec.major)
                    && sameText(it.secondary, rec.secondary)
                    && sameText(it.minor, rec.minor);
            })[0];
            return {
                primary_unit: rec.primary_unit,
                secondary_unit: rec.secondary_unit,
                heading: rec.heading,
                major: rec.major,
                secondary: rec.secondary,
                minor: rec.minor,
                script: hit ? hit.script : '',
                drive_file_name: hit ? hit.drive_file_name : ''
            };
        });
    }

    var MANUAL_PICK = '__manual__';

    function onBookPickChange(sel, pathStr) {
        var targetId = sel && sel.getAttribute('data-target');
        var inp = targetId ? document.getElementById(targetId) : null;
        if (inp) inp.value = (sel.value === MANUAL_PICK) ? '' : sel.value;
        if (window.FeatureTimeline && typeof window.FeatureTimeline.onRangePackChange === 'function') {
            window.FeatureTimeline.onRangePackChange(pathStr, { rerender: true });
        }
    }

    function bookPickHtml(pathStr, id, current, options, placeholder, forceMenu) {
        var opts = uniqueMenuValues(options);
        var cur = trim(current);
        var inList = opts.some(function (o) { return sameText(o, cur); });
        var manualOn = !inList;
        var on = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })';
        var onBlur = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: true })';
        if (!forceMenu && !opts.length) {
            return '<input id="' + id + '" class="form-control" value="' + esc(cur) + '" placeholder="' + esc(placeholder) + '" oninput="' + on + '" onchange="' + onBlur + '">';
        }
        var html = '<select class="form-control range-pack-book-pick" data-target="' + esc(id) + '" onchange="window.FeatureMaterialBook.onBookPickChange(this, \'' + pathStr + '\')">'
            + '<option value="' + MANUAL_PICK + '"' + (manualOn ? ' selected' : '') + '>手動新增</option>'
            + opts.map(function (o) {
                return '<option value="' + esc(o) + '"' + (inList && sameText(o, cur) ? ' selected' : '') + '>' + esc(o) + '</option>';
            }).join('')
            + '</select>';
        if (manualOn) {
            html += '<input id="' + id + '" class="form-control range-pack-book-manual" value="' + esc(cur) + '" placeholder="' + esc(placeholder) + '" oninput="' + on + '" onchange="' + onBlur + '">';
        } else {
            html += '<input type="hidden" id="' + id + '" value="' + esc(cur) + '">';
        }
        return '<div class="range-pack-book-combo">' + html + '</div>';
    }

    function unitPairLabel(primary, secondaryUnit) {
        var a = trim(primary);
        var b = trim(secondaryUnit);
        if (a && b) return a + '-' + b;
        return a || b;
    }

    function parseUnitPair(text) {
        var s = trim(text);
        if (!s) return { primary: '', secondary: '' };
        var dash = s.lastIndexOf('-');
        if (dash <= 0 || dash === s.length - 1) return { primary: s, secondary: '' };
        return { primary: trim(s.slice(0, dash)), secondary: trim(s.slice(dash + 1)) };
    }

    function sameText(a, b) {
        return trim(a).toUpperCase() === trim(b).toUpperCase();
    }

    function hintRowsForCombo(combo) {
        var keys = {};
        [combo && combo.folder_name, combo && combo.folderName, combo && combo.label, combo && combo.combo_label].forEach(function (n) {
            folderAliasKeys(n).forEach(function (k) { keys[k] = true; });
        });
        var out = [];
        Object.keys(keys).forEach(function (k) {
            (_hintsByFolder[k] || []).forEach(function (row) { out.push(row); });
        });
        return out;
    }

    function rowsFromSavedPacks(comboId) {
        var want = String(comboId || '');
        if (!want) return [];
        var out = [];
        function walk(nodes) {
            (nodes || []).forEach(function (n) {
                ((n && n.raw_data && n.raw_data.pack_rows) || []).forEach(function (r) {
                    if (String((r && (r.combo_id || r.comboId)) || '') !== want) return;
                    out.push(r);
                });
                walk(n.subTasks);
            });
        }
        ((window.TeacherDB && window.TeacherDB.assignments) || []).forEach(function (a) {
            walk(a && a.tasks);
        });
        return out;
    }

    function catalogRows(combo, extraRows) {
        var seen = {};
        var out = [];
        function add(row) {
            var rec = {
                primary_unit: trim(row && (row.primary_unit || row.primaryUnit)),
                secondary_unit: trim(row && (row.secondary_unit || row.secondaryUnit)),
                heading: trim(row && (row.heading || row.range_heading)),
                major: trim(row && (row.major || row.unit)),
                secondary: trim(row && (row.secondary || row.section)),
                minor: trim(row && (row.minor || row.subsection)),
                page: trim(row && row.page)
            };
            if (!rec.secondary_unit && rec.primary_unit.indexOf('-') > 0) {
                var parsed = parseUnitPair(rec.primary_unit);
                if (parsed.primary && parsed.secondary) {
                    rec.primary_unit = parsed.primary;
                    rec.secondary_unit = parsed.secondary;
                }
            }
            if (!rec.primary_unit && !rec.secondary_unit && !rec.heading && !rec.major && !rec.secondary && !rec.minor && !rec.page) return;
            var k = [rec.primary_unit, rec.secondary_unit, rec.heading, rec.major, rec.secondary, rec.minor, rec.page].join('\t').toUpperCase();
            if (seen[k]) return;
            seen[k] = true;
            out.push(rec);
        }
        itemsForCombo(combo && combo.id).forEach(add);
        hintRowsForCombo(combo).forEach(add);
        rowsFromSavedPacks(combo && combo.id).forEach(add);
        (extraRows || []).forEach(add);
        return out;
    }

    function rangeCatalog(comboOrId, extraRows) {
        if (!_loaded) ensureLoaded();
        var comboId = (comboOrId && typeof comboOrId === 'object')
            ? (comboOrId.id || comboOrId.combo_id)
            : comboOrId;
        var fromDb = _combos.filter(function (c) { return String(c.id) === String(comboId || ''); })[0];
        var combo = fromDb || (comboOrId && typeof comboOrId === 'object' ? {
            id: comboOrId.id,
            folder_name: comboOrId.folder_name || comboOrId.folderName || '',
            label: comboOrId.label || comboOrId.combo_label || ''
        } : { id: comboId, folder_name: '' });
        var items = catalogRows(combo, extraRows);
        function matchUnit(it, primary, secondaryUnit) {
            return sameText(it.primary_unit, primary) && sameText(it.secondary_unit, secondaryUnit);
        }
        /** 有選才限這一欄。空＝這一欄不限，不准把空格當成「只准空的列」。 */
        function sameIfSet(itemVal, selected) {
            if (!trim(selected)) return true;
            return sameText(itemVal, selected);
        }
        function inScope(it, primary, secondaryUnit, heading, page, major, secondary) {
            return matchUnit(it, primary, secondaryUnit)
                && sameIfSet(it.heading, heading)
                && sameIfSet(it.page, page)
                && sameIfSet(it.major, major)
                && sameIfSet(it.secondary, secondary);
        }
        return {
            unitPairs: uniqueMenuValues(items.map(function (it) {
                return unitPairLabel(it.primary_unit, it.secondary_unit);
            })),
            pagesOf: function (primary, secondaryUnit) {
                return uniqueMenuValues(items.filter(function (it) {
                    return matchUnit(it, primary, secondaryUnit);
                }).map(function (it) { return it.page; }));
            },
            headingsOf: function (primary, secondaryUnit, page) {
                return uniqueMenuValues(items.filter(function (it) {
                    return inScope(it, primary, secondaryUnit, '', page);
                }).map(function (it) { return it.heading; }));
            },
            majorsOf: function (primary, secondaryUnit, heading, page) {
                return uniqueMenuValues(items.filter(function (it) {
                    return inScope(it, primary, secondaryUnit, heading, page);
                }).map(function (it) { return it.major; }));
            },
            secondariesOf: function (primary, secondaryUnit, heading, major, page) {
                return uniqueMenuValues(items.filter(function (it) {
                    return inScope(it, primary, secondaryUnit, heading, page, major);
                }).map(function (it) { return it.secondary; }));
            },
            minorsOf: function (primary, secondaryUnit, heading, major, secondary, page) {
                return uniqueMenuValues(items.filter(function (it) {
                    return inScope(it, primary, secondaryUnit, heading, page, major, secondary);
                }).map(function (it) { return it.minor; }));
            }
        };
    }

    function homeworkComboRecord(combo) {
        var named = trim(combo.label) || trim(combo.folder_name);
        return {
            id: String(combo.id),
            siblingIds: [],
            label: named,
            combo_label: named,
            rawLabel: named,
            folderId: String(combo.material_folder_id || ''),
            folderName: String(combo.folder_name || ''),
            driveFolderId: String(combo.drive_folder_id || ''),
            rootKind: 'teacher',
            sourceFile: '',
            extractionTemplateId: '',
            extractionTemplateName: '',
            sheetStems: [],
            metaFiles: [],
            ownSheets: [],
            sheetAvailableByStem: {},
            examTemplateIds: [],
            examTemplateId: '',
            isGroup: false,
            isBook: true,
            kind: 'book',
            primary_unit_word: trim(combo.primary_unit_word)
        };
    }

    function listAssignedForHomework(classId) {
        var cid = String(classId || '').trim().toLowerCase();
        if (!cid) return [];
        var assignedIds = {};
        _assigns.forEach(function (a) {
            if (String(a.class_id || '').trim().toLowerCase() === cid) {
                assignedIds[String(a.book_combo_id)] = true;
            }
        });
        return _combos.filter(function (c) { return assignedIds[String(c.id)]; })
            .map(homeworkComboRecord)
            .sort(function (a, b) { return comboLabel(a).localeCompare(comboLabel(b), 'zh-Hant'); });
    }

    function notifyBookLoaded() {
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.invalidateDisplayCaches === 'function') {
            window.FeatureClassMaterialCombinations.invalidateDisplayCaches();
        }
        var zone = document.getElementById('material-zone-container');
        if (zone && window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderMaterialZone === 'function') {
            window.FeatureClassMaterialCombinations.renderMaterialZone();
        }
        var bState = window.BuilderStore && typeof window.BuilderStore.getState === 'function'
            ? window.BuilderStore.getState()
            : null;
        if (bState && bState.containerId && document.getElementById(bState.containerId)
            && window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder({ skipSync: true });
        }
    }

    async function loadCollectorHints() {
        _hintsByFolder = {};
        if (!window.supabaseClient) return;
        var want = {};
        _combos.forEach(function (c) {
            folderAliasKeys(c.folder_name).forEach(function (k) { want[k] = true; });
            folderAliasKeys(c.label).forEach(function (k) { want[k] = true; });
        });
        if (!Object.keys(want).length) return;

        function storeHint(folder, row) {
            if (!folder) return;
            if (!_hintsByFolder[folder]) _hintsByFolder[folder] = [];
            _hintsByFolder[folder].push(row);
        }

        function ingestItem(folder, snapshot) {
            segmentsOfSnapshot(snapshot).forEach(function (seg) {
                storeHint(folder, hintRowFromSeg(seg));
            });
        }

        var blockPage = 1000;
        var blockFrom = 0;
        var blocks = [];
        while (true) {
            var listRes = await window.supabaseClient
                .from('class_script_blocks')
                .select('id, label')
                .range(blockFrom, blockFrom + blockPage - 1);
            if (listRes.error) {
                console.warn('[FeatureMaterialBook] 讀已有範圍（收集文稿）失敗', listRes.error);
                return;
            }
            var blockChunk = listRes.data || [];
            blocks = blocks.concat(blockChunk);
            if (blockChunk.length < blockPage) break;
            blockFrom += blockPage;
        }
        var folderOf = {};
        var ids = [];
        blocks.forEach(function (b) {
            var matchedKeys = folderAliasKeys(b && b.label).filter(function (k) { return want[k]; });
            if (!matchedKeys.length) return;
            folderOf[String(b.id)] = matchedKeys;
            ids.push(b.id);
        });
        if (!ids.length) return;
        var i;
        for (i = 0; i < ids.length; i += 80) {
            var slice = ids.slice(i, i + 80);
            var itemFrom = 0;
            var itemPage = 1000;
            while (true) {
                var itemRes = await window.supabaseClient
                    .from('class_script_block_items')
                    .select('id, block_id, snapshot')
                    .in('block_id', slice)
                    .order('id', { ascending: true })
                    .range(itemFrom, itemFrom + itemPage - 1);
                if (itemRes.error) {
                    console.warn('[FeatureMaterialBook] 讀已有範圍（收集文稿）失敗', itemRes.error);
                    return;
                }
                var itemChunk = itemRes.data || [];
                itemChunk.forEach(function (it) {
                    (folderOf[String(it.block_id)] || []).forEach(function (folder) {
                        ingestItem(folder, it && it.snapshot);
                    });
                });
                if (itemChunk.length < itemPage) break;
                itemFrom += itemPage;
            }
        }
    }

    function ensureLoaded() {
        if (_loaded) return Promise.resolve();
        if (_loadPromise) return _loadPromise;
        _loadPromise = (async function () {
            if (!window.supabaseClient) {
                _loaded = true;
                return;
            }
            var fullSelect = 'id, teacher_id, material_folder_id, folder_name, drive_folder_id, label, primary_unit_word, updated_at';
            var slimSelect = 'id, teacher_id, material_folder_id, folder_name, drive_folder_id, label, updated_at';
            var comboRes = await window.supabaseClient
                .from('material_book_combos')
                .select(fullSelect)
                .order('folder_name', { ascending: true });
            if (comboRes.error) {
                console.warn('[FeatureMaterialBook] 目錄套餐載入（含主單元單位）失敗，改讀舊欄。已有的卡仍要顯示', comboRes.error);
                comboRes = await window.supabaseClient
                    .from('material_book_combos')
                    .select(slimSelect)
                    .order('folder_name', { ascending: true });
            }
            if (comboRes.error) {
                console.warn('[FeatureMaterialBook] 目錄套餐載入失敗', comboRes.error);
                _combos = [];
                _assigns = [];
                _items = [];
                _loaded = true;
                return;
            }
            _combos = (comboRes.data || []).map(function (c) {
                if (!c) return c;
                if (c.primary_unit_word == null) c.primary_unit_word = '';
                return c;
            });
            var ids = _combos.map(function (c) { return c.id; });
            if (!ids.length) {
                _assigns = [];
                _items = [];
                _loaded = true;
                return;
            }
            var asgRes = await window.supabaseClient
                .from('class_material_book_combos')
                .select('id, class_id, book_combo_id')
                .in('book_combo_id', ids);
            if (asgRes.error) {
                console.warn('[FeatureMaterialBook] 班級勾選載入失敗', asgRes.error);
                _assigns = [];
            } else {
                _assigns = asgRes.data || [];
            }
            await loadCollectorHints();
            _loaded = true;
            loadRangeItemsInBackground();
        })().then(function () {
            if (_loaded) notifyBookLoaded();
        }).finally(function () { _loadPromise = null; });
        return _loadPromise;
    }

    async function fetchRangeItemPages(selectCols, comboIds) {
        var page = 1000;
        var from = 0;
        var all = [];
        var ids = (comboIds || []).filter(Boolean);
        if (!ids.length) return { data: [], error: null };
        while (true) {
            var res = await window.supabaseClient
                .from('material_book_range_items')
                .select(selectCols)
                .in('book_combo_id', ids)
                .order('id', { ascending: true })
                .range(from, from + page - 1);
            if (res.error) return res;
            var chunk = res.data || [];
            all = all.concat(chunk);
            if (chunk.length < page) return { data: all, error: null };
            from += page;
        }
    }

    function loadRangeItemsInBackground() {
        if (!window.supabaseClient) return;
        var comboIds = _combos.map(function (c) { return c && c.id; }).filter(Boolean);
        var fullSelect = 'id, book_combo_id, teacher_id, primary_unit, secondary_unit, heading, major, secondary, minor, script, source_assignment_id, source_task_id, progress_date, drive_file_id, drive_file_name, updated_at';
        var slimSelect = 'id, book_combo_id, teacher_id, major, secondary, minor, script, source_assignment_id, source_task_id, progress_date, drive_file_id, drive_file_name, updated_at';
        (async function () {
            var res = await fetchRangeItemPages(fullSelect, comboIds);
            if (res.error) {
                console.warn('[FeatureMaterialBook] 範圍列載入（含主／次／標題）失敗，改讀舊欄', res.error);
                res = await fetchRangeItemPages(slimSelect, comboIds);
            }
            if (res.error) {
                console.warn('[FeatureMaterialBook] 範圍列載入失敗（目錄套餐卡仍顯示）', res.error);
                _items = [];
            } else {
                _items = res.data || [];
            }
            notifyBookLoaded();
        })().catch(function (err) {
            console.warn('[FeatureMaterialBook] 範圍列載入失敗（目錄套餐卡仍顯示）', err);
            _items = [];
            notifyBookLoaded();
        });
    }

    function classChecksHtml(assignedIds) {
        var assigned = (assignedIds || []).map(String);
        var classes = allClasses();
        if (!classes.length) return '<div style="color:#94A3B8; font-size:0.78rem;">目前沒有任何班級</div>';
        return classes.map(function (c) {
            var checked = assigned.indexOf(String(c.id)) !== -1;
            return '<label style="display:inline-flex; align-items:center; gap:4px; margin:2px 10px 2px 0; font-size:0.78rem; color:#334155;">'
                + '<input type="checkbox" class="mz-book-class-cb" value="' + esc(c.id) + '"' + (checked ? ' checked' : '') + '>'
                + esc(c.name || c.id)
                + '</label>';
        }).join('');
    }

    var UNIT_WORD_PRESETS = ['Unit', 'Ch', 'Lesson'];

    function comboUnitWord(combo) {
        return trim(combo && combo.primary_unit_word);
    }

    function knownUnitWords() {
        var seen = {};
        var out = [];
        function add(w) {
            var t = trim(w);
            var k = t.toUpperCase();
            if (!t || seen[k]) return;
            seen[k] = true;
            out.push(t);
        }
        UNIT_WORD_PRESETS.forEach(add);
        _combos.forEach(function (c) { add(c && c.primary_unit_word); });
        return out;
    }

    function primarySheetLabel(combo, pu) {
        var word = comboUnitWord(combo);
        var num = trim(pu);
        if (!num || num === '（未填主單元）') return '（未填主單元）';
        if (word) return word + ' ' + num;
        return '主單元　' + num;
    }

    function unitWordPickerHtml(combo) {
        var current = comboUnitWord(combo);
        var known = knownUnitWords();
        var isPreset = known.some(function (w) { return w.toUpperCase() === current.toUpperCase(); });
        var selectedKnown = current && isPreset;
        var selectedManual = !!(current && !isPreset);
        var opts = '<option value=""' + (!current ? ' selected' : '') + '>（未指定）</option>';
        known.forEach(function (w) {
            opts += '<option value="' + esc(w) + '"' + (selectedKnown && w.toUpperCase() === current.toUpperCase() ? ' selected' : '') + '>' + esc(w) + '</option>';
        });
        opts += '<option value="' + MANUAL_PICK + '"' + (selectedManual ? ' selected' : '') + '>其他（手動輸入）</option>';
        return (
            '<div class="mz-book-unit-word-row">'
            + '<label>主單元單位'
            + '<select class="mz-book-unit-word form-control">' + opts + '</select>'
            + '</label>'
            + '<input type="text" class="mz-book-unit-word-manual form-control" placeholder="手打單位，例如 Module"'
            + ' value="' + esc(selectedManual ? current : '') + '"'
            + ' style="' + (selectedManual ? '' : 'display:none;') + '">'
            + '</div>'
        );
    }

    function readUnitWordFromCard(card) {
        var sel = card && card.querySelector('.mz-book-unit-word');
        var manual = card && card.querySelector('.mz-book-unit-word-manual');
        var v = sel ? String(sel.value || '').trim() : '';
        if (v === MANUAL_PICK) return trim(manual && manual.value);
        return v;
    }

    function bindUnitWordPicker(card) {
        if (!card) return;
        var sel = card.querySelector('.mz-book-unit-word');
        var manual = card.querySelector('.mz-book-unit-word-manual');
        if (!sel || !manual) return;
        sel.addEventListener('change', function () {
            var show = sel.value === MANUAL_PICK;
            manual.style.display = show ? '' : 'none';
            if (show) manual.focus();
        });
    }

    function treeHtml(combo) {
        var items = treeSourceItems(combo);
        if (!items.length) {
            return '<div style="font-size:0.78rem; color:#64748B; font-weight:700;">尚未收集範圍。出作業選這張卡、填主單元／次單元／標題／大題／次題／小題後會出現在這裡。</div>';
        }
        var primaries = uniqueUnitValues(items.map(function (it) { return it.primary_unit || '（未填主單元）'; }));
        return '<div class="mz-book-sheets">' + primaries.map(function (pu) {
            var puItems = items.filter(function (it) {
                return (trim(it.primary_unit) || '（未填主單元）') === pu;
            });
            var sus = uniqueValues(puItems.map(function (it) { return it.secondary_unit || '（未填次單元）'; }));
            var suHtml = sus.map(function (su) {
                var suItems = puItems.filter(function (it) {
                    return (trim(it.secondary_unit) || '（未填次單元）') === su;
                });
                var headings = uniqueValues(suItems.map(function (it) { return it.heading || '（未填標題）'; }));
                var headHtml = headings.map(function (hd) {
                    var hdItems = suItems.filter(function (it) {
                        return (trim(it.heading) || '（未填標題）') === hd;
                    });
                    var majors = uniqueValues(hdItems.map(function (it) { return it.major || '（未填大題）'; }));
                    var majHtml = majors.map(function (maj) {
                        var majItems = hdItems.filter(function (it) {
                            return (trim(it.major) || '（未填大題）') === maj;
                        });
                        var secs = uniqueValues(majItems.map(function (it) { return it.secondary || '（未填次題）'; }));
                        var secHtml = secs.map(function (sec) {
                            var secItems = majItems.filter(function (it) {
                                return (trim(it.secondary) || '（未填次題）') === sec;
                            });
                            var leaves = secItems.map(function (it) {
                                var lab = trim(it.minor) ? ('小題 ' + it.minor) : '（未填小題）';
                                var file = trim(it.drive_file_name) ? ('　' + it.drive_file_name) : '';
                                var hasScript = !!trim(it.script);
                                return '<div class="mz-book-leaf">▫️ '
                                    + esc(lab) + (hasScript ? '　有文稿' : '　文稿空') + esc(file) + '</div>';
                            }).join('');
                            return '<div class="mz-book-line">次題　' + esc(sec) + '</div>' + leaves;
                        }).join('');
                        return '<details class="mz-book-folder"><summary>大題　' + esc(maj) + '</summary>'
                            + secHtml + '</details>';
                    }).join('');
                    return '<div class="mz-book-line">標題　' + esc(hd) + '</div>' + majHtml;
                }).join('');
                return '<details class="mz-book-folder"><summary>次單元　' + esc(su) + '</summary>'
                    + headHtml + '</details>';
            }).join('');
            return '<details class="mz-book-sheet" data-primary="' + esc(pu) + '">'
                + '<summary>' + esc(primarySheetLabel(combo, pu)) + '</summary>'
                + suHtml + '</details>';
        }).join('') + '</div>';
    }

    function cardHtml(combo) {
        var named = trim(combo.label) || trim(combo.folder_name);
        return (
            '<div class="mz-card mz-book-card" data-book-id="' + esc(combo.id) + '">'
            + '<div style="font-weight:800; color:#1E3A8A; margin-bottom:6px;">目錄套餐（收集成書；不是從檔自動產生）</div>'
            + '<label style="display:block; font-weight:800; color:#92400E; margin-bottom:2px;">目錄套餐（出作業下拉會顯示這個）</label>'
            + '<input type="text" class="mz-book-label" value="' + esc(named) + '" placeholder="例如 Our World 2" style="width:100%; box-sizing:border-box; font-weight:800; color:#78350F; margin-bottom:8px; padding:8px 10px; font-size:1rem;">'
            + '<details class="mz-class-details" style="margin-top:8px;">'
            + '<summary style="font-weight:800; color:#15803D; cursor:pointer;">' + esc((function () {
                var ids = assignsForCombo(combo.id);
                var names = allClasses().filter(function (c) { return ids.indexOf(String(c.id)) !== -1; }).map(function (c) { return c.name || c.id; });
                if (!names.length) return '採用班級　尚未勾選';
                if (names.length <= 2) return '採用班級　' + names.join('、');
                return '採用班級　' + names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 班';
            })()) + '</summary>'
            + '<div class="mz-book-class-box" style="margin-top:6px;">' + classChecksHtml(assignsForCombo(combo.id)) + '</div>'
            + '</details>'
            + unitWordPickerHtml(combo)
            + '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed #93C5FD;">'
            + '<div style="font-weight:800; color:#1E3A8A; margin-bottom:4px;">已收集範圍</div>'
            + treeHtml(combo)
            + '</div>'
            + '<div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<button type="button" class="mz-book-save btn btn-primary" style="border-radius:6px; font-weight:800; cursor:pointer;">儲存設定</button>'
            + '<button type="button" class="mz-book-del btn" style="border-radius:6px; border:1px solid #FCA5A5; background:#FEF2F2; color:#B91C1C; font-weight:800; cursor:pointer;">刪這張卡</button>'
            + '<span class="mz-book-msg" style="font-weight:700;"></span>'
            + '</div>'
            + '</div>'
        );
    }

    function renderFolderHtml(folderName) {
        var cards = combosForFolder(folderName).map(cardHtml).join('');
        if (!cards) return '';
        return (
            '<div class="mz-book-panel" data-folder-name="' + esc(folderName || '') + '">'
            + cards
            + '</div>'
        );
    }

    function catalogCreateFolderNames() {
        var seen = {};
        var out = [];
        function add(name) {
            var n = trim(name);
            var u = n.toUpperCase();
            if (!n || seen[u]) return;
            seen[u] = true;
            out.push(n);
        }
        function addExamJob(classId, rootKind) {
            if (!window.FeatureExamJob || typeof window.FeatureExamJob.getUniqueFolderNames !== 'function') return;
            (window.FeatureExamJob.getUniqueFolderNames(classId, rootKind) || []).forEach(add);
        }
        function addPdf(classId, rootKind) {
            if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMaterialPdfOptions !== 'function') return;
            (window.FeatureTimeline.getMaterialPdfOptions(classId, rootKind) || []).forEach(function (o) {
                add(o && o.folderName);
            });
        }
        try { addExamJob('', 'teacher'); } catch (_e) {}
        try { addPdf('', 'teacher'); } catch (_e2) {}
        allClasses().forEach(function (cls) {
            if (!cls || !cls.id) return;
            try { addExamJob(cls.id, 'class'); } catch (_e3) {}
            try { addPdf(cls.id, 'class'); } catch (_e4) {}
        });
        if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.folderNames === 'function') {
            try { (window.MaterialComboStrategies.folderNames() || []).forEach(add); } catch (_e5) {}
        }
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.zoneFolderNames === 'function') {
            try { (window.FeatureClassMaterialCombinations.zoneFolderNames() || []).forEach(add); } catch (_e6) {}
        }
        _combos.forEach(function (c) { add(c.folder_name); });
        out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
        return out;
    }

    function paintCreatePanel(wrap) {
        var folders = catalogCreateFolderNames();
        var rowsHtml = folders.length
            ? folders.map(function (n) {
                var have = combosForFolder(n).length;
                var note = have
                    ? ('<span style="color:#0F766E; font-weight:700;">已有 ' + have + ' 張</span>')
                    : '<span style="color:#64748B; font-weight:700;">尚未新增</span>';
                return '<div class="mz-book-create-row" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:8px 0; border-bottom:1px dashed #BFDBFE;">'
                    + '<div style="font-weight:800; color:#1E3A8A; min-width:160px;">📁 ' + esc(n) + '</div>'
                    + note
                    + '<button type="button" class="mz-book-add btn btn-primary" data-folder-name="' + esc(n) + '">＋ 新增目錄套餐</button>'
                    + '</div>';
            }).join('')
            : '<div style="font-weight:700; color:#64748B;">還沒列到教材資料夾。教材區已有的夾載入後會出現在這裡，每一夾自己一顆＋。</div>';
        wrap.innerHTML = (
            '<div style="background:white; padding:20px; border-radius:12px; border:2px solid #93C5FD; margin-bottom:16px;">'
            + '<h3 style="margin:0 0 4px 0; color:#1E3A8A;">📚 目錄套餐（選夾後＋新增；不是從檔自動產生）</h3>'
            + '<p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">這塊只產生目錄套餐，不准跟 Excel/JSON 套用、也不准跟 PDF 套用合併。下面每一個教材資料夾自己一顆＋。出作業選這張卡、填主單元／次單元／標題／大題／次題／小題才收集。教材區窗口只顯示已有卡，沒有＋。</p>'
            + '<div class="mz-book-create-msg" style="font-weight:700; margin-bottom:8px;"></div>'
            + rowsHtml
            + '</div>'
        );
        bindCreate(wrap);
    }

    function renderCreatePanel() {
        var wrap = document.getElementById('catalog-combo-create-container');
        if (!wrap) return;
        try { paintCreatePanel(wrap); } catch (err) {
            wrap.innerHTML = '<div style="padding:16px; color:#EF4444; font-weight:800;">目錄套餐區塊載入失敗：' + esc(err.message || err) + '</div>';
            return;
        }
        var jobs = [ensureLoaded()];
        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            jobs.push(window.FeatureTimeline.ensureMetaCatalog('', 'teacher', { force: false }).catch(function () {}));
            allClasses().forEach(function (cls) {
                if (cls && cls.id) {
                    jobs.push(window.FeatureTimeline.ensureMetaCatalog(cls.id, 'class', { force: false }).catch(function () {}));
                }
            });
        }
        Promise.all(jobs).then(function () {
            paintCreatePanel(wrap);
        }).catch(function (err) {
            var msg = wrap.querySelector('.mz-book-create-msg');
            if (msg) {
                msg.style.color = '#B91C1C';
                msg.textContent = '載入失敗：' + (err.message || err);
            }
        });
    }

    function bindCreate(wrap) {
        if (!wrap) return;
        wrap.querySelectorAll('.mz-book-add').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var folderName = btn.getAttribute('data-folder-name');
                var msg = wrap.querySelector('.mz-book-create-msg');
                btn.disabled = true;
                if (msg) { msg.style.color = '#0F766E'; msg.textContent = '新增中…'; }
                try {
                    await createCombo(folderName);
                    if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderMaterialZone === 'function') {
                        window.FeatureClassMaterialCombinations.renderMaterialZone();
                    }
                    renderCreatePanel();
                } catch (err) {
                    window.showFlash && window.showFlash('新增目錄套餐失敗：' + (err.message || err), 'error');
                    if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '新增失敗：' + (err.message || err); }
                    btn.disabled = false;
                }
            });
        });
    }

    async function saveClassLinks(comboId, classIds) {
        var want = {};
        (classIds || []).forEach(function (id) { if (id) want[String(id)] = true; });
        var existing = _assigns.filter(function (a) { return String(a.book_combo_id) === String(comboId); });
        var i;
        for (i = 0; i < existing.length; i++) {
            if (!want[String(existing[i].class_id)]) {
                var del = await window.supabaseClient.from('class_material_book_combos').delete().eq('id', existing[i].id);
                if (del.error) throw del.error;
            }
        }
        var have = {};
        existing.forEach(function (a) { have[String(a.class_id)] = true; });
        var toAdd = Object.keys(want).filter(function (id) { return !have[id]; });
        if (toAdd.length) {
            var ins = await window.supabaseClient.from('class_material_book_combos').insert(toAdd.map(function (cid) {
                return { class_id: cid, book_combo_id: comboId };
            }));
            if (ins.error) throw ins.error;
        }
    }

    async function createCombo(folderName) {
        var userId = await getCurrentUserId();
        if (!userId) throw new Error('尚未登入');
        var name = trim(folderName);
        if (!name) throw new Error('沒有教材資料夾');
        var driveId = driveFolderIdForFolderName(name);
        var res = await window.supabaseClient.from('material_book_combos').insert({
            teacher_id: userId,
            folder_name: name,
            drive_folder_id: driveId,
            label: name
        }).select().single();
        if (res.error) throw res.error;
        _loaded = false;
        await ensureLoaded();
        return res.data;
    }

    async function saveComboCard(combo, card) {
        var labelEl = card.querySelector('.mz-book-label');
        var label = trim(labelEl && labelEl.value) || trim(combo.folder_name);
        var classIds = [];
        card.querySelectorAll('.mz-book-class-cb:checked').forEach(function (cb) {
            classIds.push(cb.value);
        });
        var driveId = trim(combo.drive_folder_id) || driveFolderIdForFolderName(combo.folder_name);
        var payload = {
            label: label,
            drive_folder_id: driveId,
            primary_unit_word: readUnitWordFromCard(card),
            updated_at: new Date().toISOString()
        };
        var upd = await window.supabaseClient.from('material_book_combos').update(payload).eq('id', combo.id);
        if (upd.error) {
            console.warn('[FeatureMaterialBook] 儲存含主單元單位失敗，改存舊欄。卡本身不准不見', upd.error);
            upd = await window.supabaseClient.from('material_book_combos').update({
                label: payload.label,
                drive_folder_id: payload.drive_folder_id,
                updated_at: payload.updated_at
            }).eq('id', combo.id);
        }
        if (upd.error) throw upd.error;
        await saveClassLinks(combo.id, classIds);
        _loaded = false;
        await ensureLoaded();
    }

    async function deleteCombo(combo) {
        var res = await window.supabaseClient.from('material_book_combos').delete().eq('id', combo.id);
        if (res.error) throw res.error;
        _loaded = false;
        await ensureLoaded();
    }

    async function uploadRangeText(combo, row, script) {
        var text = trim(script);
        if (!text) return { fileId: '', fileName: '' };
        var folderId = trim(combo.drive_folder_id) || driveFolderIdForFolderName(combo.folder_name);
        if (!folderId) return { fileId: '', fileName: '' };
        var fileName = fileNameFromRange(row);
        if (!fileName) return { fileId: '', fileName: '' };
        if (!window.GasService || typeof window.GasService.uploadMaterialFile !== 'function') {
            throw new Error('GasService.uploadMaterialFile 尚未載入');
        }
        var up = await window.GasService.uploadMaterialFile(utf8ToBase64(text), fileName, 'text/plain', folderId);
        return { fileId: String((up && up.fileId) || ''), fileName: String((up && up.finalFileName) || fileName) };
    }

    function walkPackHosts(list, out) {
        (list || []).forEach(function (node) {
            if (node && node.raw_data && Array.isArray(node.raw_data.pack_rows) && node.raw_data.pack_rows.length) {
                out.push(node);
            }
            if (node && Array.isArray(node.subTasks) && node.subTasks.length) {
                walkPackHosts(node.subTasks, out);
            }
        });
    }

    async function collectFromSavedAssignment(assignmentId, payload) {
        var userId = await getCurrentUserId();
        if (!userId || !assignmentId) return;
        await ensureLoaded();
        var hosts = [];
        walkPackHosts((payload && payload.tasks) || [], hosts);
        var progressDate = payload && payload.target_date ? String(payload.target_date).slice(0, 10) : null;
        var i;
        var j;
        for (i = 0; i < hosts.length; i++) {
            var host = hosts[i];
            var rows = (host.raw_data && nodeRows(host)) || [];
            for (j = 0; j < rows.length; j++) {
                var row = rows[j];
                var combo = _combos.filter(function (c) { return String(c.id) === String(row.combo_id); })[0];
                if (!combo) continue;
                var primaryUnit = trim(row.primary_unit);
                var secondaryUnit = trim(row.secondary_unit);
                var heading = trim(row.heading);
                var major = trim(row.major);
                var secondary = trim(row.secondary);
                var minor = trim(row.minor);
                if (!primaryUnit && !secondaryUnit && !heading && !major && !secondary && !minor) continue;
                var script = trim(row.book_script);
                var taskId = String((host && host.id) || '') + '|' + j;
                var existing = _items.filter(function (it) {
                    return String(it.book_combo_id) === String(combo.id)
                        && String(it.source_assignment_id || '') === String(assignmentId)
                        && String(it.source_task_id || '') === taskId;
                })[0];
                var file = { fileId: '', fileName: '' };
                var rangeRow = {
                    primary_unit: primaryUnit,
                    secondary_unit: secondaryUnit,
                    heading: heading,
                    major: major,
                    secondary: secondary,
                    minor: minor
                };
                try {
                    file = await uploadRangeText(combo, rangeRow, script);
                } catch (err) {
                    console.warn('[FeatureMaterialBook] 寫進教材資料夾失敗', err);
                    if (window.showFlash) {
                        window.showFlash('範圍已記下，但寫進教材資料夾失敗：' + (err.message || err), 'error');
                    }
                }
                var payloadRow = {
                    book_combo_id: combo.id,
                    teacher_id: userId,
                    primary_unit: primaryUnit,
                    secondary_unit: secondaryUnit,
                    heading: heading,
                    major: major,
                    secondary: secondary,
                    minor: minor,
                    script: script,
                    source_assignment_id: assignmentId,
                    source_task_id: taskId,
                    progress_date: progressDate,
                    drive_file_id: file.fileId || (existing && existing.drive_file_id) || '',
                    drive_file_name: file.fileName || (existing && existing.drive_file_name) || '',
                    updated_at: new Date().toISOString()
                };
                if (existing) {
                    var upd = await window.supabaseClient.from('material_book_range_items').update(payloadRow).eq('id', existing.id);
                    if (upd.error) throw upd.error;
                } else {
                    var ins = await window.supabaseClient.from('material_book_range_items').insert(payloadRow);
                    if (ins.error) throw ins.error;
                }
            }
        }
        _loaded = false;
        await ensureLoaded();
    }

    function nodeRows(host) {
        return (host.raw_data.pack_rows || []).map(function (r) {
            return {
                combo_id: String((r && r.combo_id) || '').trim(),
                primary_unit: trim(r && (r.primary_unit || r.primaryUnit)),
                secondary_unit: trim(r && (r.secondary_unit || r.secondaryUnit)),
                heading: trim(r && (r.heading || r.range_heading)),
                major: trim(r && r.major),
                secondary: trim(r && r.secondary),
                minor: trim(r && r.minor),
                page: trim(r && r.page),
                book_script: trim(r && r.book_script)
            };
        });
    }

    function datalistHtml(id, values) {
        if (!(values || []).length) return '';
        return '<datalist id="' + esc(id) + '">'
            + values.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('')
            + '</datalist>';
    }

    function renderCollectorHtml() {
        if (!_combos.length) {
            return '<div style="background:white; padding:16px; border-radius:12px; border:2px solid #C7D2FE; margin-bottom:16px;">'
                + '<div style="font-weight:900; color:#1E3A8A;">📚 教材目錄套餐（全域）</div>'
                + '<div style="font-size:0.82rem; color:#64748B; margin-top:6px; line-height:1.6;">尚未建立。到教材範本管理「目錄套餐」區塊選資料夾後按「＋ 新增目錄套餐」。出作業選這張卡、填主單元／次單元／標題／大題／次題／小題就會收集到這裡。有文稿才寫 txt 進該教材資料夾。不是從夾裡的檔自動產卡。</div>'
                + '</div>';
        }
        return '<div style="background:white; padding:16px; border-radius:12px; border:2px solid #C7D2FE; margin-bottom:16px;">'
            + '<div style="font-weight:900; color:#1E3A8A; margin-bottom:6px;">📚 教材目錄套餐（已收集範圍）</div>'
            + '<div style="font-size:0.82rem; color:#64748B; margin-bottom:10px; line-height:1.6;">出作業選書＋填範圍＝收集。主單元／次單元／標題／大題／次題／小題都提供，這次填到哪由老師定。有文稿才寫進該教材資料夾。Mason Shen 與 Ava 勾同一本就是同一本。</div>'
            + _combos.map(function (c) {
                return '<div style="margin-top:10px; padding:10px; border:1px dashed #93C5FD; border-radius:8px; background:#F8FAFC;">'
                    + '<div style="font-weight:800; color:#1E3A8A;">' + esc(comboLabel(c) || c.folder_name)
                    + '　<span style="font-weight:700; color:#64748B;">' + esc(c.folder_name || '') + '</span></div>'
                    + treeHtml(c)
                    + '</div>';
            }).join('')
            + '</div>';
    }

    function copyRangeFields(r) {
        return {
            primary_unit: trim(r && (r.primary_unit || r.primaryUnit)),
            secondary_unit: trim(r && (r.secondary_unit || r.secondaryUnit)),
            heading: trim(r && (r.heading || r.range_heading)),
            major: trim(r && r.major),
            secondary: trim(r && r.secondary),
            minor: trim(r && r.minor),
            page: trim(r && r.page),
            book_script: trim(r && (r.book_script || r.bookScript))
        };
    }

    function rowLooksLike(r) {
        return !!(trim(r && (r.primary_unit || r.primaryUnit))
            || trim(r && (r.secondary_unit || r.secondaryUnit))
            || trim(r && (r.heading || r.range_heading))
            || trim(r && r.major)
            || trim(r && r.secondary)
            || trim(r && r.minor)
            || trim(r && r.page)
            || trim(r && (r.book_script || r.bookScript)));
    }

    function readRowFields(pathStr, idx) {
        function val(id) {
            var el = document.getElementById(id);
            return el ? String(el.value || '').trim() : '';
        }
        var parsed = parseUnitPair(val('range-pack-book-unit-pair-' + pathStr + '-' + idx));
        return {
            primary_unit: parsed.primary,
            secondary_unit: parsed.secondary,
            heading: val('range-pack-book-heading-' + pathStr + '-' + idx),
            major: val('range-pack-book-major-' + pathStr + '-' + idx),
            secondary: val('range-pack-book-secondary-' + pathStr + '-' + idx),
            minor: val('range-pack-book-minor-' + pathStr + '-' + idx),
            page: val('range-pack-book-page-' + pathStr + '-' + idx),
            book_script: val('range-pack-book-script-' + pathStr + '-' + idx)
        };
    }

    function expandPackRows(_classId, combo, prevRows, helpers) {
        var h = helpers || {};
        var label = (typeof h.comboLabelText === 'function') ? h.comboLabelText(combo) : trim(combo && combo.combo_label);
        var examOf = (typeof h.copyPackExamFields === 'function') ? h.copyPackExamFields : function () { return {}; };
        var blank = (typeof h.blankPackExamFields === 'function') ? h.blankPackExamFields() : {};
        var prev = Array.isArray(prevRows) ? prevRows : [];
        function rowFrom(r) {
            return Object.assign({
                combo_id: combo.id,
                combo_label: label,
                meta_file: '',
                range_type: 'page',
                start: '',
                end: ''
            }, r ? examOf(r) : blank, copyRangeFields(r));
        }
        if (prev.length) return prev.map(rowFrom);
        return [rowFrom(null)];
    }

    function nextSectionRow(combo, last, helpers) {
        var h = helpers || {};
        var blank = (typeof h.blankPackExamFields === 'function') ? h.blankPackExamFields() : {};
        var label = (combo && typeof h.comboLabelText === 'function')
            ? h.comboLabelText(combo)
            : trim(last && last.combo_label);
        return Object.assign({
            combo_id: (combo && combo.id) || trim(last && last.combo_id),
            combo_label: label,
            meta_file: '',
            range_type: 'page',
            start: '',
            end: ''
        }, blank, copyRangeFields(null));
    }

    function renderPackTableHtml(ctx) {
        var packUi = (ctx && ctx.packUi) || {};
        var pathStr = (ctx && ctx.pathStr) || '';
        var rows = (ctx && ctx.block && ctx.block.rows) || [];
        var combo = ctx && ctx.blockCombo;
        var isManual = !!(ctx && ctx.isManual);
        var startIdx = Number(ctx && ctx.startIdx) || 0;
        var blockRowCount = rows.length;
        var on = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })';
        var htmlRows = rows.map(function (row, posInBlock) {
            var idx = startIdx + posInBlock;
            var delSheet = packUi.packRowDeleteBtn ? packUi.packRowDeleteBtn(pathStr, idx, blockRowCount > 1) : '';
            var orderCell = packUi.packRowOrderControls ? packUi.packRowOrderControls(pathStr, idx, posInBlock, blockRowCount) : '';
            var drop = packUi.rowDropAttr ? packUi.rowDropAttr(pathStr, idx) : '';
            var nameCell = isManual
                ? ('<div><input type="text" id="range-pack-manual-' + pathStr + '-' + idx + '" class="form-control range-pack-manual"'
                    + ' value="' + esc(row && row.combo_label) + '" placeholder="手動輸入教材" oninput="' + on + '"></div>')
                : '';
            return '<div class="range-pack-row range-pack-row--book' + (isManual ? ' range-pack-row--book-manual' : '') + '"' + drop
                + orderCell
                + nameCell
                + bookRowInputsHtml(pathStr, idx, row, combo, rows)
                + '<div>' + delSheet + '</div>'
                + '</div>';
        }).join('');
        var html = rows.length
            ? ('<div class="range-pack-table"><div class="range-pack-table-inner">'
                + '<div class="range-pack-head range-pack-head--book' + (isManual ? ' range-pack-head--book-manual' : '') + '"><div></div>'
                + (isManual ? '<div>教材</div>' : '')
                + '<div>主／次單元</div><div>頁碼</div><div>標題</div><div>大題</div><div>次題</div><div>小題</div><div>目錄文稿（可空）</div><div>刪</div></div>'
                + htmlRows
                + '</div></div>')
            : '';
        return { html: html, rowCount: rows.length, showsExamStats: false };
    }

    function bookRowInputsHtml(pathStr, idx, row, combo, extraRows) {
        var cat = rangeCatalog(combo, extraRows);
        var pairId = 'range-pack-book-unit-pair-' + pathStr + '-' + idx;
        var pageId = 'range-pack-book-page-' + pathStr + '-' + idx;
        var headingId = 'range-pack-book-heading-' + pathStr + '-' + idx;
        var majorId = 'range-pack-book-major-' + pathStr + '-' + idx;
        var secId = 'range-pack-book-secondary-' + pathStr + '-' + idx;
        var minId = 'range-pack-book-minor-' + pathStr + '-' + idx;
        var scriptId = 'range-pack-book-script-' + pathStr + '-' + idx;
        var primaryUnit = trim(row && (row.primary_unit || row.primaryUnit));
        var secondaryUnit = trim(row && (row.secondary_unit || row.secondaryUnit));
        var heading = trim(row && (row.heading || row.range_heading));
        var major = trim(row && row.major);
        var secondary = trim(row && row.secondary);
        var page = trim(row && row.page);
        var pair = unitPairLabel(primaryUnit, secondaryUnit);
        var on = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })';
        return (
            '<div>'
            + bookPickHtml(pathStr, pairId, pair, cat.unitPairs, '主-次', true)
            + '</div>'
            + '<div>'
            + bookPickHtml(pathStr, pageId, page, cat.pagesOf(primaryUnit, secondaryUnit), '頁碼', false)
            + '</div>'
            + '<div>'
            + bookPickHtml(pathStr, headingId, heading, cat.headingsOf(primaryUnit, secondaryUnit, page), '標題', false)
            + '</div>'
            + '<div>'
            + bookPickHtml(pathStr, majorId, major, cat.majorsOf(primaryUnit, secondaryUnit, heading, page), '大題', false)
            + '</div>'
            + '<div>'
            + bookPickHtml(pathStr, secId, secondary, cat.secondariesOf(primaryUnit, secondaryUnit, heading, major, page), '次題', false)
            + '</div>'
            + '<div>'
            + bookPickHtml(pathStr, minId, trim(row && row.minor), cat.minorsOf(primaryUnit, secondaryUnit, heading, major, secondary, page), '小題', false)
            + '</div>'
            + '<div>'
            + '<input id="' + scriptId + '" class="form-control range-pack-book-script" value="' + esc(row && row.book_script) + '" placeholder="可空。不是口說答案" title="要寫進教材資料夾的正文才填；沒有就留空。口說答案在錄音那格。" oninput="' + on + '">'
            + '</div>'
        );
    }

    function bind(wrap) {
        if (!wrap) return;
        wrap.querySelectorAll('.mz-book-card').forEach(bindUnitWordPicker);
        wrap.querySelectorAll('.mz-book-save').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var card = btn.closest('.mz-book-card');
                var id = card && card.getAttribute('data-book-id');
                var combo = _combos.filter(function (c) { return String(c.id) === String(id); })[0];
                var msg = card && card.querySelector('.mz-book-msg');
                if (!combo || !card) return;
                btn.disabled = true;
                btn.textContent = '儲存中…';
                if (msg) { msg.style.color = '#0F766E'; msg.textContent = '儲存中…'; }
                try {
                    await saveComboCard(combo, card);
                    if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderMaterialZone === 'function') {
                        window.FeatureClassMaterialCombinations.renderMaterialZone();
                    }
                } catch (err) {
                    btn.disabled = false;
                    btn.textContent = '儲存設定';
                    if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '儲存失敗：' + (err.message || err); }
                }
            });
        });
        wrap.querySelectorAll('.mz-book-del').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var card = btn.closest('.mz-book-card');
                var id = card && card.getAttribute('data-book-id');
                var combo = _combos.filter(function (c) { return String(c.id) === String(id); })[0];
                if (!combo) return;
                var ok = true;
                if (window.ModalOverlay && typeof window.ModalOverlay.confirm === 'function') {
                    ok = await window.ModalOverlay.confirm('刪掉這張目錄套餐卡？已收集的範圍一併刪除。教材資料夾裡的檔不會刪。');
                }
                if (!ok) return;
                btn.disabled = true;
                try {
                    await deleteCombo(combo);
                    if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderMaterialZone === 'function') {
                        window.FeatureClassMaterialCombinations.renderMaterialZone();
                    }
                } catch (err) {
                    btn.disabled = false;
                    window.showFlash && window.showFlash('刪除失敗：' + (err.message || err), 'error');
                }
            });
        });
    }

    var api = {
        ensureLoaded: ensureLoaded,
        renderFolderHtml: renderFolderHtml,
        renderCreatePanel: renderCreatePanel,
        bind: bind,
        isBookCombo: isBookCombo,
        listAssignedForHomework: listAssignedForHomework,
        rangeCatalog: rangeCatalog,
        rangeLabel: rangeLabel,
        pasteWindowLabel: pasteWindowLabel,
        parseUnitPair: parseUnitPair,
        onBookPickChange: onBookPickChange,
        bookRowInputsHtml: bookRowInputsHtml,
        copyRangeFields: copyRangeFields,
        readRowFields: readRowFields,
        collectFromSavedAssignment: collectFromSavedAssignment,
        renderCollectorHtml: renderCollectorHtml,
        folderNames: folderNames,
        getCombo: function (id) {
            return _combos.filter(function (c) { return String(c.id) === String(id); })[0] || null;
        },
        isReady: function () { return _loaded; }
    };

    if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.register === 'function') {
        window.MaterialComboStrategies.register({
            kind: 'book',
            order: 30,
            packMode: 'book',
            usesMetaRange: false,
            showsExamStats: false,
            ensureLoaded: ensureLoaded,
            isReady: function () { return _loaded; },
            listAssignedForHomework: listAssignedForHomework,
            getAssignedById: function (classId, comboId) {
                var want = String(comboId || '').trim();
                if (!want) return null;
                var fromList = listAssignedForHomework(classId).filter(function (c) {
                    return String(c.id) === want;
                })[0] || null;
                if (fromList) return fromList;
                var raw = _combos.filter(function (c) { return String(c.id) === want; })[0] || null;
                if (!raw) return null;
                var cid = String(classId || '').trim().toLowerCase();
                if (!cid) return null;
                var assigned = _assigns.some(function (a) {
                    return String(a.class_id || '').trim().toLowerCase() === cid
                        && String(a.book_combo_id) === want;
                });
                if (!assigned) return null;
                return homeworkComboRecord(raw);
            },
            ownsComboId: function (comboId) {
                var want = String(comboId || '').trim();
                if (!want) return false;
                return _combos.some(function (c) { return String(c.id) === want; });
            },
            folderNames: folderNames,
            renderFolderHtml: renderFolderHtml,
            bind: bind,
            matches: function (combo) { return isBookCombo(combo); },
            renderPackTableHtml: renderPackTableHtml,
            expandPackRows: expandPackRows,
            nextSectionRow: nextSectionRow,
            copyRangeFields: copyRangeFields,
            readRowFields: readRowFields,
            rowLooksLike: rowLooksLike
        });
    }

    return api;
})();

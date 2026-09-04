/**
 * 目錄套餐。跟 Excel/JSON／PDF 同階層、在教材資料夾裡有卡。
 * 產生在教材範本管理獨立區塊（選夾後＋新增）；教材區窗口只顯示已有卡。
 * 範圍由老師出作業提供（大題／次題／小題），系統收集成書。
 * 不碰 ensureCombination／pickComboForCard／combo_statistics。
 */
window.FeatureMaterialBook = (function () {
    'use strict';

    var _combos = [];
    var _assigns = [];
    var _items = [];
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

    async function getCurrentUserId() {
        if (!window.supabaseClient) return null;
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

    function rangeLabel(row) {
        return [trim(row && row.major), trim(row && row.secondary), trim(row && row.minor)]
            .filter(Boolean).join(' / ');
    }

    function fileNameFromRange(row) {
        var parts = [trim(row && row.major), trim(row && row.secondary), trim(row && row.minor)]
            .filter(Boolean)
            .map(function (p) { return p.replace(/[\\/:*?"<>|]/g, '_'); });
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
        var pdf = (typeof window.FeatureTimeline.getMaterialPdfOptions === 'function')
            ? (window.FeatureTimeline.getMaterialPdfOptions('', 'teacher') || [])
            : [];
        var i;
        for (i = 0; i < pdf.length; i++) {
            if (folderKey(pdf[i] && pdf[i].folderName) === u && pdf[i].folderId) return String(pdf[i].folderId);
        }
        var entry = (typeof window.FeatureTimeline.getMetaCatalogEntry === 'function')
            ? window.FeatureTimeline.getMetaCatalogEntry('', 'teacher')
            : null;
        var opts = (entry && Array.isArray(entry.options)) ? entry.options : [];
        for (i = 0; i < opts.length; i++) {
            if (folderKey(opts[i] && opts[i].folderName) === u && opts[i].folderId) return String(opts[i].folderId);
        }
        return '';
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

    function rangeCatalog(comboId) {
        var items = itemsForCombo(comboId);
        return {
            majors: uniqueValues(items.map(function (it) { return it.major; })),
            secondariesOf: function (major) {
                var m = trim(major).toUpperCase();
                return uniqueValues(items.filter(function (it) {
                    return trim(it.major).toUpperCase() === m;
                }).map(function (it) { return it.secondary; }));
            },
            minorsOf: function (major, secondary) {
                var m = trim(major).toUpperCase();
                var s = trim(secondary).toUpperCase();
                return uniqueValues(items.filter(function (it) {
                    return trim(it.major).toUpperCase() === m
                        && trim(it.secondary).toUpperCase() === s;
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
            kind: 'book'
        };
    }

    function listAssignedForHomework(classId) {
        var cid = String(classId || '');
        if (!cid) return [];
        var assignedIds = {};
        _assigns.forEach(function (a) {
            if (String(a.class_id) === cid) assignedIds[String(a.book_combo_id)] = true;
        });
        return _combos.filter(function (c) { return assignedIds[String(c.id)]; })
            .map(homeworkComboRecord)
            .sort(function (a, b) { return comboLabel(a).localeCompare(comboLabel(b), 'zh-Hant'); });
    }

    function ensureLoaded() {
        if (_loaded) return Promise.resolve();
        if (_loadPromise) return _loadPromise;
        _loadPromise = (async function () {
            var userId = await getCurrentUserId();
            if (!userId || !window.supabaseClient) {
                _combos = [];
                _assigns = [];
                _items = [];
                _loaded = true;
                return;
            }
            var comboRes = await window.supabaseClient
                .from('material_book_combos')
                .select('id, teacher_id, material_folder_id, folder_name, drive_folder_id, label, updated_at')
                .eq('teacher_id', userId)
                .order('folder_name', { ascending: true });
            if (comboRes.error) throw comboRes.error;
            _combos = comboRes.data || [];
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
            if (asgRes.error) throw asgRes.error;
            _assigns = asgRes.data || [];
            var itemRes = await window.supabaseClient
                .from('material_book_range_items')
                .select('id, book_combo_id, teacher_id, major, secondary, minor, script, source_assignment_id, source_task_id, progress_date, drive_file_id, drive_file_name, updated_at')
                .eq('teacher_id', userId)
                .order('major', { ascending: true });
            if (itemRes.error) throw itemRes.error;
            _items = itemRes.data || [];
            _loaded = true;
        })().finally(function () { _loadPromise = null; });
        return _loadPromise;
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

    function treeHtml(combo) {
        var items = itemsForCombo(combo.id);
        if (!items.length) {
            return '<div style="font-size:0.78rem; color:#64748B; font-weight:700;">尚未收集範圍。出作業選這張卡、填大題／次題／小題後會出現在這裡。</div>';
        }
        var majors = uniqueValues(items.map(function (it) { return it.major || '（未填大題）'; }));
        return majors.map(function (maj) {
            var majItems = items.filter(function (it) {
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
                    return '<div style="margin:2px 0 2px 28px; font-size:0.76rem; color:#334155;">▫️ '
                        + esc(lab) + (hasScript ? '　有文稿' : '　文稿空') + esc(file) + '</div>';
                }).join('');
                return '<div style="margin:4px 0 2px 14px; font-weight:800; color:#334155; font-size:0.8rem;">次題　'
                    + esc(sec) + '</div>' + leaves;
            }).join('');
            return '<div style="margin-top:8px;"><div style="font-weight:800; color:#1E3A8A;">大題　'
                + esc(maj) + '</div>' + secHtml + '</div>';
        }).join('');
    }

    function cardHtml(combo) {
        var named = trim(combo.label) || trim(combo.folder_name);
        return (
            '<div class="mz-card mz-book-card" data-book-id="' + esc(combo.id) + '">'
            + '<div style="font-weight:800; color:#1E3A8A; margin-bottom:6px;">目錄套餐（收集成書；不是從檔自動產生）</div>'
            + '<label style="display:block; font-weight:800; color:#92400E; margin-bottom:2px;">目錄套餐（出作業下拉會顯示這個）</label>'
            + '<input type="text" class="mz-book-label" value="' + esc(named) + '" placeholder="例如 Our World 2" style="font-weight:800; color:#78350F; margin-bottom:8px;">'
            + '<div style="margin-top:8px;">'
            + '<div style="font-weight:800; color:#15803D; margin-bottom:4px;">採用班級</div>'
            + '<div class="mz-book-class-box">' + classChecksHtml(assignsForCombo(combo.id)) + '</div>'
            + '</div>'
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

    function teacherFolderNames() {
        if (window.FeatureExamJob && typeof window.FeatureExamJob.getUniqueFolderNames === 'function') {
            return window.FeatureExamJob.getUniqueFolderNames('', 'teacher') || [];
        }
        return [];
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
        teacherFolderNames().forEach(add);
        _combos.forEach(function (c) { add(c.folder_name); });
        out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
        return out;
    }

    function paintCreatePanel(wrap) {
        var folders = catalogCreateFolderNames();
        var selected = String(wrap.getAttribute('data-selected-folder') || '').trim();
        if (selected && folders.indexOf(selected) === -1) {
            var selU = selected.toUpperCase();
            selected = folders.filter(function (n) { return n.toUpperCase() === selU; })[0] || '';
        }
        if (!selected) selected = folders[0] || '';
        wrap.setAttribute('data-selected-folder', selected);
        var opts = folders.length
            ? folders.map(function (n) {
                return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
            }).join('')
            : '<option value="">（尚無教材資料夾）</option>';
        wrap.innerHTML = (
            '<div style="background:white; padding:20px; border-radius:12px; border:2px solid #93C5FD; margin-bottom:16px;">'
            + '<h3 style="margin:0 0 4px 0; color:#1E3A8A;">📚 目錄套餐（選夾後＋新增；不是從檔自動產生）</h3>'
            + '<p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">這塊只產生目錄套餐，不准跟 Excel/JSON 套用、也不准跟 PDF 套用合併。出作業選這張卡、填大題／次題／小題才收集。教材區窗口只顯示已有卡。</p>'
            + '<label style="display:block; font-weight:800; color:#1E3A8A; margin-bottom:4px;">教材資料夾</label>'
            + '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<select class="mz-book-create-folder" style="min-width:260px; padding:6px 8px; font-weight:800;">' + opts + '</select>'
            + '<button type="button" class="mz-book-add btn" style="padding:4px 10px; background:#EEF2FF; color:#1D4ED8; border:1px solid #93C5FD; border-radius:6px; font-weight:800; cursor:pointer;">＋ 新增目錄套餐</button>'
            + '<span class="mz-book-create-msg" style="font-weight:700;"></span>'
            + '</div>'
            + '</div>'
        );
        var sel = wrap.querySelector('.mz-book-create-folder');
        if (sel) {
            sel.addEventListener('change', function () {
                wrap.setAttribute('data-selected-folder', sel.value);
            });
        }
        bindCreate(wrap);
    }

    function renderCreatePanel() {
        var wrap = document.getElementById('catalog-combo-create-container');
        if (!wrap) return;
        ensureLoaded().then(function () {
            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                return window.FeatureTimeline.ensureMetaCatalog('', 'teacher', { force: false }).catch(function () {}).then(function () {
                    paintCreatePanel(wrap);
                });
            }
            paintCreatePanel(wrap);
        }).catch(function (err) {
            wrap.innerHTML = '<div style="padding:16px; color:#EF4444; font-weight:800;">目錄套餐區塊載入失敗：' + esc(err.message || err) + '</div>';
        });
    }

    function bindCreate(wrap) {
        if (!wrap) return;
        wrap.querySelectorAll('.mz-book-add').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var folderEl = wrap.querySelector('.mz-book-create-folder');
                var folderName = folderEl && folderEl.value;
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
        var upd = await window.supabaseClient.from('material_book_combos').update({
            label: label,
            drive_folder_id: driveId,
            updated_at: new Date().toISOString()
        }).eq('id', combo.id);
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

    function audioScriptFromNode(node) {
        if (!node || !node.raw_data) return '';
        var raw = node.raw_data;
        if (Array.isArray(raw.paste_windows) && raw.paste_windows.length) {
            return raw.paste_windows.map(function (w) {
                return trim(w && w.script);
            }).filter(Boolean).join('\n\n');
        }
        return trim(raw.original_script);
    }

    function firstAudioUnder(node) {
        if (!node) return null;
        if (node.type === 'audio_record') return node;
        var found = null;
        (node.subTasks || []).some(function (ch) {
            found = firstAudioUnder(ch);
            return !!found;
        });
        return found;
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
            var audio = firstAudioUnder(host);
            var fallbackScript = audioScriptFromNode(audio);
            for (j = 0; j < rows.length; j++) {
                var row = rows[j];
                var combo = _combos.filter(function (c) { return String(c.id) === String(row.combo_id); })[0];
                if (!combo) continue;
                var major = trim(row.major);
                var secondary = trim(row.secondary);
                var minor = trim(row.minor);
                if (!major && !secondary && !minor) continue;
                var script = trim(row.book_script) || fallbackScript;
                var taskId = String((host && host.id) || '') + '|' + j;
                var existing = _items.filter(function (it) {
                    return String(it.book_combo_id) === String(combo.id)
                        && String(it.source_assignment_id || '') === String(assignmentId)
                        && String(it.source_task_id || '') === taskId;
                })[0];
                var file = { fileId: '', fileName: '' };
                try {
                    file = await uploadRangeText(combo, { major: major, secondary: secondary, minor: minor }, script);
                } catch (err) {
                    console.warn('[FeatureMaterialBook] 寫進教材資料夾失敗', err);
                    if (window.showFlash) {
                        window.showFlash('範圍已記下，但寫進教材資料夾失敗：' + (err.message || err), 'error');
                    }
                }
                var payloadRow = {
                    book_combo_id: combo.id,
                    teacher_id: userId,
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
                major: trim(r && r.major),
                secondary: trim(r && r.secondary),
                minor: trim(r && r.minor),
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
                + '<div style="font-size:0.82rem; color:#64748B; margin-top:6px; line-height:1.6;">尚未建立。到教材範本管理「目錄套餐」區塊選資料夾後按「＋ 新增目錄套餐」。出作業選這張卡、填大題／次題／小題就會收集到這裡。有文稿才寫 txt 進該教材資料夾。不是從夾裡的檔自動產卡。</div>'
                + '</div>';
        }
        return '<div style="background:white; padding:16px; border-radius:12px; border:2px solid #C7D2FE; margin-bottom:16px;">'
            + '<div style="font-weight:900; color:#1E3A8A; margin-bottom:6px;">📚 教材目錄套餐（已收集範圍）</div>'
            + '<div style="font-size:0.82rem; color:#64748B; margin-bottom:10px; line-height:1.6;">出作業選書＋填範圍＝收集。三層都提供，這次填到哪由老師定。有文稿才寫進該教材資料夾。Mason Shen 與 Ava 勾同一本就是同一本。</div>'
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
            major: trim(r && r.major),
            secondary: trim(r && r.secondary),
            minor: trim(r && r.minor),
            book_script: trim(r && (r.book_script || r.bookScript))
        };
    }

    function rowLooksLike(r) {
        return !!(trim(r && r.major) || trim(r && r.secondary) || trim(r && r.minor) || trim(r && (r.book_script || r.bookScript)));
    }

    function readRowFields(pathStr, idx) {
        function val(id) {
            var el = document.getElementById(id);
            return el ? String(el.value || '').trim() : '';
        }
        return {
            major: val('range-pack-book-major-' + pathStr + '-' + idx),
            secondary: val('range-pack-book-secondary-' + pathStr + '-' + idx),
            minor: val('range-pack-book-minor-' + pathStr + '-' + idx),
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
        var startIdx = Number(ctx && ctx.startIdx) || 0;
        var blockRowCount = rows.length;
        var htmlRows = rows.map(function (row, posInBlock) {
            var idx = startIdx + posInBlock;
            var delSheet = packUi.packRowDeleteBtn ? packUi.packRowDeleteBtn(pathStr, idx, blockRowCount > 1) : '';
            var orderCell = packUi.packRowOrderControls ? packUi.packRowOrderControls(pathStr, idx, posInBlock, blockRowCount) : '';
            var drop = packUi.rowDropAttr ? packUi.rowDropAttr(pathStr, idx) : '';
            return '<div class="range-pack-row range-pack-row--book"' + drop
                + orderCell
                + bookRowInputsHtml(pathStr, idx, row, combo)
                + '<div>' + delSheet + '</div>'
                + '</div>';
        }).join('');
        var html = rows.length
            ? ('<div class="range-pack-table"><div class="range-pack-table-inner">'
                + '<div class="range-pack-head range-pack-head--book"><div></div><div>大題</div><div>次題</div><div>小題</div><div>文稿</div><div>刪</div></div>'
                + htmlRows
                + '</div></div>')
            : '';
        return { html: html, rowCount: rows.length, showsExamStats: false };
    }

    function bookRowInputsHtml(pathStr, idx, row, combo) {
        var cat = rangeCatalog(combo && combo.id);
        var majorId = 'range-pack-book-major-' + pathStr + '-' + idx;
        var secId = 'range-pack-book-secondary-' + pathStr + '-' + idx;
        var minId = 'range-pack-book-minor-' + pathStr + '-' + idx;
        var scriptId = 'range-pack-book-script-' + pathStr + '-' + idx;
        var majorList = 'dl-book-major-' + pathStr + '-' + idx;
        var secList = 'dl-book-sec-' + pathStr + '-' + idx;
        var minList = 'dl-book-min-' + pathStr + '-' + idx;
        var major = trim(row && row.major);
        var secondary = trim(row && row.secondary);
        var on = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })';
        var onBlur = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: true, skipSync: true })';
        return (
            '<div>'
            + '<input id="' + majorId + '" class="form-control range-pack-book-major" list="' + esc(majorList) + '" value="' + esc(major) + '" placeholder="大題" title="大題" oninput="' + on + '" onchange="' + onBlur + '">'
            + datalistHtml(majorList, cat.majors)
            + '</div>'
            + '<div>'
            + '<input id="' + secId + '" class="form-control range-pack-book-secondary" list="' + esc(secList) + '" value="' + esc(secondary) + '" placeholder="次題" title="次題" oninput="' + on + '" onchange="' + onBlur + '">'
            + datalistHtml(secList, cat.secondariesOf(major))
            + '</div>'
            + '<div>'
            + '<input id="' + minId + '" class="form-control range-pack-book-minor" list="' + esc(minList) + '" value="' + esc(row && row.minor) + '" placeholder="小題" title="小題" oninput="' + on + '">'
            + datalistHtml(minList, cat.minorsOf(major, secondary))
            + '</div>'
            + '<div>'
            + '<input id="' + scriptId + '" class="form-control range-pack-book-script" value="' + esc(row && row.book_script) + '" placeholder="這次文稿（可空）" title="文稿" oninput="' + on + '">'
            + '</div>'
        );
    }

    function bind(wrap) {
        if (!wrap) return;
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
        bookRowInputsHtml: bookRowInputsHtml,
        copyRangeFields: copyRangeFields,
        collectFromSavedAssignment: collectFromSavedAssignment,
        renderCollectorHtml: renderCollectorHtml,
        getCombo: function (id) {
            return _combos.filter(function (c) { return String(c.id) === String(id); })[0] || null;
        }
    };

    if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.register === 'function') {
        window.MaterialComboStrategies.register({
            kind: 'book',
            order: 30,
            packMode: 'book',
            usesMetaRange: false,
            showsExamStats: false,
            ensureLoaded: ensureLoaded,
            listAssignedForHomework: listAssignedForHomework,
            getAssignedById: function (classId, comboId) {
                var want = String(comboId || '').trim();
                if (!want) return null;
                return listAssignedForHomework(classId).filter(function (c) {
                    return String(c.id) === want;
                })[0] || null;
            },
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

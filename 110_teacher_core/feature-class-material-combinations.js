/**
 * 📂 檔案路徑：110_teacher_core/feature-class-material-combinations.js
 * 🎯 職責：教材-擷取範本-班級-出題紀錄正規化重構第 5 步——把「📎 套用到教材」已經存在的
 * （教材資料夾＋擷取範本＋一組活頁）候選，走兩步驟精靈正式命名成一個可重複使用的
 * material_combinations：
 *   Step 1：擷取組合（資料夾＋擷取範本＋活頁，沿用既有「📎 套用到教材」紀錄）
 *   Step 2：套用考卷範本（從老師自己的「🧾 考卷範本」清單勾選一個或多個，寫入
 *           material_combination_exam_templates——這是老師「明確」決定的搭配，不是系統
 *           自動把擷取範本當考卷範本，見 2026-08-14「分離擷取範本與考卷範本」）
 *   Step 3：指派給班級（class_material_combinations）
 *
 * 這是全新概念，資料庫裡沒有對應的舊 JSON 可以 backfill（見
 * supabase/migrations/20260814150000_material_relations_normalize.sql 的說明），
 * 老師需要在這裡手動建立指派紀錄。
 *
 * 只做資料庫層的組合＋指派，不影響「產生線上卷」本身讀取教材的路徑（那條路徑仍然是
 * feature-exam-job.js 直接讀 material_folder 字串＋Drive meta）。
 * 出題下拉的試卷範本只能列這裡的官方認證組合（listOfficialExamTemplateIds），
 * 一個 meta 可對多個試卷範本；沒有官方配對就不能出卷。
 */
window.FeatureClassMaterialCombinations = (function () {
    'use strict';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function allClasses() {
        return (window.TeacherDB && Array.isArray(window.TeacherDB.classes)) ? window.TeacherDB.classes : [];
    }

    function classNameById(classId) {
        const c = allClasses().find(function (x) { return String(x.id) === String(classId); });
        return c ? (c.name || String(classId)) : String(classId || '（找不到班級）');
    }

    function classRawOf(cls) {
        let raw = (cls && (cls.raw_data || cls.rawData)) || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw) || {}; } catch (_e) { raw = {}; }
        }
        return raw;
    }

    function folderKeyOf(name) {
        return window.ReviewZone && typeof window.ReviewZone.folderKey === 'function'
            ? window.ReviewZone.folderKey(name)
            : String(name || '').trim().toUpperCase();
    }

    function relatedSheetsFromCombo(combo) {
        const links = Array.isArray(combo.material_combination_sheets) ? combo.material_combination_sheets : [];
        const raw = [];
        links.forEach(function (cs) {
            const sh = cs.material_sheets || {};
            const stem = String(sh.sheet_stem || '').trim();
            if (!stem) return;
            raw.push({
                sheetStem: stem,
                metaFileName: sh.meta_file_name || (stem.replace(/\.meta\.json$/i, '') + '.meta.json')
            });
        });
        const keep = collapseRelatedSheetStems(raw.map(function (x) { return x.sheetStem; }));
        const keepU = {};
        keep.forEach(function (s) { keepU[String(s).toUpperCase()] = true; });
        return raw.filter(function (x) { return keepU[x.sheetStem.toUpperCase()]; });
    }

    function buildClassReviewDeskModel(combos) {
        const byClass = {};
        allClasses().forEach(function (cls) {
            byClass[String(cls.id)] = { cls: cls, materials: [] };
        });
        (combos || []).forEach(function (combo) {
            const folder = combo.material_folders || {};
            const tpl = combo.material_templates || {};
            const folderName = folder.folder_name || '';
            const folderKey = folderKeyOf(folderName);
            if (!folderKey) return;
            const examLinks = Array.isArray(combo.material_combination_exam_templates) ? combo.material_combination_exam_templates : [];
            const examNames = examLinks.map(function (l) { return examTemplateNameById(l.exam_template_id); }).filter(Boolean);
            const assignments = Array.isArray(combo.class_material_combinations) ? combo.class_material_combinations : [];
            const sheets = relatedSheetsFromCombo(combo);
            assignments.forEach(function (a) {
                const cid = String(a.class_id);
                if (!byClass[cid]) {
                    byClass[cid] = { cls: { id: cid, name: classNameById(cid) }, materials: [] };
                }
                const list = byClass[cid].materials;
                sheets.forEach(function (sh) {
                    const sheetKey = folderKey + '|' + String(sh.sheetStem).toUpperCase();
                    const hit = list.find(function (m) { return m.sheetKey === sheetKey; });
                    if (hit) {
                        examNames.forEach(function (n) {
                            if (hit.examNames.indexOf(n) === -1) hit.examNames.push(n);
                        });
                        if (combo.label && !hit.label) hit.label = combo.label;
                        if (tpl.name && !hit.templateName) hit.templateName = tpl.name;
                        return;
                    }
                    list.push({
                        sheetKey: sheetKey,
                        folderKey: folderKey,
                        folderName: folderName,
                        sheetStem: sh.sheetStem,
                        metaFileName: sh.metaFileName,
                        templateName: tpl.name || '',
                        label: combo.label || '',
                        examNames: examNames.slice()
                    });
                });
            });
        });
        Object.keys(byClass).forEach(function (id) {
            byClass[id].materials.sort(function (a, b) {
                const fa = String(a.folderName || '').localeCompare(String(b.folderName || ''), 'zh-Hant');
                if (fa) return fa;
                return String(a.sheetStem || '').localeCompare(String(b.sheetStem || ''), 'zh-Hant');
            });
        });
        return Object.keys(byClass).map(function (id) { return byClass[id]; });
    }

    function renderClassReviewDeskHtml(combos) {
        const FS = '0.85rem';
        const rows = buildClassReviewDeskModel(combos);
        const cards = rows.map(function (row) {
            const cls = row.cls;
            const cid = String(cls.id);
            const rz = (window.ReviewZone && typeof window.ReviewZone.parsePolicy === 'function')
                ? window.ReviewZone.parsePolicy(classRawOf(cls))
                : {};
            const matCfg = rz.materials || {};
            let matsHtml;
            if (!row.materials.length) {
                matsHtml = '<div style="color:#94A3B8; font-weight:700; padding:6px 0; font-size:' + FS + ';">尚未指派任何教材組合（學生練習專區選不到教材）</div>';
            } else {
                const groups = [];
                row.materials.forEach(function (m) {
                    const last = groups[groups.length - 1];
                    if (!last || last.folderName !== m.folderName) {
                        groups.push({ folderName: m.folderName, items: [m] });
                    } else {
                        last.items.push(m);
                    }
                });
                matsHtml = groups.map(function (g) {
                    const items = g.items.map(function (m) {
                        const entry = (window.ReviewZone && typeof window.ReviewZone.materialEntry === 'function')
                            ? window.ReviewZone.materialEntry(matCfg, m.folderName, m.sheetStem)
                            : { display_name: '', enabled: true };
                        const metaFile = m.metaFileName || (m.sheetStem + '.meta.json');
                        const extractName = m.templateName || '尚未套用擷取範本';
                        const examName = m.examNames.length ? m.examNames.join('、') : '尚未套用試卷範本';
                        return (
                            '<div class="cmc-rz-mat-row" data-sheet-key="' + esc(m.sheetKey) + '" data-folder-key="' + esc(m.folderKey) + '" data-folder-name="' + esc(m.folderName) + '" data-sheet-stem="' + esc(m.sheetStem) + '" data-meta-file="' + esc(metaFile) + '" style="border:1px solid #FED7AA; border-radius:8px; padding:10px; margin-bottom:8px; background:#FFFBF5;">'
                            + '<div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; font-size:' + FS + '; margin-bottom:8px;">'
                            + '<label style="font-weight:800; color:#9A3412; white-space:nowrap; font-size:' + FS + ';"><input type="checkbox" class="cmc-rz-mat-on" ' + (entry.enabled ? 'checked' : '') + '> 開放使用</label>'
                            + '<label style="flex:1; min-width:200px; display:flex; align-items:center; gap:8px; font-size:' + FS + '; font-weight:800; color:#7C2D12;">顯示名稱'
                            + '<input type="text" class="cmc-rz-mat-name" value="' + esc(entry.display_name || '') + '" placeholder="給學生看的名稱" style="flex:1; min-width:140px; padding:6px 8px; border:1px solid #FDBA74; border-radius:6px; font-size:' + FS + '; font-weight:800; color:#1E293B;"></label>'
                            + '</div>'
                            + '<div style="font-size:' + FS + '; color:#9A3412; font-weight:700; line-height:1.7;">'
                            + '<div>教材：' + esc(metaFile) + '</div>'
                            + '<div>擷取：' + esc(extractName) + '</div>'
                            + '<div>試卷：' + esc(examName) + '</div>'
                            + '</div>'
                            + '</div>'
                        );
                    }).join('');
                    return '<div style="margin-bottom:10px;">'
                        + '<div style="font-weight:800; color:#9A3412; font-size:' + FS + '; margin:0 0 6px;">📁 ' + esc(g.folderName) + '（' + g.items.length + ' 個活頁 meta）</div>'
                        + items
                        + '</div>';
                }).join('');
            }
            const updated = rz.catalog_updated_at
                ? String(rz.catalog_updated_at).replace('T', ' ').slice(0, 16)
                : '尚未更新';
            return (
                '<div class="cmc-rz-card" data-class-id="' + esc(cid) + '" style="background:white; border:1px solid #FED7AA; border-radius:10px; padding:14px; margin-bottom:10px; font-size:' + FS + ';">'
                + '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:10px;">'
                + '<div style="font-weight:900; color:#9A3412; font-size:' + FS + ';">🏫 ' + esc(cls.name || classNameById(cid)) + '</div>'
                + '<div style="font-size:' + FS + '; color:#9A3412; font-weight:700;">目錄：' + esc(updated) + '</div>'
                + '</div>'
                + '<div style="background:#FFF7ED; border:1px dashed #FDBA74; border-radius:8px; padding:10px; margin-bottom:10px;">'
                + '<div style="font-weight:900; color:#9A3412; margin-bottom:4px; font-size:' + FS + ';">教材</div>'
                + '<p style="margin:0 0 8px; font-size:' + FS + '; color:#9A3412; font-weight:600; line-height:1.45;">只列出已指派組合裡、彼此有關係的活頁 meta（例如 A、B、C）。同資料夾裡沒被指派的 meta 不會出現。學生只會看到「顯示名稱」。</p>'
                + matsHtml
                + '</div>'
                + '<div style="background:#FFF7ED; border:1px dashed #FDBA74; border-radius:8px; padding:10px;">'
                + '<div style="font-weight:900; color:#9A3412; margin-bottom:8px; font-size:' + FS + ';">學生練習區設定</div>'
                + '<div style="display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; font-size:' + FS + '; font-weight:700; color:#7C2D12;">'
                + '<label><input type="checkbox" class="cmc-rz-enabled" ' + (rz.enabled ? 'checked' : '') + '> 開放學生練習專區</label>'
                + '<label><input type="checkbox" class="cmc-rz-practice" ' + (rz.allow_practice !== false ? 'checked' : '') + (rz.enabled ? '' : ' disabled') + '> 允許練習</label>'
                + '<label><input type="checkbox" class="cmc-rz-test" ' + (rz.allow_test !== false ? 'checked' : '') + (rz.enabled ? '' : ' disabled') + '> 允許測試</label>'
                + '<label><input type="checkbox" class="cmc-rz-view" ' + (rz.teacher_can_view ? 'checked' : '') + (rz.enabled ? '' : ' disabled') + '> 老師可看練習／測試紀錄</label>'
                + '<label><input type="checkbox" class="cmc-rz-score" ' + (rz.test_counts_as_score ? 'checked' : '') + (rz.enabled ? '' : ' disabled') + '> 測試分數納入作業成績／測驗成績</label>'
                + '</div>'
                + '</div>'
                + '<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
                + '<button type="button" class="btn cmc-rz-save-btn" data-class-id="' + esc(cid) + '" style="background:#C2410C; color:white; padding:6px 12px; font-size:' + FS + ';">💾 儲存設定</button>'
                + '<span class="cmc-rz-status" data-class-id="' + esc(cid) + '" style="font-size:' + FS + '; font-weight:700; color:#9A3412;"></span>'
                + '</div>'
                + '<p style="margin:8px 0 0; font-size:' + FS + '; color:#9A3412; font-weight:600; line-height:1.45;">儲存時會一併更新學生可選的教材清單，不用另外按更新目錄。</p>'
                + '</div>'
            );
        }).join('');
        return ''
            + '<div style="background:#FFF7ED; padding:20px; border-radius:12px; border:2px solid #FDBA74; margin-top:16px; font-size:0.85rem;">'
            + '<h3 style="margin:0 0 4px 0; color:#9A3412; font-size:0.95rem;">📖 各班練習專區</h3>'
            + '<p style="color:#9A3412; font-size:0.85rem; margin:0 0 12px 0; font-weight:600; line-height:1.5;">'
            + '教材以活頁 meta 列出（不是整個資料夾）。顯示名稱給學生看；儲存時一併更新可選清單。預設關閉。'
            + '</p>'
            + (cards || '<div style="color:#9A3412; font-weight:700; font-size:0.85rem;">目前沒有班級。</div>')
            + '</div>';
    }

    function readRzFromCard(card) {
        const score = !!(card && card.querySelector('.cmc-rz-score') && card.querySelector('.cmc-rz-score').checked);
        const viewEl = card && card.querySelector('.cmc-rz-view');
        const materials = {};
        (card ? card.querySelectorAll('.cmc-rz-mat-row') : []).forEach(function (row) {
            const key = row.getAttribute('data-sheet-key') || row.getAttribute('data-folder-key');
            if (!key) return;
            const nameEl = row.querySelector('.cmc-rz-mat-name');
            materials[key] = {
                folder_name: row.getAttribute('data-folder-name') || '',
                sheet_stem: row.getAttribute('data-sheet-stem') || '',
                meta_file_name: row.getAttribute('data-meta-file') || '',
                display_name: nameEl ? String(nameEl.value || '').trim() : '',
                enabled: !!(row.querySelector('.cmc-rz-mat-on') && row.querySelector('.cmc-rz-mat-on').checked)
            };
        });
        return {
            enabled: !!(card && card.querySelector('.cmc-rz-enabled') && card.querySelector('.cmc-rz-enabled').checked),
            allow_practice: !!(card && card.querySelector('.cmc-rz-practice') && card.querySelector('.cmc-rz-practice').checked),
            allow_test: !!(card && card.querySelector('.cmc-rz-test') && card.querySelector('.cmc-rz-test').checked),
            teacher_can_view: !!(viewEl && viewEl.checked) || score,
            test_counts_as_score: score,
            materials: materials
        };
    }

    async function saveClassReviewZone(classId, zonePatch) {
        const cls = allClasses().find(function (c) { return String(c.id) === String(classId); });
        if (!cls) throw new Error('找不到班級');
        const raw = classRawOf(cls);
        const prev = raw.review_zone && typeof raw.review_zone === 'object' ? raw.review_zone : {};
        const zone = Object.assign({}, prev, zonePatch);
        const merged = Object.assign({}, raw, { review_zone: zone });
        const { error } = await window.supabaseClient.from('classes').update({ raw_data: merged }).eq('id', classId);
        if (error) throw error;
        cls.raw_data = merged;
        cls.rawData = merged;
        if (window.TeacherDB && typeof window.TeacherDB.save === 'function') window.TeacherDB.save();
        return zone;
    }

    function bindClassReviewDesk(wrap) {
        function lockCardChildren(card) {
            const on = !!(card.querySelector('.cmc-rz-enabled') && card.querySelector('.cmc-rz-enabled').checked);
            ['.cmc-rz-practice', '.cmc-rz-test', '.cmc-rz-view', '.cmc-rz-score'].forEach(function (sel) {
                const el = card.querySelector(sel);
                if (el) el.disabled = !on;
            });
        }
        wrap.querySelectorAll('.cmc-rz-card').forEach(lockCardChildren);
        wrap.querySelectorAll('.cmc-rz-enabled').forEach(function (el) {
            el.addEventListener('change', function () {
                const card = el.closest('.cmc-rz-card');
                if (card) lockCardChildren(card);
            });
        });
        wrap.querySelectorAll('.cmc-rz-score').forEach(function (el) {
            el.addEventListener('change', function () {
                if (!el.checked) return;
                const card = el.closest('.cmc-rz-card');
                const viewEl = card && card.querySelector('.cmc-rz-view');
                if (viewEl) viewEl.checked = true;
            });
        });
        wrap.querySelectorAll('.cmc-rz-save-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const classId = btn.getAttribute('data-class-id');
                const card = btn.closest('.cmc-rz-card');
                const statusEl = wrap.querySelector('.cmc-rz-status[data-class-id="' + classId + '"]');
                btn.disabled = true;
                const orig = btn.textContent;
                btn.textContent = '⏳ 儲存中…';
                try {
                    const zone = readRzFromCard(card);
                    await saveClassReviewZone(classId, zone);
                    let extra = '';
                    if (window.FeatureReviewCatalog && typeof window.FeatureReviewCatalog.refreshForClass === 'function') {
                        const result = await window.FeatureReviewCatalog.refreshForClass(classId, statusEl, { materials: zone.materials });
                        const nowIso = new Date().toISOString();
                        await saveClassReviewZone(classId, { catalog_updated_at: nowIso });
                        extra = '｜已更新清單 ' + (result && result.count ? result.count : 0) + ' 個活頁'
                            + (result && result.ready != null ? ('（' + result.ready + ' 個有題目）') : '');
                    }
                    const msg = '已儲存「' + classNameById(classId) + '」練習專區設定' + extra;
                    if (statusEl) statusEl.textContent = msg;
                    window.showFlash && window.showFlash(msg, 'success');
                } catch (err) {
                    if (statusEl) statusEl.textContent = '儲存失敗：' + (err.message || err);
                    window.showFlash && window.showFlash('儲存失敗：' + (err.message || err), 'error');
                } finally {
                    btn.disabled = false;
                    btn.textContent = orig;
                }
            });
        });
    }

    async function getCurrentUserId() {
        if (!window.supabaseClient) return null;
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        return user ? user.id : null;
    }

    function examTemplatesList() {
        return (window.FeatureExamJob && typeof window.FeatureExamJob.getExamTemplatesCachedSync === 'function')
            ? window.FeatureExamJob.getExamTemplatesCachedSync()
            : [];
    }

    function examTemplateNameById(id) {
        const n = templateNameById(id);
        return n || '（找不到試卷範本）';
    }

    function templateNameById(id) {
        if (!id) return '';
        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getTemplatesCachedSync === 'function') {
            const t = window.FeatureTemplateLibrary.getTemplatesCachedSync().find(function (x) {
                return String(x.id) === String(id);
            });
            if (t && t.name) return String(t.name).trim();
        }
        const t2 = examTemplatesList().find(function (x) { return String(x.id) === String(id); });
        return t2 && t2.name ? String(t2.name).trim() : '';
    }

    /**
     * 候選清單：目前老師已經有「套用到教材」紀錄（material_sheets 有 extraction_template_id）的
     * 每一組（資料夾＋擷取範本），可以直接拿來指派給班級——不用另外重選一次資料夾／活頁。
     * 沒有解析出擷取範本的孤兒活頁不列入候選（那種本身就該先在「📎 套用到教材」處理好）。
     */
    async function loadGroups(userId) {
        const { data, error } = await window.supabaseClient
            .from('material_sheets')
            .select(`
                id,
                sheet_stem,
                extraction_template_id,
                material_folders!inner ( id, root_kind, class_id, folder_name, teacher_id ),
                material_templates ( id, name )
            `)
            .eq('material_folders.teacher_id', userId)
            .not('extraction_template_id', 'is', null);
        if (error) throw error;
        const groups = {};
        const order = [];
        (data || []).forEach(function (row) {
            const folder = row.material_folders || {};
            const tpl = row.material_templates || null;
            const key = folder.id + '|' + row.extraction_template_id;
            if (!groups[key]) {
                groups[key] = {
                    material_folder_id: folder.id,
                    extraction_template_id: row.extraction_template_id,
                    folder_name: folder.folder_name || '',
                    root_kind: folder.root_kind === 'class' ? 'class' : 'teacher',
                    class_id: folder.class_id || '',
                    template_name: tpl ? (tpl.name || '（未命名）') : '（找不到擷取範本）',
                    sheet_ids: [],
                    sheet_db_ids: []
                };
                order.push(key);
            }
            groups[key].sheet_ids.push(row.sheet_stem);
            groups[key].sheet_db_ids.push(row.id);
        });
        return order.map(function (k) { return groups[k]; });
    }

    /**
     * 擷取範本「實際使用」要用的套用紀錄：來源檔＋活頁 → 目標教材資料夾＋產出檔。
     * 跟 loadGroups（給組合精靈用、以資料夾＋範本為鍵）分開，避免把不同來源檔併成一筆。
     */
    async function loadExtractionApplyRecords(userId) {
        const { data, error } = await window.supabaseClient
            .from('material_sheets')
            .select(`
                sheet_stem,
                extraction_template_id,
                source_kind,
                source_file_name,
                material_folders!inner ( folder_name, teacher_id ),
                material_templates ( name )
            `)
            .eq('material_folders.teacher_id', userId)
            .not('extraction_template_id', 'is', null)
            .order('sheet_stem', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    /** 同一活頁會被記成 Excel 名（AvaLiu-vBK-2）又記成產出 stem（AvaLiu-vBK-2.vocab-word）。顯示／計數只留較完整的那一個。 */
    function collapseRelatedSheetStems(stems) {
        const raw = [];
        (stems || []).forEach(function (s) {
            const t = String(s || '').trim().replace(/\.meta\.json$/i, '');
            if (t && !raw.some(function (x) { return x.toUpperCase() === t.toUpperCase(); })) raw.push(t);
        });
        return raw.filter(function (s, i) {
            const su = s.toUpperCase();
            return !raw.some(function (other, j) {
                if (i === j) return false;
                const ou = other.toUpperCase();
                return ou !== su && ou.indexOf(su + '.') === 0;
            });
        });
    }

    /** 已經建立好的組合＋目前搭配的考卷範本＋目前指派到哪些班級 */
    async function loadCombinations(userId) {
        const { data, error } = await window.supabaseClient
            .from('material_combinations')
            .select(`
                id,
                label,
                material_folder_id,
                extraction_template_id,
                created_at,
                material_folders!inner ( id, root_kind, class_id, folder_name, teacher_id ),
                material_templates ( id, name ),
                material_combination_sheets ( material_sheet_id, material_sheets ( id, sheet_stem, meta_file_name ) ),
                material_combination_exam_templates ( id, exam_template_id, is_default ),
                class_material_combinations ( id, class_id, assigned_at )
            `)
            .eq('material_folders.teacher_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    function groupKeyOf(g) { return g.material_folder_id + '|' + g.extraction_template_id; }

    /** 找不到就新增一筆 material_combinations，並確保 material_combination_sheets 包含這個 group 目前的所有活頁 */
    async function ensureCombination(userId, group, label) {
        const { data: existing, error: findErr } = await window.supabaseClient
            .from('material_combinations')
            .select('id, label, material_folders!inner(teacher_id)')
            .eq('material_folder_id', group.material_folder_id)
            .eq('extraction_template_id', group.extraction_template_id)
            .eq('material_folders.teacher_id', userId)
            .maybeSingle();
        if (findErr) throw findErr;

        let comboId;
        if (existing && existing.id) {
            comboId = existing.id;
            if (label && label !== existing.label) {
                const { error: updErr } = await window.supabaseClient
                    .from('material_combinations')
                    .update({ label: label, updated_at: new Date().toISOString() })
                    .eq('id', comboId);
                if (updErr) throw updErr;
            }
        } else {
            const { data: inserted, error: insErr } = await window.supabaseClient
                .from('material_combinations')
                .insert({ material_folder_id: group.material_folder_id, extraction_template_id: group.extraction_template_id, label: label || null })
                .select('id')
                .single();
            if (insErr) throw insErr;
            comboId = inserted.id;
        }

        const { data: existingLinks, error: linkReadErr } = await window.supabaseClient
            .from('material_combination_sheets')
            .select('material_sheet_id')
            .eq('combination_id', comboId);
        if (linkReadErr) throw linkReadErr;
        const existingSheetIdSet = {};
        (existingLinks || []).forEach(function (l) { existingSheetIdSet[String(l.material_sheet_id)] = true; });
        const toInsert = group.sheet_db_ids
            .filter(function (id) { return !existingSheetIdSet[String(id)]; })
            .map(function (id) { return { combination_id: comboId, material_sheet_id: id }; });
        if (toInsert.length) {
            const { error: linkInsErr } = await window.supabaseClient.from('material_combination_sheets').insert(toInsert);
            if (linkInsErr) throw linkInsErr;
        }
        return comboId;
    }

    /**
     * Step 2：把老師勾選的考卷範本寫入 material_combination_exam_templates（差異比對，不整批
     * 覆寫）——這是老師「明確」決定的搭配，不是系統自動把擷取範本當考卷範本。examTemplateIds
     * 至少要有一個（UI 層已擋，這裡再擋一次避免繞過 UI 直接呼叫）。第一個勾選的當 is_default。
     */
    async function setComboExamTemplates(comboId, examTemplateIds) {
        const wanted = (examTemplateIds || []).filter(Boolean);
        if (!wanted.length) throw new Error('請至少勾選一個試卷範本');
        const { data: existingLinks, error: readErr } = await window.supabaseClient
            .from('material_combination_exam_templates')
            .select('id, exam_template_id')
            .eq('material_combination_id', comboId);
        if (readErr) throw readErr;
        const existing = existingLinks || [];
        const existingIdSet = {};
        existing.forEach(function (l) { existingIdSet[l.exam_template_id] = l.id; });
        const wantedSet = {};
        wanted.forEach(function (id) { wantedSet[id] = true; });

        const toInsert = wanted
            .filter(function (id) { return !existingIdSet[id]; })
            .map(function (id, idx) { return { material_combination_id: comboId, exam_template_id: id, is_default: idx === 0 && !existing.length }; });
        const toDeleteRowIds = existing
            .filter(function (l) { return !wantedSet[l.exam_template_id]; })
            .map(function (l) { return l.id; });

        if (toInsert.length) {
            const { error: insErr } = await window.supabaseClient.from('material_combination_exam_templates').insert(toInsert);
            if (insErr) throw insErr;
        }
        if (toDeleteRowIds.length) {
            const { error: delErr } = await window.supabaseClient.from('material_combination_exam_templates').delete().in('id', toDeleteRowIds);
            if (delErr) throw delErr;
        }
    }

    async function assignToClasses(comboId, classIds, userId) {
        for (const classId of classIds) {
            const { data: existing, error: findErr } = await window.supabaseClient
                .from('class_material_combinations')
                .select('id')
                .eq('class_id', classId)
                .eq('material_combination_id', comboId)
                .maybeSingle();
            if (findErr) throw findErr;
            if (existing && existing.id) continue;
            const { error: insErr } = await window.supabaseClient
                .from('class_material_combinations')
                .insert({ class_id: classId, material_combination_id: comboId, assigned_by: userId });
            if (insErr) throw insErr;
        }
    }

    async function removeAssignment(id) {
        const { error } = await window.supabaseClient.from('class_material_combinations').delete().eq('id', id);
        if (error) throw error;
    }

    // ------------------------------------------------------------------
    // 官方配對：老師在「🏫 班級教材組合」Step 2 明確勾選的
    // material_combination_exam_templates。出題下拉只能列這些，一個 meta 可對多個試卷範本。
    // ------------------------------------------------------------------
    let _suggestionCache = null;
    let _suggestionLoadPromise = null;
    /** classId → [{ folderName, rootKind, examTemplateId }] 已指派給該班、且已知考卷範本 */
    let _assignedFoldersByClass = {};

    function folderKeyFor(rootKind, classId, folderName) {
        return [(rootKind === 'class' ? 'class' : 'teacher'), classId || '', String(folderName || '').trim().toUpperCase()].join('|');
    }

    function normalizePairStem(raw) {
        return String(raw || '').trim().replace(/\.meta\.json$/i, '').toUpperCase();
    }

    function addOfficialLinks(bucket, stemKey, links) {
        if (!stemKey) return;
        if (!bucket[stemKey]) bucket[stemKey] = [];
        (links || []).forEach(function (l) {
            const id = l && l.exam_template_id ? String(l.exam_template_id) : '';
            if (!id) return;
            const found = bucket[stemKey].find(function (x) { return x.id === id; });
            if (found) {
                if (l.is_default) found.isDefault = true;
                return;
            }
            bucket[stemKey].push({ id: id, isDefault: !!l.is_default });
        });
    }

    async function fetchSuggestionMap(force) {
        if (_suggestionCache && !force) return _suggestionCache;
        if (_suggestionLoadPromise && !force) return _suggestionLoadPromise;
        _suggestionLoadPromise = (async function () {
            const userId = await getCurrentUserId();
            if (!userId) { _suggestionCache = {}; return _suggestionCache; }
            const { data, error } = await window.supabaseClient
                .from('material_combinations')
                .select(`
                    id,
                    material_folders!inner ( root_kind, class_id, folder_name, teacher_id ),
                    material_combination_sheets ( material_sheets ( sheet_stem, meta_file_name ) ),
                    material_combination_exam_templates ( exam_template_id, is_default ),
                    class_material_combinations ( class_id )
                `)
                .eq('material_folders.teacher_id', userId);
            if (error) {
                console.warn('[FeatureClassMaterialCombinations] 讀取官方試卷配對失敗', error);
                _suggestionCache = _suggestionCache || {};
                return _suggestionCache;
            }
            const map = {};
            const assigned = {};
            (data || []).forEach(function (combo) {
                const links = Array.isArray(combo.material_combination_exam_templates) ? combo.material_combination_exam_templates : [];
                if (!links.length) return;
                const chosen = links.find(function (l) { return l.is_default; }) || links[0];
                if (!chosen || !chosen.exam_template_id) return;
                const folder = combo.material_folders || {};
                const folderName = folder.folder_name || '';
                const rootKind = folder.root_kind === 'class' ? 'class' : 'teacher';
                const keys = [folderKeyFor(folder.root_kind, folder.class_id, folder.folder_name)];
                if (folder.root_kind !== 'class') keys.push(folderKeyFor('teacher', '', folder.folder_name));
                (combo.class_material_combinations || []).forEach(function (a) {
                    if (!a.class_id) return;
                    keys.push(folderKeyFor('teacher', a.class_id, folder.folder_name));
                    keys.push(folderKeyFor('class', a.class_id, folder.folder_name));
                    const cid = String(a.class_id);
                    if (!assigned[cid]) assigned[cid] = [];
                    const exists = assigned[cid].some(function (x) {
                        return String(x.folderName || '').trim().toUpperCase() === String(folderName).trim().toUpperCase();
                    });
                    if (!exists && folderName) {
                        assigned[cid].push({
                            folderName: folderName,
                            rootKind: rootKind,
                            examTemplateId: chosen.exam_template_id
                        });
                    }
                });
                const sheets = Array.isArray(combo.material_combination_sheets) ? combo.material_combination_sheets : [];
                const stemKeys = [];
                sheets.forEach(function (cs) {
                    const sh = cs.material_sheets || {};
                    const stem = normalizePairStem(sh.sheet_stem);
                    const meta = normalizePairStem(sh.meta_file_name);
                    if (stem && stemKeys.indexOf(stem) === -1) stemKeys.push(stem);
                    if (meta && stemKeys.indexOf(meta) === -1) stemKeys.push(meta);
                });
                keys.forEach(function (fKey) {
                    if (!map[fKey]) map[fKey] = {};
                    if (!stemKeys.length) {
                        addOfficialLinks(map[fKey], '*', links);
                        return;
                    }
                    stemKeys.forEach(function (stem) {
                        addOfficialLinks(map[fKey], stem, links);
                    });
                });
            });
            _suggestionCache = map;
            _assignedFoldersByClass = assigned;
            return _suggestionCache;
        })().finally(function () { _suggestionLoadPromise = null; });
        return _suggestionLoadPromise;
    }

    function ensureOfficialCacheLoading() {
        if (_suggestionCache === null && !_suggestionLoadPromise) {
            fetchSuggestionMap(false).then(function () {
                if (window.FeatureExamJob && typeof window.FeatureExamJob.refreshExamBuilder === 'function') {
                    window.FeatureExamJob.refreshExamBuilder();
                } else if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
                    window.FeatureTimeline.refreshBuilder({ skipSync: true });
                }
            }).catch(function () {});
        }
    }

    function pickOfficialEntriesFromBucket(bucket, hint) {
        if (!bucket) return [];
        const u = normalizePairStem(hint);
        const star = bucket['*'] ? bucket['*'].slice() : [];
        const specificKeys = Object.keys(bucket).filter(function (k) { return k !== '*'; });
        if (!u) return star;
        if (bucket[u] && bucket[u].length) return bucket[u].slice();
        if (!specificKeys.length) return star;
        // 只允許「活頁字母對到唯一一份官方 stem」。
        // 禁止用 A 去套 A.word／A.pic——那會讓沒配對的檔出現在下拉。
        if (u.indexOf('.') === -1) {
            const children = specificKeys.filter(function (k) { return k === u || k.indexOf(u + '.') === 0; });
            if (children.length === 1) return bucket[children[0]].slice();
        }
        return [];
    }

    function folderLookupKeys(rootKind, classId, folderName) {
        return [
            folderKeyFor(rootKind, classId, folderName),
            folderKeyFor('teacher', classId, folderName),
            folderKeyFor('class', classId, folderName),
            folderKeyFor('teacher', '', folderName)
        ];
    }

    /**
     * 這個 meta（資料夾＋活頁／檔名）的官方認證試卷範本 id 清單。
     * 對不到就不回資料夾萬用項——那代表這份 meta 沒被放進有搭配試卷的組合。
     */
    function listOfficialExamTemplateIds(rootKind, classId, folderName, sheetHint) {
        ensureOfficialCacheLoading();
        if (!_suggestionCache || !folderName) return [];
        const hint = Array.isArray(sheetHint) ? (sheetHint[0] || '') : sheetHint;
        const keys = folderLookupKeys(rootKind, classId, folderName);
        for (let k = 0; k < keys.length; k++) {
            const hits = pickOfficialEntriesFromBucket(_suggestionCache[keys[k]], hint);
            if (hits.length) {
                const seen = {};
                return hits.filter(function (x) {
                    if (!x || !x.id || seen[x.id]) return false;
                    seen[x.id] = true;
                    return true;
                }).map(function (x) { return x.id; });
            }
        }
        return [];
    }

    function getOfficialExamTemplateDefaultId(rootKind, classId, folderName, sheetHint) {
        ensureOfficialCacheLoading();
        if (!_suggestionCache || !folderName) return '';
        const hint = Array.isArray(sheetHint) ? (sheetHint[0] || '') : sheetHint;
        const keys = folderLookupKeys(rootKind, classId, folderName);
        for (let k = 0; k < keys.length; k++) {
            const hits = pickOfficialEntriesFromBucket(_suggestionCache[keys[k]], hint);
            if (!hits.length) continue;
            const def = hits.find(function (x) { return x && x.isDefault; });
            return (def && def.id) || hits[0].id || '';
        }
        return '';
    }

    /** 官方清單的預設項（is_default 或第一筆）。沒有官方配對回空字串。 */
    function getSuggestedExamTemplateId(rootKind, classId, folderName, sheetIds) {
        const hint = (sheetIds && sheetIds.length) ? sheetIds[0] : '';
        return getOfficialExamTemplateDefaultId(rootKind, classId, folderName, hint);
    }

    /** 已指派給這個班級、且已知考卷範本的教材資料夾 */
    function listAssignedFoldersForClass(classId) {
        ensureOfficialCacheLoading();
        return (_assignedFoldersByClass[String(classId || '')] || []).slice();
    }

    function isFolderAssignedToClass(classId, folderName) {
        const want = String(folderName || '').trim().toUpperCase();
        if (!want) return false;
        return listAssignedFoldersForClass(classId).some(function (f) {
            return String(f.folderName || '').trim().toUpperCase() === want;
        });
    }

    function invalidateSuggestionCache() { _suggestionCache = null; _assignedFoldersByClass = {}; }

    function isOfficialPairingCacheReady() { return _suggestionCache !== null; }

    function fetchOfficialPairings(force) { return fetchSuggestionMap(!!force); }

    /** 這個教材資料夾是否有任何官方試卷配對（含整夾萬用 *）。 */
    function folderHasOfficialExamPairing(rootKind, classId, folderName) {
        ensureOfficialCacheLoading();
        if (!_suggestionCache || !folderName) return false;
        const keys = folderLookupKeys(rootKind, classId, folderName);
        for (let k = 0; k < keys.length; k++) {
            const bucket = _suggestionCache[keys[k]];
            if (!bucket) continue;
            if (Object.keys(bucket).length) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------
    // 🖼 render
    // ------------------------------------------------------------------

    function classCheckboxesHtml(prefix, alreadyAssignedClassIds) {
        const classes = allClasses();
        if (!classes.length) return '<div style="color:#94A3B8; font-size:0.78rem;">目前沒有任何班級</div>';
        return classes.map(function (c) {
            const disabled = alreadyAssignedClassIds.indexOf(String(c.id)) !== -1;
            return '<label style="display:inline-flex; align-items:center; gap:4px; margin:2px 10px 2px 0; font-size:0.78rem; ' + (disabled ? 'color:#94A3B8;' : 'color:#334155;') + '">'
                + '<input type="checkbox" class="' + prefix + '-class-cb" value="' + esc(c.id) + '" ' + (disabled ? 'disabled checked' : '') + '>'
                + esc(c.name || c.id) + (disabled ? '（已指派）' : '')
                + '</label>';
        }).join('');
    }

    /** Step 2：考卷範本勾選清單（可多選），沒有任何考卷範本時提示先去建立 */
    function examTemplateCheckboxesHtml(prefix, checkedIds) {
        const templates = examTemplatesList();
        const checked = checkedIds || [];
        if (!templates.length) {
            return '<div style="color:#B45309; font-size:0.78rem;">目前還沒有任何試卷範本，請先按下面「🧾 新增試卷範本」建立至少一個。</div>';
        }
        return templates.map(function (t) {
            return '<label style="display:inline-flex; align-items:center; gap:4px; margin:2px 10px 2px 0; font-size:0.78rem; color:#334155;">'
                + '<input type="checkbox" class="' + prefix + '-exam-tpl-cb" value="' + esc(t.id) + '" ' + (checked.indexOf(t.id) !== -1 ? 'checked' : '') + '>'
                + esc(t.name)
                + '</label>';
        }).join('');
    }

    function openNewExamTemplateShortcut() {
        const container = document.getElementById('exam-template-editor-container');
        if (container && typeof container.scrollIntoView === 'function') container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.FeatureExamTemplateEditor && typeof window.FeatureExamTemplateEditor.openNewForm === 'function') {
            window.FeatureExamTemplateEditor.openNewForm();
        }
    }

    function renderGroupRowHtml(group, idx, alreadyComboClassIds) {
        const rootLabel = group.root_kind === 'class' ? ('🏫 ' + esc(classNameById(group.class_id))) : '👤 老師個人';
        return '<div class="cmc-group-row" data-idx="' + idx + '" style="background:white; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:8px;">'
            + '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">'
            + '<span style="font-size:0.82rem; color:#334155;">' + rootLabel + '｜📁 <strong>' + esc(group.folder_name) + '</strong>｜🧩 ' + esc(group.template_name) + '｜共 ' + group.sheet_ids.length + ' 個活頁</span>'
            + '<button type="button" class="cmc-group-assign-btn btn" data-idx="' + idx + '" style="padding:4px 10px; font-size:0.76rem; font-weight:800; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">➕ 建立教材組合</button>'
            + '</div>'
            + '<div class="cmc-group-assign-form" data-idx="' + idx + '" style="display:none; margin-top:10px; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:6px; padding:10px;">'
            + '<label style="font-size:0.76rem; font-weight:800; color:#475569; display:block; margin-bottom:6px;">組合名稱（選填，方便日後辨識）'
            + '<input type="text" class="form-control cmc-group-label" placeholder="例如「GEPT-2 全冊」" style="width:260px; padding:5px; margin-top:2px; display:block;">'
            + '</label>'
            + '<div style="border-top:1px dashed #CBD5E1; margin:8px 0; padding-top:8px;">'
            + '<div style="font-size:0.76rem; font-weight:800; color:#7C3AED; margin-bottom:4px;">Step 2：套用試卷範本（至少勾選一個，這是「明確搭配」，不是自動繼承）</div>'
            + '<div class="cmc-group-exam-tpl-checks">' + examTemplateCheckboxesHtml('cmc-group', []) + '</div>'
            + '<button type="button" class="cmc-group-new-exam-tpl-btn btn" data-idx="' + idx + '" style="margin-top:4px; padding:2px 8px; font-size:0.72rem; background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; border-radius:5px;">🧾 新增試卷範本</button>'
            + '</div>'
            + '<div style="border-top:1px dashed #CBD5E1; margin:8px 0; padding-top:8px;">'
            + '<div style="font-size:0.76rem; font-weight:800; color:#475569; margin-bottom:4px;">Step 3：指派給班級</div>'
            + '<div class="cmc-group-class-checks">' + classCheckboxesHtml('cmc-group', alreadyComboClassIds || []) + '</div>'
            + '</div>'
            + '<div style="margin-top:8px; display:flex; align-items:center; gap:8px;">'
            + '<button type="button" class="cmc-group-confirm-btn btn btn-primary" data-idx="' + idx + '" style="padding:5px 14px; font-weight:800; font-size:0.78rem;">✅ 確定建立並指派</button>'
            + '<span class="cmc-group-msg" data-idx="' + idx + '" style="font-size:0.76rem; font-weight:700;"></span>'
            + '</div>'
            + '</div>'
            + '</div>';
    }

    function renderComboCardHtml(combo, idx) {
        const folder = combo.material_folders || {};
        const tpl = combo.material_templates || null;
        const rootLabel = folder.root_kind === 'class' ? ('🏫 ' + esc(classNameById(folder.class_id))) : '👤 老師個人';
        const sheetCount = Array.isArray(combo.material_combination_sheets) ? combo.material_combination_sheets.length : 0;
        const examLinks = Array.isArray(combo.material_combination_exam_templates) ? combo.material_combination_exam_templates : [];
        const examIds = examLinks.map(function (l) { return l.exam_template_id; }).filter(Boolean);
        const examChipsHtml = examIds.length
            ? examIds.map(function (id) {
                return '<span style="display:inline-flex; align-items:center; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:14px; padding:2px 10px; margin:2px 4px 0 0; font-size:0.74rem; color:#6D28D9;">🧾 ' + esc(examTemplateNameById(id)) + '</span>';
            }).join('')
            : '<span style="color:#B45309; font-size:0.76rem; font-weight:700;">⚠️ 尚未套用試卷範本，出題畫面不會標⭐建議</span>';
        const assignments = Array.isArray(combo.class_material_combinations) ? combo.class_material_combinations : [];
        const chipsHtml = assignments.length
            ? assignments.map(function (a) {
                return '<span class="cmc-assign-chip" data-id="' + esc(a.id) + '" style="display:inline-flex; align-items:center; gap:4px; background:#F0FDF4; border:1px solid #BBF7D0; border-radius:14px; padding:2px 4px 2px 10px; margin:2px 4px 0 0; font-size:0.74rem; color:#15803D;">'
                    + esc(classNameById(a.class_id))
                    + '<button type="button" class="cmc-assign-remove-btn" data-id="' + esc(a.id) + '" title="移除這個班級的指派" style="border:none; background:transparent; color:#B91C1C; font-weight:800; cursor:pointer; padding:0 6px;">✕</button>'
                    + '</span>';
            }).join('')
            : '<span style="color:#94A3B8; font-size:0.76rem;">尚未指派給任何班級</span>';
        return '<div class="cmc-combo-card" data-combo-idx="' + idx + '" data-combo-id="' + esc(combo.id) + '" style="background:white; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:8px;">'
            + '<div style="font-size:0.82rem; color:#334155;">' + rootLabel + '｜📁 <strong>' + esc(folder.folder_name || '') + '</strong>｜🧩 ' + esc(tpl ? tpl.name : '（找不到擷取範本）') + '｜共 ' + sheetCount + ' 個活頁'
            + (combo.label ? ('｜🏷️ ' + esc(combo.label)) : '') + '</div>'
            + '<div style="margin-top:6px;">' + examChipsHtml
            + ' <button type="button" class="cmc-combo-edit-exam-tpl-btn btn" data-idx="' + idx + '" style="padding:1px 8px; font-size:0.7rem; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:5px;">✏️ 編輯試卷範本搭配</button></div>'
            + '<div class="cmc-combo-exam-tpl-edit-form" data-idx="' + idx + '" style="display:none; margin-top:8px; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:6px; padding:8px;">'
            + '<div class="cmc-combo-exam-tpl-checks">' + examTemplateCheckboxesHtml('cmc-combo-' + idx, examIds) + '</div>'
            + '<div style="margin-top:6px; display:flex; align-items:center; gap:8px;">'
            + '<button type="button" class="cmc-combo-new-exam-tpl-btn btn" style="padding:2px 8px; font-size:0.72rem; background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; border-radius:5px;">🧾 新增試卷範本</button>'
            + '<button type="button" class="cmc-combo-save-exam-tpl-btn btn btn-primary" data-idx="' + idx + '" style="padding:3px 12px; font-size:0.74rem; font-weight:800;">💾 儲存搭配</button>'
            + '<span class="cmc-combo-exam-tpl-msg" data-idx="' + idx + '" style="font-size:0.74rem; font-weight:700;"></span>'
            + '</div>'
            + '</div>'
            + '<div style="margin-top:6px;">' + chipsHtml + '</div>'
            + '</div>';
    }

    function paint(wrap, groups, combos) {
        const comboClassIdsByGroupKey = {};
        combos.forEach(function (c) {
            const key = c.material_folder_id + '|' + c.extraction_template_id;
            comboClassIdsByGroupKey[key] = (Array.isArray(c.class_material_combinations) ? c.class_material_combinations : [])
                .map(function (a) { return String(a.class_id); });
        });

        wrap.innerHTML = `
            ${renderClassReviewDeskHtml(combos)}
            <div style="background:#F8FAFC; padding:20px; border-radius:12px; border:2px solid #CBD5E1; margin-top:16px;">
                <h3 style="margin:0 0 4px 0; color:var(--primary-dark);">🏫 班級教材組合：把「套用到教材」的組合搭配試卷範本後指派給班級</h3>
                <p style="color:#64748B; font-size:0.8rem; margin:0 0 12px 0;">下面每一列都是上面「📎 套用到教材」已經有的（教材資料夾＋擷取範本）組合。選一組 → 勾選要搭配的試卷範本（Step 2，至少一個）→ 選要指派的班級（Step 3），三步驟一次完成；之後可以在資料庫查到「這個班級用了哪個教材組合、搭配哪個試卷範本」。只是額外記錄關聯，不影響出題與 Drive 上的檔案。</p>
                <div id="cmc-groups-list">${groups.length ? groups.map(function (g, idx) { return renderGroupRowHtml(g, idx, comboClassIdsByGroupKey[groupKeyOf(g)] || []); }).join('') : '<div style="color:#94A3B8; font-size:0.8rem; padding:8px 0;">目前還沒有任何「套用到教材」的紀錄，請先到上面「📎 套用到教材」建立至少一組。</div>'}</div>

                <h4 style="margin:16px 0 6px 0; color:#15803D;">已建立的班級教材組合</h4>
                <div id="cmc-combos-list">${combos.length ? combos.map(renderComboCardHtml).join('') : '<div style="color:#94A3B8; font-size:0.8rem; padding:8px 0;">尚未指派任何班級教材組合。</div>'}</div>
            </div>
        `;

        wrap.querySelectorAll('.cmc-group-assign-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const idx = btn.getAttribute('data-idx');
                const form = wrap.querySelector('.cmc-group-assign-form[data-idx="' + idx + '"]');
                if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
            });
        });

        wrap.querySelectorAll('.cmc-group-new-exam-tpl-btn').forEach(function (btn) {
            btn.addEventListener('click', openNewExamTemplateShortcut);
        });
        wrap.querySelectorAll('.cmc-combo-new-exam-tpl-btn').forEach(function (btn) {
            btn.addEventListener('click', openNewExamTemplateShortcut);
        });

        wrap.querySelectorAll('.cmc-group-confirm-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const idx = parseInt(btn.getAttribute('data-idx'), 10);
                const group = groups[idx];
                const form = wrap.querySelector('.cmc-group-assign-form[data-idx="' + idx + '"]');
                const msgEl = wrap.querySelector('.cmc-group-msg[data-idx="' + idx + '"]');
                const labelEl = form.querySelector('.cmc-group-label');
                const checkedExamTemplateIds = Array.from(form.querySelectorAll('.cmc-group-exam-tpl-cb:checked')).map(function (cb) { return cb.value; });
                if (!checkedExamTemplateIds.length) {
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少勾選一個試卷範本（Step 2）'; }
                    return;
                }
                const checkedClassIds = Array.from(form.querySelectorAll('.cmc-group-class-cb:checked:not(:disabled)')).map(function (cb) { return cb.value; });
                if (!checkedClassIds.length) {
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少勾選一個尚未指派的班級（Step 3）'; }
                    return;
                }
                btn.disabled = true;
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 建立中…'; }
                try {
                    const userId = await getCurrentUserId();
                    if (!userId) throw new Error('尚未登入');
                    const comboId = await ensureCombination(userId, group, (labelEl && labelEl.value.trim()) || '');
                    await setComboExamTemplates(comboId, checkedExamTemplateIds);
                    await assignToClasses(comboId, checkedClassIds, userId);
                    invalidateSuggestionCache();
                    window.showFlash && window.showFlash('✅ 已建立組合並指派給 ' + checkedClassIds.length + ' 個班級');
                    render();
                } catch (err) {
                    console.error('[FeatureClassMaterialCombinations] 建立/指派失敗', err);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 失敗：' + (err.message || err); }
                    btn.disabled = false;
                }
            });
        });

        wrap.querySelectorAll('.cmc-combo-edit-exam-tpl-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const idx = btn.getAttribute('data-idx');
                const form = wrap.querySelector('.cmc-combo-exam-tpl-edit-form[data-idx="' + idx + '"]');
                if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
            });
        });

        wrap.querySelectorAll('.cmc-combo-save-exam-tpl-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const idx = parseInt(btn.getAttribute('data-idx'), 10);
                const combo = combos[idx];
                const form = wrap.querySelector('.cmc-combo-exam-tpl-edit-form[data-idx="' + idx + '"]');
                const msgEl = wrap.querySelector('.cmc-combo-exam-tpl-msg[data-idx="' + idx + '"]');
                const checkedExamTemplateIds = Array.from(form.querySelectorAll('.cmc-combo-' + idx + '-exam-tpl-cb:checked')).map(function (cb) { return cb.value; });
                if (!checkedExamTemplateIds.length) {
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少勾選一個試卷範本'; }
                    return;
                }
                btn.disabled = true;
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
                try {
                    await setComboExamTemplates(combo.id, checkedExamTemplateIds);
                    invalidateSuggestionCache();
                    window.showFlash && window.showFlash('✅ 已更新試卷範本搭配', 'success');
                    render();
                } catch (err) {
                    console.error('[FeatureClassMaterialCombinations] 更新考卷範本搭配失敗', err);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 失敗：' + (err.message || err); }
                    btn.disabled = false;
                }
            });
        });

        bindClassReviewDesk(wrap);

        wrap.querySelectorAll('.cmc-assign-remove-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const id = btn.getAttribute('data-id');
                if (!window.confirm('確定要移除這個班級的教材組合指派嗎？（只移除這筆關聯，不會動到 Drive 上的檔案）')) return;
                try {
                    await removeAssignment(id);
                    window.showFlash && window.showFlash('✅ 已移除指派', 'success');
                    render();
                } catch (err) {
                    console.error('[FeatureClassMaterialCombinations] 移除指派失敗', err);
                    window.showFlash && window.showFlash('❌ 移除失敗：' + (err.message || err), 'error');
                }
            });
        });
    }

    function render() {
        const wrap = document.getElementById('class-material-combinations-container');
        if (!wrap) return;
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:var(--primary); font-weight:800;">⏳ 載入班級教材組合…</div>';
        (async function () {
            const userId = await getCurrentUserId();
            if (!userId) { wrap.innerHTML = ''; return; }
            const examTemplatesPromise = (window.FeatureExamJob && typeof window.FeatureExamJob.fetchExamTemplates === 'function')
                ? window.FeatureExamJob.fetchExamTemplates(false)
                : Promise.resolve([]);
            const [groups, combos] = await Promise.all([loadGroups(userId), loadCombinations(userId), examTemplatesPromise]);
            paint(wrap, groups, combos);
        })().catch(function (err) {
            console.error('[FeatureClassMaterialCombinations] 載入失敗', err);
            wrap.innerHTML = '<div style="padding:16px; color:#EF4444; font-weight:800;">❌ 載入失敗：' + esc(err.message || err) + '</div>';
        });
    }

    /**
     * 給「從本機 Excel 套用範本」即時顯示：這個教材資料夾＋擷取範本目前已指派給哪些班級。
     */
    async function lookupUsage(folderName, templateId) {
        const userId = await getCurrentUserId();
        if (!userId || !folderName || !templateId) return { classIds: [], classNames: [] };
        const combos = await loadCombinations(userId);
        const folderU = String(folderName || '').trim().toUpperCase();
        const classIds = [];
        (combos || []).forEach(function (c) {
            const fn = (c.material_folders && c.material_folders.folder_name) || '';
            if (String(fn).trim().toUpperCase() !== folderU) return;
            if (String(c.extraction_template_id) !== String(templateId)) return;
            (c.class_material_combinations || []).forEach(function (a) {
                if (a.class_id && classIds.indexOf(a.class_id) === -1) classIds.push(a.class_id);
            });
        });
        return { classIds: classIds, classNames: classIds.map(classNameById) };
    }

    /**
     * 套用範本並產出 meta/script 後寫入組合＋（可選）考卷角色＋班級指派。
     * 找不到對應 material_sheets 時仍會建立／更新 material_combinations（活頁連結可為空），
     * 至少把「哪個原始檔／哪個擷取範本／有沒有當試卷範本／指派給哪些班」記下來。
     */
    async function recordApplyFromExcel(opts) {
        const o = opts || {};
        const userId = await getCurrentUserId();
        if (!userId) return;
        const folderName = String(o.folderName || '').trim();
        const templateId = o.templateId || '';
        if (!folderName || !templateId) return;
        const groups = await loadGroups(userId);
        const folderU = folderName.toUpperCase();
        let group = groups.find(function (g) {
            return String(g.folder_name || '').trim().toUpperCase() === folderU
                && String(g.extraction_template_id) === String(templateId);
        });
        if (!group) {
            const { data: folders, error: folderErr } = await window.supabaseClient
                .from('material_folders')
                .select('id, folder_name')
                .eq('teacher_id', userId);
            if (folderErr) throw folderErr;
            const folder = (folders || []).find(function (f) {
                return String(f.folder_name || '').trim().toUpperCase() === folderU;
            });
            if (!folder) return;
            group = {
                material_folder_id: folder.id,
                extraction_template_id: templateId,
                sheet_db_ids: []
            };
        }
        const comboId = await ensureCombination(userId, group, null);
        if (o.includeExam) {
            await setComboExamTemplates(comboId, [templateId]);
        }
        const classIds = Array.isArray(o.classIds) ? o.classIds.filter(Boolean) : [];
        if (classIds.length) await assignToClasses(comboId, classIds, userId);
        _suggestionCache = null;
        _usageSummaryCache = null;
    }

    /**
     * 每個範本目前真正套到哪些教材資料夾、指派給哪些班級、有沒有當試卷搭配。
     * 給擷取／試卷清單與「套用目前的範本」下拉用，避免只看到名字、看不出實際使用狀況。
     */
    let _usageSummaryCache = null;
    async function summarizeUsageByTemplate() {
        const userId = await getCurrentUserId();
        if (!userId) {
            _usageSummaryCache = {};
            return _usageSummaryCache;
        }
        const [groups, combos, applyRows] = await Promise.all([
            loadGroups(userId),
            loadCombinations(userId),
            loadExtractionApplyRecords(userId)
        ]);
        const out = {};
        function emptySide() { return { folders: [], byFolder: {}, records: [] }; }
        function ensure(id) {
            const key = String(id || '');
            if (!key) return null;
            if (!out[key]) out[key] = { folders: [], classNames: [], extraction: emptySide(), exam: emptySide(), hasExam: false };
            return out[key];
        }
        function addToSide(rec, side, folderName, classId, sheetIds, extra) {
            const fn = String(folderName || '').trim();
            if (!rec || !side || !fn) return;
            if (!side.byFolder[fn]) side.byFolder[fn] = { classNames: [], sheetIds: [], templateNames: [] };
            if (!side.byFolder[fn].templateNames) side.byFolder[fn].templateNames = [];
            if (side.folders.indexOf(fn) === -1) side.folders.push(fn);
            if (rec.folders.indexOf(fn) === -1) rec.folders.push(fn);
            (sheetIds || []).forEach(function (s) {
                const stem = String(s || '').trim();
                if (stem && side.byFolder[fn].sheetIds.indexOf(stem) === -1) side.byFolder[fn].sheetIds.push(stem);
            });
            side.byFolder[fn].sheetIds = collapseRelatedSheetStems(side.byFolder[fn].sheetIds);
            const tplName = extra && extra.templateName ? String(extra.templateName).trim() : '';
            if (tplName && side.byFolder[fn].templateNames.indexOf(tplName) === -1) {
                side.byFolder[fn].templateNames.push(tplName);
            }
            if (!classId) return;
            const n = classNameById(classId);
            if (!n) return;
            if (side.byFolder[fn].classNames.indexOf(n) === -1) side.byFolder[fn].classNames.push(n);
            if (rec.classNames.indexOf(n) === -1) rec.classNames.push(n);
        }
        const groupByKey = {};
        const sheetsByFolder = {};
        (groups || []).forEach(function (g) {
            groupByKey[g.material_folder_id + '|' + g.extraction_template_id] = g;
            const fn = String(g.folder_name || '').trim();
            if (!fn) return;
            if (!sheetsByFolder[fn]) sheetsByFolder[fn] = [];
            (g.sheet_ids || []).forEach(function (s) {
                const stem = String(s || '').trim();
                if (stem && sheetsByFolder[fn].indexOf(stem) === -1) sheetsByFolder[fn].push(stem);
            });
            sheetsByFolder[fn] = collapseRelatedSheetStems(sheetsByFolder[fn]);
        });
        function examSheetsForFolder(folderName, preferred) {
            const picked = (preferred && preferred.length)
                ? preferred
                : ((sheetsByFolder[String(folderName || '').trim()] && sheetsByFolder[String(folderName || '').trim()].length)
                    ? sheetsByFolder[String(folderName || '').trim()]
                    : []);
            return collapseRelatedSheetStems(picked);
        }
        (applyRows || []).forEach(function (row) {
            const rec = ensure(row.extraction_template_id);
            if (!rec) return;
            const folderName = (row.material_folders && row.material_folders.folder_name) || '';
            const sourceFile = String(row.source_file_name || '').trim();
            const stem = String(row.sheet_stem || '').trim().replace(/\.meta\.json$/i, '');
            const tplName = (row.material_templates && row.material_templates.name)
                || templateNameById(row.extraction_template_id)
                || '';
            const metaName = toMetaFileName(stem, tplName);
            if (folderName && rec.folders.indexOf(folderName) === -1) rec.folders.push(folderName);
            if (!folderName && !sourceFile && !stem) return;
            const key = (sourceFile || folderName || stem).toUpperCase() + '|' + String(folderName).trim().toUpperCase();
            if (!rec.extraction.byKey) rec.extraction.byKey = {};
            if (!rec.extraction.byKey[key]) {
                const item = {
                    sourceFile: sourceFile,
                    sheets: [],
                    metaFiles: [],
                    targetFolder: folderName
                };
                rec.extraction.byKey[key] = item;
                rec.extraction.records.push(item);
            }
            const item = rec.extraction.byKey[key];
            const sheetLabel = sheetLabelFromStem(stem, tplName);
            if (sheetLabel && item.sheets.indexOf(sheetLabel) === -1) item.sheets.push(sheetLabel);
            if (metaName && item.metaFiles.indexOf(metaName) === -1) item.metaFiles.push(metaName);
            item.metaFiles = collapseRelatedSheetStems(item.metaFiles).map(function (s) {
                return /\.meta\.json$/i.test(s) ? s : (s + '.meta.json');
            });
            if (folderName && rec.extraction.folders.indexOf(folderName) === -1) rec.extraction.folders.push(folderName);
        });
        (combos || []).forEach(function (c) {
            const rec = ensure(c.extraction_template_id);
            const folderName = c.material_folders && c.material_folders.folder_name;
            const assigns = c.class_material_combinations || [];
            const g = groupByKey[c.material_folder_id + '|' + c.extraction_template_id];
            const sheetIds = examSheetsForFolder(folderName, (g && g.sheet_ids) ? g.sheet_ids : []);
            if (folderName && rec && rec.folders.indexOf(folderName) === -1) rec.folders.push(folderName);
            assigns.forEach(function (a) {
                if (!rec) return;
                const n = classNameById(a.class_id);
                if (n && rec.classNames.indexOf(n) === -1) rec.classNames.push(n);
            });
            (c.material_combination_exam_templates || []).forEach(function (l) {
                if (!l.exam_template_id) return;
                if (String(l.exam_template_id) === String(c.extraction_template_id) && rec) rec.hasExam = true;
                const examRec = ensure(l.exam_template_id);
                if (!examRec) return;
                examRec.hasExam = true;
                const examTplName = templateNameById(l.exam_template_id);
                if (!assigns.length) addToSide(examRec, examRec.exam, folderName, null, sheetIds, { templateName: examTplName });
                assigns.forEach(function (a) { addToSide(examRec, examRec.exam, folderName, a.class_id, sheetIds, { templateName: examTplName }); });
            });
        });
        _usageSummaryCache = out;
        return out;
    }

    function getUsageSummaryCachedSync() {
        return _usageSummaryCache || {};
    }

    /**
     * 統一列格式：主詞｜（N 個單位）｜後段。
     * 數量永遠緊接主詞；有項目才可點開。後段（例如班級）永遠在數量後面。
     */
    function usageExpandRowHtml(lead, items, unit, trail) {
        const list = items || [];
        const n = list.length;
        const unitText = unit || '項目';
        const countHtml = n
            ? '<button type="button" class="mlp-usage-sheets-toggle" data-count="' + n + '" data-unit="' + esc(unitText) + '" style="padding:0; border:none; background:none; color:#047857; font-weight:800; font-size:0.76rem; text-decoration:underline; cursor:pointer;">（' + n + ' 個' + esc(unitText) + '）</button>'
            : '<span style="color:#94A3B8;">（0 個' + esc(unitText) + '）</span>';
        const previewLimit = 8;
        const shown = list.slice(0, previewLimit).map(esc).join('、');
        const extra = list.length > previewLimit ? ('、還有 ' + (list.length - previewLimit) + ' 個') : '';
        const box = n
            ? '<div class="mlp-usage-sheets" style="display:none; font-size:0.72rem; font-weight:600; color:#047857; margin:2px 0 4px 1em;">' + shown + extra + '</div>'
            : '';
        const trailHtml = trail ? ('｜' + esc(trail)) : '';
        return '<div style="font-size:0.76rem; color:#047857; font-weight:700;">' + esc(lead) + '｜' + countHtml + trailHtml + '</div>' + box;
    }

    function sheetLabelFromStem(sheetStem, templateName) {
        let s = String(sheetStem || '').trim().replace(/\.meta\.json$/i, '');
        const t = String(templateName || '').trim().replace(/[\\/]/g, '-');
        if (t) {
            const re = new RegExp('\\.' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
            s = s.replace(re, '');
        }
        return s || String(sheetStem || '').trim().replace(/\.meta\.json$/i, '');
    }

    function toMetaFileName(sheetStem, templateName) {
        let s = String(sheetStem || '').trim();
        if (!s) return '';
        if (/\.meta\.json$/i.test(s)) return s;
        const tpl = String(templateName || '').trim().replace(/[\\/]/g, '-');
        if (tpl) {
            const suffix = '.' + tpl;
            if (s.length >= suffix.length && s.slice(-suffix.length).toLowerCase() === suffix.toLowerCase()) {
                return s + '.meta.json';
            }
            if (s.indexOf('.') < 0) return s + suffix + '.meta.json';
        }
        return s + '.meta.json';
    }

    function usageExamSideHtml(side, emptyText, fallbackTemplateName) {
        const folders = (side && side.folders) ? side.folders : [];
        if (!folders.length) {
            return '<div style="font-size:0.76rem; color:#94A3B8; font-weight:700; margin-left:2px;">' + esc(emptyText) + '</div>';
        }
        return folders.map(function (fn) {
            const info = side.byFolder && side.byFolder[fn];
            const names = (info && info.templateNames && info.templateNames.length)
                ? info.templateNames
                : (fallbackTemplateName ? [fallbackTemplateName] : []);
            const classes = (info && info.classNames) ? info.classNames : [];
            const classPart = classes.length ? ('班級 ' + classes.join('、')) : '尚未指派班級';
            return usageExpandRowHtml('教材 ' + fn, names, '範本', classPart);
        }).join('');
    }

    function usageExtractionHtml(side, emptyText) {
        const records = ((side && side.records) ? side.records : []).filter(function (r) {
            return r && (r.sourceFile || r.targetFolder || (r.metaFiles && r.metaFiles.length) || (r.sheets && r.sheets.length));
        });
        if (!records.length) {
            return '<div style="font-size:0.76rem; color:#94A3B8; font-weight:700; margin-left:2px;">' + esc(emptyText) + '</div>';
        }
        return records.map(function (r) {
            const sheets = (r.sheets && r.sheets.length) ? r.sheets : [];
            const files = (r.metaFiles && r.metaFiles.length) ? r.metaFiles : [];
            const parts = [];
            if (r.sourceFile) parts.push(usageExpandRowHtml('檔案 ' + r.sourceFile, sheets, '活頁'));
            if (r.targetFolder) parts.push(usageExpandRowHtml('教材 ' + r.targetFolder, files, 'meta'));
            if (!parts.length) parts.push(usageExpandRowHtml('meta 檔', files, 'meta'));
            return '<div style="margin-top:4px;">' + parts.join('') + '</div>';
        }).join('');
    }

    function renderTemplateUsageHtml(templateId, opts) {
        const o = opts || {};
        const lead = o.lead === 'exam' ? 'exam' : 'extraction';
        const u = (_usageSummaryCache || {})[String(templateId || '')] || {};
        const extraction = u.extraction || { folders: [], byFolder: {}, records: [] };
        const exam = u.exam || { folders: [], byFolder: {} };
        const hasAny = (extraction.records && extraction.records.length) || (exam.folders && exam.folders.length);
        if (!hasAny) {
            return '<div style="font-size:0.76rem; color:#047857; font-weight:700; margin-top:4px;">實際使用：</div>'
                + '<div style="font-size:0.76rem; color:#047857; font-weight:700;">尚未套用到任何教材／班級</div>';
        }
        const extractionBlock = '<div style="margin-top:4px;"><span style="display:inline-flex; align-items:center; padding:1px 8px; font-size:0.72rem; font-weight:800; color:#6D28D9; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:10px;">擷取範本</span></div>'
            + usageExtractionHtml(extraction, '尚未套用到教材');
        const examBlock = '<div style="margin-top:6px;"><span style="display:inline-flex; align-items:center; padding:1px 8px; font-size:0.72rem; font-weight:800; color:#1D4ED8; background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px;">🧾 試卷範本</span></div>'
            + usageExamSideHtml(exam, '尚未作為試卷套用', templateNameById(templateId));
        const body = lead === 'exam' ? (examBlock + extractionBlock) : (extractionBlock + examBlock);
        return '<div style="font-size:0.76rem; color:#047857; font-weight:700; margin-top:4px;">實際使用：</div>' + body;
    }

    function bindUsageSheetToggles(root) {
        if (!root) return;
        root.querySelectorAll('.mlp-usage-sheets-toggle').forEach(function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                const row = this.closest('div');
                const box = row && row.nextElementSibling && row.nextElementSibling.classList.contains('mlp-usage-sheets')
                    ? row.nextElementSibling
                    : null;
                if (!box) return;
                const open = box.style.display !== 'none';
                box.style.display = open ? 'none' : 'block';
                const n = this.getAttribute('data-count') || '0';
                const unit = this.getAttribute('data-unit') || '活頁';
                this.textContent = open ? ('（' + n + ' 個' + unit + '）') : ('（收合' + unit + '）');
            });
        });
    }

    return {
        render: render,
        getSuggestedExamTemplateId: getSuggestedExamTemplateId,
        listOfficialExamTemplateIds: listOfficialExamTemplateIds,
        getOfficialExamTemplateDefaultId: getOfficialExamTemplateDefaultId,
        isOfficialPairingCacheReady: isOfficialPairingCacheReady,
        fetchOfficialPairings: fetchOfficialPairings,
        folderHasOfficialExamPairing: folderHasOfficialExamPairing,
        listAssignedFoldersForClass: listAssignedFoldersForClass,
        isFolderAssignedToClass: isFolderAssignedToClass,
        lookupUsage: lookupUsage,
        recordApplyFromExcel: recordApplyFromExcel,
        summarizeUsageByTemplate: summarizeUsageByTemplate,
        getUsageSummaryCachedSync: getUsageSummaryCachedSync,
        renderTemplateUsageHtml: renderTemplateUsageHtml,
        bindUsageSheetToggles: bindUsageSheetToggles
    };
})();

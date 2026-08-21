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
 * 套餐（名稱／試卷範本／採用班級）只在教材區編輯並存檔，其他畫面只讀、不准另開一條寫入。
 *
 * 只做資料庫層的組合＋指派，不影響「產生線上卷」本身讀取教材的路徑（那條路徑仍然是
 * feature-exam-job.js 直接讀 material_folder 字串＋Drive meta）。
 * 出題下拉的試卷範本只能列這裡的官方認證組合（listOfficialExamTemplateIds），
 * 一個 meta 可對多個試卷範本；沒有官方配對就不能出卷。
 */
window.FeatureClassMaterialCombinations = (function () {
    'use strict';

    if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
        window.MaterialNameMap.ensureLoaded(false).catch(function () {});
    }

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
        return (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getExamTemplates === 'function')
            ? window.FeatureTemplateLibrary.getExamTemplates()
            : [];
    }

    function examTemplateNameById(id) {
        const n = templateNameById(id);
        return n || '（找不到試卷範本）';
    }

    function templateNameById(id) {
        if (!id || !window.FeatureTemplateLibrary || typeof window.FeatureTemplateLibrary.getTemplatesCachedSync !== 'function') return '';
        const t = window.FeatureTemplateLibrary.getTemplatesCachedSync().find(function (x) {
            return String(x.id) === String(id);
        });
        return t && t.name ? String(t.name).trim() : '';
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
                id,
                sheet_stem,
                meta_file_name,
                script_file_name,
                extraction_template_id,
                source_kind,
                source_file_name,
                material_folders!inner ( id, folder_name, teacher_id ),
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
        const selectBody = function (withSourceLabels) {
            return `
                id,
                label,
                ${withSourceLabels ? 'source_labels,' : ''}
                material_folder_id,
                extraction_template_id,
                created_at,
                material_folders!inner ( id, root_kind, class_id, folder_name, teacher_id ),
                material_templates ( id, name ),
                material_combination_sheets ( material_sheet_id, material_sheets ( id, sheet_stem, meta_file_name, script_file_name ) ),
                material_combination_exam_templates ( id, exam_template_id, is_default ),
                class_material_combinations ( id, class_id, assigned_at )
            `;
        };
        let result = await window.supabaseClient
            .from('material_combinations')
            .select(selectBody(true))
            .eq('material_folders.teacher_id', userId)
            .order('created_at', { ascending: false });
        if (result.error && /source_labels/i.test(result.error.message || '')) {
            result = await window.supabaseClient
                .from('material_combinations')
                .select(selectBody(false))
                .eq('material_folders.teacher_id', userId)
                .order('created_at', { ascending: false });
        }
        if (result.error) throw result.error;
        return result.data || [];
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
    // 官方配對：老師在教材區勾選的 material_combination_exam_templates。
    // 出題下拉只能列這些。套餐設定不准在別處另寫一筆。
    // ------------------------------------------------------------------
    let _suggestionCache = null;
    let _suggestionLoadPromise = null;
    /** folderKey → 真正的產出 meta 檔名（禁止把 Excel 活頁名 vBK-2 當成 vBK-2.meta.json） */
    let _officialMetaFilesByFolderKey = {};
    /** classId → [{ folderName, rootKind, examTemplateId }] 已指派給該班、且已知考卷範本 */
    let _assignedFoldersByClass = {};
    /** classId → 已指派且已搭配試卷範本的套餐（出題第一層） */
    let _assignedCombosByClass = {};

    function comboDisplayLabel(label, folderName, tplName) {
        const named = String(label || '').trim();
        if (named) return named;
        const folder = String(folderName || '').trim();
        const tpl = String(tplName || '').trim();
        if (folder && tpl) return folder + ' ' + tpl;
        return folder || tpl || '（未命名套餐）';
    }

    function folderKeyFor(rootKind, classId, folderName) {
        return [(rootKind === 'class' ? 'class' : 'teacher'), classId || '', String(folderName || '').trim().toUpperCase()].join('|');
    }

    function normalizePairStem(raw) {
        return String(raw || '').trim()
            .replace(/\.meta\.json$/i, '')
            .replace(/\.meta$/i, '')
            .toUpperCase();
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
            const comboRes = await window.supabaseClient
                .from('material_combinations')
                .select(`
                    id,
                    label,
                    extraction_template_id,
                    material_folder_id,
                    material_folders!inner ( root_kind, class_id, folder_name, teacher_id ),
                    material_templates ( name ),
                    material_combination_sheets ( material_sheets ( sheet_stem, meta_file_name ) ),
                    material_combination_exam_templates ( exam_template_id, is_default ),
                    class_material_combinations ( class_id )
                `)
                .eq('material_folders.teacher_id', userId);
            if (comboRes.error) {
                console.warn('[FeatureClassMaterialCombinations] 讀取官方試卷配對失敗', comboRes.error);
                _suggestionCache = _suggestionCache || {};
                return _suggestionCache;
            }
            const data = comboRes.data;
            const applyByTplFolder = {};
            try {
                const applyRes = await window.supabaseClient
                    .from('material_sheets')
                    .select(`
                        sheet_stem,
                        meta_file_name,
                        extraction_template_id,
                        material_folders!inner ( folder_name, teacher_id )
                    `)
                    .eq('material_folders.teacher_id', userId)
                    .not('extraction_template_id', 'is', null);
                if (!applyRes.error) {
                    (applyRes.data || []).forEach(function (row) {
                        const folderName = String((row.material_folders && row.material_folders.folder_name) || '').trim().toUpperCase();
                        const tplId = String(row.extraction_template_id || '');
                        if (!folderName || !tplId) return;
                        const key = tplId + '|' + folderName;
                        if (!applyByTplFolder[key]) applyByTplFolder[key] = [];
                        applyByTplFolder[key].push(row);
                    });
                }
            } catch (_applyErr) {}
            const map = {};
            const assigned = {};
            const combosByClass = {};
            const metaFiles = {};
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
                const tplName = (combo.material_templates && combo.material_templates.name)
                    || templateNameById(combo.extraction_template_id)
                    || '';
                const publishedNames = [];
                function pushPublished(fileName) {
                    const published = String(fileName || '').trim();
                    if (!published) return;
                    if (publishedNames.indexOf(published) === -1) publishedNames.push(published);
                }
                sheets.forEach(function (cs) {
                    const sh = cs.material_sheets || {};
                    pushPublished(publishedMetaNameFromSheet(sh.sheet_stem, sh.meta_file_name, tplName));
                });
                const applyKey = String(combo.extraction_template_id || '') + '|'
                    + String(folderName || '').trim().toUpperCase();
                (applyByTplFolder[applyKey] || []).forEach(function (row) {
                    pushPublished(publishedMetaNameFromSheet(row.sheet_stem, row.meta_file_name, tplName));
                });
                keys.forEach(function (fKey) {
                    if (!map[fKey]) map[fKey] = {};
                    if (!metaFiles[fKey]) metaFiles[fKey] = [];
                    if (!publishedNames.length) {
                        addOfficialLinks(map[fKey], '*', links);
                        return;
                    }
                    publishedNames.forEach(function (fileName) {
                        addOfficialLinks(map[fKey], normalizePairStem(fileName), links);
                        if (!metaFiles[fKey].some(function (x) { return normalizePairStem(x) === normalizePairStem(fileName); })) {
                            metaFiles[fKey].push(fileName);
                        }
                    });
                });
                const comboRec = {
                    id: String(combo.id || ''),
                    label: comboDisplayLabel(combo.label, folderName, tplName),
                    rawLabel: String(combo.label || '').trim(),
                    folderName: folderName,
                    rootKind: rootKind,
                    extractionTemplateId: String(combo.extraction_template_id || ''),
                    extractionTemplateName: tplName,
                    sheetStems: publishedNames.map(function (n) {
                        return String(n || '').replace(/\.meta\.json$/i, '');
                    }),
                    metaFiles: publishedNames.slice(),
                    examTemplateId: String(chosen.exam_template_id)
                };
                (combo.class_material_combinations || []).forEach(function (a) {
                    if (!a.class_id || !comboRec.id) return;
                    const cid = String(a.class_id);
                    if (!combosByClass[cid]) combosByClass[cid] = [];
                    if (!combosByClass[cid].some(function (x) { return x.id === comboRec.id; })) {
                        combosByClass[cid].push(comboRec);
                    }
                });
            });
            _suggestionCache = map;
            _officialMetaFilesByFolderKey = metaFiles;
            _assignedFoldersByClass = assigned;
            _assignedCombosByClass = combosByClass;
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

    function listAssignedCombosForClass(classId) {
        ensureOfficialCacheLoading();
        return (_assignedCombosByClass[String(classId || '')] || []).slice();
    }

    function getAssignedComboById(classId, comboId) {
        const want = String(comboId || '').trim();
        if (!want) return null;
        return listAssignedCombosForClass(classId).find(function (c) {
            return String(c.id) === want;
        }) || null;
    }

    function findAssignedComboForSection(classId, hint) {
        hint = hint || {};
        const list = listAssignedCombosForClass(classId);
        const wantId = String(hint.combinationId || hint.combination_id || '').trim();
        if (wantId) {
            const byId = list.find(function (c) { return String(c.id) === wantId; });
            if (byId) return byId;
        }
        const rawFolder = String(hint.folderName || hint.material_folder || '').trim();
        const folder = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function'
            ? window.MaterialNameMap.resolveFolderName(rawFolder) : rawFolder).toUpperCase();
        if (!folder) return null;
        const matches = list.filter(function (c) {
            const name = String(c.folderName || '').trim();
            const resolved = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
                ? window.MaterialNameMap.resolveFolderName(name) : name;
            return String(resolved || '').toUpperCase() === folder;
        });
        const tplId = String(hint.examTemplateId || hint.layout_profile_id || '').trim();
        if (tplId) {
            const byTpl = matches.filter(function (c) {
                return String(c.examTemplateId || '') === tplId;
            });
            if (byTpl.length === 1) return byTpl[0];
            if (byTpl.length > 1) return byTpl[0];
        }
        if (matches.length === 1) return matches[0];
        return null;
    }

    function isFolderAssignedToClass(classId, folderName) {
        const want = String(folderName || '').trim().toUpperCase();
        if (!want) return false;
        return listAssignedFoldersForClass(classId).some(function (f) {
            return String(f.folderName || '').trim().toUpperCase() === want;
        });
    }

    let _materialZoneRowsCache = null;

    function invalidateSuggestionCache() {
        _suggestionCache = null;
        _officialMetaFilesByFolderKey = {};
        _assignedFoldersByClass = {};
        _assignedCombosByClass = {};
        _materialZoneRowsCache = null;
    }

    function isOfficialPairingCacheReady() { return _suggestionCache !== null; }

    function fetchOfficialPairings(force) { return fetchSuggestionMap(!!force); }

    /**
     * 這個教材資料夾裡、已有官方試卷搭配的全部 meta stem（一個資料夾可以有多份）。
     * 不含萬用 *。出題活頁下拉必須用這份，不能只靠 Drive 當下掃到的檔。
     */
    function listOfficialMetaStemsForFolder(rootKind, classId, folderName) {
        ensureOfficialCacheLoading();
        if (!folderName) return [];
        const keys = folderLookupKeys(rootKind, classId, folderName);
        const seen = {};
        const out = [];
        keys.forEach(function (k) {
            (_officialMetaFilesByFolderKey[k] || []).forEach(function (fileName) {
                const u = normalizePairStem(fileName);
                if (!u || seen[u]) return;
                seen[u] = true;
                out.push(fileName);
            });
        });
        return out;
    }

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

    /** 教材區設定用：已指派的可取消，未指派的可勾選 */
    function classEditorCheckboxesHtml(assignedClassIds) {
        const assigned = (assignedClassIds || []).map(String);
        const classes = allClasses();
        if (!classes.length) return '<div style="color:#94A3B8; font-size:0.78rem;">目前沒有任何班級</div>';
        return classes.map(function (c) {
            const checked = assigned.indexOf(String(c.id)) !== -1;
            return '<label style="display:inline-flex; align-items:center; gap:4px; margin:2px 10px 2px 0; font-size:0.78rem; color:#334155;">'
                + '<input type="checkbox" class="mz-class-cb" value="' + esc(c.id) + '"' + (checked ? ' checked' : '') + '>'
                + esc(c.name || c.id)
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
            + '<label style="font-size:0.76rem; font-weight:800; color:#475569; display:block; margin-bottom:6px;">套餐名稱（建議填，出題下拉會顯示這個名字）'
            + '<input type="text" class="form-control cmc-group-label" placeholder="例如「GEPT-2 整句翻譯」" style="width:260px; padding:5px; margin-top:2px; display:block;">'
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
        wrap.innerHTML = renderClassReviewDeskHtml(combos);
        bindClassReviewDesk(wrap);
    }

    function uniqueSortedNames(list) {
        const out = [];
        (list || []).forEach(function (n) {
            const s = String(n || '').trim();
            if (s && out.indexOf(s) === -1) out.push(s);
        });
        return out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    }

    var MZ_NO_SOURCE_KEY = '（無來源檔）';

    function normalizeSourceFileName(name) {
        return String(name || '').trim();
    }

    function sourceFileKey(name) {
        const s = normalizeSourceFileName(name);
        return s ? s.toUpperCase() : MZ_NO_SOURCE_KEY;
    }

    function defaultMaterialZoneLabel(sourceFile, folderName, templateName) {
        const src = normalizeSourceFileName(sourceFile).replace(/\.(xlsx|xls|csv)$/i, '');
        if (src) return src;
        return [String(folderName || '').trim(), String(templateName || '').trim()].filter(Boolean).join(' ')
            || '未命名教材';
    }

    function parseSourceLabels(raw) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const o = JSON.parse(raw);
                if (o && typeof o === 'object' && !Array.isArray(o)) return o;
            } catch (_e) {}
        }
        return {};
    }

    function sourceLabelFromMap(map, sourceFile) {
        const labels = parseSourceLabels(map);
        const want = normalizeSourceFileName(sourceFile) || MZ_NO_SOURCE_KEY;
        if (labels[want]) return String(labels[want]).trim();
        const u = want.toUpperCase();
        const keys = Object.keys(labels);
        for (let i = 0; i < keys.length; i++) {
            if (String(keys[i]).toUpperCase() === u) return String(labels[keys[i]] || '').trim();
        }
        return '';
    }

    function materialZoneRowKey(folderId, templateId, sourceFile) {
        return [String(folderId || ''), String(templateId || ''), sourceFileKey(sourceFile)].join('|');
    }

    function sheetMatchKey(name) {
        let s = String(name || '').trim().replace(/\.meta\.json$/i, '');
        if (!s) return '';
        const dot = s.indexOf('.');
        if (dot > 0) s = s.slice(0, dot);
        return s.toUpperCase();
    }

    /** 套餐已連上的活頁（含擷取範本欄位還沒對齊的那本，例如 GEPT-2 的 A）。 */
    function comboLinkedSheetFiles(combo) {
        const links = Array.isArray(combo && combo.material_combination_sheets) ? combo.material_combination_sheets : [];
        const out = [];
        const seen = {};
        links.forEach(function (cs) {
            const sh = cs.material_sheets || {};
            const id = sh.id || cs.material_sheet_id;
            const stem = String(sh.sheet_stem || '').trim();
            if (!id || !stem || seen[String(id)]) return;
            seen[String(id)] = true;
            out.push({
                id: id,
                stem: stem,
                meta: sh.meta_file_name || '',
                script: sh.script_file_name || ''
            });
        });
        return out;
    }

    let _catalogRowsCache = null;
    let _usageSummaryCache = null;

    async function loadCatalogRows(force) {
        if (!force && _catalogRowsCache) return _catalogRowsCache;
        const ids = allClasses().map(function (c) { return c && c.id; }).filter(Boolean);
        if (!ids.length || !window.supabaseClient) {
            _catalogRowsCache = [];
            return _catalogRowsCache;
        }
        const { data, error } = await window.supabaseClient
            .from('class_review_catalog')
            .select('class_id, folder_name, sheet_stem, page_min, page_max, available_count')
            .in('class_id', ids);
        if (error) {
            console.error('[FeatureClassMaterialCombinations] 讀統計表失敗', error);
            _catalogRowsCache = [];
            return _catalogRowsCache;
        }
        _catalogRowsCache = data || [];
        return _catalogRowsCache;
    }

    function invalidateDisplayCaches() {
        _usageSummaryCache = null;
        _catalogRowsCache = null;
        _materialZoneRowsCache = null;
    }

    /**
     * 顯示用 meta：只取統計表 class_review_catalog 裡、且屬於這個套餐的活頁。
     * 套餐有連但還沒進統計表的（例如 A）這裡不列，等更新目錄後才出現。
     */
    function statsMetaFilesForCombo(combo, catalogRows) {
        const folderU = String((combo && combo.material_folders && combo.material_folders.folder_name) || '').trim().toUpperCase();
        if (!folderU) return [];
        const classIds = {};
        (combo.class_material_combinations || []).forEach(function (a) {
            if (a && a.class_id) classIds[String(a.class_id)] = true;
        });
        const comboByKey = {};
        comboLinkedSheetFiles(combo).forEach(function (f) {
            const k = sheetMatchKey(f.stem);
            if (k) comboByKey[k] = f;
        });
        const seen = {};
        const out = [];
        (catalogRows || []).forEach(function (row) {
            if (!classIds[String(row.class_id)]) return;
            if (String(row.folder_name || '').trim().toUpperCase() !== folderU) return;
            const stem = String(row.sheet_stem || '').trim();
            const k = sheetMatchKey(stem);
            if (!k || !comboByKey[k] || seen[k]) return;
            seen[k] = true;
            const file = comboByKey[k];
            const meta = file.meta || (String(file.stem || stem).replace(/\.meta\.json$/i, '') + '.meta.json');
            out.push({
                stem: file.stem || stem,
                meta: /\.meta\.json$/i.test(meta) ? meta : (meta + '.meta.json'),
                script: file.script || ''
            });
        });
        out.sort(function (a, b) {
            return String(a.stem || '').localeCompare(String(b.stem || ''), 'zh-Hant');
        });
        return out;
    }

    async function listOverwriteTargets(folderName, templateId) {
        const userId = await getCurrentUserId();
        if (!userId || !folderName) return [];
        const combos = await loadCombinations(userId);
        const folderU = String(folderName || '').trim().toUpperCase();
        const out = [];
        const seen = {};
        function addFrom(combo) {
            comboLinkedSheetFiles(combo).forEach(function (f) {
                const k = sheetMatchKey(f.stem) || String(f.id || '');
                if (!k || seen[k]) return;
                seen[k] = true;
                const meta = f.meta || (String(f.stem || '').replace(/\.meta\.json$/i, '') + '.meta.json');
                out.push({
                    id: f.id,
                    stem: f.stem,
                    meta: /\.meta\.json$/i.test(meta) ? meta : (meta + '.meta.json'),
                    script: f.script || String(f.stem || '').replace(/\.meta\.json$/i, '') + '.script.txt'
                });
            });
        }
        (combos || []).forEach(function (c) {
            const fn = (c.material_folders && c.material_folders.folder_name) || '';
            if (String(fn).trim().toUpperCase() !== folderU) return;
            if (templateId && String(c.extraction_template_id) !== String(templateId)) return;
            addFrom(c);
        });
        (combos || []).forEach(function (c) {
            const fn = (c.material_folders && c.material_folders.folder_name) || '';
            if (String(fn).trim().toUpperCase() !== folderU) return;
            addFrom(c);
        });
        return out;
    }

    /**
     * 改活頁清單補上套餐已連、但擷取範本欄還沒對齊的活頁。
     * 「幾個 meta」仍只看統計表，不拿這裡的數量去顯示。
     */
    function mergeLinkedComboSheetsIntoZoneRows(rows, comboByFolderTpl) {
        const byCombo = {};
        (rows || []).forEach(function (row) {
            const ck = String(row.folderId || '') + '|' + String(row.templateId || '');
            if (!byCombo[ck]) byCombo[ck] = [];
            byCombo[ck].push(row);
        });
        Object.keys(byCombo).forEach(function (ck) {
            const combo = comboByFolderTpl[ck];
            if (!combo) return;
            const group = byCombo[ck];
            const seenIds = {};
            group.forEach(function (row) {
                (row.sheetDbIds || []).forEach(function (id) { seenIds[String(id)] = true; });
            });
            const missing = comboLinkedSheetFiles(combo).filter(function (f) {
                return !seenIds[String(f.id)];
            });
            if (!missing.length) return;
            const target = group.length === 1
                ? group[0]
                : (group.find(function (r) { return !r.sourceFile; }) || group[0]);
            missing.forEach(function (f) {
                target.sheetStems.push(f.stem);
                if (target.sheetDbIds.indexOf(f.id) === -1) {
                    target.sheetDbIds.push(f.id);
                    target.sheetFiles.push(f);
                }
            });
        });
    }

    function buildMaterialZoneRows(_groups, combos, applyRows) {
        const comboByFolderTpl = {};
        (combos || []).forEach(function (c) {
            comboByFolderTpl[String(c.material_folder_id) + '|' + String(c.extraction_template_id)] = c;
        });
        const byKey = {};
        const order = [];
        (applyRows || []).forEach(function (r) {
            const folder = r.material_folders || {};
            const folderId = folder.id || '';
            const templateId = r.extraction_template_id || '';
            const sourceFile = normalizeSourceFileName(r.source_file_name);
            const key = materialZoneRowKey(folderId, templateId, sourceFile);
            if (!byKey[key]) {
                const combo = comboByFolderTpl[String(folderId) + '|' + String(templateId)] || null;
                const assigns = combo ? (combo.class_material_combinations || []) : [];
                const assignmentByClassId = {};
                assigns.forEach(function (a) {
                    if (a && a.class_id && a.id) assignmentByClassId[String(a.class_id)] = a.id;
                });
                byKey[key] = {
                    key: key,
                    comboId: combo ? combo.id : '',
                    comboLabel: combo ? String(combo.label || '').trim() : '',
                    folderId: folderId,
                    templateId: templateId,
                    folderName: folder.folder_name || '',
                    rootKind: folder.root_kind === 'class' ? 'class' : 'teacher',
                    classId: folder.class_id || '',
                    templateName: (r.material_templates && r.material_templates.name) || templateNameById(templateId),
                    sourceFile: sourceFile,
                    sourceKey: sourceFile || MZ_NO_SOURCE_KEY,
                    label: sourceLabelFromMap(combo && combo.source_labels, sourceFile),
                    sheetStems: [],
                    sheetDbIds: [],
                    sheetFiles: [],
                    examTemplateIds: combo
                        ? (combo.material_combination_exam_templates || []).map(function (l) {
                            return l && l.exam_template_id ? String(l.exam_template_id) : '';
                        }).filter(Boolean)
                        : [],
                    classIds: assigns.map(function (a) { return a && a.class_id ? String(a.class_id) : ''; }).filter(Boolean),
                    assignmentByClassId: assignmentByClassId,
                    classNames: uniqueSortedNames(assigns.map(function (a) {
                        return classNameById(a.class_id);
                    }))
                };
                order.push(key);
            }
            const row = byKey[key];
            if (sourceFile && !row.sourceFile) row.sourceFile = sourceFile;
            if (r.sheet_stem) row.sheetStems.push(r.sheet_stem);
            if (r.id && row.sheetDbIds.indexOf(r.id) === -1) {
                row.sheetDbIds.push(r.id);
                row.sheetFiles.push({
                    id: r.id,
                    stem: r.sheet_stem || '',
                    meta: r.meta_file_name || '',
                    script: r.script_file_name || ''
                });
            }
        });
        const rows = order.map(function (k) { return byKey[k]; });
        mergeLinkedComboSheetsIntoZoneRows(rows, comboByFolderTpl);
        return rows.map(function (row) {
            row.sheetStems = collapseRelatedSheetStems(row.sheetStems);
            row.sheetFiles.sort(function (a, b) {
                return String(a.stem || '').localeCompare(String(b.stem || ''), 'zh-Hant');
            });
            const combo = comboByFolderTpl[String(row.folderId || '') + '|' + String(row.templateId || '')] || null;
            const stats = combo ? statsMetaFilesForCombo(combo, _catalogRowsCache || []) : [];
            row.statsMetaFiles = stats.map(function (f) { return f.meta; });
            row.metaCount = stats.length;
            row.defaultLabel = defaultMaterialZoneLabel(row.sourceFile, row.folderName, row.templateName);
            return row;
        }).sort(function (a, b) {
            const fa = String(a.folderName || '').localeCompare(String(b.folderName || ''), 'zh-Hant');
            if (fa) return fa;
            const la = a.label || a.defaultLabel;
            const lb = b.label || b.defaultLabel;
            return String(la).localeCompare(String(lb), 'zh-Hant');
        });
    }

    async function teacherDriveFolderNames() {
        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            try { await window.FeatureTimeline.ensureMetaCatalog('', 'teacher', { force: false }); } catch (_e) {}
        }
        if (window.FeatureExamJob && typeof window.FeatureExamJob.getUniqueFolderNames === 'function') {
            return window.FeatureExamJob.getUniqueFolderNames('', 'teacher') || [];
        }
        return [];
    }

    /** Drive 有、教材區還沒套用的資料夾仍要列出，不能因為沒套用就消失。 */
    function appendUnusedDriveFolderRows(rows, driveFolders) {
        const list = rows || [];
        const have = {};
        list.forEach(function (r) {
            const u = String(r.folderName || '').trim().toUpperCase();
            if (u) have[u] = true;
        });
        (driveFolders || []).forEach(function (name) {
            const n = String(name || '').trim();
            const u = n.toUpperCase();
            if (!n || have[u]) return;
            have[u] = true;
            list.push({
                key: 'unused|' + u,
                unused: true,
                comboId: '',
                comboLabel: '',
                folderId: '',
                templateId: '',
                folderName: n,
                templateName: '',
                sourceFile: '',
                sourceKey: MZ_NO_SOURCE_KEY,
                label: '',
                sheetStems: [],
                sheetDbIds: [],
                sheetFiles: [],
                examTemplateIds: [],
                classIds: [],
                assignmentByClassId: {},
                classNames: [],
                statsMetaFiles: [],
                metaCount: 0,
                defaultLabel: n
            });
        });
        list.sort(function (a, b) {
            const fa = String(a.folderName || '').localeCompare(String(b.folderName || ''), 'zh-Hant');
            if (fa) return fa;
            if (!!a.unused !== !!b.unused) return a.unused ? 1 : -1;
            const la = a.label || a.defaultLabel;
            const lb = b.label || b.defaultLabel;
            return String(la).localeCompare(String(lb), 'zh-Hant');
        });
        return list;
    }

    async function listMaterialZoneRows() {
        const userId = await getCurrentUserId();
        if (!userId) return [];
        if (_materialZoneRowsCache) return _materialZoneRowsCache;
        const [groups, combos, applyRows, _catalog, driveFolders] = await Promise.all([
            loadGroups(userId),
            loadCombinations(userId),
            loadExtractionApplyRecords(userId),
            loadCatalogRows(false),
            teacherDriveFolderNames()
        ]);
        _materialZoneRowsCache = appendUnusedDriveFolderRows(
            buildMaterialZoneRows(groups, combos, applyRows),
            driveFolders
        );
        return _materialZoneRowsCache;
    }

    async function updateMaterialZoneLabel(row, label) {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error('尚未登入');
        if (!row || !row.folderId || !row.templateId) throw new Error('找不到這本教材，無法改名');
        const name = String(label || '').trim();
        let comboId = row.comboId;
        if (!comboId) {
            comboId = await ensureCombination(userId, {
                material_folder_id: row.folderId,
                extraction_template_id: row.templateId,
                sheet_db_ids: row.sheetDbIds || []
            }, name || null);
        }
        const { error } = await window.supabaseClient
            .from('material_combinations')
            .update({
                label: name || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', comboId);
        if (error) throw error;
        row.comboId = comboId;
        row.comboLabel = name || '';
        row.label = name || '';
        invalidateDisplayCaches();
        invalidateSuggestionCache();
        return comboId;
    }

    async function updateMaterialZoneSourceFile(row, sourceFile) {
        const next = normalizeSourceFileName(sourceFile);
        const prev = normalizeSourceFileName(row && row.sourceFile);
        const ids = (row && row.sheetDbIds) || [];
        if (!ids.length) return;
        const { error } = await window.supabaseClient
            .from('material_sheets')
            .update({
                source_file_name: next || null,
                updated_at: new Date().toISOString()
            })
            .in('id', ids);
        if (error) throw error;
        if (prev && next && prev !== next
            && row.folderId
            && window.MaterialNameMap && typeof window.MaterialNameMap.recordAlias === 'function') {
            await window.MaterialNameMap.recordAlias({
                kind: 'source_file',
                alias: prev,
                currentLabel: next,
                materialFolderId: row.folderId
            });
        }
        row.sourceFile = next;
        row.sourceKey = next || MZ_NO_SOURCE_KEY;
    }

    async function syncMaterialZoneClassAssignments(comboId, row, wantedClassIds, userId) {
        const wanted = {};
        (wantedClassIds || []).forEach(function (id) {
            const s = String(id || '').trim();
            if (s) wanted[s] = true;
        });
        const current = row.assignmentByClassId || {};
        const toRemove = Object.keys(current).filter(function (cid) { return !wanted[cid]; });
        const toAdd = Object.keys(wanted).filter(function (cid) { return !current[cid]; });
        for (let i = 0; i < toRemove.length; i++) {
            await removeAssignment(current[toRemove[i]]);
        }
        if (toAdd.length) await assignToClasses(comboId, toAdd, userId);
    }

    async function saveMaterialZoneCard(row, cardEl) {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error('尚未登入');
        if (!row || !row.folderId || !row.templateId) throw new Error('找不到這本教材');
        const nameEl = cardEl.querySelector('.mz-label');
        const typed = String(nameEl && nameEl.value || '').trim();
        const examIds = Array.prototype.map.call(cardEl.querySelectorAll('.mz-exam-tpl-cb:checked'), function (cb) {
            return cb.value;
        }).filter(Boolean);
        const classIds = Array.prototype.map.call(cardEl.querySelectorAll('.mz-class-cb:checked'), function (cb) {
            return cb.value;
        }).filter(Boolean);
        if (!examIds.length) {
            throw new Error('請至少勾選一個試卷範本。沒有官方配對就不能出考卷。');
        }
        const comboId = await updateMaterialZoneLabel(row, typed);
        const sourceEl = cardEl.querySelector('.mz-source-file');
        await updateMaterialZoneSourceFile(row, sourceEl && sourceEl.value);
        await setComboExamTemplates(comboId, examIds);
        await syncMaterialZoneClassAssignments(comboId, row, classIds, userId);
        invalidateSuggestionCache();
    }

    function renderMaterialZoneCardHtml(row) {
        if (row && row.unused) {
            return (
                '<div class="mz-card mz-unused" data-key="' + esc(row.key) + '" style="border:1px dashed #CBD5E1; border-radius:10px; padding:14px; margin-bottom:10px; background:#F8FAFC;">'
                + '<div style="font-size:1rem; font-weight:900; color:#64748B;">📁 ' + esc(row.folderName || '') + '</div>'
                + '<div style="font-size:0.8rem; color:#64748B; font-weight:700; margin-top:6px; line-height:1.7;">'
                + '<div>教材　資料夾　' + esc(row.folderName || '') + '（雲端有這個資料夾）</div>'
                + '<div>教材　檔案　尚未套用擷取範本</div>'
                + '</div>'
                + '<div style="margin-top:8px; font-size:0.76rem; color:#94A3B8; font-weight:700;">還沒被套用，所以沒有套餐名稱／試卷配對／採用班級。要使用請到上面「套用目前的範本」選這個資料夾。</div>'
                + '</div>'
            );
        }
        const displayName = row.comboLabel || row.label || row.defaultLabel;
        const metaText = !(row.classIds && row.classIds.length)
            ? '統計表尚無（尚未指派班級）'
            : (row.metaCount ? (row.metaCount + ' 個 meta') : '統計表尚無');
        const folderLine = (row.folderName || '（未知名資料夾）')
            + '（擷取範本 ' + (row.templateName || '尚未套用') + '）';
        const examHtml = examTemplateCheckboxesHtml('mz', row.examTemplateIds || []);
        const classHtml = classEditorCheckboxesHtml(row.classIds || []);
        return (
            '<div class="mz-card" data-key="' + esc(row.key) + '" style="border:1px solid #99F6E4; border-radius:10px; padding:14px; margin-bottom:10px; background:#F0FDFA;">'
            + '<label style="display:block; font-size:0.72rem; font-weight:800; color:#0F766E; margin-bottom:2px;">套餐名稱（出作業下拉會顯示這個）</label>'
            + '<input type="text" class="mz-label" data-key="' + esc(row.key) + '" value="' + esc(displayName) + '" placeholder="例如 GEPT-2 整句翻譯" title="套餐名稱" style="font-size:1rem; font-weight:900; color:#134E4A; border:1px solid #99F6E4; background:white; width:100%; max-width:100%; box-sizing:border-box; padding:6px 8px; border-radius:6px;">'
            + '<div style="font-size:0.8rem; color:#0F766E; font-weight:700; line-height:1.75; margin-top:8px;">'
            + '<label style="display:block; font-size:0.72rem; font-weight:800; color:#0F766E; margin-bottom:2px;">來源　檔案（Excel 檔名，可手填）</label>'
            + '<input type="text" class="mz-source-file" value="' + esc(row.sourceFile || '') + '" placeholder="例如 10_GEPT-2.xlsx" title="來源 Excel 檔名" style="font-size:0.82rem; font-weight:700; color:#134E4A; border:1px solid #99F6E4; background:white; width:100%; max-width:100%; box-sizing:border-box; padding:5px 8px; border-radius:6px; margin-bottom:6px;">'
            + '<div>教材　資料夾　' + esc(folderLine) + '</div>'
            + '<div>教材　檔案　' + esc(metaText) + '</div>'
            + '</div>'
            + '<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #99F6E4;">'
            + '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">'
            + '<div style="font-size:0.76rem; font-weight:800; color:#6D28D9;">試卷範本（至少勾一個，這是官方配對）</div>'
            + '<button type="button" class="mz-new-exam-tpl btn" style="padding:2px 8px; font-size:0.72rem; background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; border-radius:5px; cursor:pointer;">🧾 新增試卷範本</button>'
            + '</div>'
            + '<div class="mz-exam-box">' + examHtml + '</div>'
            + '</div>'
            + '<div style="margin-top:10px;">'
            + '<div style="font-size:0.76rem; font-weight:800; color:#15803D; margin-bottom:4px;">採用班級</div>'
            + '<div class="mz-class-box">' + classHtml + '</div>'
            + '</div>'
            + '<div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<button type="button" class="mz-save btn btn-primary" data-key="' + esc(row.key) + '" style="padding:6px 14px; border-radius:6px; font-weight:800; font-size:0.82rem; cursor:pointer;">儲存設定</button>'
            + '<button type="button" class="mz-rename-files btn" data-key="' + esc(row.key) + '" style="padding:6px 10px; border-radius:6px; border:1px solid #5EEAD4; background:#CCFBF1; color:#115E59; font-weight:800; font-size:0.78rem; cursor:pointer;">改活頁／檔名</button>'
            + '<span class="mz-msg" style="font-size:0.76rem; font-weight:700;"></span>'
            + '</div>'
            + '</div>'
        );
    }

    function bindMaterialZoneRename(wrap, rows) {
        wrap.querySelectorAll('.mz-label').forEach(function (input) {
            input.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    const card = input.closest('.mz-card');
                    const saveBtn = card && card.querySelector('.mz-save');
                    if (saveBtn) saveBtn.click();
                }
            });
        });
        wrap.querySelectorAll('.mz-save').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const card = btn.closest('.mz-card');
                const key = btn.getAttribute('data-key');
                const row = (rows || []).find(function (r) { return r.key === key; });
                const msgEl = card && card.querySelector('.mz-msg');
                if (!row || !card) return;
                btn.disabled = true;
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
                try {
                    await saveMaterialZoneCard(row, card);
                    window.showFlash && window.showFlash('✅ 已儲存教材設定', 'success');
                    render();
                } catch (err) {
                    console.error('[FeatureClassMaterialCombinations] 教材區儲存失敗', err);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ ' + (err.message || err); }
                    window.showFlash && window.showFlash('❌ 儲存失敗：' + (err.message || err), 'error');
                    btn.disabled = false;
                }
            });
        });
        wrap.querySelectorAll('.mz-rename-files').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const key = btn.getAttribute('data-key');
                const row = (rows || []).find(function (r) { return r.key === key; });
                if (row) openMaterialZoneFileRename(row);
            });
        });
        wrap.querySelectorAll('.mz-new-exam-tpl').forEach(function (btn) {
            btn.addEventListener('click', openNewExamTemplateShortcut);
        });
    }

    function sheetKeyFromStem(stem) {
        const s = String(stem || '').trim();
        if (!s) return '';
        return s.split('.')[0] || s;
    }

    function inferSheetFormula(sample, sheetKey) {
        const raw = String(sample || '').trim();
        const lead = String(sheetKey || '').trim();
        if (!raw) return '';
        if (!lead) return raw;
        if (raw.length >= lead.length && raw.slice(0, lead.length).toUpperCase() === lead.toUpperCase()) {
            return '{活頁}' + raw.slice(lead.length);
        }
        return raw;
    }

    function applyFileNameFormula(pattern, sheetKey, stem) {
        const key = sheetKey || '';
        return String(pattern || '')
            .replace(/\{活頁\}/g, key)
            .replace(/\{sheet\}/gi, key)
            .replace(/\{letter\}/gi, key)
            .replace(/\{stem\}/gi, stem || '');
    }

    function openMaterialZoneFileRename(row) {
        if (!window.ModalOverlay) {
            window.showFlash && window.showFlash('❌ 無法開啟改名視窗', 'error');
            return;
        }
        const files = (row.sheetFiles || []).slice();
        if (!files.length) {
            window.showFlash && window.showFlash('這本教材還沒有活頁紀錄，無法改檔名', 'error');
            return;
        }
        const first = files[0] || {};
        const key0 = sheetKeyFromStem(first.stem);
        const stemFormula0 = '{活頁}';
        const metaFormula0 = inferSheetFormula(first.meta, key0);
        const scriptFormula0 = inferSheetFormula(first.script, key0);
        const modalId = 'mz-rename-files-modal';
        const rowsHtml = files.map(function (f, idx) {
            const sheetKey = sheetKeyFromStem(f.stem);
            return (
                '<div data-sheet-id="' + esc(f.id) + '" data-sheet-key="' + esc(sheetKey) + '" style="display:grid; grid-template-columns:72px 1fr 1.4fr 1.4fr; gap:6px; align-items:center; margin-bottom:6px;">'
                + '<div style="font-size:0.78rem; font-weight:800; color:#0F766E;">' + esc(sheetKey || String(idx + 1)) + '</div>'
                + '<input class="mz-rf-stem" value="' + esc(f.stem) + '" title="活頁名" style="width:100%; padding:5px 6px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box; font-size:0.78rem;">'
                + '<input class="mz-rf-meta" value="' + esc(f.meta) + '" title="meta 檔名" style="width:100%; padding:5px 6px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box; font-size:0.78rem;">'
                + '<input class="mz-rf-script" value="' + esc(f.script) + '" title="文稿檔名" style="width:100%; padding:5px 6px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box; font-size:0.78rem;">'
                + '</div>'
            );
        }).join('');
        window.ModalOverlay.open({
            id: modalId,
            tier: 'B',
            unsavedMessage: '活頁／檔名已改但尚未儲存，確定要關閉嗎？',
            isDirty: function () {
                const el = document.getElementById(modalId);
                if (!el || el.getAttribute('data-mo-busy') === '1') return false;
                const blocks = el.querySelectorAll('[data-sheet-id]');
                for (let i = 0; i < blocks.length; i++) {
                    const f = files[i];
                    if (!f) continue;
                    const stem = (blocks[i].querySelector('.mz-rf-stem') || {}).value || '';
                    const meta = (blocks[i].querySelector('.mz-rf-meta') || {}).value || '';
                    const script = (blocks[i].querySelector('.mz-rf-script') || {}).value || '';
                    if (String(stem).trim() !== String(f.stem || '').trim()
                        || String(meta).trim() !== String(f.meta || '').trim()
                        || String(script).trim() !== String(f.script || '').trim()) return true;
                }
                return false;
            },
            contentHtml: (
                '<div style="background:white; border-radius:14px; width:min(720px,96vw); max-height:90vh; overflow:auto; padding:20px; box-shadow:0 12px 40px rgba(15,23,42,0.18);">'
                + '<h3 style="margin:0 0 6px 0; color:#0F766E;">改活頁／檔名</h3>'
                + '<p style="margin:0 0 10px 0; color:#64748B; font-size:0.8rem; line-height:1.6;">只在這裡改一次。公式用 <code>{活頁}</code> 帶入這一本的活頁名（A、vBK-2 都可以），不必加範本後綴。儲存會同時改系統現用名與雲端檔名；舊名會記住。</p>'
                + '<div style="background:#F0FDFA; border:1px dashed #99F6E4; border-radius:8px; padding:10px; margin-bottom:12px;">'
                + '<div style="font-size:0.76rem; font-weight:800; color:#0F766E; margin-bottom:6px;">公式（改一處，套用到全部活頁）</div>'
                + '<label style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:4px;">活頁名'
                + '<input class="mz-rf-formula-stem" value="' + esc(stemFormula0) + '" style="display:block; width:100%; margin-top:2px; padding:6px 8px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box;"></label>'
                + '<label style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:4px;">meta 檔名'
                + '<input class="mz-rf-formula-meta" value="' + esc(metaFormula0) + '" style="display:block; width:100%; margin-top:2px; padding:6px 8px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box;"></label>'
                + '<label style="display:block; font-size:0.74rem; color:#334155; font-weight:700; margin-bottom:6px;">文稿檔名'
                + '<input class="mz-rf-formula-script" value="' + esc(scriptFormula0) + '" style="display:block; width:100%; margin-top:2px; padding:6px 8px; border:1px solid #99F6E4; border-radius:6px; box-sizing:border-box;"></label>'
                + '<button type="button" class="mz-rf-apply-formula btn" style="padding:5px 10px; border-radius:6px; border:1px solid #5EEAD4; background:#CCFBF1; color:#115E59; font-weight:800; font-size:0.78rem; cursor:pointer;">套用公式到全部</button>'
                + '</div>'
                + '<div style="display:grid; grid-template-columns:72px 1fr 1.4fr 1.4fr; gap:6px; font-size:0.72rem; font-weight:800; color:#0F766E; margin-bottom:4px;">'
                + '<div>活頁</div><div>現用名</div><div>meta</div><div>文稿</div></div>'
                + rowsHtml
                + '<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">'
                + '<button type="button" class="mz-rf-cancel" style="padding:6px 12px; border-radius:8px; border:1px solid #CBD5E1; background:white; font-weight:800; cursor:pointer;">取消</button>'
                + '<button type="button" class="mz-rf-save" style="padding:6px 12px; border-radius:8px; border:0; background:#0F766E; color:white; font-weight:800; cursor:pointer;">儲存（系統＋雲端）</button>'
                + '</div>'
                + '</div>'
            ),
            onMount: function (el) {
                const cancelBtn = el.querySelector('.mz-rf-cancel');
                const saveBtn = el.querySelector('.mz-rf-save');
                const applyBtn = el.querySelector('.mz-rf-apply-formula');
                function applyFormulaToRows() {
                    const stemPat = String((el.querySelector('.mz-rf-formula-stem') || {}).value || '').trim();
                    const metaPat = String((el.querySelector('.mz-rf-formula-meta') || {}).value || '').trim();
                    const scriptPat = String((el.querySelector('.mz-rf-formula-script') || {}).value || '').trim();
                    const blocks = el.querySelectorAll('[data-sheet-id]');
                    blocks.forEach(function (block, i) {
                        const f = files[i] || {};
                        const sheetKey = block.getAttribute('data-sheet-key') || sheetKeyFromStem(f.stem);
                        if (stemPat) block.querySelector('.mz-rf-stem').value = applyFileNameFormula(stemPat, sheetKey, f.stem);
                        if (metaPat) block.querySelector('.mz-rf-meta').value = applyFileNameFormula(metaPat, sheetKey, f.stem);
                        if (scriptPat) block.querySelector('.mz-rf-script').value = applyFileNameFormula(scriptPat, sheetKey, f.stem);
                    });
                }
                if (applyBtn) applyBtn.addEventListener('click', applyFormulaToRows);
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function () {
                        window.ModalOverlay.requestClose(modalId);
                    });
                }
                if (saveBtn) {
                    saveBtn.addEventListener('click', async function () {
                        if (!window.MaterialNameMap || typeof window.MaterialNameMap.applySheetCurrentNames !== 'function') {
                            window.showFlash && window.showFlash('❌ 對照中心尚未載入', 'error');
                            return;
                        }
                        const blocks = el.querySelectorAll('[data-sheet-id]');
                        saveBtn.disabled = true;
                        if (window.ModalOverlay && typeof window.ModalOverlay.setBusy === 'function') {
                            window.ModalOverlay.setBusy(modalId, true);
                        }
                        try {
                            const driveItems = [];
                            for (let i = 0; i < blocks.length; i++) {
                                const f = files[i];
                                if (!f) continue;
                                const stem = String((blocks[i].querySelector('.mz-rf-stem') || {}).value || '').trim();
                                const meta = String((blocks[i].querySelector('.mz-rf-meta') || {}).value || '').trim();
                                const script = String((blocks[i].querySelector('.mz-rf-script') || {}).value || '').trim();
                                if (stem === String(f.stem || '').trim()
                                    && meta === String(f.meta || '').trim()
                                    && script === String(f.script || '').trim()) continue;
                                await window.MaterialNameMap.applySheetCurrentNames({
                                    folderId: row.folderId,
                                    sheetId: f.id,
                                    sheetStem: stem,
                                    metaFileName: meta,
                                    scriptFileName: script
                                });
                                if (f.meta && meta && f.meta !== meta) driveItems.push({ oldName: f.meta, newName: meta });
                                if (f.script && script && f.script !== script) driveItems.push({ oldName: f.script, newName: script });
                                f.stem = stem;
                                f.meta = meta;
                                f.script = script;
                            }
                            let driveNote = '';
                            if (driveItems.length
                                && window.GasService && typeof window.GasService.renameMaterialFiles === 'function'
                                && window.FeatureTimeline && typeof window.FeatureTimeline.resolveMaterialsRootFolderId === 'function') {
                                try {
                                    const rootId = await window.FeatureTimeline.resolveMaterialsRootFolderId(
                                        row.classId || '',
                                        row.rootKind || 'teacher'
                                    );
                                    const driveResult = await window.GasService.renameMaterialFiles(
                                        rootId,
                                        row.folderName,
                                        driveItems,
                                        row.rootKind || 'teacher'
                                    );
                                    const missing = (driveResult && driveResult.missing) || [];
                                    const errs = (driveResult && driveResult.errors) || [];
                                    if (missing.length || errs.length) {
                                        driveNote = '雲端有 ' + (missing.length + errs.length) + ' 個檔沒改到（系統已記住新名，讀檔仍可靠舊名）。';
                                    } else {
                                        driveNote = '雲端檔名已一併改好。';
                                    }
                                    if (typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                                        await window.FeatureTimeline.ensureMetaCatalog(row.classId || '', row.rootKind || 'teacher', { force: true });
                                    }
                                } catch (driveErr) {
                                    driveNote = '系統已改名；雲端改檔失敗（可能還沒重新部署 GAS）：' + ((driveErr && driveErr.message) || driveErr);
                                }
                            }
                            _materialZoneRowsCache = null;
                            window.showFlash && window.showFlash('✅ 已更新活頁／檔名。' + (driveNote ? ' ' + driveNote : ' 舊名仍對得上。'), 'success');
                            window.ModalOverlay.close(modalId);
                            render();
                        } catch (err) {
                            console.error('[FeatureClassMaterialCombinations] 活頁改名失敗', err);
                            window.showFlash && window.showFlash('❌ 改名失敗：' + (err.message || err), 'error');
                            if (window.ModalOverlay && typeof window.ModalOverlay.setBusy === 'function') {
                                window.ModalOverlay.setBusy(modalId, false);
                            }
                        } finally {
                            saveBtn.disabled = false;
                        }
                    });
                }
            }
        });
    }

    function paintMaterialZone(wrap, rows) {
        const list = rows && rows.length
            ? rows.map(renderMaterialZoneCardHtml).join('')
            : '<div style="color:#94A3B8; font-size:0.8rem; padding:8px 0;">目前還沒有教材實例。請先到上面「套用／設計範本」把擷取範本套到教材資料夾。</div>';
        wrap.innerHTML = (
            '<div style="background:white; padding:20px; border-radius:12px; border:2px solid #99F6E4; margin-bottom:16px;">'
            + '<h3 style="margin:0 0 4px 0; color:#0F766E;">📁 教材區</h3>'
            + '<p style="color:#64748B; font-size:0.8rem; margin:0 0 12px 0;">套餐只在這裡編輯並存進資料庫：名稱、試卷範本、採用班級。來源檔與資料夾是套用紀錄，不能在這裡改。文稿以這裡為收集基準；班級是採用者，不是文稿主檔。</p>'
            + list
            + '</div>'
        );
        bindMaterialZoneRename(wrap, rows || []);
    }

    function renderMaterialZone() {
        const wrap = document.getElementById('material-zone-container');
        if (!wrap) return;
        wrap.innerHTML = '<div style="padding:20px; text-align:center; color:#0F766E; font-weight:800;">⏳ 載入教材區…</div>';
        listMaterialZoneRows().then(function (rows) {
            paintMaterialZone(wrap, rows);
        }).catch(function (err) {
            console.error('[FeatureClassMaterialCombinations] 教材區載入失敗', err);
            wrap.innerHTML = '<div style="padding:16px; color:#EF4444; font-weight:800;">❌ 教材區載入失敗：' + esc(err.message || err) + '</div>';
        });
    }

    function render() {
        const wrap = document.getElementById('class-material-combinations-container');
        const mzWrap = document.getElementById('material-zone-container');
        if (!wrap && !mzWrap) return;
        if (wrap) wrap.innerHTML = '<div style="padding:20px; text-align:center; color:var(--primary); font-weight:800;">⏳ 載入班級教材組合…</div>';
        if (mzWrap) mzWrap.innerHTML = '<div style="padding:20px; text-align:center; color:#0F766E; font-weight:800;">⏳ 載入教材區…</div>';
        (async function () {
            const userId = await getCurrentUserId();
            if (!userId) {
                if (wrap) wrap.innerHTML = '';
                if (mzWrap) mzWrap.innerHTML = '';
                return;
            }
            const examTemplatesPromise = (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.fetchTemplates === 'function')
                ? window.FeatureTemplateLibrary.fetchTemplates(false)
                : Promise.resolve([]);
            const [groups, combos, applyRows, _examTpl, _catalog, driveFolders] = await Promise.all([
                loadGroups(userId),
                loadCombinations(userId),
                loadExtractionApplyRecords(userId),
                examTemplatesPromise,
                loadCatalogRows(false),
                teacherDriveFolderNames()
            ]);
            _materialZoneRowsCache = appendUnusedDriveFolderRows(
                buildMaterialZoneRows(groups, combos, applyRows),
                driveFolders
            );
            if (mzWrap) paintMaterialZone(mzWrap, _materialZoneRowsCache);
            if (wrap) paint(wrap, groups, combos);
        })().catch(function (err) {
            console.error('[FeatureClassMaterialCombinations] 載入失敗', err);
            const msg = '<div style="padding:16px; color:#EF4444; font-weight:800;">❌ 載入失敗：' + esc(err.message || err) + '</div>';
            if (wrap) wrap.innerHTML = msg;
            if (mzWrap) mzWrap.innerHTML = msg;
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
     * 套用 Excel／Drive 後只確保套餐列存在（活頁連結）。
     * 套餐名稱、試卷範本、採用班級只在教材區編輯，這裡不准另寫一筆。
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
        await ensureCombination(userId, group, null);
        invalidateSuggestionCache();
        invalidateDisplayCaches();
    }

    /**
     * 每個範本目前真正套到哪些教材資料夾、指派給哪些班級、有沒有當試卷搭配。
     * 擷取側「幾個 meta」只讀統計表 class_review_catalog，不再數套用列或 Drive 清單。
     */
    async function summarizeUsageByTemplate() {
        const userId = await getCurrentUserId();
        if (!userId) {
            _usageSummaryCache = {};
            return _usageSummaryCache;
        }
        const [combos, catalogRows] = await Promise.all([
            loadCombinations(userId),
            loadCatalogRows(false)
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
        (combos || []).forEach(function (c) {
            const rec = ensure(c.extraction_template_id);
            const folderName = c.material_folders && c.material_folders.folder_name;
            const assigns = c.class_material_combinations || [];
            const stats = statsMetaFilesForCombo(c, catalogRows);
            const metaFiles = stats.map(function (f) { return f.meta; }).filter(Boolean);
            if (folderName && rec) {
                if (rec.folders.indexOf(folderName) === -1) rec.folders.push(folderName);
                if (!rec.extraction.byKey) rec.extraction.byKey = {};
                const key = String(folderName).trim().toUpperCase();
                if (!rec.extraction.byKey[key]) {
                    const item = {
                        sourceFile: '',
                        sheets: [],
                        metaFiles: [],
                        targetFolder: folderName
                    };
                    rec.extraction.byKey[key] = item;
                    rec.extraction.records.push(item);
                }
                const item = rec.extraction.byKey[key];
                metaFiles.forEach(function (m) {
                    if (item.metaFiles.indexOf(m) === -1) item.metaFiles.push(m);
                });
                item.metaFiles = collapseRelatedSheetStems(item.metaFiles).map(function (s) {
                    return /\.meta\.json$/i.test(s) ? s : (s + '.meta.json');
                });
                if (rec.extraction.folders.indexOf(folderName) === -1) rec.extraction.folders.push(folderName);
            }
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
                if (!assigns.length) addToSide(examRec, examRec.exam, folderName, null, [], { templateName: examTplName });
                assigns.forEach(function (a) { addToSide(examRec, examRec.exam, folderName, a.class_id, [], { templateName: examTplName }); });
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

    /**
     * 官方配對／出題下拉用的「真的產出 meta 檔名」。
     * 禁止把 Excel 活頁名（vBK-2）補成 vBK-2.meta.json。
     */
    function publishedMetaNameFromSheet(sheetStem, metaFileName, templateName) {
        const fromDb = String(metaFileName || '').trim();
        if (fromDb) return fromDb;
        const stem = String(sheetStem || '').trim();
        if (!stem) return '';
        if (/\.meta\.json$/i.test(stem)) return stem;
        if (/\.meta$/i.test(stem)) return stem.replace(/\.meta$/i, '.meta.json');
        const tpl = String(templateName || '').trim();
        if (!tpl) return '';
        return toMetaFileName(stem, tpl);
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

    let _comboStatsByClass = {};
    const _comboStatsLoad = {};

    function comboStatsKey(folderName, stem) {
        return String(folderName || '').trim().toUpperCase() + '|' + String(stem || '').trim()
            .replace(/\.meta\.json$/i, '').toUpperCase();
    }

    function indexComboStatsRows(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            if (!row) return;
            const folder = String(row.folder_name || '').trim();
            const stem = String(row.sheet_stem || '').trim();
            if (!folder || !stem) return;
            const pageCounts = (row.page_counts && typeof row.page_counts === 'object') ? row.page_counts : {};
            const rec = {
                folderName: folder,
                sheetStem: stem,
                pageMin: row.page_min == null ? null : Number(row.page_min),
                pageMax: row.page_max == null ? null : Number(row.page_max),
                availableCount: row.available_count == null ? null : Number(row.available_count),
                pageCounts: pageCounts
            };
            map[comboStatsKey(folder, stem)] = rec;
        });
        return map;
    }

    async function loadComboStatsForClass(classId, force) {
        const cid = String(classId || '');
        if (!cid) return {};
        if (!force && _comboStatsByClass[cid]) return _comboStatsByClass[cid];
        if (!force && _comboStatsLoad[cid]) return _comboStatsLoad[cid];
        _comboStatsLoad[cid] = (async function () {
            let rows = [];
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient.rpc('fetch_class_combo_stats', {
                    p_class_id: cid
                });
                if (!error) {
                    if (Array.isArray(data)) rows = data;
                    else if (data && Array.isArray(data.sheets)) rows = data.sheets;
                }
            }
            const prev = _comboStatsByClass[cid] || {};
            const next = indexComboStatsRows(rows);
            Object.keys(prev).forEach(function (k) {
                if (next[k] && prev[k] && prev[k].pageCounts && Object.keys(prev[k].pageCounts).length
                    && (!next[k].pageCounts || !Object.keys(next[k].pageCounts).length)) {
                    next[k].pageCounts = prev[k].pageCounts;
                }
            });
            _comboStatsByClass[cid] = next;
            return next;
        })().finally(function () { delete _comboStatsLoad[cid]; });
        return _comboStatsLoad[cid];
    }

    async function prefetchForClass(classId) {
        await Promise.all([
            fetchSuggestionMap(false).catch(function () { return null; }),
            loadComboStatsForClass(classId, false).catch(function () { return {}; })
        ]);
    }

    function lookupSheetStats(classId, folderName, sheetHint) {
        const cid = String(classId || '');
        const map = _comboStatsByClass[cid];
        if (!map || !folderName || !sheetHint) return null;
        const folder = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
            ? window.MaterialNameMap.resolveFolderName(folderName) : String(folderName || '').trim();
        const raw = String(sheetHint || '').trim().replace(/\.meta\.json$/i, '');
        if (!raw) return null;
        const exact = map[comboStatsKey(folder, raw)] || map[comboStatsKey(String(folderName || '').trim(), raw)];
        if (exact) return exact;
        const want = raw.toUpperCase();
        const keys = Object.keys(map);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(folder.toUpperCase() + '|') !== 0) continue;
            const rec = map[keys[i]];
            const stem = String(rec.sheetStem || '').toUpperCase();
            if (stem === want || stem.indexOf(want + '.') === 0 || want.indexOf(stem + '.') === 0) return rec;
        }
        return null;
    }

    function rememberSheetPageCounts(classId, folderName, sheetHint, pageCounts) {
        const cid = String(classId || '');
        const folder = String(folderName || '').trim();
        const stem = String(sheetHint || '').trim().replace(/\.meta\.json$/i, '');
        if (!cid || !folder || !stem || !pageCounts) return;
        if (!_comboStatsByClass[cid]) _comboStatsByClass[cid] = {};
        const key = comboStatsKey(folder, stem);
        const prev = _comboStatsByClass[cid][key] || {
            folderName: folder,
            sheetStem: stem,
            pageMin: null,
            pageMax: null,
            availableCount: null,
            pageCounts: {}
        };
        prev.pageCounts = pageCounts;
        const pages = Object.keys(pageCounts).map(Number).filter(function (n) { return !isNaN(n); });
        if (pages.length) {
            prev.pageMin = Math.min.apply(null, pages);
            prev.pageMax = Math.max.apply(null, pages);
            prev.availableCount = pages.reduce(function (sum, p) {
                return sum + (Number(pageCounts[p] != null ? pageCounts[p] : pageCounts[String(p)]) || 0);
            }, 0);
        }
        _comboStatsByClass[cid][key] = prev;
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
        listOfficialMetaStemsForFolder: listOfficialMetaStemsForFolder,
        getOfficialExamTemplateDefaultId: getOfficialExamTemplateDefaultId,
        isOfficialPairingCacheReady: isOfficialPairingCacheReady,
        fetchOfficialPairings: fetchOfficialPairings,
        folderHasOfficialExamPairing: folderHasOfficialExamPairing,
        listAssignedFoldersForClass: listAssignedFoldersForClass,
        listAssignedCombosForClass: listAssignedCombosForClass,
        getAssignedComboById: getAssignedComboById,
        findAssignedComboForSection: findAssignedComboForSection,
        isFolderAssignedToClass: isFolderAssignedToClass,
        lookupUsage: lookupUsage,
        recordApplyFromExcel: recordApplyFromExcel,
        summarizeUsageByTemplate: summarizeUsageByTemplate,
        getUsageSummaryCachedSync: getUsageSummaryCachedSync,
        listOverwriteTargets: listOverwriteTargets,
        invalidateDisplayCaches: invalidateDisplayCaches,
        renderTemplateUsageHtml: renderTemplateUsageHtml,
        bindUsageSheetToggles: bindUsageSheetToggles,
        listMaterialZoneRows: listMaterialZoneRows,
        updateMaterialZoneLabel: updateMaterialZoneLabel,
        renderMaterialZone: renderMaterialZone,
        prefetchForClass: prefetchForClass,
        lookupSheetStats: lookupSheetStats,
        rememberSheetPageCounts: rememberSheetPageCounts
    };
})();

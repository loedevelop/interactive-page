/**
 * 📂 檔案路徑：110_teacher_core/feature-class-material-combinations.js
 * 🎯 職責：教材-擷取範本-班級-出題紀錄正規化重構第 5 步——把「📎 套用到教材」已經存在的
 * （教材資料夾＋擷取範本＋來源檔＋一組活頁）候選，走兩步驟精靈正式命名成一個可重複使用的
 * material_combinations：
 *   Step 1：擷取組合（資料夾＋擷取範本＋來源檔＋活頁；來源檔不同＝不同套餐）
 *   Step 2：套用考卷範本（從老師自己的「🧾 考卷範本」清單勾選一個或多個，寫入
 *           material_combination_exam_templates——這是老師「明確」決定的搭配，不是系統
 *           自動把擷取範本當考卷範本，見 2026-08-14「分離擷取範本與考卷範本」）
 *   Step 3：指派給班級（class_material_combinations）
 *
 * 套餐（名稱／試卷範本／採用班級）只在教材區編輯並存檔，其他畫面只讀、不准另開一條寫入。
 * 新增／產生在同一頁三個獨立區塊（Excel/JSON 套用、PDF 套用、目錄＋新增），不在教材區窗口。
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
            const examIds = examIdsOfCombo(combo);
            const examNames = examIds.map(function (id) { return templateNameById(id); }).filter(Boolean);
            const extractId = String(combo.extraction_template_id || '');
            const assignments = Array.isArray(combo.class_material_combinations) ? combo.class_material_combinations : [];
            const sheets = relatedSheetsFromCombo(combo);
            assignments.forEach(function (a) {
                const cid = String(a.class_id);
                if (!byClass[cid]) {
                    byClass[cid] = { cls: { id: cid, name: classNameById(cid) }, materials: [] };
                }
                const list = byClass[cid].materials;
                sheets.forEach(function (sh) {
                    const sheetKey = folderKey + '|' + extractId + '|' + String(sh.sheetStem).toUpperCase();
                    const hit = list.find(function (m) { return m.sheetKey === sheetKey; });
                    if (hit) return;
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

    function renderClassReviewDeskHtml(statRows) {
        const FS = '0.85rem';
        const rows = buildClassReviewDeskModelFromStats(statRows);
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
                        const extractName = m.templateName || '';
                        const examName = (m.examNames || []).join('、');
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

    function comboFolderIdOf(combo) {
        if (!combo) return '';
        return String(combo.material_folder_id || (combo.material_folders && combo.material_folders.id) || '');
    }

    /**
     * 這份套餐自己的試卷 id。隔壁套餐的擷取範本 id 出現在這裡＝借名字，丟掉。
     * 自己雙用（試卷 id＝這份擷取）留下。沒有就空陣列，不准補。
     */
    function ownExamTemplateIds(combo, allCombos) {
        const links = Array.isArray(combo && combo.material_combination_exam_templates)
            ? combo.material_combination_exam_templates
            : [];
        const mine = String((combo && combo.extraction_template_id) || '');
        const folderId = comboFolderIdOf(combo);
        const siblingExtract = {};
        (allCombos || []).forEach(function (c) {
            if (!c || comboFolderIdOf(c) !== folderId) return;
            const ext = String(c.extraction_template_id || '');
            if (!ext || ext === mine) return;
            siblingExtract[ext] = true;
        });
        const seen = {};
        const out = [];
        links.forEach(function (l) {
            const id = l && l.exam_template_id ? String(l.exam_template_id) : '';
            if (!id || seen[id] || siblingExtract[id]) return;
            seen[id] = true;
            out.push(id);
        });
        return out;
    }

    function ownExamLinks(combo, allCombos) {
        const keep = {};
        ownExamTemplateIds(combo, allCombos).forEach(function (id) { keep[id] = true; });
        return (Array.isArray(combo && combo.material_combination_exam_templates)
            ? combo.material_combination_exam_templates
            : []).filter(function (l) {
            const id = l && l.exam_template_id ? String(l.exam_template_id) : '';
            return !!(id && keep[id]);
        });
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
                source_file_name,
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
            const sourceFile = String(row.source_file_name || '').trim();
            const key = folder.id + '|' + row.extraction_template_id + '|' + sourceFileKey(sourceFile);
            if (!groups[key]) {
                groups[key] = {
                    material_folder_id: folder.id,
                    extraction_template_id: row.extraction_template_id,
                    source_file: sourceFile,
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
                is_group,
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

    function sheetStemBody(s) {
        return String(s || '').trim().replace(/\.meta\.json$/i, '');
    }

    function sheetStemHead(s) {
        const body = sheetStemBody(s);
        if (!body) return '';
        const dot = body.indexOf('.');
        return dot > 0 ? body.slice(0, dot) : body;
    }

    /**
     * 同一本活頁，全站同一把尺（只在同一張卡／同一資料夾內比）：
     * 1) 較短名 +「.」是較長名的前綴（AvaLiu-vBK-2 ⊂ AvaLiu-vBK-2.vocab-word）
     * 2) 第一段較短名是較長名的班級後綴（vBK-2 ⊂ AvaLiu-vBK-2）
     *    後綴只在「整個清單裡剛好對到一本」時才併，對到兩本就不猜。
     */
    function sheetStemsRelated(a, b) {
        const au = sheetStemBody(a).toUpperCase();
        const bu = sheetStemBody(b).toUpperCase();
        if (!au || !bu) return false;
        if (au === bu) return true;
        const aDot = au.indexOf('.');
        const bDot = bu.indexOf('.');
        const aSuf = aDot > 0 ? au.slice(aDot + 1) : '';
        const bSuf = bDot > 0 ? bu.slice(bDot + 1) : '';
        if (aSuf && bSuf && aSuf !== bSuf) return false;
        return au.indexOf(bu + '.') === 0 || bu.indexOf(au + '.') === 0;
    }

    function sheetHeadIsClassSuffix(longHead, shortHead) {
        const L = String(longHead || '').toUpperCase();
        const S = String(shortHead || '').toUpperCase();
        if (!L || !S || L === S || L.length <= S.length) return false;
        const tail = L.slice(L.length - S.length - 1);
        return tail === '-' + S || tail === '_' + S;
    }

    function preferredSheetHead(names) {
        let best = '';
        (names || []).forEach(function (n) {
            const h = sheetStemHead(n);
            if (!h) return;
            if (!best) {
                best = h;
                return;
            }
            if (h.toUpperCase() === best.toUpperCase()) return;
            if (sheetHeadIsClassSuffix(h, best)) best = h;
        });
        return best;
    }

    /** 活頁名用帶班級的那一段；短名 vBK-2 只是影子。 */
    function promoteFileSheetIdentity(f, extraNames) {
        if (!f) return;
        const head = preferredSheetHead([
            f.stem, f.meta, f.script, f.dbStem, f.dbMeta, f.dbScript
        ].concat(extraNames || []));
        if (head) f.stem = head;
    }

    function uniqueClassSuffixKeep(list, incoming) {
        const inHead = sheetStemHead(incoming.stem);
        if (!inHead) return null;
        const longerHits = [];
        const shorterHits = [];
        (list || []).forEach(function (x) {
            const h = sheetStemHead(x.stem);
            if (sheetHeadIsClassSuffix(h, inHead)) longerHits.push(x);
            if (sheetHeadIsClassSuffix(inHead, h)) shorterHits.push(x);
        });
        if (longerHits.length === 1 && shorterHits.length === 0) return longerHits[0];
        if (shorterHits.length === 1 && longerHits.length === 0) return shorterHits[0];
        return null;
    }

    function mergeRelatedSheetFile(keep, incoming) {
        if (!keep.relatedIds) keep.relatedIds = [];
        const keepBody = sheetStemBody(keep.stem);
        const newBody = sheetStemBody(incoming.stem);
        if (newBody.length > keepBody.length) {
            if (keep.id && String(keep.id) !== String(incoming.id)) keep.relatedIds.push(keep.id);
            keep.id = incoming.id;
            keep.stem = incoming.stem || newBody;
        } else if (incoming.id && String(incoming.id) !== String(keep.id)) {
            keep.relatedIds.push(incoming.id);
        }
        if (incoming.meta && (!keep.meta || sheetStemBody(incoming.meta).length > sheetStemBody(keep.meta).length)) {
            keep.meta = incoming.meta;
        }
        if (incoming.script && (!keep.script || sheetStemBody(incoming.script).length > sheetStemBody(keep.script).length)) {
            keep.script = incoming.script;
        }
        (incoming.relatedIds || []).forEach(function (id) {
            if (id && String(id) !== String(keep.id) && keep.relatedIds.indexOf(id) === -1) keep.relatedIds.push(id);
        });
        if (incoming.is_group === true) keep.is_group = true;
        if (incoming.sourceFile && !keep.sourceFile) keep.sourceFile = incoming.sourceFile;
        return keep;
    }

    /** 同一活頁會被記成 Excel 名又記成產出 stem。顯示／計數／改名列都只留較完整的那一個。 */
    function collapseRelatedSheetStems(stems) {
        const raw = [];
        (stems || []).forEach(function (s) {
            const t = sheetStemBody(s);
            if (t && !raw.some(function (x) { return x.toUpperCase() === t.toUpperCase(); })) raw.push(t);
        });
        return raw.filter(function (s, i) {
            return !raw.some(function (other, j) {
                if (i === j) return false;
                if (sheetStemsRelated(s, other) && sheetStemBody(other).length > sheetStemBody(s).length) return true;
                const wrappers = raw
                    .map(function (x, idx) { return { stem: x, idx: idx }; })
                    .filter(function (x) { return x.idx !== i && sheetHeadIsClassSuffix(sheetStemHead(x.stem), sheetStemHead(s)); });
                return wrappers.length === 1 && wrappers[0].idx === j;
            });
        });
    }

    function collapseRelatedSheetFiles(files) {
        const list = [];
        (files || []).forEach(function (f) {
            if (!f || !f.id) return;
            if (!f.relatedIds) f.relatedIds = [];
            const hit = list.find(function (x) { return sheetStemsRelated(x.stem, f.stem); })
                || uniqueClassSuffixKeep(list, f);
            if (!hit) {
                list.push(f);
                return;
            }
            mergeRelatedSheetFile(hit, f);
            if (f.dbMeta && !hit.dbMeta) hit.dbMeta = f.dbMeta;
            if (f.dbScript && !hit.dbScript) hit.dbScript = f.dbScript;
            if (f.dbStem && sheetStemBody(f.dbStem).length > sheetStemBody(hit.dbStem || '').length) {
                hit.dbStem = f.dbStem;
            }
        });
        return list;
    }

    /** 已經建立好的組合＋目前搭配的考卷範本＋目前指派到哪些班級 */
    /** 寫入／修檔才讀來源表。教材區／出作業畫面不准走這裡。 */
    async function loadCombinations(userId) {
        const selectBody = function (opts) {
            opts = opts || {};
            return `
                id,
                label,
                ${opts.sourceLabels ? 'source_labels,' : ''}
                ${opts.pdf ? 'student_pdf_file_id, student_pdf_file_name, student_pdf_page_map,' : ''}
                material_folder_id,
                extraction_template_id,
                created_at,
                material_folders!inner ( id, root_kind, class_id, folder_name, teacher_id ),
                material_templates ( id, name ),
                material_combination_sheets ( material_sheet_id, material_sheets ( id, sheet_stem, meta_file_name, script_file_name, source_file_name, extraction_template_id, is_group ) ),
                material_combination_exam_templates ( id, exam_template_id, is_default ),
                class_material_combinations ( id, class_id, assigned_at )
            `;
        };
        let result = await window.supabaseClient
            .from('material_combinations')
            .select(selectBody({ sourceLabels: true, pdf: true }))
            .eq('material_folders.teacher_id', userId)
            .order('created_at', { ascending: false });
        if (result.error && /student_pdf/i.test(result.error.message || '')) {
            result = await window.supabaseClient
                .from('material_combinations')
                .select(selectBody({ sourceLabels: true, pdf: false }))
                .eq('material_folders.teacher_id', userId)
                .order('created_at', { ascending: false });
        }
        if (result.error && /source_labels/i.test(result.error.message || '')) {
            result = await window.supabaseClient
                .from('material_combinations')
                .select(selectBody({ sourceLabels: false, pdf: true }))
                .eq('material_folders.teacher_id', userId)
                .order('created_at', { ascending: false });
            if (result.error && /student_pdf/i.test(result.error.message || '')) {
                result = await window.supabaseClient
                    .from('material_combinations')
                    .select(selectBody({ sourceLabels: false, pdf: false }))
                    .eq('material_folders.teacher_id', userId)
                    .order('created_at', { ascending: false });
            }
        }
        if (result.error) throw result.error;
        return result.data || [];
    }

    function groupKeyOf(g) {
        return String(g.material_folder_id || '') + '|' + String(g.extraction_template_id || '') + '|' + sourceFileKey(g.source_file);
    }

    function comboSourceKeys(combo) {
        const seen = {};
        const keys = [];
        comboLinkedSheetFiles(combo).forEach(function (f) {
            const k = sourceFileKey(f.sourceFile);
            if (seen[k]) return;
            seen[k] = true;
            keys.push(k);
        });
        return keys;
    }

    function comboContainsSheetIds(combo, sheetDbIds) {
        const files = comboLinkedSheetFiles(combo);
        const have = {};
        files.forEach(function (f) { if (f && f.id) have[String(f.id)] = true; });
        const want = (sheetDbIds || []).map(function (id) { return String(id || '').trim(); }).filter(Boolean);
        if (!want.length) return false;
        return want.every(function (id) { return !!have[id]; });
    }

    function comboContainsAnySheet(combo, sheetDbIds) {
        const files = comboLinkedSheetFiles(combo);
        const have = {};
        files.forEach(function (f) { if (f && f.id) have[String(f.id)] = true; });
        return (sheetDbIds || []).some(function (id) { return id && have[String(id)]; });
    }

    function oldestCombo(pool) {
        const list = (pool || []).slice();
        list.sort(function (a, b) {
            const ta = Date.parse(a.created_at || '') || 0;
            const tb = Date.parse(b.created_at || '') || 0;
            return ta - tb;
        });
        return list[0] || null;
    }

    function comboExamKey(combo) {
        const links = Array.isArray(combo && combo.material_combination_exam_templates)
            ? combo.material_combination_exam_templates : [];
        const ids = links.map(function (l) {
            return l && l.exam_template_id ? String(l.exam_template_id) : '';
        }).filter(Boolean);
        ids.sort();
        return ids.join('|');
    }

    function examIdsKey(examTemplateIds) {
        return (examTemplateIds || []).filter(Boolean).map(String).sort().join('|');
    }

    function examIdsOfCombo(combo) {
        const links = Array.isArray(combo && combo.material_combination_exam_templates)
            ? combo.material_combination_exam_templates : [];
        const seen = {};
        const out = [];
        links.forEach(function (l) {
            const id = l && l.exam_template_id ? String(l.exam_template_id) : '';
            if (!id || seen[id]) return;
            seen[id] = true;
            out.push(id);
        });
        return out;
    }

    function packOfCombo(combo) {
        return { exclusive: combo || null, combo: combo || null };
    }

    function combosForSheet(combos, folderId, templateId, sheetIds) {
        const ids = (sheetIds || []).filter(Boolean);
        if (!folderId || !templateId || !ids.length) return [];
        return (combos || []).filter(function (c) {
            return String(c.material_folder_id) === String(folderId)
                && String(c.extraction_template_id) === String(templateId)
                && comboContainsAnySheet(c, ids);
        });
    }

    function zoneKeysForSheet(byKey, folderId, templateId, sheetKey, sheetId) {
        return Object.keys(byKey || {}).filter(function (k) {
            const row = byKey[k];
            if (!row) return false;
            if (String(row.folderId) !== String(folderId)) return false;
            if (String(row.templateId) !== String(templateId)) return false;
            if (sheetId && (row.sheetDbIds || []).some(function (id) { return String(id) === String(sheetId); })) return true;
            return String(row.sheetKey || '') === String(sheetKey || '');
        });
    }

    /**
     * 套餐＝活頁＋擷取＋試卷。三個都對到才是這一份。
     * 同一本活頁可以有很多份套餐。
     */
    function pickComboForCard(combos, folderId, templateId, sourceFile, sheetDbIds, examTemplateIds) {
        const ids = (sheetDbIds || []).filter(Boolean);
        if (!ids.length) return null;
        const wantExam = examIdsKey(examTemplateIds);
        const pool = (combos || []).filter(function (c) {
            return String(c.material_folder_id) === String(folderId)
                && String(c.extraction_template_id) === String(templateId)
                && comboContainsAnySheet(c, ids)
                && comboExamKey(c) === wantExam;
        });
        return oldestCombo(pool);
    }

    function zoneDisplayCombo(combos, folderId, templateId, sourceFile, sheetDbIds, examTemplateIds) {
        const combo = pickComboForCard(combos, folderId, templateId, sourceFile, sheetDbIds, examTemplateIds);
        return { exclusive: combo, combo: combo };
    }

    async function copyExamTemplateLinks(fromComboId, toComboId) {
        if (!fromComboId || !toComboId || fromComboId === toComboId) return;
        const { data: links, error } = await window.supabaseClient
            .from('material_combination_exam_templates')
            .select('exam_template_id, is_default')
            .eq('material_combination_id', fromComboId);
        if (error) throw error;
        const rows = (links || []).filter(function (l) { return l && l.exam_template_id; })
            .map(function (l, idx) {
                return {
                    material_combination_id: toComboId,
                    exam_template_id: l.exam_template_id,
                    is_default: !!l.is_default || idx === 0
                };
            });
        if (!rows.length) return;
        const { error: insErr } = await window.supabaseClient
            .from('material_combination_exam_templates')
            .insert(rows);
        if (insErr && !/duplicate|unique|conflict/i.test(insErr.message || '')) throw insErr;
    }

    /** 套餐＝活頁＋擷取＋試卷。同一本活頁可以對很多份。 */
    async function ensureCombination(userId, group, label) {
        const { data: existingList, error: findErr } = await window.supabaseClient
            .from('material_combinations')
            .select('id, label, created_at, material_folders!inner(teacher_id), material_combination_sheets(material_sheet_id, material_sheets(id, source_file_name, sheet_stem, meta_file_name, script_file_name, extraction_template_id, is_group)), material_combination_exam_templates(exam_template_id)')
            .eq('material_folder_id', group.material_folder_id)
            .eq('extraction_template_id', group.extraction_template_id)
            .eq('material_folders.teacher_id', userId)
            .order('created_at', { ascending: true });
        if (findErr) throw findErr;
        const list = existingList || [];
        let existing = null;
        if (group.combo_id) {
            existing = list.find(function (c) { return String(c.id) === String(group.combo_id); }) || { id: group.combo_id };
        }
        if (!existing) {
            existing = pickComboForCard(
                list,
                group.material_folder_id,
                group.extraction_template_id,
                group.source_file,
                group.sheet_db_ids,
                group.exam_template_ids || group.examTemplateIds || []
            );
        }

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
            return comboId;
        }

        const ownSheetIds = (group.sheet_db_ids || []).filter(Boolean);
        const oneSheetId = ownSheetIds.length === 1 ? ownSheetIds[0] : '';
        const stem = String((group.sheet_stem || group.sheetStem || '') || '').trim();
        const extName = templateNameById(group.extraction_template_id) || '';
        const examName = String(group.exam_template_name || group.examTemplateName || '').trim();
        const nextLabel = String(label || '').trim() || defaultComboLabel(stem, extName, examName) || null;
        if (nextLabel) {
            const { data: clash, error: clashErr } = await window.supabaseClient
                .from('material_combinations')
                .select('id, material_folders!inner(teacher_id)')
                .eq('label', nextLabel)
                .eq('material_folders.teacher_id', userId);
            if (clashErr) throw clashErr;
            if (clash && clash.length) throw new Error('套餐名「' + nextLabel + '」已存在，不能建立');
        }
        const { data: inserted, error: insErr } = await window.supabaseClient
            .from('material_combinations')
            .insert({ material_folder_id: group.material_folder_id, extraction_template_id: group.extraction_template_id, label: nextLabel })
            .select('id')
            .single();
        if (insErr) throw insErr;
        comboId = inserted.id;
        if (oneSheetId) {
            const { error: linkInsErr } = await window.supabaseClient
                .from('material_combination_sheets')
                .insert({ combination_id: comboId, material_sheet_id: oneSheetId });
            if (linkInsErr) throw linkInsErr;
        }
        return comboId;
    }

    /**
     * Step 2：把老師勾選的考卷範本寫入 material_combination_exam_templates（差異比對，不整批
     * 覆寫）。老師選「擷取範本與試卷範本」時，同一份範本要寫進官方配對；不准默默改套別份。
     * examTemplateIds 可以是空：擷取套餐（例如 Excel 的 meta-sentence）沒有試卷就留空。
     * 沒有官方配對就不能出考卷，但不准為了填滿而抄別份套餐的試卷。
     */
    async function setComboExamTemplates(comboId, examTemplateIds) {
        const wanted = (examTemplateIds || []).filter(Boolean);
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
    /** classId → 已指派且已搭配試卷範本的套餐（出題第一層；這次不動） */
    let _assignedCombosByClass = {};
    /** classId → 這個班有勾採用的教材區卡（出作業／出題下拉。文字＝卡上已存套餐名） */
    let _assignedCombosForHomeworkByClass = {};
    let _assignedCombosForHomeworkAllByClass = {};
    /** classId → { combinationId: rawCombo } 收成套餐前的一筆。 */
    let _homeworkCombosRawByClass = {};
    let _availBackfillPromise = null;
    let _availBackfillTried = false;

    /** 套餐名唯一開口。有已存套餐名就讀這顆。 */
    function comboLabelText(src) {
        if (src == null) return '';
        if (typeof src === 'string') return String(src).trim();
        const named = String(src.combo_label || src.comboLabel || src.rawLabel || '').trim();
        if (named) return named;
        return String(src.label || '').trim();
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
            if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
                await window.MaterialNameMap.ensureLoaded(false);
            }
            const userId = await getCurrentUserId();
            if (!userId) { _suggestionCache = {}; return _suggestionCache; }
            let statRows = [];
            try {
                statRows = await loadTeacherComboStatistics(false);
            } catch (statErr) {
                console.warn('[FeatureClassMaterialCombinations] 讀取官方試卷配對失敗', statErr);
                _suggestionCache = _suggestionCache || {};
                return _suggestionCache;
            }
            applyOfficialPairingsFromStats(statRows);
            backfillMissingSheetTotals().catch(function (err) {
                console.warn('[FeatureClassMaterialCombinations] 補齊活頁總題數失敗', err);
            });
            return _suggestionCache;
        })().finally(function () { _suggestionLoadPromise = null; });
        return _suggestionLoadPromise;
    }

    function ensureOfficialCacheLoading() {
        if (_suggestionCache === null && !_suggestionLoadPromise) {
            fetchSuggestionMap(false).then(function () {
                if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
                    window.FeatureTimeline.refreshBuilder({ skipSync: true });
                }
                if (window.FeatureExamJob && typeof window.FeatureExamJob.refreshExamBuilder === 'function') {
                    window.FeatureExamJob.refreshExamBuilder();
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
    function listOfficialExamTemplateIdsForCombo(combo) {
        if (!combo) return [];
        const seen = {};
        const out = [];
        (Array.isArray(combo.examTemplateIds) ? combo.examTemplateIds : []).forEach(function (id) {
            const s = String(id || '').trim();
            if (!s || seen[s]) return;
            seen[s] = true;
            out.push(s);
        });
        if (!out.length && combo.examTemplateId) out.push(String(combo.examTemplateId));
        return out;
    }

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

    // 【死命註解｜永遠禁止刪除｜2026-08-27 老師命令綁死】
    // 出題下拉＝該班套餐名，再只留已搭配試卷的。別班／未勾／檔名不准出現。
    function listAssignedCombosForClass(classId) {
        ensureOfficialCacheLoading();
        ensureComboStatsLoading(classId);
        return listAssignedCombosForHomework(classId).filter(function (c) {
            return c && (c.examTemplateIds || []).length;
        });
    }

    // 【死命註解｜永遠禁止刪除｜2026-08-27 老師命令綁死】
    // 開口仍是這一個函式。三種套餐同層：Excel/JSON／PDF／目錄都走 MaterialComboStrategies。
    // Excel／JSON 只讀這個班的 statistics：fetch_class_combo_stats。文字＝combo_label。
    // PDF／目錄走獨立表，不准寫進 combo_statistics。
    function listAssignedSheetCombosForHomework(classId) {
        ensureComboStatsLoading(classId);
        return (_assignedCombosForHomeworkAllByClass[String(classId || '')] || []).slice();
    }

    function listAssignedCombosForHomework(classId) {
        ensureComboStatsLoading(classId);
        if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.ensureLoaded === 'function') {
            window.MaterialComboStrategies.ensureLoaded();
        }
        if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.listAssignedForHomework === 'function') {
            return window.MaterialComboStrategies.listAssignedForHomework(classId);
        }
        return listAssignedSheetCombosForHomework(classId);
    }

    function comboHasId(combo, comboId) {
        const want = String(comboId || '').trim();
        if (!combo || !want) return false;
        if (String(combo.id) === want) return true;
        return (combo.siblingIds || []).some(function (id) { return String(id) === want; });
    }

    function getAssignedComboById(classId, comboId) {
        const want = String(comboId || '').trim();
        if (!want || want === '__manual__') return null;
        if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.getAssignedById === 'function') {
            const fromReg = window.MaterialComboStrategies.getAssignedById(classId, want);
            if (fromReg) return fromReg;
        }
        const cid = String(classId || '');
        const fromAll = (_assignedCombosForHomeworkAllByClass[cid] || []).find(function (c) {
            return comboHasId(c, want);
        });
        if (fromAll) return fromAll;
        const fromCards = (_assignedCombosForHomeworkByClass[cid] || []).find(function (c) {
            return comboHasId(c, want);
        });
        if (fromCards) return fromCards;
        return listAssignedCombosForClass(classId).find(function (c) {
            return comboHasId(c, want);
        }) || null;
    }

    function comboIsGrouped(comboOrId) {
        if (!comboOrId) return false;
        if (typeof comboOrId === 'object' && comboOrId.isGroup === true) return true;
        const id = String((typeof comboOrId === 'object' ? comboOrId.id : comboOrId) || '').trim();
        if (!id) return false;
        const rows = _materialZoneRowsCache || [];
        return rows.some(function (r) {
            const ids = (r.siblingIds && r.siblingIds.length) ? r.siblingIds : [r.comboId];
            if (!ids.some(function (x) { return String(x || '') === id; })) return false;
            return (r.sheetFiles || []).some(function (f) { return f && f.is_group === true; });
        });
    }

    function findAssignedComboForSection(classId, hint) {
        hint = hint || {};
        const list = listAssignedCombosForClass(classId);
        const wantId = String(hint.combinationId || hint.combination_id || '').trim();
        if (wantId) {
            return list.find(function (c) { return comboHasId(c, wantId); }) || null;
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
            // 同一資料夾多套餐共用試卷範本（pic＋word）＝不准猜第一筆
            return null;
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
    let _homeworkZoneRowsCache = null;
    let _homeworkCardsReadyByClass = {};
    let _teacherComboStatsRows = null;
    let _teacherComboStatsLoad = null;

    function invalidateSuggestionCache() {
        _suggestionCache = null;
        _officialMetaFilesByFolderKey = {};
        _assignedFoldersByClass = {};
        _assignedCombosByClass = {};
        _assignedCombosForHomeworkByClass = {};
        _assignedCombosForHomeworkAllByClass = {};
        _homeworkCombosRawByClass = {};
        _comboStatsByClass = {};
        _sheetPageCountsByClass = {};
        _materialZoneRowsCache = null;
        _homeworkZoneRowsCache = null;
        _homeworkCardsReadyByClass = {};
        _teacherComboStatsRows = null;
        _teacherComboStatsLoad = null;
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
                + '<input type="checkbox" class="' + prefix + '-exam-tpl-cb" value="' + esc(t.id) + '" ' + (checked.map(String).indexOf(String(t.id)) !== -1 ? 'checked' : '') + '>'
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
            + '<label style="font-size:0.76rem; font-weight:800; color:#475569; display:block; margin-bottom:6px;">Excel/JSON 套餐（建議填，出題下拉會顯示這個名字）'
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

    function paint(wrap, statRows) {
        wrap.innerHTML = renderClassReviewDeskHtml(statRows);
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

    function defaultComboLabel(sheetStem, extractionName, examName) {
        const live = String(sheetStem || '').trim();
        const ext = String(extractionName || '').trim();
        const exam = String(examName || '').trim();
        if (!live || !ext) return '';
        if (exam) return live + '.' + ext + '.' + exam;
        return live + '.' + ext;
    }

    function defaultMaterialZoneLabel(sourceFile, folderName, templateName, sheetStem, examName) {
        const named = defaultComboLabel(sheetStem, templateName, examName);
        if (named) return named;
        const sheet = String(sheetStem || '').trim();
        if (sheet) return sheet;
        return String(templateName || '').trim() || '未命名套餐';
    }

    function firstSheetStemOf(row) {
        const files = (row && row.sheetFiles) || [];
        if (files[0] && files[0].stem) return String(files[0].stem).trim();
        const stems = (row && row.sheetStems) || [];
        return String(stems[0] || row && row.sheetKey || '').trim();
    }

    function resolvedSourceFile(row) {
        const direct = normalizeSourceFileName(row && row.sourceFile);
        if (direct) return direct;
        const srcs = {};
        ((row && row.sheetFiles) || []).forEach(function (f) {
            const s = normalizeSourceFileName(f && f.sourceFile);
            if (s) srcs[sourceFileKey(s)] = s;
        });
        const ks = Object.keys(srcs);
        return ks.length === 1 ? srcs[ks[0]] : '';
    }

    function sourceLabelsMapKey(row) {
        const src = resolvedSourceFile(row);
        if (src) return src;
        const sheet = firstSheetStemOf(row) || String((row && row.sheetKey) || '').trim();
        return sheet || MZ_NO_SOURCE_KEY;
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

    function ungroupedSheetKeyOf(r) {
        if (!r || r.is_group === true) return '';
        return sheetMatchKey(r.sheet_stem || r.stem || '') || String(r.id || '');
    }

    function materialZoneRowKey(folderId, templateId, sourceFile, ungroupedSheetKey) {
        return [
            String(folderId || ''),
            String(templateId || ''),
            sourceFileKey(sourceFile),
            String(ungroupedSheetKey || '')
        ].join('|');
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
            if (combo.extraction_template_id && sh.extraction_template_id
                && String(sh.extraction_template_id) !== String(combo.extraction_template_id)) {
                return;
            }
            seen[String(id)] = true;
            out.push({
                id: id,
                stem: stem,
                meta: sh.meta_file_name || '',
                script: sh.script_file_name || '',
                sourceFile: sh.source_file_name || '',
                extraction_template_id: sh.extraction_template_id || '',
                is_group: sh.is_group === true
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
            .select('class_id, folder_name, sheet_stem, page_min, page_max, available_count, has_template, has_extraction_template, extraction_template_id, exam_template_id')
            .in('class_id', ids);
        if (error) {
            console.error('[FeatureClassMaterialCombinations] 讀複習目錄失敗（學生練習專區，不是出作業 statistics）', error);
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
        _homeworkZoneRowsCache = null;
        _homeworkCardsReadyByClass = {};
        _teacherComboStatsRows = null;
        _teacherComboStatsLoad = null;
    }

    /** 這份套餐自己連上的活頁。不是複習目錄。 */
    function statsMetaFilesForCombo(combo) {
        const seen = {};
        const out = [];
        comboLinkedSheetFiles(combo).forEach(function (f) {
            const k = sheetMatchKey(f.stem);
            if (!k || seen[k]) return;
            seen[k] = true;
            const meta = f.meta || (String(f.stem || '').replace(/\.meta\.json$/i, '') + '.meta.json');
            out.push({
                stem: f.stem,
                meta: /\.meta\.json$/i.test(meta) ? meta : (meta + '.meta.json'),
                script: f.script || ''
            });
        });
        out.sort(function (a, b) {
            return String(a.stem || '').localeCompare(String(b.stem || ''), 'zh-Hant');
        });
        return out;
    }

    async function listOverwriteTargets(folderName, templateId) {
        if (!folderName) return [];
        const rows = await loadTeacherComboStatistics(false);
        const folderU = String(folderName || '').trim().toUpperCase();
        const wantTpl = String(templateId || '').trim();
        const out = [];
        const seen = {};
        (rows || []).forEach(function (r) {
            if (String(r.folder_name || '').trim().toUpperCase() !== folderU) return;
            if (wantTpl && String(r.extraction_template_id || '') !== wantTpl) return;
            const stem = String(r.sheet_stem || '').trim();
            const id = r.material_sheet_id;
            const k = sheetMatchKey(stem) || String(id || '');
            if (!k || !id || seen[k]) return;
            seen[k] = true;
            const meta = String(r.meta_file_name || '').trim()
                || (stem.replace(/\.meta\.json$/i, '') + '.meta.json');
            const script = String(r.script_file_name || '').trim()
                || (stem.replace(/\.meta\.json$/i, '') + '.script.txt');
            out.push({
                id: id,
                stem: stem,
                meta: /\.meta\.json$/i.test(meta) ? meta : (meta + '.meta.json'),
                script: script
            });
        });
        return out;
    }

    function cloneZoneRowShell(row, key) {
        return {
            key: key,
            sheetKey: '',
            comboId: row.comboId || '',
            comboLabel: row.comboLabel || '',
            folderId: row.folderId || '',
            templateId: row.templateId || '',
            folderName: row.folderName || '',
            rootKind: row.rootKind,
            classId: row.classId || '',
            templateName: row.templateName || '',
            sourceFile: row.sourceFile || '',
            sourceKey: row.sourceKey || MZ_NO_SOURCE_KEY,
            sourceLabels: row.sourceLabels,
            label: row.label || '',
            sheetStems: [],
            sheetDbIds: [],
            sheetFiles: [],
            examTemplateIds: (row.examTemplateIds || []).slice(),
            classIds: (row.classIds || []).slice(),
            assignmentByClassId: Object.assign({}, row.assignmentByClassId || {}),
            classNames: (row.classNames || []).slice(),
            studentPdfFileId: row.studentPdfFileId || '',
            studentPdfFileName: row.studentPdfFileName || '',
            studentPdfPageMap: Array.isArray(row.studentPdfPageMap) ? row.studentPdfPageMap.slice() : []
        };
    }

    function addSheetFileToZoneRow(target, f) {
        if (!target || !f || !f.id) return;
        if (target.sheetDbIds.indexOf(f.id) === -1) target.sheetDbIds.push(f.id);
        const related = (target.sheetFiles || []).find(function (x) {
            return sheetStemsRelated(x.stem, f.stem);
        }) || uniqueClassSuffixKeep(target.sheetFiles, f);
        if (related) {
            mergeRelatedSheetFile(related, {
                id: f.id,
                stem: f.stem || '',
                meta: f.meta || '',
                script: f.script || '',
                sourceFile: f.sourceFile || '',
                is_group: f.is_group === true,
                relatedIds: []
            });
            return;
        }
        target.sheetStems.push(f.stem);
        target.sheetFiles.push({
            id: f.id,
            stem: f.stem || '',
            meta: f.meta || '',
            script: f.script || '',
            sourceFile: f.sourceFile || '',
            is_group: f.is_group === true,
            relatedIds: []
        });
    }

    /**
     * 改活頁清單補上套餐已連的活頁。沒勾群組＝自己一張卡，不准塞進別本。
     * 「幾個 meta」數這份套餐自己連上的活頁。
     */
    function mergeLinkedComboSheetsIntoZoneRows(rows, combos) {
        const bySource = {};
        (rows || []).forEach(function (row) {
            const ck = String(row.folderId || '') + '|' + String(row.templateId || '') + '|' + sourceFileKey(row.sourceFile) + '|' + String(row.sheetKey || '');
            if (!bySource[ck]) bySource[ck] = [];
            bySource[ck].push(row);
        });
        Object.keys(bySource).forEach(function (ck) {
            const group = bySource[ck];
            const sample = group[0];
            if (!sample) return;
            const pack = zoneDisplayCombo(combos, sample.folderId, sample.templateId, sample.sourceFile, sample.sheetDbIds, sample.examTemplateIds || []);
            const combo = pack.combo;
            if (!combo) return;
            const want = sourceFileKey(sample.sourceFile);
            const seenIds = {};
            group.forEach(function (row) {
                (row.sheetDbIds || []).forEach(function (id) { seenIds[String(id)] = true; });
            });
            comboLinkedSheetFiles(combo).forEach(function (f) {
                if (sourceFileKey(f.sourceFile) !== want) return;
                if (sample.sheetKey && ungroupedSheetKeyOf(f) !== sample.sheetKey) return;
                if (seenIds[String(f.id)]) return;
                seenIds[String(f.id)] = true;
                const uk = ungroupedSheetKeyOf(f);
                let target = null;
                if (uk) {
                    target = group.find(function (row) {
                        return String(row.sheetKey || '') === uk
                            || (row.sheetFiles || []).some(function (x) {
                                return sheetMatchKey(x.stem) === uk || String(x.id) === String(f.id);
                            });
                    });
                    if (!target) {
                        const base = group[0];
                        target = cloneZoneRowShell(base, materialZoneRowKey(base.folderId, base.templateId, base.sourceFile, uk));
                        target.sheetKey = uk;
                        rows.push(target);
                        group.push(target);
                    }
                } else {
                    target = group.find(function (r) { return !r.sheetKey; }) || group[0];
                }
                addSheetFileToZoneRow(target, f);
            });
        });
    }

    /** 沒勾＝一本一張。混在同一張的要拆開，不准收成一筆。 */
    function explodeUngroupedZoneRows(rows) {
        const out = [];
        (rows || []).forEach(function (row) {
            const files = row.sheetFiles || [];
            const grouped = files.filter(function (f) { return f && f.is_group === true; });
            const singles = files.filter(function (f) { return !f || f.is_group !== true; });
            if (singles.length <= 1 && !grouped.length) {
                if (singles[0]) row.sheetKey = ungroupedSheetKeyOf(singles[0]);
                out.push(row);
                return;
            }
            if (grouped.length && !singles.length) {
                row.sheetKey = '';
                out.push(row);
                return;
            }
            if (grouped.length) {
                const gRow = cloneZoneRowShell(row, materialZoneRowKey(row.folderId, row.templateId, row.sourceFile, ''));
                gRow.sheetKey = '';
                gRow.sheetFiles = grouped;
                gRow.sheetStems = grouped.map(function (f) { return f.stem; });
                gRow.sheetDbIds = grouped.map(function (f) { return f.id; }).filter(Boolean);
                out.push(gRow);
            }
            singles.forEach(function (f) {
                const uk = ungroupedSheetKeyOf(f);
                const sRow = cloneZoneRowShell(row, materialZoneRowKey(row.folderId, row.templateId, row.sourceFile, uk));
                sRow.sheetKey = uk;
                sRow.sheetFiles = [f];
                sRow.sheetStems = f.stem ? [f.stem] : [];
                sRow.sheetDbIds = f.id ? [f.id] : [];
                out.push(sRow);
            });
        });
        return out;
    }

    function emptyZoneRowFromCombo(combo, folder, templateId, templateName, sourceFile, sheetKey, allCombos) {
        const folderId = (folder && folder.id) || (combo && combo.material_folder_id) || '';
        const assigns = combo ? (combo.class_material_combinations || []) : [];
        const assignmentByClassId = {};
        assigns.forEach(function (a) {
            if (a && a.class_id && a.id) assignmentByClassId[String(a.class_id)] = a.id;
        });
        return {
            key: materialZoneRowKey(folderId, templateId, sourceFile, sheetKey),
            sheetKey: sheetKey || '',
            comboId: combo ? combo.id : '',
            comboLabel: combo ? String(combo.label || '').trim() : '',
            folderId: folderId,
            templateId: templateId,
            folderName: (folder && folder.folder_name) || '',
            rootKind: folder && folder.root_kind === 'class' ? 'class' : 'teacher',
            classId: (folder && folder.class_id) || '',
            templateName: templateName || '',
            sourceFile: sourceFile,
            sourceKey: sourceFile || MZ_NO_SOURCE_KEY,
            sourceLabels: combo ? combo.source_labels : {},
            label: sourceLabelFromMap(combo && combo.source_labels, sourceFile),
            sheetStems: [],
            sheetDbIds: [],
            sheetFiles: [],
            examTemplateIds: combo ? examIdsOfCombo(combo) : [],
            classIds: assigns.map(function (a) { return a && a.class_id ? String(a.class_id) : ''; }).filter(Boolean),
            assignmentByClassId: assignmentByClassId,
            classNames: uniqueSortedNames(assigns.map(function (a) {
                return classNameById(a.class_id);
            })),
            studentPdfFileId: combo ? String(combo.student_pdf_file_id || '') : '',
            studentPdfFileName: combo ? String(combo.student_pdf_file_name || '') : '',
            studentPdfPageMap: combo && Array.isArray(combo.student_pdf_page_map) ? combo.student_pdf_page_map : []
        };
    }

    function paintZoneRowCombo(row, pack) {
        if (!row) return;
        if (pack && pack.exclusive) {
            row.comboId = pack.exclusive.id;
            row.comboLabel = String(pack.exclusive.label || '').trim();
            return;
        }
        row.comboId = '';
        row.comboLabel = pack && pack.combo ? String(pack.combo.label || '').trim() : '';
    }

    function sourceNameFromComboKey(combo, srcKey) {
        const hit = comboLinkedSheetFiles(combo).find(function (f) {
            return sourceFileKey(f.sourceFile) === srcKey;
        });
        return hit ? normalizeSourceFileName(hit.sourceFile) : '';
    }

    function buildMaterialZoneRows(_groups, combos, applyRows) {
        const byKey = {};
        const order = [];
        (combos || []).forEach(function (c) {
            const folder = c.material_folders || {};
            const folderId = String(c.material_folder_id || folder.id || '');
            const templateId = String(c.extraction_template_id || '');
            if (!folderId || !templateId) return;
            const linked = comboLinkedSheetFiles(c);
            const srcKeys = comboSourceKeys(c);
            const paintKeys = srcKeys.length ? srcKeys : [sourceFileKey('')];
            const tplName = (c.material_templates && c.material_templates.name) || templateNameById(templateId);
            paintKeys.forEach(function (srcKey) {
                const sourceFile = sourceNameFromComboKey(c, srcKey);
                const ownLinked = linked.filter(function (f) { return sourceFileKey(f.sourceFile) === srcKey; });
                const pack = packOfCombo(c);
                const singles = ownLinked.filter(function (f) { return f.is_group !== true; });
                const hasGrouped = ownLinked.some(function (f) { return f.is_group === true; });
                if (!ownLinked.length) {
                    const key = materialZoneRowKey(folderId, templateId, sourceFile, '');
                    if (!byKey[key]) {
                        const row = emptyZoneRowFromCombo(c, folder, templateId, tplName, sourceFile, '', combos);
                        paintZoneRowCombo(row, pack);
                        byKey[key] = row;
                        order.push(key);
                    }
                    return;
                }
                if (hasGrouped) {
                    const key = materialZoneRowKey(folderId, templateId, sourceFile, '');
                    if (!byKey[key]) {
                        const row = emptyZoneRowFromCombo(pack.combo, folder, templateId, tplName, sourceFile, '', combos);
                        paintZoneRowCombo(row, pack);
                        byKey[key] = row;
                        order.push(key);
                    }
                }
                singles.forEach(function (f) {
                    const uk = ungroupedSheetKeyOf(f);
                    const key = materialZoneRowKey(folderId, templateId, sourceFile, uk);
                    if (!byKey[key]) {
                        const row = emptyZoneRowFromCombo(pack.combo, folder, templateId, tplName, sourceFile, uk, combos);
                        paintZoneRowCombo(row, pack);
                        addSheetFileToZoneRow(row, f);
                        byKey[key] = row;
                        order.push(key);
                    }
                });
            });
        });
        (applyRows || []).forEach(function (r) {
            const folder = r.material_folders || {};
            const folderId = folder.id || '';
            const templateId = r.extraction_template_id || '';
            const sourceFile = normalizeSourceFileName(r.source_file_name);
            const sheetKey = ungroupedSheetKeyOf(r);
            let existingKeys = zoneKeysForSheet(byKey, folderId, templateId, sheetKey, r.id);
            if (!existingKeys.length) {
                combosForSheet(combos, folderId, templateId, r.id ? [r.id] : []).forEach(function (c) {
                    const pack = packOfCombo(c);
                    const key = materialZoneRowKey(folderId, templateId, sourceFile, sheetKey);
                    if (!byKey[key]) {
                        const row = emptyZoneRowFromCombo(
                            c,
                            folder,
                            templateId,
                            (c.material_templates && c.material_templates.name) || templateNameById(templateId),
                            sourceFile,
                            sheetKey,
                            combos
                        );
                        paintZoneRowCombo(row, pack);
                        byKey[key] = row;
                        order.push(key);
                    }
                });
                existingKeys = zoneKeysForSheet(byKey, folderId, templateId, sheetKey, r.id);
            }
            const keys = existingKeys.length ? existingKeys : [materialZoneRowKey(folderId, templateId, sourceFile, sheetKey)];
            keys.forEach(function (key) {
                if (!byKey[key]) {
                    const row = emptyZoneRowFromCombo(
                        null,
                        folder,
                        templateId,
                        (r.material_templates && r.material_templates.name) || templateNameById(templateId),
                        sourceFile,
                        sheetKey,
                        combos
                    );
                    byKey[key] = row;
                    order.push(key);
                }
                const row = byKey[key];
                if (sourceFile && !row.sourceFile) row.sourceFile = sourceFile;
                addSheetFileToZoneRow(row, {
                    id: r.id,
                    stem: r.sheet_stem || '',
                    meta: r.meta_file_name || '',
                    script: r.script_file_name || '',
                    sourceFile: sourceFile,
                    is_group: r.is_group === true
                });
            });
        });
        let rows = order.map(function (k) { return byKey[k]; });
        mergeLinkedComboSheetsIntoZoneRows(rows, combos);
        rows = explodeUngroupedZoneRows(rows);
        const sorted = rows.map(function (row) {
            row.sheetStems = collapseRelatedSheetStems(row.sheetStems);
            row.sheetFiles = collapseRelatedSheetFiles(row.sheetFiles);
            row.sheetFiles.sort(function (a, b) {
                return String(a.stem || '').localeCompare(String(b.stem || ''), 'zh-Hant');
            });
            const own = row.comboId
                ? (combos || []).find(function (c) { return String(c.id) === String(row.comboId); })
                : null;
            const pack = own ? packOfCombo(own) : zoneDisplayCombo(
                combos,
                row.folderId,
                row.templateId,
                resolvedSourceFile(row),
                row.sheetDbIds,
                row.examTemplateIds || []
            );
            paintZoneRowCombo(row, pack);
            row.label = sourceLabelFromMap(row.sourceLabels, sourceLabelsMapKey(row));
            if (pack.combo) row.examTemplateIds = examIdsOfCombo(pack.combo);
            const stats = pack.combo ? statsMetaFilesForCombo(pack.combo) : [];
            row.statsMetaFiles = stats.map(function (f) { return f.meta; });
            row.metaCount = stats.length;
            const examOne = officialExamNames(row);
            row.defaultLabel = defaultMaterialZoneLabel(resolvedSourceFile(row), row.folderName, row.templateName, firstSheetStemOf(row), examOne.length === 1 ? examOne[0] : '');
            return row;
        }).sort(function (a, b) {
            const fa = String(a.folderName || '').localeCompare(String(b.folderName || ''), 'zh-Hant');
            if (fa) return fa;
            const ta = String(a.templateName || '').localeCompare(String(b.templateName || ''), 'zh-Hant');
            if (ta) return ta;
            const xa = String(a.sourceFile || '').localeCompare(String(b.sourceFile || ''), 'en', { numeric: true, sensitivity: 'base' });
            if (xa) return xa;
            const sa = String(a.sheetKey || '').localeCompare(String(b.sheetKey || ''), 'en', { numeric: true, sensitivity: 'base' });
            if (sa) return sa;
            const la = a.label || a.defaultLabel;
            const lb = b.label || b.defaultLabel;
            return String(la).localeCompare(String(lb), 'zh-Hant');
        });
        return sorted;
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

    function drivePdfFilesForTeacherFolder(folderName) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMaterialPdfOptions !== 'function') return [];
        const folderU = String(folderName || '').trim().toUpperCase();
        if (!folderU) return [];
        const seen = {};
        const out = [];
        (window.FeatureTimeline.getMaterialPdfOptions('', 'teacher') || []).forEach(function (o) {
            if (!o || String(o.folderName || '').trim().toUpperCase() !== folderU) return;
            const name = String(o.fileName || '').trim();
            if (!name || seen[name.toUpperCase()]) return;
            seen[name.toUpperCase()] = true;
            out.push({ name: name, fileId: o.fileId || '' });
        });
        return out;
    }

    function mzDrivePdfListHtml(folderName, hideIfEmpty) {
        const files = drivePdfFilesForTeacherFolder(folderName);
        if (!files.length) {
            return hideIfEmpty ? '' : '<div class="mz-drive-files" style="margin-top:8px; font-weight:700; color:#0F766E;">（這個資料夾目前沒列到 PDF）</div>';
        }
        return '<div class="mz-drive-files" style="margin-top:8px;">'
            + files.map(function (f) {
                return '<div style="font-weight:800; color:#134E4A;">📄 ' + esc(f.name) + '</div>';
            }).join('')
            + '</div>';
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
                defaultLabel: n,
                studentPdfFileId: '',
                studentPdfFileName: '',
                studentPdfPageMap: []
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

    function exactDriveMetasForTemplate(driveNames, templateName) {
        const token = templateFileToken(templateName);
        if (!token) return [];
        const suf = '.' + token + '.meta.json';
        const sufU = suf.toUpperCase();
        return (driveNames || []).filter(function (n) {
            const u = String(n || '').toUpperCase();
            return u.length > sufU.length && u.slice(-sufU.length) === sufU;
        });
    }

    function isShortPublishedMeta(fileName) {
        const typed = asTypedFileName(fileName);
        if (!typed || !/\.meta\.json$/i.test(typed)) return false;
        const body = typed.replace(/\.meta\.json$/i, '');
        return !!body && body.indexOf('.') < 0;
    }

    function shortDriveMetas(driveNames) {
        return (driveNames || []).filter(isShortPublishedMeta);
    }

    function sourceLooksLikeJson(name) {
        const n = String(name || '').trim();
        return /\.meta\.json$/i.test(n) || /\.json$/i.test(n);
    }

    function comboSourceFileOf(combo) {
        const links = Array.isArray(combo && combo.material_combination_sheets) ? combo.material_combination_sheets : [];
        let i;
        for (i = 0; i < links.length; i++) {
            const src = String(((links[i] && links[i].material_sheets) || {}).source_file_name || '').trim();
            if (src) return src;
        }
        return '';
    }

    /**
     * 這份套餐自己的雲端 meta：
     * 有 {活頁}.{這份擷取範本}.meta.json → 用那些。
     * 沒有、且來源是試算表（或這份現檔已是短檔 / 同夾隔壁來源是 json）→ {活頁}.meta.json 是這份產出的實況。
     * 來源已是 json → 短檔不是這份的。
     */
    function comboOwnsShortDriveFiles(opts) {
        opts = opts || {};
        if (sourceLooksLikeJson(opts.sourceFile)) return false;
        if ((opts.officialFiles || []).length) return false;
        if (sourceIsSpreadsheet(opts.sourceFile)) return true;
        if ((opts.storedMetas || []).some(isShortPublishedMeta)) return true;
        if (opts.hasExam) return false;
        if (opts.hasJsonSourceSibling) return true;
        if (opts.onlyComboInFolder) return true;
        if (opts.hasExistingSheets && !sourceLooksLikeJson(opts.sourceFile)) return true;
        return false;
    }

    function comboOwnDriveMetas(driveNames, templateName, opts) {
        const official = exactDriveMetasForTemplate(driveNames, templateName);
        if (official.length) return official;
        if (!comboOwnsShortDriveFiles(Object.assign({}, opts, { officialFiles: official }))) return [];
        return shortDriveMetas(driveNames);
    }

    function liveStemOfExactMeta(fileName, templateName) {
        if (mf() && typeof mf().liveSheetName === 'function') {
            return mf().liveSheetName(fileName, templateName);
        }
        return sheetKeyFromStem(String(fileName || '').replace(/\.meta\.json$/i, ''));
    }

    /**
     * 依這份套餐自己的雲端現檔補活頁列。
     * Excel 產出＝短檔 {活頁}.meta.json；json 再擷取＝{活頁}.{這份範本}.meta.json。
     * 不准改套隔壁範本那一筆，不准把短檔補進來源已是 json 的套餐。
     */
    async function repairSheetsFromExactDriveFiles(userId) {
        if (!userId || !window.supabaseClient) return;
        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            try {
                await window.FeatureTimeline.ensureMetaCatalog('', 'teacher', { force: true });
            } catch (_e) {}
        }
        const combos = await loadCombinations(userId);
        const templates = (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getTemplatesCachedSync === 'function')
            ? (window.FeatureTemplateLibrary.getTemplatesCachedSync() || [])
            : [];
        const byFolder = {};
        (combos || []).forEach(function (c) {
            const folder = c.material_folders || {};
            const fid = String(c.material_folder_id || folder.id || '');
            if (!fid) return;
            if (!byFolder[fid]) {
                byFolder[fid] = {
                    folder: folder,
                    folderId: fid,
                    combos: [],
                    classIds: []
                };
            }
            byFolder[fid].combos.push(c);
            (c.class_material_combinations || []).forEach(function (a) {
                if (a && a.class_id && byFolder[fid].classIds.indexOf(a.class_id) === -1) {
                    byFolder[fid].classIds.push(a.class_id);
                }
            });
        });
        const folderIds = Object.keys(byFolder);
        for (let fi = 0; fi < folderIds.length; fi++) {
            const pack = byFolder[folderIds[fi]];
            const folderName = String((pack.folder && pack.folder.folder_name) || '').trim();
            const rootKind = pack.folder && pack.folder.root_kind === 'class' ? 'class' : 'teacher';
            const classId = (pack.folder && pack.folder.class_id) || '';
            const driveNames = driveFileNamesForFolder(folderName, rootKind, classId);
            if (!folderName || !driveNames.length) continue;
            const inheritedGroup = await inheritFolderGroupFlag(pack.folderId);
            const folderGrouped = inheritedGroup || pack.combos.some(function (c) {
                return comboLinkedSheetFiles(c).some(function (s) { return s && s.is_group === true; });
            });
            const seenTpl = {};
            const jsonSibling = pack.combos.some(function (c) {
                return sourceLooksLikeJson(comboSourceFileOf(c));
            });
            pack.combos.forEach(function (c) {
                seenTpl[String(c.extraction_template_id || '')] = true;
            });
            templates.forEach(function (t) {
                if (!t || !t.id || seenTpl[String(t.id)]) return;
                const tName = String(t.name || '').trim();
                if (!tName || !exactDriveMetasForTemplate(driveNames, tName).length) return;
                pack.combos.push({
                    id: '',
                    extraction_template_id: t.id,
                    material_folder_id: pack.folderId,
                    material_folders: pack.folder,
                    material_templates: { id: t.id, name: tName },
                    _createFromDrive: true,
                    _templateObj: t
                });
                seenTpl[String(t.id)] = true;
            });
            for (let ci = 0; ci < pack.combos.length; ci++) {
                const combo = pack.combos[ci];
                const tplId = String(combo.extraction_template_id || '');
                const tplName = (combo.material_templates && combo.material_templates.name) || templateNameById(tplId);
                const src = comboSourceFileOf(combo);
                const storedMetas = comboLinkedSheetFiles(combo).map(function (s) { return s.meta; });
                const files = comboOwnDriveMetas(driveNames, tplName, {
                    sourceFile: src,
                    storedMetas: storedMetas,
                    hasJsonSourceSibling: jsonSibling,
                    onlyComboInFolder: pack.combos.length === 1,
                    hasExam: !!(combo.material_combination_exam_templates || []).some(function (l) {
                        return l && l.exam_template_id;
                    }),
                    hasExistingSheets: comboLinkedSheetFiles(combo).length > 0
                });
                if (!tplId || !files.length) continue;
                const allowShort = !exactDriveMetasForTemplate(driveNames, tplName).length;
                let comboId = combo.id;
                if (!comboId) {
                    comboId = await ensureCombination(userId, {
                        material_folder_id: pack.folderId,
                        extraction_template_id: tplId,
                        source_file: src,
                        sheet_db_ids: []
                    }, null);
                    combo.id = comboId;
                    const tplObj = combo._templateObj;
                    if (comboId && tplObj && tplObj.is_exam_role) {
                        await setComboExamTemplates(comboId, [tplId]);
                    }
                }
                const mixedCombo = comboSourceKeys(combo).length > 1;
                const { data: existing, error: readErr } = await window.supabaseClient
                    .from('material_sheets')
                    .select('id, sheet_stem, meta_file_name, is_group, source_file_name')
                    .eq('material_folder_id', pack.folderId)
                    .eq('extraction_template_id', tplId);
                if (readErr) throw readErr;
                const byStem = {};
                (existing || []).forEach(function (s) {
                    const live = liveStemOfExactMeta(s.sheet_stem, tplName).toUpperCase();
                    if (live) byStem[live] = s;
                });
                const comboGrouped = (existing || []).some(function (s) { return s && s.is_group === true; }) || folderGrouped;
                const ids = [];
                const wantSrc = sourceFileKey(src);
                for (let si = 0; si < files.length; si++) {
                    const file = files[si];
                    const live = liveStemOfExactMeta(file, tplName);
                    if (!live) continue;
                    const hit = byStem[live.toUpperCase()];
                    const scriptWant = allowShort
                        ? (live + '.script.txt')
                        : (live + '.' + templateFileToken(tplName) + '.script.txt');
                    const hasScript = driveNames.some(function (n) {
                        return String(n || '').toUpperCase() === scriptWant.toUpperCase();
                    });
                    if (hit) {
                        const hitSrc = sourceFileKey(hit.source_file_name);
                        if (hitSrc !== MZ_NO_SOURCE_KEY && hitSrc !== wantSrc) continue;
                        ids.push(hit.id);
                        const patch = { updated_at: new Date().toISOString() };
                        if (String(hit.sheet_stem || '') !== live) patch.sheet_stem = live;
                        if (String(hit.meta_file_name || '') !== file) patch.meta_file_name = file;
                        if (hasScript) patch.script_file_name = scriptWant;
                        if (comboGrouped && hit.is_group !== true) patch.is_group = true;
                        if (src && !String(hit.source_file_name || '').trim()) patch.source_file_name = src;
                        if (Object.keys(patch).length > 1) {
                            const { error: upErr } = await window.supabaseClient
                                .from('material_sheets').update(patch).eq('id', hit.id);
                            if (upErr) throw upErr;
                        }
                    } else {
                        const insert = {
                            material_folder_id: pack.folderId,
                            extraction_template_id: tplId,
                            sheet_stem: live,
                            meta_file_name: file,
                            is_group: comboGrouped === true,
                            updated_at: new Date().toISOString()
                        };
                        if (hasScript) insert.script_file_name = scriptWant;
                        if (src) insert.source_file_name = src;
                        const { data: inserted, error: insErr } = await window.supabaseClient
                            .from('material_sheets').insert(insert).select('id').single();
                        if (insErr) throw insErr;
                        if (inserted && inserted.id) ids.push(inserted.id);
                    }
                }
                if (comboId && ids.length && !mixedCombo) {
                    await ensureCombination(userId, {
                        material_folder_id: pack.folderId,
                        extraction_template_id: tplId,
                        source_file: src,
                        sheet_db_ids: ids
                    }, null);
                }
            }
        }
    }

    /**
     * 活頁名＝去掉 .{這份擷取範本}。別稱若只是「活頁名.這份擷取範本」＝遺毒，改回活頁名。
     * 全站每一本同一把，不是只修畫面上看得到的那幾列。老師自己寫的別稱不動。
     */
    async function repairPoisonedSheetIdentities(userId) {
        if (!userId || !window.supabaseClient) return;
        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.fetchTemplates === 'function') {
            try {
                await window.FeatureTemplateLibrary.fetchTemplates(false);
            } catch (_e) {}
        }
        if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
            await window.MaterialNameMap.ensureLoaded(false);
        }
        const { data: folders, error: folderErr } = await window.supabaseClient
            .from('material_folders')
            .select('id')
            .eq('teacher_id', userId);
        if (folderErr) throw folderErr;
        const folderIds = (folders || []).map(function (f) { return f.id; }).filter(Boolean);
        if (!folderIds.length) return;
        const { data: sheets, error: sheetErr } = await window.supabaseClient
            .from('material_sheets')
            .select('id, material_folder_id, sheet_stem, extraction_template_id')
            .in('material_folder_id', folderIds);
        if (sheetErr) throw sheetErr;
        const FN = mf();
        for (let i = 0; i < (sheets || []).length; i++) {
            const sh = sheets[i];
            const tplName = templateNameById(sh.extraction_template_id);
            if (!tplName) continue;
            const raw = String(sh.sheet_stem || '').trim();
            const live = (FN && typeof FN.liveSheetName === 'function')
                ? FN.liveSheetName(raw, tplName)
                : raw;
            if (!live) continue;
            if (raw !== live) {
                const { error: upErr } = await window.supabaseClient
                    .from('material_sheets')
                    .update({ sheet_stem: live, updated_at: new Date().toISOString() })
                    .eq('id', sh.id);
                if (upErr && !/uq_material_sheets_folder_stem/i.test(upErr.message || '')) {
                    throw upErr;
                }
                if (!upErr && window.MaterialNameMap && typeof window.MaterialNameMap.recordAlias === 'function') {
                    try {
                        await window.MaterialNameMap.recordAlias({
                            kind: 'sheet_stem',
                            alias: raw,
                            currentLabel: live,
                            materialFolderId: sh.material_folder_id,
                            materialSheetId: sh.id
                        });
                    } catch (_mapErr) {}
                }
            }
            if (window.MaterialNameMap && typeof window.MaterialNameMap.unpoisonSheetLabels === 'function') {
                await window.MaterialNameMap.unpoisonSheetLabels({
                    sheetId: sh.id,
                    live: live,
                    templateName: tplName
                });
            }
        }
    }

    async function listMaterialZoneRows() {
        const userId = await getCurrentUserId();
        if (!userId) return [];
        if (_materialZoneRowsCache) return _materialZoneRowsCache;
        const statRows = await loadTeacherComboStatistics(false);
        const driveFolders = await teacherDriveFolderNames();
        _materialZoneRowsCache = appendUnusedDriveFolderRows(buildMaterialZoneRowsFromStats(statRows), driveFolders);
        return _materialZoneRowsCache;
    }

    async function updateMaterialZoneLabel(row, label) {
        const userId = await getCurrentUserId();
        if (!userId) throw new Error('尚未登入');
        if (!row || !row.folderId || !row.templateId) throw new Error('找不到這本教材，無法改名');
        const name = String(label || '').trim();
        if (!row.sourceFile) row.sourceFile = resolvedSourceFile(row);
        let comboId = row.comboId || '';
        if (!comboId) {
            const combos = await loadCombinations(userId);
            const hit = pickComboForCard(
                combos,
                row.folderId,
                row.templateId,
                row.sourceFile,
                row.sheetDbIds || [],
                row.examTemplateIds || []
            );
            comboId = hit && hit.id ? hit.id : '';
        }
        const ids = (row.siblingIds && row.siblingIds.length) ? row.siblingIds.slice() : [];
        if (comboId && ids.indexOf(comboId) === -1) ids.unshift(comboId);
        if (!ids.length) throw new Error('找不到這份套餐，無法改名');
        const { error } = await window.supabaseClient
            .from('material_combinations')
            .update({
                label: name || null,
                updated_at: new Date().toISOString()
            })
            .in('id', ids);
        if (error) throw error;
        row.comboId = ids[0];
        row.siblingIds = ids;
        row.label = name || '';
        row.comboLabel = name || '';
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
        const comboIds = ((row && row.siblingIds) || []).slice();
        if (comboId && comboIds.indexOf(comboId) === -1) comboIds.unshift(comboId);
        if (!comboIds.length && comboId) comboIds.push(comboId);
        for (let i = 0; i < comboIds.length; i++) {
            const id = comboIds[i];
            const { data: existing, error } = await window.supabaseClient
                .from('class_material_combinations')
                .select('id, class_id')
                .eq('material_combination_id', id);
            if (error) throw error;
            const have = {};
            (existing || []).forEach(function (a) {
                have[String(a.class_id)] = a.id;
            });
            const toRemove = Object.keys(have).filter(function (cid) { return !wanted[cid]; });
            const toAdd = Object.keys(wanted).filter(function (cid) { return !have[cid]; });
            for (let j = 0; j < toRemove.length; j++) {
                await removeAssignment(have[toRemove[j]]);
            }
            if (toAdd.length) await assignToClasses(id, toAdd, userId);
        }
    }

    async function saveMaterialZoneCard(row, cardEl, groupRows) {
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
        const comboId = await updateMaterialZoneLabel(row, typed);
        const sourceEl = cardEl.querySelector('.mz-source-file');
        await updateMaterialZoneSourceFile(row, sourceEl && sourceEl.value);
        await setComboExamTemplates(comboId, examIds);
        await syncMaterialZoneClassAssignments(comboId, row, classIds, userId);
        const pdfHost = (cardEl && cardEl.closest && cardEl.closest('.mz-group')) || cardEl;
        const sameGroup = (groupRows || []).filter(function (r) {
            return r && !r.unused && materialZoneGroupKey(r) === materialZoneGroupKey(row);
        });
        const pdfComboIds = [comboId].concat(sameGroup.map(function (r) { return r.comboId; }).filter(function (id) {
            return id && id !== comboId;
        }));
        await saveMaterialZoneStudentPdfToCombos(pdfComboIds, pdfHost);
        const refreshIds = ((row.siblingIds || []).concat(pdfComboIds, [comboId])).filter(Boolean);
        await refreshComboStatisticsIds(refreshIds);
        invalidateSuggestionCache();
        await loadTeacherComboStatistics(true);
    }

    function materialZoneGroupKey(row) {
        if (!row) return '';
        if (row.unused) return 'unused|' + String(row.folderName || '').trim().toUpperCase();
        return String(row.folderId || '') || ('folder|' + String(row.folderName || '').trim().toUpperCase());
    }

    function groupMaterialZoneRows(rows) {
        const by = {};
        const order = [];
        (rows || []).forEach(function (row) {
            const gk = materialZoneGroupKey(row);
            if (!gk) return;
            if (!by[gk]) {
                by[gk] = { key: gk, unused: !!row.unused, rows: [] };
                order.push(gk);
            }
            by[gk].rows.push(row);
        });
        return order.map(function (k) {
            const g = by[k];
            g.rows.sort(function (a, b) {
                const ta = String(a.templateName || '').localeCompare(String(b.templateName || ''), 'zh-Hant');
                if (ta) return ta;
                return String(a.sheetKey || a.sourceFile || '').localeCompare(String(b.sheetKey || b.sourceFile || ''), 'en', { numeric: true, sensitivity: 'base' });
            });
            const first = g.rows[0] || {};
            g.folderName = first.folderName || '';
            return g;
        });
    }

    function renderMaterialZoneUnusedHtml(row) {
        const name = (row && row.folderName) || '';
        const siblingHtml = (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.renderFolderHtml === 'function')
            ? window.MaterialComboStrategies.renderFolderHtml(name, { zoneRows: [] })
            : '';
        return (
            '<div class="mz-group" data-group-key="' + esc((row && row.key) || '') + '">'
            + '<div class="mz-folder-line" style="font-weight:800; color:#0E7490;">教材　資料夾　' + esc(name || '（未知名資料夾）') + '</div>'
            + siblingHtml
            + '</div>'
        );
    }

    function sheetKeysForRow(row) {
        const keys = [];
        const seen = {};
        function add(raw) {
            const k = sheetKeyFromStem(String(raw || '').replace(/\.meta\.json$/i, ''));
            const u = k.toUpperCase();
            if (!k || seen[u]) return;
            seen[u] = true;
            keys.push(k);
        }
        (row && row.sheetStems || []).forEach(add);
        (row && row.sheetFiles || []).forEach(function (f) { add(f && f.stem); });
        keys.sort(function (a, b) {
            return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
        });
        return keys;
    }

    function comboLabelLooksMashed(named, keys) {
        const label = String(named || '').trim();
        if (!label || !keys || keys.length < 2) return false;
        const keySet = {};
        keys.forEach(function (k) {
            const u = String(k || '').trim().toUpperCase();
            if (u) keySet[u] = true;
        });
        const parts = label.split(/[\s,、／/|~～\-]+/).map(function (p) {
            return String(p || '').trim();
        }).filter(Boolean);
        if (parts.length < 2) return false;
        let hits = 0;
        parts.forEach(function (p) {
            if (keySet[p.toUpperCase()]) hits++;
        });
        return hits >= 2 && hits === parts.length;
    }

    function comboNameForRow(row) {
        const named = String((row && row.comboLabel) || '').trim();
        if (named) return named;
        const examNames = officialExamNames(row);
        return defaultComboLabel(
            firstSheetStemOf(row),
            (row && row.templateName) || '',
            examNames.length === 1 ? examNames[0] : ''
        );
    }

    function officialExamNames(row) {
        const examNames = [];
        const seen = {};
        ((row && row.examTemplateIds) || []).forEach(function (id) {
            const n = String(templateNameById(id) || '').trim();
            const u = n.toUpperCase();
            if (!n || seen[u]) return;
            seen[u] = true;
            examNames.push(n);
        });
        return examNames;
    }

    function renameTabRoleLines(row) {
        return {
            extract: String((row && row.templateName) || '').trim(),
            exam: officialExamNames(row).join('、')
        };
    }

    function sheetDisplayName(file, templateName) {
        const raw = String((file && (file.lockedName || file.stem)) || '').trim();
        if (mf() && typeof mf().liveSheetName === 'function') {
            return mf().liveSheetName(raw, templateName) || raw;
        }
        return raw;
    }

    function roleTagItemsForFiles(row, files) {
        const lines = renameTabRoleLines(row);
        const tpl = String((row && row.templateName) || '').trim();
        return (files || []).map(function (f) {
            return {
                name: sheetDisplayName(f, tpl),
                extract: lines.extract,
                exam: lines.exam,
                isGroup: f && f.is_group === true
            };
        });
    }

    function renameRoleTagInnerHtml(row, sheetName, files) {
        const FN = mf();
        const lines = renameTabRoleLines(row);
        let items = roleTagItemsForFiles(row, files);
        if (!items.length && String(sheetName || '').trim()) {
            items = [{
                name: String(sheetName).trim(),
                extract: lines.extract,
                exam: lines.exam,
                isGroup: false
            }];
        }
        if (FN && typeof FN.roleTagsHtml === 'function') {
            return FN.roleTagsHtml(items);
        }
        if (FN && typeof FN.groupRoleTagItems === 'function' && typeof FN.roleTagHtmlFromGroup === 'function') {
            return FN.groupRoleTagItems(items).map(function (g) {
                return FN.roleTagHtmlFromGroup(g);
            }).join('');
        }
        return items.map(function (it) {
            const name = String((it && it.name) || '').trim();
            if (FN && typeof FN.roleTagHtml === 'function') {
                return FN.roleTagHtml(name, lines.extract, lines.exam);
            }
            return '<span style="display:block;">' + esc(name) + '</span>'
                + '<span style="display:block;">擷取範本' + (lines.extract ? ' ' + esc(lines.extract) : '') + '</span>'
                + '<span style="display:block;">試卷範本' + (lines.exam ? ' ' + esc(lines.exam) : '') + '</span>';
        }).join('');
    }

    function renameTabButtonHtml(row, sheetName, i, on, files) {
        return (
            '<button type="button" class="mz-rf-tab" data-pane="' + i + '" style="display:flex; flex-wrap:wrap; gap:6px; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.74rem; line-height:1.4; text-align:left; cursor:pointer; border:1px solid '
            + (on ? '#0F766E' : '#99F6E4') + '; background:' + (on ? '#0F766E' : '#F0FDFA') + '; color:' + (on ? 'white' : '#115E59') + ';">'
            + renameRoleTagInnerHtml(row, sheetName, files)
            + '</button>'
        );
    }

    function splitRenamePanesByGroup(cardPanes) {
        const out = [];
        (cardPanes || []).forEach(function (card) {
            const files = card.files || [];
            const grouped = files.filter(function (f) { return f && f.is_group === true; });
            const singles = files.filter(function (f) { return !f || f.is_group !== true; });
            if (grouped.length) out.push({ row: card.row, files: grouped });
            singles.forEach(function (f) {
                out.push({ row: card.row, files: [f] });
            });
        });
        return out;
    }

    function examIdsForChildRender(row) {
        return ((row && row.examTemplateIds) || []).slice();
    }

    function pdfMapRowHtml(m, canDelete) {
        const row = (window.MaterialPdfPageMap && typeof window.MaterialPdfPageMap.normalize === 'function')
            ? window.MaterialPdfPageMap.normalize([m])[0]
            : (m || { range_type: 'page', book_start: '', book_end: '', pdf_start: '', pdf_end: '' });
        return (
            '<div class="mz-pdf-map-row" style="display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; margin-top:6px;">'
            + '<div><label style="display:block; font-size:0.7rem; font-weight:800; color:#9A3412;">基準</label>'
            + '<select class="mz-pdf-rtype form-control" style="padding:4px; min-width:72px;">'
            + '<option value="page"' + (row.range_type === 'qnum' ? '' : ' selected') + '>頁碼</option>'
            + '<option value="qnum"' + (row.range_type === 'qnum' ? ' selected' : '') + '>題號</option>'
            + '</select></div>'
            + '<div><label style="display:block; font-size:0.7rem; font-weight:800; color:#9A3412;">課本起</label>'
            + '<input type="number" class="mz-pdf-book-start form-control" value="' + esc(row.book_start) + '" style="width:64px; padding:4px;"></div>'
            + '<div><label style="display:block; font-size:0.7rem; font-weight:800; color:#9A3412;">課本迄</label>'
            + '<input type="number" class="mz-pdf-book-end form-control" value="' + esc(row.book_end) + '" style="width:64px; padding:4px;"></div>'
            + '<div><label style="display:block; font-size:0.7rem; font-weight:800; color:#9A3412;">PDF 起</label>'
            + '<input type="number" class="mz-pdf-pdf-start form-control" value="' + esc(row.pdf_start) + '" style="width:64px; padding:4px;"></div>'
            + '<div><label style="display:block; font-size:0.7rem; font-weight:800; color:#9A3412;">PDF 迄</label>'
            + '<input type="number" class="mz-pdf-pdf-end form-control" value="' + esc(row.pdf_end) + '" style="width:64px; padding:4px;"></div>'
            + (canDelete
                ? '<button type="button" class="mz-pdf-del-map btn" style="padding:4px 8px; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; font-weight:800;">刪</button>'
                : '')
            + '</div>'
        );
    }

    function studentPdfBlockHtml(row) {
        const fileName = String((row && row.studentPdfFileName) || '').trim();
        const fileId = String((row && row.studentPdfFileId) || '').trim();
        const maps = (window.MaterialPdfPageMap && typeof window.MaterialPdfPageMap.normalize === 'function')
            ? window.MaterialPdfPageMap.normalize(row && row.studentPdfPageMap)
            : [{ range_type: 'page', book_start: '', book_end: '', pdf_start: '', pdf_end: '' }];
        const mapHtml = maps.map(function (m) {
            return pdfMapRowHtml(m, maps.length > 1);
        }).join('');
        return (
            '<div class="mz-pdf-block" style="margin-top:12px; padding-top:10px; border-top:1px dashed #FDBA74;">'
            + '<div style="font-size:0.76rem; font-weight:800; color:#C2410C; margin-bottom:4px;">學生文稿 PDF（這本教材共用一份；檔案頁 ≠ 課本頁）</div>'
            + '<div style="font-size:0.72rem; color:#9A3412; font-weight:700; line-height:1.45; margin-bottom:8px;">錄音指定的是課本頁／題號。這裡上傳 PDF，並寫「課本這段對檔案哪幾頁」。沒對到就不顯示，不准猜。儲存後寫進下面每一個套餐。</div>'
            + '<input type="hidden" class="mz-pdf-file-id" value="' + esc(fileId) + '">'
            + '<input type="hidden" class="mz-pdf-file-name" value="' + esc(fileName) + '">'
            + '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<label class="btn" style="padding:4px 10px; background:#FFF7ED; color:#9A3412; border:1px solid #FDBA74; font-weight:800; font-size:0.76rem; cursor:pointer;">選擇 PDF'
            + '<input type="file" class="mz-pdf-file" accept="application/pdf,.pdf" style="display:none;"></label>'
            + '<span class="mz-pdf-name" style="font-size:0.76rem; font-weight:700; color:#7C2D12;">' + (fileName ? esc(fileName) : '尚未上傳') + '</span>'
            + '</div>'
            + '<div class="mz-pdf-map-list">' + mapHtml + '</div>'
            + '<button type="button" class="mz-pdf-add-map btn" style="margin-top:8px; padding:4px 10px; background:#FFF7ED; color:#9A3412; border:1px solid #FDBA74; font-weight:800; font-size:0.74rem;">＋ 增加對照</button>'
            + '</div>'
        );
    }

    function readStudentPdfFromCard(cardEl) {
        const fileIdEl = cardEl && cardEl.querySelector('.mz-pdf-file-id');
        const fileNameEl = cardEl && cardEl.querySelector('.mz-pdf-file-name');
        const rows = [];
        Array.prototype.forEach.call((cardEl && cardEl.querySelectorAll('.mz-pdf-map-row')) || [], function (el) {
            rows.push({
                range_type: (el.querySelector('.mz-pdf-rtype') && el.querySelector('.mz-pdf-rtype').value === 'qnum') ? 'qnum' : 'page',
                book_start: el.querySelector('.mz-pdf-book-start') ? String(el.querySelector('.mz-pdf-book-start').value || '').trim() : '',
                book_end: el.querySelector('.mz-pdf-book-end') ? String(el.querySelector('.mz-pdf-book-end').value || '').trim() : '',
                pdf_start: el.querySelector('.mz-pdf-pdf-start') ? String(el.querySelector('.mz-pdf-pdf-start').value || '').trim() : '',
                pdf_end: el.querySelector('.mz-pdf-pdf-end') ? String(el.querySelector('.mz-pdf-pdf-end').value || '').trim() : ''
            });
        });
        return {
            student_pdf_file_id: fileIdEl ? (String(fileIdEl.value || '').trim() || null) : null,
            student_pdf_file_name: fileNameEl ? String(fileNameEl.value || '').trim() : '',
            student_pdf_page_map: rows
        };
    }

    async function saveMaterialZoneStudentPdfToCombos(comboIds, hostEl) {
        const ids = [];
        const seen = {};
        (comboIds || []).forEach(function (id) {
            const s = String(id || '').trim();
            if (!s || seen[s]) return;
            seen[s] = true;
            ids.push(s);
        });
        if (!ids.length || !hostEl || !hostEl.querySelector('.mz-pdf-block')) return;
        const patch = readStudentPdfFromCard(hostEl);
        patch.updated_at = new Date().toISOString();
        for (let i = 0; i < ids.length; i++) {
            const { error } = await window.supabaseClient
                .from('material_combinations')
                .update(patch)
                .eq('id', ids[i]);
            if (error && /student_pdf/i.test(error.message || '')) {
                throw new Error('資料庫還沒加上 PDF 對照欄，請先跑 migration 20260822020000');
            }
            if (error) throw error;
        }
    }

    async function resolveZoneDriveFolderId(row) {
        const folderName = String((row && row.folderName) || '').trim();
        if (!folderName) throw new Error('找不到教材資料夾名稱');
        const classId = (row && row.classId) || '';
        const rootKind = (row && row.rootKind) === 'class' ? 'class' : 'teacher';
        let folderId = (window.FeatureExamJob && typeof window.FeatureExamJob.getFolderIdForFolder === 'function')
            ? window.FeatureExamJob.getFolderIdForFolder(classId, rootKind, folderName)
            : '';
        if (folderId) return folderId;
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.resolveMaterialsRootFolderId !== 'function') {
            throw new Error('FeatureTimeline 尚未載入，無法找到教材資料夾');
        }
        if (!window.GasService || typeof window.GasService.ensureMaterialFolder !== 'function') {
            throw new Error('GasService.ensureMaterialFolder 尚未載入');
        }
        const rootFolderId = await window.FeatureTimeline.resolveMaterialsRootFolderId(classId, rootKind);
        const rootName = rootKind === 'class' ? '00_Class_Materials' : '01_My_Materials';
        const result = await window.GasService.ensureMaterialFolder(rootFolderId, rootName, folderName);
        if (!result || !result.folderId) throw new Error('找不到教材資料夾「' + folderName + '」');
        return result.folderId;
    }

    function readFileAsBase64(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const raw = String((e && e.target && e.target.result) || '');
                const parts = raw.split(',');
                resolve(parts.length > 1 ? parts[1] : raw);
            };
            reader.onerror = function () { reject(new Error('讀取檔案失敗')); };
            reader.readAsDataURL(file);
        });
    }

    function mzSourceRowHtml(value) {
        return (
            '<div class="mz-source-row">'
            + '<label>來源檔名（可手填）</label>'
            + '<input type="text" class="mz-source-file" value="' + esc(value || '') + '" placeholder="例如 10_GEPT-2.xlsx 或檔名.json" title="來源檔名">'
            + '</div>'
        );
    }

    function renderMaterialZoneChildHtml(row) {
        const examIds = examIdsForChildRender(row);
        const cardFiles = (row.sheetFiles || []);
        const roleLineHtml = '<div class="mz-role-tags-wrap" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; font-weight:800; color:#92400E;">'
            + renameRoleTagInnerHtml(row, '', cardFiles)
            + '</div>';
        const examHtml = examTemplateCheckboxesHtml('mz', examIds);
        const classHtml = classEditorCheckboxesHtml(row.classIds || []);
        const displayName = comboNameForRow(row);
        const sourceHtml = mzSourceRowHtml(row.sourceFile);
        return (
            '<div class="mz-card" data-key="' + esc(row.key) + '">'
            + '<label style="display:block; font-weight:800; color:#92400E; margin-bottom:2px;">Excel/JSON 套餐（出作業下拉會顯示這個）</label>'
            + '<input type="text" class="mz-label" data-key="' + esc(row.key) + '" value="' + esc(displayName) + '" placeholder="例如 GEPT-2 整句翻譯" title="Excel/JSON 套餐" style="font-weight:800; color:#78350F; margin-bottom:8px;">'
            + sourceHtml
            + roleLineHtml
            + '<div style="margin-top:10px; padding-top:10px; border-top:1px dashed #F59E0B;">'
            + '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">'
            + '<div style="font-weight:800; color:#6D28D9;">試卷範本（官方配對；沒有就留空，這份就不能出考卷）</div>'
            + '<button type="button" class="mz-new-exam-tpl btn" style="background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; border-radius:5px; cursor:pointer;">🧾 新增試卷範本</button>'
            + '</div>'
            + '<div class="mz-exam-box">' + examHtml + '</div>'
            + '</div>'
            + '<div style="margin-top:10px;">'
            + '<div style="font-weight:800; color:#15803D; margin-bottom:4px;">採用班級</div>'
            + '<div class="mz-class-box">' + classHtml + '</div>'
            + '</div>'
            + '<div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<button type="button" class="mz-save btn btn-primary" data-key="' + esc(row.key) + '" style="border-radius:6px; font-weight:800; cursor:pointer;">儲存設定</button>'
            + '<button type="button" class="mz-rename-files btn" data-key="' + esc(row.key) + '" style="border-radius:6px; border:1px solid #B45309; background:#FFFBEB; color:#92400E; font-weight:800; cursor:pointer;">改活頁／檔名</button>'
            + '<span class="mz-msg" style="font-weight:700;"></span>'
            + '</div>'
            + '</div>'
        );
    }

    function groupPdfFromRows(rows) {
        return (rows || []).find(function (r) {
            return r && (r.studentPdfFileId || (Array.isArray(r.studentPdfPageMap) && r.studentPdfPageMap.some(function (m) {
                return m && (m.book_start || m.pdf_start);
            })));
        }) || (rows && rows[0]) || {};
    }

    function renderMaterialZoneGroupHtml(group) {
        if (group.unused) {
            return renderMaterialZoneUnusedHtml(group.rows[0] || { folderName: group.folderName });
        }
        const folderLineHtml = '<div class="mz-folder-line" style="font-weight:800; color:#0E7490;">教材　資料夾　' + esc(group.folderName || '（未知名資料夾）') + '</div>';
        const siblingHtml = (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.renderFolderHtml === 'function')
            ? window.MaterialComboStrategies.renderFolderHtml(group.folderName, { zoneRows: group.rows || [] })
            : (group.rows || []).map(renderMaterialZoneChildHtml).join('');
        return (
            '<div class="mz-group" data-group-key="' + esc(group.key) + '">'
            + folderLineHtml
            + siblingHtml
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
        wrap.querySelectorAll('.mz-source-file').forEach(function (input) {
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
                    await saveMaterialZoneCard(row, card, rows);
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
                if (!row || btn.disabled) return;
                const oldLabel = btn.textContent;
                btn.disabled = true;
                btn.textContent = '讀取中…';
                openMaterialZoneFileRename(row, [row]).catch(function (err) {
                    window.showFlash && window.showFlash('❌ 無法開啟改名視窗：' + ((err && err.message) || err), 'error');
                }).then(function () {
                    btn.disabled = false;
                    btn.textContent = oldLabel;
                });
            });
        });
        wrap.querySelectorAll('.mz-new-exam-tpl').forEach(function (btn) {
            btn.addEventListener('click', openNewExamTemplateShortcut);
        });
        wrap.querySelectorAll('.mz-pdf-add-map').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const list = btn.parentElement && btn.parentElement.querySelector('.mz-pdf-map-list');
                if (!list) return;
                const hold = document.createElement('div');
                hold.innerHTML = pdfMapRowHtml({ range_type: 'page', book_start: '', book_end: '', pdf_start: '', pdf_end: '' }, true);
                const rowEl = hold.firstElementChild;
                list.appendChild(rowEl);
                list.querySelectorAll('.mz-pdf-map-row').forEach(function (el) {
                    if (el.querySelector('.mz-pdf-del-map')) return;
                    if (list.querySelectorAll('.mz-pdf-map-row').length > 1) {
                        const del = document.createElement('button');
                        del.type = 'button';
                        del.className = 'mz-pdf-del-map btn';
                        del.style.cssText = 'padding:4px 8px; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; font-weight:800;';
                        del.textContent = '刪';
                        el.appendChild(del);
                    }
                });
            });
        });
        wrap.addEventListener('click', function (ev) {
            const del = ev.target && ev.target.closest && ev.target.closest('.mz-pdf-del-map');
            if (!del) return;
            const list = del.closest('.mz-pdf-map-list');
            const rowEl = del.closest('.mz-pdf-map-row');
            if (!list || !rowEl) return;
            if (list.querySelectorAll('.mz-pdf-map-row').length <= 1) return;
            rowEl.remove();
        });
        wrap.querySelectorAll('.mz-save-pdf').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const group = btn.closest('.mz-group');
                const msgEl = group && group.querySelector('.mz-pdf-msg');
                const comboIds = comboIdsInGroupEl(group, rows);
                if (!group || !comboIds.length) {
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 這本還沒有可寫入的套餐'; }
                    return;
                }
                btn.disabled = true;
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
                try {
                    await saveMaterialZoneStudentPdfToCombos(comboIds, group);
                    if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '✅ 已寫進這本全部套餐'; }
                    window.showFlash && window.showFlash('✅ 已儲存這本 PDF 對照', 'success');
                } catch (err) {
                    console.error('[FeatureClassMaterialCombinations] PDF 對照儲存失敗', err);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ ' + (err.message || err); }
                    window.showFlash && window.showFlash('❌ 儲存失敗：' + (err.message || err), 'error');
                }
                btn.disabled = false;
            });
        });
        wrap.querySelectorAll('.mz-pdf-file').forEach(function (input) {
            input.addEventListener('change', async function () {
                const file = input.files && input.files[0];
                input.value = '';
                if (!file) return;
                const group = input.closest('.mz-group');
                const row = firstRowInGroupEl(group, rows);
                const nameEl = group && group.querySelector('.mz-pdf-name');
                const idEl = group && group.querySelector('.mz-pdf-file-id');
                const fnEl = group && group.querySelector('.mz-pdf-file-name');
                if (!row || !group) return;
                if (nameEl) nameEl.textContent = '上傳中…';
                try {
                    if (!window.GasService || typeof window.GasService.uploadMaterialFile !== 'function') {
                        throw new Error('GasService.uploadMaterialFile 尚未載入');
                    }
                    const folderId = await resolveZoneDriveFolderId(row);
                    const base64 = await readFileAsBase64(file);
                    const res = await window.GasService.uploadMaterialFile(base64, file.name, file.type || 'application/pdf', folderId);
                    const fileId = res && res.fileId;
                    const finalName = (res && res.finalFileName) || file.name;
                    if (!fileId) throw new Error('上傳成功但沒有檔案 id');
                    if (idEl) idEl.value = fileId;
                    if (fnEl) fnEl.value = finalName;
                    if (nameEl) nameEl.textContent = finalName + '（記得按儲存這本 PDF 對照）';
                } catch (err) {
                    if (nameEl) nameEl.textContent = '上傳失敗：' + ((err && err.message) || err);
                }
            });
        });
    }

    function rowsInGroupEl(groupEl, rows) {
        const gk = groupEl && groupEl.getAttribute && groupEl.getAttribute('data-group-key');
        if (!gk) return [];
        return (rows || []).filter(function (r) {
            return r && !r.unused && materialZoneGroupKey(r) === gk;
        });
    }

    function firstRowInGroupEl(groupEl, rows) {
        return rowsInGroupEl(groupEl, rows)[0] || null;
    }

    function comboIdsInGroupEl(groupEl, rows) {
        return rowsInGroupEl(groupEl, rows).map(function (r) { return r.comboId; }).filter(Boolean);
    }

    function sheetKeyFromStem(stem) {
        const s = String(stem || '').trim();
        if (!s) return '';
        return s.split('.')[0] || s;
    }

    /** 兩欄同一把尺：見 020_js_core/material-file-names.js（meta 鎖 .meta.json、文稿鎖 .script.txt）。 */
    function mf() {
        return window.MaterialFileNames || null;
    }

    function asTypedFileName(typed) {
        return mf() ? mf().typed(typed) : String(typed || '').replace(/^__mzren__/i, '').trim();
    }

    function stripLockedExt(name, ext) {
        return mf() ? mf().stripExt(name, ext) : asTypedFileName(name);
    }

    function withLockedExt(base, ext) {
        return mf() ? mf().withExt(base, ext) : asTypedFileName(base);
    }

    function fileHasLockedExt(fileName, ext) {
        const typed = asTypedFileName(fileName);
        if (!typed || !ext) return false;
        const body = stripLockedExt(typed, ext);
        return !!(body && body.toUpperCase() !== typed.toUpperCase());
    }

    function scriptNameBesideMeta(metaName) {
        const body = stripLockedExt(metaName, META_LOCKED_EXT);
        return body ? withLockedExt(body, SCRIPT_LOCKED_EXT) : '';
    }

    const META_LOCKED_EXT = (mf() && mf().META_EXT) || '.meta.json';
    const SCRIPT_LOCKED_EXT = (mf() && mf().SCRIPT_EXT) || '.script.txt';

    function driveFileNamesForFolder(folderName, rootKind, classId) {
        if (window.FeatureExamJob && typeof window.FeatureExamJob.getRawFileNamesForFolder === 'function') {
            return (window.FeatureExamJob.getRawFileNamesForFolder(classId || '', rootKind || 'teacher', folderName) || [])
                .filter(Boolean);
        }
        return [];
    }

    function pickDriveNameExact(driveNames, storedName, used) {
        const want = asTypedFileName(storedName);
        if (!want) return '';
        const wantU = want.toUpperCase();
        for (let i = 0; i < (driveNames || []).length; i++) {
            const n = String(driveNames[i] || '');
            if (!n || used[n.toUpperCase()]) continue;
            if (n.toUpperCase() === wantU || asTypedFileName(n).toUpperCase() === wantU) {
                used[n.toUpperCase()] = true;
                return n;
            }
        }
        return '';
    }

    function templateFileToken(name) {
        return mf() && typeof mf().templateToken === 'function'
            ? mf().templateToken(name)
            : String(name || '').trim().replace(/[\\/]/g, '-');
    }

    function fileHasThisTemplateToken(fileName, templateName, ext) {
        const tpl = templateFileToken(templateName);
        const typed = asTypedFileName(fileName);
        if (!tpl || !typed) return false;
        const extU = String(ext || '').toUpperCase();
        const u = typed.toUpperCase();
        const body = (extU && u.slice(-extU.length) === extU) ? u.slice(0, u.length - extU.length) : u;
        return body.indexOf('.' + tpl.toUpperCase()) !== -1;
    }

    function liveNameOfFile(fileName, templateName) {
        if (mf() && typeof mf().liveSheetName === 'function') {
            return mf().liveSheetName(fileName, templateName);
        }
        return sheetKeyFromStem(fileName);
    }

    function folderHasSiblingTemplates(row) {
        const folderId = String((row && row.folderId) || '');
        const mine = String((row && row.templateId) || '');
        if (!folderId) return false;
        return (_materialZoneRowsCache || []).some(function (r) {
            return r && !r.unused
                && String(r.folderId || '') === folderId
                && String(r.templateId || '')
                && String(r.templateId || '') !== mine;
        });
    }

    function folderHasJsonSourceSibling(row) {
        const folderId = String((row && row.folderId) || '');
        const mine = String((row && row.templateId) || '');
        if (!folderId) return false;
        return (_materialZoneRowsCache || []).some(function (r) {
            return r && !r.unused
                && String(r.folderId || '') === folderId
                && String(r.templateId || '') !== mine
                && sourceLooksLikeJson(r.sourceFile);
        });
    }

    function sourceIsSpreadsheet(name) {
        return /\.(xlsx|xls|csv)$/i.test(String(name || ''));
    }

    function isShortLiveFile(fileName, live, ext) {
        const want = withLockedExt(live, ext);
        return !!(want && asTypedFileName(fileName).toUpperCase() === asTypedFileName(want).toUpperCase());
    }

    /**
     * 改檔名現檔＝雲端實況。這本活頁在 Drive 上現在叫什麼就顯示什麼。
     * 不是拿 {活頁}.{範本} 去對拍、對不到就空白。那條是出題／抽這份套餐自己的檔。
     * 同一活頁有多個檔：先這份擷取範本的那一個；這份擁有短檔時才顯示 {活頁}.ext。
     * 來源已是 json 的套餐不准顯示隔壁的 A.meta.json。
     */
    function pickDriveRealityName(driveNames, live, ext, used, templateName, allowShort) {
        const key = String(live || '').trim();
        if (!key) return '';
        const keyU = key.toUpperCase();
        const candidates = [];
        (driveNames || []).forEach(function (n) {
            const typed = asTypedFileName(n);
            if (!typed || used[n.toUpperCase()] || used[typed.toUpperCase()]) return;
            if (!fileHasLockedExt(typed, ext)) return;
            if (liveNameOfFile(typed, templateName).toUpperCase() !== keyU) return;
            candidates.push(n);
        });
        if (!candidates.length) return '';
        let i;
        for (i = 0; i < candidates.length; i++) {
            if (fileHasThisTemplateToken(candidates[i], templateName, ext)) {
                used[candidates[i].toUpperCase()] = true;
                return candidates[i];
            }
        }
        if (!allowShort) return '';
        const shortU = stripLockedExt(withLockedExt(key, ext), ext).toUpperCase();
        for (i = 0; i < candidates.length; i++) {
            if (stripLockedExt(candidates[i], ext).toUpperCase() === shortU) {
                used[candidates[i].toUpperCase()] = true;
                return candidates[i];
            }
        }
        return '';
    }

    /** 儲存改名只改這份套餐自己的檔。短檔只有擁有它的套餐能改。 */
    function canRenameDisplayedDriveFile(driveName, storedName, live, templateName, ext, allowShort) {
        if (!driveName) return false;
        if (fileHasThisTemplateToken(driveName, templateName, ext)) return true;
        const stored = asTypedFileName(storedName);
        const driveU = asTypedFileName(driveName).toUpperCase();
        if (stored && stored.toUpperCase() === driveU) return true;
        const storedExt = stored ? withLockedExt(stored, ext) : '';
        if (storedExt && asTypedFileName(storedExt).toUpperCase() === driveU) return true;
        return !!(allowShort && isShortLiveFile(driveName, live, ext));
    }

    function siblingRenameRows(startRow, allRows) {
        const gk = materialZoneGroupKey(startRow);
        if (!gk) return startRow ? [startRow] : [];
        const list = (allRows || []).filter(function (r) {
            return r && !r.unused && materialZoneGroupKey(r) === gk;
        });
        list.sort(function (a, b) {
            return String(a.templateName || '').localeCompare(String(b.templateName || ''), 'zh-Hant');
        });
        return list.length ? list : (startRow ? [startRow] : []);
    }

    function cloneRenameFiles(row) {
        return collapseRelatedSheetFiles((row.sheetFiles || []).map(function (f) {
            return {
                id: f.id,
                stem: f.stem || '',
                meta: f.meta || '',
                script: f.script || '',
                relatedIds: (f.relatedIds || []).slice(),
                is_group: f.is_group === true,
                dbStem: String(f.stem || '').trim(),
                dbMeta: String(f.meta || '').trim(),
                dbScript: String(f.script || '').trim(),
                driveMeta: '',
                driveScript: ''
            };
        }));
    }

    function paintRenameFileIdentities(row, files) {
        const templateName = String((row && row.templateName) || '').trim();
        (files || []).forEach(function (f) {
            const poison = String(f.dbStem || f.stem || '').trim();
            f.poisonStem = poison;
            f.lockedName = (mf() && typeof mf().resolveLiveSheet === 'function')
                ? mf().resolveLiveSheet(poison, f.meta, f.script, templateName)
                : poison;
            f.alias = currentSheetAlias(f.lockedName, f.id, templateName)
                || currentSheetAlias(poison, f.id, templateName)
                || f.lockedName;
        });
    }

    function renamePaneInnerHtml(row, files) {
        const FN = mf();
        const tpl = String((row && row.templateName) || '').trim();
        const rowsHtml = (files || []).map(function (f) {
            return FN && typeof FN.rowHtml === 'function'
                ? FN.rowHtml({
                    id: f.id,
                    lockedName: f.lockedName,
                    alias: f.alias,
                    meta: f.meta,
                    script: f.script
                })
                : '';
        }).join('');
        return (FN && typeof FN.formulaBlockHtml === 'function'
            ? FN.formulaBlockHtml({ templateName: tpl })
            : '')
            + (FN && typeof FN.headerHtml === 'function' ? FN.headerHtml() : '')
            + rowsHtml;
    }

    async function hydrateRenameFilesFromDrive(row, files, opts) {
        if (!(opts && opts.skipCatalog) && window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            try {
                await window.FeatureTimeline.ensureMetaCatalog(row.classId || '', row.rootKind || 'teacher', { force: true });
            } catch (_e) {}
        }
        const driveNames = driveFileNamesForFolder(row.folderName, row.rootKind, row.classId);
        const used = {};
        const templateName = String((row && row.templateName) || '').trim();
        const official = exactDriveMetasForTemplate(driveNames, templateName);
        const allowShort = comboOwnsShortDriveFiles({
            sourceFile: row && row.sourceFile,
            officialFiles: official,
            storedMetas: (files || []).map(function (f) { return f.dbMeta; }),
            hasJsonSourceSibling: folderHasJsonSourceSibling(row),
            onlyComboInFolder: !folderHasSiblingTemplates(row),
            hasExam: !!(row && row.examTemplateIds && row.examTemplateIds.length),
            hasExistingSheets: !!(files && files.length)
        });
        (files || []).forEach(function (f) {
            const live = liveNameOfFile(f.stem || f.dbStem, templateName) || sheetKeyFromStem(f.stem || f.dbStem);
            f.driveMeta = pickDriveRealityName(driveNames, live, META_LOCKED_EXT, used, templateName, allowShort);
            f.driveScript = pickDriveRealityName(driveNames, live, SCRIPT_LOCKED_EXT, used, templateName, allowShort);
            f.meta = f.driveMeta || '';
            f.script = f.driveScript || scriptNameBesideMeta(f.meta);
            f.allowShort = allowShort;
            promoteFileSheetIdentity(f, [f.driveMeta, f.driveScript]);
        });
    }

    function currentSheetAlias(stem, sheetId, templateName) {
        return mf() && typeof mf().currentAlias === 'function'
            ? mf().currentAlias(stem, sheetId, templateName)
            : String(stem || '').trim();
    }

    function friendlyRenameError(err) {
        const msg = String((err && err.message) || err || '');
        if (/uq_material_sheets_folder_stem_template/i.test(msg)
            || /uq_material_sheets_folder_stem_untemplated/i.test(msg)
            || /uq_material_sheets_folder_stem/i.test(msg)) {
            return '同一個資料夾、同一個擷取範本裡，活頁名不能重複。不同擷取範本可以同名。';
        }
        return msg;
    }

    async function retireRelatedGhostSheets(relatedIds) {
        const ids = (relatedIds || []).filter(Boolean);
        if (!ids.length || !window.supabaseClient) return;
        const { error } = await window.supabaseClient.from('material_sheets').delete().in('id', ids);
        if (error) throw error;
    }

    function renameLoadingHtml() {
        return (
            '<div style="background:white; border-radius:14px; width:min(420px,92vw); padding:28px 24px; box-shadow:0 12px 40px rgba(15,23,42,0.18); text-align:center;">'
            + '<h3 style="margin:0 0 8px 0; color:#0F766E;">改活頁／檔名</h3>'
            + '<p style="margin:0 0 16px 0; color:#0F766E; font-size:0.9rem; font-weight:800;">正在讀取雲端檔名，請稍候…</p>'
            + '<p style="margin:0 0 16px 0; color:#64748B; font-size:0.8rem; line-height:1.5;">要對過雲端資料夾，可能需要幾秒，不是失靈。</p>'
            + '<button type="button" class="mz-rf-load-cancel" style="padding:6px 12px; border-radius:8px; border:1px solid #CBD5E1; background:white; color:#334155; font-weight:800; cursor:pointer;">取消</button>'
            + '</div>'
        );
    }

    function paneIsDirty(pane, paneEl) {
        if (!pane || !paneEl) return false;
        const FN = mf();
        const blocks = paneEl.querySelectorAll('.mf-sheet-row');
        for (let i = 0; i < blocks.length; i++) {
            const f = pane.files[i];
            if (!f) continue;
            const cur = FN && typeof FN.readRow === 'function' ? FN.readRow(blocks[i]) : {};
            if (cur.live !== String(f.poisonStem || f.dbStem || '').trim()
                || cur.alias !== String(f.alias || '').trim()
                || cur.meta !== String(f.meta || '').trim()
                || cur.script !== String(f.script || '').trim()) return true;
        }
        return false;
    }

    async function saveRenamePane(pane, paneEl, driveItems, driveMiss) {
        const FN = mf();
        const row = pane.row;
        const blocks = paneEl.querySelectorAll('.mf-sheet-row');
        for (let i = 0; i < blocks.length; i++) {
            const f = pane.files[i];
            if (!f) continue;
            const cur = FN && typeof FN.readRow === 'function' ? FN.readRow(blocks[i]) : {};
            const liveName = cur.live || String(f.lockedName || '').trim();
            let alias = cur.alias || '';
            if (FN && typeof FN.isPoisonedLiveAlias === 'function'
                && FN.isPoisonedLiveAlias(alias, liveName, row.templateName)) {
                alias = liveName;
            }
            const newMeta = cur.meta || '';
            const newScript = cur.script || '';
            const poison = String(f.poisonStem || f.dbStem || '').trim();
            const stemChanged = !!(liveName && liveName !== poison);
            const aliasChanged = alias && alias !== String(f.alias || '').trim();
            const filesChanged = newMeta !== String(f.dbMeta || '').trim()
                || newScript !== String(f.dbScript || '').trim();
            const oldDriveMeta = f.driveMeta || '';
            const oldDriveScript = f.driveScript || '';
            const driveChanged = !!(oldDriveMeta && newMeta && oldDriveMeta !== newMeta)
                || !!(oldDriveScript && newScript && oldDriveScript !== newScript);
            if (!stemChanged && !aliasChanged && !filesChanged && !driveChanged) continue;
            if (stemChanged || filesChanged || aliasChanged) {
                if (f.relatedIds && f.relatedIds.length) {
                    await retireRelatedGhostSheets(f.relatedIds);
                    f.relatedIds = [];
                }
                if (stemChanged || filesChanged) {
                    await window.MaterialNameMap.applySheetCurrentNames({
                        folderId: row.folderId,
                        sheetId: f.id,
                        sheetStem: liveName,
                        metaFileName: filesChanged ? newMeta : undefined,
                        scriptFileName: filesChanged ? newScript : undefined
                    });
                }
                if (aliasChanged && typeof window.MaterialNameMap.recordAlias === 'function') {
                    await window.MaterialNameMap.recordAlias({
                        kind: 'sheet_stem',
                        alias: liveName,
                        currentLabel: alias,
                        materialFolderId: row.folderId,
                        materialSheetId: f.id
                    });
                }
            }
            const tpl = String((row && row.templateName) || '').trim();
            if (oldDriveMeta && newMeta && oldDriveMeta !== newMeta) {
                if (canRenameDisplayedDriveFile(oldDriveMeta, f.dbMeta, liveName, tpl, META_LOCKED_EXT, f.allowShort)) {
                    driveItems.push({ oldName: oldDriveMeta, newName: newMeta });
                } else {
                    driveMiss.push(newMeta);
                }
            } else if (newMeta && !oldDriveMeta) {
                driveMiss.push(newMeta);
            }
            if (oldDriveScript && newScript && oldDriveScript !== newScript) {
                if (canRenameDisplayedDriveFile(oldDriveScript, f.dbScript, liveName, tpl, SCRIPT_LOCKED_EXT, f.allowShort)) {
                    driveItems.push({ oldName: oldDriveScript, newName: newScript });
                }
            }
            f.lockedName = liveName;
            f.poisonStem = liveName;
            f.dbStem = liveName;
            f.alias = alias;
            f.meta = newMeta;
            f.script = newScript;
            f.dbMeta = newMeta;
            f.dbScript = newScript;
            f.driveMeta = newMeta;
            f.driveScript = newScript;
        }
    }

    /** 同資料夾已有活頁勾了群組 → 這個資料夾每一本也勾。不准把填空拆成 A、B、C 各一顆。 */
    async function inheritFolderGroupFlag(folderId) {
        if (!folderId || !window.supabaseClient) return false;
        const { data, error } = await window.supabaseClient
            .from('material_sheets')
            .select('id, is_group')
            .eq('material_folder_id', folderId);
        if (error) throw error;
        const rows = data || [];
        if (!rows.some(function (s) { return s && s.is_group === true; })) return false;
        const ids = rows.filter(function (s) { return s && s.is_group !== true && s.id; }).map(function (s) { return s.id; });
        if (!ids.length) return true;
        const { error: upErr } = await window.supabaseClient
            .from('material_sheets')
            .update({ is_group: true, updated_at: new Date().toISOString() })
            .in('id', ids);
        if (upErr) throw upErr;
        return true;
    }

    async function upsertOwnDriveSheetsForRow(userId, row, driveNames) {
        if (!userId || !row || !row.folderId || !row.templateId) return;
        const tplId = String(row.templateId || '');
        const tplName = String(row.templateName || '').trim();
        const own = comboOwnDriveMetas(driveNames, tplName, {
            sourceFile: row.sourceFile,
            storedMetas: (row.sheetFiles || []).map(function (f) { return f.meta || f.dbMeta; }),
            hasJsonSourceSibling: folderHasJsonSourceSibling(row),
            onlyComboInFolder: !folderHasSiblingTemplates(row),
            hasExam: !!(row.examTemplateIds && row.examTemplateIds.length),
            hasExistingSheets: !!(row.sheetFiles && row.sheetFiles.length)
        });
        if (!tplId || !own.length) return;
        const allowShort = !exactDriveMetasForTemplate(driveNames, tplName).length;
        let comboId = row.comboId;
        if (!comboId) {
            comboId = await ensureCombination(userId, {
                combo_id: row.comboId || '',
                material_folder_id: row.folderId,
                extraction_template_id: tplId,
                source_file: row.sourceFile || '',
                sheet_db_ids: row.sheetDbIds || []
            }, null);
            row.comboId = comboId;
        }
        const { data: existing, error: readErr } = await window.supabaseClient
            .from('material_sheets')
            .select('id, sheet_stem, meta_file_name, script_file_name, is_group, source_file_name')
            .eq('material_folder_id', row.folderId)
            .eq('extraction_template_id', tplId);
        if (readErr) throw readErr;
        const byStem = {};
        (existing || []).forEach(function (s) {
            const live = liveStemOfExactMeta(s.sheet_stem, tplName).toUpperCase();
            if (live) byStem[live] = s;
        });
        const folderGrouped = await inheritFolderGroupFlag(row.folderId);
        const comboGrouped = folderGrouped
            || (existing || []).some(function (s) { return s && s.is_group === true; })
            || (row.sheetFiles || []).some(function (f) { return f && f.is_group === true; });
        const ids = [];
        const nextFiles = [];
        for (let si = 0; si < own.length; si++) {
            const file = own[si];
            const live = liveStemOfExactMeta(file, tplName);
            if (!live) continue;
            const scriptWant = allowShort
                ? (live + '.script.txt')
                : (live + '.' + templateFileToken(tplName) + '.script.txt');
            const hasScript = driveNames.some(function (n) {
                return String(n || '').toUpperCase() === scriptWant.toUpperCase();
            });
            let hit = byStem[live.toUpperCase()];
            if (hit) {
                const hitSrc = sourceFileKey(hit.source_file_name);
                const wantSrc = sourceFileKey(row.sourceFile);
                if (hitSrc !== MZ_NO_SOURCE_KEY && hitSrc !== wantSrc) continue;
                ids.push(hit.id);
                const patch = { updated_at: new Date().toISOString() };
                if (String(hit.sheet_stem || '') !== live) patch.sheet_stem = live;
                if (String(hit.meta_file_name || '') !== file) patch.meta_file_name = file;
                if (hasScript) patch.script_file_name = scriptWant;
                if (comboGrouped && hit.is_group !== true) patch.is_group = true;
                if (row.sourceFile && !String(hit.source_file_name || '').trim()) patch.source_file_name = row.sourceFile;
                if (Object.keys(patch).length > 1) {
                    const { error: upErr } = await window.supabaseClient
                        .from('material_sheets').update(patch).eq('id', hit.id);
                    if (upErr) throw upErr;
                    hit = Object.assign({}, hit, patch);
                }
            } else {
                const insert = {
                    material_folder_id: row.folderId,
                    extraction_template_id: tplId,
                    sheet_stem: live,
                    meta_file_name: file,
                    is_group: comboGrouped === true,
                    updated_at: new Date().toISOString()
                };
                if (hasScript) insert.script_file_name = scriptWant;
                if (row.sourceFile) insert.source_file_name = row.sourceFile;
                const { data: inserted, error: insErr } = await window.supabaseClient
                    .from('material_sheets').insert(insert).select('id, sheet_stem, meta_file_name, script_file_name, is_group').single();
                if (insErr) throw insErr;
                hit = inserted;
                if (hit && hit.id) ids.push(hit.id);
            }
            if (hit && hit.id) {
                nextFiles.push({
                    id: hit.id,
                    stem: live,
                    meta: file,
                    script: hasScript ? scriptWant : (hit.script_file_name || ''),
                    is_group: comboGrouped === true,
                    relatedIds: []
                });
            }
        }
        if (comboId && ids.length) {
            await ensureCombination(userId, {
                combo_id: comboId,
                material_folder_id: row.folderId,
                extraction_template_id: tplId,
                source_file: row.sourceFile || '',
                sheet_db_ids: ids
            }, null);
        }
        if (nextFiles.length) {
            row.sheetFiles = nextFiles;
            row.sheetDbIds = ids.slice();
            row.sheetStems = nextFiles.map(function (f) { return f.stem; });
        }
    }

    async function ensureMissingFolderCombosFromDrive(userId, startRow, rows, driveNames) {
        const templates = (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getTemplatesCachedSync === 'function')
            ? (window.FeatureTemplateLibrary.getTemplatesCachedSync() || [])
            : [];
        const seen = {};
        (rows || []).forEach(function (r) {
            if (r && r.templateId) seen[String(r.templateId)] = true;
        });
        for (let i = 0; i < templates.length; i++) {
            const t = templates[i];
            if (!t || !t.id || !t.is_extraction_role || seen[String(t.id)]) continue;
            const tName = String(t.name || '').trim();
            if (!tName || !exactDriveMetasForTemplate(driveNames, tName).length) continue;
            const comboId = await ensureCombination(userId, {
                material_folder_id: startRow.folderId,
                extraction_template_id: t.id,
                source_file: startRow.sourceFile || '',
                sheet_db_ids: []
            }, null);
            if (comboId && t.is_exam_role) {
                await setComboExamTemplates(comboId, [t.id]);
            }
            const newRow = emptyZoneRowFromCombo(
                {
                    id: comboId,
                    extraction_template_id: t.id,
                    material_folder_id: startRow.folderId,
                    material_templates: { id: t.id, name: tName },
                    material_combination_exam_templates: t.is_exam_role ? [{ exam_template_id: t.id }] : []
                },
                {
                    id: startRow.folderId,
                    folder_name: startRow.folderName,
                    root_kind: startRow.rootKind,
                    class_id: startRow.classId
                },
                t.id,
                tName,
                '',
                '',
                []
            );
            newRow.examTemplateIds = t.is_exam_role ? [t.id] : [];
            rows.push(newRow);
            seen[String(t.id)] = true;
            await upsertOwnDriveSheetsForRow(userId, newRow, driveNames);
        }
    }

    async function openMaterialZoneFileRename(startRow, groupRows) {
        if (!window.ModalOverlay) {
            window.showFlash && window.showFlash('❌ 無法開啟改名視窗', 'error');
            return;
        }
        const rows = (groupRows && groupRows.length) ? groupRows.slice() : (startRow ? [startRow] : []);
        const panes = [];
        const modalId = 'mz-rename-files-modal';
        window.ModalOverlay.open({
            id: modalId,
            tier: 'C',
            contentHtml: renameLoadingHtml(),
            onMount: function (loadEl) {
                const cancelLoad = loadEl.querySelector('.mz-rf-load-cancel');
                if (cancelLoad) {
                    cancelLoad.addEventListener('click', function () {
                        window.ModalOverlay.close(modalId);
                    });
                }
            }
        });
        try {
            if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
                await window.MaterialNameMap.ensureLoaded(false);
            }
            if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.fetchTemplates === 'function') {
                await window.FeatureTemplateLibrary.fetchTemplates(false);
            }
            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                await window.FeatureTimeline.ensureMetaCatalog(
                    startRow.classId || '',
                    startRow.rootKind || 'teacher',
                    { force: false }
                );
            }
            const userId = await getCurrentUserId();
            const driveNames = driveFileNamesForFolder(startRow.folderName, startRow.rootKind, startRow.classId);
            if (userId && driveNames.length) {
                for (let ri = 0; ri < rows.length; ri++) {
                    if (!(rows[ri] && rows[ri].sheetFiles && rows[ri].sheetFiles.length)) continue;
                    await upsertOwnDriveSheetsForRow(userId, rows[ri], driveNames);
                }
            }
            rows.forEach(function (row) {
                const files = cloneRenameFiles(row);
                if (!files.length) return;
                panes.push({ row: row, files: files });
            });
            if (!panes.length) {
                window.ModalOverlay.close(modalId);
                window.showFlash && window.showFlash('這本教材還沒有活頁紀錄，無法改檔名', 'error');
                return;
            }
            for (let p = 0; p < panes.length; p++) {
                await hydrateRenameFilesFromDrive(panes[p].row, panes[p].files, { skipCatalog: true });
                paintRenameFileIdentities(panes[p].row, panes[p].files);
            }
        } catch (hydrateErr) {
            window.ModalOverlay.close(modalId);
            throw hydrateErr;
        }
        if (!document.getElementById(modalId)) return;
        const cardPanes = panes.slice();
        panes.length = 0;
        splitRenamePanesByGroup(cardPanes).forEach(function (p) { panes.push(p); });
        if (!panes.length) {
            window.showFlash && window.showFlash('這本教材還沒有活頁紀錄，無法改檔名', 'error');
            window.ModalOverlay.close(modalId);
            return;
        }
        const FN = mf();
        const startKey = String((startRow && startRow.key) || '');
        let activeIdx = panes.findIndex(function (p) { return p.row.key === startKey; });
        if (activeIdx < 0) activeIdx = 0;
        function paneSheetName(pane, paneEl) {
            const names = [];
            if (paneEl && mf() && typeof mf().readRow === 'function') {
                const blocks = paneEl.querySelectorAll('.mf-sheet-row');
                for (let i = 0; i < blocks.length; i++) {
                    const cur = mf().readRow(blocks[i]);
                    if (cur && cur.live) names.push(cur.live);
                }
            }
            if (!names.length && pane && pane.files) {
                pane.files.forEach(function (f) {
                    const n = sheetDisplayName(f, pane && pane.row && pane.row.templateName);
                    if (n) names.push(n);
                });
            }
            if (mf() && typeof mf().formatSheetNames === 'function') return mf().formatSheetNames(names);
            return names.join('、');
        }
        const tabBarHtml = '<div class="mz-rf-tabs" style="display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px 0;">'
            + panes.map(function (pane, i) {
                return renameTabButtonHtml(pane.row, paneSheetName(pane), i, i === activeIdx, pane.files);
            }).join('')
            + '</div>';
        const panesHtml = panes.map(function (pane, i) {
            return '<div class="mz-rf-pane" data-pane="' + i + '" style="' + (i === activeIdx ? '' : 'display:none;') + '">'
                + renamePaneInnerHtml(pane.row, pane.files)
                + '</div>';
        }).join('');
        window.ModalOverlay.open({
            id: modalId,
            tier: 'B',
            unsavedMessage: '活頁／檔名已改但尚未儲存，確定要關閉嗎？',
            isDirty: function () {
                const box = document.getElementById(modalId);
                if (!box || box.getAttribute('data-mo-busy') === '1') return false;
                for (let i = 0; i < panes.length; i++) {
                    const paneEl = box.querySelector('.mz-rf-pane[data-pane="' + i + '"]');
                    if (paneIsDirty(panes[i], paneEl)) return true;
                }
                return false;
            },
            contentHtml: (
                '<div style="background:white; border-radius:14px; width:min(980px,96vw); max-height:90vh; overflow:auto; padding:20px; box-shadow:0 12px 40px rgba(15,23,42,0.18);">'
                + '<h3 style="margin:0 0 6px 0; color:#0F766E;">改活頁／檔名</h3>'
                + (FN && typeof FN.introHtml === 'function' ? FN.introHtml() : '')
                + tabBarHtml
                + panesHtml
                + '<div class="mz-rf-status" style="min-height:1.4em; margin:10px 0 0 0; font-size:0.78rem; font-weight:700; color:#0F766E;"></div>'
                + '<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:12px;">'
                + '<button type="button" class="mz-rf-cancel" style="padding:6px 12px; border-radius:8px; border:1px solid #CBD5E1; background:white; color:#334155; font-weight:800; cursor:pointer;">取消</button>'
                + '<button type="button" class="mz-rf-save" style="padding:6px 12px; border-radius:8px; border:0; background:#0F766E; color:white; font-weight:800; cursor:pointer;">儲存（系統＋雲端）</button>'
                + '</div>'
                + '</div>'
            ),
            onMount: function (el) {
                const cancelBtn = el.querySelector('.mz-rf-cancel');
                const saveBtn = el.querySelector('.mz-rf-save');
                const statusEl = el.querySelector('.mz-rf-status');
                function paintTabLooks(idx) {
                    el.querySelectorAll('.mz-rf-tab').forEach(function (btn) {
                        const i = Number(btn.getAttribute('data-pane'));
                        const on = i === idx;
                        const pane = panes[i];
                        const paneEl = el.querySelector('.mz-rf-pane[data-pane="' + i + '"]');
                        btn.innerHTML = renameRoleTagInnerHtml(pane && pane.row, paneSheetName(pane, paneEl), pane && pane.files);
                        btn.style.border = '1px solid ' + (on ? '#0F766E' : '#99F6E4');
                        btn.style.background = on ? '#0F766E' : '#F0FDFA';
                        btn.style.color = on ? 'white' : '#115E59';
                    });
                }
                function showPane(idx) {
                    activeIdx = idx;
                    paintTabLooks(idx);
                    el.querySelectorAll('.mz-rf-pane').forEach(function (paneEl) {
                        paneEl.style.display = Number(paneEl.getAttribute('data-pane')) === idx ? '' : 'none';
                    });
                }
                el.querySelectorAll('.mz-rf-tab').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        showPane(Number(btn.getAttribute('data-pane')));
                    });
                });
                el.querySelectorAll('.mz-rf-pane').forEach(function (paneEl) {
                    const applyBtn = paneEl.querySelector('.mf-apply-formula');
                    const pane = panes[Number(paneEl.getAttribute('data-pane'))];
                    if (!applyBtn || !pane) return;
                    applyBtn.addEventListener('click', function (ev) {
                        if (ev) ev.preventDefault();
                        try {
                            if (!(mf() && typeof mf().applyFormulaToRows === 'function')) return;
                            const aliasPat = String((paneEl.querySelector('.mf-formula-alias') || {}).value || '').trim();
                            const metaPat = String((paneEl.querySelector('.mf-formula-meta') || {}).value || '').trim();
                            const scriptPat = String((paneEl.querySelector('.mf-formula-script') || {}).value || '').trim();
                            el.querySelectorAll('.mz-rf-pane').forEach(function (otherEl) {
                                const other = panes[Number(otherEl.getAttribute('data-pane'))];
                                if (!other) return;
                                const aliasIn = otherEl.querySelector('.mf-formula-alias');
                                const metaIn = otherEl.querySelector('.mf-formula-meta');
                                const scriptIn = otherEl.querySelector('.mf-formula-script');
                                if (aliasIn) aliasIn.value = aliasPat;
                                if (metaIn) metaIn.value = metaPat;
                                if (scriptIn) scriptIn.value = scriptPat;
                                mf().applyFormulaToRows(otherEl, String(other.row.templateName || '').trim());
                            });
                            paintTabLooks(activeIdx);
                        } catch (applyErr) {
                            window.showFlash && window.showFlash('❌ 套用公式失敗：' + ((applyErr && applyErr.message) || applyErr), 'error');
                        }
                    });
                });
                function setSaving(on, message, isError) {
                    if (statusEl) {
                        statusEl.textContent = message || '';
                        statusEl.style.color = isError ? '#B91C1C' : '#0F766E';
                    }
                    if (saveBtn) {
                        saveBtn.disabled = !!on;
                        saveBtn.textContent = on ? '儲存中…' : '儲存（系統＋雲端）';
                    }
                    if (cancelBtn) {
                        cancelBtn.disabled = false;
                        cancelBtn.style.cursor = 'pointer';
                        cancelBtn.style.background = 'white';
                        cancelBtn.style.color = '#334155';
                    }
                    if (window.ModalOverlay && typeof window.ModalOverlay.setBusy === 'function') {
                        window.ModalOverlay.setBusy(modalId, !!on);
                    }
                }
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function () {
                        window.ModalOverlay.requestClose(modalId);
                    });
                }
                if (saveBtn) {
                    saveBtn.addEventListener('click', async function () {
                        if (!window.MaterialNameMap || typeof window.MaterialNameMap.applySheetCurrentNames !== 'function') {
                            setSaving(false, '對照中心尚未載入', true);
                            return;
                        }
                        setSaving(true, '正在儲存系統名稱與雲端檔名…');
                        try {
                            const driveItems = [];
                            const driveMiss = [];
                            for (let i = 0; i < panes.length; i++) {
                                const paneEl = el.querySelector('.mz-rf-pane[data-pane="' + i + '"]');
                                await saveRenamePane(panes[i], paneEl, driveItems, driveMiss);
                            }
                            let driveNote = '';
                            if (driveItems.length
                                && window.GasService && typeof window.GasService.renameMaterialFiles === 'function'
                                && window.FeatureTimeline && typeof window.FeatureTimeline.resolveMaterialsRootFolderId === 'function') {
                                try {
                                    setSaving(true, '正在改雲端檔名，請稍候…');
                                    const rootId = await window.FeatureTimeline.resolveMaterialsRootFolderId(
                                        startRow.classId || '',
                                        startRow.rootKind || 'teacher'
                                    );
                                    const driveResult = await window.GasService.renameMaterialFiles(
                                        rootId,
                                        startRow.folderName,
                                        driveItems,
                                        startRow.rootKind || 'teacher'
                                    );
                                    const missing = (driveResult && driveResult.missing) || [];
                                    const errs = (driveResult && driveResult.errors) || [];
                                    if (missing.length || errs.length) {
                                        driveNote = '雲端有 ' + (missing.length + errs.length) + ' 個檔沒改到（舊檔名對不到）。';
                                    } else {
                                        driveNote = '雲端檔名已一併改好。';
                                    }
                                    if (typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                                        await window.FeatureTimeline.ensureMetaCatalog(startRow.classId || '', startRow.rootKind || 'teacher', { force: true });
                                    }
                                } catch (driveErr) {
                                    driveNote = '系統已改名；雲端改檔失敗：' + ((driveErr && driveErr.message) || driveErr);
                                }
                            } else if (driveMiss.length) {
                                driveNote = '系統已改名；找不到雲端舊檔名，Drive 沒改到。';
                            } else if (!driveItems.length) {
                                driveNote = '系統已存；沒有偵測到需要改的雲端檔名。';
                            }
                            _materialZoneRowsCache = null;
                            const driveFailed = driveNote.indexOf('沒改到') !== -1 || driveNote.indexOf('失敗') !== -1;
                            window.showFlash && window.showFlash(
                                (driveFailed ? '⚠️ ' : '✅ ') + '已更新系統名稱。' + driveNote,
                                driveFailed ? 'error' : 'success'
                            );
                            window.ModalOverlay.close(modalId);
                            try { render(); } catch (renderErr) {
                                console.error('[FeatureClassMaterialCombinations] 改名後重繪失敗', renderErr);
                            }
                        } catch (err) {
                            console.error('[FeatureClassMaterialCombinations] 活頁改名失敗', err);
                            setSaving(false, '改名失敗：' + friendlyRenameError(err), true);
                        }
                    });
                }
            }
        });
    }

    function refreshCreatePanels() {
        if (window.FeatureMaterialPdfExam && typeof window.FeatureMaterialPdfExam.renderCreatePanel === 'function') {
            window.FeatureMaterialPdfExam.renderCreatePanel();
        }
        if (window.FeatureMaterialBook && typeof window.FeatureMaterialBook.renderCreatePanel === 'function') {
            window.FeatureMaterialBook.renderCreatePanel();
        }
    }

    function paintMaterialZone(wrap, rows) {
        function paint() {
            const groups = groupMaterialZoneRows(rows);
            const list = groups.length
                ? groups.map(renderMaterialZoneGroupHtml).join('')
                : '<div style="color:#94A3B8; font-size:0.8rem; padding:8px 0;">目前還沒有教材實例。Excel/JSON 請到上面「套用／設計範本」；PDF、目錄請用各自獨立區塊產生。這裡只顯示已有的卡。</div>';
            wrap.innerHTML = (
                '<div style="background:white; padding:20px; border-radius:12px; border:2px solid #99F6E4; margin-bottom:16px;">'
                + '<h3 style="margin:0 0 4px 0; color:#0F766E;">📁 教材區</h3>'
                + '<p style="color:#64748B; margin:0 0 12px 0;">一個窗口＝一個教材資料夾，只顯示該夾已有的套餐卡。名稱、試卷範本、採用班級在這裡編輯並存進資料庫。新增／產生在上面三個獨立區塊，不在窗口裡。</p>'
                + list
                + '</div>'
            );
            bindMaterialZoneRename(wrap, rows || []);
            if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.bind === 'function') {
                window.MaterialComboStrategies.bind(wrap);
            }
            refreshCreatePanels();
        }
        const pending = [];
        if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.ensureLoaded === 'function') {
            pending.push(window.MaterialComboStrategies.ensureLoaded().catch(function (err) {
                console.error('[FeatureClassMaterialCombinations] 套餐策略載入失敗', err);
            }));
        }
        if (pending.length) {
            Promise.all(pending).then(paint);
            return;
        }
        paint();
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
            const [statRows] = await Promise.all([
                loadTeacherComboStatistics(true),
                examTemplatesPromise
            ]);
            const driveFolders = await teacherDriveFolderNames();
            _materialZoneRowsCache = appendUnusedDriveFolderRows(buildMaterialZoneRowsFromStats(statRows), driveFolders);
            if (mzWrap) paintMaterialZone(mzWrap, _materialZoneRowsCache);
            if (wrap) paint(wrap, statRows);
            refreshCreatePanels();
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
        if (!folderName || !templateId) return { classIds: [], classNames: [] };
        const rows = await loadTeacherComboStatistics(false);
        const folderU = String(folderName || '').trim().toUpperCase();
        const classIds = [];
        (rows || []).forEach(function (r) {
            if (String(r.folder_name || '').trim().toUpperCase() !== folderU) return;
            if (String(r.extraction_template_id || '') !== String(templateId)) return;
            statsClassIds(r).forEach(function (cid) {
                if (classIds.indexOf(cid) === -1) classIds.push(cid);
            });
        });
        return { classIds: classIds, classNames: classIds.map(classNameById) };
    }

    /**
     * 套用範本並產出 meta/script 後寫入組合。
     * includeExam=true（擷取＆試卷）時，同一份範本也寫進官方試卷配對；已有的其他試卷勾選不刪。
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
        const wantSrc = sourceFileKey(o.sourceFile);
        let group = groups.find(function (g) {
            return String(g.folder_name || '').trim().toUpperCase() === folderU
                && String(g.extraction_template_id) === String(templateId)
                && sourceFileKey(g.source_file) === wantSrc;
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
        group = Object.assign({}, group, { source_file: String(o.sourceFile || '').trim() });
        if (group.sheet_db_ids && group.sheet_db_ids.length) {
            const { data: srcSheets, error: srcErr } = await window.supabaseClient
                .from('material_sheets')
                .select('id, source_file_name')
                .in('id', group.sheet_db_ids);
            if (srcErr) throw srcErr;
            if (group.source_file) {
                const want = sourceFileKey(group.source_file);
                group.sheet_db_ids = (srcSheets || []).filter(function (s) {
                    return sourceFileKey(s.source_file_name) === want;
                }).map(function (s) { return s.id; });
            } else {
                const inferred = {};
                (srcSheets || []).forEach(function (s) {
                    inferred[sourceFileKey(s.source_file_name)] = s.source_file_name || '';
                });
                const ks = Object.keys(inferred);
                if (ks.length === 1) {
                    group.source_file = inferred[ks[0]];
                } else if (ks.length > 1) {
                    return;
                }
            }
        }
        const comboId = await ensureCombination(userId, group, null);
        if (o.includeExam && comboId && templateId) {
            const { data: links, error: linkErr } = await window.supabaseClient
                .from('material_combination_exam_templates')
                .select('exam_template_id')
                .eq('material_combination_id', comboId);
            if (linkErr) throw linkErr;
            const ids = (links || []).map(function (l) {
                return l && l.exam_template_id ? String(l.exam_template_id) : '';
            }).filter(Boolean);
            if (ids.indexOf(String(templateId)) === -1) ids.push(String(templateId));
            await setComboExamTemplates(comboId, ids);
        }
        if (o.isGroup === true && (o.sheetStems || []).length) {
            const folderId = group.material_folder_id;
            const wanted = {};
            (o.sheetStems || []).forEach(function (s) {
                const key = sheetKeyFromStem(s);
                const body = sheetStemBody(s).toUpperCase();
                if (key) wanted[key] = true;
                if (body) wanted[body] = true;
            });
            if (folderId) {
                const { data: sheets, error: sheetErr } = await window.supabaseClient
                    .from('material_sheets')
                    .select('id, sheet_stem, extraction_template_id')
                    .eq('material_folder_id', folderId);
                if (sheetErr) throw sheetErr;
                const ids = (sheets || []).filter(function (s) {
                    if (String(s.extraction_template_id || '') !== String(templateId)) return false;
                    return sheetStemMatchesWanted(s.sheet_stem, wanted);
                }).map(function (s) { return s.id; }).filter(Boolean);
                if (ids.length) {
                    const { error: groupErr } = await window.supabaseClient
                        .from('material_sheets')
                        .update({ is_group: true })
                        .in('id', ids);
                    if (groupErr) throw groupErr;
                }
            }
        }
        invalidateSuggestionCache();
        invalidateDisplayCaches();
    }

    function sheetStemMatchesWanted(stem, wantedKeys) {
        const key = sheetKeyFromStem(stem);
        if (key && wantedKeys[key]) return true;
        const body = sheetStemBody(stem).toUpperCase();
        return !!(body && wantedKeys[body]);
    }

    /**
     * 雲端「只套試卷」：只加到「同一份套餐」＝這個資料夾＋擷取範本就是這份試卷範本。
     * 不准用活頁字母 A 去套同夾另一份擷取（Excel meta-sentence 被抄上 sentence-translation）。
     * 不准把試卷範本寫進活頁的擷取欄，也不准新建「試卷當擷取」的套餐。
     * 當擷取／雙用產檔走 recordApplyFromExcel，不走這裡。
     */
    async function recordExamApplyFromDrive(opts) {
        const o = opts || {};
        const userId = await getCurrentUserId();
        if (!userId) return;
        const folderName = String(o.folderName || '').trim();
        const examTemplateId = o.examTemplateId || '';
        const sheetStems = (o.sheetStems || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
        if (!folderName || !examTemplateId) throw new Error('請先選雲端資料夾與試卷範本');
        const examTpl = (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getTemplatesCachedSync === 'function')
            ? window.FeatureTemplateLibrary.getTemplatesCachedSync().find(function (t) { return String(t.id) === String(examTemplateId); })
            : null;
        if (!examTpl || !examTpl.is_exam_role) {
            throw new Error('這份不是試卷範本，雲端只能套用已勾試卷角色的範本。');
        }
        const folderU = folderName.toUpperCase();
        const wanted = {};
        sheetStems.forEach(function (s) {
            const key = sheetKeyFromStem(s);
            const body = sheetStemBody(s).toUpperCase();
            if (key) wanted[key] = true;
            if (body) wanted[body] = true;
        });
        const combos = await loadCombinations(userId);
        const hits = (combos || []).filter(function (c) {
            const fn = (c.material_folders && c.material_folders.folder_name) || '';
            if (String(fn).trim().toUpperCase() !== folderU) return false;
            return String(c.extraction_template_id || '') === String(examTemplateId);
        });
        if (!hits.length) {
            throw new Error('這個資料夾還沒有擷取範本「' + (examTpl.name || '') + '」的套餐。只套試卷只能加在同一份套餐上，不准寫進別份擷取。');
        }
        for (let i = 0; i < hits.length; i++) {
            const comboId = hits[i].id;
            const { data: links, error: linkErr } = await window.supabaseClient
                .from('material_combination_exam_templates')
                .select('exam_template_id')
                .eq('material_combination_id', comboId);
            if (linkErr) throw linkErr;
            const ids = (links || []).map(function (l) {
                return l && l.exam_template_id ? String(l.exam_template_id) : '';
            }).filter(Boolean);
            if (ids.indexOf(String(examTemplateId)) === -1) ids.push(String(examTemplateId));
            await setComboExamTemplates(comboId, ids);
        }
        if (o.isGroup === true && sheetStems.length) {
            const folder = hits[0].material_folders || {};
            const folderId = folder.id || hits[0].material_folder_id;
            if (folderId) {
                const { data: sheets, error: sheetErr } = await window.supabaseClient
                    .from('material_sheets')
                    .select('id, sheet_stem, extraction_template_id')
                    .eq('material_folder_id', folderId);
                if (sheetErr) throw sheetErr;
                const ids = (sheets || []).filter(function (s) {
                    if (String(s.extraction_template_id || '') !== String(examTemplateId)) return false;
                    return sheetStemMatchesWanted(s.sheet_stem, wanted);
                }).map(function (s) { return s.id; }).filter(Boolean);
                if (ids.length) {
                    const { error: groupErr } = await window.supabaseClient
                        .from('material_sheets')
                        .update({ is_group: o.isGroup === true })
                        .in('id', ids);
                    if (groupErr) throw groupErr;
                }
            }
        }
        invalidateSuggestionCache();
        invalidateDisplayCaches();
    }

    async function lookupFolderUsage(folderName) {
        if (!folderName) return { classIds: [], classNames: [] };
        const rows = await loadTeacherComboStatistics(false);
        const folderU = String(folderName || '').trim().toUpperCase();
        const classIds = [];
        (rows || []).forEach(function (r) {
            if (String(r.folder_name || '').trim().toUpperCase() !== folderU) return;
            statsClassIds(r).forEach(function (cid) {
                if (classIds.indexOf(cid) === -1) classIds.push(cid);
            });
        });
        return { classIds: classIds, classNames: classIds.map(classNameById) };
    }

    /**
     * 每個範本目前真正套到哪些教材資料夾、指派給哪些班級、有沒有當試卷搭配。
     * 擷取側「幾個 meta」只數這份套餐自己連上的活頁。不是複習目錄。
     */
    async function summarizeUsageByTemplate() {
        const userId = await getCurrentUserId();
        if (!userId) {
            _usageSummaryCache = {};
            return _usageSummaryCache;
        }
        const statRows = await loadTeacherComboStatistics(false);
        const grouped = groupStatsRowsByCombo(statRows);
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
        grouped.order.forEach(function (id) {
            const pack = grouped.byCombo[id];
            const head = pack.head;
            const rec = ensure(head.extraction_template_id);
            const folderName = String(head.folder_name || '').trim();
            const classIds = statsClassIds(head);
            const examIds = examIdsFromStats(head.exam_template_ids);
            const metaFiles = pack.sheets.map(function (s) {
                return publishedMetaNameFromSheet(s.sheet_stem, s.meta_file_name, head.extraction_template_name);
            }).filter(Boolean);
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
            classIds.forEach(function (cid) {
                if (!rec) return;
                const n = classNameById(cid);
                if (n && rec.classNames.indexOf(n) === -1) rec.classNames.push(n);
            });
            examIds.forEach(function (examId) {
                if (!examId) return;
                if (String(examId) === String(head.extraction_template_id) && rec) rec.hasExam = true;
                const examRec = ensure(examId);
                if (!examRec) return;
                examRec.hasExam = true;
                const examTplName = templateNameById(examId) || String(head.extraction_template_name || '');
                if (!classIds.length) addToSide(examRec, examRec.exam, folderName, null, [], { templateName: examTplName });
                classIds.forEach(function (cid) { addToSide(examRec, examRec.exam, folderName, cid, [], { templateName: examTplName }); });
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

    function fileNameHasTemplateToken(fileName, templateName) {
        const tpl = String(templateName || '').trim().replace(/[\\/]/g, '-');
        const raw = String(fileName || '').trim().replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        if (!tpl || !raw) return false;
        return raw.toUpperCase().indexOf('.' + tpl.toUpperCase()) !== -1;
    }

    /**
     * 出題／官方配對用的檔名＝這本活頁列自己存的檔（這份套餐的）。
     * 短檔可以，前提是這本列存的就是短檔。不准拿隔壁套餐的列、不准猜 {活頁}.{範本}。
     */
    function publishedMetaNameFromSheet(sheetStem, metaFileName, templateName) {
        const fromDb = String(metaFileName || '').trim();
        if (fromDb) return fromDb;
        const stem = String(sheetStem || '').trim();
        if (!stem) return '';
        if (/\.meta\.json$/i.test(stem)) return stem;
        if (/\.meta$/i.test(stem)) return stem.replace(/\.meta$/i, '.meta.json');
        if (!String(templateName || '').trim()) return stem + '.meta.json';
        return '';
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
    let _sheetPageCountsByClass = {};

    function comboStatsHintKey(hint) {
        return String(hint || '').trim().replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '').toUpperCase();
    }

    function examIdsFromStats(raw) {
        let list = raw;
        if (typeof list === 'string') {
            try { list = JSON.parse(list); } catch (_e) { return []; }
        }
        if (!Array.isArray(list)) return [];
        return list.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    }

    function statsClassAssignments(row) {
        let raw = row && row.class_assignments;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = null; }
        }
        const map = {};
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            Object.keys(raw).forEach(function (cid) {
                if (raw[cid]) map[String(cid)] = raw[cid];
            });
        }
        return map;
    }

    function statsClassIds(row) {
        let ids = row && row.class_ids;
        if (typeof ids === 'string') {
            try { ids = JSON.parse(ids); } catch (_e) { ids = null; }
        }
        if (Array.isArray(ids)) {
            return ids.map(function (id) { return String(id || '').trim(); }).filter(Boolean);
        }
        return Object.keys(statsClassAssignments(row));
    }

    /** 教材區／官方配對只讀 combo_statistics。不准再 join 來源表。 */
    async function loadTeacherComboStatistics(force) {
        if (!force && _teacherComboStatsRows) return _teacherComboStatsRows;
        if (!force && _teacherComboStatsLoad) return _teacherComboStatsLoad;
        _teacherComboStatsLoad = (async function () {
            if (!window.supabaseClient) {
                _teacherComboStatsRows = [];
                return _teacherComboStatsRows;
            }
            const { data, error } = await window.supabaseClient.rpc('fetch_teacher_combo_stats');
            if (error) throw error;
            _teacherComboStatsRows = Array.isArray(data) ? data : [];
            return _teacherComboStatsRows;
        })().finally(function () { _teacherComboStatsLoad = null; });
        return _teacherComboStatsLoad;
    }

    /** 有勾群組 → 資料夾＋擷取＋來源共一顆。單本 → 再加這本活頁。 */
    function statsGroupDisplayKey(row) {
        const folderId = String((row && row.material_folder_id) || '');
        const templateId = String((row && row.extraction_template_id) || '');
        const sourceFile = sourceFileKey(normalizeSourceFileName(row && row.source_file_name));
        if (row && row.is_group === true) {
            return ['g', folderId, templateId, sourceFile].join('|');
        }
        const sheetKey = ungroupedSheetKeyOf({
            is_group: false,
            sheet_stem: row && row.sheet_stem,
            id: row && row.material_sheet_id
        });
        return ['s', folderId, templateId, sourceFile, sheetKey].join('|');
    }

    function bucketStatsByGroupDisplay(statRows) {
        const byKey = {};
        const order = [];
        (statRows || []).forEach(function (r) {
            if (!r) return;
            const folderId = String(r.material_folder_id || '');
            const templateId = String(r.extraction_template_id || '');
            if (!folderId || !templateId) return;
            const key = statsGroupDisplayKey(r);
            if (!byKey[key]) {
                byKey[key] = [];
                order.push(key);
            }
            byKey[key].push(r);
        });
        const groupBase = {};
        order.forEach(function (key) {
            if (key.indexOf('g|') === 0) groupBase[key.slice(2)] = key;
        });
        const nextByKey = {};
        const nextOrder = [];
        order.forEach(function (key) {
            const list = byKey[key];
            const emptyShell = key.indexOf('s|') === 0
                && list.every(function (r) { return !r.material_sheet_id; });
            if (emptyShell) {
                const parts = key.split('|');
                const base = [parts[1], parts[2], parts[3]].join('|');
                const gKey = groupBase[base];
                if (gKey && byKey[gKey]) {
                    byKey[gKey].push.apply(byKey[gKey], list);
                    return;
                }
            }
            nextByKey[key] = list;
            nextOrder.push(key);
        });
        return { byKey: nextByKey, order: nextOrder };
    }

    /** 這張卡的已存套餐名。有勾群組 → 讀群組活頁列。一本一張 → 讀這本自己的。 */
    function storedCardLabelFromStats(rows) {
        const list = rows || [];
        const groupSheet = list.filter(function (r) { return r && r.is_group === true && r.material_sheet_id; });
        const withSheet = list.filter(function (r) { return r && r.material_sheet_id; });
        const pool = groupSheet.length ? groupSheet : (withSheet.length ? withSheet : list);
        const counts = {};
        const samples = {};
        pool.forEach(function (r) {
            const n = comboLabelText(r);
            if (!n) return;
            const u = n.toUpperCase();
            counts[u] = (counts[u] || 0) + 1;
            if (!samples[u]) samples[u] = n;
        });
        const keys = Object.keys(counts);
        if (!keys.length) return '';
        if (keys.length === 1) return samples[keys[0]];
        keys.sort(function (a, b) { return counts[b] - counts[a]; });
        return samples[keys[0]];
    }

    function sheetAvailableByStemFromStatsList(list) {
        const map = {};
        (list || []).forEach(function (s) {
            if (!s) return;
            const n = s.available_count == null ? NaN : Number(s.available_count);
            if (isNaN(n) || n < 0) return;
            const stem = String(s.sheet_stem || '').trim();
            const meta = String(s.meta_file_name || '').trim();
            if (stem) map[stemAvailKey(stem)] = n;
            if (meta) map[stemAvailKey(meta)] = n;
        });
        return map;
    }

    function comboIdsFromStatsRows(rows) {
        const ids = [];
        (rows || []).forEach(function (r) {
            const id = String((r && r.combination_id) || '').trim();
            if (id && ids.indexOf(id) === -1) ids.push(id);
        });
        return ids;
    }

    function mergeStatsExamIds(rows) {
        const ids = [];
        (rows || []).forEach(function (r) {
            examIdsFromStats(r && r.exam_template_ids).forEach(function (id) {
                if (ids.indexOf(id) === -1) ids.push(id);
            });
        });
        return ids;
    }

    function groupStatsRowsByCombo(statRows) {
        const byCombo = {};
        const order = [];
        (statRows || []).forEach(function (r) {
            const id = String((r && r.combination_id) || '').trim();
            if (!id) return;
            if (!byCombo[id]) {
                byCombo[id] = { head: r, sheets: [] };
                order.push(id);
            }
            if (r.material_sheet_id) byCombo[id].sheets.push(r);
        });
        return { byCombo: byCombo, order: order };
    }

    function applyOfficialPairingsFromStats(statRows) {
        const grouped = bucketStatsByGroupDisplay(statRows);
        const map = {};
        const assigned = {};
        const combosByClass = {};
        const metaFiles = {};
        grouped.order.forEach(function (key) {
            const list = grouped.byKey[key] || [];
            const head = list[0];
            if (!head) return;
            const sheets = list.filter(function (s) { return s && s.material_sheet_id; });
            const folderName = String(head.folder_name || '').trim();
            const rootKind = head.root_kind === 'class' ? 'class' : 'teacher';
            const folderClassId = head.folder_class_id || '';
            const examIds = mergeStatsExamIds(list);
            const classIds = [];
            list.forEach(function (s) {
                statsClassIds(s).forEach(function (cid) {
                    if (classIds.indexOf(cid) === -1) classIds.push(cid);
                });
            });
            const tplName = String(head.extraction_template_name || '').trim();
            if (!sheets.length || !examIds.length) return;
            const publishedNames = [];
            const sheetAvailableByStem = {};
            const ownSheets = [];
            sheets.forEach(function (s) {
                const stem = String(s.sheet_stem || '').trim();
                const meta = publishedMetaNameFromSheet(stem, s.meta_file_name, tplName);
                const published = String(meta || '').trim();
                if (published && publishedNames.indexOf(published) === -1) publishedNames.push(published);
                const availKey = String(published || stem).replace(/\.meta\.json$/i, '').trim().toUpperCase();
                const n = s.available_count == null ? NaN : Number(s.available_count);
                if (availKey && !isNaN(n) && n >= 0) sheetAvailableByStem[availKey] = n;
                if (s.material_sheet_id && stem) {
                    ownSheets.push({
                        id: s.material_sheet_id,
                        stem: stem,
                        meta: published || String(s.meta_file_name || '').trim(),
                        is_group: s.is_group === true
                    });
                }
            });
            const links = examIds.map(function (eid, idx) {
                return { exam_template_id: eid, is_default: idx === 0 };
            });
            const chosen = links[0];
            const siblingIds = comboIdsFromStatsRows(list);
            const named = storedCardLabelFromStats(list);
            const comboRec = {
                id: siblingIds[0] || String(head.combination_id || ''),
                siblingIds: siblingIds,
                label: named,
                combo_label: named,
                rawLabel: named,
                folderName: folderName,
                rootKind: rootKind,
                extractionTemplateId: String(head.extraction_template_id || ''),
                extractionTemplateName: tplName,
                sheetStems: publishedNames.map(function (n) {
                    return String(n || '').replace(/\.meta\.json$/i, '');
                }),
                metaFiles: publishedNames.slice(),
                ownSheets: ownSheets,
                sheetAvailableByStem: sheetAvailableByStem,
                examTemplateIds: examIds.slice(),
                examTemplateId: chosen ? String(chosen.exam_template_id) : '',
                studentPdfFileId: String(head.student_pdf_file_id || ''),
                studentPdfFileName: String(head.student_pdf_file_name || ''),
                studentPdfPageMap: Array.isArray(head.student_pdf_page_map) ? head.student_pdf_page_map : [],
                isGroup: sheets.some(function (s) { return s.is_group === true; })
            };
            const keys = [folderKeyFor(rootKind, folderClassId, folderName)];
            if (rootKind !== 'class') keys.push(folderKeyFor('teacher', '', folderName));
            classIds.forEach(function (cid) {
                keys.push(folderKeyFor('teacher', cid, folderName));
                keys.push(folderKeyFor('class', cid, folderName));
                if (!assigned[cid]) assigned[cid] = [];
                const exists = assigned[cid].some(function (x) {
                    return String(x.folderName || '').trim().toUpperCase() === folderName.toUpperCase();
                });
                if (!exists && folderName) {
                    assigned[cid].push({
                        folderName: folderName,
                        rootKind: rootKind,
                        examTemplateId: chosen.exam_template_id
                    });
                }
                if (!combosByClass[cid]) combosByClass[cid] = [];
                if (!combosByClass[cid].some(function (x) { return x.id === comboRec.id; })) {
                    combosByClass[cid].push(comboRec);
                }
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
        });
        _suggestionCache = map;
        _officialMetaFilesByFolderKey = metaFiles;
        _assignedFoldersByClass = assigned;
        _assignedCombosByClass = combosByClass;
    }

    function finalizeZoneRowFromStats(row) {
        if (!row) return row;
        row.sheetStems = collapseRelatedSheetStems(row.sheetStems);
        row.sheetFiles = collapseRelatedSheetFiles(row.sheetFiles);
        row.sheetFiles.sort(function (a, b) {
            return String(a.stem || '').localeCompare(String(b.stem || ''), 'zh-Hant');
        });
        row.statsMetaFiles = (row.sheetFiles || []).map(function (f) { return f.meta; }).filter(Boolean);
        row.metaCount = row.statsMetaFiles.length;
        const examOne = officialExamNames(row);
        row.defaultLabel = defaultMaterialZoneLabel(
            resolvedSourceFile(row),
            row.folderName,
            row.templateName,
            firstSheetStemOf(row),
            examOne.length === 1 ? examOne[0] : ''
        );
        return row;
    }

    function emptyZoneRowFromStats(head, sourceFile, sheetKey) {
        const folderId = String((head && head.material_folder_id) || '');
        const templateId = String((head && head.extraction_template_id) || '');
        const assigns = statsClassAssignments(head);
        const classIds = statsClassIds(head);
        const named = comboLabelText(head);
        return {
            key: materialZoneRowKey(folderId, templateId, sourceFile, sheetKey),
            sheetKey: sheetKey || '',
            comboId: String((head && head.combination_id) || ''),
            siblingIds: String((head && head.combination_id) || '') ? [String(head.combination_id)] : [],
            comboLabel: named,
            folderId: folderId,
            templateId: templateId,
            folderName: String((head && head.folder_name) || ''),
            rootKind: head && head.root_kind === 'class' ? 'class' : 'teacher',
            classId: (head && head.folder_class_id) || '',
            templateName: String((head && head.extraction_template_name) || ''),
            sourceFile: sourceFile,
            sourceKey: sourceFileKey(sourceFile),
            sourceLabels: (head && head.source_labels) || {},
            label: named,
            sheetStems: [],
            sheetDbIds: [],
            sheetFiles: [],
            examTemplateIds: examIdsFromStats(head && head.exam_template_ids),
            classIds: classIds.slice(),
            assignmentByClassId: Object.assign({}, assigns),
            classNames: uniqueSortedNames(classIds.map(classNameById)),
            studentPdfFileId: String((head && head.student_pdf_file_id) || ''),
            studentPdfFileName: String((head && head.student_pdf_file_name) || ''),
            studentPdfPageMap: head && Array.isArray(head.student_pdf_page_map) ? head.student_pdf_page_map : [],
            statsMetaFiles: [],
            metaCount: 0,
            defaultLabel: ''
        };
    }

    /** 教材區卡只從 combo_statistics 組。有勾群組 → 結合顯示成一顆。 */
    function buildMaterialZoneRowsFromStats(statRows) {
        const grouped = bucketStatsByGroupDisplay(statRows);
        const rows = [];
        grouped.order.forEach(function (key) {
            const list = grouped.byKey[key] || [];
            const head = list[0];
            if (!head) return;
            const sourceFile = normalizeSourceFileName(head.source_file_name);
            const isGroup = list.some(function (s) { return s && s.is_group === true; });
            const sheetKey = isGroup ? '' : ungroupedSheetKeyOf({
                is_group: false,
                sheet_stem: head.sheet_stem,
                id: head.material_sheet_id
            });
            const row = emptyZoneRowFromStats(head, sourceFile, sheetKey);
            const named = storedCardLabelFromStats(list);
            row.comboLabel = named;
            row.label = named;
            row.siblingIds = comboIdsFromStatsRows(list);
            row.comboId = row.siblingIds[0] || row.comboId;
            row.examTemplateIds = mergeStatsExamIds(list);
            row.sheetAvailableByStem = sheetAvailableByStemFromStatsList(list);
            list.forEach(function (s) {
                statsClassIds(s).forEach(function (cid) {
                    if (row.classIds.indexOf(cid) === -1) row.classIds.push(cid);
                });
                Object.assign(row.assignmentByClassId, statsClassAssignments(s));
                if (!s.material_sheet_id) return;
                addSheetFileToZoneRow(row, {
                    id: s.material_sheet_id,
                    stem: String(s.sheet_stem || '').trim(),
                    meta: String(s.meta_file_name || '').trim(),
                    script: String(s.script_file_name || '').trim(),
                    sourceFile: normalizeSourceFileName(s.source_file_name),
                    is_group: s.is_group === true
                });
            });
            row.classNames = uniqueSortedNames(row.classIds.map(classNameById));
            rows.push(finalizeZoneRowFromStats(row));
        });
        return rows.sort(function (a, b) {
            const fa = String(a.folderName || '').localeCompare(String(b.folderName || ''), 'zh-Hant');
            if (fa) return fa;
            const ta = String(a.templateName || '').localeCompare(String(b.templateName || ''), 'zh-Hant');
            if (ta) return ta;
            const xa = String(a.sourceFile || '').localeCompare(String(b.sourceFile || ''), 'en', { numeric: true, sensitivity: 'base' });
            if (xa) return xa;
            const sa = String(a.sheetKey || '').localeCompare(String(b.sheetKey || ''), 'en', { numeric: true, sensitivity: 'base' });
            if (sa) return sa;
            const la = a.comboLabel || a.defaultLabel;
            const lb = b.comboLabel || b.defaultLabel;
            return String(la).localeCompare(String(lb), 'zh-Hant');
        });
    }

    function buildClassReviewDeskModelFromStats(statRows) {
        const byClass = {};
        allClasses().forEach(function (cls) {
            byClass[String(cls.id)] = { cls: cls, materials: [] };
        });
        (statRows || []).forEach(function (row) {
            const folderName = String((row && row.folder_name) || '').trim();
            const folderKey = folderKeyOf(folderName);
            const stem = String((row && row.sheet_stem) || '').trim();
            if (!folderKey || !stem) return;
            const extractId = String((row && row.extraction_template_id) || '');
            const examIds = examIdsFromStats(row && row.exam_template_ids);
            const examNames = examIds.map(function (id) { return templateNameById(id); }).filter(Boolean);
            const tplName = String((row && row.extraction_template_name) || '').trim();
            const metaFile = String((row && row.meta_file_name) || '').trim() || (stem + '.meta.json');
            statsClassIds(row).forEach(function (cid) {
                if (!byClass[cid]) {
                    byClass[cid] = { cls: { id: cid, name: classNameById(cid) }, materials: [] };
                }
                const sheetKey = folderKey + '|' + extractId + '|' + stem.toUpperCase();
                const list = byClass[cid].materials;
                if (list.some(function (m) { return m.sheetKey === sheetKey; })) return;
                list.push({
                    sheetKey: sheetKey,
                    folderKey: folderKey,
                    folderName: folderName,
                    sheetStem: stem,
                    metaFileName: metaFile,
                    templateName: tplName,
                    label: comboLabelText(row),
                    examNames: examNames.slice()
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

    function comboRecordFromZoneRow(row) {
        const named = String((row && row.comboLabel) || '').trim();
        const files = (row && row.sheetFiles) || [];
        const examIds = ((row && row.examTemplateIds) || []).slice();
        return {
            id: String((row && row.comboId) || ''),
            siblingIds: ((row && row.siblingIds) || []).slice(),
            label: named,
            combo_label: named,
            rawLabel: named,
            folderId: String((row && row.folderId) || ''),
            folderName: String((row && row.folderName) || ''),
            rootKind: row && row.rootKind === 'class' ? 'class' : 'teacher',
            sourceFile: (row && row.sourceFile) || '',
            extractionTemplateId: String((row && row.templateId) || ''),
            extractionTemplateName: String((row && row.templateName) || ''),
            sheetStems: ((row && row.sheetStems) || []).slice(),
            metaFiles: ((row && row.statsMetaFiles) || files.map(function (f) { return f && f.meta; })).filter(Boolean),
            ownSheets: files.map(function (f) {
                return {
                    id: f.id,
                    stem: f.stem,
                    meta: f.meta,
                    is_group: f.is_group === true
                };
            }),
            sheetAvailableByStem: Object.assign({}, (row && row.sheetAvailableByStem) || {}),
            examTemplateIds: examIds,
            examTemplateId: examIds[0] || '',
            studentPdfFileId: String((row && row.studentPdfFileId) || ''),
            studentPdfFileName: String((row && row.studentPdfFileName) || ''),
            studentPdfPageMap: row && Array.isArray(row.studentPdfPageMap) ? row.studentPdfPageMap : [],
            isGroup: files.some(function (f) { return f && f.is_group === true; }),
            kind: 'sheet'
        };
    }

    async function refreshComboStatisticsIds(comboIds) {
        if (!window.supabaseClient) return;
        const seen = {};
        for (let i = 0; i < (comboIds || []).length; i++) {
            const id = String(comboIds[i] || '').trim();
            if (!id || seen[id]) continue;
            seen[id] = true;
            const { error } = await window.supabaseClient.rpc('refresh_combo_statistics', {
                p_combination_id: id
            });
            if (error) {
                console.warn('[FeatureClassMaterialCombinations] 更新 combo_statistics 失敗', error);
            }
        }
    }

    function publishHomeworkCombos(classId) {
        const cid = String(classId || '');
        const raw = _homeworkCombosRawByClass[cid] || {};
        const list = Object.keys(raw).map(function (k) { return raw[k]; }).sort(function (a, b) {
            return comboLabelText(a).localeCompare(comboLabelText(b), 'zh-Hant');
        });
        _assignedCombosForHomeworkAllByClass[cid] = list;
        _assignedCombosForHomeworkByClass[cid] = list.slice();
    }

    // 【死命註解｜永遠禁止刪除】下拉只讀 fetch_class_combo_stats。
    // 有勾群組 → 跟教材區同一顆（資料夾＋擷取＋來源）。文字＝那顆 combo_label。
    // A／B／C 不准當套餐列出來。
    function applyHomeworkCombosFromStats(classId, rows) {
        const grouped = bucketStatsByGroupDisplay(rows);
        const byCombo = {};
        grouped.order.forEach(function (key) {
            const list = grouped.byKey[key] || [];
            const head = list[0];
            if (!head) return;
            const siblingIds = comboIdsFromStatsRows(list);
            const id = siblingIds[0] || String(head.combination_id || '').trim();
            if (!id) return;
            const named = storedCardLabelFromStats(list);
            if (!named) return;
            const examIds = mergeStatsExamIds(list);
            const combo = {
                id: id,
                siblingIds: siblingIds,
                label: named,
                combo_label: named,
                rawLabel: named,
                folderId: String(head.material_folder_id || '').trim(),
                folderName: String(head.folder_name || '').trim(),
                rootKind: head.root_kind === 'class' ? 'class' : 'teacher',
                sourceFile: normalizeSourceFileName(head.source_file_name),
                extractionTemplateId: String(head.extraction_template_id || ''),
                extractionTemplateName: String(head.extraction_template_name || ''),
                sheetStems: [],
                metaFiles: [],
                ownSheets: [],
                sheetAvailableByStem: {},
                examTemplateIds: examIds,
                examTemplateId: examIds[0] || '',
                studentPdfFileId: String(head.student_pdf_file_id || ''),
                studentPdfFileName: String(head.student_pdf_file_name || ''),
                studentPdfPageMap: Array.isArray(head.student_pdf_page_map) ? head.student_pdf_page_map : [],
                isGroup: list.some(function (s) { return s && s.is_group === true; }),
                kind: 'sheet'
            };
            list.forEach(function (row) {
                if (!combo.sourceFile) combo.sourceFile = normalizeSourceFileName(row.source_file_name);
                const sheetId = row.material_sheet_id;
                const stem = String(row.sheet_stem || '').trim();
                if (!sheetId || !stem) return;
                if (combo.ownSheets.some(function (s) { return String(s.id) === String(sheetId); })) return;
                const meta = publishedMetaNameFromSheet(stem, row.meta_file_name, combo.extractionTemplateName);
                combo.ownSheets.push({
                    id: sheetId,
                    stem: stem,
                    meta: meta || String(row.meta_file_name || '').trim(),
                    is_group: row.is_group === true
                });
                if (meta && combo.metaFiles.indexOf(meta) === -1) combo.metaFiles.push(meta);
                if (combo.sheetStems.indexOf(stem) === -1) combo.sheetStems.push(stem);
                const n = row.available_count == null ? NaN : Number(row.available_count);
                if (!isNaN(n) && n >= 0) {
                    combo.sheetAvailableByStem[stemAvailKey(stem)] = n;
                    if (meta) combo.sheetAvailableByStem[stemAvailKey(meta)] = n;
                }
            });
            const nameKey = named.toUpperCase();
            if (byCombo[nameKey]) {
                const into = byCombo[nameKey];
                siblingIds.forEach(function (sid) {
                    if (into.siblingIds.indexOf(sid) === -1) into.siblingIds.push(sid);
                });
                combo.ownSheets.forEach(function (s) {
                    if (into.ownSheets.some(function (x) { return String(x.id) === String(s.id); })) return;
                    into.ownSheets.push(s);
                });
                combo.metaFiles.forEach(function (m) {
                    if (into.metaFiles.indexOf(m) === -1) into.metaFiles.push(m);
                });
                combo.sheetStems.forEach(function (s) {
                    if (into.sheetStems.indexOf(s) === -1) into.sheetStems.push(s);
                });
                (combo.examTemplateIds || []).forEach(function (eid) {
                    if (into.examTemplateIds.indexOf(eid) === -1) into.examTemplateIds.push(eid);
                });
                if (combo.isGroup) into.isGroup = true;
                Object.keys(combo.sheetAvailableByStem || {}).forEach(function (k) {
                    into.sheetAvailableByStem[k] = combo.sheetAvailableByStem[k];
                });
                return;
            }
            byCombo[nameKey] = combo;
        });
        _homeworkCombosRawByClass[String(classId || '')] = byCombo;
        publishHomeworkCombos(classId);
    }

    function indexComboStatsRows(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            if (!row) return;
            const comboId = String(row.combination_id || '').trim();
            const folder = String(row.folder_name || '').trim();
            const stem = String(row.sheet_stem || '').trim();
            const meta = String(row.meta_file_name || '').trim();
            const examIds = examIdsFromStats(row.exam_template_ids);
            const rec = {
                combinationId: comboId,
                comboLabel: String(row.combo_label || '').trim(),
                folderName: folder,
                rootKind: row.root_kind === 'class' ? 'class' : 'teacher',
                sheetId: row.material_sheet_id || '',
                sheetStem: stem,
                metaFile: meta,
                isGroup: row.is_group === true,
                availableCount: row.available_count == null ? null : Number(row.available_count),
                extractionTemplateId: String(row.extraction_template_id || ''),
                extractionTemplateName: String(row.extraction_template_name || ''),
                examTemplateIds: examIds,
                examTemplateId: examIds[0] || '',
                pageCounts: {}
            };
            if (!comboId || !stem) return;
            map['combo|' + comboId + '|' + comboStatsHintKey(stem)] = rec;
            if (meta) map['combo|' + comboId + '|' + comboStatsHintKey(meta)] = rec;
            if (rec.sheetId) map['combo|' + comboId + '|' + String(rec.sheetId).toUpperCase()] = rec;
        });
        return map;
    }

    async function loadComboStatsForClass(classId, force) {
        const cid = String(classId || '');
        if (!cid) return {};
        if (!force && _comboStatsByClass[cid]) return _comboStatsByClass[cid];
        if (!force && _comboStatsLoad[cid]) return _comboStatsLoad[cid];
        _comboStatsLoad[cid] = (async function () {
            if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
                await window.MaterialNameMap.ensureLoaded(false);
            }
            let rows = [];
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient.rpc('fetch_class_combo_stats', {
                    p_class_id: cid
                });
                if (error) {
                    console.warn('[FeatureClassMaterialCombinations] 讀取範圍 statistics 失敗', error);
                } else if (Array.isArray(data)) {
                    rows = data;
                }
            }
            applyHomeworkCombosFromStats(cid, rows);
            const next = indexComboStatsRows(rows);
            _comboStatsByClass[cid] = next;
            _homeworkCardsReadyByClass[cid] = true;
            return next;
        })().finally(function () { delete _comboStatsLoad[cid]; });
        return _comboStatsLoad[cid];
    }

    function ensureComboStatsLoading(classId) {
        const cid = String(classId || '');
        if (!cid) return;
        if (_comboStatsByClass[cid] || _comboStatsLoad[cid]) return;
        loadComboStatsForClass(cid, false).then(function () {
            const after = function () {
                if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
                    window.FeatureTimeline.refreshBuilder({ skipSync: true });
                }
                if (window.FeatureExamJob && typeof window.FeatureExamJob.refreshExamBuilder === 'function') {
                    window.FeatureExamJob.refreshExamBuilder();
                }
            };
            if (window.FeatureMaterialBook && typeof window.FeatureMaterialBook.ensureLoaded === 'function') {
                window.FeatureMaterialBook.ensureLoaded().then(after).catch(after);
                return;
            }
            after();
        }).catch(function () {});
    }

    async function prefetchForClass(classId) {
        const extra = (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.ensureLoaded === 'function')
            ? [window.MaterialComboStrategies.ensureLoaded().catch(function () { return null; })]
            : [];
        await Promise.all([
            fetchSuggestionMap(false).catch(function () { return null; }),
            loadComboStatsForClass(classId, false).catch(function () { return {}; })
        ].concat(extra));
    }

    function lookupSheetStats(classId, folderName, sheetHint, combinationId) {
        const cid = String(classId || '');
        const map = _comboStatsByClass[cid];
        const hint = comboStatsHintKey(sheetHint);
        const comboId = String(combinationId || '').trim();
        if (!map || !hint) return null;
        if (!comboId) return null;
        let rec = map['combo|' + comboId + '|' + hint] || null;
        if (!rec) {
            const combo = getAssignedComboById(cid, comboId);
            const ids = (combo && combo.siblingIds && combo.siblingIds.length)
                ? combo.siblingIds
                : [];
            ids.some(function (id) {
                rec = map['combo|' + String(id) + '|' + hint] || null;
                return !!rec;
            });
        }
        if (!rec) return null;
        const pages = (_sheetPageCountsByClass[cid] || {})[hint];
        if (pages && typeof pages === 'object') rec.pageCounts = pages;
        return rec;
    }

    function stemAvailKey(name) {
        return String(name || '').replace(/\.meta\.json$/i, '').trim().toUpperCase();
    }

    function rememberSheetAvailableCount(classId, comboOrId, sheetHint, count) {
        const n = Number(count);
        if (isNaN(n) || n < 0) return;
        let combo = comboOrId;
        if (!combo || typeof combo === 'string') {
            combo = getAssignedComboById(classId, comboOrId || '');
        }
        if (!combo) return;
        if (!combo.sheetAvailableByStem) combo.sheetAvailableByStem = {};
        const key = stemAvailKey(sheetHint);
        if (key) combo.sheetAvailableByStem[key] = n;
    }

    function lookupSheetAvailableCount(classId, comboOrId, sheetHint) {
        let combo = comboOrId;
        if (!combo || typeof combo === 'string') {
            combo = getAssignedComboById(classId, comboOrId || '');
        }
        const map = combo && combo.sheetAvailableByStem;
        const key = stemAvailKey(sheetHint);
        if (!map || !key) return null;
        if (map[key] != null && !isNaN(Number(map[key])) && Number(map[key]) >= 0) {
            return Number(map[key]);
        }
        return null;
    }

    function parseMetaRowsFromContent(content) {
        if (window.MaterialSnapshot && typeof window.MaterialSnapshot.parseMetaContent === 'function') {
            return window.MaterialSnapshot.parseMetaContent(content) || [];
        }
        try {
            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            return [];
        }
    }

    function metaFileNameForSheetRow(sh) {
        const tplName = templateNameById(sh && sh.extraction_template_id);
        return publishedMetaNameFromSheet(sh && sh.sheet_stem, sh && sh.meta_file_name, tplName);
    }

    function patchAssignedComboTotals(sh, n) {
        const folderU = String((sh.material_folders && sh.material_folders.folder_name) || '').trim().toUpperCase();
        const tpl = String(sh.extraction_template_id || '');
        const stemKey = stemAvailKey(sh.sheet_stem);
        const metaKey = stemAvailKey(sh.meta_file_name || metaFileNameForSheetRow(sh));
        function patchComboMap(map) {
            Object.keys(map || {}).forEach(function (cid) {
                (map[cid] || []).forEach(function (combo) {
                    if (String(combo.folderName || '').trim().toUpperCase() !== folderU) return;
                    if (tpl && combo.extractionTemplateId && String(combo.extractionTemplateId) !== tpl) return;
                    if (!combo.sheetAvailableByStem) combo.sheetAvailableByStem = {};
                    if (stemKey) combo.sheetAvailableByStem[stemKey] = n;
                    if (metaKey) combo.sheetAvailableByStem[metaKey] = n;
                });
            });
        }
        patchComboMap(_assignedCombosByClass);
        patchComboMap(_assignedCombosForHomeworkByClass);
    }

    async function resolveRootId(classId, rootKind) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.resolveMaterialsRootFolderId !== 'function') {
            return '';
        }
        try {
            return await window.FeatureTimeline.resolveMaterialsRootFolderId(classId || '', rootKind) || '';
        } catch (_e) {
            return '';
        }
    }

    async function waitForTimeline(maxMs) {
        const limit = Number(maxMs) > 0 ? Number(maxMs) : 8000;
        const start = Date.now();
        while (!(window.FeatureTimeline && typeof window.FeatureTimeline.resolveMaterialsRootFolderId === 'function')) {
            if (Date.now() - start > limit) return false;
            await new Promise(function (resolve) { setTimeout(resolve, 200); });
        }
        return true;
    }

    async function readExistingMetaChunk(folderName, items, preferredKind, classId) {
        const order = preferredKind === 'class'
            ? [{ classId: classId, kind: 'class' }, { classId: classId, kind: 'teacher' }]
            : [{ classId: classId, kind: 'teacher' }, { classId: classId, kind: 'class' }];
        let last = [];
        for (let i = 0; i < order.length; i++) {
            const spec = order[i];
            const rootId = await resolveRootId(spec.classId, spec.kind);
            if (!rootId) continue;
            try {
                const files = await window.GasService.readMaterialFiles(rootId, items, spec.kind);
                const okCount = (files || []).filter(function (f) { return f && f.ok && f.content; }).length;
                if (okCount) return files || [];
                last = files || [];
            } catch (err) {
                console.warn('[FeatureClassMaterialCombinations] 補齊總題數讀 Drive 失敗', folderName, spec.kind, err);
            }
        }
        return last;
    }

    function fileHitForItem(files, item, index) {
        const byIndex = files && files[index];
        if (byIndex && byIndex.ok && byIndex.content) return byIndex;
        const want = String((item && item.fileName) || '').trim().toUpperCase();
        if (!want) return null;
        for (let i = 0; i < (files || []).length; i++) {
            const f = files[i];
            if (!f || !f.ok || !f.content) continue;
            if (String(f.fileName || f.name || '').trim().toUpperCase() === want) return f;
        }
        return null;
    }

    /**
     * 進老師頁一次補齊：所有尚無 available_count 的活頁，讀現有 .meta.json 最後 item_no 寫入。
     * 不准等出作業一列一列按「讀取可用題數」。
     */
    async function backfillMissingSheetTotals() {
        if (_availBackfillTried) return;
        if (_availBackfillPromise) return _availBackfillPromise;
        _availBackfillPromise = (async function () {
            _availBackfillTried = true;
            if (!window.supabaseClient) return;
            if (!window.GasService || typeof window.GasService.readMaterialFiles !== 'function') return;
            const userId = await getCurrentUserId();
            if (!userId) return;
            if (!(await waitForTimeline(8000))) return;
            let res = await window.supabaseClient
                .from('material_sheets')
                .select('id, sheet_stem, meta_file_name, meta_file_id, extraction_template_id, available_count, material_folders!inner ( id, folder_name, root_kind, class_id, teacher_id )')
                .eq('material_folders.teacher_id', userId)
                .is('available_count', null);
            if (res.error && /available_count/i.test(res.error.message || '')) {
                console.warn('[FeatureClassMaterialCombinations] 資料庫還沒 available_count 欄，無法補齊總題數');
                return;
            }
            if (res.error) {
                console.warn('[FeatureClassMaterialCombinations] 列出缺總題數活頁失敗', res.error);
                return;
            }
            const missing = (res.data || []).filter(function (row) {
                const folder = row.material_folders || {};
                return !!(folder.folder_name && (row.meta_file_name || row.sheet_stem));
            });
            if (!missing.length) return;

            const groups = {};
            missing.forEach(function (row) {
                const folder = row.material_folders || {};
                const key = folderKeyFor(folder.root_kind, folder.class_id, folder.folder_name);
                if (!groups[key]) groups[key] = { folder: folder, sheets: [] };
                groups[key].sheets.push(row);
            });

            const CHUNK = 8;
            let wrote = 0;
            const groupKeys = Object.keys(groups);
            for (let gi = 0; gi < groupKeys.length; gi++) {
                const group = groups[groupKeys[gi]];
                const folderName = String(group.folder.folder_name || '').trim();
                const rootKind = group.folder.root_kind === 'class' ? 'class' : 'teacher';
                const classId = group.folder.class_id || '';
                const sheets = group.sheets;
                for (let i = 0; i < sheets.length; i += CHUNK) {
                    const chunk = sheets.slice(i, i + CHUNK);
                    const items = chunk.map(function (sh) {
                        return {
                            materialFolder: folderName,
                            fileName: metaFileNameForSheetRow(sh),
                            fileId: String(sh.meta_file_id || '')
                        };
                    });
                    const files = await readExistingMetaChunk(folderName, items, rootKind, classId);
                    for (let fi = 0; fi < chunk.length; fi++) {
                        const sh = chunk[fi];
                        if (!items[fi].fileName) continue;
                        const hit = fileHitForItem(files, items[fi], fi);
                        if (!hit) continue;
                        const rows = parseMetaRowsFromContent(hit.content);
                        const SR = window.SheetRangeBounds;
                        const total = (SR && typeof SR.totalFromMetaRows === 'function')
                            ? SR.totalFromMetaRows(rows)
                            : null;
                        if (total == null) continue;
                        const { error } = await window.supabaseClient
                            .from('material_sheets')
                            .update({ available_count: total, updated_at: new Date().toISOString() })
                            .eq('id', sh.id);
                        if (error && /available_count/i.test(error.message || '')) {
                            console.warn('[FeatureClassMaterialCombinations] 活頁尚無 available_count 欄，停止補齊');
                            return;
                        }
                        if (error) {
                            console.warn('[FeatureClassMaterialCombinations] 寫入活頁總題數失敗', error);
                            continue;
                        }
                        wrote += 1;
                        patchAssignedComboTotals(sh, total);
                    }
                }
            }
            if (wrote && window.FeatureExamJob && typeof window.FeatureExamJob.refreshExamBuilder === 'function') {
                window.FeatureExamJob.refreshExamBuilder();
            } else if (wrote && window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
                window.FeatureTimeline.refreshBuilder({ skipSync: true });
            }
        })().finally(function () {
            _availBackfillPromise = null;
        });
        return _availBackfillPromise;
    }

    async function writeSheetAvailableCounts(folderName, templateId, stemCounts) {
        const userId = await getCurrentUserId();
        const counts = stemCounts && typeof stemCounts === 'object' ? stemCounts : {};
        const keys = Object.keys(counts);
        if (!userId || !folderName || !keys.length || !window.supabaseClient) return;
        const { data: folders, error: folderErr } = await window.supabaseClient
            .from('material_folders')
            .select('id')
            .eq('teacher_id', userId)
            .eq('folder_name', folderName);
        if (folderErr || !(folders || []).length) return;
        const folderIds = folders.map(function (f) { return f.id; });
        const { data: sheets, error: sheetErr } = await window.supabaseClient
            .from('material_sheets')
            .select('id, sheet_stem, meta_file_name, extraction_template_id')
            .in('material_folder_id', folderIds);
        if (sheetErr || !(sheets || []).length) return;
        const tpl = String(templateId || '');
        for (let i = 0; i < sheets.length; i++) {
            const sh = sheets[i];
            if (tpl && String(sh.extraction_template_id || '') !== tpl) continue;
            const stemKey = stemAvailKey(sh.sheet_stem);
            const metaKey = stemAvailKey(sh.meta_file_name);
            let n = null;
            keys.forEach(function (k) {
                const want = stemAvailKey(k);
                if (want && (want === stemKey || want === metaKey)) n = Number(counts[k]);
            });
            if (n == null || isNaN(n) || n < 0) continue;
            const { error } = await window.supabaseClient
                .from('material_sheets')
                .update({ available_count: n, updated_at: new Date().toISOString() })
                .eq('id', sh.id);
            if (error && /available_count/i.test(error.message || '')) {
                console.warn('[FeatureClassMaterialCombinations] 活頁尚無 available_count 欄，略過寫入總題數');
                return;
            }
            if (error) console.warn('[FeatureClassMaterialCombinations] 寫入活頁總題數失敗', error);
        }
        invalidateSuggestionCache();
    }

    function rememberSheetPageCounts(classId, folderName, sheetHint, pageCounts) {
        const cid = String(classId || '');
        const hint = comboStatsHintKey(sheetHint);
        if (!cid || !hint || !pageCounts) return;
        if (!_sheetPageCountsByClass[cid]) _sheetPageCountsByClass[cid] = {};
        _sheetPageCountsByClass[cid][hint] = pageCounts;
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

    function getAssignedSheetById(classId, comboId) {
        const want = String(comboId || '').trim();
        if (!want) return null;
        const cid = String(classId || '');
        const fromAll = (_assignedCombosForHomeworkAllByClass[cid] || []).find(function (c) {
            return comboHasId(c, want);
        });
        if (fromAll) return fromAll;
        return (_assignedCombosForHomeworkByClass[cid] || []).find(function (c) {
            return comboHasId(c, want);
        }) || null;
    }

    function sheetStrategyMatches(combo) {
        if (!combo) return false;
        if (combo.kind === 'sheet' || combo.kind === 'excel' || combo.kind === 'json') return true;
        if (combo.kind === 'pdf' || combo.kind === 'book' || combo.isPdf || combo.isBook) return false;
        return !!(combo.extractionTemplateId || combo.sourceFile);
    }

    if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.register === 'function') {
        window.MaterialComboStrategies.register({
            kind: 'sheet',
            order: 40,
            packMode: 'sheet',
            usesMetaRange: true,
            showsExamStats: true,
            ensureLoaded: function () { return Promise.resolve(); },
            listAssignedForHomework: listAssignedSheetCombosForHomework,
            getAssignedById: getAssignedSheetById,
            renderFolderHtml: function (_folderName, ctx) {
                return ((ctx && ctx.zoneRows) || []).map(renderMaterialZoneChildHtml).join('');
            },
            bind: function () {},
            matches: sheetStrategyMatches,
            renderPackTableHtml: function (ctx) {
                if (window.TimelineTemplates && typeof window.TimelineTemplates.renderSheetPackTableHtml === 'function') {
                    return window.TimelineTemplates.renderSheetPackTableHtml(ctx);
                }
                return { html: '', rowCount: 0, showsExamStats: true };
            },
            nextSectionRow: function (combo, last, helpers) {
                var h = helpers || {};
                var inherited = (typeof h.nextRangeFromPrevRow === 'function')
                    ? h.nextRangeFromPrevRow(last)
                    : { range_type: 'page', start: '', end: '' };
                var blank = (typeof h.blankPackExamFields === 'function') ? h.blankPackExamFields() : {};
                var exam = Object.assign({}, blank, {
                    lines_per_page: (last && last.lines_per_page != null && last.lines_per_page !== '')
                        ? String(last.lines_per_page) : '',
                    shuffle: typeof h.packShuffleOn === 'function' ? h.packShuffleOn(last) : true
                });
                var label = (combo && typeof h.comboLabelText === 'function')
                    ? h.comboLabelText(combo)
                    : String((last && last.combo_label) || '').trim();
                return Object.assign({
                    combo_id: (combo && combo.id) || String((last && last.combo_id) || '').trim(),
                    combo_label: label || String((last && last.combo_label) || '').trim(),
                    meta_file: String((last && last.meta_file) || '').trim(),
                    range_type: inherited.range_type,
                    start: inherited.start,
                    end: inherited.end
                }, exam);
            }
        });
    }

    return {
        render: render,
        getSuggestedExamTemplateId: getSuggestedExamTemplateId,
        listOfficialExamTemplateIds: listOfficialExamTemplateIds,
        listOfficialExamTemplateIdsForCombo: listOfficialExamTemplateIdsForCombo,
        listOfficialMetaStemsForFolder: listOfficialMetaStemsForFolder,
        getOfficialExamTemplateDefaultId: getOfficialExamTemplateDefaultId,
        isOfficialPairingCacheReady: isOfficialPairingCacheReady,
        fetchOfficialPairings: fetchOfficialPairings,
        folderHasOfficialExamPairing: folderHasOfficialExamPairing,
        listAssignedFoldersForClass: listAssignedFoldersForClass,
        listAssignedCombosForClass: listAssignedCombosForClass,
        listAssignedCombosForHomework: listAssignedCombosForHomework,
        listAssignedSheetCombosForHomework: listAssignedSheetCombosForHomework,
        comboLabelText: comboLabelText,
        getAssignedComboById: getAssignedComboById,
        comboIsGrouped: comboIsGrouped,
        findAssignedComboForSection: findAssignedComboForSection,
        isFolderAssignedToClass: isFolderAssignedToClass,
        lookupUsage: lookupUsage,
        lookupFolderUsage: lookupFolderUsage,
        recordApplyFromExcel: recordApplyFromExcel,
        recordExamApplyFromDrive: recordExamApplyFromDrive,
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
        lookupSheetAvailableCount: lookupSheetAvailableCount,
        rememberSheetAvailableCount: rememberSheetAvailableCount,
        writeSheetAvailableCounts: writeSheetAvailableCounts,
        rememberSheetPageCounts: rememberSheetPageCounts,
        isComboStatsReady: function (classId) {
            return !!_comboStatsByClass[String(classId || '')];
        },
        isHomeworkCombosReady: function (classId) {
            return !!_comboStatsByClass[String(classId || '')];
        }
    };
})();

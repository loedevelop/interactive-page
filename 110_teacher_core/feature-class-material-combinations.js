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
 * feature-exam-job.js 直接讀 material_folder 字串＋Drive meta；這裡建立的
 * material_combination_exam_templates 關聯會被 feature-exam-job.js 的出題下拉優先讀來當
 * ⭐建議，見 getSuggestedExamTemplateId）。
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
        const t = examTemplatesList().find(function (x) { return x.id === id; });
        return t ? (t.name || '（未命名）') : '（找不到考卷範本）';
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
                material_combination_sheets ( material_sheet_id ),
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
        if (!wanted.length) throw new Error('請至少勾選一個考卷範本');
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
    // 🌟 出題畫面 ⭐建議用：依（root_kind／班級／教材資料夾／活頁）查「老師在 Step 2 明確搭配過
    // 哪個考卷範本」——優先序高於舊版 material_layout_pairs 手動登記建議（見
    // feature-exam-job.js 的 suggestedExamTemplateId），因為這是套用到教材時「連活頁都對得上」
    // 的精準建議，不是資料夾層級的粗略猜測。
    // ------------------------------------------------------------------
    let _suggestionCache = null;
    let _suggestionLoadPromise = null;

    function folderKeyFor(rootKind, classId, folderName) {
        return [(rootKind === 'class' ? 'class' : 'teacher'), classId || '', String(folderName || '').trim().toUpperCase()].join('|');
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
                    material_combination_sheets ( material_sheets ( sheet_stem ) ),
                    material_combination_exam_templates ( exam_template_id, is_default )
                `)
                .eq('material_folders.teacher_id', userId);
            if (error) {
                console.warn('[FeatureClassMaterialCombinations] 讀取考卷範本建議失敗', error);
                _suggestionCache = _suggestionCache || {};
                return _suggestionCache;
            }
            const map = {};
            (data || []).forEach(function (combo) {
                const links = Array.isArray(combo.material_combination_exam_templates) ? combo.material_combination_exam_templates : [];
                if (!links.length) return;
                const chosen = links.find(function (l) { return l.is_default; }) || links[0];
                if (!chosen || !chosen.exam_template_id) return;
                const folder = combo.material_folders || {};
                const fKey = folderKeyFor(folder.root_kind, folder.class_id, folder.folder_name);
                const sheets = Array.isArray(combo.material_combination_sheets) ? combo.material_combination_sheets : [];
                sheets.forEach(function (cs) {
                    const stem = cs.material_sheets && cs.material_sheets.sheet_stem;
                    if (!stem) return;
                    if (!map[fKey]) map[fKey] = {};
                    map[fKey][String(stem).trim().toUpperCase()] = chosen.exam_template_id;
                });
            });
            _suggestionCache = map;
            return _suggestionCache;
        })().finally(function () { _suggestionLoadPromise = null; });
        return _suggestionLoadPromise;
    }

    /**
     * 同步讀「目前已知」的建議（第一次呼叫順便觸發背景載入，跟其他 CachedSync helper 同精神）。
     * @returns {string} exam_template_id，找不到回空字串
     */
    function getSuggestedExamTemplateId(rootKind, classId, folderName, sheetIds) {
        if (_suggestionCache === null && !_suggestionLoadPromise) fetchSuggestionMap(false).catch(function () {});
        if (!_suggestionCache) return '';
        const fKey = folderKeyFor(rootKind, classId, folderName);
        const bucket = _suggestionCache[fKey];
        if (!bucket) return '';
        const sids = (sheetIds || []).map(function (s) { return String(s || '').trim().toUpperCase(); }).filter(Boolean);
        for (let i = 0; i < sids.length; i++) {
            if (bucket[sids[i]]) return bucket[sids[i]];
        }
        return '';
    }

    function invalidateSuggestionCache() { _suggestionCache = null; }

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
            return '<div style="color:#B45309; font-size:0.78rem;">目前還沒有任何考卷範本，請先按下面「🧾 新增考卷範本」建立至少一個。</div>';
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
            + '<div style="font-size:0.76rem; font-weight:800; color:#7C3AED; margin-bottom:4px;">Step 2：套用考卷範本（至少勾選一個，這是「明確搭配」，不是自動繼承）</div>'
            + '<div class="cmc-group-exam-tpl-checks">' + examTemplateCheckboxesHtml('cmc-group', []) + '</div>'
            + '<button type="button" class="cmc-group-new-exam-tpl-btn btn" data-idx="' + idx + '" style="margin-top:4px; padding:2px 8px; font-size:0.72rem; background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; border-radius:5px;">🧾 新增考卷範本</button>'
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
            : '<span style="color:#B45309; font-size:0.76rem; font-weight:700;">⚠️ 尚未套用考卷範本，出題畫面不會標⭐建議</span>';
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
            + ' <button type="button" class="cmc-combo-edit-exam-tpl-btn btn" data-idx="' + idx + '" style="padding:1px 8px; font-size:0.7rem; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:5px;">✏️ 編輯考卷範本搭配</button></div>'
            + '<div class="cmc-combo-exam-tpl-edit-form" data-idx="' + idx + '" style="display:none; margin-top:8px; background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:6px; padding:8px;">'
            + '<div class="cmc-combo-exam-tpl-checks">' + examTemplateCheckboxesHtml('cmc-combo-' + idx, examIds) + '</div>'
            + '<div style="margin-top:6px; display:flex; align-items:center; gap:8px;">'
            + '<button type="button" class="cmc-combo-new-exam-tpl-btn btn" style="padding:2px 8px; font-size:0.72rem; background:#F5F3FF; color:#6D28D9; border:1px solid #DDD6FE; border-radius:5px;">🧾 新增考卷範本</button>'
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
            <div style="background:#F8FAFC; padding:20px; border-radius:12px; border:2px solid #CBD5E1; margin-top:16px;">
                <h3 style="margin:0 0 4px 0; color:var(--primary-dark);">🏫 班級教材組合：把「套用到教材」的組合搭配考卷範本後指派給班級</h3>
                <p style="color:#64748B; font-size:0.8rem; margin:0 0 12px 0;">下面每一列都是上面「📎 套用到教材」已經有的（教材資料夾＋擷取範本）組合。選一組 → 勾選要搭配的考卷範本（Step 2，至少一個）→ 選要指派的班級（Step 3），三步驟一次完成；之後可以在資料庫查到「這個班級用了哪個教材組合、搭配哪個考卷範本」。只是額外記錄關聯，不影響出題與 Drive 上的檔案。</p>
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
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少勾選一個考卷範本（Step 2）'; }
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
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請至少勾選一個考卷範本'; }
                    return;
                }
                btn.disabled = true;
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
                try {
                    await setComboExamTemplates(combo.id, checkedExamTemplateIds);
                    invalidateSuggestionCache();
                    window.showFlash && window.showFlash('✅ 已更新考卷範本搭配', 'success');
                    render();
                } catch (err) {
                    console.error('[FeatureClassMaterialCombinations] 更新考卷範本搭配失敗', err);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 失敗：' + (err.message || err); }
                    btn.disabled = false;
                }
            });
        });

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

    return {
        render: render,
        getSuggestedExamTemplateId: getSuggestedExamTemplateId
    };
})();

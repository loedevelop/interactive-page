/**
 * 📂 110_teacher_core/feature-review-catalog.js
 * 老師「更新複習目錄」：把本班已指派教材組合的活頁 meta 快照成出卷用 items。
 * 學生永遠只讀這份快照，不直連 Drive。
 */
window.FeatureReviewCatalog = (function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function itemPage(row) {
        const n = Number(row && (row.page != null ? row.page : (row.source && row.source.page)));
        return isNaN(n) ? null : n;
    }

    async function loadAssignedSheets(classId) {
        const { data, error } = await window.supabaseClient
            .from('class_material_combinations')
            .select(`
                id,
                material_combinations (
                    id,
                    label,
                    material_folders ( folder_name, root_kind, class_id ),
                    material_combination_sheets ( material_sheets ( id, sheet_stem, meta_file_name, meta_file_id, extraction_template_id ) ),
                    material_combination_exam_templates ( exam_template_id, is_default )
                )
            `)
            .eq('class_id', classId);
        if (error) throw error;

        const out = [];
        const seen = {};
        (data || []).forEach(function (row) {
            const combo = row.material_combinations || {};
            const folder = combo.material_folders || {};
            const folderName = String(folder.folder_name || '').trim();
            if (!folderName) return;
            const links = Array.isArray(combo.material_combination_exam_templates) ? combo.material_combination_exam_templates : [];
            const chosen = links.find(function (l) { return l.is_default; }) || links[0] || null;
            const examTemplateId = chosen && chosen.exam_template_id ? chosen.exam_template_id : '';
            const sheets = Array.isArray(combo.material_combination_sheets) ? combo.material_combination_sheets : [];
            sheets.forEach(function (cs) {
                const sh = cs.material_sheets || {};
                const stem = String(sh.sheet_stem || '').trim();
                if (!stem) return;
                const key = folderName.toUpperCase() + '|' + stem.toUpperCase();
                if (seen[key]) return;
                seen[key] = true;
                out.push({
                    folderName: folderName,
                    rootKind: folder.root_kind === 'class' ? 'class' : 'teacher',
                    sheetStem: stem,
                    metaFileName: sh.meta_file_name || (stem + '.meta.json'),
                    metaFileId: sh.meta_file_id || '',
                    extractionTemplateId: sh.extraction_template_id || '',
                    examTemplateId: examTemplateId
                });
            });
        });
        return out;
    }

    function resolveProfile(templateId) {
        if (window.FeatureExamJob && typeof window.FeatureExamJob.resolveExamTemplateProfile === 'function') {
            return window.FeatureExamJob.resolveExamTemplateProfile(templateId);
        }
        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.resolveTemplateProfile === 'function') {
            return window.FeatureTemplateLibrary.resolveTemplateProfile(templateId);
        }
        return null;
    }

    function buildLayout(folderName, templateId) {
        const profile = resolveProfile(templateId) || {
            profile_id: templateId || '',
            label: templateId || '（尚未選擇）',
            fields: '',
            fields_answer: 'X',
            quiz_prompt: '',
            quiz_answer: '',
            lines_per_page: 10
        };
        return {
            material_folder: folderName,
            default_profile_id: profile.profile_id || templateId || '',
            col_map: {},
            profiles: [profile]
        };
    }

    async function readMetaRows(classId, spec) {
        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            try {
                await window.FeatureTimeline.ensureMetaCatalog(classId, spec.rootKind || 'teacher', { force: false });
            } catch (_e) {}
        }
        if (!window.GasService || typeof window.GasService.readMaterialFiles !== 'function') return [];
        let folderId = '';
        if (window.FeatureTimeline && typeof window.FeatureTimeline.resolveMaterialsRootFolderId === 'function') {
            try { folderId = await window.FeatureTimeline.resolveMaterialsRootFolderId(classId, spec.rootKind || 'teacher'); } catch (_e) {}
        }
        if (!folderId) return [];
        const files = await window.GasService.readMaterialFiles(folderId, [{
            materialFolder: spec.folderName,
            fileName: spec.metaFileName,
            fileId: spec.metaFileId,
            sheetId: spec.sheetStem
        }], spec.rootKind || 'teacher');
        const hit = (files || []).find(function (f) { return f && f.ok && f.content; });
        if (!hit) return [];
        if (window.MaterialSnapshot && typeof window.MaterialSnapshot.parseMetaContent === 'function') {
            return window.MaterialSnapshot.parseMetaContent(hit.content) || [];
        }
        try {
            const parsed = JSON.parse(hit.content);
            return Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : []);
        } catch (_e) {
            return [];
        }
    }

    async function buildItems(spec, rows, layout) {
        if (!rows.length || !window.QuizPaperBuilder || typeof window.QuizPaperBuilder.buildQuizPaper !== 'function') {
            return [];
        }
        const pages = rows.map(itemPage).filter(function (n) { return n != null; });
        const lo = pages.length ? Math.min.apply(null, pages) : 1;
        const hi = pages.length ? Math.max.apply(null, pages) : 9999;
        try {
            const paper = await window.QuizPaperBuilder.buildQuizPaper({
                examJob: {
                    job_id: 'review-catalog',
                    layout_profile_id: spec.examTemplateId || '',
                    options: { shuffle: false },
                    sections: [{
                        sheet_id: String(spec.sheetStem).toUpperCase(),
                        range_type: 'page',
                        start: lo,
                        end: hi,
                        count: rows.length
                    }]
                },
                layout: layout,
                loadSheetMeta: async function () {
                    return { rows: rows, schemaId: '', materialFolder: spec.folderName };
                }
            });
            return (paper && Array.isArray(paper.items)) ? paper.items : [];
        } catch (err) {
            console.warn('[FeatureReviewCatalog] 預算出題失敗', spec.sheetStem, err);
            return rows.map(function (row, idx) {
                const page = itemPage(row);
                const itemNo = Number(row.item_no);
                return {
                    item_id: [spec.folderName, spec.sheetStem, page == null ? 'p' : page, isNaN(itemNo) ? idx : itemNo].join(':'),
                    seq: idx + 1,
                    prompt_zh: String(row.display_zh || row.prompt_zh || '').trim(),
                    answer_en: String(row.answer_en || row.script || row._answer_combined_text || '').trim(),
                    accepted_answers: row._accepted_answers || [],
                    source: {
                        material_folder: spec.folderName,
                        sheet_id: String(spec.sheetStem).toUpperCase(),
                        page: page,
                        item_no: isNaN(itemNo) ? null : itemNo
                    }
                };
            }).filter(function (it) { return it.answer_en; });
        }
    }

    function isSheetEnabled(materials, folderName, sheetStem) {
        if (!materials) return true;
        if (window.ReviewZone && typeof window.ReviewZone.materialEntry === 'function') {
            return window.ReviewZone.materialEntry(materials, folderName, sheetStem).enabled;
        }
        const key = String(folderName || '').trim().toUpperCase() + '|' + String(sheetStem || '').trim().toUpperCase();
        const folderKey = String(folderName || '').trim().toUpperCase();
        const e = materials[key] || materials[folderKey] || materials[folderName];
        return !e || e.enabled !== false;
    }

    async function refreshForClass(classId, statusEl, opts) {
        function status(msg) {
            if (statusEl) statusEl.textContent = msg;
        }
        status('⏳ 讀取本班已指派教材…');
        let specs = await loadAssignedSheets(classId);
        const materials = opts && opts.materials;
        if (materials) {
            specs = specs.filter(function (s) { return isSheetEnabled(materials, s.folderName, s.sheetStem); });
        }
        if (!specs.length) {
            await window.supabaseClient.rpc('replace_class_review_catalog', {
                p_class_id: classId,
                p_rows: []
            });
            return { count: 0, ready: 0 };
        }

        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.getExamTemplates === 'function') {
            try { window.FeatureTemplateLibrary.getExamTemplates(); } catch (_e) {}
        }

        const rows = [];
        let ready = 0;
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            status('⏳ 快照 ' + spec.folderName + ' / ' + spec.sheetStem + '（' + (i + 1) + '/' + specs.length + '）');
            const layout = buildLayout(spec.folderName, spec.examTemplateId);
            let metaRows = [];
            try { metaRows = await readMetaRows(classId, spec); } catch (err) {
                console.warn('[FeatureReviewCatalog] 讀 meta 失敗', spec, err);
            }
            const items = await buildItems(spec, metaRows, layout);
            const pages = items.map(function (it) { return itemPage(it); }).filter(function (n) { return n != null; });
            if (items.length) ready += 1;
            rows.push({
                folder_name: spec.folderName,
                sheet_stem: String(spec.sheetStem).toUpperCase(),
                page_min: pages.length ? Math.min.apply(null, pages) : null,
                page_max: pages.length ? Math.max.apply(null, pages) : null,
                available_count: items.length ? items.length : null,
                has_template: !!spec.examTemplateId,
                exam_template_id: spec.examTemplateId || null,
                has_extraction_template: !!spec.extractionTemplateId,
                extraction_template_id: spec.extractionTemplateId || null,
                items: items,
                layout: layout
            });
        }

        status('⏳ 寫入複習目錄…');
        const { error } = await window.supabaseClient.rpc('replace_class_review_catalog', {
            p_class_id: classId,
            p_rows: rows
        });
        if (error) throw error;
        return { count: rows.length, ready: ready };
    }

    return {
        refreshForClass: refreshForClass
    };
})();

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
                    extraction_template_id,
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
                const metaFileName = sh.meta_file_name || (stem + '.meta.json');
                const metaStem = String(metaFileName).replace(/\.meta\.json$/i, '').trim() || stem;
                const key = folderName.toUpperCase() + '|' + metaStem.toUpperCase();
                if (seen[key]) return;
                seen[key] = true;
                out.push({
                    folderName: folderName,
                    rootKind: folder.root_kind === 'class' ? 'class' : 'teacher',
                    sheetStem: metaStem,
                    liveSheetStem: stem,
                    metaFileName: metaFileName,
                    metaFileId: sh.meta_file_id || '',
                    extractionTemplateId: combo.extraction_template_id || sh.extraction_template_id || '',
                    examTemplateId: examTemplateId
                });
            });
        });
        return out;
    }

    function catalogStemKey(s) {
        return String(s || '').replace(/\.meta\.json$/i, '').trim().toUpperCase();
    }

    function findCatalogPack(packs, folderName, publishedFile) {
        const folderU = String(folderName || '').trim().toUpperCase();
        const full = catalogStemKey(publishedFile);
        if (!folderU || !full) return null;
        let best = null;
        let bestLen = -1;
        (packs || []).forEach(function (p) {
            if (String((p && p.folder_name) || '').trim().toUpperCase() !== folderU) return;
            const stem = catalogStemKey(p.sheet_stem);
            if (!stem) return;
            const ok = stem === full || full.indexOf(stem + '.') === 0 || stem.indexOf(full + '.') === 0;
            if (!ok) return;
            if (stem.length > bestLen) {
                best = p;
                bestLen = stem.length;
            }
        });
        return best;
    }

    function isFullMetaRow(row) {
        if (!row || typeof row !== 'object') return false;
        const baked = {
            page: true, item_no: true, itemNo: true,
            _answer_combined_text: true, _answer_keys: true, _answer_mode: true,
            _accepted_answers: true, script: true, display_zh: true,
            answer_en: true, 書寫答案: true
        };
        return Object.keys(row).some(function (k) { return !baked[k]; });
    }

    /** 出作業只用完整 meta 列。items 烘焙稿不准當列。 */
    function rawMetaRowsFromPack(pack) {
        if (!pack) return [];
        const layoutRows = pack.layout && Array.isArray(pack.layout.meta_rows) ? pack.layout.meta_rows : [];
        if (!layoutRows.length || !layoutRows.some(isFullMetaRow)) return [];
        return layoutRows.slice();
    }

    function metaRowsFromPack(pack) {
        if (!pack) return [];
        const full = rawMetaRowsFromPack(pack);
        if (full.length) return full;
        const items = Array.isArray(pack.items) ? pack.items : [];
        const fromItems = items.map(function (it) {
            if (it && it.meta_row && typeof it.meta_row === 'object') return Object.assign({}, it.meta_row);
            if (!it || (!it.written_text && !it.student_text && !it.spoken_text)) return null;
            const src = it.source || {};
            return {
                page: itemPage(it),
                item_no: src.item_no != null ? src.item_no : it.item_no,
                _answer_combined_text: it.written_text || '',
                script: it.spoken_text || '',
                display_zh: it.prompt_zh || '',
                answer_en: it.answer_en || ''
            };
        }).filter(Boolean);
        return fromItems;
    }

    async function loadCatalogPacksForClass(classId) {
        if (!classId || !window.supabaseClient) return [];
        const { data, error } = await window.supabaseClient
            .from('class_review_catalog')
            .select('folder_name, sheet_stem, extraction_template_id, class_review_catalog_meta ( items, layout )')
            .eq('class_id', classId);
        if (error) throw error;
        return (data || []).map(function (row) {
            const meta = row.class_review_catalog_meta;
            const pack = Array.isArray(meta) ? meta[0] : meta;
            return {
                folder_name: row.folder_name,
                sheet_stem: row.sheet_stem,
                extraction_template_id: row.extraction_template_id,
                items: pack && Array.isArray(pack.items) ? pack.items : [],
                layout: pack && pack.layout ? pack.layout : {}
            };
        });
    }

    function extractionContext(templateId) {
        const lib = window.FeatureTemplateLibrary;
        if (lib && typeof lib.extractionContext === 'function') return lib.extractionContext(templateId);
        return { extraction_template_id: String(templateId || ''), student_script: '_answer_combined_text', col_map: {}, answer_combine_note: '' };
    }

    function decorateMetaRows(rows, extractCtx) {
        if (!window.MaterialSnapshot || typeof window.MaterialSnapshot.applyExtractionFormulasToRows !== 'function') {
            return rows || [];
        }
        return window.MaterialSnapshot.applyExtractionFormulasToRows(rows || [], extractCtx);
    }

    function attachExtractionFields(items, metaRows, extractCtx) {
        const snap = window.MaterialSnapshot || {};
        const byKey = {};
        (metaRows || []).forEach(function (row, idx) {
            const page = itemPage(row);
            const itemNo = Number(row && row.item_no);
            const k = String(page == null ? 'p' : page) + '|' + (isNaN(itemNo) ? idx : itemNo);
            byKey[k] = row;
        });
        return (items || []).map(function (it, idx) {
            const page = itemPage(it);
            const itemNo = Number(it && it.source && it.source.item_no);
            const k = String(page == null ? 'p' : page) + '|' + (isNaN(itemNo) ? idx : itemNo);
            const row = byKey[k] || metaRows[idx] || null;
            if (!row) return it;
            return Object.assign({}, it, {
                written_text: typeof snap.writtenAnswerFromRow === 'function' ? snap.writtenAnswerFromRow(row) : '',
                student_text: typeof snap.studentLineFromRow === 'function' ? snap.studentLineFromRow(row, extractCtx) : '',
                spoken_text: typeof snap.spokenAnswerFromRow === 'function' ? snap.spokenAnswerFromRow(row) : '',
                meta_row: row
            });
        });
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

        if (window.FeatureTemplateLibrary && typeof window.FeatureTemplateLibrary.fetchTemplates === 'function') {
            try { await window.FeatureTemplateLibrary.fetchTemplates(false); } catch (_e) {}
        }

        const rows = [];
        let ready = 0;
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            status('⏳ 快照 ' + spec.folderName + ' / ' + spec.sheetStem + '（' + (i + 1) + '/' + specs.length + '）');
            const layout = buildLayout(spec.folderName, spec.examTemplateId);
            const extractCtx = extractionContext(spec.extractionTemplateId);
            layout.extraction_template_id = spec.extractionTemplateId || '';
            layout.student_script = extractCtx.student_script || '';
            layout.answer_combine_note = extractCtx.answer_combine_note || '';
            layout.col_map = extractCtx.col_map || {};
            let metaRows = [];
            try { metaRows = await readMetaRows(classId, spec); } catch (err) {
                console.warn('[FeatureReviewCatalog] 讀 meta 失敗', spec, err);
            }
            metaRows = decorateMetaRows(metaRows, extractCtx);
            layout.meta_rows = metaRows;
            const items = attachExtractionFields(await buildItems(spec, metaRows, layout), metaRows, extractCtx);
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
        refreshForClass: refreshForClass,
        loadCatalogPacksForClass: loadCatalogPacksForClass,
        findCatalogPack: findCatalogPack,
        rawMetaRowsFromPack: rawMetaRowsFromPack,
        metaRowsFromPack: metaRowsFromPack
    };
})();

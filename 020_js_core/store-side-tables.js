/**
 * 📂 020_js_core/store-side-tables.js
 * 🌟 window.SideTableService —— 側表唯一讀寫入口
 *
 * 依「作業與繳交資料治本瘦身」計畫：assignment_material_meta_cache／assignment_quiz_papers／
 * assignment_task_scripts／task_completion_grading_events（皆含最小單位子表）一律透過這裡讀寫，
 * 消費端禁止直接 supabaseClient.from(側表)。
 *
 * 各表 migration 尚未上線前，方法會偵測「relation does not exist」並安全回傳空值／失敗結果，
 * 不會拋出未處理例外；migration 上線後不需要改呼叫端一行程式碼。
 */

const SideTableService = (() => {

    const isMissingTableError = (error) => {
        if (!error) return false;
        const msg = String(error.message || '');
        return error.code === '42P01' || msg.includes('does not exist') || msg.includes('schema cache');
    };

    const warnOnce = (() => {
        const seen = new Set();
        return (key, ...args) => {
            if (seen.has(key)) return;
            seen.add(key);
            console.warn(...args);
        };
    })();

    const resolveClassId = async (assignmentId) => {
        const { data, error } = await window.supabaseClient
            .from('assignments')
            .select('class_id')
            .eq('id', assignmentId)
            .single();
        if (error || !data) {
            console.warn('[SideTableService] 無法解析 assignment 的 class_id：', assignmentId, error);
            return null;
        }
        return data.class_id;
    };

    const resolveCompletionContext = async (completionId) => {
        const { data, error } = await window.supabaseClient
            .from('task_completions')
            .select('class_id, student_id')
            .eq('id', completionId)
            .single();
        if (error || !data) {
            console.warn('[SideTableService] 無法解析 completion 的 class_id/student_id：', completionId, error);
            return { classId: null, studentId: null };
        }
        return { classId: data.class_id, studentId: data.student_id };
    };

    // ------------------------------------------------------------------
    // materialMeta：assignment_material_meta_cache（header）+ assignment_material_meta_rows（子表）
    // 取代 assignments.tasks[].raw_data.meta_rows_by_stem
    // ------------------------------------------------------------------
    const materialMeta = {
        async get(assignmentId, taskId, stem) {
            try {
                const { data: cache, error: cacheErr } = await window.supabaseClient
                    .from('assignment_material_meta_cache')
                    .select('id, stem, source_type, source_file_id, row_count, extra, snapshot_at')
                    .eq('assignment_id', assignmentId)
                    .eq('task_id', taskId)
                    .eq('stem', stem)
                    .maybeSingle();
                if (cacheErr) {
                    if (isMissingTableError(cacheErr)) {
                        warnOnce('materialMeta.get.missing', '[SideTableService] assignment_material_meta_cache 尚未建立，回傳空值（等待 Phase 2a migration）');
                        return null;
                    }
                    throw cacheErr;
                }
                if (!cache) return null;

                const { data: rows, error: rowsErr } = await window.supabaseClient
                    .from('assignment_material_meta_rows')
                    .select('row_index, row_data')
                    .eq('meta_cache_id', cache.id)
                    .order('row_index', { ascending: true });
                if (rowsErr) throw rowsErr;

                return {
                    stem: cache.stem,
                    sourceType: cache.source_type,
                    sourceFileId: cache.source_file_id,
                    rowCount: cache.row_count,
                    extra: cache.extra || {},
                    snapshotAt: cache.snapshot_at,
                    rows: (rows || []).map((r) => r.row_data)
                };
            } catch (error) {
                console.error('[SideTableService] materialMeta.get 失敗：', error);
                return null;
            }
        },

        async upsertFull(assignmentId, taskId, stem, rows, sourceFileId) {
            try {
                const classId = await resolveClassId(assignmentId);
                if (!classId) return { success: false, reason: 'class_id_not_found' };

                const safeRows = Array.isArray(rows) ? rows : [];
                const { data: cache, error: cacheErr } = await window.supabaseClient
                    .from('assignment_material_meta_cache')
                    .upsert({
                        assignment_id: assignmentId,
                        class_id: classId,
                        task_id: taskId,
                        stem,
                        source_file_id: sourceFileId || null,
                        row_count: safeRows.length,
                        snapshot_at: new Date().toISOString()
                    }, { onConflict: 'assignment_id,task_id,stem' })
                    .select('id')
                    .single();
                if (cacheErr) {
                    if (isMissingTableError(cacheErr)) {
                        warnOnce('materialMeta.upsertFull.missing', '[SideTableService] assignment_material_meta_cache 尚未建立，跳過寫入（等待 Phase 2a migration）');
                        return { success: false, reason: 'side_table_not_ready' };
                    }
                    throw cacheErr;
                }

                // upsertFull 語意：子表整批覆寫，先清空舊列避免刪除項殘留
                const { error: delErr } = await window.supabaseClient
                    .from('assignment_material_meta_rows')
                    .delete()
                    .eq('meta_cache_id', cache.id);
                if (delErr) throw delErr;

                if (safeRows.length > 0) {
                    const payload = safeRows.map((rowData, idx) => ({
                        meta_cache_id: cache.id,
                        row_index: idx,
                        row_data: rowData
                    }));
                    const { error: insErr } = await window.supabaseClient
                        .from('assignment_material_meta_rows')
                        .insert(payload);
                    if (insErr) throw insErr;
                }

                return { success: true, rowCount: safeRows.length };
            } catch (error) {
                console.error('[SideTableService] materialMeta.upsertFull 失敗：', error);
                return { success: false, reason: 'error', error };
            }
        }
    };

    // ------------------------------------------------------------------
    // quizPaper：assignment_quiz_papers（header）+ assignment_quiz_items（子表）
    // 取代 assignments.tasks[].raw_data.quiz_paper
    // ------------------------------------------------------------------
    const quizPaper = {
        async get(assignmentId, taskId) {
            try {
                const { data: paper, error: paperErr } = await window.supabaseClient
                    .from('assignment_quiz_papers')
                    .select('id, paper_type, title, layout, item_count, extra, generated_at')
                    .eq('assignment_id', assignmentId)
                    .eq('task_id', taskId)
                    .maybeSingle();
                if (paperErr) {
                    if (isMissingTableError(paperErr)) {
                        warnOnce('quizPaper.get.missing', '[SideTableService] assignment_quiz_papers 尚未建立，回傳空值（等待 Phase 2a migration）');
                        return null;
                    }
                    throw paperErr;
                }
                if (!paper) return null;

                const { data: items, error: itemsErr } = await window.supabaseClient
                    .from('assignment_quiz_items')
                    .select('item_index, item_type, item_no, prompt_zh, answer_en, cells, extra')
                    .eq('paper_id', paper.id)
                    .order('item_index', { ascending: true });
                if (itemsErr) throw itemsErr;

                return {
                    paperType: paper.paper_type,
                    title: paper.title,
                    layout: paper.layout || {},
                    itemCount: paper.item_count,
                    extra: paper.extra || {},
                    generatedAt: paper.generated_at,
                    items: (items || []).map((it) => ({
                        itemType: it.item_type,
                        itemNo: it.item_no,
                        promptZh: it.prompt_zh,
                        answerEn: it.answer_en,
                        cells: it.cells,
                        extra: it.extra || {}
                    }))
                };
            } catch (error) {
                console.error('[SideTableService] quizPaper.get 失敗：', error);
                return null;
            }
        },

        async upsertFull(assignmentId, taskId, header, items) {
            try {
                const classId = await resolveClassId(assignmentId);
                if (!classId) return { success: false, reason: 'class_id_not_found' };

                const safeHeader = header || {};
                const safeItems = Array.isArray(items) ? items : [];
                const { data: paper, error: paperErr } = await window.supabaseClient
                    .from('assignment_quiz_papers')
                    .upsert({
                        assignment_id: assignmentId,
                        class_id: classId,
                        task_id: taskId,
                        paper_type: safeHeader.paperType || 'standard',
                        title: safeHeader.title || null,
                        layout: safeHeader.layout || {},
                        item_count: safeItems.length,
                        extra: safeHeader.extra || {},
                        generated_at: new Date().toISOString()
                    }, { onConflict: 'assignment_id,task_id' })
                    .select('id')
                    .single();
                if (paperErr) {
                    if (isMissingTableError(paperErr)) {
                        warnOnce('quizPaper.upsertFull.missing', '[SideTableService] assignment_quiz_papers 尚未建立，跳過寫入（等待 Phase 2a migration）');
                        return { success: false, reason: 'side_table_not_ready' };
                    }
                    throw paperErr;
                }

                const { error: delErr } = await window.supabaseClient
                    .from('assignment_quiz_items')
                    .delete()
                    .eq('paper_id', paper.id);
                if (delErr) throw delErr;

                if (safeItems.length > 0) {
                    const payload = safeItems.map((it, idx) => ({
                        paper_id: paper.id,
                        item_index: idx,
                        item_type: it.itemType || 'fill_blank',
                        item_no: it.itemNo || null,
                        prompt_zh: it.promptZh || null,
                        answer_en: it.answerEn || null,
                        cells: it.cells || null,
                        extra: it.extra || {}
                    }));
                    const { error: insErr } = await window.supabaseClient
                        .from('assignment_quiz_items')
                        .insert(payload);
                    if (insErr) throw insErr;
                }

                return { success: true, itemCount: safeItems.length };
            } catch (error) {
                console.error('[SideTableService] quizPaper.upsertFull 失敗：', error);
                return { success: false, reason: 'error', error };
            }
        }
    };

    // ------------------------------------------------------------------
    // taskScript：assignment_task_scripts（header）+ assignment_task_units + assignment_task_meta_items（子表）
    // 取代 assignments.tasks[].raw_data.original_script/student_display*/grading_units/meta_items
    // ------------------------------------------------------------------
    const taskScript = {
        async get(assignmentId, taskId) {
            try {
                const { data: script, error: scriptErr } = await window.supabaseClient
                    .from('assignment_task_scripts')
                    .select('id, task_kind, original_script, student_display, material_refs, material_range, recording_unit, recording_unit_hint, unit_count, extra, snapshot_at')
                    .eq('assignment_id', assignmentId)
                    .eq('task_id', taskId)
                    .maybeSingle();
                if (scriptErr) {
                    if (isMissingTableError(scriptErr)) {
                        warnOnce('taskScript.get.missing', '[SideTableService] assignment_task_scripts 尚未建立，回傳空值（等待 Phase 2b migration）');
                        return null;
                    }
                    throw scriptErr;
                }
                if (!script) return null;

                const [{ data: units, error: unitsErr }, { data: metaItems, error: metaErr }] = await Promise.all([
                    window.supabaseClient
                        .from('assignment_task_units')
                        .select('unit_index, unit_key, stem, page, label, item_nos, item_count, unit_script, extra')
                        .eq('script_id', script.id)
                        .order('unit_index', { ascending: true }),
                    window.supabaseClient
                        .from('assignment_task_meta_items')
                        .select('item_index, item_no, item_data')
                        .eq('script_id', script.id)
                        .order('item_index', { ascending: true })
                ]);
                if (unitsErr) throw unitsErr;
                if (metaErr) throw metaErr;

                return {
                    taskKind: script.task_kind,
                    originalScript: script.original_script,
                    studentDisplay: script.student_display,
                    materialRefs: script.material_refs || [],
                    materialRange: script.material_range,
                    recordingUnit: script.recording_unit,
                    recordingUnitHint: script.recording_unit_hint,
                    unitCount: script.unit_count,
                    extra: script.extra || {},
                    snapshotAt: script.snapshot_at,
                    units: (units || []).map((u) => ({
                        unitKey: u.unit_key, stem: u.stem, page: u.page, label: u.label,
                        itemNos: u.item_nos, itemCount: u.item_count, unitScript: u.unit_script,
                        extra: u.extra || {}
                    })),
                    metaItems: (metaItems || []).map((m) => ({ itemNo: m.item_no, itemData: m.item_data }))
                };
            } catch (error) {
                console.error('[SideTableService] taskScript.get 失敗：', error);
                return null;
            }
        },

        async upsertFull(assignmentId, taskId, scriptFields, units, metaItems) {
            try {
                const classId = await resolveClassId(assignmentId);
                if (!classId) return { success: false, reason: 'class_id_not_found' };

                const safeFields = scriptFields || {};
                const safeUnits = Array.isArray(units) ? units : [];
                const safeMetaItems = Array.isArray(metaItems) ? metaItems : [];

                const { data: script, error: scriptErr } = await window.supabaseClient
                    .from('assignment_task_scripts')
                    .upsert({
                        assignment_id: assignmentId,
                        class_id: classId,
                        task_id: taskId,
                        task_kind: safeFields.taskKind || 'audio_record',
                        original_script: safeFields.originalScript || null,
                        student_display: safeFields.studentDisplay || null,
                        material_refs: safeFields.materialRefs || [],
                        material_range: safeFields.materialRange || null,
                        recording_unit: safeFields.recordingUnit || null,
                        recording_unit_hint: safeFields.recordingUnitHint || null,
                        unit_count: safeUnits.length,
                        extra: safeFields.extra || {},
                        snapshot_at: new Date().toISOString()
                    }, { onConflict: 'assignment_id,task_id' })
                    .select('id')
                    .single();
                if (scriptErr) {
                    if (isMissingTableError(scriptErr)) {
                        warnOnce('taskScript.upsertFull.missing', '[SideTableService] assignment_task_scripts 尚未建立，跳過寫入（等待 Phase 2b migration）');
                        return { success: false, reason: 'side_table_not_ready' };
                    }
                    throw scriptErr;
                }

                const [{ error: delUnitsErr }, { error: delMetaErr }] = await Promise.all([
                    window.supabaseClient.from('assignment_task_units').delete().eq('script_id', script.id),
                    window.supabaseClient.from('assignment_task_meta_items').delete().eq('script_id', script.id)
                ]);
                if (delUnitsErr) throw delUnitsErr;
                if (delMetaErr) throw delMetaErr;

                if (safeUnits.length > 0) {
                    const unitPayload = safeUnits.map((u, idx) => ({
                        script_id: script.id,
                        unit_index: idx,
                        unit_key: u.unitKey || null, stem: u.stem || null, page: u.page ?? null, label: u.label || null,
                        item_nos: u.itemNos || null, item_count: u.itemCount ?? null, unit_script: u.unitScript || null,
                        extra: u.extra || {}
                    }));
                    const { error: insUnitsErr } = await window.supabaseClient.from('assignment_task_units').insert(unitPayload);
                    if (insUnitsErr) throw insUnitsErr;
                }

                if (safeMetaItems.length > 0) {
                    const metaPayload = safeMetaItems.map((m, idx) => ({
                        script_id: script.id,
                        item_index: idx,
                        item_no: m.itemNo || null,
                        item_data: m.itemData || null
                    }));
                    const { error: insMetaErr } = await window.supabaseClient.from('assignment_task_meta_items').insert(metaPayload);
                    if (insMetaErr) throw insMetaErr;
                }

                return { success: true, unitCount: safeUnits.length, metaItemCount: safeMetaItems.length };
            } catch (error) {
                console.error('[SideTableService] taskScript.upsertFull 失敗：', error);
                return { success: false, reason: 'error', error };
            }
        }
    };

    // ------------------------------------------------------------------
    // gradingEvents：task_completion_grading_events
    // 取代 raw_data 三重複評分 + 無上限 grading_history[]
    // ------------------------------------------------------------------
    // 白名單放這裡（單一維護點），未來加新來源（如 'peer_review'）只改這一行，不需要 migration
    const ALLOWED_GRADING_SOURCES = ['ai', 'teacher'];

    const gradingEvents = {
        ALLOWED_SOURCES: ALLOWED_GRADING_SOURCES,

        async list(completionId) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('task_completion_grading_events')
                    .select('id, source, segment_index, unit_key, stem, page, label, pronunciation_score, fluency_score, completeness_score, final_score, comprehensive_feedback, manual_feedback, word_errors, effective_script, grading_provider, extra_scores, graded_at, created_at')
                    .eq('completion_id', completionId)
                    .order('created_at', { ascending: true });
                if (error) {
                    if (isMissingTableError(error)) {
                        warnOnce('gradingEvents.list.missing', '[SideTableService] task_completion_grading_events 尚未建立，回傳空陣列（等待 Phase 2c migration）');
                        return [];
                    }
                    throw error;
                }
                return data || [];
            } catch (error) {
                console.error('[SideTableService] gradingEvents.list 失敗：', error);
                return [];
            }
        },

        async insert(completionId, event) {
            try {
                const safeEvent = event || {};
                if (!ALLOWED_GRADING_SOURCES.includes(safeEvent.source)) {
                    console.error('[SideTableService] gradingEvents.insert 拒絕：source 不在白名單', safeEvent.source, ALLOWED_GRADING_SOURCES);
                    return { success: false, reason: 'invalid_source' };
                }

                let classId = safeEvent.classId;
                let studentId = safeEvent.studentId;
                if (!classId || !studentId) {
                    const ctx = await resolveCompletionContext(completionId);
                    classId = classId || ctx.classId;
                    studentId = studentId || ctx.studentId;
                }
                if (!classId || !studentId) return { success: false, reason: 'context_not_found' };

                const { data, error } = await window.supabaseClient
                    .from('task_completion_grading_events')
                    .insert({
                        completion_id: completionId,
                        class_id: classId,
                        student_id: studentId,
                        source: safeEvent.source,
                        segment_index: safeEvent.segmentIndex ?? null,
                        unit_key: safeEvent.unitKey || null,
                        stem: safeEvent.stem || null,
                        page: safeEvent.page ?? null,
                        label: safeEvent.label || null,
                        pronunciation_score: safeEvent.pronunciationScore ?? null,
                        fluency_score: safeEvent.fluencyScore ?? null,
                        completeness_score: safeEvent.completenessScore ?? null,
                        final_score: safeEvent.finalScore ?? null,
                        comprehensive_feedback: safeEvent.comprehensiveFeedback || null,
                        manual_feedback: safeEvent.manualFeedback || null,
                        word_errors: safeEvent.wordErrors || null,
                        effective_script: safeEvent.effectiveScript || null,
                        grading_provider: safeEvent.gradingProvider || null,
                        extra_scores: safeEvent.extraScores || {},
                        graded_at: safeEvent.gradedAt || new Date().toISOString()
                    })
                    .select('id')
                    .single();
                if (error) {
                    if (isMissingTableError(error)) {
                        warnOnce('gradingEvents.insert.missing', '[SideTableService] task_completion_grading_events 尚未建立，跳過寫入（等待 Phase 2c migration）');
                        return { success: false, reason: 'side_table_not_ready' };
                    }
                    throw error;
                }

                return { success: true, id: data?.id };
            } catch (error) {
                console.error('[SideTableService] gradingEvents.insert 失敗：', error);
                return { success: false, reason: 'error', error };
            }
        }
    };

    return { materialMeta, quizPaper, taskScript, gradingEvents };
})();

window.SideTableService = SideTableService;

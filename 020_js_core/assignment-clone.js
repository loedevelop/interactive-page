/**
 * 📂 020_js_core/assignment-clone.js
 * 複製作業/班級設定（不含學生繳交、成績、Drive 綁定）
 */
window.AssignmentClone = (function () {
    'use strict';

    function sanitizeAssignmentRaw(raw) {
        var copy = JSON.parse(JSON.stringify(raw || {}));
        delete copy.completions;
        delete copy.completion_map;
        delete copy.drive_folder_id;
        delete copy.assignment_folder_id;
        delete copy.submission_stats;
        return copy;
    }

    function sanitizeTaskRaw(raw) {
        var copy = JSON.parse(JSON.stringify(raw || {}));
        delete copy.submission_id;
        delete copy.drive_file_id;
        delete copy.student_upload_id;
        return copy;
    }

    function assignNewIdsRecursive(tasksList) {
        return (tasksList || []).map(function (t) {
            var cloned = Object.assign({}, t, { id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) });
            delete cloned.resource_id;
            cloned.raw_data = sanitizeTaskRaw(t.raw_data || {});

            if (cloned.type === 'audio_record') {
                if (cloned.raw_data.use_ai_grading === undefined) cloned.raw_data.use_ai_grading = true;
                if (cloned.raw_data.use_ai_grammar === undefined) cloned.raw_data.use_ai_grammar = false;
                if (cloned.raw_data.capture_studio === undefined) cloned.raw_data.capture_studio = true;
                if (cloned.raw_data.capture_upload === undefined) cloned.raw_data.capture_upload = true;
                if (cloned.raw_data.script_source === undefined) cloned.raw_data.script_source = 'meta';
                if (cloned.raw_data.ai_source_type === undefined) cloned.raw_data.ai_source_type = 'text';
                if (cloned.raw_data.student_source_type === undefined) cloned.raw_data.student_source_type = 'text';
            }
            if (cloned.type === 'group' && cloned.subTasks) {
                cloned.subTasks = assignNewIdsRecursive(cloned.subTasks);
            }
            return cloned;
        });
    }

    function cloneAssignmentRecord(assignment) {
        if (!assignment) throw new Error('缺少來源作業');
        var source = JSON.parse(JSON.stringify(assignment));
        var raw = source.raw_data || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        raw = sanitizeAssignmentRaw(raw);

        var tasks = source.tasks;
        if (typeof tasks === 'string') {
            try { tasks = JSON.parse(tasks); } catch (_e2) { tasks = []; }
        }

        return {
            title: source.title || '',
            description: source.description || '',
            due_date: source.due_date || null,
            is_published: false,
            raw_data: raw,
            tasks: assignNewIdsRecursive(Array.isArray(tasks) ? tasks : [])
        };
    }

    function buildInsertPayload(cloned, targetClassId, targetDate) {
        var mergedRaw = Object.assign({}, cloned.raw_data || {});
        return {
            class_id: targetClassId,
            target_date: targetDate,
            title: cloned.title,
            description: cloned.description,
            due_date: cloned.due_date,
            is_published: false,
            tasks: cloned.tasks,
            raw_data: mergedRaw
        };
    }

    function cloneClassRawData(rawData) {
        var raw = rawData || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        var copy = JSON.parse(JSON.stringify(raw));
        delete copy.drive_folder_id;
        delete copy.class_folder_id;
        delete copy.purged_permanent;
        return copy;
    }

    return {
        assignNewIdsRecursive: assignNewIdsRecursive,
        cloneAssignmentRecord: cloneAssignmentRecord,
        buildInsertPayload: buildInsertPayload,
        cloneClassRawData: cloneClassRawData
    };
})();

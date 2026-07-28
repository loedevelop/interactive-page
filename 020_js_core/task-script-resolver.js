/**
 * 📂 020_js_core/task-script-resolver.js
 * 🌟 從作業任務樹解析 AI 朗讀文稿來源（含同群組 sibling link）
 */
window.TaskScriptResolver = (function () {
    function parseTasks(raw) {
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_e) {
                return [];
            }
        }
        return [];
    }

    function getOriginalScriptFromTask(task) {
        if (!task) return '';
        const fromRaw = task.raw_data && task.raw_data.original_script ? task.raw_data.original_script : '';
        return String(task.original_script || fromRaw || '').trim();
    }

    function findTaskWithContext(tasks, taskId) {
        let result = null;

        function search(list, parentGroup) {
            if (!Array.isArray(list)) return;
            for (let i = 0; i < list.length; i++) {
                const t = list[i];
                if (String(t.id) === String(taskId)) {
                    result = {
                        task: t,
                        parentGroup: parentGroup,
                        siblings: parentGroup && Array.isArray(parentGroup.subTasks) ? parentGroup.subTasks : list
                    };
                    return;
                }
                if (t.type === 'group' && Array.isArray(t.subTasks)) {
                    search(t.subTasks, t);
                    if (result) return;
                }
            }
        }

        search(tasks, null);
        return result;
    }

    function scoreScriptLink(linkTask) {
        if (!linkTask || linkTask.type !== 'link') return -1;
        const hay = `${linkTask.title || ''} ${linkTask.url_text || ''}`.toLowerCase();
        if (/audio|文稿|script|reading|朗讀/.test(hay)) return 10;
        return 1;
    }

    function findSiblingScriptLink(tasks, taskId) {
        const ctx = findTaskWithContext(tasks, taskId);
        if (!ctx || !Array.isArray(ctx.siblings)) return null;

        const links = ctx.siblings.filter(function (s) {
            return s && s.type === 'link' && s.url && String(s.url).trim();
        });
        if (links.length === 0) return null;

        links.sort(function (a, b) {
            return scoreScriptLink(b) - scoreScriptLink(a);
        });
        return links[0];
    }

    function resolveScriptSource(tasksInput, taskId) {
        const tasks = parseTasks(tasksInput);
        const ctx = findTaskWithContext(tasks, taskId);
        if (!ctx) {
            return { scriptText: '', scriptLinkUrl: '', scriptLinkTask: null, source: 'none' };
        }

        const direct = getOriginalScriptFromTask(ctx.task);
        if (direct) {
            return {
                scriptText: direct,
                scriptLinkUrl: (ctx.task.raw_data && ctx.task.raw_data.script_reference_url) || '',
                scriptLinkTask: null,
                source: 'task'
            };
        }

        const sibling = findSiblingScriptLink(tasks, taskId);
        if (!sibling || !sibling.url) {
            return { scriptText: '', scriptLinkUrl: '', scriptLinkTask: null, source: 'none' };
        }

        const url = String(sibling.url).trim();
        if (!/^https?:\/\//i.test(url)) {
            return {
                scriptText: url,
                scriptLinkUrl: url,
                scriptLinkTask: sibling,
                source: 'sibling_link_text'
            };
        }

        return {
            scriptText: '',
            scriptLinkUrl: url,
            scriptLinkTask: sibling,
            source: 'sibling_link_url'
        };
    }

    function isRecordingTaskType(task) {
        return !!task && (task.type === 'drive' || task.type === 'audio_record');
    }

    function taskSupportsAIGrading(task, tasksInput) {
        if (!task) return false;
        const raw = task.raw_data || {};
        if (raw.use_ai_grading === false || task.use_ai_grading === false) return false;

        // audio_record = 線上錄音／AI；drive = 上傳到資料夾（除非明確 use_ai_grading）
        if (task.type === 'audio_record') return true;
        if (raw.use_ai_grading === true || task.use_ai_grading === true) return true;
        return false;
    }

    function patchTaskScriptInTree(tasksInput, taskId, scriptText, scriptLinkUrl) {
        const tasks = JSON.parse(JSON.stringify(parseTasks(tasksInput)));
        let patched = false;

        function walk(list) {
            if (!Array.isArray(list)) return;
            for (let i = 0; i < list.length; i++) {
                const t = list[i];
                if (String(t.id) === String(taskId)) {
                    t.original_script = scriptText;
                    t.raw_data = t.raw_data || {};
                    t.raw_data.original_script = scriptText;
                    if (scriptLinkUrl) t.raw_data.script_reference_url = scriptLinkUrl;
                    if (t.use_ai_grading !== false) t.use_ai_grading = true;
                    patched = true;
                    return;
                }
                if (t.type === 'group' && Array.isArray(t.subTasks)) walk(t.subTasks);
                if (patched) return;
            }
        }

        walk(tasks);
        return { tasks: tasks, patched: patched };
    }

    return {
        parseTasks: parseTasks,
        getOriginalScriptFromTask: getOriginalScriptFromTask,
        findSiblingScriptLink: findSiblingScriptLink,
        resolveScriptSource: resolveScriptSource,
        isRecordingTaskType: isRecordingTaskType,
        taskSupportsAIGrading: taskSupportsAIGrading,
        patchTaskScriptInTree: patchTaskScriptInTree
    };
})();

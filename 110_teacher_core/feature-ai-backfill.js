/**
 * 📂 110_teacher_core/feature-ai-backfill.js
 * 🌟 教師端：為已繳交、尚未 AI 批改的錄音／上傳任務補啟批改
 */
window.FeatureAIBackfill = (function () {
    let cachedContext = null;

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function flattenRecordingTasks(tasks) {
        const res = [];
        if (!Array.isArray(tasks)) return res;
        tasks.forEach(function (t) {
            if (t.type === 'group' && Array.isArray(t.subTasks)) {
                res.push.apply(res, flattenRecordingTasks(t.subTasks));
            } else if (window.TaskScriptResolver && window.TaskScriptResolver.isRecordingTaskType(t)) {
                res.push(t);
            }
        });
        return res;
    }

    function buildDriveAudioUrl(fileId) {
        return 'https://drive.google.com/file/d/' + String(fileId) + '/view';
    }

    function getAudioFileIdFromCompletion(comp) {
        const raw = comp.raw_data || {};
        if (Array.isArray(raw.drive_file_ids) && raw.drive_file_ids.length > 0) {
            return String(raw.drive_file_ids[0]);
        }
        const url = raw.student_audio_url || raw.audio_url;
        if (url && window.GasService && typeof window.GasService.extractFileIdFromUrl === 'function') {
            return window.GasService.extractFileIdFromUrl(url);
        }
        return null;
    }

    function isEligibleForBackfill(comp) {
        if (!comp || comp.deleted_at) return false;
        if (comp.status === 'ai_processing') return false;
        if (!getAudioFileIdFromCompletion(comp)) return false;
        const raw = comp.raw_data || {};
        if (raw.ai_evaluation && (comp.status === 'ai_ready' || comp.status === 'completed')) return false;
        return true;
    }

    function hasAiRecord(comp) {
        if (!comp || comp.deleted_at) return false;
        if (comp.status === 'ai_processing') return false;
        const raw = comp.raw_data || {};
        return !!(raw.ai_evaluation
            || (Array.isArray(raw.ai_evaluations) && raw.ai_evaluations.length)
            || (Array.isArray(raw.grading_history) && raw.grading_history.length)
            || raw.ai_error_log);
    }

    function scanBackfillJobs(assignments, completions, students) {
        const jobs = [];
        const studentMap = {};
        (students || []).forEach(function (s) {
            studentMap[s.id] = s;
        });

        (assignments || []).forEach(function (assignment) {
            const tasks = window.TaskScriptResolver
                ? window.TaskScriptResolver.parseTasks(assignment.tasks)
                : (assignment.tasks || []);
            const recordingTasks = flattenRecordingTasks(tasks);

            recordingTasks.forEach(function (task) {
                if (!window.TaskScriptResolver.taskSupportsAIGrading(task, tasks)) return;

                const scriptInfo = window.TaskScriptResolver.resolveScriptSource(tasks, task.id);
                const eligible = (completions || []).filter(function (c) {
                    return String(c.assignment_id) === String(assignment.id)
                        && String(c.task_id) === String(task.id)
                        && isEligibleForBackfill(c);
                }).map(function (c) {
                    return {
                        completion: c,
                        student: studentMap[c.student_id] || { id: c.student_id, name: '未知學生' },
                        fileId: getAudioFileIdFromCompletion(c)
                    };
                });

                if (eligible.length === 0) return;

                const title = task.title ? String(task.title).replace(/<[^>]*>?/gm, '') : '未命名任務';
                jobs.push({
                    assignmentId: assignment.id,
                    assignmentTitle: assignment.title || '未命名作業',
                    targetDate: assignment.target_date || '',
                    taskId: task.id,
                    taskTitle: title,
                    scriptInfo: scriptInfo,
                    eligible: eligible
                });
            });
        });

        return jobs;
    }

    function scanClearableJobs(assignments, completions, students) {
        const jobs = [];
        const studentMap = {};
        (students || []).forEach(function (s) {
            studentMap[s.id] = s;
        });

        (assignments || []).forEach(function (assignment) {
            const tasks = window.TaskScriptResolver
                ? window.TaskScriptResolver.parseTasks(assignment.tasks)
                : (assignment.tasks || []);
            const recordingTasks = flattenRecordingTasks(tasks);

            recordingTasks.forEach(function (task) {
                const withRecord = (completions || []).filter(function (c) {
                    return String(c.assignment_id) === String(assignment.id)
                        && String(c.task_id) === String(task.id)
                        && hasAiRecord(c);
                }).map(function (c) {
                    return {
                        completion: c,
                        student: studentMap[c.student_id] || { id: c.student_id, name: '未知學生' }
                    };
                });

                if (withRecord.length === 0) return;

                const title = task.title ? String(task.title).replace(/<[^>]*>?/gm, '') : '未命名任務';
                jobs.push({
                    assignmentId: assignment.id,
                    assignmentTitle: assignment.title || '未命名作業',
                    targetDate: assignment.target_date || '',
                    taskId: task.id,
                    taskTitle: title,
                    withRecord: withRecord
                });
            });
        });

        return jobs;
    }

    async function extractScriptFromLink(scriptLinkUrl) {
        if (!scriptLinkUrl) throw new Error('找不到文稿連結');
        if (!window.GasService || typeof window.GasService.extractSheetData !== 'function') {
            throw new Error('GasService 尚未載入，無法從試算表萃取文稿');
        }
        const text = await window.GasService.extractSheetData(scriptLinkUrl, 'Sheet1', 'A1:Z500');
        if (!text || !String(text).trim()) {
            throw new Error('文稿連結萃取結果為空，請至作業編輯器手動設定朗讀文稿');
        }
        return String(text).trim();
    }

    async function ensureScriptOnAssignment(assignmentId, taskId, tasks, scriptInfo) {
        if (scriptInfo.scriptText && scriptInfo.scriptText.trim()) {
            return scriptInfo.scriptText.trim();
        }

        if (scriptInfo.scriptLinkUrl) {
            const extracted = await extractScriptFromLink(scriptInfo.scriptLinkUrl);
            const patch = window.TaskScriptResolver.patchTaskScriptInTree(
                tasks,
                taskId,
                extracted,
                scriptInfo.scriptLinkUrl
            );
            if (!patch.patched) throw new Error('無法寫入作業任務文稿');

            const { error } = await window.supabaseClient
                .from('assignments')
                .update({ tasks: patch.tasks })
                .eq('id', assignmentId);
            if (error) throw new Error('更新作業文稿失敗：' + error.message);
            return extracted;
        }

        throw new Error('此任務缺少朗讀文稿，且同群組找不到 audio 連結');
    }

    async function triggerBackfill(classId, jobKey, studentIds) {
        if (!cachedContext) throw new Error('資料已過期，請重新整理進度表');

        const job = cachedContext.jobs.find(function (j) {
            return j.key === jobKey;
        });
        if (!job) throw new Error('找不到指定的補批任務');

        const targets = job.eligible.filter(function (e) {
            return studentIds.indexOf(e.student.id) > -1;
        });
        if (targets.length === 0) throw new Error('沒有可補批的學生');

        const assignment = cachedContext.assignments.find(function (a) {
            return String(a.id) === String(job.assignmentId);
        });
        if (!assignment) throw new Error('找不到作業資料');

        const tasks = window.TaskScriptResolver.parseTasks(assignment.tasks);
        const scriptText = await ensureScriptOnAssignment(
            job.assignmentId,
            job.taskId,
            tasks,
            job.scriptInfo
        );
        job.scriptInfo.scriptText = scriptText;

        let ok = 0;
        let fail = 0;
        const errors = [];

        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            const audioUrl = buildDriveAudioUrl(t.fileId);
            try {
                // 學生錄音是「一頁一檔」，補批改也要跟著一頁一份文稿送 AI；
                // 如果這筆繳交本來就有多檔（raw_data.audio_segments），要原樣整批帶回去，
                // 不能只補第一檔，否則會被 RPC 蓋成單檔、文稿退回整份合併稿，跟音檔對不上。
                const existingSegments = (t.completion && t.completion.raw_data && Array.isArray(t.completion.raw_data.audio_segments) && t.completion.raw_data.audio_segments.length > 1)
                    ? t.completion.raw_data.audio_segments
                    : null;
                const rpcPayload = {
                    p_assignment_id: job.assignmentId,
                    p_task_id: job.taskId,
                    p_student_id: t.student.id,
                    p_class_id: classId,
                    p_file_id: t.fileId,
                    p_audio_url: audioUrl
                };
                if (existingSegments) rpcPayload.p_segments = existingSegments;
                const { error: rpcErr } = await window.supabaseClient.rpc('submit_audio_task_atomic', rpcPayload);
                if (rpcErr) throw rpcErr;
                ok++;
            } catch (err) {
                fail++;
                errors.push((t.student.name || t.student.id) + '：' + (err.message || err));
            }
        }

        let msg = '已為 ' + ok + ' 位學生啟動 AI 批改。';
        if (fail > 0) {
            msg += '\n\n失敗 ' + fail + ' 筆：\n' + errors.slice(0, 5).join('\n');
        }
        window.showFlash(msg, fail > 0 ? 'error' : 'success');

        if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
            window.FeatureProgress.refresh(classId);
        }
    }

    async function clearAiRecords(classId, jobKey, studentIds) {
        if (!cachedContext) throw new Error('資料已過期，請重新整理進度表');

        const job = cachedContext.clearJobs.find(function (j) {
            return j.key === jobKey;
        });
        if (!job) throw new Error('找不到指定的批改紀錄');

        const targets = job.withRecord.filter(function (e) {
            return studentIds.indexOf(e.student.id) > -1;
        });
        if (targets.length === 0) throw new Error('沒有可清除的學生');

        let ok = 0;
        let fail = 0;
        const errors = [];

        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            try {
                const raw = Object.assign({}, t.completion.raw_data || {});
                delete raw.ai_evaluation;
                delete raw.ai_evaluations;
                delete raw.grading_history;
                delete raw.ai_error_log;
                delete raw.failed_at;
                delete raw.ai_skip_reason;
                delete raw.ai_skipped_at;
                delete raw.ai_segment_cursor;
                delete raw.assignment_text;
                delete raw.grading_policy_snapshot;
                if (Array.isArray(raw.audio_segments)) {
                    raw.audio_segments = raw.audio_segments.map(function (seg) {
                        const cleanSeg = Object.assign({}, seg);
                        delete cleanSeg.ai_evaluation;
                        delete cleanSeg.graded_at;
                        delete cleanSeg.error;
                        cleanSeg.status = 'pending';
                        return cleanSeg;
                    });
                }

                const { error: updErr } = await window.supabaseClient
                    .from('task_completions')
                    .update({ status: 'submitted', raw_data: raw })
                    .eq('id', t.completion.id);
                if (updErr) throw updErr;
                ok++;
            } catch (err) {
                fail++;
                errors.push((t.student.name || t.student.id) + '：' + (err.message || err));
            }
        }

        let msg = '已清除 ' + ok + ' 位學生的 AI 批改紀錄。';
        if (fail > 0) {
            msg += '\n\n失敗 ' + fail + ' 筆：\n' + errors.slice(0, 5).join('\n');
        }
        window.showFlash(msg, fail > 0 ? 'error' : 'success');

        if (window.FeatureProgress && typeof window.FeatureProgress.refresh === 'function') {
            window.FeatureProgress.refresh(classId);
        }
    }

    function renderPanel(classId, assignments, completions, students) {
        if (!window.TaskScriptResolver) {
            return '<div style="padding:16px;color:#94A3B8;">文稿解析模組尚未載入。</div>';
        }

        const jobs = scanBackfillJobs(assignments, completions, students).map(function (j, idx) {
            j.key = j.assignmentId + '_' + j.taskId + '_' + idx;
            return j;
        });
        const clearJobs = scanClearableJobs(assignments, completions, students).map(function (j, idx) {
            j.key = 'clear_' + j.assignmentId + '_' + j.taskId + '_' + idx;
            return j;
        });

        cachedContext = { classId: classId, assignments: assignments, jobs: jobs, clearJobs: clearJobs };

        let backfillHtml = '';
        if (jobs.length === 0) {
            backfillHtml = `
                <div style="background:white;padding:20px;border-radius:12px;border:2px solid #E2E8F0;margin-top:20px;">
                    <h3 style="margin:0 0 8px;color:#4338CA;">🤖 補啟 AI 批改（教師端）</h3>
                    <p style="margin:0;color:#64748B;font-size:0.95rem;">目前沒有「已繳交音檔、尚未 AI 批改」的 Recording／錄音任務。歷史補批請在此操作，學生端不提供此功能。</p>
                </div>
            `;
        } else {
            let rows = '';
            jobs.forEach(function (job) {
                const scriptLabel = job.scriptInfo.scriptText
                    ? '任務內文稿（' + job.scriptInfo.scriptText.length + ' 字）'
                    : ('同群組文稿連結：' + (job.scriptInfo.scriptLinkUrl || '—'));
                const studentNames = job.eligible.map(function (e) {
                    return esc(e.student.name);
                }).join('、');
                rows += `
                    <tr>
                        <td style="border:1px solid #E2E8F0;padding:10px;vertical-align:top;">
                            <div style="font-weight:900;color:#1E293B;">${esc(job.targetDate)} · ${esc(job.assignmentTitle)}</div>
                            <div style="color:#64748B;font-size:0.85rem;margin-top:4px;">${esc(job.taskTitle)}</div>
                        </td>
                        <td style="border:1px solid #E2E8F0;padding:10px;font-size:0.85rem;color:#475569;max-width:280px;word-break:break-all;">${esc(scriptLabel)}</td>
                        <td style="border:1px solid #E2E8F0;padding:10px;font-size:0.85rem;color:#334155;">${job.eligible.length} 人<br><span style="color:#94A3B8;">${studentNames}</span></td>
                        <td style="border:1px solid #E2E8F0;padding:10px;text-align:center;white-space:nowrap;">
                            <button type="button" class="btn btn-action" style="background:#7C3AED;color:white;border:none;font-weight:800;"
                                onclick="window.FeatureAIBackfill.runBatch('${esc(classId)}','${esc(job.key)}')">
                                補啟 AI 批改
                            </button>
                        </td>
                    </tr>
                `;
            });

            backfillHtml = `
                <div style="background:white;padding:20px;border-radius:12px;border:2px solid #DDD6FE;margin-top:20px;">
                    <h3 style="margin:0 0 8px;color:#5B21B6;display:flex;align-items:center;gap:8px;">🤖 補啟 AI 批改（教師端）</h3>
                    <p style="margin:0 0 16px;color:#64748B;font-size:0.9rem;line-height:1.5;">
                        針對<strong>已繳交錄音／音檔</strong>但尚未完成 AI 批改的作業，由老師在此批次觸發。
                        文稿來源：Recording 任務設定的文字，或<strong>同群組 audio 連結</strong>（即學生端的文稿連結，非上傳音檔）。
                    </p>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;min-width:640px;">
                            <thead>
                                <tr style="background:#F5F3FF;">
                                    <th style="border:1px solid #E2E8F0;padding:8px;text-align:left;">作業／任務</th>
                                    <th style="border:1px solid #E2E8F0;padding:8px;text-align:left;">文稿來源</th>
                                    <th style="border:1px solid #E2E8F0;padding:8px;text-align:left;">待補批</th>
                                    <th style="border:1px solid #E2E8F0;padding:8px;">操作</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        let clearHtml = '';
        if (clearJobs.length > 0) {
            let clearRows = '';
            clearJobs.forEach(function (job) {
                const studentNames = job.withRecord.map(function (e) {
                    return esc(e.student.name);
                }).join('、');
                clearRows += `
                    <tr>
                        <td style="border:1px solid #E2E8F0;padding:10px;vertical-align:top;">
                            <div style="font-weight:900;color:#1E293B;">${esc(job.targetDate)} · ${esc(job.assignmentTitle)}</div>
                            <div style="color:#64748B;font-size:0.85rem;margin-top:4px;">${esc(job.taskTitle)}</div>
                        </td>
                        <td style="border:1px solid #E2E8F0;padding:10px;font-size:0.85rem;color:#334155;">${job.withRecord.length} 人<br><span style="color:#94A3B8;">${studentNames}</span></td>
                        <td style="border:1px solid #E2E8F0;padding:10px;text-align:center;white-space:nowrap;">
                            <button type="button" class="btn btn-action" style="background:#DC2626;color:white;border:none;font-weight:800;"
                                onclick="window.FeatureAIBackfill.clearBatch('${esc(classId)}','${esc(job.key)}')">
                                🗑 清除 AI 批改紀錄
                            </button>
                        </td>
                    </tr>
                `;
            });

            clearHtml = `
                <div style="background:white;padding:20px;border-radius:12px;border:2px solid #FECACA;margin-top:20px;">
                    <h3 style="margin:0 0 8px;color:#B91C1C;display:flex;align-items:center;gap:8px;">🗑 清除 AI 批改紀錄（教師端）</h3>
                    <p style="margin:0 0 16px;color:#64748B;font-size:0.9rem;line-height:1.5;">
                        清除後會移除該任務目前的 AI 評分／錯字紀錄與批改歷史，狀態退回「已繳交」，可再用上方「補啟 AI 批改」重新送批。
                        <strong>不會</strong>刪除學生已上傳的音檔，也<strong>不會</strong>動到老師手動輸入的成績。
                    </p>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;min-width:520px;">
                            <thead>
                                <tr style="background:#FEF2F2;">
                                    <th style="border:1px solid #E2E8F0;padding:8px;text-align:left;">作業／任務</th>
                                    <th style="border:1px solid #E2E8F0;padding:8px;text-align:left;">已有 AI 紀錄</th>
                                    <th style="border:1px solid #E2E8F0;padding:8px;">操作</th>
                                </tr>
                            </thead>
                            <tbody>${clearRows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        return backfillHtml + clearHtml;
    }

    async function runBatch(classId, jobKey) {
        const job = cachedContext && cachedContext.jobs
            ? cachedContext.jobs.find(function (j) { return j.key === jobKey; })
            : null;
        if (!job) {
            window.showFlash('資料已過期，請重新整理進度表', 'error');
            return;
        }

        const studentIds = job.eligible.map(function (e) { return e.student.id; });
        if (studentIds.length === 0) {
            window.showFlash('沒有可補批的學生', 'error');
            return;
        }

        const ok = confirm(
            '確定要為「' + job.taskTitle + '」的 ' + studentIds.length + ' 位學生補啟 AI 批改嗎？\n\n'
            + '若任務尚未設定文稿，系統會嘗試從同群組 audio 連結（試算表）萃取。'
        );
        if (!ok) return;

        try {
            await triggerBackfill(classId, jobKey, studentIds);
        } catch (err) {
            window.showFlash('補啟失敗：' + (err.message || err), 'error');
        }
    }

    async function clearBatch(classId, jobKey) {
        const job = cachedContext && cachedContext.clearJobs
            ? cachedContext.clearJobs.find(function (j) { return j.key === jobKey; })
            : null;
        if (!job) {
            window.showFlash('資料已過期，請重新整理進度表', 'error');
            return;
        }

        const studentIds = job.withRecord.map(function (e) { return e.student.id; });
        if (studentIds.length === 0) {
            window.showFlash('沒有可清除的學生', 'error');
            return;
        }

        const ok = confirm(
            '確定要清除「' + job.taskTitle + '」共 ' + studentIds.length + ' 位學生的 AI 批改紀錄嗎？\n\n'
            + '此動作無法復原（AI 評分、錯字診斷、批改歷史都會被移除，狀態退回「已繳交」）。'
        );
        if (!ok) return;

        try {
            await clearAiRecords(classId, jobKey, studentIds);
        } catch (err) {
            window.showFlash('清除失敗：' + (err.message || err), 'error');
        }
    }

    return {
        renderPanel: renderPanel,
        runBatch: runBatch,
        clearBatch: clearBatch
    };
})();

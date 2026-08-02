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
        const segs = Array.isArray(raw.audio_segments) ? raw.audio_segments : [];
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (!seg) continue;
            const fid = seg.file_id || seg.id;
            if (fid) return String(fid);
        }
        const url = raw.student_audio_url || raw.audio_url;
        if (url && window.GasService && typeof window.GasService.extractFileIdFromUrl === 'function') {
            return window.GasService.extractFileIdFromUrl(url);
        }
        return null;
    }

    function hasAudioPayload(comp) {
        if (getAudioFileIdFromCompletion(comp)) return true;
        const raw = (comp && comp.raw_data) || {};
        const segs = Array.isArray(raw.audio_segments) ? raw.audio_segments : [];
        return segs.some(function (s) {
            return !!(s && (s.file_id || s.id || s.audio_url));
        });
    }

    /** 學生列標籤：標出「批改中／可能卡住」與分段進度，避免看起來像沒這筆 */
    function formatEligibleStudentLabel(entry) {
        const c = entry.completion;
        const name = esc(entry.student.name);
        if (!isAiProcessingOpen(c)) return name;
        const stats = getSegmentStats(c);
        const stuck = isStuckAiProcessing(c);
        let badge = stuck
            ? '<span style="color:#B91C1C;font-weight:800;">可能卡住</span>'
            : '<span style="color:#B45309;font-weight:800;">批改中</span>';
        if (stats.total > 0) {
            badge += ' <span style="color:#64748B;">(' + stats.done + '/' + stats.total + ' 段)</span>';
        }
        if (stats.step) {
            badge += ' <span style="color:#94A3B8;font-size:0.8rem;">· ' + esc(String(stats.step)) + '</span>';
        }
        const segs = ((c.raw_data && c.raw_data.audio_segments) || []);
        if (Array.isArray(segs) && segs.length > 1) {
            const chips = segs.map(function (s, idx) {
                const label = (s && (s.label || s.unit_key)) ? String(s.label || s.unit_key) : ('#' + (idx + 1));
                let color = '#94A3B8';
                let mark = '等待';
                if (s && s.status === 'done' && s.ai_evaluation) {
                    color = '#047857';
                    mark = '完成';
                } else if (s && s.status === 'processing') {
                    color = '#7C3AED';
                    mark = '中';
                } else if (s && s.status === 'error') {
                    color = '#DC2626';
                    mark = '失敗';
                }
                return '<span style="color:' + color + ';font-size:0.75rem;margin-right:6px;">' + esc(label) + ':' + mark + '</span>';
            }).join('');
            badge += '<div style="margin-top:2px;">' + chips + '</div>';
        }
        return name + ' ' + badge;
    }

    /**
     * 續跑卡住的 ai_processing：保留已 done 段（不重打 Speechace），
     * 未完成改回 pending；先 submitted 再 ai_processing 以重觸 webhook。
     */
    async function resumeStuckProcessing(classId, assignmentId, taskId, studentId, completion) {
        const raw = Object.assign({}, (completion && completion.raw_data) || {});
        const segs = Array.isArray(raw.audio_segments) ? raw.audio_segments : [];
        if (segs.length > 0) {
            raw.audio_segments = segs.map(function (seg) {
                const next = Object.assign({}, seg);
                if (next.status === 'done' && next.ai_evaluation) {
                    return next;
                }
                delete next.error;
                delete next.claimed_at;
                next.status = 'pending';
                return next;
            });
        }
        raw.ai_segment_heartbeat = new Date().toISOString();
        delete raw.ai_error_log;
        delete raw.failed_at;
        delete raw.ai_skip_reason;
        delete raw.ai_skipped_at;

        const keyFilter = function (q) {
            return q
                .eq('assignment_id', assignmentId)
                .eq('task_id', taskId)
                .eq('student_id', studentId)
                .eq('class_id', classId);
        };

        // 同狀態 UPDATE 常不重觸 webhook；先離開 ai_processing 再回來
        const { error: step1 } = await keyFilter(
            window.supabaseClient.from('task_completions').update({ status: 'submitted', raw_data: raw })
        );
        if (step1) throw step1;

        const { error: step2 } = await keyFilter(
            window.supabaseClient.from('task_completions').update({
                status: 'ai_processing',
                raw_data: raw
            })
        );
        if (step2) throw step2;

        // 不在此再 functions.invoke：webhook 會因 status 變化觸發；
        // 雙路徑喚醒在 continue bug 時會放大成 Edge 風暴、拖垮登入。
    }

    function getSegmentStats(comp) {
        const raw = (comp && comp.raw_data) || {};
        const segs = Array.isArray(raw.audio_segments) ? raw.audio_segments : [];
        let done = 0;
        let pending = 0;
        let processing = 0;
        let error = 0;
        segs.forEach(function (s) {
            if (!s) return;
            if (s.status === 'done' && s.ai_evaluation) done++;
            else if (s.status === 'processing') processing++;
            else if (s.status === 'error') error++;
            else if (s.status === 'pending' || !s.status) pending++;
        });
        return {
            total: segs.length,
            done: done,
            pending: pending,
            processing: processing,
            error: error,
            heartbeat: raw.ai_segment_heartbeat || '',
            step: (raw.ai_pipeline && raw.ai_pipeline.current_step_label) ||
                (raw.ai_pipeline && raw.ai_pipeline.current_step) || ''
        };
    }

    /**
     * 💣 雷區（見 .cursor/rules/ai-grading-pipeline-invariants.mdc）：
     * ai_processing 必須能進「補啟／續跑」或「清除」，禁止兩邊都排除導致動不了。
     */
    function isAiProcessingOpen(comp) {
        return !!(comp && !comp.deleted_at && comp.status === 'ai_processing');
    }

    function isStuckAiProcessing(comp) {
        if (!isAiProcessingOpen(comp)) return false;
        const raw = comp.raw_data || {};
        const segs = raw.audio_segments;
        if (!Array.isArray(segs) || segs.length === 0) return true;

        const STUCK_MS = 3 * 60 * 1000; // 3 分鐘無心跳即標「可能卡住」（仍一律可操作）
        const hb = Date.parse(String(raw.ai_segment_heartbeat || '')) || 0;
        const updated = Date.parse(String(comp.updated_at || '')) || 0;
        const lastBeat = Math.max(hb, updated);
        if (!lastBeat) return true;
        return (Date.now() - lastBeat) >= STUCK_MS;
    }

    function isEligibleForBackfill(comp) {
        if (!comp || comp.deleted_at) return false;
        if (!hasAudioPayload(comp)) return false;
        // 批改中必須可重送／續跑，否則兩邊列表都沒有 → 動不了
        if (comp.status === 'ai_processing') return true;
        const raw = comp.raw_data || {};
        if (raw.ai_evaluation && (comp.status === 'ai_ready' || comp.status === 'completed' || comp.status === 'graded')) return false;
        return true;
    }

    function hasAiRecord(comp) {
        if (!comp || comp.deleted_at) return false;
        // 批改中也可「清除」解鎖（含部分已完成的多段）
        if (comp.status === 'ai_processing') return true;
        const raw = comp.raw_data || {};
        return !!(raw.ai_evaluation
            || (Array.isArray(raw.ai_evaluations) && raw.ai_evaluations.length)
            || (Array.isArray(raw.grading_history) && raw.grading_history.length)
            || raw.ai_error_log
            || (Array.isArray(raw.audio_segments) && raw.audio_segments.some(function (s) {
                return s && (s.ai_evaluation || s.status === 'done' || s.status === 'error');
            })));
    }

    function indexCompletionsByAssignTask(completions) {
        const map = {};
        (completions || []).forEach(function (c) {
            if (!c) return;
            const key = String(c.assignment_id) + '\t' + String(c.task_id);
            if (!map[key]) map[key] = [];
            map[key].push(c);
        });
        return map;
    }

    function scanBackfillJobs(assignments, completions, students) {
        const jobs = [];
        const studentMap = {};
        (students || []).forEach(function (s) {
            studentMap[s.id] = s;
        });
        const byAssignTask = indexCompletionsByAssignTask(completions);

        (assignments || []).forEach(function (assignment) {
            const tasks = window.TaskScriptResolver
                ? window.TaskScriptResolver.parseTasks(assignment.tasks)
                : (assignment.tasks || []);
            const recordingTasks = flattenRecordingTasks(tasks);

            recordingTasks.forEach(function (task) {
                if (!window.TaskScriptResolver.taskSupportsAIGrading(task, tasks)) return;

                const scriptInfo = window.TaskScriptResolver.resolveScriptSource(tasks, task.id);
                const bucket = byAssignTask[String(assignment.id) + '\t' + String(task.id)] || [];
                const eligible = bucket.filter(function (c) {
                    return isEligibleForBackfill(c);
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
        const byAssignTask = indexCompletionsByAssignTask(completions);

        (assignments || []).forEach(function (assignment) {
            const tasks = window.TaskScriptResolver
                ? window.TaskScriptResolver.parseTasks(assignment.tasks)
                : (assignment.tasks || []);
            const recordingTasks = flattenRecordingTasks(tasks);

            recordingTasks.forEach(function (task) {
                const bucket = byAssignTask[String(assignment.id) + '\t' + String(task.id)] || [];
                const withRecord = bucket.filter(function (c) {
                    return hasAiRecord(c);
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

        const idSet = {};
        (studentIds || []).forEach(function (id) { idSet[String(id)] = true; });
        const targets = job.eligible.filter(function (e) {
            return !!idSet[String(e.student.id)];
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
            try {
                // 已在批改中：續跑未完成段，保留 done（RPC 會把全部段打回 pending，浪費 Speechace）
                if (isAiProcessingOpen(t.completion)) {
                    await resumeStuckProcessing(
                        classId,
                        job.assignmentId,
                        job.taskId,
                        t.student.id,
                        t.completion
                    );
                    ok++;
                    continue;
                }

                const fileId = t.fileId || getAudioFileIdFromCompletion(t.completion);
                if (!fileId) throw new Error('找不到音檔 file_id');
                const audioUrl = buildDriveAudioUrl(fileId);

                // 學生錄音是「一頁一檔」，補批改也要跟著一頁一份文稿送 AI；
                // 如果這筆繳交本來就有多檔（raw_data.audio_segments），要原樣整批帶回去，
                // 不能只補第一檔，否則會被 RPC 蓋成單檔、文稿退回整份合併稿，跟音檔對不上。
                const existingSegments = (t.completion && t.completion.raw_data && Array.isArray(t.completion.raw_data.audio_segments) && t.completion.raw_data.audio_segments.length > 1)
                    ? t.completion.raw_data.audio_segments
                    : null;
                const assignKey = (/^\d+$/.test(String(job.assignmentId || '').trim()))
                    ? Number(job.assignmentId)
                    : job.assignmentId;
                const rpcPayload = {
                    p_assignment_id: assignKey,
                    p_task_id: job.taskId,
                    p_student_id: t.student.id,
                    p_class_id: classId,
                    p_file_id: fileId,
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

        const idSet = {};
        (studentIds || []).forEach(function (id) { idSet[String(id)] = true; });
        const targets = job.withRecord.filter(function (e) {
            return !!idSet[String(e.student.id)];
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
                delete raw.ai_segment_heartbeat;
                delete raw.ai_pipeline;
                delete raw.grading_pipeline_log;
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

                // 🌟 這裡不能用 t.completion.id：feature-progress.js 撈 completions 時
                // 沒有 select 'id'（只有 student_id/task_id/assignment_id/status/raw_data/deleted_at），
                // 用不存在的欄位比對會送出 undefined，導致「invalid input syntax for type bigint: "undefined"」。
                // 改用跟「補啟 AI 批改」RPC 一樣的組合鍵（assignment_id + task_id + student_id）比對，
                // 這三個欄位都確定有撈到，且對同一個學生同一個任務唯一。
                const { error: updErr } = await window.supabaseClient
                    .from('task_completions')
                    .update({ status: 'submitted', raw_data: raw })
                    .eq('assignment_id', job.assignmentId)
                    .eq('task_id', job.taskId)
                    .eq('student_id', t.student.id)
                    .eq('class_id', classId);
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
                    <p style="margin:0;color:#64748B;font-size:0.95rem;">目前沒有可補批項目（含「已繳交未批」與「AI 批改中卡住」）。切割後若一直顯示批改中，重整後應會出現在此可重送。</p>
                </div>
            `;
        } else {
            let rows = '';
            jobs.forEach(function (job) {
                const scriptLabel = job.scriptInfo.scriptText
                    ? '任務內文稿（' + job.scriptInfo.scriptText.length + ' 字）'
                    : ('同群組文稿連結：' + (job.scriptInfo.scriptLinkUrl || '—'));
                const studentChecks = job.eligible.map(function (e) {
                    const sid = esc(String(e.student.id));
                    const label = formatEligibleStudentLabel(e);
                    return '<label style="display:flex;align-items:flex-start;gap:6px;margin:4px 0;cursor:pointer;">'
                        + '<input type="checkbox" class="ai-bf-check" data-job="' + esc(job.key) + '" value="' + sid + '" checked style="margin-top:3px;">'
                        + '<span>' + label + '</span></label>';
                }).join('');
                const hasProcessing = job.eligible.some(function (e) {
                    return isAiProcessingOpen(e.completion);
                });
                const btnLabel = hasProcessing ? '續跑／重送 AI' : '補啟 AI 批改';
                rows += `
                    <tr>
                        <td style="border:1px solid #E2E8F0;padding:10px;vertical-align:top;">
                            <div style="font-weight:900;color:#1E293B;">${esc(job.targetDate)} · ${esc(job.assignmentTitle)}</div>
                            <div style="color:#64748B;font-size:0.85rem;margin-top:4px;">${esc(job.taskTitle)}</div>
                        </td>
                        <td style="border:1px solid #E2E8F0;padding:10px;font-size:0.85rem;color:#475569;max-width:280px;word-break:break-all;">${esc(scriptLabel)}</td>
                        <td style="border:1px solid #E2E8F0;padding:10px;font-size:0.85rem;color:#334155;">
                            <div style="font-weight:800;margin-bottom:4px;">${job.eligible.length} 人（可勾選）</div>
                            ${studentChecks}
                        </td>
                        <td style="border:1px solid #E2E8F0;padding:10px;text-align:center;white-space:nowrap;">
                            <button type="button" class="btn btn-action" style="background:#7C3AED;color:white;border:none;font-weight:800;"
                                onclick="window.FeatureAIBackfill.runBatch('${esc(classId)}','${esc(job.key)}')">
                                ${btnLabel}
                            </button>
                        </td>
                    </tr>
                `;
            });

            backfillHtml = `
                <div style="background:white;padding:20px;border-radius:12px;border:2px solid #DDD6FE;margin-top:20px;">
                    <h3 style="margin:0 0 8px;color:#5B21B6;display:flex;align-items:center;gap:8px;">🤖 補啟 AI 批改（教師端）</h3>
                    <p style="margin:0 0 16px;color:#64748B;font-size:0.9rem;line-height:1.5;">
                        針對<strong>已繳交錄音／音檔</strong>但尚未完成 AI 批改的作業（含狀態為「AI 批改中」）由此重送／續跑。
                        續跑會<strong>保留已完成段</strong>，只重跑未完成段。請勾選要處理的學生，避免誤觸已完成的人。
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
                // 預設只勾「批改中／卡住」；已批完的（如 Janice）不勾，避免誤清浪費 API
                const studentChecks = job.withRecord.map(function (e) {
                    const sid = esc(String(e.student.id));
                    const processing = isAiProcessingOpen(e.completion);
                    const stuck = processing && isStuckAiProcessing(e.completion);
                    let tag = '';
                    if (processing) {
                        tag = stuck
                            ? ' <span style="color:#B91C1C;font-weight:800;">(可能卡住)</span>'
                            : ' <span style="color:#B45309;font-weight:800;">(批改中)</span>';
                    } else {
                        tag = ' <span style="color:#64748B;">(已有批改結果)</span>';
                    }
                    const checked = processing ? ' checked' : '';
                    return '<label style="display:flex;align-items:flex-start;gap:6px;margin:4px 0;cursor:pointer;">'
                        + '<input type="checkbox" class="ai-clear-check" data-job="' + esc(job.key) + '" value="' + sid + '"' + checked + ' style="margin-top:3px;">'
                        + '<span>' + esc(e.student.name) + tag + '</span></label>';
                }).join('');
                clearRows += `
                    <tr>
                        <td style="border:1px solid #E2E8F0;padding:10px;vertical-align:top;">
                            <div style="font-weight:900;color:#1E293B;">${esc(job.targetDate)} · ${esc(job.assignmentTitle)}</div>
                            <div style="color:#64748B;font-size:0.85rem;margin-top:4px;">${esc(job.taskTitle)}</div>
                        </td>
                        <td style="border:1px solid #E2E8F0;padding:10px;font-size:0.85rem;color:#334155;">
                            <div style="font-weight:800;margin-bottom:4px;">${job.withRecord.length} 人（請勾選要清的）</div>
                            ${studentChecks}
                        </td>
                        <td style="border:1px solid #E2E8F0;padding:10px;text-align:center;white-space:nowrap;">
                            <button type="button" class="btn btn-action" style="background:#DC2626;color:white;border:none;font-weight:800;"
                                onclick="window.FeatureAIBackfill.clearBatch('${esc(classId)}','${esc(job.key)}')">
                                🗑 清除勾選學生
                            </button>
                        </td>
                    </tr>
                `;
            });

            clearHtml = `
                <div style="background:white;padding:20px;border-radius:12px;border:2px solid #FECACA;margin-top:20px;">
                    <h3 style="margin:0 0 8px;color:#B91C1C;display:flex;align-items:center;gap:8px;">🗑 清除 AI 批改紀錄（教師端）</h3>
                    <p style="margin:0 0 16px;color:#64748B;font-size:0.9rem;line-height:1.5;">
                        <strong>預設只勾「批改中／卡住」</strong>；已批完的學生請勿勾選，否則清掉後重批會再花 Speechace API。
                        清除後狀態退回「已繳交」，可用上方補啟重送。<strong>不會</strong>刪音檔，也<strong>不會</strong>動老師手動成績。
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

    function collectCheckedStudentIds(selector, jobKey) {
        const nodes = document.querySelectorAll(selector + '[data-job="' + jobKey + '"]');
        const ids = [];
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].checked) ids.push(nodes[i].value);
        }
        return ids;
    }

    function studentNamesForIds(entries, studentIds) {
        const set = {};
        studentIds.forEach(function (id) { set[String(id)] = true; });
        return entries.filter(function (e) {
            return set[String(e.student.id)];
        }).map(function (e) {
            return e.student.name || e.student.id;
        });
    }

    async function runBatch(classId, jobKey) {
        const job = cachedContext && cachedContext.jobs
            ? cachedContext.jobs.find(function (j) { return j.key === jobKey; })
            : null;
        if (!job) {
            window.showFlash('資料已過期，請重新整理進度表', 'error');
            return;
        }

        const studentIds = collectCheckedStudentIds('input.ai-bf-check', jobKey);
        if (studentIds.length === 0) {
            window.showFlash('請先勾選要補批的學生', 'error');
            return;
        }

        const selected = studentNamesForIds(job.eligible, studentIds);
        const processingCount = job.eligible.filter(function (e) {
            return studentIds.indexOf(String(e.student.id)) > -1 && isAiProcessingOpen(e.completion);
        }).length;
        const ok = confirm(
            '確定要為「' + job.taskTitle + '」的以下 ' + studentIds.length + ' 位學生補啟／續跑 AI 批改嗎？\n\n'
            + selected.join('、') + '\n\n'
            + (processingCount > 0
                ? ('其中 ' + processingCount + ' 筆為「批改中」：會保留已完成段，只重跑未完成段。\n\n')
                : '')
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

        const studentIds = collectCheckedStudentIds('input.ai-clear-check', jobKey);
        if (studentIds.length === 0) {
            window.showFlash('請先勾選要清除的學生（已批完的預設不勾，避免浪費 API）', 'error');
            return;
        }

        const selected = studentNamesForIds(job.withRecord, studentIds);
        const ok = confirm(
            '確定要清除「' + job.taskTitle + '」以下 ' + studentIds.length + ' 位學生的 AI 批改紀錄嗎？\n\n'
            + selected.join('、') + '\n\n'
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

/**
 * 📂 110_teacher_core/feature-exam-job.js
 * 🌟 教師端：匯出考試出題單 exam_job JSON（對齊 Python 出題系統必填欄位）
 *
 * 只收集意圖：job_id + bank + sheet/range/count + layout + outputs。
 * 不發明卷面公式；不呼叫 Python API。
 */
window.FeatureExamJob = (function () {
    'use strict';

    /** 兩邊約定的題庫清單（可之後改設定檔／DB） */
    const BANK_CATALOG = [
        { id: 'gept2-v1', label: 'GEPT-2 v1', aliases: ['GEPT-2', 'GEPT2', 'gept-2', 'gept2'] }
    ];

    /** 兩邊約定的卷面模板 */
    const LAYOUT_CATALOG = [
        { id: 'gept-translate-5col', label: 'GEPT 翻譯五欄（gept-translate-5col）' }
    ];

    const SHEET_SUGGESTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    const DEFAULT_LINES_PER_PAGE = 10;

    let cachedContext = null; // { classId, className, assignments }

    const state = {
        jobId: '',
        examTitle: '',
        bankId: BANK_CATALOG[0] ? BANK_CATALOG[0].id : '',
        layoutProfileId: LAYOUT_CATALOG[0] ? LAYOUT_CATALOG[0].id : '',
        assignmentId: '',
        taskId: '', // 空＝儲存時新建 exam 任務
        sections: [
            { sheet_id: 'K', range_type: 'page', start: 1, end: 2, count: 20, lines_per_page: DEFAULT_LINES_PER_PAGE }
        ],
        outputs: { pdf: true, answer: true },
        options: {
            shuffle: true,
            force_qnum: true,
            separate_pages: false,
            header_left: '',
            header_center: '',
            header_right: '',
            include_nums: '',
            exclude_nums: '',
            difficulty: ''
        },
        lastPayload: null,
        dirty: false,
        importNote: '' // 從作業帶入時的說明
    };

    function stripHtml(str) {
        return String(str == null ? '' : str).replace(/<[^>]*>?/gm, '').trim();
    }

    function inferBankId(className) {
        const hay = String(className || '');
        for (let i = 0; i < BANK_CATALOG.length; i++) {
            const b = BANK_CATALOG[i];
            if (hay.indexOf(b.label) !== -1 || hay.toLowerCase().indexOf(b.id) !== -1) return b.id;
            const aliases = b.aliases || [];
            for (let j = 0; j < aliases.length; j++) {
                if (hay.toUpperCase().indexOf(String(aliases[j]).toUpperCase()) !== -1) return b.id;
            }
        }
        return BANK_CATALOG[0] ? BANK_CATALOG[0].id : '';
    }

    /**
     * 解析「A pp. 1~2 ; B pp. 1~2」→ sections（尚未分配 count）
     */
    function parseMaterialRangeToSections(rangeText, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        const text = String(rangeText || '').trim();
        if (!text) return [];
        const parts = text.split(/[;；]/);
        const sections = [];
        const seen = {};
        const re = /^\s*([A-Za-z]+)\s*pp?\.?\s*(\d+)\s*(?:[~～\-–—]\s*(\d+))?/i;
        for (let i = 0; i < parts.length; i++) {
            const m = String(parts[i]).trim().match(re);
            if (!m) continue;
            const sheet = m[1].toUpperCase();
            const start = Number(m[2]);
            const end = m[3] ? Number(m[3]) : start;
            if (!sheet || isNaN(start) || isNaN(end)) continue;
            const key = sheet + ':' + start + ':' + end;
            if (seen[key]) continue;
            seen[key] = true;
            const pageSpan = Math.max(1, end - start + 1);
            sections.push({
                sheet_id: sheet,
                range_type: 'page',
                start: start,
                end: end,
                count: pageSpan * lpp,
                lines_per_page: lpp,
                difficulty: '',
                include_nums: '',
                exclude_nums: ''
            });
        }
        return sections;
    }

    /** 從 grading_units（C p.1 / C p.2）合併成 sections */
    function sectionsFromGradingUnits(units, linesPerPage) {
        const lpp = linesPerPage > 0 ? linesPerPage : DEFAULT_LINES_PER_PAGE;
        if (!Array.isArray(units) || !units.length) return [];
        const bySheet = {};
        const order = [];
        units.forEach(function (u) {
            const label = String((u && (u.label || u.unit_key)) || '').trim();
            const m = label.match(/^([A-Za-z]+)\s*p(?:p)?\.?\s*(\d+)/i);
            if (!m) return;
            const sheet = m[1].toUpperCase();
            const page = Number(m[2]);
            if (!bySheet[sheet]) {
                bySheet[sheet] = { sheet_id: sheet, start: page, end: page };
                order.push(sheet);
            } else {
                bySheet[sheet].start = Math.min(bySheet[sheet].start, page);
                bySheet[sheet].end = Math.max(bySheet[sheet].end, page);
            }
        });
        return order.map(function (sheet) {
            const s = bySheet[sheet];
            const pageSpan = Math.max(1, s.end - s.start + 1);
            return {
                sheet_id: s.sheet_id,
                range_type: 'page',
                start: s.start,
                end: s.end,
                count: pageSpan * lpp,
                lines_per_page: lpp
            };
        });
    }

    function distributeTotalCount(sections, totalCount) {
        if (!sections.length || !totalCount || totalCount <= 0) return sections;
        const n = sections.length;
        const base = Math.floor(totalCount / n);
        let rem = totalCount % n;
        return sections.map(function (s, i) {
            const copy = Object.assign({}, s);
            copy.count = base + (i < rem ? 1 : 0);
            return copy;
        });
    }

    /**
     * 從作業既有任務讀：錄音範圍、抽考題數、考試標題
     */
    function extractHintsFromAssignment(assignment) {
        const hints = {
            rangeText: '',
            gradingUnits: null,
            totalCount: 0,
            examTitle: '',
            sourceNotes: []
        };
        if (!assignment) return hints;

        walkTasks(assignment.tasks || [], function (t) {
            if (!t) return;
            if (t.type === 'audio_record') {
                const raw = t.raw_data || {};
                const range = String(raw.material_range || '').trim() || stripHtml(t.title || '');
                if (range && /[A-Za-z]+\s*pp?\.?/i.test(range) && !hints.rangeText) {
                    hints.rangeText = range;
                    hints.sourceNotes.push('錄音任務範圍');
                }
                if (!hints.gradingUnits && Array.isArray(raw.grading_units) && raw.grading_units.length) {
                    hints.gradingUnits = raw.grading_units;
                }
            }
            if (t.type === 'check' || t.type === 'exam') {
                const blob = stripHtml(t.title || '') + ' ' + stripHtml(t.description || '');
                const countMatch = blob.match(/(\d+)\s*題/);
                if (countMatch) {
                    hints.totalCount = Number(countMatch[1]);
                    hints.sourceNotes.push('題數「' + countMatch[1] + ' 題」');
                }
                if (/抽考|考試|test/i.test(blob)) {
                    const tTitle = stripHtml(t.title || '');
                    if (tTitle) hints.examTitle = tTitle;
                }
            }
        });
        return hints;
    }

    function applyHintsFromAssignment(assignment, opts) {
        const options = opts || {};
        const hints = extractHintsFromAssignment(assignment);
        let sections = parseMaterialRangeToSections(hints.rangeText, DEFAULT_LINES_PER_PAGE);
        if (!sections.length && hints.gradingUnits) {
            sections = sectionsFromGradingUnits(hints.gradingUnits, DEFAULT_LINES_PER_PAGE);
            if (sections.length) hints.sourceNotes.push('grading_units');
        }
        if (hints.totalCount > 0 && sections.length) {
            sections = distributeTotalCount(sections, hints.totalCount);
        }
        if (sections.length) {
            state.sections = sections;
        }
        if (hints.examTitle && (options.forceTitle || !state.examTitle)) {
            state.examTitle = hints.examTitle;
        }
        if (cachedContext && cachedContext.className) {
            state.bankId = inferBankId(cachedContext.className);
        }
        if (sections.length || hints.totalCount) {
            const bits = [];
            if (sections.length) bits.push(sections.length + ' 個活頁區段');
            if (hints.totalCount) bits.push('共 ' + hints.totalCount + ' 題（均分到各區段）');
            if (hints.sourceNotes.length) bits.push('來源：' + hints.sourceNotes.join('、'));
            state.importNote = '已從作業帶入：' + bits.join('；');
        } else {
            state.importNote = '此作業找不到可解析的錄音範圍（例如 A pp. 1~2），請手動填區段。';
        }
        return hints;
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function newJobId() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const rand = Math.random().toString(36).slice(2, 6);
        return 'exam-' + y + m + day + '-' + rand;
    }

    function walkTasks(tasks, visitor, parentPath) {
        if (!Array.isArray(tasks)) return;
        const path = parentPath || [];
        tasks.forEach(function (t, idx) {
            visitor(t, path.concat(idx));
            if (t && Array.isArray(t.subTasks)) walkTasks(t.subTasks, visitor, path.concat(idx));
        });
    }

    function findTaskById(tasks, taskId) {
        let found = null;
        walkTasks(tasks, function (t) {
            if (t && String(t.id) === String(taskId)) found = t;
        });
        return found;
    }

    function listExamTasks(assignment) {
        const out = [];
        if (!assignment) return out;
        walkTasks(assignment.tasks || [], function (t) {
            if (t && t.type === 'exam') {
                const raw = t.raw_data || {};
                out.push({
                    id: t.id,
                    title: t.title || raw.exam_title || '(未命名考試)',
                    jobId: raw.exam_job_id || (raw.exam_job && raw.exam_job.job_id) || ''
                });
            }
        });
        return out;
    }

    function getSelectedAssignment() {
        if (!cachedContext || !state.assignmentId) return null;
        return (cachedContext.assignments || []).find(function (a) {
            return String(a.id) === String(state.assignmentId);
        }) || null;
    }

    function markDirty() {
        state.dirty = true;
    }

    function isDirty() {
        return state.dirty;
    }

    function syncSectionsFromDom() {
        const rows = document.querySelectorAll('[data-exam-section]');
        if (!rows.length) return;
        const next = [];
        rows.forEach(function (row) {
            const idx = Number(row.getAttribute('data-exam-section'));
            const sheet = (document.getElementById('exam-sheet-' + idx) || {}).value || '';
            const rangeType = (document.getElementById('exam-range-type-' + idx) || {}).value || 'page';
            const start = Number((document.getElementById('exam-start-' + idx) || {}).value);
            const end = Number((document.getElementById('exam-end-' + idx) || {}).value);
            const count = Number((document.getElementById('exam-count-' + idx) || {}).value);
            const lines = Number((document.getElementById('exam-lpp-' + idx) || {}).value);
            const sec = {
                sheet_id: String(sheet).trim(),
                range_type: rangeType,
                start: start,
                end: end,
                count: count
            };
            if (rangeType === 'page') {
                sec.lines_per_page = isNaN(lines) || lines <= 0 ? 10 : lines;
            }
            next.push(sec);
        });
        state.sections = next;
    }

    function syncFormFromDom() {
        const titleEl = document.getElementById('exam-title');
        const bankEl = document.getElementById('exam-bank');
        const layoutEl = document.getElementById('exam-layout');
        const assignEl = document.getElementById('exam-assignment');
        const taskEl = document.getElementById('exam-task');
        if (titleEl) state.examTitle = String(titleEl.value || '').trim();
        if (bankEl) state.bankId = bankEl.value;
        if (layoutEl) state.layoutProfileId = layoutEl.value;
        if (assignEl) state.assignmentId = assignEl.value;
        if (taskEl) state.taskId = taskEl.value;

        state.outputs.pdf = !!(document.getElementById('exam-out-pdf') || {}).checked;
        state.outputs.answer = !!(document.getElementById('exam-out-answer') || {}).checked;

        const opt = state.options;
        opt.shuffle = !!(document.getElementById('exam-opt-shuffle') || {}).checked;
        opt.force_qnum = !!(document.getElementById('exam-opt-force-qnum') || {}).checked;
        opt.separate_pages = !!(document.getElementById('exam-opt-separate-pages') || {}).checked;
        ['header_left', 'header_center', 'header_right', 'include_nums', 'exclude_nums', 'difficulty'].forEach(function (key) {
            const el = document.getElementById('exam-opt-' + key.replace(/_/g, '-'));
            if (el) opt[key] = String(el.value || '').trim();
        });

        syncSectionsFromDom();
    }

    function validateAndBuildPayload() {
        syncFormFromDom();

        if (!state.jobId) state.jobId = newJobId();
        if (!state.bankId) throw new Error('請選擇 bank_id（題庫）');
        if (!state.layoutProfileId) throw new Error('請選擇 layout_profile_id（卷面模板）');
        if (!state.sections.length) throw new Error('至少需要一個出題區段');

        const sections = [];
        for (let i = 0; i < state.sections.length; i++) {
            const s = state.sections[i];
            if (!s.sheet_id) throw new Error('區段 ' + (i + 1) + '：缺少 sheet_id');
            if (['page', 'qnum', 'row'].indexOf(s.range_type) === -1) {
                throw new Error('區段 ' + (i + 1) + '：range_type 必須是 page／qnum／row');
            }
            if (isNaN(s.start) || isNaN(s.end) || isNaN(s.count)) {
                throw new Error('區段 ' + (i + 1) + '：start／end／count 必須是數字');
            }
            if (s.count <= 0) throw new Error('區段 ' + (i + 1) + '：count 必須 > 0');
            if (s.end < s.start) throw new Error('區段 ' + (i + 1) + '：end 不可小於 start');
            const sec = {
                sheet_id: s.sheet_id,
                range_type: s.range_type,
                start: s.start,
                end: s.end,
                count: s.count
            };
            if (s.range_type === 'page') {
                const lpp = s.lines_per_page > 0 ? s.lines_per_page : 10;
                sec.lines_per_page = lpp;
            }
            if (s.difficulty) sec.difficulty = s.difficulty;
            if (s.include_nums) sec.include_nums = s.include_nums;
            if (s.exclude_nums) sec.exclude_nums = s.exclude_nums;
            sections.push(sec);
        }

        const outputs = [];
        if (state.outputs.pdf) outputs.push('pdf');
        if (state.outputs.answer) outputs.push('answer');
        if (!outputs.length) throw new Error('outputs 至少選一項（pdf 或 answer）');

        const options = {
            shuffle: !!state.options.shuffle,
            force_qnum: !!state.options.force_qnum,
            separate_pages: !!state.options.separate_pages
        };
        ['header_left', 'header_center', 'header_right', 'include_nums', 'exclude_nums', 'difficulty'].forEach(function (key) {
            if (state.options[key]) options[key] = state.options[key];
        });

        const payload = {
            job_id: state.jobId,
            bank_id: state.bankId,
            layout_profile_id: state.layoutProfileId,
            sections: sections,
            outputs: outputs,
            options: options
        };

        const a = getSelectedAssignment();
        payload.context = {
            class_id: cachedContext ? cachedContext.classId : '',
            class_name: cachedContext ? (cachedContext.className || '') : '',
            assignment_id: state.assignmentId || '',
            task_id: state.taskId || '',
            exam_title: state.examTitle || ''
        };
        if (a) {
            payload.context.assignment_title = a.title || '';
            payload.context.target_date = a.target_date || '';
        }

        return payload;
    }

    function downloadJson(payload) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exam_job_' + payload.job_id + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    async function copyJson(payload) {
        const text = JSON.stringify(payload, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    /**
     * 把 exam_job 寫進指定作業的 exam 任務 raw_data（新建或更新）
     */
    async function persistToAssignment(payload) {
        if (!state.assignmentId) {
            throw new Error('請先選擇要綁定的作業，才能寫入任務 raw_data');
        }
        if (!window.supabaseClient) throw new Error('Supabase 尚未就緒');

        const { data: row, error } = await window.supabaseClient
            .from('assignments')
            .select('id, tasks, title')
            .eq('id', state.assignmentId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error) throw error;
        if (!row) throw new Error('找不到作業');

        let tasks = Array.isArray(row.tasks) ? JSON.parse(JSON.stringify(row.tasks)) : [];
        const title = state.examTitle || ('考試 ' + payload.job_id);
        const rawPatch = {
            exam_job_id: payload.job_id,
            exam_job: payload,
            exam_title: title
        };

        let target = null;
        if (state.taskId) {
            target = findTaskById(tasks, state.taskId);
            if (!target) throw new Error('找不到選定的考試任務');
            if (target.type !== 'exam') throw new Error('選定的任務不是考試類型');
        } else {
            // 若已有同 job_id 的任務則覆寫
            walkTasks(tasks, function (t) {
                if (!t || t.type !== 'exam') return;
                const rid = (t.raw_data && t.raw_data.exam_job_id) ||
                    (t.raw_data && t.raw_data.exam_job && t.raw_data.exam_job.job_id);
                if (rid && String(rid) === String(payload.job_id)) target = t;
            });
        }

        if (target) {
            target.title = title || target.title;
            target.type = 'exam';
            target.raw_data = Object.assign({}, target.raw_data || {}, rawPatch);
            state.taskId = target.id;
            if (payload.context) payload.context.task_id = target.id;
            target.raw_data.exam_job = payload;
        } else {
            const newId = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            if (payload.context) payload.context.task_id = newId;
            tasks.push({
                id: newId,
                type: 'exam',
                title: title,
                url: '',
                url_text: '',
                description: '',
                due_date: '',
                late_mode: 'infinite',
                grace_period_hours: 0,
                penalty_percentage: 0,
                raw_data: Object.assign({}, rawPatch, { exam_job: payload })
            });
            state.taskId = newId;
        }

        // 同步 cached assignment
        const { data: updated, error: upErr } = await window.supabaseClient
            .from('assignments')
            .update({ tasks: tasks })
            .eq('id', state.assignmentId)
            .is('deleted_at', null)
            .select('id, tasks')
            .maybeSingle();
        if (upErr) throw upErr;

        const nextTasks = updated && updated.tasks ? updated.tasks : tasks;
        if (cachedContext && Array.isArray(cachedContext.assignments)) {
            const a = cachedContext.assignments.find(function (x) {
                return String(x.id) === String(state.assignmentId);
            });
            if (a) a.tasks = nextTasks;
        }
        if (window.TeacherDB && Array.isArray(window.TeacherDB.assignments)) {
            const dbA = window.TeacherDB.assignments.find(function (x) {
                return String(x.id) === String(state.assignmentId);
            });
            if (dbA) dbA.tasks = nextTasks;
        }

        return state.taskId;
    }

    // ============ UI ============

    function renderSectionRow(sec, idx) {
        const sheetOpts = SHEET_SUGGESTIONS.map(function (s) {
            return '<option value="' + esc(s) + '"></option>';
        }).join('');
        const showLpp = sec.range_type === 'page';
        return `
            <div data-exam-section="${idx}" style="border:1px solid #E2E8F0; border-radius:10px; padding:12px; margin-bottom:10px; background:#F8FAFC;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="color:#334155;">區段 ${idx + 1}</strong>
                    <button type="button" class="btn" style="padding:2px 8px; font-size:0.8rem; color:#B91C1C;"
                        onclick="window.FeatureExamJob._removeSection(${idx})" ${state.sections.length <= 1 ? 'disabled' : ''}>刪除</button>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:8px;">
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">sheet_id
                        <input id="exam-sheet-${idx}" list="exam-sheet-list-${idx}" type="text" class="form-control"
                            value="${esc(sec.sheet_id)}" placeholder="例如 K"
                            style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">
                        <datalist id="exam-sheet-list-${idx}">${sheetOpts}</datalist>
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">range_type
                        <select id="exam-range-type-${idx}" class="form-control" style="width:100%; padding:6px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onRangeTypeChange(${idx}, this.value)">
                            <option value="page" ${sec.range_type === 'page' ? 'selected' : ''}>page（頁）</option>
                            <option value="qnum" ${sec.range_type === 'qnum' ? 'selected' : ''}>qnum（題號）</option>
                            <option value="row" ${sec.range_type === 'row' ? 'selected' : ''}>row（資料列）</option>
                        </select>
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">start
                        <input id="exam-start-${idx}" type="number" class="form-control" value="${esc(sec.start)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">end
                        <input id="exam-end-${idx}" type="number" class="form-control" value="${esc(sec.end)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700;">count（題數）
                        <input id="exam-count-${idx}" type="number" class="form-control" value="${esc(sec.count)}"
                            style="width:100%; padding:6px; margin-top:2px;" onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.75rem; color:#64748B; font-weight:700; ${showLpp ? '' : 'opacity:0.4;'}">lines_per_page
                        <input id="exam-lpp-${idx}" type="number" class="form-control" value="${esc(sec.lines_per_page || 10)}"
                            style="width:100%; padding:6px; margin-top:2px;" ${showLpp ? '' : 'disabled'}
                            onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                </div>
            </div>
        `;
    }

    function renderModalContentHtml() {
        const bankOpts = BANK_CATALOG.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (state.bankId === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>';
        }).join('');
        const layoutOpts = LAYOUT_CATALOG.map(function (l) {
            return '<option value="' + esc(l.id) + '"' + (state.layoutProfileId === l.id ? ' selected' : '') + '>' + esc(l.label) + '</option>';
        }).join('');

        const assignOpts = (cachedContext.assignments || []).map(function (a) {
            return '<option value="' + esc(a.id) + '"' + (String(state.assignmentId) === String(a.id) ? ' selected' : '') + '>'
                + esc((a.target_date || '') + ' · ' + (a.title || a.id)) + '</option>';
        }).join('');

        const examTasks = listExamTasks(getSelectedAssignment());
        const taskOpts = '<option value="">＋ 新建考試任務</option>' + examTasks.map(function (t) {
            return '<option value="' + esc(t.id) + '"' + (String(state.taskId) === String(t.id) ? ' selected' : '') + '>'
                + esc(t.title + (t.jobId ? '（' + t.jobId + '）' : '')) + '</option>';
        }).join('');

        const sectionsHtml = state.sections.map(renderSectionRow).join('');
        const preview = state.lastPayload
            ? '<pre id="exam-json-preview" style="margin:0; max-height:180px; overflow:auto; font-size:0.75rem; background:#0F172A; color:#E2E8F0; padding:10px; border-radius:8px;">'
                + esc(JSON.stringify(state.lastPayload, null, 2)) + '</pre>'
            : '<div id="exam-json-preview" style="color:#94A3B8; font-size:0.85rem;">儲存或預覽後會顯示 JSON。</div>';

        return `
            <div style="background:white; border-radius:14px; padding:24px; max-width:820px; width:100%; max-height:92vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                    <h2 style="margin:0; color:#0F766E;">📝 考試出題單（匯出 exam_job）</h2>
                    <button type="button" onclick="window.FeatureExamJob._close()" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:#94A3B8;">✕</button>
                </div>
                <p style="margin:0 0 14px; color:#64748B; font-size:0.88rem; line-height:1.5;">
                    選作業後會<strong>自動帶入</strong>該作業錄音範圍（如 A pp. 1~2）與「N 題」說明；再補卷面模板即可匯出給 Python。
                    排版公式不在這裡設定。
                </p>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">綁定作業（寫入任務 raw_data）*
                        <select id="exam-assignment" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onAssignmentChange(this.value)">
                            <option value="">請選擇作業</option>
                            ${assignOpts}
                        </select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">考試任務
                        <select id="exam-task" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onTaskChange(this.value)">
                            ${taskOpts}
                        </select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">job_id（自動產生）
                        <input id="exam-job-id" type="text" class="form-control" value="${esc(state.jobId)}" readonly
                            style="width:100%; padding:8px; margin-top:2px; background:#F1F5F9;">
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">考試名稱（寫入 context／任務標題）
                        <input id="exam-title" type="text" class="form-control" value="${esc(state.examTitle)}"
                            placeholder="例如 Test／抽考" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">bank_id *
                        <select id="exam-bank" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">${bankOpts}</select>
                    </label>
                    <label style="font-size:0.8rem; color:#64748B; font-weight:800;">layout_profile_id *
                        <select id="exam-layout" class="form-control" style="width:100%; padding:8px; margin-top:2px;"
                            onchange="window.FeatureExamJob._onFieldChange()">${layoutOpts}</select>
                    </label>
                </div>

                ${state.importNote
                    ? '<div style="background:#F0FDFA; border:1px solid #99F6E4; color:#0F766E; padding:8px 12px; border-radius:8px; margin-bottom:12px; font-size:0.85rem; font-weight:700;">' + esc(state.importNote) + '</div>'
                    : ''}

                <div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                    <strong style="color:#334155;">出題區段 sections *</strong>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-action" style="padding:4px 10px; font-size:0.8rem; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;"
                            onclick="window.FeatureExamJob._importFromAssignment()" ${state.assignmentId ? '' : 'disabled'}>↻ 重新從作業帶入</button>
                        <button type="button" class="btn btn-action" style="padding:4px 10px; font-size:0.8rem; background:#CCFBF1; color:#0F766E; border:1px solid #99F6E4;"
                            onclick="window.FeatureExamJob._addSection()">＋ 加區段</button>
                    </div>
                </div>
                <div id="exam-sections">${sectionsHtml}</div>

                <div style="display:flex; gap:16px; flex-wrap:wrap; margin:12px 0; font-size:0.85rem; font-weight:700; color:#334155;">
                    <label><input id="exam-out-pdf" type="checkbox" ${state.outputs.pdf ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> outputs: pdf</label>
                    <label><input id="exam-out-answer" type="checkbox" ${state.outputs.answer ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> outputs: answer</label>
                    <label><input id="exam-opt-shuffle" type="checkbox" ${state.options.shuffle ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> shuffle</label>
                    <label><input id="exam-opt-force-qnum" type="checkbox" ${state.options.force_qnum ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> force_qnum</label>
                    <label><input id="exam-opt-separate-pages" type="checkbox" ${state.options.separate_pages ? 'checked' : ''} onchange="window.FeatureExamJob._onFieldChange()"> separate_pages</label>
                </div>

                <details style="margin-bottom:12px;">
                    <summary style="cursor:pointer; color:#64748B; font-weight:700; font-size:0.85rem;">進階 options（表頭／含題／難度…）</summary>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:8px;">
                        <input id="exam-opt-header-left" class="form-control" placeholder="header_left" value="${esc(state.options.header_left)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-header-center" class="form-control" placeholder="header_center" value="${esc(state.options.header_center)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-header-right" class="form-control" placeholder="header_right" value="${esc(state.options.header_right)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-include-nums" class="form-control" placeholder="include_nums" value="${esc(state.options.include_nums)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-exclude-nums" class="form-control" placeholder="exclude_nums" value="${esc(state.options.exclude_nums)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                        <input id="exam-opt-difficulty" class="form-control" placeholder="difficulty" value="${esc(state.options.difficulty)}" onchange="window.FeatureExamJob._onFieldChange()" style="padding:6px;">
                    </div>
                </details>

                <div style="margin-bottom:12px;">${preview}</div>

                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" class="btn btn-action" style="background:#0F766E; color:white; border:none; font-weight:800;"
                        onclick="window.FeatureExamJob._preview()">👁 預覽 JSON</button>
                    <button type="button" class="btn btn-action" style="background:#059669; color:white; border:none; font-weight:800;"
                        onclick="window.FeatureExamJob._saveAndExport()">💾 儲存任務並下載 JSON</button>
                    <button type="button" class="btn" style="font-weight:700;"
                        onclick="window.FeatureExamJob._copyOnly()">📋 複製 JSON</button>
                    <button type="button" class="btn" style="font-weight:700;"
                        onclick="window.FeatureExamJob._newJobId()">🔄 換新 job_id</button>
                </div>
            </div>
        `;
    }

    function renderBody() {
        const el = document.getElementById('exam-job-modal');
        if (!el) return;
        el.innerHTML = renderModalContentHtml();
    }

    function onFieldChange() {
        markDirty();
        syncFormFromDom();
    }

    function onRangeTypeChange(idx, value) {
        syncFormFromDom();
        if (state.sections[idx]) state.sections[idx].range_type = value;
        markDirty();
        renderBody();
    }

    function onAssignmentChange(id) {
        syncFormFromDom();
        state.assignmentId = id;
        state.taskId = '';
        state.importNote = '';
        const a = getSelectedAssignment();
        if (a) {
            applyHintsFromAssignment(a, { forceTitle: true });
            window.showFlash(state.importNote || '已選作業', state.sections.length ? 'success' : 'warning');
        }
        markDirty();
        renderBody();
    }

    function importFromAssignment() {
        syncFormFromDom();
        const a = getSelectedAssignment();
        if (!a) {
            window.showFlash('請先選擇作業', 'error');
            return;
        }
        applyHintsFromAssignment(a, { forceTitle: false });
        markDirty();
        renderBody();
        window.showFlash(state.importNote || '已重新帶入', state.sections.length ? 'success' : 'warning');
    }

    function onTaskChange(id) {
        syncFormFromDom();
        state.taskId = id;
        const a = getSelectedAssignment();
        const t = a && id ? findTaskById(a.tasks || [], id) : null;
        if (t && t.raw_data && t.raw_data.exam_job) {
            loadFromPayload(t.raw_data.exam_job, t.title || t.raw_data.exam_title || '');
            state.importNote = '已載入此考試任務既有的 exam_job。';
        }
        markDirty();
        renderBody();
    }

    function loadFromPayload(payload, title) {
        if (!payload) return;
        state.jobId = payload.job_id || state.jobId || newJobId();
        state.examTitle = title || (payload.context && payload.context.exam_title) || state.examTitle;
        state.bankId = payload.bank_id || state.bankId;
        state.layoutProfileId = payload.layout_profile_id || state.layoutProfileId;
        state.sections = Array.isArray(payload.sections) && payload.sections.length
            ? payload.sections.map(function (s) {
                return {
                    sheet_id: s.sheet_id || '',
                    range_type: s.range_type || 'page',
                    start: s.start,
                    end: s.end,
                    count: s.count,
                    lines_per_page: s.lines_per_page || 10
                };
            })
            : state.sections;
        const outs = payload.outputs || [];
        state.outputs.pdf = outs.indexOf('pdf') !== -1;
        state.outputs.answer = outs.indexOf('answer') !== -1;
        if (payload.options) {
            Object.keys(state.options).forEach(function (k) {
                if (payload.options[k] !== undefined) state.options[k] = payload.options[k];
            });
        }
        state.lastPayload = payload;
    }

    function addSection() {
        syncFormFromDom();
        state.sections.push({
            sheet_id: 'K',
            range_type: 'page',
            start: 1,
            end: 1,
            count: 10,
            lines_per_page: 10
        });
        markDirty();
        renderBody();
    }

    function removeSection(idx) {
        syncFormFromDom();
        if (state.sections.length <= 1) return;
        state.sections.splice(idx, 1);
        markDirty();
        renderBody();
    }

    function preview() {
        try {
            const payload = validateAndBuildPayload();
            state.lastPayload = payload;
            renderBody();
            window.showFlash('JSON 預覽已更新', 'success');
        } catch (err) {
            window.showFlash(err.message || String(err), 'error');
        }
    }

    async function saveAndExport() {
        try {
            const payload = validateAndBuildPayload();
            await persistToAssignment(payload);
            state.lastPayload = payload;
            state.dirty = false;
            downloadJson(payload);
            renderBody();
            window.showFlash('已寫入考試任務並下載 exam_job（job_id: ' + payload.job_id + '）', 'success');
            if (window.FeatureProgress && cachedContext && typeof window.FeatureProgress.refresh === 'function') {
                // 不強制刷新進度表，避免打斷；老師可自行重整
            }
        } catch (err) {
            console.error('[FeatureExamJob]', err);
            window.showFlash('儲存／匯出失敗：' + (err.message || err), 'error');
        }
    }

    async function copyOnly() {
        try {
            const payload = validateAndBuildPayload();
            state.lastPayload = payload;
            await copyJson(payload);
            renderBody();
            window.showFlash('已複製 JSON（尚未寫入任務；若要對回請按「儲存任務並下載」）', 'success');
        } catch (err) {
            window.showFlash(err.message || String(err), 'error');
        }
    }

    function rotateJobId() {
        state.jobId = newJobId();
        state.taskId = '';
        markDirty();
        renderBody();
    }

    function closeModal() {
        window.ModalOverlay.close('exam-job-modal');
    }

    function resetState() {
        state.jobId = newJobId();
        state.examTitle = '';
        state.bankId = BANK_CATALOG[0] ? BANK_CATALOG[0].id : '';
        state.layoutProfileId = LAYOUT_CATALOG[0] ? LAYOUT_CATALOG[0].id : '';
        state.assignmentId = '';
        state.taskId = '';
        state.sections = [
            { sheet_id: 'K', range_type: 'page', start: 1, end: 2, count: 20, lines_per_page: 10 }
        ];
        state.outputs = { pdf: true, answer: true };
        state.options = {
            shuffle: true,
            force_qnum: true,
            separate_pages: false,
            header_left: '',
            header_center: '',
            header_right: '',
            include_nums: '',
            exclude_nums: '',
            difficulty: ''
        };
        state.lastPayload = null;
        state.dirty = false;
        state.importNote = '';
        if (cachedContext && cachedContext.className) {
            state.bankId = inferBankId(cachedContext.className) || state.bankId;
        }
    }

    function renderEntryButton(classId, assignments, className) {
        cachedContext = {
            classId: classId,
            className: className || '',
            assignments: assignments || []
        };
        return `
            <button type="button" class="btn btn-action" onclick="window.FeatureExamJob.openModal()"
                style="background:#F0FDFA; color:#0F766E; border:1px solid #99F6E4; font-weight:800;">
                📝 考試出題單（快捷）
            </button>
        `;
    }

    function openModal() {
        if (!cachedContext) {
            window.showFlash('請先開啟班級進度總表再使用出題單', 'error');
            return;
        }
        resetState();
        window.ModalOverlay.open({
            id: 'exam-job-modal',
            tier: 'B',
            isDirty: isDirty,
            unsavedMessage: '出題單尚未儲存，確定要關閉嗎？',
            contentHtml: renderModalContentHtml()
        });
    }

    /**
     * 作業編輯器內嵌：考試任務卡片上的出題區段表（對齊 Python 出題列欄位）
     */
    function renderInlineEditorHtml(pathStr, task) {
        const raw = (task && task.raw_data) || {};
        const job = raw.exam_job || {};
        const jobId = raw.exam_job_id || job.job_id || '';
        const bankId = job.bank_id || (BANK_CATALOG[0] && BANK_CATALOG[0].id) || '';
        const layoutId = job.layout_profile_id || (LAYOUT_CATALOG[0] && LAYOUT_CATALOG[0].id) || '';
        const outs = job.outputs || ['pdf', 'answer'];
        let sections = Array.isArray(job.sections) ? job.sections : [];
        if (!sections.length) {
            sections = [{
                sheet_id: '',
                range_type: 'page',
                start: 1,
                end: 1,
                count: 10,
                lines_per_page: DEFAULT_LINES_PER_PAGE,
                difficulty: '',
                include_nums: '',
                exclude_nums: ''
            }];
        }
        const bankOpts = BANK_CATALOG.map(function (b) {
            return '<option value="' + esc(b.id) + '"' + (bankId === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>';
        }).join('');
        const layoutOpts = LAYOUT_CATALOG.map(function (l) {
            return '<option value="' + esc(l.id) + '"' + (layoutId === l.id ? ' selected' : '') + '>' + esc(l.label) + '</option>';
        }).join('');

        const rows = sections.map(function (s, idx) {
            return `
                <tr data-exam-inline-row="${idx}">
                    <td style="padding:4px;"><input id="exam-inline-sheet-${pathStr}-${idx}" class="form-control" value="${esc(s.sheet_id || '')}" style="width:52px; padding:4px;" placeholder="C"></td>
                    <td style="padding:4px;"><input id="exam-inline-lpp-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.lines_per_page || DEFAULT_LINES_PER_PAGE)}" style="width:56px; padding:4px;"></td>
                    <td style="padding:4px;">
                        <select id="exam-inline-rtype-${pathStr}-${idx}" class="form-control" style="padding:4px; min-width:72px;">
                            <option value="page" ${(s.range_type || 'page') === 'page' ? 'selected' : ''}>頁碼</option>
                            <option value="qnum" ${s.range_type === 'qnum' ? 'selected' : ''}>題號</option>
                            <option value="row" ${s.range_type === 'row' ? 'selected' : ''}>資料列</option>
                        </select>
                    </td>
                    <td style="padding:4px;"><input id="exam-inline-start-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.start)}" style="width:56px; padding:4px;"></td>
                    <td style="padding:4px;"><input id="exam-inline-end-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.end)}" style="width:56px; padding:4px;"></td>
                    <td style="padding:4px;"><input id="exam-inline-diff-${pathStr}-${idx}" class="form-control" value="${esc(s.difficulty || '')}" style="width:64px; padding:4px;" placeholder="—"></td>
                    <td style="padding:4px;"><input id="exam-inline-inc-${pathStr}-${idx}" class="form-control" value="${esc(s.include_nums || '')}" style="width:64px; padding:4px;" placeholder="—"></td>
                    <td style="padding:4px;"><input id="exam-inline-exc-${pathStr}-${idx}" class="form-control" value="${esc(s.exclude_nums || '')}" style="width:64px; padding:4px;" placeholder="—"></td>
                    <td style="padding:4px;"><input id="exam-inline-count-${pathStr}-${idx}" type="number" class="form-control" value="${esc(s.count)}" style="width:56px; padding:4px;"></td>
                    <td style="padding:4px;"><button type="button" class="btn" style="padding:2px 6px; color:#B91C1C;" onclick="window.FeatureExamJob._inlineRemoveSection('${pathStr}', ${idx})">刪</button></td>
                </tr>
            `;
        }).join('');

        return `
            <div id="exam-inline-wrap-${pathStr}" style="margin-top:8px; padding:12px; background:#F0FDFA; border:1px solid #99F6E4; border-radius:8px; font-size:0.82rem; color:#0F766E;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                    <strong>📝 考試出題區段（作業端設定 → 匯出給 Python）</strong>
                    <span style="font-size:0.75rem; color:#64748B;">job_id：<code id="exam-inline-jobid-${pathStr}">${esc(jobId || '（儲存作業時產生）')}</code></span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                    <label style="font-weight:700;">bank_id
                        <select id="exam-inline-bank-${pathStr}" class="form-control" style="width:100%; padding:6px; margin-top:2px;">${bankOpts}</select>
                    </label>
                    <label style="font-weight:700;">layout_profile_id
                        <select id="exam-inline-layout-${pathStr}" class="form-control" style="width:100%; padding:6px; margin-top:2px;">${layoutOpts}</select>
                    </label>
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:8px; font-weight:700;">
                    <label><input id="exam-inline-out-pdf-${pathStr}" type="checkbox" ${outs.indexOf('pdf') !== -1 ? 'checked' : ''}> pdf</label>
                    <label><input id="exam-inline-out-answer-${pathStr}" type="checkbox" ${outs.indexOf('answer') !== -1 ? 'checked' : ''}> answer</label>
                    <label><input id="exam-inline-shuffle-${pathStr}" type="checkbox" ${(job.options && job.options.shuffle === false) ? '' : 'checked'}> shuffle</label>
                    <label>總題數預設均分 <input id="exam-inline-total-${pathStr}" type="number" class="form-control" style="width:70px; display:inline-block; padding:4px;" placeholder="60">
                        <button type="button" class="btn" style="padding:2px 8px;" onclick="window.FeatureExamJob._inlineDistribute('${pathStr}')">均分到各區段</button>
                    </label>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.78rem; min-width:720px;">
                        <thead>
                            <tr style="background:#CCFBF1; color:#134E4A; text-align:left;">
                                <th style="padding:4px;">活頁</th>
                                <th style="padding:4px;">每頁行數</th>
                                <th style="padding:4px;">基準</th>
                                <th style="padding:4px;">起始</th>
                                <th style="padding:4px;">結束</th>
                                <th style="padding:4px;">難度</th>
                                <th style="padding:4px;">指定#</th>
                                <th style="padding:4px;">排除#</th>
                                <th style="padding:4px;">題數</th>
                                <th style="padding:4px;"></th>
                            </tr>
                        </thead>
                        <tbody id="exam-inline-tbody-${pathStr}">${rows}</tbody>
                    </table>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#CCFBF1; color:#0F766E; border:1px solid #99F6E4;"
                        onclick="window.FeatureExamJob._inlineAddSection('${pathStr}')">＋ 加區段</button>
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#FEF3C7; color:#92400E; border:1px solid #FDE68A;"
                        onclick="window.FeatureExamJob._inlineImportFromSiblingAudio('${pathStr}')">↻ 從同作業錄音範圍帶入</button>
                    <button type="button" class="btn btn-action" style="padding:4px 10px; background:#059669; color:white; border:none;"
                        onclick="window.FeatureExamJob._inlineExport('${pathStr}')">⬇ 下載 exam_job JSON</button>
                </div>
                <div style="margin-top:6px; color:#64748B; font-size:0.75rem;">欄位公式／可用題／顯示% 由 Python 依 layout 與題庫計算；網站只交意圖。均分只是預設，各區段題數可改。</div>
            </div>
        `;
    }

    function readInlineSections(pathStr) {
        const rows = document.querySelectorAll('#exam-inline-tbody-' + pathStr + ' tr[data-exam-inline-row]');
        const sections = [];
        rows.forEach(function (row) {
            const idx = row.getAttribute('data-exam-inline-row');
            const sheet = (document.getElementById('exam-inline-sheet-' + pathStr + '-' + idx) || {}).value || '';
            const lpp = Number((document.getElementById('exam-inline-lpp-' + pathStr + '-' + idx) || {}).value);
            const rtype = (document.getElementById('exam-inline-rtype-' + pathStr + '-' + idx) || {}).value || 'page';
            const start = Number((document.getElementById('exam-inline-start-' + pathStr + '-' + idx) || {}).value);
            const end = Number((document.getElementById('exam-inline-end-' + pathStr + '-' + idx) || {}).value);
            const count = Number((document.getElementById('exam-inline-count-' + pathStr + '-' + idx) || {}).value);
            const difficulty = String((document.getElementById('exam-inline-diff-' + pathStr + '-' + idx) || {}).value || '').trim();
            const include_nums = String((document.getElementById('exam-inline-inc-' + pathStr + '-' + idx) || {}).value || '').trim();
            const exclude_nums = String((document.getElementById('exam-inline-exc-' + pathStr + '-' + idx) || {}).value || '').trim();
            const sec = {
                sheet_id: String(sheet).trim(),
                range_type: rtype,
                start: start,
                end: end,
                count: count,
                lines_per_page: isNaN(lpp) || lpp <= 0 ? DEFAULT_LINES_PER_PAGE : lpp
            };
            if (difficulty) sec.difficulty = difficulty;
            if (include_nums) sec.include_nums = include_nums;
            if (exclude_nums) sec.exclude_nums = exclude_nums;
            sections.push(sec);
        });
        return sections;
    }

    function syncInlineEditor(pathStr, task) {
        if (!task) return;
        if (!task.raw_data) task.raw_data = {};
        const bankEl = document.getElementById('exam-inline-bank-' + pathStr);
        const layoutEl = document.getElementById('exam-inline-layout-' + pathStr);
        if (!bankEl && !layoutEl) return; // 非 exam 或尚未渲染

        let jobId = task.raw_data.exam_job_id || (task.raw_data.exam_job && task.raw_data.exam_job.job_id) || '';
        if (!jobId) jobId = newJobId();

        const outputs = [];
        if ((document.getElementById('exam-inline-out-pdf-' + pathStr) || {}).checked) outputs.push('pdf');
        if ((document.getElementById('exam-inline-out-answer-' + pathStr) || {}).checked) outputs.push('answer');
        if (!outputs.length) outputs.push('pdf');

        const sections = readInlineSections(pathStr);
        const shuffle = !!(document.getElementById('exam-inline-shuffle-' + pathStr) || {}).checked;
        const payload = {
            job_id: jobId,
            bank_id: bankEl ? bankEl.value : '',
            layout_profile_id: layoutEl ? layoutEl.value : '',
            sections: sections,
            outputs: outputs,
            options: { shuffle: shuffle, force_qnum: true, separate_pages: false }
        };
        task.raw_data.exam_job_id = jobId;
        task.raw_data.exam_title = String(task.title || '').replace(/<[^>]*>?/gm, '').trim() || task.raw_data.exam_title || '';
        task.raw_data.exam_job = payload;
        const jobIdEl = document.getElementById('exam-inline-jobid-' + pathStr);
        if (jobIdEl) jobIdEl.textContent = jobId;
        return payload;
    }

    function getBuilderTaskByPath(pathStr) {
        if (!window.BuilderStore || typeof window.BuilderStore.getState !== 'function') return null;
        const bState = window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks)) return null;
        const arr = String(pathStr).split('-').map(Number);
        let list = bState.tasks;
        let node = null;
        for (let i = 0; i < arr.length; i++) {
            node = list[arr[i]];
            if (!node) return null;
            if (i < arr.length - 1) list = node.subTasks || [];
        }
        return node;
    }

    function inlineAddSection(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = task.raw_data.exam_job || { sections: [] };
        if (!Array.isArray(job.sections)) job.sections = [];
        job.sections.push({
            sheet_id: '',
            range_type: 'page',
            start: 1,
            end: 1,
            count: 10,
            lines_per_page: DEFAULT_LINES_PER_PAGE
        });
        task.raw_data.exam_job = job;
        if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder();
        } else if (window.FeatureTimeline && window.FeatureTimeline.changeNodeType) {
            window.FeatureTimeline.changeNodeType(pathStr, 'exam');
        }
    }

    function inlineRemoveSection(pathStr, idx) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = task.raw_data.exam_job;
        if (!job || !Array.isArray(job.sections) || job.sections.length <= 1) return;
        job.sections.splice(idx, 1);
        if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder();
        } else if (window.FeatureTimeline && window.FeatureTimeline.changeNodeType) {
            window.FeatureTimeline.changeNodeType(pathStr, 'exam');
        }
    }

    function inlineDistribute(pathStr) {
        const totalEl = document.getElementById('exam-inline-total-' + pathStr);
        const total = Number(totalEl && totalEl.value);
        if (!total || total <= 0) {
            window.showFlash('請先填總題數（例如 60）', 'error');
            return;
        }
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        syncInlineEditor(pathStr, task);
        const job = task.raw_data.exam_job;
        if (!job || !job.sections || !job.sections.length) return;
        job.sections = distributeTotalCount(job.sections, total);
        if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder();
        }
        window.showFlash('已將 ' + total + ' 題均分到各區段（可再逐列修改）', 'success');
    }

    function inlineImportFromSiblingAudio(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        const bState = window.BuilderStore && window.BuilderStore.getState();
        if (!task || !bState) return;
        syncInlineEditor(pathStr, task);
        const fakeAssignment = { tasks: bState.tasks || [], title: bState.title || '' };
        const hints = extractHintsFromAssignment(fakeAssignment);
        let sections = parseMaterialRangeToSections(hints.rangeText, DEFAULT_LINES_PER_PAGE);
        if (!sections.length && hints.gradingUnits) {
            sections = sectionsFromGradingUnits(hints.gradingUnits, DEFAULT_LINES_PER_PAGE);
        }
        const totalEl = document.getElementById('exam-inline-total-' + pathStr);
        let total = Number(totalEl && totalEl.value) || hints.totalCount || 0;
        if (total > 0 && sections.length) sections = distributeTotalCount(sections, total);
        if (!sections.length) {
            window.showFlash('同作業找不到錄音範圍可帶入', 'warning');
            return;
        }
        if (!task.raw_data.exam_job) task.raw_data.exam_job = {};
        task.raw_data.exam_job.sections = sections;
        if (hints.examTitle && !(task.title || '').replace(/<[^>]*>?/gm, '').trim()) {
            task.title = hints.examTitle;
        }
        if (hints.totalCount && totalEl && !totalEl.value) totalEl.value = String(hints.totalCount);
        if (window.FeatureTimeline && typeof window.FeatureTimeline.refreshBuilder === 'function') {
            window.FeatureTimeline.refreshBuilder();
        }
        window.showFlash('已從同作業錄音範圍帶入 ' + sections.length + ' 個區段', 'success');
    }

    function inlineExport(pathStr) {
        if (window.BuilderStore && typeof window.BuilderStore.sync === 'function') window.BuilderStore.sync();
        const task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        const payload = syncInlineEditor(pathStr, task);
        if (!payload || !payload.sections || !payload.sections.length) {
            window.showFlash('請至少填一個區段', 'error');
            return;
        }
        for (let i = 0; i < payload.sections.length; i++) {
            if (!payload.sections[i].sheet_id) {
                window.showFlash('區段 ' + (i + 1) + ' 缺少活頁 sheet_id', 'error');
                return;
            }
        }
        downloadJson(payload);
        window.showFlash('已下載 exam_job（請記得按「儲存作業」把設定寫進資料庫）', 'success');
    }

    return {
        renderEntryButton: renderEntryButton,
        openModal: openModal,
        renderInlineEditorHtml: renderInlineEditorHtml,
        syncInlineEditor: syncInlineEditor,
        _close: closeModal,
        _onFieldChange: onFieldChange,
        _onRangeTypeChange: onRangeTypeChange,
        _onAssignmentChange: onAssignmentChange,
        _importFromAssignment: importFromAssignment,
        _onTaskChange: onTaskChange,
        _addSection: addSection,
        _removeSection: removeSection,
        _preview: preview,
        _saveAndExport: saveAndExport,
        _copyOnly: copyOnly,
        _newJobId: rotateJobId,
        _inlineAddSection: inlineAddSection,
        _inlineRemoveSection: inlineRemoveSection,
        _inlineDistribute: inlineDistribute,
        _inlineImportFromSiblingAudio: inlineImportFromSiblingAudio,
        _inlineExport: inlineExport
    };
})();

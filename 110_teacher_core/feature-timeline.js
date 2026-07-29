/**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js
 * 🌟 v69 方案 A 收納版：
 * 1. 確保學生端上傳的教材絕對存入 01_Class_Resources 子資料夾。
 * 2. 貫徹鐵律：學生的教材 PDF 絕對只做 Base64 轉換，不做任何文字解析。
 */

console.log("🚀 FeatureTimeline v69 載入成功！(強制收納 01_Class_Resources 與無解析上傳鐵律)");

window.FeatureTimeline = (() => {
    const db = window.TeacherDB;
    
    if (db && db.assignments) {
        const originalLength = db.assignments.length;
        db.assignments = db.assignments.filter(a => a.target_date !== undefined && a.target_date !== null);
        if (db.assignments.length !== originalLength && typeof db.save === 'function') db.save(); 
    }

    let dragAssignId = null; 

    function getClassDriveFolderId(classId) {
        if (!db || !Array.isArray(db.classes)) return '';
        const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return '';
        let raw = cls.raw_data || cls.rawData || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        return raw.drive_folder_id || raw.class_folder_id || '';
    }

    function normalizeMaterialsRootKind(rootKind) {
        return String(rootKind || 'class').trim().toLowerCase() === 'teacher' ? 'teacher' : 'class';
    }

    function readMaterialsRootKind(pathStr) {
        const el = document.getElementById('node-material-root-' + pathStr);
        return normalizeMaterialsRootKind(el ? el.value : 'class');
    }

    async function resolveMaterialsRootFolderId(classId, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        if (kind === 'teacher') {
            if (!window.FeatureResource || typeof window.FeatureResource.getTeacherPersonalDriveFolderId !== 'function') {
                throw new Error('FeatureResource 未載入');
            }
            let folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(true);
            if (!folderId && typeof window.FeatureResource.ensureAndBindTeacherPersonalDrive === 'function') {
                await window.FeatureResource.ensureAndBindTeacherPersonalDrive();
                folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(false);
            }
            if (!folderId) throw new Error('尚未綁定老師個人資料夾');
            return folderId;
        }
        const classFolderId = getClassDriveFolderId(classId);
        if (!classFolderId) throw new Error('此班級尚未設定 Drive 資料夾');
        return classFolderId;
    }

    function collectMaterialMetaOptions(materials, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        const prefix = kind === 'teacher' ? '👤老師 ' : '🏫班級 ';
        const options = [];
        (materials || []).forEach(function (pack) {
            (pack.metaFiles || []).forEach(function (mf) {
                options.push({
                    rootKind: kind,
                    folderName: pack.folderName,
                    fileName: mf.name,
                    label: prefix + (pack.folderName ? pack.folderName + ' / ' : '') + mf.name
                });
            });
        });
        return options;
    }

    async function loadMaterialMetaOptions(classId, rootKind) {
        const kind = normalizeMaterialsRootKind(rootKind);
        if (!window.GasService || typeof window.GasService.listMaterialMasters !== 'function') {
            throw new Error('GasService 尚未載入');
        }
        const folderId = await resolveMaterialsRootFolderId(classId, kind);
        const materials = await window.GasService.listMaterialMasters(folderId, kind);
        return collectMaterialMetaOptions(materials, kind);
    }

    const _materialMetaOptionsCache = {};

    function metaStemFromFileName(fileName) {
        const base = String(fileName || '').replace(/\.meta\.json$/i, '').replace(/\.json$/i, '');
        const parts = base.split(/[\/_]/);
        return parts[parts.length - 1] || base || '?';
    }

    function escapeAttr(str) {
        return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function buildMetaOptionsHtml(options, selectedVal) {
        const opts = options || [];
        if (!opts.length) {
            return '<option value="">（尚無 meta，請先載入／發布）</option>';
        }
        return '<option value="">— 選 meta —</option>' + opts.map(function (opt) {
            const val = opt.folderName + '::' + opt.fileName;
            const sel = val === selectedVal ? ' selected' : '';
            return '<option value="' + escapeAttr(val) + '"' + sel + '>' + escapeAttr(opt.label) + '</option>';
        }).join('');
    }

    function createMaterialMetaRowEl(pathStr, options, rowData) {
        rowData = rowData || {};
        const safePath = String(pathStr || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const wrap = document.createElement('div');
        wrap.className = 'material-meta-row';
        wrap.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:white; border:1px solid #DDD6FE; border-radius:8px; padding:8px;';
        wrap.innerHTML =
            '<select class="form-control material-meta-file" style="flex:1.2; min-width:180px; padding:6px; font-size:0.85rem; font-weight:700;">'
            + buildMetaOptionsHtml(options, rowData.value || '')
            + '</select>'
            + '<input type="text" class="form-control material-meta-range" style="flex:1.4; min-width:200px; padding:6px; font-size:0.85rem; font-weight:700;" '
            + 'placeholder="pp. 1~2, 5, 10 或 #11~16, 26" value="' + escapeAttr(rowData.range_spec || '') + '">'
            + '<button type="button" class="btn-action" style="padding:6px 10px; background:#FEE2E2; color:#B91C1C; border:none; border-radius:6px; font-weight:900; cursor:pointer;" '
            + 'onclick="window.FeatureTimeline.removeMaterialMetaRow(this, \'' + safePath + '\')">×</button>';

        const fileEl = wrap.querySelector('.material-meta-file');
        const rangeEl = wrap.querySelector('.material-meta-range');
        if (fileEl) fileEl.addEventListener('change', function () { refreshMaterialRangeLabel(pathStr); });
        if (rangeEl) rangeEl.addEventListener('input', function () { refreshMaterialRangeLabel(pathStr); });
        return wrap;
    }

    function renderMaterialMetaRows(pathStr, options, rows) {
        const container = document.getElementById('node-material-rows-' + pathStr);
        if (!container) return;
        _materialMetaOptionsCache[pathStr] = options || [];
        container.innerHTML = '';
        const list = Array.isArray(rows) && rows.length ? rows : [{ value: '', range_spec: '' }];
        list.forEach(function (row) {
            container.appendChild(createMaterialMetaRowEl(pathStr, _materialMetaOptionsCache[pathStr], row));
        });
        refreshMaterialRangeLabel(pathStr);
    }

    function readMaterialMetaRows(pathStr) {
        const container = document.getElementById('node-material-rows-' + pathStr);
        if (!container) return [];
        const rootKind = readMaterialsRootKind(pathStr);
        const out = [];
        container.querySelectorAll('.material-meta-row').forEach(function (rowEl) {
            const fileEl = rowEl.querySelector('.material-meta-file');
            const rangeEl = rowEl.querySelector('.material-meta-range');
            const value = fileEl ? String(fileEl.value || '').trim() : '';
            const rangeSpec = rangeEl ? String(rangeEl.value || '').trim() : '';
            if (!value) return;
            const parts = value.split('::');
            out.push({
                materials_root_kind: rootKind,
                material_folder: parts[0] || '',
                published_file: parts[1] || '',
                metaFile: parts[1] || '',
                label: metaStemFromFileName(parts[1] || ''),
                range_spec: rangeSpec,
                select_mode: 'range_spec'
            });
        });
        return out;
    }

    function buildMaterialRangeLabelFromRows(rows) {
        const MS = window.MaterialSnapshot;
        return (rows || []).map(function (m) {
            const stem = m.label || metaStemFromFileName(m.published_file || '');
            if (MS && typeof MS.formatRangeLabel === 'function') {
                return MS.formatRangeLabel(stem, m.range_spec || '');
            }
            return stem + (m.range_spec ? (' ' + m.range_spec) : '');
        }).filter(Boolean).join('；');
    }

    function refreshMaterialRangeLabel(pathStr) {
        const rows = readMaterialMetaRows(pathStr);
        const label = buildMaterialRangeLabelFromRows(rows);
        const rangeEl = document.getElementById('node-material-range-' + pathStr);
        if (rangeEl) rangeEl.value = label;
        const hidden = document.getElementById('node-material-selected-json-' + pathStr);
        if (hidden) {
            hidden.value = JSON.stringify(rows.map(function (m) {
                return {
                    value: (m.material_folder || '') + '::' + (m.published_file || ''),
                    range_spec: m.range_spec || '',
                    label: m.label || ''
                };
            }));
        }
        return label;
    }

    function readSelectedMaterialMetas(pathStr) {
        return readMaterialMetaRows(pathStr);
    }

    async function buildMergedMaterialSnapshot(pathStr, classId) {
        const selected = readMaterialMetaRows(pathStr);
        if (!selected.length) throw new Error('請至少新增一列 meta');
        for (let i = 0; i < selected.length; i++) {
            if (!selected[i].range_spec) {
                throw new Error('第 ' + (i + 1) + ' 列請填範圍（例：pp. 1~2, 5, 10 或 #11~16, 26）');
            }
        }
        const rootKind = readMaterialsRootKind(pathStr);
        const folderId = await resolveMaterialsRootFolderId(classId, rootKind);
        const scriptParts = [];
        const displayParts = [];
        const refs = [];

        for (let i = 0; i < selected.length; i++) {
            const picker = selected[i];
            const fileResult = await window.GasService.readMaterialFile(
                folderId, picker.material_folder, picker.published_file, rootKind
            );
            const rows = window.MaterialSnapshot.parseMetaContent(fileResult.content);
            const sliceOpts = { range_spec: picker.range_spec, select_mode: 'range_spec' };
            const ctx = Object.assign({}, picker, sliceOpts, {
                materials_root_kind: rootKind,
                label: picker.label,
                range_spec: picker.range_spec
            });
            const snapshot = window.MaterialSnapshot.sliceAndBuild(rows, sliceOpts, ctx);
            const stem = picker.label || metaStemFromFileName(picker.published_file);
            if (snapshot.original_script) {
                scriptParts.push('【' + stem + '】\n' + snapshot.original_script);
            }
            if (snapshot.student_display) {
                // student_display 已含 【A】[1] 頁首，勿再包一層
                displayParts.push(snapshot.student_display);
            }
            refs.push(Object.assign({}, snapshot.material_ref, { range_spec: picker.range_spec, label: stem }));
        }

        const rangeLabel = buildMaterialRangeLabelFromRows(selected);
        return {
            material_refs: refs,
            material_ref: refs[0] || null,
            material_range: rangeLabel,
            original_script: scriptParts.join('\n\n'),
            student_display: displayParts.join('\n\n'),
            student_display_text: displayParts.join('\n\n'),
            snapshot_at: new Date().toISOString()
        };
    }

    function toggleMaterialSliceFields(pathStr) {
        // 新版以每列 range_spec 為準，無需切換共用頁碼／題號欄
        refreshMaterialRangeLabel(pathStr);
    }

    function walkAudioRecordNodes(tasks, parentPath, visitor) {
        if (!Array.isArray(tasks)) return;
        tasks.forEach(function (t, idx) {
            const pathArray = parentPath.concat([idx]);
            const pathStr = pathArray.join('-');
            if (t.type === 'audio_record') visitor(t, pathStr);
            if (t.type === 'group' && Array.isArray(t.subTasks)) {
                walkAudioRecordNodes(t.subTasks, pathArray, visitor);
            }
        });
    }

    function refreshMaterialSliceFieldVisibility() {
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState || !Array.isArray(bState.tasks)) return;
        walkAudioRecordNodes(bState.tasks, [], function (_task, pathStr) {
            toggleMaterialSliceFields(pathStr);
        });
    }

    function hydrateMaterialSnapshotUI() {
        const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        if (!bState || !Array.isArray(bState.tasks)) return;

        const pendingMeta = [];
        walkAudioRecordNodes(bState.tasks, [], function (task, pathStr) {
            const raw = task.raw_data || {};
            const refs = Array.isArray(raw.material_refs) && raw.material_refs.length
                ? raw.material_refs
                : (raw.material_ref && raw.material_ref.published_file ? [raw.material_ref] : []);
            const rowsEl = document.getElementById('node-material-rows-' + pathStr);
            if (!rowsEl) return;

            let savedRows = [];
            const hidden = document.getElementById('node-material-selected-json-' + pathStr);
            if (hidden && hidden.value) {
                try {
                    const parsed = JSON.parse(hidden.value);
                    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
                        savedRows = parsed;
                    }
                } catch (_e) {}
            }
            if (!savedRows.length && refs.length) {
                savedRows = refs.map(function (r) {
                    let rangeSpec = r.range_spec || '';
                    if (!rangeSpec) {
                        if (r.select_mode === 'item_range' && r.item_from != null) {
                            rangeSpec = '#' + r.item_from + (r.item_to != null ? ('~' + r.item_to) : '');
                        } else if ((r.select_mode === 'page_range' || r.select_mode === 'page') && (r.page_from != null || r.page != null)) {
                            const a = r.page_from != null ? r.page_from : r.page;
                            const b = r.page_to != null ? r.page_to : a;
                            rangeSpec = 'pp. ' + a + (String(a) !== String(b) ? ('~' + b) : '');
                        } else if (r.select_mode === 'all') {
                            rangeSpec = 'all';
                        }
                    }
                    return {
                        value: (r.material_folder || '') + '::' + (r.published_file || ''),
                        range_spec: rangeSpec,
                        label: r.label || ''
                    };
                });
            }

            pendingMeta.push({
                pathStr: pathStr,
                savedRows: savedRows,
                raw: raw,
                statusEl: document.getElementById('node-material-status-' + pathStr)
            });
        });

        if (pendingMeta.length === 0) return;

        pendingMeta.forEach(function (item) {
            if (item.statusEl) {
                item.statusEl.textContent = '⏳ 還原 meta 清單…';
                item.statusEl.style.color = '#3B82F6';
            }
            const rootEl = document.getElementById('node-material-root-' + item.pathStr);
            const primary = (item.raw.material_refs && item.raw.material_refs[0]) || item.raw.material_ref;
            if (rootEl && primary && primary.materials_root_kind) {
                rootEl.value = normalizeMaterialsRootKind(primary.materials_root_kind);
            }
        });

        pendingMeta.forEach(function (item) {
            const kind = readMaterialsRootKind(item.pathStr);
            loadMaterialMetaOptions(bState.classId, kind).then(function (options) {
                renderMaterialMetaRows(item.pathStr, options, item.savedRows.length ? item.savedRows : [{ value: '', range_spec: '' }]);
                if (item.statusEl) {
                    item.statusEl.textContent = item.raw.snapshot_at
                        ? ('✅ 已還原 snapshot（' + item.raw.snapshot_at + '）')
                        : ('✅ 已載入 ' + options.length + ' 個 meta 檔');
                    item.statusEl.style.color = '#059669';
                }
            }).catch(function (err) {
                if (item.statusEl) {
                    item.statusEl.textContent = '⚠️ meta 清單載入失敗：' + err.message;
                    item.statusEl.style.color = '#D97706';
                }
            });
        });
    }

    function applySnapshotToNode(pathStr, snapshot) {
        const scriptEl = document.getElementById('node-script-' + pathStr);
        const studentTextEl = document.getElementById('node-student-text-' + pathStr);
        const scriptPasteEl = document.getElementById('node-script-paste-' + pathStr);
        const studentPasteEl = document.getElementById('node-student-text-paste-' + pathStr);
        const previewEl = document.getElementById('node-material-preview-' + pathStr);
        const snapshotJsonEl = document.getElementById('node-material-snapshot-json-' + pathStr);
        const scriptSourceEl = document.getElementById('node-script-source-' + pathStr);
        const materialRangeEl = document.getElementById('node-material-range-' + pathStr);

        const displayText = snapshot.student_display || snapshot.student_display_text || '';
        if (scriptEl) scriptEl.value = snapshot.original_script || '';
        if (studentTextEl) studentTextEl.value = displayText;
        if (scriptPasteEl) scriptPasteEl.value = snapshot.original_script || '';
        if (studentPasteEl) studentPasteEl.value = displayText;

        if (scriptSourceEl) {
            scriptSourceEl.value = 'meta';
            if (window.FeatureTimeline && window.FeatureTimeline.onScriptSourceChange) {
                window.FeatureTimeline.onScriptSourceChange(pathStr);
            }
        }

        if (materialRangeEl) {
            if (snapshot.material_range) {
                materialRangeEl.value = snapshot.material_range;
            } else if (snapshot.material_refs && snapshot.material_refs.length) {
                materialRangeEl.value = buildMaterialRangeLabelFromRows(snapshot.material_refs);
            }
        }

        if (previewEl) {
            const refCount = (snapshot.material_refs && snapshot.material_refs.length) || (snapshot.material_ref ? 1 : 0);
            previewEl.textContent = '已合併 ' + refCount + ' 個 meta｜AI 稿 '
                + (snapshot.original_script || '').length + ' 字；學生顯示 '
                + displayText.length + ' 字；凍結於 ' + (snapshot.snapshot_at || '')
                + (snapshot.material_range ? ('｜' + snapshot.material_range) : '');
        }
        if (snapshotJsonEl) snapshotJsonEl.value = JSON.stringify(snapshot);
    }

    function checkCanEditTimeline(classId) {
        if (!db || !db.classes) return false;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return false;
        const userRole = cls.staff_role || (window.TeacherUI && window.TeacherUI.getCurrentUserRole ? window.TeacherUI.getCurrentUserRole(classId) : 'primary_teacher');
        return ['admin', 'primary_teacher', 'co_teacher', 'ta_senior'].includes(userRole);
    }

    const scrollToCurrentWeek = () => {
        if (window.BuilderStore && window.BuilderStore.getState()) return; 
        const targetNode = document.querySelector('.timeline-node[data-is-current="true"]');
        const container = document.querySelector('.view-section.active');
        if (targetNode && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = targetNode.getBoundingClientRect();
            const scrollAmount = nodeRect.top - containerRect.top - 15;
            container.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        }
    };

    function getTimelineSessions(cls, DateUtils) {
        if (!cls) return [];
        let raw = cls.raw_data || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
        }
        
        let sessions = [];
        if (raw.custom_sessions && Array.isArray(raw.custom_sessions) && raw.custom_sessions.length > 0) {
            sessions = [...raw.custom_sessions];
        } else if (db && db.sessions && db.sessions[cls.id] && db.sessions[cls.id].length > 0) {
            sessions = [...db.sessions[cls.id]];
        } else {
            let rawMeet = cls.meetDays || cls.meet_days || raw.meet_days || [];
            if (typeof rawMeet === 'string') {
                if (rawMeet.startsWith('[')) {
                    try { rawMeet = JSON.parse(rawMeet); } catch(e) { rawMeet = []; }
                } else {
                    rawMeet = rawMeet.split(',');
                }
            }
            let meetDays = Array.isArray(rawMeet) ? rawMeet.map(Number).filter(n => !isNaN(n)) : [];
            let startDateStr = cls.startDate || cls.start_date || raw.start_date;
            let endDateStr = cls.endDate || cls.end_date || raw.end_date;

            if (startDateStr && endDateStr && meetDays.length > 0) {
                sessions = DateUtils.generateDates(startDateStr, endDateStr, meetDays);
            }
        }
        
        return sessions.map(d => DateUtils.normalizeDateString(d)).filter(Boolean);
    }

    function renderTimeline(classId, scrollMode = 'current', targetId = null) {
        const container = document.getElementById('timeline-container');
        if (!container) return;

        try {
            const TPL = window.TimelineTemplates; 
            const DateUtils = window.UtilsDate;   

            if (!TPL || !DateUtils) {
                container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 系統錯誤：核心依賴模組遺失。</div>`;
                return;
            }
            
            container.className = '';
            const cls = (db && db.classes) ? db.classes.find(c => c.id === classId) : null;
            if (!cls) {
                container.innerHTML = `<div style="padding:20px; color:#EF4444; font-weight:bold;">⚠️ 找不到該班級的主檔資料</div>`;
                return;
            }
            
            const canEditTimeline = checkCanEditTimeline(classId);
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            const classAssignments = (db && db.assignments) ? db.assignments : [];
            let sessions = getTimelineSessions(cls, DateUtils);

            const assignmentDates = classAssignments
                .filter(a => a.class_id === classId && a.target_date)
                .map(a => DateUtils.normalizeDateString(a.target_date));
            
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            if (sessions.length === 0) {
                container.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px;">無排程資料。請至「⚙️ 課程基本資料」設定學期起訖日與上課日。</p>';
                return;
            }

            const weekStartSetting = raw.week_start_day || 'sunday';
            const todayStr = DateUtils.getTaiwanTodayString();
            const currentWeekStart = DateUtils.getWeekStartStr(todayStr, weekStartSetting);
            
            const mode = cls.calcMode || cls.calc_mode || 'single';

            let timelineNodes = [];
            if (mode === 'single') {
                timelineNodes = sessions.map(d => ({ title: d, dates: [d] }));
            } else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = DateUtils.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => {
                    timelineNodes.push({ title: chunk.length > 1 ? `${chunk[0]} ~ ${chunk[chunk.length-1]}` : chunk[0], dates: chunk });
                });
            }

            let html = '';
            timelineNodes.forEach((node, index) => {
                const nodeWeekStart = DateUtils.getWeekStartStr(node.dates[0], weekStartSetting);
                let isCurrent = (nodeWeekStart === currentWeekStart);
                let isFuture = node.dates[0] > todayStr;
                const nodeDate = node.dates[0];
                const nodeAssignments = classAssignments.filter(a => a.class_id === classId && node.dates.includes(DateUtils.normalizeDateString(a.target_date)));
                
                let assignmentsHtml = '';
                if (nodeAssignments.length > 0) {
                    nodeAssignments.forEach(a => {
                        let effectiveBlockDueDate = a.due_date;
                        let aRaw = a.raw_data || {};
                        if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
                        
                        let blockLateMode = 'infinite', blockPenalty = 0, blockGrace = 0;
                        if (aRaw.late_policy) {
                            if (!aRaw.late_policy.allow_late) blockLateMode = 'no_late';
                            else if (aRaw.late_policy.grace_period_hours > 0) { blockLateMode = 'custom'; blockGrace = aRaw.late_policy.grace_period_hours; }
                            blockPenalty = aRaw.late_policy.penalty_percentage || 0;
                        }
                        const effectiveBlockLatePolicy = { mode: blockLateMode, penalty: blockPenalty, grace: blockGrace };
                        let tasksHtml = TPL.renderReadOnlyTree(a.tasks || [], effectiveBlockDueDate, effectiveBlockLatePolicy, 0);
                        assignmentsHtml += TPL.getAssignmentBlockHtml(a, classId, canEditTimeline, effectiveBlockDueDate, blockLateMode, blockPenalty, blockGrace, tasksHtml);
                    });
                }
                const builderContainerId = `builder-container-${index}`;
                html += TPL.getTimelineNodeHtml(index, mode, node.title, isCurrent, isFuture, nodeDate, classId, canEditTimeline, assignmentsHtml, builderContainerId);
            });
            
            container.innerHTML = TPL.getTimelineStyleBlock();
            const timelineWrapper = document.createElement('div');
            timelineWrapper.style.borderLeft = '3px solid #E2E8F0';
            timelineWrapper.style.marginLeft = '20px';
            timelineWrapper.style.paddingLeft = '50px'; 
            timelineWrapper.innerHTML = html;
            container.appendChild(timelineWrapper);

            if (scrollMode === 'current') {
                setTimeout(scrollToCurrentWeek, 250);
            } else if (scrollMode === 'target' && targetId) {
                setTimeout(() => {
                    const targetEl = document.getElementById(targetId);
                    const viewContainer = document.querySelector('.view-section.active');
                    if (targetEl && viewContainer) {
                        const cRect = viewContainer.getBoundingClientRect();
                        const nRect = targetEl.getBoundingClientRect();
                        viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                    }
                }, 300);
            }

            const viewProgress = document.getElementById('timeline-container').closest('.view-content') || document.getElementById('view-progress');
            if (viewProgress && !window._timelineObserverAttached) {
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
                            const style = window.getComputedStyle(viewProgress);
                            if (style.display !== 'none' && viewProgress.classList.contains('active')) {
                                if (!window.BuilderStore || !window.BuilderStore.getState()) setTimeout(scrollToCurrentWeek, 100); 
                            }
                        }
                    });
                });
                observer.observe(viewProgress, { attributes: true });
                window._timelineObserverAttached = true;
            }

        } catch (error) {
            console.error("Timeline Render Crashed:", error);
            container.innerHTML = `<div style="padding:20px; background:#FEE2E2; border:2px solid #EF4444; border-radius:10px; margin: 20px;"><h3 style="color:#B91C1C; margin-top:0;">⚠️ 進度軸渲染失敗</h3><p style="color:#7F1D1D;">錯誤原因：${error.message}</p></div>`;
        }
    }

    async function renderBuilderUI() {
        const TPL = window.TimelineTemplates;
        if (!window.BuilderStore) return;
        const bState = window.BuilderStore.getState();
        if (!bState || !TPL) return;
        const container = document.getElementById(bState.containerId);
        if (!container) return;

        let classResOpts = '';
        const FR = window.FeatureResource;
        let allResList = (db && db.resourceLibrary) || [];
        let staffIds = [];
        if (FR && typeof FR.fetchClassStaffUserIds === 'function') {
            const staffCacheKey = '_resStaff_' + bState.classId;
            if (!window[staffCacheKey]) {
                window[staffCacheKey] = await FR.fetchClassStaffUserIds(bState.classId);
            }
            staffIds = window[staffCacheKey] || [];
        }
        if (FR && typeof FR.resourceAppliesToClass === 'function') {
            allResList = allResList.filter(function (r) {
                return FR.resourceAppliesToClass(r, bState.classId, staffIds);
            });
        } else {
            allResList = allResList.filter(function (r) {
                return r.scope === 'global' || (r.scope === 'class' && r.target_class_id === bState.classId);
            });
        }

        if (allResList.length > 0) {
            const uniqueResList = (FR && FR.mergeResourcesByUrl)
                ? FR.mergeResourcesByUrl(allResList)
                : allResList;

            classResOpts = uniqueResList.map(function (r) {
                const scopeIcon = r.scope === 'global' ? '🌍' : (r.scope === 'teacher' ? '👥' : '🏷️');
                return '<option value="' + r.id + '">' + r.icon + ' ' + r.name + ' (' + scopeIcon + ')</option>';
            }).join('');
        }

        let tasksHtml = bState.tasks && bState.tasks.length > 0 ? TPL.renderBuilderTree(bState.tasks, [], classResOpts) : '';
        let tasksContainerHtml = tasksHtml ? `<div style="margin-bottom: 15px;">${tasksHtml}</div>` : '';
        const allAssignsForHistory = (db && db.assignments || []).filter(a => a.class_id === bState.classId);
        let historyHtml = (bState.editId) ? `<div style="color:var(--primary); font-weight:900; margin-bottom:15px; font-size:1rem;">「修改模式」</div>` : TPL.getHistoryDropdownHtml(allAssignsForHistory, bState.containerId);

        container.innerHTML = TPL.getBuilderFormHtml(bState, classResOpts, tasksContainerHtml, historyHtml);
        setTimeout(refreshMaterialSliceFieldVisibility, 0);
    }

    return {
        renderTimeline,
        scrollToCurrentWeek,
        
        getTaskParentArray: (pathArray) => window.BuilderStore.getTaskParentArray(pathArray),
        
        openBuilder: (classId, date, containerId) => {
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法新增或修改作業。', 'error');
            window.BuilderStore.initNew(classId, date, containerId);
            renderBuilderUI();
            setTimeout(() => { 
                const titleEl = document.getElementById(`builder-title-${containerId}`);
                if (titleEl) {
                    titleEl.focus(); 
                    const cRect = document.querySelector('.view-section.active').getBoundingClientRect();
                    const nRect = titleEl.getBoundingClientRect();
                    document.querySelector('.view-section.active').scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 50);
        },
        editAssignment: (assignId) => {
            if (!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(a.class_id)) return window.showFlash('權限不足：您的身分無法修改此作業。', 'error');
            
            const cls = db.classes.find(c => c.id === a.class_id) || {};
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }

            let sessions = getTimelineSessions(cls, window.UtilsDate);
            const assignmentDates = db.assignments.filter(ast => ast.class_id === a.class_id).map(ast => window.UtilsDate.normalizeDateString(ast.target_date));
            sessions = [...new Set([...sessions, ...assignmentDates])].filter(Boolean).sort();

            const mode = cls.calcMode || 'single';
            const weekStartSetting = raw.week_start_day || 'sunday';
            let timelineNodes = [];
            if (mode === 'single') timelineNodes = sessions.map(d => ({ dates: [d] }));
            else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = window.UtilsDate.getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => timelineNodes.push({ dates: chunk }));
            }

            const targetDateStr = window.UtilsDate.normalizeDateString(a.target_date);
            const nodeIndex = timelineNodes.findIndex(node => node.dates.includes(targetDateStr));
            const cId = `builder-container-${nodeIndex >= 0 ? nodeIndex : 0}`; 

            window.BuilderStore.initEdit(a, cId);
            renderTimeline(a.class_id, 'none');
            renderBuilderUI();
            
            setTimeout(() => {
                hydrateMaterialSnapshotUI();
                const editorEl = document.getElementById(`${cId}-editor`);
                const viewContainer = document.querySelector('.view-section.active');
                if (editorEl && viewContainer) {
                    const cRect = viewContainer.getBoundingClientRect();
                    const nRect = editorEl.getBoundingClientRect();
                    viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 300);
        },

        applyResourceUrl: (pathStr, resId, targetInputId = null) => {
            if (!resId || !db || !db.resourceLibrary) return;
            const res = db.resourceLibrary.find(r => r.id === resId);
            if (!res) return;
            
            const realUrl = res.url || ''; 
            
            if (targetInputId) {
                const el = document.getElementById(targetInputId);
                if (el) {
                    el.value = realUrl;
                    window.BuilderStore.sync(); 
                }
            } else if (pathStr) {
                window.BuilderStore.updateNodeUrl(pathStr, realUrl);
                renderBuilderUI();
            }
        },

        // 🌟 鐵律實作：學生教材專用，純 Base64 轉換，絕不呼叫 PDF 解析！
        handleStudentLocalFileChange: (inputEl, pathStr) => {
            const file = inputEl.files[0];
            if (!file) {
                document.getElementById(`node-student-local-b64-${pathStr}`).value = '';
                document.getElementById(`node-student-local-mime-${pathStr}`).value = '';
                document.getElementById(`node-student-local-filename-${pathStr}`).value = '';
                return;
            }
            if (file.size > 15 * 1024 * 1024) { 
                window.showFlash('檔案過大，請選擇 15MB 以下的檔案', 'error');
                inputEl.value = '';
                return;
            }
            
            const containerId = window.BuilderStore.getState().containerId;
            const btn = document.getElementById(`btn-save-block-${containerId}`);
            if(btn) { btn.disabled = true; btn.innerHTML = '⏳ 讀取檔案中...'; }

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                document.getElementById(`node-student-local-b64-${pathStr}`).value = base64;
                document.getElementById(`node-student-local-mime-${pathStr}`).value = file.type;
                document.getElementById(`node-student-local-filename-${pathStr}`).value = file.name;
                window.BuilderStore.sync();
                if(btn) { btn.disabled = false; btn.innerHTML = `💾 ${window.BuilderStore.getState().editId ? '儲存修改' : '完成並儲存區塊'}`; }
            };
            reader.readAsDataURL(file);
        },

        // 這是給 AI 批改基準 (original_script) 使用的，跟學生畫面的 PDF 完全無關
        handlePDFUpload: async (inputEl, pathStr) => {
            const file = inputEl.files[0];
            if (!file) return;
            const textarea = document.getElementById(`node-script-${pathStr}`);
            if (!textarea) return;

            const originalText = textarea.value;
            textarea.value = '⏳ 正在解析 PDF 文字，請稍候...';

            try {
                let pdfjsCore = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                if (!pdfjsCore) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('PDF.js 網路載入失敗'));
                        document.head.appendChild(script);
                    });
                    
                    pdfjsCore = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                    if (!pdfjsCore) throw new Error('無法取得 PDF.js 核心物件');
                }

                pdfjsCore.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsCore.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n\n';
                }

                textarea.value = fullText.trim();
                window.showFlash('PDF 文字萃取成功，請檢查並修飾排版');

            } catch (error) {
                console.error("PDF 解析失敗:", error);
                textarea.value = originalText;
                window.showFlash('PDF 解析失敗：' + error.message, 'error');
            } finally {
                inputEl.value = ''; 
                window.BuilderStore.sync(); 
            }
        },

        addNode: (pathStr, type) => { window.BuilderStore.addNode(pathStr, type); renderBuilderUI(); },
        removeNode: (pathStr) => { window.BuilderStore.removeNode(pathStr); renderBuilderUI(); },
        moveNodeUp: (pathStr) => { window.BuilderStore.moveNodeUp(pathStr); renderBuilderUI(); },
        moveNodeDown: (pathStr) => { window.BuilderStore.moveNodeDown(pathStr); renderBuilderUI(); },
        moveNodeLeft: (pathStr) => { window.BuilderStore.moveNodeLeft(pathStr); renderBuilderUI(); },
        moveNodeRight: (pathStr) => { window.BuilderStore.moveNodeRight(pathStr); renderBuilderUI(); },
        changeNodeType: (pathStr, newType) => { window.BuilderStore.changeNodeType(pathStr, newType); renderBuilderUI(); },
        updateNodeUrl: (pathStr, val) => { window.BuilderStore.updateNodeUrl(pathStr, val); renderBuilderUI(); },
        copyPrevNodeUrl: (pathStr) => { window.BuilderStore.copyPrevNodeUrl(pathStr); renderBuilderUI(); },
        addResourceTaskAsLink: (pathStr, resId) => {
            if(!db || !db.resourceLibrary) return;
            const res = db.resourceLibrary.find(r => r.id === resId);
            if (res) { window.BuilderStore.addResourceTaskAsLink(pathStr, res); renderBuilderUI(); }
        },
        copyHistory: (historyId) => {
            if(!historyId || !db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === historyId);
            if (a) { window.BuilderStore.copyHistory(a); renderBuilderUI(); }
        },

        saveBlock: async (btnEl) => {
            window.BuilderStore.sync(); 
            const bState = window.BuilderStore.getState();
            const titleText = bState.title.replace(/<[^>]*>?/gm, '').trim();
            if (!titleText) return window.showFlash('⚠️ 請填寫大區塊標題！', 'error');
            if (!db.assignments) db.assignments = [];
            
            const originalText = btnEl.innerHTML;
            btnEl.innerHTML = '⏳ 處理中...'; btnEl.disabled = true;

            try {
                // 🌟 雲端上傳攔截器：掃描並上傳所有 Student Local File 到 GAS
                const processTasksForUpload = async (tasks) => {
                    for (let t of tasks) {
                        if (t.type === 'group' && t.subTasks) {
                            await processTasksForUpload(t.subTasks);
                        } else if (t.type === 'audio_record' && t.raw_data) {
                            const raw = t.raw_data;
                            if ((raw.student_source_type === 'local' || raw.script_source === 'resource') && raw.student_local_b64) {
                                btnEl.innerHTML = `⏳ 上傳教材: ${raw.student_local_filename}...`;
                                
                                const cls = window.TeacherDB.classes.find(c => c.id === bState.classId);
                                let clsRaw = {};
                                if (cls && cls.raw_data) {
                                    try { clsRaw = typeof cls.raw_data === 'string' ? JSON.parse(cls.raw_data) : cls.raw_data; } catch(e){}
                                }
                                const targetFolderId = clsRaw.drive_folder_id || clsRaw.class_folder_id || '';
                                
                                if (!targetFolderId) throw new Error('該班級尚未綁定雲端資料夾，無法自動上傳檔案');
                                
                                if (typeof window.GasService === 'undefined' || !window.GasService.uploadStudentLocalFile) {
                                    throw new Error('系統錯誤：找不到 GasService 模組或函數');
                                }

                                // 🌟 強制收納至 01_Class_Resources（舊名 01_Materials 由 GAS 自動改名）
                                const fileUrl = await window.GasService.uploadStudentLocalFile(
                                    raw.student_local_b64,
                                    raw.student_local_filename,
                                    raw.student_local_mime,
                                    targetFolderId,
                                    bState.editId || '',
                                    t.id,
                                    '01_Class_Resources'
                                );

                                // 🚀 上傳成功，轉化為 Drive 模式存檔
                                raw.student_source_type = 'drive';
                                raw.student_drive_url = fileUrl;
                                raw.material_url = fileUrl;
                                raw.student_drive_desc = raw.student_local_desc || raw.material_range || '';
                                if (raw.script_source !== 'resource') raw.script_source = 'resource';
                                
                                delete raw.student_local_b64;
                                delete raw.student_local_mime;
                                delete raw.student_local_filename;
                                delete raw.student_local_desc;
                            }
                        }
                    }
                };

                await processTasksForUpload(bState.tasks);
                btnEl.innerHTML = '⏳ 儲存至雲端...';

                let mergedRawData = bState.raw_data || {};
                if (typeof mergedRawData === 'string') { try { mergedRawData = JSON.parse(mergedRawData); } catch(e) { mergedRawData = {}; } }
                
                let mode = bState.late_mode || 'infinite';
                let allowLate = (mode === 'infinite' || mode === 'custom');
                let grace = (mode === 'custom') ? (parseInt(bState.late_grace) || 0) : 0;
                let penalty = (mode !== 'no_late') ? (parseInt(bState.late_penalty) || 0) : 0;

                mergedRawData.late_policy = { allow_late: allowLate, grace_period_hours: grace, penalty_percentage: penalty };
                delete mergedRawData.allow_late; delete mergedRawData.late_policy.is_inherited; 
                
                const payload = {
                    class_id: bState.classId, target_date: window.UtilsDate.normalizeDateString(bState.target_date), title: bState.title, description: bState.description,
                    due_date: bState.due_date || null, is_published: bState.is_published, tasks: [...bState.tasks], raw_data: mergedRawData
                };

                let savedId = bState.editId;

                if (bState.editId) {
                    const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update(payload).eq('id', bState.editId).is('deleted_at', null).select(); 
                    if (error) throw new Error(error.message);
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    const idx = db.assignments.findIndex(a => a.id === bState.editId);
                    if(idx !== -1) db.assignments[idx] = { id: bState.editId, ...payload };
                } else {
                    const { data, error } = await window.supabaseClient.from('assignments').insert([payload]).select().single();
                    if (error) throw new Error(error.message);
                    if (!data) throw new Error("資料庫拒絕了請求");
                    db.assignments.push(data); savedId = data.id; 
                }
                const savedClassId = bState.classId; 
                window.BuilderStore.clear();
                renderTimeline(savedClassId, 'target', `assign-block-${savedId}`);
            } catch (err) {
                window.showFlash('作業儲存失敗：' + err.message, 'error');
                btnEl.innerHTML = originalText; btnEl.disabled = false;
            }
        },
        cancelBuilder: () => {
            const cid = window.BuilderStore.getState().classId;
            window.BuilderStore.clear();
            renderTimeline(cid, 'none');
        },
        deleteHistoryTemplate: async () => {
            const state = window.BuilderStore.getState();
            if (!state) return;
            const selectEl = document.getElementById(`history-select-${state.containerId}`);
            if (!selectEl) return;
            const historyId = selectEl.value;
            if (!historyId) return window.showFlash('⚠️ 請先選擇要刪除的歷史紀錄！', 'error');
            if (!confirm('確定要封存這個歷史作業模板嗎？')) return;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ deleted_at: window.UtilsDate.getTaiwanIsoTimestamp() }).eq('id', historyId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                db.assignments = db.assignments.filter(a => a.id !== historyId);
                window.showFlash('已成功封存');
                renderBuilderUI();
            } catch (err) { window.showFlash('封存失敗：' + err.message, 'error'); }
        },
        deleteAssignment: async (assignId, classId) => {
            if(!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法封存作業。', 'error');
            if(!confirm('確定要封存此作業區塊嗎？\n(注意：這將會隱藏作業，學生的打勾紀錄仍會保存在系統中)')) return;
            
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳'; btn.disabled = true;

            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ deleted_at: window.UtilsDate.getTaiwanIsoTimestamp() }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕請求");

                db.assignments = db.assignments.filter(a => a.id !== assignId);
                renderTimeline(classId, 'none');
            } catch (err) {
                window.showFlash('封存失敗：' + err.message, 'error');
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        confirmLinePush: (assignId, classId) => {
            const TPL = window.TimelineTemplates;
            if(!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a || !TPL) return;

            const cls = db.classes.find(c => c.id === classId);
            let raw = cls?.raw_data || {};
            if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }
            if (!raw.line_notify_token) return window.showFlash('⚠️ 此班級尚未綁定 LINE Notify Token！\n請先至「⚙️ 班級設定」中進行綁定。', 'error');

            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            const overlayId = 'line-push-modal';
            let existing = document.getElementById(overlayId);
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            overlay.innerHTML = TPL.getLinePushModalHtml(cleanTitle, assignId, classId, overlayId);
            document.body.appendChild(overlay);
        },
        executeLinePush: async (assignId, classId) => {
            const btn = document.getElementById('btn-confirm-push');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 發送中...'; btn.disabled = true;

            try {
                if (!window.ServiceLineNotify || typeof window.ServiceLineNotify.pushAssignment !== 'function') throw new Error("系統提示：LINE 推播微服務尚未載入。");
                await window.ServiceLineNotify.pushAssignment(classId, assignId);
                document.getElementById('line-push-modal').remove();
                window.showFlash('已成功發送至 LINE 群組');
            } catch (err) {
                window.showFlash('推播失敗：' + err.message, 'error');
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        dragAssignStart: (e, id) => { dragAssignId = id; e.dataTransfer.effectAllowed = 'move'; },
        dropAssign: async (e, targetId, classId) => {
            e.preventDefault(); e.stopPropagation(); 
            if (!dragAssignId || dragAssignId === targetId || !db || !db.assignments) return;

            const arr = db.assignments;
            const fromIdx = arr.findIndex(a => a.id === dragAssignId);
            const toIdx = arr.findIndex(a => a.id === targetId);

            if (fromIdx > -1 && toIdx > -1) {
                const targetDate = arr[toIdx].target_date;
                const [dragged] = arr.splice(fromIdx, 1);
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate; 
                arr.splice(toIdx, 0, dragged);
                renderTimeline(classId, 'none'); 
                
                if (oldDate !== targetDate) {
                    try {
                        const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
                        if (error) throw error;
                        if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    } catch (err) {
                        dragged.target_date = oldDate; 
                        renderTimeline(classId, 'none');
                        window.showFlash('排序更新失敗：' + err.message, 'error');
                    }
                }
            }
            dragAssignId = null;
        },
        dropAssignToNode: async (e, targetDate, classId) => {
            e.preventDefault();
            if (!dragAssignId || !db || !db.assignments) return;
            const dragged = db.assignments.find(a => a.id === dragAssignId);
            
            if (dragged && dragged.target_date !== targetDate) {
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate;
                renderTimeline(classId, 'none'); 

                try {
                    const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: targetDate }).eq('id', dragAssignId).is('deleted_at', null).select(); 
                    if (error) throw error;
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                } catch (err) {
                    dragged.target_date = oldDate; 
                    renderTimeline(classId, 'none');
                    window.showFlash('拖曳更新失敗：' + err.message, 'error');
                }
            }
            dragAssignId = null;
        },
        moveAssignment: (assignId, classId) => {
            const TPL = window.TimelineTemplates;
            if(!db || !db.assignments) return;
            const a = db.assignments.find(x => x.id === assignId);
            if (!a || !TPL) return;
            if (!checkCanEditTimeline(classId)) return window.showFlash('權限不足：您的身分無法搬移此作業。', 'error');

            const overlay = document.createElement('div');
            overlay.id = 'move-assign-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';
            overlay.innerHTML = TPL.getMoveAssignModalHtml(cleanTitle, window.UtilsDate.normalizeDateString(a.target_date), a.id, classId);
            document.body.appendChild(overlay);
        },
        submitMove: async (assignId, classId, oldDate) => {
            const newDate = document.getElementById('move-target-date').value;
            if (!newDate) return window.showFlash('⚠️ 請選擇目標日期', 'error');
            if (newDate === oldDate) return document.getElementById('move-assign-modal').remove(); 
            
            const btn = document.getElementById('btn-confirm-move');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 處理中...'; btn.disabled = true;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient.from('assignments').update({ target_date: newDate }).eq('id', assignId).is('deleted_at', null).select(); 
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                
                const idx = db.assignments.findIndex(a => a.id === assignId);
                if(idx > -1) db.assignments[idx].target_date = newDate;
                
                document.getElementById('move-assign-modal').remove();
                window.FeatureTimeline.renderTimeline(classId, 'target', `assign-block-${assignId}`);
            } catch (err) {
                window.showFlash('改期失敗：' + err.message, 'error');
                btn.innerHTML = originalText; btn.disabled = false;
            }
        },

        loadMaterialMetaSelect: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return window.showFlash('請先開啟作業編輯器', 'error');
            const rowsEl = document.getElementById('node-material-rows-' + pathStr);
            const statusEl = document.getElementById('node-material-status-' + pathStr);
            if (!rowsEl) return;
            const rootKind = readMaterialsRootKind(pathStr);
            const destLabel = rootKind === 'teacher' ? '01_My_Materials' : '00_Class_Materials';
            if (statusEl) {
                statusEl.textContent = '⏳ 載入 ' + destLabel + '…';
                statusEl.style.color = '#3B82F6';
            }
            try {
                let savedRows = readMaterialMetaRows(pathStr).map(function (m) {
                    return {
                        value: (m.material_folder || '') + '::' + (m.published_file || ''),
                        range_spec: m.range_spec || '',
                        label: m.label || ''
                    };
                });
                const hidden = document.getElementById('node-material-selected-json-' + pathStr);
                if (!savedRows.length && hidden && hidden.value) {
                    try {
                        const parsed = JSON.parse(hidden.value);
                        if (Array.isArray(parsed) && parsed.length) {
                            if (typeof parsed[0] === 'object') savedRows = parsed;
                            else savedRows = parsed.map(function (v) { return { value: v, range_spec: '' }; });
                        }
                    } catch (_e) {}
                }
                const options = await loadMaterialMetaOptions(bState.classId, rootKind);
                renderMaterialMetaRows(pathStr, options, savedRows.length ? savedRows : [{ value: '', range_spec: 'pp. 1~2' }]);
                if (statusEl) {
                    statusEl.textContent = '✅ 已載入 ' + options.length + ' 個 meta｜用「＋ 新增 meta」加列｜' + destLabel;
                    statusEl.style.color = '#059669';
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.textContent = '❌ ' + err.message;
                    statusEl.style.color = '#DC2626';
                }
                window.showFlash('無法載入 Material：' + err.message, 'error');
            }
        },

        addMaterialMetaRow: function (pathStr) {
            const container = document.getElementById('node-material-rows-' + pathStr);
            if (!container) return;
            const options = _materialMetaOptionsCache[pathStr] || [];
            if (!options.length) {
                return window.showFlash('請先按「載入 meta 清單」', 'error');
            }
            container.appendChild(createMaterialMetaRowEl(pathStr, options, { value: '', range_spec: '' }));
            refreshMaterialRangeLabel(pathStr);
        },

        removeMaterialMetaRow: function (btnEl, pathStr) {
            const row = btnEl && btnEl.closest ? btnEl.closest('.material-meta-row') : null;
            const container = document.getElementById('node-material-rows-' + pathStr);
            if (row && container) {
                if (container.querySelectorAll('.material-meta-row').length <= 1) {
                    const fileEl = row.querySelector('.material-meta-file');
                    const rangeEl = row.querySelector('.material-meta-range');
                    if (fileEl) fileEl.value = '';
                    if (rangeEl) rangeEl.value = '';
                } else {
                    row.remove();
                }
            }
            refreshMaterialRangeLabel(pathStr);
        },

        previewMaterialSnapshot: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return window.showFlash('請先開啟作業編輯器', 'error');
            if (!window.MaterialSnapshot) return window.showFlash('MaterialSnapshot 模組未載入', 'error');
            const previewEl = document.getElementById('node-material-preview-' + pathStr);
            try {
                const snapshot = await buildMergedMaterialSnapshot(pathStr, bState.classId);
                refreshMaterialRangeLabel(pathStr);
                if (previewEl) {
                    previewEl.innerHTML = '<div style="font-weight:900;margin-bottom:6px;">📍 '
                        + String(snapshot.material_range || '').replace(/</g, '&lt;')
                        + '</div><strong>AI 稿預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 10px;">'
                        + (snapshot.original_script || '').replace(/</g, '&lt;')
                        + '</pre><strong>學生顯示預覽</strong><pre style="white-space:pre-wrap;margin:6px 0 0;">'
                        + (snapshot.student_display || '').replace(/</g, '&lt;') + '</pre>';
                }
            } catch (err) {
                if (previewEl) previewEl.textContent = '❌ ' + err.message;
                window.showFlash('預覽失敗：' + err.message, 'error');
            }
        },

        applyMaterialSnapshot: async function (pathStr) {
            const bState = window.BuilderStore ? window.BuilderStore.getState() : null;
            if (!bState) return window.showFlash('請先開啟作業編輯器', 'error');
            if (!window.MaterialSnapshot) return window.showFlash('MaterialSnapshot 模組未載入', 'error');
            try {
                const snapshot = await buildMergedMaterialSnapshot(pathStr, bState.classId);
                applySnapshotToNode(pathStr, snapshot);
                window.showFlash('已寫入 Snapshot：' + (snapshot.material_range || '') + '（請記得儲存作業）');
            } catch (err) {
                window.showFlash('套用 Snapshot 失敗：' + err.message, 'error');
            }
        },

        onMaterialModeChange: function (pathStr) {
            toggleMaterialSliceFields(pathStr);
        },

        onMaterialRootChange: function (pathStr) {
            const rowsEl = document.getElementById('node-material-rows-' + pathStr);
            if (rowsEl) rowsEl.innerHTML = '';
            _materialMetaOptionsCache[pathStr] = [];
            window.FeatureTimeline.loadMaterialMetaSelect(pathStr);
        },

        onMaterialMetaCheckChange: function (pathStr) {
            refreshMaterialRangeLabel(pathStr);
        },

        refreshMaterialRangeLabel: function (pathStr) {
            return refreshMaterialRangeLabel(pathStr);
        },

        onScriptSourceChange: function (pathStr) {
            const sourceEl = document.getElementById('node-script-source-' + pathStr);
            const source = sourceEl ? sourceEl.value : 'meta';
            const panels = ['meta', 'range_only', 'paste', 'resource'];
            panels.forEach(function (key) {
                const el = document.getElementById('script-source-panel-' + key + '-' + pathStr);
                if (el) el.style.display = (source === key) ? 'block' : 'none';
            });
            const baseWrap = document.getElementById('node-base-range-wrap-' + pathStr);
            if (baseWrap) baseWrap.style.display = (source === 'meta') ? 'none' : 'flex';
        }
    };
})();
/**
 * 📂 檔案路徑：110_teacher_core/store-assignment-builder.js
 * 🌟 第三層 (State Store)：作業編輯器狀態管理大腦 v45
 * - 嚴格捕捉 3 大來源 (Drive/Local/Text) 的所有細節狀態，並支援學生端本地檔案 Base64。
 */
window.BuilderStore = (() => {
    'use strict';
    
    let bState = null;

    function sanitizeScript(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]*>?/gm, '') 
            .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) 
            .replace(/\u3000/g, ' ') 
            .replace(/[^\S\r\n]+/g, ' ') 
            .trim();
    }

    /** 從範圍層底下錄音任務的 material_range／meta 列組出範圍標題 */
    function deriveRangeTitleFromGroup(groupNode) {
        if (!groupNode || !Array.isArray(groupNode.subTasks)) return '';
        const audio = groupNode.subTasks.find(function (t) { return t && t.type === 'audio_record'; });
        if (!audio) return '';
        const raw = audio.raw_data || {};
        let label = String(raw.material_range || '').trim();
        if (!label) {
            const refs = Array.isArray(raw.material_refs) && raw.material_refs.length
                ? raw.material_refs
                : (raw.material_ref && raw.material_ref.published_file ? [raw.material_ref] : []);
            if (refs.length && window.FeatureTimeline && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
                label = String(window.FeatureTimeline.buildMaterialRangeLabelFromRows(refs) || '').trim();
            }
        }
        if (!label) {
            label = String(audio.title || '').replace(/<[^>]*>?/gm, '').trim();
        }
        if (!label || label === '錄音' || label === '考試') return '';
        return label;
    }

    /** 範圍層標題空白時，用 base 範圍（錄音 meta）自動產生；不覆寫老師已填標題 */
    function fillBlankRangeGroupTitles(tasks) {
        (tasks || []).forEach(function (t) {
            if (!t || t.type !== 'group') return;
            if (t.subTasks) fillBlankRangeGroupTitles(t.subTasks);
            if (!(t.raw_data && t.raw_data.group_role === 'range')) return;
            const plain = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
            if (plain) return;
            const derived = deriveRangeTitleFromGroup(t);
            if (derived) t.title = derived;
        });
    }

    function syncTasksState(tasks, parentPathArray = []) {
        tasks.forEach((t, idx) => {
            const pathArray = [...parentPathArray, idx];
            const pathStr = pathArray.join('-');
            
            const titleEl = document.getElementById(`node-title-${pathStr}`);
            if (titleEl) {
                let text = titleEl.textContent.trim();
                t.title = (text === '') ? '' : titleEl.innerHTML;
            }
            
            const dueEl = document.getElementById(`node-due-${pathStr}`);
            const lateModeEl = document.getElementById(`node-late-mode-${pathStr}`);
            const graceEl = document.getElementById(`node-grace-${pathStr}`);
            const penaltyEl = document.getElementById(`node-penalty-${pathStr}`);
            
            if (dueEl) t.due_date = dueEl.value;
            if (lateModeEl) t.late_mode = lateModeEl.value;
            if (graceEl) t.grace_period_hours = parseInt(graceEl.value) || 0;
            if (penaltyEl) t.penalty_percentage = parseInt(penaltyEl.value) || 0;
            
            if (t.late_mode === 'no_late') { t.grace_period_hours = 0; t.penalty_percentage = 0; }
            if (t.late_mode === 'infinite') { t.grace_period_hours = 0; }
            
            if (t.type === 'group') {
                if (t.subTasks) syncTasksState(t.subTasks, pathArray);
                // 範圍層標題空白 → 用底下錄音 base 範圍填上
                if (t.raw_data && t.raw_data.group_role === 'range') {
                    const plain = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
                    if (!plain) {
                        const derived = deriveRangeTitleFromGroup(t);
                        if (derived) {
                            t.title = derived;
                            if (titleEl) titleEl.textContent = derived;
                        }
                    }
                }
            } else {
                const urlEl = document.getElementById(`node-url-${pathStr}`);
                const urlTextEl = document.getElementById(`node-url-text-${pathStr}`);
                const descEl = document.getElementById(`node-desc-${pathStr}`);
                
                if (urlEl) t.url = urlEl.value;
                if (urlTextEl) t.url_text = urlTextEl.value;
                if (descEl) {
                    let text = descEl.textContent.trim();
                    t.description = (text === '') ? '' : descEl.innerHTML;
                }

                if (t.type === 'audio_record') {
                    if (!t.raw_data) t.raw_data = {};
                    
                    const useAiEl = document.getElementById(`node-use-ai-${pathStr}`); 
                    const useGrammarEl = document.getElementById(`node-use-grammar-${pathStr}`);
                    if (useAiEl) t.raw_data.use_ai_grading = useAiEl.checked;
                    if (useGrammarEl) t.raw_data.use_ai_grammar = useGrammarEl.checked;

                    const captureStudioEl = document.getElementById(`node-capture-studio-${pathStr}`);
                    const captureUploadEl = document.getElementById(`node-capture-upload-${pathStr}`);
                    if (captureStudioEl) t.raw_data.capture_studio = captureStudioEl.checked;
                    if (captureUploadEl) t.raw_data.capture_upload = captureUploadEl.checked;
                    if (t.raw_data.capture_studio === false && t.raw_data.capture_upload === false) {
                        t.raw_data.capture_studio = true;
                        t.raw_data.capture_upload = true;
                    }

                    const scriptSourceEl = document.getElementById(`node-script-source-${pathStr}`);
                    if (scriptSourceEl) t.raw_data.script_source = scriptSourceEl.value || 'meta';
                    const scriptSource = t.raw_data.script_source || 'meta';

                    const materialRangeEl = document.getElementById(`node-material-range-${pathStr}`);
                    const materialRangeManualEl = document.getElementById(`node-material-range-manual-${pathStr}`);
                    if (scriptSource === 'meta') {
                        if (materialRangeEl) t.raw_data.material_range = String(materialRangeEl.value || '').trim();
                    } else if (materialRangeManualEl) {
                        t.raw_data.material_range = String(materialRangeManualEl.value || '').trim();
                    } else if (materialRangeEl) {
                        t.raw_data.material_range = String(materialRangeEl.value || '').trim();
                    }
                    // 標題空白或仍為「自動繼承」時，跟 base 範圍同步
                    if (t.raw_data.material_range) {
                        const titlePlain = titleEl
                            ? String(titleEl.textContent || '').trim()
                            : String(t.title || '').replace(/<[^>]*>/g, '').trim();
                        const autoFlag = titleEl ? titleEl.getAttribute('data-title-auto') : null;
                        const prevFrom = titleEl
                            ? String(titleEl.getAttribute('data-title-from-range') || '').trim()
                            : '';
                        const shouldAuto = !titlePlain || autoFlag === '1'
                            || (prevFrom && titlePlain === prevFrom);
                        if (shouldAuto) {
                            t.title = t.raw_data.material_range;
                            if (titleEl) {
                                titleEl.textContent = t.raw_data.material_range;
                                titleEl.setAttribute('data-title-auto', '1');
                                titleEl.setAttribute('data-title-from-range', t.raw_data.material_range);
                            }
                        }
                    }

                    const materialUrlEl = document.getElementById(`node-material-url-${pathStr}`);
                    if (materialUrlEl) {
                        t.raw_data.material_url = String(materialUrlEl.value || '').trim();
                        if (t.raw_data.material_url && !t.raw_data.student_drive_url) {
                            t.raw_data.student_drive_url = t.raw_data.material_url;
                        }
                    }

                    // A: meta 文稿以 snapshot / meta 面板為準；C: 以 paste 面板為準
                    const scriptEl = document.getElementById(`node-script-${pathStr}`);
                    const studentTextEl = document.getElementById(`node-student-text-${pathStr}`);
                    const scriptPasteEl = document.getElementById(`node-script-paste-${pathStr}`);
                    const studentPasteEl = document.getElementById(`node-student-text-paste-${pathStr}`);

                    if (scriptSource === 'paste') {
                        if (scriptPasteEl) t.raw_data.original_script = sanitizeScript(scriptPasteEl.value);
                        if (studentPasteEl) {
                            const displayText = studentPasteEl.value;
                            t.raw_data.student_text = displayText;
                            t.raw_data.student_display = displayText;
                            t.raw_data.student_display_text = displayText;
                        }
                        if (scriptEl && scriptPasteEl) scriptEl.value = scriptPasteEl.value;
                        if (studentTextEl && studentPasteEl) studentTextEl.value = studentPasteEl.value;
                    } else if (scriptSource === 'range_only') {
                        // 僅範圍：清掉顯示文稿本體（保留 material_range）
                        t.raw_data.student_display = '';
                        t.raw_data.student_display_text = '';
                        t.raw_data.student_text = '';
                        if (scriptEl) t.raw_data.original_script = sanitizeScript(scriptEl.value);
                    } else {
                        if (scriptEl) t.raw_data.original_script = sanitizeScript(scriptEl.value);
                        if (studentTextEl) {
                            t.raw_data.student_text = studentTextEl.value;
                            t.raw_data.student_display = studentTextEl.value;
                            t.raw_data.student_display_text = studentTextEl.value;
                        }
                    }

                    const snapshotJsonEl = document.getElementById(`node-material-snapshot-json-${pathStr}`);
                    let snapMaterialRefs = null;
                    let snapMaterialRange = '';
                    if (snapshotJsonEl && snapshotJsonEl.value) {
                        try {
                            const snap = JSON.parse(snapshotJsonEl.value);
                            if (scriptSource === 'meta') {
                                if (snap.original_script) t.raw_data.original_script = sanitizeScript(scriptEl && scriptEl.value ? scriptEl.value : snap.original_script);
                                if (snap.student_display || snap.student_display_text) {
                                    const fromUi = studentTextEl ? studentTextEl.value : '';
                                    const displayText = fromUi || snap.student_display || snap.student_display_text;
                                    t.raw_data.student_display = displayText;
                                    t.raw_data.student_display_text = displayText;
                                    t.raw_data.student_text = displayText;
                                }
                                if (Array.isArray(snap.material_refs) && snap.material_refs.length) {
                                    snapMaterialRefs = snap.material_refs;
                                    t.raw_data.material_refs = snap.material_refs;
                                    t.raw_data.material_ref = snap.material_refs[0];
                                } else if (snap.material_ref) {
                                    // ⚠️ 舊版 hidden snapshot 只存單一 material_ref；不可因此把多冊 refs 砍成 1
                                    if (!Array.isArray(t.raw_data.material_refs) || t.raw_data.material_refs.length <= 1) {
                                        t.raw_data.material_ref = snap.material_ref;
                                        t.raw_data.material_refs = [snap.material_ref];
                                    }
                                }
                                if (snap.material_range) {
                                    snapMaterialRange = String(snap.material_range).trim();
                                    t.raw_data.material_range = snapMaterialRange;
                                }
                                if (snap.snapshot_at) t.raw_data.snapshot_at = snap.snapshot_at;
                                if (Array.isArray(snap.grading_units)) t.raw_data.grading_units = snap.grading_units;
                                if (Array.isArray(snap.meta_items)) t.raw_data.meta_items = snap.meta_items;
                                // 💣 meta_rows_by_stem：考試「可用題」靠它。sync 必須合併，不可用較舊的
                                // 單冊 snap JSON 把已累積的 B/C… 快取蓋掉（否則右欄 B 永遠 ~預計）。
                                if (snap.meta_rows_by_stem && typeof snap.meta_rows_by_stem === 'object') {
                                    t.raw_data.meta_rows_by_stem = Object.assign(
                                        {},
                                        t.raw_data.meta_rows_by_stem || {},
                                        snap.meta_rows_by_stem
                                    );
                                }
                                // 逐頁批改稿編輯框若存在，代表老師可能微調過內容，優先採用畫面上的最新值
                                // （否則會被 hidden snapshot json 裡「套用 Snapshot 當下」的舊版蓋回去）
                                const domGradingUnits = (window.FeatureTimeline && typeof window.FeatureTimeline.collectGradingUnitsFromDom === 'function')
                                    ? window.FeatureTimeline.collectGradingUnitsFromDom(pathStr)
                                    : null;
                                if (domGradingUnits && domGradingUnits.length) {
                                    const prevUnits = Array.isArray(t.raw_data.grading_units)
                                        ? t.raw_data.grading_units : [];
                                    let allowDomUnits = true;
                                    if (window.FeatureTimeline
                                        && typeof window.FeatureTimeline.uniqueStemsFromGradingUnits === 'function'
                                        && prevUnits.length) {
                                        const prevStemN = window.FeatureTimeline.uniqueStemsFromGradingUnits(prevUnits).length;
                                        const domStemN = window.FeatureTimeline.uniqueStemsFromGradingUnits(domGradingUnits).length;
                                        // DOM 冊數較少＝殘缺重繪／第二冊尚未套用完 → 禁止縮水
                                        if (prevStemN > 1 && domStemN < prevStemN) allowDomUnits = false;
                                    }
                                    if (allowDomUnits) {
                                        t.raw_data.grading_units = domGradingUnits;
                                        t.raw_data.original_script = sanitizeScript(domGradingUnits.map(function (u) {
                                            const label = u.label || u.stem || '';
                                            return label ? ('【' + label + '】\n' + (u.original_script || '')) : (u.original_script || '');
                                        }).join('\n\n'));
                                    }
                                }
                                if (snap.recording_unit) t.raw_data.recording_unit = snap.recording_unit;
                                if (snap.recording_unit_hint) t.raw_data.recording_unit_hint = snap.recording_unit_hint;
                            }
                        } catch (_snapErr) {}
                    }

                    if (scriptSource === 'meta') {
                        // 💣 雷區（見 .cursor/rules/material-snapshot-refs-invariant.mdc）：
                        // 絕對禁止「DOM 讀到幾列就寫幾列 material_refs」。
                        // hydrate 未完成時 DOM 常只剩 A 一列，若直接覆寫會毁掉已凍結的 A~F，
                        // 但 grading_units（12 頁）還在 → 老師以為文稿還在、存完再開 meta 卻只剩 A。
                        const rows = [];
                        const listEl = document.getElementById(`node-material-rows-${pathStr}`);
                        const rootEl = document.getElementById(`node-material-root-${pathStr}`);
                        if (listEl) {
                            listEl.querySelectorAll('.material-meta-row').forEach(function (rowEl) {
                                const fileEl = rowEl.querySelector('.material-meta-file');
                                const rangeEl = rowEl.querySelector('.material-meta-range');
                                const value = fileEl ? String(fileEl.value || '').trim() : '';
                                if (!value) return;
                                const parts = value.split('::');
                                const rangeSpec = rangeEl ? String(rangeEl.value || '').trim() : '';
                                const label = (parts[1] || '').replace(/\.meta\.json$/i, '').replace(/\.json$/i, '');
                                const stemParts = label.split(/[\/_]/);
                                rows.push({
                                    materials_root_kind: (rootEl && rootEl.value === 'class') ? 'class' : 'teacher',
                                    material_folder: parts[0] || '',
                                    published_file: parts[1] || '',
                                    select_mode: 'range_spec',
                                    range_spec: rangeSpec,
                                    label: stemParts[stemParts.length - 1] || label
                                });
                            });
                        }

                        const prevRefs = Array.isArray(t.raw_data.material_refs) ? t.raw_data.material_refs : [];
                        const units = Array.isArray(t.raw_data.grading_units) ? t.raw_data.grading_units : [];
                        let nextRefs = rows.length ? rows : prevRefs.slice();

                        // 列數必須對齊 grading_units 的 stem；不足則從 units 補回，禁止縮水覆寫
                        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMaterialRefsMatchUnits === 'function') {
                            nextRefs = window.FeatureTimeline.ensureMaterialRefsMatchUnits(
                                nextRefs,
                                units,
                                nextRefs[0] || prevRefs[0] || t.raw_data.material_ref || {}
                            );
                        } else if (prevRefs.length > nextRefs.length) {
                            nextRefs = prevRefs;
                        } else if (snapMaterialRefs && snapMaterialRefs.length > nextRefs.length) {
                            nextRefs = snapMaterialRefs;
                        }

                        if (nextRefs.length) {
                            t.raw_data.material_refs = nextRefs;
                            t.raw_data.material_ref = nextRefs[0];
                        }

                        // base 範圍：DOM 若被縮成單冊，保留較完整的 snapshot／由 refs 重算
                        const domRange = materialRangeEl ? String(materialRangeEl.value || '').trim() : '';
                        let rangeToSave = domRange;
                        if (window.FeatureTimeline && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
                            const fromRefs = window.FeatureTimeline.buildMaterialRangeLabelFromRows(nextRefs);
                            const stemCount = (window.FeatureTimeline.uniqueStemsFromGradingUnits
                                ? window.FeatureTimeline.uniqueStemsFromGradingUnits(units).length
                                : 0);
                            if (stemCount > 1 && fromRefs && (!domRange || domRange.length < fromRefs.length * 0.5)) {
                                rangeToSave = fromRefs;
                            } else if (!rangeToSave && fromRefs) {
                                rangeToSave = fromRefs;
                            } else if (!rangeToSave && snapMaterialRange) {
                                rangeToSave = snapMaterialRange;
                            } else if (!rangeToSave && t.title) {
                                rangeToSave = String(t.title).replace(/<[^>]*>?/gm, '').trim();
                            }
                        } else if (!rangeToSave && snapMaterialRange) {
                            rangeToSave = snapMaterialRange;
                        }
                        if (rangeToSave) t.raw_data.material_range = rangeToSave;
                    }

                    const studentSourceTypeEl = document.getElementById(`node-student-source-type-${pathStr}`);
                    if (studentSourceTypeEl) t.raw_data.student_source_type = studentSourceTypeEl.value;
                    else if (scriptSource === 'resource' && t.raw_data.student_local_b64) t.raw_data.student_source_type = 'local';
                    else if (scriptSource === 'resource' && (t.raw_data.material_url || t.raw_data.student_drive_url)) t.raw_data.student_source_type = 'drive';

                    const studentDriveUrlEl = document.getElementById(`node-student-drive-url-${pathStr}`);
                    if (studentDriveUrlEl && studentDriveUrlEl.value) t.raw_data.student_drive_url = studentDriveUrlEl.value;
                    
                    const studentDriveDescEl = document.getElementById(`node-student-drive-desc-${pathStr}`);
                    if (studentDriveDescEl) t.raw_data.student_drive_desc = studentDriveDescEl.value || t.raw_data.material_range || '';

                    const studentLocalDescEl = document.getElementById(`node-student-local-desc-${pathStr}`);
                    if (studentLocalDescEl) t.raw_data.student_local_desc = studentLocalDescEl.value;

                    const studentLocalB64El = document.getElementById(`node-student-local-b64-${pathStr}`);
                    if (studentLocalB64El) t.raw_data.student_local_b64 = studentLocalB64El.value;

                    const studentLocalMimeEl = document.getElementById(`node-student-local-mime-${pathStr}`);
                    if (studentLocalMimeEl) t.raw_data.student_local_mime = studentLocalMimeEl.value;

                    const studentLocalFilenameEl = document.getElementById(`node-student-local-filename-${pathStr}`);
                    if (studentLocalFilenameEl) t.raw_data.student_local_filename = studentLocalFilenameEl.value;

                    // 相容舊欄位
                    if (!t.raw_data.ai_source_type) t.raw_data.ai_source_type = 'text';
                    if (!t.raw_data.student_source_type) t.raw_data.student_source_type = 'text';
                }

                if (t.type === 'exam') {
                    // 考試標題空白／自動繼承 → 跟同層錄音 base 範圍
                    if (window.FeatureExamJob && typeof window.FeatureExamJob.getSiblingAudioRangeLabel === 'function') {
                        const examRange = window.FeatureExamJob.getSiblingAudioRangeLabel(pathStr) || '';
                        if (examRange) {
                            const titlePlain = titleEl
                                ? String(titleEl.textContent || '').trim()
                                : String(t.title || '').replace(/<[^>]*>/g, '').trim();
                            const autoFlag = titleEl ? titleEl.getAttribute('data-title-auto') : null;
                            const prevFrom = titleEl
                                ? String(titleEl.getAttribute('data-title-from-range') || '').trim()
                                : '';
                            const shouldAuto = !titlePlain || autoFlag === '1'
                                || (prevFrom && titlePlain === prevFrom)
                                || titlePlain === '考試';
                            if (shouldAuto) {
                                t.title = examRange;
                                if (titleEl) {
                                    titleEl.textContent = examRange;
                                    titleEl.setAttribute('data-title-auto', '1');
                                    titleEl.setAttribute('data-title-from-range', examRange);
                                }
                            }
                        }
                    }
                    if (window.FeatureExamJob && typeof window.FeatureExamJob.syncInlineEditor === 'function') {
                        window.FeatureExamJob.syncInlineEditor(pathStr, t);
                    }
                }
            }
        });
    }

    function syncState() {
        if (!bState) return;
        const nid = bState.containerId;
        const titleEl = document.getElementById(`builder-title-${nid}`);
        const descEl = document.getElementById(`builder-desc-${nid}`);
        const dueEl = document.getElementById(`builder-due-${nid}`);
        const pubEl = document.getElementById(`builder-pub-${nid}`);
        const lateModeEl = document.getElementById(`builder-late-mode-${nid}`);
        const graceEl = document.getElementById(`builder-grace-${nid}`);
        const penaltyEl = document.getElementById(`builder-penalty-${nid}`);
        
        if (titleEl) {
            let text = titleEl.textContent.trim();
            bState.title = (text === '') ? '' : titleEl.innerHTML;
        }
        if (dueEl) bState.due_date = dueEl.value;
        if (pubEl) bState.is_published = pubEl.checked;
        if (descEl) {
            let text = descEl.textContent.trim();
            bState.description = (text === '') ? '' : descEl.innerHTML;
        }

        if (lateModeEl) bState.late_mode = lateModeEl.value;
        if (graceEl) bState.late_grace = parseInt(graceEl.value) || 0;
        if (penaltyEl) bState.late_penalty = parseInt(penaltyEl.value) || 0;

        if (bState.late_mode === 'no_late') { bState.late_grace = 0; bState.late_penalty = 0; }
        if (bState.late_mode === 'infinite') { bState.late_grace = 0; }
        if (bState.tasks) syncTasksState(bState.tasks);
        fillBlankRangeGroupTitles(bState.tasks);
    }

    function getTaskParentArray(pathArray) {
        if (!pathArray || pathArray.length <= 1) return bState.tasks;
        let current = bState.tasks[pathArray[0]];
        for (let i = 1; i < pathArray.length - 1; i++) {
            current = current.subTasks[pathArray[i]];
        }
        return current.subTasks;
    }

    return {
        initNew: (classId, date, containerId) => {
            bState = { 
                editId: null, classId, target_date: date, containerId, 
                title: '', description: '', due_date: '', is_published: false, 
                late_mode: 'infinite', late_grace: 0, late_penalty: 0, tasks: [] 
            };
        },
        initEdit: (assignment, containerId) => {
            bState = JSON.parse(JSON.stringify(assignment));
            bState.editId = assignment.id; 
            bState.classId = assignment.class_id; 
            bState.containerId = containerId;
            
            let aRaw = assignment.raw_data || {};
            if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
            
            if (aRaw.late_policy) {
                if (!aRaw.late_policy.allow_late) bState.late_mode = 'no_late';
                else if (aRaw.late_policy.grace_period_hours > 0) bState.late_mode = 'custom';
                else bState.late_mode = 'infinite';
                bState.late_grace = aRaw.late_policy.grace_period_hours || 0;
                bState.late_penalty = aRaw.late_policy.penalty_percentage || 0;
            } else {
                bState.late_mode = 'infinite'; bState.late_grace = 0; bState.late_penalty = 0;
            }
        },
        getState: () => bState,
        clear: () => { bState = null; },
        sync: () => syncState(),
        deriveRangeTitleFromGroup: deriveRangeTitleFromGroup,
        fillBlankRangeGroupTitles: fillBlankRangeGroupTitles,
        
        getTaskParentArray: getTaskParentArray,

        /** 新作業慣例：教材／群組底下掛「範圍層」，再掛錄音＋考試 */
        _isRangeGroupNode: (node) => !!(node && node.type === 'group' && node.raw_data && node.raw_data.group_role === 'range'),

        // 💣 雷區：曾發生老師沒勾 AI 批改，學生端卻照樣送 AI——因為新建任務預設
        // use_ai_grading: true，勾選框一開始就是「已勾」，老師沒動它＝以為沒開，實際是開的。
        // 改為預設 false（需老師明確勾選才送 AI），只影響「新建」任務；已存在資料不動。
        _defaultAudioRaw: () => ({
            use_ai_grading: false,
            use_ai_grammar: false,
            capture_studio: true,
            capture_upload: true,
            script_source: 'meta',
            material_range: '',
            ai_source_type: 'text',
            student_source_type: 'text'
        }),

        _defaultExamRaw: () => ({
            exam_job_id: '',
            exam_title: '',
            exam_job: null
        }),

        _makeLeafNode: (type, title, rawData) => ({
            id: `task_${Date.now()}_${Math.random()}`,
            type,
            title: title || '',
            url: '',
            url_text: '',
            description: '',
            due_date: '',
            late_mode: 'infinite',
            grace_period_hours: 0,
            penalty_percentage: 0,
            raw_data: rawData || {}
        }),

        addNode: (pathStr, type) => {
            syncState();
            let targetArr;
            let parentNode = null;
            if (!pathStr) targetArr = bState.tasks;
            else {
                const arr = pathStr.split('-').map(Number);
                const parentArr = getTaskParentArray(arr);
                parentNode = parentArr[arr[arr.length - 1]];
                if (!parentNode.subTasks) parentNode.subTasks = [];
                targetArr = parentNode.subTasks;
            }

            // 錄音／考試標題預設空白，之後由 base 範圍自動繼承（勿預填「錄音」「考試」）
            const defaultTitle = '';

            let raw = {};
            if (type === 'audio_record') raw = window.BuilderStore._defaultAudioRaw();
            else if (type === 'exam') raw = window.BuilderStore._defaultExamRaw();
            else if (type === 'group') raw = {};

            // 掛在範圍層下的錄音：若尚未填 material_range，帶入父層標題當提示（舊作業無 group_role 不受影響）
            if (type === 'audio_record' && window.BuilderStore._isRangeGroupNode(parentNode)) {
                const rangeHint = (parentNode.title || '').replace(/<[^>]*>?/gm, '').trim();
                if (rangeHint && !raw.material_range) raw.material_range = rangeHint;
            }

            const node = window.BuilderStore._makeLeafNode(type, defaultTitle, raw);
            if (type === 'group') node.subTasks = [];
            targetArr.push(node);
        },

        /**
         * 一鍵建立「範圍群組 → 錄音＋考試」（僅影響新建節點，不改舊作業）
         * 標題留給老師填範圍，例如：A pp. 1~2, B pp. 1~2, C #16~35
         */
        addRangeBundle: (pathStr) => {
            syncState();
            let targetArr;
            if (!pathStr) targetArr = bState.tasks;
            else {
                const arr = pathStr.split('-').map(Number);
                const parentArr = getTaskParentArray(arr);
                const targetNode = parentArr[arr[arr.length - 1]];
                if (!targetNode.subTasks) targetNode.subTasks = [];
                targetArr = targetNode.subTasks;
            }

            const stamp = Date.now();
            const rangeGroup = {
                id: `task_${stamp}_${Math.random()}`,
                type: 'group',
                title: '',
                url: '',
                url_text: '',
                description: '',
                due_date: '',
                late_mode: 'infinite',
                grace_period_hours: 0,
                penalty_percentage: 0,
                raw_data: { group_role: 'range' },
                subTasks: [
                    window.BuilderStore._makeLeafNode('audio_record', '', window.BuilderStore._defaultAudioRaw()),
                    window.BuilderStore._makeLeafNode('exam', '', window.BuilderStore._defaultExamRaw())
                ]
            };
            // 確保子節點 id 不碰撞
            rangeGroup.subTasks[1].id = `task_${stamp + 1}_${Math.random()}`;
            targetArr.push(rangeGroup);
        },
        removeNode: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            getTaskParentArray(arr).splice(arr[arr.length - 1], 1);
        },
        moveNodeUp: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                [parentArr[idx - 1], parentArr[idx]] = [parentArr[idx], parentArr[idx - 1]];
            }
        },
        moveNodeDown: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            const parentArr = getTaskParentArray(arr);
            if (idx < parentArr.length - 1) [parentArr[idx], parentArr[idx + 1]] = [parentArr[idx + 1], parentArr[idx]];
        },
        moveNodeLeft: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            if (arr.length > 1) {
                const parentArr = getTaskParentArray(arr);
                const idx = arr[arr.length - 1];
                const nodeToMove = parentArr.splice(idx, 1)[0]; 
                const grandParentPath = arr.slice(0, -1);
                const grandParentArr = getTaskParentArray(grandParentPath);
                const parentGroupIdx = grandParentPath[grandParentPath.length - 1];
                grandParentArr.splice(parentGroupIdx + 1, 0, nodeToMove);
            }
        },
        moveNodeRight: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                const prevSibling = parentArr[idx - 1];
                if (prevSibling.type === 'group') {
                    const nodeToMove = parentArr.splice(idx, 1)[0];
                    if (!prevSibling.subTasks) prevSibling.subTasks = [];
                    prevSibling.subTasks.push(nodeToMove);
                }
            }
        },
        changeNodeType: (pathStr, newType) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const parentArr = getTaskParentArray(arr);
            let task = parentArr[arr[arr.length - 1]];
            task.type = newType;
            if (newType === 'link' && !task.url) { task.url = ''; task.url_text = ''; }
            
            if (newType === 'audio_record') {
                if (!task.raw_data) task.raw_data = {};
                if (task.raw_data.use_ai_grading === undefined) task.raw_data.use_ai_grading = false;
                if (task.raw_data.use_ai_grammar === undefined) task.raw_data.use_ai_grammar = false;
                if (task.raw_data.capture_studio === undefined) task.raw_data.capture_studio = true;
                if (task.raw_data.capture_upload === undefined) task.raw_data.capture_upload = true;
                if (task.raw_data.script_source === undefined) task.raw_data.script_source = 'meta';
                if (task.raw_data.material_range === undefined) task.raw_data.material_range = '';
                if (task.raw_data.ai_source_type === undefined) task.raw_data.ai_source_type = 'text';
                if (task.raw_data.student_source_type === undefined) task.raw_data.student_source_type = 'text';
            }
            if (newType === 'exam') {
                if (!task.raw_data) task.raw_data = {};
                if (task.raw_data.exam_job_id === undefined) task.raw_data.exam_job_id = '';
                if (task.raw_data.exam_title === undefined) task.raw_data.exam_title = '';
                if (task.raw_data.exam_job === undefined) task.raw_data.exam_job = null;
            }
        },
        updateNodeUrl: (pathStr, val) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            getTaskParentArray(arr)[arr[arr.length - 1]].url = val;
        },
        /**
         * 「套用 Snapshot」過去只把結果寫進 DOM（欄位、hidden json），沒有同步回
         * BuilderStore 的 state。只要中間發生任何一次重繪（切分頁、加/刪節點…），
         * template 會照 state 重新產生 HTML，剛套用好的 6 筆 meta／base 範圍就會被
         * state 裡的舊值蓋掉，變成「改對又改錯」的迴圈。這裡把 snapshot 結果直接
         * 寫回 state，讓重繪後 hydrate 也能還原一樣的內容。
         */
        updateNodeMaterialSnapshot: (pathStr, snapshot) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const task = getTaskParentArray(arr)[arr[arr.length - 1]];
            if (!task || !snapshot) return;
            if (!task.raw_data) task.raw_data = {};
            const rd = task.raw_data;
            if (Array.isArray(snapshot.material_refs) && snapshot.material_refs.length) {
                rd.material_refs = snapshot.material_refs;
                rd.material_ref = snapshot.material_refs[0];
            } else if (snapshot.material_ref) {
                rd.material_ref = snapshot.material_ref;
                rd.material_refs = [snapshot.material_ref];
            }
            if (snapshot.material_range) rd.material_range = snapshot.material_range;
            if (snapshot.original_script) rd.original_script = snapshot.original_script;
            const displayText = snapshot.student_display || snapshot.student_display_text;
            if (displayText) {
                rd.student_display = displayText;
                rd.student_display_text = displayText;
                rd.student_text = displayText;
            }
            if (snapshot.snapshot_at) rd.snapshot_at = snapshot.snapshot_at;
            if (Array.isArray(snapshot.grading_units)) rd.grading_units = snapshot.grading_units;
            if (Array.isArray(snapshot.meta_items)) rd.meta_items = snapshot.meta_items;
            // 完整 meta 列快取：考試產生線上卷／可用題靠它。完整套用時以本次 snapshot 為準（可含刪冊）
            if (snapshot.meta_rows_by_stem && typeof snapshot.meta_rows_by_stem === 'object') {
                rd.meta_rows_by_stem = snapshot.meta_rows_by_stem;
            }
            if (snapshot.recording_unit) rd.recording_unit = snapshot.recording_unit;
            if (snapshot.recording_unit_hint) rd.recording_unit_hint = snapshot.recording_unit_hint;
            rd.script_source = 'meta';
            const plainTitle = String(task.title || '').replace(/<[^>]*>/g, '').trim();
            if (!plainTitle && rd.material_range) task.title = rd.material_range;
        },
        copyPrevNodeUrl: (pathStr) => {
            syncState();
            const arr = pathStr.split('-').map(Number);
            const idx = arr[arr.length - 1];
            if (idx > 0) {
                const parentArr = getTaskParentArray(arr);
                if (parentArr[idx - 1].url) parentArr[idx].url = parentArr[idx - 1].url;
            }
        },
        addResourceTaskAsLink: (pathStr, res) => {
            syncState();
            let targetArr;
            if (!pathStr) targetArr = bState.tasks;
            else {
                const arr = pathStr.split('-').map(Number);
                const targetNode = getTaskParentArray(arr)[arr[arr.length - 1]];
                if (!targetNode.subTasks) targetNode.subTasks = [];
                targetArr = targetNode.subTasks;
            }
            targetArr.push({
                id: `task_${Date.now()}_${Math.random()}`, type: 'link', title: res.name, url: res.url, url_text: '', 
                description: '', due_date: '', late_mode: 'infinite', grace_period_hours: 0, penalty_percentage: 0, resource_id: res.id,
                raw_data: {}
            });
        },
        copyHistory: (historyAssignment) => {
            syncState();
            if (window.AssignmentClone && typeof window.AssignmentClone.cloneAssignmentRecord === 'function') {
                var cloned = window.AssignmentClone.cloneAssignmentRecord(historyAssignment);
                bState.title = cloned.title;
                bState.description = cloned.description;
                bState.due_date = cloned.due_date;
                bState.is_published = false;
                bState.tasks = cloned.tasks;

                var clonedRaw = cloned.raw_data || {};
                if (clonedRaw.late_policy) {
                    if (!clonedRaw.late_policy.allow_late) bState.late_mode = 'no_late';
                    else if (clonedRaw.late_policy.grace_period_hours > 0) bState.late_mode = 'custom';
                    else bState.late_mode = 'infinite';
                    bState.late_grace = clonedRaw.late_policy.grace_period_hours || 0;
                    bState.late_penalty = clonedRaw.late_policy.penalty_percentage || 0;
                } else {
                    bState.late_mode = 'infinite'; bState.late_grace = 0; bState.late_penalty = 0;
                }
                return;
            }

            bState.title = historyAssignment.title; 
            bState.description = historyAssignment.description;
            bState.due_date = historyAssignment.due_date; 
            bState.is_published = historyAssignment.is_published;
            
            let aRaw = historyAssignment.raw_data || {};
            if (typeof aRaw === 'string') { try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; } }
            
            if (aRaw.late_policy) {
                if (!aRaw.late_policy.allow_late) bState.late_mode = 'no_late';
                else if (aRaw.late_policy.grace_period_hours > 0) bState.late_mode = 'custom';
                else bState.late_mode = 'infinite';
                bState.late_grace = aRaw.late_policy.grace_period_hours || 0;
                bState.late_penalty = aRaw.late_policy.penalty_percentage || 0;
            } else {
                bState.late_mode = 'infinite'; bState.late_grace = 0; bState.late_penalty = 0;
            }

            const assignNewIdsRecursive = (tasksList) => {
                return (tasksList || []).map(t => {
                    const cloned = { ...t, id: `task_${Date.now()}_${Math.random()}` };
                    delete cloned.resource_id;
                    if (!cloned.raw_data) cloned.raw_data = {};
                    
                    if (cloned.type === 'audio_record') {
                        if (cloned.raw_data.use_ai_grading === undefined) cloned.raw_data.use_ai_grading = true;
                        if (cloned.raw_data.use_ai_grammar === undefined) cloned.raw_data.use_ai_grammar = false;
                        if (cloned.raw_data.capture_studio === undefined) cloned.raw_data.capture_studio = true;
                        if (cloned.raw_data.capture_upload === undefined) cloned.raw_data.capture_upload = true;
                        if (cloned.raw_data.script_source === undefined) cloned.raw_data.script_source = 'meta';
                        if (cloned.raw_data.ai_source_type === undefined) cloned.raw_data.ai_source_type = 'text';
                        if (cloned.raw_data.student_source_type === undefined) cloned.raw_data.student_source_type = 'text';
                    }
                    if (cloned.type === 'group' && cloned.subTasks) cloned.subTasks = assignNewIdsRecursive(cloned.subTasks);
                    return cloned;
                });
            };
            bState.tasks = assignNewIdsRecursive(JSON.parse(JSON.stringify(historyAssignment.tasks || [])));
        }
    };
})();
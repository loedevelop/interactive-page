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

    function displayStemFromMetaFile(fileName) {
        const stem = String(fileName || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        const m = stem.match(/^(.+)\.([A-Za-z][A-Za-z0-9_-]*)$/);
        return m ? m[1] : stem;
    }

    function packLabelWithSheets(base, gRaw) {
        const label = String(base || '').trim();
        const rows = (gRaw && Array.isArray(gRaw.pack_rows) && gRaw.pack_rows.length)
            ? gRaw.pack_rows
            : [{ meta_file: gRaw && gRaw.pack_meta_file }];
        const extra = [];
        const seen = {};
        rows.forEach(function (r) {
            const stem = displayStemFromMetaFile((r && r.meta_file) || '');
            const u = stem.toUpperCase();
            if (!stem || seen[u]) return;
            seen[u] = true;
            if (label && label.toUpperCase().indexOf(u) !== -1) return;
            extra.push(stem);
        });
        if (!extra.length) return label;
        return (label ? (label + ' ') : '') + extra.join(' ');
    }

    /**
     * 範圍層組標題：
     * - 已選套餐 → 套餐名稱（pack_combo_label），活頁名再加上
     * - 舊作業沒有 pack_combo_id → 才退回錄音 material_range（相容舊資料）
     * 沒選套餐、或本班尚未指派套餐 → 空白，不拿別班／別套餐補。
     */
    function deriveRangeTitleFromGroup(groupNode) {
        if (!groupNode) return '';
        const gRaw = groupNode.raw_data || {};
        const packRows = (gRaw && Array.isArray(gRaw.pack_rows)) ? gRaw.pack_rows : [];
        const comboLabels = [];
        const seenCombo = {};
        packRows.forEach(function (r) {
            const lab = String((r && r.combo_label) || '').trim();
            const id = String((r && r.combo_id) || '').trim();
            const key = id || lab;
            if (!key || seenCombo[key]) return;
            seenCombo[key] = true;
            if (lab) comboLabels.push(lab);
        });
        const packId = String(gRaw.pack_combo_id || (packRows[0] && packRows[0].combo_id) || '').trim();
        const packLabel = comboLabels.length
            ? comboLabels.join('／')
            : String(gRaw.pack_combo_label || '').trim();
        if (packId || comboLabels.length) {
            if (packLabel) return packLabelWithSheets(packLabel, gRaw);
            const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
            const classId = (bState && bState.classId) || '';
            const fcmc = window.FeatureClassMaterialCombinations;
            const combo = (fcmc && typeof fcmc.getAssignedComboById === 'function')
                ? fcmc.getAssignedComboById(classId, packId)
                : null;
            const named = (combo && combo.label) ? String(combo.label).trim() : '';
            return named ? packLabelWithSheets(named, gRaw) : '';
        }
        if (!Array.isArray(groupNode.subTasks)) return '';
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

    function syncRangePackFieldsFromDom(t, pathStr) {
        if (!t || !t.raw_data) return;
        const isHost = t.raw_data.group_role === 'range' || t.type === 'audio_record';
        if (!isHost) return;
        const panel = document.querySelector('.range-pack-panel[data-range-pack="' + pathStr + '"]');
        const blockEls = panel ? panel.querySelectorAll('.range-pack-block') : [];
        if (blockEls.length) {
            const rows = [];
            Array.prototype.forEach.call(blockEls, function (blockEl, bi) {
                const comboEl = document.getElementById('range-pack-combo-' + pathStr + '-' + bi)
                    || (blockEl && blockEl.querySelector('.range-pack-combo'));
                const comboId = comboEl ? String(comboEl.value || '').trim() : '';
                const opt = comboEl && comboEl.options[comboEl.selectedIndex];
                const comboLabel = (comboId && opt) ? String(opt.text || '').trim() : '';
                const rowEls = blockEl.querySelectorAll('.range-pack-row');
                if (!rowEls.length) {
                    rows.push({ combo_id: comboId, combo_label: comboLabel, meta_file: '', range_type: 'page', start: '', end: '' });
                    return;
                }
                Array.prototype.forEach.call(rowEls, function (rowEl) {
                    const idx = rowEl.getAttribute('data-row-idx');
                    const sheetEl = (idx != null ? document.getElementById('range-pack-sheet-' + pathStr + '-' + idx) : null)
                        || (rowEl && rowEl.querySelector('.range-pack-sheet'));
                    const rtypeEl = idx != null ? document.getElementById('range-pack-rtype-' + pathStr + '-' + idx) : null;
                    const startEl = idx != null ? document.getElementById('range-pack-start-' + pathStr + '-' + idx) : null;
                    const endEl = idx != null ? document.getElementById('range-pack-end-' + pathStr + '-' + idx) : null;
                    rows.push({
                        combo_id: comboId,
                        combo_label: comboLabel,
                        meta_file: sheetEl ? String(sheetEl.value || '').trim() : '',
                        range_type: (rtypeEl && rtypeEl.value === 'qnum') ? 'qnum' : 'page',
                        start: startEl ? String(startEl.value || '').trim() : '',
                        end: endEl ? String(endEl.value || '').trim() : ''
                    });
                });
            });
            t.raw_data.pack_rows = rows;
            t.raw_data.pack_combo_id = rows[0].combo_id || '';
            t.raw_data.pack_combo_label = rows[0].combo_label || '';
            t.raw_data.pack_meta_file = rows[0].meta_file;
            t.raw_data.pack_range_type = rows[0].range_type;
            t.raw_data.pack_start = rows[0].start;
            t.raw_data.pack_end = rows[0].end;
            return;
        }
        const sheetEl = document.getElementById('range-pack-sheet-' + pathStr);
        const rtypeEl = document.getElementById('range-pack-rtype-' + pathStr);
        const startEl = document.getElementById('range-pack-start-' + pathStr);
        const endEl = document.getElementById('range-pack-end-' + pathStr);
        if (sheetEl) t.raw_data.pack_meta_file = String(sheetEl.value || '').trim();
        if (rtypeEl) t.raw_data.pack_range_type = rtypeEl.value === 'qnum' ? 'qnum' : 'page';
        if (startEl) t.raw_data.pack_start = String(startEl.value || '').trim();
        if (endEl) t.raw_data.pack_end = String(endEl.value || '').trim();
    }

    /**
     * 範圍層標題空白、或仍標記為「自動繼承中」時，用套餐名（或舊作業的錄音範圍）自動產生；
     * 不覆寫老師已真正手動填過的標題（title_auto_from_range === false 才算手動）。
     */
    function fillBlankRangeGroupTitles(tasks) {
        (tasks || []).forEach(function (t) {
            if (!t || t.type !== 'group') return;
            if (t.subTasks) fillBlankRangeGroupTitles(t.subTasks);
            if (!(t.raw_data && t.raw_data.group_role === 'range')) return;
            const plain = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
            const wasAuto = !!(t.raw_data && t.raw_data.title_auto_from_range);
            if (plain && !wasAuto) return;
            const derived = deriveRangeTitleFromGroup(t);
            if (derived) {
                t.title = derived;
                t.raw_data.title_auto_from_range = true;
            }
        });
    }

    function syncTasksState(tasks, parentPathArray = [], opts) {
        tasks.forEach((t, idx) => {
            const pathArray = [...parentPathArray, idx];
            const pathStr = pathArray.join('-');
            
            const titleEl = document.getElementById(`node-title-${pathStr}`);
            if (titleEl) {
                let text = titleEl.textContent.trim();
                t.title = (text === '') ? '' : titleEl.innerHTML;
                // 💣 雷區（見 skeleton-unit-invariant 類似坑）：曾發生「base 範圍自動算出的標題」
                // 存檔後就凍死在畫面空白判斷之外──因為自動填的文字會直接寫進 t.title 這個會存檔的欄位，
                // 下次重新整理時 t.title 已非空，系統就再也認不出這是「自動」還是「老師手打」，
                // 導致老師怎麼改 base 範圍，標題永遠卡在第一次算出來的那個值（例："Unit 10"）。
                // 修法：把「是否為自動繼承」獨立存成 raw_data.title_auto_from_range，
                // 不再單靠「標題是否為空」判斷，這樣即使 t.title 有字，只要旗標仍是 true，
                // 下次 render／sync 仍會繼續追隨最新 base 範圍，直到老師真的手動編輯過才凍結。
                if (!t.raw_data) t.raw_data = {};
                t.raw_data.title_auto_from_range = (titleEl.getAttribute('data-title-auto') === '1');
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
                syncRangePackFieldsFromDom(t, pathStr);
                if (t.subTasks) syncTasksState(t.subTasks, pathArray, opts);
                // 範圍層標題：空白，或仍標記為「自動繼承中」→ 用套餐名（舊作業則用錄音範圍）重算
                // （不能只看「標題是否為空」，否則存過一次非空標題後就再也追不到新來源）
                if (t.raw_data && t.raw_data.group_role === 'range') {
                    const plain = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
                    const wasAuto = !!(t.raw_data && t.raw_data.title_auto_from_range);
                    if (!plain || wasAuto) {
                        const derived = deriveRangeTitleFromGroup(t);
                        if (derived) {
                            t.title = derived;
                            t.raw_data.title_auto_from_range = true;
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
                    syncRangePackFieldsFromDom(t, pathStr);
                    
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
                    // 💣 骨架模式（E）base 範圍手動覆寫旗標：見 feature-timeline.js refreshSkeletonRangeLabel
                    // 旁的雷區說明，需持久化才能在重新整理／重開編輯器後仍記得「這欄已被老師手動改過」。
                    if (scriptSource === 'skeleton' && materialRangeManualEl) {
                        t.raw_data.skeleton_range_auto = (materialRangeManualEl.getAttribute('data-range-auto') !== '0');
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
                            t.raw_data.title_auto_from_range = true;
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
                    const writtenEl = document.getElementById(`node-written-text-${pathStr}`);
                    const studentTextEl = document.getElementById(`node-student-text-${pathStr}`);
                    const scriptPasteEl = document.getElementById(`node-script-paste-${pathStr}`);
                    const studentPasteEl = document.getElementById(`node-student-text-paste-${pathStr}`);

                    if (scriptSource === 'paste') {
                        // C：可拆成多個「視窗」（每頁／每個 exercise 各一段），DOM 結構見
                        // ui-timeline-templates.js 的 renderPasteWindowRowHtml。存檔時：
                        // 1) 結構化留一份 raw_data.paste_windows（供「由下往上收集文稿」直接讀，不用猜）
                        // 2) 合併成既有 original_script／student_display（AI 批改管線讀法完全不變）；
                        //    只有視窗數 >1 或任一視窗有標籤時，才會加上【label】前綴，
                        //    單一視窗又沒標籤＝跟舊格式一模一樣（不污染最單純的案例）。
                        const windowsContainer = document.getElementById(`node-paste-windows-${pathStr}`);
                        const windowRowEls = windowsContainer ? Array.prototype.slice.call(windowsContainer.querySelectorAll('.paste-window-row')) : [];
                        let pasteWindows;
                        if (windowRowEls.length) {
                            pasteWindows = windowRowEls.map(function (row) {
                                const labelEl = row.querySelector('.paste-window-label');
                                const scriptWinEl = row.querySelector('.paste-window-script');
                                const studentWinEl = row.querySelector('.paste-window-student');
                                return {
                                    label: labelEl ? String(labelEl.value || '').trim() : '',
                                    script: scriptWinEl ? scriptWinEl.value : '',
                                    student: studentWinEl ? studentWinEl.value : ''
                                };
                            });
                        } else if (scriptPasteEl || studentPasteEl) {
                            pasteWindows = [{ label: '', script: scriptPasteEl ? scriptPasteEl.value : '', student: studentPasteEl ? studentPasteEl.value : '' }];
                        } else {
                            pasteWindows = Array.isArray(t.raw_data.paste_windows) ? t.raw_data.paste_windows : [];
                        }
                        t.raw_data.paste_windows = pasteWindows;
                        const hasMultiOrLabeled = pasteWindows.length > 1 || pasteWindows.some(function (w) { return w && w.label; });
                        t.raw_data.original_script = sanitizeScript(pasteWindows.map(function (w) {
                            const script = (w && w.script) || '';
                            if (!script) return '';
                            return (hasMultiOrLabeled && w.label) ? ('【' + w.label + '】\n' + script) : script;
                        }).filter(Boolean).join('\n\n'));
                        const displayText = pasteWindows.map(function (w) {
                            const student = (w && w.student) || '';
                            if (!student) return '';
                            return (hasMultiOrLabeled && w.label) ? ('【' + w.label + '】\n' + student) : student;
                        }).filter(Boolean).join('\n\n');
                        t.raw_data.student_text = displayText;
                        t.raw_data.student_display = displayText;
                        t.raw_data.student_display_text = displayText;
                        if (scriptEl) scriptEl.value = t.raw_data.original_script;
                        if (studentTextEl) studentTextEl.value = displayText;
                    } else if (scriptSource === 'range_only') {
                        // 僅範圍：清掉顯示文稿本體（保留 material_range）
                        t.raw_data.student_display = '';
                        t.raw_data.student_display_text = '';
                        t.raw_data.student_text = '';
                        if (scriptEl) t.raw_data.original_script = sanitizeScript(scriptEl.value);
                    } else if (scriptSource === 'skeleton') {
                        // E：反向流程──先手動定義單元路徑（不需要 meta 檔），文稿可留空、之後回來補。
                        // 💣 見 .cursor/rules/skeleton-unit-invariant.mdc：grading_units 由 DOM 表格整份覆寫，
                        // 老師刪列＝真的刪單元，這是骨架模式的預期行為（跟 A 的「禁止縮水覆寫」不同語意）。
                        const skeletonUnits = (window.FeatureTimeline && typeof window.FeatureTimeline.collectSkeletonUnitsFromDom === 'function')
                            ? window.FeatureTimeline.collectSkeletonUnitsFromDom(pathStr)
                            : (Array.isArray(t.raw_data.grading_units) ? t.raw_data.grading_units : []);
                        t.raw_data.grading_units = skeletonUnits;
                        t.raw_data.original_script = sanitizeScript(skeletonUnits.map(function (u) {
                            const label = u.label || u.stem || '';
                            const script = u.original_script || '';
                            return script ? ('【' + label + '】\n' + script) : '';
                        }).filter(Boolean).join('\n\n'));
                        // 骨架模式沒有「合併學生顯示文稿」概念；學生端看單元路徑＋（選填）PDF 對照
                        t.raw_data.student_display = '';
                        t.raw_data.student_display_text = '';
                        t.raw_data.student_text = '';
                    } else {
                        if (scriptEl) t.raw_data.original_script = sanitizeScript(scriptEl.value);
                        if (writtenEl) t.raw_data.written_display = writtenEl.value;
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
                                if (snap.written_display || (writtenEl && writtenEl.value)) {
                                    t.raw_data.written_display = (writtenEl && writtenEl.value) || snap.written_display || '';
                                }
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

                if (t.type === 'exam' && !(opts && opts.skipExam)) {
                    // 考試標題：這份考試自己的區塊＋起迄（沒有才退回同層錄音）。自動旗標跟錄音同一把。
                    const examRange = (window.FeatureExamJob && typeof window.FeatureExamJob.getExamRangeLabel === 'function')
                        ? (window.FeatureExamJob.getExamRangeLabel(pathStr, t) || '')
                        : ((window.FeatureExamJob && typeof window.FeatureExamJob.getSiblingAudioRangeLabel === 'function')
                            ? (window.FeatureExamJob.getSiblingAudioRangeLabel(pathStr) || '')
                            : '');
                    const titlePlain = titleEl
                        ? String(titleEl.textContent || '').trim()
                        : String(t.title || '').replace(/<[^>]*>/g, '').trim();
                    if (!t.raw_data) t.raw_data = {};
                    const autoFlag = titleEl ? titleEl.getAttribute('data-title-auto') : null;
                    const prevFrom = titleEl
                        ? String(titleEl.getAttribute('data-title-from-range') || '').trim()
                        : '';
                    const wasAuto = t.raw_data.title_auto_from_range === true;
                    const shouldAuto = !titlePlain || autoFlag === '1' || wasAuto
                        || (prevFrom && titlePlain === prevFrom);
                    if (shouldAuto && examRange) {
                        t.title = examRange;
                        t.raw_data.title_auto_from_range = true;
                        t.raw_data.exam_title = examRange;
                        if (titleEl) {
                            titleEl.textContent = examRange;
                            titleEl.setAttribute('data-title-auto', '1');
                            titleEl.setAttribute('data-title-from-range', examRange);
                        }
                    } else if (titlePlain) {
                        t.raw_data.title_auto_from_range = false;
                        if (titleEl) titleEl.setAttribute('data-title-auto', '0');
                    }
                    if (window.FeatureExamJob && typeof window.FeatureExamJob.syncInlineEditor === 'function') {
                        window.FeatureExamJob.syncInlineEditor(pathStr, t);
                    }
                }

                // 🆕 PDF 考卷：只把畫面上的解答文字 textarea 同步回 raw_data，其餘（上傳的 PDF、
                // 答案清單、已畫的框）都是直接 mutate task.raw_data.pdf_exam_job，不靠這裡同步。
                if (t.type === 'pdf_exam' && window.FeaturePdfExamJob && typeof window.FeaturePdfExamJob.syncInlineEditor === 'function') {
                    window.FeaturePdfExamJob.syncInlineEditor(pathStr, t);
                }
            }
        });
    }

    function syncState(opts) {
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
        if (bState.tasks) syncTasksState(bState.tasks, [], opts);
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
        sync: (opts) => syncState(opts),
        deriveRangeTitleFromGroup: deriveRangeTitleFromGroup,
        fillBlankRangeGroupTitles: fillBlankRangeGroupTitles,
        
        getTaskParentArray: getTaskParentArray,

        /** 新作業慣例：教材／群組底下掛「範圍層」，再掛錄音＋考試 */
        _isRangeGroupNode: (node) => !!(node && node.type === 'group' && node.raw_data && node.raw_data.group_role === 'range'),

        // 💣 雷區：曾發生老師沒勾 AI 批改，學生端卻照樣送 AI——因為新建任務預設
        // use_ai_grading: true，勾選框一開始就是「已勾」，老師沒動它＝以為沒開，實際是開的。
        // 改為預設 false（需老師明確勾選才送 AI），只影響「新建」任務；已存在資料不動。
        // 🧩 若老師本人在「系統帳號設定」設過跨班預設「新錄音任務預設勾 AI 批改」，這裡改用該值；
        // 快取還沒抓到之前一律維持安全預設 false（見 020_js_core/teacher-prefs.js getCachedSync）。
        _defaultAudioRaw: () => {
            const teacherDefaults = window.TeacherPrefs ? window.TeacherPrefs.getCachedSync() : {};
            const useAiDefault = teacherDefaults.default_use_ai_grading === true;
            return {
                use_ai_grading: useAiDefault,
                use_ai_grammar: false,
                capture_studio: true,
                capture_upload: true,
                script_source: 'meta',
                material_range: '',
                ai_source_type: 'text',
                student_source_type: 'text'
            };
        },

        _defaultExamRaw: () => ({
            exam_job_id: '',
            exam_title: '',
            exam_job: null
        }),

        // 🆕 PDF 考卷（全新、獨立的考試模式，見 feature-pdf-exam-job.js）：真正的資料結構
        // （pdf_exam_job：pdf_file_id／parsed_bank／items 等）由 FeaturePdfExamJob.ensureJob 在
        // 第一次編輯時補建，這裡只放 null 佔位，避免這個檔案跟 PDF 考卷的實作細節綁死。
        _defaultPdfExamRaw: () => ({
            pdf_exam_job: null
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
            else if (type === 'pdf_exam') raw = window.BuilderStore._defaultPdfExamRaw();
            else if (type === 'group') raw = {};

            // 舊範圍層（沒選套餐）底下加錄音：若尚未填 material_range，帶入父層標題當提示。
            // 已開包選套餐的範圍層：組標題是套餐名，不可寫進錄音範圍。
            if (type === 'audio_record' && window.BuilderStore._isRangeGroupNode(parentNode)) {
                const parentRaw = parentNode.raw_data || {};
                if (!parentRaw.pack_combo_id) {
                    const rangeHint = (parentNode.title || '').replace(/<[^>]*>?/gm, '').trim();
                    if (rangeHint && !raw.material_range) raw.material_range = rangeHint;
                }
            }

            const node = window.BuilderStore._makeLeafNode(type, defaultTitle, raw);
            if (type === 'group') node.subTasks = [];
            targetArr.push(node);
        },

        /**
         * 一鍵建立「範圍群組 → 錄音＋考試」（僅影響新建節點，不改舊作業）
         * 開包後先選本班已指派套餐；組標題＝套餐名，錄音／考試小標題＝活頁＋起迄。
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
                raw_data: {
                    group_role: 'range',
                    title_auto_from_range: true,
                    pack_combo_id: '',
                    pack_combo_label: '',
                    pack_meta_file: '',
                    pack_range_type: 'page',
                    pack_start: '',
                    pack_end: '',
                    pack_rows: [{ combo_id: '', combo_label: '', meta_file: '', range_type: 'page', start: '', end: '' }]
                },
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
            if (newType === 'pdf_exam') {
                if (!task.raw_data) task.raw_data = {};
                if (task.raw_data.pdf_exam_job === undefined) task.raw_data.pdf_exam_job = null;
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
            // Snapshot 寫回錄音欄。不准順便 sync 試卷 DOM：帶入剛寫進 state 的套餐／區塊
            // 若畫面還沒重繪完，會被舊試卷（常只剩套餐二第一塊）蓋掉。
            syncState({ skipExam: true });
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
            // 有套用就寫回，空的也要寫：不准把舊的三行中文／空口說留在 state 裡裝成已帶入
            rd.original_script = snapshot.original_script || '';
            rd.written_display = snapshot.written_display || '';
            const displayText = snapshot.student_display || snapshot.student_display_text || '';
            rd.student_display = displayText;
            rd.student_display_text = displayText;
            rd.student_text = displayText;
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
                    if (window.AssignmentClone && typeof window.AssignmentClone.stripExamTaskOutputs === 'function') {
                        cloned.raw_data = window.AssignmentClone.stripExamTaskOutputs(cloned.raw_data);
                    } else {
                        delete cloned.raw_data.quiz_paper;
                        delete cloned.raw_data.quiz_paper_no;
                        delete cloned.raw_data.quiz_paper_signature;
                        delete cloned.raw_data.exam_job_id;
                        delete cloned.raw_data.meta_rows_by_stem;
                        delete cloned.raw_data.last_generate_error;
                    }

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
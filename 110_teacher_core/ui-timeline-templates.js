/**
 * 📂 檔案路徑：110_teacher_core/ui-timeline-templates.js
 * 🌟 純視覺模板工廠 v48：
 * - 實裝真實的前端 Excel (.xlsx, .xls) 解析，結合 SheetJS，支援指定活頁與範圍。
 * - 徹底對齊「Drive / Local / 貼上文字」三大資料來源結構，並擴充學生教材的「範圍/說明」欄位。
 */

window.TimelineTemplates = (() => {

    function stampLabel(value) {
        if (window.UtilsDate && typeof window.UtilsDate.formatStampLabel === 'function') {
            return window.UtilsDate.formatStampLabel(value);
        }
        return String(value || '');
    }

    function dateTimeFields(dateId, timeId, stored, dateStyle, timeStyle) {
        if (window.UtilsDate && typeof window.UtilsDate.dateTimeInputHtml === 'function') {
            return window.UtilsDate.dateTimeInputHtml(dateId, timeId, stored, dateStyle, timeStyle);
        }
        return `<input type="date" id="${dateId}" class="form-control" style="${dateStyle || ''}" value="${stored || ''}">`;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function displayStemFromMetaFile(fileName) {
        const stem = String(fileName || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        const m = stem.match(/^(.+)\.([A-Za-z][A-Za-z0-9_-]*)$/);
        return m ? m[1] : stem;
    }

    function isComboInheritType(type) {
        return type === 'check' || type === 'link' || type === 'audio_record'
            || type === 'exam' || type === 'pdf_exam' || type === 'drive';
    }

    /** 組合層底下：小標題只讀上方 pack。不是組合層＝空。 */
    function comboPackTitleForPath(pathStr) {
        const FT = window.FeatureTimeline;
        if (!FT || typeof FT.parentRangeGroupPathOf !== 'function') return '';
        if (!FT.parentRangeGroupPathOf(pathStr)) return '';
        if (typeof FT.packRangeLabelForAudio !== 'function') return '';
        return FT.packRangeLabelForAudio(pathStr) || '';
    }

    function packShuffleOnForRender(r) {
        if (!r) return true;
        if (r.shuffle === false || r.shuffle === 'false' || r.shuffle === 0 || r.shuffle === '0') return false;
        return true;
    }

    function copyPackExamFieldsForRender(r) {
        return {
            lines_per_page: r && r.lines_per_page != null && r.lines_per_page !== '' ? String(r.lines_per_page) : '',
            difficulty: r && r.difficulty != null ? String(r.difficulty) : '',
            include_nums: r && r.include_nums != null ? String(r.include_nums) : '',
            exclude_nums: r && r.exclude_nums != null ? String(r.exclude_nums) : '',
            count: r && r.count != null && r.count !== '' ? String(r.count) : '',
            shuffle: packShuffleOnForRender(r)
        };
    }

    /** 組合層開包：選套餐 → 區段＋範圍＋選題。考試／錄音／PDF 考只讀這份。 */
    function normalizePackRowsForRender(raw) {
        const fallbackComboId = String((raw && raw.pack_combo_id) || '').trim();
        const fallbackComboLabel = String((raw && raw.pack_combo_label) || '').trim();
        if (raw && Array.isArray(raw.pack_rows) && raw.pack_rows.length) {
            return raw.pack_rows.map(function (r) {
                const ownId = String((r && r.combo_id) || '').trim();
                const metaFile = String((r && r.meta_file) || '').trim();
                const comboId = ownId || (metaFile ? fallbackComboId : '');
                return Object.assign({
                    combo_id: comboId,
                    combo_label: String((r && r.combo_label) || (comboId ? fallbackComboLabel : '')).trim(),
                    meta_file: metaFile,
                    range_type: (r && r.range_type) === 'qnum' ? 'qnum' : 'page',
                    start: r && r.start != null ? String(r.start) : '',
                    end: r && r.end != null ? String(r.end) : ''
                }, copyPackExamFieldsForRender(r));
            });
        }
        return [Object.assign({
            combo_id: fallbackComboId,
            combo_label: fallbackComboLabel,
            meta_file: String((raw && raw.pack_meta_file) || '').trim(),
            range_type: (raw && raw.pack_range_type) === 'qnum' ? 'qnum' : 'page',
            start: raw && raw.pack_start != null ? String(raw.pack_start) : '',
            end: raw && raw.pack_end != null ? String(raw.pack_end) : ''
        }, copyPackExamFieldsForRender(null))];
    }

    // ========================================================================
    // 【死命註解｜永遠禁止刪除｜2026-08-27 老師命令綁死】
    // 這裡產生套餐下拉。只列出該班的套餐名。其他全都不准出現。
    // 資料從哪裡讀：
    //   這個班：RPC fetch_class_combo_stats（combo_statistics，class_ids 含這個班）
    //   文字：combo_label，開口 comboLabelText
    //   清單開口：listAssignedCombosForHomework(這個班 classId)
    // 不准列：別班、未勾這個班、全庫、活頁名、檔名、預設檔名、自己拼的字、
    //         不在該班清單裡的舊 id
    // ========================================================================
    function renderPackComboOptions(combos, currentId, currentLabel, cacheReady) {
        let html = '<option value="">— 請選擇這個班已指派的套餐 —</option>';
        if (!cacheReady) {
            html += '<option value="" disabled>⏳ 載入套餐…</option>';
            return html;
        }
        (combos || []).forEach(function (c) {
            if (!c || !c.id) return;
            const selected = String(c.id) === String(currentId)
                || (c.siblingIds || []).some(function (id) { return String(id) === String(currentId); });
            html += '<option value="' + escapeHtml(c.id) + '"' + (selected ? ' selected' : '') + '>'
                + escapeHtml((window.FeatureClassMaterialCombinations
                    && typeof window.FeatureClassMaterialCombinations.comboLabelText === 'function')
                    ? window.FeatureClassMaterialCombinations.comboLabelText(c)
                    : String(c.combo_label || c.comboLabel || c.rawLabel || c.label || '').trim()) + '</option>';
        });
        const manualSelected = String(currentId) === '__manual__';
        html += '<option value="__manual__"' + (manualSelected ? ' selected' : '') + '>✏️ 其他（手動輸入教材）</option>';
        if (!(combos || []).length) {
            html += '<option value="" disabled>（這個班還沒有已指派的套餐）</option>';
        }
        return html;
    }

    function packOwnSheets(combo) {
        return (combo && Array.isArray(combo.ownSheets)) ? combo.ownSheets : [];
    }

    function packSheetMetaValue(sheet) {
        const meta = String((sheet && sheet.meta) || '').trim();
        if (meta) return /\.meta\.json$/i.test(meta) ? meta : (meta + '.meta.json');
        const stem = String((sheet && sheet.stem) || '').trim();
        if (!stem) return '';
        return /\.meta\.json$/i.test(stem) ? stem : (stem + '.meta.json');
    }

    /** 區段格子：這一本活頁列的活頁別名。永遠有。沒改過的別名就是活頁名。 */
    function packSheetBlockLabel(sheet, templateName) {
        if (!sheet) return '';
        const stem = String(sheet.stem || '').trim()
            || String(sheet.meta || '').replace(/\.meta\.json$/i, '').replace(/\.meta$/i, '');
        if (window.MaterialFileNames && typeof window.MaterialFileNames.currentAlias === 'function') {
            return window.MaterialFileNames.currentAlias(stem, sheet.id, templateName);
        }
        return stem;
    }

    function packDefaultLpp(combo, row) {
        if (row && Number(row.lines_per_page) > 0) return String(Number(row.lines_per_page));
        const SR = window.SheetRangeBounds;
        if (combo && SR && typeof SR.lppForHomeworkCombo === 'function') {
            const n = SR.lppForHomeworkCombo(combo);
            if (n > 0) return String(n);
        }
        return '';
    }

    function packRowAvailLabel(classId, combo, row) {
        if (!row || String(row.start || '').trim() === '' || String(row.end || '').trim() === '') return '—';
        const fcmc = window.FeatureClassMaterialCombinations;
        const SR = window.SheetRangeBounds;
        if (!combo || !SR || typeof SR.countAvailable !== 'function') return '需讀取';
        const total = (fcmc && typeof fcmc.lookupSheetAvailableCount === 'function')
            ? fcmc.lookupSheetAvailableCount(classId, combo, row.meta_file)
            : null;
        if (total == null) return '需讀取';
        const typedLpp = Number(row.lines_per_page);
        const lpp = typedLpp > 0
            ? typedLpp
            : (typeof SR.lppForHomeworkCombo === 'function' ? SR.lppForHomeworkCombo(combo) : 0);
        const avail = SR.countAvailable({
            total: total,
            lpp: lpp,
            rangeType: row.range_type,
            start: row.start,
            end: row.end,
            excludeNums: row.exclude_nums
        });
        if (avail == null) return '需讀取';
        return String(avail);
    }

    function packDisplayPercent(count, availStr) {
        const raw = String(count == null ? '' : count).trim();
        if (raw === '') return '—';
        const c = Number(raw);
        const a = Number(availStr);
        if (isNaN(c) || isNaN(a) || a <= 0) return '—';
        return Math.round((c / a) * 100) + '%';
    }

    function collectExpandedPackItems(groupNode) {
        const raw = (groupNode && groupNode.raw_data) || {};
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const fcmc = window.FeatureClassMaterialCombinations;
        const rows = normalizePackRowsForRender(raw);
        const blocks = packBlocksFromRows(rows);
        const items = [];
        blocks.forEach(function (block) {
            let blockCombo = null;
            if (block.combo_id && fcmc && typeof fcmc.getAssignedComboById === 'function') {
                blockCombo = fcmc.getAssignedComboById(classId, block.combo_id);
            }
            let blockRows = block.rows || [];
            if (block.combo_id !== '__manual__' && blockCombo
                && window.FeatureTimeline && typeof window.FeatureTimeline.expandPackRowsForCombo === 'function') {
                blockRows = window.FeatureTimeline.expandPackRowsForCombo(classId, blockCombo, blockRows);
            }
            blockRows.forEach(function (row) {
                items.push({ combo: blockCombo, row: row });
            });
        });
        return { classId: classId, items: items };
    }

    function packSelectedCountSum(rows) {
        let sum = 0;
        let any = false;
        (rows || []).forEach(function (row) {
            const raw = String((row && row.count) != null ? row.count : '').trim();
            if (raw === '') return;
            const n = Number(raw);
            if (isNaN(n) || n < 0) return;
            sum += n;
            any = true;
        });
        return any ? String(sum) : '—';
    }

    function computePackStats(groupNode) {
        const collected = collectExpandedPackItems(groupNode);
        return { selected: packSelectedCountSum((collected.items || []).map(function (it) { return it.row; })) };
    }

    function packStatsLineHtml(stats, extraClass, pathStr, kind) {
        const selected = (stats && (stats.selected || stats.avail)) || '—';
        const isCombo = kind === 'combo';
        const title = isCombo ? '套餐總題數' : '區段考題數';
        return '<div class="range-pack-stats' + (extraClass ? (' ' + extraClass) : '') + '"'
            + (pathStr ? (' data-range-pack="' + escapeHtml(pathStr) + '"') : '')
            + ' data-stats-kind="' + (isCombo ? 'combo' : 'section') + '"'
            + ' style="font-weight:800; color:#1E3A8A; white-space:nowrap;">'
            + title + ' ' + escapeHtml(selected)
            + '</div>';
    }

    function packRowDeleteBtn(pathStr, idx, canDelete) {
        if (canDelete) {
            return '<button type="button" class="btn" style="padding:4px 8px; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; font-weight:800;" title="刪這段範圍"'
                + ' onclick="window.FeatureTimeline && window.FeatureTimeline.removeRangePackRow && window.FeatureTimeline.removeRangePackRow(\'' + pathStr + '\', ' + idx + ')">刪</button>';
        }
        return '<button type="button" class="btn" disabled style="padding:4px 8px; background:#E2E8F0; color:#94A3B8; border:1px solid #CBD5E1; font-weight:800; cursor:not-allowed;" title="唯一區段不能刪">刪</button>';
    }

    function packRowOrderControls(pathStr, idx, posInBlock, rowCount) {
        const canMove = rowCount > 1;
        const upOff = !canMove || posInBlock <= 0;
        const downOff = !canMove || posInBlock >= rowCount - 1;
        function arrowBtn(dir, off, title) {
            const delta = dir === 'up' ? -1 : 1;
            const label = dir === 'up' ? '▲' : '▼';
            if (off) {
                return '<button type="button" class="btn range-pack-move-btn" disabled title="' + title + '"'
                    + ' style="padding:0; width:22px; height:16px; line-height:1; font-size:10px; background:#E2E8F0; color:#94A3B8; border:1px solid #CBD5E1; font-weight:800; cursor:not-allowed;">'
                    + label + '</button>';
            }
            return '<button type="button" class="btn range-pack-move-btn" title="' + title + '"'
                + ' style="padding:0; width:22px; height:16px; line-height:1; font-size:10px; background:#F8FAFC; color:#334155; border:1px solid #CBD5E1; font-weight:800;"'
                + ' onmousedown="event.stopPropagation();"'
                + ' onclick="window.FeatureTimeline && window.FeatureTimeline.moveRangePackRow && window.FeatureTimeline.moveRangePackRow(\'' + pathStr + '\', ' + idx + ', ' + delta + ')">'
                + label + '</button>';
        }
        return '<div class="range-pack-move" draggable="' + (canMove ? 'true' : 'false') + '"'
            + ' title="' + (canMove ? '按箭頭或拖曳調整順序' : '') + '"'
            + (canMove
                ? (' ondragstart="window.FeatureTimeline && window.FeatureTimeline.onRangePackRowDragStart && window.FeatureTimeline.onRangePackRowDragStart(event, \'' + pathStr + '\', ' + idx + ')"')
                : '')
            + ' style="display:flex; flex-direction:column; align-items:center; gap:1px; cursor:' + (canMove ? 'grab' : 'default') + ';">'
            + arrowBtn('up', upOff, '上移')
            + arrowBtn('down', downOff, '下移')
            + '</div>';
    }

    function rowDropAttr(pathStr, idx) {
        return ' data-row-idx="' + idx + '"'
            + ' ondragover="event.preventDefault(); this.classList.add(\'range-pack-row--drag-over\');"'
            + ' ondragleave="this.classList.remove(\'range-pack-row--drag-over\');"'
            + ' ondrop="this.classList.remove(\'range-pack-row--drag-over\'); window.FeatureTimeline && window.FeatureTimeline.onRangePackRowDrop && window.FeatureTimeline.onRangePackRowDrop(event, \'' + pathStr + '\', ' + idx + ')">';
    }

    function rangePackUi() {
        return {
            escapeHtml: escapeHtml,
            packRowDeleteBtn: packRowDeleteBtn,
            packRowOrderControls: packRowOrderControls,
            rowDropAttr: rowDropAttr,
            packOwnSheets: packOwnSheets,
            packSheetMetaValue: packSheetMetaValue,
            packSheetBlockLabel: packSheetBlockLabel,
            packDefaultLpp: packDefaultLpp,
            packRowAvailLabel: packRowAvailLabel,
            packDisplayPercent: packDisplayPercent
        };
    }

    /** Excel/JSON 套餐自己的範圍表（含手動輸入）。由 sheet 策略呼叫，出作業宿主不准再 if 三種套餐。 */
    function renderSheetPackTableHtml(ctx) {
        const packUi = (ctx && ctx.packUi) || rangePackUi();
        const pathStr = (ctx && ctx.pathStr) || '';
        const rows = (ctx && ctx.block && ctx.block.rows) || [];
        const blockCombo = ctx && ctx.blockCombo;
        const isManual = !!(ctx && ctx.isManual);
        const classId = (ctx && ctx.classId) || '';
        const startIdx = Number(ctx && ctx.startIdx) || 0;
        const ownSheets = packOwnSheets(blockCombo);
        const isGroup = !!(blockCombo && blockCombo.isGroup === true);
        const blockRowCount = rows.length;
        const sheetRows = rows.map(function (row, posInBlock) {
            const idx = startIdx + posInBlock;
            const delSheet = packUi.packRowDeleteBtn(pathStr, idx, blockRowCount > 1);
            const orderCell = packUi.packRowOrderControls(pathStr, idx, posInBlock, blockRowCount);
            const drop = packUi.rowDropAttr(pathStr, idx);
            let sheetCell;
            if (isManual) {
                sheetCell = '<input type="text" id="range-pack-manual-' + pathStr + '-' + idx + '" class="form-control range-pack-manual"'
                    + ' value="' + escapeHtml(row.combo_label || '') + '" placeholder="手動輸入教材"'
                    + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })">'
                    + '<input type="hidden" id="range-pack-sheet-' + pathStr + '-' + idx + '" class="range-pack-sheet" value="">';
            } else if (isGroup) {
                const cur = String(row.meta_file || '').replace(/\.meta\.json$/i, '').toUpperCase();
                sheetCell = '<select id="range-pack-sheet-' + pathStr + '-' + idx + '" class="form-control range-pack-sheet"'
                    + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: true, clamp: true })">'
                    + '<option value="">— 選區段 —</option>'
                    + ownSheets.map(function (sheet) {
                        const file = packSheetMetaValue(sheet);
                        const key = String(file || '').replace(/\.meta\.json$/i, '').toUpperCase();
                        return '<option value="' + escapeHtml(file) + '"'
                            + (key && key === cur ? ' selected' : '') + '>'
                            + escapeHtml(packSheetBlockLabel(sheet, blockCombo && blockCombo.extractionTemplateName)) + '</option>';
                    }).join('')
                    + '</select>';
            } else if (ownSheets.length === 1) {
                const only = ownSheets[0];
                const file = packSheetMetaValue(only);
                sheetCell = '<input type="hidden" id="range-pack-sheet-' + pathStr + '-' + idx + '" class="range-pack-sheet" value="' + escapeHtml(file) + '">'
                    + '<div>' + escapeHtml(packSheetBlockLabel(only, blockCombo && blockCombo.extractionTemplateName)) + '</div>';
            } else if (blockCombo && ownSheets.length === 0) {
                sheetCell = '<input type="hidden" id="range-pack-sheet-' + pathStr + '-' + idx + '" class="range-pack-sheet" value="">'
                    + '<div style="color:#B91C1C; font-weight:800;">這份套餐沒有活頁</div>';
            } else if (blockCombo && ownSheets.length > 1) {
                sheetCell = '<input type="hidden" id="range-pack-sheet-' + pathStr + '-' + idx + '" class="range-pack-sheet" value="">'
                    + '<div style="color:#B91C1C; font-weight:800;">這份套餐不是群組，卻有不只一本活頁</div>';
            } else {
                sheetCell = '<input type="hidden" id="range-pack-sheet-' + pathStr + '-' + idx + '" class="range-pack-sheet" value="">'
                    + '<div style="color:#94A3B8;">選套餐或手動輸入教材</div>';
            }
            const availStr = packRowAvailLabel(classId, blockCombo, row);
            const pct = packDisplayPercent(row.count, availStr);
            return '<div class="range-pack-row"' + drop
                + orderCell
                + '<div>' + sheetCell + '</div>'
                + '<select id="range-pack-rtype-' + pathStr + '-' + idx + '" class="form-control asg-field-input"'
                + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: true, clamp: true })">'
                + '<option value="page"' + (row.range_type === 'page' ? ' selected' : '') + '>頁碼</option>'
                + '<option value="qnum"' + (row.range_type === 'qnum' ? ' selected' : '') + '>題號</option>'
                + '</select>'
                + '<input id="range-pack-start-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + escapeHtml(row.start) + '"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })"'
                + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false, clamp: true })">'
                + '<input id="range-pack-end-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + escapeHtml(row.end) + '"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })"'
                + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false, clamp: true })">'
                + '<input id="range-pack-lpp-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + escapeHtml(packDefaultLpp(blockCombo, row)) + '" title="每頁行數"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })">'
                + '<input id="range-pack-diff-' + pathStr + '-' + idx + '" class="form-control asg-num" value="' + escapeHtml(row.difficulty || '') + '" placeholder="—" title="難度"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })">'
                + '<input id="range-pack-inc-' + pathStr + '-' + idx + '" class="form-control asg-num" value="' + escapeHtml(row.include_nums || '') + '" placeholder="—" title="必考題號"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })">'
                + '<input id="range-pack-exc-' + pathStr + '-' + idx + '" class="form-control asg-num" value="' + escapeHtml(row.exclude_nums || '') + '" placeholder="—" title="排除題號"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })">'
                + '<input id="range-pack-count-' + pathStr + '-' + idx + '" type="number" class="form-control asg-num" value="' + escapeHtml(row.count != null && row.count !== '' ? String(row.count) : '') + '" placeholder="—" title="題數"'
                + ' oninput="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })"'
                + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })"'
                + ' onkeydown="if(event.key===\'Enter\'){ event.preventDefault(); this.blur(); }">'
                + '<div id="range-pack-avail-' + pathStr + '-' + idx + '" class="range-pack-avail">' + escapeHtml(availStr) + '</div>'
                + '<div id="range-pack-pct-' + pathStr + '-' + idx + '" class="range-pack-pct">' + escapeHtml(pct) + '</div>'
                + '<div>' + delSheet + '</div>'
                + '</div>';
        }).join('');
        const html = rows.length
            ? ('<div class="range-pack-table"><div class="range-pack-table-inner">'
                + '<div class="range-pack-head"><div></div><div>' + (isManual ? '教材' : '區段') + '</div><div>基準</div><div>起</div><div>迄</div><div>每頁行數</div><div>難度</div><div>必考#</div><div>排除#</div><div>題數</div><div>可用題</div><div>顯示%</div><div>刪</div></div>'
                + sheetRows
                + '</div></div>')
            : '';
        return { html: html, rowCount: rows.length, showsExamStats: true };
    }

    function packBlocksFromRows(rows) {
        const blocks = [];
        (rows || []).forEach(function (r) {
            const id = String((r && r.combo_id) || '').trim();
            const last = blocks[blocks.length - 1];
            if (!last || String(last.combo_id || '') !== id) {
                blocks.push({
                    combo_id: id,
                    combo_label: String((r && r.combo_label) || '').trim(),
                    rows: [r]
                });
                return;
            }
            last.rows.push(r);
        });
        return blocks.length ? blocks : [{ combo_id: '', combo_label: '', rows: [Object.assign({ combo_id: '', combo_label: '', meta_file: '', range_type: 'page', start: '', end: '' }, copyPackExamFieldsForRender(null))] }];
    }

    function audioPdfStatusHtml(pathStr, audioNode) {
        const FT = window.FeatureTimeline;
        const parent = (FT && typeof FT.parentRangeGroupOf === 'function') ? FT.parentRangeGroupOf(pathStr) : null;
        const host = parent || audioNode;
        const raw = (host && host.raw_data) || {};
        const rows = Array.isArray(raw.pack_rows) && raw.pack_rows.length
            ? raw.pack_rows
            : [{ combo_id: raw.pack_combo_id, meta_file: raw.pack_meta_file, range_type: raw.pack_range_type, start: raw.pack_start, end: raw.pack_end }];
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const fcmc = window.FeatureClassMaterialCombinations;
        const Map = window.MaterialPdfPageMap;
        const bits = [];
        let anyCombo = false;
        rows.forEach(function (r) {
            const comboId = String((r && r.combo_id) || '').trim();
            if (!comboId) return;
            anyCombo = true;
            const combo = (fcmc && typeof fcmc.getAssignedComboById === 'function')
                ? fcmc.getAssignedComboById(classId, comboId)
                : null;
            const sheet = String((r && r.meta_file) || '').replace(/\.meta\.json$/i, '');
            if (!combo) {
                bits.push((sheet || '套餐') + '：找不到這份套餐');
                return;
            }
            const fileId = combo.studentPdfFileId || '';
            const fileName = combo.studentPdfFileName || '';
            if (!fileId) {
                bits.push((sheet || combo.label || '套餐') + '：教材範本管理還沒上傳 PDF');
                return;
            }
            const resolved = (Map && typeof Map.resolvePages === 'function')
                ? Map.resolvePages(combo.studentPdfPageMap, r.range_type, r.start, r.end)
                : { pages: [], missing: true };
            if (resolved.missing || !resolved.pages.length) {
                bits.push((sheet || combo.label || '套餐') + '（' + fileName + '）：對照表對不到這段範圍');
                return;
            }
            bits.push((sheet || combo.label || '套餐') + '（' + fileName + '）檔案頁 ' + resolved.pages.join('、'));
        });
        if (!anyCombo) return '請先在上面的組合選套餐。PDF 在教材範本管理上傳與對照，這裡不另傳。';
        return bits.join('；');
    }

    function renderRangePackHtml(pathStr, groupNode) {
        const raw = (groupNode && groupNode.raw_data) || {};
        const bState = window.BuilderStore && window.BuilderStore.getState && window.BuilderStore.getState();
        const classId = (bState && bState.classId) || '';
        const fcmc = window.FeatureClassMaterialCombinations;
        const cacheReady = !!(fcmc && (
            (typeof fcmc.isHomeworkCombosReady === 'function' && fcmc.isHomeworkCombosReady(classId))
            || (typeof fcmc.isComboStatsReady === 'function' && fcmc.isComboStatsReady(classId) && typeof fcmc.isHomeworkCombosReady !== 'function')
        ));
        // 【死命註解｜永遠禁止刪除】套餐下拉清單只准這一個開口：該班有勾的套餐。
        if (fcmc && typeof fcmc.listAssignedCombosForHomework === 'function') {
            fcmc.listAssignedCombosForHomework(classId);
        }
        const combos = cacheReady && fcmc && typeof fcmc.listAssignedCombosForHomework === 'function'
            ? fcmc.listAssignedCombosForHomework(classId)
            : [];
        const rows = normalizePackRowsForRender(raw);
        const blocks = packBlocksFromRows(rows);
        let globalIdx = 0;
        let hideComboExamStats = true;

        const blockHtml = blocks.map(function (block, bi) {
            let blockCombo = null;
            if (block.combo_id && fcmc && typeof fcmc.getAssignedComboById === 'function') {
                blockCombo = fcmc.getAssignedComboById(classId, block.combo_id);
            }
            if (block.combo_id !== '__manual__' && blockCombo
                && window.FeatureTimeline && typeof window.FeatureTimeline.expandPackRowsForCombo === 'function') {
                block.rows = window.FeatureTimeline.expandPackRowsForCombo(classId, blockCombo, block.rows);
            }
            const comboOpts = renderPackComboOptions(combos, block.combo_id, block.combo_label, cacheReady);
            const delBlock = blocks.length > 1
                ? ('<button type="button" class="btn" style="padding:4px 8px; background:#FEF2F2; color:#B91C1C; border:1px solid #FCA5A5; font-weight:800;" title="刪這份套餐"'
                    + ' onclick="window.FeatureTimeline && window.FeatureTimeline.removeRangePackCombo && window.FeatureTimeline.removeRangePackCombo(\'' + pathStr + '\', ' + bi + ')">刪套餐</button>')
                : '';
            const isManual = String(block.combo_id) === '__manual__';
            const tableResult = (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.renderPackTableHtml === 'function')
                ? window.MaterialComboStrategies.renderPackTableHtml({
                    pathStr: pathStr,
                    block: block,
                    blockCombo: blockCombo,
                    comboId: block.combo_id,
                    isManual: isManual,
                    classId: classId,
                    startIdx: globalIdx,
                    packUi: rangePackUi()
                })
                : renderSheetPackTableHtml({
                    pathStr: pathStr,
                    block: block,
                    blockCombo: blockCombo,
                    comboId: block.combo_id,
                    isManual: isManual,
                    classId: classId,
                    startIdx: globalIdx,
                    packUi: rangePackUi()
                });
            globalIdx += Number(tableResult && tableResult.rowCount) || 0;
            if (tableResult && tableResult.showsExamStats) hideComboExamStats = false;
            const sheetTable = (tableResult && tableResult.html) || '';
            const addSheetBtn = (function () {
                if (block.combo_id) {
                    return '<button type="button" class="btn" style="padding:4px 10px; background:#ECFDF5; color:#047857; border:1px solid #6EE7B7; font-weight:800;"'
                        + ' onclick="window.FeatureTimeline && window.FeatureTimeline.addRangePackSheet && window.FeatureTimeline.addRangePackSheet(\'' + pathStr + '\', ' + bi + ')">＋ 增加區段</button>';
                }
                return '<button type="button" class="btn" disabled style="padding:4px 10px; background:#E2E8F0; color:#64748B; border:1px solid #CBD5E1; font-weight:800; cursor:not-allowed;" title="請先選套餐或手動輸入教材">＋ 增加區段</button>';
            }());
            const shuffleChecked = packShuffleOnForRender((block.rows && block.rows[0]) || null);
            const shuffleAndStats = (tableResult && tableResult.showsExamStats) ? (
                '<div style="display:flex; align-items:center; gap:12px; margin-left:auto;">'
                + '<label style="font-weight:800; color:#334155; white-space:nowrap;" title="打勾＝這份套餐抽出的題目打亂順序。沒勾＝照上面列的順序。">'
                + '<input id="range-pack-shuffle-' + pathStr + '-' + bi + '" class="range-pack-shuffle" type="checkbox"'
                + (shuffleChecked ? ' checked' : '')
                + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: false })"> 亂序</label>'
                + packStatsLineHtml({ selected: packSelectedCountSum(block.rows) }, '', pathStr, 'section')
                + '</div>'
            ) : '';
            return '<div class="range-pack-block" data-block-idx="' + bi + '" style="margin-top:10px; padding:10px; border:1px dashed #93C5FD; border-radius:8px; background:#F8FAFC;">'
                + '<div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">'
                + '<div style="flex:1 1 240px; min-width:200px;">'
                + '<label class="asg-field-label">套餐</label>'
                + '<select id="range-pack-combo-' + pathStr + '-' + bi + '" class="form-control range-pack-combo"'
                + ' onchange="window.FeatureTimeline && window.FeatureTimeline.onRangePackComboChange && window.FeatureTimeline.onRangePackComboChange(\'' + pathStr + '\', ' + bi + ')">'
                + comboOpts + '</select></div>'
                + delBlock
                + '</div>'
                + sheetTable
                + '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; flex-wrap:wrap;">'
                + addSheetBtn
                + shuffleAndStats
                + '</div>'
                + '</div>';
        }).join('');

        const comboSelected = packSelectedCountSum(rows);

        return `
            <div class="range-pack-panel asg-unify" data-range-pack="${pathStr}" style="background:white; border:1px solid #93C5FD; border-radius:8px; padding:10px 12px; margin:0 0 12px 0;">
                <div style="font-weight:900; color:#1E3A8A; margin-bottom:8px;">組合（套餐、範圍、選題）</div>
                ${blockHtml}
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; flex-wrap:wrap;">
                    <div>
                    <button type="button" class="btn" style="padding:4px 10px; background:#EFF6FF; color:#1D4ED8; border:1px solid #93C5FD; font-weight:800;"
                        onclick="window.FeatureTimeline && window.FeatureTimeline.addRangePackCombo && window.FeatureTimeline.addRangePackCombo('${pathStr}')">＋ 增加套餐</button>
                    <span style="margin-left:8px; color:#64748B; font-weight:700;">第一層選套餐，或手動輸入教材。同一套餐要另一段範圍就按「增加區段」。</span>
                    </div>
                    ${hideComboExamStats ? '' : packStatsLineHtml({ selected: comboSelected }, 'range-pack-stats--combo', pathStr, 'combo')}
                </div>
            </div>
        `;
    }

    function getTimelineStyleBlock() {
        return `
            <style>
                .timeline-node, .timeline-node * { box-sizing: border-box !important; max-width: 100%; word-break: break-word; }
                .timeline-node { overflow: visible !important; }
                div.timeline-node::before, div.timeline-node::after { display: none !important; content: none !important; }
                .tl-rail-date {
                    position: absolute; left: -72px; top: 4px; width: 46px; z-index: 2;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    padding: 0; border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF;
                    box-shadow: 0 1px 2px rgba(15,23,42,0.06); line-height: 1.1; font-family: inherit;
                    color: #334155; overflow: hidden;
                }
                .tl-rail-date--range { width: 54px; left: -76px; }
                .tl-rail-date__month {
                    width: 100%; background: #F1F5F9; color: #64748B; font-size: 0.65rem; font-weight: 800;
                    letter-spacing: 0.02em; padding: 3px 0; text-align: center;
                }
                .tl-rail-date__day {
                    font-size: 1.05rem; font-weight: 900; padding: 5px 0 6px; text-align: center;
                }
                .tl-rail-date__day--range {
                    font-size: 0.72rem; font-weight: 900; padding: 5px 2px 6px; letter-spacing: -0.02em;
                    white-space: nowrap;
                }
                .tl-rail-date--current { border-color: #6EE7B7; }
                .tl-rail-date--current .tl-rail-date__month { background: #10B981; color: #FFFFFF; }
                .tl-rail-date--current .tl-rail-date__day { color: #065F46; }
                .tl-rail-date--deletable { cursor: pointer; }
                .asg-unify, .asg-unify * { font-size: 16px !important; line-height: 1.4; }
                .asg-field-label { display:block; font-weight:800; color:#334155; margin-bottom:4px; }
                .asg-unify select,
                .asg-unify input.form-control,
                .asg-unify input.asg-num,
                .asg-unify input[type="number"],
                .asg-unify input[type="text"] {
                    height: 36px !important;
                    min-height: 36px !important;
                    max-height: 36px;
                    padding: 4px 8px !important;
                    box-sizing: border-box !important;
                    font-size: 16px !important;
                    line-height: 1.2;
                }
                .asg-unify textarea,
                .asg-unify textarea.form-control {
                    height: auto !important;
                    max-height: none !important;
                    min-height: 88px;
                    font-size: 16px !important;
                }
                .asg-unify .btn,
                .asg-unify .btn-action {
                    height: 36px;
                    min-height: 36px;
                    padding: 4px 10px;
                    font-size: 16px !important;
                    line-height: 1.2;
                    box-sizing: border-box;
                }
                .asg-unify .range-pack-move-btn.btn {
                    height: 16px !important;
                    min-height: 16px !important;
                    max-height: 16px;
                    padding: 0 !important;
                    font-size: 10px !important;
                    line-height: 1;
                }
                .asg-unify .range-pack-combo { width: 100%; }
                .asg-unify .range-pack-row select,
                .asg-unify .exam-inline-row select { width: 100%; }
                .asg-num { width:88px; }
                .asg-unify .range-pack-row .asg-num,
                .asg-unify .exam-inline-row .asg-num { width:100%; min-width:0; }
                .asg-unify input[type="number"]::-webkit-inner-spin-button,
                .asg-unify input[type="number"]::-webkit-outer-spin-button {
                    opacity: 1;
                    display: block;
                    height: 24px;
                    margin-left: 2px;
                }
                .range-pack-panel { max-width: 100%; }
                .exam-seg-table, .range-pack-table { margin-top:8px; overflow-x:auto; width:100%; max-width:100% !important; }
                .range-pack-table-inner { width:100%; min-width:0; max-width:100% !important; }
                .timeline-node .range-pack-table-inner { max-width:100% !important; }
                .exam-seg-head, .exam-inline-row {
                    display:grid;
                    width:100%;
                    box-sizing:border-box;
                    gap:6px;
                    align-items:center;
                    grid-template-columns: repeat(11, minmax(0, 1fr)) 36px;
                }
                .range-pack-head, .range-pack-row {
                    display:grid;
                    width:100%;
                    box-sizing:border-box;
                    gap:6px;
                    align-items:center;
                    grid-template-columns: 28px repeat(11, minmax(0, 1fr)) 36px;
                }
                .range-pack-head--book, .range-pack-row--book {
                    grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) 36px;
                }
                .range-pack-head--pdf, .range-pack-row--pdf {
                    grid-template-columns: 28px minmax(0, 1fr) 36px;
                }
                .range-pack-row--drag-over { outline: 2px dashed #3B82F6; outline-offset: 1px; }
                .exam-seg-head > div, .range-pack-head > div {
                    min-width:0;
                    white-space:normal;
                    line-height:1.2;
                    overflow-wrap:break-word;
                }
                .range-pack-avail { color:#0F766E; font-weight:800; }
                .range-pack-pct { color:#64748B; font-weight:800; }
                .exam-seg-head, .range-pack-head { font-weight:800; color:#334155; margin-bottom:2px; }
                .exam-inline-row, .range-pack-row { margin-top:4px; }
                .tl-rail-date--deletable:hover { border-color: #FCA5A5; background: #FEF2F2; }
                .tl-rail-date--deletable:hover .tl-rail-date__month { background: #EF4444; color: #FFFFFF; }
                .tl-rail-date--deletable:hover .tl-rail-date__day { color: #B91C1C; }
                .tl-rail-add-row { position: relative; height: 0; margin: 0; }
                .tl-rail-add-btn {
                    position: absolute; left: -49px; top: 0; transform: translate(-50%, -50%);
                    width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid #CBD5E1;
                    background: #FFFFFF; color: #64748B; font-size: 0.85rem; font-weight: 900; line-height: 1;
                    cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 0 0 2px #F8FAFC; z-index: 2;
                }
                .tl-rail-add-btn:hover { border-color: #3B82F6; color: #1D4ED8; background: #EFF6FF; }
                .rte-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; padding: 6px 12px; background: #F1F5F9; border-radius: 8px; border: 1px solid #E2E8F0; }
                .rte-btn { background: white; font-weight: 900; border: 1px solid #CBD5E1; padding: 2px 8px; border-radius: 4px; cursor: pointer; color: #334155; }
                .rte-btn:hover { background: #E2E8F0; }
                .drag-over { border: 2px dashed #10B981 !important; opacity: 0.7; }
                [contenteditable]:empty:before { content: attr(data-placeholder); color: var(--placeholder, #94A3B8); pointer-events: none; display: block; }
                @keyframes pulse-green { 0% {box-shadow: 0 0 0 0 rgba(16,185,129,0.4);} 70% {box-shadow: 0 0 0 8px rgba(16,185,129,0);} 100% {box-shadow: 0 0 0 0 rgba(16,185,129,0);} }
                .rt-normalize, .rt-normalize * { font-size: inherit !important; font-family: inherit !important; }
                details > summary::-webkit-details-marker { display: none; }
            </style>
        `;
    }

    /** 進度軸左側日期小卡（YYYY-MM-DD → 月／日） */
    function formatRailDateParts(isoDate) {
        const parts = String(isoDate || '').split('-');
        if (parts.length < 3) {
            return { month: '', day: String(isoDate || ''), isRange: false };
        }
        const monthNum = parseInt(parts[1], 10);
        const dayNum = parseInt(parts[2], 10);
        return {
            month: (Number.isFinite(monthNum) ? monthNum : parts[1]) + '月',
            day: Number.isFinite(dayNum) ? String(dayNum) : parts[2],
            isRange: false
        };
    }

    /** 週模式：顯示該週上課日起迄（同月 17–19；跨月 7/17–8/2） */
    function formatRailWeekParts(dates) {
        const list = (Array.isArray(dates) ? dates : []).filter(Boolean);
        if (list.length === 0) return { month: '', day: '', isRange: false };
        if (list.length === 1) return formatRailDateParts(list[0]);

        const firstParts = String(list[0]).split('-');
        const lastParts = String(list[list.length - 1]).split('-');
        const m1 = parseInt(firstParts[1], 10);
        const d1 = parseInt(firstParts[2], 10);
        const m2 = parseInt(lastParts[1], 10);
        const d2 = parseInt(lastParts[2], 10);
        const sameMonth = Number.isFinite(m1) && m1 === m2;

        if (sameMonth) {
            return {
                month: m1 + '月',
                day: d1 + '–' + d2,
                isRange: true
            };
        }
        return {
            month: '週程',
            day: m1 + '/' + d1 + '–' + m2 + '/' + d2,
            isRange: true
        };
    }

    function getLevelStyle(depth) {
        const styles = [
            { border: '#D8B4FE', bg: '#F3E8FF', text: '#581C87' }, 
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, 
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, 
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }, 
            { border: '#EF4444', bg: '#FEF2F2', text: '#7F1D1D' }  
        ];
        return styles[Math.min(depth, 4)];
    }

    function renderReadOnlyTaskItem(t, effectiveBlockDueDate, effectiveBlockLatePolicy, depth, isLastLeaf, effectiveBlockOpenAt) {
        let iconStr = window.TaskScriptResolver
            ? window.TaskScriptResolver.getTaskTypeIcon(t.type)
            : (t.type === 'check' ? '📌'
                : (t.type === 'link' ? '🔗'
                : (t.type === 'audio_record' ? '🎙️'
                : (t.type === 'exam' ? '📝'
                : (t.type === 'pdf_exam' ? '📄' : '📁')))));
        let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.1rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
        
        let extraTag = '';
        if (t.type === 'drive') extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(專屬資料夾)</span>';
        else if (t.type === 'audio_record') {
            const useAi = t.raw_data?.use_ai_grading !== false;
            const useGrammar = t.raw_data?.use_ai_grammar === true; 
            const aiBadge = useAi ? `<span style="font-size:0.8rem; background:#DBEAFE; color:#1D4ED8; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">✨ 發音</span>` : ``;
            const grammarBadge = useGrammar ? `<span style="font-size:0.8rem; background:#FEF3C7; color:#D97706; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">📝 文法</span>` : '';
            extraTag = `<span style="font-size:0.9rem; color:#EF4444; margin-left:8px; font-weight:bold;">(語音錄製)</span>${aiBadge}${grammarBadge}`;
        } else if (t.type === 'exam') {
            const paperN = (t.raw_data && t.raw_data.quiz_paper && Array.isArray(t.raw_data.quiz_paper.items))
                ? t.raw_data.quiz_paper.items.length : 0;
            const paperStale = !!(t.raw_data && (t.raw_data.last_generate_error
                || (paperN && window.FeatureExamJob && typeof window.FeatureExamJob.needsExamRegeneration === 'function'
                    && window.FeatureExamJob.needsExamRegeneration(t))));
            extraTag = '<span style="font-size:0.9rem; color:#0F766E; margin-left:8px; font-weight:bold;">(考試出題單)</span>'
                + (paperN
                    ? (paperStale
                        ? `<span style="font-size:0.8rem; background:#FFFBEB; color:#92400E; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">舊卷 ${paperN} 題</span>`
                        : `<span style="font-size:0.8rem; background:#ECFDF5; color:#047857; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">線上卷 ${paperN} 題</span>`)
                    : `<span style="font-size:0.8rem; background:#FFFBEB; color:#92400E; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">尚未產生線上卷</span>`);
        } else if (t.type === 'pdf_exam') {
            const pdfJob = (t.raw_data && t.raw_data.pdf_exam_job) || null;
            const bankN = (pdfJob && Array.isArray(pdfJob.parsed_bank)) ? pdfJob.parsed_bank.length : 0;
            const hasPdf = !!(pdfJob && pdfJob.pdf_file_id);
            // 答案改過還沒重新批改：即使收合看列表也要看得到，不用展開才發現分數是舊的
            const regradeBadge = (pdfJob && pdfJob.needs_regrade)
                ? `<span style="font-size:0.8rem; background:#FEF2F2; color:#B91C1C; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">⚠ 答案有更新，待重新批改</span>`
                : '';
            extraTag = '<span style="font-size:0.9rem; color:#0369A1; margin-left:8px; font-weight:bold;">(PDF 考卷)</span>'
                + (hasPdf && bankN
                    ? `<span style="font-size:0.8rem; background:#E0F2FE; color:#0369A1; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">已確認答案 ${bankN} 題</span>`
                    : `<span style="font-size:0.8rem; background:#FFFBEB; color:#92400E; padding:2px 6px; border-radius:4px; margin-left:4px; font-weight:bold;">尚未設定完成</span>`)
                + regradeBadge;
        }
        else extraTag = '<span style="font-size:0.9rem; color:#94A3B8; margin-left:8px;">(自行打勾)</span>';

        let taskTitleDisplay = '';
        let linkContent = '';

        if (t.type === 'link') {
            let actualUrlText = (t.url_text || '').trim();
            let actualTitle = (t.title || '').trim();

            if (actualUrlText !== '') {
                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${actualTitle || '未命名任務'}</span>`;
                linkContent = t.url ? `<a href="${t.url}" target="_blank" class="rt-normalize" style="margin-left:10px; font-size:1rem; color:var(--primary); text-decoration:underline; font-weight:800;">${actualUrlText}</a>` : `<span class="rt-normalize" style="margin-left:10px; font-size:1rem; color:#94A3B8;">(未設定網址)</span>`;
            } else {
                let fallbackText = actualTitle || '未命名連結';
                if (t.url) {
                    taskTitleDisplay = `<a href="${t.url}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;">${fallbackText}</a>`;
                } else {
                    taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${fallbackText} (未設定網址)</span>`;
                }
            }
        } else {
            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${t.title || '未命名任務'}</span>`;
        }

        let cleanTaskDesc = t.description ? t.description.replace(/<[^>]*>?/gm, '').trim() : '';
        let taskDescHtml = cleanTaskDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px;">${t.description}</div>` : '';
        
        let showTaskDue = t.due_date && t.due_date !== effectiveBlockDueDate;
        let dueBadge = showTaskDue ? `<span style="font-size:0.9rem; color:#64748B; margin-left:8px; font-weight:bold;">⏰ 期限: ${stampLabel(t.due_date)}</span>` : '';
        let showTaskOpen = t.open_at && t.open_at !== effectiveBlockOpenAt;
        let openBadge = showTaskOpen ? `<span style="font-size:0.9rem; color:#0369A1; margin-left:8px; font-weight:bold;">開放: ${stampLabel(t.open_at)}</span>` : '';
        
        let taskLateMode = t.late_mode || 'infinite';
        let taskPenalty = t.penalty_percentage || 0;
        let taskGrace = t.grace_period_hours || 0;
        let showLateBadge = true;

        if (effectiveBlockLatePolicy) {
            if (taskLateMode === effectiveBlockLatePolicy.mode && 
                taskPenalty === effectiveBlockLatePolicy.penalty && 
                taskGrace === (effectiveBlockLatePolicy.grace || 0)) {
                showLateBadge = false;
            }
        }

        let taskLateBadge = '';
        if (showLateBadge) {
            if (taskLateMode === 'no_late') taskLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
            else if (taskLateMode === 'custom') taskLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${taskGrace}h (-${taskPenalty}%)</span>`;
            else taskLateBadge = taskPenalty > 0 ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${taskPenalty}%</span>` : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 接受遲交</span>`;
        }
        
        let borderBottom = isLastLeaf ? 'none' : '1px solid rgba(0,0,0,0.08)';

        return `
            <div style="padding: 10px 5px; background: transparent; border-bottom: ${borderBottom}; transition: 0.2s;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; line-height: 1.2;">
                    <input type="checkbox" disabled style="transform: scale(1.3); margin-right: 8px; cursor: not-allowed; opacity: 0.5;" title="老師唯讀端核取方塊">
                    ${iconHtml}${taskTitleDisplay}${linkContent}
                    ${extraTag} ${dueBadge} ${openBadge} ${taskLateBadge}
                </div>
                ${taskDescHtml}
            </div>
        `;
    }

    function renderReadOnlyTree(tasks, effectiveBlockDueDate, effectiveBlockLatePolicy, depth = 0, effectiveBlockOpenAt) {
        if (!tasks || tasks.length === 0) return '';
        let html = '';
        tasks.forEach((t, idx) => {
            const isLastLeaf = idx === tasks.length - 1 || tasks[idx + 1].type === 'group';
            const lvl = getLevelStyle(depth);

            if (t.type === 'group') {
                let groupDueDate = t.due_date || effectiveBlockDueDate;
                let groupOpenAt = t.open_at || effectiveBlockOpenAt;
                let groupPolicy = {
                    mode: t.late_mode || effectiveBlockLatePolicy.mode,
                    penalty: t.penalty_percentage !== undefined ? t.penalty_percentage : effectiveBlockLatePolicy.penalty,
                    grace: t.grace_period_hours !== undefined ? t.grace_period_hours : (effectiveBlockLatePolicy.grace || 0)
                };

                let showGroupLateBadge = true;
                if (groupPolicy.mode === effectiveBlockLatePolicy.mode && 
                    groupPolicy.penalty === effectiveBlockLatePolicy.penalty && 
                    groupPolicy.grace === effectiveBlockLatePolicy.grace) {
                    showGroupLateBadge = false;
                }

                let gLateBadge = '';
                if (showGroupLateBadge) {
                    if (groupPolicy.mode === 'no_late') gLateBadge = `<span style="font-size:0.85rem; color:#EF4444; margin-left:8px; font-weight:bold;">🚫 無遲交</span>`;
                    else if (groupPolicy.mode === 'custom') gLateBadge = `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">⏳ 寬限 ${groupPolicy.grace}h (-${groupPolicy.penalty}%)</span>`;
                    else gLateBadge = groupPolicy.penalty > 0 ? `<span style="font-size:0.85rem; color:#F59E0B; margin-left:8px; font-weight:bold;">♾️ 遲交扣 ${groupPolicy.penalty}%</span>` : `<span style="font-size:0.85rem; color:#10B981; margin-left:8px; font-weight:bold;">♾️ 接受遲交</span>`;
                }
                let gDueBadge = (t.due_date && t.due_date !== effectiveBlockDueDate) ? `<span style="font-size:0.9rem; color:#64748B; margin-left:8px; font-weight:bold;">⏰ 期限: ${stampLabel(t.due_date)}</span>` : '';
                let gOpenBadge = (t.open_at && t.open_at !== effectiveBlockOpenAt) ? `<span style="font-size:0.9rem; color:#0369A1; margin-left:8px; font-weight:bold;">開放: ${stampLabel(t.open_at)}</span>` : '';

                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';
                const isRangeGroup = !!(t.raw_data && t.raw_data.group_role === 'range');
                let groupTitleText = t.title || '';
                if (isRangeGroup && !String(groupTitleText).replace(/<[^>]*>?/gm, '').trim()
                    && window.BuilderStore && typeof window.BuilderStore.deriveRangeTitleFromGroup === 'function') {
                    groupTitleText = window.BuilderStore.deriveRangeTitleFromGroup(t) || '';
                }
                const groupIcon = isRangeGroup ? '📐' : '🗂️';
                const rangeChip = isRangeGroup
                    ? '<span style="font-size:0.72rem; background:#DBEAFE; color:#1D4ED8; padding:2px 7px; border-radius:999px; font-weight:800;">範圍</span>'
                    : '';

                html += `
                    <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background: ${lvl.bg}; border: 1px solid ${lvl.border}; border-radius: 8px;">
                        <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; margin-bottom: ${t.subTasks && t.subTasks.length > 0 ? '5px' : '0'}; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-size:1.2rem;">${groupIcon}</span> <span class="rt-normalize">${groupTitleText || (isRangeGroup ? '未命名範圍' : '未命名群組作業')}</span>
                            ${rangeChip}
                            ${gDueBadge} ${gOpenBadge} ${gLateBadge}
                        </div>
                `;
                
                if (t.subTasks && t.subTasks.length > 0) {
                    html += `<div style="display:flex; flex-direction:column;">`;
                    html += renderReadOnlyTree(t.subTasks, groupDueDate, groupPolicy, depth + 1, groupOpenAt);
                    html += `</div>`;
                } else {
                    html += `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top: 5px;">(此群組作業尚無內容)</div>`;
                }
                html += `</div>`;
            } else {
                html += renderReadOnlyTaskItem(t, effectiveBlockDueDate, effectiveBlockLatePolicy, depth, isLastLeaf, effectiveBlockOpenAt);
            }
        });
        return html;
    }

    /**
     * C. 自行貼上：單一視窗卡片。win = { label, script, student }。
     * total<=1 時不顯示刪除鈕（至少留一個視窗），標籤欄位在只有 1 個視窗時仍可填，
     * 但存檔時只有「視窗數 >1 或標籤非空」才會真的寫入 【label】 前綴，避免污染最單純的舊格式。
     */
    function renderPasteWindowRowHtml(pathStr, winIdx, win, total) {
        const safeLabel = String((win && win.label) || '').replace(/"/g, '&quot;');
        const safeWinScript = String((win && win.script) || '').replace(/</g, '&lt;');
        const safeWinStudent = String((win && win.student) || '').replace(/</g, '&lt;');
        const removeBtn = total > 1
            ? `<button type="button" class="btn" style="padding:6px 8px; background:white; color:#B91C1C; border:1px solid #FCA5A5; flex-shrink:0;" onclick="window.FeatureTimeline.removePasteWindowRow(this, '${pathStr}')" title="刪除此視窗">🗑</button>`
            : '';
        return `
            <div class="paste-window-row" data-idx="${winIdx}" style="display:flex; gap:8px; align-items:flex-start; background:white; border:1px solid #CBD5E1; border-radius:8px; padding:12px;">
                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:8px;">
                    <input type="text" class="form-control paste-window-label" style="padding:6px; font-size:0.85rem; font-weight:800; color:#7C3AED; max-width:260px;" placeholder="這段標籤（選填，如 Page 2／Ex.3）" value="${safeLabel}">
                    <div>
                        <div style="font-weight:900; color:#334155; margin-bottom:4px; font-size:0.85rem;">🎯 口說答案（AI 基準）</div>
                        <textarea class="form-control paste-window-script" style="width:100%; min-height:70px; padding:10px; font-size:0.9rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="貼上口說答案…">${safeWinScript}</textarea>
                    </div>
                    <div>
                        <div style="font-weight:900; color:#334155; margin-bottom:4px; font-size:0.85rem;">👀 書寫答案</div>
                        <textarea class="form-control paste-window-student" style="width:100%; min-height:70px; padding:10px; font-size:0.9rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="貼上書寫答案…">${safeWinStudent}</textarea>
                    </div>
                </div>
                ${removeBtn}
            </div>`;
    }

    function getArrowButtonsHtml(pathStr, idx, arrLength, depth, hasPrevSiblingGroup) {
        const canUp = idx > 0;
        const canDown = idx < arrLength - 1;
        const canLeft = depth > 0;
        const canRight = idx > 0 && hasPrevSiblingGroup;

        return `
            <div style="display:flex; gap:4px;">
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canUp ? 'white' : '#F1F5F9'}; cursor:${canUp ? 'pointer' : 'not-allowed'}; opacity:${canUp ? '1' : '0.4'}; border-radius:4px;" onclick="${canUp ? `window.FeatureTimeline.moveNodeUp('${pathStr}')` : ''}" ${canUp ? '' : 'disabled'} title="上移">⬆️</button>
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canDown ? 'white' : '#F1F5F9'}; cursor:${canDown ? 'pointer' : 'not-allowed'}; opacity:${canDown ? '1' : '0.4'}; border-radius:4px;" onclick="${canDown ? `window.FeatureTimeline.moveNodeDown('${pathStr}')` : ''}" ${canDown ? '' : 'disabled'} title="下移">⬇️</button>
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canLeft ? 'white' : '#F1F5F9'}; cursor:${canLeft ? 'pointer' : 'not-allowed'}; opacity:${canLeft ? '1' : '0.4'}; border-radius:4px;" onclick="${canLeft ? `window.FeatureTimeline.moveNodeLeft('${pathStr}')` : ''}" ${canLeft ? '' : 'disabled'} title="向左 (移出目前群組)">⬅️</button>
                <button type="button" class="btn-icon" style="padding:2px 6px; border:1px solid #CBD5E1; background:${canRight ? 'white' : '#F1F5F9'}; cursor:${canRight ? 'pointer' : 'not-allowed'}; opacity:${canRight ? '1' : '0.4'}; border-radius:4px;" onclick="${canRight ? `window.FeatureTimeline.moveNodeRight('${pathStr}')` : ''}" ${canRight ? '' : 'disabled'} title="向右 (歸入上方群組)">➡️</button>
            </div>
        `;
    }

    function renderBuilderTree(tasks, parentPathArray = [], classResOpts = '') {
        let treeHtml = tasks.map((t, idx) => {
            const pathArray = [...parentPathArray, idx];
            const pathStr = pathArray.join('-');
            const depth = pathArray.length - 1;
            const lvl = getLevelStyle(depth);
            
            const hasPrevSiblingGroup = idx > 0 && tasks[idx - 1].type === 'group';
            const arrowHtml = getArrowButtonsHtml(pathStr, idx, tasks.length, depth, hasPrevSiblingGroup);

            if (t.type === 'group') {
                const isRangeGroup = !!(t.raw_data && t.raw_data.group_role === 'range');
                let displayGroupTitle = t.title || '';
                // 💣 雷區：不能只看「標題目前是否為空」──自動填過一次存檔後 t.title 就非空了，
                // 之後老師怎麼改 base 範圍都不會再更新（見 title_auto_from_range 說明）。
                // 用獨立存檔的旗標判斷「這串文字是不是還在自動繼承中」，旗標為 true 就繼續追蹤最新範圍。
                const groupTitleWasAuto = !!(t.raw_data && t.raw_data.title_auto_from_range);
                let groupTitleAutoAttr = groupTitleWasAuto ? '1' : '0';
                if (isRangeGroup && (groupTitleWasAuto || !String(displayGroupTitle).replace(/<[^>]*>?/gm, '').trim())
                    && window.BuilderStore && typeof window.BuilderStore.deriveRangeTitleFromGroup === 'function') {
                    const derived = window.BuilderStore.deriveRangeTitleFromGroup(t);
                    if (derived) {
                        displayGroupTitle = derived;
                        t.title = derived; // 畫面與資料同步；老師仍可再改
                        groupTitleAutoAttr = '1';
                        if (t.raw_data) t.raw_data.title_auto_from_range = true;
                    }
                }
                let subTasksHtml = '';
                if (t.subTasks && t.subTasks.length > 0) {
                    subTasksHtml = `<div style="padding-left: 10px; display:flex; flex-direction:column;">` +
                                   renderBuilderTree(t.subTasks, pathArray, classResOpts) +
                                   `</div>`;
                } else {
                    subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此群組作業尚無內容)</div>`;
                }

                let addResourceHtml = classResOpts ? `
                    <select class="form-control" style="width:auto; padding:4px 10px; font-size:0.9rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink('${pathStr}', this.value); this.value=''; }">
                        <option value="" disabled selected>+ 📚 全域／班群／班級資源</option>
                        ${classResOpts}
                    </select>
                ` : `<button type="button" class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:0.9rem; padding:4px 10px;" title="請先至資源管理新增並派發資源">+ 📚 尚無任何可用資源</button>`;

                let gLateMode = t.late_mode || 'infinite';
                const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';
                const groupBg = isRangeGroup ? '#EFF6FF' : '#F3E8FF';
                const groupBorder = isRangeGroup ? '#93C5FD' : '#D8B4FE';
                const groupIcon = isRangeGroup ? '📐' : '🗂️';
                const titlePlaceholder = isRangeGroup
                    ? '✏️ 套餐名稱（選套餐後自動帶入）'
                    : '✏️ 群組作業標題';
                const titleColor = isRangeGroup ? '#1E3A8A' : '#581C87';
                const titleBorder = isRangeGroup ? '#93C5FD' : '#D8B4FE';
                const rangeBadge = isRangeGroup
                    ? '<span style="font-size:0.75rem; background:#DBEAFE; color:#1D4ED8; padding:3px 8px; border-radius:999px; font-weight:800; white-space:nowrap;">組合層</span>'
                    : '';
                const rangeHint = isRangeGroup
                    ? '<div style="font-size:0.8rem; color:#64748B; margin:-4px 0 10px 42px; line-height:1.4;">組標題＝套餐名（空白才帶入）。小標題＝表名＋範圍（起迄都填才進；表名＝活頁別名，永遠有）。沒選套餐或本班尚未指派套餐時，組標題維持空白。</div>'
                    : '';
                const rangePackHtml = isRangeGroup ? renderRangePackHtml(pathStr, t) : '';

                return `
                    <div id="group-block-${pathStr}"
                         style="${marginStyle} margin-bottom: 10px; background: ${groupBg}; padding: 12px; border-radius: 8px; border: 1px solid ${groupBorder}; transition: border 0.2s;">
                        
                        <div style="display:flex; gap:10px; align-items:center; margin-bottom: 10px; padding-bottom: 10px;">
                            <span style="font-size:1.4rem;">${groupIcon}</span>
                            <div id="node-title-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="${titlePlaceholder}"
                                 data-title-auto="${groupTitleAutoAttr}"
                                 oninput="window.FeatureTimeline && window.FeatureTimeline.onGroupTitleInput && window.FeatureTimeline.onGroupTitleInput('${pathStr}', this)"
                                 style="flex:1; font-size:1.1rem; font-weight:900; color:${titleColor}; padding:8px 12px; background:white; border:1px solid ${titleBorder}; border-radius:6px; outline:none;">${displayGroupTitle || ''}</div>
                            ${rangeBadge}
                            
                            <div style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                                ${arrowHtml}
                                <button type="button" class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeNode('${pathStr}')" title="刪除此群組">🗑️</button>
                            </div>
                        </div>
                        ${rangeHint}
                        ${rangePackHtml}

                        <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:center; background:white; padding:10px 12px; border-radius:6px; border: 1px solid #CBD5E1; margin-bottom:15px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};">群組期限：</label>
                                ${dateTimeFields(`node-due-${pathStr}`, `node-due-time-${pathStr}`, t.due_date)}
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};" title="留空則繼承區塊">開放日期：</label>
                                ${dateTimeFields(`node-open-${pathStr}`, `node-open-time-${pathStr}`, t.open_at)}
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:8px;">
                                <label style="font-weight:800; font-size:0.9rem; color:${lvl.text};">遲交規則：</label>
                                <select id="node-late-mode-${pathStr}" class="form-control" style="padding:4px 8px; font-size:0.9rem; width:auto;" onchange="
                                    const m = this.value;
                                    document.getElementById('node-late-custom-${pathStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                    document.getElementById('node-grace-wrapper-${pathStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                                ">
                                    <option value="no_late" ${gLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                    <option value="infinite" ${gLateMode === 'infinite' ? 'selected' : ''}>♾️ 接受遲交</option>
                                    <option value="custom" ${gLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                </select>
                            </div>

                            <div id="node-late-custom-${pathStr}" style="display:${(gLateMode === 'infinite' || gLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#F8FAFC; padding:4px 10px; border-radius:6px; border: 1px solid #E2E8F0;">
                                <div id="node-grace-wrapper-${pathStr}" style="display:${gLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:${lvl.text};">寬限(小時):</label>
                                    <input type="number" id="node-grace-${pathStr}" class="form-control" style="padding:4px; width:60px;" value="${t.grace_period_hours || 0}" min="0">
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.85rem; font-weight:bold; color:${lvl.text};">扣分(%):</label>
                                    <input type="number" id="node-penalty-${pathStr}" class="form-control" style="padding:4px; width:60px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                </div>
                            </div>
                        </div>
                        
                        <div style="padding-left: 10px;">
                            ${subTasksHtml}
                            <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top: 15px; margin-left: 10px;">
                                <span style="font-size:0.85rem; color:${lvl.text}; font-weight:bold; margin-right:5px; opacity:0.8;">子層作業新增：</span>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'check')">+ 📌 一般</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #64748B; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'link')">+ 🔗 連結</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #EF4444; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'audio_record')">+ 🎙️ 錄音</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #0F766E; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'exam')">+ 📝 考試</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #0369A1; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'pdf_exam')">+ 📄 PDF 考試</button>
                                
                                <div style="display:inline-flex; align-items:center; gap:4px;">
                                    <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #10B981; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'drive')">+ 📁 Drive</button>
                                </div>

                                <div style="width: 1px; height: 20px; background: #CBD5E1; margin: 0 5px;"></div>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #2563EB; color: white;" onclick="window.FeatureTimeline.addRangeBundle('${pathStr}')" title="建立組合作業：同一範圍，底下可再加類型">+ 📐 組合(錄音＋考試＋)</button>
                                <button type="button" class="btn btn-action" style="font-size:0.9rem; padding:4px 10px; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addNode('${pathStr}', 'group')">+ 🗂️ 群組作業</button>
                                <div style="width: 1px; height: 20px; background: #CBD5E1; margin: 0 5px;"></div>
                                ${addResourceHtml}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                let typeSelectorHtml = `
                    <select class="form-control" style="width:auto; padding:2px 4px; font-size:1rem; border:1px solid #CBD5E1; border-radius:4px; background:#F8FAFC; cursor:pointer; color:#334155; font-weight:bold; outline:none;" onchange="window.FeatureTimeline.changeNodeType('${pathStr}', this.value)">
                        <option value="check" ${t.type === 'check' ? 'selected' : ''}>📌 一般</option>
                        <option value="link" ${t.type === 'link' ? 'selected' : ''}>🔗 連結</option>
                        <option value="drive" ${t.type === 'drive' ? 'selected' : ''}>📁 Drive</option>
                        <option value="audio_record" ${t.type === 'audio_record' ? 'selected' : ''}>🎙️ 錄音</option>
                        <option value="exam" ${t.type === 'exam' ? 'selected' : ''}>📝 考試</option>
                        <option value="pdf_exam" ${t.type === 'pdf_exam' ? 'selected' : ''}>📄 PDF 考試</option>
                    </select>
                `;

                let urlInputHtml = '';
                if (t.type === 'link') {
                    let sameBtn = '';
                    if (pathArray[pathArray.length-1] > 0) {
                        const parentArr = window.FeatureTimeline.getTaskParentArray(pathArray);
                        if (parentArr[pathArray[pathArray.length-1]-1].type === 'link') {
                            sameBtn = `<button type="button" class="btn-icon" style="font-size:0.9rem; background:#E2E8F0; padding:6px; margin-left:5px;" onclick="window.FeatureTimeline.copyPrevNodeUrl('${pathStr}')">👇 同上 URL</button>`;
                        }
                    }

                    let resOptsHtml = '';
                    if (classResOpts) {
                        resOptsHtml = `<select class="form-control" style="width:auto; padding:6px; font-size:1rem; flex-shrink:0;" onchange="window.FeatureTimeline.applyResourceUrl('${pathStr}', this.value);">
                            <option value="" disabled selected>📚 手動套用資源庫</option>${classResOpts}
                        </select>`;
                    }

                    urlInputHtml = `
                        <div style="display:flex; gap:5px; margin-top:8px; width:100%; flex-wrap:wrap;">
                            <input type="text" id="node-url-text-${pathStr}" class="form-control" placeholder="🔗 顯示文字 (留空則標題變連結)" value="${t.url_text || ''}" style="flex:1; min-width:120px; padding:8px;">
                            <input type="url" id="node-url-${pathStr}" class="form-control" placeholder="🔗 https://..." value="${t.url || ''}" style="flex:2; min-width:180px; padding:8px;">
                            ${resOptsHtml}
                            ${sameBtn}
                        </div>`;
                }

                let audioInputHtml = '';
                let audioDisplayTitle = '';
                let audioTitleIsAuto = false;
                let audioTitleFromRangeAttr = '';
                if (t.type === 'audio_record') {
                    const raw = t.raw_data || {};
                    const useAi = raw.use_ai_grading !== false;
                    const useAiGrammar = raw.use_ai_grammar === true;
                    const captureStudio = raw.capture_studio !== false;
                    const captureUpload = raw.capture_upload !== false;

                    let scriptSource = raw.script_source || '';
                    if (!scriptSource) {
                        if (raw.snapshot_at || (raw.material_ref && raw.material_ref.published_file)) scriptSource = 'meta';
                        else if (raw.material_url || raw.student_drive_url) scriptSource = 'resource';
                        else if (raw.original_script || raw.student_display || raw.student_display_text || raw.student_text) scriptSource = 'paste';
                        else scriptSource = 'meta';
                    }

                    const safeScript = (raw.original_script || '').replace(/"/g, '&quot;');
                    const safeWrittenText = (raw.written_display || '').replace(/"/g, '&quot;');
                    const safeStudentText = (raw.student_display_text || raw.student_display || raw.student_text || '').replace(/"/g, '&quot;');
                    // C. 自行貼上：可拆成多個視窗（每頁／每個 exercise 各一個），存成 raw_data.paste_windows；
                    // 只有 1 個視窗、且沒標籤時，跟舊資料格式完全相同（單一 original_script／student_display）。
                    // 見 .cursor/rules/assignment-title-auto-inherit-invariant.mdc 旁的 paste-windows 說明。
                    const pasteWindows = (Array.isArray(raw.paste_windows) && raw.paste_windows.length)
                        ? raw.paste_windows
                        : [{ label: '', script: raw.original_script || '', student: raw.student_display_text || raw.student_display || raw.student_text || '' }];
                    const pasteWindowsHtml = pasteWindows.map(function (win, winIdx) {
                        return renderPasteWindowRowHtml(pathStr, winIdx, win, pasteWindows.length);
                    }).join('');
                    // 標題空白時以 base 範圍顯示（data-title-auto 供範圍變更時同步更新）
                    const plainTaskTitle = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
                    let materialRefs = Array.isArray(raw.material_refs) && raw.material_refs.length
                        ? raw.material_refs.slice()
                        : (raw.material_ref && raw.material_ref.published_file ? [raw.material_ref] : []);
                    const gradingUnitsForRefs = Array.isArray(raw.grading_units) ? raw.grading_units : [];
                    if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMaterialRefsMatchUnits === 'function') {
                        materialRefs = window.FeatureTimeline.ensureMaterialRefsMatchUnits(
                            materialRefs,
                            gradingUnitsForRefs,
                            materialRefs[0] || raw.material_ref || {}
                        );
                    }
                    let resolvedMaterialRange = '';
                    if (window.FeatureTimeline && typeof window.FeatureTimeline.packRangeLabelForAudio === 'function') {
                        resolvedMaterialRange = window.FeatureTimeline.packRangeLabelForAudio(pathStr) || '';
                    }
                    if (!resolvedMaterialRange) {
                        resolvedMaterialRange = raw.material_range || raw.student_drive_desc || '';
                    }
                    if (!resolvedMaterialRange && window.FeatureTimeline && typeof window.FeatureTimeline.buildMaterialRangeLabelFromRows === 'function') {
                        resolvedMaterialRange = window.FeatureTimeline.buildMaterialRangeLabelFromRows(materialRefs) || '';
                    }
                    const titleFromRange = String(resolvedMaterialRange || '').trim();
                    // 💣 雷區：不能只靠「標題目前是否為空」判斷是否自動繼承──自動填過一次存檔後
                    // t.title 就非空了，之後老師怎麼改 base 範圍，標題都會卡死在第一次算出來的值
                    // （例："Unit 10"，不管之後範圍換成哪一冊都不會再更新）。改用獨立存檔的旗標
                    // raw_data.title_auto_from_range 判斷，只要旗標仍是 true 就繼續追蹤最新範圍，
                    // 直到老師真的手動打過字（onNodeTitleInput 會把旗標關掉）才凍結。
                    const wasAudioTitleAuto = raw.title_auto_from_range === true;
                    audioTitleIsAuto = (wasAudioTitleAuto || !plainTaskTitle) && !!titleFromRange;
                    audioDisplayTitle = audioTitleIsAuto ? titleFromRange : (plainTaskTitle || titleFromRange || '');
                    audioTitleFromRangeAttr = titleFromRange.replace(/"/g, '&quot;');
                    const safeMaterialRange = String(resolvedMaterialRange || '').replace(/"/g, '&quot;');
                    const safeMaterialUrl = (raw.material_url || raw.student_drive_url || '').replace(/"/g, '&quot;');
                    const safeStudentDriveUrl = (raw.student_drive_url || raw.material_url || '').replace(/"/g, '&quot;');
                    const safeStudentDriveDesc = (raw.student_drive_desc || resolvedMaterialRange || '').replace(/"/g, '&quot;');
                    const safeStudentLocalDesc = (raw.student_local_desc || '').replace(/"/g, '&quot;');
                    const safeStudentLocalB64 = raw.student_local_b64 || '';
                    const safeStudentLocalMime = raw.student_local_mime || '';
                    const safeStudentLocalFilename = (raw.student_local_filename || '').replace(/"/g, '&quot;');
                    const studentSourceTypeHidden = raw.student_local_b64
                        ? 'local'
                        : ((raw.student_drive_url || raw.material_url) ? 'drive' : 'text');

                    let snapshotJsonAttr = '';
                    if (raw.snapshot_at) {
                        try {
                            snapshotJsonAttr = JSON.stringify({
                                material_ref: materialRefs[0] || raw.material_ref || null,
                                material_refs: materialRefs,
                                material_range: resolvedMaterialRange || '',
                                original_script: raw.original_script || '',
                                student_display: raw.student_display || raw.student_display_text || '',
                                student_display_text: raw.student_display_text || raw.student_display || '',
                                grading_units: Array.isArray(raw.grading_units) ? raw.grading_units : [],
                                snapshot_at: raw.snapshot_at
                            }).replace(/"/g, '&quot;');
                        } catch (_snapErr) {
                            snapshotJsonAttr = '';
                        }
                    }

                    // 一頁一批改稿：有多頁 grading_units 時，逐頁提供可微調文字框，
                    // 避免老師以為改了上面合併框就能改到單頁批改稿（實際批改讀的是 grading_units[i]）。
                    const gradingUnits = Array.isArray(raw.grading_units) ? raw.grading_units : [];
                    let gradingUnitsHtml = '';
                    if (gradingUnits.length > 1) {
                        const unitRows = gradingUnits.map(function (u, uIdx) {
                            const uScript = String(u.original_script || '').replace(/"/g, '&quot;');
                            const uLabelRaw = String(u.label || (u.stem ? (u.stem + ' p.' + (u.page != null ? u.page : '?')) : ('第 ' + (uIdx + 1) + ' 頁')));
                            const uLabel = uLabelRaw.replace(/"/g, '&quot;');
                            const uKey = String(u.unit_key || uLabelRaw).replace(/"/g, '&quot;');
                            const uStem = String(u.stem || '').replace(/"/g, '&quot;');
                            const uPage = u.page != null ? String(u.page) : '';
                            const uItemCount = u.item_count != null ? String(u.item_count) : '';
                            return `
                                <div class="grading-unit-row" style="background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px;">
                                    <div style="font-weight:900; color:#4338CA; font-size:0.8rem; margin-bottom:4px;">📄 ${uLabelRaw}</div>
                                    <textarea class="form-control grading-unit-script" data-unit-key="${uKey}" data-stem="${uStem}" data-page="${uPage}" data-label="${uLabel}" data-item-count="${uItemCount}" style="width:100%; min-height:56px; padding:8px; font-size:0.88rem; border-radius:6px; border:1px solid #CBD5E1;" oninput="window.FeatureTimeline.onGradingUnitScriptInput('${pathStr}')">${uScript}</textarea>
                                </div>`;
                        }).join('');
                        gradingUnitsHtml = `
                            <div style="margin-top:4px;">
                                <div style="font-size:0.78rem; color:#7C3AED; font-weight:800; margin-bottom:6px;">⚠️ 偵測到 ${gradingUnits.length} 頁，AI 批改已依頁拆分；請在下方「逐頁」微調（上面合併框僅供預覽，不會用於批改）</div>
                                <div id="node-grading-units-${pathStr}" style="display:flex; flex-direction:column; gap:8px;">${unitRows}</div>
                            </div>`;
                    }

                    const primaryRef = materialRefs[0] || raw.material_ref || {};
                    const selectedMetaRows = materialRefs.map(function (r) {
                        return {
                            value: (r.material_folder || '') + '::' + (r.published_file || ''),
                            range_spec: r.range_spec || '',
                            label: r.label || ''
                        };
                    }).filter(function (r) { return r.value && r.value !== '::'; });
                    // 已存過 materials_root_kind 就用原值；沒存過（新任務）才帶老師個人跨班預設
                    // （見 020_js_core/teacher-prefs.js getCachedSync；快取沒抓到就維持原字面預設 teacher）
                    let materialRootKind;
                    if (primaryRef.materials_root_kind === 'class' || primaryRef.materials_root_kind === 'teacher') {
                        materialRootKind = primaryRef.materials_root_kind;
                    } else {
                        const teacherRootDefaults = window.TeacherPrefs ? window.TeacherPrefs.getCachedSync() : {};
                        materialRootKind = teacherRootDefaults.default_materials_root_kind === 'class' ? 'class' : 'teacher';
                    }
                    const selectedMetaJson = JSON.stringify(selectedMetaRows).replace(/"/g, '&quot;');
                    const snapshotPreview = raw.snapshot_at
                        ? ('已凍結 snapshot：' + raw.snapshot_at + (safeMaterialRange ? ('｜' + safeMaterialRange) : ''))
                        : '尚未套用 Material snapshot';
                    const underRangePack = !!(window.FeatureTimeline
                        && typeof window.FeatureTimeline.parentRangeGroupOf === 'function'
                        && window.FeatureTimeline.parentRangeGroupOf(pathStr));
                    const rangePackOnAudio = underRangePack ? '' : renderRangePackHtml(pathStr, t);
                    const pdfStatusText = audioPdfStatusHtml(pathStr, t);

                    let resOptsHtmlForResource = '';
                    if (classResOpts) {
                        resOptsHtmlForResource = `<select class="form-control" style="width:auto; padding:6px; font-size:0.85rem; border-radius:4px; border:1px solid #CBD5E1;" onchange="window.FeatureTimeline.applyResourceUrl('${pathStr}', this.value, 'node-material-url-${pathStr}');">
                            <option value="" disabled selected>📚 從班級 01 資源庫選擇</option>${classResOpts}
                        </select>`;
                    }

                    const showMeta = scriptSource === 'meta';
                    const showRangeOnly = scriptSource === 'range_only';
                    const showPaste = scriptSource === 'paste';
                    const showResource = scriptSource === 'resource';
                    const showSkeleton = scriptSource === 'skeleton';
                    // 💣 雷區：base 範圍在骨架模式下預設「依路徑自動整理」，但老師可手動微調覆寫；
                    // 一旦手動改過（且沒清空）就不可再被路徑異動自動蓋回去，否則等同「跑掉不見」
                    // （見 feature-timeline.js refreshSkeletonRangeLabel 旁的雷區說明）。
                    const skeletonRangeAuto = raw.skeleton_range_auto !== false;

                    // E. 單元骨架：反向流程──先手動定義單元路徑（不需要 meta 檔），文稿可留空、之後再補。
                    // 沿用 grading_units 同一個欄位存放（跟 A 的 Snapshot 單元共用 shape，只是來源不同）。
                    const skeletonUnits = Array.isArray(raw.grading_units) ? raw.grading_units : [];
                    const skeletonRowsSource = (showSkeleton && !skeletonUnits.length) ? [{}] : skeletonUnits;
                    const skeletonRowsHtml = skeletonRowsSource.map(function (u, uIdx) {
                        const uPathLabel = String(u.path_label || u.label || (u.stem
                            ? (u.stem + (Array.isArray(u.sub_path) && u.sub_path.length ? '/' + u.sub_path.join('/') : ''))
                            : '')).replace(/"/g, '&quot;');
                        const uScript = String(u.original_script || '').replace(/"/g, '&quot;');
                        return `
                            <div class="skeleton-unit-row" data-idx="${uIdx}" style="display:flex; gap:8px; align-items:flex-start; background:white; border:1px solid #E2E8F0; border-radius:6px; padding:8px; margin-bottom:8px;">
                                <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
                                    <input type="text" class="form-control skeleton-unit-path" style="padding:6px; font-size:0.85rem; font-weight:800; color:#4338CA;" placeholder="單元路徑，如 Ch2/p15/Ex3/#1" value="${uPathLabel}" oninput="window.FeatureTimeline.refreshSkeletonRangeLabel('${pathStr}')">
                                    <textarea class="form-control skeleton-unit-script" style="width:100%; min-height:48px; padding:8px; font-size:0.85rem; border-radius:6px; border:1px solid #CBD5E1;" placeholder="批改文稿（可留空，之後再補）">${uScript}</textarea>
                                </div>
                                <button type="button" class="btn" style="padding:6px 8px; background:white; color:#B91C1C; border:1px solid #FCA5A5;" onclick="window.FeatureTimeline.removeSkeletonUnitRow(this, '${pathStr}')" title="刪除此列">🗑</button>
                            </div>`;
                    }).join('');

                    audioInputHtml = `
                        <div style="margin-top:15px; width:100%; background:#F8FAFC; padding:15px; border-radius:8px; border:1px solid #E2E8F0;">
                            ${rangePackOnAudio}

                            <div style="display:flex; gap:20px; align-items:center; margin-bottom:14px; padding-bottom:12px; border-bottom:1px dashed #CBD5E1; flex-wrap:wrap;">
                                <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#4338CA;">
                                    <input type="checkbox" id="node-use-ai-${pathStr}" style="transform:scale(1.2); accent-color:#4338CA;" ${useAi ? 'checked' : ''}> ✨ AI 批改發音
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#D97706;">
                                    <input type="checkbox" id="node-use-grammar-${pathStr}" style="transform:scale(1.2); accent-color:#D97706;" ${useAiGrammar ? 'checked' : ''}> 📝 AI 批改文法
                                </label>
                            </div>

                            <div style="margin-bottom:14px; padding:12px; background:white; border:1px solid #E2E8F0; border-radius:8px;">
                                <div style="font-weight:900; color:#0F172A; margin-bottom:8px;">🎙️ 學生繳交方式</div>
                                <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:center;">
                                    <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; color:#334155;">
                                        <input type="checkbox" id="node-capture-studio-${pathStr}" style="transform:scale(1.15);" ${captureStudio ? 'checked' : ''}> 錄音艙
                                    </label>
                                    <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; color:#334155;">
                                        <input type="checkbox" id="node-capture-upload-${pathStr}" style="transform:scale(1.15);" ${captureUpload ? 'checked' : ''}> 上傳音檔
                                    </label>
                                    <span style="font-size:0.8rem; color:#64748B;">預設兩者都開；可只留其一</span>
                                </div>
                            </div>

                            <div style="margin-bottom:14px; padding:12px; background:white; border:1px solid #E2E8F0; border-radius:8px;">
                                <div style="font-weight:900; color:#0F172A; margin-bottom:8px;">📄 文稿來源</div>
                                <select id="node-script-source-${pathStr}" class="form-control" style="width:100%; max-width:560px; padding:8px; font-size:0.9rem; font-weight:800;" onchange="window.FeatureTimeline.onScriptSourceChange('${pathStr}')">
                                    <option value="meta" ${scriptSource === 'meta' ? 'selected' : ''}>跟範圍走（口說＝文稿檔，書寫＝公式）</option>
                                    <option value="range_only" ${scriptSource === 'range_only' ? 'selected' : ''}>只錄、不顯示文稿</option>
                                    <option value="paste" ${scriptSource === 'paste' ? 'selected' : ''}>手貼文稿</option>
                                    <option value="skeleton" ${scriptSource === 'skeleton' ? 'selected' : ''}>單元骨架</option>
                                    <option value="resource" ${scriptSource === 'resource' ? 'selected' : ''}>PDF 對照頁（教材範本管理已上傳的）</option>
                                </select>
                                <div style="font-size:0.78rem; color:#64748B; margin-top:6px;">範圍只出現一次。預設跟範圍走；文稿不健全就改「只錄」。PDF 不在這裡上傳。</div>
                            </div>

                            <div id="node-base-range-wrap-${pathStr}" style="display:${showSkeleton ? 'flex' : 'none'}; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:14px; padding:12px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px;">
                                <span style="font-weight:900; color:#92400E; font-size:0.9rem; flex:0 0 100%;">📍 base 範圍（必填）</span>
                                <input type="text" id="node-material-range-manual-${pathStr}" class="form-control" style="flex:1; min-width:160px; padding:8px;" value="${safeMaterialRange}" placeholder="${showSkeleton ? '依下方單元路徑自動整理（可手動微調）' : '例：A pp. 1~2 B pp. 1~2'}" ${showSkeleton ? `data-range-auto="${skeletonRangeAuto ? '1' : '0'}" oninput="window.FeatureTimeline.onSkeletonRangeManualInput('${pathStr}', this)"` : ''}>
                                ${showSkeleton ? `<button type="button" class="btn-action" style="flex:0 0 auto; font-size:0.8rem; padding:6px 10px; background:#F59E0B; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer; white-space:nowrap;" onclick="window.FeatureTimeline.refreshSkeletonRangeLabel('${pathStr}', {force:true})">🔄 依路徑重算</button>` : ''}
                                ${showSkeleton ? `<div style="flex:0 0 100%; font-size:0.75rem; color:#92400E; margin-top:2px;">💡 書名（如 Azar-2）請寫在最上面的「✏️ 標題」欄，不要寫在這裡。這裡預設依下方單元路徑自動整理；老師直接手動編輯過（且未清空）就不會再被路徑異動覆寫，除非按「🔄 依路徑重算」或把欄位清空恢復自動。</div>` : ''}
                            </div>

                            <div id="script-source-panel-meta-${pathStr}" class="asg-unify" style="display:${showMeta ? 'block' : 'none'}; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; padding:12px; margin-bottom:14px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                                    <div style="font-weight:900; color:#5B21B6;">📦 文稿結果（跟上面範圍走）</div>
                                    <button type="button" class="btn-action" style="padding:6px 12px; background:#7C3AED; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.applyMaterialSnapshot('${pathStr}')" title="進頁已套用一次；改範圍或公式後按這裡更新口說／書寫／學生文稿">🔄 更新內容</button>
                                </div>
                                <div style="display:none;">
                                    <select id="node-material-root-${pathStr}" class="form-control" style="width:auto; padding:6px; font-size:0.85rem; font-weight:800;" onchange="window.FeatureTimeline.onMaterialRootChange('${pathStr}')">
                                        <option value="teacher" ${materialRootKind === 'teacher' ? 'selected' : ''}>👤 老師個人母稿</option>
                                        <option value="class" ${materialRootKind === 'class' ? 'selected' : ''}>🏫 班級 00（若有）</option>
                                    </select>
                                </div>
                                <div id="node-material-rows-${pathStr}" style="display:none;"></div>
                                <input type="hidden" id="node-material-selected-json-${pathStr}" value="${selectedMetaJson}">
                                <div style="display:none;">
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#4F46E5; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.addMaterialMetaRow('${pathStr}')">＋ 新增 meta</button>
                                </div>
                                <div style="display:none;">
                                    <input type="text" id="node-material-range-${pathStr}" class="form-control" value="${safeMaterialRange}">
                                </div>
                                <div style="margin-bottom:8px; padding:10px 12px; background:#EEF2FF; border:1px solid #C7D2FE; border-radius:6px; color:#3730A3; font-weight:700; line-height:1.45;">
                                    🎙 錄音單位提示：以「一頁」為唯一錄音單位。學生同一作業可複選多檔上傳；Snapshot 會依頁準備 AI 批改稿（一頁一份）。
                                </div>
                                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:8px;">
                                    <button type="button" class="btn-action" style="padding:6px 12px; background:#6366F1; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.previewMaterialSnapshot('${pathStr}')" title="可選手動預覽；改範圍後也會自動套用並更新預覽">👁 預覽</button>
                                    <button type="button" class="btn-action" style="padding:6px 12px; background:#059669; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.applyMaterialSnapshot('${pathStr}')" title="改範圍或公式後按這裡更新口說／書寫／學生文稿">📌 更新內容</button>
                                    <span style="color:#6D28D9; font-weight:700;">進頁會套用一次；之後改範圍請按「更新內容」</span>
                                </div>
                                <div id="node-material-status-${pathStr}" style="color:#64748B; margin-bottom:6px;"></div>
                                <div id="node-material-preview-${pathStr}" style="color:#475569; background:white; border:1px dashed #CBD5E1; border-radius:6px; padding:8px; max-height:160px; overflow:auto;">${snapshotPreview}</div>
                                <input type="hidden" id="node-material-snapshot-json-${pathStr}" value="${snapshotJsonAttr}">
                                <div style="margin-top:12px; display:flex; flex-direction:column; gap:10px;">
                                    <div>
                                        <div id="node-script-label-${pathStr}" class="asg-field-label" style="color:#4338CA; margin-bottom:4px;">🎯 口說答案${gradingUnits.length > 1 ? '（合併預覽，唯讀）' : '（可微調）'}</div>
                                        <textarea id="node-script-${pathStr}" class="form-control asg-field-input" style="width:100%; min-height:88px; padding:10px; border-radius:6px; border:1px solid #CBD5E1; ${gradingUnits.length > 1 ? 'background:#F1F5F9; color:#64748B;' : ''}" placeholder="進頁或按更新內容後會從 .script.txt 填入口說答案；可再微調" ${gradingUnits.length > 1 ? 'readonly' : ''}>${safeScript}</textarea>
                                        ${gradingUnitsHtml}
                                    </div>
                                    <div>
                                        <div class="asg-field-label" style="color:#065F46; margin-bottom:4px;">👀 書寫答案（有 meta 必有）</div>
                                        <textarea id="node-written-text-${pathStr}" class="form-control asg-field-input" style="width:100%; min-height:88px; padding:10px; border-radius:6px; border:1px solid #CBD5E1;" placeholder="進頁或按更新內容後會填入書寫答案">${safeWrittenText}</textarea>
                                    </div>
                                    <div>
                                        <div class="asg-field-label" style="color:#9A3412; margin-bottom:4px;">📄 學生文稿（擷取範本公式；學生端可收起）</div>
                                        <textarea id="node-student-text-${pathStr}" class="form-control asg-field-input" style="width:100%; min-height:88px; padding:10px; border-radius:6px; border:1px solid #CBD5E1;" placeholder="進頁或按更新內容後會依該擷取範本的學生文稿公式填入">${safeStudentText}</textarea>
                                    </div>
                                </div>
                            </div>

                            <div id="script-source-panel-range_only-${pathStr}" style="display:${showRangeOnly ? 'block' : 'none'}; margin-bottom:14px; padding:12px; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:8px; font-size:0.85rem; color:#475569;">
                                只錄、不顯示文稿。範圍用上面那張卡。若要 AI 請改「跟範圍走」、手貼，或單元骨架。
                            </div>

                            <div id="script-source-panel-paste-${pathStr}" style="display:${showPaste ? 'block' : 'none'}; margin-bottom:14px;">
                                <div style="font-size:0.78rem; color:#64748B; margin-bottom:8px; line-height:1.5;">
                                    一次貼一整段常常混了好幾頁／好幾個 exercise，之後很難拆。若這次內容涵蓋不只一頁／一個 exercise，
                                    建議按「➕ 增加視窗」，每頁／每個 exercise 各開一個視窗、標好頁碼或題號──日後用「📥 由下往上收集文稿」
                                    整理教材時，才能自動依視窗分段，不用再手動猜哪裡該切。
                                </div>
                                <div id="node-paste-windows-${pathStr}" style="display:flex; flex-direction:column; gap:10px;">${pasteWindowsHtml}</div>
                                <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#7C3AED; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.addPasteWindowRow('${pathStr}')">➕ 增加視窗</button>
                                    <span style="font-size:0.75rem; color:#94A3B8;">${pasteWindows.length > 1 ? ('目前 ' + pasteWindows.length + ' 個視窗') : '只有 1 個視窗時不會加標籤，維持原本單段格式'}</span>
                                </div>
                                <div style="font-size:0.78rem; color:#64748B; margin-top:8px;">內容寫入作業 Snapshot 欄位；建議歸檔本班 01_Class_Resources。</div>
                            </div>

                            <div id="script-source-panel-resource-${pathStr}" style="display:${showResource ? 'block' : 'none'}; margin-bottom:14px; background:white; border:1px solid #FDBA74; border-radius:8px; padding:12px;">
                                <div style="font-weight:900; color:#9A3412; margin-bottom:8px;">📄 PDF 對照頁</div>
                                <div style="font-size:0.82rem; color:#7C2D12; font-weight:700; line-height:1.5;">${pdfStatusText}</div>
                                <div style="font-size:0.75rem; color:#9A3412; margin-top:8px;">依上面範圍的頁碼／題號，到教材範本管理那份 PDF 找對應檔案頁。沒對到就不顯示。這裡不另傳檔。</div>
                                <input type="hidden" id="node-material-url-${pathStr}" value="${safeMaterialUrl}">
                                <input type="hidden" id="node-student-local-b64-${pathStr}" value="${safeStudentLocalB64}">
                                <input type="hidden" id="node-student-local-mime-${pathStr}" value="${safeStudentLocalMime}">
                                <input type="hidden" id="node-student-local-filename-${pathStr}" value="${safeStudentLocalFilename}">
                                <input type="hidden" id="node-student-local-desc-${pathStr}" value="${safeStudentLocalDesc}">
                                <input type="hidden" id="node-student-drive-url-${pathStr}" value="${safeStudentDriveUrl}">
                                <input type="hidden" id="node-student-drive-desc-${pathStr}" value="${safeStudentDriveDesc}">
                                <input type="hidden" id="node-student-source-type-${pathStr}" value="${studentSourceTypeHidden}">
                            </div>

                            <div id="script-source-panel-skeleton-${pathStr}" style="display:${showSkeleton ? 'block' : 'none'}; margin-bottom:14px; background:#F5F3FF; border:1px solid #DDD6FE; border-radius:8px; padding:12px;">
                                <div style="font-weight:900; color:#5B21B6; margin-bottom:6px;">🧩 單元骨架（自訂路徑，不需要 meta 檔）</div>
                                <div style="font-size:0.78rem; color:#64748B; margin-bottom:10px; line-height:1.5;">
                                    每列＝一個可錄音／可批改的單元。路徑自由填，用 <code>/</code> 分層，例如 <code>Ch2/p15/Ex3/#1</code>；第一段會當成分組鍵（給之後考試出題沿用）。
                                    文稿可先留空，之後回來這裡補；補完文稿的舊繳交，需用「課程進度」的「補啟 AI 批改」才會真正送 AI（不會自動觸發）。
                                </div>
                                <div id="node-skeleton-units-${pathStr}">${skeletonRowsHtml}</div>
                                <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
                                    <button type="button" class="btn-action" style="font-size:0.85rem; padding:6px 12px; background:#7C3AED; color:white; border:none; border-radius:6px; font-weight:800; cursor:pointer;" onclick="window.FeatureTimeline.addSkeletonUnitRow('${pathStr}')">＋ 加一列單元</button>
                                    <span style="font-size:0.75rem; color:#94A3B8;">${skeletonUnits.length ? ('目前 ' + skeletonUnits.length + ' 個單元') : '尚未新增任何單元'}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }

                let examInputHtml = '';
                if (t.type === 'exam') {
                    try {
                        if (window.FeatureExamJob && typeof window.FeatureExamJob.renderInlineEditorHtml === 'function') {
                            examInputHtml = window.FeatureExamJob.renderInlineEditorHtml(pathStr, t);
                        } else {
                            const loadErr = window.FeatureExamJob && window.FeatureExamJob._loadError
                                ? String(window.FeatureExamJob._loadError)
                                : '';
                            examInputHtml = '<div style="margin-top:8px; color:#B91C1C; font-weight:800;">出題模組沒載入。請硬重新整理（Cmd+Shift+R）。'
                                + (loadErr ? ('<div style="margin-top:4px; font-size:0.78rem;">原因：' + String(loadErr).replace(/</g, '&lt;') + '</div>') : '')
                                + '</div>';
                        }
                    } catch (examErr) {
                        examInputHtml = '<div style="margin-top:8px; color:#B91C1C; font-weight:800;">出題畫面錯誤：'
                            + String((examErr && examErr.message) || examErr).replace(/</g, '&lt;')
                            + '</div>';
                    }
                }

                // 🆕 PDF 考卷：全新、獨立分支，跟上面的 exam（meta 出題）互不干涉
                let pdfExamInputHtml = '';
                if (t.type === 'pdf_exam') {
                    pdfExamInputHtml = (window.FeaturePdfExamJob && typeof window.FeaturePdfExamJob.renderInlineEditorHtml === 'function')
                        ? window.FeaturePdfExamJob.renderInlineEditorHtml(pathStr, t)
                        : '<div style="margin-top:8px; color:#B91C1C;">FeaturePdfExamJob 未載入</div>';
                }

                // 小標題：組合層底下＝上方表名＋範圍。不是組合層：錄音／考試各自原路。
                let leafTitleHtml = String(t.title || '');
                let leafTitleAuto = '0';
                let leafTitleFromRange = '';
                const comboPackTitle = comboPackTitleForPath(pathStr);
                const leafPlainTitle = String(t.title || '').replace(/<[^>]*>?/gm, '').trim();
                const leafWasAuto = (t.raw_data || {}).title_auto_from_range === true;
                if (comboPackTitle && isComboInheritType(t.type) && (leafWasAuto || !leafPlainTitle)) {
                    leafTitleHtml = comboPackTitle.replace(/</g, '&lt;');
                    leafTitleAuto = '1';
                    leafTitleFromRange = comboPackTitle.replace(/"/g, '&quot;');
                } else if (t.type === 'audio_record') {
                    leafTitleHtml = String(audioDisplayTitle || '').replace(/</g, '&lt;');
                    leafTitleAuto = audioTitleIsAuto ? '1' : '0';
                    leafTitleFromRange = audioTitleFromRangeAttr;
                } else if (t.type === 'exam') {
                    const examRaw = t.raw_data || {};
                    const plainExamTitle = leafPlainTitle;
                    let examRangeHint = '';
                    if (window.FeatureExamJob && typeof window.FeatureExamJob.getExamRangeLabel === 'function') {
                        examRangeHint = window.FeatureExamJob.getExamRangeLabel(pathStr, t) || '';
                    } else if (window.FeatureExamJob && typeof window.FeatureExamJob.getSiblingAudioRangeLabel === 'function') {
                        examRangeHint = window.FeatureExamJob.getSiblingAudioRangeLabel(pathStr) || '';
                    }
                    const wasExamTitleAuto = examRaw.title_auto_from_range === true;
                    const examTitleIsAuto = (wasExamTitleAuto || !plainExamTitle) && !!examRangeHint;
                    if (examTitleIsAuto) {
                        leafTitleHtml = examRangeHint.replace(/</g, '&lt;');
                        leafTitleAuto = '1';
                        leafTitleFromRange = examRangeHint.replace(/"/g, '&quot;');
                    } else {
                        leafTitleHtml = String(t.title || '');
                        leafTitleAuto = '0';
                    }
                }

                let tLateMode = t.late_mode || 'infinite';

                return `
                    <div id="node-block-${pathStr}"
                         style="margin-top: 10px; margin-bottom: 10px; background: white; padding: 12px; border: 1px solid #CBD5E1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); transition: border 0.2s;">
                        <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; margin-bottom: 8px;">
                            <div style="padding-top:4px;">${typeSelectorHtml}</div>
                            <div id="node-title-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題"
                                 data-title-auto="${leafTitleAuto}" data-title-from-range="${leafTitleFromRange}"
                                 oninput="window.FeatureTimeline && window.FeatureTimeline.onNodeTitleInput && window.FeatureTimeline.onNodeTitleInput('${pathStr}', this)"
                                 style="flex:1; min-width:150px; font-size:1rem; padding:8px 12px; background:white; border:1px solid #CBD5E1; border-radius:6px; outline:none; min-height:38px;">${leafTitleHtml}</div>
                            
                            <div style="display:flex; align-items:center; gap:10px; padding-top:4px; flex-wrap:wrap;">
                                <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;" title="留空則繼承外層">期限:</label>
                                    ${dateTimeFields(`node-due-${pathStr}`, `node-due-time-${pathStr}`, t.due_date, 'padding:6px; font-size:0.9rem; width:130px;', 'padding:6px; font-size:0.9rem; width:110px;')}
                                </div>
                                <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;" title="留空則繼承外層">開放:</label>
                                    ${dateTimeFields(`node-open-${pathStr}`, `node-open-time-${pathStr}`, t.open_at, 'padding:6px; font-size:0.9rem; width:130px;', 'padding:6px; font-size:0.9rem; width:110px;')}
                                </div>
                                <div style="display:flex; align-items:center; gap:5px;">
                                    <label style="font-size:0.9rem; font-weight:bold; color:#64748B;">遲交:</label>
                                    <select id="node-late-mode-${pathStr}" class="form-control" style="padding:6px; font-size:0.9rem; width:auto;" onchange="
                                        const m = this.value;
                                        document.getElementById('node-late-custom-${pathStr}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                        document.getElementById('node-grace-wrapper-${pathStr}').style.display = (m === 'custom') ? 'flex' : 'none';
                                    ">
                                        <option value="no_late" ${tLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                        <option value="infinite" ${tLateMode === 'infinite' ? 'selected' : ''}>♾️ 接受遲交</option>
                                        <option value="custom" ${tLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                                    </select>
                                </div>
                                
                                <div id="node-late-custom-${pathStr}" style="display:${(tLateMode === 'infinite' || tLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:5px; background:#F8FAFC; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0;">
                                    <div id="node-grace-wrapper-${pathStr}" style="display:${tLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                        <label style="font-size:0.85rem; color:#64748B;">寬限(時):</label>
                                        <input type="number" id="node-grace-${pathStr}" class="form-control" style="padding:4px; width:50px;" value="${t.grace_period_hours || 0}" min="0">
                                    </div>
                                    <div style="display:flex; align-items:center; gap:5px;">
                                        <label style="font-size:0.85rem; color:#64748B;">扣分(%):</label>
                                        <input type="number" id="node-penalty-${pathStr}" class="form-control" style="padding:4px; width:50px;" value="${t.penalty_percentage || 0}" min="0" max="100">
                                    </div>
                                </div>
                            </div>

                            <div style="display:flex; align-items:center; gap:8px; padding-top:4px; margin-left:auto;">
                                ${arrowHtml}
                                <button type="button" class="btn-danger" style="padding:6px 10px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.removeNode('${pathStr}')">❌</button>
                            </div>
                        </div>
                        ${urlInputHtml}
                        ${audioInputHtml}
                        ${examInputHtml}
                        ${pdfExamInputHtml}
                        <div style="margin-top:8px; border-top:1px dashed #E2E8F0; padding-top:8px;">
                            <div id="node-desc-${pathStr}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="width:100%; min-height: 40px; font-size:0.85rem; padding:8px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; outline:none;">${t.description || ''}</div>
                        </div>
                    </div>
                `;
            }
        });
        return treeHtml.join('');
    }

    function getHistoryDropdownHtml(allAssigns, containerId) {
        if (!allAssigns || allAssigns.length === 0) return '';
        let opts = allAssigns.map(a => `<option value="${a.id}">${a.target_date} - ${a.title.replace(/<[^>]*>?/gm, '')}</option>`).join('');
        return `
            <div style="margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #E2E8F0;">
                <label style="font-size:0.9rem; font-weight:800; color:#64748B;">🔄 快速載入過去的區塊樣板：</label>
                <div style="display:flex; gap:10px; margin-top:5px; align-items:center;">
                    <select id="history-select-${containerId}" class="form-control" style="flex:1;" onchange="window.FeatureTimeline.copyHistory(this.value)">
                        <option value="">-- 選擇歷史紀錄 --</option>
                        ${opts}
                    </select>
                    <button type="button" class="btn-danger" style="padding:6px 12px; border-radius:6px; border:none; cursor:pointer;" onclick="window.FeatureTimeline.deleteHistoryTemplate()" title="刪除選取的歷史紀錄">🗑️ 刪除紀錄</button>
                </div>
            </div>`;
    }

    function getBuilderFormHtml(bState, classResOpts, tasksContainerHtml, historyHtml) {
        const bLateMode = bState.late_mode || 'infinite';
        const rteToolbarHtml = `
            <div class="rte-toolbar">
                <span style="font-size:1rem; font-weight:800; color:#64748B; margin-right:5px;">反白選取編輯：</span>
                <button type="button" class="rte-btn" onmousedown="event.preventDefault(); document.execCommand('bold', false, null);">B</button>
                <button type="button" class="rte-btn" style="font-style:italic;" onmousedown="event.preventDefault(); document.execCommand('italic', false, null);">I</button>
                <button type="button" class="rte-btn" style="text-decoration:underline;" onmousedown="event.preventDefault(); document.execCommand('underline', false, null);">U</button>
                <select class="rte-btn" onchange="document.execCommand('foreColor', false, this.value); this.selectedIndex=0;" style="padding: 2px 4px; border-radius: 4px; cursor: pointer; font-weight: 800;">
                    <option value="">🎨 顏色</option>
                    <option value="#EF4444" style="color:#EF4444; font-weight:bold;">🔴 紅色</option>
                    <option value="#F59E0B" style="color:#F59E0B; font-weight:bold;">🟠 橘色</option>
                    <option value="#10B981" style="color:#10B981; font-weight:bold;">🟢 綠色</option>
                    <option value="#3B82F6" style="color:#3B82F6; font-weight:bold;">🔵 藍色</option>
                    <option value="#8B5CF6" style="color:#8B5CF6; font-weight:bold;">🟣 紫色</option>
                    <option value="#1E293B" style="color:#1E293B; font-weight:bold;">⚫ 黑色</option>
                </select>
            </div>
        `;

        let addResourceHtml = classResOpts ? `
            <select class="form-control" style="width:auto; padding:6px 12px; font-size:1rem; font-weight:800; border:1px solid #94A3B8; color:#475569; border-radius:8px; cursor:pointer; background: white;" onchange="if(this.value) { window.FeatureTimeline.addResourceTaskAsLink(null, this.value); this.value=''; }">
                <option value="" disabled selected>+ 📚 全域／班群／班級資源</option>
                ${classResOpts}
            </select>
        ` : `<button type="button" class="btn" style="background:#F1F5F9; color:#94A3B8; border:1px dashed #CBD5E1; cursor:not-allowed; font-size:1rem;" title="請先至資源管理新增並派發資源">+ 📚 尚無任何可用資源</button>`;

        return `
            <div id="${bState.containerId}-editor" style="border: 2px dashed #10B981; padding: 20px; border-radius: 12px; margin-top: 20px; background: #FFFDF8; overflow:hidden;">
                ${historyHtml}
                ${rteToolbarHtml}
                <div style="background: white; border: 1px solid #CBD5E1; border-radius: 8px; padding: 15px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div id="builder-title-${bState.containerId}" class="rt-normalize" contenteditable="true" data-placeholder="✏️ 標題" style="font-weight:900; font-size:1rem; border-bottom:1px solid #E2E8F0; padding-bottom:8px; margin-bottom:10px; outline:none; min-height:30px; color: var(--primary-dark);">${bState.title || ''}</div>
                    <div id="builder-desc-${bState.containerId}" class="rt-normalize" contenteditable="true" data-placeholder="📝 說明..." style="font-size:0.85rem; outline:none; min-height:50px; margin-bottom:15px; color: #475569;">${bState.description || ''}</div>
                    
                    <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center; background:#F8FAFC; padding:10px 12px; border-radius:6px; border: 1px solid #E2E8F0;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">區塊期限：</label>
                            ${dateTimeFields(`builder-due-${bState.containerId}`, `builder-due-time-${bState.containerId}`, bState.due_date, 'width:auto; padding:4px 8px; font-size:1rem;', 'width:110px; padding:4px 8px; font-size:1rem;')}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">開放日期：</label>
                            ${dateTimeFields(`builder-open-${bState.containerId}`, `builder-open-time-${bState.containerId}`, bState.open_at, 'width:auto; padding:4px 8px; font-size:1rem;', 'width:110px; padding:4px 8px; font-size:1rem;')}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <label style="font-weight:800; font-size:1rem; color:#334155;">區塊遲交規則：</label>
                            <select id="builder-late-mode-${bState.containerId}" class="form-control" style="padding:4px 8px; font-size:1rem; width:auto;" onchange="
                                const m = this.value;
                                document.getElementById('builder-late-custom-${bState.containerId}').style.display = (m === 'infinite' || m === 'custom') ? 'flex' : 'none';
                                document.getElementById('builder-grace-wrapper-${bState.containerId}').style.display = (m === 'custom') ? 'flex' : 'none';
                            ">
                                <option value="no_late" ${bLateMode === 'no_late' ? 'selected' : ''}>🚫 無遲交</option>
                                <option value="infinite" ${bLateMode === 'infinite' ? 'selected' : ''}>♾️ 接受遲交</option>
                                <option value="custom" ${bLateMode === 'custom' ? 'selected' : ''}>⏳ 自訂寬限</option>
                            </select>
                        </div>
                        <div id="builder-late-custom-${bState.containerId}" style="display:${(bLateMode === 'infinite' || bLateMode === 'custom') ? 'flex' : 'none'}; align-items:center; gap:10px; background:#F1F5F9; padding:4px 10px; border-radius:6px; border:1px solid #CBD5E1;">
                            <div id="builder-grace-wrapper-${bState.containerId}" style="display:${bLateMode === 'custom' ? 'flex' : 'none'}; align-items:center; gap:5px;">
                                <label style="font-size:0.9rem; font-weight:bold; color:#475569;">寬限(小時):</label>
                                <input type="number" id="builder-grace-${bState.containerId}" class="form-control" style="padding:4px; width:70px;" value="${bState.late_grace || 0}" min="0">
                            </div>
                            <div style="display:flex; align-items:center; gap:5px;">
                                <label style="font-size:0.9rem; font-weight:bold; color:#475569;">扣分(%):</label>
                                <input type="number" id="builder-penalty-${bState.containerId}" class="form-control" style="padding:4px; width:70px;" value="${bState.late_penalty || 0}" min="0" max="100">
                            </div>
                        </div>
                        <label style="display:flex; align-items:center; gap:8px; font-weight:800; cursor:pointer; font-size:1rem; color:#334155; margin-left: auto;">
                            <input type="checkbox" id="builder-pub-${bState.containerId}" style="transform:scale(1.2);" ${bState.is_published ? 'checked' : ''}>
                            📢 發佈
                        </label>
                    </div>
                </div>

                ${tasksContainerHtml}

                <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; background: #F1F5F9; padding: 12px; border-radius: 8px; border: 1px solid #CBD5E1;">
                    <span style="font-size:0.9rem; font-weight:bold; color:#475569; margin-right:5px;">外層作業新增：</span>
                    <button type="button" class="btn btn-action" style="font-size:1rem;" onclick="window.FeatureTimeline.addNode(null, 'check')">+ 📌 一般</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #64748B; color: white;" onclick="window.FeatureTimeline.addNode(null, 'link')">+ 🔗 連結</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #EF4444; color: white;" onclick="window.FeatureTimeline.addNode(null, 'audio_record')">+ 🎙️ 錄音</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #0F766E; color: white;" onclick="window.FeatureTimeline.addNode(null, 'exam')">+ 📝 考試</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #0369A1; color: white;" onclick="window.FeatureTimeline.addNode(null, 'pdf_exam')">+ 📄 PDF 考試</button>
                    <div style="display:inline-flex; align-items:center; gap:4px;">
                        <button type="button" class="btn btn-action" style="font-size:1rem; background: #10B981; color: white;" onclick="window.FeatureTimeline.addNode(null, 'drive')">+ 📁 Drive</button>
                    </div>
                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #2563EB; color: white;" onclick="window.FeatureTimeline.addRangeBundle(null)" title="建立組合作業：同一範圍，底下可再加類型">+ 📐 組合(錄音＋考試＋)</button>
                    <button type="button" class="btn btn-action" style="font-size:1rem; background: #8B5CF6; color: white;" onclick="window.FeatureTimeline.addNode(null, 'group')">+ 🗂️ 群組作業</button>
                    <div style="width: 1px; height: 24px; background: #CBD5E1; margin: 0 5px;"></div>
                    ${addResourceHtml}
                </div>

                <div style="display:flex; gap:10px; margin-top:20px; border-top:1px solid #E2E8F0; padding-top:15px;">
                    <button type="button" id="btn-save-block-${bState.containerId}" class="btn btn-primary" style="font-size:1rem;" onclick="window.FeatureTimeline.saveBlock(this)">💾 ${bState.editId ? '儲存修改' : '完成並儲存區塊'}</button>
                    <button type="button" class="btn" style="background:#E2E8F0; color:#334155; font-size:1rem;" onclick="window.FeatureTimeline.cancelBuilder()">取消</button>
                </div>
            </div>
        `;
    }

    function getAssignmentBlockHtml(a, classId, canEditTimeline, effectiveBlockDueDate, blockLateMode, blockPenalty, blockGrace, tasksHtml) {
        let cleanBlockDesc = a.description ? a.description.replace(/<[^>]*>?/gm, '').trim() : '';
        let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:8px;">${a.description}</div>` : '';
        let pubBadge = a.is_published ? `<span style="background:#2ECC71; color:white; font-size:0.9rem; padding:2px 6px; border-radius:4px; margin-left:8px;">✅ 發佈</span>` : `<span style="background:#94A3B8; color:white; font-size:0.9rem; padding:2px 6px; border-radius:4px; margin-left:8px;">🙈 未發佈</span>`;
        
        let lateBadgeText = '';
        if (blockLateMode === 'no_late') lateBadgeText = ' (🚫 無遲交)';
        else if (blockLateMode === 'custom') lateBadgeText = ` (⏳ 寬限 ${blockGrace}h (-${blockPenalty}%))`;
        else lateBadgeText = blockPenalty > 0 ? ` (♾️ 遲交扣 ${blockPenalty}%)` : ' (♾️ 接受遲交)';

        let blockDueBadge = effectiveBlockDueDate ? `<span style="font-size:1rem; color:#475569; margin-left:10px; font-weight:bold;">⏰ 期限: ${stampLabel(effectiveBlockDueDate)}${lateBadgeText}</span>` : '';
        let blockOpenBadge = a.open_at ? `<span style="font-size:1rem; color:#0369A1; margin-left:10px; font-weight:bold;">開放: ${stampLabel(a.open_at)}</span>` : '';
        let tasksSectionHtml = tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : '';

        const dragHandleHtml = canEditTimeline ? `<span style="cursor: grab; margin-right:8px; color:#94A3B8; display:inline-block; padding: 4px;" title="拖曳排序區塊" onmousedown="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'true')" onmouseup="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'false')" onmouseleave="document.getElementById('assign-block-${a.id}').setAttribute('draggable', 'false')">↕️</span>` : '';
            
        const actionButtonsHtml = canEditTimeline ? `<div style="display:flex; gap:8px; align-items:center;">
                   <button type="button" class="btn-icon" style="font-size:1rem; background:#F1F5F9; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.moveAssignment('${a.id}', '${classId}')" title="更換日期">📅 改期</button>
                   <button type="button" class="btn-icon" style="font-size:1rem; background:#F1F5F9; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.editAssignment('${a.id}')">✏️ 修改</button>
                   <button type="button" class="btn-icon btn-danger" style="font-size:1rem; border:none; padding:4px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureTimeline.deleteAssignment('${a.id}', '${classId}')" title="刪除">🗑️</button>
               </div>` : '';

        const dragEventsHtml = canEditTimeline ? `ondragstart="window.FeatureTimeline.dragAssignStart(event, '${a.id}')" ondragover="event.preventDefault(); this.classList.add('drag-over');" ondragleave="this.classList.remove('drag-over');" ondrop="this.classList.remove('drag-over'); window.FeatureTimeline.dropAssign(event, '${a.id}', '${classId}')" ondragend="this.setAttribute('draggable', 'false');"` : '';

        return `
            <div id="assign-block-${a.id}" draggable="false" ${dragEventsHtml} style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                    <div style="font-weight: 900; color: var(--primary-dark); font-size: 1rem; display:flex; align-items:center;">
                        ${dragHandleHtml} <span style="margin-right:6px;">📝</span> <span class="rt-normalize">${a.title}</span> <span style="margin-left:8px;">${pubBadge}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:15px; margin-left:auto;">
                        ${blockDueBadge}
                        ${blockOpenBadge}
                        ${actionButtonsHtml}
                    </div>
                </div>
                ${blockDescHtml}
                ${tasksSectionHtml}
            </div>
        `;
    }

    function getTimelineNodeHtml(index, mode, nodeTitle, isCurrent, isFuture, nodeDate, classId, canEditTimeline, assignmentsHtml, builderContainerId, canDeleteSession, nodeDates) {
        let badge = '', borderColor = '#E2E8F0', bgColor = '#FFFFFF', headerTextColor = '#475569';

        if (isCurrent) {
            badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.9rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
            borderColor = '#10B981'; bgColor = '#ECFDF5'; headerTextColor = '#065F46';
        } else if (!isFuture) {
            bgColor = '#F8FAFC'; headerTextColor = '#94A3B8';
        }

        const addBlockBtn = canEditTimeline ? `<button type="button" class="btn btn-primary" onclick="window.FeatureTimeline.openBuilder('${classId}', '${nodeDate}', '${builderContainerId}')">+ 新增區塊</button>` : '';
        const headerActions = addBlockBtn
            ? `<div style="display:flex; gap:8px; flex-wrap:wrap;">${addBlockBtn}</div>`
            : '';
        const nodeDragEvents = canEditTimeline ? `ondragover="event.preventDefault();" ondrop="window.FeatureTimeline.dropAssignToNode(event, '${nodeDate}', '${classId}')"` : '';

        const dates = (Array.isArray(nodeDates) && nodeDates.length > 0) ? nodeDates : [nodeDate];
        const isWeekly = mode === 'weekly';
        const railParts = isWeekly ? formatRailWeekParts(dates) : formatRailDateParts(nodeDate);
        const railCls = 'tl-rail-date'
            + (railParts.isRange ? ' tl-rail-date--range' : '')
            + (isCurrent ? ' tl-rail-date--current' : '')
            + (canDeleteSession ? ' tl-rail-date--deletable' : '');
        const rangeLabel = dates.length > 1 ? (dates[0] + ' ~ ' + dates[dates.length - 1]) : (nodeTitle || nodeDate);
        const unitLabel = isWeekly ? '週' : '堂';
        const railTitle = canDeleteSession
            ? ('刪除此' + unitLabel + '：' + rangeLabel)
            : String(rangeLabel || '');
        const dayCls = 'tl-rail-date__day' + (railParts.isRange ? ' tl-rail-date__day--range' : '');
        const railInner = `<span class="tl-rail-date__month">${railParts.month}</span><span class="${dayCls}">${railParts.day}</span>`;
        const datesAttr = dates.join(',');
        const railDateHtml = canDeleteSession
            ? `<button type="button" class="${railCls}" title="${railTitle}" onclick="window.FeatureTimeline.removeSessionDate('${classId}', '${datesAttr}')">${railInner}</button>`
            : `<div class="${railCls}" title="${railTitle}">${railInner}</div>`;

        return `
            <div id="timeline-node-${index}" class="timeline-node" data-is-current="${isCurrent}" style="overflow: visible !important; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 12px; position: relative; scroll-margin-top: 25px;" ${nodeDragEvents}>
                ${railDateHtml}
                <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                    <div class="node-date" style="display:flex; align-items:center; position:relative;">
                        <span style="font-weight: 800; color: ${headerTextColor}; font-size: 1rem;">第 ${index + 1} ${isWeekly ? '週' : '堂'}</span> ${badge}
                    </div>
                    ${headerActions}
                </div>
                ${assignmentsHtml}
                <div id="${builderContainerId}"></div>
            </div>`;
    }

    /** 灰線上兩堂之間：加入新日期／進度 */
    function getTimelineRailAddHtml(classId) {
        return `
            <div class="tl-rail-add-row" aria-hidden="false">
                <button type="button" class="tl-rail-add-btn" title="加入新日期／進度"
                    onclick="window.FeatureTimeline.openAddSessionModal('${classId}')">＋</button>
            </div>`;
    }

    function getAddSessionModalHtml(classId) {
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">＋ 加堂</h3>
                <p style="margin:0 0 16px; color:#64748B; font-size:0.95rem; line-height:1.5;">
                    將日期加入進度軸。若超出學期起訖日，確認後仍可加（例如補課）。
                </p>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom: 25px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
                    <label style="font-weight:800; color:#334155; white-space:nowrap;">日期：</label>
                    <input type="date" id="add-session-date" class="form-control" style="flex:1; padding: 8px; font-size: 1rem;">
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size:1rem;" onclick="window.ModalOverlay.close('add-session-modal')">取消</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-add-session" style="padding: 8px 20px; font-size:1rem;" onclick="window.FeatureTimeline.submitAddSession('${classId}')">確認加堂</button>
                </div>
            </div>
        `;
    }

    function getMoveAssignModalHtml(cleanTitle, targetDate, assignId, classId, sessionDates) {
        const dates = Array.isArray(sessionDates) ? sessionDates : [];
        const optionsHtml = dates.map(function (d) {
            const selected = d === targetDate ? ' selected' : '';
            return '<option value="' + d + '"' + selected + '>' + d + '</option>';
        }).join('');

        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📅 作業改期 / 搬移</h3>
                <div style="margin-bottom:12px; font-size:1rem; color:#475569; line-height:1.5;">
                    準備將 <strong>「${cleanTitle}」</strong> 搬移至新日期：
                </div>
                <p style="margin:0 0 14px; font-size:0.88rem; color:#64748B; line-height:1.45;">
                    若清單沒有目標日，請先在進度軸按「＋ 加堂」。
                </p>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom: 25px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
                    <label style="font-weight:800; color:#334155; white-space:nowrap;">選擇新日期：</label>
                    <select id="move-target-date" class="form-control" style="flex:1; padding: 8px; font-size: 1rem;">
                        ${optionsHtml}
                    </select>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size:1rem;" onclick="window.ModalOverlay.close('move-assign-modal')">取消</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-move" style="padding: 8px 20px; font-size:1rem;" onclick="window.FeatureTimeline.submitMove('${assignId}', '${classId}', '${targetDate}')">確認改期</button>
                </div>
            </div>
        `;
    }

    function getLinePushModalHtml(cleanTitle, assignId, classId, overlayId) {
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #059669; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📢 推播至 LINE 群組</h3>
                <div style="margin-bottom:20px; font-size:1rem; color:#475569; line-height:1.5;">
                    準備將 <strong>「${cleanTitle}」</strong> 的作業詳情，傳送至已綁定的 LINE 群組。
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="button" class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight:bold; font-size:1rem;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-push" style="padding: 8px 20px; font-weight:bold; font-size:1rem; background:#10B981; border:none;" onclick="window.FeatureTimeline.executeLinePush('${assignId}', '${classId}')">🚀 確認發送</button>
                </div>
            </div>
        `;
    }

    return {
        getTimelineStyleBlock,
        renderReadOnlyTree,
        renderBuilderTree,
        getHistoryDropdownHtml,
        getBuilderFormHtml,
        getAssignmentBlockHtml,
        getTimelineNodeHtml,
        getTimelineRailAddHtml,
        getAddSessionModalHtml,
        getMoveAssignModalHtml,
        getLinePushModalHtml,
        renderPasteWindowRowHtml,
        renderRangePackHtml,
        renderSheetPackTableHtml,
        packSelectedCountSum
    };
})();
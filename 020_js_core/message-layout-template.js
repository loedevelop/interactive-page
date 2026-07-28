/**
 * 📂 020_js_core/message-layout-template.js
 * 提醒訊息／家長提醒圖：欄位編排意圖（非繪圖畫布）
 *
 * 存於 classes.raw_data.message_layout
 * - 磁性列：上下吸附列線，不接受上下重疊
 * - 同列依左右：貼邊靠齊、緊鄰 4 空白、重疊接著顯示
 * - 最終輸出非 1:1 映像
 */
window.MessageLayoutTemplate = (function () {
    'use strict';

    var CANVAS_W = 560;
    var CANVAS_H = 520;
    /** 磁性列：列高／頂部邊距（編輯器與渲染同分列規則） */
    var ROW_TOP = 16;
    var ROW_H = 64;
    /** 同列判定（應 ≤ ROW_H/2） */
    var ROW_Y_TOLERANCE = 28;
    /** 與編輯器 chip 一致；優先用實測 w，否則用估寬 */
    var CHIP_MIN_W = 140;
    var CHIP_MAX_W = 220;
    var CHIP_FALLBACK_W = 200;
    var LEFT_EDGE_SLACK = 16;
    var RIGHT_EDGE_SLACK = 12;
    /** 兩方格間隙 ≤ 此值且無重疊 → 以 4 空白連接；間隙 < 0 → 重疊接著顯示 */
    var ADJACENT_GAP_MAX = 24;
    var JOIN_SPACES = '    ';

    function chipWidth(w) {
        var n = Number(w);
        if (n && n > 0) return n;
        return CHIP_FALLBACK_W;
    }

    /** 吸附到磁性列 y */
    function snapY(y, canvasH) {
        var h = canvasH || CANVAS_H;
        var maxRow = Math.max(0, Math.floor((h - ROW_TOP - 40) / ROW_H));
        var raw = Number(y) || 0;
        var idx = Math.round((raw - ROW_TOP) / ROW_H);
        if (idx < 0) idx = 0;
        if (idx > maxRow) idx = maxRow;
        return ROW_TOP + idx * ROW_H;
    }

    function rowIndex(y) {
        return Math.round(((Number(y) || 0) - ROW_TOP) / ROW_H);
    }

    /** 欄位方塊左緣是否碰到畫布左邊 */
    function isLeftAnchored(x) {
        return (Number(x) || 0) <= LEFT_EDGE_SLACK;
    }

    /** 欄位方塊右緣是否碰到畫布右邊 */
    function isRightAnchored(x, canvasW, w) {
        var cw = canvasW || CANVAS_W;
        return (Number(x) || 0) + chipWidth(w) >= cw - RIGHT_EDGE_SLACK;
    }

    /** 左方格右緣到右方格左緣的間隙（負值＝重疊） */
    function chipGap(leftX, rightX, leftW) {
        return (Number(rightX) || 0) - ((Number(leftX) || 0) + chipWidth(leftW));
    }

    /** 讓區塊可並排串接 */
    function asInlineChunk(html) {
        return '<span style="display:inline-block;vertical-align:baseline;">' + String(html || '') + '</span>';
    }

    /** 系統提供的欄位積木 */
    var FIELD_DEFS = [
        { id: 'headline_label', label: '溫馨提醒：', hint: '固定標題（家長提醒圖）', surfaces: ['reminder'] },
        { id: 'headline_phrase', label: '記得補交／要交哦！', hint: '依狀況換字', surfaces: ['reminder'] },
        { id: 'icon_heart', label: '❤️ 單顆紅心', hint: '圖示', surfaces: ['message', 'reminder'], defaultOn: false },
        { id: 'icon_hearts', label: '💕 漸小愛心', hint: '兩～三顆由大到小', surfaces: ['message', 'reminder'], defaultOn: false },
        { id: 'student_name', label: '學生英文名字', hint: 'nameEN／提醒圖與訊息', surfaces: ['message', 'reminder'] },
        { id: 'class_name', label: '班級名稱', hint: '訊息／提醒圖', surfaces: ['message', 'reminder'] },
        { id: 'progress_date', label: '進度日', hint: 'target_date', surfaces: ['message', 'reminder'] },
        { id: 'assignment_title', label: '作業名稱', hint: '含截止標籤（訊息）', surfaces: ['message', 'reminder'] },
        { id: 'due_date', label: '截止日', hint: 'due_date', surfaces: ['message', 'reminder'] },
        { id: 'completion_progress', label: '完成進度 n/m', hint: '即時計算', surfaces: ['message', 'reminder'] },
        { id: 'task_list', label: '作業細項清單', hint: '家長提醒圖', surfaces: ['reminder'] },
        { id: 'kind_badge', label: '提醒類型徽章', hint: '即將截止／補交', surfaces: ['message', 'reminder'] },
        { id: 'notify_time', label: '通知時間', hint: '學生訊息', surfaces: ['message'] }
    ];

    /** 圖示 HTML（提醒圖／訊息共用） */
    function iconHeartHtml() {
        return '<span style="display:inline-block;vertical-align:middle;line-height:1;font-size:22px;color:#EF4444;" aria-hidden="true">❤️</span>';
    }

    function iconHeartsHtml() {
        // 三顆紅心，由大到小
        return ''
            + '<span style="display:inline-flex;align-items:center;gap:1px;vertical-align:middle;line-height:1;" aria-hidden="true">'
            + '<span style="font-size:22px;color:#EF4444;">❤️</span>'
            + '<span style="font-size:16px;color:#EF4444;">❤️</span>'
            + '<span style="font-size:11px;color:#EF4444;">❤️</span>'
            + '</span>';
    }

    function defaultFields() {
        // 預設落在磁性列（ROW_TOP + n*ROW_H）
        return [
            { id: 'headline_label', enabled: true, x: 24, y: snapY(16) },
            { id: 'headline_phrase', enabled: true, x: 164, y: snapY(16) },
            { id: 'student_name', enabled: true, x: 24, y: snapY(80) },
            { id: 'class_name', enabled: true, x: 24, y: snapY(144) },
            { id: 'progress_date', enabled: true, x: 24, y: snapY(208) },
            { id: 'assignment_title', enabled: true, x: 24, y: snapY(272) },
            { id: 'due_date', enabled: true, x: 24, y: snapY(336) },
            { id: 'completion_progress', enabled: true, x: 300, y: snapY(336) },
            { id: 'task_list', enabled: true, x: 24, y: snapY(400) },
            { id: 'kind_badge', enabled: true, x: 24, y: snapY(464) },
            { id: 'notify_time', enabled: true, x: 24, y: snapY(464) }
        ];
    }

    function defaultLayout() {
        return {
            version: 1,
            canvas: { width: CANVAS_W, height: CANVAS_H },
            fields: defaultFields()
        };
    }

    function parseRaw(raw) {
        if (typeof raw === 'string') {
            try { return JSON.parse(raw); } catch (_e) { return {}; }
        }
        return raw || {};
    }

    function normalizeLayout(input) {
        var base = defaultLayout();
        if (!input || typeof input !== 'object') return base;

        var canvasH = (input.canvas && input.canvas.height) || CANVAS_H;
        var canvasW = (input.canvas && input.canvas.width) || CANVAS_W;
        var byId = {};
        (Array.isArray(input.fields) ? input.fields : []).forEach(function (f) {
            if (!f || !f.id) return;
            byId[f.id] = {
                id: f.id,
                enabled: f.enabled !== false,
                x: Math.max(0, Number(f.x) || 0),
                y: snapY(f.y, canvasH),
                w: (Number(f.w) > 0) ? Number(f.w) : undefined
            };
        });

        // 舊版單一 headline → 拆成標籤＋用語（同列左右）
        if (byId.headline && !byId.headline_label && !byId.headline_phrase) {
            var old = byId.headline;
            byId.headline_label = { id: 'headline_label', enabled: old.enabled, x: old.x, y: snapY(old.y, canvasH) };
            byId.headline_phrase = {
                id: 'headline_phrase',
                enabled: old.enabled,
                x: Math.min(old.x + 176, canvasW - 140),
                y: snapY(old.y, canvasH)
            };
        }

        var fields = FIELD_DEFS.map(function (def, idx) {
            if (byId[def.id]) return byId[def.id];
            // 新欄位：圖示預設關閉，其餘預設開啟（老師可從左側加入）
            var on = def.defaultOn !== false;
            return { id: def.id, enabled: on, x: 24, y: snapY(ROW_TOP + idx * ROW_H, canvasH) };
        });

        return {
            version: 1,
            canvas: {
                width: canvasW,
                height: canvasH
            },
            fields: fields
        };
    }

    function fromClassRaw(classRaw) {
        var raw = parseRaw(classRaw);
        return normalizeLayout(raw.message_layout);
    }

    function fieldDef(id) {
        for (var i = 0; i < FIELD_DEFS.length; i++) {
            if (FIELD_DEFS[i].id === id) return FIELD_DEFS[i];
        }
        return null;
    }

    function enabledFields(layout, surface) {
        var norm = normalizeLayout(layout);
        return norm.fields.filter(function (f) {
            if (!f.enabled) return false;
            var def = fieldDef(f.id);
            if (!def) return false;
            if (surface && def.surfaces.indexOf(surface) === -1) return false;
            return true;
        });
    }

    /** 啟用欄位，依畫布 y→x 扁平排序（相容舊呼叫） */
    function orderedEnabledIds(layout, surface) {
        var list = enabledFields(layout, surface).slice();
        list.sort(function (a, b) {
            if (a.y !== b.y) return a.y - b.y;
            return a.x - b.x;
        });
        return list.map(function (f) { return f.id; });
    }

    /**
     * 依畫布座標分列：y 接近＝同列，列內依 x 左→右
     * @returns {{ ids: string[], items: {id,x,y}[], anchorY: number }[]}
     */
    function layoutRows(layout, surface, tolerance) {
        var tol = typeof tolerance === 'number' ? tolerance : ROW_Y_TOLERANCE;
        var list = enabledFields(layout, surface).slice();
        list.sort(function (a, b) {
            if (a.y !== b.y) return a.y - b.y;
            return a.x - b.x;
        });

        // 磁性列：同列索引（或 y 接近）才併列；上下不重疊
        var rows = [];
        list.forEach(function (f) {
            var last = rows.length ? rows[rows.length - 1] : null;
            var sameRow = last && (
                rowIndex(f.y) === rowIndex(last.anchorY)
                || Math.abs(f.y - last.anchorY) <= tol
            );
            if (sameRow) {
                last.items.push(f);
            } else {
                rows.push({ anchorY: f.y, items: [f] });
            }
        });

        return rows.map(function (row) {
            row.items.sort(function (a, b) { return a.x - b.x; });
            return {
                ids: row.items.map(function (f) { return f.id; }),
                items: row.items.map(function (f) {
                    return { id: f.id, x: f.x, y: f.y, w: f.w };
                }),
                anchorY: row.anchorY
            };
        });
    }

    /**
     * 只依相對位置組版：
     * - 同列方格重疊 → 接著顯示（無空白）
     * - 同列方格相連無重疊 → 中間 4 個空白
     * - 同列拉開／右靠 → 左右隔開
     * - 列與列依 y 差給間距
     */
    function composeRowsHtml(layout, surface, fieldHtmlById) {
        var norm = normalizeLayout(layout);
        var canvasW = (norm.canvas && norm.canvas.width) || CANVAS_W;
        var rows = layoutRows(layout, surface);
        var html = '';
        var prevY = null;

        rows.forEach(function (row) {
            var parts = [];
            row.items.forEach(function (item) {
                var chunk = fieldHtmlById && fieldHtmlById[item.id];
                if (chunk) {
                    parts.push({
                        html: chunk,
                        x: item.x,
                        w: item.w,
                        rightAlign: isRightAnchored(item.x, canvasW, item.w)
                    });
                }
            });
            if (!parts.length) return;

            var marginTop = 4;
            if (prevY != null) {
                var dy = row.anchorY - prevY;
                if (dy > 90) marginTop = 16;
                else if (dy > 60) marginTop = 10;
            }
            prevY = row.anchorY;

            // 依間隙分群：重疊或相連 → 同一串；拉開 → 下一群
            // 右靠欄位永不與左欄合併（否則整列會被 flex-end 推到右邊）
            var clusters = [];
            parts.forEach(function (p) {
                var last = clusters.length ? clusters[clusters.length - 1] : null;
                if (!last) {
                    clusters.push({ items: [p] });
                    return;
                }
                var prev = last.items[last.items.length - 1];
                if (!!p.rightAlign !== !!prev.rightAlign) {
                    clusters.push({ items: [p] });
                    return;
                }
                var gap = chipGap(prev.x, p.x, prev.w);
                if (gap <= ADJACENT_GAP_MAX) {
                    last.items.push(p);
                } else {
                    clusters.push({ items: [p] });
                }
            });

            function renderCluster(cluster) {
                var items = cluster.items;
                if (items.length === 1) {
                    return items[0].html;
                }
                var out = '';
                items.forEach(function (item, idx) {
                    if (idx > 0) {
                        var prev = items[idx - 1];
                        var gap = chipGap(prev.x, item.x, prev.w);
                        // 重疊：無空白；相連無重疊：4 空白
                        if (gap < 0) {
                            out += '';
                        } else {
                            out += '<span style="white-space:pre;">' + JOIN_SPACES + '</span>';
                        }
                    }
                    out += asInlineChunk(item.html);
                });
                return out;
            }

            function clusterIsRight(cluster) {
                return cluster.items.length > 0 && cluster.items.every(function (p) { return p.rightAlign; });
            }

            if (clusters.length === 1 && clusters[0].items.length === 1) {
                var one = clusters[0].items[0];
                var oneAlign = one.rightAlign
                    ? 'display:flex;justify-content:flex-end;text-align:right;margin-top:' + marginTop + 'px;'
                    : 'margin-top:' + marginTop + 'px;';
                html += '<div class="ml-layout-row" style="' + oneAlign + '">' + one.html + '</div>';
                return;
            }

            if (clusters.length === 1) {
                var only = clusters[0];
                // 只有「整群都是右靠」才右推；混有左欄時維持靠左串接
                var cAlign = clusterIsRight(only)
                    ? 'display:flex;justify-content:flex-end;align-items:baseline;flex-wrap:wrap;margin-top:' + marginTop + 'px;'
                    : 'margin-top:' + marginTop + 'px;';
                html += '<div class="ml-layout-row" style="' + cAlign + '">' + renderCluster(only) + '</div>';
                return;
            }

            // 多群：有右靠群 → 左右撐開；否則全部靠左
            var anyRight = clusters.some(clusterIsRight);
            var rowStyle = anyRight
                ? 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:' + marginTop + 'px;'
                : 'display:flex;justify-content:flex-start;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:' + marginTop + 'px;';
            html += '<div class="ml-layout-row" style="' + rowStyle + '">';
            clusters.forEach(function (cluster) {
                var rightish = clusterIsRight(cluster);
                var cell = rightish
                    ? 'flex:0 1 auto;margin-left:auto;text-align:right;'
                    : 'flex:0 1 auto;';
                html += '<div class="ml-layout-cell" style="' + cell + '">' + renderCluster(cluster) + '</div>';
            });
            html += '</div>';
        });
        return html;
    }

    /** 預覽文字：列用 [A | B]，列與列用 → */
    function previewRowsLabel(layout, surface) {
        var rows = layoutRows(layout, surface);
        if (!rows.length) return '';
        return rows.map(function (row, i) {
            var labels = row.ids.map(function (id) {
                var def = fieldDef(id);
                return def ? def.label : id;
            });
            var cell = labels.length > 1 ? ('[' + labels.join(' | ') + ']') : labels[0];
            return (i + 1) + '. ' + cell;
        }).join(' → ');
    }

    function isEnabled(layout, fieldId) {
        var norm = normalizeLayout(layout);
        for (var i = 0; i < norm.fields.length; i++) {
            if (norm.fields[i].id === fieldId) return !!norm.fields[i].enabled;
        }
        return true;
    }

    return {
        FIELD_DEFS: FIELD_DEFS,
        CANVAS_W: CANVAS_W,
        CANVAS_H: CANVAS_H,
        ROW_TOP: ROW_TOP,
        ROW_H: ROW_H,
        CHIP_MIN_W: CHIP_MIN_W,
        CHIP_MAX_W: CHIP_MAX_W,
        CHIP_FALLBACK_W: CHIP_FALLBACK_W,
        ROW_Y_TOLERANCE: ROW_Y_TOLERANCE,
        LEFT_EDGE_SLACK: LEFT_EDGE_SLACK,
        RIGHT_EDGE_SLACK: RIGHT_EDGE_SLACK,
        defaultLayout: defaultLayout,
        normalizeLayout: normalizeLayout,
        fromClassRaw: fromClassRaw,
        fieldDef: fieldDef,
        orderedEnabledIds: orderedEnabledIds,
        layoutRows: layoutRows,
        composeRowsHtml: composeRowsHtml,
        previewRowsLabel: previewRowsLabel,
        isEnabled: isEnabled,
        isLeftAnchored: isLeftAnchored,
        isRightAnchored: isRightAnchored,
        snapY: snapY,
        rowIndex: rowIndex,
        iconHeartHtml: iconHeartHtml,
        iconHeartsHtml: iconHeartsHtml
    };
})();

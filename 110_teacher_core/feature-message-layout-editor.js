/**
 * 📂 110_teacher_core/feature-message-layout-editor.js
 * 老師端：欄位編排（磁性列畫布＝相對位置意圖，非繪圖／圖層）
 */
window.FeatureMessageLayoutEditor = (function () {
    'use strict';

    var MODAL_ID = 'message-layout-editor-modal';
    var editingClassId = null;
    var working = null;
    var baselineJson = '';
    var dragState = null;
    var docListenersBound = false;

    function T() {
        return window.MessageLayoutTemplate;
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getClass(classId) {
        var db = window.TeacherDB;
        if (!db || !Array.isArray(db.classes)) return null;
        return db.classes.find(function (c) { return String(c.id) === String(classId); }) || null;
    }

    function isDirty() {
        if (!working || !window.MessageLayoutTemplate) return false;
        return JSON.stringify(T().normalizeLayout(working)) !== baselineJson;
    }

    function close() {
        if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
        else {
            var el = document.getElementById(MODAL_ID);
            if (el) el.remove();
        }
        editingClassId = null;
        working = null;
        baselineJson = '';
        dragState = null;
    }

    function buildChipHtml(field, def) {
        return ''
            + '<div class="ml-chip" data-field-id="' + escapeHtml(field.id) + '" '
            + 'style="position:absolute;left:' + field.x + 'px;top:' + field.y + 'px;'
            + 'min-width:140px;max-width:220px;padding:10px 12px;border-radius:10px;'
            + 'background:#EEF2FF;border:2px solid #6366F1;color:#312E81;font-weight:800;'
            + 'font-size:0.9rem;cursor:grab;user-select:none;box-shadow:0 4px 12px rgba(79,70,229,0.15);'
            + 'z-index:2;touch-action:none;">'
            + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">'
            + '<div>'
            + '<div>' + escapeHtml(def ? def.label : field.id) + '</div>'
            + '<div style="font-size:0.72rem;font-weight:700;color:#6366F1;margin-top:2px;">'
            + (def && def.hint ? escapeHtml(def.hint) : '') + '</div>'
            + '</div>'
            + '<button type="button" class="ml-chip-remove" data-field-id="' + escapeHtml(field.id) + '" '
            + 'title="移出編排（關閉此欄）" '
            + 'style="border:none;background:#EEF2FF;color:#7C3AED;font-weight:900;cursor:pointer;padding:0 4px;">✕</button>'
            + '</div></div>';
    }

    function buildPaletteHtml() {
        var Tpl = T();
        var enabled = {};
        working.fields.forEach(function (f) { if (f.enabled) enabled[f.id] = true; });

        var html = '';
        Tpl.FIELD_DEFS.forEach(function (def) {
            if (enabled[def.id]) return;
            html += ''
                + '<button type="button" class="ml-palette-item" data-field-id="' + escapeHtml(def.id) + '" '
                + 'style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 12px;'
                + 'border-radius:8px;border:1px dashed #94A3B8;background:#F8FAFC;color:#334155;'
                + 'font-weight:800;font-size:0.9rem;cursor:pointer;">'
                + '＋ ' + escapeHtml(def.label)
                + '<div style="font-size:0.75rem;color:#64748B;font-weight:600;margin-top:2px;">'
                + escapeHtml(def.hint || '') + '</div>'
                + '</button>';
        });
        if (!html) {
            html = '<div style="color:#94A3B8;font-weight:700;font-size:0.9rem;padding:8px 0;">所有欄位都已在編排上</div>';
        }
        return html;
    }

    function buildRowGuidesHtml(Tpl) {
        var h = working.canvas.height;
        var rowH = Tpl.ROW_H || 64;
        var top = typeof Tpl.ROW_TOP === 'number' ? Tpl.ROW_TOP : 16;
        var html = '';
        var y = top;
        var i = 0;
        while (y + 40 <= h) {
            html += ''
                + '<div class="ml-row-guide" aria-hidden="true" style="position:absolute;left:8px;right:8px;top:'
                + y + 'px;height:' + (rowH - 8) + 'px;border-radius:8px;'
                + 'border:1px dashed ' + (i % 2 === 0 ? '#C7D2FE' : '#E0E7FF') + ';'
                + 'background:' + (i % 2 === 0 ? 'rgba(99,102,241,0.04)' : 'transparent') + ';'
                + 'pointer-events:none;z-index:0;"></div>';
            y += rowH;
            i += 1;
        }
        return html;
    }

    function renderEditorBody() {
        var Tpl = T();
        var chips = '';
        working.fields.forEach(function (f) {
            if (!f.enabled) return;
            chips += buildChipHtml(f, Tpl.fieldDef(f.id));
        });

        var orderPreview = Tpl.previewRowsLabel(working) || '（尚未選擇任何欄位）';

        return ''
            + '<div style="background:white;border-radius:14px;width:min(960px,96vw);max-height:92vh;'
            + 'display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,0.25);overflow:hidden;">'
            + '<div style="padding:18px 20px;border-bottom:2px solid #F1F5F9;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">'
            + '<div>'
            + '<h3 style="margin:0;color:#1E293B;font-size:1.15rem;font-weight:900;">📬 提醒訊息欄位編排</h3>'
            + '<p style="margin:8px 0 0;color:#64748B;font-size:0.9rem;font-weight:600;line-height:1.5;">'
            + '這是<strong>磁性列編排</strong>（欄位取捨與左右相對位置），不是繪圖畫布；上下會吸附列線，不接受上下重疊。'
            + '同列：左／右貼邊靠齊；緊鄰→ 4 空白；重疊→ 接著顯示。'
            + '</p>'
            + '</div>'
            + '<button type="button" onclick="window.FeatureMessageLayoutEditor.close()" '
            + 'style="border:none;background:#F1F5F9;color:#475569;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:800;flex-shrink:0;">✕ 關閉</button>'
            + '</div>'
            + '<div style="display:flex;flex:1;min-height:0;">'
            + '<div style="width:220px;flex-shrink:0;border-right:1px solid #E2E8F0;padding:14px;overflow-y:auto;background:#F8FAFC;">'
            + '<div style="font-weight:900;color:#475569;margin-bottom:10px;font-size:0.9rem;">可用欄位</div>'
            + '<div id="ml-palette">' + buildPaletteHtml() + '</div>'
            + '<button type="button" id="ml-reset-btn" style="margin-top:14px;width:100%;padding:8px;border-radius:8px;'
            + 'border:1px solid #CBD5E1;background:white;color:#475569;font-weight:800;cursor:pointer;">回復預設</button>'
            + '</div>'
            + '<div style="flex:1;padding:16px;overflow:auto;background:#EEF2FF;">'
            + '<div id="ml-canvas" style="position:relative;width:' + working.canvas.width + 'px;height:' + working.canvas.height + 'px;'
            + 'margin:0 auto;background:linear-gradient(#fff,#F8FAFC);border:2px dashed #A5B4FC;border-radius:12px;'
            + 'box-shadow:inset 0 0 0 1px #E0E7FF;">'
            + buildRowGuidesHtml(Tpl)
            + chips
            + '</div>'
            + '<div style="max-width:' + working.canvas.width + 'px;margin:12px auto 0;padding:10px 12px;'
            + 'background:white;border-radius:8px;border:1px solid #E2E8F0;font-size:0.85rem;color:#475569;font-weight:700;line-height:1.5;">'
            + '<span style="color:#6366F1;">列序參考（非最終畫面）：</span> '
            + orderPreview
            + '</div>'
            + '</div>'
            + '</div>'
            + '<div style="padding:14px 20px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:10px;background:white;">'
            + '<button type="button" onclick="window.FeatureMessageLayoutEditor.close()" '
            + 'style="border:none;background:#F1F5F9;color:#475569;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:800;">取消</button>'
            + '<button type="button" id="ml-save-btn" '
            + 'style="border:none;background:#4F46E5;color:white;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:800;">💾 儲存版面</button>'
            + '</div>'
            + '</div>';
    }

    function refresh() {
        var overlay = document.getElementById(MODAL_ID);
        if (!overlay || !working) return;
        overlay.innerHTML = renderEditorBody();
        bindUi();
    }

    function findField(id) {
        for (var i = 0; i < working.fields.length; i++) {
            if (working.fields[i].id === id) return working.fields[i];
        }
        return null;
    }

    function nextFreeRowY() {
        var Tpl = T();
        var used = {};
        working.fields.forEach(function (x) {
            if (!x.enabled) return;
            used[Tpl.rowIndex(x.y)] = true;
        });
        var top = typeof Tpl.ROW_TOP === 'number' ? Tpl.ROW_TOP : 16;
        var rowH = Tpl.ROW_H || 64;
        var maxRow = Math.max(0, Math.floor((working.canvas.height - top - 40) / rowH));
        var i;
        for (i = 0; i <= maxRow; i++) {
            if (!used[i]) return Tpl.snapY(top + i * rowH, working.canvas.height);
        }
        return Tpl.snapY(top + maxRow * rowH, working.canvas.height);
    }

    function addFieldToCanvas(fieldId) {
        var f = findField(fieldId);
        if (!f) return;
        f.enabled = true;
        f.x = 24;
        f.y = nextFreeRowY();
        refresh();
    }

    function removeField(fieldId) {
        var f = findField(fieldId);
        if (!f) return;
        f.enabled = false;
        refresh();
    }

    function onPointerDown(e) {
        var chip = e.target.closest ? e.target.closest('.ml-chip') : null;
        if (!chip) return;
        if (e.target.closest && e.target.closest('.ml-chip-remove')) return;
        var id = chip.getAttribute('data-field-id');
        var f = findField(id);
        if (!f) return;
        var canvas = document.getElementById('ml-canvas');
        if (!canvas) return;
        var rect = canvas.getBoundingClientRect();
        dragState = {
            id: id,
            ox: e.clientX - rect.left - f.x,
            oy: e.clientY - rect.top - f.y
        };
        chip.style.cursor = 'grabbing';
        e.preventDefault();
    }

    function syncChipWidths() {
        var canvas = document.getElementById('ml-canvas');
        if (!canvas || !working) return;
        canvas.querySelectorAll('.ml-chip[data-field-id]').forEach(function (chip) {
            var f = findField(chip.getAttribute('data-field-id'));
            if (!f) return;
            f.w = Math.round(chip.offsetWidth) || f.w;
        });
    }

    function onPointerMove(e) {
        if (!dragState || !working) return;
        var canvas = document.getElementById('ml-canvas');
        var chip = canvas && canvas.querySelector('.ml-chip[data-field-id="' + dragState.id + '"]');
        var f = findField(dragState.id);
        var Tpl = T();
        if (!canvas || !chip || !f || !Tpl) return;
        var rect = canvas.getBoundingClientRect();
        var chipW = chip.offsetWidth || 140;
        var x = e.clientX - rect.left - dragState.ox;
        var y = e.clientY - rect.top - dragState.oy;
        x = Math.max(0, Math.min(x, working.canvas.width - chipW));
        y = Math.max(0, Math.min(y, working.canvas.height - 48));
        f.x = Math.round(x);
        f.y = Tpl.snapY(y, working.canvas.height);
        f.w = Math.round(chipW);
        chip.style.left = f.x + 'px';
        chip.style.top = f.y + 'px';
    }

    function onPointerUp() {
        if (!dragState || !working) return;
        var f = findField(dragState.id);
        var Tpl = T();
        if (f && Tpl) f.y = Tpl.snapY(f.y, working.canvas.height);
        dragState = null;
        syncChipWidths();
        refresh();
    }

    function ensureDocListeners() {
        if (docListenersBound) return;
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        docListenersBound = true;
    }

    function bindUi() {
        ensureDocListeners();
        var palette = document.getElementById('ml-palette');
        if (palette) {
            palette.querySelectorAll('.ml-palette-item').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    addFieldToCanvas(btn.getAttribute('data-field-id'));
                });
            });
        }
        var canvas = document.getElementById('ml-canvas');
        if (canvas) {
            canvas.querySelectorAll('.ml-chip-remove').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    removeField(btn.getAttribute('data-field-id'));
                });
            });
            canvas.addEventListener('pointerdown', onPointerDown);
        }

        var resetBtn = document.getElementById('ml-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async function () {
                if (!(await window.ModalOverlay.confirm('回復系統預設欄位與排列？'))) return;
                working = T().defaultLayout();
                refresh();
            });
        }
        var saveBtn = document.getElementById('ml-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () { saveToClass(); });
        }
        // 等版面畫完再量實際方格寬（供相連／重疊判斷）
        setTimeout(syncChipWidths, 0);
    }

    async function saveToClass() {
        if (!editingClassId || !working) return;
        var cls = getClass(editingClassId);
        if (!cls) {
            if (window.showFlash) window.showFlash('找不到班級', 'error');
            return;
        }
        var btn = document.getElementById('ml-save-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 儲存中…'; }

        try {
            syncChipWidths();
            var raw = cls.raw_data || cls.rawData || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
            }
            var layout = T().normalizeLayout(working);
            var merged = Object.assign({}, raw, { message_layout: layout });
            var { error } = await window.supabaseClient
                .from('classes')
                .update({ raw_data: merged })
                .eq('id', editingClassId);
            if (error) throw error;

            cls.raw_data = merged;
            cls.rawData = merged;
            baselineJson = JSON.stringify(layout);
            if (window.showFlash) window.showFlash('訊息欄位版面已儲存', 'success');
            close();
        } catch (err) {
            if (window.showFlash) window.showFlash('儲存失敗：' + (err.message || err), 'error');
            if (btn) { btn.disabled = false; btn.textContent = '💾 儲存版面'; }
        }
    }

    function open(classId) {
        if (!T()) {
            if (window.showFlash) window.showFlash('MessageLayoutTemplate 未載入', 'error');
            return;
        }
        var cls = getClass(classId);
        if (!cls) {
            if (window.showFlash) window.showFlash('找不到班級', 'error');
            return;
        }
        if (!window.ModalOverlay) {
            if (window.showFlash) window.showFlash('ModalOverlay 未載入', 'error');
            return;
        }

        editingClassId = classId;
        working = T().fromClassRaw(cls.raw_data || cls.rawData);
        baselineJson = JSON.stringify(T().normalizeLayout(working));

        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: 'B',
            replace: false,
            contentHtml: renderEditorBody(),
            isDirty: isDirty,
            unsavedMessage: '欄位編排尚未儲存，確定關閉？',
            onClose: function () {
                editingClassId = null;
                working = null;
                baselineJson = '';
                dragState = null;
            }
        });
        bindUi();
    }

    return {
        open: open,
        close: close
    };
})();

/**
 * 📂 檔案路徑：110_teacher_core/feature-exam-template-editor.js
 * 🎯 職責：「📚 範本庫」的試卷角色編輯器 UI——顯示所有勾了 is_exam_role 的範本。
 *
 * 2026-08-14（範本庫合併）：擷取範本跟考卷範本原本是兩張表（material_extraction_templates／
 * material_exam_templates），現在合併成一張 material_templates（見
 * 110_teacher_core/feature-template-library.js），用 is_extraction_role／is_exam_role 兩個
 * 角色勾選框取代。這個檔案只是「範本庫」畫面裡專門顯示試卷角色的那一個區塊——同一筆範本若
 * 同時也勾了擷取角色（雙用），清單會標「🧩 雙用」，實際欄位對應要到上面「擷取範本」清單編輯，
 * 這裡只管考題呈現公式（fields／fields_answer／quiz_prompt／quiz_answer／lines_per_page）。
 *
 * 公式語言沿用既有 020_js_core/layout-fields-eval.js（STACK／FONTSIZE／TEXTJOIN／&／
 * 直接寫 semantic_key），不是新引擎，只是把公式存的位置從程式碼常數變成這張表。
 *
 * CRUD 委派給 feature-exam-job.js（fetchExamTemplates／createExamTemplate／
 * updateExamTemplate／deleteExamTemplate，內部再委派給 FeatureTemplateLibrary），這裡只負責畫面。
 */
window.FeatureExamTemplateEditor = (function () {
    'use strict';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    const DEFAULT_LINES_PER_PAGE = 10;

    /** 表單目前草稿狀態：null＝表單收起；否則 { id: null|string, name, fields, fields_answer, quiz_prompt, quiz_answer, lines_per_page } */
    let _draft = null;

    function fej() { return window.FeatureExamJob; }

    function templateUsageHtml(t) {
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderTemplateUsageHtml === 'function') {
            return window.FeatureClassMaterialCombinations.renderTemplateUsageHtml(t && t.id, { lead: 'exam' });
        }
        return '<div style="font-size:0.74rem; color:#047857; font-weight:700; margin-top:2px;">實際使用：</div>'
            + '<div style="font-size:0.74rem; color:#047857; font-weight:700;">尚未套用到任何教材／班級</div>';
    }

    function blankDraft() {
        return { id: null, name: '', fields: '', fields_answer: '', quiz_prompt: '', quiz_answer: '', lines_per_page: DEFAULT_LINES_PER_PAGE, isExtractionRole: false };
    }

    /** 給其他頁面（例如「🏫 班級教材組合」Step 2）呼叫的捷徑：直接開一個新增表單 */
    function openNewForm() {
        _draft = blankDraft();
        render();
    }

    function openEditForm(template) {
        _draft = {
            id: template.id,
            name: template.name || '',
            fields: template.fields || '',
            fields_answer: template.fields_answer || '',
            quiz_prompt: template.quiz_prompt || '',
            quiz_answer: template.quiz_answer || '',
            lines_per_page: template.lines_per_page || DEFAULT_LINES_PER_PAGE,
            // 2026-08-14（老師回報）：雙用範本（同時也勾了擷取角色）的每頁行數只在「擷取範本」那一側
            // 編輯，這裡唯讀顯示同一個值，不要另外開一個輸入框（同一個欄位，不是各自存一份）。
            isExtractionRole: !!template.is_extraction_role
        };
        render();
    }

    function closeForm() {
        _draft = null;
        render();
    }

    /**
     * 「從擷取範本開始」：借用 FeatureMaterialLayoutPairing.buildProfileFromTemplate() 的換算
     * 演算法，把一個擷取範本的欄位公式當草稿預填進來——存檔後這份考卷範本就完全獨立，
     * 跟原擷取範本沒有任何連動關係（不是 tpl: 引用，是複製一份公式起手）。
     */
    function prefillFromExtractionTemplate(extractionTemplateId) {
        const mlp = window.FeatureMaterialLayoutPairing;
        if (!mlp || typeof mlp.getFieldTemplatesCachedSync !== 'function' || typeof mlp.buildProfileFromTemplate !== 'function') return;
        const tpl = mlp.getFieldTemplatesCachedSync().find(function (t) { return t.id === extractionTemplateId; });
        if (!tpl) return;
        const profile = mlp.buildProfileFromTemplate(tpl);
        if (!profile) return;
        if (!_draft) _draft = blankDraft();
        _draft.name = _draft.name || ('由「' + (tpl.name || '擷取範本') + '」預填');
        _draft.fields = profile.fields || _draft.fields;
        _draft.fields_answer = profile.fields_answer || _draft.fields_answer;
        _draft.lines_per_page = profile.lines_per_page || _draft.lines_per_page;
        render();
    }

    function extractionTemplateOptionsHtml() {
        const mlp = window.FeatureMaterialLayoutPairing;
        const list = (mlp && typeof mlp.getFieldTemplatesCachedSync === 'function') ? mlp.getFieldTemplatesCachedSync() : [];
        if (!list.length) return '<option value="">（目前沒有任何擷取範本）</option>';
        return '<option value="">請選擇要借用的擷取範本…</option>'
            + list.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name || '（未命名）') + '</option>'; }).join('');
    }

    function formHtml() {
        if (!_draft) return '';
        const isEdit = !!_draft.id;
        return `
            <div id="exam-tpl-editor-form" style="background:#F8FAFC; border:1px dashed #A5B4FC; border-radius:8px; padding:14px; margin:10px 0;">
                <h4 style="margin:0 0 8px 0; color:#4338CA;">${isEdit ? '✏️ 編輯考卷範本' : '➕ 新增考卷範本'}</h4>

                <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
                    <span style="font-size:0.78rem; color:#6D28D9; font-weight:800;">🧩 從擷取範本開始（選填，只借用公式，存檔後不連動）：</span>
                    <select id="exam-tpl-prefill-select" class="form-control" style="width:220px; padding:5px; font-size:0.78rem;">${extractionTemplateOptionsHtml()}</select>
                    <button type="button" id="exam-tpl-prefill-btn" class="btn" style="padding:4px 10px; font-size:0.76rem; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">套用預填</button>
                </div>

                <div class="form-group" style="margin-bottom:8px;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;">範本名稱</label>
                    <input type="text" id="exam-tpl-name" class="form-control" value="${esc(_draft.name)}" placeholder="例如「整句翻譯（四欄）」" style="padding:6px;">
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div class="form-group">
                        <label style="font-size:0.78rem; font-weight:800; color:#475569;">題目排版（呈現公式）</label>
                        <textarea id="exam-tpl-fields" class="form-control" rows="3" style="padding:6px; font-family:monospace; font-size:0.8rem;" placeholder="STACK(display_zh, display_en), FONTSIZE(display_en,-1)">${esc(_draft.fields)}</textarea>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.78rem; font-weight:800; color:#475569;">答案排版（呈現公式）</label>
                        <textarea id="exam-tpl-fields-answer" class="form-control" rows="3" style="padding:6px; font-family:monospace; font-size:0.8rem;" placeholder="TEXTJOIN(&quot; / &quot;, answer_zh)">${esc(_draft.fields_answer)}</textarea>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.78rem; font-weight:800; color:#475569;">quiz_prompt（選填，考卷版另外的題目公式）</label>
                        <textarea id="exam-tpl-quiz-prompt" class="form-control" rows="2" style="padding:6px; font-family:monospace; font-size:0.8rem;">${esc(_draft.quiz_prompt)}</textarea>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.78rem; font-weight:800; color:#475569;">quiz_answer（選填，考卷版另外的答案公式）</label>
                        <textarea id="exam-tpl-quiz-answer" class="form-control" rows="2" style="padding:6px; font-family:monospace; font-size:0.8rem;">${esc(_draft.quiz_answer)}</textarea>
                    </div>
                </div>
                <div class="form-group" style="margin-top:8px; max-width:260px;">
                    <label style="font-size:0.78rem; font-weight:800; color:#475569;">每頁行數（只影響輸出紙本考卷，線上考試不受影響）</label>
                    ${_draft.isExtractionRole
                        ? '<div style="font-size:0.82rem; font-weight:700; color:#94A3B8; padding:6px 0;">' + esc(_draft.lines_per_page) + '（雙用範本：繼承自「擷取範本」清單裡的設定，請到那邊「✏️ 編輯」調整）</div>'
                        : '<input type="number" id="exam-tpl-lpp" class="form-control" value="' + esc(_draft.lines_per_page) + '" style="padding:6px;">'}
                </div>

                <div style="margin-top:10px; display:flex; align-items:center; gap:8px;">
                    <button type="button" id="exam-tpl-save-btn" class="btn btn-primary" style="padding:6px 16px; font-weight:800;">💾 儲存</button>
                    <button type="button" id="exam-tpl-cancel-btn" class="btn" style="padding:6px 14px;">取消</button>
                    <span id="exam-tpl-form-msg" style="font-size:0.78rem; font-weight:700;"></span>
                </div>
            </div>
        `;
    }

    function templateRowHtml(t, idx, total) {
        const fieldsPreview = String(t.fields || '').slice(0, 60) + (String(t.fields || '').length > 60 ? '…' : '');
        const dualBadge = t.is_extraction_role
            ? ' <span style="padding:1px 7px; font-size:0.68rem; font-weight:800; border-radius:10px; background:#EDE9FE; color:#6D28D9;">🧩 雙用（也是擷取範本）</span>'
            : '';
        const moveBtnStyle = 'padding:0 5px; font-size:0.7rem; line-height:1.3; border:1px solid #CBD5E1; border-radius:3px; background:white; color:#475569; cursor:pointer;';
        const moveBtnsHtml = '<div style="display:flex; flex-direction:column; gap:2px; flex-shrink:0;">'
            + '<button type="button" class="exam-tpl-move-up-btn" data-id="' + esc(t.id) + '" style="' + moveBtnStyle + '"' + (idx === 0 ? ' disabled' : '') + ' title="往上移">▲</button>'
            + '<button type="button" class="exam-tpl-move-down-btn" data-id="' + esc(t.id) + '" style="' + moveBtnStyle + '"' + (idx === total - 1 ? ' disabled' : '') + ' title="往下移">▼</button>'
            + '</div>';
        return `
            <div class="exam-tpl-row" data-id="${esc(t.id)}" style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:white; border:1px solid #E2E8F0; border-radius:8px; padding:8px 12px; margin-bottom:6px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                    ${moveBtnsHtml}
                    <div style="min-width:0; flex:1;">
                        <div style="font-weight:800; color:#334155; font-size:0.86rem;">🧾 ${esc(t.name)}${dualBadge}${t.is_builtin_seed ? ' <span style="color:#94A3B8; font-size:0.72rem; font-weight:600;">（原內建範本，可自由編輯）</span>' : ''}</div>
                        <div style="font-size:0.74rem; color:#64748B; font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(fieldsPreview)}｜每頁${esc(t.lines_per_page || DEFAULT_LINES_PER_PAGE)}行</div>
                        ${templateUsageHtml(t)}
                    </div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    <button type="button" class="exam-tpl-edit-btn btn" data-id="${esc(t.id)}" style="padding:3px 10px; font-size:0.76rem; background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; border-radius:6px;">✏️ 編輯</button>
                    <button type="button" class="exam-tpl-delete-btn btn" data-id="${esc(t.id)}" style="padding:3px 10px; font-size:0.76rem; background:#FEF2F2; color:#B91C1C; border:1px solid #FECACA; border-radius:6px;">🗑️ 刪除</button>
                </div>
            </div>
        `;
    }

    function bindEvents(wrap, templates) {
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.bindUsageSheetToggles === 'function') {
            window.FeatureClassMaterialCombinations.bindUsageSheetToggles(wrap);
        }
        const addBtn = wrap.querySelector('#exam-tpl-add-btn');
        if (addBtn) addBtn.addEventListener('click', openNewForm);

        wrap.querySelectorAll('.exam-tpl-move-up-btn, .exam-tpl-move-down-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const direction = btn.classList.contains('exam-tpl-move-up-btn') ? 'up' : 'down';
                btn.disabled = true;
                try {
                    await window.FeatureTemplateLibrary.moveTemplateInVisibleList(btn.getAttribute('data-id'), direction, templates || []);
                    render();
                } catch (err) {
                    window.alert('調整順序失敗：' + (err.message || err));
                    btn.disabled = false;
                }
            });
        });

        wrap.querySelectorAll('.exam-tpl-edit-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const list = (fej() && typeof fej().getExamTemplatesCachedSync === 'function') ? fej().getExamTemplatesCachedSync() : [];
                const t = list.find(function (x) { return x.id === btn.getAttribute('data-id'); });
                if (t) openEditForm(t);
            });
        });

        wrap.querySelectorAll('.exam-tpl-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                const id = btn.getAttribute('data-id');
                if (!window.confirm('確定要取消這筆的「試卷範本」角色嗎？\n\n已經用過這個範本出過的考卷不會受影響（仍能重新產生），但之後出題下拉不會再看到它。若這筆同時也是擷取範本（雙用），只會關掉試卷角色，擷取範本那一側資料不受影響。')) return;
                try {
                    await fej().deleteExamTemplate(id);
                    window.showFlash && window.showFlash('✅ 已刪除考卷範本', 'success');
                    render();
                } catch (err) {
                    console.error('[FeatureExamTemplateEditor] 刪除失敗', err);
                    window.showFlash && window.showFlash('❌ 刪除失敗：' + (err.message || err), 'error');
                }
            });
        });

        const form = wrap.querySelector('#exam-tpl-editor-form');
        if (!form) return;

        const prefillBtn = form.querySelector('#exam-tpl-prefill-btn');
        if (prefillBtn) {
            prefillBtn.addEventListener('click', function () {
                const sel = form.querySelector('#exam-tpl-prefill-select');
                if (sel && sel.value) prefillFromExtractionTemplate(sel.value);
            });
        }

        const cancelBtn = form.querySelector('#exam-tpl-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', closeForm);

        const saveBtn = form.querySelector('#exam-tpl-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async function () {
                const msgEl = form.querySelector('#exam-tpl-form-msg');
                const name = form.querySelector('#exam-tpl-name').value.trim();
                if (!name) {
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 請輸入範本名稱'; }
                    return;
                }
                const payload = {
                    name: name,
                    fields: form.querySelector('#exam-tpl-fields').value,
                    fields_answer: form.querySelector('#exam-tpl-fields-answer').value,
                    quiz_prompt: form.querySelector('#exam-tpl-quiz-prompt').value,
                    quiz_answer: form.querySelector('#exam-tpl-quiz-answer').value
                };
                // 雙用範本（也勾了擷取角色）沒有這個輸入框——每頁行數留給擷取範本那一側管，這裡不送出，
                // 不然會用畫面上沒改過的舊值把老師在擷取範本編輯器裡剛存的新值蓋掉。
                const lppEl = form.querySelector('#exam-tpl-lpp');
                if (lppEl) payload.lines_per_page = Number(lppEl.value) || DEFAULT_LINES_PER_PAGE;
                saveBtn.disabled = true;
                if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '⏳ 儲存中…'; }
                try {
                    if (_draft.id) {
                        await fej().updateExamTemplate(_draft.id, payload);
                    } else {
                        await fej().createExamTemplate(payload);
                    }
                    window.showFlash && window.showFlash('✅ 已儲存考卷範本', 'success');
                    _draft = null;
                    render();
                } catch (err) {
                    console.error('[FeatureExamTemplateEditor] 儲存失敗', err);
                    if (msgEl) { msgEl.style.color = '#EF4444'; msgEl.textContent = '❌ 儲存失敗：' + (err.message || err); }
                    saveBtn.disabled = false;
                }
            });
        }
    }

    function paint(wrap, templates) {
        wrap.innerHTML = `
            <div style="background:#F8FAFC; padding:20px; border-radius:12px; border:2px solid #CBD5E1; margin-top:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <h3 style="margin:0 0 4px 0; color:var(--primary-dark);">📚 範本庫 — 試卷範本：meta 怎麼呈現成一道考題</h3>
                        <p style="color:#64748B; font-size:0.8rem; margin:0;">這裡顯示「範本庫」裡勾了🧾試卷角色的範本；跟「擷取範本」（上面「📎 套用到教材」用的 Excel 欄位對應）是同一份資料表，角色可以只勾一邊，也可以兩邊都勾（雙用，見清單裡的「🧩 雙用」標籤，可以直接到上面擷取範本清單編輯）。公式決定出題畫面／線上卷怎麼把 meta.json 的一列排成一道題目，可以自建、編輯、刪除，不再是寫死的 6 個選項。</p>
                    </div>
                    <button type="button" id="exam-tpl-add-btn" class="btn btn-primary" style="padding:6px 14px; font-weight:800; white-space:nowrap;">➕ 新增考卷範本</button>
                </div>
                <div id="exam-tpl-form-slot">${formHtml()}</div>
                <div id="exam-tpl-list" style="margin-top:10px;">${templates.length ? templates.map(function (t, idx) { return templateRowHtml(t, idx, templates.length); }).join('') : '<div style="color:#94A3B8; font-size:0.8rem; padding:8px 0;">目前還沒有任何考卷範本，按上面「➕ 新增考卷範本」建立第一個。</div>'}</div>
            </div>
        `;
        bindEvents(wrap, templates);
    }

    function render() {
        const wrap = document.getElementById('exam-template-editor-container');
        if (!wrap) return;
        if (!fej() || typeof fej().fetchExamTemplates !== 'function') {
            wrap.innerHTML = '';
            return;
        }
        fej().fetchExamTemplates(false).then(function (templates) {
            paint(wrap, templates || []);
        }).catch(function (err) {
            console.error('[FeatureExamTemplateEditor] 載入失敗', err);
            wrap.innerHTML = '<div style="padding:16px; color:#EF4444; font-weight:800;">❌ 載入考卷範本失敗：' + esc(err.message || err) + '</div>';
        });
    }

    return {
        render: render,
        openNewForm: openNewForm
    };
})();

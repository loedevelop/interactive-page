/**
 * PDF 套餐：指名套用試卷範本，並為每一份 PDF 貼自己的 txt 答案。
 * 產生在教材範本管理獨立區塊；教材區窗口只顯示已套用的卡。
 * 不碰 Excel／JSON 套餐（ensureCombination／pickComboForCard／Excel 畫卡）。
 * combo_statistics 含三種套餐；PDF 列由 trigger 寫入，不准拿來走 Excel 畫卡。
 */
window.FeatureMaterialPdfExam = (function () {
    'use strict';

    var TPL_DETECT = {
        key: (window.PdfExamPaper && window.PdfExamPaper.TPL_ORDER_LTR_TTB) || 'detect-sections-student-locate',
        name: '左到右、上到下（預設）'
    };
    var PDF_EXAM_TEMPLATES = (window.PdfExamPaper && window.PdfExamPaper.PDF_EXAM_TEMPLATES)
        ? window.PdfExamPaper.PDF_EXAM_TEMPLATES
        : [TPL_DETECT];

    var _items = [];
    var _assigns = [];
    var _loaded = false;
    var _loadPromise = null;
    var _groupMemberTab = {};

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function templateName(key) {
        var hit = PDF_EXAM_TEMPLATES.filter(function (t) { return t.key === key; })[0];
        return hit ? hit.name : String(key || '');
    }

    function pdfFilesForFolder(folderName) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMaterialPdfOptions !== 'function') return [];
        var folderU = String(folderName || '').trim().toUpperCase();
        if (!folderU) return [];
        var seen = {};
        var out = [];
        (window.FeatureTimeline.getMaterialPdfOptions('', 'teacher') || []).forEach(function (o) {
            if (!o || String(o.folderName || '').trim().toUpperCase() !== folderU) return;
            var name = String(o.fileName || '').trim();
            var id = String(o.fileId || '').trim();
            if (!name || !id || seen[id]) return;
            seen[id] = true;
            out.push({ name: name, fileId: id, folderId: o.folderId || '' });
        });
        out.sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name), 'en', { numeric: true, sensitivity: 'base' });
        });
        return out;
    }

    async function getCurrentUserId() {
        if (!window.supabaseClient || !window.supabaseClient.auth) return null;
        if (typeof window.supabaseClient.auth.getSession === 'function') {
            var sess = await window.supabaseClient.auth.getSession();
            var session = sess && sess.data && sess.data.session;
            if (session && session.user && session.user.id) return session.user.id;
        }
        var res = await window.supabaseClient.auth.getUser();
        return res && res.data && res.data.user ? res.data.user.id : null;
    }

    function ensureLoaded() {
        if (_loaded) return Promise.resolve(_items);
        if (_loadPromise) return _loadPromise;
        _loadPromise = (async function () {
            var userId = await getCurrentUserId();
            if (!userId || !window.supabaseClient) {
                _items = [];
                _assigns = [];
                return _items;
            }
            var res = await window.supabaseClient
                .from('material_pdf_exam_items')
                .select('id, teacher_id, material_folder_id, folder_name, pdf_file_id, pdf_file_name, exam_template_key, is_group, label, answer_text_raw, parsed_bank, section_page_hints, split_review, updated_at')
                .eq('teacher_id', userId)
                .order('pdf_file_name', { ascending: true });
            if (res.error) throw res.error;
            _items = res.data || [];
            _items.forEach(function (it) {
                if (window.PdfExamPaper && typeof window.PdfExamPaper.repairStaleCommaSplits === 'function') {
                    window.PdfExamPaper.repairStaleCommaSplits(it);
                }
            });
            var ids = _items.map(function (it) { return it.id; });
            if (!ids.length) {
                _assigns = [];
            } else {
                var asg = await window.supabaseClient
                    .from('class_material_pdf_exam_items')
                    .select('id, class_id, pdf_exam_item_id')
                    .in('pdf_exam_item_id', ids);
                if (asg.error) throw asg.error;
                _assigns = asg.data || [];
            }
            _loaded = true;
            return _items;
        })().finally(function () { _loadPromise = null; });
        return _loadPromise;
    }

    function folderNames() {
        var seen = {};
        var out = [];
        _items.forEach(function (it) {
            var n = String((it && it.folder_name) || '').trim();
            var u = n.toUpperCase();
            if (!n || seen[u]) return;
            seen[u] = true;
            out.push(n);
        });
        return out;
    }

    function itemsForFolder(folderName) {
        var u = String(folderName || '').trim().toUpperCase();
        return _items.filter(function (it) {
            return String(it.folder_name || '').trim().toUpperCase() === u;
        });
    }

    function getItemById(id) {
        var want = String(id || '');
        return _items.filter(function (it) { return String(it.id) === want; })[0] || null;
    }

    function allClasses() {
        return (window.TeacherDB && window.TeacherDB.classes) || [];
    }

    function assignsForItem(itemId) {
        var id = String(itemId || '');
        return _assigns.filter(function (a) { return String(a.pdf_exam_item_id) === id; })
            .map(function (a) { return String(a.class_id); });
    }

    function comboLabelOf(item) {
        var named = String((item && item.label) || '').trim();
        if (named) return named;
        return String((item && item.pdf_file_name) || '').trim();
    }

    function isPdfCombo(combo) {
        return !!(combo && (combo.isPdf === true || combo.kind === 'pdf'));
    }

    function comboHasId(combo, comboId) {
        var want = String(comboId || '').trim();
        if (!combo || !want) return false;
        if (String(combo.id) === want) return true;
        return (combo.siblingIds || []).some(function (id) { return String(id) === want; });
    }

    function homeworkComboRecord(items) {
        var list = (items || []).filter(Boolean);
        var first = list[0];
        if (!first) return null;
        var named = comboLabelOf(first);
        var siblingIds = list.map(function (it) { return String(it.id); });
        return {
            id: String(first.id),
            siblingIds: siblingIds,
            label: named,
            combo_label: named,
            rawLabel: named,
            folderId: String(first.material_folder_id || ''),
            folderName: String(first.folder_name || ''),
            rootKind: 'teacher',
            sourceFile: String(first.pdf_file_name || ''),
            extractionTemplateId: '',
            extractionTemplateName: '',
            sheetStems: [],
            metaFiles: [],
            ownSheets: [],
            sheetAvailableByStem: {},
            examTemplateIds: [],
            examTemplateId: '',
            examTemplateKey: String(first.exam_template_key || ''),
            pdfFileId: String(first.pdf_file_id || ''),
            pdfFileName: String(first.pdf_file_name || ''),
            isGroup: list.length > 1 || first.is_group === true,
            isPdf: true,
            kind: 'pdf'
        };
    }

    function listAssignedForHomework(classId) {
        var cid = String(classId || '');
        if (!cid) return [];
        var assignedIds = {};
        _assigns.forEach(function (a) {
            if (String(a.class_id) === cid) assignedIds[String(a.pdf_exam_item_id)] = true;
        });
        var assigned = _items.filter(function (it) { return assignedIds[String(it.id)]; });
        var grouped = {};
        var singles = [];
        assigned.forEach(function (it) {
            if (it && it.is_group === true) {
                var gk = String(it.folder_name || '').trim().toUpperCase() + '|' + String(it.exam_template_key || '');
                if (!grouped[gk]) grouped[gk] = [];
                grouped[gk].push(it);
            } else {
                singles.push(it);
            }
        });
        var out = [];
        Object.keys(grouped).forEach(function (k) {
            var rec = homeworkComboRecord(grouped[k]);
            if (rec) out.push(rec);
        });
        singles.forEach(function (it) {
            var rec = homeworkComboRecord([it]);
            if (rec) out.push(rec);
        });
        out.sort(function (a, b) {
            return String(a.combo_label || '').localeCompare(String(b.combo_label || ''), 'zh-Hant');
        });
        return out;
    }

    function getAssignedById(classId, comboId) {
        var want = String(comboId || '').trim();
        if (!want) return null;
        return listAssignedForHomework(classId).filter(function (c) { return comboHasId(c, want); })[0] || null;
    }

    function classAssignSummary(assignedIds) {
        var ids = (assignedIds || []).map(String);
        var names = allClasses().filter(function (c) { return ids.indexOf(String(c.id)) !== -1; })
            .map(function (c) { return c.name || c.id; });
        if (!names.length) return '採用班級　尚未勾選';
        if (names.length <= 2) return '採用班級　' + names.join('、');
        return '採用班級　' + names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 班';
    }

    function classChecksHtml(assignedIds) {
        var assigned = (assignedIds || []).map(String);
        var classes = allClasses();
        if (!classes.length) return '<div style="color:#94A3B8; font-size:0.78rem;">目前沒有任何班級</div>';
        return classes.map(function (c) {
            var checked = assigned.indexOf(String(c.id)) !== -1;
            return '<label style="display:inline-flex; align-items:center; gap:4px; margin:2px 10px 2px 0; font-size:0.78rem; color:#334155;">'
                + '<input type="checkbox" class="mz-pdf-exam-class-cb" value="' + esc(c.id) + '"' + (checked ? ' checked' : '') + '>'
                + esc(c.name || c.id)
                + '</label>';
        }).join('');
    }

    function comboNameBlockHtml(item, assignedIds) {
        var named = comboLabelOf(item);
        var ids = assignedIds || assignsForItem(item && item.id);
        return (
            '<label style="display:block; font-weight:800; color:#92400E; margin:8px 0 2px;">PDF 套餐（出作業下拉會顯示這個）</label>'
            + '<input type="text" class="mz-pdf-exam-label" value="' + esc(named) + '" placeholder="例如 Quiz 考卷" style="width:100%; box-sizing:border-box; font-weight:800; color:#78350F; margin-bottom:8px; padding:8px 10px; font-size:1rem;">'
            + '<details class="mz-class-details" style="margin-top:8px;">'
            + '<summary style="font-weight:800; color:#15803D; cursor:pointer;">' + esc(classAssignSummary(ids)) + '</summary>'
            + '<div class="mz-pdf-exam-class-box" style="margin-top:6px;">' + classChecksHtml(ids) + '</div>'
            + '</details>'
        );
    }

    function itemFor(fileId, templateKey) {
        return _items.filter(function (it) {
            return String(it.pdf_file_id) === String(fileId)
                && String(it.exam_template_key) === String(templateKey);
        })[0] || null;
    }

    function templateSelectHtml(selectedKey) {
        var key = selectedKey || TPL_DETECT.key;
        return '<select class="mz-pdf-exam-tpl" style="min-width:240px; padding:6px 8px; font-weight:800;">'
            + PDF_EXAM_TEMPLATES.map(function (t) {
                return '<option value="' + esc(t.key) + '"' + (t.key === key ? ' selected' : '') + '>' + esc(t.name) + '</option>';
            }).join('')
            + '</select>';
    }

    function groupCheckboxHtml(checked) {
        return (
            '<label style="display:inline-flex; align-items:center; gap:5px; font-size:0.76rem; font-weight:800; color:#0F766E; cursor:pointer; white-space:nowrap;">'
            + '<input type="checkbox" class="mz-pdf-exam-group" ' + (checked ? 'checked' : '') + ' style="margin:0;">'
            + '群組</label>'
        );
    }

    function applyBarHtml() {
        return '<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + templateSelectHtml(TPL_DETECT.key)
            + groupCheckboxHtml(false)
            + '<button type="button" class="mz-pdf-exam-apply btn btn-primary" style="border-radius:6px; font-weight:800; cursor:pointer;">套用試卷範本</button>'
            + '<span class="mz-pdf-exam-apply-msg" style="font-weight:700;"></span>'
            + '</div>';
    }

    function splitReviewHtml(item) {
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.splitReviewPanelHtml !== 'function') return '';
        return window.PdfExamPaper.splitReviewPanelHtml(item && item.split_review, {
            locateBtnClass: 'mz-pdf-exam-locate',
            examTemplateKey: item && item.exam_template_key,
            bank: item && item.parsed_bank
        });
    }

    function bankPreviewHtml(item) {
        if (item && Array.isArray(item.parsed_bank) && window.PdfExamPaper && typeof window.PdfExamPaper.normalizeAllItemBlanks === 'function') {
            window.PdfExamPaper.normalizeAllItemBlanks(item.parsed_bank);
        }
        var bank = (item && Array.isArray(item.parsed_bank)) ? item.parsed_bank : [];
        if (!bank.length) {
            return '<div class="mz-pdf-exam-bank" style="font-weight:700; color:#0F766E;">尚未解析出題目。貼上 txt 後按「解析未確定的答案」。</div>';
        }
        var flagged = (item.split_review && item.split_review.flagged_keys) || {};
        var warnedSections = {};
        ((item.split_review && item.split_review.section_warnings) || []).forEach(function (w) {
            warnedSections[String(w.section || '')] = true;
        });
        ((item.split_review && item.split_review.missing_sections) || []).forEach(function (m) {
            if (m && m.section) warnedSections[String(m.section)] = true;
        });
        var groups = (window.PdfExamPaper && typeof window.PdfExamPaper.groupItemsBySectionWithMissing === 'function')
            ? window.PdfExamPaper.groupItemsBySectionWithMissing(bank, item.split_review && item.split_review.missing_sections)
            : (window.PdfExamPaper && typeof window.PdfExamPaper.groupItemsBySection === 'function')
                ? window.PdfExamPaper.groupItemsBySection(bank)
                : [{ section: '', items: bank }];
        var activeG = (window.PdfExamPaper && typeof window.PdfExamPaper.pickBankSection === 'function')
            ? window.PdfExamPaper.pickBankSection(groups, item._bankSection)
            : (groups[0] || null);
        if (activeG) item._bankSection = activeG.section || '';
        var g = activeG || { section: '', items: [] };
        var confirmed = window.PdfExamPaper && typeof window.PdfExamPaper.isSectionConfirmed === 'function'
            && window.PdfExamPaper.isSectionConfirmed(item.split_review, g.section);
        var secWarn = !confirmed && (!!warnedSections[g.section] || !!g.missing);
        var confirmBtn = (g.section && window.PdfExamPaper && typeof window.PdfExamPaper.sectionConfirmButtonHtml === 'function')
            ? window.PdfExamPaper.sectionConfirmButtonHtml(g.section, item.split_review, {
                btnClass: 'mz-pdf-exam-confirm',
                reparseClass: 'mz-pdf-exam-reparse'
            })
            : '';
        var lastShownGroup = null;
        var rowsHtml = (g.items || []).length
            ? g.items.map(function (bk) {
                var idx = bank.indexOf(bk);
                var flagReason = confirmed ? '' : (flagged[bk.key] || '');
                var isFlag = !!flagReason || secWarn;
                var groupHead = '';
                if (bk.group && bk.group !== lastShownGroup) {
                    groupHead = '<div style="font-size:0.75rem; font-weight:800; color:#0F766E; margin:8px 0 2px;">' + esc(bk.group) + '</div>';
                }
                lastShownGroup = bk.group || lastShownGroup;
                var sameGroup = g.items.filter(function (x) { return (x.group || '') === (bk.group || ''); });
                var posInGroup = sameGroup.indexOf(bk);
                var canUp = posInGroup > 0;
                var canDown = posInGroup < sameGroup.length - 1;
                var btnBase = 'padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:800; cursor:pointer; line-height:1.2; height:auto;';
                var btnOn = btnBase + ' border:1px solid #7DD3FC; background:#E0F2FE; color:#0369A1;';
                var btnOff = btnBase + ' border:1px solid #E2E8F0; background:#F1F5F9; color:#94A3B8; cursor:not-allowed;';
                var btnAdd = btnBase + ' border:1px solid #99F6E4; background:#CCFBF1; color:#0F766E;';
                var btnDel = btnBase + ' border:1px solid #FECACA; background:#FEF2F2; color:#B91C1C;';
                var suffix = (bk.part ? ('-' + bk.part) : '') + (bk.blank_index ? ('-' + bk.blank_index) : '');
                return groupHead
                    + '<div class="pdf-exam-bank-row" data-idx="' + idx + '" data-section="' + esc(g.section || '') + '" style="display:flex; gap:6px; align-items:center; padding:4px 0; border-bottom:1px solid ' + (isFlag ? '#FECACA' : '#CCFBF1') + '; background:' + (isFlag ? '#FEF2F2' : 'transparent') + ';"'
                    + (flagReason ? ' title="' + esc(flagReason) + '"' : '') + '>'
                    + '<span style="display:inline-flex; align-items:center; gap:2px; width:88px; flex-shrink:0; font-size:0.76rem; font-weight:800; color:' + (isFlag ? '#B91C1C' : '#0F766E') + ';">'
                    + (bk.group ? esc(bk.group) + '-' : '')
                    + '<input type="text" class="mz-pdf-exam-itemno" data-idx="' + idx + '" value="' + esc(bk.item_no || '') + '" title="題號，解析錯了可以直接改" style="width:2.2em; padding:2px 3px; font-size:0.76rem; font-weight:800; text-align:center; border:1px solid ' + (isFlag ? '#F87171' : '#99F6E4') + '; color:' + (isFlag ? '#B91C1C' : '#0F766E') + ';">'
                    + (suffix ? '<span>' + esc(suffix) + '</span>' : '')
                    + '</span>'
                    + '<input type="text" class="mz-pdf-exam-ans" data-idx="' + idx + '" value="' + esc(bk.answer_text) + '" placeholder="答案" style="flex:1; min-width:80px; padding:6px 8px; font-size:0.9rem; border:1px solid ' + (isFlag ? '#F87171' : '#99F6E4') + '; color:' + (isFlag ? '#B91C1C' : '#134E4A') + ';">'
                    + '<input type="text" class="mz-pdf-exam-acc" data-idx="' + idx + '" value="' + esc(window.PdfExamPaper.formatAcceptedAnswerList(bk.accepted_answers)) + '" title="' + esc(window.PdfExamPaper.formatAcceptedAnswerList(bk.accepted_answers)) + '" placeholder="其他可接受答案（用 || 分隔）" style="flex:1; min-width:90px; padding:6px 8px; font-size:0.9rem; border:1px solid ' + (isFlag ? '#F87171' : '#99F6E4') + ';">'
                    + '<span style="display:flex; gap:3px; flex-shrink:0; white-space:nowrap;">'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="up" data-idx="' + idx + '" title="上移" style="' + (canUp ? btnOn : btnOff) + '" ' + (canUp ? '' : 'disabled') + '>↑</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="down" data-idx="' + idx + '" title="下移" style="' + (canDown ? btnOn : btnOff) + '" ' + (canDown ? '' : 'disabled') + '>↓</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="ins-before" data-idx="' + idx + '" title="在上方加一筆" style="' + btnAdd + '">＋上</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="ins-after" data-idx="' + idx + '" title="在下方加一筆" style="' + btnAdd + '">＋下</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="del" data-idx="' + idx + '" title="刪除" style="' + btnDel + '">🗑</button>'
                    + '</span>'
                    + '</div>';
            }).join('')
            : '<div style="font-size:0.76rem; font-weight:700; color:' + (secWarn ? '#B91C1C' : '#0F766E') + '; padding:6px 0;">這一組在解答裡沒有列出來的題（沒有捨棄）。請核對原文，或改用老師定位。</div>';
        var tabs = (window.PdfExamPaper && typeof window.PdfExamPaper.bankSectionTabsHtml === 'function' && groups.length > 1)
            ? window.PdfExamPaper.bankSectionTabsHtml(groups, g.section, {
                tabClass: 'mz-pdf-exam-quiz-tab',
                review: item.split_review,
                warnedSections: warnedSections
            })
            : '';
        var secTitle = g.section
            ? '<div style="display:flex; align-items:center; flex-wrap:wrap; font-weight:800; color:' + (secWarn ? '#B91C1C' : '#0F766E') + '; font-size:0.8rem; margin:0 0 6px;">📘 ' + esc(g.section) + (secWarn ? ' ⚠' : '') + confirmBtn + '</div>'
            : '';
        var paperHtml = (window.PdfExamPaper && typeof window.PdfExamPaper.sectionPaperPreviewHtml === 'function')
            ? window.PdfExamPaper.sectionPaperPreviewHtml({ section: g.section })
            : '';
        return splitReviewHtml(item)
            + tabs
            + secTitle
            + '<div class="pdf-exam-bank-with-paper">'
            + paperHtml
            + '<div class="mz-pdf-exam-bank" style="border:1px solid #99F6E4; border-radius:6px; padding:10px; background:#F0FDFA;">'
            + rowsHtml
            + '</div>'
            + '</div>';
    }

    function appliedMemberHtml(item, opts) {
        opts = opts || {};
        var n = (item.parsed_bank || []).length;
        var head = opts.insideGroup
            ? '<div style="font-weight:800; color:#134E4A;">📄 ' + esc(item.pdf_file_name || item.pdf_file_id) + '</div>'
            : ('<div style="font-weight:800; color:#134E4A;">📄 ' + esc(item.pdf_file_name || item.pdf_file_id) + '</div>'
                + '<div style="font-weight:700; color:#0F766E; margin:4px 0 8px;">試卷範本　' + esc(templateName(item.exam_template_key)) + '</div>');
        var vis = opts.hidden ? 'display:none;' : '';
        return (
            '<div class="mz-pdf-exam-member" data-item-id="' + esc(item.id) + '" data-file-id="' + esc(item.pdf_file_id) + '" data-tpl="' + esc(item.exam_template_key) + '"'
            + (opts.insideGroup ? ' style="' + vis + 'margin-top:10px; padding-top:10px; border-top:1px dashed #5EEAD4;"' : '') + '>'
            + head
            + '<label style="display:block; font-weight:800; color:#134E4A; margin:4px 0;">這份 PDF 自己的 txt 答案</label>'
            + '<textarea class="mz-pdf-exam-raw" rows="5" placeholder="直接貼上課本解答原文，例如：&#10;Quiz 1, p. 50&#10;2. been 10. stopped" '
            + 'style="width:100%; box-sizing:border-box; font-family:monospace; font-size:0.8rem; padding:8px; border:1px solid #0F766E; border-radius:6px;">'
            + esc(item.answer_text_raw || '') + '</textarea>'
            + '<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<button type="button" class="mz-pdf-exam-parse btn" style="background:#0F766E; color:white; border:1px solid #0F766E; border-radius:6px; font-weight:800; cursor:pointer;">'
            + window.PdfExamPaper.parseUnconfirmedAnswersLabelHtml()
            + '</button>'
            + '<button type="button" class="mz-pdf-exam-save btn btn-primary" style="border-radius:6px; font-weight:800; cursor:pointer;">儲存</button>'
            + '<span class="mz-pdf-exam-msg" style="font-weight:700;">已解析 ' + n + ' 題</span>'
            + '</div>'
            + '<div class="mz-pdf-exam-bank-wrap" style="margin-top:8px;">' + bankPreviewHtml(item) + '</div>'
            + '<button type="button" class="mz-pdf-exam-add btn" data-mz-bank-act="add" style="font-size:0.8rem; padding:4px 10px; margin-top:6px; background:#FFFFFF; color:#134E4A; border:1px solid #0E7490; border-radius:6px; font-weight:800; cursor:pointer;">＋ 手動新增一題</button>'
            + '</div>'
        );
    }

    function appliedCardHtml(item) {
        return '<div class="mz-card mz-pdf-exam-card">'
            + comboNameBlockHtml(item)
            + appliedMemberHtml(item, { insideGroup: false })
            + '</div>';
    }

    function groupedCardHtml(items) {
        var first = items[0] || {};
        var assigned = [];
        var seen = {};
        (items || []).forEach(function (it) {
            assignsForItem(it.id).forEach(function (cid) {
                if (seen[cid]) return;
                seen[cid] = true;
                assigned.push(cid);
            });
        });
        var groupKey = String(first.folder_name || '').trim().toUpperCase() + '|' + String(first.exam_template_key || '');
        var selId = String(_groupMemberTab[groupKey] || (first && first.id) || '');
        if (!(items || []).some(function (it) { return String(it.id) === selId; })) {
            selId = String(first.id || '');
        }
        var tabs = (items || []).map(function (it) {
            var on = String(it.id) === selId;
            return '<button type="button" class="mz-pdf-exam-member-tab btn" data-item-id="' + esc(it.id) + '" data-group-key="' + esc(groupKey) + '" style="padding:5px 12px; font-size:0.78rem; font-weight:800; cursor:pointer; height:auto; background:' + (on ? '#CCFBF1' : '#FFFFFF') + '; color:' + (on ? '#0F766E' : '#334155') + '; border:1px solid ' + (on ? '#0F766E' : '#CBD5E1') + '; border-radius:6px;">'
                + esc(it.pdf_file_name || it.pdf_file_id)
                + '</button>';
        }).join('');
        return (
            '<div class="mz-card mz-pdf-exam-card mz-pdf-exam-grouped" data-group-key="' + esc(groupKey) + '">'
            + '<div style="font-weight:800; color:#0E7490;">群組　試卷範本　' + esc(templateName(first.exam_template_key)) + '</div>'
            + comboNameBlockHtml(first, assigned)
            + '<div class="mz-pdf-exam-member-tabs" style="display:flex; flex-wrap:wrap; gap:4px; margin:10px 0 4px;">' + tabs + '</div>'
            + items.map(function (it) {
                return appliedMemberHtml(it, { insideGroup: true, hidden: String(it.id) !== selId });
            }).join('')
            + '</div>'
        );
    }

    function appliedBlocksHtml(appliedCards) {
        var groupedByTpl = {};
        var singles = [];
        (appliedCards || []).forEach(function (it) {
            if (it && it.is_group === true) {
                var k = String(it.exam_template_key || '');
                if (!groupedByTpl[k]) groupedByTpl[k] = [];
                groupedByTpl[k].push(it);
            } else {
                singles.push(it);
            }
        });
        var html = '';
        Object.keys(groupedByTpl).forEach(function (k) {
            html += groupedCardHtml(groupedByTpl[k]);
        });
        singles.forEach(function (it) { html += appliedCardHtml(it); });
        return html;
    }

    function appliedCardsForFolder(folderName) {
        var files = pdfFilesForFolder(folderName);
        var applied = itemsForFolder(folderName);
        var appliedCards = files.map(function (f) {
            return applied.filter(function (it) { return String(it.pdf_file_id) === String(f.fileId); });
        }).reduce(function (acc, arr) { return acc.concat(arr); }, []);
        applied.forEach(function (it) {
            if (files.some(function (f) { return String(f.fileId) === String(it.pdf_file_id); })) return;
            appliedCards.push(it);
        });
        return appliedCards;
    }

    function pendingHtmlForFolder(folderName) {
        var files = pdfFilesForFolder(folderName);
        var applied = itemsForFolder(folderName);
        var appliedIds = {};
        applied.forEach(function (it) { appliedIds[String(it.pdf_file_id)] = true; });
        var pending = files.filter(function (f) { return !appliedIds[String(f.fileId)]; });
        if (files.length && pending.length) {
            return '<div class="mz-pdf-exam-pending" style="margin-top:8px;">'
                + '<div style="font-weight:800; color:#134E4A; margin-bottom:4px;">指名套用到這個資料夾裡勾選的 PDF（每一份自己一份）</div>'
                + pending.map(function (f) {
                    return '<label style="display:flex; align-items:center; gap:6px; font-weight:800; color:#134E4A; margin:2px 0; cursor:pointer;">'
                        + '<input type="checkbox" class="mz-pdf-exam-pick" data-file-id="' + esc(f.fileId) + '" data-file-name="' + esc(f.name) + '" checked>'
                        + esc(f.name)
                        + '</label>';
                }).join('')
                + applyBarHtml()
                + '</div>';
        }
        if (!files.length) {
            return '<div style="margin-top:8px; font-weight:700; color:#0F766E;">（這個資料夾目前沒列到 PDF。上傳仍在上方教材範本管理。）</div>';
        }
        return '<div class="mz-pdf-exam-pending" style="margin-top:8px;">'
            + '<div style="font-weight:800; color:#134E4A; margin-bottom:4px;">再套另一種試卷範本（目前只有一種）</div>'
            + applyBarHtml()
            + '</div>';
    }

    function renderFolderHtml(folderName) {
        var appliedCards = appliedCardsForFolder(folderName);
        if (!appliedCards.length) return '';
        return (
            '<div class="mz-pdf-exam-panel" data-folder-name="' + esc(folderName || '') + '">'
            + appliedBlocksHtml(appliedCards)
            + '</div>'
        );
    }

    function teacherFolderNames() {
        if (window.FeatureExamJob && typeof window.FeatureExamJob.getUniqueFolderNames === 'function') {
            return window.FeatureExamJob.getUniqueFolderNames('', 'teacher') || [];
        }
        return [];
    }

    function pdfCreateFolderNames() {
        var seen = {};
        var out = [];
        function add(name) {
            var n = String(name || '').trim();
            var u = n.toUpperCase();
            if (!n || seen[u]) return;
            seen[u] = true;
            out.push(n);
        }
        teacherFolderNames().forEach(add);
        _items.forEach(function (it) { add(it.folder_name); });
        if (window.FeatureTimeline && typeof window.FeatureTimeline.getMaterialPdfOptions === 'function') {
            (window.FeatureTimeline.getMaterialPdfOptions('', 'teacher') || []).forEach(function (o) {
                add(o && o.folderName);
            });
        }
        out.sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
        return out;
    }

    function paintCreatePanel(wrap) {
        var folders = pdfCreateFolderNames();
        var selected = String(wrap.getAttribute('data-selected-folder') || '').trim();
        if (selected && folders.indexOf(selected) === -1) {
            var selU = selected.toUpperCase();
            selected = folders.filter(function (n) { return n.toUpperCase() === selU; })[0] || '';
        }
        if (!selected) selected = folders[0] || '';
        wrap.setAttribute('data-selected-folder', selected);
        var opts = folders.length
            ? folders.map(function (n) {
                return '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>';
            }).join('')
            : '<option value="">（尚無教材資料夾）</option>';
        wrap.innerHTML = (
            '<div style="background:white; padding:20px; border-radius:12px; border:2px solid #5EEAD4; margin-bottom:16px;">'
            + '<h3 style="margin:0 0 4px 0; color:#0F766E;">📄 PDF 套餐（勾夾裡的 PDF，套用試卷範本）</h3>'
            + '<p style="color:#64748B; font-size:0.85rem; margin:0 0 10px 0;">這塊只產生 PDF 套餐，不准跟上方 Excel/JSON 套用、也不准跟目錄套餐合併。上傳 PDF 仍在教材範本管理。教材區窗口只顯示已套用的卡。</p>'
            + '<label style="display:block; font-weight:800; color:#134E4A; margin-bottom:4px;">教材資料夾</label>'
            + '<select class="mz-pdf-exam-create-folder" style="min-width:260px; padding:6px 8px; font-weight:800; margin-bottom:8px;">' + opts + '</select>'
            + '<div class="mz-pdf-exam-panel" data-folder-name="' + esc(selected) + '">'
            + (selected ? pendingHtmlForFolder(selected) : '')
            + '</div>'
            + '</div>'
        );
        var sel = wrap.querySelector('.mz-pdf-exam-create-folder');
        if (sel) {
            sel.addEventListener('change', function () {
                wrap.setAttribute('data-selected-folder', sel.value);
                paintCreatePanel(wrap);
            });
        }
        bind(wrap);
    }

    function renderCreatePanel() {
        var wrap = document.getElementById('pdf-exam-apply-container');
        if (!wrap) return;
        try { paintCreatePanel(wrap); } catch (_e) {}
        ensureLoaded().then(function () {
            if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
                return window.FeatureTimeline.ensureMetaCatalog('', 'teacher', { force: false }).catch(function () {}).then(function () {
                    paintCreatePanel(wrap);
                });
            }
            paintCreatePanel(wrap);
        }).catch(function (err) {
            wrap.innerHTML = '<div style="padding:16px; color:#EF4444; font-weight:800;">PDF 套餐區塊載入失敗：' + esc(err.message || err) + '</div>';
        });
    }

    function readBankEdits(card, item) {
        var bank = (item.parsed_bank || []).map(function (b) { return Object.assign({}, b); });
        card.querySelectorAll('.mz-pdf-exam-ans').forEach(function (input) {
            var idx = Number(input.getAttribute('data-idx'));
            if (!bank[idx]) return;
            bank[idx].answer_text = input.value;
            bank[idx]._manuallyEdited = true;
        });
        card.querySelectorAll('.mz-pdf-exam-acc').forEach(function (input) {
            var idx = Number(input.getAttribute('data-idx'));
            if (!bank[idx]) return;
            bank[idx].accepted_answers = window.PdfExamPaper.parseAcceptedAnswerList(input.value);
            bank[idx]._manuallyEdited = true;
        });
        card.querySelectorAll('.mz-pdf-exam-itemno').forEach(function (input) {
            var idx = Number(input.getAttribute('data-idx'));
            if (!bank[idx]) return;
            if (typeof window.PdfExamPaper.applyItemNoToBankRow === 'function') {
                window.PdfExamPaper.applyItemNoToBankRow(bank, idx, input.value);
            } else {
                bank[idx].item_no = String(input.value || '').trim() || bank[idx].item_no;
            }
        });
        if (window.PdfExamPaper && typeof window.PdfExamPaper.applyAcceptedSplitsToItem === 'function') {
            bank.forEach(function (b) { window.PdfExamPaper.applyAcceptedSplitsToItem(b); });
        }
        return bank;
    }

    function siblingIndexInSection(bank, idx, dir) {
        var cur = bank[idx];
        if (!cur) return -1;
        var sec = cur.section || '(未分類)';
        var grp = cur.group || '';
        if (dir < 0) {
            for (var i = idx - 1; i >= 0; i--) {
                if ((bank[i].section || '(未分類)') === sec && (bank[i].group || '') === grp) return i;
            }
        } else {
            for (var j = idx + 1; j < bank.length; j++) {
                if ((bank[j].section || '(未分類)') === sec && (bank[j].group || '') === grp) return j;
            }
        }
        return -1;
    }

    function refreshMemberBank(card, item, status) {
        if (status && status.keepSection) item._bankSection = status.keepSection;
        var wrap = card.querySelector('.mz-pdf-exam-bank-wrap');
        var bankEl = wrap && wrap.querySelector('.mz-pdf-exam-bank');
        var snap = (status && status.snap) || ((window.PdfExamPaper && typeof window.PdfExamPaper.snapshotScroller === 'function')
            ? window.PdfExamPaper.snapshotScroller(bankEl || wrap || card)
            : []);
        if (wrap) wrap.innerHTML = bankPreviewHtml(item);
        var anchor = status && (status.keepIdx != null || status.keepSection)
            ? { idx: status.keepIdx, section: status.keepSection }
            : null;
        if (window.PdfExamPaper && typeof window.PdfExamPaper.afterBankRedraw === 'function') {
            window.PdfExamPaper.afterBankRedraw(wrap || card, snap, anchor);
        }
        if (window.PdfExamPaper && typeof window.PdfExamPaper.mountSectionPaperPreview === 'function') {
            window.PdfExamPaper.mountSectionPaperPreview(wrap || card, {
                pdfFileId: item.pdf_file_id,
                section: item._bankSection || '',
                bank: item.parsed_bank,
                sectionPageHints: item.section_page_hints
            });
        }
        var msg = card.querySelector('.mz-pdf-exam-msg');
        if (!msg) return;
        if (status && status.text) {
            msg.style.color = status.error ? '#B91C1C' : '#0F766E';
            msg.textContent = status.text;
            return;
        }
        msg.style.color = '#0F766E';
        msg.textContent = '已改答案 ' + ((item.parsed_bank || []).length) + ' 題（尚未儲存）';
    }

    function openAddRowModal(card, item) {
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.openAddManualBankRowModal !== 'function') return;
        window.PdfExamPaper.openAddManualBankRowModal({
            getBank: function () {
                item.parsed_bank = item.parsed_bank || [];
                return item.parsed_bank;
            },
            onCommit: function (ins) {
                var row = (ins && ins.row) || {};
                clearSectionConfirmed(item, row.section);
                refreshMemberBank(card, item, { keepIdx: ins.insertAt, keepSection: row.section });
            }
        });
    }

    function clearSectionConfirmed(item, section) {
        if (!item || !section || !window.PdfExamPaper || typeof window.PdfExamPaper.setSectionConfirmed !== 'function') return;
        if (!window.PdfExamPaper.isSectionConfirmed(item.split_review, section)) return;
        item.split_review = item.split_review || {};
        window.PdfExamPaper.setSectionConfirmed(item.split_review, section, false);
    }

    async function handleBankAct(act, idx, card, item) {
        if (act === 'add') {
            openAddRowModal(card, item);
            return;
        }
        var bank = item.parsed_bank || [];
        var row = bank[idx];
        if (row) clearSectionConfirmed(item, row.section);
        if (act === 'up' || act === 'down') {
            var otherIdx = siblingIndexInSection(bank, idx, act === 'up' ? -1 : 1);
            if (otherIdx < 0) return;
            var tmp = bank[idx];
            bank[idx] = bank[otherIdx];
            bank[otherIdx] = tmp;
            if (window.PdfExamPaper && typeof window.PdfExamPaper.numberItemBlanks === 'function') {
                window.PdfExamPaper.numberItemBlanks(bank, tmp);
            }
            refreshMemberBank(card, item, { keepIdx: otherIdx, keepSection: tmp && tmp.section });
            return;
        }
        if (act === 'ins-before' || act === 'ins-after') {
            if (!window.PdfExamPaper || typeof window.PdfExamPaper.insertBlankRow !== 'function') return;
            var ins = window.PdfExamPaper.insertBlankRow(bank, idx, act === 'ins-after');
            if (!ins || !ins.row) return;
            refreshMemberBank(card, item, { keepIdx: ins.insertAt, keepSection: ins.row.section });
            return;
        }
        if (act === 'del') {
            var bankEl = card.querySelector('.mz-pdf-exam-bank');
            var snap = (window.PdfExamPaper && typeof window.PdfExamPaper.snapshotScroller === 'function')
                ? window.PdfExamPaper.snapshotScroller(bankEl || card)
                : [];
            if (!(await window.ModalOverlay.confirm('刪除這一題答案？若已經在 PDF 上畫框對應這一題，那個框不會自動刪除，會變成「未指定題目」。'))) return;
            var removed = bank.splice(idx, 1)[0];
            if (window.PdfExamPaper && typeof window.PdfExamPaper.numberItemBlanks === 'function') {
                window.PdfExamPaper.numberItemBlanks(bank, removed);
            }
            refreshMemberBank(card, item, {
                keepIdx: Math.min(idx, Math.max(0, bank.length - 1)),
                keepSection: removed && removed.section,
                snap: snap
            });
        }
    }

    async function parseCard(card, item, opts) {
        opts = opts || {};
        var rawEl = card.querySelector('.mz-pdf-exam-raw');
        var msg = card.querySelector('.mz-pdf-exam-msg');
        var raw = rawEl ? rawEl.value : '';
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.parseAnswerText !== 'function') {
            throw new Error('找不到解答解析。');
        }
        var prevReview = item.split_review || {};
        if (msg) { msg.style.color = '#0F766E'; msg.textContent = '解析中…'; }
        var blankStats = null;
        var paperLabels = [];
        if (item.pdf_file_id && typeof window.PdfExamPaper.loadPdfDocumentFromDrive === 'function') {
            try {
                var pdfDoc = await window.PdfExamPaper.loadPdfDocumentFromDrive(item.pdf_file_id);
                if (typeof window.PdfExamPaper.detectBlankReviewStats === 'function') {
                    blankStats = await window.PdfExamPaper.detectBlankReviewStats(pdfDoc);
                }
                if (typeof window.PdfExamPaper.scanPaperSectionLabels === 'function') {
                    paperLabels = await window.PdfExamPaper.scanPaperSectionLabels(pdfDoc);
                }
            } catch (_e) {
                blankStats = null;
            }
        }
        var parseRaw = raw;
        if (opts.txtWins && opts.section && typeof window.PdfExamPaper.sliceAnswerTextForSection === 'function') {
            parseRaw = window.PdfExamPaper.sliceAnswerTextForSection(raw, opts.section);
        }
        var parsed = window.PdfExamPaper.parseAnswerText(parseRaw);
        if (!parsed.length && msg) {
            msg.style.color = '#B45309';
            msg.textContent = '沒有解析出題目，請確認有「數字.」開頭的題號';
        }
        item.answer_text_raw = raw;
        var freshHints = parsed.sectionPageHints || {};
        var nextHints = Object.assign({}, item.section_page_hints || {});
        function secKey(s) {
            return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        }
        var replacingKey = (opts.txtWins && opts.section) ? secKey(opts.section) : '';
        Object.keys(freshHints).forEach(function (sec) {
            var same = replacingKey && secKey(sec) === replacingKey;
            if (!same && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(prevReview, sec)) return;
            nextHints[sec] = freshHints[sec];
        });
        item.section_page_hints = nextHints;
        var prevBank = item.parsed_bank || [];
        if (opts.txtWins && opts.section) {
            item.parsed_bank = (typeof window.PdfExamPaper.mergeParsedBankKeepingOrder === 'function')
                ? window.PdfExamPaper.mergeParsedBankKeepingOrder(prevBank, parsed, { section: opts.section, txtWins: true })
                : parsed;
        } else {
            item.parsed_bank = (typeof window.PdfExamPaper.mergeParsedBankKeepingOrder === 'function')
                ? window.PdfExamPaper.mergeParsedBankKeepingOrder(prevBank, parsed, { keepConfirmed: true, review: prevReview })
                : parsed;
        }
        if (window.PdfExamPaper && typeof window.PdfExamPaper.applyAcceptedSplitsToItem === 'function') {
            item.parsed_bank.forEach(function (b) {
                var same = replacingKey && secKey(b && b.section) === replacingKey;
                if (!same && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(prevReview, b && b.section)) return;
                window.PdfExamPaper.applyAcceptedSplitsToItem(b);
            });
        }
        if (window.PdfExamPaper.buildSplitReview) {
            item.split_review = window.PdfExamPaper.buildSplitReview(item.parsed_bank, blankStats, {
                paperLabels: paperLabels,
                reattachLog: parsed.column_reattach || [],
                section_template_overrides: prevReview.section_template_overrides || {},
                teacher_located_boxes: prevReview.teacher_located_boxes || {},
                confirmed_sections: prevReview.confirmed_sections || {}
            });
        }
        if (opts.section && opts.txtWins && window.PdfExamPaper.setSectionConfirmed) {
            item.split_review = item.split_review || {};
            window.PdfExamPaper.setSectionConfirmed(item.split_review, opts.section, false);
            item._bankSection = opts.section;
        }
        var parseStatus = null;
        if (msg && parsed.length) {
            var review = item.split_review || {};
            var warnN = ((review.section_warnings || []).filter(function (w) {
                return w && !(window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(review, w.section));
            }).length) + Object.keys(review.flagged_keys || {}).filter(function (k) {
                var bk = (item.parsed_bank || []).filter(function (it) { return it && it.key === k; })[0];
                return !(bk && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(review, bk.section));
            }).length;
            parseStatus = {
                error: !!warnN,
                text: warnN
                    ? ('已解析 ' + parsed.length + ' 題，有 ' + warnN + ' 處警示。核對後可按該 Quiz 旁「確認並儲存」')
                    : ('已解析 ' + parsed.length + ' 題，請逐項確認（尚未儲存）'),
                keepSection: opts.section || item._bankSection
            };
        } else if (opts.section) {
            parseStatus = { keepSection: opts.section };
        }
        refreshMemberBank(card, item, parseStatus);
    }

    async function saveClassLinks(itemIds, classIds) {
        var want = {};
        (classIds || []).forEach(function (id) { if (id) want[String(id)] = true; });
        var idSet = {};
        (itemIds || []).forEach(function (id) { if (id) idSet[String(id)] = true; });
        var ids = Object.keys(idSet);
        var i;
        var existing = _assigns.filter(function (a) { return idSet[String(a.pdf_exam_item_id)]; });
        for (i = 0; i < existing.length; i++) {
            if (!want[String(existing[i].class_id)]) {
                var del = await window.supabaseClient.from('class_material_pdf_exam_items').delete().eq('id', existing[i].id);
                if (del.error) throw del.error;
            }
        }
        var have = {};
        existing.forEach(function (a) {
            have[String(a.pdf_exam_item_id) + '|' + String(a.class_id)] = true;
        });
        var toAdd = [];
        ids.forEach(function (itemId) {
            Object.keys(want).forEach(function (cid) {
                if (!have[itemId + '|' + cid]) toAdd.push({ class_id: cid, pdf_exam_item_id: itemId });
            });
        });
        if (toAdd.length) {
            var ins = await window.supabaseClient.from('class_material_pdf_exam_items').insert(toAdd);
            if (ins.error) throw ins.error;
        }
    }

    async function saveItem(item, extra) {
        var userId = await getCurrentUserId();
        if (!userId) throw new Error('尚未登入。');
        var payload = Object.assign({
            teacher_id: userId,
            material_folder_id: item.material_folder_id || null,
            folder_name: item.folder_name || '',
            pdf_file_id: item.pdf_file_id,
            pdf_file_name: item.pdf_file_name || '',
            exam_template_key: item.exam_template_key,
            label: String(item.label || '').trim(),
            answer_text_raw: item.answer_text_raw || '',
            parsed_bank: item.parsed_bank || [],
            section_page_hints: item.section_page_hints || {},
            split_review: item.split_review || null,
            is_group: item.is_group === true,
            updated_at: new Date().toISOString()
        }, extra || {});
        if (!payload.material_folder_id) payload.material_folder_id = null;
        var res;
        if (item.id) {
            res = await window.supabaseClient
                .from('material_pdf_exam_items')
                .update(payload)
                .eq('id', item.id)
                .select('*')
                .single();
        } else {
            res = await window.supabaseClient
                .from('material_pdf_exam_items')
                .upsert(payload, { onConflict: 'teacher_id,pdf_file_id,exam_template_key' })
                .select('*')
                .single();
        }
        if (res.error) throw res.error;
        var saved = res.data;
        var idx = _items.findIndex(function (it) { return String(it.id) === String(saved.id); });
        if (idx >= 0) _items[idx] = saved;
        else _items.push(saved);
        return saved;
    }

    function readClassIdsFromCard(card) {
        var ids = [];
        var host = card && (card.classList.contains('mz-pdf-exam-card') ? card : card.closest('.mz-pdf-exam-card'));
        (host || card).querySelectorAll('.mz-pdf-exam-class-cb:checked').forEach(function (cb) {
            if (cb.value) ids.push(cb.value);
        });
        return ids;
    }

    function readLabelFromCard(card) {
        var host = card && (card.classList.contains('mz-pdf-exam-card') ? card : card.closest('.mz-pdf-exam-card'));
        var el = (host || card).querySelector('.mz-pdf-exam-label');
        return String((el && el.value) || '').trim();
    }

    async function saveMemberCard(card, item) {
        var host = card.closest('.mz-pdf-exam-card') || card;
        var label = readLabelFromCard(host) || comboLabelOf(item);
        var classIds = readClassIdsFromCard(host);
        var members = host.classList.contains('mz-pdf-exam-grouped')
            ? Array.prototype.map.call(host.querySelectorAll('.mz-pdf-exam-member'), function (el) {
                return getItemById(el.getAttribute('data-item-id'));
            }).filter(Boolean)
            : [item];
        item.label = label;
        var saved = await saveItem(item);
        var i;
        for (i = 0; i < members.length; i++) {
            if (String(members[i].id) === String(item.id)) continue;
            members[i].label = label;
            await saveItem(members[i], { label: label });
        }
        await saveClassLinks(members.map(function (m) { return m.id; }), classIds);
        _loaded = false;
        await ensureLoaded();
        return saved;
    }

    async function applyPicks(panel) {
        var folderName = panel.getAttribute('data-folder-name') || '';
        var tplEl = panel.querySelector('.mz-pdf-exam-tpl');
        var msg = panel.querySelector('.mz-pdf-exam-apply-msg');
        var key = tplEl ? tplEl.value : TPL_DETECT.key;
        var groupEl = panel.querySelector('.mz-pdf-exam-group');
        var isGroup = !!(groupEl && groupEl.checked);
        var picks = [];
        panel.querySelectorAll('.mz-pdf-exam-pick:checked').forEach(function (cb) {
            picks.push({
                fileId: cb.getAttribute('data-file-id') || '',
                fileName: cb.getAttribute('data-file-name') || ''
            });
        });
        if (!picks.length) {
            if (msg) { msg.style.color = '#B45309'; msg.textContent = '請勾選要套用的 PDF'; }
            return;
        }
        if (msg) { msg.style.color = '#0F766E'; msg.textContent = '套用中…'; }
        var userId = await getCurrentUserId();
        var folderDbId = null;
        if (userId && folderName) {
            var found = await window.supabaseClient
                .from('material_folders')
                .select('id')
                .eq('teacher_id', userId)
                .eq('folder_name', folderName)
                .limit(1);
            if (!found.error && found.data && found.data[0]) folderDbId = found.data[0].id;
        }
        var i;
        for (i = 0; i < picks.length; i++) {
            var p = picks[i];
            if (!p.fileId) continue;
            if (itemFor(p.fileId, key)) continue;
            await saveItem({
                material_folder_id: folderDbId,
                folder_name: folderName,
                pdf_file_id: p.fileId,
                pdf_file_name: p.fileName,
                exam_template_key: key,
                label: p.fileName,
                is_group: isGroup,
                answer_text_raw: '',
                parsed_bank: [],
                section_page_hints: {}
            });
        }
        if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderMaterialZone === 'function') {
            window.FeatureClassMaterialCombinations.renderMaterialZone();
        }
        renderCreatePanel();
    }

    function startTeacherLocate(card, item, section) {
        if (!section || !window.PdfExamPaper || typeof window.PdfExamPaper.openTeacherLocateEditor !== 'function') return;
        if (!item.pdf_file_id) {
            var msg = card.querySelector('.mz-pdf-exam-msg');
            if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '這份還沒有 PDF，無法定位。'; }
            return;
        }
        var expected = (item.parsed_bank || []).filter(function (b) {
            return String(b.section || '').replace(/\s+/g, ' ').trim().toLowerCase()
                === String(section).replace(/\s+/g, ' ').trim().toLowerCase();
        }).length;
        var existing = window.PdfExamPaper.teacherBoxesForSection(item.split_review, section);
        window.PdfExamPaper.openTeacherLocateEditor({
            pdfFileId: item.pdf_file_id,
            sectionLabel: section,
            expectedCount: expected,
            boxes: existing,
            onSaved: function (boxes) {
                item.split_review = window.PdfExamPaper.setSectionTeacherLocate(item.split_review || {}, section, boxes);
                refreshMemberBank(card, item, { keepSection: section });
                var msgEl = card.querySelector('.mz-pdf-exam-msg');
                if (msgEl) {
                    msgEl.style.color = '#0F766E';
                    msgEl.textContent = '「' + section + '」已改用老師定位（尚未儲存）';
                }
            }
        });
    }

    function copyRangeFields(r) {
        return {
            pdf_file_id: String((r && (r.pdf_file_id || r.pdfFileId)) || '').trim()
        };
    }

    function rowLooksLike(r) {
        return !!String((r && (r.pdf_file_id || r.pdfFileId)) || '').trim();
    }

    function readRowFields(pathStr, idx, rowEl) {
        var el = document.getElementById('range-pack-pdf-file-' + pathStr + '-' + idx)
            || (rowEl && rowEl.querySelector('.range-pack-pdf-file'));
        return { pdf_file_id: el ? String(el.value || '').trim() : '' };
    }

    function expandPackRows(_classId, combo, prevRows, helpers) {
        var h = helpers || {};
        var label = (typeof h.comboLabelText === 'function') ? h.comboLabelText(combo) : String((combo && combo.combo_label) || '').trim();
        var examOf = (typeof h.copyPackExamFields === 'function') ? h.copyPackExamFields : function () { return {}; };
        var blank = (typeof h.blankPackExamFields === 'function') ? h.blankPackExamFields() : {};
        var prev = Array.isArray(prevRows) ? prevRows : [];
        function rowFrom(r) {
            return Object.assign({
                combo_id: combo.id,
                combo_label: label,
                meta_file: '',
                range_type: 'page',
                start: '',
                end: ''
            }, r ? examOf(r) : blank, copyRangeFields(r && r.pdf_file_id ? r : combo));
        }
        if (prev.length) return prev.map(rowFrom);
        return [rowFrom(null)];
    }

    function nextSectionRow(combo, last, helpers) {
        var h = helpers || {};
        var blank = (typeof h.blankPackExamFields === 'function') ? h.blankPackExamFields() : {};
        var label = (combo && typeof h.comboLabelText === 'function')
            ? h.comboLabelText(combo)
            : String((last && last.combo_label) || '').trim();
        return Object.assign({
            combo_id: (combo && combo.id) || String((last && last.combo_id) || '').trim(),
            combo_label: label,
            meta_file: '',
            range_type: 'page',
            start: '',
            end: ''
        }, blank, copyRangeFields(last && last.pdf_file_id ? last : combo));
    }

    function renderPackTableHtml(ctx) {
        var packUi = (ctx && ctx.packUi) || {};
        var pathStr = (ctx && ctx.pathStr) || '';
        var rows = (ctx && ctx.block && ctx.block.rows) || [];
        var combo = ctx && ctx.blockCombo;
        var startIdx = Number(ctx && ctx.startIdx) || 0;
        var blockRowCount = rows.length;
        var htmlRows = rows.map(function (row, posInBlock) {
            var idx = startIdx + posInBlock;
            var delSheet = packUi.packRowDeleteBtn ? packUi.packRowDeleteBtn(pathStr, idx, blockRowCount > 1) : '';
            var orderCell = packUi.packRowOrderControls ? packUi.packRowOrderControls(pathStr, idx, posInBlock, blockRowCount) : '';
            var drop = packUi.rowDropAttr ? packUi.rowDropAttr(pathStr, idx) : '';
            return '<div class="range-pack-row range-pack-row--pdf"' + drop
                + orderCell
                + packRowInputsHtml(pathStr, idx, row, combo)
                + '<div>' + delSheet + '</div>'
                + '</div>';
        }).join('');
        var html = rows.length
            ? ('<div class="range-pack-table"><div class="range-pack-table-inner">'
                + '<div class="range-pack-head range-pack-head--pdf"><div></div><div>PDF</div><div>刪</div></div>'
                + htmlRows
                + '</div></div>')
            : '';
        return { html: html, rowCount: rows.length, showsExamStats: false };
    }

    function packRowInputsHtml(pathStr, idx, row, combo) {
        var on = 'window.FeatureTimeline && window.FeatureTimeline.onRangePackChange && window.FeatureTimeline.onRangePackChange(\'' + pathStr + '\', { rerender: true })';
        var members = [];
        if (combo && combo.isGroup && (combo.siblingIds || []).length) {
            (combo.siblingIds || []).forEach(function (id) {
                var it = getItemById(id);
                if (it) members.push(it);
            });
        }
        var current = String((row && row.pdf_file_id) || (combo && combo.pdfFileId) || '').trim();
        if (members.length > 1) {
            return '<div>'
                + '<select id="range-pack-pdf-file-' + pathStr + '-' + idx + '" class="form-control range-pack-pdf-file"'
                + ' onchange="' + on + '">'
                + '<option value="">— 選 PDF —</option>'
                + members.map(function (it) {
                    var fid = String(it.pdf_file_id || '');
                    return '<option value="' + esc(fid) + '"' + (fid === current ? ' selected' : '') + '>'
                        + esc(it.pdf_file_name || fid) + '</option>';
                }).join('')
                + '</select></div>';
        }
        return '<div>'
            + '<input type="hidden" id="range-pack-pdf-file-' + pathStr + '-' + idx + '" class="range-pack-pdf-file" value="' + esc(current) + '">'
            + '<div>' + esc((combo && (combo.pdfFileName || combo.combo_label)) || '') + '</div>'
            + '</div>';
    }

    function bind(wrap) {
        if (!wrap) return;
        wrap.querySelectorAll('.mz-pdf-exam-apply').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var panel = btn.closest('.mz-pdf-exam-panel');
                if (!panel) return;
                btn.disabled = true;
                applyPicks(panel).catch(function (err) {
                    var msg = panel.querySelector('.mz-pdf-exam-apply-msg');
                    if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '套用失敗：' + (err.message || err); }
                }).finally(function () { btn.disabled = false; });
            });
        });
        wrap.querySelectorAll('.mz-pdf-exam-parse').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var card = btn.closest('.mz-pdf-exam-member');
                var item = _items.filter(function (it) { return String(it.id) === String(card && card.getAttribute('data-item-id')); })[0];
                if (!card || !item) return;
                btn.disabled = true;
                parseCard(card, item).catch(function (err) {
                    var msg = card.querySelector('.mz-pdf-exam-msg');
                    if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '解析失敗：' + (err.message || err); }
                }).finally(function () { btn.disabled = false; });
            });
        });
        wrap.querySelectorAll('.mz-pdf-exam-save').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var card = btn.closest('.mz-pdf-exam-member');
                var item = _items.filter(function (it) { return String(it.id) === String(card && card.getAttribute('data-item-id')); })[0];
                var msg = card && card.querySelector('.mz-pdf-exam-msg');
                if (!card || !item) return;
                var rawEl = card.querySelector('.mz-pdf-exam-raw');
                item.answer_text_raw = rawEl ? rawEl.value : item.answer_text_raw;
                item.parsed_bank = readBankEdits(card, item);
                btn.disabled = true;
                btn.textContent = '儲存中…';
                if (msg) { msg.style.color = '#0F766E'; msg.textContent = '儲存中…'; }
                saveMemberCard(card, item).then(function (saved) {
                    var latest = getItemById(saved && saved.id) || saved || item;
                    btn.textContent = '儲存';
                    refreshMemberBank(card, latest, {
                        text: '已儲存（' + ((latest.parsed_bank || []).length) + ' 題）'
                    });
                }).catch(function (err) {
                    btn.textContent = '儲存';
                    if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '儲存失敗：' + (err.message || err); }
                }).finally(function () { btn.disabled = false; });
            });
        });
        if (wrap.getAttribute('data-mz-pdf-exam-bound') === '1') return;
        wrap.setAttribute('data-mz-pdf-exam-bound', '1');
        wrap.addEventListener('click', function (ev) {
            var locateBtn = ev.target.closest('.mz-pdf-exam-locate');
            if (locateBtn && wrap.contains(locateBtn)) {
                var locateCard = locateBtn.closest('.mz-pdf-exam-member');
                var locateItem = _items.filter(function (it) { return String(it.id) === String(locateCard && locateCard.getAttribute('data-item-id')); })[0];
                if (locateCard && locateItem) startTeacherLocate(locateCard, locateItem, locateBtn.getAttribute('data-section') || '');
                return;
            }
            var memberTab = ev.target.closest('.mz-pdf-exam-member-tab');
            if (memberTab && wrap.contains(memberTab)) {
                var host = memberTab.closest('.mz-pdf-exam-grouped');
                var gid = memberTab.getAttribute('data-group-key') || '';
                var pickId = memberTab.getAttribute('data-item-id') || '';
                if (gid) _groupMemberTab[gid] = pickId;
                if (!host) return;
                host.querySelectorAll('.mz-pdf-exam-member-tab').forEach(function (t) {
                    var on = t.getAttribute('data-item-id') === pickId;
                    t.style.background = on ? '#CCFBF1' : '#FFFFFF';
                    t.style.color = on ? '#0F766E' : '#334155';
                    t.style.borderColor = on ? '#0F766E' : '#CBD5E1';
                });
                host.querySelectorAll('.mz-pdf-exam-member').forEach(function (el) {
                    el.style.display = String(el.getAttribute('data-item-id')) === pickId ? '' : 'none';
                });
                return;
            }
            var quizTab = ev.target.closest('.mz-pdf-exam-quiz-tab');
            if (quizTab && wrap.contains(quizTab)) {
                var quizCard = quizTab.closest('.mz-pdf-exam-member');
                var quizItem = getItemById(quizCard && quizCard.getAttribute('data-item-id'));
                if (!quizCard || !quizItem) return;
                quizItem.parsed_bank = readBankEdits(quizCard, quizItem);
                quizItem._bankSection = quizTab.getAttribute('data-section') || '';
                refreshMemberBank(quizCard, quizItem, { keepSection: quizItem._bankSection });
                return;
            }
            var reparseBtn = ev.target.closest('.mz-pdf-exam-reparse');
            if (reparseBtn && wrap.contains(reparseBtn)) {
                var reparseCard = reparseBtn.closest('.mz-pdf-exam-member');
                var reparseItem = _items.filter(function (it) { return String(it.id) === String(reparseCard && reparseCard.getAttribute('data-item-id')); })[0];
                if (!reparseCard || !reparseItem) return;
                var sec = reparseBtn.getAttribute('data-section') || '';
                reparseBtn.disabled = true;
                reparseBtn.textContent = '解析中…';
                parseCard(reparseCard, reparseItem, { section: sec, txtWins: true }).catch(function (err) {
                    var msg = reparseCard.querySelector('.mz-pdf-exam-msg');
                    if (msg) { msg.style.color = '#B91C1C'; msg.textContent = '解析失敗：' + (err.message || err); }
                }).finally(function () {
                    reparseBtn.disabled = false;
                    reparseBtn.textContent = '重新解析';
                });
                return;
            }
            var confirmBtn = ev.target.closest('.mz-pdf-exam-confirm');
            if (confirmBtn && wrap.contains(confirmBtn)) {
                var confirmCard = confirmBtn.closest('.mz-pdf-exam-member');
                var confirmItem = _items.filter(function (it) { return String(it.id) === String(confirmCard && confirmCard.getAttribute('data-item-id')); })[0];
                if (!confirmCard || !confirmItem) return;
                var confirmMsg = confirmCard.querySelector('.mz-pdf-exam-msg');
                var rawEl = confirmCard.querySelector('.mz-pdf-exam-raw');
                confirmItem.answer_text_raw = rawEl ? rawEl.value : confirmItem.answer_text_raw;
                confirmItem.parsed_bank = readBankEdits(confirmCard, confirmItem);
                confirmItem.split_review = confirmItem.split_review || {};
                var sec = confirmBtn.getAttribute('data-section') || '';
                if (window.PdfExamPaper.isSectionConfirmed(confirmItem.split_review, sec)) return;
                window.PdfExamPaper.setSectionConfirmed(confirmItem.split_review, sec, true);
                confirmBtn.disabled = true;
                confirmBtn.textContent = '儲存中…';
                if (confirmMsg) { confirmMsg.style.color = '#0F766E'; confirmMsg.textContent = '儲存中…'; }
                saveMemberCard(confirmCard, confirmItem).then(function (saved) {
                    var latest = getItemById(saved && saved.id) || saved || confirmItem;
                    refreshMemberBank(confirmCard, latest, {
                        text: '「' + sec + '」已確認並儲存（' + ((latest.parsed_bank || []).length) + ' 題）',
                        keepSection: sec
                    });
                }).catch(function (err) {
                    window.PdfExamPaper.setSectionConfirmed(confirmItem.split_review, sec, false);
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = '確認並儲存';
                    if (confirmMsg) { confirmMsg.style.color = '#B91C1C'; confirmMsg.textContent = '儲存失敗：' + (err.message || err); }
                    refreshMemberBank(confirmCard, confirmItem, { error: true, text: '儲存失敗：' + (err.message || err) });
                });
                return;
            }
            var btn = ev.target.closest('[data-mz-bank-act]');
            if (!btn || !wrap.contains(btn) || btn.disabled) return;
            var card = btn.closest('.mz-pdf-exam-member');
            var item = _items.filter(function (it) { return String(it.id) === String(card && card.getAttribute('data-item-id')); })[0];
            if (!card || !item) return;
            if (btn.getAttribute('data-mz-bank-act') !== 'add') {
                item.parsed_bank = readBankEdits(card, item);
            }
            var idx = Number(btn.getAttribute('data-idx'));
            handleBankAct(btn.getAttribute('data-mz-bank-act'), idx, card, item);
        });
        wrap.addEventListener('change', function (ev) {
            var input = ev.target.closest('.mz-pdf-exam-ans, .mz-pdf-exam-acc, .mz-pdf-exam-itemno');
            if (!input || !wrap.contains(input)) return;
            var card = input.closest('.mz-pdf-exam-member');
            var item = getItemById(card && card.getAttribute('data-item-id'));
            if (!card || !item) return;
            item.parsed_bank = readBankEdits(card, item);
            var idx = Number(input.getAttribute('data-idx'));
            var row = item.parsed_bank[idx];
            if (!row) return;
            var needRedraw = input.classList.contains('mz-pdf-exam-itemno');
            if (window.PdfExamPaper.isSectionConfirmed(item.split_review, row.section)) {
                clearSectionConfirmed(item, row.section);
                needRedraw = true;
            }
            if (needRedraw) {
                refreshMemberBank(card, item, { keepIdx: idx, keepSection: row.section });
            }
        });
        wrap.querySelectorAll('.mz-pdf-exam-member').forEach(function (card) {
            var item = getItemById(card.getAttribute('data-item-id'));
            if (!item) return;
            if (window.PdfExamPaper && typeof window.PdfExamPaper.mountSectionPaperPreview === 'function') {
                window.PdfExamPaper.mountSectionPaperPreview(card.querySelector('.mz-pdf-exam-bank-wrap') || card, {
                    pdfFileId: item.pdf_file_id,
                    section: item._bankSection || '',
                    bank: item.parsed_bank,
                    sectionPageHints: item.section_page_hints
                });
            }
        });
    }

    var api = {
        PDF_EXAM_TEMPLATES: PDF_EXAM_TEMPLATES,
        TPL_DETECT_KEY: TPL_DETECT.key,
        ensureLoaded: ensureLoaded,
        renderFolderHtml: renderFolderHtml,
        renderCreatePanel: renderCreatePanel,
        bind: bind,
        isPdfCombo: isPdfCombo,
        listAssignedForHomework: listAssignedForHomework,
        getAssignedById: getAssignedById,
        packRowInputsHtml: packRowInputsHtml,
        copyRangeFields: copyRangeFields,
        getItem: function (fileId, templateKey) {
            return itemFor(fileId, templateKey || TPL_DETECT.key);
        },
        getItemById: getItemById,
        folderNames: folderNames,
        isReady: function () { return _loaded; }
    };

    if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.register === 'function') {
        window.MaterialComboStrategies.register({
            kind: 'pdf',
            order: 20,
            packMode: 'pdf',
            usesMetaRange: false,
            showsExamStats: false,
            ensureLoaded: ensureLoaded,
            isReady: function () { return _loaded; },
            listAssignedForHomework: listAssignedForHomework,
            getAssignedById: getAssignedById,
            ownsComboId: function (comboId) {
                return !!getItemById(comboId);
            },
            folderNames: folderNames,
            renderFolderHtml: renderFolderHtml,
            bind: bind,
            matches: function (combo) { return isPdfCombo(combo); },
            renderPackTableHtml: renderPackTableHtml,
            expandPackRows: expandPackRows,
            nextSectionRow: nextSectionRow,
            copyRangeFields: copyRangeFields,
            readRowFields: readRowFields,
            rowLooksLike: rowLooksLike
        });
    }

    return api;
})();

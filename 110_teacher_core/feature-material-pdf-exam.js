/**
 * PDF 套餐：指名套用試卷範本，並為每一份 PDF 貼自己的 txt 答案。
 * 產生在教材範本管理獨立區塊；教材區窗口只顯示已套用的卡。
 * 不碰 Excel／JSON 套餐（ensureCombination／pickComboForCard／combo_statistics）。
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
        if (!window.supabaseClient) return null;
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
                _loaded = true;
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
        return (
            '<label style="display:block; font-weight:800; color:#92400E; margin:8px 0 2px;">PDF 套餐（出作業下拉會顯示這個）</label>'
            + '<input type="text" class="mz-pdf-exam-label" value="' + esc(named) + '" placeholder="例如 Quiz 考卷" style="font-weight:800; color:#78350F; margin-bottom:8px;">'
            + '<div style="margin-top:8px;">'
            + '<div style="font-weight:800; color:#15803D; margin-bottom:4px;">採用班級</div>'
            + '<div class="mz-pdf-exam-class-box">' + classChecksHtml(assignedIds || assignsForItem(item && item.id)) + '</div>'
            + '</div>'
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
        var bank = (item && Array.isArray(item.parsed_bank)) ? item.parsed_bank : [];
        if (!bank.length) {
            return '<div class="mz-pdf-exam-bank" style="font-weight:700; color:#0F766E;">尚未解析出題目。貼上 txt 後按「解析成答案清單」。</div>';
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
        var body = groups.map(function (g) {
            var secWarn = !!warnedSections[g.section] || !!g.missing;
            var lastShownGroup = null;
            var rowsHtml = (g.items || []).length
                ? g.items.map(function (bk) {
                var idx = bank.indexOf(bk);
                var flagReason = flagged[bk.key] || '';
                var isFlag = !!flagReason || secWarn;
                var label = (bk.group ? (bk.group + '-') : '') + (bk.item_no || '') + (bk.part ? ('-' + bk.part) : '') + (bk.blank_index ? ('-' + bk.blank_index) : '');
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
                return groupHead
                    + '<div style="display:flex; gap:6px; align-items:center; padding:4px 0; border-bottom:1px solid ' + (isFlag ? '#FECACA' : '#CCFBF1') + '; background:' + (isFlag ? '#FEF2F2' : 'transparent') + ';"'
                    + (flagReason ? ' title="' + esc(flagReason) + '"' : '') + '>'
                    + '<span style="width:80px; flex-shrink:0; font-size:0.76rem; font-weight:800; color:' + (isFlag ? '#B91C1C' : '#0F766E') + ';" title="' + (bk.blank_index ? '這一題原本一格逗號答案被拆成多格，這是第 ' + esc(bk.blank_index) + ' 格' : '') + '">' + esc(label) + '</span>'
                    + '<input type="text" class="mz-pdf-exam-ans" data-idx="' + idx + '" value="' + esc(bk.answer_text) + '" placeholder="答案" style="flex:1; min-width:80px; padding:3px 6px; font-size:0.8rem; border:1px solid ' + (isFlag ? '#F87171' : '#99F6E4') + '; color:' + (isFlag ? '#B91C1C' : '#134E4A') + ';">'
                    + '<input type="text" class="mz-pdf-exam-acc" data-idx="' + idx + '" value="' + esc(window.PdfExamPaper.formatAcceptedAnswerList(bk.accepted_answers)) + '" placeholder="其他可接受答案（用 || 分隔）" style="flex:1; min-width:90px; padding:3px 6px; font-size:0.8rem; border:1px solid ' + (isFlag ? '#F87171' : '#99F6E4') + ';">'
                    + '<span style="display:flex; gap:3px; flex-shrink:0; white-space:nowrap;">'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="up" data-idx="' + idx + '" title="上移" style="' + (canUp ? btnOn : btnOff) + '" ' + (canUp ? '' : 'disabled') + '>↑</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="down" data-idx="' + idx + '" title="下移" style="' + (canDown ? btnOn : btnOff) + '" ' + (canDown ? '' : 'disabled') + '>↓</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="ins-before" data-idx="' + idx + '" title="在上方加一筆" style="' + btnAdd + '">＋上</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="ins-after" data-idx="' + idx + '" title="在下方加一筆" style="' + btnAdd + '">＋下</button>'
                    + '<button type="button" class="mz-pdf-exam-bank-btn" data-mz-bank-act="del" data-idx="' + idx + '" title="刪除" style="' + btnDel + '">🗑</button>'
                    + '</span>'
                    + '</div>';
            }).join('')
                : '<div style="font-size:0.76rem; font-weight:700; color:#B91C1C; padding:6px 0;">這一組在解答裡沒有列出來的題（沒有捨棄）。請核對原文，或改用老師定位。</div>';
            var secTitle = g.section
                ? '<div style="font-weight:800; color:' + (secWarn ? '#B91C1C' : '#0F766E') + '; font-size:0.8rem; margin:6px 0 2px;">📘 ' + esc(g.section) + (secWarn ? ' ⚠' : '') + '</div>'
                : '';
            return '<div style="margin-bottom:8px;">' + secTitle + rowsHtml + '</div>';
        }).join('');
        return splitReviewHtml(item)
            + '<div class="mz-pdf-exam-bank" style="max-height:280px; overflow:auto; border:1px solid #99F6E4; border-radius:6px; padding:6px; background:#F0FDFA;">'
            + body
            + '</div>';
    }

    function appliedMemberHtml(item, opts) {
        opts = opts || {};
        var n = (item.parsed_bank || []).length;
        var head = opts.insideGroup
            ? '<div style="font-weight:800; color:#134E4A;">📄 ' + esc(item.pdf_file_name || item.pdf_file_id) + '</div>'
            : ('<div style="font-weight:800; color:#134E4A;">📄 ' + esc(item.pdf_file_name || item.pdf_file_id) + '</div>'
                + '<div style="font-weight:700; color:#0F766E; margin:4px 0 8px;">試卷範本　' + esc(templateName(item.exam_template_key)) + '</div>');
        return (
            '<div class="mz-pdf-exam-member" data-item-id="' + esc(item.id) + '" data-file-id="' + esc(item.pdf_file_id) + '" data-tpl="' + esc(item.exam_template_key) + '"'
            + (opts.insideGroup ? ' style="margin-top:10px; padding-top:10px; border-top:1px dashed #5EEAD4;"' : '') + '>'
            + head
            + '<label style="display:block; font-weight:800; color:#134E4A; margin:4px 0;">這份 PDF 自己的 txt 答案</label>'
            + '<textarea class="mz-pdf-exam-raw" rows="5" placeholder="直接貼上課本解答原文，例如：&#10;Quiz 1, p. 50&#10;2. been 10. stopped" '
            + 'style="width:100%; box-sizing:border-box; font-family:monospace; font-size:0.8rem; padding:8px; border:1px solid #0F766E; border-radius:6px;">'
            + esc(item.answer_text_raw || '') + '</textarea>'
            + '<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">'
            + '<button type="button" class="mz-pdf-exam-parse btn" style="background:#0F766E; color:white; border:1px solid #0F766E; border-radius:6px; font-weight:800; cursor:pointer;">解析成答案清單</button>'
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
        return (
            '<div class="mz-card mz-pdf-exam-card mz-pdf-exam-grouped">'
            + '<div style="font-weight:800; color:#0E7490;">群組　試卷範本　' + esc(templateName(first.exam_template_key)) + '</div>'
            + comboNameBlockHtml(first, assigned)
            + items.map(function (it) { return appliedMemberHtml(it, { insideGroup: true }); }).join('')
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

    function makeInsertedBankRow(item, template) {
        var section = template.section || '(未分類)';
        var itemNo = String(template.item_no || '').trim() || '?';
        var part = template.part || null;
        var group = template.group || null;
        var blank = Number(template.blank_index) || 1;
        var key = window.PdfExamPaper.makeKey(section, itemNo, part, blank, group);
        var used = {};
        (item.parsed_bank || []).forEach(function (b) { if (b && b.key) used[b.key] = true; });
        while (used[key] && blank < 99) {
            blank += 1;
            key = window.PdfExamPaper.makeKey(section, itemNo, part, blank, group);
        }
        return {
            key: key,
            section: section,
            item_no: itemNo,
            part: part,
            group: group,
            blank_index: blank,
            answer_text: '',
            accepted_answers: [],
            _manual: true
        };
    }

    function refreshMemberBank(card, item) {
        var wrap = card.querySelector('.mz-pdf-exam-bank-wrap');
        if (wrap) wrap.innerHTML = bankPreviewHtml(item);
        var msg = card.querySelector('.mz-pdf-exam-msg');
        if (msg) {
            msg.style.color = '#0F766E';
            msg.textContent = '已確認答案 ' + ((item.parsed_bank || []).length) + ' 題（尚未儲存）';
        }
    }

    function openAddRowModal(card, item) {
        var dirty = false;
        var modalId = 'mz-pdf-exam-add-row';
        window.ModalOverlay.open({
            id: modalId,
            tier: 'B',
            prompt: true,
            isDirty: function () { return dirty; },
            contentHtml: '<div style="background:white; padding:16px; border-radius:10px; min-width:320px; max-width:420px;">'
                + '<div style="font-weight:800; color:#0F766E; margin-bottom:10px;">手動新增一題</div>'
                + '<label style="display:block; font-weight:700; font-size:0.82rem; margin-bottom:8px;">大題（例如 Quiz 1；留空＝未分類）'
                + '<input id="mz-pdf-add-sec" type="text" style="width:100%; margin-top:4px; padding:6px; box-sizing:border-box;"></label>'
                + '<label style="display:block; font-weight:700; font-size:0.82rem; margin-bottom:8px;">題號（例如 12）'
                + '<input id="mz-pdf-add-no" type="text" style="width:100%; margin-top:4px; padding:6px; box-sizing:border-box;"></label>'
                + '<label style="display:block; font-weight:700; font-size:0.82rem; margin-bottom:8px;">子項（若這題有 A/B 兩格才填，否則留空）'
                + '<input id="mz-pdf-add-part" type="text" style="width:100%; margin-top:4px; padding:6px; box-sizing:border-box;"></label>'
                + '<div style="margin-top:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">'
                + '<button type="button" class="btn btn-primary" id="mz-pdf-add-ok" style="background:#0F766E; color:white; border:1px solid #0F766E; font-weight:800;">新增</button>'
                + '<button type="button" class="btn" id="mz-pdf-add-cancel" style="background:white; color:#134E4A; border:1px solid #CBD5E1; font-weight:800;">取消</button>'
                + '<span id="mz-pdf-add-err" style="font-weight:700; color:#B91C1C;"></span>'
                + '</div></div>',
            onMount: function (overlay) {
                overlay.querySelectorAll('input').forEach(function (inp) {
                    inp.addEventListener('input', function () { dirty = true; });
                });
                overlay.querySelector('#mz-pdf-add-cancel').addEventListener('click', function () {
                    window.ModalOverlay.requestClose(modalId);
                });
                overlay.querySelector('#mz-pdf-add-ok').addEventListener('click', function () {
                    var section = String((overlay.querySelector('#mz-pdf-add-sec') || {}).value || '(未分類)').replace(/\s+/g, ' ').trim() || '(未分類)';
                    var itemNo = String((overlay.querySelector('#mz-pdf-add-no') || {}).value || '').trim();
                    var err = overlay.querySelector('#mz-pdf-add-err');
                    if (!itemNo) {
                        if (err) err.textContent = '請填題號';
                        return;
                    }
                    var part = String((overlay.querySelector('#mz-pdf-add-part') || {}).value || '').trim().toUpperCase() || null;
                    var key = window.PdfExamPaper.makeKey(section, itemNo, part);
                    if ((item.parsed_bank || []).some(function (b) { return b.key === key; })) {
                        if (err) err.textContent = '這個題號已經存在，請改用清單裡的欄位直接修改';
                        return;
                    }
                    item.parsed_bank = item.parsed_bank || [];
                    item.parsed_bank.push({
                        key: key,
                        section: section,
                        item_no: itemNo,
                        part: part,
                        answer_text: '',
                        accepted_answers: [],
                        _manual: true
                    });
                    dirty = false;
                    window.ModalOverlay.close(modalId);
                    refreshMemberBank(card, item);
                });
            }
        });
    }

    async function handleBankAct(act, idx, card, item) {
        if (act === 'add') {
            openAddRowModal(card, item);
            return;
        }
        var bank = item.parsed_bank || [];
        if (act === 'up' || act === 'down') {
            var otherIdx = siblingIndexInSection(bank, idx, act === 'up' ? -1 : 1);
            if (otherIdx < 0) return;
            var tmp = bank[idx];
            bank[idx] = bank[otherIdx];
            bank[otherIdx] = tmp;
            refreshMemberBank(card, item);
            return;
        }
        if (act === 'ins-before' || act === 'ins-after') {
            var template = bank[idx];
            if (!template) return;
            var row = makeInsertedBankRow(item, template);
            bank.splice(Number(idx) + (act === 'ins-after' ? 1 : 0), 0, row);
            refreshMemberBank(card, item);
            return;
        }
        if (act === 'del') {
            if (!(await window.ModalOverlay.confirm('刪除這一題答案？若已經在 PDF 上畫框對應這一題，那個框不會自動刪除，會變成「未指定題目」。'))) return;
            bank.splice(idx, 1);
            refreshMemberBank(card, item);
        }
    }

    async function parseCard(card, item) {
        var rawEl = card.querySelector('.mz-pdf-exam-raw');
        var msg = card.querySelector('.mz-pdf-exam-msg');
        var raw = rawEl ? rawEl.value : '';
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.parseAnswerText !== 'function') {
            throw new Error('找不到解答解析。');
        }
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
        var parsed = window.PdfExamPaper.parseAnswerText(raw);
        if (!parsed.length && msg) {
            msg.style.color = '#B45309';
            msg.textContent = '沒有解析出題目，請確認有「數字.」開頭的題號';
        }
        item.answer_text_raw = raw;
        item.section_page_hints = Object.assign({}, item.section_page_hints || {}, parsed.sectionPageHints || {});
        var freshKeys = {};
        parsed.forEach(function (b) { if (b && b.key) freshKeys[b.key] = true; });
        var prevByKey = {};
        (item.parsed_bank || []).forEach(function (b) { if (b && b.key) prevByKey[b.key] = b; });
        var merged = parsed.map(function (b) {
            var prev = prevByKey[b.key];
            if (prev && prev._manuallyEdited) {
                return {
                    key: b.key,
                    section: b.section,
                    item_no: b.item_no,
                    part: b.part,
                    group: b.group,
                    blank_index: b.blank_index,
                    answer_text: prev.answer_text,
                    accepted_answers: prev.accepted_answers,
                    _manuallyEdited: true
                };
            }
            return b;
        });
        var preservedManual = (item.parsed_bank || []).filter(function (b) { return b && !freshKeys[b.key] && b._manual; });
        item.parsed_bank = merged.concat(preservedManual);
        if (window.PdfExamPaper.buildSplitReview) {
            var prevReview = item.split_review || {};
            item.split_review = window.PdfExamPaper.buildSplitReview(item.parsed_bank, blankStats, {
                paperLabels: paperLabels,
                reattachLog: parsed.column_reattach || [],
                section_template_overrides: prevReview.section_template_overrides || {},
                teacher_located_boxes: prevReview.teacher_located_boxes || {}
            });
        }
        var wrap = card.querySelector('.mz-pdf-exam-bank-wrap');
        if (wrap) wrap.innerHTML = bankPreviewHtml(item);
        if (msg && parsed.length) {
            var review = item.split_review || {};
            var warnN = ((review.section_warnings || []).length) + Object.keys(review.flagged_keys || {}).length;
            msg.style.color = warnN ? '#B45309' : '#0F766E';
            msg.textContent = warnN
                ? ('已解析 ' + parsed.length + ' 題，有 ' + warnN + ' 處警示（解答組數／格數跟題目對不上），請看紅色標示（尚未儲存）')
                : ('已解析 ' + parsed.length + ' 題，請逐項確認（尚未儲存）');
        }
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
                refreshMemberBank(card, item);
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
                    btn.textContent = '儲存';
                    if (msg) { msg.style.color = '#0F766E'; msg.textContent = '已儲存（' + ((saved.parsed_bank || []).length) + ' 題）'; }
                    if (window.FeatureClassMaterialCombinations && typeof window.FeatureClassMaterialCombinations.renderMaterialZone === 'function') {
                        window.FeatureClassMaterialCombinations.renderMaterialZone();
                    }
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
        getItemById: getItemById
    };

    if (window.MaterialComboStrategies && typeof window.MaterialComboStrategies.register === 'function') {
        window.MaterialComboStrategies.register({
            kind: 'pdf',
            order: 20,
            packMode: 'pdf',
            usesMetaRange: false,
            showsExamStats: false,
            ensureLoaded: ensureLoaded,
            listAssignedForHomework: listAssignedForHomework,
            getAssignedById: getAssignedById,
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

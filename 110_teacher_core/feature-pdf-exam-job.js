/**
 * 📂 110_teacher_core/feature-pdf-exam-job.js
 * 🆕 PDF 考卷（task.type === 'pdf_exam'）老師端：全新、獨立的考試模式，跟現有 meta.json→quiz_paper
 * 出題管線（feature-exam-job.js／feature-material-layout-pairing.js／quiz-paper-builder.js）完全
 * 不共用邏輯層，只是「呼叫」QuizPaperBuilder.gradeAnswers 做批改，不修改任何既有檔案的行為。
 *
 * 流程（老師只做①②③，不用畫框、不用管空格在哪個座標）：
 * ① 從教材資料夾選考卷 PDF（跟 Excel／meta 同一套 01_My_Materials／00_Class_Materials；
 *    新檔上傳進所選教材夾，不准另存到班級「PDF考卷」）
 * ② 老師直接貼解答原始文字（老師已 OCR 好，不整理格式）→ PdfExamPaper.parseAnswerText 寬鬆解析
 *    → 老師在畫面上逐項確認/修正文字（最後一道防線，解析不保證 100% 準）
 * ③ 存進 task.raw_data.pdf_exam_job.parsed_bank[]：{ key, section, item_no, part, answer_text, accepted_answers }
 *
 * 💣 空格在 PDF 上的精確位置，本來想用電腦視覺（讀題號文字／掃底線像素）自動偵測，實測對掃描稿
 * 常常誤判（例如把標題粗體字、色塊當成底線，見討論記錄），而且老師事後也很難一眼看出哪裡配錯。
 * 改成：**由學生作答時自己依「答案清單的順序」逐一點出作答位置**（見 120_student_core/
 * feature-student-pdf-quiz.js），順序＝文字匡建立的順序（不用時間戳記，陣列 push 順序即等價），
 * 不是座標——完全不用猜多欄位版面怎麼分群，也不會被 OCR 誤判害到。老師端因此不再需要畫框／
 * 自動定位這一關。
 *
 * 資料只塞新的 raw_data key（pdf_exam_job／學生端 pdf_quiz_answers／pdf_quiz_result），跟既有
 * quiz_paper／quiz_answers／quiz_result 並存、互不覆寫。
 */
window.FeaturePdfExamJob = (function () {
    'use strict';

    var REVIEW_MODAL_ID = 'pdf-exam-review';

    var _reviewState = null;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function truncate(s, n) {
        s = String(s == null ? '' : s);
        return s.length > n ? (s.slice(0, n) + '…') : s;
    }

    function getBuilderTaskByPath(pathStr) {
        if (!window.BuilderStore || typeof window.BuilderStore.getState !== 'function') return null;
        var bState = window.BuilderStore.getState();
        if (!bState || !Array.isArray(bState.tasks)) return null;
        var arr = String(pathStr).split('-').map(Number);
        var list = bState.tasks;
        var node = null;
        for (var i = 0; i < arr.length; i++) {
            node = list[arr[i]];
            if (!node) return null;
            if (i < arr.length - 1) list = node.subTasks || [];
        }
        return node;
    }

    function defaultJob() {
        return {
            pdf_file_id: '',
            pdf_file_url: '',
            pdf_file_name: '',
            material_folder: '',
            material_root_kind: '',
            material_folder_id: '',
            exam_pdf_source: '',
            answer_text_raw: '',
            parsed_bank: [],
            updated_at: '',
            needs_regrade: false,
            section_page_hints: {}
        };
    }

    function ensureJob(task) {
        if (!task.raw_data) task.raw_data = {};
        if (!task.raw_data.pdf_exam_job || typeof task.raw_data.pdf_exam_job !== 'object') {
            task.raw_data.pdf_exam_job = defaultJob();
        }
        var job = task.raw_data.pdf_exam_job;
        if (!Array.isArray(job.parsed_bank)) job.parsed_bank = [];
        if (typeof job.answer_text_raw !== 'string') job.answer_text_raw = '';
        if (typeof job.needs_regrade !== 'boolean') job.needs_regrade = false;
        if (typeof job.material_folder !== 'string') job.material_folder = '';
        if (typeof job.material_root_kind !== 'string') job.material_root_kind = '';
        if (typeof job.material_folder_id !== 'string') job.material_folder_id = '';
        if (typeof job.exam_pdf_source !== 'string') job.exam_pdf_source = '';
        // 解答文字裡「Quiz N, p. NN」的課本印刷頁碼，輔助 detectSectionPageRanges 定位大題頁碼
        // （跟掃 PDF 標題文字是獨立的第二資訊來源，見 pdf-exam-paper.js）。
        if (!job.section_page_hints || typeof job.section_page_hints !== 'object') job.section_page_hints = {};
        // 舊版曾把「haven't, have never done」收成單列＋替代答案；打開編輯器就對照原始文字補拆，
        // 並標記 needs_regrade，避免老師還要自己按一次「解析」才看得到 1-B-1／1-B-2。
        if (window.PdfExamPaper && typeof window.PdfExamPaper.repairStaleCommaSplits === 'function') {
            if (window.PdfExamPaper.repairStaleCommaSplits(job)) {
                job.needs_regrade = true;
                job.split_review = null;
            }
        }
        return job;
    }

    /** 答案清單有任何變動（改字、加題、刪題、重新解析）都要標記「需要重新批改」，
     * 直到老師在複核頁按下「儲存並重新批改全班」才清掉——不然已批改的學生分數會悄悄跟新答案脫鉤。 */
    function markNeedsRegrade(pathStr, job) {
        job.needs_regrade = true;
        refreshStatusLine(pathStr, job);
    }

    // ------------------------------------------------------------------
    // ① 考卷 PDF＝教材夾全域檔（跟 Excel／meta 同一套，不另存到班級「PDF考卷」）
    // ------------------------------------------------------------------

    function uniqueFolderNamesFromEntry(entry) {
        var seen = {};
        var out = [];
        ((entry && entry.options) || []).forEach(function (o) {
            var name = String((o && o.folderName) || '').trim();
            if (!name || seen[name]) return;
            seen[name] = true;
            out.push(name);
        });
        return out;
    }

    function folderIdFromCatalog(classId, rootKind, folderName) {
        if (window.FeatureExamJob && typeof window.FeatureExamJob.getFolderIdForFolder === 'function') {
            var id = window.FeatureExamJob.getFolderIdForFolder(classId, rootKind, folderName);
            if (id) return id;
        }
        var pdfs = pdfOptionsForFolder(classId, rootKind, folderName);
        for (var i = 0; i < pdfs.length; i++) {
            if (pdfs[i] && pdfs[i].folderId) return pdfs[i].folderId;
        }
        return '';
    }

    function pdfOptionsForFolder(classId, rootKind, folderName) {
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.getMaterialPdfOptions !== 'function') return [];
        var folder = String(folderName || '').trim();
        if (!folder) return [];
        var folderU = folder.toUpperCase();
        return window.FeatureTimeline.getMaterialPdfOptions(classId, rootKind).filter(function (o) {
            return String((o && o.folderName) || '').trim().toUpperCase() === folderU;
        });
    }

    /** 用完整 fileId 對到教材夾裡的那一筆。多筆或對不到＝沒有，不准猜。 */
    function findPdfOptionByFileId(classId, fileId) {
        var want = String(fileId || '').trim();
        if (!want || !window.FeatureTimeline || typeof window.FeatureTimeline.getMaterialPdfOptions !== 'function') return null;
        var hits = [];
        ['teacher', 'class'].forEach(function (kind) {
            (window.FeatureTimeline.getMaterialPdfOptions(classId, kind) || []).forEach(function (o) {
                if (o && String(o.fileId || '') === want) hits.push(o);
            });
        });
        return hits.length === 1 ? hits[0] : null;
    }

    function currentFolderValue(job) {
        if (!job || !job.material_folder) return '';
        return String(job.material_root_kind || 'teacher') + '::' + job.material_folder;
    }

    function parseFolderValue(value) {
        var raw = String(value || '');
        var idx = raw.indexOf('::');
        if (idx < 1) return { rootKind: '', folderName: '' };
        var kind = raw.slice(0, idx);
        if (kind !== 'teacher' && kind !== 'class') return { rootKind: '', folderName: '' };
        return { rootKind: kind, folderName: raw.slice(idx + 2) };
    }

    function buildPdfExamFolderOptionsHtml(job, teacherEntry, classEntry) {
        var current = currentFolderValue(job);
        var matched = !current;
        function optionHtml(kind, folderName) {
            var v = kind + '::' + folderName;
            if (v === current) matched = true;
            return '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(folderName) + '</option>';
        }
        function groupHtml(label, folders, kind) {
            if (!folders.length) return '';
            return '<optgroup label="' + esc(label) + '">' + folders.map(function (f) { return optionHtml(kind, f); }).join('') + '</optgroup>';
        }
        var html = '<option value="">— 請選擇教材資料夾 —</option>';
        html += groupHtml('👤 老師個人', uniqueFolderNamesFromEntry(teacherEntry), 'teacher');
        html += groupHtml('🏫 班級', uniqueFolderNamesFromEntry(classEntry), 'class');
        if (!matched && job && job.material_folder) {
            html += '<option value="' + esc(current) + '" selected>⚠️ ' + esc(job.material_folder) + '</option>';
        }
        return html;
    }

    function buildPdfExamFileOptionsHtml(job, pdfs) {
        var html = '<option value="">— 請選擇 PDF —</option>';
        var matched = !job.pdf_file_id;
        (pdfs || []).forEach(function (o) {
            if (!o || !o.fileId) return;
            var selected = String(o.fileId) === String(job.pdf_file_id || '');
            if (selected) matched = true;
            html += '<option value="' + esc(o.fileId) + '"' + (selected ? ' selected' : '') + '>' + esc(o.fileName || o.fileId) + '</option>';
        });
        if (!matched && job.pdf_file_id) {
            html += '<option value="' + esc(job.pdf_file_id) + '" selected>⚠️ ' + esc(job.pdf_file_name || job.pdf_file_id) + '（不在此資料夾清單）</option>';
        }
        return html;
    }

    function fillPdfExamFileSelect(pathStr, job, classId) {
        var fileSel = document.getElementById('pdf-exam-file-' + pathStr);
        if (!fileSel) return;
        if (!job.material_folder) {
            fileSel.innerHTML = '<option value="">請先選教材資料夾</option>';
            fileSel.disabled = true;
            return;
        }
        fileSel.disabled = false;
        fileSel.innerHTML = buildPdfExamFileOptionsHtml(job, pdfOptionsForFolder(classId, job.material_root_kind, job.material_folder));
    }

    async function hydratePdfMaterialPickers(pathStr, force) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        var classId = bState ? bState.classId : '';
        var folderSel = document.getElementById('pdf-exam-folder-' + pathStr);
        var hintEl = document.getElementById('pdf-exam-folder-hint-' + pathStr);
        if (!folderSel) return;
        if (!window.FeatureTimeline || typeof window.FeatureTimeline.ensureMetaCatalog !== 'function') {
            folderSel.innerHTML = '<option value="">（教材清單模組未載入）</option>';
            return;
        }
        try {
            await Promise.all([
                window.FeatureTimeline.ensureMetaCatalog(classId, 'teacher', { force: !!force }).catch(function (err) {
                    console.error('[FeaturePdfExamJob] catalog teacher', err);
                    return [];
                }),
                window.FeatureTimeline.ensureMetaCatalog(classId, 'class', { force: !!force }).catch(function (err) {
                    console.error('[FeaturePdfExamJob] catalog class', err);
                    return [];
                })
            ]);
        } catch (err) {
            console.error('[FeaturePdfExamJob] catalog', err);
            folderSel.innerHTML = '<option value="">教材清單載入失敗</option>';
            if (hintEl) hintEl.textContent = (err && err.message) ? err.message : String(err);
            return;
        }
        if (!job.material_folder && job.pdf_file_id) {
            var hit = findPdfOptionByFileId(classId, job.pdf_file_id);
            if (hit) {
                job.material_folder = hit.folderName || '';
                job.material_root_kind = hit.rootKind || '';
                job.material_folder_id = hit.folderId || '';
                job.exam_pdf_source = 'material';
            }
        }
        var teacherEntry = window.FeatureTimeline.getMetaCatalogEntry(classId, 'teacher');
        var classEntry = window.FeatureTimeline.getMetaCatalogEntry(classId, 'class');
        folderSel.innerHTML = buildPdfExamFolderOptionsHtml(job, teacherEntry, classEntry);
        fillPdfExamFileSelect(pathStr, job, classId);
        if (hintEl) {
            var debugFn = window.FeatureTimeline.getMetaCatalogDebugText;
            var tDbg = typeof debugFn === 'function' ? debugFn(classId, 'teacher') : '';
            if (tDbg && /lm-2026-08-21-scriptfiles/.test(tDbg)) {
                hintEl.textContent = 'GAS 還在跑舊部署（未列出教材夾 PDF）。請重新部署 Web App 後按「重新整理清單」。';
                hintEl.style.color = '#B91C1C';
            } else {
                hintEl.textContent = '';
            }
        }
        var statusEl = document.getElementById('pdf-exam-file-status-' + pathStr);
        if (statusEl) statusEl.innerHTML = renderFileStatusHtml(job);
    }

    function onMaterialFolderChange(selEl, pathStr) {
        if (window.BuilderStore) window.BuilderStore.sync();
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var parsed = parseFolderValue(selEl && selEl.value);
        job.material_root_kind = parsed.rootKind;
        job.material_folder = parsed.folderName;
        var bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        var classId = bState ? bState.classId : '';
        job.material_folder_id = parsed.folderName ? folderIdFromCatalog(classId, parsed.rootKind, parsed.folderName) : '';
        fillPdfExamFileSelect(pathStr, job, classId);
    }

    function onMaterialFileChange(selEl, pathStr) {
        if (window.BuilderStore) window.BuilderStore.sync();
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var fileId = String((selEl && selEl.value) || '').trim();
        if (!fileId) return;
        var bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        var classId = bState ? bState.classId : '';
        var pdfs = pdfOptionsForFolder(classId, job.material_root_kind, job.material_folder);
        var hit = null;
        for (var i = 0; i < pdfs.length; i++) {
            if (pdfs[i] && String(pdfs[i].fileId) === fileId) { hit = pdfs[i]; break; }
        }
        if (!hit) {
            if (fileId === String(job.pdf_file_id || '')) return;
            window.showFlash('這個 PDF 不在所選教材夾清單裡', 'error');
            return;
        }
        job.pdf_file_id = hit.fileId;
        job.pdf_file_name = hit.fileName || '';
        job.pdf_file_url = 'https://drive.google.com/file/d/' + hit.fileId + '/view';
        job.material_folder = hit.folderName || job.material_folder;
        job.material_root_kind = hit.rootKind || job.material_root_kind;
        job.material_folder_id = hit.folderId || job.material_folder_id;
        job.exam_pdf_source = 'material';
        job.pack_pdf_inherited = false;
        job.pack_pdf_pages = [];
        job.updated_at = new Date().toISOString();
        var statusEl = document.getElementById('pdf-exam-file-status-' + pathStr);
        if (statusEl) statusEl.innerHTML = renderFileStatusHtml(job);
    }

    function renderFileStatusHtml(job) {
        if (!job.pdf_file_id) return '<span style="color:#94A3B8;">尚未選擇考卷 PDF</span>';
        var link = job.pdf_file_url
            ? ('<a href="' + esc(job.pdf_file_url) + '" target="_blank" rel="noopener">' + esc(job.pdf_file_name || '查看檔案') + '</a>')
            : esc(job.pdf_file_name || '');
        var folderHint = job.material_folder
            ? (' <span style="color:#64748B; font-weight:700;">（' + esc((job.material_root_kind === 'class' ? '班級' : '老師') + '／' + job.material_folder) + '）</span>')
            : '';
        return '<span style="color:#047857; font-weight:800;">✅ ' + link + '</span>' + folderHint;
    }

    function handlePdfFileChange(inputEl, pathStr) {
        var file = inputEl.files && inputEl.files[0];
        if (!file) return;
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
            window.showFlash('請選擇 PDF 檔案', 'error');
            inputEl.value = '';
            return;
        }
        if (file.size > 30 * 1024 * 1024) {
            // 💣 上傳走 GAS，要先轉 base64 再送出，體積會再膨脹約 33%；30MB 已經是留了緩衝的上限，
            // 真正該做的是請老師壓縮掃描檔（灰階/黑白＋200dpi 上下即可），不是把這個上限繼續往上調——
            // 調太大只會讓上傳更容易在 Apps Script 端逾時失敗，體驗更差。
            window.showFlash('檔案過大（超過 30MB），掃描稿通常可以壓縮到幾 MB 內畫質也不會變差，請先用 PDF 壓縮工具處理後再上傳', 'error');
            inputEl.value = '';
            return;
        }
        if (window.BuilderStore) window.BuilderStore.sync();
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        if (!job.material_folder || !job.material_root_kind) {
            window.showFlash('請先選教材資料夾，檔案會上傳到那個資料夾（跟 Excel 同一套）', 'warning');
            inputEl.value = '';
            return;
        }
        job.pack_pdf_inherited = false;
        job.exam_pdf_source = 'material';
        var statusEl = document.getElementById('pdf-exam-file-status-' + pathStr);
        if (statusEl) statusEl.innerHTML = '⏳ 上傳中…';
        var reader = new FileReader();
        reader.onload = function (e) {
            var base64 = String(e.target.result).split(',')[1];
            uploadPdfToDrive(base64, file.name, file.type || 'application/pdf', pathStr, job).catch(function (err) {
                console.error('[FeaturePdfExamJob] upload', err);
                window.showFlash('PDF 上傳失敗：' + (err.message || err), 'error');
                if (statusEl) statusEl.innerHTML = renderFileStatusHtml(job);
            });
        };
        reader.onerror = function () { window.showFlash('讀取檔案失敗', 'error'); };
        reader.readAsDataURL(file);
        inputEl.value = '';
    }

    async function uploadPdfToDrive(base64, fileName, mimeType, pathStr, job) {
        if (!window.GasService || typeof window.GasService.uploadMaterialFile !== 'function') {
            throw new Error('GasService 尚未載入');
        }
        var bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        var classId = bState ? bState.classId : '';
        var folderId = String(job.material_folder_id || '').trim();
        if (!folderId) folderId = folderIdFromCatalog(classId, job.material_root_kind, job.material_folder);
        if (!folderId) throw new Error('找不到這個教材資料夾的 Drive ID，請按「重新整理清單」後再試');
        job.material_folder_id = folderId;
        var uploadResult = await window.GasService.uploadMaterialFile(base64, fileName, mimeType, folderId);
        job.pdf_file_id = uploadResult.fileId;
        job.pdf_file_url = uploadResult.fileUrl || '';
        job.pdf_file_name = uploadResult.finalFileName || fileName;
        job.exam_pdf_source = 'material';
        job.pack_pdf_inherited = false;
        job.pack_pdf_pages = [];
        job.updated_at = new Date().toISOString();
        if (window.FeatureTimeline && typeof window.FeatureTimeline.addMaterialPdfOption === 'function') {
            window.FeatureTimeline.addMaterialPdfOption(classId, job.material_root_kind, {
                folderName: job.material_folder,
                folderId: folderId,
                fileName: job.pdf_file_name,
                fileId: job.pdf_file_id
            });
        }
        if (window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function') {
            try {
                await window.FeatureTimeline.ensureMetaCatalog(classId, job.material_root_kind, { force: true });
                if (typeof window.FeatureTimeline.addMaterialPdfOption === 'function') {
                    window.FeatureTimeline.addMaterialPdfOption(classId, job.material_root_kind, {
                        folderName: job.material_folder,
                        folderId: folderId,
                        fileName: job.pdf_file_name,
                        fileId: job.pdf_file_id
                    });
                }
            } catch (_e) {}
        }
        fillPdfExamFileSelect(pathStr, job, classId);
        var statusEl = document.getElementById('pdf-exam-file-status-' + pathStr);
        if (statusEl) statusEl.innerHTML = renderFileStatusHtml(job);
        window.showFlash('✅ 已上傳到教材夾「' + job.material_folder + '」：' + job.pdf_file_name, 'success');
    }

    // ------------------------------------------------------------------
    // ② 解答文字解析與確認清單
    // ------------------------------------------------------------------

    function renderSplitReviewHtml(job, pathStr) {
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.splitReviewPanelHtml !== 'function') return '';
        return window.PdfExamPaper.splitReviewPanelHtml(job && job.split_review, {
            locateBtnClass: 'pdf-exam-use-locate',
            pathStr: pathStr || '',
            examTemplateKey: job && job.exam_template_key,
            bank: job && job.parsed_bank
        });
    }

    function renderBankTableHtml(pathStr, job) {
        if (job && Array.isArray(job.parsed_bank) && window.PdfExamPaper && typeof window.PdfExamPaper.normalizeAllItemBlanks === 'function') {
            window.PdfExamPaper.normalizeAllItemBlanks(job.parsed_bank);
        }
        var bank = job.parsed_bank || [];
        if (!bank.length) {
            return '<div style="color:#94A3B8; font-size:0.85rem; padding:8px;">尚未解析出任何答案，請貼上文字後按「解析未確定的答案」</div>';
        }
        var flagged = (job.split_review && job.split_review.flagged_keys) || {};
        var warnedSections = {};
        ((job.split_review && job.split_review.section_warnings) || []).forEach(function (w) {
            warnedSections[String(w.section || '')] = true;
        });
        ((job.split_review && job.split_review.missing_sections) || []).forEach(function (m) {
            if (m && m.section) warnedSections[String(m.section)] = true;
        });
        var groups = (typeof window.PdfExamPaper.groupItemsBySectionWithMissing === 'function')
            ? window.PdfExamPaper.groupItemsBySectionWithMissing(bank, job.split_review && job.split_review.missing_sections)
            : window.PdfExamPaper.groupItemsBySection(bank);
        var btnBase = 'padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:800; cursor:pointer; line-height:1.2;';
        var btnOn = btnBase + ' border:1px solid #7DD3FC; background:#E0F2FE; color:#0369A1;';
        var btnOff = btnBase + ' border:1px solid #E2E8F0; background:#F1F5F9; color:#94A3B8; cursor:not-allowed;';
        var btnAdd = btnBase + ' border:1px solid #99F6E4; background:#CCFBF1; color:#0F766E;';
        var btnDel = btnBase + ' border:1px solid #FECACA; background:#FEF2F2; color:#B91C1C;';
        var activeG = (window.PdfExamPaper && typeof window.PdfExamPaper.pickBankSection === 'function')
            ? window.PdfExamPaper.pickBankSection(groups, job._bankSection)
            : (groups[0] || null);
        if (activeG) job._bankSection = activeG.section || '';
        var g = activeG || { section: '', items: [] };
        var confirmed = window.PdfExamPaper && typeof window.PdfExamPaper.isSectionConfirmed === 'function'
            && window.PdfExamPaper.isSectionConfirmed(job.split_review, g.section);
        var secWarn = !confirmed && (!!warnedSections[g.section] || !!g.missing);
        var confirmBtn = (g.section && window.PdfExamPaper && typeof window.PdfExamPaper.sectionConfirmButtonHtml === 'function')
            ? window.PdfExamPaper.sectionConfirmButtonHtml(g.section, job.split_review, {
                btnClass: 'pdf-exam-confirm-section',
                pathStr: pathStr,
                confirmLabel: '確認無誤',
                reparseClass: 'pdf-exam-reparse-section'
            })
            : '';
        var lastShownGroup = null;
        var rowsHtml = (g.items || []).length
            ? g.items.map(function (bk) {
                var idx = bank.indexOf(bk);
                var flagReason = confirmed ? '' : (flagged[bk.key] || '');
                var isFlag = !!flagReason || secWarn;
                var rowBg = isFlag ? '#FEF2F2' : 'transparent';
                var labelColor = isFlag ? '#B91C1C' : '#0369A1';
                var inputBorder = isFlag ? '#F87171' : '#CBD5E1';
                var inputColor = isFlag ? '#B91C1C' : '#0F172A';
                var sameGroup = g.items.filter(function (x) { return (x.group || '') === (bk.group || ''); });
                var posInGroup = sameGroup.indexOf(bk);
                var canUp = posInGroup > 0;
                var canDown = posInGroup < sameGroup.length - 1;
                var groupHead = '';
                if (bk.group && bk.group !== lastShownGroup) {
                    groupHead = '<div style="font-size:0.75rem; font-weight:800; color:#0F766E; margin:8px 0 2px;">' + esc(bk.group) + '</div>';
                }
                lastShownGroup = bk.group || lastShownGroup;
                var suffix = (bk.part ? ('-' + bk.part) : '') + (bk.blank_index ? ('-' + bk.blank_index) : '');
                return groupHead + (
                    '<div class="pdf-exam-bank-row" data-idx="' + idx + '" data-section="' + esc(g.section || '') + '" style="display:flex; gap:6px; align-items:center; padding:4px 0; border-bottom:1px solid ' + (isFlag ? '#FECACA' : '#E0F2FE') + '; background:' + rowBg + ';"'
                        + (flagReason ? ' title="' + esc(flagReason) + '"' : '') + '>' +
                        '<span style="display:inline-flex; align-items:center; gap:2px; width:88px; flex-shrink:0; font-size:0.78rem; color:' + labelColor + '; font-weight:800;">' +
                            (bk.group ? esc(bk.group) + '-' : '') +
                            '<input type="text" class="pdf-exam-itemno" data-idx="' + idx + '" value="' + esc(bk.item_no || '') + '" title="題號，解析錯了可以直接改" style="width:2.2em; padding:2px 3px; font-size:0.76rem; font-weight:800; text-align:center; border:1px solid ' + inputBorder + '; color:' + labelColor + ';" ' +
                                'onchange="window.FeaturePdfExamJob.updateBankField(\'' + pathStr + '\', ' + idx + ', \'item_no\', this.value)">' +
                            (suffix ? '<span>' + esc(suffix) + '</span>' : '') +
                        '</span>' +
                        '<input type="text" value="' + esc(bk.answer_text) + '" placeholder="答案" style="flex:1; min-width:100px; padding:6px 8px; font-size:0.9rem; border:1px solid ' + inputBorder + '; border-radius:4px; color:' + inputColor + '; font-weight:' + (isFlag ? '800' : '400') + ';" ' +
                            'onchange="window.FeaturePdfExamJob.updateBankField(\'' + pathStr + '\', ' + idx + ', \'answer_text\', this.value)">' +
                        '<input type="text" value="' + esc(window.PdfExamPaper.formatAcceptedAnswerList(bk.accepted_answers)) + '" placeholder="其他可接受答案（用 || 分隔）" style="flex:1; min-width:110px; padding:6px 8px; font-size:0.9rem; border:1px solid ' + inputBorder + '; border-radius:4px; color:' + inputColor + ';" ' +
                            'onchange="window.FeaturePdfExamJob.updateBankField(\'' + pathStr + '\', ' + idx + ', \'accepted_answers\', this.value)">' +
                        '<span style="display:flex; gap:3px; flex-shrink:0; white-space:nowrap;">' +
                            '<button type="button" title="上移" style="' + (canUp ? btnOn : btnOff) + '" ' + (canUp ? 'onclick="window.FeaturePdfExamJob.moveBankRow(\'' + pathStr + '\', ' + idx + ', -1)"' : 'disabled') + '>↑</button>' +
                            '<button type="button" title="下移" style="' + (canDown ? btnOn : btnOff) + '" ' + (canDown ? 'onclick="window.FeaturePdfExamJob.moveBankRow(\'' + pathStr + '\', ' + idx + ', 1)"' : 'disabled') + '>↓</button>' +
                            '<button type="button" title="在上方加一筆" style="' + btnAdd + '" onclick="window.FeaturePdfExamJob.insertBankRow(\'' + pathStr + '\', ' + idx + ', 0)">＋上</button>' +
                            '<button type="button" title="在下方加一筆" style="' + btnAdd + '" onclick="window.FeaturePdfExamJob.insertBankRow(\'' + pathStr + '\', ' + idx + ', 1)">＋下</button>' +
                            '<button type="button" title="刪除" style="' + btnDel + '" onclick="window.FeaturePdfExamJob.removeBankRow(\'' + pathStr + '\', ' + idx + ')">🗑</button>' +
                        '</span>' +
                    '</div>'
                );
            }).join('')
            : '<div style="font-size:0.76rem; font-weight:700; color:' + (secWarn ? '#B91C1C' : '#0369A1') + '; padding:6px 0;">這一組在解答裡沒有列出來的題（沒有捨棄）。請核對原文，或改用老師定位。</div>';
        var tabs = (window.PdfExamPaper && typeof window.PdfExamPaper.bankSectionTabsHtml === 'function' && groups.length > 1)
            ? window.PdfExamPaper.bankSectionTabsHtml(groups, g.section, {
                tabClass: 'pdf-exam-quiz-tab',
                review: job.split_review,
                warnedSections: warnedSections,
                pathStr: pathStr
            })
            : '';
        return tabs
            + '<div style="display:flex; align-items:center; flex-wrap:wrap; font-weight:800; color:' + (secWarn ? '#B91C1C' : '#0369A1') + '; font-size:0.82rem; margin:0 0 6px;">📘 ' + esc(g.section || '') + (secWarn ? ' ⚠' : '') + confirmBtn + '</div>'
            + '<div class="pdf-exam-bank-with-paper">'
            + ((window.PdfExamPaper && typeof window.PdfExamPaper.sectionPaperPreviewHtml === 'function')
                ? window.PdfExamPaper.sectionPaperPreviewHtml({ section: g.section })
                : '')
            + '<div class="mz-pdf-exam-bank" style="border:1px solid #E0F2FE; border-radius:6px; padding:10px;">' + rowsHtml + '</div>'
            + '</div>';
    }

    function renderStatusLineHtml(job) {
        var bankN = (job.parsed_bank || []).length;
        var regradeWarning = job.needs_regrade
            ? ' · <span style="color:#B91C1C; font-weight:900;">⚠ 答案有更新，尚未替已作答的學生重新批改——請到下面「查看/複核學生作答」按重新批改</span>'
            : '';
        return '已確認答案 ' + bankN + ' 題'
            + (job.pdf_file_id ? '' : ' · ⚠ 尚未上傳 PDF')
            + (bankN ? ' · 學生作答時會自己在 PDF 上點出每一題的作答位置，這裡不用畫框' : '')
            + regradeWarning;
    }

    function refreshBankTable(pathStr, job, anchor) {
        if (anchor && anchor.section) job._bankSection = anchor.section;
        var el = document.getElementById('pdf-exam-bank-' + pathStr);
        var snap = (anchor && anchor.snap) || ((window.PdfExamPaper && typeof window.PdfExamPaper.snapshotScroller === 'function')
            ? window.PdfExamPaper.snapshotScroller(el)
            : []);
        if (el) el.innerHTML = renderBankTableHtml(pathStr, job);
        if (window.PdfExamPaper && typeof window.PdfExamPaper.afterBankRedraw === 'function') {
            window.PdfExamPaper.afterBankRedraw(el, snap, anchor || null);
        }
        if (window.PdfExamPaper && typeof window.PdfExamPaper.mountSectionPaperPreview === 'function') {
            window.PdfExamPaper.mountSectionPaperPreview(el, {
                pdfFileId: job.pdf_file_id,
                section: job._bankSection || '',
                bank: job.parsed_bank,
                sectionPageHints: job.section_page_hints
            });
        }
        var reviewEl = document.getElementById('pdf-exam-split-review-' + pathStr);
        if (reviewEl) reviewEl.innerHTML = renderSplitReviewHtml(job, pathStr);
    }

    function selectBankSection(pathStr, section) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        job._bankSection = String(section || '');
        refreshBankTable(pathStr, job, { section: job._bankSection });
    }

    function refreshStatusLine(pathStr, job) {
        var el = document.getElementById('pdf-exam-status-' + pathStr);
        if (el) el.innerHTML = renderStatusLineHtml(job);
    }

    /**
     * 解析解答文字：逗號預設拆成依序多格，但「No, she…」這種句首語氣詞不拆。
     * 若已上傳 PDF，再跟空格線／大題格數交叉檢查；對不上的大題與答案用紅字標出，請老師核對。
     * 空格線偵測不再偷偷改拆或不拆（見 pdf-exam-paper.js 事故說明）。
     */
    async function parseAnswerTextAction(pathStr, section) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var prevReview = job.split_review || {};
        var ta = document.getElementById('pdf-exam-answertext-' + pathStr);
        var raw = ta ? ta.value : job.answer_text_raw;
        job.answer_text_raw = raw;

        var blankStats = null;
        var paperLabels = [];
        if (job.pdf_file_id) {
            window.showFlash('⏳ 解析中…（對帳大題組、交叉檢查空格線）', 'info');
            try {
                var pdfDoc = await window.PdfExamPaper.loadPdfDocumentFromDrive(job.pdf_file_id);
                if (typeof window.PdfExamPaper.detectBlankReviewStats === 'function') {
                    blankStats = await window.PdfExamPaper.detectBlankReviewStats(pdfDoc);
                }
                if (typeof window.PdfExamPaper.scanPaperSectionLabels === 'function') {
                    paperLabels = await window.PdfExamPaper.scanPaperSectionLabels(pdfDoc);
                }
            } catch (err) {
                console.warn('[FeaturePdfExamJob] 考卷掃描失敗，仍完成文字解析', err);
                blankStats = null;
            }
        }

        var parseRaw = raw;
        if (section && typeof window.PdfExamPaper.sliceAnswerTextForSection === 'function') {
            parseRaw = window.PdfExamPaper.sliceAnswerTextForSection(raw, section);
        }
        var parsed = window.PdfExamPaper.parseAnswerText(parseRaw);
        if (!parsed.length) {
            window.showFlash('沒有解析出任何題目，請確認貼的文字裡有「數字.」開頭的題號', 'warning');
        }
        var freshHints = parsed.sectionPageHints || {};
        var nextHints = Object.assign({}, job.section_page_hints || {});
        function secKey(s) {
            return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        }
        var replacingKey = section ? secKey(section) : '';
        Object.keys(freshHints).forEach(function (sec) {
            var same = replacingKey && secKey(sec) === replacingKey;
            if (!same && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(prevReview, sec)) return;
            nextHints[sec] = freshHints[sec];
        });
        job.section_page_hints = nextHints;
        if (section) {
            var prevBank = job.parsed_bank || [];
            job.parsed_bank = (typeof window.PdfExamPaper.mergeParsedBankKeepingOrder === 'function')
                ? window.PdfExamPaper.mergeParsedBankKeepingOrder(prevBank, parsed, { section: section, txtWins: true })
                : parsed;
        } else {
            job.parsed_bank = (typeof window.PdfExamPaper.mergeParsedBankKeepingOrder === 'function')
                ? window.PdfExamPaper.mergeParsedBankKeepingOrder(job.parsed_bank || [], parsed, { keepConfirmed: true, review: prevReview })
                : parsed;
        }
        if (typeof window.PdfExamPaper.applyAcceptedSplitsToItem === 'function') {
            job.parsed_bank.forEach(function (b) {
                var same = replacingKey && secKey(b && b.section) === replacingKey;
                if (!same && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(prevReview, b && b.section)) return;
                window.PdfExamPaper.applyAcceptedSplitsToItem(b);
            });
        }
        job.split_review = window.PdfExamPaper.buildSplitReview(job.parsed_bank, blankStats, {
            paperLabels: paperLabels,
            reattachLog: parsed.column_reattach || [],
            section_template_overrides: prevReview.section_template_overrides || {},
            teacher_located_boxes: prevReview.teacher_located_boxes || {},
            confirmed_sections: prevReview.confirmed_sections || {}
        });
        if (section && window.PdfExamPaper.setSectionConfirmed) {
            window.PdfExamPaper.setSectionConfirmed(job.split_review, section, false);
            job._bankSection = section;
        }
        markNeedsRegrade(pathStr, job);
        refreshBankTable(pathStr, job, section ? { section: section } : undefined);
        var warnN = ((job.split_review.section_warnings || []).filter(function (w) {
            return w && !(window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(job.split_review, w.section));
        }).length)
            + Object.keys(job.split_review.flagged_keys || {}).filter(function (k) {
                var bk = (job.parsed_bank || []).filter(function (it) { return it && it.key === k; })[0];
                return !(bk && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(job.split_review, bk.section));
            }).length;
        window.showFlash(
            warnN
                ? ('⚠ 已解析出 ' + parsed.length + ' 題，有 ' + warnN + ' 處警示。核對後可按該 Quiz 旁「確認無誤」，再儲存作業')
                : ('✅ 已解析出 ' + parsed.length + ' 題，請逐項確認答案文字'),
            warnN ? 'warning' : 'success'
        );
    }

    function reparseSection(pathStr, section) {
        if (!section) return;
        parseAnswerTextAction(pathStr, section);
    }

    function confirmSection(pathStr, section) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task || !section) return;
        var job = ensureJob(task);
        job.split_review = job.split_review || {};
        if (window.PdfExamPaper.isSectionConfirmed(job.split_review, section)) return;
        window.PdfExamPaper.setSectionConfirmed(job.split_review, section, true);
        refreshBankTable(pathStr, job, { section: section });
        window.showFlash('「' + section + '」已確認無誤，請儲存作業', 'success');
    }

    function useTeacherLocate(pathStr, section) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task || !section) return;
        var job = ensureJob(task);
        if (!job.pdf_file_id) {
            window.showFlash('請先選這份考卷 PDF', 'warning');
            return;
        }
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.openTeacherLocateEditor !== 'function') return;
        var expected = (job.parsed_bank || []).filter(function (b) {
            return String(b.section || '').replace(/\s+/g, ' ').trim().toLowerCase()
                === String(section).replace(/\s+/g, ' ').trim().toLowerCase();
        }).length;
        var existing = window.PdfExamPaper.teacherBoxesForSection(job.split_review, section);
        window.PdfExamPaper.openTeacherLocateEditor({
            pdfFileId: job.pdf_file_id,
            sectionLabel: section,
            expectedCount: expected,
            boxes: existing,
            onSaved: function (boxes) {
                job.split_review = window.PdfExamPaper.setSectionTeacherLocate(job.split_review || {}, section, boxes);
                markNeedsRegrade(pathStr, job);
                refreshBankTable(pathStr, job, { section: section });
                window.showFlash('「' + section + '」已改用老師定位，請儲存作業', 'success');
            }
        });
    }

    function updateBankField(pathStr, idx, field, value) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var bk = job.parsed_bank[idx];
        if (!bk) return;
        if (field === 'answer_text') {
            bk.answer_text = value;
            if (typeof window.PdfExamPaper.applyAcceptedSplitsToItem === 'function') {
                window.PdfExamPaper.applyAcceptedSplitsToItem(bk);
            }
        } else if (field === 'accepted_answers') {
            bk.accepted_answers = window.PdfExamPaper.parseAcceptedAnswerList(value);
        } else if (field === 'item_no') {
            if (typeof window.PdfExamPaper.applyItemNoToBankRow === 'function') {
                window.PdfExamPaper.applyItemNoToBankRow(job.parsed_bank, idx, value);
            } else {
                bk.item_no = String(value || '').trim() || bk.item_no;
            }
        }
        bk._manuallyEdited = true;
        markNeedsRegrade(pathStr, job);
        var sec = bk.section || '';
        if (sec && window.PdfExamPaper.isSectionConfirmed && window.PdfExamPaper.isSectionConfirmed(job.split_review, sec)) {
            window.PdfExamPaper.setSectionConfirmed(job.split_review, sec, false);
            refreshBankTable(pathStr, job, { idx: idx, section: sec });
            return;
        }
        if (field === 'answer_text' || field === 'item_no') refreshBankTable(pathStr, job, { idx: idx, section: sec });
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

    function moveBankRow(pathStr, idx, dir) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var bank = job.parsed_bank || [];
        var otherIdx = siblingIndexInSection(bank, idx, dir);
        if (otherIdx < 0) return;
        var tmp = bank[idx];
        bank[idx] = bank[otherIdx];
        bank[otherIdx] = tmp;
        if (window.PdfExamPaper && typeof window.PdfExamPaper.numberItemBlanks === 'function') {
            window.PdfExamPaper.numberItemBlanks(bank, tmp);
        }
        markNeedsRegrade(pathStr, job);
        refreshBankTable(pathStr, job, { idx: otherIdx, section: tmp && tmp.section });
    }

    function insertBankRow(pathStr, idx, after) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var bank = job.parsed_bank || [];
        var template = bank[idx];
        if (!template) return;
        var ins = window.PdfExamPaper.insertBlankRow(bank, idx, after);
        if (!ins || !ins.row) return;
        markNeedsRegrade(pathStr, job);
        refreshBankTable(pathStr, job, { idx: ins.insertAt, section: ins.row.section });
    }

    async function removeBankRow(pathStr, idx) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        var bankEl = document.getElementById('pdf-exam-bank-' + pathStr);
        var snap = (window.PdfExamPaper && typeof window.PdfExamPaper.snapshotScroller === 'function')
            ? window.PdfExamPaper.snapshotScroller(bankEl)
            : [];
        if (!(await window.ModalOverlay.confirm('刪除這一題答案？若已經在 PDF 上畫框對應這一題，那個框不會自動刪除，會變成「未指定題目」。'))) return;
        var removed = job.parsed_bank.splice(idx, 1)[0];
        if (window.PdfExamPaper && typeof window.PdfExamPaper.numberItemBlanks === 'function') {
            window.PdfExamPaper.numberItemBlanks(job.parsed_bank, removed);
        }
        markNeedsRegrade(pathStr, job);
        refreshBankTable(pathStr, job, {
            idx: Math.min(idx, Math.max(0, job.parsed_bank.length - 1)),
            section: (job.parsed_bank[Math.min(idx, Math.max(0, job.parsed_bank.length - 1))] || {}).section,
            snap: snap
        });
    }

    function addBankRow(pathStr) {
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return;
        var job = ensureJob(task);
        if (!window.PdfExamPaper || typeof window.PdfExamPaper.openAddManualBankRowModal !== 'function') return;
        window.PdfExamPaper.openAddManualBankRowModal({
            getBank: function () {
                job.parsed_bank = job.parsed_bank || [];
                return job.parsed_bank;
            },
            onCommit: function (ins) {
                markNeedsRegrade(pathStr, job);
                refreshBankTable(pathStr, job, {
                    idx: ins.insertAt,
                    section: (ins.row && ins.row.section) || ''
                });
            }
        });
    }

    // ------------------------------------------------------------------
    // 內嵌編輯器 HTML（掛在時間軸卡片內，由 ui-timeline-templates.js 呼叫）
    // ------------------------------------------------------------------

    function renderInlineEditorHtml(pathStr, task) {
        var job = ensureJob(task);
        var FT = window.FeatureTimeline;
        var underCombo = !!(FT && typeof FT.parentRangeGroupPathOf === 'function' && FT.parentRangeGroupPathOf(pathStr));
        var packHostPath = underCombo && typeof FT.parentRangeGroupPathOf === 'function'
            ? FT.parentRangeGroupPathOf(pathStr)
            : pathStr;
        if (FT && typeof FT.applyRangePackToPdfExam === 'function' && typeof FT.buildRangePackForApply === 'function') {
            var pack = FT.buildRangePackForApply(packHostPath, { clamp: false, notify: false, useState: true });
            if (pack) FT.applyRangePackToPdfExam(task, pack);
            job = ensureJob(task);
        }
        var packHtml = (!underCombo && FT && typeof FT.renderRangePackHtml === 'function')
            ? FT.renderRangePackHtml(pathStr, task)
            : '';
        var packStatus = (underCombo && typeof FT.packPdfStatusForChildPath === 'function')
            ? String(FT.packPdfStatusForChildPath(pathStr) || '')
            : String(job.pack_pdf_status || '');
        var packMiss = !!packStatus && packStatus.indexOf('無對應資源') !== -1;
        var packStatusHtml = underCombo
            ? ('<div id="pdf-exam-pack-status-' + pathStr + '" style="margin-bottom:10px; font-size:0.85rem; font-weight:800; color:'
                + (packMiss ? '#B91C1C' : '#0F766E') + ';">'
                + (packStatus ? esc(packStatus) : '')
                + '</div>')
            : '';
        var bankHtml = renderBankTableHtml(pathStr, job);
        var statusHtml = renderStatusLineHtml(job);
        var bState = window.BuilderStore ? window.BuilderStore.getState() : null;
        var canReview = !!(bState && bState.editId) && job.parsed_bank.length > 0;
        var reviewBtnHtml = canReview
            ? ('<button type="button" class="btn btn-action" style="background:#7C3AED; color:white; border:none; padding:6px 12px; font-weight:800;" '
                + 'onclick="window.FeaturePdfExamJob.openReview(\'' + esc(String(bState.editId)) + '\',\'' + esc(String(task.id)) + '\')">📊 查看/複核學生作答</button>')
            : '<span style="font-size:0.78rem; color:#94A3B8;">（先儲存作業，之後才能查看學生作答）</span>';

        setTimeout(function () {
            hydratePdfMaterialPickers(pathStr, false);
            var el = document.getElementById('pdf-exam-bank-' + pathStr);
            if (el && window.PdfExamPaper && typeof window.PdfExamPaper.mountSectionPaperPreview === 'function') {
                var lateTask = getBuilderTaskByPath(pathStr);
                var lateJob = lateTask ? ensureJob(lateTask) : null;
                if (lateJob) {
                    window.PdfExamPaper.mountSectionPaperPreview(el, {
                        pdfFileId: lateJob.pdf_file_id,
                        section: lateJob._bankSection || '',
                        bank: lateJob.parsed_bank,
                        sectionPageHints: lateJob.section_page_hints
                    });
                }
            }
        }, 0);

        return (
            '<div style="margin-top:10px; padding:12px; background:#F0F9FF; border:1px solid #BAE6FD; border-radius:8px;">' +
                packHtml +
                '<div style="font-weight:900; color:#0369A1; margin-bottom:8px;">📄 PDF 考卷設定</div>' +
                packStatusHtml +
                '<div style="margin-bottom:10px;">' +
                    '<label style="font-size:0.85rem; font-weight:800; color:#334155; display:block; margin-bottom:4px;">① 考卷 PDF（教材夾裡的檔，跟 Excel 同一套資源）</label>' +
                    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">' +
                        '<select id="pdf-exam-folder-' + pathStr + '" style="min-width:200px; padding:6px 8px; font-size:0.85rem; font-weight:700;" ' +
                            'onchange="window.FeaturePdfExamJob.onMaterialFolderChange(this, \'' + pathStr + '\')">' +
                            '<option value="">⏳ 載入教材資料夾…</option>' +
                        '</select>' +
                        '<select id="pdf-exam-file-' + pathStr + '" style="min-width:220px; padding:6px 8px; font-size:0.85rem; font-weight:700;" ' +
                            'onchange="window.FeaturePdfExamJob.onMaterialFileChange(this, \'' + pathStr + '\')">' +
                            '<option value="">請先選教材資料夾</option>' +
                        '</select>' +
                        '<button type="button" class="btn" style="padding:6px 10px; font-size:0.8rem; font-weight:800;" ' +
                            'onclick="window.FeaturePdfExamJob.refreshMaterialPickers(\'' + pathStr + '\')">🔄 重新整理清單</button>' +
                    '</div>' +
                    '<div id="pdf-exam-folder-hint-' + pathStr + '" style="font-size:0.75rem; font-weight:700; margin-bottom:6px;"></div>' +
                    '<div style="font-size:0.78rem; color:#64748B; font-weight:700; margin-bottom:4px;">或上傳到這個教材夾（不會另存到「PDF考卷」）</div>' +
                    '<input type="file" accept="application/pdf,.pdf" onchange="window.FeaturePdfExamJob.handlePdfFileChange(this, \'' + pathStr + '\')">' +
                    '<div id="pdf-exam-file-status-' + pathStr + '" style="margin-top:4px; font-size:0.85rem;">' + renderFileStatusHtml(job) + '</div>' +
                '</div>' +
                '<div style="margin-bottom:10px;">' +
                    '<label style="font-size:0.85rem; font-weight:800; color:#334155; display:block; margin-bottom:4px;">② 貼上解答文字（原始格式即可，不用先整理成一行一題）</label>' +
                    '<textarea id="pdf-exam-answertext-' + pathStr + '" rows="6" placeholder="直接貼上課本解答原文，例如：&#10;Quiz 1, p. 50&#10;2. been 10. stopped&#10;..." ' +
                        'style="width:100%; font-family:monospace; font-size:0.82rem; padding:8px; border:1px solid #CBD5E1; border-radius:6px; box-sizing:border-box;">' + esc(job.answer_text_raw || '') + '</textarea>' +
                    '<div style="margin-top:6px;">' +
                        '<button type="button" class="btn btn-action" style="background:#0369A1; color:white; border:none; padding:6px 12px; font-weight:800;" ' +
                            'onclick="window.FeaturePdfExamJob.parseAnswerTextAction(\'' + pathStr + '\')">🔍 '
                            + window.PdfExamPaper.parseUnconfirmedAnswersLabelHtml()
                            + '</button>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-bottom:10px;">' +
                    '<label style="font-size:0.85rem; font-weight:800; color:#334155; display:block; margin-bottom:4px;">③ 答案清單（請逐項確認/修正——這是最後一道防線，自動解析不保證 100% 準）</label>' +
                    '<div id="pdf-exam-split-review-' + pathStr + '">' + renderSplitReviewHtml(job, pathStr) + '</div>' +
                    '<div id="pdf-exam-bank-' + pathStr + '">' + bankHtml + '</div>' +
                    '<button type="button" class="btn" style="font-size:0.8rem; padding:4px 10px; margin-top:6px;" onclick="window.FeaturePdfExamJob.addBankRow(\'' + pathStr + '\')">＋ 手動新增一題</button>' +
                '</div>' +
                '<div style="margin-bottom:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
                    '<div id="pdf-exam-status-' + pathStr + '" style="font-size:0.82rem; color:#334155; font-weight:700;">' + statusHtml + '</div>' +
                '</div>' +
                '<div>' + reviewBtnHtml + '</div>' +
            '</div>'
        );
    }

    function syncInlineEditor(pathStr, task) {
        if (!task) return;
        var job = ensureJob(task);
        var ta = document.getElementById('pdf-exam-answertext-' + pathStr);
        if (ta) job.answer_text_raw = ta.value;
        var FT = window.FeatureTimeline;
        var underCombo = !!(FT && typeof FT.parentRangeGroupPathOf === 'function' && FT.parentRangeGroupPathOf(pathStr));
        var packHostPath = underCombo && typeof FT.parentRangeGroupPathOf === 'function'
            ? FT.parentRangeGroupPathOf(pathStr)
            : pathStr;
        if (FT && typeof FT.applyRangePackToPdfExam === 'function' && typeof FT.buildRangePackForApply === 'function') {
            var pack = FT.buildRangePackForApply(packHostPath, { clamp: false, notify: false, useState: true });
            if (pack) FT.applyRangePackToPdfExam(task, pack);
        }
    }

    // ------------------------------------------------------------------
    // 💣 以下這段「畫框編輯器」已經不用了——空格位置改由學生作答時自己點出來（見檔頭說明），
    // 老師端不需要再管座標。保留舊函式但整段標記成 REMOVED_UNUSED，之後如果沒有其他地方
    // 引用可以直接砍掉；先保留避免有舊資料/舊呼叫路徑還在用到。
    // ------------------------------------------------------------------
    /* REMOVED_UNUSED_BOX_EDITOR_START
    async function openBoxEditor(pathStr) {
        if (window.BuilderStore) window.BuilderStore.sync();
        var task = getBuilderTaskByPath(pathStr);
        if (!task) return window.showFlash('找不到任務，請重新整理再試', 'error');
        var job = ensureJob(task);
        if (!job.pdf_file_id) return window.showFlash('請先上傳考卷 PDF', 'warning');
        if (!job.parsed_bank || !job.parsed_bank.length) return window.showFlash('請先貼上解答文字並按「解析未確定的答案」', 'warning');
        if (!window.ModalOverlay || typeof window.ModalOverlay.open !== 'function') return window.showFlash('ModalOverlay 未載入', 'error');
        if (!window.PdfExamPaper) return window.showFlash('PdfExamPaper 模組未載入', 'error');

        window.showFlash('⏳ 讀取 PDF…', 'info');
        var pdfDoc;
        try {
            pdfDoc = await window.PdfExamPaper.loadPdfDocumentFromDrive(job.pdf_file_id);
        } catch (err) {
            console.error('[FeaturePdfExamJob] loadPdfDocumentFromDrive', err);
            return window.showFlash('PDF 讀取失敗：' + (err.message || err), 'error');
        }

        _boxState = { pathStr: pathStr, task: task, job: job, pdfDoc: pdfDoc, numPages: pdfDoc.numPages, currentPage: 1 };
        _renderBoxEditorModal();
    }

    function _renderBoxEditorModal() {
        window.ModalOverlay.open({
            id: BOX_MODAL_ID,
            tier: 'B',
            isDirty: function () { return false; },
            onMount: function () { _renderBoxEditorPage(); },
            contentHtml:
                '<div style="width:96vw; max-width:1100px; height:92vh; background:white; border-radius:14px; padding:14px; box-shadow:0 20px 50px rgba(15,23,42,0.2); display:flex; flex-direction:column; box-sizing:border-box;">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
                        '<h3 style="margin:0; font-size:1.05rem; font-weight:900; color:#0F766E;">🔍 檢查／手動補救少數框</h3>' +
                        '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeaturePdfExamJob._closeBoxEditor()">完成／關閉</button>' +
                    '</div>' +
                    '<div style="font-size:0.78rem; color:#64748B; margin-bottom:8px;">綠色框＝已自動定位好的題目（右側標🤖）；紅色框／清單裡「未偵測到空格」的題目，才需要在下方頁面圖上「按住拖曳」手動畫一個方框，再從右側清單選這個框對應哪一題。多數題目應該已經自動定位好，不需要逐一手動畫。</div>' +
                    '<div style="display:flex; gap:12px; flex:1; min-height:0;">' +
                        '<div style="flex:1; overflow:auto; border:1px solid #E2E8F0; border-radius:8px; background:#F8FAFC; display:flex; flex-direction:column; align-items:center; padding:10px;">' +
                            '<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">' +
                                '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeaturePdfExamJob._goToPage(-1)">◀ 上一頁</button>' +
                                '<span id="pdf-exam-box-pageinfo" style="font-weight:800; color:#334155; font-size:0.85rem;"></span>' +
                                '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.FeaturePdfExamJob._goToPage(1)">下一頁 ▶</button>' +
                            '</div>' +
                            '<div id="pdf-exam-box-canvaswrap" style="position:relative; display:inline-block;"></div>' +
                        '</div>' +
                        '<div style="width:300px; flex-shrink:0; overflow:auto; border:1px solid #E2E8F0; border-radius:8px; padding:10px;">' +
                            '<div style="font-weight:900; color:#334155; margin-bottom:6px; font-size:0.85rem;">本頁已畫的框</div>' +
                            '<div id="pdf-exam-box-sidebar"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>'
        });
    }

    async function _renderBoxEditorPage() {
        var s = _boxState;
        if (!s) return;
        var pageInfoEl = document.getElementById('pdf-exam-box-pageinfo');
        if (pageInfoEl) pageInfoEl.textContent = '第 ' + s.currentPage + ' / ' + s.numPages + ' 頁';
        var wrap = document.getElementById('pdf-exam-box-canvaswrap');
        if (!wrap) return;
        wrap.innerHTML = '<div style="padding:40px; color:#94A3B8;">⏳ 渲染頁面…</div>';
        try {
            var page = await s.pdfDoc.getPage(s.currentPage);
            var viewport = page.getViewport({ scale: 1.3 });
            var canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            var ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            wrap.innerHTML = '';
            canvas.style.display = 'block';
            wrap.appendChild(canvas);

            var overlay = document.createElement('div');
            overlay.id = 'pdf-exam-box-overlay';
            overlay.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; cursor:crosshair;';
            wrap.appendChild(overlay);
            wrap.style.width = canvas.width + 'px';
            wrap.style.height = canvas.height + 'px';

            _attachDrawHandlers(overlay);
            _renderBoxesOnPage();
            _renderSidebar();
        } catch (err) {
            console.error('[FeaturePdfExamJob] render page', err);
            wrap.innerHTML = '<div style="padding:40px; color:#DC2626;">頁面渲染失敗：' + esc(err.message || String(err)) + '</div>';
        }
    }

    function _attachDrawHandlers(overlay) {
        var dragging = false;
        var startX = 0, startY = 0;
        var liveBox = null;

        function pct(clientX, clientY) {
            var rect = overlay.getBoundingClientRect();
            var x = Math.min(Math.max(0, (clientX - rect.left) / rect.width), 1);
            var y = Math.min(Math.max(0, (clientY - rect.top) / rect.height), 1);
            return { x: x, y: y };
        }

        overlay.addEventListener('mousedown', function (e) {
            e.preventDefault();
            dragging = true;
            var p = pct(e.clientX, e.clientY);
            startX = p.x; startY = p.y;
            liveBox = document.createElement('div');
            liveBox.style.cssText = 'position:absolute; border:2px dashed #0EA5E9; background:rgba(14,165,233,0.15); pointer-events:none;';
            overlay.appendChild(liveBox);
        });
        overlay.addEventListener('mousemove', function (e) {
            if (!dragging || !liveBox) return;
            var p = pct(e.clientX, e.clientY);
            var x1 = Math.min(startX, p.x), x2 = Math.max(startX, p.x);
            var y1 = Math.min(startY, p.y), y2 = Math.max(startY, p.y);
            liveBox.style.left = (x1 * 100) + '%';
            liveBox.style.top = (y1 * 100) + '%';
            liveBox.style.width = ((x2 - x1) * 100) + '%';
            liveBox.style.height = ((y2 - y1) * 100) + '%';
        });
        function finish(e) {
            if (!dragging) return;
            dragging = false;
            var p = pct(e.clientX, e.clientY);
            var x1 = Math.min(startX, p.x), x2 = Math.max(startX, p.x);
            var y1 = Math.min(startY, p.y), y2 = Math.max(startY, p.y);
            if (liveBox && liveBox.parentNode) liveBox.parentNode.removeChild(liveBox);
            liveBox = null;
            var wPct = (x2 - x1) * 100, hPct = (y2 - y1) * 100;
            if (wPct < 1.5 || hPct < 1) return; // 太小視為誤觸，不建立框
            _addBox({ xPct: x1 * 100, yPct: y1 * 100, wPct: wPct, hPct: hPct });
        }
        overlay.addEventListener('mouseup', finish);
        overlay.addEventListener('mouseleave', function (e) { if (dragging) finish(e); });
    }

    function _addBox(box) {
        var s = _boxState;
        if (!s) return;
        s.job.items.push({
            key: null, section: null, item_no: null, part: null,
            page: s.currentPage, box: box, answer_text: '', accepted_answers: []
        });
        _renderBoxesOnPage();
        _renderSidebar();
    }

    function _renderBoxesOnPage() {
        var s = _boxState;
        var overlay = document.getElementById('pdf-exam-box-overlay');
        if (!overlay || !s) return;
        Array.prototype.slice.call(overlay.querySelectorAll('.pdf-exam-box-rect')).forEach(function (el) { el.remove(); });
        s.job.items.forEach(function (it) {
            if (it.page !== s.currentPage) return;
            var assigned = !!it.key;
            var el = document.createElement('div');
            el.className = 'pdf-exam-box-rect';
            el.style.cssText = 'position:absolute; pointer-events:none; border:2px solid ' + (assigned ? '#059669' : '#DC2626')
                + '; background:' + (assigned ? 'rgba(5,150,105,0.12)' : 'rgba(220,38,38,0.12)') + ';'
                + ' left:' + it.box.xPct + '%; top:' + it.box.yPct + '%; width:' + it.box.wPct + '%; height:' + it.box.hPct + '%;';
            var label = document.createElement('span');
            label.style.cssText = 'position:absolute; left:2px; top:-1px; font-size:11px; font-weight:900; color:' + (assigned ? '#059669' : '#DC2626') + '; background:white; padding:0 2px; border-radius:2px;';
            label.textContent = assigned ? (String(it.item_no) + (it.part ? ('-' + it.part) : '')) : '?';
            el.appendChild(label);
            overlay.appendChild(el);
        });
    }

    function _renderSidebar() {
        var s = _boxState;
        var el = document.getElementById('pdf-exam-box-sidebar');
        if (!el || !s) return;
        var usedKeys = {};
        s.job.items.forEach(function (it) { if (it.key) usedKeys[it.key] = true; });
        var rows = [];
        s.job.items.forEach(function (it, absIdx) {
            if (it.page !== s.currentPage) return;
            var optionsHtml = '<option value="">-- 選擇題目 --</option>' + window.PdfExamPaper.groupItemsBySection(s.job.parsed_bank).map(function (g) {
                var opts = g.items.map(function (bk) {
                    var dupWarn = (usedKeys[bk.key] && bk.key !== it.key) ? '⚠已用 ' : '';
                    var label = dupWarn + bk.item_no + (bk.part ? ('-' + bk.part) : '') + '：' + truncate(bk.answer_text, 16);
                    return '<option value="' + esc(bk.key) + '" ' + (it.key === bk.key ? 'selected' : '') + '>' + esc(label) + '</option>';
                }).join('');
                return '<optgroup label="' + esc(g.section) + '">' + opts + '</optgroup>';
            }).join('');
            var methodTag = !it._auto ? ''
                : it._auto_method === 'position'
                    ? '<span title="沒偵測到題號文字，依座標順序猜的，請務必確認" style="font-size:0.7rem; color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; padding:1px 5px; border-radius:4px; margin-left:4px;">🤖 依順序猜</span>'
                    : '<span title="偵測到旁邊印的題號文字直接對到答案" style="font-size:0.7rem; color:#047857; background:#ECFDF5; border:1px solid #A7F3D0; padding:1px 5px; border-radius:4px; margin-left:4px;">🤖 依題號</span>';
            rows.push(
                '<div style="border:1px solid #E2E8F0; border-radius:6px; padding:6px; margin-bottom:6px;">' +
                    '<div style="margin-bottom:2px;">' + methodTag + '</div>' +
                    '<select style="width:100%; font-size:0.8rem; padding:4px;" onchange="window.FeaturePdfExamJob._assignBox(' + absIdx + ', this.value)">' + optionsHtml + '</select>' +
                    (it.key ? ('<div style="font-size:0.75rem; color:#047857; margin-top:2px;">答案：' + esc(it.answer_text || '(空白)') + '</div>') : '') +
                    '<button type="button" class="btn-icon" style="font-size:0.75rem; margin-top:4px;" onclick="window.FeaturePdfExamJob._removeBox(' + absIdx + ')">🗑️ 刪除這個框</button>' +
                '</div>'
            );
        });
        el.innerHTML = rows.length ? rows.join('') : '<div style="color:#94A3B8; font-size:0.8rem;">這一頁還沒有畫框，在左邊頁面圖上拖曳畫一個</div>';
    }

    function _assignBox(absIdx, bankKey) {
        var s = _boxState;
        if (!s) return;
        var it = s.job.items[absIdx];
        if (!it) return;
        if (!bankKey) {
            it.key = null; it.section = null; it.item_no = null; it.part = null; it.answer_text = ''; it.accepted_answers = [];
        } else {
            var bk = (s.job.parsed_bank || []).find(function (b) { return b.key === bankKey; });
            if (!bk) return;
            it.key = bk.key; it.section = bk.section; it.item_no = bk.item_no; it.part = bk.part;
            it.answer_text = bk.answer_text; it.accepted_answers = bk.accepted_answers;
        }
        _renderBoxesOnPage();
        _renderSidebar();
    }

    function _removeBox(absIdx) {
        var s = _boxState;
        if (!s) return;
        s.job.items.splice(absIdx, 1);
        _renderBoxesOnPage();
        _renderSidebar();
    }

    function _goToPage(delta) {
        var s = _boxState;
        if (!s) return;
        var next = s.currentPage + delta;
        if (next < 1 || next > s.numPages) return;
        s.currentPage = next;
        _renderBoxEditorPage();
    }

    function _closeBoxEditor() {
        var s = _boxState;
        if (window.ModalOverlay) window.ModalOverlay.close(BOX_MODAL_ID);
        if (s) {
            refreshStatusLine(s.pathStr, s.job);
            refreshBankTable(s.pathStr, s.job); // 更新哪些題已畫框（📌）的標記
        }
        _boxState = null;
    }
    REMOVED_UNUSED_BOX_EDITOR_END */

    // ------------------------------------------------------------------
    // 老師複核：查看學生作答、修正標準答案後重新批改全班
    // ------------------------------------------------------------------

    async function openReview(assignmentId, taskId) {
        if (!window.ModalOverlay) return;
        window.ModalOverlay.open({
            id: REVIEW_MODAL_ID,
            tier: 'A',
            contentHtml: '<div style="max-width:820px; width:94vw; background:white; border-radius:14px; padding:24px; text-align:center; color:#64748B; font-weight:700;">⏳ 讀取學生作答中…</div>'
        });
        try {
            if (!window.ApiQuizReview) throw new Error('ApiQuizReview 模組未載入');
            var assignment = await window.ApiQuizReview.fetchAssignment(assignmentId);
            if (!assignment) throw new Error('找不到作業');
            var lookup = window.TaskScriptResolver.patchTaskRawDataInTree(assignment.tasks, taskId, function () {});
            if (!lookup.patched || !lookup.task) throw new Error('在作業裡找不到這個任務');
            var task = lookup.task;
            var job = ensureJob(task);
            var completions = await window.ApiQuizReview.fetchCompletionsForTask(assignmentId, taskId);
            var students = await window.ApiQuizReview.fetchClassStudents(assignment.class_id);
            _reviewState = { assignmentId: assignmentId, taskId: taskId, assignment: assignment, task: task, job: job, completions: completions, students: students };
            _renderReviewModal();
        } catch (err) {
            console.error('[FeaturePdfExamJob] openReview', err);
            if (window.ModalOverlay) window.ModalOverlay.close(REVIEW_MODAL_ID);
            window.showFlash('讀取失敗：' + (err.message || err), 'error');
        }
    }

    function _renderReviewModal() {
        var st = _reviewState;
        var compByStudent = {};
        st.completions.forEach(function (c) { compByStudent[String(c.student_id)] = c; });
        var rowsHtml = st.students.map(function (stu) {
            var c = compByStudent[String(stu.id)];
            var raw = (c && c.raw_data) || {};
            var result = raw.pdf_quiz_result;
            // 學生端改成「每大題提交就批改」，考卷可能只寫了一部分——result.all_submitted===false
            // 代表還在作答中，這裡要跟「整份都批改完」分開顯示，不要誤報成有完整分數。
            var statusHtml = result
                ? (result.all_submitted === false
                    ? ('<span style="color:#B45309; font-weight:800;">作答中：已批改 ' + esc(result.submitted_sections) + ' / ' + esc(result.total_sections) + ' 大題</span>')
                    : ('<span style="color:#0F766E; font-weight:800;">' + esc(result.correct) + ' / ' + esc(result.total) + '（' + esc(result.score) + '%）</span>'))
                : (c ? '<span style="color:#94A3B8;">未作答</span>' : '<span style="color:#CBD5E1;">—</span>');
            return (
                '<tr>' +
                    '<td style="padding:6px 8px; border-bottom:1px solid #F1F5F9;">' + esc(stu.name) + '</td>' +
                    '<td style="padding:6px 8px; border-bottom:1px solid #F1F5F9;">' + statusHtml + '</td>' +
                    '<td style="padding:6px 8px; border-bottom:1px solid #F1F5F9;">' +
                        (result ? ('<button type="button" class="btn" style="font-size:0.78rem; padding:3px 8px;" onclick="window.FeaturePdfExamJob._viewStudentDetail(\'' + esc(String(stu.id)) + '\')">查看</button>') : '') +
                    '</td>' +
                '</tr>'
            );
        }).join('');

        var bankEditHtml = (st.job.parsed_bank || []).map(function (it, idx) {
            return (
                '<div style="display:flex; gap:6px; align-items:center; padding:3px 0;">' +
                    '<span style="width:78px; font-size:0.78rem; color:#0369A1; font-weight:800;">' + (it.group ? esc(it.group) + '-' : '') + esc(it.item_no || '?') + (it.part ? ('-' + esc(it.part)) : '') + '</span>' +
                    '<input type="text" value="' + esc(it.answer_text || '') + '" style="flex:1; padding:3px 6px; font-size:0.8rem; border:1px solid #CBD5E1; border-radius:4px;" ' +
                        'onchange="window.FeaturePdfExamJob._updateReviewAnswer(' + idx + ', \'answer_text\', this.value)">' +
                    '<input type="text" value="' + esc(window.PdfExamPaper.formatAcceptedAnswerList(it.accepted_answers)) + '" placeholder="其他可接受答案（用 || 分隔）" style="flex:1; padding:3px 6px; font-size:0.8rem; border:1px solid #CBD5E1; border-radius:4px;" ' +
                        'onchange="window.FeaturePdfExamJob._updateReviewAnswer(' + idx + ', \'accepted_answers\', this.value)">' +
                '</div>'
            );
        }).join('');

        var regradeWarningHtml = st.job.needs_regrade
            ? ('<div id="pdf-exam-review-regrade-warning" style="margin-bottom:10px; padding:8px 10px; background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; font-size:0.82rem; color:#B91C1C; font-weight:800;">'
                + '⚠ 答案有更新，目前顯示的學生分數可能是舊答案批改的結果，請按下面「儲存並重新批改全班」重新計分。'
                + '</div>')
            : '<div id="pdf-exam-review-regrade-warning"></div>';
        var regradeBtnLabel = st.job.needs_regrade ? '⚠ 答案有更新，按此重新批改全班' : '💾 儲存並重新批改全班';

        window.ModalOverlay.open({
            id: REVIEW_MODAL_ID,
            tier: 'A',
            contentHtml:
                '<div style="max-width:820px; width:94vw; max-height:90vh; overflow:auto; background:white; border-radius:14px; padding:20px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#0F766E;">📊 PDF 考卷複核</h3>' +
                        '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'' + REVIEW_MODAL_ID + '\')">關閉</button>' +
                    '</div>' +
                    regradeWarningHtml +
                    '<div style="font-weight:900; color:#334155; margin:10px 0 4px;">標準答案（可修改後重新批改全班）</div>' +
                    '<div style="max-height:26vh; overflow:auto; border:1px solid #E2E8F0; border-radius:8px; padding:8px; margin-bottom:8px;">' + (bankEditHtml || '<div style="color:#94A3B8; font-size:0.85rem;">尚無題目</div>') + '</div>' +
                    '<div style="display:flex; justify-content:flex-end; margin-bottom:14px;">' +
                        '<button type="button" class="btn btn-action" id="pdf-exam-review-regrade-btn" style="background:' + (st.job.needs_regrade ? '#B91C1C' : '#7C3AED') + '; color:white; border:none; padding:6px 14px; font-weight:800;" onclick="window.FeaturePdfExamJob._saveAndRegradeAll()">' + regradeBtnLabel + '</button>' +
                    '</div>' +
                    '<div style="font-weight:900; color:#334155; margin-bottom:6px;">學生作答狀況</div>' +
                    '<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">' +
                        '<thead><tr style="text-align:left; color:#64748B;"><th style="padding:6px 8px;">學生</th><th style="padding:6px 8px;">分數</th><th style="padding:6px 8px;"></th></tr></thead>' +
                        '<tbody>' + (rowsHtml || '<tr><td colspan="3" style="padding:10px; color:#94A3B8;">目前班上沒有學生</td></tr>') + '</tbody>' +
                    '</table>' +
                '</div>'
        });
    }

    /** 複核頁改標準答案後，就地更新警示 banner／按鈕樣式，不整個重繪 modal（避免打字中斷焦點） */
    function _refreshRegradeWarningInline() {
        var st = _reviewState;
        if (!st) return;
        var warnEl = document.getElementById('pdf-exam-review-regrade-warning');
        if (warnEl) {
            warnEl.innerHTML = st.job.needs_regrade
                ? '<div style="padding:8px 10px; background:#FEF2F2; border:1px solid #FECACA; border-radius:8px; font-size:0.82rem; color:#B91C1C; font-weight:800;">⚠ 答案有更新，目前顯示的學生分數可能是舊答案批改的結果，請按下面「儲存並重新批改全班」重新計分。</div>'
                : '';
        }
        var btnEl = document.getElementById('pdf-exam-review-regrade-btn');
        if (btnEl) {
            btnEl.style.background = st.job.needs_regrade ? '#B91C1C' : '#7C3AED';
            btnEl.textContent = st.job.needs_regrade ? '⚠ 答案有更新，按此重新批改全班' : '💾 儲存並重新批改全班';
        }
    }

    function _updateReviewAnswer(idx, field, value) {
        var st = _reviewState;
        if (!st) return;
        var it = (st.job.parsed_bank || [])[idx];
        if (!it) return;
        if (field === 'answer_text') it.answer_text = value;
        else if (field === 'accepted_answers') it.accepted_answers = window.PdfExamPaper.parseAcceptedAnswerList(value);
        it._manuallyEdited = true;
        st.job.needs_regrade = true;
        _refreshRegradeWarningInline();
    }

    function _viewStudentDetail(studentId) {
        var st = _reviewState;
        if (!st) return;
        var c = st.completions.find(function (x) { return String(x.student_id) === String(studentId); });
        var stu = st.students.find(function (x) { return String(x.id) === String(studentId); });
        if (!c) return;
        var raw = c.raw_data || {};
        // 💣 跟重新批改同一條：學生答案看原始作答框即時配對，不准吃繳交當時的 pdf_quiz_answers。
        // 答案清單 key 一改，舊表會整批變成「(未填)」，老師會以為學生沒寫。
        var answers = (raw.pdf_quiz_boxes_by_section && window.PdfExamPaper && typeof window.PdfExamPaper.buildAnswersFromBoxesBySection === 'function')
            ? window.PdfExamPaper.buildAnswersFromBoxesBySection(st.job.parsed_bank, raw.pdf_quiz_boxes_by_section)
            : (raw.pdf_quiz_answers || {});
        var rowsHtml = (st.job.parsed_bank || []).map(function (it) {
            var got = answers[it.key] || '';
            var okList = [it.answer_text].concat(it.accepted_answers || []).map(function (a) { return window.QuizPaperBuilder.normalizeAnswer(a); }).filter(Boolean);
            var ok = window.QuizPaperBuilder.isAcceptableAnswer(window.QuizPaperBuilder.normalizeAnswer(got), okList);
            return (
                '<div style="border:1px solid ' + (ok ? '#A7F3D0' : '#FECACA') + '; background:' + (ok ? '#ECFDF5' : '#FEF2F2') + '; border-radius:6px; padding:8px; margin-bottom:6px;">' +
                    '<div style="font-size:0.78rem; font-weight:800; color:#334155;">' + esc(it.section || '') + ' 第' + esc(it.item_no || '?') + '題' + (it.part ? ('-' + esc(it.part)) : '') + '</div>' +
                    '<div style="font-size:0.85rem; margin-top:2px;">學生答：<b>' + esc(got || '(未填)') + '</b></div>' +
                    '<div style="font-size:0.8rem; color:#64748B;">標準答案：' + esc(it.answer_text || '') + (it.accepted_answers && it.accepted_answers.length ? ('（或：' + esc(window.PdfExamPaper.formatAcceptedAnswerList(it.accepted_answers)) + '）') : '') + '</div>' +
                '</div>'
            );
        }).join('');
        window.ModalOverlay.open({
            id: REVIEW_MODAL_ID + '-detail',
            tier: 'A',
            replace: false,
            contentHtml:
                '<div style="max-width:640px; width:92vw; max-height:86vh; overflow:auto; background:white; border-radius:14px; padding:18px; box-shadow:0 20px 50px rgba(15,23,42,0.2);">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
                        '<h3 style="margin:0; font-size:1.05rem; font-weight:900; color:#0F766E;">' + esc((stu && stu.name) || '學生') + ' 的作答</h3>' +
                        '<button type="button" class="btn" style="padding:4px 10px;" onclick="window.ModalOverlay.close(\'' + REVIEW_MODAL_ID + '-detail\')">關閉</button>' +
                    '</div>' +
                    rowsHtml +
                '</div>'
        });
    }

    async function _saveAndRegradeAll() {
        var st = _reviewState;
        if (!st) return;
        try {
            window.showFlash('⏳ 儲存並重新批改…', 'info');
            if (window.PdfExamPaper && typeof window.PdfExamPaper.repairStaleCommaSplits === 'function') {
                window.PdfExamPaper.repairStaleCommaSplits(st.job);
            }
            st.job.needs_regrade = false; // 這次重新批改完成後，答案跟分數就同步了，清掉警示
            var result = window.TaskScriptResolver.patchTaskRawDataInTree(st.assignment.tasks, st.taskId, function (t) {
                t.raw_data.pdf_exam_job = st.job;
            });
            if (!result.patched) throw new Error('找不到任務，無法儲存');
            var { error: updErr } = await window.supabaseClient.from('assignments').update({ tasks: result.tasks }).eq('id', st.assignmentId);
            if (updErr) throw new Error('儲存標準答案失敗：' + updErr.message);
            st.assignment.tasks = result.tasks;

            var paper = window.PdfExamPaper.buildGradingPaper(st.job);
            var toSave = [];
            var skippedInProgress = 0;
            st.completions.forEach(function (c) {
                var raw = c.raw_data || {};
                if (!raw.pdf_quiz_answers && !raw.pdf_quiz_boxes_by_section) return;
                // 學生端改成「每大題提交就批改」，考卷有可能只寫到一半——這種還在作答中的
                // 不能拿目前殘缺的答案當「全卷已交」重批，否則會把還沒寫的
                // 大題全部判錯，蓋掉正確的「部分完成」狀態。只重批已經整份交完的學生。
                if (raw.pdf_quiz_result && raw.pdf_quiz_result.all_submitted === false) {
                    skippedInProgress++;
                    return;
                }
                // 💣 重新批改一定要用「學生原始作答框」＋「現在的答案清單」即時重新配對，不能直接吃
                // raw.pdf_quiz_answers——那是繳交當時用舊答案清單 key 存下來的，答案清單一旦被改過
                // （拆格／合併／增刪）key 就會變，舊表對不到新 key，學生填過的內容會被判定成沒作答。
                // pdf_quiz_boxes_by_section 才是真正的原始資料，永遠都在，不管答案清單怎麼改都還能重配對。
                var answers = raw.pdf_quiz_boxes_by_section
                    ? window.PdfExamPaper.buildAnswersFromBoxesBySection(st.job.parsed_bank, raw.pdf_quiz_boxes_by_section)
                    : raw.pdf_quiz_answers;
                var gradeResult = window.QuizPaperBuilder.gradeAnswers(paper, answers);
                var nextRaw = Object.assign({}, raw, {
                    pdf_quiz_result: {
                        score: gradeResult.score,
                        correct: gradeResult.correct,
                        total: gradeResult.total,
                        wrong_items: gradeResult.wrong_items,
                        // 重新批改也要重算各大題分數，否則學生結果頁的「各大題結果」會停留在舊資料
                        section_stats: window.PdfExamPaper.computeSectionStats(st.job.parsed_bank, gradeResult),
                        all_submitted: true,
                        graded_at: new Date().toISOString()
                    }
                });
                toSave.push({ id: c.id, rawData: nextRaw });
                c.raw_data = nextRaw;
            });
            var saveResult = await window.ApiQuizReview.batchSaveCompletions(toSave);
            window.showFlash('✅ 已重新批改 ' + saveResult.okCount + ' 位學生' + (saveResult.failCount ? '（' + saveResult.failCount + ' 位失敗）' : '')
                + (skippedInProgress ? '（' + skippedInProgress + ' 位還在作答中，未重批）' : ''), 'success');
            _renderReviewModal();
        } catch (err) {
            console.error('[FeaturePdfExamJob] _saveAndRegradeAll', err);
            window.showFlash('儲存/重新批改失敗：' + (err.message || err), 'error');
        }
    }

    return {
        renderInlineEditorHtml: renderInlineEditorHtml,
        syncInlineEditor: syncInlineEditor,
        handlePdfFileChange: handlePdfFileChange,
        onMaterialFolderChange: onMaterialFolderChange,
        onMaterialFileChange: onMaterialFileChange,
        refreshMaterialPickers: function (pathStr) { return hydratePdfMaterialPickers(pathStr, true); },
        selectBankSection: selectBankSection,
        parseAnswerTextAction: parseAnswerTextAction,
        reparseSection: reparseSection,
        useTeacherLocate: useTeacherLocate,
        confirmSection: confirmSection,
        updateBankField: updateBankField,
        removeBankRow: removeBankRow,
        addBankRow: addBankRow,
        moveBankRow: moveBankRow,
        insertBankRow: insertBankRow,
        openReview: openReview,
        _updateReviewAnswer: _updateReviewAnswer,
        _viewStudentDetail: _viewStudentDetail,
        _saveAndRegradeAll: _saveAndRegradeAll
    };
})();

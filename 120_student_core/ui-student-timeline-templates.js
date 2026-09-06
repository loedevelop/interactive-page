/**
 * 📂 檔案路徑：120_student_core/ui-student-timeline-templates.js
 * 🌟 純粹視覺模板層 (V119：AI 報告卡片預設收合、並匯出共用函式供「學習分析」頁籤重用)
 * 🌟 免疫介面災難：程式碼內 0 個雙直豎線，絕對防彈。
 */

window.UIStudentTimelineTemplates = (() => {
    
    // 🔊 1. 有道字典真人發音引擎 (帶有原生備用防線)
    let sharedTTS = null;
    const playGoogleTTS = (text) => {
        try {
            const safeText = text ? text : '';
            if (safeText === '') return;

            const fallbackTTS = () => {
                let hasSpeech = false;
                if ('speechSynthesis' in window) hasSpeech = true;
                
                if (hasSpeech) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(safeText);
                    utterance.lang = 'en-US';
                    utterance.rate = 0.9; 
                    window.speechSynthesis.speak(utterance);
                } else {
                    window.showFlash('您的瀏覽器不支援語音播放功能。', 'error');
                }
            };

            if (!sharedTTS) {
                sharedTTS = document.createElement('audio');
                sharedTTS.id = 'rt-hidden-tts';
                document.body.appendChild(sharedTTS);
            }
            sharedTTS.pause();
            
            // 🌟 回歸有道字典 API，type=2 代表美式發音
            sharedTTS.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(safeText)}&type=2`;
            
            const playPromise = sharedTTS.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.warn("有道字典 TTS 播放被阻擋，無縫切換至原生語音引擎:", e);
                    fallbackTTS();
                });
            }
        } catch (e) { 
            console.error("TTS 發音發生錯誤:", e); 
        }
    };

    const guessSubmittedKind = (fileId, audioUrl, fileMeta) => {
        const metaMime = fileMeta && fileMeta.mime ? String(fileMeta.mime).toLowerCase() : '';
        const metaName = fileMeta && fileMeta.name ? String(fileMeta.name).toLowerCase() : '';
        const url = String(audioUrl || '').toLowerCase();
        const hay = metaMime + ' ' + metaName + ' ' + url;
        // 🌟 只要收到的檔案「是音檔」就該給播放器，不分任務類型（錄音任務／一般資料夾上傳皆同）。
        // 一般資料夾上傳（task.type==='drive'）的 <input type="file"> 沒有 accept 限制，什麼副檔名
        // 都可能選到；補齊跟其他音檔輸入框 accept 清單一致的副檔名，避免漏判成一般檔案。
        if (/audio\/|\.wav|\.mp3|\.m4a|\.ogg|\.aac|\.webm|\.flac|\.amr|\.3gp|\.wma|\.mp4|\.caf|\.opus/.test(hay)) return 'audio';
        if (/image\/|\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.heic/.test(hay)) return 'image';
        if (/pdf|\.pdf|application\/pdf/.test(hay)) return 'pdf';
        // 🌟 拿掉「只要是 drive.google.com/file 網址就當音檔」這條過寬的預設值：
        // 一般 drive 上傳任務（小考照片、PDF、其他檔案）產生的網址格式跟音檔完全一樣，
        // 之前這條規則會把非錄音作業也誤判成音檔、硬塞一個播放不出東西的音檔播放器。
        // 判斷不出來時，一律當成一般檔案，走「📄 開啟繳交檔」即可。
        return 'file';
    };

    const TASK_BTN_VARIANTS = {
        solid: 'task-btn',
        ghost: 'task-btn task-btn--ghost',
        done: 'task-btn task-btn--done'
    };
    const taskBtn = (label, onclick, variant, title) => {
        const cls = TASK_BTN_VARIANTS[variant] || TASK_BTN_VARIANTS.solid;
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        return `<button type="button" class="${cls}" onclick="${onclick}"${titleAttr}>${label}</button>`;
    };
    const taskLink = (label, href, variant, title, extraAttrs) => {
        const cls = TASK_BTN_VARIANTS[variant] || TASK_BTN_VARIANTS.ghost;
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
        return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener" class="${cls}"${titleAttr}${extraAttrs || ''}>${escapeAttr(label)}</a>`;
    };

    const resolveStreamUrl = (fileId) => {
        if (!fileId) return '';
        if (window.ApiService && typeof window.ApiService.getAudioStreamUrl === 'function') {
            return window.ApiService.getAudioStreamUrl(fileId);
        }
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
    };

    const resolveDriveViewUrl = (fileId) => {
        if (window.ApiService && typeof window.ApiService.getDriveFileViewUrl === 'function') {
            return window.ApiService.getDriveFileViewUrl(fileId);
        }
        return `https://drive.google.com/file/d/${fileId}/view`;
    };

    const resolveDrivePreviewUrl = (fileId) => {
        if (window.ApiService && typeof window.ApiService.getDriveFilePreviewUrl === 'function') {
            return window.ApiService.getDriveFilePreviewUrl(fileId);
        }
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
    };

    /**
     * 「🔁 取代」按鈕＋隱藏 file input：學生點選後選新檔直接覆蓋這一筆
     * （Drive 舊檔 trash、DB 紀錄換成新檔）。data-* 帶著 handleReplaceFile 需要的內容，
     * unit_key／stem／page／label／original_script 只有 AI 分頁（meta.unit_key 有值）才會有值；
     * 一般檔案（無 unit_key）由 handleReplaceFile 依任務是否走 AI 批改自行判斷路徑。
     * 見 .cursor/rules/drive-folder-upload-invariants.mdc「取代特定已上傳檔」一節。
     */
    const buildReplaceButtonHtml = (fileId, meta, kind, courseId, taskId, statusId, idx) => {
        if (!courseId || !taskId || !statusId) return '';
        const inputId = `replace-file-input-${courseId}-${taskId}-${idx}`;
        const accept = kind === 'audio'
            ? 'audio/*,.mp3,.wav,.m4a,.ogg,.aac,.webm,.flac,.amr,.3gp,.wma,.mp4'
            : (kind === 'image' ? 'image/*' : '');
        const unitKey = meta && meta.unit_key ? String(meta.unit_key).trim() : '';
        const stem = meta && meta.stem ? String(meta.stem) : '';
        const page = (meta && meta.page != null) ? String(meta.page) : '';
        const label = meta && meta.label ? String(meta.label) : '';
        const scriptB64 = unitKey ? b64Utf8(meta && meta.original_script ? meta.original_script : '') : '';
        return `<input type="file" id="${escapeAttr(inputId)}" accept="${escapeAttr(accept)}" style="display:none;"
                data-old-file-id="${escapeAttr(fileId)}"
                data-unit-key="${escapeAttr(unitKey)}"
                data-stem="${escapeAttr(stem)}"
                data-page="${escapeAttr(page)}"
                data-label="${escapeAttr(label)}"
                data-script-b64="${escapeAttr(scriptB64)}"
                onchange="window.FeatureStudentTimeline.handleReplaceFile(this, '${escapeJsSingleQuoted(courseId)}', '${escapeJsSingleQuoted(taskId)}', '${escapeJsSingleQuoted(statusId)}')">
            <button type="button" onclick="document.getElementById('${escapeAttr(inputId)}').click()" class="task-btn task-btn--ghost" title="取代這一個檔案">🔁 取代</button>`;
    };

    /**
     * 骨架模式（E）沒有 unit_key 的一般上傳檔，靠 grading_units 陣列位置回填顯示用標籤，
     * 例如老師每列骨架路徑直接填頁碼「243」「244」…時，顯示成「p. 243」而不是「第 1 檔」。
     * 只是顯示用的最佳猜測（假設學生依 base 範圍列表順序上傳），不影響批改或實際檔案內容。
     */
    const skeletonUnitLabelText = (unit) => {
        if (!unit) return '';
        if (unit.label) return String(unit.label).trim();
        if (unit.path_label) return String(unit.path_label).trim();
        const stem = String(unit.stem || '').trim();
        const sub = Array.isArray(unit.sub_path) && unit.sub_path.length ? unit.sub_path.join('/') : '';
        if (/^\d+$/.test(stem) && !sub) return 'p. ' + stem;
        if (stem && sub) return stem + '/' + sub;
        return stem || sub || '';
    };

    /**
     * 把 base 範圍文字（例如「pp. 243 ~ 247, p. 252」「A pp. 1~2；B pp. 3~4」）裡出現的所有
     * 數字／數字區間依出現順序展開成頁碼陣列（例：[243,244,245,246,247,252]）。不管前綴是
     * p./pp./stem 字母，一律直接抓數字——這是老師在畫面上唯一「看得到、也最準」的頁數來源，
     * 比另外維護一份骨架單元列表更貼近老師實際操作習慣（見 2026-08-09 使用者回報）。
     */
    const pagesFromRangeText = (text) => {
        const str = String(text || '').replace(/[～〜－—–-]/g, '~');
        const pages = [];
        const re = /(\d+)\s*~\s*(\d+)|(\d+)/g;
        let m;
        while ((m = re.exec(str))) {
            if (m[1] && m[2]) {
                let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
                if (a > b) { const t = a; a = b; b = t; }
                for (let i = a; i <= b; i++) pages.push(i);
            } else if (m[3]) {
                pages.push(parseInt(m[3], 10));
            }
        }
        return pages;
    };

    /** 單純頁碼範圍（pp. 1~3／p. 1, 3），沒有 A／B 多活頁。這種標題學生看得到幾頁，提示不得另算一套。 */
    const isSimplePageRangeText = (text) => {
        const s = String(text || '').replace(/[～〜－—–-]/g, '~').replace(/\s+/g, ' ').trim();
        if (!s) return false;
        const withoutPp = s.replace(/pp?\.?\s*/gi, '');
        if (/[A-Za-z\u4e00-\u9fff]/.test(withoutPp)) return false;
        return /^\d+(\s*~\s*\d+)?(\s*,\s*\d+(\s*~\s*\d+)?)*$/.test(withoutPp);
    };

    /**
     * 學生端錄音頁數唯一來源：標題／base 範圍看得到幾頁，就收幾檔。
     * Snapshot 多出來的 grading_units（常見：範圍 pp. 1~3 卻殘留第 4 頁）要丟掉，否則提示寫 4 檔、標題寫 3 頁。
     * 多活頁（A pp. 1~2；B pp. 1~2）維持用 grading_units，因為同頁碼會出現兩次。
     */
    const alignUnitsToVisibleRange = (units, rangeText) => {
        const list = Array.isArray(units) ? units.slice() : [];
        const pages = pagesFromRangeText(rangeText);
        if (!list.length) {
            return pages.map(function (p) {
                return { unit_key: 'range:' + p, stem: '', page: p, label: 'p. ' + p, original_script: '' };
            });
        }
        if (!pages.length || !isSimplePageRangeText(rangeText)) return list;
        const unique = [];
        pages.forEach(function (p) {
            if (unique.indexOf(p) === -1) unique.push(p);
        });
        const pageOf = function (u) {
            if (!u) return null;
            if (u.page != null && u.page !== '') {
                const n = Number(u.page);
                return isNaN(n) ? null : n;
            }
            const m = String(u.label || u.unit_key || '').match(/(?:p\.?\s*)(\d+)/i);
            return m ? parseInt(m[1], 10) : null;
        };
        const byPage = {};
        list.forEach(function (u) {
            const p = pageOf(u);
            if (p == null || unique.indexOf(p) === -1 || byPage[p]) return;
            byPage[p] = Object.assign({}, u, { page: p, label: u.label || ('p. ' + p) });
        });
        return unique.map(function (p) {
            const found = byPage[p];
            if (found) {
                return Object.assign({}, found, { page: p, label: found.label || ('p. ' + p) });
            }
            return {
                unit_key: 'range:' + p,
                stem: '',
                page: p,
                label: 'p. ' + p,
                original_script: ''
            };
        });
    };

    const groupIsRangePack = (group) => {
        if (!group || group.type !== 'group' || !group.raw_data) return false;
        if (group.raw_data.group_role === 'range') return true;
        if (String(group.raw_data.pack_combo_id || '').trim()) return true;
        const rows = Array.isArray(group.raw_data.pack_rows) ? group.raw_data.pack_rows : [];
        return rows.some(function (r) {
            return !!(String((r && (r.combo_id || r.comboId)) || '').trim()
                || String((r && (r.primary_unit || r.primaryUnit)) || '').trim()
                || String((r && (r.secondary_unit || r.secondaryUnit)) || '').trim()
                || String((r && r.page) || '').trim());
        });
    };

    const comboNameFromBookConcatTitle = (text) => {
        const s = String(text || '').replace(/<[^>]*>/g, '').trim();
        if (!s) return '';
        const segs = s.split(/\s*[;；]\s*/).filter(Boolean);
        if (!segs.length) return '';
        const m = segs[0].match(/^(.+?)\s+\d+\s*\/\s*/);
        if (!m) return '';
        const name = String(m[1] || '').trim();
        if (!name) return '';
        const ok = segs.every(function (seg) {
            return seg === name || seg.indexOf(name + ' ') === 0;
        });
        return ok ? name : '';
    };

    const packComboNamesFromGroup = (group) => {
        if (!group || !group.raw_data) return '';
        const rows = Array.isArray(group.raw_data.pack_rows) ? group.raw_data.pack_rows : [];
        const names = [];
        const seen = {};
        rows.forEach(function (r) {
            const lab = String((r && (r.combo_label || r.comboLabel)) || '').trim();
            const k = lab.toUpperCase();
            if (!lab || seen[k]) return;
            seen[k] = true;
            names.push(lab);
        });
        return names.join('；') || String(group.raw_data.pack_combo_label || '').trim();
    };

    const rangeGroupTitleIsComboNameLocal = (group) => {
        const names = packComboNamesFromGroup(group);
        if (!names) return false;
        const title = String((group && group.title) || '').replace(/<[^>]*>/g, '').trim();
        if (!title) return true;
        const norm = function (s) {
            return String(s || '').replace(/[／;；]/g, '|').replace(/\s+/g, '').toUpperCase();
        };
        return norm(title) === norm(names);
    };

    const stripLeadingComboNames = (title, namesStr) => {
        let t = String(title || '').replace(/<[^>]*>/g, '').trim();
        const names = String(namesStr || '').split(/[；;／]/).map(function (n) { return n.trim(); }).filter(Boolean);
        names.sort(function (a, b) { return b.length - a.length; });
        names.forEach(function (n) {
            if (!n || !t) return;
            if (t.toUpperCase() === n.toUpperCase()) {
                t = '';
                return;
            }
            const re = new RegExp('(^|[；;]\\s*)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'gi');
            t = t.replace(re, '$1');
        });
        return t.replace(/^[；;]\s*/, '').replace(/\s+/g, ' ').trim();
    };

    const packHostForBookAudio = (task, parentRangeGroup) => {
        if (groupIsRangePack(parentRangeGroup)) return parentRangeGroup;
        if (parentRangeGroup && parentRangeGroup.raw_data && Array.isArray(parentRangeGroup.raw_data.pack_rows)
            && parentRangeGroup.raw_data.pack_rows.length) {
            return parentRangeGroup;
        }
        if (task && task.raw_data && Array.isArray(task.raw_data.pack_rows) && task.raw_data.pack_rows.length) {
            return task;
        }
        return parentRangeGroup || null;
    };

    const bookComboNameFromRangeGroup = (group) => {
        if (!group || !group.raw_data) return '';
        const rows = Array.isArray(group.raw_data.pack_rows) ? group.raw_data.pack_rows : [];
        const looksBook = rows.some(function (r) {
            return !!(String((r && (r.primary_unit || r.primaryUnit)) || '').trim()
                || String((r && (r.secondary_unit || r.secondaryUnit)) || '').trim()
                || String((r && (r.heading || r.range_heading)) || '').trim()
                || String((r && r.major) || '').trim()
                || String((r && r.page) || '').trim());
        });
        if (!looksBook) return '';
        return String(group.raw_data.pack_combo_label
            || (rows[0] && (rows[0].combo_label || rows[0].comboLabel))
            || '').trim();
    };

    const listTitleForBookAudio = (task, parentRangeGroup) => {
        const raw = (task && task.raw_data) || {};
        const title = String((task && task.title) || '').replace(/<[^>]*>/g, '').trim();
        const range = String(raw.material_range || '').trim();
        const host = packHostForBookAudio(task, parentRangeGroup);
        let bookName = bookComboNameFromRangeGroup(host);
        if (!bookName) bookName = comboNameFromBookConcatTitle(range) || comboNameFromBookConcatTitle(title);
        if (!bookName) return String((task && task.title) || '');
        if (raw.title_auto_from_range === false && title && title !== range && title !== bookName
            && title.indexOf(bookName + ' ') !== 0) {
            return title;
        }
        if (rangeGroupTitleIsComboNameLocal(parentRangeGroup)) return '';
        return bookName;
    };

    const rangeTailFromTitle = (title) => {
        const s = String(title || '').replace(/<[^>]*>/g, '').trim();
        const idx = s.search(/\bpp\.\s|\bp\.\s|#/i);
        if (idx < 0) return '';
        return s.slice(idx).trim();
    };

    const listTitleForPackChild = (task, parentRangeGroup) => {
        const title = String((task && task.title) || '').replace(/<[^>]*>/g, '').trim();
        if (task && task.type === 'audio_record' && bookComboNameFromRangeGroup(packHostForBookAudio(task, parentRangeGroup))) {
            return listTitleForBookAudio(task, parentRangeGroup);
        }
        if (!rangeGroupTitleIsComboNameLocal(parentRangeGroup)) return title;
        const raw = (task && task.raw_data) || {};
        const dump = /[A-Za-z0-9]+\.[A-Za-z0-9_-]+\s*(?:pp?\.|#)/i.test(title);
        if (dump) {
            const bits = String(title || '').match(/\b(?:pp?\.\s[^;；]+|#\S+)/gi) || [];
            const seen = {};
            const uniq = [];
            bits.forEach((b) => {
                const k = String(b || '').replace(/\s+/g, ' ').trim();
                if (!k || seen[k]) return;
                seen[k] = true;
                uniq.push(k);
            });
            if (uniq.length) return uniq.join('；');
        }
        const tail = rangeTailFromTitle(title);
        if (raw.title_auto_from_range === false && title && !tail && !dump) return title;
        if (tail) return tail;
        return stripLeadingComboNames(title, packComboNamesFromGroup(parentRangeGroup));
    };

    const bookRangeRowFilled = (r) => {
        return !!(String((r && (r.primary_unit || r.primaryUnit)) || '').trim()
            || String((r && (r.secondary_unit || r.secondaryUnit)) || '').trim()
            || String((r && (r.heading || r.range_heading)) || '').trim()
            || String((r && r.major) || '').trim()
            || String((r && r.secondary) || '').trim()
            || String((r && r.minor) || '').trim()
            || String((r && r.page) || '').trim()
            || String((r && r.book_script) || '').trim());
    };

    const bookPasteWindowLabelLocal = (row, idx) => {
        const trim = function (s) { return String(s == null ? '' : s).trim(); };
        const a = trim(row && (row.primary_unit || row.primaryUnit));
        const b = trim(row && (row.secondary_unit || row.secondaryUnit));
        const pair = (a && b) ? (a + '-' + b) : (a || b);
        const page = trim(row && row.page);
        const heading = trim(row && (row.heading || row.range_heading));
        const major = trim(row && row.major);
        const secondary = trim(row && row.secondary);
        const minor = trim(row && row.minor);
        const mid = [];
        if (page) mid.push('p. ' + page);
        if (major) mid.push(major);
        if (secondary) mid.push(secondary);
        if (minor) mid.push(minor);
        let body = mid.join(' ');
        if (heading) body = body ? (body + ' - ' + heading) : heading;
        if (pair && body) return pair + ': ' + body;
        if (pair) return pair;
        if (body) return body;
        return '區段 ' + (Number(idx) + 1);
    };

    const recordingUnitsFromBook = (task, parentRangeGroup) => {
        const host = packHostForBookAudio(task, parentRangeGroup);
        if (!host || !host.raw_data) return null;
        const rows = Array.isArray(host.raw_data.pack_rows) ? host.raw_data.pack_rows : [];
        const filled = [];
        rows.forEach(function (r, i) {
            if (bookRangeRowFilled(r)) filled.push({ row: r, idx: i });
        });
        if (!filled.length) return null;
        const wins = (task && task.raw_data && Array.isArray(task.raw_data.paste_windows))
            ? task.raw_data.paste_windows
            : [];
        return filled.map(function (item) {
            const r = item.row;
            const i = item.idx;
            const pageRaw = String((r && r.page) || '').trim();
            const pageNum = pageRaw ? Number(pageRaw) : NaN;
            const win = wins[i] || {};
            return {
                unit_key: 'book:' + i,
                stem: '',
                page: (pageRaw && !isNaN(pageNum)) ? pageNum : null,
                label: bookPasteWindowLabelLocal(r, i),
                original_script: String((win && win.script) || '')
            };
        });
    };

    const listDescForBookAudio = (task, parentRangeGroup) => {
        const raw = (task && task.raw_data) || {};
        const units = recordingUnitsFromBook(task, parentRangeGroup);
        const lines = (units || []).map(function (u) { return String((u && u.label) || '').trim(); }).filter(Boolean);
        const generatedPlain = lines.join('\n');
        const generatedHtml = lines.map(function (line) {
            return String(line).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }).join('<br>');
        if (raw.desc_auto_from_range === false && task && task.description) return task.description;
        const current = String((task && task.description) || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const genNorm = String(generatedPlain || '').replace(/\s+/g, ' ').trim();
        if (generatedHtml && (raw.desc_auto_from_range === true || !current || current === genNorm)) {
            return generatedHtml;
        }
        return (task && task.description) || '';
    };

    /**
     * 學生看得到的範圍。標題若已是 pp. 1~3，以標題為準（Snapshot 殘列不得多出第 4 頁）。
     * material_range 若是「A pp. 1~2；B pp. 1~2」多活頁，維持原字。
     * 單段但夾了書名（Jessie-vBK A pp. 1~3）時，收成單純頁碼範圍再對齊。
     */
    const visibleRecordingRange = (task) => {
        const raw = (task && task.raw_data) || {};
        const title = String((task && task.title) || '').replace(/<[^>]*>/g, '').trim();
        if (isSimplePageRangeText(title)) return title;
        const range = String(raw.material_range || '').trim();
        if (isSimplePageRangeText(range)) return range;
        if (range && !/[;；]/.test(range)) {
            const pages = pagesFromRangeText(range);
            const unique = [];
            pages.forEach(function (p) {
                if (unique.indexOf(p) === -1) unique.push(p);
            });
            if (unique.length === 1) return 'p. ' + unique[0];
            if (unique.length > 1) return 'pp. ' + unique.join(', ');
        }
        return range || title;
    };

    /** 從學生顯示全文抽出某一頁（【套餐名】[2] … 到下一頁之前）。 */
    const extractDisplayBlockForPage = (fullText, page) => {
        const text = String(fullText || '');
        if (!text.trim() || page == null || page === '') return '';
        const pageNum = Number(page);
        if (isNaN(pageNum)) return '';
        const re = /【([^\n】]*)】\s*\[(\d+)\]/g;
        const starts = [];
        let m;
        while ((m = re.exec(text))) {
            starts.push({ stem: m[1], page: parseInt(m[2], 10), index: m.index, end: m.index + m[0].length });
        }
        if (!starts.length) return '';
        const hit = starts.filter(function (s) { return s.page === pageNum; })[0];
        if (!hit) return '';
        let next = null;
        starts.forEach(function (s) {
            if (s.index > hit.index && (!next || s.index < next.index)) next = s;
        });
        let block = text.slice(hit.index, next ? next.index : text.length).trim();
        const header = '【' + hit.stem + '】[' + pageNum + ']';
        block = block.replace(/【[^\n】]*】\s*\[\d+\]/, header);
        return block.trim();
    };

    const studioTranscriptForPage = (task, pageUnit, fallbackText) => {
        const raw = (task && task.raw_data) || {};
        const page = pageUnit && pageUnit.page;
        const display = String(raw.student_display_text || raw.student_display || raw.student_text || '');
        const fromDisplay = extractDisplayBlockForPage(display, page);
        if (fromDisplay) return fromDisplay;
        const unitScript = String((pageUnit && pageUnit.original_script) || '').trim();
        if (unitScript) return unitScript;
        const fromScript = extractDisplayBlockForPage(String(raw.original_script || ''), page);
        if (fromScript) return fromScript;
        return String(fallbackText || '').trim();
    };

    const countRecordingUnits = (task, parentRangeGroup) => getRecordingBoard(task, null, parentRangeGroup).expectedCount;

    const pageFromMeta = (meta) => {
        if (!meta) return null;
        if (meta.page != null && meta.page !== '') {
            const n = Number(meta.page);
            return isNaN(n) ? null : n;
        }
        const label = String(meta.label || '');
        const m = label.match(/(?:p\.?\s*|第\s*)(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    };

    /** 檔名對頁：認「第2頁」「Audio_p.2」。不要把作業標題裡的 pp. 1~3 當成第 1 頁。 */
    const parseRecordingPageFromName = (name) => {
        const base = String(name || '').replace(/\.[^.]+$/, '')
            .replace(/pp?\.?\s*\d+\s*[~～〜－—–-]\s*\d+/gi, ' ');
        let m = base.match(/第\s*(\d+)\s*頁/);
        if (m) return parseInt(m[1], 10);
        m = base.match(/(?:^|[^0-9a-z])(?:p|page)\s*\.?\s*(\d+)(?:[^0-9]|$)/i);
        if (m) return parseInt(m[1], 10);
        if (/T\d{2}-\d{2}-\d{2}/.test(base) || /\d{4}-\d{2}-\d{2}/.test(base)) return null;
        return null;
    };

    /**
     * 進度表播放器與錄音艙「已繳」共用：只認真正寫在檔／段上的頁碼，
     * 禁止用「第幾個檔 = 範圍第幾頁」去猜（會出現艙內 1 已繳、外面卻 p.1＋p.3 兩個播放器）。
     */
    const collectSubmittedRecordingFiles = (raw, task, parentRangeGroup) => {
        const data = raw || {};
        const expected = {};
        const bookUnits = recordingUnitsFromBook(task, parentRangeGroup);
        const unitList = bookUnits
            ? bookUnits
            : alignUnitsToVisibleRange(
                (task && task.raw_data && task.raw_data.grading_units) || [],
                visibleRecordingRange(task)
            );
        unitList.forEach(function (u) {
            if (u && u.page != null && u.page !== '') expected[Number(u.page)] = true;
        });
        const byId = {};
        const add = function (id, extra) {
            const fid = String(id || '').trim();
            if (!fid || fid === 'undefined' || fid === 'null') return;
            if (!byId[fid]) byId[fid] = { id: fid };
            if (extra) Object.assign(byId[fid], extra);
        };
        (Array.isArray(data.submitted_files) ? data.submitted_files : []).forEach(function (f) {
            if (f && f.id) add(f.id, f);
        });
        (Array.isArray(data.audio_segments) ? data.audio_segments : []).forEach(function (s) {
            if (!s) return;
            add(s.file_id, {
                unit_key: s.unit_key,
                label: s.label,
                page: s.page,
                name: s.name,
                mime: s.uploadMime || s.mime
            });
        });
        (Array.isArray(data.drive_file_ids) ? data.drive_file_ids : []).forEach(function (id) { add(id); });
        const used = {};
        const files = Object.keys(byId).map(function (id) {
            const meta = byId[id];
            let page = pageFromMeta(meta);
            if (page == null) page = parseRecordingPageFromName(meta.name);
            if (page != null && expected[page] && used[page]) page = null;
            if (page != null && expected[page]) used[page] = true;
            if (page != null && !expected[page] && Object.keys(expected).length) page = null;
            return { id: id, page: page, meta: meta };
        });
        files.sort(function (a, b) {
            const pa = a.page == null ? 999999 : Number(a.page);
            const pb = b.page == null ? 999999 : Number(b.page);
            return pa - pb;
        });
        return { files: files, pages: used };
    };

    /**
     * 錄音進度唯一真相：進度表徽章／播放器、錄音艙頁選單都只讀這份。
     * pages[] = 標題範圍展開的每一頁；submitted／fileId 來自同一份 collect。
     */
    const getRecordingBoard = (task, raw, parentRangeGroup) => {
        const bookUnits = recordingUnitsFromBook(task, parentRangeGroup);
        const units = bookUnits
            ? bookUnits
            : alignUnitsToVisibleRange(
                (task && task.raw_data && Array.isArray(task.raw_data.grading_units)) ? task.raw_data.grading_units : [],
                visibleRecordingRange(task)
            );
        const isBook = !!(bookUnits && bookUnits.length);
        const collected = collectSubmittedRecordingFiles(raw, task, parentRangeGroup);
        const fileByPage = {};
        collected.files.forEach(function (f) {
            if (f && f.page != null && !fileByPage[Number(f.page)]) fileByPage[Number(f.page)] = f;
        });
        const pages = units.map(function (u, i) {
            const pageNum = (u && u.page != null && u.page !== '') ? Number(u.page) : null;
            const hit = (pageNum != null && fileByPage[pageNum]) ? fileByPage[pageNum] : null;
            const row = {
                unit_key: String((u && u.unit_key) || '').trim() || (pageNum != null ? ('range:' + pageNum) : ('unit:' + i)),
                stem: (u && u.stem) || '',
                page: pageNum,
                label: (u && u.label) || (pageNum != null ? ('p. ' + pageNum) : (isBook ? ('第' + (i + 1) + '段') : ('第' + (i + 1) + '頁'))),
                original_script: String((u && u.original_script) || '').trim(),
                submitted: !!hit,
                fileId: hit ? String(hit.id) : '',
                meta: hit ? hit.meta : null
            };
            row.student_display = studioTranscriptForPage(task, row, '');
            return row;
        });
        const submittedKeys = {};
        pages.forEach(function (p) {
            if (!p.submitted) return;
            if (p.unit_key) submittedKeys[p.unit_key] = true;
            if (p.page != null) submittedKeys['range:' + Number(p.page)] = true;
        });
        const players = pages.filter(function (p) { return p.submitted && p.fileId; });
        return {
            pages: pages,
            expectedCount: pages.length,
            submittedCount: players.length,
            submittedKeys: submittedKeys,
            players: players
        };
    };

    /** 已繳交檔：音檔播放／圖片顯示／文件開預覽（開的是檔案，不是資料夾）；每筆都可「🔁 取代」 */
    const buildSubmittedFilesHtml = (fileIds, audioUrl, inlinePlayerId, fileMetas, courseId, taskId, statusId, skeletonUnitsForLabel, materialRangeForLabel) => {
        const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean).map(String) : [];
        if (ids.length === 0 && audioUrl) {
            const m = String(audioUrl).match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) ids.push(m[1]);
        }
        if (ids.length === 0) return '';

        const metas = Array.isArray(fileMetas) ? fileMetas : [];
        const fallbackUnits = Array.isArray(skeletonUnitsForLabel) ? skeletonUnitsForLabel : null;
        // 優先序：① base 範圍文字展開的頁碼 ② 骨架單元列表（陣列位置對應）③ 都沒有才顯示「第 X 檔」
        // 🌟 2026-08-10 修正：之前要求「解析出的頁數 === 檔案數」才整批套用，只要學生多傳／少傳一個檔案，
        // 全部檔案就整批打回「第 X 檔」，看起來完全沒生效（老師回報「還是沒有顯示頁碼編號」）。
        // 改成逐檔位置對應：只要該位置有解析出頁碼就用，超出範圍的才 fallback，不要求整批數量剛好相等。
        const rangePages = pagesFromRangeText(materialRangeForLabel);
        const rows = ids.map(function (fileId, idx) {
            const meta = metas.find(function (m) { return m && String(m.id) === String(fileId); }) || metas[idx] || null;
            let page = pageFromMeta(meta);
            if (page == null) page = parseRecordingPageFromName(meta && meta.name);
            return { fileId: fileId, meta: meta, idx: idx, page: page };
        });
        rows.sort(function (a, b) {
            const pa = a.page == null ? 999999 : Number(a.page);
            const pb = b.page == null ? 999999 : Number(b.page);
            if (pa !== pb) return pa - pb;
            return a.idx - b.idx;
        });
        const showLabel = ids.length > 1;
        let html = '<div style="display:flex; flex-direction:column; gap:6px; width:100%;">';
        rows.forEach((row, idx) => {
            const fileId = row.fileId;
            const meta = row.meta;
            const kind = guessSubmittedKind(fileId, row.idx === 0 ? audioUrl : '', meta);
            const viewUrl = resolveDriveViewUrl(fileId);
            const playerId = ids.length === 1 ? inlinePlayerId : `${inlinePlayerId}-${idx}`;
            const rangeLabel = (row.page != null) ? ('p. ' + row.page) : '';
            const labelChip = rangeLabel
                ? `<span style="flex:0 0 auto; font-size:0.75rem; font-weight:900; color:#4338CA; background:#EEF2FF; border:1px solid #C7D2FE; padding:2px 8px; border-radius:999px; min-width:20px; text-align:center;">${escapeAttr(rangeLabel)}</span>`
                : (ids.length > 1 ? `<span style="flex:0 0 auto; font-size:0.75rem; font-weight:900; color:#64748B; background:#F1F5F9; border:1px solid #E2E8F0; padding:2px 8px; border-radius:999px;">未標頁</span>` : '');
            const replaceBtnHtml = buildReplaceButtonHtml(fileId, meta, kind, courseId, taskId, statusId, idx);

            if (kind === 'audio') {
                // 🌟 依老師要求拿掉「開啟音檔」灰色按鈕：inline <audio controls> 本身就能播放，
                // 多一顆連去 Drive 開檔的按鈕只是重複功能、徒增畫面雜亂。
                const streamUrl = resolveStreamUrl(fileId);
                html += `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    ${labelChip}
                    <audio id="${escapeAttr(playerId)}" controls src="${escapeAttr(streamUrl)}" preload="none" data-stream-url="${escapeAttr(streamUrl)}" onerror="window.UIStudentTimelineTemplates && window.UIStudentTimelineTemplates.recoverAudioPlayer(this)" onloadedmetadata="window.UIStudentTimelineTemplates && window.UIStudentTimelineTemplates.recoverAudioPlayerIfEmpty(this)" style="height:34px; flex:1 1 220px; min-width:180px; max-width:340px; outline:none; border-radius:8px; vertical-align:middle;"></audio>
                    ${replaceBtnHtml}
                </div>`;
            } else if (kind === 'image') {
                const previewUrl = resolveDrivePreviewUrl(fileId);
                html += `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                    <a href="${escapeAttr(viewUrl)}" target="_blank" rel="noopener" title="開啟原圖">
                        <img src="${escapeAttr(previewUrl)}" alt="繳交圖片" style="max-width:min(360px,100%); max-height:220px; border-radius:8px; border:1px solid #E2E8F0; object-fit:contain; background:#F8FAFC;" onerror="this.style.display='none'">
                    </a>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        ${labelChip}
                        ${taskLink('開啟圖片', viewUrl, 'ghost')}
                        ${replaceBtnHtml}
                    </div>
                </div>`;
            } else {
                // 🌟 pdf／一般檔案：之前這裡完全不畫任何東西（勾勾已顯示已繳交），
                // 但這樣學生連「看到哪個檔案、選哪個取代」都做不到，補上檔名＋開檔＋取代。
                const fileName = meta && meta.name ? String(meta.name) : (kind === 'pdf' ? '已繳交 PDF' : '已繳交檔案');
                html += `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    ${labelChip}
                    ${taskLink('📄 ' + fileName, viewUrl, 'ghost', fileName)}
                    ${replaceBtnHtml}
                </div>`;
            }
        });
        html += '</div>';
        return html;
    };

    // 🎧 2. 錯音切片連動引擎
    let sliceTimerInterval = null;
    let sliceAudioCache = {};
    const playSliceViaFileId = (fileId, startTime, endTime) => {
        if (!fileId) return;
        if (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.playStudentAudioSlice === 'function') {
            window.FeatureStudentTimeline.playStudentAudioSlice(fileId, startTime, endTime);
            return;
        }
        if (!sliceAudioCache[fileId]) {
            const streamUrl = (window.ApiService && typeof window.ApiService.getAudioStreamUrl === 'function')
                ? window.ApiService.getAudioStreamUrl(fileId)
                : `https://drive.google.com/uc?export=download&id=${fileId}`;
            sliceAudioCache[fileId] = new Audio(streamUrl);
        }
        const audio = sliceAudioCache[fileId];
        if (sliceTimerInterval) clearInterval(sliceTimerInterval);
        audio.pause();
        const run = () => {
            audio.currentTime = startTime;
            audio.play().catch(e => {
                console.warn('切片播放被阻擋:', e);
                window.showFlash('無法播放錯音片段，請先點上方播放器播放一次。', 'error');
            });
            sliceTimerInterval = setInterval(() => {
                if (audio.paused || audio.currentTime >= endTime) {
                    audio.pause();
                    clearInterval(sliceTimerInterval);
                }
            }, 50);
        };
        if (audio.readyState >= 1) run();
        else {
            audio.addEventListener('loadedmetadata', () => run(), { once: true });
            audio.load();
        }
    };
    const playStudentAudioSlice = (playerId, startTime, endTime, fallbackFileId) => {
        try {
            let sTime = Number(startTime) || 0;
            let eTime = Number(endTime) || 0;
            if (eTime <= sTime) eTime = sTime + 1.5;

            const player = document.getElementById(playerId);
            if (!player) {
                playSliceViaFileId(fallbackFileId, sTime, eTime);
                return;
            }
            
            if (sliceTimerInterval) clearInterval(sliceTimerInterval);
            player.pause();
            
            const executePlay = () => {
                player.currentTime = sTime; 
                const playPromise = player.play();
                
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        if (Math.abs(player.currentTime - sTime) > 0.5) {
                            player.currentTime = sTime;
                        }
                        
                        sliceTimerInterval = setInterval(() => {
                            let shouldStop = false;
                            if (player.currentTime >= eTime) shouldStop = true;
                            if (player.paused) shouldStop = true;
                            
                            if (shouldStop) {
                                player.pause();
                                clearInterval(sliceTimerInterval);
                            }
                        }, 50);
                    }).catch(e => {
                        console.warn("切片播放被阻擋:", e);
                        if (fallbackFileId) playSliceViaFileId(fallbackFileId, sTime, eTime);
                        else window.showFlash('瀏覽器阻擋了自動播放，請先點上方播放器播放一次。', 'error');
                    });
                }
            };

            if (player.readyState >= 1) {
                executePlay();
            } else {
                const onReady = () => {
                    executePlay();
                    player.removeEventListener('loadedmetadata', onReady);
                };
                player.addEventListener('loadedmetadata', onReady);
                player.load(); 
            }
        } catch (e) { console.error("切片定位錯誤:", e); }
    };

    const resolveWordErrorTiming = (err, aiEval) => {
        let sTime = Number(err.start_time ?? 0);
        let eTime = Number(err.end_time ?? 0);
        if (eTime > sTime) return { sTime, eTime };

        const raw = aiEval && aiEval.provider_raw ? aiEval.provider_raw : null;
        const scoreBlock = raw ? (raw.speech_score || raw.text_score || {}) : {};
        const wordList = scoreBlock.word_score_list || [];
        const target = String(err.word || '').toLowerCase();
        const matched = wordList.find(w => String(w.word || '').toLowerCase() === target);
        if (matched && Array.isArray(matched.phone_score_list)) {
            let minE = Infinity;
            let maxE = -Infinity;
            matched.phone_score_list.forEach(p => {
                if (Array.isArray(p.extent) && p.extent.length >= 2) {
                    minE = Math.min(minE, Number(p.extent[0]));
                    maxE = Math.max(maxE, Number(p.extent[1]));
                }
            });
            if (Number.isFinite(minE) && Number.isFinite(maxE)) {
                sTime = minE / 100;
                eTime = maxE / 100;
            }
        }
        if (eTime <= sTime) eTime = sTime + 1.5;
        return { sTime, eTime };
    };

    const getScoresFromAi = (ai) => {
        let pScore = 'N/A';
        let fluency = 'N/A';
        let completeness = 'N/A';
        if (!ai) return { pScore, fluency, completeness, pScoreColor: '#64748B', avg: 'N/A' };
        if (ai.pronunciation_score !== undefined && ai.pronunciation_score !== null) pScore = ai.pronunciation_score;
        else if (ai.score !== undefined && ai.score !== null) pScore = ai.score;
        if (ai.fluency_score !== undefined && ai.fluency_score !== null) fluency = ai.fluency_score;
        if (ai.completeness_score !== undefined && ai.completeness_score !== null) completeness = ai.completeness_score;
        let pScoreColor = '#10B981';
        if (pScore !== 'N/A') {
            const numScore = Number(pScore);
            if (numScore < 80) pScoreColor = '#F59E0B';
            if (numScore < 60) pScoreColor = '#EF4444';
        }
        let avg = 'N/A';
        if (pScore !== 'N/A' && fluency !== 'N/A') {
            avg = Math.round((Number(pScore) + Number(fluency)) / 2);
        } else if (pScore !== 'N/A') avg = Number(pScore);
        return { pScore, fluency, completeness, pScoreColor, avg };
    };

    const formatAttemptDate = (ts) => {
        if (!ts) return '未知時間';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return String(ts);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const extractDriveFileId = (url) => {
        if (!url) return '';
        const str = String(url);
        let m = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!m) m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        return m ? m[1] : '';
    };

    /**
     * 從一筆 task_completions 記錄推出「這次繳交的音檔要用哪個 fileId 播放」。
     * 抽成共用函式讓課程進度／學習分析兩邊用同一套判斷，避免各寫一份、之後改壞其中一邊。
     */
    const resolveAudioContextFromCompletion = (compRecord) => {
        let retryAudioId = '';
        let retryAudioUrl = '';
        let hasValidAudioFile = false;
        let submittedFileIds = [];

        if (!compRecord || !compRecord.raw_data) {
            return { retryAudioId, hasValidAudioFile };
        }

        const raw = compRecord.raw_data;
        const url1 = raw.student_audio_url;
        const url2 = raw.audio_url;
        retryAudioUrl = String(url1 ? url1 : (url2 ? url2 : ''));

        if (Array.isArray(raw.drive_file_ids)) {
            submittedFileIds = raw.drive_file_ids.map(String).filter(Boolean);
        }

        if (!retryAudioUrl) {
            if (submittedFileIds.length > 0) {
                retryAudioId = String(submittedFileIds[0]);
                retryAudioUrl = `https://drive.google.com/file/d/${retryAudioId}/view`;
            }
        } else {
            let driveIdMatch = retryAudioUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
            if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
            if (driveIdMatch) retryAudioId = driveIdMatch[1];
        }

        if (retryAudioId && submittedFileIds.indexOf(String(retryAudioId)) === -1) {
            submittedFileIds.unshift(String(retryAudioId));
        }

        if (submittedFileIds.length > 0 || retryAudioUrl) {
            hasValidAudioFile = true;
        }

        return { retryAudioId, hasValidAudioFile };
    };

    const getWordErrorCount = (ai) => {
        if (!ai) return 0;
        if (!ai.word_errors) return 0;
        if (!Array.isArray(ai.word_errors)) return 0;
        return ai.word_errors.length;
    };

    const truncateFeedback = (text, maxLen) => {
        const str = String(text ? text : '').replace(/\s+/g, ' ').trim();
        if (str.length <= maxLen) return str;
        return str.slice(0, maxLen) + '…';
    };

    const buildLearningTrackHtml = (currentAi, history) => {
        const safeHistory = Array.isArray(history) ? history : [];
        const aiAttempts = [];
        safeHistory.forEach(h => {
            if (h && h.ai_evaluation) aiAttempts.push(h.ai_evaluation);
        });
        aiAttempts.push(currentAi);
        const totalAttempts = aiAttempts.length;
        const current = getScoresFromAi(currentAi);
        const first = getScoresFromAi(aiAttempts[0]);

        let pDeltaStr = '';
        if (current.pScore !== 'N/A' && first.pScore !== 'N/A' && totalAttempts > 1) {
            const d = Number(current.pScore) - Number(first.pScore);
            if (d > 0) pDeltaStr = `(↑${d})`;
            else if (d < 0) pDeltaStr = `(↓${Math.abs(d)})`;
            else pDeltaStr = '(持平)';
        }

        const errorCounts = aiAttempts.map(a => getWordErrorCount(a));
        const errorTrend = errorCounts.join(' → ');

        const wordFreq = {};
        aiAttempts.forEach(a => {
            const list = a && a.word_errors ? a.word_errors : [];
            list.forEach(e => {
                const w = String(e.word ? e.word : '').toLowerCase();
                if (w) wordFreq[w] = (wordFreq[w] ? wordFreq[w] : 0) + 1;
            });
        });
        const recurring = Object.entries(wordFreq).filter(entry => entry[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const recurringHtml = recurring.length > 0
            ? recurring.map(([w, c]) => `<span style="background:#FEE2E2;color:#B91C1C;padding:1px 6px;border-radius:4px;font-weight:800;font-size:0.75rem;">${w}(${c}次)</span>`).join(' ')
            : '<span style="color:#94A3B8;font-size:0.78rem;">無</span>';

        let fixedSincePrevHtml = '<span style="color:#94A3B8;font-size:0.78rem;">—</span>';
        let newSincePrevHtml = '<span style="color:#94A3B8;font-size:0.78rem;">—</span>';
        if (totalAttempts >= 2) {
            const prevAi = aiAttempts[totalAttempts - 2];
            const latestAi = aiAttempts[totalAttempts - 1];
            const prevWords = new Set();
            const latestWords = new Set();
            const prevList = prevAi && prevAi.word_errors ? prevAi.word_errors : [];
            const latestList = latestAi && latestAi.word_errors ? latestAi.word_errors : [];
            prevList.forEach(e => { const w = String(e.word ? e.word : '').toLowerCase(); if (w) prevWords.add(w); });
            latestList.forEach(e => { const w = String(e.word ? e.word : '').toLowerCase(); if (w) latestWords.add(w); });
            const fixedSincePrev = [];
            const newSincePrev = [];
            prevWords.forEach(w => { if (!latestWords.has(w)) fixedSincePrev.push(w); });
            latestWords.forEach(w => { if (!prevWords.has(w)) newSincePrev.push(w); });
            if (fixedSincePrev.length > 0) {
                fixedSincePrevHtml = fixedSincePrev.slice(0, 4).map(w => `<span style="background:#D1FAE5;color:#065F46;padding:1px 6px;border-radius:4px;font-weight:800;font-size:0.75rem;">${w}</span>`).join(' ');
            }
            if (newSincePrev.length > 0) {
                newSincePrevHtml = newSincePrev.slice(0, 4).map(w => `<span style="background:#FEE2E2;color:#B91C1C;padding:1px 6px;border-radius:4px;font-weight:800;font-size:0.75rem;">${w}</span>`).join(' ');
            }
        }

        const dotsHtml = aiAttempts.map((a, i) => {
            const s = getScoresFromAi(a);
            const num = s.pScore !== 'N/A' ? Number(s.pScore) : 0;
            const size = 8 + Math.round(num / 15);
            const isLast = i === aiAttempts.length - 1;
            const dot = `<span title="第${i + 1}次 發音${s.pScore}" style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${isLast ? '#6366F1' : '#A5B4FC'};border:2px solid white;box-shadow:0 0 0 1px #C7D2FE;flex-shrink:0;"></span>`;
            const line = isLast ? '' : `<span style="flex:1;height:2px;background:linear-gradient(90deg,#C7D2FE,#E0E7FF);min-width:12px;"></span>`;
            return dot + line;
        }).join('');

        let insightLine = '';
        if (totalAttempts > 1 && current.pScore !== 'N/A' && first.pScore !== 'N/A') {
            const d = Number(current.pScore) - Number(first.pScore);
            if (d > 0) insightLine = `發音較首次進步 ${d} 分，持續保持！`;
            else if (d < 0) insightLine = `發音較首次下降 ${Math.abs(d)} 分，再練一次吧。`;
            else insightLine = `共 ${totalAttempts} 次練習，發音維持穩定。`;
        }

        return `
            <div style="margin-bottom:12px;padding:10px 12px;background:linear-gradient(135deg,#EEF2FF,#FAF5FF);border:1px solid #C7D2FE;border-radius:8px;">
                <div style="font-weight:900;color:#4338CA;font-size:0.9rem;margin-bottom:8px;">📊 本作業學習軌跡</div>
                <div style="display:flex;align-items:center;gap:0;margin-bottom:8px;padding:4px 0;">${dotsHtml}</div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:6px;">
                    批改 <strong style="color:#334155;">${totalAttempts}</strong> 次
                    · 發音 <strong style="color:${current.pScoreColor};">${first.pScore} → ${current.pScore}</strong> ${pDeltaStr}
                    · 流暢 ${first.fluency} → ${current.fluency}
                </div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">错音數 ${errorTrend}</div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        <span style="font-weight:800;">反覆出現</span>
                        <span style="color:#94A3B8;font-size:0.72rem;">（2 次以上批改都被標記的错音）</span>
                        ${recurringHtml}
                    </div>
                </div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        <span style="font-weight:800;">較上次已修正</span>
                        <span style="color:#94A3B8;font-size:0.72rem;">（上次有错、這次沒再出現）</span>
                        ${fixedSincePrevHtml}
                    </div>
                </div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        <span style="font-weight:800;">本次新错音</span>
                        <span style="color:#94A3B8;font-size:0.72rem;">（這次新被標記、上次沒有）</span>
                        ${newSincePrevHtml}
                    </div>
                </div>
                ${insightLine ? `<div style="font-size:0.78rem;color:#4338CA;font-weight:700;margin-top:6px;padding-top:6px;border-top:1px dashed #C7D2FE;">💡 ${insightLine}</div>` : ''}
            </div>`;
    };

    const renderCurrentRowDetailHtml = (ai, compositeKey, inlinePlayerId, fallbackFileId, hasValidAudioFile, perPageEvals) => {
        return `<div style="padding:8px 4px;">${renderEvaluationDetailHtml(ai, inlinePlayerId, fallbackFileId, hasValidAudioFile, perPageEvals)}</div>`;
    };

    const renderHistorySummaryHtml = (ai, compositeKey, historyIndex, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        if (!ai) return '';
        let feedback = ai.comprehensive_feedback ? ai.comprehensive_feedback : (ai.feedback ? ai.feedback : '無綜合評語');
        const shortFeedback = truncateFeedback(feedback, 140);
        const errors = ai.word_errors ? ai.word_errors : [];
        let chipsHtml = '';
        if (errors.length > 0) {
            chipsHtml = errors.slice(0, 10).map(err => {
                const w = err.word ? err.word : '';
                return `<span style="background:#FEF2F2;color:#991B1B;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:800;border:1px solid #FECACA;">${String(w)}</span>`;
            }).join(' ');
            if (errors.length > 10) chipsHtml += `<span style="font-size:0.72rem;color:#94A3B8;">+${errors.length - 10}</span>`;
        } else {
            chipsHtml = '<span style="font-size:0.78rem;color:#10B981;font-weight:800;">✓ 無明顯错音</span>';
        }
        return `
            <div style="padding:8px 4px;">
                <div style="font-size:0.82rem;color:#475569;line-height:1.5;margin-bottom:8px;">${String(shortFeedback).replace(/\n/g, ' ')}</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${chipsHtml}</div>
                <button type="button" id="ai-history-full-btn-${compositeKey}-${historyIndex}" onclick="event.stopPropagation(); window.FeatureStudentTimeline.toggleAIHistoryFull('${compositeKey}', ${historyIndex})" style="font-size:0.75rem;padding:3px 10px;border-radius:4px;border:1px solid #C7D2FE;background:white;color:#4338CA;font-weight:800;cursor:pointer;">查看完整報告</button>
                <div id="ai-history-full-${compositeKey}-${historyIndex}" style="display:none;margin-top:10px;">
                    ${renderEvaluationDetailHtml(ai, inlinePlayerId, fallbackFileId, hasValidAudioFile)}
                </div>
            </div>`;
    };

    const buildHistoryTableHtml = (compositeKey, gradingHistory, currentAi, inlinePlayerId, defaultFileId, hasValidAudioFile, currentAiEvaluations) => {
        if (!currentAi) return '';

        const aiEntries = [];
        const safeHistory = Array.isArray(gradingHistory) ? gradingHistory : [];
        safeHistory.forEach((h, idx) => {
            if (h && h.ai_evaluation) aiEntries.push({ h, idx });
        });

        const totalAttempts = aiEntries.length + 1;
        const currentScores = getScoresFromAi(currentAi);
        const currentDate = formatAttemptDate(currentAi.graded_at ? currentAi.graded_at : '');
        const currentErrCount = getWordErrorCount(currentAi);

        let currentDeltaStr = '—';
        if (aiEntries.length > 0) {
            const lastHistory = aiEntries[aiEntries.length - 1];
            const prevScores = getScoresFromAi(lastHistory.h.ai_evaluation);
            if (currentScores.pScore !== 'N/A' && prevScores.pScore !== 'N/A') {
                const d = Number(currentScores.pScore) - Number(prevScores.pScore);
                if (d > 0) currentDeltaStr = `<span style="color:#059669;">+${d}</span>`;
                else if (d < 0) currentDeltaStr = `<span style="color:#DC2626;">${d}</span>`;
                else currentDeltaStr = '0';
            }
        }

        const openIdxRaw = localStorage.getItem(`ai_history_open_${compositeKey}`);
        const expandAll = openIdxRaw === 'all';
        const historyRowSelected = openIdxRaw && openIdxRaw !== 'all' && openIdxRaw !== 'current' && openIdxRaw !== '-1';
        const isCurrentOpen = expandAll ? true : !historyRowSelected;
        const openKey = openIdxRaw ? openIdxRaw : 'current';
        const currentRowIcon = isCurrentOpen ? '▼' : '▶';
        const currentDetailDisplay = isCurrentOpen ? 'table-row' : 'none';
        const currentDetailHtml = renderCurrentRowDetailHtml(currentAi, compositeKey, inlinePlayerId, defaultFileId, hasValidAudioFile, currentAiEvaluations);

        const currentRowHtml = `
            <tr style="cursor:pointer;background:${isCurrentOpen ? '#EDE9FE' : 'white'};" onclick="window.FeatureStudentTimeline.toggleAIHistoryRow('${compositeKey}', 'current')">
                <td style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;width:24px;"><span id="ai-history-icon-${compositeKey}-current">${currentRowIcon}</span></td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#6D28D9;white-space:nowrap;">
                    第 ${totalAttempts} 次
                    <span style="font-size:0.68rem;background:#8B5CF6;color:white;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:900;">最新</span>
                </td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;color:#64748B;font-size:0.78rem;white-space:nowrap;">${currentDate}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:${currentScores.pScoreColor};text-align:center;">${currentScores.pScore}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:#3B82F6;text-align:center;">${currentScores.fluency}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#EF4444;text-align:center;">${currentErrCount}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;text-align:center;">${currentDeltaStr}</td>
            </tr>
            <tr id="ai-history-detail-${compositeKey}-current" style="display:${currentDetailDisplay};">
                <td colspan="7" style="padding:0 8px 8px;border:1px solid #E2E8F0;background:#FAF5FF;border-top:none;">
                    ${currentDetailHtml}
                </td>
            </tr>`;

        const displayEntries = aiEntries.slice().reverse();
        const historyRowsHtml = displayEntries.map(entry => {
            const h = entry.h;
            const idx = entry.idx;
            const attemptNum = idx + 1;
            const hScores = getScoresFromAi(h.ai_evaluation);
            const hDate = formatAttemptDate(h.timestamp ? h.timestamp : (h.ai_evaluation.graded_at ? h.ai_evaluation.graded_at : ''));
            const errCount = getWordErrorCount(h.ai_evaluation);

            let deltaStr = '—';
            if (idx > 0) {
                const prevEntry = safeHistory[idx - 1];
                if (prevEntry && prevEntry.ai_evaluation) {
                    const prevScores = getScoresFromAi(prevEntry.ai_evaluation);
                    if (hScores.pScore !== 'N/A' && prevScores.pScore !== 'N/A') {
                        const d = Number(hScores.pScore) - Number(prevScores.pScore);
                        if (d > 0) deltaStr = `<span style="color:#059669;">+${d}</span>`;
                        else if (d < 0) deltaStr = `<span style="color:#DC2626;">${d}</span>`;
                        else deltaStr = '0';
                    }
                }
            }

            const historyFileId = extractDriveFileId(h.audio_url);
            const rowFileId = historyFileId ? historyFileId : defaultFileId;
            const rowHasAudio = historyFileId ? true : hasValidAudioFile;
            const rowKey = String(idx);

            const isOpen = expandAll ? true : (openKey === rowKey);
            const rowIcon = isOpen ? '▼' : '▶';
            const detailDisplay = isOpen ? 'table-row' : 'none';
            const summaryHtml = renderHistorySummaryHtml(h.ai_evaluation, compositeKey, idx, inlinePlayerId, rowFileId, rowHasAudio);

            return `
                <tr style="cursor:pointer;background:${isOpen ? '#EEF2FF' : 'white'};" onclick="window.FeatureStudentTimeline.toggleAIHistoryRow('${compositeKey}', '${rowKey}')">
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;width:24px;"><span id="ai-history-icon-${compositeKey}-${idx}">${rowIcon}</span></td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#64748B;white-space:nowrap;">第 ${attemptNum} 次</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;color:#64748B;font-size:0.78rem;white-space:nowrap;">${hDate}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:${hScores.pScoreColor};text-align:center;">${hScores.pScore}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:#3B82F6;text-align:center;">${hScores.fluency}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#EF4444;text-align:center;">${errCount}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;text-align:center;">${deltaStr}</td>
                </tr>
                <tr id="ai-history-detail-${compositeKey}-${idx}" style="display:${detailDisplay};">
                    <td colspan="7" style="padding:0 8px 8px;border:1px solid #E2E8F0;background:#F8FAFC;border-top:none;">
                        ${summaryHtml}
                    </td>
                </tr>`;
        }).join('');

        const toggleAllLabel = expandAll ? '收合全部' : '展開全部摘要';

        return `
            <div style="margin-top:12px;padding-top:12px;border-top:1px dashed #C7D2FE;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    <div style="font-weight:900;color:#6366F1;font-size:0.88rem;">📜 批改紀錄 (${totalAttempts})</div>
                    <button type="button" id="ai-history-toggle-all-${compositeKey}" onclick="window.FeatureStudentTimeline.toggleAllAIHistorySummaries('${compositeKey}')" style="font-size:0.75rem;padding:2px 10px;border-radius:4px;border:1px solid #C7D2FE;background:white;color:#4338CA;font-weight:800;cursor:pointer;">${toggleAllLabel}</button>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                        <thead>
                            <tr style="background:#F1F5F9;color:#475569;">
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;width:24px;"></th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;">次數</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;">時間</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">發音</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">流暢</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">错音</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">變化</th>
                            </tr>
                        </thead>
                        <tbody>${currentRowHtml}${historyRowsHtml}</tbody>
                    </table>
                </div>
            </div>`;
    };

    /** 把單字標準化成可比對的形式（去大小寫、去頭尾標點），用來把 word_errors 對回原文裡的位置。 */
    const normalizeWordForMatch = (w) => String(w == null ? '' : w).toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');

    /**
     * 原先規劃：批改結果直接「在文字稿上」標出錯音的單字（而非只列一張表）。
     * 依 word_errors 的 word 逐字比對 effectiveScript，命中的字直接加底線標紅，
     * 點擊可定位播放該字錄音片段（沿用既有的 playStudentAudioSlice）。
     */
    const renderScriptWithErrorHighlightsHtml = (effectiveScript, wordErrors, aiEvalForTiming, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        const script = String(effectiveScript || '').trim();
        if (!script) return '';
        const errList = Array.isArray(wordErrors) ? wordErrors : [];
        const errMap = {};
        errList.forEach(function (e) {
            const key = normalizeWordForMatch(e && e.word);
            if (key && !errMap[key]) errMap[key] = e;
        });

        const tokens = script.split(/(\s+)/);
        const bodyHtml = tokens.map(function (tok) {
            if (/^\s*$/.test(tok)) return tok.replace(/\n/g, '<br>');
            const key = normalizeWordForMatch(tok);
            const err = key ? errMap[key] : null;
            if (!err) return escapeAttr(tok);
            const timing = resolveWordErrorTiming(err, aiEvalForTiming);
            const tipParts = [];
            if (err.student_pronunciation) tipParts.push('你唸成：' + err.student_pronunciation);
            if (err.expected_phonetic) tipParts.push('正確音標：' + err.expected_phonetic);
            if (err.error_type) tipParts.push(err.error_type);
            const tip = tipParts.join('｜') || '發音需加強';
            const clickAttr = hasValidAudioFile
                ? ` onclick="window.UIStudentTimelineTemplates.playStudentAudioSlice('${escapeJsSingleQuoted(inlinePlayerId)}', ${timing.sTime}, ${timing.eTime}, '${escapeJsSingleQuoted(fallbackFileId)}')" style="cursor:pointer;"`
                : '';
            return `<span title="${escapeAttr(tip)}"${clickAttr} class="rt-word-error-mark" style="color:#DC2626; font-weight:900; text-decoration:underline wavy #EF4444; text-underline-offset:3px;">${escapeAttr(tok)}</span>`;
        }).join('');

        return `<div class="rt-normalize" style="font-size:0.92rem; line-height:1.9; color:#334155; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:10px 12px;">${bodyHtml}</div>`;
    };

    const renderWordErrorsHtml = (ai, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        if (!ai || !ai.word_errors || !Array.isArray(ai.word_errors) || ai.word_errors.length === 0) return '';
        return `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #E2E8F0;">
            <div style="font-weight: 900; color: #EF4444; font-size: 0.9rem; margin-bottom: 8px;">🔍 單字發音診斷：</div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                    <thead>
                        <tr style="background: #FEF2F2; color: #991B1B;">
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">目標單字</th>
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">您的錯誤發音</th>
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">正確音標</th>
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">錯誤類型</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ai.word_errors.map(err => {
                            const safeErrWord = err.word ? err.word : '';
                            const safeWord = String(safeErrWord).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            const timing = resolveWordErrorTiming(err, ai);
                            const safeStuPron = err.student_pronunciation ? err.student_pronunciation : '';
                            const safeExpPhonetic = err.expected_phonetic ? err.expected_phonetic : '';
                            const safeErrType = err.error_type ? err.error_type : '';
                            const safeFileId = String(fallbackFileId || '').replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            let playSliceHtml = '';
                            if (hasValidAudioFile) {
                                playSliceHtml = `<span onclick="window.UIStudentTimelineTemplates.playStudentAudioSlice('${inlinePlayerId}', ${timing.sTime}, ${timing.eTime}, '${safeFileId}')" style="cursor:pointer; font-size:1.2rem; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.1)); transition:transform 0.1s; margin-left: 8px;" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'" title="定位並播放錯誤發音">🎧</span>`;
                            }
                            return `
                            <tr style="background: white;">
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; font-weight: 800; color: #334155;">${String(safeErrWord)}</td>
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #EF4444; font-weight: bold;">
                                    <div style="display:flex; align-items:center; flex-wrap:nowrap;">
                                        <span>${String(safeStuPron)}</span>${playSliceHtml}
                                    </div>
                                </td>
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; font-family: monospace; color: #10B981;">
                                    <div style="display:flex; align-items:center; flex-wrap:nowrap;">
                                        <span>${String(safeExpPhonetic)}</span>
                                        <span onclick="window.UIStudentTimelineTemplates.playGoogleTTS('${safeWord}')" style="cursor:pointer; font-size:1.2rem; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.1)); transition:transform 0.1s; margin-left: 8px;" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'" title="聆聽有道示範發音">🔊</span>
                                    </div>
                                </td>
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #64748B;">${String(safeErrType)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    };

    const renderEvaluationDetailHtml = (ai, inlinePlayerId, fallbackFileId, hasValidAudioFile, perPageEvals) => {
        if (!ai) return '';
        let feedback = ai.comprehensive_feedback ? ai.comprehensive_feedback : (ai.feedback ? ai.feedback : '無綜合評語');

        // 多頁（segment_count > 1）時，每頁各自的文稿／錯音要對回「該頁」，不能整批混在一起比對，
        // 否則頁2的錯音套用頁1文稿會完全比不到字。單頁或缺 perPageEvals 時退回單一頁籤。
        const pages = (Array.isArray(perPageEvals) && perPageEvals.length > 1)
            ? perPageEvals
            : [Object.assign({}, ai, { effective_script: ai.effective_script || '' })];

        // 多頁時「文稿標錯」和「錯字表」都要各自跟著該頁走，不要合併成一份整批列表——
        // 否則沒人看得出來某個錯字到底是哪一頁的，也違反「以頁／檔為單位顯示」的要求。
        const pagesHtml = pages.map(function (p, idx) {
            const label = pages.length > 1 ? (p.label || p.unit_key || ('第 ' + (idx + 1) + ' 頁')) : '';
            const highlightHtml = renderScriptWithErrorHighlightsHtml(p.effective_script, p.word_errors, p, inlinePlayerId, fallbackFileId, hasValidAudioFile);
            if (!highlightHtml) return '';
            const labelHtml = label ? `<div style="font-weight:900; color:#4338CA; font-size:0.82rem; margin-bottom:4px;">📄 ${escapeAttr(label)}</div>` : '';
            const pageErrorsHtml = renderWordErrorsHtml(p, inlinePlayerId, fallbackFileId, hasValidAudioFile);
            return `<div style="margin-bottom:14px;">${labelHtml}${highlightHtml}${pageErrorsHtml}</div>`;
        }).join('');

        const scriptHighlightBlockHtml = pagesHtml
            ? `<div style="margin-top:10px; margin-bottom:10px;">
                <div style="font-weight: 900; color: #B45309; margin-bottom: 6px;">✍️ 文稿標錯（紅字為錯音，可點擊播放）：</div>
                ${pagesHtml}
            </div>`
            : '';

        return `<div class="rt-normalize" style="font-size: 0.95rem; color: #334155; line-height: 1.6; background: white; padding: 12px; border-radius: 6px; border: 1px solid #E2E8F0; max-height: 400px; overflow-y: auto;">
            <div style="font-weight: 900; color: #4F46E5; margin-bottom: 6px;">📝 綜合評語：</div>
            ${String(feedback).replace(/\n/g, '<br>')}
            ${scriptHighlightBlockHtml}
        </div>`;
    };

    function getLevelStyle(depth) {
        const styles = [
            { border: '#94A3B8', bg: '#F8FAFC', text: '#475569' }, 
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, 
            { border: '#8B5CF6', bg: '#F5F3FF', text: '#5B21B6' }, 
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, 
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }  
        ];
        return styles[Math.min(depth, 4)];
    }

    function stripHtml(str) {
        return String(str == null ? '' : str).replace(/<[^>]*>?/gm, '').replace(/&nbsp;/gi, ' ').trim();
    }

    function escapeAttr(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeJsSingleQuoted(str) {
        return String(str == null ? '' : str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '');
    }

    /**
     * 「取代特定已上傳檔」用：把 unit 的 original_script（可能含引號／換行／中文）
     * 存成 data-script-b64 屬性，比塞進 HTML attribute 轉義安全，讀取端再 base64 解回來。
     */
    function b64Utf8(str) {
        try {
            return btoa(unescape(encodeURIComponent(String(str == null ? '' : str))));
        } catch (_e) {
            return '';
        }
    }

    /** 多段音檔批改進度（逐段 Speechace，非一次送六檔） */
    function getAudioSegmentProgress(raw) {
        const data = raw && typeof raw === 'object' ? raw : {};
        const segs = Array.isArray(data.audio_segments) ? data.audio_segments : [];
        let done = 0;
        let pending = 0;
        let processing = 0;
        let error = 0;
        let skipped = 0;
        const items = segs.map(function (s, idx) {
            const status = s && s.status ? String(s.status) : 'pending';
            if (status === 'done' && s.ai_evaluation) done += 1;
            else if (status === 'processing') processing += 1;
            else if (status === 'error') error += 1;
            else if (status === 'skipped') skipped += 1;
            else pending += 1;
            const label = (s && (s.label || s.unit_key)) ? String(s.label || s.unit_key) : ('第' + (idx + 1) + '段');
            return { label: label, status: status, hasEval: !!(s && s.ai_evaluation) };
        });
        return {
            total: segs.length,
            done: done,
            pending: pending,
            processing: processing,
            error: error,
            skipped: skipped,
            items: items
        };
    }

    function buildSegmentProgressStripHtml(raw) {
        const prog = getAudioSegmentProgress(raw);
        if (!prog.total || prog.total < 2) return '';
        const chips = prog.items.map(function (it) {
            let bg = '#E2E8F0';
            let color = '#64748B';
            let mark = '等待';
            if (it.status === 'done' && it.hasEval) {
                bg = '#D1FAE5';
                color = '#047857';
                mark = '完成';
            } else if (it.status === 'processing') {
                bg = '#EDE9FE';
                color = '#6D28D9';
                mark = '批改中';
            } else if (it.status === 'error') {
                bg = '#FEE2E2';
                color = '#B91C1C';
                mark = '失敗';
            } else if (it.status === 'skipped') {
                bg = '#FEF3C7';
                color = '#B45309';
                mark = '略過';
            }
            return '<span style="display:inline-block;background:' + bg + ';color:' + color + ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:800;margin:2px 4px 2px 0;">'
                + escapeAttr(it.label) + ' · ' + mark + '</span>';
        }).join('');
        return '<div style="margin-top:8px;margin-left:36px;">'
            + '<div style="font-size:0.8rem;font-weight:900;color:#5B21B6;margin-bottom:4px;">📊 分段進度：已完成 '
            + prog.done + '／' + prog.total + ' 段（逐段批改，非一次送出）</div>'
            + '<div>' + chips + '</div></div>';
    }

    const recoverAudioPlayer = (audioEl) => {
        if (!audioEl || audioEl.dataset.recovering === '1' || audioEl.dataset.recovered === '1') return;
        const src = audioEl.getAttribute('data-stream-url') || audioEl.getAttribute('src') || '';
        if (!src || src.indexOf('stream-audio') === -1) return;
        audioEl.dataset.recovering = '1';
        fetch(src).then(function (r) {
            if (!r.ok) throw new Error('stream ' + r.status);
            const ct = String(r.headers.get('Content-Type') || '');
            if (/json|html|text\/plain/i.test(ct)) throw new Error('not audio');
            return r.blob();
        }).then(function (blob) {
            if (!blob || blob.size < 64) throw new Error('empty');
            if (/json|html/i.test(blob.type || '')) throw new Error('not audio');
            const url = URL.createObjectURL(blob);
            audioEl.src = url;
            audioEl.dataset.recovered = '1';
            audioEl.dataset.recovering = '';
            audioEl.preload = 'metadata';
        }).catch(function () {
            audioEl.dataset.recovering = '';
            audioEl.title = '音檔無法播放，請用「取代」重傳這一頁';
        });
    };

    const recoverAudioPlayerIfEmpty = (audioEl) => {
        if (!audioEl) return;
        const dur = Number(audioEl.duration);
        if (!isFinite(dur) || dur <= 0) recoverAudioPlayer(audioEl);
    };

    console.log("🚀 [LogOn Web] UIStudentTimelineTemplates V146 模組已成功載入！");

    return {
        playGoogleTTS,
        playStudentAudioSlice,
        recoverAudioPlayer,
        recoverAudioPlayerIfEmpty, 

        // 供上傳流程（feature-student-timeline.js）重用：把 base 範圍文字展開成頁碼陣列，
        // 讓「已選檔數 vs. 範圍應有頁數」的提醒跟「已繳交檔頁碼標籤」共用同一套展開邏輯，
        // 避免兩處各寫一份、之後改一邊漏改另一邊。
        pagesFromRangeText,
        alignUnitsToVisibleRange,
        countRecordingUnits,
        visibleRecordingRange,
        extractDisplayBlockForPage,
        studioTranscriptForPage,
        parseRecordingPageFromName,
        collectSubmittedRecordingFiles,
        getRecordingBoard,
        recordingUnitsFromBook,
        groupIsRangePack,

        // 供「學習分析」頁籤（feature-student-analytics.js）重用，不必複製一份邏輯。
        getScoresFromAi,
        renderScriptWithErrorHighlightsHtml,
        renderWordErrorsHtml,
        formatAttemptDate,
        escapeAttr,
        escapeJsSingleQuoted,
        resolveAudioContextFromCompletion,
        getAudioSegmentProgress,
        buildSegmentProgressStripHtml,
        
        renderTimelineNodes: (timelineNodes, assignments, completedTasks, currentWeekStart, mode, weekStartSetting, DateUtils, studentDriveUrl, safeFormatUrl, classGradingPolicy) => {
            try {
                let html = '';
                
                const safeTimelineNodes = Array.isArray(timelineNodes) ? timelineNodes : [];
                const safeAssignments = Array.isArray(assignments) ? assignments : [];
                const safeCompletedTasks = Array.isArray(completedTasks) ? completedTasks : [];

                const reversedNodes = safeTimelineNodes.map((node, index) => ({ node, weekIndex: index + 1 })).reverse();

                const renderTaskItem = (task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth, isFirstLeaf, isLastLeaf, parentRangeGroup) => {
                    let canUpload = true;
                    if (isLateUpload) {
                        if (!allowLateFlag) {
                            canUpload = false;
                        }
                    }
                    
                    const compositeKey = `${course.id}_${task.id}`;
                    const isTaskDone = safeCompletedTasks.includes(compositeKey);
                    const checked = isTaskDone ? 'checked' : '';
                    const recForBoard = (Array.isArray(window._studentTaskCompletions) ? window._studentTaskCompletions : []).find(function (c) {
                        return String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id);
                    });
                    const recordingBoard = (task.type === 'audio_record')
                        ? getRecordingBoard(task, recForBoard && recForBoard.raw_data, parentRangeGroup)
                        : null;
                    
                    let aiFeedbackHtml = '';
                    let statusBadgeHtml = '';
                    
                    let hasValidAudioFile = false; 
                    let retryAudioId = '';
                    let retryAudioUrl = '';
                    let taskStatus = '';
                    let directAudioUrl = '';
                    let submittedFileIds = [];
                    let submittedFileMetas = [];
                    let recordingIncomplete = false;
                    
                    let inlinePlayerId = '';
                    if (course.id) {
                        if (task.id) {
                            inlinePlayerId = `inline-player-${course.id}-${task.id}`;
                        }
                    }

                    if (window._studentTaskCompletions) {
                        if (Array.isArray(window._studentTaskCompletions)) {
                            const compRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id));
                            if (compRecord) {
                                taskStatus = String(compRecord.status ? compRecord.status : '');
                                
                                if (compRecord.raw_data) {
                                    let url1 = compRecord.raw_data.student_audio_url;
                                    let url2 = compRecord.raw_data.audio_url;
                                    retryAudioUrl = String(url1 ? url1 : (url2 ? url2 : ''));
                                    
                                    if (Array.isArray(compRecord.raw_data.drive_file_ids)) {
                                        submittedFileIds = compRecord.raw_data.drive_file_ids.map(String).filter(Boolean);
                                    }
                                    if (Array.isArray(compRecord.raw_data.submitted_files)) {
                                        submittedFileMetas = compRecord.raw_data.submitted_files;
                                    }
                                    // 🔁「取代」用：submitted_files 只有 id/mime/name/unit_key/label，
                                    // 沒有 stem／page／original_script——這幾個欄位只在 audio_segments 裡，
                                    // 取代 AI 分頁時若少了 original_script，覆蓋進去的段會把批改文稿洗成空字串。
                                    // 依 file_id 從 audio_segments 補齊，缺角時保留原本的 submitted_files 內容。
                                    if (Array.isArray(compRecord.raw_data.audio_segments) && compRecord.raw_data.audio_segments.length) {
                                        const segByFileId = {};
                                        compRecord.raw_data.audio_segments.forEach(function (s) {
                                            if (s && s.file_id) segByFileId[String(s.file_id)] = s;
                                        });
                                        submittedFileMetas = submittedFileMetas.map(function (m) {
                                            const seg = m && m.id ? segByFileId[String(m.id)] : null;
                                            if (!seg) return m;
                                            return Object.assign({}, m, {
                                                stem: seg.stem || '',
                                                page: seg.page != null ? seg.page : null,
                                                original_script: seg.original_script || ''
                                            });
                                        });
                                    }

                                    if (!retryAudioUrl) {
                                        if (submittedFileIds.length > 0) {
                                            retryAudioId = String(submittedFileIds[0]);
                                            retryAudioUrl = `https://drive.google.com/file/d/${retryAudioId}/view`;
                                        }
                                    } else if (retryAudioUrl) {
                                        // 只認檔案 ID，禁止把 /folders/ 資料夾 ID 拿來當 audio src（會 0:00/0:00）
                                        let driveIdMatch = retryAudioUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch && !/\/folders\//.test(String(retryAudioUrl))) {
                                            driveIdMatch = retryAudioUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                                        }
                                        if (driveIdMatch) retryAudioId = driveIdMatch[1];
                                    }

                                    if (!submittedFileIds.length && retryAudioId) {
                                        submittedFileIds.push(String(retryAudioId));
                                    } else {
                                        const seenIds = {};
                                        submittedFileIds = submittedFileIds.filter(function (id) {
                                            const k = String(id);
                                            if (!k || seenIds[k]) return false;
                                            seenIds[k] = true;
                                            return true;
                                        });
                                    }
                                    
                                    if (submittedFileIds.length > 0 || retryAudioUrl) {
                                        hasValidAudioFile = true;
                                        if (retryAudioId) {
                                            // 與錄音艙／AI 報告切片同一條：Supabase stream-audio（勿用 GAS Web App 當 audio src）
                                            directAudioUrl = resolveStreamUrl(retryAudioId);
                                        } else if (retryAudioUrl) {
                                            directAudioUrl = retryAudioUrl;
                                        }
                                    }
                                }

                                // 無文稿被誤送 AI 的舊資料：不當成「批改失敗」
                                const skipAiMissingScript = !!(compRecord.raw_data && (
                                    compRecord.raw_data.ai_skip_reason === 'original_script_missing'
                                    || /original_script is missing/i.test(String(compRecord.raw_data.ai_error_log || ''))
                                ));
                                const effectiveTaskStatus = (taskStatus === 'ai_error' || taskStatus === 'failed') && skipAiMissingScript
                                    ? 'submitted'
                                    : taskStatus;

                                let recordingExpected = 0;
                                let recordingSubmitted = 0;
                                if (task.type === 'audio_record' && recordingBoard) {
                                    recordingExpected = recordingBoard.expectedCount;
                                    recordingSubmitted = recordingBoard.submittedCount;
                                    submittedFileIds = recordingBoard.players.map(function (p) { return p.fileId; });
                                    submittedFileMetas = recordingBoard.players.map(function (p) {
                                        return Object.assign({}, p.meta || {}, { id: p.fileId, page: p.page, label: p.label });
                                    });
                                }
                                recordingIncomplete = recordingExpected > 1 && recordingSubmitted < recordingExpected;

                                if (effectiveTaskStatus === 'ai_processing') {
                                    const segProg = getAudioSegmentProgress(compRecord.raw_data);
                                    let processingLabel = '🤖 AI 批改中...';
                                    if (segProg.total > 1) {
                                        processingLabel = '🤖 AI 批改中 ' + segProg.done + '/' + segProg.total;
                                    } else if (segProg.total === 1 && segProg.done === 1) {
                                        processingLabel = '🤖 AI 彙整中...';
                                    }
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#EDE9FE; color:#8B5CF6; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #DDD6FE;">${processingLabel}</span>`;
                                } else if (effectiveTaskStatus === 'ai_ready') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF3C7; color:#D97706; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FDE68A;">🤖 AI 分析完成</span>`;
                                } else if (effectiveTaskStatus === 'graded') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#ECFDF5; color:#10B981; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #A7F3D0;">✅ 已批改</span>`;
                                } else if (recordingIncomplete) {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF3C7; color:#B45309; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FDE68A;">🎙️ 已交 ${recordingSubmitted}/${recordingExpected} 頁</span>`;
                                } else if (effectiveTaskStatus === 'completed') {
                                    // 自我勾選完成 ≠ 老師／AI 批改
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#F1F5F9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #CBD5E1;">✅ 已完成</span>`;
                                } else if (effectiveTaskStatus === 'ai_error' || effectiveTaskStatus === 'failed') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF2F2; color:#EF4444; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FECACA;">⚠️ AI 分析失敗</span>`;
                                }
                                // 'submitted' 不再另外顯示「已繳交」字樣徽章：前面的打勾本身就是這個意思，
                                // 重複標示只會讓畫面更亂；有進一步進度（AI 處理中／已批改等）才需要額外徽章。

                                const hasPartialAiResult = !!(compRecord.raw_data && (
                                    compRecord.raw_data.ai_evaluation
                                    || (Array.isArray(compRecord.raw_data.ai_evaluations) && compRecord.raw_data.ai_evaluations.length > 0)
                                    || (Array.isArray(compRecord.raw_data.audio_segments) && compRecord.raw_data.audio_segments.some(function (s) {
                                        return s && s.status === 'done' && s.ai_evaluation;
                                    }))
                                ));

                                let showAIReport = false;
                                if (effectiveTaskStatus === 'graded') showAIReport = true;
                                else if (effectiveTaskStatus === 'ai_ready') showAIReport = true;
                                else if (effectiveTaskStatus === 'ai_processing' && hasPartialAiResult) showAIReport = true;
                                else if (effectiveTaskStatus === 'completed' && compRecord.raw_data && compRecord.raw_data.ai_evaluation) {
                                    showAIReport = true;
                                }

                                const segmentProgressStripHtml = (effectiveTaskStatus === 'ai_processing')
                                    ? buildSegmentProgressStripHtml(compRecord.raw_data)
                                    : '';

                                let scoreDisclaimer = '';
                                if (window.GradingPolicy && window.GradingPolicy.studentScoreDisclaimer) {
                                    scoreDisclaimer = window.GradingPolicy.studentScoreDisclaimer(classGradingPolicy, compRecord.raw_data, effectiveTaskStatus);
                                }

                                if (showAIReport) {
                                    if (compRecord.raw_data) {
                                        if (compRecord.raw_data.ai_evaluation) {
                                            const ai = compRecord.raw_data.ai_evaluation;
                                            const scores = getScoresFromAi(ai);
                                            const gradingHistory = Array.isArray(compRecord.raw_data.grading_history) ? compRecord.raw_data.grading_history : [];

                                            // 預設收合：使用者沒手動展開／收合過時，先收起來避免課程進度一次攤開一堆報告；
                                            // 一旦使用者手動切換過（true 或 'false'），就照使用者的選擇走。
                                            const collapsedRaw = localStorage.getItem(`ai_report_collapsed_${compositeKey}`);
                                            const isCollapsed = collapsedRaw === null ? true : collapsedRaw === 'true';
                                            const reportDisplay = isCollapsed ? 'none' : 'block';
                                            const toggleIcon = isCollapsed ? '◀️' : '🔽';

                                            let disclaimerHtml = '';
                                            if (scoreDisclaimer !== '') {
                                                disclaimerHtml = `<span style="font-size:0.75rem; background:#FEF3C7; color:#B45309; padding:2px 8px; border-radius:4px; font-weight:900; border:1px solid #FDE68A;">⚠️ ${scoreDisclaimer}</span>`;
                                            }

                                            const partialProg = getAudioSegmentProgress(compRecord.raw_data);
                                            let partialBadgeHtml = '';
                                            let reportTitle = 'AI 批改報告';
                                            if (effectiveTaskStatus === 'ai_processing' && partialProg.total > 1) {
                                                reportTitle = 'AI 部分結果（' + partialProg.done + '/' + partialProg.total + ' 段）';
                                                partialBadgeHtml = `<span style="font-size:0.72rem;background:#FEF3C7;color:#B45309;padding:1px 6px;border-radius:4px;font-weight:900;">尚在批改其餘段落</span>`;
                                            }

                                            const progressHtml = buildLearningTrackHtml(ai, gradingHistory);
                                            const latestAttemptNum = gradingHistory.length + 1;
                                            const currentAiEvaluations = Array.isArray(compRecord.raw_data.ai_evaluations) ? compRecord.raw_data.ai_evaluations : null;
                                            const historySectionHtml = buildHistoryTableHtml(compositeKey, gradingHistory, ai, inlinePlayerId, retryAudioId, hasValidAudioFile, currentAiEvaluations);

                                            aiFeedbackHtml = `
                                                ${segmentProgressStripHtml}
                                                <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FAF5FF; border-left: 4px solid #8B5CF6; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                                        <div style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;" onclick="window.FeatureStudentTimeline.toggleAIReport('${compositeKey}')">
                                                            <span style="font-size:1.1rem;">🤖</span>
                                                            <span style="font-weight: 900; color: #6D28D9; font-size: 0.95rem;">${reportTitle}</span>
                                                            <span style="font-size:0.72rem;background:#EDE9FE;color:#6D28D9;padding:1px 6px;border-radius:4px;font-weight:900;">第 ${latestAttemptNum} 次</span>
                                                            ${partialBadgeHtml}
                                                            <span id="toggle-icon-${compositeKey}" style="font-size: 0.8rem; margin-left: 4px; color: #8B5CF6;">${toggleIcon}</span>
                                                        </div>
                                                        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                                                            ${disclaimerHtml}
                                                            <span style="background: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 900; color: ${scores.pScoreColor}; border: 1px solid #E2E8F0;">發音: ${scores.pScore}</span>
                                                            <span style="background: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 900; color: #3B82F6; border: 1px solid #E2E8F0;">流暢度: ${scores.fluency}</span>
                                                        </div>
                                                    </div>
                                                    <div id="ai-report-body-${compositeKey}" style="display: ${reportDisplay}; margin-top: 12px;">
                                                        ${progressHtml}
                                                        ${historySectionHtml}
                                                    </div>
                                                </div>
                                            `;
                                        }
                                    }
                                } else if (segmentProgressStripHtml) {
                                    aiFeedbackHtml = segmentProgressStripHtml;
                                }

                                let showAIError = false;
                                if ((effectiveTaskStatus === 'ai_error' || effectiveTaskStatus === 'failed') && !skipAiMissingScript) {
                                    showAIError = true;
                                }

                                if (showAIError) {
                                    let errorLogText = '系統尚未完成此作業的 AI 分析。';
                                    if (compRecord.raw_data) {
                                        if (compRecord.raw_data.ai_error_log) {
                                            errorLogText = String(compRecord.raw_data.ai_error_log);
                                        }
                                    }
                                    
                                    aiFeedbackHtml = `
                                        <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FEF2F2; border-left: 4px solid #EF4444; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                            <div style="font-weight: 900; color: #B91C1C; font-size: 0.95rem; margin-bottom: 8px;">❌ AI 分析發生錯誤</div>
                                            <div style="font-size: 0.85rem; color: #7F1D1D; word-break: break-word; background: #FECACA; padding: 8px; border-radius: 4px;">${errorLogText.replace(/\n/g, '<br>')}</div>
                                        </div>
                                    `;
                                }
                            }
                        }
                    }

                    let iconStr = '📁';
                    if (task.type === 'check') iconStr = '📌';
                    if (task.type === 'link') iconStr = '🔗';
                    if (task.type === 'audio_record') iconStr = '🎙️';
                    if (task.type === 'exam') iconStr = '📝';
                    if (task.type === 'pdf_exam') iconStr = '📄';
                    
                    let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.15rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
                    const safeCourseId = escapeJsSingleQuoted(course.id);
                    const safeTaskId = escapeJsSingleQuoted(task.id);
                    // 打勾本身就代表「已繳交」，勾勾顏色跟底色要有明顯對比才夠醒目
                    const checkboxBaseStyle = 'transform: scale(1.4); margin-right: 8px; margin-top: 2px; accent-color: #059669; outline: 1px solid #CBD5E1; outline-offset: 1px; border-radius: 4px;';
                    let checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor: pointer;" onchange="window.FeatureStudentTimeline.updateProgress('${safeCourseId}', '${safeTaskId}', this.checked)" ${recordingIncomplete ? '' : checked}>`;

                    let btn = '';
                    let taskTitleDisplay = '';
                    let linkContent = '';

                    const formattedTaskUrl = safeFormatUrl ? String(safeFormatUrl(task.url) ? safeFormatUrl(task.url) : '') : '';

                    if (task.type === 'link') {
                        let safeUrlText = task.url_text ? task.url_text : '';
                        let actualUrlText = stripHtml(safeUrlText);
                        let actualTitle = stripHtml(listTitleForPackChild(task, parentRangeGroup) || '');
                        if (!actualTitle && !rangeGroupTitleIsComboNameLocal(parentRangeGroup)) {
                            actualTitle = stripHtml(task.title ? task.title : '');
                        }

                        if (actualUrlText !== '') {
                            let displayTitle = actualTitle ? actualTitle : '未命名任務';
                            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;
                            linkContent = formattedTaskUrl
                                ? taskLink(actualUrlText, formattedTaskUrl, 'ghost', '', ` onclick="window.FeatureStudentTimeline.updateProgress('${safeCourseId}', '${safeTaskId}', true)"`)
                                : '';
                        } else {
                            let fallbackText = actualTitle ? actualTitle : '未命名連結';
                            if (formattedTaskUrl) {
                                taskTitleDisplay = `<a href="${escapeAttr(formattedTaskUrl)}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;" onclick="window.FeatureStudentTimeline.updateProgress('${safeCourseId}', '${safeTaskId}', true)">${escapeAttr(fallbackText)}</a>`;
                            } else {
                                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(fallbackText)} (無網址)</span>`;
                            }
                        }
                    } else if (task.type === 'audio_record') {
                        
                        let studioScript = '';
                        let originalScript = '';
                        let materialUrl = '';
                        let materialRange = '';
                        if (task.raw_data) {
                            if (task.raw_data.original_script) originalScript = String(task.raw_data.original_script);
                            if (task.raw_data.student_display_text) studioScript = String(task.raw_data.student_display_text);
                            else if (task.raw_data.student_display) studioScript = String(task.raw_data.student_display);
                            else if (task.raw_data.student_text) studioScript = String(task.raw_data.student_text);
                            else studioScript = originalScript;
                            if (task.raw_data.material_url) materialUrl = String(task.raw_data.material_url);
                            if (task.raw_data.material_range) materialRange = String(task.raw_data.material_range);
                        }

                        let displayTitle = stripHtml(listTitleForPackChild(task, parentRangeGroup) || '').trim();
                        const omitParent = rangeGroupTitleIsComboNameLocal(parentRangeGroup);
                        const bookNameNow = bookComboNameFromRangeGroup(parentRangeGroup);
                        if (!displayTitle && !omitParent) {
                            if (materialRange && !bookNameNow) displayTitle = String(materialRange).trim();
                            if (!displayTitle && bookNameNow) displayTitle = bookNameNow;
                            if (!displayTitle) displayTitle = '語音錄製任務';
                        }
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; vertical-align:middle;">${escapeAttr(displayTitle)}</span>`;

                        const captureStudio = !(task.raw_data && task.raw_data.capture_studio === false);
                        const captureUpload = !(task.raw_data && task.raw_data.capture_upload === false);

                        if (!canUpload) {
                            // 🌟 這裡刻意不用 disabled：瀏覽器對 disabled checkbox 的 accent-color 會自動變淡，
                    // 導致跟上面「可點擊」的打勾長得不一樣（一個鮮綠、一個灰撲撲）。
                    // 改用 onclick 擋掉互動＋拿掉 tab 焦點，視覺上維持跟其他勾勾一致的鮮綠色。
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1">`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⛔ 已逾期，停止收件</div>`;
                        } else if (!studentDriveUrl) {
                            // 🌟 這裡刻意不用 disabled：瀏覽器對 disabled checkbox 的 accent-color 會自動變淡，
                    // 導致跟上面「可點擊」的打勾長得不一樣（一個鮮綠、一個灰撲撲）。
                    // 改用 onclick 擋掉互動＋拿掉 tab 焦點，視覺上維持跟其他勾勾一致的鮮綠色。
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1">`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⚠️ 您的專屬資料夾尚未設定</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1" title="上傳成功後將自動打勾">`;
                            
                            const statusId = `upload-status-${course.id}-${task.id}`;

                            if (recordingBoard && recordingBoard.players.length) hasValidAudioFile = true;
                            const studioPageCount = recordingBoard ? recordingBoard.expectedCount : 0;
                            const submittedPageCount = recordingBoard ? recordingBoard.submittedCount : 0;
                            const studioPartial = studioPageCount > 1 && submittedPageCount > 0 && submittedPageCount < studioPageCount;
                            const bookAudioUnits = recordingUnitsFromBook(task, parentRangeGroup);
                            const unitWord = (bookAudioUnits && bookAudioUnits.length) ? '段' : '頁';
                            if (studioPartial) {
                                statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF3C7; color:#B45309; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FDE68A;">🎙️ 已交 ${submittedPageCount}/${studioPageCount} ${unitWord}</span>`;
                                checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" onclick="return false;" tabindex="-1" title="還沒交齊所有${unitWord}，不會打勾">`;
                            }
                            const recordBtnText = studioPartial
                                ? ('🎙️ 繼續錄音（' + submittedPageCount + '/' + studioPageCount + '）')
                                : (hasValidAudioFile ? '重新錄製' : '🎙️ 開啟錄音艙');

                            const audioUploadId = `audio-upload-input-${course.id}-${task.id}`;

                            let audioPlayerHtml = '';

                            if (hasValidAudioFile) {
                                const playerIds = (recordingBoard && recordingBoard.players.length)
                                    ? recordingBoard.players.map(function (p) { return p.fileId; })
                                    : submittedFileIds;
                                const playerMetas = (recordingBoard && recordingBoard.players.length)
                                    ? recordingBoard.players.map(function (p) {
                                        return Object.assign({}, p.meta || {}, { id: p.fileId, page: p.page, label: p.label });
                                    })
                                    : submittedFileMetas;
                                audioPlayerHtml = buildSubmittedFilesHtml(
                                    playerIds,
                                    retryAudioUrl,
                                    inlinePlayerId,
                                    playerMetas,
                                    course.id,
                                    task.id,
                                    statusId,
                                    null,
                                    materialRange
                                );
                            }

                            const openFileBtnHtml = (hasValidAudioFile && retryAudioId)
                                ? ''
                                : taskBtn('📁 Drive', 'window.FeatureStudentTimeline.openDriveAndCheck()', 'ghost');

                            const studioBtnHtml = captureStudio
                                ? taskBtn(recordBtnText, `window.FeatureStudentTimeline.openAudioStudio('${safeCourseId}', '${safeTaskId}')`, (hasValidAudioFile && !studioPartial) ? 'ghost' : 'solid')
                                : '';
                            const uploadBtnHtml = captureUpload
                                ? `<input type="file" id="${audioUploadId}" multiple accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.webm,.flac,.amr,.3gp,.wma,.mp4" style="display:none;" onchange="window.FeatureStudentTimeline.handleAudioFileUpload(this, '${safeCourseId}', '${safeTaskId}', '${statusId}')">`
                                    + taskBtn('📤 上傳音檔（可複選）', `document.getElementById('${audioUploadId}').click()`, 'solid', '可複選多檔；請依頁面順序點選')
                                : '';

                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${audioPlayerHtml}
                                    ${studioBtnHtml}
                                    ${uploadBtnHtml}
                                    ${openFileBtnHtml}
                                    <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                                </div>
                            `;
                        }
                    } else if (task.type === 'exam') {
                        let displayTitle = stripHtml(listTitleForPackChild(task, parentRangeGroup) || '').trim();
                        if (!displayTitle && !rangeGroupTitleIsComboNameLocal(parentRangeGroup)) displayTitle = '線上考試';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;
                        const paper = task.raw_data && task.raw_data.quiz_paper;
                        const itemN = paper && Array.isArray(paper.items) ? paper.items.length : 0;
                        let quizScoreHtml = '';
                        const quizComp = (window._studentTaskCompletions || []).find(function (c) {
                            return String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id);
                        });
                        const quizRaw = (quizComp && quizComp.raw_data) ? quizComp.raw_data : null;
                        if (quizRaw && (quizRaw.quiz_result || quizRaw.quiz_stats)) {
                            if (window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.formatStatsSummaryHtml === 'function') {
                                const summary = window.FeatureStudentQuiz.formatStatsSummaryHtml(quizRaw);
                                if (summary) {
                                    quizScoreHtml = `<div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:6px 10px; max-width:360px;">${summary}</div>`;
                                }
                            } else if (quizRaw.quiz_result) {
                                const qr = quizRaw.quiz_result;
                                quizScoreHtml = `<span style="font-size:0.8rem; font-weight:800; color:#047857; background:#ECFDF5; border:1px solid #A7F3D0; padding:2px 8px; border-radius:6px;">${escapeAttr(qr.correct)}/${escapeAttr(qr.total)}（${escapeAttr(qr.score)}%）</span>`;
                            }
                        }
                        // ✍️ 輸入練習：老師勾選後，整份考卷變成打字練習（答案直接顯示，逐字打對指定次數
                        // 才算完成），沒有另外的「一般作答」步驟，所以要整個取代下面一般考試按鈕，不是並存。
                        const inputPracticeEnabled = !!(task.raw_data && task.raw_data.input_practice_enabled);
                        if (!itemN) {
                            btn = `<div style="color:#92400E; font-size:0.85rem; font-weight:800; background:#FFFBEB; padding:4px 10px; border-radius:6px; border:1px solid #FDE68A;">老師尚未產生線上卷</div>`;
                        } else if (inputPracticeEnabled) {
                            const practiceSummary = (window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.getInputPracticeSummary === 'function')
                                ? window.FeatureStudentQuiz.getInputPracticeSummary(course.id, task.id)
                                : null;
                            const pTotal = practiceSummary ? practiceSummary.total : itemN;
                            const pDone = practiceSummary ? practiceSummary.done : 0;
                            const pAllDone = !!(practiceSummary && practiceSummary.allDone);
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${pAllDone ? 'checked' : ''} onclick="return false;" tabindex="-1" title="完成所有題目的輸入練習後自動打勾">`;
                            const practiceBtnLabel = pAllDone ? '已完成・重新練習' : (pDone > 0 ? '繼續輸入練習' : '開始輸入練習');
                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${taskBtn(practiceBtnLabel, `window.FeatureStudentQuiz && window.FeatureStudentQuiz.openInputPractice('${safeCourseId}', '${safeTaskId}')`, pAllDone ? 'done' : 'solid')}
                                    <span style="font-size:0.75rem; color:#64748B; font-weight:700;">${pDone}/${pTotal} 題已完成</span>
                                </div>
                            `;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1" title="繳交考卷後自動打勾">`;
                            const hasQuizDone = !!(quizRaw && (quizRaw.quiz_result || (quizRaw.quiz_stats && quizRaw.quiz_stats.complete_count)));
                            const quizBtnLabel = hasQuizDone ? '再作一次' : '開始作答';
                            const reviewBtn = hasQuizDone
                                ? taskBtn('作答結果', `window.FeatureStudentQuiz && window.FeatureStudentQuiz.openReviewFromRaw('${safeCourseId}', '${safeTaskId}')`, 'ghost')
                                : '';
                            // 🔁 重考錯題（僅一次）：老師勾選 allow_wrong_retake 才會有這個按鈕；持久顯示在時間軸，
                            // 讓學生繳交後不一定要當下重考，之後回來也看得到入口。done 後改顯示「整體報告」。
                            const retake = quizRaw && quizRaw.quiz_retake;
                            const retakeEligible = !!(retake && !retake.done && Array.isArray(retake.item_ids) && retake.item_ids.length);
                            const retakeDone = !!(retake && retake.done);
                            const retakeBtn = retakeEligible
                                ? taskBtn('重考錯題（僅一次）', `window.FeatureStudentQuiz && window.FeatureStudentQuiz.openRetakeQuiz('${safeCourseId}', '${safeTaskId}')`, 'ghost')
                                : (retakeDone
                                    ? taskBtn('整體報告', `window.FeatureStudentQuiz && window.FeatureStudentQuiz.openRetakeReportFromRaw('${safeCourseId}', '${safeTaskId}')`, 'ghost')
                                    : '');
                            // 🔧 輸入改正（獨立於重考錯題／申訴答案）：有錯題才顯示；完成後顯示已完成狀態。
                            const correctionSummary = (hasQuizDone && window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.getInputCorrectionSummary === 'function')
                                ? window.FeatureStudentQuiz.getInputCorrectionSummary(course.id, task.id)
                                : null;
                            const correctionBtn = (correctionSummary && correctionSummary.total > 0)
                                ? taskBtn(
                                    correctionSummary.allDone ? '改正練習已完成' : (`錯題改正練習 (${correctionSummary.done}/${correctionSummary.total})`),
                                    `window.FeatureStudentQuiz && window.FeatureStudentQuiz.openInputCorrection('${safeCourseId}', '${safeTaskId}')`,
                                    correctionSummary.allDone ? 'done' : 'ghost'
                                )
                                : '';
                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${quizScoreHtml}
                                    ${taskBtn(quizBtnLabel, `window.FeatureStudentQuiz && window.FeatureStudentQuiz.openQuiz ? window.FeatureStudentQuiz.openQuiz('${safeCourseId}', '${safeTaskId}') : (window.showFlash && window.showFlash('考卷模組尚未載入，請重整頁面','error'))`, 'solid')}
                                    ${reviewBtn}
                                    ${retakeBtn}
                                    ${correctionBtn}
                                    <span style="font-size:0.75rem; color:#64748B; font-weight:700;">${itemN} 題</span>
                                </div>
                            `;
                        }
                    } else if (task.type === 'pdf_exam') {
                        // 🆕 PDF 考卷：獨立於上面的 exam（meta 出題）分支，直接用 pdf_exam_job.parsed_bank 判斷是否已設定完成
                        // （改版後老師端不再畫框，作答位置由學生自己點，見 feature-student-pdf-quiz.js）
                        let displayTitle = stripHtml(listTitleForPackChild(task, parentRangeGroup) || '').trim();
                        if (!displayTitle && !rangeGroupTitleIsComboNameLocal(parentRangeGroup)) displayTitle = 'PDF 考卷';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;
                        const pdfJob = task.raw_data && task.raw_data.pdf_exam_job;
                        const pdfItemN = (pdfJob && Array.isArray(pdfJob.parsed_bank)) ? pdfJob.parsed_bank.filter(it => it.key).length : 0;
                        const pdfComp = (window._studentTaskCompletions || []).find(function (c) {
                            return String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id);
                        });
                        const pdfResult = (pdfComp && pdfComp.raw_data) ? pdfComp.raw_data.pdf_quiz_result : null;
                        if (!pdfJob || !pdfJob.pdf_file_id || !pdfItemN) {
                            checkboxHtml = '';
                            btn = `<div style="color:#92400E; font-size:0.85rem; font-weight:800; background:#FFFBEB; padding:4px 10px; border-radius:6px; border:1px solid #FDE68A;">老師尚未設定完成</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1" title="繳交考卷後自動打勾">`;
                            // 學生端改成「每大題提交就批改」，pdfResult.all_submitted===false 代表還在作答中
                            // （只批改了部分大題），跟整份都交完要分開顯示，避免看起來像已經考完。
                            const pdfInProgress = !!(pdfResult && pdfResult.all_submitted === false);
                            const pdfScoreHtml = pdfResult
                                ? (pdfInProgress
                                    ? `<span style="font-size:0.8rem; font-weight:800; color:#B45309; background:#FFFBEB; border:1px solid #FDE68A; padding:2px 8px; border-radius:6px;">作答中 ${escapeAttr(pdfResult.submitted_sections)}/${escapeAttr(pdfResult.total_sections)} 大題</span>`
                                    : `<span style="font-size:0.8rem; font-weight:800; color:#047857; background:#ECFDF5; border:1px solid #A7F3D0; padding:2px 8px; border-radius:6px;">${escapeAttr(pdfResult.correct)}/${escapeAttr(pdfResult.total)}（${escapeAttr(pdfResult.score)}%）</span>`)
                                : '';
                            const pdfBtnLabel = pdfInProgress ? '繼續作答' : (pdfResult ? '再作一次' : '開始作答');
                            const pdfReviewBtn = (pdfResult && !pdfInProgress)
                                ? taskBtn('上次成績', `window.FeatureStudentPdfQuiz && window.FeatureStudentPdfQuiz.openPastResult('${safeCourseId}', '${safeTaskId}')`, 'ghost')
                                : '';
                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${pdfScoreHtml}
                                    ${taskBtn(pdfBtnLabel, `window.FeatureStudentPdfQuiz && window.FeatureStudentPdfQuiz.openQuiz ? window.FeatureStudentPdfQuiz.openQuiz('${safeCourseId}', '${safeTaskId}') : (window.showFlash && window.showFlash('考卷模組尚未載入，請重整頁面','error'))`, 'solid')}
                                    ${pdfReviewBtn}
                                    <span style="font-size:0.75rem; color:#64748B; font-weight:700;">${pdfItemN} 題</span>
                                </div>
                            `;
                        }
                    } else if (task.type === 'drive') {
                        let displayTitle = stripHtml(listTitleForPackChild(task, parentRangeGroup) || '').trim();
                        if (!displayTitle && !rangeGroupTitleIsComboNameLocal(parentRangeGroup)) displayTitle = '未命名任務';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;

                        if (!canUpload) {
                            // 🌟 這裡刻意不用 disabled：瀏覽器對 disabled checkbox 的 accent-color 會自動變淡，
                    // 導致跟上面「可點擊」的打勾長得不一樣（一個鮮綠、一個灰撲撲）。
                    // 改用 onclick 擋掉互動＋拿掉 tab 焦點，視覺上維持跟其他勾勾一致的鮮綠色。
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1">`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⛔ 已逾期，停止收件</div>`;
                        } else if (!studentDriveUrl) {
                            // 🌟 這裡刻意不用 disabled：瀏覽器對 disabled checkbox 的 accent-color 會自動變淡，
                    // 導致跟上面「可點擊」的打勾長得不一樣（一個鮮綠、一個灰撲撲）。
                    // 改用 onclick 擋掉互動＋拿掉 tab 焦點，視覺上維持跟其他勾勾一致的鮮綠色。
                    checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1">`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⚠️ 您的專屬資料夾尚未設定</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="${checkboxBaseStyle} cursor:not-allowed;" ${checked} onclick="return false;" tabindex="-1" title="上傳成功後將自動打勾">`;
                            
                            const pureTaskTitle = displayTitle || '未命名任務';
                            const safeTitleForJS = escapeJsSingleQuoted(pureTaskTitle);
                            
                            let safeNodeTitleStr = node.title ? node.title : '';
                            const safeNodeTitle = escapeJsSingleQuoted(String(safeNodeTitleStr).replace(/[\/\\:*?"<>\x7C]/g, '_'));

                            const uniqueId = `file-input-${course.id}-${task.id}`;
                            const statusId = `upload-status-${course.id}-${task.id}`;

                            const drivePreviewHtml = hasValidAudioFile
                                ? buildSubmittedFilesHtml(submittedFileIds, retryAudioUrl, inlinePlayerId, submittedFileMetas, course.id, task.id, statusId)
                                : '';
                            // 🌟 依老師要求拿掉「📂 繳交檔」按鈕，理由同錄音任務：已有檔案時不需要重複入口。
                            const driveOpenBtnHtml = (hasValidAudioFile && (retryAudioId || submittedFileIds[0]))
                                ? ''
                                : taskBtn('📁 Drive', 'window.FeatureStudentTimeline.openDriveAndCheck()', 'ghost');

                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${drivePreviewHtml}
                                    <input type="file" id="${uniqueId}" multiple style="display:none;" onchange="window.FeatureStudentTimeline.handleFileSelect(this, '${safeCourseId}', '${safeTaskId}', '${safeTitleForJS}', '${statusId}', '${safeNodeTitle}',${isLateUpload})">
                                    ${taskBtn('📤 上傳檔案', `document.getElementById('${uniqueId}').click()`, 'solid')}
                                    ${driveOpenBtnHtml}
                                    <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                                </div>
                            `;
                        }
                    } else {
                        let displayTitle = stripHtml(listTitleForPackChild(task, parentRangeGroup) || '').trim();
                        if (!displayTitle && !rangeGroupTitleIsComboNameLocal(parentRangeGroup)) displayTitle = '未命名任務';
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;
                    }

                    let descHtml = '';
                    if (task.type === 'audio_record') {
                        descHtml = listDescForBookAudio(task, parentRangeGroup) || '';
                    } else if (task.description) {
                        descHtml = String(task.description);
                    }
                    let cleanTaskDesc = descHtml ? String(descHtml).replace(/<[^>]*>?/gm, '').trim() : '';
                    if (task.type === 'audio_record' && cleanTaskDesc) {
                        const kept = String(descHtml).split(/\n/).filter(function (line) {
                            return !/每一頁請錄成一支音檔|本作業共|依「?頁面順序」?點選|可複選多檔|請上傳\s*\d+\s*檔/.test(line);
                        }).join('\n').trim();
                        descHtml = kept;
                        cleanTaskDesc = kept.replace(/<[^>]*>?/gm, '').trim();
                    }
                    
                    let finalDescText = descHtml;
                    let recordingUnitHintHtml = '';
                    if (task.type === 'audio_record') {
                        const bookAudioUnits = recordingUnitsFromBook(task, parentRangeGroup);
                        const isBookAudio = !!(bookAudioUnits && bookAudioUnits.length);
                        const unitCount = countRecordingUnits(task, parentRangeGroup);
                        const unitWord = isBookAudio ? '段' : '頁';
                        const uploadLine = unitCount > 0
                            ? `繳交時，可複選多檔一次上傳（本作業共 <strong>${unitCount}</strong> ${unitWord} → 請上傳 <strong>${unitCount}</strong> 檔）`
                            : '繳交時，可複選多檔一次上傳';
                        const cabinLine = isBookAudio
                            ? '🎙️ 錄音艙可一段一段錄：繳交這一段後，接著錄下一段（也可從選單改段／重錄已繳段）'
                            : '🎙️ 錄音艙可一頁一頁錄：繳交這一頁後，接著錄下一頁（也可從選單改頁／重錄已繳頁）';
                        const fileHint = isBookAudio
                            ? '📎 檔名含頁碼（如 p.407）會自動對到該段；沒有頁碼才依選取順序對剩下的段'
                            : '📎 檔名含頁碼（如 p.2、第2頁）會自動對到該頁；沒有頁碼才依選取順序對剩下的頁';
                        recordingUnitHintHtml = `
                            <ul class="rt-normalize" style="margin:6px 0 0; padding-left:34px; font-size:0.78rem; color:#64748B; line-height:1.65; list-style:none;">
                                <li>${cabinLine}</li>
                                <li>📤 ${uploadLine}</li>
                                <li>${fileHint}</li>
                            </ul>`;
                    }

                    let taskDescHtml = '';
                    if (finalDescText !== '' && cleanTaskDesc !== '') {
                        taskDescHtml = `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px; white-space:pre-line;">${finalDescText}</div>`;
                    }
                    taskDescHtml += recordingUnitHintHtml;
                    
                    let showTaskDue = false;
                    if (task.due_date) {
                        if (task.due_date !== effectiveBlockDueDate) showTaskDue = true;
                    }
                    let localDueHtml = showTaskDue ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 6px; border-radius:4px;">⏰ 期限: ${DateUtils && DateUtils.formatStampLabel ? DateUtils.formatStampLabel(task.due_date) : task.due_date}</span>` : '';

                    let borderBottom = isLastLeaf ? 'none' : '1px solid rgba(0,0,0,0.08)';

                    return `
                        <div style="padding:10px 5px; background:transparent; border-bottom:${borderBottom}; transition: 0.2s;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; line-height: 1.2;">
                                    ${checkboxHtml}${iconHtml}${taskTitleDisplay}${statusBadgeHtml}${localDueHtml}${linkContent}
                                </div>
                                ${btn}
                            </div>
                            ${taskDescHtml}${aiFeedbackHtml}
                        </div>
                    `;
                };

                reversedNodes.forEach(({ node, weekIndex }) => {
                    if (!node) return;
                    if (!Array.isArray(node.dates)) return;
                    if (node.dates.length === 0) return;
                    
                    const nodeWeekStart = DateUtils ? DateUtils.getWeekStartStr(node.dates[0], weekStartSetting) : '';
                    
                    let badge = '';
                    let borderColor = '#E2E8F0';
                    let dotColor = '#E2E8F0';
                    let bgColor = '#FFFFFF';
                    let headerTextColor = '#475569';
                    let isCurrentWeek = false;
                    let isFutureWeek = false;
                    
                    if (nodeWeekStart === currentWeekStart) {
                        badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
                        borderColor = '#10B981';
                        dotColor = '#10B981';
                        bgColor = '#ECFDF5'; 
                        headerTextColor = '#065F46';
                        isCurrentWeek = true;
                    } else if (nodeWeekStart > currentWeekStart) {
                        isFutureWeek = true;
                    } else {
                        dotColor = '#CBD5E1';
                        bgColor = '#F8FAFC'; 
                        headerTextColor = '#94A3B8';
                    }

                    const coursesInDate = safeAssignments.filter(a => {
                        if (!a) return false;
                        if (!a.target_date) return false;
                        if (!DateUtils) return false;
                        return node.dates.includes(DateUtils.normalizeDateString(a.target_date));
                    });
                    
                    if (isFutureWeek && coursesInDate.length === 0) return; 

                    let totalTasksInDate = 0;
                    let doneTasksInDate = 0;
                    let coursesHtml = '';

                    if (coursesInDate.length > 0) {
                        coursesHtml = coursesInDate.map(course => {
                            let effectiveBlockDueDate = course.due_date;
                            if (!effectiveBlockDueDate && Array.isArray(course.tasks) && course.tasks.length > 0) {
                                const explicitDates = course.tasks.map(t => t.due_date).filter(d => d);
                                if (explicitDates.length === course.tasks.length && explicitDates.every(d => d === explicitDates[0])) {
                                    effectiveBlockDueDate = explicitDates[0];
                                }
                            }
                            
                            let aRaw = course.raw_data ? course.raw_data : {};
                            if (typeof aRaw === 'string') {
                                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
                            }
                            let blockLatePolicy = { mode: 'no_late', penalty: 0, grace: 0 };
                            let allowLateFlag = false;
                            if (aRaw.late_policy && typeof aRaw.late_policy === 'object'
                                && DateUtils && typeof DateUtils.latePolicyFromAssignmentRaw === 'function') {
                                blockLatePolicy = DateUtils.latePolicyFromAssignmentRaw(aRaw);
                                allowLateFlag = DateUtils.allowLateFromPolicy
                                    ? DateUtils.allowLateFromPolicy(blockLatePolicy)
                                    : aRaw.late_policy.allow_late === true;
                            } else if (aRaw.allow_late === true) {
                                blockLatePolicy = { mode: 'infinite', penalty: 0, grace: 0 };
                                allowLateFlag = true;
                            }
                            
                            let isLateUpload = false;
                            if (effectiveBlockDueDate && DateUtils) {
                                isLateUpload = DateUtils.isPastDue(effectiveBlockDueDate);
                            }

                            const countTasksRecursive = (tasksList, parentOpenAt) => {
                                if (!Array.isArray(tasksList)) return;
                                tasksList.forEach(t => {
                                    if (!t) return;
                                    const effOpen = DateUtils && DateUtils.inheritStamp
                                        ? DateUtils.inheritStamp(t.open_at, parentOpenAt)
                                        : (t.open_at || parentOpenAt);
                                    if (DateUtils && DateUtils.isOpenYet && !DateUtils.isOpenYet(effOpen)) return;
                                    if (t.type === 'group') {
                                        countTasksRecursive(t.subTasks, effOpen);
                                    } else {
                                        totalTasksInDate += 1;
                                        if (safeCompletedTasks.includes(`${course.id}_${t.id}`)) {
                                            doneTasksInDate += 1;
                                        }
                                    }
                                });
                            };
                            if (course.tasks) countTasksRecursive(course.tasks, course.open_at);

                            let cleanBlockDesc = course.description ? String(course.description).replace(/<[^>]*>?/gm, '').trim() : '';
                            let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.95rem; color:#64748B; margin-top:8px;">${course.description}</div>` : '';
                            
                            let lateBadgeText = (isLateUpload && allowLateFlag) ? ' (接受遲交)' : '';
                            let dueHtml = effectiveBlockDueDate ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 8px; border-radius:4px; margin-left:10px;">⏰ 期限: ${DateUtils && DateUtils.formatStampLabel ? DateUtils.formatStampLabel(effectiveBlockDueDate) : effectiveBlockDueDate}${lateBadgeText}</span>` : '';

                            const renderTaskTree = (tasksList, depth, parentOpenAt, parentLatePolicy, parentRangeGroup) => {
                                if (!Array.isArray(tasksList)) return '';
                                if (tasksList.length === 0) return '';
                                const parentLate = parentLatePolicy || blockLatePolicy;
                                
                                return tasksList.map((task, idx) => {
                                    if (!task) return '';
                                    const effOpen = DateUtils && DateUtils.inheritStamp
                                        ? DateUtils.inheritStamp(task.open_at, parentOpenAt)
                                        : (task.open_at || parentOpenAt);
                                    if (DateUtils && DateUtils.isOpenYet && !DateUtils.isOpenYet(effOpen)) return '';
                                    const lvl = getLevelStyle(depth);
                                    const taskLate = (DateUtils && typeof DateUtils.inheritLatePolicy === 'function')
                                        ? DateUtils.inheritLatePolicy(task, parentLate)
                                        : parentLate;
                                    const taskAllowLate = (DateUtils && typeof DateUtils.allowLateFromPolicy === 'function')
                                        ? DateUtils.allowLateFromPolicy(taskLate)
                                        : allowLateFlag;
                                    
                                    let isFirstLeaf = (idx === 0);
                                    if (!isFirstLeaf && tasksList[idx - 1] && tasksList[idx - 1].type === 'group') isFirstLeaf = true;
                                    
                                    let isLastLeaf = (idx === tasksList.length - 1);
                                    if (!isLastLeaf && tasksList[idx + 1] && tasksList[idx + 1].type === 'group') isLastLeaf = true;
                                    
                                    if (task.type === 'group') {
                                        const isRangeGroup = groupIsRangePack(task);
                                        let groupTitle = String(task.title ? task.title : '');
                                        if (isRangeGroup && !groupTitle.replace(/<[^>]*>?/gm, '').trim()
                                            && window.BuilderStore && typeof window.BuilderStore.deriveRangeTitleFromGroup === 'function') {
                                            groupTitle = window.BuilderStore.deriveRangeTitleFromGroup(task) || '';
                                        }
                                        if (!groupTitle) groupTitle = isRangeGroup ? '未命名範圍' : '未命名作業群組';
                                        let subTasksHtml = '';
                                        
                                        if (Array.isArray(task.subTasks) && task.subTasks.length > 0) {
                                            subTasksHtml = `<div style="display:flex; flex-direction:column;">` +
                                                renderTaskTree(task.subTasks, depth + 1, effOpen, taskLate, isRangeGroup ? task : parentRangeGroup) +
                                                `</div>`;
                                        } else {
                                            subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此作業群組尚無內容)</div>`;
                                        }

                                        const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';
                                        const groupIcon = isRangeGroup ? '📐' : '🗂️';

                                        return `
                                            <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background:${lvl.bg}; border: 1px solid #E2E8F0; border-radius: 8px;">
                                                <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; display:flex; align-items:center; gap:8px; margin-bottom: 8px; flex-wrap:wrap;">
                                                    <span style="font-size:1.2rem;">${groupIcon}</span> <span class="rt-normalize">${groupTitle}</span>
                                                </div>
                                                ${subTasksHtml}
                                            </div>
                                        `;
                                    } else {
                                        return renderTaskItem(task, course, effectiveBlockDueDate, isLateUpload, taskAllowLate, node, depth, isFirstLeaf, isLastLeaf, parentRangeGroup);
                                    }
                                }).join('');
                            };

                            let tasksHtml = '';
                            if (Array.isArray(course.tasks) && course.tasks.length > 0) {
                                tasksHtml = renderTaskTree(course.tasks, 0, course.open_at, blockLatePolicy);
                            }
                            
                            let safeCourseTitle = course.title ? course.title : '';

                            return `
                                <div id="assign-block-${course.id}" data-assignment-id="${course.id}" class="student-assign-block" style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s; scroll-margin-top: 80px;">
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                                        <div style="flex: 1; min-width:200px; display:flex; justify-content:space-between; align-items:center;">
                                            <div style="font-weight: 900; color: #334155; font-size: 1rem; display:flex; align-items:center; flex-wrap:wrap;">
                                                📝 <span class="rt-normalize">${String(safeCourseTitle)}</span>
                                            </div>
                                            <div>${dueHtml}</div>
                                        </div>
                                    </div>
                                    ${blockDescHtml}
                                    ${tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : ''}
                                </div>
                            `;
                        }).join('');
                    }

                    let progressBadgeHtml = '';
                    if (totalTasksInDate > 0) {
                        let isAllDone = (totalTasksInDate === doneTasksInDate);
                        let badgeBg = isAllDone ? '#ECFDF5' : '#FFF7ED';
                        let badgeColor = isAllDone ? '#059669' : '#EA580C';
                        let badgeBorder = isAllDone ? '#D1FAE5' : '#FFEDD5';
                        progressBadgeHtml = `
                            <div style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeBorder}; padding:4px 10px; border-radius:20px; font-size:0.85rem; font-weight:800;">
                                完成進度 ${doneTasksInDate} / ${totalTasksInDate}
                            </div>
                        `;
                    }
                    
                    let safeNodeTitleStr = node.title ? node.title : '';

                    html += `
                        <div id="timeline-node-${weekIndex}" class="timeline-node" data-is-current="${isCurrentWeek}" style="scroll-margin-top: 25px; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative;">
                            <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                                <div class="node-date" style="display:flex; align-items:center; position:relative;">
                                    <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                                    <span style="font-weight: 800; color: ${headerTextColor}; font-size:1.05rem;">📅 第 ${weekIndex} ${mode === 'weekly' ? '週' : '堂'} - ${String(safeNodeTitleStr)}</span> ${badge}
                                </div>
                                ${progressBadgeHtml}
                            </div>
                            ${coursesHtml}
                        </div>
                    `;
                });

                return html;
            } catch (error) {
                console.error("🚨 學生時間軸渲染層發生致命錯誤:", error);
                return `
                    <div style="padding:20px; margin:20px; background:#FEF2F2; border:2px solid #EF4444; border-radius:8px; font-family:sans-serif;">
                        <h3 style="color:#991B1B; margin-top:0;">🚨 渲染引擎發生崩潰 (Runtime Error)</h3>
                        <p style="color:#7F1D1D; font-size:0.9rem;">系統已攔截到死當點，請將以下紅色文字截圖給工程師修復，不用重整網頁了！</p>
                        <div style="background:#FECACA; padding:10px; border-radius:4px; font-family:monospace; font-size:0.85rem; color:#EF4444; font-weight:bold; overflow-x:auto;">
                            錯誤訊息：${error.message}
                        </div>
                        <pre style="margin-top:10px; font-size:0.75rem; color:#7F1D1D; overflow-x:auto;">${error.stack}</pre>
                    </div>
                `;
            }
        }
    };
})();
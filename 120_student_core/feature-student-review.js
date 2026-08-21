/**
 * 📂 120_student_core/feature-student-review.js
 * 學生端「複習專區」：四步精靈選教材／活頁／範圍／題數，再進練習或測試。
 * 只在 switchView('review') 才 render（page-refresh-perf）。
 * 不出卷、不打 GAS；目錄與抽題走 RPC。
 */
window.FeatureStudentReview = (function () {
    'use strict';

    let wizard = defaultWizard();
    let lastCatalog = null;
    let availTimer = null;

    function defaultWizard() {
        return {
            folder: '',
            sheets: [],
            pageStart: '',
            pageEnd: '',
            count: 10,
            mode: '',
            practiceCount: 3,
            available: null,
            counting: false
        };
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDurationMs(ms) {
        const n = Math.max(0, Math.floor(Number(ms) || 0));
        if (!n) return '';
        if (n < 1000) return '不到 1 秒';
        const totalSec = Math.round(n / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return h + ' 小時 ' + m + ' 分';
        if (m > 0) return m + ' 分 ' + s + ' 秒';
        return s + ' 秒';
    }

    function getClassId() {
        const cfg = window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getCurrentClassConfig === 'function'
            ? window.FeatureStudentTimeline.getCurrentClassConfig()
            : null;
        return cfg && (cfg.id || cfg.class_id) ? String(cfg.id || cfg.class_id) : (sessionStorage.getItem('currentClassId') || '');
    }

    function getClassRaw() {
        const cfg = window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.getCurrentClassConfig === 'function'
            ? window.FeatureStudentTimeline.getCurrentClassConfig()
            : null;
        return cfg ? (cfg.raw_data || cfg.rawData || {}) : {};
    }

    function policy() {
        return window.ReviewZone && typeof window.ReviewZone.parsePolicy === 'function'
            ? window.ReviewZone.parsePolicy(getClassRaw())
            : { enabled: false, allow_practice: true, allow_test: true };
    }

    function selectedFolder() {
        const folders = (lastCatalog && lastCatalog.folders) || [];
        const want = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
            ? window.MaterialNameMap.resolveFolderName(wizard.folder) : wizard.folder;
        return folders.find(function (f) {
            const name = String(f.folder_name || '');
            const resolved = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
                ? window.MaterialNameMap.resolveFolderName(name) : name;
            return name === wizard.folder || resolved === want;
        }) || null;
    }

    function selectedSheets() {
        const folder = selectedFolder();
        if (!folder) return [];
        return (folder.sheets || []).filter(function (s) {
            return wizard.sheets.indexOf(String(s.sheet_stem).toUpperCase()) !== -1;
        });
    }

    function renderEmpty(html) {
        const el = document.getElementById('review-container');
        if (el) el.innerHTML = html;
    }

    async function fetchCatalog() {
        const classId = getClassId();
        if (!classId || !window.supabaseClient) return null;
        const { data, error } = await window.supabaseClient.rpc('fetch_review_catalog_for_class', {
            p_class_id: classId
        });
        if (error) throw error;
        return data;
    }

    async function refreshAvailable() {
        const classId = getClassId();
        const folder = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
            ? window.MaterialNameMap.resolveFolderName(wizard.folder) : wizard.folder;
        const stems = wizard.sheets.slice();
        const start = parseInt(wizard.pageStart, 10);
        const end = parseInt(wizard.pageEnd, 10);
        if (!classId || !folder || !stems.length || isNaN(start) || isNaN(end)) {
            wizard.available = null;
            wizard.counting = false;
            paintAvailable();
            return;
        }
        wizard.counting = true;
        paintAvailable();
        try {
            const { data, error } = await window.supabaseClient.rpc('count_review_available', {
                p_class_id: classId,
                p_folder_name: folder,
                p_sheet_stems: stems,
                p_page_start: start,
                p_page_end: end
            });
            if (error) throw error;
            wizard.available = (data == null) ? null : Number(data);
        } catch (_e) {
            wizard.available = null;
        }
        wizard.counting = false;
        paintAvailable();
    }

    function scheduleAvailable() {
        if (availTimer) clearTimeout(availTimer);
        availTimer = setTimeout(function () { refreshAvailable(); }, 280);
    }

    function paintAvailable() {
        const el = document.getElementById('rz-avail-label');
        if (!el) return;
        const sheets = selectedSheets();
        const missingCache = sheets.some(function (s) { return s.available_count == null; });
        if (!wizard.folder || !wizard.sheets.length) {
            el.textContent = '請先選教材';
            el.style.color = '#64748B';
            return;
        }
        if (missingCache) {
            el.textContent = '需老師更新目錄';
            el.style.color = '#B45309';
            return;
        }
        if (wizard.counting) {
            el.textContent = '正在計算可用題…';
            el.style.color = '#64748B';
            return;
        }
        if (wizard.available == null) {
            el.textContent = '請填頁碼範圍後顯示可用題';
            el.style.color = '#D97706';
            return;
        }
        if (wizard.available === 0) {
            el.textContent = '範圍內 0 題';
            el.style.color = '#B91C1C';
            return;
        }
        el.textContent = '可用題 ' + wizard.available;
        el.style.color = '#0F766E';
        const countEl = document.getElementById('rz-count');
        if (countEl && Number(countEl.value) > wizard.available) {
            countEl.value = String(wizard.available);
            wizard.count = wizard.available;
        }
    }

    function renderDisabled() {
        renderEmpty(
            '<div class="card" style="padding:28px;">'
            + '<h3 style="margin:0 0 8px; color:#0F766E;">📖 練習專區</h3>'
            + '<p style="color:#64748B; font-weight:700; line-height:1.6;">老師尚未開放這個班級的練習專區。開放後，你可以在這裡自選教材、頁碼與題數，做練習或測試。</p>'
            + '</div>'
        );
    }

    function renderWizard(catalog) {
        lastCatalog = catalog || lastCatalog;
        const pol = Object.assign(policy(), lastCatalog || {});
        const folders = (lastCatalog && lastCatalog.folders) || [];

        const matMap = (window.ReviewZone && typeof window.ReviewZone.parseMaterials === 'function')
            ? window.ReviewZone.parseMaterials(getClassRaw())
            : {};
        const visibleMetas = [];
        folders.forEach(function (f) {
            (f.sheets || []).forEach(function (s) {
                const entry = window.ReviewZone && typeof window.ReviewZone.materialEntry === 'function'
                    ? window.ReviewZone.materialEntry(matMap, f.folder_name, s.sheet_stem)
                    : { display_name: '', enabled: true };
                if (entry.enabled === false) return;
                const fallback = (window.ReviewZone && typeof window.ReviewZone.sheetLabel === 'function')
                    ? window.ReviewZone.sheetLabel(s.sheet_stem)
                    : s.sheet_stem;
                visibleMetas.push({
                    folder_name: f.folder_name,
                    sheet_stem: String(s.sheet_stem || '').toUpperCase(),
                    display_name: entry.display_name || fallback,
                    page_min: s.page_min,
                    page_max: s.page_max,
                    available_count: s.available_count
                });
            });
        });
        const folderCards = visibleMetas.length
            ? visibleMetas.map(function (m) {
                const on = wizard.folder === m.folder_name && wizard.sheets.indexOf(m.sheet_stem) !== -1;
                const miss = m.available_count == null;
                return '<button type="button" class="btn" data-rz-meta-folder="' + esc(m.folder_name) + '" data-rz-meta-sheet="' + esc(m.sheet_stem) + '" style="padding:10px 14px; border-radius:10px; font-weight:800; '
                    + (on ? 'background:#0F766E; color:white; border:1px solid #0F766E;' : 'background:white; color:#0F766E; border:1px solid #99F6E4;')
                    + '">' + esc(m.display_name) + (miss ? ' · 需更新' : '') + '</button>';
            }).join('')
            : '<span style="color:#B45309; font-weight:700;">還沒有可練習的教材。請老師在練習專區儲存設定。</span>';

        const practiceBtn = pol.allow_practice
            ? '<button type="button" class="btn" id="rz-start-practice" style="background:#0F766E; color:white; border:none; padding:10px 16px; border-radius:8px; font-weight:900;">✍️ 開始練習</button>'
            : '';
        const testBtn = pol.allow_test
            ? '<button type="button" class="btn" id="rz-start-test" style="background:#EA580C; color:white; border:none; padding:10px 16px; border-radius:8px; font-weight:900;">📝 開始測試</button>'
            : '';

        const updated = pol.catalog_updated_at
            ? ('目錄更新：' + String(pol.catalog_updated_at).replace('T', ' ').slice(0, 16))
            : '目錄尚未更新';

        renderEmpty(
            '<div class="card" style="padding:22px;">'
            + '<div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:baseline;">'
            + '<h3 style="margin:0; color:#0F766E;">📖 練習專區</h3>'
            + '<span style="font-size:0.78rem; color:#64748B; font-weight:700;">' + esc(updated) + '</span>'
            + '</div>'
            + '<p style="color:#64748B; font-weight:700; margin:8px 0 16px;">自選這個班的教材與範圍，練習可自己設次數；測試交卷後會看到正確率。</p>'

            + '<div style="margin-bottom:16px;"><div style="font-weight:900; color:#134E4A; margin-bottom:8px;">1. 選教材（活頁 meta，同資料夾可複選）</div>'
            + '<div id="rz-folder-row" style="display:flex; flex-wrap:wrap; gap:8px;">' + folderCards + '</div></div>'

            + '<div style="margin-bottom:16px;"><div style="font-weight:900; color:#134E4A; margin-bottom:8px;">2. 頁碼範圍與題數</div>'
            + '<div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">'
            + '<label style="font-weight:800; color:#475569; font-size:0.85rem;">起始頁<br><input id="rz-page-start" type="number" class="form-control" value="' + esc(wizard.pageStart) + '" style="width:88px; padding:6px 8px;"></label>'
            + '<label style="font-weight:800; color:#475569; font-size:0.85rem;">結束頁<br><input id="rz-page-end" type="number" class="form-control" value="' + esc(wizard.pageEnd) + '" style="width:88px; padding:6px 8px;"></label>'
            + '<label style="font-weight:800; color:#475569; font-size:0.85rem;">題數<br><input id="rz-count" type="number" min="1" class="form-control" value="' + esc(wizard.count) + '" style="width:88px; padding:6px 8px;"></label>'
            + '<div id="rz-avail-label" style="font-weight:900; font-size:0.9rem;">—</div>'
            + '</div></div>'

            + '<div style="margin-bottom:8px;"><div style="font-weight:900; color:#134E4A; margin-bottom:8px;">3. 開始</div>'
            + '<div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">'
            + practiceBtn
            + (pol.allow_practice ? '<label style="font-weight:800; color:#475569; font-size:0.85rem;">練習次數 <input id="rz-practice-count" type="number" min="1" value="' + esc(wizard.practiceCount) + '" style="width:64px; padding:4px 6px;"></label>' : '')
            + testBtn
            + '</div></div>'
            + '<div id="rz-start-status" style="min-height:1.2em; margin-top:8px; font-size:0.82rem; font-weight:700; color:#64748B;"></div>'
            + '</div>'
            + '<div class="card" style="padding:18px; margin-top:12px;">'
            + '<h4 style="margin:0 0 8px; color:#334155;">我的最近紀錄</h4>'
            + '<div id="rz-my-sessions" style="color:#94A3B8; font-weight:700;">載入中…</div>'
            + '</div>'
        );
        bindWizard();
        paintAvailable();
        if (wizard.folder && wizard.sheets.length && wizard.pageStart && wizard.pageEnd) scheduleAvailable();
        loadMySessions();
    }

    async function loadMySessions() {
        const box = document.getElementById('rz-my-sessions');
        const classId = getClassId();
        if (!box || !classId || !window.supabaseClient) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('review_sessions')
                .select('id, mode, status, result, config, created_at, submitted_at')
                .eq('class_id', classId)
                .order('created_at', { ascending: false })
                .limit(12);
            if (error) throw error;
            if (!data || !data.length) {
                box.innerHTML = '<span style="color:#94A3B8; font-weight:700;">還沒有練習或測試紀錄。</span>';
                return;
            }
            box.innerHTML = data.map(function (s) {
                const mode = s.mode === 'practice' ? '練習' : '測試';
                const score = (s.result && s.result.score != null) ? (s.result.score + '%') : (s.status === 'submitted' ? '完成' : '進行中');
                const when = String(s.submitted_at || s.created_at || '').replace('T', ' ').slice(0, 16);
                const folder = (s.config && s.config.folder_name) || '';
                const durMs = Number(s.result && (s.result.total_time_ms || s.result.duration_ms)) || 0;
                const dur = durMs > 0 ? (' · 用時 ' + formatDurationMs(durMs)) : '';
                return '<div style="display:flex; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid #F1F5F9; font-size:0.85rem; font-weight:700; color:#334155;">'
                    + '<span>' + esc(mode) + ' · ' + esc(folder) + '</span>'
                    + '<span>' + esc(score) + dur + ' · ' + esc(when) + '</span></div>';
            }).join('');
        } catch (_e) {
            box.innerHTML = '<span style="color:#94A3B8; font-weight:700;">紀錄暫時無法載入。</span>';
        }
    }

    function bindWizard() {
        document.querySelectorAll('[data-rz-meta-folder]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const folderName = btn.getAttribute('data-rz-meta-folder') || '';
                const stem = String(btn.getAttribute('data-rz-meta-sheet') || '').toUpperCase();
                if (wizard.folder !== folderName) {
                    wizard.folder = folderName;
                    wizard.sheets = [stem];
                } else {
                    const idx = wizard.sheets.indexOf(stem);
                    if (idx === -1) wizard.sheets.push(stem);
                    else wizard.sheets.splice(idx, 1);
                    if (!wizard.sheets.length) wizard.folder = '';
                }
                wizard.available = null;
                const folder = selectedFolder();
                const picked = (folder && folder.sheets || []).filter(function (s) {
                    return wizard.sheets.indexOf(String(s.sheet_stem || '').toUpperCase()) !== -1;
                });
                const mins = picked.map(function (s) { return s.page_min; }).filter(function (n) { return n != null; });
                const maxs = picked.map(function (s) { return s.page_max; }).filter(function (n) { return n != null; });
                if (mins.length) wizard.pageStart = Math.min.apply(null, mins);
                if (maxs.length) wizard.pageEnd = Math.max.apply(null, maxs);
                renderWizard(lastCatalog);
            });
        });
        ['rz-page-start', 'rz-page-end', 'rz-count', 'rz-practice-count'].forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function () {
                if (id === 'rz-page-start') wizard.pageStart = el.value;
                if (id === 'rz-page-end') wizard.pageEnd = el.value;
                if (id === 'rz-count') wizard.count = Math.max(1, parseInt(el.value, 10) || 1);
                if (id === 'rz-practice-count') wizard.practiceCount = Math.max(1, parseInt(el.value, 10) || 1);
                if (id !== 'rz-practice-count') scheduleAvailable();
            });
        });
        const pBtn = document.getElementById('rz-start-practice');
        if (pBtn) pBtn.addEventListener('click', function () { startSession('practice'); });
        const tBtn = document.getElementById('rz-start-test');
        if (tBtn) tBtn.addEventListener('click', function () { startSession('test'); });
    }

    function setStartStatus(msg, kind) {
        const el = document.getElementById('rz-start-status');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = kind === 'error' ? '#B91C1C' : (kind === 'ok' ? '#0F766E' : '#64748B');
    }

    function canStart() {
        if (!wizard.folder) return '請先選教材';
        if (!wizard.sheets.length) return '請至少選一個教材';
        const start = parseInt(wizard.pageStart, 10);
        const end = parseInt(wizard.pageEnd, 10);
        if (isNaN(start) || isNaN(end)) return '請填頁碼範圍';
        if (selectedSheets().some(function (s) { return s.available_count == null; })) return '需老師更新目錄後才能開始';
        if (wizard.available == null) return '還在計算可用題，請稍候';
        if (wizard.available === 0) return '範圍內沒有可用題';
        if (wizard.count > wizard.available) return '題數超過可用題';
        return '';
    }

    async function startSession(mode) {
        const err = canStart();
        if (err) {
            setStartStatus(err, 'error');
            return window.showFlash(err, 'warning');
        }
        const classId = getClassId();
        const payload = {
            p_class_id: classId,
            p_mode: mode,
            p_folder_name: (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
                ? window.MaterialNameMap.resolveFolderName(wizard.folder) : wizard.folder,
            p_sheet_stems: wizard.sheets.slice(),
            p_page_start: parseInt(wizard.pageStart, 10),
            p_page_end: parseInt(wizard.pageEnd, 10),
            p_count: Math.max(1, parseInt(wizard.count, 10) || 1),
            p_practice_count: Math.max(1, parseInt(wizard.practiceCount, 10) || 1)
        };
        setStartStatus('正在出卷…', '');
        try {
            let data = null;
            if (window.supabaseClient && window.supabaseClient.functions && typeof window.supabaseClient.functions.invoke === 'function') {
                const invoked = await window.supabaseClient.functions.invoke('build-review-paper', {
                    body: {
                        class_id: payload.p_class_id,
                        mode: payload.p_mode,
                        folder_name: payload.p_folder_name,
                        sheet_stems: payload.p_sheet_stems,
                        page_start: payload.p_page_start,
                        page_end: payload.p_page_end,
                        count: payload.p_count,
                        practice_count: payload.p_practice_count
                    }
                });
                if (!invoked.error && invoked.data && !invoked.data.error) data = invoked.data;
            }
            if (!data) {
                const rpc = await window.supabaseClient.rpc('build_review_paper', payload);
                if (rpc.error) throw rpc.error;
                data = rpc.data;
            }
            if (!data || !data.quiz_paper || !Array.isArray(data.quiz_paper.items) || !data.quiz_paper.items.length) {
                throw new Error('出卷失敗：沒有題目');
            }
            setStartStatus('已出卷，共 ' + data.quiz_paper.items.length + ' 題', 'ok');
            if (mode === 'practice') openPractice(data);
            else openTest(data);
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            setStartStatus(msg, 'error');
            window.showFlash(msg, 'error');
        }
    }

    function persistSession(sessionId, payload, done) {
        return window.supabaseClient.rpc('submit_review_session', {
            p_session_id: sessionId,
            p_payload: Object.assign({}, payload, { done: !!done })
        }).then(function (res) {
            if (res.error) throw res.error;
            return res.data;
        });
    }

    function openPractice(pack) {
        if (window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.openStandalonePractice === 'function') {
            window.FeatureStudentQuiz.openStandalonePractice({
                title: '練習・' + wizard.folder,
                paper: pack.quiz_paper,
                requiredCount: Math.max(1, Number(pack.practice_required_count) || wizard.practiceCount || 1),
                onPersist: function (progressMap, allDone) {
                    const meta = progressMap && progressMap.__meta;
                    return persistSession(pack.session_id, {
                        practice_progress: progressMap,
                        result: {
                            duration_ms: meta && meta.duration_ms ? meta.duration_ms : 0,
                            total_time_ms: meta && meta.total_time_ms ? meta.total_time_ms : 0
                        }
                    }, allDone);
                }
            });
            return;
        }
        window.showFlash('練習模組未載入', 'error');
    }

    function openTest(pack) {
        if (window.FeatureStudentQuiz && typeof window.FeatureStudentQuiz.openStandaloneQuiz === 'function') {
            window.FeatureStudentQuiz.openStandaloneQuiz({
                title: '測試・' + wizard.folder,
                paper: pack.quiz_paper,
                onSubmit: function (answers, result) {
                    return persistSession(pack.session_id, { answers: answers, result: result }, true);
                }
            });
            return;
        }
        window.showFlash('測試模組未載入', 'error');
    }

    async function render() {
        const el = document.getElementById('review-container');
        if (!el) return;
        el.innerHTML = '<div class="card" style="padding:28px; color:#94A3B8; font-weight:800; text-align:center;">⏳ 載入練習教材…</div>';
        try {
            if (window.MaterialNameMap && typeof window.MaterialNameMap.ensureLoaded === 'function') {
                await window.MaterialNameMap.ensureLoaded(false);
            }
            const catalog = await fetchCatalog();
            if (!catalog || !catalog.enabled) {
                renderDisabled();
                return;
            }
            lastCatalog = catalog;
            if (!wizard.folder && catalog.folders && catalog.folders.length) {
                const matMap = (window.ReviewZone && typeof window.ReviewZone.parseMaterials === 'function')
                    ? window.ReviewZone.parseMaterials(getClassRaw())
                    : {};
                let firstMeta = null;
                catalog.folders.some(function (f) {
                    return (f.sheets || []).some(function (s) {
                        const on = !window.ReviewZone || typeof window.ReviewZone.materialEntry !== 'function'
                            || window.ReviewZone.materialEntry(matMap, f.folder_name, s.sheet_stem).enabled;
                        if (!on) return false;
                        firstMeta = { folder: f.folder_name, stem: String(s.sheet_stem || '').toUpperCase() };
                        return true;
                    });
                });
                if (firstMeta) {
                    wizard.folder = firstMeta.folder;
                    wizard.sheets = [firstMeta.stem];
                }
            }
            renderWizard(catalog);
        } catch (err) {
            renderEmpty(
                '<div class="card" style="padding:28px; color:#B91C1C; font-weight:800;">載入失敗：'
                + esc(err && err.message ? err.message : err) + '</div>'
            );
        }
    }

    return {
        render: render,
        _resetWizard: function () { wizard = defaultWizard(); }
    };
})();

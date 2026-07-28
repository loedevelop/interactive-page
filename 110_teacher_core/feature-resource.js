/**
 * 📂 檔案路徑：110_teacher_core/feature-resource.js
 * 資源三層：全域(global)／班群(teacher)／班級(class)
 * - global：全校
 * - teacher：owner 所屬 staff 班級自動適用（含未來新班）
 * - class：指定班級
 */

window.FeatureResource = (() => {
    const db = window.TeacherDB;
    const TYPE_ICONS = {
        global_drive: '🌐',
        teacher_drive: '📂',
        drive_folder: '📁',
        drive_file: '📄',
        youtube_video: '▶️',
        website_link: '🔗'
    };
    let cachedTeacherDriveUrl = null;
    let cachedGlobalDriveUrl = null;

    async function getCurrentUserId() {
        const { data: { user }, error } = await window.supabaseClient.auth.getUser();
        if (error || !user) throw new Error('授權狀態遺失');
        return user.id;
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeJS(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"');
    }

    function typeOptionsHtml(selected) {
        const opts = [
            { v: 'global_drive', t: '🌐 全域資料夾（Google Drive 最頂層）' },
            { v: 'teacher_drive', t: '📂 老師個人資料夾（Google Drive 最頂層）' },
            { v: 'drive_folder', t: '📁 Drive 資料夾' },
            { v: 'drive_file', t: '📄 Drive 單一檔案' },
            { v: 'youtube_video', t: '▶️ YouTube' },
            { v: 'website_link', t: '🔗 外部網址' }
        ];
        return opts.map(function (o) {
            return '<option value="' + o.v + '"' + (selected === o.v ? ' selected' : '') + '>' + o.t + '</option>';
        }).join('');
    }

    function normalizeDriveFolderUrl(val) {
        if (!val) return '';
        const s = String(val).trim();
        if (!s || s === '尚未綁定雲端硬碟') return '';
        if (/^https?:\/\//i.test(s)) return s;
        const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (m) return 'https://drive.google.com/drive/folders/' + m[1];
        if (s.indexOf('/') === -1 && s.length > 15) {
            return 'https://drive.google.com/drive/folders/' + s;
        }
        return s;
    }

    function extractFolderId(val) {
        if (!val) return '';
        const s = String(val).trim();
        const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        if (s.indexOf('/') === -1 && s.length > 15) return s;
        return '';
    }

    async function persistTeacherDriveRoot(userId, folderId, folderUrl) {
        const id = extractFolderId(folderId) || extractFolderId(folderUrl);
        const url = normalizeDriveFolderUrl(folderUrl || folderId);
        if (!id && !url) throw new Error('無效的老師資料夾');

        const { data: profile, error } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', userId)
            .maybeSingle();
        if (error) throw error;

        const raw = Object.assign({}, (profile && profile.raw_data) || {});
        raw.drive_folder_id = id || raw.drive_folder_id || '';
        raw.drive_url = url;
        raw.driveLink = url;
        // 明確標記：存的是老師工作區最頂層，不是 00／01
        raw.drive_root_kind = 'teacher_workspace';

        const { error: upErr } = await window.supabaseClient
            .from('profiles')
            .update({ raw_data: raw })
            .eq('id', userId);
        if (upErr) throw upErr;

        cachedTeacherDriveUrl = url;
        return url;
    }

    /** 開班／資源表單共用：確保老師工作區根存在並寫入個人檔 */
    async function ensureAndBindTeacherPersonalDrive() {
        const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
        if (authErr || !user) throw new Error('授權狀態遺失');

        if (!window.GasService || typeof window.GasService.ensureTeacherWorkspace !== 'function') {
            throw new Error('GasService 未就緒');
        }

        // 規格：{email @ 前面}_{uid 後 4 碼}
        const teacherLabel = (user.email ? String(user.email).split('@')[0] : '') || 'Teacher';
        const teacherShortId = user.id.slice(-4);
        const result = await window.GasService.ensureTeacherWorkspace(teacherLabel, teacherShortId);
        const folderId = result.folderId || '';
        const folderUrl = result.folderUrl || normalizeDriveFolderUrl(folderId);
        if (!folderId && !folderUrl) throw new Error('老師工作區建立失敗');

        return persistTeacherDriveRoot(user.id, folderId, folderUrl);
    }

    async function getTeacherPersonalDriveUrl(forceRefresh) {
        if (!forceRefresh && cachedTeacherDriveUrl) return cachedTeacherDriveUrl;
        const ownerId = await getCurrentUserId();
        const { data: profile, error } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', ownerId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error) throw error;
        const raw = (profile && profile.raw_data) || {};
        let display = '';
        if (window.ProfileForm && typeof window.ProfileForm.getDriveDisplay === 'function') {
            display = window.ProfileForm.getDriveDisplay(raw);
        } else {
            display = raw.drive_url || raw.driveLink || raw.drive_folder_id || '';
        }
        let url = normalizeDriveFolderUrl(display);
        // 尚未綁定 → 建立並寫入老師根目錄
        if (!url) {
            try {
                url = await ensureAndBindTeacherPersonalDrive();
            } catch (bindErr) {
                console.warn('[Resource] 自動綁定老師資料夾略過:', bindErr);
            }
        }
        cachedTeacherDriveUrl = url;
        return cachedTeacherDriveUrl;
    }

    /** 老師工作區最頂層 folderId（非 00／01 子夾） */
    async function getTeacherPersonalDriveFolderId(forceRefresh) {
        const ownerId = await getCurrentUserId();
        const { data: profile, error } = await window.supabaseClient
            .from('profiles')
            .select('raw_data')
            .eq('id', ownerId)
            .is('deleted_at', null)
            .maybeSingle();
        if (error) throw error;
        const raw = (profile && profile.raw_data) || {};
        let id = extractFolderId(raw.drive_folder_id || '');
        if (!id) {
            const url = await getTeacherPersonalDriveUrl(forceRefresh);
            id = extractFolderId(url);
        }
        if (!id && forceRefresh) {
            await ensureAndBindTeacherPersonalDrive();
            return getTeacherPersonalDriveFolderId(false);
        }
        return id || '';
    }

    async function getGlobalDriveFolderUrl(forceRefresh) {
        if (!forceRefresh && cachedGlobalDriveUrl) return cachedGlobalDriveUrl;
        const { data, error } = await window.supabaseClient
            .from('system_settings')
            .select('value')
            .eq('setting_key', 'global_drive_folder')
            .maybeSingle();
        if (error) throw error;
        cachedGlobalDriveUrl = normalizeDriveFolderUrl(data && data.value);
        return cachedGlobalDriveUrl;
    }

    function inferResourceTypeFromMime(mimeType, fileName) {
        const mime = String(mimeType || '').toLowerCase();
        const name = String(fileName || '').toLowerCase();
        if (mime.indexOf('youtube') !== -1 || /youtu\.be|youtube\.com/.test(name)) return 'youtube_video';
        if (mime.indexOf('folder') !== -1) return 'drive_folder';
        return 'drive_file';
    }

    function fileIconForMime(mimeType) {
        const mime = String(mimeType || '').toLowerCase();
        if (mime.indexOf('pdf') !== -1) return '📄';
        if (mime.indexOf('image') !== -1) return '🖼️';
        if (mime.indexOf('audio') !== -1) return '🎵';
        if (mime.indexOf('video') !== -1) return '🎬';
        if (mime.indexOf('spreadsheet') !== -1 || mime.indexOf('excel') !== -1) return '📊';
        if (mime.indexOf('document') !== -1 || mime.indexOf('word') !== -1) return '📝';
        return '📎';
    }

    /**
     * 從最頂層瀏覽：資料夾可進入；檔案才是派發最終目標
     */
    function openDriveChildPicker(opts) {
        const title = opts.title || '選擇要派發的檔案';
        const rootId = extractFolderId(opts.rootId || opts.rootUrl);
        const nameEl = opts.nameInputId ? document.getElementById(opts.nameInputId) : null;
        const urlEl = opts.urlInputId ? document.getElementById(opts.urlInputId) : null;
        const typeEl = opts.typeSelectId ? document.getElementById(opts.typeSelectId) : null;
        const defaultName = opts.defaultName || '';

        if (!rootId) {
            if (window.showFlash) window.showFlash('⚠️ 無法解析最頂層資料夾 ID', 'error');
            return;
        }
        if (!window.GasService || typeof window.GasService.listChildFolders !== 'function') {
            if (window.showFlash) window.showFlash('⚠️ GasService 未就緒，無法列出內容', 'error');
            return;
        }

        const overlayId = 'ml-drive-folder-picker';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;';

        function applyFilePick(file) {
            const url = file.url || ('https://drive.google.com/file/d/' + file.id + '/view');
            if (urlEl) urlEl.value = url;
            if (nameEl) nameEl.value = file.name || defaultName;
            if (typeEl) {
                const inferred = inferResourceTypeFromMime(file.mimeType, file.name);
                if (typeEl.querySelector('option[value="' + inferred + '"]')) {
                    typeEl.value = inferred;
                }
            }
            overlay.remove();
            if (window.showFlash) window.showFlash('已選取檔案：' + (file.name || ''), 'success');
        }

        async function renderAt(folderId, trail) {
            const box = overlay.querySelector('.ml-drive-picker-box');
            if (!box) return;
            const listEl = box.querySelector('.ml-drive-picker-list');
            const crumbEl = box.querySelector('.ml-drive-picker-crumb');
            const statusEl = box.querySelector('.ml-drive-picker-status');
            listEl.innerHTML = '';
            statusEl.textContent = '⏳ 載入中…';
            crumbEl.textContent = (trail || []).map(function (t) { return t.name; }).join(' / ') || '最頂層';

            if (trail && trail.length > 1) {
                const backBtn = document.createElement('button');
                backBtn.type = 'button';
                backBtn.style.cssText = 'display:block;width:100%;margin-bottom:10px;padding:10px 12px;border-radius:8px;border:1px solid #CBD5E1;background:#F8FAFC;cursor:pointer;font-weight:800;color:#475569;text-align:left;';
                backBtn.textContent = '‹ 返回上一層';
                backBtn.onclick = function () {
                    const nextTrail = trail.slice(0, -1);
                    renderAt(nextTrail[nextTrail.length - 1].id, nextTrail);
                };
                listEl.appendChild(backBtn);
            }

            try {
                const result = await window.GasService.listChildFolders(folderId);
                const folders = result.folders || [];
                const files = result.files || [];
                statusEl.textContent = '請進入資料夾（如 00／01），再點選要派發的檔案。';

                if (folders.length) {
                    const h = document.createElement('div');
                    h.style.cssText = 'font-weight:900;color:#64748B;font-size:0.85rem;margin:8px 0 6px;';
                    h.textContent = '📁 子資料夾（點進去）';
                    listEl.appendChild(h);
                    folders.forEach(function (f) {
                        const openBtn = document.createElement('button');
                        openBtn.type = 'button';
                        openBtn.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px;padding:12px 14px;border-radius:10px;border:1px solid #CBD5E1;background:white;cursor:pointer;font-weight:800;color:#1E293B;';
                        openBtn.textContent = '📁 ' + f.name + '  ›';
                        openBtn.onclick = function () {
                            renderAt(f.id, (trail || []).concat([{ id: f.id, name: f.name }]));
                        };
                        listEl.appendChild(openBtn);
                    });
                }

                if (files.length) {
                    const h2 = document.createElement('div');
                    h2.style.cssText = 'font-weight:900;color:#047857;font-size:0.85rem;margin:14px 0 6px;';
                    h2.textContent = '📎 檔案（點選後寫入網址，作為派發目標）';
                    listEl.appendChild(h2);
                    files.forEach(function (file) {
                        const pickBtn = document.createElement('button');
                        pickBtn.type = 'button';
                        pickBtn.style.cssText = 'display:block;width:100%;text-align:left;margin-bottom:8px;padding:12px 14px;border-radius:10px;border:2px solid #6EE7B7;background:#ECFDF5;cursor:pointer;font-weight:800;color:#065F46;';
                        pickBtn.textContent = fileIconForMime(file.mimeType) + ' ' + file.name;
                        pickBtn.onclick = function () { applyFilePick(file); };
                        listEl.appendChild(pickBtn);
                    });
                }

                if (!folders.length && !files.length) {
                    statusEl.textContent = '此層沒有子資料夾或檔案。';
                }
            } catch (err) {
                statusEl.textContent = '載入失敗：' + (err.message || err);
            }
        }

        overlay.innerHTML = ''
            + '<div class="ml-drive-picker-box" style="background:white;width:min(560px,96vw);max-height:85vh;overflow:auto;border-radius:14px;padding:20px;box-shadow:0 20px 40px rgba(0,0,0,0.25);">'
            + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;">'
            + '<div><h3 style="margin:0;color:#0F172A;font-size:1.15rem;font-weight:900;">' + escapeHTML(title) + '</h3>'
            + '<div class="ml-drive-picker-crumb" style="margin-top:6px;font-size:0.85rem;color:#64748B;font-weight:700;"></div></div>'
            + '<button type="button" style="border:none;background:#F1F5F9;color:#475569;padding:8px 12px;border-radius:8px;cursor:pointer;font-weight:800;" data-close="1">✕</button>'
            + '</div>'
            + '<p class="ml-drive-picker-status" style="margin:0 0 12px;color:#64748B;font-weight:700;font-size:0.9rem;"></p>'
            + '<div class="ml-drive-picker-list"></div>'
            + '</div>';

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || (e.target && e.target.getAttribute('data-close') === '1')) {
                overlay.remove();
            }
        });

        document.body.appendChild(overlay);
        renderAt(rootId, [{ id: rootId, name: opts.rootLabel || '最頂層' }]);
    }

    async function applyDriveRootTypeToFields(typeSelectId, nameInputId, urlInputId) {
        const typeEl = document.getElementById(typeSelectId);
        if (!typeEl) return;

        const type = typeEl.value;
        if (type !== 'global_drive' && type !== 'teacher_drive') return;

        try {
            if (type === 'global_drive') {
                const driveUrl = await getGlobalDriveFolderUrl(true);
                if (!driveUrl) {
                    if (window.showFlash) {
                        window.showFlash('⚠️ 全域 Drive 最頂層尚未設定，請管理員至後台「全域設定」填入資料夾網址或 ID', 'error');
                    }
                    return;
                }
                openDriveChildPicker({
                    title: '從全域資料夾選擇要派發的檔案',
                    rootUrl: driveUrl,
                    rootLabel: '全域最頂層',
                    nameInputId: nameInputId,
                    urlInputId: urlInputId,
                    typeSelectId: typeSelectId,
                    defaultName: '全域資源檔案'
                });
                return;
            }

            const driveUrl = await getTeacherPersonalDriveUrl(true);
            if (!driveUrl) {
                if (window.showFlash) {
                    window.showFlash('⚠️ 尚未綁定老師個人 Drive 最頂層，請先至帳號設定重新綁定', 'error');
                }
                return;
            }
            openDriveChildPicker({
                title: '從老師個人資料夾選擇要派發的檔案',
                rootUrl: driveUrl,
                rootLabel: '老師個人最頂層',
                nameInputId: nameInputId,
                urlInputId: urlInputId,
                typeSelectId: typeSelectId,
                defaultName: '老師資源檔案'
            });
        } catch (err) {
            if (window.showFlash) window.showFlash('讀取資料夾失敗：' + (err.message || err), 'error');
        }
    }

    /** @deprecated 相容舊呼叫 */
    function applyTeacherDriveToFields(typeSelectId, nameInputId, urlInputId) {
        return applyDriveRootTypeToFields(typeSelectId, nameInputId, urlInputId);
    }

    function bindTypeSelectAutoFill(typeSelectId, nameInputId, urlInputId) {
        const typeEl = document.getElementById(typeSelectId);
        if (!typeEl || typeEl.dataset.teacherDriveBound === '1') return;
        typeEl.dataset.teacherDriveBound = '1';
        typeEl.addEventListener('change', function () {
            applyDriveRootTypeToFields(typeSelectId, nameInputId, urlInputId);
        });
    }

    function scopeRank(scope) {
        if (scope === 'global') return 3;
        if (scope === 'teacher') return 2;
        return 1;
    }

    function scopeBadgeHtml(scope) {
        if (scope === 'global') {
            return '<span style="font-size:0.75rem; background:#DBEAFE; color:#1D4ED8; padding:2px 8px; border-radius:12px; border:1px solid #93C5FD;">🌍 全域</span>';
        }
        if (scope === 'teacher') {
            return '<span style="font-size:0.75rem; background:#ECFDF5; color:#047857; padding:2px 8px; border-radius:12px; border:1px solid #6EE7B7;">👥 班群</span>';
        }
        return '<span style="font-size:0.75rem; background:#FEE2E2; color:#B91C1C; padding:2px 8px; border-radius:12px; border:1px solid #FCA5A5;">🏷️ 班級</span>';
    }

    function preferHigherScope(existing, next) {
        return scopeRank(next.scope) > scopeRank(existing.scope) ? next : existing;
    }

    function mergeResourcesByUrl(list) {
        const resMap = new Map();
        (list || []).forEach(function (r) {
            const key = r.url && r.url.trim() !== '' ? r.url.trim() : r.id;
            if (!resMap.has(key)) resMap.set(key, r);
            else resMap.set(key, preferHigherScope(resMap.get(key), r));
        });
        return Array.from(resMap.values()).sort(function (a, b) {
            return scopeRank(b.scope) - scopeRank(a.scope);
        });
    }

    async function fetchClassStaffUserIds(classId) {
        try {
            const { data, error } = await window.supabaseClient
                .from('class_staff')
                .select('user_id')
                .eq('class_id', classId)
                .is('deleted_at', null);
            if (error) throw error;
            return (data || []).map(function (r) { return r.user_id; });
        } catch (err) {
            console.warn('[Resource] 無法讀取 class_staff：', err);
            return [];
        }
    }

    function resourceAppliesToClass(r, classId, staffUserIds) {
        if (!r) return false;
        if (r.scope === 'global') return true;
        if (r.scope === 'class' && r.target_class_id === classId) return true;
        if (r.scope === 'teacher' && staffUserIds && staffUserIds.indexOf(r.owner_id) !== -1) return true;
        return false;
    }

    /** 讀取派發 UI → { mode:'global'|'teacher'|'class'|null, classIds:[] } */
    function readDispatchState(globalId, teacherId, cbClass, totalClassCount) {
        const globalEl = document.getElementById(globalId);
        const teacherEl = document.getElementById(teacherId);
        if (globalEl && globalEl.checked) return { mode: 'global', classIds: [] };

        const checks = Array.from(document.querySelectorAll('.' + cbClass + ':checked')).map(function (c) {
            return c.value;
        });
        const allSelected = totalClassCount > 0 && checks.length === totalClassCount;
        if ((teacherEl && teacherEl.checked) || allSelected) {
            return { mode: 'teacher', classIds: checks };
        }
        if (checks.length === 0) return { mode: null, classIds: [] };
        return { mode: 'class', classIds: checks };
    }

    function buildInsertRows(base, mode, classIds) {
        if (mode === 'global') {
            return [Object.assign({}, base, { scope: 'global', target_class_id: null })];
        }
        if (mode === 'teacher') {
            return [Object.assign({}, base, { scope: 'teacher', target_class_id: null })];
        }
        return (classIds || []).map(function (cid) {
            return Object.assign({}, base, { scope: 'class', target_class_id: cid });
        });
    }

    function setChipStyle(el, on, onBg, onBorder, offBg, offBorder) {
        if (!el) return;
        el.style.background = on ? onBg : offBg;
        el.style.borderColor = on ? onBorder : offBorder;
    }

    /**
     * 同步三層派發 UI
     * source: 'global' | 'teacher' | 'class'
     */
    function syncDispatchMode(prefix, source) {
        const globalCb = document.getElementById(prefix + '-global');
        const teacherCb = document.getElementById(prefix + '-teacher');
        const globalLabel = document.getElementById(prefix + '-global-label');
        const teacherLabel = document.getElementById(prefix + '-teacher-label');
        const cbs = Array.from(document.querySelectorAll('.' + prefix + '-class-cb'));

        if (!globalCb || !teacherCb) return;

        if (source === 'global') {
            if (globalCb.checked) {
                teacherCb.checked = false;
                setChipStyle(teacherLabel, false, '#ECFDF5', '#10B981', '#F8FAFC', '#E2E8F0');
                cbs.forEach(function (cb) {
                    cb.checked = false;
                    cb.disabled = true;
                    cb.parentElement.style.opacity = '0.4';
                    setChipStyle(cb.parentElement, false, '#DBEAFE', '#93C5FD', '#F8FAFC', '#CBD5E1');
                });
            } else {
                cbs.forEach(function (cb) {
                    cb.disabled = false;
                    cb.parentElement.style.opacity = '1';
                });
            }
            setChipStyle(globalLabel, globalCb.checked, '#EFF6FF', '#3B82F6', '#F8FAFC', '#E2E8F0');
            return;
        }

        if (source === 'teacher') {
            if (teacherCb.checked) {
                globalCb.checked = false;
                setChipStyle(globalLabel, false, '#EFF6FF', '#3B82F6', '#F8FAFC', '#E2E8F0');
                cbs.forEach(function (cb) {
                    cb.disabled = false;
                    cb.checked = true;
                    cb.parentElement.style.opacity = '1';
                    setChipStyle(cb.parentElement, true, '#DBEAFE', '#93C5FD', '#F8FAFC', '#CBD5E1');
                });
            }
            setChipStyle(teacherLabel, teacherCb.checked, '#ECFDF5', '#10B981', '#F8FAFC', '#E2E8F0');
            return;
        }

        // class checkbox changed
        globalCb.checked = false;
        setChipStyle(globalLabel, false, '#EFF6FF', '#3B82F6', '#F8FAFC', '#E2E8F0');
        cbs.forEach(function (cb) {
            cb.disabled = false;
            cb.parentElement.style.opacity = '1';
            setChipStyle(cb.parentElement, cb.checked, '#DBEAFE', '#93C5FD', '#F8FAFC', '#CBD5E1');
        });
        const allOn = cbs.length > 0 && cbs.every(function (cb) { return cb.checked; });
        teacherCb.checked = allOn;
        setChipStyle(teacherLabel, allOn, '#ECFDF5', '#10B981', '#F8FAFC', '#E2E8F0');
    }

    /**
     * @param {object} opts
     * @param {'global'|'teacher'|'class'|null} opts.mode
     * @param {string[]} opts.dispatchedIds
     * @param {string} opts.prefix  id/class 前綴，如 'res' / 'modal'
     */
    function buildDispatchLayout(activeClasses, opts) {
        const mode = (opts && opts.mode) || null;
        const dispatchedIds = (opts && opts.dispatchedIds) || [];
        const prefix = (opts && opts.prefix) || 'res';
        const isGlobal = mode === 'global';
        const isTeacher = mode === 'teacher';

        let html = ''
            + '<div style="display:flex; flex-direction:column; gap:14px; margin-top:8px;">'
            + '<div style="display:flex; gap:12px; flex-wrap:wrap;">'
            + '<label id="' + prefix + '-global-label" style="flex:1; min-width:200px; display:flex; flex-direction:column; align-items:center; justify-content:center;'
            + 'background:' + (isGlobal ? '#EFF6FF' : '#F8FAFC') + '; border:2px solid ' + (isGlobal ? '#3B82F6' : '#E2E8F0') + ';'
            + 'border-radius:12px; cursor:pointer; padding:16px; text-align:center;">'
            + '<input type="checkbox" id="' + prefix + '-global" style="transform:scale(1.4); margin-bottom:10px;" '
            + (isGlobal ? 'checked' : '') + ' onchange="window.FeatureResource.syncDispatchMode(\'' + prefix + '\',\'global\')">'
            + '<span style="font-weight:900; color:#1E3A8A; font-size:1.05rem; line-height:1.4;">🌍 全域（全校）</span>'
            + '<span style="font-size:0.85rem; color:#64748B; margin-top:6px; font-weight:700;">所有班級皆可見（含其他老師）</span>'
            + '</label>'
            + '<label id="' + prefix + '-teacher-label" style="flex:1; min-width:200px; display:flex; flex-direction:column; align-items:center; justify-content:center;'
            + 'background:' + (isTeacher ? '#ECFDF5' : '#F8FAFC') + '; border:2px solid ' + (isTeacher ? '#10B981' : '#E2E8F0') + ';'
            + 'border-radius:12px; cursor:pointer; padding:16px; text-align:center;">'
            + '<input type="checkbox" id="' + prefix + '-teacher" style="transform:scale(1.4); margin-bottom:10px;" '
            + (isTeacher ? 'checked' : '') + ' onchange="window.FeatureResource.syncDispatchMode(\'' + prefix + '\',\'teacher\')">'
            + '<span style="font-weight:900; color:#065F46; font-size:1.05rem; line-height:1.4;">👥 班群（我的全部班）</span>'
            + '<span style="font-size:0.85rem; color:#64748B; margin-top:6px; font-weight:700;">自動跟老師名下班級走（含未來新班）</span>'
            + '</label>'
            + '</div>'
            + '<div>'
            + '<div style="font-weight:900; color:#475569; margin-bottom:8px; font-size:0.95rem;">🏷️ 班級（單選／複選；全勾＝班群）</div>'
            + '<div style="display:flex; flex-wrap:wrap; gap:10px;">';

        if (!activeClasses.length) {
            html += '<span style="color:#EF4444; font-size:0.9rem;">您目前沒有活躍的班級。</span>';
        } else {
            activeClasses.forEach(function (cls) {
                const checked = isTeacher || dispatchedIds.indexOf(cls.id) !== -1;
                const disabled = isGlobal;
                const safeClsName = escapeHTML(cls.name);
                html += ''
                    + '<label style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px;'
                    + 'background:' + (checked && !disabled ? '#DBEAFE' : '#F8FAFC') + ';'
                    + 'border:1px solid ' + (checked && !disabled ? '#93C5FD' : '#CBD5E1') + ';'
                    + 'border-radius:6px; cursor:pointer; opacity:' + (disabled ? '0.4' : '1') + '; height:fit-content;">'
                    + '<input type="checkbox" value="' + cls.id + '" class="' + prefix + '-class-cb" style="transform:scale(1.2);" '
                    + (checked ? 'checked' : '') + ' ' + (disabled ? 'disabled' : '') + ' '
                    + 'onchange="window.FeatureResource.syncDispatchMode(\'' + prefix + '\',\'class\')">'
                    + '<span style="font-weight:800; color:#334155;">' + (cls.icon || '📘') + ' ' + safeClsName + '</span>'
                    + '</label>';
            });
        }

        html += '</div></div></div>';
        return html;
    }

    async function fetchResourcesFromDB() {
        try {
            const { data: resData, error: resErr } = await window.supabaseClient
                .from('resources')
                .select('*')
                .is('deleted_at', null);

            if (resErr) throw resErr;

            const safeData = resData || [];
            db.resourceLibrary = safeData;

            db.resourceMappings = safeData
                .filter(function (r) {
                    return (r.scope === 'class' && r.target_class_id)
                        || r.scope === 'global'
                        || r.scope === 'teacher';
                })
                .map(function (r) {
                    return {
                        resource_id: r.id,
                        class_id: r.scope === 'global' ? 'ALL' : (r.scope === 'teacher' ? 'TEACHER' : r.target_class_id),
                        scope: r.scope
                    };
                });
        } catch (err) {
            console.error('[Resource Error] 載入資源失敗：', err);
        }
    }

    async function renderClassResources(classId) {
        await fetchResourcesFromDB();
        const container = document.getElementById('class-resource-container');
        if (!container) return;

        const staffIds = await fetchClassStaffUserIds(classId);
        const matched = (db.resourceLibrary || []).filter(function (r) {
            return resourceAppliesToClass(r, classId, staffIds);
        });
        const uniqueResources = mergeResourcesByUrl(matched);

        let html = ''
            + '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">'
            + '<h3 style="margin:0; color:#1E293B;">📂 班級資源庫</h3>'
            + '<button class="btn btn-primary" style="font-size:0.95rem; font-weight:800; padding:8px 16px;" '
            + 'onclick="window.FeatureResource.openAddClassResourceModal(\'' + classId + '\')">➕ 新增本班專屬資源</button>'
            + '</div>'
            + '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';

        if (uniqueResources.length === 0) {
            html += '<div style="grid-column:1/-1;"><p style="color:#94A3B8; font-weight:800; padding:20px; background:#F8FAFC; border-radius:8px; text-align:center;">本班目前無任何資源，請點擊上方按鈕建立。</p></div>';
        } else {
            uniqueResources.forEach(function (res) {
                const safeNameHTML = escapeHTML(res.name);
                const safeUrlJS = escapeJS(res.url);
                html += ''
                    + '<div class="res-item" style="position:relative; cursor:pointer; background:white; border:1px solid #E2E8F0; padding:20px 15px; border-radius:12px; text-align:center; transition:all 0.2s; box-shadow:0 2px 4px rgba(0,0,0,0.02);" '
                    + 'onmouseover="this.style.borderColor=\'var(--primary)\'; this.style.transform=\'translateY(-2px)\';" '
                    + 'onmouseout="this.style.borderColor=\'#E2E8F0\'; this.style.transform=\'none\';">'
                    + '<div style="position:absolute; top:10px; right:10px; display:flex; gap:5px;">'
                    + '<button class="btn-icon" style="background:#F1F5F9; border:1px solid #CBD5E1; padding:4px 6px; border-radius:4px; cursor:pointer;" '
                    + 'onclick="event.stopPropagation(); window.FeatureResource.openEditResourceModal(\'' + safeUrlJS + '\')" title="編輯資源">✏️</button>'
                    + '<button class="btn-icon" style="background:#FEF2F2; border:1px solid #FECACA; padding:4px 6px; border-radius:4px; cursor:pointer;" '
                    + 'onclick="event.stopPropagation(); window.FeatureResource.deleteResourceGroup(\'' + safeUrlJS + '\')" title="刪除資源">🗑️</button>'
                    + '</div>'
                    + '<div onclick="window.open(\'' + safeUrlJS + '\', \'_blank\')">'
                    + '<div style="font-size:3rem; margin-bottom:10px;">' + res.icon + '</div>'
                    + '<div style="font-weight:900; color:#1E293B; font-size:1.05rem;">' + safeNameHTML + '</div>'
                    + '<div style="margin-top:8px;">' + scopeBadgeHtml(res.scope) + '</div>'
                    + '</div></div>';
            });
        }
        html += '</div>';
        container.innerHTML = html;
    }

    async function renderGlobalResourceView() {
        await fetchResourcesFromDB();
        const cbContainer = document.getElementById('global-class-checkboxes');
        const activeClasses = db.classes || [];
        const safeLibrary = db.resourceLibrary || [];

        if (cbContainer) {
            cbContainer.innerHTML = buildDispatchLayout(activeClasses, {
                mode: null,
                dispatchedIds: [],
                prefix: 'res'
            });
        }

        const libContainer = document.getElementById('global-resource-library');
        if (!libContainer) return;

        let uid = null;
        try { uid = await getCurrentUserId(); } catch (_e) { uid = null; }

        const myClassIds = activeClasses.map(function (c) { return c.id; });
        const myResources = safeLibrary.filter(function (r) {
            if (r.scope === 'global') return true;
            if (r.scope === 'teacher') return !uid || r.owner_id === uid;
            if (r.scope === 'class') return myClassIds.indexOf(r.target_class_id) !== -1;
            return false;
        });

        const uniqueResources = mergeResourcesByUrl(myResources);

        if (uniqueResources.length === 0) {
            libContainer.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding:20px 0;">您的資源庫目前是空的，請在上方建立新資源。</p>';
            return;
        }

        let listHTML = '<div style="display:flex; flex-direction:column; gap:12px;">';

        uniqueResources.forEach(function (res) {
            let badgeHTML = '<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">';
            if (res.scope === 'global') {
                badgeHTML += '<span style="background:#DBEAFE; color:#1D4ED8; font-size:0.8rem; padding:4px 10px; border-radius:12px; font-weight:bold; border:1px solid #93C5FD;">🌍 全域（全校）</span>';
            } else if (res.scope === 'teacher') {
                badgeHTML += '<span style="background:#ECFDF5; color:#047857; font-size:0.8rem; padding:4px 10px; border-radius:12px; font-weight:bold; border:1px solid #6EE7B7;">👥 班群（我的全部班）</span>';
            } else {
                const dispatchedClasses = safeLibrary
                    .filter(function (r) { return r.url === res.url && r.scope === 'class'; })
                    .map(function (r) { return activeClasses.find(function (c) { return c.id === r.target_class_id; }); })
                    .filter(function (c) { return !!c; });

                if (dispatchedClasses.length === 0) {
                    badgeHTML += '<span style="background:#F1F5F9; color:#94A3B8; font-size:0.8rem; padding:4px 10px; border-radius:12px; border:1px dashed #CBD5E1;">未派發/班級已封存</span>';
                } else {
                    dispatchedClasses.forEach(function (c) {
                        badgeHTML += '<span style="background:#F8FAFC; color:#334155; font-size:0.8rem; padding:4px 10px; border-radius:12px; font-weight:bold; border:1px solid #CBD5E1;">🏷️ ' + escapeHTML(c.name) + '</span>';
                    });
                }
            }
            badgeHTML += '</div>';

            const safeNameHTML = escapeHTML(res.name);
            const safeUrlJS = escapeJS(res.url);
            const safeUrlHTML = escapeHTML(res.url);

            listHTML += ''
                + '<div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:15px; padding:15px; background:white; border:1px solid #E2E8F0; border-radius:10px;">'
                + '<div style="display:flex; align-items:center; gap:15px; flex:1; min-width:250px;">'
                + '<div style="font-size:2rem; background:#F8FAFC; min-width:60px; height:60px; display:flex; align-items:center; justify-content:center; border-radius:10px; border:1px solid #E2E8F0;">' + res.icon + '</div>'
                + '<div>'
                + '<a href="' + safeUrlHTML + '" target="_blank" style="font-weight:900; color:#1E293B; font-size:1.15rem; text-decoration:none;">' + safeNameHTML + ' <span style="font-size:0.9rem; color:#94A3B8;">🔗</span></a>'
                + badgeHTML
                + '</div></div>'
                + '<div style="display:flex; gap:8px; flex-shrink:0; align-items:center;">'
                + '<button class="btn" style="background:#F8FAFC; color:#475569; border:1px solid #CBD5E1; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:bold;" '
                + 'onclick="window.FeatureResource.openEditResourceModal(\'' + safeUrlJS + '\')">✏️ 編輯</button>'
                + '<button class="btn-danger" style="background:#FEF2F2; color:#EF4444; border:1px solid #FECACA; padding:8px 12px; border-radius:8px; cursor:pointer; font-weight:bold;" '
                + 'onclick="window.FeatureResource.deleteResourceGroup(\'' + safeUrlJS + '\')">🗑️</button>'
                + '</div></div>';
        });

        listHTML += '</div>';
        libContainer.innerHTML = listHTML;
    }

    function openEditResourceModal(resUrl) {
        const safeLibrary = db.resourceLibrary || [];
        const activeClasses = db.classes || [];

        let resSample = safeLibrary.find(function (r) { return r.url === resUrl && r.scope === 'global'; });
        if (!resSample) resSample = safeLibrary.find(function (r) { return r.url === resUrl && r.scope === 'teacher'; });
        if (!resSample) resSample = safeLibrary.find(function (r) { return r.url === resUrl; });
        if (!resSample) return;

        const mode = resSample.scope === 'global' || resSample.scope === 'teacher'
            ? resSample.scope
            : 'class';
        const dispatchedIds = safeLibrary
            .filter(function (r) { return r.url === resUrl && r.scope === 'class'; })
            .map(function (r) { return r.target_class_id; });

        const overlayId = 'edit-resource-modal';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:9999; backdrop-filter:blur(3px); padding:15px; box-sizing:border-box;';

        const classCheckboxesHTML = buildDispatchLayout(activeClasses, {
            mode: mode,
            dispatchedIds: dispatchedIds,
            prefix: 'modal'
        });

        overlay.innerHTML = ''
            + '<div style="background:white; padding:30px; border-radius:16px; width:100%; max-width:750px; box-shadow:0 20px 40px rgba(0,0,0,0.3); max-height:90vh; overflow-y:auto;">'
            + '<h3 style="margin-top:0; color:#1E293B; border-bottom:2px solid #F1F5F9; padding-bottom:15px; margin-bottom:20px; font-size:1.4rem;">✏️ 修改資源與派發設定</h3>'
            + '<div style="display:flex; flex-wrap:wrap; gap:15px; margin-bottom:20px;">'
            + '<div style="flex:1; min-width:150px;">'
            + '<label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">類型</label>'
            + '<select id="modal-res-type" class="form-control" style="width:100%; padding:10px; font-size:1rem; border-radius:8px;">'
            + typeOptionsHtml(resSample.type)
            + '</select></div>'
            + '<div style="flex:2; min-width:200px;">'
            + '<label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源名稱 <span style="color:#EF4444;">*</span></label>'
            + '<input type="text" id="modal-res-name" class="form-control" value="' + escapeHTML(resSample.name) + '" style="width:100%; padding:10px; font-size:1rem; border-radius:8px;">'
            + '</div></div>'
            + '<div style="margin-bottom:25px;">'
            + '<label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源網址 <span style="color:#EF4444;">*</span></label>'
            + '<input type="url" id="modal-res-url" class="form-control" value="' + escapeHTML(resSample.url) + '" style="width:100%; padding:10px; font-size:1rem; border-radius:8px;">'
            + '</div>'
            + '<div style="margin-bottom:30px;">'
            + '<label style="display:block; font-weight:900; color:#3B82F6; margin-bottom:12px; font-size:1.1rem;">🎯 派發目標設定</label>'
            + classCheckboxesHTML
            + '</div>'
            + '<div style="display:flex; justify-content:flex-end; gap:12px; border-top:2px solid #F1F5F9; padding-top:20px;">'
            + '<button class="btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; padding:10px 20px; border-radius:8px; cursor:pointer; font-weight:800;" onclick="document.getElementById(\'' + overlayId + '\').remove()">取消</button>'
            + '<button id="btn-save-modal-res" class="btn btn-primary" style="padding:10px 24px; font-weight:900; font-size:1rem; border-radius:8px;" '
            + 'onclick="window.FeatureResource.saveEditedResource(\'' + escapeJS(resSample.url) + '\')">💾 儲存修改</button>'
            + '</div></div>';

        document.body.appendChild(overlay);
        bindTypeSelectAutoFill('modal-res-type', 'modal-res-name', 'modal-res-url');
    }

    async function saveEditedResource(originalUrl) {
        const btn = document.getElementById('btn-save-modal-res');
        const newName = document.getElementById('modal-res-name').value.trim();
        const newUrl = document.getElementById('modal-res-url').value.trim();
        const newType = document.getElementById('modal-res-type').value;
        const im = TYPE_ICONS;
        const activeClasses = db.classes || [];
        const dispatch = readDispatchState('modal-global', 'modal-teacher', 'modal-class-cb', activeClasses.length);

        if (!newName || !newUrl) return window.showFlash('⚠️ 請填寫資源名稱與網址！', 'error');
        if (!dispatch.mode) return window.showFlash('⚠️ 請選擇全域、班群，或至少勾選一個班級！', 'error');

        btn.innerHTML = '⏳ 處理中...';
        btn.disabled = true;

        try {
            const ownerId = await getCurrentUserId();
            const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
            const { error: delErr } = await window.supabaseClient
                .from('resources')
                .update({ deleted_at: nowTs })
                .eq('url', originalUrl)
                .is('deleted_at', null);
            if (delErr) throw new Error('清理舊紀錄失敗: ' + delErr.message);

            const base = { name: newName, type: newType, url: newUrl, icon: im[newType] || '🔗', owner_id: ownerId };
            const insertPayload = buildInsertRows(base, dispatch.mode, dispatch.classIds);
            const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
            if (insertErr) throw new Error('寫入修改失敗: ' + insertErr.message);

            document.getElementById('edit-resource-modal').remove();
            window.showFlash('資源修改成功');
            await renderGlobalResourceView();
            const currentClassId = window.TeacherUI ? window.TeacherUI.getCurrentClassId() : null;
            if (currentClassId) await renderClassResources(currentClassId);
        } catch (err) {
            window.showFlash('儲存失敗：' + err.message, 'error');
            btn.innerHTML = '💾 儲存修改';
            btn.disabled = false;
        }
    }

    function openAddClassResourceModal(classId) {
        const overlayId = 'add-class-resource-modal';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:9999; backdrop-filter:blur(3px); padding:15px; box-sizing:border-box;';

        overlay.innerHTML = ''
            + '<div style="background:white; padding:30px; border-radius:16px; width:100%; max-width:500px; box-shadow:0 20px 40px rgba(0,0,0,0.3);">'
            + '<h3 style="margin-top:0; color:#1E293B; border-bottom:2px solid #F1F5F9; padding-bottom:15px; margin-bottom:20px; font-size:1.4rem;">➕ 新增本班專屬資源</h3>'
            + '<div style="display:flex; flex-wrap:wrap; gap:15px; margin-bottom:20px;">'
            + '<div style="flex:1; min-width:120px;">'
            + '<label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">類型</label>'
            + '<select id="add-class-res-type" class="form-control" style="width:100%; padding:10px; font-size:1rem; border-radius:8px;">'
            + typeOptionsHtml('drive_folder')
            + '</select></div>'
            + '<div style="flex:2; min-width:200px;">'
            + '<label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源名稱 <span style="color:#EF4444;">*</span></label>'
            + '<input type="text" id="add-class-res-name" class="form-control" style="width:100%; padding:10px; font-size:1rem; border-radius:8px;">'
            + '</div></div>'
            + '<div style="margin-bottom:30px;">'
            + '<label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源網址 <span style="color:#EF4444;">*</span></label>'
            + '<input type="url" id="add-class-res-url" class="form-control" style="width:100%; padding:10px; font-size:1rem; border-radius:8px;">'
            + '</div>'
            + '<div style="display:flex; justify-content:flex-end; gap:12px;">'
            + '<button class="btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; padding:10px 20px; border-radius:8px; cursor:pointer; font-weight:800;" onclick="document.getElementById(\'' + overlayId + '\').remove()">取消</button>'
            + '<button id="btn-save-class-res" class="btn btn-primary" style="padding:10px 24px; font-weight:900; font-size:1rem; border-radius:8px;" '
            + 'onclick="window.FeatureResource.saveNewClassResource(\'' + classId + '\')">💾 儲存並加入</button>'
            + '</div></div>';

        document.body.appendChild(overlay);
        bindTypeSelectAutoFill('add-class-res-type', 'add-class-res-name', 'add-class-res-url');
    }

    async function saveNewClassResource(classId) {
        const btn = document.getElementById('btn-save-class-res');
        const name = document.getElementById('add-class-res-name').value.trim();
        const url = document.getElementById('add-class-res-url').value.trim();
        const type = document.getElementById('add-class-res-type').value;
        const im = TYPE_ICONS;

        if (!name || !url) return window.showFlash('⚠️ 請填寫資源名稱與網址！', 'error');

        btn.innerHTML = '⏳ 處理中...';
        btn.disabled = true;

        try {
            const ownerId = await getCurrentUserId();
            const { data: existing } = await window.supabaseClient.from('resources').select('id').eq('url', url).is('deleted_at', null);
            if (existing && existing.length > 0) {
                if (!confirm('⚠️ 此網址已存在資源庫中。點擊「確定」將會更新為本班資源。')) {
                    btn.innerHTML = '💾 儲存並加入';
                    btn.disabled = false;
                    return;
                }
                const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
                await window.supabaseClient.from('resources').update({ deleted_at: nowTs }).eq('url', url).is('deleted_at', null);
            }

            const { error: insertErr } = await window.supabaseClient.from('resources').insert([{
                name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId, scope: 'class', target_class_id: classId
            }]);
            if (insertErr) throw new Error(insertErr.message);

            document.getElementById('add-class-resource-modal').remove();
            window.showFlash('本班資源建立成功');
            await renderClassResources(classId);
        } catch (err) {
            window.showFlash('儲存失敗：' + err.message, 'error');
            btn.innerHTML = '💾 儲存並加入';
            btn.disabled = false;
        }
    }

    window.addEventListener('DOMContentLoaded', function () {
        const btnClear = document.getElementById('btn-clear-form');
        if (btnClear) btnClear.style.display = 'none';

        const typeSelect = document.getElementById('res-input-type');
        if (typeSelect) {
            if (!typeSelect.querySelector('option[value="global_drive"]')) {
                const optG = document.createElement('option');
                optG.value = 'global_drive';
                optG.textContent = '🌐 全域資料夾（Google Drive 最頂層）';
                typeSelect.insertBefore(optG, typeSelect.firstChild);
            }
            if (!typeSelect.querySelector('option[value="teacher_drive"]')) {
                const opt = document.createElement('option');
                opt.value = 'teacher_drive';
                opt.textContent = '📂 老師個人資料夾（Google Drive 最頂層）';
                const after = typeSelect.querySelector('option[value="global_drive"]');
                if (after && after.nextSibling) typeSelect.insertBefore(opt, after.nextSibling);
                else typeSelect.insertBefore(opt, typeSelect.firstChild);
            }
        }
        bindTypeSelectAutoFill('res-input-type', 'res-input-name', 'res-input-url');
        if (typeSelect && (typeSelect.value === 'teacher_drive' || typeSelect.value === 'global_drive')) {
            applyDriveRootTypeToFields('res-input-type', 'res-input-name', 'res-input-url');
        }

        const btnDispatch = document.getElementById('btn-dispatch-resource');
        if (!btnDispatch) return;

        btnDispatch.onclick = async function () {
            const name = document.getElementById('res-input-name').value.trim();
            const url = document.getElementById('res-input-url').value.trim();
            const type = document.getElementById('res-input-type').value;
            const activeClasses = db.classes || [];
            const dispatch = readDispatchState('res-global', 'res-teacher', 'res-class-cb', activeClasses.length);
            const im = TYPE_ICONS;

            if (!name || !url) return window.showFlash('⚠️ 請填寫資源名稱與網址！', 'error');
            if (!dispatch.mode) return window.showFlash('⚠️ 請選擇全域、班群，或至少勾選一個班級！', 'error');

            const btn = this;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 雲端派發中...';
            btn.disabled = true;

            try {
                const ownerId = await getCurrentUserId();
                const { data: existing } = await window.supabaseClient.from('resources').select('id').eq('url', url).is('deleted_at', null);
                if (existing && existing.length > 0) {
                    if (!confirm('⚠️ 此網址已存在於資源庫中。\n點擊「確定」將會更新其名稱與派發設定。')) {
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                        return;
                    }
                    const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
                    await window.supabaseClient.from('resources').update({ deleted_at: nowTs }).eq('url', url).is('deleted_at', null);
                }

                const base = { name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId };
                const insertPayload = buildInsertRows(base, dispatch.mode, dispatch.classIds);
                const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
                if (insertErr) throw new Error(insertErr.message);

                window.showFlash('資源建立與派發成功');
                document.getElementById('res-input-name').value = '';
                document.getElementById('res-input-url').value = '';
                await renderGlobalResourceView();
            } catch (err) {
                window.showFlash('失敗：' + err.message, 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        };
    });

    return {
        renderClassResources: renderClassResources,
        renderGlobalResourceView: renderGlobalResourceView,
        fetchResourcesFromDB: fetchResourcesFromDB,
        openEditResourceModal: openEditResourceModal,
        saveEditedResource: saveEditedResource,
        openAddClassResourceModal: openAddClassResourceModal,
        saveNewClassResource: saveNewClassResource,
        syncDispatchMode: syncDispatchMode,
        resourceAppliesToClass: resourceAppliesToClass,
        mergeResourcesByUrl: mergeResourcesByUrl,
        fetchClassStaffUserIds: fetchClassStaffUserIds,
        getTeacherPersonalDriveUrl: getTeacherPersonalDriveUrl,
        getTeacherPersonalDriveFolderId: getTeacherPersonalDriveFolderId,
        getGlobalDriveFolderUrl: getGlobalDriveFolderUrl,
        applyTeacherDriveToFields: applyTeacherDriveToFields,
        applyDriveRootTypeToFields: applyDriveRootTypeToFields,
        ensureAndBindTeacherPersonalDrive: ensureAndBindTeacherPersonalDrive,
        persistTeacherDriveRoot: persistTeacherDriveRoot,
        deleteResourceGroup: async function (resUrl) {
            if (!confirm('⚠️ 確定要刪除此資源嗎？\n(這將會把該資源從所有相關範圍移除)')) return;
            try {
                const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
                const { error } = await window.supabaseClient.from('resources').update({ deleted_at: nowTs }).eq('url', resUrl).is('deleted_at', null);
                if (error) throw error;
                window.showFlash('資源已成功刪除');
                await renderGlobalResourceView();
                const currentClassId = window.TeacherUI ? window.TeacherUI.getCurrentClassId() : null;
                if (currentClassId) await renderClassResources(currentClassId);
            } catch (err) {
                window.showFlash('刪除失敗：' + err.message, 'error');
            }
        }
    };
})();

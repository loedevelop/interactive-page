/**
 * 📂 檔案路徑：020_js_core/persona-routing.js
 * 🌟 v1.1 情境身分制：登入 persona 掃描、跳轉與切換（email 關聯 fallback）
 */

(function() {
    console.log('[Persona] persona-routing.js v9 已載入');

    var LOGON_BUILD = 'v9';

    function buildLoginUrl(clearCache) {
        var path = window.location.pathname;
        var prefix = './';
        if (path.indexOf('/teacher/') >= 0 ||
            path.indexOf('/student/') >= 0 ||
            path.indexOf('/admin/') >= 0 ||
            path.indexOf('/parent/') >= 0) {
            prefix = '../';
        }
        var parts = ['build=' + LOGON_BUILD, '_=' + String(Date.now())];
        if (clearCache) {
            parts.unshift('clear=true');
        }
        return prefix + 'index.html?' + parts.join('&');
    }

    window.buildLoginUrl = buildLoginUrl;

    function getPersonaCacheKey(userId) {
        return `LogOnEnglish_PersonaCache_${userId}`;
    }

    function readPersonaCache(userId) {
        try {
            const raw = localStorage.getItem(getPersonaCacheKey(userId));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function writePersonaCache(userId, profile, personas) {
        if (!userId || !profile || !personas) return;
        localStorage.setItem(getPersonaCacheKey(userId), JSON.stringify({
            profile: {
                name: profile.name,
                email: profile.email,
                role: profile.role,
                default_role: profile.default_role
            },
            personas: personas,
            cachedAt: Date.now()
        }));
        localStorage.setItem(getPersonaCountKey(userId), String(personas.length));
    }

    function getPersonaCountKey(userId) {
        return `LogOnEnglish_PersonaCount_${userId}`;
    }

    function getCachedPersonaCount(userId) {
        const countStr = localStorage.getItem(getPersonaCountKey(userId));
        if (countStr) {
            const n = parseInt(countStr, 10);
            if (!isNaN(n)) return n;
        }
        const cached = readPersonaCache(userId);
        if (cached && cached.personas) {
            return cached.personas.length;
        }
        return null;
    }

    function getSessionContextForSwitch() {
        let authUserId = null;
        let email = '';
        let currentType = null;
        const sessionStr = localStorage.getItem('LogOnEnglish_Session');
        if (!sessionStr) {
            return { authUserId: authUserId, email: email, currentType: currentType };
        }
        try {
            const session = JSON.parse(sessionStr);
            authUserId = session.id;
            email = session.email ? session.email : '';
            if (session.activeContext && session.activeContext.role) {
                currentType = session.activeContext.role;
            } else if (session.role) {
                currentType = session.role;
            }
        } catch (e) {
            console.warn('[Persona] session parse failed:', e);
        }
        return { authUserId: authUserId, email: email, currentType: currentType };
    }

    function resolveDefaultPersonaType(authUserId, personas, currentType) {
        let defaultType = currentType;
        if (!defaultType) {
            defaultType = localStorage.getItem(getLastPersonaKey(authUserId));
        }
        if (!defaultType || !personas.find(function(p) { return p.type === defaultType; })) {
            defaultType = personas[0].type;
        }
        return defaultType;
    }

    async function refreshPersonaCacheInBackground(client, authUserId, email, pickerOptions) {
        try {
            const profileResult = await resolveProfileForAuth(client, authUserId, email);
            if (profileResult.error || !profileResult.profile) return;

            const scanResult = await scanPersonas(client, authUserId, email, profileResult.profile);
            const personas = scanResult.personas;
            refreshSwitchPersonaButtons();

            if (pickerOptions && isPersonaPickerOpen() && personas.length > 1) {
                refreshPersonaPicker({
                    uid: authUserId,
                    profile: profileResult.profile,
                    personas: personas,
                    defaultType: resolveDefaultPersonaType(authUserId, personas, pickerOptions.currentType),
                    currentType: pickerOptions.currentType
                });
            }
        } catch (e) {
            console.warn('[Persona] background persona refresh failed:', e);
        }
    }

    async function switchPersonaWithFullScan(client, authUserId, email, currentType) {
        const { data: authData, error: authError } = await client.auth.getUser();
        if (authError || !authData.user) return;

        authUserId = authData.user.id;
        email = authData.user.email ? authData.user.email : email;

        const profileResult = await resolveProfileForAuth(client, authUserId, email);
        if (profileResult.error || !profileResult.profile) return;

        const scanResult = await scanPersonas(client, authUserId, email, profileResult.profile);
        const personas = scanResult.personas;

        if (personas.length <= 1) {
            setSwitchPersonaButtonsVisible(false);
            return;
        }

        const basePath = getBasePath();

        if (personas.length === 2) {
            const target = findAlternatePersona(personas, currentType);
            if (target) {
                executeJump(authUserId, profileResult.profile, target, basePath);
            }
            return;
        }

        openPersonaPicker({
            uid: authUserId,
            profile: profileResult.profile,
            personas: personas,
            defaultType: resolveDefaultPersonaType(authUserId, personas, currentType),
            currentType: currentType,
            title: '切換身分',
            basePath: basePath
        });
    }

    function setSwitchPersonaButtonsVisible(show) {
        document.querySelectorAll('.js-switch-persona').forEach(function(btn) {
            btn.style.display = show ? 'inline-block' : 'none';
        });
    }

    async function refreshSwitchPersonaButtons() {
        const buttons = document.querySelectorAll('.js-switch-persona');
        if (buttons.length === 0) return;

        let userId = null;
        let email = '';
        const sessionStr = localStorage.getItem('LogOnEnglish_Session');
        if (sessionStr) {
            try {
                const session = JSON.parse(sessionStr);
                userId = session.id;
                email = session.email ? session.email : '';
            } catch (e) {}
        }

        if (userId) {
            const cachedCount = getCachedPersonaCount(userId);
            if (cachedCount !== null) {
                setSwitchPersonaButtonsVisible(cachedCount > 1);
                return;
            }
        }

        const client = window.supabaseClient;
        if (!client || !userId) {
            setSwitchPersonaButtonsVisible(false);
            return;
        }

        try {
            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError || !authData.user) {
                setSwitchPersonaButtonsVisible(false);
                return;
            }

            const profileResult = await resolveProfileForAuth(client, authData.user.id, email);
            if (profileResult.error || !profileResult.profile) {
                setSwitchPersonaButtonsVisible(false);
                return;
            }

            const scanResult = await scanPersonas(client, authData.user.id, email, profileResult.profile);
            setSwitchPersonaButtonsVisible(scanResult.personas.length > 1);
        } catch (e) {
            console.warn('[Persona] refreshSwitchPersonaButtons failed:', e);
            setSwitchPersonaButtonsVisible(false);
        }
    }

    let _switchPersonaBusy = false;
    function checkRole(roleData, targetRole) {
        if (!roleData) return false;
        const target = targetRole.toLowerCase();
        if (Array.isArray(roleData)) {
            return roleData.some(r => String(r).toLowerCase().trim() === target);
        }
        const roleStr = String(roleData).toLowerCase().trim();
        return roleStr === target || roleStr.split(/[\s,]+/).includes(target);
    }

    function getLastClassKey(userId, personaType) {
        return `LogOnEnglish_LastClass_${userId}_${personaType}`;
    }

    function getLastPersonaKey(userId) {
        return `LogOnEnglish_LastPersona_${userId}`;
    }

    function resolvePersonaFromLast(userId, personas) {
        let defaultType = localStorage.getItem(getLastPersonaKey(userId));
        if (!defaultType || !personas.find(function(p) { return p.type === defaultType; })) {
            defaultType = personas[0].type;
        }
        return personas.find(function(p) { return p.type === defaultType; });
    }

    function findAlternatePersona(personas, currentType) {
        if (!personas || personas.length !== 2) return null;
        if (currentType) {
            const other = personas.find(function(p) { return p.type !== currentType; });
            if (other) return other;
        }
        return personas[1];
    }

    function buildResetPasswordRedirectUrl() {
        var origin = window.location.origin;
        var path = window.location.pathname;
        if (path.indexOf('/teacher/') >= 0) {
            return origin + path.replace(/\/teacher\/[^/]*$/, '/reset-password.html');
        }
        if (path.indexOf('/student/') >= 0) {
            return origin + path.replace(/\/student\/[^/]*$/, '/reset-password.html');
        }
        if (path.indexOf('/admin/') >= 0) {
            return origin + path.replace(/\/admin\/[^/]*$/, '/reset-password.html');
        }
        var dir = path.substring(0, path.lastIndexOf('/') + 1);
        return origin + dir + 'reset-password.html';
    }

    window.buildResetPasswordRedirectUrl = buildResetPasswordRedirectUrl;

    function getBasePath() {
        const path = window.location.pathname;
        if (path.indexOf('/teacher/') >= 0 ||
            path.indexOf('/student/') >= 0 ||
            path.indexOf('/admin/') >= 0 ||
            path.indexOf('/parent/') >= 0) {
            return '../';
        }
        return './';
    }

    let _pickerState = null;

    function ensurePickerStyles() {
        if (document.getElementById('logon-persona-picker-styles')) return;
        const style = document.createElement('style');
        style.id = 'logon-persona-picker-styles';
        style.textContent = [
            '.logon-persona-picker-overlay {',
            '  position: fixed; inset: 0; z-index: 99999;',
            '  background: rgba(0, 0, 0, 0.45);',
            '  display: flex; align-items: center; justify-content: center;',
            '  backdrop-filter: blur(2px);',
            '}',
            '.logon-persona-picker-box {',
            '  background: #fff; border-radius: 16px; padding: 24px;',
            '  width: 90%; max-width: 320px;',
            '  box-shadow: 0 12px 40px rgba(0,0,0,0.2);',
            '}',
            '.logon-persona-picker-title {',
            '  font-size: 1.2rem; font-weight: 900; text-align: center;',
            '  margin-bottom: 16px; color: #4A4A4A;',
            '}',
            '.logon-persona-picker-list { display: flex; flex-direction: column; gap: 10px; }',
            '.logon-persona-picker-item {',
            '  width: 100%; padding: 14px; border: 2px solid #EEE; border-radius: 12px;',
            '  background: #FAFAFA; font-size: 1.05rem; font-weight: 800;',
            '  color: #4A4A4A; cursor: pointer;',
            '  transition: border-color 0.15s, background 0.15s;',
            '}',
            '.logon-persona-picker-item:hover { border-color: #FF8C00; background: #FFF8E1; }',
            '.logon-persona-picker-item.selected {',
            '  border-color: #FF8C00; background: #FFF8E1;',
            '  box-shadow: 0 0 0 2px rgba(255, 140, 0, 0.25);',
            '}',
            '.logon-persona-picker-loading {',
            '  text-align: center; color: #94A3B8; font-weight: 800; padding: 12px;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function isPersonaPickerOpen() {
        return !!_pickerState;
    }

    function closePersonaPicker(callCancel) {
        const shouldCallCancel = callCancel !== false;
        const onCancel = _pickerState ? _pickerState.onCancel : null;
        if (_pickerState && _pickerState.keyHandler) {
            document.removeEventListener('keydown', _pickerState.keyHandler);
        }
        _pickerState = null;
        const el = document.getElementById('logon-persona-picker');
        if (el) el.remove();
        if (shouldCallCancel && onCancel) onCancel();
    }

    function bindPersonaPickerKeys(state, personas) {
        if (state.keyHandler) {
            document.removeEventListener('keydown', state.keyHandler);
        }
        state.keyHandler = function(e) {
            if (e.key === 'Escape') {
                closePersonaPicker();
                return;
            }
            if (state.loading) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmPersonaPicker();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.selectedIndex = (state.selectedIndex + 1) % personas.length;
                renderPersonaSelection(state);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.selectedIndex = (state.selectedIndex - 1 + personas.length) % personas.length;
                renderPersonaSelection(state);
            }
        };
        document.addEventListener('keydown', state.keyHandler);
    }

    function renderPersonaSelection(state) {
        const overlay = document.getElementById('logon-persona-picker');
        if (!overlay) return;
        overlay.querySelectorAll('.logon-persona-picker-item').forEach(function(btn, idx) {
            if (idx === state.selectedIndex) btn.classList.add('selected');
            else btn.classList.remove('selected');
        });
    }

    function buildPersonaPickerButtons(state, list, personas) {
        list.innerHTML = '';
        personas.forEach(function(p, idx) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'logon-persona-picker-item';
            btn.textContent = p.label;
            btn.addEventListener('click', function() {
                state.selectedIndex = idx;
                confirmPersonaPicker();
            });
            list.appendChild(btn);
        });
        state.loading = false;
        renderPersonaSelection(state);
        bindPersonaPickerKeys(state, personas);
    }

    function refreshPersonaPicker(options) {
        if (!_pickerState) return;
        const state = _pickerState;
        const overlay = document.getElementById('logon-persona-picker');
        if (!overlay) return;
        const list = overlay.querySelector('.logon-persona-picker-list');
        if (!list) return;

        state.uid = options.uid;
        state.profile = options.profile;
        state.personas = options.personas;

        if (options.defaultType) {
            const defaultIdx = options.personas.findIndex(function(p) { return p.type === options.defaultType; });
            if (defaultIdx >= 0) state.selectedIndex = defaultIdx;
        }
        if (options.currentType !== undefined) {
            state.currentType = options.currentType;
        }

        buildPersonaPickerButtons(state, list, options.personas);
    }

    function confirmPersonaPicker() {
        if (!_pickerState) return;
        const state = _pickerState;
        if (state.loading) return;
        const selected = state.personas[state.selectedIndex];
        if (!selected) return;

        if (state.currentType && selected.type === state.currentType) {
            closePersonaPicker(false);
            return;
        }

        document.removeEventListener('keydown', state.keyHandler);
        const uid = state.uid;
        const profile = state.profile;
        const basePath = state.basePath;
        _pickerState = null;
        const el = document.getElementById('logon-persona-picker');
        if (el) el.remove();
        executeJump(uid, profile, selected, basePath);
    }

    function openPersonaPicker(options) {
        if (_pickerState) {
            closePersonaPicker(false);
        }

        const uid = options.uid;
        const profile = options.profile;
        const personas = options.personas;
        const title = options.title ? options.title : '選擇身分';
        const onCancel = options.onCancel ? options.onCancel : null;
        const basePath = options.basePath ? options.basePath : getBasePath();
        const currentType = options.currentType ? options.currentType : null;

        let selectedIndex = 0;
        if (options.defaultType) {
            const defaultIdx = personas.findIndex(function(p) { return p.type === options.defaultType; });
            if (defaultIdx >= 0) selectedIndex = defaultIdx;
        }

        ensurePickerStyles();

        const overlay = document.createElement('div');
        overlay.id = 'logon-persona-picker';
        overlay.className = 'logon-persona-picker-overlay';
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closePersonaPicker();
        });

        const box = document.createElement('div');
        box.className = 'logon-persona-picker-box';
        box.addEventListener('click', function(e) { e.stopPropagation(); });

        const titleEl = document.createElement('div');
        titleEl.className = 'logon-persona-picker-title';
        titleEl.textContent = title;
        box.appendChild(titleEl);

        const list = document.createElement('div');
        list.className = 'logon-persona-picker-list';

        const state = {
            uid: uid,
            profile: profile,
            personas: personas ? personas : [],
            basePath: basePath,
            onCancel: onCancel,
            currentType: currentType,
            selectedIndex: selectedIndex,
            loading: !!options.loading,
            keyHandler: null
        };

        box.appendChild(list);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        _pickerState = state;

        if (options.loading || !personas || personas.length === 0) {
            const loadingEl = document.createElement('div');
            loadingEl.className = 'logon-persona-picker-loading';
            loadingEl.textContent = '載入中...';
            list.appendChild(loadingEl);
            bindPersonaPickerKeys(state, []);
        } else {
            buildPersonaPickerButtons(state, list, personas);
        }
    }

    async function getLinkedUserIds(client, authUserId, email) {
        const ids = new Set([authUserId]);
        if (email) {
            const normalized = email.trim().toLowerCase();
            const { data, error } = await client
                .from('profiles')
                .select('id')
                .eq('email', normalized)
                .is('deleted_at', null);
            if (error) {
                console.error('[Persona] profiles lookup failed:', error.message);
            } else if (data) {
                data.forEach(p => ids.add(p.id));
            }
        }
        return Array.from(ids);
    }

    function mapStaffRows(staffRows, classes) {
        const classMap = {};
        if (classes) {
            classes.forEach(c => { classMap[c.id] = c; });
        }
        const seen = new Set();
        const rows = [];
        staffRows.forEach(r => {
            const key = `${r.class_id}_${r.staff_role}`;
            if (seen.has(key)) return;
            seen.add(key);
            rows.push({
                class_id: r.class_id,
                staff_role: r.staff_role,
                classes: classMap[r.class_id]
                    ? { id: classMap[r.class_id].id, name: classMap[r.class_id].name }
                    : null
            });
        });
        return rows;
    }

    async function fetchStaffRowsByUserIds(client, userIds) {
        const { data: staffRows, error } = await client
            .from('class_staff')
            .select('class_id, staff_role, user_id')
            .in('user_id', userIds)
            .is('deleted_at', null);

        if (error) {
            console.error('[Persona] class_staff by user_id failed:', error.message);
            return { rows: [], error: error.message };
        }
        if (!staffRows || staffRows.length === 0) {
            return { rows: [], error: null };
        }

        const classIds = [...new Set(staffRows.map(r => r.class_id))];
        const { data: classes, error: classErr } = await client
            .from('classes')
            .select('id, name')
            .in('id', classIds)
            .is('deleted_at', null);

        if (classErr) {
            console.error('[Persona] classes lookup for staff failed:', classErr.message);
        }

        return { rows: mapStaffRows(staffRows, classes), error: null };
    }

    async function fetchStaffRowsByEmail(client, email) {
        const normalized = email.trim().toLowerCase();
        const { data: staffRows, error } = await client
            .from('class_staff')
            .select('class_id, staff_role, user_id, profiles!inner(id, email)')
            .eq('profiles.email', normalized)
            .is('deleted_at', null);

        if (error) {
            console.error('[Persona] class_staff by email failed:', error.message);
            return { rows: [], error: error.message };
        }
        if (!staffRows || staffRows.length === 0) {
            return { rows: [], error: null };
        }

        const classIds = [...new Set(staffRows.map(r => r.class_id))];
        const { data: classes, error: classErr } = await client
            .from('classes')
            .select('id, name')
            .in('id', classIds)
            .is('deleted_at', null);

        if (classErr) {
            console.error('[Persona] classes lookup for staff failed:', classErr.message);
        }

        return { rows: mapStaffRows(staffRows, classes), error: null };
    }

    async function fetchStaffRows(client, userIds, email) {
        let result = await fetchStaffRowsByUserIds(client, userIds);
        if (result.rows.length === 0 && email) {
            console.warn('[Persona] user_id 查無教職員紀錄，改以 profile email 查詢');
            result = await fetchStaffRowsByEmail(client, email);
        }
        return result;
    }

    function mapStudentRows(enrollRows, classes) {
        const classMap = {};
        if (classes) {
            classes.forEach(c => { classMap[c.id] = c; });
        }
        const seen = new Set();
        const rows = [];
        enrollRows.forEach(r => {
            if (seen.has(r.class_id)) return;
            seen.add(r.class_id);
            rows.push({
                class_id: r.class_id,
                classes: classMap[r.class_id]
                    ? { id: classMap[r.class_id].id, name: classMap[r.class_id].name }
                    : null
            });
        });
        return rows;
    }

    async function fetchStudentRowsByUserIds(client, userIds) {
        const { data: enrollRows, error } = await client
            .from('student_enrollments')
            .select('class_id, user_id')
            .in('user_id', userIds)
            .is('deleted_at', null);

        if (error) {
            console.error('[Persona] student_enrollments by user_id failed:', error.message);
            return { rows: [], error: error.message };
        }
        if (!enrollRows || enrollRows.length === 0) {
            return { rows: [], error: null };
        }

        const classIds = [...new Set(enrollRows.map(r => r.class_id))];
        const { data: classes, error: classErr } = await client
            .from('classes')
            .select('id, name')
            .in('id', classIds)
            .is('deleted_at', null);

        if (classErr) {
            console.error('[Persona] classes lookup for student failed:', classErr.message);
        }

        return { rows: mapStudentRows(enrollRows, classes), error: null };
    }

    async function fetchStudentRowsByEmail(client, email) {
        const normalized = email.trim().toLowerCase();
        const { data: enrollRows, error } = await client
            .from('student_enrollments')
            .select('class_id, user_id, profiles!inner(id, email)')
            .eq('profiles.email', normalized)
            .is('deleted_at', null);

        if (error) {
            console.error('[Persona] student_enrollments by email failed:', error.message);
            return { rows: [], error: error.message };
        }
        if (!enrollRows || enrollRows.length === 0) {
            return { rows: [], error: null };
        }

        const classIds = [...new Set(enrollRows.map(r => r.class_id))];
        const { data: classes, error: classErr } = await client
            .from('classes')
            .select('id, name')
            .in('id', classIds)
            .is('deleted_at', null);

        if (classErr) {
            console.error('[Persona] classes lookup for student failed:', classErr.message);
        }

        return { rows: mapStudentRows(enrollRows, classes), error: null };
    }

    async function fetchStudentRows(client, userIds, email) {
        let result = await fetchStudentRowsByUserIds(client, userIds);
        if (result.rows.length === 0 && email) {
            console.warn('[Persona] user_id 查無學籍，改以 profile email 查詢');
            result = await fetchStudentRowsByEmail(client, email);
        }
        return result;
    }

    async function fetchParentRows(client, authUserId) {
        const { data, error } = await client
            .from('parent_child_mappings')
            .select('child_user_id')
            .eq('parent_user_id', authUserId);

        if (error) {
            console.error('[Persona] parent_child_mappings query failed:', error.message);
            return [];
        }
        return data ? data : [];
    }

    function buildPersonas(profile, staffData, studentData, parentData, isAdmin) {
        const personas = [];

        if (isAdmin) {
            personas.push({ type: 'admin', label: '👑 管理', folder: 'admin', data: [] });
        }

        if (staffData.length > 0) {
            personas.push({ type: 'teacher', label: '👨‍🏫 教職員', folder: 'teacher', data: staffData });
        } else if (!isAdmin && (
            checkRole(profile.role, 'teacher') ||
            checkRole(profile.default_role, 'teacher') ||
            checkRole(profile.default_role, 'staff')
        )) {
            personas.push({ type: 'teacher', label: '👨‍🏫 教職員', folder: 'teacher', data: [] });
        }

        if (studentData.length > 0) {
            personas.push({ type: 'student', label: '🎒 學生', folder: 'student', data: studentData });
        } else if (!isAdmin && personas.length === 0) {
            personas.push({ type: 'student', label: '🎒 學生', folder: 'student', data: [] });
        }

        if (parentData.length > 0) {
            personas.push({ type: 'parent', label: '👨‍👩‍👧 家長', folder: 'parent', data: parentData });
        }

        return personas;
    }

    async function resolveProfileForAuth(client, authUserId, email) {
        let { data: profile } = await client
            .from('profiles')
            .select('*')
            .eq('id', authUserId)
            .is('deleted_at', null)
            .single();

        if (!profile) {
            const { data: existingProfiles } = await client
                .from('profiles')
                .select('*')
                .eq('email', email.trim().toLowerCase())
                .is('deleted_at', null);

            if (existingProfiles && existingProfiles.length > 0) {
                let oldProfile = existingProfiles.find(p =>
                    checkRole(p.role, 'teacher') || checkRole(p.default_role, 'teacher')
                );
                if (!oldProfile) {
                    oldProfile = existingProfiles[0];
                }
                const { data: newProfile, error: insertErr } = await client
                    .from('profiles')
                    .insert([{
                        id: authUserId,
                        email: email.trim().toLowerCase(),
                        name: oldProfile.name,
                        role: oldProfile.role,
                        default_role: oldProfile.default_role
                    }])
                    .select()
                    .single();
                profile = insertErr ? { ...oldProfile, id: authUserId } : newProfile;
            } else {
                const { data: newProfile, error: insertErr } = await client
                    .from('profiles')
                    .insert([{
                        id: authUserId,
                        email: email.trim().toLowerCase(),
                        name: email.split('@')[0],
                        role: 'student'
                    }])
                    .select()
                    .single();
                if (insertErr) return { profile: null, error: '初始化檔案失敗。' };
                profile = newProfile;
            }
        }

        return { profile, error: null };
    }

    async function scanPersonas(client, authUserId, email, profile) {
        const linkedIds = await getLinkedUserIds(client, authUserId, email);
        if (linkedIds.length > 1) {
            console.warn('[Persona] 偵測到多個 profile id 關聯同一 email:', linkedIds);
        }

        const normalizedEmail = email ? email.trim().toLowerCase() : '';
        const [staffResult, studentResult, parentData] = await Promise.all([
            fetchStaffRows(client, linkedIds, normalizedEmail),
            fetchStudentRows(client, linkedIds, normalizedEmail),
            fetchParentRows(client, authUserId)
        ]);

        const isAdmin = checkRole(profile.role, 'admin') || checkRole(profile.default_role, 'admin');
        const personas = buildPersonas(profile, staffResult.rows, studentResult.rows, parentData, isAdmin);

        let warning = null;
        if (staffResult.rows.length > 0 && studentResult.error) {
            warning = '無法讀取學生選課資料，請稍後再試或聯絡管理員。';
        }

        console.log('[Persona] 掃描完成:', {
            linkedIds: linkedIds,
            staffClasses: staffResult.rows.length,
            studentClasses: studentResult.rows.length,
            personaCount: personas.length,
            personaTypes: personas.map(p => p.type)
        });

        writePersonaCache(authUserId, profile, personas);

        return {
            personas,
            warning,
            staffError: staffResult.error,
            studentError: studentResult.error,
            linkedIds
        };
    }

    function executeJump(userId, profile, selectedPersona, basePath) {
        const prefix = basePath ? basePath : getBasePath();
        let activeClassId = null;
        let enrollmentsList = [];

        if (selectedPersona.data && selectedPersona.data.length > 0) {
            enrollmentsList = selectedPersona.data.map(e => {
                let cName = '未命名班級';
                if (e.classes) {
                    cName = Array.isArray(e.classes)
                        ? (e.classes[0] ? e.classes[0].name : cName)
                        : (e.classes.name ? e.classes.name : cName);
                }
                return {
                    id: e.class_id,
                    name: cName,
                    staff_role: e.staff_role ? e.staff_role : null
                };
            });

            const savedLastClassId = localStorage.getItem(getLastClassKey(userId, selectedPersona.type));
            const matchedClass = enrollmentsList.find(c => c.id === savedLastClassId);

            if (matchedClass) {
                activeClassId = matchedClass.id;
            } else if (enrollmentsList.length > 0) {
                activeClassId = enrollmentsList[0].id;
                localStorage.setItem(getLastClassKey(userId, selectedPersona.type), activeClassId);
            }
        }

        const activeEnrollment = enrollmentsList.find(c => c.id === activeClassId);
        const activeStaffRole = activeEnrollment ? activeEnrollment.staff_role : null;

        if (selectedPersona.type === 'student') {
            localStorage.removeItem('activeRole');
        }

        const sessionData = {
            id: userId,
            username: profile.name ? profile.name : profile.email,
            email: profile.email,
            role: selectedPersona.type,
            folder: selectedPersona.folder,
            class_id: activeClassId,
            enrollments: enrollmentsList,
            activeContext: {
                role: selectedPersona.type,
                classId: activeClassId,
                staffRole: activeStaffRole
            },
            loginTime: new Date().toISOString()
        };

        localStorage.setItem('LogOnEnglish_Session', JSON.stringify(sessionData));
        localStorage.setItem(getLastPersonaKey(userId), selectedPersona.type);
        if (activeClassId) {
            localStorage.setItem('activeClassId', activeClassId);
        }
        if (activeStaffRole) {
            localStorage.setItem('activeRole', activeStaffRole);
        }
        sessionStorage.setItem('LogOn_Current_User_Id', userId);

        if (selectedPersona.type === 'student' && activeClassId) {
            sessionStorage.setItem('currentClassId', activeClassId);
        }

        window.location.replace(`${prefix}${selectedPersona.folder}/index.html`);
    }

    async function switchPersona() {
        if (_switchPersonaBusy) return;
        _switchPersonaBusy = true;

        try {
            const client = window.supabaseClient;
            if (!client) {
                console.warn('[Persona] supabaseClient 未就緒');
                return;
            }

            const ctx = getSessionContextForSwitch();
            let authUserId = ctx.authUserId;
            let email = ctx.email;
            const currentType = ctx.currentType;

            if (!authUserId) {
                await switchPersonaWithFullScan(client, null, email, currentType);
                return;
            }

            const basePath = getBasePath();
            const cached = readPersonaCache(authUserId);
            if (cached && cached.profile && cached.personas && cached.personas.length > 1) {
                const personas = cached.personas;
                if (personas.length === 2) {
                    const target = findAlternatePersona(personas, currentType);
                    if (target) {
                        executeJump(authUserId, cached.profile, target, basePath);
                        refreshPersonaCacheInBackground(client, authUserId, email, null);
                        return;
                    }
                } else {
                    openPersonaPicker({
                        uid: authUserId,
                        profile: cached.profile,
                        personas: personas,
                        defaultType: resolveDefaultPersonaType(authUserId, personas, currentType),
                        currentType: currentType,
                        title: '切換身分',
                        basePath: basePath
                    });
                    refreshPersonaCacheInBackground(client, authUserId, email, { currentType: currentType });
                    return;
                }
            }

            await switchPersonaWithFullScan(client, authUserId, email, currentType);
        } finally {
            _switchPersonaBusy = false;
        }
    }

    window.PersonaRouting = {
        checkRole,
        getLastClassKey,
        getLastPersonaKey,
        getBasePath,
        getLinkedUserIds,
        fetchStaffRows,
        fetchStudentRows,
        resolveProfileForAuth,
        scanPersonas,
        buildPersonas,
        executeJump,
        buildLoginUrl,
        buildResetPasswordRedirectUrl,
        resolvePersonaFromLast,
        findAlternatePersona,
        openPersonaPicker,
        closePersonaPicker,
        refreshPersonaPicker,
        isPersonaPickerOpen,
        switchPersona,
        refreshSwitchPersonaButtons
    };

    window.switchPersona = switchPersona;

    function initSwitchPersonaButtons() {
        if (!document.getElementById('logon-switch-persona-default-style')) {
            const style = document.createElement('style');
            style.id = 'logon-switch-persona-default-style';
            style.textContent = '.js-switch-persona { display: none; }';
            document.head.appendChild(style);
        }
        refreshSwitchPersonaButtons();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSwitchPersonaButtons);
    } else {
        initSwitchPersonaButtons();
    }
})();

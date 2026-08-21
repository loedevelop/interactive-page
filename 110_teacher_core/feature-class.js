/**
 * 📂 檔案路徑：110_teacher_core/feature-class.js
 * 🌟 v8.9 SaaS 降級支援版：實作建立班級時自動生成 Google Drive 公海收件匣
 */
console.log("💡💡💡 FeatureClass v8.9 載入！(整合雲端自動建檔機制)");

window.FeatureClass = (() => {
    const db = window.TeacherDB;
    const TPL = window.ClassTemplates; 

    // --- 私有工具函式 ---
    function toLocalISODate(dateObj) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function getTaiwanTodayString() {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', { 
                timeZone: 'Asia/Taipei', 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit' 
            });
            return formatter.format(new Date()); 
        } catch(e) {
            return toLocalISODate(new Date()); 
        }
    }

    function normalizeDateString(dStr) {
        if (!dStr) return '';
        if (dStr.includes('-')) {
            const parts = dStr.split('-');
            if (parts[0].length === 4) return dStr; 
        }
        if (dStr.includes('/')) {
            const parts = dStr.split('/');
            if (parts.length === 3) {
                if (parts[2].length === 4) return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
                if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
            }
        }
        const d = new Date(dStr);
        if (!isNaN(d.getTime())) return toLocalISODate(d);
        return dStr;
    }

    function parseClassRawData(clsOrRaw) {
        let raw = clsOrRaw;
        if (clsOrRaw && (clsOrRaw.raw_data != null || clsOrRaw.rawData != null)) {
            raw = clsOrRaw.raw_data != null ? clsOrRaw.raw_data : clsOrRaw.rawData;
        }
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = {}; }
        }
        return raw || {};
    }

    async function syncClassDriveFolderName(classRecord, displayName, startDateStr) {
        const raw = parseClassRawData(classRecord);
        const folderId = raw.drive_folder_id || raw.class_folder_id;
        if (!folderId) return null;
        if (!window.ApiService || typeof window.ApiService.renameGASFolder !== 'function') {
            throw new Error('雲端重新命名 API 未就緒');
        }
        if (!window.UtilsDate || typeof window.UtilsDate.buildClassDriveFolderName !== 'function') {
            throw new Error('命名工具未載入');
        }
        const targetName = window.UtilsDate.buildClassDriveFolderName(displayName, startDateStr);
        return window.ApiService.renameGASFolder(folderId, targetName);
    }

    function generateDates(startStr, endStr, meetDaysArray) {
        if (!startStr || !endStr || !meetDaysArray || meetDaysArray.length === 0) return [];
        
        const dates = [];
        const [sy, sm, sd] = startStr.split('-');
        const [ey, em, ed] = endStr.split('-');
        
        let curr = new Date(sy, sm - 1, sd);
        const end = new Date(ey, em - 1, ed);
        end.setHours(23, 59, 59, 999);
        
        while (curr <= end) {
            if (meetDaysArray.includes(curr.getDay())) dates.push(toLocalISODate(curr));
            curr.setDate(curr.getDate() + 1);
        }
        return dates;
    }

    function getWeekStartStr(dateStr, weekStartDay = 'sunday') {
        if (!dateStr) return '';
        
        const [y, m, d] = dateStr.split('-');
        const dt = new Date(y, m - 1, d);
        let day = dt.getDay(); 

        if (weekStartDay === 'monday') {
            let diff = day === 0 ? 6 : day - 1;
            dt.setDate(dt.getDate() - diff);
        } else {
            dt.setDate(dt.getDate() - day);
        }
        return toLocalISODate(dt);
    }

    const DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

    // --- 核心班級邏輯 ---
    async function updateClassContent(classId) {
        if (!classId) return;
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;
        
        const titleEl = document.getElementById('current-class-title');
        if (titleEl) titleEl.textContent = `${cls.name}`; 

        if (document.getElementById('class-start-date')) document.getElementById('class-start-date').value = cls.startDate || cls.start_date || "";
        if (document.getElementById('class-end-date')) document.getElementById('class-end-date').value = cls.endDate || cls.end_date || "";
        
        const mDays = cls.meetDays || cls.meet_days || [];
        document.querySelectorAll('#class-meet-days input').forEach(cb => { cb.checked = mDays.includes(parseInt(cb.value)); });

        const savedMode = cls.calcMode || cls.calc_mode || 'single';
        document.querySelectorAll('input[name="calc_mode"]').forEach(radio => { radio.checked = (radio.value === savedMode); });

        let raw = cls.raw_data || cls.rawData || {};
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = {}; } }
        
        const weekStart = raw.week_start_day || 'sunday';
        const weekRadios = document.getElementsByName('week_start_day');
        for (let i = 0; i < weekRadios.length; i++) { weekRadios[i].checked = (weekRadios[i].value === weekStart); }

        if (window.FeatureMaterialPublish && typeof window.FeatureMaterialPublish.mountIntoSettings === 'function') {
            window.FeatureMaterialPublish.mountIntoSettings(classId);
        }
    }

    function renderActiveClassList() {
        const container = document.getElementById('manage-class-list-container');
        if (!container) return;

        container.innerHTML = '';
        if (!db.classes || db.classes.length === 0) {
            container.innerHTML = '<p style="color:#94A3B8; font-weight: bold; padding: 20px;">目前無任何班級。</p>';
            return;
        }

        db.classes.forEach(cls => {
            const canManage = cls.staff_role === 'admin' || cls.staff_role === 'primary_teacher';
            const item = document.createElement('div');
            item.className = 'manage-list-item';
            item.innerHTML = TPL.getClassManagerItemHtml(cls, canManage);
            container.appendChild(item);
        });
    }

    function renderClassManager(options) {
        options = options || {};
        renderActiveClassList();

        if (window.FeatureArchivedClasses && typeof window.FeatureArchivedClasses.renderSection === 'function') {
            window.FeatureArchivedClasses.renderSection({
                force: !!options.forceArchived,
                background: options.forceArchived !== true
            });
        }
    }

    function closeArchiveConfirm() {
        if (window.ModalOverlay) window.ModalOverlay.close('class-archive-modal');
        else {
            const overlay = document.getElementById('class-archive-modal');
            if (overlay) overlay.remove();
        }
    }

    function openArchiveConfirm(classId) {
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;

        closeArchiveConfirm();
        if (!window.ModalOverlay) {
            window.showFlash('ModalOverlay 未載入', 'error');
            return;
        }

        window.ModalOverlay.open({
            id: 'class-archive-modal',
            tier: 'A',
            contentHtml: TPL.getClassArchiveModalHtml(cls, 'class-archive-modal')
        });
    }

    function markClassSettingsDirty() {
        window._classSettingsDirty = true;
    }

    function bindClassSettingsDirtyTracking() {
        window._classSettingsDirty = false;
        const overlay = document.getElementById('class-settings-modal');
        if (!overlay) return;
        overlay.querySelectorAll('input, select, textarea').forEach(function (el) {
            el.addEventListener('change', markClassSettingsDirty);
            el.addEventListener('input', markClassSettingsDirty);
        });
    }

    function closeClassSettings(force) {
        const overlayId = 'class-settings-modal';
        if (force) {
            window._classSettingsDirty = false;
            if (window.ModalOverlay) window.ModalOverlay.close(overlayId);
            else {
                const el = document.getElementById(overlayId);
                if (el) el.remove();
            }
            return;
        }
        if (window.ModalOverlay && typeof window.ModalOverlay.requestClose === 'function') {
            window.ModalOverlay.requestClose(overlayId);
            return;
        }
        if (window._classSettingsDirty) return;
        window._classSettingsDirty = false;
        const el = document.getElementById(overlayId);
        if (el) el.remove();
    }

    async function openClassSettings(classId) {
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;

        const overlayId = 'class-settings-modal';
        if (window.ModalOverlay) window.ModalOverlay.close(overlayId);
        else {
            const existing = document.getElementById(overlayId);
            if (existing) existing.remove();
        }

        if (!window.ModalOverlay) {
            window.showFlash('ModalOverlay 未載入', 'error');
            return;
        }

        window.ModalOverlay.open({
            id: overlayId,
            tier: 'B',
            contentHtml: '<div style="background:white; padding:20px; border-radius:8px; font-weight:bold;">⏳ 讀取班級資料中...</div>',
            unsavedMessage: '有未儲存的變更，確定要關閉嗎？',
            isDirty: function () { return !!window._classSettingsDirty; },
            onClose: function () { window._classSettingsDirty = false; }
        });

        try {
            let dbRaw = cls.raw_data || cls.rawData || {};
            if (typeof dbRaw === 'string') { try { dbRaw = JSON.parse(dbRaw); } catch(e) { dbRaw = {}; } }
            const currentMode = dbRaw.name_display_mode || 'default';
            const lateDefaults = dbRaw.late_submission_defaults || { allow_late: false, grace_period_hours: 0, penalty_percentage: 0 };
            let gradingPolicy = {};
            if (window.GradingPolicy && window.GradingPolicy.parsePolicy) {
                gradingPolicy = window.GradingPolicy.parsePolicy(dbRaw);
            }

            const mainIconSelect = document.getElementById('new-class-icon');
            let iconInputHTML = `<input type="text" id="edit-class-icon" class="form-control" value="${cls.icon || '📘'}" style="width: 100%; text-align: center;">`;
            if (mainIconSelect) iconInputHTML = `<select id="edit-class-icon" class="form-control" style="width: 100%; text-align: center;">${mainIconSelect.innerHTML}</select>`;

            const overlay = document.getElementById(overlayId);
            if (!overlay) throw new Error('設定視窗已關閉');
            const reviewZone = (window.ReviewZone && typeof window.ReviewZone.parsePolicy === 'function')
                ? window.ReviewZone.parsePolicy(dbRaw)
                : {};
            overlay.innerHTML = TPL.getClassSettingsModalHtml(cls, currentMode, lateDefaults, iconInputHTML, overlayId, gradingPolicy, reviewZone);
            
            if (mainIconSelect) document.getElementById('edit-class-icon').value = cls.icon || '📘';
            bindClassSettingsDirtyTracking();
            syncPracticeZoneLock();
        } catch (err) { 
            window.showFlash('載入資料失敗：' + err.message, 'error'); 
            closeClassSettings(true);
        }
    }

    async function saveClassSettings(classId) {
        const btn = document.getElementById('btn-save-class-settings');
        const newName = document.getElementById('edit-class-name').value.trim();
        const newIcon = document.getElementById('edit-class-icon').value.trim() || '📘';
        const newMode = document.querySelector('input[name="edit_class_mode"]:checked').value;
        const allowLate = document.getElementById('edit-allow-late').checked;
        const gracePeriod = parseInt(document.getElementById('edit-grace-period').value) || 0;
        const penaltyPercent = parseInt(document.getElementById('edit-penalty-percent').value) || 0;

        const finalAuthEl = document.querySelector('input[name="edit_final_authority"]:checked');
        const finalAuthority = finalAuthEl ? finalAuthEl.value : 'human_confirm';

        let gradingPolicyForm = {
            final_authority: finalAuthority,
            speech_engine: 'speechace',
            accent: document.getElementById('gp-accent') ? document.getElementById('gp-accent').value : 'en-us',
            phonetic_format: document.getElementById('gp-phonetic') ? document.getElementById('gp-phonetic').value : 'kk',
            overrideRoles: {},
            publishRoles: {}
        };

        ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior'].forEach(function(role) {
            const oEl = document.getElementById('gp-override-' + role);
            const pEl = document.getElementById('gp-publish-' + role);
            gradingPolicyForm.overrideRoles[role] = oEl ? oEl.checked : false;
            gradingPolicyForm.publishRoles[role] = pEl ? pEl.checked : false;
        });

        let gradingPolicy = gradingPolicyForm;
        if (window.GradingPolicy && window.GradingPolicy.buildPolicyFromForm) {
            gradingPolicy = window.GradingPolicy.buildPolicyFromForm(gradingPolicyForm);
        }
        
        if (!newName) return window.showFlash("⚠️ 班級名稱不能為空！", 'error');

        btn.innerHTML = '⏳ 儲存中...'; btn.disabled = true;

        try {
            const cls = db.classes.find(c => c.id === classId);
            let dbRaw = cls.raw_data || cls.rawData || {};
            if (typeof dbRaw === 'string') { try { dbRaw = JSON.parse(dbRaw); } catch(e) { dbRaw = {}; } }
            
            const lateSubmissionDefaults = { allow_late: allowLate, grace_period_hours: gracePeriod, penalty_percentage: penaltyPercent };
            const reviewZone = (window.ReviewZone && typeof window.ReviewZone.readFromForm === 'function')
                ? window.ReviewZone.readFromForm()
                : (dbRaw.review_zone || {});
            const prevZone = dbRaw.review_zone && typeof dbRaw.review_zone === 'object' ? dbRaw.review_zone : {};
            if (prevZone.materials && !reviewZone.materials) reviewZone.materials = prevZone.materials;
            const mergedRawData = Object.assign({}, dbRaw, {
                name_display_mode: newMode,
                late_submission_defaults: lateSubmissionDefaults,
                grading_policy: gradingPolicy,
                review_zone: reviewZone
            });

            const { data: updatedRows, error } = await window.supabaseClient.from('classes').update({ name: newName, icon: newIcon, raw_data: mergedRawData }).eq('id', classId).select();
            if (error) throw error;
            if (!updatedRows || updatedRows.length === 0) throw new Error("設定並未真正寫入雲端 (請聯絡管理員檢查)");

            closeClassSettings(true);
            
            if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') {
                db.classes = await window.ApiService.fetchClasses();
            } else { 
                cls.name = newName; cls.icon = newIcon; cls.raw_data = mergedRawData; cls.rawData = mergedRawData; 
            }

            if (typeof db.save === 'function') db.save();
            renderClassManager();

            try {
                const startForDrive = normalizeDateString(cls.startDate || cls.start_date || getTaiwanTodayString());
                await syncClassDriveFolderName({ raw_data: mergedRawData }, newName, startForDrive);
            } catch (driveErr) {
                console.warn('Drive 資料夾同步命名略過:', driveErr);
                window.showFlash('班級已儲存，但 Drive 資料夾重新命名失敗：' + driveErr.message, 'error');
            }
            
            if (window.TeacherUI) {
                window.TeacherUI.renderSidebar();
                if (window.TeacherUI.getCurrentClassId() === classId) {
                    updateClassContent(classId); 
                    if (window.FeatureClassMembers && typeof window.FeatureClassMembers.renderStudentManager === 'function') {
                        window.FeatureClassMembers.renderStudentManager(classId);
                    }
                }
            }
        } catch (err) { 
            window.showFlash('儲存失敗：' + err.message, 'error'); 
            btn.innerHTML = '💾 儲存變更'; btn.disabled = false; 
        }
    }
    
    // ==========================================
    // 🧠 非同步對話框控制器 (Promisified Modals)
    // ==========================================
    function askSafeScheduleChange(todayStr) {
        return new Promise((resolve) => {
            const overlayId = 'schedule-safe-modal';
            if (!window.ModalOverlay) { resolve(null); return; }
            window.ModalOverlay.close(overlayId);
            window.ModalOverlay.open({
                id: overlayId,
                tier: 'A',
                contentHtml: TPL.getSafeScheduleModalHtml(todayStr),
                onCancel: function () { resolve(null); },
                onMount: function () {
                    document.getElementById('btn-cancel-safe').onclick = function () {
                        window.ModalOverlay.close(overlayId);
                        resolve(null);
                    };
                    document.getElementById('btn-confirm-safe').onclick = function () {
                        const action = document.querySelector('input[name="safe_resolve_mode"]:checked').value;
                        const anchorDate = document.getElementById('safe-anchor-date').value;
                        window.ModalOverlay.close(overlayId);
                        resolve({ action: action, anchorDate: anchorDate });
                    };
                }
            });
        });
    }

    function askOrphanResolution(orphanCount, affectedDatesCount, todayStr) {
        return new Promise((resolve) => {
            const overlayId = 'schedule-orphan-modal';
            if (!window.ModalOverlay) { resolve(null); return; }
            window.ModalOverlay.close(overlayId);
            window.ModalOverlay.open({
                id: overlayId,
                tier: 'A',
                contentHtml: TPL.getOrphanModalHtml(orphanCount, affectedDatesCount, todayStr),
                onCancel: function () { resolve(null); },
                onMount: function () {
                    document.getElementById('btn-cancel-orphan').onclick = function () {
                        window.ModalOverlay.close(overlayId);
                        resolve(null);
                    };
                    document.getElementById('btn-confirm-orphan').onclick = function () {
                        const action = document.querySelector('input[name="orphan_resolve_mode"]:checked').value;
                        const anchorDate = document.getElementById('orphan-anchor-date').value;
                        window.ModalOverlay.close(overlayId);
                        resolve({ action: action, anchorDate: anchorDate });
                    };
                }
            });
        });
    }

    function askWeeklyToDailyResolution(assignCount) {
        return new Promise((resolve) => {
            const overlayId = 'schedule-unpack-modal';
            if (!window.ModalOverlay) { resolve(null); return; }
            window.ModalOverlay.close(overlayId);
            window.ModalOverlay.open({
                id: overlayId,
                tier: 'A',
                contentHtml: TPL.getUnpackModalHtml(assignCount),
                onCancel: function () { resolve(null); },
                onMount: function () {
                    document.getElementById('btn-cancel-unpack').onclick = function () {
                        window.ModalOverlay.close(overlayId);
                        resolve(null);
                    };
                    document.getElementById('btn-confirm-unpack').onclick = function () {
                        const strategy = document.querySelector('input[name="unpack_strategy"]:checked').value;
                        window.ModalOverlay.close(overlayId);
                        resolve(strategy);
                    };
                }
            });
        });
    }

    function ensureNewClassFormHasModeSelector() {
        const btnAddClass = document.getElementById('btn-add-class');
        if (!btnAddClass) return;
        if (!document.getElementById('new-class-display-mode')) {
            btnAddClass.insertAdjacentHTML('beforebegin', TPL.getModeSelectorHtml());
        }
        const startInput = document.getElementById('new-class-start-date');
        if (startInput && !startInput.value) {
            startInput.value = getTaiwanTodayString();
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        ensureNewClassFormHasModeSelector();

        const btnAddClass = document.getElementById('btn-add-class');
        if (btnAddClass) {
            btnAddClass.onclick = async function(e) {
                if(e) e.preventDefault();
                
                const nameInput = document.getElementById('new-class-name');
                const iconInput = document.getElementById('new-class-icon');
                const modeSelector = document.getElementById('new-class-display-mode'); 
                
                if (!nameInput) return;
                const name = nameInput.value.trim();
                if (!name) return window.showFlash('⚠️ 請輸入班級名稱！', 'error');

                const startInput = document.getElementById('new-class-start-date');
                let startDate = startInput && startInput.value
                    ? normalizeDateString(startInput.value)
                    : getTaiwanTodayString();
                if (!startDate) startDate = getTaiwanTodayString();
                if (startInput) startInput.value = startDate;

                const btn = this; const originalText = btn.innerHTML;
                btn.innerHTML = '⏳ 雲端建立資料夾中...'; btn.disabled = true;

                try {
                    const { data: { user }, error: authError } = await window.supabaseClient.auth.getUser();
                    if (authError || !user) throw new Error('無法取得授權狀態');
                    
                    // 🌟 _LogOnEnglish/_Classes/{班名}_{開課日 YYYYMMDD} + 標準子資料夾
                    let folderId = "";
                    try {
                        if (!window.ApiService || typeof window.ApiService.createGASFolder !== 'function') {
                            throw new Error("系統 API 模組未就緒");
                        }

                        let teacherWsPromise = null;
                        try {
                            if (window.GasService && typeof window.GasService.ensureTeacherWorkspace === 'function') {
                                // 規格：{email @ 前面}_{uid後4碼} → 綁定老師工作區「最頂層」（非 00／01）
                                const teacherLabel = (user.email ? String(user.email).split('@')[0] : '') || 'Teacher';
                                const teacherShortId = user.id.slice(-4);
                                teacherWsPromise = window.GasService.ensureTeacherWorkspace(teacherLabel, teacherShortId)
                                    .then(async function (ws) {
                                        if (window.FeatureResource && typeof window.FeatureResource.persistTeacherDriveRoot === 'function') {
                                            await window.FeatureResource.persistTeacherDriveRoot(
                                                user.id,
                                                ws.folderId,
                                                ws.folderUrl
                                            );
                                        }
                                        return ws;
                                    })
                                    .catch(function (wsErr) {
                                        console.warn('老師工作區建立略過:', wsErr);
                                    });
                            }
                        } catch (_wsInitErr) {}

                        const classFolderName = window.UtilsDate && window.UtilsDate.buildClassDriveFolderName
                            ? window.UtilsDate.buildClassDriveFolderName(name, startDate)
                            : (name.replace(/[\\/:*?"<>|]/g, '_').trim() + '_' + startDate.replace(/-/g, ''));
                        const folderRes = await window.ApiService.createGASFolder(classFolderName, null, false, null, {
                            rootPath: ['_LogOnEnglish', '_Classes']
                        });
                        if (teacherWsPromise) await teacherWsPromise;
                        if (!folderRes || !folderRes.folderId) {
                            throw new Error('班級根資料夾建立失敗');
                        }

                        const classRootId = folderRes.folderId;
                        const standardSubs = ['00_Class_Materials', '01_Class_Resources', '02_Students'];
                        await Promise.all(standardSubs.map(function (subName) {
                            return window.ApiService.createGASFolder(subName, classRootId);
                        }));
                        folderId = classRootId;
                    } catch (folderErr) {
                        // 建立資料夾失敗，則強力阻擋開班，確保資料絕對完整
                        throw new Error(`Google Drive 資料夾建立失敗，系統為保證資料完整性已終止開班程序。(${folderErr.message})`);
                    }

                    btn.innerHTML = '⏳ 寫入資料庫...';

                    // 🧩 帶入老師個人跨班預設值（只影響新建，已存在班級不受影響；沒設定過就維持原字面預設）
                    let teacherDefaults = {};
                    try {
                        if (window.TeacherPrefs && typeof window.TeacherPrefs.getDefaults === 'function') {
                            teacherDefaults = await window.TeacherPrefs.getDefaults();
                        }
                    } catch (_prefsErr) { /* 讀不到就沿用字面預設，不擋開班 */ }

                    const initialRawData = { 
                        name_display_mode: modeSelector ? modeSelector.value : "default", 
                        week_start_day: teacherDefaults.default_week_start_day || 'sunday',
                        late_submission_defaults: { allow_late: false, grace_period_hours: 0, penalty_percentage: 0 },
                        drive_folder_id: folderId,
                        drive_layout: 'v2'
                    };
                    
                    const payload = {
                        name: name,
                        icon: iconInput ? iconInput.value : "📘",
                        calc_mode: teacherDefaults.default_calc_mode || 'single',
                        meet_days: [],
                        start_date: startDate,
                        raw_data: initialRawData
                    };
                    const { data: newClass, error: classError } = await window.supabaseClient.from('classes').insert([payload]).select().single();
                    if (classError) throw classError;
                    
                    await window.supabaseClient.from('class_staff').insert([{ class_id: newClass.id, user_id: user.id, staff_role: 'primary_teacher' }]);

                    nameInput.value = '';
                    if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') db.classes = await window.ApiService.fetchClasses();
                    if (!db.sessions) db.sessions = {};
                    db.sessions[newClass.id] = [];
                    
                    if (typeof db.save === 'function') db.save();
                    if (window.TeacherUI) window.TeacherUI.renderSidebar();
                    renderClassManager({ forceArchived: true });
                    window.showFlash('已建立班級「' + name + '」');
                } catch (err) { window.showFlash('新增失敗：' + err.message, 'error'); } 
                finally { btn.innerHTML = originalText; btn.disabled = false; }
            };
        }

        const btnSaveDates = document.getElementById('btn-save-class-dates');
        if (btnSaveDates) {
            btnSaveDates.onclick = async function(e) {
                if(e) e.preventDefault(); 
                
                const cid = window.TeacherUI.getCurrentClassId();
                if (!cid) return;
                const c = db.classes.find(x => x.id === cid);
                if (!c) return;
                
                let sDate = normalizeDateString(document.getElementById('class-start-date').value) || toLocalISODate(new Date());
                let eDate = normalizeDateString(document.getElementById('class-end-date').value) || '';
                
                if (!eDate) { const endDt = new Date(sDate); endDt.setMonth(endDt.getMonth() + 4); eDate = toLocalISODate(endDt); }
                document.getElementById('class-start-date').value = sDate;
                document.getElementById('class-end-date').value = eDate;

                const meetDaysArr = Array.from(document.querySelectorAll('#class-meet-days input:checked')).map(cb => parseInt(cb.value));
                const modeInput = document.querySelector('input[name="calc_mode"]:checked');
                const calcModeVal = modeInput ? modeInput.value : 'single';

                let weekStartVal = 'sunday';
                const weekRadios = document.getElementsByName('week_start_day');
                for (let i = 0; i < weekRadios.length; i++) { if (weekRadios[i].checked) { weekStartVal = weekRadios[i].value; break; } }

                if (this.disabled) return; 
                
                const btn = this; const originalText = btn.innerHTML; 
                btn.innerHTML = '⏳ 智慧推演中...'; btn.disabled = true;

                try {
                    let safeRawDataForCheck = c.raw_data || c.rawData || {};
                    if (typeof safeRawDataForCheck === 'string') { try { safeRawDataForCheck = JSON.parse(safeRawDataForCheck); } catch (ex) { safeRawDataForCheck = {}; } }
                    
                    const oldCalcMode = c.calcMode || c.calc_mode || 'single';
                    const oldSessions = (safeRawDataForCheck.custom_sessions && Array.isArray(safeRawDataForCheck.custom_sessions)) ? safeRawDataForCheck.custom_sessions : (db.sessions[cid] || []);
                    const classAssigns = (db.assignments || []).filter(a => a.class_id === cid && !a.deleted_at);

                    const newFullSessions = meetDaysArr.length > 0 ? generateDates(sDate, eDate, meetDaysArr) : [];
                    const orphanAssigns = classAssigns.filter(a => !newFullSessions.includes(a.target_date));
                    const isWeekToDay = (oldCalcMode === 'weekly' && calcModeVal === 'single' && classAssigns.length > 0);
                    const todayStr = getTaiwanTodayString();

                    const oldSDate = normalizeDateString(c.startDate || c.start_date || '');
                    const oldEDate = normalizeDateString(c.endDate || c.end_date || '');
                    const oldMeetDaysStr = (c.meetDays || c.meet_days || []).map(Number).sort().join(',');
                    const newMeetDaysStr = meetDaysArr.sort().join(',');
                    
                    const isNewClassSetup = (!oldSDate && !oldEDate);
                    const isDatesChanged = (oldSDate !== sDate) || (oldEDate !== eDate) || (oldMeetDaysStr !== newMeetDaysStr);

                    const executeSave = async (finalCustomSessions, assignUpdatesMap = new Map()) => {
                        btn.innerHTML = assignUpdatesMap.size > 0 ? '⏳ 同步與批次對齊中...' : '⏳ 雲端同步中...';
                        
                        const finalAssignUpdates = Array.from(assignUpdatesMap.values());
                        if (finalAssignUpdates.length > 0) {
                            const promises = finalAssignUpdates.map(upd => window.supabaseClient.from('assignments').update(upd.payload).eq('id', upd.id));
                            await Promise.all(promises);
                            
                            finalAssignUpdates.forEach(upd => { 
                                const target = db.assignments.find(a => a.id === upd.id); 
                                if (target) Object.assign(target, upd.payload); 
                            });
                            db.assignments = db.assignments.filter(a => !a.deleted_at);
                        }

                        // 每次儲存排程都依「班名 + 學期起始日」同步 Drive 名稱（舊班可一次改對）
                        if (safeRawDataForCheck.drive_folder_id || safeRawDataForCheck.class_folder_id) {
                            try {
                                btn.innerHTML = '⏳ 同步 Drive 資料夾名稱...';
                                await syncClassDriveFolderName(safeRawDataForCheck, c.name, sDate);
                            } catch (driveErr) {
                                console.warn('Drive 資料夾重新命名失敗:', driveErr);
                                window.showFlash('排程已儲存，但 Drive 資料夾重新命名失敗：' + driveErr.message, 'error');
                            }
                        }

                        const mergedRawData = Object.assign({}, safeRawDataForCheck, { week_start_day: weekStartVal, custom_sessions: finalCustomSessions });
                        const payload = { start_date: sDate, end_date: eDate, meet_days: meetDaysArr, calc_mode: calcModeVal, raw_data: mergedRawData };
                        
                        const { data: updatedRows, error: updateErr } = await window.supabaseClient.from('classes').update(payload).eq('id', cid).select();
                        if (updateErr || !updatedRows || updatedRows.length === 0) throw new Error("資料庫寫入失敗。");

                        if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') db.classes = await window.ApiService.fetchClasses();
                        else { c.startDate = sDate; c.endDate = eDate; c.meetDays = meetDaysArr; c.calcMode = calcModeVal; c.raw_data = mergedRawData; c.rawData = mergedRawData; }

                        if (!db.sessions) db.sessions = {};
                        db.sessions[cid] = finalCustomSessions;
                        if (typeof db.save === 'function') db.save();

                        updateClassContent(cid);
                        
                        btn.innerHTML = '✅ 儲存成功！'; btn.style.backgroundColor = '#10B981'; btn.style.color = '#fff'; btn.style.borderColor = '#10B981';
                        if (window.FeatureTimeline && typeof window.FeatureTimeline.renderTimeline === 'function') window.FeatureTimeline.renderTimeline(cid, 'none'); 
                        
                        setTimeout(() => { 
                            btn.innerHTML = originalText; btn.removeAttribute('style'); btn.disabled = false; 
                            if (window.TeacherUI && typeof window.TeacherUI.switchTab === 'function') return window.TeacherUI.switchTab('timeline');
                        }, 1200);
                    };

                    if (orphanAssigns.length > 0) {
                        const uniqueOrphanDates = [...new Set(orphanAssigns.map(a => a.target_date))].length;
                        const orphanRes = await askOrphanResolution(orphanAssigns.length, uniqueOrphanDates, todayStr);
                        if (!orphanRes) { btn.innerHTML = originalText; btn.disabled = false; return; }
                        
                        let finalSessions = [...newFullSessions];
                        let assignUpdatesMap = new Map();

                        if (orphanRes.action === 'future') {
                            const pastSessions = oldSessions.filter(date => date < orphanRes.anchorDate);
                            const calcStart = (orphanRes.anchorDate > sDate) ? orphanRes.anchorDate : sDate;
                            const futureSessions = meetDaysArr.length > 0 ? generateDates(calcStart, eDate, meetDaysArr) : [];
                            finalSessions = [...new Set([...pastSessions, ...futureSessions])].sort();
                            
                            orphanAssigns.forEach(a => {
                                if (a.target_date >= orphanRes.anchorDate) {
                                    const candidates = finalSessions.filter(d => d >= a.target_date);
                                    let newTarget = candidates.length > 0 ? candidates[0] : finalSessions[finalSessions.length - 1];
                                    if (newTarget) assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTarget } });
                                }
                            });
                        } else if (orphanRes.action === 'prev' || orphanRes.action === 'next') {
                            orphanAssigns.forEach(a => {
                                let newTarget = null;
                                if (orphanRes.action === 'prev') {
                                    const candidates = newFullSessions.filter(d => d < a.target_date);
                                    newTarget = candidates.length > 0 ? candidates[candidates.length - 1] : newFullSessions[0];
                                } else {
                                    const candidates = newFullSessions.filter(d => d > a.target_date);
                                    newTarget = candidates.length > 0 ? candidates[0] : newFullSessions[newFullSessions.length - 1];
                                }
                                if (newTarget) assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTarget } });
                            });
                        } else if (orphanRes.action === 'drop') {
                            const delTime = new Date().toISOString();
                            orphanAssigns.forEach(a => assignUpdatesMap.set(a.id, { id: a.id, payload: { deleted_at: delTime } }));
                        }

                        if (isWeekToDay) {
                            const survivingCount = classAssigns.filter(a => !(assignUpdatesMap.has(a.id) && assignUpdatesMap.get(a.id).payload.deleted_at)).length;
                            if (survivingCount > 0) {
                                const unpackStrategy = await askWeeklyToDailyResolution(survivingCount);
                                if (!unpackStrategy) { btn.innerHTML = originalText; btn.disabled = false; return; }
                                
                                const weeksMap = new Map();
                                finalSessions.forEach(d => { 
                                    const ws = getWeekStartStr(d, weekStartVal); 
                                    if (!weeksMap.has(ws)) weeksMap.set(ws, []); 
                                    weeksMap.get(ws).push(d); 
                                });
                                
                                classAssigns.forEach(a => {
                                    if (assignUpdatesMap.has(a.id) && assignUpdatesMap.get(a.id).payload.deleted_at) return;
                                    
                                    const currentTarget = assignUpdatesMap.has(a.id) ? assignUpdatesMap.get(a.id).payload.target_date : a.target_date;
                                    const ws = getWeekStartStr(currentTarget, weekStartVal);
                                    const weekDays = weeksMap.get(ws) || [];
                                    let newTargetD = currentTarget;
                                    
                                    if (weekDays.length > 0) {
                                        if (unpackStrategy === 'smart') {
                                            let effectiveDue = a.due_date;
                                            if (!effectiveDue && a.tasks && a.tasks.length > 0) { 
                                                const explicitDates = a.tasks.map(t => t.due_date).filter(d => d); 
                                                if (explicitDates.length > 0) effectiveDue = explicitDates[0]; 
                                            }
                                            if (effectiveDue) { 
                                                const validDays = weekDays.filter(d => d <= effectiveDue); 
                                                newTargetD = validDays.length > 0 ? validDays[validDays.length - 1] : weekDays[0];
                                            } else { 
                                                newTargetD = weekDays[weekDays.length - 1]; 
                                            }
                                        } else if (unpackStrategy === 'first') newTargetD = weekDays[0]; 
                                        else if (unpackStrategy === 'last') newTargetD = weekDays[weekDays.length - 1]; 
                                    }
                                    
                                    if (newTargetD !== a.target_date) {
                                        if (assignUpdatesMap.has(a.id)) assignUpdatesMap.get(a.id).payload.target_date = newTargetD; 
                                        else assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTargetD } }); 
                                    }
                                });
                            }
                        }
                        await executeSave(finalSessions, assignUpdatesMap);
                    } else {
                        let finalSessions = [...newFullSessions];
                        if (isNewClassSetup) {
                            console.log('💡 [排程引擎] 偵測到為新建課程第一次設定排程，Bypass 異動對話框，靜默放行。');
                            finalSessions = [...newFullSessions];
                        } else if (isDatesChanged) {
                            const safeRes = await askSafeScheduleChange(todayStr);
                            if (!safeRes) { btn.innerHTML = originalText; btn.disabled = false; return; }

                            if (safeRes.action === 'future') {
                                const pastSessions = oldSessions.filter(date => date < safeRes.anchorDate);
                                const calcStart = (safeRes.anchorDate > sDate) ? safeRes.anchorDate : sDate;
                                const futureSessions = meetDaysArr.length > 0 ? generateDates(calcStart, eDate, meetDaysArr) : [];
                                finalSessions = [...new Set([...pastSessions, ...futureSessions])].sort();
                            } else finalSessions = [...newFullSessions];
                        } else finalSessions = (safeRawDataForCheck.custom_sessions && Array.isArray(safeRawDataForCheck.custom_sessions)) ? safeRawDataForCheck.custom_sessions : [...newFullSessions];

                        if (isWeekToDay) {
                            const unpackStrategy = await askWeeklyToDailyResolution(classAssigns.length);
                            if (!unpackStrategy) { btn.innerHTML = originalText; btn.disabled = false; return; }
                            
                            let assignUpdatesMap = new Map();
                            const weeksMap = new Map();
                            finalSessions.forEach(d => { 
                                const ws = getWeekStartStr(d, weekStartVal); 
                                if (!weeksMap.has(ws)) weeksMap.set(ws, []); 
                                weeksMap.get(ws).push(d); 
                            });
                            
                            classAssigns.forEach(a => {
                                const ws = getWeekStartStr(a.target_date, weekStartVal);
                                const weekDays = weeksMap.get(ws) || [];
                                let newTargetD = a.target_date;
                                
                                if (weekDays.length > 0) {
                                    if (unpackStrategy === 'smart') {
                                        let effectiveDue = a.due_date;
                                        if (!effectiveDue && a.tasks && a.tasks.length > 0) { 
                                            const explicitDates = a.tasks.map(t => t.due_date).filter(d => d); 
                                            if (explicitDates.length > 0) effectiveDue = explicitDates[0]; 
                                        }
                                        if (effectiveDue) { 
                                            const validDays = weekDays.filter(d => d <= effectiveDue); 
                                            newTargetD = validDays.length > 0 ? validDays[validDays.length - 1] : weekDays[0];
                                        } else newTargetD = weekDays[weekDays.length - 1]; 
                                    } else if (unpackStrategy === 'first') newTargetD = weekDays[0]; 
                                    else if (unpackStrategy === 'last') newTargetD = weekDays[weekDays.length - 1]; 
                                }
                                if (newTargetD !== a.target_date) assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTargetD } }); 
                            });
                            await executeSave(finalSessions, assignUpdatesMap);
                        } else await executeSave(finalSessions, new Map());
                    }
                } catch (err) { btn.innerHTML = originalText; btn.disabled = false; console.error(err); window.showFlash('推演或儲存失敗：' + err.message, 'error'); }
            };
        }

        if (window.TeacherUI) window.TeacherUI.renderSidebar();
        renderClassManager();
    });

    async function refreshReviewCatalog(classId) {
        const statusEl = document.getElementById('rz-catalog-status');
        const btn = document.getElementById('rz-refresh-catalog');
        if (!window.FeatureReviewCatalog || typeof window.FeatureReviewCatalog.refreshForClass !== 'function') {
            if (statusEl) statusEl.textContent = '教材目錄模組未載入';
            return;
        }
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 更新中…'; }
        try {
            const cls0 = db.classes.find(function (c) { return String(c.id) === String(classId); });
            const zone0 = cls0 ? ((cls0.raw_data || cls0.rawData || {}).review_zone || {}) : {};
            const result = await window.FeatureReviewCatalog.refreshForClass(classId, statusEl, {
                materials: zone0.materials
            });
            const nowIso = new Date().toISOString();
            const hidden = document.getElementById('rz-catalog-updated-at');
            if (hidden) hidden.value = nowIso;
            const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
            if (cls) {
                let raw = cls.raw_data || cls.rawData || {};
                if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_e) { raw = {}; } }
                const zone = Object.assign({}, raw.review_zone || {}, { catalog_updated_at: nowIso });
                const merged = Object.assign({}, raw, { review_zone: zone });
                const { error } = await window.supabaseClient.from('classes').update({ raw_data: merged }).eq('id', classId);
                if (!error) {
                    cls.raw_data = merged;
                    cls.rawData = merged;
                }
            }
            const msg = '已快照 ' + (result && result.count ? result.count : 0) + ' 個活頁'
                + (result && result.ready != null ? ('（其中 ' + result.ready + ' 個已有題目）') : '');
            if (statusEl) statusEl.textContent = msg;
            window.showFlash(msg, 'success');
            window._classSettingsDirty = true;
        } catch (err) {
            if (statusEl) statusEl.textContent = '更新失敗：' + (err && err.message ? err.message : err);
            window.showFlash('更新教材目錄失敗：' + (err && err.message ? err.message : err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🔄 更新教材目錄'; }
        }
    }

    function syncPracticeZoneLock() {
        const on = !!(document.getElementById('rz-enabled') && document.getElementById('rz-enabled').checked);
        ['rz-allow-practice', 'rz-allow-test', 'rz-teacher-can-view', 'rz-test-counts-as-score'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.disabled = !on;
        });
    }

    return { 
        updateClassContent, renderClassManager, editClass: openClassSettings, openClassSettings, saveClassSettings, closeClassSettings,
        refreshReviewCatalog, syncPracticeZoneLock,
        openArchiveConfirm, closeArchiveConfirm,
        executeDelete: async (classId) => {
            const btn = window.event ? window.event.target : document.activeElement;
            const originalText = btn.innerHTML; btn.innerHTML = '⏳ 雲端 RPC 封存中...'; btn.disabled = true;
            try {
                if (!window.ApiService || typeof window.ApiService.archiveClass !== 'function') throw new Error("API 引擎未就緒。");
                const delStudentsCb = document.getElementById(`del-students-cb-${classId}`);
                if (delStudentsCb && delStudentsCb.checked) {
                    const { data: enrollments } = await window.supabaseClient.from('student_enrollments').select('user_id').eq('class_id', classId).is('deleted_at', null);
                    if (enrollments && enrollments.length > 0) await window.supabaseClient.from('profiles').update({ deleted_at: new Date().toISOString() }).in('id', enrollments.map(e => e.user_id));
                }
                
                await window.ApiService.archiveClass(classId); 
                db.classes = await window.ApiService.fetchClasses();
                
                if (db.sessions) delete db.sessions[classId];
                if (db.resourceMappings) db.resourceMappings = db.resourceMappings.filter(m => m.class_id !== classId);
                if (db.assignments) db.assignments = db.assignments.filter(a => a.class_id !== classId);
                
                if (typeof db.save === 'function') db.save();
                closeArchiveConfirm();
                renderClassManager({ forceArchived: true });
                if (window.TeacherUI) window.TeacherUI.renderSidebar();
                
                if (window.TeacherUI && window.TeacherUI.getCurrentClassId() === classId) {
                    if (db.classes.length > 0) window.TeacherUI.activateClassView(db.classes[0].id);
                    else { const header = document.getElementById('class-context-header'); if (header) header.style.display = 'none'; }
                }
            } catch (err) { window.showFlash(err.message, 'error'); btn.innerHTML = originalText; btn.disabled = false; }
        }
    };
})();
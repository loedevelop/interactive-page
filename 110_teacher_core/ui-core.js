/**
 * 📂 檔案路徑：110_teacher_core/ui-core.js
 * 描述：導覽控制器。整合 Supabase 雲端讀取等待機制與 RBAC 權限矩陣。
 * 🌟 v6.1 白皮書對齊版：全面掛載 ApiService，安全更新 Context，防堵污染！
 */

window.TeacherUI = (() => {
    let currentClassId = null;
    const GLOBAL_VIEW_KEY = 'teacherActiveGlobalView';
    const SIDEBAR_CACHE_KEY = 'teacherSidebarCache';
    const GLOBAL_VIEW_NAV = {
        'view-manage-classes': 'nav-manage-classes',
        'view-global-resources': 'nav-global-resources',
        'view-profile': 'nav-profile'
    };

    const classListContainer = document.getElementById('class-list');
    const classContextHeader = document.getElementById('class-context-header');
    const viewSections = document.querySelectorAll('.view-section');
    const tabBtns = document.querySelectorAll('.tab-btn');

    function getRoleBadgeHtml(staffRole) {
        if (staffRole === 'admin') return '<span style="font-size:0.7rem; background:#EF4444; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">Admin</span>';
        if (staffRole === 'primary_teacher') return '<span style="font-size:0.7rem; background:#FF8C00; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">主</span>';
        if (staffRole === 'co_teacher') return '<span style="font-size:0.7rem; background:#4CAF50; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">協</span>';
        if (staffRole === 'ta_senior' || staffRole === 'ta_junior') return '<span style="font-size:0.7rem; background:#9E9E9E; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">TA</span>';
        return '';
    }

    function applyStaffRoleUI(staffRole) {
        const tabSettings = document.querySelector('.tab-btn[data-target="view-settings"]');
        const navManageClasses = document.getElementById('nav-manage-classes');
        const tabStudents = document.querySelector('.tab-btn[data-target="view-students"]');
        const tabResources = document.querySelector('.tab-btn[data-target="view-resources"]');
        const navGlobalResources = document.getElementById('nav-global-resources');

        if (staffRole === 'admin' || staffRole === 'primary_teacher') {
            if (tabSettings) tabSettings.style.display = 'inline-block';
            if (navManageClasses) navManageClasses.style.display = 'block';
        } else {
            if (tabSettings) tabSettings.style.display = 'none';
            if (navManageClasses) navManageClasses.style.display = 'none';
        }

        if (staffRole === 'ta_junior') {
            if (tabStudents) tabStudents.style.display = 'none';
            if (tabResources) tabResources.style.display = 'none';
            if (navGlobalResources) navGlobalResources.style.display = 'none';
        } else {
            if (tabStudents) tabStudents.style.display = 'inline-block';
            if (tabResources) tabResources.style.display = 'inline-block';
            if (navGlobalResources) navGlobalResources.style.display = 'block';
        }
    }

    function resolveStaffRoleFromSession(session, classId) {
        if (session.activeContext && session.activeContext.staffRole) {
            return session.activeContext.staffRole;
        }
        if (session.enrollments && classId) {
            const enrollment = session.enrollments.find(function(e) { return e.id === classId; });
            if (enrollment && enrollment.staff_role) {
                return enrollment.staff_role;
            }
        }
        const storedRole = localStorage.getItem('activeRole');
        return storedRole ? storedRole : 'ta_junior';
    }

    function removeBootGlobalViewShim() {
        const shim = document.getElementById('boot-global-view-shim');
        if (shim) shim.remove();
    }

    function restoreGlobalViewIfSaved() {
        const savedGlobalView = localStorage.getItem(GLOBAL_VIEW_KEY);
        if (!savedGlobalView || !GLOBAL_VIEW_NAV[savedGlobalView] || !document.getElementById(savedGlobalView)) {
            return null;
        }
        activateGlobalView(savedGlobalView, GLOBAL_VIEW_NAV[savedGlobalView]);
        return savedGlobalView;
    }

    function runGlobalViewDataRefresh(viewId) {
        if (viewId === 'view-manage-classes' && window.FeatureClass && typeof window.FeatureClass.renderClassManager === 'function') {
            window.FeatureClass.renderClassManager();
        } else if (viewId === 'view-global-resources' && window.FeatureResource && typeof window.FeatureResource.renderGlobalResourceView === 'function') {
            window.FeatureResource.renderGlobalResourceView();
        }
    }

    function bindClassListDelegation() {
        if (!classListContainer || classListContainer.dataset.clickBound === '1') return;
        classListContainer.dataset.clickBound = '1';
        classListContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.class-item[data-class-id]');
            if (!item) return;
            const classId = item.getAttribute('data-class-id');
            if (classId) activateClassView(classId);
        });
    }

    function getSidebarSignature(classes) {
        return (classes || []).map(function (cls) {
            return [
                cls.id,
                cls.name || '',
                cls.icon || '📘',
                cls.staff_role || cls.currentUserRole || ''
            ].join('|');
        }).join(';;');
    }

    function saveSidebarCache(classes) {
        if (!classes || !classes.length) return;
        try {
            localStorage.setItem(SIDEBAR_CACHE_KEY, JSON.stringify({
                cachedAt: new Date().toISOString(),
                classes: classes.map(function (cls) {
                    return {
                        id: cls.id,
                        name: cls.name,
                        icon: cls.icon || '📘',
                        staff_role: cls.staff_role || cls.currentUserRole || 'ta_junior'
                    };
                })
            }));
        } catch (_e) {}
    }

    function preRenderSidebarFromSession(session, activeClassId) {
        if (!classListContainer) return;
        if (classListContainer.dataset.booted === '1') {
            bindClassListDelegation();
            return;
        }
        if (!session.enrollments || session.enrollments.length === 0) return;

        classListContainer.innerHTML = '';
        const globalView = localStorage.getItem(GLOBAL_VIEW_KEY);
        session.enrollments.forEach(function(en) {
            const div = document.createElement('div');
            div.className = 'class-item' + (!globalView && en.id === activeClassId ? ' active' : '');
            div.setAttribute('data-class-id', en.id);
            const staffRole = en.staff_role ? en.staff_role : 'ta_junior';
            div.innerHTML = '<span style="width:20px; display:inline-block;">📘</span> <span style="flex-grow:1; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">' + en.name + '</span> ' + getRoleBadgeHtml(staffRole);
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            classListContainer.appendChild(div);
        });
        bindClassListDelegation();
        classListContainer.dataset.booted = '1';
        classListContainer.dataset.sidebarSig = getSidebarSignature(session.enrollments.map(function (en) {
            return { id: en.id, name: en.name, icon: '📘', staff_role: en.staff_role };
        }));
    }

    function bootstrapFromSession() {
        const sessionString = localStorage.getItem('LogOnEnglish_Session');
        if (!sessionString) return null;

        try {
            const session = JSON.parse(sessionString);
            let classId = null;
            // 優先用老師上次點選的班級（activeClassId），避免登入時寫死的 activeContext 蓋掉
            const savedActiveId = localStorage.getItem('activeClassId');
            if (savedActiveId) {
                classId = savedActiveId;
            } else if (session.activeContext && session.activeContext.classId) {
                classId = session.activeContext.classId;
            } else if (session.class_id) {
                classId = session.class_id;
            }

            const staffRole = resolveStaffRoleFromSession(session, classId);
            applyStaffRoleUI(staffRole);
            preRenderSidebarFromSession(session, classId);

            const greetingEl = document.getElementById('top-teacher-greeting');
            if (greetingEl && session.username) {
                greetingEl.innerHTML = 'Hi, ' + session.username + ' 👋';
            }

            const titleEl = document.getElementById('current-class-title');
            if (titleEl && session.enrollments && classId) {
                const activeEnrollment = session.enrollments.find(function(e) { return e.id === classId; });
                if (activeEnrollment && activeEnrollment.name) {
                    titleEl.textContent = activeEnrollment.name;
                }
            }

            if (classContextHeader && classId && !localStorage.getItem(GLOBAL_VIEW_KEY)) {
                classContextHeader.style.display = 'block';
            }

            restoreGlobalViewIfSaved();

            return { session: session, classId: classId, staffRole: staffRole };
        } catch (e) {
            return null;
        }
    }
    
    function renderSidebar() {
        if (!classListContainer) return;
        if (!window.TeacherDB || !window.TeacherDB.classes || window.TeacherDB.classes.length === 0) {
            return;
        }

        const nextSig = getSidebarSignature(window.TeacherDB.classes);
        if (classListContainer.dataset.booted === '1' && classListContainer.dataset.sidebarSig === nextSig) {
            bindClassListDelegation();
            saveSidebarCache(window.TeacherDB.classes);
            // 名單未變時仍須同步目前選取班級的高亮（否則標題與側欄會錯開）
            const headerVisible = classContextHeader && classContextHeader.style.display !== 'none';
            classListContainer.querySelectorAll('.class-item').forEach(function (el) {
                const isActive = headerVisible && el.getAttribute('data-class-id') === String(currentClassId || '');
                el.classList.toggle('active', isActive);
            });
            return;
        }

        classListContainer.innerHTML = '';

        window.TeacherDB.classes.forEach(cls => {
            const div = document.createElement('div');
            div.className = `class-item ${cls.id === currentClassId && classContextHeader && classContextHeader.style.display !== 'none' ? 'active' : ''}`;
            const classIcon = cls.icon || '📘'; 

            // 👑 UI 優化：根據職級給予直觀的小徽章
            let roleBadge = '';
            if (cls.staff_role === 'admin' || cls.currentUserRole === 'admin') roleBadge = `<span style="font-size:0.7rem; background:#EF4444; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">Admin</span>`;
            else if (cls.staff_role === 'primary_teacher' || cls.currentUserRole === 'primary_teacher') roleBadge = `<span style="font-size:0.7rem; background:#FF8C00; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">主</span>`;
            else if (cls.staff_role === 'co_teacher' || cls.currentUserRole === 'co_teacher') roleBadge = `<span style="font-size:0.7rem; background:#4CAF50; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">協</span>`;
            else if (cls.staff_role === 'ta_senior' || cls.staff_role === 'ta_junior' || cls.currentUserRole?.includes('ta')) roleBadge = `<span style="font-size:0.7rem; background:#9E9E9E; color:white; padding:2px 6px; border-radius:10px; margin-left:5px;">TA</span>`;

            div.innerHTML = `<span style="width:20px; display:inline-block;">${classIcon}</span> <span style="flex-grow:1; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${cls.name}</span> ${roleBadge}`;
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.setAttribute('data-class-id', cls.id);

            classListContainer.appendChild(div);
        });
        bindClassListDelegation();
        classListContainer.dataset.booted = '1';
        classListContainer.dataset.sidebarSig = nextSig;
        saveSidebarCache(window.TeacherDB.classes);
    }

    function activateClassView(classId) {
        currentClassId = classId;
        localStorage.removeItem(GLOBAL_VIEW_KEY);
        if (classContextHeader) classContextHeader.style.display = 'block';
        
        const currentClass = window.TeacherDB.classes.find(c => c.id === classId);
        if (!currentClass) return;

        const titleEl = document.getElementById('current-class-title');
        if (titleEl) {
            titleEl.textContent = currentClass.name;
        }

        // ==========================================
        // 🛡️ 實作白皮書：動態 RBAC UI 物理防禦
        // ==========================================
        const staffRole = currentClass.staff_role || currentClass.currentUserRole || 'ta_junior';

        localStorage.setItem('activeClassId', classId);
        localStorage.setItem('activeRole', staffRole);
        // 同步寫回 Session，否則重整會優先讀舊的 activeContext.classId 而跳回登入時的班
        try {
            const sessionString = localStorage.getItem('LogOnEnglish_Session');
            if (sessionString) {
                const sessionObj = JSON.parse(sessionString);
                if (!sessionObj.activeContext) sessionObj.activeContext = {};
                sessionObj.activeContext.classId = classId;
                sessionObj.activeContext.staffRole = staffRole;
                localStorage.setItem('LogOnEnglish_Session', JSON.stringify(sessionObj));
            }
        } catch (_sessionSyncErr) {}

        applyStaffRoleUI(staffRole);

        document.querySelectorAll('.sidebar .class-item, .bottom-nav .class-item').forEach(el => el.classList.remove('active'));
        
        renderSidebar();
        viewSections.forEach(v => v.classList.remove('active'));
        
        let activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.style.display === 'none') {
            activeTab.classList.remove('active');
            activeTab = document.querySelector('.tab-btn[data-target="view-progress"]');
        } else if (!activeTab) {
            activeTab = tabBtns.length > 0 ? tabBtns[0] : null;
        }

        if (activeTab) {
            activeTab.classList.add('active');
            const targetId = activeTab.getAttribute('data-target');
            if (targetId && document.getElementById(targetId)) {
                document.getElementById(targetId).classList.add('active');
            }
        }
        
        if (window.FeatureClass && typeof window.FeatureClass.updateClassContent === 'function') {
            window.FeatureClass.updateClassContent(currentClassId);
        }
        if (window.FeatureTimeline) window.FeatureTimeline.renderTimeline(currentClassId);
        if (window.FeatureClassMembers) window.FeatureClassMembers.renderStudentManager(currentClassId);
        if (window.RenderMemberManagerForm) window.RenderMemberManagerForm(currentClassId, staffRole);
        if (window.FeatureProgress) window.FeatureProgress.renderProgressReport(currentClassId);
        if (window.FeatureResource && typeof window.FeatureResource.renderClassResources === 'function') window.FeatureResource.renderClassResources(currentClassId);
    }

    function activateGlobalView(viewId, navId) {
        localStorage.setItem(GLOBAL_VIEW_KEY, viewId);
        removeBootGlobalViewShim();
        document.querySelectorAll('.sidebar .class-item').forEach(el => el.classList.remove('active'));
        if (classContextHeader) classContextHeader.style.display = 'none';
        viewSections.forEach(v => v.classList.remove('active'));
        
        const viewEl = document.getElementById(viewId);
        if (viewEl) viewEl.classList.add('active');
        
        document.querySelectorAll('.bottom-nav .class-item').forEach(el => el.classList.remove('active'));
        const navEl = document.getElementById(navId);
        if (navEl) navEl.classList.add('active');
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.style.display === 'none') return;

            tabBtns.forEach(b => b.classList.remove('active'));
            viewSections.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            
            const targetId = btn.getAttribute('data-target');
            if (targetId && document.getElementById(targetId)) {
                document.getElementById(targetId).classList.add('active');
            }

            if (targetId === 'view-timeline' && window.FeatureTimeline) window.FeatureTimeline.renderTimeline(currentClassId);
            if (targetId === 'view-settings' && window.FeatureClass && typeof window.FeatureClass.renderSettings === 'function') window.FeatureClass.renderSettings(currentClassId);
            if (targetId === 'view-settings' && window.FeatureClass && typeof window.FeatureClass.updateClassContent === 'function') window.FeatureClass.updateClassContent(currentClassId);
            if (targetId === 'view-students' && window.FeatureClassMembers) window.FeatureClassMembers.renderStudentManager(currentClassId);
            
            const currentClass = window.TeacherDB.classes.find(c => c.id === currentClassId);
            const staffRole = currentClass ? (currentClass.staff_role || currentClass.currentUserRole) : 'ta_junior';
            if (targetId === 'view-students' && window.RenderMemberManagerForm) window.RenderMemberManagerForm(currentClassId, staffRole);

            if (targetId === 'view-resources' && window.FeatureResource && typeof window.FeatureResource.renderResourceMap === 'function') window.FeatureResource.renderResourceMap(currentClassId);
            if (targetId === 'view-resources' && window.FeatureResource && typeof window.FeatureResource.renderClassResources === 'function') window.FeatureResource.renderClassResources(currentClassId);
            if (targetId === 'view-progress' && window.FeatureProgress) window.FeatureProgress.renderProgressReport(currentClassId);
            if (targetId === 'view-progress-report' && window.FeatureProgress) window.FeatureProgress.renderProgressReport(currentClassId);
        });
    });

    const navGlobalRes = document.getElementById('nav-global-resources');
    if (navGlobalRes) {
        navGlobalRes.addEventListener('click', () => {
            activateGlobalView('view-global-resources', 'nav-global-resources');
            if (window.FeatureResource && typeof window.FeatureResource.renderGlobalResourceView === 'function') {
                window.FeatureResource.renderGlobalResourceView();
            }
        });
    }

    const navManageClasses = document.getElementById('nav-manage-classes');
    if (navManageClasses) {
        navManageClasses.addEventListener('click', () => {
            activateGlobalView('view-manage-classes', 'nav-manage-classes');
            if (window.FeatureClass && typeof window.FeatureClass.renderClassManager === 'function') {
                window.FeatureClass.renderClassManager();
            }
        });
    }

    const navProfile = document.getElementById('nav-profile');
    if (navProfile) {
        navProfile.addEventListener('click', () => {
            activateGlobalView('view-profile', 'nav-profile');
        });
    }

    async function initApp() {
        const boot = bootstrapFromSession();
        const sessionString = localStorage.getItem('LogOnEnglish_Session');
        if (!sessionString) {
            window.showFlash('尚未登入或連線逾時，請重新登入！', 'error');
            window.location.replace(window.buildLoginUrl ? window.buildLoginUrl(false) : '../index.html?_=' + Date.now());
            return;
        }
        
        let session;
        try {
            session = JSON.parse(sessionString);
        } catch (e) {
            window.location.replace(window.buildLoginUrl ? window.buildLoginUrl(false) : '../index.html?_=' + Date.now());
            return;
        }
        
        const greetingEl = document.getElementById('top-teacher-greeting');
        if (greetingEl) {
            greetingEl.innerHTML = `Hi, ${session.username || 'Teacher'} 👋`;
        }
        
        window.TeacherDB = window.TeacherDB || { classes: [], sessions: {}, resourceLibrary: [], resourceMappings: [], assignments: [], students: [] };
        
        // 🌟 徹底斷開 Local Mock，強制使用 ApiService 拉取雲端資料
        try {
            let retries = 0;
            while ((!window.ApiService || !window.TeacherDB.load) && retries < 15) {
                await new Promise(resolve => setTimeout(resolve, 200));
                retries++;
            }

            if (!window.ApiService) throw new Error("API Service 未載入，請確認 HTML 中的腳本順序！");

            // 🚀 正確呼叫橋接器同步資料
            await window.TeacherDB.load();
            
            // 🚀 啟動 AppStore 離線防護佇列與狀態管理
            if (window.AppStore && typeof window.AppStore.initSession === 'function') {
                await window.AppStore.initSession({ id: session.id, email: session.email }, session.activeContext);
                await window.AppStore.loadInitialData();
            }

        } catch (e) {
            console.error("❌ 雲端資料同步失敗:", e);
            window.showFlash('雲端資料讀取失敗，請檢查網路連線。', 'error');
        }

        // 🌟 恢復上次瀏覽的班級 (Active Context)
        if (window.TeacherDB.classes.length > 0) {
            let preferredClassId = null;
            const savedActiveId = localStorage.getItem('activeClassId');
            if (savedActiveId && window.TeacherDB.classes.some(function (c) { return c.id === savedActiveId; })) {
                preferredClassId = savedActiveId;
            } else if (boot && boot.classId) {
                preferredClassId = boot.classId;
            } else if (session.activeContext && session.activeContext.classId) {
                preferredClassId = session.activeContext.classId;
            } else if (session.class_id) {
                preferredClassId = session.class_id;
            }
            const classExists = window.TeacherDB.classes.some(function(c) { return c.id === preferredClassId; });
            currentClassId = classExists ? preferredClassId : window.TeacherDB.classes[0].id;
        }

        renderSidebar();

        const savedGlobalView = restoreGlobalViewIfSaved();
        if (savedGlobalView) {
            runGlobalViewDataRefresh(savedGlobalView);
            return;
        }

        if (currentClassId) {
            activateClassView(currentClassId);
        } else {
            const defaultTitle = document.getElementById('current-class-title');
            if (defaultTitle) defaultTitle.textContent = "尚無班級，請點擊「班級主檔管理」建立或請管理員派發。";
            if (classContextHeader) classContextHeader.style.display = 'none';
        }
    }

    function switchTab(tabTargetName) {
        const targetBtn = Array.from(tabBtns).find(btn => btn.getAttribute('data-target') === `view-${tabTargetName}` || btn.getAttribute('data-target') === tabTargetName);
        if (targetBtn && targetBtn.style.display !== 'none') {
            targetBtn.click();
        }
    }

    bootstrapFromSession();

    initApp();

    return { 
        getCurrentClassId: () => currentClassId, 
        renderSidebar, 
        activateClassView, 
        switchTab 
    };
})();
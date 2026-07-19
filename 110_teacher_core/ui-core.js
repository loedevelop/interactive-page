/**
 * 📂 檔案路徑：110_teacher_core/ui-core.js
 * 描述：導覽控制器。整合 Supabase 雲端讀取等待機制與 RBAC 權限矩陣。
 * 🌟 v6.1 白皮書對齊版：全面掛載 ApiService，安全更新 Context，防堵污染！
 */

window.TeacherUI = (() => {
    let currentClassId = null;

    const classListContainer = document.getElementById('class-list');
    const classContextHeader = document.getElementById('class-context-header');
    const viewSections = document.querySelectorAll('.view-section');
    const tabBtns = document.querySelectorAll('.tab-btn');
    
    function renderSidebar() {
        if (!classListContainer) return;
        classListContainer.innerHTML = '';
        
        if (!window.TeacherDB || !window.TeacherDB.classes) return;

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

            div.addEventListener('click', () => activateClassView(cls.id));
            classListContainer.appendChild(div);
        });
    }

    function activateClassView(classId) {
        currentClassId = classId;
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

        // 🚨 修正防呆：使用安全的方法更新情境，絕對不竄改 localStorage 的主憑證字串
        localStorage.setItem('activeClassId', classId);
        localStorage.setItem('activeRole', staffRole);
        
        const tabSettings = document.querySelector('.tab-btn[data-target="view-settings"]');
        const navManageClasses = document.getElementById('nav-manage-classes');
        const tabStudents = document.querySelector('.tab-btn[data-target="view-students"]');
        const tabResources = document.querySelector('.tab-btn[data-target="view-resources"]');
        const navGlobalResources = document.getElementById('nav-global-resources');

        // 僅 Admin 或 Primary Teacher 可見底層設定與班級主檔管理
        if (staffRole === 'admin' || staffRole === 'primary_teacher') {
            if(tabSettings) tabSettings.style.display = 'inline-block';
            if(navManageClasses) navManageClasses.style.display = 'block';
        } else {
            if(tabSettings) tabSettings.style.display = 'none';
            if(navManageClasses) navManageClasses.style.display = 'none';
        }

        // TA Junior 看不到成員管理、班級資源與全域資源
        if (staffRole === 'ta_junior') {
            if(tabStudents) tabStudents.style.display = 'none';
            if(tabResources) tabResources.style.display = 'none';
            if(navGlobalResources) navGlobalResources.style.display = 'none';
        } else {
            if(tabStudents) tabStudents.style.display = 'inline-block';
            if(tabResources) tabResources.style.display = 'inline-block';
            if(navGlobalResources) navGlobalResources.style.display = 'block';
        }

        document.querySelectorAll('.bottom-nav .class-item').forEach(el => el.classList.remove('active'));
        
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
        const sessionString = localStorage.getItem('LogOnEnglish_Session');
        if (!sessionString) {
            alert('❌ 尚未登入或連線逾時，請重新登入！');
            window.location.replace('../index.html');
            return;
        }
        
        let session;
        try {
            session = JSON.parse(sessionString);
        } catch (e) {
            window.location.replace('../index.html');
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
            alert("雲端資料讀取失敗，請檢查網路連線。");
        }

        // 🌟 恢復上次瀏覽的班級 (Active Context)
        if (window.TeacherDB.classes.length > 0) {
            const savedClassId = localStorage.getItem('activeClassId');
            const classExists = window.TeacherDB.classes.some(c => c.id === savedClassId);
            currentClassId = classExists ? savedClassId : window.TeacherDB.classes[0].id;
        }

        renderSidebar();

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

    initApp();

    return { 
        getCurrentClassId: () => currentClassId, 
        renderSidebar, 
        activateClassView, 
        switchTab 
    };
})();
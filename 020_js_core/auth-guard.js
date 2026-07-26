/**
 * 📂 檔案路徑：020_js_core/auth-guard.js
 * 描述：零信任前端防護網與登出邏輯。
 * 🌟 v6.2 SaaS 鐵桶防禦版：情境身分制路由（修正 teacher/student persona 判定）
 */

(function() {
    const currentPath = window.location.pathname;
    const isRoot = currentPath.endsWith('/') || currentPath.endsWith('index.html') && !currentPath.includes('/');
    const rootPrefix = isRoot ? './' : '../';

    function redirectToLogin(clearCache) {
        const url = window.buildLoginUrl
            ? window.buildLoginUrl(!!clearCache)
            : rootPrefix + 'index.html?clear=' + (clearCache ? 'true' : 'false') + '&_=' + Date.now();
        window.location.replace(url);
    }

    function guardFlash(message, thenRedirect) {
        if (typeof window.showFlash === 'function') {
            window.showFlash(message, 'error');
            setTimeout(thenRedirect, 1400);
        } else {
            alert(message);
            thenRedirect();
        }
    }

    const sessionString = localStorage.getItem('LogOnEnglish_Session');

    if (!sessionString) {
        console.warn('⚠️ 未經授權的訪問，即將導向登入頁。');
        redirectToLogin(false);
        return;
    }

    try {
        const session = JSON.parse(sessionString);
        const personaRole = session.activeContext ? session.activeContext.role : session.role;
        const isGlobalAdmin = personaRole === 'admin' || session.default_role === 'admin';
        
        if (currentPath.includes('/admin/')) {
            if (!isGlobalAdmin) {
                guardFlash('越權存取：您不具備全域管理員 (Admin) 權限！', function () {
                    redirectToLogin(false);
                });
                return;
            }
        }

        if (currentPath.includes('/teacher/') || currentPath.includes('110_teacher_core')) {
            const staffRoleFromContext = session.activeContext ? session.activeContext.staffRole : null;
            const activeRole = localStorage.getItem('activeRole');
            const isTeacherPersona = personaRole === 'teacher' || personaRole === 'admin';
            const isStaffRole = isGlobalAdmin || ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior', 'teacher'].includes(activeRole);
            const isStaffFromContext = staffRoleFromContext && ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior'].includes(staffRoleFromContext);

            if (!isTeacherPersona && !isStaffRole && !isStaffFromContext) {
                guardFlash('越權存取：此區域僅限教職員工進入。', function () {
                    redirectToLogin(false);
                });
                return;
            }
        }

        if (currentPath.includes('/student/')) {
            if (personaRole !== 'student' && session.folder !== 'student') {
                if (session.folder) {
                    window.location.replace(`${rootPrefix}${session.folder}/index.html`);
                    return;
                }
                redirectToLogin(false);
                return;
            }
        }

        if (currentPath.includes('/std-') && session.folder && !currentPath.includes(`/${session.folder}/`)) {
            guardFlash('您走錯教室囉！即將為您導回專屬教室。', function () {
                window.location.replace(`${rootPrefix}${session.folder}/index.html`);
            });
            return;
        }

    } catch (error) {
        console.error('🚨 登入狀態解析失敗：', error);
        localStorage.removeItem('LogOnEnglish_Session');
        redirectToLogin(false);
    }
})();

window.logoutToLogin = async function(clearAll) {
    console.log('🚪 執行登出程序...');

    if (clearAll) {
        localStorage.clear();
        sessionStorage.clear();
    } else {
        localStorage.removeItem('LogOnEnglish_Session');
        localStorage.removeItem('activeClassId');
        localStorage.removeItem('activeRole');
        sessionStorage.clear();
    }

    if (window.supabaseClient && window.supabaseClient.auth) {
        try { await window.supabaseClient.auth.signOut(); } catch (e) {}
    }

    const url = window.buildLoginUrl
        ? window.buildLoginUrl(!!clearAll)
        : '../index.html?_=' + Date.now();
    window.location.replace(url);
};

window.logoutUser = function() {
    return window.logoutToLogin(false);
};

/**
 * 📂 檔案路徑：020_js_core/auth-guard.js
 * 描述：零信任前端防護網與登出邏輯。
 * 🌟 v6.1 SaaS 鐵桶防禦版：導入嚴格的情境身分制 (Contextual Multi-Persona) 路由防護
 */

(function() {
    const sessionString = localStorage.getItem('LogOnEnglish_Session');
    const currentPath = window.location.pathname;
    
    // 自動判定相對路徑前綴
    const isRoot = currentPath.endsWith('/') || currentPath.endsWith('index.html') && !currentPath.includes('/');
    const rootPrefix = isRoot ? './' : '../';
    const loginPageUrl = `${rootPrefix}index.html`;

    if (!sessionString) {
        console.warn('⚠️ 未經授權的訪問，即將導向登入頁。');
        window.location.replace(loginPageUrl);
        return; 
    }

    try {
        const session = JSON.parse(sessionString);
        
        // 取得最高權限判定與當前選擇的身份
        const isGlobalAdmin = session.role === 'admin' || session.default_role === 'admin';
        const activeRole = localStorage.getItem('activeRole') || session.role;
        
        // 🛡️ 防禦 A：企圖闖入 Admin 後台
        if (currentPath.includes('/admin/')) {
            if (!isGlobalAdmin) {
                alert('🚫 越權存取：您不具備全域管理員 (Admin) 權限！');
                window.location.replace(loginPageUrl);
                return;
            }
        }

        // 🛡️ 防禦 B：企圖闖入 Teacher 教職員內部控制台
        if (currentPath.includes('/teacher/') || currentPath.includes('110_teacher_core')) {
            const isStaff = isGlobalAdmin || ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior', 'teacher'].includes(activeRole);
            if (!isStaff) {
                alert('🚫 越權存取：此區域僅限教職員工進入。');
                window.location.replace(loginPageUrl);
                return;
            }
        }

        // 🛡️ 防禦 C：學生走錯教室防護
        if (currentPath.includes('/std-') && session.folder && !currentPath.includes(`/${session.folder}/`)) {
            alert('您走錯教室囉！即將為您導回專屬教室。');
            window.location.replace(`../${session.folder}/index.html`);
            return;
        }

    } catch (error) {
        console.error('🚨 登入狀態解析失敗：', error);
        localStorage.removeItem('LogOnEnglish_Session');
        window.location.replace(loginPageUrl);
    }
})();

// 執行登出動作
window.logoutUser = async function() {
    console.log("🚪 執行登出程序...");
    
    // 徹底銷毀所有長期登入憑證與身分標記
    localStorage.removeItem('LogOnEnglish_Session');
    localStorage.removeItem('activeClassId');
    localStorage.removeItem('activeRole');
    sessionStorage.clear();
    
    // 斷開 Supabase 雲端連線
    if (window.supabaseClient && window.supabaseClient.auth) {
        try { await window.supabaseClient.auth.signOut(); } catch(e) {}
    }
    
    // 強制導回主入口
    const isRoot = window.location.pathname.endsWith('/') || window.location.pathname.endsWith('index.html') && !window.location.pathname.includes('/');
    window.location.replace(isRoot ? './index.html' : '../index.html');
};

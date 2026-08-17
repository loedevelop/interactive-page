/**
 * 📂 檔案路徑：020_js_core/supabase-client.js
 * 🌟 v6.1 SaaS 橋接版：剝奪資料庫直連權限，全面交由 ApiService 供水
 */

const { createClient } = window.supabase;
const supabaseUrl = 'https://ueigcfdpnsohmkavbzmw.supabase.co'; 
const supabaseKey = 'sb_publishable_Ps-C0ZFw5FlV07GGgFCJfw_jvdXSaRw';
const supabaseClient = createClient(supabaseUrl, supabaseKey);

window.supabaseClient = supabaseClient; 
console.log("✅ Supabase 雲端 V6 引擎已成功掛載！(純淨橋接版)");

function toLocalISODate(dateObj) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
        if (meetDaysArray.includes(curr.getDay())) {
            dates.push(toLocalISODate(curr));
        }
        curr.setDate(curr.getDate() + 1);
    }
    return dates;
}

// 🚀 正式升級為純粹的狀態橋接器 (拔除所有 .from 查詢，完全依賴 ApiService)
window.TeacherDB = {
    classes: [],
    resources: [], 
    sessions: {},
    assignments: [],
    studentProgress: [],
    
    load: async () => {
        console.log(`⏳ [TeacherDB] 準備向 ApiService 請求最新雲端狀態...`);
        try {
            if (!window.ApiService || typeof window.ApiService.fetchClasses !== 'function') {
                throw new Error("ApiService 尚未就緒！請確認 api.js 的引入順序。");
            }

            const sessionStr = localStorage.getItem('LogOnEnglish_Session');
            if (!sessionStr) return false;
            const session = JSON.parse(sessionStr);

            // 🚀 效能：fetchClasses／fetchAssignments 彼此不互相依賴（各自從 localStorage 讀
            // session、各自查權限），之前卻寫成先 await 完 A 才做 B，等於白白多等一趟網路來回。
            // 改成平行送出，reload 時間取兩者較長的那個，不是兩者相加。
            const [validClasses, fetchedAssignments] = await Promise.all([
                window.ApiService.fetchClasses(),
                window.ApiService.fetchAssignments(session.id)
            ]);

            window.TeacherDB.classes = validClasses.map(cls => ({
                id: cls.id,
                name: cls.name,
                icon: cls.icon || '📘',
                startDate: cls.startDate, 
                endDate: cls.endDate, 
                meetDays: cls.meetDays, 
                calcMode: cls.calcMode, 
                resources: cls.resources || [], 
                students: cls.students || [], 
                staff_role: cls.staff_role,
                currentUserRole: cls.staff_role,
                raw_data: cls.raw_data,
                rawData: cls.rawData
            }));

            // B：重建排程日期 (供 Timeline 模組使用)
            window.TeacherDB.sessions = {};
            window.TeacherDB.classes.forEach(cls => {
                if (cls.startDate && cls.endDate && cls.meetDays && cls.meetDays.length > 0) {
                    window.TeacherDB.sessions[cls.id] = generateDates(cls.startDate, cls.endDate, cls.meetDays);
                } else {
                    window.TeacherDB.sessions[cls.id] = [];
                }
            });
            console.log("📅 成功重建各班級排程日期:", window.TeacherDB.sessions);
            
            // C：作業清單已在上面平行抓好，這裡直接接住結果即可
            window.TeacherDB.assignments = fetchedAssignments;

            console.log("✅ [TeacherDB] 成功載入並初始化 TeacherDB 狀態!");
            return true;
        } catch (error) {
            console.error("❌ [TeacherDB] 狀態同步失敗:", error);
            return false;
        }
    },
    
    save: () => {
        console.warn("⚠️ [TeacherDB] save() 方法已棄用，寫入操作已全面轉交 API 處理。");
    }
};

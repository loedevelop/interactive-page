/**
 * 檔案：js/config.js
 * 描述：全域常數與 Mock Data 合約。模擬未來 Supabase 的資料結構。
 */

const APP_CONFIG = {
    ENV: {
        USE_MOCK_DATA: true, 
    },
    EVENTS: {
        DATA_LOADED: "app:data-loaded",
        PROGRESS_UPDATED: "app:progress-updated"
    }
};

Object.freeze(APP_CONFIG);

/**
 * 🛡️ Mock Data 合約：嚴格對應未來的關聯式資料庫 (Assignments & Tasks)
 */
const MockServices = {
    getStudentAssignments: async (studentId) => {
        // 模擬網路延遲
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return [
            {
                assignment_id: "ASSIGN_WEEK_1",
                class_id: "CLASS_001",
                // 🎯 彈性核心：陣列支援單堂或按週結算
                covered_dates: ["2026-05-31", "2026-06-02"], 
                display_title: "2026/05/31 & 06/02 Homework",
                teacher_message: "老師的話：請於課前提供我作業完成清單，加油！💪",
                tasks: [
                    { task_id: "t1", title: "1. Azar textbook : 3-6", desc: "寫完、對完答案、檢測錯誤、記錄題目", action_type: "none" },
                    { task_id: "t2", title: "3. GEPT-2 : pp. 6~7", desc: "小考＋訂正", action_type: "exam", action_url: "#", action_text: "前往測驗" },
                    { task_id: "t3", title: "5. GEPT-2 : pp. 1~7 錄音", desc: "每句英文 x2 (錄音檔上傳)", action_type: "upload", action_url: "#", action_text: "📤 繳交" }
                ]
            },
            {
                assignment_id: "ASSIGN_WEEK_2",
                class_id: "CLASS_001",
                covered_dates: ["2026-06-07"], 
                display_title: "2026/06/07 Homework",
                teacher_message: "老師的話：單堂作業，請務必完成喔！",
                tasks: [
                    { task_id: "t4", title: "1. Irregular Verbs : 小考 pp. 5~7", desc: "小考＋訂正", action_type: "exam", action_url: "#", action_text: "前往測驗" }
                ]
            }
        ];
    }
};

window.APP_CONFIG = APP_CONFIG;
window.MockServices = MockServices;

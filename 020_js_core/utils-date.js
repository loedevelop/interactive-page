/**
 * 📂 檔案路徑：020_js_core/utils-date.js
 * 🌟 系統日期處理工具箱 (Fortified Pure Date Utilities)
 * 升級：加入 safeParse 強力解析引擎，免疫所有 ISO 時間戳與格式變異引發的崩潰。
 */
window.UtilsDate = (() => {
    'use strict';

    /**
     * 🛡️ 金剛不壞解析器：將任何格式的日期字串安全轉換為 Date 物件
     */
    function safeParse(dStr) {
        if (!dStr) return null;
        // 濾除 Supabase 傳回的 ISO 時間戳 (T 之後的部分)
        let s = typeof dStr === 'string' ? dStr.split('T')[0] : String(dStr);
        let parts = s.split(/[-/]/);
        
        if (parts.length === 3) {
            // 處理 YYYY-MM-DD
            if (parts[0].length === 4) return new Date(parts[0], parts[1] - 1, parts[2]); 
            // 處理 MM/DD/YYYY (防止瀏覽器相容性問題)
            if (parts[2].length === 4) return new Date(parts[2], parts[0] - 1, parts[1]); 
        }
        
        let d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    /**
     * 將 Date 物件轉換為本地 YYYY-MM-DD 字串
     */
    function toLocalISODate(dateObj) {
        if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    /**
     * 解析各式日期字串格式並標準化為 YYYY-MM-DD
     */
    function normalizeDateString(dStr) {
        const d = safeParse(dStr);
        return d ? toLocalISODate(d) : '';
    }

    /**
     * 推演指定區間與星期幾的所有合法上課日陣列
     */
    function generateDates(startStr, endStr, meetDaysArray) {
        if (!startStr || !endStr || !meetDaysArray || meetDaysArray.length === 0) return [];
        
        const curr = safeParse(startStr);
        const end = safeParse(endStr);
        if (!curr || !end) return [];
        
        end.setHours(23, 59, 59, 999);
        const dates = [];
        
        while (curr <= end) {
            if (meetDaysArray.includes(curr.getDay())) {
                dates.push(toLocalISODate(curr));
            }
            curr.setDate(curr.getDate() + 1);
        }
        
        return dates;
    }

    /**
     * 計算給定日期所在週的第一天字串
     */
    function getWeekStartStr(dateStr, weekStartDay = 'sunday') {
        const dt = safeParse(dateStr);
        if (!dt) return '';
        
        let day = dt.getDay(); 
        if (weekStartDay === 'monday') {
            let diff = day === 0 ? 6 : day - 1;
            dt.setDate(dt.getDate() - diff);
        } else {
            dt.setDate(dt.getDate() - day);
        }
        
        return toLocalISODate(dt);
    }

    /**
     * 取得台灣時區當前 YYYY-MM-DD 字串
     */
    function getTaiwanTodayString() {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', { 
                timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' 
            });
            return formatter.format(new Date()); 
        } catch(e) {
            return toLocalISODate(new Date()); 
        }
    }

    function parseLocalDate(dateStr) {
        return safeParse(dateStr) || new Date();
    }

    return {
        toLocalISODate,
        getTaiwanTodayString,
        normalizeDateString,
        generateDates,
        getWeekStartStr,
        parseLocalDate
    };
})();
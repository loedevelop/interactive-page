/**
 * 📂 檔案路徑：020_js_core/utils-date.js
 * 🌟 系統日期處理工具箱 (Pure Date Utilities)
 * 封裝所有日期計算、格式化、時區推導等無狀態純函式。
 */

window.UtilsDate = (() => {
    /**
     * 將 Date 物件轉換為本地 YYYY-MM-DD 字串
     * @param {Date} dateObj
     * @returns {string}
     */
    function toLocalISODate(dateObj) {
        if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    /**
     * 取得台灣時區當前 YYYY-MM-DD 字串
     * @returns {string}
     */
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

    /**
     * 解析各式日期字串格式並標準化為 YYYY-MM-DD
     * @param {string} dStr
     * @returns {string}
     */
    function normalizeDateString(dStr) {
        if (!dStr) return '';
        
        if (dStr.includes('-')) {
            const parts = dStr.split('-');
            if (parts[0].length === 4) {
                return dStr; 
            }
        }
        
        if (dStr.includes('/')) {
            const parts = dStr.split('/');
            if (parts.length === 3) {
                if (parts[2].length === 4) {
                    return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
                }
                if (parts[0].length === 4) {
                    return `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
                }
            }
        }
        
        const d = new Date(dStr);
        if (!isNaN(d.getTime())) {
            return toLocalISODate(d);
        }
        
        return dStr;
    }

    /**
     * 推演指定區間與星期幾的所有合法上課日陣列
     * @param {string} startStr - YYYY-MM-DD
     * @param {string} endStr - YYYY-MM-DD
     * @param {Array<number>} meetDaysArray - 星期日(0) ~ 星期六(6)
     * @returns {Array<string>} YYYY-MM-DD 陣列
     */
    function generateDates(startStr, endStr, meetDaysArray) {
        if (!startStr || !endStr || !meetDaysArray || meetDaysArray.length === 0) {
            return [];
        }
        
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

    /**
     * 計算給定日期所在週的第一天字串
     * @param {string} dateStr
     * @param {string} weekStartDay - 'sunday' or 'monday'
     * @returns {string}
     */
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

    /**
     * 安全解析本地 YYYY-MM-DD 為 Date 物件 (避開 UTC 時差跑偏)
     * @param {string} dateStr
     * @returns {Date}
     */
    function parseLocalDate(dateStr) {
        if (!dateStr) return new Date();
        const [y, m, d] = dateStr.split('-');
        return new Date(y, m - 1, d);
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
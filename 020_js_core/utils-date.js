/**
 * 📂 檔案路徑：020_js_core/utils-date.js
 * 🌟 系統日期處理工具箱 (Fortified Pure Date Utilities)
 * 升級：徹底收編所有散落於各模組的 new Date() 與「逾期比對」邏輯。
 */
window.UtilsDate = (() => {
    'use strict';

    function safeParse(dStr) {
        if (!dStr) return null;
        let s = typeof dStr === 'string' ? dStr.split('T')[0] : String(dStr);
        let parts = s.split(/[-/]/);
        
        if (parts.length === 3) {
            if (parts[0].length === 4) return new Date(parts[0], parts[1] - 1, parts[2]); 
            if (parts[2].length === 4) return new Date(parts[2], parts[0] - 1, parts[1]); 
        }
        
        let d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    function toLocalISODate(dateObj) {
        if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function normalizeDateString(dStr) {
        const d = safeParse(dStr);
        return d ? toLocalISODate(d) : '';
    }

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

    // 🌟 收編 1：取得台灣時區「今天」的標準化字串
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

    // 🌟 收編 2：統一提供 ISO 時間戳 (供資料庫寫入 deleted_at 使用)
    function getTaiwanIsoTimestamp() {
        return new Date().toISOString();
    }

    // 🌟 收編 3：將散落於學生端的「逾期判定髒邏輯」收編為 Pure Function
    function isPastDue(targetDateStr) {
        if (!targetDateStr) return false;
        const target = safeParse(targetDateStr);
        if (!target) return false;
        
        const today = safeParse(getTaiwanTodayString()); 
        if (!today) return false;

        target.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        
        return today > target;
    }

    /** 日期 → Drive 後綴 YYYYMMDD（缺省用台灣今日） */
    function dateToFolderSuffix(dateStr) {
        const norm = normalizeDateString(dateStr);
        if (!norm) return getTaiwanTodayString().replace(/-/g, '');
        return norm.replace(/-/g, '');
    }

    /** Drive 班級資料夾名：{老師自設班名}_{開課日期 YYYYMMDD} */
    function buildClassDriveFolderName(displayName, startDateStr) {
        const safe = String(displayName || '班級').replace(/[\\/:*?"<>|]/g, '_').trim();
        return safe + '_' + dateToFolderSuffix(startDateStr);
    }

    return {
        toLocalISODate,
        getTaiwanTodayString,
        normalizeDateString,
        generateDates,
        getWeekStartStr,
        parseLocalDate,
        getTaiwanIsoTimestamp,
        isPastDue,
        dateToFolderSuffix,
        buildClassDriveFolderName
    };
})();
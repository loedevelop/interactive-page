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
    function stampDatePart(value) {
        const s = String(value == null ? '' : value).trim();
        if (!s) return '';
        const m = s.match(/(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        return normalizeDateString(s);
    }

    function stampTimePart(value) {
        const s = String(value == null ? '' : value).trim();
        if (!s) return '';
        const m = s.match(/T(\d{2}:\d{2})/);
        if (m) return m[1];
        const m2 = s.match(/\s(\d{2}:\d{2})/);
        return m2 ? m2[1] : '';
    }

    function combineStamp(dateStr, timeStr) {
        const d = String(dateStr || '').trim();
        const t = String(timeStr || '').trim().slice(0, 5);
        if (!d) return '';
        if (!t) return d;
        return d + 'T' + t;
    }

    function inheritStamp(own, parent) {
        const s = String(own || '').trim();
        if (s) return s;
        return String(parent || '').trim();
    }

    function parseTaiwanLocal(dateStr, timeStr) {
        const date = stampDatePart(dateStr);
        if (!date) return null;
        const parts = date.split('-').map(Number);
        if (parts.length !== 3 || !parts[0]) return null;
        let hh = 0;
        let mm = 0;
        const t = String(timeStr || '').trim();
        if (t) {
            const tp = t.split(':');
            hh = Number(tp[0]) || 0;
            mm = Number(tp[1]) || 0;
        }
        return new Date(parts[0], parts[1] - 1, parts[2], hh, mm, 0, 0);
    }

    function formatStampLabel(value) {
        const date = stampDatePart(value);
        const time = stampTimePart(value);
        if (!date) return '';
        if (!time) return date;
        return date + ' ' + time;
    }

    function readCombinedStamp(dateInputId, timeInputId) {
        const dateEl = document.getElementById(dateInputId);
        const timeEl = document.getElementById(timeInputId);
        return combineStamp(dateEl && dateEl.value, timeEl && timeEl.value);
    }

    function dateTimeInputHtml(dateId, timeId, stored, extraDateStyle, extraTimeStyle) {
        const dateVal = stampDatePart(stored);
        const timeVal = stampTimePart(stored);
        const dStyle = extraDateStyle || 'width:auto; padding:4px 8px; font-size:0.9rem;';
        const tStyle = extraTimeStyle || 'width:110px; padding:4px 8px; font-size:0.9rem;';
        return '<input type="date" id="' + dateId + '" class="form-control" style="' + dStyle + '" value="' + dateVal + '">'
            + '<input type="time" id="' + timeId + '" class="form-control" style="' + tStyle + '" value="' + timeVal + '" title="可不填">';
    }

    /** 沒填開放＝可見。只填日＝該日 00:00。對不到格式＝沒有特別設定＝可見。 */
    function isOpenYet(openStamp) {
        const s = String(openStamp || '').trim();
        if (!s) return true;
        const date = stampDatePart(s);
        if (!date) return true;
        const time = stampTimePart(s) || '00:00';
        const d = parseTaiwanLocal(date, time);
        if (!d) return true;
        return Date.now() >= d.getTime();
    }

    function isPastDue(targetDateStr) {
        if (!targetDateStr) return false;
        const s = String(targetDateStr).trim();
        const time = /T\d{2}:\d{2}/.test(s) ? stampTimePart(s) : '';
        if (time) {
            const d = parseTaiwanLocal(s, time);
            if (!d) return false;
            return Date.now() > d.getTime();
        }
        const target = safeParse(targetDateStr);
        if (!target) return false;
        const today = safeParse(getTaiwanTodayString());
        if (!today) return false;
        target.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        return today > target;
    }

    function parseTaskList(tasks) {
        if (Array.isArray(tasks)) return tasks;
        if (typeof tasks === 'string') {
            try {
                const parsed = JSON.parse(tasks);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_e) {
                return [];
            }
        }
        return [];
    }

    function findTaskOpenHit(tasks, taskId, parentOpen) {
        const list = parseTaskList(tasks);
        for (let i = 0; i < list.length; i++) {
            const t = list[i];
            if (!t) continue;
            const eff = inheritStamp(t.open_at, parentOpen);
            if (String(t.id) === String(taskId)) return { task: t, openAt: eff };
            if (t.subTasks) {
                const hit = findTaskOpenHit(t.subTasks, taskId, eff);
                if (hit) return hit;
            }
        }
        return null;
    }

    function canStudentSeeAssignment(assignment) {
        if (!assignment) return false;
        if (assignment.is_published === false) return false;
        return isOpenYet(assignment.open_at);
    }

    function canStudentSeeTask(assignment, taskId) {
        if (!canStudentSeeAssignment(assignment)) return false;
        const hit = findTaskOpenHit(assignment.tasks, taskId, assignment.open_at);
        if (!hit) return false;
        return isOpenYet(hit.openAt);
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
        stampDatePart,
        stampTimePart,
        combineStamp,
        inheritStamp,
        formatStampLabel,
        readCombinedStamp,
        dateTimeInputHtml,
        isOpenYet,
        parseTaskList,
        canStudentSeeAssignment,
        canStudentSeeTask,
        dateToFolderSuffix,
        buildClassDriveFolderName
    };
})();
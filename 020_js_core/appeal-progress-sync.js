/**
 * 📂 020_js_core/appeal-progress-sync.js
 * 🎯 職責：申訴審核即時同步——共用的「什麼時候該重新查詢」計時器／訂閱器。
 *
 * 只管「時機」，不管「查什麼」：真正打 API／RPC 的動作交給呼叫端的 onUpdate 回呼。
 * 兩條腿都有：
 *   1. Realtime broadcast（appeal-progress:{assignmentId}:{taskId} 頻道）——老師端存檔
 *      成功後會廣播一個純信號（不帶任何學生個資／答案內容），收到就立刻 onUpdate()。
 *   2. 15 秒輪詢——保底，防漏收廣播（離線／頻道斷線）時還能補上。
 * 呼叫端負責在畫面關閉時呼叫 unsubscribe，不要留著背景一直跑（page-refresh-perf-invariant 精神）。
 */
window.AppealProgressSync = (function () {
    'use strict';

    const POLL_MS = 15000;

    function topicOf(assignmentId, taskId) {
        return 'appeal-progress:' + assignmentId + ':' + taskId;
    }

    /**
     * @param {string} assignmentId
     * @param {string} taskId
     * @param {string} _classId 目前模組內部不需要用（頻道只靠 assignmentId+taskId 命名），
     *   保留參數是因為呼叫端（真正查資料的 RPC）需要 classId；簽名維持一致比較好記。
     * @param {Function} onUpdate 沒有參數，純粹「該重新查一次了」的訊號
     * @returns {{channel:any, intervalId:any, closed:boolean}} handle，交給 unsubscribe 用
     */
    function subscribe(assignmentId, taskId, _classId, onUpdate) {
        const handle = { channel: null, intervalId: null, closed: false };
        if (typeof onUpdate !== 'function') return handle;

        if (window.supabaseClient && typeof window.supabaseClient.channel === 'function') {
            try {
                const channel = window.supabaseClient.channel(topicOf(assignmentId, taskId));
                channel.on('broadcast', { event: 'appeal_reviewed' }, function () {
                    if (!handle.closed) onUpdate();
                });
                channel.subscribe();
                handle.channel = channel;
            } catch (err) {
                console.warn('[AppealProgressSync] subscribe channel failed', err);
            }
        }

        handle.intervalId = setInterval(function () {
            if (!handle.closed) onUpdate();
        }, POLL_MS);

        return handle;
    }

    function unsubscribe(handle) {
        if (!handle) return;
        handle.closed = true;
        if (handle.intervalId) {
            clearInterval(handle.intervalId);
            handle.intervalId = null;
        }
        if (handle.channel && window.supabaseClient && typeof window.supabaseClient.removeChannel === 'function') {
            window.supabaseClient.removeChannel(handle.channel);
            handle.channel = null;
        }
    }

    return {
        subscribe: subscribe,
        unsubscribe: unsubscribe
    };
})();

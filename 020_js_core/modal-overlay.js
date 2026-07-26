/**
 * 📂 020_js_core/modal-overlay.js
 * Popup 分級：A 點視窗外=關閉 | B 未儲存 guard | C 禁止 backdrop 關閉
 */
window.ModalOverlay = (function () {
    'use strict';

    var activeId = null;

    function close(id) {
        var targetId = id || activeId;
        if (!targetId) return;
        var el = document.getElementById(targetId);
        if (el) el.remove();
        if (activeId === targetId) activeId = null;
    }

    function open(options) {
        options = options || {};
        var id = options.id || ('modal-overlay-' + Date.now());
        if (options.replace !== false) close(activeId);

        var overlay = document.createElement('div');
        overlay.id = id;
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:9999;backdrop-filter:blur(2px);overflow-y:auto;padding:20px;box-sizing:border-box;';
        overlay.innerHTML = options.contentHtml || '';

        var tier = options.tier || 'A';
        if (tier !== 'C') {
            overlay.addEventListener('click', function (e) {
                if (e.target !== overlay) return;
                if (tier === 'B' && typeof options.isDirty === 'function' && options.isDirty()) {
                    var msg = options.unsavedMessage || '有未儲存的變更，確定要關閉嗎？';
                    if (!confirm(msg)) return;
                }
                if (typeof options.onCancel === 'function') options.onCancel();
                close(id);
            });
        }

        document.body.appendChild(overlay);
        activeId = id;
        if (typeof options.onMount === 'function') options.onMount(overlay);
        return id;
    }

    return {
        open: open,
        close: close,
        getActiveId: function () { return activeId; }
    };
})();

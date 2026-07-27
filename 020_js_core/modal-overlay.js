/**
 * 📂 020_js_core/modal-overlay.js
 * 全站 popup 唯一入口。關閉行為由 tier 中央控管，禁止各功能自建 overlay。
 *
 * A：點視窗外 = 取消 = 關閉
 * B：點視窗外 → 若 isDirty() 先 confirm，再關閉
 * C：禁止 backdrop 關閉（僅按鈕／程式 close）
 */
window.ModalOverlay = (function () {
    'use strict';

    var activeId = null;
    /** @type {Record<string, { onClose?: Function, onCancel?: Function, tier: string, isDirty?: Function, unsavedMessage?: string }>} */
    var registry = {};

    function cleanupRegistry(id) {
        var meta = registry[id];
        delete registry[id];
        return meta || null;
    }

    function close(id) {
        var targetId = id || activeId;
        if (!targetId) return;
        var el = document.getElementById(targetId);
        var meta = cleanupRegistry(targetId);
        if (el) el.remove();
        if (activeId === targetId) activeId = null;
        if (meta && typeof meta.onClose === 'function') {
            try { meta.onClose(); } catch (_e) { /* ignore */ }
        }
    }

    /**
     * @param {object} options
     * @param {string} [options.id]
     * @param {'A'|'B'|'C'} options.tier  必填；省略時視為 A 並 console.warn
     * @param {string} [options.contentHtml]
     * @param {boolean} [options.replace=true]
     * @param {() => boolean} [options.isDirty]  B 級用
     * @param {string} [options.unsavedMessage]
     * @param {() => void} [options.onCancel]  使用者取消（backdrop）時，close 前呼叫
     * @param {() => void} [options.onClose]   任何方式關閉後呼叫（含按鈕 close）
     * @param {(el: HTMLElement) => void} [options.onMount]
     */
    function open(options) {
        options = options || {};
        var id = options.id || ('modal-overlay-' + Date.now());
        if (options.replace !== false) close(activeId);

        var tier = options.tier;
        if (!tier) {
            tier = 'A';
            console.warn('[ModalOverlay] 未宣告 tier，已預設 A。新 popup 必須明確傳 tier: "A"|"B"|"C"。id=', id);
        }
        tier = String(tier).toUpperCase();
        if (tier !== 'A' && tier !== 'B' && tier !== 'C') {
            console.warn('[ModalOverlay] 無效 tier=', options.tier, '，改用 A。id=', id);
            tier = 'A';
        }

        var overlay = document.createElement('div');
        overlay.id = id;
        overlay.setAttribute('data-modal-tier', tier);
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:9999;backdrop-filter:blur(2px);overflow-y:auto;padding:20px;box-sizing:border-box;';
        overlay.innerHTML = options.contentHtml || '';

        registry[id] = {
            tier: tier,
            isDirty: options.isDirty,
            unsavedMessage: options.unsavedMessage,
            onCancel: options.onCancel,
            onClose: options.onClose
        };

        if (tier !== 'C') {
            overlay.addEventListener('click', function (e) {
                if (e.target !== overlay) return;
                var meta = registry[id];
                if (!meta) return;
                if (meta.tier === 'B' && typeof meta.isDirty === 'function' && meta.isDirty()) {
                    var msg = meta.unsavedMessage || '有未儲存的變更，確定要關閉嗎？';
                    if (!confirm(msg)) return;
                }
                if (typeof meta.onCancel === 'function') {
                    try { meta.onCancel(); } catch (_e) { /* ignore */ }
                }
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
        getActiveId: function () { return activeId; },
        getTier: function (id) {
            var meta = registry[id || activeId];
            return meta ? meta.tier : null;
        }
    };
})();

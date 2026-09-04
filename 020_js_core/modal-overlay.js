/**
 * 📂 020_js_core/modal-overlay.js
 * 全站 popup 唯一入口。關閉行為由 tier 中央控管，禁止各功能自建 overlay。
 * 版面走 010_css/style.css（.modal-overlay / .modal-overlay--prompt）。
 *
 * A：點視窗外 = 離開
 * B：點視窗外 → 沒改過就離開；有 unsaved 才先問
 * C：禁止 backdrop 關閉（僅按鈕／程式 close）
 *
 * 禁止 window.confirm。
 */
window.ModalOverlay = (function () {
    'use strict';

    var activeId = null;
    var stack = [];
    /** @type {Record<string, { onClose?: Function, onCancel?: Function, tier: string, isDirty?: Function, unsavedMessage?: string }>} */
    var registry = {};

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function cleanupRegistry(id) {
        var meta = registry[id];
        delete registry[id];
        return meta || null;
    }

    /**
     * 直接關閉，不再問。儲存成功後請走這條。
     * @param {string} [id]
     */
    function close(id) {
        var targetId = id || activeId;
        if (!targetId) return;
        var el = document.getElementById(targetId);
        var meta = cleanupRegistry(targetId);
        if (el) el.remove();
        stack = stack.filter(function (x) { return x !== targetId; });
        if (activeId === targetId) activeId = stack.length ? stack[stack.length - 1] : null;
        if (meta && typeof meta.onClose === 'function') {
            try { meta.onClose(); } catch (_e) { /* ignore */ }
        }
    }

    function shouldConfirmClose(id) {
        var meta = registry[id];
        var el = document.getElementById(id);
        if (!meta) return false;
        if (el && el.getAttribute('data-mo-busy') === '1') return false;
        return typeof meta.isDirty === 'function' && !!meta.isDirty();
    }

    // 只有「按下＋放開都在灰色 overlay 本身」才算出面。
    // 不准用座標範圍、也不准用 !panel.contains(target)：點籤時若節點被重繪拿掉，
    // contains 會變 false，中間偏上的大題籤就會被當成點外面而跳出。
    function clickedOutsidePanel(overlay, target) {
        return !!(overlay && target === overlay);
    }

    function overlayParent() {
        var host = document.fullscreenElement
            || document.webkitFullscreenElement
            || document.msFullscreenElement;
        if (host && host.nodeType === 1) return host;
        return document.body;
    }

    /**
     * 使用者要離開：沒改過／只是提示 → 直接關；有未存變更才問一次。
     * 儲存中（busy）不准問尚未儲存，取消＝離開，不准卡死。
     */
    function requestClose(id) {
        var targetId = id || activeId;
        if (!targetId) return Promise.resolve(false);
        var meta = registry[targetId];
        var el = document.getElementById(targetId);
        if (el && el.getAttribute('data-mo-busy') === '1') {
            if (meta && typeof meta.onCancel === 'function') {
                try { meta.onCancel(); } catch (_e) { /* ignore */ }
            }
            close(targetId);
            return Promise.resolve(true);
        }
        if (!shouldConfirmClose(targetId)) {
            if (meta && typeof meta.onCancel === 'function') {
                try { meta.onCancel(); } catch (_e) { /* ignore */ }
            }
            close(targetId);
            return Promise.resolve(true);
        }
        var msg = (meta && meta.unsavedMessage) || '有未儲存的變更，確定要關閉嗎？';
        return confirmDialog(msg).then(function (ok) {
            if (!ok) return false;
            if (meta && typeof meta.onCancel === 'function') {
                try { meta.onCancel(); } catch (_e) { /* ignore */ }
            }
            close(targetId);
            return true;
        });
    }

    /**
     * @param {object} options
     * @param {string} [options.id]
     * @param {'A'|'B'|'C'} options.tier  必填；省略時視為 A 並 console.warn
     * @param {string} [options.contentHtml]
     * @param {boolean} [options.replace=true]
     * @param {boolean} [options.prompt]  提示／確認：距頂 1/3（CSS .modal-overlay--prompt）
     * @param {number} [options.zIndex]
     * @param {() => boolean} [options.isDirty]  有未存變更才擋離開
     * @param {string} [options.unsavedMessage]
     * @param {() => void} [options.onCancel]
     * @param {() => void} [options.onClose]
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
        overlay.className = 'modal-overlay' + (options.prompt ? ' modal-overlay--prompt' : '');
        overlay.style.display = 'flex';
        overlay.setAttribute('data-modal-tier', tier);
        if (options.zIndex) overlay.style.zIndex = String(options.zIndex);
        overlay.innerHTML = options.contentHtml || '';

        registry[id] = {
            tier: tier,
            isDirty: options.isDirty,
            unsavedMessage: options.unsavedMessage,
            onCancel: options.onCancel,
            onClose: options.onClose
        };

        if (tier !== 'C') {
            overlay.addEventListener('pointerdown', function (e) {
                overlay.setAttribute('data-mo-backdrop-down', clickedOutsidePanel(overlay, e.target) ? '1' : '0');
            });
            overlay.addEventListener('click', function (e) {
                var startedOnBackdrop = overlay.getAttribute('data-mo-backdrop-down') === '1';
                overlay.removeAttribute('data-mo-backdrop-down');
                if (!startedOnBackdrop) return;
                if (!clickedOutsidePanel(overlay, e.target)) return;
                requestClose(id);
            });
        }

        // 全螢幕時，掛在 body 上的節點通常看不見。確認框／第二層 popup 必須是
        // fullscreen 那個節點的小孩，學生才能看到「確定要關閉嗎？」。
        overlayParent().appendChild(overlay);
        if (stack.indexOf(id) === -1) stack.push(id);
        activeId = id;
        if (typeof options.onMount === 'function') options.onMount(overlay);
        return id;
    }

    function setBusy(id, busy) {
        var el = document.getElementById(id || activeId);
        if (!el) return;
        if (busy) el.setAttribute('data-mo-busy', '1');
        else el.removeAttribute('data-mo-busy');
    }

    /**
     * 提示／確認框。點外面＝離開（取消）。回傳 Promise<boolean>。
     */
    function confirmDialog(message, options) {
        options = options || {};
        var text = String(message == null ? '' : message);
        return new Promise(function (resolve) {
            var id = 'modal-overlay-confirm-' + Date.now();
            var settled = false;
            function finish(ok) {
                if (settled) return;
                settled = true;
                resolve(!!ok);
                close(id);
            }
            open({
                id: id,
                tier: 'A',
                prompt: true,
                replace: false,
                zIndex: 10050,
                contentHtml: (
                    '<div data-mo-panel role="dialog" aria-modal="true" class="modal-overlay-card">'
                    + '<div class="modal-overlay-card__msg">' + escapeHtml(text) + '</div>'
                    + '<div class="modal-overlay-card__actions">'
                    + '<button type="button" data-mo-confirm-cancel class="modal-overlay-card__cancel">' + escapeHtml(options.cancelText || '取消') + '</button>'
                    + '<button type="button" data-mo-confirm-ok class="modal-overlay-card__ok">' + escapeHtml(options.okText || '確定') + '</button>'
                    + '</div></div>'
                ),
                onClose: function () {
                    if (!settled) {
                        settled = true;
                        resolve(false);
                    }
                },
                onMount: function (el) {
                    var okBtn = el.querySelector('[data-mo-confirm-ok]');
                    var cancelBtn = el.querySelector('[data-mo-confirm-cancel]');
                    if (okBtn) okBtn.addEventListener('click', function () { finish(true); });
                    if (cancelBtn) cancelBtn.addEventListener('click', function () { finish(false); });
                    if (okBtn) okBtn.focus();
                }
            });
        });
    }

    return {
        open: open,
        close: close,
        requestClose: requestClose,
        confirm: confirmDialog,
        setBusy: setBusy,
        getActiveId: function () { return activeId; },
        getTier: function (id) {
            var meta = registry[id || activeId];
            return meta ? meta.tier : null;
        }
    };
})();

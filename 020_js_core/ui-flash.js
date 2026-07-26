/**
 * 📂 020_js_core/ui-flash.js
 * 非阻塞提示：成功／錯誤訊息自動消失（取代操作後 alert）
 */
window.showFlash = function (message, type) {
    type = type || 'success';
    var el = document.getElementById('ui-flash-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ui-flash-toast';
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10001;padding:16px 24px;border-radius:10px;font-weight:800;box-shadow:0 8px 32px rgba(0,0,0,0.18);transition:opacity 0.3s;max-width:min(420px,calc(100vw - 32px));line-height:1.5;pointer-events:none;white-space:pre-wrap;text-align:center;';
        document.body.appendChild(el);
    }
    el.style.background = type === 'error' ? '#FEE2E2' : '#ECFDF5';
    el.style.color = type === 'error' ? '#991B1B' : '#065F46';
    el.style.border = type === 'error' ? '1px solid #FECACA' : '1px solid #A7F3D0';
    el.textContent = message;
    el.style.opacity = '1';
    if (el._hideTimer) clearTimeout(el._hideTimer);
    var duration = type === 'error' ? 4200 : 2800;
    el._hideTimer = setTimeout(function () { el.style.opacity = '0'; }, duration);
};

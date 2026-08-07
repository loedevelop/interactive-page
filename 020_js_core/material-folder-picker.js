/**
 * 📂 020_js_core/material-folder-picker.js
 *
 * 共用模組：「教材資料夾（老師個人／班級）下拉清單載入 → 空清單／失敗自動重試 → 重試按鈕」
 * 這一整套控制流程。2026-08-06 老師提問「那些一樣及相似的功能，是否有做成模組」後盤點發現，
 * 這套邏輯在下面 4 個地方各自重複寫了一份（部分還漏了重試按鈕），修一次錯誤訊息／重試行為
 * 就要記得改 4 次，容易漏改、行為不一致：
 *   - 110_teacher_core/feature-material-layout-pairing.js：refreshFolderSelect（教材/考試搭配列）
 *   - 110_teacher_core/feature-material-layout-pairing.js：refreshAppFolderSelect（套用到教材列）
 *   - 110_teacher_core/feature-material-layout-pairing.js：refreshExcelFolderSelect（Excel 小工具）
 *   - 110_teacher_core/feature-exam-job.js：ensureExamMaterialFolderCatalog（獨立考試教材資料夾）
 *
 * 設計取捨：這 4 處的下拉「畫面形狀」本來就合理地不一樣（前 3 個是分離的歸屬/教材資料夾下拉，
 * exam-job 那個是老師個人＋班級資源合併在同一個 optgroup 下拉，因為考試任務已經綁定在單一班級，
 * 不需要再選一次班級）——不應該為了「統一模組」硬把畫面形狀也套成同一種，那樣反而是不合理的
 * 過度抽象。真正該共用的是「怎麼載入／怎麼判斷空清單或失敗／怎麼給重試按鈕」這套*行為*，
 * 畫面形狀（單一下拉 vs optgroup 合併）交給呼叫端自己的 renderOptionsHtml() 決定。
 *
 * 依賴：window.FeatureTimeline.ensureMetaCatalog(classId, rootKind, {force}) 已載入。
 * 這個模組不知道、也不需要知道 FeatureTimeline 內部快取怎麼實作，只負責呼叫＋分類結果＋重試。
 */
window.MaterialFolderPicker = (function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function hasTimeline() {
        return !!(window.FeatureTimeline && typeof window.FeatureTimeline.ensureMetaCatalog === 'function');
    }

    /** 重試按鈕統一外觀：所有教材資料夾／活頁下拉都共用這一顆，不要各自刻一份 */
    function retryButtonHtml(btnId, label) {
        return ' <button type="button" id="' + esc(btnId) + '" class="material-folder-picker-retry-btn" '
            + 'style="padding:2px 10px; font-size:0.72rem; font-weight:800; border:1px solid #FCA5A5; '
            + 'border-radius:4px; background:white; color:#B91C1C; cursor:pointer; vertical-align:middle;">'
            + esc(label || '🔄 重新載入') + '</button>';
    }

    function bindRetryButton(btnId, onClick) {
        const btn = document.getElementById(btnId);
        if (btn) btn.addEventListener('click', onClick);
    }

    /**
     * 通用「單一 key（某 root_kind + class_id）的資料夾下拉」刷新控制器。
     * 呼叫端負責：怎麼從 DOM 找到 select／狀態文字（getSelectEl/getStatusEl，每次都重新查，
     * 因為列可能被整個重畫過）、怎麼把候選清單畫成 <option>（renderOptionsHtml，形狀自訂）。
     * 這裡統一負責：先用目前已知的快取同步畫一次（不擋畫面）→ 清單是空的或呼叫端要求
     * force 才背景重抓 → 抓到後更新 select、成功但仍是空清單要跟連線失敗分開講清楚、
     * 兩種情況都附一顆可以無限次重試的按鈕。
     *
     * @param {Object} p
     *   p.classId, p.rootKind, p.force
     *   p.getSelectEl(): () => HTMLSelectElement|null
     *   p.getStatusEl(): () => HTMLElement|null（可省略＝不顯示狀態文字）
     *   p.listCurrentOptions(): () => string[]  從目前快取同步列出候選清單（例如 uniqueFolderNames）
     *   p.renderOptionsHtml(list, currentValue): (string[], string) => string　畫出 <option> 字串
     *   p.onAfterUpdate(): 每次 select.innerHTML 換掉之後呼叫（例如接著刷新下一層的活頁下拉）
     *   p.loadingMessage / p.emptyMessage: 可覆寫預設文案
     */
    function refreshDropdown(p) {
        const selectEl = p.getSelectEl();
        if (!selectEl) return;
        const folders = p.listCurrentOptions();
        const currentValue = selectEl.value === '__manual__' ? '' : selectEl.value;
        selectEl.innerHTML = p.renderOptionsHtml(folders, currentValue);
        if (p.onAfterUpdate) p.onAfterUpdate();

        const statusEl = p.getStatusEl ? p.getStatusEl() : null;
        const needsFetch = !folders.length || p.force;
        if (!needsFetch) {
            if (statusEl) statusEl.innerHTML = '';
            return;
        }
        if (!hasTimeline()) {
            if (statusEl) { statusEl.style.color = '#EF4444'; statusEl.innerHTML = '⚠️ FeatureTimeline 尚未載入，可用「✏️ 其他」手動輸入'; }
            return;
        }
        if (statusEl) { statusEl.style.color = '#0F766E'; statusEl.innerHTML = p.loadingMessage || '⏳ 載入資料夾清單…'; }
        const retryBtnId = 'mfp-retry-' + Math.random().toString(36).slice(2, 9);
        // 2026-08-06 老師要求「載入時，請提供訊息」：即使 GAS 冷啟動很慢或整個卡住沒有
        // resolve/reject，也不能讓「⏳ 載入資料夾清單…」停在畫面上看起來像沒反應又沒人管——
        // 20 秒還沒有結果就額外補一行提示，不取消原本的請求（原請求晚點回來還是會正常更新畫面）
        const slowTimer = setTimeout(function () {
            const slowEl = p.getStatusEl ? p.getStatusEl() : null;
            if (!slowEl || !document.body.contains(slowEl)) return;
            slowEl.innerHTML = (p.loadingMessage || '⏳ 載入資料夾清單…')
                + '<div style="margin-top:2px; color:#B45309; font-weight:700;">已經等超過 20 秒，可能是 GAS 冷啟動或連線卡住，請再耐心等一下，或直接重新整理頁面</div>';
        }, 20000);
        window.FeatureTimeline.ensureMetaCatalog(p.classId, p.rootKind, { force: !!p.force }).then(function () {
            clearTimeout(slowTimer);
            const stillEl = p.getSelectEl();
            if (!stillEl || !document.body.contains(stillEl)) return;
            const reloaded = p.listCurrentOptions();
            const stillCurrent = stillEl.value === '__manual__' ? '' : stillEl.value;
            stillEl.innerHTML = p.renderOptionsHtml(reloaded, stillCurrent);
            if (p.onAfterUpdate) p.onAfterUpdate();
            const freshStatusEl = p.getStatusEl ? p.getStatusEl() : null;
            if (!freshStatusEl) return;
            if (reloaded.length) {
                freshStatusEl.innerHTML = '';
            } else {
                freshStatusEl.style.color = '#B45309';
                // 2026-08-06：老師連續回報「明明 Drive 裡真的有子資料夾，下拉還是空的」，
                // 附上 FeatureTimeline.getMetaCatalogDebugText 的除錯資訊（GAS 版本戳記／
                // 實際解析到的資料夾 ID／GAS 數到幾個子資料夾），下次回報時直接把這行字
                // 複製貼上，不用再靠截圖互相猜測
                const debugText = hasTimeline() ? window.FeatureTimeline.getMetaCatalogDebugText(p.classId, p.rootKind) : '';
                freshStatusEl.innerHTML = (p.emptyMessage || '⚠️ 抓不到任何教材資料夾（不是連線錯誤）') + retryButtonHtml(retryBtnId)
                    + (debugText ? ('<div style="margin-top:2px; color:#78716C; font-weight:400;">' + esc(debugText) + '</div>') : '');
                bindRetryButton(retryBtnId, function () { refreshDropdown(Object.assign({}, p, { force: true })); });
            }
        }).catch(function (err) {
            clearTimeout(slowTimer);
            const stillEl = p.getSelectEl();
            if (!stillEl || !document.body.contains(stillEl)) return;
            const freshStatusEl = p.getStatusEl ? p.getStatusEl() : null;
            if (!freshStatusEl) return;
            freshStatusEl.style.color = '#EF4444';
            freshStatusEl.innerHTML = '⚠️ 清單載入失敗：' + esc(String((err && err.message) || err || '未知錯誤')) + retryButtonHtml(retryBtnId);
            bindRetryButton(retryBtnId, function () { refreshDropdown(Object.assign({}, p, { force: true })); });
        });
    }

    return {
        retryButtonHtml: retryButtonHtml,
        bindRetryButton: bindRetryButton,
        refreshDropdown: refreshDropdown
    };
})();

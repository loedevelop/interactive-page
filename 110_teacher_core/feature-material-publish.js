/**
 * 📂 110_teacher_core/feature-material-publish.js
 * 🌟 Excel → 班級 00_Class_Materials 或 老師 01_My_Materials
 *
 * 🛑 已於 2026-08-06 停用（不是砍檔案，是砍「這條產線」）：這個面板走的是
 * 「Excel 上傳到 Drive → GAS 轉成 Google 試算表 → 讀 _Config/_Schema/_Publish/_Layout
 * 四個各自獨立的活頁 → 產出 meta.json/script.txt」，正是 docs/Material_Publish_Spec.md
 * 第 35 行明文寫「~~舊誤路徑：上傳 Excel → GAS 轉 Sheets 再發布。已廢棄。~~」的那條路——
 * 但這個面板當時沒有真的被拔掉，一直留在課程基本資料頁可以按。
 *
 * 💣 這條產線至少有兩個跟現況脫節、會生出「錯誤 meta」的地方（老師實測回報「meta 的內容
 * 其實都是不正確的」極可能出在這裡）：
 * 1. GAS 端 readMaterialConfig/readSchemaDefinitions/readPublishRules 只認
 *    _Config/_Schema/_Publish/_Layout 四個各自獨立命名的活頁，完全不懂新版合併格式
 *    `_Setup`（見 material_templates/_Setup.csv、publish_local.py 的 find_setup_sections）——
 *    老師現在用的教材檔案是 `_Setup` 格式，這條舊路徑碰到會直接找不到活頁而報錯，或者
 *    （更危險）如果檔案裡還殘留舊版四個獨立活頁但欄位已經改過沒同步更新，會靜默讀到過期的
 *    欄位對應，生出內容錯誤但「看起來像成功」的 meta.json。
 * 2. 完全不知道 is_question/is_answer/is_info/is_ai_ref 這套新的欄位角色系統，也不會走
 *    「教材/Layout 搭配」中央管理端的 Layout Template／Application 資料模型。
 *
 * ✅ 正確產線（唯一，2026-08-06 起）：老師端「教材／Layout 搭配」頁 → 🧩 Layout Template
 * （設定欄位對應＋題目/答案/訊息/AI對照稿角色）→ 📎 套用到教材（選本機 Excel 活頁＋行數起迄）
 * → 🚀 產生並上傳（瀏覽器直接讀 Excel 算出 meta.json/script.txt，經 GAS upload_file
 * 直寫進 Drive 教材資料夾，不再需要先轉 Google 試算表、也不需要本機 Python CLI）。
 * 見 110_teacher_core/feature-material-layout-pairing.js、
 * .cursor/rules/material-layout-pairing-invariant.mdc 第十五輪。
 *
 * 這裡刻意保留檔案／函式骨架（不整個刪除），只是把面板換成停用公告＋連結——避免還有其他
 * 地方引用 window.FeatureMaterialPublish.mountIntoSettings 導致報錯，也讓之後真要整個
 * 移除這個檔案時，git blame／PR 歷史清楚看得到「為什麼」。
 */
window.FeatureMaterialPublish = (function () {
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getClassDriveFolderId(classId) {
        const db = window.TeacherDB;
        if (!db || !Array.isArray(db.classes)) return '';
        const cls = db.classes.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return '';
        const raw = cls.raw_data || cls.rawData || {};
        let parsed = raw;
        if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); } catch (_e) { parsed = {}; }
        }
        return parsed.drive_folder_id || parsed.class_folder_id || '';
    }

    function readSelectedRootKind() {
        const el = document.querySelector('input[name="material-publish-root"]:checked');
        return (el && el.value === 'teacher') ? 'teacher' : 'class';
    }

    async function resolveTargetFolderId(classId, rootKind) {
        if (rootKind === 'teacher') {
            if (!window.FeatureResource || typeof window.FeatureResource.getTeacherPersonalDriveFolderId !== 'function') {
                throw new Error('FeatureResource 未載入，無法取得老師個人資料夾');
            }
            let folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(true);
            if (!folderId && typeof window.FeatureResource.ensureAndBindTeacherPersonalDrive === 'function') {
                await window.FeatureResource.ensureAndBindTeacherPersonalDrive();
                folderId = await window.FeatureResource.getTeacherPersonalDriveFolderId(false);
            }
            if (!folderId) throw new Error('尚未綁定老師個人資料夾，請先至帳號設定重新綁定');
            return folderId;
        }
        const classFolderId = getClassDriveFolderId(classId);
        if (!classFolderId) throw new Error('此班級尚未設定 Drive 資料夾');
        return classFolderId;
    }

    function updateTargetHint(classId) {
        const hintEl = document.getElementById('material-publish-target-hint');
        if (!hintEl) return;
        const rootKind = readSelectedRootKind();
        if (rootKind === 'teacher') {
            hintEl.textContent = '發布目標：老師個人工作區 → 01_My_Materials/…（跨班共用母稿）';
            hintEl.style.color = '#047857';
            return;
        }
        const folderId = getClassDriveFolderId(classId);
        if (folderId) {
            hintEl.textContent = '發布目標：此班 Drive → 00_Class_Materials/…';
            hintEl.style.color = '#047857';
        } else {
            hintEl.textContent = '⚠️ 此班級尚未設定 Drive 資料夾，請先到課程基本資料建立（或改選老師個人）。';
            hintEl.style.color = '#B45309';
        }
    }

    /**
     * 2026-08-06 停用：改顯示停用公告＋導引到唯一正確產線（見檔案頂端註解）。
     * 不留任何輸入框／發布按鈕，避免老師誤用這條已知會生出錯誤 meta 的舊路徑。
     */
    function renderPanel(classId) {
        return `
            <div class="settings-card" id="material-publish-panel" style="margin-top:20px; border:2px solid #FCA5A5; background:#FEF2F2;">
                <h3 style="margin:0 0 8px; color:#B91C1C;">🛑 教材發布（此面板已停用）</h3>
                <p style="margin:0 0 10px; color:#7F1D1D; font-size:0.88rem; line-height:1.6;">
                    這裡原本是「上傳 Excel 到 Drive → GAS 轉成 Google 試算表 → 發布」的舊流程，
                    已確認會生出<strong>錯誤或過期的 meta.json</strong>（不認得新版 <code>_Setup</code> 合併活頁格式，
                    也不知道題目／答案／訊息／AI對照稿角色），已於 2026-08-06 停用，<strong>請改用</strong>：
                </p>
                <p style="margin:0; font-size:0.9rem;">
                    👉 老師端「<strong>教材／Layout 搭配</strong>」頁 → 🧩 Layout Template（設定欄位對應）→
                    📎 套用到教材 → 🚀 產生並上傳（直接在瀏覽器讀本機 Excel、算好內容後上傳到 Drive，
                    不需要先轉 Google 試算表）。
                </p>
            </div>
        `;
    }

    /** 保留函式骨架但不再實際呼叫 GAS——避免舊按鈕／舊書籤殘留呼叫時整段報錯，統一導引到新流程 */
    async function runPublish() {
        window.showFlash && window.showFlash('這個發布方式已停用，請改用「教材／Layout 搭配」頁的「套用到教材」→「產生並上傳」', 'error');
    }

    function mountIntoSettings(classId) {
        const host = document.getElementById('material-publish-mount');
        if (!host) return;
        host.innerHTML = renderPanel(classId);
    }

    return {
        renderPanel: renderPanel,
        mountIntoSettings: mountIntoSettings,
        runPublish: runPublish,
        onRootKindChange: updateTargetHint
    };
})();

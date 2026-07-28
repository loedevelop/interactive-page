/**
 * 📂 110_teacher_core/feature-material-publish.js
 * 🌟 Excel → 班級 00_Class_Materials 或 老師 01_My_Materials
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

    function renderPanel(classId) {
        const folderId = getClassDriveFolderId(classId);

        return `
            <div class="settings-card" id="material-publish-panel" style="margin-top:20px; border:2px solid #DDD6FE;">
                <h3 style="margin:0 0 8px; color:#5B21B6;">📦 教材發布（Excel → meta.json / script.txt）</h3>
                <p style="margin:0 0 12px; color:#64748B; font-size:0.9rem; line-height:1.5;">
                    請在 Excel 建立 <code>_Config</code>、<code>_Schema</code>、<code>_Publish</code> 設定活頁（模板見 <code>material_templates/</code>）。
                    上傳至 Drive 後貼檔案 ID 或網址；可發布至<strong>班級 00</strong>或<strong>老師個人 01</strong>。
                </p>
                <div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:10px; font-size:0.9rem; font-weight:800; color:#334155;">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="radio" name="material-publish-root" value="class" checked onchange="window.FeatureMaterialPublish.onRootKindChange('${esc(classId)}')">
                        🏫 班級 00_Class_Materials
                    </label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="radio" name="material-publish-root" value="teacher" onchange="window.FeatureMaterialPublish.onRootKindChange('${esc(classId)}')">
                        👤 老師個人 01_My_Materials
                    </label>
                </div>
                <p id="material-publish-target-hint" style="margin:0 0 12px; color:${folderId ? '#047857' : '#B45309'}; font-size:0.85rem;">
                    ${folderId ? '發布目標：此班 Drive → 00_Class_Materials/…' : '⚠️ 此班級尚未設定 Drive 資料夾，請先到課程基本資料建立（或改選老師個人）。'}
                </p>
                <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end;">
                    <div style="flex:2; min-width:220px;">
                        <label style="display:block; font-weight:800; color:#475569; font-size:0.85rem; margin-bottom:4px;">Excel / 試算表 Drive 連結或 File ID</label>
                        <input type="text" id="material-source-file-input" class="form-control" placeholder="https://drive.google.com/... 或 fileId" style="width:100%; padding:8px; border-radius:6px; border:1px solid #CBD5E1;">
                    </div>
                    <button type="button" class="btn btn-primary" id="btn-material-publish" style="font-weight:800;" onclick="window.FeatureMaterialPublish.runPublish('${esc(classId)}')">
                        🚀 發布
                    </button>
                </div>
                <div id="material-publish-status" style="margin-top:10px; font-size:0.85rem; color:#64748B;"></div>
            </div>
        `;
    }

    async function runPublish(classId) {
        const statusEl = document.getElementById('material-publish-status');
        const inputEl = document.getElementById('material-source-file-input');
        const btn = document.getElementById('btn-material-publish');
        if (!inputEl || !statusEl) return;

        const raw = inputEl.value.trim();
        if (!raw) {
            window.showFlash('請貼上 Drive 上的 Excel／試算表連結或 File ID', 'error');
            return;
        }

        const rootKind = readSelectedRootKind();
        const destLabel = rootKind === 'teacher' ? '01_My_Materials' : '00_Class_Materials';

        let sourceFileId = raw;
        if (window.GasService && typeof window.GasService.extractFileIdFromUrl === 'function') {
            const parsed = window.GasService.extractFileIdFromUrl(raw);
            if (parsed) sourceFileId = parsed;
        }

        if (btn) { btn.disabled = true; btn.textContent = '⏳ 發布中…'; }
        statusEl.textContent = '正在讀取 _Schema / _Publish 並寫入 ' + destLabel + '…';
        statusEl.style.color = '#3B82F6';

        try {
            const targetFolderId = await resolveTargetFolderId(classId, rootKind);
            if (!window.GasService || typeof window.GasService.publishMaterial !== 'function') {
                throw new Error('GasService.publishMaterial 尚未載入');
            }
            const result = await window.GasService.publishMaterial(sourceFileId, targetFolderId, rootKind);
            const outputs = (result.manifest && result.manifest.outputs)
                ? result.manifest.outputs.map(function (o) {
                    return (o.source_sheet || '') + ' → ' + (o.meta || '') + ' (' + o.rowCount + ' 列)';
                }).join('；')
                : '完成';

            statusEl.innerHTML = '✅ 已發布至 ' + esc(destLabel) + '！<br><span style="color:#64748B;">' + esc(outputs) + '</span><br>'
                + (result.folderUrl ? '<a href="' + esc(result.folderUrl) + '" target="_blank" rel="noopener">開啟資料夾</a>' : '');
            statusEl.style.color = '#059669';
        } catch (err) {
            statusEl.textContent = '❌ 發布失敗：' + (err.message || err);
            statusEl.style.color = '#DC2626';
            window.showFlash('發布失敗：' + (err.message || err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🚀 發布'; }
        }
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

/**
 * 📂 檔案路徑：110_teacher_core/feature-resource.js
 * 🌟 v6.0 終極排版與邏輯修復版：
 * 1. 完美實作「雙欄派發排版」 (對齊 UI 截圖)
 * 2. 徹底修復全域/班級 Scope 切換的儲存 Bug (導入 UtilsDate 軟刪除)
 * 3. 實作「各班級獨立新增資源」功能
 */

window.FeatureResource = (() => {
    const db = window.TeacherDB;

    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    
    function escapeJS(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"');
    }

    // --- 共用 UI 元件：雙欄派發排版生成器 ---
    function buildDispatchLayout(isGlobal, activeClasses, dispatchedIds, checkboxId, targetCbClass, labelId) {
        let html = `
            <div style="display: flex; gap: 20px; align-items: stretch; margin-top: 10px;">
                <div style="flex: 0 0 220px; display: flex;">
                    <label id="${labelId}" style="display:flex; flex-direction:column; align-items:center; justify-content:center; width: 100%; background:${isGlobal ? '#EFF6FF' : '#F8FAFC'}; border:2px solid ${isGlobal ? '#3B82F6' : '#E2E8F0'}; border-radius:12px; cursor:pointer; padding:20px; text-align:center; transition:0.2s;">
                        <input type="checkbox" id="${checkboxId}" style="transform:scale(1.5); margin-bottom:15px;" ${isGlobal ? 'checked' : ''} onchange="
                            const cbs = document.querySelectorAll('.${targetCbClass}');
                            const label = document.getElementById('${labelId}');
                            if(this.checked) {
                                label.style.background = '#EFF6FF'; label.style.borderColor = '#3B82F6';
                                cbs.forEach(cb => { cb.disabled = true; cb.parentElement.style.opacity = '0.4'; cb.checked = false; cb.parentElement.style.background = '#F8FAFC'; cb.parentElement.style.borderColor = '#CBD5E1'; });
                            } else {
                                label.style.background = '#F8FAFC'; label.style.borderColor = '#E2E8F0';
                                cbs.forEach(cb => { cb.disabled = false; cb.parentElement.style.opacity = '1'; });
                            }
                        ">
                        <span style="font-weight:900; color:#1E3A8A; font-size:1.1rem; line-height:1.4;">🌍 設為「全域資源」<br><span style="font-size:0.9rem; margin-top: 5px; display: block;">(自動套用至所有班級)</span></span>
                    </label>
                </div>
                <div style="flex: 1; display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; padding: 5px;">
        `;
        
        if (activeClasses.length === 0) {
            html += '<span style="color:#EF4444; font-size:0.9rem; padding-top: 10px;">您目前沒有活躍的班級。</span>';
        } else {
            activeClasses.forEach(cls => {
                const isChecked = dispatchedIds.includes(cls.id) ? 'checked' : '';
                const safeClsName = escapeHTML(cls.name);
                html += `
                    <label style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:${isChecked ? '#DBEAFE' : '#F8FAFC'}; border:1px solid ${isChecked ? '#93C5FD' : '#CBD5E1'}; border-radius:6px; cursor:pointer; opacity: ${isGlobal ? '0.4' : '1'}; transition: all 0.2s; height: fit-content;">
                        <input type="checkbox" value="${cls.id}" class="${targetCbClass}" style="transform:scale(1.2);" ${isChecked} ${isGlobal ? 'disabled' : ''} onchange="
                            if(this.checked) { this.parentElement.style.background='#DBEAFE'; this.parentElement.style.borderColor='#93C5FD'; }
                            else { this.parentElement.style.background='#F8FAFC'; this.parentElement.style.borderColor='#CBD5E1'; }
                        "> 
                        <span style="font-weight:800; color:#334155;">${cls.icon} ${safeClsName}</span>
                    </label>
                `;
            });
        }
        html += `</div></div>`;
        return html;
    }

    async function fetchResourcesFromDB() {
        try {
            const { data: resData, error: resErr } = await window.supabaseClient
                .from('resources')
                .select('*')
                .is('deleted_at', null);

            if (resErr) throw resErr;

            const safeData = resData || [];
            db.resourceLibrary = safeData;

            db.resourceMappings = safeData
                .filter(r => (r.scope === 'class' && r.target_class_id) || r.scope === 'global')
                .map(r => ({
                    resource_id: r.id,
                    class_id: r.scope === 'global' ? 'ALL' : r.target_class_id,
                    scope: r.scope
                }));
            
        } catch (err) {
            console.error("[Resource Error] 載入資源失敗：", err);
        }
    }

    // ==========================================
    // 貳、 班級端資源渲染與獨立新增
    // ==========================================
    async function renderClassResources(classId) {
        await fetchResourcesFromDB(); 
        const container = document.getElementById('class-resource-container');
        if (!container) return;
        
        const safeLibrary = db.resourceLibrary || [];
        const uniqueResources = [];
        const seenUrls = new Set();
        
        safeLibrary.forEach(r => {
            if (r.scope === 'global' || (r.scope === 'class' && r.target_class_id === classId)) {
                if (!seenUrls.has(r.url)) {
                    seenUrls.add(r.url);
                    uniqueResources.push(r);
                }
            }
        });

        // 🌟 新增：專屬本班的新增按鈕
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
                <h3 style="margin:0; color:#1E293B;">📂 班級資源庫</h3>
                <button class="btn btn-primary" style="font-size:0.95rem; font-weight:800; padding:8px 16px;" onclick="window.FeatureResource.openAddClassResourceModal('${classId}')">➕ 新增本班專屬資源</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">
        `;
        
        if (uniqueResources.length === 0) {
            html += `<div style="grid-column: 1 / -1;"><p style="color:#94A3B8; font-weight:800; padding:20px; background:#F8FAFC; border-radius:8px; text-align:center;">本班目前無任何資源，請點擊上方按鈕建立。</p></div>`;
        } else {
            uniqueResources.forEach(res => {
                const scopeBadge = res.scope === 'global' 
                    ? '<span style="font-size:0.75rem; background:#DBEAFE; color:#1D4ED8; padding:2px 8px; border-radius:12px; margin-left:8px; border:1px solid #93C5FD;">🌍 全域共用</span>' 
                    : '<span style="font-size:0.75rem; background:#FEE2E2; color:#B91C1C; padding:2px 8px; border-radius:12px; margin-left:8px; border:1px solid #FCA5A5;">🏷️ 本班專屬</span>';
                    
                const safeNameHTML = escapeHTML(res.name);
                const safeUrlJS = escapeJS(res.url);

                html += `
                    <div class="res-item" style="cursor:pointer; background:white; border:1px solid #E2E8F0; padding:20px 15px; border-radius:12px; text-align:center; transition:all 0.2s; box-shadow:0 2px 4px rgba(0,0,0,0.02);" onmouseover="this.style.borderColor='var(--primary)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='#E2E8F0'; this.style.transform='none';" onclick="window.open('${safeUrlJS}', '_blank')">
                        <div style="font-size: 3rem; margin-bottom: 10px;">${res.icon}</div>
                        <div style="font-weight: 900; color:#1E293B; font-size:1.05rem;">${safeNameHTML}</div>
                        <div style="margin-top: 8px;">${scopeBadge}</div>
                    </div>`;
            });
        }
        html += `</div>`;
        container.innerHTML = html;
    }

    // ==========================================
    // 參、 全域派發中樞渲染 (Global Dashboard)
    // ==========================================
    async function renderGlobalResourceView() {
        await fetchResourcesFromDB(); 
        const cbContainer = document.getElementById('global-class-checkboxes');
        const activeClasses = (db.classes || []); 
        const safeLibrary = db.resourceLibrary || [];

        if (cbContainer) {
            // 🌟 套用完美的雙欄排版
            cbContainer.innerHTML = buildDispatchLayout(false, activeClasses, [], 'res-is-global-cb', 'target-class-cb', 'global-cb-label');
        }
        
        const libContainer = document.getElementById('global-resource-library');
        if (libContainer) {
            const uniqueResources = [];
            const urlMap = new Set();
            
            const myClassIds = activeClasses.map(c => c.id);
            const myResources = safeLibrary.filter(r => r.scope === 'global' || (r.scope === 'class' && myClassIds.includes(r.target_class_id)));

            myResources.forEach(r => {
                if(!urlMap.has(r.url)) {
                    urlMap.add(r.url);
                    uniqueResources.push(r);
                }
            });

            if (uniqueResources.length === 0) {
                libContainer.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px 0;">您的資源庫目前是空的，請在上方建立新資源。</p>';
                return;
            }

            let tableHTML = `
                <div style="overflow-x: auto; background: white; border: 1px solid #E2E8F0; border-radius: 8px;">
                    <table style="width: 100%; min-width: 700px; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                        <thead>
                            <tr style="background: #F8FAFC; color: #64748B; border-bottom: 1px solid #E2E8F0;">
                                <th style="padding: 12px 15px; width: 60px; text-align: center;">類型</th>
                                <th style="padding: 12px 15px; width: 30%;">資源名稱</th>
                                <th style="padding: 12px 15px;">派發狀態</th>
                                <th style="padding: 12px 15px; width: 160px; text-align: center; white-space: nowrap;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            uniqueResources.forEach(res => {
                let badgeHTML = '<div style="display: flex; flex-wrap: wrap; gap: 6px;">';
                
                if (res.scope === 'global') {
                    badgeHTML += `<span style="background: #DBEAFE; color: #1D4ED8; font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; font-weight: bold; border: 1px solid #93C5FD;">🌍 全域共用</span>`;
                } else {
                    const dispatchedClasses = safeLibrary
                        .filter(r => r.url === res.url && r.scope === 'class')
                        .map(r => activeClasses.find(c => c.id === r.target_class_id))
                        .filter(c => c !== undefined);

                    if (dispatchedClasses.length === 0) {
                        badgeHTML += `<span style="background: #F1F5F9; color: #94A3B8; font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; border: 1px dashed #CBD5E1;">未派發/班級已封存</span>`;
                    } else {
                        dispatchedClasses.forEach(c => {
                            const safeClsName = escapeHTML(c.name);
                            badgeHTML += `<span style="background: #F8FAFC; color: #334155; font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; font-weight: bold; border: 1px solid #CBD5E1;">🏷️ ${safeClsName}</span>`;
                        });
                    }
                }
                badgeHTML += '</div>';

                const safeNameHTML = escapeHTML(res.name);
                const safeUrlJS = escapeJS(res.url);
                const safeUrlHTML = escapeHTML(res.url);

                tableHTML += `
                    <tr style="border-bottom: 1px solid #E2E8F0; transition: background 0.2s;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='transparent'">
                        <td style="padding: 12px 15px; font-size: 1.5rem; text-align: center;">${res.icon}</td>
                        <td style="padding: 12px 15px; font-weight: bold; color: #1E293B;">
                            <a href="${safeUrlHTML}" target="_blank" style="color: #3B82F6; text-decoration: none;" title="點擊開啟資源">${safeNameHTML} 🔗</a>
                        </td>
                        <td style="padding: 12px 15px;">${badgeHTML}</td>
                        <td style="padding: 12px 15px; text-align: center; white-space: nowrap;">
                            <div style="display: flex; justify-content: center; gap: 8px;">
                                <button class="btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; padding:6px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureResource.openEditResourceModal('${safeUrlJS}')" title="編輯與重新派發">✏️ 編輯</button>
                                <button class="btn-danger" style="background:#FEF2F2; color:#EF4444; border:1px solid #FECACA; padding:6px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureResource.deleteResourceGroup('${safeUrlJS}')" title="刪除資源">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            tableHTML += `</tbody></table></div>`;
            libContainer.innerHTML = tableHTML;
        }
    }

    // ==========================================
    // 肆、 編輯/新增 彈窗與儲存邏輯 (徹底修復儲存 Bug)
    // ==========================================
    function openEditResourceModal(resUrl) {
        const safeLibrary = db.resourceLibrary || [];
        const activeClasses = db.classes || [];
        
        const resSample = safeLibrary.find(r => r.url === resUrl);
        if (!resSample) return;

        const isGlobal = resSample.scope === 'global';
        const dispatchedIds = safeLibrary.filter(r => r.url === resUrl && r.scope === 'class').map(r => r.target_class_id);

        const overlayId = 'edit-resource-modal';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(3px);';
        
        const classCheckboxesHTML = buildDispatchLayout(isGlobal, activeClasses, dispatchedIds, 'modal-res-is-global', 'modal-target-class-cb', 'modal-global-cb-label');
        const safeResNameHTML = escapeHTML(resSample.name);
        const safeResUrlHTML = escapeHTML(resSample.url);
        const safeResUrlJS = escapeJS(resSample.url);

        overlay.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 16px; width: 95%; max-width: 750px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); max-height: 90vh; overflow-y: auto;">
                <h3 style="margin-top: 0; color: #1E293B; border-bottom: 2px solid #F1F5F9; padding-bottom: 15px; margin-bottom: 20px; font-size:1.4rem;">✏️ 修改資源與派發設定</h3>
                
                <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px;">
                    <div style="flex: 1; min-width: 150px;">
                        <label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">類型</label>
                        <select id="modal-res-type" class="form-control" style="width: 100%; padding:10px; font-size:1rem; border-radius:8px;">
                            <option value="drive_folder" ${resSample.type === 'drive_folder' ? 'selected' : ''}>📁 Drive 資料夾</option>
                            <option value="drive_file" ${resSample.type === 'drive_file' ? 'selected' : ''}>📄 Drive 檔案</option>
                            <option value="youtube_video" ${resSample.type === 'youtube_video' ? 'selected' : ''}>▶️ YouTube</option>
                            <option value="website_link" ${resSample.type === 'website_link' ? 'selected' : ''}>🔗 一般網頁</option>
                        </select>
                    </div>
                    <div style="flex: 2; min-width: 200px;">
                        <label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源名稱 <span style="color:#EF4444;">*</span></label>
                        <input type="text" id="modal-res-name" class="form-control" value="${safeResNameHTML}" style="width: 100%; padding:10px; font-size:1rem; border-radius:8px;">
                    </div>
                </div>

                <div style="margin-bottom: 25px;">
                    <label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源網址 <span style="color:#EF4444;">*</span></label>
                    <input type="url" id="modal-res-url" class="form-control" value="${safeResUrlHTML}" style="width: 100%; padding:10px; font-size:1rem; border-radius:8px;">
                </div>

                <div style="margin-bottom: 30px;">
                    <label style="display:block; font-weight:900; color:#3B82F6; margin-bottom:12px; font-size:1.1rem;">🎯 派發目標設定</label>
                    ${classCheckboxesHTML}
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 12px; border-top: 2px solid #F1F5F9; padding-top: 20px;">
                    <button class="btn" style="background: #F1F5F9; color: #475569; border: 1px solid #CBD5E1; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 800; font-size:1rem;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                    <button id="btn-save-modal-res" class="btn btn-primary" style="padding: 10px 24px; font-weight: 900; font-size:1rem; border-radius:8px; box-shadow:0 4px 6px -1px rgba(245,158,11,0.4);" onclick="window.FeatureResource.saveEditedResource('${safeResUrlJS}')">💾 儲存修改</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    async function saveEditedResource(originalUrl) {
        const btn = document.getElementById('btn-save-modal-res');
        const newName = document.getElementById('modal-res-name').value.trim();
        const newUrl = document.getElementById('modal-res-url').value.trim();
        const newType = document.getElementById('modal-res-type').value;
        const isGlobal = document.getElementById('modal-res-is-global').checked;
        const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };
        
        if (!newName || !newUrl) return alert('⚠️ 請填寫資源名稱與網址！');

        const checks = Array.from(document.querySelectorAll('.modal-target-class-cb:checked')).map(c => c.value);
        if (!isGlobal && checks.length === 0) return alert('⚠️ 請至少勾選一個要派發的班級，或設為全域資源！');

        btn.innerHTML = '⏳ 處理中...';
        btn.disabled = true;

        try {
            const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
            if (authErr || !user) throw new Error("授權狀態遺失");
            const ownerId = user.id;

            // 🌟 核心修復：強制使用系統指定的時間引擎，保證軟刪除必定成功
            const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
            const { error: delErr } = await window.supabaseClient
                .from('resources')
                .update({ deleted_at: nowTs })
                .eq('url', originalUrl)
                .is('deleted_at', null);

            if (delErr) throw new Error("清理舊紀錄失敗: " + delErr.message);

            let insertPayload = [];
            if (isGlobal) {
                insertPayload.push({ name: newName, type: newType, url: newUrl, icon: im[newType] || '🔗', owner_id: ownerId, scope: 'global', target_class_id: null });
            } else {
                insertPayload = checks.map(cid => ({ name: newName, type: newType, url: newUrl, icon: im[newType] || '🔗', owner_id: ownerId, scope: 'class', target_class_id: cid }));
            }

            const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
            if (insertErr) throw new Error("寫入修改失敗: " + insertErr.message);

            document.getElementById('edit-resource-modal').remove();
            alert('✅ 資源修改成功！');
            await renderGlobalResourceView();

        } catch (err) {
            alert('❌ 儲存失敗: ' + err.message);
            btn.innerHTML = '💾 儲存修改';
            btn.disabled = false;
        }
    }

    // 🌟 新增：班級專屬的新增資源彈窗
    function openAddClassResourceModal(classId) {
        const overlayId = 'add-class-resource-modal';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(3px);';

        overlay.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 16px; width: 90%; max-width: 500px; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
                <h3 style="margin-top: 0; color: #1E293B; border-bottom: 2px solid #F1F5F9; padding-bottom: 15px; margin-bottom: 20px; font-size:1.4rem;">➕ 新增本班專屬資源</h3>
                <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                    <div style="width: 150px;">
                        <label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">類型</label>
                        <select id="add-class-res-type" class="form-control" style="width: 100%; padding:10px; font-size:1rem; border-radius:8px;">
                            <option value="drive_folder">📁 Drive 資料夾</option>
                            <option value="drive_file">📄 Drive 檔案</option>
                            <option value="youtube_video">▶️ YouTube</option>
                            <option value="website_link">🔗 一般網頁</option>
                        </select>
                    </div>
                    <div style="flex: 1;">
                        <label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源名稱 <span style="color:#EF4444;">*</span></label>
                        <input type="text" id="add-class-res-name" class="form-control" style="width: 100%; padding:10px; font-size:1rem; border-radius:8px;">
                    </div>
                </div>
                <div style="margin-bottom: 30px;">
                    <label style="display:block; font-weight:900; color:#475569; margin-bottom:6px;">資源網址 <span style="color:#EF4444;">*</span></label>
                    <input type="url" id="add-class-res-url" class="form-control" style="width: 100%; padding:10px; font-size:1rem; border-radius:8px;">
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px;">
                    <button class="btn" style="background: #F1F5F9; color: #475569; border: 1px solid #CBD5E1; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 800; font-size:1rem;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                    <button id="btn-save-class-res" class="btn btn-primary" style="padding: 10px 24px; font-weight: 900; font-size:1rem; border-radius:8px;" onclick="window.FeatureResource.saveNewClassResource('${classId}')">💾 儲存並加入</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    async function saveNewClassResource(classId) {
        const btn = document.getElementById('btn-save-class-res');
        const name = document.getElementById('add-class-res-name').value.trim();
        const url = document.getElementById('add-class-res-url').value.trim();
        const type = document.getElementById('add-class-res-type').value;
        const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };
        
        if (!name || !url) return alert('⚠️ 請填寫資源名稱與網址！');

        btn.innerHTML = '⏳ 處理中...';
        btn.disabled = true;

        try {
            const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
            if (authErr || !user) throw new Error("授權狀態遺失");
            const ownerId = user.id;

            const { data: existing } = await window.supabaseClient.from('resources').select('id').eq('url', url).is('deleted_at', null);
            if (existing && existing.length > 0) {
                if(!confirm('⚠️ 此網址已存在資源庫中。點擊「確定」將會更新為本班資源。')) {
                    btn.innerHTML = '💾 儲存並加入'; btn.disabled = false; return;
                }
                const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
                await window.supabaseClient.from('resources').update({ deleted_at: nowTs }).eq('url', url).is('deleted_at', null);
            }

            const { error: insertErr } = await window.supabaseClient.from('resources').insert([{ 
                name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId, scope: 'class', target_class_id: classId 
            }]);
            if (insertErr) throw new Error(insertErr.message);

            document.getElementById('add-class-resource-modal').remove();
            alert('✅ 本班資源建立成功！');
            await renderClassResources(classId);

        } catch (err) {
            alert('❌ 儲存失敗: ' + err.message);
            btn.innerHTML = '💾 儲存並加入'; btn.disabled = false;
        }
    }


    // ==========================================
    // 伍、 首發寫入事件 (全域防呆版)
    // ==========================================
    window.addEventListener('DOMContentLoaded', () => {
        const btnClear = document.getElementById('btn-clear-form');
        if (btnClear) btnClear.style.display = 'none';

        const btnDispatch = document.getElementById('btn-dispatch-resource');
        if (btnDispatch) {
            btnDispatch.onclick = async function() {
                const name = document.getElementById('res-input-name').value.trim();
                const url = document.getElementById('res-input-url').value.trim();
                const type = document.getElementById('res-input-type').value;
                const globalCb = document.getElementById('res-is-global-cb');
                const isGlobal = globalCb ? globalCb.checked : false;

                if (!name || !url) return alert('⚠️ 請填寫資源名稱與網址！');
                const checks = Array.from(document.querySelectorAll('.target-class-cb:checked')).map(c => c.value);
                if (!isGlobal && checks.length === 0) return alert('⚠️ 請至少勾選一個要派發的班級，或是勾選「全域資源」！');

                const btn = this;
                const originalText = btn.innerHTML;
                btn.innerHTML = '⏳ 雲端派發中...'; btn.disabled = true;

                try {
                    const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
                    if (authErr || !user) throw new Error("授權狀態遺失");
                    const ownerId = user.id;
                    const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };

                    const { data: existing } = await window.supabaseClient.from('resources').select('id').eq('url', url).is('deleted_at', null);
                    if (existing && existing.length > 0) {
                        if(!confirm('⚠️ 此網址已存在於資源庫中。\n點擊「確定」將會更新其名稱與派發設定。')) {
                            btn.innerHTML = originalText; btn.disabled = false; return;
                        }
                        const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
                        await window.supabaseClient.from('resources').update({ deleted_at: nowTs }).eq('url', url).is('deleted_at', null);
                    }

                    let insertPayload = [];
                    if (isGlobal) {
                        insertPayload.push({ name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId, scope: 'global', target_class_id: null });
                    } else {
                        insertPayload = checks.map(cid => ({ name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId, scope: 'class', target_class_id: cid }));
                    }

                    const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
                    if (insertErr) throw new Error(insertErr.message);

                    alert('✅ 資源建立與派發成功！');
                    document.getElementById('res-input-name').value = ''; document.getElementById('res-input-url').value = '';
                    if (globalCb) { globalCb.checked = false; document.getElementById('global-cb-label').style.background = '#F8FAFC'; document.getElementById('global-cb-label').style.borderColor = '#E2E8F0'; }
                    document.querySelectorAll('.target-class-cb').forEach(c => { c.checked = false; c.disabled = false; c.parentElement.style.opacity = '1'; c.parentElement.style.background = '#F8FAFC'; c.parentElement.style.borderColor = '#CBD5E1'; });
                    
                    await renderGlobalResourceView();

                } catch (err) { alert('❌ 失敗: ' + err.message); } 
                finally { btn.innerHTML = originalText; btn.disabled = false; }
            };
        }
    });

    return { 
        renderClassResources, 
        renderGlobalResourceView, 
        fetchResourcesFromDB,
        openEditResourceModal,
        saveEditedResource,
        openAddClassResourceModal,
        saveNewClassResource,
        deleteResourceGroup: async (resUrl) => {
            if (!confirm('⚠️ 確定要刪除此資源嗎？\n(這將會把該資源從所有班級中移除)')) return;
            try {
                const nowTs = window.UtilsDate.getTaiwanIsoTimestamp();
                const { error } = await window.supabaseClient.from('resources').update({ deleted_at: nowTs }).eq('url', resUrl).is('deleted_at', null);
                if (error) throw error;
                alert('🗑️ 資源已成功刪除！');
                await renderGlobalResourceView();
            } catch (err) { alert('❌ 刪除失敗: ' + err.message); }
        }
    };
})();
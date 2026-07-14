/**
 * 📂 檔案路徑：110_teacher_core/feature-resource.js
 * 🌟 v4.0 規格重構版：對齊三層式資源庫、軟刪除機制、全功能編輯彈窗、表格化清單與防爆跳脫處理
 */

window.FeatureResource = (() => {
    const db = window.TeacherDB;

    // --- 🛡️ 安全跳脫工具：防止單引號、雙引號破壞 HTML 或 JavaScript 語法 ---
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    
    function escapeJS(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/"/g, '\\"');
    }

    // ==========================================
    // 壹、 核心資源獲取與記憶體橋接
    // ==========================================
    async function fetchResourcesFromDB() {
        try {
            const { data: resData, error: resErr } = await window.supabaseClient
                .from('resources')
                .select('*')
                .is('deleted_at', null);

            if (resErr) throw resErr;

            const safeData = resData || [];
            db.resourceLibrary = safeData;

            // 修正：保留所有資源，將 scope === 'global' 納入 mapping，打通全域資源判斷
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
    // 貳、 班級端資源渲染 (Class View)
    // ==========================================
    async function renderClassResources(classId) {
        await fetchResourcesFromDB(); 
        const container = document.getElementById('class-resource-container');
        if (!container) return;
        
        const safeLibrary = db.resourceLibrary || [];

        const resources = safeLibrary.filter(r => 
            (r.scope === 'class' && r.target_class_id === classId) || 
            (r.scope === 'global')
        );
        
        container.innerHTML = resources.length ? '' : '<p style="color:#94A3B8; font-weight:800;">本班目前無專屬資源，請從全域派發。</p>';
        
        resources.forEach(res => {
            const scopeBadge = res.scope === 'global' 
                ? '<span style="font-size:0.7rem; background:#3B82F6; color:white; padding:2px 6px; border-radius:4px; margin-left:8px;">🌍 全域</span>' 
                : '';
                
            const safeNameHTML = escapeHTML(res.name);
            const safeUrlJS = escapeJS(res.url);

            container.innerHTML += `
                <div class="res-item" style="cursor:pointer; background:white; border:1px solid #E2E8F0; padding:15px; border-radius:8px; text-align:center; transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='#E2E8F0'" onclick="window.open('${safeUrlJS}', '_blank')">
                    <div style="font-size: 2.5rem;">${res.icon}</div>
                    <div style="font-weight: 800; margin-top: 10px; color:#1E293B;">${safeNameHTML} ${scopeBadge}</div>
                </div>`;
        });
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
            cbContainer.innerHTML = '';
            
            if (activeClasses.length === 0) {
                cbContainer.innerHTML = '<span style="color:#94A3B8; font-size:0.9rem;">您目前沒有活躍的班級。請先前往「班級主檔管理」建立班級。</span>';
            } else {
                activeClasses.forEach(cls => {
                    const safeClsName = escapeHTML(cls.name);
                    cbContainer.innerHTML += `<label class="class-checkbox-card" style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; cursor:pointer; margin-right:10px; margin-bottom:10px;"><input type="checkbox" value="${cls.id}" class="target-class-cb" style="transform:scale(1.2);"> <span style="font-weight:800; color:#334155;">${cls.icon} ${safeClsName}</span></label>`;
                });
            }
        }
        
        const libContainer = document.getElementById('global-resource-library');
        if (libContainer) {
            libContainer.innerHTML = '';

            const uniqueResources = [];
            const urlMap = new Set();
            
            const myClassIds = activeClasses.map(c => c.id);
            const myResources = safeLibrary.filter(r => r.scope === 'class' && myClassIds.includes(r.target_class_id));

            myResources.forEach(r => {
                if(!urlMap.has(r.url)) {
                    urlMap.add(r.url);
                    uniqueResources.push(r);
                }
            });

            if (uniqueResources.length === 0) {
                libContainer.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px 0;">您的資源庫目前是空的，請在上方建立新資源並派發。</p>';
                return;
            }

            let tableHTML = `
                <div style="overflow-x: auto; background: white; border: 1px solid #E2E8F0; border-radius: 8px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                        <thead>
                            <tr style="background: #F8FAFC; color: #64748B; border-bottom: 1px solid #E2E8F0;">
                                <th style="padding: 12px 15px; width: 60px; text-align: center;">類型</th>
                                <th style="padding: 12px 15px; width: 30%;">資源名稱</th>
                                <th style="padding: 12px 15px;">派發狀態</th>
                                <th style="padding: 12px 15px; width: 140px; text-align: center;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            uniqueResources.forEach(res => {
                const dispatchedClasses = safeLibrary
                    .filter(r => r.url === res.url && r.scope === 'class')
                    .map(r => activeClasses.find(c => c.id === r.target_class_id))
                    .filter(c => c !== undefined);

                let badgeHTML = '<div style="display: flex; flex-wrap: wrap; gap: 6px;">';
                if (dispatchedClasses.length === 0) {
                    badgeHTML += `<span style="background: #F1F5F9; color: #94A3B8; font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; border: 1px dashed #CBD5E1;">未派發/班級已封存</span>`;
                } else {
                    dispatchedClasses.forEach(c => {
                        const safeClsName = escapeHTML(c.name);
                        badgeHTML += `<span style="background: #E0E7FF; color: #1E40AF; font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; font-weight: bold; border: 1px solid #BFDBFE;">🏷️ ${safeClsName}</span>`;
                    });
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
                        <td style="padding: 12px 15px; text-align: center;">
                            <div style="display: flex; justify-content: center; gap: 8px;">
                                <button class="btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; padding:6px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureResource.openEditResourceModal('${safeUrlJS}')" title="編輯與重新派發">✏️ 編輯</button>
                                <button class="btn-danger" style="background:#FEF2F2; color:#EF4444; border:1px solid #FECACA; padding:6px 10px; border-radius:6px; cursor:pointer;" onclick="window.FeatureResource.deleteResourceGroup('${safeUrlJS}')" title="封存資源">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            tableHTML += `
                        </tbody>
                    </table>
                </div>
            `;
            libContainer.innerHTML = tableHTML;
        }
    }

    // ==========================================
    // 肆、 全功能編輯與派發彈窗
    // ==========================================
    function openEditResourceModal(resUrl) {
        const safeLibrary = db.resourceLibrary || [];
        const activeClasses = db.classes || [];
        
        const resSample = safeLibrary.find(r => r.url === resUrl);
        if (!resSample) return;

        const dispatchedIds = safeLibrary
            .filter(r => r.url === resUrl && r.scope === 'class')
            .map(r => r.target_class_id);

        const overlayId = 'edit-resource-modal';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
        
        let classCheckboxesHTML = '<div style="display: flex; flex-wrap: wrap; gap: 10px;">';
        
        if (activeClasses.length === 0) {
            classCheckboxesHTML += '<span style="color:#EF4444; font-size:0.9rem;">您目前沒有活躍的班級可供派發。</span>';
        } else {
            activeClasses.forEach(cls => {
                const isChecked = dispatchedIds.includes(cls.id) ? 'checked' : '';
                const safeClsName = escapeHTML(cls.name);
                classCheckboxesHTML += `
                    <label style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:${isChecked ? '#DBEAFE' : '#F8FAFC'}; border:1px solid ${isChecked ? '#93C5FD' : '#CBD5E1'}; border-radius:6px; cursor:pointer; transition: all 0.2s;">
                        <input type="checkbox" value="${cls.id}" class="modal-target-class-cb" style="transform:scale(1.2);" ${isChecked}> 
                        <span style="font-weight:800; color:#334155;">${cls.icon} ${safeClsName}</span>
                    </label>
                `;
            });
        }
        classCheckboxesHTML += '</div>';

        const safeResNameHTML = escapeHTML(resSample.name);
        const safeResUrlHTML = escapeHTML(resSample.url);
        const safeResUrlJS = escapeJS(resSample.url);

        overlay.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 600px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto;">
                <h3 style="margin-top: 0; color: #1E293B; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 20px;">✏️ 編輯資源與派發對象</h3>
                
                <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                    <div style="width: 150px;">
                        <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">類型</label>
                        <select id="modal-res-type" class="form-control" style="width: 100%;">
                            <option value="drive_folder" ${resSample.type === 'drive_folder' ? 'selected' : ''}>📁 Drive 資料夾</option>
                            <option value="drive_file" ${resSample.type === 'drive_file' ? 'selected' : ''}>📄 Drive 檔案</option>
                            <option value="youtube_video" ${resSample.type === 'youtube_video' ? 'selected' : ''}>▶️ YouTube</option>
                            <option value="website_link" ${resSample.type === 'website_link' ? 'selected' : ''}>🔗 一般網頁</option>
                        </select>
                    </div>
                    <div style="flex: 1;">
                        <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">資源名稱 <span style="color:#EF4444;">*</span></label>
                        <input type="text" id="modal-res-name" class="form-control" value="${safeResNameHTML}" style="width: 100%;">
                    </div>
                </div>

                <div style="margin-bottom: 25px;">
                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">資源網址 <span style="color:#EF4444;">*</span></label>
                    <input type="url" id="modal-res-url" class="form-control" value="${safeResUrlHTML}" style="width: 100%;">
                </div>

                <div style="background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px dashed #CBD5E1; margin-bottom: 25px;">
                    <label style="display:block; font-weight:bold; color:#3B82F6; margin-bottom:10px;">🎯 派發給我的活躍班級</label>
                    ${classCheckboxesHTML}
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                    <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                    <button id="btn-save-modal-res" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;" onclick="window.FeatureResource.saveEditedResource('${safeResUrlJS}')">💾 儲存並更新派發</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.querySelectorAll('.modal-target-class-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const label = e.target.closest('label');
                if (e.target.checked) {
                    label.style.background = '#DBEAFE';
                    label.style.borderColor = '#93C5FD';
                } else {
                    label.style.background = '#F8FAFC';
                    label.style.borderColor = '#CBD5E1';
                }
            });
        });
    }

    async function saveEditedResource(originalUrl) {
        const btn = document.getElementById('btn-save-modal-res');
        const newName = document.getElementById('modal-res-name').value.trim();
        const newUrl = document.getElementById('modal-res-url').value.trim();
        const newType = document.getElementById('modal-res-type').value;
        const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };
        
        if (!newName || !newUrl) return alert('⚠️ 請填寫資源名稱與網址！');

        const checks = Array.from(document.querySelectorAll('.modal-target-class-cb:checked')).map(c => c.value);
        if (checks.length === 0) return alert('⚠️ 請至少勾選一個要派發的班級！(若不派發，請直接點擊取消後封存該資源)');

        btn.innerHTML = '⏳ 處理中...';
        btn.disabled = true;

        try {
            // 🌟 核心防雷 1：安全取得身分，不再依賴不可靠的 sessionStorage
            const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
            if (authErr || !user) throw new Error("授權狀態遺失，請重新登入");
            const ownerId = user.id;

            const myClassIds = (db.classes || []).map(c => c.id);

            const { error: delErr } = await window.supabaseClient
                .from('resources')
                .update({ deleted_at: new Date().toISOString() })
                .eq('url', originalUrl)
                .eq('scope', 'class')
                .in('target_class_id', myClassIds)
                .is('deleted_at', null);

            if (delErr) throw new Error("清理舊紀錄失敗: " + delErr.message);

            const insertPayload = checks.map(cid => ({
                name: newName,
                type: newType,
                url: newUrl,
                icon: im[newType] || '🔗',
                owner_id: ownerId,
                scope: 'class',
                target_class_id: cid
            }));

            const { error: insertErr } = await window.supabaseClient
                .from('resources')
                .insert(insertPayload);

            if (insertErr) throw new Error("寫入新紀錄失敗: " + insertErr.message);

            document.getElementById('edit-resource-modal').remove();
            await renderGlobalResourceView();

        } catch (err) {
            alert('❌ 儲存失敗: ' + err.message);
            btn.innerHTML = '💾 儲存並更新派發';
            btn.disabled = false;
        }
    }


    // ==========================================
    // 伍、 首發寫入事件
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
                if (!name || !url) return alert('⚠️ 請填寫資源名稱與網址！');
                
                const checks = Array.from(document.querySelectorAll('.target-class-cb:checked')).map(c => c.value);
                if (checks.length === 0) return alert('⚠️ 請至少勾選一個要派發的班級！');

                const btn = this;
                const originalText = btn.innerHTML;
                btn.innerHTML = '⏳ 雲端派發中...';
                btn.disabled = true;

                try {
                    // 🌟 核心防雷 2：安全取得身分
                    const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
                    if (authErr || !user) throw new Error("授權狀態遺失，請重新登入");
                    const ownerId = user.id;
                    
                    const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };

                    const existingClassesWithUrl = (db.resourceLibrary || [])
                        .filter(r => r.url === url && r.scope === 'class' && r.target_class_id)
                        .map(r => r.target_class_id);
                    
                    const classesToDispatch = checks.filter(cid => !existingClassesWithUrl.includes(cid));

                    if (classesToDispatch.length === 0) {
                        alert('⚠️ 您勾選的班級皆已擁有此資源，無須重複派發。若需修改，請在下方表格點擊「✏️ 編輯」。');
                        return;
                    }

                    const insertPayload = classesToDispatch.map(cid => ({
                        name: name,
                        type: type,
                        url: url,
                        icon: im[type] || '🔗',
                        owner_id: ownerId,
                        scope: 'class',
                        target_class_id: cid
                    }));

                    const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
                    if (insertErr) throw new Error("派發失敗: " + insertErr.message);

                    alert('✅ 資源派發成功！');
                    
                    document.getElementById('res-input-name').value = '';
                    document.getElementById('res-input-url').value = '';
                    document.querySelectorAll('.target-class-cb').forEach(c => c.checked = false);
                    
                    await renderGlobalResourceView();

                } catch (err) {
                    console.error(err);
                    alert('❌ ' + err.message);
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            };
        }
    });

    return { 
        renderClassResources, 
        renderGlobalResourceView, 
        fetchResourcesFromDB,
        openEditResourceModal,
        saveEditedResource,
        deleteResourceGroup: async (resUrl) => {
            if (!confirm('⚠️ 確定要封存此資源嗎？\n(這將會把該資源從您授課的班級中移除)')) return;
            try {
                const myClassIds = (db.classes || []).map(c => c.id);
                const { error } = await window.supabaseClient
                    .from('resources')
                    .update({ deleted_at: new Date().toISOString() })
                    .eq('url', resUrl)
                    .eq('scope', 'class')
                    .in('target_class_id', myClassIds)
                    .is('deleted_at', null);

                if (error) throw error;
                await renderGlobalResourceView();
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
            }
        }
    };
})();
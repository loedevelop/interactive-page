/**
 * 📂 檔案路徑：110_teacher_core/feature-resource.js
 * 🌟 v4.1 終極修復版：解決按鈕裁切、重複寫入與全域派發失效問題
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

    async function renderClassResources(classId) {
        await fetchResourcesFromDB(); 
        const container = document.getElementById('class-resource-container');
        if (!container) return;
        
        const safeLibrary = db.resourceLibrary || [];

        // 🌟 防呆：透過 Set 過濾掉重複網址，避免同一個 PDF 出現兩次
        const uniqueResources = [];
        const seenUrls = new Set();
        
        safeLibrary.forEach(r => {
            if ((r.scope === 'class' && r.target_class_id === classId) || r.scope === 'global') {
                if (!seenUrls.has(r.url)) {
                    seenUrls.add(r.url);
                    uniqueResources.push(r);
                }
            }
        });
        
        container.innerHTML = uniqueResources.length ? '' : '<p style="color:#94A3B8; font-weight:800;">本班目前無專屬資源，請從全域派發。</p>';
        
        uniqueResources.forEach(res => {
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
                // 🌟 新增：全域資源快捷開關
                let html = `<label style="display:block; margin-bottom:12px; padding:10px 15px; background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; cursor:pointer; width:fit-content;">
                    <input type="checkbox" id="res-is-global-cb" style="transform:scale(1.3); margin-right:10px;" onchange="
                        const cbs = document.querySelectorAll('.target-class-cb');
                        cbs.forEach(cb => { cb.disabled = this.checked; cb.parentElement.style.opacity = this.checked ? '0.5' : '1'; });
                    "> 
                    <span style="font-weight:900; color:#1E3A8A; font-size:1rem;">🌍 設為「全域資源」 (自動套用至所有班級，無須勾選)</span>
                </label><div style="display:flex; flex-wrap:wrap; gap:10px;">`;
                
                activeClasses.forEach(cls => {
                    const safeClsName = escapeHTML(cls.name);
                    html += `<label class="class-checkbox-card" style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:#F8FAFC; border:1px solid #CBD5E1; border-radius:6px; cursor:pointer; transition:0.2s;"><input type="checkbox" value="${cls.id}" class="target-class-cb" style="transform:scale(1.2);"> <span style="font-weight:800; color:#334155;">${cls.icon} ${safeClsName}</span></label>`;
                });
                cbContainer.innerHTML = html + '</div>';
            }
        }
        
        const libContainer = document.getElementById('global-resource-library');
        if (libContainer) {
            libContainer.innerHTML = '';

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
                libContainer.innerHTML = '<p style="color:#94A3B8; font-weight:800; padding: 20px 0;">您的資源庫目前是空的，請在上方建立新資源並派發。</p>';
                return;
            }

            // 🌟 修正：為 table 加上 min-width，為 td 加上 white-space: nowrap，保證按鈕絕對不被裁切
            let tableHTML = `
                <div style="overflow-x: auto; background: white; border: 1px solid #E2E8F0; border-radius: 8px;">
                    <table style="width: 100%; min-width: 650px; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                        <thead>
                            <tr style="background: #F8FAFC; color: #64748B; border-bottom: 1px solid #E2E8F0;">
                                <th style="padding: 12px 15px; width: 60px; text-align: center;">類型</th>
                                <th style="padding: 12px 15px; width: 30%;">資源名稱</th>
                                <th style="padding: 12px 15px;">派發狀態</th>
                                <th style="padding: 12px 15px; width: 150px; text-align: center; white-space: nowrap;">操作</th>
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

    function openEditResourceModal(resUrl) {
        const safeLibrary = db.resourceLibrary || [];
        const activeClasses = db.classes || [];
        
        const resSample = safeLibrary.find(r => r.url === resUrl);
        if (!resSample) return;

        const isGlobal = resSample.scope === 'global';

        const dispatchedIds = safeLibrary
            .filter(r => r.url === resUrl && r.scope === 'class')
            .map(r => r.target_class_id);

        const overlayId = 'edit-resource-modal';
        let overlay = document.getElementById(overlayId);
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
        
        let classCheckboxesHTML = `<label style="display:block; margin-bottom:12px; padding:10px 15px; background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; cursor:pointer;">
            <input type="checkbox" id="modal-res-is-global" style="transform:scale(1.3); margin-right:10px;" ${isGlobal ? 'checked' : ''} onchange="
                const cbs = document.querySelectorAll('.modal-target-class-cb');
                cbs.forEach(cb => { cb.disabled = this.checked; cb.parentElement.style.opacity = this.checked ? '0.5' : '1'; });
            "> 
            <span style="font-weight:900; color:#1E3A8A; font-size:1rem;">🌍 設為「全域資源」 (套用至所有班級)</span>
        </label><div style="display: flex; flex-wrap: wrap; gap: 10px;">`;
        
        if (activeClasses.length === 0) {
            classCheckboxesHTML += '<span style="color:#EF4444; font-size:0.9rem;">您目前沒有活躍的班級可供派發。</span>';
        } else {
            activeClasses.forEach(cls => {
                const isChecked = dispatchedIds.includes(cls.id) ? 'checked' : '';
                const safeClsName = escapeHTML(cls.name);
                classCheckboxesHTML += `
                    <label style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; background:${isChecked ? '#DBEAFE' : '#F8FAFC'}; border:1px solid ${isChecked ? '#93C5FD' : '#CBD5E1'}; border-radius:6px; cursor:pointer; opacity: ${isGlobal ? '0.5' : '1'};">
                        <input type="checkbox" value="${cls.id}" class="modal-target-class-cb" style="transform:scale(1.2);" ${isChecked} ${isGlobal ? 'disabled' : ''}> 
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
                
                <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px;">
                    <div style="flex: 1; min-width: 150px;">
                        <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">類型</label>
                        <select id="modal-res-type" class="form-control" style="width: 100%;">
                            <option value="drive_folder" ${resSample.type === 'drive_folder' ? 'selected' : ''}>📁 Drive 資料夾</option>
                            <option value="drive_file" ${resSample.type === 'drive_file' ? 'selected' : ''}>📄 Drive 檔案</option>
                            <option value="youtube_video" ${resSample.type === 'youtube_video' ? 'selected' : ''}>▶️ YouTube</option>
                            <option value="website_link" ${resSample.type === 'website_link' ? 'selected' : ''}>🔗 一般網頁</option>
                        </select>
                    </div>
                    <div style="flex: 2; min-width: 200px;">
                        <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">資源名稱 <span style="color:#EF4444;">*</span></label>
                        <input type="text" id="modal-res-name" class="form-control" value="${safeResNameHTML}" style="width: 100%;">
                    </div>
                </div>

                <div style="margin-bottom: 25px;">
                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">資源網址 <span style="color:#EF4444;">*</span></label>
                    <input type="url" id="modal-res-url" class="form-control" value="${safeResUrlHTML}" style="width: 100%;">
                </div>

                <div style="background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px dashed #CBD5E1; margin-bottom: 25px;">
                    <label style="display:block; font-weight:bold; color:#3B82F6; margin-bottom:10px;">🎯 派發對象</label>
                    ${classCheckboxesHTML}
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                    <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                    <button id="btn-save-modal-res" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;" onclick="window.FeatureResource.saveEditedResource('${safeResUrlJS}')">💾 儲存並更新</button>
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
        const isGlobal = document.getElementById('modal-res-is-global').checked;
        const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };
        
        if (!newName || !newUrl) return alert('⚠️ 請填寫資源名稱與網址！');

        const checks = Array.from(document.querySelectorAll('.modal-target-class-cb:checked')).map(c => c.value);
        if (!isGlobal && checks.length === 0) return alert('⚠️ 請至少勾選一個要派發的班級，或勾選設為全域資源！');

        btn.innerHTML = '⏳ 處理中...';
        btn.disabled = true;

        try {
            const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
            if (authErr || !user) throw new Error("授權狀態遺失，請重新登入");
            const ownerId = user.id;

            // 無腦暴力法：直接軟刪除舊網址的所有紀錄，再重新插入新的
            await window.supabaseClient
                .from('resources')
                .update({ deleted_at: new Date().toISOString() })
                .eq('url', originalUrl)
                .is('deleted_at', null);

            let insertPayload = [];
            if (isGlobal) {
                insertPayload.push({ name: newName, type: newType, url: newUrl, icon: im[newType] || '🔗', owner_id: ownerId, scope: 'global', target_class_id: null });
            } else {
                insertPayload = checks.map(cid => ({ name: newName, type: newType, url: newUrl, icon: im[newType] || '🔗', owner_id: ownerId, scope: 'class', target_class_id: cid }));
            }

            const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
            if (insertErr) throw new Error("寫入新紀錄失敗: " + insertErr.message);

            document.getElementById('edit-resource-modal').remove();
            await renderGlobalResourceView();

        } catch (err) {
            alert('❌ 儲存失敗: ' + err.message);
            btn.innerHTML = '💾 儲存並更新';
            btn.disabled = false;
        }
    }


    // ==========================================
    // 伍、 首發寫入事件 (加上防重複檢查)
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
                btn.innerHTML = '⏳ 雲端派發中...';
                btn.disabled = true;

                try {
                    const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
                    if (authErr || !user) throw new Error("授權狀態遺失，請重新登入");
                    const ownerId = user.id;
                    const im = { 'drive_folder':'📁', 'drive_file':'📄', 'youtube_video':'▶️', 'website_link':'🔗' };

                    // 🌟 核心修復：檢查是否已經有同網址的資源，如果有，強迫走 Update 更新流程
                    const { data: existing } = await window.supabaseClient.from('resources').select('id').eq('url', url).is('deleted_at', null);
                    if (existing && existing.length > 0) {
                        if(!confirm('⚠️ 系統偵測到此網址已存在於您的資源庫中。\n點擊「確定」將會更新其名稱與派發設定，避免重複建立。')) {
                            btn.innerHTML = originalText; btn.disabled = false;
                            return;
                        }
                        // 軟刪除舊資料
                        await window.supabaseClient.from('resources').update({ deleted_at: new Date().toISOString() }).eq('url', url).is('deleted_at', null);
                    }

                    let insertPayload = [];
                    if (isGlobal) {
                        insertPayload.push({ name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId, scope: 'global', target_class_id: null });
                    } else {
                        insertPayload = checks.map(cid => ({ name: name, type: type, url: url, icon: im[type] || '🔗', owner_id: ownerId, scope: 'class', target_class_id: cid }));
                    }

                    const { error: insertErr } = await window.supabaseClient.from('resources').insert(insertPayload);
                    if (insertErr) throw new Error("派發失敗: " + insertErr.message);

                    alert('✅ 資源建立與派發成功！');
                    
                    document.getElementById('res-input-name').value = '';
                    document.getElementById('res-input-url').value = '';
                    if (globalCb) globalCb.checked = false;
                    document.querySelectorAll('.target-class-cb').forEach(c => { c.checked = false; c.disabled = false; c.parentElement.style.opacity = '1'; });
                    
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
            if (!confirm('⚠️ 確定要封存此資源嗎？\n(這將會把該資源從所有已派發的班級中移除)')) return;
            try {
                const { error } = await window.supabaseClient
                    .from('resources')
                    .update({ deleted_at: new Date().toISOString() })
                    .eq('url', resUrl)
                    .is('deleted_at', null);

                if (error) throw error;
                await renderGlobalResourceView();
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
            }
        }
    };
})();
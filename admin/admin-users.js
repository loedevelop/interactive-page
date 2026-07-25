/**
 * 📂 檔案路徑：admin/admin-users.js
 * 🌟 v4.0 全域使用者管理模組：完全補齊護照名、電話、軟刪除、XSS 防護、非同步預覽
 */

window.AdminUsers = (() => {
    let globalMode = 'en_first';

    // 1. 初始化讀取全域設定
    async function fetchGlobalMode() {
        try {
            const { data } = await window.supabaseClient
                .from('system_settings')
                .select('value')
                .eq('setting_key', 'global_name_mode')
                .maybeSingle();
                
            if (data && data.value) {
                globalMode = data.value;
            }
        } catch (e) { 
            console.warn('無法讀取全域設定，套用預設值'); 
        }
    }

    // 2. 智慧姓名大腦
    function calculateDisplayName(profile) {
        const rawData = profile.raw_data || {};
        const enName = (rawData.nameEN || '').trim();
        const passLast = (rawData.passportLast || '').trim();
        const passFirst = (rawData.passportFirst || '').trim();
        const lastCN = (rawData.lastNameCN || '').trim();
        const firstCN = (rawData.firstNameCN || '').trim();
        const fullCN = `${lastCN}${firstCN}`.trim();
        
        const fallback = profile.name || '未命名';

        if (globalMode === 'cn_first') {
            if (fullCN && enName) return `${fullCN} (${enName})`;
            if (fullCN) return fullCN;
            if (enName) return enName;
            return fallback;
        } else {
            if (enName && passLast) return `${enName} ${passLast}`;
            if (enName) return enName;
            if (passLast) return passLast;
            if (fullCN) return fullCN;
            return fallback;
        }
    }

    // 🌟 XSS 防護處理：避免引號破壞 HTML value 屬性
    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 3. 共用 UI：建立深色彈窗遮罩
    function createDarkModal(id, contentHTML) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.75); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(4px); padding: 20px;';
        
        const modal = document.createElement('div');
        modal.id = `${id}-content`; 
        modal.style.cssText = 'background: #0F172A; border: 1px solid #334155; padding: 30px; border-radius: 12px; width: 100%; max-width: 900px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); color: #F8FAFC; max-height: 90vh; overflow-y: auto;';
        modal.innerHTML = contentHTML;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    // ==========================================
    // 模組 A：全域使用者列表
    // ==========================================
    async function openUserList() {
        createDarkModal('admin-user-list-modal', '<h3 style="margin:0; color:#38BDF8;">⏳ 正在載入全域使用者庫...</h3>');
        await fetchGlobalMode();

        try {
            const { data: profiles, error } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });
                
            if (error) throw error;

            const roleMap = {
                'admin': '👑 管理員', 
                'primary_teacher': '🧑‍🏫 主教', 
                'co_teacher': '🧑‍🏫 協同',
                'ta_senior': '⭐ 資深助教', 
                'ta_junior': '🎓 一般助教', 
                'student': '🎒 學生', 
                'parent': '👨‍👩‍👧 家長', 
                'user': '👤 未指派'
            };

            const tbody = profiles.map(p => {
                const displayName = calculateDisplayName(p);
                const role = roleMap[p.default_role] || p.default_role;
                const status = p.deleted_at 
                    ? '<span style="color:#EF4444; background:#451A1E; padding: 2px 6px; border-radius: 4px; font-size:0.8rem;">已停用</span>' 
                    : '<span style="color:#2ECC71; background:#0D3B22; padding: 2px 6px; border-radius: 4px; font-size:0.8rem;">啟用中</span>';
                
                const safeName = escapeHTML(displayName);
                
                const actionBtn = p.deleted_at 
                    ? `<button onclick="window.AdminUsers.restoreUser('${p.id}')" style="background:transparent; color:#94A3B8; border:1px solid #64748B; padding:6px 10px; border-radius:6px; cursor:pointer;">♻️ 復原</button>`
                    : `<button onclick="window.AdminUsers.deleteUser('${p.id}')" style="background:#451A1E; color:#EF4444; border:none; padding:6px 10px; border-radius:6px; cursor:pointer;">🗑️ 停用</button>`;

                return `
                    <tr style="border-bottom: 1px solid #1E293B;">
                        <td style="padding: 12px 10px;">${status}</td>
                        <td style="padding: 12px 10px; font-weight: 800; color: #38BDF8;">${role}</td>
                        <td style="padding: 12px 10px;">${safeName}</td>
                        <td style="padding: 12px 10px; color: #94A3B8;">${escapeHTML(p.email)}</td>
                        <td style="padding: 12px 10px; display:flex; gap:8px;">
                            <button onclick="window.AdminUsers.openEditUserModal('${p.id}')" style="background:#334155; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer;">✏️ 編輯</button>
                            ${actionBtn}
                        </td>
                    </tr>
                `;
            }).join('');

            const html = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; margin-bottom: 20px;">
                    <h2 style="margin: 0; color: #38BDF8;">🔍 全域使用者管理庫</h2>
                    <button onclick="document.getElementById('admin-user-list-modal').remove()" style="background:transparent; border:1px solid #64748B; color:#94A3B8; padding:6px 12px; border-radius:6px; cursor:pointer;">關閉視窗</button>
                </div>
                <div style="background: #1E293B; padding: 10px 15px; border-radius: 8px; margin-bottom: 15px; color: #94A3B8; font-size: 0.9rem;">
                    當前系統強制套用顯示模式：<strong style="color:white;">${globalMode === 'cn_first' ? '🇹🇼 中文全名優先' : '🇺🇸 英文名+護照姓優先'}</strong>
                </div>
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.95rem;">
                    <thead>
                        <tr style="background: #1E293B; color: #94A3B8;">
                            <th style="padding: 10px; border-radius: 8px 0 0 8px;">狀態</th>
                            <th style="padding: 10px;">身分角色</th>
                            <th style="padding: 10px;">智慧顯示姓名 (唯讀)</th>
                            <th style="padding: 10px;">登入信箱 (帳號)</th>
                            <th style="padding: 10px; border-radius: 0 8px 8px 0;">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbody || '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#94A3B8;">暫無資料</td></tr>'}
                    </tbody>
                </table>
            `;
            document.getElementById('admin-user-list-modal-content').innerHTML = html;
        } catch (err) {
            alert("❌ 載入失敗: " + err.message);
            document.getElementById('admin-user-list-modal').remove();
        }
    }

    // ==========================================
    // 模組 B：新增使用者
    // ==========================================
    async function openAddUserModal() {
        // 確保打開新增視窗時，已正確取得全域模式
        await fetchGlobalMode();

        const html = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="margin: 0; color: #38BDF8;">➕ 建立新帳號 (Safe Mode)</h2>
                <button onclick="document.getElementById('admin-add-user-modal').remove()" style="background:transparent; border:1px solid #64748B; color:#94A3B8; padding:6px 12px; border-radius:6px; cursor:pointer;">關閉</button>
            </div>

            <div style="background: #1E293B; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px;">
                <div style="margin-bottom: 15px;">
                    <label style="color: #38BDF8; font-weight: bold; font-size: 0.9rem; display:block; margin-bottom:5px;">👁️ 系統顯示名稱預覽 (唯讀)</label>
                    <input type="text" id="admin-sysDisplayName" disabled placeholder="尚未輸入" style="width: 100%; padding: 10px; background: #0F172A; color: #F8FAFC; border: 1px solid #334155; border-radius: 6px; font-weight: bold;">
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div>
                        <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">英文名字 (First Name)</label>
                        <input type="text" id="admin-nameEN" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                    </div>
                    <div>
                        <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">護照姓氏 (Last Name)</label>
                        <input type="text" id="admin-passLast" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                    <div>
                        <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">護照名字 (First Name)</label>
                        <input type="text" id="admin-passFirst" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                    </div>
                    <div>
                        <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">中文姓氏</label>
                        <input type="text" id="admin-lastCN" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">中文名字</label>
                        <input type="text" id="admin-firstCN" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                    </div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                <div>
                    <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">📧 聯絡信箱 (登入帳號) <span style="color:#EF4444;">*</span></label>
                    <input type="email" id="admin-email" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                </div>
                <div>
                    <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">📱 聯絡電話</label>
                    <input type="text" id="admin-phone" placeholder="選填" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                </div>
                <div style="grid-column: 1 / -1;">
                    <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">🏷️ 系統權限角色 <span style="color:#EF4444;">*</span></label>
                    <select id="admin-role" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        <option value="" disabled selected>請選擇...</option>
                        <option value="admin">👑 最高管理員 (Admin)</option>
                        <option value="primary_teacher">🧑‍🏫 班主任/主教 (Primary Teacher)</option>
                        <option value="co_teacher">🧑‍🏫 協同老師 (Co-Teacher)</option>
                        <option value="ta_senior">⭐ 資深助教 (TA Senior)</option>
                        <option value="ta_junior">🎓 一般助教 (TA Junior)</option>
                        <option value="student">🎒 學生 (Student)</option>
                        <option value="parent">👨‍👩‍👧 家長 (Parent)</option>
                    </select>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 15px;">
                <span id="admin-add-msg" style="font-weight: bold; font-size: 0.95rem;"></span>
                <button id="admin-btn-submit" onclick="window.AdminUsers.submitNewUser()" style="background: #38BDF8; color: #0F172A; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 800; cursor: pointer;">➕ 確認建立帳號</button>
            </div>
        `;
        createDarkModal('admin-add-user-modal', html);

        // 使用大腦函數進行即時預覽
        const updatePreview = () => {
            const mockProfile = {
                raw_data: {
                    nameEN: document.getElementById('admin-nameEN').value,
                    passportLast: document.getElementById('admin-passLast').value,
                    passportFirst: document.getElementById('admin-passFirst').value,
                    lastNameCN: document.getElementById('admin-lastCN').value,
                    firstNameCN: document.getElementById('admin-firstCN').value
                }
            };
            const preview = calculateDisplayName(mockProfile);
            document.getElementById('admin-sysDisplayName').value = preview === '未命名' ? '' : preview;
        };
        
        const inputsToWatch = ['admin-nameEN', 'admin-passLast', 'admin-passFirst', 'admin-lastCN', 'admin-firstCN'];
        inputsToWatch.forEach(id => {
            document.getElementById(id).addEventListener('input', updatePreview);
        });
    }

    async function submitNewUser() {
        const btn = document.getElementById('admin-btn-submit');
        const msg = document.getElementById('admin-add-msg');
        
        const nameEN = document.getElementById('admin-nameEN').value.trim();
        const passLast = document.getElementById('admin-passLast').value.trim();
        const passFirst = document.getElementById('admin-passFirst').value.trim();
        const lastCN = document.getElementById('admin-lastCN').value.trim();
        const firstCN = document.getElementById('admin-firstCN').value.trim();
        const email = document.getElementById('admin-email').value.trim();
        const phone = document.getElementById('admin-phone').value.trim();
        const role = document.getElementById('admin-role').value;
        const cn = `${lastCN}${firstCN}`;

        if (!nameEN && !cn) return alert("⚠️ 請至少輸入「英文名字」或「中文姓名」。");
        if (!email || !role) return alert("⚠️ 信箱與角色為必填。");

        const fallbackName = document.getElementById('admin-sysDisplayName').value.trim() || cn || nameEN;
        
        const rawDataPayload = { 
            nameEN: nameEN, 
            passportLast: passLast, 
            passportFirst: passFirst, 
            lastNameCN: lastCN, 
            firstNameCN: firstCN 
        };

        btn.disabled = true; 
        btn.innerHTML = '⏳ 建檔中...'; 
        msg.textContent = '';

        try {
            const { data, error } = await window.supabaseClient.functions.invoke('admin_create_user', {
                body: { 
                    name: fallbackName, 
                    email: email, 
                    phone: phone, 
                    roleType: role, 
                    rawData: rawDataPayload 
                }
            });

            if (error) throw new Error(error.message);
            if (!data || !data.success) throw new Error(data?.error || '未知錯誤');

            msg.style.color = '#2ECC71'; 
            msg.textContent = `✅ 成功建立帳號！`;
            
            setTimeout(() => { 
                document.getElementById('admin-add-user-modal').remove(); 
            }, 1500);

        } catch (err) {
            msg.style.color = '#EF4444'; 
            msg.textContent = `❌ 寫入失敗: ${err.message}`;
            btn.disabled = false; 
            btn.innerHTML = '➕ 確認建立帳號';
        }
    }

    // ==========================================
    // 模組 C：編輯與刪除使用者
    // ==========================================
    async function openEditUserModal(userId) {
        createDarkModal('admin-edit-user-modal', '<h3 style="margin:0; color:#38BDF8;">⏳ 讀取資料中...</h3>');

        try {
            const { data: profile, error } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();
                
            if (error) throw error;
            const raw = profile.raw_data || {};

            const html = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; margin-bottom: 20px;">
                    <h2 style="margin: 0; color: #38BDF8;">✏️ 編輯使用者資料</h2>
                    <button onclick="document.getElementById('admin-edit-user-modal').remove()" style="background:transparent; border:1px solid #64748B; color:#94A3B8; padding:6px 12px; border-radius:6px; cursor:pointer;">取消</button>
                </div>

                <div style="background: #1E293B; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px;">
                    
                    <div style="display: flex; gap: 15px; margin-bottom: 20px; border-bottom: 1px dashed #334155; padding-bottom: 15px;">
                        <div style="flex:1;">
                            <label style="display:block; color: #64748B; margin-bottom:5px; font-size:0.85rem;">帳號 (Email - 基於資安無法編輯)</label>
                            <input type="text" disabled value="${escapeHTML(profile.email)}" style="width: 100%; padding: 8px; background: #0F172A; color: #64748B; border: 1px solid #1E293B; border-radius: 6px;">
                        </div>
                        <div style="flex:1;">
                            <label style="display:block; color: #64748B; margin-bottom:5px; font-size:0.85rem;">權限角色</label>
                            <input type="text" disabled value="${escapeHTML(profile.default_role)}" style="width: 100%; padding: 8px; background: #0F172A; color: #64748B; border: 1px solid #1E293B; border-radius: 6px;">
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                        <div>
                            <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">英文名字</label>
                            <input type="text" id="edit-nameEN" value="${escapeHTML(raw.nameEN)}" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        </div>
                        <div>
                            <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">護照姓氏</label>
                            <input type="text" id="edit-passLast" value="${escapeHTML(raw.passportLast)}" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                        <div>
                            <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">護照名字</label>
                            <input type="text" id="edit-passFirst" value="${escapeHTML(raw.passportFirst)}" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        </div>
                        <div>
                            <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">聯絡電話</label>
                            <input type="text" id="edit-phone" value="${escapeHTML(profile.phone)}" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">中文姓氏</label>
                            <input type="text" id="edit-lastCN" value="${escapeHTML(raw.lastNameCN)}" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        </div>
                        <div>
                            <label style="display:block; color: #94A3B8; margin-bottom:5px; font-size:0.9rem;">中文名字</label>
                            <input type="text" id="edit-firstCN" value="${escapeHTML(raw.firstNameCN)}" style="width: 100%; padding: 10px; background: #0F172A; color: white; border: 1px solid #475569; border-radius: 6px;">
                        </div>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; align-items: center; gap: 15px;">
                    <button onclick="window.AdminUsers.saveEditUser('${userId}')" id="btn-save-edit" style="background: #38BDF8; color: #0F172A; border: none; padding: 10px 24px; border-radius: 8px; font-weight: 800; cursor: pointer;">💾 儲存變更</button>
                </div>
            `;
            document.getElementById('admin-edit-user-modal-content').innerHTML = html;
        } catch (err) {
            alert("載入失敗: " + err.message);
            document.getElementById('admin-edit-user-modal').remove();
        }
    }

    async function saveEditUser(userId) {
        const btn = document.getElementById('btn-save-edit');
        btn.innerHTML = '⏳ 儲存中...'; 
        btn.disabled = true;

        const nameEN = document.getElementById('edit-nameEN').value.trim();
        const passLast = document.getElementById('edit-passLast').value.trim();
        const passFirst = document.getElementById('edit-passFirst').value.trim();
        const lastCN = document.getElementById('edit-lastCN').value.trim();
        const firstCN = document.getElementById('edit-firstCN').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        
        const cn = `${lastCN}${firstCN}`.trim();
        const fallbackName = nameEN || cn || passFirst || '未命名';

        try {
            const { data: profile } = await window.supabaseClient
                .from('profiles')
                .select('raw_data')
                .eq('id', userId)
                .single();
                
            const raw = profile.raw_data || {};
            const mergedRawData = { 
                ...raw, 
                nameEN: nameEN, 
                passportLast: passLast, 
                passportFirst: passFirst, 
                lastNameCN: lastCN, 
                firstNameCN: firstCN 
            };

            const { error } = await window.supabaseClient
                .from('profiles')
                .update({ name: fallbackName, phone: phone, raw_data: mergedRawData })
                .eq('id', userId);

            if (error) throw error;
            
            document.getElementById('admin-edit-user-modal').remove();
            
            if (document.getElementById('admin-user-list-modal')) {
                openUserList(); 
            }
        } catch (err) {
            alert("儲存失敗: " + err.message);
            btn.innerHTML = '💾 儲存變更'; 
            btn.disabled = false;
        }
    }

    async function deleteUser(userId) {
        if (!confirm('⚠️ 確定要停用此帳號嗎？(停用後無法登入系統)')) return;
        
        const { error } = await window.supabaseClient
            .from('profiles')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', userId);
            
        if (error) alert('❌ 停用失敗: ' + error.message);
        else openUserList();
    }

    async function restoreUser(userId) {
        if (!confirm('✅ 確定要重新啟用此帳號嗎？')) return;
        
        const { error } = await window.supabaseClient
            .from('profiles')
            .update({ deleted_at: null })
            .eq('id', userId);
            
        if (error) alert('❌ 啟用失敗: ' + error.message);
        else openUserList();
    }

    return { 
        openUserList, 
        openAddUserModal, 
        submitNewUser, 
        openEditUserModal, 
        saveEditUser, 
        deleteUser, 
        restoreUser 
    };
})();

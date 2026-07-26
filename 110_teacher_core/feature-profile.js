/**
 * 📂 檔案路徑：110_teacher_core/feature-profile.js
 * 🌟 v4.0 規格重構版：導入精細化姓名收集、智慧名稱即時預覽、全面拔除舊版方舟計畫
 * 🎨 格式說明：代碼完全展開排版，無任何省略，方便直接複製貼上與後續維護
 */

window.FeatureProfile = (() => {

    function getCurrentStaffRole() {
        try {
            const sessionStr = localStorage.getItem('LogOnEnglish_Session');
            if (sessionStr) {
                const session = JSON.parse(sessionStr);
                if (session.activeContext && session.activeContext.staffRole) {
                    return session.activeContext.staffRole;
                }
            }
        } catch (e) {}
        const storedRole = localStorage.getItem('activeRole');
        return storedRole ? storedRole : 'ta_junior';
    }

    // 🧠 核心大腦：名字動態組合邏輯 (用於計算老師自己的預覽與打招呼名稱)
    function calculateDisplayName(rawData, effectiveMode) {
        const enName = (rawData.nameEN || '').trim();
        const passLast = (rawData.passportLast || '').trim();
        const passFirst = (rawData.passportFirst || '').trim();
        const lastCN = (rawData.lastNameCN || '').trim();
        const firstCN = (rawData.firstNameCN || '').trim();
        const fullCN = `${lastCN}${firstCN}`.trim();
        
        if (effectiveMode === 'cn_first') {
            // 🇹🇼 模式 2：中文全名 + (英文名字)
            if (fullCN && enName) {
                return `${fullCN} (${enName})`;
            }
            if (fullCN) {
                return fullCN;
            }
            if (enName) {
                return enName;
            }
            return '未命名';
        } else {
            // 🇺🇸 模式 1：英文名字 + 護照姓氏 (系統預設)
            if (enName && passLast) {
                return `${enName} ${passLast}`;
            }
            if (enName) {
                return enName;
            }
            if (passLast) {
                return passLast;
            }
            if (fullCN) {
                return fullCN;
            }
            return '未命名';
        }
    }

    // 🚪 獨立出的安全登出邏輯，供全域與動態按鈕共用
    async function logout() {
        if (confirm('⚠️ 確定要安全登出系統，並註銷當前裝置的雲端授權嗎？')) {
            if (window.logoutToLogin) {
                await window.logoutToLogin(true);
                return;
            }
            try {
                if (typeof window.supabaseClient !== 'undefined') {
                    await window.supabaseClient.auth.signOut();
                }
            } catch (e) {
                console.warn("雲端登出失敗，執行強制本地清除");
            }
            localStorage.clear();
            sessionStorage.clear();
            const loginUrl = window.buildLoginUrl
                ? window.buildLoginUrl(true)
                : '../index.html?clear=true&_=' + Date.now();
            window.location.replace(loginUrl);
        }
    }

    // 載入與渲染雲端教師個人設定介面
    async function loadUserProfile() {
        const greeting = document.getElementById('top-teacher-greeting');
        let profileContainer = document.getElementById('teacher-profile-container');
        
        // 防呆機制：如果 index.html 中沒有這個容器，自動動態建立並插入
        if (!profileContainer) {
            const viewProfile = document.getElementById('view-profile');
            if (viewProfile) {
                profileContainer = document.createElement('div');
                profileContainer.id = 'teacher-profile-container';
                const topBar = viewProfile.querySelector('.top-bar');
                if (topBar) {
                    topBar.insertAdjacentElement('afterend', profileContainer);
                } else {
                    viewProfile.prepend(profileContainer);
                }
            }
        }
        
        try {
            // 1. 取得 Supabase 目前認證的 User 物件
            const { data: { user }, error: authErr } = await window.supabaseClient.auth.getUser();
            if (authErr || !user) {
                throw new Error("尚未登入或授權過期");
            }

            // 2. 從 profiles 表格抓取當前老師最即時的雲端資料
            const { data: profile, error: dbErr } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .is('deleted_at', null)
                .single();

            if (dbErr) {
                throw dbErr;
            }

            // 3. 安全向探測系統全域預設值，作為保底顯示模式
            let globalMode = 'en_first';
            try {
                const { data: sysData } = await window.supabaseClient
                    .from('system_settings')
                    .select('value')
                    .eq('setting_key', 'global_name_mode')
                    .maybeSingle();
                if (sysData && sysData.value) {
                    globalMode = sysData.value;
                }
            } catch (e) {
                console.warn("[FeatureProfile] 讀取全域預設模式失敗，將採用 en_first 保底");
            }

            // 解構欄位資料
            const rawData = profile.raw_data || {};
            const phone = profile.phone || '';
            const teachStyle = rawData.teach_style || '';
            const preferredNameMode = rawData.preferred_name_mode || 'default';
            const staffRole = getCurrentStaffRole();
            const canSetNameMode = staffRole !== 'ta_junior';
            
            // 計算目前最終展現給老師看的名稱
            const effectiveMode = preferredNameMode !== 'default' ? preferredNameMode : globalMode;
            let currentDisplayName = calculateDisplayName(rawData, effectiveMode);
            if (currentDisplayName === '未命名') {
                currentDisplayName = profile.name || 'User';
            }

            // 更新網頁左上角或右上角的打招呼標題
            if (greeting) {
                greeting.textContent = `Hi, Teacher ${currentDisplayName} 👋`;
            }

            // 4. 繪製純雲端架構的精細姓名設定表單
            if (profileContainer) {
                let nameModeSectionHtml = '';
                if (canSetNameMode) {
                    nameModeSectionHtml = `
                        <div style="margin-bottom: 25px; padding: 15px; background: #F8FAFC; border: 2px dashed #CBD5E1; border-radius: 8px;">
                            <label style="display:block; font-weight:800; color:#3B82F6; margin-bottom:5px;">👁️ 個人名單顯示偏好 (最高優先權)</label>
                            <p style="color:#64748B; font-size: 0.85rem; margin-top:0; margin-bottom: 15px;">設定後，無論您進入哪一個補習班班級，學生名單都會強制優先套用此格式。</p>
                            
                            <div style="display: flex; flex-direction: column; gap: 12px;">
                                <label style="cursor: pointer; font-weight: 800; color: #475569; display: flex; align-items: center;">
                                    <input type="radio" name="prof_name_mode" value="default" ${preferredNameMode === 'default' ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;"> 
                                    ⚙️ 不覆寫 (跟隨各班級或分校全域預設)
                                </label>
                                <label style="cursor: pointer; font-weight: 800; color: #475569; display: flex; align-items: center;">
                                    <input type="radio" name="prof_name_mode" value="en_first" ${preferredNameMode === 'en_first' ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;"> 
                                    🇺🇸 模式 1：英文名字 + 護照姓氏 <span style="color:#94a3b8; font-weight:normal; margin-left: 5px;">(例如：Amy Lin)</span>
                                </label>
                                <label style="cursor: pointer; font-weight: 800; color: #475569; display: flex; align-items: center;">
                                    <input type="radio" name="prof_name_mode" value="cn_first" ${preferredNameMode === 'cn_first' ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;"> 
                                    🇹🇼 模式 2：中文全名 + (英文名字) <span style="color:#94a3b8; font-weight:normal; margin-left: 5px;">(例如：林美玲 (Amy))</span>
                                </label>
                            </div>
                        </div>
                    `;
                }

                profileContainer.innerHTML = `
                    <div style="background: white; padding: 25px; border-radius: 12px; border: 1px solid #E2E8F0; margin-bottom: 20px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);" class="settings-card">
                        <h3 style="margin-top: 0; margin-bottom: 20px; color: var(--primary-dark); display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px;">
                            👤 雲端教師檔案參數設定
                        </h3>
                        
                        <div style="margin-bottom: 20px;">
                            <label style="display:block; font-weight:800; color:#475569; margin-bottom:5px;">電子郵件 (登入帳號公鑰)</label>
                            <input type="text" class="form-control" value="${profile.email}" disabled style="background:#F1F5F9; color:#94A3B8; cursor:not-allowed; width:100%; max-width: 400px;">
                        </div>

                        <div style="background: #F8FAFC; padding: 20px; border-radius: 8px; border: 1px dashed #CBD5E1; margin-bottom: 25px;">
                            <div style="margin-bottom: 15px;">
                                <label style="display:block; color: #3B82F6; font-weight:800; margin-bottom:5px;">👁️ 系統姓名智慧預覽 <span style="font-size: 0.85em; color: #94A3B8; font-weight: normal;">(系統將自動依據偏好即時組裝)</span></label>
                                <input type="text" id="prof-sysDisplayName" class="form-control" disabled value="${currentDisplayName}" style="width:100%; max-width: 400px; background: #DBEAFE; color: #1E3A8A; font-weight: bold; border-color: #93C5FD;">
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                                <div class="form-group" style="margin-top: 0;">
                                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px; font-size: 0.9rem;">英文名字 (First Name)</label>
                                    <input type="text" id="prof-nameEN" class="form-control" value="${rawData.nameEN || ''}" placeholder="例如：Amy" style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-top: 0;">
                                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px; font-size: 0.9rem;">護照姓氏 (Last Name)</label>
                                    <input type="text" id="prof-passLast" class="form-control" value="${rawData.passportLast || ''}" placeholder="例如：Lin" style="width: 100%;">
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                                <div class="form-group" style="margin-top: 0;">
                                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px; font-size: 0.9rem;">護照名字 (First Name)</label>
                                    <input type="text" id="prof-passFirst" class="form-control" value="${rawData.passportFirst || ''}" placeholder="例如：Mei-Ling" style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-top: 0;">
                                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px; font-size: 0.9rem;">中文姓氏</label>
                                    <input type="text" id="prof-lastCN" class="form-control" value="${rawData.lastNameCN || ''}" placeholder="例如：林" style="width: 100%;">
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                <div class="form-group" style="margin-top: 0;">
                                    <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px; font-size: 0.9rem;">中文名字</label>
                                    <input type="text" id="prof-firstCN" class="form-control" value="${rawData.firstNameCN || ''}" placeholder="例如：美玲" style="width: 100%;">
                                </div>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:800; color:#475569; margin-bottom:5px;">聯絡電話</label>
                                <input type="tel" id="prof-input-phone" class="form-control" value="${phone}" placeholder="例如: 0912-345-678" style="width:100%;">
                            </div>
                            
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:800; color:#475569; margin-bottom:5px;">教學風格 / 座右銘</label>
                                <input type="text" id="prof-input-style" class="form-control" value="${teachStyle}" placeholder="例如: 輕鬆幽默 / 斯巴達嚴格" style="width:100%;">
                            </div>
                        </div>

                        ${nameModeSectionHtml}

                        <div style="margin-bottom: 20px;">
                            <label style="display:block; font-weight:800; color:#475569; margin-bottom:5px;">專屬 Google Drive 連結 (唯讀)</label>
                            <input type="text" class="form-control" value="${window.ProfileForm ? window.ProfileForm.getDriveDisplay(rawData) : '尚未綁定雲端硬碟'}" disabled style="width:100%; max-width: 400px; background:#F1F5F9; color:#94A3B8; cursor:not-allowed;">
                        </div>

                        <div style="margin-bottom: 25px;">
                            ${window.ProfileForm ? window.ProfileForm.passwordFieldHtml('prof-password', 'prof-password-toggle') : '<label>修改密碼 (若不修改請留白)</label><input type="password" id="prof-password" class="form-control" placeholder="輸入新密碼">'}
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <button id="btn-save-profile" class="btn btn-primary" style="padding: 10px 24px; font-weight: bold;">💾 儲存雲端設定</button>
                                <span id="profile-save-msg" style="font-weight: bold;"></span>
                            </div>
                            <button id="btn-logout-safe" class="btn-danger" style="padding: 10px 20px; border-radius:8px; border:none; cursor:pointer; font-weight: bold;">🚪 安全登出</button>
                        </div>
                    </div>
                `;

                // 🔄 監聽輸入事件：動態更新「智慧姓名預覽欄位」
                const triggerPreviewUpdate = () => {
                    const localRaw = {
                        nameEN: document.getElementById('prof-nameEN').value,
                        passportLast: document.getElementById('prof-passLast').value,
                        passportFirst: document.getElementById('prof-passFirst').value,
                        lastNameCN: document.getElementById('prof-lastCN').value,
                        firstNameCN: document.getElementById('prof-firstCN').value
                    };
                    let activeMode = globalMode;
                    if (canSetNameMode) {
                        const selectedRadio = document.querySelector('input[name="prof_name_mode"]:checked');
                        if (selectedRadio && selectedRadio.value !== 'default') {
                            activeMode = selectedRadio.value;
                        }
                    } else if (preferredNameMode !== 'default') {
                        activeMode = preferredNameMode;
                    }
                    const calculated = calculateDisplayName(localRaw, activeMode);
                    
                    document.getElementById('prof-sysDisplayName').value = calculated === '未命名' ? '' : calculated;
                };

                // 綁定輸入監聽
                ['prof-nameEN', 'prof-passLast', 'prof-passFirst', 'prof-lastCN', 'prof-firstCN'].forEach((id) => {
                    document.getElementById(id).addEventListener('input', triggerPreviewUpdate);
                });
                
                // 綁定單選鈕切換監聽
                if (canSetNameMode) {
                    document.querySelectorAll('input[name="prof_name_mode"]').forEach((radio) => {
                        radio.addEventListener('change', triggerPreviewUpdate);
                    });
                }

                if (window.ProfileForm) {
                    window.ProfileForm.bindPasswordToggle('prof-password-toggle', 'prof-password');
                }

                // 💾 儲存點擊邏輯
                document.getElementById('btn-save-profile').onclick = async function() {
                    const btn = this;
                    const msgSpan = document.getElementById('profile-save-msg');
                    
                    const nameEN = document.getElementById('prof-nameEN').value.trim();
                    const passLast = document.getElementById('prof-passLast').value.trim();
                    const passFirst = document.getElementById('prof-passFirst').value.trim();
                    const lastCN = document.getElementById('prof-lastCN').value.trim();
                    const firstCN = document.getElementById('prof-firstCN').value.trim();
                    const fullCN = `${lastCN}${firstCN}`.trim();

                    // 智慧防呆：至少要有一種姓名可以作為保底
                    if (!nameEN && !fullCN) {
                        return window.showFlash('儲存失敗：請至少填寫「英文名字」或「中文姓名」', 'error');
                    }

                    const newPhone = document.getElementById('prof-input-phone').value.trim();
                    const newStyle = document.getElementById('prof-input-style').value.trim();
                    const newPwdEl = document.getElementById('prof-password');
                    const newPwd = newPwdEl ? newPwdEl.value.trim() : '';
                    let newNameMode = preferredNameMode;
                    if (canSetNameMode) {
                        const modeRadio = document.querySelector('input[name="prof_name_mode"]:checked');
                        if (modeRadio) {
                            newNameMode = modeRadio.value;
                        }
                    }
                    
                    // 以預覽文字框的值作為基礎 name 的寫入保底
                    const finalFallbackName = document.getElementById('prof-sysDisplayName').value.trim() || fullCN || nameEN;

                    const originalText = btn.innerHTML;
                    btn.innerHTML = '⏳ 儲存中...';
                    btn.disabled = true;
                    msgSpan.textContent = '';

                    try {
                        // 打包合併最新的 JSONB 核心設定，防止覆寫遺漏
                        const mergedRawData = { 
                            ...rawData, 
                            teach_style: newStyle, 
                            preferred_name_mode: newNameMode,
                            nameEN: nameEN,
                            passportLast: passLast,
                            passportFirst: passFirst,
                            lastNameCN: lastCN,
                            firstNameCN: firstCN
                        };

                        // 執行 Supabase 雲端資料更新
                        const { error: updateErr } = await window.supabaseClient
                            .from('profiles')
                            .update({ 
                                name: finalFallbackName, 
                                phone: newPhone, 
                                raw_data: mergedRawData 
                            })
                            .eq('id', user.id);

                        if (updateErr) throw updateErr;

                        if (newPwd && window.ProfileForm) {
                            await window.ProfileForm.updatePasswordIfProvided(newPwd);
                        }

                        // 同步更新畫面的招呼語
                        if (greeting) {
                            greeting.textContent = `Hi, Teacher ${finalFallbackName} 👋`;
                        }
                        
                        btn.innerHTML = '✅ 儲存成功';
                        btn.style.background = '#10B981';
                        btn.style.borderColor = '#10B981';
                        msgSpan.style.color = '#10B981';
                        msgSpan.textContent = '設定已成功同步至 Supabase 雲端！';

                        // 聯動：如果當前班級的學生管理器處於開啟狀態，立刻觸發重繪套用新規則
                        if (window.TeacherUI && window.FeatureClassMembers && typeof window.FeatureClassMembers.renderStudentManager === 'function') {
                            const currentClassId = window.TeacherUI.getCurrentClassId();
                            if (currentClassId) {
                                window.FeatureClassMembers.renderStudentManager(currentClassId);
                            }
                        }

                        setTimeout(() => {
                            btn.innerHTML = originalText;
                            btn.style.background = '';
                            btn.style.borderColor = '';
                            btn.disabled = false;
                            msgSpan.textContent = '';
                        }, 2000);

                    } catch (err) {
                        msgSpan.style.color = '#EF4444';
                        msgSpan.textContent = "❌ 儲存失敗: " + err.message;
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                };

                // 綁定動態生成的按鈕到共用的 logout 邏輯
                document.getElementById('btn-logout-safe').onclick = logout;
            }
        } catch (err) {
            console.error("載入雲端設定失敗，退回本地 UI 保底模式:", err);
            if (greeting && window.CurrentTeacherName) {
                greeting.textContent = `Hi, Teacher ${window.CurrentTeacherName} 👋`;
            }
        }
    }

    // ==========================================
    // 🧹 自動化外科清創：掃除舊 HTML 中的離線區塊
    // ==========================================
    window.addEventListener('DOMContentLoaded', () => {
        // 1. 偵測並移除「本地端老師身分切換」
        const oldProfilesSelect = document.getElementById('select-teacher-profile');
        if (oldProfilesSelect) {
            const parentCard = oldProfilesSelect.closest('.settings-card') || oldProfilesSelect.parentElement;
            if (parentCard) {
                parentCard.remove();
            }
        }
        
        // 2. 偵測並移除方舟計畫的「下載備份」按鈕卡片
        const oldExportBtn = document.getElementById('btn-export-data');
        if (oldExportBtn) {
            const parentCard = oldExportBtn.closest('.settings-card') || oldExportBtn.parentElement;
            if (parentCard) {
                parentCard.remove();
            }
        }

        // 3. 偵測並移除方舟計畫的「匯入還原」與「重置資料」卡片
        const oldResetBtn = document.getElementById('btn-reset-data');
        if (oldResetBtn) {
            const parentCard = oldResetBtn.closest('.settings-card') || oldResetBtn.parentElement;
            if (parentCard) {
                parentCard.remove();
            }
        }

        // 延遲觸發雲端 UI 渲染
        setTimeout(loadUserProfile, 300);
    });

    // 🌟 將 logout 暴露給全域環境，讓 index.html 可以呼叫
    return { logout };
})();

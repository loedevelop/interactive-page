/**
 * 📂 檔案路徑：110_teacher_core/feature-member-management.js
 * 🌟 v6.7 終極解耦版：實作學生加入班級時「自動生成專屬個人資料夾」並綁定 JSONB
 */

export class MemberManager {
    constructor(containerId, classId, currentUserRole) {
        this.container = document.getElementById(containerId);
        this.classId = classId;
        this.currentUserRole = currentUserRole;
        this.supabase = window.supabaseClient; 

        if (!this.container) {
            console.error(`[MemberManager] 找不到容器 ID: ${containerId}`);
            return;
        }

        this.initUI();
    }

    syncWithTab(tabName) {
        const roleSelect = document.getElementById('memberRole');
        if (!roleSelect) return;
        
        if (tabName === 'student') roleSelect.value = 'student';
        else if (tabName === 'staff') roleSelect.value = 'co_teacher';
        else if (tabName === 'parent') roleSelect.value = 'parent';
        
        roleSelect.dispatchEvent(new Event('change'));
    }

    openAndSync(tabName, studentId = null) {
        const toggleBtn = document.getElementById('toggleMemberFormBtn');
        const form = document.getElementById('addMemberForm');
        
        if (form && form.style.display === 'none' && toggleBtn) {
            toggleBtn.click();
        }
        
        this.syncWithTab(tabName);
        
        setTimeout(() => {
            if (studentId) {
                const childSelect = document.getElementById('childUserId');
                if (childSelect) childSelect.value = studentId;
            }
            
            const formContainer = document.getElementById('toggleMemberFormBtn');
            if (formContainer) {
                formContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            const emailInput = document.getElementById('memberEmail');
            if (emailInput) emailInput.focus();
        }, 500); 
    }

    initUI() {
        this.container.innerHTML = `
            <div class="settings-card" style="border: 2px dashed #cbd5e1; background: #f8fafc; margin-bottom: 20px;">
                
                <div id="toggleMemberFormBtn" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                    <h3 style="margin: 0; color: #334155; display: flex; align-items: center; gap: 8px;">
                        ➕ 新增班級成員 / 綁定家長
                        <span style="font-size: 0.9rem; color: #94A3B8; font-weight: normal;">(點擊展開)</span>
                    </h3>
                    <span id="toggleIcon" style="font-size: 1.2rem; color: #64748B;">🔽</span>
                </div>

                <form id="addMemberForm" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                    
                    <div style="background: #ffffff; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
                        <h4 style="margin-top: 0; margin-bottom: 15px; color: #475569;">👤 姓名資料</h4>
                        
                        <div class="form-group" style="margin-top: 0; margin-bottom: 15px;">
                            <label style="color: #3B82F6;">👁️ 系統顯示名稱預覽 <span style="color:#94a3b8; font-size: 0.85em; font-weight: normal;">(將依下方輸入自動產生)</span></label>
                            <input type="text" id="sysDisplayName" class="form-control" disabled placeholder="尚未輸入" style="background-color: #F1F5F9; color: #0F172A; font-weight: 800; border-color: #BFDBFE;">
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label>英文名字 (First Name)</label>
                                <input type="text" id="nameEN" class="form-control" placeholder="例如：Jason">
                            </div>
                            <div class="form-group" style="margin-top: 0;">
                                <label>護照姓氏 (Last Name)</label>
                                <input type="text" id="passportLast" class="form-control" placeholder="例如：Liu">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label>護照名字 (First Name)</label>
                                <input type="text" id="passportFirst" class="form-control" placeholder="例如：Jie-Xuan">
                            </div>
                            <div class="form-group" style="margin-top: 0;">
                                <label>中文姓氏</label>
                                <input type="text" id="lastNameCN" class="form-control" placeholder="例如：劉">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label>中文名字</label>
                                <input type="text" id="firstNameCN" class="form-control" placeholder="例如：傑軒">
                            </div>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div class="form-group" style="margin-top: 0;">
                            <label>📧 聯絡信箱 (Email) <span style="color:red;">*</span></label>
                            <input type="email" id="memberEmail" class="form-control" required placeholder="例如：name@example.com">
                            <label style="display: flex; align-items: center; gap: 8px; font-weight: normal; cursor: pointer; color: #475569; margin-top: 8px; font-size: 0.9rem;">
                                <input type="checkbox" id="isSharedEmail" style="transform: scale(1.1);">
                                <span>🔗 此為共用信箱 (系統將結合姓名自動變異生成獨立的分身帳號)</span>
                            </label>
                        </div>

                        <div class="form-group" style="margin-top: 0;">
                            <label>📱 手機號碼 <span style="color:#94a3b8; font-size: 0.85em; font-weight: normal;">(若為共用信箱，請務必填寫以生成帳號)</span></label>
                            <input type="tel" id="memberPhone" class="form-control" placeholder="例如：0912345678">
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                        <div class="form-group" style="margin-top: 0;">
                            <label style="display: flex; align-items: center; gap: 8px;">
                                🏷️ 指派身分 <span style="color:red;">*</span>
                            </label>
                            
                            <div style="position: relative;">
                                <select id="memberRole" class="form-control" required>
                                    <option value="" disabled selected>請選擇成員身分...</option>
                                    <option value="student">🎓 學生 (Student)</option>
                                    ${this.renderStaffOptions()}
                                    <option value="parent">👨‍👩‍👧 家長 (Parent)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="form-group" id="studentDriveGroup" style="display: none; margin-top: 15px;">
                        <label>📁 專屬 Drive 連結 <span style="color:#94a3b8; font-size: 0.85em; font-weight: normal;">(選填：若不填寫，系統將自動於班級資料夾中生成)</span></label>
                        <input type="url" id="memberDriveLink" class="form-control" placeholder="請貼上 Google Drive 連結...">
                    </div>

                    <div class="form-group" id="childSelectionGroup" style="display: none; margin-top: 15px; background: #FFFBEB; padding: 15px; border-radius: 8px; border: 1px dashed #FCD34D;">
                        <label style="color:#92400E;">🔗 綁定本班學生 <span style="color:red;">*</span> <span style="color:#B45309; font-size: 0.85em; font-weight: normal;">(家長帳號將獲得此學生的觀測權限)</span></label>
                        <select id="childUserId" class="form-control" style="border-color: #FCD34D;">
                            <option value="" disabled selected>載入學生名單中...</option>
                        </select>
                    </div>

                    <div style="margin-top: 25px; display: flex; align-items: center; gap: 15px;">
                        <button type="submit" id="submitMemberBtn" class="btn btn-primary" style="padding: 10px 20px;">➕ 確認送出</button>
                        <div id="formMessage" style="font-weight: bold; font-size: 0.95rem; line-height: 1.4;"></div>
                    </div>
                </form>
            </div>
        `;

        this.bindEvents();
    }

    renderStaffOptions() {
        if (['admin', 'primary_teacher'].includes(this.currentUserRole)) {
            return `
                <option value="co_teacher">🧑‍🏫 協同老師 (Co-Teacher)</option>
                <option value="ta_senior">⭐ 資深助教 (TA Senior)</option>
                <option value="ta_junior">🎓 一般助教 (TA Junior)</option>
            `;
        }
        return ''; 
    }

    updateNamePreview() {
        const enName = document.getElementById('nameEN').value.trim();
        const passLast = document.getElementById('passportLast').value.trim();
        const lastCN = document.getElementById('lastNameCN').value.trim();
        const firstCN = document.getElementById('firstNameCN').value.trim();
        const fullCN = `${lastCN}${firstCN}`.trim();

        let previewName = "";

        if (enName && passLast) {
            previewName = `${enName} ${passLast}`;
        } else if (enName) {
            previewName = enName;
        } else if (fullCN) {
            previewName = fullCN;
        }

        document.getElementById('sysDisplayName').value = previewName;
    }

    bindEvents() {
        const toggleBtn = document.getElementById('toggleMemberFormBtn');
        const form = document.getElementById('addMemberForm');
        const toggleIcon = document.getElementById('toggleIcon');

        toggleBtn.addEventListener('click', () => {
            if (form.style.display === 'none') {
                form.style.display = 'block';
                toggleIcon.textContent = '🔼';
            } else {
                form.style.display = 'none';
                toggleIcon.textContent = '🔽';
            }
        });

        const nameInputs = ['nameEN', 'passportLast', 'lastNameCN', 'firstNameCN'];
        nameInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updateNamePreview());
        });

        const roleSelect = document.getElementById('memberRole');

        roleSelect.addEventListener('change', async (e) => {
            const selectedRole = e.target.value;
            const childGroup = document.getElementById('childSelectionGroup');
            const childSelect = document.getElementById('childUserId');
            const driveGroup = document.getElementById('studentDriveGroup');

            childGroup.style.display = 'none';
            childSelect.removeAttribute('required');
            driveGroup.style.display = 'none';

            if (selectedRole === 'parent') {
                childGroup.style.display = 'block';
                childSelect.setAttribute('required', 'true');
                await this.fetchClassStudents(); 
            } else if (selectedRole === 'student') {
                driveGroup.style.display = 'block';
            }
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });
    }

    async fetchClassStudents() {
        const childSelect = document.getElementById('childUserId');
        childSelect.innerHTML = '<option value="" disabled selected>載入中...</option>';

        try {
            const { data, error } = await this.supabase
                .from('student_enrollments')
                .select(`
                    user_id,
                    profiles!inner(name, raw_data)
                `)
                .eq('class_id', this.classId)
                .is('deleted_at', null);

            if (error) throw error;

            if (data.length === 0) {
                childSelect.innerHTML = '<option value="" disabled selected>本班目前無學生可綁定</option>';
                return;
            }

            childSelect.innerHTML = '<option value="" disabled selected>請選擇綁定的學生...</option>';
            data.forEach(enrollment => {
                const option = document.createElement('option');
                option.value = enrollment.user_id;
                
                let raw = {};
                try {
                    raw = typeof enrollment.profiles.raw_data === 'string' ? JSON.parse(enrollment.profiles.raw_data) : (enrollment.profiles.raw_data || {});
                } catch(e) {}
                
                const enName = raw.nameEN || '';
                const cnName = `${raw.lastNameCN || ''}${raw.firstNameCN || ''}`;
                const display = enName ? (cnName ? `${enName} (${cnName})` : enName) : (cnName || enrollment.profiles.name);
                
                option.textContent = display; 
                childSelect.appendChild(option);
            });

        } catch (err) {
            console.error('[fetchClassStudents Error]', err);
            childSelect.innerHTML = '<option value="" disabled selected>無法載入學生名單，請檢查網路</option>';
        }
    }

    async handleFormSubmit() {
        const btn = document.getElementById('submitMemberBtn');
        const msgBox = document.getElementById('formMessage');
        
        const nameEN = document.getElementById('nameEN').value.trim();
        const passportLast = document.getElementById('passportLast').value.trim();
        const passportFirst = document.getElementById('passportFirst').value.trim();
        const lastNameCN = document.getElementById('lastNameCN').value.trim();
        const firstNameCN = document.getElementById('firstNameCN').value.trim();
        const fullCN = `${lastNameCN}${firstNameCN}`.trim();
        
        if (!nameEN && !fullCN) {
            alert("⚠️ 建立帳號失敗：請至少輸入「英文名字」或「中文姓名」。");
            return;
        }

        const fallbackName = document.getElementById('sysDisplayName').value.trim() || fullCN || nameEN;
        
        let targetEmail = document.getElementById('memberEmail').value.trim().toLowerCase();
        const phone = document.getElementById('memberPhone').value.trim();
        const role = document.getElementById('memberRole').value;
        const childUserId = document.getElementById('childUserId').value;
        const driveLink = document.getElementById('memberDriveLink').value.trim();
        const isShared = document.getElementById('isSharedEmail').checked;

        let isMutated = false;
        if (isShared) {
            const [username, domain] = targetEmail.split("@");
            const supportedAliasDomains = ["gmail.com", "googlemail.com", "icloud.com"];
            const rawEn = nameEN;
            const rawLastCN = lastNameCN;
            const rawFirstCN = firstNameCN;
            const mutationName = (rawEn || rawLastCN + rawFirstCN).replace(/\s+/g, '') || "User";

            if (supportedAliasDomains.includes(domain)) {
                targetEmail = `${username}+${mutationName}@${domain}`.toLowerCase();
            } else {
                if (!phone || phone.replace(/[^0-9]/g, "").length < 4) {
                    alert("⚠️ 此信箱網域不支援別名，系統需轉換為 LogOn 內部網域。請務必填寫「手機號碼」(至少4碼)！");
                    return;
                }
                const phoneLast4 = phone.replace(/[^0-9]/g, "").slice(-4);
                targetEmail = `${mutationName}.${phoneLast4}@logonenglish.com`.toLowerCase();
            }
            isMutated = true;
        }

        const rawDataPayload = {
            nameEN: nameEN,
            passportLast: passportLast,
            passportFirst: passportFirst,
            lastNameCN: lastNameCN,
            firstNameCN: firstNameCN
        };

        btn.disabled = true;
        btn.innerHTML = '⏳ 資料驗證與建檔中...';
        msgBox.innerHTML = '';
        msgBox.style.color = 'black';

        let targetUserId = null;
        let isExistingUser = false;
        let loginPassword = '';
        let isMutatedFromBackend = false;

        try {
            const result = await this.invokeSilentCreation(fallbackName, targetEmail, phone, role, rawDataPayload, isMutated, document.getElementById('memberEmail').value.trim());
            targetUserId = result.user_id;
            isExistingUser = result.is_existing;
            loginPassword = result.login_password;
            isMutatedFromBackend = result.is_mutated;

            try {
                if (role === 'student') {
                    // 🌟 核心防護：將建立資料夾的職責委託給 assignStudent 處理
                    await this.assignStudent(targetUserId, driveLink, fallbackName);
                } else if (['co_teacher', 'ta_senior', 'ta_junior'].includes(role)) {
                    await this.assignStaff(targetUserId, role);
                } else if (role === 'parent') {
                    await this.assignParent(targetUserId, childUserId);
                }
            } catch (assignError) {
                if (targetUserId && !isExistingUser) {
                    await this.rollbackOrphanedUser(targetUserId);
                }
                throw new Error(`${assignError.message} (系統已自動攔截並復原無效狀態)`);
            }

            msgBox.style.color = '#10B981'; 
            if (isExistingUser) {
                msgBox.innerHTML = `✅ 此帳號已存在，已成功同步資料並指派至本班！`;
            } else {
                if (isMutatedFromBackend) {
                    msgBox.innerHTML = `✅ 已自動生成分身帳號與個人資料夾！<br><span style="font-size:0.85em; color:#475569;">登入帳號: <b>${targetEmail}</b><br>預設密碼: <b>${loginPassword}</b></span>`;
                } else {
                    msgBox.innerHTML = `✅ 成功加入並生成專屬資料夾！<br><span style="font-size:0.85em; color:#475569;">預設密碼為: <b>${loginPassword}</b></span>`;
                }
            }
            
            document.getElementById('addMemberForm').reset();
            document.getElementById('sysDisplayName').value = ''; 
            document.getElementById('childSelectionGroup').style.display = 'none';
            document.getElementById('studentDriveGroup').style.display = 'none';

            if (window.FeatureClassMembers && typeof window.FeatureClassMembers.renderStudentManager === 'function') {
                await window.FeatureClassMembers.renderStudentManager(this.classId);
            }

        } catch (err) {
            console.error('[Submit Error]', err);
            msgBox.style.color = '#EF4444'; 
            
            if (err.message.includes('找不到雲端函數') || err.message.includes('fetch')) {
                msgBox.innerHTML = `❌ <b>寫入失敗: 雲端邊緣函數尚未部署。</b>`;
            } else {
                msgBox.innerHTML = `❌ 寫入失敗: <br><span style="font-size: 0.9em; font-weight: normal;">${err.message || '請稍後再試'}</span>`;
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '➕ 確認送出';
        }
    }

    async invokeSilentCreation(name, email, phone, roleType, rawDataPayload, isMutated, originalEmail) {
        const { data, error } = await this.supabase.functions.invoke('admin_create_user', {
            body: { 
                name: name, 
                email: email, 
                phone: phone, 
                roleType: roleType,
                rawData: rawDataPayload,
                isMutated: isMutated,
                originalEmail: isMutated ? originalEmail : null
            }
        });

        if (error) {
            console.error("Edge Function 錯誤:", error);
            if (error.message && error.message.includes('Failed to send a request')) {
                throw new Error("找不到雲端函數");
            }
            throw new Error(`伺服器拒絕連線 (${error.message})`);
        }

        if (!data || !data.success) {
            throw new Error(data?.error || '建檔過程發生未知錯誤');
        }

        return data; 
    }

    // 🌟 核心升級：加入班級即刻生成資料夾 (路線二：班級絕對隔離)
    async assignStudent(userId, driveLink, studentName) {
        let finalDriveLink = driveLink || null;
        let enrollRawData = {};

        // 情境：老師沒有手動填寫 Google Drive 網址，系統啟動自動生成機制
        if (!finalDriveLink) {
            const { data: classData } = await this.supabase
                .from('classes')
                .select('raw_data')
                .eq('id', this.classId)
                .maybeSingle();

            let classRaw = classData?.raw_data || {};
            if (typeof classRaw === 'string') {
                try { classRaw = JSON.parse(classRaw); } catch(e){}
            }

            const parentFolderId = classRaw.drive_folder_id;

            if (parentFolderId && window.ApiService && typeof window.ApiService.createGASFolder === 'function') {
                // 產生高辨識度且具備唯一性的檔名 (例: 林家宇_a7b2)
                const shortId = userId.substring(userId.length - 4);
                const safeName = (studentName || '未命名學生').replace(/[\\/:*?"<>|]/g, '_').trim();
                const folderName = `${safeName}_${shortId}`;

                try {
                    console.log(`[自動建檔] 準備在班級目錄下建立專屬資料夾: ${folderName}`);
                    const res = await window.ApiService.createGASFolder(folderName, parentFolderId);
                    
                    if (res && res.folderId) {
                        enrollRawData.drive_folder_id = res.folderId; // 精準寫入 JSONB
                    }
                } catch (e) {
                    console.warn('⚠️ 自動建立學生資料夾失敗，將保持空值，後續上傳將走公海收件匣降級策略:', e);
                }
            }
        }

        const payload = {
            class_id: this.classId,
            user_id: userId,
            drive_link: finalDriveLink,
            deleted_at: null
        };

        if (Object.keys(enrollRawData).length > 0) {
            payload.raw_data = enrollRawData;
        }

        const { error } = await this.supabase
            .from('student_enrollments')
            .upsert(payload, { onConflict: 'class_id,user_id' });
            
        if (error) throw new Error('學生已存在於本班或關聯寫入失敗');
    }

    async assignStaff(userId, staffRole) {
        const { error } = await this.supabase
            .from('class_staff')
            .upsert({ class_id: this.classId, user_id: userId, staff_role: staffRole, deleted_at: null }, { onConflict: 'class_id,user_id' });
        if (error) throw new Error('該教職員已存在於團隊中或關聯寫入失敗');
    }

    async assignParent(parentUserId, childUserId) {
        const { error } = await this.supabase
            .from('parent_child_mappings')
            .upsert({ parent_user_id: parentUserId, child_user_id: childUserId }, { onConflict: 'parent_user_id,child_user_id' });
        if (error) throw new Error('綁定家長與學生失敗');
    }

    async rollbackOrphanedUser(userId) {
        try {
            console.warn(`[防護網啟動] 正在標記並封存無法綁定班級的孤兒帳號: ${userId}`);
            await this.supabase
                .from('profiles')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', userId);
        } catch (e) {
            console.error('[Rollback Error] 標記孤兒帳號失敗', e);
        }
    }
}

window.RenderMemberManagerForm = function(containerId, classId, currentUserRole) {
    window.currentMemberManager = new MemberManager(containerId, classId, currentUserRole);
};
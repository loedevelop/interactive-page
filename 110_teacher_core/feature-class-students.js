/**
 * 📂 檔案路徑：110_teacher_core/feature-class-students.js
 * 🌟 v6.2 SaaS 規格淨化版：新增「教職員團隊」專屬區塊、補齊軟刪除，並封印前端 Email 修改權限防止脫鉤。
 */

window.FeatureClassStudents = (() => {
    const db = window.TeacherDB;
    
    if (db && !db.students) { 
        db.students = []; 
    }

    // 🧠 核心大腦：名字動態組合邏輯
    function calculateDisplayName(profile, effectiveMode) {
        const rawData = profile.raw_data || {};
        const enName = (rawData.nameEN || '').trim();
        const passLast = (rawData.passportLast || '').trim();
        const passFirst = (rawData.passportFirst || '').trim();
        const lastCN = (rawData.lastNameCN || '').trim();
        const firstCN = (rawData.firstNameCN || '').trim();
        const fullCN = `${lastCN}${firstCN}`.trim();
        
        const fallback = profile.name || '未命名';

        if (effectiveMode === 'cn_first') {
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

    // 🧑‍🏫 抓取「教職員」名單
    async function fetchStaffForClass(classId, effectiveMode) {
        try {
            if (!window.ApiService || typeof window.ApiService.fetchClassStaff !== 'function') return [];
            
            const rawStaff = await window.ApiService.fetchClassStaff(classId);
            
            return rawStaff.map(s => {
                const p = s.profiles || {};
                let roleDisplay = s.staff_role;
                if (s.staff_role === 'co_teacher') roleDisplay = '🧑‍🏫 協同老師';
                if (s.staff_role === 'ta_senior') roleDisplay = '⭐ 資深助教';
                if (s.staff_role === 'ta_junior') roleDisplay = '🎓 一般助教';
                if (s.staff_role === 'primary_teacher') roleDisplay = '👑 主老師';

                return {
                    id: s.user_id,
                    class_id: classId,
                    role: roleDisplay,
                    rawRole: s.staff_role,
                    displayName: calculateDisplayName(p, effectiveMode),
                    email: p.email || '未設定'
                };
            });
        } catch (error) {
            console.error("抓取教職員名單失敗:", error);
            return [];
        }
    }

    // 🎓 抓取「學生」名單
    async function fetchStudentsForClass(classId, effectiveMode) {
        try {
            if (!window.ApiService || typeof window.ApiService.fetchStudents !== 'function') {
                throw new Error("ApiService 尚未就緒！");
            }
            
            const rawStudents = await window.ApiService.fetchStudents(classId);
            
            return rawStudents.map(s => {
                const p = s.profiles || {};
                return {
                    id: s.user_id,
                    class_id: classId,
                    displayName: calculateDisplayName(p, effectiveMode),
                    email: p.email || '未設定',
                    password: p.password || '系統預設',
                    drive_url: s.drive_link || (p.raw_data ? p.raw_data.drive_url : '') || ''
                };
            });
        } catch (error) {
            console.error("抓取學生名單失敗:", error);
            return [];
        }
    }

    async function renderStudentManager(classId) {
        const container = document.getElementById('student-manager-container');
        if (!container) return;

        container.innerHTML = '<div style="padding: 20px; color: #64748B; font-weight:800;">⏳ 正在透過智慧引擎分析與載入名單...</div>';

        try {
            let effectiveMode = 'en_first'; 
            
            const { data: classData } = await window.supabaseClient.from('classes').select('raw_data').eq('id', classId).maybeSingle();
            const classMode = classData?.raw_data?.name_display_mode || 'default';
            if (classMode !== 'default') effectiveMode = classMode;

            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (user) {
                const { data: profData } = await window.supabaseClient.from('profiles').select('raw_data').eq('id', user.id).maybeSingle();
                const profMode = profData?.raw_data?.preferred_name_mode || 'default';
                if (profMode !== 'default') effectiveMode = profMode;
            }

            // 🌟 同時抓取教職員與學生
            const [classStaff, classStudents] = await Promise.all([
                fetchStaffForClass(classId, effectiveMode),
                fetchStudentsForClass(classId, effectiveMode)
            ]);

            db.students = db.students.filter(s => s.class_id !== classId).concat(classStudents);

            // 1️⃣ 產生教職員表格 HTML (新增移除按鈕)
            let staffTbody = classStaff.map((s, idx) => {
                const safeName = s.displayName.replace(/"/g, '&quot;');
                // 主老師不可被一般方式移除
                const actionBtn = s.rawRole === 'primary_teacher' 
                    ? '<span style="color:#94A3B8; font-size:0.85em;">無法移除</span>'
                    : `<button class="btn btn-danger" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.FeatureClassStudents.removeStaff('${s.id}', '${classId}')" title="移除此教職員">🗑️</button>`;

                return `
                <tr style="border-bottom: 1px solid #E2E8F0; background: #F8FAFC;">
                    <td style="padding: 10px; color: #64748B;">${idx + 1}</td>
                    <td style="padding: 10px; font-weight: bold; color: #475569;">${s.role}</td>
                    <td style="padding: 10px; font-weight: bold; color: #0F172A;">${safeName}</td>
                    <td style="padding: 10px; color: #64748B;">${s.email}</td>
                    <td style="padding: 10px; text-align: center;">${actionBtn}</td>
                </tr>
                `;
            }).join('');

            // 2️⃣ 產生學生表格 HTML (修復：信箱改為 Readonly 防止資料庫脫鉤)
            let studentTbody = classStudents.map((s, idx) => {
                const safeName = s.displayName.replace(/"/g, '&quot;');
                return `
                <tr style="border-bottom: 1px solid #E2E8F0;">
                    <td style="padding: 10px;">${idx + 1}</td>
                    <td style="padding: 10px;">
                        <input type="text" value="${safeName}" class="form-control" readonly title="若需修改姓名細節，請點擊右側 ✏️ 編輯按鈕" style="width: 100%; background: #F8FAFC; color: #334155; font-weight: bold; cursor: not-allowed;">
                    </td>
                    <td style="padding: 10px;">
                        <input type="email" id="std-email-${s.id}" value="${s.email}" class="form-control" readonly title="⚠️ 登入信箱為系統核心驗證依據，無法從前端修改。如需異動請洽系統管理員。" style="width: 100%; background: #F1F5F9; color: #94A3B8; cursor: not-allowed;">
                    </td>
                    <td style="padding: 10px;">
                        <input type="text" value="${s.password}" class="form-control" readonly title="系統預設密碼" style="width: 100%; background: #F1F5F9; color: #94A3B8; cursor: not-allowed;">
                    </td>
                    <td style="padding: 10px;">
                        <input type="url" id="std-drive-${s.id}" value="${s.drive_url}" class="form-control" placeholder="https://drive.google.com/..." style="width: 100%;">
                    </td>
                    <td style="padding: 10px; min-width: 130px; white-space: nowrap;">
                        <button class="btn" style="padding: 6px 10px; font-size: 0.8rem; background: #64748B; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="window.FeatureClassStudents.openEditModal('${s.id}', '${classId}')" title="編輯詳細姓名資料">✏️</button>
                        <button class="btn btn-primary" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.FeatureClassStudents.saveStudent('${s.id}', '${classId}')" title="儲存 Drive 連結">💾</button>
                        <button class="btn btn-danger" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.FeatureClassStudents.deleteStudent('${s.id}', '${classId}')" title="移除學生">🗑️</button>
                    </td>
                </tr>
                `;
            }).join('');

            // 🌟 組合最終畫面：上方顯示教職員，下方顯示學生
            container.innerHTML = `
                <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #E2E8F0; margin-top: 0; margin-bottom: 20px;">
                    <h3 style="margin-top: 0; margin-bottom: 15px; color: var(--primary-dark); display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 8px;">🧑‍🏫 班級教職員團隊</div>
                    </h3>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; background: white; font-size: 0.95rem;">
                            <thead>
                                <tr style="background: #F1F5F9; text-align: left; color: #334155;">
                                    <th style="padding: 10px; border-radius: 8px 0 0 8px; width: 50px;">#</th>
                                    <th style="padding: 10px; width: 150px;">團隊身分</th>
                                    <th style="padding: 10px;">顯示姓名</th>
                                    <th style="padding: 10px;">聯絡信箱 (帳號)</th>
                                    <th style="padding: 10px; border-radius: 0 8px 8px 0; text-align: center; width: 80px;">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${staffTbody || '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#94A3B8;">目前無其他教職員，請透過下方的「新增班級成員」加入。</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style="background: white; padding: 20px; border-radius: 12px; border: 2px solid #E2E8F0; margin-top: 0;">
                    <h3 style="margin-top: 0; margin-bottom: 15px; color: var(--primary-dark); display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 8px;">👥 課程學生與帳號管理</div>
                        <span style="font-size: 0.85rem; color: #64748B; background: #F1F5F9; padding: 4px 10px; border-radius: 20px;">
                            當前顯示：${effectiveMode === 'cn_first' ? '🇹🇼 模式 2 (中文全名)' : '🇺🇸 模式 1 (英文名+護照姓)'}
                        </span>
                    </h3>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; background: white; font-size: 0.95rem;">
                            <thead>
                                <tr style="background: #F1F5F9; text-align: left; color: #334155;">
                                    <th style="padding: 10px; border-radius: 8px 0 0 8px;">#</th>
                                    <th style="padding: 10px;">智慧顯示姓名</th>
                                    <th style="padding: 10px;">Email (唯讀)</th>
                                    <th style="padding: 10px;">密碼 (預設)</th>
                                    <th style="padding: 10px;">個人專屬 Drive 連結</th>
                                    <th style="padding: 10px; border-radius: 0 8px 8px 0;">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${studentTbody || '<tr><td colspan="6" style="text-align:center; padding: 30px; color:#94A3B8; font-weight: 800;">目前名單為空，請透過下方的「新增班級成員」按鈕加入學生。</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            console.error("渲染名單失敗:", err);
            container.innerHTML = `<div style="color:red; padding:20px;">❌ 載入失敗：${err.message}</div>`;
        }
    }

    return {
        renderStudentManager,
        
        // 🔒 修復：移除前端自作主張修改 Email 的邏輯，僅保留 Drive 連結的更新
        saveStudent: async (studentId, classId) => {
            const drive = document.getElementById(`std-drive-${studentId}`).value.trim();
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳';
            btn.disabled = true;

            try {
                // 1. 更新 Profiles 裡的 raw_data (加入 Drive URL)
                const { data: oldProf } = await window.supabaseClient.from('profiles').select('raw_data').eq('id', studentId).maybeSingle();
                const mergedRawData = { ...(oldProf?.raw_data || {}), drive_url: drive };

                const { error: profileError } = await window.supabaseClient
                    .from('profiles')
                    .update({ raw_data: mergedRawData })
                    .eq('id', studentId);

                if (profileError) throw profileError;

                // 2. 更新 Enrollment 表格
                const { error: enrollError } = await window.supabaseClient
                    .from('student_enrollments')
                    .update({ drive_link: drive })
                    .eq('class_id', classId)
                    .eq('user_id', studentId);
                    
                if (enrollError) throw enrollError;

                btn.innerHTML = '✅';
            } catch (err) {
                alert('❌ 更新失敗: ' + err.message);
                btn.innerHTML = originalText;
            } finally {
                setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 1000);
            }
        },
        
        deleteStudent: async (id, classId) => {
            if (!confirm('⚠️ 確定要把該名學生從本班級移除嗎？\n(注意：這只是將學生退出本班，系統主檔仍會保留)')) return;
            
            const { error } = await window.supabaseClient
                .from('student_enrollments')
                .update({ deleted_at: new Date().toISOString() })
                .eq('class_id', classId)
                .eq('user_id', id);

            if (error) return alert('❌ 退出班級失敗: ' + error.message);
            await renderStudentManager(classId);
        },

        // 🧑‍🏫 新增：移除教職員 (Soft Delete from class_staff)
        removeStaff: async (userId, classId) => {
            if (!confirm('⚠️ 確定要把該名教職員從本班級團隊移除嗎？\n(注意：對方的帳號仍會保留在系統中)')) return;
            
            const { error } = await window.supabaseClient
                .from('class_staff')
                .update({ deleted_at: new Date().toISOString() })
                .eq('class_id', classId)
                .eq('user_id', userId);

            if (error) return alert('❌ 移除教職員失敗: ' + error.message);
            await renderStudentManager(classId);
        },

        openEditModal: async (studentId, classId) => {
            const overlay = document.createElement('div');
            overlay.id = 'edit-student-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999;';
            
            overlay.innerHTML = '<div style="background: white; padding: 20px; border-radius: 8px; font-weight: bold;">⏳ 載入資料中...</div>';
            document.body.appendChild(overlay);

            try {
                const { data: profile, error } = await window.supabaseClient.from('profiles').select('*').eq('id', studentId).maybeSingle();
                if (error) throw error;
                if (!profile) throw new Error("找不到該學生資料。");

                const raw = profile.raw_data || {};

                overlay.innerHTML = `
                    <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                        <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 20px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">✏️ 編輯詳細姓名資料</h3>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">英文名字 (First Name)</label>
                                <input type="text" id="modal-nameEN" class="form-control" value="${raw.nameEN || ''}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">護照姓氏 (Last Name)</label>
                                <input type="text" id="modal-passLast" class="form-control" value="${raw.passportLast || ''}" style="width:100%;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">護照名字 (First Name)</label>
                                <input type="text" id="modal-passFirst" class="form-control" value="${raw.passportFirst || ''}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">中文姓氏</label>
                                <input type="text" id="modal-lastCN" class="form-control" value="${raw.lastNameCN || ''}" style="width:100%;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">中文名字</label>
                                <input type="text" id="modal-firstCN" class="form-control" value="${raw.firstNameCN || ''}" style="width:100%;">
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                            <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;" onclick="document.getElementById('edit-student-modal').remove()">取消</button>
                            <button id="modal-save-btn" class="btn btn-primary" style="padding: 8px 20px;" onclick="window.FeatureClassStudents.submitEditModal('${studentId}', '${classId}')">💾 儲存變更</button>
                        </div>
                    </div>
                `;
            } catch (err) {
                alert("❌ 無法載入資料: " + err.message);
                overlay.remove();
            }
        },

        submitEditModal: async (studentId, classId) => {
            const btn = document.getElementById('modal-save-btn');
            btn.innerHTML = '⏳ 儲存中...';
            btn.disabled = true;

            const nameEN = document.getElementById('modal-nameEN').value.trim();
            const passLast = document.getElementById('modal-passLast').value.trim();
            const passFirst = document.getElementById('modal-passFirst').value.trim();
            const lastCN = document.getElementById('modal-lastCN').value.trim();
            const firstCN = document.getElementById('modal-firstCN').value.trim();

            const fallbackName = nameEN || lastCN || passFirst || '未命名';

            try {
                const { data: profile } = await window.supabaseClient.from('profiles').select('raw_data').eq('id', studentId).maybeSingle();
                const raw = profile?.raw_data || {};

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
                    .update({ name: fallbackName, raw_data: mergedRawData })
                    .eq('id', studentId);

                if (error) throw error;

                document.getElementById('edit-student-modal').remove();
                await renderStudentManager(classId);

            } catch (err) {
                alert("❌ 儲存失敗: " + err.message);
                btn.innerHTML = '💾 儲存變更';
                btn.disabled = false;
            }
        }
    };
})();
/**
 * 📂 檔案路徑：110_teacher_core/feature-class-members.js
 * 🌟 v6.5 SaaS 擴充版：優先解析 student_enrollments JSONB 以讀取專屬資料夾 ID
 */

window.FeatureClassMembers = (() => {
    const db = window.TeacherDB;
    
    if (db && !db.students) { 
        db.students = []; 
    }

    let currentActiveTab = 'student';

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

    async function fetchStaffForClass(classId, effectiveMode) {
        try {
            const { data: rawStaff, error } = await window.supabaseClient
                .from('class_staff')
                .select('user_id, staff_role, profiles(*)')
                .eq('class_id', classId)
                .is('deleted_at', null);

            if (error) throw error;
            
            return (rawStaff || []).map(s => {
                const p = Array.isArray(s.profiles) ? s.profiles[0] : (s.profiles || {});
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

    // 🌟 擴充：讀取 student_enrollments.raw_data 以取得 drive_folder_id
    async function fetchStudentsForClass(classId, effectiveMode) {
        try {
            const { data: rawStudents, error } = await window.supabaseClient
                .from('student_enrollments')
                .select('user_id, drive_link, raw_data, profiles(*)') 
                .eq('class_id', classId)
                .is('deleted_at', null);

            if (error) throw error;
            
            return (rawStudents || []).map(s => {
                const p = Array.isArray(s.profiles) ? s.profiles[0] : (s.profiles || {});
                let enrollRaw = s.raw_data || {};
                if (typeof enrollRaw === 'string') { try { enrollRaw = JSON.parse(enrollRaw); } catch(e){} }
                
                return {
                    id: s.user_id,
                    class_id: classId,
                    displayName: calculateDisplayName(p, effectiveMode),
                    email: p.email || '未設定',
                    password: p.password || '系統預設',
                    // 🌟 優先採用 JSONB 內的 drive_folder_id 
                    drive_url: enrollRaw.drive_folder_id || s.drive_link || (p.raw_data ? p.raw_data.drive_url : '') || ''
                };
            });
        } catch (error) {
            console.error("抓取學生名單失敗:", error);
            return [];
        }
    }

    async function fetchParentsForClass(classStudents, effectiveMode) {
        if (!classStudents || classStudents.length === 0) return [];
        try {
            const studentIds = classStudents.map(s => s.id);
            
            const { data: mappings, error: mapErr } = await window.supabaseClient
                .from('parent_child_mappings')
                .select('*')
                .in('child_user_id', studentIds);
                
            if (mapErr || !mappings || mappings.length === 0) return [];
            
            const parentIds = [...new Set(mappings.map(m => m.parent_user_id))];
            
            const { data: parentProfiles } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .in('id', parentIds);
                
            const parentMap = {};
            if (parentProfiles) {
                parentProfiles.forEach(p => parentMap[p.id] = p);
            }
            
            return mappings.map(m => {
                const p = parentMap[m.parent_user_id] || {};
                return {
                    parent_id: m.parent_user_id,
                    child_id: m.child_user_id,
                    parentName: calculateDisplayName(p, effectiveMode),
                    parentEmail: p.email || '未知信箱'
                };
            });
        } catch (error) {
            console.error("抓取家長名單失敗:", error);
            return [];
        }
    }

    function switchTab(tabName) {
        currentActiveTab = tabName;
        
        document.querySelectorAll('.member-sub-tab').forEach(el => {
            el.style.borderBottomColor = 'transparent';
            el.style.color = '#64748B';
            el.style.backgroundColor = 'transparent';
        });
        document.querySelectorAll('.member-tab-content').forEach(el => el.style.display = 'none');
        
        const btn = document.getElementById(`sub-tab-btn-${tabName}`);
        const content = document.getElementById(`sub-tab-content-${tabName}`);
        
        if (btn) {
            btn.style.borderBottomColor = '#3B82F6';
            btn.style.color = '#1E40AF';
            btn.style.backgroundColor = '#EFF6FF';
        }
        if (content) content.style.display = 'block';
        
        if (window.currentMemberManager && typeof window.currentMemberManager.syncWithTab === 'function') {
            window.currentMemberManager.syncWithTab(tabName);
        }
    }

    window.FeatureClassMembers_SwitchTab = switchTab;

    async function renderStudentManager(classId) {
        const container = document.getElementById('student-manager-container');
        if (!container) return;

        container.innerHTML = '<div style="padding: 20px; color: #64748B; font-weight:800;">⏳ 正在透過智慧引擎分析與載入名單...</div>';

        try {
            let effectiveMode = 'en_first'; 
            let currentUserRole = 'ta_junior';
            
            const { data: classData } = await window.supabaseClient.from('classes').select('raw_data').eq('id', classId).maybeSingle();
            const classMode = classData?.raw_data?.name_display_mode || 'default';
            if (classMode !== 'default') effectiveMode = classMode;

            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (user) {
                const { data: profData } = await window.supabaseClient.from('profiles').select('raw_data, default_role').eq('id', user.id).maybeSingle();
                const profMode = profData?.raw_data?.preferred_name_mode || 'default';
                if (profMode !== 'default') effectiveMode = profMode;

                if (profData?.default_role === 'admin') {
                    currentUserRole = 'admin';
                } else {
                    const { data: staffData } = await window.supabaseClient.from('class_staff').select('staff_role').eq('class_id', classId).eq('user_id', user.id).is('deleted_at', null).maybeSingle();
                    if (staffData) currentUserRole = staffData.staff_role;
                }
            }

            const [classStaff, classStudents] = await Promise.all([
                fetchStaffForClass(classId, effectiveMode),
                fetchStudentsForClass(classId, effectiveMode)
            ]);

            const classParents = await fetchParentsForClass(classStudents, effectiveMode);
            db.students = db.students.filter(s => s.class_id !== classId).concat(classStudents);

            const canManageStaff = currentUserRole === 'admin' || currentUserRole === 'primary_teacher';

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
                        <button class="btn" style="padding: 6px 10px; font-size: 0.8rem; background: #64748B; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="window.FeatureClassMembers.openEditModal('${s.id}', '${classId}')" title="編輯詳細姓名資料">✏️</button>
                        <button class="btn btn-primary" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.FeatureClassMembers.saveStudent('${s.id}', '${classId}')" title="儲存 Drive 連結">💾</button>
                        <button class="btn btn-danger" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.FeatureClassMembers.deleteStudent('${s.id}', '${classId}')" title="移除學生">🗑️</button>
                    </td>
                </tr>
                `;
            }).join('');

            let staffTbody = classStaff.map((s, idx) => {
                const safeName = s.displayName.replace(/"/g, '&quot;');
                let actionBtn = `<span style="color:#94A3B8; font-size:0.85em;">權限不足</span>`;
                
                if (canManageStaff) {
                    actionBtn = s.rawRole === 'primary_teacher' 
                        ? '<span style="color:#94A3B8; font-size:0.85em; font-weight:bold;">🔒 主老師不可移除</span>'
                        : `<button class="btn btn-danger" style="padding: 6px 10px; font-size: 0.8rem;" onclick="window.FeatureClassMembers.removeStaff('${s.id}', '${classId}')" title="移除此教職員">🗑️</button>`;
                }

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

            let parentTbody = classStudents.map((student, idx) => {
                const safeStudentName = student.displayName.replace(/"/g, '&quot;');
                const boundParents = classParents.filter(p => p.child_id === student.id);
                
                let parentDisplay = `<span style="color:#94A3B8; font-style:italic;">尚未綁定任何家長</span>`;
                if (boundParents.length > 0) {
                    parentDisplay = boundParents.map(p => {
                        return `<div style="background:#F1F5F9; border:1px solid #CBD5E1; padding:4px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:8px; margin-right:5px; margin-bottom:5px;">
                                    <span style="font-weight:bold; color:#0F172A;">${p.parentName.replace(/"/g, '&quot;')}</span>
                                    <span style="font-size:0.85em; color:#64748B;">(${p.parentEmail})</span>
                                    <button class="btn btn-danger" style="padding: 2px 6px; font-size: 0.7rem; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center;" onclick="window.FeatureClassMembers.removeParentMapping('${p.parent_id}', '${student.id}', '${classId}')" title="解除綁定">✖</button>
                                </div>`;
                    }).join('');
                }

                return `
                <tr style="border-bottom: 1px dashed #E2E8F0;">
                    <td style="padding: 12px 10px; color: #64748B;">${idx + 1}</td>
                    <td style="padding: 12px 10px; font-weight: bold; color: #1E293B; border-right: 2px solid #F1F5F9;">🎓 ${safeStudentName}</td>
                    <td style="padding: 12px 10px;">${parentDisplay}</td>
                    <td style="padding: 12px 10px; text-align: center;">
                        <button class="btn" style="background:#EFF6FF; color:#1E40AF; border:1px solid #BFDBFE; padding:6px 12px; border-radius:6px; font-size: 0.85rem; font-weight: bold; cursor:pointer;" onclick="if(window.currentMemberManager) window.currentMemberManager.openAndSync('parent', '${student.id}')">+ 新增綁定</button>
                    </td>
                </tr>
                `;
            }).join('');


            container.innerHTML = `
                <div style="background: white; border-radius: 12px; border: 2px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    
                    <div style="display: flex; background: #F8FAFC; border-bottom: 1px solid #CBD5E1; padding: 0 10px; overflow-x: auto; white-space: nowrap;">
                        <button id="sub-tab-btn-student" class="member-sub-tab active" style="padding: 12px 20px; background: #EFF6FF; border: none; border-bottom: 3px solid #3B82F6; color: #1E40AF; font-weight: 800; font-size: 1rem; cursor: pointer; transition: all 0.2s; border-radius: 8px 8px 0 0;" onclick="window.FeatureClassMembers_SwitchTab('student')">
                            🎓 學生名單 (${classStudents.length})
                        </button>
                        <button id="sub-tab-btn-staff" class="member-sub-tab" style="padding: 12px 20px; background: transparent; border: none; border-bottom: 3px solid transparent; color: #64748B; font-weight: 800; font-size: 1rem; cursor: pointer; transition: all 0.2s; border-radius: 8px 8px 0 0;" onclick="window.FeatureClassMembers_SwitchTab('staff')">
                            🧑‍🏫 教職團隊 (${classStaff.length})
                        </button>
                        <button id="sub-tab-btn-parent" class="member-sub-tab" style="padding: 12px 20px; background: transparent; border: none; border-bottom: 3px solid transparent; color: #64748B; font-weight: 800; font-size: 1rem; cursor: pointer; transition: all 0.2s; border-radius: 8px 8px 0 0;" onclick="window.FeatureClassMembers_SwitchTab('parent')">
                            👨‍👩‍👧 家長觀測綁定 (${classParents.length})
                        </button>
                    </div>

                    <div style="padding: 20px;">
                        
                        <div id="sub-tab-content-student" class="member-tab-content" style="display: block; animation: fadeIn 0.3s;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <h3 style="margin: 0; color: #1E293B;">👥 課程學生與帳號管理</h3>
                                <span style="font-size: 0.85rem; color: #64748B; background: #F1F5F9; padding: 4px 10px; border-radius: 20px;">
                                    當前顯示：${effectiveMode === 'cn_first' ? '🇹🇼 模式 2 (中文全名)' : '🇺🇸 模式 1 (英文名+護照姓)'}
                                </span>
                            </div>
                            <div style="overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse; background: white; font-size: 0.95rem;">
                                    <thead>
                                        <tr style="background: #F1F5F9; text-align: left; color: #334155;">
                                            <th style="padding: 10px; border-radius: 8px 0 0 8px;">#</th>
                                            <th style="padding: 10px;">智慧顯示姓名</th>
                                            <th style="padding: 10px;">Email (唯讀防脫鉤)</th>
                                            <th style="padding: 10px;">密碼 (預設)</th>
                                            <th style="padding: 10px;">個人專屬 Drive 連結</th>
                                            <th style="padding: 10px; border-radius: 0 8px 8px 0;">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${studentTbody || '<tr><td colspan="6" style="text-align:center; padding: 40px; color:#94A3B8; font-weight: 800; font-size: 1.1rem;">目前名單為空，請透過下方的「新增班級成員」加入學生。</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div id="sub-tab-content-staff" class="member-tab-content" style="display: none; animation: fadeIn 0.3s;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <h3 style="margin-top: 0; margin-bottom: 0; color: #1E293B;">🧑‍🏫 班級內部教職員團隊</h3>
                                <button class="btn" style="background:#F1F5F9; color:#475569; border:1px dashed #CBD5E1; padding:6px 15px; border-radius:6px; cursor:pointer;" onclick="if(window.currentMemberManager) window.currentMemberManager.openAndSync('staff');">+ 指派新教職員</button>
                            </div>
                            <div style="overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse; background: white; font-size: 0.95rem;">
                                    <thead>
                                        <tr style="background: #F8FAFC; text-align: left; color: #334155; border-bottom: 2px solid #E2E8F0;">
                                            <th style="padding: 12px; width: 40px;">#</th>
                                            <th style="padding: 12px; width: 150px;">團隊身分</th>
                                            <th style="padding: 12px;">顯示姓名</th>
                                            <th style="padding: 12px;">聯絡信箱 (帳號)</th>
                                            <th style="padding: 12px; text-align: center; width: 80px;">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${staffTbody || '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#94A3B8;">目前無其他教職員，請透過下方的「新增班級成員」加入。</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div id="sub-tab-content-parent" class="member-tab-content" style="display: none; animation: fadeIn 0.3s;">
                            <div style="background: #FFFBEB; border: 1px dashed #FDE68A; padding: 12px; border-radius: 8px; margin-bottom: 15px; color: #92400E; font-size: 0.9rem;">
                                💡 <b>家長觀測端說明：</b> 您必須先建立學生，然後在此處將家長的信箱「綁定」給對應的學生。一個家長可以綁定多位學生。
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                <h3 style="margin-top: 0; margin-bottom: 0; color: #1E293B;">👨‍👩‍👧 學生家長對照矩陣</h3>
                                <button class="btn" style="background:#FFFBEB; color:#92400E; border:1px dashed #FDE68A; padding:6px 15px; border-radius:6px; cursor:pointer;" onclick="if(window.currentMemberManager) window.currentMemberManager.openAndSync('parent');">+ 建立家長觀測綁定</button>
                            </div>
                            <div style="overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse; background: white; font-size: 0.95rem;">
                                    <thead>
                                        <tr style="background: #F8FAFC; text-align: left; color: #334155; border-bottom: 2px solid #E2E8F0;">
                                            <th style="padding: 12px; width: 40px;">#</th>
                                            <th style="padding: 12px; width: 25%;">🎓 本班學生</th>
                                            <th style="padding: 12px;">🔗 已授權的觀測家長名單</th>
                                            <th style="padding: 12px; text-align: center; width: 120px;">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${classStudents.length > 0 ? parentTbody : '<tr><td colspan="4" style="text-align:center; padding: 40px; color:#94A3B8; font-weight: 800; font-size: 1.1rem;">班級內尚無學生，請先加入學生。</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </div>
            `;
            
            switchTab(currentActiveTab);

        } catch (err) {
            console.error("渲染名單失敗:", err);
            container.innerHTML = `<div style="color:red; padding:20px;">❌ 載入失敗：${err.message}</div>`;
        }
    }

    return {
        renderStudentManager,
        switchTab,
        
        // 🌟 擴充：儲存 Drive URL 時同步寫回 raw_data.drive_folder_id 保持資料雙軌一致
        saveStudent: async (studentId, classId) => {
            const drive = document.getElementById(`std-drive-${studentId}`).value.trim();
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳';
            btn.disabled = true;

            try {
                // 1. 同步寫入 profiles
                const { data: oldProf } = await window.supabaseClient.from('profiles').select('raw_data').eq('id', studentId).maybeSingle();
                const mergedRawData = { ...(oldProf?.raw_data || {}), drive_url: drive };

                const { error: profileError } = await window.supabaseClient
                    .from('profiles')
                    .update({ raw_data: mergedRawData })
                    .eq('id', studentId);

                if (profileError) throw profileError;

                // 2. 寫入 student_enrollments 並封裝進 JSONB
                const { data: enrollData } = await window.supabaseClient.from('student_enrollments').select('raw_data').eq('class_id', classId).eq('user_id', studentId).maybeSingle();
                let oldEnrollRaw = enrollData?.raw_data || {};
                if (typeof oldEnrollRaw === 'string') { try { oldEnrollRaw = JSON.parse(oldEnrollRaw); } catch(e){} }
                const mergedEnrollRaw = { ...oldEnrollRaw, drive_folder_id: drive };

                const { error: enrollError } = await window.supabaseClient
                    .from('student_enrollments')
                    .update({ drive_link: drive, raw_data: mergedEnrollRaw })
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
            if (!confirm('⚠️ 確定要把該名學生從本班級移除嗎？\n\n(注意：這只是將學生退出本班，系統主檔仍會保留。如果該學生有綁定家長，家長將自動無法觀測本班進度)')) return;
            
            const { error } = await window.supabaseClient
                .from('student_enrollments')
                .update({ deleted_at: new Date().toISOString() })
                .eq('class_id', classId)
                .eq('user_id', id);

            if (error) return alert('❌ 退出班級失敗: ' + error.message);
            await renderStudentManager(classId);
        },

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

        removeParentMapping: async (parentId, childId, classId) => {
            if (!confirm('⚠️ 確定要解除該名家長對此學生的觀測權限嗎？\n(家長端將立即失去觀測此學生的資格)')) return;
            
            const { error } = await window.supabaseClient
                .from('parent_child_mappings')
                .delete()
                .eq('parent_user_id', parentId)
                .eq('child_user_id', childId);

            if (error) return alert('❌ 解除綁定失敗: ' + error.message);
            await renderStudentManager(classId);
        },

        openEditModal: async (studentId, classId) => {
            const overlay = document.createElement('div');
            overlay.id = 'edit-student-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            
            overlay.innerHTML = '<div style="background: white; padding: 20px; border-radius: 8px; font-weight: bold;">⏳ 載入資料中...</div>';
            document.body.appendChild(overlay);

            try {
                const { data: profile, error } = await window.supabaseClient.from('profiles').select('*').eq('id', studentId).maybeSingle();
                if (error) throw error;
                if (!profile) throw new Error("找不到該學生資料。");

                const raw = profile.raw_data || {};
                let parsedRaw = raw;
                if (typeof raw === 'string') {
                    try { parsedRaw = JSON.parse(raw); } catch(e){}
                }

                overlay.innerHTML = `
                    <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                        <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 20px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">✏️ 編輯詳細姓名資料</h3>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">英文名字 (First Name)</label>
                                <input type="text" id="modal-nameEN" class="form-control" value="${parsedRaw.nameEN || ''}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">護照姓氏 (Last Name)</label>
                                <input type="text" id="modal-passLast" class="form-control" value="${parsedRaw.passportLast || ''}" style="width:100%;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">護照名字 (First Name)</label>
                                <input type="text" id="modal-passFirst" class="form-control" value="${parsedRaw.passportFirst || ''}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">中文姓氏</label>
                                <input type="text" id="modal-lastCN" class="form-control" value="${parsedRaw.lastNameCN || ''}" style="width:100%;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
                            <div class="form-group" style="margin-top: 0;">
                                <label style="display:block; font-weight:bold; margin-bottom:5px; font-size: 0.9rem;">中文名字</label>
                                <input type="text" id="modal-firstCN" class="form-control" value="${parsedRaw.firstNameCN || ''}" style="width:100%;">
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                            <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;" onclick="document.getElementById('edit-student-modal').remove()">取消</button>
                            <button id="modal-save-btn" class="btn btn-primary" style="padding: 8px 20px;" onclick="window.FeatureClassMembers.submitEditModal('${studentId}', '${classId}')">💾 儲存變更</button>
                        </div>
                    </div>
                `;
            } catch (err) {
                alert("❌ 無法載入資料: " + err.message);
                if (document.getElementById('edit-student-modal')) document.getElementById('edit-student-modal').remove();
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

            const fullCN = `${lastCN}${firstCN}`;
            let fallbackName = "未命名";
            
            if (nameEN && passLast) fallbackName = `${nameEN} ${passLast}`;
            else if (nameEN) fallbackName = nameEN;
            else if (fullCN) fallbackName = fullCN;

            try {
                const { data: profile } = await window.supabaseClient.from('profiles').select('raw_data').eq('id', studentId).maybeSingle();
                
                let raw = profile?.raw_data || {};
                if (typeof raw === 'string') {
                    try { raw = JSON.parse(raw); } catch(e){}
                }

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
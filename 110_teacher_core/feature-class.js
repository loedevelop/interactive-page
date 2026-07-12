/**
 * 📂 檔案路徑：110_teacher_core/feature-class.js (Part 1)
 * 🌟 v6.2 SaaS 彈性日期版：實作「僅套用至未來」與「歷史軌跡凍結」防呆機制
 */
console.log("💡💡💡 FeatureClass v6.2 SaaS 彈性日期版載入！(支援保留過去軌跡)");

window.FeatureClass = (() => {
    const db = window.TeacherDB;

    // --- 私有工具函式 ---
    function toLocalISODate(dateObj) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function generateDates(startStr, endStr, meetDaysArray) {
        if (!startStr || !endStr || !meetDaysArray || meetDaysArray.length === 0) return [];
        const dates = [];
        const [sy, sm, sd] = startStr.split('-');
        const [ey, em, ed] = endStr.split('-');
        let curr = new Date(sy, sm - 1, sd);
        const end = new Date(ey, em - 1, ed);
        end.setHours(23,59,59,999);
        
        while (curr <= end) {
            if (meetDaysArray.includes(curr.getDay())) {
                dates.push(toLocalISODate(curr));
            }
            curr.setDate(curr.getDate() + 1);
        }
        return dates;
    }

    // --- 核心班級邏輯 ---
    async function updateClassContent(classId) {
        if (!classId) return;

        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;
        
        const titleEl = document.getElementById('current-class-title');
        if (titleEl) titleEl.textContent = `${cls.name}`; 

        if (document.getElementById('class-start-date')) document.getElementById('class-start-date').value = cls.startDate || cls.start_date || "";
        if (document.getElementById('class-end-date')) document.getElementById('class-end-date').value = cls.endDate || cls.end_date || "";
        
        const mDays = cls.meetDays || cls.meet_days || [];
        document.querySelectorAll('#class-meet-days input').forEach(cb => {
            cb.checked = mDays.includes(parseInt(cb.value));
        });

        const savedMode = cls.calcMode || cls.calc_mode || 'single';
        document.querySelectorAll('input[name="calc_mode"]').forEach(radio => {
            radio.checked = (radio.value === savedMode);
        });

        let raw = cls.raw_data || cls.rawData || {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
        }
        
        const weekStart = raw.week_start_day || 'sunday';
        const weekRadios = document.getElementsByName('week_start_day');
        for (let i = 0; i < weekRadios.length; i++) {
            weekRadios[i].checked = (weekRadios[i].value === weekStart);
        }
    }

    // --- 🌟 渲染班級清單 ---
    function renderClassManager() {
        const container = document.getElementById('manage-class-list-container');
        if (!container) return;
        container.innerHTML = '';
        
        if (!db.classes || db.classes.length === 0) { 
            container.innerHTML = '<p style="color:#94A3B8; font-weight: bold; padding: 20px;">目前無任何班級。</p>'; 
            return; 
        }

        db.classes.forEach(cls => {
            const canManage = cls.staff_role === 'admin' || cls.staff_role === 'primary_teacher';
            
            let actionButtonsHTML = '';
            if (canManage) {
                actionButtonsHTML = `
                    <div style="display: flex; gap: 8px;">
                        <button class="btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; padding:6px 12px; border-radius:6px; font-size: 0.9rem; font-weight: bold; cursor:pointer;" onclick="window.FeatureClass.openClassSettings('${cls.id}')" title="班級設定">⚙️ 設定</button>
                        <button class="btn-danger" style="background:#FEF2F2; color:#EF4444; border:1px solid #FECACA; padding:6px 12px; border-radius:6px; font-size: 0.9rem; font-weight: bold; cursor:pointer;" onclick="window.FeatureClass.toggleDeleteConfirm('${cls.id}', true)">📦 封存</button>
                    </div>
                `;
            } else {
                actionButtonsHTML = `<span style="font-size: 0.85rem; color: #94A3B8; font-weight: bold; padding:6px 12px;">(僅主老師可設定)</span>`;
            }

            const item = document.createElement('div');
            item.className = 'manage-list-item';
            
            item.innerHTML = `
                <div id="class-info-${cls.id}" style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 0;">
                    <div style="display: flex; align-items: center; flex: 1;">
                        <span style="font-size:1.4rem; margin-right:12px;">${cls.icon || '📘'}</span>
                        <strong style="font-size:1.15rem; color:#1E293B;">${cls.name}</strong>
                        <span style="margin-left:10px; font-size:0.8rem; background:#E2E8F0; padding:2px 8px; border-radius:12px; color:#475569;">${cls.staff_role || '未知'}</span>
                    </div>
                    ${actionButtonsHTML}
                </div>

                <div id="class-delete-confirm-${cls.id}" style="display: none; width: 100%; background: #FEF2F2; border: 1px solid #FCA5A5; padding: 15px; border-radius: 8px; margin-top: 10px; animation: popIn 0.3s ease-out;">
                    <div style="font-weight: 800; color: #DC2626; margin-bottom: 8px;">⚠️ 確定封存此班級？(相關作業與選課紀錄將由資料庫底層 RPC 安全封存)</div>
                    <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem; cursor:pointer; margin-bottom:15px;">
                        <input type="checkbox" id="del-students-cb-${cls.id}" style="transform:scale(1.2); accent-color: #EF4444;">
                        <span style="color:#7F1D1D; font-weight: bold;">進階：連同此班級的專屬學生帳號一併「軟刪除」停權</span>
                    </label>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-danger" style="background:#EF4444; color:white; padding:8px 16px; border:none; border-radius:6px; font-weight:bold; cursor:pointer;" onclick="window.FeatureClass.executeDelete('${cls.id}')">✔️ 確認封存</button>
                        <button class="btn" style="background:white; color:#64748B; padding:8px 16px; border:1px solid #CBD5E1; border-radius:6px; font-weight:bold; cursor:pointer;" onclick="window.FeatureClass.toggleDeleteConfirm('${cls.id}', false)">❌ 取消</button>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    }

    function ensureNewClassFormHasModeSelector() {
        const btnAddClass = document.getElementById('btn-add-class');
        if (!btnAddClass) return;

        if (document.getElementById('new-class-display-mode')) return;

        const modeSelectorHTML = `
            <div style="margin-top: 15px; margin-bottom: 20px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px dashed #CBD5E1; width: 100%; box-sizing: border-box;">
                <label style="display:block; font-weight:bold; color:#475569; margin-bottom:8px;">👥 班級預設名字顯示模式</label>
                <select id="new-class-display-mode" class="form-control" style="width: 100%; box-sizing: border-box;">
                    <option value="default">⚙️ 不覆寫 (跟隨系統全域預設)</option>
                    <option value="en_first">🇺🇸 模式 1：英文名字 + 護照姓氏 (全美語班推薦)</option>
                    <option value="cn_first">🇹🇼 模式 2：中文全名 + (英文名字) (升學班推薦)</option>
                </select>
                <div style="font-size: 0.8rem; color: #94A3B8; margin-top: 8px;">建立後可隨時於「⚙️ 設定」中修改。</div>
            </div>
        `;
        
        btnAddClass.insertAdjacentHTML('beforebegin', modeSelectorHTML);
    }
    /**
 * 📂 檔案路徑：110_teacher_core/feature-class.js (Part 2)
 */
    async function openClassSettings(classId) {
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;

        const overlayId = 'class-settings-modal';
        const existing = document.getElementById(overlayId);
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
        
        overlay.innerHTML = '<div style="background:white; padding:20px; border-radius:8px; font-weight:bold;">⏳ 讀取班級資料中...</div>';
        document.body.appendChild(overlay);

        try {
            let dbRaw = cls.raw_data || cls.rawData || {};
            if (typeof dbRaw === 'string') {
                try { dbRaw = JSON.parse(dbRaw); } catch(e) { dbRaw = {}; }
            }
            const currentMode = dbRaw.name_display_mode || 'default';

            const mainIconSelect = document.getElementById('new-class-icon');
            let iconInputHTML = `<input type="text" id="edit-class-icon" class="form-control" value="${cls.icon || '📘'}" style="width: 100%; text-align: center;">`;
            if (mainIconSelect) {
                iconInputHTML = `<select id="edit-class-icon" class="form-control" style="width: 100%; text-align: center;">${mainIconSelect.innerHTML}</select>`;
            }

            overlay.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <h3 style="margin-top: 0; color: #1E293B; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 20px;">⚙️ 班級主檔設定</h3>
                    
                    <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                        <div style="width: 80px;">
                            <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">圖示</label>
                            ${iconInputHTML}
                        </div>
                        <div style="flex: 1;">
                            <label style="display:block; font-weight:bold; color:#475569; margin-bottom:5px;">班級名稱 <span style="color:#EF4444;">*</span></label>
                            <input type="text" id="edit-class-name" class="form-control" value="${cls.name}" style="width: 100%;">
                        </div>
                    </div>

                    <div style="background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0; margin-bottom: 25px;">
                        <label style="display:block; font-weight:bold; color:#3B82F6; margin-bottom:10px;">👥 班級名單顯示模式 (優先權：高)</label>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <label style="cursor: pointer; font-weight: bold; color: #475569; display: flex; align-items: center;">
                                <input type="radio" name="edit_class_mode" value="default" ${currentMode === 'default' ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;"> 
                                ⚙️ 不覆寫 (跟隨系統全域預設)
                            </label>
                            <label style="cursor: pointer; font-weight: bold; color: #475569; display: flex; align-items: center;">
                                <input type="radio" name="edit_class_mode" value="en_first" ${currentMode === 'en_first' ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;"> 
                                🇺🇸 模式 1：英文名字 + 護照姓氏
                            </label>
                            <label style="cursor: pointer; font-weight: bold; color: #475569; display: flex; align-items: center;">
                                <input type="radio" name="edit_class_mode" value="cn_first" ${currentMode === 'cn_first' ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;"> 
                                🇹🇼 模式 2：中文全名 + (英文名字)
                            </label>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                        <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;" onclick="document.getElementById('${overlayId}').remove()">取消</button>
                        <button id="btn-save-class-settings" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;" onclick="window.FeatureClass.saveClassSettings('${classId}')">💾 儲存變更</button>
                    </div>
                </div>
            `;

            if (mainIconSelect) {
                document.getElementById('edit-class-icon').value = cls.icon || '📘';
            }
        } catch (err) {
            alert("載入資料失敗：" + err.message);
            document.getElementById(overlayId).remove();
        }
    }

    async function saveClassSettings(classId) {
        const btn = document.getElementById('btn-save-class-settings');
        const newName = document.getElementById('edit-class-name').value.trim();
        const newIcon = document.getElementById('edit-class-icon').value.trim() || '📘';
        const newMode = document.querySelector('input[name="edit_class_mode"]:checked').value;

        if (!newName) return alert("⚠️ 班級名稱不能為空！");

        btn.innerHTML = '⏳ 儲存中...';
        btn.disabled = true;

        try {
            const cls = db.classes.find(c => c.id === classId);
            let dbRaw = cls.raw_data || cls.rawData || {};
            if (typeof dbRaw === 'string') {
                try { dbRaw = JSON.parse(dbRaw); } catch(e) { dbRaw = {}; }
            }
            
            const mergedRawData = Object.assign({}, dbRaw, { name_display_mode: newMode });

            const { data: updatedRows, error } = await window.supabaseClient
                .from('classes')
                .update({ name: newName, icon: newIcon, raw_data: mergedRawData })
                .eq('id', classId)
                .select();

            if (error) throw error;
            if (!updatedRows || updatedRows.length === 0) {
                throw new Error("設定並未真正寫入雲端 (請聯絡管理員檢查)");
            }

            document.getElementById('class-settings-modal').remove();
            
            if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') {
                db.classes = await window.ApiService.fetchClasses();
            } else {
                cls.name = newName;
                cls.icon = newIcon;
                cls.raw_data = mergedRawData;
                cls.rawData = mergedRawData;
            }

            if (typeof db.save === 'function') db.save();

            renderClassManager();
            
            if (window.TeacherUI) window.TeacherUI.renderSidebar();
            if (window.TeacherUI && window.TeacherUI.getCurrentClassId() === classId) {
                updateClassContent(classId); 
                
                if (window.FeatureClassMembers && typeof window.FeatureClassMembers.renderStudentManager === 'function') {
                    window.FeatureClassMembers.renderStudentManager(classId);
                }
            }

        } catch (err) {
            alert("❌ 儲存失敗：" + err.message);
            btn.innerHTML = '💾 儲存變更';
            btn.disabled = false;
        }
    }

    // --- 事件綁定 ---
    window.addEventListener('DOMContentLoaded', () => {
        ensureNewClassFormHasModeSelector();

        const btnAddClass = document.getElementById('btn-add-class');
        if (btnAddClass) {
            btnAddClass.onclick = async function(e) {
                if(e) e.preventDefault();
                const nameInput = document.getElementById('new-class-name');
                const iconInput = document.getElementById('new-class-icon');
                const modeSelector = document.getElementById('new-class-display-mode'); 
                
                if (!nameInput) return;
                const name = nameInput.value.trim();
                if (!name) return alert('⚠️ 請輸入班級名稱！');

                const btn = this;
                const originalText = btn.innerHTML;
                btn.innerHTML = '⏳ 雲端建立中...';
                btn.disabled = true;

                try {
                    const { data: { user }, error: authError } = await window.supabaseClient.auth.getUser();
                    if (authError || !user) throw new Error('無法取得授權狀態，請重新登入');

                    const iconValue = iconInput ? iconInput.value : "📘";
                    const initialMode = modeSelector ? modeSelector.value : "default";
                    
                    const initialRawData = { 
                        name_display_mode: initialMode,
                        week_start_day: 'sunday'
                    };

                    const payload = {
                        name: name,
                        icon: iconValue,
                        calc_mode: 'single',
                        meet_days: [],
                        raw_data: initialRawData
                    };

                    const { data: newClass, error: classError } = await window.supabaseClient
                        .from('classes')
                        .insert([payload])
                        .select()
                        .single();
                    
                    if (classError) throw classError;

                    const { error: staffError } = await window.supabaseClient
                        .from('class_staff')
                        .insert([{
                            class_id: newClass.id,
                            user_id: user.id,
                            staff_role: 'primary_teacher'
                        }]);

                    if (staffError) throw new Error('班級已建立，但賦予管理權限時失敗：' + staffError.message);

                    nameInput.value = '';
                    if (modeSelector) modeSelector.value = 'default';
                    
                    if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') {
                        db.classes = await window.ApiService.fetchClasses();
                    } else {
                        db.classes.push({
                            id: newClass.id,
                            name: newClass.name,
                            icon: newClass.icon,
                            startDate: "",
                            endDate: "",
                            meetDays: [],
                            calcMode: 'single',
                            staff_role: 'primary_teacher',
                            raw_data: initialRawData,
                            rawData: initialRawData
                        });
                    }

                    if (!db.sessions) db.sessions = {};
                    db.sessions[newClass.id] = [];
                    if (typeof db.save === 'function') db.save();
                    
                    if (window.TeacherUI) window.TeacherUI.renderSidebar();
                    renderClassManager();
                    alert(`✅ 成功建立班級：「${name}」！`);

                } catch (err) {
                    alert('❌ 新增失敗: ' + err.message);
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            };
        }
        /**
 * 📂 檔案路徑：110_teacher_core/feature-timeline.js (Part 4)
 */
    return {
        renderTimeline,
        scrollToCurrentWeek,
        openBuilder: (classId, date, containerId) => {
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法新增或修改作業。');
            bState = { editId: null, classId, target_date: date, containerId, title: '', description: '', due_date: '', is_published: false, allow_late: true, tasks: [] };
            renderBuilderUI();
            setTimeout(() => { 
                const titleEl = document.getElementById(`builder-title-${containerId}`);
                if (titleEl) {
                    titleEl.focus(); 
                    const cRect = document.querySelector('.view-section.active').getBoundingClientRect();
                    const nRect = titleEl.getBoundingClientRect();
                    document.querySelector('.view-section.active').scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 50);
        },
        editAssignment: (assignId) => {
            const a = (db.assignments || []).find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(a.class_id)) return alert('權限不足：您的身分無法修改此作業。');
            
            const cls = db.classes.find(c => c.id === a.class_id) || {};
            let raw = cls.raw_data || {};
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
            }

            let sessions = [];
            if (raw.custom_sessions && Array.isArray(raw.custom_sessions) && raw.custom_sessions.length > 0) {
                sessions = [...raw.custom_sessions];
            } else {
                sessions = db.sessions[a.class_id] || [];
            }
            
            const mode = cls.calcMode || 'single';
            const weekStartSetting = raw.week_start_day || 'sunday';

            let timelineNodes = [];
            if (mode === 'single') {
                timelineNodes = sessions.map(d => ({ dates: [d] }));
            } else if (mode === 'weekly') {
                const weeksMap = new Map();
                sessions.forEach(d => {
                    const weekStr = getWeekStartStr(d, weekStartSetting);
                    if (!weeksMap.has(weekStr)) weeksMap.set(weekStr, []);
                    weeksMap.get(weekStr).push(d);
                });
                weeksMap.forEach((chunk) => timelineNodes.push({ dates: chunk }));
            }

            const nodeIndex = timelineNodes.findIndex(node => node.dates.includes(a.target_date));
            const cId = `builder-container-${nodeIndex >= 0 ? nodeIndex : 0}`; 

            bState = JSON.parse(JSON.stringify(a));
            bState.editId = a.id;
            bState.classId = a.class_id;
            bState.containerId = cId;
            
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') {
                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
            }
            bState.allow_late = aRaw.allow_late !== false;
            
            renderTimeline(a.class_id, 'none');
            renderBuilderUI();
            
            setTimeout(() => {
                const editorEl = document.getElementById(`${cId}-editor`);
                const viewContainer = document.querySelector('.view-section.active');
                if (editorEl && viewContainer) {
                    const cRect = viewContainer.getBoundingClientRect();
                    const nRect = editorEl.getBoundingClientRect();
                    viewContainer.scrollBy({ top: nRect.top - cRect.top - 15, behavior: 'smooth' });
                }
            }, 300);
        },
        moveAssignment: (assignId, classId) => {
            const a = (db.assignments || []).find(x => x.id === assignId);
            if (!a) return;
            if (!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法搬移此作業。');

            const overlay = document.createElement('div');
            overlay.id = 'move-assign-modal';
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            
            const cleanTitle = a.title ? a.title.replace(/<[^>]*>?/gm, '') : '未命名作業';

            overlay.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <h3 style="margin-top: 0; color: #1E293B; margin-bottom: 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px;">📅 作業改期 / 搬移</h3>
                    <div style="margin-bottom:20px; font-size:1rem; color:#475569; line-height:1.5;">
                        準備將 <strong>「${cleanTitle}」</strong> 搬移至新日期：
                    </div>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom: 25px; background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
                        <label style="font-weight:800; color:#334155; white-space:nowrap;">選擇新日期：</label>
                        <input type="date" id="move-target-date" class="form-control" style="flex:1; padding: 8px; font-size: 1rem;" value="${a.target_date}">
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size:1rem;" onclick="document.getElementById('move-assign-modal').remove()">取消</button>
                        <button class="btn btn-primary" id="btn-confirm-move" style="padding: 8px 20px; font-size:1rem;" onclick="window.FeatureTimeline.submitMove('${a.id}', '${classId}', '${a.target_date}')">確認改期</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        },
        submitMove: async (assignId, classId, oldDate) => {
            const newDate = document.getElementById('move-target-date').value;
            if (!newDate) return alert('⚠️ 請選擇目標日期');
            if (newDate === oldDate) return document.getElementById('move-assign-modal').remove(); 
            
            const btn = document.getElementById('btn-confirm-move');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 處理中...';
            btn.disabled = true;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ target_date: newDate })
                    .eq('id', assignId)
                    .is('deleted_at', null)
                    .select();
                    
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                
                const idx = db.assignments.findIndex(a => a.id === assignId);
                if(idx > -1) db.assignments[idx].target_date = newDate;
                
                document.getElementById('move-assign-modal').remove();
                window.FeatureTimeline.renderTimeline(classId, 'target', `assign-block-${assignId}`);
            } catch (err) {
                alert('❌ 改期失敗: ' + err.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        },
        copyHistory: (historyId) => {
            if(!historyId) return;
            const a = (db.assignments || []).find(x => x.id === historyId);
            if (!a) return;
            syncState(); 
            bState.title = a.title; 
            bState.description = a.description;
            bState.due_date = a.due_date;
            bState.is_published = a.is_published;
            
            let aRaw = a.raw_data || {};
            if (typeof aRaw === 'string') {
                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
            }
            bState.allow_late = aRaw.allow_late !== false;

            bState.tasks = JSON.parse(JSON.stringify(a.tasks)).map(t => { 
                t.id = `task_${Date.now()}_${Math.random()}`; 
                delete t.resource_id; 
                return t; 
            });
            renderBuilderUI();
        },
        deleteHistoryTemplate: async () => {
            if (!bState) return;
            const selectEl = document.getElementById(`history-select-${bState.containerId}`);
            if (!selectEl) return;
            const historyId = selectEl.value;
            
            if (!historyId) return alert('⚠️ 請先選擇要刪除的歷史作業！');
            if (!confirm('確定要封存這個歷史作業模板嗎？')) return;
            
            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ deleted_at: new Date().toISOString() })
                    .eq('id', historyId)
                    .is('deleted_at', null)
                    .select(); 
                    
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了您的修改");

                db.assignments = db.assignments.filter(a => a.id !== historyId);
                alert('✅ 已成功封存！');
                renderBuilderUI();
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
            }
        },
        addResourceTaskAsLink: (resId) => {
            syncState(); 
            const res = (db.resourceLibrary || []).find(r => r.id === resId);
            if (res) {
                bState.tasks.push({
                    id: `task_${Date.now()}_${Math.random()}`,
                    type: 'link', 
                    title: res.name,
                    url: res.url,
                    url_text: '', 
                    description: '',
                    due_date: '',
                    resource_id: res.id
                });
            }
            renderBuilderUI();
        },
        dragTaskStart: (e, idx) => { dragTaskIndex = idx; e.dataTransfer.effectAllowed = 'move'; },
        dropTask: (e, targetIdx) => {
            e.preventDefault();
            if (dragTaskIndex === null || dragTaskIndex === targetIdx) return;
            syncState();
            const draggedItem = bState.tasks.splice(dragTaskIndex, 1)[0];
            bState.tasks.splice(targetIdx, 0, draggedItem);
            dragTaskIndex = null;
            renderBuilderUI();
        },
        dragAssignStart: (e, id) => { dragAssignId = id; e.dataTransfer.effectAllowed = 'move'; },
        dropAssign: async (e, targetId, classId) => {
            e.preventDefault(); e.stopPropagation(); 
            if (!dragAssignId || dragAssignId === targetId) return;

            const arr = db.assignments;
            const fromIdx = arr.findIndex(a => a.id === dragAssignId);
            const toIdx = arr.findIndex(a => a.id === targetId);

            if (fromIdx > -1 && toIdx > -1) {
                const targetDate = arr[toIdx].target_date;
                const [dragged] = arr.splice(fromIdx, 1);
                
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate; 
                arr.splice(toIdx, 0, dragged);
                
                renderTimeline(classId, 'none'); 

                if (oldDate !== targetDate) {
                    try {
                        const { data: updatedRows, error } = await window.supabaseClient
                            .from('assignments')
                            .update({ target_date: targetDate })
                            .eq('id', dragAssignId)
                            .is('deleted_at', null)
                            .select(); 
                        if (error) throw error;
                        if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    } catch (err) {
                        dragged.target_date = oldDate; 
                        renderTimeline(classId, 'none');
                        alert('❌ 排序更新失敗: ' + err.message);
                    }
                }
            }
            dragAssignId = null;
        },
        dropAssignToNode: async (e, targetDate, classId) => {
            e.preventDefault();
            if (!dragAssignId) return;
            const arr = db.assignments;
            const dragged = arr.find(a => a.id === dragAssignId);
            
            if (dragged && dragged.target_date !== targetDate) {
                const oldDate = dragged.target_date;
                dragged.target_date = targetDate;
                renderTimeline(classId, 'none'); 

                try {
                    const { data: updatedRows, error } = await window.supabaseClient
                        .from('assignments')
                        .update({ target_date: targetDate })
                        .eq('id', dragAssignId)
                        .is('deleted_at', null)
                        .select(); 
                    if (error) throw error;
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                } catch (err) {
                    dragged.target_date = oldDate; 
                    renderTimeline(classId, 'none');
                    alert('❌ 拖曳更新失敗: ' + err.message);
                }
            }
            dragAssignId = null;
        },
        addTask: (type) => {
            syncState(); 
            bState.tasks.push({ id: `task_${Date.now()}`, type, title: '', url: '', url_text: '', description: '', due_date: '' });
            renderBuilderUI();
        },
        removeTask: (idx) => { syncState(); bState.tasks.splice(idx, 1); renderBuilderUI(); },
        updateTaskUrl: (idx, val) => { syncState(); bState.tasks[idx].url = val; renderBuilderUI(); },
        copyPrevUrl: (idx) => {
            syncState();
            if(idx > 0 && bState.tasks[idx-1].url) bState.tasks[idx].url = bState.tasks[idx-1].url;
            renderBuilderUI();
        },
        saveBlock: async (btnEl) => {
            syncState(); 
            const titleText = bState.title.replace(/<[^>]*>?/gm, '').trim();
            if (!titleText) return alert('⚠️ 請填寫大區塊標題！');
            
            if (!db.assignments) db.assignments = [];
            
            let mergedRawData = bState.raw_data || {};
            if (typeof mergedRawData === 'string') {
                try { mergedRawData = JSON.parse(mergedRawData); } catch(e) { mergedRawData = {}; }
            }
            mergedRawData.allow_late = !!bState.allow_late;
            
            const payload = {
                class_id: bState.classId,
                target_date: bState.target_date, 
                title: bState.title,
                description: bState.description,
                due_date: bState.due_date || null, 
                is_published: bState.is_published,
                tasks: [...bState.tasks],
                raw_data: mergedRawData
            };

            const originalText = btnEl.innerHTML;
            btnEl.innerHTML = '⏳ 儲存至雲端...';
            btnEl.disabled = true;

            let savedId = bState.editId;

            try {
                if (bState.editId) {
                    const { data: updatedRows, error } = await window.supabaseClient
                        .from('assignments')
                        .update(payload)
                        .eq('id', bState.editId)
                        .is('deleted_at', null)
                        .select(); 
                    if (error) throw new Error(error.message);
                    if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了修改");
                    
                    const idx = db.assignments.findIndex(a => a.id === bState.editId);
                    if(idx !== -1) db.assignments[idx] = { id: bState.editId, ...payload };
                } else {
                    const { data, error } = await window.supabaseClient.from('assignments').insert([payload]).select().single();
                    if (error) throw new Error(error.message);
                    if (!data) throw new Error("資料庫拒絕了請求");
                    db.assignments.push(data); 
                    savedId = data.id; 
                }

                bState = null;
                renderTimeline(payload.class_id, 'target', `assign-block-${savedId}`);
            } catch (err) {
                console.error(err);
                alert('❌ 作業儲存失敗: ' + err.message);
                btnEl.innerHTML = originalText;
                btnEl.disabled = false;
            }
        },
        cancelBuilder: () => {
            const cid = bState.classId;
            bState = null;
            renderTimeline(cid, 'none');
        },
        deleteAssignment: async (assignId, classId) => {
            if(!checkCanEditTimeline(classId)) return alert('權限不足：您的身分無法封存作業。');
            if(!confirm('確定要封存此作業區塊嗎？\n(注意：這將會隱藏作業，但學生的打勾紀錄仍會保存在系統中)')) return;
            
            const btn = window.event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳';
            btn.disabled = true;

            try {
                const { data: updatedRows, error } = await window.supabaseClient
                    .from('assignments')
                    .update({ deleted_at: new Date().toISOString() })
                    .eq('id', assignId)
                    .is('deleted_at', null)
                    .select(); 
                
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) throw new Error("資料庫拒絕了您的封存請求");

                db.assignments = db.assignments.filter(a => a.id !== assignId);
                renderTimeline(classId, 'none');
            } catch (err) {
                alert('❌ 封存失敗: ' + err.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    };
})();
/**
 * 📂 檔案路徑：110_teacher_core/feature-class.js
 * 🌟 v8.0 SaaS 終極大腦版：零壓縮還原，嚴格遵守不刪減任何一行
 * 資料流向：初始化、工具函式與渲染班級清單
 */
console.log("💡💡💡 FeatureClass v8.0 SaaS 終極大腦版載入！(無壓縮全展開版)");

window.FeatureClass = (() => {
    const db = window.TeacherDB;

    // --- 私有工具函式 ---
    function toLocalISODate(dateObj) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    // 🌟 新增：取得強制鎖定台灣時區的「今天」，杜絕跨國時區陷阱
    function getTaiwanTodayString() {
        try {
            const formatter = new Intl.DateTimeFormat('en-CA', { 
                timeZone: 'Asia/Taipei', 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit' 
            });
            return formatter.format(new Date()); 
        } catch(e) {
            return toLocalISODate(new Date()); // 防呆 Fallback
        }
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

    // 🌟 新增：計算某日期所屬的週起始日 (供週轉日對齊使用)
    function getWeekStartStr(dateStr, weekStartDay = 'sunday') {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-');
        const dt = new Date(y, m - 1, d);
        let day = dt.getDay(); 

        if (weekStartDay === 'monday') {
            let diff = day === 0 ? 6 : day - 1;
            dt.setDate(dt.getDate() - diff);
        } else {
            dt.setDate(dt.getDate() - day);
        }

        return toLocalISODate(dt);
    }

    const DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

    // --- 核心班級邏輯 ---
    async function updateClassContent(classId) {
        if (!classId) return;

        // 🌟 已經在 ApiService 完美抓取了，不需再發出額外的暴力查詢！
        const cls = db.classes.find(c => c.id === classId);
        if (!cls) return;
        
        const titleEl = document.getElementById('current-class-title');
        if (titleEl) {
            titleEl.textContent = `${cls.name}`; // 保留優化：拿掉醜陋的 UUID
        }

        if (document.getElementById('class-start-date')) {
            document.getElementById('class-start-date').value = cls.startDate || cls.start_date || "";
        }
        if (document.getElementById('class-end-date')) {
            document.getElementById('class-end-date').value = cls.endDate || cls.end_date || "";
        }
        
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
            try { 
                raw = JSON.parse(raw); 
            } catch (e) { 
                raw = {}; 
            }
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
            // 🛡️ 實作白皮書 RBAC 防禦：僅 Admin 與 Primary Teacher 可以看見設定與封存按鈕
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
    // (接續 Part 1)
    // 資料流向：班級設定介面與非同步防呆對話框 (Promisified Modals)

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
                try { 
                    dbRaw = JSON.parse(dbRaw); 
                } catch(e) { 
                    dbRaw = {}; 
                }
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

        if (!newName) {
            return alert("⚠️ 班級名稱不能為空！");
        }

        btn.innerHTML = '⏳ 儲存中...';
        btn.disabled = true;

        try {
            const cls = db.classes.find(c => c.id === classId);
            let dbRaw = cls.raw_data || cls.rawData || {};
            if (typeof dbRaw === 'string') {
                try { 
                    dbRaw = JSON.parse(dbRaw); 
                } catch(e) { 
                    dbRaw = {}; 
                }
            }
            
            const mergedRawData = Object.assign({}, dbRaw, { name_display_mode: newMode });

            const { data: updatedRows, error } = await window.supabaseClient
                .from('classes')
                .update({ name: newName, icon: newIcon, raw_data: mergedRawData })
                .eq('id', classId)
                .select();

            if (error) {
                throw error;
            }
            
            if (!updatedRows || updatedRows.length === 0) {
                throw new Error("設定並未真正寫入雲端 (請聯絡管理員檢查)");
            }

            document.getElementById('class-settings-modal').remove();
            
            // 🚀 強制雲端同步
            if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') {
                db.classes = await window.ApiService.fetchClasses();
            } else {
                // Fallback (若 ApiService 異常)
                cls.name = newName;
                cls.icon = newIcon;
                cls.raw_data = mergedRawData;
                cls.rawData = mergedRawData;
            }

            // 🚨 確保本地存檔同步觸發
            if (typeof db.save === 'function') {
                db.save();
            }

            renderClassManager();
            
            if (window.TeacherUI) {
                window.TeacherUI.renderSidebar();
            }
            
            if (window.TeacherUI && window.TeacherUI.getCurrentClassId() === classId) {
                updateClassContent(classId); // 更新上方標題
                
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

    // ==========================================
    // 🧠 非同步對話框控制器 (Promisified Modals)
    // ==========================================
    
    // 1. 孤兒作業排解精靈
    function askOrphanResolution(orphanCount, affectedDatesCount, todayStr) {
        return new Promise((resolve) => {
            const overlayId = 'schedule-orphan-modal';
            const existing = document.getElementById(overlayId);
            if (existing) existing.remove();
            
            const overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            
            overlay.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <h3 style="margin-top: 0; color: #DC2626; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 20px;">⚠️ 發現排程衝突！</h3>
                    
                    <div style="background: #FEF2F2; border: 1px solid #FECACA; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 0.95rem; color: #991B1B;">
                        系統偵測到您刪減了上課日。<br>這將導致過去的 <strong>[ ${affectedDatesCount} 天 ] (共 ${orphanCount} 份歷史作業)</strong> 失去原本的排程歸屬！請選擇處置方式：
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 25px;">
                        <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; border-radius: 8px; border: 2px solid #10B981; background: #F0FDF4;">
                            <input type="radio" name="orphan_resolve_mode" value="future" checked style="transform: scale(1.2); margin-top: 4px;">
                            <div>
                                <div style="font-weight: bold; color: #065F46;">🟢 (強烈建議) 僅套用至未來</div>
                                <div style="font-size: 0.85rem; color: #047857; margin-top: 4px;">歷史課表凍結，舊作業 100% 原封不動。<br>生效起始日：<input type="date" id="orphan-anchor-date" class="form-control" value="${todayStr}" style="padding:2px 4px; margin-left:5px; border:1px solid #34D399; border-radius:4px; font-size:0.85rem;"></div>
                            </div>
                        </label>
                        
                        <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px solid #CBD5E1; background: #F8FAFC;">
                            <input type="radio" name="orphan_resolve_mode" value="prev" style="transform: scale(1.2); margin-top: 4px;">
                            <div>
                                <div style="font-weight: bold; color: #475569;">🟡 往前歸附</div>
                                <div style="font-size: 0.85rem; color: #64748B;">套用全學期。孤兒作業自動往前擠到最近的合法上課日。</div>
                            </div>
                        </label>
                        
                        <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px solid #CBD5E1; background: #F8FAFC;">
                            <input type="radio" name="orphan_resolve_mode" value="next" style="transform: scale(1.2); margin-top: 4px;">
                            <div>
                                <div style="font-weight: bold; color: #475569;">🟡 往後遞延</div>
                                <div style="font-size: 0.85rem; color: #64748B;">套用全學期。孤兒作業自動往後延到最近的合法上課日。</div>
                            </div>
                        </label>
                        
                        <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px solid #FECACA; background: #FEF2F2;">
                            <input type="radio" name="orphan_resolve_mode" value="drop" style="transform: scale(1.2); margin-top: 4px;">
                            <div>
                                <div style="font-weight: bold; color: #DC2626;">🔴 直接捨棄</div>
                                <div style="font-size: 0.85rem; color: #991B1B;">確認不要了，直接將這 ${orphanCount} 份作業永久封存。</div>
                            </div>
                        </label>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn" id="btn-cancel-orphan" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">取消</button>
                        <button id="btn-confirm-orphan" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;">💾 執行修復並儲存</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            document.getElementById('btn-cancel-orphan').onclick = () => {
                overlay.remove(); 
                resolve(null);
            };
            
            document.getElementById('btn-confirm-orphan').onclick = () => {
                const action = document.querySelector('input[name="orphan_resolve_mode"]:checked').value;
                const anchorDate = document.getElementById('orphan-anchor-date').value;
                overlay.remove(); 
                resolve({ action, anchorDate });
            };
        });
    }

    // 2. 週結算轉單堂之批次對齊精靈
    function askWeeklyToDailyResolution(assignCount, meetDaysArr) {
        return new Promise((resolve) => {
            const overlayId = 'schedule-unpack-modal';
            const existing = document.getElementById(overlayId);
            if (existing) existing.remove();

            let dayOptionsHtml = meetDaysArr.map((dayNum, index) => {
                let label = index === 0 ? "第一堂" : (index === meetDaysArr.length - 1 ? "最後一堂 (建議)" : `第 ${index + 1} 堂`);
                let isChecked = index === meetDaysArr.length - 1 ? "checked" : "";
                return `
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px; background: white; border: 1px solid #CBD5E1; border-radius: 8px; margin-bottom: 8px;">
                        <input type="radio" name="unpack_target_day" value="${index}" ${isChecked} style="transform: scale(1.3);">
                        <span style="font-weight: bold; color: #334155; font-size: 1rem;">該週的 ${label} (${DAY_NAMES[dayNum]})</span>
                    </label>
                `;
            }).join('');
            
            const overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(2px);';
            
            overlay.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                    <h3 style="margin-top: 0; color: #3B82F6; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 20px;">🔄 排程轉換：批次展開週作業</h3>
                    
                    <div style="background: #EFF6FF; border: 1px solid #BFDBFE; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 0.95rem; color: #1E40AF;">
                        系統偵測到您從「週結算」切換為「日結算」。<br>經盤點，有 <strong>[ ${assignCount} 份 ]</strong> 過去打包為整週的作業。請指定這些作業要統一降落到每週的哪一堂課？
                    </div>

                    <div style="margin-bottom: 25px;">
                        ${dayOptionsHtml}
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn" id="btn-cancel-unpack" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">取消</button>
                        <button id="btn-confirm-unpack" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;">💾 執行批次對齊並儲存</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            document.getElementById('btn-cancel-unpack').onclick = () => {
                overlay.remove(); 
                resolve(null);
            };
            
            document.getElementById('btn-confirm-unpack').onclick = () => {
                const targetIndex = parseInt(document.querySelector('input[name="unpack_target_day"]:checked').value);
                overlay.remove(); 
                resolve(targetIndex);
            };
        });
    }
    // (接續 Part 2)
    // 資料流向：綁定 DOMContentLoaded、班級新增邏輯

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
                if (!name) {
                    return alert('⚠️ 請輸入班級名稱！');
                }

                const btn = this;
                const originalText = btn.innerHTML;
                
                btn.innerHTML = '⏳ 雲端建立中...';
                btn.disabled = true;

                try {
                    const { data: { user }, error: authError } = await window.supabaseClient.auth.getUser();
                    if (authError || !user) {
                        throw new Error('無法取得授權狀態，請重新登入');
                    }

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

                    // 1. 新增班級
                    const { data: newClass, error: classError } = await window.supabaseClient
                        .from('classes')
                        .insert([payload])
                        .select()
                        .single();
                    
                    if (classError) {
                        throw classError;
                    }

                    // 2. 綁定建立者為主老師 (Primary Teacher)
                    const { error: staffError } = await window.supabaseClient
                        .from('class_staff')
                        .insert([{
                            class_id: newClass.id,
                            user_id: user.id,
                            staff_role: 'primary_teacher'
                        }]);

                    if (staffError) {
                        throw new Error('班級已建立，但賦予管理權限時失敗：' + staffError.message);
                    }

                    nameInput.value = '';
                    if (modeSelector) {
                        modeSelector.value = 'default';
                    }
                    
                    // 🚀 強制雲端同步：丟棄本地 push，直接請 API 更新
                    if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') {
                        db.classes = await window.ApiService.fetchClasses();
                    } else {
                        // Fallback
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

                    // 🚨【補回遺漏 4：初始化新建班級的 db.sessions 空陣列】
                    if (!db.sessions) {
                        db.sessions = {};
                    }
                    db.sessions[newClass.id] = [];
                    
                    if (typeof db.save === 'function') {
                        db.save();
                    }
                    
                    if (window.TeacherUI) {
                        window.TeacherUI.renderSidebar();
                    }
                    
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
        // (接續 Part 3)
        // 🚀 核心：儲存排程與 Local Dry-Run 智慧引擎完整展開版
        const btnSaveDates = document.getElementById('btn-save-class-dates');
        if (btnSaveDates) {
            btnSaveDates.onclick = async function(e) {
                if(e) e.preventDefault(); 
                
                const cid = window.TeacherUI.getCurrentClassId();
                if (!cid) return console.error("❌ 找不到 cid");
                
                const c = db.classes.find(x => x.id === cid);
                if (!c) return console.error("❌ 找不到對應班級");
                
                let sDate = document.getElementById('class-start-date').value || toLocalISODate(new Date());
                let eDate = document.getElementById('class-end-date').value;
                
                // 🚨 完美繼承舊版防呆：若未填寫結束日，自動補全 4 個月後並「即時寫回畫面」，防止取消時丟失
                if (!eDate) {
                    const endDt = new Date(sDate);
                    endDt.setMonth(endDt.getMonth() + 4);
                    eDate = toLocalISODate(endDt);
                }
                
                document.getElementById('class-start-date').value = sDate;
                document.getElementById('class-end-date').value = eDate;

                const meetDaysArr = Array.from(document.querySelectorAll('#class-meet-days input:checked')).map(cb => parseInt(cb.value));
                
                const modeInput = document.querySelector('input[name="calc_mode"]:checked');
                const calcModeVal = modeInput ? modeInput.value : 'single';

                let weekStartVal = 'sunday';
                const weekRadios = document.getElementsByName('week_start_day');
                for (let i = 0; i < weekRadios.length; i++) {
                    if (weekRadios[i].checked) {
                        weekStartVal = weekRadios[i].value;
                        break;
                    }
                }

                const btn = this;
                if (btn.disabled) return; 

                const originalText = btn.innerHTML;
                
                // 🚨 提前鎖定按鈕，防止老師在對話框還沒回答時狂點
                btn.innerHTML = '⏳ 推演排程中...';
                btn.disabled = true;

                try {
                    // 🧠 [步驟 1] 抓取目前記憶體狀態 (Inventory)
                    let safeRawDataForCheck = c.raw_data || c.rawData || {};
                    if (typeof safeRawDataForCheck === 'string') {
                        try { 
                            safeRawDataForCheck = JSON.parse(safeRawDataForCheck); 
                        } catch (ex) { 
                            safeRawDataForCheck = {}; 
                        }
                    }

                    const oldCalcMode = c.calcMode || c.calc_mode || 'single';
                    const oldSessions = (safeRawDataForCheck.custom_sessions && Array.isArray(safeRawDataForCheck.custom_sessions)) 
                                        ? safeRawDataForCheck.custom_sessions 
                                        : (db.sessions[cid] || []);
                                        
                    const classAssigns = (db.assignments || []).filter(a => a.class_id === cid && !a.deleted_at);

                    // 🧠 [步驟 2] 沙盤推演新排程 (Simulation)
                    const newFullSessions = meetDaysArr.length > 0 ? generateDates(sDate, eDate, meetDaysArr) : [];
                    
                    // 🧠 [步驟 3] 碰撞測試：找出孤兒作業 (Collision Test)
                    const orphanAssigns = classAssigns.filter(a => !newFullSessions.includes(a.target_date));
                    const isWeekToDay = (oldCalcMode === 'weekly' && calcModeVal === 'single' && classAssigns.length > 0);
                    const todayStr = getTaiwanTodayString();

                    const oldSDate = c.startDate || c.start_date || '';
                    const oldEDate = c.endDate || c.end_date || '';
                    const oldMeetDaysStr = (c.meetDays || c.meet_days || []).map(Number).sort().join(',');
                    const newMeetDaysStr = meetDaysArr.sort().join(',');
                    
                    const isDatesChanged = (oldSDate !== sDate) || (oldEDate !== eDate) || (oldMeetDaysStr !== newMeetDaysStr);

                    // 🌟 執行核心同步與儲存的閉包函式
                    const executeSave = async (finalCustomSessions, assignUpdatesMap = new Map()) => {
                        btn.innerHTML = assignUpdatesMap.size > 0 ? '⏳ 同步與批次對齊中...' : '⏳ 雲端同步中...';

                        // A. 處理作業的批次更新
                        const finalAssignUpdates = Array.from(assignUpdatesMap.values());
                        if (finalAssignUpdates.length > 0) {
                            const promises = finalAssignUpdates.map(upd => 
                                window.supabaseClient.from('assignments').update(upd.payload).eq('id', upd.id)
                            );
                            
                            await Promise.all(promises);
                            
                            finalAssignUpdates.forEach(upd => {
                                const target = db.assignments.find(a => a.id === upd.id);
                                if (target) {
                                    Object.assign(target, upd.payload);
                                }
                            });
                            
                            db.assignments = db.assignments.filter(a => !a.deleted_at);
                        }

                        // B. 儲存班級主檔與新排程
                        const mergedRawData = Object.assign({}, safeRawDataForCheck, { 
                            week_start_day: weekStartVal, 
                            custom_sessions: finalCustomSessions 
                        });
                        
                        const payload = { 
                            start_date: sDate, 
                            end_date: eDate, 
                            meet_days: meetDaysArr, 
                            calc_mode: calcModeVal, 
                            raw_data: mergedRawData 
                        };
                        
                        const { data: updatedRows, error: updateErr } = await window.supabaseClient
                            .from('classes')
                            .update(payload)
                            .eq('id', cid)
                            .select();

                        if (updateErr) {
                            throw new Error("Supabase 寫入失敗: " + updateErr.message);
                        }
                        
                        if (!updatedRows || updatedRows.length === 0) {
                            throw new Error("資料庫拒絕寫入 (可能是 RLS 權限阻擋)。");
                        }

                        // 🚀 儲存後強制雲端重刷
                        if (window.ApiService && typeof window.ApiService.fetchClasses === 'function') {
                            db.classes = await window.ApiService.fetchClasses();
                        } else {
                            c.startDate = sDate;
                            c.endDate = eDate;
                            c.meetDays = meetDaysArr;
                            c.calcMode = calcModeVal;
                            c.raw_data = mergedRawData;
                            c.rawData = mergedRawData;
                        }

                        // 🚨【補回遺漏 3：根據新設定重新計算 db.sessions，否則 Timeline 模組會空掉】
                        if (!db.sessions) {
                            db.sessions = {};
                        }
                        db.sessions[cid] = finalCustomSessions;
                        
                        if (typeof db.save === 'function') {
                            db.save();
                        }

                        updateClassContent(cid);

                        btn.innerHTML = finalAssignUpdates.length > 0 ? '✅ 同步與對齊成功！' : '✅ 儲存成功！';
                        btn.style.backgroundColor = '#10B981';
                        btn.style.color = '#fff';
                        btn.style.borderColor = '#10B981';
                        
                        setTimeout(() => {
                            btn.innerHTML = originalText;
                            btn.removeAttribute('style'); 
                            btn.disabled = false;
                            
                            try {
                                if (window.TeacherUI && typeof window.TeacherUI.switchTab === 'function') {
                                    window.TeacherUI.switchTab('timeline');
                                    return;
                                }
                                const selectors = ['[data-target="timeline"]', '[data-tab="timeline"]', '.tab-timeline', '#tab-timeline'];
                                let isClicked = false;
                                for (let sel of selectors) {
                                    const targetTab = document.querySelector(sel);
                                    if (targetTab && targetTab.offsetParent !== null) {
                                        targetTab.click();
                                        isClicked = true;
                                        break;
                                    }
                                }
                                if (!isClicked) {
                                    const allElements = document.querySelectorAll('.tab, .nav-item, li, button, a');
                                    for (let el of allElements) {
                                        if (el.textContent.includes('課程進度')) {
                                            el.click();
                                            break;
                                        }
                                    }
                                }
                            } catch (tabErr) {
                                console.error("頁籤跳轉發生錯誤：", tabErr);
                            }
                        }, 1000);
                    };

                    // 🛑 決策樹 1：攔截孤兒作業
                    if (orphanAssigns.length > 0) {
                        const uniqueOrphanDates = [...new Set(orphanAssigns.map(a => a.target_date))].length;
                        const orphanRes = await askOrphanResolution(orphanAssigns.length, uniqueOrphanDates, todayStr);
                        
                        if (!orphanRes) {
                            btn.innerHTML = originalText;
                            btn.disabled = false;
                            return; 
                        }
                        
                        let finalSessions = [...newFullSessions];
                        let assignUpdatesMap = new Map();

                        if (orphanRes.action === 'future') {
                            const pastSessions = oldSessions.filter(date => date < orphanRes.anchorDate);
                            const calcStart = (orphanRes.anchorDate > sDate) ? orphanRes.anchorDate : sDate;
                            const futureSessions = meetDaysArr.length > 0 ? generateDates(calcStart, eDate, meetDaysArr) : [];
                            finalSessions = [...new Set([...pastSessions, ...futureSessions])].sort();

                            orphanAssigns.forEach(a => {
                                if (a.target_date >= orphanRes.anchorDate) {
                                    const candidates = finalSessions.filter(d => d >= a.target_date);
                                    let newTarget = candidates.length > 0 ? candidates[0] : finalSessions[finalSessions.length - 1];
                                    if (newTarget) assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTarget } });
                                }
                            });
                        } else if (orphanRes.action === 'prev' || orphanRes.action === 'next') {
                            orphanAssigns.forEach(a => {
                                let newTarget = null;
                                if (orphanRes.action === 'prev') {
                                    const candidates = newFullSessions.filter(d => d < a.target_date);
                                    newTarget = candidates.length > 0 ? candidates[candidates.length - 1] : newFullSessions[0];
                                } else {
                                    const candidates = newFullSessions.filter(d => d > a.target_date);
                                    newTarget = candidates.length > 0 ? candidates[0] : newFullSessions[newFullSessions.length - 1];
                                }
                                if (newTarget) assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTarget } });
                            });
                        } else if (orphanRes.action === 'drop') {
                            const delTime = new Date().toISOString();
                            orphanAssigns.forEach(a => assignUpdatesMap.set(a.id, { id: a.id, payload: { deleted_at: delTime } }));
                        }

                        // 判斷是否需要後續的週改日
                        if (isWeekToDay) {
                            const targetIndex = await askWeeklyToDailyResolution(classAssigns.length, meetDaysArr);
                            if (targetIndex === null) {
                                btn.innerHTML = originalText;
                                btn.disabled = false;
                                return;
                            }
                            
                            const weeksMap = new Map();
                            finalSessions.forEach(d => {
                                const ws = getWeekStartStr(d, weekStartVal);
                                if (!weeksMap.has(ws)) weeksMap.set(ws, []);
                                weeksMap.get(ws).push(d);
                            });

                            classAssigns.forEach(a => {
                                if (assignUpdatesMap.has(a.id) && assignUpdatesMap.get(a.id).payload.deleted_at) return;
                                
                                const currentTarget = assignUpdatesMap.has(a.id) ? assignUpdatesMap.get(a.id).payload.target_date : a.target_date;
                                const ws = getWeekStartStr(currentTarget, weekStartVal);
                                const weekDays = weeksMap.get(ws) || [];
                                let newTargetD = currentTarget;
                                
                                if (weekDays.length > 0) {
                                    newTargetD = weekDays[targetIndex] || weekDays[weekDays.length - 1];
                                }
                                
                                if (newTargetD !== a.target_date) {
                                    if (assignUpdatesMap.has(a.id)) {
                                        assignUpdatesMap.get(a.id).payload.target_date = newTargetD;
                                    } else {
                                        assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTargetD } });
                                    }
                                }
                            });
                        }

                        await executeSave(finalSessions, assignUpdatesMap);

                    } else {
                        // 🟢 安全變更：完全移除無腦的黃色警告，實現真正的靜默儲存 (Silent Save)
                        let finalSessions = [...newFullSessions];
                        
                        if (!isDatesChanged) {
                            finalSessions = (safeRawDataForCheck.custom_sessions && Array.isArray(safeRawDataForCheck.custom_sessions)) 
                                            ? safeRawDataForCheck.custom_sessions 
                                            : [...newFullSessions];
                        }

                        // 判斷是否需要後續的週改日
                        if (isWeekToDay) {
                            const targetIndex = await askWeeklyToDailyResolution(classAssigns.length, meetDaysArr);
                            if (targetIndex === null) {
                                btn.innerHTML = originalText;
                                btn.disabled = false;
                                return;
                            }
                            
                            let assignUpdatesMap = new Map();
                            const weeksMap = new Map();
                            
                            finalSessions.forEach(d => {
                                const ws = getWeekStartStr(d, weekStartVal);
                                if (!weeksMap.has(ws)) weeksMap.set(ws, []);
                                weeksMap.get(ws).push(d);
                            });

                            classAssigns.forEach(a => {
                                const ws = getWeekStartStr(a.target_date, weekStartVal);
                                const weekDays = weeksMap.get(ws) || [];
                                let newTargetD = a.target_date;
                                
                                if (weekDays.length > 0) {
                                    newTargetD = weekDays[targetIndex] || weekDays[weekDays.length - 1];
                                }
                                
                                if (newTargetD !== a.target_date) {
                                    assignUpdatesMap.set(a.id, { id: a.id, payload: { target_date: newTargetD } });
                                }
                            });
                            
                            await executeSave(finalSessions, assignUpdatesMap);
                        } else {
                            await executeSave(finalSessions, new Map());
                        }
                    }

                } catch (err) {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    console.error(err);
                    alert("推演或儲存失敗：" + err.message);
                }
            };
        }

        if (window.TeacherUI) window.TeacherUI.renderSidebar();
        renderClassManager();

        if (db.classes && db.classes.length > 0 && window.TeacherUI && typeof window.TeacherUI.activateClassView === 'function') {
            window.TeacherUI.activateClassView(db.classes[0].id);
        }
    });

    return { 
        updateClassContent, 
        renderClassManager,
        editClass: openClassSettings, 
        openClassSettings,
        saveClassSettings,
        toggleDeleteConfirm: (classId, show) => {
            document.getElementById(`class-info-${classId}`).style.display = show ? 'none' : 'flex';
            document.getElementById(`class-delete-confirm-${classId}`).style.display = show ? 'block' : 'none';
        },
        executeDelete: async (classId) => {
            const btn = window.event ? window.event.target : document.activeElement;
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 雲端 RPC 封存中...';
            btn.disabled = true;

            try {
                if (!window.ApiService || typeof window.ApiService.archiveClass !== 'function') {
                    throw new Error("API 引擎未就緒，無法執行封存。");
                }
                
                const deleteStudentsComplete = document.getElementById(`del-students-cb-${classId}`).checked;

                if (deleteStudentsComplete) {
                    const { data: enrollments, error: fetchError } = await window.supabaseClient
                        .from('student_enrollments')
                        .select('user_id')
                        .eq('class_id', classId)
                        .is('deleted_at', null);

                    if (!fetchError && enrollments && enrollments.length > 0) {
                        const studentIds = enrollments.map(e => e.user_id);
                        await window.supabaseClient
                            .from('profiles')
                            .update({ deleted_at: new Date().toISOString() })
                            .in('id', studentIds);
                    }
                }

                await window.ApiService.archiveClass(classId);
                db.classes = await window.ApiService.fetchClasses();
                
                if (db.sessions) delete db.sessions[classId];
                if (db.resourceMappings) db.resourceMappings = db.resourceMappings.filter(m => m.class_id !== classId);
                if (db.assignments) db.assignments = db.assignments.filter(a => a.class_id !== classId);
                if (db.students) db.students = db.students.filter(s => s.class_id !== classId);
                if (typeof db.save === 'function') db.save();

                if (window.TeacherUI) window.TeacherUI.renderSidebar();
                renderClassManager();
                
                if (window.TeacherUI && window.TeacherUI.getCurrentClassId() === classId) {
                    if (db.classes.length > 0) {
                        window.TeacherUI.activateClassView(db.classes[0].id);
                    } else {
                        const header = document.getElementById('class-context-header');
                        if (header) header.style.display = 'none';
                        const titleEl = document.getElementById('current-class-title');
                        if (titleEl) titleEl.textContent = '尚無班級，請點擊「班級主檔管理」建立新班級';
                    }
                }
            } catch (err) {
                alert(err.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    };
})();
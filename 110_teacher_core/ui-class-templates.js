/**
 * 📂 檔案路徑：110_teacher_core/ui-class-templates.js
 * 🌟 班級模組純視覺模板工廠 (UI Templates Factory)
 * 專職字串拼接，將狀態轉為 HTML，無邏輯副作用。
 */

window.ClassTemplates = (() => {

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function getModeSelectorHtml() {
        return `
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
    }

    function getClassManagerItemHtml(cls, canManage) {
        let actionButtonsHTML = '';
        if (canManage) {
            actionButtonsHTML = `
                <div style="display: flex; gap: 8px;">
                    <button class="btn" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; padding:6px 12px; border-radius:6px; font-size: 0.9rem; font-weight: bold; cursor:pointer;" onclick="window.FeatureClass.openClassSettings('${cls.id}')" title="班級設定">⚙️ 設定</button>
                    <button class="btn-danger" style="background:#FEF2F2; color:#EF4444; border:1px solid #FECACA; padding:6px 12px; border-radius:6px; font-size: 0.9rem; font-weight: bold; cursor:pointer;" onclick="window.FeatureClass.openArchiveConfirm('${cls.id}')">📦 封存</button>
                </div>
            `;
        } else {
            actionButtonsHTML = `<span style="font-size: 0.85rem; color: #94A3B8; font-weight: bold; padding:6px 12px;">(僅主老師可設定)</span>`;
        }

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 0;">
                <div style="display: flex; align-items: center; flex: 1;">
                    <span style="font-size:1.4rem; margin-right:12px;">${cls.icon || '📘'}</span>
                    <strong style="font-size:1.15rem; color:#1E293B;">${escapeHtml(cls.name)}</strong>
                    <span style="margin-left:10px; font-size:0.8rem; background:#E2E8F0; padding:2px 8px; border-radius:12px; color:#475569;">${cls.staff_role || '未知'}</span>
                </div>
                ${actionButtonsHTML}
            </div>
        `;
    }

    function getClassArchiveModalHtml(cls, overlayId) {
        const safeName = escapeHtml(cls.name);
        const icon = cls.icon ? cls.icon : '📘';
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 480px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #DC2626; border-bottom: 2px solid #FEE2E2; padding-bottom: 10px; margin-bottom: 20px;">📦 封存班級確認</h3>

                <div style="background: #FEF2F2; border: 1px solid #FECACA; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="font-size: 0.9rem; color: #991B1B; margin-bottom: 10px; font-weight: bold;">您即將封存以下班級：</div>
                    <div style="display: flex; align-items: center; gap: 12px; background: white; padding: 12px 14px; border-radius: 8px; border: 1px solid #FCA5A5;">
                        <span style="font-size: 1.6rem;">${icon}</span>
                        <strong style="font-size: 1.25rem; color: #1E293B;">${safeName}</strong>
                    </div>
                </div>

                <p style="font-size: 0.95rem; color: #7F1D1D; margin: 0 0 16px; line-height: 1.5;">相關作業與選課紀錄將由資料庫安全封存，班級將從列表中移除且無法再使用。</p>

                <label style="display:flex; align-items:flex-start; gap:8px; font-size:0.9rem; cursor:pointer; margin-bottom:24px;">
                    <input type="checkbox" id="del-students-cb-${cls.id}" style="transform:scale(1.2); accent-color: #EF4444; margin-top: 3px;">
                    <span style="color:#7F1D1D; font-weight: bold;">進階：連同此班級的專屬學生帳號一併「軟刪除」停權</span>
                </label>

                <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #FEE2E2; padding-top: 20px;">
                    <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;" onclick="window.FeatureClass.closeArchiveConfirm()">取消</button>
                    <button id="btn-confirm-archive-${cls.id}" class="btn-danger" style="background:#EF4444; color:white; padding:8px 20px; border:none; border-radius:6px; font-weight:bold; cursor:pointer;" onclick="window.FeatureClass.executeDelete('${cls.id}')">✔️ 確認封存「${safeName}」</button>
                </div>
            </div>
        `;
    }

    function getClassSettingsModalHtml(cls, currentMode, lateDefaults, iconInputHTML, overlayId, gradingPolicy) {
        const gp = gradingPolicy ? gradingPolicy : {};
        const finalAuth = gp.final_authority ? gp.final_authority : 'human_confirm';
        const accent = gp.accent ? gp.accent : 'en-us';
        const phonetic = gp.phonetic_format ? gp.phonetic_format : 'kk';
        const overrideRoles = Array.isArray(gp.override_roles) ? gp.override_roles : ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior'];
        const publishRoles = Array.isArray(gp.publish_roles) ? gp.publish_roles : ['primary_teacher', 'co_teacher', 'ta_senior'];

        function roleChecked(list, role) {
            return list.indexOf(role) > -1 ? 'checked' : '';
        }
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
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

                <div style="background: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0; margin-bottom: 20px;">
                    <label style="display:block; font-weight:bold; color:#3B82F6; margin-bottom:10px;">👥 名單顯示模式 (優先權：高)</label>
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

                <div style="background: #FFFBEB; padding: 15px; border-radius: 8px; border: 1px solid #FEF3C7; margin-bottom: 25px;">
                    <label style="display:block; font-weight:bold; color:#D97706; margin-bottom:10px;">⏳ 班級遲交預設規則 (套用於新作業)</label>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <label style="cursor: pointer; font-weight: bold; color: #92400E; display: flex; align-items: center;">
                            <input type="checkbox" id="edit-allow-late" ${lateDefaults.allow_late ? 'checked' : ''} style="transform: scale(1.2); margin-right: 8px;" onchange="document.getElementById('late-settings-details').style.display = this.checked ? 'block' : 'none'">
                            允許遲交作業
                        </label>
                        <div id="late-settings-details" style="display: ${lateDefaults.allow_late ? 'block' : 'none'}; padding-left: 25px; margin-top: 5px;">
                            <div style="display: flex; gap: 15px;">
                                <div style="flex: 1;">
                                    <label style="display:block; font-size: 0.85rem; font-weight:bold; color:#B45309; margin-bottom:4px;">寬限期 (小時)</label>
                                    <input type="number" id="edit-grace-period" class="form-control" value="${lateDefaults.grace_period_hours}" min="0" style="width: 100%; padding: 6px 8px;">
                                </div>
                                <div style="flex: 1;">
                                    <label style="display:block; font-size: 0.85rem; font-weight:bold; color:#B45309; margin-bottom:4px;">遲交扣分 (%)</label>
                                    <input type="number" id="edit-penalty-percent" class="form-control" value="${lateDefaults.penalty_percentage}" min="0" max="100" style="width: 100%; padding: 6px 8px;">
                                </div>
                            </div>
                            <div style="font-size: 0.8rem; color: #D97706; margin-top: 8px;">註：修改此預設規則僅影響未來新增的作業，已派發之作業不受影響。</div>
                        </div>
                    </div>
                </div>

                <div style="background: #EEF2FF; padding: 15px; border-radius: 8px; border: 1px solid #C7D2FE; margin-bottom: 25px;">
                    <label style="display:block; font-weight:bold; color:#4338CA; margin-bottom:10px;">🤖 AI 批改成績設定（必選）</label>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">
                        <label style="cursor:pointer; font-weight:bold; color:#475569; display:flex; align-items:center;">
                            <input type="radio" name="edit_final_authority" value="ai_auto" ${finalAuth === 'ai_auto' ? 'checked' : ''} style="transform:scale(1.2); margin-right:8px;">
                            AI 評分即最終成績
                        </label>
                        <label style="cursor:pointer; font-weight:bold; color:#475569; display:flex; align-items:center;">
                            <input type="radio" name="edit_final_authority" value="human_confirm" ${finalAuth === 'human_confirm' ? 'checked' : ''} style="transform:scale(1.2); margin-right:8px;">
                            需人工確認後才為最終成績
                        </label>
                    </div>
                    <div style="font-size:0.85rem; color:#4338CA; margin-bottom:10px; font-weight:bold;">誰可以覆寫分數／評語？</div>
                    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-override-primary_teacher" ${roleChecked(overrideRoles, 'primary_teacher')}> 主老師</label>
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-override-co_teacher" ${roleChecked(overrideRoles, 'co_teacher')}> 協同老師</label>
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-override-ta_senior" ${roleChecked(overrideRoles, 'ta_senior')}> 資深助教</label>
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-override-ta_junior" ${roleChecked(overrideRoles, 'ta_junior')}> 一般助教</label>
                    </div>
                    <div style="font-size:0.85rem; color:#4338CA; margin-bottom:10px; font-weight:bold;">誰可以發布／定案成績？</div>
                    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-publish-primary_teacher" ${roleChecked(publishRoles, 'primary_teacher')}> 主老師</label>
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-publish-co_teacher" ${roleChecked(publishRoles, 'co_teacher')}> 協同老師</label>
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-publish-ta_senior" ${roleChecked(publishRoles, 'ta_senior')}> 資深助教</label>
                        <label style="font-size:0.85rem;"><input type="checkbox" id="gp-publish-ta_junior" ${roleChecked(publishRoles, 'ta_junior')}> 一般助教</label>
                    </div>
                    <div style="display:flex; gap:12px; flex-wrap:wrap;">
                        <div style="flex:1; min-width:140px;">
                            <label style="display:block; font-size:0.85rem; font-weight:bold; color:#4338CA; margin-bottom:4px;">口音基準</label>
                            <select id="gp-accent" class="form-control" style="width:100%;">
                                <option value="en-us" ${accent === 'en-us' ? 'selected' : ''}>美式英文</option>
                                <option value="en-gb" ${accent === 'en-gb' ? 'selected' : ''}>英式英文</option>
                            </select>
                        </div>
                        <div style="flex:1; min-width:140px;">
                            <label style="display:block; font-size:0.85rem; font-weight:bold; color:#4338CA; margin-bottom:4px;">音標格式</label>
                            <select id="gp-phonetic" class="form-control" style="width:100%;">
                                <option value="kk" ${phonetic === 'kk' ? 'selected' : ''}>KK</option>
                                <option value="ipa" ${phonetic === 'ipa' ? 'selected' : ''}>IPA</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #E2E8F0; padding-top: 20px;">
                    <button class="btn" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;" onclick="window.FeatureClass.closeClassSettings()">取消</button>
                    <button id="btn-save-class-settings" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;" onclick="window.FeatureClass.saveClassSettings('${cls.id}')">💾 儲存變更</button>
                </div>
            </div>
        `;
    }

    function getSafeScheduleModalHtml(todayStr) {
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #10B981; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 20px;">📅 排程異動確認</h3>
                
                <div style="background: #F0FDF4; border: 1px solid #A7F3D0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 0.95rem; color: #047857;">
                    系統偵測到您變更了上課日或學期區間（無造成作業衝突）。<br>請決定這次的排程變更要從哪一天開始生效？
                </div>

                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 25px;">
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; border-radius: 8px; border: 2px solid #10B981; background: #F0FDF4;">
                        <input type="radio" name="safe_resolve_mode" value="future" checked style="transform: scale(1.2); margin-top: 4px;">
                        <div>
                            <div style="font-weight: bold; color: #065F46;">🟢 僅套用至未來 (強烈建議)</div>
                            <div style="font-size: 0.85rem; color: #047857; margin-top: 4px;">過去的歷史紀錄將被凍結保護，不會被無故塞入空白天數。<br>生效起始日：<input type="date" id="safe-anchor-date" class="form-control" value="${todayStr}" style="padding:2px 4px; margin-left:5px; border:1px solid #34D399; border-radius:4px; font-size:0.85rem;"></div>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px solid #CBD5E1; background: #F8FAFC;">
                        <input type="radio" name="safe_resolve_mode" value="full" style="transform: scale(1.2); margin-top: 4px;">
                        <div>
                            <div style="font-weight: bold; color: #475569;">🔄 套用至全學期</div>
                            <div style="font-size: 0.85rem; color: #64748B;">從學期第一天重新鋪設排程 (過去的歷史天數也會跟著改變)。</div>
                        </div>
                    </label>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn" id="btn-cancel-safe" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">取消</button>
                    <button id="btn-confirm-safe" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;">💾 確認並儲存</button>
                </div>
            </div>
        `;
    }

    function getOrphanModalHtml(orphanCount, affectedDatesCount, todayStr) {
        return `
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
                            <div style="font-size: 0.85rem; color: #64748B;">孤兒作業自動往前擠到最近的合法上課日。</div>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px solid #CBD5E1; background: #F8FAFC;">
                        <input type="radio" name="orphan_resolve_mode" value="next" style="transform: scale(1.2); margin-top: 4px;">
                        <div>
                            <div style="font-weight: bold; color: #475569;">🟡 往後遞延</div>
                            <div style="font-size: 0.85rem; color: #64748B;">孤兒作業自動往後延到最近的合法上課日。</div>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px solid #FECACA; background: #FEF2F2;">
                        <input type="radio" name="orphan_resolve_mode" value="drop" style="transform: scale(1.2); margin-top: 4px;">
                        <div>
                            <div style="font-weight: bold; color: #DC2626;">🔴 直接捨棄</div>
                            <div style="font-size: 0.85rem; color: #991B1B;">直接將這 ${orphanCount} 份作業永久封存。</div>
                        </div>
                    </label>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn" id="btn-cancel-orphan" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">取消</button>
                    <button id="btn-confirm-orphan" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold;">💾 執行修復並儲存</button>
                </div>
            </div>
        `;
    }

    function getUnpackModalHtml(assignCount) {
        return `
            <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 480px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #3B82F6; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 20px;">🔄 展開週作業：智慧對齊</h3>
                
                <div style="background: #EFF6FF; border: 1px solid #BFDBFE; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 0.95rem; color: #1E40AF; line-height: 1.5;">
                    系統偵測到您將排程改為「單堂結算」。<br>有 <strong>[ ${assignCount} 份 ]</strong> 原本打包在一起的作業需要分配天數。請選擇您的對齊策略：
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 25px;">
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 15px; border-radius: 8px; border: 2px solid #8B5CF6; background: #F5F3FF;">
                        <input type="radio" name="unpack_strategy" value="smart" checked style="transform: scale(1.3); margin-top: 2px;">
                        <div>
                            <div style="font-weight: 900; color: #6D28D9; font-size: 1.05rem;">🌟 智慧分配 (強烈推薦)</div>
                            <div style="font-size: 0.85rem; color: #5B21B6; margin-top: 4px;">系統將根據每份作業的「繳交期限」，自動分配到期限前的最後一堂課。</div>
                        </div>
                    </label>
                    
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 12px; background: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px;">
                        <input type="radio" name="unpack_strategy" value="first" style="transform: scale(1.3);">
                        <span style="font-weight: bold; color: #334155; font-size: 1rem;">統一集中放在該週的【第一堂】</span>
                    </label>
                    
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 12px; background: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px;">
                        <input type="radio" name="unpack_strategy" value="last" style="transform: scale(1.3);">
                        <span style="font-weight: bold; color: #334155; font-size: 1rem;">統一集中放在該週的【最後一堂】</span>
                    </label>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn" id="btn-cancel-unpack" style="background: #F1F5F9; color: #475569; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">取消</button>
                    <button id="btn-confirm-unpack" class="btn btn-primary" style="padding: 8px 20px; font-weight: bold; background: #8B5CF6; border: none;">✨ 執行對齊並儲存</button>
                </div>
            </div>
        `;
    }

    return {
        getModeSelectorHtml,
        getClassManagerItemHtml,
        getClassArchiveModalHtml,
        getClassSettingsModalHtml,
        getSafeScheduleModalHtml,
        getOrphanModalHtml,
        getUnpackModalHtml
    };
})();
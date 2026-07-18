/**
 * 📂 檔案路徑：120_student_core/feature-student-resource.js
 * 🌟 學生課程資源大腦 (v5.0)：真正對接 Supabase 資料庫，拔除假資料
 */

window.FeatureStudentResource = (() => {
    
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function safeFormatUrl(url) {
        if (!url) return '';
        let trimmedUrl = String(url).replace(/['"]/g, '').trim();
        if (trimmedUrl === '') return '';
        if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
            if (trimmedUrl.length > 20 && !trimmedUrl.includes('/') && !trimmedUrl.includes('.')) {
                return `https://drive.google.com/drive/folders/${trimmedUrl}`;
            }
            return `https://${trimmedUrl}`;
        }
        return trimmedUrl;
    }

    return {
        init: async (classConfig) => {
            const container = document.getElementById('resource-container');
            if (!container) return;

            if (!classConfig || !classConfig.id) {
                container.innerHTML = '<p style="color:#EF4444; font-weight:bold;">無法取得班級資訊，載入資源失敗。</p>';
                return;
            }

            container.innerHTML = '<div style="text-align:center; padding: 40px; color:#94A3B8; font-weight:800;">⏳ 正在連線雲端擷取資源...</div>';

            try {
                const classId = classConfig.id;

                // 🌟 核心修復：直接去 Supabase 撈取此班級的資源，加上全域資源
                const { data: resData, error } = await window.supabaseClient
                    .from('resources')
                    .select('*')
                    .is('deleted_at', null)
                    .or(`scope.eq.global,and(scope.eq.class,target_class_id.eq.${classId})`);

                if (error) throw error;

                const globalRes = [];
                const classRes = [];
                const seenUrls = new Set(); // 用來防呆，萬一老師端還是有不小心重複建的

                (resData || []).forEach(r => {
                    if (!seenUrls.has(r.url)) {
                        seenUrls.add(r.url);
                        if (r.scope === 'global') {
                            globalRes.push(r);
                        } else {
                            classRes.push(r);
                        }
                    }
                });

                let html = '<div style="display:flex; flex-direction:column; gap:30px;">';
                
                // -----------------------------
                // 📚 區塊 1：班級專屬資源
                // -----------------------------
                html += '<div>';
                html += '<h3 style="color:#0F172A; border-bottom:2px solid #E2E8F0; padding-bottom:8px; display:flex; align-items:center; gap:8px;">📚 班級專屬資源</h3>';
                if (classRes.length > 0) {
                    html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
                    classRes.forEach(res => {
                        const icon = res.icon || '📁';
                        const title = escapeHTML(res.name || '未命名資源');
                        const url = safeFormatUrl(res.url);
                        html += `
                            <a href="${url}" target="_blank" style="text-decoration:none; background:white; border:1px solid #E2E8F0; border-radius:12px; padding:15px; display:flex; gap:12px; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='#3B82F6';" onmouseout="this.style.transform='none'; this.style.borderColor='#E2E8F0';">
                                <div style="font-size:1.8rem; background:#F8FAFC; width:45px; height:45px; display:flex; align-items:center; justify-content:center; border-radius:8px;">${icon}</div>
                                <div>
                                    <h4 style="margin:0 0 4px 0; color:#1E293B; font-size:1rem; font-weight:800;">${title} <span style="font-size:0.7rem; background:#EEF2FF; color:#4F46E5; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:6px;">班級</span></h4>
                                    <p style="margin:0; font-size:0.85rem; color:#64748B;">點擊前往雲端連結</p>
                                </div>
                            </a>
                        `;
                    });
                    html += '</div>';
                } else {
                    html += '<p style="color:#94A3B8; font-weight:bold; background:#F8FAFC; padding:15px; border-radius:8px; text-align:center;">老師尚未新增班級專屬資源。</p>';
                }
                html += '</div>';

                // -----------------------------
                // 🌍 區塊 2：全域共用資源
                // -----------------------------
                html += '<div>';
                html += '<h3 style="color:#0F172A; border-bottom:2px solid #E2E8F0; padding-bottom:8px; display:flex; align-items:center; gap:8px;">🌍 全域共用資源</h3>';
                if (globalRes.length > 0) {
                    html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
                    globalRes.forEach(res => {
                        const icon = res.icon || '🔗';
                        const title = escapeHTML(res.name || '未命名資源');
                        const url = safeFormatUrl(res.url);
                        html += `
                            <a href="${url}" target="_blank" style="text-decoration:none; background:white; border:1px solid #E2E8F0; border-radius:12px; padding:15px; display:flex; gap:12px; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='#10B981';" onmouseout="this.style.transform='none'; this.style.borderColor='#E2E8F0';">
                                <div style="font-size:1.8rem; background:#ECFDF5; width:45px; height:45px; display:flex; align-items:center; justify-content:center; border-radius:8px;">${icon}</div>
                                <div>
                                    <h4 style="margin:0 0 4px 0; color:#065F46; font-size:1rem; font-weight:800;">${title}</h4>
                                    <p style="margin:0; font-size:0.85rem; color:#64748B;">點擊前往雲端連結</p>
                                </div>
                            </a>
                        `;
                    });
                    html += '</div>';
                } else {
                    html += '<p style="color:#94A3B8; font-weight:bold; background:#F8FAFC; padding:15px; border-radius:8px; text-align:center;">目前無全域資源。</p>';
                }
                html += '</div></div>';

                container.innerHTML = html;

            } catch (err) {
                console.error("[Student Resource Error]", err);
                container.innerHTML = `<p style="color:#EF4444; font-weight:bold;">載入資源失敗：${err.message}</p>`;
            }
        }
    };
})();
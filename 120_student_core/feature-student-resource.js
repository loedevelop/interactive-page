/**
 * 📂 檔案路徑：120_student_core/feature-student-resource.js
 * 🌟 課程資源大腦：支援「班級專屬」與「全域共用」雙軌架構。
 */

window.FeatureStudentResource = (() => {
    // 預設全域共用資源清單
    const GLOBAL_RESOURCES = [
        { title: "📖 線上劍橋字典", link: "https://dictionary.cambridge.org/zht/", icon: "📚", desc: "英漢/英英雙解權威字典" },
        { title: "🗣️ YouGlish 發音搜尋", link: "https://youglish.com/", icon: "🎧", desc: "真實母語發音搜尋引擎" }
    ];

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
        init: (classConfig) => {
            const container = document.getElementById('resource-container');
            if (!container) return;

            let classResources = [];
            // 解析 classes.raw_data 內的班級資源
            if (classConfig && classConfig.raw_data) {
                let raw = classConfig.raw_data;
                if (typeof raw === 'string') {
                    try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
                }
                if (Array.isArray(raw.class_resources)) {
                    classResources = raw.class_resources;
                } else if (Array.isArray(raw.resources)) {
                    classResources = raw.resources;
                }
            }

            let html = '<div style="display:flex; flex-direction:column; gap:30px;">';
            
            // -----------------------------
            // 📚 區塊 1：班級專屬資源
            // -----------------------------
            html += '<div>';
            html += '<h3 style="color:#0F172A; border-bottom:2px solid #E2E8F0; padding-bottom:8px; display:flex; align-items:center; gap:8px;">📚 班級專屬資源</h3>';
            if (classResources.length > 0) {
                html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
                classResources.forEach(res => {
                    const icon = res.icon || '📂';
                    const title = res.title || res.name || '未命名資源';
                    const desc = res.desc || res.description || '';
                    const url = safeFormatUrl(res.url || res.link);
                    html += `
                        <a href="${url}" target="_blank" style="text-decoration:none; background:white; border:1px solid #E2E8F0; border-radius:12px; padding:15px; display:flex; gap:12px; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='#3B82F6';" onmouseout="this.style.transform='none'; this.style.borderColor='#E2E8F0';">
                            <div style="font-size:1.8rem; background:#F8FAFC; width:45px; height:45px; display:flex; align-items:center; justify-content:center; border-radius:8px;">${icon}</div>
                            <div>
                                <h4 style="margin:0 0 4px 0; color:#1E293B; font-size:1rem; font-weight:800;">${title} <span style="font-size:0.7rem; background:#EEF2FF; color:#4F46E5; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:6px;">班級</span></h4>
                                ${desc ? `<p style="margin:0; font-size:0.85rem; color:#64748B;">${desc}</p>` : ''}
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
            html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
            GLOBAL_RESOURCES.forEach(res => {
                const url = safeFormatUrl(res.link);
                html += `
                    <a href="${url}" target="_blank" style="text-decoration:none; background:white; border:1px solid #E2E8F0; border-radius:12px; padding:15px; display:flex; gap:12px; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.05);" onmouseover="this.style.transform='translateY(-2px)'; this.style.borderColor='#10B981';" onmouseout="this.style.transform='none'; this.style.borderColor='#E2E8F0';">
                        <div style="font-size:1.8rem; background:#ECFDF5; width:45px; height:45px; display:flex; align-items:center; justify-content:center; border-radius:8px;">${res.icon}</div>
                        <div>
                            <h4 style="margin:0 0 4px 0; color:#065F46; font-size:1rem; font-weight:800;">${res.title}</h4>
                            <p style="margin:0; font-size:0.85rem; color:#64748B;">${res.desc}</p>
                        </div>
                    </a>
                `;
            });
            html += '</div></div></div>';

            container.innerHTML = html;
        }
    };
})();
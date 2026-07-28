/**
 * 📂 檔案路徑：120_student_core/feature-student-resource.js
 * 學生課程資源：全域／班群／班級三層
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

    function scopeRank(scope) {
        if (scope === 'global') return 3;
        if (scope === 'teacher') return 2;
        return 1;
    }

    function mergeByUrl(list) {
        const map = new Map();
        (list || []).forEach(function (r) {
            const key = r.url && String(r.url).trim() !== '' ? String(r.url).trim() : r.id;
            if (!map.has(key)) map.set(key, r);
            else if (scopeRank(r.scope) > scopeRank(map.get(key).scope)) map.set(key, r);
        });
        return Array.from(map.values());
    }

    function cardHtml(res, badgeHtml, hoverBorder) {
        const icon = res.icon || '📁';
        const title = escapeHTML(res.name || '未命名資源');
        const url = safeFormatUrl(res.url);
        return ''
            + '<a href="' + url + '" target="_blank" style="text-decoration:none; background:white; border:1px solid #E2E8F0; border-radius:12px; padding:15px; display:flex; gap:12px; transition:0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.05);" '
            + 'onmouseover="this.style.transform=\'translateY(-2px)\'; this.style.borderColor=\'' + hoverBorder + '\';" '
            + 'onmouseout="this.style.transform=\'none\'; this.style.borderColor=\'#E2E8F0\';">'
            + '<div style="font-size:1.8rem; background:#F8FAFC; width:45px; height:45px; display:flex; align-items:center; justify-content:center; border-radius:8px;">' + icon + '</div>'
            + '<div>'
            + '<h4 style="margin:0 0 4px 0; color:#1E293B; font-size:1rem; font-weight:800;">' + title + ' ' + badgeHtml + '</h4>'
            + '<p style="margin:0; font-size:0.85rem; color:#64748B;">點擊前往雲端連結</p>'
            + '</div></a>';
    }

    async function loadResources(classId) {
        // 優先 RPC（含 teacher 班群）；失敗則 fallback 舊查詢
        try {
            const { data, error } = await window.supabaseClient.rpc('fetch_resources_for_class', {
                p_class_id: classId
            });
            if (!error) return data || [];
            console.warn('[StudentResource] RPC fallback:', error.message);
        } catch (err) {
            console.warn('[StudentResource] RPC unavailable:', err);
        }

        const { data: resData, error } = await window.supabaseClient
            .from('resources')
            .select('*')
            .is('deleted_at', null)
            .or('scope.eq.global,and(scope.eq.class,target_class_id.eq.' + classId + '),scope.eq.teacher');

        if (error) throw error;

        // client-side filter teacher by class_staff（若 RLS 允許）
        let staffIds = [];
        try {
            const { data: staff } = await window.supabaseClient
                .from('class_staff')
                .select('user_id')
                .eq('class_id', classId)
                .is('deleted_at', null);
            staffIds = (staff || []).map(function (s) { return s.user_id; });
        } catch (_e) { /* ignore */ }

        return (resData || []).filter(function (r) {
            if (r.scope === 'global') return true;
            if (r.scope === 'class' && r.target_class_id === classId) return true;
            if (r.scope === 'teacher') return staffIds.indexOf(r.owner_id) !== -1;
            return false;
        });
    }

    return {
        init: async (classConfig) => {
            const container = document.getElementById('resource-container');
            if (!container) return;

            if (!classConfig || !classConfig.id) {
                container.innerHTML = '<p style="color:#EF4444; font-weight:bold;">無法取得班級資訊，載入資源失敗。</p>';
                return;
            }

            container.innerHTML = '<div style="text-align:center; padding:40px; color:#94A3B8; font-weight:800;">⏳ 正在連線雲端擷取資源...</div>';

            try {
                const classId = classConfig.id;
                const merged = mergeByUrl(await loadResources(classId));

                const globalRes = merged.filter(function (r) { return r.scope === 'global'; });
                const teacherRes = merged.filter(function (r) { return r.scope === 'teacher'; });
                const classRes = merged.filter(function (r) { return r.scope === 'class'; });

                let html = '<div style="display:flex; flex-direction:column; gap:30px;">';

                html += '<div>';
                html += '<h3 style="color:#0F172A; border-bottom:2px solid #E2E8F0; padding-bottom:8px;">📚 班級專屬資源</h3>';
                if (classRes.length > 0) {
                    html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
                    classRes.forEach(function (res) {
                        html += cardHtml(res, '<span style="font-size:0.7rem; background:#EEF2FF; color:#4F46E5; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:6px;">班級</span>', '#3B82F6');
                    });
                    html += '</div>';
                } else {
                    html += '<p style="color:#94A3B8; font-weight:bold; background:#F8FAFC; padding:15px; border-radius:8px; text-align:center;">老師尚未新增班級專屬資源。</p>';
                }
                html += '</div>';

                html += '<div>';
                html += '<h3 style="color:#0F172A; border-bottom:2px solid #E2E8F0; padding-bottom:8px;">👥 班群資源</h3>';
                if (teacherRes.length > 0) {
                    html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
                    teacherRes.forEach(function (res) {
                        html += cardHtml(res, '<span style="font-size:0.7rem; background:#ECFDF5; color:#047857; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:6px;">班群</span>', '#10B981');
                    });
                    html += '</div>';
                } else {
                    html += '<p style="color:#94A3B8; font-weight:bold; background:#F8FAFC; padding:15px; border-radius:8px; text-align:center;">目前無班群資源。</p>';
                }
                html += '</div>';

                html += '<div>';
                html += '<h3 style="color:#0F172A; border-bottom:2px solid #E2E8F0; padding-bottom:8px;">🌍 全域共用資源</h3>';
                if (globalRes.length > 0) {
                    html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px;">';
                    globalRes.forEach(function (res) {
                        html += cardHtml(res, '', '#10B981');
                    });
                    html += '</div>';
                } else {
                    html += '<p style="color:#94A3B8; font-weight:bold; background:#F8FAFC; padding:15px; border-radius:8px; text-align:center;">目前無全域資源。</p>';
                }
                html += '</div></div>';

                container.innerHTML = html;
            } catch (err) {
                console.error('資源載入失敗:', err);
                container.innerHTML = '<p style="color:#EF4444; font-weight:bold;">😢 資源載入失敗，請稍後再試。<br><span style="font-size:0.8rem; color:#94A3B8;">' + escapeHTML(err.message) + '</span></p>';
            }
        }
    };
})();

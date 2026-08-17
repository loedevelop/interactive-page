/**
 * 📂 110_teacher_core/feature-review-records.js
 * 老師端複習紀錄（B）與複習測試計分欄（C）。
 * 不塞進課程進度作業格；Gadget 中心列表 + 進度頁獨立卡片。
 */
window.FeatureReviewRecords = (function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function classPolicy(classId) {
        const cls = (window.TeacherDB && Array.isArray(window.TeacherDB.classes))
            ? window.TeacherDB.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        return window.ReviewZone && typeof window.ReviewZone.parsePolicy === 'function'
            ? window.ReviewZone.parsePolicy(cls && (cls.raw_data || cls.rawData))
            : { enabled: false, teacher_can_view: false, test_counts_as_score: false };
    }

    async function fetchSessions(classId) {
        const { data, error } = await window.supabaseClient.rpc('list_review_sessions_for_class', {
            p_class_id: classId
        });
        if (error) throw error;
        return data || { visible: false, sessions: [] };
    }

    function formatWhen(iso) {
        if (!iso) return '—';
        return String(iso).replace('T', ' ').slice(0, 16);
    }

    function scoreText(result) {
        if (!result || result.score == null) return '—';
        return String(result.score) + '%';
    }

    function scoreColor(result) {
        const score = result && result.score;
        if (score == null) return '#94A3B8';
        if (score >= 80) return '#10B981';
        if (score >= 50) return '#F59E0B';
        return '#EF4444';
    }

    function renderTable(sessions) {
        if (!sessions.length) {
            return '<p style="color:#94A3B8; font-weight:700; margin:0;">目前沒有可見的複習紀錄。</p>';
        }
        const rows = sessions.map(function (s) {
            const mode = s.mode === 'practice' ? '練習' : '測試';
            const status = s.status === 'submitted' ? '已完成' : (s.status === 'active' ? '進行中' : s.status);
            const cfg = s.config || {};
            const range = (cfg.page_start != null && cfg.page_end != null)
                ? ('pp. ' + cfg.page_start + '～' + cfg.page_end)
                : '';
            return '<tr>'
                + '<td style="padding:8px; border:1px solid #E2E8F0; font-weight:800;">' + esc(s.student_name || '') + '</td>'
                + '<td style="padding:8px; border:1px solid #E2E8F0; text-align:center;">' + mode + '</td>'
                + '<td style="padding:8px; border:1px solid #E2E8F0;">' + esc(cfg.folder_name || '') + ' ' + esc(range) + '</td>'
                + '<td style="padding:8px; border:1px solid #E2E8F0; text-align:center; font-weight:900; color:' + scoreColor(s.result) + ';">' + esc(scoreText(s.result)) + '</td>'
                + '<td style="padding:8px; border:1px solid #E2E8F0; text-align:center;">' + esc(status) + (s.counts_as_score ? ' · 計分' : '') + '</td>'
                + '<td style="padding:8px; border:1px solid #E2E8F0; font-size:0.8rem; color:#64748B;">' + esc(formatWhen(s.submitted_at || s.created_at)) + '</td>'
                + '</tr>';
        }).join('');
        return '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.85rem;">'
            + '<thead><tr style="background:#F8FAFC; color:#334155;">'
            + '<th style="padding:8px; border:1px solid #E2E8F0; text-align:left;">學生</th>'
            + '<th style="padding:8px; border:1px solid #E2E8F0;">模式</th>'
            + '<th style="padding:8px; border:1px solid #E2E8F0; text-align:left;">教材／範圍</th>'
            + '<th style="padding:8px; border:1px solid #E2E8F0;">成績</th>'
            + '<th style="padding:8px; border:1px solid #E2E8F0;">狀態</th>'
            + '<th style="padding:8px; border:1px solid #E2E8F0;">時間</th>'
            + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderPanel(classId) {
        const pol = classPolicy(classId);
        if (!pol.enabled) {
            return '<div style="background:white; padding:18px 20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">'
                + '<h4 style="margin:0 0 8px; color:#0F766E;">📖 練習紀錄</h4>'
                + '<p style="margin:0; color:#94A3B8; font-weight:700;">此班尚未開放練習專區（班級設定可開啟）。</p></div>';
        }
        if (!pol.teacher_can_view && !pol.test_counts_as_score) {
            return '<div style="background:white; padding:18px 20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">'
                + '<h4 style="margin:0 0 8px; color:#0F766E;">📖 練習紀錄</h4>'
                + '<p style="margin:0; color:#94A3B8; font-weight:700;">老師目前看不到紀錄。若要查看，請在練習專區勾選「老師可看練習／測試紀錄」。</p></div>';
        }
        return '<div style="background:white; padding:18px 20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">'
            + '<h4 style="margin:0 0 10px; color:#0F766E;">📖 練習紀錄</h4>'
            + '<div id="review-records-body" style="color:#94A3B8; font-weight:700;">⏳ 載入中…</div></div>';
    }

    async function hydratePanel(classId) {
        const body = document.getElementById('review-records-body');
        if (!body) return;
        try {
            const pack = await fetchSessions(classId);
            if (!pack.visible) {
                body.innerHTML = '<p style="margin:0; color:#94A3B8; font-weight:700;">目前沒有權限查看。</p>';
                return;
            }
            body.innerHTML = renderTable(pack.sessions || []);
        } catch (err) {
            body.innerHTML = '<p style="margin:0; color:#B91C1C; font-weight:800;">載入失敗：' + esc(err.message || err) + '</p>';
        }
    }

    async function renderScoreCardIfNeeded(classId) {
        const slot = document.getElementById('progress-review-score-slot');
        if (!slot) return;
        const pol = classPolicy(classId);
        if (!pol.enabled || !pol.test_counts_as_score) {
            slot.innerHTML = '';
            return;
        }
        slot.innerHTML = '<div style="background:white; padding:18px 20px; border-radius:12px; border:2px solid #FED7AA; margin-top:16px;">'
            + '<h4 style="margin:0 0 8px; color:#C2410C;">📝 練習測試成績</h4>'
            + '<div id="review-score-body" style="color:#94A3B8; font-weight:700;">⏳ 載入中…</div></div>';
        try {
            const pack = await fetchSessions(classId);
            const tests = (pack.sessions || []).filter(function (s) {
                return s.mode === 'test' && s.counts_as_score && s.status === 'submitted';
            });
            const latestByStudent = {};
            tests.forEach(function (s) {
                const prev = latestByStudent[s.student_id];
                if (!prev || String(s.submitted_at || s.created_at) > String(prev.submitted_at || prev.created_at)) {
                    latestByStudent[s.student_id] = s;
                }
            });
            const list = Object.keys(latestByStudent).map(function (id) { return latestByStudent[id]; });
            const body = document.getElementById('review-score-body');
            if (!body) return;
            if (!list.length) {
                body.innerHTML = '<p style="margin:0; color:#94A3B8; font-weight:700;">還沒有計分的複習測試。</p>';
                return;
            }
            body.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:8px;">' + list.map(function (s) {
                return '<div style="padding:8px 12px; border:1px solid #FED7AA; border-radius:8px; background:#FFF7ED;">'
                    + '<div style="font-weight:900; color:#9A3412;">' + esc(s.student_name || '') + '</div>'
                    + '<div style="font-weight:900; color:' + scoreColor(s.result) + ';">' + esc(scoreText(s.result)) + '</div>'
                    + '<div style="font-size:0.75rem; color:#9A3412;">' + esc((s.config && s.config.folder_name) || '') + '</div>'
                    + '</div>';
            }).join('') + '</div>';
        } catch (err) {
            const body = document.getElementById('review-score-body');
            if (body) body.innerHTML = '<p style="margin:0; color:#B91C1C; font-weight:800;">載入失敗：' + esc(err.message || err) + '</p>';
        }
    }

    return {
        renderPanel: renderPanel,
        hydratePanel: hydratePanel,
        renderScoreCardIfNeeded: renderScoreCardIfNeeded
    };
})();

/**
 * 📂 檔案路徑：110_teacher_core/feature-gadget-center.js
 * 🎯 職責：「🧰 Gadget 中心」——考試出題單／考試批改／音檔切割工具／AI 補批的集中入口。
 *
 * 💣 雷區（見 .cursor/rules/teacher-tab-ia-invariant.mdc）：
 * 這裡只負責「掛載」四個既有功能模組的入口按鈕／面板，不重新實作它們的邏輯。
 * 新增工具時預設掛在這裡，禁止再疊回「班級進度總表」（那裡只該有唯讀報表＋家長提醒圖）。
 *
 * 資料來源：與「班級進度總表」共用 TeacherClassDataset（見 teacher-class-dataset.js），
 * 同一班級在快取有效期間內切換分頁不會重複打 API。
 */
window.FeatureGadgetCenter = (function () {
    'use strict';

    /** 避免快速切班/切分頁時，舊請求的結果蓋掉新畫面 */
    let renderSeq = 0;

    function resolveClassName(classId) {
        const classMeta = (window.TeacherDB && Array.isArray(window.TeacherDB.classes))
            ? window.TeacherDB.classes.find(function (c) { return String(c.id) === String(classId); })
            : null;
        return classMeta ? (classMeta.name || classMeta.class_name || '') : '';
    }

    // 🌟 與 feature-progress.js 的 getActionableTasks/parseAssignTasks 同語意：TeacherClassDataset
    // 回傳的是「原始 assignments」（未展平 group 子任務），這裡判斷是否含考試任務要自己展平一次，
    // 不能直接假設 a.actionableTasks 存在（那是 feature-progress.js renderGrid 內部才算的派生欄位）。
    function parseAssignTasks(rawTasks) {
        if (window.TaskScriptResolver && typeof window.TaskScriptResolver.parseTasks === 'function') {
            return window.TaskScriptResolver.parseTasks(rawTasks);
        }
        if (Array.isArray(rawTasks)) return rawTasks;
        if (typeof rawTasks === 'string') {
            try {
                const parsed = JSON.parse(rawTasks);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_e) {
                return [];
            }
        }
        return [];
    }

    function flattenTasks(tasksList) {
        let res = [];
        if (!tasksList) return res;
        tasksList.forEach(function (t) {
            if (t.type === 'group') {
                res = res.concat(flattenTasks(t.subTasks));
            } else {
                res.push(t);
            }
        });
        return res;
    }

    function anyAssignmentHasExamTask(assignments) {
        return (assignments || []).some(function (a) {
            return flattenTasks(parseAssignTasks(a.tasks)).some(function (t) { return t.type === 'exam'; });
        });
    }

    function renderCard(title, colorHex, bgHex, bodyHtml) {
        return '<div style="background:white; padding:18px 20px; border-radius:12px; border:2px solid #E2E8F0; margin-bottom:16px;">'
            + '<h4 style="margin:0 0 10px; color:' + colorHex + ';">' + title + '</h4>'
            + bodyHtml
            + '</div>';
    }

    function renderToolsSection(classId, className, assignments, completions, students, heavyReady) {
        const examJobHtml = (window.FeatureExamJob && typeof window.FeatureExamJob.renderEntryButton === 'function')
            ? window.FeatureExamJob.renderEntryButton(classId, assignments, className)
            : '';
        const hasExamTask = anyAssignmentHasExamTask(assignments);
        const examReviewHtml = (hasExamTask && window.FeatureExamReview && typeof window.FeatureExamReview.renderEntryButton === 'function')
            ? window.FeatureExamReview.renderEntryButton(classId)
            : '';
        const audioSplitHtml = (heavyReady && window.FeatureAudioSplitUpload && typeof window.FeatureAudioSplitUpload.renderEntryButton === 'function')
            ? window.FeatureAudioSplitUpload.renderEntryButton(classId, assignments, completions, students)
            : '';

        const buttons = [examJobHtml, examReviewHtml, audioSplitHtml].filter(Boolean).join('');
        const buttonsHtml = buttons || '<span style="color:#94A3B8; font-weight:700;">此班目前沒有可用的出題／批改工具（需先建立含考試或錄音任務的作業）。</span>';

        return renderCard('🛠️ 快捷工具', '#0F766E', '#F0FDFA',
            '<div style="display:flex; gap:10px; flex-wrap:wrap;">' + buttonsHtml + '</div>'
            + (heavyReady ? '' : '<div style="margin-top:8px; font-size:0.8rem; color:#94A3B8;">⏳ 音檔切割工具正在載入…</div>'));
    }

    function renderBackfillSection(classId, assignments, completions, students, heavyReady) {
        if (!heavyReady) {
            return '<div id="gadget-backfill-slot" style="padding:14px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; color:#92400E; font-weight:800;">⏳ 正在載入 AI 補批清單…</div>';
        }
        return (window.FeatureAIBackfill && typeof window.FeatureAIBackfill.renderPanel === 'function')
            ? window.FeatureAIBackfill.renderPanel(classId, assignments, completions, students)
            : '';
    }

    async function render(classId) {
        const container = document.getElementById('gadget-center-container');
        if (!container) return;

        if (!classId) {
            container.innerHTML = '<div style="padding:20px; color:#94A3B8;">請先選擇一個班級。</div>';
            return;
        }

        container.innerHTML = '<div style="padding:40px; text-align:center; color:var(--primary); font-weight:800; font-size:1.2rem;">⏳ 正在載入工具清單…</div>';

        const seq = ++renderSeq;
        const className = resolveClassName(classId);

        function paint(assignments, completions, students, heavyReady) {
            if (seq !== renderSeq) return;
            container.innerHTML = ''
                + renderToolsSection(classId, className, assignments, completions, students, heavyReady)
                + renderBackfillSection(classId, assignments, completions, students, heavyReady);
        }

        try {
            await window.TeacherClassDataset.load(classId, {
                onLight: function (light) {
                    paint(light.assignments, light.completions, light.students, false);
                },
                onHeavy: function (heavy) {
                    paint(heavy.assignments, heavy.completions, heavy.students, true);
                },
                onHeavyError: function () {
                    if (seq !== renderSeq) return;
                    const slot = document.getElementById('gadget-backfill-slot');
                    if (slot) {
                        slot.innerHTML = '<div style="padding:12px; color:#B45309; font-weight:800;">⚠️ AI 補批清單載入失敗，出題／批改按鈕仍可使用。可切換分頁後重新進入本頁重試。</div>';
                    }
                }
            });
        } catch (err) {
            console.error('[FeatureGadgetCenter] 載入失敗：', err);
            if (seq !== renderSeq) return;
            container.innerHTML = '<div style="padding:20px; color:#EF4444; font-weight:800;">❌ 載入失敗：' + err.message + '</div>';
        }
    }

    return {
        render: render
    };
})();

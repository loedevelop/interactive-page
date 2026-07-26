/**
 * 📂 110_teacher_core/feature-archived-classes.js
 * 已封存班級：瀏覽、複製、匯出、恢復、Admin 永久刪除
 */
window.FeatureArchivedClasses = (function () {
    'use strict';

    var cachedArchived = [];
    var archivedFetchPromise = null;
    var MODAL_ID = 'archived-class-modal';
    var BTN_SECONDARY = 'background:#F1F5F9;color:#1E293B;border:1px solid #CBD5E1;padding:6px 12px;border-radius:6px;font-size:0.85rem;font-weight:800;cursor:pointer;';
    var BTN_DANGER = 'background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;padding:6px 12px;border-radius:6px;font-size:0.85rem;font-weight:800;cursor:pointer;';
    var BTN_CANCEL = 'background:#F8FAFC;color:#475569;border:1px solid #CBD5E1;padding:8px 16px;border-radius:6px;font-weight:800;cursor:pointer;';
    var BTN_PRIMARY = 'background:var(--primary,#FF8C00);color:#fff;border:none;padding:8px 20px;border-radius:6px;font-weight:800;cursor:pointer;';

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function isAdminSession() {
        try {
            var session = JSON.parse(localStorage.getItem('LogOnEnglish_Session') || '{}');
            return session.role === 'admin' || (session.activeContext && session.activeContext.role === 'admin');
        } catch (_e) {
            return false;
        }
    }

    function formatDate(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString('zh-TW', { hour12: false });
        } catch (_e2) {
            return iso;
        }
    }

    function closeModal() {
        if (window.ModalOverlay) window.ModalOverlay.close(MODAL_ID);
    }

    function openModal(contentHtml, tier, options) {
        options = options || {};
        if (!window.ModalOverlay) {
            window.showFlash('ModalOverlay 未載入', 'error');
            return;
        }
        window.ModalOverlay.open({
            id: MODAL_ID,
            tier: tier || 'A',
            contentHtml: contentHtml,
            isDirty: options.isDirty,
            onCancel: options.onCancel,
            onMount: options.onMount
        });
    }

    function downloadJson(filename, data) {
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function getActiveClasses() {
        return (window.TeacherDB && window.TeacherDB.classes) ? window.TeacherDB.classes : [];
    }

    async function refreshArchivedCache() {
        if (!window.ApiService || typeof window.ApiService.fetchArchivedClasses !== 'function') {
            cachedArchived = [];
            return cachedArchived;
        }
        if (archivedFetchPromise) return archivedFetchPromise;
        archivedFetchPromise = window.ApiService.fetchArchivedClasses()
            .then(function (rows) {
                cachedArchived = rows || [];
                archivedFetchPromise = null;
                return cachedArchived;
            })
            .catch(function (err) {
                archivedFetchPromise = null;
                throw err;
            });
        return archivedFetchPromise;
    }

    function paintArchivedList(container) {
        var isAdmin = isAdminSession();
        if (cachedArchived.length === 0) {
            container.innerHTML = '<p style="color:#64748B;font-weight:700;padding:12px;">目前沒有已封存班級。</p>';
            return;
        }
        var html = cachedArchived.map(function (cls) {
            var adminBtn = isAdmin
                ? '<button type="button" class="btn" style="' + BTN_DANGER + 'padding:4px 10px;font-size:0.8rem;" onclick="window.FeatureArchivedClasses.openPurgeConfirm(\'' + cls.id + '\')">🗑 永久刪除</button>'
                : '';
            return '<div class="manage-list-item" style="padding:12px 0;border-bottom:1px dashed #E2E8F0;">'
                + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">'
                + '<div><span style="font-size:1.2rem;margin-right:8px;">' + escapeHtml(cls.icon || '📘') + '</span>'
                + '<strong style="color:#1E293B;">' + escapeHtml(cls.name) + '</strong>'
                + '<span style="margin-left:8px;font-size:0.8rem;color:#64748B;">封存於 ' + formatDate(cls.deleted_at) + '</span></div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:6px;">'
                + '<button type="button" class="btn" style="' + BTN_SECONDARY + 'padding:4px 10px;font-size:0.8rem;" onclick="window.FeatureArchivedClasses.browseClass(\'' + cls.id + '\')">👁 瀏覽</button>'
                + '<button type="button" class="btn" style="' + BTN_SECONDARY + 'padding:4px 10px;font-size:0.8rem;" onclick="window.FeatureArchivedClasses.cloneClassAsNew(\'' + cls.id + '\')">📋 複製整班</button>'
                + '<button type="button" class="btn" style="' + BTN_SECONDARY + 'padding:4px 10px;font-size:0.8rem;" onclick="window.FeatureArchivedClasses.exportClass(\'' + cls.id + '\')">📤 匯出</button>'
                + '<button type="button" class="btn" style="' + BTN_SECONDARY + 'padding:4px 10px;font-size:0.8rem;" onclick="window.FeatureArchivedClasses.restoreClass(\'' + cls.id + '\')">↩ 恢復</button>'
                + adminBtn
                + '</div></div></div>';
        }).join('');
        container.innerHTML = html;
    }

    function renderBrowseModal(cls, assignments) {
        var rows = (assignments || []).map(function (a) {
            var taskCount = Array.isArray(a.tasks) ? a.tasks.length : 0;
            return '<tr style="border-bottom:1px solid #E2E8F0;">'
                + '<td style="padding:8px;font-weight:700;">' + escapeHtml(a.title) + '</td>'
                + '<td style="padding:8px;">' + escapeHtml(a.target_date || '—') + '</td>'
                + '<td style="padding:8px;">' + taskCount + '</td>'
                + '<td style="padding:8px;white-space:nowrap;">'
                + '<button type="button" class="btn" style="' + BTN_SECONDARY + 'padding:4px 8px;font-size:0.8rem;margin-right:4px;" onclick="window.FeatureArchivedClasses.copyAssignmentPrompt(\'' + cls.id + '\',\'' + a.id + '\')">📋 複製</button>'
                + '<button type="button" class="btn" style="' + BTN_SECONDARY + 'padding:4px 8px;font-size:0.8rem;" onclick="window.FeatureArchivedClasses.exportAssignment(\'' + cls.id + '\',\'' + a.id + '\')">📤 匯出</button>'
                + '</td></tr>';
        }).join('');

        if (!rows) {
            rows = '<tr><td colspan="4" style="padding:16px;color:#64748B;text-align:center;">此班尚無作業紀錄</td></tr>';
        }

        openModal(
            '<div style="background:white;padding:24px;border-radius:12px;width:95%;max-width:720px;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.2);">'
            + '<h3 style="margin:0 0 8px;color:#1E293B;">👁 封存班瀏覽（唯讀）</h3>'
            + '<div style="margin-bottom:16px;font-weight:800;color:#334155;">' + escapeHtml(cls.icon || '📘') + ' ' + escapeHtml(cls.name) + '</div>'
            + '<table style="width:100%;border-collapse:collapse;font-size:0.9rem;color:#1E293B;">'
            + '<thead><tr style="background:#F8FAFC;text-align:left;color:#334155;"><th style="padding:8px;">作業</th><th style="padding:8px;">日期</th><th style="padding:8px;">任務數</th><th style="padding:8px;">操作</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;border-top:1px solid #E2E8F0;padding-top:16px;">'
            + '<button type="button" class="btn" style="' + BTN_SECONDARY + '" onclick="window.FeatureArchivedClasses.exportClass(\'' + cls.id + '\')">📤 匯出整班 JSON</button>'
            + '<button type="button" class="btn" style="' + BTN_CANCEL + '" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')">關閉</button>'
            + '</div></div>',
            'A'
        );
    }

    async function browseClass(classId) {
        var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return window.showFlash('找不到封存班級', 'error');
        try {
            var assignments = await window.ApiService.fetchArchivedClassAssignments(classId);
            window._archivedBrowseAssignments = {};
            assignments.forEach(function (a) { window._archivedBrowseAssignments[a.id] = a; });
            renderBrowseModal(cls, assignments);
        } catch (err) {
            window.showFlash(err.message, 'error');
        }
    }

    async function copyAssignmentPrompt(classId, assignmentId) {
        var source = window._archivedBrowseAssignments && window._archivedBrowseAssignments[assignmentId];
        if (!source) {
            try {
                var list = await window.ApiService.fetchArchivedClassAssignments(classId);
                source = list.find(function (a) { return String(a.id) === String(assignmentId); });
            } catch (_e) {}
        }
        if (!source) return window.showFlash('找不到作業', 'error');

        var active = getActiveClasses();
        if (active.length === 0) return window.showFlash('請先建立或恢復一個作用中班級', 'error');

        var optionsHtml = active.map(function (c) {
            return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        }).join('');

        openModal(
            '<div style="background:white;padding:24px;border-radius:12px;width:95%;max-width:480px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">'
            + '<h3 style="margin:0 0 12px;">📋 複製作業到現有班</h3>'
            + '<p style="color:#64748B;font-size:0.9rem;margin:0 0 16px;">來源：' + escapeHtml(source.title) + '</p>'
            + '<label style="display:block;font-weight:700;margin-bottom:6px;">目標班級</label>'
            + '<select id="arch-copy-target-class" class="form-control" style="width:100%;margin-bottom:12px;">' + optionsHtml + '</select>'
            + '<label style="display:block;font-weight:700;margin-bottom:6px;">目標日期</label>'
            + '<input type="date" id="arch-copy-target-date" class="form-control" style="width:100%;margin-bottom:20px;" value="' + (window.UtilsDate ? window.UtilsDate.getTaiwanTodayString() : '') + '">'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
            + '<button type="button" class="btn" style="' + BTN_CANCEL + '" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')">取消</button>'
            + '<button type="button" class="btn btn-primary" style="' + BTN_PRIMARY + '" id="btn-arch-copy-assign">確認複製</button>'
            + '</div></div>',
            'A',
            {
                onMount: function () {
                    var btn = document.getElementById('btn-arch-copy-assign');
                    if (!btn) return;
                    btn.onclick = async function () {
                        var targetClassId = document.getElementById('arch-copy-target-class').value;
                        var targetDate = document.getElementById('arch-copy-target-date').value;
                        if (!targetDate) return window.showFlash('請選擇日期', 'error');
                        btn.disabled = true;
                        btn.textContent = '⏳ 複製中…';
                        try {
                            await copyAssignmentToClass(source, targetClassId, targetDate);
                            closeModal();
                            window.showFlash('作業已複製到目標班級');
                        } catch (err) {
                            window.showFlash(err.message, 'error');
                            btn.disabled = false;
                            btn.textContent = '確認複製';
                        }
                    };
                }
            }
        );
    }

    async function copyAssignmentToClass(sourceAssignment, targetClassId, targetDate) {
        if (!window.AssignmentClone) throw new Error('AssignmentClone 未載入');
        var normalizedDate = window.UtilsDate ? window.UtilsDate.normalizeDateString(targetDate) : targetDate;
        var cloned = window.AssignmentClone.cloneAssignmentRecord(sourceAssignment);
        var payload = window.AssignmentClone.buildInsertPayload(cloned, targetClassId, normalizedDate);
        var inserted = await window.ApiService.insertAssignment(payload);
        if (window.TeacherDB && window.TeacherDB.assignments) {
            window.TeacherDB.assignments.unshift(Object.assign({}, inserted, {
                raw_data: payload.raw_data,
                tasks: payload.tasks
            }));
            if (typeof window.TeacherDB.save === 'function') window.TeacherDB.save();
        }
        return inserted;
    }

    async function performCloneClassAsNew(classId) {
        var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return window.showFlash('找不到封存班級', 'error');

        try {
            var assignments = await window.ApiService.fetchArchivedClassAssignments(classId);
            var session = JSON.parse(localStorage.getItem('LogOnEnglish_Session') || '{}');
            var userRes = await window.supabaseClient.auth.getUser();
            var user = userRes.data.user;
            if (!user) throw new Error('無法取得登入狀態');

            var classYear = window.UtilsDate ? window.UtilsDate.getTaiwanTodayString().slice(0, 4) : String(new Date().getFullYear());
            var safeBaseName = String(cls.name || '班級').replace(/[\\/:*?"<>|]/g, '_').trim();
            var newName = safeBaseName + '_copy';
            var folderId = '';

            if (window.ApiService && typeof window.ApiService.createGASFolder === 'function') {
                var folderRes = await window.ApiService.createGASFolder(newName + '_' + classYear, null, false, null, {
                    rootPath: ['_LogOnEnglish', '_Classes']
                });
                folderId = folderRes.folderId;
                var subs = ['00_Material_Masters', '01_Class_Resources', '02_Students'];
                await Promise.all(subs.map(function (sub) {
                    return window.ApiService.createGASFolder(sub, folderId);
                }));
            }

            var rawCopy = window.AssignmentClone ? window.AssignmentClone.cloneClassRawData(cls.raw_data) : {};
            rawCopy.drive_folder_id = folderId;
            rawCopy.drive_layout = 'v2';

            var { data: newClass, error: classError } = await window.supabaseClient.from('classes').insert([{
                name: newName,
                icon: cls.icon || '📘',
                calc_mode: cls.calc_mode || 'single',
                meet_days: cls.meet_days || [],
                raw_data: rawCopy
            }]).select().single();
            if (classError) throw classError;

            await window.supabaseClient.from('class_staff').insert([{
                class_id: newClass.id,
                user_id: user.id,
                staff_role: 'primary_teacher'
            }]);

            for (var i = 0; i < assignments.length; i++) {
                var a = assignments[i];
                var cloned = window.AssignmentClone.cloneAssignmentRecord(a);
                var payload = window.AssignmentClone.buildInsertPayload(cloned, newClass.id, a.target_date || classYear + '-01-01');
                await window.ApiService.insertAssignment(payload);
            }

            if (window.ApiService.fetchClasses) {
                window.TeacherDB.classes = await window.ApiService.fetchClasses();
            }
            if (window.TeacherDB.assignments && window.ApiService.fetchAssignments) {
                window.TeacherDB.assignments = await window.ApiService.fetchAssignments(user.id);
            }
            if (typeof window.TeacherDB.save === 'function') window.TeacherDB.save();
            if (window.TeacherUI) {
                window.TeacherUI.renderSidebar();
                window.TeacherUI.activateClassView(newClass.id);
            }
            if (window.FeatureClass && typeof window.FeatureClass.renderClassManager === 'function') {
                window.FeatureClass.renderClassManager({ forceArchived: false });
            }
            window.showFlash('已建立新班級「' + newName + '」');
        } catch (err) {
            window.showFlash('複製整班失敗：' + err.message, 'error');
        }
    }

    async function exportClass(classId) {
        try {
            var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
            var assignments = await window.ApiService.fetchArchivedClassAssignments(classId);
            downloadJson('archived-class-' + classId + '.json', {
                exported_at: new Date().toISOString(),
                class: cls,
                assignments: assignments
            });
        } catch (err) {
            window.showFlash('匯出失敗：' + err.message, 'error');
        }
    }

    async function exportAssignment(classId, assignmentId) {
        try {
            var list = window._archivedBrowseAssignments
                ? Object.values(window._archivedBrowseAssignments)
                : await window.ApiService.fetchArchivedClassAssignments(classId);
            var a = list.find(function (x) { return String(x.id) === String(assignmentId); });
            if (!a) throw new Error('找不到作業');
            downloadJson('archived-assignment-' + assignmentId + '.json', a);
        } catch (err) {
            window.showFlash('匯出失敗：' + err.message, 'error');
        }
    }

    function cloneClassAsNew(classId) {
        var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return window.showFlash('找不到封存班級', 'error');
        openModal(
            '<div style="background:white;padding:24px;border-radius:12px;width:95%;max-width:480px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">'
            + '<h3 style="margin:0 0 12px;color:#1E293B;">📋 複製整班為新班</h3>'
            + '<p style="color:#475569;line-height:1.6;">將以 <strong>' + escapeHtml(cls.icon || '📘') + ' ' + escapeHtml(cls.name) + '</strong> 為範本建立新班級。<br>含作業模板，不含學生與成績。</p>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">'
            + '<button type="button" class="btn" style="' + BTN_CANCEL + '" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')">取消</button>'
            + '<button type="button" class="btn btn-primary" style="' + BTN_PRIMARY + '" id="btn-clone-class">確認複製</button>'
            + '</div></div>',
            'A',
            {
                onMount: function () {
                    var btn = document.getElementById('btn-clone-class');
                    if (!btn) return;
                    btn.onclick = async function () {
                        btn.disabled = true;
                        btn.textContent = '⏳ 複製中…';
                        closeModal();
                        await performCloneClassAsNew(classId);
                    };
                }
            }
        );
    }

    async function performRestoreClass(classId) {
        var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
        var restoredName = cls ? cls.name : '班級';
        try {
            await window.ApiService.restoreClass(classId);
            if (window.ApiService.fetchClasses) {
                window.TeacherDB.classes = await window.ApiService.fetchClasses();
            }
            if (typeof window.TeacherDB.save === 'function') window.TeacherDB.save();
            if (window.FeatureClass && typeof window.FeatureClass.renderClassManager === 'function') {
                window.FeatureClass.renderClassManager({ forceArchived: true });
            } else {
                await renderSection({ force: true });
            }
            if (window.TeacherUI) window.TeacherUI.renderSidebar();
            window.showFlash('已恢復班級「' + restoredName + '」');
        } catch (err) {
            window.showFlash(err.message, 'error');
        }
    }

    function restoreClass(classId) {
        var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return;
        openModal(
            '<div style="background:white;padding:24px;border-radius:12px;width:95%;max-width:480px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">'
            + '<h3 style="margin:0 0 12px;color:#10B981;">↩ 恢復班級</h3>'
            + '<p style="color:#475569;line-height:1.6;">確定恢復班級 <strong>' + escapeHtml(cls.icon || '📘') + ' ' + escapeHtml(cls.name) + '</strong>？<br>恢復後將回到「現有班級清單」並可繼續使用。</p>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">'
            + '<button type="button" class="btn" style="' + BTN_CANCEL + '" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')">取消</button>'
            + '<button type="button" class="btn btn-primary" style="' + BTN_PRIMARY + '" id="btn-restore-class">確認恢復</button>'
            + '</div></div>',
            'A',
            {
                onMount: function () {
                    var btn = document.getElementById('btn-restore-class');
                    if (!btn) return;
                    btn.onclick = async function () {
                        btn.disabled = true;
                        btn.textContent = '⏳ 恢復中…';
                        closeModal();
                        await performRestoreClass(classId);
                    };
                }
            }
        );
    }

    function openPurgeConfirm(classId) {
        var cls = cachedArchived.find(function (c) { return String(c.id) === String(classId); });
        if (!cls) return;
        openModal(
            '<div style="background:white;padding:24px;border-radius:12px;width:95%;max-width:480px;box-shadow:0 10px 25px rgba(0,0,0,0.2);">'
            + '<h3 style="margin:0 0 12px;color:#DC2626;">🗑 永久刪除（Admin）</h3>'
            + '<p style="color:#7F1D1D;">將從封存清單移除：<strong>' + escapeHtml(cls.name) + '</strong><br>此操作無法從介面還原。</p>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">'
            + '<button type="button" class="btn" style="' + BTN_CANCEL + '" onclick="window.ModalOverlay.close(\'' + MODAL_ID + '\')">取消</button>'
            + '<button type="button" class="btn btn-danger" style="' + BTN_DANGER + '" id="btn-purge-class">確認永久刪除</button>'
            + '</div></div>',
            'A',
            {
                onMount: function () {
                    var btn = document.getElementById('btn-purge-class');
                    if (!btn) return;
                    btn.onclick = async function () {
                        btn.disabled = true;
                        try {
                            await window.ApiService.purgeClassPermanent(classId);
                            closeModal();
                            await renderSection({ force: true });
                            window.showFlash('已永久刪除封存紀錄');
                        } catch (err) {
                            window.showFlash(err.message, 'error');
                            btn.disabled = false;
                        }
                    };
                }
            }
        );
    }

    function formatArchivedLoadError(err) {
        var msg = err && err.message ? err.message : String(err);
        if (msg.indexOf('list_archived_classes') !== -1 || msg.indexOf('schema cache') !== -1) {
            return '封存功能尚未部署到雲端。請管理員在 Supabase 執行 migration：20260726120000_archived_classes_rpc.sql';
        }
        return '無法載入封存班級：' + escapeHtml(msg);
    }

    async function renderSection(options) {
        options = options || {};
        var container = document.getElementById('archived-class-list-container');
        if (!container) return;

        var hadCache = cachedArchived.length > 0;
        if (hadCache) paintArchivedList(container);

        if (!options.force && hadCache && !options.background) return;

        if (!hadCache) {
            container.innerHTML = '<p style="color:#64748B;padding:12px;">⏳ 載入封存班級…</p>';
        }

        try {
            await refreshArchivedCache();
            paintArchivedList(container);
        } catch (err) {
            if (!hadCache) {
                container.innerHTML = '<p style="color:#DC2626;padding:12px;line-height:1.6;">❌ ' + formatArchivedLoadError(err) + '</p>';
            } else {
                window.showFlash('封存列表更新失敗', 'error');
            }
        }
    }

    return {
        renderSection: renderSection,
        browseClass: browseClass,
        copyAssignmentPrompt: copyAssignmentPrompt,
        copyAssignmentToClass: copyAssignmentToClass,
        cloneClassAsNew: cloneClassAsNew,
        exportClass: exportClass,
        exportAssignment: exportAssignment,
        restoreClass: restoreClass,
        openPurgeConfirm: openPurgeConfirm
    };
})();

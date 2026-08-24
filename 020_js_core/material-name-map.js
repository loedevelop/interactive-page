/**
 * 📂 020_js_core/material-name-map.js
 * 教材／範本對照中心：UUID 才是身分，名稱只是現用標籤。
 *
 * 改名＝UPDATE 現用欄 + 舊名寫進 material_name_maps。
 * 讀取＝現用名對不到時，用舊名 resolve 回同一 UUID／現用名。
 * 禁止把檔名當主鍵、禁止改名時 delete+insert。
 */
window.MaterialNameMap = (function () {
    'use strict';

    const KINDS = ['folder', 'source_file', 'sheet_stem', 'meta_file', 'script_file', 'template'];

    let _rows = null;
    let _loadPromise = null;

    function norm(s) {
        return String(s == null ? '' : s).trim();
    }

    function upper(s) {
        return norm(s).toUpperCase();
    }

    function isUuidLike(v) {
        return typeof v === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    }

    async function getUserId() {
        if (!window.supabaseClient) return null;
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        return user ? user.id : null;
    }

    async function ensureLoaded(force) {
        if (_rows && !force) return _rows;
        if (_loadPromise && !force) return _loadPromise;
        _loadPromise = (async function () {
            const uid = await getUserId();
            if (!uid) {
                _rows = _rows || [];
                return _rows;
            }
            const { data, error } = await window.supabaseClient
                .from('material_name_maps')
                .select('id, teacher_id, material_folder_id, material_sheet_id, material_template_id, kind, alias, current_label');
            if (error) {
                console.warn('[MaterialNameMap] 讀取對照失敗', error);
                _rows = _rows || [];
                return _rows;
            }
            _rows = data || [];
            return _rows;
        })().finally(function () { _loadPromise = null; });
        return _loadPromise;
    }

    function rowsSync() {
        if (_rows === null && !_loadPromise) {
            ensureLoaded(false).catch(function () {});
        }
        return _rows || [];
    }

    function findRows(kind, alias) {
        const u = upper(alias);
        if (!u) return [];
        return rowsSync().filter(function (r) {
            return r.kind === kind && upper(r.alias) === u;
        });
    }

    function resolve(kind, alias) {
        const hits = findRows(kind, alias);
        if (!hits.length) return null;
        const r = hits[0];
        return {
            kind: r.kind,
            alias: r.alias,
            currentLabel: r.current_label || '',
            materialFolderId: r.material_folder_id || '',
            materialSheetId: r.material_sheet_id || '',
            materialTemplateId: r.material_template_id || ''
        };
    }

    function currentLabel(kind, alias) {
        const hit = resolve(kind, alias);
        return hit && hit.currentLabel ? hit.currentLabel : '';
    }

    /** 活頁別稱只認這一列（sheet id）。不准只靠活頁名去共用。 */
    function currentLabelForSheet(kind, alias, sheetId) {
        const sid = String(sheetId || '').trim();
        if (!sid) return '';
        const u = upper(alias);
        if (!u) return '';
        const hit = rowsSync().find(function (r) {
            return r.kind === kind
                && upper(r.alias) === u
                && String(r.material_sheet_id || '') === sid;
        });
        return hit && hit.current_label ? String(hit.current_label).trim() : '';
    }

    /** 資料夾現用名：舊名對到別名就回現用標籤，否則原字。未套用的雲端夾清單不要用這個去合併。 */
    function resolveFolderName(name) {
        const n = norm(name);
        if (!n) return '';
        const current = currentLabel('folder', n);
        return current || n;
    }

    function pushUnique(out, s) {
        const t = norm(s);
        if (!t) return;
        if (out.every(function (x) { return upper(x) !== upper(t); })) out.push(t);
    }

    /** 查詢用：原字串 + 對照到的現用名（不複製整份資料，只給呼叫端當額外 key） */
    function lookupKeys(kind, alias) {
        const out = [];
        pushUnique(out, alias);
        const hit = resolve(kind, alias);
        if (hit) pushUnique(out, hit.currentLabel);
        return out;
    }

    function namesMatch(a, b) {
        const ua = upper(a);
        const ub = upper(b);
        if (!ua || !ub) return false;
        if (ua === ub) return true;
        const kinds = ['sheet_stem', 'meta_file', 'script_file', 'folder', 'source_file', 'template'];
        for (let i = 0; i < kinds.length; i++) {
            const keys = lookupKeys(kinds[i], a);
            for (let j = 0; j < keys.length; j++) {
                if (upper(keys[j]) === ub) return true;
            }
        }
        return false;
    }

    function resolveTemplateId(nameOrId) {
        const raw = norm(nameOrId);
        if (!raw) return '';
        if (isUuidLike(raw)) return raw;
        const hit = resolve('template', raw);
        return hit && hit.materialTemplateId ? String(hit.materialTemplateId) : '';
    }

    async function recordAlias(opts) {
        const uid = await getUserId();
        if (!uid) throw new Error('尚未登入');
        const kind = norm(opts && opts.kind);
        const alias = norm(opts && opts.alias);
        const nextLabel = norm(opts && opts.currentLabel);
        if (KINDS.indexOf(kind) === -1) throw new Error('未知的對照種類：' + kind);
        if (!alias) return null;
        if (nextLabel && upper(alias) === upper(nextLabel)) return null;

        const payload = {
            teacher_id: uid,
            kind: kind,
            alias: alias,
            current_label: nextLabel || null,
            material_folder_id: (opts && opts.materialFolderId) || null,
            material_sheet_id: (opts && opts.materialSheetId) || null,
            material_template_id: (opts && opts.materialTemplateId) || null
        };

        if (kind === 'template') {
            if (!payload.material_template_id) throw new Error('範本對照缺少 template id');
            payload.material_folder_id = null;
            payload.material_sheet_id = null;
        } else if (kind === 'sheet_stem' || kind === 'meta_file' || kind === 'script_file') {
            if (!payload.material_folder_id || !payload.material_sheet_id) {
                throw new Error('活頁對照缺少 folder／sheet id');
            }
        } else if (!payload.material_folder_id) {
            throw new Error('資料夾對照缺少 folder id');
        }

        await ensureLoaded(false);
        const existing = rowsSync().find(function (r) {
            if (r.kind !== kind || upper(r.alias) !== upper(alias)) return false;
            if (kind === 'template') return String(r.teacher_id) === String(uid);
            if (kind === 'sheet_stem' || kind === 'meta_file' || kind === 'script_file') {
                return String(r.material_sheet_id || '') === String(payload.material_sheet_id || '')
                    && String(r.material_folder_id || '') === String(payload.material_folder_id || '');
            }
            return String(r.material_folder_id) === String(payload.material_folder_id);
        });

        if (existing) {
            const { error } = await window.supabaseClient
                .from('material_name_maps')
                .update({
                    current_label: payload.current_label,
                    material_sheet_id: payload.material_sheet_id,
                    material_template_id: payload.material_template_id
                })
                .eq('id', existing.id);
            if (error) throw error;
            existing.current_label = payload.current_label;
            existing.material_sheet_id = payload.material_sheet_id;
            existing.material_template_id = payload.material_template_id;
            return existing;
        }

        const { data, error } = await window.supabaseClient
            .from('material_name_maps')
            .insert(payload)
            .select('id, teacher_id, material_folder_id, material_sheet_id, material_template_id, kind, alias, current_label')
            .single();
        if (error) {
            if (error.code === '23505') {
                await ensureLoaded(true);
                const again = rowsSync().find(function (r) {
                    if (r.kind !== kind || upper(r.alias) !== upper(alias)) return false;
                    if (kind === 'template') return String(r.teacher_id) === String(uid);
                    if (kind === 'sheet_stem' || kind === 'meta_file' || kind === 'script_file') {
                        return String(r.material_sheet_id || '') === String(payload.material_sheet_id || '');
                    }
                    return String(r.material_folder_id) === String(payload.material_folder_id);
                });
                if (again) return recordAlias(opts);
                throw new Error('活頁別稱不能再只靠活頁名共用。請先在 Supabase 跑 20260821210000_material_name_maps_sheet_alias_unique.sql');
            }
            throw error;
        }
        _rows = (_rows || []).concat([data]);
        return data;
    }

    async function retargetCurrentLabel(kind, targetKey, targetId, nextLabel) {
        const next = norm(nextLabel);
        if (!next) return;
        await ensureLoaded(false);
        const others = rowsSync().filter(function (r) {
            return r.kind === kind && String(r[targetKey] || '') === String(targetId);
        });
        for (let i = 0; i < others.length; i++) {
            if (upper(others[i].current_label || '') === upper(next)) continue;
            const { error } = await window.supabaseClient
                .from('material_name_maps')
                .update({ current_label: next })
                .eq('id', others[i].id);
            if (error) throw error;
            others[i].current_label = next;
        }
    }

    async function recordFolderRename(folderId, oldName, newName) {
        const prev = norm(oldName);
        const next = norm(newName);
        if (!folderId || !prev || !next || upper(prev) === upper(next)) return;
        await recordAlias({
            kind: 'folder',
            alias: prev,
            currentLabel: next,
            materialFolderId: folderId
        });
        await retargetCurrentLabel('folder', 'material_folder_id', folderId, next);
    }

    async function recordTemplateRename(templateId, oldName, newName) {
        const prev = norm(oldName);
        const next = norm(newName);
        if (!templateId || !prev || !next || upper(prev) === upper(next)) return;
        await recordAlias({
            kind: 'template',
            alias: prev,
            currentLabel: next,
            materialTemplateId: templateId
        });
        await retargetCurrentLabel('template', 'material_template_id', templateId, next);
    }

    async function recordSheetRename(opts) {
        const folderId = opts && opts.folderId;
        const sheetId = opts && opts.sheetId;
        if (!folderId || !sheetId) throw new Error('改名缺少活頁 id');

        async function one(kind, oldN, newN) {
            const a = norm(oldN);
            const b = norm(newN);
            if (!a || !b || upper(a) === upper(b)) return;
            await recordAlias({
                kind: kind,
                alias: a,
                currentLabel: b,
                materialFolderId: folderId,
                materialSheetId: sheetId
            });
            await retargetCurrentLabel(kind, 'material_sheet_id', sheetId, b);
        }

        await one('sheet_stem', opts.oldStem, opts.newStem);
        await one('meta_file', opts.oldMeta, opts.newMeta);
        await one('script_file', opts.oldScript, opts.newScript);
    }

    /**
     * 別稱／現用標籤若只是「活頁名.這份擷取範本」，改回活頁名。
     * 老師自己寫的別稱（不是這份範本後綴）不動。
     */
    async function unpoisonSheetLabels(opts) {
        const sheetId = norm(opts && opts.sheetId);
        const live = norm(opts && opts.live);
        const templateName = norm(opts && opts.templateName);
        if (!sheetId || !live) return;
        const FN = window.MaterialFileNames;
        function poisoned(s) {
            if (FN && typeof FN.isPoisonedLiveAlias === 'function') {
                return FN.isPoisonedLiveAlias(s, live, templateName);
            }
            const tpl = String(templateName || '').trim().replace(/[\\/]/g, '-');
            return !!(tpl && upper(s) === upper(live + '.' + tpl));
        }
        await ensureLoaded(false);
        const mine = rowsSync().filter(function (r) {
            return r.kind === 'sheet_stem' && String(r.material_sheet_id || '') === sheetId;
        });
        for (let i = 0; i < mine.length; i++) {
            const r = mine[i];
            if (!poisoned(r.current_label)) continue;
            const { error } = await window.supabaseClient
                .from('material_name_maps')
                .update({ current_label: live })
                .eq('id', r.id);
            if (error) throw error;
            r.current_label = live;
        }
    }

    async function applySheetCurrentNames(opts) {
        const sheetId = opts && opts.sheetId;
        const folderId = opts && opts.folderId;
        if (!sheetId || !folderId) throw new Error('找不到這本活頁');
        const { data: cur, error: readErr } = await window.supabaseClient
            .from('material_sheets')
            .select('id, material_folder_id, sheet_stem, meta_file_name, script_file_name')
            .eq('id', sheetId)
            .single();
        if (readErr) throw readErr;
        const nextStem = opts.sheetStem != null ? norm(opts.sheetStem) : (cur.sheet_stem || '');
        const nextMeta = opts.metaFileName != null ? norm(opts.metaFileName) : (cur.meta_file_name || '');
        const nextScript = opts.scriptFileName != null ? norm(opts.scriptFileName) : (cur.script_file_name || '');
        if (!nextStem) throw new Error('活頁名不能空白');
        const payload = { updated_at: new Date().toISOString() };
        if (opts.sheetStem != null) payload.sheet_stem = nextStem;
        if (opts.metaFileName != null) payload.meta_file_name = nextMeta || null;
        if (opts.scriptFileName != null) payload.script_file_name = nextScript || null;
        const { error } = await window.supabaseClient
            .from('material_sheets')
            .update(payload)
            .eq('id', sheetId);
        if (error) throw error;
        await recordSheetRename({
            folderId: folderId,
            sheetId: sheetId,
            oldStem: cur.sheet_stem,
            newStem: nextStem,
            oldMeta: cur.meta_file_name,
            newMeta: nextMeta,
            oldScript: cur.script_file_name,
            newScript: nextScript
        });
    }

    /**
     * 快取物件的 key 若是舊名，改掛到現用名（搬移、不複製內容）。
     * 現用 key 已有值時只刪舊 key，避免 meta_rows_by_stem 雙份膨脹。
     */
    function rewriteCacheKey(map, kind, oldKey) {
        if (!map || typeof map !== 'object') return oldKey;
        const raw = norm(oldKey);
        if (!raw || !Object.prototype.hasOwnProperty.call(map, raw)) return raw;
        const next = currentLabel(kind, raw);
        if (!next || upper(next) === upper(raw)) return raw;
        if (!Object.prototype.hasOwnProperty.call(map, next)) {
            map[next] = map[raw];
        }
        delete map[raw];
        return next;
    }

    return {
        KINDS: KINDS,
        ensureLoaded: ensureLoaded,
        resolve: resolve,
        currentLabel: currentLabel,
        currentLabelForSheet: currentLabelForSheet,
        resolveFolderName: resolveFolderName,
        lookupKeys: lookupKeys,
        namesMatch: namesMatch,
        resolveTemplateId: resolveTemplateId,
        recordAlias: recordAlias,
        recordFolderRename: recordFolderRename,
        recordTemplateRename: recordTemplateRename,
        recordSheetRename: recordSheetRename,
        unpoisonSheetLabels: unpoisonSheetLabels,
        applySheetCurrentNames: applySheetCurrentNames,
        rewriteCacheKey: rewriteCacheKey
    };
})();

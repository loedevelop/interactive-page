/**
 * 📂 020_js_core/review-zone.js
 * 班級 raw_data.review_zone 政策讀寫（老師設定／學生活頁共用）
 */
window.ReviewZone = (function () {
    'use strict';

    function parseRaw(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try { return JSON.parse(raw) || {}; } catch (_e) { return {}; }
        }
        return raw;
    }

    function folderKey(folderName) {
        const raw = String(folderName || '').trim();
        const resolved = (window.MaterialNameMap && typeof window.MaterialNameMap.resolveFolderName === 'function')
            ? window.MaterialNameMap.resolveFolderName(raw) : raw;
        return String(resolved || raw).toUpperCase();
    }

    function sheetKey(folderName, sheetStem) {
        const stem = String(sheetStem || '').trim().toUpperCase().replace(/\.META\.JSON$/i, '');
        if (!stem) return folderKey(folderName);
        return folderKey(folderName) + '|' + stem;
    }

    function sheetLabel(sheetStem, metaFileName) {
        const raw = String(metaFileName || sheetStem || '').trim().replace(/\.meta\.json$/i, '');
        return raw || String(sheetStem || '').trim();
    }

    function parseMaterials(classRaw) {
        const raw = parseRaw(classRaw);
        const z = raw.review_zone && typeof raw.review_zone === 'object' ? raw.review_zone : {};
        return (z.materials && typeof z.materials === 'object') ? z.materials : {};
    }

    function materialEntry(materials, folderName, sheetStem) {
        const map = materials || {};
        const sk = sheetStem ? sheetKey(folderName, sheetStem) : '';
        const fk = folderKey(folderName);
        const sheetE = sk ? (map[sk] || null) : null;
        const folderE = map[fk] || map[folderName] || null;
        const e = sheetE || folderE || {};
        return {
            display_name: String((sheetE && sheetE.display_name) || '').trim(),
            enabled: e.enabled !== false
        };
    }

    function parsePolicy(classRaw) {
        const raw = parseRaw(classRaw);
        const z = raw.review_zone && typeof raw.review_zone === 'object' ? raw.review_zone : {};
        const testCounts = !!z.test_counts_as_score;
        return {
            enabled: !!z.enabled,
            allow_practice: z.allow_practice !== false,
            allow_test: z.allow_test !== false,
            teacher_can_view: !!z.teacher_can_view || testCounts,
            test_counts_as_score: testCounts,
            catalog_updated_at: z.catalog_updated_at || null,
            materials: parseMaterials(classRaw)
        };
    }

    function readFromForm() {
        const enabledEl = document.getElementById('rz-enabled');
        const practiceEl = document.getElementById('rz-allow-practice');
        const testEl = document.getElementById('rz-allow-test');
        const viewEl = document.getElementById('rz-teacher-can-view');
        const scoreEl = document.getElementById('rz-test-counts-as-score');
        const testCounts = !!(scoreEl && scoreEl.checked);
        return {
            enabled: !!(enabledEl && enabledEl.checked),
            allow_practice: !!(practiceEl && practiceEl.checked),
            allow_test: !!(testEl && testEl.checked),
            teacher_can_view: !!(viewEl && viewEl.checked) || testCounts,
            test_counts_as_score: testCounts,
            catalog_updated_at: (document.getElementById('rz-catalog-updated-at') || {}).value || null
        };
    }

    return {
        parsePolicy: parsePolicy,
        readFromForm: readFromForm,
        parseMaterials: parseMaterials,
        materialEntry: materialEntry,
        folderKey: folderKey,
        sheetKey: sheetKey,
        sheetLabel: sheetLabel
    };
})();

// js/editor.js
import { state } from './store.js';
import { openModal, closeModal } from './ui.js';
import { parseRawData, initSystem } from './main.js';

export function renderCustomFieldsView(cfStr) {
    const container = document.getElementById('viewCustomContainer');
    if(!container) return;
    container.innerHTML = "";
    let cfArray = (cfStr||"").split(';;').filter(s => s.trim());
    cfArray.forEach(cf => {
        let parts = cf.split('::');
        if(parts.length===2) container.innerHTML += `<div style="margin-bottom:4px;"><span class="cf-tag">${parts[0]}</span> ${parts[1]}</div>`;
        else container.innerHTML += `<div style="margin-bottom:4px;">${cf}</div>`;
    });
}

export function excludeCurrentWord() {
    const d = state.dictionaryData[state.currentEditingDictId];
    if (!d) return;
    const sk = (d.searchKey || "").trim().toLowerCase();
    
    if (!confirm(`確定要為 [${state.currentUser}] 排除單字「${sk}」嗎？\n排除後該單字在文章中將變回普通文字，不再高亮。`)) return;

    if (!state.userBlacklists[state.currentUser]) state.userBlacklists[state.currentUser] = [];
    if (!state.userBlacklists[state.currentUser].includes(sk)) {
        state.userBlacklists[state.currentUser].push(sk);
    }
    localStorage.setItem('vocabBlacklistsV1', JSON.stringify(state.userBlacklists));

    closeModal();
    initSystem(); 
}

export function openDict(idx, targetEl = null) {
    state.currentEditingDictId = idx;
    const d = state.dictionaryData[idx];
    openModal('dict', '單字解析', targetEl); 
    
    const titleRow = document.querySelector('.dict-title-row');
    if (titleRow) {
        let editBtn = document.getElementById('dynamicEditBtn');
        if (!editBtn) {
            editBtn = document.createElement('button');
            editBtn.id = 'dynamicEditBtn';
            editBtn.className = 'btn-speak'; 
            editBtn.style.marginLeft = '8px';
            editBtn.style.fontSize = '14px';
            editBtn.innerHTML = '✏️';
            editBtn.title = '編輯此單字';
            editBtn.onclick = switchToEdit; 
            titleRow.appendChild(editBtn);
        }
        
        let excludeBtn = document.getElementById('dynamicExcludeBtn');
        if (!excludeBtn) {
            excludeBtn = document.createElement('button');
            excludeBtn.id = 'dynamicExcludeBtn';
            excludeBtn.className = 'btn-speak'; 
            excludeBtn.style.marginLeft = '4px';
            excludeBtn.style.fontSize = '15px';
            excludeBtn.innerHTML = '🗑️';
            excludeBtn.title = `將此字從 [${state.currentUser}] 的查詢名單中排除`;
            excludeBtn.onclick = excludeCurrentWord; 
            titleRow.appendChild(excludeBtn);
        }
    }

    document.getElementById('viewTitle').innerText = d.popupTitle || d.base;
    document.getElementById('viewForms').innerText = d.verbForms || "";
    document.getElementById('viewForms').classList.toggle('hidden', !d.verbForms);
    document.getElementById('viewPhonetics').innerText = d.phonetics;
    document.getElementById('viewPos').innerText = d.pos;
    document.getElementById('viewMeaning').innerText = d.meaning;
    renderCustomFieldsView(d.customField);
    document.getElementById('viewNotes').innerHTML = d.notes.replace(/🎯/g, '<br>🎯').replace(/(<br>\s*)+/g, '<br>');
    document.getElementById('dictViewPanel')?.classList.remove('hidden');
}

export function addCustomFieldRow(key="", val="") {
    const div = document.createElement('div'); div.className = "cf-row";
    const options = ["同義字", "反義字", "衍生字", "搭配詞", "字根", "片語"];
    let isCustom = key && !options.includes(key);
    let selectHtml = `<select class="cf-k-select" onchange="this.nextElementSibling.style.display = this.value==='自訂' ? 'inline-block' : 'none'">`;
    options.forEach(opt => selectHtml += `<option value="${opt}" ${key===opt?'selected':''}>${opt}</option>`);
    selectHtml += `<option value="自訂" ${isCustom?'selected':''}>自訂...</option></select>`;

    div.innerHTML = `
        ${selectHtml}
        <input type="text" class="cf-k-custom" style="display:${isCustom?'inline-block':'none'}; width:80px; margin-left:5px;" placeholder="標題" value="${isCustom?key:''}">
        <input type="text" class="cf-v" placeholder="內容" value="${val}">
        <button type="button" onclick="this.parentElement.remove()">✖</button>
    `;
    const container = document.getElementById('customFieldsContainer');
    if(container) container.appendChild(div);
}

export function getCustomFieldsString() {
    let arr = [];
    document.querySelectorAll('.cf-row').forEach(row => {
        let selectVal = row.querySelector('.cf-k-select').value;
        let k = selectVal === '自訂' ? row.querySelector('.cf-k-custom').value.trim() : selectVal;
        let v = row.querySelector('.cf-v').value.trim();
        k = k.replace(/::/g,'').replace(/;;/g,'');
        v = v.replace(/::/g,'').replace(/;;/g,'');
        if(k && v) arr.push(`${k}::${v}`);
    });
    return arr.join(';;');
}

export function renderCustomFieldsEdit(cfStr) {
    const container = document.getElementById('customFieldsContainer');
    if(!container) return;
    container.innerHTML = "";
    let cfArray = (cfStr||"").split(';;').filter(s => s.trim());
    if(cfArray.length === 0) addCustomFieldRow("同義字", "");
    cfArray.forEach(cf => {
        let parts = cf.split('::'); addCustomFieldRow(parts[0]||"", parts[1]||cf);
    });
}

export function switchToEdit() {
    const d = state.dictionaryData[state.currentEditingDictId];
    openModal('edit', '編輯單字');
    document.getElementById('dictViewPanel')?.classList.add('hidden');
    document.getElementById('editPanel')?.classList.remove('hidden'); 
    
    document.getElementById('editSearchKey').value = d.searchKey;
    document.getElementById('editSearchKey').readOnly = true;
    document.getElementById('editSearchKey').classList.add('readonly-input');
    document.getElementById('editPopupTitle').value = d.popupTitle;
    document.getElementById('editVerbForms').value = d.verbForms;
    document.getElementById('editPos').value = d.pos;
    document.getElementById('editPhonetics').value = d.phonetics;
    document.getElementById('editMeaning').value = d.meaning;
    renderCustomFieldsEdit(d.customField);
    document.getElementById('editNotes').value = d.notes.replace(/<br>/g, '\n');
}

export function openAddWordMode(txt="") {
    state.currentEditingDictId = -1;
    openModal('edit', '新增單字');
    document.getElementById('editPanel')?.classList.remove('hidden');
    
    const k = document.getElementById('editSearchKey');
    if(k) { k.value = txt; k.readOnly = false; k.classList.remove('readonly-input'); }
    
    if(document.getElementById('editPopupTitle')) document.getElementById('editPopupTitle').value = txt;
    if(document.getElementById('editVerbForms')) document.getElementById('editVerbForms').value = "";
    if(document.getElementById('editPos')) document.getElementById('editPos').value = "";
    if(document.getElementById('editPhonetics')) document.getElementById('editPhonetics').value = "";
    if(document.getElementById('editMeaning')) document.getElementById('editMeaning').value = "";
    renderCustomFieldsEdit("");
    if(document.getElementById('editNotes')) document.getElementById('editNotes').value = "";
}

export function autoGenForms() {
    const keyEl = document.getElementById('editSearchKey');
    if(!keyEl) return;
    const key = keyEl.value.trim();
    if(!key) return;
    const parts = key.split(' ');
    const verb = parts[0];
    const rest = parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '';
    let s = verb.match(/(sh|ch|s|x|z)$/i) ? "(es)" : "(s)";
    if (verb.match(/[^aeiou]y$/i)) s = "(ies)"; 
    let ed = verb.endsWith('e') ? verb + 'd' : verb + 'ed';
    let ing = verb.endsWith('e') ? verb.slice(0,-1) + 'ing' : verb + 'ing';
    if(document.getElementById('editVerbForms')) {
        document.getElementById('editVerbForms').value = `${verb}${s}${rest} - ${ed}${rest} x2 - ${ing}${rest}`;
    }
}

export function saveChanges() {
    const pipe = (s) => s.replace(/\|/g, '｜');
    const searchKey = pipe(document.getElementById('editSearchKey').value.trim());
    const popupTitle = pipe(document.getElementById('editPopupTitle').value.trim());
    const verbForms = pipe(document.getElementById('editVerbForms').value.trim());
    const pos = pipe(document.getElementById('editPos').value.trim());
    const phonetics = pipe(document.getElementById('editPhonetics').value.trim());
    const meaning = pipe(document.getElementById('editMeaning').value.trim());
    const customField = getCustomFieldsString();
    const notes = pipe(document.getElementById('editNotes').value.trim()).replace(/\n/g, '<br>');

    if(!searchKey || !meaning) return alert("請填寫搜尋標籤與意思！");
    
    const obj = { searchKey, popupTitle, verbForms, pos, phonetics, meaning, customField, notes };
    if(state.currentEditingDictId === -1) state.dictionaryData.push(obj);
    else {
        obj.base = state.dictionaryData[state.currentEditingDictId].base;
        obj.variants = state.dictionaryData[state.currentEditingDictId].variants;
        state.dictionaryData[state.currentEditingDictId] = obj;
    }
    rebuildRaw(); parseRawData(); initSystem(); closeModal();
}

export function deleteWord() {
    if(confirm("確定刪除？")) { state.dictionaryData.splice(state.currentEditingDictId, 1); rebuildRaw(); parseRawData(); initSystem(); closeModal(); }
}

export function rebuildRaw() {
    let dTxt = "";
    state.dictionaryData.forEach(d => { dTxt += `${d.searchKey} | ${d.popupTitle} | ${d.verbForms} | ${d.pos} | ${d.phonetics} | ${d.meaning} | ${d.customField} | ${d.notes}\n`; });
    state.currentDictRaw = dTxt; 
}

export function openExportModal() {
    openModal('export', '同步至 GitHub');
    document.getElementById('exportPanel')?.classList.remove('hidden');
    const exportCode = "export const dictionaryRaw = `\n" + state.currentDictRaw + "`;";
    const exportTextEl = document.getElementById('exportText');
    if(exportTextEl) exportTextEl.value = exportCode;
}

export function copyCode() {
    const exportTextEl = document.getElementById('exportText');
    if(!exportTextEl) return;
    exportTextEl.select(); document.execCommand('copy');
    alert("已複製！請貼回覆蓋你的 data/dictionary.js 並存檔。");
}

export function exportToCSV() {
    let allCustomKeys = new Set();
    state.dictionaryData.forEach(d => {
        if (d.customField) {
            d.customField.split(';;').forEach(pair => {
                let k = pair.split('::')[0].trim();
                if (k) allCustomKeys.add(k);
            });
        }
    });
    let customKeysArray = Array.from(allCustomKeys);

    let csv = "\uFEFF大標題,變形提示,詞性,音標,中文意思,解析與筆記";
    customKeysArray.forEach(k => { csv += `,${k}`; });
    csv += "\n";

    state.dictionaryData.forEach(d => {
        const esc = (s) => `"${(s||'').replace(/"/g, '""').replace(/<br>/g, '\n')}"`;
        let row = `${esc(d.popupTitle)},${esc(d.verbForms)},${esc(d.pos)},${esc(d.phonetics)},${esc(d.meaning)},${esc(d.notes)}`;

        let customDict = {};
        if (d.customField) {
            d.customField.split(';;').forEach(pair => {
                let parts = pair.split('::');
                if (parts.length === 2) customDict[parts[0].trim()] = parts[1].trim();
            });
        }

        customKeysArray.forEach(k => { row += `,${esc(customDict[k] || "")}`; });
        csv += row + "\n";
    });

    const b = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const l = document.createElement('a'); 
    l.href = URL.createObjectURL(b); l.download = "聯集結構化單字表.csv"; l.click();
}

// 🚀 跨裝置同步：結合當前網址，產生一鍵匯入的 Magic Link
export function exportLocalSettings() {
    const data = localStorage.getItem('vocabBlacklistsV1') || '{"預設訪客":[]}';
    
    // 🚀 核心修復：強制兩次編碼，確保 Base64 的 + 與 = 絕對不會在網址列被吃掉
    const syncCode = encodeURIComponent(btoa(encodeURIComponent(data)));
    
    // 獲取當前乾淨的網址（確保去掉原本自帶的 query 與 hash）
    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const magicLink = `${baseUrl}?sync=${syncCode}`;
    
    try {
        navigator.clipboard.writeText(magicLink).then(() => {
            alert("✅ 【專屬同步網址】已成功複製！\n\n請把這段網址傳到 B 機器，直接用瀏覽器開啟就能「自動匯入」所有帳號的黑名單設定！");
        }).catch(err => {
            prompt("剪貼簿存取被阻擋，請手動複製以下網址，並在 B 機器打開：", magicLink);
        });
    } catch(e) {
        prompt("請手動複製以下網址，並在 B 機器打開：", magicLink);
    }
}

// 🚀 跨裝置同步：核心解析與覆寫引擎
export function importFromSyncCode(code) {
    try {
        // 🚀 核心修復：先 decode URI，再強制把空白替換回加號 (以防萬一)
        let cleanCode = decodeURIComponent(code.trim());
        cleanCode = cleanCode.replace(/ /g, '+'); 
        
        const jsonStr = decodeURIComponent(atob(cleanCode));
        const parsed = JSON.parse(jsonStr);
        
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error("資料格式錯誤");
        
        localStorage.setItem('vocabBlacklistsV1', JSON.stringify(parsed));
        
        const currentUser = localStorage.getItem('vocabCurrentUserV1') || "預設訪客";
        if (!parsed[currentUser]) {
            const firstUser = Object.keys(parsed)[0] || "預設訪客";
            localStorage.setItem('vocabCurrentUserV1', firstUser);
        }
        
        alert("🎉 偵測到專屬同步網址！\n\n所有帳號與排除黑名單已成功匯入！");
        
        // 🚀 核心修復：強制導向回乾淨網址，不再使用 location.reload()，徹底解決重整陷阱
        const baseUrl = window.location.href.split('?')[0].split('#')[0];
        window.location.replace(baseUrl); 
    } catch (e) {
        alert("❌ 匯入失敗！同步網址可能不完整、被截斷或已損毀。");
        console.error(e);
        const baseUrl = window.location.href.split('?')[0].split('#')[0];
        window.location.replace(baseUrl);
    }
}

// 保留給使用者的手動貼上備案
export function importLocalSettings() {
    let code = prompt("📥 請貼上來自 A 機器的「專屬同步網址」：\n(注意：這將會完全覆蓋本機目前的設定！)");
    if (!code || !code.trim()) return;
    
    code = code.trim();
    // 自動萃取網址中的密碼段
    if (code.includes('?sync=')) {
        code = code.split('?sync=')[1].split('&')[0].split('#')[0];
    }
    
    importFromSyncCode(code);
}

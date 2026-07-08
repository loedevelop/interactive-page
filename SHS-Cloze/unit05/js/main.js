// js/main.js
import { articlesRaw } from '../data/articles.js';
import { dictionaryRaw } from '../data/dictionary.js'; 
import { vocabData } from '../data/vocab.js';          

import { state } from './store.js';
import { measureEngine, initDraggableModal, playWordAudio } from './utils.js';
import { openDict, switchToEdit, autoGenForms, saveChanges, deleteWord, copyCode, exportToCSV, openExportModal, addCustomFieldRow, openAddWordMode, excludeCurrentWord, exportLocalSettings, importLocalSettings, importFromSyncCode } from './editor.js';
import { setMode, openModal, closeModal, openOptions, toggleStrike, submitCurrentAnswer, revealCurrentAnswer, updateQuestionLabel, checkAllAnswers, revealAllAnswers, resetAllAnswers } from './ui.js';

Object.assign(window, {
    switchTopic, speakWord, toggleTeacherMenu, openDict, switchToEdit,
    autoGenForms, saveChanges, deleteWord, copyCode, addCustomFieldRow,
    exportToCSV, openExportModal, openAddWordMode, setMode, checkAllAnswers,
    revealAllAnswers, resetAllAnswers, closeModal, openOptions, toggleStrike,
    submitCurrentAnswer, revealCurrentAnswer, excludeCurrentWord,
    exportLocalSettings, importLocalSettings 
});

function bootstrap() {
    try {
        const urlStr = window.location.href;
        let syncData = null;
        if (urlStr.includes('?sync=')) {
            syncData = urlStr.split('?sync=')[1].split('&')[0].split('#')[0];
        } else if (urlStr.includes('&sync=')) {
            syncData = urlStr.split('&sync=')[1].split('&')[0].split('#')[0];
        }
        
        if (syncData) {
            importFromSyncCode(syncData);
            return; 
        }

        parseRawData(); 
        initUserSelector(); 
        initModeButtons(); // 🚀 自動注入「教學模式」按鈕
        initSyncButtons(); 
        initSystem(); 
        initDraggableModal('draggableWindow', 'modalDragHandle', 'modalStateV17_0'); 
        initDraggableModal('modeDraggable', null, 'modeStateV17_0'); 
        setupEventListeners();
    } catch (error) {
        console.error("🚨 Bootstrap Error:", error);
        document.getElementById('contentArea').innerHTML = `<h2 style="color:red; text-align:center;">系統載入失敗，請檢查主控台訊息 (F12)。</h2>`;
    }
}

// 🚀 核心 UI：動態插入教學模式按鈕
function initModeButtons() {
    const practiceBtn = document.getElementById('modePractice');
    if (practiceBtn && !document.getElementById('modeTeaching')) {
        const teachingBtn = document.createElement('div');
        teachingBtn.id = 'modeTeaching';
        teachingBtn.className = 'mode-btn mode-inactive fit-auto';
        teachingBtn.innerText = '教學模式';
        teachingBtn.onclick = () => setMode('teaching');
        practiceBtn.parentNode.insertBefore(teachingBtn, practiceBtn);
    }
}

function initSyncButtons() {
    const menu = document.getElementById('teacherMenu');
    if (!menu || document.getElementById('btnExportSync')) return;
    
    const btnEx = document.createElement('button');
    btnEx.id = 'btnExportSync';
    btnEx.className = 'btn-csv';
    btnEx.style.backgroundColor = '#16a085'; 
    btnEx.innerHTML = '🔗 複製同步專屬網址';
    btnEx.onclick = exportLocalSettings;
    
    const btnIm = document.createElement('button');
    btnIm.id = 'btnImportSync';
    btnIm.className = 'btn-csv';
    btnIm.style.backgroundColor = '#d35400'; 
    btnIm.innerHTML = '📥 手動匯入同步網址';
    btnIm.onclick = importLocalSettings;
    
    menu.appendChild(btnEx);
    menu.appendChild(btnIm);
}

function initUserSelector() {
    const panel = document.getElementById('modeDraggable');
    if (!panel || document.getElementById('userProfileSelector')) return;

    const selector = document.createElement('select');
    selector.id = 'userProfileSelector';
    selector.className = 'topic-selector';
    selector.style.marginRight = '5px';
    selector.style.backgroundColor = '#e1f0fa';
    selector.style.color = '#2980b9';

    const renderOptions = () => {
        selector.innerHTML = '';
        Object.keys(state.userBlacklists).forEach(user => {
            const opt = document.createElement('option');
            opt.value = opt.innerText = user;
            selector.appendChild(opt);
        });
        const addOpt = document.createElement('option');
        addOpt.value = 'ADD_NEW_USER';
        addOpt.innerText = '➕ 新增使用者...';
        selector.appendChild(addOpt);
        selector.value = state.currentUser;
    };

    renderOptions();

    selector.onmousedown = (e) => e.stopPropagation();
    selector.ontouchstart = (e) => e.stopPropagation();
    selector.onchange = (e) => {
        if (e.target.value === 'ADD_NEW_USER') {
            const newUser = prompt("請輸入新使用者的名稱 (例如：王小明)：");
            if (newUser && newUser.trim()) {
                const name = newUser.trim();
                if (!state.userBlacklists[name]) {
                    state.userBlacklists[name] = [];
                }
                state.currentUser = name;
            } else {
                selector.value = state.currentUser; 
                return;
            }
        } else {
            state.currentUser = e.target.value;
        }
        
        localStorage.setItem('vocabCurrentUserV1', state.currentUser);
        localStorage.setItem('vocabBlacklistsV1', JSON.stringify(state.userBlacklists));
        renderOptions();
        initSystem(); 
    };

    const topicSel = document.getElementById('topicSelector');
    panel.insertBefore(selector, topicSel);
}

function setupEventListeners() {
    const bindClick = (id, handler) => {
        const btn = document.getElementById(id);
        if (btn) { btn.removeAttribute('onclick'); btn.addEventListener('click', handler); }
    };

    bindClick('checkAllBtn', checkAllAnswers);
    bindClick('revealAllBtn', revealAllAnswers);
    bindClick('resetAllBtn', resetAllAnswers);

    const contentArea = document.getElementById('contentArea');
    if (contentArea) {
        contentArea.addEventListener('click', (e) => {
            const dictHighlight = e.target.closest('.dict-highlight');
            if (dictHighlight) {
                const dictIndex = dictHighlight.getAttribute('data-dict-idx');
                if (dictIndex !== null) {
                    openDict(dictIndex, dictHighlight); 
                    setTimeout(speakWord, 100); 
                }
                return; 
            }

            const clozeBlank = e.target.closest('.cloze-blank');
            if (clozeBlank && (state.currentMode === 'practice' || state.currentMode === 'teaching')) {
                const qNum = clozeBlank.getAttribute('data-qnum');
                openOptions(qNum, clozeBlank);
                return; 
            }
        });

        contentArea.addEventListener('contextmenu', (e) => {
            if(state.currentMode === 'practice' || state.currentMode === 'teaching') return; 
            const txt = window.getSelection().toString().trim();
            if(txt) { e.preventDefault(); openAddWordMode(txt); }
        });
    }

    document.getElementById('mainModal')?.addEventListener('mousedown', function(e) {
        if(e.target === this) closeModal();
    });
}

export function parseRawData() {
    state.dictionaryData = []; 
    state.allTopics = {}; 
    
    state.currentDictRaw = dictionaryRaw || ""; 

    if (vocabData && vocabData.items) {
        vocabData.items.forEach(item => {
            if (item.status === '✅ 保留') {
                const cleanWord = item.word ? item.word.trim() : "";
                const cleanLemma = item.lemma ? item.lemma.trim() : "";
                
                if (cleanWord) {
                    state.dictionaryData.push({
                        searchKey: cleanWord,
                        popupTitle: cleanWord,
                        base: cleanLemma || cleanWord,
                        variants: [cleanWord],
                        pos: "未分類",
                        phonetics: "",
                        meaning: `[JSON 匯入單字] 難度: ${item.level}。請點擊 ✏️ 編輯新增解釋！`,
                        customField: "",
                        notes: ""
                    });
                }
            }
        });
    }

    if (typeof state.currentDictRaw === 'string' && state.currentDictRaw.trim()) {
        state.currentDictRaw.trim().split('\n').forEach(line => {
            const p = line.split('|').map(s=>s.trim());
            if(p.length < 5) return;
            let searchKey, popupTitle, verbForms, pos, phonetics, meaning, customField, notes;
            if(p.length >= 8) [searchKey, popupTitle, verbForms, pos, phonetics, meaning, customField, notes] = p;
            else [searchKey, popupTitle, verbForms, pos, phonetics, meaning, notes] = p, customField="";
            
            let base = searchKey; let variants = [];
            const vM = searchKey.match(/^([^(]+)\(([^)]+)\)/);
            if (vM) { base = vM[1].trim(); variants = vM[2].split(',').map(v=>v.trim()); }
            
            state.dictionaryData.push({ searchKey, popupTitle, verbForms, base, variants, pos, phonetics, meaning, customField, notes });
        });
    }

    if (!articlesRaw) throw new Error("articlesRaw 未定義");

    const topicMatches = [...articlesRaw.matchAll(/\[TOPIC:(.*?)\]\n([\s\S]*?)(?=\[TOPIC:|$)/g)];
    const selector = document.getElementById('topicSelector');
    if (!selector) return;
    selector.innerHTML = "";
    topicMatches.forEach((match) => {
        const title = match[1].trim(); 
        state.allTopics[title] = match[2];
        const opt = document.createElement('option');
        opt.value = opt.innerText = title;
        selector.appendChild(opt);
    });
}

function switchTopic(title) { initSystem(title); }

function speakWord() {
    const viewTitle = document.getElementById('viewTitle');
    if (!viewTitle) return;
    playWordAudio(viewTitle.innerText.replace(/\.\.\./g, '').trim());
}

function toggleTeacherMenu() { document.getElementById('teacherMenu')?.classList.toggle('hidden'); }

export function initSystem(targetTitle = null) {
    const selector = document.getElementById('topicSelector');
    if (!selector) return;
    if (targetTitle) selector.value = targetTitle;
    const title = selector.value;
    const content = state.allTopics[title];
    if(!content) return;

    const articleMatch = content.match(/\[文章開始\]([\s\S]*?)\[文章結束\]/);
    const optionsMatch = content.match(/\[選項開始\]([\s\S]*?)\[選項結束\]/);
    
    state.parsedOptions = {};
    const optText = optionsMatch ? optionsMatch[1].trim() : "";
    if (/^(\d+)\./m.test(optText)) {
        optText.split('\n').forEach(line => {
            const numMatch = line.match(/^(\d+)\./);
            if (numMatch) {
                const qNum = numMatch[1];
                let m; state.parsedOptions[qNum] = [];
                const optRegex = /\(([A-Z])\)\s*([\s\S]*?)(?=\s*\([A-Z]\)|\s*$)/g;
                while ((m = optRegex.exec(line)) !== null) state.parsedOptions[qNum].push({ letter: m[1], text: m[2].trim() });
            }
        });
    } else {
        state.parsedOptions["shared"] = [];
        let m; const optRegex = /\(([A-Z])\)\s*([\s\S]*?)(?=\s*\([A-Z]\)|\s*$)/g;
        while ((m = optRegex.exec(optText)) !== null) state.parsedOptions["shared"].push({ letter: m[1], text: m[2].trim() });
    }

    const allWordsMap = new Map();
    let singleRegex = null;
    let wordOnlyRegex = null; 
    
    const currentBlacklist = state.userBlacklists[state.currentUser] || [];
    
    if (state.dictionaryData && state.dictionaryData.length > 0) {
        state.dictionaryData.forEach((w, i) => {
            if (currentBlacklist.includes((w.searchKey || "").trim().toLowerCase())) return;
            
            if (w.base) {
                const cleanBase = w.base.trim().toLowerCase();
                const coreWord = cleanBase.replace(/\b(be|to\s*v|v-ing|sb\.?|sth\.?|oneself)\b/gi, ' ').replace(/\s+/g, ' ').trim();
                if (coreWord.length > 1 && !allWordsMap.has(coreWord)) allWordsMap.set(coreWord, i);
            }
        });

        state.dictionaryData.forEach((w, i) => {
            if (currentBlacklist.includes((w.searchKey || "").trim().toLowerCase())) return;
            if(w.variants) {
                w.variants.forEach(word => {
                    const cleanWord = word.trim().toLowerCase(); 
                    if (cleanWord.length > 1) allWordsMap.set(cleanWord, i);
                });
            }
        });
        
        state.dictionaryData.forEach((w, i) => {
            if (currentBlacklist.includes((w.searchKey || "").trim().toLowerCase())) return;
            if (w.base) {
                const cleanBase = w.base.trim().toLowerCase();
                if (cleanBase.length > 1) allWordsMap.set(cleanBase, i);
            }
            if (w.searchKey) {
                const cleanKey = w.searchKey.trim().toLowerCase();
                if (cleanKey.length > 1) allWordsMap.set(cleanKey, i);
            }
        });

        const sortedWords = Array.from(allWordsMap.keys()).sort((a, b) => b.length - a.length);
        if (sortedWords.length > 0) {
            const escapedWords = sortedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            singleRegex = new RegExp(`(<[^>]*>)|(\\b(?:${escapedWords.join('|')})\\b)`, 'gi');
            
            const justWords = sortedWords.filter(w => !w.includes(' '));
            if (justWords.length > 0) {
                const escapedJustWords = justWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                wordOnlyRegex = new RegExp(`(\\b(?:${escapedJustWords.join('|')})\\b)`, 'gi');
            }
        }
    }

    const applyDict = (txt) => {
        if (!singleRegex) return txt;
        return txt.replace(singleRegex, (match, tag, wordMatch) => {
            if (tag) return tag;
            const dictIndex = allWordsMap.get(wordMatch.toLowerCase());
            if (dictIndex !== undefined) {
                const isPhrase = wordMatch.trim().includes(' ');
                if (isPhrase) {
                    let innerHtml = wordMatch;
                    if (wordOnlyRegex) {
                        innerHtml = innerHtml.replace(wordOnlyRegex, (innerMatch) => {
                            const innerIdx = allWordsMap.get(innerMatch.toLowerCase());
                            return innerIdx !== undefined ? `<span class="dict-highlight is-nested-word" data-dict-idx="${innerIdx}">${innerMatch}</span>` : innerMatch;
                        });
                    }
                    return `<span class="dict-highlight is-phrase" data-dict-idx="${dictIndex}">${innerHtml}</span>`;
                }
                return `<span class="dict-highlight is-word" data-dict-idx="${dictIndex}">${wordMatch}</span>`;
            }
            return match;
        });
    };

    state.clozeAnswersHtml = {}; 

    let html = articleMatch ? articleMatch[1].trim() : "";
    const qKeys = Object.keys(state.parsedOptions).filter(k => k !== "shared").map(Number).sort((a,b)=>a-b);
    let qCount = 0;

    html = html.replace(/<%>([^<]+)<\/%>/g, (m, ans) => {
        const qNum = qKeys[qCount] || (qCount + 1); qCount++;
        const cleanAns = ans.trim();
        
        state.clozeAnswersHtml[qNum] = applyDict(cleanAns); 

        let optionsList = state.parsedOptions[qNum] || state.parsedOptions["shared"] || [];
        let maxText = cleanAns;
        optionsList.forEach(o => { if (o.text.length > maxText.length) maxText = o.text; });
        
        const hasOptions = optionsList.length > 0;
        const ghostText = maxText;
        const ghostAttr = maxText.replace(/"/g, '&quot;');
        
        const isLong = ghostText.length > 30 ? 'is-long-text' : '';
        const ghostDisplay = hasOptions ? `(W) ${ghostText}` : ghostText;

        return `
            <span class="cloze-blank unanswered ${isLong}" id="wrap-${qNum}" data-qnum="${qNum}" data-ans="${cleanAns}" data-wrong-attempt="false" data-ghost="${ghostAttr}">
                <span class="ghost-layer" aria-hidden="true"><span style="margin-right:4px;">${qNum}.</span><span>${ghostDisplay}</span></span>
                <span class="real-layer">
                    <span class="blank-number" id="qlabel-${qNum}">${qNum}.</span>
                    <span class="answer-letter" id="qletter-${qNum}" style="display:${hasOptions?'inline-block':'none'};visibility:hidden;margin-right:4px;">(W)</span>
                    <span class="answer-text" id="qtext-${qNum}"></span>
                </span>
            </span>`;
    });

    if (singleRegex) {
        html = html.replace(singleRegex, (match, tag, wordMatch) => {
            if (tag) return tag; 
            const dictIndex = allWordsMap.get(wordMatch.toLowerCase());
            if (dictIndex !== undefined) {
                const isPhrase = wordMatch.trim().includes(' ');
                if (isPhrase) {
                    let innerHtml = wordMatch;
                    if (wordOnlyRegex) {
                        innerHtml = innerHtml.replace(wordOnlyRegex, (innerMatch) => {
                            const innerIdx = allWordsMap.get(innerMatch.toLowerCase());
                            return innerIdx !== undefined ? `<span class="dict-highlight is-nested-word" data-dict-idx="${innerIdx}">${innerMatch}</span>` : innerMatch;
                        });
                    }
                    return `<span class="dict-highlight is-phrase" data-dict-idx="${dictIndex}">${innerHtml}</span>`;
                }
                return `<span class="dict-highlight is-word" data-dict-idx="${dictIndex}">${wordMatch}</span>`;
            }
            return match; 
        });
    }
    
    document.getElementById('contentArea').innerHTML = html;
    setMode(state.currentMode || 'teaching'); // 預設降落到教學模式
}

bootstrap();

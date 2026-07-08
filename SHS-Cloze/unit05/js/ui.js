// js/ui.js
import { state } from './store.js';

export function setMode(mode) {
    state.currentMode = mode; 
    
    const toggleClass = (id, condition, activeClass, inactiveClass) => {
        const el = document.getElementById(id);
        if (el) el.className = condition ? activeClass : inactiveClass;
    };

    // 🚀 完整切換 4 種模式
    toggleClass('modeReading', mode === 'reading', "mode-btn mode-active fit-auto", "mode-btn mode-inactive fit-auto");
    toggleClass('modeExplain', mode === 'explain', "mode-btn mode-active fit-auto", "mode-btn mode-inactive fit-auto");
    toggleClass('modeTeaching', mode === 'teaching', "mode-btn mode-active fit-auto", "mode-btn mode-inactive fit-auto");
    toggleClass('modePractice', mode === 'practice', "mode-btn mode-active practice-wrapper", "mode-btn mode-inactive practice-wrapper");
    
    const isInteractive = (mode === 'practice' || mode === 'teaching');
    document.getElementById('checkAllBtn')?.classList.toggle('hidden', !isInteractive);
    document.getElementById('revealAllBtn')?.classList.toggle('hidden', !isInteractive);
    document.getElementById('resetAllBtn')?.classList.toggle('hidden', !isInteractive);
    
    document.querySelectorAll('.cloze-blank').forEach(el => {
        const textSpan = el.querySelector('.answer-text');
        const ans = el.getAttribute('data-ans');
        const qNum = el.getAttribute('data-qnum');
        const labelSpan = el.querySelector('.blank-number');
        const letterSpan = el.querySelector('.answer-letter');
        
        el.classList.remove('reading-mode');

        if (mode === 'reading') {
            el.classList.add('reading-mode');
            el.classList.remove('answered-black', 'answered-red', 'wrong', 'unanswered', 'previewing');
            if (textSpan) {
                textSpan.innerHTML = state.clozeAnswersHtml?.[qNum] || ans; 
            }
        } else if (mode === 'explain') {
            el.classList.add('answered-black');
            el.classList.remove('wrong', 'answered-red', 'unanswered', 'previewing');
            updateQuestionLabel(qNum, ans, el);
            
        } else {
            const isCorrect = el.getAttribute('data-is-correct') === 'true';
            const isWrong = el.getAttribute('data-wrong-attempt') === 'true';

            if (isCorrect) {
                el.classList.add('answered-black');
                el.classList.remove('wrong', 'answered-red', 'unanswered', 'previewing');
                updateQuestionLabel(qNum, ans, el);
            } else if (isWrong) {
                el.classList.add('wrong');
                el.classList.remove('answered-black', 'answered-red', 'unanswered', 'previewing');
            } else {
                el.classList.add('unanswered');
                el.classList.remove('answered-black', 'answered-red', 'wrong', 'previewing');
                
                if(textSpan) {
                    if (el.classList.contains('is-long-text')) {
                        textSpan.innerHTML = el.getAttribute('data-ghost');
                    } else {
                        textSpan.innerHTML = "";
                    }
                }
                
                if (letterSpan) {
                    letterSpan.innerText = "(W)"; 
                    letterSpan.style.visibility = 'hidden';
                    letterSpan.style.display = 'inline-block';
                }
                if (labelSpan) labelSpan.innerText = `${qNum}.`;
            }
        }
    });

    const contentArea = document.getElementById('contentArea');
    if (contentArea) {
        contentArea.classList.remove('content-reading-mode', 'content-explain-mode', 'content-practice-mode', 'content-teaching-mode');
        contentArea.classList.add(`content-${mode}-mode`);
    }

    closeModal();
}

export function openModal(type, title, targetEl = null) {
    const titleEl = document.getElementById('modalTitleText');
    if (titleEl) titleEl.innerText = title;
    
    ['optionsPanel', 'dictViewPanel', 'editPanel', 'exportPanel', 'btnShowAnswer'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });
    
    const modalBody = document.getElementById('modalBodyArea');
    modalBody?.classList.toggle('no-padding', type === 'options');

    const win = document.getElementById('draggableWindow');
    if (!win) return;

    win.classList.toggle('dict-mode-modal', type === 'dict');

    const mainModal = document.getElementById('mainModal');
    if (mainModal) {
        mainModal.style.display = 'block';
        mainModal.style.zIndex = '9999';
    }

    if ((type === 'dict' || type === 'options') && targetEl) {
        win.style.transform = 'none'; 
        
        if (type === 'options') {
            win.style.width = 'max-content';
            win.style.maxWidth = 'min(800px, 90vw)'; 
        } else {
            win.style.width = '320px';
            win.style.maxWidth = 'none';
        }
        win.style.height = 'auto';

        const rect = targetEl.getBoundingClientRect();
        const winRect = win.getBoundingClientRect();
        
        let top = rect.bottom + 40;
        let left = rect.left;

        if (left + winRect.width > window.innerWidth) left = window.innerWidth - winRect.width - 20; 
        if (top + winRect.height > window.innerHeight) top = Math.max(10, rect.top - winRect.height - 10);

        win.style.left = `${Math.max(10, left)}px`;
        win.style.top = `${Math.max(10, top)}px`;
        
        if (type === 'options') document.getElementById('btnShowAnswer')?.classList.remove('hidden');

    } else {
        const saved = localStorage.getItem('modalStateV17_0');
        if(saved) {
            try {
                const s = JSON.parse(saved);
                win.style.transform = 'none'; win.style.left = s.x+'px'; win.style.top = s.y+'px';
                win.style.width = s.w+'px'; win.style.height = s.h+'px';
                win.style.maxWidth = 'none';
            } catch(e) {
                console.warn("Modal 狀態解析失敗");
            }
        } else {
            win.style.left = '50%'; win.style.top = '15%'; win.style.transform = 'translateX(-50%)';
            win.style.width = '450px'; win.style.height = 'auto';
            win.style.maxWidth = 'none'; 
        }
    }
}

export function closeModal() { 
    const mainModal = document.getElementById('mainModal');
    if(mainModal) mainModal.style.display = 'none'; 
}

export function openOptions(qNum, wrapperEl) {
    if (state.currentMode !== 'practice' && state.currentMode !== 'teaching') return;
    
    state.currentTargetWrapper = wrapperEl;
    const targetTextSpan = state.currentTargetWrapper.querySelector('.answer-text');
    if(!targetTextSpan) return;
    
    openModal('options', `第 ${qNum} 題選項`, wrapperEl);
    
    const list = document.getElementById('optionsList'); 
    if (!list) return;

    list.innerHTML = ""; 
    state.selectedOptionText = "";

    const isAlreadyRevealed = state.currentTargetWrapper.classList.contains('answered-black') || state.currentTargetWrapper.classList.contains('answered-red');
    const correctText = state.currentTargetWrapper.getAttribute('data-ans');
    let optionsList = state.parsedOptions[qNum] || state.parsedOptions["shared"] || [];

    // 🚀 核心邏輯：判斷目前是否為「教學模式」
    const isTeachingMode = state.currentMode === 'teaching';

    const usedOptionsMap = {};
    document.querySelectorAll('.cloze-blank').forEach(el => {
        if (el !== state.currentTargetWrapper && !el.classList.contains('unanswered') && el.getAttribute('data-wrong-attempt') !== 'true') {
            const txtSpan = el.querySelector('.answer-text');
            if (txtSpan && txtSpan.innerText.trim() !== "") {
                const qn = el.getAttribute('data-qnum');
                usedOptionsMap[txtSpan.innerText.trim()] = qn;
            }
        }
    });

    optionsList.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'option-wrapper';
        if(!isAlreadyRevealed && targetTextSpan.innerText === opt.text) div.classList.add('is-selected');
        if(isAlreadyRevealed && opt.text === correctText) div.classList.add('is-correct-answer');

        const usedInQnum = usedOptionsMap[opt.text];

        // 🚀 只在教學模式下，且該選項被用掉時，才會隱性顯示
        if (isTeachingMode && usedInQnum && targetTextSpan.innerText !== opt.text && !isAlreadyRevealed) {
            div.classList.add('is-used-elsewhere');
            div.innerHTML = `
                <span class="option-letter">(${opt.letter})</span>
                <span class="option-text">${opt.text} <span style="color:#e74c3c; font-size:12px; margin-left:4px;">(已在第 ${usedInQnum} 題使用)</span></span>
            `;
            div.onclick = (e) => {
                e.stopPropagation();
                alert(`這個選項已經在第 ${usedInQnum} 題被選用了喔！\n若要更改，請先去第 ${usedInQnum} 題按「✗ 刪去」。`);
            };
        } else {
            // 練習模式 (或尚未被使用的選項)
            div.innerHTML = `
                <span class="option-letter">(${opt.letter})</span>
                <span class="option-text">${opt.text}</span>
                <button class="strike-btn" onclick="toggleStrike(event, this)">✗ 刪去</button>
            `;

            div.onclick = () => {
                if(div.classList.contains('is-struck') || div.classList.contains('is-confirmed-wrong') || isAlreadyRevealed) return;
                document.querySelectorAll('.option-wrapper').forEach(el => el.classList.remove('is-selected'));
                div.classList.add('is-selected');
                state.selectedOptionText = opt.text;
                
                targetTextSpan.innerText = opt.text; 
                
                state.currentTargetWrapper.classList.remove('unanswered', 'wrong'); 
                state.currentTargetWrapper.classList.add('previewing');
                
                const letterSpan = state.currentTargetWrapper.querySelector('.answer-letter');
                if (letterSpan) {
                    letterSpan.innerText = `(${opt.letter})`;
                    letterSpan.style.visibility = 'hidden'; 
                    letterSpan.style.display = 'inline-block';
                }
            };
        }
        list.appendChild(div);
    });
    
    document.getElementById('optionsPanel')?.classList.remove('hidden');
}

export function toggleStrike(e, btn) {
    e.stopPropagation();
    const wrapper = btn.closest('.option-wrapper');
    wrapper.classList.toggle('is-struck');
    btn.innerText = wrapper.classList.contains('is-struck') ? "復原" : "✗ 刪去";
    
    const currentText = wrapper.querySelector('.option-text').innerText;
    const targetTextSpan = state.currentTargetWrapper.querySelector('.answer-text');
    
    if(wrapper.classList.contains('is-struck') && targetTextSpan && targetTextSpan.innerText === currentText) {
        
        if (state.currentTargetWrapper.classList.contains('is-long-text')) {
            targetTextSpan.innerHTML = state.currentTargetWrapper.getAttribute('data-ghost'); 
        } else {
            targetTextSpan.innerHTML = "";
        }
        
        state.currentTargetWrapper.classList.add('unanswered');
        state.currentTargetWrapper.classList.remove('previewing');

        const letterSpan = state.currentTargetWrapper.querySelector('.answer-letter');
        if (letterSpan) {
            letterSpan.innerText = "(W)"; 
            letterSpan.style.visibility = 'hidden';
        }
        wrapper.classList.remove('is-selected'); 
        state.selectedOptionText = "";
    }
}

export function submitCurrentAnswer() {
    const targetTextSpan = state.currentTargetWrapper.querySelector('.answer-text');
    if(!state.selectedOptionText && (!targetTextSpan || !targetTextSpan.innerText)) { 
        alert("請先選擇一個答案！"); 
        return; 
    }
    
    const correctText = state.currentTargetWrapper.getAttribute('data-ans');
    const userText = targetTextSpan.innerText.trim(); 
    const qNum = state.currentTargetWrapper.getAttribute('data-qnum');

    if(userText === correctText) {
        const hasWrongAttempt = state.currentTargetWrapper.getAttribute('data-wrong-attempt') === 'true';
        state.currentTargetWrapper.classList.remove('wrong', 'unanswered', 'previewing'); 
        state.currentTargetWrapper.classList.add(hasWrongAttempt ? 'answered-red' : 'answered-black');
        state.currentTargetWrapper.setAttribute('data-is-correct', 'true');
        
        updateQuestionLabel(qNum, correctText, state.currentTargetWrapper);
        closeModal();
    } else {
        state.currentTargetWrapper.setAttribute('data-wrong-attempt', 'true');
        state.currentTargetWrapper.classList.add('wrong');
        state.currentTargetWrapper.classList.remove('unanswered', 'previewing');

        const activeOpt = document.querySelector('.option-wrapper.is-selected');
        if(activeOpt) {
            activeOpt.classList.remove('is-selected');
            activeOpt.classList.add('is-confirmed-wrong');
        }
    }
}

export function revealCurrentAnswer() {
    const correctText = state.currentTargetWrapper.getAttribute('data-ans');
    const qNum = state.currentTargetWrapper.getAttribute('data-qnum');
    
    state.currentTargetWrapper.classList.remove('wrong', 'answered-black', 'unanswered', 'previewing'); 
    state.currentTargetWrapper.classList.add('answered-red'); 
    state.currentTargetWrapper.setAttribute('data-wrong-attempt', 'true');
    state.currentTargetWrapper.setAttribute('data-is-correct', 'true');
    
    updateQuestionLabel(qNum, correctText, state.currentTargetWrapper);

    document.querySelectorAll('.option-wrapper').forEach(el => {
        const textSpan = el.querySelector('.option-text');
        if(textSpan && textSpan.innerText === correctText) el.classList.add('is-correct-answer');
    });
    
    closeModal(); 
}

export function updateQuestionLabel(qNum, correctText, wrapperEl = null) {
    let letter = "";
    let optionsList = state.parsedOptions[qNum] || state.parsedOptions["shared"] || [];
    if(optionsList.length > 0) {
        const opt = optionsList.find(o => o.text === correctText);
        if(opt) letter = opt.letter;
    }

    const wrapper = wrapperEl || document.getElementById(`wrap-${qNum}`);
    if (!wrapper) return;

    const labelSpan = wrapper.querySelector('.blank-number');
    if(labelSpan) labelSpan.innerText = `${qNum}.`;
    
    const letterSpan = wrapper.querySelector('.answer-letter');
    const textSpan = wrapper.querySelector('.answer-text');

    if (letterSpan) {
        if (letter) {
            letterSpan.innerText = `(${letter})`;
            letterSpan.style.visibility = 'visible'; 
            letterSpan.style.display = 'inline-block';
        } else {
            letterSpan.style.display = 'none';
        }
    }
    
    if (textSpan) {
        textSpan.innerHTML = state.clozeAnswersHtml?.[qNum] || correctText;
    }
}

export function checkAllAnswers() {
    try {
        let correctCount = 0;
        let totalCount = 0;

        document.querySelectorAll('.cloze-blank').forEach(wrapper => {
            totalCount++;
            if(wrapper.classList.contains('answered-black')) { correctCount++; return; }
            if(wrapper.classList.contains('answered-red')) return; 
            
            const targetTextSpan = wrapper.querySelector('.answer-text');
            if(!targetTextSpan) return;
            
            const u = targetTextSpan.innerText.trim(); 
            const c = wrapper.getAttribute('data-ans') || "";
            const qNum = wrapper.getAttribute('data-qnum');
            const hasWrongAttempt = wrapper.getAttribute('data-wrong-attempt') === 'true';
            
            if(u !== "" && !wrapper.classList.contains('unanswered')) {
                if(u === c) {
                    wrapper.setAttribute('data-is-correct', 'true');
                    wrapper.classList.remove('wrong', 'unanswered', 'previewing');
                    if (hasWrongAttempt) {
                        wrapper.classList.add('answered-red'); 
                    } else {
                        wrapper.classList.add('answered-black'); 
                        correctCount++; 
                    }
                    updateQuestionLabel(qNum, c, wrapper);
                } else {
                    wrapper.classList.remove('answered-black', 'answered-red', 'unanswered', 'previewing');
                    wrapper.classList.add('wrong');
                    wrapper.setAttribute('data-wrong-attempt', 'true');
                }
            } else {
                wrapper.classList.remove('answered-black', 'answered-red', 'unanswered', 'previewing');
                wrapper.classList.add('wrong');
            }
        });

        setTimeout(() => alert(`批改完成！目前答對 ${correctCount} / ${totalCount} 題。`), 50);
    } catch(err) {
        console.error("批改發生錯誤:", err);
    }
}

export function revealAllAnswers() {
    try {
        document.querySelectorAll('.cloze-blank').forEach(wrapper => {
            if(wrapper.classList.contains('answered-black')) return;
            const c = wrapper.getAttribute('data-ans') || "";
            const qNum = wrapper.getAttribute('data-qnum');
            wrapper.classList.remove('wrong', 'answered-black', 'unanswered', 'previewing');
            wrapper.classList.add('answered-red');
            wrapper.setAttribute('data-wrong-attempt', 'true'); 
            wrapper.setAttribute('data-is-correct', 'true');
            updateQuestionLabel(qNum, c, wrapper);
        });
    } catch(err) {
        console.error(err);
    }
}

export function resetAllAnswers() {
    if (!confirm("確定要重來嗎？這將會清空所有作答紀錄！")) return;
    try {
        document.querySelectorAll('.cloze-blank').forEach(wrapper => {
            wrapper.classList.remove('wrong', 'answered-black', 'answered-red', 'previewing');
            wrapper.classList.add('unanswered');
            wrapper.removeAttribute('data-wrong-attempt');
            wrapper.removeAttribute('data-is-correct');
            
            const qNum = wrapper.getAttribute('data-qnum');
            const labelSpan = wrapper.querySelector('.blank-number');
            const letterSpan = wrapper.querySelector('.answer-letter');
            const textSpan = wrapper.querySelector('.answer-text');
            
            if (labelSpan) labelSpan.innerText = `${qNum}.`;
            if (letterSpan) {
                letterSpan.innerText = "(W)";
                letterSpan.style.visibility = 'hidden';
                letterSpan.style.display = 'inline-block';
            }
            if (textSpan) {
                if (wrapper.classList.contains('is-long-text')) {
                    textSpan.innerHTML = wrapper.getAttribute('data-ghost');
                } else {
                    textSpan.innerHTML = "";
                }
            }
        });
        state.selectedOptionText = "";
    } catch(err) {
        console.error(err);
    }
}

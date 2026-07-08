// js/utils.js

// 🚀 Canvas 精準測量引擎
export const measureEngine = {
    canvas: document.createElement('canvas'),
    font: '',
    getFont: function() {
        if (this.font) return this.font;
        const dummy = document.createElement('span');
        dummy.className = 'cloze-blank';
        dummy.style.visibility = 'hidden';
        dummy.style.position = 'absolute';
        dummy.innerText = 'W';
        document.body.appendChild(dummy);
        const computed = window.getComputedStyle(dummy);
        this.font = computed.font || `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        document.body.removeChild(dummy);
        return this.font;
    },
    measure: function(text) {
        const ctx = this.canvas.getContext('2d');
        ctx.font = this.getFont();
        return ctx.measureText(text).width;
    }
};

// 🚀 視窗拖曳工具
export function initDraggableModal(windowId, handleId, storageKey) {
    const win = document.getElementById(windowId);
    if(!win) return;
    const head = handleId ? document.getElementById(handleId) : win; 
    let isDrag = false, ox = 0, oy = 0;
    
    const startDrag = (e) => {
        if(e.target.tagName==='BUTTON' || e.target.tagName==='INPUT' || e.target.tagName==='SELECT' || e.target.tagName==='OPTION' || e.target.classList.contains('mode-btn') || e.target.classList.contains('modal-close')) return;
        isDrag = true;
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        const rect = win.getBoundingClientRect();
        win.style.transform = 'none';
        win.style.left = rect.left + 'px'; 
        win.style.top = rect.top + 'px';
        ox = clientX - rect.left; 
        oy = clientY - rect.top;
    };

    const doDrag = (e) => {
        if(!isDrag) return;
        if(e.type.includes('touch')) e.preventDefault(); 
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        win.style.left = (clientX - ox) + 'px'; 
        win.style.top = (clientY - oy) + 'px';
    };

    const stopDrag = () => {
        if(isDrag) {
            isDrag = false;
            const r = win.getBoundingClientRect();
            const optionsPanel = document.getElementById('optionsPanel');
            if(storageKey === 'modalStateV15' && optionsPanel && !optionsPanel.classList.contains('hidden')) return;
            localStorage.setItem(storageKey, JSON.stringify({x:r.left, y:r.top, w:r.width, h:r.height}));
        }
    };

    if(head) {
        head.addEventListener('mousedown', startDrag);
        head.addEventListener('touchstart', startDrag, { passive: false });
    }
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('touchmove', doDrag, { passive: false });
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
}

// 🚀 語音朗讀工具
export function playWordAudio(word) {
    if(!word) return;
    const audioPath = `./audio/${word.toLowerCase()}.mp3`;
    const audio = new Audio(audioPath);
    audio.play().catch(e => {
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    });
}

import { state, fetchQuestions, saveResultToHistory, resetExamState, loadHistory } from './store.js';
import { buildQuestionPool, generateExam, recordAnswer, evaluateExam } from './service.js';
import { renderExam, renderReview } from './render.js';
import { exportToCSV, exportToPDF } from './exporter.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 載入歷史紀錄
    loadHistory();
    
    // 🚀 核心優化：如果歷史紀錄裡有學生，自動幫他填好名字，不用重打！
    if (state.history && state.history.length > 0) {
        const lastStudent = state.history[state.history.length - 1].studentName;
        document.getElementById('studentName').value = lastStudent;
    }

    const loadResult = await fetchQuestions();
    
    if (!loadResult.success) {
        document.getElementById('app').innerHTML = `
            <div style="text-align:center; padding: 40px;">
                <h2 style="color: var(--danger-red); margin-bottom: 16px;">系統載入失敗</h2>
                <p style="color: var(--text-primary); font-size: 1.2rem; font-weight: bold; background: #fee2e2; padding: 10px; border-radius: 8px;">
                    錯誤原因：${loadResult.message}
                </p>
                <p style="color: var(--text-secondary); margin-top: 20px;">請打開 JSON 檔案檢查，或確認 GitHub 上的檔案路徑是否正確。</p>
            </div>`;
        return;
    }

    document.getElementById('start-btn').addEventListener('click', handleStartExam);
    document.getElementById('btn-submit-exam').addEventListener('click', handleSubmitExam);
    document.getElementById('btn-restart').addEventListener('click', handleRestart);
    document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);
    document.getElementById('btn-export-pdf').addEventListener('click', exportToPDF);

    document.getElementById('question-container').addEventListener('input', (e) => {
        if (e.target.classList.contains('answer-input') || e.target.classList.contains('answer-select')) {
            const blankId = e.target.getAttribute('data-blank-id');
            recordAnswer(blankId, e.target.value);
        }
    });
});

function handleStartExam() {
    try {
        const studentName = document.getElementById('studentName').value.trim();
        const examMode = document.getElementById('examMode').value;
        const questionCount = parseInt(document.getElementById('questionCount').value, 10);
        
        const categories = Array.from(document.querySelectorAll('#categories-container input:checked')).map(cb => cb.value);
        const levels = Array.from(document.querySelectorAll('#levels-container input:checked')).map(cb => cb.value);
        const ranges = Array.from(document.querySelectorAll('#ranges-container input:checked')).map(cb => cb.value);

        if (!studentName) return alert("請輸入學生姓名！");
        if (categories.length === 0) return alert("請至少選擇一種題庫分類！");
        if (levels.length === 0) return alert("請至少選擇一種難易度！");
        if (ranges.length === 0) return alert("請至少選擇一個題庫範圍！");

        state.user.name = studentName;
        state.config.mode = examMode;
        state.config.count = questionCount;
        state.config.categories = categories; 
        state.config.levels = levels;         
        state.config.ranges = ranges;         

        buildQuestionPool();
        
        if (state.examState.currentPool.length === 0) {
            return alert("您選擇的交集範圍內沒有題目，請嘗試勾選更多分類或範圍！");
        }

        generateExam();
        
        const modeText = examMode === 'fill' ? '填空' : '選擇';
        document.getElementById('exam-info').innerText = `考生：${state.user.name} ｜ ${modeText} ｜ 共 ${state.examState.activeExam.length} 題`;
        
        renderExam();
        switchScreen('setup', 'exam');
        
    } catch (error) {
        console.error("產生考卷時發生嚴重錯誤：", error);
        alert(`系統發生錯誤無法產出考卷：\n${error.message}\n請截圖或打開 F12 開發者工具查看詳細死因。`);
    }
}

function handleSubmitExam() {
    const confirmSubmit = confirm("確定要交卷嗎？未填寫的空格將視為錯誤。");
    if (!confirmSubmit) return;

    const result = evaluateExam();
    saveResultToHistory(result.score, result.totalBlanks, result.mistakes);
    
    renderReview(result);
    switchScreen('exam', 'review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleRestart() {
    resetExamState();
    switchScreen('review', 'setup');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchScreen(from, to) {
    document.querySelector(`[data-screen="${from}"]`).classList.remove('is-active');
    document.querySelector(`[data-screen="${to}"]`).classList.add('is-active');
}

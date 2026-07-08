import { state } from './store.js';

export function renderExam() {
    const container = document.getElementById('question-container');
    container.innerHTML = ''; 

    const fragment = document.createDocumentFragment();
    const mode = state.config.mode;

    state.examState.activeExam.forEach((question, index) => {
        const card = document.createElement('div');
        card.className = 'question-card';

        let sentenceHtml = question.question.template;

        question.question.blanks.forEach(blank => {
            let inputHtml = '';

            if (mode === 'fill') {
                inputHtml = `<input type="text" class="answer-input" data-blank-id="${blank.id}" autocomplete="off">`;
            } else if (mode === 'choice') {
                const optionsHtml = blank.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
                inputHtml = `
                    <select class="answer-select" data-blank-id="${blank.id}">
                        <option value="" disabled selected>select...</option>
                        ${optionsHtml}
                    </select>
                `;
            }

            sentenceHtml = sentenceHtml.replace(`{${blank.id}}`, inputHtml);
        });

        // 🚀 新增：在右側顯示類別與 sentID
        card.innerHTML = `
            <div class="question-header">
                <span class="q-number">${index + 1}.</span>
                <span class="q-meta">${question.type} - ${question.sentID}</span>
            </div>
            <div class="question-body">
                ${sentenceHtml}
            </div>
        `;

        fragment.appendChild(card);
    });

    container.appendChild(fragment);
}

export function renderReview(scoreInfo) {
    const container = document.getElementById('review-container');
    const scoreDisplay = document.getElementById('score-display');
    
    container.innerHTML = '';
    
    scoreDisplay.innerHTML = `
        <div class="score-board">
            <h3>考生：${state.user.name}</h3>
            <p class="score-text"><strong>${scoreInfo.score}</strong> / 100</p>
            <p class="score-detail">答對 ${scoreInfo.correctCount} 個空格，總共 ${scoreInfo.totalBlanks} 個空格</p>
        </div>
    `;

    const fragment = document.createDocumentFragment();

    state.examState.activeExam.forEach((question, index) => {
        const card = document.createElement('div');
        card.className = 'question-card';

        let sentenceHtml = question.question.template;

        question.question.blanks.forEach(blank => {
            const userAnswer = state.examState.userAnswers[blank.id] || "未作答";
            const isCorrect = userAnswer.toLowerCase() === blank.correct_answer.toLowerCase();
            
            const statusClass = isCorrect ? 'is-correct' : 'is-wrong';
            
            let reviewHtml = `<span class="review-answer ${statusClass}">${userAnswer}</span>`;
            
            if (!isCorrect) {
                reviewHtml += `<span class="correct-answer-hint">${blank.correct_answer}</span>`;
            }

            sentenceHtml = sentenceHtml.replace(`{${blank.id}}`, reviewHtml);
        });

        // 🚀 檢討模式也同步顯示類別與 sentID
        card.innerHTML = `
            <div class="question-header">
                <span class="q-number">${index + 1}.</span>
                <span class="q-meta">${question.type} - ${question.sentID}</span>
            </div>
            <div class="question-body">
                ${sentenceHtml}
            </div>
        `;
        
        fragment.appendChild(card);
    });

    container.appendChild(fragment);
}

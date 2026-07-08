import { state } from './store.js';

function shuffle(array) {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

function generateOrderedOptions(hintVerb) {
    const verb = hintVerb.toLowerCase();
    
    if (verb === 'be') {
        return ['be', 'am', 'are', 'is', 'was', 'were', 'been', 'being', 'to be', 'to being'];
    }

    let forms = [];
    let foundInDict = false;

    let ed_trap = verb + 'ed';
    if (verb.endsWith('e')) {
        ed_trap = verb + 'd'; 
    } else if (/[^aeiou][aeiou][^aeiou]$/i.test(verb) && !/[wx]$/i.test(verb)) {
        ed_trap = verb + verb.slice(-1) + 'ed'; 
    } else if (verb.endsWith('y') && !/[aeiou]y$/i.test(verb)) {
        ed_trap = verb.slice(0, -1) + 'ied'; 
    }

    for (let v of state.verbMasterMap.values()) {
        if (v.base.toLowerCase() === verb) {
            forms = v.forms; 
            foundInDict = true;
            break;
        }
    }

    if (!foundInDict) {
        let s_form = verb + 's';
        if (verb.endsWith('y') && !/[aeiou]y$/.test(verb)) s_form = verb.slice(0, -1) + 'ies';
        else if (/[sxz]$|ch$|sh$/.test(verb)) s_form = verb + 'es';

        let ing_form = verb + 'ing';
        if (verb.endsWith('ie')) ing_form = verb.slice(0, -2) + 'ying';
        else if (verb.endsWith('e') && verb !== 'be') ing_form = verb.slice(0, -1) + 'ing';
        else if (/[^aeiou][aeiou][^aeiou]$/.test(verb) && !/[wx]$/.test(verb)) ing_form = verb + verb.slice(-1) + 'ing';

        forms = [verb, s_form, ed_trap, ed_trap, ing_form];
    }

    const ingForm = forms[forms.length - 1] || (verb + 'ing');
    let options = [];

    if (foundInDict) {
        options = [
            forms[0], 
            forms[1], 
            forms[2], 
            forms[3], 
            ed_trap,  
            forms[4], 
            `to ${verb}`, 
            `to ${ingForm}`
        ];
    } else {
        options = [...forms, `to ${verb}`, `to ${ingForm}`];
    }

    return Array.from(new Set(options));
}

export function buildQuestionPool() {
    state.examState.currentPool = [];
    
    const ranges = state.config.ranges.map(r => {
        const [s, e] = r.split('-');
        return { s: Number(s), e: Number(e) };
    });

    const filtered = state.rawQuestions.filter(q => {
        const matchCategory = state.config.categories.includes(q.type);
        const vId = Number(q.verbID);
        const matchRange = !isNaN(vId) && ranges.some(r => vId >= r.s && vId <= r.e);
        return matchCategory && matchRange;
    });

    // 🚀 核心修復：宣告全域空格計數器，確保 ID 絕對不會重複
    let globalBlankCounter = 0;

    filtered.forEach(q => {
        const mainBase = q.verb_info?.verbBase || '';

        if (!q.sentence) return;

        state.config.levels.forEach(level => {
            const levelData = q.sentence[level]; 
            if (!levelData || !levelData.question) return; 

            let templateStr = levelData.question;
            const blanks = [];

            templateStr = templateStr.replace(/(?:\(([^)]+)\)\s*)?(_{2,})/g, (match, p1, p2) => {
                // 🚀 核心修復：使用全域計數器來命名 ID
                const bId = `blank_${globalBlankCounter++}`;
                const hintVerb = p1 ? p1.trim() : mainBase; 
                
                const correctAns = (levelData.answer && levelData.answer[blanks.length]) ? levelData.answer[blanks.length] : '';

                let orderedOptions = generateOrderedOptions(hintVerb);

                if (correctAns && !orderedOptions.includes(correctAns)) {
                    orderedOptions.push(correctAns);
                }

                blanks.push({
                    id: bId,
                    correct_answer: correctAns,
                    options: orderedOptions
                });
                
                return (p1 ? `(${p1}) ` : '') + `{${bId}}`; 
            });

            state.examState.currentPool.push({
                ...q,
                question: { template: templateStr, blanks: blanks }
            });
        });
    });
}

export function generateExam() {
    const shuffledPool = shuffle(state.examState.currentPool);
    state.examState.activeExam = shuffledPool.slice(0, state.config.count);
    state.examState.userAnswers = {};
}

export function recordAnswer(blankId, value) {
    state.examState.userAnswers[blankId] = value.trim();
}

export function evaluateExam() {
    let correctCount = 0;
    let totalBlanks = 0;
    const mistakes = [];

    state.examState.activeExam.forEach(q => {
        q.question.blanks.forEach(blank => {
            totalBlanks++;
            const userAns = state.examState.userAnswers[blank.id] || "";
            const isCorrect = userAns.toLowerCase() === blank.correct_answer.toLowerCase();
            
            if (isCorrect) {
                correctCount++;
            } else {
                mistakes.push({
                    verb: q.verb_info?.verbBase || '未知動詞',
                    blankId: blank.id,
                    userAns: userAns || "未答",
                    correctAns: blank.correct_answer
                });
            }
        });
    });

    const score = totalBlanks === 0 ? 0 : Math.round((correctCount / totalBlanks) * 100);
    return { score, correctCount, totalBlanks, mistakes };
}

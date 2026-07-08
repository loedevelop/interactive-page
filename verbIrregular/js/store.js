const STORAGE_KEY = 'irregular_verbs_history';

export const state = {
    user: { name: "", timestamp: "" },
    config: { categories: [], levels: [], ranges: [], mode: "fill", count: 20 }, 
    verbMasterMap: new Map(), 
    rawQuestions: [],
    examState: { currentPool: [], activeExam: [], userAnswers: {} },
    history: []
};

export async function fetchQuestions() {
    try {
        const files = [
            './data/verbs.json',
            './data/sentence_verbtense.json',
            './data/sentence_phrase.json'
        ];

        // 1. 抓取檔案並嚴格檢查 404 狀態
        const responses = await Promise.all(files.map(url => fetch(url)));
        
        for (let i = 0; i < responses.length; i++) {
            if (!responses[i].ok) {
                // 如果找不到檔案，直接拋出具體檔名
                throw new Error(`找不到檔案 (404 Not Found)：${files[i]}`);
            }
        }

        // 2. 解析 JSON 並攔截語法錯誤 (Syntax Error)
        let rawMaster, rawTense, rawPhrase;
        try { rawMaster = await responses[0].json(); } catch(e) { throw new Error('verbs.json 內容有語法錯誤 (可能多逗號或少引號)'); }
        try { rawTense  = await responses[1].json(); } catch(e) { throw new Error('sentence_verbtense.json 內容有語法錯誤'); }
        try { rawPhrase = await responses[2].json(); } catch(e) { throw new Error('sentence_phrase.json 內容有語法錯誤'); }

        rawMaster.forEach(verb => {
            state.verbMasterMap.set(String(verb.verbID), {
                base: verb.verbBase,
                forms: verb.verbForm, 
                zh: verb.verbBaseCN
            });
        });

        state.rawQuestions = [...rawTense, ...rawPhrase];

        state.rawQuestions.forEach(q => {
            const verbInfo = state.verbMasterMap.get(String(q.verbID));
            if (verbInfo) {
                q.verb_info = {
                    verbBase: verbInfo.base,
                    verbForm: verbInfo.forms,
                    zh: verbInfo.zh
                };
            }
        });

        return { success: true };
    } catch (e) {
        console.error("系統初始化失敗:", e);
        // 回傳具體的錯誤訊息給前端
        return { success: false, message: e.message };
    }
}

export function loadHistory() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state.history = JSON.parse(saved);
}

export function saveResultToHistory(score, total, mistakes) {
    const record = { 
        studentName: state.user.name, 
        timestamp: new Date().toLocaleString('zh-TW'), 
        mode: state.config.mode, 
        score, 
        total, 
        mistakes 
    };
    state.history.push(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history));
    return record;
}

export function resetExamState() {
    state.examState.activeExam = [];
    state.examState.userAnswers = {};
}

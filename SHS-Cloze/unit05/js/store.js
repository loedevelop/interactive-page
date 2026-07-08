// js/store.js
import { dictionaryRaw } from '../data/dictionary.js';

// 🚀 從 localStorage 喚醒記憶：讀取多帳號黑名單與上次登入者
const savedBlacklists = JSON.parse(localStorage.getItem('vocabBlacklistsV1')) || { "預設訪客": [] };
const savedUser = localStorage.getItem('vocabCurrentUserV1') || "預設訪客";
if (!savedBlacklists[savedUser]) savedBlacklists[savedUser] = []; // 確保有預設陣列

export const state = {
    dictionaryData: [],
    isExplanationMode: false,
    parsedOptions: {},
    currentTargetWrapper: null,
    currentEditingDictId: null,
    selectedOptionText: "",
    allTopics: {},
    currentDictRaw: dictionaryRaw,
    
    // 🚀 多帳號黑名單系統狀態
    currentUser: savedUser,
    userBlacklists: savedBlacklists
};

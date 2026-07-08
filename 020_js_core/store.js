/**
 * 📂 檔案路徑：020_js_core/store.js
 * 🌟 v5.0 白皮書終極版：全面導入情境身分制與 IndexedDB 離線防護佇列 (Offline-First)
 * 描述：全域狀態管理 (State Management)。絕對解耦，不碰 DOM。
 */

const AppStore = (() => {
    // ==========================================
    // 1. 全域狀態樹 (State Tree)
    // ==========================================
    let state = {
        currentUser: null,       // 真實使用者資訊 (由 Auth 閘道動態注入)
        activeContext: null,     // 當前活動情境 (例如: { classId: '...', role: 'student' })
        
        assignments: [],         // 該情境下的作業清單
        progress: {},            // 進度狀態 { "taskId": true/false }
        
        isSyncing: false         // 防止背景同步重複執行的鎖定標記
    };

    // ==========================================
    // 2. 初始化與情境注入 (Initialization & Context)
    // ==========================================
    
    /**
     * 系統啟動與依賴檢查：由 auth-guard 或登入分流邏輯呼叫，注入真實 Session
     */
    const initSession = async (user, context) => {
        if (!user || !user.id) {
            console.error("[Store 嚴重錯誤] 拒絕初始化：未提供有效的 Supabase 使用者身分。");
            return;
        }

        if (!window.localforage) {
            console.warn("[Store 警告] 未偵測到 localforage 套件！背景同步與離線防護將退化。請確認 HTML 有引入 localforage。");
        } else {
            // 初始化專屬此使用者的 IndexedDB 儲存庫
            window.localforage.config({
                name: 'LogOnWebDB',
                storeName: `SyncQueue_${user.id}`
            });
        }

        state.currentUser = { id: user.id, email: user.email };
        state.activeContext = context || null;

        // 啟動背景巡邏兵：每 10 秒檢查一次佇列 (白皮書：網頁端背景同步佇列)
        setInterval(processSyncQueue, 10000);
        console.info(`[Store] ✅ 初始化完成。當前真實身分 UID: ${user.id}`);
    };

    /**
     * 載入初始業務資料
     */
    const loadInitialData = async () => {
        if (!state.currentUser) {
            console.error("[Store 錯誤] 尚未完成 initSession() 注入真實身分，拒絕載入資料。");
            return;
        }

        try {
            // 1. 透過全新強化的 API 抓取真實作業包
            state.assignments = await window.ApiService.fetchAssignments(state.currentUser.id);
            
            // 2. 初始狀態重置。真實架構中應由 API 獲取初始 progress，
            // 若有尚未同步完成的離線操作，則疊加覆蓋上去 (Optimistic Merge)
            state.progress = {};
            if (window.localforage) {
                const pendingQueue = await window.localforage.getItem('sync_queue') || [];
                pendingQueue.forEach(item => {
                    if (item.action_type === 'mark_homework_complete') {
                        state.progress[item.payload.taskId] = item.payload.isCompleted;
                    }
                });
            }

            // 3. 發送事件通知 UI 渲染
            const eventName = (window.APP_CONFIG && window.APP_CONFIG.EVENTS && window.APP_CONFIG.EVENTS.DATA_LOADED) 
                              ? window.APP_CONFIG.EVENTS.DATA_LOADED 
                              : 'APP_DATA_LOADED';
            document.dispatchEvent(new CustomEvent(eventName));
            
        } catch (error) {
            console.error("[Store Error - loadInitialData]", error);
            document.dispatchEvent(new CustomEvent('APP_ERROR', { detail: "資料載入失敗，請檢查網路連線。" }));
        }
    };

    // ==========================================
    // 3. 業務操作與離線佇列 (Actions & Sync Queue)
    // ==========================================

    /**
     * 切換作業完成狀態 (樂觀更新 + 寫入同步佇列)
     */
    const toggleTask = async (taskId, isCompleted) => {
        if (!state.currentUser) return;

        // 1. 【極速前景回饋 (Optimistic UI)】：立刻更新本地 Memory State
        state.progress[taskId] = isCompleted;
        
        // 🚫 徹底廢除直接寫入 localStorage 的脆弱做法
        
        // 2. 通知 UI 立刻變更打勾畫面 (絕對不等待伺服器 API 回應)
        const updateEventName = (window.APP_CONFIG && window.APP_CONFIG.EVENTS && window.APP_CONFIG.EVENTS.PROGRESS_UPDATED) 
                              ? window.APP_CONFIG.EVENTS.PROGRESS_UPDATED 
                              : 'PROGRESS_UPDATED';
        document.dispatchEvent(new CustomEvent(updateEventName));

        // 3. 【離線優先防護】：將動作封裝並推入 IndexedDB 佇列
        if (window.localforage) {
            try {
                let queue = await window.localforage.getItem('sync_queue') || [];
                
                // 去重與狀態覆寫：如果佇列中已經有同一個 taskId 的任務，直接覆寫狀態，避免連續點擊產生無謂的 API 請求
                const existingIndex = queue.findIndex(item => 
                    item.action_type === 'mark_homework_complete' && item.payload.taskId === taskId
                );
                
                if (existingIndex > -1) {
                    queue[existingIndex].payload.isCompleted = isCompleted;
                    queue[existingIndex].timestamp = Date.now();
                } else {
                    queue.push({
                        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
                        action_type: 'mark_homework_complete',
                        payload: { studentId: state.currentUser.id, taskId, isCompleted },
                        status: 'pending',
                        timestamp: Date.now()
                    });
                }
                
                await window.localforage.setItem('sync_queue', queue);
                
                // 動作推入後，主動喚醒一次巡邏兵，不需要死等 10 秒
                processSyncQueue();
            } catch (error) {
                console.error("[Store] 寫入 IndexedDB 失敗", error);
            }
        } else {
            // 退化模式：沒有 localforage 則直接打 API (無離線防護)
            try {
                await window.ApiService.syncProgress(state.currentUser.id, taskId, isCompleted);
            } catch (error) {
                console.error("[Store] 無防護同步失敗", error);
            }
        }
    };

    /**
     * 背景巡邏兵：負責將 IndexedDB 內的待辦事項批次發送給 Supabase API
     */
    const processSyncQueue = async () => {
        // 如果正在同步中、斷線、或是沒有引入 localforage，就暫停執行
        if (state.isSyncing || !navigator.onLine || !window.localforage || !state.currentUser) return;
        
        try {
            state.isSyncing = true;
            let queue = await window.localforage.getItem('sync_queue') || [];
            
            if (queue.length === 0) {
                state.isSyncing = false;
                return;
            }

            console.info(`[Store Sync] 🔄 偵測到 ${queue.length} 筆離線操作，開始背景同步...`);
            const failedItems = [];

            // 逐一消耗佇列
            for (const item of queue) {
                if (item.action_type === 'mark_homework_complete') {
                    try {
                        // 呼叫 API 執行原子化寫入
                        await window.ApiService.syncProgress(
                            item.payload.studentId, 
                            item.payload.taskId, 
                            item.payload.isCompleted
                        );
                    } catch (apiError) {
                        console.warn(`[Store Sync] ⚠️ 任務 ${item.id} 同步失敗，保留於佇列等待網路恢復。`);
                        // 如果 API 回報失敗 (例如 500或斷網)，將這筆任務保留在 failedItems 中
                        failedItems.push(item);
                    }
                }
            }

            // 更新佇列 (成功同步的不會被 push 進 failedItems，等同於從佇列永久清除)
            await window.localforage.setItem('sync_queue', failedItems);
            
            if (failedItems.length === 0) {
                console.info("[Store Sync] ✅ 所有離線操作已成功同步至伺服器。");
            }

        } catch (error) {
            console.error("[Store Sync Error] 背景同步巡邏兵發生嚴重錯誤:", error);
        } finally {
            state.isSyncing = false;
        }
    };

    return {
        initSession,
        loadInitialData,
        toggleTask,
        // 回傳 state 的深拷貝，防止外部直接竄改狀態 (Immutability)
        getState: () => JSON.parse(JSON.stringify(state))
    };
})();

window.AppStore = AppStore;

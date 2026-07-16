/**
 * 📂 檔案路徑：110_teacher_core/service-line-notify.js
 * 🌟 LINE Notify 推播微服務：
 * 1. 負責將 JSON 巢狀作業資料 (AST) 解析並扁平化為乾淨的純文字。
 * 2. 自動過濾 HTML 標籤。
 * 3. 呼叫 Supabase Edge Function 繞過 CORS 限制安全發送。
 */

window.ServiceLineNotify = (() => {

    // 工具：將巢狀任務結構轉為純文字清單 (DFS 遞迴)
    function formatTasksToText(tasks, depth = 0) {
        let text = '';
        const indent = '  '.repeat(depth); // 根據深度縮排
        
        tasks.forEach((t, idx) => {
            // 過濾掉所有的 HTML Tag，保留純文字
            let cleanTitle = t.title ? t.title.replace(/<[^>]*>?/gm, '').trim() : '未命名任務';
            
            if (t.type === 'group') {
                text += `${indent}🗂️ 【${cleanTitle}】\n`;
                if (t.subTasks && t.subTasks.length > 0) {
                    text += formatTasksToText(t.subTasks, depth + 1);
                }
            } else {
                let icon = t.type === 'link' ? '🔗' : (t.type === 'drive' ? '📁' : '📌');
                let dueStr = t.due_date ? ` (期限: ${t.due_date})` : '';
                text += `${indent}${icon} ${idx + 1}. ${cleanTitle}${dueStr}\n`;
                
                if (t.type === 'link' && t.url) {
                    text += `${indent}   網址: ${t.url}\n`;
                }
            }
        });
        return text;
    }

    async function pushAssignment(classId, assignId) {
        try {
            // 1. 取得作業資料
            const { data: assignData, error: assignErr } = await window.supabaseClient
                .from('assignments')
                .select('*')
                .eq('id', assignId)
                .single();
                
            if (assignErr || !assignData) throw new Error('找不到作業資料');

            // 2. 取得班級與 LINE Token
            const { data: classData, error: classErr } = await window.supabaseClient
                .from('classes')
                .select('*')
                .eq('id', classId)
                .single();
                
            if (classErr || !classData) throw new Error('找不到班級資料');

            let rawData = classData.raw_data || {};
            if (typeof rawData === 'string') {
                try { rawData = JSON.parse(rawData); } catch(e) { rawData = {}; }
            }

            const token = rawData.line_notify_token;
            if (!token) {
                throw new Error('此班級尚未綁定 LINE Notify Token');
            }

            // 3. 組合推播文字訊息
            const cleanAssignTitle = assignData.title ? assignData.title.replace(/<[^>]*>?/gm, '').trim() : '未命名區塊';
            
            let msg = `\n📢 【新作業發布通知】\n`;
            msg += `🏫 班級：${classData.name}\n`;
            msg += `📅 日期：${assignData.target_date}\n`;
            msg += `📝 標題：${cleanAssignTitle}\n`;
            if (assignData.due_date) {
                msg += `⏰ 區塊期限：${assignData.due_date}\n`;
            }
            msg += `----------------------\n`;
            
            if (assignData.tasks && assignData.tasks.length > 0) {
                msg += formatTasksToText(assignData.tasks);
            } else {
                msg += `(無附帶詳細任務項目)\n`;
            }
            
            msg += `----------------------\n`;
            msg += `👉 請同學記得登入系統查看詳細內容與繳交作業！`;

            // 4. 呼叫 Supabase Edge Function 發送 (繞過 CORS 限制)
            const { data, error } = await window.supabaseClient.functions.invoke('line-notify', {
                body: { 
                    token: token, 
                    message: msg 
                }
            });

            if (error) {
                console.error('Edge Function 呼叫失敗:', error);
                throw new Error('無法連線到推播伺服器 (請確認 Supabase Edge Function 是否已部署)');
            }

            if (data && data.status !== 200) {
                throw new Error(data.message || 'LINE 伺服器拒絕了發送請求，請檢查 Token 是否正確');
            }

            return true;
        } catch (err) {
            console.error('Push Error:', err);
            throw err;
        }
    }

    return {
        pushAssignment
    };
})();
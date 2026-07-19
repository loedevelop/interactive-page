/**
 * 📂 檔案路徑：120_student_core/ui-audio-templates.js
 * 🌟 學生端錄音艙視覺模板工廠：
 * 🚀 v25 沉浸式內嵌大改版：
 * 1. 導入動態 iFrame 內嵌，自動轉換 Google Drive 的 /view 為 /preview，讓 PDF 直貼滿版呈現。
 * 2. 採用 Flexbox 下方 Dock，釋放 85% 螢幕空間給閱讀區，計時與錄音按鈕永遠精準置中。
 */

window.UIAudioTemplates = {
    getRecordingStudioHTML: function(transcriptText, taskTitle, materialUrl, materialRange) {
        const safeText = transcriptText ? String(transcriptText).replace(/\n/g, '<br>') : '<span style="color: #9ca3af; font-style: italic;">（老師未提供文字原稿，請直接錄音）</span>';
        const displayTitle = taskTitle || '未命名錄音作業';
        
        // 🌟 核心引擎：判斷是否為 Google Drive，自動轉換為預覽模式 iFrame
        let embedUrl = '';
        if (materialUrl && materialUrl.trim() !== '') {
            embedUrl = materialUrl.trim();
            if (embedUrl.includes('drive.google.com') && embedUrl.includes('/view')) {
                embedUrl = embedUrl.replace(/\/view.*$/, '/preview');
            }
        }

        let upperSectionHtml = '';
        
        if (embedUrl) {
            let rangeText = materialRange ? `<span style="font-size:0.85rem; color:#64748b; margin-left:8px;">(指定範圍：${materialRange})</span>` : '';
            upperSectionHtml = `
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 15px 24px; gap: 10px;">
                    <details style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 8px; outline: none; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <summary style="padding: 10px 16px; font-size: 0.95rem; color: #a16207; font-weight: 800; cursor: pointer; outline: none;">
                            📄 點擊展開/收合：朗讀原稿 (Transcript)
                        </summary>
                        <div style="padding: 0 16px 16px 16px; font-size: 1.05rem; color: #334155; line-height: 1.6; max-height: 200px; overflow-y: auto; border-top: 1px dashed #fef08a; margin-top: 4px; padding-top: 10px;">
                            ${safeText}
                        </div>
                    </details>
                    
                    <div style="padding: 8px 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; flex-shrink: 0;">
                        <span style="font-weight: 800; color: #166534; font-size: 0.95rem;">📂 參考教材：</span>
                        <a href="${materialUrl}" target="_blank" style="background: #3b82f6; color: white; padding: 4px 10px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">
                            ↗️ 另開視窗 (若預覽失效請點此)
                        </a>
                        ${rangeText}
                    </div>
                    
                    <div style="flex: 1; width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid #cbd5e1; background: #f1f5f9; display: flex; flex-direction: column;">
                        <iframe src="${embedUrl}" style="width: 100%; height: 100%; flex: 1; border: none;" allow="autoplay"></iframe>
                    </div>
                </div>
            `;
        } else {
            // 如果沒有網址，原稿區則佔據滿版
            upperSectionHtml = `
                <div style="flex: 1; overflow-y: auto; padding: 24px;">
                    <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 12px; padding: 20px; min-height: 100%;">
                        <h4 style="margin-top: 0; color: #a16207; font-weight: 800; font-size: 1.1rem; border-bottom: 1px dashed #fef08a; padding-bottom: 10px; margin-bottom: 15px;">📄 朗讀原稿 (Transcript)</h4>
                        <div style="font-size: 1.15rem; color: #334155; line-height: 1.8; font-family: serif;">
                            ${safeText}
                        </div>
                    </div>
                </div>
            `;
        }

        return `
        <div id="audio-studio-modal" style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);">
            <!-- 🌟 視窗展開至 1200px，高度 95vh 確保最佳閱讀空間 -->
            <div style="background-color: #ffffff; border-radius: 16px; width: 95%; max-width: 1200px; height: 95vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- 頂部 Header -->
                <div style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700; letter-spacing: 0.025em;">🎙️ 錄音艙：${displayTitle}</h2>
                    <button id="btn-audio-close" style="background: none; border: none; color: #ffffff; cursor: pointer; font-size: 1.8rem; line-height: 1; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">&times;</button>
                </div>

                <!-- 上半：智能內容區 (依據有無 iFrame 自動切換版型) -->
                <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden; background-color: #f8fafc;">
                    ${upperSectionHtml}
                </div>

                <!-- 下半：扁平化 Dock 控制區 -->
                <div style="height: 80px; flex-shrink: 0; background-color: #ffffff; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; box-shadow: 0 -4px 10px rgba(0,0,0,0.03);">
                    
                    <!-- 左側：狀態與計時器 (flex: 1 保證等距) -->
                    <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <div id="audio-status-dot" style="width: 12px; height: 12px; border-radius: 50%; background-color: #cbd5e1; transition: background-color 0.3s;"></div>
                            <span id="audio-status-text" style="color: #64748b; font-weight: 800; font-size: 0.85rem; text-transform: uppercase; white-space: nowrap;">準備就緒</span>
                        </div>
                        <div style="width: 1px; height: 30px; background: #e2e8f0;"></div>
                        <div id="audio-timer-display" style="font-family: monospace; font-size: 2.2rem; color: #0f172a; font-weight: 700; line-height: 1;">05:00</div>
                    </div>

                    <!-- 中央：主控按鈕 (flex: 0 0 auto 鎖定置中) -->
                    <div style="display: flex; gap: 15px; justify-content: center; flex: 0 0 auto;">
                        <button id="btn-audio-start" style="width: 55px; height: 55px; border-radius: 50%; background-color: #ef4444; color: #ffffff; border: none; font-size: 1.8rem; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.4); transition: 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">🔴</button>
                        <button id="btn-audio-pause" style="display: none; width: 50px; height: 50px; border-radius: 50%; background-color: #f59e0b; color: #ffffff; border: none; font-size: 1.5rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.4);">⏸️</button>
                        <button id="btn-audio-resume" style="display: none; width: 50px; height: 50px; border-radius: 50%; background-color: #3b82f6; color: #ffffff; border: none; font-size: 1.5rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.4);">▶️</button>
                        <button id="btn-audio-stop" style="display: none; width: 55px; height: 55px; border-radius: 50%; background-color: #1e293b; color: #ffffff; border: none; font-size: 1.8rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(31, 41, 55, 0.4);">⏹️</button>
                    </div>

                    <!-- 右側：預覽與繳交 (flex: 1 保證等距靠右) -->
                    <div style="flex: 1; display: flex; justify-content: flex-end;">
                        <div id="audio-preview-section" style="display: none; align-items: center; gap: 15px; width: 100%; max-width: 450px;">
                            <audio id="audio-playback" controls style="height: 40px; flex: 1; outline: none; min-width: 150px;"></audio>
                            <button id="btn-audio-retry" style="padding: 8px 16px; background-color: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.95rem; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">🔄 重錄</button>
                            <button id="btn-audio-submit" style="padding: 8px 20px; background-color: #10b981; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 0.95rem; white-space: nowrap; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4);">🚀 繳交</button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
        `;
    }
};
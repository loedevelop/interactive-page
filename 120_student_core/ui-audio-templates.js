/**
 * 📂 檔案路徑：120_student_core/ui-audio-templates.js
 * 🌟 學生端錄音艙視覺模板工廠：
 * 🚀 v31 神級 UX 重構 (The Ultimate Fit-to-Width Exploit)：
 * 1. 徹底合併雙層 Header，將垂直高度還原給 iFrame。
 * 2. 利用 Google Drive Fit-to-Height 的物理法則，迫使 A4 比例的視窗自然撐滿寬度。
 */

window.UIAudioTemplates = {
    getRecordingStudioHTML: function(transcriptText, taskTitle, materialUrl, materialRange) {
        
        function escapeHTML(str) { return str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''; }
        
        const displayTitle = taskTitle || '未命名錄音作業';
        const hasText = transcriptText && transcriptText.trim() !== '';
        const safeText = hasText ? String(transcriptText).replace(/\n/g, '<br>') : '';
        
        let embedUrl = '';
        let newWindowBtnHtml = '';
        let rangeText = '';
        let toggleBtnHtml = '';

        if (materialUrl && materialUrl.trim() !== '') {
            embedUrl = materialUrl.trim();
            if (embedUrl.includes('drive.google.com') && embedUrl.includes('/view')) {
                embedUrl = embedUrl.replace(/\/view.*$/, '/preview');
            }

            if (materialRange) {
                // 配合紫底修改字體顏色為微透白，避免深灰字體在深色背景吃色
                rangeText = `<span style="font-size:0.85rem; color:rgba(255, 255, 255, 0.85); margin-left:8px; font-weight: normal;">(指定範圍：${escapeHTML(materialRange)})</span>`;
            }
            
            // 按鈕改為白底紫字，完美契合紫色標題列
            newWindowBtnHtml = `
                <a href="${escapeHTML(materialUrl)}" target="_blank" style="background: #ffffff; color: #4f46e5; padding: 4px 12px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; transition: 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.1);" onmouseover="this.style.backgroundColor='#f8fafc'" onmouseout="this.style.backgroundColor='#ffffff'">
                    ↗️ 另開視窗
                </a>
            `;
        }

        // 當存在教材或原稿時，才渲染展開/收合按鈕
        if (hasText || embedUrl) {
            toggleBtnHtml = `
                <button onclick="
                    const container = document.getElementById('audio-modal-container');
                    const body = document.getElementById('audio-material-body');
                    if(container.classList.contains('is-collapsed')) {
                        container.classList.remove('is-collapsed');
                        body.style.display = 'flex';
                        this.innerHTML = '🔽 收合教材';
                    } else {
                        container.classList.add('is-collapsed');
                        body.style.display = 'none';
                        this.innerHTML = '📄 展開教材';
                    }
                " style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; transition: 0.2s; white-space: nowrap;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                    🔽 收合教材
                </button>
            `;
        }

        // 🌟 拔除 padding 並注入 #323639 背景，讓 PDF 100% 無縫融入
        let bodyHtml = '';
        if (hasText) {
            bodyHtml += `<div style="padding: 16px 24px; font-size: 1.05rem; color: #334155; line-height: 1.6; max-height: 150px; overflow-y: auto; background: #ffffff; ${embedUrl ? 'border-bottom: 1px solid #1e293b; flex-shrink: 0;' : 'flex: 1;'}">${safeText}</div>`;
        }
        if (embedUrl) {
            bodyHtml += `<iframe src="${embedUrl}" style="width: 100%; height: 100%; flex: 1; border: none; display: block; background: #323639;" allow="autoplay"></iframe>`;
        }
        if (!hasText && !embedUrl) {
            bodyHtml += `<div style="padding: 20px; color: #9ca3af; font-style: italic; text-align: center; flex: 1; display: flex; align-items: center; justify-content: center; background: #ffffff;">（老師未提供任何教材或原稿，請直接錄音）</div>`;
        }

        let upperSectionHtml = '';
        let defaultCollapsed = '';

        if (hasText || embedUrl) {
            upperSectionHtml = `
                <div class="audio-upper" style="display: flex; flex-direction: column; overflow: hidden; transition: all 0.4s ease; background-color: #323639;">
                    <!-- 內部組合內容區 (不再有獨立的 Header) -->
                    <div id="audio-material-body" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; width: 100%; background: #323639;">
                        ${bodyHtml}
                    </div>
                </div>
            `;
        } else {
            // 若完全無文本也無講義，預設進入全螢幕錄音室模式
            defaultCollapsed = 'is-collapsed';
        }

        return `
        <style>
            /* 基礎佈局與轉場 */
            #audio-modal-container { display: flex; flex-direction: column; overflow: hidden; }
            .audio-dock { display: flex; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); background-color: #ffffff; }
            .dock-left, .dock-center, .dock-right { display: flex; align-items: center; transition: all 0.4s ease; }
            .timer-text { font-family: monospace; font-weight: 700; transition: all 0.4s ease; color: #0f172a; }
            .ctrl-btn { border: none; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; border-radius: 50%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
            .ctrl-btn:hover { transform: scale(1.05); }

            /* === 閱讀模式 (Expanded Dock Mode) === */
            #audio-modal-container:not(.is-collapsed) .audio-upper { flex: 1; }
            #audio-modal-container:not(.is-collapsed) .audio-dock { height: 80px; flex-shrink: 0; flex-direction: row; justify-content: space-between; padding: 0 24px; border-top: 1px solid #e2e8f0; }
            #audio-modal-container:not(.is-collapsed) .dock-left { flex: 1; flex-direction: row; justify-content: flex-start; gap: 15px; }
            #audio-modal-container:not(.is-collapsed) .dock-center { flex: 0 0 auto; flex-direction: row; justify-content: center; gap: 15px; }
            #audio-modal-container:not(.is-collapsed) .dock-right { flex: 1; flex-direction: row; justify-content: flex-end; }
            
            #audio-modal-container:not(.is-collapsed) .status-badge { flex-direction: row; gap: 6px; }
            #audio-modal-container:not(.is-collapsed) .status-divider { display: block; width: 1px; height: 30px; background: #e2e8f0; margin: 0; }
            #audio-modal-container:not(.is-collapsed) .timer-text { font-size: 2.2rem; line-height: 1; }
            #audio-modal-container:not(.is-collapsed) .ctrl-btn { width: 55px; height: 55px; font-size: 1.8rem; }

            /* === 錄音室模式 (Collapsed Studio Mode) === */
            #audio-modal-container.is-collapsed .audio-upper { flex: 0 0 auto; padding-bottom: 0; }
            #audio-modal-container.is-collapsed .audio-dock { flex: 1; height: auto; flex-direction: column; justify-content: center; align-items: center; padding: 40px; background-color: #f8fafc; border-top: none; }
            #audio-modal-container.is-collapsed .dock-left { flex: 0 0 auto; flex-direction: column; justify-content: center; gap: 20px; margin-bottom: 40px; }
            #audio-modal-container.is-collapsed .dock-center { flex: 0 0 auto; flex-direction: row; justify-content: center; gap: 30px; margin-bottom: 50px; }
            #audio-modal-container.is-collapsed .dock-right { flex: 0 0 auto; flex-direction: row; justify-content: center; width: 100%; max-width: 450px; }
            
            #audio-modal-container.is-collapsed .status-badge { flex-direction: column; gap: 10px; transform: scale(1.2); margin-bottom: 10px;}
            #audio-modal-container.is-collapsed .status-divider { display: none; }
            #audio-modal-container.is-collapsed .timer-text { font-size: 6.5rem; line-height: 1; color: #1e293b;}
            #audio-modal-container.is-collapsed .ctrl-btn { width: 90px; height: 90px; font-size: 3.5rem; }
        </style>

        <div id="audio-studio-modal" style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);">
            <!-- 🌟 核心重構：鎖定 max-width: 850px，強制塑造直式閱讀艙，讓 Google Drive 自動啟動 Fit to Width -->
            <div id="audio-modal-container" class="${defaultCollapsed}" style="background-color: #ffffff; border-radius: 16px; width: 95%; max-width: 850px; height: 95vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- 🌟 v31 頂部終極合併版 (The Unified Header) -->
                <div style="background-color: #4f46e5; color: #ffffff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 10;">
                    <!-- 左側：標題與展開收合控制 -->
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700; letter-spacing: 0.025em; white-space: nowrap;">🎙️ 錄音艙：${displayTitle}</h2>
                        ${toggleBtnHtml}
                        ${rangeText}
                    </div>
                    
                    <!-- 右側：功能鍵與關閉 -->
                    <div style="display: flex; align-items: center; gap: 12px;">
                        ${newWindowBtnHtml}
                        <button id="btn-audio-close" style="background: none; border: none; color: #ffffff; cursor: pointer; font-size: 1.8rem; line-height: 1; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">&times;</button>
                    </div>
                </div>

                <!-- 上半：教材區 (不再自帶 Header，完全釋放垂直空間) -->
                ${upperSectionHtml}

                <!-- 下半：雙模式 Dock 控制區 -->
                <div class="audio-dock" id="audio-dock-section">
                    
                    <!-- 左側：狀態與計時器 -->
                    <div class="dock-left">
                        <div class="status-badge" style="display: flex; align-items: center;">
                            <div id="audio-status-dot" style="width: 12px; height: 12px; border-radius: 50%; background-color: #cbd5e1; transition: background-color 0.3s;"></div>
                            <span id="audio-status-text" style="color: #64748b; font-weight: 800; font-size: 0.85rem; text-transform: uppercase; white-space: nowrap;">準備就緒</span>
                        </div>
                        <div class="status-divider"></div>
                        <div id="audio-timer-display" class="timer-text">05:00</div>
                    </div>

                    <!-- 中央：主控按鈕 -->
                    <div class="dock-center">
                        <button id="btn-audio-start" class="ctrl-btn" style="background-color: #ef4444;">🔴</button>
                        <button id="btn-audio-pause" class="ctrl-btn" style="display: none; background-color: #f59e0b;">⏸️</button>
                        <button id="btn-audio-resume" class="ctrl-btn" style="display: none; background-color: #3b82f6;">▶️</button>
                        <button id="btn-audio-stop" class="ctrl-btn" style="display: none; background-color: #1e293b;">⏹️</button>
                    </div>

                    <!-- 右側：預覽與繳交 -->
                    <div class="dock-right">
                        <div id="audio-preview-section" style="display: none; align-items: center; gap: 15px; width: 100%; max-width: 450px;">
                            <audio id="audio-playback" controls style="height: 40px; flex: 1; outline: none; min-width: 150px; background: white; border-radius: 8px;"></audio>
                            <button id="btn-audio-retry" style="padding: 8px 16px; background-color: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.95rem; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">🔄 重錄</button>
                            <button id="btn-audio-submit" style="padding: 8px 20px; background-color: #10b981; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.95rem; white-space: nowrap; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4); transition: 0.2s;" onmouseover="this.style.backgroundColor='#059669'" onmouseout="this.style.backgroundColor='#10b981'">🚀 繳交</button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
        `;
    }
};
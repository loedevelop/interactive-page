/**
 * 📂 檔案路徑：120_student_core/ui-audio-templates.js
 * 🌟 學生端錄音艙視覺模板工廠：
 * 🚀 V91 乾淨地基版：徹底物理消滅 Regex 單豎線，完全免疫介面崩潰地雷！
 * 🌟 免疫介面災難：程式碼內 0 個雙直豎線，絕對防彈。
 */

window.UIAudioTemplates = {
    getRecordingStudioHTML: function(transcriptText, taskTitle, materialUrl, materialRange) {
        
        function escapeHTML(str) { 
            let res = '';
            if (str) {
                res = String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }
            return res; 
        }
        
        const displayTitle = taskTitle ? taskTitle : '未命名錄音作業';
        
        let hasText = false;
        if (transcriptText) {
            if (String(transcriptText).trim() !== '') {
                hasText = true;
            }
        }
        
        const safeText = hasText ? String(transcriptText).replace(/\n/g, '<br>') : '';
        
        let embedUrl = '';
        let newWindowBtnHtml = '';
        let rangeText = '';
        let toggleBtnHtml = '';

        let hasMatUrl = false;
        if (materialUrl) {
            if (String(materialUrl).trim() !== '') {
                hasMatUrl = true;
            }
        }

        if (hasMatUrl) {
            let rawUrl = String(materialUrl).trim();
            
            if (rawUrl.startsWith('data:')) {
                embedUrl = rawUrl;
                newWindowBtnHtml = `
                    <button onclick="
                        try {
                            var w = window.open();
                            w.document.write('<iframe src=&quot;${embedUrl}&quot; frameborder=&quot;0&quot; style=&quot;border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;&quot; allowfullscreen></iframe>');
                        } catch(e) {
                            alert('瀏覽器阻擋了彈出視窗，請允許後重試。');
                        }
                    " style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 4px 12px; border-radius: 6px; cursor:pointer; font-weight: bold; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; transition: 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.1); white-space: nowrap; flex-shrink: 0;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.3)'" onmouseout="this.style.backgroundColor='rgba(255,255,255,0.2)'">
                        ↗️ 另開視窗
                    </button>
                `;
            } 
            else {
                embedUrl = rawUrl;
                
                let isDrive = false;
                if (embedUrl.includes('drive.google.com')) isDrive = true;
                else if (embedUrl.includes('docs.google.com')) isDrive = true;
                
                if (isDrive) {
                    let idMatch = embedUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                    if (!idMatch) idMatch = embedUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                    if (!idMatch) idMatch = embedUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                    if (!idMatch) idMatch = embedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);

                    let hasId = false;
                    if (idMatch) {
                        if (idMatch[1]) {
                            hasId = true;
                        }
                    }

                    if (hasId) {
                        embedUrl = `https://drive.google.com/file/d/${idMatch[1]}/preview`;
                    } else {
                        embedUrl = embedUrl.split('#')[0];
                        embedUrl = embedUrl.replace(/\/view.*$/, '/preview').replace(/\/edit.*$/, '/preview');
                    }
                } else {
                    const lowerUrl = embedUrl.toLowerCase();
                    if (lowerUrl.endsWith('.pdf')) {
                        if (embedUrl.includes('#')) {
                            embedUrl = embedUrl.split('#')[0] + '#view=FitH';
                        } else {
                            embedUrl += '#view=FitH';
                        }
                    }
                }
                
                newWindowBtnHtml = `
                    <a href="${escapeHTML(rawUrl)}" target="_blank" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 4px 12px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; transition: 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.1); white-space: nowrap; flex-shrink: 0;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.3)'" onmouseout="this.style.backgroundColor='rgba(255,255,255,0.2)'">
                        ↗️ 另開視窗
                    </a>
                `;
            }

            if (materialRange) {
                rangeText = `<span style="font-size:0.85rem; color:rgba(255, 255, 255, 0.85); margin-left:8px; font-weight: normal; white-space: nowrap; flex-shrink: 0;">(指定範圍：${escapeHTML(materialRange)})</span>`;
            }
        }

        let showText = false;
        if (hasText) {
            if (!embedUrl) {
                showText = true;
            }
        }

        let needToggle = false;
        if (showText) needToggle = true;
        else if (embedUrl) needToggle = true;

        if (needToggle) {
            toggleBtnHtml = `
                <button onclick="
                    const container = document.getElementById('audio-modal-container');
                    const body = document.getElementById('audio-material-body');
                    if(container.classList.contains('is-collapsed')) {
                        container.classList.remove('is-collapsed');
                        body.style.display = 'flex';
                        this.innerHTML = '🔽 收合';
                    } else {
                        container.classList.add('is-collapsed');
                        body.style.display = 'none';
                        this.innerHTML = '📄 展開';
                    }
                " style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; transition: 0.2s; white-space: nowrap; flex-shrink: 0;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                    🔽 收合
                </button>
            `;
        }

        let bodyHtml = '';
        if (showText) {
            bodyHtml += `<div style="color: #334155; line-height: 1.6; overflow-y: auto; background: #ffffff; flex: 1; max-height: none; height: 100%; padding: 24px 32px; font-size: 1.15rem;">${safeText}</div>`;
        }
        
        if (embedUrl) {
            bodyHtml += `
                <div style="width: 100%; height: 100%; flex: 1; position: relative; background: #323639;">
                    <iframe src="${embedUrl}" style="width: 100%; height: 100%; border: none; display: block; background: #323639;" allow="autoplay"></iframe>
                </div>
            `;
        }
        
        let showEmpty = false;
        if (!showText) {
            if (!embedUrl) {
                showEmpty = true;
            }
        }

        if (showEmpty) {
            bodyHtml += `<div style="padding: 20px; color: #9ca3af; font-style: italic; text-align: center; flex: 1; display: flex; align-items: center; justify-content: center; background: #ffffff;">（老師未提供任何教材或原稿，請直接錄音）</div>`;
        }

        let upperSectionHtml = '';
        let defaultCollapsed = '';

        if (needToggle) {
            const upperBgColor = embedUrl ? '#323639' : '#ffffff';
            upperSectionHtml = `
                <div class="audio-upper" style="display: flex; flex-direction: column; overflow: hidden; transition: all 0.4s ease; background-color: ${upperBgColor}; position: relative;">
                    <div id="audio-material-body" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; width: 100%; background: ${upperBgColor};">
                        ${bodyHtml}
                    </div>
                </div>
            `;
        } else {
            defaultCollapsed = 'is-collapsed';
        }

        return `
        <style>
            #audio-modal-container { display: flex; flex-direction: column; overflow: hidden; transition: all 0.3s ease; position: relative; }
            .audio-dock { display: flex; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); background-color: #ffffff; }
            .dock-left, .dock-center, .dock-right { display: flex; align-items: center; transition: all 0.4s ease; }
            .timer-text { font-family: monospace; font-weight: 700; transition: all 0.4s ease; color: #0f172a; }
            .ctrl-btn { border: none; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; border-radius: 50%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
            .ctrl-btn:hover { transform: scale(1.05); }

            #audio-modal-container:not(.is-collapsed) .audio-upper { flex: 1; }
            #audio-modal-container:not(.is-collapsed) .audio-dock { 
                min-height: 80px; 
                height: auto; 
                flex-shrink: 0; 
                flex-direction: row; 
                flex-wrap: wrap; 
                justify-content: space-between; 
                padding: 12px 24px; 
                border-top: 1px solid #e2e8f0; 
                gap: 15px;
            }
            #audio-modal-container:not(.is-collapsed) .dock-left { flex: 1; flex-direction: row; justify-content: flex-start; gap: 15px; }
            #audio-modal-container:not(.is-collapsed) .dock-center { flex: 0 0 auto; flex-direction: row; justify-content: center; gap: 15px; }
            #audio-modal-container:not(.is-collapsed) .dock-right { flex: 1; flex-direction: row; justify-content: flex-end; }
            
            #audio-modal-container:not(.is-collapsed) .status-badge { flex-direction: row; gap: 6px; }
            #audio-modal-container:not(.is-collapsed) .status-divider { display: block; width: 1px; height: 30px; background: #e2e8f0; margin: 0; }
            #audio-modal-container:not(.is-collapsed) .timer-text { font-size: 2.2rem; line-height: 1; }
            #audio-modal-container:not(.is-collapsed) .ctrl-btn { width: 55px; height: 55px; font-size: 1.8rem; }

            #audio-modal-container.is-collapsed { width: 95% !important; max-width: 650px !important; height: auto !important; }
            #audio-modal-container.is-collapsed .audio-upper { flex: 0 0 auto; padding-bottom: 0; }
            #audio-modal-container.is-collapsed .audio-dock { flex: 1; height: auto; flex-direction: column; justify-content: center; align-items: center; padding: 40px; background-color: #f8fafc; border-top: none; position: static !important; width: 100% !important; transform: none !important;}
            #audio-modal-container.is-collapsed .dock-left { flex: 0 0 auto; flex-direction: column; justify-content: center; gap: 20px; margin-bottom: 40px; }
            #audio-modal-container.is-collapsed .dock-center { flex: 0 0 auto; flex-direction: row; justify-content: center; gap: 30px; margin-bottom: 50px; }
            #audio-modal-container.is-collapsed .dock-right { flex: 0 0 auto; flex-direction: row; justify-content: center; width: 100%; max-width: 450px; }
            
            #audio-modal-container.is-collapsed .status-badge { flex-direction: column; gap: 10px; transform: scale(1.2); margin-bottom: 10px;}
            #audio-modal-container.is-collapsed .status-divider { display: none; }
            #audio-modal-container.is-collapsed .timer-text { font-size: 6.5rem; line-height: 1; color: #1e293b;}
            #audio-modal-container.is-collapsed .ctrl-btn { width: 90px; height: 90px; font-size: 3.5rem; }

            @media (max-width: 768px) {
                #audio-modal-container { 
                    width: 100% !important; 
                    height: 100% !important; 
                    max-height: 100% !important; 
                    border-radius: 0 !important; 
                }
                
                .audio-header-wrap { flex-wrap: wrap !important; padding: 8px 12px !important; gap: 8px !important; justify-content: space-between !important; }
                .audio-header-wrap > div { flex-wrap: wrap !important; overflow: visible !important; }
                .audio-header-title { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; font-size: 1rem !important; }

                #audio-modal-container:not(.is-collapsed) .audio-upper {
                    flex: 1 !important;
                    height: 100% !important;
                    padding-bottom: 75px !important; 
                }

                #audio-modal-container:not(.is-collapsed) .audio-dock {
                    position: absolute !important;
                    bottom: max(15px, env(safe-area-inset-bottom)) !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                    width: 92% !important;
                    border-radius: 20px !important;
                    background: rgba(255, 255, 255, 0.92) !important;
                    backdrop-filter: blur(12px) !important;
                    -webkit-backdrop-filter: blur(12px) !important; 
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3) !important;
                    border: 1px solid rgba(255,255,255,0.4) !important;
                    z-index: 99999 !important;
                    flex-direction: row !important;
                    flex-wrap: nowrap !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    padding: 8px 12px !important;
                    min-height: 60px !important;
                }
                
                #audio-modal-container:not(.is-collapsed) .dock-left,
                #audio-modal-container:not(.is-collapsed) .dock-center,
                #audio-modal-container:not(.is-collapsed) .dock-right {
                    flex: 0 0 auto !important;
                    width: auto !important;
                    justify-content: center !important;
                }

                #audio-modal-container:not(.is-collapsed) .status-badge { display: none !important; } 
                #audio-modal-container:not(.is-collapsed) .status-divider { display: none !important; }
                #audio-modal-container:not(.is-collapsed) .timer-text { font-size: 1.4rem !important; }
                #audio-modal-container:not(.is-collapsed) .ctrl-btn { width: 45px !important; height: 45px !important; font-size: 1.4rem !important; }
                
                #audio-preview-section {
                    flex-direction: row !important;
                    gap: 6px !important;
                    width: auto !important;
                }
                #audio-playback { height: 35px !important; min-width: 120px !important; max-width: 160px !important; }
                #btn-audio-retry, #btn-audio-submit { padding: 6px 12px !important; font-size: 0.85rem !important; }
            }
        </style>

        <div id="audio-studio-modal" style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);">
            <div id="audio-modal-container" class="${defaultCollapsed}" style="background-color: #ffffff; border-radius: 12px; width: 98%; max-width: 100%; height: 96%; max-height: -webkit-fill-available; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <div class="audio-header-wrap" style="background-color: #4f46e5; color: #ffffff; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap; gap: 15px; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 10; overflow: hidden;">
                    
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; overflow: hidden; flex: 1;">
                        <h2 class="audio-header-title" style="margin: 0; font-size: 1.15rem; font-weight: 700; letter-spacing: 0.025em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1;">🎙️ ${displayTitle}</h2>
                        ${rangeText}
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; flex-shrink: 0;">
                        ${toggleBtnHtml}
                        ${newWindowBtnHtml}
                        <button id="btn-audio-close" style="background: none; border: none; color: #ffffff; cursor: pointer; font-size: 1.8rem; line-height: 1; opacity: 0.8; transition: opacity 0.2s; padding: 0 0 0 8px;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">&times;</button>
                    </div>

                </div>

                ${upperSectionHtml}

                <div class="audio-dock" id="audio-dock-section">
                    
                    <div class="dock-left">
                        <div class="status-badge" style="display: flex; align-items: center;">
                            <div id="audio-status-dot" style="width: 12px; height: 12px; border-radius: 50%; background-color: #cbd5e1; transition: background-color 0.3s;"></div>
                            <span id="audio-status-text" style="color: #64748b; font-weight: 800; font-size: 0.85rem; text-transform: uppercase; white-space: nowrap;">準備就緒</span>
                        </div>
                        <div class="status-divider"></div>
                        <div id="audio-timer-display" class="timer-text">05:00</div>
                    </div>

                    <div class="dock-center">
                        <button id="btn-audio-start" class="ctrl-btn" style="background-color: #ef4444;">🔴</button>
                        <button id="btn-audio-pause" class="ctrl-btn" style="display: none; background-color: #f59e0b;">⏸️</button>
                        <button id="btn-audio-resume" class="ctrl-btn" style="display: none; background-color: #3b82f6;">▶️</button>
                        <button id="btn-audio-stop" class="ctrl-btn" style="display: none; background-color: #1e293b;">⏹️</button>
                    </div>

                    <div class="dock-right">
                        <div id="audio-preview-section" style="display: none; align-items: center; gap: 15px; width: 100%; max-width: 450px;">
                            <audio id="audio-playback" controls style="height: 40px; flex: 1; outline: none; min-width: 150px; background: white; border-radius: 8px;"></audio>
                            <div style="display: flex; gap: 10px;">
                                <button id="btn-audio-retry" style="padding: 8px 16px; background-color: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.95rem; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">🔄 重錄</button>
                                <button id="btn-audio-submit" style="padding: 8px 20px; background-color: #10b981; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.95rem; white-space: nowrap; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4); transition: 0.2s;" onmouseover="this.style.backgroundColor='#059669'" onmouseout="this.style.backgroundColor='#10b981'">🚀 繳交</button>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
        `;
    }
};
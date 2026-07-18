/**
 * 📂 檔案路徑：120_student_core/ui-audio-templates.js
 * 🌟 學生端錄音艙視覺模板工廠：外框鎖死、文字區獨立捲動、底部控制區極致壓縮
 */

window.UIAudioTemplates = {
    getRecordingStudioHTML: function(transcriptText, taskTitle) {
        // 安全處理跳行，若無文稿則顯示提示
        const safeText = transcriptText ? String(transcriptText).replace(/\n/g, '<br>') : '<span style="color: #9ca3af; font-style: italic;">（老師未提供文字原稿，請直接錄音）</span>';
        const displayTitle = taskTitle || '未命名錄音作業';
        
        return `
        <div id="audio-studio-modal" style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);">
            <!-- 🌟 鎖定外框高度為 85vh，不隨內容膨脹 -->
            <div style="background-color: #ffffff; border-radius: 16px; width: 95%; max-width: 900px; height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- 頂部 Header (固定高度) -->
                <div style="background-color: #4f46e5; color: #ffffff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: 0.025em;">🎙️ 錄音艙：${displayTitle}</h2>
                    <button id="btn-audio-close" style="background: none; border: none; color: #ffffff; cursor: pointer; font-size: 1.8rem; line-height: 1; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">&times;</button>
                </div>

                <!-- 🌟 內容區：彈性伸縮並處理捲動 -->
                <div style="display: flex; flex-direction: column; flex: 1; overflow: hidden; background-color: #f8fafc;">
                    
                    <!-- 上半：文稿區 (flex: 1 吃掉剩餘空間，內部開啟 y 軸捲動) -->
                    <div style="flex: 1; overflow-y: auto; padding: 20px 24px; border-bottom: 1px solid #e5e7eb;">
                        <details style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 12px; outline: none; transition: 0.3s;" open>
                            <summary style="padding: 12px 16px; font-size: 1rem; color: #a16207; font-weight: 800; cursor: pointer; user-select: none; outline: none; display: flex; align-items: center; gap: 8px;">
                                📄 點擊展開/收合：朗讀原稿 (Transcript)
                            </summary>
                            <!-- 文字區內容直接顯示，由外層 wrapper 負責捲動 -->
                            <div style="padding: 0 20px 20px 20px; font-size: 1.125rem; color: #334155; line-height: 1.8; font-family: serif; border-top: 1px dashed #fef08a; margin-top: 4px; padding-top: 12px;">
                                ${safeText}
                            </div>
                        </details>
                    </div>

                    <!-- 🌟 下半：極致壓縮的控制區 (固定高度，取消 flex: 1) -->
                    <div style="padding: 15px 32px 25px 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #ffffff; flex-shrink: 0; min-height: 180px;">
                        
                        <!-- 狀態與倒數計時 -->
                        <div style="text-align: center; margin-bottom: 15px; width: 100%;">
                            <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 5px;">
                                <div id="audio-status-dot" style="width: 10px; height: 10px; border-radius: 50%; background-color: #cbd5e1; transition: background-color 0.3s;"></div>
                                <h3 id="audio-status-text" style="margin: 0; color: #64748b; font-weight: 800; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;">準備就緒</h3>
                            </div>
                            <div id="audio-timer-display" style="font-family: monospace; font-size: 3rem; color: #0f172a; line-height: 1; font-weight: 300;">05:00</div>
                        </div>

                        <!-- 錄音控制按鈕 (大幅縮小尺寸) -->
                        <div style="display: flex; gap: 15px; margin-bottom: 10px; height: 60px; align-items: center;">
                            <button id="btn-audio-start" style="width: 60px; height: 60px; border-radius: 50%; background-color: #ef4444; color: #ffffff; border: none; font-size: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.4);">🔴</button>
                            <button id="btn-audio-pause" style="display: none; width: 50px; height: 50px; border-radius: 50%; background-color: #f59e0b; color: #ffffff; border: none; font-size: 1.5rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.4);">⏸️</button>
                            <button id="btn-audio-resume" style="display: none; width: 50px; height: 50px; border-radius: 50%; background-color: #3b82f6; color: #ffffff; border: none; font-size: 1.5rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.4);">▶️</button>
                            <button id="btn-audio-stop" style="display: none; width: 60px; height: 60px; border-radius: 50%; background-color: #1e293b; color: #ffffff; border: none; font-size: 2rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(31, 41, 55, 0.4);">⏹️</button>
                        </div>

                        <!-- 試聽與繳交區塊 -->
                        <div id="audio-preview-section" style="display: none; width: 100%; max-width: 360px; flex-direction: column; align-items: center; gap: 15px;">
                            <div style="width: 100%; padding: 8px; background-color: #f1f5f9; border-radius: 10px; border: 1px solid #e2e8f0;">
                                <audio id="audio-playback" controls style="width: 100%; height: 35px; outline: none;"></audio>
                            </div>
                            <div style="display: flex; gap: 10px; width: 100%;">
                                <button id="btn-audio-retry" style="flex: 1; padding: 10px; background-color: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); font-size: 0.95rem;">🔄 重錄</button>
                                <button id="btn-audio-submit" style="flex: 2; padding: 10px; background-color: #10b981; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; justify-content: center; gap: 8px; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4); font-size: 0.95rem;">🚀 一鍵繳交</button>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        `;
    }
};
/**
 * 📂 檔案路徑：120_student_core/ui-audio-templates.js
 * 🌟 學生端錄音艙視覺模板工廠：支援原稿收合功能
 */

window.UIAudioTemplates = {
    getRecordingStudioHTML: function(transcriptText, taskTitle) {
        // 安全處理跳行，若無文稿則顯示提示
        const safeText = transcriptText ? String(transcriptText).replace(/\n/g, '<br>') : '<span style="color: #9ca3af; font-style: italic;">（老師未提供文字原稿，請直接錄音）</span>';
        const displayTitle = taskTitle || '未命名錄音作業';
        
        return `
        <div id="audio-studio-modal" style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);">
            <div style="background-color: #ffffff; border-radius: 16px; width: 95%; max-width: 900px; height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- 頂部 Header -->
                <div style="background-color: #4f46e5; color: #ffffff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: 0.025em;">🎙️ 錄音艙：${displayTitle}</h2>
                    <button id="btn-audio-close" style="background: none; border: none; color: #ffffff; cursor: pointer; font-size: 1.8rem; line-height: 1; opacity: 0.8; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">&times;</button>
                </div>

                <!-- 內容區 (上下佈局，適應收合) -->
                <div style="display: flex; flex-direction: column; flex: 1; overflow-y: auto; background-color: #f8fafc;">
                    
                    <!-- 🌟 上半：文稿區 (改為可收合設計，預設展開) -->
                    <div style="padding: 16px 24px; border-bottom: 1px solid #e5e7eb;">
                        <details style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 12px; outline: none; transition: 0.3s;" open>
                            <summary style="padding: 16px; font-size: 1rem; color: #a16207; font-weight: 800; cursor: pointer; user-select: none; outline: none; display: flex; align-items: center; gap: 8px;">
                                📄 點擊展開/收合：朗讀原稿 (Transcript)
                            </summary>
                            <div style="padding: 0 24px 24px 24px; font-size: 1.125rem; color: #334155; line-height: 1.8; font-family: serif; max-height: 35vh; overflow-y: auto; border-top: 1px dashed #fef08a; margin-top: 8px; padding-top: 16px;">
                                ${safeText}
                            </div>
                        </details>
                    </div>

                    <!-- 下半：控制區 -->
                    <div style="flex: 1; padding: 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #ffffff; position: relative;">
                        
                        <div style="text-align: center; margin-bottom: 40px; width: 100%;">
                            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 12px;">
                                <div id="audio-status-dot" style="width: 12px; height: 12px; border-radius: 50%; background-color: #cbd5e1; transition: background-color 0.3s;"></div>
                                <h3 id="audio-status-text" style="margin: 0; color: #64748b; font-weight: 800; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em;">準備就緒</h3>
                            </div>
                            <div id="audio-timer-display" style="font-family: monospace; font-size: 4.5rem; color: #0f172a; line-height: 1; font-weight: 300;">05:00</div>
                        </div>

                        <!-- 錄音控制按鈕 -->
                        <div style="display: flex; gap: 20px; margin-bottom: 24px; height: 80px; align-items: center;">
                            <button id="btn-audio-start" style="width: 80px; height: 80px; border-radius: 50%; background-color: #ef4444; color: #ffffff; border: none; font-size: 2.5rem; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 15px -3px rgba(239, 68, 68, 0.4);">🔴</button>
                            <button id="btn-audio-pause" style="display: none; width: 64px; height: 64px; border-radius: 50%; background-color: #f59e0b; color: #ffffff; border: none; font-size: 1.8rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.4);">⏸️</button>
                            <button id="btn-audio-resume" style="display: none; width: 64px; height: 64px; border-radius: 50%; background-color: #3b82f6; color: #ffffff; border: none; font-size: 1.8rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.4);">▶️</button>
                            <button id="btn-audio-stop" style="display: none; width: 80px; height: 80px; border-radius: 50%; background-color: #1e293b; color: #ffffff; border: none; font-size: 2.5rem; cursor: pointer; align-items: center; justify-content: center; box-shadow: 0 10px 15px -3px rgba(31, 41, 55, 0.4);">⏹️</button>
                        </div>

                        <!-- 試聽與繳交區塊 -->
                        <div id="audio-preview-section" style="display: none; width: 100%; max-width: 360px; flex-direction: column; align-items: center; gap: 20px;">
                            <div style="width: 100%; padding: 12px; background-color: #f1f5f9; border-radius: 12px; border: 1px solid #e2e8f0;">
                                <audio id="audio-playback" controls style="width: 100%; height: 40px; outline: none;"></audio>
                            </div>
                            <div style="display: flex; gap: 12px; width: 100%;">
                                <button id="btn-audio-retry" style="flex: 1; padding: 14px; background-color: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 10px; font-weight: bold; cursor: pointer; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); font-size: 1rem;">🔄 重錄</button>
                                <button id="btn-audio-submit" style="flex: 2; padding: 14px; background-color: #10b981; color: #ffffff; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; display: flex; justify-content: center; gap: 8px; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4); font-size: 1rem;">🚀 一鍵繳交</button>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        `;
    }
};
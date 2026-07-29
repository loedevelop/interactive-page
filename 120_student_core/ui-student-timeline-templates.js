/**
 * 📂 檔案路徑：120_student_core/ui-student-timeline-templates.js
 * 🌟 純粹視覺模板層 (V96 有道發音回歸版：接通 Supabase Stream API，徹底摧毀 Drive 播放阻擋)
 * 🌟 免疫介面災難：程式碼內 0 個雙直豎線，絕對防彈。
 */

window.UIStudentTimelineTemplates = (() => {
    
    // 🔊 1. 有道字典真人發音引擎 (帶有原生備用防線)
    let sharedTTS = null;
    const playGoogleTTS = (text) => {
        try {
            const safeText = text ? text : '';
            if (safeText === '') return;

            const fallbackTTS = () => {
                let hasSpeech = false;
                if ('speechSynthesis' in window) hasSpeech = true;
                
                if (hasSpeech) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(safeText);
                    utterance.lang = 'en-US';
                    utterance.rate = 0.9; 
                    window.speechSynthesis.speak(utterance);
                } else {
                    window.showFlash('您的瀏覽器不支援語音播放功能。', 'error');
                }
            };

            if (!sharedTTS) {
                sharedTTS = document.createElement('audio');
                sharedTTS.id = 'rt-hidden-tts';
                document.body.appendChild(sharedTTS);
            }
            sharedTTS.pause();
            
            // 🌟 回歸有道字典 API，type=2 代表美式發音
            sharedTTS.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(safeText)}&type=2`;
            
            const playPromise = sharedTTS.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.warn("有道字典 TTS 播放被阻擋，無縫切換至原生語音引擎:", e);
                    fallbackTTS();
                });
            }
        } catch (e) { 
            console.error("TTS 發音發生錯誤:", e); 
        }
    };

    const guessSubmittedKind = (fileId, audioUrl, fileMeta) => {
        const metaMime = fileMeta && fileMeta.mime ? String(fileMeta.mime).toLowerCase() : '';
        const metaName = fileMeta && fileMeta.name ? String(fileMeta.name).toLowerCase() : '';
        const url = String(audioUrl || '').toLowerCase();
        const hay = metaMime + ' ' + metaName + ' ' + url;
        if (/audio\/|\.wav|\.mp3|\.m4a|\.ogg|\.aac|\.webm|\.flac/.test(hay)) return 'audio';
        if (/image\/|\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.heic/.test(hay)) return 'image';
        if (/pdf|\.pdf|application\/pdf/.test(hay)) return 'pdf';
        // Recording／上傳音檔任務常見：有 fileId 且有 student_audio_url → 當音檔
        if (audioUrl && /drive\.google\.com\/file/.test(String(audioUrl))) return 'audio';
        return 'file';
    };

    const resolveStreamUrl = (fileId) => {
        if (!fileId) return '';
        if (window.ApiService && typeof window.ApiService.getAudioStreamUrl === 'function') {
            return window.ApiService.getAudioStreamUrl(fileId);
        }
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
    };

    const resolveDriveViewUrl = (fileId) => {
        if (window.ApiService && typeof window.ApiService.getDriveFileViewUrl === 'function') {
            return window.ApiService.getDriveFileViewUrl(fileId);
        }
        return `https://drive.google.com/file/d/${fileId}/view`;
    };

    const resolveDrivePreviewUrl = (fileId) => {
        if (window.ApiService && typeof window.ApiService.getDriveFilePreviewUrl === 'function') {
            return window.ApiService.getDriveFilePreviewUrl(fileId);
        }
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`;
    };

    /** 已繳交檔：音檔播放／圖片顯示／文件開預覽（開的是檔案，不是資料夾） */
    const buildSubmittedFilesHtml = (fileIds, audioUrl, inlinePlayerId, fileMetas) => {
        const ids = Array.isArray(fileIds) ? fileIds.filter(Boolean).map(String) : [];
        if (ids.length === 0 && audioUrl) {
            const m = String(audioUrl).match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) ids.push(m[1]);
        }
        if (ids.length === 0) return '';

        const metas = Array.isArray(fileMetas) ? fileMetas : [];
        let html = '<div style="display:flex; flex-direction:column; gap:8px; width:100%;">';
        ids.forEach((fileId, idx) => {
            const meta = metas.find(function (m) { return m && String(m.id) === String(fileId); }) || metas[idx] || null;
            const kind = guessSubmittedKind(fileId, idx === 0 ? audioUrl : '', meta);
            const viewUrl = resolveDriveViewUrl(fileId);
            const playerId = ids.length === 1 ? inlinePlayerId : `${inlinePlayerId}-${idx}`;

            if (kind === 'audio') {
                const streamUrl = resolveStreamUrl(fileId);
                html += `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <audio id="${escapeAttr(playerId)}" controls src="${escapeAttr(streamUrl)}" preload="metadata" style="height:36px; max-width:min(320px,100%); outline:none; border-radius:8px; vertical-align:middle; box-shadow:0 1px 3px rgba(0,0,0,0.1);"></audio>
                    <a href="${escapeAttr(viewUrl)}" target="_blank" rel="noopener" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#334155; text-decoration:none; font-size:0.8rem; padding:4px 10px; border-radius:6px; font-weight:800;">開啟音檔</a>
                </div>`;
            } else if (kind === 'image') {
                const previewUrl = resolveDrivePreviewUrl(fileId);
                html += `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                    <a href="${escapeAttr(viewUrl)}" target="_blank" rel="noopener" title="開啟原圖">
                        <img src="${escapeAttr(previewUrl)}" alt="繳交圖片" style="max-width:min(360px,100%); max-height:220px; border-radius:8px; border:1px solid #E2E8F0; object-fit:contain; background:#F8FAFC;" onerror="this.style.display='none'">
                    </a>
                    <a href="${escapeAttr(viewUrl)}" target="_blank" rel="noopener" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#334155; text-decoration:none; font-size:0.8rem; padding:4px 10px; border-radius:6px; font-weight:800;">開啟圖片</a>
                </div>`;
            } else {
                html += `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <a href="${escapeAttr(viewUrl)}" target="_blank" rel="noopener" class="btn-action" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; text-decoration:none; font-size:0.85rem; padding:6px 12px; border-radius:6px; font-weight:800;">📄 開啟繳交檔</a>
                </div>`;
            }
        });
        html += '</div>';
        return html;
    };

    // 🎧 2. 錯音切片連動引擎
    let sliceTimerInterval = null;
    let sliceAudioCache = {};
    const playSliceViaFileId = (fileId, startTime, endTime) => {
        if (!fileId) return;
        if (window.FeatureStudentTimeline && typeof window.FeatureStudentTimeline.playStudentAudioSlice === 'function') {
            window.FeatureStudentTimeline.playStudentAudioSlice(fileId, startTime, endTime);
            return;
        }
        if (!sliceAudioCache[fileId]) {
            const streamUrl = (window.ApiService && typeof window.ApiService.getAudioStreamUrl === 'function')
                ? window.ApiService.getAudioStreamUrl(fileId)
                : `https://drive.google.com/uc?export=download&id=${fileId}`;
            sliceAudioCache[fileId] = new Audio(streamUrl);
        }
        const audio = sliceAudioCache[fileId];
        if (sliceTimerInterval) clearInterval(sliceTimerInterval);
        audio.pause();
        const run = () => {
            audio.currentTime = startTime;
            audio.play().catch(e => {
                console.warn('切片播放被阻擋:', e);
                window.showFlash('無法播放錯音片段，請先點上方播放器播放一次。', 'error');
            });
            sliceTimerInterval = setInterval(() => {
                if (audio.paused || audio.currentTime >= endTime) {
                    audio.pause();
                    clearInterval(sliceTimerInterval);
                }
            }, 50);
        };
        if (audio.readyState >= 1) run();
        else {
            audio.addEventListener('loadedmetadata', () => run(), { once: true });
            audio.load();
        }
    };
    const playStudentAudioSlice = (playerId, startTime, endTime, fallbackFileId) => {
        try {
            let sTime = Number(startTime) || 0;
            let eTime = Number(endTime) || 0;
            if (eTime <= sTime) eTime = sTime + 1.5;

            const player = document.getElementById(playerId);
            if (!player) {
                playSliceViaFileId(fallbackFileId, sTime, eTime);
                return;
            }
            
            if (sliceTimerInterval) clearInterval(sliceTimerInterval);
            player.pause();
            
            const executePlay = () => {
                player.currentTime = sTime; 
                const playPromise = player.play();
                
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        if (Math.abs(player.currentTime - sTime) > 0.5) {
                            player.currentTime = sTime;
                        }
                        
                        sliceTimerInterval = setInterval(() => {
                            let shouldStop = false;
                            if (player.currentTime >= eTime) shouldStop = true;
                            if (player.paused) shouldStop = true;
                            
                            if (shouldStop) {
                                player.pause();
                                clearInterval(sliceTimerInterval);
                            }
                        }, 50);
                    }).catch(e => {
                        console.warn("切片播放被阻擋:", e);
                        if (fallbackFileId) playSliceViaFileId(fallbackFileId, sTime, eTime);
                        else window.showFlash('瀏覽器阻擋了自動播放，請先點上方播放器播放一次。', 'error');
                    });
                }
            };

            if (player.readyState >= 1) {
                executePlay();
            } else {
                const onReady = () => {
                    executePlay();
                    player.removeEventListener('loadedmetadata', onReady);
                };
                player.addEventListener('loadedmetadata', onReady);
                player.load(); 
            }
        } catch (e) { console.error("切片定位錯誤:", e); }
    };

    const resolveWordErrorTiming = (err, aiEval) => {
        let sTime = Number(err.start_time ?? 0);
        let eTime = Number(err.end_time ?? 0);
        if (eTime > sTime) return { sTime, eTime };

        const raw = aiEval && aiEval.provider_raw ? aiEval.provider_raw : null;
        const scoreBlock = raw ? (raw.speech_score || raw.text_score || {}) : {};
        const wordList = scoreBlock.word_score_list || [];
        const target = String(err.word || '').toLowerCase();
        const matched = wordList.find(w => String(w.word || '').toLowerCase() === target);
        if (matched && Array.isArray(matched.phone_score_list)) {
            let minE = Infinity;
            let maxE = -Infinity;
            matched.phone_score_list.forEach(p => {
                if (Array.isArray(p.extent) && p.extent.length >= 2) {
                    minE = Math.min(minE, Number(p.extent[0]));
                    maxE = Math.max(maxE, Number(p.extent[1]));
                }
            });
            if (Number.isFinite(minE) && Number.isFinite(maxE)) {
                sTime = minE / 100;
                eTime = maxE / 100;
            }
        }
        if (eTime <= sTime) eTime = sTime + 1.5;
        return { sTime, eTime };
    };

    const getScoresFromAi = (ai) => {
        let pScore = 'N/A';
        let fluency = 'N/A';
        let completeness = 'N/A';
        if (!ai) return { pScore, fluency, completeness, pScoreColor: '#64748B', avg: 'N/A' };
        if (ai.pronunciation_score !== undefined && ai.pronunciation_score !== null) pScore = ai.pronunciation_score;
        else if (ai.score !== undefined && ai.score !== null) pScore = ai.score;
        if (ai.fluency_score !== undefined && ai.fluency_score !== null) fluency = ai.fluency_score;
        if (ai.completeness_score !== undefined && ai.completeness_score !== null) completeness = ai.completeness_score;
        let pScoreColor = '#10B981';
        if (pScore !== 'N/A') {
            const numScore = Number(pScore);
            if (numScore < 80) pScoreColor = '#F59E0B';
            if (numScore < 60) pScoreColor = '#EF4444';
        }
        let avg = 'N/A';
        if (pScore !== 'N/A' && fluency !== 'N/A') {
            avg = Math.round((Number(pScore) + Number(fluency)) / 2);
        } else if (pScore !== 'N/A') avg = Number(pScore);
        return { pScore, fluency, completeness, pScoreColor, avg };
    };

    const formatAttemptDate = (ts) => {
        if (!ts) return '未知時間';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return String(ts);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const extractDriveFileId = (url) => {
        if (!url) return '';
        const str = String(url);
        let m = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!m) m = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        return m ? m[1] : '';
    };

    const getWordErrorCount = (ai) => {
        if (!ai) return 0;
        if (!ai.word_errors) return 0;
        if (!Array.isArray(ai.word_errors)) return 0;
        return ai.word_errors.length;
    };

    const truncateFeedback = (text, maxLen) => {
        const str = String(text ? text : '').replace(/\s+/g, ' ').trim();
        if (str.length <= maxLen) return str;
        return str.slice(0, maxLen) + '…';
    };

    const buildLearningTrackHtml = (currentAi, history) => {
        const safeHistory = Array.isArray(history) ? history : [];
        const aiAttempts = [];
        safeHistory.forEach(h => {
            if (h && h.ai_evaluation) aiAttempts.push(h.ai_evaluation);
        });
        aiAttempts.push(currentAi);
        const totalAttempts = aiAttempts.length;
        const current = getScoresFromAi(currentAi);
        const first = getScoresFromAi(aiAttempts[0]);

        let pDeltaStr = '';
        if (current.pScore !== 'N/A' && first.pScore !== 'N/A' && totalAttempts > 1) {
            const d = Number(current.pScore) - Number(first.pScore);
            if (d > 0) pDeltaStr = `(↑${d})`;
            else if (d < 0) pDeltaStr = `(↓${Math.abs(d)})`;
            else pDeltaStr = '(持平)';
        }

        const errorCounts = aiAttempts.map(a => getWordErrorCount(a));
        const errorTrend = errorCounts.join(' → ');

        const wordFreq = {};
        aiAttempts.forEach(a => {
            const list = a && a.word_errors ? a.word_errors : [];
            list.forEach(e => {
                const w = String(e.word ? e.word : '').toLowerCase();
                if (w) wordFreq[w] = (wordFreq[w] ? wordFreq[w] : 0) + 1;
            });
        });
        const recurring = Object.entries(wordFreq).filter(entry => entry[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const recurringHtml = recurring.length > 0
            ? recurring.map(([w, c]) => `<span style="background:#FEE2E2;color:#B91C1C;padding:1px 6px;border-radius:4px;font-weight:800;font-size:0.75rem;">${w}(${c}次)</span>`).join(' ')
            : '<span style="color:#94A3B8;font-size:0.78rem;">無</span>';

        let fixedSincePrevHtml = '<span style="color:#94A3B8;font-size:0.78rem;">—</span>';
        let newSincePrevHtml = '<span style="color:#94A3B8;font-size:0.78rem;">—</span>';
        if (totalAttempts >= 2) {
            const prevAi = aiAttempts[totalAttempts - 2];
            const latestAi = aiAttempts[totalAttempts - 1];
            const prevWords = new Set();
            const latestWords = new Set();
            const prevList = prevAi && prevAi.word_errors ? prevAi.word_errors : [];
            const latestList = latestAi && latestAi.word_errors ? latestAi.word_errors : [];
            prevList.forEach(e => { const w = String(e.word ? e.word : '').toLowerCase(); if (w) prevWords.add(w); });
            latestList.forEach(e => { const w = String(e.word ? e.word : '').toLowerCase(); if (w) latestWords.add(w); });
            const fixedSincePrev = [];
            const newSincePrev = [];
            prevWords.forEach(w => { if (!latestWords.has(w)) fixedSincePrev.push(w); });
            latestWords.forEach(w => { if (!prevWords.has(w)) newSincePrev.push(w); });
            if (fixedSincePrev.length > 0) {
                fixedSincePrevHtml = fixedSincePrev.slice(0, 4).map(w => `<span style="background:#D1FAE5;color:#065F46;padding:1px 6px;border-radius:4px;font-weight:800;font-size:0.75rem;">${w}</span>`).join(' ');
            }
            if (newSincePrev.length > 0) {
                newSincePrevHtml = newSincePrev.slice(0, 4).map(w => `<span style="background:#FEE2E2;color:#B91C1C;padding:1px 6px;border-radius:4px;font-weight:800;font-size:0.75rem;">${w}</span>`).join(' ');
            }
        }

        const dotsHtml = aiAttempts.map((a, i) => {
            const s = getScoresFromAi(a);
            const num = s.pScore !== 'N/A' ? Number(s.pScore) : 0;
            const size = 8 + Math.round(num / 15);
            const isLast = i === aiAttempts.length - 1;
            const dot = `<span title="第${i + 1}次 發音${s.pScore}" style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${isLast ? '#6366F1' : '#A5B4FC'};border:2px solid white;box-shadow:0 0 0 1px #C7D2FE;flex-shrink:0;"></span>`;
            const line = isLast ? '' : `<span style="flex:1;height:2px;background:linear-gradient(90deg,#C7D2FE,#E0E7FF);min-width:12px;"></span>`;
            return dot + line;
        }).join('');

        let insightLine = '';
        if (totalAttempts > 1 && current.pScore !== 'N/A' && first.pScore !== 'N/A') {
            const d = Number(current.pScore) - Number(first.pScore);
            if (d > 0) insightLine = `發音較首次進步 ${d} 分，持續保持！`;
            else if (d < 0) insightLine = `發音較首次下降 ${Math.abs(d)} 分，再練一次吧。`;
            else insightLine = `共 ${totalAttempts} 次練習，發音維持穩定。`;
        }

        return `
            <div style="margin-bottom:12px;padding:10px 12px;background:linear-gradient(135deg,#EEF2FF,#FAF5FF);border:1px solid #C7D2FE;border-radius:8px;">
                <div style="font-weight:900;color:#4338CA;font-size:0.9rem;margin-bottom:8px;">📊 本作業學習軌跡</div>
                <div style="display:flex;align-items:center;gap:0;margin-bottom:8px;padding:4px 0;">${dotsHtml}</div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:6px;">
                    批改 <strong style="color:#334155;">${totalAttempts}</strong> 次
                    · 發音 <strong style="color:${current.pScoreColor};">${first.pScore} → ${current.pScore}</strong> ${pDeltaStr}
                    · 流暢 ${first.fluency} → ${current.fluency}
                </div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">错音數 ${errorTrend}</div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        <span style="font-weight:800;">反覆出現</span>
                        <span style="color:#94A3B8;font-size:0.72rem;">（2 次以上批改都被標記的错音）</span>
                        ${recurringHtml}
                    </div>
                </div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        <span style="font-weight:800;">較上次已修正</span>
                        <span style="color:#94A3B8;font-size:0.72rem;">（上次有错、這次沒再出現）</span>
                        ${fixedSincePrevHtml}
                    </div>
                </div>
                <div style="font-size:0.78rem;color:#64748B;margin-bottom:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        <span style="font-weight:800;">本次新错音</span>
                        <span style="color:#94A3B8;font-size:0.72rem;">（這次新被標記、上次沒有）</span>
                        ${newSincePrevHtml}
                    </div>
                </div>
                ${insightLine ? `<div style="font-size:0.78rem;color:#4338CA;font-weight:700;margin-top:6px;padding-top:6px;border-top:1px dashed #C7D2FE;">💡 ${insightLine}</div>` : ''}
            </div>`;
    };

    const renderCurrentRowDetailHtml = (ai, compositeKey, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        return `<div style="padding:8px 4px;">${renderEvaluationDetailHtml(ai, inlinePlayerId, fallbackFileId, hasValidAudioFile)}</div>`;
    };

    const renderHistorySummaryHtml = (ai, compositeKey, historyIndex, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        if (!ai) return '';
        let feedback = ai.comprehensive_feedback ? ai.comprehensive_feedback : (ai.feedback ? ai.feedback : '無綜合評語');
        const shortFeedback = truncateFeedback(feedback, 140);
        const errors = ai.word_errors ? ai.word_errors : [];
        let chipsHtml = '';
        if (errors.length > 0) {
            chipsHtml = errors.slice(0, 10).map(err => {
                const w = err.word ? err.word : '';
                return `<span style="background:#FEF2F2;color:#991B1B;padding:2px 8px;border-radius:999px;font-size:0.75rem;font-weight:800;border:1px solid #FECACA;">${String(w)}</span>`;
            }).join(' ');
            if (errors.length > 10) chipsHtml += `<span style="font-size:0.72rem;color:#94A3B8;">+${errors.length - 10}</span>`;
        } else {
            chipsHtml = '<span style="font-size:0.78rem;color:#10B981;font-weight:800;">✓ 無明顯错音</span>';
        }
        return `
            <div style="padding:8px 4px;">
                <div style="font-size:0.82rem;color:#475569;line-height:1.5;margin-bottom:8px;">${String(shortFeedback).replace(/\n/g, ' ')}</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${chipsHtml}</div>
                <button type="button" id="ai-history-full-btn-${compositeKey}-${historyIndex}" onclick="event.stopPropagation(); window.FeatureStudentTimeline.toggleAIHistoryFull('${compositeKey}', ${historyIndex})" style="font-size:0.75rem;padding:3px 10px;border-radius:4px;border:1px solid #C7D2FE;background:white;color:#4338CA;font-weight:800;cursor:pointer;">查看完整報告</button>
                <div id="ai-history-full-${compositeKey}-${historyIndex}" style="display:none;margin-top:10px;">
                    ${renderEvaluationDetailHtml(ai, inlinePlayerId, fallbackFileId, hasValidAudioFile)}
                </div>
            </div>`;
    };

    const buildHistoryTableHtml = (compositeKey, gradingHistory, currentAi, inlinePlayerId, defaultFileId, hasValidAudioFile) => {
        if (!currentAi) return '';

        const aiEntries = [];
        const safeHistory = Array.isArray(gradingHistory) ? gradingHistory : [];
        safeHistory.forEach((h, idx) => {
            if (h && h.ai_evaluation) aiEntries.push({ h, idx });
        });

        const totalAttempts = aiEntries.length + 1;
        const currentScores = getScoresFromAi(currentAi);
        const currentDate = formatAttemptDate(currentAi.graded_at ? currentAi.graded_at : '');
        const currentErrCount = getWordErrorCount(currentAi);

        let currentDeltaStr = '—';
        if (aiEntries.length > 0) {
            const lastHistory = aiEntries[aiEntries.length - 1];
            const prevScores = getScoresFromAi(lastHistory.h.ai_evaluation);
            if (currentScores.pScore !== 'N/A' && prevScores.pScore !== 'N/A') {
                const d = Number(currentScores.pScore) - Number(prevScores.pScore);
                if (d > 0) currentDeltaStr = `<span style="color:#059669;">+${d}</span>`;
                else if (d < 0) currentDeltaStr = `<span style="color:#DC2626;">${d}</span>`;
                else currentDeltaStr = '0';
            }
        }

        const openIdxRaw = localStorage.getItem(`ai_history_open_${compositeKey}`);
        const expandAll = openIdxRaw === 'all';
        const historyRowSelected = openIdxRaw && openIdxRaw !== 'all' && openIdxRaw !== 'current' && openIdxRaw !== '-1';
        const isCurrentOpen = expandAll ? true : !historyRowSelected;
        const openKey = openIdxRaw ? openIdxRaw : 'current';
        const currentRowIcon = isCurrentOpen ? '▼' : '▶';
        const currentDetailDisplay = isCurrentOpen ? 'table-row' : 'none';
        const currentDetailHtml = renderCurrentRowDetailHtml(currentAi, compositeKey, inlinePlayerId, defaultFileId, hasValidAudioFile);

        const currentRowHtml = `
            <tr style="cursor:pointer;background:${isCurrentOpen ? '#EDE9FE' : 'white'};" onclick="window.FeatureStudentTimeline.toggleAIHistoryRow('${compositeKey}', 'current')">
                <td style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;width:24px;"><span id="ai-history-icon-${compositeKey}-current">${currentRowIcon}</span></td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#6D28D9;white-space:nowrap;">
                    第 ${totalAttempts} 次
                    <span style="font-size:0.68rem;background:#8B5CF6;color:white;padding:1px 5px;border-radius:3px;margin-left:4px;font-weight:900;">最新</span>
                </td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;color:#64748B;font-size:0.78rem;white-space:nowrap;">${currentDate}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:${currentScores.pScoreColor};text-align:center;">${currentScores.pScore}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:#3B82F6;text-align:center;">${currentScores.fluency}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#EF4444;text-align:center;">${currentErrCount}</td>
                <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;text-align:center;">${currentDeltaStr}</td>
            </tr>
            <tr id="ai-history-detail-${compositeKey}-current" style="display:${currentDetailDisplay};">
                <td colspan="7" style="padding:0 8px 8px;border:1px solid #E2E8F0;background:#FAF5FF;border-top:none;">
                    ${currentDetailHtml}
                </td>
            </tr>`;

        const displayEntries = aiEntries.slice().reverse();
        const historyRowsHtml = displayEntries.map(entry => {
            const h = entry.h;
            const idx = entry.idx;
            const attemptNum = idx + 1;
            const hScores = getScoresFromAi(h.ai_evaluation);
            const hDate = formatAttemptDate(h.timestamp ? h.timestamp : (h.ai_evaluation.graded_at ? h.ai_evaluation.graded_at : ''));
            const errCount = getWordErrorCount(h.ai_evaluation);

            let deltaStr = '—';
            if (idx > 0) {
                const prevEntry = safeHistory[idx - 1];
                if (prevEntry && prevEntry.ai_evaluation) {
                    const prevScores = getScoresFromAi(prevEntry.ai_evaluation);
                    if (hScores.pScore !== 'N/A' && prevScores.pScore !== 'N/A') {
                        const d = Number(hScores.pScore) - Number(prevScores.pScore);
                        if (d > 0) deltaStr = `<span style="color:#059669;">+${d}</span>`;
                        else if (d < 0) deltaStr = `<span style="color:#DC2626;">${d}</span>`;
                        else deltaStr = '0';
                    }
                }
            }

            const historyFileId = extractDriveFileId(h.audio_url);
            const rowFileId = historyFileId ? historyFileId : defaultFileId;
            const rowHasAudio = historyFileId ? true : hasValidAudioFile;
            const rowKey = String(idx);

            const isOpen = expandAll ? true : (openKey === rowKey);
            const rowIcon = isOpen ? '▼' : '▶';
            const detailDisplay = isOpen ? 'table-row' : 'none';
            const summaryHtml = renderHistorySummaryHtml(h.ai_evaluation, compositeKey, idx, inlinePlayerId, rowFileId, rowHasAudio);

            return `
                <tr style="cursor:pointer;background:${isOpen ? '#EEF2FF' : 'white'};" onclick="window.FeatureStudentTimeline.toggleAIHistoryRow('${compositeKey}', '${rowKey}')">
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;width:24px;"><span id="ai-history-icon-${compositeKey}-${idx}">${rowIcon}</span></td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#64748B;white-space:nowrap;">第 ${attemptNum} 次</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;color:#64748B;font-size:0.78rem;white-space:nowrap;">${hDate}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:${hScores.pScoreColor};text-align:center;">${hScores.pScore}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:900;color:#3B82F6;text-align:center;">${hScores.fluency}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;color:#EF4444;text-align:center;">${errCount}</td>
                    <td style="padding:6px 8px;border:1px solid #E2E8F0;font-weight:800;text-align:center;">${deltaStr}</td>
                </tr>
                <tr id="ai-history-detail-${compositeKey}-${idx}" style="display:${detailDisplay};">
                    <td colspan="7" style="padding:0 8px 8px;border:1px solid #E2E8F0;background:#F8FAFC;border-top:none;">
                        ${summaryHtml}
                    </td>
                </tr>`;
        }).join('');

        const toggleAllLabel = expandAll ? '收合全部' : '展開全部摘要';

        return `
            <div style="margin-top:12px;padding-top:12px;border-top:1px dashed #C7D2FE;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    <div style="font-weight:900;color:#6366F1;font-size:0.88rem;">📜 批改紀錄 (${totalAttempts})</div>
                    <button type="button" id="ai-history-toggle-all-${compositeKey}" onclick="window.FeatureStudentTimeline.toggleAllAIHistorySummaries('${compositeKey}')" style="font-size:0.75rem;padding:2px 10px;border-radius:4px;border:1px solid #C7D2FE;background:white;color:#4338CA;font-weight:800;cursor:pointer;">${toggleAllLabel}</button>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                        <thead>
                            <tr style="background:#F1F5F9;color:#475569;">
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;width:24px;"></th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;">次數</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;">時間</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">發音</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">流暢</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">错音</th>
                                <th style="padding:6px 8px;border:1px solid #E2E8F0;text-align:center;">變化</th>
                            </tr>
                        </thead>
                        <tbody>${currentRowHtml}${historyRowsHtml}</tbody>
                    </table>
                </div>
            </div>`;
    };

    const renderWordErrorsHtml = (ai, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        if (!ai || !ai.word_errors || !Array.isArray(ai.word_errors) || ai.word_errors.length === 0) return '';
        return `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #E2E8F0;">
            <div style="font-weight: 900; color: #EF4444; font-size: 0.9rem; margin-bottom: 8px;">🔍 單字發音診斷：</div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                    <thead>
                        <tr style="background: #FEF2F2; color: #991B1B;">
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">目標單字</th>
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">您的錯誤發音</th>
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">正確音標</th>
                            <th style="padding: 6px 10px; border: 1px solid #FECACA; white-space: nowrap;">錯誤類型</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ai.word_errors.map(err => {
                            const safeErrWord = err.word ? err.word : '';
                            const safeWord = String(safeErrWord).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            const timing = resolveWordErrorTiming(err, ai);
                            const safeStuPron = err.student_pronunciation ? err.student_pronunciation : '';
                            const safeExpPhonetic = err.expected_phonetic ? err.expected_phonetic : '';
                            const safeErrType = err.error_type ? err.error_type : '';
                            const safeFileId = String(fallbackFileId || '').replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
                            let playSliceHtml = '';
                            if (hasValidAudioFile) {
                                playSliceHtml = `<span onclick="window.UIStudentTimelineTemplates.playStudentAudioSlice('${inlinePlayerId}', ${timing.sTime}, ${timing.eTime}, '${safeFileId}')" style="cursor:pointer; font-size:1.2rem; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.1)); transition:transform 0.1s; margin-left: 8px;" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'" title="定位並播放錯誤發音">🎧</span>`;
                            }
                            return `
                            <tr style="background: white;">
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; font-weight: 800; color: #334155;">${String(safeErrWord)}</td>
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #EF4444; font-weight: bold;">
                                    <div style="display:flex; align-items:center; flex-wrap:nowrap;">
                                        <span>${String(safeStuPron)}</span>${playSliceHtml}
                                    </div>
                                </td>
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; font-family: monospace; color: #10B981;">
                                    <div style="display:flex; align-items:center; flex-wrap:nowrap;">
                                        <span>${String(safeExpPhonetic)}</span>
                                        <span onclick="window.UIStudentTimelineTemplates.playGoogleTTS('${safeWord}')" style="cursor:pointer; font-size:1.2rem; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.1)); transition:transform 0.1s; margin-left: 8px;" onmousedown="this.style.transform='scale(0.8)'" onmouseup="this.style.transform='scale(1)'" title="聆聽有道示範發音">🔊</span>
                                    </div>
                                </td>
                                <td style="padding: 6px 10px; border: 1px solid #FECACA; color: #64748B;">${String(safeErrType)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    };

    const renderEvaluationDetailHtml = (ai, inlinePlayerId, fallbackFileId, hasValidAudioFile) => {
        if (!ai) return '';
        let feedback = ai.comprehensive_feedback ? ai.comprehensive_feedback : (ai.feedback ? ai.feedback : '無綜合評語');
        const wordErrorsHtml = renderWordErrorsHtml(ai, inlinePlayerId, fallbackFileId, hasValidAudioFile);
        return `<div class="rt-normalize" style="font-size: 0.95rem; color: #334155; line-height: 1.6; background: white; padding: 12px; border-radius: 6px; border: 1px solid #E2E8F0; max-height: 400px; overflow-y: auto;">
            <div style="font-weight: 900; color: #4F46E5; margin-bottom: 6px;">📝 綜合評語：</div>
            ${String(feedback).replace(/\n/g, '<br>')}${wordErrorsHtml}
        </div>`;
    };

    function getLevelStyle(depth) {
        const styles = [
            { border: '#94A3B8', bg: '#F8FAFC', text: '#475569' }, 
            { border: '#3B82F6', bg: '#EFF6FF', text: '#1E3A8A' }, 
            { border: '#8B5CF6', bg: '#F5F3FF', text: '#5B21B6' }, 
            { border: '#10B981', bg: '#ECFDF5', text: '#064E3B' }, 
            { border: '#F59E0B', bg: '#FFF7ED', text: '#7C2D12' }  
        ];
        return styles[Math.min(depth, 4)];
    }

    function stripHtml(str) {
        return String(str == null ? '' : str).replace(/<[^>]*>?/gm, '').replace(/&nbsp;/gi, ' ').trim();
    }

    function escapeAttr(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeJsSingleQuoted(str) {
        return String(str == null ? '' : str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '');
    }

    console.log("🚀 [LogOn Web] UIStudentTimelineTemplates V111 模組已成功載入！");

    return {
        playGoogleTTS,
        playStudentAudioSlice, 
        
        renderTimelineNodes: (timelineNodes, assignments, completedTasks, currentWeekStart, mode, weekStartSetting, DateUtils, studentDriveUrl, safeFormatUrl, classGradingPolicy) => {
            try {
                let html = '';
                
                const safeTimelineNodes = Array.isArray(timelineNodes) ? timelineNodes : [];
                const safeAssignments = Array.isArray(assignments) ? assignments : [];
                const safeCompletedTasks = Array.isArray(completedTasks) ? completedTasks : [];

                const reversedNodes = safeTimelineNodes.map((node, index) => ({ node, weekIndex: index + 1 })).reverse();

                const renderTaskItem = (task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth, isFirstLeaf, isLastLeaf) => {
                    let canUpload = true;
                    if (isLateUpload) {
                        if (!allowLateFlag) {
                            canUpload = false;
                        }
                    }
                    
                    const compositeKey = `${course.id}_${task.id}`;
                    const isTaskDone = safeCompletedTasks.includes(compositeKey);
                    const checked = isTaskDone ? 'checked' : '';
                    
                    let aiFeedbackHtml = '';
                    let statusBadgeHtml = '';
                    
                    let hasValidAudioFile = false; 
                    let retryAudioId = '';
                    let retryAudioUrl = '';
                    let taskStatus = '';
                    let directAudioUrl = '';
                    let submittedFileIds = [];
                    let submittedFileMetas = [];
                    
                    let inlinePlayerId = '';
                    if (course.id) {
                        if (task.id) {
                            inlinePlayerId = `inline-player-${course.id}-${task.id}`;
                        }
                    }

                    if (window._studentTaskCompletions) {
                        if (Array.isArray(window._studentTaskCompletions)) {
                            const compRecord = window._studentTaskCompletions.find(c => String(c.assignment_id) === String(course.id) && String(c.task_id) === String(task.id));
                            if (compRecord) {
                                taskStatus = String(compRecord.status ? compRecord.status : '');
                                
                                if (compRecord.raw_data) {
                                    let url1 = compRecord.raw_data.student_audio_url;
                                    let url2 = compRecord.raw_data.audio_url;
                                    retryAudioUrl = String(url1 ? url1 : (url2 ? url2 : ''));
                                    
                                    if (Array.isArray(compRecord.raw_data.drive_file_ids)) {
                                        submittedFileIds = compRecord.raw_data.drive_file_ids.map(String).filter(Boolean);
                                    }
                                    if (Array.isArray(compRecord.raw_data.submitted_files)) {
                                        submittedFileMetas = compRecord.raw_data.submitted_files;
                                    }

                                    if (!retryAudioUrl) {
                                        if (submittedFileIds.length > 0) {
                                            retryAudioId = String(submittedFileIds[0]);
                                            retryAudioUrl = `https://drive.google.com/file/d/${retryAudioId}/view`;
                                        }
                                    } else if (retryAudioUrl) {
                                        let driveIdMatch = retryAudioUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                                        if (!driveIdMatch) driveIdMatch = retryAudioUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                                        
                                        if (driveIdMatch) retryAudioId = driveIdMatch[1];
                                    }

                                    if (retryAudioId && submittedFileIds.indexOf(String(retryAudioId)) === -1) {
                                        submittedFileIds.unshift(String(retryAudioId));
                                    }
                                    
                                    if (submittedFileIds.length > 0 || retryAudioUrl) {
                                        hasValidAudioFile = true;
                                        if (retryAudioId) {
                                            // 與錄音艙／AI 報告切片同一條：Supabase stream-audio（勿用 GAS Web App 當 audio src）
                                            directAudioUrl = resolveStreamUrl(retryAudioId);
                                        } else if (retryAudioUrl) {
                                            directAudioUrl = retryAudioUrl;
                                        }
                                    }
                                }

                                // 無文稿被誤送 AI 的舊資料：不當成「批改失敗」
                                const skipAiMissingScript = !!(compRecord.raw_data && (
                                    compRecord.raw_data.ai_skip_reason === 'original_script_missing'
                                    || /original_script is missing/i.test(String(compRecord.raw_data.ai_error_log || ''))
                                ));
                                const effectiveTaskStatus = (taskStatus === 'ai_error' || taskStatus === 'failed') && skipAiMissingScript
                                    ? 'submitted'
                                    : taskStatus;

                                if (effectiveTaskStatus === 'ai_processing') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#EDE9FE; color:#8B5CF6; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #DDD6FE;">🤖 AI 批改中...</span>`;
                                } else if (effectiveTaskStatus === 'ai_ready') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF3C7; color:#D97706; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FDE68A;">🤖 AI 分析完成</span>`;
                                } else if (effectiveTaskStatus === 'graded') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#ECFDF5; color:#10B981; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #A7F3D0;">✅ 已批改</span>`;
                                } else if (effectiveTaskStatus === 'completed') {
                                    // 自我勾選完成 ≠ 老師／AI 批改
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#F1F5F9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #CBD5E1;">✅ 已完成</span>`;
                                } else if (effectiveTaskStatus === 'ai_error' || effectiveTaskStatus === 'failed') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#FEF2F2; color:#EF4444; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #FECACA;">⚠️ AI 分析失敗</span>`;
                                } else if (effectiveTaskStatus === 'submitted') {
                                    statusBadgeHtml = `<span style="font-size:0.75rem; background:#EFF6FF; color:#3B82F6; padding:2px 6px; border-radius:4px; font-weight:bold; box-shadow: 0 0 0 1px #BFDBFE;">✅ 已繳交</span>`;
                                }

                                let showAIReport = false;
                                if (effectiveTaskStatus === 'graded') showAIReport = true;
                                else if (effectiveTaskStatus === 'ai_ready') showAIReport = true;
                                else if (effectiveTaskStatus === 'completed' && compRecord.raw_data && compRecord.raw_data.ai_evaluation) {
                                    showAIReport = true;
                                }

                                let scoreDisclaimer = '';
                                if (window.GradingPolicy && window.GradingPolicy.studentScoreDisclaimer) {
                                    scoreDisclaimer = window.GradingPolicy.studentScoreDisclaimer(classGradingPolicy, compRecord.raw_data, effectiveTaskStatus);
                                }

                                if (showAIReport) {
                                    if (compRecord.raw_data) {
                                        if (compRecord.raw_data.ai_evaluation) {
                                            const ai = compRecord.raw_data.ai_evaluation;
                                            const scores = getScoresFromAi(ai);
                                            const gradingHistory = Array.isArray(compRecord.raw_data.grading_history) ? compRecord.raw_data.grading_history : [];

                                            const isCollapsed = localStorage.getItem(`ai_report_collapsed_${compositeKey}`) === 'true';
                                            const reportDisplay = isCollapsed ? 'none' : 'block';
                                            const toggleIcon = isCollapsed ? '◀️' : '🔽';

                                            let disclaimerHtml = '';
                                            if (scoreDisclaimer !== '') {
                                                disclaimerHtml = `<span style="font-size:0.75rem; background:#FEF3C7; color:#B45309; padding:2px 8px; border-radius:4px; font-weight:900; border:1px solid #FDE68A;">⚠️ ${scoreDisclaimer}</span>`;
                                            }

                                            const progressHtml = buildLearningTrackHtml(ai, gradingHistory);
                                            const latestAttemptNum = gradingHistory.length + 1;
                                            const historySectionHtml = buildHistoryTableHtml(compositeKey, gradingHistory, ai, inlinePlayerId, retryAudioId, hasValidAudioFile);

                                            aiFeedbackHtml = `
                                                <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FAF5FF; border-left: 4px solid #8B5CF6; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                                        <div style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;" onclick="window.FeatureStudentTimeline.toggleAIReport('${compositeKey}')">
                                                            <span style="font-size:1.1rem;">🤖</span>
                                                            <span style="font-weight: 900; color: #6D28D9; font-size: 0.95rem;">AI 批改報告</span>
                                                            <span style="font-size:0.72rem;background:#EDE9FE;color:#6D28D9;padding:1px 6px;border-radius:4px;font-weight:900;">第 ${latestAttemptNum} 次</span>
                                                            <span id="toggle-icon-${compositeKey}" style="font-size: 0.8rem; margin-left: 4px; color: #8B5CF6;">${toggleIcon}</span>
                                                        </div>
                                                        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                                                            ${disclaimerHtml}
                                                            <span style="background: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 900; color: ${scores.pScoreColor}; border: 1px solid #E2E8F0;">發音: ${scores.pScore}</span>
                                                            <span style="background: white; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 900; color: #3B82F6; border: 1px solid #E2E8F0;">流暢度: ${scores.fluency}</span>
                                                        </div>
                                                    </div>
                                                    <div id="ai-report-body-${compositeKey}" style="display: ${reportDisplay}; margin-top: 12px;">
                                                        ${progressHtml}
                                                        ${historySectionHtml}
                                                    </div>
                                                </div>
                                            `;
                                        }
                                    }
                                }

                                let showAIError = false;
                                if ((effectiveTaskStatus === 'ai_error' || effectiveTaskStatus === 'failed') && !skipAiMissingScript) {
                                    showAIError = true;
                                }

                                if (showAIError) {
                                    let errorLogText = '系統尚未完成此作業的 AI 分析。';
                                    if (compRecord.raw_data) {
                                        if (compRecord.raw_data.ai_error_log) {
                                            errorLogText = String(compRecord.raw_data.ai_error_log);
                                        }
                                    }
                                    
                                    aiFeedbackHtml = `
                                        <div style="margin-top: 12px; margin-left: 36px; padding: 12px 16px; background: #FEF2F2; border-left: 4px solid #EF4444; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                            <div style="font-weight: 900; color: #B91C1C; font-size: 0.95rem; margin-bottom: 8px;">❌ AI 分析發生錯誤</div>
                                            <div style="font-size: 0.85rem; color: #7F1D1D; word-break: break-word; background: #FECACA; padding: 8px; border-radius: 4px;">${errorLogText.replace(/\n/g, '<br>')}</div>
                                        </div>
                                    `;
                                }
                            }
                        }
                    }

                    let iconStr = '📁';
                    if (task.type === 'check') iconStr = '📌';
                    if (task.type === 'link') iconStr = '🔗';
                    if (task.type === 'audio_record') iconStr = '🎙️';
                    
                    let iconHtml = `<span style="display:inline-block; width:1.5rem; text-align:center; font-size:1.15rem; margin-right:4px; line-height:1;">${iconStr}</span>`;
                    const safeCourseId = escapeJsSingleQuoted(course.id);
                    const safeTaskId = escapeJsSingleQuoted(task.id);
                    let checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px; cursor: pointer;" onchange="window.FeatureStudentTimeline.updateProgress('${safeCourseId}', '${safeTaskId}', this.checked)" ${checked}>`;

                    let btn = '';
                    let taskTitleDisplay = '';
                    let linkContent = '';

                    const formattedTaskUrl = safeFormatUrl ? String(safeFormatUrl(task.url) ? safeFormatUrl(task.url) : '') : '';

                    if (task.type === 'link') {
                        let safeUrlText = task.url_text ? task.url_text : '';
                        let actualUrlText = stripHtml(safeUrlText);
                        let actualTitle = stripHtml(task.title ? task.title : '');

                        if (actualUrlText !== '') {
                            let displayTitle = actualTitle ? actualTitle : '未命名任務';
                            taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;
                            linkContent = formattedTaskUrl ? `<a href="${escapeAttr(formattedTaskUrl)}" target="_blank" class="btn-action" style="font-size:0.85rem; background:#EEF2FF; color:#4F46E5; text-decoration:none; padding:4px 10px; border-radius:6px; font-weight:800;" onclick="window.FeatureStudentTimeline.updateProgress('${safeCourseId}', '${safeTaskId}', true)">${escapeAttr(actualUrlText)}</a>` : '';
                        } else {
                            let fallbackText = actualTitle ? actualTitle : '未命名連結';
                            if (formattedTaskUrl) {
                                taskTitleDisplay = `<a href="${escapeAttr(formattedTaskUrl)}" target="_blank" class="rt-normalize" style="font-weight:900; color:var(--primary); text-decoration:underline; font-size:1rem;" onclick="window.FeatureStudentTimeline.updateProgress('${safeCourseId}', '${safeTaskId}', true)">${escapeAttr(fallbackText)}</a>`;
                            } else {
                                taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(fallbackText)} (無網址)</span>`;
                            }
                        }
                    } else if (task.type === 'audio_record') {
                        
                        let studioScript = '';
                        let originalScript = '';
                        let materialUrl = '';
                        let materialRange = '';
                        if (task.raw_data) {
                            if (task.raw_data.original_script) originalScript = String(task.raw_data.original_script);
                            if (task.raw_data.student_display_text) studioScript = String(task.raw_data.student_display_text);
                            else if (task.raw_data.student_display) studioScript = String(task.raw_data.student_display);
                            else if (task.raw_data.student_text) studioScript = String(task.raw_data.student_text);
                            else studioScript = originalScript;
                            if (task.raw_data.material_url) materialUrl = String(task.raw_data.material_url);
                            if (task.raw_data.material_range) materialRange = String(task.raw_data.material_range);
                        }

                        let displayTitle = stripHtml(task.title ? task.title : '語音錄製任務');
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem; vertical-align:middle;">${escapeAttr(displayTitle)}</span>`;

                        const captureStudio = !(task.raw_data && task.raw_data.capture_studio === false);
                        const captureUpload = !(task.raw_data && task.raw_data.capture_upload === false);

                        if (!canUpload) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⛔ 已逾期，停止收件</div>`;
                        } else if (!studentDriveUrl) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⚠️ 您的專屬資料夾尚未設定</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功後將自動打勾">`;
                            
                            const pureTaskTitle = displayTitle || '未命名任務';
                            const statusId = `upload-status-${course.id}-${task.id}`;
                            
                            const safeTitleForJS = escapeJsSingleQuoted(pureTaskTitle);
                            const boothScript = studioScript || originalScript;
                            const safeScriptForJS = escapeJsSingleQuoted(boothScript);
                            const safeUrlForJS = escapeJsSingleQuoted(safeFormatUrl ? safeFormatUrl(materialUrl) : materialUrl);
                            const safeRangeForJS = escapeJsSingleQuoted(materialRange);

                            const recordBtnText = hasValidAudioFile ? '重新錄製' : '🎙️ 開啟錄音艙';
                            const recordBtnStyle = hasValidAudioFile ? 
                                'background:white; color:#94A3B8; border:1px solid #CBD5E1;' : 
                                'background:#EF4444; color:white; border:none; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';

                            const audioUploadId = `audio-upload-input-${course.id}-${task.id}`;

                            let audioPlayerHtml = '';
                            let manualSubmitBtnHtml = '';

                            if (hasValidAudioFile) {
                                audioPlayerHtml = buildSubmittedFilesHtml(
                                    submittedFileIds,
                                    retryAudioUrl,
                                    inlinePlayerId,
                                    submittedFileMetas
                                );
                                
                                let showManualSubmit = false;
                                if (taskStatus === 'submitted') showManualSubmit = true;
                                else if (taskStatus === 'failed') showManualSubmit = true;
                                else if (taskStatus === 'ai_error') showManualSubmit = true;
                                else if (taskStatus === 'ai_ready') showManualSubmit = true;

                                if (showManualSubmit) {
                                    const rawRetryUrl = retryAudioUrl ? retryAudioUrl : '';
                                    const safeRetryAudioUrl = escapeJsSingleQuoted(rawRetryUrl);
                                    const safeRetryId = escapeJsSingleQuoted(retryAudioId);
                                    const manualSubmitLabel = taskStatus === 'ai_ready'
                                        ? '🤖 重新提交批改'
                                        : '🤖 手動提交批改';
                                    manualSubmitBtnHtml = `<button onclick="window.FeatureStudentTimeline.retryAIGrading('${safeCourseId}', '${safeTaskId}', '${safeRetryId}', '${safeRetryAudioUrl}')" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:6px 12px; border-radius:6px; font-weight:800; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4);">${manualSubmitLabel}</button>`;
                                }
                            }

                            const openFileBtnHtml = (hasValidAudioFile && retryAudioId)
                                ? `<a href="${escapeAttr(resolveDriveViewUrl(retryAudioId))}" target="_blank" rel="noopener" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; text-decoration:none; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📂 繳交檔</a>`
                                : `<button onclick="window.FeatureStudentTimeline.openDriveAndCheck()" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📁 Drive</button>`;

                            const studioBtnHtml = captureStudio
                                ? `<button onclick="window.FeatureStudentTimeline.openAudioStudio('${safeCourseId}', '${safeTaskId}', '${safeTitleForJS}', '${safeScriptForJS}', '${safeUrlForJS}', '${safeRangeForJS}')" class="btn-action" style="${recordBtnStyle} cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">${recordBtnText}</button>`
                                : '';
                            const uploadBtnHtml = captureUpload
                                ? `<input type="file" id="${audioUploadId}" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.webm,.flac,.amr,.3gp,.wma,.mp4" style="display:none;" onchange="window.FeatureStudentTimeline.handleAudioFileUpload(this, '${safeCourseId}', '${safeTaskId}', '${safeTitleForJS}', '${statusId}', ${isLateUpload})">
                                    <button onclick="document.getElementById('${audioUploadId}').click()" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;" title="支援 mp3、wav、m4a、webm 等">📤 上傳音檔</button>`
                                : '';

                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${audioPlayerHtml}
                                    ${studioBtnHtml}
                                    ${uploadBtnHtml}
                                    ${openFileBtnHtml}
                                    ${manualSubmitBtnHtml}
                                    <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                                </div>
                            `;
                        }
                    } else if (task.type === 'drive') {
                        let displayTitle = stripHtml(task.title ? task.title : '未命名任務');
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;

                        if (!canUpload) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⛔ 已逾期，停止收件</div>`;
                        } else if (!studentDriveUrl) {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked}>`;
                            btn = `<div style="color:#EF4444; font-size:0.85rem; font-weight:800; background:#FEF2F2; padding:4px 10px; border-radius:6px; border:1px solid #FECACA; display:inline-block;">⚠️ 您的專屬資料夾尚未設定</div>`;
                        } else {
                            checkboxHtml = `<input type="checkbox" class="task-checkbox" style="transform: scale(1.3); margin-right: 8px; margin-top: 2px;" disabled ${checked} title="上傳成功後將自動打勾">`;
                            
                            const pureTaskTitle = displayTitle || '未命名任務';
                            const safeTitleForJS = escapeJsSingleQuoted(pureTaskTitle);
                            
                            let safeNodeTitleStr = node.title ? node.title : '';
                            const safeNodeTitle = escapeJsSingleQuoted(String(safeNodeTitleStr).replace(/[\/\\:*?"<>\x7C]/g, '_'));

                            const uniqueId = `file-input-${course.id}-${task.id}`;
                            const statusId = `upload-status-${course.id}-${task.id}`;

                            const drivePreviewHtml = hasValidAudioFile
                                ? buildSubmittedFilesHtml(submittedFileIds, retryAudioUrl, inlinePlayerId, submittedFileMetas)
                                : '';
                            const driveOpenBtnHtml = (hasValidAudioFile && (retryAudioId || submittedFileIds[0]))
                                ? `<a href="${escapeAttr(resolveDriveViewUrl(retryAudioId || submittedFileIds[0]))}" target="_blank" rel="noopener" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; text-decoration:none; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📂 繳交檔</a>`
                                : `<button onclick="window.FeatureStudentTimeline.openDriveAndCheck()" class="btn-action" style="border:1px solid #CBD5E1; background:white; color:#64748B; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📁 Drive</button>`;

                            btn = `
                                <div style="display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    ${drivePreviewHtml}
                                    <input type="file" id="${uniqueId}" multiple style="display:none;" onchange="window.FeatureStudentTimeline.handleFileSelect(this, '${safeCourseId}', '${safeTaskId}', '${safeTitleForJS}', '${statusId}', '${safeNodeTitle}',${isLateUpload})">
                                    <button onclick="document.getElementById('${uniqueId}').click()" class="btn-action" style="background:#10B981; color:white; border:none; cursor:pointer; font-size:0.85rem; padding:4px 10px; border-radius:6px; font-weight:800;">📤 上傳檔案</button>
                                    ${driveOpenBtnHtml}
                                    <span id="${statusId}" style="font-size:0.75rem; font-weight:bold; color:#64748B;"></span>
                                </div>
                            `;
                        }
                    } else {
                        let displayTitle = stripHtml(task.title ? task.title : '未命名任務');
                        taskTitleDisplay = `<span class="rt-normalize" style="font-weight:900; color:#334155; font-size:1rem;">${escapeAttr(displayTitle)}</span>`;
                    }

                    let cleanTaskDesc = '';
                    if (task.description) {
                        cleanTaskDesc = String(task.description).replace(/<[^>]*>?/gm, '').trim();
                    }
                    
                    let materialRangeText = '';
                    if (task.type === 'audio_record') {
                        if (task.raw_data) {
                            if (task.raw_data.material_range) {
                                materialRangeText = String(task.raw_data.material_range).trim();
                            }
                        }
                    }

                    let finalDescText = cleanTaskDesc;
                    if (materialRangeText !== '') {
                        const rangeStr = `(範圍：${materialRangeText})`;
                        if (finalDescText !== '') {
                            finalDescText = `${finalDescText} ${rangeStr}`;
                        } else {
                            finalDescText = rangeStr;
                        }
                    }

                    let taskDescHtml = '';
                    if (finalDescText !== '') {
                        taskDescHtml = `<div class="rt-normalize" style="font-size:0.85rem; color:#64748B; margin-top:6px; padding-left:36px;">${finalDescText}</div>`;
                    }
                    
                    let showTaskDue = false;
                    if (task.due_date) {
                        if (task.due_date !== effectiveBlockDueDate) showTaskDue = true;
                    }
                    let localDueHtml = showTaskDue ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 6px; border-radius:4px;">⏰ 期限: ${task.due_date}</span>` : '';

                    let borderBottom = isLastLeaf ? 'none' : '1px solid rgba(0,0,0,0.08)';

                    return `
                        <div style="padding:10px 5px; background:transparent; border-bottom:${borderBottom}; transition: 0.2s;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; line-height: 1.2;">
                                    ${checkboxHtml}${iconHtml}${taskTitleDisplay}${statusBadgeHtml}${localDueHtml}${linkContent}
                                </div>
                                ${btn}
                            </div>
                            ${taskDescHtml}${aiFeedbackHtml}
                        </div>
                    `;
                };

                reversedNodes.forEach(({ node, weekIndex }) => {
                    if (!node) return;
                    if (!Array.isArray(node.dates)) return;
                    if (node.dates.length === 0) return;
                    
                    const nodeWeekStart = DateUtils ? DateUtils.getWeekStartStr(node.dates[0], weekStartSetting) : '';
                    
                    let badge = '';
                    let borderColor = '#E2E8F0';
                    let dotColor = '#E2E8F0';
                    let bgColor = '#FFFFFF';
                    let headerTextColor = '#475569';
                    let isCurrentWeek = false;
                    let isFutureWeek = false;
                    
                    if (nodeWeekStart === currentWeekStart) {
                        badge = '<span style="background: #10B981; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; margin-left: 10px; font-weight:900; animation: pulse-green 2s infinite;">📍 當週</span>';
                        borderColor = '#10B981';
                        dotColor = '#10B981';
                        bgColor = '#ECFDF5'; 
                        headerTextColor = '#065F46';
                        isCurrentWeek = true;
                    } else if (nodeWeekStart > currentWeekStart) {
                        isFutureWeek = true;
                    } else {
                        dotColor = '#CBD5E1';
                        bgColor = '#F8FAFC'; 
                        headerTextColor = '#94A3B8';
                    }

                    const coursesInDate = safeAssignments.filter(a => {
                        if (!a) return false;
                        if (!a.target_date) return false;
                        if (!DateUtils) return false;
                        return node.dates.includes(DateUtils.normalizeDateString(a.target_date));
                    });
                    
                    if (isFutureWeek && coursesInDate.length === 0) return; 

                    let totalTasksInDate = 0;
                    let doneTasksInDate = 0;
                    let coursesHtml = '';

                    if (coursesInDate.length > 0) {
                        coursesHtml = coursesInDate.map(course => {
                            let effectiveBlockDueDate = course.due_date;
                            if (!effectiveBlockDueDate && Array.isArray(course.tasks) && course.tasks.length > 0) {
                                const explicitDates = course.tasks.map(t => t.due_date).filter(d => d);
                                if (explicitDates.length === course.tasks.length && explicitDates.every(d => d === explicitDates[0])) {
                                    effectiveBlockDueDate = explicitDates[0];
                                }
                            }
                            
                            let aRaw = course.raw_data ? course.raw_data : {};
                            if (typeof aRaw === 'string') {
                                try { aRaw = JSON.parse(aRaw); } catch(e) { aRaw = {}; }
                            }
                            
                            let isLateUpload = false;
                            let allowLateFlag = false;
                            if (aRaw.late_policy && typeof aRaw.late_policy === 'object') {
                                allowLateFlag = aRaw.late_policy.allow_late === true;
                            } else if (aRaw.allow_late === true) {
                                allowLateFlag = true;
                            }
                            
                            if (effectiveBlockDueDate && DateUtils) {
                                isLateUpload = DateUtils.isPastDue(effectiveBlockDueDate);
                            }

                            const countTasksRecursive = (tasksList) => {
                                if (!Array.isArray(tasksList)) return;
                                tasksList.forEach(t => {
                                    if (t && t.type === 'group') {
                                        countTasksRecursive(t.subTasks);
                                    } else if (t) {
                                        totalTasksInDate += 1;
                                        if (safeCompletedTasks.includes(`${course.id}_${t.id}`)) {
                                            doneTasksInDate += 1;
                                        }
                                    }
                                });
                            };
                            if (course.tasks) countTasksRecursive(course.tasks);

                            let cleanBlockDesc = course.description ? String(course.description).replace(/<[^>]*>?/gm, '').trim() : '';
                            let blockDescHtml = cleanBlockDesc !== '' ? `<div class="rt-normalize" style="font-size:0.95rem; color:#64748B; margin-top:8px;">${course.description}</div>` : '';
                            
                            let lateBadgeText = (isLateUpload && allowLateFlag) ? ' (接受遲交)' : '';
                            let dueHtml = effectiveBlockDueDate ? `<span style="font-size:0.8rem; color:#EF4444; border:1px solid #FECACA; padding:2px 8px; border-radius:4px; margin-left:10px;">⏰ 期限: ${effectiveBlockDueDate}${lateBadgeText}</span>` : '';

                            const renderTaskTree = (tasksList, depth = 0) => {
                                if (!Array.isArray(tasksList)) return '';
                                if (tasksList.length === 0) return '';
                                
                                return tasksList.map((task, idx) => {
                                    if (!task) return '';
                                    const lvl = getLevelStyle(depth);
                                    
                                    let isFirstLeaf = (idx === 0);
                                    if (!isFirstLeaf && tasksList[idx - 1] && tasksList[idx - 1].type === 'group') isFirstLeaf = true;
                                    
                                    let isLastLeaf = (idx === tasksList.length - 1);
                                    if (!isLastLeaf && tasksList[idx + 1] && tasksList[idx + 1].type === 'group') isLastLeaf = true;
                                    
                                    if (task.type === 'group') {
                                        let groupTitle = String(task.title ? task.title : '未命名作業群組');
                                        let subTasksHtml = '';
                                        
                                        if (Array.isArray(task.subTasks) && task.subTasks.length > 0) {
                                            subTasksHtml = `<div style="display:flex; flex-direction:column;">` +
                                                renderTaskTree(task.subTasks, depth + 1) +
                                                `</div>`;
                                        } else {
                                            subTasksHtml = `<div style="color:#94A3B8; font-size: 0.9rem; font-style: italic; padding-left: 20px; margin-top:5px;">(此作業群組尚無內容)</div>`;
                                        }

                                        const marginStyle = depth > 0 ? 'margin-top:5px;' : 'margin-top:10px;';

                                        return `
                                            <div style="${marginStyle} margin-bottom: 10px; padding: 12px; background:${lvl.bg}; border: 1px solid #E2E8F0; border-radius: 8px;">
                                                <div style="font-weight:900; color:${lvl.text}; font-size:1.05rem; display:flex; align-items:center; gap:8px; margin-bottom: 8px;">
                                                    <span style="font-size:1.2rem;">🗂️</span> <span class="rt-normalize">${groupTitle}</span>
                                                </div>
                                                ${subTasksHtml}
                                            </div>
                                        `;
                                    } else {
                                        return renderTaskItem(task, course, effectiveBlockDueDate, isLateUpload, allowLateFlag, node, depth, isFirstLeaf, isLastLeaf);
                                    }
                                }).join('');
                            };

                            let tasksHtml = '';
                            if (Array.isArray(course.tasks) && course.tasks.length > 0) {
                                tasksHtml = renderTaskTree(course.tasks, 0);
                            }
                            
                            let safeCourseTitle = course.title ? course.title : '';

                            return `
                                <div id="assign-block-${course.id}" data-assignment-id="${course.id}" class="student-assign-block" style="background: white; border: 2px solid #F1F5F9; padding: 15px; border-radius: 10px; margin-top:15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); transition: border 0.2s; scroll-margin-top: 80px;">
                                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:2px solid #F1F5F9; padding-bottom:10px; margin-bottom:10px;">
                                        <div style="flex: 1; min-width:200px; display:flex; justify-content:space-between; align-items:center;">
                                            <div style="font-weight: 900; color: #334155; font-size: 1rem; display:flex; align-items:center; flex-wrap:wrap;">
                                                📝 <span class="rt-normalize">${String(safeCourseTitle)}</span>
                                            </div>
                                            <div>${dueHtml}</div>
                                        </div>
                                    </div>
                                    ${blockDescHtml}
                                    ${tasksHtml ? `<div style="margin-top: 15px; padding-top:10px; border-top:1px dashed #CBD5E1;">${tasksHtml}</div>` : ''}
                                </div>
                            `;
                        }).join('');
                    }

                    let progressBadgeHtml = '';
                    if (totalTasksInDate > 0) {
                        let isAllDone = (totalTasksInDate === doneTasksInDate);
                        let badgeBg = isAllDone ? '#ECFDF5' : '#FFF7ED';
                        let badgeColor = isAllDone ? '#059669' : '#EA580C';
                        let badgeBorder = isAllDone ? '#D1FAE5' : '#FFEDD5';
                        progressBadgeHtml = `
                            <div style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeBorder}; padding:4px 10px; border-radius:20px; font-size:0.85rem; font-weight:800;">
                                完成進度 ${doneTasksInDate} / ${totalTasksInDate}
                            </div>
                        `;
                    }
                    
                    let safeNodeTitleStr = node.title ? node.title : '';

                    html += `
                        <div id="timeline-node-${weekIndex}" class="timeline-node" data-is-current="${isCurrentWeek}" style="scroll-margin-top: 25px; border: 2px solid ${borderColor}; background-color: ${bgColor}; padding: 15px; border-radius: 12px; margin-bottom: 25px; position: relative;">
                            <div class="node-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:10px;">
                                <div class="node-date" style="display:flex; align-items:center; position:relative;">
                                    <div style="position: absolute; left: -65px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: white; border: 4px solid ${dotColor}; z-index: 1;"></div>
                                    <span style="font-weight: 800; color: ${headerTextColor}; font-size:1.05rem;">📅 第 ${weekIndex} ${mode === 'weekly' ? '週' : '堂'} - ${String(safeNodeTitleStr)}</span> ${badge}
                                </div>
                                ${progressBadgeHtml}
                            </div>
                            ${coursesHtml}
                        </div>
                    `;
                });

                return html;
            } catch (error) {
                console.error("🚨 學生時間軸渲染層發生致命錯誤:", error);
                return `
                    <div style="padding:20px; margin:20px; background:#FEF2F2; border:2px solid #EF4444; border-radius:8px; font-family:sans-serif;">
                        <h3 style="color:#991B1B; margin-top:0;">🚨 渲染引擎發生崩潰 (Runtime Error)</h3>
                        <p style="color:#7F1D1D; font-size:0.9rem;">系統已攔截到死當點，請將以下紅色文字截圖給工程師修復，不用重整網頁了！</p>
                        <div style="background:#FECACA; padding:10px; border-radius:4px; font-family:monospace; font-size:0.85rem; color:#EF4444; font-weight:bold; overflow-x:auto;">
                            錯誤訊息：${error.message}
                        </div>
                        <pre style="margin-top:10px; font-size:0.75rem; color:#7F1D1D; overflow-x:auto;">${error.stack}</pre>
                    </div>
                `;
            }
        }
    };
})();
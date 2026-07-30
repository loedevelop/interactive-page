/**
 * 📂 檔案路徑：supabase/functions/stream-audio/index.ts
 * 🌟 職責：Google Drive 音訊中繼代理伺服器 (解決 CORS 阻擋與進度條跳轉問題)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function looksLikeHtml(contentType: string, preview: string): boolean {
    if (contentType.includes('text/html')) return true;
    const p = preview.toLowerCase();
    return p.includes('<!doctype html') || p.includes('<html');
}

/**
 * 🛡️ Google Drive 對「無法掃描病毒」的檔案（不一定要很大，有些音檔也會中）
 * 會回傳確認頁 HTML 而非真正內容。單純加 confirm=t 只能繞過一部分情況，
 * 真正可靠的做法是從確認頁裡解析出 confirm token 與 uuid，
 * 改打 drive.usercontent.google.com/download（Google 目前的大檔下載網域）。
 * 解析失敗時退回舊的 confirm=t 招式當最後防線。
 */
async function resolveRealDownloadUrl(fileId: string): Promise<string> {
    const probeUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const probeRes = await fetch(probeUrl);
    const probeContentType = probeRes.headers.get('Content-Type') || '';

    if (!probeContentType.includes('text/html')) {
        // 不是確認頁，代表這檔案本來就能直接下載
        return probeUrl;
    }

    const html = await probeRes.text();
    const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/) || html.match(/[?&]confirm=([0-9A-Za-z_-]+)/);
    const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/) || html.match(/[?&]uuid=([0-9A-Za-z-]+)/);

    if (confirmMatch && uuidMatch) {
        return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
    }

    // 解析不到 token（頁面格式又變了），退回舊招式
    return `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
}

serve(async (req) => {
    // 處理瀏覽器的預檢請求 (Preflight)
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const fileId = url.searchParams.get('file_id');

        if (!fileId) {
            return new Response(JSON.stringify({ error: 'Missing file_id parameter' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const rangeHeader = req.headers.get('Range');
        const fetchHeaders = new Headers();
        if (rangeHeader) fetchHeaders.set('Range', rangeHeader);

        // 🌟 快速路徑：大多數檔案直接帶 confirm=t 就能拿到真正內容，只打一次 Drive。
        let driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
        let driveResponse = await fetch(driveUrl, { headers: fetchHeaders });

        if (!driveResponse.ok) {
            throw new Error(`Google Drive API responded with status: ${driveResponse.status}`);
        }

        let responseContentType = driveResponse.headers.get('Content-Type') || '';

        // 快速路徑仍被擋（回傳確認頁 HTML）→ 慢速路徑：解析真正的下載網址後重新抓一次。
        if (responseContentType.includes('text/html')) {
            const bodyBuffer = await driveResponse.arrayBuffer();
            const preview = new TextDecoder().decode(bodyBuffer.slice(0, 4000));

            if (!looksLikeHtml(responseContentType, preview)) {
                // 理論上不會發生（content-type 已經是 text/html），保險起見還是放行
                const responseHeaders = new Headers(corsHeaders);
                responseHeaders.set('Content-Type', responseContentType);
                return new Response(bodyBuffer, { status: driveResponse.status, headers: responseHeaders });
            }

            const realUrl = await resolveRealDownloadUrl(fileId);
            driveResponse = await fetch(realUrl, { headers: fetchHeaders });

            if (!driveResponse.ok) {
                throw new Error(`Google Drive API responded with status: ${driveResponse.status}`);
            }

            responseContentType = driveResponse.headers.get('Content-Type') || '';

            if (responseContentType.includes('text/html')) {
                const retryBuffer = await driveResponse.arrayBuffer();
                const retryPreview = new TextDecoder().decode(retryBuffer.slice(0, 2000));
                if (looksLikeHtml(responseContentType, retryPreview)) {
                    return new Response(JSON.stringify({
                        error: 'Google Drive 持續回傳確認頁面而非音檔內容，無法播放（檔案可能權限異常或已被移動）。'
                    }), {
                        status: 502,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                const responseHeaders = new Headers(corsHeaders);
                responseHeaders.set('Content-Type', responseContentType);
                return new Response(retryBuffer, { status: driveResponse.status, headers: responseHeaders });
            }
        }

        // 複製 Google Drive 的回傳標頭，原封不動還給瀏覽器
        const responseHeaders = new Headers(corsHeaders);

        if (responseContentType) responseHeaders.set('Content-Type', responseContentType);
        else responseHeaders.set('Content-Type', 'audio/wav');

        const contentLength = driveResponse.headers.get('Content-Length');
        if (contentLength) responseHeaders.set('Content-Length', contentLength);

        responseHeaders.set('Accept-Ranges', 'bytes');
        const contentRange = driveResponse.headers.get('Content-Range');
        if (contentRange) responseHeaders.set('Content-Range', contentRange);

        // 將聲音串流 (Stream) 直接倒給前端
        return new Response(driveResponse.body, {
            status: driveResponse.status,
            headers: responseHeaders
        });

    } catch (error) {
        console.error("Stream Audio Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

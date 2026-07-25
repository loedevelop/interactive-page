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

        // 構建 Google Drive 下載網址
        const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        
        // 🌟 核心魔法：代理瀏覽器的 Range 請求，實現完美的進度條拉動與切片跳轉！
        const fetchHeaders = new Headers();
        const rangeHeader = req.headers.get('Range');
        if (rangeHeader) {
            fetchHeaders.set('Range', rangeHeader);
        }

        // 從伺服器端直連 Google Drive (無視瀏覽器跨域限制)
        const driveResponse = await fetch(driveUrl, { headers: fetchHeaders });

        if (!driveResponse.ok) {
            throw new Error(`Google Drive API responded with status: ${driveResponse.status}`);
        }

        // 複製 Google Drive 的回傳標頭，原封不動還給瀏覽器
        const responseHeaders = new Headers(corsHeaders);
        
        const contentType = driveResponse.headers.get('Content-Type');
        if (contentType) responseHeaders.set('Content-Type', contentType);
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
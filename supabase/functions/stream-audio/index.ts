/**
 * 📂 檔案路徑：supabase/functions/stream-audio/index.ts
 * 🌟 職責：Google Drive 音訊中繼代理（解決 CORS、Range、大檔掃毒確認頁）
 *
 * 下載策略（依序）：
 * 1. Drive 公開連結 + confirm=t（小檔最快）
 * 2. 解析確認頁 token／uuid，打 drive.usercontent.google.com（並帶 cookie）
 * 3. GAS POST download_file（DriveApp → Base64 JSON）← 大檔／掃毒頁／權限怪檔救星
 *    （不用 GET stream_audio：Web App redirect 會弄壞二進位）
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** 與前端 api.js / api-gas-service.js 同一個 Web App（僅供 Edge Function 伺服器端轉呼） */
const GAS_WEB_APP_URL =
    "https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec";

function looksLikeHtml(contentType: string, preview: string): boolean {
    if (contentType.includes("text/html")) return true;
    const p = preview.toLowerCase();
    return p.includes("<!doctype html") || p.includes("<html");
}

function collectSetCookies(res: Response): string {
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof anyHeaders.getSetCookie === "function") {
        return anyHeaders.getSetCookie().map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    }
    const single = res.headers.get("set-cookie");
    if (!single) return "";
    return single.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function tryDrivePublicDownload(
    fileId: string,
    rangeHeader: string | null,
): Promise<{ ok: true; response: Response; contentType: string } | { ok: false; reason: string }> {
    const fetchHeaders = new Headers();
    if (rangeHeader) fetchHeaders.set("Range", rangeHeader);

    const quickUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    let driveResponse = await fetch(quickUrl, { headers: fetchHeaders });
    if (!driveResponse.ok) {
        return { ok: false, reason: `Drive HTTP ${driveResponse.status}` };
    }

    let contentType = driveResponse.headers.get("Content-Type") || "";
    if (!contentType.includes("text/html")) {
        return { ok: true, response: driveResponse, contentType };
    }

    // 確認頁：讀 HTML、帶 cookie、打 usercontent
    const html = await driveResponse.text();
    if (!looksLikeHtml(contentType, html)) {
        // 罕見：標成 html 但其實不是確認頁
        const buf = new TextEncoder().encode(html);
        return {
            ok: true,
            response: new Response(buf, { status: 200, headers: { "Content-Type": contentType } }),
            contentType,
        };
    }

    const cookies = collectSetCookies(driveResponse);
    const confirmMatch =
        html.match(/name="confirm"\s+value="([^"]+)"/i) ||
        html.match(/[?&]confirm=([0-9A-Za-z_-]+)/) ||
        html.match(/confirm=([0-9A-Za-z_-]{1,10})/);
    const uuidMatch =
        html.match(/name="uuid"\s+value="([^"]+)"/i) ||
        html.match(/[?&]uuid=([0-9A-Za-z-]+)/);

    let realUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    if (confirmMatch && uuidMatch) {
        realUrl =
            `https://drive.usercontent.google.com/download?id=${fileId}&export=download` +
            `&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
    } else if (confirmMatch) {
        realUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmMatch[1]}`;
    }

    const retryHeaders = new Headers();
    if (rangeHeader) retryHeaders.set("Range", rangeHeader);
    if (cookies) retryHeaders.set("Cookie", cookies);

    driveResponse = await fetch(realUrl, { headers: retryHeaders, redirect: "follow" });
    if (!driveResponse.ok) {
        return { ok: false, reason: `Drive retry HTTP ${driveResponse.status}` };
    }

    contentType = driveResponse.headers.get("Content-Type") || "";
    if (contentType.includes("text/html")) {
        const preview = (await driveResponse.clone().text()).slice(0, 2000);
        if (looksLikeHtml(contentType, preview)) {
            return { ok: false, reason: "Drive 持續回傳確認頁 HTML" };
        }
    }

    return { ok: true, response: driveResponse, contentType };
}

function base64ToUint8Array(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * GAS DriveApp 備援：POST download_file → Base64 JSON。
 * 不用 GET stream_audio（createBinaryOutput 經 Web App redirect 後二進位常壞掉）。
 * 注意：大檔會整包載入；單檔約 40MB 上限。
 */
async function fetchViaGas(fileId: string): Promise<Response | null> {
    const gasRes = await fetch(GAS_WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "download_file", fileId }),
        redirect: "follow",
    });
    if (!gasRes.ok) {
        console.error("GAS download_file HTTP", gasRes.status);
        return null;
    }

    const text = await gasRes.text();
    if (!text || text.length < 32) {
        console.error("GAS download_file body too small", text?.length || 0);
        return null;
    }
    if (looksLikeHtml("text/html", text.slice(0, 400))) {
        console.error("GAS download_file returned HTML");
        return null;
    }

    let parsed: {
        status?: string;
        message?: string;
        fileData?: string;
        mimeType?: string;
    };
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        console.error("GAS download_file JSON parse failed", e);
        return null;
    }
    if (parsed.status !== "success" || !parsed.fileData) {
        console.error("GAS download_file error:", parsed.message || parsed.status);
        return null;
    }

    const bytes = base64ToUint8Array(parsed.fileData);
    if (bytes.byteLength < 64) {
        console.error("GAS download_file decoded too small", bytes.byteLength);
        return null;
    }

    let outType = parsed.mimeType || "audio/wav";
    if (outType === "application/octet-stream" || outType === "text/plain") {
        outType = "audio/wav";
    }

    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", outType);
    headers.set("Content-Length", String(bytes.byteLength));
    headers.set("Accept-Ranges", "none");

    return new Response(bytes, { status: 200, headers });
}

function passThroughDrive(driveResponse: Response, contentType: string): Response {
    const responseHeaders = new Headers(corsHeaders);
    if (contentType) responseHeaders.set("Content-Type", contentType);
    else responseHeaders.set("Content-Type", "audio/wav");

    const contentLength = driveResponse.headers.get("Content-Length");
    if (contentLength) responseHeaders.set("Content-Length", contentLength);

    responseHeaders.set("Accept-Ranges", "bytes");
    const contentRange = driveResponse.headers.get("Content-Range");
    if (contentRange) responseHeaders.set("Content-Range", contentRange);

    return new Response(driveResponse.body, {
        status: driveResponse.status,
        headers: responseHeaders,
    });
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const fileId = url.searchParams.get("file_id");

        if (!fileId) {
            return new Response(JSON.stringify({ error: "Missing file_id parameter" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const rangeHeader = req.headers.get("Range");
        const driveAttempt = await tryDrivePublicDownload(fileId, rangeHeader);

        if (driveAttempt.ok) {
            return passThroughDrive(driveAttempt.response, driveAttempt.contentType);
        }

        console.warn("Drive public download failed:", driveAttempt.reason, "→ fallback GAS", fileId);

        const gasResponse = await fetchViaGas(fileId);
        if (gasResponse) return gasResponse;

        return new Response(JSON.stringify({
            error:
                "無法取得音檔：Google Drive 公開下載被擋（" + driveAttempt.reason +
                "），且 GAS download_file 備援也失敗。請確認：1) 已重新部署含 download_file 的 GAS Web App；" +
                "2) 檔案仍在 Drive 且 GAS 帳號有權限；3) 檔案未超過約 40MB。",
        }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Stream Audio Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});

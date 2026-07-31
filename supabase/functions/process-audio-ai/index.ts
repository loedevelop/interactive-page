import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * 🚨 緊急停機版（2026-07-31）
 * 目的：停止 AI 批改 Edge 對 Supabase 的連線風暴，讓登入／整站恢復。
 * 完整邏輯備份：index.ts.bak-stable
 * 網站恢復後，再把.bak-stable 還原並重新部署（勿帶延遲自動重試）。
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 吞掉所有 webhook／續跑／延遲重試，不做任何 DB 讀寫
  let bodyPreview = "";
  try {
    bodyPreview = (await req.text()).slice(0, 200);
  } catch (_e) {
    /* ignore */
  }
  console.warn("process-audio-ai KILL_SWITCH active; ignored invoke:", bodyPreview);

  return new Response(
    JSON.stringify({
      success: true,
      killed: true,
      message: "AI grading temporarily disabled to restore site availability.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

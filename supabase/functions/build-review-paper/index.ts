/**
 * 複習專區出卷：驗證 JWT 後轉呼 SECURITY DEFINER RPC build_review_paper。
 * 學生瀏覽器不讀 class_review_catalog_meta，也不打 GAS。
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization") || "";
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Not authenticated" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") || "";
        const supabase = createClient(supabaseUrl, supabaseAnon, {
            global: { headers: { Authorization: authHeader } },
        });

        const body = await req.json();
        const { data, error } = await supabase.rpc("build_review_paper", {
            p_class_id: body.class_id,
            p_mode: body.mode,
            p_folder_name: body.folder_name,
            p_sheet_stems: body.sheet_stems,
            p_page_start: body.page_start,
            p_page_end: body.page_end,
            p_count: body.count,
            p_practice_count: body.practice_count == null ? 1 : body.practice_count,
        });

        if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});

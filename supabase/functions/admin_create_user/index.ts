/**
 * Supabase Edge Function: admin_create_user
 * 負責處理跨越權限的「靜默建檔」與「帳號衝突智慧變形」
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS", // 🛡️ 必須加上 POST，防止瀏覽器阻擋
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 1. 攔截 OPTIONS 預檢請求
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("伺服器環境變數缺失 (請確認已在 Supabase 後台設定 SERVICE_ROLE_KEY)");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { name, email, phone, roleType, rawData = {} } = body;

    if (!name || !email) {
      throw new Error("姓名與 Email 為必填欄位");
    }

    let targetEmail = email.trim().toLowerCase();
    const defaultPassword = "LogOn" + new Date().getFullYear();
    const uniqueSuffix = Date.now().toString().slice(-4); 

    // 🚨 修正：改用 maybeSingle()，防堵查無舊帳號時直接崩潰
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", targetEmail)
      .maybeSingle();

    if (existingProfile) {
      const [username, domain] = targetEmail.split("@");
      const supportedAliasDomains = ["gmail.com", "googlemail.com", "icloud.com"];

      if (supportedAliasDomains.includes(domain)) {
        targetEmail = `${username}+${uniqueSuffix}@${domain}`;
      } else {
        if (!phone) {
          throw new Error("信箱已被使用且不支援別名。請在前端補填「手機號碼」以合成新帳號。");
        }
        const cleanPhone = phone.replace(/[^0-9]/g, "");
        targetEmail = `${cleanPhone}-${uniqueSuffix}@logon.tw`;
      }
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: targetEmail,
      password: defaultPassword,
      email_confirm: true, 
      user_metadata: { name: name },
    });

    if (authError) throw authError;

    const newUserId = authData.user.id;

    const defaultRoleMap: Record<string, string> = {
      student: "student",
      parent: "parent",
      co_teacher: "staff",
      ta_senior: "staff",
      ta_junior: "staff",
    };

    const { error: profileError } = await supabaseAdmin.from("profiles").insert([{
      id: newUserId,
      email: targetEmail,
      name: name,
      phone: phone || null,
      default_role: defaultRoleMap[roleType] || "student",
      raw_data: { 
        ...rawData, 
        source: "admin_silent_creation",
        original_conflict_email: existingProfile ? email : null 
      },
    }]);

    if (profileError) {
      // Rollback 機制：如果 profiles 寫入失敗，同步刪除剛建立的 auth.users 帳號
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw profileError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        login_email: targetEmail,
        login_password: defaultPassword,
        is_mutated: !!existingProfile
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    // 1. 🔍 強制在雲端控制台日誌印出最詳細的錯誤物件與追蹤軌跡
    console.error("🔥 [Edge Function Error Log]:", error);
    
    // 2. 🔍 解除物件轉 JSON 變成空的 "{}" 的限制，抽取真實字串訊息
    let errorMessage = "未知錯誤";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === "object") {
      errorMessage = error.message || JSON.stringify(error);
    } else if (error) {
      errorMessage = String(error);
    }

    // 🚨 發生錯誤時也必須加上 corsHeaders，並將真實的錯誤字串傳回前端
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
/**
 * Supabase Edge Function: admin_create_user
 * 🌟 實作「學生帳號防衝突雙軌制」：Gmail 體系採用 + 號；非 Gmail 體系採用 LogOnEnglish 專屬網域。
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
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
    let isMutated = false;
    let originalEmail = null;

    // 1. 查詢 Email 是否已存在
    const { data: existingProfile, error: searchError } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .eq("email", targetEmail)
      .maybeSingle();

    if (searchError) {
      throw new Error(`查詢帳號時發生錯誤: ${searchError.message}`);
    }

    // 2. 🚦 針對已存在帳號的「分流防護邏輯」
    if (existingProfile) {
      originalEmail = targetEmail;

      // 情況 A：如果身分是「學生」，啟動您決定的帳號自動變形雙軌制
      if (roleType === "student") {
        const [username, domain] = targetEmail.split("@");
        const supportedAliasDomains = ["gmail.com", "googlemail.com", "icloud.com"];
        
        // 擷取姓名並去除空白 (優先使用英文名，若無則使用中文名)
        const rawEn = (rawData.nameEN || "").trim();
        const rawLastCN = (rawData.lastNameCN || "").trim();
        const rawFirstCN = (rawData.firstNameCN || "").trim();
        const studentName = (rawEn || rawLastCN + rawFirstCN).replace(/\s+/g, '') || "Student";

        if (supportedAliasDomains.includes(domain)) {
          // 策略 1: Gmail 體系 -> 加 + 號與學生姓名
          targetEmail = `${username}+${studentName}@${domain}`.toLowerCase();
        } else {
          // 策略 2: 非 Gmail 體系 -> 轉內部網域並加手機末四碼
          if (!phone || phone.replace(/[^0-9]/g, "").length < 4) {
            throw new Error("此信箱不支援別名，系統需轉換為 LogOn 內部網域帳號。請務必填寫家長「手機號碼」(至少4碼)，以生成該學生專屬帳號。");
          }
          const phoneLast4 = phone.replace(/[^0-9]/g, "").slice(-4);
          targetEmail = `${studentName}.${phoneLast4}@logonenglish.com`.toLowerCase();
        }
        isMutated = true;
      } 
      // 情況 B：如果是「教職員」或「家長」，絕對不變形，直接綁定原帳號
      else {
        return new Response(
          JSON.stringify({
            success: true,
            user_id: existingProfile.id,
            login_email: existingProfile.email,
            is_existing: true,
            message: "此帳號已存在，系統將直接賦予該帳號本班權限。"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    }

    // 3. 建立全新的 Auth 帳號 (全新信箱，或是經過變形後的學生信箱)
    const defaultPassword = "LogOn" + new Date().getFullYear();
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

    // 4. 同步寫入 Profiles，並將預設密碼寫入
    const { error: profileError } = await supabaseAdmin.from("profiles").insert([{
      id: newUserId,
      email: targetEmail,
      password: defaultPassword,
      name: name,
      phone: phone || null,
      default_role: defaultRoleMap[roleType] || "student",
      raw_data: { 
        ...rawData, 
        source: "admin_silent_creation",
        original_conflict_email: isMutated ? originalEmail : null 
      },
    }]);

    if (profileError) {
      // Rollback
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw profileError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        login_email: targetEmail,
        login_password: defaultPassword,
        is_existing: false,
        is_mutated: isMutated
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    console.error("🔥 [Edge Function Error Log]:", error);
    
    let errorMessage = "未知錯誤";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === "object") {
      errorMessage = error.message || JSON.stringify(error);
    } else if (error) {
      errorMessage = String(error);
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
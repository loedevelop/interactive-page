/**
 * Supabase Edge Function: admin_create_user
 * 🌟 純粹化建檔引擎與舊資料救援 (Legacy Patch)
 * 1. 變異邏輯已移交前端處理，後端僅接收最終 Email。
 * 2. 舊帳號救援：當 Email 已存在時，無痛合併缺失的 raw_data (如 nameEN)，修復舊系統遺毒避免 500 當機。
 * 3. 尊重情境身分制，絕對不更動現有帳號的 default_role。
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
    // 前端已經傳來處理好的最終 Email (若有打勾，已是變異後的 Email)
    const { name, email, phone, roleType, rawData = {}, isMutated, originalEmail } = body;

    if (!name || !email) {
      throw new Error("姓名與 Email 為必填欄位");
    }

    let targetEmail = email.trim().toLowerCase();

    // 1. 查詢 Email 是否已存在 (撈取 raw_data 進行後續修復)
    const { data: existingProfile, error: searchError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, raw_data")
      .eq("email", targetEmail)
      .maybeSingle();

    if (searchError) {
      throw new Error(`查詢帳號時發生錯誤: ${searchError.message}`);
    }

    // 2. 🚦 帳號已存在 -> 執行「舊資料救援 Legacy Patch」後直接放行
    if (existingProfile) {
        let oldRawData = existingProfile.raw_data;
        if (typeof oldRawData === "string") {
            try { oldRawData = JSON.parse(oldRawData); } catch (e) { oldRawData = {}; }
        } else if (!oldRawData || typeof oldRawData !== "object") {
            oldRawData = {};
        }

        // 帳號已存在：老師這次送出的姓名欄位一律覆寫（修正打錯名後改不回來）
        const mergedRawData = {
            ...oldRawData,
            nameEN: rawData.nameEN != null ? String(rawData.nameEN) : (oldRawData.nameEN || ""),
            lastNameCN: rawData.lastNameCN != null ? String(rawData.lastNameCN) : (oldRawData.lastNameCN || ""),
            firstNameCN: rawData.firstNameCN != null ? String(rawData.firstNameCN) : (oldRawData.firstNameCN || ""),
            passportLast: rawData.passportLast != null ? String(rawData.passportLast) : (oldRawData.passportLast || ""),
            passportFirst: rawData.passportFirst != null ? String(rawData.passportFirst) : (oldRawData.passportFirst || ""),
        };
        
        // 確保不會洗掉已有的專屬 Drive 連結
        if (rawData.drive_url) {
            mergedRawData.drive_url = rawData.drive_url;
        }

        const profilePatch: Record<string, unknown> = { raw_data: mergedRawData, name: name };
        if (phone) profilePatch.phone = phone;

        const { error: updateErr } = await supabaseAdmin
            .from("profiles")
            .update(profilePatch)
            .eq("id", existingProfile.id);

        if (updateErr) {
            console.error("更新舊帳號資料失敗:", updateErr);
            throw new Error(`更新既有帳號姓名失敗: ${updateErr.message}`);
        }

        return new Response(
          JSON.stringify({
            success: true,
            user_id: existingProfile.id,
            login_email: existingProfile.email,
            is_existing: true,
            message: "此帳號已存在，系統已安全更新資料並回傳 ID。"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
    }

    // 3. 帳號不存在 -> 建立全新的 Auth 帳號
    const defaultPassword = "LogOn" + new Date().getFullYear();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: targetEmail,
      password: defaultPassword,
      email_confirm: true, 
      user_metadata: { name: name },
    });

    if (authError) {
        throw new Error(`建立驗證帳號失敗: ${authError.message}`);
    }

    const newUserId = authData.user.id;

    const defaultRoleMap: Record<string, string> = {
      student: "student",
      parent: "parent",
      co_teacher: "staff",
      ta_senior: "staff",
      ta_junior: "staff",
    };

    // 4. 同步寫入 Profiles
    const { error: profileError } = await supabaseAdmin.from("profiles").insert([{
      id: newUserId,
      email: targetEmail,
      password: defaultPassword,
      name: name,
      phone: phone || null,
      default_role: defaultRoleMap[roleType] || "student", // 僅在新建時給予預設值，之後不再依賴
      raw_data: { 
        ...rawData, 
        source: "admin_silent_creation",
        original_conflict_email: isMutated ? originalEmail : null 
      },
    }]);

    if (profileError) {
      // Rollback
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(`寫入使用者主檔失敗: ${profileError.message}`);
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 } // 永遠以 400 回傳，避免前端收到 500 當機
    );
  }
});
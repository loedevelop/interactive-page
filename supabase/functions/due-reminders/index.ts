/**
 * 到期提醒掃描 + 文字 email（Resend 可選）
 * 觸發：Authorization: Bearer <CRON_SECRET 或 service role>
 * Body 可選：{ "today": "YYYY-MM-DD" }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const cronHeader = req.headers.get("x-cron-secret") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    // Authorization 必須是 JWT（service_role）；純文字 CRON_SECRET 請放 x-cron-secret，否則閘道會 Invalid JWT
    const okService = !!(bearer && serviceKey && bearer === serviceKey);
    const okCron = !!(cronSecret && cronHeader && cronHeader === cronSecret);
    if (!okService && !okCron) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      serviceKey,
      { auth: { persistSession: false } }
    );

    let today: string | null = null;
    try {
      const body = await req.json();
      if (body && body.today) today = String(body.today);
    } catch (_e) {
      // no body
    }

    const { data: scanData, error: scanErr } = await supabase.rpc("scan_due_reminders", {
      p_today: today,
    });
    if (scanErr) throw scanErr;

    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL") || "LogOnEnglish <onboarding@resend.dev>";

    const { data: pending, error: pendingErr } = await supabase
      .from("user_notifications")
      .select("id, user_id, title, body, payload")
      .eq("email_status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);

    if (pendingErr) throw pendingErr;

    let emailSent = 0;
    let emailFailed = 0;
    let emailSkippedProvider = 0;

    if (!resendKey) {
      if (pending && pending.length) {
        const ids = pending.map((n: { id: string }) => n.id);
        await supabase
          .from("user_notifications")
          .update({ email_status: "skipped_no_provider" })
          .in("id", ids);
        emailSkippedProvider = ids.length;
      }
    } else if (pending && pending.length) {
      const userIds = [...new Set(pending.map((n: { user_id: string }) => n.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, name")
        .in("id", userIds);

      const emailById = new Map<string, { email: string; name: string }>();
      (profiles || []).forEach((p: { id: string; email: string; name: string }) => {
        if (p.email && String(p.email).indexOf("@") !== -1) {
          emailById.set(p.id, { email: p.email, name: p.name || "" });
        }
      });

      for (const note of pending) {
        const prof = emailById.get(note.user_id);
        if (!prof) {
          await supabase
            .from("user_notifications")
            .update({ email_status: "skipped_no_email" })
            .eq("id", note.id);
          continue;
        }

        const role = note.payload && note.payload.recipient_role === "parent" ? "家長" : "同學";
        const subject = `[LogOnEnglish] ${note.title}`;
        const text =
          `您好${prof.name ? " " + prof.name : ""}（${role}），\n\n` +
          note.body +
          `\n\n— LogOnEnglish 自動提醒`;

        try {
          const mailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [prof.email],
              subject,
              text,
            }),
          });
          if (!mailRes.ok) {
            const errText = await mailRes.text();
            await supabase
              .from("user_notifications")
              .update({ email_status: "failed", email_error: errText.slice(0, 500) })
              .eq("id", note.id);
            emailFailed += 1;
          } else {
            await supabase
              .from("user_notifications")
              .update({ email_status: "sent", email_error: null })
              .eq("id", note.id);
            emailSent += 1;
          }
        } catch (mailErr) {
          await supabase
            .from("user_notifications")
            .update({
              email_status: "failed",
              email_error: String(mailErr && mailErr.message ? mailErr.message : mailErr).slice(0, 500),
            })
            .eq("id", note.id);
          emailFailed += 1;
        }
      }
    }

    return new Response(
      JSON.stringify({
        status: "success",
        scan: scanData,
        email: {
          sent: emailSent,
          failed: emailFailed,
          skipped_no_provider: emailSkippedProvider,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// 📂 檔案路徑：supabase/functions/ai-grade-audio/index.ts
// 🌟 100% 完整無省略：Supabase Webhook 靜默觸發 + Drive OAuth + Gemini Schema + RPC 歷史溯源

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { importPKCS8, SignJWT } from "https://deno.land/x/jose@v4.14.4/index.ts";
import { encode } from "https://deno.land/std@0.192.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ==========================================
// 工具函式：純 Deno 環境安全的 Google Drive OAuth
// ==========================================
async function getGoogleAccessToken(serviceAccountJsonStr: string): Promise<string> {
  const credentials = JSON.parse(serviceAccountJsonStr);
  const privateKey = await importPKCS8(credentials.private_key, "RS256");
  
  const jwt = await new SignJWT({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Google Auth Failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

serve(async (req) => {
  // 處理 CORS 預檢
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let rawBodyText = "";
  try {
    rawBodyText = await req.text();
    const payload = JSON.parse(rawBodyText);
    
    // 💡 核心相容：接收 Webhook 傳來的 record
    const record = payload.type === 'INSERT' || payload.type === 'UPDATE' ? payload.record : payload;

    // 🛑 靜默防禦：如果狀態不是 ai_processing，直接跳出，避免無窮迴圈觸發
    if (!record || record.status !== "ai_processing") {
      return new Response(JSON.stringify({ message: "Skipped: Status is not ai_processing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const completionId = record.id;
    const taskId = record.task_id;
    
    // 從欄位或 raw_data 中提煉音檔網址
    const audioUrl = record.audio_url || (record.raw_data && record.raw_data.audio_url);
    if (!audioUrl) throw new Error("Missing audio_url in the record");

    // 1. 初始化 Supabase Service Role Client (繞過 RLS 強制讀寫)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 2. 往上溯源：讀取 Task 主檔中的 original_script 與設定
    const { data: taskData, error: taskError } = await supabase
      .from("tasks")
      .select("raw_data")
      .eq("id", taskId)
      .is("deleted_at", null)
      .single();

    if (taskError) throw new Error(`Supabase Task Fetch Error: ${taskError.message}`);

    const taskRawData = taskData?.raw_data || {};
    const originalScript = taskRawData.original_script || "";
    const useAiGrading = taskRawData.use_ai_grading !== false; // 預設為 true
    const useAiGrammar = taskRawData.use_ai_grammar === true; // 預設為 false
    const preferences = taskRawData.preferences || {};

    // 若老師關閉 AI，直接標記為 submitted 並結束
    if (!useAiGrading) {
      await supabase.from("task_completions").update({ status: "submitted" }).eq("id", completionId);
      return new Response(JSON.stringify({ message: "Skipped: AI grading disabled for this task" }), { headers: corsHeaders, status: 200 });
    }

    // 3. 解析 Google Drive File ID (支援直接 ID 或完整 URL)
    let fileDriveId = audioUrl;
    if (audioUrl.includes("/")) {
        const idMatch = audioUrl.match(/\/(?:d|folders|file\/d)\/([a-zA-Z0-9_-]+)/) || audioUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (idMatch && idMatch[1]) fileDriveId = idMatch[1];
    }

    // 4. 獲取 Google 授權 (jose 突破 403)
    const serviceAccountJsonStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJsonStr) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON in secrets");
    const driveAccessToken = await getGoogleAccessToken(serviceAccountJsonStr);

    // 下載音檔並轉 Base64
    const driveFileUrl = `https://www.googleapis.com/drive/v3/files/${fileDriveId}?alt=media`;
    const driveResponse = await fetch(driveFileUrl, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    if (!driveResponse.ok) throw new Error(`Failed to fetch audio. Status: ${driveResponse.status}`);
    
    const arrayBuffer = await driveResponse.arrayBuffer();
    const audioBase64 = encode(new Uint8Array(arrayBuffer));

    // 5. 建構 Gemini Prompt 與神經元約束合約
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) throw new Error("Missing GEMINI_API_KEY in secrets");

    const accent = preferences.accent || "American English";
    const phoneticFormat = preferences.phonetic_format || "KK";
    const scriptInstruction = originalScript 
      ? `Here is the golden anchor script the student MUST read: "${originalScript}". Your grading MUST heavily rely on comparing their speech to this exact script.`
      : `No original script was provided. You must first transcribe the audio and evaluate based on natural conversation and general coherence.`;

    const grammarInstruction = useAiGrammar 
      ? `Additionally, analyze any grammatical mistakes and provide structured corrections.`
      : `Ignore grammatical corrections. Output an empty array for grammar_corrections.`;

    const systemPrompt = `
      You are an expert ${accent} language teacher. Analyze the provided student audio recording.
      ${scriptInstruction}
      ${grammarInstruction}

      IRON RULES FOR SCORING:
      1. Pronunciation Score: Calculate exactly as (100 - total number of distinct word errors). If there are 5 errors, the score is 95.
      2. Fluency Score: You MUST choose ONLY one of these exact values: 90 (Native-like), 80 (Clear, no meaning lost), 70 (Minor interference), 60 (Meaning confused/broken).
      3. Word Errors: Provide the exact misspelled or mispronounced word, the correct phonetic symbol in ${phoneticFormat} format, and a brief tip.
    `;

    // 呼叫 Gemini 1.5 Flash API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { inline_data: { mime_type: "audio/webm", data: audioBase64 } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              pronunciation_score: { type: "INTEGER" },
              fluency_score: { type: "INTEGER" },
              comprehensive_feedback: { type: "STRING" },
              word_errors: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    word: { type: "STRING" },
                    phonetic: { type: "STRING" },
                    tip: { type: "STRING" }
                  },
                  required: ["word", "phonetic", "tip"]
                }
              },
              grammar_corrections: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    original: { type: "STRING" },
                    correction: { type: "STRING" },
                    explanation: { type: "STRING" }
                  },
                  required: ["original", "correction", "explanation"]
                }
              }
            },
            required: ["pronunciation_score", "fluency_score", "comprehensive_feedback", "word_errors", "grammar_corrections"]
          }
        }
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      throw new Error(`Gemini API Error: ${errText}`);
    }

    const geminiData = await geminiResponse.json();
    const rawAiResultText = geminiData.candidates[0].content.parts[0].text;
    const aiEvaluation = JSON.parse(rawAiResultText); // 絕對純淨 JSON

    // 6. 寫回 Supabase (軟刪除與 JSONB 陣列溯源)
    const currentRawData = record.raw_data || {};
    const oldEvaluation = currentRawData.ai_evaluation || null;
    const gradingHistory = currentRawData.grading_history || [];

    if (oldEvaluation) {
      gradingHistory.push({
        ...oldEvaluation,
        archived_at: new Date().toISOString()
      });
    }

    const updatedRawData = {
      ...currentRawData,
      ai_evaluation: aiEvaluation,
      grading_history: gradingHistory
    };

    const { error: updateError } = await supabase
      .from("task_completions")
      .update({ 
        raw_data: updatedRawData,
        status: "graded" // 💡 神奇魔法：狀態變成 graded，前端 Gradebook 直接亮起紅黑字！
      })
      .eq("id", completionId);

    if (updateError) throw new Error(`Supabase Update Error: ${updateError.message}`);

    return new Response(JSON.stringify({ success: true, message: "AI evaluation completed" }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200 
    });

  } catch (error: any) {
    console.error("AI Grading Error:", error.message);
    
    // 💡 錯誤處理防呆：若出錯，自動將狀態改為 ai_failed，讓老師前端知道發生了意外
    try {
      if (rawBodyText) {
          const payload = JSON.parse(rawBodyText);
          const record = payload.type === 'INSERT' || payload.type === 'UPDATE' ? payload.record : payload;
          if (record && record.id) {
              const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
              const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
              const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
              await supabase.from("task_completions").update({
                  status: "ai_failed",
                  raw_data: { ...(record.raw_data || {}), ai_error_log: error.message }
              }).eq("id", record.id);
          }
      }
    } catch (fallbackError) {
      console.error("Critical fallback failed:", fallbackError);
    }

    return new Response(JSON.stringify({ success: false, error: error.message }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500 
    });
  }
});
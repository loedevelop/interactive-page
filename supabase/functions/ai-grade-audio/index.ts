// 📂 檔案：supabase/functions/ai-grade-audio/index.ts
// 🌟 100% 完整無省略：結合前端 Direct Payload + Deno 安全 JWT Auth + 歷史溯源陣列推入

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { completion_id, file_drive_id, original_script, preferences, use_ai_grammar } = payload;

    if (!completion_id || !file_drive_id) {
      throw new Error("Missing required parameters: completion_id or file_drive_id");
    }

    // 1. 初始化 Supabase Service Role Client (繞過 RLS 強制寫入)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 2. 獲取 Google 授權 (使用 jose 確保 Deno 環境不崩潰)
    const serviceAccountJsonStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJsonStr) {
      throw new Error("Server configuration error: Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }
    const driveAccessToken = await getGoogleAccessToken(serviceAccountJsonStr);

    // 3. 下載 Google Drive 音檔並轉為 Base64
    const driveFileUrl = `https://www.googleapis.com/drive/v3/files/${file_drive_id}?alt=media`;
    const driveResponse = await fetch(driveFileUrl, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });

    if (!driveResponse.ok) {
      throw new Error(`Failed to fetch audio from Drive. Status: ${driveResponse.status}`);
    }

    const arrayBuffer = await driveResponse.arrayBuffer();
    const audioBase64 = encode(new Uint8Array(arrayBuffer));

    // 4. 建構 Gemini Prompt (保留你的動態對齊鐵律)
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      throw new Error("Server configuration error: Missing GEMINI_API_KEY");
    }

    const accent = preferences?.accent || "American English";
    const phoneticFormat = preferences?.phonetic_format || "KK";
    const scriptInstruction = original_script 
      ? `Here is the golden anchor script the student MUST read: "${original_script}". Your grading MUST heavily rely on comparing their speech to this exact script.`
      : `No original script was provided. You must first transcribe the audio and evaluate based on natural conversation and general coherence.`;

    const grammarInstruction = use_ai_grammar 
      ? `Additionally, analyze any grammatical mistakes and provide structured corrections.`
      : `Ignore grammatical corrections.`;

    const systemPrompt = `
      You are an expert ${accent} language teacher. Analyze the provided student audio recording.
      ${scriptInstruction}${grammarInstruction}

      IRON RULES FOR SCORING:
      1. Pronunciation Score: Calculate exactly as (100 - total number of distinct word errors). If there are 5 errors, the score is 95.
      2. Fluency Score: You MUST choose ONLY one of these exact values: 90 (Native-like), 80 (Clear, no meaning lost), 70 (Minor interference), 60 (Meaning confused/broken).
      3. Word Errors: Provide the exact misspelled or mispronounced word, the correct phonetic symbol in ${phoneticFormat} format, and a brief tip.
    `;

    // 5. 呼叫 Gemini API (強制降級為 flash 確保 Edge Function 不會 Timeout)
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
    const aiEvaluation = JSON.parse(rawAiResultText);

    // 6. 寫回 Supabase (保留你的完美 JSONB 歷史溯源陣列推入)
    const { data: existingRecord, error: fetchError } = await supabase
      .from("task_completions")
      .select("raw_data")
      .eq("id", completion_id)
      .is("deleted_at", null)
      .single();

    if (fetchError) throw new Error(`Supabase Fetch Error: ${fetchError.message}`);

    const currentRawData = existingRecord?.raw_data || {};
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
        status: "graded" 
      })
      .eq("id", completion_id);

    if (updateError) throw new Error(`Supabase Update Error: ${updateError.message}`);

    // 7. 成功回應
    return new Response(JSON.stringify({
      success: true,
      message: "Audio graded successfully",
      evaluation: aiEvaluation
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200 
    });

  } catch (error: any) {
    console.error("AI Grading Error:", error.message);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500 
    });
  }
});
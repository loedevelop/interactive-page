// 📂 檔案：supabase/functions/ai-grade-audio/index.ts
// 🌟 100% 完整無省略：Google Drive OAuth + Gemini Multimodal + Supabase Service Role

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { GoogleAuth } from "https://esm.sh/google-auth-library@9.6.3";

// 定義 CORS 標頭，允許前端直呼或 Webhook 觸發
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 1. 處理 CORS 預檢請求
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { completion_id, file_drive_id, original_script, preferences, use_ai_grammar } = payload;

    if (!completion_id || !file_drive_id) {
      throw new Error("Missing required parameters: completion_id or file_drive_id");
    }

    // 2. 初始化 Supabase Service Role Client (繞過 RLS 強制寫入)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 3. 讀取 Google Service Account JSON 並取得授權 Token
    const serviceAccountJsonStr = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJsonStr) {
      throw new Error("Server configuration error: Missing GOOGLE_SERVICE_ACCOUNT_JSON");
    }
    
    const credentials = JSON.parse(serviceAccountJsonStr);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    const driveClient = await auth.getClient();
    const { token: driveAccessToken } = await driveClient.getAccessToken();

    // 4. 下載 Google Drive 音檔並轉為 Base64
    const driveFileUrl = `https://www.googleapis.com/drive/v3/files/${file_drive_id}?alt=media`;
    const driveResponse = await fetch(driveFileUrl, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });

    if (!driveResponse.ok) {
      throw new Error(`Failed to fetch audio from Drive. Status: ${driveResponse.status}`);
    }

    const arrayBuffer = await driveResponse.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // 將 Uint8Array 轉為 Base64 (Deno 寫法)
    let binaryString = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const audioBase64 = btoa(binaryString);

    // 5. 建構 Gemini Prompt (動態對齊鐵律)
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

      You must return ONLY a valid JSON object strictly matching this schema:
      {
        "pronunciation_score": number,
        "fluency_score": number,
        "comprehensive_feedback": "string (Overall positive and constructive feedback)",
        "word_errors": [
          { "word": "string", "phonetic": "string", "tip": "string" }
        ],
        "grammar_corrections": [
          { "original": "string", "correction": "string", "explanation": "string" }
        ]
      }
    `;

    // 6. 呼叫 Gemini 1.5 Pro API (強制要求 JSON 回傳)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${geminiApiKey}`;
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
          response_mime_type: "application/json",
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

    // 7. 寫回 Supabase (軟刪除與 JSONB 擴充鐵律)
    // 取得舊資料以確保 grading_history 不被覆蓋
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

    // 8. 成功回應
    return new Response(JSON.stringify({
      success: true,
      message: "Audio graded successfully",
      evaluation: aiEvaluation
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200 
    });

  } catch (error) {
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
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let recordId: string | null = null;
  let currentRawData: any = {};
  let supabase: any = null;

  try {
    const payload = await req.json();

    if (payload.type !== "UPDATE" && payload.type !== "INSERT") {
      return new Response(JSON.stringify({ message: "Ignored event type." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const record = payload.record;
    if (!record || record.status !== 'ai_processing') {
      return new Response(JSON.stringify({ message: "Bypassed: Status is not ai_processing." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    recordId = record.id;
    currentRawData = record.raw_data || {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
      throw new Error("Critical Error: Missing environment variables in Secrets Vault.");
    }

    supabase = createClient(supabaseUrl, supabaseKey);

    const { data: assignmentData, error: assignmentError } = await supabase
      .from('assignments')
      .select('raw_data, tasks')
      .eq('id', record.assignment_id)
      .is('deleted_at', null)
      .single();

    if (assignmentError || !assignmentData) {
      throw new Error(`Assignment Retrieval Failed: ${assignmentError?.message}`);
    }

    const assignmentRaw = assignmentData.raw_data || {};
    let assignmentTasks = assignmentData.tasks || [];
    
    if (typeof assignmentTasks === 'string') {
      try { assignmentTasks = JSON.parse(assignmentTasks); } catch (e) { assignmentTasks = []; }
    }

    let originalScript = "";
    let useAiGrading = true;
    let useAiGrammar = false;

    if (Array.isArray(assignmentTasks) && assignmentTasks.length > 0) {
      let foundTask: any = null;
      const findTaskRecursive = (taskList: any[]) => {
        if (!taskList) return;
        for (const t of taskList) {
          if (String(t.id) === String(record.task_id)) {
            foundTask = t;
            return;
          }
          if (t.type === 'group' && Array.isArray(t.subTasks)) {
            findTaskRecursive(t.subTasks);
          }
        }
      };
      findTaskRecursive(assignmentTasks);

      if (foundTask) {
        originalScript = foundTask.original_script || (foundTask.raw_data && foundTask.raw_data.original_script) || "";
        useAiGrading = foundTask.use_ai_grading !== false && (!foundTask.raw_data || foundTask.raw_data.use_ai_grading !== false);
        useAiGrammar = foundTask.use_ai_grammar === true || (foundTask.raw_data && foundTask.raw_data.use_ai_grammar === true);
      }
    } 
    
    if (!originalScript) {
      originalScript = assignmentRaw.original_script || "";
    }

    if (!useAiGrading) {
      await supabase.from('task_completions').update({ status: 'submitted' }).eq('id', record.id);
      return new Response(JSON.stringify({ message: "AI Grading is disabled for this task." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!originalScript || originalScript.trim() === "") {
      throw new Error("Fatal: original_script is missing in assignment tasks.");
    }

    const driveUrl = currentRawData.student_audio_url || record.audio_url || currentRawData.audio_url;
    if (!driveUrl) {
      throw new Error("Fatal: audio_url or student_audio_url is missing.");
    }

    const fileIdMatch = driveUrl.match(/\/(?:d|folders|file\/d)\/([a-zA-Z0-9_-]+)/) || driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (!fileIdMatch || !fileIdMatch[1]) {
      throw new Error(`Invalid Google Drive URL format: ${driveUrl}`);
    }
    const fileId = fileIdMatch[1];
    
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) {
      throw new Error(`Audio Download Failed. HTTP ${audioRes.status}. Ensure file is ANYONE_WITH_LINK.`);
    }

    const audioBuffer = await audioRes.arrayBuffer();
    
    if (audioBuffer.byteLength < 50000) {
      const textCheck = new TextDecoder().decode(audioBuffer.slice(0, 500)).toLowerCase();
      if (textCheck.includes('<!doctype html') || textCheck.includes('<html')) {
        throw new Error(`Drive Download blocked. Google Drive returned an HTML page instead of an audio file. File ID: ${fileId}`);
      }
    }

    const audioBase64 = encodeBase64(new Uint8Array(audioBuffer));

    // 🚀 架構師核心修復：全面拔除 1.5 硬編碼，讓 Google API 自己決定最好的 flash 模型！
    const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`;
    const listRes = await fetch(listModelsUrl);
    
    if (!listRes.ok) {
      throw new Error(`Failed to list Gemini models: ${await listRes.text()}`);
    }
    
    const listData = await listRes.json();
    const availableModels = listData.models || [];
    
    // 找出所有支援 generateContent 且名稱帶有 flash 的模型 (不再限制 1.5)
    const validModels = availableModels.filter((m: any) => 
      m.supportedGenerationMethods?.includes('generateContent') && 
      m.name.includes('flash')
    );

    if (validModels.length === 0) {
      throw new Error(`Critical Error: No flash models are available for your API Key.`);
    }

    // 取得最新可用的 flash 模型 (優先找完整名稱的正式版)
    let targetModel = validModels.find((m: any) => m.name.match(/gemini-[0-9.]+-flash$/))
                   || validModels[0];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${geminiApiKey}`;

    const promptText = `
You are an expert English pronunciation and grammar evaluator.
Analyze the student's audio recording strictly against the Standard Script below.

Standard Script:
"${originalScript}"

Tasks:
1. Fluency Score: Use the 4-level scale (95: Native-like, 85: Clear, 75: Interference, 55: Broken).
2. Comprehensive Feedback: Provide encouraging, specific feedback in Traditional Chinese.
3. Word Errors: Identify EVERY mispronounced, distorted, inserted, or omitted word. Mark completely skipped words as 'omission'.
${useAiGrammar ? "4. Grammar Analysis: Note grammatical errors in ad-lib speech in Traditional Chinese." : ""}

Respond strictly in JSON matching the specified schema.
`;

    const requestBody = {
      contents: [{
        role: "user",
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: "audio/webm",
              data: audioBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1, 
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            fluency_score: { type: "INTEGER", description: "Strictly 95, 85, 75, or 55." },
            comprehensive_feedback: { type: "STRING", description: "Feedback in Traditional Chinese." },
            word_errors: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  word: { type: "STRING", description: "Target word from script" },
                  error_type: { type: "STRING", description: "omission, insertion, or mispronunciation" },
                  expected_phonetic: { type: "STRING", description: "Correct IPA" },
                  student_pronunciation: { type: "STRING", description: "What the student said" }
                },
                required: ["word", "error_type", "expected_phonetic", "student_pronunciation"]
              }
            },
            grammar_analysis: { type: "STRING" }
          },
          required: ["fluency_score", "comprehensive_feedback", "word_errors"]
        }
      }
    };

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API Error: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error("Empty structural response from Gemini API.");
    }

    const aiEvaluation = JSON.parse(aiText);

    const errorCount = aiEvaluation.word_errors?.length || 0;
    aiEvaluation.pronunciation_score = Math.max(0, 100 - errorCount);

    const gradingHistory = currentRawData.grading_history || [];
    if (currentRawData.ai_evaluation) {
      gradingHistory.push({
        timestamp: new Date().toISOString(),
        ai_evaluation: currentRawData.ai_evaluation,
        teacher_score: currentRawData.teacher_score, 
        ta_score: currentRawData.ta_score
      });
    }

    const updatedRawData = {
      ...currentRawData,
      ai_evaluation: aiEvaluation,
      grading_history: gradingHistory,
      graded_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('task_completions')
      .update({
        status: 'graded', 
        raw_data: updatedRawData
      })
      .eq('id', recordId);

    if (updateError) {
      throw new Error(`Database Commit Failed: ${updateError.message}`);
    }

    const targetUserId = record.student_id || record.user_id;

    if (targetUserId && errorCount > 0) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('raw_data')
        .eq('id', targetUserId)
        .is('deleted_at', null)
        .single();
      
      if (profileData) {
        const profileRaw = profileData.raw_data || {};
        const defectVocab = profileRaw.defect_vocab || {};
        
        aiEvaluation.word_errors.forEach((err: any) => {
          const w = err.word.toLowerCase().replace(/[^a-z']/g, ""); 
          if (!w) return;
          if (!defectVocab[w]) {
            defectVocab[w] = { count: 0, latest_ipa: err.expected_phonetic };
          }
          defectVocab[w].count += 1;
          defectVocab[w].last_mistake = err.student_pronunciation;
        });
        
        profileRaw.defect_vocab = defectVocab;
        supabase.from('profiles').update({ raw_data: profileRaw }).eq('id', targetUserId).then();
      }
    }

    return new Response(JSON.stringify({ success: true, ai_evaluation: aiEvaluation }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error(`AI Pipeline Error: ${error.message}`);
    
    // 🚨 即使失敗，也要利用 Service Role 寫回 ai_error 狀態與 Log！
    if (recordId && supabase) {
      try {
        await supabase.from('task_completions').update({
          status: 'ai_error',
          raw_data: {
            ...currentRawData,
            ai_error_log: error.message,
            failed_at: new Date().toISOString()
          }
        }).eq('id', recordId);
      } catch (e) {
        console.error("Failed to rollback state.", e);
      }
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 200, 
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GradingPolicy = {
  configured: boolean;
  final_authority: "ai_auto" | "human_confirm";
  override_roles: string[];
  publish_roles: string[];
  speech_engine: string;
  accent: string;
  phonetic_format: string;
};

const DEFAULT_POLICY: GradingPolicy = {
  configured: false,
  final_authority: "human_confirm",
  override_roles: ["primary_teacher", "co_teacher", "ta_senior", "ta_junior"],
  publish_roles: ["primary_teacher", "co_teacher", "ta_senior"],
  speech_engine: "speechace",
  accent: "en-us",
  phonetic_format: "kk",
};

function parseGradingPolicy(rawData: any): GradingPolicy {
  const gp = rawData?.grading_policy;
  if (!gp || typeof gp !== "object") {
    return { ...DEFAULT_POLICY };
  }
  const policy = { ...DEFAULT_POLICY, configured: gp.configured === true };
  if (gp.final_authority === "ai_auto" || gp.final_authority === "human_confirm") {
    policy.final_authority = gp.final_authority;
  }
  if (Array.isArray(gp.override_roles)) policy.override_roles = gp.override_roles;
  if (Array.isArray(gp.publish_roles)) policy.publish_roles = gp.publish_roles;
  if (gp.accent) policy.accent = String(gp.accent);
  if (gp.phonetic_format) policy.phonetic_format = String(gp.phonetic_format);
  if (gp.speech_engine) policy.speech_engine = String(gp.speech_engine);
  return policy;
}

function resolveEffectiveScript(fullScript: string, materialRange: string): { text: string; note: string } {
  const full = (fullScript || "").trim();
  const range = (materialRange || "").trim();
  if (!full) return { text: "", note: "empty_script" };
  if (!range) return { text: full, note: "full_script" };

  const sentenceRange = range.match(/(\d+)\s*[-~～至到]\s*(\d+)/);
  if (sentenceRange) {
    const sentences = full.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    const start = Math.max(0, parseInt(sentenceRange[1], 10) - 1);
    const end = parseInt(sentenceRange[2], 10);
    const slice = sentences.slice(start, end);
    if (slice.length > 0) {
      return { text: slice.join(" ").trim(), note: `sentence_range_${start + 1}_${end}` };
    }
  }

  const paraMatch = range.match(/(?:paragraph|段|段落)\s*(\d+)/i);
  if (paraMatch) {
    const paragraphs = full.split(/\n\s*\n/).filter((p) => p.trim());
    const idx = parseInt(paraMatch[1], 10) - 1;
    if (paragraphs[idx]) {
      return { text: paragraphs[idx].trim(), note: `paragraph_${idx + 1}` };
    }
  }

  return { text: full, note: "range_fallback_full" };
}

function extractDriveFileId(driveUrl: string): string | null {
  const match =
    driveUrl.match(/\/(?:d|folders|file\/d)\/([a-zA-Z0-9_-]+)/) ||
    driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match?.[1] || null;
}

function scoreScriptLink(linkTask: any): number {
  if (!linkTask || linkTask.type !== "link") return -1;
  const hay = `${linkTask.title || ""} ${linkTask.url_text || ""}`.toLowerCase();
  if (/audio|文稿|script|reading|朗讀/.test(hay)) return 10;
  return 1;
}

function findSiblingScriptLink(assignmentTasks: any[], targetTaskId: string): any | null {
  let result: any | null = null;

  function search(list: any[], parentGroup: any | null): boolean {
    if (!Array.isArray(list)) return false;
    for (const t of list) {
      if (String(t.id) === String(targetTaskId)) {
        const siblings = parentGroup?.subTasks || list;
        const links = siblings.filter((s: any) => s?.type === "link" && s.url && String(s.url).trim());
        links.sort((a: any, b: any) => scoreScriptLink(b) - scoreScriptLink(a));
        result = links[0] || null;
        return true;
      }
      if (t.type === "group" && Array.isArray(t.subTasks) && search(t.subTasks, t)) {
        return true;
      }
    }
    return false;
  }

  search(assignmentTasks, null);
  return result;
}

async function downloadAudioFromDrive(fileId: string): Promise<Uint8Array> {
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
  const audioRes = await fetch(downloadUrl);
  if (!audioRes.ok) {
    throw new Error(`Audio Download Failed. HTTP ${audioRes.status}. Ensure file is ANYONE_WITH_LINK.`);
  }
  const audioBuffer = await audioRes.arrayBuffer();
  if (audioBuffer.byteLength < 50000) {
    const textCheck = new TextDecoder().decode(audioBuffer.slice(0, 500)).toLowerCase();
    if (textCheck.includes("<!doctype html") || textCheck.includes("<html")) {
      throw new Error(`Drive Download blocked for file ${fileId}.`);
    }
  }
  return new Uint8Array(audioBuffer);
}

function speechaceDialect(accent: string): string {
  const a = (accent || "en-us").toLowerCase();
  if (a.indexOf("gb") > -1 || a.indexOf("brit") > -1 || a.indexOf("uk") > -1) {
    return "en-gb";
  }
  return "en-us";
}

async function gradeWithSpeechace(
  audioBytes: Uint8Array,
  referenceText: string,
  accent: string,
  apiKey: string,
): Promise<any> {
  const formData = new FormData();
  formData.append("text", referenceText);
  formData.append(
    "user_audio_file",
    new Blob([audioBytes], { type: "audio/wav" }),
    "student_audio.wav",
  );

  const dialect = speechaceDialect(accent);
  const url =
    `https://api.speechace.co/api/scoring/speech/v9/json?key=${encodeURIComponent(apiKey)}&dialect=${dialect}&user_id=logon_web`;

  const res = await fetch(url, { method: "POST", body: formData });
  const json = await res.json();

  if (!res.ok || json.status === "error") {
    const msg = json.short_message || json.detail_message || JSON.stringify(json);
    throw new Error(`Speechace Error: ${msg}`);
  }

  return json;
}

function mapSpeechaceToEvaluation(speechaceResult: any, phoneticFormat: string): any {
  // v9 API returns speech_score; older responses used text_score
  const scoreBlock = speechaceResult.speech_score || speechaceResult.text_score || {};
  const speechaceScore = scoreBlock.speechace_score || {};
  const wordList = scoreBlock.word_score_list || [];

  const pronunciationScore = Math.round(
    speechaceScore.pronunciation ??
      speechaceScore.quality ??
      scoreBlock.quality_score ??
      0,
  );
  const fluencyScore = Math.round(
    speechaceScore.fluency ?? scoreBlock.fluency_score ?? 0,
  );
  const completenessScore = Math.round(
    speechaceScore.completeness ?? scoreBlock.completeness_score ?? 100,
  );

  const wordErrors: any[] = [];
  wordList.forEach((w: any) => {
    const quality = w.quality_score ?? 100;
    if (quality >= 80) return;

    let errorType = "mispronunciation";
    if (w.quality_class === "omission") errorType = "omission";

    let expectedPhonetic = "";
    if (Array.isArray(w.phone_score_list)) {
      const phones = w.phone_score_list
        .map((p: any) => p.phone ?? p.ipa ?? "")
        .filter(Boolean)
        .join("");
      expectedPhonetic = phones ? `/${phones}/` : "";
    }

    let startTime = Number(w.start_time ?? 0);
    let endTime = Number(w.end_time ?? 0);
    if (Array.isArray(w.phone_score_list) && w.phone_score_list.length > 0) {
      let minExtent = Infinity;
      let maxExtent = -Infinity;
      for (const p of w.phone_score_list) {
        if (!Array.isArray(p.extent) || p.extent.length < 2) continue;
        minExtent = Math.min(minExtent, Number(p.extent[0]));
        maxExtent = Math.max(maxExtent, Number(p.extent[1]));
      }
      if (Number.isFinite(minExtent) && Number.isFinite(maxExtent)) {
        startTime = minExtent / 100;
        endTime = maxExtent / 100;
      }
    }
    if (endTime <= startTime) endTime = startTime + 1.5;

    wordErrors.push({
      word: w.word || "",
      error_type: errorType,
      expected_phonetic: expectedPhonetic,
      student_pronunciation: w.extended_word_score ? String(w.extended_word_score) : "[需覆核]",
      start_time: startTime,
      end_time: endTime,
    });
  });

  const missingSections: string[] = [];
  if (completenessScore < 85) {
    missingSections.push("偵測到可能未完整念完指定範圍，請確認是否有漏段或提早結束。");
  }

  return {
    pronunciation_score: pronunciationScore,
    fluency_score: fluencyScore,
    completeness_score: completenessScore,
    word_errors: wordErrors,
    missing_sections: missingSections,
    phonetic_format: phoneticFormat,
    grading_provider: "speechace",
    provider_label: "Speechace 語音引擎",
    provider_raw: speechaceResult,
  };
}

async function gradeWithGeminiFallback(
  audioBase64: string,
  referenceText: string,
  geminiApiKey: string,
  useAiGrammar: boolean,
): Promise<any> {
  const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`;
  const listRes = await fetch(listModelsUrl);
  if (!listRes.ok) throw new Error(`Failed to list Gemini models: ${await listRes.text()}`);

  const listData = await listRes.json();
  const availableModels = listData.models || [];
  const validModels = availableModels.filter(
    (m: any) => m.supportedGenerationMethods?.includes("generateContent") && m.name.includes("flash"),
  );
  if (validModels.length === 0) throw new Error("No flash models available for Gemini fallback.");

  let targetModel =
    validModels.find((m: any) => m.name.match(/gemini-[0-9.]+-flash$/)) || validModels[0];
  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${geminiApiKey}`;

  const promptText = `
You are an expert English pronunciation evaluator.
Analyze the student audio strictly against this Standard Script:
"${referenceText}"

Tasks:
1. Check completeness against the entire script.
2. Fluency score must be one of: 95, 85, 75, 55.
3. List word errors with start_time and end_time in seconds.
${useAiGrammar ? "4. Note grammar issues in Traditional Chinese in grammar_analysis field." : ""}

Respond strictly in JSON matching the schema.
`;

  const requestBody = {
    contents: [{
      role: "user",
      parts: [
        { text: promptText },
        { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          fluency_score: { type: "INTEGER" },
          comprehensive_feedback: { type: "STRING" },
          completeness_score: { type: "INTEGER" },
          missing_sections: { type: "ARRAY", items: { type: "STRING" } },
          word_errors: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                word: { type: "STRING" },
                error_type: { type: "STRING" },
                expected_phonetic: { type: "STRING" },
                student_pronunciation: { type: "STRING" },
                start_time: { type: "NUMBER" },
                end_time: { type: "NUMBER" },
              },
              required: ["word", "error_type", "start_time", "end_time"],
            },
          },
          grammar_analysis: { type: "STRING" },
        },
        required: ["fluency_score", "word_errors"],
      },
    },
  };

  const geminiRes = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!geminiRes.ok) throw new Error(`Gemini fallback error: ${await geminiRes.text()}`);

  const geminiData = await geminiRes.json();
  const aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!aiText) throw new Error("Empty Gemini fallback response.");

  const parsed = JSON.parse(aiText);
  const errorCount = parsed.word_errors?.length || 0;
  parsed.pronunciation_score = Math.max(0, 100 - errorCount);
  parsed.grading_provider = "gemini_fallback";
  parsed.provider_label = "⚠️ 非首選引擎（Gemini）評分，建議人工覆核";
  return parsed;
}

async function generateGeminiFeedback(
  aiEvaluation: any,
  geminiApiKey: string,
): Promise<string> {
  const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`;
  const listRes = await fetch(listModelsUrl);
  if (!listRes.ok) return "AI 已完成語音分析，請參考上方分數與錯字列表。";

  const listData = await listRes.json();
  const models = (listData.models || []).filter(
    (m: any) => m.supportedGenerationMethods?.includes("generateContent") && m.name.includes("flash"),
  );
  if (models.length === 0) return "AI 已完成語音分析，請參考上方分數與錯字列表。";

  const targetModel = models.find((m: any) => m.name.match(/gemini-[0-9.]+-flash$/)) || models[0];
  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${geminiApiKey}`;

  const summary = {
    pronunciation_score: aiEvaluation.pronunciation_score,
    fluency_score: aiEvaluation.fluency_score,
    completeness_score: aiEvaluation.completeness_score,
    missing_sections: aiEvaluation.missing_sections || [],
    word_errors: (aiEvaluation.word_errors || []).slice(0, 12).map((e: any) => ({
      word: e.word,
      error_type: e.error_type,
    })),
    provider: aiEvaluation.grading_provider,
  };

  const prompt = `
你是英文口說課程的台灣老師。請根據以下 AI 語音評分 JSON，寫一段 80-120 字的繁體中文綜合評語。
要求：鼓勵為主、具體指出 1-2 個需加強處；若 completeness 低或有 missing_sections，必須提醒是否少錄或漏念。
禁止捏造 JSON 中不存在的錯字。只輸出評語文字，不要 JSON。

JSON:
${JSON.stringify(summary)}
`;

  const res = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    }),
  });

  if (!res.ok) return "AI 已完成語音分析，請參考上方分數與錯字列表。";
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? String(text).trim() : "AI 已完成語音分析，請參考上方分數與錯字列表。";
}

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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const record = payload.record;
    if (!record || record.status !== "ai_processing") {
      return new Response(JSON.stringify({ message: "Bypassed: Status is not ai_processing." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    recordId = record.id;
    currentRawData = record.raw_data || {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const speechaceApiKey = Deno.env.get("SPEECHACE_API_KEY");

    if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
      throw new Error("Critical Error: Missing environment variables in Secrets Vault.");
    }

    supabase = createClient(supabaseUrl, supabaseKey);

    const { data: classData } = await supabase
      .from("classes")
      .select("raw_data")
      .eq("id", record.class_id)
      .is("deleted_at", null)
      .maybeSingle();

    let classRaw = classData?.raw_data || {};
    if (typeof classRaw === "string") {
      try { classRaw = JSON.parse(classRaw); } catch (_e) { classRaw = {}; }
    }
    const gradingPolicy = parseGradingPolicy(classRaw);

    const { data: assignmentData, error: assignmentError } = await supabase
      .from("assignments")
      .select("raw_data, tasks")
      .eq("id", record.assignment_id)
      .is("deleted_at", null)
      .single();

    if (assignmentError || !assignmentData) {
      throw new Error(`Assignment Retrieval Failed: ${assignmentError?.message}`);
    }

    const assignmentRaw = assignmentData.raw_data || {};
    let assignmentTasks = assignmentData.tasks || [];
    if (typeof assignmentTasks === "string") {
      try { assignmentTasks = JSON.parse(assignmentTasks); } catch (_e) { assignmentTasks = []; }
    }

    let originalScript = "";
    let materialRange = "";
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
          if (t.type === "group" && Array.isArray(t.subTasks)) {
            findTaskRecursive(t.subTasks);
          }
        }
      };
      findTaskRecursive(assignmentTasks);

      if (foundTask) {
        originalScript =
          foundTask.original_script ||
          (foundTask.raw_data && foundTask.raw_data.original_script) ||
          "";
        materialRange =
          (foundTask.raw_data && foundTask.raw_data.material_range) ||
          foundTask.material_range ||
          "";
        useAiGrading =
          foundTask.use_ai_grading !== false &&
          (!foundTask.raw_data || foundTask.raw_data.use_ai_grading !== false);
        useAiGrammar =
          foundTask.use_ai_grammar === true ||
          (foundTask.raw_data && foundTask.raw_data.use_ai_grammar === true);

        if (!originalScript) {
          const siblingLink = findSiblingScriptLink(assignmentTasks, record.task_id);
          if (siblingLink?.url) {
            const linkUrl = String(siblingLink.url).trim();
            // 僅接受「非 URL 的純文稿」貼在連結欄；http(s) 連結不當作文稿內容
            if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
              originalScript = linkUrl;
            }
          }
        }

        // 有可用文稿才開 AI；禁止「僅因有 sibling link」就強制送 AI
        if (!String(originalScript || "").trim()) {
          useAiGrading = false;
        } else if (
          foundTask.use_ai_grading !== false &&
          (!foundTask.raw_data || foundTask.raw_data.use_ai_grading !== false)
        ) {
          useAiGrading = true;
        }
      }
    }

    if (!originalScript) {
      originalScript = assignmentRaw.original_script || "";
    }

    const scriptResolved = resolveEffectiveScript(originalScript, materialRange);
    const effectiveScript = scriptResolved.text;

    // 無文稿或關閉 AI：只視為已繳交，禁止丟 Fatal / ai_error（上傳仍有效）
    if (!useAiGrading || !effectiveScript) {
      const skipRaw = {
        ...currentRawData,
        ai_skip_reason: !useAiGrading
          ? "use_ai_grading_disabled"
          : "original_script_missing",
        ai_skipped_at: new Date().toISOString(),
      };
      delete (skipRaw as any).ai_error_log;
      delete (skipRaw as any).failed_at;
      await supabase
        .from("task_completions")
        .update({
          status: "submitted",
          raw_data: skipRaw,
        })
        .eq("id", record.id);
      return new Response(
        JSON.stringify({
          message: !useAiGrading
            ? "AI Grading is disabled for this task."
            : "Skipped AI grading: original_script is missing (submission kept).",
          skipped_ai: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let driveUrl =
      currentRawData.student_audio_url || record.audio_url || currentRawData.audio_url;
    if (
      !driveUrl &&
      Array.isArray(currentRawData.drive_file_ids) &&
      currentRawData.drive_file_ids.length > 0
    ) {
      driveUrl = `https://drive.google.com/file/d/${currentRawData.drive_file_ids[0]}/view`;
    }
    if (!driveUrl) {
      throw new Error("Fatal: audio_url or student_audio_url is missing.");
    }

    const fileId = extractDriveFileId(driveUrl);
    if (!fileId) {
      throw new Error(`Invalid Google Drive URL format: ${driveUrl}`);
    }

    const audioBytes = await downloadAudioFromDrive(fileId);
    const audioBase64 = encodeBase64(audioBytes);

    let aiEvaluation: any = null;

    try {
      if (!speechaceApiKey) throw new Error("SPEECHACE_API_KEY not configured.");
      const speechaceResult = await gradeWithSpeechace(
        audioBytes,
        effectiveScript,
        gradingPolicy.accent,
        speechaceApiKey,
      );
      aiEvaluation = mapSpeechaceToEvaluation(speechaceResult, gradingPolicy.phonetic_format);
    } catch (speechaceErr: any) {
      console.warn("Speechace failed, falling back to Gemini:", speechaceErr.message);
      aiEvaluation = await gradeWithGeminiFallback(
        audioBase64,
        effectiveScript,
        geminiApiKey,
        useAiGrammar,
      );
    }

    aiEvaluation.effective_script = effectiveScript;
    aiEvaluation.script_scope_note = scriptResolved.note;
    aiEvaluation.material_range = materialRange;
    aiEvaluation.graded_at = new Date().toISOString();

    const feedback = await generateGeminiFeedback(aiEvaluation, geminiApiKey);
    aiEvaluation.comprehensive_feedback = feedback;

    const gradingHistory = currentRawData.grading_history || [];
    if (currentRawData.ai_evaluation) {
      gradingHistory.push({
        timestamp: new Date().toISOString(),
        ai_evaluation: currentRawData.ai_evaluation,
        audio_url: driveUrl,
        teacher_score: currentRawData.teacher_score,
        ta_score: currentRawData.ta_score,
      });
    }

    const nextStatus = gradingPolicy.final_authority === "ai_auto" ? "graded" : "ai_ready";

    const updatedRawData = {
      ...currentRawData,
      ai_evaluation: aiEvaluation,
      grading_history: gradingHistory,
      assignment_text: effectiveScript,
      grading_policy_snapshot: gradingPolicy,
    };

    const { error: updateError } = await supabase
      .from("task_completions")
      .update({
        status: nextStatus,
        raw_data: updatedRawData,
      })
      .eq("id", recordId);

    if (updateError) {
      throw new Error(`Database Commit Failed: ${updateError.message}`);
    }

    const targetUserId = record.student_id || record.user_id;
    const errorCount = aiEvaluation.word_errors?.length || 0;

    if (targetUserId && errorCount > 0 && Array.isArray(aiEvaluation.word_errors)) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("raw_data")
        .eq("id", targetUserId)
        .is("deleted_at", null)
        .single();

      if (profileData) {
        const profileRaw = profileData.raw_data || {};
        const defectVocab = profileRaw.defect_vocab || {};

        aiEvaluation.word_errors.forEach((err: any) => {
          const w = String(err.word || "").toLowerCase().replace(/[^a-z']/g, "");
          if (!w) return;
          if (!defectVocab[w]) {
            defectVocab[w] = { count: 0, latest_ipa: err.expected_phonetic };
          }
          defectVocab[w].count += 1;
          defectVocab[w].last_mistake = err.student_pronunciation;
        });

        profileRaw.defect_vocab = defectVocab;
        supabase.from("profiles").update({ raw_data: profileRaw }).eq("id", targetUserId).then();
      }
    }

    return new Response(JSON.stringify({ success: true, status: nextStatus, ai_evaluation: aiEvaluation }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`AI Pipeline Error: ${error.message}`);

    if (recordId && supabase) {
      try {
        await supabase.from("task_completions").update({
          status: "ai_error",
          raw_data: {
            ...currentRawData,
            ai_error_log: error.message,
            failed_at: new Date().toISOString(),
          },
        }).eq("id", recordId);
      } catch (e) {
        console.error("Failed to rollback state.", e);
      }
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

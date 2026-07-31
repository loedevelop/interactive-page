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

function looksLikeHtmlBuffer(contentType: string, buffer: ArrayBuffer): boolean {
  if (contentType.includes("text/html")) return true;
  const preview = new TextDecoder().decode(buffer.slice(0, 500)).toLowerCase();
  return preview.includes("<!doctype html") || preview.includes("<html");
}

/**
 * 🛡️ Google Drive 對「無法掃描病毒」的檔案會回傳確認頁 HTML 而非真正內容。
 * 單純加 confirm=t 只能繞過一部分情況，真正可靠的做法是從確認頁解析出
 * confirm token 與 uuid，改打 drive.usercontent.google.com/download。
 * 與 stream-audio/index.ts 的 resolveRealDownloadUrl 同一招，勿各自維護後失去同步。
 * 仍失敗時改走 GAS POST download_file（Base64），與老師端切割工具同一條備援。
 */
const GAS_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec";

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function downloadViaGas(fileId: string): Promise<Uint8Array> {
  const gasRes = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "download_file", fileId }),
    redirect: "follow",
  });
  if (!gasRes.ok) {
    throw new Error(`GAS download_file HTTP ${gasRes.status}`);
  }
  const text = await gasRes.text();
  let parsed: { status?: string; message?: string; fileData?: string };
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    throw new Error("GAS download_file 回傳非 JSON（可能未部署 download_file）");
  }
  if (parsed.status !== "success" || !parsed.fileData) {
    throw new Error(parsed.message || "GAS download_file 失敗");
  }
  const bytes = base64ToUint8Array(parsed.fileData);
  if (bytes.byteLength < 64) {
    throw new Error("GAS download_file 內容過短");
  }
  return bytes;
}

async function resolveRealDriveDownloadUrl(fileId: string): Promise<string> {
  const probeUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const probeRes = await fetch(probeUrl);
  const probeContentType = probeRes.headers.get("Content-Type") || "";

  if (!probeContentType.includes("text/html")) {
    return probeUrl;
  }

  const html = await probeRes.text();
  const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/) || html.match(/[?&]confirm=([0-9A-Za-z_-]+)/);
  const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/) || html.match(/[?&]uuid=([0-9A-Za-z-]+)/);

  if (confirmMatch && uuidMatch) {
    return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
  }

  return `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
}

async function downloadAudioFromDrive(fileId: string): Promise<Uint8Array> {
  try {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    let audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) {
      throw new Error(`Audio Download Failed. HTTP ${audioRes.status}.`);
    }
    let audioBuffer = await audioRes.arrayBuffer();
    const contentType = audioRes.headers.get("Content-Type") || "";

    if (looksLikeHtmlBuffer(contentType, audioBuffer)) {
      const realUrl = await resolveRealDriveDownloadUrl(fileId);
      audioRes = await fetch(realUrl);
      if (!audioRes.ok) {
        throw new Error(`Audio Download Failed. HTTP ${audioRes.status}.`);
      }
      audioBuffer = await audioRes.arrayBuffer();
      const retryContentType = audioRes.headers.get("Content-Type") || "";
      if (looksLikeHtmlBuffer(retryContentType, audioBuffer)) {
        throw new Error(`Drive Download blocked for file ${fileId}`);
      }
    }

    return new Uint8Array(audioBuffer);
  } catch (driveErr: any) {
    console.warn("Drive public download failed, fallback GAS:", driveErr?.message || driveErr);
    return await downloadViaGas(fileId);
  }
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
    // Speechace 官方判讀標準：70-80 分僅屬「Good，可懂但有一兩個小瑕疵」，
    // 老師測試後反應這類太輕微、幾乎每個字都會被抓，不實用。
    // 改成只抓 70 分以下（Fair/Poor：可能聽不懂、有明顯錯誤），聚焦真正明顯的發音錯誤。
    if (quality >= 70) return;

    let errorType = "mispronunciation";
    if (w.quality_class === "omission") errorType = "omission";

    let expectedPhonetic = "";
    let studentPronunciation = "";
    if (Array.isArray(w.phone_score_list)) {
      const phones = w.phone_score_list
        .map((p: any) => p.phone ?? p.ipa ?? "")
        .filter(Boolean)
        .join("");
      expectedPhonetic = phones ? `/${phones}/` : "";

      // sound_most_like 是 Speechace 依學生實際發音判斷「聽起來最像哪個音」，
      // 用它才拼得出「學生實際唸成什麼」；之前誤用不存在的 extended_word_score 欄位，
      // 導致永遠拿不到值、只能顯示「[需覆核]」佔位字，等於白做。
      const soundedPhones = w.phone_score_list
        .map((p: any) => p.sound_most_like ?? p.phone ?? "")
        .filter(Boolean)
        .join("");
      studentPronunciation = soundedPhones ? `/${soundedPhones}/` : "";
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
      student_pronunciation: studentPronunciation || "(音檔片段過短，無法辨識)",
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
    let taskGradingUnits: any[] = [];

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
        if (foundTask.raw_data && Array.isArray(foundTask.raw_data.grading_units)) {
          taskGradingUnits = foundTask.raw_data.grading_units;
        }
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

        const hasUnitScripts = taskGradingUnits.some(
          (u: any) => String(u?.original_script || "").trim(),
        );
        // 有可用文稿（整份或分頁單位）才開 AI
        if (!String(originalScript || "").trim() && !hasUnitScripts) {
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

    function buildSegments(): any[] {
      const rawSegs = currentRawData.audio_segments;
      if (Array.isArray(rawSegs) && rawSegs.length > 0) {
        return rawSegs.map((s: any, idx: number) => {
          const unit = taskGradingUnits[idx] || {};
          return {
            ...s,
            file_id: s.file_id || s.id,
            audio_url: s.audio_url ||
              (s.file_id ? `https://drive.google.com/file/d/${s.file_id}/view` : ""),
            original_script: String(s.original_script || unit.original_script || "").trim(),
            unit_key: s.unit_key || unit.unit_key || "",
            label: s.label || unit.label || "",
            page: s.page != null ? s.page : unit.page,
            status: s.status || "pending",
          };
        });
      }
      const ids = Array.isArray(currentRawData.drive_file_ids)
        ? currentRawData.drive_file_ids.map(String).filter(Boolean)
        : [];
      const primaryUrl =
        currentRawData.student_audio_url || record.audio_url || currentRawData.audio_url || "";
      if (ids.length === 0 && primaryUrl) {
        const fid = extractDriveFileId(primaryUrl);
        if (fid) ids.push(fid);
      }
      if (ids.length === 0) return [];
      if (taskGradingUnits.length > 0) {
        return ids.map((fid: string, idx: number) => {
          const unit = taskGradingUnits[idx] || taskGradingUnits[taskGradingUnits.length - 1] || {};
          return {
            file_id: fid,
            audio_url: `https://drive.google.com/file/d/${fid}/view`,
            original_script: String(unit.original_script || "").trim(),
            unit_key: unit.unit_key || "",
            label: unit.label || "",
            page: unit.page,
            status: "pending",
          };
        });
      }
      return [{
        file_id: ids[0],
        audio_url: primaryUrl || `https://drive.google.com/file/d/${ids[0]}/view`,
        original_script: "",
        unit_key: "",
        label: "",
        status: "pending",
      }];
    }

    async function gradeOne(
      audioBytes: Uint8Array,
      scriptText: string,
    ): Promise<any> {
      const audioBase64 = encodeBase64(audioBytes);
      let aiEvaluation: any = null;
      try {
        if (!speechaceApiKey) throw new Error("SPEECHACE_API_KEY not configured.");
        const speechaceResult = await gradeWithSpeechace(
          audioBytes,
          scriptText,
          gradingPolicy.accent,
          speechaceApiKey,
        );
        aiEvaluation = mapSpeechaceToEvaluation(speechaceResult, gradingPolicy.phonetic_format);
      } catch (speechaceErr: any) {
        console.warn("Speechace failed, falling back to Gemini:", speechaceErr.message);
        aiEvaluation = await gradeWithGeminiFallback(
          audioBase64,
          scriptText,
          geminiApiKey!,
          useAiGrammar,
        );
      }
      const feedback = await generateGeminiFeedback(aiEvaluation, geminiApiKey!);
      aiEvaluation.comprehensive_feedback = feedback;
      aiEvaluation.graded_at = new Date().toISOString();
      return aiEvaluation;
    }

    // 重新讀取最新 raw，避免並發重入搶同一段
    const { data: freshRow } = await supabase
      .from("task_completions")
      .select("raw_data, status, updated_at")
      .eq("id", recordId)
      .maybeSingle();
    if (freshRow?.raw_data) currentRawData = freshRow.raw_data;
    if (freshRow?.status && freshRow.status !== "ai_processing") {
      return new Response(JSON.stringify({ message: "Bypassed: status changed." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let segments = buildSegments();
    if (!segments.length) {
      throw new Error("Fatal: audio_url or student_audio_url is missing.");
    }

    const anySegmentScript = segments.some((s) => String(s.original_script || "").trim());
    const scriptResolved = resolveEffectiveScript(originalScript, materialRange);
    const fallbackScript = scriptResolved.text;
    if (!useAiGrading || (!anySegmentScript && !fallbackScript)) {
      const skipRaw = {
        ...currentRawData,
        audio_segments: segments,
        ai_skip_reason: !useAiGrading
          ? "use_ai_grading_disabled"
          : "original_script_missing",
        ai_skipped_at: new Date().toISOString(),
      };
      delete (skipRaw as any).ai_error_log;
      delete (skipRaw as any).failed_at;
      await supabase
        .from("task_completions")
        .update({ status: "submitted", raw_data: skipRaw })
        .eq("id", record.id);
      return new Response(
        JSON.stringify({
          message: !useAiGrading
            ? "AI Grading is disabled for this task."
            : "Skipped AI grading: original_script is missing (submission kept).",
          skipped_ai: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    for (const s of segments) {
      if (!String(s.original_script || "").trim() && fallbackScript) {
        s.original_script = fallbackScript;
      }
    }

    const STALE_CLAIM_MS = 3 * 60 * 1000;
    const MAX_WALL_MS = 50 * 1000;
    const startedAt = Date.now();

    function findClaimableIndex(segs: any[]): number {
      const now = Date.now();
      const pendingIdx = segs.findIndex((s) => s.status === "pending");
      if (pendingIdx >= 0) return pendingIdx;
      return segs.findIndex((s) => {
        if (s.status !== "processing") return false;
        const claimed = Date.parse(String(s.claimed_at || "")) || 0;
        return !claimed || now - claimed > STALE_CLAIM_MS;
      });
    }

    function buildDoneEvals(segs: any[]): any[] {
      return segs
        .filter((s) => s.status === "done" && s.ai_evaluation)
        .map((s) => ({
          ...s.ai_evaluation,
          unit_key: s.unit_key,
          label: s.label,
          page: s.page,
          file_id: s.file_id,
        }));
    }

    function buildPrimaryEval(doneEvals: any[]): any {
      let primaryEval = doneEvals[0] || null;
      if (doneEvals.length > 1 && primaryEval) {
        const avg = (key: string) => {
          const nums = doneEvals.map((e) => Number(e[key])).filter((n) => Number.isFinite(n));
          if (!nums.length) return primaryEval[key];
          return Math.round(nums.reduce((a: number, b: number) => a + b, 0) / nums.length);
        };
        primaryEval = {
          ...primaryEval,
          pronunciation_score: avg("pronunciation_score"),
          fluency_score: avg("fluency_score"),
          completeness_score: avg("completeness_score"),
          word_errors: doneEvals.flatMap((e) => e.word_errors || []),
          segment_count: doneEvals.length,
          comprehensive_feedback: doneEvals
            .map((e, i) => {
              const tag = e.label || e.unit_key || `第${i + 1}段`;
              return `【${tag}】\n${e.comprehensive_feedback || ""}`;
            })
            .join("\n\n"),
        };
      }
      return primaryEval;
    }

    async function persistSegments(
      segs: any[],
      opts: { nextStatus: string; gradingHistory?: any[]; clearErrors?: boolean },
    ) {
      const doneEvals = buildDoneEvals(segs);
      const primaryEval = buildPrimaryEval(doneEvals);
      const hasError = segs.some((s) => s.status === "error");
      const stillPendingInner = segs.some((s) => s.status === "pending" || s.status === "processing");
      const assignmentTextForDisplay = doneEvals.length > 1
        ? doneEvals
          .map((e, i) => {
            const tag = e.label || e.unit_key || `第${i + 1}頁`;
            return `【${tag}】\n${e.effective_script || ""}`;
          })
          .join("\n\n")
        : (primaryEval && primaryEval.effective_script) || fallbackScript;

      const updatedRawData: any = {
        ...currentRawData,
        audio_segments: segs,
        ai_evaluations: doneEvals,
        ai_evaluation: primaryEval || currentRawData.ai_evaluation,
        grading_history: opts.gradingHistory || currentRawData.grading_history || [],
        assignment_text: assignmentTextForDisplay,
        grading_policy_snapshot: gradingPolicy,
        ai_segment_heartbeat: new Date().toISOString(),
        ai_segment_cursor: segs.findIndex((s) => s.status === "processing" || s.status === "pending"),
        ai_pipeline: {
          total: segs.length,
          done: doneEvals.length,
          pending: segs.filter((s) => s.status === "pending").length,
          processing: segs.filter((s) => s.status === "processing").length,
          error: segs.filter((s) => s.status === "error").length,
          current_step: stillPendingInner ? "grading_segments" : "finished",
          current_step_label: stillPendingInner
            ? `已完成 ${doneEvals.length}/${segs.length} 段（逐段批改中）`
            : `全部完成 ${doneEvals.length}/${segs.length} 段`,
          updated_at: new Date().toISOString(),
        },
      };
      if (opts.clearErrors) {
        delete updatedRawData.ai_error_log;
        delete updatedRawData.failed_at;
      }
      if (hasError && !stillPendingInner && doneEvals.length === 0) {
        updatedRawData.ai_error_log =
          segs.map((s) => s.error).filter(Boolean).join(" | ") || "All segments failed";
        updatedRawData.failed_at = new Date().toISOString();
      }

      const { error: updateError } = await supabase
        .from("task_completions")
        .update({
          status: opts.nextStatus,
          raw_data: updatedRawData,
        })
        .eq("id", recordId);
      if (updateError) throw new Error(`Database Commit Failed: ${updateError.message}`);
      currentRawData = updatedRawData;
      return { doneEvals, primaryEval, stillPending: stillPendingInner, updatedRawData };
    }

    // 全新一輪才封存舊評分為 history（避免中間彙總被當「批改過 2 次」）
    const isFreshRunStart = segments.every((s) => s.status === "pending");
    let gradingHistory = currentRawData.grading_history || [];
    if (isFreshRunStart && currentRawData.ai_evaluation) {
      gradingHistory = [
        ...gradingHistory,
        {
          timestamp: new Date().toISOString(),
          ai_evaluation: currentRawData.ai_evaluation,
          audio_url: currentRawData.student_audio_url,
          teacher_score: currentRawData.teacher_score,
          ta_score: currentRawData.ta_score,
        },
      ];
    }

    let segmentsProcessedThisInvoke = 0;

    // 同一次 invocation 內迴圈批多段；禁止 fire-and-forget（Edge 回傳後會掐掉背景 fetch）
    while (Date.now() - startedAt < MAX_WALL_MS) {
      const { data: loopFresh } = await supabase
        .from("task_completions")
        .select("raw_data, status")
        .eq("id", recordId)
        .maybeSingle();
      if (loopFresh?.status && loopFresh.status !== "ai_processing") {
        return new Response(JSON.stringify({ message: "Bypassed: status changed mid-loop." }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (loopFresh?.raw_data) currentRawData = loopFresh.raw_data;
      segments = buildSegments();
      for (const s of segments) {
        if (!String(s.original_script || "").trim() && fallbackScript) {
          s.original_script = fallbackScript;
        }
      }

      const pendingIdx = findClaimableIndex(segments);
      if (pendingIdx < 0) break;

      const claimedAt = new Date().toISOString();
      segments[pendingIdx] = {
        ...segments[pendingIdx],
        status: "processing",
        claimed_at: claimedAt,
      };
      await persistSegments(segments, {
        nextStatus: "ai_processing",
        gradingHistory,
        clearErrors: true,
      });

      const seg = segments[pendingIdx];
      const segScript = String(seg.original_script || "").trim();
      if (!segScript) {
        segments[pendingIdx] = {
          ...seg,
          status: "skipped",
          skip_reason: "original_script_missing",
        };
      } else {
        const driveUrl = seg.audio_url ||
          (seg.file_id ? `https://drive.google.com/file/d/${seg.file_id}/view` : "");
        const fileId = extractDriveFileId(driveUrl) || String(seg.file_id || "");
        if (!fileId) {
          segments[pendingIdx] = {
            ...seg,
            status: "error",
            error: `Invalid Google Drive URL for segment ${pendingIdx}`,
          };
        } else {
          try {
            const audioBytes = await downloadAudioFromDrive(fileId);
            const aiEvaluation = await gradeOne(audioBytes, segScript);
            aiEvaluation.effective_script = segScript;
            aiEvaluation.script_scope_note = seg.unit_key
              ? `grading_unit_${seg.unit_key}`
              : scriptResolved.note;
            aiEvaluation.material_range = materialRange;
            aiEvaluation.unit_key = seg.unit_key || "";
            aiEvaluation.label = seg.label || "";
            aiEvaluation.page = seg.page;
            aiEvaluation.segment_index = pendingIdx;

            segments[pendingIdx] = {
              ...seg,
              status: "done",
              ai_evaluation: aiEvaluation,
              graded_at: aiEvaluation.graded_at,
            };
          } catch (segErr: any) {
            segments[pendingIdx] = {
              ...seg,
              status: "error",
              error: segErr?.message || String(segErr),
            };
          }
        }
      }

      segmentsProcessedThisInvoke++;
      await persistSegments(segments, {
        nextStatus: "ai_processing",
        gradingHistory,
      });
      gradingHistory = currentRawData.grading_history || gradingHistory;
    }

    segments = buildSegments();
    const stillPending = segments.some((s) => s.status === "pending" || s.status === "processing");
    let nextStatus = "ai_processing";
    if (!stillPending) {
      const doneCount = segments.filter((s) => s.status === "done" && s.ai_evaluation).length;
      if (doneCount === 0) nextStatus = "ai_error";
      else nextStatus = gradingPolicy.final_authority === "ai_auto" ? "graded" : "ai_ready";
    }

    const finalPersist = await persistSegments(segments, {
      nextStatus,
      gradingHistory,
    });

    // 💣 雷區（見 .cursor/rules/ai-grading-pipeline-invariants.mdc）：
    // 若只剩「新鮮 processing」（尚不可搶）或本輪完全沒做成任何段，
    // 禁止立刻 self-continue。否則會在數分鐘內狂打 Edge、拖垮整站（含登入／登出）。
    // 絕對禁止改回「只要 stillPending 就 fetch 自己」。
    const claimableAfter = findClaimableIndex(segments);
    const shouldContinue =
      stillPending &&
      claimableAfter >= 0 &&
      segmentsProcessedThisInvoke > 0;

    if (stillPending && !shouldContinue) {
      console.warn(
        "segment continue suppressed:",
        JSON.stringify({
          recordId,
          processed: segmentsProcessedThisInvoke,
          claimableAfter,
          pending: segments.filter((s) => s.status === "pending").length,
          processing: segments.filter((s) => s.status === "processing").length,
        }),
      );
      return new Response(
        JSON.stringify({
          success: true,
          status: "ai_processing",
          segments_processed: segmentsProcessedThisInvoke,
          remaining: segments.filter((s) => s.status === "pending" || s.status === "processing").length,
          continued: false,
          continue_suppressed: true,
          reason:
            claimableAfter < 0
              ? "waiting_on_in_flight_claim"
              : "no_progress_this_invoke",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (shouldContinue) {
      const continueRecord = {
        ...record,
        status: "ai_processing",
        raw_data: finalPersist.updatedRawData,
      };
      const fnUrl = `${supabaseUrl}/functions/v1/process-audio-ai`;
      // 不可 await 整段續跑（會巢狀等到超時）；也不可純 fire-and-forget（回傳後常被掐）。
      // 優先 EdgeRuntime.waitUntil；否則短等確認請求已送出。
      const continuePromise = fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ type: "UPDATE", record: continueRecord }),
      }).then(async (contRes) => {
        const contText = await contRes.text();
        console.log("segment continue invoke:", contRes.status, contText.slice(0, 300));
      }).catch((e) => console.error("segment continue invoke failed:", e));

      const edgeRuntime = (globalThis as any).EdgeRuntime;
      if (edgeRuntime && typeof edgeRuntime.waitUntil === "function") {
        edgeRuntime.waitUntil(continuePromise);
      } else {
        await Promise.race([
          continuePromise,
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: "ai_processing",
          segments_processed: segmentsProcessedThisInvoke,
          remaining: segments.filter((s) => s.status === "pending" || s.status === "processing").length,
          continued: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const primaryEval = finalPersist.primaryEval;
    const targetUserId = record.student_id || record.user_id;
    const errorCount = primaryEval?.word_errors?.length || 0;

    if (targetUserId && errorCount > 0 && Array.isArray(primaryEval?.word_errors)) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("raw_data")
        .eq("id", targetUserId)
        .is("deleted_at", null)
        .single();

      if (profileData) {
        const profileRaw = profileData.raw_data || {};
        const defectVocab = profileRaw.defect_vocab || {};

        primaryEval.word_errors.forEach((err: any) => {
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

    return new Response(JSON.stringify({
      success: true,
      status: nextStatus,
      ai_evaluation: primaryEval,
      segments: segments.length,
      segments_processed: segmentsProcessedThisInvoke,
    }), {
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

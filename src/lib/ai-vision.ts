type AiConfig = { provider: string; apiKey: string; model: string };

export function readAiConfig(): AiConfig {
  if (typeof process === "undefined" || !process.env) {
    return {
      provider: "gemini",
      apiKey: "",
      model: "gemini-3.5-flash",
    };
  }
  return {
    provider: (process.env.SAHLDZ_AI_PROVIDER || "gemini").trim(),
    apiKey: (process.env.SAHLDZ_AI_API_KEY || "").trim(),
    model: (process.env.SAHLDZ_AI_MODEL || "gemini-3.5-flash").trim(),
  };
}

export function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!cleaned) throw new Error("استجابة الذكاء الاصطناعي فارغة");

  const candidates: string[] = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (
    start >= 0 &&
    end > start &&
    !(start === 0 && end === cleaned.length - 1)
  ) {
    candidates.push(cleaned.slice(start, end + 1).trim());
  }

  for (const cand of candidates) {
    const attempts = [cand];
    const repaired = cand
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/,{2,}/g, ",")
      .replace(/:\s*(NaN|Infinity|-Infinity|\bundefined\b)/g, ": null")
      .replace(/,\s*,/g, ",");
    if (repaired !== cand) attempts.push(repaired);
    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt) as T;
      } catch {
        // try next candidate/repair
      }
    }
  }
  throw new Error(
    "استجابة الذكاء الاصطناعي غير صالحة — جرّب صورة أوضح أو أعد المحاولة",
  );
}

export type VisionRequest = {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  maxOutputTokens?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildModelChain(primary: string): string[] {
  const chain: string[] = [];
  const add = (m?: string | null) => {
    if (m && !chain.includes(m)) chain.push(m);
  };
  add(primary);
  const extra =
    typeof process !== "undefined" && process.env
      ? (process.env.SAHLDZ_AI_FALLBACK_MODELS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  for (const m of extra) add(m);
  add("gemini-3.5-flash");
  add("gemini-3-flash-preview");
  add("gemini-flash-latest");
  add("gemini-1.5-flash");
  return chain.length ? chain : ["gemini-3.5-flash"];
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 404 || status >= 500;
}

export async function geminiVisionJson<T>(req: VisionRequest): Promise<T> {
  const cfg = readAiConfig();
  if (!cfg.apiKey)
    throw new Error(
      "مفتاح الذكاء الاصطناعي غير مُهيّأ — أضف SAHLDZ_AI_API_KEY في ملف .env",
    );
  if (cfg.provider !== "gemini")
    throw new Error("الذكاء الاصطناعي يدعم مزوّد Gemini حالياً");

  const body = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: req.mimeType, data: req.imageBase64 } },
          { text: req.prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: req.maxOutputTokens ?? 4096,
      responseMimeType: "application/json",
    },
  });

  let lastError: Error | null = null;
  for (const model of buildModelChain(cfg.model)) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`;
    let attempts = 0;
    while (attempts < 2) {
      attempts += 1;
      let res: Response | null = null;
      let resBody = "";
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        resBody = await res.text().catch(() => "");
      } catch (e) {
        lastError =
          e instanceof Error ? e : new Error("تعذّر الاتصال بالذكاء الاصطناعي");
        if (attempts < 2) await sleep(4000 * attempts);
        continue;
      }
      if (res.ok) {
        let aiText = "";
        try {
          const json: any = JSON.parse(resBody);
          aiText = json?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text ?? "")
            .join("");
          if (!aiText) throw new Error("لم يُرجع الذكاء الاصطناعي أي نتيجة");
          return parseJsonLoose<T>(aiText);
        } catch (e) {
          console.error(
            "[AI_DIAG] parseFail model:",
            model,
            "text:",
            aiText.slice(0, 2000),
            "error:",
            e instanceof Error ? e.message : e,
          );
          throw e instanceof Error
            ? e
            : new Error("استجابة الذكاء الاصطناعي غير صالحة");
        }
      }
      lastError = new Error(
        `فشل الاتصال بالذكاء الاصطناعي (HTTP ${res.status})${resBody ? " — " + resBody.slice(0, 160) : ""}`,
      );
      if (!isRetryableStatus(res.status)) break;
      if (attempts < 2) await sleep(3000 * attempts);
    }
  }
  throw lastError ?? new Error("فشل الذكاء الاصطناعي — جرّب مرة أخرى بعد قليل");
}

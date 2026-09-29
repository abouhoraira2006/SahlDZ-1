import { createServerFn } from "@tanstack/react-start";
import { KNOWLEDGE_BASE } from "@/lib/assistant/knowledge";

type AiConfig = { provider: string; apiKey: string; model: string };

function readConfig(): AiConfig {
  if (typeof process === "undefined" || !process.env) {
    return { provider: "gemini", apiKey: "", model: "gemini-3.5-flash" };
  }
  return {
    provider: (process.env.SAHLDZ_AI_PROVIDER || "gemini").trim(),
    apiKey: (process.env.SAHLDZ_AI_API_KEY || "").trim(),
    model: (process.env.SAHLDZ_AI_MODEL || "gemini-3.5-flash").trim(),
  };
}

function buildGrounding(question: string): string {
  const nq = question.toLowerCase();
  const relevant = KNOWLEDGE_BASE.filter(
    (e) =>
      e.keywords.some((k) => nq.includes(k.toLowerCase())) ||
      e.title.includes(question.split(" ")[0] || ""),
  ).slice(0, 6);

  if (relevant.length === 0) return "";
  return relevant
    .map(
      (e, i) =>
        `${i + 1}. [${e.title}]\n${e.answer}\nأزرار مقترحة: ${
          e.actions?.length
            ? e.actions.map((a) => `«${a.label}» -> ${a.to}`).join("، ")
            : "لا يوجد"
        }`,
    )
    .join("\n\n");
}

async function callGemini(prompt: string, cfg: AiConfig): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 700,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const json: any = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini empty reply");
  return text;
}

async function callOpenAI(prompt: string, cfg: AiConfig): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            "أنت مساعد «سهل» الداخلي لنظام إدارة مطاعم. أجب بالعربية فقط وبدقة تامة بناءً على المعرفة المرفقة. إن لم تجد جواباً في المعرفة قل ذلك بوضوح واقترح صياغة أخرى. لا تختلق ميزات غير موجودة.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const json: any = await res.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI empty reply");
  return text;
}

export const askAssistantAI = createServerFn({ method: "POST" })
  .validator((d: { question: string }) => d)
  .handler(async ({ data }) => {
    const cfg = readConfig();
    if (!cfg.apiKey) return { usedAI: false, answer: "" };

    const grounding = buildGrounding(data.question);
    const prompt = grounding
      ? `سؤال المستخدم: ${data.question}\n\nمعرفة إضافية عن النظام (استخدمها كمرجع دقيق):\n${grounding}\n\nأجب بفقرة واضحة ومنسقة مع سطر فاصل كل 4 أسطر.`
      : `سؤال المستخدم: ${data.question}\n\nغيّب الإشارة إلى الواجهة الداخلية عند الاقتضاء وأجب بوضوح. إن كان السؤال خارج نظام إدارة المطاعم اعتذر بلطف.`;

    try {
      const answer =
        cfg.provider === "openai"
          ? await callOpenAI(prompt, cfg)
          : await callGemini(prompt, cfg);
      return { usedAI: true, answer: answer.trim() };
    } catch {
      return { usedAI: false, answer: "" };
    }
  });

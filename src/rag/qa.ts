/**
 * Q&A pipeline: retrieve grounded context, prompt DeepSeek, return a cited answer (plan §6).
 *
 * Guardrails:
 *  - Answer strictly from the retrieved context; respond in Spanish.
 *  - If the info isn't in the documents, say so.
 *  - Never give medical advice/interpretation/recommendations.
 *  - Always cite source document + page; always append a disclaimer.
 */

import { config } from "../config.ts";
import { rag } from "../rag-config.ts";
import { createLogger } from "../util/logger.ts";
import { embedQuery } from "./embeddings.ts";
import { search, type ScoredChunk } from "./vectorstore.ts";

const log = createLogger("qa");

const DISCLAIMER =
  "ℹ️ _Esta respuesta solo refleja lo que dicen tus documentos. No es un consejo médico; " +
  "consulta a un profesional de la salud para interpretarla._";

const NO_CONTEXT_MSG =
  "No encontré información sobre eso en tus documentos. Asegúrate de haberlos subido " +
  "(usa /upload) o reformula la pregunta.";

const SYSTEM_PROMPT = `Eres un asistente que SOLO consulta los documentos médicos personales del usuario.

Reglas estrictas:
- Responde únicamente con la información presente en el CONTEXTO proporcionado.
- Responde siempre en español, de forma clara y concisa.
- Si la información no está en el contexto, dilo explícitamente: no inventes datos.
- NUNCA des consejo médico, interpretación, diagnóstico ni recomendaciones. Solo reporta lo que dicen los documentos.
- Si te piden interpretación o consejo, declínalo amablemente y sugiere consultar a un profesional de la salud.
- Cuando uses un dato, indica de qué documento y página proviene.`;

export interface AnswerResult {
  answer: string;
  sources: { filename: string; page: number }[];
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function buildContext(chunks: ScoredChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.filename}, página ${c.page})\n${c.text}`)
    .join("\n\n");
}

function dedupeSources(chunks: ScoredChunk[]): { filename: string; page: number }[] {
  const seen = new Set<string>();
  const out: { filename: string; page: number }[] = [];
  for (const c of chunks) {
    const key = `${c.filename}#${c.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ filename: c.filename, page: c.page });
  }
  return out;
}

/** Call the DeepSeek (OpenAI-compatible) chat API with timeout + retry/backoff. */
async function callLlm(messages: ChatMessage[]): Promise<string> {
  if (!config.llm.apiKey) {
    throw new Error("DEEPSEEK_API_KEY no está configurada.");
  }

  const url = `${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= config.llm.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages,
          temperature: 0.1,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status >= 500) {
        throw new Error(`LLM transient error: HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(`LLM error: HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("LLM devolvió una respuesta vacía.");
      return content;
    } catch (err) {
      lastErr = err;
      log.warn(`LLM attempt ${attempt}/${config.llm.maxRetries} failed`);
      if (attempt < config.llm.maxRetries) {
        const backoff = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Fallo al contactar el LLM.");
}

/** Answer a question grounded in the user's documents. */
export async function answerQuestion(userId: number, question: string): Promise<AnswerResult> {
  const queryEmbedding = await embedQuery(question);
  const chunks = search(userId, queryEmbedding, rag.topK);

  if (chunks.length === 0) {
    return { answer: `${NO_CONTEXT_MSG}\n\n${DISCLAIMER}`, sources: [] };
  }

  const context = buildContext(chunks);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `CONTEXTO:\n${context}\n\nPREGUNTA: ${question}\n\nResponde solo con base en el contexto anterior.`,
    },
  ];

  let body: string;
  try {
    body = await callLlm(messages);
  } catch (err) {
    log.error("LLM call failed after retries", (err as Error).message);
    return {
      answer:
        "⚠️ No pude generar la respuesta en este momento (el servicio de IA no está disponible). " +
        "Inténtalo de nuevo en unos minutos.",
      sources: [],
    };
  }

  const sources = dedupeSources(chunks);
  const citations = sources.map((s) => `• ${s.filename}, p. ${s.page}`).join("\n");
  const answer = `${body}\n\n📄 *Fuentes:*\n${citations}\n\n${DISCLAIMER}`;
  return { answer, sources };
}

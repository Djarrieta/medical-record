import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import type { Tagger } from "../../domain/ports";
import { normalizeTags, MAX_TAGS } from "../../domain/tags";
import type { BotConfig } from "../config";

// Tags only need the document header (type, organ/zone, exam, date), so feeding
// the start of the text keeps the call cheap.
const MAX_INPUT_CHARS = 2000;

const SYSTEM_PROMPT =
  "Eres un asistente que extrae etiquetas (tags) médicas de un documento clínico en español. " +
  "Devuelve SOLO un arreglo JSON de strings, sin texto adicional. " +
  "Usa términos canónicos, en minúscula y singular, sin frases largas. Incluye, cuando apliquen: " +
  "órganos o zonas del cuerpo completas (ej. 'estómago', 'codo', 'espalda', 'ojos'), " +
  "procedimientos o tipos de examen de forma global (ej. 'hemograma', 'urianálisis', 'radiografía'), " +
  "y la especialidad si es evidente (ej. 'cardiología'). " +
  "Si el documento tiene una fecha clara, agrégala como un tag más en formato YYYY-MM-DD. " +
  "Máximo 8 tags. Si no hay nada útil, devuelve []. " +
  'Ejemplo de salida: ["urianálisis", "orina", "riñón", "2024-03-12"]';

// Generates medical tags from a document's text via the DeepSeek-compatible
// chat API. A single non-agentic completion — no tools, low temperature.
export class LlmTagger implements Tagger {
  private readonly model: ChatOpenAI;

  constructor(config: BotConfig) {
    if (!config.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required to initialize LlmTagger");
    }
    this.model = new ChatOpenAI({
      model: config.deepseekModel,
      temperature: 0.2,
      apiKey: config.deepseekApiKey,
      configuration: { baseURL: config.deepseekBaseUrl },
    });
  }

  async generate(text: string): Promise<string[]> {
    const snippet = text.trim().slice(0, MAX_INPUT_CHARS);
    if (!snippet) return [];

    try {
      const response = await this.model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(`Contenido del documento:\n${snippet}`),
      ]);
      const parsed = parseTags(response.text);
      return normalizeTags(parsed, MAX_TAGS);
    } catch (err) {
      console.error("Tag generation failed:", err);
      return [];
    }
  }
}

// Extracts the JSON string array from the model's reply, tolerating code fences
// or surrounding prose. Returns [] on any parse failure.
function parseTags(raw: string): string[] {
  const text = raw.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

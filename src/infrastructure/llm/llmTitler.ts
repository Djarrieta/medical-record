import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import type { Titler } from "../../domain/ports";
import type { BotConfig } from "../config";

// Only feed the model the start of the document — a title only needs the header
// (type of document, patient/issuer, date), and this keeps the call cheap.
const MAX_INPUT_CHARS = 2000;
// Defensive cap so a chatty model can't produce a paragraph-long "title".
const MAX_TITLE_CHARS = 80;

const SYSTEM_PROMPT =
  "Eres un asistente que genera títulos cortos para documentos médicos en español. " +
  "Devuelve SOLO el título, en texto plano, sin comillas ni prefijos. " +
  "Formato preferido: 'Tipo de documento — dato clave, fecha' " +
  "(ej. 'Hemograma — Lab. Clínico, 12 mar 2024'). " +
  "Omite las partes que no aparezcan en el texto. Máximo 60 caracteres.";

// Generates a short title from a document's text via the DeepSeek-compatible
// chat API. A single non-agentic completion — no tools, low temperature.
export class LlmTitler implements Titler {
  private readonly model: ChatOpenAI;

  constructor(config: BotConfig) {
    if (!config.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required to initialize LlmTitler");
    }
    this.model = new ChatOpenAI({
      model: config.deepseekModel,
      temperature: 0.2,
      apiKey: config.deepseekApiKey,
      configuration: { baseURL: config.deepseekBaseUrl },
    });
  }

  async generate(text: string, originalName: string): Promise<string | null> {
    const snippet = text.trim().slice(0, MAX_INPUT_CHARS);
    if (!snippet) return null;

    try {
      const response = await this.model.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(
          `Nombre del archivo: ${originalName}\n\nContenido del documento:\n${snippet}`,
        ),
      ]);
      const title = response.text.trim().replace(/^["']|["']$/g, "").trim();
      if (!title) return null;
      return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).trim() : title;
    } catch (err) {
      console.error("Title generation failed:", err);
      return null;
    }
  }
}

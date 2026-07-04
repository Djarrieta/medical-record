import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import type { EmailNoteSummarizer } from "../../domain/ports";
import type { BotConfig } from "../config";

// Emails can be long (quoted threads, signatures, footers); cap the input so a
// single triage call stays cheap. The useful signal is almost always near the top.
const MAX_INPUT_CHARS = 4000;
// Sentinel the model returns when the email is not worth keeping.
const SKIP_TOKEN = "OMITIR";

const SYSTEM_PROMPT =
  "Eres un asistente que procesa correos reenviados a un sistema personal de historia clínica. " +
  "Tu tarea es decidir si el correo contiene información de salud que el paciente quiera consultar más adelante " +
  "(por ejemplo: confirmación, cancelación o reprogramación de una cita; disponibilidad de resultados; " +
  "instrucciones médicas; autorizaciones o novedades de un trámite de salud). " +
  "Si aporta información útil, responde con un resumen claro y conciso en español (1 o 2 frases), " +
  "indicando la novedad concreta y la fecha si aparece. " +
  `Si el correo NO aporta información útil (publicidad, boletines, promociones, notificaciones automáticas sin valor), responde EXACTAMENTE con la palabra ${SKIP_TOKEN}. ` +
  "No inventes datos que no estén en el correo. Responde en texto plano, sin markdown ni prefijos.";

// Uses the DeepSeek-compatible chat API to triage a forwarded email and rewrite
// its body into a short, clear note. A single non-agentic completion, low temperature.
export class LlmEmailSummarizer implements EmailNoteSummarizer {
  private readonly model: ChatOpenAI;

  constructor(config: BotConfig) {
    if (!config.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required to initialize LlmEmailSummarizer");
    }
    this.model = new ChatOpenAI({
      model: config.deepseekModel,
      temperature: 0.2,
      apiKey: config.deepseekApiKey,
      configuration: { baseURL: config.deepseekBaseUrl },
    });
  }

  async summarize(subject: string, body: string): Promise<string | null> {
    const snippet = body.trim().slice(0, MAX_INPUT_CHARS);
    if (!snippet) return null;

    const response = await this.model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Asunto: ${subject}\n\nCuerpo del correo:\n${snippet}`),
    ]);
    const summary = response.text.trim().replace(/^["']|["']$/g, "").trim();
    if (!summary) return null;
    // Treat the skip sentinel (ignoring case/punctuation) as "not worth saving".
    if (summary.replace(/[.\s]/g, "").toUpperCase() === SKIP_TOKEN) return null;
    return summary;
  }
}

import type { FileRecord } from "../domain/types";
import type { DocumentRepository, Embedder, Llm, SessionStore, Tool, VectorIndex } from "../domain/ports";

const SYSTEM_PROMPT = `Eres un asistente médico que responde preguntas sobre los documentos clínicos del paciente.
Tienes la herramienta "search_medical_records" para buscar fragmentos en los documentos indexados. Úsala SIEMPRE (una o varias veces, reformulando la búsqueda si hace falta) antes de responder.
Responde de forma directa y concisa: contesta únicamente lo que se te pregunta, sin agregar contexto, explicaciones ni datos que no te pidieron.
Si no encuentras la respuesta, dilo en una frase. No ofrezcas seguir buscando ni hagas preguntas de seguimiento.
Si el paciente pide que le envíes, reenvíes, mandes o muestres un documento original (por ejemplo "mándame el documento"), usa la herramienta "send_original_document" con el nombre exacto del archivo. Esto es útil cuando el dato puede estar manuscrito o no ser legible en el texto indexado.
Responde en español con texto plano para Telegram. Reglas de formato estrictas:
- NO uses markdown: nada de asteriscos (**negrita**), guiones bajos, almohadillas (#) ni bloques de código.
- NUNCA uses tablas (nada de | ni filas con ---). Telegram no las alinea y se ven mal.
- Para enumerar valores o resultados, usa una línea por dato con un guion simple, por ejemplo:
  - Triglicéridos: 98 mg/dL (02/08/2025)
  - Triglicéridos: 298 mg/dL (12/10/2024)
- Mantén las respuestas breves y legibles en un chat móvil.`;

export interface AskResult {
  answer: string;
  documents: FileRecord[];
}

// Use case: answer a question using retrieval-augmented generation. The vector
// search is exposed to the LLM as a tool, so the model decides when and what to
// retrieve (agentic RAG) instead of a single fixed search.
export class AskQuestion {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly llm: Llm,
    private readonly repo: DocumentRepository,
    private readonly sessions: SessionStore,
  ) {}

  async run(question: string, userId: number): Promise<AskResult> {
    // Best score seen per source file across all tool invocations.
    const cited = new Map<string, number>();
    // fileName -> fileId, so the LLM can only request documents it actually found.
    const foundFiles = new Map<string, string>();
    // Original documents the LLM asked to send back to the patient.
    const toSend = new Map<string, FileRecord>();

    const searchTool: Tool = {
      name: "search_medical_records",
      description:
        "Busca fragmentos relevantes en los documentos clínicos indexados del paciente. " +
        "Úsala para fundamentar cualquier respuesta sobre la historia clínica.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Consulta o términos a buscar en los documentos.",
          },
          topK: {
            type: "integer",
            description: "Número máximo de fragmentos a recuperar (por defecto 5).",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = String(args.query ?? "").trim();
        if (!query) return JSON.stringify({ results: [], note: "Consulta vacía." });

        const topK = Number.isFinite(Number(args.topK)) ? Number(args.topK) : 5;
        const queryVector = await this.embedder.embedQuery(query);
        const results = await this.vectorIndex.search(queryVector, userId, topK);

        for (const r of results) {
          if (!cited.has(r.fileName) || r.score > cited.get(r.fileName)!) {
            cited.set(r.fileName, r.score);
          }
          foundFiles.set(r.fileName, r.fileId);
        }

        if (results.length === 0) {
          return JSON.stringify({ results: [], note: "Sin coincidencias en los documentos." });
        }

        return JSON.stringify({
          results: results.map((r) => ({
            score: Number((r.score * 100).toFixed(1)),
            fileName: r.fileName,
            text: r.text,
          })),
        });
      },
    };

    const sendTool: Tool = {
      name: "send_original_document",
      description:
        "Reenvía al paciente el archivo original (PDF/imagen) tal cual está guardado. " +
        "Úsala cuando el paciente pida que le envíes, mandes, reenvíes o muestres el documento, " +
        "o cuando el dato solicitado pueda estar manuscrito o no aparezca en el texto indexado. " +
        "Pasa el nombre exacto del archivo (tal como aparece en una búsqueda o en la conversación previa).",
      parameters: {
        type: "object",
        properties: {
          fileName: {
            type: "string",
            description: "Nombre exacto del archivo a enviar, tal como aparece en los resultados de búsqueda.",
          },
        },
        required: ["fileName"],
      },
      execute: async (args) => {
        const fileName = String(args.fileName ?? "").trim();
        if (!fileName) {
          return JSON.stringify({ sent: false, note: "Falta el nombre del archivo." });
        }
        // Prefer a file already surfaced by search this turn; otherwise resolve
        // it directly from the patient's stored files. The send request often
        // arrives in a later turn (e.g. the user replies "sí, mándamelo") where
        // no search ran, so `foundFiles` would be empty.
        let fileId = foundFiles.get(fileName);
        if (!fileId) {
          const target = fileName.toLowerCase();
          const match = this.repo
            .list(userId)
            .find(
              (f) =>
                f.originalName.toLowerCase() === target ||
                f.title.toLowerCase() === target,
            );
          if (match) fileId = match.id;
        }
        if (!fileId) {
          return JSON.stringify({
            sent: false,
            note: "No se encontró ese archivo. Busca primero el documento con search_medical_records.",
          });
        }
        const record = this.repo.get(fileId, userId);
        if (!record) {
          return JSON.stringify({ sent: false, note: "El archivo ya no está disponible." });
        }
        toSend.set(record.id, record);
        return JSON.stringify({ sent: true, fileName: record.originalName });
      },
    };

    const history = this.sessions.history(userId);
    const answer = await this.llm.answer(SYSTEM_PROMPT, history, question, [searchTool, sendTool]);
    const documents = Array.from(toSend.values());

    const now = new Date().toISOString();
    this.sessions.appendMessage(userId, { role: "user", content: question, createdAt: now });
    this.sessions.appendMessage(userId, {
      role: "assistant",
      content: answer,
      createdAt: new Date().toISOString(),
    });

    if (cited.size === 0) return { answer, documents };
    return { answer: `${answer}\n\n---\nFuentes:\n${this.formatSources(cited)}`, documents };
  }

  private formatSources(cited: Map<string, number>): string {
    return Array.from(cited.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => `- ${name}`)
      .join("\n");
  }
}

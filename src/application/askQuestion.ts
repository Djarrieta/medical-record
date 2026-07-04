import type { FileRecord } from "../domain/types";
import type {
  CalendarService,
  DocumentRepository,
  Embedder,
  Llm,
  NoteRepository,
  SessionStore,
  Tool,
  VectorIndex,
} from "../domain/ports";

const SYSTEM_PROMPT = `Eres un asistente médico que responde preguntas sobre los documentos clínicos del paciente.
Tienes la herramienta "search_medical_records" para buscar fragmentos en los documentos indexados. Úsala SIEMPRE (una o varias veces, reformulando la búsqueda si hace falta) antes de responder preguntas sobre la historia clínica.
Cada documento y nota tiene "tags": términos médicos (órganos o zonas del cuerpo, procedimientos o tipos de examen, especialidad) y, cuando existe, la fecha del documento en formato AAAA-MM-DD. Puedes filtrar la búsqueda pasando "tags" para acotar a documentos con esos términos (ej. tags ["orina"] para exámenes de orina). Usa la herramienta "list_available_tags" para ver qué tags existen antes de filtrar; si no estás seguro, busca sin filtro.
IMPORTANTE: si filtras por "tags" y la búsqueda no devuelve coincidencias (o no son relevantes), VUELVE A BUSCAR sin el filtro de "tags" antes de concluir que no hay información. Las notas y documentos pueden no tener el tag que esperas; una búsqueda sin filtro abarca todo.
Si después de buscar sin filtro "search_medical_records" sigue sin devolver resultados relevantes, usa "keyword_search" como último recurso: hace una búsqueda literal por palabras exactas (ej. "hijos") y encuentra fragmentos que la búsqueda semántica pasó por alto. Solo concluye que no hay información cuando también "keyword_search" falle.
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
    private readonly notes: NoteRepository,
    // Optional calendar scheduling. When present, the "schedule_appointment"
    // tool is exposed so the patient can book appointments from chat. When null,
    // the tool is not registered (graceful degradation).
    private readonly calendar: CalendarService | null = null,
    // userId → display name, used to attribute appointments in the shared
    // calendar (e.g. "Diego: control cardiología").
    private readonly userNames: Map<number, string> = new Map(),
    // Time zone for interpreting/creating appointments (e.g. "America/Bogota").
    private readonly timeZone: string = "America/Bogota",
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
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Filtro opcional: solo fragmentos cuyo documento tenga alguno de estos tags " +
              "(ver list_available_tags). Las fechas van en formato AAAA-MM-DD.",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = String(args.query ?? "").trim();
        if (!query) return JSON.stringify({ results: [], note: "Consulta vacía." });

        const topK = Number.isFinite(Number(args.topK)) ? Number(args.topK) : 5;
        const tags = Array.isArray(args.tags)
          ? args.tags.map((t) => String(t).trim().toLowerCase()).filter((t) => t.length > 0)
          : undefined;
        const queryVector = await this.embedder.embedQuery(query);
        const results = await this.vectorIndex.search(queryVector, userId, topK, tags);

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
            tags: r.tags ?? [],
          })),
        });
      },
    };

    const keywordTool: Tool = {
      name: "keyword_search",
      description:
        "Búsqueda literal (no semántica) por palabras exactas en el texto de los documentos y notas. " +
        "Úsala como ÚLTIMO RECURSO cuando search_medical_records no devuelva resultados o no sean relevantes: " +
        "encuentra fragmentos que contienen exactamente las palabras que pasas (ej. \"hijos\", \"alergia penicilina\"). " +
        "Pasa solo las palabras clave relevantes, no la pregunta completa.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Palabras clave literales a buscar en el texto (sin signos de puntuación).",
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
        const results = await this.vectorIndex.searchKeyword(query, userId, topK);

        for (const r of results) {
          if (!cited.has(r.fileName)) cited.set(r.fileName, r.score);
          foundFiles.set(r.fileName, r.fileId);
        }

        if (results.length === 0) {
          return JSON.stringify({ results: [], note: "Sin coincidencias literales." });
        }

        return JSON.stringify({
          results: results.map((r) => ({
            fileName: r.fileName,
            text: r.text,
            tags: r.tags ?? [],
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
            .find((f) => f.originalName.toLowerCase() === target);
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

    const listTagsTool: Tool = {
      name: "list_available_tags",
      description:
        "Lista los tags disponibles del paciente (de sus documentos y notas). " +
        "Úsala para saber por qué términos puedes filtrar en search_medical_records.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const tags = Array.from(
          new Set([...this.repo.listTags(userId), ...this.notes.listTags(userId)]),
        ).sort();
        return JSON.stringify({ tags });
      },
    };

    const tools: Tool[] = [searchTool, keywordTool, sendTool, listTagsTool];

    // Scheduling is optional: only exposed when a CalendarService is wired.
    const userName = this.userNames.get(userId);
    let systemPrompt = SYSTEM_PROMPT;
    if (this.calendar) {
      const calendar = this.calendar;
      const timeZone = this.timeZone;

      const scheduleTool: Tool = {
        name: "schedule_appointment",
        description:
          "Crea una cita en el calendario del paciente. Úsala SOLO cuando el paciente pida " +
          "explícitamente agendar, programar o crear una cita (ej. 'agenda una cita el 12 de julio a las 3pm'). " +
          "No la uses para consultas sobre la historia clínica.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Título breve de la cita (ej. 'Control cardiología', 'Cita odontología').",
            },
            startIso: {
              type: "string",
              description:
                "Fecha y hora de inicio en formato ISO 8601 con zona horaria " +
                "(ej. 2026-07-12T15:00:00-05:00).",
            },
            endIso: {
              type: "string",
              description:
                "Fecha y hora de fin en ISO 8601 (opcional; por defecto una hora después del inicio).",
            },
            description: {
              type: "string",
              description: "Detalle o notas opcionales de la cita.",
            },
          },
          required: ["title", "startIso"],
        },
        execute: async (args) => {
          const title = String(args.title ?? "").trim();
          const startIso = String(args.startIso ?? "").trim();
          if (!title || !startIso) {
            return JSON.stringify({
              scheduled: false,
              note: "Falta el título o la fecha/hora de la cita.",
            });
          }
          const start = new Date(startIso);
          if (Number.isNaN(start.getTime())) {
            return JSON.stringify({ scheduled: false, note: "La fecha u hora no es válida." });
          }
          if (start.getTime() < Date.now()) {
            return JSON.stringify({
              scheduled: false,
              note: "La fecha está en el pasado; pide al paciente una fecha futura.",
            });
          }

          // Default to a 1-hour appointment when no valid end is given.
          let endIso = String(args.endIso ?? "").trim();
          const end = endIso ? new Date(endIso) : null;
          if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
            endIso = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
          }

          const description = String(args.description ?? "").trim() || undefined;
          // Attribute the appointment to the patient in the shared calendar.
          const summary = userName ? `${userName}: ${title}` : title;
          try {
            const { htmlLink } = await calendar.createEvent({
              title: summary,
              description,
              startIso,
              endIso,
              timeZone,
            });
            return JSON.stringify({ scheduled: true, title: summary, startIso, htmlLink });
          } catch (err) {
            console.error("schedule_appointment failed:", err);
            return JSON.stringify({
              scheduled: false,
              note: "No se pudo crear la cita en el calendario.",
            });
          }
        },
      };
      tools.push(scheduleTool);

      // Anchor "today" so the model can resolve relative dates, and give it the
      // rules for building an appointment.
      const nowLocal = new Date().toLocaleString("es-CO", { timeZone });
      systemPrompt +=
        `\n\nAGENDAR CITAS: tienes la herramienta "schedule_appointment" para crear citas en el ` +
        `calendario del paciente. Úsala SOLO cuando el paciente pida explícitamente agendar o ` +
        `programar una cita.\n` +
        `- La fecha y hora actual es ${nowLocal} (zona horaria ${timeZone}). Resuelve fechas ` +
        `relativas ("mañana", "el próximo lunes", "en dos semanas") respecto a esta fecha.\n` +
        `- Convierte la fecha y hora a ISO 8601 con la zona ${timeZone} (ej. 2026-07-12T15:00:00-05:00) ` +
        `y pásala en "startIso".\n` +
        `- Si el paciente NO indica la hora, NO agendes: pregúntale primero a qué hora.\n` +
        `- Si la fecha resultante está en el pasado, no agendes: pídele que confirme una fecha futura.\n` +
        `- Tras agendar con éxito, confirma en una frase la fecha y hora de la cita.\n` +
        `- No uses las herramientas de búsqueda de documentos para agendar: son cosas distintas.`;
    }

    const history = this.sessions.history(userId);
    const answer = await this.llm.answer(systemPrompt, history, question, tools);
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

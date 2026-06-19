import type { Embedder, Llm, Tool, VectorIndex } from "../domain/ports";

const SYSTEM_PROMPT = `Eres un asistente médico amable que responde preguntas sobre los documentos clínicos del paciente.
Tienes una herramienta llamada "search_medical_records" para buscar fragmentos en los documentos indexados.
Úsala SIEMPRE (una o varias veces, reformulando la búsqueda si hace falta) antes de responder.
Responde SOLO con la información que devuelva la herramienta. Si no encuentras la respuesta, di amablemente que no tienes esa información.
Responde en español, con un tono amigable y conversacional, como hablando con un paciente.
NO uses formato markdown (negritas, itálicas, listas con guiones, etc.). Usa texto plano solamente.
Menciona el nombre del archivo de origen de forma natural en la conversación.`;

// Use case: answer a question using retrieval-augmented generation. The vector
// search is exposed to the LLM as a tool, so the model decides when and what to
// retrieve (agentic RAG) instead of a single fixed search.
export class AskQuestion {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly llm: Llm,
  ) {}

  async run(question: string): Promise<string> {
    // Best score seen per source file across all tool invocations.
    const cited = new Map<string, number>();

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
        const results = await this.vectorIndex.search(queryVector, topK);

        for (const r of results) {
          if (!cited.has(r.fileName) || r.score > cited.get(r.fileName)!) {
            cited.set(r.fileName, r.score);
          }
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

    const answer = await this.llm.answer(SYSTEM_PROMPT, question, [searchTool]);

    if (cited.size === 0) return answer;
    return `${answer}\n\n---\nFuentes:\n${this.formatSources(cited)}`;
  }

  private formatSources(cited: Map<string, number>): string {
    return Array.from(cited.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => `- ${name}`)
      .join("\n");
  }
}

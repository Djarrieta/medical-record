import type { Embedder, Llm, VectorIndex } from "../domain/ports";
import type { SearchResult } from "../domain/types";

const PROMPT_TEMPLATE = (context: string, question: string) => `
Eres un asistente médico amable que responde preguntas basado en documentos clínicos.
Usa SOLO el contexto proporcionado para responder. Si no encuentras la respuesta en el contexto, di amablemente que no tienes esa información.
Responde en español, con un tono amigable y conversacional, como hablando con un paciente.
NO uses formato markdown (negritas, itálicas, listas con guiones, etc.). Usa texto plano solamente.
Menciona el nombre del archivo de origen de forma natural en la conversación.

Contexto:
${context}

Pregunta: ${question}

Respuesta:`;

// Use case: answer a question using retrieval-augmented generation over the
// indexed documents.
export class AskQuestion {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectorIndex: VectorIndex,
    private readonly llm: Llm,
  ) {}

  async run(question: string): Promise<string> {
    const queryVector = await this.embedder.embedQuery(question);
    const results = await this.vectorIndex.search(queryVector, 5);

    if (results.length === 0) {
      return "No encontré información relevante en los documentos indexados.";
    }

    const sources = this.formatSources(results);
    const context = results
      .map((r) => `[${(r.score * 100).toFixed(1)}%] (${r.fileName}) ${r.text}`)
      .join("\n\n");

    const answer = await this.llm.complete(PROMPT_TEMPLATE(context, question));
    return `${answer}\n\n---\nFuentes:\n${sources}`;
  }

  private formatSources(results: SearchResult[]): string {
    const best = new Map<string, number>();
    for (const r of results) {
      if (!best.has(r.fileName) || r.score > best.get(r.fileName)!) {
        best.set(r.fileName, r.score);
      }
    }
    return Array.from(best.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => `- ${name}`)
      .join("\n");
  }
}

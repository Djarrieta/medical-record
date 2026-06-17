import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { EmbeddingProvider } from "./embedding";
import type { QdrantStore } from "./vectorStore";
import type { ChatOpenAI } from "@langchain/openai";

const PROMPT_TEMPLATE = `
Eres un asistente médico que responde preguntas basado en documentos clínicos.
Usa SOLO el contexto proporcionado para responder. Si no encuentras la respuesta en el contexto, di que no tienes esa información.
Menciona siempre el nombre del archivo de origen al final de tu respuesta.

Contexto:
{context}

Pregunta: {question}

Responde de manera clara y concisa en español:`;

export class RagService {
  private llm: ChatOpenAI;
  private embedder: EmbeddingProvider;
  private store: QdrantStore;

  constructor(
    llm: ChatOpenAI,
    embedder: EmbeddingProvider,
    store: QdrantStore,
  ) {
    this.llm = llm;
    this.embedder = embedder;
    this.store = store;
  }

  async answer(question: string): Promise<string> {
    const queryVector = await this.embedder.embedQuery(question);
    const results = await this.store.search(queryVector, 5);

    if (results.length === 0) {
      return "No encontré información relevante en los documentos indexados.";
    }

    const docs = results.map(
      (r) =>
        new Document({
          pageContent: r.text,
          metadata: {
            fileId: r.fileId,
            fileName: r.fileName,
            score: r.score,
          },
        }),
    );

    const sourceMap = new Map<string, { fileId: string; score: number }>();
    for (const d of docs) {
      const key = d.metadata.fileName as string;
      if (!sourceMap.has(key) || (d.metadata.score as number) > sourceMap.get(key)!.score) {
        sourceMap.set(key, { fileId: d.metadata.fileId as string, score: d.metadata.score as number });
      }
    }

    const sources = Array.from(sourceMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .map(([name]) => `📄 ${name}`)
      .join("\n");

    const context = docs
      .map((d) => `[${(d.metadata.score as number * 100).toFixed(1)}%] (${d.metadata.fileName}) ${d.pageContent}`)
      .join("\n\n");

    const prompt = ChatPromptTemplate.fromTemplate(PROMPT_TEMPLATE);
    const chain = prompt.pipe(this.llm);
    const response = await chain.invoke({ context, question });

    return `${response.text}\n\n---\n**Fuentes:**\n${sources}`;
  }
}
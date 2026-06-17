import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { EmbeddingProvider } from "./embedding";
import type { QdrantStore } from "./vectorStore";
import type { ChatOpenAI } from "@langchain/openai";

const PROMPT_TEMPLATE = `
Eres un asistente médico que responde preguntas basado en documentos clínicos.
Usa SOLO el contexto proporcionado para responder. Si no encuentras la respuesta en el contexto, di que no tienes esa información.

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

    const context = results
      .map((r) => `[${(r.score * 100).toFixed(1)}%] ${r.text}`)
      .join("\n\n");

    const prompt = ChatPromptTemplate.fromTemplate(PROMPT_TEMPLATE);
    const chain = prompt.pipe(this.llm);
    const response = await chain.invoke({ context, question });

    return response.text;
  }
}

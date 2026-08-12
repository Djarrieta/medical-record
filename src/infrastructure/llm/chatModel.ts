import { ChatOpenAI } from "@langchain/openai";

import type { BotConfig } from "../config";

export function createChatModel(config: BotConfig): ChatOpenAI {
  if (!config.llmApiKey) {
    throw new Error("LLM_API_KEY is required to initialize an LLM");
  }

  return new ChatOpenAI({
    model: config.llmModel,
    temperature: 0.2,
    apiKey: config.llmApiKey,
    configuration: { baseURL: config.llmBaseUrl },
  });
}
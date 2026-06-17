import { ChatOpenAI } from "@langchain/openai";
import type { BotConfig } from "./types";

export class LlmProvider {
  private static instance: ChatOpenAI | null = null;

  static getInstance(config: BotConfig): ChatOpenAI {
    if (!this.instance) {
      if (!config.deepseekApiKey) {
        throw new Error("DEEPSEEK_API_KEY is required to initialize LlmProvider");
      }

      this.instance = new ChatOpenAI({
        model: config.deepseekModel,
        temperature: 0.2,
        apiKey: config.deepseekApiKey,
        configuration: {
          baseURL: config.deepseekBaseUrl,
        },
      });
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
  }
}

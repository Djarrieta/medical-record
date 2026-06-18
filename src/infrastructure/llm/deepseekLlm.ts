import { ChatOpenAI } from "@langchain/openai";
import type { Llm } from "../../domain/ports";
import type { BotConfig } from "../config";

export class DeepseekLlm implements Llm {
  private readonly model: ChatOpenAI;

  constructor(config: BotConfig) {
    if (!config.deepseekApiKey) {
      throw new Error("DEEPSEEK_API_KEY is required to initialize DeepseekLlm");
    }
    this.model = new ChatOpenAI({
      model: config.deepseekModel,
      temperature: 0.2,
      apiKey: config.deepseekApiKey,
      configuration: {
        baseURL: config.deepseekBaseUrl,
      },
    });
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.model.invoke(prompt);
    return response.text;
  }
}

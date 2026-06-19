import { type BaseMessage, AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import type { Llm, Tool } from "../../domain/ports";
import type { ConversationMessage } from "../../domain/types";
import type { BotConfig } from "../config";

// Safety cap on the agentic loop so a misbehaving model can't spin forever.
const MAX_STEPS = 8;

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

  async answer(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    tools: Tool[],
  ): Promise<string> {
    const handlers = new Map(tools.map((t) => [t.name, t]));
    const model = tools.length
      ? this.model.bindTools(
          tools.map((t) => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        )
      : this.model;

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history.map((m) =>
        m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
      ),
      new HumanMessage(userMessage),
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await model.invoke(messages);
      messages.push(response);

      if (!response.tool_calls?.length) {
        return response.text;
      }

      for (const call of response.tool_calls) {
        let result: string;
        const tool = handlers.get(call.name);
        if (!tool) {
          result = JSON.stringify({ error: `Unknown tool: ${call.name}` });
        } else {
          try {
            result = await tool.execute(call.args as Record<string, unknown>);
          } catch (err) {
            result = JSON.stringify({ error: (err as Error).message });
          }
        }
        messages.push(new ToolMessage({ content: result, tool_call_id: call.id! }));
      }
    }

    // Loop budget exhausted: force a final answer without further tool calls.
    const final = await this.model.invoke(messages);
    return final.text;
  }
}

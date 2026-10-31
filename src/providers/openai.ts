import { LLMProvider, ChatMessage, ChatCompletionOptions } from "./types.js";

export interface OpenAIProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  timeoutMs?: number;
}

export class OpenAIProvider implements LLMProvider {
  public readonly name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private timeoutMs: number;

  constructor(config?: OpenAIProviderConfig) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || "dummy-key";
    this.baseUrl = (
      config?.baseUrl ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
    this.model = config?.model || process.env.OPENAI_MODEL || "gpt-3.5-turbo";
    this.embeddingModel =
      config?.embeddingModel || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
    this.timeoutMs = config?.timeoutMs || 10000;
  }

  async generateText(prompt: string, options?: ChatCompletionOptions): Promise<string> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.2,
          max_tokens: options?.maxTokens ?? 512,
          ...(options?.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error [${response.status}]: ${errorText}`);
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Invalid response format from OpenAI API: missing message content");
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Embeddings API error [${response.status}]: ${errorText}`);
      }

      const data = (await response.json()) as any;
      const embedding = data.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid response format from OpenAI Embeddings: missing vector");
      }
      return embedding;
    } finally {
      clearTimeout(timeout);
    }
  }
}

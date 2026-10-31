import { LLMProvider, ChatMessage, ChatCompletionOptions } from "./types.js";

export interface OllamaProviderConfig {
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  timeoutMs?: number;
}

export class OllamaProvider implements LLMProvider {
  public readonly name = "ollama";
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private timeoutMs: number;

  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = (
      config?.baseUrl ||
      process.env.OLLAMA_BASE_URL ||
      "http://localhost:11434"
    ).replace(/\/+$/, "");
    this.model = config?.model || process.env.OLLAMA_MODEL || "llama3";
    this.embeddingModel =
      config?.embeddingModel || process.env.OLLAMA_EMBEDDING_MODEL || "all-minilm";
    this.timeoutMs = config?.timeoutMs || 10000;
  }

  async generateText(prompt: string, options?: ChatCompletionOptions): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: options?.jsonMode ? "json" : undefined,
          options: {
            temperature: options?.temperature ?? 0.2,
            num_predict: options?.maxTokens ?? 512,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error [${response.status}]: ${errorText}`);
      }

      const data = (await response.json()) as any;
      if (typeof data.response !== "string") {
        throw new Error("Invalid response format from Ollama generate API");
      }
      return data.response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          format: options?.jsonMode ? "json" : undefined,
          options: {
            temperature: options?.temperature ?? 0.2,
            num_predict: options?.maxTokens ?? 512,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama chat API error [${response.status}]: ${errorText}`);
      }

      const data = (await response.json()) as any;
      const content = data.message?.content;
      if (typeof content !== "string") {
        throw new Error("Invalid response format from Ollama chat API");
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
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama embeddings API error [${response.status}]: ${errorText}`);
      }

      const data = (await response.json()) as any;
      if (!Array.isArray(data.embedding)) {
        throw new Error("Invalid response format from Ollama embeddings API");
      }
      return data.embedding;
    } finally {
      clearTimeout(timeout);
    }
  }
}

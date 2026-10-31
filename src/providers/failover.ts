import { LLMProvider, ChatMessage, ChatCompletionOptions } from "./types.js";

export interface FailoverProviderOptions {
  providers: LLMProvider[];
  timeoutMs?: number;
  onProviderFailed?: (providerName: string, error: unknown) => void;
}

export class FailoverProvider implements LLMProvider {
  public readonly name = "failover";
  private providers: LLMProvider[];
  private timeoutMs: number;
  private onProviderFailed?: (providerName: string, error: unknown) => void;

  constructor(options: FailoverProviderOptions) {
    if (!options.providers || options.providers.length === 0) {
      throw new Error("FailoverProvider requires at least one underlying LLMProvider");
    }
    this.providers = options.providers;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.onProviderFailed = options.onProviderFailed;
  }

  get underlyingProviders(): LLMProvider[] {
    return [...this.providers];
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    providerName: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Provider [${providerName}] timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      fn()
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  }

  async generateText(prompt: string, options?: ChatCompletionOptions): Promise<string> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const provider of this.providers) {
      try {
        return await this.executeWithTimeout(
          () => provider.generateText(prompt, options),
          this.timeoutMs,
          provider.name
        );
      } catch (err) {
        errors.push({ provider: provider.name, error: err });
        this.onProviderFailed?.(provider.name, err);
      }
    }

    const messages = errors
      .map((e) => `[${e.provider}]: ${(e.error as Error)?.message || e.error}`)
      .join("; ");
    throw new Error(`All LLM providers failed in failover chain: ${messages}`);
  }

  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const provider of this.providers) {
      try {
        return await this.executeWithTimeout(
          () => provider.chat(messages, options),
          this.timeoutMs,
          provider.name
        );
      } catch (err) {
        errors.push({ provider: provider.name, error: err });
        this.onProviderFailed?.(provider.name, err);
      }
    }

    const errorDetails = errors
      .map((e) => `[${e.provider}]: ${(e.error as Error)?.message || e.error}`)
      .join("; ");
    throw new Error(`All LLM providers failed in failover chain: ${errorDetails}`);
  }

  async embed(text: string): Promise<number[]> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const provider of this.providers) {
      try {
        return await this.executeWithTimeout(
          () => provider.embed(text),
          this.timeoutMs,
          provider.name
        );
      } catch (err) {
        errors.push({ provider: provider.name, error: err });
        this.onProviderFailed?.(provider.name, err);
      }
    }

    const errorDetails = errors
      .map((e) => `[${e.provider}]: ${(e.error as Error)?.message || e.error}`)
      .join("; ");
    throw new Error(`All embedding providers failed in failover chain: ${errorDetails}`);
  }
}

import { LLMProvider } from "./types.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";
import { FailoverProvider } from "./failover.js";

export function createProviderFromConfig(): LLMProvider {
  const primaryName = (process.env.PRIMARY_LLM_PROVIDER || "mock").toLowerCase();
  const fallbackNames = (process.env.FALLBACK_LLM_PROVIDERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const timeoutMs = parseInt(process.env.PROVIDER_TIMEOUT_MS || "5000", 10);

  const providerFactory = (name: string): LLMProvider => {
    switch (name) {
      case "openai":
        return new OpenAIProvider();
      case "ollama":
        return new OllamaProvider();
      case "mock":
      default:
        return new MockProvider();
    }
  };

  const providersToChain: LLMProvider[] = [providerFactory(primaryName)];

  for (const name of fallbackNames) {
    if (name !== primaryName) {
      providersToChain.push(providerFactory(name));
    }
  }

  if (providersToChain.length === 1) {
    return providersToChain[0];
  }

  return new FailoverProvider({
    providers: providersToChain,
    timeoutMs,
    onProviderFailed: (pName, err) => {
      console.warn(
        `[FailoverProvider] Provider ${pName} failed, failing over. Error:`,
        (err as Error)?.message || err
      );
    },
  });
}

export * from "./types.js";
export * from "./mock.js";
export * from "./openai.js";
export * from "./ollama.js";
export * from "./failover.js";

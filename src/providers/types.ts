import crypto from "crypto";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  generateText(prompt: string, options?: ChatCompletionOptions): Promise<string>;
  chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
  embed(text: string): Promise<number[]>;
}

/**
 * Generates a deterministic normalized embedding vector of the specified dimension
 * based on input text, without requiring external network calls or secrets.
 */
export function generateDeterministicEmbedding(text: string, dimensions = 384): number[] {
  const normalized = text.toLowerCase().trim();
  const vector: number[] = new Array(dimensions).fill(0);

  // Distribute n-grams and tokens across dimensions
  const words = normalized.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hash = crypto.createHash("sha256").update(word).digest();
    for (let j = 0; j < 32; j++) {
      const idx = (hash[j] + i * 17) % dimensions;
      vector[idx] += ((hash[j] % 50) - 25) / 25;
    }
  }

  // Also factor in full text hash
  const fullHash = crypto.createHash("sha256").update(normalized).digest();
  for (let i = 0; i < dimensions; i++) {
    const byte = fullHash[i % 32];
    vector[i] += (byte / 255) * 0.1;
  }

  // Normalize vector to unit length (L2 norm) for cosine distance
  let norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) norm = 1;
  return vector.map((v) => Number((v / norm).toFixed(6)));
}

import { z } from "zod";
import { LLMProvider } from "../providers/types.js";
import { MemoryService } from "./memory.js";
import { ScoredMemory } from "./rrf.js";

export const AnswerOutputSchema = z.object({
  answer: z.string().min(1, "Answer cannot be empty"),
  confidence: z.number().min(0).max(1),
  citations: z.array(z.string()).default([]),
  summary: z.string().optional(),
});

export type AnswerOutput = z.infer<typeof AnswerOutputSchema>;

export interface GenerateAnswerRequest {
  query: string;
  topK?: number;
  metadataFilter?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface GenerateAnswerResponse {
  result: AnswerOutput;
  context: ScoredMemory[];
  retried: boolean;
}

export class AnswerService {
  constructor(
    private memoryService: MemoryService,
    private provider: LLMProvider
  ) {}

  buildPrompt(query: string, contexts: ScoredMemory[], errorMessage?: string): string {
    const contextText =
      contexts.length > 0
        ? contexts.map((c, i) => `[Source ${i + 1} | ID: ${c.id}]\n${c.text}`).join("\n\n")
        : "No contextual memories retrieved.";

    let base = `You are a factual knowledge assistant. Your goal is to answer the user query accurately based on provided memory context.
You MUST output ONLY a valid JSON object matching this schema:
{
  "answer": "Clear, grounded answer to the query",
  "confidence": 0.0 to 1.0,
  "citations": ["id1", "id2"],
  "summary": "Brief 1-sentence recap"
}

Context:
${contextText}

User Query:
${query}
`;

    if (errorMessage) {
      base += `\nCRITICAL FIX REQUIRED: Your previous output failed JSON/Schema validation with error: ${errorMessage}.
Ensure you return strictly JSON with no enclosing markdown fences, no explanatory text, and valid property types.`;
    }

    return base;
  }

  async answer(request: GenerateAnswerRequest): Promise<GenerateAnswerResponse> {
    const { query, topK = 3, metadataFilter } = request;

    // 1. Retrieve hybrid context
    const context = await this.memoryService.hybridQuery({
      query,
      topK,
      metadataFilter,
    });

    // 2. Generate response using LLM
    const initialPrompt = this.buildPrompt(query, context);
    let rawOutput = await this.provider.generateText(initialPrompt, { jsonMode: true });

    let parsedJson: unknown;

    try {
      parsedJson = this.extractAndParseJson(rawOutput);
      const validated = AnswerOutputSchema.parse(parsedJson);
      return {
        result: validated,
        context,
        retried: false,
      };
    } catch (firstError) {
      // Retry once with error feedback
      const errorMsg = (firstError as Error).message;
      const retryPrompt = this.buildPrompt(query, context, errorMsg);

      rawOutput = await this.provider.generateText(retryPrompt, { jsonMode: true });
      try {
        parsedJson = this.extractAndParseJson(rawOutput);
        const validated = AnswerOutputSchema.parse(parsedJson);
        return {
          result: validated,
          context,
          retried: true,
        };
      } catch (retryError) {
        throw new Error(
          `Failed to obtain valid structured answer after retry. LLM Output: "${rawOutput.slice(0, 150)}". Schema Error: ${(retryError as Error).message}`
        );
      }
    }
  }

  private extractAndParseJson(text: string): unknown {
    const trimmed = text.trim();
    // Strip markdown fences ```json ... ``` or ``` ... ```
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

    // If still surrounded by braces or has JSON substring
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.substring(firstBrace, lastBrace + 1));
    }

    return JSON.parse(candidate);
  }
}

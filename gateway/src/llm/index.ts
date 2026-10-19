import type { LlmProvider } from "./types.js";
import { MockLlmProvider } from "./mockProvider.js";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider.js";

export * from "./types.js";
export * from "./mockProvider.js";
export * from "./openAiCompatibleProvider.js";

export function createLlmProvider(env: Record<string, string | undefined>): LlmProvider {
  const providerType = env["LLM_PROVIDER"] ?? "mock";

  if (providerType === "mock") {
    return new MockLlmProvider();
  }

  if (providerType === "openai-compatible") {
    const baseUrl = env["LLM_BASE_URL"];
    const model = env["LLM_MODEL"];
    const apiKey = env["LLM_API_KEY"];

    if (!baseUrl) {
      throw new Error("Missing environment variable: LLM_BASE_URL");
    }
    if (!model) {
      throw new Error("Missing environment variable: LLM_MODEL");
    }
    if (!apiKey) {
      throw new Error("Missing environment variable: LLM_API_KEY");
    }

    return new OpenAiCompatibleProvider({ baseUrl, model, apiKey });
  }

  throw new Error(`Unsupported LLM_PROVIDER value: ${providerType}`);
}

import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";
import { LlmError } from "./types.js";

interface OpenAiCompatibleProviderOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible";
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private defaultTimeoutMs: number;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10000;
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const url = this.baseUrl.replace(/\/+$/, "") + "/chat/completions";

    const body = {
      model: this.model,
      messages: req.messages,
      temperature: 0.2
    };

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        // Sanitize message to not include apiKey
        let text = await res.text();
        if (text.includes(this.apiKey)) {
          text = text.split(this.apiKey).join("[REDACTED]");
        }
        throw new LlmError("PROVIDER_ERROR", `HTTP error ${res.status}: ${text}`);
      }

      const json = await res.json();

      if (!json.choices || !Array.isArray(json.choices) || json.choices.length === 0) {
        throw new LlmError("INVALID_RESPONSE", "Missing choices in response");
      }

      const message = json.choices[0].message;
      if (!message || typeof message.content !== "string") {
        throw new LlmError("INVALID_RESPONSE", "Missing message content in choices[0]");
      }

      let text: string = message.content;
      let insufficientContext = false;
      const token = "[INSUFFICIENT_CONTEXT]";
      if (text.trimStart().startsWith(token)) {
        insufficientContext = true;
        text = text.trimStart().slice(token.length).trimStart();
      }

      return { text, insufficientContext };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof LlmError) {
        throw err;
      }
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new LlmError("TIMEOUT", "Request timed out");
        }
        throw new LlmError("PROVIDER_ERROR", err.message);
      }
      throw new LlmError("PROVIDER_ERROR", "Unknown error");
    }
  }
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  insufficientContext: boolean;
}

export interface LlmProvider {
  readonly name: string;
  generate(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  code: "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_RESPONSE";

  constructor(code: "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_RESPONSE", message: string) {
    super(message);
    this.code = code;
    this.name = "LlmError";
  }
}

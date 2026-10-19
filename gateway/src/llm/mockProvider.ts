import type { LlmProvider, LlmRequest, LlmResponse, LlmError } from "./types.js";

interface MockLlmProviderOptions {
  responses?: LlmResponse[];
  failWith?: LlmError;
  delayMs?: number;
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  private responses: LlmResponse[];
  private failWith?: LlmError;
  private delayMs: number;
  private callCount = 0;
  public readonly calls: LlmRequest[] = [];

  constructor(options: MockLlmProviderOptions = {}) {
    this.responses = options.responses ?? [];
    this.failWith = options.failWith;
    this.delayMs = options.delayMs ?? 0;
  }

  async generate(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);

    if (this.failWith) {
      return Promise.reject(this.failWith);
    }

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    let response: LlmResponse;
    if (this.responses.length === 0) {
      response = { text: "", insufficientContext: true };
    } else if (this.callCount < this.responses.length) {
      response = this.responses[this.callCount];
    } else {
      response = this.responses[this.responses.length - 1];
    }

    this.callCount++;
    return response;
  }
}

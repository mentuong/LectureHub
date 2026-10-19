import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "../src/llm/types.js";
import {
  LlmError,
  MockLlmProvider,
  OpenAiCompatibleProvider,
  createLlmProvider
} from "../src/llm/index.js";

// Helper fake fetch for openai-compatible tests
const createFakeFetch = (handler: typeof fetch): typeof fetch => {
  return async (input, init) => {
    return handler(input, init);
  };
};

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

// 3a. Mock returns responses in order and loops last; records calls
test("MockLlmProvider returns responses in order and loops last, records calls", async () => {
  const responses = [
    { text: "resp1", insufficientContext: false },
    { text: "resp2", insufficientContext: true }
  ];
  const provider = new MockLlmProvider({ responses });

  const req1: { messages: ChatMessage[] } = { messages: [{ role: "user", content: "hi" }] };
  const r1 = await provider.generate(req1);
  assert.deepEqual(r1, responses[0]);

  const req2: { messages: ChatMessage[] } = { messages: [{ role: "user", content: "hello" }] };
  const r2 = await provider.generate(req2);
  assert.deepEqual(r2, responses[1]);

  // Third call loops last response
  const req3: { messages: ChatMessage[] } = { messages: [{ role: "user", content: "again" }] };
  const r3 = await provider.generate(req3);
  assert.deepEqual(r3, responses[1]);

  // Calls recorded
  assert.strictEqual(provider.calls.length, 3);
  assert.strictEqual(provider.calls[0], req1);
  assert.strictEqual(provider.calls[1], req2);
  assert.strictEqual(provider.calls[2], req3);
});

// 3b. Mock failWith rejects with given error
test("MockLlmProvider failWith rejects with given error", async () => {
  const err = new LlmError("PROVIDER_ERROR", "fail");
  const provider = new MockLlmProvider({ failWith: err });
  await assert.rejects(() => provider.generate({ messages: [] }), (e) => {
    assert(e instanceof LlmError);
    assert.strictEqual(e.code, "PROVIDER_ERROR");
    assert.strictEqual(e.message, "fail");
    return true;
  });
});

// 3c. OpenAiCompatibleProvider sends correct request
test("OpenAiCompatibleProvider sends correct request", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    capturedUrl = urlOf(input);
    capturedInit = init;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.example.com",
    model: "test-model",
    apiKey: "secret-key",
    fetchImpl: fakeFetch
  });

  const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
  const res = await provider.generate({ messages });

  assert.strictEqual(capturedUrl, "https://api.example.com/chat/completions");
  assert(capturedInit);
  assert.strictEqual(capturedInit?.method, "POST");
  assert.strictEqual(res.text, "ok");
});

// 3d. OpenAiCompatibleProvider handles HTTP error with sanitized message
test("OpenAiCompatibleProvider handles HTTP error with sanitized message", async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response("Error secret-key", { status: 401, headers: { "Content-Type": "text/plain" } });
  };

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.example.com",
    model: "test-model",
    apiKey: "secret-key",
    fetchImpl: fakeFetch
  });

  await assert.rejects(() => provider.generate({ messages: [] }), (e) => {
    assert(e instanceof LlmError);
    assert.strictEqual(e.code, "PROVIDER_ERROR");
    assert(!e.message.includes("secret-key"));
    return true;
  });
});

// 3e. OpenAiCompatibleProvider handles invalid response structure
test("OpenAiCompatibleProvider handles invalid response structure", async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.example.com",
    model: "test-model",
    apiKey: "secret-key",
    fetchImpl: fakeFetch
  });

  await assert.rejects(() => provider.generate({ messages: [] }), (e) => {
    assert(e instanceof LlmError);
    assert.strictEqual(e.code, "INVALID_RESPONSE");
    return true;
  });
});

// 3f. OpenAiCompatibleProvider handles timeout
test("OpenAiCompatibleProvider handles timeout", async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  };

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.example.com",
    model: "test-model",
    apiKey: "secret-key",
    fetchImpl: fakeFetch,
    defaultTimeoutMs: 10
  });

  await assert.rejects(() => provider.generate({ messages: [] }), (e) => {
    assert(e instanceof LlmError);
    assert.strictEqual(e.code, "TIMEOUT");
    return true;
  });
});

// 3g. createLlmProvider returns correct provider instances
test("createLlmProvider returns correct provider instances", () => {
  const mockProvider = createLlmProvider({ LLM_PROVIDER: "mock" });
  assert.strictEqual(mockProvider.name, "mock");

  const openaiProvider = createLlmProvider({
    LLM_PROVIDER: "openai-compatible",
    LLM_BASE_URL: "https://api.example.com",
    LLM_MODEL: "model",
    LLM_API_KEY: "key"
  });
  assert.strictEqual(openaiProvider.name, "openai-compatible");

  assert.throws(() => createLlmProvider({ LLM_PROVIDER: "unknown" }));
});

// 3h. OpenAiCompatibleProvider trims [INSUFFICIENT_CONTEXT] token
test("OpenAiCompatibleProvider trims [INSUFFICIENT_CONTEXT] token", async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "[INSUFFICIENT_CONTEXT] actual text" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://api.example.com",
    model: "test-model",
    apiKey: "secret-key",
    fetchImpl: fakeFetch
  });

  const res = await provider.generate({ messages: [{ role: "user", content: "hello" }] });
  assert.strictEqual(res.insufficientContext, true);
  assert.strictEqual(res.text, "actual text");
});

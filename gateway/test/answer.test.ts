import test from "node:test";
import assert from "node:assert/strict";
import { MockLlmProvider } from "../src/llm/mockProvider.js";
import { createMemoryStore } from "../src/store/memoryStore.js";
import { Retriever } from "../src/retrieval/retriever.js";
import {
  answerQuestion,
  UNKNOWN_ANSWER,
  FALLBACK_ANSWER,
  extractAllowedPrices,
  extractMentionedPrices,
  buildMessages
} from "../src/answer/answerService.js";
import type { ChatMessage } from "../src/llm/types.js";
import type { LlmResponse } from "../src/llm/types.js";
import { LlmError } from "../src/llm/types.js";
import type { RetrievedDoc } from "../src/retrieval/retriever.js";

// Helper to create store with 2 products and 2 faqs
async function setupStore() {
  const store = createMemoryStore();
  await store.products.upsertMany([
    {
      sku: "sku1",
      name: "Áo thun đỏ",
      description: "Cotton 100%",
      price: 150000,
      currency: "VND",
      category: null,
      isActive: true
    },
    {
      sku: "sku2",
      name: "Quần jean xanh",
      description: "Denim",
      price: 300000,
      currency: "VND",
      category: null,
      isActive: true
    }
  ]);
  await store.faqs.upsertMany([
    {
      faqId: "faq1",
      question: "Chính sách đổi trả",
      answer: "Bạn có thể đổi trả trong vòng 7 ngày.",
      category: null
    },
    {
      faqId: "faq2",
      question: "Phương thức thanh toán",
      answer: "Chúng tôi chấp nhận thẻ tín dụng và chuyển khoản.",
      category: null
    }
  ]);
  return store;
}

// Helper to create retriever from store
async function createRetriever(store: Awaited<ReturnType<typeof setupStore>>) {
  return Retriever.fromStore(store);
}

// Helper to create mock LLM provider with responses or error
function createMockLlm(responses?: LlmResponse[], failWith?: LlmError) {
  return new MockLlmProvider({ responses, failWith });
}

// Test a. câu hỏi không liên quan → unknown NO_RETRIEVAL, llm.calls.length === 0.
test("answerQuestion returns unknown NO_RETRIEVAL and no LLM call when no docs", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm();
  const deps = { retriever, llm, threshold: 0.5 };

  const result = await answerQuestion(deps, "Câu hỏi không liên quan");
  assert.equal(result.kind, "unknown");
  assert.equal(result.reason, "NO_RETRIEVAL");
  assert.equal(result.text, UNKNOWN_ANSWER);
  assert.equal(result.sources.length, 0);
  assert.equal(result.handoffSuggested, true);
  assert.equal(llm.calls.length, 0);
});

// Test b. "giá áo thun đỏ" + mock trả "Áo thun đỏ giá 150.000đ" → answer, sources chứa { type: "product", sku } đúng, handoffSuggested false.
test("answerQuestion returns answer with correct price and sources", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm([
    {
      text: "Áo thun đỏ giá 150.000đ",
      insufficientContext: false
    }
  ]);
  const deps = { retriever, llm, threshold: 0.5 };

  const result = await answerQuestion(deps, "giá áo thun đỏ");
  assert.equal(result.kind, "answer");
  assert.equal(result.handoffSuggested, false);
  assert(result.text.includes("150.000"));
  assert(result.sources.some(s => s.type === "product" && s.sku === "sku1"));
});

// Test c. mock trả giá sai "Áo thun đỏ giá 99.000đ" → unknown PRICE_MISMATCH.
test("answerQuestion returns unknown PRICE_MISMATCH when price not allowed", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm([
    {
      text: "Áo thun đỏ giá 99.000đ",
      insufficientContext: false
    }
  ]);
  const deps = { retriever, llm, threshold: 0.5 };

  const result = await answerQuestion(deps, "giá áo thun đỏ");
  assert.equal(result.kind, "unknown");
  assert.equal(result.reason, "PRICE_MISMATCH");
  assert.equal(result.handoffSuggested, true);
  assert(result.sources.some(s => s.type === "product" && s.sku === "sku1"));
});

// Test d. câu hỏi FAQ "chính sách đổi trả" + mock trả câu trả lời → sources chứa { type: "faq", faqId }.
test("answerQuestion returns answer with faq source", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm([
    {
      text: "Chính sách đổi trả là bạn có thể đổi trả trong vòng 7 ngày.",
      insufficientContext: false
    }
  ]);
  const deps = { retriever, llm, threshold: 0.5 };

  const question = "chính sách đổi trả";
  const result = await answerQuestion(deps, question);
  assert.equal(result.kind, "answer");
  assert(result.sources.some(s => s.type === "faq" && s.faqId === "faq1"));
});

// Test e. mock insufficientContext true → unknown INSUFFICIENT_CONTEXT; mock text "   " → EMPTY_RESPONSE.
test("answerQuestion returns unknown INSUFFICIENT_CONTEXT when LLM insufficientContext true", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm([
    {
      text: "Bla bla",
      insufficientContext: true
    }
  ]);
  const deps = { retriever, llm, threshold: 0.5 };

  const result = await answerQuestion(deps, "giá áo thun đỏ");
  assert.equal(result.kind, "unknown");
  assert.equal(result.reason, "INSUFFICIENT_CONTEXT");
  assert.equal(result.handoffSuggested, true);
});

test("answerQuestion returns unknown EMPTY_RESPONSE when LLM text empty after trim", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm([
    {
      text: "   ",
      insufficientContext: false
    }
  ]);
  const deps = { retriever, llm, threshold: 0.5 };

  const result = await answerQuestion(deps, "giá áo thun đỏ");
  assert.equal(result.kind, "unknown");
  assert.equal(result.reason, "EMPTY_RESPONSE");
  assert.equal(result.handoffSuggested, true);
});

// Test f. mock failWith new LlmError("TIMEOUT", "t") → fallback LLM_ERROR, handoffSuggested true.
test("answerQuestion returns fallback LLM_ERROR on LLM error", async () => {
  const store = await setupStore();
  const retriever = await createRetriever(store);
  const llm = createMockLlm(undefined, new LlmError("TIMEOUT", "t"));
  const deps = { retriever, llm, threshold: 0.5 };

  const result = await answerQuestion(deps, "giá áo thun đỏ");
  assert.equal(result.kind, "fallback");
  assert.equal(result.reason, "LLM_ERROR");
  assert.equal(result.handoffSuggested, true);
  assert.equal(result.text, FALLBACK_ANSWER);
});

// Test g. buildMessages: tin đầu role system chứa "[SKU:" và "[INSUFFICIENT_CONTEXT]"; history 10 tin → chỉ giữ 6 tin cuối; tin cuối là role user với câu hỏi đã trim.
test("buildMessages formats system message and trims history", () => {
  const docs: RetrievedDoc[] = [
    {
      source: { type: "product", sku: "sku1" },
      title: "Áo thun đỏ",
      text: "Áo thun đỏ – giá 150000 VND Cotton 100%",
      score: 1,
      rawScore: 1
    },
    {
      source: { type: "faq", faqId: "faq1" },
      title: "Chính sách đổi trả",
      text: "Bạn có thể đổi trả trong vòng 7 ngày.",
      score: 0.9,
      rawScore: 0.9
    }
  ];

  // Create 10 history messages alternating user/assistant
  const history: ChatMessage[] = [];
  for (let i = 0; i < 10; i++) {
    history.push({ role: i % 2 === 0 ? "user" : "assistant", content: `msg${i}` });
  }

  const question = "  Giá áo thun đỏ là bao nhiêu?  ";
  const messages = buildMessages(question, docs, history);

  // First message role system
  assert.equal(messages[0].role, "system");
  assert(messages[0].content.includes("[SKU:sku1]"));
  assert(messages[0].content.includes("[FAQ:faq1]"));
  assert.ok(messages[0].content.includes("[INSUFFICIENT_CONTEXT]"));

  // Only last 6 history messages included
  const historyMessages = messages.slice(1, -1);
  assert.equal(historyMessages.length, 6);
  // They should be the last 6 from original history
  for (let i = 0; i < 6; i++) {
    assert.equal(historyMessages[i].content, `msg${4 + i}`);
  }

  // Last message is user with trimmed question
  const last = messages[messages.length - 1];
  assert.equal(last.role, "user");
  assert.equal(last.content, question.trim());
});

// Additional tests for extractAllowedPrices and extractMentionedPrices

test("extractAllowedPrices extracts prices from product docs", () => {
  const docs: RetrievedDoc[] = [
    {
      source: { type: "product", sku: "sku1" },
      title: "Áo thun đỏ",
      text: "Áo thun đỏ – giá 150000 VND Cotton 100%",
      score: 1,
      rawScore: 1
    },
    {
      source: { type: "product", sku: "sku2" },
      title: "Quần jean",
      text: "Quần jean – giá 300000 đồng",
      score: 1,
      rawScore: 1
    },
    {
      source: { type: "faq", faqId: "faq1" },
      title: "FAQ",
      text: "Không có giá",
      score: 1,
      rawScore: 1
    }
  ];
  const prices = extractAllowedPrices(docs);
  assert(prices.has("150000"));
  assert(prices.has("300000"));
  assert(!prices.has("100000"));
});

test("extractMentionedPrices extracts prices from text", () => {
  const text = "Áo thun đỏ giá 150.000đ, quần jean giá 300,000 đồng, giày 200000 VND.";
  const prices = extractMentionedPrices(text);
  assert.deepEqual(prices, ["150000", "300000", "200000"]);
});

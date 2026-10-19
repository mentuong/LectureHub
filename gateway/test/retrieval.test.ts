import test from "node:test";
import assert from "node:assert/strict";
import { normalize, tokenize, STOPWORDS } from "../src/retrieval/text.js";
import { Retriever, parseThreshold } from "../src/retrieval/retriever.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

// Helpers
function createProduct(sku: string, name: string, description: string | null, price: number, currency: string, category: string | null, isActive: boolean) {
  return { sku, name, description, price, currency, category, isActive };
}

function createFaq(faqId: string, question: string, answer: string, category: string | null) {
  return { faqId, question, answer, category };
}

// Tests

test("normalize and tokenize basic", () => {
  const input = "Giá ÁO Thun đỏ?";
  const expectedTokens = ["gia", "ao", "thun", "do"];
  assert.deepEqual(tokenize(input), expectedTokens);
});

test("tokenize removes stopwords and empty tokens", () => {
  const input = "La va cua co cho toi ban minh the nao gi khong a oi nhe voi mot nhung cac duoc de thi o";
  const tokens = tokenize(input);
  assert.equal(tokens.length, 0);
  assert.ok(STOPWORDS.has("la"));
});

test("Retriever.fromStore indexes only active products and all faqs", async () => {
  const store = createMemoryStore();
  // Insert products
  await store.products.upsertMany([
    createProduct("sku1", "Áo Thun", "Màu đỏ", 100, "VND", "Áo", true),
    createProduct("sku2", "Quần Jean", "Màu xanh", 200, "VND", "Quần", false),
  ]);
  // Insert faqs
  await store.faqs.upsertMany([
    createFaq("faq1", "Chính sách đổi trả", "Bạn có thể đổi trả trong 7 ngày.", "Chính sách"),
    createFaq("faq2", "Giao hàng", "Giao hàng miễn phí.", "Dịch vụ")
  ]);

  const retriever = await Retriever.fromStore(store);

  // sku2 is inactive, should not be indexed
  assert.equal(retriever['docs'].some(d => d.source.type === 'product' && d.source.sku === 'sku2'), false);
  // faq1 and faq2 should be indexed
  assert.equal(retriever['docs'].some(d => d.source.type === 'faq' && d.source.faqId === 'faq1'), true);
  assert.equal(retriever['docs'].some(d => d.source.type === 'faq' && d.source.faqId === 'faq2'), true);
});

test("Retriever.search returns product with highest score for 'áo thun'", async () => {
  const store = createMemoryStore();
  await store.products.upsertMany([
    createProduct("sku1", "Áo Thun", "Màu đỏ", 100, "VND", "Áo", true),
    createProduct("sku3", "Áo Sơ Mi", "Màu trắng", 150, "VND", "Áo", true),
  ]);
  await store.faqs.upsertMany([]);

  const retriever = await Retriever.fromStore(store);
  const results = retriever.search("áo thun");
  assert(results.length > 0);
  assert.equal(results[0].source.type, "product");
  assert.equal(results[0].source.sku, "sku1");
  assert(results[0].score <= 1 && results[0].score >= 0);
  assert(results[0].score === 1);
});

test("Retriever.search returns correct faq for 'chính sách đổi trả'", async () => {
  const store = createMemoryStore();
  await store.products.upsertMany([]);
  await store.faqs.upsertMany([
    createFaq("faq1", "Chính sách đổi trả", "Bạn có thể đổi trả trong 7 ngày.", "Chính sách"),
    createFaq("faq2", "Giao hàng", "Giao hàng miễn phí.", "Dịch vụ")
  ]);

  const retriever = await Retriever.fromStore(store);
  const results = retriever.search("chính sách đổi trả");
  assert(results.length > 0);
  assert.equal(results[0].source.type, "faq");
  assert.equal(results[0].source.faqId, "faq1");
});

test("Retriever.search with threshold filters results", async () => {
  const store = createMemoryStore();
  await store.products.upsertMany([
    createProduct("sku1", "Máy bay trực thăng", "Mô hình", 500, "VND", "Đồ chơi", true),
  ]);
  await store.faqs.upsertMany([]);

  const retriever = await Retriever.fromStore(store);

  // Threshold 0.5 no results for unrelated query
  let results = retriever.search("máy bay trực thăng", { threshold: 0.5 });
  assert(Array.isArray(results));
  assert(results.length > 0);

  // Query unrelated
  results = retriever.search("không tồn tại", { threshold: 0.5 });
  assert.deepEqual(results, []);

  // Threshold 0 returns results
  results = retriever.search("máy bay trực thăng", { threshold: 0 });
  assert(results.length > 0);

  // Limit test
  results = retriever.search("máy bay trực thăng", { limit: 1 });
  assert(results.length <= 1);
});

test("parseThreshold returns default 0.5 if undefined", () => {
  assert.equal(parseThreshold({}), 0.5);
});

test("parseThreshold parses valid values", () => {
  assert.equal(parseThreshold({ RETRIEVAL_THRESHOLD: "0" }), 0);
  assert.equal(parseThreshold({ RETRIEVAL_THRESHOLD: "1" }), 1);
  assert.equal(parseThreshold({ RETRIEVAL_THRESHOLD: "0.75" }), 0.75);
});

test("parseThreshold throws on invalid values", () => {
  assert.throws(() => parseThreshold({ RETRIEVAL_THRESHOLD: "-0.1" }));
  assert.throws(() => parseThreshold({ RETRIEVAL_THRESHOLD: "1.1" }));
  assert.throws(() => parseThreshold({ RETRIEVAL_THRESHOLD: "abc" }));
  assert.throws(() => parseThreshold({ RETRIEVAL_THRESHOLD: "" }));
});

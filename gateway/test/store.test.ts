import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memoryStore.js";
import type { Store } from "../src/store/repositories.js";
import type { Product, Faq, Message, Lead, HandoffSession } from "../src/store/types.js";

function createTestStore(): {
  store: Store;
  advance: (ms?: number) => void;
  setTime: (ms: number) => void;
  nowMs: () => number;
} {
  let currentMs = 1000000000000;
  let idCounter = 1;
  const store = createMemoryStore({
    now: () => new Date(currentMs),
    newId: () => {
      const id = `id-${idCounter.toString().padStart(4, "0")}`;
      idCounter++;
      return id;
    }
  });
  return {
    store,
    advance: (ms = 1000) => {
      currentMs += ms;
    },
    setTime: (ms: number) => {
      currentMs = ms;
    },
    nowMs: () => currentMs
  };
}

// a. product upsertMany: insert 2, update 1 with same sku and new price, listActive excludes inactive

test("product upsertMany insert and update, listActive excludes inactive", async () => {
  const { store } = createTestStore();
  const p1: Product = {
    sku: "sku1",
    name: "Product 1",
    description: null,
    price: 10,
    currency: "USD",
    category: null,
    isActive: true
  };
  const p2: Product = {
    sku: "sku2",
    name: "Product 2",
    description: "desc",
    price: 20,
    currency: "USD",
    category: "cat",
    isActive: false
  };
  // Insert 2
  const res1 = await store.products.upsertMany([p1, p2]);
  assert.equal(res1.inserted, 2);
  assert.equal(res1.updated, 0);

  // Update p1 price
  const p1Updated: Product = { ...p1, price: 15 };
  const res2 = await store.products.upsertMany([p1Updated]);
  assert.equal(res2.inserted, 0);
  assert.equal(res2.updated, 1);

  // listActive returns only active products
  const active = await store.products.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].sku, "sku1");
  assert.equal(active[0].price, 15);
});

// b. faq upsertMany + findById

test("faq upsertMany and findById", async () => {
  const { store } = createTestStore();
  const f1: Faq = {
    faqId: "faq1",
    question: "Q1",
    answer: "A1",
    category: null
  };
  const f2: Faq = {
    faqId: "faq2",
    question: "Q2",
    answer: "A2",
    category: "cat"
  };
  const res = await store.faqs.upsertMany([f1, f2]);
  assert.equal(res.inserted, 2);
  assert.equal(res.updated, 0);

  const found = await store.faqs.findById("faq1");
  assert(found !== null);
  assert.equal(found?.question, "Q1");

  const notFound = await store.faqs.findById("nonexistent");
  assert.equal(notFound, null);
});

// c. listSince: 60 messages spaced 1s, limit 60 returns 50; afterMessageId and afterTime filters

test("message listSince with limit, afterMessageId and afterTime", async () => {
  const { store, advance, nowMs } = createTestStore();
  const conv = await store.conversations.create("token");
  const convId = conv.conversationId;

  // Append 60 messages spaced 1s
  for (let i = 1; i <= 60; i++) {
    await store.messages.append({
      conversationId: convId,
      senderType: "customer",
      content: `msg${i}`,
      sources: null,
      handoffSuggested: false
    });
    advance(1000);
  }

  // limit 60 returns max 50
  const msgs1 = await store.messages.listSince(convId, {}, 60);
  assert.equal(msgs1.length, 50);
  assert.equal(msgs1[0].content, "msg1");
  assert.equal(msgs1[49].content, "msg50");

  // afterMessageId = msgs1[19].messageId (20th message) -> first returned is msg21
  const afterMsgId = msgs1[19].messageId;
  const msgs2 = await store.messages.listSince(convId, { afterMessageId: afterMsgId }, 50);
  assert(msgs2.length > 0);
  assert.equal(msgs2[0].content, "msg21");

  // afterTime = msgs1[9].createdAt (10th message) -> first returned is msg11
  const afterTime = msgs1[9].createdAt;
  const msgs3 = await store.messages.listSince(convId, { afterTime }, 50);
  assert(msgs3.length > 0);
  assert.equal(msgs3[0].content, "msg11");
});

// d. lead list: 150 leads; page 1 limit 500 returns 100 newest; page 2 nextCursor returns 50 no overlap; nextCursor last null

test("lead list pagination with nextCursor", async () => {
  const { store, advance } = createTestStore();

  // Create 150 leads with increasing createdAt
  for (let i = 1; i <= 150; i++) {
    await store.leads.create({
      name: `Lead${i}`,
      phone: `000${i}`,
      need: null,
      conversationId: null,
      consentAt: new Date()
    });
    advance(1000);
  }

  // page 1 limit 500 returns max 100 newest
  const page1 = await store.leads.list(500);
  assert.equal(page1.items.length, 100);

  // page 2 with nextCursor returns 50 leads, no overlap
  const page2 = await store.leads.list(500, page1.nextCursor ?? undefined);
  assert.equal(page2.items.length, 50);

  // No overlap between page1 and page2
  const idsPage1 = new Set(page1.items.map(l => l.leadId));
  for (const l of page2.items) {
    assert(!idsPage1.has(l.leadId));
  }

  // nextCursor of page2 is null (end)
  assert.equal(page2.nextCursor, null);
});

// e. openOrGet: second call with same conversationId returns created=false; after close, openOrGet returns new session

test("handoff openOrGet behavior", async () => {
  const { store } = createTestStore();
  const conv = await store.conversations.create("token");
  const convId = conv.conversationId;

  const first = await store.handoffs.openOrGet(convId);
  assert.equal(first.created, true);

  const second = await store.handoffs.openOrGet(convId);
  assert.equal(second.created, false);
  assert.equal(second.session.handoffId, first.session.handoffId);

  // Close session
  const closed = await store.handoffs.close(first.session.handoffId);
  assert(closed !== null);
  assert.equal(closed?.status, "closed");

  // openOrGet after close returns new session
  const third = await store.handoffs.openOrGet(convId);
  assert.equal(third.created, true);
  assert.notEqual(third.session.handoffId, first.session.handoffId);
});

// f. accept: ok; second accept ALREADY_ACCEPTED; unknown id NOT_FOUND; closed session CLOSED

test("handoff accept various cases", async () => {
  const { store } = createTestStore();
  const conv = await store.conversations.create("token");
  const convId = conv.conversationId;
  const { session } = await store.handoffs.openOrGet(convId);

  // accept ok
  const accept1 = await store.handoffs.accept(session.handoffId, "staff1");
  assert(accept1.ok);
  assert.equal(accept1.session.status, "accepted");
  assert.equal(accept1.session.staffUserId, "staff1");

  // accept again ALREADY_ACCEPTED
  const accept2 = await store.handoffs.accept(session.handoffId, "staff2");
  assert(!accept2.ok);
  assert.equal(accept2.reason, "ALREADY_ACCEPTED");

  // accept unknown id NOT_FOUND
  const accept3 = await store.handoffs.accept("unknown-id", "staff1");
  assert(!accept3.ok);
  assert.equal(accept3.reason, "NOT_FOUND");

  // close session
  const closed = await store.handoffs.close(session.handoffId);
  assert(closed !== null);
  assert.equal(closed?.status, "closed");

  // accept closed session CLOSED
  const accept4 = await store.handoffs.accept(session.handoffId, "staff3");
  assert(!accept4.ok);
  assert.equal(accept4.reason, "CLOSED");
});

// g. retention: purgeConversationsBefore removes conversations updated before cutoff and related messages and handoffs; purgeLeadsBefore removes leads created before cutoff

test("retention purgeConversationsBefore and purgeLeadsBefore", async () => {
  const { store, setTime, advance, nowMs } = createTestStore();

  // Set T0
  const T0 = 1_000_000_000_000;
  setTime(T0);

  // Create conversation A + message + handoff
  const convA = await store.conversations.create("tokenA");
  const convAId = convA.conversationId;
  await store.messages.append({
    conversationId: convAId,
    senderType: "customer",
    content: "msgA",
    sources: null,
    handoffSuggested: false
  });
  await store.handoffs.openOrGet(convAId);

  // Advance 10 days
  advance(10 * 24 * 3600 * 1000);

  // Create conversation B
  const convB = await store.conversations.create("tokenB");
  const convBId = convB.conversationId;

  // Purge conversations before now - 1 day
  const cutoffConv = new Date(nowMs() - 24 * 3600 * 1000);
  const purgedCount = await store.retention.purgeConversationsBefore(cutoffConv);
  assert.equal(purgedCount, 1);

  // convA, its messages and handoffs gone
  const convAAfter = await store.conversations.findById(convAId);
  assert.equal(convAAfter, null);
  const msgsA = await store.messages.listSince(convAId, {}, 10);
  assert.equal(msgsA.length, 0);
  const handoffA = await store.handoffs.findOpenByConversation(convAId);
  assert.equal(handoffA, null);

  // convB still exists
  const convBAfter = await store.conversations.findById(convBId);
  assert(convBAfter !== null);

  // Create leads at 800, 400, 0 days before now
  const now = nowMs();
  setTime(now - 800 * 24 * 3600 * 1000);
  await store.leads.create({ name: "L1", phone: "p1", need: null, conversationId: null, consentAt: new Date() });
  setTime(now - 400 * 24 * 3600 * 1000);
  await store.leads.create({ name: "L2", phone: "p2", need: null, conversationId: null, consentAt: new Date() });
  setTime(now);
  await store.leads.create({ name: "L3", phone: "p3", need: null, conversationId: null, consentAt: new Date() });

  // Purge leads before now - 365 days
  const cutoffLead = new Date(now - 365 * 24 * 3600 * 1000);
  const purgedLeads = await store.retention.purgeLeadsBefore(cutoffLead);
  assert.equal(purgedLeads, 2);

  // List leads left is 1
  const leadsList = await store.leads.list(10);
  assert.equal(leadsList.items.length, 1);
});

// h. returned objects are copies, modifying them does not affect store

test("returned objects are immutable copies", async () => {
  const { store } = createTestStore();

  // Insert product
  const p: Product = {
    sku: "skuX",
    name: "NameX",
    description: null,
    price: 100,
    currency: "USD",
    category: null,
    isActive: true
  };
  await store.products.upsertMany([p]);

  const fetched = await store.products.findBySku("skuX");
  assert(fetched !== null);
  if (fetched) {
    fetched.price = 9999;
  }

  const fetchedAgain = await store.products.findBySku("skuX");
  assert(fetchedAgain !== null);
  assert.equal(fetchedAgain?.price, 100);

  // Similar for FAQ
  const f = {
    faqId: "faqX",
    question: "QX",
    answer: "AX",
    category: null
  };
  await store.faqs.upsertMany([f]);
  const fFetched = await store.faqs.findById("faqX");
  assert(fFetched !== null);
  if (fFetched) {
    fFetched.answer = "Changed";
  }
  const fFetchedAgain = await store.faqs.findById("faqX");
  assert(fFetchedAgain !== null);
  assert.equal(fFetchedAgain?.answer, "AX");
});

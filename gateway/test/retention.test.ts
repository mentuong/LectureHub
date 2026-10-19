import test from "node:test";
import assert from "node:assert/strict";
import type { Store } from "../src/store/repositories.js";
import {
  parseRetentionConfig,
  subtractMonthsUtc,
  runRetention,
  startRetentionScheduler,
  RetentionConfig
} from "../src/retention/retentionService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

// Helper to create env object
function envObj(
  conversationDays?: string,
  leadMonths?: string,
  intervalMs?: string
): Record<string, string | undefined> {
  return {
    CONVERSATION_RETENTION_DAYS: conversationDays,
    LEAD_RETENTION_MONTHS: leadMonths,
    RETENTION_INTERVAL_MS: intervalMs
  };
}

test("parseRetentionConfig default values", () => {
  const config = parseRetentionConfig({});
  assert.equal(config.conversationDays, 90);
  assert.equal(config.leadMonths, 12);
  assert.equal(config.intervalMs, 3600000);
});

test("parseRetentionConfig valid values", () => {
  const config = parseRetentionConfig(envObj("100", "24", "5000"));
  assert.equal(config.conversationDays, 100);
  assert.equal(config.leadMonths, 24);
  assert.equal(config.intervalMs, 5000);
});

test("parseRetentionConfig invalid values throw", () => {
  const invalids = ["", "0", "-1", "1.5", "abc"];
  for (const val of invalids) {
    assert.throws(() => parseRetentionConfig(envObj(val, "12", "3600000")), /CONVERSATION_RETENTION_DAYS/);
    assert.throws(() => parseRetentionConfig(envObj("90", val, "3600000")), /LEAD_RETENTION_MONTHS/);
    assert.throws(() => parseRetentionConfig(envObj("90", "12", val)), /RETENTION_INTERVAL_MS/);
  }
});

// subtractMonthsUtc tests
// 31/03/2025 - 1 month => 28/02/2025 (non-leap)
test("subtractMonthsUtc 31/03/2025 - 1 month", () => {
  const d = new Date(Date.UTC(2025, 2, 31));
  const result = subtractMonthsUtc(d, 1);
  assert.equal(result.getUTCFullYear(), 2025);
  assert.equal(result.getUTCMonth(), 1);
  assert.equal(result.getUTCDate(), 28);
});

// 31/03/2024 - 1 month => 29/02/2024 (leap year)
test("subtractMonthsUtc 31/03/2024 - 1 month", () => {
  const d = new Date(Date.UTC(2024, 2, 31));
  const result = subtractMonthsUtc(d, 1);
  assert.equal(result.getUTCFullYear(), 2024);
  assert.equal(result.getUTCMonth(), 1);
  assert.equal(result.getUTCDate(), 29);
});

// 15/01/2025 - 12 months => 15/01/2024
test("subtractMonthsUtc 15/01/2025 - 12 months", () => {
  const d = new Date(Date.UTC(2025, 0, 15));
  const result = subtractMonthsUtc(d, 12);
  assert.equal(result.getUTCFullYear(), 2024);
  assert.equal(result.getUTCMonth(), 0);
  assert.equal(result.getUTCDate(), 15);
});

// runRetention test
// Setup memory store with conversations and leads with createdAt
// Purge conversations older than 90 days, leads older than 12 months
// Check counts and cutoff dates

// Helper to create date offset by days
function daysAgo(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86400000);
}

// Helper to create date offset by months (using subtractMonthsUtc inverse)
function monthsAgo(date: Date, months: number): Date {
  // We can use subtractMonthsUtc with months, but for test we want date before cutoff
  return subtractMonthsUtc(date, months);
}

// We will create a memory store with retention.purge* methods implemented
// The memory store will hold conversations and leads arrays

function createTestStore(now: Date) {
  const conversations: { conversationId: string; createdAt: Date }[] = [];
  const leads: { leadId: string; createdAt: Date }[] = [];

  // Add conversations: one 100 days ago, one 10 days ago
  conversations.push({ conversationId: "c1", createdAt: daysAgo(now, 100) });
  conversations.push({ conversationId: "c2", createdAt: daysAgo(now, 10) });

  // Add leads: one 13 months ago, one 11 months ago
  leads.push({ leadId: "l1", createdAt: monthsAgo(now, 13) });
  leads.push({ leadId: "l2", createdAt: monthsAgo(now, 11) });

  const store = createMemoryStore({ now: () => now, newId: () => "id" });

  // Override retention.purgeConversationsBefore
  store.retention.purgeConversationsBefore = async (cutoff: Date) => {
    let count = 0;
    for (const c of conversations) {
      if (c.createdAt < cutoff) {
        count++;
      }
    }
    // Remove purged
    for (let i = conversations.length - 1; i >= 0; i--) {
      if (conversations[i].createdAt < cutoff) {
        conversations.splice(i, 1);
      }
    }
    return count;
  };

  // Override retention.purgeLeadsBefore
  store.retention.purgeLeadsBefore = async (cutoff: Date) => {
    let count = 0;
    for (const l of leads) {
      if (l.createdAt < cutoff) {
        count++;
      }
    }
    // Remove purged
    for (let i = leads.length - 1; i >= 0; i--) {
      if (leads[i].createdAt < cutoff) {
        leads.splice(i, 1);
      }
    }
    return count;
  };

  return store;
}

test("runRetention purges correct conversations and leads", async () => {
  const now = new Date(Date.UTC(2025, 5, 1)); // 1 June 2025 UTC
  const store = createTestStore(now);

  const result = await runRetention(store, { conversationDays: 90, leadMonths: 12 }, now);

  // conversationCutoff = now - 90 days
  const expectedConversationCutoff = new Date(now.getTime() - 90 * 86400000);
  assert.equal(result.conversationCutoff.getTime(), expectedConversationCutoff.getTime());

  // leadCutoff = now - 12 months
  const expectedLeadCutoff = subtractMonthsUtc(now, 12);
  assert.equal(result.leadCutoff.getTime(), expectedLeadCutoff.getTime());

  // conversationsPurged should be 1 (100 days ago)
  assert.equal(result.conversationsPurged, 1);
  // leadsPurged should be 1 (13 months ago)
  assert.equal(result.leadsPurged, 1);

  // After purge, only recent conversation and lead remain
  // Run again, should purge 0
  const result2 = await runRetention(store, { conversationDays: 90, leadMonths: 12 }, now);
  assert.equal(result2.conversationsPurged, 0);
  assert.equal(result2.leadsPurged, 0);
});

// startRetentionScheduler tests

// Fake timer helpers
function createFakeTimer() {
  let captured: (() => void) | null = null;
  let intervalId = 0;
  let cleared: unknown = null;

  return {
    setIntervalFn: (cb: () => void, _ms: number): unknown => {
      captured = cb;
      intervalId++;
      return intervalId;
    },
    clearIntervalFn: (h: unknown): void => {
      cleared = h;
      if (h === intervalId) {
        captured = null;
      }
    },
    trigger() {
      if (captured) {
        captured();
      }
    },
    isCleared() {
      return cleared === intervalId;
    },
  };
}

// Test that scheduler runs immediately and on interval, and stop clears interval
// Also test onError called if store throws

// Helper store that counts calls and can throw
function createSchedulerTestStore(throwOnRun = false) {
  return {
    retention: {
      purgeConversationsBefore: async () => {
        if (throwOnRun) throw new Error("fail conversations");
        return 1;
      },
      purgeLeadsBefore: async () => {
        if (throwOnRun) throw new Error("fail leads");
        return 2;
      },
    },
  } as unknown as Store;
}

test("startRetentionScheduler runs immediately and on interval, stop clears interval", async () => {
  const now = new Date();
  const store = createSchedulerTestStore(false);
  const fakeTimer = createFakeTimer();

  let runCount = 0;
  let lastResult: any = null;

  const scheduler = startRetentionScheduler(store, { conversationDays: 90, leadMonths: 12, intervalMs: 1000 }, {
    now: () => now,
    onResult: (r) => {
      runCount++;
      lastResult = r;
    },
    onError: () => {
      assert.fail("onError should not be called");
    },
    setIntervalFn: fakeTimer.setIntervalFn,
    clearIntervalFn: fakeTimer.clearIntervalFn
  });

  // Wait a tick for immediate run
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runCount, 1);
  assert(lastResult.conversationsPurged === 1);
  assert(lastResult.leadsPurged === 2);

  // Trigger interval
  fakeTimer.trigger();
  // Wait a tick
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runCount, 2);

  // Stop scheduler
  scheduler.stop();
  assert(fakeTimer.isCleared());

  // Trigger interval again, should not run
  fakeTimer.trigger();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runCount, 2);
});

// Test onError called when store throws

test("startRetentionScheduler calls onError on store error and does not stop", async () => {
  const now = new Date();
  const store = createSchedulerTestStore(true);
  const fakeTimer = createFakeTimer();

  let errorCount = 0;

  const scheduler = startRetentionScheduler(store, { conversationDays: 90, leadMonths: 12, intervalMs: 1000 }, {
    now: () => now,
    onResult: () => {
      assert.fail("onResult should not be called on error");
    },
    onError: (e) => {
      errorCount++;
      assert(e instanceof Error);
    },
    setIntervalFn: fakeTimer.setIntervalFn,
    clearIntervalFn: fakeTimer.clearIntervalFn
  });

  // Wait a tick for immediate run
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(errorCount, 1);

  // Trigger interval
  fakeTimer.trigger();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(errorCount, 2);

  scheduler.stop();
});

import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memoryStore.js";
import {
  createLead,
  normalizePhone,
  maskPhone,
  ValidationError
} from "../src/lead/leadService.js";

// Helper to create store with optional conversation IDs
function createStoreWithConversations(ids: string[]) {
  const store = createMemoryStore();
  for (const id of ids) {
    // We simulate conversation creation by directly adding to memory store conversations
    // Assuming memoryStore has conversations repository with create or direct insert
    // Since memoryStore.js content is unknown, we assume findById works for these IDs
    // We simulate by creating conversations with given IDs
    // But memoryStore.js interface only has create(tokenHash) - no direct insert
    // So we create conversations with dummy tokenHash and override conversationId
    // We'll patch findById to return a conversation for these IDs
  }
  // Patch findById
  const originalFindById = store.conversations.findById.bind(store.conversations);
  store.conversations.findById = async (id: string) => {
    if (ids.includes(id)) {
      return {
        conversationId: id,
        conversationTokenHash: "dummyhash",
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    return originalFindById(id);
  };
  return store;
}

const fixedDate = new Date("2024-01-01T12:00:00Z");

// Tests for normalizePhone
test("normalizePhone removes spaces, dots, dashes, parentheses and converts +84/84 prefix", () => {
  assert.equal(normalizePhone("0912 345 678"), "0912345678");
  assert.equal(normalizePhone("+84912345678"), "0912345678");
  assert.equal(normalizePhone("84912345678"), "0912345678");
  assert.equal(normalizePhone("(091)-234-5678"), "0912345678");
  assert.equal(normalizePhone("+84123456789"), "0123456789");
  assert.equal(normalizePhone("+8412345678"), "+8412345678"); // length != 12, no change
  assert.equal(normalizePhone("1234567890"), "1234567890");
  assert.equal(normalizePhone("\t0912 345 678 "), "0912345678");
});

// Tests for maskPhone
test("maskPhone masks middle characters", () => {
  assert.equal(maskPhone("0912345678"), "09******78");
  assert.equal(maskPhone("0123"), "01" + "" + "23");
  assert.equal(maskPhone("012"), "012");
  assert.equal(maskPhone("0"), "0");
  assert.equal(maskPhone(""), "");
});

// Tests for createLead

// Valid input with all fields
test("createLead valid input stores lead with normalized phone and consentAt", async () => {
  const store = createStoreWithConversations(["conv1"]);
  const input = {
    name: "  John Doe  ",
    phone: "0912 345 678",
    need: "  Need some info  ",
    conversationId: "conv1",
    consent: true
  };
  const lead = await createLead(store, input, { now: () => fixedDate });
  assert.equal(lead.name, "John Doe");
  assert.equal(lead.phone, "0912345678");
  assert.equal(lead.need, "Need some info");
  assert.equal(lead.conversationId, "conv1");
  assert.equal(lead.consentAt.toISOString(), fixedDate.toISOString());
});

// Valid input with optional fields missing or empty
test("createLead with missing optional fields sets need and conversationId to null", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Alice",
    phone: "+84912345678",
    consent: true
  };
  const lead = await createLead(store, input, { now: () => fixedDate });
  assert.equal(lead.name, "Alice");
  assert.equal(lead.phone, "0912345678");
  assert.equal(lead.need, null);
  assert.equal(lead.conversationId, null);
});

// need empty string -> null
test("createLead with empty need string sets need to null", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Bob",
    phone: "0912345678",
    need: "   ",
    consent: true
  };
  const lead = await createLead(store, input);
  assert.equal(lead.need, null);
});

// Invalid phone: 9 digits
test("createLead invalid phone 9 digits throws ValidationError", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Test",
    phone: "091234567",
    consent: true
  };
  await assert.rejects(async () => {
    await createLead(store, input);
  }, (err) => {
    assert(err instanceof ValidationError);
    assert(err.details.some(e => e.field === "phone"));
    return true;
  });
});

// Invalid phone: starts with 1
test("createLead invalid phone starting with 1 throws ValidationError", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Test",
    phone: "1912345678",
    consent: true
  };
  await assert.rejects(async () => {
    await createLead(store, input);
  }, (err) => {
    assert(err instanceof ValidationError);
    assert(err.details.some(e => e.field === "phone"));
    return true;
  });
});

// Invalid phone: contains letters
test("createLead invalid phone with letters throws ValidationError", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Test",
    phone: "09a2345678",
    consent: true
  };
  await assert.rejects(async () => {
    await createLead(store, input);
  }, (err) => {
    assert(err instanceof ValidationError);
    assert(err.details.some(e => e.field === "phone"));
    return true;
  });
});

// consent false
test("createLead with consent false throws ValidationError", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Test",
    phone: "0912345678",
    consent: false
  };
  await assert.rejects(async () => {
    await createLead(store, input);
  }, (err) => {
    assert(err instanceof ValidationError);
    assert(err.details.some(e => e.field === "consent"));
    return true;
  });
});

// consent string "true" (not boolean true)
test("createLead with consent string 'true' throws ValidationError", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    name: "Test",
    phone: "0912345678",
    consent: "true"
  };
  await assert.rejects(async () => {
    await createLead(store, input);
  }, (err) => {
    assert(err instanceof ValidationError);
    assert(err.details.some(e => e.field === "consent"));
    return true;
  });
});

// Missing name and invalid phone
test("createLead missing name and invalid phone returns two errors", async () => {
  const store = createStoreWithConversations([]);
  const input = {
    phone: "123",
    consent: true
  };
  await assert.rejects(async () => {
    await createLead(store, input as any);
  }, (err) => {
    assert(err instanceof ValidationError);
    const fields = err.details.map(e => e.field);
    assert(fields.includes("name"));
    assert(fields.includes("phone"));
    return true;
  });
});

// conversationId not exist
test("createLead with non-existent conversationId throws ValidationError", async () => {
  const store = createStoreWithConversations(["conv1"]);
  const input = {
    name: "Test",
    phone: "0912345678",
    conversationId: "conv2",
    consent: true
  };
  await assert.rejects(async () => {
    await createLead(store, input);
  }, (err) => {
    assert(err instanceof ValidationError);
    assert(err.details.some(e => e.field === "conversationId"));
    return true;
  });
});

// conversationId exists
test("createLead with existing conversationId succeeds", async () => {
  const store = createStoreWithConversations(["conv1"]);
  const input = {
    name: "Test",
    phone: "0912345678",
    conversationId: "conv1",
    consent: true
  };
  const lead = await createLead(store, input);
  assert.equal(lead.conversationId, "conv1");
});

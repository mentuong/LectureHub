import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memoryStore.js";
import {
  HandoffError,
  HANDOFF_PHRASES,
  detectHandoffIntent,
  requestHandoff,
  isAiPaused,
  acceptHandoff,
  staffReply,
  closeHandoff
} from "../src/handoff/handoffService.js";

// Helpers
function createTestStore() {
  let now = new Date(2023, 0, 1, 12, 0, 0);
  let idCounter = 0;
  return createMemoryStore({
    now: () => new Date(now.getTime()),
    newId: () => {
      idCounter++;
      return `id${idCounter}`;
    }
  });
}

// Test detectHandoffIntent
// "Cho tôi GẶP NHÂN VIÊN với" → true
// "giá áo bao nhiêu" → false
// "tôi muốn gặp người thật" → true

test("detectHandoffIntent basic cases", () => {
  assert(detectHandoffIntent("Cho tôi GẶP NHÂN VIÊN với") === true);
  assert(detectHandoffIntent("giá áo bao nhiêu") === false);
  assert(detectHandoffIntent("tôi muốn gặp người thật") === true);
});

// Test requestHandoff
// create session + 1 system message
// call 2nd time created=false no new message
// conversation lạ → CONVERSATION_NOT_FOUND

test("requestHandoff creates session and system message", async () => {
  const store = createTestStore();
  // Create conversation
  const conv = await store.conversations.create("tokenhash1");

  // First call
  const { session, created } = await requestHandoff(store, conv.conversationId);
  assert(created === true);
  assert(session.conversationId === conv.conversationId);

  // Check system message appended
  const messages = await store.messages.listSince(conv.conversationId, {}, 10);
  assert(messages.length === 1);
  assert(messages[0].senderType === "system");
  assert(messages[0].content === "Bạn đã được chuyển tới nhân viên tư vấn. Vui lòng chờ trong giây lát.");

  // Second call
  const { created: created2 } = await requestHandoff(store, conv.conversationId);
  assert(created2 === false);

  // No additional system message
  const messages2 = await store.messages.listSince(conv.conversationId, {}, 10);
  assert(messages2.length === 1);
});

test("requestHandoff throws CONVERSATION_NOT_FOUND", async () => {
  const store = createTestStore();
  await assert.rejects(
    () => requestHandoff(store, "nonexistent"),
    (err) => err instanceof HandoffError && err.code === "CONVERSATION_NOT_FOUND"
  );
});

// Test isAiPaused true after request, false after close

test("isAiPaused true after request, false after close", async () => {
  const store = createTestStore();
  const conv = await store.conversations.create("tokenhash2");

  // Initially false
  assert(await isAiPaused(store, conv.conversationId) === false);

  // Request handoff
  const { session } = await requestHandoff(store, conv.conversationId);
  assert(await isAiPaused(store, conv.conversationId) === true);

  // Close handoff
  await closeHandoff(store, session.handoffId);
  assert(await isAiPaused(store, conv.conversationId) === false);
});

// Test acceptHandoff
// accept once ok + system message
// accept twice ALREADY_ACCEPTED
// id lạ NOT_FOUND
// after close → CLOSED

test("acceptHandoff scenarios", async () => {
  const store = createTestStore();
  const conv = await store.conversations.create("tokenhash3");
  const { session } = await requestHandoff(store, conv.conversationId);

  // Accept once
  const accepted = await acceptHandoff(store, session.handoffId, "staff1");
  assert(accepted.handoffId === session.handoffId);

  // Check system message
  const messages = await store.messages.listSince(conv.conversationId, {}, 10);
  const systemMessages = messages.filter(m => m.senderType === "system" && m.content === "Nhân viên đã tham gia cuộc trò chuyện.");
  assert(systemMessages.length === 1);

  // Accept twice -> ALREADY_ACCEPTED
  await assert.rejects(
    () => acceptHandoff(store, session.handoffId, "staff1"),
    (err) => err instanceof HandoffError && err.code === "ALREADY_ACCEPTED"
  );

  // Accept with unknown id -> NOT_FOUND
  await assert.rejects(
    () => acceptHandoff(store, "unknownid", "staff1"),
    (err) => err instanceof HandoffError && err.code === "NOT_FOUND"
  );

  // Close session
  await closeHandoff(store, session.handoffId);

  // Accept after close -> CLOSED
  await assert.rejects(
    () => acceptHandoff(store, session.handoffId, "staff1"),
    (err) => err instanceof HandoffError && err.code === "CLOSED"
  );
});

// Test staffReply
// correct staff saves message
// other staff NOT_ASSIGNED
// pending session NOT_ASSIGNED
// empty or too long content INVALID_CONTENT

test("staffReply scenarios", async () => {
  const store = createTestStore();
  const conv = await store.conversations.create("tokenhash4");
  const { session } = await requestHandoff(store, conv.conversationId);

  // Accept session with staff1
  await acceptHandoff(store, session.handoffId, "staff1");

  // staffReply correct
  const msg = await staffReply(store, session.handoffId, "staff1", "Hello from staff");
  assert(msg.senderType === "staff");
  assert(msg.content === "Hello from staff");

  // staffReply by other staff -> NOT_ASSIGNED
  await assert.rejects(
    () => staffReply(store, session.handoffId, "staff2", "Hi"),
    (err) => err instanceof HandoffError && err.code === "NOT_ASSIGNED"
  );

  // Create new conversation and new session pending
  const conv2 = await store.conversations.create("tokenhash5");
  const { session: session2 } = await requestHandoff(store, conv2.conversationId);

  // staffReply on pending -> NOT_ASSIGNED
  await assert.rejects(
    () => staffReply(store, session2.handoffId, "staff1", "Hi"),
    (err) => err instanceof HandoffError && err.code === "NOT_ASSIGNED"
  );

  // staffReply empty content -> INVALID_CONTENT
  await assert.rejects(
    () => staffReply(store, session.handoffId, "staff1", "   "),
    (err) => err instanceof HandoffError && err.code === "INVALID_CONTENT"
  );

  // staffReply too long content -> INVALID_CONTENT
  const longContent = "a".repeat(2001);
  await assert.rejects(
    () => staffReply(store, session.handoffId, "staff1", longContent),
    (err) => err instanceof HandoffError && err.code === "INVALID_CONTENT"
  );

  // staffReply unknown handoffId -> NOT_FOUND
  await assert.rejects(
    () => staffReply(store, "unknownid", "staff1", "Hi"),
    (err) => err instanceof HandoffError && err.code === "NOT_FOUND"
  );
});

// Test closeHandoff
// id lạ → NOT_FOUND
// valid closes and appends system message

test("closeHandoff scenarios", async () => {
  const store = createTestStore();
  const conv = await store.conversations.create("tokenhash5");
  const { session } = await requestHandoff(store, conv.conversationId);

  // Close unknown id -> NOT_FOUND
  await assert.rejects(
    () => closeHandoff(store, "unknownid"),
    (err) => err instanceof HandoffError && err.code === "NOT_FOUND"
  );

  // Close valid
  const closed = await closeHandoff(store, session.handoffId);
  assert(closed.handoffId === session.handoffId);

  // Check system message appended
  const messages = await store.messages.listSince(conv.conversationId, {}, 10);
  const systemMessages = messages.filter(m => m.senderType === "system" && m.content === "Phiên hỗ trợ đã kết thúc.");
  assert(systemMessages.length === 1);
});

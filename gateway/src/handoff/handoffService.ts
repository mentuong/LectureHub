import type { Store } from "../store/repositories.js";
import type { HandoffSession, Message } from "../store/types.js";

export class HandoffError extends Error {
  readonly code: "CONVERSATION_NOT_FOUND" | "NOT_FOUND" | "ALREADY_ACCEPTED" | "CLOSED" | "NOT_ASSIGNED" | "INVALID_CONTENT";

  constructor(
    code: "CONVERSATION_NOT_FOUND" | "NOT_FOUND" | "ALREADY_ACCEPTED" | "CLOSED" | "NOT_ASSIGNED" | "INVALID_CONTENT",
    message: string
  ) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, HandoffError.prototype);
  }
}

export const HANDOFF_PHRASES = [
  "gap nhan vien",
  "gap nguoi that",
  "noi chuyen voi nguoi",
  "chuyen nhan vien",
  "nhan vien tu van",
  "tu van vien",
  "gap tu van vien",
  "goi nhan vien",
  "human",
  "nguoi that"
] as const;

function normalizeText(text: string): string {
  // Lowercase
  let normalized = text.toLowerCase();
  // Normalize NFD
  normalized = normalized.normalize("NFD");
  // Remove diacritics U+0300–036F
  normalized = normalized.replace(/\p{M}/gu, "");
  // Replace đ with d
  normalized = normalized.replace(/đ/g, "d");
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

export function detectHandoffIntent(text: string): boolean {
  const normalized = normalizeText(text);
  for (const phrase of HANDOFF_PHRASES) {
    if (normalized.includes(phrase)) {
      return true;
    }
  }
  return false;
}

export async function requestHandoff(
  store: Store,
  conversationId: string
): Promise<{ session: HandoffSession; created: boolean }> {
  const conversation = await store.conversations.findById(conversationId);
  if (!conversation) {
    throw new HandoffError("CONVERSATION_NOT_FOUND", "Conversation not found");
  }

  const { session, created } = await store.handoffs.openOrGet(conversationId);

  if (created) {
    await store.messages.append({
      conversationId: conversationId,
      senderType: "system",
      content: "Bạn đã được chuyển tới nhân viên tư vấn. Vui lòng chờ trong giây lát.",
      sources: null,
      handoffSuggested: false
    });
    await store.conversations.touch(conversationId);
  }

  return { session, created };
}

export async function isAiPaused(store: Store, conversationId: string): Promise<boolean> {
  const session = await store.handoffs.findOpenByConversation(conversationId);
  return session !== null && session.status !== "closed";
}

export async function acceptHandoff(
  store: Store,
  handoffId: string,
  staffUserId: string
): Promise<HandoffSession> {
  const result = await store.handoffs.accept(handoffId, staffUserId);
  if (!result.ok) {
    switch (result.reason) {
      case "NOT_FOUND":
        throw new HandoffError("NOT_FOUND", "Handoff session not found");
      case "ALREADY_ACCEPTED":
        throw new HandoffError("ALREADY_ACCEPTED", "Handoff session already accepted");
      case "CLOSED":
        throw new HandoffError("CLOSED", "Handoff session is closed");
      default:
        throw new HandoffError("NOT_FOUND", "Handoff session not found");
    }
  }

  await store.messages.append({
    conversationId: result.session.conversationId,
    senderType: "system",
    content: "Nhân viên đã tham gia cuộc trò chuyện.",
    sources: null,
    handoffSuggested: false
  });

  await store.conversations.touch(result.session.conversationId);

  return result.session;
}

export async function staffReply(
  store: Store,
  handoffId: string,
  staffUserId: string,
  content: string
): Promise<Message> {
  const queue = await store.handoffs.listQueue();
  const session = queue.find((s) => s.handoffId === handoffId);
  if (!session) {
    throw new HandoffError("NOT_FOUND", "Handoff session not found");
  }
  if (session.status !== "accepted" || session.staffUserId !== staffUserId) {
    throw new HandoffError("NOT_ASSIGNED", "Staff user not assigned or session not accepted");
  }

  const trimmedContent = content.trim();
  if (trimmedContent.length === 0 || trimmedContent.length > 2000) {
    throw new HandoffError("INVALID_CONTENT", "Content must be 1 to 2000 characters");
  }

  const message = await store.messages.append({
    conversationId: session.conversationId,
    senderType: "staff",
    content: trimmedContent,
    sources: null,
    handoffSuggested: false
  });

  await store.conversations.touch(session.conversationId);

  return message;
}

export async function closeHandoff(store: Store, handoffId: string): Promise<HandoffSession> {
  const session = await store.handoffs.close(handoffId);
  if (!session) {
    throw new HandoffError("NOT_FOUND", "Handoff session not found");
  }

  await store.messages.append({
    conversationId: session.conversationId,
    senderType: "system",
    content: "Phiên hỗ trợ đã kết thúc.",
    sources: null,
    handoffSuggested: false
  });

  await store.conversations.touch(session.conversationId);

  return session;
}

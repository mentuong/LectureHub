import type { Store } from "../store/repositories.js";
import type { Source } from "../store/types.js";
import { Retriever } from "../retrieval/retriever.js";
import type { RetrievedDoc } from "../retrieval/retriever.js";
import { LlmError } from "../llm/types.js";
import type { LlmProvider, ChatMessage } from "../llm/types.js";

export const UNKNOWN_ANSWER = "Xin lỗi, mình chưa có thông tin chính xác cho câu hỏi này. Bạn có muốn gặp nhân viên tư vấn không?";
export const FALLBACK_ANSWER = "Xin lỗi, hệ thống tư vấn đang bận. Bạn có muốn gặp nhân viên tư vấn không?";

export type AnswerKind = "answer" | "unknown" | "fallback";

export type AnswerResult = {
  kind: AnswerKind;
  text: string;
  sources: Source[];
  handoffSuggested: boolean;
  reason?: "NO_RETRIEVAL" | "INSUFFICIENT_CONTEXT" | "EMPTY_RESPONSE" | "PRICE_MISMATCH" | "LLM_ERROR";
};

export type AnswerDeps = {
  retriever: Retriever;
  llm: LlmProvider;
  threshold: number;
  timeoutMs?: number;
};

/**
 * Build chat messages for LLM prompt.
 * System message in Vietnamese with instructions.
 * Then up to 6 last messages from history (user/assistant only).
 * Last message is user question trimmed.
 */
export function buildMessages(question: string, docs: RetrievedDoc[], history?: ChatMessage[]): ChatMessage[] {
  // Build system content
  // Role: tư vấn bán hàng
  // Use only info in NGUỒN
  // State price exactly as in source, no guessing
  // If insufficient info, answer starts with [INSUFFICIENT_CONTEXT]
  // Short and friendly
  // Then list NGUỒN with each doc as [SKU:<sku>] <title>: <text> or [FAQ:<faqId>] <title>: <text>

  const sourceLines = docs.map(doc => {
    const src = doc.source;
    if (src.type === "product") {
      return `[SKU:${src.sku}] ${doc.title}: ${doc.text}`;
    } else if (src.type === "faq") {
      return `[FAQ:${src.faqId}] ${doc.title}: ${doc.text}`;
    } else {
      return `[UNKNOWN] ${doc.title}: ${doc.text}`;
    }
  });

  const systemContent = [
    "Bạn là trợ lý tư vấn bán hàng. Chỉ sử dụng thông tin trong mục NGUỒN để trả lời.",
    "Nêu giá đúng như nguồn, không suy đoán giá, tồn kho hay khuyến mãi.",
    "Nếu nguồn không đủ, câu trả lời bắt đầu bằng '[INSUFFICIENT_CONTEXT]'.",
    "Trả lời ngắn gọn, thân thiện.",
    "NGUỒN:",
    ...sourceLines
  ].join("\n");

  // Prepare history: keep only last 6 messages with role user or assistant
  const filteredHistory = Array.isArray(history)
    ? history.filter(m => m.role === "user" || m.role === "assistant")
    : [];
  const lastSix = filteredHistory.slice(-6);

  // Compose final messages
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...lastSix,
    { role: "user", content: question.trim() }
  ];

  return messages;
}

/**
 * Extract allowed prices from product docs.
 * Find sequences of digits immediately after "giá " in doc.text.
 * Return set of strings representing prices (digits only, no separators).
 */
export function extractAllowedPrices(docs: RetrievedDoc[]): Set<string> {
  const prices = new Set<string>();
  const priceRegex = /giá (\d+)/g;
  for (const doc of docs) {
    if (doc.source.type === "product") {
      let match: RegExpExecArray | null;
      while ((match = priceRegex.exec(doc.text)) !== null) {
        prices.add(match[1]);
      }
    }
  }
  return prices;
}

/**
 * Extract mentioned prices from text.
 * Find digit sequences possibly with dots or commas,
 * followed by optional whitespace and one of units: đồng, dong, vnđ, vnd, đ, ₫ (case insensitive).
 * Return array of strings with dots and commas removed.
 */
export function extractMentionedPrices(text: string): string[] {
  const prices: string[] = [];
  // Regex explanation:
  // (\d[\d.,]*\d|\d) matches a number with optional dots/commas inside
  // \s* optional spaces
  // (đồng|dong|vnđ|vnd|đ|₫) units, case insensitive
  const priceMentionRegex = /(\d[\d.,]*\d|\d)\s*(đồng|dong|vnđ|vnd|đ|₫)/gi;
  let match: RegExpExecArray | null;
  while ((match = priceMentionRegex.exec(text)) !== null) {
    // Remove dots and commas
    const normalized = match[1].replace(/[.,]/g, "");
    prices.push(normalized);
  }
  return prices;
}

/**
 * Main function to answer a question.
 * 1. Search docs with retriever.
 * 2. If no docs, return unknown with NO_RETRIEVAL.
 * 3. Call LLM with built messages and timeout.
 * 4. On LLM error, return fallback with LLM_ERROR.
 * 5. If insufficientContext true, unknown with INSUFFICIENT_CONTEXT.
 * 6. If LLM text empty after trim, unknown with EMPTY_RESPONSE.
 * 7. Extract allowed prices from docs.
 * 8. Extract mentioned prices from LLM text.
 * 9. If any mentioned price not in allowed prices, unknown with PRICE_MISMATCH.
 * 10. Otherwise answer with kind answer.
 */
export async function answerQuestion(
  deps: AnswerDeps,
  question: string,
  history?: ChatMessage[]
): Promise<AnswerResult> {
  const docs = await deps.retriever.search(question, { threshold: deps.threshold, limit: 5 });

  if (docs.length === 0) {
    return {
      kind: "unknown",
      text: UNKNOWN_ANSWER,
      sources: [],
      handoffSuggested: true,
      reason: "NO_RETRIEVAL"
    };
  }

  let llmResponse;
  try {
    const messages = buildMessages(question, docs, history);
    llmResponse = await deps.llm.generate({ messages, timeoutMs: deps.timeoutMs ?? 10000 });
  } catch (e) {
    // On any error from LLM, fallback
    return {
      kind: "fallback",
      text: FALLBACK_ANSWER,
      sources: [],
      handoffSuggested: true,
      reason: "LLM_ERROR"
    };
  }

  if (llmResponse.insufficientContext) {
    return {
      kind: "unknown",
      text: UNKNOWN_ANSWER,
      sources: docs.map(d => d.source),
      handoffSuggested: true,
      reason: "INSUFFICIENT_CONTEXT"
    };
  }

  const trimmedText = llmResponse.text.trim();
  if (trimmedText === "") {
    return {
      kind: "unknown",
      text: UNKNOWN_ANSWER,
      sources: docs.map(d => d.source),
      handoffSuggested: true,
      reason: "EMPTY_RESPONSE"
    };
  }

  const allowedPrices = extractAllowedPrices(docs);
  const mentionedPrices = extractMentionedPrices(trimmedText);

  for (const price of mentionedPrices) {
    if (!allowedPrices.has(price)) {
      return {
        kind: "unknown",
        text: UNKNOWN_ANSWER,
        sources: docs.map(d => d.source),
        handoffSuggested: true,
        reason: "PRICE_MISMATCH"
      };
    }
  }

  return {
    kind: "answer",
    text: trimmedText,
    sources: docs.map(d => d.source),
    handoffSuggested: false
  };
}

import type { Lead } from "../store/types.js";
import type { Store } from "../store/repositories.js";

export type FieldError = { field: string; message: string };

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly details: FieldError[];

  constructor(details: FieldError[]) {
    super("Validation failed");
    this.details = details;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Normalize Vietnamese phone number:
 * - Remove spaces, dots, dashes, parentheses
 * - Convert prefix +84 or 84 (if remaining 9 digits) to 0
 */
export function normalizePhone(raw: string): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[\s.\-()]/g, "");
  if (cleaned.startsWith("+84") && cleaned.length === 12) {
    return "0" + cleaned.slice(3);
  }
  if (cleaned.startsWith("84") && cleaned.length === 11) {
    return "0" + cleaned.slice(2);
  }
  return cleaned;
}

/**
 * Mask phone number: keep first 2 and last 2 characters, replace middle with '*'
 * Example: "0912345678" -> "09******78"
 */
export function maskPhone(phone: string): string {
  if (typeof phone !== "string" || phone.length < 4) return phone;
  const start = phone.slice(0, 2);
  const end = phone.slice(-2);
  const middle = "*".repeat(phone.length - 4);
  return start + middle + end;
}

export type CreateLeadInput = {
  name: unknown;
  phone: unknown;
  need?: unknown;
  conversationId?: unknown;
  consent: unknown;
};

export async function createLead(
  store: Store,
  input: CreateLeadInput,
  deps?: { now?: () => Date }
): Promise<Lead> {
  const errors: FieldError[] = [];

  // Validate name
  let name: string | null = null;
  if (typeof input.name === "string") {
    name = input.name.trim();
    if (name.length === 0) {
      errors.push({ field: "name", message: "Name cannot be empty" });
    } else if (name.length > 100) {
      errors.push({ field: "name", message: "Name must be at most 100 characters" });
    }
  } else {
    errors.push({ field: "name", message: "Name must be a string" });
  }

  // Validate phone
  let phone: string | null = null;
  if (typeof input.phone === "string") {
    const normalized = normalizePhone(input.phone);
    if (!/^0\d{9}$/.test(normalized)) {
      errors.push({ field: "phone", message: "Phone must be a valid Vietnamese phone number starting with 0 and 10 digits" });
    } else {
      phone = normalized;
    }
  } else {
    errors.push({ field: "phone", message: "Phone must be a string" });
  }

  // Validate need (optional)
  let need: string | null = null;
  if (input.need === undefined || input.need === null) {
    need = null;
  } else if (typeof input.need === "string") {
    const trimmed = input.need.trim();
    if (trimmed.length === 0) {
      need = null;
    } else if (trimmed.length > 1000) {
      errors.push({ field: "need", message: "Need must be at most 1000 characters" });
    } else {
      need = trimmed;
    }
  } else {
    errors.push({ field: "need", message: "Need must be a string if provided" });
  }

  // Validate conversationId (optional)
  let conversationId: string | null = null;
  if (input.conversationId === undefined || input.conversationId === null) {
    conversationId = null;
  } else if (typeof input.conversationId === "string") {
    conversationId = input.conversationId;
    const conv = await store.conversations.findById(conversationId);
    if (conv === null) {
      errors.push({ field: "conversationId", message: "Conversation ID does not exist" });
    }
  } else {
    errors.push({ field: "conversationId", message: "Conversation ID must be a string if provided" });
  }

  // Validate consent
  if (input.consent !== true) {
    errors.push({ field: "consent", message: "Consent must be boolean true" });
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  const now = deps?.now ? deps.now() : new Date();

  const lead = await store.leads.create({
    name: name!,
    phone: phone!,
    need: need,
    conversationId: conversationId,
    consentAt: now
  });

  return lead;
}

import {
  Product,
  Faq,
  Conversation,
  Message,
  Lead,
  HandoffSession,
  StaffUser,
  HandoffStatus
} from "./types.js";

export interface ProductRepository {
  upsertMany(items: Product[]): Promise<{ inserted: number; updated: number }>;
  findBySku(sku: string): Promise<Product | null>;
  listActive(): Promise<Product[]>;
}

export interface FaqRepository {
  upsertMany(items: Faq[]): Promise<{ inserted: number; updated: number }>;
  findById(faqId: string): Promise<Faq | null>;
  listAll(): Promise<Faq[]>;
}

export interface ConversationRepository {
  create(tokenHash: string): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  touch(id: string): Promise<void>;
}

export interface MessageRepository {
  append(input: Omit<Message, "messageId" | "createdAt">): Promise<Message>;
  listSince(
    conversationId: string,
    since: { afterMessageId?: string; afterTime?: Date },
    limit: number
  ): Promise<Message[]>;
}

export interface LeadRepository {
  create(input: Omit<Lead, "leadId" | "createdAt">): Promise<Lead>;
  list(
    limit: number,
    cursor?: string
  ): Promise<{ items: Lead[]; nextCursor: string | null }>;
}

export interface HandoffRepository {
  openOrGet(conversationId: string): Promise<{ session: HandoffSession; created: boolean }>;
  findOpenByConversation(conversationId: string): Promise<HandoffSession | null>;
  listQueue(): Promise<HandoffSession[]>;
  accept(
    handoffId: string,
    staffUserId: string
  ): Promise<
    | { ok: true; session: HandoffSession }
    | { ok: false; reason: "NOT_FOUND" | "ALREADY_ACCEPTED" | "CLOSED" }
  >;
  close(handoffId: string): Promise<HandoffSession | null>;
}

export interface StaffUserRepository {
  upsert(user: Omit<StaffUser, "staffUserId" | "createdAt">): Promise<StaffUser>;
  findByUsername(username: string): Promise<StaffUser | null>;
}

export interface RetentionRepository {
  purgeConversationsBefore(cutoff: Date): Promise<number>;
  purgeLeadsBefore(cutoff: Date): Promise<number>;
}

export interface Store {
  products: ProductRepository;
  faqs: FaqRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  leads: LeadRepository;
  handoffs: HandoffRepository;
  staffUsers: StaffUserRepository;
  retention: RetentionRepository;
}

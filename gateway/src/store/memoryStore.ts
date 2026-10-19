import { randomUUID } from "node:crypto";
import {
  Store,
  ProductRepository,
  FaqRepository,
  ConversationRepository,
  MessageRepository,
  LeadRepository,
  HandoffRepository,
  StaffUserRepository,
  RetentionRepository
} from "./repositories.js";
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

function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function createMemoryStore(deps?: { now?: () => Date; newId?: () => string }): Store {
  const now = deps?.now ?? (() => new Date());
  const newId = deps?.newId ?? (() => randomUUID());

  const products = new Map<string, Product>();
  const faqs = new Map<string, Faq>();
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message[]>();
  const leads = new Map<string, Lead>();
  const handoffs = new Map<string, HandoffSession>();
  const staffUsers = new Map<string, StaffUser>();

  function cloneProduct(p: Product): Product {
    return { ...p };
  }

  function cloneFaq(f: Faq): Faq {
    return { ...f };
  }

  function cloneConversation(c: Conversation): Conversation {
    return { ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) };
  }

  function cloneMessage(m: Message): Message {
    return {
      ...m,
      createdAt: new Date(m.createdAt),
      sources: m.sources ? m.sources.map(s => ({ ...s })) : null
    };
  }

  function cloneLead(l: Lead): Lead {
    return {
      ...l,
      consentAt: new Date(l.consentAt),
      createdAt: new Date(l.createdAt)
    };
  }

  function cloneHandoffSession(h: HandoffSession): HandoffSession {
    return {
      ...h,
      createdAt: new Date(h.createdAt),
      updatedAt: new Date(h.updatedAt)
    };
  }

  function cloneStaffUser(s: StaffUser): StaffUser {
    return {
      ...s,
      createdAt: new Date(s.createdAt)
    };
  }

  const productRepo: ProductRepository = {
    async upsertMany(items: Product[]): Promise<{ inserted: number; updated: number }> {
      let inserted = 0;
      let updated = 0;
      for (const item of items) {
        const existing = products.get(item.sku);
        if (existing) {
          products.set(item.sku, cloneProduct(item));
          updated++;
        } else {
          products.set(item.sku, cloneProduct(item));
          inserted++;
        }
      }
      return { inserted, updated };
    },
    async findBySku(sku: string): Promise<Product | null> {
      const p = products.get(sku);
      return p ? cloneProduct(p) : null;
    },
    async listActive(): Promise<Product[]> {
      const result: Product[] = [];
      for (const p of products.values()) {
        if (p.isActive) {
          result.push(cloneProduct(p));
        }
      }
      return result;
    }
  };

  const faqRepo: FaqRepository = {
    async upsertMany(items: Faq[]): Promise<{ inserted: number; updated: number }> {
      let inserted = 0;
      let updated = 0;
      for (const item of items) {
        const existing = faqs.get(item.faqId);
        if (existing) {
          faqs.set(item.faqId, cloneFaq(item));
          updated++;
        } else {
          faqs.set(item.faqId, cloneFaq(item));
          inserted++;
        }
      }
      return { inserted, updated };
    },
    async findById(faqId: string): Promise<Faq | null> {
      const f = faqs.get(faqId);
      return f ? cloneFaq(f) : null;
    },
    async listAll(): Promise<Faq[]> {
      const result: Faq[] = [];
      for (const f of faqs.values()) {
        result.push(cloneFaq(f));
      }
      return result;
    }
  };

  const conversationRepo: ConversationRepository = {
    async create(tokenHash: string): Promise<Conversation> {
      const id = newId();
      const nowDate = now();
      const conv: Conversation = {
        conversationId: id,
        conversationTokenHash: tokenHash,
        createdAt: nowDate,
        updatedAt: nowDate
      };
      conversations.set(id, conv);
      messages.set(id, []);
      return cloneConversation(conv);
    },
    async findById(id: string): Promise<Conversation | null> {
      const c = conversations.get(id);
      return c ? cloneConversation(c) : null;
    },
    async touch(id: string): Promise<void> {
      const c = conversations.get(id);
      if (c) {
        c.updatedAt = now();
        conversations.set(id, c);
      }
    }
  };

  const messageRepo: MessageRepository = {
    async append(input: Omit<Message, "messageId" | "createdAt">): Promise<Message> {
      const conversationMessages = messages.get(input.conversationId);
      if (!conversationMessages) {
        throw new Error("Conversation not found");
      }
      const messageId = newId();
      const createdAt = now();
      const msg: Message = {
        messageId,
        createdAt,
        ...input
      };
      conversationMessages.push(msg);
      conversationMessages.sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        if (diff !== 0) return diff;
        return a.messageId.localeCompare(b.messageId);
      });
      return cloneMessage(msg);
    },
    async listSince(
      conversationId: string,
      since: { afterMessageId?: string; afterTime?: Date },
      limit: number
    ): Promise<Message[]> {
      const conversationMessages = messages.get(conversationId);
      if (!conversationMessages) {
        return [];
      }
      const maxLimit = 50;
      const realLimit = Math.min(limit, maxLimit);
      let filtered = conversationMessages;
      if (since.afterTime) {
        filtered = filtered.filter(m => m.createdAt > since.afterTime!);
      }
      if (since.afterMessageId) {
        const idx = filtered.findIndex(m => m.messageId === since.afterMessageId);
        if (idx >= 0) {
          filtered = filtered.slice(idx + 1);
        }
      }
      const result = filtered.slice(0, realLimit).map(cloneMessage);
      return result;
    }
  };

  const leadRepo: LeadRepository = {
    async create(input: Omit<Lead, "leadId" | "createdAt">): Promise<Lead> {
      const leadId = newId();
      const createdAt = now();
      const lead: Lead = {
        leadId,
        createdAt,
        ...input
      };
      leads.set(leadId, lead);
      return cloneLead(lead);
    },
    async list(limit: number, cursor?: string): Promise<{ items: Lead[]; nextCursor: string | null }> {
      const maxLimit = 100;
      const realLimit = Math.min(limit, maxLimit);
      const allLeads = Array.from(leads.values());
      allLeads.sort((a, b) => {
        const diff = b.createdAt.getTime() - a.createdAt.getTime();
        if (diff !== 0) return diff;
        return b.leadId.localeCompare(a.leadId);
      });
      let startIndex = 0;
      if (cursor) {
        startIndex = allLeads.findIndex(l => l.leadId === cursor);
        if (startIndex === -1) {
          startIndex = 0;
        } else {
          startIndex += 1;
        }
      }
      const pageItems = allLeads.slice(startIndex, startIndex + realLimit).map(cloneLead);
      const nextCursor = (startIndex + realLimit) < allLeads.length ? allLeads[startIndex + realLimit - 1].leadId : null;
      return { items: pageItems, nextCursor };
    }
  };

  const handoffRepo: HandoffRepository = {
    async openOrGet(conversationId: string): Promise<{ session: HandoffSession; created: boolean }> {
      for (const session of handoffs.values()) {
        if (session.conversationId === conversationId && session.status !== "closed") {
          return { session: cloneHandoffSession(session), created: false };
        }
      }
      const handoffId = newId();
      const nowDate = now();
      const session: HandoffSession = {
        handoffId,
        conversationId,
        staffUserId: null,
        status: "pending",
        createdAt: nowDate,
        updatedAt: nowDate
      };
      handoffs.set(handoffId, session);
      return { session: cloneHandoffSession(session), created: true };
    },
    async findOpenByConversation(conversationId: string): Promise<HandoffSession | null> {
      for (const session of handoffs.values()) {
        if (session.conversationId === conversationId && session.status !== "closed") {
          return cloneHandoffSession(session);
        }
      }
      return null;
    },
    async listQueue(): Promise<HandoffSession[]> {
      const filtered = Array.from(handoffs.values()).filter(s => s.status === "pending" || s.status === "accepted");
      filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return filtered.map(cloneHandoffSession);
    },
    async accept(handoffId: string, staffUserId: string): Promise<{ ok: true; session: HandoffSession } | { ok: false; reason: "NOT_FOUND" | "ALREADY_ACCEPTED" | "CLOSED" }> {
      const session = handoffs.get(handoffId);
      if (!session) {
        return { ok: false, reason: "NOT_FOUND" };
      }
      if (session.status === "closed") {
        return { ok: false, reason: "CLOSED" };
      }
      if (session.status === "accepted") {
        return { ok: false, reason: "ALREADY_ACCEPTED" };
      }
      session.status = "accepted";
      session.staffUserId = staffUserId;
      session.updatedAt = now();
      handoffs.set(handoffId, session);
      return { ok: true, session: cloneHandoffSession(session) };
    },
    async close(handoffId: string): Promise<HandoffSession | null> {
      const session = handoffs.get(handoffId);
      if (!session) {
        return null;
      }
      if (session.status === "closed") {
        return cloneHandoffSession(session);
      }
      session.status = "closed";
      session.updatedAt = now();
      handoffs.set(handoffId, session);
      return cloneHandoffSession(session);
    }
  };

  const staffUserRepo: StaffUserRepository = {
    async upsert(user: Omit<StaffUser, "staffUserId" | "createdAt">): Promise<StaffUser> {
      let existing: StaffUser | undefined;
      for (const u of staffUsers.values()) {
        if (u.username === user.username) {
          existing = u;
          break;
        }
      }
      if (existing) {
        const updated: StaffUser = {
          staffUserId: existing.staffUserId,
          createdAt: existing.createdAt,
          ...user
        };
        staffUsers.set(existing.staffUserId, updated);
        return cloneStaffUser(updated);
      } else {
        const staffUserId = newId();
        const createdAt = now();
        const newUser: StaffUser = {
          staffUserId,
          createdAt,
          ...user
        };
        staffUsers.set(staffUserId, newUser);
        return cloneStaffUser(newUser);
      }
    },
    async findByUsername(username: string): Promise<StaffUser | null> {
      for (const u of staffUsers.values()) {
        if (u.username === username) {
          return cloneStaffUser(u);
        }
      }
      return null;
    }
  };

  const retentionRepo: RetentionRepository = {
    async purgeConversationsBefore(cutoff: Date): Promise<number> {
      let deletedCount = 0;
      const toDelete: string[] = [];
      for (const [id, conv] of conversations.entries()) {
        if (conv.updatedAt < cutoff) {
          toDelete.push(id);
        }
      }
      for (const id of toDelete) {
        conversations.delete(id);
        messages.delete(id);
        for (const [handoffId, session] of handoffs.entries()) {
          if (session.conversationId === id) {
            handoffs.delete(handoffId);
          }
        }
        deletedCount++;
      }
      return deletedCount;
    },
    async purgeLeadsBefore(cutoff: Date): Promise<number> {
      let deletedCount = 0;
      for (const [id, lead] of leads.entries()) {
        if (lead.createdAt < cutoff) {
          leads.delete(id);
          deletedCount++;
        }
      }
      return deletedCount;
    }
  };

  return {
    products: productRepo,
    faqs: faqRepo,
    conversations: conversationRepo,
    messages: messageRepo,
    leads: leadRepo,
    handoffs: handoffRepo,
    staffUsers: staffUserRepo,
    retention: retentionRepo
  };
}

export interface Product {
  sku: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  isActive: boolean;
}

export interface Faq {
  faqId: string;
  question: string;
  answer: string;
  category: string | null;
}

export interface Conversation {
  conversationId: string;
  conversationTokenHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SenderType = "customer" | "ai" | "staff" | "system";

export type Source =
  | { type: "product"; sku: string }
  | { type: "faq"; faqId: string };

export interface Message {
  messageId: string;
  conversationId: string;
  senderType: SenderType;
  content: string;
  sources: Source[] | null;
  handoffSuggested: boolean;
  createdAt: Date;
}

export interface Lead {
  leadId: string;
  name: string;
  phone: string;
  need: string | null;
  conversationId: string | null;
  consentAt: Date;
  createdAt: Date;
}

export type HandoffStatus = "pending" | "accepted" | "closed";

export interface HandoffSession {
  handoffId: string;
  conversationId: string;
  staffUserId: string | null;
  status: HandoffStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffUser {
  staffUserId: string;
  username: string;
  passwordHash: string;
  role: "admin" | "staff";
  createdAt: Date;
}

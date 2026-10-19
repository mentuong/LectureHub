import type { Store } from "../store/repositories.js";
import type { Product, Faq } from "../store/types.js";
import { tokenize } from "./text.js";

export type DocSource =
  | { type: "product"; sku: string }
  | { type: "faq"; faqId: string };

export type RetrievedDoc = {
  source: DocSource;
  title: string;
  text: string;
  score: number; // normalized 0..1
  rawScore: number; // BM25 raw score
};

interface IndexedDoc {
  source: DocSource;
  title: string;
  text: string;
  indexTokens: string[];
}

export class Retriever {
  private docs: IndexedDoc[];
  private N: number; // total docs
  private dfMap: Map<string, number>; // document frequency per token
  private avgDocLen: number; // average doc length in tokens

  private static k1 = 1.2;
  private static b = 0.75;

  private constructor(docs: Array<{ source: DocSource; title: string; text: string; indexText: string }>) {
    this.docs = docs.map(d => ({
      source: d.source,
      title: d.title,
      text: d.text,
      indexTokens: tokenize(d.indexText)
    }));
    this.N = this.docs.length;

    // Compute dfMap
    this.dfMap = new Map();
    for (const doc of this.docs) {
      const uniqueTokens = new Set(doc.indexTokens);
      for (const token of uniqueTokens) {
        this.dfMap.set(token, (this.dfMap.get(token) ?? 0) + 1);
      }
    }

    // Compute average document length
    const totalLen = this.docs.reduce((acc, d) => acc + d.indexTokens.length, 0);
    this.avgDocLen = this.N === 0 ? 0 : totalLen / this.N;
  }

  static async fromStore(store: Store): Promise<Retriever> {
    // Load active products
    const products = await store.products.listActive();
    // Load all FAQs
    const faqs = await store.faqs.listAll();

    const docs: Array<{ source: DocSource; title: string; text: string; indexText: string }> = [];

    for (const p of products) {
      if (!p.isActive) continue; // safety check
      const indexTextParts = [p.name, p.description ?? '', p.category ?? '', p.sku];
      const indexText = indexTextParts.filter(Boolean).join(' ');
      const title = p.name;
      const text = `${p.name} – giá ${p.price} ${p.currency}` + (p.description ? ` ${p.description}` : '');
      docs.push({ source: { type: 'product', sku: p.sku }, title, text, indexText });
    }

    for (const f of faqs) {
      const indexTextParts = [f.question, f.answer, f.category ?? ''];
      const indexText = indexTextParts.filter(Boolean).join(' ');
      const title = f.question;
      const text = f.answer;
      docs.push({ source: { type: 'faq', faqId: f.faqId }, title, text, indexText });
    }

    return new Retriever(docs);
  }

  private idf(token: string): number {
    // idf = ln(1 + (N - df + 0.5) / (df + 0.5))
    const df = this.dfMap.get(token) ?? 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  private bm25Score(queryTokens: string[], docTokens: string[]): number {
    if (docTokens.length === 0) return 0;

    const k1 = Retriever.k1;
    const b = Retriever.b;
    const docLen = docTokens.length;

    // Term frequency map for doc
    const tfMap = new Map<string, number>();
    for (const t of docTokens) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }

    let score = 0;
    for (const qToken of queryTokens) {
      const idf = this.idf(qToken);
      const tf = tfMap.get(qToken) ?? 0;
      if (tf === 0) continue;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / this.avgDocLen));
      score += idf * (numerator / denominator);
    }
    return score;
  }

  search(query: string, options?: { threshold?: number; limit?: number }): RetrievedDoc[] {
    const threshold = options?.threshold ?? 0.5;
    let limit = options?.limit ?? 5;
    if (limit > 20) limit = 20;

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Compute raw BM25 scores
    const scoredDocs: Array<{ doc: IndexedDoc; rawScore: number }> = [];
    for (const doc of this.docs) {
      const rawScore = this.bm25Score(queryTokens, doc.indexTokens);
      if (rawScore > 0) {
        scoredDocs.push({ doc, rawScore });
      }
    }

    if (scoredDocs.length === 0) return [];

    // Compute total idf of unique query tokens
    const uniqueQueryTokens = new Set(queryTokens);
    let totalIdf = 0;
    for (const t of uniqueQueryTokens) {
      totalIdf += this.idf(t);
    }
    if (totalIdf === 0) return []; // avoid div by zero

    // Compute normalized score per doc
    // normalized score = sum idf of query tokens in doc / total idf
    // We approximate sum idf of query tokens in doc by summing idf of tokens that appear in doc
    // We can reuse tfMap from bm25Score but we don't keep it, so recompute here

    // To optimize, we can reuse tfMap from bm25Score, but for simplicity recompute here

    const results: RetrievedDoc[] = scoredDocs.map(({ doc, rawScore }) => {
      const docTokensSet = new Set(doc.indexTokens);
      let sumIdfInDoc = 0;
      for (const t of uniqueQueryTokens) {
        if (docTokensSet.has(t)) {
          sumIdfInDoc += this.idf(t);
        }
      }
      const score = sumIdfInDoc / totalIdf;
      return {
        source: doc.source,
        title: doc.title,
        text: doc.text,
        score,
        rawScore
      };
    });

    // Filter by threshold
    const filtered = results.filter(r => r.score >= threshold);

    // Sort by score desc, then rawScore desc
    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.rawScore - a.rawScore;
    });

    return filtered.slice(0, limit);
  }
}

export function parseThreshold(env: Record<string, string | undefined>): number {
  const raw = env.RETRIEVAL_THRESHOLD;
  if (raw === undefined) return 0.5;
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(`Invalid RETRIEVAL_THRESHOLD value: empty string`);
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    throw new Error(`Invalid RETRIEVAL_THRESHOLD value: ${raw}`);
  }
  return num;
}

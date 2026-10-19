import type { Product, Faq } from "../store/types.js";
import type { Store } from "../store/repositories.js";
import { parseCsv } from "./csv.js";

export type ImportInput = {
  type: "product" | "faq";
  format: "csv" | "json";
  data: string;
};

export type ImportRowError = {
  line: number;
  field: string;
  message: string;
};

export type ImportResult = {
  imported: number;
  updated: number;
  errors: ImportRowError[];
};

export class ImportError extends Error {
  code: "PAYLOAD_TOO_LARGE" | "INVALID_FORMAT" | "MISSING_COLUMNS";

  constructor(code: "PAYLOAD_TOO_LARGE" | "INVALID_FORMAT" | "MISSING_COLUMNS", message?: string) {
    super(message ?? code);
    this.code = code;
    Object.setPrototypeOf(this, ImportError.prototype);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBoolean(value: unknown): boolean | null {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return null;
}

function normalizeStringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validateSkuOrFaqId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return trimmed;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function parseIsActive(value: unknown): boolean | null {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return null;
  }
  return null;
}

function parseOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toLowerTrim(s: string): string {
  return s.trim().toLowerCase();
}

function checkRequiredColumns(
  headers: string[],
  required: string[]
): { missing: string[]; map: Map<string, number> } {
  const map = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    map.set(toLowerTrim(headers[i]), i);
  }
  const missing = required.filter((col) => !map.has(toLowerTrim(col)));
  return { missing, map };
}

export async function importCatalog(store: Store, input: ImportInput): Promise<ImportResult> {
  const MAX_SIZE = 1024 * 1024;
  if (Buffer.byteLength(input.data, "utf8") > MAX_SIZE) {
    throw new ImportError("PAYLOAD_TOO_LARGE", "Payload exceeds 1MB size limit");
  }

  const errors: ImportRowError[] = [];
  let imported = 0;
  let updated = 0;

  if (input.format === "csv") {
    const rows = parseCsv(input.data);
    if (rows.length === 0) {
      return { imported: 0, updated: 0, errors };
    }

    const headerRow = rows[0];
    const requiredColumns = input.type === "product"
      ? ["sku", "name", "price"]
      : ["faqid", "question", "answer"];

    const { missing, map } = checkRequiredColumns(headerRow, requiredColumns);
    if (missing.length > 0) {
      throw new ImportError("MISSING_COLUMNS", `Missing required columns: ${missing.join(", ")}`);
    }

    const seenKeys = new Set<string>();
    const itemsToUpsert: (Product | Faq)[] = [];

    for (let i = 1; i < rows.length; i++) {
      const lineNum = i + 1;
      const row = rows[i];

      const getField = (field: string): string => {
        const idx = map.get(toLowerTrim(field));
        if (idx === undefined || idx >= row.length) return "";
        return row[idx];
      };

      if (input.type === "product") {
        const skuRaw = getField("sku");
        const nameRaw = getField("name");
        const priceRaw = getField("price");

        const sku = validateSkuOrFaqId(skuRaw);
        if (!sku) {
          errors.push({ line: lineNum, field: "sku", message: "sku is required, non-empty, max 64 chars" });
          continue;
        }
        if (seenKeys.has(sku)) {
          errors.push({ line: lineNum, field: "sku", message: "Duplicate sku in file" });
          continue;
        }
        seenKeys.add(sku);

        const name = normalizeStringField(nameRaw);
        if (!name) {
          errors.push({ line: lineNum, field: "name", message: "name is required and cannot be empty" });
          continue;
        }

        const price = parsePrice(priceRaw);
        if (price === null) {
          errors.push({ line: lineNum, field: "price", message: "price must be a finite number >= 0" });
          continue;
        }

        const description = parseOptionalString(getField("description"));
        const currencyRaw = getField("currency");
        const currency = currencyRaw.trim() === "" ? "VND" : currencyRaw.trim() || "VND";
        const category = parseOptionalString(getField("category"));
        const isActiveRaw = getField("isActive");
        const isActiveParsed = isActiveRaw === "" ? true : parseIsActive(isActiveRaw);
        if (isActiveParsed === null) {
          errors.push({ line: lineNum, field: "isActive", message: "isActive must be true/false/1/0 or empty" });
          continue;
        }

        const product: Product = {
          sku,
          name,
          description,
          price,
          currency,
          category,
          isActive: isActiveParsed
        };

        itemsToUpsert.push(product);
      } else {
        const faqIdRaw = getField("faqid");
        const questionRaw = getField("question");
        const answerRaw = getField("answer");

        const faqId = validateSkuOrFaqId(faqIdRaw);
        if (!faqId) {
          errors.push({ line: lineNum, field: "faqId", message: "faqId is required, non-empty, max 64 chars" });
          continue;
        }
        if (seenKeys.has(faqId)) {
          errors.push({ line: lineNum, field: "faqId", message: "Duplicate faqId in file" });
          continue;
        }
        seenKeys.add(faqId);

        const question = normalizeStringField(questionRaw);
        if (!question) {
          errors.push({ line: lineNum, field: "question", message: "question is required and cannot be empty" });
          continue;
        }

        const answer = normalizeStringField(answerRaw);
        if (!answer) {
          errors.push({ line: lineNum, field: "answer", message: "answer is required and cannot be empty" });
          continue;
        }

        const category = parseOptionalString(getField("category"));

        const faq: Faq = {
          faqId,
          question,
          answer,
          category
        };

        itemsToUpsert.push(faq);
      }
    }

    if (input.type === "product") {
      const res = await store.products.upsertMany(itemsToUpsert as Product[]);
      imported = res.inserted;
      updated = res.updated;
    } else {
      const res = await store.faqs.upsertMany(itemsToUpsert as Faq[]);
      imported = res.inserted;
      updated = res.updated;
    }

    return { imported, updated, errors };
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.data);
    } catch {
      throw new ImportError("INVALID_FORMAT", "Invalid JSON format");
    }

    if (!Array.isArray(parsed)) {
      throw new ImportError("INVALID_FORMAT", "JSON must be an array of objects");
    }

    const errors: ImportRowError[] = [];
    const seenKeys = new Set<string>();
    const itemsToUpsert: (Product | Faq)[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const lineNum = i + 1;
      const obj = parsed[i];

      if (typeof obj !== "object" || obj === null) {
        errors.push({ line: lineNum, field: "", message: "Item is not an object" });
        continue;
      }

      if (input.type === "product") {
        const sku = validateSkuOrFaqId(obj["sku"]);
        if (!sku) {
          errors.push({ line: lineNum, field: "sku", message: "sku is required, non-empty, max 64 chars" });
          continue;
        }
        if (seenKeys.has(sku)) {
          errors.push({ line: lineNum, field: "sku", message: "Duplicate sku in file" });
          continue;
        }
        seenKeys.add(sku);

        const name = normalizeStringField(obj["name"]);
        if (!name) {
          errors.push({ line: lineNum, field: "name", message: "name is required and cannot be empty" });
          continue;
        }

        const price = parsePrice(obj["price"]);
        if (price === null) {
          errors.push({ line: lineNum, field: "price", message: "price must be a finite number >= 0" });
          continue;
        }

        const description = parseOptionalString(obj["description"]);
        const currencyRaw = obj["currency"];
        const currency = typeof currencyRaw === "string" && currencyRaw.trim() !== "" ? currencyRaw.trim() : "VND";
        const category = parseOptionalString(obj["category"]);
        const isActiveRaw = obj["isActive"];
        const isActiveParsed = isActiveRaw === undefined ? true : parseIsActive(isActiveRaw);
        if (isActiveParsed === null) {
          errors.push({ line: lineNum, field: "isActive", message: "isActive must be true/false/1/0 or empty" });
          continue;
        }

        const product: Product = {
          sku,
          name,
          description,
          price,
          currency,
          category,
          isActive: isActiveParsed
        };

        itemsToUpsert.push(product);
      } else {
        const faqId = validateSkuOrFaqId(obj["faqId"]);
        if (!faqId) {
          errors.push({ line: lineNum, field: "faqId", message: "faqId is required, non-empty, max 64 chars" });
          continue;
        }
        if (seenKeys.has(faqId)) {
          errors.push({ line: lineNum, field: "faqId", message: "Duplicate faqId in file" });
          continue;
        }
        seenKeys.add(faqId);

        const question = normalizeStringField(obj["question"]);
        if (!question) {
          errors.push({ line: lineNum, field: "question", message: "question is required and cannot be empty" });
          continue;
        }

        const answer = normalizeStringField(obj["answer"]);
        if (!answer) {
          errors.push({ line: lineNum, field: "answer", message: "answer is required and cannot be empty" });
          continue;
        }

        const category = parseOptionalString(obj["category"]);

        const faq: Faq = {
          faqId,
          question,
          answer,
          category
        };

        itemsToUpsert.push(faq);
      }
    }

    if (input.type === "product") {
      const res = await store.products.upsertMany(itemsToUpsert as Product[]);
      imported = res.inserted;
      updated = res.updated;
    } else {
      const res = await store.faqs.upsertMany(itemsToUpsert as Faq[]);
      imported = res.inserted;
      updated = res.updated;
    }

    return { imported, updated, errors };
  }
}

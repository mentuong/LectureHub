import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/catalog/csv.js";
import { importCatalog, ImportError } from "../src/catalog/importService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

// Helper to create store with now and newId
function createTestStore() {
  return createMemoryStore({
    now: () => new Date(2023, 0, 1, 0, 0, 0),
    newId: () => "id-" + Math.random().toString(36).slice(2, 10)
  });
}

// parseCsv tests

test("parseCsv handles quoted fields with commas, newlines, CRLF, BOM, and trailing empty lines", () => {
  const csvText = "\uFEFF" +
    'sku,name,description\r\n' +
    'sku1,"Name, with comma","Line1\nLine2"\n' +
    'sku2,"Name with ""quote""",desc2\r\n' +
    '\r\n';

  const rows = parseCsv(csvText);
  assert.deepEqual(rows, [
    ["sku", "name", "description"],
    ["sku1", "Name, with comma", "Line1\nLine2"],
    ["sku2", "Name with \"quote\"", "desc2"]
  ]);
});

// Product CSV valid import

test("importCatalog imports valid product CSV and updates existing", async () => {
  const store = createTestStore();
  const csv = "sku,name,price\n" +
    "sku1,Product One,100\n" +
    "sku2,Product Two,200\n";

  const result1 = await importCatalog(store, { type: "product", format: "csv", data: csv });
  assert.equal(result1.imported, 2);
  assert.equal(result1.updated, 0);
  assert.equal(result1.errors.length, 0);

  // Update sku1 price
  const csvUpdate = "sku,name,price\nsku1,Product One,150000\n";
  const result2 = await importCatalog(store, { type: "product", format: "csv", data: csvUpdate });
  assert.equal(result2.imported, 0);
  assert.equal(result2.updated, 1);
  assert.equal(result2.errors.length, 0);

  const p = await store.products.findBySku("sku1");
  assert(p !== null);
  assert.equal(p.price, 150000);
});

// Product CSV with errors

test("importCatalog reports errors and imports valid rows", async () => {
  const store = createTestStore();
  const csv = "sku,name,price,isActive\n" +
    "sku1,Product One,100,true\n" +
    "sku2,,50,true\n" + // missing name
    "sku3,Product Three,-10,true\n" + // negative price
    "sku4,Product Four,200,maybe\n" + // invalid isActive
    "sku1,Duplicate SKU,300,true\n"; // duplicate sku

  const result = await importCatalog(store, { type: "product", format: "csv", data: csv });
  assert.equal(result.imported, 1); // only sku1 first line
  assert.equal(result.updated, 0);
  assert.equal(result.errors.length, 4);

  const errFields = result.errors.map(e => e.field).sort();
  assert.deepEqual(errFields, ["isActive", "name", "price", "sku"]);

  const p = await store.products.findBySku("sku1");
  assert(p !== null);
  assert.equal(p.price, 100);
});

// Missing required column

test("importCatalog throws MISSING_COLUMNS for missing required column", async () => {
  const store = createTestStore();
  const csv = "sku,name\nsku1,Product One\n"; // missing price

  await assert.rejects(
    () => importCatalog(store, { type: "product", format: "csv", data: csv }),
    (err) => err instanceof ImportError && err.code === "MISSING_COLUMNS"
  );

  // Store should be empty
  const p = await store.products.findBySku("sku1");
  assert.equal(p, null);
});

// JSON not array

test("importCatalog throws INVALID_FORMAT if JSON is not array", async () => {
  const store = createTestStore();
  const json = "{ \"sku\": \"sku1\" }";

  await assert.rejects(
    () => importCatalog(store, { type: "product", format: "json", data: json }),
    (err) => err instanceof ImportError && err.code === "INVALID_FORMAT"
  );
});

// FAQ JSON valid import

test("importCatalog imports valid FAQ JSON", async () => {
  const store = createTestStore();
  const json = JSON.stringify([
    { faqId: "faq1", question: "Q1", answer: "A1", category: "cat1" },
    { faqId: "faq2", question: "Q2", answer: "A2" }
  ]);

  const result = await importCatalog(store, { type: "faq", format: "json", data: json });
  assert.equal(result.imported, 2);
  assert.equal(result.updated, 0);
  assert.equal(result.errors.length, 0);

  const f1 = await store.faqs.findById("faq1");
  assert(f1 !== null);
  assert.equal(f1.category, "cat1");

  const f2 = await store.faqs.findById("faq2");
  assert(f2 !== null);
  assert.equal(f2.category, null);
});

// Payload too large

test("importCatalog throws PAYLOAD_TOO_LARGE for >1MB data", async () => {
  const store = createTestStore();
  const largeData = "a".repeat(1024 * 1024 + 1);

  await assert.rejects(
    () => importCatalog(store, { type: "product", format: "csv", data: largeData }),
    (err) => err instanceof ImportError && err.code === "PAYLOAD_TOO_LARGE"
  );
});

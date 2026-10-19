import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { signJwt, verifyJwt, JwtError } from "../src/auth/jwt.js";
import { seedAdminFromEnv, login, AuthError, requireAdminJwtSecret } from "../src/auth/authService.js";
import { createMemoryStore } from "../src/store/memoryStore.js";

const TEST_SECRET = "a".repeat(32);
const NOW = new Date(1686000000000);
const TEST_N = 1024;

function fakeNow(date: Date): () => Date {
  return () => new Date(date);
}

test("hashPassword and verifyPassword success and failure", async () => {
  const password = "mysecretpassword";
  const hash = await hashPassword(password, { N: TEST_N });
  assert.ok(hash.startsWith("scrypt$"));
  const verified = await verifyPassword(password, hash);
  assert.equal(verified, true);
  const wrong = await verifyPassword("wrongpassword", hash);
  assert.equal(wrong, false);
});

test("verifyPassword returns false on malformed stored string", async () => {
  assert.equal(await verifyPassword("pass", ""), false);
  assert.equal(await verifyPassword("pass", "scrypt$123$8$1$abc"), false);
  assert.equal(await verifyPassword("pass", "wrongprefix$16384$8$1$abc$def"), false);
  assert.equal(await verifyPassword("pass", "scrypt$notanumber$8$1$abc$def"), false);
  assert.equal(await verifyPassword("pass", "scrypt$16384$8$1$notbase64$def"), false);
  assert.equal(await verifyPassword("pass", "scrypt$16384$8$1$abc$notbase64"), false);
});

const payload = { sub: "user1", role: "admin" as const };

test("signJwt and verifyJwt round-trip", () => {
  const token = signJwt(payload, TEST_SECRET, { ttlSeconds: 60, now: fakeNow(NOW) });
  const decoded = verifyJwt(token, TEST_SECRET, { now: fakeNow(NOW) });
  assert.equal(decoded.sub, payload.sub);
  assert.equal(decoded.role, payload.role);
  assert.ok(typeof decoded.iat === "number");
  assert.ok(typeof decoded.exp === "number");
});

test("verifyJwt throws BAD_SIGNATURE if payload modified", () => {
  const token = signJwt(payload, TEST_SECRET, { ttlSeconds: 60, now: fakeNow(NOW) });
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  const payloadBuf = Buffer.from(parts[1], "base64");
  const payloadStr = payloadBuf.toString("utf8");
  const payloadObj = JSON.parse(payloadStr);
  payloadObj.sub = payloadObj.sub + "x";
  const newPayloadStr = JSON.stringify(payloadObj);
  const newPayloadB64 = Buffer.from(newPayloadStr, "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const tamperedToken = `${parts[0]}.${newPayloadB64}.${parts[2]}`;
  assert.throws(() => verifyJwt(tamperedToken, TEST_SECRET, { now: fakeNow(NOW) }), err => err instanceof JwtError && err.code === "BAD_SIGNATURE");
});

test("verifyJwt throws UNSUPPORTED_ALG for alg none", () => {
  const header = { alg: "none", typ: "JWT" };
  const payloadFull = { sub: "user1", role: "admin", iat: 1, exp: 9999999999 };
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encodedPayload = Buffer.from(JSON.stringify(payloadFull), "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const token = `${encodedHeader}.${encodedPayload}.`;
  assert.throws(() => verifyJwt(token, TEST_SECRET, { now: fakeNow(NOW) }), err => err instanceof JwtError && err.code === "UNSUPPORTED_ALG");
});

test("verifyJwt throws EXPIRED if token expired", () => {
  const token = signJwt(payload, TEST_SECRET, { ttlSeconds: 1, now: fakeNow(NOW) });
  const later = new Date(NOW.getTime() + 2000);
  assert.throws(() => verifyJwt(token, TEST_SECRET, { now: fakeNow(later) }), err => err instanceof JwtError && err.code === "EXPIRED");
});

test("verifyJwt throws MALFORMED on garbage token", () => {
  assert.throws(() => verifyJwt("garbage", TEST_SECRET, { now: fakeNow(NOW) }), err => err instanceof JwtError && err.code === "MALFORMED");
});

test("signJwt and verifyJwt throw if secret too short", () => {
  const shortSecret = "short";
  assert.throws(() => signJwt(payload, shortSecret, { ttlSeconds: 60, now: fakeNow(NOW) }), /Secret must be a string/);
  const token = signJwt(payload, TEST_SECRET, { ttlSeconds: 60, now: fakeNow(NOW) });
  assert.throws(() => verifyJwt(token, shortSecret, { now: fakeNow(NOW) }), /Secret must be a string/);
});

test("seedAdminFromEnv returns false if both missing", async () => {
  const store = createMemoryStore();
  const result = await seedAdminFromEnv(store, {});
  assert.equal(result, false);
});

test("seedAdminFromEnv throws if only one env var set", async () => {
  const store = createMemoryStore();
  await assert.rejects(() => seedAdminFromEnv(store, { ADMIN_USERNAME: "admin" }), /Both ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set/);
  await assert.rejects(() => seedAdminFromEnv(store, { ADMIN_PASSWORD_HASH: "scrypt$1024$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), /Both ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set/);
});

test("seedAdminFromEnv throws if password hash invalid format", async () => {
  const store = createMemoryStore();
  await assert.rejects(() => seedAdminFromEnv(store, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: "badformat" }), /not a valid scrypt hash format/);
});

test("seedAdminFromEnv inserts admin user", async () => {
  const store = createMemoryStore();
  const hash = await hashPassword("password", { N: TEST_N });
  const result = await seedAdminFromEnv(store, { ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: hash });
  assert.equal(result, true);
  const user = await store.staffUsers.findByUsername("admin");
  assert.ok(user);
  assert.equal(user?.role, "admin");
  assert.equal(user?.passwordHash, hash);
});

test("login success returns token that verifies", async () => {
  const store = createMemoryStore();
  const password = "mypassword";
  const hash = await hashPassword(password, { N: TEST_N });
  await store.staffUsers.upsert({ username: "user1", passwordHash: hash, role: "staff" });
  const { token, expiresAt } = await login(store, "user1", password, { secret: TEST_SECRET, now: () => NOW });
  assert.ok(token.length > 0);
  assert.ok(expiresAt > NOW);
  const payload = verifyJwt(token, TEST_SECRET, { now: () => NOW });
  assert.equal(payload.sub, (await store.staffUsers.findByUsername("user1"))?.staffUserId);
  assert.equal(payload.role, "staff");
});

test("login fails with wrong username or password with same error", async () => {
  const store = createMemoryStore();
  const password = "mypassword";
  const hash = await hashPassword(password, { N: TEST_N });
  await store.staffUsers.upsert({ username: "user1", passwordHash: hash, role: "staff" });
  await assert.rejects(() => login(store, "user1", "wrongpass", { secret: TEST_SECRET }), err => err instanceof AuthError);
  await assert.rejects(() => login(store, "nouser", "any", { secret: TEST_SECRET }), err => err instanceof AuthError);
});

test("requireAdminJwtSecret returns secret if valid", () => {
  const env = { ADMIN_JWT_SECRET: TEST_SECRET };
  const secret = requireAdminJwtSecret(env);
  assert.equal(secret, TEST_SECRET);
});

test("requireAdminJwtSecret throws if missing or short", () => {
  assert.throws(() => requireAdminJwtSecret({}), /ADMIN_JWT_SECRET environment variable is required/);
  assert.throws(() => requireAdminJwtSecret({ ADMIN_JWT_SECRET: "short" }), /ADMIN_JWT_SECRET environment variable is required/);
});

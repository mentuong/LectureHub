import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

const DEFAULT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) {
    str += "=";
  }
  return Buffer.from(str, "base64");
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(
  password: string,
  opts?: { N?: number }
): Promise<string> {
  const N = opts?.N ?? DEFAULT_PARAMS.N;
  const r = DEFAULT_PARAMS.r;
  const p = DEFAULT_PARAMS.p;
  if (!Number.isInteger(N) || N <= 1) {
    throw new Error("Invalid scrypt parameter N");
  }
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 });
  const saltB64 = salt.toString("base64");
  const hashB64 = derivedKey.toString("base64");
  return `scrypt$${N}$${r}$${p}$${saltB64}$${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [prefix, Nstr, rstr, pstr, saltB64, hashB64] = parts;
  if (prefix !== "scrypt") return false;
  const N = Number(Nstr);
  const r = Number(rstr);
  const p = Number(pstr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    hash = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length !== SALT_LENGTH || hash.length !== KEY_LENGTH) return false;
  let derivedKey: Buffer;
  try {
    derivedKey = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  if (derivedKey.length !== hash.length) return false;
  try {
    return timingSafeEqual(derivedKey, hash);
  } catch {
    return false;
  }
}

import type { Store } from "../store/repositories.js";
import type { StaffUser } from "../store/types.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signJwt, verifyJwt, JwtError } from "./jwt.js";

export class AuthError extends Error {
  readonly code = "INVALID_CREDENTIALS" as const;

  constructor(message?: string) {
    super(message ?? "Invalid credentials");
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

function isScryptHashFormat(hash: string): boolean {
  if (typeof hash !== "string") return false;
  const parts = hash.split("$");
  if (parts.length !== 6) return false;
  if (parts[0] !== "scrypt") return false;
  const [_, N, r, p, saltB64, hashB64] = parts;
  if (!Number.isInteger(Number(N)) || !Number.isInteger(Number(r)) || !Number.isInteger(Number(p))) return false;
  try {
    Buffer.from(saltB64, "base64");
    Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  return true;
}

export async function seedAdminFromEnv(
  store: Store,
  env: Record<string, string | undefined>
): Promise<boolean> {
  const username = env.ADMIN_USERNAME;
  const passwordHash = env.ADMIN_PASSWORD_HASH;
  if (username === undefined && passwordHash === undefined) {
    return false;
  }
  if (username === undefined || passwordHash === undefined) {
    throw new Error("Both ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set or both unset");
  }
  if (!isScryptHashFormat(passwordHash)) {
    throw new Error("ADMIN_PASSWORD_HASH is not a valid scrypt hash format");
  }
  await store.staffUsers.upsert({ username, passwordHash, role: "admin" });
  return true;
}

export async function login(
  store: Store,
  username: string,
  password: string,
  opts: { secret: string; ttlSeconds?: number; now?: () => Date }
): Promise<{ token: string; expiresAt: Date }> {
  const ttlSeconds = opts.ttlSeconds ?? 3600;
  const now = opts.now ?? (() => new Date());
  const user = await store.staffUsers.findByUsername(username);
  if (!user) {
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").catch(() => {});
    throw new AuthError();
  }
  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    throw new AuthError();
  }
  const token = signJwt(
    { sub: user.staffUserId, role: user.role },
    opts.secret,
    { ttlSeconds, now }
  );
  const expiresAt = new Date(now().getTime() + ttlSeconds * 1000);
  return { token, expiresAt };
}

export function requireAdminJwtSecret(env: Record<string, string | undefined>): string {
  const secret = env.ADMIN_JWT_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("ADMIN_JWT_SECRET environment variable is required and must be at least 32 characters long");
  }
  return secret;
}

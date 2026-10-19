import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtPayload = {
  sub: string;
  role: "admin" | "staff";
  iat: number;
  exp: number;
};

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  let str = input.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) {
    str += "=";
  }
  return Buffer.from(str, "base64");
}

function isValidSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Secret must be a string with at least 32 characters");
  }
}

export class JwtError extends Error {
  code: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "UNSUPPORTED_ALG";

  constructor(code: JwtError["code"], message?: string) {
    super(message ?? code);
    this.code = code;
    Object.setPrototypeOf(this, JwtError.prototype);
  }
}

export function signJwt(
  payload: { sub: string; role: "admin" | "staff" },
  secret: string,
  opts: { ttlSeconds: number; now: () => Date }
): string {
  isValidSecret(secret);
  const header = { alg: "HS256", typ: "JWT" };
  const now = opts.now();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + opts.ttlSeconds;
  const fullPayload: JwtPayload = {
    sub: payload.sub,
    role: payload.role,
    iat,
    exp
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  const signature = hmac.digest();
  const encodedSignature = base64UrlEncode(signature);
  return `${data}.${encodedSignature}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  opts: { now: () => Date }
): JwtPayload {
  isValidSecret(secret);
  if (typeof token !== "string") {
    throw new JwtError("MALFORMED", "Token must be a string");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtError("MALFORMED", "Token must have 3 parts");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header: { alg: string; typ: string };
  let payload: JwtPayload;
  try {
    const headerJson = base64UrlDecode(encodedHeader).toString("utf8");
    header = JSON.parse(headerJson);
  } catch {
    throw new JwtError("MALFORMED", "Invalid header encoding or JSON");
  }
  if (header.alg !== "HS256") {
    throw new JwtError("UNSUPPORTED_ALG", `Unsupported alg: ${header.alg}`);
  }
  try {
    const payloadJson = base64UrlDecode(encodedPayload).toString("utf8");
    payload = JSON.parse(payloadJson);
  } catch {
    throw new JwtError("MALFORMED", "Invalid payload encoding or JSON");
  }
  if (
    typeof payload.sub !== "string" ||
    (payload.role !== "admin" && payload.role !== "staff") ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new JwtError("MALFORMED", "Payload missing required fields or invalid types");
  }
  const data = `${encodedHeader}.${encodedPayload}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(data);
  const expectedSignature = hmac.digest();
  let signature: Buffer;
  try {
    signature = base64UrlDecode(encodedSignature);
  } catch {
    throw new JwtError("MALFORMED", "Invalid signature encoding");
  }
  if (signature.length !== expectedSignature.length) {
    throw new JwtError("BAD_SIGNATURE", "Signature length mismatch");
  }
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new JwtError("BAD_SIGNATURE", "Signature does not match");
  }
  const nowSeconds = Math.floor(opts.now().getTime() / 1000);
  if (payload.exp <= nowSeconds) {
    throw new JwtError("EXPIRED", "Token expired");
  }
  return payload;
}

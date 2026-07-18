import crypto from "crypto";

// Salted scrypt hashes for guest passwords (stored as "salt:hash").

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), test);
  } catch {
    return false;
  }
}

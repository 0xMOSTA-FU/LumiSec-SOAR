// AES-256-GCM secrets encryption for integration credentials.
// In production, the master key lives in HashiCorp Vault / AWS KMS / Azure Key Vault.
// In dev, it's read from the ENCRYPTION_KEY env var (base64-encoded 32-byte key).
//
// Security guarantees:
// - Each ciphertext has a unique IV (96-bit, crypto-random per call).
// - GCM provides authenticated encryption (integrity + confidentiality).
// - The key NEVER enters the database; only ciphertexts do.
// - Decrypted plaintext lives in-memory only for the duration of one API call.
// - Logs redact the plaintext automatically (see logger.redactPaths).

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    // Dev fallback: deterministic key derived from a known salt.
    // NEVER use this in production — the env var MUST be set.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production');
    }
    console.warn('[crypto] ENCRYPTION_KEY not set — using insecure dev key. DO NOT use in production.');
    cachedKey = crypto.scryptSync('soar-dev-key', 'soar-dev-salt', 32);
    return cachedKey;
  }
  // Accept raw 32-byte hex OR base64
  if (/^[0-9a-f]{64}$/i.test(envKey)) {
    cachedKey = Buffer.from(envKey, 'hex');
  } else {
    cachedKey = Buffer.from(envKey, 'base64');
  }
  if (cachedKey.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${cachedKey.length}`);
  }
  return cachedKey;
}

export interface EncryptedPayload {
  // versioned format: v1
  v: 1;
  iv: string;       // base64
  ct: string;       // base64 ciphertext (no tag)
  tag: string;      // base64 auth tag
}

/**
 * Encrypt an arbitrary JSON-serializable value.
 * Returns a string that can be safely stored in the DB.
 */
export function encrypt(value: unknown): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
  return JSON.stringify(payload);
}

/**
 * Decrypt a value produced by `encrypt`. Returns null for empty/invalid input.
 * Throws if the auth tag fails verification (tamper detection).
 */
export function decrypt<T = unknown>(encrypted: string | null | undefined): T | null {
  if (!encrypted) return null;
  // Backward compat: if it doesn't look like our v1 payload, return the raw value
  // (this allows existing plaintext configs to still be read until re-encrypted).
  if (!encrypted.startsWith('{') || !encrypted.includes('"v":1')) {
    try { return JSON.parse(encrypted) as T; } catch { return encrypted as unknown as T; }
  }
  const key = getKey();
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(encrypted) as EncryptedPayload;
  } catch {
    return null;
  }
  if (payload.v !== 1) {
    throw new Error(`Unsupported encryption version: ${payload.v}`);
  }
  const iv = Buffer.from(payload.iv, 'base64');
  const ct = Buffer.from(payload.ct, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Malformed ciphertext (IV or tag length mismatch)');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: ciphertext tampered or wrong key');
  }
  try {
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    return plain.toString('utf8') as unknown as T;
  }
}

/**
 * Generate a new encryption key (for `npm run gen-key` script).
 * Outputs a base64-encoded 32-byte key suitable for ENCRYPTION_KEY.
 */
export function generateKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Compute SHA-256 hash of a string (used for audit log hash chain).
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a random hex token (for API keys, request IDs).
 */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * HMAC-SHA256 for webhook signature verification.
 */
export function hmacSign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Constant-time string comparison (safe against timing attacks).
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

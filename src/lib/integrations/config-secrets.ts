import { decrypt, encrypt } from '@/lib/crypto';

/** Merge incoming config fields; keep existing when UI sends masked placeholders. */
export function mergeIntegrationConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === 'string' && v.includes('••••')) continue;
    if (v === undefined || v === null) continue;
    merged[k] = v;
  }
  return merged;
}

/** Mask secret fields before sending config to the browser. */
export function maskIntegrationConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (
      typeof v === 'string' &&
      (k.toLowerCase().includes('key') ||
        k.toLowerCase().includes('token') ||
        k.toLowerCase().includes('secret') ||
        k.toLowerCase().includes('password') ||
        k.toLowerCase().includes('webhook')) &&
      v.length > 0
    ) {
      masked[k] = v.slice(0, 4) + '••••••' + (v.length > 10 ? v.slice(-2) : '');
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export function decryptIntegrationConfig(stored: string | null | undefined): Record<string, unknown> {
  if (!stored) return {};
  const decrypted = decrypt<Record<string, unknown> | string>(stored);
  if (decrypted && typeof decrypted === 'object' && !Array.isArray(decrypted)) {
    return decrypted;
  }
  if (typeof decrypted === 'string') {
    try {
      const parsed = JSON.parse(decrypted) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function encryptIntegrationConfig(config: Record<string, unknown>): string {
  return encrypt(config);
}

export const VAULT_TYPES = [
  { value: 'api_key', label: 'API Key' },
  { value: 'password', label: 'Password' },
  { value: 'token', label: 'Token' },
  { value: 'certificate', label: 'Certificate' },
] as const;

export type VaultSecretType = (typeof VAULT_TYPES)[number]['value'];

export function vaultTypeLabel(type: string): string {
  const match = VAULT_TYPES.find((item) => item.value === type.toLowerCase());
  if (match) return match.label;
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const MASKED_SECRET = '••••••••';

export const SECRET_FIELD_KEYS = [
  'plaintext',
  'value',
  'secret',
  'credential',
  'password',
  'token',
  'api_key',
  'apiKey',
  'certificate',
  'private_key',
  'privateKey',
  'cert',
  'key',
] as const;

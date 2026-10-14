import { z } from 'zod';

export const PrivyAppId = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
// Public SPKI only: private keys, certificates and arbitrary text are never settings.
export const PrivyVerificationKey = z.string().max(4096).transform(s => s.replace(/\\n/g, '\n').trim()).refine(s =>
  /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----$/.test(s));
export function isExactBrowserOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return !value.includes('*') && ['http:', 'https:'].includes(u.protocol) && u.origin === value;
  } catch { return false; }
}
export const CorsOrigins = z.array(z.string().max(256).refine(isExactBrowserOrigin)).max(50);
export const RUNTIME_SETTING_SCHEMAS = {
  'auth.privy_app_id': PrivyAppId,
  'auth.privy_verification_key': PrivyVerificationKey,
  'api.cors_origins': CorsOrigins,
} as const;
export const RuntimeSettingsInput = z.object(RUNTIME_SETTING_SCHEMAS).partial().strict();

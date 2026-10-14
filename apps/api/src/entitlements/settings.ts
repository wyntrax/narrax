import type { Prisma, PrismaClient } from '@narra/database';
import { z } from 'zod';
import { sanitizeUntrusted, ACCESS_TIERS, FEATURE_TIERS, RUNTIME_SETTING_SCHEMAS } from '@narra/shared';
import { AccessError, audit, lock, requireAdminActor, TX_OPTIONS } from './common';
import { checkPrivyKey } from '../privy-key';
import { AUTH_SETTING_KEYS, invalidateRuntimeSettings, readRuntimeSettings } from '../runtime-settings';

const Domain = z.string().max(256).refine(value => {
  try { const u = new URL(value); return u.origin === value && !u.username && !u.password && (u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost' && u.port === '4010')); } catch { return false; }
});
export const SETTING_SCHEMAS = {
  ...RUNTIME_SETTING_SCHEMAS,
  'early_access.enabled': z.boolean(),
  'early_access.seat_cap': z.number().int().nonnegative().safe(),
  'early_access.invite_required': z.boolean(),
  'entitlements.wallet_link_domain': Domain,
  'entitlements.enforced': z.boolean(),
  'entitlements.shadow_log': z.boolean(),
  'entitlements.features': z.record(z.object({ requiredTier: z.enum(ACCESS_TIERS).optional(), min_entitlement_age_hours: z.number().finite().min(0).max(8760).optional() }).strict()).refine(v => Object.keys(v).every(k => Object.hasOwn(FEATURE_TIERS, k))),
} as const;
type SettingKey = keyof typeof SETTING_SCHEMAS;
export async function localSettings(tx: Pick<Prisma.TransactionClient, 'systemSetting'>) {
  const rows = await tx.systemSetting.findMany({ where: { key: { in: Object.keys(SETTING_SCHEMAS) } } });
  const values: Record<string, unknown> = { 'early_access.enabled': false, 'early_access.seat_cap': 0, 'early_access.invite_required': false };
  for (const r of rows) {
    const parsed = SETTING_SCHEMAS[r.key as SettingKey].safeParse(r.value);
    if (!parsed.success) throw new AccessError('ENTITLEMENTS_UNAVAILABLE', 503);
    values[r.key] = parsed.data;
  }
  return { enabled: values['early_access.enabled'] as boolean, cap: values['early_access.seat_cap'] as number, inviteRequired: values['early_access.invite_required'] as boolean, domain: values['entitlements.wallet_link_domain'] as string | undefined };
}
/** Internal service for Stage 4's admin routes. Only these exact keys can ever be written. */
export async function updateLocalSettings(db: PrismaClient, actorId: string, input: unknown, reasonInput: string, options: { overridePrivyCheck?: boolean; checkPrivy?: typeof checkPrivyKey } = {}) {
  const parsed = z.object(SETTING_SCHEMAS).partial().strict().safeParse(input);
  const reason = sanitizeUntrusted(reasonInput, 300).trim();
  if (!parsed.success || !reason || (options.overridePrivyCheck !== undefined && typeof options.overridePrivyCheck !== 'boolean')) throw new AccessError('INVALID_INPUT', 400);
  await db.$transaction(async tx => {
    await requireAdminActor(tx, actorId);
    await lock(tx, 'settings');
    const authChanged = AUTH_SETTING_KEYS.some(key => Object.hasOwn(parsed.data, key));
    let verification: string | undefined;
    if (authChanged) {
      const effective = await readRuntimeSettings(tx);
      const appId = parsed.data['auth.privy_app_id'] ?? effective.privyAppId.value;
      const key = parsed.data['auth.privy_verification_key'] ?? effective.privyVerificationKey.value;
      const result = await (options.checkPrivy ?? checkPrivyKey)(appId, key);
      if (!result.ok && (result.error === 'INVALID_PRIVY_KEY' || options.overridePrivyCheck !== true)) throw new AccessError(result.error, 400);
      verification = result.ok ? 'verified' : result.error;
    } else if (options.overridePrivyCheck) throw new AccessError('INVALID_INPUT', 400);
    await lock(tx, 'seats');
    // The same domain lock is held while creating/verifying proofs.
    await lock(tx, 'domain');
    for (const [key, value] of Object.entries(parsed.data)) {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      if (key === 'entitlements.wallet_link_domain' && before?.value !== value) {
        await tx.walletLinkChallenge.updateMany({ where: { consumedAt: null }, data: { consumedAt: new Date() } });
      }
      await tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await audit(tx, actorId, 'entitlements.setting_changed', { key, before: before?.value ?? null, after: value, reason, ...(authChanged ? { overridePrivyCheck: options.overridePrivyCheck === true, verification } : {}) });
    }
  }, TX_OPTIONS);
  invalidateRuntimeSettings(db);
}

/** Operator recovery: DB access is the authority; no bearer token needed during a lockout. */
export async function resetAuthSettings(db: PrismaClient, reasonInput: string) {
  const reason = sanitizeUntrusted(reasonInput, 300).trim();
  if (!reason) throw new AccessError('INVALID_INPUT', 400);
  await db.$transaction(async tx => {
    await lock(tx, 'settings');
    for (const key of AUTH_SETTING_KEYS) {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      await tx.systemSetting.deleteMany({ where: { key } });
      await audit(tx, null, 'entitlements.setting_reset', { key, before: before?.value ?? null, after: null, reason, actor: 'operator-cli' });
    }
  }, TX_OPTIONS);
  invalidateRuntimeSettings(db);
}

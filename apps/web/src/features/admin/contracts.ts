import {z} from 'zod';

const DateTime = z.string().datetime({offset: true});

/** Only what the shell needs from GET /v1/me: whether to show the Admin link. */
export const MeSchema = z.object({isAdmin: z.boolean().optional()});

export const SettingsSchema = z.object({items: z.array(z.object({key: z.string(), value: z.unknown()}))});
const Source = z.enum(['database','environment']);
export const RuntimeSettingsSchema = z.object({
  privyAppId: z.object({value:z.string(),source:Source}),
  privyVerificationKey: z.object({value:z.string(),source:Source}),
  corsOrigins: z.object({value:z.array(z.string()),source:Source,extra:z.array(z.string()),environment:z.array(z.string())}),
});
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
export const StatsSchema = z.object({occupied: z.number(), available: z.number(), cap: z.number(), active: z.number(), expired: z.number(), revoked: z.number()});
export const LookupSchema = z.object({items: z.array(z.object({id: z.string(), createdAt: DateTime, isAdmin: z.boolean(), wallets: z.array(z.object({id: z.string(), address: z.string(), verifiedAt: DateTime}))}))});
export const GrantListSchema = z.object({items: z.array(z.object({id: z.string(), userId: z.string(), source: z.enum(['EARLY_ACCESS', 'ADMIN']), status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']), validUntil: DateTime.nullable(), reason: z.string().nullable(), createdAt: DateTime, wallets: z.array(z.string())}))});

export type AdminSettings = {enabled: boolean; cap: number; domain: string; enforced: boolean; shadow: boolean};
export type AdminGrant = z.infer<typeof GrantListSchema>['items'][number];

/** Stored settings rows to form values. A setting that was never saved shows the API's default. */
export function toSettings(items: {key: string; value?: unknown}[]): AdminSettings {
  const get = (key: string) => items.find(item => item.key === key)?.value;
  return {
    enabled: get('early_access.enabled') === true,
    cap: typeof get('early_access.seat_cap') === 'number' ? get('early_access.seat_cap') as number : 0,
    domain: typeof get('entitlements.wallet_link_domain') === 'string' ? get('entitlements.wallet_link_domain') as string : '',
    enforced: get('entitlements.enforced') === true,
    shadow: get('entitlements.shadow_log') !== false,
  };
}

/** The body for PUT /v1/admin/entitlements/settings. An empty domain is left out: the API cannot clear it. */
export function toPayload(s: AdminSettings): Record<string, unknown> {
  return {
    'early_access.enabled': s.enabled, 'early_access.seat_cap': s.cap, 'entitlements.enforced': s.enforced, 'entitlements.shadow_log': s.shadow,
    ...(s.domain ? {'entitlements.wallet_link_domain': s.domain} : {}),
  };
}

/** A grant the API still counts: ACTIVE and not past its expiry. */
export function effectiveStatus(grant: Pick<AdminGrant, 'status' | 'validUntil'>, now = Date.now()): 'ACTIVE' | 'EXPIRED' | 'REVOKED' {
  if (grant.status === 'ACTIVE' && grant.validUntil && Date.parse(grant.validUntil) <= now) return 'EXPIRED';
  return grant.status;
}

export const shortAddress = (address: string) => address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;

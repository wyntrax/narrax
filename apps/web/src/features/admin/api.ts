import {createTransport} from '@/lib/api';
import {GrantSchema, OkSchema} from '@/lib/schemas';
import {GrantListSchema, LookupSchema, SettingsSchema, StatsSchema, RuntimeSettingsSchema} from './contracts';

/** Admin calls. The API rejects anyone who is not an admin with 403, so nothing here is a security boundary. */
export function createAdminApi(getToken: () => Promise<string | null>, base = process.env.NEXT_PUBLIC_API_URL ?? '', fetcher: typeof fetch = fetch) {
  const request = createTransport(base, getToken, fetcher);
  const user = (id: string) => `/v1/admin/users/${encodeURIComponent(id)}/entitlements`;
  return {
    settings: () => request('/v1/admin/entitlements/settings', SettingsSchema),
    stats: () => request('/v1/admin/early-access/stats', StatsSchema),
    grants: () => request('/v1/admin/early-access/grants', GrantListSchema),
    lookup: (q: string) => request(`/v1/admin/users/lookup?${new URLSearchParams({q})}`, LookupSchema),
    save: (settings: Record<string, unknown>, reason: string, overridePrivyCheck = false) => request('/v1/admin/entitlements/settings', OkSchema, 'PUT', {settings, reason, overridePrivyCheck}),
    runtime: () => request('/v1/admin/runtime-settings', RuntimeSettingsSchema),
    checkPrivy: (appId: string, verificationKey: string) => request('/v1/admin/runtime-settings/check-privy', OkSchema, 'POST', {appId, verificationKey}),
    grant: (userId: string, validUntil: string, reason: string) => request(`${user(userId)}/grants`, GrantSchema, 'POST', {tier: 'EARLY_ACCESS', validUntil, reason}),
    revoke: (userId: string, grantId: string, reason: string) => request(`${user(userId)}/grants/${encodeURIComponent(grantId)}/revoke`, OkSchema, 'POST', {reason}),
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;

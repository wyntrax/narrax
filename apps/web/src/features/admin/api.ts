import {createTransport} from '@/lib/api';
import {z} from 'zod';
import {ResearchWalletsSchema,CandidatesSchema,ResearchHealthSchema} from '@/features/research/wallet-research-contracts';
import {GrantSchema, OkSchema} from '@/lib/schemas';
import {GrantListSchema, LookupSchema, SettingsSchema, StatsSchema, RuntimeSettingsSchema,DataHealthSchema} from './contracts';

/** Admin calls. The API rejects anyone who is not an admin with 403, so nothing here is a security boundary. */
export function createAdminApi(getToken: () => Promise<string | null>, base = process.env.NEXT_PUBLIC_API_URL ?? '', fetcher: typeof fetch = fetch, getIdentityToken?: () => Promise<string | null>) {
  const request = createTransport(base, getToken, fetcher, getIdentityToken);
  const user = (id: string) => `/v1/admin/users/${encodeURIComponent(id)}/entitlements`;
  return {
    researchWallets:(cursor?:string)=>request(`/v1/admin/wallets?limit=25${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,ResearchWalletsSchema),
    researchHealth:()=>request('/v1/admin/wallet-research/health',ResearchHealthSchema),
    walletCandidates:(cursor?:string)=>request(`/v1/admin/wallet-candidates?limit=25${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,CandidatesSchema),
    reviewResearch:(address:string,status:'APPROVED'|'REJECTED'|'PROVISIONAL',reason:string)=>request(`/v1/admin/wallets/${encodeURIComponent(address)}/research-review`,OkSchema,'POST',{status,reason}),
    reviewCandidate:(address:string,action:'approve'|'reject',reason:string)=>request(`/v1/admin/wallet-candidates/${encodeURIComponent(address)}/${action}`,z.object({approved:z.string().optional(),rejected:z.string().optional()}),'POST',{reason}),
    settings: () => request('/v1/admin/entitlements/settings', SettingsSchema),
    stats: () => request('/v1/admin/early-access/stats', StatsSchema),
    grants: () => request('/v1/admin/early-access/grants', GrantListSchema),
    lookup: (q: string) => request(`/v1/admin/users/lookup?${new URLSearchParams({q})}`, LookupSchema),
    save: (settings: Record<string, unknown>, reason: string, overridePrivyCheck = false) => request('/v1/admin/entitlements/settings', OkSchema, 'PUT', {settings, reason, overridePrivyCheck}),
    runtime: () => request('/v1/admin/runtime-settings', RuntimeSettingsSchema),
    dataHealth:()=>request('/v1/admin/data-health',DataHealthSchema),
    checkPrivy: (appId: string, verificationKey: string) => request('/v1/admin/runtime-settings/check-privy', OkSchema, 'POST', {appId, verificationKey}),
    grant: (userId: string, validUntil: string, reason: string) => request(`${user(userId)}/grants`, GrantSchema, 'POST', {tier: 'EARLY_ACCESS', validUntil, reason}),
    revoke: (userId: string, grantId: string, reason: string) => request(`${user(userId)}/grants/${encodeURIComponent(grantId)}/revoke`, OkSchema, 'POST', {reason}),
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;

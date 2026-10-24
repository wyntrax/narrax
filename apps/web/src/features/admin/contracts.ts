import {z} from 'zod';
import {DEFAULT_TIER_REQUIREMENTS, DEFAULT_TOKEN_SYMBOL, HOLDING_TIERS, TierRequirements, TokenSymbol, TokenMint, EarlyAccessDays} from '@narra/shared';

const DateTime = z.string().datetime({offset: true});
const Count=z.number().int().nonnegative();
const CoverageCounts=z.object({fresh:Count,stale:Count,missing:Count,future:Count});
const Diagnostic=z.object({at:DateTime,runs:Count,counters:z.record(z.number().finite().nonnegative())});
export const ResearchCoverageSchema=z.object({
 checkedAt:DateTime,scope:z.literal('ACTIVE_NARRATIVE_OR_RECENT_SOCIAL'),scanned:Count,total:Count,capped:z.boolean(),socialPriorityCount:Count,
 price:CoverageCounts.extend({unverified:Count}),holders:CoverageCounts,risk:CoverageCounts,freshPriceAndHolders:Count,
 stages:z.array(z.object({stage:z.enum(['market','social','narrative']),latest:Diagnostic.nullable(),stale:z.boolean(),today:Diagnostic.nullable()})),
 calls:z.object({published24h:Count,unknownEntry24h:Count,measurements:z.record(Count)}),
});
export const DataHealthSchema=z.object({
  collectors:z.array(z.object({stage:z.enum(['market','social','narrative','narrative-ingestion']),state:z.enum(['OK','WARNING','ERROR','UNKNOWN','STALE','DISABLED']),lastRecordedAt:DateTime.nullable(),ageSeconds:Count.nullable(),maxAgeSeconds:Count,counters:z.record(z.number().finite().nonnegative()).nullable()})).optional(),
  budgets:z.object({priceTokensPerRun:Count,infoCallsPerRun:Count,lastPriceTokens:Count.nullable(),lastInfoCalls:Count.nullable()}).optional(),
 checkedAt:DateTime,issues:z.array(z.string()),
 coverage:ResearchCoverageSchema.optional(),
  queues:z.array(z.object({name:z.string(),state:z.enum(['OK','WARNING','ERROR','UNKNOWN','DISABLED']),counts:z.object({waiting:Count,active:Count,failed:Count,delayed:Count,consumers:Count.optional()}).nullable(),lastCompletedAt:DateTime.nullable(),lastFailedAt:DateTime.nullable(),lastRun:z.object({analyzed:Count.optional(),providerFailures:Count.optional(),providerErrors:Count.optional(),mentionsStored:Count.optional(),narrativesUpdated:Count.optional(),topicsSeen:Count.optional(),tokensUsed:Count.optional(),skipped:z.string().optional(),rateLimited:z.boolean().optional()}).nullable()})),
 webhook:z.object({configured:z.boolean().nullable(),lastReceipt:z.object({at:DateTime,items:Count,parsed:Count,queued:Count,skipped:Count}).nullable(),sync:z.object({at:DateTime,action:z.string(),active:z.boolean().nullable(),desired:Count,hasError:z.boolean()}).nullable()}),
 wallets:z.object({tracked:Count,profiles:Count,withoutProfile:Count,trades30d:Count,lastTradeAt:DateTime.nullable(),lastComputedAt:DateTime.nullable(),scanned:Count,capped:z.boolean(),missingComputations:Count,staleComputations:Count,historyCapped:Count}),
  market:z.object({scanned:Count,total:Count,capped:z.boolean(),fresh:Count,stale:Count,unverified:Count,lastAt:DateTime.nullable(),enabled:z.boolean(),unknownNames:Count,future:Count.optional(),withStoredArtwork:Count.optional(),withoutStoredArtwork:Count.optional()}),
 analysis:z.object({enabled:z.boolean(),providerConfigured:z.boolean().nullable(),fastModel:z.string(),reasoningModel:z.string(),usedToday:Count,budget:Count,recentCandidates:Count,recentBelowThreshold:Count,olderUnanalyzed:Count}),
});
export type DataHealth=z.infer<typeof DataHealthSchema>;

/** Only what the shell needs from GET /v1/me: whether to show the Admin link. */
export const MeSchema = z.object({isAdmin: z.boolean().optional(), admin: z.object({configured: z.boolean(), privyUserId: z.string(), email: z.string().nullable()}).optional()});

export const SettingsSchema = z.object({items: z.array(z.object({key: z.string(), value: z.unknown()}))});
const Source = z.enum(['database','environment']);
export const RuntimeSettingsSchema = z.object({
  privyAppId: z.object({value:z.string(),source:Source}),
  privyVerificationKey: z.object({value:z.string(),source:Source}),
  corsOrigins: z.object({value:z.array(z.string()),source:Source,extra:z.array(z.string()),environment:z.array(z.string())}),
});
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
export const StatsSchema = z.object({occupied: z.number(), available: z.number(), cap: z.number(), active: z.number(), expired: z.number(), revoked: z.number()});
export type AdminStats = z.infer<typeof StatsSchema>;
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
    'early_access.enabled': s.enabled, 'early_access.seat_cap': s.cap, 'entitlements.shadow_log': s.shadow,
    ...(s.domain ? {'entitlements.wallet_link_domain': s.domain} : {}),
  };
}

/** A grant the API still counts: ACTIVE and not past its expiry. */
export function effectiveStatus(grant: Pick<AdminGrant, 'status' | 'validUntil'>, now = Date.now()): 'ACTIVE' | 'EXPIRED' | 'REVOKED' {
  if (grant.status === 'ACTIVE' && grant.validUntil && Date.parse(grant.validUntil) <= now) return 'EXPIRED';
  return grant.status;
}

export const shortAddress = (address: string) => address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;

// ---- Access levels ($Wyntrax holdings) and the early-access time window -------------------------------------------

export type TierForm = {MEMBER: string; PRO: string; symbol: string; mint: string; closesAt: string; accessDays: string};

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO time to the `datetime-local` input format, in the admin's own time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Stored settings to form text. A value that was never saved shows the starting default. */
export function toTierForm(items: {key: string; value?: unknown}[]): TierForm {
  const get = (key: string) => items.find(item => item.key === key)?.value;
  const stored = TierRequirements.safeParse(get('access.tier_requirements'));
  const tiers = stored.success ? stored.data : DEFAULT_TIER_REQUIREMENTS;
  const symbol = TokenSymbol.safeParse(get('access.token_symbol'));
  const closes = get('early_access.closes_at'), days = get('early_access.access_days');
  return {
    MEMBER: String(tiers.MEMBER), PRO: String(tiers.PRO),
    symbol: symbol.success ? symbol.data : DEFAULT_TOKEN_SYMBOL,
    mint: typeof get('access.token_mint') === 'string' ? (get('access.token_mint') as string) : '',
    closesAt: toLocalInput(typeof closes === 'string' ? closes : null),
    accessDays: typeof days === 'number' ? String(days) : '',
  };
}
/** "500000", "500,000", "500K", "1.5M" and "10M" are all accepted. Anything else is rejected, never guessed. */
export function parseAmount(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([kKmMbB]?)$/.exec(text.replace(/[,\s_]/g, ''));
  if (!m) return null;
  const value = Number(m[1]) * ({'': 1, k: 1e3, m: 1e6, b: 1e9} as Record<string, number>)[m[2]!.toLowerCase()]!;
  return Number.isFinite(value) ? Math.round(value) : null;
}
export type TierParse = {ok: true; payload: Record<string, unknown>; tiers: Record<(typeof HOLDING_TIERS)[number], number>} | {ok: false; error: 'amount' | 'order' | 'symbol' | 'mint' | 'time' | 'days'};
/** The body for PUT /v1/admin/entitlements/settings. Empty closing time and empty seat length clear those limits (null). */
export function parseTierForm(form: TierForm): TierParse {
  const amounts = HOLDING_TIERS.map(tier => parseAmount(form[tier]));
  if (amounts.some(a => a === null)) return {ok: false, error: 'amount'};
  const tiers = {MEMBER: amounts[0]!, PRO: amounts[1]!};
  const checked = TierRequirements.safeParse(tiers);
  if (!checked.success) return {ok: false, error: amounts.every(a => a! > 0) && !(tiers.MEMBER < tiers.PRO) ? 'order' : 'amount'};
  const symbol = TokenSymbol.safeParse(form.symbol.trim());
  if (!symbol.success) return {ok: false, error: 'symbol'};
  // Empty means not set yet. A filled value must be a real-looking Solana address, never guessed or trimmed into shape.
  const mint = TokenMint.safeParse(form.mint.trim() === '' ? null : form.mint.trim());
  if (!mint.success) return {ok: false, error: 'mint'};
  let closes: string | null = null;
  if (form.closesAt) {
    const time = new Date(form.closesAt);
    if (!Number.isFinite(time.getTime())) return {ok: false, error: 'time'};
    closes = time.toISOString();
  }
  let days: number | null = null;
  if (form.accessDays.trim()) {
    const parsed = EarlyAccessDays.safeParse(/^\d{1,4}$/.test(form.accessDays.trim()) ? Number(form.accessDays.trim()) : NaN);
    if (!parsed.success) return {ok: false, error: 'days'};
    days = parsed.data;
  }
  return {ok: true, tiers, payload: {'access.tier_requirements': checked.data, 'access.token_symbol': symbol.data, 'access.token_mint': mint.data, 'early_access.closes_at': closes, 'early_access.access_days': days}};
}

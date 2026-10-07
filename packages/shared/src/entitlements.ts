/** Research access only. Pure functions: no ambient clock, persistence or trading capabilities. */
export const ACCESS_TIERS = ['NONE', 'EARLY_ACCESS', 'MEMBER', 'PRO', 'ELITE'] as const;
export type AccessTier = typeof ACCESS_TIERS[number];
export const FEATURE_TIERS = {
  'research.narratives': 'EARLY_ACCESS', 'research.tokens': 'EARLY_ACCESS', 'research.overview': 'EARLY_ACCESS',
  'research.screener': 'PRO', 'research.rotation': 'EARLY_ACCESS', 'research.opportunities': 'PRO', 'research.smart_money': 'PRO',
  'research.analysis': 'PRO', 'research.wallet_detail': 'PRO', 'research.decision_analytics': 'PRO',
  'research.advanced_analytics': 'ELITE', 'research.chat': 'ELITE',
} as const satisfies Record<string, AccessTier>;
export type FeatureKey = keyof typeof FEATURE_TIERS;
export const RESEARCH_PAGE_LIMITS: Record<AccessTier, number> = { NONE: 0, EARLY_ACCESS: 20, MEMBER: 40, PRO: 70, ELITE: 100 };
export interface AccessWallet { chain: string; address: string }
export interface LocalGrant {
  id: string; userId: string; source: string; tier: string; status: string; validUntil: Date | null;
}
export interface MembershipState {
  wyntraxUserId: string; tier: string; validUntil: Date | null; wallets: readonly AccessWallet[];
}
export interface EntitlementSnapshot {
  userId: string;
  linkedWallets: readonly (AccessWallet & { userId: string; verifiedAt: Date })[];
  grants: readonly LocalGrant[];
  memberships: readonly MembershipState[];
  earlyAccessEnabled: boolean;
}
const future = (d: Date, now: Date) => Number.isFinite(d.getTime()) && d.getTime() > now.getTime();
const key = (w: AccessWallet) => `${w.chain}:${w.address}`;
export function featureAllowed(tier: AccessTier, feature: string): boolean {
  if (!Object.hasOwn(FEATURE_TIERS, feature)) return false;
  return ACCESS_TIERS.indexOf(tier) >= ACCESS_TIERS.indexOf(FEATURE_TIERS[feature as FeatureKey]);
}
export function resolveEntitlements(s: EntitlementSnapshot, now: Date) {
  const links = new Set(s.linkedWallets.filter(w => w.userId === s.userId && w.chain === 'solana' && Number.isFinite(w.verifiedAt.getTime()) && w.verifiedAt <= now).map(key));
  const sources: { source: string; id: string; tier: AccessTier; validUntil: Date | null }[] = [];
  if (Number.isFinite(now.getTime())) {
    for (const g of s.grants) {
      if (s.earlyAccessEnabled && links.size && g.userId === s.userId && ['EARLY_ACCESS', 'ADMIN'].includes(g.source) && g.tier === 'EARLY_ACCESS' && g.status === 'ACTIVE' && (g.validUntil === null || future(g.validUntil, now))) {
        sources.push({ source: g.source, id: g.id, tier: 'EARLY_ACCESS', validUntil: g.validUntil });
      }
    }
    const seen = new Set<string>();
    for (const m of s.memberships) {
      if (seen.has(m.wyntraxUserId) || !['MEMBER', 'PRO', 'ELITE'].includes(m.tier) || !m.validUntil || !future(m.validUntil, now) || !m.wallets.some(w => w.chain === 'solana' && links.has(key(w)))) continue;
      seen.add(m.wyntraxUserId);
      sources.push({ source: 'WYNTRAX', id: m.wyntraxUserId, tier: m.tier as AccessTier, validUntil: m.validUntil });
    }
  }
  const effectiveTier = sources.reduce<AccessTier>((tier, s) => ACCESS_TIERS.indexOf(s.tier) > ACCESS_TIERS.indexOf(tier) ? s.tier : tier, 'NONE');
  const expiries = sources.flatMap(s => s.validUntil ? [s.validUntil.getTime()] : []);
  return { effectiveTier, sources, nextExpiry: expiries.length ? new Date(Math.min(...expiries)) : null,
    researchPageLimit: RESEARCH_PAGE_LIMITS[effectiveTier],
    features: Object.fromEntries(Object.entries(FEATURE_TIERS).map(([feature, requiredTier]) => [feature, { requiredTier, allowed: featureAllowed(effectiveTier, feature) }])) };
}
/** Seats count users with active, unexpired EARLY_ACCESS-tier grants, regardless of source or paid tier. */
export function usedSeats(grants: readonly LocalGrant[], now: Date): number {
  return new Set(grants.filter(g => ['EARLY_ACCESS', 'ADMIN'].includes(g.source) && g.tier === 'EARLY_ACCESS' && g.status === 'ACTIVE' && (g.validUntil === null || future(g.validUntil, now))).map(g => g.userId)).size;
}
export function earlyAccessAdmission(s: { enabled: boolean; cap: number; occupied: number; hasWallet: boolean; alreadySeated: boolean; inviteRequired: boolean }): string | null {
  if (!s.enabled) return 'EARLY_ACCESS_DISABLED';
  if (!s.hasWallet) return 'VERIFIED_WALLET_REQUIRED';
  if (s.alreadySeated) return null;
  if (s.inviteRequired) return 'INVITES_UNAVAILABLE';
  if (!Number.isSafeInteger(s.cap) || s.cap < 0 || !Number.isSafeInteger(s.occupied) || s.occupied < 0 || s.occupied >= s.cap) return 'EARLY_ACCESS_FULL';
  return null;
}

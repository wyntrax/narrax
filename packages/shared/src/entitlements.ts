/** Research access only. Pure functions: no ambient clock, persistence or trading capabilities. */
export const ACCESS_TIERS = ['NONE', 'EARLY_ACCESS', 'MEMBER', 'PRO', 'ELITE'] as const;
export type AccessTier = typeof ACCESS_TIERS[number];
/** Offered levels. ELITE remains a wire/storage compatibility value only. */
export const RESEARCH_TIERS = ['EARLY_ACCESS', 'MEMBER', 'PRO'] as const;
export const activeTier = (tier: AccessTier): AccessTier => tier === 'ELITE' ? 'PRO' : tier;
export const FEATURE_TIERS = {
  'research.narratives': 'EARLY_ACCESS', 'research.tokens': 'EARLY_ACCESS', 'research.overview': 'EARLY_ACCESS',
  'research.screener': 'EARLY_ACCESS', 'research.rotation': 'EARLY_ACCESS', 'research.opportunities': 'EARLY_ACCESS', 'research.smart_money': 'EARLY_ACCESS',
  'research.analysis': 'EARLY_ACCESS', 'research.wallet_detail': 'EARLY_ACCESS', 'research.decision_analytics': 'EARLY_ACCESS',
  'research.advanced_analytics': 'EARLY_ACCESS', 'research.chat': 'EARLY_ACCESS',
  'research.personal_radar': 'PRO', 'research.thesis_tracker': 'PRO', 'research.personal_briefing': 'PRO',
} as const satisfies Record<string, AccessTier>;
export type FeatureKey = keyof typeof FEATURE_TIERS;
export const RESEARCH_PAGE_LIMITS: Record<AccessTier, number> = { NONE: 0, EARLY_ACCESS: 20, MEMBER: 40, PRO: 70, ELITE: 70 };
export interface AccessWallet { chain: string; address: string }
export interface LocalGrant {
  id: string; userId: string; source: string; tier: string; status: string; validUntil: Date | null;
}
export interface MembershipState {
  membershipId: string; chain: string; address: string; key: string; status: string; validUntil: Date | null;
}
export const entitlementId = (m: MembershipState) => JSON.stringify([m.membershipId, m.chain, m.address]);
export interface EntitlementSnapshot {
  userId: string;
  linkedWallets: readonly (AccessWallet & { userId: string; verifiedAt: Date })[];
  grants: readonly LocalGrant[];
  memberships: readonly MembershipState[];
  earlyAccessEnabled: boolean;
  /** Set only from the one authoritative admin decision. An operator/admin always holds every research feature. */
  admin?: boolean;
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
  // An admin is not a purchaser: the decision is made once by the environment/database admin rule and passed in here.
  // It grants the highest offered access regardless of wallets, grants, clock or membership state, and never expires.
  const admin = s.admin === true;
  if (admin) sources.push({ source: 'ADMIN', id: 'admin', tier: 'PRO', validUntil: null });
  else if (Number.isFinite(now.getTime())) {
    for (const g of s.grants) {
      if (links.size && g.userId === s.userId && ['EARLY_ACCESS', 'ADMIN'].includes(g.source) && g.tier === 'EARLY_ACCESS' && g.status === 'ACTIVE' && (g.validUntil === null || future(g.validUntil, now))) {
        sources.push({ source: g.source, id: g.id, tier: 'EARLY_ACCESS', validUntil: g.validUntil });
      }
    }
    const seen = new Set<string>();
    for (const m of s.memberships) {
      const id = entitlementId(m);
      if (seen.has(id) || m.status !== 'ACTIVE' || !['MEMBER', 'PRO', 'ELITE'].includes(m.key) || !m.validUntil || !future(m.validUntil, now) || m.chain !== 'solana' || !links.has(key(m))) continue;
      seen.add(id);
      sources.push({ source: 'WYNTRAX', id, tier: activeTier(m.key as AccessTier), validUntil: m.validUntil });
    }
  }
  const effectiveTier = sources.reduce<AccessTier>((tier, s) => ACCESS_TIERS.indexOf(s.tier) > ACCESS_TIERS.indexOf(tier) ? s.tier : tier, 'NONE');
  const expiries = sources.flatMap(s => s.validUntil ? [s.validUntil.getTime()] : []);
  return { effectiveTier, admin, sources, nextExpiry: expiries.length ? new Date(Math.min(...expiries)) : null,
    researchPageLimit: RESEARCH_PAGE_LIMITS[effectiveTier],
    features: Object.fromEntries(Object.entries(FEATURE_TIERS).map(([feature, requiredTier]) => [feature, { requiredTier, allowed: featureAllowed(effectiveTier, feature) }])) };
}
/** Seats count users with active, unexpired EARLY_ACCESS-tier grants, regardless of source or paid tier. */
export function usedSeats(grants: readonly LocalGrant[], now: Date): number {
  return new Set(grants.filter(g => ['EARLY_ACCESS', 'ADMIN'].includes(g.source) && g.tier === 'EARLY_ACCESS' && g.status === 'ACTIVE' && (g.validUntil === null || future(g.validUntil, now))).map(g => g.userId)).size;
}
/** `closesAt` and `now` are optional so older callers keep working; when both are given, a window that has ended refuses new seats. */
export function earlyAccessClosed(closesAt: Date | null | undefined, now: Date | undefined): boolean {
  return !!closesAt && !!now && Number.isFinite(closesAt.getTime()) && Number.isFinite(now.getTime()) && closesAt.getTime() <= now.getTime();
}
export function earlyAccessAdmission(s: { enabled: boolean; cap: number; occupied: number; hasWallet: boolean; alreadySeated: boolean; inviteRequired: boolean; closesAt?: Date | null; now?: Date }): string | null {
  if (!s.enabled) return 'EARLY_ACCESS_DISABLED';
  if (earlyAccessClosed(s.closesAt, s.now) && !s.alreadySeated) return 'EARLY_ACCESS_CLOSED';
  if (!s.hasWallet) return 'VERIFIED_WALLET_REQUIRED';
  if (s.alreadySeated) return null;
  if (s.inviteRequired) return 'INVITES_UNAVAILABLE';
  if (!Number.isSafeInteger(s.cap) || s.cap < 0 || !Number.isSafeInteger(s.occupied) || s.occupied < 0 || s.occupied >= s.cap) return 'EARLY_ACCESS_FULL';
  return null;
}

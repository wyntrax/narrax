import {ACCESS_TIERS, FEATURE_TIERS, HOLDING_TIERS, type AccessTier} from '@narra/shared';
import type {Requirements} from '@/lib/schemas';
/**
 * Tier levels shown on the site. Holding amounts are NOT hard-coded here any more: the admin page owns them and
 * GET /v1/access/requirements serves them. Unknown (API unreachable) stays null and is shown as unavailable, never as zero.
 */
export type TierLevel = Exclude<AccessTier,'NONE'>;
export const TIER_LEVELS: readonly TierLevel[] = ['EARLY_ACCESS','MEMBER','PRO'];
export function holdingFor(tier: TierLevel, requirements: Requirements | null): {amount: number; symbol: string} | null {
  if (!requirements || !(HOLDING_TIERS as readonly string[]).includes(tier)) return null;
  return {amount: requirements.tiers[tier as keyof Requirements['tiers']], symbol: requirements.tokenSymbol};
}
export function tierFeatures(tier: AccessTier,requirements?:Requirements|null) {return Object.entries(requirements?.featureTiers??FEATURE_TIERS).filter(([,minimum]) => ACCESS_TIERS.indexOf(tier) >= ACCESS_TIERS.indexOf(minimum));}

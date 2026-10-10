import {ACCESS_TIERS, FEATURE_TIERS, type AccessTier} from '@narra/shared';
/** Owner fills these placeholders. Null is unknown, never a zero token requirement. */
export const TIER_REQUIREMENTS: Record<Exclude<AccessTier,'NONE'>, {tokenAmount: number | null; tokenSymbol: string | null}> = {
  EARLY_ACCESS: {tokenAmount:null, tokenSymbol:null}, MEMBER: {tokenAmount:null, tokenSymbol:null}, PRO: {tokenAmount:null, tokenSymbol:null}, ELITE: {tokenAmount:null, tokenSymbol:null}
};
export function tierFeatures(tier: AccessTier) {return Object.entries(FEATURE_TIERS).filter(([,minimum]) => ACCESS_TIERS.indexOf(tier) >= ACCESS_TIERS.indexOf(minimum));}

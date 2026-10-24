import { z } from 'zod';
import { ACCESS_TIERS, FEATURE_TIERS } from './entitlements';

export const FeatureOverrides = z.record(z.object({ requiredTier: z.enum(ACCESS_TIERS).optional(), min_entitlement_age_hours: z.number().finite().min(0).max(8760).optional() }).strict())
  .refine(v => Object.keys(v).every(k => Object.hasOwn(FEATURE_TIERS, k)));

/** Who powers Narrax. Shown in the web app; the link is fixed here, never taken from user input. */
export const POWERED_BY = { name: 'Wyntrax', url: 'https://wyntrax.xyz' } as const;

/** Paid research tiers a $Wyntrax holding can unlock. EARLY_ACCESS is a seat, not a holding. */
export const HOLDING_TIERS = ['MEMBER', 'PRO'] as const;
export type HoldingTier = typeof HOLDING_TIERS[number];

/**
 * Starting values: MEMBER 500K and PRO 1M $Wyntrax. Pro is the highest offered level.
 * They are defaults only. The admin page stores the live values in SystemSetting.
 */
export const DEFAULT_TIER_REQUIREMENTS: Record<HoldingTier, number> = { MEMBER: 500_000, PRO: 1_000_000 };
export const DEFAULT_TOKEN_SYMBOL = '$WYNTRAX';
/** Upper bound is a sanity limit against a typo, not a statement about supply. */
export const MAX_TIER_REQUIREMENT = 1_000_000_000_000;

const Amount = z.number().finite().positive().max(MAX_TIER_REQUIREMENT);
/** Each tier needs strictly more tokens than the one below it, otherwise a higher tier would be cheaper than a lower one. */
// Accept old settings without mutating stored rows; deprecated Elite pricing is never offered or returned.
export const TierRequirements = z.object({ MEMBER: Amount, PRO: Amount, ELITE: Amount.optional() }).strict()
  .refine(v => v.MEMBER < v.PRO, { message: 'Tier requirements must increase: MEMBER < PRO' })
  .transform(({ MEMBER, PRO }) => ({ MEMBER, PRO }));
export type TierRequirementsValue = z.infer<typeof TierRequirements>;
/** A ticker such as $WYNTRAX. Plain characters only: it is rendered as text next to numbers. */
export const TokenSymbol = z.string().trim().min(1).max(16).regex(/^\$?[A-Za-z0-9]+$/);
/** Solana mint address of the $Wyntrax token. Null until the owner fills it in. Base58, 32 to 44 characters. */
export const TokenMint = z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).nullable();
/** End of the early-access window. Null means no end date. */
export const EarlyAccessClosesAt = z.string().datetime({ offset: true }).nullable();
/** How long a self-joined seat lasts. Null means it does not expire by itself. */
export const EarlyAccessDays = z.number().int().min(1).max(3650).nullable();

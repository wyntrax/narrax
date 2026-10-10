import {z} from 'zod';
import {ACCESS_TIERS, FEATURE_TIERS} from '@narra/shared';
export const Tier = z.enum(ACCESS_TIERS);
const DateTime = z.string().datetime({offset: true});
export const LinkSchema = z.object({id: z.string(), chain: z.literal('solana'), address: z.string().min(32).max(44), verifiedAt: DateTime});
export const GrantSchema = z.object({id: z.string(), userId: z.string(), source: z.enum(['EARLY_ACCESS','ADMIN']), tier: z.literal('EARLY_ACCESS'), status: z.enum(['ACTIVE','EXPIRED','REVOKED']), validUntil: DateTime.nullable()});
const Feature = z.object({requiredTier: Tier, allowed: z.boolean(), min_entitlement_age_hours: z.number().nonnegative()});
export const EntitlementsSchema = z.object({
  effectiveTier: Tier, sources: z.array(z.object({source: z.enum(['EARLY_ACCESS','ADMIN','WYNTRAX']), id: z.string(), tier: Tier, validUntil: DateTime.nullable()})),
  nextExpiry: DateTime.nullable(), researchPageLimit: z.number().int().nonnegative(),
  features: z.record(Feature).refine(v => Object.keys(FEATURE_TIERS).every(k => k in v)), rollout: z.object({enforced: z.boolean(), shadow_log: z.boolean()}),
  links: z.array(LinkSchema), grants: z.array(GrantSchema.extend({eligible: z.boolean(), reasonCode: z.enum(['ACTIVE','EXPIRED','REVOKED','DISABLED','WALLET_REQUIRED'])})),
  memberships: z.array(z.object({membershipId: z.string(), chain: z.literal('solana'), address: z.string(), key: z.enum(['NONE','MEMBER','PRO','ELITE']), seq: z.string().regex(/^\d+$/), status: z.enum(['ACTIVE','EXPIRED','REVOKED']), validUntil: DateTime.nullable(), eligible: z.boolean(), reasonCode: z.enum(['ACTIVE','EXPIRED','REVOKED'])}))
});
export type Entitlements = z.infer<typeof EntitlementsSchema>;
export const StatusSchema = z.object({enabled: z.boolean(), seatsLeft: z.number().int().nonnegative().nullable(), inviteRequired: z.boolean()}).strict();
export type PublicStatus = z.infer<typeof StatusSchema>;
export const ChallengeSchema = z.object({challengeId: z.string().min(1).max(128), message: z.string().min(1).max(2048), expiresAt: DateTime});
export type Challenge = z.infer<typeof ChallengeSchema>;
export const OkSchema = z.object({ok: z.literal(true)});
export const ApiErrorSchema = z.object({error: z.string(), requestId: z.string().optional(), requiredTier: Tier.optional()});

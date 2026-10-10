import {FEATURE_TIERS} from '@narra/shared';
import type {Entitlements,Challenge} from '@/lib/schemas';
export const ADDRESS='So11111111111111111111111111111111111111112';
export const status={enabled:true,seatsLeft:12,inviteRequired:false};
export const link={id:'fixture-link',chain:'solana' as const,address:ADDRESS,verifiedAt:'2026-01-01T00:00:00.000Z'};
export const empty:Entitlements={effectiveTier:'NONE',sources:[],nextExpiry:null,researchPageLimit:0,features:Object.fromEntries(Object.entries(FEATURE_TIERS).map(([key,requiredTier])=>[key,{requiredTier,allowed:false,min_entitlement_age_hours:0}])),rollout:{enforced:true,shadow_log:true},links:[],grants:[],memberships:[]};
export const linked:Entitlements={...empty,links:[link]};
export const active:Entitlements={...linked,effectiveTier:'EARLY_ACCESS',researchPageLimit:20,sources:[{source:'EARLY_ACCESS',id:'fixture-grant',tier:'EARLY_ACCESS',validUntil:null}],grants:[{id:'fixture-grant',userId:'fixture-user',source:'EARLY_ACCESS',tier:'EARLY_ACCESS',status:'ACTIVE',validUntil:null,eligible:true,reasonCode:'ACTIVE'}]};
export function challenge(origin='http://localhost:4010',now=Date.now()):Challenge {const issuedAt=new Date(now).toISOString(),expiresAt=new Date(now+300000).toISOString();return {challengeId:'fixture-challenge',expiresAt,message:['NARRA wallet link v1','This proves wallet control for research access only. It authorizes no transaction.',`Domain: ${origin}`,'User: fixture-user','Chain: solana',`Address: ${ADDRESS}`,`Nonce: ${'a'.repeat(64)}`,`Issued at: ${issuedAt}`,`Expires at: ${expiresAt}`].join('\n')};}

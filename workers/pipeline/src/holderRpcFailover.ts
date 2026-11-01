import type {HolderRpcResult,HolderRpcSource} from './holderRpc';

/** How long the primary endpoint is skipped after a provider-level rejection. */
export const HOLDER_RPC_FAILOVER_LIMITS={cooldownMs:15*60_000} as const;

export interface HolderRpcEndpoints{primary:string;fallback:string|null}

/**
 * Holder enumeration endpoints, independent of the shared Helius keys when configured:
 *
 *   HOLDER_RPC_URL + HOLDER_RPC_FALLBACK_URL  -> dedicated pair, no shared quota used
 *   HOLDER_RPC_FALLBACK_URL only              -> shared primary, dedicated fallback
 *   HOLDER_RPC_URL only                       -> dedicated primary, no fallback
 *   neither                                   -> shared primary, shared discovery reserve
 *
 * A dedicated holder primary is never silently backed by a shared key: that is the
 * coupling this configuration exists to avoid. An empty or duplicate URL is ignored.
 */
export function holderRpcEndpoints(env:NodeJS.ProcessEnv=process.env):HolderRpcEndpoints|null{
 const sharedPrimary=env.HELIUS_RPC_URL?.trim(),dedicatedPrimary=env.HOLDER_RPC_URL?.trim();
 const primary=dedicatedPrimary||sharedPrimary;
 if(!primary)return null;
 const dedicatedFallback=env.HOLDER_RPC_FALLBACK_URL?.trim();
 const fallback=dedicatedFallback||(dedicatedPrimary?undefined:env.HELIUS_RPC_FALLBACK_URL?.trim());
 return {primary,fallback:fallback&&fallback!==primary?fallback:null};
}

/** A 429 or an unreachable endpoint is an endpoint problem; a stale or malformed
 *  observation is a data problem that the other endpoint would report the same way. */
const providerFailure=(reason:string)=>reason==='RATE_LIMITED'||reason==='UNAVAILABLE';

/**
 * Tries the primary endpoint for a whole token and, on a provider-level rejection,
 * retries that same token on the fallback. Evidence is never mixed across endpoints:
 * a partial enumeration from one endpoint is discarded rather than completed by the other.
 *
 * The cooldown is in-process. The market top-up and the holder-refresh job share one
 * source, so a single rejection moves both to the fallback for the next 15 minutes.
 * A restart costs one rejected probe and then falls back again.
 */
export function makeFailoverHolderSource(
 primary:HolderRpcSource,fallback:HolderRpcSource,
 opts:{cooldownMs?:number;now?:()=>number}={},
):HolderRpcSource{
 const cooldownMs=opts.cooldownMs??HOLDER_RPC_FAILOVER_LIMITS.cooldownMs,now=opts.now??Date.now;
 let primaryCooldownUntil=0;
 const tag=(result:HolderRpcResult,endpoint:'primary'|'fallback',failedOver=false):HolderRpcResult=>({...result,endpoint,failedOver});
 return {
  primaryCooldownUntil:()=>primaryCooldownUntil>now()?new Date(primaryCooldownUntil).toISOString():null,
  async get(mint){
   if(primaryCooldownUntil>now())return tag(await fallback.get(mint),'fallback');
   const first=await primary.get(mint);
   if(first.ok||!providerFailure(first.reason))return tag(first,'primary');
   primaryCooldownUntil=now()+cooldownMs;
   return tag(await fallback.get(mint),'fallback',true);
  },
 };
}

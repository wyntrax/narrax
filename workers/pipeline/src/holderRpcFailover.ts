import type {HolderRpcResult,HolderRpcSource} from './holderRpc';

/** How long one endpoint is skipped after a provider-level rejection. */
export const HOLDER_RPC_FAILOVER_LIMITS={cooldownMs:15*60_000} as const;

export interface HolderRpcEndpoints{primary:string;fallback:string|null}
export interface HolderRpcEndpointPools{primary:string[];fallback:string[]}

const clean=(values:readonly string[])=>[...new Set(values.map(value=>value.trim()).filter(Boolean))];

/**
 * Holder enumeration endpoints, independent of the shared Helius keys when configured.
 * The same tiering as the shared RPC pool:
 *
 *   dedicated holder primaries exist  -> dedicated primary pool, dedicated fallback pool
 *   only a dedicated holder fallback  -> shared primary pool, dedicated fallback pool
 *   neither                           -> shared primary and fallback pools
 *
 * A dedicated holder primary is never silently backed by a shared key: that is the
 * coupling this configuration exists to avoid. Empty and duplicate URLs are ignored.
 */
export function holderRpcEndpointPools(input:{
 sharedPrimary:readonly string[];sharedFallback:readonly string[];
 holderPrimary:readonly string[];holderFallback:readonly string[];
}):HolderRpcEndpointPools|null{
 const sharedPrimary=clean(input.sharedPrimary),sharedFallback=clean(input.sharedFallback);
 const dedicatedPrimary=clean(input.holderPrimary),dedicatedFallback=clean(input.holderFallback);
 let primary:string[],fallback:string[];
 if(dedicatedPrimary.length){primary=dedicatedPrimary;fallback=dedicatedFallback;}
 else if(dedicatedFallback.length){primary=sharedPrimary;fallback=dedicatedFallback;}
 else{primary=sharedPrimary;fallback=sharedFallback;}
 // A fallback-only environment is still usable: treat it as the primary tier.
 if(!primary.length){primary=fallback;fallback=[];}
 fallback=fallback.filter(url=>!primary.includes(url));
 return primary.length?{primary,fallback}:null;
}

/** The legacy single-endpoint view, retained for callers that still test one pair. */
export function holderRpcEndpoints(env:NodeJS.ProcessEnv=process.env):HolderRpcEndpoints|null{
 const pools=holderRpcEndpointPools({
  sharedPrimary:env.HELIUS_RPC_URL?[env.HELIUS_RPC_URL]:[],
  sharedFallback:env.HELIUS_RPC_FALLBACK_URL?[env.HELIUS_RPC_FALLBACK_URL]:[],
  holderPrimary:env.HOLDER_RPC_URL?[env.HOLDER_RPC_URL]:[],
  holderFallback:env.HOLDER_RPC_FALLBACK_URL?[env.HOLDER_RPC_FALLBACK_URL]:[],
 });
 return pools?{primary:pools.primary[0]!,fallback:pools.fallback[0]??null}:null;
}

/** A 429 or an unreachable endpoint is an endpoint problem; a stale or malformed
 *  observation is a data problem that the other endpoints would report the same way. */
const providerFailure=(reason:string)=>reason==='RATE_LIMITED'||reason==='UNAVAILABLE';

/**
 * Tries a whole token on the primary pool in round-robin and, only when every primary
 * is cooling down or failing, retries the same token on the fallback pool. Evidence is
 * never mixed across endpoints: a partial enumeration from one endpoint is discarded
 * rather than completed by another.
 *
 * The cooldown is in-process and per endpoint. The market top-up and the holder-refresh
 * job share one source, so one exhausted key is routed around for both.
 */
export function makePooledHolderSource(
 primary:readonly HolderRpcSource[],fallback:readonly HolderRpcSource[],
 opts:{cooldownMs?:number;now?:()=>number}={},
):HolderRpcSource{
 const all=[...primary.map(source=>({tier:'primary' as const,source})),...fallback.map(source=>({tier:'fallback' as const,source}))];
 if(!all.length)throw new Error('Holder RPC pool requires at least one endpoint');
 const cooldownMs=opts.cooldownMs??HOLDER_RPC_FAILOVER_LIMITS.cooldownMs,now=opts.now??Date.now;
 const cooldownUntil=all.map(()=>0);
 const groups=[
  all.flatMap((endpoint,index)=>endpoint.tier==='primary'?[index]:[]),
  all.flatMap((endpoint,index)=>endpoint.tier==='fallback'?[index]:[]),
 ];
 let cursor=0;
 return {
  primaryCooldownUntil:()=>{
   let earliest=Infinity;
   for(const index of groups[0]!)if(cooldownUntil[index]!>now())earliest=Math.min(earliest,cooldownUntil[index]!);
   return earliest===Infinity?null:new Date(earliest).toISOString();
  },
  async get(mint){
   let last:{result:HolderRpcResult;tier:'primary'|'fallback'}|undefined,failedOver=false;
   for(const group of groups){
    for(let offset=0;offset<group.length;offset++){
     const index=group[(cursor+offset)%group.length]!,endpoint=all[index]!;
     if(cooldownUntil[index]!>now())continue;
     const result=await endpoint.source.get(mint);
     if(result.ok){cursor=(index+1)%all.length;return {...result,endpoint:endpoint.tier,failedOver};}
     last={result,tier:endpoint.tier};
     if(!providerFailure(result.reason))return {...result,endpoint:endpoint.tier,failedOver};
     cooldownUntil[index]=now()+cooldownMs;failedOver=true;
    }
   }
   return last?{...last.result,endpoint:last.tier,failedOver}:{ok:false,reason:'UNAVAILABLE'};
  },
 };
}

/** Two-endpoint compatibility wrapper. */
export function makeFailoverHolderSource(
 primary:HolderRpcSource,fallback:HolderRpcSource,
 opts:{cooldownMs?:number;now?:()=>number}={},
):HolderRpcSource{
 return makePooledHolderSource([primary],[fallback],opts);
}

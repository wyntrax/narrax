import {ApiError} from '@/lib/api';
import type {Entitlements} from '@/lib/schemas';
export const SYNC_WINDOW_MS=120000;
export const SYNC_DELAYS_MS=[5000,10000,15000,20000,30000] as const;
/** Bounded, cancellable polling. Server Retry-After is a minimum, not a retry suggestion. */
export function watchMembership(fetch:()=>Promise<Entitlements>,onData:(data:Entitlements)=>void,onTimeout:()=>void,onError:(error:unknown)=>void){
 let stopped=false,attempt=0,timer:ReturnType<typeof setTimeout>;
 const deadline=setTimeout(()=>{stopped=true;clearTimeout(timer);onTimeout();},SYNC_WINDOW_MS);
 const cancel=()=>{stopped=true;clearTimeout(timer);clearTimeout(deadline);};
  async function poll(){let retryAfter=0;try{const data=await fetch();if(stopped)return;onData(data);if(data.effectiveTier!=='NONE'){cancel();return;}}catch(error){if(stopped)return;if(error instanceof ApiError&&error.status===401){cancel();onError(error);return;}if(error instanceof ApiError)retryAfter=error.retryAfter*1000;}
   if(!stopped)timer=setTimeout(poll,Math.max(SYNC_DELAYS_MS[Math.min(++attempt,SYNC_DELAYS_MS.length-1)]!,retryAfter));
 }
 timer=setTimeout(poll,SYNC_DELAYS_MS[0]);return cancel;
}

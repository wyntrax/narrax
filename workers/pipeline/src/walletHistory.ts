import {parseHeliusSwaps} from '@narra/solana';
import {SwapEventSchema,type SwapEvent} from '@narra/queue';

export interface WalletHistoryOptions {apiKey:string;fetch?:typeof fetch;maxPages?:number;now?:Date;before?:string;since?:Date}
export class WalletHistoryError extends Error {
  constructor(public readonly code: 'RATE_LIMITED'|'PROVIDER_HTTP'|'INVALID_PAYLOAD'|'PAGINATION_STALLED'|'TIMEOUT'|'NETWORK', public readonly pagesRead: number, public readonly httpStatus?: number, public readonly searchHops = 0) {
    super(httpStatus ? `Wallet history returned HTTP ${httpStatus}` : `Wallet history ${code}`);
  }
}
// Helius can exhaust its filtered search interval without reaching the end of
// address history. Accept only the observed, explicit continuation response.
function searchContinuation(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload) || typeof payload.error !== 'string') return null;
  return /^Failed to find events within the search period\. To continue search, query the API again with the `before-signature` parameter set to ([1-9A-HJ-NP-Za-km-z]{80,88})\.$/.exec(payload.error)?.[1] ?? null;
}
/** Hard ceiling on filtered history pages per wallet. Above this the scan is reported as capped. */
export const HISTORY_PAGE_CAP=10;
/** Default depth, tuned to cover a quiet wallet's 30-day swap history without spending the whole provider budget. */
export const HISTORY_PAGE_DEFAULT=3;
/** `--pages=N` (or `--pages N`) for the repair CLI. Absent means the default. A
 * malformed or out-of-range value throws, so a deeper scan never silently under-fetches. */
export function historyPagesFromArgs(args:string[]):number{
 const index=args.findIndex(arg=>arg==='--pages'||arg.startsWith('--pages='));
 if(index<0)return HISTORY_PAGE_DEFAULT;
 const flag=args[index]!,raw=flag.includes('=')?flag.slice(flag.indexOf('=')+1):args[index+1];
 const value=Number(raw);
 if(!Number.isInteger(value)||value<1||value>HISTORY_PAGE_CAP)throw new Error(`--pages must be an integer between 1 and ${HISTORY_PAGE_CAP}`);
 return value;
}
/** Bounded enhanced-history repair. No token-to-token valuation, guessed native deltas,
 * screening jobs, orders or fabricated cost basis. A cap is explicitly reported. */
export async function collectWalletHistory(address:string,opts:WalletHistoryOptions){
  const until=+(opts.now??new Date()),since=opts.since?+opts.since:until-30*86400000;
  if(!Number.isFinite(since)||!Number.isFinite(until)||since>until)throw new Error('Invalid history boundaries');
  const events:SwapEvent[]=[],seen=new Set<string>();let before=opts.before,scanned=0,skipped=0,capped=false;
  let pagesRead=0,searchHops=0,oldestObservedAt:number|null=null,newestObservedAt:number|null=null,scannedThroughAt:number|null=null;
  const cursors=new Set(opts.before?[opts.before]:[]);
  const failure=(code:WalletHistoryError['code'],status?:number)=>new WalletHistoryError(code,pagesRead,status,searchHops);
  const advance=(cursor:string)=>{if(cursors.has(cursor))throw failure('PAGINATION_STALLED');cursors.add(cursor);before=cursor;};
 const pages=Math.min(HISTORY_PAGE_CAP,Math.max(1,opts.maxPages??HISTORY_PAGE_DEFAULT));
 for(let page=0;page<pages;page++){
  const url=new URL(`https://api-mainnet.helius-rpc.com/v0/addresses/${encodeURIComponent(address)}/transactions`);
  url.searchParams.set('api-key',opts.apiKey);url.searchParams.set('type','SWAP');url.searchParams.set('limit','100');if(before)url.searchParams.set('before',before);
  let response:Response|undefined;
  for(let attempt=0;attempt<3;attempt++){
    try { response=await (opts.fetch??fetch)(url,{signal:AbortSignal.timeout(20000)}); }
    catch(e) { throw failure(e instanceof Error && ['TimeoutError','AbortError'].includes(e.name)?'TIMEOUT':'NETWORK'); }
   if(response.status!==429)break;
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
  }
   if(response?.status===404){
    const next=searchContinuation(await response.json().catch(()=>null));
    if(!next)throw failure('PROVIDER_HTTP',404);
    advance(next);searchHops++;capped=page===pages-1;
    // Consumes one of maxPages, even with zero rows. No date or completed
    // coverage can be inferred from the signature alone.
    continue;
   }
   if(!response?.ok)throw failure(response?.status===429?'RATE_LIMITED':'PROVIDER_HTTP',response?.status??0);
   let data:unknown;
   try { data=await response.json(); } catch { throw failure('INVALID_PAYLOAD'); }
   if(!Array.isArray(data))throw failure('INVALID_PAYLOAD');
   pagesRead++;
   for(const row of data){
    const t=typeof row?.timestamp==='number'?row.timestamp*1000:NaN;
    if(!Number.isFinite(t)||!Number.isFinite(+new Date(t)))throw failure('INVALID_PAYLOAD');
    if(t<=until){scannedThroughAt=scannedThroughAt===null?t:Math.min(scannedThroughAt,t);if(t>=since){oldestObservedAt=oldestObservedAt===null?t:Math.min(oldestObservedAt,t);newestObservedAt=newestObservedAt===null?t:Math.max(newestObservedAt,t);}}
   }
  scanned+=data.length;const parsed=parseHeliusSwaps(data);skipped+=parsed.skipped;
   for(const event of parsed.events){const valid=SwapEventSchema.safeParse(event),at=Date.parse(event.at);if(!valid.success){skipped++;continue;}if(event.wallet===address&&at>=since&&at<=until&&!seen.has(event.signature)){events.push(valid.data);seen.add(event.signature);}}
  const last=data[data.length-1] as {signature?:unknown;timestamp?:unknown}|undefined;
   // Filtered history pages may contain fewer than limit while older swaps still exist.
   // Only an empty page or crossing the time boundary proves this scan is finished.
   if(data.length===0||typeof last?.timestamp==='number'&&last.timestamp*1000<since)break;
   if(typeof last?.signature!=='string')throw failure('PAGINATION_STALLED');
  advance(last.signature);capped=page===pages-1;
 }
 events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
   return {events,scanned,skipped,capped,nextBefore:capped?before??null:null,coveredFrom:new Date(since).toISOString(),coveredTo:new Date(until).toISOString(),
    pagesRead,searchHops,oldestObservedAt:oldestObservedAt===null?null:new Date(oldestObservedAt).toISOString(),newestObservedAt:newestObservedAt===null?null:new Date(newestObservedAt).toISOString(),scannedThroughAt:scannedThroughAt===null?null:new Date(scannedThroughAt).toISOString()};
}

import {parseHeliusSwaps} from '@narra/solana';
import {SwapEventSchema,type SwapEvent} from '@narra/queue';

export interface WalletHistoryOptions {apiKey:string;fetch?:typeof fetch;maxPages?:number;now?:Date;before?:string;since?:Date}
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
 const pages=Math.min(HISTORY_PAGE_CAP,Math.max(1,opts.maxPages??HISTORY_PAGE_DEFAULT));
 for(let page=0;page<pages;page++){
  const url=new URL(`https://api-mainnet.helius-rpc.com/v0/addresses/${encodeURIComponent(address)}/transactions`);
  url.searchParams.set('api-key',opts.apiKey);url.searchParams.set('type','SWAP');url.searchParams.set('limit','100');if(before)url.searchParams.set('before',before);
  let response:Response|undefined;
  for(let attempt=0;attempt<3;attempt++){
   response=await (opts.fetch??fetch)(url,{signal:AbortSignal.timeout(20000)});
   if(response.status!==429)break;
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
  }
  if(!response?.ok)throw new Error(`Wallet history returned HTTP ${response?.status??0}`);
  const data:unknown=await response.json();if(!Array.isArray(data))throw new Error('Wallet history returned an invalid payload');
  scanned+=data.length;const parsed=parseHeliusSwaps(data);skipped+=parsed.skipped;
   for(const event of parsed.events){const valid=SwapEventSchema.safeParse(event),at=Date.parse(event.at);if(!valid.success){skipped++;continue;}if(event.wallet===address&&at>=since&&at<=until&&!seen.has(event.signature)){events.push(valid.data);seen.add(event.signature);}}
  const last=data[data.length-1] as {signature?:unknown;timestamp?:unknown}|undefined;
   // Filtered history pages may contain fewer than limit while older swaps still exist.
   // Only an empty page or crossing the time boundary proves this scan is finished.
   if(data.length===0||typeof last?.timestamp==='number'&&last.timestamp*1000<since)break;
  if(typeof last?.signature!=='string'||last.signature===before)throw new Error('Wallet history pagination did not advance');
  before=last.signature;capped=page===pages-1;
 }
 events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return {events,scanned,skipped,capped,nextBefore:capped?before??null:null,coveredFrom:new Date(since).toISOString(),coveredTo:new Date(until).toISOString()};
}

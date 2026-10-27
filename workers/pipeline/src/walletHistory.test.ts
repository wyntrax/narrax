import {it,expect,vi} from 'vitest';
import {collectWalletHistory,historyPagesFromArgs,HISTORY_PAGE_CAP,HISTORY_PAGE_DEFAULT,WalletHistoryError} from './walletHistory';
import {WSOL_MINT} from '@narra/solana';
const now=new Date('2026-10-18T00:00:00Z'),address='wallet'.padEnd(44,'1');
const tx={type:'SWAP',signature:'sig'.padEnd(88,'1'),feePayer:address,timestamp:+now/1000-100,tokenTransfers:[{mint:WSOL_MINT,tokenAmount:1,fromUserAccount:address,toUserAccount:'pool'},{mint:'token'.padEnd(44,'1'),tokenAmount:100,fromUserAccount:'pool',toUserAccount:address}]};
it('accepts only in-window swaps owned by the requested wallet and deduplicates',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify([tx,tx,{...tx,feePayer:'other'},{...tx,timestamp:+now/1000-31*86400}])));
 const result=await collectWalletHistory(address,{apiKey:'secret',fetch,now});
 expect(result.events).toHaveLength(1);expect(result.capped).toBe(false);
});
it('caps pagination and supplies the previous page signature',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify(Array.from({length:100},(_,i)=>({...tx,signature:String(i).padEnd(88,'1')})))));
 const result=await collectWalletHistory(address,{apiKey:'secret',fetch,now,maxPages:1});
 expect(result.capped).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
});
it('reports provider failures without exposing the key',async()=>{
 await expect(collectWalletHistory(address,{apiKey:'secret',fetch:async()=>new Response('',{status:403}),now})).rejects.toThrow('HTTP 403');
});
it('continues short filtered pages to recover older buys and reports a partial scan at the cap',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([tx])))
  .mockResolvedValueOnce(new Response(JSON.stringify([{...tx,signature:'older'.padEnd(88,'1'),timestamp:tx.timestamp-100}])))
  .mockResolvedValueOnce(new Response('[]'));
 const result=await collectWalletHistory(address,{apiKey:'secret',fetch,now});
 expect(result.events).toHaveLength(2);expect(result.capped).toBe(false);
 expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('before')).toBe(tx.signature);
 const limited=await collectWalletHistory(address,{apiKey:'secret',now,maxPages:1,fetch:async()=>new Response(JSON.stringify([tx]))});
  expect(limited.capped).toBe(true);
  expect(limited).toMatchObject({pagesRead:1,oldestObservedAt:new Date(tx.timestamp*1000).toISOString(),scannedThroughAt:new Date(tx.timestamp*1000).toISOString(),coveredFrom:new Date(+now-30*86400000).toISOString()});
});
it('distinguishes empty history from observed dates and rejects invalid timestamps',async()=>{
 const empty=await collectWalletHistory(address,{apiKey:'secret',now,fetch:async()=>new Response('[]')});
 expect(empty).toMatchObject({pagesRead:1,capped:false,scanned:0,oldestObservedAt:null,newestObservedAt:null,scannedThroughAt:null});
 await expect(collectWalletHistory(address,{apiKey:'secret',now,fetch:async()=>new Response(JSON.stringify([{...tx,timestamp:'invalid'}]))})).rejects.toMatchObject({code:'INVALID_PAYLOAD'});
});
it('reports stalled cursors and network failures without retaining sensitive provider messages',async()=>{
 await expect(collectWalletHistory(address,{apiKey:'secret',now,before:tx.signature,fetch:async()=>new Response(JSON.stringify([tx]))})).rejects.toMatchObject({code:'PAGINATION_STALLED',pagesRead:1});
 try{await collectWalletHistory(address,{apiKey:'secret',now,fetch:async()=>{throw new Error('https://provider?api-key=secret');}});throw new Error('Expected failure');}
 catch(e){expect(e).toBeInstanceOf(WalletHistoryError);expect((e as WalletHistoryError).code).toBe('NETWORK');expect(String(e)).not.toContain('secret');}
});
it('reads an explicit page depth from --pages and refuses a malformed one instead of under-fetching',()=>{
 expect(historyPagesFromArgs([])).toBe(HISTORY_PAGE_DEFAULT);
 expect(historyPagesFromArgs(['--apply'])).toBe(HISTORY_PAGE_DEFAULT);
 expect(historyPagesFromArgs(['--pages=10'])).toBe(HISTORY_PAGE_CAP);
 expect(historyPagesFromArgs(['--apply','--pages','4'])).toBe(4);
 for(const bad of [['--pages=0'],['--pages=11'],['--pages=abc'],['--pages'],['--pages=2.5']]) expect(()=>historyPagesFromArgs(bad)).toThrow(/--pages/);
});

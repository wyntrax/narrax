import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {refreshResearchHistory,HISTORY_ATTEMPT_PREFIX} from './walletResearchHistory';
import {WalletHistoryError} from './walletHistory';
const save=vi.hoisted(()=>vi.fn(async()=> 'created'));
vi.mock('./prismaStores',()=>({makeWalletEventStore:()=>({saveWalletTrade:save})}));
const now=new Date('2040-01-01T00:00:00Z'),from=new Date(+now-30*86400000).toISOString();
function fixture(wallets=[{id:'a',address:'A'},{id:'b',address:'B'}]){
 const values=new Map<string,unknown>();
 const db={$queryRaw:vi.fn(async()=>wallets),$transaction:async(ops:Promise<unknown>[])=>Promise.all(ops),
  systemSetting:{findUnique:async({where}:{where:{key:string}})=>({value:values.get(where.key)}),
   upsert:async({where,create}:{where:{key:string};create:{value:unknown}})=>{values.set(where.key,structuredClone(create.value));}}} as unknown as PrismaClient;
 return {db,values};
}
const partial={events:[],scanned:300,skipped:1,capped:true,nextBefore:'older',coveredFrom:from,coveredTo:now.toISOString(),pagesRead:3,
 oldestObservedAt:new Date(+now-60000).toISOString(),newestObservedAt:now.toISOString(),scannedThroughAt:new Date(+now-60000).toISOString()};
it('bounds requests, records sanitized failures separately, and never certifies a partial requested window',async()=>{
 const {db,values}=fixture();
 const collect=vi.fn().mockResolvedValueOnce(partial).mockRejectedValueOnce(new WalletHistoryError('PROVIDER_HTTP',1,403));
 expect(await refreshResearchHistory(db,'secret',now,collect)).toMatchObject({scanned:1,capped:1,failures:1,created:0,pagesRead:4});
 expect(collect).toHaveBeenCalledWith('A',{apiKey:'secret',now,maxPages:3});
 expect(values.get('wallet.history.a')).toMatchObject({capped:true,skipped:1,windowDays:30,verifiedCoveredFrom:null,verifiedCoveredTo:null,oldestObservedAt:partial.oldestObservedAt});
 expect(values.get('wallet.history.b')).toBeUndefined();
 expect(values.get(HISTORY_ATTEMPT_PREFIX+'b')).toMatchObject({status:'FAILED',errorCode:'PROVIDER_HTTP',httpStatus:403,attempts:1,consecutiveFailures:1,pagesRead:1,lastSuccessAt:null});
 expect(JSON.stringify([...values.values()])).not.toContain('secret');
});
it('resumes after a failed attempt without losing the successful checkpoint, then fills only the head gap',async()=>{
 const {db,values}=fixture([{id:'a',address:'A'}]);
 const collect=vi.fn().mockResolvedValueOnce(partial)
  .mockRejectedValueOnce(new Error('https://provider?api-key=secret'))
  .mockResolvedValueOnce({...partial,events:[],scanned:2,skipped:0,capped:false,nextBefore:null,pagesRead:1,scannedThroughAt:from})
  .mockResolvedValueOnce({...partial,scanned:1,skipped:0,capped:true,nextBefore:'head',coveredFrom:now.toISOString(),coveredTo:new Date(+now+13*3600000).toISOString()});
 await refreshResearchHistory(db,'secret',now,collect);
 const checkpoint=values.get('wallet.history.a');
 await refreshResearchHistory(db,'secret',new Date(+now+900000),collect);
 expect(values.get('wallet.history.a')).toEqual(checkpoint);
 expect(values.get(HISTORY_ATTEMPT_PREFIX+'a')).toMatchObject({status:'FAILED',attempts:2,lastSuccessAt:now.toISOString(),consecutiveFailures:1,errorCode:'COLLECTION_FAILED'});
 expect(JSON.stringify([...values.values()])).not.toContain('api-key');
 await refreshResearchHistory(db,'secret',new Date(+now+1800000),collect);
 expect(collect.mock.calls[2]?.[1]).toMatchObject({before:'older',now,since:new Date(from)});
 expect(values.get('wallet.history.a')).toMatchObject({capped:false,scanned:302,skipped:1,coveredFrom:from,verifiedCoveredFrom:from,verifiedCoveredTo:now.toISOString(),pagesRead:4});
 expect(values.get(HISTORY_ATTEMPT_PREFIX+'a')).toMatchObject({status:'COMPLETE',attempts:3,consecutiveFailures:0,errorCode:null});
 await refreshResearchHistory(db,'secret',new Date(+now+13*3600000),collect);
 expect(collect.mock.calls[3]?.[1]).toMatchObject({since:now});
 expect(collect.mock.calls[3]?.[1]).not.toHaveProperty('before');
 expect(values.get('wallet.history.a')).toMatchObject({capped:true,verifiedCoveredFrom:from,verifiedCoveredTo:now.toISOString()});
});
it('keeps the continuation checkpoint when storing a collected trade fails',async()=>{
 const {db,values}=fixture([{id:'a',address:'A'}]);
 await refreshResearchHistory(db,'secret',now,vi.fn().mockResolvedValue(partial));
 const checkpoint=values.get('wallet.history.a');
 save.mockRejectedValueOnce(new Error('database connection secret'));
 const collect=vi.fn().mockResolvedValue({...partial,events:[{signature:'swap',wallet:'A',mint:'token',side:'BUY',amountSol:1,tokenAmount:10,at:now.toISOString()}],nextBefore:'next'});
 expect(await refreshResearchHistory(db,'secret',new Date(+now+900000),collect)).toMatchObject({scanned:0,failures:1,created:0,pagesRead:3});
 expect(values.get('wallet.history.a')).toEqual(checkpoint);
 expect(values.get(HISTORY_ATTEMPT_PREFIX+'a')).toMatchObject({status:'FAILED',errorCode:'PERSISTENCE_FAILED',pagesRead:3});
 expect(JSON.stringify([...values.values()])).not.toContain('secret');
 await refreshResearchHistory(db,'secret',new Date(+now+1800000),collect);
 expect(collect.mock.calls[1]?.[1]).toMatchObject({before:'older'});
 expect(values.get('wallet.history.a')).toMatchObject({nextBefore:'next'});
});

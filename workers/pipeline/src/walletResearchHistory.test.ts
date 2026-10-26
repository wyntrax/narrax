import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {refreshResearchHistory} from './walletResearchHistory';
const save=vi.hoisted(()=>vi.fn(async()=> 'created'));
vi.mock('./prismaStores',()=>({makeWalletEventStore:()=>({saveWalletTrade:save})}));
it('bounds reconciliation and retains explicit incomplete coverage; provider failures never become complete scans',async()=>{
 const writes:{where:{key:string};create:{value:unknown}}[]=[];
 const db={systemSetting:{findUnique:async()=>null,upsert:async(v:typeof writes[number])=>{writes.push(v);}},trackedWallet:{findMany:async()=>[{id:'a',address:'A'},{id:'b',address:'B'}]}} as unknown as PrismaClient;
 const now=new Date('2040-01-01T00:00:00Z');
 const collect=vi.fn().mockResolvedValueOnce({events:[],scanned:300,skipped:2,capped:true,coveredFrom:'2039-12-02T00:00:00.000Z',coveredTo:now.toISOString()}).mockRejectedValueOnce(new Error('provider failed'));
 expect(await refreshResearchHistory(db,'key',now,collect)).toMatchObject({scanned:1,capped:1,failures:1,created:0});
 expect(collect).toHaveBeenCalledWith('A',{apiKey:'key',now,maxPages:3});
 expect(writes.find(w=>w.where.key==='wallet.history.a')?.create.value).toMatchObject({capped:true,skipped:2,windowDays:30});
 expect(writes.find(w=>w.where.key==='wallet.history.b')).toBeUndefined();
 expect(writes.find(w=>w.where.key==='wallet.research.historyCursor')?.create.value).toBe('b');
});
it('resumes fixed-window pages, preserves skipped evidence, and then fills only the new head gap',async()=>{
 const values=new Map<string,unknown>();
 const db={systemSetting:{findUnique:async({where}:{where:{key:string}})=>({value:values.get(where.key)}),upsert:async({where,create}:{where:{key:string};create:{value:unknown}})=>{values.set(where.key,create.value);}},trackedWallet:{findMany:async({where}:{where:{id?:{gt?:string}}})=>where.id?.gt?[]:[{id:'a',address:'A'}]}} as unknown as PrismaClient;
 const now=new Date('2040-01-01T00:00:00Z'),from=new Date(+now-30*86400000).toISOString();
 const collect=vi.fn().mockResolvedValueOnce({events:[],scanned:300,skipped:1,capped:true,nextBefore:'older',coveredFrom:from,coveredTo:now.toISOString()})
  .mockResolvedValueOnce({events:[],scanned:2,skipped:0,capped:false,nextBefore:null,coveredFrom:from,coveredTo:now.toISOString()})
  .mockResolvedValueOnce({events:[],scanned:1,skipped:0,capped:false,nextBefore:null,coveredFrom:now.toISOString(),coveredTo:new Date(+now+13*3600000).toISOString()});
 await refreshResearchHistory(db,'key',now,collect);
 await refreshResearchHistory(db,'key',new Date(+now+60000),collect);
 expect(collect.mock.calls[1]?.[1]).toMatchObject({before:'older',now,since:new Date(from)});
 expect(values.get('wallet.history.a')).toMatchObject({capped:false,scanned:302,skipped:1,coveredFrom:from});
 await refreshResearchHistory(db,'key',new Date(+now+13*3600000),collect);
 expect(collect.mock.calls[2]?.[1]).toMatchObject({since:now});
 expect(collect.mock.calls[2]?.[1]).not.toHaveProperty('before');
 expect(values.get('wallet.history.a')).toMatchObject({capped:false,scanned:303,skipped:1,coveredFrom:from});
});

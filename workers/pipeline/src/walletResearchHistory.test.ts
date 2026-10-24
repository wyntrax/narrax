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

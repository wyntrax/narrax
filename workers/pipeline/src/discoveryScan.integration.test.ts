import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { RpcHttpError, type ParsedTx, type SignatureInfo } from '@narra/solana';
import { assertTestDatabase } from '../../../scripts/test-database';
import { scanEarlyBuyers } from './walletDiscovery';
import { DiscoveryScanProgress, DISCOVERY_PROGRESS_KEY, DISCOVERY_SCAN_HEALTH_KEY } from './discoveryScanProgress';
import type { HistoryPort } from './walletFunding';

const url=new URL(process.env.DATABASE_URL??'invalid:');assertTestDatabase(url);
const db=createPrisma(url.toString()),tag=randomUUID(),ids:string[]=[];
const NOW=new Date('2040-01-01T12:00:00Z');
const keys=[DISCOVERY_PROGRESS_KEY,DISCOVERY_SCAN_HEALTH_KEY];
beforeEach(async()=>{await db.systemSetting.deleteMany({where:{key:{in:keys}}});});
afterAll(async()=>{await db.systemSetting.deleteMany({where:{key:{in:keys}}});await db.token.deleteMany({where:{id:{in:ids}}});await db.$disconnect();});
async function token(age=30*60000){const t=await db.token.create({data:{mint:`${tag}-${ids.length}`,symbol:'test',name:'scan checkpoint',createdOnChainAt:new Date(+NOW-age)}});ids.push(t.id);return t;}
function clock(at=+NOW){let time=at;return {now:()=>time,sleep:async(ms:number)=>{time+=ms;}};}
const sig=(signature:string,failed=false):SignatureInfo=>({signature,failed,blockTime:1});
const buy=(mint:string,wallet='buyer'):ParsedTx=>({blockTime:1,transaction:{message:{accountKeys:[wallet],instructions:[]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[{mint,owner:wallet,uiTokenAmount:{amount:'100'}}]}});
const state=async()=>DiscoveryScanProgress.parse((await db.systemSetting.findUniqueOrThrow({where:{key:DISCOVERY_PROGRESS_KEY}})).value);

it('preserves buyers on a 429, stops the burst, honors cooldown, and resumes without rereading successful transactions',async()=>{
 const t=await token(),other=await token(40*60000),calls:string[]=[];
 const rpc:HistoryPort={getSignaturesForAddress:async mint=>{calls.push(`page:${mint}`);return [sig('new'),sig('old')];},getParsedTransaction:async signature=>{calls.push(signature);if(signature==='new')throw new RpcHttpError('getTransaction',429);return buy(t.mint);}};
 const r=await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id,other.id],clock:clock()});
 expect(r).toMatchObject({scanned:0,requests:5,retries:2,rateLimits:3,pending:1,stopReason:'RATE_LIMITED'});
 expect(calls).toEqual([`page:${t.mint}`,'old','new','new','new']);
 expect(await db.tokenEarlyBuyers.findUnique({where:{tokenId:t.id}})).toBeNull();
 expect((await state()).pending[0]).toMatchObject({nextTransaction:1,buyers:[{wallet:'buyer',signature:'old',at:'1970-01-01T00:00:01.000Z'}]});
 expect(await scanEarlyBuyers(db,rpc,new Date(+NOW+60000),{tokenIds:[t.id],clock:clock(+NOW+60000)})).toMatchObject({stopReason:'COOLDOWN',requests:0});
 const later=new Date(+NOW+20*60000),resumed:string[]=[];
 const ok:HistoryPort={getSignaturesForAddress:async()=>{throw new Error('must resume');},getParsedTransaction:async s=>{resumed.push(s);return buy(t.mint,'second');}};
 expect(await scanEarlyBuyers(db,ok,later,{tokenIds:[t.id],clock:clock(+later)})).toMatchObject({scanned:1,complete:1,buyersFound:2,resumed:1,requests:1,pending:0});
 expect(resumed).toEqual(['new']);
 expect((await db.tokenEarlyBuyers.findUniqueOrThrow({where:{tokenId:t.id}})).buyers).toMatchObject([{rank:1,wallet:'buyer',signature:'old'},{rank:2,wallet:'second',signature:'new'}]);
});

it('resumes the saved signature cursor after the fresh-token window, retaining the true oldest 40 candidates',async()=>{
 const t=await token(),pages:(string|undefined)[]=[],transactions:string[]=[];
 const first=Array.from({length:1000},(_,i)=>sig(`first-${i}`,i>=990));
 const rpc:HistoryPort={getSignaturesForAddress:async(_mint,opts)=>{pages.push(opts?.before);if(opts?.before)throw new RpcHttpError('getSignaturesForAddress',429,3600000);return first;},getParsedTransaction:async()=>{throw new Error('no transactions before history is complete');}};
 expect(await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock()})).toMatchObject({requests:2,stopReason:'RATE_LIMITED'});
 expect((await state()).pending[0]).toMatchObject({pagesRead:1,before:'first-999',historyComplete:false});
 const later=new Date(+NOW+7*3600000);
 const ok:HistoryPort={getSignaturesForAddress:async(_mint,opts)=>{expect(opts?.before).toBe('first-999');return [sig('last-new'),sig('failed',true),sig('last-old')];},getParsedTransaction:async s=>{transactions.push(s);return null;}};
 expect(await scanEarlyBuyers(db,ok,later,{tokenIds:[t.id],clock:clock(+later)})).toMatchObject({complete:1,requests:41,resumed:1});
 expect(transactions).toEqual(['last-old','last-new',...Array.from({length:38},(_,i)=>`first-${989-i}`)]);
});

it('counts retries against the original per-run ceiling and checkpoints the remaining transaction',async()=>{
 const t=await token();let first=true;const seen:string[]=[];
 const rpc:HistoryPort={getSignaturesForAddress:async()=>{if(first){first=false;throw new RpcHttpError('getSignaturesForAddress',429);}return Array.from({length:40},(_,i)=>sig(`s${i}`));},getParsedTransaction:async s=>{seen.push(s);return null;}};
 // Two retries consume two of the 42 slots; one transaction must wait.
 let once=true;const original=rpc.getParsedTransaction;rpc.getParsedTransaction=async s=>{if(once){once=false;throw new RpcHttpError('getTransaction',429);}return original(s);};
 expect(await scanEarlyBuyers(db,rpc,NOW,{maxTokens:1,tokenIds:[t.id],clock:clock()})).toMatchObject({requests:42,retries:2,stopReason:'REQUEST_BUDGET',scanned:0});
 expect(seen).toHaveLength(39);expect((await state()).pending[0]?.nextTransaction).toBe(39);
 const later=new Date(+NOW+60000);
 expect(await scanEarlyBuyers(db,rpc,later,{maxTokens:1,tokenIds:[t.id],clock:clock(+later)})).toMatchObject({requests:1,complete:1});
 expect(seen).toHaveLength(40);expect(new Set(seen).size).toBe(40);
});

it('never publishes a partial buyer list after a non-rate-limit error and only stores safe error codes',async()=>{
 const t=await token();const rpc:HistoryPort={getSignaturesForAddress:async()=>[sig('s')],getParsedTransaction:async()=>{throw new Error('https://provider.invalid/?api-key=secret');}};
 expect(await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock()})).toMatchObject({scanned:0,requests:2,retries:0,pending:1,errors:[`${t.mint.slice(0,6)}: RPC_READ_FAILED`]});
 expect(await db.tokenEarlyBuyers.findUnique({where:{tokenId:t.id}})).toBeNull();
 expect(JSON.stringify(await db.systemSetting.findMany({where:{key:{in:keys}}}))).not.toContain('secret');
});

it('expires stalled progress after 24 hours without treating its partial evidence as a completed scan',async()=>{
 const t=await token();const rpc:HistoryPort={getSignaturesForAddress:async()=>[sig('s')],getParsedTransaction:async()=>{throw new RpcHttpError('getTransaction',429,3600000);}};
 await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock()});
 const later=new Date(+NOW+25*3600000);
 expect(await scanEarlyBuyers(db,rpc,later,{tokenIds:[t.id],clock:clock(+later)})).toMatchObject({expired:1,requests:0,pending:0});
 expect(await db.tokenEarlyBuyers.findUnique({where:{tokenId:t.id}})).toBeNull();
});

it.each(['unknown version','null'])('refuses malformed checkpoints (%s) and makes zero provider requests',async kind=>{
 const value=kind==='null'?null:{version:99,pending:[]};
 const t=await token();await db.systemSetting.create({data:{key:DISCOVERY_PROGRESS_KEY,value:value??Prisma.JsonNull}});
 const rpc:HistoryPort={getSignaturesForAddress:async()=>{throw new Error('must not call');},getParsedTransaction:async()=>{throw new Error('must not call');}};
 expect(await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock()})).toMatchObject({stopReason:'INVALID_PROGRESS',requests:0});
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:DISCOVERY_PROGRESS_KEY}})).value).toEqual(value);
});

it('keeps its durable checkpoint if atomic publication fails, then publishes without another provider read',async()=>{
 const t=await token();
 const interrupted=new Proxy(db,{get(target,key){if(key==='$transaction')return async()=>{throw Object.assign(new Error('private database context https://example.invalid/secret'),{code:'P2028'});};return Reflect.get(target,key);}});
 const rpc:HistoryPort={getSignaturesForAddress:async()=>[sig('s')],getParsedTransaction:async()=>buy(t.mint)};
 await expect(scanEarlyBuyers(interrupted,rpc,NOW,{tokenIds:[t.id],clock:clock()})).rejects.toThrow(new Error('Discovery checkpoint persistence failed (P2028)'));
 expect(await db.tokenEarlyBuyers.findUnique({where:{tokenId:t.id}})).toBeNull();
 expect((await state()).pending[0]).toMatchObject({nextTransaction:1,buyers:[{signature:'s'}]});
 expect(await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock()})).toMatchObject({requests:0,scanned:1,complete:1,resumed:1,pending:0});
 expect((await db.tokenEarlyBuyers.findUniqueOrThrow({where:{tokenId:t.id}})).buyers).toHaveLength(1);
});

it('drops a blacklisted checkpoint and never restarts first-page failures outside the young-token window',async()=>{
 const t=await token();const rpc:HistoryPort={getSignaturesForAddress:async()=>{throw new RpcHttpError('getSignaturesForAddress',429,3600000);},getParsedTransaction:async()=>null};
 await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock()});
 const later=new Date(+NOW+7*3600000);
 expect(await scanEarlyBuyers(db,rpc,later,{tokenIds:[t.id],clock:clock(+later)})).toMatchObject({expired:1,pending:0,requests:0});
 const second=await token();await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[second.id],clock:clock()});
 await db.token.update({where:{id:second.id},data:{blacklisted:true}});
 const hour=new Date(+NOW+2*3600000);
 expect(await scanEarlyBuyers(db,rpc,hour,{tokenIds:[second.id],clock:clock(+hour)})).toMatchObject({expired:1,pending:0,requests:0});
});

it('uses the secondary for the same transaction and persists primary cooldown across scheduled runs',async()=>{
 const t=await token(),primaryCalls:string[]=[],fallbackCalls:string[]=[];
 const rpc:HistoryPort={getSignaturesForAddress:async()=>[sig('s')],getParsedTransaction:async s=>{primaryCalls.push(s);throw new RpcHttpError('getTransaction',429,3600000);}};
 const fallback:HistoryPort={getSignaturesForAddress:async()=>[sig('second')],getParsedTransaction:async s=>{fallbackCalls.push(s);return buy(t.mint);}};
 expect(await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock(),fallbackRpc:fallback})).toMatchObject({complete:1,requests:3,retries:1,primaryRequests:2,fallbackRequests:1,failovers:1});
 expect(primaryCalls).toEqual(['s']);expect(fallbackCalls).toEqual(['s']);
 expect(Date.parse((await state()).primaryCooldownUntil!)).toBeGreaterThan(+NOW+3500000);
 const second=await token(),later=new Date(+NOW+20*60000);
 expect(await scanEarlyBuyers(db,rpc,later,{tokenIds:[second.id],clock:clock(+later),fallbackRpc:fallback})).toMatchObject({complete:1,primaryRequests:0,fallbackRequests:2,failovers:0});
 expect(primaryCalls).toEqual(['s']);
});

it('passes the saved pagination cursor unchanged to the fallback after a 429',async()=>{
 const t=await token(),before:(string|undefined)[]=[];
 const rpc:HistoryPort={getSignaturesForAddress:async(_mint,opts)=>{if(opts?.before)throw new RpcHttpError('getSignaturesForAddress',429);return Array.from({length:1000},(_,i)=>sig(`page-${i}`,true));},getParsedTransaction:async()=>null};
 const fallback:HistoryPort={getSignaturesForAddress:async(mint,opts)=>{expect(mint).toBe(t.mint);before.push(opts?.before);return [sig('oldest')];},getParsedTransaction:async s=>{expect(s).toBe('oldest');return buy(t.mint);}};
 expect(await scanEarlyBuyers(db,rpc,NOW,{tokenIds:[t.id],clock:clock(),fallbackRpc:fallback})).toMatchObject({complete:1,requests:4,primaryRequests:2,fallbackRequests:2,failovers:1});
 expect(before).toEqual(['page-999']);
});

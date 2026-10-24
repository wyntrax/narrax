import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createPrisma} from '@narra/database';
import {buildApp} from './app';
import {seedTestPro,clearTestPro} from './test-membership';
import {assertTestDatabase} from '../../../scripts/test-database';
import {WalletDetailSchema,WalletTradesSchema,SmartWalletsSchema} from '../../web/src/features/research/contracts';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=`ux${randomUUID().replace(/[^a-z]/g,'')}`,at=new Date();
let app:Awaited<ReturnType<typeof buildApp>>,userId:string;
const wallets:string[]=[],tokens:string[]=[];
beforeAll(async()=>{
 const privyUserId=`did:privy:${tag}`;userId=(await db.user.create({data:{privyUserId}})).id;
  app=await buildApp({account:{db,verifier:{verify:async()=>({privyUserId})},now:()=>at}});
  await seedTestPro(db,userId);
});
afterAll(async()=>{
 await clearTestPro(db,[userId]);
 await app?.close();await db.trackedWallet.deleteMany({where:{id:{in:wallets}}});
 await db.systemSetting.deleteMany({where:{key:{in:tokens.map(id=>`research.market.${id}`)}}});
 await db.token.deleteMany({where:{id:{in:tokens}}});await db.user.deleteMany({where:{id:userId}});await db.$disconnect();
});
async function get(url:string){const res=await app.inject({method:'GET',url,headers:{authorization:'Bearer fixture'}});expect(res.statusCode).toBe(200);return res.json();}
it('shows pending profiles, searches globally, filters sources and pages without duplicates',async()=>{
 for(let i=0;i<3;i++){const w=await db.trackedWallet.create({data:{address:`${tag}${'abc'[i]}`.padEnd(40,'x').replace(/[0OIl]/g,'x'),label:`${tag} ${i}`,source:i===2?'IMPORT':'MANUAL',active:i!==2,createdAt:new Date(+at-i*1000)}});wallets.push(w.id);}
 const first=await get(`/v1/smart-money/wallets?q=${tag}&source=MANUAL&limit=1`);
 expect(SmartWalletsSchema.safeParse(first).success).toBe(true);expect(first.items).toHaveLength(1);
 expect(first.items[0]).toMatchObject({score:null,profileAt:null,observedTrades:0,lastTradeAt:null});
 const second=await get(`/v1/smart-money/wallets?q=${tag}&source=MANUAL&limit=1&cursor=${first.nextCursor}`);
 expect(second.items).toHaveLength(1);expect(second.items[0].address).not.toBe(first.items[0].address);expect(second.nextCursor).toBeNull();
 expect((await get(`/v1/smart-money/wallets?q=${tag}&source=IMPORT`)).items).toHaveLength(0);
 expect((await get('/v1/smart-money/wallets?q=%25')).items).toHaveLength(0);
 expect(WalletDetailSchema.safeParse(await get(`/v1/wallets/${first.items[0].address}`)).success).toBe(true);
 expect(WalletTradesSchema.safeParse(await get(`/v1/wallets/${first.items[0].address}/trades`)).success).toBe(true);
});
it('includes resolved names in wallet transaction rows and recent wallet activity',async()=>{
 const w=await db.trackedWallet.findUniqueOrThrow({where:{id:wallets[0]}});
  const token=await db.token.create({data:{mint:`${tag}-metadata`,symbol:'NAMED',name:'Resolved token name'}});tokens.push(token.id);
  const imageUrl='https://cdn.dexscreener.com/cms/images/wallet-fixture.png';
  await db.systemSetting.create({data:{key:`research.market.${token.id}`,value:{mint:token.mint,imageUrl,metricId:'artwork-observation',at:at.toISOString(),source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:null,pairAddress:'fixture',dexId:'raydium',pairCreatedAt:null}}});
 await db.walletTrade.create({data:{walletId:w.id,tokenId:token.id,signature:`${tag}-named-trade`,side:'BUY',amountSol:1,tokenAmount:100,at}});
 const list=await get(`/v1/wallets/${w.address}/trades`),detail=await get(`/v1/wallets/${w.address}`);
  expect(list.items[0].token).toMatchObject({symbol:'NAMED',name:'Resolved token name',imageUrl});
  expect(detail.recentTrades[0].token.imageUrl).toBe(imageUrl);
 expect(detail.recentTrades[0].token.name).toBe('Resolved token name');
 expect(WalletTradesSchema.parse(list).items[0]!.token.name).toBe('Resolved token name');
});
it('filters real market-cap ranges and orders globally while excluding FDV, stale and unknown provenance',async()=>{
 const definitions=[{cap:5000},{cap:50000},{cap:75000},{cap:100000},{cap:25000,fdv:true},{cap:20000,stale:true},{cap:15000,unknown:true}];
 for(const [i,d] of definitions.entries()){
  const token=await db.token.create({data:{mint:`${tag}-cap-${i}`,symbol:`${tag}${i}`,name:'Range fixture'}});tokens.push(token.id);
  const metricAt=d.stale?new Date(+at-16*60000):at;
  const metric=await db.tokenMetric.create({data:{tokenId:token.id,priceUsd:1,marketCapUsd:d.cap,liquidityUsd:20000,volume24hUsd:40000,at:metricAt}});
  if(!d.unknown)await db.systemSetting.create({data:{key:`research.market.${token.id}`,value:{metricId:metric.id,at:metricAt.toISOString(),source:'dexscreener',marketCapIsFdv:!!d.fdv,priceChange1hPct:null,pairAddress:'pool',dexId:'raydium',pairCreatedAt:null}}});
 }
 const base=`/v1/tokens?q=${tag}&verifiedOnly=true&marketCapOnly=true&sort=marketCap&order=asc&minMarketCapUsd=5000&maxMarketCapUsd=50000`;
 const first=await get(`${base}&limit=1`);expect(first.items.map((x:{marketCapUsd:number})=>x.marketCapUsd)).toEqual([5000]);
 const second=await get(`${base}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);expect(second.items.map((x:{marketCapUsd:number})=>x.marketCapUsd)).toEqual([50000]);expect(second.nextCursor).toBeNull();
 const high=await get(`/v1/tokens?q=${tag}&verifiedOnly=true&marketCapOnly=true&sort=marketCap&order=desc&minMarketCapUsd=50000&maxMarketCapUsd=100000`);
 expect(high.items.map((x:{marketCapUsd:number})=>x.marketCapUsd)).toEqual([100000,75000,50000]);
});

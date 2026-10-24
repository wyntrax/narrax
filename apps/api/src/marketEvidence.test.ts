import {describe,it,expect,vi} from 'vitest';
import {observation,marketEvidence,marketTokenImage,marketTokenImages} from './marketEvidence';
import type {PrismaClient} from '@narra/database';
const at=new Date('2026-10-16T00:00:00Z');
const value={metricId:'real-row',mint:'token-one',imageUrl:'https://dd.dexscreener.com/ds-data/tokens/solana/one.png',source:'dexscreener' as const,at:at.toISOString(),marketCapIsFdv:true,priceChange1hPct:0,pairAddress:'pool',dexId:'raydium',pairCreatedAt:null};
describe('market evidence boundary',()=>{
 it('never attributes a legacy or different metric to a newer provider observation',()=>{expect(observation(undefined,'real-row',at)).toBeNull();expect(observation(value,'fixture-row',at)).toBeNull();expect(observation(value,'real-row',at)).toMatchObject({stale:false,priceChange1hPct:0,marketCapIsFdv:true});});
 it('marks old and future observations stale',()=>{expect(observation(value,'real-row',new Date(+at+16*60000))?.stale).toBe(true);expect(observation(value,'real-row',new Date(+at-1))?.stale).toBe(true);});
 it('rejects unaudited source names and malformed provider metadata',async()=>{
  const db={systemSetting:{findMany:async()=>[{key:'research.market.good',value},{key:'research.market.bad',value:{...value,source:'fixture'}},{key:'research.market.broken',value:{...value,at:'yesterday'}}]}} as unknown as PrismaClient;
  expect([...await marketEvidence(db,['good','bad','broken'])].map(([key])=>key)).toEqual(['good']);
 });
 it('only shows artwork bound to the requested token and supplied by an approved origin',()=>{
  const parsed={...value,imageUrl:'https://dd.dexscreener.com/ds-data/tokens/solana/one.png'};
  expect(marketTokenImage(parsed,'token-one')).toBe(parsed.imageUrl);
  expect(marketTokenImage(parsed,'token-two')).toBeNull();
  expect(marketTokenImage({...parsed,mint:undefined},'token-one')).toBeNull();
  expect(marketTokenImage({...parsed,imageUrl:'https://evil.example/one.png'},'token-one')).toBeNull();
  expect(marketTokenImage(undefined,'token-one')).toBeNull();
 });
 it('batches and deduplicates page artwork without confusing mints, legacy evidence or untrusted origins',async()=>{
  const findMany=vi.fn(async()=>[
   {key:'research.market.good',value},
   {key:'research.market.wrong',value},
   {key:'research.market.legacy',value:{...value,mint:undefined}},
   {key:'research.market.untrusted',value:{...value,imageUrl:'https://evil.example/logo.png'}},
  ]);
  const db={systemSetting:{findMany}} as unknown as PrismaClient;
  const tokens=[{id:'good',mint:'token-one'},{id:'good',mint:'token-one'},{id:'wrong',mint:'token-two'},{id:'legacy',mint:'token-one'},{id:'untrusted',mint:'token-one'},{id:'missing',mint:'token-one'}];
  expect([...await marketTokenImages(db,tokens)]).toEqual([['good',value.imageUrl],['wrong',null],['legacy',null],['untrusted',null],['missing',null]]);
  expect(findMany).toHaveBeenCalledTimes(1);expect(findMany).toHaveBeenCalledWith({where:{key:{in:['good','wrong','legacy','untrusted','missing'].map(id=>`research.market.${id}`)}}});
  findMany.mockClear();expect([...await marketTokenImages(db,[])]).toEqual([]);expect(findMany).not.toHaveBeenCalled();
 });
});

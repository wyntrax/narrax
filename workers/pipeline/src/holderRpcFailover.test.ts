import {describe,expect,it,vi} from 'vitest';
import {HOLDER_RPC_FAILOVER_LIMITS,holderRpcEndpointPools,holderRpcEndpoints,makeFailoverHolderSource,makePooledHolderSource} from './holderRpcFailover';
import type {HolderRpcResult} from './holderRpc';

const NOW=Date.parse('2051-03-01T12:00:00Z');
const ok=(mint:string):HolderRpcResult=>({ok:true,mint,holders:200,top10Pct:30,sourceAt:new Date(NOW-10_000),slot:123,accounts:205,program:'test-program'});
const fail=(reason:'RATE_LIMITED'|'UNAVAILABLE'|'STALE'):HolderRpcResult=>({ok:false,reason});
const endpoint=(result:HolderRpcResult)=>({get:vi.fn(async(_mint:string)=>result)});

describe('holder rpc failover',()=>{
 it('uses the primary while it answers',async()=>{
  const primary=endpoint(ok('m1')),fallback=endpoint(ok('m1'));
  const source=makeFailoverHolderSource(primary,fallback,{now:()=>NOW});
  expect(await source.get('m1')).toMatchObject({ok:true,endpoint:'primary',failedOver:false});
  expect(fallback.get).not.toHaveBeenCalled();
 });

 it('retries the whole token on the fallback after a 429',async()=>{
  const primary=endpoint(fail('RATE_LIMITED')),fallback=endpoint(ok('m1'));
  const source=makeFailoverHolderSource(primary,fallback,{now:()=>NOW});
  expect(await source.get('m1')).toMatchObject({ok:true,endpoint:'fallback',failedOver:true,holders:200});
  expect(primary.get).toHaveBeenCalledWith('m1');
  expect(fallback.get).toHaveBeenCalledWith('m1');
  expect(source.primaryCooldownUntil?.()).toBe(new Date(NOW+HOLDER_RPC_FAILOVER_LIMITS.cooldownMs).toISOString());
 });

 it('skips the primary for the cooldown window and probes it again afterwards',async()=>{
  let now=NOW;
  const primary=endpoint(fail('RATE_LIMITED')),fallback=endpoint(ok('m1'));
  const source=makeFailoverHolderSource(primary,fallback,{now:()=>now});
  await source.get('m1');
  primary.get.mockClear();fallback.get.mockClear();
  expect(await source.get('m2')).toMatchObject({ok:true,endpoint:'fallback',failedOver:false});
  expect(primary.get).not.toHaveBeenCalled();
  now+=HOLDER_RPC_FAILOVER_LIMITS.cooldownMs+1;
  await source.get('m3');
  expect(primary.get).toHaveBeenCalledTimes(1);
 });

 it('does not swing on a data problem',async()=>{
  const primary=endpoint(fail('STALE')),fallback=endpoint(ok('m1'));
  const source=makeFailoverHolderSource(primary,fallback,{now:()=>NOW});
  expect(await source.get('m1')).toMatchObject({ok:false,reason:'STALE',endpoint:'primary'});
  expect(fallback.get).not.toHaveBeenCalled();
 });

 it('returns the fallback reason when both endpoints reject the token',async()=>{
  const primary=endpoint(fail('RATE_LIMITED')),fallback=endpoint(fail('UNAVAILABLE'));
  const source=makeFailoverHolderSource(primary,fallback,{now:()=>NOW});
  expect(await source.get('m1')).toMatchObject({ok:false,reason:'UNAVAILABLE',endpoint:'fallback',failedOver:true});
 });
});

describe('holder rpc endpoints',()=>{
 const shared='https://shared.example/?k=1',sharedFallback='https://shared2.example/?k=2',holder='https://holder.example/?k=3',holderFallback='https://holder2.example/?k=4';

 it('is disabled without any endpoint',()=>{
  expect(holderRpcEndpoints({})).toBeNull();
 });

 it('keeps the shared pair when no holder-specific key is set',()=>{
  expect(holderRpcEndpoints({HELIUS_RPC_URL:shared,HELIUS_RPC_FALLBACK_URL:sharedFallback})).toEqual({primary:shared,fallback:sharedFallback});
  expect(holderRpcEndpoints({HELIUS_RPC_URL:shared})).toEqual({primary:shared,fallback:null});
 });

 it('uses a dedicated pair without touching the shared keys',()=>{
  expect(holderRpcEndpoints({HELIUS_RPC_URL:shared,HELIUS_RPC_FALLBACK_URL:sharedFallback,HOLDER_RPC_URL:holder,HOLDER_RPC_FALLBACK_URL:holderFallback})).toEqual({primary:holder,fallback:holderFallback});
 });

 it('never silently backs a dedicated primary with a shared key',()=>{
  expect(holderRpcEndpoints({HELIUS_RPC_URL:shared,HELIUS_RPC_FALLBACK_URL:sharedFallback,HOLDER_RPC_URL:holder})).toEqual({primary:holder,fallback:null});
 });

 it('accepts a dedicated fallback over the shared primary',()=>{
  expect(holderRpcEndpoints({HELIUS_RPC_URL:shared,HOLDER_RPC_FALLBACK_URL:holderFallback})).toEqual({primary:shared,fallback:holderFallback});
 });

 it('ignores blank and duplicate URLs',()=>{
  expect(holderRpcEndpoints({HELIUS_RPC_URL:shared,HOLDER_RPC_URL:'   ',HOLDER_RPC_FALLBACK_URL:shared})).toEqual({primary:shared,fallback:null});
  expect(holderRpcEndpoints({HOLDER_RPC_URL:holder,HOLDER_RPC_FALLBACK_URL:holder})).toEqual({primary:holder,fallback:null});
 });

 it('builds four primary and four fallback pools, excluding cross-tier duplicates',()=>{
  const primary=Array.from({length:4},(_,index)=>`https://primary-${index}.example/?k=${index}`);
  const fallback=Array.from({length:4},(_,index)=>`https://fallback-${index}.example/?k=${index}`);
  expect(holderRpcEndpointPools({sharedPrimary:[],sharedFallback:[],holderPrimary:[...primary,primary[0]!],holderFallback:[...fallback,primary[0]!]})).toEqual({primary,fallback});
 });
});

describe('pooled holder source',()=>{
 it('round-robins across four primaries and uses fallbacks only after all primaries fail',async()=>{
  const firstCalls:string[]=[];
  const primary=(name:string,shouldFail=false,calls=firstCalls)=>({get:vi.fn(async(mint:string)=>{calls.push(name);return shouldFail?fail('RATE_LIMITED'):ok(mint);})});
  const source=makePooledHolderSource([primary('p1'),primary('p2'),primary('p3'),primary('p4')],[primary('f1'),primary('f2')],{now:()=>NOW});
  expect(await source.get('m1')).toMatchObject({ok:true,endpoint:'primary',failedOver:false});
  expect(await source.get('m2')).toMatchObject({ok:true,endpoint:'primary',failedOver:false});
  expect(firstCalls).toEqual(['p1','p2']);

  const failCalls:string[]=[];
  const failing=makePooledHolderSource([
   primary('p1',true,failCalls),primary('p2',true,failCalls),primary('p3',true,failCalls),primary('p4',true,failCalls),
  ],[primary('f1',false,failCalls),primary('f2',false,failCalls)],{now:()=>NOW});
  expect(await failing.get('m3')).toMatchObject({ok:true,endpoint:'fallback',failedOver:true});
  expect(failCalls).toEqual(['p1','p2','p3','p4','f1']);
 });
});

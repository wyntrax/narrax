import {describe,expect,it,vi} from 'vitest';
import {HOLDER_RPC_FAILOVER_LIMITS,makeFailoverHolderSource} from './holderRpcFailover';
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

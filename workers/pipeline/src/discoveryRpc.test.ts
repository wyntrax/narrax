import { expect, it } from 'vitest';
import { RpcHttpError, RpcError } from '@narra/solana';
import { discoveryRpcBudget } from './discoveryRpc';

function clock() { let time = 0; const waits: number[] = []; return { now:()=>time, sleep:async(ms:number)=>{waits.push(ms);time+=ms;}, waits }; }
it('paces attempts, honors Retry-After, and counts retries in the same request budget',async()=>{
 const c=clock(),b=discoveryRpcBudget(3,c),times:number[]=[];
 let n=0;
 expect(await b.call(async()=>{times.push(c.now());if(n++===0)throw new RpcHttpError('getTransaction',429,5000);return 'ok';})).toBe('ok');
 await b.call(async()=>{times.push(c.now());return null;});
 expect(times).toEqual([0,5000,6000]);
 await expect(b.call(async()=>{throw new Error('must not call');})).rejects.toMatchObject({reason:'REQUEST_BUDGET'});
 expect(b.stats).toEqual({requests:3,retries:1,rateLimits:1});
});
it('stops after two retries across the entire run, preserving a provider cooldown',async()=>{
 const c=clock(),b=discoveryRpcBudget(210,c);
 await expect(b.call(async()=>{throw new RpcHttpError('getTransaction',429);})).rejects.toMatchObject({reason:'RATE_LIMITED',retryAt:906000});
 expect(b.stats).toEqual({requests:3,retries:2,rateLimits:3});expect(c.waits).toEqual([2000,4000]);
});
it('defers a long Retry-After without early retry or unbounded sleeping',async()=>{
 const c=clock(),b=discoveryRpcBudget(210,c);
 await expect(b.call(async()=>{throw new RpcHttpError('getTransaction',429,3600000);})).rejects.toMatchObject({reason:'RATE_LIMITED',retryAt:3600000});
 expect(b.stats.requests).toBe(1);expect(c.waits).toEqual([]);
});
it('shares retry allowance across different reads and never retries other failures',async()=>{
 const c=clock(),b=discoveryRpcBudget(210,c);
 for(let i=0;i<2;i++){let n=0;await b.call(async()=>{if(n++===0)throw new RpcHttpError('getTransaction',429);return null;});}
 await expect(b.call(async()=>{throw new RpcHttpError('getTransaction',429);})).rejects.toMatchObject({reason:'RATE_LIMITED'});
 expect(b.stats).toEqual({requests:5,retries:2,rateLimits:3});
 for(const error of [new RpcHttpError('getTransaction',503),new RpcError('getTransaction result had an unexpected shape')]){
  const other=discoveryRpcBudget(210,clock());await expect(other.call(async()=>{throw error;})).rejects.toBe(error);expect(other.stats.requests).toBe(1);
 }
});
it('does not spend a retry beyond the ceiling when the last request is rate-limited',async()=>{
 const b=discoveryRpcBudget(1,clock());await expect(b.call(async()=>{throw new RpcHttpError('getTransaction',429);})).rejects.toMatchObject({reason:'RATE_LIMITED'});
 expect(b.stats).toEqual({requests:1,retries:0,rateLimits:1});
});

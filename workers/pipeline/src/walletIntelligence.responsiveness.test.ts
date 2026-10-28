import { expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { recomputeWalletIntelligence } from './walletIntelligence';

it('services event-loop callbacks during preparation and publishes all operations in one transaction',async()=>{
  const now=new Date('2040-01-01T00:00:00Z');
  const wallets=Array.from({length:8},(_,i)=>({id:`w${i}`,clusterId:null,cluster:null}));
  const rows=Array.from({length:8000},(_,i)=>({id:String(i),walletId:`w${i%8}`,tokenId:`t${i}`,side:'BUY',amountSol:'1',tokenAmount:'1',at:new Date(+now-1000),marketCapUsd:null,evidence:null}));
  const operations: unknown[]=[],ticksAtWallet:number[]=[];
  let ticks=0,fetchYielded=false,transactionCalls=0;
  const heartbeat=()=>{ticks++;handle=setImmediate(heartbeat);};
  let handle=setImmediate(heartbeat);
  const record=(args:unknown)=>{const op={args};operations.push(op);return op;};
  const db={
    trackedWallet:{findMany:async()=>wallets,updateMany:record},
    walletTrade:{findMany:async()=>rows},
    systemSetting:{upsert:(args:{where:{key:string}})=>{
      if(args.where.key.startsWith('wallet.performance.'))ticksAtWallet.push(ticks);
      return record(args);
    }},
    walletProfile:{deleteMany:record},
    walletRelationship:{deleteMany:record},walletCluster:{deleteMany:record},
    $transaction:async(ops:unknown[])=>{
      transactionCalls++;expect(ops).toEqual(operations);expect(ticksAtWallet).toHaveLength(wallets.length);
      return ops;
    },
  };
  // A callback scheduled before loading must run before CPU preparation ends.
  const pending=setImmediate(()=>{fetchYielded=true;});
  try {
    const result=await recomputeWalletIntelligence(db as unknown as PrismaClient,now);
    expect(fetchYielded).toBe(true);
    expect(transactionCalls).toBe(1);expect(result.tradesUsed).toBe(rows.length);
    expect(ticksAtWallet[0]).toBeGreaterThan(0);
    for(let i=1;i<ticksAtWallet.length;i++)expect(ticksAtWallet[i]).toBeGreaterThan(ticksAtWallet[i-1]!);
  } finally {clearImmediate(handle);clearImmediate(pending);}
});

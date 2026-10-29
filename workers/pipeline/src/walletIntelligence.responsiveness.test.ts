import { expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { recomputeWalletIntelligence } from './walletIntelligence';

it('services event-loop callbacks during preparation and publishes all operations in one transaction',async()=>{
  const now=new Date('2040-01-01T00:00:00Z');
  const wallets=Array.from({length:8},(_,i)=>({id:`w${i}`,clusterId:null,cluster:null}));
  const rows=Array.from({length:8000},(_,i)=>({id:String(i),walletId:`w${i%8}`,tokenId:`t${i}`,side:'BUY',amountSol:'1',tokenAmount:'1',at:new Date(+now-1000),marketCapUsd:null,evidence:null}));
   const operations: unknown[]=[],ticksAtPage:number[]=[];
   let ticks=0,fetchYielded=false,transactionCalls=0,readTransactions=0;
  const heartbeat=()=>{ticks++;handle=setImmediate(heartbeat);};
  let handle=setImmediate(heartbeat);
  const record=(args:unknown)=>{const op={args};operations.push(op);return op;};
  const db={
    trackedWallet:{findMany:async()=>wallets,updateMany:record},
    walletTrade:{findMany:async(args:{take:number;cursor?:{id:string}})=>{ticksAtPage.push(ticks);const start=args.cursor?rows.findIndex(r=>r.id===args.cursor!.id)+1:0;return rows.slice(start,start+args.take);}},
    $executeRaw:(sql:TemplateStringsArray,payload:string)=>record({sql:sql.join('?'),rows:JSON.parse(payload)}),
    systemSetting:{deleteMany:record,createMany:record},
    walletProfile:{deleteMany:record},
    walletRelationship:{deleteMany:record},walletCluster:{deleteMany:record},
    $transaction:async(ops:unknown[]|((tx:unknown)=>unknown)):Promise<unknown>=>{
      if(typeof ops==='function'){readTransactions++;return ops(db);}
      transactionCalls++;expect(ops).toEqual(operations);
      return ops;
    },
  };
  // A callback scheduled before loading must run before CPU preparation ends.
  const pending=setImmediate(()=>{fetchYielded=true;});
  try {
    const result=await recomputeWalletIntelligence(db as unknown as PrismaClient,now);
    expect(fetchYielded).toBe(true);
    expect(transactionCalls).toBe(1);expect(result.tradesUsed).toBe(rows.length);
    expect(readTransactions).toBe(1);expect(result.readPages).toBe(5);
    for(let i=1;i<ticksAtPage.length;i++)expect(ticksAtPage[i]).toBeGreaterThan(ticksAtPage[i-1]!);
    expect(ticks).toBeGreaterThanOrEqual(result.readPages+wallets.length);
  } finally {clearImmediate(handle);clearImmediate(pending);}
});

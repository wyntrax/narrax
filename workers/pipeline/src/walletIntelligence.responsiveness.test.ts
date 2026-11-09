import { expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { recomputeWalletIntelligence } from './walletIntelligence';

it('services event-loop callbacks during preparation and publishes all operations in one transaction',async()=>{
  const now=new Date('2040-01-01T00:00:00Z');
  const wallets=Array.from({length:8},(_,i)=>({id:`w${i}`,clusterId:null,cluster:null}));
  const rows=Array.from({length:8000},(_,i)=>({id:String(i),walletId:`w${i%8}`,tokenId:`t${i}`,side:'BUY',amountSol:'1',tokenAmount:'1',at:new Date(+now-1000),marketCapUsd:null,evidence:null}));
   const operations: unknown[]=[],ticksAtPage:number[]=[];
   let ticks=0,fetchYielded=false,transactionCalls=0,readTransactions=0,readOptions:unknown,publishOptions:unknown;
  const heartbeat=()=>{ticks++;handle=setImmediate(heartbeat);};
  let handle=setImmediate(heartbeat);
  const record=(args:unknown)=>{const op={args};operations.push(op);return op;};
  const tx={
    $executeRaw:(sql:TemplateStringsArray,payload:string)=>record({sql:sql.join('?'),rows:JSON.parse(payload)}),
    systemSetting:{deleteMany:record,createMany:record},
    walletProfile:{deleteMany:record},
    walletMetric:{createMany:record},
    trackedWallet:{updateMany:record},
    walletRelationship:{deleteMany:record,createMany:record},
    walletCluster:{deleteMany:record,create:record},
    consensusSignal:{create:record},
  };
  const db={
    trackedWallet:{findMany:async()=>wallets},
    $queryRaw:async(_sql:TemplateStringsArray,_from:Date,_to:Date,after:{values:unknown[]},take:number)=>{
      ticksAtPage.push(ticks);const start=after.values.length?rows.findIndex(r=>r.id===after.values[1])+1:0;return rows.slice(start,start+take);
    },
    $transaction:async(ops:unknown[]|((tx:unknown)=>unknown),opts?:unknown):Promise<unknown>=>{
      if(typeof ops==='function'){
        if((opts as {timeout?:number}|undefined)?.timeout===120_000){readTransactions++;readOptions=opts;return ops(db);}
        transactionCalls++;publishOptions=opts;return ops(tx);
      }
      throw new Error('expected only callback transactions');
    },
  };
  // A callback scheduled before loading must run before CPU preparation ends.
  const pending=setImmediate(()=>{fetchYielded=true;});
  try {
    const result=await recomputeWalletIntelligence(db as unknown as PrismaClient,now);
    expect(fetchYielded).toBe(true);
    expect(transactionCalls).toBe(1);expect(result.tradesUsed).toBe(rows.length);
    expect(readTransactions).toBe(1);expect(result.readPages).toBe(5);
    expect(result.publicationOperations).toBe(operations.length);
    expect(readOptions).toMatchObject({isolationLevel:'RepeatableRead',timeout:120_000,maxWait:10_000});
    expect(publishOptions).toMatchObject({timeout:30_000,maxWait:10_000});
    for(let i=1;i<ticksAtPage.length;i++)expect(ticksAtPage[i]).toBeGreaterThan(ticksAtPage[i-1]!);
    expect(ticks).toBeGreaterThanOrEqual(result.readPages+wallets.length);
  } finally {clearImmediate(handle);clearImmediate(pending);}
});

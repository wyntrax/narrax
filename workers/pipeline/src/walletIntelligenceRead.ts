import {Prisma,type PrismaClient} from '@narra/database';
import {setImmediate as yieldToEventLoop} from 'node:timers/promises';

export const INTELLIGENCE_READ_PAGE_SIZE=2000;
const select={id:true,walletId:true,tokenId:true,side:true,amountSol:true,tokenAmount:true,at:true,marketCapUsd:true,evidence:true} satisfies Prisma.WalletTradeSelect;
type Row=Prisma.WalletTradeGetPayload<{select:typeof select}>;
/** Bound driver/compiler decoding work without truncating history or changing
 * same-time ordering. One repeatable snapshot prevents concurrent backfills from
 * moving rows across page boundaries. No writes or provider calls happen here. */
export async function readIntelligenceInputs(db:PrismaClient,from:Date,to:Date){
 return db.$transaction(async tx=>{
  const wallets=await tx.trackedWallet.findMany({where:{active:true},select:{id:true,clusterId:true,cluster:{select:{label:true}}}});
  const rows:Row[]=[];let cursor:string|undefined,pages=0;
  for(;;){
   const page=await tx.walletTrade.findMany({where:{at:{gte:from,lte:to},wallet:{active:true}},select,
    orderBy:[{at:'asc'},{id:'asc'}],take:INTELLIGENCE_READ_PAGE_SIZE,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   pages++;for(const row of page)rows.push(row);
   await yieldToEventLoop();
   if(page.length<INTELLIGENCE_READ_PAGE_SIZE)break;
   cursor=page.at(-1)!.id;
  }
  return {wallets,rows,pages};
 },{isolationLevel:'RepeatableRead',timeout:60_000});
}

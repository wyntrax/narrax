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
  const rows:Row[]=[];let cursor:Pick<Row,'id'|'at'>|undefined,pages=0;
  for(;;){
   // Prisma's cursor + skip query expands into OR/subqueries. PostgreSQL can
   // scan from `from` and discard every prior page even with the (at,id) index.
   // An explicit tuple comparison makes the boundary an index condition.
   const after=cursor?Prisma.sql`AND (t.at,t.id)>(${cursor.at},${cursor.id})`:Prisma.empty;
   const page=await tx.$queryRaw<Row[]>`SELECT t.id,t."walletId",t."tokenId",t.side::text AS side,
     t."amountSol",t."tokenAmount",t.at,t."marketCapUsd",t.evidence
    FROM "WalletTrade" t JOIN "TrackedWallet" w ON w.id=t."walletId"
    WHERE t.at>=${from} AND t.at<=${to} AND w.active=true ${after}
    ORDER BY t.at ASC,t.id ASC LIMIT ${INTELLIGENCE_READ_PAGE_SIZE}`;
   pages++;for(const row of page)rows.push(row);
   await yieldToEventLoop();
   if(page.length<INTELLIGENCE_READ_PAGE_SIZE)break;
   const last=page.at(-1)!;cursor={id:last.id,at:last.at};
  }
  return {wallets,rows,pages};
 },{isolationLevel:'RepeatableRead',timeout:60_000});
}

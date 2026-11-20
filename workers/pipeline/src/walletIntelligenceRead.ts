import {Prisma,type PrismaClient} from '@narra/database';
import {setImmediate as yieldToEventLoop} from 'node:timers/promises';

export const INTELLIGENCE_READ_PAGE_SIZE=5000;
const select={id:true,walletId:true,tokenId:true,side:true,amountSol:true,tokenAmount:true,at:true,marketCapUsd:true,evidence:true} satisfies Prisma.WalletTradeSelect;
export type IntelligenceTradeRow=Prisma.WalletTradeGetPayload<{select:typeof select}>;
export type IntelligenceWalletRow={id:string;clusterId:string|null;cluster:{label:string|null}|null};

/** Bound driver/compiler decoding work without truncating history or changing
 * same-time ordering. One repeatable snapshot prevents concurrent backfills from
 * moving rows across page boundaries. No writes or provider calls happen here. */
export async function streamIntelligenceInputs(
  db:PrismaClient,
  from:Date,
  to:Date,
  onPage:(page:IntelligenceTradeRow[],activeIds:ReadonlySet<string>)=>void|Promise<void>,
):Promise<{wallets:IntelligenceWalletRow[];pages:number}>{
 return db.$transaction(async tx=>{
  const wallets=await tx.trackedWallet.findMany({where:{active:true},select:{id:true,clusterId:true,cluster:{select:{label:true}}}});
  const activeIds=new Set(wallets.map(w=>w.id));
  let cursor:Pick<IntelligenceTradeRow,'id'|'at'>|undefined,pages=0;
  for(;;){
   // Prisma's cursor + skip query expands into OR/subqueries. PostgreSQL can
   // scan from `from` and discard every prior page even with the (at,id) index.
   // An explicit tuple comparison makes the boundary an index condition.
   const after=cursor?Prisma.sql`AND (t.at,t.id)>(${cursor.at},${cursor.id})`:Prisma.empty;
   const page=await tx.$queryRaw<IntelligenceTradeRow[]>`SELECT t.id,t."walletId",t."tokenId",t.side::text AS side,
     t."amountSol",t."tokenAmount",t.at,t."marketCapUsd",t.evidence
    FROM "WalletTrade" t JOIN "TrackedWallet" w ON w.id=t."walletId"
    WHERE t.at>=${from} AND t.at<=${to} AND w.active=true ${after}
    ORDER BY t.at ASC,t.id ASC LIMIT ${INTELLIGENCE_READ_PAGE_SIZE}`;
   pages++;
   await onPage(page,activeIds);
   await yieldToEventLoop();
   if(page.length<INTELLIGENCE_READ_PAGE_SIZE)break;
   const last=page.at(-1)!;cursor={id:last.id,at:last.at};
  }
  return {wallets,pages};
 },{isolationLevel:'RepeatableRead',timeout:180_000,maxWait:10_000});
}

export async function readIntelligenceInputs(db:PrismaClient,from:Date,to:Date){
 const rows:IntelligenceTradeRow[]=[];
 const {wallets,pages}=await streamIntelligenceInputs(db,from,to,page=>{for(const row of page)rows.push(row);});
 return {wallets,rows,pages};
}

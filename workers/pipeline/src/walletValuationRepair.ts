import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@narra/database';
import { walletTradeEvidence } from './walletResearchEvidence';

const marketReasons = new Set(['NO_CONTEMPORANEOUS_MARKET','NO_TOKEN_MARKET_HISTORY','TRADE_BEFORE_MARKET_HISTORY','NO_MARKET_IN_WINDOW','INVALID_MARKET_PROVENANCE','INVALID_MARKET_VALUES','INVALID_MARKET_CAP','FDV_ONLY','MARKET_LOOKUP_LIMIT']);
const object = (v: unknown): Record<string,unknown> => v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};

/** Explicit, bounded reconciliation using stored pre-trade observations only. No provider calls.
 * Existing valuations are immutable. Conditional writes protect against concurrent repairs. */
export async function reconcileWalletValuations(db: PrismaClient, now: Date, opts: { apply?: boolean; limit?: number; after?: string; wallet?: string } = {}) {
  const limit=opts.limit??100;
  if (!Number.isInteger(limit)||limit<1||limit>500||!Number.isFinite(+now)) throw new Error('Invalid reconciliation bounds');
  const rows=await db.walletTrade.findMany({where:{at:{gte:new Date(+now-30*86400000),lte:now},
    ...(opts.after?{id:{gt:opts.after}}:{}),wallet:{active:true,researchReview:{not:'REJECTED'},...(opts.wallet?{address:opts.wallet}:{})},
    OR:[{marketCapUsd:null},{amountUsd:null}]},orderBy:{id:'asc'},take:limit+1});
  const page=rows.slice(0,limit);
  const out={asOf:now.toISOString(),apply:!!opts.apply,scanned:page.length,changed:0,applied:0,conflicts:0,legacySkipped:0,recoverableCaps:0,recoverableUsd:0,reasons:{} as Record<string,number>,nextCursor:rows.length>limit?page.at(-1)!.id:null};
  for (const row of page) {
    const old=object(row.evidence);
    if ((row.marketCapUsd!==null||row.amountUsd!==null)&&old.eventAt!==row.at.toISOString()) { out.legacySkipped++; continue; }
    const candidate=await walletTradeEvidence(db,row.tokenId,row.at,Number(row.amountSol));
    const missingCap=row.marketCapUsd===null,missingUsd=row.amountUsd===null;
    const reasons=[...(Array.isArray(old.reasons)?old.reasons.filter((r):r is string=>typeof r==='string'):[])
      .filter(r=>!(missingCap&&marketReasons.has(r))&&!(missingUsd&&r==='NO_CONTEMPORANEOUS_SOL')),
      ...candidate.evidence.reasons.filter(r=>missingCap&&marketReasons.has(r)||missingUsd&&r==='NO_CONTEMPORANEOUS_SOL')];
    const evidence={...old,version:1,eventAt:row.at.toISOString(),
      market:missingCap?candidate.evidence.market:old.market??null,sol:missingUsd?candidate.evidence.sol:old.sol??null,reasons:[...new Set(reasons)].sort()};
    const cap=missingCap?candidate.marketCapUsd:row.marketCapUsd;
    const usd=missingUsd?candidate.amountUsd:row.amountUsd;
    for(const reason of evidence.reasons)out.reasons[reason]=(out.reasons[reason]??0)+1;
    const recoveredCap=missingCap&&cap!==null,recoveredUsd=missingUsd&&usd!==null;
    if (!recoveredCap&&!recoveredUsd&&isDeepStrictEqual(old,evidence))continue;
    out.changed++;if(recoveredCap)out.recoverableCaps++;if(recoveredUsd)out.recoverableUsd++;
    if(opts.apply){
      const saved=await db.walletTrade.updateMany({where:{id:row.id,at:row.at,tokenId:row.tokenId,amountSol:row.amountSol,marketCapUsd:row.marketCapUsd,amountUsd:row.amountUsd,evidence:{equals:row.evidence===null?Prisma.DbNull:row.evidence}},
        data:{...(recoveredCap?{marketCapUsd:cap}:{}),...(recoveredUsd?{amountUsd:usd}:{}),evidence:evidence as Prisma.InputJsonValue}});
      if(saved.count)out.applied++;else out.conflicts++;
    }
  }
  return out;
}

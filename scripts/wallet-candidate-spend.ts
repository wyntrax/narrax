import { parseArgs } from 'node:util';
import { createPrisma, Prisma } from '@narra/database';
import { z } from 'zod';
import { DiscoveryScanProgress, DISCOVERY_PROGRESS_KEY, DISCOVERY_SCAN_HEALTH_KEY } from '../workers/pipeline/src/discoveryScanProgress';

/** Read-only preview of the latest bounded emerging snapshot. No provider calls. */
const { values } = parseArgs({ options: { 'min-quote-sol': { type:'string',default:'0.01' } } });
const raw = values['min-quote-sol']!;
if (!/^\d+(\.\d{1,9})?$/.test(raw) || raw.length > 20) throw new Error('Use --min-quote-sol=<nonnegative decimal, at most 9 decimal places>');
const threshold = new Prisma.Decimal(raw);
const Spend = z.object({ version:z.literal(1),observedTokens:z.number().int().nonnegative(),matchedTokens:z.number().int().nonnegative(),unknownTokens:z.number().int().nonnegative(),
  medianMatchedQuoteSol:z.string().regex(/^\d+(\.\d+)?$/).nullable(),unknownReasons:z.record(z.number().int().nonnegative()) });
const Snapshot = z.object({checkedAt:z.string().datetime(),total:z.number().int().nonnegative(),capped:z.boolean(),items:z.array(z.object({address:z.string(),scannedTokens:z.number().int().nonnegative(),spend:z.unknown().optional()})).max(50)});
const u = new URL(process.env.DATABASE_URL??'invalid:');
u.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
const db = createPrisma(u.toString());
const ScanHealth = z.object({ checkedAt:z.string().datetime(),scanned:z.number(),complete:z.number(),tooLong:z.number(),buyersFound:z.number(),
  requests:z.number(),retries:z.number(),rateLimits:z.number(),resumed:z.number(),pending:z.number(),expired:z.number(),
  primaryRequests:z.number().optional(),fallbackRequests:z.number().optional(),failovers:z.number().optional(),
  fallbackConfigured:z.boolean().optional(),primaryCooldownUntil:z.string().datetime().nullable().optional(),
  stopReason:z.enum(['RATE_LIMITED','REQUEST_BUDGET','COOLDOWN','INVALID_PROGRESS']).nullable(),cooldownUntil:z.string().datetime().nullable(),errors:z.array(z.string()) });
async function main() {
  const health=ScanHealth.safeParse((await db.systemSetting.findUnique({where:{key:DISCOVERY_SCAN_HEALTH_KEY}}))?.value);
  const progressRow=await db.systemSetting.findUnique({where:{key:DISCOVERY_PROGRESS_KEY}});
  const progress=DiscoveryScanProgress.safeParse(progressRow?.value);
  const collection={health:health.success?health.data:null,progressStatus:!progressRow?'NOT_RECORDED':progress.success?'VALID':'INVALID',
    pending:progress.success?progress.data.pending.map(p=>({mint:p.mint,startedAt:p.startedAt,pagesRead:p.pagesRead,historyComplete:p.historyComplete,transactionsRead:p.nextTransaction,transactionsToRead:p.candidates.length,buyersBuffered:p.buyers.length})):null};
  const snapshot = Snapshot.safeParse((await db.systemSetting.findUnique({where:{key:'wallet.discovery.emerging'}}))?.value);
  if (!snapshot.success) { console.log(JSON.stringify({readOnly:true,status:'NO_VALID_SNAPSHOT',collection}));return; }
  const s = snapshot.data,now=new Date(),age=+now-Date.parse(s.checkedAt);
  const items=s.items.map(w=>{
    const p=Spend.safeParse(w.spend),spend=p.success?p.data:null;
    const valid=spend&&spend.observedTokens===w.scannedTokens&&spend.matchedTokens+spend.unknownTokens===spend.observedTokens
      &&(spend.matchedTokens>0?spend.medianMatchedQuoteSol!==null:spend.medianMatchedQuoteSol===null);
    const classification=!valid||spend.matchedTokens===0?'UNKNOWN':spend.unknownTokens>0?'PARTIAL_EVIDENCE':spend.matchedTokens<2?'SMALL_SAMPLE'
      :new Prisma.Decimal(spend.medianMatchedQuoteSol!).gte(threshold)?'MATCHED_QUOTE_AT_OR_ABOVE_PREVIEW':'MATCHED_QUOTE_BELOW_PREVIEW';
    return {address:w.address,scannedTokens:w.scannedTokens,classification,spend:valid?spend:null};
  });
  console.log(JSON.stringify({readOnly:true,asOf:now.toISOString(),snapshotAt:s.checkedAt,stale:age<0||age>3_600_000,total:s.total,displayed:items.length,capped:s.capped,
    previewMinQuoteSol:threshold.toFixed(),note:'Descriptive first-token transfer legs, not verified swaps, total position spend, closed-position profitability, or approval. Threshold is unvalidated and changes no intake rules. Unknowns remain unknown; matched-only medians can be biased.',
    collection,counts:items.reduce<Record<string,number>>((a,w)=>(a[w.classification]=(a[w.classification]??0)+1,a),{}),items},null,2));
}
main().catch(()=>{console.error('Candidate spend preview failed. No data was changed.');process.exitCode=1;}).finally(()=>db.$disconnect());

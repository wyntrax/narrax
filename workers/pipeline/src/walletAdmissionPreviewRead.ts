import { Prisma, type PrismaClient } from '@narra/database';
import { WalletPerformance } from '@narra/shared';
import { AdmissionSnapshot, previewWalletAdmission, type AdmissionPreviewOptions } from './walletAdmissionPreview';

/** SELECT-only, repeatable snapshot. Caller must supply a read-only DB connection. */
export async function readWalletAdmissionPreview(db: PrismaClient, now: Date, options: Partial<AdmissionPreviewOptions> = {}) {
  return db.$transaction(async tx => {
    const readOnly = await tx.$queryRaw<{transaction_read_only:string}[]>`SHOW transaction_read_only`;
    if (readOnly[0]?.transaction_read_only !== 'on') throw new Error('Admission preview requires a read-only connection');
    const row = await tx.systemSetting.findUnique({where:{key:'wallet.discovery.emerging'}});
    const parsed = AdmissionSnapshot.safeParse(row?.value);
    const addresses = parsed.success ? parsed.data.items.map(w=>w.address) : [];
    const where = {source:'DISCOVERED',active:true,researchReview:{not:'REJECTED'}};
    const [occupied,tracked,rejected,incumbents] = await Promise.all([
      tx.trackedWallet.count({where}),
      tx.trackedWallet.findMany({where:{address:{in:addresses}},select:{address:true}}),
      tx.walletCandidate.findMany({where:{address:{in:addresses},status:'REJECTED'},select:{address:true}}),
      tx.trackedWallet.findMany({where,orderBy:{id:'asc'},take:500,select:{id:true,researchReview:true}}),
    ]);
    const settings = await tx.systemSetting.findMany({where:{key:{in:incumbents.flatMap(w=>[`wallet.performance.${w.id}`,`wallet.history.${w.id}`])}},select:{key:true,value:true}});
    const values = new Map(settings.map(s=>[s.key,s.value]));
    const incumbentSummary = {scope:'ACTIVE_NON_REJECTED_DISCOVERED_ONLY',displayed:incumbents.length,truncated:occupied>incumbents.length,
      reviews:{} as Record<string,number>,validPerformance:0,missingOrInvalidPerformance:0,stalePerformance:0,
      knownClosedPositionMedian:0,unknownClosedPositionMedian:0,closedPositionMedianBelowPoint01:0,
      entryCapKnownPositions:0,entryCapTotalPositions:0,missingEntryCapCoverageSnapshots:0,
      historyMarkedComplete:0,historyMarkedPartial:0,missingHistory:0,
      note:'Descriptive cohort counts only. Stale/partial evidence does not justify removal. Closed-position medians are different from candidate transfer-leg medians; no replacement recommendations.'};
    for (const w of incumbents) {
      incumbentSummary.reviews[w.researchReview]=(incumbentSummary.reviews[w.researchReview]??0)+1;
      const p=WalletPerformance.safeParse(values.get(`wallet.performance.${w.id}`));
      const all=p.success?p.data.bands.find(b=>b.band==='ALL'):null;
      if (!p.success || !all) { incumbentSummary.missingOrInvalidPerformance++;incumbentSummary.unknownClosedPositionMedian++;incumbentSummary.missingEntryCapCoverageSnapshots++; }
      else {
        incumbentSummary.validPerformance++;
        const age=+now-Date.parse(p.data.checkedAt);if(age<0||age>45*60000)incumbentSummary.stalePerformance++;
        if(all.medianClosedPositionSol==null)incumbentSummary.unknownClosedPositionMedian++;
        else {incumbentSummary.knownClosedPositionMedian++;if(new Prisma.Decimal(all.medianClosedPositionSol).lt('.01'))incumbentSummary.closedPositionMedianBelowPoint01++;}
        if(all.entryCapKnownPositions==null||all.entryCapTotalPositions==null)incumbentSummary.missingEntryCapCoverageSnapshots++;
        else {incumbentSummary.entryCapKnownPositions+=all.entryCapKnownPositions;incumbentSummary.entryCapTotalPositions+=all.entryCapTotalPositions;}
      }
      const h=values.get(`wallet.history.${w.id}`);
      if(h&&typeof h==='object'&&!Array.isArray(h)&&h.capped===false)incumbentSummary.historyMarkedComplete++;
      else if(h&&typeof h==='object'&&!Array.isArray(h)&&h.capped===true)incumbentSummary.historyMarkedPartial++;
      else incumbentSummary.missingHistory++;
    }
    return {...previewWalletAdmission({now,snapshot:row?.value,occupied,trackedAddresses:tracked.map(w=>w.address),rejectedAddresses:rejected.map(w=>w.address)},options),incumbentSummary};
  },{isolationLevel:'RepeatableRead',timeout:30000});
}

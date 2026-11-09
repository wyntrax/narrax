import { Prisma } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';
import { z } from 'zod';
import { WALLET_INTAKE_LIMITS } from './walletCandidateIntake';

const D = Prisma.Decimal.clone({ precision: 80 });
const count = z.number().int().min(0).max(1_000_000);
export const AdmissionPreviewOptions = z.object({
  minQuoteSol: z.string().max(20).regex(/^\d+(\.\d{1,9})?$/).default('0.01'),
  minMatchedTokens: z.number().int().min(2).max(1000).default(2),
  minCoveragePercent: z.number().int().min(0).max(100).default(100),
  explorationSlots: z.number().int().min(0).max(WALLET_INTAKE_LIMITS.perCycle).default(1),
});
export type AdmissionPreviewOptions = z.infer<typeof AdmissionPreviewOptions>;
export const AdmissionSnapshot = z.object({
  checkedAt: z.string().datetime(), total: count, capped: z.boolean(),
  items: z.array(z.object({ address: z.string(), scannedTokens: count.min(2), spend: z.unknown().optional() })).max(50),
}).refine(s => s.total >= s.items.length && s.capped === (s.total > s.items.length) && new Set(s.items.map(w=>w.address)).size === s.items.length);
const Spend = z.object({
  version: z.literal(1), observedTokens: count, matchedTokens: count, unknownTokens: count,
  medianMatchedQuoteSol: z.string().max(64).regex(/^\d+(\.\d+)?$/).nullable(),
  unknownReasons: z.record(count),
}).refine(s => s.observedTokens === s.matchedTokens+s.unknownTokens &&
  Object.values(s.unknownReasons).reduce((a,b)=>a+b,0) === s.unknownTokens &&
  (s.matchedTokens === 0 ? s.medianMatchedQuoteSol === null : s.medianMatchedQuoteSol !== null &&
    s.medianMatchedQuoteSol.length <= 64 && /^\d+(\.\d+)?$/.test(s.medianMatchedQuoteSol) &&
    new D(s.medianMatchedQuoteSol).gt(0) && new D(s.medianMatchedQuoteSol).lte('18446744073.709551615')));

export interface AdmissionPreviewInput {
  now: Date;
  snapshot: unknown;
  occupied: number;
  trackedAddresses: readonly string[];
  rejectedAddresses: readonly string[];
}

/** Evidence ordering for a bounded preview, NOT an approval score or admission action.
 * Neither aggregate spend nor matched-only medians establish profitability.
 * No writes, provider reads, current valuations or incumbent removal decisions. */
export function previewWalletAdmission(input: AdmissionPreviewInput, options: Partial<AdmissionPreviewOptions> = {}) {
  const opts = AdmissionPreviewOptions.parse(options);
  if (!Number.isFinite(+input.now) || !Number.isSafeInteger(input.occupied) || input.occupied < 0) throw new Error('Invalid preview inputs');
  const parsed = AdmissionSnapshot.safeParse(input.snapshot);
  const snapshot = parsed.success ? parsed.data : null;
  const age = snapshot ? +input.now-Date.parse(snapshot.checkedAt) : null;
  const snapshotStatus = !snapshot ? 'INVALID_OR_MISSING' : age! < 0 ? 'FUTURE' : age! > 3_600_000 ? 'STALE' : 'FRESH';
  const tracked = new Set(input.trackedAddresses), rejected = new Set(input.rejectedAddresses);
  const items = (snapshot?.items ?? []).map((w,index) => {
    const exclusions = [!isSolanaAddress(w.address) ? 'INVALID_ADDRESS' : null, tracked.has(w.address) ? 'ALREADY_TRACKED' : null,
      rejected.has(w.address) ? 'REJECTED' : null].filter((r): r is string => r !== null);
    const p = Spend.safeParse(w.spend);
    const spend = p.success && p.data.observedTokens === w.scannedTokens ? p.data : null;
    const evidenceStatus = !spend ? w.spend == null ? 'MISSING' : 'INVALID' : spend.matchedTokens === 0 ? 'UNKNOWN_ONLY' : spend.unknownTokens > 0 ? 'PARTIAL' : 'FULLY_MATCHED';
    const reasons: string[] = [];
    if (!spend) reasons.push(evidenceStatus === 'MISSING' ? 'MISSING_SPEND_EVIDENCE' : 'INVALID_SPEND_EVIDENCE');
    if (!spend || spend.matchedTokens < opts.minMatchedTokens) reasons.push('TOO_FEW_MATCHED_TOKENS');
    if (!spend || spend.matchedTokens*100 < opts.minCoveragePercent*spend.observedTokens) reasons.push('INSUFFICIENT_MATCHED_COVERAGE');
    if (!spend || spend.medianMatchedQuoteSol === null) reasons.push('MATCHED_SIZE_UNKNOWN');
    else if (new D(spend.medianMatchedQuoteSol).lt(opts.minQuoteSol)) reasons.push('MATCHED_SIZE_BELOW_PREVIEW');
    const evidenceLane = reasons.length === 0;
    // Reserve exploration for genuinely unknown/partial evidence, not measured
    // fully-known below-threshold size or a known insufficient sample.
    const explorationLane = !evidenceLane && (!spend || spend.unknownTokens > 0);
    return { address: w.address, snapshotOrder: index+1, scannedTokens: w.scannedTokens, exclusions, evidenceStatus,
      lane: exclusions.length ? 'EXCLUDED' : evidenceLane ? 'EVIDENCE' : explorationLane ? 'EXPLORATION' : 'BELOW_PREVIEW',
      reasons, spend, matchedCoveragePercent: spend ? spend.matchedTokens*100/spend.observedTokens : null };
  });
  const evidence = items.filter(w=>w.lane==='EVIDENCE').sort((a,b)=>
    b.spend!.matchedTokens*a.spend!.observedTokens-a.spend!.matchedTokens*b.spend!.observedTokens ||
    b.spend!.matchedTokens-a.spend!.matchedTokens || a.address.localeCompare(b.address));
  // Unknown repeat counts do not outrank known evidence; retain existing snapshot
  // order within the separately labelled exploration allocation.
  const exploration = items.filter(w=>w.lane==='EXPLORATION');
  const slots = WALLET_INTAKE_LIMITS.perCycle;
  const hypothetical = [...evidence.slice(0,slots-opts.explorationSlots),...exploration.slice(0,opts.explorationSlots)].map(w=>w.address);
  const currentOrder = items.filter(w=>!w.exclusions.length).map(w=>w.address);
  const available = Math.max(0,WALLET_INTAKE_LIMITS.capacity-input.occupied);
  const fresh = snapshotStatus === 'FRESH';
  const plan = fresh ? hypothetical : [];
  const addressRanks = new Map([...evidence,...exploration].map((w,i)=>[w.address,i+1]));
  return {
    readOnly: true, asOf: input.now.toISOString(), options: opts,
    note: 'Unvalidated transfer-evidence prioritization, not verified swaps, position spend, realised performance, approval or an admission change. Matched-only medians may be biased.',
    snapshot: { status: snapshotStatus, checkedAt: snapshot?.checkedAt??null, total: snapshot?.total??null, displayed: items.length,
      capped: snapshot?.capped??null, scope: 'LATEST_EMERGING_SNAPSHOT_ONLY', ageGateHours: 1, lookbackHours: 48 },
    capacity: { limit: WALLET_INTAKE_LIMITS.capacity, occupied: input.occupied, available, perCycle: slots, overCapacity: input.occupied>WALLET_INTAKE_LIMITS.capacity },
    counts: { evidence: evidence.length, exploration: exploration.length, belowPreview: items.filter(w=>w.lane==='BELOW_PREVIEW').length, excluded: items.filter(w=>w.lane==='EXCLUDED').length },
    proposal: { status: !fresh ? 'NO_FRESH_SNAPSHOT' : !available ? 'CAPACITY_REACHED' : !plan.length ? 'NO_CANDIDATES_IN_ALLOCATED_LANES' : 'PREVIEW_ONLY',
      assumingFreeSlots: plan, withinCurrentCapacity: plan.slice(0,available), unusedAllocatedSlots: fresh ? slots-plan.length : slots,
      ordering: 'MATCHED_COVERAGE_DESC_THEN_MATCHED_TOKENS_DESC_THEN_ADDRESS; EXPLORATION_IN_SNAPSHOT_ORDER',
      allocation: 'EVIDENCE_FIRST; RESERVED_EXPLORATION; UNUSED_LANE_SLOTS_NOT_BORROWED' },
    currentPolicy: { assumingFreeSlots: fresh ? currentOrder.slice(0,slots) : [], withinCurrentCapacity: fresh ? currentOrder.slice(0,Math.min(slots,available)) : [],
      note: 'Existing repeat-participation order after tracked/rejected exclusions; conditional on history collection being enabled. This is a comparison, not execution.' },
    items: items.map(w=>({...w, previewRank: addressRanks.get(w.address)??null})),
  };
}

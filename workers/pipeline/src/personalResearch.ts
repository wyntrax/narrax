import type { Prisma, PrismaClient } from '@narra/database';
import { PersonalBriefSchema, PRO_RESEARCH_LIMITS as L, ResearchEvaluationSchema, ResearchRulesSchema, evaluatePersonalResearch, type PersonalEvidence, type ResearchRules } from '@narra/shared';
import { walletMarketEvidence } from './walletResearchEvidence';
import { walletQualifications } from './walletResearch';

export type PersonalPermissions = { radar: boolean; thesis: boolean; briefing: boolean };
type Db = Prisma.TransactionClient;
export const personalResearchLock = (tx: Db, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`personal-research:${userId}`}))`;
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Current observed net accumulation; a capped/incomplete sample is never counted as a full population. */
async function evidenceFor(tx: Db, mint: string, narrativeSlug: string | null, rules: ResearchRules, now: Date): Promise<PersonalEvidence> {
  const token = await tx.token.findUnique({ where: { mint } });
  const empty: PersonalEvidence = { liquidity: null, buyers: null, narrative: null, risk: null, blocked: !!token?.blacklisted };
  if (!token || token.blacklisted) return empty;
  if (narrativeSlug && !await tx.narrativeTokenRelation.count({ where: { tokenId: token.id, narrative: { slug: narrativeSlug }, confidence: { gte: 0.5 }, relation: { notIn: ['UNRELATED', 'SUSPICIOUS'] } } })) return { ...empty, blocked: true };
  const [market, risk, narrative, trades] = await Promise.all([
    rules.minLiquidityUsd !== null ? walletMarketEvidence(tx, token.id, now) : null,
    rules.maxRiskScore !== null ? tx.tokenRiskMetric.findFirst({ where: { tokenId: token.id, at: { lte: now } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] }) : null,
    rules.minNarrativeVelocity !== null ? tx.narrativeMetric.findFirst({ where: { at: { lte: now, gte: new Date(+now - L.narrativeAgeMs) }, narrative: {
      ...(narrativeSlug ? { slug: narrativeSlug } : {}), tokens: { some: { tokenId: token.id, confidence: { gte: 0.5 }, relation: { notIn: ['UNRELATED', 'SUSPICIOUS'] } } },
    } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] }) : null,
    rules.minIndependentBuyers !== null ? tx.walletTrade.findMany({ where: { tokenId: token.id, wallet: { active: true, researchReview: 'APPROVED' }, at: { lte: now, gte: new Date(+now - rules.windowMinutes * 60_000) } }, include: { wallet: true }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: L.tradesPerToken + 1 }) : [],
  ]);
  let buyers: PersonalEvidence['buyers'] = null;
  if (trades.length && trades.length <= L.tradesPerToken) {
    const wallets = [...new Map(trades.map(t => [t.walletId, t.wallet])).values()];
    const qualified = await walletQualifications(tx, wallets, now);
    const observed = trades.filter(t => qualified.get(t.walletId)?.eligible);
    const entities = new Map<string, number>();
    for (const t of observed) {
      const key = t.wallet.clusterId ? `cluster:${t.wallet.clusterId}` : `wallet:${t.walletId}`;
      entities.set(key, (entities.get(key) ?? 0) + (t.side === 'BUY' ? 1 : -1) * Number(t.amountSol));
    }
    if (observed.length && [...entities.values()].every(Number.isFinite)) buyers = {
      value: [...entities.values()].filter(v => v >= L.minEntityNetSol).length, at: observed[0]!.at.toISOString(), source: 'qualified-wallet-trades', refs: observed.map(t => t.signature),
    };
  }
  return { blocked: false, buyers,
    liquidity: market ? { value: market.liquidityUsd, at: market.at, source: market.source, refs: [market.metricId, market.pairAddress] } : null,
    narrative: narrative ? { value: narrative.velocity, at: narrative.at.toISOString(), source: 'narrative-metric', refs: [narrative.id, narrative.narrativeId] } : null,
    risk: risk ? { value: risk.riskScore, at: risk.at.toISOString(), source: 'recorded-risk-score', refs: [risk.id, ...risk.flags] } : null,
  };
}

/** Evaluates scheduled and manually queued work. The injected entitlement resolver is authoritative. */
export async function evaluatePersonalWorkspace(db: PrismaClient, userId: string, permissions: () => Promise<PersonalPermissions>, clock = () => new Date()) {
  const access = await permissions();
  return db.$transaction(async tx => {
    await personalResearchLock(tx, userId);
    const now = clock(), cutoff = new Date(+now - L.historyDays * 86_400_000);
    const monitors = await tx.researchMonitor.findMany({ where: { userId, active: true }, orderBy: { id: 'asc' } });
    const cache = new Map<string, PersonalEvidence>();
    let evaluated = 0, alerts = 0;
    for (const monitor of monitors) {
      const allowed = monitor.kind === 'RADAR' ? access.radar : access.thesis;
      if (!allowed) { await tx.researchMonitor.update({ where: { id: monitor.id }, data: { lastEvaluatedAt: now } }); continue; }
      if (monitor.lastEvaluatedAt && +now - +monitor.lastEvaluatedAt < L.intervalMs) continue;
      const rules = ResearchRulesSchema.parse(monitor.rules);
      const candidates = monitor.mint ? [{ mint: monitor.mint }] : await tx.token.findMany({
        where: { blacklisted: false, metrics: { some: { at: { gte: new Date(+now - L.marketAgeMs), lte: now } } },
          ...(monitor.narrativeSlug ? { narratives: { some: { narrative: { slug: monitor.narrativeSlug }, confidence: { gte: 0.5 }, relation: { notIn: ['UNRELATED', 'SUSPICIOUS'] } } } } : {}) },
        orderBy: { id: 'asc' }, take: L.tokensPerScan + 1, select: { mint: true },
      });
      const summary = { at: now.toISOString(), considered: Math.min(candidates.length, L.tokensPerScan), matched: 0, unknown: 0, capped: candidates.length > L.tokensPerScan };
      for (const candidate of candidates.slice(0, L.tokensPerScan)) {
        const key = JSON.stringify([candidate.mint, monitor.narrativeSlug, rules]);
        let evidence = cache.get(key);
        if (!evidence) { evidence = await evidenceFor(tx, candidate.mint, monitor.narrativeSlug, rules, now); cache.set(key, evidence); }
        const evaluation = evaluatePersonalResearch(rules, evidence, now);
        if (evaluation.status === 'MATCH') summary.matched++;
        if (evaluation.status === 'UNKNOWN') summary.unknown++;
        if (monitor.kind === 'RADAR' && evaluation.status !== 'MATCH') continue;
        const previous = await tx.researchObservation.findFirst({ where: { monitorId: monitor.id, mint: candidate.mint, revision: monitor.revision, at: { lte: now } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] });
        const parsedPrevious = ResearchEvaluationSchema.safeParse(previous?.evaluation);
        evaluation.previousStatus = parsedPrevious.success ? parsedPrevious.data.status : null;
        const recentAlert = monitor.kind === 'RADAR' ? await tx.researchObservation.findFirst({ where: { monitorId: monitor.id, mint: candidate.mint, revision: monitor.revision, alerted: true, at: { gte: new Date(+now - L.alertCooldownMs), lte: now } } }) : null;
        const shouldAlert = monitor.kind === 'RADAR' ? !recentAlert : !!previous && previous.status !== evaluation.status;
        const created = await tx.researchObservation.createMany({ data: [{ monitorId: monitor.id, mint: candidate.mint, revision: monitor.revision, status: evaluation.status, evaluation: json(evaluation), at: now, bucket: String(Math.floor(+now / L.intervalMs)), alerted: shouldAlert }], skipDuplicates: true });
        if (created.count && shouldAlert) {
          const token = await tx.token.findUnique({ where: { mint: candidate.mint }, select: { id: true } });
          await tx.alert.create({ data: { userId, kind: monitor.kind === 'RADAR' ? 'PERSONAL_RADAR_MATCH' : 'THESIS_CHANGED', priority: 'WATCH',
            title: `${monitor.name}: ${monitor.kind === 'RADAR' ? 'radar match' : evaluation.status === 'MATCH' ? 'conditions supported' : evaluation.status === 'NO_MATCH' ? 'conditions weakened' : 'evidence unknown'}`,
            body: `${candidate.mint}\n${evaluation.checks.map(c => `${c.key}: ${c.status}${c.value === null ? '' : ` (${c.value})`}`).join('; ')}. Observed ${now.toISOString()}. Review your personal workspace for evidence.`,
            refType: token ? 'TOKEN' : null, refId: token?.id ?? null, createdAt: now } });
          alerts++;
        }
      }
      await tx.researchMonitor.update({ where: { id: monitor.id }, data: { lastEvaluatedAt: now, lastRun: summary } });
      evaluated++;
    }
    if (access.briefing) await writePersonalBrief(tx, userId, access, now);
    await tx.researchObservation.deleteMany({ where: { monitor: { userId }, at: { lt: cutoff } } });
    await tx.personalBrief.deleteMany({ where: { userId, generatedAt: { lt: cutoff } } });
    // A slow scan must not publish after a revocation/expiry observed by the shared resolver.
    const current = await permissions();
    if ((access.radar && !current.radar) || (access.thesis && !current.thesis) || (access.briefing && !current.briefing)) throw new Error('PERSONAL_ACCESS_CHANGED');
    return { evaluated, alerts };
  }, { timeout: 120_000, maxWait: 10_000 });
}

async function writePersonalBrief(tx: Db, userId: string, permissions: PersonalPermissions, now: Date) {
  const since = new Date(+now - 86_400_000), day = now.toISOString().slice(0, 10);
  const rows = await tx.researchObservation.findMany({ where: { monitor: { userId, kind: { in: [...(permissions.radar ? ['RADAR'] : []), ...(permissions.thesis ? ['THESIS'] : [])] } }, at: { gte: since, lte: now } },
    orderBy: [{ at: 'desc' }, { id: 'desc' }], take: 501, include: { monitor: true } });
  const valid = rows.slice(0, 500).filter(r => r.revision === r.monitor.revision);
  const unique = new Set<string>();
  const items = valid.flatMap(row => {
    const evaluation = ResearchEvaluationSchema.parse(row.evaluation), key = `${row.monitorId}:${row.mint}`;
    if (unique.has(key)) return [];
    unique.add(key);
    return [{ monitorId: row.monitorId, name: row.monitor.name, kind: row.monitor.kind as 'RADAR' | 'THESIS', mint: row.mint, at: row.at.toISOString(), previousStatus: evaluation.previousStatus ?? null, evaluation }];
  });
  const content = PersonalBriefSchema.parse({ day, generatedAt: now.toISOString(), since: since.toISOString(),
    radarMatches: valid.filter(r => r.monitor.kind === 'RADAR' && r.alerted).length,
    thesisChanges: valid.filter(r => r.monitor.kind === 'THESIS' && r.alerted).length,
    unknown: items.filter(r => r.evaluation.status === 'UNKNOWN').length, capped: rows.length > 500 || items.length > 50, items: items.slice(0, 50) });
  await tx.personalBrief.upsert({ where: { userId_day: { userId, day } }, create: { userId, day, content: json(content), generatedAt: now }, update: { content: json(content), generatedAt: now } });
}

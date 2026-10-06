// Creates one fresh BUY AgentDecision for a token, so the entry fan-out has something to turn into an order for your AUTO user.
// Use it instead of waiting for the live AI pipeline. It writes ONLY rows (Token, TokenMetric, ConsensusSignal, Opportunity, AgentAnalysis, AgentDecision).
// It signs nothing and sends nothing. The decision is synthetic: the executor and Risk Governor treat it like any other BUY.
// Missing consensus gets an explicitly documented test fixture, not a claim about observed wallet activity. Existing consensus is preserved.
//   npx tsx scripts/b5a-seed-decision.ts <TOKEN_MINT> [SYMBOL]
// A decision is only eligible for 10 minutes (MAX_DECISION_AGE_MS), so run the fan-out soon after.
import { createPrisma } from '@narra/database';
import { AgentDecisionSchema } from '@narra/shared';

const [mint, symbol = 'TEST'] = process.argv.slice(2);
if (!mint) { console.error('usage: npx tsx scripts/b5a-seed-decision.ts <TOKEN_MINT> [SYMBOL]'); process.exit(1); }

async function main(mint: string) {
  const database = new URL(process.env.DATABASE_URL ?? '');
  console.log(`DATABASE_URL host=${database.hostname} db=${decodeURIComponent(database.pathname.slice(1))}`);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) throw new Error('This synthetic B5a seed requires a local test database.');
  console.log('Confirmed local test database. Seeding synthetic decision inputs atomically.');
  const payload = AgentDecisionSchema.parse({
    action: 'BUY', confidence: 0.9, reasonCodes: ['B5A_MANUAL_SEED'], positiveSignals: ['manual B5a test decision'], negativeSignals: [],
    risks: ['synthetic decision and market metrics, not from the AI pipeline', 'missing consensus is filled with a synthetic test fixture, not observed wallet activity'],
    suggestedPositionSizePct: 5, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null },
    invalidationConditions: [], summary: 'Manual B5a dry-run test decision with synthetic inputs.',
  });
  const db = createPrisma();
  try {
    const seeded = await db.$transaction(async (tx) => {
      const token = await tx.token.upsert({ where: { mint }, create: { mint, symbol, name: symbol }, update: {} });
      // These are test placeholders, not live market observations.
      const metric = await tx.tokenMetric.create({ data: { tokenId: token.id, priceUsd: 1, marketCapUsd: 10_000_000, liquidityUsd: 1_000_000, volume24hUsd: 1_000_000 } });
      const existingConsensus = await tx.consensusSignal.findFirst({ where: { tokenId: token.id }, orderBy: { at: 'desc' } });
      // Same fixture as b4.integration.test.ts. Never replace an existing consensus or alter a risk threshold.
      const consensus = existingConsensus ?? await tx.consensusSignal.create({ data: { tokenId: token.id, score: 80, walletCount: 5, independentEntities: 4, leaderCount: 2 } });
      const opp = await tx.opportunity.create({ data: { tokenId: token.id, score: 80, narrativeScore: 80, smartMoneyScore: 80, liquidityScore: 80, momentumScore: 80, ogScore: 50, riskScore: 20 } });
      const analysis = await tx.agentAnalysis.create({ data: {
        opportunityId: opp.id, model: 'b5a-manual-seed',
        riskCase: { synthetic: true, metricId: metric.id, consensusId: consensus.id, consensusSource: existingConsensus ? 'existing' : 'synthetic B5a test fixture' },
      } });
      const decision = await tx.agentDecision.create({ data: { analysisId: analysis.id, action: 'BUY', confidence: payload.confidence, payload } });
      return { decisionId: decision.id, tokenId: token.id, metricId: metric.id, consensusId: consensus.id, consensusCreated: !existingConsensus, opportunityId: opp.id, analysisId: analysis.id, mint, synthetic: true, validForMinutes: 10 };
    });
    console.log(JSON.stringify(seeded));
  } finally { await db.$disconnect(); }
}
// An async function because this repo runs .ts files as CommonJS under tsx, which has no top-level await.
main(mint).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

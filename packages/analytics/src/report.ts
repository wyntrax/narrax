import { OUTCOME_CONFIG } from './outcome';
import { DEFAULT_ROUND_TRIP_COST_PCT } from './replay';
import { GATES, type Comparison, type Described } from './stats';
import type { Bucket, StrategyComparison, StrategyResult } from './compare';
import type { SweepResult } from './sweep';

export interface Coverage {
  from: string; to: string; tokens: number; metricPoints: number; firstPointAt: string | null; lastPointAt: string | null;
  medianGapMinutes: number | null; decisions: number; buyDecisions: number;
}

export interface BacktestReport {
  generatedAt: string;
  coverage: Coverage;
  costPct: number;
  strategies: StrategyResult[];
  comparisons: StrategyComparison[];
  aiByConfidence: Bucket[];
  aiBySignal: Bucket[];
  oppByScore: Bucket[];
  sweeps: { exitLevels: SweepResult | null; monitorRules: SweepResult | null };
  /** Plain-English findings. Only evidence that passes the gates is stated as a finding. */
  findings: string[];
  noConclusion: string[];
}

export const NOT_REPLAYABLE = [
  'Narrative stage and score rules (NARRATIVE_DEAD, NARRATIVE_DECAYING, NARRATIVE_SCORE_DROP, NARRATIVE_SLOWING): no point-in-time narrative history is stored.',
  'Smart-money exit rules (SMART_MONEY_EXIT): they need wallet-by-wallet history as it looked then.',
  'Holder concentration (CONCENTRATION_RISE), honeypot flags (HONEYPOT_FLAGGED) and developer activity: not stored as history.',
  'So only the price, liquidity, volume and momentum rules and the stop, target and trailing levels are tested here. The rest stay unvalidated.',
];

export const LIMITATIONS = [
  `Returns are price moves from stored readings, less a flat ${DEFAULT_ROUND_TRIP_COST_PCT}% round-trip cost. That cost is a guess, and real fills can be much worse for thin tokens.`,
  'Only tokens the system tracked are in the data. Tokens that rugged often stop being tracked, so missing 24h prices are not random. The unknown rate is shown, and so is the mean if every unknown were a total loss.',
  'Events are treated as independent after dropping same-token overlaps within 24h. They are not: tokens move together with the market, so real uncertainty is wider than the intervals shown.',
  'Everything here is in-sample history, usually from one market regime. A result is a reason to keep watching, not a reason to raise limits.',
  'Gaps between stored readings limit the rules: a one-hour momentum check needs a reading from about an hour earlier, and a collapse between readings is seen late.',
];

const f = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d));
const ci = (c: [number, number] | null) => (c ? `[${f(c[0])}, ${f(c[1])}]` : 'n/a');
const row = (label: string, d: Described) => `| ${label} | ${d.n} | ${d.distinctTokens} | ${f(d.mean)} | ${ci(d.meanCi)} | ${d.winRate == null ? 'n/a' : f(d.winRate * 100, 0) + '%'} | ${d.sufficient ? 'ok' : 'INSUFFICIENT'} |`;
const HEAD = '| Group | Events | Tokens | Mean net % | 95% interval | Win rate | Evidence |\n|---|---|---|---|---|---|---|';
const verdictLine = (name: string, what: string, c: Comparison) =>
  c.verdict === 'INSUFFICIENT_DATA' ? `${name} ${what}: no verdict. ${c.note ?? ''}`.trim()
  : c.verdict === 'NO_CLEAR_DIFFERENCE' ? `${name} ${what}: no clear difference from the baseline (difference ${f(c.diff)} points, interval ${ci(c.ci)}).`
  : `${name} ${what}: ${c.verdict === 'BETTER' ? 'better' : 'worse'} than the baseline by ${f(c.diff)} points (interval ${ci(c.ci)}). Past the gates, but see the limitations.`;

/** Findings are generated from the comparisons, and nothing is stated unless the evidence passed the gates. */
export function summarizeFindings(strategies: StrategyResult[], comparisons: StrategyComparison[], sweeps: BacktestReport['sweeps']) {
  const findings: string[] = [], noConclusion: string[] = [];
  for (const c of comparisons) {
    for (const [what, v] of [['holding 24h', c.vsBaselineHold], ['with the exit rules', c.vsBaselineRules]] as const) {
      (v.verdict === 'INSUFFICIENT_DATA' ? noConclusion : findings).push(verdictLine(c.name, what, v));
    }
  }
  for (const [name, s] of [['Exit levels', sweeps.exitLevels], ['Monitor thresholds', sweeps.monitorRules]] as const) {
    if (!s) continue;
    if (s.verdict === 'INSUFFICIENT_DATA') noConclusion.push(`${name}: no verdict. ${s.note}`);
    else findings.push(`${name}: the best combination in training ${s.verdict === 'BETTER' ? 'also beat' : s.verdict === 'WORSE' ? 'did worse than' : 'was not clearly different from'} the current setting on held-out events (gain ${f(s.testGain?.mean)} points, interval ${ci(s.testGain?.ci ?? null)}). ${s.note}`);
  }
  const base = strategies.find((s) => s.name === 'BASELINE');
  if (!base || !base.hold.sufficient) noConclusion.unshift('The baseline itself has too little data, so no strategy can be compared to it yet.');
  return { findings, noConclusion };
}

export function renderMarkdown(r: BacktestReport): string {
  const L: string[] = [];
  const cov = r.coverage;
  L.push('# NARRA backtest report', '', `Generated ${r.generatedAt}. History from ${cov.from} to ${cov.to}.`, '');
  L.push('## Read this first', '', `A verdict needs at least ${GATES.minSample} independent events across ${GATES.minDistinctTokens} tokens in each group. Below that the numbers are printed but marked INSUFFICIENT and nothing is concluded from them.`, '');
  L.push(...LIMITATIONS.map((x) => `- ${x}`), '');
  L.push('## Data coverage', '', `- Tokens with price history: ${cov.tokens}`, `- Stored readings: ${cov.metricPoints}${cov.firstPointAt ? ` (${cov.firstPointAt} to ${cov.lastPointAt})` : ''}`,
    `- Median gap between readings: ${f(cov.medianGapMinutes)} minutes`, `- Decisions in range: ${cov.decisions}, of which BUY: ${cov.buyDecisions}`, '');
  L.push('## Findings', '', ...(r.findings.length ? r.findings.map((x) => `- ${x}`) : ['- None. No comparison has enough data yet.']), '');
  L.push('## No conclusion possible', '', ...(r.noConclusion.length ? r.noConclusion.map((x) => `- ${x}`) : ['- Nothing is blocked on data.']), '');
  L.push('## Strategies, 24 hours after the signal', '', `Net of a ${r.costPct}% round-trip cost. "With rules" runs the live exit rules at fixed reference exit levels.`, '');
  L.push('| Strategy | Events | Pending | Unknown | Unknown rate | Mean if unknowns were total losses | Median lead time |', '|---|---|---|---|---|---|---|');
  for (const s of r.strategies) L.push(`| ${s.name} | ${s.events} | ${s.pending} | ${s.unknown} | ${s.unknownRate == null ? 'n/a' : f(s.unknownRate * 100, 0) + '%'} | ${f(s.holdMeanIfUnknownTotalLoss)} | ${s.medianLeadTimeSeconds == null ? 'n/a' : Math.round(s.medianLeadTimeSeconds / 60) + ' min'} |`);
  L.push('', '### Hold 24h', '', HEAD, ...r.strategies.map((s) => row(s.name, s.hold)), '', '### With the exit rules', '', HEAD, ...r.strategies.map((s) => row(s.name, s.withRules)));
  const own = r.strategies.filter((s) => s.withOwnExit);
  if (own.length) L.push('', '### With the decisions\' own exit levels', '', HEAD, ...own.map((s) => row(s.name, s.withOwnExit!)));
  L.push('', '## AI BUY decisions by confidence', '', HEAD, ...r.aiByConfidence.map((b) => row(b.label, b.described)));
  L.push('', '## AI BUY decisions by reason code', '', HEAD, ...(r.aiBySignal.length ? r.aiBySignal.map((b) => row(b.label, b.described)) : ['| none | 0 | 0 | n/a | n/a | n/a | INSUFFICIENT |']));
  L.push('', '## Opportunity score', '', HEAD, ...r.oppByScore.map((b) => row(b.label, b.described)));
  for (const [title, s] of [['Exit levels', r.sweeps.exitLevels], ['Monitor thresholds', r.sweeps.monitorRules]] as const) {
    L.push('', `## Sweep: ${title}`, '');
    if (!s) { L.push('Not run: too few replayable events.'); continue; }
    L.push(`${s.combinations} combinations; ${s.trainEvents} training events, ${s.testEvents} held-out test events. Verdict: ${s.verdict}. ${s.note}`, '', '| Setting | Train mean % | Test mean % |', '|---|---|---|', ...s.top.map((t) => `| ${t.label} | ${f(t.trainMean)} | ${f(t.testMean)} |`));
    if (s.reference) L.push(`| ${s.reference.label} (current) | ${f(s.reference.trainMean)} | ${f(s.reference.testMean)} |`);
  }
  L.push('', '## Not replayable', '', ...NOT_REPLAYABLE.map((x) => `- ${x}`), '', '## Labels', '', `Decision outcomes are labelled on the 24h price return: WIN at ${OUTCOME_CONFIG.winReturnPct}% or more, LOSS at ${OUTCOME_CONFIG.lossReturnPct}% or less, FLAT between, UNKNOWN when no price exists near the 24h mark. These cut-offs are unvalidated.`, '');
  return L.join('\n');
}

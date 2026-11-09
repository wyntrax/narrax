import type { Prisma } from '@narra/database';
import { INVESTIGATION_STRATEGY_RULES as R, type InvestigationStrategyAnalysis, type SmartMoneyInvestigation } from '@narra/shared';
import { decimalAmount } from './smartMoneyInvestigationSummary';

type Trade = { id: string; walletId: string; signature: string; side: 'BUY' | 'SELL'; at: Date; amountSol: Prisma.Decimal; tokenAmount: Prisma.Decimal | null };
/** Analyze individual wallets, never pool related wallets into a fictitious trader. */
export function investigationStrategies(rows: readonly Trade[], participants: SmartMoneyInvestigation['participants'], capped: boolean): InvestigationStrategyAnalysis {
  const signatures = new Set<string>();
  const valid = [...rows].sort((a, b) => +a.at - +b.at || a.id.localeCompare(b.id)).filter(t => {
    if (!Number.isFinite(+t.at) || !t.amountSol.isFinite() || !t.amountSol.isPositive() || t.amountSol.isZero() || signatures.has(t.signature)) return false;
    signatures.add(t.signature); return true;
  });
  const examples = (trades: Trade[]) => {
    // Spread the preview across the sequence, retaining its first and last event.
    const selected = trades.length <= R.maxExamples ? trades : Array.from({ length: R.maxExamples }, (_, i) => trades[Math.round(i * (trades.length - 1) / (R.maxExamples - 1))]!);
    return selected.map(t => ({ id: t.id, walletId: t.walletId, signature: t.signature, side: t.side, at: t.at.toISOString(), amountSol: decimalAmount(t.amountSol), tokenAmount: t.tokenAmount?.isZero() ? null : decimalAmount(t.tokenAmount) }));
  };
  const items: InvestigationStrategyAnalysis['items'] = [];
  for (const p of participants) {
    const walletTrades = valid.filter(t => t.walletId === p.id);
    for (const side of ['BUY', 'SELL'] as const) {
      const supporting = walletTrades.filter(t => t.side === side), opposing = walletTrades.filter(t => t.side !== side);
      const distinctTimes = new Set(supporting.map(t => +t.at)).size;
      if (supporting.length < R.minTrades || distinctTimes < R.minDistinctTimes) continue;
      const first = supporting[0]!, last = supporting.at(-1)!, spanMs = +last.at - +first.at;
      if (spanMs < R.minSpanMs) continue;
      items.push({ walletId: p.id, kind: side === 'BUY' ? 'REPEATED_BUYING' : 'STAGGERED_SELLING', supportingCount: supporting.length, opposingCount: opposing.length,
        walletTradeCount: walletTrades.length, distinctTimes, firstAt: first.at.toISOString(), lastAt: last.at.toISOString(), spanMs,
        examples: examples(supporting), opposingExamples: examples(opposing), historyStatus: p.history.status });
    }
  }
  items.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.walletId.localeCompare(b.walletId) || a.kind.localeCompare(b.kind));
  return { rules: { version: 1, minTrades: R.minTrades, minDistinctTimes: R.minDistinctTimes, minSpanMs: R.minSpanMs, maxPatterns: R.maxPatterns, maxExamples: R.maxExamples },
    scope: capped ? 'LATEST_CAPPED_SAMPLE' : 'RECORDED_WINDOW', evaluatedWallets: participants.length, observedTrades: rows.length, excludedTrades: rows.length - valid.length,
    candidateCount: items.length, truncated: items.length > R.maxPatterns, items: items.slice(0, R.maxPatterns) };
}

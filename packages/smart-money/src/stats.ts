export interface TradeRow {
  wallet: string;
  token: string;
  side: 'BUY' | 'SELL';
  sol: number;
  /** Token units. Both legs of a swap use the same unit scale for a given token. */
  qty: number;
  at: Date;
}

export interface ClosedLeg {
  token: string;
  pnlSol: number;
  costSol: number;
  roi: number;
  holdSeconds: number;
  closedAt: Date;
}

export interface WalletStats {
  legs: ClosedLeg[];
  /** Sells with no earlier buy in the data. They cannot be priced, so they are left out. */
  unmatchedSells: number;
  totalBoughtSol: number;
  pnlSol: number;
  winRate: number | null;
  avgRoi: number | null;
  medianRoi: number | null;
  medianHoldSeconds: number | null;
  /** Largest peak-to-trough fall in cumulative realized PnL, as a share of all SOL bought. */
  maxDrawdown: number;
  grossWinSol: number;
  grossLossSol: number;
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Average-cost accounting per token for ONE wallet. Every sell realizes a leg:
 * proceeds minus the average cost of the units sold. Sells of units we never saw bought are skipped.
 */
export function computeWalletStats(trades: TradeRow[]): WalletStats {
  const sorted = trades.map((t, i) => ({ t, i })).sort((a, b) => a.t.at.getTime() - b.t.at.getTime() || a.i - b.i).map((x) => x.t);
  const book = new Map<string, { qty: number; cost: number; openedAt: Date }>();
  const legs: ClosedLeg[] = [];
  let unmatchedSells = 0;
  let totalBoughtSol = 0;

  for (const t of sorted) {
    if (!(t.qty > 0) || !(t.sol >= 0)) continue;
    if (t.side === 'BUY') {
      const h = book.get(t.token) ?? { qty: 0, cost: 0, openedAt: t.at };
      if (h.qty <= 0) h.openedAt = t.at;
      h.qty += t.qty; h.cost += t.sol; totalBoughtSol += t.sol;
      book.set(t.token, h);
      continue;
    }
    const h = book.get(t.token);
    if (!h || h.qty <= 0) { unmatchedSells++; continue; }
    const soldQty = Math.min(t.qty, h.qty);
    const frac = soldQty / h.qty;
    const cost = h.cost * frac;
    const proceeds = t.sol * (soldQty / t.qty);
    const pnl = proceeds - cost;
    legs.push({ token: t.token, pnlSol: pnl, costSol: cost, roi: cost > 0 ? pnl / cost : 0, holdSeconds: (t.at.getTime() - h.openedAt.getTime()) / 1000, closedAt: t.at });
    h.qty -= soldQty; h.cost -= cost;
    if (h.qty <= 1e-9) { h.qty = 0; h.cost = 0; }
  }

  const wins = legs.filter((l) => l.pnlSol > 0);
  const grossWinSol = wins.reduce((s, l) => s + l.pnlSol, 0);
  const grossLossSol = legs.filter((l) => l.pnlSol < 0).reduce((s, l) => s - l.pnlSol, 0);
  let cum = 0, peak = 0, maxDd = 0;
  for (const l of legs) { cum += l.pnlSol; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum); }

  return {
    legs, unmatchedSells, totalBoughtSol,
    pnlSol: grossWinSol - grossLossSol,
    winRate: legs.length ? wins.length / legs.length : null,
    avgRoi: legs.length ? legs.reduce((s, l) => s + l.roi, 0) / legs.length : null,
    medianRoi: median(legs.map((l) => l.roi)),
    medianHoldSeconds: median(legs.map((l) => l.holdSeconds)),
    maxDrawdown: totalBoughtSol > 0 ? Math.min(1, maxDd / totalBoughtSol) : 0,
    grossWinSol, grossLossSol,
  };
}

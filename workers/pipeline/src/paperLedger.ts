import type { PrismaClient } from '@narra/database';
import { MONITOR_RULES } from '@narra/positions';
import { PAPER_START_BALANCE_SOL, paperBalance, paperPortfolioValue } from '@narra/trading';

const num = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d.toString()));

/** The balance and portfolio value of a paper account. There is no wallet behind these numbers. */
export interface PaperPorts {
  balanceSol(userId: string): Promise<number>;
  /** Cash plus open paper positions at current prices. Throws when a held token has no fresh price (fail closed). */
  portfolioValueSol(userId: string, at: Date): Promise<number>;
}

/**
 * The paper ledger is derived from paper Trade rows: PAPER_START_BALANCE_SOL, less buys and fees, plus sells less fees.
 * Nothing is stored as a balance, so it cannot drift from the trades.
 */
export function makePaperPorts(db: PrismaClient): PaperPorts {
  const balanceSol = async (userId: string) => {
    const rows = await db.trade.groupBy({ by: ['side'], where: { userId, simulated: true }, _sum: { amountSol: true, feeSol: true } });
    const side = (s: 'BUY' | 'SELL') => {
      const r = rows.find((x) => x.side === s);
      // No trades on a side is a real zero, not a missing input.
      return { amountSol: num(r?._sum.amountSol), feeSol: num(r?._sum.feeSol) };
    };
    return paperBalance({ startSol: PAPER_START_BALANCE_SOL, buys: side('BUY'), sells: side('SELL') });
  };

  return {
    balanceSol,
    async portfolioValueSol(userId, at) {
      const [cash, positions] = await Promise.all([
        balanceSol(userId),
        db.position.findMany({ where: { userId, status: 'OPEN', simulated: true }, select: { tokenId: true, sizeSol: true, entryPriceUsd: true } }),
      ]);
      const priced = await Promise.all(positions.map(async (p) => {
        const m = await db.tokenMetric.findFirst({ where: { tokenId: p.tokenId }, orderBy: { at: 'desc' }, select: { priceUsd: true, at: true } });
        const fresh = m && at.getTime() - m.at.getTime() <= MONITOR_RULES.maxDataAgeMs;
        return { costSol: num(p.sizeSol), entryPriceUsd: num(p.entryPriceUsd), priceUsd: fresh ? num(m.priceUsd) : null };
      }));
      return paperPortfolioValue(cash, priced);
    },
  };
}

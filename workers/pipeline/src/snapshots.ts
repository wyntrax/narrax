import type { PrismaClient } from '@narra/database';
import type { ChainPorts } from './prismaStores';
import { makePaperPorts, type PaperPorts } from './paperLedger';

export interface SnapshotDeps {
  paper?: PaperPorts;
  /** Null when no RPC is configured: real wallets are then not snapshotted, and their drawdown check has no history. */
  chain: ChainPorts | null;
  now?: () => Date;
}

export interface SnapshotSummary { paper: number; real: number; skipped: number }

/**
 * Writes one PortfolioSnapshot per user, so the Governor's drawdown check has a peak to measure from.
 * Paper accounts are valued from the paper ledger, real accounts from the chain. A user whose value cannot be
 * computed (a held token has no fresh price, the RPC is down) is skipped for this run. Nothing is ever valued at zero or at cost.
 * SHADOW users with no positions have no portfolio and get no snapshot.
 */
export async function writePortfolioSnapshots(db: PrismaClient, deps: SnapshotDeps): Promise<SnapshotSummary> {
  const at = (deps.now ?? (() => new Date()))();
  const paper = deps.paper ?? makePaperPorts(db);
  const out: SnapshotSummary = { paper: 0, real: 0, skipped: 0 };

  const paperUsers = await db.user.findMany({ where: { OR: [{ mode: 'PAPER' }, { positions: { some: { status: 'OPEN', simulated: true } } }] }, select: { id: true } });
  for (const u of paperUsers) {
    try {
      const totalValueSol = await paper.portfolioValueSol(u.id, at);
      await db.portfolioSnapshot.create({ data: { userId: u.id, totalValueSol, simulated: true, at } });
      out.paper++;
    } catch { out.skipped++; }
  }

  if (deps.chain) {
    const realUsers = await db.user.findMany({ where: { mode: { in: ['SEMI_AUTO', 'AUTO'] }, wallets: { some: { kind: 'TRADING' } } }, select: { id: true } });
    for (const u of realUsers) {
      try {
        const totalValueSol = await deps.chain.getPortfolioValueSol(u.id);
        await db.portfolioSnapshot.create({ data: { userId: u.id, totalValueSol, simulated: false, at } });
        out.real++;
      } catch { out.skipped++; }
    }
  }
  return out;
}

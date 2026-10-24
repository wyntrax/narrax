import { isSolanaAddress } from '@narra/shared';

/**
 * Why a tracked wallet might not belong in the Smart Money list. A format check cannot prove a wallet is real or
 * useful. It can only prove some are not: a string that does not decode to a 32-byte key can never exist on chain.
 */
export type WalletClass = 'NOT_A_SOLANA_ADDRESS' | 'LOOKS_LIKE_TEST_DATA' | 'NO_TRADES_RECORDED' | 'ACTIVE_TRADES';

export interface WalletFacts { address: string; label: string | null; source: string; createdAt: Date; trades: number }

const TEST_LABEL = /test|fixture|dummy|fake|sample/i;
/** Tests pad made-up addresses with a repeated character, which real keys essentially never end with. */
const REPEATED_TAIL = /(.)\1{5,}$/;

export function classifyWallet(w: WalletFacts): { class: WalletClass; reasons: string[] } {
  const reasons: string[] = [];
  if (!isSolanaAddress(w.address)) reasons.push('does not decode to a 32-byte key');
  if (REPEATED_TAIL.test(w.address)) reasons.push('ends with a long run of one character');
  if (w.label && TEST_LABEL.test(w.label)) reasons.push('label mentions test/fixture/dummy/fake/sample');
  if (!isSolanaAddress(w.address)) return { class: 'NOT_A_SOLANA_ADDRESS', reasons };
  if (reasons.length) return { class: 'LOOKS_LIKE_TEST_DATA', reasons };
  if (w.trades === 0) return { class: 'NO_TRADES_RECORDED', reasons: ['valid address, but the system has recorded no trades for it'] };
  return { class: 'ACTIVE_TRADES', reasons: [] };
}

export function summarizeWallets(rows: (WalletFacts & { class: WalletClass })[]) {
  const bySource: Record<string, Record<string, number>> = {};
  const byClass: Record<string, { count: number; firstCreatedAt: string; lastCreatedAt: string }> = {};
  for (const r of rows) {
    (bySource[r.source] ??= {})[r.class] = ((bySource[r.source] ??= {})[r.class] ?? 0) + 1;
    const c = byClass[r.class];
    const at = r.createdAt.toISOString();
    byClass[r.class] = c ? { count: c.count + 1, firstCreatedAt: at < c.firstCreatedAt ? at : c.firstCreatedAt, lastCreatedAt: at > c.lastCreatedAt ? at : c.lastCreatedAt } : { count: 1, firstCreatedAt: at, lastCreatedAt: at };
  }
  return { total: rows.length, byClass, bySource };
}

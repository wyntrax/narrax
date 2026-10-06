import type { AiScreeningJob, SwapEvent } from '@narra/queue';

export interface WalletEventDeps {
  /** Returns 'duplicate' if the signature was already stored. Must be safe to call twice. */
  saveWalletTrade(event: SwapEvent): Promise<'created' | 'duplicate' | 'untracked'>;
  getWalletScore(wallet: string): Promise<number | null>;
  enqueueAiScreening(job: AiScreeningJob): Promise<unknown>;
}

export interface FilterConfig {
  minWalletScore: number;
  minBuySol: number;
}
export const DEFAULT_FILTER: FilterConfig = { minWalletScore: 70, minBuySol: 0.5 };

/**
 * Deterministic filter that decides whether an event is worth a fast-model call.
 * The AI is not called on every event. Only BUYs by scored wallets above a size floor pass.
 */
export function passesFilter(event: SwapEvent, walletScore: number | null, cfg: FilterConfig = DEFAULT_FILTER): string | null {
  if (event.side !== 'BUY') return null;
  if (walletScore === null || walletScore < cfg.minWalletScore) return null;
  if (event.amountSol < cfg.minBuySol) return null;
  return 'HIGH_SCORE_WALLET_BUY';
}

export type WalletEventOutcome = 'duplicate' | 'ignored' | 'stored' | 'queued_for_screening';

export async function processWalletEvent(event: SwapEvent, deps: WalletEventDeps, cfg?: FilterConfig): Promise<WalletEventOutcome> {
  const saved = await deps.saveWalletTrade(event);
  if (saved === 'duplicate') return 'duplicate';
  if (saved === 'untracked') return 'ignored';
  const reason = passesFilter(event, await deps.getWalletScore(event.wallet), cfg);
  if (!reason) return 'stored';
  await deps.enqueueAiScreening({ mint: event.mint, sourceSignature: event.signature, wallet: event.wallet, reason });
  return 'queued_for_screening';
}

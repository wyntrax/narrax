import type { ParsedTx } from './rpc';

/**
 * Transfers below this size never count as funding. Address-poisoning attacks send dust to many wallets, and
 * a "first funder" that sent dust says nothing about who set the wallet up. Starting value: 0.05 SOL.
 */
export const FUNDING_MIN_LAMPORTS = 50_000_000n;

export interface InboundTransfer { from: string; lamports: bigint }
export interface Funding { funder: string; lamports: bigint; signature: string; at: Date | null }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const keyOf = (k: string | { pubkey: string }) => (typeof k === 'string' ? k : k.pubkey);

/** Plain SOL transfers into `wallet`, from top-level and inner instructions. Anything not shaped like a system transfer is ignored. */
export function inboundSolTransfers(tx: ParsedTx, wallet: string): InboundTransfer[] {
  if (tx.meta?.err != null) return [];
  const all: unknown[] = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)];
  const out: InboundTransfer[] = [];
  for (const ix of all) {
    if (!isRec(ix) || ix.program !== 'system' || !isRec(ix.parsed)) continue;
    const { type, info } = ix.parsed;
    if ((type !== 'transfer' && type !== 'transferWithSeed') || !isRec(info)) continue;
    const { source, destination, lamports } = info;
    if (typeof source !== 'string' || typeof destination !== 'string' || destination !== wallet || source === wallet) continue;
    const n = typeof lamports === 'number' && Number.isSafeInteger(lamports) && lamports > 0 ? BigInt(lamports) : typeof lamports === 'string' && /^\d+$/.test(lamports) ? BigInt(lamports) : null;
    if (n != null) out.push({ from: source, lamports: n });
  }
  return out;
}

/** The first transfer of at least `minLamports` into the wallet, scanning transactions from oldest to newest. null if none qualifies. */
export function firstFunding(oldestFirst: { signature: string; tx: ParsedTx | null }[], wallet: string, minLamports: bigint = FUNDING_MIN_LAMPORTS): Funding | null {
  for (const { signature, tx } of oldestFirst) {
    if (!tx) continue;
    const hit = inboundSolTransfers(tx, wallet).find((t) => t.lamports >= minLamports);
    if (hit) return { funder: hit.from, lamports: hit.lamports, signature, at: tx.blockTime != null ? new Date(tx.blockTime * 1000) : null };
  }
  return null;
}

/**
 * The buyer in a transaction, or null. Same assumption as the webhook parser: the fee payer is the trading wallet.
 * It counts as a buyer only when its own balance of `mint` went up in a successful transaction.
 */
export function earlyBuyer(tx: ParsedTx, mint: string): string | null {
  if (tx.meta?.err != null || !tx.meta) return null;
  const first = tx.transaction.message.accountKeys[0];
  if (first == null) return null;
  const payer = keyOf(first);
  const sum = (list: NonNullable<typeof tx.meta.preTokenBalances>) => list.filter((b) => b.mint === mint && b.owner === payer).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const pre = sum(tx.meta.preTokenBalances ?? []);
  const post = sum(tx.meta.postTokenBalances ?? []);
  return post > pre ? payer : null;
}

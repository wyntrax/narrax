import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SwapEvent } from '@narra/queue';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

const Amount = z.union([z.string(), z.number()]);
const NativeLeg = z.object({ account: z.string().optional(), amount: Amount }).nullish();
const TokenLeg = z.object({
  mint: z.string(),
  rawTokenAmount: z.object({ tokenAmount: z.string(), decimals: z.number() }),
});
const HeliusTx = z.object({
  signature: z.string(),
  timestamp: z.number(),
  slot: z.number().optional(),
  feePayer: z.string(),
  events: z.object({
    swap: z.object({
      nativeInput: NativeLeg,
      nativeOutput: NativeLeg,
      tokenInputs: z.array(TokenLeg).optional(),
      tokenOutputs: z.array(TokenLeg).optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const lamportsToSol = (v: string | number) => Number(v) / LAMPORTS_PER_SOL;
const tokenToUnits = (t: z.infer<typeof TokenLeg>) => Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals;

export interface ParseResult {
  events: SwapEvent[];
  skipped: number;
}

/**
 * Turns a Helius enhanced-transaction webhook payload into normalized swap events.
 * Assumes the fee payer is the trading wallet and that one leg of the swap is SOL or wrapped SOL.
 * Anything else (token-to-token swaps, transfers, malformed items) is skipped, never guessed.
 * Verify these assumptions against real payloads from your Helius plan before relying on them.
 */
export function parseHeliusSwaps(payload: unknown): ParseResult {
  const items = Array.isArray(payload) ? payload : [];
  const events: SwapEvent[] = [];
  let skipped = 0;

  for (const item of items) {
    const parsed = HeliusTx.safeParse(item);
    const swap = parsed.success ? parsed.data.events?.swap : undefined;
    if (!parsed.success || !swap) { skipped++; continue; }
    const tx = parsed.data;

    const wsolIn = swap.tokenInputs?.find((t) => t.mint === WSOL_MINT);
    const wsolOut = swap.tokenOutputs?.find((t) => t.mint === WSOL_MINT);
    const otherOut = swap.tokenOutputs?.find((t) => t.mint !== WSOL_MINT);
    const otherIn = swap.tokenInputs?.find((t) => t.mint !== WSOL_MINT);

    let side: 'BUY' | 'SELL' | null = null;
    let mint = '';
    let amountSol = 0;
    let tokenAmount = 0;
    if ((swap.nativeInput || wsolIn) && otherOut) {
      side = 'BUY'; mint = otherOut.mint;
      amountSol = swap.nativeInput ? lamportsToSol(swap.nativeInput.amount) : tokenToUnits(wsolIn!);
      tokenAmount = tokenToUnits(otherOut);
    } else if ((swap.nativeOutput || wsolOut) && otherIn) {
      side = 'SELL'; mint = otherIn.mint;
      amountSol = swap.nativeOutput ? lamportsToSol(swap.nativeOutput.amount) : tokenToUnits(wsolOut!);
      tokenAmount = tokenToUnits(otherIn);
    }
    if (!side || !Number.isFinite(amountSol) || amountSol < 0 || !Number.isFinite(tokenAmount) || tokenAmount <= 0) { skipped++; continue; }

    events.push({
      signature: tx.signature, wallet: tx.feePayer, mint, side, amountSol, tokenAmount,
      slot: tx.slot, at: new Date(tx.timestamp * 1000).toISOString(),
    });
  }
  return { events, skipped };
}

/** Constant-time check of the Authorization header Helius sends with each webhook. */
export function verifyWebhookAuth(header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

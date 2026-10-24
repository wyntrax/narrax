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

const TransferSwap = z.object({
  type: z.literal('SWAP'), transactionError: z.null().optional(),
  signature: z.string(), timestamp: z.number(), slot: z.number().optional(), feePayer: z.string(),
  tokenTransfers: z.array(z.object({mint:z.string(),tokenAmount:z.number().positive().finite(),fromUserAccount:z.string(),toUserAccount:z.string()})),
});
/** Some enhanced AMM swaps omit events.swap. Require two explicit, opposite token flows
 * belonging to the fee payer and a shared counterparty. Native balance changes can include
 * rent/fees, so only explicit wrapped-SOL transfers are accepted by this fallback. */
function transferSwap(item: unknown): SwapEvent | null {
  const parsed=TransferSwap.safeParse(item);if(!parsed.success)return null;
  const tx=parsed.data,flows=new Map<string,{amount:number;peers:Set<string>}>();
  for(const t of tx.tokenTransfers){
    const incoming=t.toUserAccount===tx.feePayer,outgoing=t.fromUserAccount===tx.feePayer;
    if(incoming===outgoing)continue;
    const flow=flows.get(t.mint)??{amount:0,peers:new Set<string>()};
    flow.amount+=(incoming?1:-1)*t.tokenAmount;flow.peers.add(incoming?t.fromUserAccount:t.toUserAccount);flows.set(t.mint,flow);
  }
  if(flows.size!==2)return null;
  const sol=flows.get(WSOL_MINT),other=[...flows].find(([mint])=>mint!==WSOL_MINT);
  if(!sol||!other||!Number.isFinite(sol.amount)||!Number.isFinite(other[1].amount)||sol.amount===0||other[1].amount===0||Math.sign(sol.amount)===Math.sign(other[1].amount)||![...sol.peers].some(peer=>other[1].peers.has(peer)))return null;
  return {signature:tx.signature,wallet:tx.feePayer,mint:other[0],side:sol.amount<0?'BUY':'SELL',amountSol:Math.abs(sol.amount),tokenAmount:Math.abs(other[1].amount),slot:tx.slot,at:new Date(tx.timestamp*1000).toISOString()};
}

const lamportsToSol = (v: string | number) => Number(v) / LAMPORTS_PER_SOL;
const tokenToUnits = (t: z.infer<typeof TokenLeg>) => Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals;

export interface ParseResult {
  events: SwapEvent[];
  skipped: number;
}

/**
 * Turns a Helius enhanced-transaction webhook payload into normalized swap events.
 * Assumes the fee payer is the trading wallet and that one leg of the swap is SOL or wrapped SOL.
 * Without events.swap, explicit wallet-owned wrapped-SOL/token transfers with a shared counterparty
 * are supported. Anything else (token-to-token swaps, transfers, malformed items) is skipped, never guessed.
 * Verify these assumptions against real payloads from your Helius plan before relying on them.
 */
export function parseHeliusSwaps(payload: unknown): ParseResult {
  const items = Array.isArray(payload) ? payload : [];
  const events: SwapEvent[] = [];
  let skipped = 0;

  for (const item of items) {
    const parsed = HeliusTx.safeParse(item);
    if(parsed.success&&parsed.data.transactionError!=null){skipped++;continue;}
    const swap = parsed.success ? parsed.data.events?.swap : undefined;
    if (!parsed.success || !swap) { const fallback=transferSwap(item);if(fallback)events.push(fallback);else skipped++;continue; }
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

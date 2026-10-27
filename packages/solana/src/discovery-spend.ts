import { z } from 'zod';
import type { ParsedTx } from './rpc';
import { earlyBuyer } from './funding';
import { WSOL_MINT } from './helius';
import { temporaryWsolOwnership, WsolOwnershipEvidence } from './wsol-ownership';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM = '11111111111111111111111111111111';
const raw = z.string().regex(/^[1-9]\d*$/).refine(v => v.length <= 20 && /^[1-9]\d*$/.test(v) && BigInt(v) <= 18_446_744_073_709_551_615n);
export const DiscoverySpendEvidence = z.discriminatedUnion('status', [
  z.object({ version: z.literal(1), status: z.literal('MATCHED_TRANSFERS'), source: z.literal('RPC_PARSED_INNER_TRANSFERS'),
    quoteAsset: z.enum(['SOL', 'WSOL']), quoteLamports: raw, tokenAmountRaw: raw,
    outerInstructionIndex: z.number().int().nonnegative(), counterparty: z.string().min(1), programId: z.string().min(1),
    recoveredWsolAccounts: z.array(WsolOwnershipEvidence).optional() }),
  z.object({ version: z.literal(1), status: z.literal('UNKNOWN'), reason: z.enum([
    'NO_TOKEN_INCREASE', 'MISSING_ACCOUNT_MAPPING', 'AMBIGUOUS_TRANSFERS', 'NO_MATCHED_QUOTE_TRANSFER', 'UNSUPPORTED_TOKEN_PROGRAM',
  ]), recoveredWsolAccounts: z.array(WsolOwnershipEvidence).optional() }),
]);
export type DiscoverySpendEvidence = z.infer<typeof DiscoverySpendEvidence>;
type UnknownReason = Extract<DiscoverySpendEvidence, { status: 'UNKNOWN' }>['reason'];
type Account = { owner: string; mint: string };
type Transfer = { from: string; to: string; mint: string; amount: string };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const key = (k: ParsedTx['transaction']['message']['accountKeys'][number]) => typeof k === 'string' ? k : k.pubkey;
const unknown = (reason: UnknownReason): DiscoverySpendEvidence => ({ version: 1, status: 'UNKNOWN', reason });

/** Narrow evidence of reciprocal quote/token transfers in ONE inner-instruction group.
 * Not a decoded DEX instruction or proof of a swap, total position cost, fees, or profit.
 * No native-balance subtraction: network fees, rent and top-level tips are not quote legs.
 * Complex routes, missing ownership, Token-2022 and multiple legs stay unknown.
 */
export function discoverySpendEvidence(tx: ParsedTx, mint: string): DiscoverySpendEvidence {
  const wallet = earlyBuyer(tx, mint);
  if (!wallet || !tx.meta || mint === WSOL_MINT) return unknown('NO_TOKEN_INCREASE');
  const pre = tx.meta.preTokenBalances ?? [], post = tx.meta.postTokenBalances ?? [];
  const delta = (m: string) => post.filter(b => b.owner === wallet && b.mint === m).reduce((s,b) => s + BigInt(b.uiTokenAmount.amount), 0n)
    - pre.filter(b => b.owner === wallet && b.mint === m).reduce((s,b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  // A second non-quote asset makes attribution ambiguous, even across outer calls.
  if ([...new Set([...pre, ...post].filter(b => b.owner === wallet).map(b => b.mint))]
    .some(m => m !== mint && m !== WSOL_MINT && delta(m) !== 0n)) return unknown('AMBIGUOUS_TRANSFERS');
  const accounts = new Map<string, Account>(), keys = tx.transaction.message.accountKeys;
  for (const b of [...pre, ...post]) {
    if (!Number.isInteger(b.accountIndex) || typeof b.accountIndex !== 'number' || b.accountIndex < 0 || !b.owner) continue;
    const k = keys[b.accountIndex]; if (!k) continue;
    const address = key(k), old = accounts.get(address);
    if (old && (old.owner !== b.owner || old.mint !== b.mint)) return unknown('MISSING_ACCOUNT_MAPPING');
    accounts.set(address, { owner: b.owner, mint: b.mint });
  }
  const matches: DiscoverySpendEvidence[] = [];
  const recovered = new Map<string, WsolOwnershipEvidence>();
  let reason: UnknownReason = 'NO_MATCHED_QUOTE_TRANSFER';
  for (const group of tx.meta.innerInstructions ?? []) {
    if (typeof group.index !== 'number' || !Number.isInteger(group.index) || group.index < 0) continue;
    const parent = object(tx.transaction.message.instructions[group.index]);
    if (typeof parent.programId !== 'string' || [SYSTEM, TOKEN, TOKEN_2022].includes(parent.programId)) continue;
    const temporary = temporaryWsolOwnership(tx, group.index);
    const groupRecovered = new Map<string, WsolOwnershipEvidence>();
    const resolve = (address: unknown): Account | undefined => {
      if (typeof address !== 'string') return undefined;
      const existing = accounts.get(address); if (existing) return existing;
      const proof = temporary.get(address);
      if (proof) { groupRecovered.set(address,proof); recovered.set(address,proof); }
      return proof;
    };
    const transfers: Transfer[] = []; let invalid: UnknownReason | null = null;
    for (const item of group.instructions) {
      const ix = object(item), parsed = object(ix.parsed), info = object(parsed.info);
      if (ix.programId === TOKEN_2022) { invalid = 'UNSUPPORTED_TOKEN_PROGRAM'; break; }
      if (ix.programId === TOKEN) {
        if (parsed.type !== 'transfer' && parsed.type !== 'transferChecked') { invalid = 'AMBIGUOUS_TRANSFERS'; break; }
        const source = resolve(info.source);
        const dest = resolve(info.destination);
        if (!source || !dest) { invalid = 'MISSING_ACCOUNT_MAPPING'; break; }
        const amount = raw.safeParse(parsed.type === 'transferChecked' ? object(info.tokenAmount).amount : info.amount);
        if (source.mint !== dest.mint || !amount.success || (parsed.type === 'transferChecked' && info.mint !== source.mint)) { invalid = 'AMBIGUOUS_TRANSFERS'; break; }
        transfers.push({ from: source.owner, to: dest.owner, mint: source.mint, amount: amount.data });
      } else if (ix.programId === SYSTEM) {
        // createAccount rent and any other system operation inside the same call
        // make this narrow extractor decline attribution, not add rent to spend.
        if (parsed.type !== 'transfer' || typeof info.source !== 'string' || typeof info.destination !== 'string') { invalid = 'AMBIGUOUS_TRANSFERS'; break; }
        const amount = raw.safeParse(typeof info.lamports === 'number' && Number.isSafeInteger(info.lamports) ? String(info.lamports) : info.lamports);
        if (!amount.success) { invalid = 'AMBIGUOUS_TRANSFERS'; break; }
        transfers.push({ from: info.source, to: info.destination, mint: 'SOL', amount: amount.data });
      }
    }
    if (invalid) { reason = invalid; continue; }
    const received: Transfer[] = transfers.filter(t => t.mint === mint && t.to === wallet && t.from !== wallet);
    if (!received.length) continue;
    if (received.length !== 1 || transfers.length !== 2) { reason = 'AMBIGUOUS_TRANSFERS'; continue; }
    const token: Transfer = received[0]!, quote: Transfer = transfers.find(t => t !== token)!;
    if (quote.from !== wallet || quote.to !== token.from || !['SOL', WSOL_MINT].includes(quote.mint) || BigInt(token.amount) !== delta(mint)) {
      reason = 'NO_MATCHED_QUOTE_TRANSFER'; continue;
    }
    matches.push({ version: 1, status: 'MATCHED_TRANSFERS', source: 'RPC_PARSED_INNER_TRANSFERS',
      quoteAsset: quote.mint === 'SOL' ? 'SOL' : 'WSOL', quoteLamports: quote.amount, tokenAmountRaw: token.amount,
      outerInstructionIndex: group.index, counterparty: token.from, programId: parent.programId,
      ...(groupRecovered.size ? { recoveredWsolAccounts: [...groupRecovered.values()] } : {}) });
  }
  return matches.length === 1 ? matches[0]! : { ...unknown(matches.length > 1 ? 'AMBIGUOUS_TRANSFERS' : reason),
    ...(recovered.size ? { recoveredWsolAccounts: [...recovered.values()] } : {}) };
}

import { z } from 'zod';
import type { ParsedTx } from './rpc';
import { WSOL_MINT } from './helius';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM = '11111111111111111111111111111111';
const nonLifecycle = ['transfer', 'transferChecked', 'syncNative', 'initializeImmutableOwner', 'getAccountDataSize', 'approve', 'approveChecked', 'revoke'];
const location = z.object({ outerIndex: z.number().int().nonnegative(), innerIndex: z.number().int().nonnegative().nullable() });
export const WsolOwnershipEvidence = z.object({
  account: z.string().min(1), owner: z.string().min(1), mint: z.literal(WSOL_MINT),
  source: z.literal('RPC_CREATE_AND_INITIALIZE'), createdAt: location, initializedAt: location,
});
export type WsolOwnershipEvidence = z.infer<typeof WsolOwnershipEvidence>;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const key = (v: ParsedTx['transaction']['message']['accountKeys'][number]) => typeof v === 'string' ? v : v.pubkey;

/** Resolve only accounts absent from BOTH balance snapshots, explicitly created
 * for classic SPL Token and initialized as WSOL before the consuming outer call.
 * No inference from transfer authority, rent funding, ATA address, or close recipient.
 * Same-call initialization and account reuse are intentionally unsupported.
 */
export function temporaryWsolOwnership(tx: ParsedTx, beforeOuterIndex: number): Map<string, WsolOwnershipEvidence> {
  const result = new Map<string, WsolOwnershipEvidence>();
  if (!tx.meta || tx.meta.err != null || !Number.isInteger(beforeOuterIndex) || beforeOuterIndex < 0 || beforeOuterIndex >= tx.transaction.message.instructions.length) return result;
  const keys = tx.transaction.message.accountKeys.map(key), addresses = new Set(keys);
  const observed = new Set<string>();
  for (const b of [...tx.meta.preTokenBalances ?? [], ...tx.meta.postTokenBalances ?? []]) {
    if (typeof b.accountIndex === 'number' && keys[b.accountIndex]) observed.add(keys[b.accountIndex]!);
  }
  const groups = new Map<number, unknown[]>();
  for (const g of tx.meta.innerInstructions ?? []) {
    if (typeof g.index !== 'number' || !Number.isInteger(g.index) || g.index < 0 || g.index >= tx.transaction.message.instructions.length || groups.has(g.index)) return result;
    groups.set(g.index, g.instructions);
  }
  const created = new Map<string, z.infer<typeof location>>(), blocked = new Set<string>();
  const invalidate = (account: unknown) => { if (typeof account === 'string') { blocked.add(account); result.delete(account); } };
  const visit = (item: unknown, at: z.infer<typeof location>) => {
    const ix = object(item), parsed = object(ix.parsed), info = object(parsed.info);
    if (ix.programId === SYSTEM && ['createAccount', 'createAccountWithSeed'].includes(String(parsed.type))) {
      const account = info.newAccount;
      if (typeof account !== 'string') return;
      if (created.has(account) || info.owner !== TOKEN || info.space !== 165 || !addresses.has(account) || observed.has(account)) { invalidate(account); return; }
      created.set(account, at); return;
    }
    if (ix.programId !== TOKEN) return;
    if (['initializeAccount', 'initializeAccount2', 'initializeAccount3'].includes(String(parsed.type))) {
      const account = info.account;
      if (typeof account !== 'string') return;
      const creation = created.get(account);
      if (!creation || blocked.has(account) || result.has(account) || info.mint !== WSOL_MINT || typeof info.owner !== 'string' || !addresses.has(info.owner)) { invalidate(account); return; }
      result.set(account, { account, owner: info.owner, mint: WSOL_MINT, source: 'RPC_CREATE_AND_INITIALIZE', createdAt: creation, initializedAt: at });
    } else if (['closeAccount', 'setAuthority'].includes(String(parsed.type))) {
      invalidate(info.account);
    } else if (!nonLifecycle.includes(String(parsed.type))) {
      // An undecoded classic-token instruction might change ownership or lifecycle.
      invalidate(info.account);
      for (const account of Array.isArray(ix.accounts) ? ix.accounts : []) invalidate(account);
    }
  };
  for (let outerIndex = 0; outerIndex < beforeOuterIndex; outerIndex++) {
    visit(tx.transaction.message.instructions[outerIndex], { outerIndex, innerIndex: null });
    for (const [innerIndex, ix] of (groups.get(outerIndex) ?? []).entries()) visit(ix, { outerIndex, innerIndex });
  }
  // Reinitialization, close or authority changes in the consuming call can occur
  // before a transfer. Decline the account for this entire call rather than guess.
  for (const item of groups.get(beforeOuterIndex) ?? []) {
    const ix = object(item), parsed = object(ix.parsed), info = object(parsed.info);
    if (ix.programId !== TOKEN) continue;
    if (['closeAccount', 'setAuthority', 'initializeAccount', 'initializeAccount2', 'initializeAccount3'].includes(String(parsed.type))) invalidate(info.account);
    else if (!nonLifecycle.includes(String(parsed.type))) {
      invalidate(info.account);
      for (const account of Array.isArray(ix.accounts) ? ix.accounts : []) invalidate(account);
    }
  }
  return result;
}

import { describe, expect, it, vi } from 'vitest';
import { AddressLookupTableProgram, MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { capturedLookupFixture as captured } from './captured-fixtures';
import { resolveLookupTables, type LookupTableRpc, type ResolvedLookupTables } from './lookupTables';
import { DEFAULT_TX_LIMITS, verifySwapTransaction, type SwapExpectations } from './verify';
import type { RawAccount } from './simulation';
import { WSOL_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM, associatedTokenAddress } from './programs';
import { ataCreateIdempotent, closeAccount, honestBuy, honestSell, ix, jupiterSwap, lookupTable, newAddress, syncNative, toBase64, tokenIx, transfer } from './fixtures';

const capturedExp: SwapExpectations = { ...captured.expectations, inAmount: BigInt(captured.expectations.inAmount), limits: DEFAULT_TX_LIMITS };
const codes = (result: { reasons: { code: string }[] }) => result.reasons.map(r => r.code);
const captureRpc = (): LookupTableRpc => ({ getAccountsWithContext: vi.fn(async () => ({ slot: captured.slot, accounts: captured.accounts.map(a => a && { ...a }) })) });
const user = newAddress(), mint = newAddress(), attacker = newAddress();
const wsol = associatedTokenAddress(user, WSOL_MINT), output = associatedTokenAddress(user, mint);
const exp: SwapExpectations = { userWallet: user, side: 'BUY', inputMint: WSOL_MINT, outputMint: mint, inAmount: 10_000_000n, limits: DEFAULT_TX_LIMITS };
const resolved = (tables: ResolvedLookupTables['tables']): ResolvedLookupTables => ({ tables, slot: 123 });
const serialize = (message: MessageV0) => Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');

describe('captured Jupiter transaction, no network or clock', () => {
  it('still refuses without resolution, and passes with the raw captured tables resolved', async () => {
    const original = verifySwapTransaction(captured.transactionBase64, capturedExp);
    expect(codes(original)).toEqual(['ACCOUNT_NOT_STATIC', 'ACCOUNT_NOT_STATIC']);
    const rpc = captureRpc();
    const result = await resolveLookupTables(captured.transactionBase64, rpc);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Fixture resolution failed');
    expect(rpc.getAccountsWithContext).toHaveBeenCalledTimes(1);
    expect(rpc.getAccountsWithContext).toHaveBeenCalledWith([...captured.lookupAddresses]);
    const verdict = verifySwapTransaction(captured.transactionBase64, { ...capturedExp, resolvedLookupTables: result.resolved });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.summary.messageHash).toBe(original.summary.messageHash);
    expect(verdict.summary.lookupContextSlot).toBe(captured.slot);
    expect(verdict.summary.lookupTableDetails?.map(t => t.address)).toEqual([...captured.lookupAddresses]);
    expect(verdict.summary.lookupTableDetails?.map(t => t.addressCount)).toEqual(result.resolved.tables.map(t => t.state.addresses.length));
    expect(verdict.summary.lookupAccounts?.length).toBeGreaterThan(0);
    // Slot is evidence only. Even a very old/future/absent slot does not change the verdict.
    for (const slot of [0, Number.MAX_SAFE_INTEGER, null]) {
      expect(verifySwapTransaction(captured.transactionBase64, { ...capturedExp, resolvedLookupTables: { ...result.resolved, slot } }).reasons).toEqual([]);
    }
  });

  it.each(['missing', 'owner', 'deactivated', 'malformed', 'truncated', 'bad-base64'] as const)('fails closed for %s table accounts; no partial result', async kind => {
    const accounts: (RawAccount | null)[] = captured.accounts.map(a => a && { ...a });
    const first = accounts[0]!;
    if (kind === 'missing') accounts[0] = null;
    else if (kind === 'owner') first.owner = SYSTEM_PROGRAM;
    else if (kind === 'deactivated') {
      // Synthetic corruption of a COPY, never modifying the captured fixture.
      const bytes = Buffer.from(first.data, 'base64'); bytes.writeBigUInt64LE(1n, 4); first.data = bytes.toString('base64');
    } else if (kind === 'malformed') first.data = Buffer.alloc(56).toString('base64');
    else if (kind === 'truncated') first.data = Buffer.from(first.data, 'base64').subarray(0, 57).toString('base64');
    else first.data += '!';
    const r = await resolveLookupTables(captured.transactionBase64, { getAccountsWithContext: async () => ({ slot: 42, accounts }) });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(kind === 'missing' ? 'LOOKUP_TABLE_UNRESOLVED' : 'LOOKUP_TABLE_INVALID');
    expect(r).not.toHaveProperty('resolved');
    expect(r).toHaveProperty('slot', 42);
  });

  it('sanitizes RPC failures and rejects wrong-length responses', async () => {
    const rpc = { getAccountsWithContext: vi.fn(async () => { throw new Error('secret RPC URL must never escape'); }) };
    const r = await resolveLookupTables(captured.transactionBase64, rpc);
    expect(codes(r)).toEqual(['LOOKUP_TABLE_UNRESOLVED']);
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(codes(await resolveLookupTables(captured.transactionBase64, { getAccountsWithContext: async () => ({ slot: 42, accounts: [] }) }))).toEqual(['LOOKUP_TABLE_UNRESOLVED']);
  });

  it.each(['writableIndexes', 'readonlyIndexes'] as const)('rejects an out-of-range %s index', async field => {
    const tx = VersionedTransaction.deserialize(Buffer.from(captured.transactionBase64, 'base64'));
    if (tx.message.version !== 0) throw new Error('Expected v0');
    // Empty the table's address array in the fake RPC while retaining valid SDK metadata.
    const accounts = captured.accounts.map(a => a && { ...a, data: Buffer.from(a.data, 'base64').subarray(0, 56).toString('base64') });
    // Use a table with empty metadata's last-extended index as well, so the failure is specifically an index.
    for (const a of accounts) if (a) { const data = Buffer.from(a.data, 'base64'); data[20] = 0; a.data = data.toString('base64'); }
    tx.message.addressTableLookups[0]![field] = [0];
    const r = await resolveLookupTables(Buffer.from(tx.serialize()).toString('base64'), { getAccountsWithContext: async () => ({ slot: 42, accounts }) });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('LOOKUP_INDEX_OUT_OF_RANGE');
    expect(r).not.toHaveProperty('resolved');
  });
});

describe('resolved addresses do not gain permission', () => {
  it.each(['system transfer', 'token transfer', 'token close'] as const)('rejects an attacker destination loaded from a table: %s', kind => {
    const table = lookupTable([attacker]);
    const bad = kind === 'system transfer' ? transfer(user, attacker, 1n) : kind === 'token close' ? closeAccount(wsol, attacker, user) : tokenIx(3, [{ pubkey: wsol }, { pubkey: attacker }, { pubkey: user, signer: true }]);
    const tx = toBase64(user, [...honestBuy(user, mint).instructions, bad], { lookupTables: [table] });
    const r = verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([table]) });
    expect(r.summary.lookupAccounts?.some(a => a.address === attacker)).toBe(true);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(kind === 'system transfer' ? 'SYSTEM_TRANSFER_TO_OTHER' : kind === 'token close' ? 'CLOSE_TO_OTHER' : 'TOKEN_INSTRUCTION_NOT_ALLOWED');
    expect(codes(r)).not.toContain('ACCOUNT_NOT_STATIC');
  });

  it('continues to reject authority changes after resolution', () => {
    const table = lookupTable([attacker]);
    const bad = tokenIx(6, [{ pubkey: wsol }, { pubkey: user, signer: true }, { pubkey: attacker }]);
    const r = verifySwapTransaction(toBase64(user, [...honestBuy(user, mint).instructions, bad], { lookupTables: [table] }), { ...exp, resolvedLookupTables: resolved([table]) });
    expect(codes(r)).toContain('TOKEN_INSTRUCTION_NOT_ALLOWED');
  });

  it.each(['mint', 'owner'] as const)('continues to reject foreign ATA %s after resolution', field => {
    const foreignMint = field === 'mint' ? attacker : mint;
    const owner = field === 'owner' ? attacker : user;
    const ata = associatedTokenAddress(owner, foreignMint);
    const table = lookupTable([attacker, ata]);
    const tx = toBase64(user, [...honestBuy(user, mint).instructions, ataCreateIdempotent(user, owner, foreignMint)], { lookupTables: [table] });
    const r = verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([table]) });
    expect(codes(r)).toContain(field === 'mint' ? 'ATA_MINT_UNEXPECTED' : 'ATA_OWNER_OTHER');
    expect(codes(r)).not.toContain('ACCOUNT_NOT_STATIC');
  });

  it('rejects a table-loaded program even when that program is otherwise allowed', () => {
    const table = lookupTable([TOKEN_PROGRAM, wsol]);
    // SDK compilers keep program IDs static; hand-build the malicious v0 message instead.
    const message = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 }, staticAccountKeys: [new PublicKey(user)], recentBlockhash: newAddress(), compiledInstructions: [{ programIdIndex: 2, accountKeyIndexes: [1], data: Uint8Array.from([17]) }], addressTableLookups: [{ accountKey: table.key, writableIndexes: [1], readonlyIndexes: [0] }] });
    const r = verifySwapTransaction(serialize(message), { ...exp, resolvedLookupTables: resolved([table]) });
    expect(codes(r)).toContain('PROGRAM_NOT_STATIC');
  });

  it.each(['BUY', 'SELL'] as const)('accepts derived token accounts loaded from a table: %s', side => {
    const table = lookupTable([wsol, output, WSOL_MINT, mint]);
    const instructions = side === 'BUY' ? honestBuy(user, mint).instructions : honestSell(user, mint).instructions;
    const tx = toBase64(user, instructions, { lookupTables: [table] });
    const e = side === 'BUY' ? exp : { ...exp, side, inputMint: mint, outputMint: WSOL_MINT };
    expect(codes(verifySwapTransaction(tx, e))).toContain('ACCOUNT_NOT_STATIC');
    const r = verifySwapTransaction(tx, { ...e, resolvedLookupTables: resolved([table]) });
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.summary.lookupAccounts?.some(a => a.address === wsol)).toBe(true);
  });

  it('orders all writable keys before all readonly keys across multiple tables', () => {
    const a = lookupTable([WSOL_MINT, wsol]), b = lookupTable([mint, output]);
    const tx = toBase64(user, honestBuy(user, mint).instructions, { lookupTables: [a, b] });
    const r = verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([b, a]) });
    expect(r.ok).toBe(true);
    expect(r.summary.lookupAccounts?.map(k => [k.address, k.writable])).toEqual([[wsol, true], [output, true], [WSOL_MINT, false], [mint, false]]);
    expect(r.summary.lookupTableDetails?.map(t => t.address)).toEqual([a.key.toBase58(), b.key.toBase58()]);
    const indices = r.summary.lookupAccounts!.map(k => k.index);
    expect(indices).toEqual([indices[0], indices[0]! + 1, indices[0]! + 2, indices[0]! + 3]);
  });

  it('rejects missing, duplicate, deactivated, or out-of-range caller-supplied tables', () => {
    const t = lookupTable([wsol]);
    const tx = toBase64(user, [syncNative(wsol), jupiterSwap(user)], { lookupTables: [t] });
    expect(codes(verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([]) }))).toContain('LOOKUP_TABLE_UNRESOLVED');
    expect(codes(verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([t, t]) }))).toContain('LOOKUP_TABLE_INVALID');
    t.state.deactivationSlot = 0n;
    expect(codes(verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([t]) }))).toContain('LOOKUP_TABLE_INVALID');
    t.state.deactivationSlot = 0xffffffffffffffffn; t.state.addresses = [];
    expect(codes(verifySwapTransaction(tx, { ...exp, resolvedLookupTables: resolved([t]) }))).toContain('LOOKUP_INDEX_OUT_OF_RANGE');
  });

  it('enforces maxLookupTables before network IO and in the verifier, with or without resolution', async () => {
    const tables = Array.from({ length: DEFAULT_TX_LIMITS.maxLookupTables + 1 }, () => lookupTable([newAddress()]));
    const transaction = toBase64(user, [ix(SYSTEM_PROGRAM, tables.map(t => ({ pubkey: t.state.addresses[0]!.toBase58() })), [0]), jupiterSwap(user)], { lookupTables: tables });
    const rpc = captureRpc();
    expect(codes(await resolveLookupTables(transaction, rpc))).toEqual(['TOO_MANY_LOOKUP_TABLES']);
    expect(rpc.getAccountsWithContext).not.toHaveBeenCalled();
    for (const resolution of [undefined, resolved(tables)]) expect(codes(verifySwapTransaction(transaction, { ...exp, resolvedLookupTables: resolution }))).toContain('TOO_MANY_LOOKUP_TABLES');
    expect(codes(await resolveLookupTables(captured.transactionBase64, rpc, { maxLookupTables: 1 }))).toEqual(['TOO_MANY_LOOKUP_TABLES']);
    expect(rpc.getAccountsWithContext).not.toHaveBeenCalled();
  });

  it('does not call RPC for legacy/table-free messages or invalid transactions', async () => {
    const rpc = captureRpc();
    for (const legacy of [true, false]) expect(await resolveLookupTables(toBase64(user, honestBuy(user, mint).instructions, { legacy }), rpc)).toEqual({ ok: true, reasons: [], resolved: { tables: [], slot: null } });
    expect(codes(await resolveLookupTables('not-base64!', rpc))).toEqual(['UNDECODABLE']);
    expect(rpc.getAccountsWithContext).not.toHaveBeenCalled();
    expect(AddressLookupTableProgram.programId.toBase58()).toBe(captured.accounts[0]!.owner);
  });
});

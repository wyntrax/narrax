import { describe, expect, it } from 'vitest';
import { ComputeBudgetProgram } from '@solana/web3.js';
import { DEFAULT_TX_LIMITS, verifySwapTransaction, type SwapExpectations } from './verify';
import { WSOL_MINT, associatedTokenAddress } from './programs';
import {
  ataCreateIdempotent, closeAccount, honestBuy, honestSell, ix, jupiterSwap, lookupTable, newAddress, syncNative, toBase64, tokenIx, transfer,
} from './fixtures';

const user = newAddress();
const mint = newAddress();
const attacker = newAddress();
const wsol = associatedTokenAddress(user, WSOL_MINT);
const buyExp = (over: Partial<SwapExpectations> = {}): SwapExpectations => ({ userWallet: user, side: 'BUY', inputMint: WSOL_MINT, outputMint: mint, inAmount: 10_000_000n, limits: DEFAULT_TX_LIMITS, ...over });
const sellExp = (): SwapExpectations => ({ userWallet: user, side: 'SELL', inputMint: mint, outputMint: WSOL_MINT, inAmount: 5_000_000n, limits: DEFAULT_TX_LIMITS });
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe('an honest swap', () => {
  it('passes, and the summary tells a reviewer what it does', () => {
    const r = verifySwapTransaction(toBase64(user, honestBuy(user, mint).instructions), buyExp());
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ version: 0, feePayer: user, requiredSignatures: 1, computeUnitLimit: 400_000, computeUnitPrice: '1000', priorityFeeLamports: '400' });
    expect(r.summary.messageHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.summary.instructions.map((i) => `${i.program}:${i.kind}`)).toEqual([
      'compute-budget:set-compute-unit-limit', 'compute-budget:set-compute-unit-price', 'associated-token:create-ata-idempotent', 'system:transfer', 'token:sync-native',
      'associated-token:create-ata-idempotent', 'jupiter-v6:swap', 'token:close-account',
    ]);
  });
  it('passes a sell, and a legacy-format transaction', () => {
    expect(verifySwapTransaction(toBase64(user, honestSell(user, mint).instructions), sellExp()).ok).toBe(true);
    expect(verifySwapTransaction(toBase64(user, honestBuy(user, mint).instructions, { legacy: true }), buyExp()).ok).toBe(true);
  });
  it('gives the same message hash for the same message and a different one when anything changes', () => {
    const a = honestBuy(user, mint, 10_000_000n).instructions;
    const bh = (n: bigint) => verifySwapTransaction(toBase64(user, honestBuy(user, mint, n).instructions), buyExp()).summary.messageHash;
    expect(bh(10_000_000n)).not.toBe(bh(9_000_000n));
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('hostile transactions are rejected', () => {
  const buy = () => honestBuy(user, mint).instructions;
  const reject = (instructions: ReturnType<typeof buy>, code: string, exp = buyExp(), opts?: Parameters<typeof toBase64>[2]) => {
    const r = verifySwapTransaction(toBase64(user, instructions, opts), exp);
    expect(r.ok, `expected a rejection for ${code}`).toBe(false);
    expect(codes(r)).toContain(code);
    return r;
  };

  it('an extra SOL transfer to the attacker', () => reject([...buy(), transfer(user, attacker, 1_000_000)], 'SYSTEM_TRANSFER_TO_OTHER'));
  it('a transfer out of someone else\'s account', () => reject([...buy(), transfer(attacker, wsol, 1)], 'SYSTEM_TRANSFER_FROM_OTHER'));
  it('wrapping more SOL than the swap input plus overhead', () => {
    reject(honestBuy(user, mint, 20_000_000n).instructions, 'TRANSFER_EXCEEDS_INPUT');
  });
  it('System program instructions that are not a plain transfer (Assign, CreateAccount, Allocate)', () => {
    const sys = (tag: number) => ix('11111111111111111111111111111111', [{ pubkey: user, signer: true }], [tag, 0, 0, 0]);
    for (const tag of [0, 1, 8]) reject([...buy(), sys(tag)], 'SYSTEM_INSTRUCTION_NOT_ALLOWED');
  });
  it('SetAuthority, Approve, Transfer, Burn and Freeze on the Token program', () => {
    for (const tag of [6, 4, 13, 3, 12, 8, 10, 1, 5, 7]) {
      reject([...buy(), tokenIx(tag, [{ pubkey: wsol }, { pubkey: attacker }, { pubkey: user, signer: true }])], 'TOKEN_INSTRUCTION_NOT_ALLOWED');
    }
  });
  it('closing a token account to the attacker, or closing an account that is not the user\'s', () => {
    reject([...buy().slice(0, -1), closeAccount(wsol, attacker, user)], 'CLOSE_TO_OTHER');
    reject([...buy().slice(0, -1), closeAccount(newAddress(), user, user)], 'CLOSE_OTHER_ACCOUNT');
  });
  it('syncing an account that is not the user\'s wrapped SOL account', () => reject([...buy(), syncNative(newAddress())], 'SYNC_NATIVE_OTHER'));
  it('an instruction from a program that is not on the allow list', () => {
    reject([...buy(), ix('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', [{ pubkey: user, signer: true }], [104, 105])], 'PROGRAM_NOT_ALLOWED');
    reject([...buy(), ix(attacker, [{ pubkey: user, signer: true }], [1])], 'PROGRAM_NOT_ALLOWED');
  });
  it('the wrong fee payer', () => {
    const r = verifySwapTransaction(toBase64(attacker, honestBuy(attacker, mint).instructions), buyExp());
    expect(codes(r)).toContain('WRONG_FEE_PAYER');
  });
  it('a second required signer', () => {
    const swap = ix('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', [{ pubkey: user, signer: true }, { pubkey: attacker, signer: true }], [1]);
    reject([...buy().filter((i) => i.programId.toBase58() !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), swap], 'EXTRA_SIGNERS');
  });
  it('a transaction that already carries a signature', () => reject(buy(), 'PRESIGNED', buyExp(), { presign: true }));
  it('a token account created for the attacker, for the wrong mint, or at the wrong address', () => {
    reject([...buy(), ataCreateIdempotent(user, attacker, mint)], 'ATA_OWNER_OTHER');
    reject([...buy(), ataCreateIdempotent(user, user, newAddress())], 'ATA_MINT_UNEXPECTED');
    reject([...buy(), ataCreateIdempotent(user, user, mint, attacker)], 'ATA_ADDRESS_MISMATCH');
    reject([...buy(), ataCreateIdempotent(attacker, user, mint)], 'ATA_PAYER_OTHER');
  });
  it('no Jupiter instruction, or two', () => {
    reject(buy().filter((i) => i.programId.toBase58() !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), 'JUPITER_INSTRUCTION_COUNT');
    reject([...buy(), jupiterSwap(user)], 'JUPITER_INSTRUCTION_COUNT');
  });
  it('a Jupiter instruction that does not involve the user', () => {
    const swap = ix('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', [{ pubkey: newAddress() }], [1]);
    reject([...buy().filter((i) => i.programId.toBase58() !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), swap], 'JUPITER_WITHOUT_USER');
  });
  it('a compute limit above the ceiling, a priority fee above the cap, and duplicate budget instructions', () => {
    const base = buy().slice(2);
    reject([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_001 }), ...base], 'COMPUTE_LIMIT_TOO_HIGH');
    reject([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_000_000 }), ...base], 'PRIORITY_FEE_TOO_HIGH');
    reject([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 9_000_000_000 }), ...base], 'PRIORITY_FEE_TOO_HIGH'); // no explicit limit: worst case is assumed
    reject([ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 2 }), ...base], 'DUPLICATE_COMPUTE_LIMIT');
    reject([ComputeBudgetProgram.requestHeapFrame({ bytes: 65536 }), ...base], 'COMPUTE_BUDGET_INSTRUCTION_NOT_ALLOWED');
  });
  it('too many instructions', () => {
    const many = Array.from({ length: 12 }, () => syncNative(wsol));
    reject([...buy(), ...many], 'TOO_MANY_INSTRUCTIONS');
  });
  it('an empty transaction', () => reject([], 'NO_INSTRUCTIONS'));

  it('an account that can only be seen through a lookup table, in an instruction that moves value', () => {
    // The attacker address lives only in a lookup table, so the transfer's destination cannot be checked.
    const table = lookupTable([attacker]);
    const r = reject([...buy(), transfer(user, attacker, 1_000)], 'ACCOUNT_NOT_STATIC', buyExp(), { lookupTables: [table] });
    expect(r.summary.lookupTables).toBe(1);
  });
  it('an honest transaction that uses a lookup table for the Jupiter route still passes', () => {
    const routeAccount = newAddress();
    const swap = ix('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', [{ pubkey: user, signer: true }, { pubkey: routeAccount }], [1]);
    const table = lookupTable([routeAccount]);
    const r = verifySwapTransaction(toBase64(user, [...buy().filter((i) => i.programId.toBase58() !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), swap], { lookupTables: [table] }), buyExp());
    expect(r.reasons).toEqual([]);
    expect(r.summary.lookupTables).toBe(1);
  });
  it('too many lookup tables', () => {
    const accounts = Array.from({ length: 5 }, () => newAddress());
    const swap = ix('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', [{ pubkey: user, signer: true }, ...accounts.map((a) => ({ pubkey: a }))], [1]);
    const tables = accounts.map((a) => lookupTable([a]));
    reject([...buy().filter((i) => i.programId.toBase58() !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), swap], 'TOO_MANY_LOOKUP_TABLES', buyExp(), { lookupTables: tables });
  });

  it('input that is not a transaction at all', () => {
    for (const junk of ['', 'not base64!!', 'AAAA', 'A'.repeat(2000), '//8=']) {
      const r = verifySwapTransaction(junk, buyExp());
      expect(r.ok).toBe(false);
      expect(codes(r)).toContain('UNDECODABLE');
    }
  });
  it('bad expectations (a malformed wallet or mint) fail instead of throwing', () => {
    expect(codes(verifySwapTransaction(toBase64(user, buy()), buyExp({ userWallet: 'nope' })))).toEqual(['BAD_EXPECTATIONS']);
    expect(codes(verifySwapTransaction(toBase64(user, buy()), buyExp({ outputMint: '' })))).toEqual(['BAD_EXPECTATIONS']);
  });
  it('reports every problem, not only the first', () => {
    const r = verifySwapTransaction(toBase64(user, [...buy(), transfer(user, attacker, 1), tokenIx(6, [{ pubkey: wsol }])]), buyExp());
    expect(codes(r)).toEqual(expect.arrayContaining(['SYSTEM_TRANSFER_TO_OTHER', 'TOKEN_INSTRUCTION_NOT_ALLOWED']));
  });
});

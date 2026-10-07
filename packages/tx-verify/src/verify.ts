import { createHash } from 'node:crypto';
import { VersionedTransaction, type MessageCompiledInstruction } from '@solana/web3.js';
import { validateLookupTables, type ResolvedLookupTables } from './lookupTables';
import {
  ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V6_PROGRAM, PROGRAM_NAMES, SYSTEM_PROGRAM, TOKEN_PROGRAM, WSOL_MINT, associatedTokenAddress, isBase58Address,
} from './programs';

/** What the caller already knows from the verified quote and its own records. The transaction is checked against this, never the reverse. */
export interface SwapExpectations {
  /** The user's trading wallet. Must be the fee payer and the only signer. */
  userWallet: string;
  side: 'BUY' | 'SELL';
  /** WSOL for a buy, the token for a sell. */
  inputMint: string;
  /** The token for a buy, WSOL for a sell. */
  outputMint: string;
  /** Base units going in, from the quote. */
  inAmount: bigint;
  limits: TxLimits;
  /** Optional trusted RPC resolution. Omit to preserve the original static-only checks. */
  resolvedLookupTables?: ResolvedLookupTables;
}

/** Starting values, not tuned. The executor config can only make them stricter than its hard-coded ceilings. */
export interface TxLimits {
  /** Fees and rent the transaction may cost on top of the swap input (priority fee, account rent). */
  maxOverheadLamports: bigint;
  maxPriorityFeeLamports: bigint;
  maxComputeUnits: number;
  maxInstructions: number;
  maxLookupTables: number;
}

export const DEFAULT_TX_LIMITS: TxLimits = {
  maxOverheadLamports: 5_000_000n, // 0.005 SOL
  maxPriorityFeeLamports: 1_000_000n, // 0.001 SOL
  maxComputeUnits: 1_400_000, // the network maximum
  maxInstructions: 14,
  maxLookupTables: 4,
};

export interface Reason { code: string; message: string }

export interface InstructionSummary {
  program: string;
  kind: string;
  detail?: string;
}

export interface TxSummary {
  version: 'legacy' | number;
  feePayer: string | null;
  requiredSignatures: number;
  lookupTables: number;
  /** Present only when resolution was supplied; slot is review evidence, never an acceptance condition. */
  lookupContextSlot?: number | null;
  lookupTableDetails?: { address: string; addressCount: number; authority: string | null }[];
  /** Message account indices, in runtime order, with their lookup-table provenance. */
  lookupAccounts?: { index: number; address: string; table: string; tableIndex: number; writable: boolean }[];
  computeUnitLimit: number | null;
  computeUnitPrice: string | null;
  priorityFeeLamports: string | null;
  instructions: InstructionSummary[];
  /** sha256 of the serialized message. Identifies exactly what would be signed. */
  messageHash: string | null;
  /** The derived token accounts the checks used, so a reviewer can see them. */
  derived: { wsolAccount: string; inputAccount: string; outputAccount: string } | null;
}

export interface VerifyResult { ok: boolean; reasons: Reason[]; summary: TxSummary }

/** 1232 bytes is the Solana transaction size limit; base64 of that is 1644 characters. */
const MAX_BASE64_LENGTH = 1644;

const u32 = (d: Uint8Array, o: number) => (d.length >= o + 4 ? Buffer.from(d).readUInt32LE(o) : null);
const u64 = (d: Uint8Array, o: number) => (d.length >= o + 8 ? Buffer.from(d).readBigUInt64LE(o) : null);

const emptySummary = (): TxSummary => ({ version: 0, feePayer: null, requiredSignatures: 0, lookupTables: 0, computeUnitLimit: null, computeUnitPrice: null, priorityFeeLamports: null, instructions: [], messageHash: null, derived: null });

/**
 * Checks an unsigned swap transaction before anything is signed. Pure: no network, no clock.
 * The rule is "reject anything not understood". A transaction passes only if every instruction is on the allow list and
 * every instruction that moves value stays inside the user's own accounts. What the Jupiter instruction itself does is opaque
 * here, so this is only half of the defence: the simulation check (simulation.ts) verifies the effects on the user's balances.
 */
export function verifySwapTransaction(base64: string, exp: SwapExpectations): VerifyResult {
  const reasons: Reason[] = [];
  const summary = emptySummary();
  const fail = (code: string, message: string) => reasons.push({ code, message });
  const done = (): VerifyResult => ({ ok: reasons.length === 0, reasons, summary });

  if (!isBase58Address(exp.userWallet) || !isBase58Address(exp.inputMint) || !isBase58Address(exp.outputMint)) {
    fail('BAD_EXPECTATIONS', 'The wallet or mint address is not valid.');
    return done();
  }
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    fail('UNDECODABLE', 'The transaction is empty, too large or not base64.');
    return done();
  }
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64')); } catch {
    fail('UNDECODABLE', 'The transaction could not be decoded.');
    return done();
  }

  const msg = tx.message;
  let keys: (string | undefined)[] = msg.staticAccountKeys.map((k) => k.toBase58());
  const staticCount = keys.length;
  const ixs: MessageCompiledInstruction[] = msg.compiledInstructions;
  const lookups = msg.addressTableLookups ?? [];
  summary.version = msg.version;
  summary.feePayer = keys[0] ?? null;
  summary.requiredSignatures = msg.header.numRequiredSignatures;
  summary.lookupTables = lookups.length;
  summary.messageHash = createHash('sha256').update(Buffer.from(msg.serialize())).digest('hex');

  // Who signs and who pays.
  if (keys[0] !== exp.userWallet) fail('WRONG_FEE_PAYER', 'The fee payer is not the user\'s wallet.');
  if (msg.header.numRequiredSignatures !== 1) fail('EXTRA_SIGNERS', `The transaction needs ${msg.header.numRequiredSignatures} signatures. Only the user\'s wallet may sign.`);
  if (tx.signatures.length !== msg.header.numRequiredSignatures) fail('SIGNATURE_COUNT_MISMATCH', 'The signature slots do not match the message header.');
  if (tx.signatures.some((s) => s.some((b) => b !== 0))) fail('PRESIGNED', 'The transaction already carries a signature.');
  if (lookups.length > exp.limits.maxLookupTables) fail('TOO_MANY_LOOKUP_TABLES', `${lookups.length} address lookup tables, at most ${exp.limits.maxLookupTables} allowed.`);
  if (ixs.length === 0) fail('NO_INSTRUCTIONS', 'The transaction has no instructions.');
  if (ixs.length > exp.limits.maxInstructions) fail('TOO_MANY_INSTRUCTIONS', `${ixs.length} instructions, at most ${exp.limits.maxInstructions} allowed.`);

  if (exp.resolvedLookupTables !== undefined && lookups.length > 0) {
    // Resolution never relaxes the table cap and never falls back to a partial key list.
    if (lookups.length > exp.limits.maxLookupTables) return done();
    const resolved = exp.resolvedLookupTables;
    summary.lookupContextSlot = resolved.slot;
    const invalid = validateLookupTables(lookups, resolved.tables);
    if (invalid.length) { reasons.push(...invalid); return done(); }
    try {
      if (msg.version !== 0) throw new Error();
      const full = msg.getAccountKeys({ addressLookupTableAccounts: resolved.tables });
      keys = Array.from({ length: full.length }, (_, i) => full.get(i)?.toBase58());
      summary.lookupTableDetails = lookups.map(l => {
        const t = resolved.tables.find(t => t.key.equals(l.accountKey))!;
        return { address: t.key.toBase58(), addressCount: t.state.addresses.length, authority: t.state.authority?.toBase58() ?? null };
      });
      summary.lookupAccounts = [];
      let index = staticCount;
      // Runtime order: ALL writable table entries first, then ALL readonly entries.
      for (const writable of [true, false]) for (const lookup of lookups) {
        for (const tableIndex of writable ? lookup.writableIndexes : lookup.readonlyIndexes) {
          summary.lookupAccounts.push({ index, address: keys[index]!, table: lookup.accountKey.toBase58(), tableIndex, writable });
          index++;
        }
      }
    } catch { fail('LOOKUP_TABLE_INVALID', 'The full message account list could not be resolved.'); return done(); }
  }

  const wsol = associatedTokenAddress(exp.userWallet, WSOL_MINT);
  const inAcct = associatedTokenAddress(exp.userWallet, exp.inputMint);
  const outAcct = associatedTokenAddress(exp.userWallet, exp.outputMint);
  summary.derived = { wsolAccount: wsol, inputAccount: inAcct, outputAccount: outAcct };
  const userTokenAccounts = new Set([wsol, inAcct, outAcct]);
  const allowedMints = new Set([WSOL_MINT, exp.inputMint, exp.outputMint]);

  // One object, because the instruction loop assigns these from inside a callback and TypeScript would otherwise narrow them to null.
  const st = { cuLimit: null as number | null, cuPrice: null as bigint | null, jupiterCount: 0, transferred: 0n };

  ixs.forEach((ix, i) => {
    const programId = keys[ix.programIdIndex];
    const at = `Instruction ${i + 1}`;
    if (ix.programIdIndex >= staticCount || programId === undefined) { fail('PROGRAM_NOT_STATIC', `${at} calls a program that is not in the transaction's own account list.`); summary.instructions.push({ program: 'unknown', kind: 'unresolved' }); return; }
    const program = PROGRAM_NAMES[programId];
    if (!program) { fail('PROGRAM_NOT_ALLOWED', `${at} calls ${programId}, which is not on the allow list.`); summary.instructions.push({ program: programId, kind: 'not-allowed' }); return; }

    const idx = [...ix.accountKeyIndexes];
    const allKnown = idx.every((n) => keys[n] !== undefined);
    const acct = (n: number) => keys[idx[n] ?? -1];
    const data = ix.data;
    const note = (kind: string, detail?: string) => summary.instructions.push({ program, kind, ...(detail ? { detail } : {}) });
    // Visibility is not permission: all the original address/authority/mint rules below still apply.
    // Without resolution, the original refusal and its message are preserved.
    const needKnown = () => { if (!allKnown) fail('ACCOUNT_NOT_STATIC', `${at} (${program}) names an account loaded from a lookup table, which cannot be verified.`); return allKnown; };

    switch (programId) {
      case COMPUTE_BUDGET_PROGRAM: {
        const tag = data[0];
        if (tag === 2 && u32(data, 1) !== null) {
          if (st.cuLimit !== null) fail('DUPLICATE_COMPUTE_LIMIT', 'More than one compute unit limit.');
          st.cuLimit = u32(data, 1);
          note('set-compute-unit-limit', String(st.cuLimit));
          if ((st.cuLimit ?? 0) > exp.limits.maxComputeUnits) fail('COMPUTE_LIMIT_TOO_HIGH', `Compute unit limit ${st.cuLimit} is above ${exp.limits.maxComputeUnits}.`);
        } else if (tag === 3 && u64(data, 1) !== null) {
          if (st.cuPrice !== null) fail('DUPLICATE_COMPUTE_PRICE', 'More than one compute unit price.');
          st.cuPrice = u64(data, 1);
          note('set-compute-unit-price', String(st.cuPrice));
        } else if (tag === 4 && u32(data, 1) !== null) {
          note('set-loaded-accounts-data-size-limit', String(u32(data, 1)));
        } else {
          note('other', `tag ${tag}`);
          fail('COMPUTE_BUDGET_INSTRUCTION_NOT_ALLOWED', `${at} is a compute budget instruction that is not allowed (tag ${tag}).`);
        }
        return;
      }

      case SYSTEM_PROGRAM: {
        const tag = u32(data, 0);
        if (tag === 2 && needKnown()) { // Transfer
          const lamports = u64(data, 4);
          const from = acct(0); const to = acct(1);
          note('transfer', `${lamports ?? '?'} lamports to ${to ?? '?'}`);
          if (lamports === null || idx.length !== 2) { fail('SYSTEM_TRANSFER_MALFORMED', `${at} is a malformed transfer.`); return; }
          if (from !== exp.userWallet) fail('SYSTEM_TRANSFER_FROM_OTHER', `${at} moves SOL from an account that is not the user's wallet.`);
          if (to !== wsol) fail('SYSTEM_TRANSFER_TO_OTHER', `${at} sends SOL to ${to}, which is not the user's own wrapped SOL account.`);
          st.transferred += lamports;
        } else if (tag !== 2) {
          note('other', `tag ${tag}`);
          fail('SYSTEM_INSTRUCTION_NOT_ALLOWED', `${at} is a System program instruction that is not allowed (tag ${tag}). Only transfers to the user's own wrapped SOL account are.`);
        } else note('transfer');
        return;
      }

      case TOKEN_PROGRAM: {
        const tag = data[0];
        if (!needKnown()) { note('unverifiable'); return; }
        if (tag === 17) { // SyncNative
          note('sync-native', acct(0));
          if (acct(0) !== wsol) fail('SYNC_NATIVE_OTHER', `${at} syncs an account that is not the user's wrapped SOL account.`);
        } else if (tag === 9) { // CloseAccount: [account, destination, owner]
          note('close-account', `${acct(0)} to ${acct(1)}`);
          if (!userTokenAccounts.has(acct(0) ?? '')) fail('CLOSE_OTHER_ACCOUNT', `${at} closes an account that is not one of the user's own token accounts.`);
          if (acct(1) !== exp.userWallet) fail('CLOSE_TO_OTHER', `${at} sends the closed account's SOL to ${acct(1)}, not the user's wallet.`);
          if (acct(2) !== exp.userWallet) fail('CLOSE_OTHER_AUTHORITY', `${at} closes an account under an authority that is not the user's wallet.`);
        } else {
          note('other', `tag ${tag}`);
          fail('TOKEN_INSTRUCTION_NOT_ALLOWED', `${at} is a Token program instruction that is not allowed (tag ${tag}). Approve, SetAuthority, Transfer, Burn, Freeze and the rest are refused.`);
        }
        return;
      }

      case ASSOCIATED_TOKEN_PROGRAM: {
        // [payer, ata, owner, mint, system program, token program]. Empty data is the legacy Create.
        const tag = data.length === 0 ? 0 : data[0];
        if (!needKnown()) { note('unverifiable'); return; }
        if (tag === 0 || tag === 1) {
          note(tag === 0 ? 'create-ata' : 'create-ata-idempotent', `${acct(1)} for ${acct(2)}, mint ${acct(3)}`);
          if (acct(0) !== exp.userWallet) fail('ATA_PAYER_OTHER', `${at} creates a token account paid by someone other than the user.`);
          if (acct(2) !== exp.userWallet) fail('ATA_OWNER_OTHER', `${at} creates a token account owned by ${acct(2)}, not the user.`);
          if (!allowedMints.has(acct(3) ?? '')) fail('ATA_MINT_UNEXPECTED', `${at} creates a token account for ${acct(3)}, which is not a mint in this swap.`);
          else if (acct(1) !== associatedTokenAddress(exp.userWallet, acct(3)!)) fail('ATA_ADDRESS_MISMATCH', `${at} names a token account address that is not the user's associated account for that mint.`);
          if (acct(5) !== TOKEN_PROGRAM) fail('ATA_TOKEN_PROGRAM_OTHER', `${at} creates a token account under a program other than the classic Token program.`);
        } else {
          note('other', `tag ${tag}`);
          fail('ATA_INSTRUCTION_NOT_ALLOWED', `${at} is an Associated Token instruction that is not allowed (tag ${tag}).`);
        }
        return;
      }

      case JUPITER_V6_PROGRAM: {
        st.jupiterCount++;
        note('swap', `${idx.length} accounts`);
        // The route itself is opaque. The user's wallet must be among its accounts and must be the one that signs.
        if (!idx.some((n) => keys[n] === exp.userWallet)) fail('JUPITER_WITHOUT_USER', `${at} is a Jupiter instruction that does not involve the user's wallet.`);
        return;
      }
    }
  });

  if (st.jupiterCount !== 1) fail('JUPITER_INSTRUCTION_COUNT', `Expected exactly one Jupiter swap instruction, found ${st.jupiterCount}.`);

  const maxIn = (exp.side === 'BUY' ? exp.inAmount : 0n) + exp.limits.maxOverheadLamports;
  if (st.transferred > maxIn) fail('TRANSFER_EXCEEDS_INPUT', `The transaction wraps ${st.transferred} lamports, more than the swap input plus the allowed overhead (${maxIn}).`);

  if (st.cuPrice !== null) {
    const limit = BigInt(st.cuLimit ?? exp.limits.maxComputeUnits); // no explicit limit: assume the largest, so the fee estimate is the worst case
    const fee = (limit * st.cuPrice + 999_999n) / 1_000_000n;
    summary.priorityFeeLamports = fee.toString();
    summary.computeUnitPrice = st.cuPrice.toString();
    if (fee > exp.limits.maxPriorityFeeLamports) fail('PRIORITY_FEE_TOO_HIGH', `The priority fee would be up to ${fee} lamports, above ${exp.limits.maxPriorityFeeLamports}.`);
  }
  summary.computeUnitLimit = st.cuLimit;
  return done();
}

import { AddressLookupTableAccount, AddressLookupTableProgram, VersionedTransaction, type MessageAddressTableLookup } from '@solana/web3.js';
import { DEFAULT_TX_LIMITS, type Reason, type TxLimits } from './verify';
import type { RawAccount } from './simulation';

/** Trusted RPC evidence, not data supplied by the swap builder. The slot is informational only. */
export interface ResolvedLookupTables {
  tables: AddressLookupTableAccount[];
  slot: number | null;
}

/** Structural port keeps the resolver independent of a concrete client, database or environment. */
export interface LookupTableRpc {
  getAccountsWithContext(addresses: string[]): Promise<{ slot: number; accounts: (RawAccount | null)[] }>;
}

export type LookupResolution =
  | { ok: true; reasons: []; resolved: ResolvedLookupTables }
  | { ok: false; reasons: Reason[]; slot: number | null };

/** Also used by the pure verifier so missing, stale or partial caller-supplied resolutions fail closed. */
export function validateLookupTables(lookups: MessageAddressTableLookup[], tables: AddressLookupTableAccount[]): Reason[] {
  const reasons: Reason[] = [];
  const fail = (code: string, message: string) => reasons.push({ code, message });
  const provided = new Map(tables.map(t => [t.key.toBase58(), t]));
  if (provided.size !== tables.length || tables.some(t => !lookups.some(l => l.accountKey.equals(t.key)))) {
    fail('LOOKUP_TABLE_INVALID', 'Resolved tables contain duplicate or unexpected table addresses.');
  }
  for (const lookup of lookups) {
    const address = lookup.accountKey.toBase58();
    const table = provided.get(address);
    if (!table) { fail('LOOKUP_TABLE_UNRESOLVED', `Lookup table ${address} is missing.`); continue; }
    // Reject even during deactivation cooldown; no clock or current-slot acceptance rule.
    if (!table.isActive() || table.state.addresses.length > 256 || table.state.lastExtendedSlotStartIndex > table.state.addresses.length) {
      fail('LOOKUP_TABLE_INVALID', `Lookup table ${address} is deactivated or has invalid state.`);
    }
    for (const index of [...lookup.writableIndexes, ...lookup.readonlyIndexes]) {
      if (!Number.isInteger(index) || index < 0 || index >= table.state.addresses.length) {
        fail('LOOKUP_INDEX_OUT_OF_RANGE', `Lookup table ${address} has no address at index ${index}.`);
      }
    }
  }
  return reasons;
}

/** Fetch once at confirmed commitment through the RPC port. Never return partial resolution or provider error text. */
export async function resolveLookupTables(base64Tx: string, rpc: LookupTableRpc, limits: Pick<TxLimits, 'maxLookupTables'> = DEFAULT_TX_LIMITS): Promise<LookupResolution> {
  const failed = (code: string, message: string, slot: number | null = null): LookupResolution => ({ ok: false, reasons: [{ code, message }], slot });
  let tx: VersionedTransaction;
  try {
    if (!base64Tx || base64Tx.length > 1644 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Tx)) throw new Error();
    const bytes = Buffer.from(base64Tx, 'base64');
    if (bytes.length > 1232) throw new Error();
    tx = VersionedTransaction.deserialize(bytes);
  } catch { return failed('UNDECODABLE', 'The transaction could not be decoded within the transaction size limit.'); }
  const lookups = tx.message.addressTableLookups;
  if (lookups.length > limits.maxLookupTables) return failed('TOO_MANY_LOOKUP_TABLES', `${lookups.length} address lookup tables, at most ${limits.maxLookupTables} allowed.`);
  if (lookups.length === 0) return { ok: true, reasons: [], resolved: { tables: [], slot: null } };
  let read: Awaited<ReturnType<LookupTableRpc['getAccountsWithContext']>>;
  try { read = await rpc.getAccountsWithContext(lookups.map(l => l.accountKey.toBase58())); }
  catch { return failed('LOOKUP_TABLE_UNRESOLVED', 'The RPC lookup-table read failed.'); }
  if (read.accounts.length !== lookups.length) return failed('LOOKUP_TABLE_UNRESOLVED', 'The RPC returned the wrong number of lookup-table accounts.', read.slot);
  const tables: AddressLookupTableAccount[] = [];
  const reasons: Reason[] = [];
  lookups.forEach((lookup, i) => {
    const account = read.accounts[i];
    const address = lookup.accountKey.toBase58();
    if (!account) { reasons.push({ code: 'LOOKUP_TABLE_UNRESOLVED', message: `Lookup table ${address} does not exist.` }); return; }
    try {
      if (account.owner !== AddressLookupTableProgram.programId.toBase58()) throw new Error();
      // Bound and require canonical base64 before letting the SDK deserialize the layout.
      const data = Buffer.from(account.data, 'base64');
      if (data.length > 56 + 256 * 32 || data.toString('base64') !== account.data) throw new Error();
      const table = new AddressLookupTableAccount({ key: lookup.accountKey, state: AddressLookupTableAccount.deserialize(data) });
      if (!table.isActive()) throw new Error();
      tables.push(table);
    } catch { reasons.push({ code: 'LOOKUP_TABLE_INVALID', message: `Lookup table ${address} has the wrong owner, malformed state, or is deactivated.` }); }
  });
  if (reasons.length) return { ok: false, reasons, slot: read.slot };
  reasons.push(...validateLookupTables(lookups, tables));
  if (reasons.length) return { ok: false, reasons, slot: read.slot };
  return { ok: true, reasons: [], resolved: { tables, slot: read.slot } };
}

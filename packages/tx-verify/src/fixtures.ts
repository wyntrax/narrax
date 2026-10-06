import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM, JUPITER_V6_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WSOL_MINT, associatedTokenAddress } from './programs';

/**
 * Builders for test transactions. Test-only: the Keypair here makes throwaway addresses so fixtures are valid base58.
 * No key in this file signs anything. This module is not exported from the package index.
 */
export const newAddress = () => Keypair.generate().publicKey.toBase58();
const pk = (s: string) => new PublicKey(s);

export const ix = (programId: string, keys: { pubkey: string; signer?: boolean; writable?: boolean }[], data: number[] | Buffer = []) =>
  new TransactionInstruction({ programId: pk(programId), keys: keys.map((k) => ({ pubkey: pk(k.pubkey), isSigner: !!k.signer, isWritable: k.writable ?? true })), data: Buffer.from(data) });

export const ataCreateIdempotent = (payer: string, owner: string, mint: string, ata: string = associatedTokenAddress(owner, mint)) =>
  ix(ASSOCIATED_TOKEN_PROGRAM, [{ pubkey: payer, signer: true }, { pubkey: ata }, { pubkey: owner, writable: false }, { pubkey: mint, writable: false }, { pubkey: SYSTEM_PROGRAM, writable: false }, { pubkey: TOKEN_PROGRAM, writable: false }], [1]);

export const syncNative = (account: string) => ix(TOKEN_PROGRAM, [{ pubkey: account }], [17]);
export const closeAccount = (account: string, destination: string, owner: string) => ix(TOKEN_PROGRAM, [{ pubkey: account }, { pubkey: destination }, { pubkey: owner, signer: true, writable: false }], [9]);
export const tokenIx = (tag: number, keys: { pubkey: string; signer?: boolean; writable?: boolean }[]) => ix(TOKEN_PROGRAM, keys, [tag]);
export const transfer = (from: string, to: string, lamports: bigint | number) => SystemProgram.transfer({ fromPubkey: pk(from), toPubkey: pk(to), lamports });
export const jupiterSwap = (user: string) => ix(JUPITER_V6_PROGRAM, [{ pubkey: user, signer: true }, { pubkey: newAddress() }, { pubkey: newAddress(), writable: false }], [229, 23, 203, 151, 122, 227, 173, 42, 1, 2, 3, 4]);

export interface Honest { user: string; mint: string; instructions: TransactionInstruction[] }

/** What Jupiter returns for a SOL to token buy, shaped as the verifier expects. UNVERIFIED against a live response. */
export function honestBuy(user: string, mint: string, lamports: bigint | number = 10_000_000n): Honest {
  const wsol = associatedTokenAddress(user, WSOL_MINT);
  return {
    user, mint,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ataCreateIdempotent(user, user, WSOL_MINT),
      transfer(user, wsol, lamports),
      syncNative(wsol),
      ataCreateIdempotent(user, user, mint),
      jupiterSwap(user),
      closeAccount(wsol, user, user),
    ],
  };
}

/** A token to SOL sell. */
export function honestSell(user: string, mint: string): Honest {
  const wsol = associatedTokenAddress(user, WSOL_MINT);
  return {
    user, mint,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ataCreateIdempotent(user, user, WSOL_MINT),
      jupiterSwap(user),
      closeAccount(wsol, user, user),
    ],
  };
}

export function toBase64(payer: string, instructions: TransactionInstruction[], opts: { lookupTables?: AddressLookupTableAccount[]; legacy?: boolean; presign?: boolean } = {}): string {
  const msg = new TransactionMessage({ payerKey: pk(payer), recentBlockhash: newAddress(), instructions });
  const tx = new VersionedTransaction(opts.legacy ? msg.compileToLegacyMessage() : msg.compileToV0Message(opts.lookupTables ?? []));
  if (opts.presign) tx.signatures[0] = Uint8Array.from({ length: 64 }, () => 7);
  return Buffer.from(tx.serialize()).toString('base64');
}

export const lookupTable = (addresses: string[]) => new AddressLookupTableAccount({
  key: pk(newAddress()),
  state: { deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: addresses.map(pk) },
});

import type { PrismaClient } from '@narra/database';
import type { ParsedTx, SolanaRpc } from '@narra/solana';
import { isSolanaAddress } from '@narra/shared';
import { oldestSignatures } from './walletFunding';

export interface DeveloperHolding {
  wallet: string;
  holdingPct: number;
  signature: string;
  source: 'INITIAL_MINT_AUTHORITY';
}
export interface DeveloperHoldingSource { getHolding(mint: string): Promise<DeveloperHolding | null> }
type Rpc = Pick<SolanaRpc, 'getSignaturesForAddress' | 'getParsedTransaction' | 'getTokenSupplyRaw' | 'getTokenBaseUnits'>;

/** Original issuing wallet, not a guessed fee payer. PDA authorities and unrelated signers are deliberately excluded. */
export function initialIssuingWallet(tx: ParsedTx, mint: string): string | null {
  if (!tx.meta || tx.meta.err != null) return null;
  const signers = new Set(tx.transaction.message.accountKeys.flatMap(key => typeof key !== 'string' && key.signer === true ? [key.pubkey] : []));
  const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(i => i.instructions)];
  for (const item of instructions) {
    const ix = item as { programId?: string; parsed?: { type?: string; info?: { mint?: string; mintAuthority?: string } } } | null;
    if (!ix || !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(ix.programId ?? '')) continue;
    if (!['initializeMint','initializeMint2'].includes(ix.parsed?.type ?? '') || ix.parsed?.info?.mint !== mint) continue;
    const authority = ix.parsed.info.mintAuthority;
    if (authority && isSolanaAddress(authority) && signers.has(authority)) return authority;
  }
  return null;
}

/** Bounded history lookup; negative results are cached for a day. Current balances are refreshed on every positive lookup. */
export function makeDeveloperHoldingSource(db: PrismaClient, rpc: Rpc): DeveloperHoldingSource {
  return { async getHolding(mint) {
    const key = `research.developer.${mint}`;
    const row = await db.systemSetting.findUnique({ where: { key } });
    const cache = row?.value as { wallet?: string; signature?: string; checkedAt?: string } | null;
    let wallet = cache?.wallet, signature = cache?.signature;
    if (!wallet || !signature) {
      if (cache?.checkedAt && Date.now() - Date.parse(cache.checkedAt) < 86_400_000) return null;
      const { oldestFirst, complete } = await oldestSignatures(rpc, mint, 2, 1000);
      if (complete) for (const sig of oldestFirst.slice(0, 10)) {
        const tx = await rpc.getParsedTransaction(sig);
        const found = tx && initialIssuingWallet(tx, mint);
        if (found) { wallet = found; signature = sig; break; }
      }
      const value = { wallet: wallet ?? null, signature: signature ?? null, source: 'INITIAL_MINT_AUTHORITY', checkedAt: new Date().toISOString() };
      await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    if (!wallet || !signature) return null;
    const [balance, supply] = await Promise.all([rpc.getTokenBaseUnits(wallet, mint), rpc.getTokenSupplyRaw(mint)]);
    if (supply <= 0n || balance > supply) return null;
    return { wallet, signature, source: 'INITIAL_MINT_AUTHORITY', holdingPct: Number(balance * 1_000_000n / supply) / 10_000 };
  } };
}

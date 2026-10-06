import { PublicKey } from '@solana/web3.js';

/** Well-known program and mint addresses. Confirm each against the Solana and Jupiter docs when you review this package. */
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const JUPITER_V6_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * The only programs a swap transaction may invoke at its top level. Anything else rejects the trade.
 * Jupiter calls the DEX programs itself (inside its own instruction), so they do not appear here.
 * Every other program, including Memo and the Jito tip transfer (a System transfer), is refused in B5a.
 */
export const PROGRAM_NAMES: Record<string, string> = {
  [SYSTEM_PROGRAM]: 'system',
  [TOKEN_PROGRAM]: 'token',
  [ASSOCIATED_TOKEN_PROGRAM]: 'associated-token',
  [COMPUTE_BUDGET_PROGRAM]: 'compute-budget',
  [JUPITER_V6_PROGRAM]: 'jupiter-v6',
};

/** The associated token account address for an owner and mint, under the classic Token program. */
export function associatedTokenAddress(owner: string, mint: string): string {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM),
  );
  return address.toBase58();
}

export const isBase58Address = (s: string): boolean => {
  try { return new PublicKey(s).toBase58() === s; } catch { return false; }
};

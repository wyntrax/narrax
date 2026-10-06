import type { PrismaClient } from '@narra/database';
import { WSOL_MINT, type JupiterClient, type SolanaRpc } from '@narra/solana';
import { MissingInputError, type ChainPorts } from './prismaStores';

const LAMPORTS = 1_000_000_000;

/**
 * Real implementations of the chain inputs the Risk Governor needs.
 * Any failure throws. A missing balance or price is never replaced by a default.
 */
export function makeChainPorts(deps: {
  db: PrismaClient;
  rpc: Pick<SolanaRpc, 'getBalanceLamports' | 'getTokenBaseUnits'>;
  jupiter: Pick<JupiterClient, 'getQuote'>;
}): ChainPorts {
  const { db, rpc, jupiter } = deps;
  return {
    async getSolBalance(address) {
      return Number(await rpc.getBalanceLamports(address)) / LAMPORTS;
    },

    async getTokenBaseUnits(address, mint) {
      const amount = await rpc.getTokenBaseUnits(address, mint);
      return amount > 0n ? amount.toString() : null;
    },

    /** SOL balance plus what each open position would fetch if sold now, using a real quote per position. */
    async getPortfolioValueSol(userId) {
      const wallet = await db.wallet.findFirst({ where: { userId, kind: 'TRADING' }, select: { address: true } });
      if (!wallet) throw new MissingInputError('User has no trading wallet');
      const positions = await db.position.findMany({ where: { userId, status: 'OPEN' }, select: { token: { select: { mint: true } } } });

      let lamports = await rpc.getBalanceLamports(wallet.address);
      const mints = [...new Set(positions.map((p) => p.token.mint))];
      const values = await Promise.all(mints.map(async (mint) => {
        const held = await rpc.getTokenBaseUnits(wallet.address, mint);
        if (held === 0n) return 0n;
        const q = await jupiter.getQuote({ inputMint: mint, outputMint: WSOL_MINT, amount: held, slippageBps: 100 });
        return BigInt(q.outAmount);
      }));
      for (const v of values) lamports += v;
      return Number(lamports) / LAMPORTS;
    },
  };
}

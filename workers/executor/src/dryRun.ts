import type { Prisma, PrismaClient } from '@narra/database';
import { VersionedTransaction } from '@solana/web3.js';
import { sanitizeUntrusted } from '@narra/shared';
import { QuoteError, RpcError, WSOL_MINT as SOL_MINT, type JupiterClient, type SolanaRpc } from '@narra/solana';
import {
  TOKEN_PROGRAM, resolveLookupTables, verifySimulation, verifySwapTransaction, type Reason, type RawAccount,
} from '@narra/tx-verify';
import type { DryRunner, DryRunSummary } from '@narra/worker-pipeline';
import type { ExecutorConfig } from './config';
import { preflight } from './preflight';

const LAMPORTS = 1_000_000_000;

export interface DryRunDeps {
  db: PrismaClient;
  jupiter: Pick<JupiterClient, 'buildSwap'>;
  rpc: Pick<SolanaRpc, 'getAccounts' | 'getAccountsWithContext' | 'simulateTransaction' | 'getMintInfo'>;
  config: ExecutorConfig;
  now?: () => Date;
}

const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';
const text = (s: unknown, n = 200) => sanitizeUntrusted(String(s), n);
const toRaw = (a: { lamports: number; owner: string; data: string } | null): RawAccount | null => a;

/**
 * B5a executor: runs every step an Executor would run, up to but NOT including signing, and records what it found.
 *
 *   preflight (kill switch, permission, mode, wallet, caps) -> token policy -> build swap -> verify transaction
 *   -> read balances -> simulate -> verify the simulated effects -> record
 *
 * It holds no signing capability, has no code path that sends, and never writes an Order, Trade or Position. The only thing
 * it writes is a DryRun row (one per idempotency key) and an audit row. A failure at any step is a REJECTED or ERROR record,
 * never a thrown error that could be retried into a different result.
 */
export function makeDryRunner(deps: DryRunDeps): DryRunner {
  const { db, jupiter, rpc, config } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async run({ job, sizeSol, quote, result }) {
      // Only the users on the canary list. Everyone else ends as execution_disabled, as before.
      if (!config.allowlist.has(job.userId)) return null;

      const existing = await db.dryRun.findUnique({ where: { idempotencyKey: job.idempotencyKey } });
      if (existing) return summarize(existing);

      const isEntry = job.decision.action === 'BUY';
      const side = isEntry ? 'BUY' : 'SELL';
      const reasons: Reason[] = [];
      let summary: Record<string, unknown> = {};
      let simulation: Record<string, unknown> | null = null;
      let messageHash: string | null = null;
      // For an entry: the SOL spent. For an exit: what the quote says comes back.
      const shownSizeSol = isEntry ? sizeSol : Number(quote.outAmount) / LAMPORTS;

      const record = async (outcome: 'ACCEPTED' | 'REJECTED' | 'ERROR'): Promise<DryRunSummary> => {
        const data = {
          userId: job.userId, idempotencyKey: job.idempotencyKey, confirmationId: job.confirmationId ?? null, side: side as 'BUY' | 'SELL', mint: job.mint,
          sizeSol: Number.isFinite(shownSizeSol) ? shownSizeSol : null, outcome, reasons: reasons as unknown as Prisma.InputJsonValue,
          summary: summary as Prisma.InputJsonValue, simulation: (simulation ?? undefined) as Prisma.InputJsonValue | undefined, messageHash, createdAt: now(),
        };
        try {
          const row = await db.dryRun.create({ data });
          await db.auditLog.create({ data: { userId: job.userId, action: 'executor.dry_run', detail: { id: row.id, outcome, codes: reasons.map((r) => r.code), side, messageHash } } });
          return summarize(row);
        } catch (e) {
          if (!isUnique(e)) throw e;
          // A redelivered job raced us. Report the row that won.
          return summarize(await db.dryRun.findUniqueOrThrow({ where: { idempotencyKey: job.idempotencyKey } }));
        }
      };

      try {
        // 1. Everything that can change between queueing and now is read again.
        const pre = await preflight(db, job, sizeSol, isEntry, config, now());
        if (!pre.ok) { reasons.push(...pre.reasons); return await record('REJECTED'); }
        const wallet = pre.wallet;

        // The quote must be for the mints and amount this order is about. A mismatch is a bug somewhere upstream: stop.
        const inputMint = isEntry ? SOL_MINT : job.mint;
        const outputMint = isEntry ? job.mint : SOL_MINT;
        if (quote.inputMint !== inputMint || quote.outputMint !== outputMint) reasons.push({ code: 'QUOTE_MINT_MISMATCH', message: 'The quote is not for the mints of this order.' });
        if (isEntry && BigInt(quote.inAmount) !== BigInt(Math.floor(result.sizeSol * LAMPORTS))) reasons.push({ code: 'QUOTE_AMOUNT_MISMATCH', message: 'The quote amount is not the amount the Risk Governor approved.' });
        if (!quote.otherAmountThreshold || !/^\d+$/.test(quote.otherAmountThreshold) || BigInt(quote.otherAmountThreshold) <= 0n) reasons.push({ code: 'NO_QUOTE_MINIMUM', message: 'The quote carries no minimum output, so the result of the swap cannot be checked.' });
        if (reasons.length) return await record('REJECTED');

        // 2. Token policy (approved decision D6). Applies to buying. Selling a token the user already holds is never refused for
        // its authorities: refusing the exit would trap the user, so for exits the flags are recorded and nothing more.
        const mintInfo = await rpc.getMintInfo(job.mint);
        summary = { policy: { mintProgram: mintInfo.program, freezeAuthority: mintInfo.freezeAuthority !== null, mintAuthority: mintInfo.mintAuthority !== null, hasExtensions: mintInfo.hasExtensions, appliedTo: isEntry ? 'entry' : 'recorded only (exit)' } };
        if (isEntry) {
          if (mintInfo.program !== TOKEN_PROGRAM) reasons.push({ code: 'TOKEN_PROGRAM_NOT_CLASSIC', message: 'The token is not under the classic Token program (for example Token-2022), which this build refuses.' });
          if (mintInfo.freezeAuthority !== null) reasons.push({ code: 'TOKEN_HAS_FREEZE_AUTHORITY', message: 'The token has a freeze authority, so the issuer can freeze the user\'s tokens.' });
          if (mintInfo.hasExtensions) reasons.push({ code: 'TOKEN_HAS_EXTENSIONS', message: 'The token has mint extensions (such as transfer fees or a permanent delegate).' });
          if (reasons.length) return await record('REJECTED');
        }

        // 3. Build the swap and look at it before anything else.
        const built = await jupiter.buildSwap({ quote, userPublicKey: wallet, maxPriorityFeeLamports: Number(config.limits.maxPriorityFeeLamports) });
        // Decode only to detect tables. Undecodable input still reaches the pure verifier's original refusal.
        let tableAddresses: string[] = [];
        try {
          if (built.transactionBase64.length <= 1644) tableAddresses = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, 'base64')).message.addressTableLookups.map(l => l.accountKey.toBase58());
        } catch { /* verifySwapTransaction records UNDECODABLE below */ }
        const slots = { lookupResolution: null as number | null, preSimulation: null as number | null, simulation: null as number | null };
        summary = { ...summary, slots, lookupTableAddresses: tableAddresses, lastValidBlockHeight: built.lastValidBlockHeight, quote: { inAmount: quote.inAmount, outAmount: quote.outAmount, minOut: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct, slippageBps: quote.slippageBps, fetchedAt: quote.fetchedAt.toISOString() } };
        const resolution = tableAddresses.length ? await resolveLookupTables(built.transactionBase64, rpc, config.limits) : undefined;
        if (resolution) {
          slots.lookupResolution = resolution.ok ? resolution.resolved.slot : resolution.slot;
          if (!resolution.ok) { reasons.push(...resolution.reasons); return await record('REJECTED'); }
        }
        const verdict = verifySwapTransaction(built.transactionBase64, { userWallet: wallet, side, inputMint, outputMint, inAmount: BigInt(quote.inAmount), limits: config.limits, ...(resolution?.ok ? { resolvedLookupTables: resolution.resolved } : {}) });
        messageHash = verdict.summary.messageHash;
        summary = { ...summary, transaction: verdict.summary, lastValidBlockHeight: built.lastValidBlockHeight, quote: { inAmount: quote.inAmount, outAmount: quote.outAmount, minOut: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct, slippageBps: quote.slippageBps, fetchedAt: quote.fetchedAt.toISOString() } };
        reasons.push(...verdict.reasons);
        if (!verdict.ok || !verdict.summary.derived) return await record('REJECTED'); // a transaction we refuse is not worth simulating

        // 4. Simulate, and check what it would do to the user's balances.
        const d = verdict.summary.derived;
        const addresses = [wallet, d.inputAccount, d.outputAccount];
        const preAccounts = await rpc.getAccountsWithContext(addresses);
        const before = preAccounts.accounts;
        slots.preSimulation = preAccounts.slot;
        const sim = await rpc.simulateTransaction(built.transactionBase64, addresses);
        slots.simulation = sim.slot ?? null;
        const effect = verifySimulation(
          { err: sim.err, unitsConsumed: sim.unitsConsumed, pre: { wallet: toRaw(before[0] ?? null), inputAccount: toRaw(before[1] ?? null), outputAccount: toRaw(before[2] ?? null) }, post: { wallet: toRaw(sim.accounts[0] ?? null), inputAccount: toRaw(sim.accounts[1] ?? null), outputAccount: toRaw(sim.accounts[2] ?? null) } },
          { side, inAmount: BigInt(quote.inAmount), minOutAmount: BigInt(quote.otherAmountThreshold!), maxOverheadLamports: config.limits.maxOverheadLamports, maxComputeUnits: config.limits.maxComputeUnits },
        );
        // Program logs are text from programs we do not control. Keep a few, cleaned.
        simulation = { ...effect.summary, logs: sim.logs.slice(0, 8).map((l) => text(l, 160)) };
        reasons.push(...effect.reasons);

        // 5. The same limits the real executor will use, applied to what the simulation shows.
        const elapsed = now().getTime() - quote.fetchedAt.getTime();
        summary = { ...summary, elapsedMsQuoteToSimulation: elapsed };
        if (elapsed > config.broadcastWindowMs) reasons.push({ code: 'QUOTE_TO_SIMULATION_WINDOW', message: `The quote was ${elapsed} ms old when the simulation finished, above the ${config.broadcastWindowMs} ms window.` });
        if (isEntry && effect.summary.walletLamportsSpent !== null) {
          const ceiling = BigInt(Math.round(config.hardCapSol * LAMPORTS)) + config.limits.maxOverheadLamports;
          if (BigInt(effect.summary.walletLamportsSpent) > ceiling) reasons.push({ code: 'HARD_CAP_EXCEEDED_BY_SIMULATION', message: `The simulation shows the wallet losing ${effect.summary.walletLamportsSpent} lamports, above the hard cap plus overhead (${ceiling}).` });
        }

        return await record(reasons.length ? 'REJECTED' : 'ACCEPTED');
      } catch (e) {
        // A builder or node failure gives no verdict on the transaction. Record it as an error, never as an acceptance.
        const code = e instanceof QuoteError ? 'SWAP_BUILD_FAILED' : e instanceof RpcError ? 'RPC_FAILED' : 'UNEXPECTED';
        reasons.push({ code, message: text((e as Error)?.message ?? 'error') });
        return await record('ERROR');
      }
    },
  };
}

function summarize(row: { id: string; outcome: string; reasons: unknown }): DryRunSummary {
  const codes = Array.isArray(row.reasons) ? (row.reasons as { code?: unknown }[]).map((r) => String(r.code)) : [];
  return { id: row.id, outcome: row.outcome as DryRunSummary['outcome'], codes };
}

/**
 * Execution worker (B5a, dry run). It consumes the execution queue: paper fills, shadow logs and semi-auto confirmations are
 * handled here exactly as before, and an AUTO or confirmed order for an allow-listed user ends as a recorded DRY RUN.
 *
 * THIS PROCESS CANNOT SIGN OR SEND. It has no signing credential, no send code, and it refuses to start if one is present.
 * It makes no AI or narrative calls and exposes no HTTP port. Set HELIUS_RPC_URL for balances and simulation.
 */
import { Worker } from 'bullmq';
import { createPrisma } from '@narra/database';
import { ExecutionJobSchema, QUEUE_NAMES, createRedis } from '@narra/queue';
import { JupiterClient, SolanaRpc } from '@narra/solana';
import { makeChainPorts, makeExecutionStore, runExecution, type ChainPorts, type ExecutionDeps } from '@narra/worker-pipeline';
import { ConfigError, loadExecutorConfig } from './config';
import { makeDryRunner } from './dryRun';
import { assertEnv } from '@narra/shared';

// Environment names that would mean someone is trying to give this stage a key. B5a runs without any.
const FORBIDDEN_ENV = ['EXECUTOR_SIGNING_KEY', 'PRIVY_APP_SECRET', 'PRIVY_AUTHORIZATION_PRIVATE_KEY', 'PRIVY_AUTHORIZATION_KEY', 'WALLET_PRIVATE_KEY', 'SOLANA_PRIVATE_KEY'];

function start() {
  const present = FORBIDDEN_ENV.filter((n) => process.env[n]);
  if (present.length) throw new ConfigError(`B5a runs without a signing credential, but ${present.join(', ')} is set. Remove it from this process's environment.`);
  const config = loadExecutorConfig(process.env);

  const connection = createRedis();
  const db = createPrisma();
  const jupiter = new JupiterClient({ apiKey: process.env.JUPITER_API_KEY });
  const notWired = (name: string) => async (): Promise<never> => { throw new Error(`${name} needs HELIUS_RPC_URL`); };
  const rpc = process.env.HELIUS_RPC_URL ? new SolanaRpc({ url: process.env.HELIUS_RPC_URL, timeoutMs: 8000 }) : null;
  // Without an RPC URL the ports throw, so real-wallet jobs fail closed instead of guessing balances.
  const chain: ChainPorts = rpc
    ? makeChainPorts({ db, rpc, jupiter })
    : { getSolBalance: notWired('getSolBalance'), getPortfolioValueSol: notWired('getPortfolioValueSol'), getTokenBaseUnits: notWired('getTokenBaseUnits') };

  const execDeps: ExecutionDeps = {
    jupiter,
    ...makeExecutionStore(db, chain),
    // No `executor`: there is nothing that can sign. The dry runner is the furthest an order can go.
    ...(rpc ? { dryRunner: makeDryRunner({ db, jupiter, rpc, config }) } : {}),
  };
  const summarize = (o: { status: string; result: { route: string; sizeSol: number }; dryRun?: { outcome: string } }) => ({ status: o.status, route: o.result.route, sizeSol: o.result.sizeSol, ...(o.dryRun ? { dryRun: o.dryRun.outcome } : {}) });

  // Concurrency 1: two orders for the same user must never race on balance or exposure checks, and the confirm endpoint queues here too.
  const worker = new Worker(QUEUE_NAMES.execution, async (j) => JSON.stringify(summarize(await runExecution(db, ExecutionJobSchema.parse(j.data), execDeps))), { connection, concurrency: 1 });
  worker.on('failed', (job, err) => console.error(JSON.stringify({ msg: 'job_failed', queue: worker.name, id: job?.id, err: err.message })));

  const shutdown = async () => { await worker.close(); connection.disconnect(); await db.$disconnect(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log(JSON.stringify({ msg: 'executor started', mode: config.mode, canSign: false, allowlisted: config.allowlist.size, hardCapSol: config.hardCapSol, dailyCapSol: config.dailyCapSol, rpc: !!rpc }));
  if (!rpc) console.log('no HELIUS_RPC_URL: dry runs are off, real-wallet orders fail closed');
  if (!config.allowlist.size) console.log('EXECUTOR_ALLOWLIST_USER_IDS is empty: no order will be dry-run');
}

// Before anything connects: stop with a clear list of what is wrong. Messages never contain a value.
assertEnv('executor');

try { start(); } catch (e) {
  console.error(e instanceof ConfigError ? `executor not started: ${e.message}` : e);
  process.exit(1);
}

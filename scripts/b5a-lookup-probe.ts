/** Read-only chain experiment. No database, queue, key material, signing or sending. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { VersionedTransaction } from '@solana/web3.js';
import { JupiterClient, SolanaRpc, WSOL_MINT } from '@narra/solana';
import { TOKEN_PROGRAM, tokenAmountOf, resolveLookupTables, verifySimulation, verifySwapTransaction, type Reason, type RawAccount } from '@narra/tx-verify';
import { loadExecutorConfig } from '../workers/executor/src/config';

const env = { ...parse(readFileSync('.env')), ...process.env };
const wallet = 'puwWB6sLfi8xJZF9viHexhd81vLrw8EBpfLy8aG4QSH';
const config = loadExecutorConfig(env);
const diagnoseEffects = process.argv.includes('--diagnose-effects');
const resolvedEffects = process.argv.includes('--resolved-effects');
const captureEffects = diagnoseEffects || resolvedEffects;
const wireReads: { method: string; result: any }[] = [];
const captureFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const method = JSON.parse(String(init?.body)).method as string;
  if (captureEffects && ['getMultipleAccounts', 'simulateTransaction'].includes(method)) {
    wireReads.push({ method, result: (await response.clone().json()).result });
  }
  return response;
};
const rpc = new SolanaRpc({ url: env.HELIUS_RPC_URL!, timeoutMs: 15000, fetch: captureEffects ? captureFetch : undefined });
const jupiter = new JupiterClient({ apiKey: env.JUPITER_API_KEY }); // Existing host, timeouts and impact interpretation.
const secrets = Object.entries(env).filter(([k, v]) => v && /KEY|SECRET|PASSWORD|TOKEN|URL/.test(k)).map(([, v]) => v!);
const clean = (e: unknown) => secrets.reduce((s, v) => s.split(v).join('[REDACTED]'), e instanceof Error ? e.message : String(e));
const variants = [{ name: 'current', quote: {}, build: {} }, { name: 'legacy', quote: { asLegacyTransaction: true }, build: { asLegacyTransaction: true } }, { name: 'max32', quote: { maxAccounts: 32 }, build: {} }];
const fixturePath = 'packages/tx-verify/src/captured-fixtures.ts';
const rows: Record<string, unknown>[] = [];
const candidates: Record<string, unknown>[] = [];

function accountEvidence(account: RawAccount | null) {
  if (!account) return { exists: false, raw: null, tokenAmount: '0', explanation: 'null account' };
  const dataLength = Buffer.from(account.data, 'base64').length;
  const amount = tokenAmountOf(account);
  return { exists: true, raw: account, dataLength, tokenAmount: amount?.toString() ?? null,
    explanation: amount !== null ? 'readable amount or nonexistent account' : account.owner !== TOKEN_PROGRAM ? 'owner != Token program' : dataLength < 72 ? 'data < 72 bytes' : 'other',
    emptyZeroLamport: account.lamports === 0 && account.data === '' };
}

async function diagnosticRpc(method: string, params: unknown[]) {
  const response = await fetch(env.HELIUS_RPC_URL!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`Diagnostic ${method} failed`);
  return body.result;
}

async function json(url: string, authenticated = false): Promise<any> {
  const response = await fetch(url, { headers: authenticated ? { 'x-api-key': env.JUPITER_API_KEY! } : {}, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Public-source request returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  console.log('No database connections or writes. Simulation: sigVerify=false, replaceRecentBlockhash=false.');
  for (const wanted of [{ symbol: 'BONK', query: 'BONK' }, { symbol: '$WIF', query: 'dogwifhat' }]) {
    const source1 = `https://api.jup.ag/tokens/v2/search?query=${wanted.query}`;
    const tokens = await json(source1, true);
    const candidate = tokens.find((t: any) => t.isVerified && t.symbol?.toUpperCase() === wanted.symbol);
    if (!candidate) throw new Error(`Verified source missing for ${wanted.symbol}`);
    const mint: string = candidate.id;
    const source2 = `https://api.dexscreener.com/tokens/v1/solana/${mint}`;
    const pairs = await json(source2);
    if (!pairs.some((p: any) => p.chainId === 'solana' && p.baseToken.address === mint && p.baseToken.symbol.toUpperCase() === wanted.symbol)) throw new Error('Independent source mismatch');
    const policy = await rpc.getMintInfo(mint);
    const eligible = policy.program === TOKEN_PROGRAM && policy.freezeAuthority === null && !policy.hasExtensions;
    const evidence = { symbol: wanted.symbol, mint, sources: [source1, source2], policy, eligible };
    candidates.push(evidence); console.log(JSON.stringify(evidence));
    if (!eligible) continue;
    for (const variant of variants) {
      if (diagnoseEffects && variant.name !== 'legacy') continue;
      if (resolvedEffects && variant.name === 'max32') continue;
      let sellAmount: bigint | undefined;
      for (const side of ['BUY', 'SELL'] as const) {
        if (captureEffects && side !== 'BUY') continue;
        const row: Record<string, unknown> = { token: wanted.symbol, mint, variant: variant.name, side, route: false, simulation: null };
        rows.push(row);
        if (side === 'SELL' && sellAmount === undefined) { row.error = 'No paired BUY quote amount for SELL'; continue; }
        try {
          const quote = await jupiter.getQuote({ inputMint: side === 'BUY' ? WSOL_MINT : mint, outputMint: side === 'BUY' ? mint : WSOL_MINT, amount: side === 'BUY' ? 6325000n : sellAmount!, slippageBps: 100, ...variant.quote });
          if (side === 'BUY') sellAmount = BigInt(quote.outAmount);
          const plan = (quote.raw as { routePlan?: unknown[] }).routePlan;
          row.route = !!plan?.length;
          row.quote = { in: quote.inAmount, out: quote.outAmount, minOut: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct, slippageBps: quote.slippageBps, routePlan: plan };
          if (!row.route || quote.priceImpactPct > 1 || !quote.otherAmountThreshold || BigInt(quote.otherAmountThreshold) <= 0n) throw new Error('Route, impact, or quote minimum precondition failed');
          const built = await jupiter.buildSwap({ quote, userPublicKey: wallet, maxPriorityFeeLamports: Number(config.limits.maxPriorityFeeLamports), ...variant.build });
          const tx = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, 'base64'));
          const tables = tx.message.addressTableLookups;
          row.transaction = { version: tx.version, bytes: Buffer.from(built.transactionBase64, 'base64').length, within1232: Buffer.from(built.transactionBase64, 'base64').length <= 1232, instructions: tx.message.compiledInstructions.length, lookupTables: tables.length };
          const expectations = { userWallet: wallet, side, inputMint: quote.inputMint, outputMint: quote.outputMint, inAmount: BigInt(quote.inAmount), limits: config.limits };
          const resolution = resolvedEffects && tables.length ? await resolveLookupTables(built.transactionBase64, rpc, config.limits) : undefined;
          if (resolution && !resolution.ok) { row.resolution = resolution; continue; }
          const verdict = verifySwapTransaction(built.transactionBase64, { ...expectations, ...(resolution?.ok ? { resolvedLookupTables: resolution.resolved } : {}) });
          row.verifier = verdict;
          if (variant.name === 'current' && verdict.reasons.some(r => r.code === 'ACCOUNT_NOT_STATIC') && !existsSync(fixturePath)) {
            const addresses = tables.map(t => t.accountKey.toBase58());
            const raw = await rpc.getAccountsWithContext(addresses);
            const capture = { capturedAt: new Date().toISOString(), source: 'Live Jupiter swap/v1, current variant; raw Helius getMultipleAccounts confirmed', transactionBase64: built.transactionBase64, expectations: { ...expectations, inAmount: quote.inAmount, limits: undefined }, lookupAddresses: addresses, ...raw };
            // Generated bytes only: never normalize, reserialize, or hand-edit the captured transaction/table data.
            writeFileSync(fixturePath, '/** Captured fixture, generated by scripts/b5a-lookup-probe.ts. Public data only; NEVER hand-edit. */\nexport const capturedLookupFixture = ' + JSON.stringify(capture, null, 2) + ' as const;\n', { flag: 'wx' });
            row.fixture = fixturePath;
          }
          if (side === 'SELL') { row.simulationSkipped = 'Wallet holds no input token; verifier-only exit probe'; continue; }
          if (!verdict.ok || !verdict.summary.derived) { row.simulationSkipped = 'Verifier rejected'; continue; }
          // The same RPC calls, pure effect verifier and limits as makeDryRunner (no alternative simulation implementation).
          const d = verdict.summary.derived;
          const addresses = [wallet, d.inputAccount, d.outputAccount];
          wireReads.length = 0;
          const before = await rpc.getAccounts(addresses);
          const sim = await rpc.simulateTransaction(built.transactionBase64, addresses);
          const effect = verifySimulation({ err: sim.err, unitsConsumed: sim.unitsConsumed, pre: { wallet: before[0] ?? null, inputAccount: before[1] ?? null, outputAccount: before[2] ?? null }, post: { wallet: sim.accounts[0] ?? null, inputAccount: sim.accounts[1] ?? null, outputAccount: sim.accounts[2] ?? null } }, { side, inAmount: BigInt(quote.inAmount), minOutAmount: BigInt(quote.otherAmountThreshold), maxOverheadLamports: config.limits.maxOverheadLamports, maxComputeUnits: config.limits.maxComputeUnits });
          const reasons: Reason[] = [...effect.reasons];
          const elapsed = Date.now() - quote.fetchedAt.getTime();
          if (elapsed > config.broadcastWindowMs) reasons.push({ code: 'QUOTE_TO_SIMULATION_WINDOW', message: `Quote age ${elapsed} ms exceeds ${config.broadcastWindowMs} ms.` });
          const ceiling = BigInt(Math.round(config.hardCapSol * 1e9)) + config.limits.maxOverheadLamports;
          if (effect.summary.walletLamportsSpent !== null && BigInt(effect.summary.walletLamportsSpent) > ceiling) reasons.push({ code: 'HARD_CAP_EXCEEDED_BY_SIMULATION', message: `Wallet loss exceeds hard cap plus overhead (${ceiling}).` });
          row.simulation = { ok: reasons.length === 0, reasons, ...effect.summary, elapsedMsQuoteToSimulation: elapsed, rpcError: sim.err };
          if (captureEffects) {
            row.capture = {
              capturedAt: new Date().toISOString(), addresses, before, after: sim.accounts, wireReads: [...wireReads], logs: sim.logs,
              accountEvidence: { preWallet: accountEvidence(before[0] ?? null), postWallet: accountEvidence(sim.accounts[0] ?? null), preIn: accountEvidence(before[1] ?? null), postIn: accountEvidence(sim.accounts[1] ?? null), preOut: accountEvidence(before[2] ?? null), postOut: accountEvidence(sim.accounts[2] ?? null) },
            };
            // Read-only fee/rent evidence, after measuring the quote-to-simulation window.
            row.feeEvidence = {
              feeForMessage: await diagnosticRpc('getFeeForMessage', [Buffer.from(tx.message.serialize()).toString('base64'), { commitment: 'confirmed' }]),
              rentFor165Bytes: await diagnosticRpc('getMinimumBalanceForRentExemption', [165, { commitment: 'confirmed' }]),
            };
          }
        } catch (error) { row.error = clean(error); }
        finally { console.log(JSON.stringify(row)); }
      }
    }
  }
  console.table(rows.map(r => ({ token: r.token, variant: r.variant, side: r.side, route: r.route, transaction: JSON.stringify(r.transaction), verdict: (r.verifier as any)?.ok, codes: (r.verifier as any)?.reasons.map((x: Reason) => x.code).join(','), simulation: (r.simulation as any)?.ok, error: r.error })));
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0) writeFileSync(process.argv[outputIndex + 1]!, JSON.stringify({ capturedAt: new Date().toISOString(), candidates, rows }, null, 2), { flag: 'wx' });
  if (diagnoseEffects && process.argv.includes('--capture-effects-fixture')) {
    if (rows.length !== 2 || rows.some(r => !r.capture || r.error)) throw new Error('Incomplete diagnostic capture; fixture not written');
    writeFileSync('packages/tx-verify/src/captured-simulation-fixtures.ts', '/** Public RPC captures generated by b5a-lookup-probe.ts --diagnose-effects. Never hand-edit. */\nexport const capturedSimulationFixtures = ' + JSON.stringify(rows, null, 2) + ' as const;\n', { flag: 'wx' });
  }
}
main().catch(e => { console.error(clean(e)); process.exitCode = 1; });

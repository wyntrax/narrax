import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '@narra/agent';

/**
 * Structural guarantees for B5a, checked by reading the source. They exist so that "this stage cannot sign or send" is a
 * test result and not a promise. When B5b adds signing, these tests must be changed on purpose, in review, in that change.
 */
const ROOT = join(__dirname, '..', '..', '..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  if (n === 'node_modules' || n === 'dist') return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});
const src = (dir: string) => walk(join(ROOT, dir)).filter((f) => !/\.test\.ts$/.test(f) && !/fixtures\.ts$/.test(f)).map((f) => ({ file: relative(ROOT, f).split(sep).join('/'), text: readFileSync(f, 'utf8') })); // forward slashes on every platform: the main.ts exemption below compares against one
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // comments may describe what is forbidden

/** Calls and names that send, sign or hold a key. */
const SIGNING = [/sendTransaction/, /sendRawTransaction/, /sendAndConfirm/, /signTransaction/, /signAllTransactions/, /signMessage/, /(?<!\bMath)\.sign\(/, /\bKeypair\b/, /secretKey/, /fromSecretKey/, /privy-authorization-signature/i, /signAndSend/i, /sign-and-send/i, /advanced-swap/i, /PRIVATE_KEY/, /AUTHORIZATION_KEY/, /APP_SECRET/, /jito/i, /sendBundle/i];

describe('B5a isolation: nothing here can sign or send', () => {
  it('distinguishes numeric Math.sign from signing calls without exempting transaction signers',()=>{
    expect(SIGNING.some(re=>re.test('Math.sign(amount)'))).toBe(false);
    for(const source of ['tx.sign(key)', 'wallet.sign(key)', 'fakeMath.sign(key)', 'Keypair.fromSecretKey(bytes)']) expect(SIGNING.some(re=>re.test(source))).toBe(true);
  });
  it.each(['workers/executor/src', 'packages/tx-verify/src', 'packages/solana/src', 'packages/risk/src', 'packages/trading/src'])('%s contains no signing, sending or key handling', (dir) => {
    const hits: string[] = [];
    for (const f of src(dir)) {
      // main.ts names the forbidden env vars on purpose, to refuse to start when one is set.
      if (f.file.endsWith('workers/executor/src/main.ts')) continue;
      const body = strip(f.text);
      for (const re of SIGNING) if (re.test(body)) hits.push(`${f.file}: ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it('file paths are compared with forward slashes on every platform, and the main.ts exemption really applies to main.ts', () => {
    // Regression: on Windows, relative() returned backslashes, the exemption below never matched, and the three forbidden-variable
    // names that main.ts holds on purpose were reported as signing code.
    const files = src('workers/executor/src').map((f) => f.file);
    expect(files.filter((f) => f.includes('\\'))).toEqual([]);
    expect(files).toContain('workers/executor/src/main.ts');
  });

  it('the executor refuses to start when a signing credential is present in its environment', () => {
    const main = readFileSync(join(ROOT, 'workers/executor/src/main.ts'), 'utf8');
    expect(main).toMatch(/FORBIDDEN_ENV/);
    for (const n of ['EXECUTOR_SIGNING_KEY', 'PRIVY_APP_SECRET', 'PRIVY_AUTHORIZATION_PRIVATE_KEY', 'WALLET_PRIVATE_KEY', 'SOLANA_PRIVATE_KEY']) expect(main).toContain(n);
    expect(main).toMatch(/throw new ConfigError/);
  });

  it('the executor reads only the environment variables it is meant to read', () => {
    const allowed = new Set(['EXECUTOR_MODE', 'EXECUTOR_ALLOWLIST_USER_IDS', 'EXECUTOR_HARD_CAP_SOL', 'EXECUTOR_DAILY_CAP_SOL', 'EXECUTOR_MAX_OVERHEAD_SOL', 'EXECUTOR_MAX_PRIORITY_FEE_SOL', 'EXECUTOR_BROADCAST_WINDOW_MS', 'JUPITER_API_KEY', 'HELIUS_RPC_URL', 'DATABASE_URL', 'REDIS_URL']);
    const used = new Set<string>();
    for (const f of src('workers/executor/src')) for (const m of strip(f.text).matchAll(/(?:process\.env|env)\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]!);
    expect([...used].filter((n) => !allowed.has(n))).toEqual([]);
    expect(used.has('EXECUTOR_MODE')).toBe(true);
  });

  it('the dry runner never writes an order, trade or position', () => {
    const body = strip(readFileSync(join(ROOT, 'workers/executor/src/dryRun.ts'), 'utf8')) + strip(readFileSync(join(ROOT, 'workers/executor/src/preflight.ts'), 'utf8'));
    expect(body).not.toMatch(/\.(order|trade|position|executionAttempt|pendingConfirmation)\.(create|update|upsert|delete)/);
    expect(body).not.toMatch(/\$transaction/);
    expect(body).toMatch(/db\.dryRun\.create/);
  });

  it('the API, the pipeline worker, the AI package and the chat agent import neither the executor nor the swap builder, except the manual user-signed swap engine', () => {
    const bad: string[] = [];
    // Manual trading is the one deliberate exception: the API builds an unsigned transaction, the user's own wallet
    // signs it, and the API only re-verifies that signature before broadcasting. Automated execution still cannot
    // reach it (the executor has no signer), and no other API file may import the Solana builder or verifier.
    const manual = 'apps/api/src/manual-swap-engine.ts';
    for (const dir of ['apps/api/src', 'workers/pipeline/src', 'packages/ai/src', 'packages/agent/src']) {
      for (const f of src(dir)) {
        if (f.file === manual) continue;
        if (/@narra\/(worker-executor|tx-verify)|@solana\/web3\.js|workers\/executor/.test(strip(f.text))) bad.push(f.file);
      }
    }
    expect(bad).toEqual([]);
    expect(src('apps/api/src').filter((f) => /@solana\/web3\.js|@narra\/tx-verify/.test(strip(f.text))).map((f) => f.file)).toEqual([manual]);
  });

  it('the pipeline worker no longer consumes the execution queue, and the executor does', () => {
    const pipeline = strip(readFileSync(join(ROOT, 'workers/pipeline/src/main.ts'), 'utf8'));
    expect(pipeline).not.toMatch(/new Worker\(QUEUE_NAMES\.execution\b/);
    expect(pipeline).not.toMatch(/runExecution\(/);
    const executor = strip(readFileSync(join(ROOT, 'workers/executor/src/main.ts'), 'utf8'));
    expect(executor).toMatch(/new Worker\(QUEUE_NAMES\.execution\b/);
    expect(executor).not.toMatch(/executor:\s*\{|executor,/); // no real Executor is passed to the execution path
  });

  it('the execution path is still given no Executor anywhere in the repo', () => {
    const offenders: string[] = [];
    for (const dir of ['apps', 'workers', 'packages']) {
      for (const f of src(dir)) if (/ExecutionDeps\s*=\s*\{[^}]*\bexecutor\s*[:,]/.test(strip(f.text))) offenders.push(f.file);
    }
    expect(offenders).toEqual([]);
  });

  it('no chat tool can reach the executor: every tool is a read, or one of the two suggestions the user applies themselves', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n, n).toMatch(/^(list_[a-z_]+|get_[a-z_]+|propose_pause_agent|propose_tighten_limit)$/);
    for (const n of names) expect(n, n).not.toMatch(/execute|swap|sign|send|withdraw|transfer|order|dry_run|kill/);
  });
});

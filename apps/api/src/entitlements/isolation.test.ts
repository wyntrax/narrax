import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runtime = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? runtime(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.includes('.test') && !e.name.endsWith('.d.ts') ? [join(dir, e.name)] : []);
const forbidden = (text: string) => [
  /@narra\/(risk|trading|solana|tx-verify|worker-executor|queue|worker-pipeline)/,
  /\b(?:db|tx)\s*\.\s*(?:tradingPermission|riskProfile|position|positionExit|order|trade|executionAttempt|dryRun|pendingConfirmation|chatProposal|wallet)\s*\./,
  /\buser\s*\.\s*(?:create|update|upsert|delete)/,
  /\b(?:enqueueExecution|EXECUTOR_ALLOWLIST_USER_IDS|signTransaction|sendTransaction|signMessage|Keypair)\b/,
  /\.(?:sign|sendRawTransaction)\s*\(/,
  /\$executeRawUnsafe|\$queryRawUnsafe|\bprocess\.env\b/,
].some(re => re.test(text));
describe('entitlement non-escalation structural boundary', () => {
  it('every runtime module has no trading writes, signing, execution or forbidden dependency', () => {
    const files = [...runtime('apps/api/src/entitlements'), 'packages/shared/src/entitlements.ts'];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(forbidden(text), file.replace(/\\/g, '/')).toBe(false);
      // Local imports must stay in this boundary, except the existing authentication pre-handler.
      for (const match of text.matchAll(/from ['"](\.\.[^'"]+)['"]/g)) expect(match[1], file).toBe('../account');
      if (text.includes("from '../account'")) expect(text).toContain('makeAuthenticate');
    }
  });
  it('detects mutation fixtures and Windows paths', () => {
    for (const injected of ['tx.user.update({data:{mode:"AUTO"}})', 'tx.tradingPermission.upsert({})', 'db.riskProfile.update({})', 'enqueueExecution(job)', 'import x from "@narra/trading"', 'process.env.EXECUTOR_ALLOWLIST_USER_IDS = "u"']) expect(forbidden(injected)).toBe(true);
    expect('apps\\api\\src\\entitlements\\linking.ts'.replace(/\\/g, '/')).toBe('apps/api/src/entitlements/linking.ts');
  });
  it('raw SQL only acquires advisory locks; no trading-setting names can be written', () => {
    const source = runtime('apps/api/src/entitlements').map(p => readFileSync(p, 'utf8')).join('\n');
    const sql = [...source.matchAll(/\$(?:executeRaw|queryRaw)`([^`]+)`/g)].map(m => m[1]!);
    expect(sql.length).toBeGreaterThan(0);
    for (const statement of sql) expect(statement).toMatch(/^SELECT pg_advisory_xact_lock\(hashtextextended\(\$\{$/);
    expect(source).not.toMatch(/['"](?:risk\.|executor\.|trading\.)/);
  });
});

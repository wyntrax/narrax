import { describe, expect, it } from 'vitest';
import { CEILINGS, ConfigError, DEFAULTS, loadExecutorConfig } from './config';

describe('loadExecutorConfig', () => {
  it('starts from the approved canary defaults with an empty allow list', () => {
    const c = loadExecutorConfig({});
    expect(c).toMatchObject({ mode: 'dry_run', hardCapSol: 0.01, dailyCapSol: 0.05, broadcastWindowMs: 10_000 });
    expect(c.allowlist.size).toBe(0);
    expect(c.limits).toMatchObject({ maxOverheadLamports: 5_000_000n, maxPriorityFeeLamports: 1_000_000n });
    expect(DEFAULTS.hardCapSol).toBe(0.01);
  });
  it('reads an allow list, and refuses an entry that is not a user id', () => {
    expect([...loadExecutorConfig({ EXECUTOR_ALLOWLIST_USER_IDS: ' abc123 , def_456,,' }).allowlist]).toEqual(['abc123', 'def_456']);
    expect(() => loadExecutorConfig({ EXECUTOR_ALLOWLIST_USER_IDS: 'ok,bad id' })).toThrow(ConfigError);
    expect(() => loadExecutorConfig({ EXECUTOR_ALLOWLIST_USER_IDS: "x'; drop" })).toThrow(ConfigError);
  });
  it('only supports dry_run: any other mode stops the process', () => {
    expect(() => loadExecutorConfig({ EXECUTOR_MODE: 'live' })).toThrow(/only has dry_run/);
    expect(() => loadExecutorConfig({ EXECUTOR_MODE: 'canary' })).toThrow(ConfigError);
    expect(loadExecutorConfig({ EXECUTOR_MODE: 'dry_run' }).mode).toBe('dry_run');
  });
  it('lets configuration be stricter than the defaults but never above a ceiling (it stops instead of clamping)', () => {
    expect(loadExecutorConfig({ EXECUTOR_HARD_CAP_SOL: '0.005' }).hardCapSol).toBe(0.005);
    expect(loadExecutorConfig({ EXECUTOR_HARD_CAP_SOL: String(CEILINGS.hardCapSol), EXECUTOR_DAILY_CAP_SOL: '0.1' }).hardCapSol).toBe(0.05);
    expect(() => loadExecutorConfig({ EXECUTOR_HARD_CAP_SOL: '0.06' })).toThrow(/ceiling/);
    expect(() => loadExecutorConfig({ EXECUTOR_DAILY_CAP_SOL: '1' })).toThrow(/ceiling/);
    expect(() => loadExecutorConfig({ EXECUTOR_MAX_OVERHEAD_SOL: '0.5' })).toThrow(/ceiling/);
    expect(() => loadExecutorConfig({ EXECUTOR_MAX_PRIORITY_FEE_SOL: '1' })).toThrow(/ceiling/);
    expect(() => loadExecutorConfig({ EXECUTOR_BROADCAST_WINDOW_MS: '120000' })).toThrow(/ceiling/);
  });
  it('refuses zero, negative and non-numeric values, and a per-transaction cap above the daily cap', () => {
    for (const v of ['0', '-1', 'abc', 'NaN', 'Infinity']) expect(() => loadExecutorConfig({ EXECUTOR_HARD_CAP_SOL: v }), v).toThrow(ConfigError);
    expect(() => loadExecutorConfig({ EXECUTOR_HARD_CAP_SOL: '0.04', EXECUTOR_DAILY_CAP_SOL: '0.03' })).toThrow(/cannot be above/);
  });
});

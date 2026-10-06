import { describe, expect, it, vi } from 'vitest';
import { assertEnv, checkEnv } from './env';

const PEM = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----';
const base = { DATABASE_URL: 'postgresql://narra:pw@localhost:5432/narra', REDIS_URL: 'redis://localhost:6379' };
const api = { ...base, PRIVY_APP_ID: 'app', PRIVY_VERIFICATION_KEY: PEM };

describe('checkEnv', () => {
  it('accepts the minimum for the API and for the worker', () => {
    expect(checkEnv(api, 'api').errors).toEqual([]);
    expect(checkEnv(base, 'worker').errors).toEqual([]);
  });
  it('treats empty values as unset, as .env.example ships them', () => {
    const r = checkEnv({ ...api, HELIUS_RPC_URL: '', CORS_ORIGINS: '', API_PORT: '', AI_BASE_URL: ' ', HELIUS_WEBHOOK_URL: '' }, 'api');
    expect(r.errors).toEqual([]);
  });
  it('requires the database, redis and (for the API) Privy settings', () => {
    expect(checkEnv({}, 'worker').errors).toEqual(['DATABASE_URL is required.', 'REDIS_URL is required.']);
    const e = checkEnv(base, 'api').errors;
    expect(e).toEqual(['PRIVY_APP_ID is required.', 'PRIVY_VERIFICATION_KEY is required.']);
  });
  it('rejects the wrong kind of URL', () => {
    expect(checkEnv({ ...base, DATABASE_URL: 'mysql://x/y' }, 'worker').errors).toContain('DATABASE_URL must be a postgres:// or postgresql:// URL.');
    expect(checkEnv({ ...base, DATABASE_URL: 'not a url' }, 'worker').errors).toContain('DATABASE_URL must be a postgres:// or postgresql:// URL.');
    expect(checkEnv({ ...base, REDIS_URL: 'http://x' }, 'worker').errors).toContain('REDIS_URL must be a redis:// or rediss:// URL.');
    expect(checkEnv({ ...api, PRIVY_VERIFICATION_KEY: 'abc' }, 'api').errors).toContain('PRIVY_VERIFICATION_KEY must be a PEM public key.');
  });
  it('checks ports, booleans and the stream name', () => {
    for (const port of ['0', '70000', 'abc', '40.5']) expect(checkEnv({ ...api, API_PORT: port }, 'api').errors, port).toContain('API_PORT must be a port number from 1 to 65535.');
    expect(checkEnv({ ...api, API_PORT: '4000' }, 'api').errors).toEqual([]);
    expect(checkEnv({ ...api, TRUST_PROXY: 'yes' }, 'api').errors).toContain('TRUST_PROXY must be "true" or "false".');
    expect(checkEnv({ ...api, HSTS: '1' }, 'api').errors).toContain('HSTS must be "true" or "false".');
    expect(checkEnv({ ...base, MARKET_DATA_ENABLED: 'on' }, 'worker').errors).toContain('MARKET_DATA_ENABLED must be "true" or "false".');
    expect(checkEnv({ ...api, REALTIME_STREAM_KEY: 'a b' }, 'api').errors.length).toBe(1);
  });
  it('CORS: exact origins only, no wildcards, no paths, no trailing slash', () => {
    expect(checkEnv({ ...api, CORS_ORIGINS: 'https://app.example.com, http://localhost:3000' }, 'api').errors).toEqual([]);
    for (const bad of ['*', 'https://*.example.com', 'https://app.example.com/', 'https://app.example.com/path', 'app.example.com', 'ftp://x.com']) {
      expect(checkEnv({ ...api, CORS_ORIGINS: bad }, 'api').errors.length, bad).toBe(1);
    }
  });
  it('production warns about the risky defaults and does not warn in development', () => {
    const prod = checkEnv({ ...api, NODE_ENV: 'production', CORS_ORIGINS: 'http://app.example.com', HELIUS_RPC_URL: 'http://rpc.example.com' }, 'api');
    expect(prod.errors).toEqual([]);
    expect(prod.warnings.join('\n')).toMatch(/HSTS is not enabled/);
    expect(prod.warnings.join('\n')).toMatch(/http:\/\/ origin in production/);
    expect(prod.warnings.join('\n')).toMatch(/HELIUS_RPC_URL is not https/);
    expect(checkEnv({ ...api, NODE_ENV: 'production' }, 'api').warnings.join('\n')).toMatch(/CORS_ORIGINS is empty/);
    const dev = checkEnv({ ...api, CORS_ORIGINS: 'http://app.example.com' }, 'api');
    expect(dev.warnings.join('\n')).not.toMatch(/HSTS|http:\/\/ origin|CORS_ORIGINS is empty/);
  });
  it('says which features are off when optional providers are missing', () => {
    const w = checkEnv(api, 'worker').warnings.join('\n');
    expect(w).toMatch(/AI_PROVIDER_API_KEY is not set/);
    expect(w).toMatch(/JUPITER_API_KEY is not set/);
    expect(w).toMatch(/HELIUS_RPC_URL is not set/);
    expect(checkEnv({ ...base, AI_PROVIDER_API_KEY: 'k', JUPITER_API_KEY: 'k', HELIUS_RPC_URL: 'https://rpc.example.com' }, 'worker').warnings).toEqual([]);
    expect(checkEnv({ ...base, MARKET_DATA_ENABLED: 'false' }, 'worker').warnings.join('\n')).toMatch(/no new prices/);
  });
  it('the webhook needs its key and secret, and a short secret is flagged', () => {
    const w = checkEnv({ ...api, HELIUS_WEBHOOK_URL: 'https://api.example.com/webhooks/helius' }, 'api').warnings.join('\n');
    expect(w).toMatch(/webhook sync stays off/);
    expect(checkEnv({ ...api, HELIUS_WEBHOOK_SECRET: 'short' }, 'api').warnings.join('\n')).toMatch(/shorter than 16/);
    expect(checkEnv({ ...api, HELIUS_WEBHOOK_URL: 'ftp://x' }, 'api').errors).toContain('HELIUS_WEBHOOK_URL must be an http:// or https:// URL.');
  });
  it('NEVER puts a value in a message, even when the value is what is wrong', () => {
    const secrets = ['hunter2-SECRET', 'sk-live-SECRETKEY', 'p4ssw0rd-LEAK', 'tokenvalue-LEAK'];
    const r = checkEnv({
      DATABASE_URL: `mysql://user:${secrets[2]}@host/db`, REDIS_URL: `http://:${secrets[0]}@host`, PRIVY_APP_ID: 'app', PRIVY_VERIFICATION_KEY: secrets[1], API_PORT: secrets[3],
      CORS_ORIGINS: `https://x.com/${secrets[0]}`, HELIUS_RPC_URL: `ftp://k:${secrets[1]}@x`, HELIUS_WEBHOOK_URL: `ftp://${secrets[3]}`, HELIUS_WEBHOOK_SECRET: secrets[0], AI_BASE_URL: `nope-${secrets[1]}`, TRUST_PROXY: secrets[2], HSTS: secrets[3], NODE_ENV: 'production',
    }, 'api');
    expect(r.errors.length).toBeGreaterThan(5);
    const all = [...r.errors, ...r.warnings].join('\n');
    for (const s of secrets) expect(all).not.toContain(s);
    expect(all).not.toMatch(/user:|@host/);
  });
});

describe('the executor role', () => {
  it('needs the database and redis, and says what is off without an RPC or an allow list', () => {
    expect(checkEnv({}, 'executor').errors).toEqual(['DATABASE_URL is required.', 'REDIS_URL is required.']);
    const w = checkEnv(base, 'executor').warnings.join('\n');
    expect(w).toMatch(/HELIUS_RPC_URL is not set: the executor cannot read balances/);
    expect(w).toMatch(/EXECUTOR_ALLOWLIST_USER_IDS is empty/);
    expect(checkEnv({ ...base, HELIUS_RPC_URL: 'https://rpc.example.com', EXECUTOR_ALLOWLIST_USER_IDS: 'u1', AI_PROVIDER_API_KEY: 'k', JUPITER_API_KEY: 'k' }, 'executor').warnings).toEqual([]);
  });
});

describe('assertEnv', () => {
  it('prints warnings, then exits 1 listing every error', () => {
    const out = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn((c: number) => { throw new Error(`exit ${c}`); });
    expect(() => assertEnv('api', { DATABASE_URL: 'x' }, out, exit as never)).toThrow('exit 1');
    expect(out.error.mock.calls.map((c) => c[0] as string).filter((m) => m.startsWith('env error')).length).toBeGreaterThanOrEqual(3);
    expect(out.error.mock.calls.at(-1)![0]).toContain('Not starting the api');
    expect(out.warn).toHaveBeenCalled();
  });
  it('returns quietly, with warnings only, when the environment is fine', () => {
    const out = { warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn(() => { throw new Error('should not exit'); });
    assertEnv('worker', base, out, exit as never);
    expect(exit).not.toHaveBeenCalled();
    expect(out.error).not.toHaveBeenCalled();
    expect(out.warn).toHaveBeenCalled();
  });
});

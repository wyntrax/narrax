import { describe, expect, it } from 'vitest';
import { BLOCKED_DATABASE_URL, BLOCKED_REDIS_URL, clearTestAdminEnv, clearTestAiEnv, resolveTestEnv } from './test-isolation';

const good = { NARRA_TEST_DATABASE_NAME: 'narra_radar_test_20261016', DATABASE_URL: 'postgresql://narra:pw@localhost:5432/narra_radar_test_20261016', NARRA_TEST_REDIS_URL: 'redis://127.0.0.1:6390/15' };

describe('test isolation', () => {
  it('removes inherited AI settings without changing service isolation or explicit later overrides', () => {
    const env = {...good, AI_PROVIDER_API_KEY:'secret', AI_BASE_URL:'https://example.invalid', AI_MODEL_ID:'shell-model', AI_REQUEST_STYLE:'bare'};
    clearTestAiEnv(env);
    for (const key of ['AI_PROVIDER_API_KEY','AI_BASE_URL','AI_MODEL_ID','AI_REQUEST_STYLE']) expect(env).not.toHaveProperty(key);
    expect(resolveTestEnv(env)).toEqual(resolveTestEnv(good));
    env.AI_MODEL_ID='explicit-test-model';
    expect(env.AI_MODEL_ID).toBe('explicit-test-model');
  });
  it('removes an inherited admin allowlist so a shell export cannot change who admin checks accept', () => {
    const env = {...good, ADMIN_EMAIL:'owner@example.com', ADMIN_PRIVY_USER_ID:'did:privy:someone'};
    clearTestAdminEnv(env);
    expect(env).not.toHaveProperty('ADMIN_EMAIL');
    expect(env).not.toHaveProperty('ADMIN_PRIVY_USER_ID');
    expect(resolveTestEnv(env)).toEqual(resolveTestEnv(good));
  });
  it('allows an explicitly named local test database and a designated local Redis', () => {
    expect(resolveTestEnv(good)).toEqual({ databaseUrl: good.DATABASE_URL, redisUrl: good.NARRA_TEST_REDIS_URL, databaseIsolated: true, redisIsolated: true });
  });
  it('blocks the application databases, however they are reached', () => {
    for (const url of ['postgresql://narra:narra@localhost:5432/narra', 'postgresql://narra:narra@localhost:5432/narra_ent', 'postgresql://x@db.example.com/narra_radar_test']) {
      const d = resolveTestEnv({ ...good, DATABASE_URL: url });
      expect(d).toMatchObject({ databaseUrl: BLOCKED_DATABASE_URL, databaseIsolated: false });
    }
    expect(resolveTestEnv({}).databaseUrl).toBe(BLOCKED_DATABASE_URL);
  });
  it('blocks a test database that is not the one named, or when no name is declared', () => {
    expect(resolveTestEnv({ ...good, NARRA_TEST_DATABASE_NAME: 'narra_other_test' }).databaseIsolated).toBe(false);
    expect(resolveTestEnv({ ...good, NARRA_TEST_DATABASE_NAME: undefined }).databaseIsolated).toBe(false);
  });
  it('never uses REDIS_URL: only an explicit local NARRA_TEST_REDIS_URL', () => {
    expect(resolveTestEnv({ ...good, NARRA_TEST_REDIS_URL: undefined, REDIS_URL: 'redis://localhost:6379' })).toMatchObject({ redisUrl: BLOCKED_REDIS_URL, redisIsolated: false });
    expect(resolveTestEnv({ ...good, NARRA_TEST_REDIS_URL: 'redis://cache.example.com:6379' }).redisIsolated).toBe(false);
    expect(resolveTestEnv({ ...good, NARRA_TEST_REDIS_URL: 'not a url' }).redisIsolated).toBe(false);
    expect(resolveTestEnv({ ...good, NARRA_TEST_REDIS_URL: 'http://127.0.0.1:6379' }).redisIsolated).toBe(false);
  });
  it('the blocked URLs point at a closed local port, so a probe fails fast and nothing is written', () => {
    expect(new URL(BLOCKED_DATABASE_URL).port).toBe('1');
    expect(new URL(BLOCKED_REDIS_URL).port).toBe('1');
  });
});

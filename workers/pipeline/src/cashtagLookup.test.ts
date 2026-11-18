import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { resolveUniqueCashtags } from './cashtagLookup';

const SINCE = new Date('2026-11-17T00:00:00Z');

describe('resolveUniqueCashtags', () => {
  it('returns empty map without querying when refs are empty or blank', async () => {
    const queryRaw = vi.fn();
    const findMany = vi.fn();
    const db = { $queryRaw: queryRaw, token: { findMany } } as unknown as PrismaClient;

    const result = await resolveUniqueCashtags(db, ['', '   '], SINCE);
    expect(result.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('batches deduplicated refs into one materialized CTE query and nulls out ambiguous symbols', async () => {
    const queryRaw = vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [
      { id: 'tok-sol', symbol: 'SoL', name: 'Wrapped', createdOnChainAt: null, deployer: null },
      { id: 'tok-dup-1', symbol: 'BONK', name: 'Bonk 1', createdOnChainAt: null, deployer: null },
      { id: 'tok-dup-2', symbol: 'bonk', name: 'Bonk 2', createdOnChainAt: null, deployer: null },
    ]);
    const db = { $queryRaw: queryRaw } as unknown as PrismaClient;

    const result = await resolveUniqueCashtags(db, ['sol', 'SOL', 'bonk', 'MISSING'], SINCE);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sqlText = (queryRaw.mock.calls[0]![0] as TemplateStringsArray).join(' ');
    expect(sqlText).toContain('WITH active AS MATERIALIZED');
    expect(sqlText).toContain('FROM "TokenMetric"');

    expect(result.get('SOL')).toMatchObject({ id: 'tok-sol', symbol: 'SoL' });
    expect(result.get('BONK')).toBeNull();
    expect(result.get('MISSING')).toBeNull();
  });

  it('falls back to token.findMany on partial mocks without $queryRaw', async () => {
    const findMany = vi.fn(async ({ where }: { where: { symbol: { equals: string } } }) => {
      if (where.symbol.equals === 'UNIQ') {
        return [{ id: 't1', symbol: 'uniq', name: 'Unique', createdOnChainAt: null, deployer: null }];
      }
      return [
        { id: 't2', symbol: 'DUP', name: 'Dup 1', createdOnChainAt: null, deployer: null },
        { id: 't3', symbol: 'dup', name: 'Dup 2', createdOnChainAt: null, deployer: null },
      ];
    });
    const db = { token: { findMany } } as unknown as PrismaClient;

    const result = await resolveUniqueCashtags(db, ['uniq', 'dup'], SINCE);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(result.get('UNIQ')).toMatchObject({ id: 't1' });
    expect(result.get('DUP')).toBeNull();
  });
});

import {expect,it} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {runScreener} from './screener';

/**
 * The market-evidence lookup keyed 'research.market.<tokenId>' must stay a correlated lateral. As a flat join
 * (evidence."key" = 'research.market.' || t."id") it is not sargable, and on a real database the planner turned it into a
 * SystemSetting x Token nested loop that compared ~41.8 million rows and took ~13 seconds, which the web client aborts at
 * its 10-second deadline (surfacing a bare TIMEOUT card). The lateral keeps the probe on the SystemSetting primary key.
 * This assertion needs no database: it captures the SQL the query layer builds.
 */
it('probes market evidence through the SystemSetting primary key instead of a non-sargable join', async () => {
  let sql = '';
  const db = {
    $queryRaw: (query: { strings?: string[] }) => {
      sql = (query?.strings ?? []).join('?');
      return Promise.resolve([]);
    },
  } as unknown as PrismaClient;

  const result = await runScreener(
    db,
    { limit: 25, verifiedOnly: 'true', marketCapOnly: 'true', minMarketCapUsd: 100000, maxMarketCapUsd: 500000, sort: 'volume24h' } as never,
    new Date('2026-10-19T14:30:00.000Z'),
  );

  expect(result).toEqual({ rows: [], nextCursor: null });
  expect(sql).toContain('LEFT JOIN LATERAL (SELECT ev."key", ev."value" FROM "SystemSetting" ev');
  expect(sql).toContain('ev."key" = \'research.market.\' || t."id"');
  // The flat, non-sargable form that produced the runaway nested loop must not come back.
  expect(sql).not.toMatch(/LEFT JOIN "SystemSetting" evidence ON/);
});

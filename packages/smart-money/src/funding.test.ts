import { describe, expect, it } from 'vitest';
import { DISCOVERY, buildFundingGraph, rankCandidates, type TokenScan } from './index';

describe('buildFundingGraph', () => {
  const ids = new Map([['addrA', 'A'], ['addrB', 'B'], ['addrC', 'C'], ['addrD', 'D']]);

  it('links a tracked funder to the wallet it funded as HIGH', () => {
    const g = buildFundingGraph([{ walletId: 'B', funder: 'addrA' }], ids);
    expect(g.edges).toEqual([{ fromId: 'A', toId: 'B', confidence: 'HIGH', type: 'direct', funder: 'addrA' }]);
    expect(g.clusters).toEqual([{ walletIds: ['A', 'B'], confidence: 'HIGH' }]);
  });

  it('links wallets first funded by the same outside address as MEDIUM', () => {
    const g = buildFundingGraph([{ walletId: 'A', funder: 'outside' }, { walletId: 'B', funder: 'outside' }, { walletId: 'C', funder: 'other' }], ids);
    expect(g.edges).toEqual([{ fromId: 'A', toId: 'B', confidence: 'MEDIUM', type: 'shared_funder', funder: 'outside' }]);
    expect(g.clusters).toEqual([{ walletIds: ['A', 'B'], confidence: 'MEDIUM' }]);
  });

  it('skips probable services: too many wallets, or an ignored address', () => {
    const many = ['A', 'B', 'C', 'D'].map((walletId) => ({ walletId, funder: 'exchange' }));
    const g = buildFundingGraph(many, ids, { maxFanout: 3 });
    expect(g.edges).toEqual([]);
    expect(g.skippedFunders).toEqual([{ funder: 'exchange', wallets: 4 }]);
    expect(buildFundingGraph([{ walletId: 'A', funder: 'svc' }, { walletId: 'B', funder: 'svc' }], ids, { ignoredFunders: new Set(['svc']) }).edges).toEqual([]);
  });

  it('merges links into one cluster and takes the weakest link as its confidence', () => {
    const g = buildFundingGraph([{ walletId: 'B', funder: 'addrA' }, { walletId: 'B', funder: 'addrA' }, { walletId: 'C', funder: 'outside' }, { walletId: 'D', funder: 'outside' }, { walletId: 'A', funder: 'outside' }], ids);
    expect(g.clusters).toHaveLength(1);
    expect(g.clusters[0]).toEqual({ walletIds: ['A', 'B', 'C', 'D'], confidence: 'MEDIUM' });
  });

  it('ignores a wallet funding itself and wallets with no links', () => {
    expect(buildFundingGraph([{ walletId: 'A', funder: 'addrA' }, { walletId: 'B', funder: 'solo' }], ids).clusters).toEqual([]);
  });
});

describe('rankCandidates', () => {
  const scan = (tokenId: string, winner: boolean, buyers: [string, number][]): TokenScan => ({ tokenId, winner, buyers: buyers.map(([wallet, rank]) => ({ wallet, rank })) });

  it('suggests wallets that were early in several winners and ranks the earlier one higher', () => {
    const r = rankCandidates([scan('t1', true, [['good', 1], ['ok', 20]]), scan('t2', true, [['good', 2], ['ok', 25]]), scan('t3', true, [['good', 3], ['ok', 28]])]);
    expect(r.map((c) => c.address)).toEqual(['good', 'ok']);
    expect(r[0]).toMatchObject({ winnerTokens: 3, scannedTokens: 3, hitRate: 1 });
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
  });

  it('marks down a bot that is early in everything, winners and losers alike', () => {
    const scans = [scan('w1', true, [['bot', 1], ['skilled', 2]]), scan('w2', true, [['bot', 1], ['skilled', 2]]),
      ...Array.from({ length: 8 }, (_, i) => scan(`l${i}`, false, [['bot', 1]]))];
    const [skilled, bot] = rankCandidates(scans);
    expect(skilled!.address).toBe('skilled');
    expect(bot!.hitRate).toBeCloseTo(0.2);
    expect(skilled!.score).toBeGreaterThan(bot!.score * 2);
  });

  it('needs the minimum number of winners, counts only the first N buyers, and drops excluded addresses', () => {
    const s = [scan('t1', true, [['once', 1], ['late', DISCOVERY.maxRank + 1], ['tracked', 1]]), scan('t2', true, [['late', DISCOVERY.maxRank + 1], ['tracked', 1]])];
    expect(rankCandidates(s, new Set(['tracked']))).toEqual([]);
    expect(rankCandidates(s).map((c) => c.address)).toEqual(['tracked']);
  });

  it('counts a wallet once per token even if it bought repeatedly, using its best rank', () => {
    const [c] = rankCandidates([scan('t1', true, [['w', 5], ['w', 2]]), scan('t2', true, [['w', 4]])]);
    expect(c).toMatchObject({ winnerTokens: 2, avgRank: 3 });
  });

  it('returns nothing for empty input', () => { expect(rankCandidates([])).toEqual([]); });
});

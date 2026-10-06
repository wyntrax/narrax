import { describe, expect, it } from 'vitest';
import { MIN_CLOSED_LEGS, classifyStyle, computeConsensus, computeLeaderStats, computeWalletStats, detectTimingClusters, holdingPatterns, rotationRate, walletScore, wilsonLowerBound, type Entry, type TradeRow, type WalletInfo, type WalletStats } from './index';

const T0 = new Date('2026-09-01T00:00:00Z').getTime();
const at = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000);
const trade = (token: string, side: 'BUY' | 'SELL', sol: number, qty: number, when: Date, wallet = 'w'): TradeRow => ({ wallet, token, side, sol, qty, at: when });

describe('computeWalletStats', () => {
  it('uses average cost and realizes a leg on every sell', () => {
    const s = computeWalletStats([trade('A', 'BUY', 1, 100, at(0)), trade('A', 'SELL', 0.8, 50, at(30)), trade('A', 'SELL', 0.2, 50, at(60))]);
    expect(s.legs).toHaveLength(2);
    expect(s.legs[0]).toMatchObject({ costSol: 0.5, roi: expect.closeTo(0.6) });
    expect(s.legs[1]?.roi).toBeCloseTo(-0.6);
    expect(s.pnlSol).toBeCloseTo(0);
    expect(s.winRate).toBe(0.5);
    expect(s.legs[0]?.holdSeconds).toBe(1800);
  });
  it('averages the cost of several buys', () => {
    const s = computeWalletStats([trade('A', 'BUY', 1, 100, at(0)), trade('A', 'BUY', 3, 100, at(5)), trade('A', 'SELL', 4, 100, at(10))]);
    expect(s.legs[0]).toMatchObject({ costSol: 2 }); // half of the 4 SOL cost
    expect(s.legs[0]?.pnlSol).toBeCloseTo(2);
  });
  it('skips sells it never saw bought and prorates oversized sells', () => {
    const s = computeWalletStats([trade('X', 'SELL', 5, 10, at(0)), trade('A', 'BUY', 1, 100, at(1)), trade('A', 'SELL', 3, 150, at(2))]);
    expect(s.unmatchedSells).toBe(1);
    expect(s.legs).toHaveLength(1);
    expect(s.legs[0]?.pnlSol).toBeCloseTo(3 * (100 / 150) - 1); // only the 100 held units count as proceeds
  });
  it('restarts the hold clock after a full exit', () => {
    const s = computeWalletStats([trade('A', 'BUY', 1, 10, at(0)), trade('A', 'SELL', 2, 10, at(10)), trade('A', 'BUY', 1, 10, at(100)), trade('A', 'SELL', 2, 10, at(110))]);
    expect(s.legs.map((l) => l.holdSeconds)).toEqual([600, 600]);
  });
  it('measures drawdown against all SOL bought', () => {
    const s = computeWalletStats([
      trade('A', 'BUY', 1, 10, at(0)), trade('A', 'SELL', 3, 10, at(1)), // +2
      trade('B', 'BUY', 1, 10, at(2)), trade('B', 'SELL', 0.2, 10, at(3)), // -0.8
      trade('C', 'BUY', 1, 10, at(4)), trade('C', 'SELL', 0.2, 10, at(5)), // -0.8
    ]);
    expect(s.maxDrawdown).toBeCloseTo(1.6 / 3);
  });
  it('is empty-safe', () => {
    const s = computeWalletStats([]);
    expect(s).toMatchObject({ winRate: null, medianRoi: null, pnlSol: 0, maxDrawdown: 0 });
  });
});

const mkStats = (wins: number, losses: number, winRoi = 1): WalletStats => {
  const legs = [...Array(wins).fill(0).map((_, i) => ({ token: `w${i}`, pnlSol: winRoi, costSol: 1, roi: winRoi, holdSeconds: 1800, closedAt: at(i) })),
    ...Array(losses).fill(0).map((_, i) => ({ token: `l${i}`, pnlSol: -0.5, costSol: 1, roi: -0.5, holdSeconds: 1800, closedAt: at(100 + i) }))];
  const grossWin = wins * winRoi, grossLoss = losses * 0.5;
  return { legs, unmatchedSells: 0, totalBoughtSol: legs.length, pnlSol: grossWin - grossLoss, winRate: wins / legs.length, avgRoi: 0, medianRoi: winRoi, medianHoldSeconds: 1800, maxDrawdown: 0.05, grossWinSol: grossWin, grossLossSol: grossLoss };
};

describe('walletScore', () => {
  it('refuses to score a wallet with too few closed trades', () => {
    expect(walletScore(mkStats(MIN_CLOSED_LEGS - 1, 0))).toBeNull();
    expect(walletScore(mkStats(MIN_CLOSED_LEGS, 0))).not.toBeNull();
  });
  it('trusts a long record more than a short perfect one', () => {
    expect(walletScore(mkStats(30, 0))!).toBeGreaterThan(walletScore(mkStats(5, 0))!);
    expect(wilsonLowerBound(5, 5)).toBeLessThan(wilsonLowerBound(30, 30));
  });
  it('scores a losing wallet low and stays within 0 to 100', () => {
    const bad = walletScore(mkStats(2, 18, 0.1))!;
    const good = walletScore(mkStats(25, 5, 1.5))!;
    expect(bad).toBeLessThan(25);
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(100);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
});

const entries = (wallet: string, tokens: number, offsetMin: number): Entry[] => Array.from({ length: tokens }, (_, i) => ({ wallet, token: `t${i}`, at: at(i * 120 + offsetMin) }));

describe('computeLeaderStats', () => {
  it('rewards the wallet that others copy, not the one that enters alone', () => {
    const m = computeLeaderStats([...entries('A', 6, 0), ...entries('B', 6, 5), ...entries('solo', 6, 0).map((e) => ({ ...e, token: `x${e.token}` }))]);
    expect(m.get('A')).toMatchObject({ ledRate: 1, avgFollowers: 1, followerRate: 0, leaderScore: expect.closeTo(66.7, 1) });
    expect(m.get('B')).toMatchObject({ ledRate: 0, followerRate: 1, leaderScore: 0 });
    expect(m.get('solo')?.leaderScore).toBe(0);
  });
  it('needs enough entries, ignores repeat buys and entries outside the window', () => {
    expect(computeLeaderStats([...entries('A', 4, 0), ...entries('B', 4, 5)]).get('A')?.leaderScore).toBeNull();
    const late = computeLeaderStats([...entries('A', 6, 0), ...entries('B', 6, 45)]);
    expect(late.get('A')?.ledRate).toBe(0);
    const adds = computeLeaderStats([...entries('A', 6, 0), ...entries('A', 6, 3), ...entries('B', 6, 5)]);
    expect(adds.get('A')?.entries).toBe(6); // second buys of the same token are not new entries
  });
});

describe('style and patterns', () => {
  const base = mkStats(6, 0);
  const withHold = (s: number, roi = 0.5): WalletStats => ({ ...base, medianHoldSeconds: s, medianRoi: roi });
  const lead = (leaderScore: number | null, followerRate = 0) => ({ entries: 8, ledRate: 0, avgFollowers: 0, followerRate, leaderScore });
  it('applies the rules in order', () => {
    expect(classifyStyle(mkStats(2, 0), undefined, 0)).toBe('UNKNOWN');
    expect(classifyStyle(withHold(1800), lead(80), 0.9)).toBe('NARRATIVE_LEADER');
    expect(classifyStyle(withHold(1800), lead(10, 0.8), 0.9)).toBe('FOLLOWER');
    expect(classifyStyle(withHold(1800), lead(10), 0.7)).toBe('ROTATION');
    expect(classifyStyle(withHold(120), lead(10), 0)).toBe('SCALPER');
    expect(classifyStyle(withHold(80 * 3600), lead(10), 0)).toBe('LONG_HOLD');
    expect(classifyStyle(withHold(10 * 3600), lead(10), 0)).toBe('SWING');
    expect(classifyStyle(withHold(1800), lead(10), 0)).toBe('EARLY_MOMENTUM');
    expect(classifyStyle(withHold(1800, -0.2), lead(10), 0)).toBe('UNKNOWN');
  });
  it('measures rotation from sells followed by a different buy', () => {
    const t: TradeRow[] = [];
    for (let i = 0; i < 6; i++) t.push(trade(`a${i}`, 'SELL', 1, 1, at(i * 60)), trade(`b${i}`, 'BUY', 1, 1, at(i * 60 + 3)));
    expect(rotationRate(t)).toBe(1);
    expect(rotationRate(t.slice(0, 4))).toBe(0); // too few sells to say
  });
  it('finds the best and weakest holding-time buckets, or says nothing', () => {
    const leg = (hold: number, roi: number) => ({ token: 't', pnlSol: roi, costSol: 1, roi, holdSeconds: hold, closedAt: at(0) });
    const legs = [...[1, 2, 3].map(() => leg(300, -0.2)), ...[1, 2, 3].map(() => leg(1800, 0.5))];
    expect(holdingPatterns(legs)).toEqual({ best: 'Holds of 10 to 60 minutes: median ROI 50% over 3 trades', weak: 'Holds of under 10 minutes: median ROI -20% over 3 trades' });
    expect(holdingPatterns(legs.slice(0, 3))).toEqual({ best: null, weak: null });
  });
});

describe('detectTimingClusters', () => {
  const co = (w: string, n: number, sec: number): Entry[] => Array.from({ length: n }, (_, i) => ({ wallet: w, token: `c${i}`, at: at(i * 60, sec) }));
  it('links wallets that keep entering together, capped at MEDIUM confidence', () => {
    const r = detectTimingClusters([...co('X', 5, 0), ...co('Y', 5, 20), ...co('Z', 3, 40)]);
    expect(r.edges.find((e) => e.a === 'X' && e.b === 'Y')).toMatchObject({ sharedTokens: 5, confidence: 'MEDIUM' });
    expect(r.edges.find((e) => e.a === 'X' && e.b === 'Z')?.confidence).toBe('LOW');
    expect(r.clusters).toEqual([{ wallets: ['X', 'Y', 'Z'], confidence: 'LOW' }]); // weakest link wins
    expect(r.edges.some((e) => e.confidence === ('HIGH' as never))).toBe(false);
  });
  it('does not link wallets with too few shared tokens or entries far apart', () => {
    expect(detectTimingClusters([...co('X', 2, 0), ...co('Y', 2, 20)]).clusters).toEqual([]);
    expect(detectTimingClusters([...co('X', 6, 0), ...co('Y', 6, 600)]).clusters).toEqual([]);
  });
});

describe('computeConsensus', () => {
  const info = (score: number, leaderScore = 0, clusterId: string | null = null): WalletInfo => ({ score, leaderScore, clusterId });
  const ev = (wallet: string, side: 'BUY' | 'SELL', sol: number, min: number) => ({ wallet, side, sol, at: at(min) });
  it('returns null when no qualifying wallet bought', () => {
    expect(computeConsensus([ev('a', 'BUY', 1, 0)], new Map([['a', info(40)]]))).toBeNull();
    expect(computeConsensus([ev('a', 'SELL', 1, 0)], new Map([['a', info(90)]]))).toBeNull();
  });
  it('counts a cluster once so it cannot fake agreement', () => {
    const w = new Map([['a', info(80, 0, 'c1')], ['b', info(75, 0, 'c1')], ['c', info(70, 0, 'c1')], ['d', info(90, 85)]]);
    const events = [ev('a', 'BUY', 1, 0), ev('b', 'BUY', 1, 1), ev('c', 'BUY', 1, 2), ev('d', 'BUY', 2, 3)];
    const c = computeConsensus(events, w)!;
    expect(c).toMatchObject({ walletCount: 4, independentEntities: 2, leaderCount: 1, netFlowSol: 5, timingConcentration: 1 });
    const lone = computeConsensus([ev('d', 'BUY', 2, 3)], w)!;
    expect(c.score).toBeGreaterThan(lone.score);
  });
  it('scores more independent buyers higher, and cuts the score when they also sell', () => {
    const w = new Map([['a', info(80)], ['b', info(80)], ['c', info(80)]]);
    const two = computeConsensus([ev('a', 'BUY', 1, 0), ev('b', 'BUY', 1, 1)], w)!;
    const three = computeConsensus([ev('a', 'BUY', 1, 0), ev('b', 'BUY', 1, 1), ev('c', 'BUY', 1, 2)], w)!;
    expect(three.score).toBeGreaterThan(two.score);
    const sold = computeConsensus([ev('a', 'BUY', 1, 0), ev('b', 'BUY', 1, 1), ev('a', 'SELL', 1, 5), ev('b', 'SELL', 1, 6)], w)!;
    expect(sold.score).toBeLessThan(two.score);
    expect(sold.netFlowSol).toBe(0);
  });
});

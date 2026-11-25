import { describe, expect, it } from 'vitest';
import { computeWalletStats, type TradeRow } from './stats';
import { detectAutomation } from './automation';

const t = (offsetMs: number) => new Date(Date.parse('2026-11-01T00:00:00Z') + offsetMs);

describe('detectAutomation', () => {
  it('leaves normal human swing/momentum wallets unflagged', () => {
    const trades: TradeRow[] = [];
    for (let i = 0; i < 25; i++) {
      const start = i * 6 * 3_600_000;
      const hold = (30 + (i % 7) * 25) * 60_000;
      trades.push({ wallet: 'w1', token: `tok-${i}`, side: 'BUY', sol: 1.5 + (i % 4) * 0.5, qty: 1000, at: t(start) });
      trades.push({ wallet: 'w1', token: `tok-${i}`, side: 'SELL', sol: 2.1, qty: 1000, at: t(start + hold) });
    }
    const stats = computeWalletStats(trades);
    const res = detectAutomation(trades, stats);
    expect(res.automated).toBe(false);
    expect(res.reasons).toEqual([]);
    expect(res.openPositionCount).toBe(0);
  });

  it('flags micro-dust fixed-timer spray bots with open bag overhang (production 4yUwV2JM pattern)', () => {
    const trades: TradeRow[] = [];
    // 55 closed trades at exact 601s timer with 0.004 SOL buys
    for (let i = 0; i < 55; i++) {
      const start = i * 3_600_000;
      trades.push({ wallet: 'bot', token: `closed-${i}`, side: 'BUY', sol: 0.004, qty: 1000, at: t(start) });
      trades.push({ wallet: 'bot', token: `closed-${i}`, side: 'SELL', sol: 0.008, qty: 1000, at: t(start + 601_000) });
    }
    // 120 unclosed open dead bags (> 2x closed)
    for (let i = 0; i < 120; i++) {
      trades.push({ wallet: 'bot', token: `open-${i}`, side: 'BUY', sol: 0.004, qty: 1000, at: t((60 + i) * 600_000) });
    }
    const stats = computeWalletStats(trades);
    const res = detectAutomation(trades, stats);
    expect(res.automated).toBe(true);
    expect(res.reasons).toEqual(expect.arrayContaining(['DUST_SPRAY', 'FIXED_TIMER_EXITS', 'OPEN_BAG_OVERHANG']));
    expect(res.openPositionCount).toBe(120);
  });

  it('flags high-frequency sniper bots exiting within 15 seconds', () => {
    const trades: TradeRow[] = [];
    // 110 round-trips/day across 2 days = 440 trades (>100/day) with 5s holds
    for (let day = 0; day < 2; day++) {
      for (let i = 0; i < 110; i++) {
        const start = day * 86_400_000 + i * 600_000;
        trades.push({ wallet: 'sniper', token: `t-${day}-${i}`, side: 'BUY', sol: 0.5, qty: 1000, at: t(start) });
        trades.push({ wallet: 'sniper', token: `t-${day}-${i}`, side: 'SELL', sol: 0.55, qty: 1000, at: t(start + 5_000) });
      }
    }
    const stats = computeWalletStats(trades);
    const res = detectAutomation(trades, stats);
    expect(res.automated).toBe(true);
    expect(res.reasons).toEqual(expect.arrayContaining(['HIGH_FREQUENCY', 'SNIPER_EXITS']));
  });
});

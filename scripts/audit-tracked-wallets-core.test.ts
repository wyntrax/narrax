import { describe, expect, it } from 'vitest';
import { classifyWallet, summarizeWallets } from './audit-tracked-wallets-core';

const at = new Date('2026-10-17T00:00:00Z');
const w = (over: Partial<Parameters<typeof classifyWallet>[0]> = {}) => ({ address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', label: null, source: 'MANUAL', createdAt: at, trades: 5, ...over });

describe('tracked wallet audit classification', () => {
  it('flags addresses that cannot exist on chain, even though they look like addresses', () => {
    const fake = `wa1700000000000A`.padEnd(40, '1');
    expect(classifyWallet(w({ address: fake })).class).toBe('NOT_A_SOLANA_ADDRESS');
    expect(classifyWallet(w({ address: 'not-a-wallet' })).class).toBe('NOT_A_SOLANA_ADDRESS');
  });
  it('separates a real-looking wallet with no recorded trades from one with trades', () => {
    expect(classifyWallet(w({ trades: 0 })).class).toBe('NO_TRADES_RECORDED');
    expect(classifyWallet(w({ trades: 3 })).class).toBe('ACTIVE_TRADES');
  });
  it('flags a valid-format address with a test label as likely test data, never as proven fake', () => {
    const r = classifyWallet(w({ label: 'Test whale' }));
    expect(r.class).toBe('LOOKS_LIKE_TEST_DATA');
    expect(r.reasons.join(' ')).toMatch(/label/);
  });
  it('summarizes counts by class and source with the creation range', () => {
    const rows = [
      { ...w({ address: 'bad' }), class: 'NOT_A_SOLANA_ADDRESS' as const },
      { ...w({ address: 'bad2', createdAt: new Date('2026-10-18T00:00:00Z') }), class: 'NOT_A_SOLANA_ADDRESS' as const },
      { ...w({ source: 'IMPORT' }), class: 'ACTIVE_TRADES' as const },
    ];
    const s = summarizeWallets(rows);
    expect(s.total).toBe(3);
    expect(s.byClass.NOT_A_SOLANA_ADDRESS).toMatchObject({ count: 2, firstCreatedAt: '2026-10-17T00:00:00.000Z', lastCreatedAt: '2026-10-18T00:00:00.000Z' });
    expect(s.bySource.IMPORT).toEqual({ ACTIVE_TRADES: 1 });
    expect(s.bySource.MANUAL).toEqual({ NOT_A_SOLANA_ADDRESS: 2 });
  });
});

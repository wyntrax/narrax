import { describe, expect, it, vi } from 'vitest';
import { TOKEN_DISCOVERY_LIMITS, selectDiscoveryCandidates, scanTokenSwaps, tokenParticipants } from './tokenWalletDiscovery';

const mint = 'PumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
const other = 'So11111111111111111111111111111111111111112';
const wallet = (prefix: string) => `${prefix}${'1'.repeat(44 - prefix.length)}`;
const at = 1_760_000_000;
const buy = (signature: string, owner: string, token = mint, lamports = '1000000000', units = '10') => ({
  signature, timestamp: at, feePayer: owner,
  events: { swap: { nativeInput: { amount: lamports }, nativeOutput: null, tokenOutputs: [{ mint: token, rawTokenAmount: { tokenAmount: units, decimals: 0 } }] } },
});
const sell = (signature: string, owner: string, token = mint, lamports = '500000000', units = '5') => ({
  signature, timestamp: at + 60, feePayer: owner,
  events: { swap: { nativeInput: null, nativeOutput: { amount: lamports }, tokenInputs: [{ mint: token, rawTokenAmount: { tokenAmount: units, decimals: 0 } }] } },
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('token-scoped wallet discovery', () => {
  it('aggregates only supported swaps for the investigated mint and counts distinct wallets', () => {
    const owner = wallet('A'), oneOff = wallet('B');
    const result = tokenParticipants([buy('1'.repeat(88), owner), sell('2'.repeat(88), owner), buy('3'.repeat(88), oneOff, other), buy('4'.repeat(88), oneOff)], mint);
    expect(result.swaps).toBe(3);
    expect(result.participants).toHaveLength(2);
    expect(result.participants.find(p => p.address === owner)).toMatchObject({ swaps: 2, buys: 1, sells: 1 });
    expect(result.participants.find(p => p.address === oneOff)).toMatchObject({ swaps: 1, buys: 1, sells: 0 });
  });

  it('keeps one participant per address across pages, deduplicates signatures and rejects malformed or zero-SOL swaps', () => {
    const owner = wallet('A');
    const result = tokenParticipants([buy('1'.repeat(88), owner), buy('1'.repeat(88), owner), buy('2'.repeat(88), owner, mint, '0'), { signature: 'bad' }], mint);
    expect(result.swaps).toBe(1);
    expect(result.participants).toEqual([expect.objectContaining({ address: owner, swaps: 1, signatures: ['1'.repeat(88)] })]);
  });

  it('selects untracked wallets by observed swap count and applies the scan cap', () => {
    const [a, b, c] = [wallet('A'), wallet('B'), wallet('C')];
    const participants = [
      { address: a, swaps: 1, buys: 1, sells: 0, firstAt: '2026-10-01T00:00:00.000Z', lastAt: '2026-10-01T00:00:00.000Z', signatures: [] },
      { address: b, swaps: 4, buys: 2, sells: 2, firstAt: '2026-10-01T00:00:00.000Z', lastAt: '2026-10-02T00:00:00.000Z', signatures: [] },
      { address: c, swaps: 3, buys: 3, sells: 0, firstAt: '2026-10-02T00:00:00.000Z', lastAt: '2026-10-03T00:00:00.000Z', signatures: [] },
    ];
    expect(selectDiscoveryCandidates(participants, new Set([b]), { minSwaps: 2, maxWallets: 5 }).map(p => p.address)).toEqual([c]);
    expect(selectDiscoveryCandidates(participants, new Set(), { minSwaps: 2, maxWallets: 1 }).map(p => p.address)).toEqual([b]);
    expect(selectDiscoveryCandidates(participants, new Set(), { minSwaps: 9 })).toEqual([]);
    const infrastructure = { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', swaps: 99, buys: 99, sells: 0, firstAt: '2026-10-01T00:00:00.000Z', lastAt: '2026-10-03T00:00:00.000Z', signatures: [] };
    expect(selectDiscoveryCandidates([...participants, infrastructure], new Set([b, c]), { minSwaps: 2 })).toEqual([]);
  });

  it('reads bounded Helius pages, advances by the last signature, and reports a capped sample', async () => {
    const [a, b] = [wallet('A'), wallet('B')];
    const page = (owner: string, prefix: string) => Array.from({ length: TOKEN_DISCOVERY_LIMITS.pageSize }, (_, i) => buy(`${prefix}${String(i).padStart(10, '0')}${'1'.repeat(80)}`, owner));
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const before = new URL(String(input)).searchParams.get('before');
      return json(before ? page(b, 'b') : page(a, 'a'));
    });
    const result = await scanTokenSwaps(mint, { apiKey: 'test-key', fetch: fetcher as typeof fetch, maxPages: 2 });
    expect(result).toMatchObject({ pagesRead: 2, transactionsRead: 200, swapsRead: 200, capped: true });
    expect(result.participants.map(p => p.address)).toEqual([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.get('before')).toBe(page(a, 'a').at(-1)!.signature);
  });

  it('returns a partial sample instead of pretending a short provider failure is complete', async () => {
    const fetcher = vi.fn(async () => new Response('upstream failed', { status: 500 }));
    await expect(scanTokenSwaps(mint, { apiKey: 'test-key', fetch: fetcher as typeof fetch, maxPages: 1 })).rejects.toThrow('HTTP 500');
    const invalid = vi.fn(async () => json({ not: 'an array' }));
    await expect(scanTokenSwaps(mint, { apiKey: 'test-key', fetch: invalid as typeof fetch, maxPages: 1 })).rejects.toThrow('invalid payload');
  });
});

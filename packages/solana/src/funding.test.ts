import { describe, expect, it } from 'vitest';
import { FUNDING_MIN_LAMPORTS, HeliusApiError, HeliusWebhooks, SolanaRpc, earlyBuyer, firstFunding, inboundSolTransfers, planWebhookSync, type ParsedTx } from './index';

const W = 'Wallet'.padEnd(40, '1'), F1 = 'FunderA'.padEnd(40, '2'), F2 = 'FunderB'.padEnd(40, '3'), MINT = 'Mint'.padEnd(40, '4'), POOL = 'Pool'.padEnd(40, '5');
const transfer = (source: string, destination: string, lamports: number | string, type = 'transfer') => ({ program: 'system', parsed: { type, info: { source, destination, lamports } } });
const tx = (instructions: unknown[], over: Partial<ParsedTx> & { inner?: unknown[]; err?: unknown; pre?: unknown[]; post?: unknown[]; payer?: string } = {}): ParsedTx => ({
  blockTime: 1_760_000_000,
  transaction: { message: { accountKeys: [{ pubkey: over.payer ?? W, signer: true }], instructions } },
  meta: { err: over.err ?? null, innerInstructions: over.inner ? [{ instructions: over.inner }] : [], preTokenBalances: over.pre ?? [], postTokenBalances: over.post ?? [] },
} as unknown as ParsedTx);
const bal = (owner: string, amount: string, mint = MINT) => ({ owner, mint, uiTokenAmount: { amount } });

describe('inboundSolTransfers', () => {
  it('finds top-level and inner system transfers into the wallet', () => {
    const r = inboundSolTransfers(tx([transfer(F1, W, 2_000_000_000)], { inner: [transfer(F2, W, '300000000', 'transferWithSeed')] }), W);
    expect(r).toEqual([{ from: F1, lamports: 2_000_000_000n }, { from: F2, lamports: 300_000_000n }]);
  });
  it('ignores failed transactions, other destinations, self transfers, other programs and bad amounts', () => {
    expect(inboundSolTransfers(tx([transfer(F1, W, 5e9)], { err: { InstructionError: [0, 'x'] } }), W)).toEqual([]);
    expect(inboundSolTransfers(tx([transfer(F1, F2, 5e9), transfer(W, W, 5e9), { program: 'spl-token', parsed: { type: 'transfer', info: {} } }, transfer(F1, W, -1), transfer(F1, W, 'abc'), transfer(F1, W, 0), 'junk', null]), W)).toEqual([]);
  });
});

describe('firstFunding', () => {
  const at = (sig: string, t: ParsedTx | null) => ({ signature: sig, tx: t });
  it('skips dust and returns the oldest transfer that meets the minimum', () => {
    const f = firstFunding([at('s1', tx([transfer(F2, W, 5_000)])), at('s2', null), at('s3', tx([transfer(F1, W, 1_000_000_000)])), at('s4', tx([transfer(F2, W, 9e9)]))], W);
    expect(f).toMatchObject({ funder: F1, lamports: 1_000_000_000n, signature: 's3' });
    expect(f!.at?.getTime()).toBe(1_760_000_000_000);
  });
  it('returns null when nothing qualifies, and respects the minimum exactly', () => {
    expect(firstFunding([at('s1', tx([transfer(F1, W, 49_999_999)]))], W)).toBeNull();
    expect(firstFunding([at('s1', tx([transfer(F1, W, 50_000_000)]))], W)?.funder).toBe(F1);
    expect(FUNDING_MIN_LAMPORTS).toBe(50_000_000n);
  });
});

describe('earlyBuyer', () => {
  it('returns the fee payer when its own balance of the mint rose', () => {
    expect(earlyBuyer(tx([], { pre: [bal(POOL, '1000')], post: [bal(POOL, '900'), bal(W, '100')] }), MINT)).toBe(W);
    expect(earlyBuyer(tx([], { pre: [bal(W, '50')], post: [bal(W, '80')] }), MINT)).toBe(W);
  });
  it('returns null for sells, other mints, other owners, failed transactions and missing balances', () => {
    expect(earlyBuyer(tx([], { pre: [bal(W, '100')], post: [bal(W, '10')] }), MINT)).toBeNull();
    expect(earlyBuyer(tx([], { post: [bal(W, '100', 'OtherMint')] }), MINT)).toBeNull();
    expect(earlyBuyer(tx([], { post: [bal(POOL, '100')] }), MINT)).toBeNull();
    expect(earlyBuyer(tx([], { err: 'x', post: [bal(W, '100')] }), MINT)).toBeNull();
    expect(earlyBuyer({ ...tx([]), meta: null } as ParsedTx, MINT)).toBeNull();
  });
});

describe('SolanaRpc history methods', () => {
  const rpcWith = (result: unknown, capture?: (b: { method: string; params: unknown[] }) => void) =>
    new SolanaRpc({ url: 'http://x', fetch: (async (_u: string, init: RequestInit) => { capture?.(JSON.parse(init.body as string)); return new Response(JSON.stringify({ result })); }) as unknown as typeof fetch });
  it('maps signatures and passes the paging cursor', async () => {
    let sent: { method: string; params: unknown[] } | undefined;
    const r = await rpcWith([{ signature: 'a', blockTime: 5, err: null }, { signature: 'b', blockTime: null, err: { x: 1 } }], (b) => { sent = b; }).getSignaturesForAddress(W, { limit: 10, before: 'zzz' });
    expect(r).toEqual([{ signature: 'a', blockTime: 5, failed: false }, { signature: 'b', blockTime: null, failed: true }]);
    expect(sent!.method).toBe('getSignaturesForAddress');
    expect(sent!.params[1]).toMatchObject({ limit: 10, before: 'zzz' });
  });
  it('requests a parsed transaction and accepts null', async () => {
    let sent: { method: string; params: unknown[] } | undefined;
    expect(await rpcWith(null, (b) => { sent = b; }).getParsedTransaction('sig')).toBeNull();
    expect(sent!.method).toBe('getTransaction');
    expect(sent!.params[1]).toMatchObject({ encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 });
    const parsed = await rpcWith(tx([transfer(F1, W, 1e9)])).getParsedTransaction('sig');
    expect(parsed && inboundSolTransfers(parsed, W)).toHaveLength(1);
  });
  it('rejects a transaction with an unexpected shape', async () => {
    await expect(rpcWith({ nope: true }).getParsedTransaction('sig')).rejects.toThrow('unexpected shape');
  });
});

describe('HeliusWebhooks', () => {
  const KEY = 'secret-key-123';
  const spec = { webhookURL: 'https://api.example/webhooks/helius', transactionTypes: ['SWAP'], accountAddresses: [W], webhookType: 'enhanced' as const, authHeader: 'tok' };
  const hook = { webhookID: 'abc', webhookURL: spec.webhookURL, transactionTypes: ['SWAP'], accountAddresses: [W], active: true };
  const client = (status: number, body: unknown, calls: { url: string; init: RequestInit }[] = []) =>
    new HeliusWebhooks({ apiKey: KEY, fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch });

  it('lists, creates and edits with the documented paths, methods and bodies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    expect(await client(200, [hook], calls).list()).toHaveLength(1);
    expect((await client(200, hook, calls).create(spec)).webhookID).toBe('abc');
    expect((await client(200, hook, calls).update('abc', spec)).accountAddresses).toEqual([W]);
    expect(calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual(['GET /v0/webhooks', 'POST /v0/webhooks', 'PUT /v0/webhooks/abc']);
    expect(new URL(calls[0]!.url).searchParams.get('api-key')).toBe(KEY);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual(spec);
  });
  it('never puts the API key in an error message', async () => {
    for (const c of [client(500, {}), client(200, { nope: 1 }), new HeliusWebhooks({ apiKey: KEY, fetch: (async () => { throw new Error(`boom ${KEY}`); }) as unknown as typeof fetch })]) {
      try { await c.list(); throw new Error('should have thrown'); } catch (e) { expect(e).toBeInstanceOf(HeliusApiError); expect((e as Error).message.includes(KEY)).toBe(false); }
    }
  });
  it('refuses to start without a key and falls back to the default base URL for an empty override', async () => {
    expect(() => new HeliusWebhooks({ apiKey: '' })).toThrow(HeliusApiError);
    const calls: { url: string; init: RequestInit }[] = [];
    await new HeliusWebhooks({ apiKey: KEY, baseUrl: '', fetch: (async (u: string, i: RequestInit) => { calls.push({ url: u, init: i }); return new Response('[]'); }) as unknown as typeof fetch }).list();
    expect(calls[0]!.url.startsWith('https://api-mainnet.helius-rpc.com/v0/webhooks')).toBe(true);
  });
});

describe('planWebhookSync', () => {
  it('computes additions and removals, ignoring order and duplicates', () => {
    expect(planWebhookSync(['b', 'a', 'a', 'x'], ['a', 'b', 'c', 'c'])).toEqual({ add: ['c'], remove: ['x'], inSync: false });
    expect(planWebhookSync(['a', 'b'], ['b', 'a'])).toEqual({ add: [], remove: [], inSync: true });
    expect(planWebhookSync([], [])).toEqual({ add: [], remove: [], inSync: true });
  });
});

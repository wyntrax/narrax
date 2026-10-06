import { describe, expect, it } from 'vitest';
import { JupiterClient, QuoteError, type Quote } from './jupiter';
import { RpcError, SolanaRpc } from './rpc';

const quote: Quote = { inputMint: 'A', outputMint: 'B', inAmount: '100', outAmount: '90', otherAmountThreshold: '85', priceImpactPct: 0.1, slippageBps: 100, fetchedAt: new Date(), raw: { inputMint: 'A', outAmount: '90' } };
const respond = (body: unknown, init: ResponseInit = {}) => (async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
const reply = (result: unknown) => respond({ jsonrpc: '2.0', id: 1, result });

describe('quote minimum output', () => {
  it('reads otherAmountThreshold from the response and reports null when it is missing', async () => {
    const body = { inputMint: 'A', outputMint: 'B', inAmount: '100', outAmount: '90', otherAmountThreshold: '85', priceImpactPct: '0.001', slippageBps: 50 };
    expect((await new JupiterClient({ fetch: respond(body) }).getQuote({ inputMint: 'A', outputMint: 'B', amount: 100n, slippageBps: 50 })).otherAmountThreshold).toBe('85');
    const { otherAmountThreshold: _drop, ...without } = body;
    expect((await new JupiterClient({ fetch: respond(without) }).getQuote({ inputMint: 'A', outputMint: 'B', amount: 100n, slippageBps: 50 })).otherAmountThreshold).toBeNull();
    await expect(new JupiterClient({ fetch: respond({ ...body, otherAmountThreshold: '-5' }) }).getQuote({ inputMint: 'A', outputMint: 'B', amount: 1n, slippageBps: 1 })).rejects.toThrow(QuoteError);
  });
});

describe('JupiterClient.buildSwap', () => {
  it('posts the original quote, the wallet, and a priority-fee ceiling, and returns an unsigned transaction', async () => {
    let sent: { url?: string; init?: RequestInit } = {};
    const f = (async (u: string, init: RequestInit) => { sent = { url: u, init }; return new Response(JSON.stringify({ swapTransaction: 'dHg=', lastValidBlockHeight: 123, extra: 1 })); }) as unknown as typeof fetch;
    const r = await new JupiterClient({ fetch: f, apiKey: 'k' }).buildSwap({ quote, userPublicKey: 'WALLET', maxPriorityFeeLamports: 1_000_000 });
    expect(r).toEqual({ transactionBase64: 'dHg=', lastValidBlockHeight: 123 });
    expect(sent.url).toBe('https://lite-api.jup.ag/swap/v1/swap');
    expect(sent.init?.method).toBe('POST');
    expect((sent.init?.headers as Record<string, string>)['x-api-key']).toBe('k');
    const body = JSON.parse(sent.init?.body as string);
    expect(body).toMatchObject({ quoteResponse: quote.raw, userPublicKey: 'WALLET', wrapAndUnwrapSol: true, asLegacyTransaction: false, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000 } } });
  });
  it('throws on HTTP errors, a bad shape and a timeout, never returning a partial transaction', async () => {
    const req = { quote, userPublicKey: 'W', maxPriorityFeeLamports: 1 };
    await expect(new JupiterClient({ fetch: respond({}, { status: 500 }) }).buildSwap(req)).rejects.toThrow('HTTP 500');
    await expect(new JupiterClient({ fetch: respond({ swapTransaction: '' , lastValidBlockHeight: 1 }) }).buildSwap(req)).rejects.toThrow('unexpected shape');
    await expect(new JupiterClient({ fetch: respond({ swapTransaction: 'x' }) }).buildSwap(req)).rejects.toThrow('unexpected shape');
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('x'))))) as unknown as typeof fetch;
    await expect(new JupiterClient({ fetch: hang, timeoutMs: 20 }).buildSwap(req)).rejects.toThrow(QuoteError);
  });
});

describe('SolanaRpc: accounts, simulation and mints', () => {
  const acct = (lamports: number, data = 'AAAA') => ({ lamports, owner: 'Owner111', data: [data, 'base64'] });

  it('reads several accounts in order and reports a missing one as null', async () => {
    let body: { method?: string; params?: unknown[] } = {};
    const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ result: { value: [acct(5), null] } })); }) as unknown as typeof fetch;
    const r = await new SolanaRpc({ url: 'http://x', fetch: f }).getAccounts(['a', 'b']);
    expect(r).toEqual([{ lamports: 5, owner: 'Owner111', data: 'AAAA' }, null]);
    expect(body.method).toBe('getMultipleAccounts');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: [acct(1)] }) }).getAccounts(['a', 'b'])).rejects.toThrow('wrong number');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: [] }) }).getAccounts([])).rejects.toThrow(RpcError);
  });

  it('simulates without verifying signatures or replacing the blockhash, and returns post-state', async () => {
    let body: { params?: [string, Record<string, unknown>] } = {};
    const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ result: { value: { err: null, logs: ['a'], unitsConsumed: 12, accounts: [acct(9), null] } } })); }) as unknown as typeof fetch;
    const r = await new SolanaRpc({ url: 'http://x', fetch: f }).simulateTransaction('dHg=', ['w', 't']);
    expect(r).toEqual({ err: null, logs: ['a'], unitsConsumed: 12, accounts: [{ lamports: 9, owner: 'Owner111', data: 'AAAA' }, null] });
    expect(body.params?.[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: false, accounts: { addresses: ['w', 't'] } });
  });
  it('returns a failed simulation as data, so the caller can record why, and refuses a short account list on success', async () => {
    const failed = await new SolanaRpc({ url: 'http://x', fetch: reply({ value: { err: { InstructionError: [1, 'Custom'] }, logs: [], accounts: null } }) }).simulateTransaction('x', ['w']);
    expect(failed.err).toEqual({ InstructionError: [1, 'Custom'] });
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: { err: null, accounts: [] } }) }).simulateTransaction('x', ['w'])).rejects.toThrow('wrong number');
  });

  it('reads a mint\'s program and authorities, and fails closed on a missing or non-mint account', async () => {
    const mint = (info: object, owner = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') => reply({ value: { owner, data: { parsed: { type: 'mint', info } } } });
    expect(await new SolanaRpc({ url: 'http://x', fetch: mint({ decimals: 6, freezeAuthority: null, mintAuthority: null }) }).getMintInfo('M'))
      .toEqual({ program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 6, freezeAuthority: null, mintAuthority: null, hasExtensions: false });
    expect((await new SolanaRpc({ url: 'http://x', fetch: mint({ decimals: 9, freezeAuthority: 'Frz', mintAuthority: 'Mnt', extensions: [{ extension: 'transferFeeConfig' }] }, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') }).getMintInfo('M')))
      .toMatchObject({ freezeAuthority: 'Frz', hasExtensions: true, program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' });
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: null }) }).getMintInfo('M')).rejects.toThrow('does not exist');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: { owner: 'P', data: { parsed: { type: 'account', info: { decimals: 1, freezeAuthority: null, mintAuthority: null } } } } }) }).getMintInfo('M')).rejects.toThrow('not a mint');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: { owner: 'P', data: ['x', 'base64'] } }) }).getMintInfo('M')).rejects.toThrow('unexpected shape');
  });
});

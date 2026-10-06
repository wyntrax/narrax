import { describe, expect, it } from 'vitest';
import { RpcError, SolanaRpc } from './rpc';

const reply = (result: unknown, init: ResponseInit = {}) => (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), init)) as unknown as typeof fetch;
const OWNER = 'Owner'.padEnd(40, '1');
const tokenAcct = (amount: string) => ({ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } });

describe('SolanaRpc', () => {
  it('reads a balance in lamports', async () => {
    let body: { method?: string; params?: unknown[] } = {};
    const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response(JSON.stringify({ result: { value: 2_500_000_000 } })); }) as unknown as typeof fetch;
    expect(await new SolanaRpc({ url: 'http://x', fetch: f }).getBalanceLamports(OWNER)).toBe(2_500_000_000n);
    expect(body.method).toBe('getBalance');
  });
  it('sums token amounts across accounts without losing precision', async () => {
    const big = '9007199254740993'; // above Number.MAX_SAFE_INTEGER
    const rpc = new SolanaRpc({ url: 'http://x', fetch: reply({ value: [tokenAcct(big), tokenAcct('7')] }) });
    expect(await rpc.getTokenBaseUnits(OWNER, 'Mint'.padEnd(40, '1'))).toBe(9007199254741000n);
    expect(await new SolanaRpc({ url: 'http://x', fetch: reply({ value: [] }) }).getTokenBaseUnits(OWNER, 'M')).toBe(0n);
  });
  it('throws on RPC errors, HTTP errors, bad shapes and timeouts', async () => {
    const errFetch = (async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }))) as unknown as typeof fetch;
    await expect(new SolanaRpc({ url: 'http://x', fetch: errFetch }).getBalanceLamports(OWNER)).rejects.toThrow('rate limited');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({}, { status: 503 }) }).getBalanceLamports(OWNER)).rejects.toThrow('HTTP 503');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: -5 }) }).getBalanceLamports(OWNER)).rejects.toThrow('unexpected shape');
    await expect(new SolanaRpc({ url: 'http://x', fetch: reply({ value: [{ account: {} }] }) }).getTokenBaseUnits(OWNER, 'M')).rejects.toThrow(RpcError);
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('x'))))) as unknown as typeof fetch;
    await expect(new SolanaRpc({ url: 'http://x', fetch: hang, timeoutMs: 20 }).getBalanceLamports(OWNER)).rejects.toThrow(RpcError);
  });
});

import { describe, expect, it } from 'vitest';
import { RpcError, SolanaRpc } from './rpc';

const reply = (result: unknown, init: ResponseInit = {}) => (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), init)) as unknown as typeof fetch;
const OWNER = 'Owner'.padEnd(40, '1');
const tokenAcct = (amount: string) => ({ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } });

describe('SolanaRpc', () => {
  it('preserves an empty closed post-account object and unwraps the base64 tuple without reinterpreting it', async () => {
    const account = { lamports: 0, owner: '11111111111111111111111111111111', data: ['', 'base64'] };
    const rpc = new SolanaRpc({ url: 'http://test', fetch: reply({ value: { err: null, unitsConsumed: 1, accounts: [account, null], logs: [] } }) });
    expect((await rpc.simulateTransaction('unsigned', ['closed', 'missing'])).accounts).toEqual([{ lamports: 0, owner: account.owner, data: '' }, null]);
    const invalid = new SolanaRpc({ url: 'http://test', fetch: reply({ value: { err: null, accounts: [{ ...account, data: '' }] } }) });
    await expect(invalid.simulateTransaction('unsigned', ['closed'])).rejects.toThrow(RpcError);
  });
  it('preserves the old account read and exposes context only through the additive method', async () => {
    const requests: string[] = [];
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      requests.push(init.body as string);
      return new Response(JSON.stringify({ result: { context: { slot: 456 }, value: [{ lamports: 123, owner: OWNER, data: ['YWJj', 'base64'] }, null] } }));
    }) as typeof fetch;
    const rpc = new SolanaRpc({ url: 'http://test', fetch: fetcher });
    const accounts = [{ lamports: 123, owner: OWNER, data: 'YWJj' }, null];
    expect(await rpc.getAccounts(['a', 'b'])).toEqual(accounts);
    expect(await rpc.getAccountsWithContext(['a', 'b'])).toEqual({ slot: 456, accounts });
    expect(requests).toEqual([1, 2].map(id => JSON.stringify({ jsonrpc: '2.0', id, method: 'getMultipleAccounts', params: [['a', 'b'], { encoding: 'base64', commitment: 'confirmed' }] })));
    // Old method still accepts the response shape without context.
    expect(await new SolanaRpc({ url: 'http://test', fetch: reply({ value: [null] }) }).getAccounts(['a'])).toEqual([null]);
  });
  it('fails closed on wrong counts and invalid context without changing the address limits', async () => {
    const rpc = new SolanaRpc({ url: 'http://test', fetch: reply({ context: { slot: 456 }, value: [] }) });
    for (const method of ['getAccounts', 'getAccountsWithContext'] as const) {
      await expect(rpc[method](['a'])).rejects.toThrow(RpcError);
      await expect(rpc[method]([])).rejects.toThrow(RpcError);
      await expect(rpc[method](Array(101).fill('a'))).rejects.toThrow(RpcError);
    }
    await expect(new SolanaRpc({ url: 'http://test', fetch: reply({ value: [null] }) }).getAccountsWithContext(['a'])).rejects.toThrow(RpcError);
  });
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

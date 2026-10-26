import { z } from 'zod';

export class RpcError extends Error {}

export interface RpcOptions {
  /** Full JSON-RPC URL including any API key, e.g. a Helius RPC endpoint. */
  url: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const Envelope = z.object({ result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() });
const BalanceResult = z.object({ value: z.number().int().nonnegative() });
const TokenAccountsResult = z.object({
  value: z.array(z.object({
    account: z.object({ data: z.object({ parsed: z.object({ info: z.object({ tokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }) }) }) }) }),
  })),
});

const SignaturesResult = z.array(z.object({ signature: z.string(), blockTime: z.number().nullish(), err: z.unknown().nullish() }));
const Instruction = z.unknown();
const TokenBalance = z.object({ mint: z.string(), owner: z.string().nullish(), uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }).passthrough() }).passthrough();
const ParsedTxResult = z.object({
  blockTime: z.number().nullish(),
  transaction: z.object({
    message: z.object({
      accountKeys: z.array(z.union([z.string(), z.object({ pubkey: z.string() }).passthrough()])),
      instructions: z.array(Instruction),
    }).passthrough(),
  }).passthrough(),
  meta: z.object({
    err: z.unknown().nullish(),
    innerInstructions: z.array(z.object({ instructions: z.array(Instruction) }).passthrough()).nullish(),
    preTokenBalances: z.array(TokenBalance).nullish(),
    postTokenBalances: z.array(TokenBalance).nullish(),
  }).passthrough().nullish(),
}).passthrough().nullable();

const RawAccountSchema = z.object({ lamports: z.number().int().nonnegative(), owner: z.string(), data: z.tuple([z.string(), z.literal('base64')]) }).passthrough();
const MultipleAccountsResult = z.object({ value: z.array(RawAccountSchema.nullable()) });
const SimulateResult = z.object({
  context: z.object({ slot: z.number().int().nonnegative().safe() }).optional(),
  value: z.object({
    err: z.unknown().nullish(),
    logs: z.array(z.string()).nullish(),
    unitsConsumed: z.number().int().nonnegative().nullish(),
    accounts: z.array(RawAccountSchema.nullable()).nullish(),
  }).passthrough(),
});
const MintInfoResult = z.object({
  value: z.object({
    owner: z.string(),
    data: z.object({ parsed: z.object({ type: z.string(), info: z.object({
      decimals: z.number().int(), freezeAuthority: z.string().nullable(), mintAuthority: z.string().nullable(), extensions: z.array(z.unknown()).optional(),
    }).passthrough() }).passthrough() }).passthrough(),
  }).nullable(),
});

export type ParsedTx = NonNullable<z.infer<typeof ParsedTxResult>>;
/** An account as returned with base64 encoding. */
export interface RpcAccount { lamports: number; owner: string; data: string }
export interface SimulationResponse { err: unknown | null; logs: string[]; unitsConsumed: number | null; accounts: (RpcAccount | null)[]; /** Evidence only; older responses may omit context. */ slot?: number }
export interface MintInfo { /** The program that owns the mint account. */ program: string; decimals: number; freezeAuthority: string | null; mintAuthority: string | null; hasExtensions: boolean }
export interface SignatureInfo { signature: string; blockTime: number | null; failed: boolean }

/** Minimal JSON-RPC client. Every failure throws, so callers that need a balance fail closed. */
export class SolanaRpc {
  private id = 0;
  constructor(private readonly opts: RpcOptions) {}

  private async call<T>(method: string, params: unknown[], schema: z.ZodType<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 5000);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(this.opts.url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      });
    } catch (e) {
      throw new RpcError(`${method} failed: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new RpcError(`${method} returned HTTP ${res.status}`);
    const env = Envelope.safeParse(await res.json().catch(() => null));
    if (!env.success) throw new RpcError(`${method} returned an unreadable response`);
    if (env.data.error) throw new RpcError(`${method} error: ${env.data.error.message}`);
    const parsed = schema.safeParse(env.data.result);
    if (!parsed.success) throw new RpcError(`${method} result had an unexpected shape`);
    return parsed.data;
  }

  /** Balance in lamports. */
  async getBalanceLamports(address: string): Promise<bigint> {
    const r = await this.call('getBalance', [address, { commitment: 'confirmed' }], BalanceResult);
    return BigInt(r.value);
  }

  /** Total base units of a token held by an owner, across all its token accounts. 0n if none. */
  async getTokenBaseUnits(owner: string, mint: string): Promise<bigint> {
    const r = await this.call('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }], TokenAccountsResult);
    return r.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
  }

  /** Total current token supply in raw units (no floating-point rounding). */
  async getTokenSupplyRaw(mint: string): Promise<bigint> {
    const result = await this.call('getTokenSupply', [mint, { commitment: 'confirmed' }], z.object({ value: z.object({ amount: z.string().regex(/^\d+$/) }) }));
    return BigInt(result.value.amount);
  }

  /** Signatures that touched an address, newest first. Page backwards with `before`. */
  async getSignaturesForAddress(address: string, opts: { limit?: number; before?: string } = {}): Promise<SignatureInfo[]> {
    const r = await this.call('getSignaturesForAddress', [address, { limit: opts.limit ?? 1000, ...(opts.before ? { before: opts.before } : {}), commitment: 'confirmed' }], SignaturesResult);
    return r.map((x) => ({ signature: x.signature, blockTime: x.blockTime ?? null, failed: x.err != null }));
  }

  /** A transaction with instructions and token balances decoded, or null if the node does not have it. */
  async getParsedTransaction(signature: string): Promise<ParsedTx | null> {
    // 1, not 0: Helius now returns version-1 transactions. A lower ceiling makes the node reject those outright
    // ("Transaction version (1) is not supported"), which silently drops the token from buyer scanning.
    return this.call('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }], ParsedTxResult);
  }

  /** Several accounts at once, in the order asked. A null entry means the account does not exist. */
  async getAccounts(addresses: string[]): Promise<(RpcAccount | null)[]> {
    if (addresses.length === 0 || addresses.length > 100) throw new RpcError('getMultipleAccounts needs 1 to 100 addresses');
    const r = await this.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }], MultipleAccountsResult);
    if (r.value.length !== addresses.length) throw new RpcError('getMultipleAccounts returned the wrong number of accounts');
    return r.value.map((a) => (a ? { lamports: a.lamports, owner: a.owner, data: a.data[0] } : null));
  }

  /** Same confirmed account read, retaining the RPC context slot as review evidence only. */
  async getAccountsWithContext(addresses: string[]): Promise<{ slot: number; accounts: (RpcAccount | null)[] }> {
    if (addresses.length === 0 || addresses.length > 100) throw new RpcError('getMultipleAccounts needs 1 to 100 addresses');
    const schema = MultipleAccountsResult.extend({ context: z.object({ slot: z.number().int().nonnegative().safe() }) });
    const r = await this.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }], schema);
    if (r.value.length !== addresses.length) throw new RpcError('getMultipleAccounts returned the wrong number of accounts');
    return { slot: r.context.slot, accounts: r.value.map((a) => (a ? { lamports: a.lamports, owner: a.owner, data: a.data[0] } : null)) };
  }

  /**
   * Runs an unsigned transaction against the node's state and returns the post-state of the named accounts. Nothing is sent.
   * Signature verification is off (the transaction is unsigned) and the blockhash is NOT replaced, so an expired one fails.
   */
  async simulateTransaction(txBase64: string, accounts: string[]): Promise<SimulationResponse> {
    const r = await this.call('simulateTransaction', [txBase64, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: accounts } }], SimulateResult);
    const accs = r.value.accounts ?? [];
    if (accs.length !== accounts.length && r.value.err == null) throw new RpcError('simulateTransaction returned the wrong number of accounts');
    return {
      err: r.value.err ?? null, logs: r.value.logs ?? [], unitsConsumed: r.value.unitsConsumed ?? null,
      accounts: accs.map((a) => (a ? { lamports: a.lamports, owner: a.owner, data: a.data[0] } : null)),
      ...(r.context ? { slot: r.context.slot } : {}),
    };
  }

  /** What a mint's authorities are. Throws when the mint does not exist or is not a parsed mint account. */
  async getMintInfo(mint: string): Promise<MintInfo> {
    const r = await this.call('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }], MintInfoResult);
    if (!r.value) throw new RpcError('The mint account does not exist');
    if (r.value.data.parsed.type !== 'mint') throw new RpcError('The account is not a mint');
    const info = r.value.data.parsed.info;
    return { program: r.value.owner, decimals: info.decimals, freezeAuthority: info.freezeAuthority, mintAuthority: info.mintAuthority, hasExtensions: (info.extensions?.length ?? 0) > 0 };
  }
}

import { z } from 'zod';
import { WSOL_MINT } from './helius';

const QuoteResponse = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  /** The least Jupiter promises to deliver after slippage, in output base units. */
  otherAmountThreshold: z.string().regex(/^\d+$/).optional(),
  priceImpactPct: z.union([z.string().trim().regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/), z.number().finite().nonnegative()]),
  slippageBps: z.number(),
}).passthrough();

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  /** Base units (lamports for SOL). */
  amount: bigint;
  slippageBps: number;
  /** Opt-in probe: must agree with buildSwap's asLegacyTransaction. */
  asLegacyTransaction?: boolean;
  /** Jupiter's rough route account budget, not a transaction-size guarantee. */
  maxAccounts?: number;
}

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  /** The minimum output after slippage, from the quote. Absent when the response did not carry one. A dry run refuses to proceed without it. */
  otherAmountThreshold?: string | null;
  /** In percent, e.g. 1.5 means 1.5%. */
  priceImpactPct: number;
  /** The tolerance this quote was requested with. This is a ceiling, not a prediction. */
  slippageBps: number;
  fetchedAt: Date;
  raw: unknown;
}

export interface JupiterOptions {
  /** Confirm the current base URL in Jupiter's docs. */
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Jupiter reports price impact as a fraction or a percent depending on API version. Verify against a live response. */
  priceImpactFormat?: 'fraction' | 'percent';
  fetch?: typeof fetch;
  now?: () => Date;
}

export class QuoteError extends Error {}

export class JupiterClient {
  constructor(private readonly opts: JupiterOptions = {}) {}

  /** Always fetches a fresh quote. Quotes are never cached or retried, because a stale quote is a wrong price. */
  async getQuote(req: QuoteRequest): Promise<Quote> {
    const base = this.opts.baseUrl ?? 'https://lite-api.jup.ag/swap/v1';
    const url = new URL(`${base}/quote`);
    url.searchParams.set('inputMint', req.inputMint);
    url.searchParams.set('outputMint', req.outputMint);
    url.searchParams.set('amount', req.amount.toString());
    url.searchParams.set('slippageBps', String(req.slippageBps));
    if (req.asLegacyTransaction !== undefined) url.searchParams.set('asLegacyTransaction', String(req.asLegacyTransaction));
    if (req.maxAccounts !== undefined) url.searchParams.set('maxAccounts', String(req.maxAccounts));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 4000);
    let body: unknown;
    try {
      const res = await (this.opts.fetch ?? fetch)(url, {
        headers: this.opts.apiKey ? { 'x-api-key': this.opts.apiKey } : {},
        signal: ctrl.signal,
      });
      if (!res.ok) throw new QuoteError(`Quote request returned HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      if (e instanceof QuoteError) throw e;
      throw new QuoteError(`Quote request failed: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
    const parsed = QuoteResponse.safeParse(body);
    if (!parsed.success) throw new QuoteError('Quote response had an unexpected shape');
    const q = parsed.data;
    const impact = Number(q.priceImpactPct);
    const priceImpactPct = this.opts.priceImpactFormat === 'percent' ? impact : impact * 100;
    if (!Number.isFinite(priceImpactPct) || priceImpactPct < 0 || priceImpactPct > 100) throw new QuoteError('Quote price impact was out of range');

    return {
      inputMint: q.inputMint, outputMint: q.outputMint, inAmount: q.inAmount, outAmount: q.outAmount, otherAmountThreshold: q.otherAmountThreshold ?? null,
      priceImpactPct,
      slippageBps: q.slippageBps, fetchedAt: (this.opts.now ?? (() => new Date()))(), raw: q,
    };
  }

  /**
   * Asks Jupiter to build the swap transaction for a quote. The result is UNSIGNED and is never trusted: the caller must
   * run it through the transaction verifier and a simulation before anything could sign it.
   * The request and response fields match Jupiter's published Swap API v1 reference (POST /swap, read on 2026-10-05, NOT called live).
   * Jupiter's docs say this v1 (Metis) API "is no longer actively maintained and has been superseded by Swap V2". Moving the
   * quote and swap clients to V2 is an open item for B5b; the transaction verifier is independent of which API built the transaction.
   */
  async buildSwap(req: BuildSwapRequest): Promise<BuiltSwap> {
    const base = this.opts.baseUrl ?? 'https://lite-api.jup.ag/swap/v1';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${base}/swap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.opts.apiKey ? { 'x-api-key': this.opts.apiKey } : {}) },
        body: JSON.stringify({
          quoteResponse: req.quote.raw,
          userPublicKey: req.userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          asLegacyTransaction: req.asLegacyTransaction ?? false,
          prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: req.maxPriorityFeeLamports, priorityLevel: 'high' } },
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new QuoteError(`Swap build request failed: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new QuoteError(`Swap build request returned HTTP ${res.status}`);
    const parsed = SwapResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new QuoteError('Swap build response had an unexpected shape');
    return { transactionBase64: parsed.data.swapTransaction, lastValidBlockHeight: parsed.data.lastValidBlockHeight };
  }
}

const SwapResponse = z.object({
  swapTransaction: z.string().min(1).max(4000),
  lastValidBlockHeight: z.number().int().positive(),
}).passthrough();

export interface BuiltSwap {
  /** An UNSIGNED versioned transaction, base64. Nothing in this package signs it. */
  transactionBase64: string;
  lastValidBlockHeight: number;
}

export interface BuildSwapRequest {
  quote: Quote;
  /** Opt-in only; set the same option when obtaining the quote. */
  asLegacyTransaction?: boolean;
  userPublicKey: string;
  /** Hard ceiling on the priority fee Jupiter may add, in lamports. */
  maxPriorityFeeLamports: number;
}

export function isQuoteFresh(quote: Quote, now: Date, maxAgeMs = 5000): boolean {
  const age = now.getTime() - quote.fetchedAt.getTime();
  return age >= 0 && age <= maxAgeMs;
}

export { WSOL_MINT };

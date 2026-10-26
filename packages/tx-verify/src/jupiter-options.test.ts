import { expect, it } from 'vitest';
import { JupiterClient } from '../../solana/src/jupiter';

it('keeps the default Jupiter URL and body byte-for-byte unchanged; options are opt-in', async () => {
  const calls: { url: string; body?: string }[] = [];
  const raw = { inputMint: 'A', outputMint: 'B', inAmount: '100', outAmount: '90', otherAmountThreshold: '89', priceImpactPct: '0', slippageBps: 100 };
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body as string | undefined });
    return new Response(JSON.stringify(init?.method === 'POST' ? { swapTransaction: 'unsigned', lastValidBlockHeight: 1 } : raw));
  }) as typeof fetch;
  const client = new JupiterClient({ fetch: fetcher });
  const request = { inputMint: 'A', outputMint: 'B', amount: 100n, slippageBps: 100 };
  const quote = await client.getQuote(request);
  await client.buildSwap({ quote, userPublicKey: 'wallet', maxPriorityFeeLamports: 123 });
  expect(calls[0]?.url).toBe('https://lite-api.jup.ag/swap/v1/quote?inputMint=A&outputMint=B&amount=100&slippageBps=100');
  const body = '{"quoteResponse":{"inputMint":"A","outputMint":"B","inAmount":"100","outAmount":"90","otherAmountThreshold":"89","priceImpactPct":"0","slippageBps":100},"userPublicKey":"wallet","wrapAndUnwrapSol":true,"dynamicComputeUnitLimit":true,"asLegacyTransaction":false,"prioritizationFeeLamports":{"priorityLevelWithMaxLamports":{"maxLamports":123,"priorityLevel":"high"}}}';
  expect(calls[1]).toEqual({ url: 'https://lite-api.jup.ag/swap/v1/swap', body });
  await client.getQuote({ ...request, asLegacyTransaction: true, maxAccounts: 32 });
  await client.buildSwap({ quote, userPublicKey: 'wallet', maxPriorityFeeLamports: 123, asLegacyTransaction: true });
  expect(calls[2]?.url).toBe(calls[0]!.url + '&asLegacyTransaction=true&maxAccounts=32');
  expect(calls[3]?.body).toBe(body.replace('"asLegacyTransaction":false', '"asLegacyTransaction":true'));
});

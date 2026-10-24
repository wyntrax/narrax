import {z} from 'zod';

export const TRADEABILITY_USDC_MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const TRADEABILITY_MAX_AGE_MS=10*60_000;
const amount=z.string().regex(/^[1-9]\d{0,39}$/);
/** Versioned research quote provenance. Legacy impact-only cache entries are not admissible evidence. */
export const TradeabilityQuoteSchema=z.object({
 version:z.literal(1),mint:z.string().min(1),source:z.literal('jupiter'),sourceAt:z.string().datetime({offset:true}),
 direction:z.literal('BUY'),inputMint:z.literal(TRADEABILITY_USDC_MINT),inAmount:z.literal('50000000'),
 outAmount:amount,otherAmountThreshold:amount,slippageBps:z.literal(50),routeCount:z.number().int().min(1).max(100),
 ticketUsdc:z.literal(50),priceImpactPct:z.number().finite().min(0).max(100),
}).refine(q=>BigInt(q.otherAmountThreshold)<=BigInt(q.outAmount),{message:'Minimum output exceeds quoted output'});
export type TradeabilityQuote=z.infer<typeof TradeabilityQuoteSchema>;

import {z} from 'zod';
import {isSolanaAddress} from './solana-address';

export const TradeAddress=z.string().max(44).refine(isSolanaAddress);
export const TradeUnits=z.string().regex(/^\d{1,20}$/);
export const TradeRequest=z.object({reviewId:z.string().min(1).max(100),mint:TradeAddress,wallet:TradeAddress,side:z.enum(['BUY','SELL']),amount:z.string().regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,9})?$/),slippageBps:z.number().int().min(10).max(300)}).strict();
export const TradeState=z.enum(['PREPARED','SUBMITTED','CONFIRMED','FAILED','EXPIRED']);
export const TradeQuote=z.object({inputMint:TradeAddress,outputMint:TradeAddress,inAmount:TradeUnits,outAmount:TradeUnits,minOut:TradeUnits,inputDecimals:z.number().int(),outputDecimals:z.number().int(),slippageBps:z.number().int(),priceImpactPct:z.number().finite().nonnegative().nullable(),networkFeeLamports:TradeUnits,priorityFeeLamports:TradeUnits,maxOverheadLamports:TradeUnits});
export const TradeRecord=z.object({id:z.string(),mint:TradeAddress,wallet:TradeAddress,side:z.enum(['BUY','SELL']),status:TradeState,signature:z.string().nullable(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),quote:TradeQuote});
export const TradePreview=TradeRecord.extend({transaction:z.string().min(1).max(1644)});
export const TradeHistory=z.object({items:z.array(TradeRecord)});
export const TradeConfig=z.object({enabled:z.boolean(),chain:z.literal('solana:mainnet'),wallets:z.array(TradeAddress)});
export const TradeBalances=z.object({wallet:TradeAddress,mint:TradeAddress,sol:TradeUnits,token:TradeUnits,decimals:z.number().int(),at:z.string().datetime()});
export const TradeReview=z.object({
 id:z.string(),mint:TradeAddress,symbol:z.string(),name:z.string(),imageUrl:z.string().nullish(),at:z.string().datetime(),expiresAt:z.string().datetime(),
 buyBlockers:z.array(z.string()),notes:z.array(z.string()),
 market:z.object({at:z.string().datetime(),source:z.string(),priceUsd:z.number(),liquidityUsd:z.number(),volume24hUsd:z.number(),marketCapUsd:z.number(),marketCapIsFdv:z.boolean(),fresh:z.boolean()}).nullable(),
 holders:z.object({at:z.string().datetime(),count:z.number(),top10Pct:z.number(),fresh:z.boolean()}).nullable(),
 risk:z.object({at:z.string().datetime(),flags:z.array(z.string()),fresh:z.boolean()}).nullable(),
 narratives:z.object({access:z.boolean(),items:z.array(z.object({slug:z.string(),name:z.string(),relation:z.string(),confidence:z.number()}))}),
 smartMoney:z.object({access:z.boolean(),items:z.array(z.object({id:z.string(),at:z.string().datetime(),side:z.enum(['BUY','SELL']),wallets:z.number(),entities:z.number(),netSol:z.number(),fresh:z.boolean()}))}),
});
export type TradeReviewData=z.infer<typeof TradeReview>;
export type TradeQuoteData=z.infer<typeof TradeQuote>;

/** Exact decimal parsing; never use floating-point arithmetic for wallet amounts. */
export function tradeBaseUnits(value:string,decimals:number):bigint{
 if(!Number.isInteger(decimals)||decimals<0||decimals>9||!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,9})?$/.test(value))throw Error('INVALID_AMOUNT');
 const [whole,fraction='']=value.split('.');
 if(fraction.length>decimals)throw Error('INVALID_AMOUNT');
 const units=BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 if(units<=0n||units>18446744073709551615n)throw Error('INVALID_AMOUNT');
 return units;
}
export function tradeDisplayUnits(value:string,decimals:number):string{
 const padded=value.padStart(decimals+1,'0');
 return decimals?`${padded.slice(0,-decimals)}.${padded.slice(-decimals)}`.replace(/\.?0+$/,''):value;
}

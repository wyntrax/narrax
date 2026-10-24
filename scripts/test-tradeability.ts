import {TRADEABILITY_USDC_MINT,type TradeabilityQuote} from '@narra/shared';
/** Synthetic quote provenance for tests only. Never a provider observation. */
export function testTradeability(mint:string,at:Date,priceImpactPct=1):TradeabilityQuote{
 return {version:1,mint,source:'jupiter',sourceAt:at.toISOString(),direction:'BUY',inputMint:TRADEABILITY_USDC_MINT,inAmount:'50000000',outAmount:'1000000',otherAmountThreshold:'995000',slippageBps:50,routeCount:1,ticketUsdc:50,priceImpactPct};
}

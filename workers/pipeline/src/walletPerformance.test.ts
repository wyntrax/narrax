import { expect, it } from 'vitest';
import { WalletPerformance } from '@narra/shared';
import { computeWalletPerformance, type PerformanceTrade } from './walletPerformance';

const now = new Date('2026-10-26T12:00:00Z');
function trade(side:'BUY'|'SELL',sol:string,qty:string,minute:number,cap:string|null='85000',token='a'):PerformanceTrade {
  const at = new Date(+now-(100-minute)*60_000);
  return {id:`${token}-${minute}`,tokenId:token,side,amountSol:sol,tokenAmount:qty,at,marketCapUsd:cap,
    evidence:{eventAt:at.toISOString(),market:{at:at.toISOString(),source:'dexscreener',marketCapIsFdv:false}}};
}
const band = (rows:PerformanceTrade[]) => computeWalletPerformance(rows,now).bands.find(b=>b.band==='SMALL_CAP')!;
it('counts a partial exit once, with distinct first-sell/close durations and exact decimal cost',()=>{
  const rows=[trade('BUY','0.3','0.3',0),trade('SELL','0.2','0.1',10),trade('SELL','0.4','0.2',20)];
  expect(band(rows)).toMatchObject({closedPositions:1,wins:1,winRate:1,realisedPnlSol:'0.3',medianFirstSellSeconds:600,medianCloseSeconds:1200,openCostSol:'0'});
  expect(WalletPerformance.safeParse(computeWalletPerformance(rows,now)).success).toBe(true);
});
it('does not count an open partial sale as a win or pretend remaining swap inventory is an on-chain balance',()=>{
  expect(band([trade('BUY','10','100',0),trade('SELL','9','50',10)])).toMatchObject({closedPositions:0,winRate:null,realisedPnlSol:'4',openPositions:1,openCostSol:'5',medianCloseSeconds:null});
});
it('captures catastrophic losses despite a high win rate and treats zero proceeds as a loss',()=>{
  const rows=Array.from({length:9},(_,i)=>[trade('BUY','1','10',0,'85000',String(i)),trade('SELL','2','10',10,'85000',String(i))]).flat();
  rows.push(trade('BUY','100','10',0,'85000','loss'),trade('SELL','0','10',20,'85000','loss'));
  expect(band(rows)).toMatchObject({winRate:.9,realisedPnlSol:'-91',medianLossSol:'-100',realisedDrawdownSol:'100',profitFactor:.09});
});
it('excludes unknown cost basis instead of inventing free tokens or prorating oversized sales',()=>{
  const result=computeWalletPerformance([trade('BUY','1','10',0),trade('SELL','20','11',10)],now);
  expect(result.unmatchedSells).toBe(1);expect(result.bands.find(b=>b.band==='ALL')?.positions).toBe(0);
});
it('keeps absent, future, FDV and stale entry-cap evidence unknown and never reclassifies using the exit cap',()=>{
  for(const patch of [null,{at:new Date(+now).toISOString(),source:'dexscreener',marketCapIsFdv:false},{at:new Date(+now-86400000).toISOString(),source:'dexscreener',marketCapIsFdv:false},{at:trade('BUY','1','10',0).at.toISOString(),source:'dexscreener',marketCapIsFdv:true}]){
    const buy=trade('BUY','1','10',0);buy.evidence={eventAt:buy.at.toISOString(),market:patch};
    const result=computeWalletPerformance([buy,trade('SELL','2','10',10,'2000000')],now);
    expect(result.bands.find(b=>b.band==='UNKNOWN')?.closedPositions).toBe(1);
    expect(result.bands.find(b=>b.band==='SMALL_CAP')?.positions).toBe(0);
  }
  expect(band([trade('BUY','1','10',0),trade('SELL','2','10',10,'2000000')]).closedPositions).toBe(1);
});
it('uses exact entry-band boundaries, ignores future trades, and penalises tiny win samples',()=>{
  for(const [cap,expected] of [['99999','UNDER_100K'],['100000','100K_500K'],['500000','500K_1M'],['1000000','OVER_1M']]){
    const result=computeWalletPerformance([trade('BUY','1','10',0,cap),trade('SELL','2','10',10,cap),trade('SELL','2','1',101,cap)],now);
    const b=result.bands.find(b=>b.band===expected)!;expect(b.closedPositions).toBe(1);expect(b.winRateLowerBound).toBeLessThan(.3);expect(result.observedTrades).toBe(2);
  }
});

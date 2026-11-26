import { expect, it } from 'vitest';
import { WalletOpenPositions, WalletPerformance } from '@narra/shared';
import { computeCopyTradeSimulation, computeWalletClosedSummary, computeWalletOpenPositions, computeWalletPerformance, type PerformanceTrade } from './walletPerformance';

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
it('reports exact remaining inventory for open and partially sold positions',()=>{
  const rows=[trade('BUY','10','100',0),trade('SELL','9','50',10),trade('BUY','1','10',20,'85000','closed'),trade('SELL','2','10',30,'85000','closed')];
  const open=computeWalletOpenPositions(rows,now);
  expect(WalletOpenPositions.safeParse(open).success).toBe(true);
  expect(open).toMatchObject({version:1,windowDays:30,observedTrades:4,capped:false,invalidTrades:0,unmatchedSells:0});
  expect(open.positions).toEqual([expect.objectContaining({
    tokenId:'a',entryTradeId:'a-0',band:'UNDER_100K',quantity:'50',remainingCostSol:'5',investedSol:'10',entrySol:'10',
    openedAt:new Date(+now-100*60_000).toISOString(),lastTradeAt:new Date(+now-90*60_000).toISOString(),partiallySold:true,
  })]);
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
it('separates first entries, recycled buy turnover, closed position spend and wallet-wide cap coverage',()=>{
  const rows=[trade('BUY','.00003','10',0),trade('BUY','.09997','10',1),trade('SELL','.2','20',10),
    trade('BUY','2','10',20),trade('SELL','3','10',30),trade('BUY','100','1',40,null,'unknown')];
  const result=computeWalletPerformance(rows,now),small=result.bands.find(b=>b.band==='SMALL_CAP')!;
  expect(small).toMatchObject({medianEntrySol:'1.000015',deployedSol:'2.1',medianClosedPositionSol:'1.05',entryCapKnownPositions:2,entryCapTotalPositions:3});
  expect(result.bands.find(b=>b.band==='ALL')).toMatchObject({deployedSol:'102.1',medianClosedPositionSol:'1.05',medianEntrySol:'2'});
});
it('treats sells within 1e-9 relative float dust as full closes without false contamination',()=>{
  const rows=[
    trade('BUY','1','1000000',0,'85000','overshoot'),
    trade('SELL','2','1000000.0005',10,'85000','overshoot'),
    trade('BUY','1','1000000',20,'85000','undershoot'),
    trade('SELL','1.5','999999.9995',30,'85000','undershoot'),
  ];
  const result=computeWalletPerformance(rows,now);
  expect(result).toMatchObject({unmatchedSells:0,invalidTrades:0});
  expect(result.bands.find(b=>b.band==='SMALL_CAP')).toMatchObject({closedPositions:2,openPositions:0,wins:2,realisedPnlSol:'1.5'});
});
it('classifies swap_implied entry caps and flags wiped open positions held over 24h as dead bags',()=>{
  const oldAt=new Date(+now-30*3_600_000);
  const rows=[
    {id:'s1',tokenId:'bag',side:'BUY' as const,amountSol:'2',tokenAmount:'1000',marketCapUsd:'75000',at:oldAt,
      evidence:{eventAt:oldAt.toISOString(),market:{at:oldAt.toISOString(),source:'swap_implied',marketCapIsFdv:false}}},
    {id:'s2',tokenId:'alive',side:'BUY' as const,amountSol:'1',tokenAmount:'100',marketCapUsd:'200000',at:oldAt,
      evidence:{eventAt:oldAt.toISOString(),market:{at:oldAt.toISOString(),source:'swap_implied',marketCapIsFdv:false}}},
  ];
  // SOL = $100: bag worth 1000 * $0.005 / $100 = 0.05 SOL (2.5% of 2 SOL => dead bag); alive worth 100 * $1.5 / $100 = 1.5 SOL (+0.5 SOL)
  const mtm={solUsd:100,prices:new Map([['bag',{priceUsd:0.005,liquidityUsd:5000}],['alive',{priceUsd:1.5,liquidityUsd:50000}]])};
  const result=computeWalletPerformance(rows,now,false,mtm);
  const sc=result.bands.find(b=>b.band==='SMALL_CAP')!;
  expect(sc).toMatchObject({positions:2,openPositions:2,entryCapKnownPositions:2,deadBagPositions:1,deadBagCostSol:'2'});
  expect(Number(sc.openValueSol)).toBeCloseTo(1.55,4);
  expect(Number(sc.unrealisedPnlSol)).toBeCloseTo(-1.45,4);
});
it('builds a chronological realised equity curve and top winners/losers summary',()=>{
  const rows=[
    trade('BUY','1','10',0,'80000','win1'),trade('SELL','3','10',10,'80000','win1'),
    trade('BUY','2','10',20,'80000','loss1'),trade('SELL','0.5','10',30,'80000','loss1'),
    trade('BUY','1','10',40,'80000','win2'),trade('SELL','2','10',50,'80000','win2'),
  ];
  const summary=computeWalletClosedSummary(rows,now);
  expect(summary.equityCurve.map(p=>p.cumulativePnlSol)).toEqual([2,0.5,1.5]);
  expect(summary.topWinners.map(p=>[p.tokenId,p.pnlSol])).toEqual([['win1',2],['win2',1]]);
  expect(summary.topLosers.map(p=>[p.tokenId,p.pnlSol])).toEqual([['loss1',-1.5]]);
});
it('simulates fixed-size copy trading across entry delays, skipping un-copyable fast exits and deducting friction',()=>{
  const fastAt=new Date(+now-3_600_000);
  const rows=[
    // Fast 30s exit: skipped by all presets (minHold 60s / 240s / 1200s)
    {id:'f1',tokenId:'fast',side:'BUY' as const,amountSol:'1',tokenAmount:'10',marketCapUsd:null,evidence:null,at:fastAt},
    {id:'f2',tokenId:'fast',side:'SELL' as const,amountSol:'2',tokenAmount:'10',marketCapUsd:null,evidence:null,at:new Date(+fastAt+30_000)},
    // 10-minute winner (+100% raw ROI): eligible at 30s & 2m delays, skipped at 10m delay (minHold 20m)
    trade('BUY','1','10',0,'80000','mid'),trade('SELL','2','10',10,'80000','mid'),
    // 30-minute loser (-50% raw ROI): eligible at all delays
    trade('BUY','2','10',20,'80000','slow'),trade('SELL','1','10',50,'80000','slow'),
  ];
  const sim=computeCopyTradeSimulation(rows,now);
  expect(sim).toHaveLength(3);
  expect(sim[0]).toMatchObject({delaySeconds:30,eligiblePositions:2,skippedTooFast:1,winRate:0.5});
  expect(sim[0]!.netPnlPerSol).toBeCloseTo((1-0.015)+(-0.5-0.015),4);
  expect(sim[2]).toMatchObject({delaySeconds:600,eligiblePositions:1,skippedTooFast:2,winRate:0});
});
it('closes sold positions leaving <=1% token dust (or <=5% with <=0.005 SOL cost) without breaking later dust sells',()=>{
  const rows=[
    // Sold 99.2% (0.8% dust left) -> dust-closed winner
    trade('BUY','1','1000',0,'85000','dust99'),trade('SELL','1.5','992',10,'85000','dust99'),
    // Sold 99.2%, then later sold the remaining 0.8% dust -> must NOT trigger unmatchedSells
    trade('BUY','1','1000',15,'85000','dustLater'),trade('SELL','1.5','992',20,'85000','dustLater'),trade('SELL','0.01','8',30,'85000','dustLater'),
    // Sold 96% of 0.1 SOL buy (0.004 SOL cost left <= 0.005 SOL) -> dust-closed
    trade('BUY','0.1','1000',35,'85000','dustCost'),trade('SELL','0.2','960',45,'85000','dustCost'),
    // Sold only 50% of a tiny 0.004 SOL buy -> must stay OPEN
    trade('BUY','0.004','1000',50,'85000','partialTiny'),trade('SELL','0.003','500',55,'85000','partialTiny'),
  ];
  const result=computeWalletPerformance(rows,now);
  expect(result).toMatchObject({unmatchedSells:0,invalidTrades:0});
  expect(result.bands.find(b=>b.band==='SMALL_CAP')).toMatchObject({positions:4,closedPositions:3,openPositions:1,wins:3,winRate:1});
});

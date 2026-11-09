import { expect, it, vi } from 'vitest';
import { EntryCapLookupBudgetReached, previewEntryCapCoverage, type EntryCapAuditWallet } from './walletEntryCapAudit';
import { computeWalletPerformance, walletEntryCapPositions } from './walletPerformance';

const now=new Date('2040-01-01T12:00:00Z');
const address='So11111111111111111111111111111111111111112';
function trade(id:string,side:'BUY'|'SELL'='BUY',tokenId=id,minute=0,qty='1'){
  return {id,tokenId,side,amountSol:'1',tokenAmount:qty,amountUsd:null,marketCapUsd:null,at:new Date(+now-600000+minute*60000),evidence:null} as EntryCapAuditWallet['rows'][number];
}
const wallet=(rows:EntryCapAuditWallet['rows'],id='w'):EntryCapAuditWallet=>({id,address,rows,tradesCapped:false});
function evidence(at:Date,cap=85000){return {market:{metricId:'metric',at:at.toISOString(),marketCapUsd:cap,priceUsd:1,liquidityUsd:10000,source:'dexscreener' as const,pairAddress:'pair',marketCapIsFdv:false},reason:null};}

it('counts actual position entries, not adds or partial sells, and excludes contaminated tokens',async()=>{
  const rows=[trade('entry','BUY','a',0),trade('add','BUY','a',1),trade('partial','SELL','a',2),trade('close','SELL','a',3),
    trade('again','BUY','a',4),trade('open','BUY','b',0),trade('bad','BUY','c',0),trade('oversell','SELL','c',2,'2')];
  const before=structuredClone(rows),lookup=vi.fn(async(_token:string,at:Date)=>evidence(at));
  const report=await previewEntryCapCoverage([wallet(rows)],now,lookup);
  expect(lookup).toHaveBeenCalledTimes(3);
  expect(report.items[0]?.recoveries.map(r=>r.entryTradeId)).toEqual(['again','entry','open']);
  expect(report.summary).toMatchObject({positions:3,unknownBefore:3,recoverablePositions:3,recoverableClosedPositions:1,unknownAfterPreview:0});
  expect(report.items[0]?.smallCapClosedPositionGain).toBe(1);
  expect(rows).toEqual(before);
  expect(walletEntryCapPositions(rows,now)).toHaveLength(computeWalletPerformance(rows,now).bands.find(b=>b.band==='ALL')!.positions);
});
it('preserves frozen caps and the reconciliation legacy valuation guard',async()=>{
  const existing={...trade('existing'),marketCapUsd:'80000'},legacy={...trade('legacy'),amountUsd:99};
  const known={...trade('known'),marketCapUsd:'80000',evidence:{eventAt:trade('known').at.toISOString(),market:evidence(trade('known').at).market}};
  const report=await previewEntryCapCoverage([wallet([existing,legacy,known])],now,vi.fn());
  expect(report.summary).toMatchObject({positions:3,knownBefore:1,unknownBefore:2,recoverablePositions:0,
    unknownEntryReasons:{EXISTING_CAP_NOT_REPAIRABLE:1,LEGACY_VALUATION_GUARD:1}});
});
it('keeps missing/FDV/later-only evidence unknown with explicit reasons',async()=>{
  for(const reason of ['FDV_ONLY','TRADE_BEFORE_MARKET_HISTORY','INVALID_MARKET_PROVENANCE','NO_TOKEN_MARKET_HISTORY','MARKET_LOOKUP_LIMIT']){
    const r=await previewEntryCapCoverage([wallet([trade('a')])],now,async()=>({market:null,reason}));
    expect(r.summary.unknownAfterPreview).toBe(1);expect(r.summary.unknownEntryReasons[reason]).toBe(1);
  }
});
it('rejects a purported recovery whose evidence is future-dated, stale or FDV',async()=>{
  const row=trade('a');
  for(const market of [evidence(new Date(+row.at+1)).market,evidence(new Date(+row.at-900001)).market,{...evidence(row.at).market,marketCapIsFdv:true}]){
    const r=await previewEntryCapCoverage([wallet([row])],now,async()=>({market,reason:null}));
    expect(r.summary).toMatchObject({recoverablePositions:0,unknownAfterPreview:1,unknownEntryReasons:{CANDIDATE_EVIDENCE_REJECTED:1}});
  }
});
it('allows missing cap recovery with existing USD only when event provenance matches',async()=>{
  const row=trade('a');row.amountUsd='150';row.evidence={eventAt:row.at.toISOString(),sol:{source:'original'}};
  const before=structuredClone(row);
  const r=await previewEntryCapCoverage([wallet([row])],now,async(_,at)=>evidence(at));
  expect(r.summary.recoverablePositions).toBe(1);expect(row).toEqual(before);
});
it('classifies recovered caps at the exact small-cap band ceiling',async()=>{
  const rows=[trade('a','BUY','a'),trade('a-close','SELL','a',1),trade('b','BUY','b'),trade('b-close','SELL','b',1)];
  const r=await previewEntryCapCoverage([wallet(rows)],now,async(token,at)=>evidence(at,token==='a'?999999:1000000));
  expect(r.items[0]).toMatchObject({knownClosedPositionGain:2,smallCapClosedPositionGain:1});
});
it('round-robins the lookup budget, preserves unknown denominators and provides per-wallet continuation',async()=>{
  const r=await previewEntryCapCoverage([wallet([trade('a'),trade('b'),trade('c')],'w1'),wallet([trade('d'),trade('e')],'w2')],now,async(_,at)=>evidence(at),{entryLimit:3});
  expect(r.items.map(w=>w.checkedEntries)).toEqual([2,1]);
  expect(r.items.map(w=>w.nextEntryCursor)).toEqual(['b','d']);
  expect(r.summary).toMatchObject({positions:5,unknownBefore:5,recoverablePositions:3,unknownAfterPreview:2,unknownEntryReasons:{RECOVERABLE:3,NOT_EXAMINED:2}});
  const page=await previewEntryCapCoverage([wallet([trade('a'),trade('b'),trade('c')])],now,async(_,at)=>evidence(at),{wallet:address,afterEntry:'b'});
  expect(page.items[0]).toMatchObject({checkedEntries:1,entryContinuationRequired:false,knownPositionGain:1,unknownEntryReasons:{BEFORE_ENTRY_CURSOR:2,RECOVERABLE:1}});
});
it('returns a partial report when the query budget interrupts a lookup without advancing its cursor',async()=>{
  let calls=0;
  const r=await previewEntryCapCoverage([wallet([trade('a'),trade('b')])],now,async(_,at)=>{if(++calls===2)throw new EntryCapLookupBudgetReached();return evidence(at);});
  expect(r.lookup).toMatchObject({checked:1,queryBudgetReached:true,remainingEligible:1});
  expect(r.items[0]).toMatchObject({nextEntryCursor:'a',entryContinuationRequired:true});
});
it('does not disguise lookup failures as missing historical evidence',async()=>{
  await expect(previewEntryCapCoverage([wallet([trade('a')])],now,async()=>{throw new Error('Database failure');})).rejects.toThrow('Database failure');
});
it('reports empty denominators and truncation explicitly',async()=>{
  const r=await previewEntryCapCoverage([{...wallet([]),tradesCapped:true}],now,vi.fn());
  expect(r.items[0]).toMatchObject({before:{positions:0,knownPercent:null},percentagePointGain:null,tradesCapped:true});
  expect(r.scope.cappedWallets).toBe(1);
});
it.each([{entryLimit:0},{entryLimit:501},{walletLimit:11},{afterEntry:'a'},{wallet:'invalid'},{wallet:address,afterWallet:'a'}])('rejects invalid bounds/cursors %j',async options=>{
  await expect(previewEntryCapCoverage([],now,vi.fn(),options)).rejects.toThrow();
});

import type {RadarSafetyView} from '@narra/shared';
/** Synthetic evidence for UI tests only; never used by application data paths. */
export function safetyFixture():RadarSafetyView{
 const at='2026-10-23T12:00:00.000Z';
 return {state:'RECORDED',alertId:'fixture-alert',alertAt:at,evidenceStale:true,snapshot:{
  policyVersion:'radar-safety-v1',mode:'shadow',status:'BLOCK',wouldBlock:true,blockers:['TOP10_CONCENTRATION'],unknowns:['BUNDLE_SNIPER_INSIDER'],warnings:['AUTHORITY_NOT_PROVEN'],evaluatedAt:at,
  checks:[{code:'TOP10_CONCENTRATION',severity:'CRITICAL',status:'BLOCK',value:40,threshold:'< 35%',detail:'Reported concentration'},{code:'BUNDLE_SNIPER_INSIDER',severity:'CRITICAL',status:'UNKNOWN',value:null,threshold:'< 20%'},{code:'AUTHORITY_NOT_PROVEN',severity:'WARN',status:'WARN',value:false,threshold:null},{code:'DEV_HOLDING',severity:'CRITICAL',status:'PASS',value:0,threshold:'<= 10%'}],
  facts:{tokenId:'fixture-token',mint:'So11111111111111111111111111111111111111112',profile:'trencher',route:'NARRATIVE',matchKind:'NAME',tier:'WATCH',score:60,metricId:'m',holderMetricId:'h',riskMetricId:'r',marketAt:at,holdersAt:at,riskAt:at,priceUsd:.01,marketCapUsd:50000,liquidityUsd:20000,volume24hUsd:30000,holders:500,top10Pct:40,top10ExLpPct:20,devHoldingPct:0,riskFlags:[],priceGrowth1hPct:0,priceGrowth3hPct:0,narrativeManipulationRisk:0,lpBurnedPct:100,lpLocked:true,bundlePct:null,sniperPct:null,insiderPct:null,uniqueBuyers24h:null,uniqueSellers24h:null,priceImpactPct:null,deployerPriorRugs:null,evidenceSource:'rugcheck',evidenceAt:at},
 }};
}

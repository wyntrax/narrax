const at='2026-10-26T12:00:00.000Z';
const described={n:1,distinctTokens:1,mean:0,median:0,p10:0,p90:0,meanCi:null,winRate:0,winRateCi:null,sufficient:false,note:'INSUFFICIENT DATA: one known result.'};
export function analyticsFixture(path:string,url:URL){
 const action=url.searchParams.get('action')??'BUY',costPct=action==='BUY'?3:0;
 const returns={...described,mean:-costPct,median:-costPct,p10:-costPct,p90:-costPct};
 if(path.endsWith('/decisions/summary'))return {range:{days:Number(url.searchParams.get('days')??30)},action,costPct,decisions:{total:6,awaitingMeasurement:1,read:5,independent:5,pending:1,final:4,known:1,unknown:3,unknownRate:.75,truncated:false},labels:{WIN:0,LOSS:0,FLAT:1},returns,medianLeadTimeSeconds:null,byConfidence:[],caveats:['Stored price observations only.']};
 if(path.endsWith('/signals'))return {action,costPct,truncated:false,byReasonCode:[{label:'SMART_MONEY',described:returns}],caveats:[]};
 if(path.endsWith('/decisions/outcomes'))return {items:[
  {decisionId:'entry',token:{mint:'So11111111111111111111111111111111111111112',symbol:'ENTRY'},isFinal:true,unknownReason:'NO_ENTRY_PRICE'},
  {decisionId:'horizon',token:{mint:'So11111111111111111111111111111111111111112',symbol:'HORIZON'},isFinal:true,unknownReason:'NO_HORIZON_PRICE',return1hPct:2},
  {decisionId:'pending',token:{mint:'So11111111111111111111111111111111111111112',symbol:'PENDING'},isFinal:false,unknownReason:'NOT_YET',return1hPct:1},
  {decisionId:'legacy',token:{mint:'So11111111111111111111111111111111111111112',symbol:'LEGACY'},isFinal:true,unknownReason:null},
  {decisionId:'known',token:{mint:'So11111111111111111111111111111111111111112',symbol:'KNOWN'},isFinal:true,unknownReason:null,label:'FLAT',return24hPct:0,maxGainPct:0,maxDrawdownPct:0},
 ].map(o=>({action,confidence:.7,decidedAt:at,label:'UNKNOWN',return1hPct:null,return24hPct:null,maxGainPct:null,maxDrawdownPct:null,leadTimeSeconds:null,...o})),nextCursor:url.searchParams.has('cursor')?null:'fixture-cursor'};
 return undefined;
}

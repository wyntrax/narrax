import {expect,type Page} from '@playwright/test';
import {empty,ADDRESS,publicResearchSnapshot} from '../src/test/fixtures';
const at='2026-10-12T12:00:00.000Z';
export const narrative={id:'n1',slug:'robotics',name:'Robotics',stage:'ACCELERATING',score:82,velocity:124,acceleration:12,organicScore:76,saturationRisk:18,firstDetectedAt:at,updatedAt:at,tokenCount:1};
export const observation={source:'dexscreener',at,stale:false,marketCapIsFdv:true,priceChange1hPct:0,pairAddress:ADDRESS,dexId:'raydium',pairCreatedAt:at};
export const token={mint:ADDRESS,symbol:'ROBOT',name:'Robotics sample',priceUsd:.012,marketCapUsd:120000,liquidityUsd:45000,volume24hUsd:18000,observation};
export const opportunity={id:'o1',createdAt:at,score:78,scores:{narrative:82,smartMoney:74,liquidity:52,momentum:63,og:70,risk:24},attentionGrowth:14,priceGrowth:null,token,narrative:{name:narrative.name,slug:narrative.slug,stage:narrative.stage},decision:{action:'WATCH',confidence:.63}};
export const access={...empty,effectiveTier:'PRO',researchPageLimit:70,features:Object.fromEntries(Object.entries(empty.features).map(([key,value])=>[key,{...value,allowed:key!=='research.chat'&&key!=='research.advanced_analytics'}]))};
export const overview={at,bar:{solUsd:{priceUsd:150,at,stale:false},narrativeHeat:82,smartMoneyNetFlowSol24h:18,smartMoneyTokens24h:2,counts:{activeNarratives:3,acceleratingNarratives:1,trackedWallets:14,opportunities24h:2}},locked:{overview:false,narratives:false,rotation:false,opportunities:false},strip:{topNarratives:[narrative],hottestOpportunity:opportunity},rotation:{detected:false,window:'24h',rising:[],falling:[],unknown:1},brief:{generated:'rules',points:['Robotics leads the recorded narratives.']},me:{openPositions:2,pendingConfirmations:0,unreadAlerts:1}};
export const responses:Record<string,unknown>={
  '/v1/smart-money/rankings':{asOf:at,band:'SMALL_CAP',windowDays:30,total:0,capped:false,pipeline:null,items:[]},
  '/v1/paper-trades/account':{mode:'PAPER',balanceSol:10,feeSol:.002,quotesAvailable:false,entryPermission:false,paused:false},
  '/v1/market-preview':{at,solUsd:overview.bar.solUsd,narrativeHeat:82,trackedWallets:14,opportunities24h:2},
  '/v1/me':{isAdmin:false},'/v1/me/entitlements':access,'/v1/overview':overview,'/v1/alerts/unread-count':{unread:1,capped:false},
  '/v1/settings':{profile:{displayName:null,timezone:null},appearance:{theme:'DARK',density:'COMFORTABLE',reducedMotion:false},notifications:{minPriority:'WATCH',mutedKinds:[],mutableKinds:[],alwaysDelivered:['CRITICAL']}},
 '/v1/narratives':{items:[narrative],nextCursor:null},
 '/v1/narratives/robotics':{...narrative,summary:'A recorded narrative with incomplete history.',latestMetric:{at,mentionVelocity:124,creatorVelocity:18,engagementVelocity:62,manipulationRisk:15,smartMoneyCorrelation:null},creators:[{platform:'X',handle:'research_sample',role:'ORIGINATOR'}],tokens:[{...token,relation:'LIKELY_OG',ogScore:70,confidence:.7}]},
 '/v1/narratives/rotation':{...overview.rotation,asOf:at,rules:{minDeltaPoints:10,minScoreEitherEnd:30},note:'Historical comparison only.'},
 '/v1/opportunities':{items:[opportunity],nextCursor:null},
 '/v1/opportunities/o1/analysis':{opportunityId:'o1',analyzedAt:at,model:'fixture-model',bull:{arguments:['Recorded activity increased.'],strength:.6,keyUncertainties:['Limited history.']},bear:{arguments:['Liquidity is thin.'],strength:.7,keyUncertainties:[]},risk:{risks:[{code:'LIQUIDITY',description:'Price impact is uncertain.',severity:'HIGH'}],maxLossScenario:'Full loss is possible.'},decision:{action:'WATCH',confidence:.63,summary:'Wait for more evidence.',invalidationConditions:['Activity falls.']},guardrails:['No execution route is available.']},
 '/v1/tokens':{items:[token],nextCursor:null},
 [`/v1/tokens/${ADDRESS}`]:{...token,blacklisted:false,createdOnChainAt:null,metrics:{priceUsd:token.priceUsd,marketCapUsd:token.marketCapUsd,liquidityUsd:token.liquidityUsd,volume24hUsd:18000,at},holders:{holders:72,top10Pct:40,devHoldingPct:null,smartWalletHolders:3,at},risk:{riskScore:24,flags:['LOW_LIQUIDITY'],at},consensus:{score:74,walletCount:5,independentEntities:3,leaderCount:1,netFlowSol:18,timingConcentration:.4},narratives:[{...narrative,relation:'LIKELY_OG',ogScore:70}]}
};
responses[`/v1/tokens/${ADDRESS}/history`]={window:'24h',asOf:at,points:[{at:'2026-10-12T11:55:00.000Z',priceUsd:.011,source:'dexscreener',pairAddress:ADDRESS},{at,priceUsd:.012,source:'dexscreener',pairAddress:ADDRESS}],truncated:false,excludedUnverified:0};
export async function researchApi(page:Page,override?:(path:string,url:URL)=>{status?:number;body:unknown}|undefined){
 const requests:string[]=[];
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':req.headers().origin??'http://localhost:4010','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({headers,status:204});
  expect(req.method()).toBe('GET');
   if(url.pathname==='/v1/early-access/status')return route.fulfill({headers,json:{enabled:true,seatsLeft:12,inviteRequired:false}});
    if(url.pathname==='/v1/public-config')return route.fulfill({headers,json:{privyAppId:null}});
    if(url.pathname==='/v1/public-research-snapshot'){
     expect(req.headers().authorization).toBeUndefined();const value=override?.(url.pathname,url);
     return route.fulfill({headers,status:value?.status??200,json:value?.body??publicResearchSnapshot});
    }
  expect(req.headers().authorization).toBe('Bearer fixture-public-test-token');requests.push(url.pathname+url.search);
  const value=override?.(url.pathname,url);return route.fulfill({headers,status:value?.status??(value||responses[url.pathname]?200:404),json:value?.body??responses[url.pathname]??{error:'NOT_FOUND'}});
 });return requests;
}
export async function enterWorkspace(page:Page,path='/app'){await page.goto(path);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('.research-shell')).toBeVisible();}

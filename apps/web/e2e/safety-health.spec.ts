import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {researchApi,enterWorkspace,responses,opportunity,access} from './research-fixtures';
import {safetyFixture} from '../src/test/safety-fixture';
import {latestEvidenceFixture} from '../src/test/latest-evidence-fixture';
import {ADDRESS} from '../src/test/fixtures';

for(const width of [1440,390])for(const screen of ['opportunities','token','health'])test(`recorded safety and collector health: ${screen} ${width}`,async({page,baseURL})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:width===390?'light':'dark',url:baseURL!}]);
 const safety=safetyFixture(),at=safety.alertAt!;
 const health={checkedAt:at,issues:[],queues:[],webhook:{configured:false,lastReceipt:null,sync:null},wallets:{tracked:0,profiles:0,withoutProfile:0,trades30d:0,lastTradeAt:null,lastComputedAt:null,scanned:0,capped:false,missingComputations:0,staleComputations:0,historyCapped:0},market:{scanned:20,total:30,capped:true,fresh:5,stale:10,unverified:4,future:1,lastAt:at,enabled:true,unknownNames:0,withStoredArtwork:12,withoutStoredArtwork:8},analysis:{enabled:false,providerConfigured:false,fastModel:'fixture-fast',reasoningModel:'fixture-reasoning',usedToday:0,budget:0,recentCandidates:0,recentBelowThreshold:0,olderUnanalyzed:0},collectors:[{stage:'market',state:'STALE',lastRecordedAt:at,ageSeconds:1200,maxAgeSeconds:900,counters:{tokensConsidered:150,infoCalls:18}},{stage:'social',state:'UNKNOWN',lastRecordedAt:null,ageSeconds:null,maxAgeSeconds:1800,counters:null}],budgets:{priceTokensPerRun:150,infoCallsPerRun:18,lastPriceTokens:150,lastInfoCalls:18}};
 await researchApi(page,path=>{
  const overrides:Record<string,unknown>={
   '/v1/opportunities':{items:[{...opportunity,radarSafety:safety,latestEvidence:latestEvidenceFixture()},{...opportunity,id:'missing',radarSafety:{state:'NOT_RECORDED',snapshot:null,alertId:'old-alert',alertAt:at,evidenceStale:null}}],nextCursor:null},
    [`/v1/tokens/${ADDRESS}`]:{...(responses[`/v1/tokens/${ADDRESS}`] as object),radarSafety:safety,latestEvidence:latestEvidenceFixture()},
   '/v1/me':{isAdmin:true},'/v1/me/entitlements':{...access,admin:true},
   '/v1/admin/data-health':health,'/v1/admin/entitlements/settings':{items:[]},'/v1/admin/early-access/stats':{occupied:0,available:0,cap:0,active:0,expired:0,revoked:0},'/v1/admin/early-access/grants':{items:[]},
   '/v1/admin/runtime-settings':{privyAppId:{value:'fixture-app',source:'environment'},privyVerificationKey:{value:'',source:'environment'},corsOrigins:{value:[baseURL!],source:'environment',extra:[],environment:[baseURL!]}},
  };return path in overrides?{body:overrides[path]}:undefined;
 });
 await enterWorkspace(page,screen==='health'?'/app/admin':screen==='token'?`/app/tokens/${ADDRESS}`:'/app/opportunities');
 if(screen==='health'){
  const panel=page.getByRole('region',{name:'Collector health'});await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByText('Stale run',{exact:true})).toBeVisible();await expect(panel.getByText(/not a process heartbeat/)).toBeVisible();
  await expect(panel.locator('[data-state="UNKNOWN"]')).toHaveText('Unknown');await expect(panel.getByText(/does not test CDN availability/)).toBeVisible();
 }else{
  if(screen==='opportunities'){
   await expect(page.getByText('Its latest radar call has no safety snapshot')).toBeVisible();
   await page.getByRole('button',{name:'Review this idea'}).first().click();
  }
  const observations=page.getByRole('region',{name:'Latest observed evidence'}).filter({has:page.getByRole('table')});
  await expect(observations).toContainText('50 USDC → token');
  await expect(observations).toContainText('Stale');
  const panel=page.getByRole('region',{name:'Recorded radar safety'}).filter({has:page.getByRole('heading',{name:'Recorded radar safety'})});await expect(panel).toBeVisible();await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByText('BLOCK — recorded blockers')).toBeVisible();
  await expect(panel.getByText('Shadow mode: recorded, not enforced.')).toBeVisible();
  await expect(panel.getByText(/Evidence is now stale/)).toBeVisible();
  await panel.locator('summary').click();await expect(panel.getByRole('table')).toContainText('TOP10_CONCENTRATION');
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const scope=screen==='health'?'.data-health':'.safety-evidence:not(.safety-evidence-compact)';
 expect((await new AxeBuilder({page}).include(scope).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/safety-health-${screen}-${width}.png`});
});

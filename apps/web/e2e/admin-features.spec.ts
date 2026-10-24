import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses,access} from './research-fixtures';
import {FEATURE_TIERS} from '@narra/shared';

// Fixture-only auth and HTTP on the separate development server. No app API/provider/DB calls.
const origin='http://localhost:4010',at='2026-10-19T12:00:00.000Z';
const coverage={checkedAt:at,scope:'ACTIVE_NARRATIVE_OR_RECENT_SOCIAL',scanned:8,total:12,capped:true,socialPriorityCount:3,price:{fresh:3,stale:2,missing:1,future:1,unverified:1},holders:{fresh:2,stale:3,missing:2,future:1},risk:{fresh:4,stale:1,missing:3,future:0},freshPriceAndHolders:2,stages:[{stage:'social',stale:false,latest:{at,runs:1,counters:{'evidence.HOLDERS_MISSING':2}},today:{at,runs:4,counters:{'evidence.HOLDERS_MISSING':7}}},{stage:'market',stale:true,latest:null,today:null}],calls:{published24h:1,unknownEntry24h:0,measurements:{PENDING:3}}};
const health={checkedAt:at,issues:[],queues:[],webhook:{configured:false,lastReceipt:null,sync:null},wallets:{tracked:0,profiles:0,withoutProfile:0,trades30d:0,lastTradeAt:null,lastComputedAt:null,scanned:0,capped:false,missingComputations:0,staleComputations:0,historyCapped:0},market:{scanned:0,total:0,capped:false,fresh:0,stale:0,unverified:0,lastAt:null,enabled:false,unknownNames:0},analysis:{enabled:false,providerConfigured:false,fastModel:'fixture-fast',reasoningModel:'fixture-reasoning',usedToday:0,budget:0,recentCandidates:0,recentBelowThreshold:0,olderUnanalyzed:0}};
for(const width of [1440,390])for(const theme of ['dark','light'])test(`admin feature controls ${width}px ${theme}: spacing, tiers and Agent access`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 let agentTier='PRO';const writes:Record<string,unknown>[]=[];
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PUT,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(req.method()==='PUT'){
   expect(url.pathname).toBe('/v1/admin/entitlements/settings');
   const body=req.postDataJSON();writes.push(body);agentTier=body.settings['entitlements.features']['research.chat'].requiredTier;
   return route.fulfill({headers,json:{ok:true}});
  }
   expect(req.method()).toBe('GET');
   if(url.pathname==='/v1/admin/data-health')return route.fulfill({headers,json:{...health,coverage}});
  const body=url.pathname==='/v1/public-config'?{privyAppId:'fixture-app'}:url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:url.pathname==='/v1/me'?{isAdmin:true}:url.pathname==='/v1/me/entitlements'?{...access,effectiveTier:'MEMBER',rollout:{enforced:true,shadow_log:false},features:{...access.features,'research.chat':{requiredTier:agentTier,allowed:agentTier==='MEMBER',min_entitlement_age_hours:0}}}:url.pathname==='/v1/admin/entitlements/settings'?{items:[{key:'entitlements.enforced',value:true}]}:url.pathname==='/v1/admin/early-access/stats'?{occupied:0,available:0,cap:0,active:0,expired:0,revoked:0}:url.pathname==='/v1/admin/early-access/grants'?{items:[]}:url.pathname==='/v1/admin/data-health'?health:url.pathname==='/v1/admin/runtime-settings'?{privyAppId:{value:'fixture-app',source:'environment'},privyVerificationKey:{value:'',source:'environment'},corsOrigins:{value:[origin],source:'environment',extra:[],environment:[origin]}}:responses[url.pathname];
  expect(body,`unmocked ${url.pathname}`).toBeDefined();return route.fulfill({headers,json:body});
 });
 const enter=async(path:string)=>{await page.goto(`${origin}/en/app/${path}`);await page.getByRole('button',{name:'Continue',exact:true}).click();};
 await enter('agent');await expect(page.getByText('Research access required')).toBeVisible();await expect(page.getByLabel('Your question')).toHaveCount(0);
 await enter('admin');await expect(page.getByRole('heading',{name:'Feature access by tier'})).toBeVisible();
 await expect(page.locator('section[aria-labelledby="admin-features"] select')).toHaveCount(Object.keys(FEATURE_TIERS).length);
 await expect(page.locator('option[value="ELITE"]')).toHaveCount(0);await expect(page.locator('#tier-ELITE')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Wallet webhook'})).toBeVisible();
  const panel=page.locator('section[aria-labelledby="research-coverage-title"]');
  await expect(panel.getByRole('heading',{name:'Research coverage & discovery'})).toBeVisible();
  await expect(panel.getByRole('table',{name:'Collection freshness'})).toContainText('Unverified');
  await panel.locator('summary').filter({hasText:"Social discovery: today's counters"}).click();
  await expect(panel.getByText('evidence.HOLDERS_MISSING',{exact:true})).toBeVisible();
  await expect(panel.getByText(/not unique tokens or missed calls/)).toBeVisible();
 const spacing=await page.locator('.admin-page').evaluate(node=>{
  const boxes=Array.from(node.children).map(el=>el.getBoundingClientRect());
  return boxes.slice(1).every((box,i)=>box.top-boxes[i]!.bottom>=20);
 });expect(spacing).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.locator('#feature-research\\.chat').selectOption('MEMBER');await page.locator('#feature-reason').fill('Member Agent access');
 await page.getByRole('button',{name:'Save feature access'}).click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({reason:'Member Agent access',settings:{'entitlements.features':{'research.chat':{requiredTier:'MEMBER'}}}});
 await enter('agent');await expect(page.getByLabel('Your question')).toBeVisible();
});

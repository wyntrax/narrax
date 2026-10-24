import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses,access} from './research-fixtures';

// Uses the development-only auth fixture and mocked HTTP. No application API/DB calls.
// Start the test web server on 4010 with NARRA_WEB_TEST_AUTH=1 and NEXT_PUBLIC_API_URL=http://localhost:4000.
const origin='http://localhost:4010',at='2026-10-18T12:00:00Z';
const coverage={from:at,to:at,tokens:2,metricPoints:8,firstPointAt:at,lastPointAt:at,medianGapMinutes:null,decisions:4,buyDecisions:2};
const described={n:2,distinctTokens:2,mean:0,median:null,p10:null,p90:null,meanCi:null,winRate:0,winRateCi:null,sufficient:false,note:'Need more independent samples'};
const summary={available:true,id:'run-1',createdAt:at,generatedAt:at,coverage,findings:[],noConclusion:['Insufficient stored history for a strategy verdict.'],caveats:['Stored prices are not actual fills.']};
// The real admin entitlement carries this flag; the shared fixture is a PRO member and intentionally denies advanced analytics.
const adminAccess={...access,admin:true};
const detail={id:'run-1',kind:'FULL',createdAt:at,report:{generatedAt:at,coverage,costPct:3,strategies:[{name:'AI BUY',events:4,pending:1,unknown:1,unknownRate:.5,hold:described,withRules:described,withOwnExit:null,holdMeanIfUnknownTotalLoss:-51.5,medianLeadTimeSeconds:null}],comparisons:[{name:'AI BUY',vsBaselineHold:{diff:null,ci:null,verdict:'INSUFFICIENT_DATA',note:'Too few tokens'},vsBaselineRules:{diff:0,ci:[-3,3],verdict:'NO_CLEAR_DIFFERENCE',note:null}}],findings:[],noConclusion:['Insufficient stored history for a strategy verdict.']},gates:{minSample:30,minDistinctTokens:15}};
for(const width of [1440,390])for(const theme of ['dark','light'])test(`backtest report ${width}px ${theme}: navigation, evidence and accessibility`,async({page})=>{
 test.setTimeout(120000);
 const requests:string[]=[];
 await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  expect(req.method()).toBe('GET');requests.push(url.pathname);
  const body=url.pathname==='/v1/public-config'?{privyAppId:'fixture-app'}:url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:url.pathname==='/v1/me'?{isAdmin:true}:url.pathname==='/v1/me/entitlements'?adminAccess:url.pathname.endsWith('backtest-summary')?summary:url.pathname==='/v1/analytics/backtests'?{items:[{id:'run-1',kind:'FULL',createdAt:at,coverage,findings:0,noConclusion:1}]}:url.pathname.endsWith('backtests/run-1')?detail:responses[url.pathname];
  expect(body,`unmocked API request ${url.pathname}`).toBeDefined();
  return route.fulfill({headers,json:body});
 });
 await page.goto(`${origin}/en/app/backtests`);
 await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Latest full backtest'})).toBeVisible();
 await page.getByRole('combobox',{name:'Saved report'}).selectOption('run-1');
 await expect(page.getByRole('table',{name:'24-hour buy and hold'})).toBeVisible();
 await expect(page.getByText('No clear difference', {exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(requests.filter(p=>p==='/v1/analytics/backtests/run-1')).toHaveLength(1);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/backtest-${width}-${theme}.png`,fullPage:true});
});

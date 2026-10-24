import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses} from './research-fixtures';
import {ADDRESS} from '../src/test/fixtures';
const origin='http://localhost:4010',at=new Date().toISOString();
const results={trades:0,realizedPnlSol:0,feesSol:0,daily:[],closedPositions:{count:0,wins:0,winRate:null,winRateCi:null,meanPnlSol:null,sufficient:false,note:null}};
const own:Record<string,unknown>={
 '/v1/analytics/me/performance':{range:{from:at,to:at,days:30},truncated:false,paper:results,real:results,caveats:[]},
 '/v1/analytics/me/equity':{simulated:true,range:{from:at,to:at,days:30},points:[],peakSol:null,latestSol:null,drawdownPct:null,downsampled:false},
 '/v1/trades':{items:[],nextCursor:null},'/v1/me/wallets':{items:[]},'/v1/me/wallets/balances':{at,items:[],available:false},
};
for(const width of [1440,390])for(const theme of ['dark','light'])test(`paper controls ${width}px ${theme}`,async({page})=>{
 test.setTimeout(120000);const writes:{path:string;body:unknown}[]=[];
 await page.setViewportSize({width,height:1000});await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 await page.route('http://localhost:4000/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(request.method()==='POST'){
   writes.push({path:url.pathname,body:request.postDataJSON()});expect(request.headers().authorization).toBe('Bearer fixture-public-test-token');
   expect(['/v1/paper-trades/preview','/v1/paper-trades/confirm']).toContain(url.pathname);
   if(url.pathname.endsWith('/preview'))return route.fulfill({headers,json:{previewId:'preview-1',expiresAt:new Date(Date.now()+60000).toISOString(),side:'BUY',mint:ADDRESS,symbol:'ROBOT',sizeSol:.05,requestedSizeSol:.1,fractionPct:0,estimatedProceedsSol:null,feeSol:.002,priceImpactPct:.1,slippageBps:100,simulated:true}});
   return route.fulfill({headers,json:{orderId:'paper-order-1',positionId:'paper-position-1',side:'BUY',simulated:true,replayed:false}});
  }
  const body=url.pathname==='/v1/public-config'?{privyAppId:'fixture-app'}:url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:url.pathname==='/v1/paper-trades/account'?{mode:'PAPER',balanceSol:10,feeSol:.002,quotesAvailable:true,entryPermission:true,paused:false}:url.pathname==='/v1/positions'?{items:[{id:'p1',mode:'PAPER',simulated:true,paperCloseEligible:true,openedAt:at,sizeSol:.1,entryPriceUsd:1,currentPriceUsd:1,pnlPct:0,token:{mint:ADDRESS,symbol:'ROBOT'},evaluation:null}]}:own[url.pathname]??responses[url.pathname];
  expect(body,`unmocked ${url.pathname}`).toBeDefined();return route.fulfill({headers,json:body});
 });
 await page.goto(`${origin}/en/app/portfolio`);await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Manual paper trading'})).toBeVisible();
 await page.getByLabel('Token mint address').fill(ADDRESS);await page.getByRole('button',{name:'Review paper order'}).click();
 await expect(page.getByRole('heading',{name:'Review simulated order'})).toBeVisible();
 await expect(page.getByText(/Risk limits reduced/)).toBeVisible();expect(writes).toHaveLength(1);
 const confirm=page.getByRole('button',{name:'Confirm paper order'});await expect(confirm).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.getByRole('checkbox',{name:/simulated order/}).check();await confirm.scrollIntoViewIfNeeded();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/paper-review-${width}-${theme}.png`,fullPage:true});
 await confirm.click();
 await expect(page.getByRole('status').filter({hasText:'Simulated order filled'})).toBeVisible();
 expect(writes).toEqual([{path:'/v1/paper-trades/preview',body:{side:'BUY',mint:ADDRESS,sizeSol:.1}},{path:'/v1/paper-trades/confirm',body:{previewId:'preview-1',paperAcknowledged:true}}]);
});

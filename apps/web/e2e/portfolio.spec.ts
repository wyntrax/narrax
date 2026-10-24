import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses} from './research-fixtures';
import {ADDRESS} from '../src/test/fixtures';

// Development-only auth fixture on 4010 with fully mocked HTTP. No application API, DB or provider calls.
const origin='http://localhost:4010',at='2026-10-19T12:00:00.000Z';
const evaluation={action:'REDUCE',fractionPct:50,signals:[{code:'LIQUIDITY_DROP',level:'WARN',detail:'Liquidity fell 40% in an hour.'}],unavailable:['DEV_ACTIVITY: developer wallet data is not collected'],blind:false,pnlPct:20,at};
const positions={items:[{id:'p1',mode:'PAPER',openedAt:at,sizeSol:0.9,entryPriceUsd:1.5,currentPriceUsd:1.8,pnlPct:20,entryContext:{},token:{mint:ADDRESS,symbol:'ROBOT'},evaluation}]};
const trades={items:[{id:'t1',executedAt:at,side:'BUY',mode:'PAPER',reason:'AGENT_BUY',sizeSol:1,expectedPriceUsd:1.5,actualPriceUsd:1.51,slippageBps:12.5,signature:'5'.repeat(88),token:{mint:ADDRESS,symbol:'ROBOT'}}],nextCursor:null};
const closed={count:4,wins:3,winRate:0.75,winRateCi:[0.3,0.95],meanPnlSol:0.1,sufficient:false,note:'Small sample.'};
const results={trades:12,realizedPnlSol:0.42,feesSol:0.11,daily:[{day:'2026-10-19',pnlSol:0.12}],closedPositions:closed};
const performance={range:{from:at,to:at,days:30},truncated:false,paper:results,real:{...results,trades:0,realizedPnlSol:0,daily:[],closedPositions:{...closed,count:0,wins:0,winRate:null,winRateCi:null,meanPnlSol:null,note:null}},caveats:['Realized profit and loss includes fees.']};
const equity={simulated:true,range:{from:at,to:at,days:30},points:[{at:'2026-10-18T12:00:00.000Z',valueSol:1},{at,valueSol:1.2}],peakSol:1.2,latestSol:1.2,drawdownPct:0,downsampled:false};
const wallets={items:[{id:'w1',address:ADDRESS,kind:'TRADING',createdAt:at}]};
const balances={at,items:[{address:ADDRESS,kind:'TRADING',balanceSol:null,status:'UNKNOWN'}],available:false};
for(const width of [1440,390])for(const theme of ['dark','light'])test(`portfolio ${width}px ${theme}: positions, trades, results and accessibility`,async({page})=>{
 test.setTimeout(120000);
 const requests:string[]=[];let exportAuth:string|undefined;
 await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  expect(req.method()).toBe('GET');
  requests.push(url.pathname+url.search);
  if(url.pathname==='/v1/trades/export'){exportAuth=req.headers().authorization;return route.fulfill({status:200,headers:{...headers,'content-type':'text/csv; charset=utf-8'},body:'tradeId,side\r\nt1,BUY\r\n'});}
  const body=url.pathname==='/v1/public-config'?{privyAppId:'fixture-app'}:url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:url.pathname==='/v1/positions'?positions:url.pathname==='/v1/trades'?trades:url.pathname==='/v1/analytics/me/performance'?performance:url.pathname==='/v1/analytics/me/equity'?equity:url.pathname==='/v1/me/wallets'?wallets:url.pathname==='/v1/me/wallets/balances'?balances:responses[url.pathname];
  expect(body,`unmocked API request ${url.pathname}`).toBeDefined();
  return route.fulfill({headers,json:body});
 });
 await page.goto(`${origin}/en/app/portfolio`);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Open positions'})).toBeVisible();
 await expect(page.getByText('Reduce · 50% of the position')).toBeVisible();
 await expect(page.getByText('0.42 SOL')).toBeVisible();
 await expect(page.getByRole('table',{name:'Trades'})).toBeVisible();
 await expect(page.getByText('Balance reads are not configured on this deployment. A missing balance stays unknown, never zero.')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/portfolio-${width}-${theme}.png`,fullPage:true});
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export CSV'}).click();
 expect((await download).suggestedFilename()).toBe('narrax-trades.csv');
 expect(exportAuth).toBe('Bearer fixture-public-test-token');
 expect(requests.filter(p=>p==='/v1/trades/export?format=csv')).toHaveLength(1);
 await expect(page.getByText('Saved the audited CSV export.')).toBeVisible();
});

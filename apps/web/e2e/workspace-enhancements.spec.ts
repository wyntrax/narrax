import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {researchApi,enterWorkspace,token,observation} from './research-fixtures';
const wallet={address:token.mint,label:'New tracked wallet',score:null,profileAt:null,source:'MANUAL',observedTrades:0,lastTradeAt:null};
const detail={address:token.mint,label:wallet.label,source:'MANUAL',trackedSince:observation.at,profile:null,performance:{},cluster:null,funding:null,narrativeHistory:{lookbackDays:90,scannedTrades:0,scanCapped:false,items:[]}};

test('market-cap filters sort on server and reset pagination',async({page})=>{
 const requests=await researchApi(page,(path,url)=>path==='/v1/tokens'?{body:{items:[token],nextCursor:url.searchParams.has('cursor')?null:'next-market'}}:undefined);
 await enterWorkspace(page,'/app/tokens');await page.getByRole('button',{name:'Next page',exact:true}).click();
 await page.getByRole('combobox',{name:'Market cap range',exact:true}).selectOption('micro');
 await expect(page.getByRole('button',{name:'Previous page'})).toBeDisabled();
 await page.getByRole('combobox',{name:'Sort market data',exact:true}).selectOption('capAsc');
 await expect.poll(()=>requests.some(p=>p.includes('minMarketCapUsd=5000')&&p.includes('maxMarketCapUsd=50000')&&p.includes('marketCapOnly=true')&&p.includes('order=asc')&&!p.includes('cursor='))).toBe(true);
 await page.getByRole('combobox',{name:'Market cap range',exact:true}).selectOption('small');await page.getByRole('combobox',{name:'Sort market data',exact:true}).selectOption('capDesc');
 await expect.poll(()=>requests.some(p=>p.includes('minMarketCapUsd=50000')&&p.includes('maxMarketCapUsd=100000')&&p.includes('order=desc'))).toBe(true);
 await expect(page.getByText(/FDV substitutes and unknown valuations are excluded/)).toBeVisible();
 await page.getByRole('button',{name:'Reset filters'}).click();await expect(page.getByRole('combobox',{name:'Market cap range',exact:true})).toHaveValue('all');
});
test('opportunities are thesis cards rather than another token screener',async({page})=>{
 const requests=await researchApi(page);await enterWorkspace(page,'/app/opportunities');
 await expect(page.locator('.idea-board')).toBeVisible();await expect(page.getByRole('link',{name:'Open token screener'})).toBeVisible();
 await expect(page.getByLabel('Market cap range')).toHaveCount(0);expect(requests.some(p=>p.startsWith('/v1/tokens?'))).toBe(false);
 await page.getByRole('button',{name:'Review this idea'}).click();await expect(page.getByRole('heading',{name:'Current market check'})).toBeVisible();await expect(page.locator('.score-breakdown')).toBeVisible();
 await page.getByRole('button',{name:'Inspect analysis'}).click();await expect(page.getByText('Wait for more evidence.')).toBeVisible();
});
test('pending wallet profiles remain visible and open real detail/trade routes',async({page})=>{
 const requests=await researchApi(page,(path,url)=>path==='/v1/smart-money/wallets'?{body:{items:[wallet],nextCursor:null}}:path===`/v1/wallets/${token.mint}`?{body:detail}:path===`/v1/wallets/${token.mint}/trades`?{body:{items:url.searchParams.get('side')==='SELL'?[]:[{id:'tx1',at:observation.at,side:'BUY',amountSol:1.25,marketCapUsd:null,signature:'5'.repeat(88),token:{mint:token.mint,symbol:'ROBOT'}}],nextCursor:null}}:undefined);
 await enterWorkspace(page,'/app/smart-money');await expect(page.locator('.research-table')).toContainText('Awaiting profile');
 await page.getByLabel('Search wallet address or label').fill('New tracked');await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect.poll(()=>requests.some(p=>p.includes('q=New+tracked'))).toBe(true);
 await page.getByRole('link',{name:wallet.label}).click();await expect(page.getByRole('heading',{name:wallet.label})).toBeVisible();
 await expect(page.getByRole('link',{name:/5555…5555/})).toHaveAttribute('href',`https://solscan.io/tx/${'5'.repeat(88)}`);
 await page.getByRole('combobox',{name:'Side',exact:true}).selectOption('SELL');await expect(page.getByText(/No stored transactions match/)).toBeVisible();
 expect(requests.some(p=>p.includes('/trades?limit=20&side=SELL'))).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
});
test('alert badge updates after marking read and disappears at zero',async({page})=>{
 let unread=2;
 await researchApi(page,path=>path==='/v1/alerts/unread-count'?{body:{unread,capped:false}}:path==='/v1/alerts'?{body:{items:[{id:'a1',alertId:'aa1',readAt:unread<2?observation.at:null,createdAt:observation.at,kind:'EARLY_RADAR_TRENCHER',priority:'WATCH',title:'Recorded alert',body:'Inspect its evidence',refType:'TOKEN',refId:null}],nextCursor:null,unreadCount:unread}}:undefined);
 await page.route('**/v1/alerts/**',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://localhost:4010','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,GET,OPTIONS'}});
  if(route.request().method()!=='POST')return route.fallback();
  const all=route.request().url().endsWith('read-all');unread=all?0:1;
  return route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:all?{marked:1}:{id:'a1',read:true}});
 });
 await enterWorkspace(page,'/app/alerts');await expect(page.locator('.research-sidebar .nav-alert-badge')).toHaveText('2');
 await page.getByRole('button',{name:'Mark read',exact:true}).click();await expect(page.locator('.research-sidebar .nav-alert-badge')).toHaveText('1');
 await page.getByRole('button',{name:'Mark all read',exact:true}).click();await expect(page.locator('.nav-alert-badge')).toHaveCount(0);
});
test('invalid retained wallet addresses are labeled and never linked as chain evidence',async({page})=>{
 await researchApi(page,path=>path==='/v1/smart-money/wallets'?{body:{items:[{...wallet,address:'invalid-historical-wallet'}],nextCursor:null}}:undefined);
 await enterWorkspace(page,'/app/smart-money');await expect(page.getByText('Invalid historical address; no chain lookup available')).toBeVisible();
 await expect(page.locator('.research-table a')).toHaveCount(0);await page.getByRole('button',{name:'Inspect historical scores and analysis'}).click();await expect(page.locator('.research-table a')).toHaveCount(0);
});
for(const theme of ['dark','light'])test(`sign in: visible primary action and home links in ${theme}`,async({page})=>{
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:'http://localhost:4010'}]);await researchApi(page);await page.goto('/app');
 const login=page.getByRole('button',{name:'Continue',exact:true});await expect(login).toBeVisible();
 const colors=await login.evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));expect(colors.fg).not.toBe(colors.bg);
 await expect(page.locator('.gate-home')).toHaveAttribute('href','/');
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/workspace-signin-${theme}.png`});await page.locator('.gate-home').click();await expect(page).toHaveURL('http://localhost:4010/');
});
for(const locale of ['en','id'])test(`mobile wallet explorer, badges and full-width layout in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await researchApi(page,path=>path==='/v1/smart-money/wallets'?{body:{items:[wallet],nextCursor:null}}:undefined);
 await page.goto(locale==='id'?'/id/app/smart-money':'/app/smart-money');await page.getByRole('button',{name:locale==='id'?'Lanjutkan':'Continue',exact:true}).click();await expect(page.locator('.research-table')).toBeVisible();
 await expect(page.locator('.research-context')).toHaveCount(0);await expect(page.locator('.research-bottom-nav .nav-alert-badge')).toHaveText('1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.research-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
});

import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses,researchApi} from './research-fixtures';
import {ADDRESS} from '../src/test/fixtures';
import {rankingFixture} from '../src/test/wallet-ranking-fixture';

// Development-only auth fixture on 4010 with fully mocked HTTP. No application API, DB or provider calls.
const origin=process.env.E2E_BASE_URL??'http://localhost:4010',at='2026-10-18T12:00:00.000Z';
const intelligence={checkedAt:at,windowDays:30,observedTrades:299,closedTrades:2,requiredClosedTrades:5,status:'INSUFFICIENT_HISTORY'};
const wallets={
 items:[
  {address:ADDRESS,label:'Recorded wallet',source:'MANUAL',observedTrades:299,profileAt:at,score:81.5,style:'SNIPER',lastTradeAt:at,cluster:{id:'c1',confidence:0.7},intelligence:{...intelligence,closedTrades:9,status:'READY'}},
  {address:'PendingWallet111111111111111111111111111111',source:'DISCOVERED',observedTrades:12,score:null,style:null,intelligence,lastTradeAt:null}
 ],nextCursor:null
};
const artwork='https://cdn.helius-rpc.com/cdn-cgi/image/wallet-test.png';
const tradePage={items:[{id:'trade-evidence',at,side:'BUY',amountSol:.00002,amountUsd:null,marketCapUsd:null,evidence:{reasons:['NO_CONTEMPORANEOUS_MARKET','NO_CONTEMPORANEOUS_SOL'],market:null,sol:null},signature:'3'.repeat(88),token:{mint:ADDRESS,symbol:'AUC',name:'AudaCity',imageUrl:artwork}}],nextCursor:null};
const detail={address:ADDRESS,label:'Recorded wallet',source:'MANUAL',trackedSince:at,intelligence:{...intelligence,observedBuys:296,observedSells:3,unmatchedSells:1,closedTrades:9,status:'READY'},history:{checkedAt:at,scanned:300,accepted:299,skipped:0,capped:true,windowDays:30},profile:{score:81.5,leaderScore:70,style:'SNIPER',medianHoldSeconds:3600,bestPattern:null,weakPattern:'Slow exits',updatedAt:at},performance:{'30D':{winRate:0.55,pnlSol:12.5,closedTrades:9,avgRoi:0.2,computedAt:at}},cluster:{label:'Shared funder',confidence:0.7,size:2,members:[{address:ADDRESS,label:'Recorded wallet'}]},funding:{status:'FUNDED',funder:ADDRESS,fundedAt:at,amountSol:5,checkedAt:at},narrativeHistory:{scannedTrades:3,lookbackDays:90,scanCapped:false,items:[]}};
for(const width of [1440,390])for(const theme of ['dark','light'])test(`smart money ${width}px ${theme}: leaderboard controls, evidence and accessibility`,async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width,height:1000});
  await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
  await page.route(artwork,route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=','base64')}));
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   expect(req.method()).toBe('GET');
   if(url.pathname==='/v1/smart-money/rankings')return route.fulfill({headers,json:url.searchParams.get('band')==='UNKNOWN'?{...rankingFixture,band:'UNKNOWN',items:[],total:0}:rankingFixture});
  const body=url.pathname==='/v1/public-config'?{privyAppId:'fixture-app'}:url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:url.pathname==='/v1/smart-money/wallets'?wallets:url.pathname===`/v1/wallets/${ADDRESS}/trades`?tradePage:url.pathname===`/v1/wallets/${ADDRESS}`?detail:responses[url.pathname];
  expect(body,`unmocked API request ${url.pathname}`).toBeDefined();
  return route.fulfill({headers,json:body});
 });
 await page.goto(`${origin}/en/app/smart-money`);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('table',{name:'Smart money'})).toBeVisible();
 await expect(page.getByText('Score 81.5')).toBeVisible();
  await expect(page.getByText('Insufficient matched trades')).toBeVisible();
  await expect(page.getByRole('table',{name:'Small-cap wallet leaderboard'})).toBeVisible();
  await expect(page.getByText('12.345678901')).toBeVisible();
  await page.getByText('Evidence',{exact:true}).click();
  await expect(page.getByText('History incomplete or stale')).toBeVisible();
  await page.getByLabel('Market cap at entry').selectOption('UNKNOWN');
  await expect(page.getByText(/historical market caps cannot be inferred/)).toBeVisible();
  await page.getByLabel('Market cap at entry').selectOption('SMALL_CAP');
  await expect(page.getByText('12.345678901')).toBeVisible();
 await page.getByLabel('Sort').selectOption('score');
 await expect(page.getByText(/Sorted by recorded score/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/smart-money-${width}-${theme}-directory.png`,fullPage:true});

 await page.goto(`${origin}/en/app/smart-money/${ADDRESS}`);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Recorded profile'})).toBeVisible();
 await expect(page.getByText('1 h')).toBeVisible();
  await expect(page.getByText('Slow exits')).toBeVisible();
  await expect(page.getByText('0.00002',{exact:true})).toBeVisible();
  await expect(page.getByText('No SOL/USD observation at trade time')).toBeVisible();
  await expect(page.getByText('No market-cap observation at trade time')).toBeVisible();
  const image=page.locator(`img[src="${artwork}"]`);await image.scrollIntoViewIfNeeded();
  await expect.poll(()=>image.evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/smart-money-${width}-${theme}-profile.png`,fullPage:true});
});

for(const width of [1440,390])test(`Indonesian wallet evaluation ${width}px`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 await researchApi(page,path=>path==='/v1/smart-money/wallets'?{body:wallets}:path==='/v1/smart-money/rankings'?{body:rankingFixture}:undefined);
 await page.goto(`${origin}/id/app/smart-money`);await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
 await expect(page.getByRole('table',{name:'Peringkat wallet small-cap'})).toBeVisible();
 await page.getByText('Bukti',{exact:true}).click();await expect(page.getByText('Riwayat tidak lengkap atau kedaluwarsa')).toBeVisible();
 await expect(page.getByLabel('Kapitalisasi saat masuk')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

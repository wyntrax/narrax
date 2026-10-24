import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses} from './research-fixtures';
import {ADDRESS} from '../src/test/fixtures';

const origin='http://localhost:4010';
const mint='DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const now=Date.now();
const at=new Date(now).toISOString();
const expiresAt=new Date(now+3600000).toISOString();
const quote={inputMint:'So11111111111111111111111111111111111111112',outputMint:mint,inAmount:'10000000',outAmount:'1250000',minOut:'1237500',inputDecimals:9,outputDecimals:5,slippageBps:100,priceImpactPct:0.12,networkFeeLamports:'5000',priorityFeeLamports:'12000',maxOverheadLamports:'5000000'};
const record={id:'swap-1',mint,wallet:ADDRESS,side:'BUY',status:'CONFIRMED',signature:'5'.repeat(64),createdAt:at,expiresAt,quote};
const review={id:'review-1',mint,symbol:'BONK',name:'Bonk',at,expiresAt,buyBlockers:[],notes:['CONCENTRATED'],
 market:{at,source:'dexscreener',priceUsd:0.000024,liquidityUsd:420000,volume24hUsd:180000,marketCapUsd:1800000,marketCapIsFdv:false,fresh:true},
 holders:{at,count:1240,top10Pct:41.2,fresh:true},risk:{at,flags:[],fresh:true},
 narratives:{access:true,items:[{slug:'dog-coins',name:'Dog coins',relation:'LIKELY_OG',confidence:0.72}]},
 smartMoney:{access:true,items:[{id:'flow-1',at,side:'BUY',wallets:4,entities:2,netSol:12.5,fresh:true}]}};

async function mockApi(page:Page){
 const writes:{path:string;body:unknown}[]=[];
 await page.route('http://localhost:4000/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(request.method()==='POST'){
   writes.push({path:url.pathname,body:request.postDataJSON()});
   expect(request.headers().authorization).toBe('Bearer fixture-public-test-token');
   if(url.pathname==='/v1/manual-trades/research')return route.fulfill({headers,json:{...review,expiresAt:new Date(Date.now()+300000).toISOString()}});
   if(url.pathname==='/v1/manual-trades/preview')return route.fulfill({headers,json:{...record,status:'PREPARED',signature:null,expiresAt:new Date(Date.now()+60000).toISOString(),transaction:btoa('unsigned-fixture-transaction')}});
   if(url.pathname==='/v1/manual-trades/submit')return route.fulfill({headers,json:{...record,status:'SUBMITTED',signature:null}});
   return route.fulfill({headers,status:404,json:{error:'NOT_FOUND'}});
  }
  const body=
   url.pathname==='/v1/manual-trades/config'?{enabled:true,chain:'solana:mainnet',wallets:[ADDRESS]}:
   url.pathname==='/v1/manual-trades'?{items:[]}:
   url.pathname==='/v1/manual-trades/swap-1'?record:
   url.pathname==='/v1/manual-trades/balances'?{wallet:ADDRESS,mint,sol:'2500000000',token:'0',decimals:5,at}:
   url.pathname==='/v1/public-config'?{privyAppId:null}:
   url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:
   responses[url.pathname];
  if(body===undefined)return route.fulfill({headers,status:404,json:{error:'NOT_FOUND'}});
  return route.fulfill({headers,json:body});
 });
 return writes;
}

async function openTrade(page:Page,locale:'en'|'id'){
 await page.goto(`${origin}/${locale}/app/trade`);
 await page.getByRole('button',{name:/^(Continue|Lanjutkan)$/}).click();
 await expect(page.locator('.research-shell')).toBeVisible();
}

async function trade(page:Page,copy:{headline:string;continue:string;connect:string;wallet:string;amount:string;quote:string;approve:string;confirmed:string;history:string}){
 await expect(page.getByRole('heading',{name:copy.headline})).toBeVisible();
 await expect(page.locator('.trade-flow strong')).toContainText(/12[.,]5 SOL/);
 await page.getByRole('button',{name:copy.continue}).click();
 await page.getByRole('button',{name:copy.connect}).click();
 await page.getByLabel(copy.wallet).selectOption(ADDRESS);
 await expect(page.locator('.trade-wallet-address code')).toHaveText(ADDRESS);
 await expect(page.locator('.trade-wallet-address button')).toBeVisible();
 await page.getByLabel(copy.amount).fill('0.01');
 await page.getByRole('button',{name:copy.quote}).click();
 await expect(page.locator('.trade-receive')).toContainText('12.5');
 await expect(page.getByText(/Jupiter V2/)).toBeVisible();
 await page.getByRole('button',{name:copy.approve}).click();
 await expect(page.getByRole('heading',{name:copy.confirmed})).toBeVisible();
 await expect(page.getByRole('link',{name:/Solscan/})).toHaveAttribute('href',/^https:\/\/solscan\.io\/tx\//);
 await expect(page.getByRole('heading',{name:copy.history})).toBeVisible();
}

for(const width of [1440,768,390])for(const theme of ['dark','light'])test(`manual trade ${width}px ${theme}`,async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 const writes=await mockApi(page);
 await openTrade(page,'en');
 await expect(page.getByRole('heading',{name:'Understand it. Then trade it.'})).toBeVisible();
 await page.getByLabel('Token mint address').fill(mint);
 await page.getByRole('button',{name:'Review token'}).click();
 await expect(page.getByText('BONK').first()).toBeVisible();
 await expect(page.getByText('Dog coins')).toBeVisible();
 await expect(page.locator('.trade-flow strong')).toContainText(/12[.,]5 SOL/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await trade(page,{headline:'Understand it. Then trade it.',continue:'Continue to swap',connect:'Connect wallet',wallet:'Signing wallet',amount:'You pay',quote:'Get swap quote',approve:'Approve in wallet',confirmed:'Confirmed on-chain',history:'Recent swaps'});
 expect(writes.map(w=>w.path)).toEqual(['/v1/manual-trades/research','/v1/manual-trades/preview','/v1/manual-trades/submit']);
 expect(writes[1]!.body).toMatchObject({reviewId:'review-1',mint,wallet:ADDRESS,side:'BUY',amount:'0.01',slippageBps:100});
 expect((writes[2]!.body as {id:string;signedTransaction:string}).id).toBe('swap-1');
 expect((writes[2]!.body as {signedTransaction:string}).signedTransaction).toBeTruthy();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/trade-${width}-${theme}.png`,fullPage:true});
});

test('manual trade Indonesian copy at 390px light',async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:390,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:'light',url:origin}]);
 await mockApi(page);
 await openTrade(page,'id');
 await expect(page.getByRole('heading',{name:'Pahami dulu. Baru trading.'})).toBeVisible();
 await page.getByLabel('Alamat mint token').fill(mint);
 await page.getByRole('button',{name:'Tinjau token'}).click();
 await expect(page.getByText('BONK').first()).toBeVisible();
 await trade(page,{headline:'Pahami dulu. Baru trading.',continue:'Lanjut ke swap',connect:'Hubungkan wallet',wallet:'Wallet penanda tangan',amount:'Anda membayar',quote:'Minta kuotasi swap',approve:'Setujui di wallet',confirmed:'Terkonfirmasi on-chain',history:'Swap terbaru'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:'test-results/trade-id-390-light.png',fullPage:true});
});

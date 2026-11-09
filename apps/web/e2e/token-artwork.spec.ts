import {test,expect} from '@playwright/test';
import {researchApi,enterWorkspace,responses,token,opportunity,overview} from './research-fixtures';
import {ADDRESS} from '../src/test/fixtures';

// Stored API metadata and CDN bytes are fixtures. No provider, wallet or transaction calls.
const at='2026-10-23T00:00:00.000Z';
const artwork='https://cdn.dexscreener.com/cms/images/artwork-fixture.svg';
const tokens=[{...token,imageUrl:artwork},{...token,mint:'A'.repeat(44),symbol:'MISS',name:'Missing artwork',imageUrl:null},{...token,mint:'B'.repeat(44),symbol:'FAIL',name:'Broken artwork',imageUrl:'https://cdn.dexscreener.com/broken.png'}];
const pageOf=(items:unknown[])=>({items,nextCursor:null});
const position=(token:typeof tokens[number],i:number)=>({id:`p${i}`,token,mode:'PAPER',openedAt:at,sizeSol:1,entryPriceUsd:1,currentPriceUsd:null,pnlPct:null,evaluation:null});
const wallet={address:ADDRESS,label:'Wallet fixture',source:'MANUAL',trackedSince:at,profile:null,performance:{},cluster:null,funding:null,narrativeHistory:{lookbackDays:30,scannedTrades:0,scanCapped:false,items:[]}};
const data:Record<string,unknown>={
 '/v1/overview':{...overview,strip:{...overview.strip,hottestOpportunity:{...opportunity,token:tokens[0]}}},
 '/v1/opportunities':pageOf(tokens.map((token,i)=>({...opportunity,id:`o${i}`,token}))),
 '/v1/narratives/robotics':{...(responses['/v1/narratives/robotics'] as object),tokens:tokens.map(token=>({...token,relation:'LIKELY_OG',ogScore:20,confidence:.5}))},
 '/v1/positions':{items:tokens.map(position)},
 '/v1/trades':pageOf(tokens.map((token,i)=>({id:`t${i}`,token,executedAt:at,side:'BUY',mode:'PAPER',reason:'Recorded',sizeSol:1,expectedPriceUsd:null,actualPriceUsd:null,slippageBps:null,signature:'fixture'}))),
 '/v1/analytics/decisions/outcomes':pageOf(tokens.map((token,i)=>({decisionId:`d${i}`,token,action:'WATCH',confidence:.5,decidedAt:at,label:'UNKNOWN',return1hPct:null,return24hPct:null,maxGainPct:null,maxDrawdownPct:null,leadTimeSeconds:null,isFinal:false,unknownReason:'NO_PRICE'}))),
 [`/v1/wallets/${ADDRESS}`]:wallet,
 [`/v1/wallets/${ADDRESS}/trades`]:pageOf(tokens.map((token,i)=>({id:`w${i}`,token,at,side:'BUY',amountSol:1,marketCapUsd:null,signature:'fixture'}))),
 '/v1/smart-money/wallets':pageOf([]),
 '/v1/smart-money/flows':{...pageOf(tokens.map((token,i)=>({id:`f${i}`,token,side:'BUY',createdAt:at,stale:true,walletCount:2,independentEntities:2,netFlowSol:1,entryPriceUsd:1,entryAt:at,evidence:{trades:[]},measurements:[]}))),asOf:at},
 '/v1/alerts':{...pageOf(tokens.map((token,i)=>({id:`n${i}`,alertId:`a${i}`,token,readAt:null,createdAt:at,kind:'EARLY_RADAR_HOLDER',priority:'WATCH',title:'Recorded research alert',body:'Unchanged stored alert text',refType:'TOKEN',refId:`token${i}`}))),unreadCount:3},
};

const screens=[
 {name:'overview',path:'/app',reveal:'Inspect historical scores and analysis',single:true},
 {name:'narrative',path:'/app/narratives/robotics'},
 {name:'opportunities',path:'/app/opportunities'},
 {name:'portfolio',path:'/app/portfolio'},
 {name:'analytics',path:'/app/analytics'},
 {name:'wallet trades',path:`/app/smart-money/${ADDRESS}`},
  {name:'research flows',path:'/app/smart-money',tab:'Token flows'},
 {name:'alerts',path:'/app/alerts'},
];
for(const {width,theme} of [{width:1440,theme:'dark'},{width:390,theme:'light'}])for(const screen of screens)test(`shared token artwork: ${screen.name} ${width}`,async({page,baseURL})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:baseURL!}]);
 await page.route('https://cdn.dexscreener.com/**',route=>route.request().url()===artwork?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="#2dd4bf"/></svg>'}):route.fulfill({status:404,body:''}));
 await researchApi(page,path=>path in data?{body:data[path]}:undefined);
  await enterWorkspace(page,screen.path);
  if('tab' in screen)await page.getByRole('tab',{name:screen.tab,exact:true}).click();
 if(screen.reveal){const control=page.getByRole('button',{name:screen.reveal,exact:true});if(await control.count())await control.click();else await page.locator('summary').filter({hasText:screen.reveal}).click();}
 const good=page.locator('.token-identity').filter({has:page.locator('.token-identity-symbol',{hasText:'ROBOT'})}).first();
 await good.scrollIntoViewIfNeeded();
 await expect(good.locator('img')).toHaveAttribute('src',artwork);
 await expect.poll(()=>good.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 if(!('single' in screen))for(const symbol of ['MISS','FAIL']){
  const identity=page.locator('.token-identity').filter({has:page.locator('.token-identity-symbol',{hasText:symbol})}).first();
  await identity.scrollIntoViewIfNeeded();await expect(identity.locator('img')).toHaveCount(0);
  await expect(identity.locator('.token-avatar')).toHaveText(symbol.slice(0,2));
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.research-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

for(const width of [1440,390])for(const imageUrl of [artwork,null,'https://cdn.dexscreener.com/broken.png'])test(`trade review artwork ${width}: ${imageUrl??'missing'}`,async({page})=>{
 test.setTimeout(120000);
 const mint='DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
 await page.setViewportSize({width,height:1000});
 await researchApi(page);
 await page.route('https://cdn.dexscreener.com/**',route=>route.request().url()===artwork?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="#2dd4bf"/></svg>'}):route.fulfill({status:404,body:''}));
 await page.route('http://localhost:4000/v1/manual-trades**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,headers={'access-control-allow-origin':req.headers().origin??'http://localhost:4010','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(req.method()==='POST'){
   expect(path).toBe('/v1/manual-trades/research');
   return route.fulfill({headers,json:{id:'review',mint,symbol:'ROBOT',name:'Robotics sample',imageUrl,at,expiresAt:new Date(Date.now()+300000).toISOString(),buyBlockers:['MARKET_MISSING'],notes:[],market:null,holders:null,risk:null,narratives:{access:true,items:[]},smartMoney:{access:true,items:[]}}});
  }
  return route.fulfill({headers,json:path.endsWith('/config')?{enabled:false,chain:'solana:mainnet',wallets:[]}:{items:[]}});
 });
 await enterWorkspace(page,`/app/trade?mint=${mint}`);
 await expect(page.locator('.trade-token h2')).toHaveText('ROBOTRobotics sample');
 const avatar=page.locator('.trade-token>.token-avatar');await avatar.scrollIntoViewIfNeeded();
 if(imageUrl===artwork)await expect.poll(()=>avatar.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 else{await expect(avatar.locator('img')).toHaveCount(0);await expect(avatar).toHaveText('RO');}
 await page.getByRole('button',{name:'Sell',exact:true}).click();
 const selected=page.locator('.trade-amount .token-identity');await selected.scrollIntoViewIfNeeded();
 await expect(selected.locator('.token-identity-symbol')).toHaveText('ROBOT');
 if(imageUrl===artwork)await expect(selected.locator('img')).toHaveAttribute('src',artwork);
 else await expect(selected.locator('img')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.research-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

for(const width of [1440,390])test(`paper review artwork ${width}`,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});
 await researchApi(page,path=>path in data?{body:data[path]}:undefined);
 await page.route(artwork,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="36" height="36" fill="#2dd4bf"/></svg>'}));
 await page.route('http://localhost:4000/v1/paper-trades/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,headers={'access-control-allow-origin':req.headers().origin??'http://localhost:4010','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(req.method()==='GET')return route.fulfill({headers,json:{mode:'PAPER',balanceSol:10,feeSol:.002,quotesAvailable:true,entryPermission:true,paused:false}});
  expect(path).toBe('/v1/paper-trades/preview');
  return route.fulfill({headers,json:{previewId:'paper-review',expiresAt:new Date(Date.now()+60000).toISOString(),side:'BUY',mint:ADDRESS,symbol:'ROBOT',name:'Robotics sample',imageUrl:artwork,sizeSol:.1,requestedSizeSol:.1,fractionPct:0,estimatedProceedsSol:null,feeSol:.002,priceImpactPct:.1,slippageBps:100,simulated:true}});
 });
 await enterWorkspace(page,'/app/portfolio');
 await page.getByLabel('Token mint address').fill(ADDRESS);await page.getByRole('button',{name:'Review paper order'}).click();
 const identity=page.locator('.paper-review .token-identity');await identity.scrollIntoViewIfNeeded();
 await expect(identity.locator('img')).toHaveAttribute('src',artwork);
 await expect(identity.locator('.token-identity-name')).toHaveText('Robotics sample');
 await expect(page.getByRole('button',{name:'Confirm paper order'})).toBeDisabled();
});

import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses,token} from './research-fixtures';

for(const width of [1440,390])for(const theme of ['dark','light'])test(`mint research flow ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,domain:'localhost',path:'/'}]);
 const at=new Date().toISOString();
 let detailReads=0;
 await page.route('http://localhost:4000/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':request.headers().origin??'http://localhost:4010','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  expect(request.method()).toBe('GET');
  if(url.pathname==='/v1/public-config')return route.fulfill({headers,json:{privyAppId:'fixture-app'}});
  if(url.pathname==='/v1/early-access/status')return route.fulfill({headers,json:{enabled:true,seatsLeft:12,inviteRequired:false}});
  expect(request.headers().authorization).toBe('Bearer fixture-public-test-token');
  if(url.pathname===`/v1/tokens/${token.mint}`){
   detailReads++;
   const source=responses[url.pathname] as Record<string,unknown>;
   return route.fulfill({headers,json:{...source,observation:{...token.observation,at,stale:detailReads>1},metrics:{priceUsd:123,marketCapUsd:120000,liquidityUsd:45000,volume24hUsd:18000,at}}});
  }
  return route.fulfill({headers,status:responses[url.pathname]?200:404,json:responses[url.pathname]??{error:'NOT_FOUND'}});
 });
 await page.goto('/app/tokens');await page.getByRole('button',{name:'Continue',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Research a Solana token'});
 await input.fill('not-a-mint');await page.getByRole('button',{name:'Open research',exact:true}).click();
 await expect(input).toHaveAttribute('aria-invalid','true');expect(detailReads).toBe(0);
 await input.fill(token.mint);await page.getByRole('button',{name:'Open research',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Token research brief'})).toBeVisible();
 await expect(page.getByText('$123',{exact:true})).toBeVisible();
 await expect(page.getByText('Recent source-linked market snapshot',{exact:true})).toBeVisible();
 await expect(page.getByText('0%',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/token-brief-${width}-${theme}.png`,fullPage:true});
 await page.getByRole('link',{name:'Inspect historical snapshots',exact:true}).click();await expect(page.locator('#token-history')).toHaveAttribute('open','');
  await page.getByRole('button',{name:'Refresh research',exact:true}).click();await expect(page.getByText('Market snapshot is stale',{exact:true})).toBeVisible();await expect(page.getByText('$123',{exact:true})).toBeVisible();await expect(page.getByText('Last observed market values',{exact:true})).toBeVisible();await expect(page.getByText('0%',{exact:true})).toHaveCount(0);
 await page.goto('/app/tokens/11111111111111111111111111111111');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'No indexed research for this address'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Solscan ↗',exact:true})).toHaveAttribute('href','https://solscan.io/token/11111111111111111111111111111111');
});

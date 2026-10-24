import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Development-only auth fixture on 4010 with fully mocked HTTP. No application API, DB or provider calls.
// The entitlements read is forced to fail so the shared ResourceError card is what a real access failure renders.
const origin='http://localhost:4010';
const allowed=new Set(['/v1/public-config','/v1/early-access/status','/v1/me/entitlements']);
for(const width of [1440,390])for(const theme of ['dark','light'])test(`request error card ${width}px ${theme}`,async({page})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 const paths:string[]=[];
 await page.route('http://localhost:4000/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  paths.push(url.pathname);
  if(url.pathname==='/v1/public-config')return route.fulfill({headers,json:{privyAppId:'fixture-app'}});
  if(url.pathname==='/v1/early-access/status')return route.fulfill({headers,json:{enabled:true,seatsLeft:12,inviteRequired:false}});
  if(url.pathname==='/v1/me/entitlements')return route.fulfill({status:503,headers,json:{error:'ENTITLEMENTS_UNAVAILABLE'}});
  return route.fulfill({status:404,headers,json:{error:'NOT_FOUND'}});
 });
 await page.goto(`${origin}/en/app/portfolio`);await page.getByRole('button',{name:'Continue',exact:true}).click();
 const card=page.locator('.research-error-card');
 await expect(card).toBeVisible();
 await expect(card.getByRole('heading',{name:'Research could not be loaded'})).toBeVisible();
 await expect(card.getByText('Request error')).toBeVisible();
 await expect(card.getByText('ENTITLEMENTS_UNAVAILABLE')).toBeVisible();
 await expect(card.getByRole('button',{name:'Retry'})).toBeVisible();
 await expect(card.getByRole('link',{name:'Manage access'})).toHaveAttribute('href','/early-access');
 expect([...new Set(paths)].every(path=>allowed.has(path)),`unexpected requests: ${paths.join(', ')}`).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/error-card-${width}-${theme}.png`,fullPage:true});
});

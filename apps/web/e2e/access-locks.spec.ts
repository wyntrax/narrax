import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses,access,overview} from './research-fixtures';

const origin='http://localhost:4010';
for(const width of [1440,390])for(const theme of ['dark','light'])test(`NONE feature locks ${width}px ${theme}`,async({page})=>{
 test.setTimeout(180000);await page.setViewportSize({width,height:1000});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:origin}]);
 const requests:string[]=[];
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,OPTIONS'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  expect(req.method()).toBe('GET');requests.push(url.pathname);
  const body=url.pathname==='/v1/public-config'?{privyAppId:'fixture-app'}:url.pathname==='/v1/early-access/status'?{enabled:true,seatsLeft:12,inviteRequired:false}:url.pathname==='/v1/me/entitlements'?{...access,effectiveTier:'NONE',researchPageLimit:0,rollout:{enforced:false,shadow_log:false},features:Object.fromEntries(Object.entries(access.features).map(([k,v])=>[k,{...v,allowed:false}]))}:url.pathname==='/v1/overview'?{...overview,bar:null,rotation:null,locked:{overview:true,narratives:true,rotation:true,opportunities:true},strip:{topNarratives:[],hottestOpportunity:null},brief:{generated:'rules',points:[]}}:responses[url.pathname];
  expect(body,`Unexpected API request ${url.pathname}`).toBeDefined();return route.fulfill({headers,json:body});
 });
 const enter=async(path:string)=>{await page.goto(`${origin}/en${path}`);await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('main').getByRole('heading',{name:'Research access required'})).toBeVisible();};
  await enter('/app');
  await expect(page.locator('.intelligence-bar')).toContainText('$150');
  await expect(page.locator('.intelligence-bar')).toContainText('82');
  await expect(page.locator('.intelligence-bar')).toContainText('14');
  await expect(page.locator('.intelligence-bar')).not.toContainText('Access required');
  await expect(page.locator('.access-card-tier strong')).toHaveText('Early Access');
  await expect(page.locator('.research-access-card').getByRole('link',{name:'Manage access'})).toBeVisible();
  const contrast=await page.locator('.research-access-card .button-primary').evaluate(node=>{
   const style=getComputedStyle(node),luminance=(color:string)=>{const values=color.match(/[\d.]+/g)!.slice(0,3).map(v=>{const c=Number(v)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return values[0]!*.2126+values[1]!*.7152+values[2]!*.0722;};
   const fg=luminance(style.color),bg=luminance(style.backgroundColor);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  });expect(contrast).toBeGreaterThanOrEqual(4.5);
  if(width===390)expect(await page.locator('.intelligence-bar').evaluate(node=>Array.from(node.querySelectorAll('span:not(.snapshot-label)')).every(item=>{const box=item.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}))).toBe(true);
 await expect(page.locator('.research-sidebar a[data-locked="true"]')).toHaveCount(8);
 for(const path of ['/app/portfolio','/app/alerts','/app/settings'])await expect(page.locator(`.research-sidebar a[href="/en${path}"],.research-sidebar a[href="${path}"]`)).not.toHaveAttribute('data-locked');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`test-results/access-preview-${width}-${theme}.png`,fullPage:true});
 if(width===390){await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('dialog').locator('[data-locked="true"]')).toHaveCount(8);await page.getByRole('dialog').getByRole('link',{name:'Tokens · Research access required',exact:true}).click();}
 else {await page.getByRole('button',{name:'Collapse sidebar'}).click();await expect(page.locator('.research-sidebar .nav-feature-lock').first()).toBeVisible();await page.locator('.research-sidebar a[data-locked="true"]').filter({hasText:'Tokens'}).click();}
 // Ordinary clicks and address-bar manipulation land on the same lock, never mounting research content.
 await expect(page.locator('main').getByRole('heading',{name:'Research access required'})).toBeVisible();
 for(const path of ['/app/radar','/app/narratives/robotics','/app/tokens/mint','/app/opportunities','/app/smart-money','/app/smart-money/address','/app/analytics','/app/backtests','/app/agent'])await enter(path);
 expect(requests.filter(p=>!['/v1/public-config','/v1/early-access/status','/v1/me/entitlements','/v1/me','/v1/market-preview','/v1/alerts/unread-count'].includes(p))).toEqual([]);
 await expect(page.getByLabel('Your question')).toHaveCount(0);
});

import {test,expect} from '@playwright/test';
for(const width of [1440,390])for(const theme of ['dark','light'])for(const state of ['landing','signedOut','checking','challenge','active','disabled','full','error'])test(`${state} ${theme} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:'http://localhost:4010'}]);
 await page.route('http://localhost:4000/**',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:{enabled:true,seatsLeft:12,inviteRequired:false}}));
 await page.goto(state==='landing'?'/':`/early-access?__designState=${state}`);
 await expect(page.getByRole('heading',{level:1})).toBeVisible();
 if(state!=='landing')await expect(page.locator(`[data-design-state="${state}"]`)).toBeVisible();
 await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo({top:0,behavior:'instant'});});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(state==='landing')expect(await page.locator('h1').evaluate(node=>node.getBoundingClientRect().height/parseFloat(getComputedStyle(node).lineHeight))).toBeLessThanOrEqual(3.05);
 await expect(page).toHaveScreenshot(`${state}-${theme}-${width}.png`,{animations:'disabled',mask:[page.locator('canvas,.spinner,.sync-track')],maxDiffPixels:50});
});

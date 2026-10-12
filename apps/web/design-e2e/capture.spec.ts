import {test,expect} from '@playwright/test';
import path from 'node:path';
import {STATES} from '../src/features/access/machine';
import AxeBuilder from '@axe-core/playwright';
const output=process.env.NARRA_DESIGN_CAPTURE_DIR;
if(!output)throw Error('NARRA_DESIGN_CAPTURE_DIR is required for deliberate artifact capture');
for(const width of [1440,834,390])for(const theme of ['dark','light'])for(const state of ['landing',...STATES])test(`${width} ${theme} ${state}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:'http://localhost:4010'}]);
 await page.route('http://localhost:4000/**',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:{enabled:true,seatsLeft:12,inviteRequired:false}}));
 await page.goto(state==='landing'?'/':`/early-access?__designState=${state}`);
 await expect(page.getByRole('heading',{level:1})).toBeVisible();
 if(state!=='landing')await expect(page.locator(`[data-design-state="${state}"]`)).toBeVisible();
 // Visit the below-fold sample to hydrate its observer-gated UI before a full-page capture.
 if(state==='landing'){await page.locator('#preview').scrollIntoViewIfNeeded();await expect(page.getByRole('tablist')).toBeVisible();}
 await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo({top:0,behavior:'instant'});});
 if(process.env.NARRA_DESIGN_AXE==='1')expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:path.join(output!,`${state}-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
});

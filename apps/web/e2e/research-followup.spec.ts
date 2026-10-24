import {test,expect} from '@playwright/test';
import {researchApi,enterWorkspace} from './research-fixtures';
import {readFileSync} from 'node:fs';
import path from 'node:path';

test('public landing nav follows sections and returns to home',async({page})=>{
 test.setTimeout(120000);
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const nav=page.locator('.bracket-nav');
 await expect(nav.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','location',{timeout:60000});
 await expect(page.locator('.site-header')).toHaveAttribute('data-scrolled','false',{timeout:60000});
 for(const [id,label] of [['how','How it works'],['preview','Product'],['access','Tiers'],['faq','FAQ']]){
  await page.locator(`#${id}`).evaluate(el=>el.scrollIntoView({behavior:'instant',block:'start'}));
  await expect(nav.getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','location');
 }
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await expect(nav.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','location');
});

test('sidebar attribution layout fits expanded and collapsed columns',async({page})=>{
 // Exercise the real CSS without depending on the owner's signed-in browser session.
 const css=['src/app/globals.css','src/app/[locale]/(app)/app/workspace.css','src/app/[locale]/(app)/app/workspace-design.css'].map(file=>readFileSync(path.resolve(file),'utf8')).join('\n');
 await page.setContent(`<style>${css}</style><div class="workspace-entry research-shell context-collapsed"><aside class="research-sidebar"><div class="sidebar-bottom"><a class="powered-by powered-by-side" href="https://wyntrax.xyz"><span>Powered by</span><img width="20" height="20" alt=""/><b>Wyntrax</b><span aria-hidden="true"> ↗</span></a></div></aside><main class="research-main"></main></div>`);
 const sidebar=page.locator('.research-sidebar'),credit=page.locator('.powered-by-side');
 for(const collapsed of [false,true]){
  await page.locator('.research-shell').evaluate((el,value)=>el.classList.toggle('sidebar-collapsed',value),collapsed);
  expect(await sidebar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await credit.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await credit.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement!.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right;})).toBe(true);
 }
});

test('sidebar attribution fits both widths and narrative rows open token details',async({page})=>{
 await researchApi(page);await enterWorkspace(page,'/app/narratives/robotics');
 const sidebar=page.locator('.research-sidebar'),credit=page.locator('.powered-by-side');
 await expect(credit).toBeVisible();
 expect(await sidebar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 expect(await sidebar.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(credit.locator('img')).toBeVisible();
 await page.locator('.research-clickable-row td').nth(1).click();
 await expect(page.getByRole('heading',{name:'ROBOT / Robotics sample'})).toBeVisible();
 await expect(page.getByRole('slider',{name:'Inspect a price observation'})).toBeVisible();
});

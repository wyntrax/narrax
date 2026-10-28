import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {researchApi,enterWorkspace,overview,narrative} from './research-fixtures';
import {publicResearchSnapshot} from '../src/test/fixtures';

for(const width of [1440,390])for(const locale of ['en','id'])test(`landing snapshot ${width}px ${locale}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await researchApi(page);await page.setViewportSize({width,height:900});await page.goto(locale==='id'?'/id':'/');
 const section=page.locator('.research-snapshot');await section.scrollIntoViewIfNeeded();
 await expect(section.locator('.snapshot-value')).toHaveText(['35','200','17','7']);
 await expect(section.locator('.snapshot-capacity')).toContainText('200 / 200');
 await expect(section.getByRole('status')).toContainText('UTC');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('.research-snapshot').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 expect(errors).toEqual([]);await page.screenshot({path:`test-results/landing-snapshot-${width}-${locale}.png`,fullPage:true});
});
test('landing snapshot distinguishes zero, unknown, stale and failed reads with a working refresh',async({page})=>{
 let fail=false;
 await researchApi(page,path=>path==='/v1/public-research-snapshot'?{body:fail?{invalid:true}:{...publicResearchSnapshot,narrativeHeat:null,opportunities24h:0,narrativeAsOf:'2026-10-28T09:00:00.000Z'}}:undefined);
 await page.goto('/');const section=page.locator('.research-snapshot');await section.scrollIntoViewIfNeeded();
 await expect(section.locator('.snapshot-value')).toHaveText(['—','200','0','7']);await expect(section.getByRole('status')).toContainText('Older narrative observations');
 fail=true;await section.getByRole('button',{name:'Refresh snapshot'}).click();await expect(section.getByRole('status')).toContainText('temporarily unavailable');
 await expect(section.locator('.snapshot-value')).toHaveText(['—','—','—','—']);
 fail=false;await section.getByRole('button',{name:'Refresh snapshot'}).click();await expect(section.locator('.snapshot-value')).toHaveText(['—','200','0','7']);
});
test('overview renders seven recorded themes and makes its configured-watchlist scope explicit',async({page})=>{
 const names=['Pumpfun Meta','Community Takeover','Ape Calls','Viral Memes','Contract Drops','Agent Coins','Lowcap Gems'];
 await researchApi(page,path=>path==='/v1/overview'?{body:{...overview,strip:{...overview.strip,topNarratives:names.map((name,i)=>({...narrative,id:String(i),slug:`topic-${i}`,name}))}}}:undefined);
 await enterWorkspace(page);await expect(page.getByRole('heading',{name:'Narratives in scope'})).toBeVisible();
 await expect(page.locator('.narrative-list .narrative-row')).toHaveCount(7);
 await expect(page.getByText(/Showing up to 10 highest-scoring/)).toBeVisible();
});

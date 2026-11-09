import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {researchApi,enterWorkspace} from './research-fixtures';
import {analyticsFixture} from '../src/test/analytics-fixture';

for(const width of [1440,390])for(const theme of ['dark','light'])test(`analytics evidence ${width} ${theme}`,async({page})=>{
 test.setTimeout(180000);
 await page.setViewportSize({width,height:900});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,domain:'localhost',path:'/'}]);
 const requests=await researchApi(page,(path,url)=>{
  const body=analyticsFixture(path,url);return body?{body}:undefined;
 });
 await enterWorkspace(page,'/app/analytics');
 await expect(page.getByRole('heading',{name:'Analytics',exact:true})).toBeVisible();
 await expect(page.getByText('75%',{exact:true})).toBeVisible();
 await expect(page.getByText(/within 15 minutes before the decision/)).toBeVisible();
 await expect(page.getByText(/within 30 minutes after the 24h target/)).toBeVisible();
 await expect(page.getByText(/Waiting for the 24h price/)).toBeVisible();
 await page.getByRole('button',{name:'Next page',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Page 2',exact:true})).toBeVisible();
 await page.getByLabel('Decision action').selectOption('WATCH');
 await expect(page.getByText(/No hypothetical buy, sell, short position/)).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Page 1',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Window',exact:true}).selectOption('7');
 await expect.poll(()=>requests.filter(p=>p.includes('/analytics/')&&p.includes('days=7')&&p.includes('action=WATCH')).length).toBeGreaterThanOrEqual(3);
 for(const endpoint of ['decisions/summary','signals','decisions/outcomes']){
  const url=new URL(requests.filter(p=>p.includes(`/analytics/${endpoint}`)).at(-1)!,'https://fixture/');
  expect(url.searchParams.get('days')).toBe('7');expect(url.searchParams.get('action')).toBe('WATCH');expect(url.searchParams.has('cursor')).toBe(false);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.locator('.research-main').evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:`test-results/analytics-${width}-${theme}.png`,fullPage:true});
 await page.getByRole('heading',{name:'Recent outcomes',exact:true}).scrollIntoViewIfNeeded();
 await page.locator('.analytics-outcomes .research-table').evaluate(element=>{element.scrollLeft=element.scrollWidth;});
 await page.screenshot({path:`test-results/analytics-outcomes-${width}-${theme}.png`,fullPage:true});
});

import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for(const path of ['/','/early-access'])for(const theme of ['dark','light'])test(`production nonce, console, axe: ${path} ${theme}`,async({page})=>{
 const errors:string[]=[],violations:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('recordCspViolation',(directive:string)=>violations.push(directive));
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>{void (window as unknown as {recordCspViolation:(value:string)=>Promise<void>}).recordCspViolation(event.violatedDirective);}));
 await page.route('http://localhost:4000/v1/early-access/status',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:{enabled:true,seatsLeft:12,inviteRequired:false}}));
 await page.setViewportSize({width:390,height:844});await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:'http://localhost:4010'}]);
 const response=await page.goto(path),csp=response?.headers()['content-security-policy']??'';
 expect((await page.request.get('/favicon.ico')).status()).toBe(200);
 expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);expect(csp.split(';').find(value=>value.trim().startsWith('script-src'))).not.toMatch(/unsafe-inline|unsafe-eval/);
 await expect(page.getByRole('heading',{level:1})).toBeVisible();if(path==='/early-access'){await expect(page.getByRole('heading',{name:'Privy not configured'})).toBeVisible();await expect(page.getByText('12 places available')).toBeVisible();}
 expect(await page.locator('script:not([src])').evaluateAll(nodes=>nodes.every(node=>!!(node as HTMLScriptElement).nonce))).toBe(true);
 await page.evaluate(()=>document.fonts.ready);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/production-screenshots/${path==='/'?'landing':'access-unconfigured'}-${theme}.png`,fullPage:true});
 await page.getByRole('button',{name:'Bahasa Indonesia'}).click();await expect(page.locator('html')).toHaveAttribute('lang','id');expect(violations).toEqual([]);expect(errors).toEqual([]);
});
for(const [policy,copy] of [[{enabled:false,seatsLeft:null,inviteRequired:false},'Early access is not open yet.'],[{enabled:true,seatsLeft:0,inviteRequired:false},'Early access is currently full.']] as const)test(`public admission without Privy: ${copy}`,async({page})=>{
 await page.route('http://localhost:4000/v1/early-access/status',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:policy}));await page.goto('/early-access');await expect(page.getByRole('heading',{name:'Privy not configured'})).toBeVisible();await expect(page.getByText(copy)).toBeVisible();
});

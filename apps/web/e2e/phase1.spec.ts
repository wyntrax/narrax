import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {empty,linked,active,status,challenge,link,ADDRESS} from '../src/test/fixtures';
import type {Entitlements,PublicStatus} from '../src/lib/schemas';
import bs58 from 'bs58';
const BASE_URL=process.env.E2E_BASE_URL??'http://localhost:4010';
async function mockApi(page:Page,options:{status?:PublicStatus;failure?:boolean;timeout?:boolean;wrongDomain?:boolean;membership?:boolean}={}){
 let snapshot:Entitlements=empty,checks=0,verifyCount=0;const writes:string[]=[];
 await page.context().route(/^https:\/\/(t\.me|x\.com)\//,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>External community fixture</title>'}));
 await page.route('**/__fixture-signature',route=>route.fulfill({body:'fixture signature approved'}));
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;const origin=req.headers().origin??BASE_URL,headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
  const reply=(json:unknown,statusCode=200)=>route.fulfill({status:statusCode,headers,contentType:'application/json',body:JSON.stringify(json)});
   if(req.method()==='OPTIONS')return reply({});
   if(path==='/v1/public-config')return reply({privyAppId:null});
  if(path==='/v1/early-access/status')return reply(options.status??status);
  expect(req.headers().authorization).toBe('Bearer fixture-public-test-token');
  if(path==='/v1/me/entitlements'){
   checks++;if(options.timeout){await new Promise(r=>setTimeout(r,11000));return reply(snapshot);}
   if(options.failure)return reply({error:'ENTITLEMENTS_UNAVAILABLE'},503);
   if(options.membership&&snapshot.links.length&&checks>3)snapshot={...snapshot,effectiveTier:'PRO'};
   return reply(snapshot);
  }
  if(path==='/v1/me/membership/refresh')return reply({ok:true});
  writes.push(`${req.method()} ${path}`);
  if(path.endsWith('/challenge')){expect(req.postDataJSON()).toEqual({chain:'solana',address:ADDRESS});return reply(challenge(options.wrongDomain?'https://wrong.example':origin));}
  if(path.endsWith('/verify')){verifyCount++;const body=req.postDataJSON();expect(Object.keys(body).sort()).toEqual(['challengeId','message','signature']);expect(bs58.decode(body.signature).length).toBe(64);snapshot=linked;return reply(link);}
  if(path.endsWith('/join')){snapshot=active;return reply(active.grants[0]);}
  if(path.endsWith('/early-access')&&req.method()==='DELETE'){snapshot=linked;return reply({ok:true});}
  if(path.endsWith('/linked-wallets/fixture-link')){snapshot=empty;return reply({ok:true});}
  return reply({error:'NOT_FOUND'},404);
 });
 return {writes,get checks(){return checks;},get verifyCount(){return verifyCount;}};
}
async function signIn(page:Page){await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Make it your wallet.'})).toBeVisible();}
async function connect(page:Page){await page.getByRole('button',{name:'Connect external wallet'}).click();await page.getByRole('button',{name:/Phantom \(test fixture\)/}).click();}
async function openCommunityStep(page:Page,title:string){
 const popup=page.context().waitForEvent('page',{timeout:5000}).catch(()=>null);
 await page.getByRole('link',{name:new RegExp(title)}).click();
 const opened=await popup;if(opened)await opened.close();
}
async function completeCommunity(page:Page){
 const steps=['Join the Telegram group','Follow @Wyntrax on X','Like and repost the pinned post'];
 for(let index=0;index<steps.length;index++){
  await openCommunityStep(page,steps[index]!);
  await expect(page.locator('.community-progress')).toHaveText(`${index+1} of 3`);
 }
 await expect(page.getByText('All three complete. Join is unlocked.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Join early access',exact:true})).toBeEnabled();
}
async function shot(page:Page,name:string){await page.screenshot({path:`test-results/screenshots/${name}.png`,fullPage:true});}
test('verified-wallet state holds the three community steps without account linking or a server check',async({page})=>{
 const api=await mockApi(page);await page.goto('/early-access');await signIn(page);await connect(page);await page.getByRole('button',{name:'Sign this message'}).click();
 await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();
 const steps=[['Join the Telegram group','https://t.me/wyntraxyz'],['Follow @Wyntrax on X','https://x.com/Wyntrax'],['Like and repost the pinned post','https://x.com/Wyntrax']] as const;
 for(const [title,href] of steps){
  const community=page.getByRole('link',{name:new RegExp(title)});
  await expect(community).toBeVisible();
  await expect(community).toHaveAttribute('href',href);
  await expect(community).toHaveAttribute('target','_blank');
  await expect(community).toHaveAttribute('rel',/noopener noreferrer/);
 }
 await expect(page.getByRole('region',{name:'Join the community first.'})).toBeVisible();
 await expect(page.getByText('Narrax does not connect to or verify your Telegram or X account.')).toHaveCount(0);
 await expect(page.getByRole('checkbox')).toHaveCount(0);
 const join=page.getByRole('button',{name:'Join early access',exact:true});
 await expect(join).toBeDisabled();
 await expect(page.locator('.community-progress')).toHaveText('0 of 3');
 await expect(page.getByText('Open each step to unlock Join.')).toBeVisible();
 await page.setViewportSize({width:1280,height:1500});
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'test-results/screenshots/access-community-locked.png'});
 await completeCommunity(page);
 expect(api.writes.filter(x=>x.endsWith('/join'))).toEqual([]);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'test-results/screenshots/access-community.png'});
});
test('signed-out → sign-in → external wallet → exact-message proof → join → leave → unlink',async({page})=>{
 const api=await mockApi(page);await page.goto('/early-access');await expect(page.getByRole('heading',{name:'Your research starts here.'})).toBeVisible();await shot(page,'signed-out');await signIn(page);await shot(page,'no-wallet');await connect(page);await expect(page.getByRole('heading',{name:'Read before you sign.'})).toBeVisible();await shot(page,'challenge');await page.getByRole('button',{name:'Sign this message'}).click();await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();await shot(page,'linked');await completeCommunity(page);await page.getByRole('button',{name:'Join early access',exact:true}).click();await expect(page.getByRole('heading',{name:'You’re in.'})).toBeVisible();await shot(page,'active');expect(api.verifyCount).toBe(1);expect(api.writes.filter(x=>x.endsWith('/join'))).toHaveLength(1);
 await page.getByRole('button',{name:'Leave early access',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();await page.getByRole('button',{name:'Unlink',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByRole('heading',{name:'Make it your wallet.'})).toBeVisible();
});
for(const [name,value,title] of [
 ['disabled',{enabled:false,seatsLeft:null,inviteRequired:false},'Early access is not open yet.'],
 ['full',{enabled:true,seatsLeft:0,inviteRequired:false},'Early access is currently full.'],
 ['invite-only',{enabled:true,seatsLeft:10,inviteRequired:true},'Access is invitation-only.']
] as const)test(`${name} is shown before sign-in`,async({page})=>{await mockApi(page,{status:value});await page.goto('/early-access');await expect(page.getByRole('heading',{name:title})).toBeVisible();await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();await shot(page,name);});
test('503 has a friendly explanation and Retry',async({page})=>{await mockApi(page,{failure:true});await page.goto('/early-access');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('main').getByRole('alert')).toContainText('Access checks are temporarily unavailable');await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();await shot(page,'503-error');});
test('10-second API timeout ends checking with Retry',async({page})=>{await mockApi(page,{timeout:true});await page.goto('/early-access');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Checking your access...'})).toBeVisible();await shot(page,'checking');await expect(page.locator('main').getByRole('alert')).toContainText('took too long',{timeout:15000});await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();await shot(page,'timeout');});
test('wrong-domain challenge is refused before signing or verification',async({page})=>{const api=await mockApi(page,{wrongDomain:true});await page.goto('/early-access');await signIn(page);await connect(page);await expect(page.locator('main').getByRole('alert')).toContainText('Signing blocked');await expect(page.getByRole('button',{name:'Sign this message'})).toHaveCount(0);expect(api.verifyCount).toBe(0);await shot(page,'wrong-domain');});
test('paid access is detected silently after sign-in and opens without a membership step',async({page})=>{
 await mockApi(page,{membership:true});await page.goto('/early-access');await signIn(page);await connect(page);await page.getByRole('button',{name:'Sign this message'}).click();
 await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();
 await expect(page.getByRole('button',{name:/Check Wyntrax membership/i})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'You’re in.'})).toBeVisible({timeout:15000});
 await expect(page.getByText('PRO',{exact:true})).toBeVisible();
});
test('reduced motion keeps content and disables motion; EN/ID choice persists',async({page})=>{await mockApi(page);await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();expect(await page.locator('html').evaluate(el=>getComputedStyle(el).scrollBehavior)).toBe('auto');await page.getByRole('combobox',{name:'Language'}).selectOption('id');await expect(page).toHaveURL(/\/id$/);await expect(page.locator('html')).toHaveAttribute('lang','id');await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','id');await shot(page,'landing-id-reduced-motion');});
test('CSP nonces hydration scripts and both private routes are noindex',async({page})=>{await mockApi(page);const response=await page.goto('/early-access');const csp=response?.headers()['content-security-policy']??'';expect(csp).toContain("'nonce-");expect(csp.split(';').find(s=>s.trim().startsWith('script-src'))).not.toContain('unsafe-inline');const html=await response!.text();const inlineScripts=await page.evaluate(source=>Array.from(new DOMParser().parseFromString(source,'text/html').querySelectorAll('script:not([src])')).map(node=>({text:node.textContent,nonce:node.getAttribute('nonce')})),html);expect(inlineScripts.length).toBeGreaterThan(0);expect(inlineScripts.every(script=>!!script.nonce)).toBe(true);await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);await page.goto('/app');await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);});
for(const path of ['/','/early-access'])for(const theme of ['dark','light'])test(`axe AA: ${path} ${theme}`,async({page})=>{await mockApi(page);await page.setViewportSize({width:390,height:844});await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:BASE_URL}]);await page.goto(path);await expect(page.getByRole('heading',{level:1})).toBeVisible();if(path==='/early-access')await expect(page.getByRole('heading',{name:'Your research starts here.'})).toBeVisible();await page.evaluate(()=>document.fonts.ready);const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations).toEqual([]);await shot(page,`${path==='/'?'landing':'access'}-${theme}-mobile`);});

for(const path of ['/','/early-access'])test(`nonce CSP has no violations or console errors: ${path}`,async({page})=>{
 const errors:string[]=[],violations:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('recordCspViolation',(directive:string)=>violations.push(directive));
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>{void (window as unknown as {recordCspViolation:(value:string)=>Promise<void>}).recordCspViolation(event.violatedDirective);}));
 await mockApi(page);const response=await page.goto(path);expect(response?.headers()['content-security-policy']).toMatch(/script-src[^;]*'nonce-[^']+'/);
 await expect(page.getByRole('heading',{level:1})).toBeVisible();if(path==='/early-access')await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
 await page.getByRole('combobox',{name:'Language'}).selectOption('id');await expect(page.locator('html')).toHaveAttribute('lang','id');
 expect(violations).toEqual([]);expect(errors).toEqual([]);
});
test('locale cookie takes precedence over browser language; absent cookie defaults EN',async({page})=>{
 await mockApi(page);await page.setExtraHTTPHeaders({'Accept-Language':'id'});await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang','en');
 await page.context().addCookies([{name:'NARRA_LOCALE',value:'id',url:BASE_URL}]);await page.setExtraHTTPHeaders({'Accept-Language':'en'});await page.goto('/early-access');await expect(page).toHaveURL(/\/id\/early-access$/);await expect(page.locator('html')).toHaveAttribute('lang','id');
 await page.getByRole('combobox',{name:'Bahasa'}).selectOption('en');await expect(page.locator('html')).toHaveAttribute('lang','en');await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang','en');
});
test('wallet connect cancellation permits a fresh retry',async({page})=>{
 await mockApi(page);await page.goto('/early-access');await signIn(page);await page.getByRole('button',{name:'Connect external wallet'}).click();await expect(page.getByRole('button',{name:/Phantom \(test fixture\)/})).toBeVisible();await shot(page,'connecting');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('heading',{name:'Make it your wallet.'})).toBeVisible();await connect(page);await expect(page.getByRole('heading',{name:'Read before you sign.'})).toBeVisible();
});
test('embedded wallet adapter follows the same message-proof boundary',async({page})=>{
 const api=await mockApi(page);await page.goto('/early-access');await signIn(page);await page.getByRole('button',{name:'Use embedded wallet'}).click();await page.getByRole('button',{name:/Privy/}).click();await expect(page.getByRole('heading',{name:'Read before you sign.'})).toBeVisible();await page.getByRole('button',{name:'Sign this message'}).click();await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();expect(api.verifyCount).toBe(1);
});
test('captures pending proof and mutation states with explicit network gates',async({page})=>{
 const api=await mockApi(page);
 async function gate(pattern:string){let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});await page.route(pattern,async route=>{if(route.request().method()==='OPTIONS')return route.fallback();await waiting;await route.fallback();},{times:1});return release;}
 await page.goto('/early-access');await signIn(page);await connect(page);
 const signed=await gate('**/__fixture-signature'),verified=await gate('**/linked-wallets/verify');
 await page.getByRole('button',{name:'Sign this message'}).click();await expect(page.getByRole('heading',{name:'Confirm the message in your wallet.'})).toBeVisible();await shot(page,'signing');signed();
 await expect(page.getByRole('heading',{name:'Verifying your wallet proof.'})).toBeVisible();await shot(page,'verifying');verified();await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();
 await completeCommunity(page);
 const joined=await gate('**/early-access/join');await page.getByRole('button',{name:'Join early access',exact:true}).click();await expect(page.getByRole('heading',{name:'Reserving your access.'})).toBeVisible();await shot(page,'joining');joined();await expect(page.getByRole('heading',{name:'You’re in.'})).toBeVisible();
 const left=await gate('**/me/early-access');await page.getByRole('button',{name:'Leave early access',exact:true}).click();await shot(page,'leave-confirmation');expect(api.writes.filter(x=>x==='DELETE /v1/me/early-access')).toHaveLength(0);await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByRole('heading',{name:'Leaving early access.'})).toBeVisible();await shot(page,'leaving');left();await expect(page.getByRole('heading',{name:'Wallet verified. You’re ready.'})).toBeVisible();
 const unlinked=await gate('**/linked-wallets/fixture-link');await page.getByRole('button',{name:'Unlink',exact:true}).click();await shot(page,'unlink-confirmation');expect(api.writes.filter(x=>x.endsWith('/fixture-link'))).toHaveLength(0);await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByRole('heading',{name:'Unlinking your wallet.'})).toBeVisible();await shot(page,'unlinking');unlinked();await expect(page.getByRole('heading',{name:'Make it your wallet.'})).toBeVisible();
});

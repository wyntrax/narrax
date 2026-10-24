import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {researchApi,enterWorkspace,access,overview,narrative,token,opportunity} from './research-fixtures';
import {empty,ADDRESS} from '../src/test/fixtures';
import messages from '../messages/research/en.json';

const screens=[['overview','/app','A clearer view of the market.'],['radar','/app/radar','Narrative radar'],['narrative','/app/narratives/robotics','Robotics'],['opportunities','/app/opportunities','Opportunities'],['tokens','/app/tokens','Tokens'],['token',`/app/tokens/${ADDRESS}`,'ROBOT / Robotics sample']] as const;
for(const [name,path,title] of screens)for(const width of [1440,390])for(const theme of ['dark','light'])test(`${name}: ${width} ${theme}, accessible and contained`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.setViewportSize({width,height:900});await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:'http://localhost:4010'}]);await researchApi(page);await enterWorkspace(page,path);
 await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();await expect(page.getByText('Loading research…')).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 expect(await page.locator('.research-main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:`test-results/research/${name}-${width}-${theme}.png`,fullPage:true});expect(errors).toEqual([]);
});
test('linked research journey and structured analysis use authenticated read-only API data',async({page})=>{
 const requests=await researchApi(page);await enterWorkspace(page);
 await page.getByRole('link',{name:'Open radar',exact:false}).click();await expect(page.getByRole('heading',{name:'Narrative radar',exact:true})).toBeVisible();
 const marker=page.getByRole('button',{name:/Robotics: Score 82/});await marker.focus();await page.keyboard.press('Enter');await expect(marker).toHaveAttribute('aria-pressed','true');
 await page.getByRole('link',{name:/Open narrative/}).click();await expect(page.getByRole('heading',{name:'Lifecycle',exact:true})).toBeVisible();
  await page.locator('main').getByRole('link',{name:/ROBOT/}).click();await expect(page.getByRole('heading',{name:'ROBOT / Robotics sample'})).toBeVisible();await expect(page.getByText(/Lines connect recorded observations/)).toBeVisible();
  await expect(page.getByRole('slider',{name:'Inspect a price observation'})).toBeVisible();await expect(page.getByRole('heading',{name:'Token events',exact:true})).toBeVisible();await expect(page.getByText('Risk assessment recorded')).toBeVisible();
  await page.locator('.research-sidebar').getByRole('link',{name:'Opportunities',exact:true}).click();await page.getByRole('button',{name:'Inspect historical scores and analysis'}).click();await expect(page.locator('.score-breakdown')).toContainText('Liquidity');await expect(page.locator('.score-breakdown')).not.toContainText('USD');await page.getByRole('button',{name:'Inspect analysis'}).click();await expect(page.getByText('Wait for more evidence.')).toBeVisible();await expect(page.getByText('Recorded activity increased.')).toBeVisible();await expect(page.getByText('Price impact is uncertain.',{exact:false})).toBeVisible();
 expect(requests).toContain('/v1/opportunities/o1/analysis');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to your workspace'})).toBeVisible();await expect(page.getByText('Wait for more evidence.')).toHaveCount(0);
});
test('NONE cannot mount shared research but retains own account settings',async({page})=>{
 const requests=await researchApi(page,path=>path==='/v1/me/entitlements'?{body:empty}:path==='/v1/overview'?{body:{...overview,bar:null,locked:{overview:true,narratives:true,rotation:true,opportunities:true},strip:{topNarratives:[],hottestOpportunity:null},rotation:null,brief:{generated:'rules',points:[]}}}:undefined);
  await enterWorkspace(page);await expect(page.getByRole('heading',{name:'Research access required'})).toBeVisible();await expect(page.getByText('Your open positions',{exact:true})).toHaveCount(0);
  await page.locator('.research-sidebar').getByRole('link',{name:'Radar · Research access required',exact:true}).click();await expect(page.getByRole('heading',{name:'Research access required'})).toBeVisible();
  await page.locator('.research-sidebar').getByRole('link',{name:'Opportunities · Research access required',exact:true}).click();await expect(page.getByRole('heading',{name:'Research access required'})).toBeVisible();await expect(page.getByText('Wait for more evidence.')).toHaveCount(0);
  await page.locator('.research-sidebar').getByRole('link',{name:'Settings',exact:true}).click();await expect(page.locator('#st-name')).toBeVisible();
  expect(requests.some(path=>/^\/v1\/(overview|narratives|opportunities)(?:[/?]|$)/.test(path))).toBe(false);expect(requests).toContain('/v1/settings');
});
test('server feature lock overrides a previously allowed entitlement',async({page})=>{
  await researchApi(page,path=>path==='/v1/narratives'?{status:403,body:{error:'FEATURE_LOCKED',requiredTier:'PRO'}}:undefined);await enterWorkspace(page,'/app/radar');await expect(page.getByRole('heading',{name:'Research access required'})).toBeVisible();await expect(page.locator('.access-card-tier strong')).toHaveText('Pro');await expect(page.getByRole('group',{name:'Narrative lifecycle stage versus score'})).toHaveCount(0);
});
test('failed and malformed reads have retry; unavailable prices never become zero',async({page})=>{
 let mode='failed';await researchApi(page,path=>path==='/v1/tokens'?mode==='failed'?{status:503,body:{error:'UNKNOWN'}}:mode==='malformed'?{body:{items:'invalid',nextCursor:null}}:{body:{items:[{...token,priceUsd:null}],nextCursor:null}}:undefined);
  await enterWorkspace(page,'/app/tokens');await expect(page.locator('main').getByRole('alert')).toContainText('The research service could not complete this request.');mode='malformed';const malformed=page.waitForResponse(r=>r.url().includes('/v1/tokens?')&&r.status()===200);await page.getByRole('button',{name:'Retry',exact:true}).click();await malformed;await expect(page.locator('main').getByRole('alert')).toContainText('The API returned an unexpected data format.');mode='ok';await page.getByRole('button',{name:'Retry',exact:true}).click();const row=page.getByRole('row').filter({has:page.getByRole('link',{name:/ROBOT/})});await expect(row.getByRole('cell').nth(1)).toContainText('Unknown');await expect(page.getByRole('cell',{name:'$0',exact:true})).toHaveCount(0);
});
for(const locale of ['en','id'])test(`unlinked opportunities preserve overview and topbar in ${locale}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:locale==='id'?390:1440,height:900});
 const unlinked={...opportunity,narrative:null};
 await researchApi(page,path=>path==='/v1/overview'?{body:{...overview,strip:{...overview.strip,hottestOpportunity:unlinked}}}:path==='/v1/opportunities'?{body:{items:[unlinked],nextCursor:null}}:undefined);
 await page.goto(locale==='id'?'/id/app':'/app');await page.getByRole('button',{name:locale==='id'?'Lanjutkan':'Continue',exact:true}).click();
 const label=locale==='id'?'Belum terhubung ke narasi':'No linked narrative';
  await page.locator('.research-history summary').click();await expect(page.locator('.opportunity-highlight')).toContainText(label);await expect(page.locator('.intelligence-bar')).toContainText('82');await expect(page.locator('.intelligence-bar')).not.toContainText('Unknown');
 await page.locator('main').getByRole('link',{name:locale==='id'?/Peluang/:/Opportunities/}).click();
   await page.getByRole('button',{name:locale==='id'?'Periksa skor dan analisis historis':'Inspect historical scores and analysis'}).click();await expect(page.locator('.idea-card')).toContainText(label);await expect(page.locator('.score-breakdown')).toBeVisible();
 await expect(page.locator('main a[href*="/narratives/"]')).toHaveCount(0);await expect(page.locator('main [role="alert"]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
test('topbar distinguishes missing and stale readings from measured zero',async({page})=>{
  let bar={at:overview.at,solUsd:null as typeof overview.bar.solUsd|null,narrativeHeat:0,trackedWallets:14,opportunities24h:0};
  await researchApi(page,path=>path==='/v1/market-preview'?{body:bar}:undefined);await enterWorkspace(page);
   const header=page.locator('.intelligence-bar');await expect(header).toContainText('Awaiting price');await expect(header).toContainText('Tracked wallets');await expect(header.locator('b')).toHaveText(['Awaiting price','0','14','0']);
  bar={...bar,solUsd:{...overview.bar.solUsd,stale:true}};await enterWorkspace(page);
    await expect(header.locator('b')).toHaveText(['$150','0','14','0']);await expect(header.locator('.preview-stale')).toHaveText('Price stale');await expect(header.locator('span').first()).toHaveAttribute('title',/Oct 12, 2026/);
});
test('topbar explains failed requests and supports retry',async({page})=>{
  let failed=true;await researchApi(page,path=>path==='/v1/market-preview'&&failed?{body:{invalid:true}}:undefined);await enterWorkspace(page,'/app/tokens');
 const header=page.locator('.intelligence-bar');await expect(header).toContainText('Request failed');await expect(header.getByRole('button',{name:'Retry'})).toHaveAttribute('title',/unexpected data format/);
 failed=false;await header.getByRole('button',{name:'Retry'}).click();await expect(header).toContainText('$150');await expect(header).not.toContainText('Request failed');
});
test('filters and cursor paging reset correctly and preserve opaque cursors',async({page})=>{
 const requests=await researchApi(page,(path,url)=>path==='/v1/narratives'?{body:{items:[{...narrative,name:url.searchParams.has('cursor')?'Second page':'First page'}],nextCursor:url.searchParams.has('cursor')?null:'n-next'}}:path==='/v1/tokens'&&url.searchParams.has('q')?{body:{items:[],nextCursor:null}}:undefined);
 await enterWorkspace(page,'/app/radar');await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByRole('heading',{name:'Second page'})).toBeVisible();expect(requests.some(path=>path.includes('cursor=n-next'))).toBe(true);
 await page.getByLabel('Filter by stage').selectOption('SEED');await expect(page.getByRole('button',{name:'Previous page'})).toBeDisabled();expect(requests).toContain('/v1/narratives?limit=20&stage=SEED');
 await page.getByLabel('Comparison window').selectOption('6h');await expect.poll(()=>requests.includes('/v1/narratives/rotation?window=6h')).toBe(true);
  await page.locator('.research-sidebar').getByRole('link',{name:'Tokens',exact:true}).click();await expect(page.getByLabel('Search tokens')).toHaveAttribute('maxlength','64');await page.getByLabel('Search tokens').fill('A&B');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.getByRole('heading',{name:'No results yet'})).toBeVisible();expect(requests).toContain('/v1/tokens?limit=20&verifiedOnly=true&sort=liquidity&q=A%26B');await page.getByRole('button',{name:'Clear'}).click();await expect(page.getByRole('link',{name:/ROBOT/})).toBeVisible();
});
test('mobile navigation, full-width workspace, theme and Indonesian research copy',async({page})=>{
 await page.setViewportSize({width:390,height:844});await researchApi(page);await enterWorkspace(page);await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('link',{name:'Radar',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Narrative radar',exact:true})).toBeVisible();
  await expect(page.locator('.research-context')).toHaveCount(0);await expect(page.getByRole('button',{name:'Research context',exact:true})).toHaveCount(0);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.getByRole('button',{name:'Switch color theme'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('combobox',{name:'Language'}).selectOption('id');await expect(page.locator('html')).toHaveAttribute('lang','id');
 // The locale layout can remount the auth provider, and this fixture starts signed out again, so continue when the gate returns.
 // isVisible() does not wait, so poll: click the gate whenever it appears until the Indonesian heading is up.
 const gate=page.getByRole('button',{name:'Lanjutkan',exact:true}),radarId=page.getByRole('heading',{name:'Radar narasi',exact:true});
 await expect.poll(async()=>{if(await radarId.isVisible())return 'ok';if(await gate.isVisible()){try{await gate.click();}catch{}}return 'wait';},{timeout:30000}).toBe('ok');
 await expect(page.getByRole('heading',{name:'Radar narasi',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','light');expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
test('refreshing downgraded access clears restricted research',async({page})=>{
   let downgraded=false;await researchApi(page,path=>path==='/v1/me/entitlements'?{body:downgraded?empty:access}:undefined);await enterWorkspace(page,'/app/narratives/robotics');await expect(page.getByRole('heading',{name:'Robotics',exact:true})).toBeVisible();downgraded=true;await page.locator('.research-sidebar').getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Refresh access',exact:true}).click();const radar=page.locator('.research-sidebar').getByRole('link',{name:'Radar · Research access required',exact:true});await expect(radar).toHaveAttribute('data-locked','true');await radar.click();await expect(page.getByRole('heading',{name:'Research access required'})).toHaveCount(1);await expect(page.getByRole('heading',{name:'Research access required'})).toBeVisible();await expect(page.getByRole('heading',{name:'Robotics',exact:true})).toHaveCount(0);
});
test('loading, missing records, and missing analysis are explicit states',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await researchApi(page,path=>path==='/v1/opportunities/o1/analysis'?{status:404,body:{error:'NOT_FOUND'}}:path==='/v1/narratives/missing'?{status:404,body:{error:'NOT_FOUND'}}:undefined);
 await page.route('**/v1/opportunities?*',async route=>{if(route.request().method()==='OPTIONS')return route.fallback();await gate;await route.fallback();});
    await enterWorkspace(page,'/app/opportunities');await expect(page.getByText('Loading research…')).toBeVisible();release();await page.getByRole('button',{name:'Inspect historical scores and analysis'}).click();await page.getByRole('button',{name:'Inspect analysis'}).click();await expect(page.getByText(messages.enhance.analysisCoverage,{exact:true})).toBeVisible();await expect(page.getByText('Wait for more evidence.')).toHaveCount(0);
 await page.goto('/app/narratives/missing');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'This research record was not found'})).toBeVisible();
});

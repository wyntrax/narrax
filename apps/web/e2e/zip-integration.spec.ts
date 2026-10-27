import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {responses,access} from './research-fixtures';
import en from '../messages/research/en.json';
import id from '../messages/research/id.json';

const at='2026-10-14T10:00:00.000Z';
const described={n:0,distinctTokens:0,mean:null,median:null,p10:null,p90:null,meanCi:null,winRate:null,winRateCi:null,sufficient:false,note:'Insufficient observations'};
async function mock(page:Page){
 const writes:{path:string;body:Record<string,unknown>}[]=[],reads:string[]=[];
 let readAt:string|null=null;
 const settings={profile:{displayName:null as string|null,timezone:null as string|null},appearance:{theme:'DARK',density:'COMFORTABLE',reducedMotion:false},notifications:{minPriority:'WATCH',mutedKinds:[] as string[],mutableKinds:['NEW_NARRATIVE'],alwaysDelivered:['CRITICAL']}};
 await page.route('http://localhost:4000/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const headers={'access-control-allow-origin':req.headers().origin??'http://localhost:4010','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
  const reply=(json:unknown,status=200)=>route.fulfill({headers,json,status});
  if(req.method()==='OPTIONS')return route.fulfill({headers,status:204});
  if(path==='/v1/public-config')return reply({privyAppId:null});
  if(path==='/v1/early-access/status')return reply({enabled:true,seatsLeft:12,inviteRequired:false});
  expect(req.headers().authorization).toBe('Bearer fixture-public-test-token');
  if(req.method()!=='GET'){
   const body=req.postDataJSON() as Record<string,unknown>;writes.push({path,body});
   if(path==='/v1/alerts/n1/read'){readAt=at;return reply({id:'n1',read:true});}
   if(path==='/v1/alerts/read-all'){readAt=at;return reply({marked:1});}
   if(path.startsWith('/v1/settings/')){const key=path.split('/').at(-1) as keyof typeof settings;Object.assign(settings[key],body);return reply(settings[key]);}
   if(path==='/v1/chat')return reply({conversationId:'conversation-1',reply:{text:'<script>not executable</script> Evidence remains limited.'},toolsUsed:['getNarratives'],stopReason:'end',proposals:[{id:'proposal-1',summary:'Consider a narrower watchlist'}]});
   if(path==='/v1/admin/entitlements/settings')return reply({ok:true});
   throw Error(`Unexpected write: ${req.method()} ${path}`);
  }
  reads.push(path+url.search);
  if(path==='/v1/me')return reply({isAdmin:true});
  if(path==='/v1/me/entitlements')return reply({...access,effectiveTier:'ELITE',features:Object.fromEntries(Object.entries(access.features).map(([k,v])=>[k,{...v,allowed:true}]))});
  if(path==='/v1/settings')return reply(settings);
  if(path==='/v1/smart-money/wallets')return reply({items:[{address:'A'.repeat(32),label:'Observed wallet',score:0,winRate:null,pnl30dSol:0}],nextCursor:null});
  if(path==='/v1/alerts')return reply({items:readAt&&url.searchParams.get('unread')==='true'?[]:[{id:'n1',alertId:'a1',readAt,createdAt:at,kind:'NEW_NARRATIVE',priority:'WATCH',title:'Recorded observation',body:'An observed topic changed.',refType:null,refId:null}],nextCursor:null,unreadCount:readAt?0:1});
  if(path==='/v1/analytics/decisions/summary')return reply({range:{days:Number(url.searchParams.get('days'))},costPct:2,decisions:{total:0,awaitingMeasurement:0,read:0,independent:0,pending:0,final:0,known:0,unknown:0,unknownRate:null,truncated:false},labels:{WIN:0,LOSS:0,FLAT:0},returns:described,medianLeadTimeSeconds:null,byConfidence:[],caveats:['No measured outcomes yet.']});
  if(path==='/v1/analytics/signals')return reply({costPct:2,truncated:false,byReasonCode:[],caveats:[]});
  if(path==='/v1/analytics/decisions/outcomes')return reply({items:[],nextCursor:null});
  return reply(responses[path]??{error:'NOT_FOUND'},responses[path]?200:404);
 });
 return {writes,reads};
}
async function enter(page:Page,path:string,locale:'en'|'id'='en'){
 await page.goto(`${locale==='id'?'/id':''}${path}`);
 await page.getByRole('button',{name:locale==='id'?'Lanjutkan':'Continue',exact:true}).click();
 await expect(page.locator('.research-shell')).toBeVisible();
}
for(const locale of ['en','id'] as const)test(`${locale}: added workspace pages render genuine empty/missing states and accessible controls`,async({page})=>{
 test.setTimeout(90000);
 const t=locale==='en'?en:id;
  await page.setViewportSize({width:locale==='en'?1440:390,height:1000});await mock(page);await enter(page,'/app/smart-money',locale);
  await page.getByRole('tab',{name:locale==='id'?'Direktori wallet':'Wallet directory',exact:true}).click();
 await expect(page.getByText('Observed wallet',{exact:true})).toBeVisible();
 for(const [path,key] of [['alerts','alerts'],['analytics','analytics'],['agent','agent'],['settings','settings']] as const){
  await enter(page,`/app/${path}`,locale);await expect(page.getByRole('heading',{level:1,name:t[key]})).toBeVisible();
  if(path==='alerts')await expect(page.getByText('Recorded observation',{exact:true})).toBeVisible();
  if(path==='analytics')await expect(page.getByText('Insufficient observations',{exact:true})).toBeVisible();
  if(path==='settings')await expect(page.locator('#st-name')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 }
});
test('alert read actions use authenticated own-data routes and refresh the list',async({page})=>{
 const {writes,reads}=await mock(page);await enter(page,'/app/alerts');
 await page.getByRole('checkbox',{name:en.alUnreadOnly}).check();
 await page.getByRole('button',{name:en.alMarkRead,exact:true}).click();
 await expect(page.getByText('Recorded observation',{exact:true})).toHaveCount(0);
 expect(writes).toEqual([{path:'/v1/alerts/n1/read',body:{}}]);expect(reads.some(p=>p.includes('unread=true'))).toBe(true);
});
test('settings saves profile, appearance and notifications through their separate endpoints',async({page})=>{
 const {writes}=await mock(page);await enter(page,'/app/settings');
 await page.locator('#st-name').fill('Researcher');await page.locator('#st-zone').fill('Asia/Jakarta');
 await page.locator('form').filter({has:page.locator('#st-name')}).getByRole('button').click();
 await page.locator('#st-theme').selectOption('LIGHT');await page.locator('#st-density').selectOption('COMPACT');await page.getByRole('checkbox',{name:en.stReducedMotion}).check();
 await page.locator('form').filter({has:page.locator('#st-theme')}).getByRole('button').click();
 await page.locator('#st-min').selectOption('IMPORTANT');await page.getByRole('checkbox',{name:'NEW_NARRATIVE',exact:true}).check();
 await page.locator('form').filter({has:page.locator('#st-min')}).getByRole('button').click();
 await expect.poll(()=>writes.length).toBe(3);
 expect(writes).toEqual([{path:'/v1/settings/profile',body:{displayName:'Researcher',timezone:'Asia/Jakarta'}},{path:'/v1/settings/appearance',body:{theme:'LIGHT',density:'COMPACT',reducedMotion:true}},{path:'/v1/settings/notifications',body:{minPriority:'IMPORTANT',mutedKinds:['NEW_NARRATIVE']}}]);
 await expect(page.getByText(en.stSaved,{exact:true})).toHaveCount(3);
});
test('chat displays plain text and proposals without applying them; new conversations reset IDs',async({page})=>{
 const {writes}=await mock(page);await enter(page,'/app/agent');
 const send=async(text:string)=>{await page.locator('#chat-input').fill(text);await page.getByRole('button',{name:en.chSend,exact:true}).click();await expect(page.getByRole('button',{name:en.chNew,exact:true})).toBeEnabled();};
 await send('Explain the observations');await expect(page.getByText('<script>not executable</script> Evidence remains limited.',{exact:true})).toBeVisible();await expect(page.locator('.chat-log script')).toHaveCount(0);
 await expect(page.getByText(en.chNotApplied,{exact:true})).toBeVisible();await send('What is uncertain?');
 await page.getByRole('button',{name:en.chNew,exact:true}).click();await send('A fresh question');
 expect(writes.map(w=>w.path)).toEqual(['/v1/chat','/v1/chat','/v1/chat']);
 expect(writes.map(w=>w.body.conversationId)).toEqual([undefined,'conversation-1',undefined]);
});
test('landing keeps its graph and Wyntrax attribution in both languages',async({page})=>{
 for(const prefix of ['','/id']){await page.goto(prefix||'/');await expect(page.locator('.signal-graph')).toBeVisible();const link=page.locator('.powered-by-hero');await expect(link).toHaveAttribute('href','https://wyntrax.xyz');await expect(link).toContainText('Wyntrax');}
});

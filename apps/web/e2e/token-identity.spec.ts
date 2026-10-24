import {test,expect} from '@playwright/test';
import {researchApi,enterWorkspace,token} from './research-fixtures';

const artwork='https://cdn.dexscreener.com/cms/images/token-identity-fixture?width=80&height=80';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#2dd4bf"/><circle cx="40" cy="40" r="14" fill="#0f172a"/></svg>';
const items=[
 {...token,symbol:'PUMP',name:'Pump',imageUrl:artwork},
 {...token,mint:'A'.repeat(44),symbol:'AKE',name:'Akedo',imageUrl:null},
 {...token,mint:'B'.repeat(44),symbol:'VERYLONGSYMBOL',name:'A very long token name that must truncate instead of wrapping',imageUrl:artwork},
];

for(const width of [1440,1024,390])for(const theme of ['dark','light'])test(`token identity layout ${width} ${theme}`,async({page,baseURL})=>{
 await page.setViewportSize({width,height:900});
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:baseURL!}]);
 await page.route('https://cdn.dexscreener.com/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
 await researchApi(page,path=>path==='/v1/tokens'?{body:{items,nextCursor:null}}:undefined);
 await enterWorkspace(page,'/app/tokens');
 await expect(page.locator('.token-identity')).toHaveCount(3);
 const row=page.locator('.research-table tbody tr').first();
 await expect(row.locator('.token-avatar img')).toBeVisible();
 await expect(row.locator('.token-identity-symbol')).toHaveText('PUMP');
 await expect(row.locator('.token-identity-name')).toHaveText('Pump');
 for(const identity of await page.locator('.token-identity').all()){
  const avatar=await identity.locator('.token-avatar').boundingBox(),text=await identity.locator('.token-identity-text').boundingBox();
  expect(avatar).not.toBeNull();expect(text).not.toBeNull();
  expect(text!.x).toBeGreaterThanOrEqual(avatar!.x+avatar!.width);
  expect((await identity.locator('.token-identity-symbol').boundingBox())!.height).toBeLessThan(30);
  expect((await identity.locator('.token-identity-name').boundingBox())!.height).toBeLessThan(24);
  expect(await identity.locator('.token-identity-symbol').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await row.scrollIntoViewIfNeeded();
 await page.locator('.research-table').screenshot({path:`test-results/token-identity-${width}-${theme}.png`});
});

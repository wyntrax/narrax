import {test,expect} from '@playwright/test';
import {researchApi,enterWorkspace,token,observation,access} from './research-fixtures';
import AxeBuilder from '@axe-core/playwright';

test('market scan requests provenance, labels FDV and measured zero, and filters on the server',async({page})=>{
 const requests=await researchApi(page);await enterWorkspace(page,'/app/tokens');
 await expect(page.getByRole('cell',{name:'0%',exact:true})).toBeVisible();await expect(page.getByText('Fully diluted value',{exact:true})).toBeVisible();
 expect(requests).toContain('/v1/tokens?limit=20&verifiedOnly=true&sort=liquidity');
 await page.getByRole('button',{name:'Pools under 24h',exact:true}).click();
 await expect.poll(()=>requests.some(p=>p.includes('maxAgeMinutes=1440')&&p.includes('sort=age'))).toBe(true);
 await page.getByRole('button',{name:'Most active · 24h',exact:true}).click();await expect.poll(()=>requests.some(p=>p.includes('sort=volume24h'))).toBe(true);
 await expect(page.getByRole('link',{name:/raydium/})).toHaveAttribute('href',`https://dexscreener.com/solana/${observation.pairAddress}`);
});
test('stale linked prices remain explicitly historical and missing provenance never displays a price',async({page})=>{
 await researchApi(page,path=>path==='/v1/tokens'?{body:{items:[{...token,priceUsd:999,observation:{...observation,stale:true}},{...token,mint:'missing',symbol:'MISSING',priceUsd:888,observation:null}],nextCursor:null}}:undefined);
 await enterWorkspace(page,'/app/tokens');
 const stale=page.getByRole('row').filter({has:page.getByRole('link',{name:/ROBOT/})});
 await expect(stale).toContainText('$999');await expect(stale).toContainText('Last observed · not current');await expect(stale).toContainText('Stale snapshot');await expect(stale).not.toContainText('Provider snapshot');
 const missing=page.getByRole('row').filter({has:page.getByRole('link',{name:/MISSING/})});
 await expect(missing).not.toContainText('$888');await expect(missing).toContainText('Unverified history');
});
test('early access can read the source-backed token list without a paid screener',async({page})=>{
 const requests=await researchApi(page,path=>path==='/v1/me/entitlements'?{body:{...access,rollout:{enforced:true,shadow_log:true},features:{...access.features,'research.screener':{requiredTier:'PRO',min_entitlement_age_hours:0,allowed:false}}}}:undefined);
 await enterWorkspace(page,'/app/tokens');await expect(page.getByRole('link',{name:/ROBOT/})).toBeVisible();expect(requests).toContain('/v1/tokens?limit=20&verifiedOnly=true&sort=symbol');
});
test('opportunity model scores stay in explicit history rather than masquerading as current setups',async({page})=>{
 await researchApi(page);await enterWorkspace(page,'/app/opportunities');await expect(page.locator('.score-breakdown')).toHaveCount(0);await expect(page.getByRole('link',{name:/ROBOT/})).toBeVisible();
 await page.getByRole('button',{name:'Inspect historical scores and analysis'}).click();await expect(page.locator('.score-breakdown')).toBeVisible();await expect(page.getByText(/may include development\/test history/)).toBeVisible();
});
test('recorded profile scores remain provisional and performance requires explicit historical inspection',async({page})=>{
  await researchApi(page,path=>path==='/v1/smart-money/wallets'?{body:{items:[{address:token.mint,label:'Observed wallet',score:76.4,winRate:.95,pnl30dSol:9876,source:'MANUAL',profileAt:observation.at,evidenceStatus:'UNVERIFIED',observedTrades:4,lastTradeAt:observation.at}],nextCursor:null}}:undefined);
  await enterWorkspace(page,'/app/smart-money');await page.getByRole('tab',{name:'Wallet directory'}).click();await expect(page.getByRole('link',{name:/Observed wallet/})).toHaveAttribute('href',`/app/smart-money/${token.mint}`);await expect(page.getByRole('link',{name:'Solscan ↗'})).toHaveAttribute('href',`https://solscan.io/account/${token.mint}`);
   await expect(page.locator('.research-table')).toContainText('Profile recorded');await expect(page.locator('.research-table')).toContainText('Score 76.4');await expect(page.locator('.research-table')).toContainText('Provisional');await expect(page.locator('.research-table')).not.toContainText('95%');await expect(page.locator('.research-table')).not.toContainText('9,876');await expect(page.getByText(/rankings remain unverified/)).toBeVisible();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
   await page.getByRole('button',{name:'Inspect historical scores and analysis'}).click();await expect(page.locator('.research-table').last()).toContainText('76.4');await expect(page.locator('.research-table').last()).toContainText('95%');await expect(page.locator('.research-table').last()).toContainText('9,876');
});

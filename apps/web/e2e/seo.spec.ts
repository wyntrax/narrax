import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {researchGuides,researchCopy} from '../src/content/research-guides';
import {productFacts} from '../src/content/product-facts';

const origin=process.env.NEXT_PUBLIC_SITE_URL||'http://localhost:4010';
const indexable=process.env.NARRA_SEO_INDEXABLE==='true'&&origin.startsWith('https://')&&!origin.includes('localhost');
const url=(path:string)=>`${origin}${path}`;

test('public product answers and preview metadata are readable without JavaScript',async({request})=>{
 test.setTimeout(180000);
 for(const agent of ['Twitterbot/1.0','TelegramBot (like TwitterBot)']){
  const response=await request.get('/',{headers:{'user-agent':agent}}),html=await response.text(),head=html.split('</head>')[0];
  expect(response.status()).toBe(200);
   expect(head).toContain('summary_large_image');expect(head).toContain('/share/en/home.png?v=3');
  expect(html).toContain(productFacts.en.summary);
  for(const item of productFacts.en.questions)expect(html).toContain(item.question);
  expect(html).toContain('FAQPage');
  if(process.env.NARRA_GOOGLE_SITE_VERIFICATION)expect(head).toContain(`name="google-site-verification" content="${process.env.NARRA_GOOGLE_SITE_VERIFICATION}"`);
 }
 const directory=await request.get('/llms.txt');expect(directory.status()).toBe(200);
 expect(directory.headers()['content-type']).toContain('text/plain');
 const text=await directory.text();expect(text).toContain('/id/research/');expect(text).not.toContain('/app/');
});

for(const locale of ['en','id'] as const)test(`public SEO: ${locale} canonicals, hreflang and server-rendered guides`,async({page,request})=>{
 test.setTimeout(180000);
 const prefix=locale==='id'?'/id':'',copy=researchCopy[locale];
 for(const path of ['', '/research','/methodology',...researchGuides[locale].map(g=>`/research/${g.slug}`)]){
  const response=await page.goto(`${prefix}${path}`||'/');expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang',locale);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',url(`${prefix}${path}`));
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href',url(path));
  await expect(page.locator('link[rel="alternate"][hreflang="id"]')).toHaveAttribute('href',url(`/id${path}`));
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute('href',url(path));
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content',url(`${prefix}${path}`));
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content',/.{50,}/);
  await expect(page.locator('head link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',indexable?/^index,/:/noindex/);
   const image=await page.locator('meta[property="og:image"]').getAttribute('content');expect(image).toContain(`/share/${locale}/`);
   await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content',image!);
  const scripts=await page.locator('script[type="application/ld+json"]').evaluateAll(nodes=>nodes.map(node=>({nonce:(node as HTMLScriptElement).nonce,data:JSON.parse(node.textContent!)})));
  expect(scripts.length).toBeGreaterThan(0);expect(scripts.every(script=>!!script.nonce)).toBe(true);
  const policy=response?.headers()['content-security-policy']??'';
  expect(scripts.every(script=>policy.includes(`'nonce-${script.nonce}'`))).toBe(true);
  expect(await page.title()).toContain('Narrax');
 }
 // The actual article text and schema are available to a crawler without hydration.
 const guide=researchGuides[locale][0]!,response=await request.get(`${prefix}/research/${guide.slug}`,{headers:{'user-agent':'Twitterbot/1.0'}}),html=await response.text();
 expect(html).toContain(guide.sections[0]!.title);expect(html).toContain('application/ld+json');expect(html).toContain('rel="canonical"');
 const raw=await request.get(`${prefix}/research/${guide.slug}`,{headers:{'user-agent':'Mozilla/5.0'}}),source=await raw.text(),head=source.split('</head>')[0];
 expect(head).toContain('name="description"');expect(head).toContain('rel="canonical"');
 await page.goto(`${prefix}/research`);await page.getByRole('heading',{name:guide.title}).getByRole('link').click();
 await expect(page.getByRole('heading',{level:1})).toHaveText(guide.title);
 await expect(page.getByRole('link',{name:copy.methodology}).first()).toBeVisible();
});

test('robots, sitemap and private routes enforce publication boundaries',async({request})=>{
 const robots=await request.get('/robots.txt'),text=await robots.text();expect(robots.status()).toBe(200);
 const sitemap=await request.get('/sitemap.xml'),xml=await sitemap.text();expect(sitemap.status()).toBe(200);
 if(indexable){expect(text).toContain('Allow: /');expect(text).toContain(`${origin}/sitemap.xml`);expect((xml.match(/<loc>/g)||[]).length).toBe(12);}
 else{expect(text).toContain('Disallow: /');expect(xml).not.toContain('<loc>');}
 expect(xml).not.toMatch(/early-access|\/app|<lastmod>/);
 for(const path of ['/app','/id/app/tokens','/early-access','/id/early-access']){
  const response=await request.get(path);expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
  const html=await response.text();expect(html).toMatch(/name="robots" content="noindex, nofollow"/);expect(html).not.toContain('rel="canonical"');
 }
});

test('unknown guides return a real 404 and are not indexed',async({request})=>{
 for(const path of ['/research/this-guide-does-not-exist','/id/research/this-guide-does-not-exist']){
  const response=await request.get(path,{headers:{'user-agent':'Twitterbot/1.0'}});
  expect(response.status()).toBe(404);expect(await response.text()).toContain('noindex');
 }
});

test('localized social preview images are valid PNGs',async({request})=>{
 test.setTimeout(120000);
   for(const path of ['/opengraph-image','/id/opengraph-image',...(['en','id'] as const).flatMap(locale=>['home','research','methodology',...researchGuides[locale].map(g=>g.slug)].map(key=>`/share/${locale}/${key}.png?v=3`))]){
   const response=await request.get(path,{headers:{'user-agent':'TelegramBot (like TwitterBot)'}});expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');const bytes=await response.body();
   expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(bytes.readUInt32BE(16)).toBe(1200);expect(bytes.readUInt32BE(20)).toBe(630);
   expect(bytes.length).toBeLessThan(5*1024*1024);
  }
  expect((await request.get('/share/en/not-a-real-page.png')).status()).toBe(404);
});

for(const width of [390,1440])for(const theme of ['dark','light'])test(`research guides accessibility: ${width}px ${theme}`,async({page})=>{
 test.setTimeout(120000);
  await page.setViewportSize({width,height:900});await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:process.env.E2E_BASE_URL??'http://localhost:4010'}]);
 for(const path of ['/research','/research/early-token-risk-checklist','/id/methodology']){
  await page.goto(path);await expect(page.locator('h1')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations).toEqual([]);
 }
});

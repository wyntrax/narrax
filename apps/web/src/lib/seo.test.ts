import {afterEach,describe,expect,it,vi} from 'vitest';
import {languageAlternates,localizedPath,pageMetadata,searchIndexable,serializeJsonLd} from './seo';
import {articleSchema,breadcrumbSchema,websiteSchema} from './structured-data';
import {researchCopy,researchGuides} from '@/content/research-guides';
import {methodologyContent} from '@/content/methodology';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

afterEach(()=>vi.unstubAllEnvs());
function production(){vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://narrax.example');vi.stubEnv('NARRA_SEO_INDEXABLE','true');}
describe('search publication safeguards',()=>{
 it.each(['false','',undefined])('requires explicit indexing opt-in (%s)',value=>{
  production();vi.stubEnv('NARRA_SEO_INDEXABLE',value);
  expect(searchIndexable()).toBe(false);expect(sitemap()).toEqual([]);expect(robots().rules).toEqual({userAgent:'*',disallow:'/'});
 });
 it.each(['http://localhost:4010','https://localhost','https://127.0.0.1','https://preview.localhost','http://narrax.example'])('blocks unsafe origin %s',origin=>{
  production();vi.stubEnv('NEXT_PUBLIC_SITE_URL',origin);expect(searchIndexable()).toBe(false);
 });
 it('publishes crawlable production robots without hiding noindex directives',()=>{
  production();expect(robots()).toEqual({rules:{userAgent:'*',allow:'/'},sitemap:'https://narrax.example/sitemap.xml'});
 });
});
describe('localized canonical metadata',()=>{
 it('uses unprefixed English and prefixed Indonesian URLs',()=>{
  production();expect(localizedPath('en','/')).toBe('/');expect(localizedPath('id','/')).toBe('/id');
  expect(languageAlternates('/research')).toEqual({en:'https://narrax.example/research',id:'https://narrax.example/id/research','x-default':'https://narrax.example/research'});
 });
 it('gives each public page its own canonical and localized share metadata',()=>{
  production();const m=pageMetadata('id','/research/test','Judul','Deskripsi');
  expect(m.alternates?.canonical).toBe('https://narrax.example/id/research/test');
  expect(m.openGraph).toMatchObject({url:'https://narrax.example/id/research/test',locale:'id_ID',title:'Judul | Narrax',images:[{url:'https://narrax.example/id/opengraph-image',width:1200,height:630}]});
  expect(m.twitter).toMatchObject({card:'summary_large_image',description:'Deskripsi'});
  expect(m.robots).toMatchObject({index:true,follow:true});
 });
 it('noindexes metadata in preview mode',()=>{
  production();vi.stubEnv('NARRA_SEO_INDEXABLE','false');expect(pageMetadata('en','','Title','Description').robots).toMatchObject({index:false});
 });
 it('includes only actual public pages, reciprocal hreflang and no fabricated freshness dates',()=>{
  production();const entries=sitemap();expect(entries).toHaveLength(12);expect(new Set(entries.map(item=>item.url)).size).toBe(12);
  for(const entry of entries){expect(entry.url).not.toMatch(/\/app|early-access|\/en\//);expect(entry.lastModified).toBeUndefined();expect(Object.keys(entry.alternates!.languages!)).toEqual(['en','id','x-default']);}
 });
});
describe('truthful structured data and editorial coverage',()=>{
 it('escapes script injection and round-trips JSON-LD',()=>{
  const value={text:'</script><script>alert("x")</script>&\u2028\u2029'};const output=serializeJsonLd(value);
  expect(output).not.toContain('<');expect(output).not.toContain('&');expect(JSON.parse(output)).toEqual(value);
 });
 it('uses organization attribution without invented reviews, prices or publication dates',()=>{
  production();const article=articleSchema('id','/research/test','Judul','Deskripsi');
  expect(article.mainEntityOfPage['@id']).toBe('https://narrax.example/id/research/test');expect(article.inLanguage).toBe('id');
  const schemas=JSON.stringify([article,websiteSchema('en')]);expect(schemas).not.toMatch(/aggregateRating|reviewCount|priceCurrency|datePublished|SearchAction/);
  expect(breadcrumbSchema('id',[{name:'Beranda',path:''},{name:'Riset',path:'/research'}]).itemListElement[1]).toMatchObject({position:2,item:'https://narrax.example/id/research'});
 });
 it('keeps substantive translated guides, slugs and interface keys aligned',()=>{
  expect(Object.keys(researchCopy.en).sort()).toEqual(Object.keys(researchCopy.id).sort());
  expect(researchGuides.en.map(g=>g.slug)).toEqual(researchGuides.id.map(g=>g.slug));
  for(const locale of ['en','id'] as const){
   for(const guide of researchGuides[locale]){expect(guide.sections).toHaveLength(4);expect(guide.checklist).toHaveLength(5);expect(guide.description.length).toBeLessThanOrEqual(180);expect(guide.sections.flatMap(s=>s.paragraphs).join(' ').length).toBeGreaterThan(1500);}
   expect(methodologyContent[locale].sections).toHaveLength(6);
  }
 });
});

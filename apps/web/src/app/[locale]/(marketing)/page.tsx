import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';
import {Accordion} from '@/components/ui/primitives';
import {LazyPreview} from '@/components/marketing/lazy';
import {Reveal} from '@/components/marketing/reveal';
import {SignalGraph} from '@/components/marketing/signal-graph';
import {TierCards} from '@/components/marketing/tier-cards';
import {fetchRequirements} from '@/lib/requirements';
import {BrandMark} from '@/components/brand-mark';
import {PoweredBy} from '@/components/powered-by';
import {ArrowUpRight,BookOpen,ScanLine,Waypoints,ShieldCheck} from 'lucide-react';
import type {Metadata} from 'next';
import {pageMetadata,seoLocale} from '@/lib/seo';
import {researchCopy,researchGuides} from '@/content/research-guides';
import {StructuredData} from '@/components/marketing/structured-data';
import {websiteSchema} from '@/lib/structured-data';
import './research.css';

export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{
 const locale=seoLocale((await params).locale),copy=researchCopy[locale];
 return pageMetadata(locale,'',copy.homeTitle,copy.homeDescription);
}
export default async function Landing({params}:{params:Promise<{locale:string}>}){
 const locale=seoLocale((await params).locale),copy=researchCopy[locale];
 const t=await getTranslations('landing'),c=await getTranslations('common'),v=await getTranslations('visual'),requirements=await fetchRequirements();
  return <main id="main" className="landing-page">
   <StructuredData data={websiteSchema(locale)}/>
  <section className="hero container" id="home">
   <div className="hero-intro"><div><div className="hero-badges"><span className="badge"><BrandMark/>{v('solana')}</span><span className="badge">{c('earlyAccess')}</span></div><h1>{t('headlineStart')}<br/><span>{t('headlineAccent')}</span></h1><p className="hero-subcopy">{t('howBody')}</p></div><div className="hero-actions"><Link className="button button-primary" href="/early-access" prefetch={false}>{c('getAccess')}<ArrowUpRight size={17}/></Link><a className="button button-ghost" href="#how">{t('explore')}<span aria-hidden="true">↓</span></a></div></div>
   <SignalGraph/>
   <div className="hero-footnote"><ShieldCheck size={15}/><span>{t('messageOnly')}</span></div>
   <PoweredBy className="powered-by-hero"/>
  </section>
  <section id="how" className="section container process-section"><Reveal><div className="section-heading"><p className="eyebrow">{t('howEyebrow')}</p><h2>{t('howTitle')}</h2><p>{t('howBody')}</p></div><div className="three-grid">{[ScanLine,Waypoints,ShieldCheck].map((Icon,i)=><article className="how-card" key={i}><div className="how-top"><span className="feature-orb"><Icon size={24}/></span><span>0{i+1}</span></div><h3>{t(`step${i+1}Title`)}</h3><p>{t(`step${i+1}Body`)}</p></article>)}</div></Reveal></section>
  <section id="preview" className="section container"><Reveal><div className="section-heading"><p className="eyebrow">{t('previewEyebrow')}</p><h2>{t('previewTitle')}</h2></div><LazyPreview/></Reveal></section>
  <TierCards requirements={requirements}/>
  <section id="trust" className="section container trust"><div><p className="eyebrow">{t('trustEyebrow')}</p><h2>{t('trustTitle')}</h2><p>{c('disclaimer')}</p></div><div className="trust-list">{[1,2,3].map(i=><article key={i}><ShieldCheck size={21}/><div><h3>{t(`trust${i}Title`)}</h3><p>{t(`trust${i}Body`)}</p></div></article>)}</div></section>
  <section id="faq" className="section container faq"><div><p className="eyebrow">{t('faqEyebrow')}</p><h2>{t('faqTitle')}</h2></div><Accordion items={[1,2,3,4].map(i=>({title:t(`faq${i}Title`),body:t(`faq${i}Body`)}))}/></section>
   <section id="research" className="section research-landing" aria-labelledby="research-guides-title">
    <div className="container">
     <div className="research-landing-head">
      <div className="section-heading">
       <p className="eyebrow">{copy.guides}</p>
       <h2 id="research-guides-title">{copy.title}</h2>
       <p>{copy.intro}</p>
      </div>
      <Link className="research-landing-all" href="/research">{copy.all}<ArrowUpRight size={14} aria-hidden="true"/></Link>
     </div>
     <ul className="research-landing-grid">{researchGuides[locale].map((guide,i)=><li key={guide.slug}><article className="research-landing-card"><div className="research-landing-meta"><span>{String(i+1).padStart(2,'0')}</span><BookOpen size={17} aria-hidden="true"/></div><h3><Link href={`/research/${guide.slug}`}>{guide.title}</Link></h3><p>{guide.description}</p><span className="research-landing-read" aria-hidden="true">{copy.read}<ArrowUpRight size={14}/></span></article></li>)}</ul>
     <div className="research-landing-methodology"><div><h3>{copy.methodology}</h3><p>{copy.methodologyDescription}</p></div><Link className="button button-ghost" href="/methodology">{copy.methodologyCta}<ArrowUpRight size={15} aria-hidden="true"/></Link></div>
    </div>
   </section>
   <section className="final-cta container"><div className="final-orbit" aria-hidden="true"><BrandMark/></div><p className="eyebrow">{t('finalEyebrow')}</p><h2>{t('finalTitle')}</h2><p>{t('finalBody')}</p><Link className="button button-primary" href="/early-access">{c('getAccess')}<ArrowUpRight size={17}/></Link></section>
 </main>;
}

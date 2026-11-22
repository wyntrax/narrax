import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';
import {Accordion} from '@/components/ui/primitives';
import {LazyPreview} from '@/components/marketing/lazy';
import {Reveal} from '@/components/marketing/reveal';
import {SignalGraph} from '@/components/marketing/signal-graph';
import {TierCards} from '@/components/marketing/tier-cards';
import {HeroPlate, HeroReplayButton} from '@/components/marketing/hero-plate';
import {TaglineReveal} from '@/components/marketing/tagline-reveal';
import {fetchRequirements} from '@/lib/requirements';
import {BrandMark} from '@/components/brand-mark';
import {BrandLogo} from '@/components/brand-logo';
import {PoweredBy} from '@/components/powered-by';
import {ArrowUpRight, BookOpen, Clock, ScanLine, Waypoints, ShieldCheck} from 'lucide-react';
import type {Metadata} from 'next';
import {pageMetadata, seoLocale} from '@/lib/seo';
import {researchCopy, researchGuides} from '@/content/research-guides';
import {StructuredData} from '@/components/marketing/structured-data';
import {websiteSchema, productFaqSchema} from '@/lib/structured-data';
import {productFacts} from '@/content/product-facts';
import {ResearchSnapshot} from '@/components/marketing/research-snapshot';
import '@/components/marketing/research-snapshot.css';
import './research.css';

export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const locale = seoLocale((await params).locale);
  const copy = researchCopy[locale];
  return pageMetadata(locale, '', copy.homeTitle, copy.homeDescription);
}

export default async function Landing({params}: {params: Promise<{locale: string}>}) {
  const locale = seoLocale((await params).locale);
  const copy = researchCopy[locale];
  const t = await getTranslations('landing');
  const c = await getTranslations('common');
  const v = await getTranslations('visual');
  const requirements = await fetchRequirements();

  return (
    <main id="main" className="landing-page">
      <StructuredData data={[websiteSchema(locale), productFaqSchema(locale)]} />

      {/* 1. Bespoke Hero Copperplate Engraving Stage ("The Threshold") */}
      <section className="portal-stage" id="home">
        <HeroPlate />
        <div className="portal-content container">
          <div className="hero-intro">
            <div className="hero-copy-block">
              <div className="hero-badges">
                <span className="badge">
                  <BrandLogo brand="solana" size={14} />
                  {v('solana')}
                </span>
                <span className="badge">{c('earlyAccess')}</span>
              </div>
              <h1>
                {t('headlineStart')}
                <br />
                <span>{t('headlineAccent')}</span>
              </h1>
              <p className="hero-subcopy">{t('howBody')}</p>
              <div className="hero-actions">
                <Link className="button button-primary" href="/early-access" prefetch={false}>
                  {c('getAccess')}
                  <ArrowUpRight size={17} />
                </Link>
                <a className="button button-ghost" href="#how">
                  {t('explore')}
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </div>

          <div className="hero-strip">
            <div className="hero-strip-items">
              <div className="hero-strip-item">
                <BrandLogo brand="solana" size={16} />
                <span>{t('stripSolana')}</span>
              </div>
              <div className="hero-strip-item">
                <BrandLogo brand="privy" size={16} />
                <span>{t('stripPrivy')}</span>
              </div>
              <div className="hero-strip-item">
                <Clock size={16} aria-hidden="true" />
                <span>{t('stripGates')}</span>
              </div>
              <div className="hero-strip-item">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>{t('stripDryRun')}</span>
              </div>
            </div>
            <div className="hero-strip-meta">
              <PoweredBy className="powered-by-hero" />
              <HeroReplayButton label={c('replayPlate')} />
            </div>
          </div>
          <div className="hero-footnote">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>{t('messageOnly')}</span>
          </div>
        </div>
      </section>

      {/* 2. Restored SignalGraph ("Research workflow") */}
      <section className="section container workflow-band" aria-label={v('workflow')}>
        <SignalGraph />
      </section>

      {/* 3. Word-by-Word Scroll Tagline Reveal */}
      <TaglineReveal
        lines={[t('taglineLine1'), t('taglineLine2'), t('taglineLine3')]}
        hint={t('taglineHint')}
        replayLabel={t('replayReveal')}
      />

      {/* 4. Public Research Snapshot */}
      <ResearchSnapshot />

      {/* 5. Product Facts */}
      <section id="about-narrax" className="section container product-facts" aria-labelledby="product-facts-title">
        <div className="section-heading">
          <p className="eyebrow">
            <BrandMark className="eyebrow-mark" />
            <BrandLogo brand="solana" size={14} />
            NARRAX / SOLANA
          </p>
          <h2 id="product-facts-title">{productFacts[locale].title}</h2>
          <p>{productFacts[locale].summary}</p>
        </div>
        <div className="product-facts-grid">
          {productFacts[locale].questions.map((item, index) => (
            <article key={item.question} id={`product-answer-${index + 1}`}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
        <Link className="button button-ghost" href="/methodology">
          {copy.methodologyCta}
          <ArrowUpRight size={15} />
        </Link>
      </section>

      {/* 6. How It Works */}
      <section id="how" className="section container process-section">
        <Reveal>
          <div className="section-heading">
            <p className="eyebrow">{t('howEyebrow')}</p>
            <h2>{t('howTitle')}</h2>
            <p>{t('howBody')}</p>
          </div>
          <div className="three-grid">
            {[ScanLine, Waypoints, ShieldCheck].map((Icon, i) => (
              <article className="how-card" key={i}>
                <div className="how-top">
                  <span className="feature-orb">
                    <Icon size={22} />
                  </span>
                  <span>0{i + 1}</span>
                </div>
                <h3>{t(`step${i + 1}Title`)}</h3>
                <p>{t(`step${i + 1}Body`)}</p>
              </article>
            ))}
          </div>
        </Reveal>
      </section>

      {/* 7. Inside the Workspace Preview */}
      <section id="preview" className="section container">
        <Reveal>
          <div className="section-heading">
            <p className="eyebrow">{t('previewEyebrow')}</p>
            <h2>{t('previewTitle')}</h2>
          </div>
          <LazyPreview />
        </Reveal>
      </section>

      {/* 8. Access Tiers */}
      <TierCards requirements={requirements} />

      {/* 9. Clear Boundaries (with Solana & Privy Dark/Light Brand Logos) */}
      <section id="trust" className="section container trust">
        <div>
          <p className="eyebrow">{t('trustEyebrow')}</p>
          <h2>{t('trustTitle')}</h2>
          <p>{c('disclaimer')}</p>
        </div>
        <div className="trust-list">
          <article>
            <span className="trust-icon-wrap" aria-hidden="true">
              <BrandLogo brand="solana" size={22} />
            </span>
            <div>
              <h3>{t('trust1Title')}</h3>
              <p>{t('trust1Body')}</p>
            </div>
          </article>
          <article>
            <span className="trust-icon-wrap" aria-hidden="true">
              <BrandLogo brand="privy" size={22} />
            </span>
            <div>
              <h3>{t('trust2Title')}</h3>
              <p>{t('trust2Body')}</p>
            </div>
          </article>
          <article>
            <span className="trust-icon-wrap" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3>{t('trust3Title')}</h3>
              <p>{t('trust3Body')}</p>
            </div>
          </article>
        </div>
      </section>

      {/* 10. FAQ */}
      <section id="faq" className="section container faq">
        <div>
          <p className="eyebrow">{t('faqEyebrow')}</p>
          <h2>{t('faqTitle')}</h2>
        </div>
        <Accordion items={[1, 2, 3, 4].map(i => ({title: t(`faq${i}Title`), body: t(`faq${i}Body`)}))} />
      </section>

      {/* 11. Research Library */}
      <section id="research" className="section research-landing" aria-labelledby="research-guides-title">
        <div className="container">
          <div className="research-landing-head">
            <div className="section-heading">
              <p className="eyebrow">{copy.guides}</p>
              <h2 id="research-guides-title">{copy.title}</h2>
              <p>{copy.intro}</p>
            </div>
            <Link className="research-landing-all" href="/research">
              {copy.all}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <ul className="research-landing-grid">
            {researchGuides[locale].map((guide, i) => (
              <li key={guide.slug}>
                <article className="research-landing-card">
                  <div className="research-landing-meta">
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <BookOpen size={17} aria-hidden="true" />
                  </div>
                  <h3>
                    <Link href={`/research/${guide.slug}`}>{guide.title}</Link>
                  </h3>
                  <p>{guide.description}</p>
                  <span className="research-landing-read" aria-hidden="true">
                    {copy.read}
                    <ArrowUpRight size={14} />
                  </span>
                </article>
              </li>
            ))}
          </ul>
          <div className="research-landing-methodology">
            <div>
              <h3>{copy.methodology}</h3>
              <p>{copy.methodologyDescription}</p>
            </div>
            <Link className="button button-ghost" href="/methodology">
              {copy.methodologyCta}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* 12. Final CTA */}
      <section className="final-cta container">
        <div className="final-orbit" aria-hidden="true">
          <BrandMark />
        </div>
        <p className="eyebrow">{t('finalEyebrow')}</p>
        <h2>{t('finalTitle')}</h2>
        <p>{t('finalBody')}</p>
        <Link className="button button-primary" href="/early-access">
          {c('getAccess')}
          <ArrowUpRight size={17} />
        </Link>
      </section>
    </main>
  );
}

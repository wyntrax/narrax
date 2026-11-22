import {getTranslations, getLocale} from 'next-intl/server';
import {researchCopy} from '@/content/research-guides';
import {seoLocale} from '@/lib/seo';
import {Link} from '@/i18n/navigation';
import {cookies} from 'next/headers';
import {ThemeToggle, LocaleToggle} from './toggles';
import {MarketingNavigation} from './marketing/navigation';
import {BrandMark} from './brand-mark';
import {BrandLogo} from './brand-logo';
import {PoweredBy} from './powered-by';
import {ObservatoryFooter, FooterReplayButton} from './marketing/observatory-footer';

export async function Header() {
  const t = await getTranslations('common');
  return (
    <header className="site-header">
      <Link href="/" prefetch={false} className="brand" aria-label={t('home')}>
        <BrandMark />
        <span>NARRAX</span>
      </Link>
      <nav aria-label={t('navigation')}>
        <MarketingNavigation />
      </nav>
    </header>
  );
}

export async function Footer() {
  const t = await getTranslations('common');
  const d = await getTranslations('design');
  const f = await getTranslations('landing.features');
  const locale = seoLocale(await getLocale());
  const copy = researchCopy[locale];
  const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark';

  return (
    <ObservatoryFooter plateLabel="Narrax Celestial Observatory copperplate engraving">
      <div className="footer-columns">
        {/* Column 1: Brand Identity + Early Access CTA & Theme Controls (moved from navbar) */}
        <div className="footer-col footer-col-0">
          <div className="footer-brand-row">
            <span className="brand-square" aria-hidden="true">
              <BrandMark inverted />
            </span>
            <span className="footer-brand-name">NARRAX</span>
          </div>
          <p className="footer-strapline">{t('research')}</p>
          <div className="footer-cta-stack">
            <Link className="button button-primary footer-early-cta" prefetch={false} href="/early-access">
              {t('getAccess')} <span aria-hidden="true">↗</span>
            </Link>
            <div className="footer-controls">
              <ThemeToggle initial={theme} showLabel />
              <LocaleToggle />
            </div>
          </div>
          <FooterReplayButton label={t('replayEngraving')} />
        </div>

        {/* Column 2: Workspace */}
        <div className="footer-col footer-col-1">
          <span className="footer-col-heading">{t('footerWorkspace')}</span>
          <nav className="footer-links-col" aria-label={t('footerWorkspace')}>
            <Link href="/app/radar" prefetch={false} className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {t('openRadar')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/app/smart-money" prefetch={false} className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {f('smart_money')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/app/opportunities" prefetch={false} className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {f('opportunities')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/app" prefetch={false} className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {f('overview')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
          </nav>
        </div>

        {/* Column 3: Research & Navigation */}
        <div className="footer-col footer-col-2">
          <span className="footer-col-heading">{t('footerVerification')}</span>
          <nav className="footer-links-col footer-research-links" aria-label={copy.guides}>
            <Link href="/research" className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {copy.guides}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/methodology" className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {copy.methodology}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/#how" className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {t('how')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/#access" className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {d('tiers')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
            <Link href="/#faq" className="tide-link">
              <span className="link-dash" aria-hidden="true" />
              <span className="link-text">
                {d('faq')}
                <span className="link-underline" aria-hidden="true" />
              </span>
            </Link>
          </nav>
        </div>

        {/* Column 4: Resources & Disclosures */}
        <div className="footer-col footer-col-3">
          <span className="footer-col-heading">{t('footerResources')}</span>
          <div className="footer-ecosystems">
            <PoweredBy />
            <div className="footer-partner-badges">
              <span className="partner-chip">
                <BrandLogo brand="solana" size={14} />
                <span>{t('networkSolana')}</span>
              </span>
              <span className="partner-chip">
                <BrandLogo brand="privy" size={14} />
                <span>{t('poweredByPrivy')}</span>
              </span>
            </div>
          </div>
          <p className="footer-legal">{t('disclaimer')}</p>
          <p className="footer-legal">{t('privacy')}</p>
        </div>
      </div>
    </ObservatoryFooter>
  );
}

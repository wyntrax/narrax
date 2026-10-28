import {useLocale,useTranslations} from 'next-intl';
import {ArrowUpRight,Check} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {TIER_LEVELS,holdingFor,tierFeatures} from '@/config/tiers';
import type {Requirements} from '@/lib/schemas';
import {Reveal} from './reveal';
import {TokenAvatar} from '@/features/research/token-identity';
import {proCopy} from '@/features/pro-research/copy';

export function TierCards({requirements}:{requirements:Requirements|null}){
 const t=useTranslations('landing'),c=useTranslations('tierCards'),locale=useLocale();
  const number=new Intl.NumberFormat(locale);
  const pro=proCopy[locale==='id'?'id':'en'];
  const featureLabel=(feature:string)=>feature==='research.smart_money_rankings'?pro.rankings:feature==='research.smart_money_investigation'?pro.investigation:feature==='research.personal_radar'?pro.radar:feature==='research.thesis_tracker'?pro.thesis:feature==='research.personal_briefing'?pro.briefing:t(`features.${feature.replace('research.','')}`);
 return <section id="access" className="section container"><Reveal>
  <div className="section-heading"><p className="eyebrow">{t('accessEyebrow')}</p><h2>{t('accessTitle')}</h2><p>{t('accessBody')}</p></div>
  <div className="tier-grid">{TIER_LEVELS.map(tier=>{
   const early=tier==='EARLY_ACCESS',holding=holdingFor(tier,requirements);
   return <article className={`tier-card ${tier==='PRO'?'tier-highlight':''}`} key={tier} data-tier={tier}>
    <p className="eyebrow">{t(`tiers.${tier}`)}</p><h3>{t(`tierHeadings.${tier}`)}</h3>
    <p className="tier-price">{early?c('earlyRequirement'):holding?<span className="token-artwork-label"><TokenAvatar symbol={holding.symbol} imageUrl={requirements?.tokenImageUrl}/><span>{t('holdingLabel',{amount:number.format(holding.amount),symbol:holding.symbol})}</span></span>:c('unavailable')}</p>
      <ul>{tierFeatures(tier,requirements).map(([feature])=><li key={feature}><Check size={14}/>{featureLabel(feature)}</li>)}</ul>
    <Link className="button button-ghost" href={early?'/early-access':'/app'} prefetch={false}>{c(early?'earlyCta':'paidCta')}<ArrowUpRight size={15}/></Link>
   </article>;
  })}</div>
  <p className="tier-note">{c('validationNote')}</p>
 </Reveal></section>;
}

import {getLocale,getTranslations} from 'next-intl/server';
import {AuthBoundary} from '@/components/auth/boundary';
import {AccessFlow} from '@/features/access/controller';
import {BrandMark} from '@/components/brand-mark';
import {ShieldCheck,ArrowLeft,Send} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {HOLDING_TIERS} from '@narra/shared';
import {fetchRequirements} from '@/lib/requirements';
import {PoweredBy} from '@/components/powered-by';
import {TokenAvatar} from '@/features/research/token-identity';
import './access-design.css';

export default async function EarlyAccess(){
 const t=await getTranslations('access'),c=await getTranslations('common'),l=await getTranslations('landing'),v=await getTranslations('visual'),locale=await getLocale(),requirements=await fetchRequirements();
 return <main id="main" className="access-page container">
  <div className="access-atmosphere" aria-hidden="true"/>
  <div className="access-layout">
   <div className="access-heading"><Link href="/" className="access-back"><ArrowLeft size={14}/>{v('back')}</Link><span className="badge access-eyebrow">{c('earlyAccess')}</span><h1>{l('headlineStart')}<br/><span>{l('headlineAccent')}</span></h1><p>{t('subcopy')}</p><div className="access-emblem" aria-hidden="true"><span/><span/><div className="core-emblem"><BrandMark/></div><i className="emblem-satellite satellite-one"/><i className="emblem-satellite satellite-two"/></div><p className="access-assurance"><ShieldCheck size={16}/>{l('messageOnly')}</p></div>
   <div className="access-stage"><div className="access-panel-label"><span className="tiny-dot"/>{v('accountAccess')}<span>01 — 03</span></div><AuthBoundary><AccessFlow/></AuthBoundary><p className="access-telegram"><span>{t('telegramHint')}</span><a href="https://t.me/wyntraxyz" target="_blank" rel="noopener noreferrer"><Send size={14} aria-hidden="true"/>{t('telegramCta')}</a></p></div>
  </div>
  {requirements&&<section className="access-levels" aria-label={l('accessTitle')}><ul>{HOLDING_TIERS.map(tier=><li key={tier}><span>{l(`tiers.${tier}`)}</span><b className="token-artwork-label"><TokenAvatar symbol={requirements.tokenSymbol} imageUrl={requirements.tokenImageUrl}/><span>{new Intl.NumberFormat(locale).format(requirements.tiers[tier])} {requirements.tokenSymbol}</span></b></li>)}</ul>{requirements.tokenMint&&<p className="access-mint"><span className="token-artwork-label"><TokenAvatar symbol={requirements.tokenSymbol} imageUrl={requirements.tokenImageUrl}/><span>{l('mintLabel',{symbol:requirements.tokenSymbol})}</span></span> <code>{requirements.tokenMint}</code></p>}{requirements.earlyAccess.closesAt&&<p>{l('earlyWindow',{date:new Intl.DateTimeFormat(locale,{dateStyle:'long',timeZone:'UTC'}).format(new Date(requirements.earlyAccess.closesAt))})}</p>}<p>{l('tierNoteLive')}</p></section>}
  <PoweredBy className="powered-by-access"/>
 </main>;
}

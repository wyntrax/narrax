import {getLocale,getTranslations} from 'next-intl/server';
import {Instrument_Serif} from 'next/font/google';
import {AuthBoundary} from '@/components/auth/boundary';
import {AccessFlow} from '@/features/access/controller';
import './access-design.css';
const serif=Instrument_Serif({subsets:['latin'],weight:'400',style:'italic',display:'swap',variable:'--font-serif',preload:false});
export default async function EarlyAccess(){const t=await getTranslations('access'),c=await getTranslations('common'),locale=await getLocale();const word=locale==='id'?'ramai':'crowd',[before,after]=t('headline').split(word);return <main id="main" className={`access-page container ${serif.variable}`}><div className="access-atmosphere" aria-hidden="true"><svg className="access-stars" viewBox="0 0 1200 1000" preserveAspectRatio="none">{[[110,240],[260,390],[870,210],[1020,470],[350,170],[920,690],[160,660],[640,120],[740,430],[480,720],[1120,330],[70,490]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r={i%3===0?1.5:1} style={{animationDelay:`${i*-.7}s`}}/>)}</svg><div className="planet-horizon"/></div><div className="access-heading"><span className="badge access-eyebrow">{c('earlyAccess')}</span><h1>{before}<em>{word}</em>{after}</h1><p>{t('subcopy')}</p></div><div className="access-stage"><AuthBoundary><AccessFlow/></AuthBoundary></div></main>;}

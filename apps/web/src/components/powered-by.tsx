import {useTranslations} from 'next-intl';
import {POWERED_BY} from '@narra/shared';
import Image from 'next/image';

/** "Powered by Wyntrax" with a fixed link. The address is a constant in @narra/shared, never user or env input. */
export function PoweredBy({className=''}:{className?:string}){
 const t=useTranslations('common');
  return <a className={`powered-by ${className}`.trim()} href={POWERED_BY.url} aria-label={`${t('poweredBy')} ${POWERED_BY.name}`} target="_blank" rel="noopener noreferrer"><span>{t('poweredBy')}</span><Image src="/wyntrax-symbol.svg" width={20} height={20} alt="" aria-hidden="true" unoptimized/> <b>{POWERED_BY.name}</b><span aria-hidden="true"> ↗</span></a>;
}

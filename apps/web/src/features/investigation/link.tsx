'use client';
import {useLocale} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {investigationCopy} from './copy';
export function InvestigationLink({mint}:{mint?:string}) {
  const c=investigationCopy[useLocale()==='id'?'id':'en'];
  return <Link className="research-control" href={mint?`/app/investigation/${encodeURIComponent(mint)}`:'/app/investigation'}>{c.title}</Link>;
}

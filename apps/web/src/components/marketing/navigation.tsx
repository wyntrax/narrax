'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Link,usePathname} from '@/i18n/navigation';
import * as Dialog from '@radix-ui/react-dialog';
export function MarketingNavigation(){
 const [open,setOpen]=useState(false),path=usePathname(),t=useTranslations('design'),c=useTranslations('common');
 const links=[['/',t('home')],['/#how',c('how')],['/#preview',t('product')],['/#access',t('tiers')],['/#faq',t('faq')]];
 const items=links.map(([href,label])=><Link key={href} href={href!} prefetch={false} aria-current={href==='/'&&path==='/'?'page':undefined} onClick={()=>setOpen(false)}>[{label}]</Link>);
 return <><div className="bracket-nav">{items}</div><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger className="mobile-nav-trigger">[{t('menu')}]</Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content mobile-nav-dialog"><Dialog.Title>{t('menu')}</Dialog.Title><Dialog.Description>{t('menuDescription')}</Dialog.Description><nav aria-label={c('navigation')}>{items}<Link href="/early-access" prefetch={false} onClick={()=>setOpen(false)}>{t('earlyAccess')} ↗</Link></nav><Dialog.Close className="button button-ghost">{c('close')}</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}

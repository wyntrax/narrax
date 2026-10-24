'use client';
import {useEffect,useState} from 'react';
import {useTranslations} from 'next-intl';
import {Link,usePathname} from '@/i18n/navigation';
import * as Dialog from '@radix-ui/react-dialog';
export function MarketingNavigation(){
  const [open,setOpen]=useState(false),[active,setActive]=useState('home'),path=usePathname(),t=useTranslations('design'),c=useTranslations('common');
  useEffect(()=>{const header=document.querySelector<HTMLElement>('.site-header');if(!header)return;const update=()=>{header.dataset.scrolled=window.scrollY>8?'true':'false';};update();window.addEventListener('scroll',update,{passive:true});return()=>window.removeEventListener('scroll',update);},[]);
  useEffect(()=>{
    if(path!=='/')return;
    let frame=0;
    const update=()=>{
      frame=0;
      const offset=(document.querySelector('.site-header')?.getBoundingClientRect().height??80)+32;
      let current='home';
      for(const id of ['home','how','preview','access','faq']){const section=document.getElementById(id);if(section&&section.getBoundingClientRect().top<=offset)current=id;}
      const faq=document.getElementById('faq');
      if(faq&&window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2&&faq.getBoundingClientRect().top<window.innerHeight)current='faq';
      setActive(current);
    };
    const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(update);};
    update();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(schedule):null;
    const main=document.querySelector('.landing-page');if(main)observer?.observe(main);
    return()=>{window.cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);window.removeEventListener('hashchange',schedule);observer?.disconnect();};
  },[path]);
 const links=[['/',t('home')],['/#how',c('how')],['/#preview',t('product')],['/#access',t('tiers')],['/#faq',t('faq')]];
   const items=links.map(([href,label])=><Link key={href} href={href!} prefetch={false} aria-current={path==='/'&&active===(href==='/'?'home':href!.split('#')[1])?'location':undefined} onClick={()=>setOpen(false)}>{label}</Link>);
  return <><div className="bracket-nav">{items}</div><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger className="mobile-nav-trigger">{t('menu')} <span aria-hidden="true">+</span></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content mobile-nav-dialog"><Dialog.Title>{t('menu')}</Dialog.Title><Dialog.Description>{t('menuDescription')}</Dialog.Description><nav aria-label={c('navigation')}>{items}<Link href="/early-access" prefetch={false} onClick={()=>setOpen(false)}>{t('earlyAccess')} ↗</Link></nav><Dialog.Close className="button button-ghost">{c('close')}</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}

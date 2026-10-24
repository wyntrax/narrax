'use client';
import type {ReactNode} from 'react';
import {useTranslations} from 'next-intl';
import {EyeOff,KeyRound} from 'lucide-react';
import {BrandMark} from '@/components/brand-mark';
import {ThemeToggle,LocaleToggle} from '@/components/toggles';
import {Link} from '@/i18n/navigation';
import {PoweredBy} from '@/components/powered-by';

// Full-page frame for every state before the workspace opens (loading, timeout, sign-in).
export function GateShell({theme,children}:{theme?:string;children:ReactNode}){
 return <main id="main" className="workspace-gate gate-page" tabIndex={-1}>
  <div className="gate-grid" aria-hidden="true"/>
  {theme&&<div className="gate-tools"><LocaleToggle/><ThemeToggle initial={theme}/></div>}
  <div className="gate-card">{children}</div>
 </main>;
}

export function SignInGate({onLogin}:{onLogin:()=>void}){
 const t=useTranslations('workspace');
 return <>
   <Link href="/" className="gate-home" aria-label={t('enhance.backHome')}><BrandMark className="gate-mark"/><span>NARRAX</span></Link>
  <h1>{t('signIn')}</h1>
  <p className="gate-body">{t('signInBody')}</p>
  <button className="button button-primary gate-primary" onClick={onLogin}>{t('continue')}</button>
  <p className="gate-methods">{t('gateMethods')}</p>
  <ul className="gate-points">
   <li><EyeOff size={16} aria-hidden="true"/>{t('gateReadOnly')}</li>
   <li><KeyRound size={16} aria-hidden="true"/>{t('gateNoSeed')}</li>
  </ul>
   <p className="gate-alt">{t('gateNoAccess')} <Link href="/early-access">{t('gateRequest')}</Link></p>
   <Link className="gate-link gate-back" href="/">← {t('enhance.backHome')}</Link>
  <PoweredBy className="powered-by-gate"/>
 </>;
}

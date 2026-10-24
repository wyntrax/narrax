import type {ReactNode} from 'react';
import {cookies} from 'next/headers';
import {NextIntlClientProvider} from 'next-intl';
import {getLocale,getMessages} from 'next-intl/server';
import {AuthBoundary} from '@/components/auth/boundary';
import {ResearchWorkspace} from '@/features/research/session';
import {Outfit,JetBrains_Mono} from 'next/font/google';
import './workspace.css';
import './workspace-design.css';
const outfit=Outfit({subsets:['latin'],display:'swap',variable:'--font-workspace'});
const mono=JetBrains_Mono({subsets:['latin'],weight:'400',display:'swap',variable:'--font-workspace-mono',preload:false});
export default async function WorkspaceLayout({children}:{children:ReactNode}){
 const theme=(await cookies()).get('NARRA_THEME')?.value==='light'?'light':'dark';
 const locale=await getLocale(),messages=await getMessages(),workspace=(await import(`../../../../../messages/research/${locale}.json`)).default;
  return <NextIntlClientProvider messages={{common:messages.common,auth:messages.auth,flow:messages.flow,workspace}}><div className={`product workspace-entry ${outfit.variable} ${mono.variable}`}><AuthBoundary landmark><ResearchWorkspace theme={theme}>{children}</ResearchWorkspace></AuthBoundary></div></NextIntlClientProvider>;
}

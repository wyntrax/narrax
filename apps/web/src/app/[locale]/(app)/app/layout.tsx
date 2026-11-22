import type {ReactNode} from 'react';
import {cookies} from 'next/headers';
import {NextIntlClientProvider} from 'next-intl';
import {getLocale, getMessages} from 'next-intl/server';
import {AuthBoundary} from '@/components/auth/boundary';
import {ResearchWorkspace} from '@/features/research/session';
import './workspace.css';
import './workspace-design.css';
import '@/features/access/access-design.css';

export default async function WorkspaceLayout({children}: {children: ReactNode}) {
  const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark';
  const locale = await getLocale();
  const messages = await getMessages();
  const workspace = (await import(`../../../../../messages/research/${locale}.json`)).default;
  return (
    <NextIntlClientProvider messages={{common: messages.common, auth: messages.auth, flow: messages.flow, workspace}}>
      <div className="product workspace-entry">
        <AuthBoundary landmark>
          <ResearchWorkspace theme={theme}>{children}</ResearchWorkspace>
        </AuthBoundary>
      </div>
    </NextIntlClientProvider>
  );
}

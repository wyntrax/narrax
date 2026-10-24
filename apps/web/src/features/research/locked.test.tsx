import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';
import {Locked} from './ui';
vi.mock('@/i18n/navigation',()=>({Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
afterEach(cleanup);
it.each(['en','id'] as const)('renders a localized, readable minimum tier with clear actions (%s)',locale=>{
 const messages=locale==='en'?en:id;
 render(<NextIntlClientProvider locale={locale} messages={{workspace:messages}}><Locked tier="EARLY_ACCESS"/></NextIntlClientProvider>);
 expect(screen.getByRole('heading',{name:messages.locked})).toBeVisible();expect(screen.getByText(messages.featureAccess.tiers.EARLY_ACCESS)).toBeVisible();
 expect(screen.queryByText('EARLY_ACCESS')).toBeNull();expect(screen.getByRole('link',{name:messages.access})).toHaveAttribute('href','/early-access');expect(screen.getByRole('link',{name:messages.accessCard.portfolio})).toHaveAttribute('href','/app/portfolio');
});

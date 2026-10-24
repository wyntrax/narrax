import {cleanup,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import en from '../../../messages/en.json';
import id from '../../../messages/id.json';
import {fetchRequirements} from '@/lib/requirements';
import type {Requirements} from '@/lib/schemas';
import {TierCards} from './tier-cards';
vi.mock('@/i18n/navigation',()=>({Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./reveal',()=>({Reveal:({children}:{children:ReactNode})=><div>{children}</div>}));
afterEach(cleanup);
const requirements={tokenSymbol:'$CUSTOM',tokenMint:null,tiers:{MEMBER:250000,PRO:750000,ELITE:5000000},earlyAccess:{closesAt:null,accessDays:null}};
function view(data:Requirements|null,locale:'en'|'id'='en'){
 return <NextIntlClientProvider locale={locale} messages={locale==='en'?en:id}><TierCards requirements={data}/></NextIntlClientProvider>;
}
it.each(['en','id'] as const)('renders fetched admin amounts and separates free admission from paid sign-in (%s)',async locale=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(requirements)));
 const data=await fetchRequirements('http://localhost:4000',fetcher);
 const result=render(view(data,locale));
 expect(fetcher).toHaveBeenCalledWith(new URL('http://localhost:4000/v1/access/requirements'),expect.objectContaining({cache:'no-store',credentials:'omit'}));
 const number=new Intl.NumberFormat(locale),copy=locale==='en'?en:id;
 const early=result.container.querySelector('[data-tier="EARLY_ACCESS"]')!;
 expect(early).toHaveTextContent(copy.tierCards.earlyRequirement);
 expect(early).not.toHaveTextContent('$CUSTOM');expect(within(early as HTMLElement).getByRole('link')).toHaveAttribute('href','/early-access');
  expect(result.container.querySelector('[data-tier="ELITE"]')).toBeNull();
  for(const tier of ['MEMBER','PRO'] as const){const card=result.container.querySelector(`[data-tier="${tier}"]`)!;
  expect(card).toHaveTextContent(`${number.format(requirements.tiers[tier])} $CUSTOM`);expect(within(card as HTMLElement).getByRole('link')).toHaveAttribute('href','/app');
 }
 expect(screen.getByText(copy.tierCards.validationNote)).toBeVisible();
});
it('updates from a later admin response and reports unavailable requirements instead of default amounts',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(requirements))).mockResolvedValueOnce(new Response(JSON.stringify({...requirements,tiers:{MEMBER:300000,PRO:900000,ELITE:9000000}}))).mockResolvedValueOnce(new Response('{}',{status:503}));
 const result=render(view(await fetchRequirements('http://localhost:4000',fetcher)));
 result.rerender(view(await fetchRequirements('http://localhost:4000',fetcher)));expect(result.container.querySelector('[data-tier="MEMBER"]')).toHaveTextContent('300,000 $CUSTOM');
  result.rerender(view(await fetchRequirements('http://localhost:4000',fetcher)));expect(screen.getAllByText(en.tierCards.unavailable)).toHaveLength(2);expect(result.container).not.toHaveTextContent('$CUSTOM');expect(screen.getByText(en.tierCards.earlyRequirement)).toBeVisible();
});

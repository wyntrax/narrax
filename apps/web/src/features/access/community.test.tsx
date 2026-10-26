import {describe,it,expect,vi} from 'vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import {CommunitySteps,COMMUNITY_LINKS,type CommunityStepKey} from './community';
import en from '../../../messages/en.json';
import id from '../../../messages/id.json';

const copy={en:en.access.community,id:id.access.community};
const messages={en,id};

function ui(locale:'en'|'id',completed:readonly CommunityStepKey[]=[],onStep?:(key:CommunityStepKey)=>void){
 return <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC"><CommunitySteps completed={completed} onStep={onStep}/></NextIntlClientProvider>;
}
function mount(locale:'en'|'id',completed:readonly CommunityStepKey[]=[],onStep?:(key:CommunityStepKey)=>void){return render(ui(locale,completed,onStep));}

describe('community steps',()=>{
 for(const locale of ['en','id'] as const)it(`${locale}: links to Telegram and X without requesting account access`,()=>{
  mount(locale);
  const c=copy[locale];
  const links=screen.getAllByRole('link');
  expect(links).toHaveLength(3);
  for(const link of links){
   expect(link).toHaveAttribute('target','_blank');
   expect(link).toHaveAttribute('rel','noopener noreferrer');
  }
  expect(screen.getByText(c.telegram.title).closest('a')).toHaveAttribute('href',COMMUNITY_LINKS.telegram);
  expect(screen.getByText(c.follow.title).closest('a')).toHaveAttribute('href',COMMUNITY_LINKS.x);
  expect(screen.getByText(c.pinned.title).closest('a')).toHaveAttribute('href',COMMUNITY_LINKS.x);
  expect(screen.getByRole('region',{name:c.title})).toBeInTheDocument();
  expect(screen.queryByText(/does not connect to or verify/i)).toBeNull();
 });

 for(const locale of ['en','id'] as const)it(`${locale}: counts each opened step and unlocks at 3 of 3`,()=>{
  const c=copy[locale],joinWord=locale==='en'?'of':'dari',onStep=vi.fn();
  const view=mount(locale,[],onStep);
  expect(screen.getByRole('status')).toHaveTextContent(`0 ${joinWord} 3`);
  expect(screen.getByText(c.hint)).toBeInTheDocument();
  fireEvent.click(screen.getByText(c.telegram.title).closest('a')!);
  expect(onStep).toHaveBeenCalledWith('telegram');

  view.rerender(ui(locale,['telegram'],onStep));
  expect(screen.getByRole('status')).toHaveTextContent(`1 ${joinWord} 3`);
  expect(screen.getAllByText(c.completed)).toHaveLength(1);

  view.rerender(ui(locale,['telegram','follow','pinned'],onStep));
  expect(screen.getByRole('status')).toHaveTextContent(`3 ${joinWord} 3`);
  expect(screen.getAllByText(c.completed)).toHaveLength(3);
  expect(screen.getByText(c.ready)).toBeInTheDocument();
  expect(screen.queryByText(c.hint)).toBeNull();
 });
});

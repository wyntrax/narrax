import { render as rtlRender, screen, fireEvent, cleanup } from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { DataTable } from './ui';
import {Link} from '@/i18n/navigation';
const push = vi.hoisted(() => vi.fn());
function render(node:ReactNode){return rtlRender(<NextIntlClientProvider locale="en" messages={{}}>{node}</NextIntlClientProvider>);}
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }), Link: ({href,children}:{href:string;children:ReactNode}) => <a href={href}>{children}</a> }));
afterEach(() => { cleanup(); push.mockClear(); });
it('opens a token from any non-interactive cell without hijacking external links', () => {
  render(<DataTable caption="Tokens" headers={['Token', 'Price', 'Source']} rowHref={key => `/app/tokens/${key}`} rows={[{ key: 'mint', cells: [<a key="token" href="#token">TOKEN</a>, '$10', <a key="source" href="https://dexscreener.com">DEX</a>] }]} />);
  fireEvent.click(screen.getByText('$10'));
  expect(push).toHaveBeenCalledWith('/app/tokens/mint');
  push.mockClear();
  screen.getByText('DEX').addEventListener('click', event => event.preventDefault());
  fireEvent.click(screen.getByText('DEX'));
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByText('$10').closest('tr')).toHaveClass('research-clickable-row');
});
it('infers a detail link in any column, including links inside wrapper components',()=>{
 function Name(){return <Link href="/en/app/smart-money/address">Wallet</Link>;}
 render(<DataTable caption="Wallets" headers={['Time','Wallet','Count']} rows={[{key:'w',cells:['Today',<span key="name"><Name/></span>,'12 trades']}]} />);
 fireEvent.click(screen.getByText('12 trades'));expect(push).toHaveBeenCalledWith('/app/smart-money/address');
 push.mockClear();fireEvent.keyDown(screen.getByText('Today').closest('tr')!,{key:'Enter'});expect(push).toHaveBeenCalledWith('/app/smart-money/address');
});
it('does not turn summary or external-only rows into internal navigation',()=>{
 render(<DataTable caption="Summary" headers={['Item','Value']} rows={[{key:'a',cells:['Total','20']},{key:'b',cells:[<a key="external" href="https://x.com/person">Creator</a>,'10']}]} />);
 fireEvent.click(screen.getByText('20'));fireEvent.click(screen.getByText('10'));expect(push).not.toHaveBeenCalled();
 expect(screen.getByText('20').closest('tr')).not.toHaveAttribute('tabindex');
});
it('keeps buttons and selected text intact',()=>{
 const clicked=vi.fn();render(<DataTable caption="Tokens" headers={['Token','Action']} rowHref={()=>'/app/tokens/mint'} rows={[{key:'a',cells:['TOKEN',<button key="action" onClick={clicked}>Review</button>]}]} />);
 fireEvent.click(screen.getByText('Review'));expect(clicked).toHaveBeenCalledOnce();expect(push).not.toHaveBeenCalled();
 const selection=vi.spyOn(window,'getSelection').mockReturnValue({toString:()=> 'TOKEN'} as Selection);
 fireEvent.click(screen.getByText('TOKEN'));expect(push).not.toHaveBeenCalled();selection.mockRestore();
});

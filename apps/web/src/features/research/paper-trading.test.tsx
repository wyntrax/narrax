import {render,screen,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import messages from '../../../messages/research/en.json';
import {ApiError} from '@/lib/api';
import {PaperTrading} from './paper-trading';
const mock=vi.hoisted(()=>({mode:'PAPER',quotes:true,permission:true,positions:[] as unknown[],send:vi.fn(),busy:vi.fn()}));
vi.mock('./session',()=>({useResearch:()=>({userId:'owner',send:mock.send}),useResearchQuery:(path:string)=>({isPending:false,isError:false,data:path==='positions'?{items:mock.positions}:{mode:mock.mode,balanceSol:10,feeSol:.002,quotesAvailable:mock.quotes,entryPermission:mock.permission,paused:false}})}));
const mint='So11111111111111111111111111111111111111112';
const ticket=()=>({previewId:'review-1',expiresAt:new Date(Date.now()+60000).toISOString(),side:'BUY',mint,symbol:'TEST',sizeSol:.1,requestedSizeSol:.1,fractionPct:0,estimatedProceedsSol:null,feeSol:.002,priceImpactPct:.2,slippageBps:100,simulated:true});
function view(positionId?:string){return render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><QueryClientProvider client={new QueryClient()}><PaperTrading positionId={positionId} onBusy={mock.busy}/></QueryClientProvider></NextIntlClientProvider>);}
async function review(){const u=userEvent.setup();await u.type(screen.getByLabelText('Token mint address'),mint);await u.click(screen.getByRole('button',{name:'Review paper order'}));await screen.findByRole('heading',{name:'Review simulated order'});return u;}
beforeEach(()=>{mock.mode='PAPER';mock.quotes=true;mock.permission=true;mock.positions=[];mock.send.mockReset();mock.busy.mockReset();mock.send.mockImplementation(async(path:string)=>path.endsWith('preview')?ticket():{orderId:'order-1',positionId:'position-1',side:'BUY',simulated:true,replayed:false});});
afterEach(cleanup);
it('requires review and explicit acknowledgement before a paper buy; refreshes account data after fill',async()=>{
 view();expect(screen.getByRole('button',{name:'Review paper order'})).toBeDisabled();const u=await review();
 expect(mock.send).toHaveBeenCalledWith('paper-trades/preview',expect.anything(),'POST',{side:'BUY',mint,sizeSol:.1});
 const confirm=screen.getByRole('button',{name:'Confirm paper order'});expect(confirm).toBeDisabled();
 await u.click(screen.getByRole('checkbox'));await u.click(confirm);await screen.findByRole('status');
 expect(mock.send).toHaveBeenCalledTimes(2);expect(mock.send).toHaveBeenLastCalledWith('paper-trades/confirm',expect.anything(),'POST',{previewId:'review-1',paperAcknowledged:true});expect(screen.getByRole('status')).toHaveTextContent('No wallet funds were used');
});
it('canceling a review sends no order and unlocks the form',async()=>{view();const u=await review();await u.click(screen.getByRole('button',{name:'Cancel review'}));expect(mock.send).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('Token mint address')).toBeEnabled();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();});
it.each(['AUTO','SHADOW','SEMI_AUTO'])('hides the order form in %s mode and explains how to reach PAPER',mode=>{mock.mode=mode;view();expect(screen.queryByRole('button',{name:'Review paper order'})).not.toBeInTheDocument();expect(screen.getByText(/must be in PAPER mode to place orders/)).toBeInTheDocument();expect(screen.getByLabelText('Account mode')).toHaveValue(mode);expect(mock.send).not.toHaveBeenCalled();});
it('switches only the caller’s own account to PAPER through an explicit mode choice',async()=>{
 mock.mode='SHADOW';mock.send.mockResolvedValue({mode:'PAPER'});
 view();const u=userEvent.setup();
 expect(screen.getByLabelText('Account mode')).toHaveValue('SHADOW');
 await u.selectOptions(screen.getByLabelText('Account mode'),'PAPER');
 await waitFor(()=>expect(mock.send).toHaveBeenCalledWith('mode',expect.anything(),'PUT',{mode:'PAPER'}));
 expect(screen.queryByRole('button',{name:'Review paper order'})).not.toBeInTheDocument();
});
it('disables buys without existing permission and offers an explicit own-account enable',async()=>{mock.permission=false;view();await userEvent.type(screen.getByLabelText('Token mint address'),mint);expect(screen.getByRole('button',{name:'Review paper order'})).toBeDisabled();expect(mock.send).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Enable paper buys'})).toBeInTheDocument();});
it('enables paper buys only through the explicit own-account control',async()=>{
 mock.permission=false;mock.send.mockResolvedValue({aiTradingEnabled:true});
 view();const u=userEvent.setup();
 expect(mock.send).not.toHaveBeenCalled();
 await u.click(screen.getByRole('button',{name:'Enable paper buys'}));
 await waitFor(()=>expect(mock.send).toHaveBeenCalledWith('ai-access',expect.anything(),'PUT',{enabled:true}));
});
it('lists only explicitly eligible simulated positions and sends the selected partial-close fraction',async()=>{
 mock.permission=false;mock.positions=[{id:'paper',simulated:true,paperCloseEligible:true,token:{symbol:'PAPER'}},{id:'real',simulated:false,paperCloseEligible:true,token:{symbol:'REAL'}},{id:'legacy',simulated:true,paperCloseEligible:false,token:{symbol:'LEGACY'}}];
 view('paper');const u=userEvent.setup();expect(screen.queryByRole('option',{name:/REAL/})).not.toBeInTheDocument();expect(screen.queryByRole('option',{name:/LEGACY/})).not.toBeInTheDocument();await u.selectOptions(screen.getByLabelText('Position fraction to close'),'25');await u.click(screen.getByRole('button',{name:'Review paper order'}));
 expect(mock.send).toHaveBeenCalledWith('paper-trades/preview',expect.anything(),'POST',{side:'SELL',positionId:'paper',fractionPct:25});
});
it('displays clamped approved sizes and blocks expired reviews',async()=>{mock.send.mockResolvedValue({...ticket(),sizeSol:.05,expiresAt:new Date(Date.now()-1000).toISOString()});view();const u=await review();expect(screen.getByText(/Risk limits reduced/)).toHaveTextContent('0.05 SOL');await u.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Confirm paper order'})).toBeDisabled();});
it('keeps the same ticket after an ambiguous submission, locks cancellation and retries idempotently',async()=>{
 mock.send.mockResolvedValueOnce(ticket()).mockRejectedValueOnce(new ApiError('TIMEOUT')).mockResolvedValueOnce({orderId:'order-1',positionId:'p',side:'BUY',simulated:true,replayed:true});
 view();const u=await review();await u.click(screen.getByRole('checkbox'));await u.click(screen.getByRole('button',{name:'Confirm paper order'}));await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Cancel review'})).toBeDisabled();expect(mock.busy).toHaveBeenLastCalledWith(true);
 await u.click(screen.getByRole('button',{name:'Retry same confirmation'}));await screen.findByRole('status');
 expect(mock.send.mock.calls[1]![3]).toEqual(mock.send.mock.calls[2]![3]);
});
it('blocks duplicate clicks while submission is pending',async()=>{let done!:(v:unknown)=>void;mock.send.mockResolvedValueOnce(ticket()).mockImplementationOnce(()=>new Promise(r=>{done=r;}));view();const u=await review();await u.click(screen.getByRole('checkbox'));await u.dblClick(screen.getByRole('button',{name:'Confirm paper order'}));expect(mock.send).toHaveBeenCalledTimes(2);done({orderId:'o',positionId:'p',side:'BUY',simulated:true,replayed:false});await waitFor(()=>expect(screen.getByRole('status')).toBeInTheDocument());});

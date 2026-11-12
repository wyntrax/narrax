import {describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {HeliusForm} from './helius-card';
import type {AdminApi} from './api';
import type {Helius} from './contracts';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';

const initial:Helius={
 rpcUrl:{configured:true,source:'environment'},
 rpcFallbackUrl:{configured:false,source:'default'},
 apiKey:{configured:false,source:'default'},
 holderRpcUrl:{configured:false,source:'default'},
 holderRpcFallbackUrl:{configured:false,source:'default'},
 webhookUrl:{value:'https://api.example.com/webhooks/helius',source:'environment'},
 webhookSecret:{configured:false,source:'default'},
 ready:{rpc:true,holder:true,webhook:false},
 invalid:[],
};

function setup(){
 const api={saveHelius:vi.fn<AdminApi['saveHelius']>().mockResolvedValue(initial),testHelius:vi.fn<AdminApi['testHelius']>().mockResolvedValue({primary:{ok:true,code:'OK',latencyMs:9}})} as unknown as AdminApi;
 render(<NextIntlClientProvider locale="en" messages={{workspace:en}}><QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}><HeliusForm api={api} initial={initial}/></QueryClientProvider></NextIntlClientProvider>);
 return {api};
}

describe('helius admin form',()=>{
 it('saves a replacement endpoint and never sends blank credentials',async()=>{
  const {api}=setup();
  const save=screen.getByRole('button',{name:en.helius.save});
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText(en.helius.rpcUrl),{target:{value:'https://ready.example/?api-key=ready'}});
  fireEvent.change(screen.getByLabelText(en.helius.reason),{target:{value:'Rotate exhausted key'}});
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(()=>expect(api.saveHelius).toHaveBeenCalledWith({'integrations.helius.rpc_url':'https://ready.example/?api-key=ready'},'Rotate exhausted key'));
  expect(api.testHelius).not.toHaveBeenCalled();
 });
 it('clears the webhook endpoint when the field is emptied',async()=>{
  const {api}=setup();
  fireEvent.change(screen.getByLabelText(en.helius.webhookUrl),{target:{value:''}});
  fireEvent.change(screen.getByLabelText(en.helius.reason),{target:{value:'Disable webhook sync'}});
  fireEvent.click(screen.getByRole('button',{name:en.helius.save}));
  await waitFor(()=>expect(api.saveHelius).toHaveBeenCalledWith({'integrations.helius.webhook_url':''},'Disable webhook sync'));
 });
 it('tests entered endpoints without saving and reports each result',async()=>{
  const {api}=setup();
  fireEvent.change(screen.getByLabelText(en.helius.rpcFallbackUrl),{target:{value:'https://fallback.example/?api-key=fallback'}});
  fireEvent.click(screen.getByRole('button',{name:en.helius.test}));
  await screen.findByText((_content,element)=>element?.tagName==='LI'&&element.textContent?.includes(en.helius.ok)===true);
  expect(api.testHelius).toHaveBeenCalledWith({rpcFallbackUrl:'https://fallback.example/?api-key=fallback'});
  expect(api.saveHelius).not.toHaveBeenCalled();
 });
 it('keeps secret inputs blank after saving',async()=>{
  const {api}=setup();
  fireEvent.change(screen.getByLabelText(en.helius.apiKey),{target:{value:'ready-api-key'}});
  fireEvent.change(screen.getByLabelText(en.helius.reason),{target:{value:'Rotate API key'}});
  fireEvent.click(screen.getByRole('button',{name:en.helius.save}));
  await waitFor(()=>expect(api.saveHelius).toHaveBeenCalledOnce());
  await waitFor(()=>expect((screen.getByLabelText(en.helius.apiKey) as HTMLInputElement).value).toBe(''));
 });
 it('has matching EN and ID Helius message keys',()=>{
  expect(Object.keys(en.helius).sort()).toEqual(Object.keys(id.helius).sort());
  expect(Object.keys(en.helius.endpoints).sort()).toEqual(Object.keys(id.helius.endpoints).sort());
  expect(Object.keys(en.helius.codes).sort()).toEqual(Object.keys(id.helius.codes).sort());
 });
});

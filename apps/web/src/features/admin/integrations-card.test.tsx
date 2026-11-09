import {describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {IntegrationsForm} from './integrations-card';
import type {AdminApi} from './api';
import type {Integrations} from './contracts';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';

const initial:Integrations={
 telegram:{enabled:{value:false,source:'environment'},chatId:{value:null,source:'default'},botToken:{configured:false,source:'default'},maxAgeMin:{value:15,source:'default'},maxPerRun:{value:10,source:'default'},sendDelayMs:{value:1200,source:'default'}},
 treg:{enabled:{value:false,source:'environment'},token:{configured:false,source:'default'},org:{value:null,source:'default'}},
 invalid:[],
};

function setup(){
 const api={saveIntegrations:vi.fn<AdminApi['saveIntegrations']>().mockResolvedValue(initial),testTelegram:vi.fn<AdminApi['testTelegram']>().mockResolvedValue({ok:true,messageId:'8'})} as unknown as AdminApi;
 render(<NextIntlClientProvider locale="en" messages={{workspace:en}}><QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}><IntegrationsForm api={api} initial={initial}/></QueryClientProvider></NextIntlClientProvider>);
 return {api};
}

describe('integrations admin form',()=>{
 it('requires a chat, a token and a reason before saving only the changed settings',async()=>{
  const {api}=setup();
  const save=screen.getByRole('button',{name:en.integrations.save});
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText(en.integrations.chatId),{target:{value:'-1001234567890'}});
  fireEvent.change(screen.getByLabelText(en.integrations.botToken),{target:{value:'123:bot-secret'}});
  fireEvent.change(screen.getByLabelText(en.integrations.reason),{target:{value:'Start alerts'}});
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(()=>expect(api.saveIntegrations).toHaveBeenCalledWith({'integrations.telegram.chat_id':'-1001234567890','integrations.telegram.bot_token':'123:bot-secret'},'Start alerts'));
  expect(api.testTelegram).not.toHaveBeenCalled();
 });
 it('sends a test message without saving and reports the result',async()=>{
  const {api}=setup();
  fireEvent.change(screen.getByLabelText(en.integrations.chatId),{target:{value:'-1009'}});
  fireEvent.change(screen.getByLabelText(en.integrations.botToken),{target:{value:'1:secret'}});
  fireEvent.click(screen.getByRole('button',{name:en.integrations.test}));
  await screen.findByText(en.integrations.tested);
  expect(api.testTelegram).toHaveBeenCalledWith('-1009','1:secret');
  expect(api.saveIntegrations).not.toHaveBeenCalled();
 });
 it('rejects a non-numeric, non-channel chat id and keeps secret inputs blank after saving',async()=>{
  const {api}=setup();
  fireEvent.change(screen.getByLabelText(en.integrations.chatId),{target:{value:'https://t.me/group'}});
  expect(screen.getByRole('button',{name:en.integrations.test})).toBeDisabled();
  expect(screen.getByRole('button',{name:en.integrations.save})).toBeDisabled();
  fireEvent.change(screen.getByLabelText(en.integrations.chatId),{target:{value:'@narra_alerts'}});
  fireEvent.change(screen.getByLabelText(en.integrations.botToken),{target:{value:'1:secret'}});
  fireEvent.change(screen.getByLabelText(en.integrations.reason),{target:{value:'Use public channel'}});
  fireEvent.click(screen.getByRole('button',{name:en.integrations.save}));
  await waitFor(()=>expect(api.saveIntegrations).toHaveBeenCalledOnce());
  await waitFor(()=>expect((screen.getByLabelText(en.integrations.botToken) as HTMLInputElement).value).toBe(''));
 });
 it('has matching EN and ID integration message keys',()=>{expect(Object.keys(en.integrations).sort()).toEqual(Object.keys(id.integrations).sort());});
});

import {generateKeyPairSync} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {RuntimeForm} from './runtime-card';
import {ApiError} from '@/lib/api';
import type {AdminApi} from './api';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';

function setup(){
 const pem=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'pem'}).toString().trim();
 const api={save:vi.fn<AdminApi['save']>().mockResolvedValue({ok:true}),checkPrivy:vi.fn<AdminApi['checkPrivy']>().mockResolvedValue({ok:true})} as unknown as AdminApi;
 const initial={privyAppId:{value:'app-one',source:'environment' as const},privyVerificationKey:{value:pem,source:'database' as const},corsOrigins:{value:['https://env.example'],source:'environment' as const,extra:[],environment:['https://env.example']}};
 const refresh=vi.fn(async()=>{});
 render(<NextIntlClientProvider locale="en" messages={{workspace:en}}><QueryClientProvider client={new QueryClient({defaultOptions:{mutations:{retry:false}}})}><RuntimeForm api={api} initial={initial} refresh={refresh}/></QueryClientProvider></NextIntlClientProvider>);
 return {api,refresh};
}
describe('runtime admin form',()=>{
 it('shows effective values and sources, checks without saving, and requires a reason',async()=>{
  const {api}=setup();expect(screen.getAllByText(/https:\/\/env.example/)).toHaveLength(2);expect(screen.getByText(/Effective value: app-one/)).toHaveTextContent('Environment');
  fireEvent.click(screen.getByRole('button',{name:en.runtime.check}));await screen.findByText(en.runtime.checked);expect(api.checkPrivy).toHaveBeenCalledOnce();expect(api.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(en.runtime.appId),{target:{value:'app-two'}});expect(screen.getByRole('button',{name:en.runtime.save})).toBeDisabled();
  fireEvent.change(screen.getByLabelText(en.runtime.reason),{target:{value:'Rotate application'}});expect(screen.getByRole('button',{name:en.runtime.save})).toBeEnabled();
 });
 it('rejects invalid origins and sends only changed settings with an explicit override',async()=>{
  const {api,refresh}=setup();fireEvent.change(screen.getByLabelText(en.runtime.origins),{target:{value:'https://*.example'}});fireEvent.change(screen.getByLabelText(en.runtime.reason),{target:{value:'Add browser origin'}});
  expect(screen.getByRole('button',{name:en.runtime.save})).toBeDisabled();
  fireEvent.change(screen.getByLabelText(en.runtime.origins),{target:{value:'https://extra.example'}});fireEvent.click(screen.getByRole('button',{name:en.runtime.save}));
  await waitFor(()=>expect(api.save).toHaveBeenCalledWith({'api.cors_origins':['https://extra.example']},'Add browser origin',false));expect(refresh).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText(en.runtime.appId),{target:{value:'app-two'}});fireEvent.click(screen.getByLabelText(en.runtime.override));fireEvent.click(screen.getByRole('button',{name:en.runtime.save}));
  await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(2));expect(vi.mocked(api.save).mock.calls[1]?.[2]).toBe(true);
 });
 it('shows actionable mismatch errors and never treats a failed save as success',async()=>{
  const {api}=setup();vi.mocked(api.save).mockRejectedValue(new ApiError('PRIVY_KEY_MISMATCH',400));
  fireEvent.change(screen.getByLabelText(en.runtime.appId),{target:{value:'app-two'}});fireEvent.change(screen.getByLabelText(en.runtime.reason),{target:{value:'Rotate'}});fireEvent.click(screen.getByRole('button',{name:en.runtime.save}));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.runtime.mismatch);expect(screen.queryByText(en.runtime.saved)).toBeNull();
 });
 it('has matching EN and ID runtime message keys',()=>{expect(Object.keys(en.runtime).sort()).toEqual(Object.keys(id.runtime).sort());});
});

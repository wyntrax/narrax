import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import messages from '../../../messages/research/en.json';
import {FEATURE_TIERS} from '@narra/shared';
import {FeaturesCard} from './features-card';
import type {AdminApi} from './api';
afterEach(cleanup);
function view(value?:unknown){
 const save=vi.fn().mockResolvedValue({ok:true});
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><QueryClientProvider client={new QueryClient()}><FeaturesCard api={{save} as unknown as AdminApi} items={value===undefined?[]:[{key:'entitlements.features',value}]}/></QueryClientProvider></NextIntlClientProvider>);
 return save;
}
it('offers all features with Early, Member and Pro, without Elite',()=>{
 view();
 expect(screen.getAllByRole('combobox')).toHaveLength(Object.keys(FEATURE_TIERS).length);
  expect(screen.getByLabelText('Agent')).toHaveValue('EARLY_ACCESS');
  expect(screen.getByLabelText('Personal Radar')).toHaveValue('PRO');
 expect(screen.queryByRole('option',{name:'Elite'})).toBeNull();
 expect(screen.getByRole('button',{name:messages.featureAccess.save})).toBeDisabled();
});
it('saves the full feature map with a reason, preserving existing age restrictions',async()=>{
 const save=view({'research.chat':{requiredTier:'ELITE',min_entitlement_age_hours:24}});
 fireEvent.change(screen.getByLabelText('Agent'),{target:{value:'MEMBER'}});
 fireEvent.change(screen.getByLabelText(messages.adminReason),{target:{value:'Member agent access'}});
 fireEvent.click(screen.getByRole('button',{name:messages.featureAccess.save}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls[0]?.[0]['entitlements.features']['research.chat']).toEqual({requiredTier:'MEMBER',min_entitlement_age_hours:24});
 expect(Object.keys(save.mock.calls[0]?.[0]['entitlements.features'])).toHaveLength(Object.keys(FEATURE_TIERS).length);
 expect(save.mock.calls[0]?.[1]).toBe('Member agent access');
 expect(await screen.findByText(messages.adminSaved)).toBeVisible();
});
it('refuses to overwrite malformed stored settings',()=>{
 const save=view({'research.chat':{min_entitlement_age_hours:-1}});
 expect(screen.getByRole('alert')).toHaveTextContent(messages.featureAccess.invalid);
 expect(screen.queryByRole('button')).toBeNull();expect(save).not.toHaveBeenCalled();
});

import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import messages from '../../../messages/research/en.json';
import {FEATURE_TIERS} from '@narra/shared';
import {FeaturesCard} from './features-card';
import type {AdminApi} from './api';
import {ApiError} from '@/lib/api';
afterEach(cleanup);
function view(value?:unknown,failure?:ApiError){
 const save=vi.fn().mockResolvedValue({ok:true});
 if(failure)save.mockRejectedValue(failure);
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><QueryClientProvider client={new QueryClient()}><FeaturesCard api={{save} as unknown as AdminApi} items={value===undefined?[]:[{key:'entitlements.features',value}]}/></QueryClientProvider></NextIntlClientProvider>);
 return save;
}
it('offers all features with Early, Member and Pro, without Elite',()=>{
 view();
 expect(screen.getAllByRole('combobox')).toHaveLength(Object.keys(FEATURE_TIERS).length);
  expect(screen.getByLabelText('Agent')).toHaveValue('EARLY_ACCESS');
   expect(screen.getByLabelText('Personal Radar')).toHaveValue('PRO');
    expect(screen.getByLabelText('Smart Money Investigation')).toHaveValue('PRO');
    expect(screen.getByLabelText('Smart Money Rankings')).toHaveValue('PRO');
 expect(screen.queryByRole('option',{name:'Elite'})).toBeNull();
 expect(screen.getByRole('button',{name:messages.featureAccess.save})).toBeDisabled();
});
it('saves the full feature map with a reason, preserving existing age restrictions',async()=>{
  const save=view({'research.chat':{requiredTier:'ELITE',min_entitlement_age_hours:24},'research.smart_money_investigation':{requiredTier:'PRO'}});
  expect(screen.getByLabelText('Smart Money Investigation')).toHaveValue('PRO');
  fireEvent.change(screen.getByLabelText('Agent'),{target:{value:'MEMBER'}});
  fireEvent.change(screen.getByLabelText('Smart Money Investigation'),{target:{value:'EARLY_ACCESS'}});
 fireEvent.change(screen.getByLabelText(messages.adminReason),{target:{value:'Member agent access'}});
 fireEvent.click(screen.getByRole('button',{name:messages.featureAccess.save}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0]['entitlements.features']['research.chat']).toEqual({requiredTier:'MEMBER',min_entitlement_age_hours:24});
  expect(save.mock.calls[0]?.[0]['entitlements.features']['research.smart_money_investigation']).toEqual({requiredTier:'EARLY_ACCESS'});
 expect(Object.keys(save.mock.calls[0]?.[0]['entitlements.features'])).toHaveLength(Object.keys(FEATURE_TIERS).length);
 expect(save.mock.calls[0]?.[1]).toBe('Member agent access');
 expect(await screen.findByText(messages.adminSaved)).toBeVisible();
});
it('refuses to overwrite malformed stored settings',()=>{
 const save=view({'research.chat':{min_entitlement_age_hours:-1}});
 expect(screen.getByRole('alert')).toHaveTextContent(messages.featureAccess.invalid);
 expect(screen.queryByRole('button')).toBeNull();expect(save).not.toHaveBeenCalled();
});
it.each([
 [new ApiError('UNKNOWN',403),messages.adminErrForbidden],
 [new ApiError('UNAUTHORIZED',401),messages.adminErrSession],
 [new ApiError('INVALID_INPUT',400),messages.adminErrInvalid],
 [new ApiError('RATE_LIMITED',429),messages.adminErrRate],
] as const)('explains a failed feature save (%s)',async(error,message)=>{
 view(undefined,error);
 fireEvent.change(screen.getByLabelText(messages.adminReason),{target:{value:'Feature access update'}});
 fireEvent.click(screen.getByRole('button',{name:messages.featureAccess.save}));
 expect(await screen.findByRole('alert')).toHaveTextContent(message);
 expect(screen.queryByText(messages.adminSaved)).toBeNull();
});

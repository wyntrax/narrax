import {render,screen,cleanup,fireEvent,within,act} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,it,expect,vi} from 'vitest';
import {RadarSafetyViewSchema} from '@narra/shared';
import {SafetyEvidence} from './safety-evidence';
import {safetyFixture} from '@/test/safety-fixture';
import messages from '../../../messages/research/en.json';
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
afterEach(()=>{cleanup();vi.useRealTimers();});
function view(value?:ReturnType<typeof safetyFixture>){return render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><SafetyEvidence value={value}/></NextIntlClientProvider>);}
it('keeps missing and invalid snapshots explicit instead of inferring a verdict',()=>{
 const unavailable=view();expect(screen.getByText('Radar safety information unavailable')).toBeVisible();expect(screen.queryByText('No Early Radar call for this token')).toBeNull();unavailable.unmount();
 const {unmount}=view({state:'NOT_RECORDED',snapshot:null,alertId:null,alertAt:null,evidenceStale:null});expect(screen.getByText('No Early Radar call for this token')).toBeVisible();expect(screen.getByText('No public Early Radar alert is recorded for this token.')).toBeVisible();expect(screen.queryByText(/PASS —/)).toBeNull();unmount();
 const noSnapshot=view({state:'NOT_RECORDED',snapshot:null,alertId:'old-alert',alertAt:'2026-10-17T10:00:00.000Z',evidenceStale:null});
 expect(screen.getByText('Its latest radar call has no safety snapshot')).toBeVisible();expect(screen.getByText(/never backfilled/)).toBeVisible();expect(screen.getByText(/Latest radar call/)).toBeVisible();
 expect(screen.queryByText('No Early Radar call for this token')).toBeNull();noSnapshot.unmount();
 view({state:'INVALID',snapshot:null,alertId:'invalid',alertAt:null,evidenceStale:null});expect(screen.getByText(/invalid or mismatched evidence/)).toBeVisible();expect(screen.getByText(/failed validation/)).toBeVisible();
});
it('renders frozen blockers, unknowns, mode and timestamps with zero and false preserved',()=>{
 const fixture=RadarSafetyViewSchema.parse(safetyFixture());view(fixture);
 expect(screen.getByText('BLOCK — recorded blockers')).toBeVisible();expect(screen.getByText('Shadow mode: recorded, not enforced.')).toBeVisible();
 expect(screen.getByText(/Evidence is now stale/)).toBeVisible();
 expect(screen.getByText(/Separate from the opportunity record/)).toBeVisible();
 fireEvent.click(screen.getByText('Inspect frozen checks',{selector:'summary'}));
 const table=screen.getByRole('table');expect(within(table).getByText('0')).toBeVisible();expect(within(table).getByText('false')).toBeVisible();
 expect(screen.getByText('fixture-alert')).toBeVisible();
});
it('does not promote a historical PASS to current safety or approval',()=>{
 const fixture=safetyFixture(),s=fixture.snapshot!;s.status='PASS';s.wouldBlock=false;s.blockers=[];s.unknowns=[];s.checks=s.checks.filter(c=>c.status==='PASS'||c.status==='WARN');
 view(RadarSafetyViewSchema.parse(fixture));expect(screen.getByText('PASS — recorded checks passed')).toBeVisible();
 expect(screen.getByText(/not a safety guarantee or dump prediction/)).toBeVisible();expect(screen.getByText(/Evidence is now stale/)).toBeVisible();
});

it('ages a cached frozen record on screen without changing its verdict or facts',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T12:09:59Z'));
 const fixture=safetyFixture();fixture.evidenceStale=false;
 const frozen=JSON.stringify(fixture.snapshot);view(fixture);
 expect(screen.queryByText(/Evidence is now stale/)).toBeNull();
 act(()=>vi.advanceTimersByTime(15000));
 expect(screen.getByText(/Evidence is now stale/)).toBeVisible();
 expect(screen.getByText('BLOCK — recorded blockers')).toBeVisible();
 expect(JSON.stringify(fixture.snapshot)).toBe(frozen);
});

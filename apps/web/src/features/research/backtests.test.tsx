import {render,screen,waitFor,cleanup,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import {AuthContext,type AuthAdapter} from '@/components/auth/context';
import {empty} from '@/test/fixtures';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';
import site from '../../../messages/en.json';
import {ResearchWorkspace} from './session';
import {BacktestsPage} from './backtests';
import {BacktestSummarySchema,BacktestDetailSchema} from './backtest-contracts';
vi.mock('./shell',()=>({ResearchShell:({children}:{children:ReactNode})=>children}));
vi.mock('@/i18n/navigation',()=>({Link:({children,href}:{children:ReactNode;href:string})=><a href={href}>{children}</a>,useRouter:()=>({push:vi.fn()}),usePathname:()=>'/app/backtests'}));
const auth:AuthAdapter={ready:true,authenticated:true,userId:'A',getAccessToken:async()=>'A',login:vi.fn(),logout:async()=>{},connectWallet:vi.fn(),createWallet:async()=>{},wallets:[]};
const at='2026-10-18T12:00:00Z';
const coverage={from:at,to:at,tokens:2,metricPoints:8,firstPointAt:at,lastPointAt:at,medianGapMinutes:null,decisions:4,buyDecisions:2};
const summary={available:true,id:'run/1',createdAt:at,generatedAt:at,coverage,findings:[],noConclusion:['INSUFFICIENT DATA: 2 tokens'],caveats:['Stored readings are not actual fills.']};
const described={n:2,distinctTokens:2,mean:0,median:null,p10:null,p90:null,meanCi:null,winRate:0,winRateCi:null,sufficient:false,note:'Need more independent samples'};
const detail={id:'run/1',kind:'FULL',createdAt:at,report:{generatedAt:at,coverage,costPct:3,strategies:[{name:'AI BUY',events:4,pending:1,unknown:1,unknownRate:.5,hold:described,withRules:described,withOwnExit:null,holdMeanIfUnknownTotalLoss:-51.5,medianLeadTimeSeconds:null}],comparisons:[{name:'AI BUY',vsBaselineHold:{diff:null,ci:null,verdict:'INSUFFICIENT_DATA',note:'Too few tokens'},vsBaselineRules:{diff:0,ci:[-3,3],verdict:'NO_CLEAR_DIFFERENCE',note:null}}],findings:[],noConclusion:['INSUFFICIENT DATA: 2 tokens']},gates:{minSample:30,minDistinctTokens:15}};
function Tree({locale='en'}:{locale?:'en'|'id'}){return <NextIntlClientProvider locale={locale} messages={{workspace:locale==='en'?en:id,common:site.common}}><AuthContext.Provider value={auth}><ResearchWorkspace theme="dark"><BacktestsPage/></ResearchWorkspace></AuthContext.Provider></NextIntlClientProvider>;}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
function transport({admin=false,summaryBody=summary as unknown,report=detail as unknown,listStatus=200}={}){
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 const requests:{path:string;method:string}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:URL,init:RequestInit)=>{
  requests.push({path:input.pathname+input.search,method:init.method??'GET'});
  if(input.pathname.endsWith('entitlements'))return json(empty);
  if(input.pathname.endsWith('/me'))return json({isAdmin:admin});
  if(input.pathname.endsWith('backtest-summary'))return json(summaryBody);
  if(input.pathname.endsWith('/backtests'))return listStatus===200?json({items:[{id:'run/1',kind:'FULL',createdAt:at,coverage,findings:0,noConclusion:1}]}):json({error:'FORBIDDEN'},listStatus);
  return json(report);
 }));
 return requests;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('shows saved coverage and no-conclusion warnings without requesting admin data',async()=>{
 const requests=transport();render(<Tree/>);
 expect(await screen.findByText('INSUFFICIENT DATA: 2 tokens')).toBeVisible();
 expect(screen.getByText(en.backtests.noFindings)).toBeVisible();
 expect(screen.getByText(en.backtests.adminOnly)).toBeVisible();
 expect(screen.getByText('Tracked tokens').nextElementSibling).toHaveTextContent('2');
 expect(requests.some(r=>r.path.includes('/backtests'))).toBe(false);
 expect(requests.every(r=>r.method==='GET')).toBe(true);
});
it('shows honest empty state in Indonesian, with no fabricated returns',async()=>{
 transport({summaryBody:{available:false}});render(<Tree locale="id"/>);
 expect(await screen.findByText(id.backtests.empty)).toBeVisible();
 expect(screen.queryByText(id.backtests.mean)).toBeNull();
 expect(screen.getByRole('heading',{name:'Backtest'})).toBeVisible();
});
it('does not substitute zero for missing coverage or claim a profitable finding',async()=>{
 transport({summaryBody:{...summary,coverage:null,noConclusion:[]}});render(<Tree/>);
 expect(await screen.findByText(en.backtests.coverageMissing)).toBeVisible();
 expect(screen.getByText(en.backtests.noFindings)).toBeVisible();
 expect(screen.getByText(en.backtests.noWarnings)).toBeVisible();
});
it('warns explicitly when the saved run contains no observed history',async()=>{
 transport({summaryBody:{...summary,coverage:{...coverage,tokens:0,metricPoints:0,firstPointAt:null,lastPointAt:null}}});render(<Tree/>);
 expect(await screen.findByText(en.backtests.noHistory)).toBeVisible();
});
it('loads selected admin report with thin samples, real zeros, missing returns and baseline verdicts',async()=>{
 const requests=transport({admin:true});render(<Tree/>);const user=userEvent.setup();
 const select=await screen.findByRole('combobox',{name:'Saved report'});
 expect(requests.some(r=>r.path.includes('backtests/run'))).toBe(false);
 await user.selectOptions(select,'run/1');
 const table=await screen.findByRole('table',{name:en.backtests.hold});
 expect(within(table).getAllByText('0%')).toHaveLength(2); // Real zero mean and zero win rate, not unknown.
 expect(within(table).getByText(/Insufficient evidence/)).toBeVisible();
 expect(within(table).getAllByText('Unknown').length).toBeGreaterThan(0);
 expect(await screen.findByText('No clear difference')).toBeVisible();
 expect(screen.getByText('-51.5%')).toBeVisible();
 expect(screen.getByText('3%')).toBeVisible();
 expect(requests.some(r=>r.path.endsWith('/backtests/run%2F1'))).toBe(true);
 expect(requests.every(r=>r.method==='GET')).toBe(true);
});
it('rejects malformed API data and allows retry instead of displaying unvalidated metrics',async()=>{
 const requests=transport({summaryBody:{...summary,coverage:{...coverage,tokens:'2'}}});render(<Tree/>);
 expect(await screen.findByRole('alert')).toHaveTextContent(en.requestErrors.invalidResponse);
 await userEvent.setup().click(screen.getByRole('button',{name:en.retry}));
 await waitFor(()=>expect(requests.filter(r=>r.path.endsWith('backtest-summary'))).toHaveLength(2));
 expect(screen.queryByText('Tracked tokens')).toBeNull();
});
it('renders report text as text, never markup',async()=>{
 const text='<img src=x onerror="alert(1)">';transport({summaryBody:{...summary,findings:[text]}});render(<Tree/>);
 expect(await screen.findByText(text)).toBeVisible();expect(document.querySelector('img')).toBeNull();
});
it('handles denied admin history without manufacturing a saved report',async()=>{
 transport({admin:true,listStatus:403});render(<Tree/>);
 expect(await screen.findByRole('alert')).toBeVisible();
 expect(screen.queryByRole('combobox')).toBeNull();
});
it('validates summary/detail boundaries and strips unrendered working data',()=>{
 expect(BacktestSummarySchema.parse({available:false})).toEqual({available:false});
 expect(BacktestDetailSchema.parse(detail).report.strategies[0]?.hold.mean).toBe(0);
 expect(BacktestDetailSchema.safeParse({...detail,report:{...detail.report,costPct:Infinity}}).success).toBe(false);
 expect(BacktestSummarySchema.safeParse({...summary,coverage:{...coverage,metricPoints:-1}}).success).toBe(false);
 expect(BacktestDetailSchema.parse({...detail,params:{secret:'hidden'},report:{...detail.report,strategies:[{...detail.report.strategies[0],holdItems:[{secret:'hidden'}]}]}})).not.toHaveProperty('params');
});

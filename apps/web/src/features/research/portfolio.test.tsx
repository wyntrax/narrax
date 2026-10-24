import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {MyBalancesSchema,MyWalletsSchema,PerformanceSchema,PositionsSchema,TradesSchema,EquitySchema} from './contracts';
import {PortfolioPage,EquityChart} from './portfolio';
import {saveTextFile} from './download';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';

const fixture=vi.hoisted(()=>({positions:[] as unknown[],trades:[] as unknown[],nextCursor:null as string|null,performance:null as unknown,equity:null as unknown,wallets:[] as unknown[],balances:null as unknown,downloadError:false,paths:[] as string[],download:vi.fn<(path:string)=>Promise<string>>()}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({
 useResearch:()=>({download:fixture.download}),
 useResearchQuery:(path:string)=>{
  fixture.paths.push(path);
  const result={isPending:false,isError:false,isFetching:false,refetch:vi.fn()};
   if(path==='positions')return {...result,data:{items:fixture.positions}};
   if(path==='paper-trades/account')return {...result,data:{mode:'PAPER',balanceSol:10,feeSol:.002,quotesAvailable:false,entryPermission:false,paused:false}};
  if(path.startsWith('trades'))return {...result,data:{items:fixture.trades,nextCursor:fixture.nextCursor}};
  if(path.startsWith('analytics/me/performance'))return {...result,data:fixture.performance};
  if(path.startsWith('analytics/me/equity'))return {...result,data:fixture.equity};
  if(path==='me/wallets')return {...result,data:{items:fixture.wallets}};
  return {...result,data:fixture.balances};
 },
}));
vi.mock('./download',()=>({saveTextFile:vi.fn()}));
const saveFile=vi.mocked(saveTextFile);

const at='2026-10-19T09:00:00.000Z';
const solana='So11111111111111111111111111111111111111112';
const position=(over:Record<string,unknown>={})=>({id:'p1',mode:'PAPER',openedAt:at,sizeSol:0.9,entryPriceUsd:1.5,currentPriceUsd:1.8,pnlPct:20,entryContext:{narrative:70},token:{mint:'mint',symbol:'ROBOT'},evaluation:{action:'REDUCE',fractionPct:50,signals:[{code:'LIQUIDITY_DROP',level:'WARN',detail:'Liquidity fell 40% in an hour.'}],unavailable:['DEV_ACTIVITY: developer wallet data is not collected'],blind:false,pnlPct:20,at},...over});
const trade=(over:Record<string,unknown>={})=>({id:'t1',executedAt:at,side:'BUY',mode:'PAPER',reason:'AGENT_BUY',sizeSol:1,expectedPriceUsd:1.5,actualPriceUsd:1.51,slippageBps:12.5,signature:'9'.repeat(80),token:{mint:'mint',symbol:'ROBOT'},...over});
const closed=(over:Record<string,unknown>={})=>({count:4,wins:3,winRate:0.75,winRateCi:[0.3,0.95],meanPnlSol:0.1,sufficient:false,note:'Small sample.',...over});
const results=(over:Record<string,unknown>={})=>({trades:12,realizedPnlSol:0.42,feesSol:0.11,daily:[{day:'2026-10-18',pnlSol:0.3},{day:'2026-10-19',pnlSol:0.12}],closedPositions:closed(),...over});
const performance={range:{from:at,to:at,days:30},truncated:false,paper:results(),real:results({trades:0,realizedPnlSol:0,daily:[],closedPositions:closed({count:0,wins:0,winRate:null,winRateCi:null,meanPnlSol:null,note:null})}),caveats:['Realized profit and loss includes fees.']};
const equity={simulated:true,range:{from:at,to:at,days:30},points:[{at:'2026-10-18T09:00:00.000Z',valueSol:1},{at,valueSol:1.2}],peakSol:1.2,latestSol:1.2,drawdownPct:0,downsampled:false};
const wallet={id:'w1',address:solana,kind:'TRADING',createdAt:at};
const balances={at,items:[{address:solana,kind:'TRADING',balanceSol:null,status:'UNKNOWN'}],available:false};

beforeEach(()=>{
 fixture.positions=[position()];fixture.trades=[trade()];fixture.nextCursor=null;fixture.performance=performance;fixture.equity=equity;fixture.wallets=[wallet];fixture.balances=balances;fixture.downloadError=false;fixture.paths=[];
 saveFile.mockReset();
 fixture.download.mockReset();
 fixture.download.mockImplementation(async()=>{if(fixture.downloadError)throw new Error('export unavailable');return 'tradeId,side\r\nt1,BUY\r\n';});
});
afterEach(cleanup);

function view(node:ReactNode){return render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider></NextIntlClientProvider>);}

it('accepts the API payloads the page renders at its own boundary',()=>{
 expect(PositionsSchema.parse({items:[position()]}).items[0]?.evaluation?.action).toBe('REDUCE');
 expect(TradesSchema.parse({items:[trade()],nextCursor:null}).items[0]?.side).toBe('BUY');
 expect(PerformanceSchema.parse(performance).paper.trades).toBe(12);
 expect(EquitySchema.parse(equity).points).toHaveLength(2);
 expect(MyWalletsSchema.parse({items:[wallet]}).items[0]?.kind).toBe('TRADING');
 expect(MyBalancesSchema.parse(balances).available).toBe(false);
});

it('shows the monitor reading with its signals and says a reading is not an order',()=>{
 view(<PortfolioPage/>);
 expect(screen.getByRole('heading',{name:messages.pf.positions})).toBeVisible();
 expect(screen.getByText(/Reduce.*50% of the position/)).toBeVisible();
 expect(screen.getByText('1 signal')).toBeVisible();
 expect(screen.getByText('1 check could not run')).toBeVisible();
 expect(screen.getByText('LIQUIDITY_DROP')).toBeInTheDocument();
 expect(screen.getByText(/developer wallet data is not collected/)).toBeInTheDocument();
 expect(screen.getByText(messages.pf.monitorNote)).toBeVisible();
});

it('keeps a position without a reading unknown instead of guessing an action',()=>{
 fixture.positions=[position({id:'p2',evaluation:null})];
 view(<PortfolioPage/>);
 expect(screen.getByText(messages.pf.monitorNone)).toBeVisible();
 expect(screen.getByText(messages.pf.monitorPending)).toBeVisible();
 expect(screen.queryByText(/Reduce/)).toBeNull();
});

it('downloads the audited export, confirms it, and saves nothing when it fails',async()=>{
 const user=userEvent.setup();view(<PortfolioPage/>);
 await user.click(screen.getByRole('button',{name:messages.pf.exportCsv}));
 expect(fixture.download).toHaveBeenCalledWith('trades/export?format=csv');
 expect(saveFile).toHaveBeenCalledWith('narrax-trades.csv','tradeId,side\r\nt1,BUY\r\n','text/csv;charset=utf-8');
 expect(await screen.findByText(messages.pf.exported.replace('{format}','CSV'))).toBeVisible();
 saveFile.mockClear();fixture.downloadError=true;
 await user.click(screen.getByRole('button',{name:messages.pf.exportJson}));
 expect(await screen.findByText(messages.pf.exportFailed)).toBeVisible();
 expect(saveFile).not.toHaveBeenCalled();expect(fixture.download).toHaveBeenCalledWith('trades/export?format=json');
});

it('links a plausible transaction signature and leaves an implausible one as plain text',()=>{
 view(<PortfolioPage/>);
 expect(screen.getByRole('link',{name:/999999…999999/})).toHaveAttribute('href',`https://solscan.io/tx/${'9'.repeat(80)}`);
 cleanup();
 fixture.trades=[trade({id:'t2',signature:'sig'})];
 view(<PortfolioPage/>);
 expect(screen.queryByRole('link',{name:/sig/})).toBeNull();
 expect(screen.getAllByText('sig').length).toBeGreaterThan(0);
});

it('names the account it shows, keeps paper numbers apart and labels a thin sample',()=>{
 view(<PortfolioPage/>);
 expect(screen.getByText(messages.pf.sampleThin)).toBeVisible();
 expect(screen.getByText('0.42 SOL')).toBeVisible();
 expect(screen.getByText('75%')).toBeVisible();
 expect(screen.getByText(messages.pf.winRateCi.replace('{low}','30%').replace('{high}','95%'))).toBeVisible();
 expect(screen.getByText('Realized profit and loss includes fees.')).toBeVisible();
});

it('describes stored readings on the equity chart and calls a single reading a point',()=>{
 view(<PortfolioPage/>);
 expect(screen.getByRole('img',{name:'Portfolio value in SOL across 2 stored readings, peak 1.2 and latest 1.2.'})).toBeVisible();
 cleanup();
 view(<EquityChart equity={{...equity,points:[equity.points[0]!],peakSol:1,latestSol:1,drawdownPct:null}}/>);
 expect(screen.getByText(messages.pf.equitySingle)).toBeVisible();
});

it('keeps an unknown balance unknown and says balance reads are not configured',()=>{
 view(<PortfolioPage/>);
 expect(screen.getByText(messages.pf.balanceUnknown)).toBeVisible();
 expect(screen.getByText(messages.pf.balancesUnavailable)).toBeVisible();
 expect(screen.getByText(messages.pf.walletNote)).toBeVisible();
});

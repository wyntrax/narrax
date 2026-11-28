'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Compass,
  FileText,
  Flame,
  Layers,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import {
  InvestigationDiscoveryRequest,
  InvestigationLeadsResponse,
  InvestigationResponse,
  isSolanaAddress,
  type InvestigationForensicsData,
  type SmartMoneyInvestigation,
  type SmartMoneyInvestigationTotals,
} from '@narra/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { Dialog } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { hasFeature, useResearch } from '../research/session';
import { Empty, Facts, Loading, Locked, Metrics, PageHeading, Pager, ResourceError, Section, useFormat } from '../research/ui';
import { investigationCopy, type InvestigationCopy } from './copy';
import './styles.css';
import { StrategyEvidence, PublicationContext } from './strategy';

type Data = SmartMoneyInvestigation;
type Group = Data['groups'][number];
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const useCopy = () => investigationCopy[useLocale() === 'id' ? 'id' : 'en'];
// Preserve decimal precision instead of rounding through Number.
const amount = (value: string | null, c: InvestigationCopy) => <span className="investigation-amount">{value ?? c.unknown}</span>;
const fmtDuration = (sec: number) => sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`;

export function InvestigationPage({ mint = '' }: { mint?: string }) {
  const { access } = useResearch();
  if (!hasFeature(access, 'research.smart_money_investigation')) return <Locked tier={access.features['research.smart_money_investigation']?.requiredTier ?? 'PRO'} />;
  return <InvestigationDesk key={mint} mint={mint} />;
}

function InvestigationSuiteBar() {
  const c = useCopy();
  return (
    <div className="investigation-suite-bar">
      <span className="investigation-eyebrow"><Sparkles size={13} aria-hidden="true" />{c.eyebrow}</span>
      <nav className="investigation-suite-nav" aria-label={c.eyebrow}>
        <Link href="/app/investigation" className="investigation-suite-link" data-active="true">
          <Search size={14} aria-hidden="true" /><span>{c.suiteInvestigation}</span>
        </Link>
        <Link href="/app/personal-radar" className="investigation-suite-link">
          <Radar size={14} aria-hidden="true" /><span>{c.suiteRadar}</span>
        </Link>
        <Link href="/app/theses" className="investigation-suite-link">
          <Target size={14} aria-hidden="true" /><span>{c.suiteThesis}</span>
        </Link>
        <Link href="/app/briefing" className="investigation-suite-link">
          <FileText size={14} aria-hidden="true" /><span>{c.suiteBriefing}</span>
        </Link>
      </nav>
    </div>
  );
}

function ActiveLeadsLauncher({ onSelect }: { onSelect: (mint: string) => void }) {
  const { read, userId } = useResearch(), c = useCopy(), f = useFormat();
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey: ['research', userId, 'smart-money/investigations'],
    queryFn: ({ signal }) => read('smart-money/investigations', InvestigationLeadsResponse, signal),
    enabled: requested,
    retry: false,
    staleTime: 30_000,
  });
  return (
    <Section
      title={c.leadsTitle}
      action={
        !requested && (
          <button type="button" className="button button-primary investigation-icon-btn" onClick={() => setRequested(true)}>
            <Flame size={14} aria-hidden="true" />
            <span>{c.loadLeads}</span>
          </button>
        )
      }
    >
      <p className="investigation-lead-copy">{c.leadsBody}</p>
      {requested && query.isPending && <Loading />}
      {requested && query.isError && <ResourceError error={query.error} retry={() => void query.refetch()} />}
      {requested && query.data && (
        !query.data.items.length ? <p className="research-note">{c.noLeads}</p> : (
          <div className="investigation-groups">
            {query.data.items.map(lead => {
              const netNum = Number(lead.netSol24h);
              return (
                <article key={lead.mint} className="investigation-group investigation-lead-card">
                  <div className="investigation-group-head">
                    <h3>{lead.symbol === 'UNKNOWN' ? short(lead.mint) : lead.symbol} · {lead.name}</h3>
                    <span className="investigation-badge" data-posture={Number.isFinite(netNum) && netNum > 0 ? 'ACCUMULATING' : Number.isFinite(netNum) && netNum < 0 ? 'DISTRIBUTING' : undefined}>
                      {lead.netSol24h} SOL
                    </span>
                  </div>
                  <code className="investigation-address">{lead.mint}</code>
                  <Facts items={[
                    { label: c.net, value: <span className="investigation-amount">{lead.netSol24h} SOL</span> },
                    { label: c.trades, value: f.number(lead.tradeCount24h, 0) },
                    { label: c.participants, value: `${lead.participantCount24h} (${lead.qualifiedCount24h} ${c.qualified.toLowerCase()})` },
                    { label: c.lastRecorded, value: f.date(lead.lastTradeAt) },
                  ]} />
                  <button type="button" className="research-control investigation-icon-btn" onClick={() => onSelect(lead.mint)}>
                    <span>{c.openLead}</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        )
      )}
    </Section>
  );
}

function EmptyInvestigationLaunchpad({ onSelect }: { onSelect: (mint: string) => void }) {
  const c = useCopy();
  const icons = [Layers, Compass, Zap, Activity] as const;
  return (
    <>
      <ActiveLeadsLauncher onSelect={onSelect} />
      <Section title={c.capabilitiesTitle}>
        <p className="investigation-lead-copy">{c.start}</p>
        <div className="investigation-cap-grid">
          {c.capabilities.map((cap, idx) => {
            const Icon = icons[idx] ?? Layers;
            return (
              <article key={cap.step} className="investigation-cap-card">
                <div className="investigation-cap-head">
                  <span className="investigation-cap-icon"><Icon size={16} aria-hidden="true" /></span>
                  <b>{cap.step}</b>
                </div>
                <h3>{cap.title}</h3>
                <p>{cap.body}</p>
              </article>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function InvestigationDesk({ mint }: { mint: string }) {
  const c = useCopy(), router = useRouter();
  const [input, setInput] = useState(mint), [invalid, setInvalid] = useState(!!mint && !isSolanaAddress(mint));
  const [window, setWindow] = useState<'24h' | '7d'>('24h'), [revision, setRevision] = useState(0);
  const goTo = (target: string) => {
    setInput(target);
    setInvalid(false);
    router.push(`/app/investigation/${encodeURIComponent(target)}`);
  };
  return (
    <div className="investigation-page">
      <InvestigationSuiteBar />
      <PageHeading title={c.title} body={c.body} />

      <div className="investigation-command-card">
        <form
          className="investigation-form"
          onSubmit={e => {
            e.preventDefault();
            const value = input.trim();
            if (!isSolanaAddress(value)) { setInvalid(true); return; }
            setInvalid(false);
            if (value === mint) setRevision(v => v + 1);
            else router.push(`/app/investigation/${encodeURIComponent(value)}`);
          }}
        >
          <div className="investigation-mint-field">
            <label htmlFor="investigation-mint">{c.mint}</label>
            <input
              id="investigation-mint"
              value={input}
              onChange={e => { setInput(e.target.value); setInvalid(false); }}
              placeholder={c.mintPlaceholder}
              maxLength={44}
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={invalid}
              aria-describedby={invalid ? 'investigation-input-error' : undefined}
            />
          </div>
          <div className="investigation-window-field">
            <label htmlFor="investigation-window">{c.window}</label>
            <select id="investigation-window" value={window} onChange={e => setWindow(e.target.value as '24h' | '7d')}>
              <option value="24h">{c.day}</option>
              <option value="7d">{c.week}</option>
            </select>
          </div>
          <button className="button button-primary investigation-submit-btn" type="submit">
            <Search size={15} aria-hidden="true" />
            <span>{c.open}</span>
          </button>
        </form>
        <p className="investigation-lookup-note">{c.lookupScope}</p>
        {invalid && (
          <p id="investigation-input-error" className="investigation-error-banner" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{c.invalid}</span>
          </p>
        )}
      </div>

      {isSolanaAddress(mint) ? (
        <InvestigationRead key={`${mint}:${window}:${revision}`} mint={mint} window={window} restart={() => setRevision(v => v + 1)} widen={() => setWindow('7d')} />
      ) : (
        !mint && <EmptyInvestigationLaunchpad onSelect={goTo} />
      )}
    </div>
  );
}

function InvestigationRead({ mint, window, restart, widen }: { mint: string; window: '24h' | '7d'; restart: () => void; widen: () => void }) {
  const { read, send, userId } = useResearch(), c = useCopy();
  const [cursors, setCursors] = useState<string[]>([]), [asOf, setAsOf] = useState<string>(), [pollUntil, setPollUntil] = useState<number | null>(null);
  const params = new URLSearchParams({ window, limit: '50' });
  if (asOf) params.set('asOf', asOf);
  if (cursors.length) params.set('cursor', cursors.at(-1)!);
  const path = `smart-money/investigations/${encodeURIComponent(mint)}?${params}`;
  const query = useQuery({ queryKey: ['research', userId, path], queryFn: ({ signal }) => read(path, InvestigationResponse, signal), retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchInterval: pollUntil ? 5000 : false });
  const baseline = useRef<string | null>(null);
  const discovery = useMutation({
    mutationFn: () => send(`smart-money/investigations/${encodeURIComponent(mint)}/discover`, InvestigationDiscoveryRequest, 'POST'),
    onSuccess: () => { baseline.current = query.data?.discovery?.checkedAt ?? null; setPollUntil(Date.now()); void query.refetch(); },
  });
  // Poll only while a requested scan can still be running. A changed terminal scan record ends the wait, not a guessed clock.
  useEffect(() => { if (!pollUntil) return; const timer = setTimeout(() => setPollUntil(null), 120_000); return () => clearTimeout(timer); }, [pollUntil]);
  useEffect(() => {
    const scan = query.data?.discovery, checkedAt = scan?.checkedAt ?? null;
    if (pollUntil && scan && scan.status !== 'RUNNING' && checkedAt !== baseline.current) setPollUntil(null);
  }, [pollUntil, query.data?.discovery]);
  const discovering = discovery.isPending || !!pollUntil;
  return (
    <>
      <div className="investigation-toolbar">
        <p>{c.scope}</p>
        <button className="research-control investigation-icon-btn" onClick={restart}>
          <RefreshCw size={14} aria-hidden="true" />
          <span>{c.refresh}</span>
        </button>
      </div>
      {query.isError ? (
        query.error instanceof ApiError && query.error.code === 'INVALID_CURSOR' ? (
          <div className="investigation-error-banner" role="alert">
            <p>{c.restart}</p>
            <button className="research-control" onClick={restart}>{c.refresh}</button>
          </div>
        ) : (
          <ResourceError error={query.error} retry={() => void query.refetch()} />
        )
      ) : query.isPending ? (
        <Loading />
      ) : (
        <InvestigationResults key={query.dataUpdatedAt} data={query.data} widen={window === '24h' ? widen : undefined} discover={() => discovery.mutate()} discovering={discovering} discoveryFailed={discovery.isError} />
      )}
      <p className="research-note">{c.pagingNote}</p>
      <Pager page={cursors.length + 1} previous={() => setCursors(v => v.slice(0, -1))} canNext={!query.isFetching && !query.isError && !!query.data?.nextCursor} next={() => { if (query.data?.nextCursor) { setAsOf(query.data.asOf); setCursors(v => [...v, query.data.nextCursor!]); } }} />
    </>
  );
}

function Totals({ totals, c }: { totals: SmartMoneyInvestigationTotals; c: InvestigationCopy }) {
  return <Metrics items={[{ label: c.buy, value: amount(totals.buySol, c) }, { label: c.sell, value: amount(totals.sellSol, c) }, { label: c.net, value: amount(totals.netSolSpent, c) }, { label: c.units, value: amount(totals.observedTokenUnitDelta, c) }]} />;
}

function FlowChart({ series, c }: { series: InvestigationForensicsData['flowSeries']; c: InvestigationCopy }) {
  const f = useFormat();
  if (!series.length || !series.some(b => b.tradeCount > 0)) return null;
  const maxVal = Math.max(0.0001, ...series.flatMap(b => [Number(b.buySol) || 0, Number(b.sellSol) || 0]));
  const peakGroups = Math.max(0, ...series.map(b => b.activeGroups));
  const w = 600, h = 148, mid = 74, padX = 16, innerW = w - padX * 2, slotW = innerW / series.length, barW = Math.max(8, slotW * 0.62);
  return (
    <div className="investigation-chart-card">
      <div className="investigation-chart-head">
        <h3>{c.flowChartTitle}</h3>
        <span className="investigation-badge">{c.peakActiveGroups}: {peakGroups}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={c.flowChartLabel} className="investigation-flow-svg">
        <line x1={padX} x2={w - padX} y1={mid - 46} y2={mid - 46} stroke="currentColor" strokeOpacity="0.12" />
        <line x1={padX} x2={w - padX} y1={mid} y2={mid} stroke="currentColor" strokeOpacity="0.38" strokeDasharray="3 3" />
        <line x1={padX} x2={w - padX} y1={mid + 46} y2={mid + 46} stroke="currentColor" strokeOpacity="0.12" />
        {series.map((b, i) => {
          const buy = Math.max(0, Number(b.buySol) || 0);
          const sell = Math.max(0, Number(b.sellSol) || 0);
          const buyH = (buy / maxVal) * (mid - 16);
          const sellH = (sell / maxVal) * (mid - 16);
          const x = padX + i * slotW + (slotW - barW) / 2;
          return (
            <g key={b.startAt}>
              {buyH > 0 && <rect x={x} y={mid - buyH} width={barW} height={Math.max(2, buyH)} rx={3} className="investigation-bar-buy" />}
              {sellH > 0 && <rect x={x} y={mid} width={barW} height={Math.max(2, sellH)} rx={3} className="investigation-bar-sell" />}
            </g>
          );
        })}
      </svg>
      <div className="investigation-chart-foot">
        <span>{f.date(series[0]!.startAt)}</span>
        <span>{f.date(series.at(-1)!.endAt)}</span>
      </div>
    </div>
  );
}

function ForensicDesk({ data }: { data: Data }) {
  const c = useCopy(), f = useFormat(), forensics = data.forensics;
  if (!forensics || data.coverage.activity === 'NO_OBSERVED_TRADES') return null;
  const { postures, concentration, flowSeries, coEntryBursts, rapidFlips } = forensics;
  const hhiLabel = concentration.groupHhi == null ? c.unknown : concentration.groupHhi < 1500 ? c.hhiBroad : concentration.groupHhi <= 2500 ? c.hhiModerate : c.hhiHigh;
  return (
    <Section title={c.forensicsTitle}>
      <p className="research-note">{c.forensicsNote}</p>
      <Metrics items={[
        { label: c.accumulating, value: `${postures.accumulatingGroups} (${postures.accumulatingNetSol ?? '0'} SOL)` },
        { label: c.distributing, value: `${postures.distributingGroups} (${postures.distributingNetSol ?? '0'} SOL)` },
        { label: c.rotating, value: f.number(postures.rotatingGroups, 0) },
        { label: c.qualifiedShare, value: concentration.qualifiedBuySharePct == null ? c.unknown : `${f.number(concentration.qualifiedBuySharePct, 1)}%` },
      ]} />
      <Facts items={[
        { label: c.top1Share, value: concentration.top1GroupSharePct == null ? c.unknown : `${f.number(concentration.top1GroupSharePct, 1)}%` },
        { label: c.top3Share, value: concentration.top3GroupSharePct == null ? c.unknown : `${f.number(concentration.top3GroupSharePct, 1)}%` },
        { label: c.groupHhi, value: concentration.groupHhi == null ? c.unknown : `${f.number(concentration.groupHhi, 0)} · ${hhiLabel}` },
        { label: c.automatedCount, value: f.number(concentration.automatedParticipantCount, 0) },
      ]} />
      <FlowChart series={flowSeries} c={c} />
      <div className="investigation-forensic-columns">
        <div>
          <h3 className="investigation-subhead">{c.burstsTitle}</h3>
          {!coEntryBursts.length ? <p className="research-note">{c.burstsEmpty}</p> : (
            <div className="investigation-stack">
              {coEntryBursts.map(b => (
                <article key={`${b.startAt}:${b.sampleSignatures[0] ?? ''}`} className="investigation-group">
                  <div className="investigation-event">
                    <span className="investigation-side buy">{b.independentGroupCount} / {b.participantCount}</span>
                    <time dateTime={b.startAt}>{f.date(b.startAt)}</time>
                  </div>
                  <Facts items={[
                    { label: c.burstGroups, value: `${b.independentGroupCount} / ${b.participantCount}` },
                    { label: c.burstSol, value: amount(b.totalBuySol, c) },
                    { label: c.burstSpan, value: fmtDuration(b.spanSeconds) },
                  ]} />
                  <div className="investigation-chip-row">
                    {b.participantIds.slice(0, 4).map(wId => {
                      const addr = data.participants.find(p => p.id === wId)?.address ?? wId;
                      return <WalletAddress key={wId} address={addr} />;
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3 className="investigation-subhead">{c.flipsTitle}</h3>
          {!rapidFlips.length ? <p className="research-note">{c.flipsEmpty}</p> : (
            <div className="investigation-stack">
              {rapidFlips.map(fl => {
                const addr = data.participants.find(p => p.id === fl.walletId)?.address ?? fl.walletId;
                return (
                  <article key={fl.walletId} className="investigation-group">
                    <div className="investigation-event">
                      <WalletAddress address={addr} />
                      <span className="investigation-badge">{fl.buyCount}B / {fl.sellCount}S · {fmtDuration(fl.spanSeconds)}</span>
                    </div>
                    <Facts items={[
                      { label: c.buy, value: amount(fl.buySol, c) },
                      { label: c.sell, value: amount(fl.sellSol, c) },
                      { label: c.netExtracted, value: amount(fl.netExtractedSol, c) },
                    ]} />
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function InvestigationResults({ data, widen, discover, discovering, discoveryFailed }: { data: Data; widen?: () => void; discover: () => void; discovering: boolean; discoveryFailed: boolean }) {
  const c = useCopy(), f = useFormat(), { access } = useResearch();
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const noTrades = data.coverage.activity === 'NO_OBSERVED_TRADES';
  const visibleTrades = sideFilter === 'ALL' ? data.trades : data.trades.filter(t => t.side === sideFilter);
  const actions = (
    <div className="investigation-header-actions">
      {hasFeature(access, 'research.thesis_tracker') && (
        <Link className="research-control" href={`/app/theses?mint=${encodeURIComponent(data.token.mint)}&symbol=${encodeURIComponent(data.token.symbol)}`}>{c.proBridgeThesis}</Link>
      )}
      {hasFeature(access, 'research.personal_radar') && (
        <Link className="research-control" href={`/app/personal-radar?mint=${encodeURIComponent(data.token.mint)}&symbol=${encodeURIComponent(data.token.symbol)}`}>{c.proBridgeRadar}</Link>
      )}
      {hasFeature(access, 'research.tokens') && (
        <Link className="research-control" href={`/app/tokens/${encodeURIComponent(data.token.mint)}`}>{c.token}</Link>
      )}
    </div>
  );
  return (
    <>
      <Section title={`${data.token.symbol} · ${data.token.name}`} action={actions}>
        <code className="investigation-address">{data.token.mint}</code>
        <div className={`investigation-coverage ${data.coverage.tradesTruncated ? 'is-capped' : ''}`}>
          <strong>{noTrades ? c.noActivity : data.coverage.tradesTruncated ? c.capped : c.complete}</strong>
          {noTrades && <p>{c.emptyScope}</p>}
          <Facts items={[{ label: c.from, value: f.date(data.from) }, { label: c.asOf, value: f.date(data.asOf) }, { label: c.readAt, value: f.date(data.readAt) }]} />
          {data.availability && <Facts items={[{ label: c.trackedScope, value: data.availability.activeTrackedWallets }, { label: c.lastRecorded, value: data.availability.lastRecordedTradeAt ? f.date(data.availability.lastRecordedTradeAt) : c.neverRecorded }]} />}
          {noTrades && widen && data.availability?.hasTradesIn7d && <button className="research-control" onClick={widen}>{c.widen}</button>}
          <DiscoveryPanel data={data} discover={discover} discovering={discovering} discoveryFailed={discoveryFailed} />
        </div>
        {noTrades ? <Metrics items={[c.buy, c.sell, c.net, c.units].map(label => ({ label, value: c.noAmount }))} /> : <Totals totals={data.totals} c={c} />}
        <p className="research-note">{c.unitsNote}</p>
        <Metrics items={[{ label: c.trades, value: f.number(data.coverage.tradesRead, 0) }, { label: c.participants, value: f.number(data.coverage.participantCount, 0) }, { label: c.groups, value: f.number(data.coverage.groupCount, 0) }, { label: c.qualified, value: f.number(data.coverage.currentlyQualifiedCount, 0) }, { label: c.covered, value: `${data.coverage.historyCoveredCount} / ${data.coverage.participantCount}` }]} />
        <p className="research-note">{c.currentNote}</p>
        <details className="investigation-details">
          <summary>{c.limitations}</summary>
          <p>{c.historyNote}</p>
          <ul>{data.coverage.limitations.map(reason => <li key={reason}>{c.reasons[reason] ?? reason}</li>)}</ul>
        </details>
      </Section>
      <ForensicDesk data={data} />
      <StrategyEvidence data={data} />
      <PublicationContext data={data} />
      {data.coverage.activity === 'NO_OBSERVED_TRADES' ? (
        <Empty body={c.empty} />
      ) : (
        <>
          <ParticipantGroups data={data} />
          <Section title={c.activity}>
            <p className="research-note">{c.activityHelp}</p>
            <div className="investigation-pills">
              {([['ALL', c.timelineAll], ['BUY', c.BUY], ['SELL', c.SELL]] as const).map(([val, label]) => (
                <button key={val} type="button" className="research-control" aria-pressed={sideFilter === val} onClick={() => setSideFilter(val)}>{label}</button>
              ))}
            </div>
            <ol className="investigation-timeline">
              {visibleTrades.map(trade => (
                <li key={trade.id} className="investigation-timeline-card">
                  <div className="investigation-event">
                    <span className={`investigation-side ${trade.side.toLowerCase()}`}>{c[trade.side]}</span>
                    <time dateTime={trade.at}>{f.date(trade.at)}</time>
                    <WalletAddress address={data.participants.find(p => p.id === trade.walletId)?.address ?? trade.walletId} />
                  </div>
                  <Facts items={[{ label: c.amount, value: amount(trade.amountSol, c) }, { label: c.quantity, value: amount(trade.tokenAmount, c) }]} />
                  <EvidenceDialog title={c.evidence} description={c.activityHelp} triggerLabel={`${c.evidence} ${short(trade.signature)}`}>
                    <Facts items={[{ label: c.time, value: f.date(trade.at) }, { label: c.amount, value: amount(trade.amountSol, c) }, { label: c.quantity, value: amount(trade.tokenAmount, c) }]} />
                    <p>{c.wallet}</p>
                    <code className="investigation-address">{data.participants.find(p => p.id === trade.walletId)?.address ?? trade.walletId}</code>
                    <p>{c.signature}</p>
                    <code className="investigation-address">{trade.signature}</code>
                    {/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trade.signature) && <a className="research-control" href={`https://solscan.io/tx/${encodeURIComponent(trade.signature)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a>}
                    <h3>{c.provenance}</h3>
                    <SourceEvidence value={trade.evidence} />
                  </EvidenceDialog>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
    </>
  );
}

function DiscoveryPanel({ data, discover, discovering, discoveryFailed }: { data: Data; discover: () => void; discovering: boolean; discoveryFailed: boolean }) {
  const c = useCopy(), f = useFormat(), d = data.discovery;
  return (
    <div className="investigation-discovery">
      <h3>{c.discoveryTitle}</h3>
      <p className="research-note">{c.discoveryNote}</p>
      <Facts items={[{ label: c.lastScan, value: d?.checkedAt ? f.date(d.checkedAt) : c.scanNever }, { label: c.scanNew, value: d?.newWallets ?? c.unknown }, { label: c.scanSwaps, value: d?.swapsRead ?? c.unknown }, { label: c.scanCandidates, value: d?.candidates ?? c.unknown }]} />
      {d?.status === 'RUNNING' && <p role="status">{c.scanRunning}</p>}
      {d?.status === 'PARTIAL' && <p>{c.discoveryCapped}</p>}
      {d?.status === 'FAILED' && <p role="alert">{c.scanFailed}</p>}
      <button type="button" className="research-control" onClick={discover} disabled={discovering}>{discovering ? c.discoveringShort : c.discover}</button>
      {discovering && <p role="status">{c.discoveryQueued}</p>}
      {discoveryFailed && <p role="alert">{c.discoveryFailed}</p>}
    </div>
  );
}

function WalletAddress({ address }: { address: string }) {
  const { access } = useResearch();
  return <span className="investigation-wallet">{isSolanaAddress(address) && hasFeature(access, 'research.wallet_detail') ? <Link href={`/app/smart-money/${encodeURIComponent(address)}`} title={address}>{short(address)}</Link> : <code title={address}>{short(address)}</code>}</span>;
}

function EvidenceDialog({ title, description, triggerLabel, children }: { title: string; description: string; triggerLabel?: string; children: ReactNode }) {
  const c = useCopy();
  return <Dialog.Root><Dialog.Trigger asChild><button className="research-control" aria-label={triggerLabel}>{title}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content investigation-drawer"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description><Dialog.Close className="research-control investigation-close">{c.close}</Dialog.Close>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function SourceEvidence({ value }: { value: unknown }) { const c = useCopy(); return value == null ? <p>{c.noEvidence}</p> : <pre className="investigation-source">{JSON.stringify(value, null, 2)}</pre>; }

function postureLabel(posture: Group['posture'], c: InvestigationCopy): string | null {
  if (!posture) return null;
  if (posture === 'ACCUMULATING') return c.accumulating;
  if (posture === 'DISTRIBUTING') return c.distributing;
  if (posture === 'ROTATING') return c.rotating;
  return c.unpriced;
}

function ParticipantGroups({ data }: { data: Data }) {
  const c = useCopy(), f = useFormat(), t = useTranslations('workspace.smartResearch');
  const [selected, setSelected] = useState<string[]>([]), [filter, setFilter] = useState(''), [postureFilter, setPostureFilter] = useState<'ALL' | 'ACCUMULATING' | 'DISTRIBUTING' | 'ROTATING'>('ALL'), [shown, setShown] = useState(24);
  const name = (group: Group) => group.basis === 'UNGROUPED' ? `${c.single} ${short(data.participants.find(p => p.id === group.participantIds[0])?.address ?? group.id)}` : `${c.group} ${data.groups.indexOf(group) + 1}`;
  const hasPostures = data.groups.some(g => !!g.posture);
  const filtered = data.groups.filter(g =>
    (postureFilter === 'ALL' || g.posture === postureFilter) &&
    g.participantIds.some(id => data.participants.find(p => p.id === id)?.address.includes(filter.trim())),
  );
  const chosen = data.groups.filter(g => selected.includes(g.id));
  return (
    <>
      <Section title={c.groupTitle}>
        <p>{c.groupHelp}</p>
        <div className="investigation-toolbar">
          <label htmlFor="investigation-participant-filter">{c.filter}<input id="investigation-participant-filter" value={filter} onChange={e => { setFilter(e.target.value); setShown(24); }} maxLength={44} spellCheck={false} /></label>
          <p aria-live="polite">{c.selected}: {selected.length} / 3</p>
        </div>
        {hasPostures && (
          <div className="investigation-pills">
            {([['ALL', c.postureFilterAll], ['ACCUMULATING', c.accumulating], ['DISTRIBUTING', c.distributing], ['ROTATING', c.rotating]] as const).map(([val, label]) => (
              <button key={val} type="button" className="research-control" aria-pressed={postureFilter === val} onClick={() => { setPostureFilter(val); setShown(24); }}>{label}</button>
            ))}
          </div>
        )}
        <div className="investigation-groups">
          {filtered.slice(0, shown).map(group => {
            const pLabel = postureLabel(group.posture, c);
            const hasAuto = group.participantIds.some(id => data.participants.find(p => p.id === id)?.automated);
            return (
              <article className="investigation-group" key={group.id}>
                <div className="investigation-group-head">
                  <h3>{name(group)}</h3>
                  <div className="investigation-chip-row">
                    {pLabel && <span className="investigation-badge" data-posture={group.posture}>{pLabel}</span>}
                    {hasAuto && <span className="investigation-badge">{c.automatedBadge}</span>}
                  </div>
                </div>
                <p>{c[group.basis]} · {c.confidence}: {group.confidence ? c[group.confidence] : c.unknown}</p>
                <Facts items={[{ label: c.participants, value: group.participantIds.length }, { label: c.net, value: amount(group.totals.netSolSpent, c) }, { label: c.units, value: amount(group.totals.observedTokenUnitDelta, c) }]} />
                <label className="investigation-select">
                  <input type="checkbox" checked={selected.includes(group.id)} disabled={selected.length >= 3 && !selected.includes(group.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id))} />
                  {c.select} {name(group)}
                </label>
                <EvidenceDialog title={c.groupEvidence} triggerLabel={`${c.groupEvidence} ${name(group)}`} description={c.currentNote}>
                  <h3>{name(group)}</h3>
                  <Facts items={[{ label: c.basis, value: c[group.basis] }, { label: c.confidence, value: group.confidence ? c[group.confidence] : c.unknown }, { label: c.clusterCreated, value: f.date(group.clusterCreatedAt) }, { label: c.readAt, value: f.date(data.readAt) }]} />
                  <Totals totals={group.totals} c={c} />
                  {data.participants.filter(p => group.participantIds.includes(p.id)).map(p => (
                    <section key={p.id} className="investigation-member">
                      <h4>{c.wallet}</h4>
                      <code className="investigation-address">{p.address}</code>
                      <WalletAddress address={p.address} />
                      <p>{t(p.currentQualification.status)}{p.automated ? ` · ${c.automatedBadge}` : ''}</p>
                      <ul>{p.currentQualification.reasons.map(reason => <li key={reason}>{t.has(`issues.${reason}`) ? t(`issues.${reason}`) : reason}</li>)}</ul>
                      <Totals totals={p.totals} c={c} />
                      <h4>{c.history}: {c.historyStatus[p.history.status]}</h4>
                      <Facts items={[{ label: c.checked, value: f.date(p.history.checkedAt) }, { label: c.from, value: f.date(p.history.coveredFrom) }, { label: c.asOf, value: f.date(p.history.coveredTo) }, { label: c.skipped, value: p.history.skipped ?? c.unknown }, { label: c.scanCapped, value: p.history.capped === null ? c.unknown : p.history.capped ? c.yes : c.no }]} />
                    </section>
                  ))}
                  <h3>{c.relationships}</h3>
                  {data.coverage.relationshipsTruncated && <p>{c.relationshipCap}</p>}
                  {data.relationships.filter(r => group.participantIds.includes(r.fromId) || group.participantIds.includes(r.toId)).length ? data.relationships.filter(r => group.participantIds.includes(r.fromId) || group.participantIds.includes(r.toId)).map(r => (
                    <div key={r.id} className="investigation-member">
                      <p><WalletAddress address={data.participants.find(p => p.id === r.fromId)?.address ?? r.fromId} /> → <WalletAddress address={data.participants.find(p => p.id === r.toId)?.address ?? r.toId} /></p>
                      <p>{r.kind === 'FUNDING' || r.kind === 'TIMING' ? c[r.kind] : r.kind} · {c.confidence}: {c[r.confidence]}</p>
                      <SourceEvidence value={r.evidence} />
                    </div>
                  )) : <p>{c.noRelationships}</p>}
                </EvidenceDialog>
              </article>
            );
          })}
        </div>
        <p>{c.shown}: {Math.min(shown, filtered.length)} / {filtered.length}</p>
        {filtered.length > shown && <button className="research-control" onClick={() => setShown(v => v + 24)}>{c.more}</button>}
      </Section>

      <Section title={c.compare} action={selected.length > 0 && <button className="research-control" onClick={() => setSelected([])}>{c.clear}</button>}>
        {chosen.length < 2 ? <p>{c.compareEmpty}</p> : (
          <>
            <p className="research-note">{c.comparisonReady}</p>
            <div className="investigation-comparison">
              {chosen.map(group => (
                <article key={group.id}>
                  <h3>{name(group)}</h3>
                  {group.posture && <p className="investigation-badge" data-posture={group.posture}>{postureLabel(group.posture, c)}</p>}
                  <Totals totals={group.totals} c={c} />
                  <Facts items={[{ label: c.basis, value: c[group.basis] }, { label: c.participants, value: group.participantIds.length }, { label: c.trades, value: group.totals.tradeCount }, { label: c.first, value: f.date(group.totals.firstObservedAt) }, { label: c.last, value: f.date(group.totals.lastObservedAt) }]} />
                </article>
              ))}
            </div>
          </>
        )}
      </Section>
    </>
  );
}

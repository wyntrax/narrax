'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { InvestigationDiscoveryRequest, InvestigationResponse, isSolanaAddress, type SmartMoneyInvestigation, type SmartMoneyInvestigationTotals } from '@narra/shared';
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

export function InvestigationPage({ mint = '' }: { mint?: string }) {
  const { access } = useResearch();
  if (!hasFeature(access, 'research.smart_money_investigation')) return <Locked tier={access.features['research.smart_money_investigation']?.requiredTier ?? 'PRO'} />;
  return <InvestigationDesk key={mint} mint={mint} />;
}
function InvestigationDesk({ mint }: { mint: string }) {
  const c = useCopy(), router = useRouter();
  const [input, setInput] = useState(mint), [invalid, setInvalid] = useState(!!mint && !isSolanaAddress(mint));
  const [window, setWindow] = useState<'24h' | '7d'>('24h'), [revision, setRevision] = useState(0);
  return <div className="investigation-page"><PageHeading title={c.title} body={c.body} />
    <form className="investigation-form" onSubmit={e => { e.preventDefault(); const value = input.trim(); if (!isSolanaAddress(value)) { setInvalid(true); return; } setInvalid(false); if (value === mint) setRevision(v => v + 1); else router.push(`/app/investigation/${encodeURIComponent(value)}`); }}>
      <div><label htmlFor="investigation-mint">{c.mint}</label><input id="investigation-mint" value={input} onChange={e => { setInput(e.target.value); setInvalid(false); }} maxLength={44} autoCapitalize="none" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? 'investigation-input-error' : undefined} /></div><button className="research-control" type="submit">{c.open}</button>
      <div><label htmlFor="investigation-window">{c.window}</label><select id="investigation-window" value={window} onChange={e => setWindow(e.target.value as '24h' | '7d')}><option value="24h">{c.day}</option><option value="7d">{c.week}</option></select></div>
    </form><p className="research-note">{c.lookupScope}</p>{invalid && <p id="investigation-input-error" role="alert">{c.invalid}</p>}
    {isSolanaAddress(mint) ? <InvestigationRead key={`${mint}:${window}:${revision}`} mint={mint} window={window} restart={() => setRevision(v => v + 1)} widen={() => setWindow('7d')} /> : !mint && <Empty body={c.start} />}
  </div>;
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
  return <><div className="investigation-toolbar"><p>{c.scope}</p><button className="research-control" onClick={restart}>{c.refresh}</button></div>
    {query.isError ? query.error instanceof ApiError && query.error.code === 'INVALID_CURSOR' ? <div role="alert"><p>{c.restart}</p><button className="research-control" onClick={restart}>{c.refresh}</button></div> : <ResourceError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <Loading /> : <InvestigationResults key={query.dataUpdatedAt} data={query.data} widen={window === '24h' ? widen : undefined} discover={() => discovery.mutate()} discovering={discovering} discoveryFailed={discovery.isError} />}
    <p className="research-note">{c.pagingNote}</p><Pager page={cursors.length + 1} previous={() => setCursors(v => v.slice(0, -1))} canNext={!query.isFetching && !query.isError && !!query.data?.nextCursor} next={() => { if (query.data?.nextCursor) { setAsOf(query.data.asOf); setCursors(v => [...v, query.data.nextCursor!]); } }} />
  </>;
}
function Totals({ totals, c }: { totals: SmartMoneyInvestigationTotals; c: InvestigationCopy }) {
  return <Metrics items={[{ label: c.buy, value: amount(totals.buySol, c) }, { label: c.sell, value: amount(totals.sellSol, c) }, { label: c.net, value: amount(totals.netSolSpent, c) }, { label: c.units, value: amount(totals.observedTokenUnitDelta, c) }]} />;
}
function InvestigationResults({ data, widen, discover, discovering, discoveryFailed }: { data: Data; widen?: () => void; discover: () => void; discovering: boolean; discoveryFailed: boolean }) {
  const c = useCopy(), f = useFormat(), { access } = useResearch();
  const noTrades = data.coverage.activity === 'NO_OBSERVED_TRADES';
  return <><Section title={`${data.token.symbol} · ${data.token.name}`} action={hasFeature(access, 'research.tokens') && <Link className="research-control" href={`/app/tokens/${encodeURIComponent(data.token.mint)}`}>{c.token}</Link>}>
    <code className="investigation-address">{data.token.mint}</code><div className={`investigation-coverage ${data.coverage.tradesTruncated ? 'is-capped' : ''}`}><strong>{noTrades ? c.noActivity : data.coverage.tradesTruncated ? c.capped : c.complete}</strong>{noTrades && <p>{c.emptyScope}</p>}<Facts items={[{ label: c.from, value: f.date(data.from) }, { label: c.asOf, value: f.date(data.asOf) }, { label: c.readAt, value: f.date(data.readAt) }]} />{data.availability && <Facts items={[{ label: c.trackedScope, value: data.availability.activeTrackedWallets }, { label: c.lastRecorded, value: data.availability.lastRecordedTradeAt ? f.date(data.availability.lastRecordedTradeAt) : c.neverRecorded }]} />}{noTrades && widen && data.availability?.hasTradesIn7d && <button className="research-control" onClick={widen}>{c.widen}</button>}<DiscoveryPanel data={data} discover={discover} discovering={discovering} discoveryFailed={discoveryFailed} /></div>
    {noTrades ? <Metrics items={[c.buy, c.sell, c.net, c.units].map(label => ({ label, value: c.noAmount }))} /> : <Totals totals={data.totals} c={c} />}<p className="research-note">{c.unitsNote}</p><Metrics items={[{ label: c.trades, value: f.number(data.coverage.tradesRead, 0) }, { label: c.participants, value: f.number(data.coverage.participantCount, 0) }, { label: c.groups, value: f.number(data.coverage.groupCount, 0) }, { label: c.qualified, value: f.number(data.coverage.currentlyQualifiedCount, 0) }, { label: c.covered, value: `${data.coverage.historyCoveredCount} / ${data.coverage.participantCount}` }]} />
    <p className="research-note">{c.currentNote}</p><details className="investigation-details"><summary>{c.limitations}</summary><p>{c.historyNote}</p><ul>{data.coverage.limitations.map(reason => <li key={reason}>{c.reasons[reason] ?? reason}</li>)}</ul></details>
  </Section><StrategyEvidence data={data} /><PublicationContext data={data} />{data.coverage.activity === 'NO_OBSERVED_TRADES' ? <Empty body={c.empty} /> : <><ParticipantGroups data={data} /><Section title={c.activity}><p className="research-note">{c.activityHelp}</p><ol className="investigation-timeline">{data.trades.map(trade => <li key={trade.id}>
    <div className="investigation-event"><span className={`investigation-side ${trade.side.toLowerCase()}`}>{c[trade.side]}</span><time dateTime={trade.at}>{f.date(trade.at)}</time><WalletAddress address={data.participants.find(p => p.id === trade.walletId)?.address ?? trade.walletId} /></div><Facts items={[{ label: c.amount, value: amount(trade.amountSol, c) }, { label: c.quantity, value: amount(trade.tokenAmount, c) }]} />
    <EvidenceDialog title={c.evidence} description={c.activityHelp} triggerLabel={`${c.evidence} ${short(trade.signature)}`}><Facts items={[{ label: c.time, value: f.date(trade.at) }, { label: c.amount, value: amount(trade.amountSol, c) }, { label: c.quantity, value: amount(trade.tokenAmount, c) }]} /><p>{c.wallet}</p><code className="investigation-address">{data.participants.find(p => p.id === trade.walletId)?.address ?? trade.walletId}</code><p>{c.signature}</p><code className="investigation-address">{trade.signature}</code>{/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trade.signature) && <a className="research-control" href={`https://solscan.io/tx/${encodeURIComponent(trade.signature)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a>}<h3>{c.provenance}</h3><SourceEvidence value={trade.evidence} /></EvidenceDialog>
  </li>)}</ol></Section></>}</>;
}
function DiscoveryPanel({ data, discover, discovering, discoveryFailed }: { data: Data; discover: () => void; discovering: boolean; discoveryFailed: boolean }) {
  const c = useCopy(), f = useFormat(), d = data.discovery;
  return <div className="investigation-discovery"><h3>{c.discoveryTitle}</h3><p className="research-note">{c.discoveryNote}</p>
    <Facts items={[{ label: c.lastScan, value: d?.checkedAt ? f.date(d.checkedAt) : c.scanNever }, { label: c.scanNew, value: d?.newWallets ?? c.unknown }, { label: c.scanSwaps, value: d?.swapsRead ?? c.unknown }, { label: c.scanCandidates, value: d?.candidates ?? c.unknown }]} />
    {d?.status === 'RUNNING' && <p role="status">{c.scanRunning}</p>}{d?.status === 'PARTIAL' && <p>{c.discoveryCapped}</p>}{d?.status === 'FAILED' && <p role="alert">{c.scanFailed}</p>}
    <button type="button" className="research-control" onClick={discover} disabled={discovering}>{discovering ? c.discoveringShort : c.discover}</button>
    {discovering && <p role="status">{c.discoveryQueued}</p>}{discoveryFailed && <p role="alert">{c.discoveryFailed}</p>}
  </div>;
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
function ParticipantGroups({ data }: { data: Data }) {
  const c = useCopy(), f = useFormat(), t = useTranslations('workspace.smartResearch');
  const [selected, setSelected] = useState<string[]>([]), [filter, setFilter] = useState(''), [shown, setShown] = useState(24);
  const name = (group: Group) => group.basis === 'UNGROUPED' ? `${c.single} ${short(data.participants.find(p => p.id === group.participantIds[0])?.address ?? group.id)}` : `${c.group} ${data.groups.indexOf(group) + 1}`;
  const filtered = data.groups.filter(g => g.participantIds.some(id => data.participants.find(p => p.id === id)?.address.includes(filter.trim()))), chosen = data.groups.filter(g => selected.includes(g.id));
  return <><Section title={c.groupTitle}><p>{c.groupHelp}</p><div className="investigation-toolbar"><label htmlFor="investigation-participant-filter">{c.filter}<input id="investigation-participant-filter" value={filter} onChange={e => { setFilter(e.target.value); setShown(24); }} maxLength={44} spellCheck={false} /></label><p aria-live="polite">{c.selected}: {selected.length} / 3</p></div>
    <div className="investigation-groups">{filtered.slice(0, shown).map(group => <article className="investigation-group" key={group.id}><h3>{name(group)}</h3><p>{c[group.basis]} · {c.confidence}: {group.confidence ? c[group.confidence] : c.unknown}</p><Facts items={[{ label: c.participants, value: group.participantIds.length }, { label: c.net, value: amount(group.totals.netSolSpent, c) }, { label: c.units, value: amount(group.totals.observedTokenUnitDelta, c) }]} />
      <label className="investigation-select"><input type="checkbox" checked={selected.includes(group.id)} disabled={selected.length >= 3 && !selected.includes(group.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id))} />{c.select} {name(group)}</label>
      <EvidenceDialog title={c.groupEvidence} triggerLabel={`${c.groupEvidence} ${name(group)}`} description={c.currentNote}><h3>{name(group)}</h3><Facts items={[{ label: c.basis, value: c[group.basis] }, { label: c.confidence, value: group.confidence ? c[group.confidence] : c.unknown }, { label: c.clusterCreated, value: f.date(group.clusterCreatedAt) }, { label: c.readAt, value: f.date(data.readAt) }]} /><Totals totals={group.totals} c={c} />
        {data.participants.filter(p => group.participantIds.includes(p.id)).map(p => <section key={p.id} className="investigation-member"><h4>{c.wallet}</h4><code className="investigation-address">{p.address}</code><WalletAddress address={p.address} /><p>{t(p.currentQualification.status)}</p><ul>{p.currentQualification.reasons.map(reason => <li key={reason}>{t.has(`issues.${reason}`) ? t(`issues.${reason}`) : reason}</li>)}</ul><Totals totals={p.totals} c={c} /><h4>{c.history}: {c.historyStatus[p.history.status]}</h4><Facts items={[{ label: c.checked, value: f.date(p.history.checkedAt) }, { label: c.from, value: f.date(p.history.coveredFrom) }, { label: c.asOf, value: f.date(p.history.coveredTo) }, { label: c.skipped, value: p.history.skipped ?? c.unknown }, { label: c.scanCapped, value: p.history.capped === null ? c.unknown : p.history.capped ? c.yes : c.no }]} /></section>)}
        <h3>{c.relationships}</h3>{data.coverage.relationshipsTruncated && <p>{c.relationshipCap}</p>}{data.relationships.filter(r => group.participantIds.includes(r.fromId) || group.participantIds.includes(r.toId)).length ? data.relationships.filter(r => group.participantIds.includes(r.fromId) || group.participantIds.includes(r.toId)).map(r => <div key={r.id} className="investigation-member"><p><WalletAddress address={data.participants.find(p => p.id === r.fromId)?.address ?? r.fromId} /> → <WalletAddress address={data.participants.find(p => p.id === r.toId)?.address ?? r.toId} /></p><p>{r.kind === 'FUNDING' || r.kind === 'TIMING' ? c[r.kind] : r.kind} · {c.confidence}: {c[r.confidence]}</p><SourceEvidence value={r.evidence} /></div>) : <p>{c.noRelationships}</p>}
      </EvidenceDialog></article>)}</div><p>{c.shown}: {Math.min(shown, filtered.length)} / {filtered.length}</p>{filtered.length > shown && <button className="research-control" onClick={() => setShown(v => v + 24)}>{c.more}</button>}
  </Section><Section title={c.compare} action={selected.length > 0 && <button className="research-control" onClick={() => setSelected([])}>{c.clear}</button>}>{chosen.length < 2 ? <p>{c.compareEmpty}</p> : <><p className="research-note">{c.comparisonReady}</p><div className="investigation-comparison">{chosen.map(group => <article key={group.id}><h3>{name(group)}</h3><Totals totals={group.totals} c={c} /><Facts items={[{ label: c.trades, value: group.totals.tradeCount }, { label: c.first, value: f.date(group.totals.firstObservedAt) }, { label: c.last, value: f.date(group.totals.lastObservedAt) }]} /></article>)}</div></>}</Section></>;
}

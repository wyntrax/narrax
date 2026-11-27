'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  PersonalBriefsSchema,
  ResearchMonitorInputSchema,
  ResearchMonitorSchema,
  ResearchMonitorsSchema,
  isSolanaAddress,
  type ResearchCheckKey,
  type ResearchEvaluation,
} from '@narra/shared';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { hasFeature, useResearch, useResearchQuery } from '../research/session';
import { Empty, Loading, Locked, Metrics, PageHeading, ResourceError, Section, useFormat } from '../research/ui';
import { proCopy } from './copy';
import './pro-research.css';

type Monitor = z.infer<typeof ResearchMonitorSchema>;
type Input = z.infer<typeof ResearchMonitorInputSchema>;
type Brief = z.infer<typeof PersonalBriefsSchema>['items'][number];
const Ok = z.object({ ok: z.literal(true) }), Id = z.object({ id: z.string() }), Refreshed = z.object({ queued: z.literal(true) });
const useCopy = () => proCopy[useLocale() === 'id' ? 'id' : 'en'];
const shortMint = (m: string) => m.length > 14 ? `${m.slice(0, 6)}…${m.slice(-4)}` : m;

function cleanRules(r: Input['rules']): Input['rules'] {
  return {
    minLiquidityUsd: r.minLiquidityUsd,
    minIndependentBuyers: r.minIndependentBuyers,
    windowMinutes: r.windowMinutes,
    minNarrativeVelocity: r.minNarrativeVelocity,
    maxRiskScore: r.maxRiskScore,
    ...(r.minNetFlowSol != null ? { minNetFlowSol: r.minNetFlowSol } : {}),
    ...(r.minMarketCapUsd != null ? { minMarketCapUsd: r.minMarketCapUsd } : {}),
    ...(r.maxMarketCapUsd != null ? { maxMarketCapUsd: r.maxMarketCapUsd } : {}),
    ...(r.minHolders != null ? { minHolders: r.minHolders } : {}),
    ...(r.maxTop10Pct != null ? { maxTop10Pct: r.maxTop10Pct } : {}),
    ...(r.minPriceChange1hPct != null ? { minPriceChange1hPct: r.minPriceChange1hPct } : {}),
  };
}

const inputOf = (item: Monitor): Input => ({
  name: item.name,
  thesis: item.thesis,
  mint: item.mint,
  narrativeSlug: item.narrativeSlug,
  rules: cleanRules(item.rules),
  active: item.active,
});

const UPPER_BOUND_KEYS = new Set<ResearchCheckKey>(['risk', 'top10Pct', 'marketCapMax']);

function checkMarginPct(key: ResearchCheckKey, value: number | null, threshold: number | null): number | null {
  if (value === null || threshold === null || !Number.isFinite(value) || !Number.isFinite(threshold)) return null;
  if (threshold === 0) return null;
  const raw = UPPER_BOUND_KEYS.has(key)
    ? ((threshold - value) / Math.abs(threshold)) * 100
    : ((value - threshold) / Math.abs(threshold)) * 100;
  return Number.isFinite(raw) ? Math.round(raw * 10) / 10 : null;
}

export function PersonalResearchPage({ kind }: { kind: 'RADAR' | 'THESIS' }) {
  const { access } = useResearch(), key = kind === 'RADAR' ? 'research.personal_radar' : 'research.thesis_tracker';
  return hasFeature(access, key) ? <MonitorPage kind={kind} /> : <Locked tier={access.features[key]?.requiredTier ?? 'PRO'} />;
}

function MonitorPage({ kind }: { kind: 'RADAR' | 'THESIS' }) {
  const c = useCopy(), f = useFormat(), { send, userId } = useResearch(), client = useQueryClient();
  const path = `personal-research/${kind === 'RADAR' ? 'radars' : 'theses'}`;
  const query = useResearchQuery(path, ResearchMonitorsSchema, true, 60_000);
  const [editing, setEditing] = useState<Monitor | 'new' | null>(null);
  const [prefill, setPrefill] = useState<{ mint?: string; name?: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'MATCH' | 'NO_MATCH' | 'UNKNOWN' | 'PAUSED'>('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const qMint = sp.get('mint')?.trim() ?? '';
    const qSym = sp.get('symbol')?.trim() ?? '';
    if (qMint && isSolanaAddress(qMint)) {
      setPrefill({ mint: qMint, name: qSym ? `${qSym} ${kind === 'RADAR' ? 'radar' : 'thesis'}` : undefined });
      setEditing('new');
    }
  }, [kind]);

  const refresh = () => client.invalidateQueries({ queryKey: ['research', userId, path] });
  const mutation = useMutation({
    mutationFn: async (action: { type: 'save'; id?: string; data: Input } | { type: 'delete'; id: string }) => {
      if (action.type === 'delete') return send(`${path}/${encodeURIComponent(action.id)}`, Ok, 'DELETE');
      return send(action.id ? `${path}/${encodeURIComponent(action.id)}` : path, Id, action.id ? 'PUT' : 'POST', action.data);
    },
    onSuccess: async () => { setEditing(null); setPrefill(null); setDeleting(null); await refresh(); },
  });
  const check = useMutation({ mutationFn: () => send(`${path}/refresh`, Refreshed, 'POST'), onSuccess: refresh });
  const error = mutation.error ?? check.error;

  const allItems = query.data?.items ?? [];
  const activeCount = allItems.filter(m => m.active).length;
  const latestStatus = (m: Monitor) => m.observations[0]?.evaluation.status ?? 'UNKNOWN';
  const supportedCount = allItems.filter(m => m.active && latestStatus(m) === 'MATCH').length;
  const weakenedCount = allItems.filter(m => m.active && latestStatus(m) === 'NO_MATCH').length;
  const unknownCount = allItems.filter(m => m.active && latestStatus(m) === 'UNKNOWN').length;
  const scannedTotal = allItems.reduce((s, m) => s + (m.lastRun?.considered ?? 0), 0);

  const visibleItems = allItems.filter(item => {
    if (statusFilter === 'PAUSED' && item.active) return false;
    if (statusFilter !== 'ALL' && statusFilter !== 'PAUSED') {
      if (!item.active || latestStatus(item) !== statusFilter) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.thesis.toLowerCase().includes(q) ||
      (item.mint?.toLowerCase().includes(q) ?? false) ||
      (item.narrativeSlug?.toLowerCase().includes(q) ?? false)
    );
  });

  return <div className="pro-workspace">
    <p className="pro-eyebrow">{c.eyebrow}</p>
    <PageHeading
      title={kind === 'RADAR' ? c.radar : c.thesis}
      body={kind === 'RADAR' ? c.radarBody : c.thesisBody}
      actions={<div className="pro-actions"><button className="research-control" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? c.refreshing : c.refresh}</button><button className="button button-primary" onClick={() => { mutation.reset(); setPrefill(null); setEditing('new'); }}>{kind === 'RADAR' ? c.newRadar : c.newThesis}</button></div>}
    />
    <p className="research-note">{c.limit}</p>
    {check.isSuccess && <p role="status">{c.checked}</p>}
    {error && <p role="alert">{c.errors[error instanceof ApiError ? error.code : 'default'] ?? c.errors.default}</p>}
    {editing && (
      <MonitorForm
        key={typeof editing === 'string' ? `${editing}:${prefill?.mint ?? ''}` : editing.id}
        kind={kind}
        item={editing === 'new' ? undefined : editing}
        prefill={editing === 'new' ? prefill ?? undefined : undefined}
        pending={mutation.isPending}
        onCancel={() => { setEditing(null); setPrefill(null); }}
        onSave={data => mutation.mutate({ type: 'save', data, ...(editing === 'new' ? {} : { id: editing.id }) })}
      />
    )}
    {query.isError ? <ResourceError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <Loading /> : !allItems.length ? <Empty body={kind === 'RADAR' ? c.noRadars : c.noTheses} /> : (
      <>
        <Metrics items={
          kind === 'THESIS'
            ? [
                { label: c.kpiActive, value: `${activeCount} / 20` },
                { label: c.kpiSupported, value: supportedCount },
                { label: c.kpiWeakened, value: weakenedCount },
                { label: c.kpiUnknown, value: unknownCount },
              ]
            : [
                { label: c.kpiActive, value: `${activeCount} / 20` },
                { label: c.matchCount, value: allItems.reduce((s, m) => s + (m.lastRun?.matched ?? 0), 0) },
                { label: c.kpiScanned, value: f.number(scannedTotal, 0) },
                { label: c.kpiUnknown, value: unknownCount },
              ]
        } />
        {allItems.length > 1 && (
          <div className="pro-filter-bar">
            <div className="pro-pills">
              {(
                kind === 'THESIS'
                  ? [['ALL', c.filterAll], ['MATCH', c.supported], ['NO_MATCH', c.weakened], ['UNKNOWN', c.uncertain], ['PAUSED', c.filterPaused]] as const
                  : [['ALL', c.filterAll], ['MATCH', c.match], ['PAUSED', c.filterPaused]] as const
              ).map(([val, label]) => (
                <button key={val} type="button" className="research-control" aria-pressed={statusFilter === val} onClick={() => setStatusFilter(val)}>{label}</button>
              ))}
            </div>
            <label className="pro-search-label">
              <span className="sr-only">{c.searchPlaceholder}</span>
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={c.searchPlaceholder} aria-label={c.searchPlaceholder} maxLength={64} />
            </label>
          </div>
        )}
        <div className="pro-monitor-list">
          {visibleItems.map(item => (
            <MonitorCard
              key={item.id}
              item={item}
              kind={kind}
              deleting={deleting === item.id}
              pending={mutation.isPending}
              onEdit={() => { mutation.reset(); setEditing(item); }}
              onToggleActive={() => mutation.mutate({ type: 'save', id: item.id, data: { ...inputOf(item), active: !item.active } })}
              onAskDelete={() => setDeleting(item.id)}
              onConfirmDelete={() => mutation.mutate({ type: 'delete', id: item.id })}
              onCancelDelete={() => setDeleting(null)}
            />
          ))}
        </div>
      </>
    )}
  </div>;
}

function MonitorCard({
  item, kind, deleting, pending, onEdit, onToggleActive, onAskDelete, onConfirmDelete, onCancelDelete,
}: {
  item: Monitor;
  kind: 'RADAR' | 'THESIS';
  deleting: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const c = useCopy(), f = useFormat(), { access } = useResearch();
  const latest = item.observations[0];
  const latestEval = latest?.evaluation;
  const passCount = latestEval ? latestEval.checks.filter(ch => ch.status === 'PASS').length : 0;
  const totalChecks = latestEval ? latestEval.checks.length : 0;
  const chronological = [...item.observations].reverse();
  const matchObsCount = item.observations.filter(o => o.evaluation.status === 'MATCH').length;
  const supportPct = item.observations.length > 0 ? Math.round((matchObsCount / item.observations.length) * 100) : null;

  // Baseline vs latest observed price delta when snapshots exist
  const pricedObs = chronological.filter(o => o.evaluation.snapshot?.priceUsd != null && o.evaluation.snapshot.priceUsd > 0);
  const firstPrice = pricedObs.length >= 2 ? pricedObs[0]!.evaluation.snapshot!.priceUsd! : null;
  const lastPrice = pricedObs.length >= 2 ? pricedObs.at(-1)!.evaluation.snapshot!.priceUsd! : null;
  const priceDeltaPct = firstPrice && lastPrice ? ((lastPrice / firstPrice) - 1) * 100 : null;

  const statusBadgeText = !latestEval ? null : latestEval.status === 'MATCH' ? (kind === 'RADAR' ? c.match : c.supported) : latestEval.status === 'NO_MATCH' ? c.weakened : c.uncertain;

  return (
    <Section
      title={item.name}
      action={
        <div className="pro-card-badges">
          {statusBadgeText && <span className="pro-status-pill" data-status={latestEval!.status}>{statusBadgeText}{totalChecks > 0 ? ` · ${passCount}/${totalChecks}` : ''}</span>}
          <span className="pro-state">{item.active ? c.active : c.paused}</span>
        </div>
      }
    >
      {item.thesis && <p className="pro-thesis-text">{item.thesis}</p>}
      <div className="pro-meta-links">
        {item.mint && <code>{item.mint}</code>}
        {item.mint && hasFeature(access, 'research.tokens') && <Link className="research-control" href={`/app/tokens/${encodeURIComponent(item.mint)}`}>{c.details}</Link>}
        {item.mint && hasFeature(access, 'research.smart_money_investigation') && <Link className="research-control" href={`/app/investigation/${encodeURIComponent(item.mint)}`}>{c.investigateLink}</Link>}
        {item.narrativeSlug && <Link href={`/app/narratives/${encodeURIComponent(item.narrativeSlug)}`}>#{item.narrativeSlug}</Link>}
      </div>
      <RuleSummary item={item} />
      {chronological.length > 1 && (
        <div className="pro-drift-box">
          <div className="pro-drift-head">
            <span>{c.driftLabel}</span>
            {supportPct !== null && <span>{c.supportRate}: <strong>{supportPct}%</strong> ({matchObsCount}/{item.observations.length})</span>}
            {priceDeltaPct !== null && (
              <span>{c.baselineDelta}: <strong data-positive={priceDeltaPct >= 0}>{priceDeltaPct >= 0 ? '+' : ''}{f.number(priceDeltaPct, 2)}%</strong></span>
            )}
          </div>
          <div className="pro-drift-strip" role="list" aria-label={c.driftLabel}>
            {chronological.map(o => (
              <span
                key={o.id}
                role="listitem"
                className="pro-drift-cell"
                data-status={o.evaluation.status}
                title={`${f.date(o.at)} · ${o.evaluation.status}`}
              />
            ))}
          </div>
        </div>
      )}
      <div className="pro-actions">
        <button className="research-control" onClick={onEdit}>{c.edit}</button>
        <button className="research-control" disabled={pending} onClick={onToggleActive}>{item.active ? c.pause : c.resume}</button>
        <button className="research-control" onClick={onAskDelete}>{c.remove}</button>
      </div>
      {deleting && (
        <div className="pro-delete">
          <p>{c.confirm}</p>
          <button className="research-control" disabled={pending} onClick={onConfirmDelete}>{c.confirmDelete}</button>
          <button className="research-control" onClick={onCancelDelete}>{c.cancel}</button>
        </div>
      )}
      {item.lastRun && (
        <>
          <p className="research-note">{c.evaluated}: {f.date(item.lastRun.at)}{item.lastRun.capped && ` · ${c.coverage}`}</p>
          <Metrics items={[{ label: c.considered, value: item.lastRun.considered }, { label: c.matchCount, value: item.lastRun.matched }, { label: c.unknownCount, value: item.lastRun.unknown }]} />
        </>
      )}
      {!item.observations.length ? <p className="research-note">{c.noObservations}</p> : (
        <details>
          <summary>{c.history}</summary>
          {item.observations.map(o => <Evidence key={o.id} mint={o.mint} at={o.at} evaluation={o.evaluation} kind={kind} />)}
        </details>
      )}
    </Section>
  );
}

function RuleSummary({ item }: { item: Monitor }) {
  const c = useCopy(), f = useFormat(), r = item.rules;
  const values = [
    [c.liquidity, r.minLiquidityUsd],
    [c.buyers, r.minIndependentBuyers],
    [c.netFlowSol, r.minNetFlowSol ?? null],
    [c.marketCapMin, r.minMarketCapUsd ?? null],
    [c.marketCapMax, r.maxMarketCapUsd ?? null],
    [c.holders, r.minHolders ?? null],
    [c.top10Pct, r.maxTop10Pct ?? null],
    [c.momentum1h, r.minPriceChange1hPct ?? null],
    [c.velocity, r.minNarrativeVelocity],
    [c.risk, r.maxRiskScore],
  ] as const;
  return <ul className="pro-rules">{values.filter(([, v]) => v !== null).map(([label, v]) => <li key={label}>{label}: <b>{f.number(v)}</b></li>)}</ul>;
}

type FormDraft = {
  name: string;
  thesis: string;
  mint: string;
  narrative: string;
  liquidity: string;
  buyers: string;
  window: string;
  velocity: string;
  risk: string;
  netFlowSol: string;
  marketCapMin: string;
  marketCapMax: string;
  holders: string;
  top10Pct: string;
  momentum1h: string;
};

function initialDraft(item?: Monitor, prefill?: { mint?: string; name?: string }): FormDraft {
  return {
    name: item?.name ?? prefill?.name ?? '',
    thesis: item?.thesis ?? '',
    mint: item?.mint ?? prefill?.mint ?? '',
    narrative: item?.narrativeSlug ?? '',
    liquidity: item?.rules.minLiquidityUsd != null ? String(item.rules.minLiquidityUsd) : '',
    buyers: item?.rules.minIndependentBuyers != null ? String(item.rules.minIndependentBuyers) : '',
    window: String(item?.rules.windowMinutes ?? 30),
    velocity: item?.rules.minNarrativeVelocity != null ? String(item.rules.minNarrativeVelocity) : '',
    risk: item?.rules.maxRiskScore != null ? String(item.rules.maxRiskScore) : '',
    netFlowSol: item?.rules.minNetFlowSol != null ? String(item.rules.minNetFlowSol) : '',
    marketCapMin: item?.rules.minMarketCapUsd != null ? String(item.rules.minMarketCapUsd) : '',
    marketCapMax: item?.rules.maxMarketCapUsd != null ? String(item.rules.maxMarketCapUsd) : '',
    holders: item?.rules.minHolders != null ? String(item.rules.minHolders) : '',
    top10Pct: item?.rules.maxTop10Pct != null ? String(item.rules.maxTop10Pct) : '',
    momentum1h: item?.rules.minPriceChange1hPct != null ? String(item.rules.minPriceChange1hPct) : '',
  };
}

function MonitorForm({
  kind, item, prefill, pending, onCancel, onSave,
}: {
  kind: 'RADAR' | 'THESIS';
  item?: Monitor;
  prefill?: { mint?: string; name?: string };
  pending: boolean;
  onCancel: () => void;
  onSave: (data: Input) => void;
}) {
  const c = useCopy();
  const [draft, setDraft] = useState<FormDraft>(() => initialDraft(item, prefill));
  const [invalid, setInvalid] = useState(false);
  const hasAdvancedInitial = Boolean(
    draft.netFlowSol || draft.marketCapMin || draft.marketCapMax || draft.holders || draft.top10Pct || draft.momentum1h,
  );
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedInitial);

  const set = <K extends keyof FormDraft>(k: K, val: string) => setDraft(prev => ({ ...prev, [k]: val }));

  const applyBlueprint = (patch: Partial<FormDraft>, openAdv = true) => {
    setDraft(prev => ({ ...prev, ...patch }));
    if (openAdv) setShowAdvanced(true);
    setInvalid(false);
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const num = (raw: string) => raw.trim() === '' ? null : Number(raw);
    const rulesPayload = cleanRules({
      minLiquidityUsd: num(draft.liquidity),
      minIndependentBuyers: num(draft.buyers),
      windowMinutes: num(draft.window) as number,
      minNarrativeVelocity: num(draft.velocity),
      maxRiskScore: num(draft.risk),
      minNetFlowSol: num(draft.netFlowSol),
      minMarketCapUsd: num(draft.marketCapMin),
      maxMarketCapUsd: num(draft.marketCapMax),
      minHolders: num(draft.holders),
      maxTop10Pct: num(draft.top10Pct),
      minPriceChange1hPct: num(draft.momentum1h),
    });
    const parsed = ResearchMonitorInputSchema.safeParse({
      name: draft.name,
      thesis: draft.thesis,
      mint: draft.mint.trim() || null,
      narrativeSlug: draft.narrative.trim() || null,
      active: item?.active ?? true,
      rules: rulesPayload,
    });
    if (!parsed.success || (kind === 'THESIS' && (!parsed.data.mint || !parsed.data.thesis.trim()))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave({ ...parsed.data, rules: cleanRules(parsed.data.rules) });
  }

  return (
    <Section title={item ? c.edit : kind === 'RADAR' ? c.newRadar : c.newThesis}>
      <div className="pro-blueprints">
        <p className="pro-blueprint-title"><strong>{c.blueprintsTitle}</strong> · <small>{c.blueprintsHint}</small></p>
        <div className="pro-pills">
          {kind === 'RADAR' ? (
            <>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ name: draft.name || c.radarBlueprints.smAccum.name, liquidity: '35000', buyers: '2', window: '30', netFlowSol: '3', marketCapMin: '50000', marketCapMax: '1000000', top10Pct: '60', risk: '45' })}>{c.radarBlueprints.smAccum.label}</button>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ name: draft.name || c.radarBlueprints.narrativeBreakout.name, liquidity: '75000', velocity: '2.5', momentum1h: '12', holders: '150', risk: '50', window: '30' })}>{c.radarBlueprints.narrativeBreakout.label}</button>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ name: draft.name || c.radarBlueprints.whaleFlow.name, liquidity: '100000', buyers: '3', netFlowSol: '8', holders: '200', top10Pct: '55', window: '45' })}>{c.radarBlueprints.whaleFlow.label}</button>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ name: draft.name || c.radarBlueprints.antiRug.name, liquidity: '250000', holders: '400', top10Pct: '40', risk: '30', window: '30' })}>{c.radarBlueprints.antiRug.label}</button>
            </>
          ) : (
            <>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ thesis: draft.thesis || c.thesisBlueprints.accumulation.thesis, liquidity: '50000', buyers: '2', top10Pct: '60', risk: '45', window: '30' })}>{c.thesisBlueprints.accumulation.label}</button>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ thesis: draft.thesis || c.thesisBlueprints.continuation.thesis, liquidity: '100000', velocity: '2', momentum1h: '-10', risk: '50', window: '30' })}>{c.thesisBlueprints.continuation.label}</button>
              <button type="button" className="research-control" onClick={() => applyBlueprint({ thesis: draft.thesis || c.thesisBlueprints.invalidation.thesis, liquidity: '150000', holders: '250', top10Pct: '55', risk: '40', window: '30' })}>{c.thesisBlueprints.invalidation.label}</button>
            </>
          )}
        </div>
      </div>
      <form className="pro-form" onSubmit={submit}>
        <label>{c.name}<input name="name" required maxLength={80} value={draft.name} onChange={e => set('name', e.target.value)} /></label>
        {kind === 'THESIS' && <label className="pro-wide">{c.rationale}<textarea name="thesis" required maxLength={1000} rows={3} value={draft.thesis} onChange={e => set('thesis', e.target.value)} /></label>}
        <label className="pro-wide">{c.mint}<input name="mint" required={kind === 'THESIS'} maxLength={44} value={draft.mint} onChange={e => set('mint', e.target.value)} spellCheck={false} />{kind === 'RADAR' && <small>{c.mintHint}</small>}</label>
        <label className="pro-wide">{c.narrative}<input name="narrative" maxLength={128} value={draft.narrative} onChange={e => set('narrative', e.target.value)} /><small>{c.narrativeHint}</small></label>
        <fieldset className="pro-wide pro-form">
          <legend>{c.conditions}</legend>
          <p className="research-note pro-wide">{c.optional}</p>
          <label>{c.liquidity}<input name="liquidity" type="number" min="0" max="1000000000000" step="any" value={draft.liquidity} onChange={e => set('liquidity', e.target.value)} /></label>
          <label>{c.buyers}<input name="buyers" type="number" min="1" max="100" step="1" value={draft.buyers} onChange={e => set('buyers', e.target.value)} /></label>
          <label>{c.window}<input name="window" type="number" required min="5" max="60" step="1" value={draft.window} onChange={e => set('window', e.target.value)} /></label>
          <label>{c.velocity}<input name="velocity" type="number" min="0" max="1000000" step="any" value={draft.velocity} onChange={e => set('velocity', e.target.value)} /></label>
          <label>{c.risk}<input name="risk" type="number" min="0" max="100" step="any" value={draft.risk} onChange={e => set('risk', e.target.value)} /></label>
          <div className="pro-wide">
            <button type="button" className="research-control" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(v => !v)}>{c.advancedConditions}</button>
          </div>
          {showAdvanced && (
            <>
              <label>{c.netFlowSol}<input name="netFlowSol" type="number" min="0.01" max="1000000" step="any" value={draft.netFlowSol} onChange={e => set('netFlowSol', e.target.value)} /></label>
              <label>{c.marketCapMin}<input name="marketCapMin" type="number" min="0" max="1000000000000" step="any" value={draft.marketCapMin} onChange={e => set('marketCapMin', e.target.value)} /></label>
              <label>{c.marketCapMax}<input name="marketCapMax" type="number" min="1" max="1000000000000" step="any" value={draft.marketCapMax} onChange={e => set('marketCapMax', e.target.value)} /></label>
              <label>{c.holders}<input name="holders" type="number" min="1" max="1000000000" step="1" value={draft.holders} onChange={e => set('holders', e.target.value)} /></label>
              <label>{c.top10Pct}<input name="top10Pct" type="number" min="0.1" max="100" step="any" value={draft.top10Pct} onChange={e => set('top10Pct', e.target.value)} /></label>
              <label>{c.momentum1h}<input name="momentum1h" type="number" min="-99.9" max="1000000" step="any" value={draft.momentum1h} onChange={e => set('momentum1h', e.target.value)} /></label>
            </>
          )}
        </fieldset>
        <p className="research-note pro-wide">{c.evidenceNote}</p>
        {invalid && <p className="pro-wide" role="alert">{c.errors.INVALID_INPUT}</p>}
        <div className="pro-actions pro-wide">
          <button className="button button-primary" disabled={pending}>{c.save}</button>
          <button type="button" className="research-control" disabled={pending} onClick={onCancel}>{c.cancel}</button>
        </div>
      </form>
    </Section>
  );
}

function Evidence({ mint, at, evaluation, kind }: { mint: string; at: string; evaluation: ResearchEvaluation; kind: 'RADAR' | 'THESIS' }) {
  const c = useCopy(), f = useFormat(), { access } = useResearch();
  const labels: Record<ResearchCheckKey, string> = {
    liquidity: c.liquidity,
    buyers: c.buyers,
    netFlowSol: c.netFlowSol,
    marketCapMin: c.marketCapMin,
    marketCapMax: c.marketCapMax,
    holders: c.holders,
    top10Pct: c.top10Pct,
    momentum1h: c.momentum1h,
    narrative: c.velocity,
    risk: c.risk,
    token: c.token,
  };
  const status = (value: string) => value === 'MATCH' ? (kind === 'RADAR' ? c.match : c.supported) : value === 'NO_MATCH' ? c.weakened : c.uncertain;
  const passCount = evaluation.checks.filter(ch => ch.status === 'PASS').length;
  const snap = evaluation.snapshot;

  return (
    <article className="pro-evidence" data-status={evaluation.status}>
      <div className="pro-evidence-heading">
        <div className="pro-card-badges">
          <strong>{status(evaluation.status)}</strong>
          {evaluation.checks.length > 0 && <span className="pro-mini-badge">{passCount}/{evaluation.checks.length} {c.checksMet.toLowerCase()}</span>}
          {evaluation.previousStatus && evaluation.previousStatus !== evaluation.status && (
            <span className="pro-transition-badge">{status(evaluation.previousStatus)} → {status(evaluation.status)}</span>
          )}
        </div>
        <time dateTime={at}>{f.date(at)}</time>
      </div>
      <div className="pro-meta-links">
        <Link className="pro-token-link" href={`/app/tokens/${encodeURIComponent(mint)}`}>
          {c.details} · {snap?.symbol ? <strong>{snap.symbol}</strong> : null} <code>{mint}</code>
        </Link>
        {hasFeature(access, 'research.smart_money_investigation') && (
          <Link className="pro-token-link" href={`/app/investigation/${encodeURIComponent(mint)}`}>{c.investigateLink} · {shortMint(mint)}</Link>
        )}
      </div>
      {evaluation.previousStatus && evaluation.previousStatus !== evaluation.status && <p className="research-note">{c.previous}: {status(evaluation.previousStatus)}</p>}
      <ul>
        {evaluation.checks.map(check => {
          const margin = checkMarginPct(check.key, check.value, check.threshold);
          return (
            <li key={check.key}>
              <div className="pro-check-line">
                <span>
                  <b>{labels[check.key]}</b>: {check.status === 'PASS' ? c.pass : check.status === 'FAIL' ? c.fail : c.unknownCheck} · {f.number(check.value)} / {c.threshold}: {f.number(check.threshold)}
                </span>
                {margin !== null && (
                  <span className="pro-margin-pill" data-pass={margin >= 0}>
                    {margin >= 0 ? `+${f.number(margin, 1)}% ${c.bufferLabel}` : `${f.number(margin, 1)}% ${c.shortfallLabel}`}
                  </span>
                )}
              </div>
              <p className="research-note">{c.observed}: {f.date(check.at)} · {c.source}: {check.source ?? c.unknownCheck}</p>
              {!!check.refs.length && <details><summary>{c.refs}</summary><ul>{check.refs.map((ref, index) => <li key={`${index}:${ref}`}><code>{ref}</code></li>)}</ul></details>}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

export function PersonalBriefingPage() {
  const { access } = useResearch();
  return hasFeature(access, 'research.personal_briefing') ? <Briefings /> : <Locked tier={access.features['research.personal_briefing']?.requiredTier ?? 'PRO'} />;
}

function BriefTrendBoard({ briefs }: { briefs: Brief[] }) {
  const c = useCopy();
  if (briefs.length < 2) return null;
  const ordered = [...briefs].reverse();
  const maxTotal = Math.max(1, ...ordered.map(b => b.radarMatches + b.thesisChanges + b.unknown));
  return (
    <Section title={c.trendTitle}>
      <div className="pro-trend-grid">
        {ordered.map(b => {
          const total = b.radarMatches + b.thesisChanges + b.unknown;
          const pct = Math.max(8, Math.round((total / maxTotal) * 100));
          return (
            <div key={b.day} className="pro-trend-col">
              <div className="pro-trend-bar-wrap"><div className="pro-trend-bar" style={{ height: `${pct}%` }} /></div>
              <strong>{b.day.slice(5)}</strong>
              <small>{b.radarMatches}R · {b.thesisChanges}T</small>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Briefings() {
  const c = useCopy(), f = useFormat(), { send } = useResearch();
  const [triage, setTriage] = useState<'ALL' | 'WEAKENED' | 'TRANSITIONS' | 'RADAR' | 'UNKNOWN'>('ALL');
  const query = useResearchQuery('personal-research/briefings', PersonalBriefsSchema, true, 60_000);
  const refresh = useMutation({ mutationFn: () => send('personal-research/briefings/refresh', Refreshed, 'POST'), onSuccess: () => query.refetch() });

  const briefs = query.data?.items ?? [];
  const latestBrief = briefs[0];
  const latestTransitions = latestBrief ? latestBrief.items.filter(i => i.previousStatus && i.previousStatus !== i.evaluation.status).length : 0;
  const latestWeakened = latestBrief ? latestBrief.items.filter(i => i.evaluation.status === 'NO_MATCH').length : 0;

  const filterBriefItems = (items: Brief['items']) => items.filter(i => {
    if (triage === 'WEAKENED') return i.evaluation.status === 'NO_MATCH';
    if (triage === 'TRANSITIONS') return Boolean(i.previousStatus && i.previousStatus !== i.evaluation.status);
    if (triage === 'RADAR') return i.kind === 'RADAR';
    if (triage === 'UNKNOWN') return i.evaluation.status === 'UNKNOWN';
    return true;
  });

  return (
    <div className="pro-workspace">
      <p className="pro-eyebrow">{c.eyebrow}</p>
      <PageHeading title={c.briefing} body={c.briefingBody} actions={<button className="research-control" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? c.refreshing : c.refresh}</button>} />
      <div className="pro-actions"><Link className="research-control" href="/app/personal-radar">{c.newRadar}</Link><Link className="research-control" href="/app/theses">{c.newThesis}</Link><Link className="research-control" href="/app/investigation">{c.investigation}</Link></div>
      <p className="research-note">{c.historical}</p>
      {refresh.isError && <ResourceError error={refresh.error} retry={() => refresh.mutate()} />}
      {refresh.isSuccess && <p role="status">{c.checked}</p>}
      {query.isError ? <ResourceError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <Loading /> : !briefs.length ? <Empty body={c.noBrief} /> : (
        <>
          <BriefTrendBoard briefs={briefs} />
          <div className="pro-pills">
            {([
              ['ALL', c.triageAll],
              ['WEAKENED', `${c.triageWeakened}${latestWeakened ? ` (${latestWeakened})` : ''}`],
              ['TRANSITIONS', `${c.triageTransitions}${latestTransitions ? ` (${latestTransitions})` : ''}`],
              ['RADAR', c.triageRadars],
              ['UNKNOWN', c.triageUnknown],
            ] as const).map(([val, label]) => (
              <button key={val} type="button" className="research-control" aria-pressed={triage === val} onClick={() => setTriage(val)}>{label}</button>
            ))}
          </div>
          <Section title={c.recentBriefs}>
            {briefs.map((brief, index) => {
              const filtered = filterBriefItems(brief.items);
              const flips = brief.items.filter(i => i.previousStatus && i.previousStatus !== i.evaluation.status).length;
              return (
                <details className="pro-brief" key={brief.day} open={index === 0}>
                  <summary>{brief.day} · {c.generated}: {f.date(brief.generatedAt)}</summary>
                  <p className="research-note">{c.since}: {f.date(brief.since)}{brief.capped && ` · ${c.coverage}`}</p>
                  <Metrics items={[
                    { label: c.matches, value: brief.radarMatches },
                    { label: c.changes, value: brief.thesisChanges },
                    { label: c.transitionsCount, value: flips },
                    { label: c.unknown, value: brief.unknown },
                  ]} />
                  {!filtered.length ? <p>{c.noBrief}</p> : filtered.map(item => (
                    <div key={`${item.monitorId}:${item.mint}`}>
                      <h3><Link href={item.kind === 'RADAR' ? '/app/personal-radar' : '/app/theses'}>{item.name}</Link></h3>
                      <Evidence {...item} />
                    </div>
                  ))}
                </details>
              );
            })}
          </Section>
        </>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Compass,
  FileText,
  Filter,
  Flame,
  Layers,
  Plus,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Wallet,
} from 'lucide-react';
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
import { Loading, Locked, Metrics, PageHeading, ResourceError, Section, useFormat } from '../research/ui';
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

type BlueprintCardDef = {
  id: string;
  label: string;
  summary: string;
  specs: readonly string[];
  icon: typeof Radar;
  patch: Partial<FormDraft>;
};

function useBlueprints(kind: 'RADAR' | 'THESIS'): BlueprintCardDef[] {
  const c = useCopy();
  if (kind === 'RADAR') {
    return [
      {
        id: 'smAccum',
        label: c.radarBlueprints.smAccum.label,
        summary: c.radarBlueprints.smAccum.summary,
        specs: c.radarBlueprints.smAccum.specs,
        icon: Wallet,
        patch: { name: c.radarBlueprints.smAccum.name, liquidity: '35000', buyers: '2', window: '30', netFlowSol: '3', marketCapMin: '50000', marketCapMax: '1000000', top10Pct: '60', risk: '45' },
      },
      {
        id: 'narrativeBreakout',
        label: c.radarBlueprints.narrativeBreakout.label,
        summary: c.radarBlueprints.narrativeBreakout.summary,
        specs: c.radarBlueprints.narrativeBreakout.specs,
        icon: Flame,
        patch: { name: c.radarBlueprints.narrativeBreakout.name, liquidity: '75000', velocity: '2.5', momentum1h: '12', holders: '150', risk: '50', window: '30' },
      },
      {
        id: 'whaleFlow',
        label: c.radarBlueprints.whaleFlow.label,
        summary: c.radarBlueprints.whaleFlow.summary,
        specs: c.radarBlueprints.whaleFlow.specs,
        icon: Compass,
        patch: { name: c.radarBlueprints.whaleFlow.name, liquidity: '100000', buyers: '3', netFlowSol: '8', holders: '200', top10Pct: '55', window: '45' },
      },
      {
        id: 'antiRug',
        label: c.radarBlueprints.antiRug.label,
        summary: c.radarBlueprints.antiRug.summary,
        specs: c.radarBlueprints.antiRug.specs,
        icon: ShieldCheck,
        patch: { name: c.radarBlueprints.antiRug.name, liquidity: '250000', holders: '400', top10Pct: '40', risk: '30', window: '30' },
      },
    ];
  }
  return [
    {
      id: 'accumulation',
      label: c.thesisBlueprints.accumulation.label,
      summary: c.thesisBlueprints.accumulation.summary,
      specs: c.thesisBlueprints.accumulation.specs,
      icon: Wallet,
      patch: { thesis: c.thesisBlueprints.accumulation.thesis, liquidity: '50000', buyers: '2', top10Pct: '60', risk: '45', window: '30' },
    },
    {
      id: 'continuation',
      label: c.thesisBlueprints.continuation.label,
      summary: c.thesisBlueprints.continuation.summary,
      specs: c.thesisBlueprints.continuation.specs,
      icon: Activity,
      patch: { thesis: c.thesisBlueprints.continuation.thesis, liquidity: '100000', velocity: '2', momentum1h: '-10', risk: '50', window: '30' },
    },
    {
      id: 'invalidation',
      label: c.thesisBlueprints.invalidation.label,
      summary: c.thesisBlueprints.invalidation.summary,
      specs: c.thesisBlueprints.invalidation.specs,
      icon: ShieldCheck,
      patch: { thesis: c.thesisBlueprints.invalidation.thesis, liquidity: '150000', holders: '250', top10Pct: '55', risk: '40', window: '30' },
    },
  ];
}

function ProSuiteBar({ current }: { current: 'RADAR' | 'THESIS' | 'BRIEF' }) {
  const c = useCopy();
  return (
    <div className="pro-suite-bar">
      <span className="pro-eyebrow"><Sparkles size={13} aria-hidden="true" />{c.eyebrow}</span>
      <nav className="pro-suite-nav" aria-label={c.eyebrow}>
        <Link href="/app/personal-radar" className="pro-suite-link" data-active={current === 'RADAR'}>
          <Radar size={14} aria-hidden="true" /><span>{c.radar}</span>
        </Link>
        <Link href="/app/theses" className="pro-suite-link" data-active={current === 'THESIS'}>
          <Target size={14} aria-hidden="true" /><span>{c.thesis}</span>
        </Link>
        <Link href="/app/briefing" className="pro-suite-link" data-active={current === 'BRIEF'}>
          <FileText size={14} aria-hidden="true" /><span>{c.briefing}</span>
        </Link>
        <Link href="/app/investigation" className="pro-suite-link">
          <Search size={14} aria-hidden="true" /><span>{c.investigationNav}</span><ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </nav>
    </div>
  );
}

export function PersonalResearchPage({ kind }: { kind: 'RADAR' | 'THESIS' }) {
  const { access } = useResearch(), key = kind === 'RADAR' ? 'research.personal_radar' : 'research.thesis_tracker';
  return hasFeature(access, key) ? <MonitorPage kind={kind} /> : <Locked tier={access.features[key]?.requiredTier ?? 'PRO'} />;
}

function MonitorPage({ kind }: { kind: 'RADAR' | 'THESIS' }) {
  const c = useCopy(), f = useFormat(), { send, userId } = useResearch(), client = useQueryClient();
  const blueprints = useBlueprints(kind);
  const path = `personal-research/${kind === 'RADAR' ? 'radars' : 'theses'}`;
  const query = useResearchQuery(path, ResearchMonitorsSchema, true, 60_000);
  const [editing, setEditing] = useState<Monitor | 'new' | null>(null);
  const [prefill, setPrefill] = useState<Partial<FormDraft> | null>(null);
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
  const matchedRunsTotal = allItems.reduce((s, m) => s + (m.lastRun?.matched ?? 0), 0);
  const scannedTotal = allItems.reduce((s, m) => s + (m.lastRun?.considered ?? 0), 0);
  const capacityPct = Math.min(100, Math.round((activeCount / 20) * 100));

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

  const launchBlueprint = (patch: Partial<FormDraft>) => {
    mutation.reset();
    setPrefill(patch);
    setEditing('new');
  };

  const steps = kind === 'RADAR' ? c.radarSteps : c.thesisSteps;

  return (
    <div className="pro-workspace">
      <ProSuiteBar current={kind} />

      <PageHeading
        title={kind === 'RADAR' ? c.radar : c.thesis}
        body={kind === 'RADAR' ? c.radarBody : c.thesisBody}
        actions={
          <div className="pro-actions">
            <button className="research-control pro-icon-btn" disabled={check.isPending} onClick={() => check.mutate()}>
              <RefreshCw size={14} className={check.isPending ? 'pro-spin' : undefined} aria-hidden="true" />
              <span>{check.isPending ? c.refreshing : c.refresh}</span>
            </button>
            <button
              className="button button-primary pro-icon-btn"
              onClick={() => { mutation.reset(); setPrefill(null); setEditing('new'); }}
            >
              <Plus size={15} aria-hidden="true" />
              <span>{kind === 'RADAR' ? c.newRadar : c.newThesis}</span>
            </button>
          </div>
        }
      />

      <div className="pro-meta-banner">
        <Clock size={14} aria-hidden="true" />
        <span>{c.limit}</span>
      </div>

      {check.isSuccess && <p className="pro-toast" role="status"><CheckCircle2 size={15} aria-hidden="true" /><span>{c.checked}</span></p>}
      {error && <p className="pro-alert" role="alert"><AlertTriangle size={15} aria-hidden="true" /><span>{c.errors[error instanceof ApiError ? error.code : 'default'] ?? c.errors.default}</span></p>}

      {!query.isError && !query.isPending && (
        <div className="pro-kpi-grid">
          <div className="pro-kpi-card">
            <div className="pro-kpi-head"><Layers size={15} aria-hidden="true" /><span>{c.kpiActive}</span></div>
            <strong className="pro-kpi-value">{activeCount} <small>/ 20</small></strong>
            <div className="pro-kpi-meter" aria-hidden="true"><span style={{ width: `${capacityPct}%` }} /></div>
          </div>
          {kind === 'THESIS' ? (
            <>
              <div className="pro-kpi-card" data-tone={supportedCount > 0 ? 'pos' : undefined}>
                <div className="pro-kpi-head"><CheckCircle2 size={15} aria-hidden="true" /><span>{c.kpiSupported}</span></div>
                <strong className="pro-kpi-value">{supportedCount}</strong>
              </div>
              <div className="pro-kpi-card" data-tone={weakenedCount > 0 ? 'neg' : undefined}>
                <div className="pro-kpi-head"><AlertTriangle size={15} aria-hidden="true" /><span>{c.kpiWeakened}</span></div>
                <strong className="pro-kpi-value">{weakenedCount}</strong>
              </div>
              <div className="pro-kpi-card">
                <div className="pro-kpi-head"><Clock size={15} aria-hidden="true" /><span>{c.kpiUnknown}</span></div>
                <strong className="pro-kpi-value">{unknownCount}</strong>
              </div>
            </>
          ) : (
            <>
              <div className="pro-kpi-card" data-tone={matchedRunsTotal > 0 ? 'pos' : undefined}>
                <div className="pro-kpi-head"><Radar size={15} aria-hidden="true" /><span>{c.matchCount}</span></div>
                <strong className="pro-kpi-value">{matchedRunsTotal}</strong>
              </div>
              <div className="pro-kpi-card">
                <div className="pro-kpi-head"><Activity size={15} aria-hidden="true" /><span>{c.kpiScanned}</span></div>
                <strong className="pro-kpi-value">{f.number(scannedTotal, 0)}</strong>
              </div>
              <div className="pro-kpi-card">
                <div className="pro-kpi-head"><Clock size={15} aria-hidden="true" /><span>{c.kpiCadence}</span></div>
                <strong className="pro-kpi-value">{c.cadenceValue}</strong>
              </div>
            </>
          )}
        </div>
      )}

      {editing && (
        <MonitorForm
          key={typeof editing === 'string' ? `${editing}:${JSON.stringify(prefill ?? {})}` : editing.id}
          kind={kind}
          item={editing === 'new' ? undefined : editing}
          prefill={editing === 'new' ? prefill ?? undefined : undefined}
          pending={mutation.isPending}
          onCancel={() => { setEditing(null); setPrefill(null); }}
          onSave={data => mutation.mutate({ type: 'save', data, ...(editing === 'new' ? {} : { id: editing.id }) })}
        />
      )}

      {query.isError ? (
        <ResourceError error={query.error} retry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Loading />
      ) : (
        <>
          {!editing && (
            <Section title={c.blueprintsTitle}>
              <p className="pro-section-lead">{c.blueprintsHint}</p>
              <div className="pro-blueprint-grid">
                {blueprints.map(bp => {
                  const Icon = bp.icon;
                  return (
                    <article key={bp.id} className="pro-blueprint-card">
                      <div className="pro-blueprint-top">
                        <span className="pro-blueprint-icon"><Icon size={16} aria-hidden="true" /></span>
                        <h3>{bp.label}</h3>
                      </div>
                      <p className="pro-blueprint-summary">{bp.summary}</p>
                      <ul className="pro-spec-chips">
                        {bp.specs.map(spec => <li key={spec}>{spec}</li>)}
                      </ul>
                      <button
                        type="button"
                        className="research-control pro-blueprint-cta"
                        onClick={() => launchBlueprint(bp.patch)}
                      >
                        <Sparkles size={13} aria-hidden="true" />
                        <span>{bp.label}</span>
                      </button>
                    </article>
                  );
                })}
              </div>
            </Section>
          )}

          {!allItems.length ? (
            <div className="pro-launchpad">
              <div className="pro-workflow-grid">
                {steps.map(s => (
                  <div key={s.step} className="pro-workflow-step">
                    <b>{s.step}</b>
                    <strong>{s.title}</strong>
                    <p>{s.body}</p>
                  </div>
                ))}
              </div>
              <p className="pro-launchpad-note">{kind === 'RADAR' ? c.noRadars : c.noTheses}</p>
            </div>
          ) : (
            <>
              {allItems.length > 1 && (
                <div className="pro-filter-bar">
                  <div className="pro-pills">
                    <Filter size={14} className="pro-muted-icon" aria-hidden="true" />
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
                    <Search size={14} aria-hidden="true" />
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
        </>
      )}
    </div>
  );
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
          <span className="pro-state" data-active={item.active}>{item.active ? c.active : c.paused}</span>
        </div>
      }
    >
      {item.thesis && <p className="pro-thesis-text">{item.thesis}</p>}
      <div className="pro-meta-links">
        {item.mint && <code className="pro-mint-chip">{item.mint}</code>}
        {item.mint && hasFeature(access, 'research.tokens') && <Link className="research-control" href={`/app/tokens/${encodeURIComponent(item.mint)}`}>{c.details}</Link>}
        {item.mint && hasFeature(access, 'research.smart_money_investigation') && <Link className="research-control" href={`/app/investigation/${encodeURIComponent(item.mint)}`}>{c.investigateLink}</Link>}
        {item.narrativeSlug && <Link className="pro-narrative-chip" href={`/app/narratives/${encodeURIComponent(item.narrativeSlug)}`}>#{item.narrativeSlug}</Link>}
      </div>
      <RuleSummary item={item} />
      {chronological.length > 1 && (
        <div className="pro-drift-box">
          <div className="pro-drift-head">
            <span>{c.driftLabel}</span>
            <div className="pro-drift-stats">
              {supportPct !== null && <span>{c.supportRate}: <strong>{supportPct}%</strong> ({matchObsCount}/{item.observations.length})</span>}
              {priceDeltaPct !== null && (
                <span>{c.baselineDelta}: <strong className="pro-delta-val" data-positive={priceDeltaPct >= 0}>{priceDeltaPct >= 0 ? '+' : ''}{f.number(priceDeltaPct, 2)}%</strong></span>
              )}
            </div>
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
          <div className="pro-actions">
            <button className="research-control" disabled={pending} onClick={onConfirmDelete}>{c.confirmDelete}</button>
            <button className="research-control" onClick={onCancelDelete}>{c.cancel}</button>
          </div>
        </div>
      )}
      {item.lastRun && (
        <>
          <p className="research-note">{c.evaluated}: {f.date(item.lastRun.at)}{item.lastRun.capped && ` · ${c.coverage}`}</p>
          <Metrics items={[{ label: c.considered, value: item.lastRun.considered }, { label: c.matchCount, value: item.lastRun.matched }, { label: c.unknownCount, value: item.lastRun.unknown }]} />
        </>
      )}
      {!item.observations.length ? <p className="research-note">{c.noObservations}</p> : (
        <details className="pro-history-details">
          <summary>{c.history}</summary>
          <div className="pro-evidence-stack">
            {item.observations.map(o => <Evidence key={o.id} mint={o.mint} at={o.at} evaluation={o.evaluation} kind={kind} />)}
          </div>
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
  return (
    <ul className="pro-rules">
      {values.filter(([, v]) => v !== null).map(([label, v]) => (
        <li key={label}><span>{label}</span><b>{f.number(v)}</b></li>
      ))}
    </ul>
  );
}

function initialDraft(item?: Monitor, prefill?: Partial<FormDraft>): FormDraft {
  return {
    name: item?.name ?? prefill?.name ?? '',
    thesis: item?.thesis ?? prefill?.thesis ?? '',
    mint: item?.mint ?? prefill?.mint ?? '',
    narrative: item?.narrativeSlug ?? prefill?.narrative ?? '',
    liquidity: item?.rules.minLiquidityUsd != null ? String(item.rules.minLiquidityUsd) : (prefill?.liquidity ?? ''),
    buyers: item?.rules.minIndependentBuyers != null ? String(item.rules.minIndependentBuyers) : (prefill?.buyers ?? ''),
    window: String(item?.rules.windowMinutes ?? prefill?.window ?? 30),
    velocity: item?.rules.minNarrativeVelocity != null ? String(item.rules.minNarrativeVelocity) : (prefill?.velocity ?? ''),
    risk: item?.rules.maxRiskScore != null ? String(item.rules.maxRiskScore) : (prefill?.risk ?? ''),
    netFlowSol: item?.rules.minNetFlowSol != null ? String(item.rules.minNetFlowSol) : (prefill?.netFlowSol ?? ''),
    marketCapMin: item?.rules.minMarketCapUsd != null ? String(item.rules.minMarketCapUsd) : (prefill?.marketCapMin ?? ''),
    marketCapMax: item?.rules.maxMarketCapUsd != null ? String(item.rules.maxMarketCapUsd) : (prefill?.marketCapMax ?? ''),
    holders: item?.rules.minHolders != null ? String(item.rules.minHolders) : (prefill?.holders ?? ''),
    top10Pct: item?.rules.maxTop10Pct != null ? String(item.rules.maxTop10Pct) : (prefill?.top10Pct ?? ''),
    momentum1h: item?.rules.minPriceChange1hPct != null ? String(item.rules.minPriceChange1hPct) : (prefill?.momentum1h ?? ''),
  };
}

function MonitorForm({
  kind, item, prefill, pending, onCancel, onSave,
}: {
  kind: 'RADAR' | 'THESIS';
  item?: Monitor;
  prefill?: Partial<FormDraft>;
  pending: boolean;
  onCancel: () => void;
  onSave: (data: Input) => void;
}) {
  const c = useCopy();
  const blueprints = useBlueprints(kind);
  const [draft, setDraft] = useState<FormDraft>(() => initialDraft(item, prefill));
  const [invalid, setInvalid] = useState(false);
  const hasAdvancedInitial = Boolean(
    draft.netFlowSol || draft.marketCapMin || draft.marketCapMax || draft.holders || draft.top10Pct || draft.momentum1h,
  );
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedInitial);

  const set = <K extends keyof FormDraft>(k: K, val: string) => setDraft(prev => ({ ...prev, [k]: val }));

  const applyBlueprint = (patch: Partial<FormDraft>) => {
    const clearedRules: Partial<FormDraft> = {
      liquidity: '', buyers: '', window: '30', velocity: '', risk: '',
      netFlowSol: '', marketCapMin: '', marketCapMax: '', holders: '', top10Pct: '', momentum1h: '',
    };
    setDraft(prev => ({
      ...prev,
      ...clearedRules,
      ...patch,
      name: prev.name || patch.name || '',
      thesis: prev.thesis || patch.thesis || '',
    }));
    setShowAdvanced(true);
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
        <p className="pro-blueprint-title"><Sparkles size={14} aria-hidden="true" /><strong>{c.blueprintsTitle}</strong> · <small>{c.blueprintsHint}</small></p>
        <div className="pro-pills">
          {blueprints.map(bp => (
            <button key={bp.id} type="button" className="research-control" onClick={() => applyBlueprint(bp.patch)}>
              {bp.label}
            </button>
          ))}
        </div>
      </div>

      <form className="pro-form" onSubmit={submit}>
        <fieldset className="pro-wide pro-fieldset">
          <legend>{c.coreScopeLegend}</legend>
          <div className="pro-form-grid">
            <div className="pro-field">
              <label htmlFor="pro-input-name">{c.name}</label>
              <input id="pro-input-name" name="name" required maxLength={80} value={draft.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="pro-field">
              <label htmlFor="pro-input-narrative">{c.narrative}</label>
              <input id="pro-input-narrative" name="narrative" maxLength={128} value={draft.narrative} onChange={e => set('narrative', e.target.value)} />
              <small>{c.narrativeHint}</small>
            </div>
            <div className="pro-field pro-wide">
              <label htmlFor="pro-input-mint">{c.mint}</label>
              <input id="pro-input-mint" name="mint" required={kind === 'THESIS'} maxLength={44} value={draft.mint} onChange={e => set('mint', e.target.value)} spellCheck={false} />
              {kind === 'RADAR' && <small>{c.mintHint}</small>}
            </div>
            {kind === 'THESIS' && (
              <div className="pro-field pro-wide">
                <label htmlFor="pro-input-thesis">{c.rationale}</label>
                <textarea id="pro-input-thesis" name="thesis" required maxLength={1000} rows={3} value={draft.thesis} onChange={e => set('thesis', e.target.value)} />
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="pro-wide pro-fieldset">
          <legend>{c.conditions}</legend>
          <p className="research-note">{c.optional}</p>
          <div className="pro-form-grid">
            <div className="pro-field">
              <label htmlFor="pro-input-liquidity">{c.liquidity}</label>
              <input id="pro-input-liquidity" name="liquidity" type="number" min="0" max="1000000000000" step="any" value={draft.liquidity} onChange={e => set('liquidity', e.target.value)} />
            </div>
            <div className="pro-field">
              <label htmlFor="pro-input-buyers">{c.buyers}</label>
              <input id="pro-input-buyers" name="buyers" type="number" min="1" max="100" step="1" value={draft.buyers} onChange={e => set('buyers', e.target.value)} />
            </div>
            <div className="pro-field">
              <label htmlFor="pro-input-window">{c.window}</label>
              <input id="pro-input-window" name="window" type="number" required min="5" max="60" step="1" value={draft.window} onChange={e => set('window', e.target.value)} />
            </div>
            <div className="pro-field">
              <label htmlFor="pro-input-velocity">{c.velocity}</label>
              <input id="pro-input-velocity" name="velocity" type="number" min="0" max="1000000" step="any" value={draft.velocity} onChange={e => set('velocity', e.target.value)} />
            </div>
            <div className="pro-field">
              <label htmlFor="pro-input-risk">{c.risk}</label>
              <input id="pro-input-risk" name="risk" type="number" min="0" max="100" step="any" value={draft.risk} onChange={e => set('risk', e.target.value)} />
            </div>
          </div>

          <div className="pro-advanced-toggle">
            <button type="button" className="research-control pro-icon-btn" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(v => !v)}>
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>{c.advancedConditions}</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="pro-form-grid pro-advanced-grid">
              <div className="pro-field">
                <label htmlFor="pro-input-netflow">{c.netFlowSol}</label>
                <input id="pro-input-netflow" name="netFlowSol" type="number" min="0.01" max="1000000" step="any" value={draft.netFlowSol} onChange={e => set('netFlowSol', e.target.value)} />
              </div>
              <div className="pro-field">
                <label htmlFor="pro-input-mcap-min">{c.marketCapMin}</label>
                <input id="pro-input-mcap-min" name="marketCapMin" type="number" min="0" max="1000000000000" step="any" value={draft.marketCapMin} onChange={e => set('marketCapMin', e.target.value)} />
              </div>
              <div className="pro-field">
                <label htmlFor="pro-input-mcap-max">{c.marketCapMax}</label>
                <input id="pro-input-mcap-max" name="marketCapMax" type="number" min="1" max="1000000000000" step="any" value={draft.marketCapMax} onChange={e => set('marketCapMax', e.target.value)} />
              </div>
              <div className="pro-field">
                <label htmlFor="pro-input-holders">{c.holders}</label>
                <input id="pro-input-holders" name="holders" type="number" min="1" max="1000000000" step="1" value={draft.holders} onChange={e => set('holders', e.target.value)} />
              </div>
              <div className="pro-field">
                <label htmlFor="pro-input-top10">{c.top10Pct}</label>
                <input id="pro-input-top10" name="top10Pct" type="number" min="0.1" max="100" step="any" value={draft.top10Pct} onChange={e => set('top10Pct', e.target.value)} />
              </div>
              <div className="pro-field">
                <label htmlFor="pro-input-mom1h">{c.momentum1h}</label>
                <input id="pro-input-mom1h" name="momentum1h" type="number" min="-99.9" max="1000000" step="any" value={draft.momentum1h} onChange={e => set('momentum1h', e.target.value)} />
              </div>
            </div>
          )}
        </fieldset>

        <p className="research-note pro-wide">{c.evidenceNote}</p>
        {invalid && <p className="pro-alert pro-wide" role="alert"><AlertTriangle size={15} aria-hidden="true" /><span>{c.errors.INVALID_INPUT}</span></p>}
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
          <strong className="pro-status-pill" data-status={evaluation.status}>{status(evaluation.status)}</strong>
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
      <ul className="pro-check-list">
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
  if (!briefs.length) return null;
  const ordered = [...briefs].reverse();
  const maxTotal = Math.max(1, ...ordered.map(b => b.radarMatches + b.thesisChanges + b.unknown));
  return (
    <Section title={c.trendTitle}>
      <div className="pro-trend-grid">
        {ordered.map(b => {
          const total = b.radarMatches + b.thesisChanges + b.unknown;
          const pct = total === 0 ? 10 : Math.max(16, Math.round((total / maxTotal) * 100));
          return (
            <div key={b.day} className="pro-trend-col">
              <div className="pro-trend-bar-wrap"><div className="pro-trend-bar" data-quiet={total === 0} style={{ height: `${pct}%` }} /></div>
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
  const totalMatches7d = briefs.reduce((s, b) => s + b.radarMatches, 0);
  const totalChanges7d = briefs.reduce((s, b) => s + b.thesisChanges, 0);
  const hasAnyItems = briefs.some(b => b.items.length > 0);

  const filterBriefItems = (items: Brief['items']) => items.filter(i => {
    if (triage === 'WEAKENED') return i.evaluation.status === 'NO_MATCH';
    if (triage === 'TRANSITIONS') return Boolean(i.previousStatus && i.previousStatus !== i.evaluation.status);
    if (triage === 'RADAR') return i.kind === 'RADAR';
    if (triage === 'UNKNOWN') return i.evaluation.status === 'UNKNOWN';
    return true;
  });

  return (
    <div className="pro-workspace">
      <ProSuiteBar current="BRIEF" />

      <PageHeading
        title={c.briefing}
        body={c.briefingBody}
        actions={
          <button className="research-control pro-icon-btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw size={14} className={refresh.isPending ? 'pro-spin' : undefined} aria-hidden="true" />
            <span>{refresh.isPending ? c.refreshing : c.refresh}</span>
          </button>
        }
      />

      <div className="pro-meta-banner">
        <Clock size={14} aria-hidden="true" />
        <span>{c.historical}</span>
      </div>

      {refresh.isError && <ResourceError error={refresh.error} retry={() => refresh.mutate()} />}
      {refresh.isSuccess && <p className="pro-toast" role="status"><CheckCircle2 size={15} aria-hidden="true" /><span>{c.checked}</span></p>}

      {!query.isError && !query.isPending && (
        <div className="pro-kpi-grid">
          <div className="pro-kpi-card" data-tone={totalMatches7d > 0 ? 'pos' : undefined}>
            <div className="pro-kpi-head"><Radar size={15} aria-hidden="true" /><span>{c.matches}</span></div>
            <strong className="pro-kpi-value">{latestBrief?.radarMatches ?? 0}</strong>
          </div>
          <div className="pro-kpi-card" data-tone={totalChanges7d > 0 ? 'accent' : undefined}>
            <div className="pro-kpi-head"><Activity size={15} aria-hidden="true" /><span>{c.changes}</span></div>
            <strong className="pro-kpi-value">{latestBrief?.thesisChanges ?? 0}</strong>
          </div>
          <div className="pro-kpi-card" data-tone={latestWeakened > 0 ? 'neg' : undefined}>
            <div className="pro-kpi-head"><AlertTriangle size={15} aria-hidden="true" /><span>{c.weakenedCount}</span></div>
            <strong className="pro-kpi-value">{latestWeakened}</strong>
          </div>
          <div className="pro-kpi-card">
            <div className="pro-kpi-head"><FileText size={15} aria-hidden="true" /><span>{c.briefEditions}</span></div>
            <strong className="pro-kpi-value">{briefs.length} <small>/ 7</small></strong>
          </div>
        </div>
      )}

      {query.isError ? (
        <ResourceError error={query.error} retry={() => void query.refetch()} />
      ) : query.isPending ? (
        <Loading />
      ) : (
        <>
          <BriefTrendBoard briefs={briefs} />

          {!hasAnyItems && (
            <div className="pro-launchpad">
              <div className="pro-workflow-grid">
                {c.briefSteps.map(s => (
                  <div key={s.step} className="pro-workflow-step">
                    <b>{s.step}</b>
                    <strong>{s.title}</strong>
                    <p>{s.body}</p>
                  </div>
                ))}
              </div>
              <div className="pro-launchpad-cta-row">
                <p className="pro-launchpad-note">{briefs.length ? c.quietBriefBody : c.noBrief}</p>
                <div className="pro-actions">
                  <Link className="button button-primary pro-icon-btn" href="/app/personal-radar"><Radar size={14} aria-hidden="true" /><span>{c.newRadar}</span></Link>
                  <Link className="research-control pro-icon-btn" href="/app/theses"><Target size={14} aria-hidden="true" /><span>{c.newThesis}</span></Link>
                  <Link className="research-control pro-icon-btn" href="/app/investigation"><Search size={14} aria-hidden="true" /><span>{c.investigation}</span></Link>
                </div>
              </div>
            </div>
          )}

          {briefs.length > 0 && (
            <>
              <div className="pro-filter-bar">
                <div className="pro-pills">
                  <Filter size={14} className="pro-muted-icon" aria-hidden="true" />
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
              </div>

              <Section title={c.recentBriefs}>
                <div className="pro-brief-list">
                  {briefs.map((brief, index) => {
                    const filtered = filterBriefItems(brief.items);
                    const flips = brief.items.filter(i => i.previousStatus && i.previousStatus !== i.evaluation.status).length;
                    return (
                      <details className="pro-brief" key={brief.day} open={index === 0}>
                        <summary>
                          <span className="pro-brief-day">{brief.day}</span>
                          <span className="pro-brief-meta">{c.generated}: {f.date(brief.generatedAt)} · {brief.radarMatches}R / {brief.thesisChanges}T</span>
                        </summary>
                        <div className="pro-brief-body">
                          <p className="research-note">{c.since}: {f.date(brief.since)}{brief.capped && ` · ${c.coverage}`}</p>
                          <Metrics items={[
                            { label: c.matches, value: brief.radarMatches },
                            { label: c.changes, value: brief.thesisChanges },
                            { label: c.transitionsCount, value: flips },
                            { label: c.unknown, value: brief.unknown },
                          ]} />
                          {!filtered.length ? (
                            <p className="pro-quiet-note">{c.quietBriefTitle}</p>
                          ) : (
                            <div className="pro-evidence-stack">
                              {filtered.map(item => (
                                <div key={`${item.monitorId}:${item.mint}`} className="pro-brief-item">
                                  <h3><Link href={item.kind === 'RADAR' ? '/app/personal-radar' : '/app/theses'}>{item.name}</Link></h3>
                                  <Evidence {...item} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

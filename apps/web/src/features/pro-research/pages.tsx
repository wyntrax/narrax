'use client';
import { useState, type FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PersonalBriefsSchema, ResearchMonitorInputSchema, ResearchMonitorSchema, ResearchMonitorsSchema, type ResearchEvaluation } from '@narra/shared';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { hasFeature, useResearch, useResearchQuery } from '../research/session';
import { Empty, Loading, Locked, Metrics, PageHeading, ResourceError, Section, useFormat } from '../research/ui';
import { proCopy } from './copy';
import './pro-research.css';

type Monitor = z.infer<typeof ResearchMonitorSchema>;
type Input = z.infer<typeof ResearchMonitorInputSchema>;
const Ok = z.object({ ok: z.literal(true) }), Id = z.object({ id: z.string() }), Refreshed = z.object({ queued: z.literal(true) });
const useCopy = () => proCopy[useLocale() === 'id' ? 'id' : 'en'];
const inputOf = (item: Monitor): Input => ({ name: item.name, thesis: item.thesis, mint: item.mint, narrativeSlug: item.narrativeSlug, rules: item.rules, active: item.active });

export function PersonalResearchPage({ kind }: { kind: 'RADAR' | 'THESIS' }) {
  const { access } = useResearch(), key = kind === 'RADAR' ? 'research.personal_radar' : 'research.thesis_tracker';
  return hasFeature(access, key) ? <MonitorPage kind={kind} /> : <Locked tier={access.features[key]?.requiredTier ?? 'PRO'} />;
}
function MonitorPage({ kind }: { kind: 'RADAR' | 'THESIS' }) {
  const c = useCopy(), f = useFormat(), { send, userId } = useResearch(), client = useQueryClient();
  const path = `personal-research/${kind === 'RADAR' ? 'radars' : 'theses'}`;
  const query = useResearchQuery(path, ResearchMonitorsSchema, true, 60_000);
  const [editing, setEditing] = useState<Monitor | 'new' | null>(null), [deleting, setDeleting] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['research', userId, path] });
  const mutation = useMutation({ mutationFn: async (action: { type: 'save'; id?: string; data: Input } | { type: 'delete'; id: string }) => {
    if (action.type === 'delete') return send(`${path}/${encodeURIComponent(action.id)}`, Ok, 'DELETE');
    return send(action.id ? `${path}/${encodeURIComponent(action.id)}` : path, Id, action.id ? 'PUT' : 'POST', action.data);
  }, onSuccess: async () => { setEditing(null); setDeleting(null); await refresh(); } });
  const check = useMutation({ mutationFn: () => send(`${path}/refresh`, Refreshed, 'POST'), onSuccess: refresh });
  const error = mutation.error ?? check.error;
  return <div className="pro-workspace">
    <p className="pro-eyebrow">{c.eyebrow}</p>
    <PageHeading title={kind === 'RADAR' ? c.radar : c.thesis} body={kind === 'RADAR' ? c.radarBody : c.thesisBody} actions={<div className="pro-actions"><button className="research-control" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? c.refreshing : c.refresh}</button><button className="button button-primary" onClick={() => { mutation.reset(); setEditing('new'); }}>{kind === 'RADAR' ? c.newRadar : c.newThesis}</button></div>} />
    <p className="research-note">{c.limit}</p>
    {check.isSuccess && <p role="status">{c.checked}</p>}
    {error && <p role="alert">{c.errors[error instanceof ApiError ? error.code : 'default'] ?? c.errors.default}</p>}
    {editing && <MonitorForm key={typeof editing === 'string' ? editing : editing.id} kind={kind} item={editing === 'new' ? undefined : editing} pending={mutation.isPending} onCancel={() => setEditing(null)} onSave={data => mutation.mutate({ type: 'save', data, ...(editing === 'new' ? {} : { id: editing.id }) })} />}
    {query.isError ? <ResourceError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <Loading /> : !query.data.items.length ? <Empty body={kind === 'RADAR' ? c.noRadars : c.noTheses} /> : <div className="pro-monitor-list">{query.data.items.map(item => <Section key={item.id} title={item.name} action={<span className="pro-state">{item.active ? c.active : c.paused}</span>}>
      {item.thesis && <p className="pro-thesis-text">{item.thesis}</p>}
      <p className="research-note">{item.mint && <code>{item.mint}</code>}{item.narrativeSlug && <Link href={`/app/narratives/${encodeURIComponent(item.narrativeSlug)}`}> · {item.narrativeSlug}</Link>}</p>
      <RuleSummary item={item} />
      <div className="pro-actions"><button className="research-control" onClick={() => { mutation.reset(); setEditing(item); }}>{c.edit}</button><button className="research-control" disabled={mutation.isPending} onClick={() => mutation.mutate({ type: 'save', id: item.id, data: { ...inputOf(item), active: !item.active } })}>{item.active ? c.pause : c.resume}</button><button className="research-control" onClick={() => setDeleting(item.id)}>{c.remove}</button></div>
      {deleting === item.id && <div className="pro-delete"><p>{c.confirm}</p><button className="research-control" disabled={mutation.isPending} onClick={() => mutation.mutate({ type: 'delete', id: item.id })}>{c.confirmDelete}</button><button className="research-control" onClick={() => setDeleting(null)}>{c.cancel}</button></div>}
      {item.lastRun && <><p className="research-note">{c.evaluated}: {f.date(item.lastRun.at)}{item.lastRun.capped && ` · ${c.coverage}`}</p><Metrics items={[{ label: c.considered, value: item.lastRun.considered }, { label: c.matchCount, value: item.lastRun.matched }, { label: c.unknownCount, value: item.lastRun.unknown }]} /></>}
      {!item.observations.length ? <p className="research-note">{c.noObservations}</p> : <details><summary>{c.history}</summary>{item.observations.map(o => <Evidence key={o.id} mint={o.mint} at={o.at} evaluation={o.evaluation} kind={kind} />)}</details>}
    </Section>)}</div>}
  </div>;
}
function RuleSummary({ item }: { item: Monitor }) {
  const c = useCopy(), f = useFormat();
  const values = [[c.liquidity, item.rules.minLiquidityUsd], [c.buyers, item.rules.minIndependentBuyers], [c.velocity, item.rules.minNarrativeVelocity], [c.risk, item.rules.maxRiskScore]] as const;
  return <ul className="pro-rules">{values.filter(([, v]) => v !== null).map(([label, v]) => <li key={label}>{label}: <b>{f.number(v)}</b></li>)}</ul>;
}
function MonitorForm({ kind, item, pending, onCancel, onSave }: { kind: 'RADAR' | 'THESIS'; item?: Monitor; pending: boolean; onCancel: () => void; onSave: (data: Input) => void }) {
  const c = useCopy(), [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const numeric = (key: string) => String(form.get(key) ?? '').trim() === '' ? null : Number(form.get(key));
    const parsed = ResearchMonitorInputSchema.safeParse({ name: form.get('name'), thesis: form.get('thesis') ?? '', mint: String(form.get('mint') ?? '').trim() || null, narrativeSlug: String(form.get('narrative') ?? '').trim() || null,
      active: item?.active ?? true, rules: { minLiquidityUsd: numeric('liquidity'), minIndependentBuyers: numeric('buyers'), windowMinutes: numeric('window'), minNarrativeVelocity: numeric('velocity'), maxRiskScore: numeric('risk') } });
    if (!parsed.success || (kind === 'THESIS' && (!parsed.data.mint || !parsed.data.thesis.trim()))) { setInvalid(true); return; }
    setInvalid(false); onSave(parsed.data);
  }
  return <Section title={item ? c.edit : kind === 'RADAR' ? c.newRadar : c.newThesis}><form className="pro-form" onSubmit={submit}>
    <label>{c.name}<input name="name" required maxLength={80} defaultValue={item?.name} /></label>
    {kind === 'THESIS' && <label className="pro-wide">{c.rationale}<textarea name="thesis" required maxLength={1000} rows={3} defaultValue={item?.thesis} /></label>}
    <label className="pro-wide">{c.mint}<input name="mint" required={kind === 'THESIS'} maxLength={44} defaultValue={item?.mint ?? ''} spellCheck={false} />{kind === 'RADAR' && <small>{c.mintHint}</small>}</label>
    <label className="pro-wide">{c.narrative}<input name="narrative" maxLength={128} defaultValue={item?.narrativeSlug ?? ''} /><small>{c.narrativeHint}</small></label>
    <fieldset className="pro-wide pro-form"><legend>{c.conditions}</legend><p className="research-note pro-wide">{c.optional}</p>
      <label>{c.liquidity}<input name="liquidity" type="number" min="0" max="1000000000000" step="any" defaultValue={item?.rules.minLiquidityUsd ?? ''} /></label>
      <label>{c.buyers}<input name="buyers" type="number" min="1" max="100" step="1" defaultValue={item?.rules.minIndependentBuyers ?? ''} /></label>
      <label>{c.window}<input name="window" type="number" required min="5" max="60" step="1" defaultValue={item?.rules.windowMinutes ?? 30} /></label>
      <label>{c.velocity}<input name="velocity" type="number" min="0" max="1000000" step="any" defaultValue={item?.rules.minNarrativeVelocity ?? ''} /></label>
      <label>{c.risk}<input name="risk" type="number" min="0" max="100" step="any" defaultValue={item?.rules.maxRiskScore ?? ''} /></label>
    </fieldset><p className="research-note pro-wide">{c.evidenceNote}</p>
    {invalid && <p className="pro-wide" role="alert">{c.errors.INVALID_INPUT}</p>}
    <div className="pro-actions pro-wide"><button className="button button-primary" disabled={pending}>{c.save}</button><button type="button" className="research-control" disabled={pending} onClick={onCancel}>{c.cancel}</button></div>
  </form></Section>;
}
function Evidence({ mint, at, evaluation, kind }: { mint: string; at: string; evaluation: ResearchEvaluation; kind: 'RADAR' | 'THESIS' }) {
  const c = useCopy(), f = useFormat();
  const labels = { liquidity: c.liquidity, buyers: c.buyers, narrative: c.velocity, risk: c.risk, token: c.token };
  const status = (value: string) => value === 'MATCH' ? (kind === 'RADAR' ? c.match : c.supported) : value === 'NO_MATCH' ? c.weakened : c.uncertain;
  return <article className="pro-evidence" data-status={evaluation.status}><div className="pro-evidence-heading"><strong>{status(evaluation.status)}</strong><time dateTime={at}>{f.date(at)}</time></div>
    <Link className="pro-token-link" href={`/app/tokens/${encodeURIComponent(mint)}`}>{c.details} · <code>{mint}</code></Link>
    {evaluation.previousStatus && evaluation.previousStatus !== evaluation.status && <p className="research-note">{c.previous}: {status(evaluation.previousStatus)}</p>}
    <ul>{evaluation.checks.map(check => <li key={check.key}><b>{labels[check.key]}</b>: {check.status === 'PASS' ? c.pass : check.status === 'FAIL' ? c.fail : c.unknownCheck} · {f.number(check.value)} / {c.threshold}: {f.number(check.threshold)}
      <p className="research-note">{c.observed}: {f.date(check.at)} · {c.source}: {check.source ?? c.unknownCheck}</p>
      {!!check.refs.length && <details><summary>{c.refs}</summary><ul>{check.refs.map((ref, index) => <li key={`${index}:${ref}`}><code>{ref}</code></li>)}</ul></details>}
    </li>)}</ul>
  </article>;
}
export function PersonalBriefingPage() {
  const { access } = useResearch();
  return hasFeature(access, 'research.personal_briefing') ? <Briefings /> : <Locked tier={access.features['research.personal_briefing']?.requiredTier ?? 'PRO'} />;
}
function Briefings() {
  const c = useCopy(), f = useFormat(), { send } = useResearch();
  const query = useResearchQuery('personal-research/briefings', PersonalBriefsSchema, true, 60_000);
  const refresh = useMutation({ mutationFn: () => send('personal-research/briefings/refresh', Refreshed, 'POST'), onSuccess: () => query.refetch() });
  return <div className="pro-workspace"><p className="pro-eyebrow">{c.eyebrow}</p><PageHeading title={c.briefing} body={c.briefingBody} actions={<button className="research-control" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? c.refreshing : c.refresh}</button>} />
    <div className="pro-actions"><Link href="/app/personal-radar">{c.newRadar}</Link><Link href="/app/theses">{c.newThesis}</Link></div><p className="research-note">{c.historical}</p>
    {refresh.isError && <ResourceError error={refresh.error} retry={() => refresh.mutate()} />}
    {refresh.isSuccess && <p role="status">{c.checked}</p>}
    {query.isError ? <ResourceError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <Loading /> : !query.data.items.length ? <Empty body={c.noBrief} /> : <Section title={c.recentBriefs}>{query.data.items.map((brief, index) => <details className="pro-brief" key={brief.day} open={index === 0}><summary>{brief.day} · {c.generated}: {f.date(brief.generatedAt)}</summary><p className="research-note">{c.since}: {f.date(brief.since)}{brief.capped && ` · ${c.coverage}`}</p>
      <Metrics items={[{ label: c.matches, value: brief.radarMatches }, { label: c.changes, value: brief.thesisChanges }, { label: c.unknown, value: brief.unknown }]} />
      {!brief.items.length ? <p>{c.noBrief}</p> : brief.items.map(item => <div key={`${item.monitorId}:${item.mint}`}><h3><Link href={item.kind === 'RADAR' ? '/app/personal-radar' : '/app/theses'}>{item.name}</Link></h3><Evidence {...item} /></div>)}
    </details>)}</Section>}
  </div>;
}

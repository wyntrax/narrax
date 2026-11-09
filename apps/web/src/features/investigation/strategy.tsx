'use client';
import { useLocale } from 'next-intl';
import type { SmartMoneyInvestigation } from '@narra/shared';
import { Facts, Section, useFormat } from '../research/ui';
import { strategyCopy } from './strategy-copy';

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function Signature({ value }: { value: string }) {
  return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value) ? <a href={`https://solscan.io/tx/${encodeURIComponent(value)}`} target="_blank" rel="noopener noreferrer">{short(value)} ↗</a> : <code className="investigation-address">{value}</code>;
}
export function StrategyEvidence({ data }: { data: SmartMoneyInvestigation }) {
  const c = strategyCopy[useLocale() === 'id' ? 'id' : 'en'], f = useFormat(), analysis = data.strategies;
  return <Section title={c.title}><p className="research-note">{c.note}</p>{!analysis ? <p>{c.unavailable}</p> : <>
    <Facts items={[{ label: c.rules, value: analysis.rules.version }, { label: c.minimum, value: `${analysis.rules.minTrades} / ${analysis.rules.minDistinctTimes} / ${analysis.rules.minSpanMs / 60000}` }, { label: c.sample, value: `${analysis.evaluatedWallets} / ${analysis.observedTrades} / ${analysis.excludedTrades}` }, { label: c.count, value: `${analysis.items.length} / ${analysis.candidateCount}` }]} />
    {analysis.scope === 'LATEST_CAPPED_SAMPLE' && <p className="investigation-coverage">{c.capped}</p>}{analysis.truncated && <p>{c.patternsCapped}</p>}
    {!analysis.items.length ? <p>{c.empty}</p> : <div className="investigation-groups">{analysis.items.map(item => <article className="investigation-group" key={`${item.walletId}:${item.kind}`}>
      <h3>{c[item.kind]}</h3><code className="investigation-address">{data.participants.find(p => p.id === item.walletId)?.address ?? item.walletId}</code>
      <Facts items={[{ label: c.supporting, value: `${item.supportingCount} / ${item.walletTradeCount}` }, { label: c.opposing, value: item.opposingCount }, { label: c.times, value: item.distinctTimes }, { label: c.span, value: f.number(item.spanMs / 60000, 1) }, { label: c.history, value: c[item.historyStatus] }]} />
      <details className="investigation-details"><summary>{c.details}</summary><Facts items={[{ label: c.first, value: f.date(item.firstAt) }, { label: c.last, value: f.date(item.lastAt) }]} /><p>{c.examplesNote}</p>
        {([[c.examples, item.examples], [c.counterexamples, item.opposingExamples]] as const).map(([title, examples]) => <div key={title}><h4>{title} ({examples.length})</h4>{!examples.length && <p>{c.noOpposing}</p>}<ol className="investigation-timeline">{examples.map(t => <li key={t.id}><p>{c[t.side]} · <time dateTime={t.at}>{f.date(t.at)}</time></p><p className="investigation-amount">{t.amountSol ?? c.unknown} {c.sol} · {t.tokenAmount ?? c.unknown} {c.units}</p><Signature value={t.signature} /></li>)}</ol></div>)}
      </details></article>)}</div>}
  </>}</Section>;
}
export function PublicationContext({ data }: { data: SmartMoneyInvestigation }) {
  const c = strategyCopy[useLocale() === 'id' ? 'id' : 'en'], f = useFormat(), context = data.publications;
  return <Section title={c.publications}><p className="research-note">{c.publicationNote}</p><p className="research-note">{c.outcomesNote}</p>
    {!context ? <p>{c.publicationsUnavailable}</p> : <><p>{c.readAt}: {f.date(context.outcomesReadAt)}</p>{context.truncated && <p className="investigation-coverage">{c.publicationsCapped}</p>}{!context.items.length ? <p>{c.noPublications}</p> : context.items.map(item => <article className="investigation-member" key={item.id}>
      <h3>{c[item.side]} · {f.date(item.createdAt)}</h3><Facts items={[{ label: c.wallets, value: item.walletCount }, { label: c.groups, value: item.supportingGroupCount }, { label: c.net, value: <span className="investigation-amount">{item.netFlowSol ?? c.unknown}</span> }, { label: c.reference, value: item.reference?.priceUsd ?? c.unknown }, { label: c.source, value: item.reference ? `${item.reference.source} · ${f.date(item.reference.at)} · ${item.reference.metricId}` : c.unknown }]} />
      <details className="investigation-details"><summary>{c.frozen}</summary>{item.frozenEvidence.status === 'UNAVAILABLE' ? <p>{c.missing}</p> : <><p>{c.preview}: {item.frozenEvidence.walletCount} / {item.frozenEvidence.tradeCount}</p>{item.frozenEvidence.previewTruncated && <p>{c.previewCapped}</p>}<h4>{c.frozenWallets}</h4><ul>{item.frozenEvidence.wallets.map((w, i) => <li key={`${w.address}:${i}`}><code className="investigation-address">{w.address}</code>{c[w.qualification.status]} · {c.rules}: {w.qualification.rulesVersion}<p>{c.cluster}: <code>{w.clusterId ?? c.ungrouped}</code></p></li>)}</ul><h4>{c.frozenTrades}</h4><ol>{item.frozenEvidence.trades.map((t, i) => <li key={`${t.id}:${i}`}><code className="investigation-address">{t.wallet}</code><p>{c[t.side]} · {f.date(t.at)} · {f.number(t.amountSol, 9)} SOL</p><Signature value={t.signature} /></li>)}</ol></>}</details>
      <h4>{c.outcomes}</h4><div className="investigation-groups">{item.outcomes.map(outcome => <div className="investigation-group" key={outcome.horizonHours}><h5>{outcome.horizonHours}h · {c[outcome.status === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : outcome.status]}</h5><Facts items={[{ label: c.due, value: f.date(outcome.dueAt) }, { label: c.change, value: outcome.status === 'MEASURED' ? f.number(outcome.returnPct, 2) : c.unknown }, { label: c.priceAt, value: f.date(outcome.priceAt) }, { label: c.measuredAt, value: f.date(outcome.measuredAt) }, { label: c.metric, value: outcome.metricId ?? c.unknown }]} />{outcome.reason && <code className="investigation-address">{outcome.reason}</code>}</div>)}</div>
    </article>)}</>}
  </Section>;
}

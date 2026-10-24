import { parseArgs } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { createPrisma } from '@narra/database';
import { sanitizeUntrusted } from '@narra/shared';
import { createTregClient, TregNarrativeProvider, StaticProvider, TREG_ENDPOINTS, TregError, type SocialPlatform, type TregReceipt } from '@narra/narrative';
import { ingestNarratives } from '../workers/pipeline/src/narrativeIngestion';
import { createTregCliCall } from './treg-cli-call';
import { extractTokenRefs } from '@narra/narrative';
import { DexScreenerSource } from '@narra/market-data';

async function main() {
  const { values } = parseArgs({ options: {
    query: { type: 'string' }, name: { type: 'string' }, platforms: { type: 'string', default: 'x,reddit,tiktok' },
    hours: { type: 'string', default: '48' }, pages: { type: 'string', default: '1' }, 'max-cost': { type: 'string', default: '0.01' },
    cli: { type: 'boolean', default: false }, write: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    'check-mints': { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('npm run narratives:treg -- --query "Solana" [--name "Solana"] [--platforms x,reddit,tiktok] [--hours 48] [--pages 1] [--max-cost 0.01] [--cli] [--write]');
    console.log('Default: fetch a bounded hash/reference-only preview; no database writes. --cli uses your treg login. --check-mints checks up to 30 extracted mints with DEX Screener. --write imports the same observations without a second paid fetch.');
    return;
  }
  if (!values.query?.trim()) throw new TregError('QUERY_REQUIRED');
  const platforms = values.platforms.split(',').map(p => p.trim()) as SocialPlatform[];
  if (!platforms.length || platforms.some(p => !Object.hasOwn(TREG_ENDPOINTS, p)) || new Set(platforms).size !== platforms.length) throw new TregError('INVALID_TREG_PLATFORMS');
  const hours = Number(values.hours), maxCostUsd = Number(values['max-cost']);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) throw new TregError('HOURS_MUST_BE_1_TO_168');
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < .000001 || maxCostUsd > 1) throw new TregError('INVALID_TREG_MAX_COST');
  const receipts: TregReceipt[] = [];
  const onReceipt = (r: TregReceipt) => { receipts.push(r); console.log(JSON.stringify({ type: 'receipt', ...r })); };
  const call = values.cli ? createTregCliCall(maxCostUsd, onReceipt) : createTregClient({ token: process.env.TREG_TOKEN ?? '', org: process.env.TREG_ORG, maxCostUsd, onReceipt });
  const now = new Date(), since = new Date(now.getTime() - hours * 3_600_000), runId = randomUUID();
  const providers = platforms.map(platform => new TregNarrativeProvider({ platform, topics: [{ name: values.name ?? values.query!, query: values.query! }], call, now, runId, maxPages: Number(values.pages),
    onPage: stats => console.log(JSON.stringify({ type: 'page', ...stats })) }));
  if (values.write && !process.env.DATABASE_URL) throw new TregError('DATABASE_URL_REQUIRED');
  const db = values.write ? createPrisma() : null;
  try {
    if (db) await db.$queryRaw`SELECT 1`;
    const captured: StaticProvider[] = [];
    const refs=new Map<string,{kind:string;ref:string;accounts:Set<string>;posts:Set<string>}>();
    let errors = 0;
    for (const provider of providers) {
      const topic = (await provider.getTrendingTopics())[0]!;
      try {
        const mentions = await provider.getTopicActivity(topic, since);
        captured.push(new StaticProvider(provider.name, [{ topic, mentions }]));
        for(const m of mentions)for(const ref of extractTokenRefs(m.text)){
          const key=`${ref.kind}:${ref.value}`,group=refs.get(key)??{kind:ref.kind,ref:ref.value,accounts:new Set<string>(),posts:new Set<string>()};
          group.accounts.add(`${m.platform}:${m.creatorHandle.toLowerCase()}`);group.posts.add(`${m.platform}:${m.externalId}`);refs.set(key,group);
        }
        console.log(JSON.stringify({ type: 'preview', provider: provider.name, topic: topic.name, mentions: mentions.length,
          sample: mentions.slice(0, 3).map(m => ({ platform: m.platform, id: sanitizeUntrusted(m.externalId, 128), at: m.at, engagement: m.engagement, textHash:createHash('sha256').update(m.text).digest('hex'),refs:extractTokenRefs(m.text) })) }));
      } catch (error) { errors++; console.log(JSON.stringify({ type: 'source_error', provider: provider.name, code: error instanceof TregError ? error.code : 'SOURCE_FAILED' })); }
    }
    const mints=[...refs.values()].filter(r=>r.kind==='MINT').map(r=>r.ref),wanted=mints.slice(0,30);
    let confirmed:string[]|null=null,small:string[]|null=null;
    if(values['check-mints'])try{
      const snapshots=await new DexScreenerSource().getSnapshots(wanted);
      confirmed=wanted.filter(m=>snapshots.has(m));small=confirmed.filter(m=>snapshots.get(m)!.marketCapUsd<100000&&!snapshots.get(m)!.marketCapIsFdv);
    }catch{errors++;console.log(JSON.stringify({type:'market_check_error',code:'MARKET_CHECK_FAILED'}));}
    console.log(JSON.stringify({type:'token_refs',mints:mints.length,tickers:[...refs.values()].filter(r=>r.kind==='CASHTAG').length,marketChecked:values['check-mints']?wanted.length:0,marketConfirmed:confirmed?.length??null,confirmedCapUnder100k:small?.length??null,uncheckedMints:values['check-mints']?mints.length-wanted.length:mints.length,refs:[...refs.values()].map(r=>({kind:r.kind,ref:r.ref,distinctAccounts:r.accounts.size,posts:r.posts.size,marketConfirmed:r.kind==='MINT'&&confirmed&&wanted.includes(r.ref)?confirmed.includes(r.ref):null}))}));
    if (db) {
      for (const receipt of receipts) await db.auditLog.create({ data: { action: 'NARRATIVE_SOURCE_CALL', detail: { ...receipt, runId } } });
      console.log(JSON.stringify({ type: 'ingestion', ...(await ingestNarratives(db, captured, now, { lookbackHours: hours })) }));
    }
    console.log(JSON.stringify({ type: 'summary', runId, wroteToDatabase: !!db, sources: providers.length, errors, calls: receipts.length,
      knownCostMicro: receipts.reduce((sum, r) => sum + (r.costMicro ?? 0), 0), callsWithoutCostMetadata: receipts.filter(r => r.costMicro === null).length }));
    if (errors) process.exitCode = 1;
  } finally { await db?.$disconnect(); }
}
main().catch(error => { console.error(error instanceof TregError ? error.code : 'Narrative preview failed; check local database configuration or command arguments.'); process.exitCode = 1; });

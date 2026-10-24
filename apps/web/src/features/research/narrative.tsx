'use client';
import {TokenIdentity} from './token-identity';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearch,useResearchQuery,hasFeature} from './session';
import {NarrativeDetailSchema,stages} from './contracts';
import {creatorProfileUrl,platformLabel} from './links';
import {PageHeading,Section,Metrics,Facts,DataTable,Loading,ResourceError,Locked,Empty,Stamp,useFormat} from './ui';
export function NarrativePage({slug}:{slug:string}){
 const t=useTranslations('workspace'),f=useFormat(),{access}=useResearch(),allowed=hasFeature(access,'research.narratives');
 const query=useResearchQuery(`narratives/${encodeURIComponent(slug)}`,NarrativeDetailSchema,allowed);
 if(!allowed)return <Locked tier={access.features['research.narratives']?.requiredTier}/>;
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
 const n=query.data,m=n.latestMetric;
 return <><Link className="research-back" href="/app/radar">← {t('radar')}</Link><PageHeading title={n.name} body={n.summary??undefined}/><Stamp at={n.updatedAt}/><Metrics items={[{label:t('score'),value:f.number(n.score)},{label:t('velocity'),value:f.number(n.velocity)},{label:t('organic'),value:f.number(n.organicScore)},{label:t('saturation'),value:f.number(n.saturationRisk)}]}/>
 <Section title={t('lifecycle')}><ol className="lifecycle-rail" tabIndex={0} aria-label={t('lifecycle')}>{stages.map(stage=><li key={stage} aria-current={stage===n.stage?'step':undefined}>{t(`stages.${stage}`)}</li>)}</ol><Facts items={[{label:t('firstDetected'),value:f.date(n.firstDetectedAt)},{label:t('lastUpdated'),value:f.date(n.updatedAt)}]}/><p className="research-note">{t('timelineGap')}</p></Section>
 <Section title={t('relatedTokens')}>{n.tokens.length?<DataTable rowHref={mint=>`/app/tokens/${encodeURIComponent(mint)}`} caption={t('relatedTokens')} headers={[t('token'),t('relation'),t('og'),t('confidence'),t('marketCap'),t('liquidity')]} rows={n.tokens.map(token=>({key:token.mint,cells:[<Link key="token" href={`/app/tokens/${encodeURIComponent(token.mint)}`}><TokenIdentity {...token}/></Link>,token.relation,f.number(token.ogScore),f.percent(token.confidence),f.usd(token.marketCapUsd),f.usd(token.liquidityUsd)]}))}/>:<Empty/>}<p className="research-note">{t('ogNote')}</p></Section>
 <div className="research-columns"><Section title={t('social')}><Facts items={[{label:t('mentions'),value:f.number(m?.mentionVelocity)},{label:t('creatorsVelocity'),value:f.number(m?.creatorVelocity)},{label:t('engagement'),value:f.number(m?.engagementVelocity)},{label:t('manipulation'),value:f.number(m?.manipulationRisk)},{label:t('correlation'),value:f.number(m?.smartMoneyCorrelation)}]}/><Stamp at={m?.at}/></Section>
 <Section title={t('creators')}>{n.creators.length?<DataTable caption={t('creators')} headers={[t('name'),t('platform'),t('role')]} rows={n.creators.map(c=>{const url=creatorProfileUrl(c.platform,c.handle);return {key:`${c.platform}:${c.handle}`,cells:[url?<a key="handle" href={url} target="_blank" rel="noopener noreferrer">{c.handle} ↗</a>:<span key="handle">{c.handle}</span>,platformLabel(c.platform),c.role]};})}/>:<Empty/>}{n.creators.length>=50?<p className="research-note">{t('creatorsCap')}</p>:null}</Section></div></>;
}

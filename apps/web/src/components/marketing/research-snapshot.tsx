'use client';
import {useLocale} from 'next-intl';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {ArrowUpRight,Activity,Wallet,Layers,ScanLine} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {createTransport} from '@/lib/api';
import {snapshotCopy} from '@/content/research-snapshot';
import {QueryProvider} from '@/lib/queries';

const count=z.number().int().nonnegative();
export const PublicResearchSnapshot=z.object({at:z.string().datetime(),narrativeHeat:z.number().finite().nullable(),narrativeSampleSize:count.max(5),
 narrativeAsOf:z.string().datetime().nullable(),activeNarratives:count,trackedWallets:count,discoveredWallets:count,discoveryCapacity:count,opportunities24h:count});
export function ResearchSnapshot(){
 return <QueryProvider><SnapshotContent/></QueryProvider>;
}
function SnapshotContent(){
 const locale=useLocale()==='id'?'id':'en',copy=snapshotCopy[locale];
 const query=useQuery({queryKey:['public-research-snapshot'],queryFn:({signal})=>createTransport(process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000',async()=>null)('/v1/public-research-snapshot',PublicResearchSnapshot,'GET',undefined,false,signal),staleTime:60000,retry:false});
 const data=query.isError?undefined:query.data,format=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:0}).format(n);
 const date=(at:string)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(at))+' UTC';
 const stale=data?.narrativeAsOf?Date.parse(data.at)-Date.parse(data.narrativeAsOf)>3600000||Date.parse(data.narrativeAsOf)>Date.parse(data.at):false;
 const cards=[{label:copy.heat,help:copy.heatHelp,value:data?.narrativeHeat,Icon:Activity},{label:copy.wallets,help:copy.walletsHelp,value:data?.trackedWallets,Icon:Wallet},
  {label:copy.opportunities,help:copy.opportunitiesHelp,value:data?.opportunities24h,Icon:ScanLine},{label:copy.topics,help:copy.topicsHelp,value:data?.activeNarratives,Icon:Layers}];
 return <section className="section container research-snapshot" aria-labelledby="research-snapshot-title">
  <div className="section-heading"><p className="eyebrow">{copy.eyebrow}</p><h2 id="research-snapshot-title">{copy.title}</h2><p>{copy.intro}</p></div>
  <div className="snapshot-grid">{cards.map(({label,help,value,Icon})=><article className="snapshot-card" key={label}><Icon size={19} aria-hidden="true"/><h3>{label}</h3><strong className="snapshot-value">{format(value)}</strong><p>{help}</p></article>)}</div>
  <div className="snapshot-capacity"><div><h3>{copy.seats} <span>{data?`${format(data.discoveredWallets)} / ${format(data.discoveryCapacity)}`:'—'}</span></h3><p>{copy.seatsHelp}</p></div><Link href="/app/smart-money">{copy.wallets}<ArrowUpRight size={16} aria-hidden="true"/></Link></div>
  <div className="snapshot-footer"><div role="status">{query.isPending?copy.loading:query.isError?copy.unavailable:data?<><p>{copy.snapshot}: <time dateTime={data.at}>{date(data.at)}</time></p><p>{data.narrativeAsOf?<>{copy.source}: <time dateTime={data.narrativeAsOf}>{date(data.narrativeAsOf)}</time>{stale?` · ${copy.stale}`:''}</>:copy.unknown}</p></>:copy.unavailable}</div><button type="button" className="button button-ghost" disabled={query.isFetching} onClick={()=>void query.refetch()}>{copy.retry}</button></div>
  <div className="snapshot-links"><Link className="button button-primary" href="/app/radar">{copy.radar}<ArrowUpRight size={16} aria-hidden="true"/></Link><Link className="button button-ghost" href="/methodology">{copy.methodology}</Link></div>
 </section>;
}

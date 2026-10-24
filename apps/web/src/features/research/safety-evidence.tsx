'use client';
import {useEffect,useState} from 'react';
import {useLocale} from 'next-intl';
import {radarSafetyEvidenceStale,type RadarSafetyView} from '@narra/shared';
import {DataTable,Facts,useFormat} from './ui';
import './safety-evidence.css';

const copy={
 en:{title:'Recorded radar safety',missingNoCall:'No Early Radar call for this token',missingNoSnapshot:'Its latest radar call has no safety snapshot',invalid:'Safety snapshot unavailable — invalid or mismatched evidence',scope:'Public radar record for this token. Separate from the opportunity record; not a current safety verdict or trade approval.',noCallHelp:'No public Early Radar alert is recorded for this token.',unavailable:'Radar safety information unavailable',unavailableHelp:'This response did not include radar information. Alert history cannot be determined.',noSnapshotHelp:'Snapshots are frozen only when a radar alert is published and are never backfilled, so this call has no recorded verdict.',invalidHelp:'The stored snapshot failed validation against this token, mint, profile or alert time, so it is shown as unavailable rather than reinterpreted.',latestCall:'Latest radar call',historical:'Historical assessment, not a safety guarantee or dump prediction.',shadow:'Shadow mode: recorded, not enforced.',enforce:'Enforcement was enabled for this recorded alert.',stale:'Evidence is now stale or incomplete. The recorded verdict is unchanged.',recorded:'Recorded verdict',at:'Assessed at',alert:'Alert',policy:'Policy',route:'Route / profile',market:'Market observed',holders:'Holders observed',risk:'Risk observed',source:'Enrichment source',retrieved:'Enrichment retrieved',blockers:'Blocked checks',unknowns:'Missing critical evidence',warnings:'Warnings',checks:'Inspect frozen checks',code:'Check',status:'Result',value:'Recorded value',threshold:'Threshold',detail:'Evidence note',none:'None recorded',missingHelp:'No verdict is inferred from scores, liquidity or a missing snapshot.',pass:'PASS — recorded checks passed',block:'BLOCK — recorded blockers',unknown:'UNKNOWN — incomplete evidence'},
 id:{title:'Keamanan radar tercatat',missingNoCall:'Belum ada panggilan Early Radar untuk token ini',missingNoSnapshot:'Panggilan radar terbarunya belum memiliki snapshot keamanan',invalid:'Snapshot keamanan tidak tersedia — bukti tidak valid atau tidak cocok',scope:'Catatan radar publik untuk token ini. Terpisah dari catatan peluang; bukan penilaian keamanan terkini atau persetujuan transaksi.',noCallHelp:'Tidak ada alert Early Radar publik yang tercatat untuk token ini.',unavailable:'Informasi keamanan radar tidak tersedia',unavailableHelp:'Respons ini tidak menyertakan informasi radar. Riwayat alert belum dapat dipastikan.',noSnapshotHelp:'Snapshot hanya dibekukan saat alert radar diterbitkan dan tidak pernah diisi ulang, sehingga panggilan ini tidak memiliki hasil tercatat.',invalidHelp:'Snapshot tersimpan gagal divalidasi terhadap token, mint, profil, atau waktu alert ini, sehingga ditampilkan tidak tersedia dan tidak ditafsirkan ulang.',latestCall:'Panggilan radar terbaru',historical:'Penilaian historis, bukan jaminan keamanan atau prediksi penurunan harga.',shadow:'Mode shadow: dicatat, tidak diberlakukan.',enforce:'Penegakan aktif untuk alert yang tercatat ini.',stale:'Bukti kini kedaluwarsa atau tidak lengkap. Hasil tercatat tidak diubah.',recorded:'Hasil tercatat',at:'Dinilai pada',alert:'Alert',policy:'Kebijakan',route:'Jalur / profil',market:'Observasi pasar',holders:'Observasi holder',risk:'Observasi risiko',source:'Sumber pengayaan',retrieved:'Pengayaan diambil',blockers:'Pemeriksaan yang memblokir',unknowns:'Bukti penting yang belum tersedia',warnings:'Peringatan',checks:'Lihat pemeriksaan tersimpan',code:'Pemeriksaan',status:'Hasil',value:'Nilai tercatat',threshold:'Ambang',detail:'Catatan bukti',none:'Tidak ada yang tercatat',missingHelp:'Skor, likuiditas, atau snapshot yang tidak tersedia tidak digunakan untuk menyimpulkan keamanan.',pass:'PASS — pemeriksaan tercatat lulus',block:'BLOCK — ada pemblokir tercatat',unknown:'UNKNOWN — bukti tidak lengkap'},
};

export function SafetyEvidence({value,compact=false}:{value?:RadarSafetyView;compact?:boolean}){
  const locale=useLocale(),c=copy[locale==='id'?'id':'en'],f=useFormat();
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[]);
 const labels=locale==='id'?['Top-10 tercatat','Top-10 tanpa pool / burn','Kepemilikan pengembang','LP burned tercatat']:['Reported top-10','Top-10 excluding pool / burn','Developer holding','Recorded LP burned'];
 const s=value?.state==='RECORDED'?value.snapshot:null,invalid=value?.state==='INVALID';
 const heading=s?s.status==='PASS'?c.pass:s.status==='BLOCK'?c.block:c.unknown:invalid?c.invalid:!value?c.unavailable:value.alertId?c.missingNoSnapshot:c.missingNoCall;
 const groups=s?[{label:c.blockers,codes:s.blockers},{label:c.unknowns,codes:s.unknowns},{label:c.warnings,codes:s.warnings}]:[];
 return <section className={`safety-evidence${compact?' safety-evidence-compact':''}`} aria-label={c.title}>
  {compact?<strong>{c.title}</strong>:<h2>{c.title}</h2>}
  <p className="safety-verdict" data-verdict={s?.status??value?.state??'UNAVAILABLE'}>{heading}</p>
  {!compact&&<p className="research-note">{c.scope}</p>}
  {!s?<>
   {!compact&&<p>{invalid?c.invalidHelp:!value?c.unavailableHelp:value.alertId?c.noSnapshotHelp:c.noCallHelp}</p>}
   {!compact&&!invalid&&value?.alertAt&&<p className="research-note">{c.latestCall}: {f.date(value.alertAt)}</p>}
   <p className="research-note">{c.missingHelp}</p>
  </>:<>
   <p>{s.mode==='shadow'?c.shadow:c.enforce}</p>
   <p className="research-note">{c.at}: {f.date(s.evaluatedAt)} · {c.historical}</p>
    {(value?.evidenceStale||radarSafetyEvidenceStale(s,Math.max(clock,Date.now())))&&<p className="research-notice">{c.stale}</p>}
   {compact?<dl className="safety-counts">{groups.map(g=><div key={g.label}><dt>{g.label}</dt><dd>{g.codes.length}</dd></div>)}</dl>:<>
    {groups.map(g=><div key={g.label}><h3>{g.label}</h3>{g.codes.length?<ul>{g.codes.map(code=><li key={code}><code>{code}</code>{s.checks.find(check=>check.code===code)?.detail&&<span> — {s.checks.find(check=>check.code===code)!.detail}</span>}</li>)}</ul>:<p>{c.none}</p>}</div>)}
     <Facts items={[s.facts.top10Pct,s.facts.top10ExLpPct,s.facts.devHoldingPct,s.facts.lpBurnedPct].map((value,i)=>({label:labels[i]!,value:value===null?'—':`${f.number(value,2)}%`}))}/>
     {s.facts.tradeability&&<Facts items={[
      {label:locale==='id'?'Kuotasi tercatat':'Recorded quote',value:'Jupiter · BUY · 50 USDC → token'},
      {label:locale==='id'?'Kuotasi diambil':'Quote retrieved',value:f.date(s.facts.tradeability.sourceAt)},
      {label:locale==='id'?'Dampak harga kuotasi':'Quoted price impact',value:`${f.number(s.facts.tradeability.priceImpactPct,2)}%`},
     ]}/>}
    <Facts items={[{label:c.policy,value:s.policyVersion},{label:c.alert,value:<code>{value?.alertId}</code>},{label:c.route,value:`${s.facts.route} / ${s.facts.profile}`},{label:c.market,value:f.date(s.facts.marketAt)},{label:c.holders,value:f.date(s.facts.holdersAt)},{label:c.risk,value:f.date(s.facts.riskAt)},{label:c.source,value:s.facts.evidenceSource??'—'},{label:c.retrieved,value:f.date(s.facts.evidenceAt)}]}/>
    <details><summary>{c.checks}</summary><DataTable caption={c.checks} headers={[c.code,c.status,c.value,c.threshold,c.detail]} rows={s.checks.map((check,i)=>({key:`${i}-${check.code}`,cells:[check.code,check.status,check.value===null?'—':typeof check.value==='number'?f.number(check.value,4):String(check.value),check.threshold===null?'—':String(check.threshold),check.detail??'—']}))}/></details>
   </>}
  </>}
 </section>;
}

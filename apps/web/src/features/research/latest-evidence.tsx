'use client';
import {useEffect,useState} from 'react';
import {useLocale} from 'next-intl';
import {LATEST_EVIDENCE_MAX_AGE_MS,type LatestEvidence} from '@narra/shared';
import {DataTable,useFormat} from './ui';
import './safety-evidence.css';

const copy={
 en:{title:'Latest observed evidence',note:'Latest stored observations, separate from the historical radar record. Fresh means recently observed or retrieved, not safe or approved for trading. Coverage depends on what collectors recorded: a missing row is not proof the fact does not exist.',unavailable:'Observation information unavailable.',market:'Market',holders:'Holders',risk:'Risk flags',rugcheck:'RugCheck',tradeability:'Buy quote',state:'Coverage',at:'Observed / retrieved',source:'Source',facts:'Recorded facts',missing:'Not recorded',flags:'No flags in stored row',unknown:'Unknown',locked:'LP locked',unlocked:'LP not locked',buy:'50 USDC → token',impact:'quoted impact',top10:'Reported top-10',exLp:'Top-10 excluding pool',dev:'Developer holding',burn:'LP burned',liquidity:'Liquidity',price:'Price',recent:'recent observations',states:{FRESH:'Recent',STALE:'Stale',UNVERIFIED:'Unverified source',MISSING:'Not recorded',INVALID:'Invalid evidence'}},
 id:{title:'Bukti observasi terbaru',note:'Observasi tersimpan terbaru, terpisah dari catatan radar historis. Terbaru berarti baru diamati atau diambil, bukan aman atau disetujui untuk transaksi. Cakupan bergantung pada apa yang dicatat kolektor: baris yang tidak ada bukan bukti bahwa fakta tersebut tidak ada.',unavailable:'Informasi observasi tidak tersedia.',market:'Pasar',holders:'Holder',risk:'Flag risiko',rugcheck:'RugCheck',tradeability:'Kuotasi beli',state:'Cakupan',at:'Diamati / diambil',source:'Sumber',facts:'Fakta tercatat',missing:'Belum tercatat',flags:'Tidak ada flag pada baris tersimpan',unknown:'Belum diketahui',locked:'LP terkunci',unlocked:'LP tidak terkunci',buy:'50 USDC → token',impact:'dampak harga kuotasi',top10:'Top-10 tercatat',exLp:'Top-10 tanpa pool',dev:'Kepemilikan pengembang',burn:'LP burned',liquidity:'Likuiditas',price:'Harga',recent:'observasi terbaru',states:{FRESH:'Terbaru',STALE:'Kedaluwarsa',UNVERIFIED:'Sumber belum terverifikasi',MISSING:'Belum tercatat',INVALID:'Bukti tidak valid'}},
};

export function LatestObservedEvidence({value,compact=false}:{value?:LatestEvidence;compact?:boolean}){
  const c=copy[useLocale()==='id'?'id':'en'],f=useFormat(),pct=(n:number|null)=>n==null?c.unknown:`${f.number(n,2)}%`;
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const keys=['market','holders','risk','rugcheck','tradeability'] as const;
  const state=(key:typeof keys[number])=>{
   const row=value?.[key];
   if(!row)return 'MISSING';
   // A cached response may expire on screen; elapsed time can only downgrade it, never certify it again.
   if(row.state!=='FRESH')return row.state;
   const at=Date.parse(row.at??''),now=Math.max(clock,Date.now(),Date.parse(value!.checkedAt));
   if(!Number.isFinite(at)||at>now)return 'INVALID';
   return now-at>LATEST_EVIDENCE_MAX_AGE_MS[key]?'STALE':'FRESH';
  };
  const summary=(key:typeof keys[number])=>{
   if(!value)return c.unavailable;
   if(state(key)==='INVALID')return c.states.INVALID;
  switch(key){
   case 'market':{const d=value.market.data;return d?`${c.price}: ${f.usd(d.priceUsd)} · ${c.liquidity}: ${f.usd(d.liquidityUsd)}`:c.missing;}
   case 'holders':{const d=value.holders.data;return d?`${f.number(d.holders)} · ${c.top10}: ${pct(d.top10Pct)} · ${c.dev}: ${pct(d.devHoldingPct)}`:c.missing;}
   case 'risk':return value.risk.data?(value.risk.data.flags.join(', ')||c.flags):c.missing;
    case 'rugcheck':{const d=value.rugcheck.data;return d?`${c.exLp}: ${pct(d.top10ExLpPct)} · ${c.dev}: ${pct(d.devHoldingPct)} · ${c.burn}: ${pct(d.lpBurnedPct)} · ${d.lpLocked==null?`${c.locked}: ${c.unknown}`:d.lpLocked?c.locked:c.unlocked} · ${c.risk}: ${d.riskFlags.join(', ')||c.flags}`:c.missing;}
   case 'tradeability':{const d=value.tradeability.data;return d?`${c.buy} · ${c.impact}: ${pct(d.priceImpactPct)} · in ${d.inAmount}, out ${d.outAmount} (base units)` :c.missing;}
  }
 };
 return <section className={`safety-evidence${compact?' safety-evidence-compact':''}`} aria-label={c.title}>
  {compact?<strong>{c.title}</strong>:<h2>{c.title}</h2>}
   {!value?<p>{c.unavailable}</p>:compact?<p>{keys.filter(k=>state(k)==='FRESH').length}/5 {c.recent} · {c.tradeability}: {c.states[state('tradeability')]}</p>:<DataTable caption={c.title} headers={[c.source,c.state,c.at,c.facts]} rows={keys.map(key=>({key,cells:[<span key="source">{c[key]}<br/><small>{value[key].source??'—'}</small></span>,c.states[state(key)],f.date(value[key].at),summary(key)]}))}/>}
  <p className="research-note">{c.note}</p>
 </section>;
}

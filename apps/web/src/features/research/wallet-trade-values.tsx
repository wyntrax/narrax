'use client';
import {useLocale} from 'next-intl';
import {useFormat} from './ui';

export function TradeAmount({value}:{value:number|null|undefined}){
 const locale=useLocale(),f=useFormat();
 // Preserve tiny non-zero swaps instead of rounding dust-sized amounts to zero.
 return <>{value!=null&&value!==0&&Math.abs(value)<.01?new Intl.NumberFormat(locale,{maximumSignificantDigits:8}).format(value):f.number(value,4)}</>;
}
export function TradeValuation({value,kind,observation,fdv=false}:{value:number|null|undefined;kind:'usd'|'cap';observation?:{source:string;at:string}|null;fdv?:boolean}){
 const id=useLocale()==='id',f=useFormat();
 if(value==null)return <span>{id?'Tidak tercatat':'Not recorded'}<small>{fdv?(id?'Hanya FDV tersedia saat transaksi':'Only FDV available at trade time'):kind==='usd'?(id?'Tidak ada harga SOL/USD pada waktu transaksi':'No SOL/USD observation at trade time'):(id?'Tidak ada kapitalisasi pasar pada waktu transaksi':'No market-cap observation at trade time')}</small></span>;
 return <span><TradeAmount value={value}/>{observation&&<small>{observation.source} · {f.date(observation.at)}</small>}</span>;
}
export function TradeValuationNote(){
 const id=useLocale()==='id';
 return <p className="research-note">{id?'USD dan kapitalisasi adalah nilai pada waktu transaksi, bukan kuotasi saat ini. Riwayat sebelum pengumpulan harga dapat tidak tersedia. Inisial tampil jika gambar tidak tersedia.':'USD and market cap refer to trade time, not current quotes. Trades predating price collection may lack historical values. Initials are shown when artwork is unavailable.'}</p>;
}

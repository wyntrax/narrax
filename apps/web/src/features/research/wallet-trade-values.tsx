'use client';
import {useLocale} from 'next-intl';
import {useFormat} from './ui';

export function TradeAmount({value}:{value:number|null|undefined}){
 const locale=useLocale(),f=useFormat();
 // Preserve tiny non-zero swaps instead of rounding dust-sized amounts to zero.
 return <>{value!=null&&value!==0&&Math.abs(value)<.01?new Intl.NumberFormat(locale,{maximumSignificantDigits:8}).format(value):f.number(value,4)}</>;
}
const capReasons:Record<string,[string,string]>={
 NO_TOKEN_MARKET_HISTORY:['No market observations collected for this token','Belum ada observasi pasar untuk token ini'],
 TRADE_BEFORE_MARKET_HISTORY:['Trade predates token price collection','Transaksi sebelum pengumpulan harga token'],
 NO_MARKET_IN_WINDOW:['No observation in the 15 minutes before this trade','Tidak ada observasi dalam 15 menit sebelum transaksi'],
 INVALID_MARKET_PROVENANCE:['Stored observations lack valid source evidence','Observasi tersimpan tidak memiliki bukti sumber yang valid'],
 INVALID_MARKET_VALUES:['Stored market values are unusable','Nilai pasar tersimpan tidak dapat digunakan'],
 INVALID_MARKET_CAP:['Market observation has no usable market cap','Observasi pasar tidak memiliki kapitalisasi yang valid'],
 FDV_ONLY:['Only FDV available at trade time','Hanya FDV tersedia saat transaksi'],
 MARKET_LOOKUP_LIMIT:['Historical observation lookup limit reached','Batas pencarian observasi historis tercapai'],
};
export function TradeValuation({value,kind,observation,fdv=false,reasons=[]}:{value:number|null|undefined;kind:'usd'|'cap';observation?:{source:string;at:string}|null;fdv?:boolean;reasons?:string[]}){
  const id=useLocale()==='id',f=useFormat();
  const reason=kind==='cap'?reasons.find(r=>capReasons[r]):undefined;
  if(value==null)return <span>{id?'Tidak tercatat':'Not recorded'}<small>{reason?capReasons[reason]![id?1:0]:fdv?(id?'Hanya FDV tersedia saat transaksi':'Only FDV available at trade time'):kind==='usd'?(id?'Tidak ada harga SOL/USD pada waktu transaksi':'No SOL/USD observation at trade time'):(id?'Tidak ada kapitalisasi pasar pada waktu transaksi':'No market-cap observation at trade time')}</small></span>;
 return <span><TradeAmount value={value}/>{observation&&<small>{observation.source} · {f.date(observation.at)}</small>}</span>;
}
export function TradeValuationNote(){
 const id=useLocale()==='id';
 return <p className="research-note">{id?'USD dan kapitalisasi adalah nilai pada waktu transaksi, bukan kuotasi saat ini. Riwayat sebelum pengumpulan harga dapat tidak tersedia. Inisial tampil jika gambar tidak tersedia.':'USD and market cap refer to trade time, not current quotes. Trades predating price collection may lack historical values. Initials are shown when artwork is unavailable.'}</p>;
}

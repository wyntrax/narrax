'use client';
import {useState} from 'react';
import {useLocale} from 'next-intl';
import {WalletEntryBand,WalletRankingPage} from '@narra/shared';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {DataTable,Empty,Loading,ResourceError,Section,Stamp,useFormat} from './ui';

const copy={
 en:{title:'Small-cap wallet leaderboard',body:'30-day observed swap results. Ranked by review readiness, history coverage, then the 95% Wilson lower bound of win rate—not raw win rate alone.',
  methodology:'One win/loss = one observed flat-to-flat token position, not each partial sale. Average-cost SOL accounting before unrecorded fees. Entry bands use market cap recorded at the first buy; missing historical evidence stays unknown. Holdings, transfers, insider links and realistic copy-trade returns are not fully verified. Open losses are not marked to market; realised drawdown is not portfolio drawdown.',
  band:'Market cap at entry',bands:{SMALL_CAP:'Below $1M',UNDER_100K:'Below $100K','100K_500K':'$100K–$500K','500K_1M':'$500K–$1M',OVER_1M:'$1M and above',UNKNOWN:'Unknown entry cap',ALL:'All entry caps'},
  wallet:'Wallet / evaluation',win:'Win rate / closed positions',pnl:'Realised P&L · SOL',hold:'Typical holding time',risk:'Losses / open exposure',evidence:'Evidence',ready:'Ready for review',observing:'Observing',
  first:'First sell',close:'Observed close',sample:'closed tokens',open:'open positions',cost:'remaining swap cost · SOL',drawdown:'closed-position drawdown · SOL',
  medianWin:'Median win · SOL',medianLoss:'Median loss · SOL',factor:'Profit factor',lower:'95% lower bound',wins:'wins',losses:'losses',flat:'breakeven',
  unknown:'Unknown',empty:'No evaluated positions in this entry band yet. Check Unknown entry cap or All entry caps; historical market caps cannot be inferred from current prices.',
  limited:'Bounded results: showing the highest-ranked available rows from up to 500 tracked wallets.',
  pipeline:'Worker evaluation status',disabled:'Automatic history collection is disabled on the worker.',provider:'The worker has no history-provider key configured.',waiting:'Waiting for the worker evaluation heartbeat.',stale:'Worker heartbeat is stale.',
  progress:'Last cycle: {added} candidates added, {scanned} wallets scanned, {failures} history failures.',
  reason:{HISTORY_INCOMPLETE:'History incomplete or stale',PERFORMANCE_STALE:'Performance snapshot stale',ACTIVITY_STALE:'No fresh activity',TRADE_LIMIT:'Trade calculation limit reached',INCOMPLETE_COST_BASIS:'Missing quantity or unmatched sales',SMALL_SAMPLE:'Needs 20 closes, 5 tokens and 7 observed days',POSITIVE_RESULTS_REQUIRED:'Positive P&L and median ROI required',LOW_WIN_CONFIDENCE:'Win-rate lower bound below 50%',SMALL_CAP_UNPROVEN:'Small-cap record not established',FAST_EXITS:'Most closes under one minute',LINKED_WALLETS:'Linked-wallet cluster recorded',KNOWN_DEPLOYER:'Known token deployer'},
 },
 id:{title:'Peringkat wallet small-cap',body:'Hasil swap teramati selama 30 hari. Diurutkan berdasarkan kesiapan tinjauan, cakupan riwayat, lalu batas bawah Wilson 95% untuk win rate—bukan win rate mentah saja.',
  methodology:'Satu menang/kalah = satu posisi token dari saldo swap nol kembali ke nol, bukan setiap penjualan parsial. Akuntansi SOL biaya rata-rata sebelum biaya yang tidak tercatat. Kelompok kapitalisasi memakai bukti saat pembelian pertama; bukti historis yang hilang tetap tidak diketahui. Kepemilikan, transfer, hubungan insider, dan hasil copy-trade realistis belum sepenuhnya diverifikasi. Kerugian posisi terbuka belum dinilai; drawdown terealisasi bukan drawdown portofolio.',
  band:'Kapitalisasi saat masuk',bands:{SMALL_CAP:'Di bawah $1 juta',UNDER_100K:'Di bawah $100 ribu','100K_500K':'$100–500 ribu','500K_1M':'$500 ribu–$1 juta',OVER_1M:'$1 juta ke atas',UNKNOWN:'Kapitalisasi masuk tidak diketahui',ALL:'Semua kapitalisasi masuk'},
  wallet:'Wallet / evaluasi',win:'Win rate / posisi ditutup',pnl:'P&L terealisasi · SOL',hold:'Durasi kepemilikan tipikal',risk:'Kerugian / eksposur terbuka',evidence:'Bukti',ready:'Siap ditinjau',observing:'Dalam pengamatan',
  first:'Penjualan pertama',close:'Penutupan teramati',sample:'token ditutup',open:'posisi terbuka',cost:'sisa biaya swap · SOL',drawdown:'drawdown posisi ditutup · SOL',
  medianWin:'Median untung · SOL',medianLoss:'Median rugi · SOL',factor:'Faktor profit',lower:'Batas bawah 95%',wins:'menang',losses:'kalah',flat:'impas',
  unknown:'Tidak diketahui',empty:'Belum ada posisi yang dievaluasi pada kelompok ini. Periksa kapitalisasi masuk tidak diketahui atau semua kapitalisasi; kapitalisasi historis tidak dapat disimpulkan dari harga kini.',
  limited:'Hasil dibatasi: menampilkan peringkat tertinggi yang tersedia dari maksimal 500 wallet terpantau.',
  pipeline:'Status evaluasi worker',disabled:'Pengumpulan riwayat otomatis dinonaktifkan pada worker.',provider:'Kunci penyedia riwayat belum dikonfigurasi pada worker.',waiting:'Menunggu laporan evaluasi worker.',stale:'Laporan worker sudah kedaluwarsa.',
  progress:'Siklus terakhir: {added} kandidat ditambahkan, {scanned} wallet dipindai, {failures} kegagalan riwayat.',
  reason:{HISTORY_INCOMPLETE:'Riwayat tidak lengkap atau kedaluwarsa',PERFORMANCE_STALE:'Snapshot performa kedaluwarsa',ACTIVITY_STALE:'Tidak ada aktivitas baru',TRADE_LIMIT:'Batas kalkulasi transaksi tercapai',INCOMPLETE_COST_BASIS:'Jumlah token hilang atau penjualan tanpa basis',SMALL_SAMPLE:'Perlu 20 penutupan, 5 token dan 7 hari teramati',POSITIVE_RESULTS_REQUIRED:'Perlu P&L dan median ROI positif',LOW_WIN_CONFIDENCE:'Batas bawah win rate di bawah 50%',SMALL_CAP_UNPROVEN:'Rekam jejak small-cap belum terbukti',FAST_EXITS:'Mayoritas penutupan kurang dari satu menit',LINKED_WALLETS:'Tercatat dalam klaster wallet terkait',KNOWN_DEPLOYER:'Deployer token yang diketahui'},
 },
};

export function WalletLeaderboard(){
 const locale=useLocale()==='id'?'id':'en',t=copy[locale],f=useFormat(),[band,setBand]=useState<WalletEntryBand>('SMALL_CAP');
 const query=useResearchQuery(`smart-money/rankings?band=${band}&limit=50`,WalletRankingPage,true,60000);
 const data=query.data,items=data?.items??[],pipeline=data?.pipeline;
 const hold=(s:number|null)=>s===null?t.unknown:s<60?`${f.number(s,0)}s`:s<3600?`${f.number(s/60,1)}m`:s<86400?`${f.number(s/3600,1)}h`:`${f.number(s/86400,1)}d`;
 return <Section title={t.title}><p>{t.body}</p><div className="research-filters"><label>{t.band}<select value={band} onChange={e=>setBand(e.target.value as WalletEntryBand)}>{WalletEntryBand.options.map(b=><option key={b} value={b}>{t.bands[b]}</option>)}</select></label></div>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<>
   <div className="research-note"><strong>{t.pipeline}</strong><p>{!pipeline?t.waiting:!pipeline.historyEnabled?t.disabled:!pipeline.providerConfigured?t.provider:Date.parse(pipeline.checkedAt)>Date.parse(data!.asOf)||Date.parse(data!.asOf)-Date.parse(pipeline.checkedAt)>45*60000?t.stale:t.progress.replace('{added}',String(pipeline.intakeAdded)).replace('{scanned}',String(pipeline.scanned)).replace('{failures}',String(pipeline.failures))}</p>{pipeline&&<Stamp at={pipeline.checkedAt}/>}</div>
   {!items.length?<Empty body={t.empty}/>:<DataTable caption={t.title} headers={[t.wallet,t.win,t.pnl,t.hold,t.risk]} rows={items.map(w=>({key:w.address,cells:[
    <div key="wallet"><Link href={`/app/smart-money/${encodeURIComponent(w.address)}`}>{w.label??`${w.address.slice(0,6)}…${w.address.slice(-4)}`}</Link><small>{w.status==='REVIEW_READY'?t.ready:t.observing}</small><details><summary>{t.evidence}</summary><ul>{w.reasons.map(r=><li key={r}>{t.reason[r as keyof typeof t.reason]??r}</li>)}</ul><Stamp at={w.checkedAt}/></details></div>,
    <div key="win"><b>{f.percent(w.performance.winRate)}</b><small>{w.performance.wins} {t.wins} / {w.performance.losses} {t.losses} / {w.performance.breakeven} {t.flat}</small><small>{w.performance.closedTokens} {t.sample}</small><small>{t.lower}: {f.percent(w.performance.winRateLowerBound)}</small></div>,
    <div key="pnl">{w.performance.realisedPnlSol??t.unknown}<small>{t.medianWin}: {w.performance.medianWinSol??t.unknown}</small><small>{t.medianLoss}: {w.performance.medianLossSol??t.unknown}</small><small>{t.factor}: {f.number(w.performance.profitFactor,2)}</small></div>,
    <div key="hold">{t.first}: {hold(w.performance.medianFirstSellSeconds)}<small>{t.close}: {hold(w.performance.medianCloseSeconds)}</small></div>,
    <div key="risk">{w.performance.openPositions} {t.open}<small>{t.cost}: {w.performance.openCostSol}</small><small>{t.drawdown}: {w.performance.realisedDrawdownSol}</small></div>,
   ]}))}/>}{data?.capped&&<p className="research-note">{t.limited}</p>}
  </>}<p className="research-notice">{t.methodology}</p></Section>;
}

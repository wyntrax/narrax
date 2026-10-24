import type {SeoLocale} from '@/lib/seo';

type Section = {title: string; paragraphs: string[]};
export type ResearchGuide = {slug: string; title: string; description: string; intro: string; sections: Section[]; checklist: string[]};
export const researchCopy = {
  en: {
    homeTitle: 'Solana Narrative & Smart Money Research',
    homeDescription: 'Research Solana crypto narratives, early token activity and observed wallet flows with Narrax. Inspect evidence freshness, risk gaps and measured token outcomes.',
    title: 'Solana research guides',
    description: 'Learn how to evaluate crypto narratives, smart money wallets and early token activity on Solana using source-backed evidence and explicit risk limits.',
    intro: 'Understand the evidence before interpreting a signal. These guides explain the research concepts behind Narrax, including what the data cannot establish.',
    methodology: 'Research methodology', methodologyDescription: 'How Narrax separates discovery, evidence checks and measured outcomes in Solana narrative and wallet-flow research. Read the limits before interpreting a signal.',
    home: 'Home', guides: 'Research guides', read: 'Read guide', all: 'All guides', methodologyCta: 'Read methodology', related: 'Continue researching', checklist: 'A practical research checklist',
    notice: 'Educational research, not financial advice. A signal, wallet label or fresh risk row is not a guarantee of safety or future returns.',
    byline: 'By the Narrax research team', access: 'Explore early access',
    sources: 'Primary technical references', sourceNote: 'These references explain the underlying data and protocol concepts; they do not endorse Narrax or any token.',
  },
  id: {
    homeTitle: 'Riset Narasi & Smart Money Solana',
    homeDescription: 'Riset narasi kripto Solana, aktivitas token awal, dan aliran wallet teramati bersama Narrax. Periksa kesegaran bukti, celah risiko, dan hasil token terukur.',
    title: 'Panduan riset Solana',
    description: 'Pelajari cara mengevaluasi narasi kripto, wallet smart money, dan aktivitas token awal di Solana dengan bukti bersumber serta batas risiko yang jelas.',
    intro: 'Pahami bukti sebelum menafsirkan sinyal. Panduan ini menjelaskan konsep riset Narrax, termasuk hal-hal yang tidak dapat dibuktikan oleh data.',
    methodology: 'Metodologi riset', methodologyDescription: 'Cara Narrax memisahkan penemuan, pemeriksaan bukti, dan hasil terukur dalam riset narasi serta aliran wallet Solana. Pahami batasannya sebelum membaca sinyal.',
    home: 'Beranda', guides: 'Panduan riset', read: 'Baca panduan', all: 'Semua panduan', methodologyCta: 'Baca metodologi', related: 'Lanjutkan riset', checklist: 'Daftar periksa riset praktis',
    notice: 'Riset edukatif, bukan nasihat keuangan. Sinyal, label wallet, atau baris risiko terkini bukan jaminan keamanan maupun keuntungan mendatang.',
    byline: 'Oleh tim riset Narrax', access: 'Jelajahi akses awal',
    sources: 'Referensi teknis utama', sourceNote: 'Referensi ini menjelaskan konsep data dan protokol; bukan dukungan terhadap Narrax atau token apa pun.',
  },
} satisfies Record<SeoLocale, Record<string, string>>;

export const researchGuides: Record<SeoLocale, ResearchGuide[]> = {
  en: [
    {
      slug: 'solana-narrative-research', title: 'How to research crypto narratives on Solana',
      description: 'Separate a crypto narrative from token promotion: verify original sources, resolve exact Solana token addresses and test whether attention has market evidence.',
      intro: 'A crypto narrative is a shared explanation for why a topic may matter. Attention can spread before a token has meaningful adoption, liquidity or even a clear connection to that topic. Narrative research starts by testing the connection, not buying the label.',
      sections: [
        {title: 'Start with the original source', paragraphs: ['Identify the announcement, release, proposal or event that caused the discussion. Record who published it and when. Several accounts quoting one announcement are not several independent confirmations.', 'Distinguish a verifiable product event from speculation, paid promotion and recycled screenshots. A social post can establish that someone made a claim; it cannot, on its own, establish that the claim is true.']},
        {title: 'Connect the topic to an exact token', paragraphs: ['A ticker is not an identity. Different tokens can share a symbol, and a pool address is not necessarily a mint address. Resolve the exact Solana mint and check whether the cited source actually identifies it.', 'A token name that resembles a trending phrase is only a candidate match. Treat uncertain associations as unresolved rather than assigning the narrative to whichever token has the most attention.']},
        {title: 'Compare attention with market evidence', paragraphs: ['Inspect the timestamps and provenance of price, liquidity and holder observations. Missing holder data is unknown, not zero. A fresh price does not make an hours-old holder snapshot current.', 'Attention without adequate liquidity may not be tradable. Holder counts do not prove independent ownership, and a volume spike can reflect concentration or artificial activity. No single metric validates a narrative.']},
        {title: 'Evaluate prospectively, not from a winners list', paragraphs: ['Freeze the evidence available when a research observation is published, then measure later prices against that entry. Keep failed candidates and unavailable outcomes visible so the sample is not limited to surviving winners.', 'A token-price return is not an executable trade return. Fees, spread, slippage, liquidity changes and failed execution can materially change what a participant could realize. Small samples cannot establish a repeatable edge.']},
      ],
      checklist: ['Save the original source and publication time.', 'Resolve the exact mint; do not rely on ticker similarity.', 'Check price, liquidity and holder timestamps separately.', 'Mark uncertain connections and missing outcomes as unknown.', 'Compare later outcomes without rewriting the original evidence.'],
    },
    {
      slug: 'smart-money-wallet-research', title: 'How to evaluate Solana smart money wallets',
      description: 'Evaluate wallet history quality, realized results, independent entities and fresh token flows before interpreting a Solana wallet as smart money.',
      intro: '“Smart money” is a research label, not an on-chain fact. One profitable transaction or a prominent account does not establish repeatable skill. The useful question is whether a wallet has enough complete, recent and independently verifiable evidence to study.',
      sections: [
        {title: 'Check the history before the performance', paragraphs: ['Verify the observation period, token coverage and whether the data source reached its pagination limit. A truncated history can omit losing trades or the buys that explain later sells.', 'Unmatched sells, transfers, airdrops and incomplete cost basis complicate profit calculations. Do not turn unknown acquisition costs into zero or silently discard records that fail parsing.']},
        {title: 'Separate realized results from open positions', paragraphs: ['A marked-up open position is not a closed gain. Examine closed trade legs, results across multiple tokens and the distribution of outcomes rather than only total profit or the largest winner.', 'Positive historical results can be concentrated in one token or one short period. Review median returns, recency and sample size together. These checks improve research discipline; they do not predict future performance.']},
        {title: 'Count independent entities, not just addresses', paragraphs: ['Several addresses may share funding or belong to one operator. Two wallet buys are not necessarily two independent decisions. Cluster evidence should be inspected, with unresolved relationships kept explicit.', 'A flow observation also needs a defined time window, net direction and current market context. Old buys paired with a new price can create a misleading picture of current demand.']},
        {title: 'Keep discovery separate from admission', paragraphs: ['An early buyer is a lead for investigation. It is not automatically an approved wallet, a profitable trader or a recommendation to copy a transaction. Human review should not override missing history or stale evidence.', 'Narrax keeps candidate discovery and qualification separate. Live availability depends on collection readiness and qualifying evidence; the presence of a research feature does not imply a currently qualified wallet cohort.']},
      ],
      checklist: ['Confirm history completeness and observation dates.', 'Separate closed results from unrealized positions.', 'Investigate unmatched sells and missing acquisition costs.', 'Check whether multiple addresses represent independent entities.', 'Treat wallet labels and past returns as hypotheses, not promises.'],
    },
    {
      slug: 'early-token-risk-checklist', title: 'An early Solana token research and risk checklist',
      description: 'Inspect mint identity, liquidity, holder concentration, authorities and evidence freshness when researching early Solana tokens. Missing data is not a safety pass.',
      intro: 'Early token activity can be noisy, illiquid and adversarial. A trending chart is not a security audit, and a low reported risk score cannot eliminate the possibility of loss. Research begins by identifying what is actually known at the observation time.',
      sections: [
        {title: 'Verify identity and market provenance', paragraphs: ['Match the exact mint to the market pair and the source you are reading. Check whether market capitalization is measured from circulating supply or is a fully diluted valuation proxy.', 'Record when the quote was observed and whether the market source knows the token. A missing quote, an ambiguous symbol or a future-dated timestamp should stop an inference, not be filled with a guessed value.']},
        {title: 'Read liquidity alongside price and volume', paragraphs: ['A quoted price can move sharply in a thin pool. Inspect liquidity before interpreting a percentage increase or assuming a position could be exited at the displayed price.', 'Reported volume and liquidity are observations, not execution guarantees. Route availability, slippage, fees and pool changes can prevent a trade from matching a chart-based return.']},
        {title: 'Understand holder and authority limitations', paragraphs: ['Holder count and top-holder concentration describe a snapshot, not beneficial ownership. Related addresses may split one economic position across many wallets.', 'Mint and freeze authorities, developer balances and honeypot indicators need their own evidence. Missing developer attribution must remain unknown rather than appearing as a zero-percent holding. A fresh risk row is not a declaration that a token is safe.']},
        {title: 'Demand fresh evidence and honest outcomes', paragraphs: ['Narrax Early Radar uses a 15-minute price freshness gate and a 60-minute holder freshness gate alongside its other publication rules. Passing a freshness gate only establishes recency, not investment quality.', 'Later horizons that cannot be measured remain unknown. Research should not backfill a convenient entry, replace an unavailable observation with a hindsight price or present gross token returns as actual wallet profit.']},
      ],
      checklist: ['Verify the mint and market pair.', 'Identify market-cap versus fully diluted valuation assumptions.', 'Check liquidity and concentration, not price alone.', 'Keep missing authority and developer evidence unknown.', 'Read timestamps and execution limitations before interpreting returns.'],
    },
  ],
  id: [
    {
      slug: 'solana-narrative-research', title: 'Cara meriset narasi kripto di Solana',
      description: 'Bedakan narasi kripto dari promosi token: periksa sumber asli, pastikan alamat token Solana, dan uji apakah perhatian didukung bukti pasar.',
      intro: 'Narasi kripto adalah penjelasan bersama tentang mengapa suatu topik dianggap penting. Perhatian bisa menyebar sebelum token memiliki adopsi, likuiditas, atau hubungan yang jelas dengan topik tersebut. Riset dimulai dengan menguji hubungan itu, bukan membeli labelnya.',
      sections: [
        {title: 'Mulai dari sumber asli', paragraphs: ['Temukan pengumuman, rilis, proposal, atau peristiwa yang memicu pembicaraan. Catat penerbit dan waktunya. Banyak akun yang mengutip satu pengumuman bukan berarti ada banyak konfirmasi independen.', 'Bedakan peristiwa produk yang dapat diverifikasi dari spekulasi, promosi berbayar, dan tangkapan layar daur ulang. Unggahan sosial membuktikan adanya klaim, tetapi tidak otomatis membuktikan kebenaran klaim tersebut.']},
        {title: 'Hubungkan topik dengan token yang tepat', paragraphs: ['Ticker bukan identitas. Token berbeda dapat memakai simbol yang sama, dan alamat pool belum tentu alamat mint. Pastikan mint Solana yang tepat dan periksa apakah sumber benar-benar menyebut token itu.', 'Nama token yang mirip frasa populer hanya menghasilkan kandidat hubungan. Biarkan hubungan yang meragukan belum terselesaikan; jangan memilih token hanya karena paling ramai.']},
        {title: 'Bandingkan perhatian dengan bukti pasar', paragraphs: ['Periksa waktu serta asal data harga, likuiditas, dan holder. Data holder yang tidak tersedia berarti tidak diketahui, bukan nol. Harga terkini tidak membuat snapshot holder lama menjadi terkini.', 'Perhatian tanpa likuiditas memadai belum tentu dapat diperdagangkan. Jumlah holder tidak membuktikan kepemilikan independen. Lonjakan volume dapat mencerminkan konsentrasi atau aktivitas buatan; satu metrik tidak cukup untuk mengesahkan narasi.']},
        {title: 'Ukur ke depan, bukan dari daftar pemenang', paragraphs: ['Bekukan bukti yang tersedia saat observasi riset diterbitkan, lalu ukur harga berikutnya terhadap entri tersebut. Pertahankan kandidat gagal dan hasil yang tidak tersedia agar sampel tidak hanya berisi pemenang yang bertahan.', 'Imbal hasil harga token bukan hasil transaksi yang pasti bisa dieksekusi. Biaya, spread, slippage, perubahan likuiditas, dan kegagalan eksekusi dapat mengubah hasil nyata. Sampel kecil belum membuktikan keunggulan berulang.']},
      ],
      checklist: ['Simpan sumber asli dan waktu penerbitannya.', 'Pastikan mint; jangan mengandalkan kemiripan ticker.', 'Periksa waktu harga, likuiditas, dan holder secara terpisah.', 'Tandai hubungan meragukan dan hasil yang hilang sebagai tidak diketahui.', 'Bandingkan hasil berikutnya tanpa menulis ulang bukti awal.'],
    },
    {
      slug: 'smart-money-wallet-research', title: 'Cara mengevaluasi wallet smart money Solana',
      description: 'Evaluasi kelengkapan riwayat wallet, hasil terealisasi, entitas independen, dan aliran token terkini sebelum menafsirkan label smart money di Solana.',
      intro: '“Smart money” adalah label riset, bukan fakta on-chain. Satu transaksi untung atau akun terkenal belum membuktikan keahlian berulang. Pertanyaannya adalah apakah wallet memiliki bukti yang cukup lengkap, terkini, dan dapat diverifikasi untuk diteliti.',
      sections: [
        {title: 'Periksa riwayat sebelum kinerja', paragraphs: ['Pastikan periode observasi, cakupan token, dan apakah sumber data mencapai batas paginasi. Riwayat terpotong dapat menghilangkan transaksi rugi atau pembelian yang menjelaskan penjualan berikutnya.', 'Penjualan tanpa pembelian yang cocok, transfer, airdrop, dan biaya perolehan yang tidak lengkap mempersulit perhitungan laba. Jangan menganggap biaya yang tidak diketahui sebagai nol atau menghapus baris yang gagal diproses secara diam-diam.']},
        {title: 'Pisahkan hasil terealisasi dari posisi terbuka', paragraphs: ['Kenaikan nilai posisi terbuka bukan keuntungan yang sudah ditutup. Periksa transaksi tertutup, hasil lintas token, dan distribusi hasil, bukan hanya laba total atau pemenang terbesar.', 'Hasil historis positif dapat terkonsentrasi pada satu token atau periode singkat. Tinjau median imbal hasil, kebaruan data, dan ukuran sampel bersama-sama. Pemeriksaan ini mendisiplinkan riset, bukan meramalkan kinerja.']},
        {title: 'Hitung entitas independen, bukan alamat saja', paragraphs: ['Beberapa alamat mungkin memiliki sumber pendanaan atau operator yang sama. Dua pembelian wallet belum tentu dua keputusan independen. Periksa bukti klaster dan nyatakan hubungan yang belum jelas.', 'Observasi aliran memerlukan jendela waktu, arah bersih, dan konteks pasar terkini. Pembelian lama yang dipasangkan dengan harga baru dapat menyesatkan gambaran permintaan saat ini.']},
        {title: 'Pisahkan penemuan dari kualifikasi', paragraphs: ['Pembeli awal adalah petunjuk untuk penyelidikan, bukan otomatis wallet yang disetujui, trader untung, atau anjuran menyalin transaksi. Tinjauan manusia tidak boleh mengesampingkan riwayat yang hilang atau bukti kedaluwarsa.', 'Narrax memisahkan penemuan kandidat dari kualifikasi. Ketersediaan langsung bergantung pada kesiapan pengumpulan dan bukti yang memenuhi syarat; adanya fitur riset tidak berarti sudah ada kelompok wallet berkualifikasi saat ini.']},
      ],
      checklist: ['Pastikan kelengkapan riwayat dan tanggal observasi.', 'Pisahkan hasil tertutup dari posisi belum terealisasi.', 'Selidiki penjualan tanpa pasangan dan biaya perolehan yang hilang.', 'Periksa apakah banyak alamat mewakili entitas independen.', 'Perlakukan label dan imbal hasil lalu sebagai hipotesis, bukan janji.'],
    },
    {
      slug: 'early-token-risk-checklist', title: 'Daftar periksa riset dan risiko token awal Solana',
      description: 'Periksa identitas mint, likuiditas, konsentrasi holder, otoritas, dan kesegaran bukti token awal Solana. Data hilang bukan tanda aman.',
      intro: 'Aktivitas token awal bisa bising, tidak likuid, dan penuh manipulasi. Grafik populer bukan audit keamanan, dan skor risiko rendah tidak menghilangkan kemungkinan rugi. Riset dimulai dari apa yang benar-benar diketahui saat observasi.',
      sections: [
        {title: 'Verifikasi identitas dan asal data pasar', paragraphs: ['Cocokkan mint yang tepat dengan pasangan pasar dan sumber yang dibaca. Periksa apakah kapitalisasi pasar memakai suplai beredar atau hanya proksi valuasi terdilusi penuh.', 'Catat waktu pengamatan harga dan apakah sumber pasar mengenali token. Harga hilang, simbol ambigu, atau waktu di masa depan harus menghentikan kesimpulan, bukan diisi dengan perkiraan.']},
        {title: 'Baca likuiditas bersama harga dan volume', paragraphs: ['Harga dapat bergerak tajam di pool tipis. Periksa likuiditas sebelum menafsirkan persentase kenaikan atau menganggap posisi dapat dijual pada harga layar.', 'Volume dan likuiditas adalah observasi, bukan jaminan eksekusi. Ketersediaan rute, slippage, biaya, dan perubahan pool dapat membuat hasil transaksi berbeda dari grafik.']},
        {title: 'Pahami batas data holder dan otoritas', paragraphs: ['Jumlah holder dan konsentrasi holder besar menggambarkan snapshot, bukan pemilik manfaat akhir. Alamat terkait dapat memecah satu posisi ekonomi menjadi banyak wallet.', 'Otoritas mint dan freeze, saldo developer, serta indikator honeypot membutuhkan bukti masing-masing. Atribusi developer yang hilang harus tetap tidak diketahui, bukan kepemilikan nol persen. Baris risiko terkini bukan pernyataan bahwa token aman.']},
        {title: 'Tuntut bukti terkini dan hasil yang jujur', paragraphs: ['Early Radar Narrax memakai batas kesegaran harga 15 menit dan holder 60 menit bersama aturan penerbitan lainnya. Lolos pemeriksaan kesegaran hanya membuktikan kebaruan, bukan mutu investasi.', 'Horizon berikutnya yang tidak dapat diukur tetap tidak diketahui. Riset tidak boleh mengisi entri yang menguntungkan secara retrospektif, mengganti observasi hilang dengan harga setelah kejadian, atau menyajikan imbal hasil token bruto sebagai laba wallet nyata.']},
      ],
      checklist: ['Verifikasi mint dan pasangan pasar.', 'Bedakan kapitalisasi pasar dari asumsi valuasi terdilusi penuh.', 'Periksa likuiditas dan konsentrasi, bukan harga saja.', 'Biarkan bukti otoritas dan developer yang hilang tetap tidak diketahui.', 'Baca waktu observasi dan batas eksekusi sebelum menafsirkan hasil.'],
    },
  ],
};

export function findResearchGuide(locale: SeoLocale, slug: string) {
  return researchGuides[locale].find(guide => guide.slug === slug);
}
export const researchReferences = [
  {name: 'Solana documentation: accounts', url: 'https://solana.com/docs/core/accounts'},
  {name: 'Solana documentation: transactions', url: 'https://solana.com/docs/core/transactions'},
  {name: 'Solana documentation: token authorities', url: 'https://solana.com/docs/tokens/basics/set-authority'},
  {name: 'DEX Screener API reference', url: 'https://docs.dexscreener.com/api/reference'},
] as const;

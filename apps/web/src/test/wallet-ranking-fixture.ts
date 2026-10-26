import { WalletRankingPage } from '@narra/shared';
import { ADDRESS } from './fixtures';
export const rankingFixture=WalletRankingPage.parse({
 asOf:'2026-10-26T12:00:00.000Z',band:'SMALL_CAP',windowDays:30,total:1,capped:false,
 pipeline:{checkedAt:'2026-10-26T12:00:00.000Z',historyEnabled:true,providerConfigured:true,intakeAdded:2,scanned:2,failures:0},
 items:[{address:ADDRESS,label:'Evaluation fixture',review:'PROVISIONAL',status:'OBSERVING',reasons:['HISTORY_INCOMPLETE'],checkedAt:'2026-10-26T12:00:00.000Z',historyComplete:false,linked:false,developer:false,
 performance:{band:'SMALL_CAP',positions:22,closedPositions:20,closedTokens:6,wins:16,losses:4,breakeven:0,openPositions:2,winRate:.8,winRateLowerBound:.584,realisedPnlSol:'12.345678901',openCostSol:'8',medianRoi:.4,medianWinSol:'2',medianLossSol:'-3',profitFactor:2,medianFirstSellSeconds:900,medianCloseSeconds:3600,realisedDrawdownSol:'5',observedDays:14,fastCloseRate:0}}],
});

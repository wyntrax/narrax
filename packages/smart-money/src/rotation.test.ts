import { expect, it } from 'vitest';
import { rotationRate } from './style';
import { MIN_CLOSED_LEGS } from './score';
import type { TradeRow } from './stats';

const trade = (side: 'BUY' | 'SELL', token: string, at: number): TradeRow => ({ wallet:'w', token, side, at:new Date(at), sol:1, qty:1 });
const sells = (token='A', at=0) => Array.from({length:MIN_CLOSED_LEGS},()=>trade('SELL',token,at));
// Original definition as an independent reference for unordered/tied inputs.
function reference(rows: TradeRow[], windowMs: number) {
  const s=rows.filter(t=>t.side==='SELL'),b=rows.filter(t=>t.side==='BUY');
  return s.length<MIN_CLOSED_LEGS ? 0 : s.filter(s=>b.some(b=>b.token!==s.token && b.at>s.at && +b.at-+s.at<=windowMs)).length/s.length;
}

it('keeps the minimum-sell sample rule',()=>{
  expect(rotationRate([...sells().slice(1),trade('BUY','B',1)])).toBe(0);
  expect(rotationRate([...sells(),trade('BUY','B',1)])).toBe(1);
});
it('excludes same-time, earlier and same-token buys; includes the exact upper boundary',()=>{
  const rows=[...sells(),trade('BUY','B',0),trade('BUY','B',-1),trade('BUY','A',1)];
  expect(rotationRate(rows,10)).toBe(0);
  expect(rotationRate([...rows,trade('BUY','B',10)],10)).toBe(1);
  expect(rotationRate([...rows,trade('BUY','B',11)],10)).toBe(0);
});
it('finds a different token after consecutive same-token buys, including tied timestamps',()=>{
  const rows=[...sells(),trade('BUY','A',2),trade('BUY','A',1),trade('BUY','B',2),trade('BUY','A',2)];
  expect(rotationRate(rows,2)).toBe(1);
  expect(rotationRate(rows,1)).toBe(0);
  expect(rotationRate(rows.slice().reverse(),2)).toBe(1);
});
it('retains invalid-date sells in the denominator but never treats invalid dates as rotations',()=>{
  const rows=[...sells(),trade('SELL','A',NaN),trade('BUY','B',NaN)];
  expect(rotationRate(rows)).toBe(0);
  expect(rotationRate([...rows,trade('BUY','B',1)])).toBe(MIN_CLOSED_LEGS/(MIN_CLOSED_LEGS+1));
});
it('does not mutate caller order or dates',()=>{
  const rows=[trade('BUY','B',5),...sells(),trade('BUY','A',2)];
  const before=rows.slice(),times=rows.map(t=>+t.at);
  rotationRate(rows);
  expect(rows).toEqual(before);expect(rows.map(t=>+t.at)).toEqual(times);
});
it('matches the original definition across seeded randomized histories and windows',()=>{
  let seed=312;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let run=0;run<120;run++){
    const rows=Array.from({length:150},()=>trade(next()%3===0?'SELL':'BUY',String(next()%5),(next()%100-50)*1000));
    rows.push(trade('BUY','invalid',NaN),trade('SELL','invalid',NaN));
    for(const window of [-1,0,1,1000,600_000,Infinity,NaN])expect(rotationRate(rows,window)).toBe(reference(rows,window));
  }
});
it('handles a large non-rotating history without a quadratic number of date comparisons',()=>{
  let reads=0;
  const rows=Array.from({length:20_000},(_,i)=>{
    const t=i<10_000 ? trade('BUY','B',i) : trade('SELL','A',i);
    const at=t.at;
    t.at={ getTime:()=>{reads++;return +at;}, valueOf:()=>{reads++;return +at;} } as Date;
    return t;
  });
  expect(rotationRate(rows)).toBe(0);
  expect(reads).toBeLessThanOrEqual(rows.length*2);
});

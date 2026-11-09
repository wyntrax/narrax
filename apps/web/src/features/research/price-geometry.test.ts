import {it,expect} from 'vitest';
import {priceGeometry} from './price-geometry';
const point=(minutes:number,priceUsd=1,pairAddress='pool')=>({at:new Date(Date.UTC(2026,9,18,0,minutes)).toISOString(),priceUsd,source:'dexscreener' as const,pairAddress});
it('uses timestamp spacing rather than evenly distributing sparse prices',()=>{
 const {samples}=priceGeometry([point(0),point(5,2),point(20,3)]);
 expect((samples[1]!.x-samples[0]!.x)/(samples[2]!.x-samples[0]!.x)).toBe(.25);
 expect(samples[2]!.y).toBeLessThan(samples[0]!.y);
});
it('auto-selects a logarithmic domain for a collapse without inventing intermediate observations',()=>{
 const points=[point(0,.0002),point(5,.0001),point(30,.000002),point(35,.0000022)];
 const result=priceGeometry(points);
 expect(result.log).toBe(true);expect(result.ticks.every(t=>t.value>0)).toBe(true);
 expect(result.samples).toHaveLength(4);expect(result.segments).toHaveLength(2);
 expect(result.samples[2]!.y-result.samples[3]!.y).toBeGreaterThan(1);
 expect(priceGeometry(points,'linear').log).toBe(false);
 expect(priceGeometry([point(0,1)],'log').samples[0]!.y).toBeTypeOf('number');
});
it('breaks collection gaps and pool switches; a single or flat price stays finite',()=>{
 expect(priceGeometry([point(0),point(5),point(30),point(35,1,'different')]).segments.map(s=>s.length)).toEqual([2,1,1]);
 for(const sample of priceGeometry([point(0),point(5)]).samples)expect(Number.isFinite(sample.y)).toBe(true);
 expect(priceGeometry([point(0)]).samples[0]!.x).toBe(385);
 expect(priceGeometry([]).samples).toEqual([]);
});

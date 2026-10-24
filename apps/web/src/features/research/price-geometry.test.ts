import {it,expect} from 'vitest';
import {priceGeometry} from './price-geometry';
const point=(minutes:number,priceUsd=1,pairAddress='pool')=>({at:new Date(Date.UTC(2026,9,18,0,minutes)).toISOString(),priceUsd,source:'dexscreener' as const,pairAddress});
it('uses timestamp spacing rather than evenly distributing sparse prices',()=>{
 const {samples}=priceGeometry([point(0),point(5,2),point(20,3)]);
 expect((samples[1]!.x-samples[0]!.x)/(samples[2]!.x-samples[0]!.x)).toBe(.25);
 expect(samples[2]!.y).toBeLessThan(samples[0]!.y);
});
it('breaks collection gaps and pool switches; a single or flat price stays finite',()=>{
 expect(priceGeometry([point(0),point(5),point(30),point(35,1,'different')]).segments.map(s=>s.length)).toEqual([2,1,1]);
 for(const sample of priceGeometry([point(0),point(5)]).samples)expect(Number.isFinite(sample.y)).toBe(true);
 expect(priceGeometry([point(0)]).samples[0]!.x).toBe(385);
 expect(priceGeometry([]).samples).toEqual([]);
});

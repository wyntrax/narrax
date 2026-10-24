import type {PricePoint} from './contracts';

/** Preserve real observation spacing. A long collection gap or pool switch breaks the line. */
export function priceGeometry(points:PricePoint[]){
 const left=90,right=680,top=30,bottom=210;
 if(!points.length)return {samples:[],segments:[],low:0,high:0};
 const min=Math.min(...points.map(p=>p.priceUsd)),max=Math.max(...points.map(p=>p.priceUsd));
 const padding=(max-min||max*.02)*.12;
 const low=Math.max(0,min-padding),high=max+padding;
 const first=Date.parse(points[0]!.at),last=Date.parse(points[points.length-1]!.at);
 const samples=points.map(point=>({...point,x:last===first?(left+right)/2:left+(Date.parse(point.at)-first)/(last-first)*(right-left),y:bottom-(point.priceUsd-low)/(high-low)*(bottom-top)}));
 const segments:typeof samples[]=[];
 for(const sample of samples){const segment=segments[segments.length-1],previous=segment?.[segment.length-1];if(!previous||Date.parse(sample.at)-Date.parse(previous.at)>20*60_000||sample.pairAddress!==previous.pairAddress)segments.push([sample]);else segment!.push(sample);}
 return {samples,segments,low,high};
}

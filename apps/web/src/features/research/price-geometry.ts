import type {PricePoint} from './contracts';

/** Preserve real observation spacing. A long collection gap or pool switch breaks the line. */
export function priceGeometry(points:PricePoint[],scale:'auto'|'linear'|'log'='auto'){
 const left=90,right=680,top=30,bottom=210;
 if(!points.length)return {samples:[],segments:[],low:0,high:0,ticks:[],log:false};
 const min=Math.min(...points.map(p=>p.priceUsd)),max=Math.max(...points.map(p=>p.priceUsd));
 const log=min>0&&(scale==='log'||scale==='auto'&&max/min>=10);
 const transform=(n:number)=>log?Math.log10(n):n,inverse=(n:number)=>log?10**n:n;
 const lo=transform(min),hi=transform(max),padding=(hi-lo||Math.max(Math.abs(hi),.01)*.02)*.12;
 const low=log?lo-padding:Math.max(0,lo-padding),high=hi+padding;
 const first=Date.parse(points[0]!.at),last=Date.parse(points[points.length-1]!.at);
 const samples=points.map(point=>({...point,x:last===first?(left+right)/2:left+(Date.parse(point.at)-first)/(last-first)*(right-left),y:bottom-(transform(point.priceUsd)-low)/(high-low)*(bottom-top)}));
 const segments:typeof samples[]=[];
 for(const sample of samples){const segment=segments[segments.length-1],previous=segment?.[segment.length-1];if(!previous||Date.parse(sample.at)-Date.parse(previous.at)>20*60_000||sample.pairAddress!==previous.pairAddress)segments.push([sample]);else segment!.push(sample);}
 const ticks=[0,.25,.5,.75,1].map(fraction=>({y:bottom-fraction*(bottom-top),value:inverse(low+fraction*(high-low))}));
 return {samples,segments,low:inverse(low),high:inverse(high),ticks,log};
}

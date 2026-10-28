import { expect, it } from 'vitest';
import bs58 from 'bs58';
import { previewWalletAdmission, type AdmissionPreviewOptions } from './walletAdmissionPreview';

const now=new Date('2040-01-01T12:00:00Z');
const address=(n:number)=>bs58.encode(Buffer.alloc(32,n));
function candidate(n:number,matched=2,unknown=0,median:string|null='0.01'){
 return {address:address(n),scannedTokens:matched+unknown,spend:{version:1,observedTokens:matched+unknown,matchedTokens:matched,unknownTokens:unknown,
  medianMatchedQuoteSol:median,unknownReasons:unknown?{LEGACY_NO_SPEND_EVIDENCE:unknown}:{}}};
}
function run(items:unknown[],options:Partial<AdmissionPreviewOptions>={},over:Record<string,unknown>={}){
 return previewWalletAdmission({now,snapshot:{checkedAt:now.toISOString(),total:items.length,capped:false,items},occupied:0,trackedAddresses:[],rejectedAddresses:[],...over},options);
}
it('ranks by coverage and distinct-token support, not quote size or snapshot position',()=>{
 const huge=candidate(1,2,0,'100'),repeat=candidate(2,4,0,'0.02'),partial=candidate(3,6,2,'1');
 const r=run([huge,partial,repeat],{minCoveragePercent:50,explorationSlots:0});
 expect(r.proposal.assumingFreeSlots).toEqual([repeat.address,huge.address]);
 expect(r.items.find(w=>w.address===partial.address)?.previewRank).toBe(3);
 expect(r.currentPolicy.assumingFreeSlots).toEqual([huge.address,partial.address]);
});
it('uses deterministic address ordering for equal evidence, independently of spend size',()=>{
 const a=candidate(4,2,0,'1'),b=candidate(5,2,0,'0.01');
 const sorted=[a.address,b.address].sort((a,b)=>a.localeCompare(b));
 expect(run([b,a],{explorationSlots:0}).proposal.assumingFreeSlots).toEqual(sorted);
});
it('reserves exploration in existing order and never borrows unused slots',()=>{
 const evidence=candidate(1),unknown=candidate(2,0,3,null),unknown2=candidate(3,0,20,null);
 expect(run([unknown,evidence,unknown2]).proposal.assumingFreeSlots).toEqual([evidence.address,unknown.address]);
 expect(run([evidence]).proposal).toMatchObject({assumingFreeSlots:[evidence.address],unusedAllocatedSlots:1});
 expect(run([unknown]).proposal).toMatchObject({assumingFreeSlots:[unknown.address],unusedAllocatedSlots:1});
 expect(run([unknown],{explorationSlots:0}).proposal.assumingFreeSlots).toEqual([]);
});
it('shows hypothetical priority at full capacity but zero possible additions',()=>{
 const r=run([candidate(1),candidate(2,0,2,null)],{}, {occupied:200});
 expect(r.capacity).toMatchObject({occupied:200,available:0,limit:200});
 expect(r.proposal).toMatchObject({status:'CAPACITY_REACHED',assumingFreeSlots:[address(1),address(2)],withinCurrentCapacity:[]});
 expect(r.currentPolicy.withinCurrentCapacity).toEqual([]);
});
it('allocates one remaining seat to evidence first and reports over-capacity without suggesting removals',()=>{
 expect(run([candidate(2,0,2,null),candidate(1)],{}, {occupied:199}).proposal.withinCurrentCapacity).toEqual([address(1)]);
 expect(run([candidate(1)],{}, {occupied:205}).capacity).toMatchObject({available:0,overCapacity:true});
});
it('excludes all tracked identities and rejected suggestions before limits and counts',()=>{
 const r=run([candidate(1),candidate(2),candidate(3),candidate(4,0,2,null)],{}, {trackedAddresses:[address(1)],rejectedAddresses:[address(2)]});
 expect(r.counts).toEqual({evidence:1,exploration:1,excluded:2,belowPreview:0});
 expect(r.proposal.assumingFreeSlots).toEqual([address(3),address(4)]);
 expect(r.currentPolicy.assumingFreeSlots).toEqual([address(3),address(4)]);
});
it('invalid addresses cannot occupy either lane',()=>{
 const bad={...candidate(1),address:'invalid'};
 expect(run([bad]).items[0]).toMatchObject({lane:'EXCLUDED',exclusions:['INVALID_ADDRESS']});
});
it('keeps precise decimal boundaries including a half-lamport median',()=>{
 const small=candidate(1,2,0,'0.0099999995'),exact=candidate(2,2,0,'0.01');
 const r=run([small,exact],{explorationSlots:0});
 expect(r.proposal.assumingFreeSlots).toEqual([exact.address]);
 expect(r.items[0]).toMatchObject({lane:'BELOW_PREVIEW',reasons:['MATCHED_SIZE_BELOW_PREVIEW']});
});
it('zero size threshold does not turn unknown evidence into known matches',()=>{
 const r=run([candidate(1,0,2,null),candidate(2,2,0,'0.000000001')],{minQuoteSol:'0',explorationSlots:0});
 expect(r.proposal.assumingFreeSlots).toEqual([address(2)]);
 expect(r.items[0]?.reasons).toContain('MATCHED_SIZE_UNKNOWN');
});
it('partial evidence requires explicit coverage relaxation; unknowns remain visible',()=>{
 const c=candidate(1,2,2);
 expect(run([c]).items[0]).toMatchObject({lane:'EXPLORATION',matchedCoveragePercent:50,evidenceStatus:'PARTIAL'});
 expect(run([c],{minCoveragePercent:50}).items[0]).toMatchObject({lane:'EVIDENCE',spend:{unknownTokens:2}});
 expect(run([c],{minCoveragePercent:51}).items[0]?.lane).toBe('EXPLORATION');
});
it.each(['denominator','reasons','median','text median','zero amount','observed','missing'])('retains unusable spend as exploration with explicit diagnostics: %s',kind=>{
 const c:Record<string,any>=candidate(1);
 if(kind==='denominator')c.spend.unknownTokens=1;
 if(kind==='reasons')c.spend.unknownReasons={BAD:2};
 if(kind==='median')c.spend.medianMatchedQuoteSol='NaN';
 if(kind==='text median')c.spend.medianMatchedQuoteSol='not-a-number';
 if(kind==='zero amount')c.spend.medianMatchedQuoteSol='0';
 if(kind==='observed')c.scannedTokens=3;
 if(kind==='missing')delete c.spend;
 expect(run([c]).items[0]).toMatchObject({lane:'EXPLORATION',evidenceStatus:kind==='missing'?'MISSING':'INVALID',spend:null});
});
it.each(['STALE','FUTURE','INVALID_OR_MISSING'])('blocks both plans when snapshot is %s',status=>{
 const items=[candidate(1)];
 const snapshot=status==='INVALID_OR_MISSING'?null:{items,total:1,capped:false,checkedAt:new Date(+now+(status==='STALE'?-3600001:1)).toISOString()};
 const r=run(items,{}, {snapshot});
 expect(r.snapshot.status).toBe(status);expect(r.proposal.assumingFreeSlots).toEqual([]);expect(r.currentPolicy.assumingFreeSlots).toEqual([]);
});
it('accepts the exact freshness boundary and explicitly limits scope for capped snapshots',()=>{
 const items=[candidate(1)];const r=run(items,{}, {snapshot:{items,total:100,capped:true,checkedAt:new Date(+now-3600000).toISOString()}});
 expect(r.snapshot).toMatchObject({status:'FRESH',total:100,displayed:1,capped:true});expect(r.proposal.assumingFreeSlots).toEqual([address(1)]);
});
it.each(['duplicate','total','capped'])('does not plan from inconsistent snapshot metadata: %s',kind=>{
 const items=kind==='duplicate'?[candidate(1),candidate(1)]:[candidate(1)];
 const r=run(items,{}, {snapshot:{items,total:kind==='total'?0:items.length,capped:kind==='capped',checkedAt:now.toISOString()}});
 expect(r.snapshot.status).toBe('INVALID_OR_MISSING');expect(r.items).toEqual([]);
});
it.each([{minQuoteSol:'-1'},{minQuoteSol:'1e2'},{minMatchedTokens:1},{minCoveragePercent:101},{explorationSlots:3}])('rejects invalid scenario options %j',options=>{
 expect(()=>run([],options)).toThrow();
});

import {z} from 'zod';
import {DescribedSchema} from './contracts';

const date=z.string().datetime({offset:true}),text=z.string().max(20000),number=z.number().finite(),count=number.int().nonnegative();
export const BacktestCoverageSchema=z.object({from:date,to:date,tokens:count,metricPoints:count,firstPointAt:date.nullable(),lastPointAt:date.nullable(),medianGapMinutes:number.nonnegative().nullable(),decisions:count,buyDecisions:count});
export type BacktestCoverage=z.infer<typeof BacktestCoverageSchema>;
export const BacktestSummarySchema=z.discriminatedUnion('available',[
 z.object({available:z.literal(false)}),
 z.object({available:z.literal(true),id:text,createdAt:date,generatedAt:date.nullable(),coverage:BacktestCoverageSchema.nullable(),findings:z.array(text),noConclusion:z.array(text),caveats:z.array(text)})
]);
export const BacktestRunsSchema=z.object({items:z.array(z.object({id:text,kind:text,createdAt:date,coverage:BacktestCoverageSchema.nullable(),findings:count,noConclusion:count}))});
const Strategy=z.object({name:text,events:count,pending:count,unknown:count,unknownRate:number.min(0).max(1).nullable(),hold:DescribedSchema,withRules:DescribedSchema,withOwnExit:DescribedSchema.nullable(),holdMeanIfUnknownTotalLoss:number.nullable(),medianLeadTimeSeconds:number.nullable()});
const Comparison=z.object({diff:number.nullable(),ci:z.tuple([number,number]).nullable(),verdict:z.enum(['INSUFFICIENT_DATA','NO_CLEAR_DIFFERENCE','BETTER','WORSE']),note:text.nullable()});
export const BacktestDetailSchema=z.object({id:text,kind:text,createdAt:date,report:z.object({generatedAt:date,coverage:BacktestCoverageSchema,costPct:number.nonnegative(),strategies:z.array(Strategy),comparisons:z.array(z.object({name:text,vsBaselineHold:Comparison,vsBaselineRules:Comparison})),findings:z.array(text),noConclusion:z.array(text)}),gates:z.object({minSample:count,minDistinctTokens:count})});

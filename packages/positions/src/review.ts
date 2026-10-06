import type { Evaluation, ExitAction } from './evaluate';
import { MONITOR_RULES } from './rules';

export interface ReviewInput { action: ExitAction; confidence: number; reasonCodes: string[] }

export interface Combined {
  evaluation: Evaluation;
  /** Whether the review changed the outcome. */
  reviewApplied: boolean;
  /** Why a review was set aside, when it was. */
  reviewNote: string | null;
}

/** Minimum confidence for a review to turn a HOLD into a REDUCE. A starting value. */
export const REVIEW_MIN_CONFIDENCE = 0.7;

/**
 * An AI review is one input, and it can only make an exit more cautious, and only by one step:
 * it may turn a deterministic HOLD into a REDUCE, when it is confident. It can never turn anything into a SELL,
 * and it can never soften a REDUCE or SELL. A missing or failed review leaves the deterministic result untouched.
 */
export function combineWithReview(det: Evaluation, review: ReviewInput | null): Combined {
  if (!review) return { evaluation: det, reviewApplied: false, reviewNote: 'no review' };
  if (review.action === 'HOLD') return { evaluation: det, reviewApplied: false, reviewNote: 'review agreed with the rules or saw no reason to act' };
  if (det.action !== 'HOLD') return { evaluation: det, reviewApplied: false, reviewNote: det.action === 'REDUCE' && review.action === 'SELL' ? 'review wanted a full sell; rules decide the size' : 'rules had already decided' };
  if (review.confidence < REVIEW_MIN_CONFIDENCE) return { evaluation: det, reviewApplied: false, reviewNote: 'review confidence below the threshold' };
  const code = 'AI_REVIEW_CAUTION';
  const signals = [...det.signals, { code, level: 'REDUCE' as const, detail: `An AI review advised reducing (${review.reasonCodes.slice(0, 3).join(', ') || 'no codes'}).` }];
  return {
    evaluation: { ...det, action: 'REDUCE', fractionPct: MONITOR_RULES.reduceFractionPct, signals, summary: `REDUCE: ${code}.` },
    reviewApplied: true, reviewNote: review.action === 'SELL' ? 'review wanted a full sell, applied as a reduce' : null,
  };
}

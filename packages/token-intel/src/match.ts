import { normalizeText } from '@narra/narrative';

const STOP = new Set(['the', 'of', 'and', 'coin', 'token', 'for', 'on']);
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

export const words = (s: string) => normalizeText(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
export const symbolKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9@$]/g, '');
/** Symbol with look-alike digits swapped for letters, so R0BOT and ROBOT compare equal. */
export const leetKey = (s: string) => symbolKey(s).replace(/[0134578@$]/g, (c) => LEET[c] ?? c);
const stem = (w: string) => w.slice(0, 5);

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length]![b.length]!;
}

export interface TokenText { symbol: string; name: string; description?: string | null }

/** How well a symbol fits a narrative name, 0 to 1. */
export function symbolScore(narrativeName: string, symbol: string): number {
  const nw = words(narrativeName);
  const sym = symbolKey(symbol);
  if (!nw.length || sym.length < 2) return 0;
  const joined = nw.join('');
  const acronym = nw.length >= 2 ? nw.map((w) => w[0]).join('') : '';
  if (sym === joined || (acronym.length >= 2 && sym === acronym) || nw.some((w) => w.length >= 3 && sym === w)) return 1;
  if (leetKey(symbol) === joined || nw.some((w) => w.length >= 4 && leetKey(symbol) === w)) return 0.9;
  for (const letters of [sym.replace(/[0-9]/g, ''), leetKey(symbol).replace(/[0-9]/g, '')]) {
    if (letters.length >= 4 && nw.some((w) => w.startsWith(letters) || (w.length >= 4 && letters.startsWith(w)))) return 0.85;
  }
  const ratio = 1 - levenshtein(sym, joined) / Math.max(sym.length, joined.length);
  return ratio >= 0.8 ? 0.7 : 0;
}

const overlap = (nw: string[], other: string[]) => (nw.length ? nw.filter((w) => other.some((o) => stem(o) === stem(w))).length / nw.length : 0);

/**
 * Match between a narrative and a token, 0 to 1, from symbol, name and description.
 * Noisy-OR of the three, so a strong symbol or name alone reaches 0.6, while a description alone tops out at 0.4.
 * Token text is untrusted metadata. It is only compared, never followed as an instruction.
 */
export function matchScore(narrativeName: string, t: TokenText): number {
  const nw = words(narrativeName);
  const sym = symbolScore(narrativeName, t.symbol);
  const name = overlap(nw, words(t.name));
  const desc = t.description ? overlap(nw, words(t.description)) : 0;
  return Math.round((1 - (1 - 0.7 * sym) * (1 - 0.6 * name) * (1 - 0.4 * desc)) * 1000) / 1000;
}

export const MATCH_THRESHOLD = 0.5;

import { createHash } from 'node:crypto';
import { sanitizeUntrusted } from '@narra/shared';

/** Canonical form of a topic name, so the same topic from two providers merges. */
export function normalizeTopic(raw: string): { name: string; slug: string } | null {
  const cleaned = sanitizeUntrusted(raw, 80).normalize('NFKC').replace(/[#@]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) return null;
  const slug = cleaned.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  const name = cleaned.split(' ').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
  return { name, slug };
}

export function normalizeHandle(raw: string): string {
  return sanitizeUntrusted(raw, 64).toLowerCase().replace(/^@/, '');
}

/** Lowercase, strip links, mentions and punctuation, so copy-pasted posts compare equal. */
export function normalizeText(raw: string): string {
  return sanitizeUntrusted(raw, 2000).toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[@#]\w+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const word64 = (w: string) => BigInt(`0x${sha256(w).slice(0, 16)}`);

/** 64-bit similarity hash as 16 hex chars. Near-duplicate texts differ in only a few bits. */
export function simhash64(normalized: string): string {
  const words = normalized.split(' ').filter(Boolean);
  if (!words.length) return '0'.repeat(16);
  const counts = new Array<number>(64).fill(0);
  for (const w of words) {
    const h = word64(w);
    for (let i = 0; i < 64; i++) counts[i]! += (h >> BigInt(i)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (counts[i]! > 0) out |= 1n << BigInt(i);
  return out.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

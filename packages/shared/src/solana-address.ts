const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map([...B58].map((c, i) => [c, BigInt(i)]));

/**
 * True only for a string that is valid base58 and decodes to exactly 32 bytes, like every Solana public key.
 * A looser check (base58 characters, 32 to 44 long) also accepts made-up strings that can never exist on chain,
 * so a fabricated address would get a Solscan link that shows nothing. This is a format check only: it cannot
 * say whether an address has ever been used.
 */
export function isSolanaAddress(s: string): boolean {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  let value = 0n, leadingZeros = 0, counting = true;
  for (const ch of s) {
    const digit = B58_MAP.get(ch);
    if (digit === undefined) return false;
    if (counting && ch === '1') leadingZeros++; else counting = false;
    value = value * 58n + digit;
  }
  let bytes = 0;
  for (let v = value; v > 0n; v >>= 8n) bytes++;
  return leadingZeros + bytes === 32;
}

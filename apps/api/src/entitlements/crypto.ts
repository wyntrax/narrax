import { createHash, randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const newNonce = () => randomBytes(32).toString('hex');
export function decodeBase58(value: string, size: number): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) || value.length > 100) return null;
  try { const bytes = bs58.decode(value); return bytes.length === size && bs58.encode(bytes) === value ? bytes : null; } catch { return null; }
}
export function verifyWalletProof(message: string, signature: string, address: string): boolean {
  const sig = decodeBase58(signature, 64), publicKey = decodeBase58(address, 32);
  if (!sig || !publicKey) return false;
  try { return ed25519.verify(sig, Buffer.from(message, 'utf8'), publicKey, { zip215: false }); } catch { return false; }
}
export function challengeMessage(v: { domain: string; userId: string; address: string; nonce: string; issuedAt: Date; expiresAt: Date }): string {
  return ['NARRAX wallet link v1', 'This proves wallet control for research access only. It authorizes no transaction.',
    `Domain: ${v.domain}`, `User: ${v.userId}`, 'Chain: solana', `Address: ${v.address}`, `Nonce: ${v.nonce}`,
    `Issued at: ${v.issuedAt.toISOString()}`, `Expires at: ${v.expiresAt.toISOString()}`].join('\n');
}

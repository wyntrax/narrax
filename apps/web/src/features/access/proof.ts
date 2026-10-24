import bs58 from 'bs58';
import {ApiError} from '@/lib/api';
import type {Challenge} from '@/lib/schemas';
/** Tolerated difference between this device's clock and the server's. The server remains the authority on expiry. */
export const CLOCK_SKEW_MS=60000;
/** Exact equality, no trimming, hostname normalization, or message reconstruction. */
export function validateChallenge(challenge:Challenge,origin:string,address:string,now=Date.now()) {
 const lines=challenge.message.split('\n');
 if(lines.filter(l=>l.startsWith('Domain:')).length!==1||!lines.includes(`Domain: ${origin}`))throw new ApiError('DOMAIN_MISMATCH');
 if(lines[0]!=='NARRA wallet link v1'||lines[1]!=='This proves wallet control for research access only. It authorizes no transaction.'||lines.length!==9||lines[4]!=='Chain: solana'||lines[5]!==`Address: ${address}`||!/^User: .+$/.test(lines[3]??'')||!/^Nonce: [a-f0-9]{64}$/.test(lines[6]??''))throw new ApiError('INVALID_INPUT');
 const expiry=Date.parse(challenge.expiresAt),issued=Date.parse(lines[7]?.slice('Issued at: '.length)??'');
 if(!lines[7]?.startsWith('Issued at: ')||lines[8]!==`Expires at: ${challenge.expiresAt}`||!Number.isFinite(issued)||issued>now+CLOCK_SKEW_MS||!Number.isFinite(expiry)||expiry+CLOCK_SKEW_MS<=now||expiry-issued>300000)throw new ApiError('CHALLENGE_UNAVAILABLE');
 return new TextEncoder().encode(challenge.message);
}
export function encodeSignature(signature:Uint8Array){if(!(signature instanceof Uint8Array)||signature.length!==64)throw new ApiError('INVALID_WALLET_PROOF');return bs58.encode(signature);}
export function validateAddress(address:string){try{const bytes=bs58.decode(address);if(bytes.length===32&&bs58.encode(bytes)===address)return address;}catch{}throw new ApiError('INVALID_INPUT');}

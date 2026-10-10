import {describe,it,expect} from 'vitest';
import bs58 from 'bs58';
import {validateChallenge,encodeSignature,validateAddress} from './proof';
import {challenge,ADDRESS} from '@/test/fixtures';
describe('message-only wallet proof boundary',()=>{
 it('returns exact UTF-8 bytes; origin includes scheme and port',()=>{const c=challenge();expect(validateChallenge(c,'http://localhost:4010',ADDRESS)).toEqual(new TextEncoder().encode(c.message));});
 it.each(['localhost:4010','http://localhost:4000','https://localhost:4010','http://localhost:4010/','http://localhost:4010.evil.test',' http://localhost:4010'])('refuses mismatched origin %s before any signer is called',origin=>{expect(()=>validateChallenge(challenge(origin),'http://localhost:4010',ADDRESS)).toThrow('DOMAIN_MISMATCH');});
 it('rejects duplicate domain, extra instructions, changed address and expired proof',()=>{const c=challenge();for(const message of [c.message+'\nDomain: http://localhost:4010',c.message+'\nAuthorize transfer',c.message.replace(ADDRESS,'11111111111111111111111111111111')])expect(()=>validateChallenge({...c,message},'http://localhost:4010',ADDRESS)).toThrow();expect(()=>validateChallenge(c,'http://localhost:4010',ADDRESS,Date.parse(c.expiresAt))).toThrow('CHALLENGE_UNAVAILABLE');});
 it('rejects future issuance, malformed dates, CRLF normalization and Unicode spoofing',()=>{const c=challenge();for(const message of [c.message.replace('Issued at: ','Issued at: invalid'),c.message.replaceAll('\n','\r\n'),c.message.replace('Domain:','Domaіn:')])expect(()=>validateChallenge({...c,message},'http://localhost:4010',ADDRESS)).toThrow();expect(()=>validateChallenge(challenge('http://localhost:4010',Date.now()+100000),'http://localhost:4010',ADDRESS)).toThrow();});
 it('base58-encodes exactly 64 signature bytes, preserving leading zero bytes',()=>{const sig=new Uint8Array(64);sig[63]=255;const encoded=encodeSignature(sig);expect(bs58.decode(encoded)).toEqual(sig);expect(encoded.startsWith('1')).toBe(true);for(const length of [0,32,63,65])expect(()=>encodeSignature(new Uint8Array(length))).toThrow();});
 it('accepts a canonical 32-byte address and refuses wrong lengths or characters',()=>{expect(validateAddress(ADDRESS)).toBe(ADDRESS);for(const address of ['0'.repeat(32),'1'.repeat(31),'1'.repeat(33)])expect(()=>validateAddress(address)).toThrow();});
});

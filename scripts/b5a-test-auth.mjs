// Local stand-in for Privy, for the B5a runbook only. Run from the repo root.
//   node scripts/b5a-test-auth.mjs init            -> makes .b5a-test-key.pem and prints the two env lines for the API
//   node scripts/b5a-test-auth.mjs token [name]    -> prints a 24h bearer token for user "did:privy:<name>" (default: owner)
//   node scripts/b5a-test-auth.mjs token <subject> --raw -> uses the subject exactly as supplied
//   node scripts/b5a-test-auth.mjs configure       -> sets local .env auth values from the existing test key, without printing them
// The API verifies tokens with PRIVY_VERIFICATION_KEY (public key) and PRIVY_APP_ID, so a keypair you made yourself works locally.
// Keep this for LOCAL use only. Never put this public key into a deployed environment.
import { generateKeyPair, exportSPKI, exportPKCS8, importPKCS8, SignJWT } from 'jose';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { parse } from 'dotenv';

const KEY_FILE = '.b5a-test-key.pem';
const APP_ID = 'b5a-local-test';
const [cmd, name = 'owner', ...flags] = process.argv.slice(2);
if (flags.some((flag) => flag !== '--raw') || (flags.length && cmd !== 'token') || (flags.includes('--raw') && name.startsWith('--'))) {
  console.error('usage: init | configure | token [name] [--raw]'); process.exit(1);
}

if (cmd === 'configure') {
  const contents = readFileSync('.env', 'utf8');
  const before = parse(contents);
  const database = new URL(process.env.DATABASE_URL || before.DATABASE_URL);
  console.log(`DATABASE_URL host=${database.hostname} db=${decodeURIComponent(database.pathname.slice(1))}`);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    console.error('Refusing local test-auth configuration for a non-local database.'); process.exit(1);
  }
  console.log('Confirmed local development database. Updating only local test-auth settings.');
  const publicPem = createPublicKey(readFileSync(KEY_FILE)).export({ type: 'spki', format: 'pem' }).toString().trim();
  const updates = { PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: publicPem };
  let next = contents;
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  for (const [setting, value] of Object.entries(updates)) {
    const assignment = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${setting}[ \\t]*=[ \\t]*(?:"[^"]*"|'[^']*'|[^\\r\\n]*)(?:[ \\t]*#[^\\r\\n]*)?[ \\t]*\\r?$`, 'gm');
    const line = `${setting}="${value.replace(/\n/g, '\\n')}"`;
    if (assignment.test(next)) { assignment.lastIndex = 0; next = next.replace(assignment, () => line); }
    else next += `${next.endsWith('\n') ? '' : newline}${line}${newline}`;
  }
  const after = parse(next);
  for (const setting of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const expected = Object.prototype.hasOwnProperty.call(updates, setting) ? updates[setting] : before[setting];
    if (after[setting] !== expected) { console.error(`Configuration check failed for ${setting}; .env not written.`); process.exit(1); }
  }
  writeFileSync('.env', next);
  console.log('PRIVY_APP_ID: set; PRIVY_VERIFICATION_KEY: set (SPKI public key). Values withheld.');
} else if (cmd === 'init') {
  if (existsSync(KEY_FILE)) { console.error(`${KEY_FILE} already exists; delete it to start over.`); process.exit(1); }
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  writeFileSync(KEY_FILE, await exportPKCS8(privateKey), { mode: 0o600 });
  const spki = (await exportSPKI(publicKey)).trim().replace(/\n/g, '\\n');
  console.log(`Add to .env (API process):\nPRIVY_APP_ID=${APP_ID}\nPRIVY_VERIFICATION_KEY="${spki}"`);
  console.log(`\nAdd ${KEY_FILE} to .gitignore. It only signs test tokens.`);
} else if (cmd === 'token') {
  const key = await importPKCS8(readFileSync(KEY_FILE, 'utf8'), 'ES256');
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(flags.includes('--raw') ? name : `did:privy:${name}`)
    .setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('24h').sign(key);
  console.log(token);
} else { console.error('usage: init | configure | token [name] [--raw]'); process.exit(1); }

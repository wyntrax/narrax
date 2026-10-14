// Checks that PRIVY_VERIFICATION_KEY is the key of the Privy app PRIVY_APP_ID, without needing a token.
// Run it in the same terminal where you set the API variables:   npm run check-privy
// It prints only OK or what is wrong, never the key. Privy publishes each app's public key at
// https://auth.privy.io/api/v1/apps/<app id>/jwks.json (PRIVY_JWKS_URL overrides this for testing).
import { checkPrivyKey } from '../apps/api/src/privy-key';

const fail = (message: string): never => { console.error(`PROBLEM: ${message}`); process.exit(1); };

async function main() {
  const appId = process.env.PRIVY_APP_ID?.trim(), raw = process.env.PRIVY_VERIFICATION_KEY;
  if (!appId) fail('PRIVY_APP_ID is not set in this terminal.');
  if (!raw?.trim()) fail('PRIVY_VERIFICATION_KEY is not set in this terminal.');
  const result = await checkPrivyKey(appId!, raw!, { url: process.env.PRIVY_JWKS_URL });
  if (result.ok) console.log(`OK: the verification key belongs to Privy app ${appId}. Make sure NEXT_PUBLIC_PRIVY_APP_ID in the web terminal is exactly this App ID.`);
  else fail(result.error === 'INVALID_PRIVY_KEY' ? 'PRIVY_VERIFICATION_KEY must be a complete P-256 public PEM key.' : result.error === 'PRIVY_UNREACHABLE' ? 'Could not reach Privy to compare keys.' : 'PRIVY_VERIFICATION_KEY does not match the published key for PRIVY_APP_ID.');
}
main();

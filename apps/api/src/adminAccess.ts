/**
 * Who is an admin.
 *
 * When `ADMIN_EMAIL` and/or `ADMIN_PRIVY_USER_ID` is set, the environment is the single source of truth: exactly the
 * listed account(s) are admin, and a database `isAdmin` flag on anyone else is ignored (fail closed, so a stray or
 * leftover admin row cannot keep access). When neither variable is set, the existing database flag is used, which keeps
 * local development and the test suite working unchanged.
 *
 * The Privy user id comes from the verified sign-in token, so it cannot be claimed by typing an address. An email only
 * counts when it was stored from a Privy-signed token (see `auth.ts`); a browser-supplied email is never used here.
 */
export interface AdminEnv {
  ADMIN_EMAIL?: string;
  ADMIN_PRIVY_USER_ID?: string;
}

export interface AdminAllowlist {
  emails: string[];
  privyUserIds: string[];
}

/** The identity fields needed to decide admin, independent of how the row was loaded. */
export interface AdminIdentity {
  privyUserId: string;
  email?: string | null;
}

/** The row shape a decision needs. `isAdmin` is only consulted when the environment lists nobody. */
export interface AdminUserRow {
  isAdmin: boolean;
  privyUserId: string;
  email: string | null;
}

const split = (value?: string) => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

/** Parses `ADMIN_EMAIL` / `ADMIN_PRIVY_USER_ID`. Both accept a comma-separated list; duplicates are collapsed. */
export function adminAllowlist(env: AdminEnv = process.env): AdminAllowlist {
  return {
    emails: [...new Set(split(env.ADMIN_EMAIL).map(normalizeEmail))],
    privyUserIds: [...new Set(split(env.ADMIN_PRIVY_USER_ID))],
  };
}

export const adminAllowlistConfigured = (list: AdminAllowlist): boolean => list.emails.length > 0 || list.privyUserIds.length > 0;

export function isAllowedAdmin(identity: AdminIdentity, list: AdminAllowlist): boolean {
  if (identity.privyUserId && list.privyUserIds.includes(identity.privyUserId)) return true;
  const email = identity.email ? normalizeEmail(identity.email) : '';
  return email !== '' && list.emails.includes(email);
}

/**
 * The one admin decision, used by every admin check: the HTTP pre-handler, `/v1/me`, and the entitlement actor checks.
 * Pure, so it is the same rule everywhere and is easy to test.
 */
export function decideIsAdmin(user: AdminUserRow | null, env: AdminEnv = process.env): boolean {
  if (!user) return false;
  const list = adminAllowlist(env);
  return adminAllowlistConfigured(list) ? isAllowedAdmin(user, list) : user.isAdmin;
}

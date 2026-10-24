import { describe, expect, it } from 'vitest';
import { adminAllowlist, adminAllowlistConfigured, decideIsAdmin, isAllowedAdmin, normalizeEmail } from './adminAccess';
import { linkedEmail } from './auth';

describe('admin allowlist', () => {
  it('parses a comma-separated list, trimming and lowercasing emails and dropping duplicates', () => {
    const list = adminAllowlist({ ADMIN_EMAIL: ' Owner@Example.com , second@example.com ,owner@example.com ', ADMIN_PRIVY_USER_ID: ' did:privy:one ,did:privy:two, did:privy:one ' });
    expect(list.emails).toEqual(['owner@example.com', 'second@example.com']);
    expect(list.privyUserIds).toEqual(['did:privy:one', 'did:privy:two']);
    expect(adminAllowlistConfigured(list)).toBe(true);
  });

  it('treats an empty or blank configuration as unset', () => {
    expect(adminAllowlistConfigured(adminAllowlist({}))).toBe(false);
    expect(adminAllowlistConfigured(adminAllowlist({ ADMIN_EMAIL: '   ', ADMIN_PRIVY_USER_ID: ',' }))).toBe(false);
    expect(normalizeEmail(' Person@Example.com ')).toBe('person@example.com');
  });

  it('matches on the Privy id or an email, and never on a partial or empty value', () => {
    const list = adminAllowlist({ ADMIN_EMAIL: 'owner@example.com', ADMIN_PRIVY_USER_ID: 'did:privy:one' });
    expect(isAllowedAdmin({ privyUserId: 'did:privy:one' }, list)).toBe(true);
    expect(isAllowedAdmin({ privyUserId: 'did:privy:other', email: 'Owner@Example.com' }, list)).toBe(true);
    expect(isAllowedAdmin({ privyUserId: 'did:privy:other', email: 'owner@example.com.evil.test' }, list)).toBe(false);
    expect(isAllowedAdmin({ privyUserId: 'did:privy:one.evil', email: null }, list)).toBe(false);
    expect(isAllowedAdmin({ privyUserId: '', email: '' }, list)).toBe(false);
  });
});

describe('decideIsAdmin', () => {
  const env = { ADMIN_EMAIL: 'owner@example.com', ADMIN_PRIVY_USER_ID: 'did:privy:owner' };

  it('denies anyone who is unknown', () => {
    expect(decideIsAdmin(null, env)).toBe(false);
  });

  it('accepts the configured account and ignores a leftover database flag on everyone else', () => {
    expect(decideIsAdmin({ isAdmin: false, privyUserId: 'did:privy:owner', email: null }, env)).toBe(true);
    expect(decideIsAdmin({ isAdmin: true, privyUserId: 'did:privy:stranger', email: 'stranger@example.com' }, env)).toBe(false);
    // A database admin without a verified email is only accepted when the id matches.
    expect(decideIsAdmin({ isAdmin: true, privyUserId: 'did:privy:stranger', email: null }, env)).toBe(false);
  });

  it('matches a stored email only when the environment lists it', () => {
    expect(decideIsAdmin({ isAdmin: false, privyUserId: 'did:privy:stranger', email: 'owner@example.com' }, env)).toBe(true);
    expect(decideIsAdmin({ isAdmin: false, privyUserId: 'did:privy:stranger', email: 'nobody@example.com' }, env)).toBe(false);
  });

  it('falls back to the database flag only when neither variable is set', () => {
    expect(decideIsAdmin({ isAdmin: true, privyUserId: 'did:privy:anyone', email: null }, {})).toBe(true);
    expect(decideIsAdmin({ isAdmin: false, privyUserId: 'did:privy:anyone', email: null }, {})).toBe(false);
  });
});

describe('linkedEmail', () => {
  it('reads a direct email claim, lowercased', () => {
    expect(linkedEmail({ email: ' Owner@Example.com ' })).toBe('owner@example.com');
  });

  it('reads the email out of a linked_accounts array, ignoring other account types', () => {
    expect(linkedEmail({ linked_accounts: [{ type: 'wallet', address: 'So1ana' }, { type: 'email', address: 'Owner@Example.com' }] })).toBe('owner@example.com');
  });

  it('reads a linked_accounts array that arrives as a JSON string', () => {
    expect(linkedEmail({ linked_accounts: '[{"type":"email","address":"owner@example.com"}]' })).toBe('owner@example.com');
  });

  it('returns null when nothing usable is present, rather than guessing', () => {
    expect(linkedEmail({})).toBeNull();
    expect(linkedEmail({ email: 'not-an-address' })).toBeNull();
    expect(linkedEmail({ linked_accounts: 'not json' })).toBeNull();
    expect(linkedEmail({ linked_accounts: [{ type: 'wallet', address: 'So1ana' }] })).toBeNull();
  });
});

// Marks a user as admin (or removes it) so they can use /app/admin. Local and operator use only: it talks to the database directly.
//   npm run make-admin -- --list                              recent users, newest first, with the ids you need for ADMIN_*
//   npm run make-admin -- <id | privyUserId | wallet address>            make that user an admin
//   npm run make-admin -- <id | privyUserId | wallet address> --revoke   remove admin
// NOTE: when ADMIN_PRIVY_USER_ID or ADMIN_EMAIL is set in the API's environment, that environment is authoritative and this
// database flag is ignored for access. Use it for local development, or when no ADMIN_* variable is configured.
// DATABASE_URL comes from this terminal, or from ./.env when that file exists.
import { createPrisma } from '@narra/database';

try { process.loadEnvFile('.env'); } catch { /* no .env file: rely on the terminal's variables */ }

async function main() {
  const args = process.argv.slice(2), revoke = args.includes('--revoke'), list = args.includes('--list');
  const target = args.find(a => !a.startsWith('--'));
  const db = createPrisma();
  try {
    if (list || !target) {
      const users = await db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, privyUserId: true, email: true, isAdmin: true, createdAt: true, linkedWallets: { select: { address: true }, take: 2 } } });
      if (!users.length) console.log('No users yet. Sign in once through the web app, then run this again.');
      for (const u of users) console.log(`${u.isAdmin ? '[admin] ' : '        '}${u.id}  ${u.privyUserId}  ${u.email ?? '(no email stored)'}  ${u.createdAt.toISOString()}  ${u.linkedWallets.map(w => w.address).join(',')}`);
      if (!target) console.log('\nADMIN_PRIVY_USER_ID uses the privyUserId column; ADMIN_EMAIL uses the email column when a Privy identity token supplied it.');
      return;
    }
    const matches = await db.user.findMany({ where: { OR: [{ id: target }, { privyUserId: target }, { linkedWallets: { some: { address: target } } }] }, select: { id: true } });
    if (matches.length !== 1) { console.error(matches.length ? 'More than one user matches. Use the user id.' : 'No user found. Sign in once through the web app first.'); process.exitCode = 1; return; }
    await db.user.update({ where: { id: matches[0].id }, data: { isAdmin: !revoke } });
    console.log(`${revoke ? 'Removed admin from' : 'Made admin:'} ${matches[0].id}`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Could not reach the database. Check DATABASE_URL.'); process.exitCode = 1; });

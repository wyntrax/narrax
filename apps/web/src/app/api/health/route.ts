/** Container liveness only: no database, authentication, RPC or provider calls. */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({status: 'ok', revision: process.env.NARRA_WEB_REVISION || 'local'}, {headers: {'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'}});
}

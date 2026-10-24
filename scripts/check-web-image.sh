#!/usr/bin/env bash
# Exercise the exact image that will be pushed. Needs Docker and curl, but no backend or database.
set -euo pipefail
: "${WEB_SMOKE_IMAGE:?required}"
: "${WEB_REVISION:?required}"
container="narrax-web-check-$$"
scratch="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$scratch"; }
trap cleanup EXIT
[ "$(docker image inspect --format '{{.Config.User}}' "$WEB_SMOKE_IMAGE")" = node ] || { echo 'Web image must run as node' >&2; exit 1; }
docker run --rm --entrypoint sh "$WEB_SMOKE_IMAGE" -c '
  test ! -d /app/apps/api && test ! -d /app/workers && test ! -d /app/backups && test ! -d /app/.git &&
  test -f /app/apps/web/server.js && test -f /app/apps/web/public/narrax-symbol.svg &&
  test -z "$(find /app -path /app/node_modules -prune -o -type f \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" -o -name "local-*.ps1" \) -print)"
'
docker run -d --name "$container" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --tmpfs /app/apps/web/.next/cache:rw,nosuid,size=64m,uid=1000,gid=1000 \
  -p 127.0.0.1:14010:3000 \
  -e NEXT_PUBLIC_SITE_URL -e NEXT_PUBLIC_API_URL -e NEXT_PUBLIC_PRIVY_APP_ID -e NEXT_PUBLIC_WYNTRAX_URL -e NARRA_SEO_INDEXABLE \
  "$WEB_SMOKE_IMAGE" >/dev/null
ready=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 5 http://127.0.0.1:14010/api/health > "$scratch/health"; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then docker logs "$container"; exit 1; fi
grep -Fq "\"revision\":\"$WEB_REVISION\"" "$scratch/health"
curl -fsS --max-time 20 http://127.0.0.1:14010/research > "$scratch/page"
grep -Fq 'Solana research guides' "$scratch/page"
grep -Fq 'application/ld+json' "$scratch/page"
[ "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -H "Host: ${NEXT_PUBLIC_SITE_URL#https://}" -H "X-Forwarded-Host: ${NEXT_PUBLIC_SITE_URL#https://}" -H 'X-Forwarded-Proto: https' http://127.0.0.1:14010/research)" = 200 ]
curl -fsS --max-time 20 http://127.0.0.1:14010/id/research > "$scratch/id"
grep -Fq 'Panduan riset Solana' "$scratch/id"
[ "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' http://127.0.0.1:14010/research/not-an-authored-guide)" = 404 ]
curl -fsS --max-time 20 http://127.0.0.1:14010/opengraph-image > "$scratch/share.png"
[ "$(od -An -tx1 -N8 "$scratch/share.png" | tr -d ' \n')" = 89504e470d0a1a0a ]
echo 'Web image: non-root, read-only, isolated runtime, release identity, EN/ID pages, schema, 404 and PNG checks passed.'

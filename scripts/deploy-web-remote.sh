#!/usr/bin/env bash
# Runs on the same VPS as the backend, in a SEPARATE Compose project and release state.
set -euo pipefail
log() { printf '[web-deploy] %s\n' "$*"; }
die() { printf '[web-deploy] ERROR: %s\n' "$*" >&2; exit 1; }
: "${NARRA_WEB_IMAGE:?required}"
: "${WEB_REVISION:?required}"
: "${DEPLOY_PATH:?required}"
[[ "$NARRA_WEB_IMAGE" =~ ^ghcr[.]io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || die 'image must be an immutable GHCR digest'
[[ "$WEB_REVISION" =~ ^[a-f0-9]{40}$ ]] || die 'WEB_REVISION must be a full commit SHA'
cd "$DEPLOY_PATH"
[ -f .env.web ] || die 'missing .env.web; create it from docker/web.env.example on the host'
[ -f docker/docker-compose.web.yml ] || die 'missing docker/docker-compose.web.yml'
mkdir -p .deploy/web
exec 9>.deploy/web/deploy.lock
flock -n 9 || die 'another frontend deployment is active'
export NARRA_WEB_IMAGE
# Compose must use the selected env file, not stale public settings exported by an interactive host shell.
unset NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_API_URL NEXT_PUBLIC_PRIVY_APP_ID NEXT_PUBLIC_WYNTRAX_URL NARRA_SEO_INDEXABLE NARRA_GOOGLE_SITE_VERIFICATION NARRA_BING_SITE_VERIFICATION
compose=(docker compose --project-name narrax-web --env-file .env.web -f docker/docker-compose.web.yml)
previous=''; previous_revision=''
if [ -f .deploy/web/current_release ]; then
  read -r previous previous_revision < .deploy/web/current_release
  [[ "$previous" =~ ^ghcr[.]io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ && "$previous_revision" =~ ^[a-f0-9]{40}$ ]] || die 'invalid previous release record'
  [ -f .deploy/web/current.env ] || die 'previous release config missing; restore it before deploying'
  docker image inspect "$previous" >/dev/null || die 'previous image missing locally; restore it before deploying so rollback is available'
fi
if [ -n "${REGISTRY_USER:-}" ]; then
  token=''; IFS= read -r token || true
  [ -n "$token" ] || die 'registry token missing on stdin'
  printf '%s' "$token" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
  unset token
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi
# Validate Compose and image configuration BEFORE replacing the currently running frontend.
"${compose[@]}" config --quiet || die 'invalid frontend compose configuration'
# Keep registry retries before config checks/replacement, within the release job budget.
pulled=0
for attempt in 1 2 3; do
  log "pulling frontend image (attempt $attempt/3; 180s timeout)"
  if timeout --kill-after=15s 180s "${compose[@]}" pull --quiet web; then pulled=1; break; fi
  if [ "$attempt" -lt 3 ]; then
    delay=$((attempt * 10))
    log "frontend image pull failed; retrying in ${delay}s"
    sleep "$delay"
  fi
done
[ "$pulled" = 1 ] || die 'could not pull frontend image after 3 attempts; nothing was replaced'
"${compose[@]}" run --rm --no-deps --pull never web node scripts/check-deploy-config.cjs || die 'host public configuration differs from this image; nothing replaced'
health() {
  local revision="$1" body
  for _ in $(seq 1 "${HEALTH_TRIES:-45}"); do
    body="$(curl -fsS --max-time 5 http://127.0.0.1:4010/api/health 2>/dev/null || true)"
    if printf '%s' "$body" | grep -Fq "\"revision\":\"$revision\"" &&
      [ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:4010/research 2>/dev/null || true)" = 200 ]; then return 0; fi
    sleep "${HEALTH_SLEEP:-2}"
  done
  return 1
}
fail() {
  log 'frontend deployment failed; backend containers and database are untouched'
  "${compose[@]}" logs --no-color --tail 40 web >&2 || true
  if [ -n "$previous" ]; then
    log "rolling back frontend to $previous"
    if NARRA_WEB_IMAGE="$previous" docker compose --project-name narrax-web --env-file .deploy/web/current.env -f docker/docker-compose.web.yml up -d --no-build --no-deps --pull never web && health "$previous_revision"; then
      log 'previous frontend is healthy'
    else log 'ROLLBACK FAILED: inspect the host immediately'; fi
  else
    log 'no earlier image recorded; stopping failed frontend for inspection'
    "${compose[@]}" stop web || true
  fi
  exit 1
}
"${compose[@]}" up -d --no-build --no-deps --pull never web || fail
health "$WEB_REVISION" || fail
if [ -n "$previous" ]; then
  cp .deploy/web/current.env .deploy/web/previous.env
  printf '%s %s\n' "$previous" "$previous_revision" > .deploy/web/previous_release.tmp
  mv .deploy/web/previous_release.tmp .deploy/web/previous_release
fi
cp .env.web .deploy/web/current.env.tmp
chmod 600 .deploy/web/current.env.tmp
mv .deploy/web/current.env.tmp .deploy/web/current.env
printf '%s %s\n' "$NARRA_WEB_IMAGE" "$WEB_REVISION" > .deploy/web/current_release.tmp
mv .deploy/web/current_release.tmp .deploy/web/current_release
log "deployed frontend $WEB_REVISION ($NARRA_WEB_IMAGE)"

#!/usr/bin/env bash
# Runs ON the deploy host, started over SSH by .github/workflows/release.yml. Not meant to be run from a laptop.
#
#   NARRA_IMAGE   image reference to run (the release workflow passes ghcr.io/<owner>/<repo>@sha256:<digest>)
#   DEPLOY_PATH   directory on this host holding .env, docker/docker-compose.prod.yml and docker/docker-compose.deploy.yml
#   REGISTRY_USER optional; when set, a registry token is read from stdin and used to pull
#
# Order: pull -> start Postgres and Redis -> run migrations -> start api, worker, executor -> health check.
# If the health check fails the app containers go back to the previously recorded image. Database migrations are NOT
# reverted: they only move forward, so a migration must stay compatible with the previous release (add first, remove later).
set -euo pipefail

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

: "${NARRA_IMAGE:?NARRA_IMAGE is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
BASE_FILE="${COMPOSE_BASE:-docker/docker-compose.prod.yml}"
OVERRIDE_FILE="docker/docker-compose.deploy.yml"
STATE_DIR=".deploy"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${API_PORT:-4000}/health}"
HEALTH_TRIES="${HEALTH_TRIES:-45}"
HEALTH_SLEEP="${HEALTH_SLEEP:-2}"
SERVICES=(api worker executor)

cd "$DEPLOY_PATH"
[ -f "$BASE_FILE" ] || die "missing $BASE_FILE: copy docker/docker-compose.prod.example.yml here, read and adapt it, and keep it on the host"
[ -f "$OVERRIDE_FILE" ] || die "missing $OVERRIDE_FILE"
[ -f .env ] || die "missing .env on the host (secrets live there, never in the repository or the image)"
mkdir -p "$STATE_DIR"

# Nothing may give the trading stage a signing credential before the owner has explicitly approved that step.
for name in EXECUTOR_SIGNING_KEY WALLET_PRIVATE_KEY SOLANA_PRIVATE_KEY PRIVY_AUTHORIZATION_PRIVATE_KEY PRIVY_AUTHORIZATION_KEY; do
  if grep -Eq "^[[:space:]]*(export[[:space:]]+)?${name}=([^\"'[:space:]#]|\"[^\"]|'[^'])" .env; then
    die "$name is set in .env. Refusing to deploy a signing credential (see docs/SECURITY_REVIEW_PLAN_B5.md)."
  fi
done

if [ -n "${REGISTRY_USER:-}" ]; then
  # `read` fails at end of input when there is no trailing newline, but it still fills the variable, so do not reset it.
  token=""; IFS= read -r token || true
  [ -n "$token" ] || die "REGISTRY_USER is set but no token arrived on stdin"
  printf '%s' "$token" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
  unset token
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi

export NARRA_IMAGE
compose=(docker compose --env-file .env -f "$BASE_FILE" -f "$OVERRIDE_FILE")
PREVIOUS="$(cat "$STATE_DIR/current_image" 2>/dev/null || true)"

rollback() {
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$NARRA_IMAGE" ]; then
    log "rolling back api, worker and executor to $PREVIOUS (database migrations are NOT reverted)"
    NARRA_IMAGE="$PREVIOUS" "${compose[@]}" up -d --no-build --no-deps --pull never "${SERVICES[@]}" || log "rollback failed: inspect the host by hand"
  else
    log "no earlier image is recorded, so the failed containers are left in place for inspection"
  fi
}
fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  "${compose[@]}" logs --no-color --tail 40 "${SERVICES[@]}" 2>&1 || true
  rollback
  exit 1
}

log "deploying $NARRA_IMAGE (previous: ${PREVIOUS:-none})"
"${compose[@]}" pull --quiet migrate "${SERVICES[@]}" || die "could not pull the image"

log "starting postgres and redis"
"${compose[@]}" up -d --wait postgres redis || die "postgres or redis is not healthy"

# A failed migration stops here, before any container is replaced, so the old release keeps running untouched.
log "running migrations"
"${compose[@]}" run --rm --no-deps migrate || die "migrations failed; nothing was replaced"

log "starting ${SERVICES[*]}"
# Images were pulled above. Do not re-pull on start/rollback, or delete unrelated services on the host.
"${compose[@]}" up -d --no-build --no-deps --pull never "${SERVICES[@]}" || fail "could not start the services"

log "waiting for $HEALTH_URL"
healthy=0
for _ in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then healthy=1; break; fi
  sleep "$HEALTH_SLEEP"
done
[ "$healthy" = 1 ] || fail "the API did not become healthy"

# The worker and the executor have no HTTP port. A container that crash-loops is not "running" for long, so check twice.
sleep "$HEALTH_SLEEP"
running="$("${compose[@]}" ps --status running --services 2>/dev/null || true)"
for s in "${SERVICES[@]}"; do
  printf '%s\n' "$running" | grep -qx "$s" || fail "$s is not running"
done

[ -n "$PREVIOUS" ] && printf '%s\n' "$PREVIOUS" > "$STATE_DIR/previous_image"
printf '%s\n' "$NARRA_IMAGE" > "$STATE_DIR/current_image"
log "deployed $NARRA_IMAGE"

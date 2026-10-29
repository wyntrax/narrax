#!/usr/bin/env bash
# Fake Docker/curl only. No service, database or external network is used.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO/scripts/deploy-web-remote.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
OLD="ghcr.io/o/r-web@sha256:$(printf 'a%.0s' {1..64})"
NEW="ghcr.io/o/r-web@sha256:$(printf 'b%.0s' {1..64})"
OLD_SHA="$(printf 'a%.0s' {1..40})"
NEW_SHA="$(printf 'b%.0s' {1..40})"
CHECKS=0
ok() { if eval "$2"; then printf 'PASS %s\n' "$1"; CHECKS=$((CHECKS + 1)); else printf 'FAIL %s\n' "$1"; cat "$HOST/out"; exit 1; fi; }
new_host() {
  HOST="$(mktemp -d "$SCRATCH/host.XXXXXX")"; DEP="$HOST/app"; BIN="$HOST/bin"; CALLS="$HOST/calls"; ACTIVE="$HOST/active"
  mkdir -p "$BIN" "$DEP/docker" "$DEP/.deploy/web"
  : > "$DEP/docker/docker-compose.web.yml"
  printf 'NEXT_PUBLIC_SITE_URL=https://new.example\nNARRA_SEO_INDEXABLE=false\n' > "$DEP/.env.web"
  printf 'BACKEND_SECRET=untouched\n' > "$DEP/.env"
  : > "$CALLS"
  cat > "$BIN/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker image=${NARRA_WEB_IMAGE:-} $*" >> "$CALLS"
case "$*" in
  login*) cat >/dev/null ;;
  "image inspect"*) exit "${FAKE_INSPECT_RC:-0}" ;;
  *" pull "*)
    count="$(cat "$CALLS.pulls" 2>/dev/null || echo 0)"; count=$((count + 1)); echo "$count" > "$CALLS.pulls"
    if [ "$count" -le "${FAKE_PULL_FAILURES:-0}" ]; then exit 1; fi
    exit "${FAKE_PULL_RC:-0}" ;;
  *" run "*) exit "${FAKE_CONFIG_RC:-0}" ;;
  *" up "*)
    if [ "${FAKE_UP_FAIL:-0}" = 1 ] && [ "$NARRA_WEB_IMAGE" = "$BAD" ]; then exit 1; fi
    printf '%s' "$NARRA_WEB_IMAGE" > "$ACTIVE" ;;
esac
FAKE
  cat > "$BIN/curl" <<'FAKE'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
image="$(cat "$ACTIVE" 2>/dev/null || true)"
[ "$image" != "$BAD" ] || exit 22
if [[ "$*" == *'/api/health'* ]]; then
  digest="${image##*:}"
  if [ "${FAKE_WRONG_REVISION:-0}" = 1 ]; then digest="$(printf '0%.0s' {1..64})"; fi
  printf '{"status":"ok","revision":"%s"}' "${digest:0:40}"
else
  [ "${FAKE_PAGE_RC:-0}" = 0 ] || exit "$FAKE_PAGE_RC"
  printf '%s' "${FAKE_PAGE_STATUS:-200}"
fi
FAKE
  printf '#!/usr/bin/env bash\nexit "${FAKE_LOCK_RC:-0}"\n' > "$BIN/flock"
  printf '#!/usr/bin/env bash\necho "sleep $*" >> "$CALLS"\n' > "$BIN/sleep"
  cat > "$BIN/timeout" <<'FAKE'
#!/usr/bin/env bash
echo "timeout $*" >> "$CALLS"
[ "$1" = --kill-after=15s ] && [ "$2" = 180s ] || exit 2
shift 2
if [ "${FAKE_PULL_TIMEOUT:-0}" = 1 ]; then exit 124; fi
exec "$@"
FAKE
  chmod +x "$BIN/"*
}
previous() {
  printf '%s %s\n' "$OLD" "$OLD_SHA" > "$DEP/.deploy/web/current_release"
  printf 'NEXT_PUBLIC_SITE_URL=https://old.example\n' > "$DEP/.deploy/web/current.env"
  printf '%s' "$OLD" > "$ACTIVE"
}
run() {
  set +e
  (export PATH="$BIN:$PATH" CALLS ACTIVE BAD="${FAKE_BAD_IMAGE:-none}" DEPLOY_PATH="$DEP" NARRA_WEB_IMAGE="${IMAGE_OVERRIDE:-$NEW}" WEB_REVISION="${REVISION_OVERRIDE:-$NEW_SHA}" HEALTH_TRIES=2 HEALTH_SLEEP=0
   if [ "${WITH_REGISTRY:-0}" = 1 ]; then export REGISTRY_USER=ci-user; fi
   printf '%s' "${TOKEN-private-token}" | bash "$SCRIPT") > "$HOST/out" 2>&1
  RC=$?
  set -e
}
new_host; WITH_REGISTRY=1 run
ok 'success and registry login/logout' '[ "$RC" = 0 ] && grep -q "login ghcr.io" "$CALLS" && grep -q "logout ghcr.io" "$CALLS"'
ok 'registry token never appears in commands/logs' '! grep -q private-token "$CALLS" "$HOST/out"'
ok 'only web is started, with explicit env and no pull on replacement' 'grep -q -- "--env-file .env.web" "$CALLS" && grep -q "up -d --no-build --no-deps --pull never web" "$CALLS" && ! grep -Eq "migrate|postgres|redis|worker|executor|remove-orphans" "$CALLS"'
ok 'successful image/revision and protected config snapshot are recorded' 'grep -q "$NEW_SHA" "$DEP/.deploy/web/current_release" && cmp -s "$DEP/.env.web" "$DEP/.deploy/web/current.env"'
ok 'backend env remains unchanged' 'grep -qx BACKEND_SECRET=untouched "$DEP/.env"'
new_host; previous; run
ok 'second deployment retains previous release and its configuration' '[ "$RC" = 0 ] && grep -q "$OLD_SHA" "$DEP/.deploy/web/previous_release" && grep -q old.example "$DEP/.deploy/web/previous.env"'
new_host; previous; FAKE_BAD_IMAGE="$NEW" run
ok 'failed health exits nonzero and does not record candidate release' '[ "$RC" != 0 ] && grep -q "$OLD_SHA" "$DEP/.deploy/web/current_release"'
ok 'rollback uses the old env snapshot and locally cached image' 'grep -q "image=$OLD .*--env-file .deploy/web/current.env .*--pull never web" "$CALLS" && grep -q "previous frontend is healthy" "$HOST/out"'
new_host; previous; FAKE_BAD_IMAGE="$NEW" FAKE_UP_FAIL=1 run
ok 'start failure rolls back before recording a new release' '[ "$RC" != 0 ] && grep -q "previous frontend is healthy" "$HOST/out" && grep -q "$OLD_SHA" "$DEP/.deploy/web/current_release"'
new_host; FAKE_BAD_IMAGE="$NEW" run
ok 'first failed deployment stops the failed service' '[ "$RC" != 0 ] && grep -q "stop web" "$CALLS" && [ ! -f "$DEP/.deploy/web/current_release" ]'
new_host; previous; FAKE_CONFIG_RC=1 run
ok 'public config mismatch never replaces the running frontend' '[ "$RC" != 0 ] && ! grep -q " up " "$CALLS" && grep -q "$OLD_SHA" "$DEP/.deploy/web/current_release"'
new_host; FAKE_PULL_RC=1 run
ok 'pull failure never replaces services' '[ "$RC" != 0 ] && ! grep -q " up " "$CALLS"'
new_host; previous; FAKE_INSPECT_RC=1 run
ok 'requires cached rollback image before deployment' '[ "$RC" != 0 ] && ! grep -q " pull " "$CALLS"'
new_host; previous; rm "$DEP/.deploy/web/current.env"; run
ok 'requires previous release configuration for safe rollback' '[ "$RC" != 0 ] && ! grep -q " pull " "$CALLS"'
new_host; FAKE_WRONG_REVISION=1 run
ok 'rejects stale/wrong revision even when endpoint returns 200' '[ "$RC" != 0 ] && [ ! -f "$DEP/.deploy/web/current_release" ]'
new_host; FAKE_PAGE_RC=22 run
ok 'requires public research page in addition to liveness' '[ "$RC" != 0 ] && [ ! -f "$DEP/.deploy/web/current_release" ]'
new_host; FAKE_PAGE_STATUS=307 run
ok 'does not accept a redirect loop as a healthy public page' '[ "$RC" != 0 ] && [ ! -f "$DEP/.deploy/web/current_release" ]'
new_host; IMAGE_OVERRIDE=ghcr.io/o/r-web:latest run
ok 'rejects mutable tags before Docker is called' '[ "$RC" != 0 ] && [ ! -s "$CALLS" ]'
new_host; REVISION_OVERRIDE=not-a-commit run
ok 'rejects malformed revision before Docker is called' '[ "$RC" != 0 ] && [ ! -s "$CALLS" ]'
new_host; WITH_REGISTRY=1 TOKEN='' run
ok 'rejects missing registry token' '[ "$RC" != 0 ] && ! grep -q "login ghcr.io" "$CALLS"'
new_host; FAKE_LOCK_RC=1 run
ok 'prevents concurrent frontend deployments on the host' '[ "$RC" != 0 ] && [ ! -s "$CALLS" ]'
new_host; rm "$DEP/.env.web"; run
ok 'requires separate frontend environment file' '[ "$RC" != 0 ] && [ ! -s "$CALLS" ]'
new_host; FAKE_PULL_FAILURES=2 run
ok 'transient pull failure succeeds on third attempt with backoff' '[ "$RC" = 0 ] && [ "$(cat "$CALLS.pulls")" = 3 ] && grep -qx "sleep 10" "$CALLS" && grep -qx "sleep 20" "$CALLS"'
ok 'image config check runs exactly once after the successful pull' '[ "$(grep -c "^docker .* run " "$CALLS")" = 1 ] && [ "$(grep -n "^docker .* pull " "$CALLS" | tail -1 | cut -d: -f1)" -lt "$(grep -n "^docker .* run " "$CALLS" | cut -d: -f1)" ]'
new_host; previous; WITH_REGISTRY=1 FAKE_PULL_RC=1 run
ok 'persistent pull failure stops at three and preserves previous release and config' '[ "$RC" != 0 ] && [ "$(cat "$CALLS.pulls")" = 3 ] && ! grep -Eq " (run|stop|up) " "$CALLS" && grep -q "$OLD_SHA" "$DEP/.deploy/web/current_release" && grep -q old.example "$DEP/.deploy/web/current.env" && [ "$(cat "$ACTIVE")" = "$OLD" ]'
ok 'persistent pull failure still logs out' 'grep -q "logout ghcr.io" "$CALLS"'
new_host; FAKE_PULL_TIMEOUT=1 run
ok 'timeout ends after three bounded attempts without replacement' '[ "$RC" != 0 ] && [ "$(grep -c "^timeout --kill-after=15s 180s" "$CALLS")" = 3 ] && ! grep -Eq " (run|stop|up) " "$CALLS" && [ ! -f "$DEP/.deploy/web/current_release" ]'
printf '%s frontend deployment checks passed.\n' "$CHECKS"

#!/usr/bin/env bash
# Tests scripts/deploy-remote.sh with fake `docker` and `curl` programs, so no Docker or network is needed.
# Run: bash scripts/deploy-remote.test.sh      (CI runs it in the "static" job)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO/scripts/deploy-remote.sh"
FAILS=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
ok()   { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# One scratch host per test: a deploy directory plus a bin directory holding the fakes.
new_host() {
  HOST="$(mktemp -d)"; BIN="$HOST/bin"; DEP="$HOST/app"; CALLS="$HOST/calls.log"
  mkdir -p "$BIN" "$DEP/docker" "$DEP/.deploy"
  : > "$DEP/docker/docker-compose.prod.yml"; : > "$DEP/docker/docker-compose.deploy.yml"
  printf 'PRIVY_APP_SECRET=abc\nEXECUTOR_SIGNING_KEY=\n' > "$DEP/.env"
  : > "$CALLS"
  cat > "$BIN/docker" <<'FAKE'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$*" in
  login*) cat >/dev/null ;;
  *" run "*) exit "${FAKE_MIGRATE_RC:-0}" ;;
  *" ps "*) printf '%b' "${FAKE_RUNNING:-api\nworker\nexecutor\npersonal-research\n}" ;;
  *" up "*) if [ -n "${FAKE_UP_FAIL_FOR:-}" ] && [ "${NARRA_IMAGE:-}" = "$FAKE_UP_FAIL_FOR" ]; then exit 1; fi ;;
esac
exit 0
FAKE
  printf '#!/usr/bin/env bash\necho "curl $*" >> "$CALLS"\nexit "${FAKE_CURL_RC:-0}"\n' > "$BIN/curl"
  chmod +x "$BIN/docker" "$BIN/curl"
  printf '#!/usr/bin/env bash\necho "sleep $*" >> "$CALLS"\n' > "$BIN/sleep"
  chmod +x "$BIN/sleep"
}
run() { # run <image> [registry_user]; the fake registry token is sent on stdin like the workflow does
  ( export PATH="$BIN:$PATH" CALLS DEPLOY_PATH="$DEP" NARRA_IMAGE="$1" HEALTH_TRIES=2 HEALTH_SLEEP=0
    [ -n "${2:-}" ] && export REGISTRY_USER="$2"
    printf 'tok123' | bash "$SCRIPT" ) > "$HOST/out.log" 2>&1
  RC=$?
}

# 1. Success: logs in, pulls, starts the data services, migrates BEFORE starting the app, records the image.
new_host; run "ghcr.io/o/r@sha256:new" ci-user
ok "success: exits 0" '[ "$RC" -eq 0 ]'
ok "success: logs in to the registry and logs out afterwards" 'grep -q "docker login ghcr.io" "$CALLS" && grep -q "docker logout ghcr.io" "$CALLS"'
ok "success: the token is never on a command line" '! grep -q tok123 "$CALLS" "$HOST/out.log"'
ok "success: migrates before the app starts" 'm=$(grep -n " run --rm --no-deps migrate" "$CALLS" | head -1 | cut -d: -f1); u=$(grep -n "up -d --no-build --no-deps --pull never api worker executor" "$CALLS" | head -1 | cut -d: -f1); [ -n "$m" ] && [ -n "$u" ] && [ "$m" -lt "$u" ]'
ok "success: explicitly loads the host env and preserves unrelated services" 'grep -q "compose --env-file .env" "$CALLS" && ! grep -q -- --remove-orphans "$CALLS"'
ok "success: records the current image" '[ "$(cat "$DEP/.deploy/current_image")" = "ghcr.io/o/r@sha256:new" ]'
ok "success: starts personal research and records rollback support" 'grep -q "up -d --no-build --no-deps --pull never api worker executor personal-research" "$CALLS" && [ "$(cat "$DEP/.deploy/personal_research_image")" = "ghcr.io/o/r@sha256:new" ]'
ok "success: stops the pipeline and waits out its lease before starting" 's=$(grep -n " stop worker" "$CALLS" | head -1 | cut -d: -f1); w=$(grep -n "sleep 95" "$CALLS" | head -1 | cut -d: -f1); u=$(grep -n "up -d --no-build --no-deps" "$CALLS" | head -1 | cut -d: -f1); [ "$s" -lt "$w" ] && [ "$w" -lt "$u" ]'

# 2. Second deploy remembers the first as "previous".
printf 'ghcr.io/o/r@sha256:old\n' > "$DEP/.deploy/current_image"; run "ghcr.io/o/r@sha256:new2"
ok "second deploy: previous image is recorded" '[ "$(cat "$DEP/.deploy/previous_image")" = "ghcr.io/o/r@sha256:old" ]'

# 3. Health check fails: roll back to the previous image, exit non-zero, keep the old record.
new_host; printf 'ghcr.io/o/r@sha256:old\n' > "$DEP/.deploy/current_image"
FAKE_CURL_RC=22 run "ghcr.io/o/r@sha256:bad"
ok "unhealthy: exits non-zero" '[ "$RC" -ne 0 ]'
ok "unhealthy: restarts the app without another registry pull" '[ "$(grep -c "up -d --no-build --no-deps --pull never api worker executor" "$CALLS")" -eq 2 ]'
ok "unhealthy: says migrations are not reverted" 'grep -q "migrations are NOT reverted" "$HOST/out.log"'
ok "unhealthy: current image record is unchanged" '[ "$(cat "$DEP/.deploy/current_image")" = "ghcr.io/o/r@sha256:old" ]'
ok "first upgrade rollback: stops the new worker missing from the old image" 'grep -q " stop personal-research" "$CALLS" && [ "$(grep -c "up -d --no-build --no-deps --pull never api worker executor personal-research" "$CALLS")" -eq 1 ]'

new_host; printf 'ghcr.io/o/r@sha256:old\n' > "$DEP/.deploy/current_image"
cp "$DEP/.deploy/current_image" "$DEP/.deploy/personal_research_image"
FAKE_CURL_RC=22 run "ghcr.io/o/r@sha256:bad"
ok "later rollback: also restores the previous personal worker" '[ "$RC" -ne 0 ] && [ "$(grep -c "up -d --no-build --no-deps --pull never api worker executor personal-research" "$CALLS")" -eq 2 ]'
new_host; FAKE_RUNNING='api\nworker\nexecutor\n' run "ghcr.io/o/r@sha256:x"
ok "personal worker down: deployment fails rather than silently shipping broken refresh" '[ "$RC" -ne 0 ] && grep -q "personal-research is not running" "$HOST/out.log"'

# 4. First deploy ever and unhealthy: nothing to roll back to, says so.
new_host; FAKE_CURL_RC=22 run "ghcr.io/o/r@sha256:first"
ok "first deploy unhealthy: exits non-zero and explains there is no earlier image" '[ "$RC" -ne 0 ] && grep -q "no earlier image" "$HOST/out.log"'

# 5. Migration fails: stop before replacing anything.
new_host; FAKE_MIGRATE_RC=1 run "ghcr.io/o/r@sha256:m"
ok "migration failure: exits non-zero" '[ "$RC" -ne 0 ]'
ok "migration failure: the app was never restarted" '! grep -q "up -d --no-build --no-deps" "$CALLS"'
ok "migration failure: nothing is recorded as deployed" '[ ! -f "$DEP/.deploy/current_image" ]'

# 6. The executor crash-loops (not in the running list): counts as a failed deploy.
new_host; FAKE_RUNNING='api\nworker\n' run "ghcr.io/o/r@sha256:x"
ok "executor down: exits non-zero and names it" '[ "$RC" -ne 0 ] && grep -q "executor is not running" "$HOST/out.log"'

# 7. A signing credential in .env is refused before any docker command runs.
for var in EXECUTOR_SIGNING_KEY WALLET_PRIVATE_KEY SOLANA_PRIVATE_KEY PRIVY_AUTHORIZATION_PRIVATE_KEY PRIVY_AUTHORIZATION_KEY; do
  new_host; printf '%s=somethingsecret\n' "$var" > "$DEP/.env"; run "ghcr.io/o/r@sha256:s"
  ok "refuses $var" '[ "$RC" -ne 0 ] && [ ! -s "$CALLS" ] && grep -q "Refusing to deploy a signing credential" "$HOST/out.log"'
done
new_host; printf 'export EXECUTOR_SIGNING_KEY="abc"\n' > "$DEP/.env"; run "ghcr.io/o/r@sha256:s"
ok "refuses a quoted and exported signing key" '[ "$RC" -ne 0 ] && [ ! -s "$CALLS" ]'
new_host; printf 'EXECUTOR_SIGNING_KEY=""\nWALLET_PRIVATE_KEY=\nPRIVY_APP_SECRET=needed-by-the-api\n' > "$DEP/.env"; run "ghcr.io/o/r@sha256:s"
ok "an empty signing variable and PRIVY_APP_SECRET are allowed" '[ "$RC" -eq 0 ]'

# 8. Missing prerequisites fail early with a clear message.
new_host; rm "$DEP/.env"; run "ghcr.io/o/r@sha256:s"
ok "missing .env: fails before any docker command" '[ "$RC" -ne 0 ] && [ ! -s "$CALLS" ] && grep -q "missing .env" "$HOST/out.log"'
new_host; rm "$DEP/docker/docker-compose.prod.yml"; run "ghcr.io/o/r@sha256:s"
ok "missing base compose file: fails with a clear message" '[ "$RC" -ne 0 ] && grep -q "docker-compose.prod.yml" "$HOST/out.log"'

echo; if [ "$FAILS" -eq 0 ]; then echo "All deploy script checks passed."; else echo "$FAILS check(s) failed."; exit 1; fi

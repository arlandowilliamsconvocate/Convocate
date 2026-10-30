#!/bin/bash
# Convocate background scheduler — hardened 2026-10-30.
#
# WHY THIS FILE WAS REWRITTEN
# A direct message reached the Page on 27 October 2026 at 20:56 UTC and nothing
# answered it. The webhook had stored it, the send path was healthy, the switch
# said on — but this loop was dead, because the computer had been replaced and
# nothing starts it. By the time a loop came back the message was past Meta's
# 24-hour reply window. The failure was not a bug in the responder; it was that
# nothing noticed the responder was not running.
#
# What is different now:
#   1. It is started by the app itself (serve.ts in production, vite.config.ts in
#      dev), so whenever the platform starts the site, this starts too. The app is
#      the one process this box is guaranteed to run after a boot.
#   2. It cannot die from a failed request: every curl has a hard timeout, no
#      command can exit the loop, and an outer supervisor restarts the inner loop
#      if it ever does end.
#   3. It says so when the app is unreachable. Ten failed runs in a row (~10
#      minutes) sends the owner one email, and no more until the app answers
#      again. That alert goes out from here, not from the app, so it still works
#      when the app is the thing that is broken.
#   4. Only one copy runs. A pid file means the platform starting the app twice,
#      or a publish, cannot stack up duplicate loops (duplicates would be safe —
#      the watcher claims each row — but they would double the database reads).
#
# The loop itself is the same two jobs as before:
#   1. Messenger watcher  -> POST /api/meta/messenger-watcher
#   2. Ads auto-switch    -> convocate-ads-activate.py (fires once, Monday 08:00 ET)
#
# Logs: /home/team/shared/messenger-watcher-cron.out holds runs that did something
# or failed (a no-op run is recorded in scheduler-heartbeat.txt instead, so the
# log does not grow by a line a minute forever).
set -u

SELF="/home/team/shared/convocate-scheduler.sh"
APP_URL="http://localhost:3000/api/meta/messenger-watcher"
SECRET_DEFAULT="642cc369bea7114325fc262bfdb0527d40e7a78250d8eb91dc5f7b0aefcd1fa5"
LOG="/home/team/shared/messenger-watcher-cron.out"
HEARTBEAT="/home/team/shared/scheduler-heartbeat.txt"
STATE="/home/team/shared/.scheduler-alert-state"
PIDFILE="/home/team/shared/.scheduler.pid"
ADS_LOG="/home/team/shared/ads-switch.log"
BODY="/tmp/convocate-watcher-body.$$"
OWNER_ALERT_TO="${OWNER_ALERT_TO:-arlando.williams@gmail.com}"
# Ten consecutive failed runs at ~55s each is roughly ten minutes — the same
# "nothing has completed a run in ten minutes" rule the app's own dead-man's
# switch uses.
FAILS_BEFORE_ALERT=10

# ---- one instance only -------------------------------------------------------
if [ -f "$PIDFILE" ]; then
  OTHER="$(cat "$PIDFILE" 2>/dev/null || echo "")"
  if [ -n "$OTHER" ] && kill -0 "$OTHER" 2>/dev/null; then
    echo "$(date -u +%FT%TZ) scheduler already running as pid $OTHER — this start is a no-op"
    exit 0
  fi
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE" "$BODY"' EXIT

log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

# ---- the alert that has to work when the app is down -------------------------
# Resend, one POST, no SDK — the same provider the site uses for mail. The key
# comes from the platform's secret file, so this works without the app running.
send_down_alert() {
  local fails="$1"
  source /etc/profile.d/cto-env-vars.sh 2>/dev/null || true
  if [ -z "${RESEND_API_KEY:-}" ]; then
    log "ALERT NOT SENT: RESEND_API_KEY is not in this environment (fails=$fails)"
    return 1
  fi
  local from="${MAIL_FROM:-Convocate <hello@getconvocate.com>}"
  local payload
  payload=$(FAILS="$fails" TO="$OWNER_ALERT_TO" FROM="$from" python3 - <<'PY'
import json, os, time
fails = os.environ["FAILS"]
now = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
body = "\n".join([
    "The Convocate Messenger responder has stopped.",
    "",
    f"The background watcher could not reach the app for {fails} runs in a row (about {int(fails)} minutes).",
    f"Last attempt: {now}.",
    "",
    "What this means: direct messages are still being stored, but nothing is answering them.",
    "A message can only be answered automatically for 24 hours after it arrives.",
    "",
    "What happens next: this loop keeps trying every minute and will email you once more only if it",
    "recovers and then fails again. Nothing is needed from you to restart it.",
    "",
    "Health panel: /admin/messenger",
])
print(json.dumps({
    "from": os.environ["FROM"],
    "to": [os.environ["TO"]],
    "subject": "[Convocate] Messenger responder is not running",
    "text": body,
}))
PY
)
  local code
  code=$(curl -sS -m 15 -o /tmp/convocate-alert-out.$$ -w '%{http_code}' \
    -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null)
  if [ "$code" = "200" ]; then
    log "ALERT SENT to the owner (fails=$fails)"
    echo "$(date -u +%s)" > "$STATE"
    rm -f /tmp/convocate-alert-out.$$
    return 0
  fi
  log "ALERT FAILED (http=$code fails=$fails)"
  rm -f /tmp/convocate-alert-out.$$
  return 1
}

# ---- one pass ---------------------------------------------------------------
one_pass() {
  local secret body code did
  source /etc/profile.d/cto-env-vars.sh 2>/dev/null || true
  secret="$SECRET_DEFAULT"
  # The secret lives in the database; the loop uses the copy the team minted. A
  # rotated secret is picked up from the environment if it is ever put there.
  secret="${CONVOCATE_WATCHER_SECRET:-$secret}"

  # -m 20: a hung request can never stall the loop. -sS: quiet, but errors still
  # print. The body goes to a file so a failure cannot be mistaken for success.
  code=$(curl -sS -m 20 -o "$BODY" -w '%{http_code}' \
    -X POST -H "x-convocate-watcher-secret: $secret" "$APP_URL" 2>>"$LOG")
  body="$(cat "$BODY" 2>/dev/null || echo "")"

  if [ "$code" != "200" ]; then
    return 1
  fi
  echo "$(date -u +%FT%TZ) http=200 ${body:0:400}" > "$HEARTBEAT"
  # Only runs that did something are kept: the heartbeat above covers the rest.
  case "$body" in
    *'"didWork":true'*|*'"alerts":["'*|*'"errors":["'*) echo "$(date -u +%FT%TZ) $body" >> "$LOG" ;;
  esac
  return 0
}

# ---- the loop, supervised ---------------------------------------------------
fails=0
run_loop() {
  while true; do
    if one_pass; then
      if [ "$fails" -ge "$FAILS_BEFORE_ALERT" ]; then
        log "RECOVERED after $fails failed runs"
        rm -f "$STATE"
      fi
      fails=0
    else
      fails=$((fails + 1))
      echo "$(date -u +%FT%TZ) watcher unreachable (consecutive failures: $fails)" > "$HEARTBEAT"
      if [ "$fails" -ge "$FAILS_BEFORE_ALERT" ] && [ ! -f "$STATE" ]; then
        send_down_alert "$fails" || true
      fi
    fi

    # The ads switch is a separate job and must not be able to stop the watcher.
    if [ -f /home/team/shared/convocate-ads-activate.py ]; then
      timeout 60 python3 /home/team/shared/convocate-ads-activate.py >> "$ADS_LOG" 2>&1 || true
    fi

    # Keep the log bounded: a responder that fills the disk is another outage.
    if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
      mv "$LOG" "$LOG.1"
    fi
    sleep 55
  done
}

log "scheduler started (pid $$)"
# The inner loop has no exit path; this outer one exists so that if a future edit
# ever gives it one, the machine still keeps answering.
while true; do
  run_loop
  log "inner loop ended unexpectedly — restarting"
  sleep 5
done

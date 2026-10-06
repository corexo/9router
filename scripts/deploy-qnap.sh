#!/usr/bin/env bash
# ==============================================================================
# PiRouter QNAP Deployment & Rollback Script
# ==============================================================================
# Usage:
#   ./scripts/deploy-qnap.sh             Builds, smoke-tests, backs up DB,
#                                        deploys to QNAP, runs live verification.
#   ./scripts/deploy-qnap.sh --rollback  Instantly rolls back to the previous image.
#   ./scripts/deploy-qnap.sh --status    Shows health and running image info.
#   ./scripts/deploy-qnap.sh --skip-e2e Deploys without the live chat test.
# ==============================================================================

set -euo pipefail

QNAP_HOST="qnap"
QNAP_IP="192.168.10.40"
CONTAINER_NAME="9router-qnap-test"
smoke_cid=""
HOST_PORT="9311"
INTERNAL_PORT="20128"
REMOTE_DATA_DIR="/share/CE_CACHEDEV1_DATA/Container/9router-test/data-home"
REMOTE_BACKUP_DIR="/share/CE_CACHEDEV1_DATA/Container/9router-test/backups"
REMOTE_STATE_FILE="/share/CE_CACHEDEV1_DATA/Container/9router-test/current-deployment.env"
DOCKER_BIN="/share/CE_CACHEDEV1_DATA/.qpkg/container-station/bin/docker"

# Terminal colors
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}ℹ [INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}✓ [SUCCESS]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}⚠ [WARN]${NC} $*"; }
log_err()   { echo -e "${RED}✗ [ERROR]${NC} $*"; }

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
run_remote() {
  ssh -o BatchMode=yes "$QNAP_HOST" "$@"
}

check_health() {
  local url="http://${QNAP_IP}:${HOST_PORT}/api/health"
  local attempts=15
  local delay=2

  for ((i=1; i<=attempts; i++)); do
    local res
    res=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || true)
    if [[ "$res" == 200 ]]; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

verify_completion() {
  local key_file="$HOME/.config/pi/9router-key"
  if [[ ! -f "$key_file" ]]; then
    log_warn "No Pi API key found at $key_file; skipping chat completion test."
    return 0
  fi

  local api_key
  api_key=$(cat "$key_file")
  local url="http://${QNAP_IP}:${HOST_PORT}/v1/chat/completions"
  local payload='{"model":"cx/gpt-6-sol","messages":[{"role":"user","content":"ping"}],"max_tokens":10}'

  local res
  res=$(curl -s --max-time 15 -X POST -H "Authorization: Bearer ${api_key}" -H "Content-Type: application/json" -d "$payload" "$url" || true)
  if [[ "$res" == *"choices"* || "$res" == *"pong"* ]]; then
    return 0
  fi
  local error
  error=$(printf '%s' "$res" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const e=JSON.parse(s).error;console.log(String(e?.message ?? e ?? "unknown error").slice(0,80))}catch{console.log("invalid response")}})')
  log_warn "E2E error: $error"
  return 1
}

# ------------------------------------------------------------------------------
# Action: Status
# ------------------------------------------------------------------------------
do_status() {
  echo -e "\n${BOLD}=== PiRouter QNAP Status ===${NC}"
  log_info "Target: http://${QNAP_IP}:${HOST_PORT}"

  if check_health; then
    log_ok "Container API is HEALTHY (200 OK)"
  else
    log_err "Container API is UNHEALTHY or OFFLINE"
  fi

  echo ""
  log_info "Remote Deployment State:"
  run_remote "if [ -f '$REMOTE_STATE_FILE' ]; then cat '$REMOTE_STATE_FILE'; else echo 'No deployment state recorded yet.'; fi"
  echo ""
  log_info "Container Inspection:"
  run_remote "$DOCKER_BIN inspect --format 'Image: {{.Config.Image}} | Status: {{.State.Status}} | Started: {{.State.StartedAt}} | Restarts: {{.RestartCount}}' $CONTAINER_NAME 2>/dev/null || echo 'Container not found'"
}

# ------------------------------------------------------------------------------
# Action: Rollback
# ------------------------------------------------------------------------------
do_rollback() {
  local prev_image="$1"
  local current_image="${2:-}"
  echo -e "\n${BOLD}=== Initiating Rollback ===${NC}"

  if [[ -z "$prev_image" ]] || ! run_remote "$DOCKER_BIN image inspect '$prev_image' >/dev/null 2>&1"; then
    log_err "Rollback image missing on QNAP: $prev_image"
    exit 1
  fi

  log_info "Target rollback image: ${BOLD}${prev_image}${NC}"

  log_info "Stopping and replacing container..."
  run_remote "
    $DOCKER_BIN stop $CONTAINER_NAME >/dev/null 2>&1 || echo 'WARN: stop failed' >&2
    $DOCKER_BIN rm $CONTAINER_NAME >/dev/null 2>&1 || echo 'WARN: rm failed' >&2
    $DOCKER_BIN run -d --name $CONTAINER_NAME --restart always \
      -p ${HOST_PORT}:${INTERNAL_PORT} \
      -v ${REMOTE_DATA_DIR}:/app/data \
      '${prev_image}' >/dev/null
  " || { log_err "SERVICE DOWN, manual intervention required: rollback docker run failed"; exit 1; }

  log_info "Verifying health after rollback..."
  if check_health; then
    log_ok "Rollback successful! Container is healthy on ${prev_image}."
    run_remote "
      printf 'CURRENT_IMAGE=%s\nPREVIOUS_IMAGE=%s\nUPDATED_AT=%s\n' '${prev_image}' '${current_image}' '\$(date -u +%Y-%m-%dT%H:%M:%SZ)' > '$REMOTE_STATE_FILE'
    "
  else
    log_err "CRITICAL: Container failed health check even after rollback to ${prev_image}!"
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Action: Deploy
# ------------------------------------------------------------------------------
do_deploy() {
  local project_root
  project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$project_root"

  local git_sha
  git_sha=$(git rev-parse --short=8 HEAD 2>/dev/null || echo "manual")
  local image_tag="9router-qnap-test:${git_sha}"
  local tar_file="/tmp/9router-deploy-${git_sha}.tar.gz"

  echo -e "\n${BOLD}=== Deploying PiRouter to QNAP (${git_sha}) ===${NC}"

  # 1. Fetch current image on QNAP before modifying anything
  log_info "Checking current running container on QNAP..."
  local current_running_image
  current_running_image=$(run_remote "$DOCKER_BIN inspect --format '{{.Config.Image}}' $CONTAINER_NAME") || { log_err "Cannot inspect current container; aborting."; exit 1; }
  [[ -n "$current_running_image" ]] || { log_err "Current container has no image; aborting."; exit 1; }
  log_info "Current running image: ${BOLD}${current_running_image}${NC}"

  # 2. Local Docker Build
  log_info "Building Docker image locally: ${BOLD}${image_tag}${NC}..."
  if ! docker build -t "${image_tag}" "$project_root"; then
    log_err "Docker build failed! Aborting deployment. Live container untouched."
    exit 1
  fi
  log_ok "Docker build succeeded."

  # 3. Local Smoke Test (Run temporary container on high port)
  local smoke_port=""
  local candidate
  for candidate in 20999 21000 21001 21002 21003; do
    if ! ss -ltn "( sport = :$candidate )" | grep -q LISTEN; then smoke_port="$candidate"; break; fi
  done
  [[ -n "$smoke_port" ]] || { log_err "No free smoke-test port"; exit 1; }
  trap 'if [[ -n "$smoke_cid" ]]; then docker rm -f "$smoke_cid" >/dev/null 2>&1 || true; fi' EXIT INT TERM
  log_info "Running local smoke test on container..."
  smoke_cid=$(docker run -d --rm -p "${smoke_port}:20128" -e NODE_ENV=production "${image_tag}")
  
  local smoke_passed=0
  for ((i=1; i<=15; i++)); do
    local res
    res=$(curl -s --max-time 2 "http://127.0.0.1:${smoke_port}/api/health" || true)
    if [[ "$res" == *"\"ok\":true"* ]]; then
      smoke_passed=1
      break
    fi
    sleep 1
  done
  docker rm -f "$smoke_cid" >/dev/null 2>&1 || true
  smoke_cid=""

  if [[ "$smoke_passed" -ne 1 ]]; then
    log_err "Local smoke test FAILED (health check did not return ok). Aborting deployment!"
    exit 1
  fi
  log_ok "Local smoke test PASSED."

  # 4. Save and transfer image to QNAP
  log_info "Exporting image and transferring to QNAP..."
  docker save "${image_tag}" | gzip -c | ssh -o BatchMode=yes "$QNAP_HOST" "
    D='$DOCKER_BIN'
    gzip -dc | \$D load
  "
  log_ok "Image successfully loaded into QNAP Docker daemon."

  # 5. Stop container, then back up SQLite and its WAL companions
  log_info "Checking image and stopping container for database backup..."
  run_remote "$DOCKER_BIN image inspect '$image_tag' >/dev/null 2>&1" || { log_err "Target image missing on QNAP; aborting."; exit 1; }
  run_remote "$DOCKER_BIN stop $CONTAINER_NAME >/dev/null" || { log_err "Cannot stop container safely for backup; aborting."; exit 1; }
  log_info "Creating database backup on QNAP..."
  run_remote "
    mkdir -p '$REMOTE_BACKUP_DIR'
    if [ -f '${REMOTE_DATA_DIR}/db/data.sqlite' ]; then
      backup='${REMOTE_BACKUP_DIR}/backup-'\$(date +%Y%m%d-%H%M%S)
      mkdir -p \"\$backup\"
      for file in data.sqlite data.sqlite-wal data.sqlite-shm; do
        if [ -f '${REMOTE_DATA_DIR}/db/'\"\$file\" ]; then cp '${REMOTE_DATA_DIR}/db/'\"\$file\" \"\$backup/\" || exit 1; fi
      done
      mkdir -p /share/external/DEV3304_1/9router-backups/\"\$(basename \"\$backup\")\" && cp -f \"\$backup\"/* /share/external/DEV3304_1/9router-backups/\"\$(basename \"\$backup\")\"/ || echo 'WARN: external backup copy failed' >&2
      cd '$REMOTE_BACKUP_DIR' && ls -dt backup-* 2>/dev/null | tail -n +11 | xargs -r rm -rf || true
    else
      echo 'Database file missing' >&2
      exit 1
    fi
  " || { log_err "Database backup failed; restarting previous image."; do_rollback "$current_running_image" "$image_tag"; exit 1; }
  log_ok "Database backed up successfully."

  # 6. Switch Container
  log_info "Switching container to ${image_tag}..."
  run_remote "
    $DOCKER_BIN stop $CONTAINER_NAME >/dev/null 2>&1 || echo 'WARN: stop failed' >&2
    $DOCKER_BIN rm $CONTAINER_NAME >/dev/null 2>&1 || echo 'WARN: rm failed' >&2
    $DOCKER_BIN run -d --name $CONTAINER_NAME --restart always \
      -p ${HOST_PORT}:${INTERNAL_PORT} \
      -v ${REMOTE_DATA_DIR}:/app/data \
      '${image_tag}' >/dev/null
  " || { log_err "New image docker run failed; rolling back."; do_rollback "$current_running_image" "$image_tag"; exit 1; }

  # 7. Post-deployment Health Check
  log_info "Verifying health of new deployment..."
  if ! check_health || [[ "$(run_remote "$DOCKER_BIN inspect --format '{{.Config.Image}}' $CONTAINER_NAME" 2>/dev/null || true)" != "$image_tag" ]]; then
    log_err "HEALTH CHECK FAILED on newly deployed container!"
    log_warn "Triggering AUTOMATIC ROLLBACK to ${current_running_image}..."
    do_rollback "$current_running_image" "$image_tag"
    exit 1
  fi
  log_ok "Health check PASSED: http://${QNAP_IP}:${HOST_PORT}/api/health returned 200 OK."

  # 8. Post-deployment Verification Test (LLM chat completion)
  if [[ "${1:-}" != "--skip-e2e" ]]; then
    log_info "Running live end-to-end routing check (cx/gpt-6-sol)..."
    if verify_completion; then
      log_ok "Live chat completion PASSED."
    else
      log_warn "Live completion did not respond immediately, but health endpoint is UP."
    fi
  fi

  # 9. Record State File on QNAP
  run_remote "
    printf 'CURRENT_IMAGE=%s\nPREVIOUS_IMAGE=%s\nDEPLOYED_SHA=%s\nDEPLOYED_AT=%s\n' \
      '${image_tag}' '${current_running_image}' '${git_sha}' '\$(date -u +%Y-%m-%dT%H:%M:%SZ)' > '$REMOTE_STATE_FILE'
  "

  echo -e "\n${BOLD}${GREEN}================================================================${NC}"
  echo -e "${BOLD}${GREEN}  Deployment of ${image_tag} successful and live!${NC}"
  echo -e "${BOLD}${GREEN}================================================================${NC}\n"
}

# ------------------------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------------------------
case "${1:-}" in
  --rollback)
    state=$(run_remote "cat '$REMOTE_STATE_FILE'") || { log_err "Cannot read rollback state"; exit 1; }
    previous=$(printf '%s\n' "$state" | grep '^PREVIOUS_IMAGE=' | cut -d= -f2- || true)
    current=$(printf '%s\n' "$state" | grep '^CURRENT_IMAGE=' | cut -d= -f2- || true)
    do_rollback "$previous" "$current"
    ;;
  --status)
    do_status
    ;;
  --help|-h)
    echo "Usage: $0 [--rollback | --status | --skip-e2e]"
    ;;
  --skip-e2e|"")
    do_deploy "${1:-}"
    ;;
  *)
    echo "Usage: $0 [--rollback | --status | --skip-e2e]" >&2
    exit 2
    ;;
esac

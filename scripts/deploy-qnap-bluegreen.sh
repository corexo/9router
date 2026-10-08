#!/usr/bin/env bash
# Blue/Green QNAP deployment. Run --bootstrap once for the approved listener handoff;
# subsequent deployments switch Nginx upstreams while the old app drains.
set -euo pipefail

QNAP_HOST="qnap"
QNAP_IP="192.168.10.40"
DOCKER_BIN="/share/CE_CACHEDEV1_DATA/.qpkg/container-station/bin/docker"
DATA_DIR="/share/CE_CACHEDEV1_DATA/Container/9router-test/data-home"
INGRESS_DIR="$DATA_DIR/ingress"
INGRESS_CONF="$INGRESS_DIR/nginx.conf"
STATE_FILE="$INGRESS_DIR/state.env"
LOCK_DIR="$DATA_DIR/.blue-green-deploy.lock"
BACKUP_DIR="/share/external/DEV3304_1/9router-backups"
LEGACY_NAME="9router-qnap-test"
INGRESS_NAME="pirouter-qnap-ingress"
EXISTING_NGINX="pirouter-nginx"
EXISTING_NGINX_CONF="/share/Container/pirouter-nginx/conf.d/pirouter.conf"
BLUE_NAME="9router-qnap-blue"
GREEN_NAME="9router-qnap-green"
BLUE_PORT=9321
GREEN_PORT=9322
INTERNAL_PORT=20128
BRIDGE_INGRESS_PORT=9312
DRAIN_MAX_SECONDS=600
SMOKE_CID=""

info(){ printf '[INFO] %s\n' "$*"; }
ok(){ printf '[SUCCESS] %s\n' "$*"; }
warn(){ printf '[WARN] %s\n' "$*" >&2; }
err(){ printf '[ERROR] %s\n' "$*" >&2; }
remote(){ ssh -o BatchMode=yes "$QNAP_HOST" "$@"; }
slot_name(){ [[ "$1" == blue ]] && printf '%s' "$BLUE_NAME" || printf '%s' "$GREEN_NAME"; }
slot_port(){ [[ "$1" == blue ]] && printf '%s' "$BLUE_PORT" || printf '%s' "$GREEN_PORT"; }
image_tag(){ git rev-parse --short=8 HEAD; }

get_network_addresses(){
  local result
  result=$(remote "$DOCKER_BIN inspect '$EXISTING_NGINX' --format '{{range .NetworkSettings.Networks}}{{.Gateway}} {{.IPAddress}}{{end}}'")
  read -r BRIDGE_GATEWAY EXISTING_NGINX_IP <<<"$result"
  [[ -n "$BRIDGE_GATEWAY" && -n "$EXISTING_NGINX_IP" ]] || { err "Cannot determine existing Nginx bridge addresses"; return 1; }
}

local_build_smoke(){
  local image="$1" ready=0 root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  docker build -t "$image" "$root"
  SMOKE_CID=$(docker run -d --rm -e NODE_ENV=production "$image")
  trap 'if [[ -n "$SMOKE_CID" ]]; then docker rm -f "$SMOKE_CID" >/dev/null 2>&1 || true; fi' EXIT INT TERM
  for _ in $(seq 1 30); do
    if docker exec "$SMOKE_CID" node -e "fetch('http://127.0.0.1:${INTERNAL_PORT}/api/health').then(async r=>{const b=await r.text();if(r.status===200)process.stdout.write(b);else process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null | grep -q '"ok":true'; then ready=1; break; fi
    sleep 1
  done
  docker rm -f "$SMOKE_CID" >/dev/null 2>&1 || true
  SMOKE_CID=""
  [[ "$ready" == 1 ]] || { err "Local smoke test failed"; return 1; }
  ok "Local image smoke test passed"
}

check_storage_headroom(){
  local image="$1" image_bytes db_bytes root_free backup_free required
  image_bytes=$(docker image inspect --format '{{.Size}}' "$image")
  read -r db_bytes root_free backup_free < <(remote "db=\$(stat -c %s '$DATA_DIR/db/data.sqlite' 2>/dev/null || echo 0); root=\$(df -Pk '$DATA_DIR' | awk 'NR==2 {print \$4*1024}'); backup=\$(df -Pk '/share/external/DEV3304_1' | awk 'NR==2 {print \$4*1024}'); printf '%s %s %s\\n' \"\$db\" \"\$root\" \"\$backup\"")
  required=$((image_bytes + db_bytes + 1073741824))
  if (( root_free < required )); then
    err "QNAP volume headroom insufficient: need image+DB+1GiB reserve; refusing transfer/deploy."
    return 1
  fi
  if (( backup_free < db_bytes + 536870912 )); then
    err "External backup volume lacks DB backup headroom; refusing deploy."
    return 1
  fi
}

upload_image(){
  local image="$1"
  check_storage_headroom "$image"
  docker save "$image" | gzip -c | ssh -o BatchMode=yes "$QNAP_HOST" "$DOCKER_BIN load"
  remote "$DOCKER_BIN image inspect '$image' >/dev/null"
}

DEPLOY_LOCK_HELD=0
release_deploy_lock(){
  if [[ "$DEPLOY_LOCK_HELD" == 1 ]]; then
    remote "rmdir '$LOCK_DIR' >/dev/null 2>&1 || true"
    DEPLOY_LOCK_HELD=0
  fi
}
acquire_deploy_lock(){
  remote "mkdir '$LOCK_DIR' 2>/dev/null || { echo 'Another QNAP deployment holds the lock' >&2; exit 1; }"
  DEPLOY_LOCK_HELD=1
  trap release_deploy_lock EXIT INT TERM
}

backup_database_online(){
  local image="$1" label="$2" script_local script_remote container_script dest
  script_local="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sqlite-online-backup.cjs"
  script_remote="$INGRESS_DIR/sqlite-online-backup.cjs"
  container_script="/app/data/ingress/sqlite-online-backup.cjs"
  dest="/backup/pirouter-${label}-$(date -u +%Y%m%d-%H%M%S).sqlite"
  remote "mkdir -p '$INGRESS_DIR' '$BACKUP_DIR'"
  scp -q "$script_local" "$QNAP_HOST:$script_remote"
  remote "$DOCKER_BIN run --rm -v '$DATA_DIR:/app/data' -v '$BACKUP_DIR:/backup' -e BACKUP_PATH='$dest' --entrypoint node '$image' '$container_script'"
}

render_ingress(){
  local app_port="$1" public="$2" path="$3"
  cat >"$path" <<'NGINX_HEAD'
worker_processes auto;
error_log stderr notice;
pid /tmp/pirouter-qnap-ingress.pid;
worker_shutdown_timeout 600s;
events { worker_connections 2048; }
http {
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  server_tokens off;
  client_max_body_size 100m;
NGINX_HEAD
  if [[ "$public" == 1 ]]; then
    cat >>"$path" <<'NGINX_PUBLIC'
  server {
    listen 9311;
    server_name _;
    location / {
      proxy_pass http://127.0.0.1:__APP_PORT__;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_buffering off;
      proxy_request_buffering off;
      proxy_read_timeout 600s;
      proxy_send_timeout 600s;
      proxy_connect_timeout 60s;
    }
  }
NGINX_PUBLIC
  fi
  cat >>"$path" <<'NGINX_INTERNAL'
  server {
    listen __BRIDGE_GATEWAY__:9312;
    server_name _;
    allow __NGINX_IP__;
    deny all;
    location / {
      proxy_pass http://127.0.0.1:__APP_PORT__;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $http_x_real_ip;
      proxy_set_header X-Forwarded-For $http_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_buffering off;
      proxy_request_buffering off;
      proxy_read_timeout 600s;
      proxy_send_timeout 600s;
      proxy_connect_timeout 60s;
    }
  }
}
NGINX_INTERNAL
  sed -i -e "s/__APP_PORT__/${app_port}/g" -e "s/__BRIDGE_GATEWAY__/${BRIDGE_GATEWAY}/g" -e "s/__NGINX_IP__/${EXISTING_NGINX_IP}/g" "$path"
}

install_ingress_conf(){
  local port="$1" public="$2" tmp="/tmp/pirouter-ingress-$$.conf"
  get_network_addresses
  render_ingress "$port" "$public" "$tmp"
  remote "mkdir -p '$INGRESS_DIR'"
  scp -q "$tmp" "$QNAP_HOST:$INGRESS_CONF.new"
  rm -f "$tmp"
  remote "mv '$INGRESS_CONF.new' '$INGRESS_CONF'"
}

start_or_reload_ingress(){
  if remote "$DOCKER_BIN inspect '$INGRESS_NAME' >/dev/null 2>&1"; then
    remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -t -c /ingress/nginx.conf && $DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf"
  else
    remote "$DOCKER_BIN run -d --name '$INGRESS_NAME' --network host --restart always -v '$INGRESS_DIR:/ingress:ro' nginx:alpine nginx -c /ingress/nginx.conf -g 'daemon off;' >/dev/null"
    remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -t -c /ingress/nginx.conf"
  fi
}

health_slot(){
  local name="$1"
  local health_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/healthcheck-local.cjs"
  for _ in $(seq 1 30); do
    if remote "$DOCKER_BIN exec -i '$name' node -" < "$health_script" 2>/dev/null | grep -q '"ok":true'; then return 0; fi
    sleep 2
  done
  return 1
}

public_health(){ curl -fsS -o /dev/null --max-time 5 "http://${QNAP_IP}:9311/api/health"; }

read_state(){
  local raw state_file="${1:-$STATE_FILE}"
  if [[ "${LOCAL_STATE_TEST:-0}" == 1 ]]; then
    raw=$(cat "$state_file") || return 1
  else
    raw=$(remote "cat '$state_file'" 2>/dev/null) || return 1
  fi
  MODE=$(printf '%s\n' "$raw" | sed -n 's/^MODE=//p')
  ACTIVE_SLOT=$(printf '%s\n' "$raw" | sed -n 's/^ACTIVE_SLOT=//p')
  ACTIVE_IMAGE=$(printf '%s\n' "$raw" | sed -n 's/^ACTIVE_IMAGE=//p')
  PREVIOUS_SLOT=$(printf '%s\n' "$raw" | sed -n 's/^PREVIOUS_SLOT=//p')
  PREVIOUS_IMAGE=$(printf '%s\n' "$raw" | sed -n 's/^PREVIOUS_IMAGE=//p')
  [[ "$MODE" == bluegreen && ( "$ACTIVE_SLOT" == blue || "$ACTIVE_SLOT" == green ) && -n "$ACTIVE_IMAGE" ]]
}

write_state(){
  local active_slot="$1" active_image="$2" previous_slot="$3" previous_image="$4"
  local updated_at
  updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  remote "printf '%s\\n' 'MODE=bluegreen' 'ACTIVE_SLOT=$active_slot' 'ACTIVE_IMAGE=$active_image' 'PREVIOUS_SLOT=$previous_slot' 'PREVIOUS_IMAGE=$previous_image' 'UPDATED_AT=$updated_at' > '$STATE_FILE.new' && mv '$STATE_FILE.new' '$STATE_FILE'"
}

start_slot(){
  local slot="$1" image="$2" name port
  name=$(slot_name "$slot"); port=$(slot_port "$slot")
  remote "$DOCKER_BIN rm -f '$name' >/dev/null 2>&1 || true"
  remote "$DOCKER_BIN run -d --name '$name' --restart always -p 127.0.0.1:${port}:20128 -v '$DATA_DIR:/app/data' '$image' >/dev/null"
  health_slot "$name"
}

update_existing_nginx_upstream(){
  local target="$1" backup="$BACKUP_DIR/pirouter-nginx-config-$(date -u +%Y%m%d-%H%M%S).conf"
  local updater="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-nginx-upstream.sh"
  local remote_updater="$INGRESS_DIR/update-nginx-upstream.sh"
  remote "mkdir -p '$INGRESS_DIR' '$BACKUP_DIR'"
  scp -q "$updater" "$QNAP_HOST:$remote_updater"
  if ! remote "sh '$remote_updater' '$EXISTING_NGINX_CONF' '$target' '$backup' && $DOCKER_BIN exec '$EXISTING_NGINX' nginx -t"; then
    remote "cp '$backup' '$EXISTING_NGINX_CONF' && $DOCKER_BIN exec '$EXISTING_NGINX' nginx -t && $DOCKER_BIN exec '$EXISTING_NGINX' nginx -s reload" || true
    return 1
  fi
  remote "$DOCKER_BIN exec '$EXISTING_NGINX' nginx -s reload"
}

bootstrap(){
  local image="$1" old_image old_ip green_port=$GREEN_PORT
  if read_state; then err "Blue/Green already bootstrapped"; return 1; fi
  if remote "$DOCKER_BIN inspect '$INGRESS_NAME' >/dev/null 2>&1" || remote "$DOCKER_BIN inspect '$BLUE_NAME' >/dev/null 2>&1" || remote "$DOCKER_BIN inspect '$GREEN_NAME' >/dev/null 2>&1"; then
    err "Partial Blue/Green bootstrap exists without state; inspect manually before retrying"; return 1
  fi
  old_image=$(remote "$DOCKER_BIN inspect --format '{{.Config.Image}}' '$LEGACY_NAME'") || { err "Legacy app container missing"; return 1; }
  get_network_addresses
  backup_database_online "$old_image" "pre-bluegreen-bootstrap"
  if ! start_slot green "$image"; then remote "$DOCKER_BIN rm -f '$GREEN_NAME' >/dev/null 2>&1 || true"; err "Green candidate unhealthy; legacy remains live"; return 1; fi
  install_ingress_conf "$GREEN_PORT" 0
  remote "$DOCKER_BIN run -d --name '$INGRESS_NAME' --network host --restart always -v '$INGRESS_DIR:/ingress:ro' nginx:alpine nginx -c /ingress/nginx.conf -g 'daemon off;' >/dev/null"
  remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -t -c /ingress/nginx.conf"
  if ! remote "$DOCKER_BIN exec '$EXISTING_NGINX' wget -qO- --timeout=5 http://${BRIDGE_GATEWAY}:${BRIDGE_INGRESS_PORT}/api/health | grep -q 'ok'"; then
    remote "$DOCKER_BIN rm -f '$INGRESS_NAME' '$GREEN_NAME' >/dev/null 2>&1 || true"
    err "HTTPS canary failed; legacy direct endpoint untouched"; return 1
  fi
  old_ip=$(remote "$DOCKER_BIN inspect '$LEGACY_NAME' --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'")
  update_existing_nginx_upstream "${BRIDGE_GATEWAY}:${BRIDGE_INGRESS_PORT}"
  info "HTTPS is routed through green; legacy :9311 remains available. Beginning approved one-time :9311 handoff."
  remote "$DOCKER_BIN stop '$LEGACY_NAME' >/dev/null"
  install_ingress_conf "$GREEN_PORT" 1
  if ! remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -t -c /ingress/nginx.conf && $DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf" || ! public_health; then
    install_ingress_conf "$GREEN_PORT" 0 || true
    remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf || true"
    remote "$DOCKER_BIN start '$LEGACY_NAME' >/dev/null" || true
    update_existing_nginx_upstream "$old_ip:20128" || true
    err "One-time port handoff failed; legacy app restored"; return 1
  fi
  write_state green "$image" blue "$old_image"
  if ! update_existing_nginx_upstream "${BRIDGE_GATEWAY}:${BRIDGE_INGRESS_PORT}"; then
    warn "HTTPS proxy remains on the already-healthy canary ingress :9312; inspect pirouter-nginx config."
  fi
  remote "$DOCKER_BIN rm '$LEGACY_NAME' >/dev/null 2>&1 || true"
  ok "Blue/Green ingress bootstrapped and healthy on :9311."
}

switch_bluegreen(){
  local image="$1" active_port active_name inactive_slot inactive_name inactive_port previous_image
  read_state || { err "Blue/Green not bootstrapped; run --bootstrap once first"; return 1; }
  active_port=$(slot_port "$ACTIVE_SLOT"); active_name=$(slot_name "$ACTIVE_SLOT"); previous_image="$ACTIVE_IMAGE"
  if [[ "$ACTIVE_SLOT" == blue ]]; then inactive_slot=green; else inactive_slot=blue; fi
  inactive_name=$(slot_name "$inactive_slot"); inactive_port=$(slot_port "$inactive_slot")
  local inactive_status
  inactive_status=$(remote "$DOCKER_BIN inspect '$inactive_name' --format '{{.State.Status}}' 2>/dev/null || true")
  if [[ "$inactive_status" == running ]]; then err "Inactive slot still running/draining; refusing to overwrite"; return 1; fi
  remote "$DOCKER_BIN rm -f '$inactive_name' >/dev/null 2>&1 || true"
  backup_database_online "$ACTIVE_IMAGE" "pre-deploy-$(printf '%s' "$image" | cut -d: -f2)"
  if ! start_slot "$inactive_slot" "$image"; then remote "$DOCKER_BIN rm -f '$inactive_name' >/dev/null 2>&1 || true"; err "Candidate failed health; active slot unchanged"; return 1; fi
  install_ingress_conf "$inactive_port" 1
  if ! remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -t -c /ingress/nginx.conf && $DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf" || ! public_health; then
    install_ingress_conf "$active_port" 1 || true
    remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf || true"
    remote "$DOCKER_BIN stop '$inactive_name' >/dev/null 2>&1 || true"
    err "Switch failed; ingress restored to active slot"; return 1
  fi
  write_state "$inactive_slot" "$image" "$ACTIVE_SLOT" "$previous_image"
  ok "Traffic switched to $inactive_slot; new health verified."
  # Nginx old workers retain existing streams. Wait until they drain before stopping old app.
  local drained=0
  for _ in $(seq 1 "$DRAIN_MAX_SECONDS"); do
    local count
    count=$(remote "$DOCKER_BIN exec '$INGRESS_NAME' sh -c \"ps | grep -c '[w]orker process is shutting down' || true\"" 2>/dev/null || echo 0)
    if [[ "${count:-0}" == 0 ]]; then drained=1; break; fi
    sleep 2
  done
  if [[ "$drained" == 1 ]]; then remote "$DOCKER_BIN stop '$active_name' >/dev/null 2>&1 || true"; else warn "Old worker still draining; previous slot retained; do not reuse until drained."; fi
}

rollback(){
  read_state || { err "No Blue/Green state"; return 1; }
  [[ -n "$PREVIOUS_IMAGE" && ( "$PREVIOUS_SLOT" == blue || "$PREVIOUS_SLOT" == green ) ]] || { err "No previous image/slot recorded"; return 1; }
  local target_name target_port current_name current_port status
  target_name=$(slot_name "$PREVIOUS_SLOT"); target_port=$(slot_port "$PREVIOUS_SLOT")
  current_name=$(slot_name "$ACTIVE_SLOT"); current_port=$(slot_port "$ACTIVE_SLOT")
  status=$(remote "$DOCKER_BIN inspect '$target_name' --format '{{.State.Status}}' 2>/dev/null" || true)
  if [[ "$status" != running ]]; then
    remote "$DOCKER_BIN rm -f '$target_name' >/dev/null 2>&1 || true"
    if ! start_slot "$PREVIOUS_SLOT" "$PREVIOUS_IMAGE"; then err "Previous image failed health; current stays active"; return 1; fi
  fi
  install_ingress_conf "$target_port" 1
  if ! remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -t -c /ingress/nginx.conf && $DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf" || ! public_health; then
    install_ingress_conf "$current_port" 1 || true
    remote "$DOCKER_BIN exec '$INGRESS_NAME' nginx -s reload -c /ingress/nginx.conf || true"
    err "Rollback switch failed; current slot restored"; return 1
  fi
  write_state "$PREVIOUS_SLOT" "$PREVIOUS_IMAGE" "$ACTIVE_SLOT" "$ACTIVE_IMAGE"
  remote "$DOCKER_BIN stop '$current_name' >/dev/null 2>&1 || true"
  ok "Rolled back to $PREVIOUS_SLOT ($PREVIOUS_IMAGE)"
}

status(){
  if ! read_state; then
    echo "MODE=legacy-direct (bootstrap required; user-approved brief listener handoff)"
    remote "$DOCKER_BIN inspect '$LEGACY_NAME' --format 'image={{.Config.Image}} status={{.State.Status}} restarts={{.RestartCount}}' 2>/dev/null || true"
    curl -s -o /dev/null -w 'direct-health=%{http_code}\\n' "http://${QNAP_IP}:9311/api/health" || true
    return
  fi
  printf 'MODE=bluegreen ACTIVE_SLOT=%s ACTIVE_IMAGE=%s PREVIOUS_SLOT=%s PREVIOUS_IMAGE=%s\\n' "$ACTIVE_SLOT" "$ACTIVE_IMAGE" "$PREVIOUS_SLOT" "$PREVIOUS_IMAGE"
  remote "$DOCKER_BIN inspect '$INGRESS_NAME' --format 'ingress={{.State.Status}}'"
  remote "$DOCKER_BIN ps -a --filter name=9router-qnap- --format '{{.Names}} {{.Image}} {{.Status}}'"
  curl -s -o /dev/null -w 'health=%{http_code}\\n' "http://${QNAP_IP}:9311/api/health" || true
}

case "${1:-}" in
  --render-config)
    BRIDGE_GATEWAY="${4:-127.0.0.1}"
    EXISTING_NGINX_IP="${5:-127.0.0.1}"
    render_tmp="$(mktemp "${TMPDIR:-/tmp}/pirouter-ingress.XXXXXX")"
    render_ingress "${2:-9321}" "${3:-1}" "$render_tmp"
    cat "$render_tmp"
    rm -f "$render_tmp"
    ;;
  --status)
    status
    ;;
  --test-state)
    LOCAL_STATE_TEST=1
    read_state "${2:?state file required}"
    printf 'active=%s image=%s previous=%s\n' "$ACTIVE_SLOT" "$ACTIVE_IMAGE" "$PREVIOUS_SLOT"
    ;;
  --bootstrap)
    acquire_deploy_lock
    image="9router-qnap-test:$(tag)"
    local_build_smoke "$image"
    upload_image "$image"
    bootstrap "$image"
    ;;
  --rollback)
    acquire_deploy_lock
    rollback
    ;;
  --skip-e2e|"")
    acquire_deploy_lock
    image="9router-qnap-test:$(tag)"
    local_build_smoke "$image"
    upload_image "$image"
    switch_bluegreen "$image"
    ;;
  *)
    err "Usage: $0 [--status|--bootstrap|--rollback|--skip-e2e|--render-config [appPort] [public] [bridgeGateway] [nginxIp]]"
    exit 2
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "--legacy" ]]; then shift; exec "$SCRIPT_DIR/deploy-qnap-legacy.sh" "$@"; fi
exec "$SCRIPT_DIR/deploy-qnap-bluegreen.sh" "$@"

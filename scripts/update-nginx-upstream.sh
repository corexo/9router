#!/bin/sh
set -eu
config="$1"
target="$2"
backup="$3"
[ -f "$config" ] || { echo "nginx config missing" >&2; exit 1; }
cp "$config" "$backup"
awk -v target="$target" '
  BEGIN { in_upstream = 0; replaced = 0 }
  /upstream pirouter_backend[[:space:]]*\{/ { in_upstream = 1 }
  in_upstream && /server[[:space:]]/ {
    sub(/server[[:space:]]+[^;]+;/, "server " target ";")
    replaced = 1
    in_upstream = 0
  }
  { print }
  END { if (!replaced) exit 3 }
' "$config" > "$config.tmp"
mv "$config.tmp" "$config"

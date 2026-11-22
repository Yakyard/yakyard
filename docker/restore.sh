#!/bin/sh
# Puts a backup from docker/backup.sh back. Replaces everything in this Yakyard. Run it next to docker-compose.yml:
#   sh docker/restore.sh backups/yakyard-2026-11-22-0930.tar.gz
set -eu
[ -f "${1:-}" ] || { echo "Give a backup file: sh docker/restore.sh backups/yakyard-<date>.tar.gz"; exit 1; }
if [ "${2:-}" != "--yes" ]; then
  printf 'This replaces everything in this Yakyard with the backup. Type yes to go on: '
  read -r answer
  [ "$answer" = "yes" ] || { echo "Nothing changed."; exit 0; }
fi
dir=$(cd "$(dirname "$1")" && pwd)
docker compose stop yakyard
trap 'docker compose start yakyard' EXIT
docker compose run --rm --no-deps --user root -v "$dir:/backups:ro" --entrypoint sh yakyard \
  -c 'find /data -mindepth 1 -delete && tar xzf "/backups/$1" -C /data && chown -R node:node /data' restore "$(basename "$1")"
echo "Restored. Sign in and open a channel to check."

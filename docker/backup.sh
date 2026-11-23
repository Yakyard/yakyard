#!/bin/sh
# Backs up everything (messages, files, settings) into backups/yakyard-<date>.tar.gz.
# Yakyard pauses for a few seconds so the databases are copied whole. Run it next to docker-compose.yml:
#   sh docker/backup.sh
set -eu
mkdir -p backups
file="yakyard-$(date +%Y-%m-%d-%H%M).tar.gz"
docker compose stop yakyard
trap 'docker compose start yakyard' EXIT
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backups" --entrypoint sh yakyard \
  -c 'umask 077 && tar czf "/backups/$1.partial" -C /data . && mv "/backups/$1.partial" "/backups/$1"' backup "$file"
echo "Saved backups/$file. Keep a copy of .env too: it holds your keys."

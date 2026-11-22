#!/bin/sh
# Backs up everything (messages, files, settings) into backups/yakyard-<date>.tar.gz.
# Yakyard pauses for a few seconds so the databases are copied whole. Run it next to docker-compose.yml:
#   sh docker/backup.sh
set -eu
mkdir -p backups
file="yakyard-$(date +%Y-%m-%d-%H%M).tar.gz"
docker compose stop yakyard
trap 'docker compose start yakyard' EXIT
docker compose run --rm --no-deps --user root -v "$PWD/backups:/backups" --entrypoint tar yakyard czf "/backups/$file" -C /data .
echo "Saved backups/$file"

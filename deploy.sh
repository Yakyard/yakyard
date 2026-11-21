#!/bin/bash
# Stamps a version (open apps show the "new version" pop-up), then deploys.
set -e
cd "$(dirname "$0")"
npm ci --no-audit --no-fund   # exact versions from package-lock.json
V=$(TZ=UTC date +%Y%m%d%H%M)
echo "{\"v\":\"$V\"}" > public/version.json
sed -i.bak -E "s/(yakyard-version\" content=\")[^\"]+/\1$V/; s/(app\.(css|js)\?v=)[^\"]+/\1$V/g" public/index.html && rm -f public/index.html.bak
npx wrangler deploy
echo "Deployed version $V"
